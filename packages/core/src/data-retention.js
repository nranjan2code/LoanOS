import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";

// DPDP 2023 gives the data principal a right to erasure, but the fiduciary must
// retain records it is legally required to keep. RBI KYC Master Direction and
// PMLA require KYC/transaction records to be retained for five years from the
// end of the business relationship. So an erasure request is honoured only once
// there is no active loan relationship and every closed account has passed its
// statutory retention window.

export const ERASURE_REQUEST_STATUSES = {
  REQUESTED: "requested",
  FULFILLED: "fulfilled",
  REJECTED: "rejected"
};

export const STATUTORY_RETENTION_YEARS = 5;
const CLOSED_STATUS = "closed";
const TERMINAL_STATUSES = new Set([
  ERASURE_REQUEST_STATUSES.FULFILLED,
  ERASURE_REQUEST_STATUSES.REJECTED
]);

export function createErasureRequest(registry = {}, input = {}, context = {}, now = new Date()) {
  const request = normalizeErasureRequest(input, {}, now);
  const findings = [];
  if (!request.borrowerId) {
    findings.push(createFinding("error", "DPDP-2023", "Erasure request requires a borrowerId.", "borrowerId"));
  }
  if (!request.requestedBy) {
    findings.push(createFinding("error", "DPDP-2023", "Erasure request requires requestedBy.", "requestedBy"));
  }
  if (request.borrowerId && context.borrowerProfiles && !context.borrowerProfiles[request.borrowerId]) {
    findings.push(createFinding("error", "DPDP-2023", "Erasure request borrower is not registered.", "borrowerId"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { registry, request, findings, summary };
  }

  const event = erasureEvent("data_erasure.requested", {
    actor: request.requestedBy,
    borrowerId: request.borrowerId,
    scope: request.scope
  }, now);
  const stored = { ...request, events: [event], updatedAt: now.toISOString() };

  return {
    registry: { ...registry, [stored.erasureRequestId]: stored },
    request: enrichErasureRequest(stored, context, now),
    event,
    findings: [],
    summary: summarizeFindings([])
  };
}

// Determine whether a borrower's data can be erased now, and if not, why and
// until when. Holds are additive; the request is only eligible when there are
// none.
export function assessErasureEligibility(borrowerId, context = {}, now = new Date()) {
  const accounts = Object.values(context.loanAccounts ?? {}).filter(
    (account) => account.borrowerId === borrowerId
  );
  const holds = [];
  let retainUntil = null;

  const activeAccounts = accounts.filter((account) => account.status !== CLOSED_STATUS);
  if (activeAccounts.length > 0) {
    holds.push({
      code: "active_loan_relationship",
      message: "Borrower has an active loan relationship; records cannot be erased.",
      accountIds: activeAccounts.map((account) => account.loanAccountId)
    });
  }

  for (const account of accounts) {
    if (account.status !== CLOSED_STATUS) {
      continue;
    }
    const closedAt = account.closedAt ?? account.openedAt ?? null;
    const accountRetainUntil = closedAt ? addYears(closedAt, STATUTORY_RETENTION_YEARS) : null;
    if (accountRetainUntil && new Date(accountRetainUntil).getTime() > now.getTime()) {
      holds.push({
        code: "statutory_retention",
        message: "Closed loan records are within the statutory retention period.",
        accountIds: [account.loanAccountId],
        retainUntil: accountRetainUntil
      });
      if (!retainUntil || new Date(accountRetainUntil).getTime() > new Date(retainUntil).getTime()) {
        retainUntil = accountRetainUntil;
      }
    }
  }

  return { eligible: holds.length === 0, holds, retainUntil };
}

export function enrichErasureRequest(request, context = {}, now = new Date()) {
  const eligibility =
    request.status === ERASURE_REQUEST_STATUSES.FULFILLED
      ? { eligible: true, holds: [], retainUntil: null }
      : assessErasureEligibility(request.borrowerId, context, now);
  return { ...request, eligibility };
}

export function fulfillErasureRequest(request, input = {}, context = {}, now = new Date()) {
  const findings = validateErasureAction(request);
  if (!input.actor) {
    findings.push(createFinding("error", "DPDP-2023", "Erasure fulfilment requires an actor.", "actor"));
  }
  if (!input.confirmationRef) {
    findings.push(createFinding("error", "DPDP-2023", "Erasure fulfilment requires a confirmationRef.", "confirmationRef"));
  }

  const eligibility = request ? assessErasureEligibility(request.borrowerId, context, now) : null;
  if (eligibility && !eligibility.eligible) {
    findings.push(
      createFinding(
        "error",
        "DPDP-2023",
        "Erasure is blocked by an active loan relationship or statutory retention.",
        "eligibility"
      )
    );
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedErasureResult(request, findings, context, now);
  }

  const event = erasureEvent("data_erasure.fulfilled", {
    actor: input.actor,
    borrowerId: request.borrowerId,
    confirmationRef: input.confirmationRef
  }, now);
  const updated = {
    ...request,
    status: ERASURE_REQUEST_STATUSES.FULFILLED,
    decision: {
      outcome: "fulfilled",
      actor: input.actor,
      confirmationRef: input.confirmationRef,
      decidedAt: now.toISOString()
    },
    events: [...(request.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyErasureResult(updated, event, context, now);
}

export function rejectErasureRequest(request, input = {}, context = {}, now = new Date()) {
  const findings = validateErasureAction(request);
  if (!input.actor) {
    findings.push(createFinding("error", "DPDP-2023", "Erasure rejection requires an actor.", "actor"));
  }
  if (!input.reason) {
    findings.push(createFinding("error", "DPDP-2023", "Erasure rejection requires a reason.", "reason"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedErasureResult(request, findings, context, now);
  }

  const event = erasureEvent("data_erasure.rejected", {
    actor: input.actor,
    borrowerId: request.borrowerId,
    reason: input.reason
  }, now);
  const updated = {
    ...request,
    status: ERASURE_REQUEST_STATUSES.REJECTED,
    decision: { outcome: "rejected", actor: input.actor, reason: input.reason, decidedAt: now.toISOString() },
    events: [...(request.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyErasureResult(updated, event, context, now);
}

function normalizeErasureRequest(input, existing = {}, now = new Date()) {
  return {
    ...existing,
    erasureRequestId: input.erasureRequestId ?? existing.erasureRequestId ?? createLoanId("erasure"),
    borrowerId: input.borrowerId ?? existing.borrowerId ?? null,
    status: input.status ?? existing.status ?? ERASURE_REQUEST_STATUSES.REQUESTED,
    scope: input.scope ?? existing.scope ?? "personal_data",
    reason: input.reason ?? existing.reason ?? null,
    requestedBy: input.requestedBy ?? existing.requestedBy ?? null,
    requestChannel: input.requestChannel ?? existing.requestChannel ?? null,
    requestedAt: (normalizeDate(input.requestedAt) ?? normalizeDate(existing.requestedAt) ?? now).toISOString(),
    decision: existing.decision ?? null,
    events: Array.isArray(existing.events) ? existing.events : [],
    createdAt: existing.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function validateErasureAction(request) {
  const findings = [];
  if (!request) {
    findings.push(createFinding("error", "DPDP-2023", "Erasure request is required.", "erasureRequestId"));
  }
  if (request && TERMINAL_STATUSES.has(request.status)) {
    findings.push(createFinding("error", "DPDP-2023", "Erasure request is already decided.", "status"));
  }
  return findings;
}

function readyErasureResult(request, event, context, now) {
  return { request: enrichErasureRequest(request, context, now), event, findings: [], summary: summarizeFindings([]) };
}

function blockedErasureResult(request, findings, context, now) {
  return {
    request: request ? enrichErasureRequest(request, context, now) : null,
    event: null,
    findings,
    summary: summarizeFindings(findings)
  };
}

function erasureEvent(type, event, now) {
  return { eventId: createLoanId("erasureevt"), type, at: now.toISOString(), ...event };
}

function addYears(value, years) {
  const date = new Date(value);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
