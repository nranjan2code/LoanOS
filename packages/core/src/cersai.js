import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";
import { createHash } from "node:crypto";

// CERSAI (Central Registry of Securitisation Asset Reconstruction and Security
// Interest of India) registration is mandatory under the SARFAESI Act for
// secured loans. The RE must file the security interest within 30 days of
// creation and satisfy/release it on full repayment or closure.

export const SECURITY_INTEREST_STATUSES = {
  DRAFT: "draft",
  FILED: "filed",
  REGISTERED: "registered",
  REJECTED: "rejected",
  MODIFIED: "modified",
  SATISFIED: "satisfied"
};

export const CERSAI_SUBMISSION_PROFILE = "cersai-canonical-security-interest-1.0";

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

  const packetResult = buildCersaiSubmission(si, context, input, now);
  findings.push(...packetResult.findings);

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedResult(si, findings, now);
  }

  const event = cersaiEvent("cersai.security_interest.filed", {
    securityInterestId: si.securityInterestId,
    loanAccountId: si.loanAccountId,
    actor: input.actor
  }, now);

  const updated = {
    ...si,
    status: SECURITY_INTEREST_STATUSES.FILED,
    cersaiSubmission: packetResult.packet,
    cersaiTransactionId: input.providerSubmissionRef ?? null,
    providerSubmittedAt: input.providerSubmittedAt ?? now.toISOString(),
    filedAt: now.toISOString(),
    filedBy: input.actor,
    events: [...(si.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyResult(updated, event, now);
}

export function buildCersaiSubmission(si, context = {}, input = {}, now = new Date()) {
  const findings = [];
  const creditor = input.creditor ?? context.regulatedEntities?.[si?.regulatedEntityId] ?? context.regulatedEntity ?? null;
  const debtor = input.debtor ?? context.borrowerProfiles?.[si?.borrowerId] ?? null;
  const asset = input.asset ?? si?.assetDetails ?? null;
  if (!si) findings.push(createFinding("error", "SARFAESI", "Security interest is required.", "securityInterestId"));
  if (!creditor?.legalName || !creditor?.registrationCode || !creditor?.registeredAddress) findings.push(createFinding("error", "SARFAESI", "CERSAI packet requires creditor legal name, registration code, and registered address.", "creditor"));
  if (!debtor?.fullName && !debtor?.legalName) findings.push(createFinding("error", "SARFAESI", "CERSAI packet requires debtor legal name.", "debtor"));
  if (!debtor?.identity?.type || !debtor?.identity?.value || !debtor?.address?.line1 || !debtor?.address?.pincode) findings.push(createFinding("error", "SARFAESI", "CERSAI packet requires debtor identity and address evidence.", "debtor"));
  if (!asset?.assetIdentifier || !asset?.location || !asset?.state || !asset?.pincode) findings.push(createFinding("error", "SARFAESI", "CERSAI packet requires a stable asset identifier and location, state, and pincode.", "asset"));
  if (!input.chargeCreatedAt || Number.isNaN(new Date(input.chargeCreatedAt).getTime())) findings.push(createFinding("error", "SARFAESI", "CERSAI packet requires the security-interest creation date.", "chargeCreatedAt"));
  if (!input.authorisedBy || !input.authorisationRef) findings.push(createFinding("error", "SARFAESI", "CERSAI packet requires authorised submitter and authority reference.", "authorisation"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { packet: null, findings, summary };
  const payload = {
    profile: CERSAI_SUBMISSION_PROFILE,
    submissionType: "security_interest_registration",
    securityInterestId: si.securityInterestId,
    loanAccountId: si.loanAccountId,
    creditor: { legalName: creditor.legalName, registrationCode: creditor.registrationCode, registeredAddress: creditor.registeredAddress },
    debtor: { name: debtor.fullName ?? debtor.legalName, identity: debtor.identity, address: debtor.address },
    asset: { assetType: si.assetType, assetIdentifier: asset.assetIdentifier, location: asset.location, state: asset.state, pincode: asset.pincode },
    charge: { chargeType: si.chargeType, chargeAmountInr: si.chargeAmountInr.toFixed(2), createdAt: new Date(input.chargeCreatedAt).toISOString().slice(0, 10) },
    authorisedBy: input.authorisedBy,
    authorisationRef: input.authorisationRef,
    generatedAt: now.toISOString()
  };
  const canonicalJson = JSON.stringify(payload);
  return { packet: { profile: CERSAI_SUBMISSION_PROFILE, contentType: "application/json", canonicalJson, checksumSha256: createHash("sha256").update(canonicalJson).digest("hex"), generatedAt: now.toISOString() }, findings, summary };
}

export function acknowledgeCersaiSubmission(si, input = {}, now = new Date()) {
  const findings = [];
  if (!si || si.status !== SECURITY_INTEREST_STATUSES.FILED) findings.push(createFinding("error", "SARFAESI", "Only a filed security interest can receive a CERSAI response.", "status"));
  if (!input.responseRef || !input.receivedBy || !["registered", "rejected"].includes(input.outcome)) findings.push(createFinding("error", "SARFAESI", "CERSAI response reference, receiver, and registered/rejected outcome are required.", "response"));
  if (input.checksumSha256 !== si?.cersaiSubmission?.checksumSha256) findings.push(createFinding("error", "SARFAESI", "CERSAI response checksum must exactly match the submitted packet.", "checksumSha256"));
  if (!input.payment?.receiptRef || !Number.isFinite(input.payment?.amountInr) || input.payment.amountInr < 0 || !input.payment?.paidAt) findings.push(createFinding("error", "SARFAESI", "CERSAI payment receipt, non-negative amount, and payment time are required.", "payment"));
  if (input.outcome === "registered" && (!input.cersaiRegistrationNumber || !input.certificate?.certificateRef || !input.certificate?.checksumSha256)) findings.push(createFinding("error", "SARFAESI", "Registered response requires CERSAI registration number and checksum-sealed certificate evidence.", "certificate"));
  if (input.outcome === "rejected" && (!input.errorCode || !input.errorMessage)) findings.push(createFinding("error", "SARFAESI", "Rejected response requires error code and message.", "error"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return blockedResult(si, findings, now);
  const registered = input.outcome === "registered";
  const event = cersaiEvent(`cersai.security_interest.${registered ? "registered" : "rejected"}`, { securityInterestId: si.securityInterestId, responseRef: input.responseRef, actor: input.receivedBy }, now);
  const updated = { ...si, status: registered ? SECURITY_INTEREST_STATUSES.REGISTERED : SECURITY_INTEREST_STATUSES.REJECTED, cersaiRegistrationNumber: registered ? input.cersaiRegistrationNumber : null, registeredAt: registered ? now.toISOString() : null, registeredBy: registered ? input.receivedBy : null, cersaiResponse: { outcome: input.outcome, responseRef: input.responseRef, checksumSha256: input.checksumSha256, receivedBy: input.receivedBy, payment: input.payment, certificate: registered ? input.certificate : null, errorCode: input.errorCode ?? null, errorMessage: input.errorMessage ?? null }, events: [...(si.events ?? []), event], updatedAt: now.toISOString() };
  return readyResult(updated, event, now);
}

export function repairCersaiSecurityInterest(registry = {}, rejectedSecurityInterestId, input = {}, context = {}, now = new Date()) {
  const rejected = registry[rejectedSecurityInterestId]; const findings = [];
  if (!rejected || rejected.status !== SECURITY_INTEREST_STATUSES.REJECTED) findings.push(createFinding("error", "SARFAESI", "A rejected CERSAI security interest is required for repair.", "rejectedSecurityInterestId"));
  if (!input.proposedBy || !input.approvedBy || input.proposedBy === input.approvedBy || !input.approvalRef || !input.sourceCorrectionRef || !input.correctedSecurityInterest) findings.push(createFinding("error", "RBI-IT-GRC", "Independent repair approval, source-correction evidence, and corrected security-interest data are required.", "repair"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { registry, securityInterest: null, findings, summary };
  const result = createSecurityInterest(registry, { ...rejected, ...input.correctedSecurityInterest, securityInterestId: input.securityInterestId ?? createLoanId("cersai"), parentSecurityInterestId: rejectedSecurityInterestId, createdBy: input.proposedBy, repairApproval: { proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, sourceCorrectionRef: input.sourceCorrectionRef } }, context, now);
  return { ...result, securityInterest: result.securityInterest ? { ...result.securityInterest, parentSecurityInterestId: rejectedSecurityInterestId } : null };
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
    regulatedEntityId: input.regulatedEntityId ?? existing.regulatedEntityId ?? null,
    borrowerId: input.borrowerId ?? existing.borrowerId ?? null,
    assetType: input.assetType ?? existing.assetType ?? null,
    assetDescription: input.assetDescription ?? existing.assetDescription ?? null,
    chargeType: input.chargeType ?? existing.chargeType ?? null,
    chargeAmountInr: input.chargeAmountInr ?? existing.chargeAmountInr ?? null,
    assetDetails: input.assetDetails ?? existing.assetDetails ?? null,
    status: existing.status ?? SECURITY_INTEREST_STATUSES.DRAFT,
    cersaiTransactionId: existing.cersaiTransactionId ?? null,
    cersaiRegistrationNumber: existing.cersaiRegistrationNumber ?? null,
    cersaiSubmission: existing.cersaiSubmission ?? null,
    cersaiResponse: existing.cersaiResponse ?? null,
    parentSecurityInterestId: input.parentSecurityInterestId ?? existing.parentSecurityInterestId ?? null,
    repairApproval: input.repairApproval ?? existing.repairApproval ?? null,
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
