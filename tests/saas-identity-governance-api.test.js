import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { totpCode } from "../apps/api/src/identity.js";

const TENANT = { tenantId: "tenant_verified_rbac", name: "Verified RBAC Bank", apiKey: "rbac-service-key", organisationSignupId: "signup_verified_rbac" };
const MFA_SECRET = "JBSWY3DPEHPK3PXP";
const PASSWORD = "BankingAccessPass1!";

test("canonical SaaS identity API binds verified users and enforces session-bound maker-checker launch coverage", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-saas-rbac-api-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const serviceHeaders = { "content-type": "application/json", "x-api-key": TENANT.apiKey };
  const users = [
    ["owner", ["tenant_admin"]], ["bootstrap-checker", ["user_admin"]], ["admin", ["tenant_admin"]],
    ["security", ["operator"]], ["audit", ["operator"]], ["product", ["operator"]],
    ["credit-maker", ["operator"]], ["credit-checker", ["operator"]], ["ops-maker", ["operator"]],
    ["ops-checker", ["operator"]], ["compliance", ["operator"]]
  ];
  for (const [userId, adminRoles] of users) {
    const response = await fetch(`${base}/admin/users`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ userId, email: `${userId}@verified-rbac.example`, displayName: userId, password: PASSWORD, mustChangePassword: false, adminRoles, mfaRequired: true, mfaEnabled: true, mfaSecret: MFA_SECRET }) });
    assert.equal(response.status, 201, await response.clone().text());
  }

  const login = async (userId) => {
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: TENANT.tenantId, email: `${userId}@verified-rbac.example`, password: PASSWORD, mfaCode: totpCode(MFA_SECRET) }) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.headers.get("set-cookie").split(";", 1)[0];
  };
  const ownerCookie = await login("owner");
  const checkerCookie = await login("bootstrap-checker");
  const post = (path, body, cookie = ownerCookie) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  const sync = (userId, body = {}) => post(`/admin/identity-governance/principals/${userId}/sync`, { identityEvidenceRef: `verified-user:${userId}`, ...body });
  const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

  let response = await fetch(`${base}/admin/identity-governance/roles`, { headers: { "x-api-key": TENANT.apiKey } });
  assert.equal(response.status, 200);
  assert((await response.json()).roles.some((role) => role.roleId === "credit_checker"));
  response = await fetch(`${base}/admin/identity-governance/principals/owner/sync`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ identityEvidenceRef: "verified-user:owner" }) });
  assert.equal(response.status, 403, "service credentials never become human RBAC actors");

  response = await sync("owner", { bootstrapRole: "bootstrap_owner", authorizedRepresentativeEvidenceRef: "verified-authorised-representative:owner", expiresAt });
  assert.equal(response.status, 200, await response.clone().text());
  response = await sync("bootstrap-checker", { bootstrapRole: "bootstrap_checker", authorizedRepresentativeEvidenceRef: "verified-authorised-representative:checker", expiresAt });
  assert.equal(response.status, 200, await response.clone().text());
  for (const [userId] of users.slice(2)) {
    response = await sync(userId);
    assert.equal(response.status, 200, `${userId}: ${await response.clone().text()}`);
  }

  response = await post("/admin/identity-governance/role-grants/proposals", { requestId: "unknown-role", principalId: "admin", roleIds: ["not_a_role"], proposedBy: "spoofed-actor", reason: "must fail closed" });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "saas_role_unknown");

  const grants = [
    ["admin", ["tenant_admin", "user_admin"]], ["security", ["security_admin"]], ["audit", ["auditor"]],
    ["product", ["product_manager"]], ["credit-maker", ["credit_maker"]], ["credit-checker", ["credit_checker"]],
    ["ops-maker", ["operations_maker"]], ["ops-checker", ["operations_checker"]], ["compliance", ["compliance_officer"]]
  ];
  for (const [principalId, roleIds] of grants) {
    const requestId = `grant-${principalId}`;
    response = await post("/admin/identity-governance/role-grants/proposals", { requestId, principalId, roleIds, proposedBy: "spoofed-proposer", reason: "launch responsibility" });
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal((await response.json()).request.proposedBy, "owner", "proposer comes from the authenticated session");
    response = await post(`/admin/identity-governance/role-grants/${requestId}/approval`, { approvedBy: "spoofed-approver", approvalRef: `approval:${requestId}` }, checkerCookie);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).request.approvedBy, "bootstrap-checker", "approver comes from the authenticated session");
  }

  response = await fetch(`${base}/admin/identity-governance/launch-coverage`, { headers: { cookie: ownerCookie } });
  assert.equal(response.status, 200);
  const coverage = (await response.json()).coverage;
  assert.equal(coverage.ready, true);
  assert.deepEqual(coverage.missingRoles, []);
  assert(coverage.independentPairs.every((pair) => pair.independent));

  response = await post("/admin/identity-governance/bootstrap-transition/proposal", { requestId: "bootstrap-launch", approvalRef: "launch-proposal:verified-rbac" });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/admin/identity-governance/bootstrap-transition/bootstrap-launch/approval", { proposedBy: "spoofed-proposer", approvedBy: "spoofed-approver", approvalRef: "launch-approval:verified-rbac" }, checkerCookie);
  assert.equal(response.status, 200, await response.clone().text());
  const transition = await response.json();
  assert.equal(transition.ownership.status, "active");
  assert.equal(transition.ownership.bootstrapCompletedBy, "owner");
  assert.equal(transition.ownership.bootstrapApprovedBy, "bootstrap-checker");
});
