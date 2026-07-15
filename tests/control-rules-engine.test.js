import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformControlStaffingFacts, decidePlatformControlStaffing, validateControlEngineFleetConfiguration } from "../apps/api/src/control-rules-engine.js";

const readiness = {
  ready: true,
  configured: true,
  requestedStatus: "enabled",
  missingRoleSets: [],
  independentPairs: [{ independent: true }],
  sodViolations: [],
  distinctPrincipalIds: ["maker", "checker"],
  minimumDistinctPrincipals: 2,
  operationalPauses: []
};

test("platform-control facts preserve staffing and actor evidence", () => {
  assert.deepEqual(buildPlatformControlStaffingFacts(readiness, { actorAuthorized: true }), {
    staffing: { feature_configured: true, missing_role_sets: 0, independence_failures: 0, sod_violations: 0, active_human_principals: 2, minimum_distinct_principals: 2, open_operational_pauses: 0 },
    action: { actor_authorized: true, agent_attempts_human_control: false, agent_guardrail_allowed: true }
  });
});

test("active control engine fails closed when unavailable or shared with business engine", async () => {
  const env = {
    LOANOS_CONTROL_RULES_ENGINE: "active",
    LOANOS_CONTROL_RULES_ENGINE_URLS: JSON.stringify({ tenant: { url: "https://engine.example", instanceId: "ctrl-tenant-1" } }),
    LOANOS_RULES_ENGINE_URLS: JSON.stringify({ tenant: "https://engine.example" })
  };
  const result = await decidePlatformControlStaffing({ tenantId: "tenant", requestId: "req-1", readiness, actorAuthorized: true, env, fetchImpl: async () => { throw new Error("must not call shared engine"); } });
  assert.equal(result.decision, "deny");
  assert.equal(result.failClosed, true);
});

test("active control engine verifies instance identity before allowing", async () => {
  const env = { LOANOS_CONTROL_RULES_ENGINE: "active", LOANOS_CONTROL_RULES_ENGINE_URLS: JSON.stringify({ tenant: { url: "https://control.example", instanceId: "ctrl-tenant-1", tenantBundleHash: "sha256:tenant" } }) };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ decision: "allow", engine: { instance_id: "ctrl-other" }, ruleset: { tenant_pack: "sha256:tenant" } }) });
  const result = await decidePlatformControlStaffing({ tenantId: "tenant", requestId: "req-2", readiness, actorAuthorized: true, env, fetchImpl });
  assert.equal(result.decision, "deny");
  assert.equal(result.error, "control_engine_unavailable_or_untrusted");
});

test("production fleet configuration requires unique tenant instances, mTLS identities and KMS-signed bundles", () => {
  const route = { url: "https://control-tenant.example", instanceId: "ctrl-tenant-1", mtlsRequired: true, clientIdentityRef: "spiffe://loanos/api/tenant", serverIdentityRef: "spiffe://loanos/control/tenant", trustBundleRef: "kms://trust/control", bundleSigningKeyRef: "kms://keys/control-signing" };
  assert.deepEqual(validateControlEngineFleetConfiguration({ LOANOS_CONTROL_RULES_ENGINE_URLS: JSON.stringify({ tenant: route }) }), { tenantCount: 1, instanceCount: 1, isolated: true, mtlsRequired: true, signedBundlesRequired: true });
  assert.throws(() => validateControlEngineFleetConfiguration({ LOANOS_CONTROL_RULES_ENGINE_URLS: JSON.stringify({ tenant: { ...route, mtlsRequired: false } }) }), /requires mTLS/);
  assert.throws(() => validateControlEngineFleetConfiguration({ LOANOS_CONTROL_RULES_ENGINE_URLS: JSON.stringify({ a: route, b: { ...route } }) }), /unique ctrl|cannot share/);
});

test("hardened active route allows only matching mTLS peer and KMS bundle lineage", async () => {
  const route = { url: "https://control-tenant.example", instanceId: "ctrl-tenant-1", tenantBundleHash: "sha256:tenant", mtlsRequired: true, clientIdentityRef: "spiffe://loanos/api/tenant", serverIdentityRef: "spiffe://loanos/control/tenant", trustBundleRef: "kms://trust/control", bundleSigningKeyRef: "kms://keys/control-signing" };
  const env = { LOANOS_CONTROL_RULES_ENGINE: "active", LOANOS_CONTROL_RULES_ENGINE_URLS: JSON.stringify({ tenant: route }) };
  const response = { decision: "allow", engine: { instance_id: route.instanceId }, transport: { mtls_verified: true, client_identity_ref: route.clientIdentityRef, server_identity_ref: route.serverIdentityRef }, ruleset: { tenant_pack: route.tenantBundleHash, signature_verified: true, signing_key_ref: route.bundleSigningKeyRef } };
  const allowed = await decidePlatformControlStaffing({ tenantId: "tenant", requestId: "req-secure", readiness, actorAuthorized: true, env, fetchImpl: async () => ({ ok: true, json: async () => response }) });
  assert.equal(allowed.decision, "allow");
  const denied = await decidePlatformControlStaffing({ tenantId: "tenant", requestId: "req-wrong-peer", readiness, actorAuthorized: true, env, fetchImpl: async () => ({ ok: true, json: async () => ({ ...response, transport: { ...response.transport, server_identity_ref: "spiffe://attacker" } }) }) });
  assert.equal(denied.decision, "deny");
});
