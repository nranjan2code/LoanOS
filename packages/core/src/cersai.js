import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";

// CERSAI (Central Registry of Securitisation Asset Reconstruction and Security
// Interest of India) registration is mandatory under the SARFAESI Act for
// secured loans. The RE must file the security interest within 30 days of
// creation and satisfy/release it on full repayment or closure.

export const SECURITY_INTEREST_STATUSES = {
  DRAFT: "draft",
  FILED: "filed",
  REGISTERED: "registered",
  MODIFIED: "modified",
  SATISFIED: "satisfied"
};

export const CHARGE_TYPES = {
  MORTGAGE: "mortgage",
  HYPOTHECATION: "hypothecation",
  PLEDGE: "pledge",
  ASSIGNMENT: "assignment"
};

export const ASSET_TYPES = {
  IMMOVABLE: "immovable",
  MOVABLE: "movable",
  INTANGIBLE: "intangible"
};

const VALID_CHARGE_TYPES = new Set(Object.values(CHARGE_TYPES));
const VALID_ASSET_TYPES = new Set(Object.values(ASSET_TYPES));
const FILING_DEADLINE_DAYS = 30;

// --- Security interest lifecycle ---

export function createSecurityInterest(registry = {}, input = {}, context = {}, now = new Date()) {
  const si = normalizeSecurityInterest(input, {}, now);
  const findings = [];

  if (!si.loanAccountId) {
    findings.push(createFinding("error", "SARFAESI", "Security interest requires a loanAccountId.", "loanAccountId"));
  }
  if (!si.assetType || !VALID_ASSET_TYPES.has(si.assetType)) {
    findings.push(createFinding("error", "SARFAESI", `Asset type must be one of: ${[...VALID_ASSET_TYPES].join(", ")}.`, "assetType"));
  }
  if (!si.chargeType || !VALID_CHARGE_TYPES.has(si.chargeType)) {
    findings.push(createFinding("error", "SARFAESI", `Charge type must be one of: ${[...VALID_CHARGE_TYPES].join(", ")}.`, "chargeType"));
  }
  if (!si.assetDescription) {
    findings.push(createFinding("error", "SARFAESI", "Security interest requires assetDescription.", "assetDescription"));
  }
  if (typeof si.chargeAmountInr !== "number" || si.chargeAmountInr <= 0) {
    findings.push(createFinding("error", "SARFAESI", "Security interest requires a positive chargeAmountInr.", "chargeAmountInr"));
  }
  if (!si.createdBy) {
    findings.push(createFinding("error", "SARFAESI", "Security interest requires createdBy.", "createdBy"));
  }

  // Validate loan account exists
  if (si.loanAccountId && context.loanAccounts && !context.loanAccounts[si.loanAccountId]) {
    findings.push(createFinding("error", "SARFAESI", "Loan account not found.", "loanAccountId"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { registry, securityInterest: si, findings, summary };
  }

  const event = cersaiEvent("cersai.security_interest.created", {
    securityInterestId: si.securityInterestId,
    loanAccountId: si.loanAccountId,
    assetType: si.assetType,
    chargeType: si.chargeType,
    chargeAmountInr: si.chargeAmountInr,
    actor: si.createdBy
  }, now);
  const stored = { ...si, events: [event], updatedAt: now.toISOString() };

  return {
    registry: { ...registry, [stored.securityInterestId]: stored },
    securityInterest: enrichSecurityInterest(stored, now),
    event,
    findings: [],
    summary: summarizeFindings([])
  };
}

export function fileSecurityInterest(si, input = {}, context = {}, now = new Date()) {
  const findings = [];
  if (!si) {
    findings.push(createFinding("error", "SARFAESI", "Security interest is required.", "securityInterestId"));
    return blockedResult(si, findings, now);
  }
  if (si.status !== SECURITY_INTEREST_STATUSES.DRAFT) {
    findings.push(createFinding("error", "SARFAESI", "Only draft security interests can be filed.", "status"));
  }
  if (!input.actor) {
    findings.push(createFinding("error", "SARFAESI", "Filing requires an actor.", "actor"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedResult(si, findings, now);
  }

  const event = cersaiEvent("cersai.security_interest.filed", {
    securityInterestId: si.securityInterestId,
    loanAccountId: si.loanAccountId,
    actor: input.actor
  }, now);

  // Mock CERSAI transaction ID — in production the ExternalServiceManager
  // would call the CERSAI API and return the real transaction ID.
  const cersaiTransactionId = input.cersaiTransactionId ?? `CERSAI-${Date.now()}`;
  const updated = {
    ...si,
    status: SECURITY_INTEREST_STATUSES.FILED,
    cersaiTransactionId,
    filedAt: now.toISOString(),
    filedBy: input.actor,
    events: [...(si.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyResult(updated, event, now);
}

export function registerSecurityInterest(si, input = {}, context = {}, now = new Date()) {
  const findings = [];
  if (!si) {
    findings.push(createFinding("error", "SARFAESI", "Security interest is required.", "securityInterestId"));
    return blockedResult(si, findings, now);
  }
  if (si.status !== SECURITY_INTEREST_STATUSES.FILED) {
    findings.push(createFinding("error", "SARFAESI", "Only filed security interests can be registered.", "status"));
  }
  if (!input.cersaiRegistrationNumber) {
    findings.push(createFinding("error", "SARFAESI", "Registration requires a cersaiRegistrationNumber.", "cersaiRegistrationNumber"));
  }
  if (!input.actor) {
    findings.push(createFinding("error", "SARFAESI", "Registration requires an actor.", "actor"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedResult(si, findings, now);
  }

  const event = cersaiEvent("cersai.security_interest.registered", {
    securityInterestId: si.securityInterestId,
    cersaiRegistrationNumber: input.cersaiRegistrationNumber,
    actor: input.actor
  }, now);
  const updated = {
    ...si,
    status: SECURITY_INTEREST_STATUSES.REGISTERED,
    cersaiRegistrationNumber: input.cersaiRegistrationNumber,
    registeredAt: now.toISOString(),
    registeredBy: input.actor,
    events: [...(si.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyResult(updated, event, now);
}

export function modifySecurityInterest(si, input = {}, context = {}, now = new Date()) {
  const findings = [];
  if (!si) {
    findings.push(createFinding("error", "SARFAESI", "Security interest is required.", "securityInterestId"));
    return blockedResult(si, findings, now);
  }
  if (si.status !== SECURITY_INTEREST_STATUSES.REGISTERED) {
    findings.push(createFinding("error", "SARFAESI", "Only registered security interests can be modified.", "status"));
  }
  if (!input.actor) {
    findings.push(createFinding("error", "SARFAESI", "Modification requires an actor.", "actor"));
  }
  if (!input.approvedBy) {
    findings.push(createFinding("error", "SARFAESI", "Modification requires maker-checker approval (approvedBy).", "approvedBy"));
  }
  if (input.approvedBy && input.actor && input.approvedBy === input.actor) {
    findings.push(createFinding("error", "SARFAESI", "Maker and checker must be different actors.", "approvedBy"));
  }
  if (!input.reason) {
    findings.push(createFinding("error", "SARFAESI", "Modification requires a reason.", "reason"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedResult(si, findings, now);
  }

  const changes = {};
  if (input.chargeAmountInr != null) {
    changes.chargeAmountInr = input.chargeAmountInr;
  }
  if (input.assetDescription) {
    changes.assetDescription = input.assetDescription;
  }

  const event = cersaiEvent("cersai.security_interest.modified", {
    securityInterestId: si.securityInterestId,
    changes,
    reason: input.reason,
    actor: input.actor,
    approvedBy: input.approvedBy
  }, now);
  const updated = {
    ...si,
    ...changes,
    status: SECURITY_INTEREST_STATUSES.MODIFIED,
    lastModifiedAt: now.toISOString(),
    lastModifiedBy: input.actor,
    modificationHistory: [
      ...(si.modificationHistory ?? []),
      { changes, reason: input.reason, actor: input.actor, approvedBy: input.approvedBy, at: now.toISOString() }
    ],
    events: [...(si.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyResult(updated, event, now);
}

export function satisfySecurityInterest(si, input = {}, context = {}, now = new Date()) {
  const findings = [];
  if (!si) {
    findings.push(createFinding("error", "SARFAESI", "Security interest is required.", "securityInterestId"));
    return blockedResult(si, findings, now);
  }
  const terminalStatuses = new Set([SECURITY_INTEREST_STATUSES.SATISFIED]);
  if (terminalStatuses.has(si.status)) {
    findings.push(createFinding("error", "SARFAESI", "Security interest is already satisfied.", "status"));
  }
  const activeStatuses = new Set([SECURITY_INTEREST_STATUSES.REGISTERED, SECURITY_INTEREST_STATUSES.MODIFIED]);
  if (!activeStatuses.has(si.status)) {
    findings.push(createFinding("error", "SARFAESI", "Only registered or modified security interests can be satisfied.", "status"));
  }
  if (!input.actor) {
    findings.push(createFinding("error", "SARFAESI", "Satisfaction requires an actor.", "actor"));
  }

  // Gate: loan account must be closed or settled
  if (si.loanAccountId && context.loanAccounts) {
    const account = context.loanAccounts[si.loanAccountId];
    if (account) {
      const closedStatuses = new Set(["closed", "settled"]);
      if (!closedStatuses.has(account.status)) {
        findings.push(createFinding("error", "SARFAESI", "Security interest can only be satisfied when the loan account is closed or settled.", "loanAccountStatus"));
      }
    }
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedResult(si, findings, now);
  }

  const event = cersaiEvent("cersai.security_interest.satisfied", {
    securityInterestId: si.securityInterestId,
    loanAccountId: si.loanAccountId,
    actor: input.actor
  }, now);
  const updated = {
    ...si,
    status: SECURITY_INTEREST_STATUSES.SATISFIED,
    satisfiedAt: now.toISOString(),
    satisfiedBy: input.actor,
    events: [...(si.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyResult(updated, event, now);
}

// --- Search for existing charges (prior encumbrance check) ---

export function searchCersaiCharges(assetDescription, context = {}) {
  // In production, this would call the CERSAI API. For now, we search our own
  // registry for matching asset descriptions.
  const securityInterests = Object.values(context.securityInterests ?? {});
  const matches = securityInterests.filter(
    (si) =>
      si.assetDescription === assetDescription &&
      si.status !== SECURITY_INTEREST_STATUSES.SATISFIED
  );
  return {
    count: matches.length,
    charges: matches.map((si) => ({
      securityInterestId: si.securityInterestId,
      loanAccountId: si.loanAccountId,
      chargeType: si.chargeType,
      chargeAmountInr: si.chargeAmountInr,
      status: si.status,
      cersaiRegistrationNumber: si.cersaiRegistrationNumber ?? null
    }))
  };
}

// --- Disbursement readiness gate for secured loans ---

export function validateCersaiForDisbursement(application, context = {}) {
  const findings = [];

  // Check if the product is a secured loan
  const productId = application?.productId ?? application?.productCode ?? null;
  const product = productId ? (context.productPolicies ?? {})[productId] : null;

  if (product && product.securedLoan) {
    const siForAccount = Object.values(context.securityInterests ?? {}).filter(
      (si) =>
        si.loanAccountId === application.applicationId &&
        (si.status === SECURITY_INTEREST_STATUSES.REGISTERED || si.status === SECURITY_INTEREST_STATUSES.MODIFIED)
    );
    if (siForAccount.length === 0) {
      findings.push(
        createFinding(
          "error",
          "SARFAESI",
          "Secured loan disbursement requires at least one registered CERSAI security interest.",
          "cersai"
        )
      );
    }
  }

  return { findings, summary: summarizeFindings(findings) };
}

// --- Enrichment ---

export function enrichSecurityInterest(si, now = new Date()) {
  if (!si) return null;
  const enriched = { ...si };

  // Filing deadline check (30 days from creation)
  if (si.status === SECURITY_INTEREST_STATUSES.DRAFT && si.createdAt) {
    const deadline = new Date(si.createdAt);
    deadline.setUTCDate(deadline.getUTCDate() + FILING_DEADLINE_DAYS);
    enriched.filingDeadline = deadline.toISOString();
    enriched.filingOverdue = now.getTime() > deadline.getTime();
  }

  return enriched;
}

export function listSecurityInterests(registry = {}, loanAccountId) {
  const all = Object.values(registry);
  if (!loanAccountId) return all;
  return all.filter((si) => si.loanAccountId === loanAccountId);
}

// --- Internal helpers ---

function normalizeSecurityInterest(input, existing = {}, now = new Date()) {
  return {
    ...existing,
    securityInterestId: input.securityInterestId ?? existing.securityInterestId ?? createLoanId("cersai"),
    loanAccountId: input.loanAccountId ?? existing.loanAccountId ?? null,
    assetType: input.assetType ?? existing.assetType ?? null,
    assetDescription: input.assetDescription ?? existing.assetDescription ?? null,
    chargeType: input.chargeType ?? existing.chargeType ?? null,
    chargeAmountInr: input.chargeAmountInr ?? existing.chargeAmountInr ?? null,
    status: existing.status ?? SECURITY_INTEREST_STATUSES.DRAFT,
    cersaiTransactionId: existing.cersaiTransactionId ?? null,
    cersaiRegistrationNumber: existing.cersaiRegistrationNumber ?? null,
    createdBy: input.createdBy ?? existing.createdBy ?? null,
    modificationHistory: existing.modificationHistory ?? [],
    events: Array.isArray(existing.events) ? existing.events : [],
    createdAt: existing.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function cersaiEvent(type, data, now) {
  return { eventId: createLoanId("cersaievt"), type, at: now.toISOString(), ...data };
}

function readyResult(si, event, now) {
  return { securityInterest: enrichSecurityInterest(si, now), event, findings: [], summary: summarizeFindings([]) };
}

function blockedResult(si, findings, now) {
  return { securityInterest: si ? enrichSecurityInterest(si, now) : null, event: null, findings, summary: summarizeFindings(findings) };
}
