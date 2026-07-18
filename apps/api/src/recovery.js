import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { verifyAuditChain } from "@loanos/core";

const FORMAT = "loanos.recovery.v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const PLATFORM_AUDIT_SCOPE = "platform";
const RECOVERY_KEY_SALT = Buffer.from("loanos-recovery-salt-v1");

export function createRecoveryBackup(state, input, masterKey, now = new Date()) {
  validateBackupInput(input, now);
  validateMasterKey(masterKey);
  const integrity = validateRecoveryState(state);
  if (!integrity.valid) throw recoveryError("backup_source_integrity_failed", integrity.reason);

  const backupId = String(input.backupId);
  const createdAt = now.toISOString();
  const plaintext = Buffer.from(JSON.stringify(state), "utf8");
  const contentSha256 = digest(plaintext);
  const manifest = {
    backupId,
    createdAt,
    format: FORMAT,
    stateVersion: state.version,
    sourceRegion: String(input.sourceRegion),
    residencyCountry: "IN",
    storageLocationRef: String(input.storageLocationRef),
    retentionUntil: new Date(input.retentionUntil).toISOString(),
    keyId: masterKey.keyId,
    keyProvider: masterKey.provider,
    tenantCount: Object.keys(state.tenants ?? {}).length,
    contentBytes: plaintext.length,
    contentSha256,
    audit: integrity.audit
  };
  const key = deriveRecoveryKey(masterKey.key, backupId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(manifestAad(manifest));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = {
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
  const recoveryPackage = { format: FORMAT, manifest, envelope };
  return { ...recoveryPackage, packageSha256: packageDigest(recoveryPackage) };
}

export function inspectRecoveryBackup(recoveryPackage, masterKey, now = new Date()) {
  validatePackageShape(recoveryPackage, now);
  validateMasterKey(masterKey);
  if (masterKey.keyId !== recoveryPackage.manifest.keyId) {
    throw recoveryError("backup_key_mismatch", "The resolved key does not match the backup manifest key id.");
  }
  const expectedPackageDigest = packageDigest({
    format: recoveryPackage.format,
    manifest: recoveryPackage.manifest,
    envelope: recoveryPackage.envelope
  });
  if (expectedPackageDigest !== recoveryPackage.packageSha256) {
    throw recoveryError("backup_package_integrity_failed", "Backup package checksum does not match.");
  }

  let plaintext;
  try {
    const key = deriveRecoveryKey(masterKey.key, recoveryPackage.manifest.backupId);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(recoveryPackage.envelope.iv, "base64"));
    decipher.setAAD(manifestAad(recoveryPackage.manifest));
    decipher.setAuthTag(Buffer.from(recoveryPackage.envelope.tag, "base64"));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(recoveryPackage.envelope.ciphertext, "base64")),
      decipher.final()
    ]);
  } catch {
    throw recoveryError("backup_decryption_failed", "Backup authentication or decryption failed.");
  }
  if (digest(plaintext) !== recoveryPackage.manifest.contentSha256) {
    throw recoveryError("backup_content_integrity_failed", "Decrypted backup content checksum does not match.");
  }

  let state;
  try {
    state = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw recoveryError("backup_content_invalid", "Decrypted backup is not valid JSON state.");
  }
  const integrity = validateRecoveryState(state);
  if (!integrity.valid) throw recoveryError("backup_state_integrity_failed", integrity.reason);
  if (state.version !== recoveryPackage.manifest.stateVersion || Object.keys(state.tenants ?? {}).length !== recoveryPackage.manifest.tenantCount || plaintext.length !== recoveryPackage.manifest.contentBytes || JSON.stringify(integrity.audit) !== JSON.stringify(recoveryPackage.manifest.audit)) {
    throw recoveryError("backup_manifest_mismatch", "Backup manifest does not match decrypted state.");
  }
  return {
    verification: {
      valid: true,
      backupId: recoveryPackage.manifest.backupId,
      createdAt: recoveryPackage.manifest.createdAt,
      packageSha256: recoveryPackage.packageSha256,
      contentSha256: recoveryPackage.manifest.contentSha256,
      tenantCount: recoveryPackage.manifest.tenantCount,
      stateVersion: recoveryPackage.manifest.stateVersion,
      residencyCountry: recoveryPackage.manifest.residencyCountry,
      audit: integrity.audit
    },
    state
  };
}

export function evaluateRecoveryObjectives(manifest, input, recoveredAt = new Date()) {
  const declaredAt = validDate(input.recoveryDeclaredAt, "recoveryDeclaredAt");
  const backupAt = validDate(manifest.createdAt, "backup createdAt");
  const rpoTargetMinutes = positiveNumber(input.rpoTargetMinutes, "rpoTargetMinutes");
  const rtoTargetMinutes = positiveNumber(input.rtoTargetMinutes, "rtoTargetMinutes");
  if (declaredAt.getTime() > recoveredAt.getTime()) throw recoveryError("recovery_timeline_invalid", "Recovery declaration cannot be in the future.");
  if (backupAt.getTime() > declaredAt.getTime()) throw recoveryError("recovery_timeline_invalid", "Recovery point must not be newer than the recovery declaration.");
  const actualRpoMinutes = Math.max(0, roundMinutes(declaredAt.getTime() - backupAt.getTime()));
  const actualRtoMinutes = Math.max(0, roundMinutes(recoveredAt.getTime() - declaredAt.getTime()));
  const rpoMet = actualRpoMinutes <= rpoTargetMinutes;
  const rtoMet = actualRtoMinutes <= rtoTargetMinutes;
  return {
    recoveryDeclaredAt: declaredAt.toISOString(),
    recoveredAt: recoveredAt.toISOString(),
    rpo: { targetMinutes: rpoTargetMinutes, actualMinutes: actualRpoMinutes, met: rpoMet },
    rto: { targetMinutes: rtoTargetMinutes, actualMinutes: actualRtoMinutes, met: rtoMet },
    status: rpoMet && rtoMet ? "objectives_met" : "objectives_breached"
  };
}

export function buildRecoveryExercise(manifest, verification, input, completedAt = new Date()) {
  const scenarios = new Set(["backup_restore", "data_corruption", "az_failover", "regional_failover", "failback", "business_continuity"]);
  if (!input.exerciseId || !scenarios.has(input.scenario) || !input.changeTicket || !input.proposedBy || !input.approvedBy || input.proposedBy === input.approvedBy) {
    throw recoveryError("recovery_exercise_invalid", "exerciseId, supported scenario, changeTicket, and independent proposer/approver are required.");
  }
  if (!input.reason || String(input.reason).trim().length < 8) throw recoveryError("recovery_exercise_invalid", "A specific exercise reason is required.");
  const objectives = evaluateRecoveryObjectives(manifest, input, completedAt);
  const findings = Array.isArray(input.findings) ? input.findings.map(String).filter(Boolean) : [];
  const actions = Array.isArray(input.actions) ? input.actions.map(String).filter(Boolean) : [];
  return {
    exerciseId: String(input.exerciseId),
    scenario: input.scenario,
    backupId: manifest.backupId,
    packageSha256: verification.packageSha256,
    status: objectives.status === "objectives_met" && findings.length === 0 ? "passed" : "needs_remediation",
    objectives,
    changeTicket: String(input.changeTicket),
    reason: String(input.reason),
    proposedBy: String(input.proposedBy),
    approvedBy: String(input.approvedBy),
    findings,
    actions,
    completedAt: completedAt.toISOString()
  };
}

export function validateRecoveryState(state) {
  if (!state || typeof state !== "object" || !Number.isInteger(state.version) || !state.controlPlane || typeof state.controlPlane !== "object" || !state.tenants || typeof state.tenants !== "object") {
    return { valid: false, reason: "Recovery state structure is invalid." };
  }
  const platform = verifyAuditChain(state.controlPlane.platformEvents ?? [], PLATFORM_AUDIT_SCOPE);
  if (!platform.valid) return { valid: false, reason: `Platform audit chain is invalid: ${platform.reason}.` };
  const tenantResults = {};
  for (const [tenantId, tenantData] of Object.entries(state.tenants)) {
    if (!state.controlPlane.tenants?.[tenantId]) return { valid: false, reason: `Tenant data ${tenantId} has no control-plane record.` };
    const result = verifyAuditChain(tenantData?.events ?? [], tenantId);
    if (!result.valid) return { valid: false, reason: `Tenant ${tenantId} audit chain is invalid: ${result.reason}.` };
    tenantResults[tenantId] = { eventCount: result.count, headHash: result.headHash };
  }
  for (const [tenantId, tenant] of Object.entries(state.controlPlane.tenants ?? {})) {
    if (tenant.status !== "offboarded" && !state.tenants[tenantId]) return { valid: false, reason: `Active tenant ${tenantId} has no data partition.` };
  }
  return {
    valid: true,
    reason: null,
    audit: {
      platform: { eventCount: platform.count, headHash: platform.headHash },
      tenants: tenantResults
    }
  };
}

function validateBackupInput(input, now) {
  if (!input?.backupId || !/^[a-zA-Z0-9._:-]{6,128}$/.test(String(input.backupId))) throw recoveryError("backup_request_invalid", "A safe backupId is required.");
  if (!input.sourceRegion || !input.storageLocationRef || input.residencyCountry !== "IN") throw recoveryError("backup_request_invalid", "India residency, sourceRegion, and storageLocationRef are required.");
  if (!input.reason || String(input.reason).trim().length < 8) throw recoveryError("backup_request_invalid", "A specific backup reason is required.");
  const retentionUntil = validDate(input.retentionUntil, "retentionUntil");
  if (retentionUntil.getTime() <= now.getTime()) throw recoveryError("backup_request_invalid", "retentionUntil must be in the future.");
}

function validatePackageShape(value, now) {
  if (!value || value.format !== FORMAT || value.manifest?.format !== FORMAT || value.envelope?.algorithm !== ALGORITHM || !value.packageSha256 || !value.manifest?.backupId || !value.manifest?.keyId || value.manifest?.residencyCountry !== "IN" || !value.envelope?.iv || !value.envelope?.tag || !value.envelope?.ciphertext) {
    throw recoveryError("backup_package_invalid", "Backup package is malformed, unsupported, or outside India residency policy.");
  }
  const createdAt = validDate(value.manifest.createdAt, "backup createdAt");
  const retentionUntil = validDate(value.manifest.retentionUntil, "retentionUntil");
  if (!value.manifest.sourceRegion || !value.manifest.storageLocationRef || retentionUntil.getTime() <= now.getTime() || createdAt.getTime() > now.getTime() + 5 * 60_000) {
    throw recoveryError("backup_package_expired", "Backup location/timeline is invalid or outside its approved retention period.");
  }
}

function validateMasterKey(masterKey) {
  if (!masterKey?.keyId || !Buffer.isBuffer(masterKey.key) || masterKey.key.length !== KEY_BYTES) throw recoveryError("backup_key_unavailable", "A valid 32-byte recovery master key is required.");
}

function deriveRecoveryKey(masterKey, backupId) {
  return Buffer.from(hkdfSync("sha256", masterKey, RECOVERY_KEY_SALT, Buffer.from(`${FORMAT}:${backupId}`), KEY_BYTES));
}

function manifestAad(manifest) {
  return Buffer.from(JSON.stringify(manifest), "utf8");
}

function packageDigest(value) {
  return digest(Buffer.from(JSON.stringify(value), "utf8"));
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validDate(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw recoveryError("recovery_timeline_invalid", `${label} must be a valid timestamp.`);
  return date;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw recoveryError("recovery_objective_invalid", `${label} must be positive.`);
  return parsed;
}

function roundMinutes(milliseconds) {
  return Math.round((milliseconds / 60_000) * 100) / 100;
}

function recoveryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
