import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLoanOsServer } from "../apps/api/src/server.js";
import { loadState, saveState } from "../apps/api/src/file-store.js";
import { totpCode } from "../apps/api/src/identity.js";

const PASSWORD = "TenantAccessPass1!";
const MFA = "JBSWY3DPEHPK3PXP";

test("operational workspace exposes accessible transaction desks without browser data persistence", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../apps/dashboard/workspaces.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/dashboard/workspaces.js", import.meta.url), "utf8"),
    readFile(new URL("../apps/dashboard/workspaces.css", import.meta.url), "utf8")
  ]);
  for (const marker of ["Operational workspaces", "workspace-tabs", "Unassigned tasks", "task-controls", "assignment-form", "comment-form", "Control boundary", "aria-live=\"polite\"", "Skip to workspaces"]) assert.match(html, new RegExp(marker));
  for (const marker of ["/operational-workspaces", "/workflow/tasks/", "/staff/actors", "credentials: \"same-origin\"", "cache: \"no-store\"", "replaceChildren", "textContent"]) assert.match(js, new RegExp(marker.replaceAll("/", "\\/")));
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|document\.write|localStorage|sessionStorage|indexedDB|serviceWorker/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
});

test("operational workspace API filters role work, exposes safe metadata and drives task controls", async (t) => {
  const tenant = { tenantId: "tenant_operational_workspace", name: "Operations Bank", apiKey: "operations-api-key" };
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-operational-workspace-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/health`);

  let response = await fetch(`${base}/admin/users`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": tenant.apiKey },
    body: JSON.stringify({
      userId: "credit-operator", email: "credit@operations.example", displayName: "Credit operator", password: PASSWORD,
      mustChangePassword: false, adminRoles: ["tenant_admin"], roles: ["credit_officer"], queues: ["credit_ops"],
      canAssignQueues: ["credit_ops"], mfaRequired: true, mfaEnabled: true, mfaSecret: MFA
    })
  });
  assert.equal(response.status, 201, await response.clone().text());
  response = await fetch(`${base}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tenant.tenantId, email: "credit@operations.example", password: PASSWORD, mfaCode: totpCode(MFA) })
  });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("set-cookie").split(";", 1)[0];

  const state = await loadState(dataDir);
  state.tenants[tenant.tenantId].loanApplications = {
    "application-1": {
      applicationId: "application-1", status: "ready_for_decision", createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z", eligibility: { decision: "eligible" }, borrowerName: "MUST_NOT_LEAK"
    }
  };
  state.tenants[tenant.tenantId].financeExceptions = {
    "finance-1": { financeExceptionId: "finance-1", status: "open", owner: "finance-operator", sourcePayload: "MUST_NOT_LEAK" }
  };
  await saveState(state, dataDir);

  response = await fetch(`${base}/operational-workspaces?view=origination`, { headers: { cookie } });
  assert.equal(response.status, 200, await response.clone().text());
  const workspace = await response.json();
  assert.equal(workspace.actor.actorId, "credit-operator");
  assert.equal(workspace.activeWorkspace, "origination");
  const task = workspace.items.find((item) => item.kind === "task");
  assert.equal(task.type, undefined);
  assert.equal(task.recordType, "application.credit_decision");
  assert.equal(task.requiredRole, "credit_officer");
  assert.equal(task.action.path, "/loans/applications/application-1/decision");
  assert.equal(JSON.stringify(workspace).includes("MUST_NOT_LEAK"), false);

  response = await fetch(`${base}/workflow/tasks/${encodeURIComponent(task.itemId)}/assignments`, {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ assignedTo: "credit-operator", notes: "Own queue" })
  });
  assert.equal(response.status, 201, await response.clone().text());
  response = await fetch(`${base}/workflow/tasks/${encodeURIComponent(task.itemId)}/start`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 200, await response.clone().text());
  response = await fetch(`${base}/workflow/tasks/${encodeURIComponent(task.itemId)}/comments`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ comment: "Policy evidence checked." }) });
  assert.equal(response.status, 200, await response.clone().text());

  response = await fetch(`${base}/operational-workspaces?view=origination`, { headers: { cookie } });
  const refreshed = await response.json();
  assert.equal(refreshed.items.find((item) => item.itemId === task.itemId).status, "in_progress");
  assert.equal(refreshed.items.find((item) => item.itemId === task.itemId).owner, "credit-operator");

  response = await fetch(`${base}/operational-workspaces?view=control`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const control = await response.json();
  assert.equal(control.items.some((item) => item.entityId === "finance-1"), true);
  assert.equal(JSON.stringify(control).includes("MUST_NOT_LEAK"), false);

  response = await fetch(`${base}/operational-workspaces?view=unknown`, { headers: { cookie } });
  assert.equal(response.status, 422);
  await response.text();

  response = await fetch(`${base}/admin/users`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": tenant.apiKey },
    body: JSON.stringify({
      userId: "credit-viewer", email: "viewer@operations.example", displayName: "Credit viewer", password: PASSWORD,
      mustChangePassword: false, adminRoles: [], roles: ["credit_officer"], queues: ["credit_ops"], canAssignQueues: [],
      mfaRequired: true, mfaEnabled: true, mfaSecret: MFA
    })
  });
  assert.equal(response.status, 201, await response.clone().text());
  response = await fetch(`${base}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tenant.tenantId, email: "viewer@operations.example", password: PASSWORD, mfaCode: totpCode(MFA) })
  });
  assert.equal(response.status, 200, await response.clone().text());
  const viewerCookie = response.headers.get("set-cookie").split(";", 1)[0];
  response = await fetch(`${base}/operational-workspaces`, { headers: { cookie: viewerCookie } });
  assert.equal(response.status, 200);
  const viewerWorkspace = await response.json();
  assert.equal(viewerWorkspace.activeWorkspace, "origination");
  assert.deepEqual(viewerWorkspace.workspaces.map((entry) => entry.id), ["origination"]);
  response = await fetch(`${base}/operational-workspaces?view=control`, { headers: { cookie: viewerCookie } });
  assert.equal(response.status, 403);
  await response.text();

  response = await fetch(`${base}/operational-workspaces`, { headers: { "x-api-key": tenant.apiKey } });
  assert.equal(response.status, 403);
  await response.text();

  response = await fetch(`${base}/t/${tenant.tenantId}/staff/workspaces`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Operational workspaces/);
  response = await fetch(`${base}/t/${tenant.tenantId}/staff/workspaces.css`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/css/);
  await response.text();
  response = await fetch(`${base}/t/${tenant.tenantId}/staff/workspaces.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  await response.text();
  response = await fetch(`${base}/dashboard/`, { redirect: "manual" });
  assert.equal(response.status, 401, "legacy non-tenant dashboard alias must not exist or redirect");
});
