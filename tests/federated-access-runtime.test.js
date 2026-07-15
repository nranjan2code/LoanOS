import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { canonicalFederationEvidence, evaluateAuthenticationAssurance, federatedPrincipalFromClaims, scimUserResourceToIdentityEvent, verifyOidcIdToken, verifySamlValidationAttestation } from "../packages/core/src/federated-access-runtime.js";
import { validateFederatedLogin } from "../apps/api/src/federation-runtime.js";

const NOW = new Date("2026-07-15T06:30:00.000Z");
const policy = { issuer: "https://identity.bank.in", audience: "loanos-bank", allowedDomains: ["bank.in"], groupMappings: { credit: { canonicalRoleIds: ["credit_maker"] } } };

test("OIDC runtime verifies JWKS signature, issuer, audience, nonce and phishing-resistant managed-device assurance", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }); jwk.kid = "bank-key-1"; jwk.alg = "RS256"; jwk.use = "sig";
  const claims = { iss: policy.issuer, aud: policy.audience, sub: "employee-42", email: "credit@bank.in", name: "Credit Officer", groups: ["credit"], nonce: "nonce-1", iat: seconds(-30), nbf: seconds(-30), exp: seconds(300), auth_time: seconds(-60), amr: ["mfa", "webauthn"] };
  const token = jwt(privateKey, { alg: "RS256", kid: jwk.kid, typ: "JWT" }, claims);
  const verification = verifyOidcIdToken(token, policy, { keys: [jwk] }, { nonce: "nonce-1", assurancePolicy: { mfaRequired: true, hardwareBoundRequired: true, managedDeviceRequired: true }, devicePosture: { signatureVerified: true, status: "compliant", deviceId: "device-1", issuer: "mdm-bank", evidenceRef: "mdm://evidence/1", checkedAt: new Date(NOW.getTime() - 30_000).toISOString() } }, NOW);
  assert.equal(verification.assurance.assuranceLevel, "phishing_resistant_managed_device");
  assert.deepEqual(federatedPrincipalFromClaims(policy, verification).requestedCanonicalRoleIds, ["credit_maker"]);
  const [encodedHeader, encodedClaims, encodedSignature] = token.split(".");
  const tamperedClaims = Buffer.from(JSON.stringify({ ...claims, sub: "attacker" })).toString("base64url");
  assert.throws(() => verifyOidcIdToken(`${encodedHeader}.${tamperedClaims}.${encodedSignature}`, policy, { keys: [jwk] }, { nonce: "nonce-1", assurancePolicy: {} }, NOW), (error) => error.code === "oidc_signature_invalid");
});

test("SAML runtime accepts only gateway-attested signed encrypted assertions and enforces replay binding", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const samlPolicy = { ...policy, samlValidationGatewayKeyId: "gateway-key-1", samlValidationGatewayJwk: publicKey.export({ format: "jwk" }) };
  const evidence = { validationKeyId: "gateway-key-1", signatureVerified: true, schemaValidated: true, assertionEncrypted: true, issuer: policy.issuer, audience: policy.audience, subject: "employee-42", email: "credit@bank.in", assertionId: "assertion-1", assertionChecksumSha256: "a".repeat(64), validationProviderRef: "gateway://saml/1", notBefore: new Date(NOW.getTime() - 60_000).toISOString(), notOnOrAfter: new Date(NOW.getTime() + 300_000).toISOString(), inResponseTo: "request-1", authenticatedAt: new Date(NOW.getTime() - 30_000).toISOString(), groups: ["credit"], amr: ["mfa"] };
  const attestation = { ...evidence, attestationSignature: sign("RSA-SHA256", Buffer.from(canonicalFederationEvidence(evidence)), privateKey).toString("base64url") };
  assert.equal(verifySamlValidationAttestation(attestation, samlPolicy, { expectedRequestId: "request-1", assurancePolicy: {} }, NOW).replayId, "assertion-1");
  assert.throws(() => verifySamlValidationAttestation({ ...attestation, assertionEncrypted: false }, samlPolicy, { expectedRequestId: "request-1" }, NOW), (error) => error.code === "saml_gateway_signature_invalid");
});

test("assurance and SCIM translation fail closed on missing factors and preserve role-request boundaries", () => {
  assert.throws(() => evaluateAuthenticationAssurance({ auth_time: seconds(-30), amr: ["pwd"] }, {}, null, NOW), (error) => error.code === "federated_mfa_required");
  const event = scimUserResourceToIdentityEvent({ id: "external-1", externalId: "external-1", userName: "user@bank.in", displayName: "Bank User", active: true, groups: [{ value: "credit" }] }, { policyId: "idp-1", eventId: "event-1", idempotencyKey: "key-1" });
  assert.equal(event.operation, "upsert"); assert.deepEqual(event.groups, ["credit"]); assert.equal(event.adminRoles, undefined);
});

test("OIDC connector pins certified discovery bytes and follows only its HTTPS JWKS", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 }); const jwk = publicKey.export({ format: "jwk" }); Object.assign(jwk, { kid: "k1", alg: "RS256", use: "sig" });
  const metadataText = JSON.stringify({ issuer: policy.issuer, authorization_endpoint: `${policy.issuer}/authorize`, token_endpoint: `${policy.issuer}/token`, jwks_uri: `${policy.issuer}/jwks` });
  const certified = { ...policy, protocol: "oidc", status: "active", metadataUrl: `${policy.issuer}/.well-known/openid-configuration`, metadataChecksumSha256: createHash("sha256").update(metadataText).digest("hex"), metadataValidUntil: "2027-07-15T00:00:00.000Z", mfaRequired: true };
  const claims = { iss: policy.issuer, aud: policy.audience, sub: "employee-42", email: "credit@bank.in", groups: ["credit"], nonce: "n1", iat: seconds(-30), exp: seconds(300), auth_time: seconds(-30), amr: ["mfa"] };
  const token = jwt(privateKey, { alg: "RS256", kid: "k1" }, claims);
  const fetchImpl = async (url) => new Response(url.endsWith("/jwks") ? JSON.stringify({ keys: [jwk] }) : metadataText, { status: 200, headers: { "content-type": "application/json" } });
  const result = await validateFederatedLogin(certified, { idToken: token }, { nonce: "n1", now: NOW, fetchImpl });
  assert.equal(result.principal.externalId, "employee-42");
  await assert.rejects(() => validateFederatedLogin({ ...certified, metadataChecksumSha256: "0".repeat(64) }, { idToken: token }, { nonce: "n1", now: NOW, fetchImpl }), (error) => error.code === "federation_metadata_checksum_mismatch");
});

function seconds(delta) { return Math.floor((NOW.getTime() + delta * 1000) / 1000); }
function jwt(privateKey, header, claims) { const encoded = [header, claims].map((value) => Buffer.from(JSON.stringify(value)).toString("base64url")); const signature = sign("RSA-SHA256", Buffer.from(encoded.join(".")), privateKey).toString("base64url"); return `${encoded.join(".")}.${signature}`; }
