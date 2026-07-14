import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformControlStaffingFacts, decidePlatformControlStaffing } from "../apps/api/src/control-rules-engine.js";

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
