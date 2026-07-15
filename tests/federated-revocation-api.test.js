import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { loadState, saveState } from "../apps/api/src/file-store.js";

test("federated logout endpoint requires tenant service authority and persists revocation evidence", async (t) => {
  const tenant = { tenantId: "tenant_logout", name: "Logout Bank", apiKey: "logout-service-key" }; const dataDir = await mkdtemp(join(tmpdir(), "loanos-logout-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`; await fetch(`${base}/health`); const now = new Date();
  let state = await loadState(dataDir); state.tenants[tenant.tenantId].federationPolicies.idp = { policyId: "idp", status: "active", issuer: "https://idp.bank.in", audience: "loanos" };
  state.tenants[tenant.tenantId].users.u1 = { userId: "u1", email: "u1@bank.in", status: "active", federationPolicyId: "idp", federationExternalId: "subject-1", authenticationSource: "federated" };
  state.controlPlane.sessions.s1 = { sessionId: "s1", tokenHash: "opaque", principalType: "tenant_user", tenantId: tenant.tenantId, userId: "u1", email: "u1@bank.in", roles: [], status: "active", federationPolicyId: "idp", federationSubject: "subject-1", providerSessionId: "sid-1", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString(), lastSeenAt: now.toISOString() };
  await saveState(state, dataDir);
  const body = { eventId: "logout-1", policyId: "idp", protocol: "oidc_backchannel_logout", issuer: "https://idp.bank.in", audience: "loanos", subject: "subject-1", providerSessionId: "sid-1", issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString(), signatureVerified: true, providerEvidenceRef: "idp-event-1", evidenceChecksumSha256: createHash("sha256").update("event").digest("hex") };
  let response = await fetch(`${base}/federation/v1/logout-events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.equal(response.status, 401);
  response = await fetch(`${base}/federation/v1/logout-events`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify(body) }); assert.equal(response.status, 201, await response.clone().text()); assert.deepEqual((await response.json()).revokedSessionIds, ["s1"]);
  state = await loadState(dataDir); assert.equal(state.controlPlane.sessions.s1.status, "revoked"); assert.equal(state.tenants[tenant.tenantId].federatedRevocationEvents["logout-1"].commerciallyLive, false);
  response = await fetch(`${base}/federation/v1/logout-events`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify(body) }); assert.equal(response.status, 200); assert.equal((await response.json()).idempotent, true);
});
