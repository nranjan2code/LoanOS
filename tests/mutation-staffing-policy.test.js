import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { FEATURE_STAFFING_POLICY_IDS } from "../packages/core/src/saas-identity-governance.js";
import { MUTATION_STAFFING_ROUTE_RULES, classifyProtectedMutation, enforceUniversalMutationStaffing } from "../apps/api/src/mutation-staffing-policy.js";

test("universal mutation classifier covers every staffing family and defaults unknown mutations to deny", async () => {
  assert.deepEqual([...new Set(MUTATION_STAFFING_ROUTE_RULES.map((rule) => rule.featureId))].sort(), [...FEATURE_STAFFING_POLICY_IDS].sort());
  assert.equal(classifyProtectedMutation("POST", "/loans/applications/app-1/sanction").featureId, "FST-003");
  assert.equal(classifyProtectedMutation("PATCH", "/new-sensitive-surface/item-1").disposition, "unclassified");
  const result = await enforceUniversalMutationStaffing({ state: {}, tenantId: "tenant-a", authContext: { principalType: "tenant_user", userId: "user-a" }, method: "PATCH", path: "/new-sensitive-surface/item-1", requestId: "req-1", env: { LOANOS_UNIVERSAL_STAFFING: "active" } });
  assert.equal(result.allowed, false); assert.equal(result.reason, "mutation_unclassified");
});

test("classified active mutations fail closed when feature staffing or actor role is unavailable", async () => {
  const result = await enforceUniversalMutationStaffing({ state: {}, tenantId: "tenant-a", authContext: { principalType: "tenant_user", userId: "user-a" }, method: "POST", path: "/loans/applications/app-1/sanction", requestId: "req-2", env: { LOANOS_UNIVERSAL_STAFFING: "active", LOANOS_CONTROL_RULES_ENGINE: "off" } });
  assert.equal(result.allowed, false); assert.equal(result.classification.featureId, "FST-003");
});

test("shadow mode records the denial candidate without disrupting the mutation", async () => {
  const result = await enforceUniversalMutationStaffing({ state: {}, tenantId: "tenant-a", authContext: { principalType: "tenant_user", userId: "user-a" }, method: "POST", path: "/fraud/cases", requestId: "req-3", env: { LOANOS_UNIVERSAL_STAFFING: "shadow", LOANOS_CONTROL_RULES_ENGINE: "off" } });
  assert.equal(result.allowed, true); assert.equal(result.wouldAllow, false); assert.equal(result.classification.featureId, "FST-033");
});

test("every literal tenant mutation in the API source is classified or deliberately outside the staff gate", async () => {
  const files = ["apps/api/src/server.js"];
  files.push(...(await readdir("apps/api/src/routes")).filter((name) => name.endsWith(".js")).map((name) => `apps/api/src/routes/${name}`));
  const paths = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/method === "(?:POST|PUT|PATCH|DELETE)" && path === "([^"]+)"/g)) paths.push(match[1]);
  }
  const outsideTenantStaffGate = /^(\/platform(?:\/|$)|\/auth(?:\/|$)|\/organisation-signups(?:\/|$)|\/scim\/v2(?:\/|$)|\/activity\/screen-events$|\/borrower\/)/;
  const unclassified = [...new Set(paths)].filter((path) => !outsideTenantStaffGate.test(path) && classifyProtectedMutation("POST", path)?.disposition === "unclassified");
  assert.deepEqual(unclassified, []);
});
