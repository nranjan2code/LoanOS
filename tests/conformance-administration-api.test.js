import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLoanOsServer } from "../apps/api/src/server.js";
import { totpCode } from "../apps/api/src/identity.js";

const PASSWORD = "TenantAccessPass1!";
const MFA = "JBSWY3DPEHPK3PXP";

test("conformance administration persists a tenant-scoped simulator campaign with authenticated four eyes", async (t) => {
  const tenant = { tenantId: "tenant_conformance_api", name: "Conformance Bank", apiKey: "conformance-api-key" };
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-conformance-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`; await fetch(`${base}/health`);
  for (const userId of ["maker", "checker"]) {
    const response = await fetch(`${base}/admin/users`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify({ userId, email: `${userId}@conformance.example`, displayName: userId, password: PASSWORD, mustChangePassword: false, adminRoles: ["security_admin"], mfaRequired: true, mfaEnabled: true, mfaSecret: MFA }) });
    assert.equal(response.status, 201, await response.clone().text());
  }
  const login = async (userId) => {
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: tenant.tenantId, email: `${userId}@conformance.example`, password: PASSWORD, mfaCode: totpCode(MFA) }) });
    assert.equal(response.status, 200); return response.headers.get("set-cookie").split(";", 1)[0];
  };
  const maker = await login("maker"); const checker = await login("checker");
  const post = (path, body, cookie = maker) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  let response = await post("/admin/conformance/candidates", { profileId: "candidate-api-1", providerName: "Admission Proxy", providerCategory: "organisation_admission", adapterContractVersion: "adapter/v1", simulatorConfigurationRef: "simulator/config/1", dueDiligenceRef: "diligence/proxy-1", organisationAdmissionIntegrationIds: ["INT-ADM-09"], enterprisePlatformFamilies: [] });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/admin/conformance/campaigns/proposals", { campaignId: "campaign-api-1", profileId: "candidate-api-1", targetType: "organisation_admission", targetId: "INT-ADM-09", validityDays: 30, proposalRef: "change/conformance-api-1" });
  assert.equal(response.status, 201, await response.clone().text()); const proposed = (await response.json()).campaign;
  response = await post("/admin/conformance/campaigns/campaign-api-1/approval", { approvalRef: "approval/self" }); assert.equal(response.status, 409);
  response = await post("/admin/conformance/campaigns/campaign-api-1/approval", { approvalRef: "approval/checker" }, checker); assert.equal(response.status, 200, await response.clone().text());
  for (const scenario of proposed.manifest.scenarios) {
    response = await post("/admin/conformance/campaigns/campaign-api-1/evidence", { scenarioId: scenario.scenarioId, idempotencyKey: `run:${scenario.scenarioId}`, runId: `run:${scenario.scenarioId}`, observedDisposition: scenario.expectedDisposition, evidenceRef: `evidence://${scenario.scenarioId}` });
    assert.equal(response.status, 201, await response.clone().text());
  }
  response = await post("/admin/conformance/campaigns/campaign-api-1/assessment", { assessmentRef: "assessment/api-1" }, checker); assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).assessment.status, "simulator_certified");
  response = await fetch(`${base}/admin/conformance/summary`, { headers: { cookie: checker } }); assert.equal(response.status, 200); const summary = (await response.json()).summary; assert.equal(summary.profileCount, 1); assert.equal(summary.totals.certifiedCurrent, 1); assert.equal(summary.commerciallyLive, false);
});
