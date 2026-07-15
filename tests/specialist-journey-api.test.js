import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLoanOsServer } from "../apps/api/src/server.js";
import { totpCode } from "../apps/api/src/identity.js";

const PASSWORD = "TenantAccessPass1!";
const MFA = "JBSWY3DPEHPK3PXP";
const H = "a".repeat(64);

test("specialist journey API persists version-bound governed execution across restart", async (t) => {
  const tenant = { tenantId: "tenant_specialist_api", name: "Specialist Bank", apiKey: "specialist-api-key" };
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-specialist-"));
  t.after(async () => { await rm(dataDir, { recursive: true, force: true }); });
  let server = await start(dataDir, tenant);
  let base = `http://127.0.0.1:${server.address().port}`;
  const cookies = {};
  for (const userId of ["maker", "checker"]) {
    let response = await fetch(`${base}/admin/users`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify({ userId, email: `${userId}@specialist.example`, displayName: userId, password: PASSWORD, mustChangePassword: false, adminRoles: ["tenant_admin"], mfaRequired: true, mfaEnabled: true, mfaSecret: MFA }) });
    assert.equal(response.status, 201, await response.clone().text());
    response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: tenant.tenantId, email: `${userId}@specialist.example`, password: PASSWORD, mfaCode: totpCode(MFA) }) });
    assert.equal(response.status, 200, await response.clone().text());
    cookies[userId] = response.headers.get("set-cookie").split(";", 1)[0];
  }
  const post = (path, cookie, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });

  let response = await post("/admin/specialist-journeys/configurations/proposals", cookies.maker, {
    requestId: "request-home-1", configurationId: "home-config-1", journeyType: "home_loan", productTemplateRef: "builtin:home_loan", productTemplateVersion: "1.0.0", productTemplateChecksumSha256: H, schemaVersion: "1.0.0", policyVersionRef: "policy/home/v1", workflowVersionRef: "workflow/home/v1", accountingPolicyRef: "accounting/home/v1", assignedRoleIds: ["credit_operations_officer", "credit_approver"], idempotencyKey: "configuration/home-1",
    kernelConfiguration: { minimumAmountPaise: "100", maximumAmountPaise: "1000000", maximumLtvPercent: "75.0000", eligibilityPolicyRef: "eligibility/v1", kycControlRef: "kyc/v1", agreementTemplateRef: "agreement/v1", servicingPolicyRef: "servicing/v1", collateralPolicyRef: "collateral/v1" }
  });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/admin/specialist-journeys/configurations/request-home-1/approval", cookies.maker, { approvalRef: "self" });
  assert.equal(response.status, 422);
  response = await post("/admin/specialist-journeys/configurations/request-home-1/approval", cookies.checker, { approvalRef: "approval/home-1" });
  assert.equal(response.status, 200, await response.clone().text());

  response = await post("/admin/specialist-journeys/cases", cookies.maker, { caseId: "home-case-1", configurationId: "home-config-1", expectedConfigurationVersion: 1, subjectRef: "borrower/1", sourceApplicationRef: "application/1", assignedPrincipalIds: ["maker"], idempotencyKey: "case/home-1" });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/admin/specialist-journeys/cases/home-case-1/actions", cookies.maker, { actionId: "assess-home-1", actionType: "assess", idempotencyKey: "action/assess-home-1", payload: { facts: { requestedAmountPaise: "500000", propertyRef: "property/1", titleReviewStatus: "clear", valuationRef: "valuation/1", constructionStageRef: "stage/1", stageCertified: true } } });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/admin/specialist-journeys/actions/assess-home-1/approval", cookies.checker, { approvalRef: "approval/assess-home-1" });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).case.status, "assessed");

  await close(server);
  server = await start(dataDir, tenant);
  t.after(async () => { await close(server); });
  base = `http://127.0.0.1:${server.address().port}`;
  response = await fetch(`${base}/admin/specialist-journeys`, { headers: { cookie: cookies.maker } });
  assert.equal(response.status, 200, await response.clone().text());
  const workspace = (await response.json()).workspace;
  assert.equal(workspace.supportedJourneyTypes.length, 17);
  assert.equal(workspace.configurations[0].status, "active");
  assert.equal(workspace.cases[0].status, "assessed");
  assert.equal(workspace.actionRequests[0].status, "executed");
  assert.equal(workspace.tasks.length, 1);
});

async function start(dataDir, tenant) { const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); await fetch(`http://127.0.0.1:${server.address().port}/health`); return server; }
async function close(server) { if (!server?.listening) return; await new Promise((resolve) => server.close(resolve)); }
