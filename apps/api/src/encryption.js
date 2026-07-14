import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Per-tenant encryption at rest.
//
// The tenancy model commits to per-tenant encryption keys (SaaS tenancy doc,
// "Data Residency, Privacy, and Keys"). This module implements envelope
// encryption over each tenant's data-plane partition:
//
//   active root key (resolved by the configured key provider)
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
// A fixed, non-secret salt is acceptable for HKDF here: the input keying
// material (the root key) is already a high-entropy secret, and the per-tenant
// separation comes from the `info` parameter (the tenantId).
const HKDF_SALT = Buffer.from("loanos-hkdf-salt-v1");

// The env provider is deliberately a development/test implementation of the
// provider contract, not a claim of production KMS custody. It supports an
// active key plus decrypt-only previous versions for online re-encryption.
export function getMasterKeyRing(env = process.env) {
  const raw = env.LOANOS_MASTER_KEYS;
  if (!raw) {
    if (env.NODE_ENV === "production" && (env.LOANOS_STORAGE_DRIVER ?? "file") === "file") {
      throw new Error("LOANOS_MASTER_KEYS and LOANOS_ACTIVE_MASTER_KEY_ID are required for production file storage.");
    }
    return null;
  }
  let encodedKeys;
  try {
    encodedKeys = JSON.parse(raw);
  } catch {
    throw new Error("LOANOS_MASTER_KEYS must be a JSON object mapping key ids to 32-byte hex/base64 keys.");
  }
  if (!encodedKeys || Array.isArray(encodedKeys) || typeof encodedKeys !== "object" || Object.keys(encodedKeys).length === 0) {
    throw new Error("LOANOS_MASTER_KEYS must contain at least one key.");
  }
  const activeKeyId = validateKeyId(env.LOANOS_ACTIVE_MASTER_KEY_ID);
  const keys = new Map();
  for (const [keyId, encoded] of Object.entries(encodedKeys)) {
    validateKeyId(keyId);
    keys.set(keyId, decodeKey(encoded, keyId));
  }
  if (!keys.has(activeKeyId)) throw new Error(`Active master key ${activeKeyId} is not present in LOANOS_MASTER_KEYS.`);
  return { provider: "env", activeKeyId, keys };
}

export function encryptionEnabled(env = process.env) {
  return getMasterKeyRing(env) !== null;
}

export function getActiveMasterKey(env = process.env) {
  const ring = getMasterKeyRing(env);
  if (!ring) return null;
  return { keyId: ring.activeKeyId, key: ring.keys.get(ring.activeKeyId), provider: ring.provider };
}

export function getMasterKeyById(keyId, env = process.env) {
  const ring = getMasterKeyRing(env);
  if (!ring) return null;
  const key = ring.keys.get(keyId);
  if (!key) throw new Error(`Master key ${keyId ?? "unknown"} is not available from the configured key provider.`);
  return { keyId, key, provider: ring.provider, active: keyId === ring.activeKeyId };
}

export function deriveTenantKey(masterKey, tenantId) {
  const info = Buffer.from(`${HKDF_INFO}:${tenantId}`);
  const derived = hkdfSync("sha256", masterKey, HKDF_SALT, info, KEY_BYTES);
  return Buffer.from(derived);
}

export function isEncryptedEnvelope(value) {
  return Boolean(value) && typeof value === "object" && typeof value.__enc === "string";
}

export function encryptTenantData(masterKey, tenantId, dataObject, keyId) {
  validateKeyId(keyId);
  const key = deriveTenantKey(masterKey, tenantId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  cipher.setAAD(envelopeAad(tenantId, keyId));
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

export function decryptTenantData(masterKey, tenantId, envelope) {
  if (envelope?.__enc !== ENVELOPE_VERSION || envelope?.alg !== ALG || typeof envelope?.kid !== "string" || typeof envelope?.iv !== "string" || typeof envelope?.tag !== "string" || typeof envelope?.ct !== "string") {
    throw new Error("Tenant data encryption envelope is malformed or unsupported.");
  }
  const key = deriveTenantKey(masterKey, tenantId);
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ct = Buffer.from(envelope.ct, "base64");
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAAD(envelopeAad(tenantId, envelope.kid));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

function envelopeAad(tenantId, keyId) {
  return Buffer.from(`${ENVELOPE_VERSION}:${tenantId}:${keyId}`, "utf8");
}

function validateKeyId(keyId) {
  if (!keyId || !/^[a-zA-Z0-9._:-]{3,128}$/.test(keyId)) {
    throw new Error("Master key id must be 3-128 safe characters.");
  }
  return keyId;
}

function decodeKey(raw, keyId) {
  if (typeof raw !== "string") throw new Error(`Master key ${keyId} must be encoded as a string.`);
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`Master key ${keyId} must decode to ${KEY_BYTES} bytes (got ${key.length}).`);
  }
  return key;
}
