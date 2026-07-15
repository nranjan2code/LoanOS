import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { totpCode } from "../apps/api/src/identity.js";

const TENANT = { tenantId: "tenant_identity_ops", name: "Identity Ops Bank", apiKey: "identity-ops-key" };
const PASSWORD = "BankingAccessPass1!";
const MFA_SECRET = "JBSWY3DPEHPK3PXP";

test("identity operations API governs simulator campaigns, recovery, and immediate revocation", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-identity-ops-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const serviceHeaders = { "content-type": "application/json", "x-api-key": TENANT.apiKey };
  for (const [userId, adminRoles] of [["maker", ["tenant_admin"]], ["checker", ["security_admin"]], ["subject", ["operator"]]]) {
    const response = await fetch(`${base}/admin/users`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ userId, email: `${userId}@identity.example`, displayName: userId, password: PASSWORD, mustChangePassword: false, adminRoles, mfaEnabled: true, mfaSecret: MFA_SECRET }) });
    assert.equal(response.status, 201, await response.clone().text());
  }
  const login = async (userId) => {
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: TENANT.tenantId, email: `${userId}@identity.example`, password: PASSWORD, mfaCode: totpCode(MFA_SECRET) }) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.headers.get("set-cookie").split(";", 1)[0];
  };
  const maker = await login("maker"); const checker = await login("checker"); const subject = await login("subject");
  const post = (path, body, cookie = maker) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });

  let response = await fetch(`${base}/admin/identity-operations/summary`, { headers: { cookie: maker } });
  assert.equal(response.status, 200); assert.equal((await response.json()).summary.commerciallyLive, false);
  response = await post("/admin/identity-operations/conformance/campaigns", { campaignId: "oidc-candidate-1", family: "oidc", providerProfileRef: "candidate-idp", executionMode: "simulated" });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/admin/identity-operations/conformance/campaigns/oidc-candidate-1/approval", { approvalRef: "IAM-CAB-1" });
  assert.equal(response.status, 409, "the proposer cannot self-approve");
  response = await post("/admin/identity-operations/conformance/campaigns/oidc-candidate-1/approval", { approvalRef: "IAM-CAB-1" }, checker);
  assert.equal(response.status, 200, await response.clone().text());
  response = await post("/admin/identity-operations/conformance/campaigns/oidc-candidate-1/run", {}, checker);
  assert.equal(response.status, 200, await response.clone().text());
  const campaign = await response.json(); assert.equal(campaign.campaign.status, "simulator_certified"); assert.equal(campaign.campaign.commerciallyLive, false);

  response = await post("/admin/identity-operations/drills/proposals", { drillId: "drill-1", scenario: "idp_outage", objective: "prove fail-closed login and recovery", runbookRef: "IAM-RUNBOOK-1", targetDetectionMs: 60_000, targetContainmentMs: 120_000, targetRecoveryMs: 600_000 });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/admin/identity-operations/drills/drill-1/witness", { executionEvidenceRef: "DRILL-EXEC-1", recoveryEvidenceRef: "DRILL-RECOVERY-1", detectionMs: 30_000, containmentMs: 90_000, recoveryMs: 300_000, failClosedObserved: true, auditComplete: true }, checker);
  assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).drill.status, "passed");
  response = await post("/admin/identity-operations/automation/runs", { runId: "identity-run-1", executionEvidenceRef: "SCHEDULER-1" });
  assert.equal(response.status, 201, await response.clone().text()); assert.ok((await response.json()).run.planChecksumSha256);

  response = await post("/admin/identity-operations/recovery/proposals", { requestId: "recover-subject-1", principalId: "subject", identityEvidenceRef: "verified-helpdesk-video-1", reason: "lost authenticator" });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/admin/identity-operations/recovery/recover-subject-1/approval", { approvalRef: "SEC-APPROVAL-1" }, checker);
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok((await response.json()).revokedSessionIds.length >= 1);
  response = await fetch(`${base}/auth/me`, { headers: { cookie: subject } });
  assert.equal(response.status, 401, "recovery immediately invalidates the subject session");
});
