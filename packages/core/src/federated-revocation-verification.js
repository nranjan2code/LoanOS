import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

import { FEDERATED_REVOCATION_PROTOCOLS } from "./identity-operational-automation.js";

export const FEDERATED_REVOCATION_SIGNATURE_ALGORITHMS = Object.freeze(["RS256", "ES256"]);

export function proposeFederatedRevocationVerifier(registry = {}, input = {}, now = new Date()) {
  for (const field of ["profileId", "tenantId", "policyId", "protocol", "issuer", "audience", "proposedBy", "providerProfileRef", "verificationEvidenceRef"]) required(input[field], field);
  if (!FEDERATED_REVOCATION_PROTOCOLS.includes(input.protocol)) fail("federated_revocation_protocol_invalid", "Revocation-verifier protocol is unsupported.");
  if (registry[input.profileId]) fail("federated_revocation_verifier_exists", "Revocation-verifier profile already exists.");
  if (input.commerciallyLive === true) fail("federated_revocation_live_claim_forbidden", "A simulator verifier cannot be represented as commercially live.");
  const keys = normalizeKeys(input.keys, now);
  const proposed = {
    profileId: input.profileId,
    tenantId: input.tenantId,
    policyId: input.policyId,
    protocol: input.protocol,
    issuer: input.issuer,
    audience: input.audience,
    providerProfileRef: input.providerProfileRef,
    verificationEvidenceRef: input.verificationEvidenceRef,
    keys,
    supersedesProfileId: optional(input.supersedesProfileId),
    executionMode: "simulated",
    commerciallyLive: false,
    status: "pending_approval",
    proposedBy: input.proposedBy,
    proposedAt: now.toISOString()
  };
  const profile = Object.freeze({ ...proposed, profileChecksumSha256: checksum(proposed) });
  return { registry: { ...registry, [profile.profileId]: profile }, profile };
}

export function approveFederatedRevocationVerifier(registry = {}, input = {}, now = new Date()) {
  for (const field of ["profileId", "tenantId", "approvedBy", "approvalRef"]) required(input[field], field);
  const pending = registry[input.profileId];
  if (!pending || pending.tenantId !== input.tenantId || pending.status !== "pending_approval") fail("federated_revocation_verifier_not_pending", "A same-tenant pending verifier profile is required.");
  verifyProfileChecksum(pending);
  if (pending.proposedBy === input.approvedBy) fail("federated_revocation_verifier_four_eyes_required", "Verifier activation requires an independent approver.");
  if (pending.supersedesProfileId) {
    const previous = registry[pending.supersedesProfileId];
    if (!previous || previous.tenantId !== input.tenantId || previous.status !== "active" || previous.policyId !== pending.policyId || previous.protocol !== pending.protocol) fail("federated_revocation_superseded_profile_invalid", "A rotation must supersede an active same-policy verifier profile.");
  }
  const next = { ...registry };
  for (const [profileId, profile] of Object.entries(next)) {
    if (profileId === pending.profileId || profile.tenantId !== input.tenantId || profile.policyId !== pending.policyId || profile.protocol !== pending.protocol || profile.status !== "active") continue;
    if (pending.supersedesProfileId !== profileId) fail("federated_revocation_active_verifier_exists", "An active verifier already exists; rotation must identify the superseded profile.");
    next[profileId] = Object.freeze({ ...profile, status: "superseded", supersededByProfileId: pending.profileId, supersededAt: now.toISOString() });
  }
  const activated = {
    ...pending,
    status: "active",
    approvedBy: input.approvedBy,
    approvalRef: input.approvalRef,
    approvedAt: now.toISOString()
  };
  const profile = Object.freeze({ ...activated, activationChecksumSha256: checksum(activated) });
  next[profile.profileId] = profile;
  return { registry: next, profile };
}

export function verifyFederatedRevocationEnvelope(registry = {}, input = {}, now = new Date()) {
  for (const field of ["tenantId", "profileId", "keyId", "payloadBase64Url", "signatureBase64Url"]) required(input[field], field);
  const profile = registry[input.profileId];
  if (!profile || profile.tenantId !== input.tenantId || profile.status !== "active") fail("federated_revocation_verifier_inactive", "An active same-tenant revocation verifier is required.");
  verifyProfileChecksum(profile);
  const key = profile.keys.find((candidate) => candidate.keyId === input.keyId);
  if (!key) fail("federated_revocation_key_unknown", "The signing key is not certified for this verifier.");
  const nowMs = now.getTime();
  if (Date.parse(key.validFrom) > nowMs || Date.parse(key.validUntil) <= nowMs) fail("federated_revocation_key_inactive", "The signing key is outside its certified validity window.");
  const payloadBytes = decodeBase64Url(input.payloadBase64Url, "payloadBase64Url");
  const signature = decodeBase64Url(input.signatureBase64Url, "signatureBase64Url");
  let publicKey;
  try { publicKey = createPublicKey({ key: key.publicJwk, format: "jwk" }); } catch { fail("federated_revocation_key_invalid", "The certified public key cannot be loaded."); }
  const algorithm = key.algorithm === "RS256" ? "RSA-SHA256" : "sha256";
  const verificationKey = key.algorithm === "ES256" ? { key: publicKey, dsaEncoding: "ieee-p1363" } : publicKey;
  if (!verifySignature(algorithm, payloadBytes, verificationKey, signature)) fail("federated_revocation_signature_invalid", "Provider revocation signature verification failed.");
  let event;
  try { event = JSON.parse(payloadBytes.toString("utf8")); } catch { fail("federated_revocation_payload_invalid", "Signed revocation payload must be valid JSON."); }
  if (!event || Array.isArray(event) || typeof event !== "object") fail("federated_revocation_payload_invalid", "Signed revocation payload must be an object.");
  if (event.tenantId !== input.tenantId || event.policyId !== profile.policyId || event.protocol !== profile.protocol || event.issuer !== profile.issuer || event.audience !== profile.audience) fail("federated_revocation_envelope_scope_mismatch", "Signed revocation payload does not match its tenant verifier profile.");
  const evidenceChecksumSha256 = checksumBytes(payloadBytes);
  return Object.freeze({
    event: { ...event, signatureVerified: true, providerEvidenceRef: `${profile.providerProfileRef}:${event.eventId}`, evidenceChecksumSha256, commerciallyLive: false },
    verification: Object.freeze({ profileId: profile.profileId, keyId: key.keyId, algorithm: key.algorithm, payloadChecksumSha256: evidenceChecksumSha256, profileChecksumSha256: profile.profileChecksumSha256, activationChecksumSha256: profile.activationChecksumSha256, verificationEvidenceRef: profile.verificationEvidenceRef, cryptographicallyVerified: true, verifiedAt: now.toISOString(), executionMode: "simulated", commerciallyLive: false })
  });
}

function normalizeKeys(value, now) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) fail("federated_revocation_keys_invalid", "One to five verifier keys are required.");
  const ids = new Set();
  return Object.freeze(value.map((entry) => {
    for (const field of ["keyId", "algorithm"]) required(entry?.[field], field);
    if (ids.has(entry.keyId)) fail("federated_revocation_key_duplicate", "Verifier key IDs must be unique.");
    ids.add(entry.keyId);
    if (!FEDERATED_REVOCATION_SIGNATURE_ALGORITHMS.includes(entry.algorithm)) fail("federated_revocation_algorithm_invalid", "Only RS256 and ES256 verifier keys are supported.");
    if (!entry.publicJwk || typeof entry.publicJwk !== "object" || Array.isArray(entry.publicJwk) || entry.publicJwk.d) fail("federated_revocation_key_invalid", "A public, non-private JWK is required.");
    if ((entry.algorithm === "RS256" && entry.publicJwk.kty !== "RSA") || (entry.algorithm === "ES256" && (entry.publicJwk.kty !== "EC" || entry.publicJwk.crv !== "P-256"))) fail("federated_revocation_key_algorithm_mismatch", "Verifier JWK type and curve must match the declared algorithm.");
    try { createPublicKey({ key: entry.publicJwk, format: "jwk" }); } catch { fail("federated_revocation_key_invalid", "Verifier public JWK is invalid."); }
    const validFrom = iso(entry.validFrom ?? now.toISOString(), "validFrom");
    const validUntil = iso(entry.validUntil, "validUntil");
    if (Date.parse(validUntil) <= Date.parse(validFrom)) fail("federated_revocation_key_window_invalid", "Verifier key validity must end after it begins.");
    return Object.freeze({ keyId: entry.keyId, algorithm: entry.algorithm, publicJwk: structuredClone(entry.publicJwk), validFrom, validUntil, keyEvidenceRef: required(entry.keyEvidenceRef, "keyEvidenceRef") });
  }));
}

function verifyProfileChecksum(profile) {
  const { profileChecksumSha256, activationChecksumSha256: _activation, approvedBy: _approvedBy, approvalRef: _approvalRef, approvedAt: _approvedAt, status, supersededByProfileId: _supersededBy, supersededAt: _supersededAt, ...base } = profile;
  const proposed = { ...base, status: "pending_approval" };
  if (checksum(proposed) !== profileChecksumSha256) fail("federated_revocation_profile_tampered", "Verifier profile checksum validation failed.");
  if (status === "active" && profile.activationChecksumSha256) {
    const activated = { ...base, profileChecksumSha256, status, approvedBy: profile.approvedBy, approvalRef: profile.approvalRef, approvedAt: profile.approvedAt };
    if (checksum(activated) !== profile.activationChecksumSha256) fail("federated_revocation_profile_tampered", "Verifier activation checksum validation failed.");
  }
}

function decodeBase64Url(value, field) { try { const bytes = Buffer.from(value, "base64url"); if (!bytes.length || bytes.toString("base64url") !== value.replace(/=+$/u, "")) throw new Error(); return bytes; } catch { fail("federated_revocation_envelope_invalid", `${field} is not canonical base64url.`); } }
function checksum(value) { return checksumBytes(Buffer.from(stable(value))); }
function checksumBytes(value) { return createHash("sha256").update(value).digest("hex"); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function optional(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function iso(value, field) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) fail("federated_revocation_input_invalid", `${field} must be an ISO date-time.`); return new Date(parsed).toISOString(); }
function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("federated_revocation_input_invalid", `${field} is required.`); return value.trim(); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
