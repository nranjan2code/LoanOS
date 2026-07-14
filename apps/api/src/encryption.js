import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Per-tenant encryption at rest.
//
// The tenancy model commits to per-tenant encryption keys (SaaS tenancy doc,
// "Data Residency, Privacy, and Keys"). This module implements envelope
// encryption over each tenant's data-plane partition:
//
//   root key (LOANOS_MASTER_KEY, a KMS-held secret in production)
//     └─ HKDF-SHA256 per tenantId ─▶ per-tenant data-encryption key (DEK)
//         └─ AES-256-GCM ─▶ ciphertext + auth tag written to disk
//
// Because each tenant's DEK is derived from the root key and the tenantId, no
// two tenants share a key, and destroying a tenant's ciphertext (offboarding)
// renders its data unrecoverable even if the root key survives. The root key
// itself is never written to disk.
//
// File storage may remain plaintext only in development and test. Production
// file storage fails at startup without a master key; production deployments
// should use Postgres with independently evidenced database encryption.

const ALG = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const HKDF_INFO = "loanos:tenant-dek:v1";
const DEFAULT_KEY_ID = "local-root-v1";
// A fixed, non-secret salt is acceptable for HKDF here: the input keying
// material (the root key) is already a high-entropy secret, and the per-tenant
// separation comes from the `info` parameter (the tenantId).
const HKDF_SALT = Buffer.from("loanos-hkdf-salt-v1");

// Parse LOANOS_MASTER_KEY as 32 raw bytes from hex (64 chars) or base64.
export function getMasterKey(env = process.env) {
  const raw = env.LOANOS_MASTER_KEY;
  if (!raw) {
    if (env.NODE_ENV === "production" && (env.LOANOS_STORAGE_DRIVER ?? "file") === "file") {
      throw new Error("LOANOS_MASTER_KEY is required for production file storage.");
    }
    return null;
  }
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(`LOANOS_MASTER_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Use 64 hex chars or base64 of 32 bytes.`);
  }
  return key;
}

export function encryptionEnabled(env = process.env) {
  return getMasterKey(env) !== null;
}

export function getMasterKeyId(env = process.env) {
  const keyId = env.LOANOS_MASTER_KEY_ID ?? DEFAULT_KEY_ID;
  if (!/^[a-zA-Z0-9._:-]{3,128}$/.test(keyId)) {
    throw new Error("LOANOS_MASTER_KEY_ID must be 3-128 safe characters.");
  }
  return keyId;
}

export function deriveTenantKey(masterKey, tenantId) {
  const info = Buffer.from(`${HKDF_INFO}:${tenantId}`);
  const derived = hkdfSync("sha256", masterKey, HKDF_SALT, info, KEY_BYTES);
  return Buffer.from(derived);
}

export function isEncryptedEnvelope(value) {
  return Boolean(value) && typeof value === "object" && value.__enc === ENVELOPE_VERSION && typeof value.ct === "string";
}

export function encryptTenantData(masterKey, tenantId, dataObject, keyId = getMasterKeyId()) {
  const key = deriveTenantKey(masterKey, tenantId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  const plaintext = Buffer.from(JSON.stringify(dataObject), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    __enc: ENVELOPE_VERSION,
    alg: ALG,
    kid: keyId,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64")
  };
}

export function decryptTenantData(masterKey, tenantId, envelope, expectedKeyId = getMasterKeyId()) {
  if (envelope.kid !== expectedKeyId) {
    throw new Error(`Tenant data requires master key ${envelope.kid ?? "unknown"}; active key is ${expectedKeyId}.`);
  }
  const key = deriveTenantKey(masterKey, tenantId);
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ct = Buffer.from(envelope.ct, "base64");
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}
