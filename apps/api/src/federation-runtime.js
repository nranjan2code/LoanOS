import { createHash } from "node:crypto";
import { federatedPrincipalFromClaims, verifyOidcIdToken, verifySamlValidationAttestation } from "@loanos/core/identity/federated-access-runtime.js";

export async function validateFederatedLogin(policy, evidence, options = {}) {
  if (!policy || policy.status !== "active" || Date.parse(policy.metadataValidUntil) <= (options.now ?? new Date()).getTime()) fail("federation_policy_inactive", "An active, current federation policy is required.");
  const assurancePolicy = {
    mfaRequired: true,
    maxAuthenticationAgeSeconds: policy.maxAuthenticationAgeSeconds ?? 3600,
    hardwareBoundRequired: policy.hardwareBoundRequired === true,
    managedDeviceRequired: policy.managedDeviceRequired === true,
    maxDevicePostureAgeSeconds: policy.maxDevicePostureAgeSeconds ?? 300,
    acceptedAcrValues: policy.acceptedAcrValues ?? []
  };
  let verification;
  if (policy.protocol === "oidc") {
    const metadata = await fetchJson(policy.metadataUrl, options.fetchImpl ?? fetch, "oidc_metadata_unavailable", policy.metadataChecksumSha256);
    if (metadata.issuer !== policy.issuer) fail("oidc_metadata_issuer_invalid", "OIDC discovery issuer does not match certified policy.");
    const jwksUrl = httpsUrl(metadata.jwks_uri, "jwks_uri");
    const jwks = await fetchJson(jwksUrl, options.fetchImpl ?? fetch, "oidc_jwks_unavailable");
    verification = verifyOidcIdToken(evidence.idToken, policy, jwks, { nonce: options.nonce, assurancePolicy, devicePosture: options.devicePosture }, options.now);
  } else if (policy.protocol === "saml") {
    verification = verifySamlValidationAttestation(evidence.samlValidationAttestation, policy, { expectedRequestId: options.requestId, assurancePolicy, devicePosture: options.devicePosture }, options.now);
  } else fail("federation_protocol_invalid", "Federation protocol is unsupported.");
  return { verification, principal: federatedPrincipalFromClaims(policy, verification) };
}

export async function loadFederationAuthorizationEndpoint(policy, fetchImpl = fetch) {
  if (policy.protocol !== "oidc") return null;
  const metadata = await fetchJson(policy.metadataUrl, fetchImpl, "oidc_metadata_unavailable", policy.metadataChecksumSha256);
  if (metadata.issuer !== policy.issuer) fail("oidc_metadata_issuer_invalid", "OIDC discovery issuer does not match certified policy.");
  return httpsUrl(metadata.authorization_endpoint, "authorization_endpoint");
}

export async function exchangeOidcAuthorizationCode(policy, input, fetchImpl = fetch) {
  if (policy.protocol !== "oidc") fail("federation_protocol_invalid", "Authorization-code exchange requires OIDC.");
  const metadata = await fetchJson(policy.metadataUrl, fetchImpl, "oidc_metadata_unavailable", policy.metadataChecksumSha256);
  if (metadata.issuer !== policy.issuer) fail("oidc_metadata_issuer_invalid", "OIDC discovery issuer does not match certified policy.");
  const tokenEndpoint = httpsUrl(metadata.token_endpoint, "token_endpoint");
  const body = new URLSearchParams({ grant_type: "authorization_code", code: required(input.code, "code"), redirect_uri: required(input.redirectUri, "redirectUri"), client_id: policy.audience, code_verifier: required(input.codeVerifier, "codeVerifier") });
  const response = await fetchImpl(tokenEndpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: body.toString(), redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response?.ok) fail("oidc_code_exchange_failed", "OIDC authorization code could not be exchanged.");
  const result = await response.json();
  if (typeof result.id_token !== "string" || !result.id_token) fail("oidc_id_token_missing", "OIDC token response did not include an ID token.");
  return { idToken: result.id_token, tokenType: result.token_type ?? null, expiresIn: result.expires_in ?? null };
}

async function fetchJson(url, fetchImpl, code, expectedChecksumSha256 = null) {
  const response = await fetchImpl(httpsUrl(url, "metadata URL"), { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response?.ok) fail(code, "Federation provider metadata could not be verified.");
  const contentType = response.headers?.get?.("content-type") ?? "application/json";
  if (!contentType.toLowerCase().includes("json")) fail(code, "Federation provider returned an unexpected metadata format.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expectedChecksumSha256 && createHash("sha256").update(bytes).digest("hex") !== expectedChecksumSha256) fail("federation_metadata_checksum_mismatch", "Federation metadata no longer matches its independently certified checksum.");
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail(code, "Federation provider returned invalid JSON metadata."); }
}
function httpsUrl(value, field) { try { const url = new URL(value); if (url.protocol !== "https:") throw new Error(); return url.toString(); } catch { fail("federation_url_invalid", `${field} must be an HTTPS URL.`); } }
function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("federation_exchange_invalid", `${field} is required.`); return value; }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
