/**
 * Tenant usage metering — step 1: emit and persist billable events.
 *
 * WHAT THIS IS
 * ------------
 * `tenant-product-entitlements.js` records what a tenant is ENTITLED to use.
 * Nothing recorded what it actually USED, so nothing on the platform was
 * billable (INT-ADM-08: "Commercial controls only; no billing/tax/payment
 * provider"; INT-PLT-12 unbuilt). This module is the missing half: an
 * append-only, tenant-scoped, hash-chained ledger of consumption events.
 *
 * WHAT THIS DELIBERATELY IS NOT
 * -----------------------------
 * There is no rating, no price, no charge, no invoice and no tax here. A meter
 * event carries a quantity and a unit, never money. Rating is a later step and
 * must not be smuggled in — a ledger that already decided what something costs
 * cannot be re-rated when the price changes, and cannot be replayed to answer
 * "what would this have cost under last quarter's contract".
 *
 * THE ONE DELIBERATE EXCEPTION TO FAIL-CLOSED (ADR 0009)
 * ------------------------------------------------------
 * Everything else in LoanOS fails closed: an error lands on the restrictive
 * outcome (INV-5). Metering is the documented exception, and it is inverted on
 * purpose. INV-5 governs LENDING DECISIONS — a decision that cannot be
 * evidenced must land on `refer`/`deny`, because approving credit on unproven
 * evidence harms a borrower. Billing is not a lending decision. If metering
 * failed closed, an outage in our commercial plumbing would deny a real person
 * credit they qualify for, which is both a conduct failure and a regulatory
 * one.
 *
 * So: `recordMeterEvent` is strict and throws (it is the internal, correct-by
 * -construction path), while `captureMeterEvents` — the seam every caller on a
 * lending hot path actually uses — NEVER throws. It returns what it accepted
 * and what it rejected, and the caller carries on. Nothing is lost, because the
 * lifecycle's own transition history is the durable source of truth and
 * `replayMeterEventsFromLifecycles` rebuilds anything the meter missed.
 *
 * TENANT ISOLATION
 * ----------------
 * Meter events live in the tenant's own data plane (`state.meterEvents`), which
 * in Postgres is one RLS-forced row of `tenant_data`. Isolation is inherited by
 * construction — there is no new table and no new cross-tenant code path. The
 * chain root is additionally derived from `tenantId`, so a ledger cannot be
 * transplanted between tenants: replaying tenant A's events against tenant B's
 * genesis hash breaks at the very first link.
 *
 * IDEMPOTENCY
 * -----------
 * `meterEventId` is derived deterministically from
 * (tenantId, eventType, sourceRef) — never from the request. A retried
 * disbursement callback presents the same lifecycle transition ID, derives the
 * same meter event ID, and is deduplicated. This is the difference between
 * "we bill once" and "we bill once per network hiccup".
 */
import { createHash } from "node:crypto";

const GENESIS_PREFIX = "loanos-meter-genesis:";

/** Every event type the meter understands. Anything else is rejected. */
export const METER_EVENT_TYPES = Object.freeze([
  "meter.application.created",
  "meter.decision.evaluated",
  "meter.loan.disbursed",
  "meter.book.snapshot",
  "meter.provider.invoked",
  "meter.collection.event",
  "meter.agent.usage",
  "meter.storage.snapshot"
]);

/**
 * Types recorded for volume telemetry only — they exist so the funnel can be
 * measured, and must never become a billable line. Applications created is the
 * canonical example: metering revenue on it would mean charging a tenant for
 * junk leads, which they would (rightly) dispute on every invoice.
 */
export const TELEMETRY_ONLY_METER_EVENT_TYPES = Object.freeze([
  "meter.application.created"
]);

/**
 * The unit each event type is counted in. Fixing this per type stops two
 * callers metering the same thing in different units, which is the classic way
 * a usage ledger silently stops reconciling.
 */
export const METER_EVENT_UNITS = Object.freeze({
  "meter.application.created": "application",
  "meter.decision.evaluated": "decision",
  "meter.loan.disbursed": "loan",
  "meter.book.snapshot": "active_loan_month",
  "meter.provider.invoked": "provider_call",
  "meter.collection.event": "collection_event",
  "meter.agent.usage": "agent_action",
  "meter.storage.snapshot": "gb_month"
});

const TYPES = new Set(METER_EVENT_TYPES);
const TELEMETRY = new Set(TELEMETRY_ONLY_METER_EVENT_TYPES);

/** Quantities are held as exact scaled integers to this many decimal places. */
const QUANTITY_SCALE = 6;
const SCALE_FACTOR = 10n ** BigInt(QUANTITY_SCALE);

const fail = (code, message, statusCode = 422) => {
  throw Object.assign(new Error(message), { code, statusCode });
};

const text = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    fail("meter_input_invalid", `${field} is required.`);
  }
  return value.trim();
};

/**
 * Parse a quantity into an exact scaled BigInt. Accepts a number or a decimal
 * string; rejects negatives, NaN and anything unparseable. Quantities never go
 * through binary floating point in aggregate, because a ledger that drifts in
 * the sixth decimal place cannot be reconciled against a provider invoice.
 * @param {string|number} value
 * @param {string} field
 * @returns {bigint} the quantity scaled by 10^QUANTITY_SCALE.
 */
function scaleQuantity(value, field = "quantity") {
  const raw = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    fail("meter_quantity_invalid", `${field} must be a non-negative decimal.`);
  }
  const [whole, fraction = ""] = raw.split(".");
  if (fraction.length > QUANTITY_SCALE) {
    fail("meter_quantity_precision", `${field} supports at most ${QUANTITY_SCALE} decimal places.`);
  }
  return BigInt(whole) * SCALE_FACTOR + BigInt((fraction + "0".repeat(QUANTITY_SCALE)).slice(0, QUANTITY_SCALE));
}

/**
 * Render a scaled BigInt back to a canonical decimal string with trailing
 * zeros trimmed, so `1.500000` reads as `1.5` and `2.000000` as `2`.
 * @param {bigint} scaled
 * @returns {string}
 */
function unscaleQuantity(scaled) {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / SCALE_FACTOR;
  const fraction = (abs % SCALE_FACTOR).toString().padStart(QUANTITY_SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Deterministic serialization — recursively sorted keys — so a hash is stable
 * across load/save round-trips regardless of key insertion order. Correct only
 * for the plain-data shapes meter events contain (no Dates, Maps, class
 * instances); it is not general-purpose JSON canonicalization.
 * @param {*} value
 * @returns {string}
 */
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The meter ledger's chain root for a tenant — the `previousHash` of event 0.
 * Derived from `tenantId` so a chain is non-transplantable between tenants.
 * Uses a different prefix from the audit spine so the two chains cannot be
 * confused or spliced into one another.
 * @param {string|null|undefined} tenantId
 * @returns {string} hex sha256 digest.
 */
export function meterGenesisHash(tenantId) {
  return createHash("sha256").update(`${GENESIS_PREFIX}${tenantId ?? ""}`).digest("hex");
}

/**
 * The chain-link hash: covers the previous event's hash plus this event's own
 * fields. The event's own `hash` is excluded so this function serves both to
 * seal a new event and to re-derive an existing one during verification.
 * @param {object} event
 * @param {string} previousHash
 * @returns {string} hex sha256 digest.
 */
export function computeMeterHash(event, previousHash) {
  const { hash, ...rest } = event;
  return createHash("sha256").update(`${previousHash}\n${canonicalize(rest)}`).digest("hex");
}

/**
 * Derive a meter event's identity from its natural key. Two callers reporting
 * the same real-world consumption produce the same ID and deduplicate, which
 * is what makes a retried callback safe.
 *
 * `sourceRef` must be the identifier of the thing that actually happened — a
 * lifecycle transition ID, a provider call ID, a loan+period key — and NEVER a
 * request ID, a timestamp or a random value, all of which change on retry.
 * @param {string} tenantId
 * @param {string} eventType - one of `METER_EVENT_TYPES`.
 * @param {string} sourceRef - natural key of the underlying occurrence.
 * @returns {string} `mtr_<32 hex>`.
 */
export function meterEventId(tenantId, eventType, sourceRef) {
  const digest = createHash("sha256")
    .update(`${tenantId} ${eventType} ${sourceRef}`)
    .digest("hex");
  return `mtr_${digest.slice(0, 32)}`;
}

/**
 * Seal any not-yet-sealed events at the tail of the ledger. Already-sealed
 * events pass through untouched, so sealing is idempotent and safe to run over
 * the whole ledger on every write rather than tracking "new" events separately.
 *
 * Note this trusts a sealed prefix rather than re-verifying it: a ledger whose
 * history has been tampered with can still accept new events. That is
 * deliberate — detection belongs at read/verify time, and refusing to meter
 * because of historical corruption would reintroduce exactly the fail-closed
 * behaviour ADR 0009 rules out.
 * @param {Array<object>} events - full ordered event list for one tenant.
 * @param {string|null} tenantId - binds the chain root.
 * @returns {Array<object>} the full list, every event sealed.
 */
export function sealMeterLedger(events, tenantId) {
  const source = Array.isArray(events) ? events : [];
  const sealed = [];
  let previousHash = meterGenesisHash(tenantId);
  let sequence = 0;
  for (const event of source) {
    if (event.hash) {
      sealed.push(event);
      previousHash = event.hash;
      sequence = (typeof event.sequence === "number" ? event.sequence : sequence) + 1;
      continue;
    }
    const base = { ...event, sequence, previousHash };
    const finalized = { ...base, hash: computeMeterHash(base, previousHash) };
    sealed.push(finalized);
    previousHash = finalized.hash;
    sequence += 1;
  }
  return sealed;
}

/**
 * Walk the ledger from the tenant's genesis hash and confirm every event's
 * sequence, `previousHash` linkage and content hash are consistent. Stops at
 * the first break, since one broken link invalidates everything after it.
 * @param {Array<object>} events - ordered, presumed-sealed events.
 * @param {string|null} tenantId
 * @returns {{valid: boolean, brokenAt: number|null, reason: string|null, count: number, headHash: string}}
 */
export function verifyMeterLedger(events, tenantId) {
  const source = Array.isArray(events) ? events : [];
  let previousHash = meterGenesisHash(tenantId);
  for (let index = 0; index < source.length; index += 1) {
    const event = source[index];
    if (event.sequence !== index) {
      return { valid: false, brokenAt: index, reason: "sequence_mismatch", count: source.length, headHash: previousHash };
    }
    if (event.previousHash !== previousHash) {
      return { valid: false, brokenAt: index, reason: "chain_break", count: source.length, headHash: previousHash };
    }
    if (computeMeterHash(event, previousHash) !== event.hash) {
      return { valid: false, brokenAt: index, reason: "content_tampered", count: source.length, headHash: previousHash };
    }
    previousHash = event.hash;
  }
  return { valid: true, brokenAt: null, reason: null, count: source.length, headHash: previousHash };
}

const ledgerOf = (state) => (Array.isArray(state?.meterEvents) ? state.meterEvents : []);

/**
 * Record one meter event. STRICT — throws on anything malformed, unknown or
 * out of contract. This is the internal path; callers on a lending hot path
 * must use `captureMeterEvents` instead, which cannot throw.
 *
 * Idempotent: re-recording the same (tenantId, eventType, sourceRef) returns
 * the existing event and leaves the ledger untouched.
 * @param {object} state - tenant data plane.
 * @param {object} input - tenantId, eventType, sourceRef, quantity, plus optional
 *   providerKey, journeyType, lifecycleId, loanId, periodKey, occurredAt, actor, attributes.
 * @param {Date} [now]
 * @returns {{state: object, event: object, idempotent: boolean}}
 */
export function recordMeterEvent(state, input, now = new Date()) {
  const tenantId = text(input?.tenantId, "tenantId");
  const eventType = text(input?.eventType, "eventType");
  if (!TYPES.has(eventType)) fail("meter_event_type_unknown", `Unsupported meter event type: ${eventType}.`);
  const sourceRef = text(input?.sourceRef, "sourceRef");
  const scaled = scaleQuantity(input?.quantity ?? "1", "quantity");
  if (eventType === "meter.provider.invoked" && !input?.providerKey) {
    fail("meter_provider_key_required", "providerKey is required so provider usage can be reconciled to an invoice.");
  }

  const eventId = meterEventId(tenantId, eventType, sourceRef);
  const ledger = ledgerOf(state);
  const existing = ledger.find((event) => event.meterEventId === eventId);
  if (existing) return { state, event: existing, idempotent: true };

  const occurredAt = input?.occurredAt ?? now.toISOString();
  if (Number.isNaN(Date.parse(occurredAt))) fail("meter_occurred_at_invalid", "occurredAt must be an ISO timestamp.");

  const event = {
    meterEventId: eventId,
    tenantId,
    eventType,
    unit: METER_EVENT_UNITS[eventType],
    billable: !TELEMETRY.has(eventType),
    quantity: unscaleQuantity(scaled),
    sourceRef,
    providerKey: input?.providerKey ?? null,
    journeyType: input?.journeyType ?? null,
    lifecycleId: input?.lifecycleId ?? null,
    loanId: input?.loanId ?? null,
    periodKey: input?.periodKey ?? null,
    outcome: input?.outcome ?? "success",
    actor: input?.actor ?? null,
    attributes: input?.attributes ?? {},
    occurredAt,
    recordedAt: now.toISOString()
  };

  return {
    state: { ...state, meterEvents: sealMeterLedger([...ledger, event], tenantId) },
    event: { ...event },
    idempotent: false
  };
}

/**
 * Record many meter events WITHOUT EVER THROWING. This is the seam that any
 * caller on a lending hot path must use, and the mechanism by which ADR 0009's
 * fail-open guarantee is honoured: a malformed event, an unknown type, a
 * corrupt ledger or an outright bug is caught, reported in `rejected`, and the
 * caller continues. An origination, disbursement or collections contact is
 * never blocked by the meter.
 *
 * Rejected events are not lost work — the underlying occurrence is still
 * recorded by the lifecycle, and `replayMeterEventsFromLifecycles` reconstructs
 * anything missing.
 * @param {object} state
 * @param {Array<object>} inputs - meter event inputs; see `recordMeterEvent`.
 * @param {Date} [now]
 * @returns {{state: object, accepted: object[], rejected: Array<{input: object, code: string, message: string}>, idempotentCount: number}}
 */
export function captureMeterEvents(state, inputs, now = new Date()) {
  let next = state;
  const accepted = [];
  const rejected = [];
  let idempotentCount = 0;
  for (const input of Array.isArray(inputs) ? inputs : []) {
    try {
      const result = recordMeterEvent(next, input, now);
      next = result.state;
      if (result.idempotent) idempotentCount += 1;
      else accepted.push(result.event);
    } catch (cause) {
      rejected.push({
        input: input ?? null,
        code: cause?.code ?? "meter_capture_failed",
        message: cause?.message ?? "Meter capture failed."
      });
    }
  }
  return { state: next, accepted, rejected, idempotentCount };
}

/**
 * Map an approved composed-journey lifecycle transition to the meter events it
 * should produce. Pure — no state, no clock, no I/O — so the same transition
 * always derives the same events, which is what makes replay sound.
 *
 * Only two stage transitions are billable meters, and both are chosen because
 * they are governed lifecycle transitions carrying evidence and independent
 * approval, which makes a billing event auditable and hard for a tenant to
 * dispute:
 *   - entering `credit_decision`  -> the decision fee (real engine work,
 *     resistant to junk-lead gaming);
 *   - entering `disbursement`     -> the origination fee (value delivered).
 * Entering `application_capture` emits telemetry only.
 * @param {{tenantId: string, lifecycle?: object, transition?: object}} input
 * @returns {object[]} meter event inputs, possibly empty.
 */
export function deriveLifecycleMeterEvents({ tenantId, lifecycle, transition } = {}) {
  if (!tenantId || !transition || transition.status !== "approved" || transition.actionType !== "advance") return [];
  const stage = transition.targetStage;
  const common = {
    tenantId,
    sourceRef: transition.transitionId,
    lifecycleId: transition.lifecycleId ?? lifecycle?.lifecycleId ?? null,
    journeyType: lifecycle?.journeyType ?? lifecycle?.productType ?? null,
    quantity: "1",
    occurredAt: transition.approvedAt ?? null,
    actor: transition.approvedBy ?? null
  };
  if (stage === "credit_decision") return [{ ...common, eventType: "meter.decision.evaluated" }];
  if (stage === "disbursement") return [{ ...common, eventType: "meter.loan.disbursed" }];
  return [];
}

/**
 * Capture the meter events implied by an approved lifecycle transition. Never
 * throws — this is the function a route handler calls immediately after the
 * lifecycle advances, and its failure mode is "returns rejected entries", never
 * "unwinds the transition".
 * @param {object} state
 * @param {{tenantId: string, lifecycle?: object, transition?: object}} input
 * @param {Date} [now]
 * @returns {{state: object, accepted: object[], rejected: object[], idempotentCount: number}}
 */
export function captureLifecycleMeterEvents(state, input, now = new Date()) {
  let derived = [];
  try {
    derived = deriveLifecycleMeterEvents(input);
  } catch (cause) {
    return {
      state,
      accepted: [],
      rejected: [{ input: input ?? null, code: cause?.code ?? "meter_derivation_failed", message: cause?.message ?? "Derivation failed." }],
      idempotentCount: 0
    };
  }
  return captureMeterEvents(state, derived, now);
}

/**
 * Rebuild meter events from the lifecycles' own transition history — the
 * degradation path ADR 0009 depends on. Because `meterEventId` is derived from
 * the transition ID, replaying is naturally idempotent: events already present
 * are recognised and skipped, and only genuine gaps are filled.
 *
 * Run this after any suspected metering outage, and on a schedule as a
 * belt-and-braces reconciliation of the meter against the lifecycle.
 * @param {object} state
 * @param {{tenantId: string}} input
 * @param {Date} [now]
 * @returns {{state: object, recovered: object[], alreadyPresent: number, scannedTransitions: number, rejected: object[]}}
 */
export function replayMeterEventsFromLifecycles(state, input, now = new Date()) {
  const tenantId = text(input?.tenantId, "tenantId");
  const lifecycles = Object.values(state?.composedJourneyLifecycles ?? {}).filter((item) => item?.tenantId === tenantId);
  const derived = [];
  let scannedTransitions = 0;
  for (const lifecycle of lifecycles) {
    for (const entry of lifecycle.transitionHistory ?? []) {
      scannedTransitions += 1;
      derived.push(...deriveLifecycleMeterEvents({
        tenantId,
        lifecycle,
        transition: {
          transitionId: entry.transitionId,
          lifecycleId: lifecycle.lifecycleId,
          status: "approved",
          actionType: entry.actionType ?? "advance",
          targetStage: entry.targetStage,
          approvedAt: entry.approvedAt ?? entry.at ?? null,
          approvedBy: entry.approvedBy ?? null
        }
      }));
    }
  }
  const result = captureMeterEvents(state, derived, now);
  return {
    state: result.state,
    recovered: result.accepted,
    alreadyPresent: result.idempotentCount,
    scannedTransitions,
    rejected: result.rejected
  };
}

/**
 * Read model over the ledger: filter, total by type, and report chain validity.
 * Totals are computed on exact scaled integers, never floats, so they can be
 * held against a provider invoice without rounding argument.
 * @param {object} state
 * @param {{tenantId: string, eventType?: string, providerKey?: string, from?: string, to?: string}} input
 * @returns {{tenantId: string, count: number, totalsByType: object, events: object[], integrity: object}}
 */
export function projectMeterLedger(state, input) {
  const tenantId = text(input?.tenantId, "tenantId");
  const ledger = ledgerOf(state).filter((event) => event.tenantId === tenantId);
  const from = input?.from ? Date.parse(input.from) : null;
  const to = input?.to ? Date.parse(input.to) : null;
  const events = ledger.filter((event) => {
    if (input?.eventType && event.eventType !== input.eventType) return false;
    if (input?.providerKey && event.providerKey !== input.providerKey) return false;
    const at = Date.parse(event.occurredAt);
    if (from !== null && at < from) return false;
    if (to !== null && at >= to) return false;
    return true;
  });
  const totals = new Map();
  for (const event of events) {
    totals.set(event.eventType, (totals.get(event.eventType) ?? 0n) + scaleQuantity(event.quantity));
  }
  return {
    tenantId,
    count: events.length,
    totalsByType: Object.fromEntries([...totals].map(([type, scaled]) => [type, unscaleQuantity(scaled)])),
    events,
    integrity: verifyMeterLedger(ledger, tenantId)
  };
}

/**
 * Reconcile metered provider usage against what the provider actually
 * invoiced, for one provider and one period.
 *
 * A pass-through line we cannot reconcile is a line we cannot defend in a
 * dispute, so the outcome is explicit rather than implied: variance beyond the
 * declared threshold produces `exception`, which is an operational item
 * somebody has to clear — not a rounding note buried in a report.
 *
 * Variance is expressed in basis points of the invoiced quantity so the
 * threshold reads the same way the commercial process states it (±2% = 200 bps).
 * @param {object} state
 * @param {object} input - reconciliationId, tenantId, providerKey, periodFrom, periodTo,
 *   invoicedQuantity, varianceThresholdBasisPoints (default 200), openedBy.
 * @param {Date} [now]
 * @returns {{state: object, reconciliation: object}}
 */
export function reconcileProviderUsage(state, input, now = new Date()) {
  const reconciliationId = text(input?.reconciliationId, "reconciliationId");
  const tenantId = text(input?.tenantId, "tenantId");
  const providerKey = text(input?.providerKey, "providerKey");
  const periodFrom = text(input?.periodFrom, "periodFrom");
  const periodTo = text(input?.periodTo, "periodTo");
  if (Number.isNaN(Date.parse(periodFrom)) || Number.isNaN(Date.parse(periodTo))) {
    fail("meter_period_invalid", "periodFrom and periodTo must be ISO timestamps.");
  }
  if (Date.parse(periodTo) <= Date.parse(periodFrom)) {
    fail("meter_period_invalid", "periodTo must be after periodFrom.");
  }
  const openedBy = text(input?.openedBy, "openedBy");
  const invoiced = scaleQuantity(input?.invoicedQuantity, "invoicedQuantity");
  const thresholdBps = Number.isFinite(input?.varianceThresholdBasisPoints)
    ? Number(input.varianceThresholdBasisPoints)
    : 200;
  if (thresholdBps < 0) fail("meter_threshold_invalid", "varianceThresholdBasisPoints must be non-negative.");

  const existing = state?.meterReconciliations?.[reconciliationId];
  if (existing) fail("meter_reconciliation_exists", "Reconciliation already exists.", 409);

  const projection = projectMeterLedger(state, {
    tenantId,
    eventType: "meter.provider.invoked",
    providerKey,
    from: periodFrom,
    to: periodTo
  });
  const metered = scaleQuantity(projection.totalsByType["meter.provider.invoked"] ?? "0");
  const deltaScaled = metered - invoiced;
  const absDelta = deltaScaled < 0n ? -deltaScaled : deltaScaled;
  // Basis points of the invoiced quantity. An invoice for zero units with any
  // metered usage at all is an unbounded variance, so it is always an exception.
  const varianceBps = invoiced === 0n
    ? (absDelta === 0n ? 0 : Number.POSITIVE_INFINITY)
    : Number((absDelta * 10000n) / invoiced);
  const status = varianceBps > thresholdBps ? "exception" : "reconciled";

  const immutable = {
    reconciliationId,
    tenantId,
    providerKey,
    periodFrom,
    periodTo,
    meteredQuantity: unscaleQuantity(metered),
    invoicedQuantity: unscaleQuantity(invoiced),
    varianceQuantity: `${deltaScaled < 0n ? "-" : ""}${unscaleQuantity(absDelta)}`,
    varianceBasisPoints: Number.isFinite(varianceBps) ? varianceBps : null,
    varianceThresholdBasisPoints: thresholdBps,
    meteredEventCount: projection.count,
    ledgerIntegrity: projection.integrity.valid ? "valid" : projection.integrity.reason,
    status,
    openedBy,
    openedAt: now.toISOString()
  };
  const reconciliation = {
    ...immutable,
    evidenceChecksumSha256: createHash("sha256").update(canonicalize(immutable)).digest("hex")
  };
  return {
    state: { ...state, meterReconciliations: { ...(state?.meterReconciliations ?? {}), [reconciliationId]: reconciliation } },
    reconciliation
  };
}

/**
 * Read model over reconciliations, newest first, with the open exception count
 * surfaced so a monthly close can be gated on it.
 * @param {object} state
 * @param {{tenantId: string}} input
 * @returns {{tenantId: string, count: number, exceptionCount: number, reconciliations: object[]}}
 */
export function projectMeterReconciliations(state, input) {
  const tenantId = text(input?.tenantId, "tenantId");
  const all = Object.values(state?.meterReconciliations ?? {})
    .filter((item) => item.tenantId === tenantId)
    .sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)));
  return {
    tenantId,
    count: all.length,
    exceptionCount: all.filter((item) => item.status === "exception").length,
    reconciliations: all
  };
}
