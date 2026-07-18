/**
 * CKYCRR (Central KYC Records Registry) reporting: builds and submits the
 * canonical CKYCRR packet for a verified KYC record (RBI-KYC-2016 /
 * CERSAI-CKYC), tracks the submission through the registry's async
 * accept/reject/probable-match response cycle, and validates the separate
 * consent + authentication-factor preconditions for *downloading* someone
 * else's CKYC record. This module does not perform KYC verification itself
 * (`kycRecord.status !== "verified"` blocks packet building outright) and
 * does not talk to the CKYCRR SFTP/portal transport — `submitCkycrrSubmission`
 * only records that transmission evidence (signature, transport ref,
 * file size) already exists.
 *
 * CKYCRR's own document-format rules are enforced exactly, not
 * approximately: individual photographs must be a 200x230 colour JPEG
 * under 100 KB; scanned originals must be TIFF/JPEG/PDF at 150-200 DPI,
 * under 350 KB (individual) or 5 MB (legal entity), each with its own
 * SHA-256 checksum. A `"probable_match"` response starts a 7-day
 * reconciliation clock (`reconciliationDueDate`); if that deadline passes
 * before `resolveCkycrrProbableMatch` is called, the submission is
 * auto-withdrawn rather than left in limbo. Every accepted or confirmed
 * CKYC identifier must be shared back to the customer via evidenced
 * SMS/email (RBI-KYC-2016) before the flow is considered complete.
 */
import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "../lending/loan-policy.js";

export const CKYCRR_PACKET_VERSION = "ckycrr-canonical-1.2.1";
export const CKYCRR_STATUSES = Object.freeze({ READY: "ready", SUBMITTED: "submitted", ACCEPTED: "accepted", REJECTED: "rejected", PROBABLE_MATCH: "probable_match", WITHDRAWN: "withdrawn" });
const IMAGE_TYPES = new Set(["image/tiff", "image/jpeg", "application/pdf"]);
const OPERATIONS = new Set(["new", "update"]);

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function isoDate(value) { const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10); }
function addDays(value, days) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function required(findings, value, path, label = path) { if (value === null || value === undefined || value === "") findings.push(createFinding("error", "CERSAI-CKYC", `${label} is required.`, path)); }
function validCkycIdentifier(value) { return typeof value === "string" && /^[SLMO]?\d{14}$/.test(value); }

// CKYCRR's exact document-format rules: file type, size ceiling (tighter
// for individuals), DPI band, a SHA-256 checksum per document, and — for
// individuals — a dedicated cropped photograph meeting its own stricter
// colour/dimension/size limits.
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

/**
 * Build (but do not submit) a canonical CKYCRR packet from a borrower and
 * their verified KYC record. Fails closed unless: the KYC record is
 * `"verified"`, the operation is `new`/`update` (update requires a valid
 * existing CKYC identifier), all customer-type-specific fields are present
 * (individual: name/DOB/gender/identity; legal entity: legal name/PAN/
 * constitution/incorporation date), documents pass `validateDocuments`, and
 * independent maker-checker approval is present. The packet's
 * `checksumSha256` is computed over its canonical JSON so the exact
 * submitted content is fixed at build time.
 * @param {object} borrower - borrower profile record.
 * @param {object} kycRecord - the borrower's KYC record (must be `"verified"`).
 * @param {object} input - operation, ckycIdentifier (for update), institutionCode, branchCode, documents, proposedBy, approvedBy, approvalRef.
 * @param {Date} [now]
 * @returns {{packet: object|null, findings: Array<object>, summary: object}}
 */
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

/**
 * Build a packet and register it as a `"ready"` CKYCRR submission.
 * Idempotent on `submissionId` (a repeat call with the same id returns the
 * existing submission unchanged). Fails closed if the KYC record doesn't
 * actually belong to the named borrower, in addition to every
 * `buildCkycrrPacket` precondition.
 * @param {Record<string, object>} registry - submissionId -> submission record.
 * @param {{borrowerProfiles?: object, kycRecords?: object}} context - lookup maps for the borrower/KYC record.
 * @param {object} input - submissionId, borrowerId, kycRecordId, +buildCkycrrPacket fields.
 * @param {Date} [now]
 * @returns {{registry: object, submission: object|null, findings: Array<object>, summary: object, idempotent: boolean}}
 */
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

/**
 * Record that a `"ready"` submission has been transmitted to CKYCRR.
 * Fails closed unless: transmitter, transport (`sftp`/`portal`), digital
 * signature, and file-name evidence are all present, the file size is a
 * positive integer, and — CKYCRR's own rule — a `portal` upload stays
 * under 20 MB (larger files must use `sftp`).
 * @param {Record<string, object>} registry - submissionId -> submission record.
 * @param {string} submissionId
 * @param {object} input - transmittedBy, transport, transportRef, digitalSignatureRef, fileName, fileSizeBytes.
 * @param {Date} [now]
 * @returns {{registry: object, submission: object, findings: Array<object>, summary: object}}
 */
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

/**
 * Apply CKYCRR's response to a `"submitted"` record: accepted (with a
 * fresh CKYC identifier and evidenced customer notification), rejected
 * (with error code/message), or probable_match (with at least one valid
 * candidate identifier, starting the 7-day reconciliation clock via
 * `reconciliationDueDate`). Fails closed unless the outcome's own required
 * fields are present.
 * @param {Record<string, object>} registry - submissionId -> submission record.
 * @param {string} submissionId
 * @param {object} input - responseRef, receivedBy, outcome, ckycIdentifier, customerNotification, errorCode, errorMessage, matches.
 * @param {Date} [now]
 * @returns {{registry: object, submission: object, findings: Array<object>, summary: object}}
 */
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

/**
 * Resolve a `"probable_match"` submission with an independent reviewed
 * decision (exact_match or no_match). If the 7-day reconciliation deadline
 * has already passed, the submission is instead auto-withdrawn (a warning
 * finding, not blocked) regardless of what decision was supplied — the
 * caller must re-upload rather than resolve a stale probable match.
 * Otherwise fails closed unless reviewer/approver are independent, a
 * reason is given, and an `exact_match` decision selects one of the
 * originally-returned candidates plus evidenced customer notification.
 * @param {Record<string, object>} registry - submissionId -> submission record.
 * @param {string} submissionId
 * @param {object} input - reviewedBy, approvedBy, reason, decision, ckycIdentifier, customerNotification.
 * @param {Date} [now]
 * @returns {{registry: object, submission: object, findings: Array<object>, summary: object}}
 */
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

/**
 * Validate the preconditions for *downloading* a CKYC record (a distinct,
 * more sensitive operation than reporting one): a valid CKYC identifier, an
 * active, non-expired, purpose-matched (`"ckyc"`) borrower consent record,
 * a supported authentication factor with evidence, and download
 * provider/actor references. Pure validation — never mutates state or
 * performs the download itself.
 * @param {object} input - ckycIdentifier, borrowerId, consentId, authenticationFactor, downloadRef, downloadedBy.
 * @param {Record<string, object>} consentRecords - consentId -> consent record.
 * @param {Date} [now]
 * @returns {{findings: Array<object>, summary: object}}
 */
export function validateCkycrrDownload(input = {}, consentRecords = {}, now = new Date()) {
  const findings = []; if (!validCkycIdentifier(input.ckycIdentifier)) findings.push(createFinding("error", "CERSAI-CKYC", "Valid CKYC identifier is required.", "ckycIdentifier"));
  const consent = consentRecords[input.consentId];
  if (!consent || consent.borrowerId !== input.borrowerId || consent.purpose !== "ckyc" || consent.status !== "granted" || (consent.expiresAt && new Date(consent.expiresAt).getTime() <= now.getTime())) findings.push(createFinding("error", "RBI-KYC-2016", "Explicit active borrower CKYC consent is required for download.", "consentId"));
  if (!input.authenticationFactor || !["date_of_birth", "date_of_incorporation", "mobile", "pincode_year_of_birth"].includes(input.authenticationFactor.type) || !input.authenticationFactor.evidenceRef) findings.push(createFinding("error", "CERSAI-CKYC", "A supported authentication factor with evidence is required.", "authenticationFactor"));
  if (!input.downloadRef || !input.downloadedBy) findings.push(createFinding("error", "CERSAI-CKYC", "Download provider reference and actor are required.", "download"));
  return { findings, summary: summarizeFindings(findings) };
}
