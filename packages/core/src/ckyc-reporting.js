import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";

export const CKYCRR_PACKET_VERSION = "ckycrr-canonical-1.2.1";
export const CKYCRR_STATUSES = Object.freeze({ READY: "ready", SUBMITTED: "submitted", ACCEPTED: "accepted", REJECTED: "rejected", PROBABLE_MATCH: "probable_match", WITHDRAWN: "withdrawn" });
const IMAGE_TYPES = new Set(["image/tiff", "image/jpeg", "application/pdf"]);
const OPERATIONS = new Set(["new", "update"]);

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function isoDate(value) { const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10); }
function addDays(value, days) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function required(findings, value, path, label = path) { if (value === null || value === undefined || value === "") findings.push(createFinding("error", "CERSAI-CKYC", `${label} is required.`, path)); }
function validCkycIdentifier(value) { return typeof value === "string" && /^[SLMO]?\d{14}$/.test(value); }

function validateDocuments(documents, customerType, findings) {
  if (!Array.isArray(documents) || documents.length === 0) {
    findings.push(createFinding("error", "CERSAI-CKYC", "At least one scanned original supporting document is required.", "documents")); return;
  }
  const maxBytes = customerType === "individual" ? 350 * 1024 : 5 * 1024 * 1024;
  for (const [index, document] of documents.entries()) {
    const path = `documents.${index}`;
    required(findings, document.documentType, `${path}.documentType`);
    required(findings, document.fileName, `${path}.fileName`);
    if (!IMAGE_TYPES.has(document.mediaType)) findings.push(createFinding("error", "CERSAI-CKYC", "Document media type must be TIFF, JPEG, or PDF.", `${path}.mediaType`));
    if (!Number.isInteger(document.sizeBytes) || document.sizeBytes <= 0 || document.sizeBytes > maxBytes) findings.push(createFinding("error", "CERSAI-CKYC", `Document must be positive and no larger than ${maxBytes} bytes.`, `${path}.sizeBytes`));
    if (!Number.isInteger(document.dpi) || document.dpi < 150 || document.dpi > 200) findings.push(createFinding("error", "CERSAI-CKYC", "Scanned originals must use 150-200 DPI.", `${path}.dpi`));
    if (!/^[a-f0-9]{64}$/i.test(document.checksumSha256 ?? "")) findings.push(createFinding("error", "CERSAI-CKYC", "Document SHA-256 checksum is required.", `${path}.checksumSha256`));
    if (document.documentType === "photograph") {
      if (customerType !== "individual") findings.push(createFinding("error", "CERSAI-CKYC", "A separate photograph applies only to individuals.", `${path}.documentType`));
      if (document.mediaType !== "image/jpeg" || document.sizeBytes > 100 * 1024 || document.widthPixels !== 200 || document.heightPixels !== 230 || document.colour !== true) findings.push(createFinding("error", "CERSAI-CKYC", "Individual photograph must be colour JPEG, 200x230 pixels, and at most 100 KB.", path));
    }
  }
  if (customerType === "individual" && !documents.some((item) => item.documentType === "photograph")) findings.push(createFinding("error", "CERSAI-CKYC", "A separately cropped individual photograph is required.", "documents"));
}

export function buildCkycrrPacket(borrower, kycRecord, input = {}, now = new Date()) {
  const findings = [];
  const operation = input.operation ?? "new";
  const customerType = borrower?.borrowerType === "individual" ? "individual" : "legal_entity";
  if (!borrower || !kycRecord) findings.push(createFinding("error", "CERSAI-CKYC", "Borrower and KYC record are required.", "record"));
  if (kycRecord?.status !== "verified") findings.push(createFinding("error", "CERSAI-CKYC", "Only a verified KYC record can be reported.", "kycRecord.status"));
  if (!OPERATIONS.has(operation)) findings.push(createFinding("error", "CERSAI-CKYC", "Operation must be new or update.", "operation"));
  if (operation === "update" && !validCkycIdentifier(input.ckycIdentifier ?? kycRecord?.ckycRef)) findings.push(createFinding("error", "CERSAI-CKYC", "Update requires the latest valid CKYC identifier.", "ckycIdentifier"));
  const reporting = borrower?.creditReporting ?? {};
  const identity = reporting.identity ?? {};
  const address = reporting.address ?? {};
  required(findings, input.institutionCode, "institutionCode"); required(findings, input.branchCode, "branchCode");
  required(findings, address.line1 ?? borrower?.primaryAddress, "borrower.creditReporting.address.line1", "Current address");
  required(findings, address.stateCode, "borrower.creditReporting.address.stateCode", "State code"); required(findings, address.pinCode, "borrower.creditReporting.address.pinCode", "PIN code");
  if (customerType === "individual") {
    required(findings, borrower?.fullName, "borrower.fullName"); required(findings, borrower?.dateOfBirth, "borrower.dateOfBirth");
    required(findings, reporting.gender, "borrower.creditReporting.gender", "Gender"); required(findings, identity.type, "borrower.creditReporting.identity.type", "Identity type"); required(findings, identity.number, "borrower.creditReporting.identity.number", "Identity number");
  } else {
    required(findings, borrower?.legalName, "borrower.legalName"); required(findings, reporting.legalConstitution, "borrower.creditReporting.legalConstitution", "Legal constitution"); required(findings, identity.pan, "borrower.creditReporting.identity.pan", "PAN"); required(findings, reporting.dateOfIncorporation, "borrower.creditReporting.dateOfIncorporation", "Date of incorporation");
  }
  validateDocuments(input.documents, customerType, findings);
  if (!input.proposedBy || !input.approvedBy || input.proposedBy === input.approvedBy || !input.approvalRef) findings.push(createFinding("error", "RBI-IT-GRC", "Independent maker-checker approval and reference are required.", "approval"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { packet: null, findings, summary };
  const record = customerType === "individual" ? {
    name: borrower.fullName, formerName: reporting.formerName ?? null, fatherOrSpouseName: reporting.fatherOrSpouseName ?? null, motherName: reporting.motherName ?? null,
    dateOfBirth: borrower.dateOfBirth, gender: reporting.gender, maritalStatus: reporting.maritalStatus ?? null, citizenship: reporting.citizenship ?? "IN", occupation: borrower.economicProfile?.occupation ?? null,
    identity: { type: identity.type, number: identity.number, expiryDate: identity.expiryDate ?? null }, contact: borrower.contact,
    currentAddress: { line1: address.line1 ?? borrower.primaryAddress, line2: address.line2 ?? null, city: address.city ?? null, district: address.district ?? null, stateCode: address.stateCode, pinCode: address.pinCode, countryCode: address.countryCode ?? "IN" },
    permanentAddress: reporting.permanentAddress ?? null, declarations: { politicallyExposed: reporting.politicallyExposed ?? false, relatedToPep: reporting.relatedToPep ?? false }
  } : {
    legalName: borrower.legalName, dateOfIncorporation: reporting.dateOfIncorporation, placeOfIncorporation: reporting.placeOfIncorporation ?? null, countryOfIncorporation: reporting.countryOfIncorporation ?? "IN", legalConstitution: reporting.legalConstitution,
    identity: { pan: identity.pan, cin: identity.cin ?? null, registrationNumber: identity.registrationNumber ?? null }, contact: borrower.contact,
    registeredAddress: { line1: address.line1 ?? borrower.primaryAddress, line2: address.line2 ?? null, city: address.city ?? null, district: address.district ?? null, stateCode: address.stateCode, pinCode: address.pinCode, countryCode: address.countryCode ?? "IN" },
    relatedPersons: reporting.relatedParties ?? []
  };
  const documents = input.documents.map((item) => ({ ...item }));
  const packetBody = { version: CKYCRR_PACKET_VERSION, operation, customerType, institutionCode: input.institutionCode, branchCode: input.branchCode, existingCkycIdentifier: operation === "update" ? input.ckycIdentifier ?? kycRecord.ckycRef : null, localReference: `${borrower.borrowerId}:${kycRecord.kycRecordId}`, record, documents };
  const canonicalContent = JSON.stringify(packetBody);
  return { packet: { ...packetBody, generatedAt: now.toISOString(), checksumSha256: hash(canonicalContent), canonicalContent }, findings, summary };
}

export function createCkycrrSubmission(registry = {}, context = {}, input = {}, now = new Date()) {
  const submissionId = input.submissionId ?? createLoanId("ckycsub");
  if (registry[submissionId]) return { registry, submission: registry[submissionId], findings: [], summary: summarizeFindings([]), idempotent: true };
  const borrower = context.borrowerProfiles?.[input.borrowerId]; const kycRecord = context.kycRecords?.[input.kycRecordId];
  const result = buildCkycrrPacket(borrower, kycRecord, input, now); const findings = [...result.findings];
  if (kycRecord && kycRecord.borrowerId !== input.borrowerId) findings.push(createFinding("error", "CERSAI-CKYC", "KYC record does not belong to borrower.", "kycRecordId"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { registry, submission: null, findings, summary, idempotent: false };
  const submission = { submissionId, borrowerId: input.borrowerId, kycRecordId: input.kycRecordId, operation: result.packet.operation, customerType: result.packet.customerType, packet: result.packet, status: CKYCRR_STATUSES.READY, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, createdAt: now.toISOString(), events: [{ type: "ckycrr.submission.created", at: now.toISOString(), actor: input.approvedBy }] };
  return { registry: { ...registry, [submissionId]: submission }, submission, findings, summary, idempotent: false };
}

export function submitCkycrrSubmission(registry = {}, submissionId, input = {}, now = new Date()) {
  const submission = registry[submissionId]; const findings = [];
  if (!submission || submission.status !== CKYCRR_STATUSES.READY) findings.push(createFinding("error", "CERSAI-CKYC", "A ready CKYCRR submission is required.", "submissionId"));
  if (!input.transmittedBy || !input.transportRef || !["sftp", "portal"].includes(input.transport) || !input.digitalSignatureRef || !input.fileName) findings.push(createFinding("error", "CERSAI-CKYC", "Actor, SFTP/portal transport, file, digital signature, and transport evidence are required.", "transport"));
  if (!Number.isInteger(input.fileSizeBytes) || input.fileSizeBytes <= 0) findings.push(createFinding("error", "CERSAI-CKYC", "Transmitted file size must be a positive integer byte count.", "fileSizeBytes"));
  if (input.transport === "portal" && Number(input.fileSizeBytes) >= 20 * 1024 * 1024) findings.push(createFinding("error", "CERSAI-CKYC", "Portal bulk uploads must be below 20 MB; use SFTP.", "fileSizeBytes"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { registry, submission, findings, summary };
  const updated = { ...submission, status: CKYCRR_STATUSES.SUBMITTED, submittedAt: now.toISOString(), transport: input.transport, transportRef: input.transportRef, digitalSignatureRef: input.digitalSignatureRef, fileName: input.fileName, events: [...submission.events, { type: "ckycrr.submission.submitted", at: now.toISOString(), actor: input.transmittedBy }] };
  return { registry: { ...registry, [submissionId]: updated }, submission: updated, findings, summary };
}

export function recordCkycrrResponse(registry = {}, submissionId, input = {}, now = new Date()) {
  const submission = registry[submissionId]; const findings = [];
  if (!submission || submission.status !== CKYCRR_STATUSES.SUBMITTED) findings.push(createFinding("error", "CERSAI-CKYC", "A submitted CKYCRR record is required.", "submissionId"));
  if (!input.responseRef || !input.receivedBy || !["accepted", "rejected", "probable_match"].includes(input.outcome)) findings.push(createFinding("error", "CERSAI-CKYC", "Response reference, actor, and valid outcome are required.", "response"));
  if (input.outcome === "accepted" && !validCkycIdentifier(input.ckycIdentifier)) findings.push(createFinding("error", "CERSAI-CKYC", "Only CKYCRR may return a valid 14-digit CKYC identifier.", "ckycIdentifier"));
  if (input.outcome === "accepted" && (!input.customerNotification?.deliveryRef || !input.customerNotification?.deliveredAt || !["sms", "email"].includes(input.customerNotification?.channel))) findings.push(createFinding("error", "RBI-KYC-2016", "Accepted identifier must be shared with the customer by evidenced SMS or email.", "customerNotification"));
  if (input.outcome === "rejected" && (!input.errorCode || !input.errorMessage)) findings.push(createFinding("error", "CERSAI-CKYC", "Rejected response requires error code and message.", "error"));
  if (input.outcome === "probable_match" && (!Array.isArray(input.matches) || input.matches.length === 0 || input.matches.some((item) => !validCkycIdentifier(item.ckycIdentifier)))) findings.push(createFinding("error", "CERSAI-CKYC", "Probable match requires at least one valid CKYC candidate.", "matches"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { registry, submission, findings, summary };
  const updated = { ...submission, status: input.outcome, responseRef: input.responseRef, respondedAt: now.toISOString(), ckycIdentifier: input.outcome === "accepted" ? input.ckycIdentifier : null, customerNotification: input.outcome === "accepted" ? input.customerNotification : null, errorCode: input.errorCode ?? null, errorMessage: input.errorMessage ?? null, probableMatches: input.matches ?? [], reconciliationDueDate: input.outcome === "probable_match" ? addDays(isoDate(now), 7) : null, events: [...submission.events, { type: `ckycrr.submission.${input.outcome}`, at: now.toISOString(), actor: input.receivedBy }] };
  return { registry: { ...registry, [submissionId]: updated }, submission: updated, findings, summary };
}

export function resolveCkycrrProbableMatch(registry = {}, submissionId, input = {}, now = new Date()) {
  const submission = registry[submissionId]; const findings = [];
  if (!submission || submission.status !== CKYCRR_STATUSES.PROBABLE_MATCH) findings.push(createFinding("error", "CERSAI-CKYC", "A probable-match submission is required.", "submissionId"));
  if (!input.reviewedBy || !input.approvedBy || input.reviewedBy === input.approvedBy || !input.reason || !["exact_match", "no_match"].includes(input.decision)) findings.push(createFinding("error", "RBI-IT-GRC", "Independent reviewed decision and reason are required.", "resolution"));
  if (input.decision === "exact_match" && (!validCkycIdentifier(input.ckycIdentifier) || !submission?.probableMatches?.some((item) => item.ckycIdentifier === input.ckycIdentifier))) findings.push(createFinding("error", "CERSAI-CKYC", "Exact match must select a returned CKYC candidate.", "ckycIdentifier"));
  if (input.decision === "exact_match" && (!input.customerNotification?.deliveryRef || !input.customerNotification?.deliveredAt || !["sms", "email"].includes(input.customerNotification?.channel))) findings.push(createFinding("error", "RBI-KYC-2016", "Matched CKYC identifier must be shared with the customer by evidenced SMS or email.", "customerNotification"));
  if (submission && isoDate(now) > submission.reconciliationDueDate) {
    const withdrawn = { ...submission, status: CKYCRR_STATUSES.WITHDRAWN, withdrawnAt: now.toISOString(), events: [...submission.events, { type: "ckycrr.probable_match.withdrawn", at: now.toISOString(), actor: input.reviewedBy ?? "system" }] };
    const overdueFindings = [createFinding("warning", "CERSAI-CKYC", "Probable match passed its seven-day deadline and was withdrawn; prepare a new upload if no match is confirmed.", "reconciliationDueDate")];
    return { registry: { ...registry, [submissionId]: withdrawn }, submission: withdrawn, findings: overdueFindings, summary: summarizeFindings(overdueFindings) };
  }
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { registry, submission, findings, summary };
  const status = input.decision === "exact_match" ? CKYCRR_STATUSES.ACCEPTED : CKYCRR_STATUSES.READY;
  const updated = { ...submission, status, ckycIdentifier: input.decision === "exact_match" ? input.ckycIdentifier : null, customerNotification: input.decision === "exact_match" ? input.customerNotification : null, probableMatchDecision: input.decision, reconciliationReason: input.reason, reconciledAt: now.toISOString(), reviewedBy: input.reviewedBy, reconciliationApprovedBy: input.approvedBy, events: [...submission.events, { type: `ckycrr.probable_match.${input.decision}`, at: now.toISOString(), actor: input.approvedBy }] };
  return { registry: { ...registry, [submissionId]: updated }, submission: updated, findings, summary };
}

export function validateCkycrrDownload(input = {}, consentRecords = {}, now = new Date()) {
  const findings = []; if (!validCkycIdentifier(input.ckycIdentifier)) findings.push(createFinding("error", "CERSAI-CKYC", "Valid CKYC identifier is required.", "ckycIdentifier"));
  const consent = consentRecords[input.consentId];
  if (!consent || consent.borrowerId !== input.borrowerId || consent.purpose !== "ckyc" || consent.status !== "granted" || (consent.expiresAt && new Date(consent.expiresAt).getTime() <= now.getTime())) findings.push(createFinding("error", "RBI-KYC-2016", "Explicit active borrower CKYC consent is required for download.", "consentId"));
  if (!input.authenticationFactor || !["date_of_birth", "date_of_incorporation", "mobile", "pincode_year_of_birth"].includes(input.authenticationFactor.type) || !input.authenticationFactor.evidenceRef) findings.push(createFinding("error", "CERSAI-CKYC", "A supported authentication factor with evidence is required.", "authenticationFactor"));
  if (!input.downloadRef || !input.downloadedBy) findings.push(createFinding("error", "CERSAI-CKYC", "Download provider reference and actor are required.", "download"));
  return { findings, summary: summarizeFindings(findings) };
}
