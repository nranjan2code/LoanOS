import { createHash } from "node:crypto";

const INDIAN_LANGUAGES = new Set(["as", "bn", "gu", "hi", "kn", "ml", "mr", "or", "pa", "ta", "te", "ur"]);
const TEMPLATE_TYPES = new Set(["kfs", "notice", "communication", "servicing"]);

export function approveLanguagePack(input = {}, existing = [], now = new Date()) {
  identity(input); for (const field of ["packId", "language", "version", "glossaryRef", "sourceChecksumSha256", "translationChecksumSha256", "translatedBy", "reviewedBy", "approvalRef"]) text(input[field], field);
  if (!INDIAN_LANGUAGES.has(input.language)) fail("language_pack_invalid", "language must be an approved Indian language code.");
  digest(input.sourceChecksumSha256, "sourceChecksumSha256"); digest(input.translationChecksumSha256, "translationChecksumSha256");
  if (input.translatedBy === input.reviewedBy) fail("experience_four_eyes_required", "Language packs require independent linguistic review.");
  if (existing.some((item) => item.tenantId === input.tenantId && item.packId === input.packId && item.version === input.version)) fail("language_pack_duplicate", "Language pack version already exists in this tenant.");
  return { tenantId: input.tenantId, packId: input.packId, language: input.language, version: input.version, glossaryRef: input.glossaryRef, sourceChecksumSha256: input.sourceChecksumSha256.toLowerCase(), translationChecksumSha256: input.translationChecksumSha256.toLowerCase(), translatedBy: input.translatedBy, reviewedBy: input.reviewedBy, approvalRef: input.approvalRef, status: "approved", approvedAt: now.toISOString() };
}

export function approveLocalizedTemplate(pack, input = {}, existing = [], now = new Date()) {
  sameTenant(pack, input); if (pack.status !== "approved") fail("language_pack_inactive", "An approved language pack is required.");
  for (const field of ["templateId", "version", "templateType", "sourceTemplateId", "sourceVersion", "content", "contentChecksumSha256", "proposedBy", "approvedBy", "approvalRef"]) text(input[field], field);
  if (!TEMPLATE_TYPES.has(input.templateType)) fail("localized_template_invalid", "templateType is invalid.");
  if (input.language !== pack.language) fail("localized_template_language_mismatch", "Template language must match its approved pack.");
  if (input.proposedBy === input.approvedBy) fail("experience_four_eyes_required", "Localized templates require independent approval.");
  digest(input.contentChecksumSha256, "contentChecksumSha256");
  if (sha256(input.content) !== input.contentChecksumSha256.toLowerCase()) fail("localized_template_checksum_mismatch", "Template checksum does not match content.");
  if (existing.some((item) => item.tenantId === input.tenantId && item.templateId === input.templateId && item.version === input.version && item.language === input.language)) fail("localized_template_duplicate", "Localized template version already exists in this tenant.");
  return { tenantId: input.tenantId, templateId: input.templateId, version: input.version, templateType: input.templateType, language: input.language, packId: pack.packId, packVersion: pack.version, sourceTemplateId: input.sourceTemplateId, sourceVersion: input.sourceVersion, content: input.content, contentChecksumSha256: input.contentChecksumSha256.toLowerCase(), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "approved", approvedAt: now.toISOString() };
}

export function resolveLocalizedTemplate(templates = [], input = {}) {
  identity(input); text(input.templateId, "templateId"); text(input.language, "language");
  const candidates = templates.filter((item) => item.tenantId === input.tenantId && item.templateId === input.templateId && item.language === input.language && item.status === "approved");
  const selected = candidates.sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true }))[0];
  if (selected) return selected;
  if (input.allowApprovedFallback !== true) fail("localized_template_missing", "No approved localized template is available; implicit fallback is prohibited.");
  text(input.fallbackLanguage, "fallbackLanguage");
  const fallback = templates.filter((item) => item.tenantId === input.tenantId && item.templateId === input.templateId && item.language === input.fallbackLanguage && item.status === "approved").sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true }))[0];
  if (!fallback) fail("localized_template_missing", "No approved fallback template is available.");
  return { ...fallback, fallbackFromLanguage: input.language };
}

export function certifyFieldDevice(input = {}, existing = [], now = new Date()) {
  identity(input); for (const field of ["deviceId", "platform", "osVersion", "browserVersion", "attestationRef", "encryptionEvidenceRef", "assistiveTechnologyEvidenceRef", "testedBy", "approvedBy", "approvalRef"]) text(input[field], field);
  if (input.testedBy === input.approvedBy) fail("experience_four_eyes_required", "Device certification requires independent approval.");
  if (input.encryptedStorage !== true || input.screenLockEnforced !== true || input.remoteWipeEnabled !== true) fail("device_certification_blocked", "Encrypted storage, screen lock, and remote wipe are mandatory.");
  if (existing.some((item) => item.tenantId === input.tenantId && item.deviceId === input.deviceId && item.status === "certified")) fail("device_certification_duplicate", "Device already has an active tenant certification.");
  return { tenantId: input.tenantId, deviceId: input.deviceId, platform: input.platform, osVersion: input.osVersion, browserVersion: input.browserVersion, attestationRef: input.attestationRef, encryptionEvidenceRef: input.encryptionEvidenceRef, assistiveTechnologyEvidenceRef: input.assistiveTechnologyEvidenceRef, encryptedStorage: true, screenLockEnforced: true, remoteWipeEnabled: true, testedBy: input.testedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "certified", expiresAt: future(input.expiresAt, now, "expiresAt"), certifiedAt: now.toISOString() };
}

export function enqueueEncryptedOfflineWork(device, input = {}, existing = [], now = new Date()) {
  sameTenant(device, input); if (device.status !== "certified" || Date.parse(device.expiresAt) <= now.getTime()) fail("device_not_certified", "A current certified device is required.");
  for (const field of ["envelopeId", "idempotencyKey", "aggregateType", "aggregateId", "baseVersion", "ciphertext", "ciphertextSha256", "keyId", "algorithm", "nonce", "authTag", "createdBy"]) text(input[field], field);
  for (const forbidden of ["plaintext", "payload", "customerData"]) if (Object.hasOwn(input, forbidden)) fail("offline_plaintext_forbidden", "Offline queue envelopes cannot contain plaintext payload fields.");
  if (input.algorithm !== "AES-256-GCM") fail("offline_envelope_invalid", "Only AES-256-GCM envelopes are accepted.");
  digest(input.ciphertextSha256, "ciphertextSha256"); if (sha256(input.ciphertext) !== input.ciphertextSha256.toLowerCase()) fail("offline_envelope_checksum_mismatch", "Ciphertext checksum mismatch.");
  if (existing.some((item) => item.tenantId === input.tenantId && item.idempotencyKey === input.idempotencyKey)) fail("offline_idempotency_replay", "idempotencyKey was already queued in this tenant.");
  return { tenantId: input.tenantId, envelopeId: input.envelopeId, idempotencyKey: input.idempotencyKey, deviceId: device.deviceId, aggregateType: input.aggregateType, aggregateId: input.aggregateId, baseVersion: input.baseVersion, ciphertext: input.ciphertext, ciphertextSha256: input.ciphertextSha256.toLowerCase(), keyId: input.keyId, algorithm: input.algorithm, nonce: input.nonce, authTag: input.authTag, createdBy: input.createdBy, status: "queued", expiresAt: future(input.expiresAt, now, "expiresAt"), queuedAt: now.toISOString() };
}

export function reconcileEncryptedOfflineWork(envelope, input = {}, processed = [], now = new Date()) {
  sameTenant(envelope, input); if (envelope.status !== "queued") fail("offline_replay_blocked", "Only queued envelopes can be reconciled.");
  if (Date.parse(envelope.expiresAt) <= now.getTime()) fail("offline_envelope_expired", "Expired offline work is rejected.");
  if (processed.some((item) => item.tenantId === input.tenantId && item.idempotencyKey === envelope.idempotencyKey)) fail("offline_idempotency_replay", "Envelope was already processed.");
  text(input.reconciledBy, "reconciledBy"); text(input.evidenceRef, "evidenceRef"); text(input.currentVersion, "currentVersion");
  if (String(input.currentVersion) !== envelope.baseVersion) return { ...envelope, status: "conflict", currentVersion: String(input.currentVersion), conflictReason: "aggregate_version_changed", evidenceRef: input.evidenceRef, reconciledBy: input.reconciledBy, reconciledAt: now.toISOString() };
  return { ...envelope, status: "applied", appliedVersion: String(input.appliedVersion ?? input.currentVersion), evidenceRef: input.evidenceRef, reconciledBy: input.reconciledBy, reconciledAt: now.toISOString() };
}

function identity(input) { text(input.tenantId, "tenantId"); }
function sameTenant(record, input) { identity(input); if (!record || record.tenantId !== input.tenantId) fail("experience_tenant_mismatch", "Record must belong to the requested tenant."); }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("customer_experience_invalid", `${field} is required.`); }
function digest(value, field) { if (!/^[a-fA-F0-9]{64}$/.test(value)) fail("customer_experience_invalid", `${field} must be a SHA-256 digest.`); }
function future(value, now, field) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= now.getTime()) fail("customer_experience_invalid", `${field} must be a future ISO date-time.`); return new Date(value).toISOString(); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

export { INDIAN_LANGUAGES, TEMPLATE_TYPES };
