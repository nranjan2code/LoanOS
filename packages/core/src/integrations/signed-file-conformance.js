import { createHash } from "node:crypto";

export const SIGNED_FILE_SYSTEMS = Object.freeze(["cbs", "gl", "gstn", "tds", "cic", "ckycrr", "fiu", "cersai", "crilc", "cims_xbrl", "psl"]);
const SYSTEMS = new Set(SIGNED_FILE_SYSTEMS);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const required = (value, field) => { if (typeof value !== "string" || !value.trim()) fail("signed_file_input_invalid", `${field} is required.`); return value.trim(); };
const checksum = (value, field) => { if (!/^[a-f0-9]{64}$/.test(String(value ?? ""))) fail("signed_file_checksum_invalid", `${field} must be a SHA-256 checksum.`); return value; };
const exactPaise = (value, field) => { if (!/^(0|[1-9]\d*)$/.test(String(value ?? ""))) fail("signed_file_money_invalid", `${field} must be an exact non-negative paise string.`); return BigInt(value); };
const fourEyes = (input) => { required(input.proposedBy, "proposedBy"); required(input.approvedBy, "approvedBy"); required(input.approvalRef, "approvalRef"); if (input.proposedBy === input.approvedBy) fail("signed_file_four_eyes", "Independent approval is required."); };
const stable = (value) => { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); };
const tenantRecords = (registry, tenantId) => Object.values(registry ?? {}).filter((row) => row.tenantId === tenantId);

export function registerSignedFileSchemaProfile(registry = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId"); const profileId = required(input?.profileId, "profileId"); const system = required(input?.system, "system");
  if (!SYSTEMS.has(system)) fail("signed_file_system_invalid", "Unsupported signed-file system.");
  required(input.schemaVersion, "schemaVersion"); checksum(input.schemaChecksumSha256, "schemaChecksumSha256"); required(input.fileFormat, "fileFormat"); fourEyes(input);
  if (!Array.isArray(input.requiredColumns) || !input.requiredColumns.length || new Set(input.requiredColumns).size !== input.requiredColumns.length) fail("signed_file_schema_invalid", "Unique required columns are required.");
  const key = `${tenantId}:${profileId}`; const existing = registry[key];
  if (existing) fail("signed_file_profile_duplicate", "Profile already exists in this tenant.");
  const priorVersions = tenantRecords(registry, tenantId).filter((row) => row.system === system && row.profileName === input.profileName);
  if (priorVersions.some((row) => row.schemaVersion === input.schemaVersion)) fail("signed_file_profile_version_duplicate", "Schema version already exists for this tenant and profile.");
  const profile = { tenantId, profileId, profileName: required(input.profileName, "profileName"), system, schemaVersion: input.schemaVersion, schemaChecksumSha256: input.schemaChecksumSha256, fileFormat: input.fileFormat, requiredColumns: [...input.requiredColumns], amountFields: [...new Set(input.amountFields ?? [])].sort(), signingRequired: input.signingRequired !== false, encryptionRequired: input.encryptionRequired !== false, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "active", registeredAt: now.toISOString() };
  return { registry: { ...registry, [key]: profile }, profile };
}

export function buildSignedFileManifest(envelopes = {}, profiles = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId"); const envelopeId = required(input?.envelopeId, "envelopeId"); const idempotencyKey = required(input?.idempotencyKey, "idempotencyKey");
  const profile = profiles[`${tenantId}:${input?.profileId}`]; if (!profile || profile.status !== "active") fail("signed_file_profile_unavailable", "Active schema profile is required in the same tenant.");
  if (!Array.isArray(input.rows) || !input.rows.length) fail("signed_file_rows_missing", "At least one row is required."); fourEyes(input);
  const rowResults = input.rows.map((row, index) => {
    const missingColumns = profile.requiredColumns.filter((field) => row[field] === undefined || row[field] === null || row[field] === ""); const errors = missingColumns.map((field) => `missing:${field}`);
    for (const field of profile.amountFields) { try { exactPaise(row[field], field); } catch { errors.push(`invalid_exact_paise:${field}`); } }
    return { rowNumber: index + 1, rowId: String(row.rowId ?? index + 1), status: errors.length ? "rejected" : "accepted", errors, checksumSha256: sha256(stable(row)) };
  });
  if (rowResults.some((row) => row.status === "rejected")) fail("signed_file_row_validation_failed", "One or more rows do not conform to the schema profile.");
  const amountTotalsPaise = Object.fromEntries(profile.amountFields.map((field) => [field, input.rows.reduce((sum, row) => sum + exactPaise(row[field], field), 0n).toString()]));
  const payloadCanonical = stable(input.rows); const payloadChecksumSha256 = sha256(payloadCanonical);
  const manifestBody = { tenantId, envelopeId, idempotencyKey, system: profile.system, profileId: profile.profileId, schemaVersion: profile.schemaVersion, schemaChecksumSha256: profile.schemaChecksumSha256, rowCount: input.rows.length, amountTotalsPaise, payloadChecksumSha256 };
  const manifestChecksumSha256 = sha256(stable(manifestBody));
  if (profile.signingRequired && (!input.signatureEvidenceRef || !input.signingKeyRef || input.signedManifestChecksumSha256 !== manifestChecksumSha256)) fail("signed_file_signature_invalid", "Signature evidence must bind the canonical manifest checksum.");
  if (profile.encryptionRequired && (!input.encryptionEvidenceRef || !input.encryptionKeyRef || !input.encryptedPayloadChecksumSha256)) fail("signed_file_encryption_invalid", "Encryption evidence and encrypted payload checksum are required.");
  if (input.encryptedPayloadChecksumSha256) checksum(input.encryptedPayloadChecksumSha256, "encryptedPayloadChecksumSha256");
  const immutable = { ...manifestBody, manifestChecksumSha256, rowResults, signatureEvidenceRef: input.signatureEvidenceRef ?? null, signingKeyRef: input.signingKeyRef ?? null, signedManifestChecksumSha256: input.signedManifestChecksumSha256 ?? null, encryptionEvidenceRef: input.encryptionEvidenceRef ?? null, encryptionKeyRef: input.encryptionKeyRef ?? null, encryptedPayloadChecksumSha256: input.encryptedPayloadChecksumSha256 ?? null, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  const existing = tenantRecords(envelopes, tenantId).find((row) => row.envelopeId === envelopeId || row.idempotencyKey === idempotencyKey);
  if (existing) { if (existing.evidenceChecksumSha256 !== sha256(stable(immutable))) fail("signed_file_idempotency_conflict", "Envelope identity was reused with different content."); return { envelopes, envelope: existing, idempotent: true }; }
  const envelope = { ...immutable, evidenceChecksumSha256: sha256(stable(immutable)), status: "ready", createdAt: now.toISOString(), acknowledgement: null, corrections: [] };
  return { envelopes: { ...envelopes, [`${tenantId}:${envelopeId}`]: envelope }, envelope, idempotent: false };
}

export function recordSignedFileAcknowledgement(envelopes = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId"); const envelope = envelopes[`${tenantId}:${input?.envelopeId}`]; if (!envelope) fail("signed_file_envelope_missing", "Envelope does not exist in this tenant.");
  required(input.acknowledgementRef, "acknowledgementRef"); required(input.providerEventRef, "providerEventRef"); fourEyes(input);
  if (!['accepted', 'rejected', 'partial'].includes(input.status)) fail("signed_file_ack_status_invalid", "Acknowledgement status is invalid.");
  if (input.acknowledgedManifestChecksumSha256 !== envelope.manifestChecksumSha256) fail("signed_file_ack_checksum_mismatch", "Acknowledgement does not match the canonical manifest.");
  if (!Array.isArray(input.rowResults) || input.rowResults.length !== envelope.rowCount || input.rowResults.some((row) => !Number.isInteger(row.rowNumber) || !["accepted", "rejected"].includes(row.status) || (row.status === "rejected" && !row.reasonCode))) fail("signed_file_ack_rows_invalid", "Complete accepted/rejected row results are required.");
  const rejected = input.rowResults.filter((row) => row.status === "rejected"); if ((input.status === "accepted") !== (rejected.length === 0)) fail("signed_file_ack_control_mismatch", "Acknowledgement status conflicts with row results.");
  const existingEvent = tenantRecords(envelopes, tenantId).find((row) => row.acknowledgement?.providerEventRef === input.providerEventRef)?.acknowledgement;
  const acknowledgement = { acknowledgementRef: input.acknowledgementRef, providerEventRef: input.providerEventRef, status: input.status, acknowledgedManifestChecksumSha256: input.acknowledgedManifestChecksumSha256, rowResults: input.rowResults, acceptedRowCount: input.rowResults.length - rejected.length, rejectedRowCount: rejected.length, pollRef: input.pollRef ?? null, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, acknowledgedAt: now.toISOString() };
  const ackChecksum = sha256(stable({ ...acknowledgement, acknowledgedAt: undefined }));
  if (existingEvent) { const priorChecksum = sha256(stable({ ...existingEvent, acknowledgedAt: undefined })); if (priorChecksum !== ackChecksum) fail("signed_file_ack_replay_conflict", "Provider event was replayed with different acknowledgement content."); return { envelopes, envelope: Object.values(envelopes).find((row) => row.acknowledgement === existingEvent), idempotent: true }; }
  const updated = { ...envelope, acknowledgement, status: rejected.length ? "correction_required" : "accepted", updatedAt: now.toISOString() };
  return { envelopes: { ...envelopes, [`${tenantId}:${envelope.envelopeId}`]: updated }, envelope: updated, idempotent: false };
}

export function createSignedFileCorrection(envelopes = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId"); const parent = envelopes[`${tenantId}:${input?.parentEnvelopeId}`]; if (!parent || parent.status !== "correction_required") fail("signed_file_correction_parent_invalid", "Rejected/partial same-tenant parent is required.");
  required(input.correctionId, "correctionId"); required(input.correctionEvidenceRef, "correctionEvidenceRef"); fourEyes(input);
  const rejectedRows = parent.acknowledgement.rowResults.filter((row) => row.status === "rejected").map((row) => row.rowNumber).sort((a, b) => a - b); const correctedRows = [...new Set(input.correctedRowNumbers ?? [])].sort((a, b) => a - b);
  if (stable(rejectedRows) !== stable(correctedRows)) fail("signed_file_correction_rows_invalid", "Correction must cover every rejected row exactly.");
  const correction = { correctionId: input.correctionId, parentEnvelopeId: parent.envelopeId, rootEnvelopeId: parent.rootEnvelopeId ?? parent.envelopeId, correctedRowNumbers: correctedRows, correctionEvidenceRef: input.correctionEvidenceRef, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "approved", createdAt: now.toISOString() };
  const updated = { ...parent, corrections: [...parent.corrections, correction], status: "correction_approved", updatedAt: now.toISOString() };
  return { envelopes: { ...envelopes, [`${tenantId}:${parent.envelopeId}`]: updated }, correction, envelope: updated };
}

// Export hooks: callers persist returned registries and route provider polling
// results into recordSignedFileAcknowledgement; transport remains adapter-owned.
export function signedFileExportHooks() {
  return { systems: [...SIGNED_FILE_SYSTEMS], build: "buildSignedFileManifest", acknowledgeOrPoll: "recordSignedFileAcknowledgement", correct: "createSignedFileCorrection", transportContract: ["tenantId", "envelopeId", "manifestChecksumSha256", "encryptedPayloadChecksumSha256", "signatureEvidenceRef", "encryptionEvidenceRef"] };
}
