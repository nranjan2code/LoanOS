import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";

export const ORIGINATION_CHANNELS = new Set(["borrower_self_service", "branch_assisted", "lsp", "api"]);
export const SUPPORTED_BORROWER_LANGUAGES = Object.freeze({
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  mr: "Marathi",
  or: "Odia",
  pa: "Punjabi",
  ta: "Tamil",
  te: "Telugu",
  ur: "Urdu",
});

const DEFAULT_INDIVIDUAL_REQUIREMENTS = Object.freeze([
  { type: "identity_proof", label: "Identity proof", required: true },
  { type: "address_proof", label: "Address proof", required: true },
  { type: "income_proof", label: "Income proof", required: true },
  { type: "bank_statement", label: "Recent bank statement", required: true },
]);
const SAFE_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function iso(value, path, findings) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    findings.push(createFinding("error", "RBI-IT-GRC", `${path} must be a valid timestamp.`, path));
    return null;
  }
  return date.toISOString();
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function documentRequirements(application) {
  const configured = application.product?.documentRequirements;
  const source = Array.isArray(configured) && configured.length ? configured : DEFAULT_INDIVIDUAL_REQUIREMENTS;
  return source.map((requirement) => ({
    type: requirement.type,
    label: requirement.label ?? requirement.type,
    required: requirement.required !== false,
    acceptedMimeTypes: Array.isArray(requirement.acceptedMimeTypes)
      ? requirement.acceptedMimeTypes
      : [...SAFE_MIME_TYPES],
    maxSizeBytes: Number.isInteger(requirement.maxSizeBytes) && requirement.maxSizeBytes > 0
      ? requirement.maxSizeBytes
      : MAX_DOCUMENT_BYTES,
  }));
}

export function initializeOriginationJourney(application, input = {}, now = new Date()) {
  const findings = [];
  const channel = input.channel ?? "borrower_self_service";
  const preferredLanguage = input.preferredLanguage ?? "en";
  if (!ORIGINATION_CHANNELS.has(channel)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Origination channel is unsupported.", "channel"));
  }
  if (!SUPPORTED_BORROWER_LANGUAGES[preferredLanguage]) {
    findings.push(createFinding("error", "RBI-FPC", "Preferred borrower language is unsupported.", "preferredLanguage"));
  }
  if (channel === "borrower_self_service") {
    if (input.informationAccurate !== true) {
      findings.push(createFinding("error", "RBI-FPC", "Borrower must confirm the submitted information is accurate.", "informationAccurate"));
    }
    if (!input.applicationDeclarationRef) {
      findings.push(createFinding("error", "RBI-FPC", "Digital application declaration evidence is required.", "applicationDeclarationRef"));
    }
    if (preferredLanguage !== "en" && (!input.languageUnderstood || !input.languageConfirmationRef)) {
      findings.push(createFinding("error", "RBI-FPC", "Non-English journey requires borrower language-understanding evidence.", "languageConfirmationRef"));
    }
  }
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { application, findings, summary };

  return {
    application: {
      ...application,
      preferredLanguage,
      origination: {
        enforcement: "governed",
        channel,
        source: input.source ?? "direct",
        campaignRef: input.campaignRef ?? null,
        referralRef: input.referralRef ?? null,
        preferredLanguage,
        languageName: SUPPORTED_BORROWER_LANGUAGES[preferredLanguage],
        languageUnderstood: preferredLanguage === "en" ? true : input.languageUnderstood,
        languageConfirmationRef: input.languageConfirmationRef ?? null,
        informationAccurate: true,
        applicationDeclarationRef: input.applicationDeclarationRef,
        submittedAt: now.toISOString(),
        documentRequirements: documentRequirements(application),
        documents: [],
        conditions: [],
      },
    },
    findings,
    summary,
  };
}

export function recordApplicationDocument(application, input = {}, actor = {}, now = new Date()) {
  const findings = [];
  const journey = application.origination;
  const requirement = journey?.documentRequirements?.find((item) => item.type === input.type);
  if (journey?.enforcement !== "governed") {
    findings.push(createFinding("error", "RBI-DL-2025", "Application does not use the governed origination journey.", "origination"));
  }
  if (!requirement) {
    findings.push(createFinding("error", "RBI-FPC", "Document type is not present in the approved product checklist.", "type"));
  }
  if (!input.fileName || !input.mimeType || !Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Document file name, MIME type, and positive integer size are required.", "document"));
  }
  if (requirement && !requirement.acceptedMimeTypes.includes(input.mimeType)) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Document MIME type is not allowed by the checklist.", "mimeType"));
  }
  if (requirement && input.sizeBytes > requirement.maxSizeBytes) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Document exceeds the checklist size limit.", "sizeBytes"));
  }
  if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256 ?? "")) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Document requires a SHA-256 checksum.", "checksumSha256"));
  }
  if (input.storageCountry !== "IN") {
    findings.push(createFinding("error", "RBI-DL-2025", "Origination document storage must remain in India.", "storageCountry"));
  }
  const scan = input.malwareScan ?? {};
  if (!scan.engine || !scan.signatureVersion || !scan.evidenceRef) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Malware scan engine, signature version, and evidence are required.", "malwareScan"));
  }
  const scannedAt = scan.scannedAt ? iso(scan.scannedAt, "malwareScan.scannedAt", findings) : null;
  if (!scannedAt) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Malware scan timestamp is required.", "malwareScan.scannedAt"));
  }
  if (!["clean", "infected"].includes(scan.status)) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Malware scan status must be clean or infected.", "malwareScan.status"));
  }
  const document = {
    documentId: input.documentId ?? createLoanId("doc"),
    type: input.type,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksumSha256: input.checksumSha256,
    storageCountry: input.storageCountry,
    uploadedBy: actor.actorId ?? actor.userId ?? null,
    uploaderType: actor.actorType ?? "borrower",
    uploadedAt: now.toISOString(),
    malwareScan: { ...scan, scannedAt },
    status: scan.status === "infected" ? "quarantined" : "uploaded",
    reviews: [],
  };
  if (scan.status === "infected") {
    findings.push(createFinding("error", "RBI-IT-GRC", "Malware detection quarantined the document.", "malwareScan.status"));
  }
  const canPersist = journey?.enforcement === "governed" && requirement && document.documentId && document.type;
  const updated = canPersist
    ? { ...application, origination: { ...journey, documents: [...(journey.documents ?? []), document] } }
    : application;
  return { application: updated, document: canPersist ? document : null, findings, summary: summarizeFindings(findings) };
}

export function reviewApplicationDocument(application, documentId, input = {}, now = new Date()) {
  const findings = [];
  const documents = application.origination?.documents ?? [];
  const document = documents.find((item) => item.documentId === documentId);
  if (!document) findings.push(createFinding("error", "RBI-FPC", "Application document was not found.", "documentId"));
  if (!input.reviewedBy || !input.evidenceRef) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Document review requires actor and evidence.", "review"));
  }
  if (!["verified", "deficient", "waived"].includes(input.outcome)) {
    findings.push(createFinding("error", "RBI-FPC", "Document review outcome is invalid.", "outcome"));
  }
  if (document?.uploadedBy && document.uploadedBy === input.reviewedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Document reviewer must be independent of the uploader.", "reviewedBy"));
  }
  if (input.outcome === "deficient" && !input.reason) {
    findings.push(createFinding("error", "RBI-FPC", "Deficient document requires a borrower-facing reason.", "reason"));
  }
  if (input.outcome === "waived" && (!input.reason || !input.policyRef || !input.approvedBy || input.approvedBy === input.reviewedBy)) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Waiver requires reason, policy, and an independent approver.", "waiver"));
  }
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { application, document, findings, summary };
  const review = {
    reviewId: input.reviewId ?? createLoanId("doc_review"),
    outcome: input.outcome,
    reason: input.reason ?? null,
    evidenceRef: input.evidenceRef,
    policyRef: input.policyRef ?? null,
    reviewedBy: input.reviewedBy,
    approvedBy: input.approvedBy ?? null,
    reviewedAt: now.toISOString(),
  };
  const reviewed = { ...document, status: input.outcome, reviews: [...document.reviews, review] };
  return {
    application: {
      ...application,
      origination: { ...application.origination, documents: documents.map((item) => item.documentId === documentId ? reviewed : item) },
    },
    document: reviewed,
    review,
    findings,
    summary,
  };
}

export function createUnderwritingCondition(application, input = {}, now = new Date()) {
  const findings = [];
  if (!["precedent", "subsequent"].includes(input.type)) findings.push(createFinding("error", "RBI-FPC", "Condition type must be precedent or subsequent.", "type"));
  if (!input.description || !input.policyRef || !input.createdBy || !input.approvedBy) findings.push(createFinding("error", "RBI-IT-GRC", "Condition requires description, policy, maker, and checker.", "condition"));
  if (input.createdBy && input.createdBy === input.approvedBy) findings.push(createFinding("error", "RBI-IT-GRC", "Condition maker and checker must differ.", "approvedBy"));
  const dueAt = input.dueAt ? iso(input.dueAt, "dueAt", findings) : null;
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { application, findings, summary };
  const condition = {
    conditionId: input.conditionId ?? createLoanId("condition"),
    type: input.type,
    description: input.description,
    policyRef: input.policyRef,
    createdBy: input.createdBy,
    approvedBy: input.approvedBy,
    createdAt: now.toISOString(),
    dueAt,
    status: "open",
    satisfaction: null,
  };
  return {
    application: { ...application, origination: { ...application.origination, conditions: [...(application.origination?.conditions ?? []), condition] } },
    condition,
    findings,
    summary,
  };
}

export function satisfyUnderwritingCondition(application, conditionId, input = {}, now = new Date()) {
  const findings = [];
  const conditions = application.origination?.conditions ?? [];
  const condition = conditions.find((item) => item.conditionId === conditionId);
  if (!condition) findings.push(createFinding("error", "RBI-FPC", "Underwriting condition was not found.", "conditionId"));
  if (condition?.status !== "open") findings.push(createFinding("error", "RBI-IT-GRC", "Only an open condition can be satisfied.", "status"));
  if (!input.evidenceRef || !input.satisfiedBy || !input.verifiedBy) findings.push(createFinding("error", "RBI-IT-GRC", "Condition satisfaction requires evidence, performer, and verifier.", "satisfaction"));
  if (input.satisfiedBy && input.satisfiedBy === input.verifiedBy) findings.push(createFinding("error", "RBI-IT-GRC", "Condition verifier must be independent.", "verifiedBy"));
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { application, condition, findings, summary };
  const satisfied = {
    ...condition,
    status: "satisfied",
    satisfaction: { evidenceRef: input.evidenceRef, notes: input.notes ?? null, satisfiedBy: input.satisfiedBy, verifiedBy: input.verifiedBy, satisfiedAt: now.toISOString() },
  };
  return {
    application: { ...application, origination: { ...application.origination, conditions: conditions.map((item) => item.conditionId === conditionId ? satisfied : item) } },
    condition: satisfied,
    findings,
    summary,
  };
}

export function attachSanctionValidity(application, now = new Date()) {
  if (application.status !== "approved") return application;
  const validityDays = Number.isInteger(application.product?.sanctionValidityDays) && application.product.sanctionValidityDays > 0
    ? application.product.sanctionValidityDays
    : 30;
  return {
    ...application,
    sanctionValidity: {
      sanctionedAt: now.toISOString(),
      validityDays,
      expiresAt: addDays(now, validityDays).toISOString(),
      status: "active",
      policyRef: application.product?.sanctionValidityPolicyRef ?? application.product?.boardPolicyRef ?? null,
    },
  };
}

export function evaluateOriginationReadiness(application, now = new Date()) {
  const governed = application.origination?.enforcement === "governed";
  const requirements = application.origination?.documentRequirements ?? [];
  const documents = application.origination?.documents ?? [];
  const requirementStatus = requirements.map((requirement) => {
    const candidates = documents.filter((document) => document.type === requirement.type);
    const satisfied = candidates.some((document) => ["verified", "waived"].includes(document.status));
    return { ...requirement, satisfied, documents: candidates.map((document) => ({ documentId: document.documentId, status: document.status })) };
  });
  const openPrecedentConditions = (application.origination?.conditions ?? []).filter((condition) => condition.type === "precedent" && condition.status !== "satisfied");
  const sanction = application.sanctionValidity ?? null;
  const sanctionExpired = Boolean(sanction?.expiresAt && new Date(sanction.expiresAt).getTime() < now.getTime());
  return {
    governed,
    documentsReady: !governed || requirementStatus.every((requirement) => !requirement.required || requirement.satisfied),
    conditionsReady: !governed || openPrecedentConditions.length === 0,
    sanctionReady: !sanction || !sanctionExpired,
    sanctionExpired,
    requirementStatus,
    openPrecedentConditions,
    preferredLanguage: application.preferredLanguage ?? "en",
  };
}

export function validateOriginationBeforeDecision(application) {
  const readiness = evaluateOriginationReadiness(application);
  const findings = [];
  if (readiness.governed && !readiness.documentsReady) findings.push(createFinding("error", "RBI-DL-2025", "Required origination documents must be independently verified or waived before approval.", "origination.documents"));
  return { readiness, findings, summary: summarizeFindings(findings) };
}

export function validateOriginationBeforeDisbursement(application, now = new Date()) {
  const readiness = evaluateOriginationReadiness(application, now);
  const findings = [];
  if (readiness.governed && !readiness.documentsReady) findings.push(createFinding("error", "RBI-DL-2025", "Required origination documents are incomplete.", "origination.documents"));
  if (readiness.governed && !readiness.conditionsReady) findings.push(createFinding("error", "RBI-IT-GRC", "Open conditions precedent block disbursement.", "origination.conditions"));
  if (!application.sanctionValidity) findings.push(createFinding("error", "RBI-FPC", "Approved application requires sanction-validity evidence.", "sanctionValidity"));
  if (readiness.sanctionExpired) findings.push(createFinding("error", "RBI-FPC", "Sanction validity has expired; reassessment is required.", "sanctionValidity.expiresAt"));
  return { readiness, findings, summary: summarizeFindings(findings) };
}
