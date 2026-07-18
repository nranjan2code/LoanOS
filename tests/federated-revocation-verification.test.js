import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  approveFederatedRevocationVerifier,
  proposeFederatedRevocationVerifier,
  verifyFederatedRevocationEnvelope
} from "@loanos/core/identity/federated-revocation-verification.js";

const NOW = new Date("2026-07-15T12:00:00.000Z");

function fixture(profileId = "verifier-1", supersedesProfileId = null) {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const proposed = proposeFederatedRevocationVerifier({}, {
    profileId,
    tenantId: "tenant-a",
    policyId: "idp-1",
    protocol: "oidc_backchannel_logout",
    issuer: "https://idp.bank.in",
    audience: "loanos",
    proposedBy: "maker",
    providerProfileRef: "candidate-idp",
    verificationEvidenceRef: "evidence://verifier-uat",
    supersedesProfileId,
    keys: [{ keyId: `${profileId}-key`, algorithm: "RS256", publicJwk: pair.publicKey.export({ format: "jwk" }), validFrom: "2026-07-15T00:00:00Z", validUntil: "2026-08-15T00:00:00Z", keyEvidenceRef: "evidence://public-key" }]
  }, NOW);
  return { pair, proposed };
}

test("verifier activation is four-eyes, public-key only and non-live", () => {
  const { proposed } = fixture();
  assert.equal(proposed.profile.commerciallyLive, false);
  assert.equal(proposed.profile.keys[0].publicJwk.d, undefined);
  assert.throws(() => approveFederatedRevocationVerifier(proposed.registry, { profileId: "verifier-1", tenantId: "tenant-a", approvedBy: "maker", approvalRef: "approval://self" }, NOW), (error) => error.code === "federated_revocation_verifier_four_eyes_required");
  const approved = approveFederatedRevocationVerifier(proposed.registry, { profileId: "verifier-1", tenantId: "tenant-a", approvedBy: "checker", approvalRef: "approval://verifier" }, NOW);
  assert.equal(approved.profile.status, "active");
  assert.match(approved.profile.activationChecksumSha256, /^[a-f0-9]{64}$/);
});

test("signed envelope is cryptographically verified and bound to tenant policy key and exact bytes", () => {
  const { pair, proposed } = fixture();
  const approved = approveFederatedRevocationVerifier(proposed.registry, { profileId: "verifier-1", tenantId: "tenant-a", approvedBy: "checker", approvalRef: "approval://verifier" }, NOW);
  const event = { eventId: "logout-1", tenantId: "tenant-a", policyId: "idp-1", protocol: "oidc_backchannel_logout", issuer: "https://idp.bank.in", audience: "loanos", subject: "subject-1", providerSessionId: "sid-1", issuedAt: "2026-07-15T11:59:00Z", expiresAt: "2026-07-15T12:04:00Z" };
  const bytes = Buffer.from(JSON.stringify(event));
  const envelope = { tenantId: "tenant-a", profileId: "verifier-1", keyId: "verifier-1-key", payloadBase64Url: bytes.toString("base64url"), signatureBase64Url: sign("RSA-SHA256", bytes, pair.privateKey).toString("base64url") };
  const verified = verifyFederatedRevocationEnvelope(approved.registry, envelope, NOW);
  assert.equal(verified.event.signatureVerified, true);
  assert.equal(verified.event.eventId, "logout-1");
  assert.equal(verified.verification.keyId, "verifier-1-key");
  assert.throws(() => verifyFederatedRevocationEnvelope(approved.registry, { ...envelope, tenantId: "tenant-b" }, NOW), (error) => error.code === "federated_revocation_verifier_inactive");
  const tampered = Buffer.from(JSON.stringify({ ...event, subject: "other" })).toString("base64url");
  assert.throws(() => verifyFederatedRevocationEnvelope(approved.registry, { ...envelope, payloadBase64Url: tampered }, NOW), (error) => error.code === "federated_revocation_signature_invalid");
});

test("ES256 accepts the JOSE P-256 raw signature format and rejects algorithm-key confusion", () => {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const proposed = proposeFederatedRevocationVerifier({}, {
    profileId: "verifier-ec", tenantId: "tenant-a", policyId: "idp-1", protocol: "oidc_backchannel_logout", issuer: "https://idp.bank.in", audience: "loanos", proposedBy: "maker", providerProfileRef: "candidate-idp", verificationEvidenceRef: "evidence://ec-uat",
    keys: [{ keyId: "ec-key", algorithm: "ES256", publicJwk: pair.publicKey.export({ format: "jwk" }), validFrom: "2026-07-15T00:00:00Z", validUntil: "2026-08-15T00:00:00Z", keyEvidenceRef: "evidence://ec-key" }]
  }, NOW);
  const active = approveFederatedRevocationVerifier(proposed.registry, { profileId: "verifier-ec", tenantId: "tenant-a", approvedBy: "checker", approvalRef: "approval://ec" }, NOW);
  const event = { eventId: "logout-ec", tenantId: "tenant-a", policyId: "idp-1", protocol: "oidc_backchannel_logout", issuer: "https://idp.bank.in", audience: "loanos", subject: "subject-ec", issuedAt: "2026-07-15T11:59:00Z", expiresAt: "2026-07-15T12:04:00Z" };
  const bytes = Buffer.from(JSON.stringify(event));
  const verified = verifyFederatedRevocationEnvelope(active.registry, { tenantId: "tenant-a", profileId: "verifier-ec", keyId: "ec-key", payloadBase64Url: bytes.toString("base64url"), signatureBase64Url: sign("sha256", bytes, { key: pair.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url") }, NOW);
  assert.equal(verified.verification.algorithm, "ES256");
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() => proposeFederatedRevocationVerifier({}, { ...proposed.profile, profileId: "confused", keys: [{ ...proposed.profile.keys[0], algorithm: "ES256", publicJwk: rsa.publicKey.export({ format: "jwk" }) }] }, NOW), (error) => error.code === "federated_revocation_key_algorithm_mismatch");
});

test("key rotation explicitly supersedes the prior verifier and retains lineage", () => {
  const first = fixture();
  const active = approveFederatedRevocationVerifier(first.proposed.registry, { profileId: "verifier-1", tenantId: "tenant-a", approvedBy: "checker", approvalRef: "approval://v1" }, NOW);
  const second = fixture("verifier-2", "verifier-1");
  const registry = { ...active.registry, ...second.proposed.registry };
  const rotated = approveFederatedRevocationVerifier(registry, { profileId: "verifier-2", tenantId: "tenant-a", approvedBy: "checker-2", approvalRef: "approval://v2" }, new Date("2026-07-16T12:00:00Z"));
  assert.equal(rotated.registry["verifier-1"].status, "superseded");
  assert.equal(rotated.profile.status, "active");
  assert.equal(rotated.profile.supersedesProfileId, "verifier-1");
});
