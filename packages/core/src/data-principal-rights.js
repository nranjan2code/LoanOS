import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";

// DPDP Act 2023 gives data principals (borrowers) the right to access their
// personal data held by the fiduciary and the right to correct inaccurate data.
// This module implements both workflows with a 30-day SLA as required by the
// DPDP Act and Rules.

export const ACCESS_REQUEST_STATUSES = {
  REQUESTED: "requested",
  FULFILLED: "fulfilled",
  CLOSED: "closed"
};

export const CORRECTION_REQUEST_STATUSES = {
  REQUESTED: "requested",
  APPLIED: "applied",
  REJECTED: "rejected"
};

const ACCESS_TERMINAL = new Set([ACCESS_REQUEST_STATUSES.FULFILLED, ACCESS_REQUEST_STATUSES.CLOSED]);
const CORRECTION_TERMINAL = new Set([CORRECTION_REQUEST_STATUSES.APPLIED, CORRECTION_REQUEST_STATUSES.REJECTED]);
const SLA_DAYS = 30;

// --- Access request workflow ---

export function createAccessRequest(registry = {}, input = {}, context = {}, now = new Date()) {
  const request = normalizeAccessRequest(input, {}, now);
  const findings = [];

  if (!request.borrowerId) {
    findings.push(createFinding("error", "DPDP-2023", "Access request requires a borrowerId.", "borrowerId"));
  }
  if (!request.requestedBy) {
    findings.push(createFinding("error", "DPDP-2023", "Access request requires requestedBy.", "requestedBy"));
  }
  if (request.borrowerId && context.borrowerProfiles && !context.borrowerProfiles[request.borrowerId]) {
    findings.push(createFinding("error", "DPDP-2023", "Access request borrower is not registered.", "borrowerId"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { registry, request, findings, summary };
  }

  const event = dpdpEvent("data_principal.access_request.created", {
    actor: request.requestedBy,
    borrowerId: request.borrowerId
  }, now);
  const stored = { ...request, events: [event], updatedAt: now.toISOString() };

  return {
    registry: { ...registry, [stored.accessRequestId]: stored },
    request: enrichAccessRequest(stored, context, now),
    event,
    findings: [],
    summary: summarizeFindings([])
  };
}

export function fulfillAccessRequest(request, input = {}, context = {}, now = new Date()) {
  const findings = validateAccessAction(request);
  if (!input.actor) {
    findings.push(createFinding("error", "DPDP-2023", "Access fulfilment requires an actor.", "actor"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedAccessResult(request, findings, context, now);
  }

  // Assemble the portable data pack from context
  const dataPack = assembleDataPack(request.borrowerId, context);

  const event = dpdpEvent("data_principal.access_request.fulfilled", {
    actor: input.actor,
    borrowerId: request.borrowerId,
    dataPackSections: Object.keys(dataPack)
  }, now);
  const updated = {
    ...request,
    status: ACCESS_REQUEST_STATUSES.FULFILLED,
    fulfilledAt: now.toISOString(),
    fulfilledBy: input.actor,
    dataPack,
    events: [...(request.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyAccessResult(updated, event, context, now);
}

export function enrichAccessRequest(request, context = {}, now = new Date()) {
  if (!request) return null;
  const enriched = { ...request };

  // SLA computation
  const requestedAt = new Date(request.requestedAt ?? request.createdAt);
  const slaDeadline = new Date(requestedAt);
  slaDeadline.setUTCDate(slaDeadline.getUTCDate() + SLA_DAYS);
  enriched.slaDeadline = slaDeadline.toISOString();
  enriched.slaOverdue = !ACCESS_TERMINAL.has(request.status) && now.getTime() > slaDeadline.getTime();
  enriched.slaDaysRemaining = ACCESS_TERMINAL.has(request.status)
    ? 0
    : Math.max(0, Math.ceil((slaDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  return enriched;
}

// --- Correction request workflow ---

export function createCorrectionRequest(registry = {}, input = {}, context = {}, now = new Date()) {
  const request = normalizeCorrectionRequest(input, {}, now);
  const findings = [];

  if (!request.borrowerId) {
    findings.push(createFinding("error", "DPDP-2023", "Correction request requires a borrowerId.", "borrowerId"));
  }
  if (!request.requestedBy) {
    findings.push(createFinding("error", "DPDP-2023", "Correction request requires requestedBy.", "requestedBy"));
  }
  if (!request.fieldPath) {
    findings.push(createFinding("error", "DPDP-2023", "Correction request requires fieldPath.", "fieldPath"));
  }
  if (request.proposedValue === undefined || request.proposedValue === null) {
    findings.push(createFinding("error", "DPDP-2023", "Correction request requires proposedValue.", "proposedValue"));
  }
  if (request.borrowerId && context.borrowerProfiles && !context.borrowerProfiles[request.borrowerId]) {
    findings.push(createFinding("error", "DPDP-2023", "Correction request borrower is not registered.", "borrowerId"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { registry, request, findings, summary };
  }

  // Capture current value from borrower profile
  const borrower = context.borrowerProfiles ? context.borrowerProfiles[request.borrowerId] : null;
  const currentValue = borrower ? resolveFieldPath(borrower, request.fieldPath) : null;

  const event = dpdpEvent("data_principal.correction_request.created", {
    actor: request.requestedBy,
    borrowerId: request.borrowerId,
    fieldPath: request.fieldPath
  }, now);
  const stored = {
    ...request,
    currentValue: currentValue ?? request.currentValue,
    events: [event],
    updatedAt: now.toISOString()
  };

  return {
    registry: { ...registry, [stored.correctionRequestId]: stored },
    request: enrichCorrectionRequest(stored, now),
    event,
    findings: [],
    summary: summarizeFindings([])
  };
}

export function reviewCorrectionRequest(request, input = {}, context = {}, now = new Date()) {
  const findings = validateCorrectionAction(request);
  if (!input.actor) {
    findings.push(createFinding("error", "DPDP-2023", "Correction review requires an actor.", "actor"));
  }
  if (!input.outcome || !new Set(["applied", "rejected"]).has(input.outcome)) {
    findings.push(createFinding("error", "DPDP-2023", "Correction review requires outcome (applied or rejected).", "outcome"));
  }
  if (input.outcome === "rejected" && !input.reason) {
    findings.push(createFinding("error", "DPDP-2023", "Rejection requires a reason.", "reason"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedCorrectionResult(request, findings, now);
  }

  const newStatus = input.outcome === "applied"
    ? CORRECTION_REQUEST_STATUSES.APPLIED
    : CORRECTION_REQUEST_STATUSES.REJECTED;

  const event = dpdpEvent(`data_principal.correction_request.${input.outcome}`, {
    actor: input.actor,
    borrowerId: request.borrowerId,
    fieldPath: request.fieldPath,
    outcome: input.outcome,
    reason: input.reason ?? null
  }, now);

  const updated = {
    ...request,
    status: newStatus,
    decision: {
      outcome: input.outcome,
      actor: input.actor,
      reason: input.reason ?? null,
      decidedAt: now.toISOString()
    },
    events: [...(request.events ?? []), event],
    updatedAt: now.toISOString()
  };

  // If applied, also return the field update instruction for the caller to
  // apply to the borrower profile.
  const profileUpdate = input.outcome === "applied"
    ? { borrowerId: request.borrowerId, fieldPath: request.fieldPath, newValue: request.proposedValue }
    : null;

  return { request: enrichCorrectionRequest(updated, now), event, profileUpdate, findings: [], summary: summarizeFindings([]) };
}

export function enrichCorrectionRequest(request, now = new Date()) {
  if (!request) return null;
  const enriched = { ...request };

  const requestedAt = new Date(request.requestedAt ?? request.createdAt);
  const slaDeadline = new Date(requestedAt);
  slaDeadline.setUTCDate(slaDeadline.getUTCDate() + SLA_DAYS);
  enriched.slaDeadline = slaDeadline.toISOString();
  enriched.slaOverdue = !CORRECTION_TERMINAL.has(request.status) && now.getTime() > slaDeadline.getTime();
  enriched.slaDaysRemaining = CORRECTION_TERMINAL.has(request.status)
    ? 0
    : Math.max(0, Math.ceil((slaDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  return enriched;
}

// --- Data pack assembly ---

function assembleDataPack(borrowerId, context) {
  const pack = {};

  // Borrower profile (redacted fields omitted)
  const profile = context.borrowerProfiles ? context.borrowerProfiles[borrowerId] : null;
  if (profile) {
    pack.borrowerProfile = {
      borrowerId: profile.borrowerId,
      fullName: profile.fullName,
      borrowerType: profile.borrowerType,
      dateOfBirth: profile.dateOfBirth,
      contactEmail: profile.contactEmail,
      contactPhone: profile.contactPhone,
      address: profile.address,
      country: profile.country,
      occupation: profile.occupation,
      redacted: profile.redacted ?? false
    };
  }

  // Consent records
  const consents = Object.values(context.consentRecords ?? {}).filter(
    (c) => c.borrowerId === borrowerId
  );
  if (consents.length > 0) {
    pack.consentRecords = consents.map((c) => ({
      consentId: c.consentId,
      purpose: c.purpose,
      status: c.status,
      acceptedAt: c.acceptedAt,
      revokedAt: c.revokedAt
    }));
  }

  // KYC records (summary only — no raw Aadhaar/biometric data)
  const kycRecords = Object.values(context.kycRecords ?? {}).filter(
    (k) => k.borrowerId === borrowerId
  );
  if (kycRecords.length > 0) {
    pack.kycRecords = kycRecords.map((k) => ({
      kycRecordId: k.kycRecordId,
      documentType: k.documentType,
      status: k.status,
      verifiedAt: k.verifiedAt,
      expiresAt: k.expiresAt
    }));
  }

  // Loan accounts
  const accounts = Object.values(context.loanAccounts ?? {}).filter(
    (a) => a.borrowerId === borrowerId
  );
  if (accounts.length > 0) {
    pack.loanAccounts = accounts.map((a) => ({
      loanAccountId: a.loanAccountId,
      status: a.status,
      principalInr: a.principalInr,
      openedAt: a.openedAt,
      closedAt: a.closedAt
    }));
  }

  // Data disclosures (stored as an array or a keyed map depending on caller)
  const disclosureList = Array.isArray(context.dataDisclosures)
    ? context.dataDisclosures
    : Object.values(context.dataDisclosures ?? {});
  const disclosures = disclosureList.filter((d) => d.borrowerId === borrowerId);
  if (disclosures.length > 0) {
    pack.dataDisclosures = disclosures.map((d) => ({
      disclosureId: d.disclosureId,
      recipientName: d.recipientName,
      purpose: d.purpose,
      legalBasis: d.legalBasis,
      disclosedAt: d.disclosedAt
    }));
  }

  pack.generatedAt = new Date().toISOString();
  return pack;
}

// --- Internal helpers ---

function normalizeAccessRequest(input, existing = {}, now = new Date()) {
  return {
    ...existing,
    accessRequestId: input.accessRequestId ?? existing.accessRequestId ?? createLoanId("access"),
    borrowerId: input.borrowerId ?? existing.borrowerId ?? null,
    status: existing.status ?? ACCESS_REQUEST_STATUSES.REQUESTED,
    requestedBy: input.requestedBy ?? existing.requestedBy ?? null,
    requestChannel: input.requestChannel ?? existing.requestChannel ?? null,
    requestedAt: (normalizeDate(input.requestedAt) ?? normalizeDate(existing.requestedAt) ?? now).toISOString(),
    dataPack: existing.dataPack ?? null,
    events: Array.isArray(existing.events) ? existing.events : [],
    createdAt: existing.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function normalizeCorrectionRequest(input, existing = {}, now = new Date()) {
  return {
    ...existing,
    correctionRequestId: input.correctionRequestId ?? existing.correctionRequestId ?? createLoanId("correct"),
    borrowerId: input.borrowerId ?? existing.borrowerId ?? null,
    status: existing.status ?? CORRECTION_REQUEST_STATUSES.REQUESTED,
    fieldPath: input.fieldPath ?? existing.fieldPath ?? null,
    currentValue: input.currentValue ?? existing.currentValue ?? null,
    proposedValue: input.proposedValue !== undefined ? input.proposedValue : (existing.proposedValue ?? null),
    requestedBy: input.requestedBy ?? existing.requestedBy ?? null,
    requestChannel: input.requestChannel ?? existing.requestChannel ?? null,
    requestedAt: (normalizeDate(input.requestedAt) ?? normalizeDate(existing.requestedAt) ?? now).toISOString(),
    decision: existing.decision ?? null,
    events: Array.isArray(existing.events) ? existing.events : [],
    createdAt: existing.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function validateAccessAction(request) {
  const findings = [];
  if (!request) {
    findings.push(createFinding("error", "DPDP-2023", "Access request is required.", "accessRequestId"));
  }
  if (request && ACCESS_TERMINAL.has(request.status)) {
    findings.push(createFinding("error", "DPDP-2023", "Access request is already decided.", "status"));
  }
  return findings;
}

function validateCorrectionAction(request) {
  const findings = [];
  if (!request) {
    findings.push(createFinding("error", "DPDP-2023", "Correction request is required.", "correctionRequestId"));
  }
  if (request && CORRECTION_TERMINAL.has(request.status)) {
    findings.push(createFinding("error", "DPDP-2023", "Correction request is already decided.", "status"));
  }
  return findings;
}

function readyAccessResult(request, event, context, now) {
  return { request: enrichAccessRequest(request, context, now), event, findings: [], summary: summarizeFindings([]) };
}

function blockedAccessResult(request, findings, context, now) {
  return { request: request ? enrichAccessRequest(request, context, now) : null, event: null, findings, summary: summarizeFindings(findings) };
}

function blockedCorrectionResult(request, findings, now) {
  return { request: request ? enrichCorrectionRequest(request, now) : null, event: null, profileUpdate: null, findings, summary: summarizeFindings(findings) };
}

function dpdpEvent(type, data, now) {
  return { eventId: createLoanId("dpdpevt"), type, at: now.toISOString(), ...data };
}

function resolveFieldPath(obj, path) {
  if (!obj || !path) return undefined;
  const keys = path.split(".");
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
