# ADR 0009 — Usage metering is fail-open

Status: accepted · Date: 2026-07-21

## Context

Every gating path in LoanOS fails closed. INV-5 is explicit: on error, the
decision engine and anything feeding it land on the restrictive outcome
(`refer`/`deny`), never a permissive default, and "service unreachable" counts
as an error. That rule is why the platform can be trusted with credit
decisions.

The tenant usage meter (`packages/core/src/platform/usage-metering.js`,
INT-ADM-08 / INT-PLT-12) records what a tenant consumed — decisions evaluated,
loans disbursed, provider calls made, collections attempted, storage retained —
so that consumption can later be rated and invoiced. It is emitted from the
same hot paths that originate, disburse and collect on loans.

That places a new component directly alongside lending execution, and forces
the question the platform has never had to answer before: **what should happen
to a borrower when the billing plumbing breaks?**

Applying INV-5 uniformly would answer "the lending action fails". A meter write
that could not complete would block the transition that triggered it. The
consequences are concrete:

- a borrower who qualifies for credit is denied it because our commercial
  infrastructure had an outage;
- a disbursement already approved by two humans cannot execute;
- a collections contact — which is time-bound and conduct-regulated — cannot be
  logged, so it does not happen.

None of those protect anybody. They convert an internal revenue-accounting
problem into borrower harm and a conduct exposure.

## Decision

**Usage metering is fail-open. It is the single documented exception to the
platform's fail-closed posture, and the exception is scoped precisely.**

1. **INV-5 governs lending decisions, not billing.** A decision that cannot be
   evidenced must still land on `refer`/`deny` — that is unchanged and not up
   for negotiation. Metering is not a lending decision, carries no borrower
   consequence, and is therefore outside INV-5's scope. This ADR does not
   weaken INV-5; it delimits it.

2. **Two seams, deliberately asymmetric.** `recordMeterEvent` is strict and
   throws — it is the internal, correct-by-construction path used by operator
   actions and tests. `captureMeterEvents` (and its lifecycle wrapper
   `captureLifecycleMeterEvents`) **never throws**: it returns what it accepted
   and what it rejected, and the caller proceeds. Any caller on a lending hot
   path must use the non-throwing seam. A meter call must never sit between a
   human approval and its effect.

3. **Nothing is lost, because the meter is not the system of record.** The
   composed-journey lifecycle's own transition history is durable and
   authoritative. `replayMeterEventsFromLifecycles` reconstructs meter events
   from it, and because `meterEventId` is derived from the transition ID rather
   than the request, replay is idempotent and converges with whatever the live
   meter did capture. A metering outage costs a replay, not revenue.

4. **Faults are loud, not silent.** A rejected capture is recorded on the audit
   event for the action (`meterRejectedCount`) and returned in the API response
   (HTTP 207 for a partially accepted batch). Fail-open means "does not block",
   not "does not report". Silent metering loss would be worse than blocking,
   because it is undetectable.

5. **A corrupt ledger does not stop metering either.** `sealMeterLedger` trusts
   an already-sealed prefix and appends. Chain verification is a read-time
   concern surfaced by `verifyMeterLedger` and stamped onto every reconciliation
   (`ledgerIntegrity`). Refusing to meter because of historical corruption would
   reintroduce exactly the behaviour this ADR rules out.

6. **The exception does not extend to reconciliation.** Provider reconciliation
   is an operator action with no borrower in the loop, so it fails closed in
   the ordinary way: an unreconcilable variance produces an `exception` status
   that somebody must clear, never a silent pass.

## Consequences

- Metering may be temporarily incomplete. Monthly close must run
  `replayMeterEventsFromLifecycles` and provider reconciliation before invoicing,
  and must treat a non-zero exception count as a blocker.
- Meter completeness is an operational property established by replay and
  reconciliation, not an invariant established by the write path. Anyone
  designing rating (step 2) must assume the ledger can be behind and must be
  re-runnable.
- `meterEventId` derivation is now load-bearing for correctness, not just for
  deduplication. Changing it silently breaks replay convergence, so it is
  covered by tests that assert live and replayed ledgers produce identical IDs.
- Future contributors will find a non-throwing function on a hot path and may
  read it as sloppy error handling. The header comment in
  `usage-metering.js` cites this ADR so the asymmetry reads as deliberate.

## Alternatives considered

**Fail closed like everything else.** Rejected: it makes a billing outage into a
credit denial. The uniformity is aesthetically attractive and substantively
wrong — the rule exists to protect borrowers, and applying it here harms them.

**Emit meter events synchronously but swallow all errors at the call site.**
Rejected: it puts the fail-open decision in every caller, where it will
eventually be omitted. Making the seam itself non-throwing means a caller cannot
get it wrong by forgetting.

**Write meter events to a separate store outside the tenant data plane.**
Rejected: it would create a second tenant-scoped persistence path with its own
isolation story. Keeping the ledger inside `tenant_data` inherits RLS and the
app-layer partition by construction, with no new cross-tenant code path.

**Derive billing entirely from the lifecycle at invoice time, with no meter.**
Rejected for provider calls, collections events, storage and agent usage, none
of which are lifecycle stage transitions. A meter is needed regardless, so the
lifecycle becomes the recovery path rather than the primary one.

## References

- INV-5 fail-closed — `docs/architecture/decision-engine-design.md`
- Implementation — `packages/core/src/platform/usage-metering.js`,
  `apps/api/src/routes/usage-metering.js`
- Tests — `tests/usage-metering.test.js`, `tests/usage-metering-route.test.js`
- Integration status — INT-ADM-08, INT-PLT-12 in
  `docs/architecture/platform-module-integration-api-map.md`
- Commercial rationale — `docs/commercial/tenant-pricing-and-cost-recovery.md` §6
