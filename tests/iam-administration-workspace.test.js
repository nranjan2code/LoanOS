import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { totpCode } from "../apps/api/src/identity.js";

const MFA_SECRET = "JBSWY3DPEHPK3PXP";
const PASSWORD = "TenantAccessPass1!";

test("IAM administration workspace is tenant-human scoped and projects effective access", async (t) => {
  const tenant = { tenantId: "tenant_iam_workspace", name: "IAM Workspace Bank", apiKey: "iam-workspace-service-key", organisationSignupId: "signup_iam_workspace" };
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-iam-workspace-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const serviceHeaders = { "content-type": "application/json", "x-api-key": tenant.apiKey };

  let response = await fetch(`${base}/admin/users`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ userId: "owner", email: "owner@iam-workspace.example", displayName: "IAM owner", password: PASSWORD, mustChangePassword: false, adminRoles: ["tenant_admin"], mfaRequired: true, mfaEnabled: true, mfaSecret: MFA_SECRET }) });
  assert.equal(response.status, 201, await response.clone().text());
  response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: tenant.tenantId, email: "owner@iam-workspace.example", password: PASSWORD, mfaCode: totpCode(MFA_SECRET) }) });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("set-cookie").split(";", 1)[0];

  response = await fetch(`${base}/admin/identity-governance/workspace`, { headers: { "x-api-key": tenant.apiKey } });
  assert.equal(response.status, 403, "service credentials cannot read the human IAM workspace");
  response = await fetch(`${base}/admin/identity-governance/principals/owner/sync`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ identityEvidenceRef: "identity:owner", bootstrapRole: "bootstrap_owner", authorizedRepresentativeEvidenceRef: "authorised-representative:owner", expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }) });
  assert.equal(response.status, 200, await response.clone().text());

  response = await fetch(`${base}/admin/identity-governance/workspace`, { headers: { cookie } });
  assert.equal(response.status, 200, await response.clone().text());
  const workspace = (await response.json()).workspace;
  assert.equal(workspace.tenantId, tenant.tenantId);
  assert.equal(workspace.summary.principals, 1);
  assert.equal(workspace.summary.activeHumans, 1);
  assert.equal(workspace.principals[0].principal.principalId, "owner");
  assert.deepEqual(workspace.principals[0].roleIds, ["bootstrap_owner"]);
  assert.equal(workspace.ownership.ownerPrincipalId, "owner");
  assert.equal(workspace.emergencyAccessGrants.length, 0);
});

test("dashboard exposes the complete tenant IAM administration control surface", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../apps/dashboard/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/dashboard/index.js", import.meta.url), "utf8"),
    readFile(new URL("../apps/dashboard/index.css", import.meta.url), "utf8")
  ]);
  for (const marker of ["data-admin-tab=\"iam\"", "iam-role-catalogue", "iam-principals-list", "iam-role-requests-list", "iam-feature-readiness-list", "iam-escalations-list", "iam-agent-id", "iam-ownership-list", "iam-emergency-list"]) assert.match(html, new RegExp(marker));
  for (const route of ["/workspace", "/role-grants/proposals", "/role-revocations/proposals", "/staffing-config/proposals", "/staffing-escalations/closure-proposals", "/principals/agents", "/ownership-transfers/proposals", "/emergency-access/proposals"]) assert.match(js, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(js, /removal-impact/);
  assert.match(js, /different access reviewer must approve/i);
  assert.match(css, /\.iam-action-columns/);
  assert.match(css, /\.iam-readiness-blocked/);
  for (const marker of ["identity-automation-run", "identity-drill-id", "identity-drill-fail-closed", "identity-drill-audit-complete"]) assert.match(html, new RegExp(marker));
  assert.match(js, /\/admin\/identity-operations\/automation\/runs/);
  assert.match(js, /\/admin\/identity-operations\/drills\/proposals/);
  assert.match(js, /failClosedObserved/);
  assert.match(js, /auditComplete/);
});
