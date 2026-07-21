import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLoanOsServer } from "../apps/api/src/server.js";
import { loadState } from "../apps/api/src/file-store.js";
import { totpCode } from "../apps/api/src/identity.js";

const PASSWORD = "TenantAccessPass1!";
const MFA = "JBSWY3DPEHPK3PXP";

test("usage meter route: fails closed on access, stays open on metering faults, and isolates tenants", async (t) => {
  const tenant = { tenantId: "tenant_meter_api", name: "Meter Bank", apiKey: "meter-api-key" };
  const other = { tenantId: "tenant_meter_other", name: "Other Bank", apiKey: "meter-other-api-key" };
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-meter-"));
  t.after(async () => { await rm(dataDir, { recursive: true, force: true }); });
  const server = await start(dataDir, [tenant, other]);
  t.after(async () => { await close(server); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const cookie = await operator(base, tenant, "operator");
  const otherCookie = await operator(base, other, "operator");

  // --- fail CLOSED at the access boundary -----------------------------------
  let response = await fetch(`${base}/usage-meter`);
  assert.equal(response.status, 401, "an unauthenticated caller never reaches the meter");
  await response.text();

  response = await fetch(`${base}/usage-meter`, { headers: { "x-api-key": tenant.apiKey } });
  await expectStatus(response, 403);
  assert.equal((await response.json()).error.code, "usage_meter_forbidden", "a service key is not an authorised operator");

  // --- fail OPEN on metering faults (ADR 0009) ------------------------------
  response = await post(base, "/usage-meter/events", cookie, {
    events: [
      { eventType: "meter.provider.invoked", sourceRef: "call-1", providerKey: "cibil", quantity: "1", occurredAt: "2026-07-05T00:00:00.000Z" },
      { eventType: "meter.provider.invoked", sourceRef: "call-2", providerKey: "cibil", quantity: "1", occurredAt: "2026-07-06T00:00:00.000Z" },
      { eventType: "meter.not.real", sourceRef: "bad-1", quantity: "1" },
      { eventType: "meter.provider.invoked", sourceRef: "bad-2", quantity: "1" }
    ]
  });
  await expectStatus(response, 207);
  let payload = await response.json();
  assert.equal(payload.accepted.length, 2, "good lines still land when siblings are malformed");
  assert.equal(payload.rejected.length, 2, "bad lines are reported, not thrown");
  assert.deepEqual(payload.rejected.map((entry) => entry.code), ["meter_event_type_unknown", "meter_provider_key_required"]);

  // --- idempotency: a retried adapter callback must not double-bill ---------
  response = await post(base, "/usage-meter/events", cookie, {
    events: [{ eventType: "meter.provider.invoked", sourceRef: "call-1", providerKey: "cibil", quantity: "1", occurredAt: "2026-07-05T00:00:00.000Z" }]
  });
  await expectStatus(response, 201);
  payload = await response.json();
  assert.equal(payload.accepted.length, 0);
  assert.equal(payload.idempotentCount, 1, "the retry is recognised, not recorded again");

  response = await fetch(`${base}/usage-meter`, { headers: { cookie } });
  await expectStatus(response, 200);
  let ledger = (await response.json()).ledger;
  assert.equal(ledger.count, 2);
  assert.equal(ledger.totalsByType["meter.provider.invoked"], "2");
  assert.equal(ledger.integrity.valid, true, "the persisted chain verifies");

  // --- tenant isolation ------------------------------------------------------
  response = await fetch(`${base}/usage-meter`, { headers: { cookie: otherCookie } });
  await expectStatus(response, 200);
  assert.equal((await response.json()).ledger.count, 0, "another tenant sees none of this ledger");

  // --- provider reconciliation ----------------------------------------------
  response = await post(base, "/usage-meter/reconciliations", cookie, {
    reconciliationId: "rec-1",
    providerKey: "cibil",
    periodFrom: "2026-07-01T00:00:00.000Z",
    periodTo: "2026-08-01T00:00:00.000Z",
    invoicedQuantity: "2"
  });
  await expectStatus(response, 201);
  let reconciliation = (await response.json()).reconciliation;
  assert.equal(reconciliation.status, "reconciled");
  assert.equal(reconciliation.meteredQuantity, "2");
  assert.equal(reconciliation.openedBy, "operator", "the acting human is bound to the reconciliation");

  response = await post(base, "/usage-meter/reconciliations", cookie, {
    reconciliationId: "rec-2",
    providerKey: "cibil",
    periodFrom: "2026-07-01T00:00:00.000Z",
    periodTo: "2026-08-01T00:00:00.000Z",
    invoicedQuantity: "9"
  });
  await expectStatus(response, 201);
  reconciliation = (await response.json()).reconciliation;
  assert.equal(reconciliation.status, "exception", "a 350% variance is an operational item, not a rounding note");

  // duplicate reconciliation id fails closed with a conflict
  response = await post(base, "/usage-meter/reconciliations", cookie, {
    reconciliationId: "rec-2",
    providerKey: "cibil",
    periodFrom: "2026-07-01T00:00:00.000Z",
    periodTo: "2026-08-01T00:00:00.000Z",
    invoicedQuantity: "9"
  });
  await expectStatus(response, 409);
  await response.text();

  response = await fetch(`${base}/usage-meter/reconciliations`, { headers: { cookie } });
  await expectStatus(response, 200);
  const reconciliations = (await response.json()).reconciliations;
  assert.equal(reconciliations.count, 2);
  assert.equal(reconciliations.exceptionCount, 1);

  // --- replay is safe on an already-complete ledger ---------------------------
  response = await post(base, "/usage-meter/replay", cookie, {});
  await expectStatus(response, 200);
  const replay = await response.json();
  assert.equal(replay.recovered.length, 0, "nothing to recover when nothing was lost");

  // --- persistence and audit -------------------------------------------------
  const persisted = await loadState(dataDir);
  const tenantState = persisted.tenants[tenant.tenantId];
  assert.equal(tenantState.meterEvents.length, 2);
  assert.ok(tenantState.meterEvents.every((event) => event.tenantId === tenant.tenantId));
  assert.deepEqual(persisted.tenants[other.tenantId].meterEvents, [], "the other tenant's ledger is empty, not shared");
  const meterAudit = tenantState.events.filter((event) => String(event.type).startsWith("usage_meter."));
  assert.ok(meterAudit.some((event) => event.type === "usage_meter.events_captured" && event.rejectedCount === 2),
    "a metering fault is visible in the audit spine without having blocked the call");
  assert.ok(meterAudit.some((event) => event.type === "usage_meter.provider_reconciled" && event.status === "exception"));
});

async function operator(base, tenant, userId) {
  let response = await fetch(`${base}/admin/users`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": tenant.apiKey },
    body: JSON.stringify({
      userId, email: `${userId}@${tenant.tenantId}.example`, displayName: userId, password: PASSWORD,
      mustChangePassword: false, adminRoles: ["tenant_admin"], mfaRequired: true, mfaEnabled: true, mfaSecret: MFA
    })
  });
  await expectStatus(response, 201);
  await response.text();
  response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tenant.tenantId, email: `${userId}@${tenant.tenantId}.example`, password: PASSWORD, mfaCode: totpCode(MFA) })
  });
  await expectStatus(response, 200);
  const cookie = response.headers.get("set-cookie").split(";", 1)[0];
  await response.text();
  return cookie;
}

async function post(base, path, cookie, body) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });
}
async function start(dataDir, tenants) {
  const server = createLoanOsServer({ dataDir, bootstrapTenants: tenants });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await fetch(`http://127.0.0.1:${server.address().port}/health`);
  return server;
}
async function close(server) { if (!server?.listening) return; await new Promise((resolve) => server.close(resolve)); }
async function expectStatus(response, expected) {
  if (response.status === expected) return;
  assert.equal(response.status, expected, await response.clone().text());
}
