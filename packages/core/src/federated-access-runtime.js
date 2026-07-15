import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

const OIDC_ALGORITHMS = Object.freeze({ RS256: "RSA-SHA256", RS384: "RSA-SHA384", RS512: "RSA-SHA512", ES256: "sha256", ES384: "sha384", ES512: "sha512" });
const MFA_AMR = new Set(["mfa", "otp", "totp", "hwk", "webauthn", "fido", "fido2"]);
const HARDWARE_AMR = new Set(["hwk", "webauthn", "fido", "fido2"]);

export function verifyOidcIdToken(token, policy, jwks, options = {}, now = new Date()) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) fail("oidc_token_malformed", "OIDC ID token must be a compact signed JWT.");
  const header = jsonPart(parts[0], "oidc_header_invalid");
  const claims = jsonPart(parts[1], "oidc_claims_invalid");
  if (!OIDC_ALGORITHMS[header.alg] || header.alg === "none") fail("oidc_algorithm_forbidden", "OIDC token algorithm is not allowed.");
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const candidates = keys.filter((key) => (!header.kid || key.kid === header.kid) && (!key.alg || key.alg === header.alg) && (!key.use || key.use === "sig"));
  if (candidates.length !== 1) fail("oidc_signing_key_untrusted", "OIDC signing key must resolve to exactly one trusted JWKS key.");
  let publicKey;
  try { publicKey = createPublicKey({ key: candidates[0], format: "jwk" }); }
  catch { fail("oidc_signing_key_invalid", "OIDC signing key is invalid."); }
  const signature = base64url(parts[2]);
  const valid = verifySignature(OIDC_ALGORITHMS[header.alg], Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, signature);
  if (!valid) fail("oidc_signature_invalid", "OIDC token signature is invalid.");
  validateCommonClaims(claims, policy, options, now);
  if (options.nonce && claims.nonce !== options.nonce) fail("oidc_nonce_invalid", "OIDC nonce does not match the initiated login.");
  const assurance = evaluateAuthenticationAssurance(claims, options.assurancePolicy ?? {}, options.devicePosture, now);
  return { protocol: "oidc", header: { alg: header.alg, kid: header.kid ?? null }, claims, assurance, evidenceChecksumSha256: digest(token) };
}

export function verifySamlValidationAttestation(attestation, policy, options = {}, now = new Date()) {
  requiredObject(attestation, "saml_attestation_invalid");
  const { attestationSignature, ...signedEvidence } = attestation;
  if (attestation.validationKeyId !== policy.samlValidationGatewayKeyId || !policy.samlValidationGatewayJwk) fail("saml_gateway_untrusted", "SAML validation gateway key is not certified for this policy.");
  let gatewayKey;
  try { gatewayKey = createPublicKey({ key: policy.samlValidationGatewayJwk, format: "jwk" }); } catch { fail("saml_gateway_untrusted", "SAML validation gateway key is invalid."); }
  const gatewaySignatureValid = verifySignature("RSA-SHA256", Buffer.from(canonicalFederationEvidence(signedEvidence)), gatewayKey, base64url(attestationSignature));
  if (!gatewaySignatureValid) fail("saml_gateway_signature_invalid", "SAML validation attestation signature is invalid.");
  if (attestation.signatureVerified !== true || attestation.schemaValidated !== true) fail("saml_signature_invalid", "SAML gateway must attest schema and XML signature validation.");
  if (attestation.assertionEncrypted !== true) fail("saml_assertion_unencrypted", "SAML assertion must be encrypted for LoanOS.");
  if (attestation.issuer !== policy.issuer || attestation.audience !== policy.audience) fail("saml_claim_mismatch", "SAML issuer or audience does not match policy.");
  for (const field of ["subject", "email", "assertionId", "assertionChecksumSha256", "validationProviderRef"]) text(attestation[field], field);
  digestField(attestation.assertionChecksumSha256, "assertionChecksumSha256");
  const notBefore = Date.parse(attestation.notBefore);
  const notOnOrAfter = Date.parse(attestation.notOnOrAfter);
  const skewMs = Number(options.clockSkewSeconds ?? 60) * 1000;
  if (!Number.isFinite(notBefore) || !Number.isFinite(notOnOrAfter) || now.getTime() + skewMs < notBefore || now.getTime() - skewMs >= notOnOrAfter) fail("saml_assertion_expired", "SAML assertion is outside its validity window.");
  if (options.expectedRequestId && attestation.inResponseTo !== options.expectedRequestId) fail("saml_response_mismatch", "SAML response is not bound to the initiated login.");
  const claims = { sub: attestation.subject, email: attestation.email, groups: list(attestation.groups), amr: list(attestation.amr), auth_time: Math.floor(Date.parse(attestation.authenticatedAt) / 1000), iss: attestation.issuer, aud: attestation.audience };
  const assurance = evaluateAuthenticationAssurance(claims, options.assurancePolicy ?? {}, options.devicePosture, now);
  return { protocol: "saml", claims, assurance, replayId: attestation.assertionId, evidenceChecksumSha256: attestation.assertionChecksumSha256, validationProviderRef: attestation.validationProviderRef };
}

export function evaluateAuthenticationAssurance(claims = {}, policy = {}, devicePosture = null, now = new Date()) {
  const amr = list(claims.amr).map((item) => item.toLowerCase());
  const mfaVerified = amr.some((method) => MFA_AMR.has(method)) || list(policy.acceptedAcrValues).includes(String(claims.acr ?? ""));
  if (policy.mfaRequired !== false && !mfaVerified) fail("federated_mfa_required", "Federated authentication must carry verified MFA assurance.");
  const authenticatedAt = Number(claims.auth_time) * 1000;
  const maxAgeMs = Number(policy.maxAuthenticationAgeSeconds ?? 3600) * 1000;
  if (!Number.isFinite(authenticatedAt) || authenticatedAt <= 0 || now.getTime() - authenticatedAt > maxAgeMs || authenticatedAt > now.getTime() + 60_000) fail("federated_authentication_stale", "Federated authentication time is missing, stale or in the future.");
  const hardwareBound = amr.some((method) => HARDWARE_AMR.has(method));
  if (policy.hardwareBoundRequired === true && !hardwareBound) fail("hardware_authenticator_required", "A WebAuthn/FIDO hardware-bound authenticator is required.");
  let device = null;
  if (policy.managedDeviceRequired === true) {
    requiredObject(devicePosture, "managed_device_required");
    if (devicePosture.signatureVerified !== true || devicePosture.status !== "compliant") fail("device_posture_invalid", "Device posture must be signed and compliant.");
    for (const field of ["deviceId", "issuer", "evidenceRef"]) text(devicePosture[field], field);
    const checkedAt = Date.parse(devicePosture.checkedAt);
    const maxDeviceAgeMs = Number(policy.maxDevicePostureAgeSeconds ?? 300) * 1000;
    if (!Number.isFinite(checkedAt) || checkedAt > now.getTime() + 60_000 || now.getTime() - checkedAt > maxDeviceAgeMs) fail("device_posture_stale", "Device posture evidence is stale.");
    device = { deviceId: devicePosture.deviceId, issuer: devicePosture.issuer, status: devicePosture.status, checkedAt: new Date(checkedAt).toISOString(), evidenceRef: devicePosture.evidenceRef };
  }
  return { mfaVerified, hardwareBound, authenticatedAt: new Date(authenticatedAt).toISOString(), authenticationMethods: amr, device, assuranceLevel: hardwareBound && device ? "phishing_resistant_managed_device" : hardwareBound ? "phishing_resistant" : "mfa" };
}

export function federatedPrincipalFromClaims(policy, verification) {
  const claims = verification?.claims ?? {};
  const subject = text(claims.sub, "subject");
  const email = text(claims.email, "email").trim().toLowerCase();
  if (!policy.allowedDomains?.some((domain) => email.endsWith(`@${String(domain).toLowerCase()}`))) fail("federated_domain_forbidden", "Federated identity is outside the policy's approved domains.");
  const groups = list(claims.groups);
  const mappings = groups.map((group) => policy.groupMappings?.[group]).filter(Boolean);
  if (!mappings.length) fail("federated_group_unmapped", "Federated identity has no approved group mapping.");
  return { externalId: subject, providerSessionId: typeof claims.sid === "string" && claims.sid.trim() ? claims.sid : null, email, displayName: String(claims.name ?? email), groups, requestedCanonicalRoleIds: [...new Set(mappings.flatMap((mapping) => mapping.canonicalRoleIds ?? []))], assurance: verification.assurance, evidenceChecksumSha256: verification.evidenceChecksumSha256 };
}

export function scimUserResourceToIdentityEvent(resource, { policyId, operation = "upsert", appliedBy = "scim", idempotencyKey, eventId } = {}) {
  requiredObject(resource, "scim_resource_invalid");
  const email = String(resource.userName ?? resource.emails?.find((item) => item.primary)?.value ?? resource.emails?.[0]?.value ?? "").trim().toLowerCase();
  const displayName = String(resource.displayName ?? [resource.name?.givenName, resource.name?.familyName].filter(Boolean).join(" ") ?? "").trim();
  const groups = list(resource.groups).map((group) => typeof group === "string" ? group : String(group.value ?? group.display ?? "")).filter(Boolean);
  return { eventId: text(eventId, "eventId"), policyId: text(policyId, "policyId"), externalId: text(resource.externalId ?? resource.id, "externalId"), email: text(email, "email"), displayName: text(displayName, "displayName"), groups, operation: resource.active === false ? "deactivate" : operation, idempotencyKey: text(idempotencyKey, "idempotencyKey"), appliedBy };
}

export function scimUserProjection(user, baseUrl) {
  return { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], id: user.federationExternalId, externalId: user.federationExternalId, userName: user.email, displayName: user.displayName, active: user.status === "active", meta: { resourceType: "User", location: `${String(baseUrl).replace(/\/$/, "")}/Users/${encodeURIComponent(user.federationExternalId)}` } };
}

export function canonicalFederationEvidence(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalFederationEvidence).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalFederationEvidence(value[key])}`).join(",")}}`;
}

function validateCommonClaims(claims, policy, options, now) {
  const skew = Number(options.clockSkewSeconds ?? 60);
  if (claims.iss !== policy.issuer) fail("oidc_issuer_invalid", "OIDC issuer does not match policy.");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(policy.audience)) fail("oidc_audience_invalid", "OIDC audience does not match policy.");
  if (audiences.length > 1 && claims.azp !== policy.audience) fail("oidc_authorized_party_invalid", "OIDC authorized party is invalid for a multi-audience token.");
  if (!claims.sub || typeof claims.sub !== "string") fail("oidc_subject_invalid", "OIDC subject is required.");
  if (!Number.isFinite(claims.exp) || claims.exp <= now.getTime() / 1000 - skew) fail("oidc_token_expired", "OIDC token is expired.");
  if (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > now.getTime() / 1000 + skew)) fail("oidc_token_not_active", "OIDC token is not active.");
  if (!Number.isFinite(claims.iat) || claims.iat > now.getTime() / 1000 + skew) fail("oidc_issued_at_invalid", "OIDC issued-at time is invalid.");
}

function jsonPart(value, code) { try { return JSON.parse(base64url(value).toString("utf8")); } catch { fail(code, "Federated token contains invalid JSON."); } }
function base64url(value) { try { return Buffer.from(String(value), "base64url"); } catch { fail("federated_encoding_invalid", "Federated value is not valid base64url."); } }
function list(value) { return Array.isArray(value) ? [...new Set(value.map((item) => typeof item === "string" ? item : item?.value ?? item?.display).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))] : []; }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("federated_evidence_invalid", `${field} is required.`); return value; }
function requiredObject(value, code) { if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, "Federated evidence object is required."); }
function digestField(value, field) { if (!/^[a-f0-9]{64}$/i.test(value ?? "")) fail("federated_evidence_invalid", `${field} must be a SHA-256 digest.`); }
function digest(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
