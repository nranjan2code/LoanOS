import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLoanOsServer } from "../apps/api/src/server.js";
import { loadState, saveState } from "../apps/api/src/file-store.js";
import { totpCode } from "../apps/api/src/identity.js";

const PASSWORD = "TenantAccessPass1!";
const MFA = "JBSWY3DPEHPK3PXP";

test("journey workspace API binds tenant, actor and role while persisting redacted drafts", async (t) => {
  const tenant = { tenantId: "tenant_workspace_api", name: "Workspace Bank", apiKey: "workspace-api-key" };
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-workspace-"));
  t.after(async () => { await rm(dataDir, { recursive: true, force: true }); });
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await (await fetch(`${base}/health`)).text();

  let response = await fetch(`${base}/admin/users`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify({ userId: "credit-user", email: "credit@workspace.example", displayName: "Credit user", password: PASSWORD, mustChangePassword: false, adminRoles: ["tenant_admin"], mfaRequired: true, mfaEnabled: true, mfaSecret: MFA }) });
  await expectStatus(response, 201);
  await response.text();
  response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: tenant.tenantId, email: "credit@workspace.example", password: PASSWORD, mfaCode: totpCode(MFA) }) });
  await expectStatus(response, 200);
  const cookie = response.headers.get("set-cookie").split(";", 1)[0];
  await response.text();

  const state = await loadState(dataDir);
  state.tenants[tenant.tenantId].tenantProductSubscriptions = { "subscription-1": { subscriptionId: "subscription-1", tenantId: tenant.tenantId, productTypes: ["home_loan", "gold_loan"], effectiveFrom: "2026-01-01T00:00:00.000Z", validUntil: "2030-01-01T00:00:00.000Z", status: "active" } };
  await saveState(state, dataDir);

  response = await fetch(`${base}/journey-workspaces/credit/catalogue`, { headers: { cookie } });
  await expectStatus(response, 200);
  const catalogue = (await response.json()).catalogue;
  assert.equal(catalogue.journeyCount, 2);
  assert.equal(catalogue.schemaCount, 2);
  assert.deepEqual(catalogue.journeys.map((item) => item.journeyType), ["gold_loan", "home_loan"]);

  response = await fetch(`${base}/journey-workspaces/credit/schemas/home_loan`, { headers: { cookie } });
  await expectStatus(response, 200);
  const schema = (await response.json()).schema;
  assert.equal(schema.schemaId, "journey-workspace/property_secured");
  assert.match(schema.schemaChecksumSha256, /^[a-f0-9]{64}$/);

  response = await fetch(`${base}/journey-workspaces/credit/drafts/home_loan`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ draftId: "draft-api-1", idempotencyKey: "idem-api-1", values: { requested_amount_paise: "5000000" } }) });
  await expectStatus(response, 201);
  const draft = (await response.json()).draft;
  assert.notEqual(draft.values.requested_amount_paise, "5000000");

  response = await fetch(`${base}/journey-workspaces/credit/drafts`, { headers: { cookie } });
  await expectStatus(response, 200);
  assert.equal((await response.json()).drafts.length, 1);

  response = await fetch(`${base}/journey-workspaces/credit/catalogue`, { headers: { "x-api-key": tenant.apiKey } });
  assert.equal(response.status, 403);
  await response.text();
  response = await fetch(`${base}/journey-workspaces/partner/catalogue`, { headers: { cookie } });
  assert.equal(response.status, 200, "tenant admin may preview and operate an authorised partner channel");
  await response.text();

  response = await fetch(`${base}/t/${tenant.tenantId}/staff/journeys/`);
  await expectStatus(response, 200);
  assert.match(await response.text(), /Choose a lending journey/);

  const persisted = await loadState(dataDir);
  assert.equal(persisted.tenants[tenant.tenantId].journeyWorkspaceDrafts[`${tenant.tenantId}:draft-api-1`].actorId, "credit-user");
  const audit = persisted.tenants[tenant.tenantId].events.find((item) => item.type === "journey_workspace.draft_saved");
  assert.equal(JSON.stringify(audit).includes("Asha Sharma"), false);
  assert.equal(JSON.stringify(audit).includes("5000000"), false);
});

async function expectStatus(response, expected) {
  if (response.status === expected) return;
  assert.equal(response.status, expected, await response.clone().text());
}
