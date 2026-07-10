import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";

// Account Aggregator (AA) — RBI Master Direction on NBFC-Account Aggregator
// (2016) and the AA ecosystem (Sahamati). An AA mediates consent-based sharing
// of a customer's financial information from a Financial Information Provider
// (FIP — the customer's bank/depository) to a Financial Information User (FIU —
// here, the lending RE). The consent artefact is the governing object.
//
// Hard rules the platform enforces:
// - A consent carries an explicit purpose, the FI types requested, a data range,
//   a fetch type (one-time vs periodic), a consent expiry, and a data-life for
//   how long the FIU may retain the data.
// - Data must be India-resident (RBI data residency + the AA framework).
// - Data can only be fetched while the consent is active and unexpired, a
//   one-time consent can be used once, and a periodic consent is rate-limited by
//   its declared frequency.
// - Fetched FI data is never stored raw here — only a masked, hashed evidence
//   record. The live FIP fetch is a mocked integration boundary.

export const AA_CONSENT_STATUSES = {
  REQUESTED: "requested",
  ACTIVE: "active",
  PAUSED: "paused",
  REVOKED: "revoked",
  EXPIRED: "expired"
};

export const AA_FETCH_TYPES = {
  ONETIME: "onetime",
  PERIODIC: "periodic"
};

export const AA_CONSENT_MODES = {
  VIEW: "view",
  STORE: "store",
  QUERY: "query",
  STREAM: "stream"
};

export const AA_FI_TYPES = new Set([
  "deposit",
  "term_deposit",
  "recurring_deposit",
  "credit_card",
  "mutual_funds",
  "sip",
  "equities",
  "bonds",
  "gst_returns",
  "insurance_policies"
]);

const VALID_FETCH_TYPES = new Set(Object.values(AA_FETCH_TYPES));
const VALID_MODES = new Set(Object.values(AA_CONSENT_MODES));
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function validateAccountAggregatorConsent(consent, context = {}) {
  const { borrowerProfiles = {} } = context;
  const findings = [];

  if (!consent?.consentId) {
    findings.push(createFinding("error", "DPDP-2023", "consentId is required.", "consentId"));
  }
  if (!consent?.borrowerId) {
    findings.push(createFinding("error", "DPDP-2023", "borrowerId is required.", "borrowerId"));
  } else if (!borrowerProfiles[consent.borrowerId]) {
    findings.push(createFinding("error", "DPDP-2023", "AA consent must reference an existing borrower.", "borrowerId"));
  }
  if (!consent?.purposeCode || !consent?.purposeText) {
    findings.push(createFinding("error", "DPDP-2023", "A purpose (code and text) is required for an AA consent.", "purpose"));
  }
  if (!Array.isArray(consent?.fiTypes) || consent.fiTypes.length === 0) {
    findings.push(createFinding("error", "DPDP-2023", "At least one FI type is required.", "fiTypes"));
  } else {
    const unknown = consent.fiTypes.filter((t) => !AA_FI_TYPES.has(t));
    if (unknown.length) {
      findings.push(createFinding("error", "DPDP-2023", `Unsupported FI types: ${unknown.join(", ")}.`, "fiTypes"));
    }
  }
  if (!VALID_FETCH_TYPES.has(consent?.fetchType)) {
    findings.push(createFinding("error", "DPDP-2023", `fetchType must be one of: ${[...VALID_FETCH_TYPES].join(", ")}.`, "fetchType"));
  }
  if (consent?.fetchType === AA_FETCH_TYPES.PERIODIC) {
    const freq = Number(consent?.frequencyPerDay);
    if (!Number.isFinite(freq) || freq <= 0) {
      findings.push(createFinding("error", "DPDP-2023", "A periodic consent requires a positive frequencyPerDay.", "frequencyPerDay"));
    }
  }
  if (consent?.consentMode && !VALID_MODES.has(consent.consentMode)) {
    findings.push(createFinding("error", "DPDP-2023", `consentMode must be one of: ${[...VALID_MODES].join(", ")}.`, "consentMode"));
  }
  if ((consent?.dataResidency ?? "IN") !== "IN") {
    findings.push(createFinding("error", "RBI-DATA-RESIDENCY", "AA financial data must be India-resident.", "dataResidency"));
  }

  const start = consent?.consentStart ? new Date(consent.consentStart) : null;
  const expiry = consent?.consentExpiry ? new Date(consent.consentExpiry) : null;
  if (!expiry || Number.isNaN(expiry.getTime())) {
    findings.push(createFinding("error", "DPDP-2023", "consentExpiry is required.", "consentExpiry"));
  } else if (start && !Number.isNaN(start.getTime()) && expiry <= start) {
    findings.push(createFinding("error", "DPDP-2023", "consentExpiry must be after consentStart.", "consentExpiry"));
  }
  const dataLifeDays = Number(consent?.dataLifeDays);
  if (!Number.isFinite(dataLifeDays) || dataLifeDays <= 0) {
    findings.push(createFinding("error", "DPDP-2023", "dataLifeDays (retention period the FIU may hold the data) is required.", "dataLifeDays"));
  }

  return { findings, summary: summarizeFindings(findings) };
}

export function normalizeAccountAggregatorConsent(input, existing = {}, now = new Date()) {
  return {
    consentId: input.consentId ?? existing.consentId,
    borrowerId: input.borrowerId ?? existing.borrowerId ?? null,
    aaHandle: input.aaHandle ?? existing.aaHandle ?? null,
    purposeCode: input.purposeCode ?? existing.purposeCode ?? null,
    purposeText: input.purposeText ?? existing.purposeText ?? null,
    fiTypes: input.fiTypes ?? existing.fiTypes ?? [],
    consentMode: input.consentMode ?? existing.consentMode ?? AA_CONSENT_MODES.VIEW,
    fetchType: input.fetchType ?? existing.fetchType ?? AA_FETCH_TYPES.ONETIME,
    frequencyPerDay: input.frequencyPerDay ?? existing.frequencyPerDay ?? null,
    dataRangeFrom: input.dataRangeFrom ?? existing.dataRangeFrom ?? null,
    dataRangeTo: input.dataRangeTo ?? existing.dataRangeTo ?? null,
    consentStart: input.consentStart ?? existing.consentStart ?? now.toISOString(),
    consentExpiry: input.consentExpiry ?? existing.consentExpiry ?? null,
    dataLifeDays: input.dataLifeDays ?? existing.dataLifeDays ?? null,
    dataResidency: input.dataResidency ?? existing.dataResidency ?? "IN",
    status: existing.status ?? AA_CONSENT_STATUSES.REQUESTED,
    aaConsentHandle: existing.aaConsentHandle ?? null,
    approvedAt: existing.approvedAt ?? null,
    revokedAt: existing.revokedAt ?? null,
    fetches: existing.fetches ?? [],
    createdAt: existing.createdAt ?? input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function createAccountAggregatorConsent(registry, input, context = {}, now = new Date()) {
  const consent = normalizeAccountAggregatorConsent(input, {}, now);
  const validation = validateAccountAggregatorConsent(consent, context);
  const nextRegistry =
    validation.summary.status === "blocked"
      ? registry ?? {}
      : { ...(registry ?? {}), [consent.consentId]: consent };
  return { registry: nextRegistry, consent, findings: validation.findings, summary: validation.summary };
}

// Borrower approves the consent at the AA — requested → active.
export function approveAccountAggregatorConsent(consent, input = {}, now = new Date()) {
  const findings = [];
  if (!consent) {
    findings.push(createFinding("error", "DPDP-2023", "AA consent not found.", "consentId"));
    return { consent, findings, summary: summarizeFindings(findings) };
  }
  if (consent.status !== AA_CONSENT_STATUSES.REQUESTED) {
    findings.push(createFinding("error", "DPDP-2023", "Only a requested consent can be approved.", "status"));
  }
  if (!input.aaConsentHandle) {
    findings.push(createFinding("error", "DPDP-2023", "aaConsentHandle from the AA is required to activate the consent.", "aaConsentHandle"));
  }
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { consent, findings, summary };
  }
  const next = {
    ...consent,
    status: AA_CONSENT_STATUSES.ACTIVE,
    aaConsentHandle: input.aaConsentHandle,
    approvedAt: (input.approvedAt ? new Date(input.approvedAt) : now).toISOString(),
    updatedAt: now.toISOString()
  };
  return { consent: next, findings, summary };
}

export function revokeAccountAggregatorConsent(consent, input = {}, now = new Date()) {
  const findings = [];
  if (!consent) {
    findings.push(createFinding("error", "DPDP-2023", "AA consent not found.", "consentId"));
    return { consent, findings, summary: summarizeFindings(findings) };
  }
  if ([AA_CONSENT_STATUSES.REVOKED, AA_CONSENT_STATUSES.EXPIRED].includes(consent.status)) {
    findings.push(createFinding("error", "DPDP-2023", "Consent is already revoked or expired.", "status"));
  }
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { consent, findings, summary };
  }
  const next = {
    ...consent,
    status: AA_CONSENT_STATUSES.REVOKED,
    revokedAt: now.toISOString(),
    revocationReason: input.reason ?? null,
    updatedAt: now.toISOString()
  };
  return { consent: next, findings, summary };
}

function effectiveConsentStatus(consent, asOf) {
  if (consent.status !== AA_CONSENT_STATUSES.ACTIVE) return consent.status;
  const expiry = consent.consentExpiry ? new Date(consent.consentExpiry) : null;
  if (expiry && !Number.isNaN(expiry.getTime()) && asOf > expiry) return AA_CONSENT_STATUSES.EXPIRED;
  return AA_CONSENT_STATUSES.ACTIVE;
}

// Fetch FI data under an active consent. Enforces validity, one-time single use,
// and periodic per-day frequency. Returns a masked/hashed evidence record — the
// live FIP pull is a mocked integration boundary.
export function fetchAccountAggregatorData(consent, input = {}, now = new Date()) {
  const findings = [];
  if (!consent) {
    findings.push(createFinding("error", "DPDP-2023", "AA consent not found.", "consentId"));
    return { consent, findings, summary: summarizeFindings(findings) };
  }
  const asOf = input.asOf ? new Date(input.asOf) : now;
  const status = effectiveConsentStatus(consent, asOf);
  if (status !== AA_CONSENT_STATUSES.ACTIVE) {
    findings.push(createFinding("error", "DPDP-2023", `Cannot fetch: consent is ${status}.`, "status"));
  }
  const priorFetches = consent.fetches ?? [];
  if (consent.fetchType === AA_FETCH_TYPES.ONETIME && priorFetches.length >= 1) {
    findings.push(createFinding("error", "DPDP-2023", "A one-time consent has already been used to fetch data.", "fetchType"));
  }
  if (consent.fetchType === AA_FETCH_TYPES.PERIODIC) {
    const windowStart = asOf.getTime() - MS_PER_DAY;
    const fetchesToday = priorFetches.filter((f) => new Date(f.fetchedAt).getTime() >= windowStart).length;
    if (fetchesToday >= Number(consent.frequencyPerDay)) {
      findings.push(createFinding("error", "DPDP-2023", "Periodic fetch frequency exceeded for the current 24h window.", "frequencyPerDay"));
    }
  }
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { consent, findings, summary };
  }

  // Mocked FIP payload — never persisted raw; only a hashed reference is kept.
  const mockPayload = JSON.stringify({
    consentId: consent.consentId,
    fiTypes: consent.fiTypes,
    fetchedAt: asOf.toISOString(),
    nonce: input.nonce ?? `${asOf.getTime()}`
  });
  const dataHash = createHash("sha256").update(mockPayload).digest("hex");
  const fetch = {
    fetchId: input.fetchId ?? `aafetch_${priorFetches.length + 1}`,
    fetchedAt: asOf.toISOString(),
    fiTypes: consent.fiTypes,
    dataResidency: consent.dataResidency,
    dataHash,
    recordCount: input.recordCount ?? consent.fiTypes.length,
    provider: input.provider ?? "mock_aa"
  };
  const fetches = [...priorFetches, fetch];
  const next = { ...consent, fetches, updatedAt: asOf.toISOString() };
  return { consent: next, fetch, findings, summary };
}
