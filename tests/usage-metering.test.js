import assert from "node:assert/strict";
import test from "node:test";

import {
  METER_EVENT_TYPES,
  TELEMETRY_ONLY_METER_EVENT_TYPES,
  captureLifecycleMeterEvents,
  captureMeterEvents,
  computeMeterHash,
  deriveLifecycleMeterEvents,
  meterEventId,
  meterGenesisHash,
  projectMeterLedger,
  projectMeterReconciliations,
  recordMeterEvent,
  reconcileProviderUsage,
  replayMeterEventsFromLifecycles,
  verifyMeterLedger
} from "@loanos/core/platform/usage-metering.js";

const NOW = new Date("2026-07-21T09:00:00.000Z");
const TENANT = "tenant-a";

const providerEvent = (overrides = {}) => ({
  tenantId: TENANT,
  eventType: "meter.provider.invoked",
  sourceRef: "call-1",
  providerKey: "cibil",
  quantity: "1",
  occurredAt: "2026-07-05T00:00:00.000Z",
  ...overrides
});

const approvedTransition = (overrides = {}) => ({
  transitionId: "txn-1",
  lifecycleId: "lc-1",
  status: "approved",
  actionType: "advance",
  targetStage: "disbursement",
  approvedAt: "2026-07-05T00:00:00.000Z",
  approvedBy: "checker@tenant-a",
  ...overrides
});

// ---------------------------------------------------------------------------
// ADVERSE PATH FIRST — the fail-open guarantee is the whole point of ADR 0009.
// If any of these regress, a metering fault can deny a borrower credit.
// ---------------------------------------------------------------------------

test("captureMeterEvents never throws on malformed input and reports rejections", () => {
  const inputs = [
    providerEvent(),
    { tenantId: TENANT, eventType: "meter.not.a.real.type", sourceRef: "x", quantity: "1" },
    { tenantId: TENANT, eventType: "meter.decision.evaluated", sourceRef: "", quantity: "1" },
    { eventType: "meter.decision.evaluated", sourceRef: "y", quantity: "1" },
    { tenantId: TENANT, eventType: "meter.provider.invoked", sourceRef: "z", quantity: "-4", providerKey: "cibil" },
    { tenantId: TENANT, eventType: "meter.provider.invoked", sourceRef: "w", quantity: "1" },
    null
  ];
  const result = captureMeterEvents({}, inputs, NOW);
  assert.equal(result.accepted.length, 1, "only the well-formed event is accepted");
  assert.equal(result.rejected.length, 6, "every bad event is reported, none thrown");
  assert.deepEqual(
    result.rejected.map((entry) => entry.code),
    [
      "meter_event_type_unknown",
      "meter_input_invalid",
      "meter_input_invalid",
      "meter_quantity_invalid",
      "meter_provider_key_required",
      "meter_input_invalid"
    ]
  );
  assert.equal(result.state.meterEvents.length, 1, "the good event still persisted alongside the failures");
});

test("captureLifecycleMeterEvents never throws and leaves state usable when derivation fails", () => {
  const before = { meterEvents: [] };
  for (const bad of [undefined, null, {}, { tenantId: TENANT }, { tenantId: TENANT, transition: "nonsense" }]) {
    const result = captureLifecycleMeterEvents(before, bad, NOW);
    assert.ok(result.state, "state is always returned");
    assert.equal(result.accepted.length, 0);
  }
  // A lifecycle transition must never be unwound by the meter: state is intact.
  assert.deepEqual(captureLifecycleMeterEvents(before, undefined, NOW).state, before);
});

test("a corrupt ledger does not block new metering — detection is a read-time concern", () => {
  const first = recordMeterEvent({}, providerEvent(), NOW);
  const tampered = { ...first.state, meterEvents: first.state.meterEvents.map((e) => ({ ...e, quantity: "999" })) };
  assert.equal(verifyMeterLedger(tampered.meterEvents, TENANT).valid, false, "tampering is detectable");
  const second = captureMeterEvents(tampered, [providerEvent({ sourceRef: "call-2" })], NOW);
  assert.equal(second.rejected.length, 0, "metering continues despite historical corruption");
  assert.equal(second.state.meterEvents.length, 2);
});

test("unknown event types and telemetry-only classification are enforced", () => {
  assert.throws(
    () => recordMeterEvent({}, { tenantId: TENANT, eventType: "meter.invented", sourceRef: "a" }, NOW),
    /Unsupported meter event type/
  );
  const telemetry = recordMeterEvent({}, {
    tenantId: TENANT, eventType: "meter.application.created", sourceRef: "lc-1"
  }, NOW);
  assert.equal(telemetry.event.billable, false, "applications created must never become a billable line");
  for (const type of METER_EVENT_TYPES) {
    const expected = TELEMETRY_ONLY_METER_EVENT_TYPES.includes(type);
    const event = recordMeterEvent({}, { tenantId: TENANT, eventType: type, sourceRef: `s-${type}`, providerKey: "p" }, NOW);
    assert.equal(event.event.billable, !expected, `${type} billability`);
  }
});

// ---------------------------------------------------------------------------
// IDEMPOTENCY — a retried callback must not double-bill.
// ---------------------------------------------------------------------------

test("the same lifecycle transition meters exactly once however many times it is replayed", () => {
  const transition = approvedTransition();
  const lifecycle = { lifecycleId: "lc-1", journeyType: "personal_loan" };
  let state = {};
  for (let attempt = 0; attempt < 5; attempt += 1) {
    state = captureLifecycleMeterEvents(state, { tenantId: TENANT, lifecycle, transition }, NOW).state;
  }
  const ledger = projectMeterLedger(state, { tenantId: TENANT });
  assert.equal(ledger.count, 1, "five retried callbacks produce one billable event");
  assert.equal(ledger.totalsByType["meter.loan.disbursed"], "1");
});

test("meter identity derives from the occurrence, never from the request", () => {
  const a = meterEventId(TENANT, "meter.loan.disbursed", "txn-1");
  const b = meterEventId(TENANT, "meter.loan.disbursed", "txn-1");
  const other = meterEventId("tenant-b", "meter.loan.disbursed", "txn-1");
  assert.equal(a, b, "same occurrence, same identity");
  assert.notEqual(a, other, "identity is tenant-scoped");
});

// ---------------------------------------------------------------------------
// TENANT ISOLATION AND EVIDENCE INTEGRITY
// ---------------------------------------------------------------------------

test("a ledger cannot be transplanted between tenants", () => {
  const { state } = recordMeterEvent({}, providerEvent(), NOW);
  assert.equal(verifyMeterLedger(state.meterEvents, TENANT).valid, true);
  const foreign = verifyMeterLedger(state.meterEvents, "tenant-b");
  assert.equal(foreign.valid, false, "tenant-b's genesis breaks the chain at index 0");
  assert.equal(foreign.brokenAt, 0);
  assert.notEqual(meterGenesisHash(TENANT), meterGenesisHash("tenant-b"));
});

test("the ledger projection is scoped to one tenant", () => {
  let state = recordMeterEvent({}, providerEvent(), NOW).state;
  state = recordMeterEvent(state, providerEvent({ tenantId: "tenant-b", sourceRef: "call-b" }), NOW).state;
  assert.equal(projectMeterLedger(state, { tenantId: TENANT }).count, 1);
  assert.equal(projectMeterLedger(state, { tenantId: "tenant-b" }).count, 1);
  assert.ok(projectMeterLedger(state, { tenantId: TENANT }).events.every((e) => e.tenantId === TENANT));
});

test("insertion, deletion, reordering and edits all break the chain", () => {
  let state = {};
  for (const ref of ["c1", "c2", "c3"]) state = recordMeterEvent(state, providerEvent({ sourceRef: ref }), NOW).state;
  const sealed = state.meterEvents;
  assert.equal(verifyMeterLedger(sealed, TENANT).valid, true);

  assert.equal(verifyMeterLedger([sealed[0], sealed[2]], TENANT).valid, false, "deletion detected");
  assert.equal(verifyMeterLedger([sealed[1], sealed[0], sealed[2]], TENANT).valid, false, "reordering detected");
  const edited = [...sealed];
  edited[1] = { ...edited[1], quantity: "50" };
  const verdict = verifyMeterLedger(edited, TENANT);
  assert.equal(verdict.valid, false);
  assert.equal(verdict.reason, "content_tampered");
  assert.equal(verdict.brokenAt, 1);
});

test("hashes cover the previous link, so a re-derived hash matches only in place", () => {
  const { state } = recordMeterEvent({}, providerEvent(), NOW);
  const [event] = state.meterEvents;
  assert.equal(computeMeterHash(event, event.previousHash), event.hash);
  assert.notEqual(computeMeterHash(event, meterGenesisHash("tenant-b")), event.hash);
});

// ---------------------------------------------------------------------------
// DERIVATION AND REPLAY — the degradation path.
// ---------------------------------------------------------------------------

test("only governed, approved advance transitions derive billable meters", () => {
  assert.equal(deriveLifecycleMeterEvents({ tenantId: TENANT, transition: approvedTransition({ status: "pending" }) }).length, 0);
  assert.equal(deriveLifecycleMeterEvents({ tenantId: TENANT, transition: approvedTransition({ actionType: "resume" }) }).length, 0);
  assert.equal(deriveLifecycleMeterEvents({ tenantId: TENANT, transition: approvedTransition({ targetStage: "kyc_aml" }) }).length, 0);
  assert.equal(deriveLifecycleMeterEvents({ transition: approvedTransition() }).length, 0, "no tenant, no meter");

  const decision = deriveLifecycleMeterEvents({ tenantId: TENANT, transition: approvedTransition({ targetStage: "credit_decision" }) });
  assert.equal(decision[0].eventType, "meter.decision.evaluated");
  const disbursed = deriveLifecycleMeterEvents({ tenantId: TENANT, transition: approvedTransition() });
  assert.equal(disbursed[0].eventType, "meter.loan.disbursed");
  assert.equal(disbursed[0].sourceRef, "txn-1", "keyed on the transition, not the request");
});

test("replay rebuilds meter events lost to an outage, and is safe to run repeatedly", () => {
  const state = {
    composedJourneyLifecycles: {
      "lc-1": {
        tenantId: TENANT,
        lifecycleId: "lc-1",
        journeyType: "personal_loan",
        transitionHistory: [
          { transitionId: "txn-a", actionType: "advance", targetStage: "credit_decision", approvedAt: "2026-07-02T00:00:00.000Z", approvedBy: "checker" },
          { transitionId: "txn-b", actionType: "advance", targetStage: "disbursement", approvedAt: "2026-07-03T00:00:00.000Z", approvedBy: "checker" },
          { transitionId: "txn-c", actionType: "advance", targetStage: "servicing", approvedAt: "2026-07-04T00:00:00.000Z", approvedBy: "checker" }
        ]
      },
      "lc-other": { tenantId: "tenant-b", lifecycleId: "lc-other", transitionHistory: [
        { transitionId: "txn-z", actionType: "advance", targetStage: "disbursement", approvedAt: "2026-07-03T00:00:00.000Z" }
      ] }
    }
  };
  const first = replayMeterEventsFromLifecycles(state, { tenantId: TENANT }, NOW);
  assert.equal(first.recovered.length, 2, "decision and disbursement recovered; servicing is not a meter");
  assert.equal(first.scannedTransitions, 3, "only this tenant's lifecycles were scanned");
  assert.equal(projectMeterLedger(first.state, { tenantId: "tenant-b" }).count, 0, "replay never crosses tenants");

  const second = replayMeterEventsFromLifecycles(first.state, { tenantId: TENANT }, NOW);
  assert.equal(second.recovered.length, 0, "nothing new on a second run");
  assert.equal(second.alreadyPresent, 2, "existing events are recognised, not duplicated");
});

test("replay reconciles a ledger that missed live capture entirely", () => {
  const lifecycle = { lifecycleId: "lc-1", journeyType: "personal_loan", tenantId: TENANT };
  const transition = approvedTransition();
  const live = captureLifecycleMeterEvents({}, { tenantId: TENANT, lifecycle, transition }, NOW);
  const outage = {
    composedJourneyLifecycles: { "lc-1": { ...lifecycle, transitionHistory: [{ ...transition }] } }
  };
  const replayed = replayMeterEventsFromLifecycles(outage, { tenantId: TENANT }, NOW);
  assert.equal(replayed.recovered.length, 1);
  assert.equal(
    replayed.recovered[0].meterEventId,
    live.accepted[0].meterEventId,
    "replay reconstructs the identical event id, so live and replayed ledgers converge"
  );
});

// ---------------------------------------------------------------------------
// QUANTITY EXACTNESS
// ---------------------------------------------------------------------------

test("quantities aggregate exactly, with no floating-point drift", () => {
  let state = {};
  for (let index = 0; index < 10; index += 1) {
    state = recordMeterEvent(state, {
      tenantId: TENANT, eventType: "meter.storage.snapshot", sourceRef: `p-${index}`, quantity: "0.1"
    }, NOW).state;
  }
  const totals = projectMeterLedger(state, { tenantId: TENANT }).totalsByType;
  assert.equal(totals["meter.storage.snapshot"], "1", "0.1 x 10 is exactly 1, not 0.9999999999999999");
  assert.notEqual(String(0.1 * 10), "1e0");
});

test("quantity precision beyond the ledger scale is rejected rather than silently rounded", () => {
  assert.throws(
    () => recordMeterEvent({}, { tenantId: TENANT, eventType: "meter.storage.snapshot", sourceRef: "p", quantity: "0.0000001" }, NOW),
    /at most 6 decimal places/
  );
});

// ---------------------------------------------------------------------------
// PROVIDER RECONCILIATION
// ---------------------------------------------------------------------------

const seedProviderUsage = (count, providerKey = "cibil") => {
  let state = {};
  for (let index = 0; index < count; index += 1) {
    state = recordMeterEvent(state, providerEvent({ sourceRef: `${providerKey}-call-${index}`, providerKey }), NOW).state;
  }
  return state;
};

const reconcileInput = (overrides = {}) => ({
  reconciliationId: "rec-1",
  tenantId: TENANT,
  providerKey: "cibil",
  periodFrom: "2026-07-01T00:00:00.000Z",
  periodTo: "2026-08-01T00:00:00.000Z",
  invoicedQuantity: "100",
  openedBy: "finance@loanos",
  ...overrides
});

test("variance beyond the threshold opens an exception rather than passing quietly", () => {
  const state = seedProviderUsage(100);
  const within = reconcileProviderUsage(state, reconcileInput({ invoicedQuantity: "101" }), NOW);
  assert.equal(within.reconciliation.status, "reconciled", "1% variance is inside the 2% default");
  assert.equal(within.reconciliation.varianceBasisPoints, 99);

  const beyond = reconcileProviderUsage(state, reconcileInput({ reconciliationId: "rec-2", invoicedQuantity: "140" }), NOW);
  assert.equal(beyond.reconciliation.status, "exception");
  assert.equal(beyond.reconciliation.varianceQuantity, "-40", "we metered 40 fewer calls than we were billed for");
  assert.ok(beyond.reconciliation.varianceBasisPoints > 200);
});

test("an invoice for zero units against real metered usage is always an exception", () => {
  const state = seedProviderUsage(5);
  const result = reconcileProviderUsage(state, reconcileInput({ invoicedQuantity: "0" }), NOW);
  assert.equal(result.reconciliation.status, "exception");
  assert.equal(result.reconciliation.varianceBasisPoints, null, "an unbounded variance is reported as such, not as a number");
});

test("reconciliation is scoped to one provider and one period", () => {
  let state = seedProviderUsage(10, "cibil");
  for (let index = 0; index < 7; index += 1) {
    state = recordMeterEvent(state, providerEvent({ sourceRef: `experian-${index}`, providerKey: "experian" }), NOW).state;
  }
  state = recordMeterEvent(state, providerEvent({ sourceRef: "outside", occurredAt: "2026-06-01T00:00:00.000Z" }), NOW).state;
  const result = reconcileProviderUsage(state, reconcileInput({ invoicedQuantity: "10" }), NOW);
  assert.equal(result.reconciliation.meteredQuantity, "10", "other providers and other periods are excluded");
  assert.equal(result.reconciliation.status, "reconciled");
});

test("reconciliation records ledger integrity and refuses duplicate or invalid periods", () => {
  const state = seedProviderUsage(3);
  const first = reconcileProviderUsage(state, reconcileInput({ invoicedQuantity: "3" }), NOW);
  assert.equal(first.reconciliation.ledgerIntegrity, "valid");
  assert.ok(first.reconciliation.evidenceChecksumSha256.length === 64);
  assert.throws(() => reconcileProviderUsage(first.state, reconcileInput({ invoicedQuantity: "3" }), NOW), /already exists/);
  assert.throws(
    () => reconcileProviderUsage(state, reconcileInput({ periodTo: "2026-06-01T00:00:00.000Z" }), NOW),
    /periodTo must be after periodFrom/
  );

  const projection = projectMeterReconciliations(first.state, { tenantId: TENANT });
  assert.equal(projection.count, 1);
  assert.equal(projection.exceptionCount, 0);
});

test("a tampered ledger is reported on the reconciliation it feeds", () => {
  const state = seedProviderUsage(3);
  const tampered = { ...state, meterEvents: state.meterEvents.map((e, i) => (i === 1 ? { ...e, quantity: "9" } : e)) };
  const result = reconcileProviderUsage(tampered, reconcileInput({ invoicedQuantity: "11" }), NOW);
  assert.equal(result.reconciliation.ledgerIntegrity, "content_tampered",
    "a reconciliation built on a broken chain says so on its face");
});
