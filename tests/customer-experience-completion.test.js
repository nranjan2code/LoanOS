import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { approveLanguagePack, approveLocalizedTemplate, certifyFieldDevice, enqueueEncryptedOfflineWork, reconcileEncryptedOfflineWork, resolveLocalizedTemplate } from "@loanos/core/operations/customer-experience-completion.js";

const NOW = new Date("2026-07-15T10:00:00.000Z");
const sum = (value) => createHash("sha256").update(value).digest("hex");
function pack() { return approveLanguagePack({ tenantId: "tenant-a", packId: "pack-hi", language: "hi", version: "1", glossaryRef: "glossary://hi/1", sourceChecksumSha256: "a".repeat(64), translationChecksumSha256: "b".repeat(64), translatedBy: "translator", reviewedBy: "linguist", approvalRef: "approval://pack" }, [], NOW); }
function template() { const content = "स्वीकृत मुख्य तथ्य विवरण"; return approveLocalizedTemplate(pack(), { tenantId: "tenant-a", templateId: "kfs-personal", version: "1", templateType: "kfs", language: "hi", sourceTemplateId: "kfs-en", sourceVersion: "3", content, contentChecksumSha256: sum(content), proposedBy: "content-maker", approvedBy: "compliance-checker", approvalRef: "approval://template" }, [], NOW); }
function device() { return certifyFieldDevice({ tenantId: "tenant-a", deviceId: "device-1", platform: "android", osVersion: "16", browserVersion: "140", attestationRef: "attestation://1", encryptionEvidenceRef: "evidence://encryption", assistiveTechnologyEvidenceRef: "evidence://a11y", encryptedStorage: true, screenLockEnforced: true, remoteWipeEnabled: true, testedBy: "device-tester", approvedBy: "security-checker", approvalRef: "approval://device", expiresAt: "2027-01-15T00:00:00.000Z" }, [], NOW); }

test("language packs and localized templates require independent approval and exact checksums", () => {
  assert.throws(() => approveLanguagePack({ ...pack(), status: undefined, translatedBy: "same", reviewedBy: "same" }, [], NOW), (error) => error.code === "experience_four_eyes_required");
  const approved = template(); assert.equal(approved.language, "hi");
  assert.throws(() => approveLocalizedTemplate(pack(), { ...approved, content: "tampered", proposedBy: "maker", approvedBy: "checker" }, [], NOW), (error) => error.code === "localized_template_checksum_mismatch");
});

test("template resolution fails closed unless an explicit approved fallback exists", () => {
  const approved = template();
  assert.equal(resolveLocalizedTemplate([approved], { tenantId: "tenant-a", templateId: "kfs-personal", language: "hi" }).version, "1");
  assert.throws(() => resolveLocalizedTemplate([approved], { tenantId: "tenant-a", templateId: "kfs-personal", language: "ta" }), (error) => error.code === "localized_template_missing");
  const fallback = resolveLocalizedTemplate([approved], { tenantId: "tenant-a", templateId: "kfs-personal", language: "ta", allowApprovedFallback: true, fallbackLanguage: "hi" });
  assert.equal(fallback.fallbackFromLanguage, "ta");
});

test("field devices require security and accessibility certification evidence", () => {
  assert.throws(() => certifyFieldDevice({ tenantId: "tenant-a", deviceId: "bad", platform: "android", osVersion: "16", browserVersion: "140", attestationRef: "a", encryptionEvidenceRef: "e", assistiveTechnologyEvidenceRef: "a11y", encryptedStorage: false, screenLockEnforced: true, remoteWipeEnabled: true, testedBy: "tester", approvedBy: "checker", approvalRef: "approval", expiresAt: "2027-01-15T00:00:00.000Z" }, [], NOW), (error) => error.code === "device_certification_blocked");
  assert.equal(device().status, "certified");
});

test("encrypted offline queue rejects plaintext, replay and expiry and surfaces conflicts", () => {
  const ciphertext = "base64:ciphertext-only";
  const input = { tenantId: "tenant-a", envelopeId: "env-1", idempotencyKey: "idem-1", aggregateType: "lead", aggregateId: "lead-1", baseVersion: "4", ciphertext, ciphertextSha256: sum(ciphertext), keyId: "kms://field/1", algorithm: "AES-256-GCM", nonce: "nonce-value", authTag: "auth-tag", createdBy: "officer-1", expiresAt: "2026-07-16T10:00:00.000Z" };
  assert.throws(() => enqueueEncryptedOfflineWork(device(), { ...input, payload: { name: "plaintext" } }, [], NOW), (error) => error.code === "offline_plaintext_forbidden");
  const envelope = enqueueEncryptedOfflineWork(device(), input, [], NOW);
  assert.equal(Object.hasOwn(envelope, "payload"), false);
  assert.throws(() => enqueueEncryptedOfflineWork(device(), { ...input, envelopeId: "env-2" }, [envelope], NOW), (error) => error.code === "offline_idempotency_replay");
  const conflict = reconcileEncryptedOfflineWork(envelope, { tenantId: "tenant-a", currentVersion: "5", reconciledBy: "sync-worker", evidenceRef: "sync://conflict" }, [], NOW);
  assert.equal(conflict.status, "conflict");
  const applied = reconcileEncryptedOfflineWork(envelope, { tenantId: "tenant-a", currentVersion: "4", appliedVersion: "5", reconciledBy: "sync-worker", evidenceRef: "sync://applied" }, [], NOW);
  assert.equal(applied.status, "applied");
  assert.throws(() => reconcileEncryptedOfflineWork(envelope, { tenantId: "tenant-a", currentVersion: "4", reconciledBy: "sync-worker", evidenceRef: "x" }, [applied], NOW), (error) => error.code === "offline_idempotency_replay");
  assert.throws(() => reconcileEncryptedOfflineWork({ ...envelope, expiresAt: NOW.toISOString() }, { tenantId: "tenant-a", currentVersion: "4", reconciledBy: "sync-worker", evidenceRef: "x" }, [], NOW), (error) => error.code === "offline_envelope_expired");
});

test("offline queue rejects invalid device state or tenant mismatches", () => {
  const ciphertext = "base64:ciphertext-only";
  const input = { tenantId: "tenant-a", envelopeId: "env-1", idempotencyKey: "idem-1", aggregateType: "lead", aggregateId: "lead-1", baseVersion: "4", ciphertext, ciphertextSha256: sum(ciphertext), keyId: "kms://field/1", algorithm: "AES-256-GCM", nonce: "nonce-value", authTag: "auth-tag", createdBy: "officer-1", expiresAt: "2026-07-16T10:00:00.000Z" };
  
  // 1. Rejects if device is not certified (status is not 'certified')
  const uncertifiedDevice = { ...device(), status: "revoked" };
  assert.throws(() => enqueueEncryptedOfflineWork(uncertifiedDevice, input, [], NOW), (error) => error.code === "device_not_certified");

  // 2. Rejects if device certification is expired
  const expiredDevice = { ...device(), expiresAt: NOW.toISOString() };
  assert.throws(() => enqueueEncryptedOfflineWork(expiredDevice, input, [], NOW), (error) => error.code === "device_not_certified");

  // 3. Rejects if tenant mismatch between device and envelope
  const wrongTenantInput = { ...input, tenantId: "tenant-b" };
  assert.throws(() => enqueueEncryptedOfflineWork(device(), wrongTenantInput, [], NOW), (error) => error.code === "experience_tenant_mismatch");
});

