import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLoanOsServer } from "../apps/api/src/server.js";

const TENANT_A = { tenantId: "tenant_erasure_a", name: "Erasure Bank A", apiKey: "erasure-key-a" };
const TENANT_B = { tenantId: "tenant_erasure_b", name: "Erasure Bank B", apiKey: "erasure-key-b" };

test("data-retention composition fails closed before the extracted route and has no inline fallback", async (t) => {
  const fixture = await startFixture(t);

  const unauthenticated = await fetch(`${fixture.base}/erasure-requests`);
  assert.equal(unauthenticated.status, 401);

  const source = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
  assert.match(source, /routeDataRetentionErasure/);
  assert.doesNotMatch(source, /const erasureMatch/);
  assert.doesNotMatch(source, /const erasureActionMatch/);
  assert.doesNotMatch(source, /executeAutoRetentionCleanup/);
});

test("data-retention route rejects an unknown borrower without persisting domain evidence", async (t) => {
  const fixture = await startFixture(t);

  const blocked = await postJson(fixture.base, "/erasure-requests", TENANT_A.apiKey, {
    borrowerId: "bor_unknown",
    requestedBy: "dpo-a",
    requestChannel: "email"
  });
  assert.equal(blocked.response.status, 422);
  assert.equal(blocked.body.error.code, "erasure_request_invalid");

  const listed = await getJson(fixture.base, "/erasure-requests", TENANT_A.apiKey);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.count, 0);

  const audit = await getJson(fixture.base, "/audit/events", TENANT_A.apiKey);
  assert.equal(
    audit.body.events.some((event) => event.type === "data_erasure.requested"),
    false
  );
});

test("data-retention route preserves tenant isolation and redacts an eligible borrower", async (t) => {
  const fixture = await startFixture(t);
  await createBorrower(fixture.base, TENANT_A.apiKey, "bor_erasure_a", "Borrower A");
  await createBorrower(fixture.base, TENANT_B.apiKey, "bor_erasure_b", "Borrower B");

  const requestA = await postJson(fixture.base, "/erasure-requests", TENANT_A.apiKey, {
    borrowerId: "bor_erasure_a",
    requestedBy: "dpo-a",
    requestChannel: "email"
  });
  assert.equal(requestA.response.status, 201);

  const requestB = await postJson(fixture.base, "/erasure-requests", TENANT_B.apiKey, {
    borrowerId: "bor_erasure_b",
    requestedBy: "dpo-b",
    requestChannel: "portal"
  });
  assert.equal(requestB.response.status, 201);

  const listA = await getJson(fixture.base, "/erasure-requests", TENANT_A.apiKey);
  assert.deepEqual(listA.body.erasureRequests.map((request) => request.borrowerId), ["bor_erasure_a"]);
  const foreignRead = await getJson(
    fixture.base,
    `/erasure-requests/${requestA.body.erasureRequest.erasureRequestId}`,
    TENANT_B.apiKey
  );
  assert.equal(foreignRead.response.status, 404);

  const missingActor = await postJson(
    fixture.base,
    `/erasure-requests/${requestA.body.erasureRequest.erasureRequestId}/fulfillment`,
    TENANT_A.apiKey,
    { confirmationRef: "ERASURE-001" }
  );
  assert.equal(missingActor.response.status, 422);
  assert.equal(missingActor.body.error.code, "erasure_action_blocked");

  const fulfilled = await postJson(
    fixture.base,
    `/erasure-requests/${requestA.body.erasureRequest.erasureRequestId}/fulfillment`,
    TENANT_A.apiKey,
    { actor: "dpo-a", confirmationRef: "ERASURE-001" }
  );
  assert.equal(fulfilled.response.status, 200);
  assert.equal(fulfilled.body.erasureRequest.status, "fulfilled");

  const profileA = await getJson(fixture.base, "/borrowers/bor_erasure_a", TENANT_A.apiKey);
  assert.equal(profileA.body.status, "erased");
  assert.equal(profileA.body.fullName, null);
  const profileB = await getJson(fixture.base, "/borrowers/bor_erasure_b", TENANT_B.apiKey);
  assert.equal(profileB.body.status, "active");
  assert.equal(profileB.body.fullName, "Borrower B");
});

async function startFixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-erasure-route-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A, TENANT_B] });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.address().port}` };
}

async function createBorrower(base, apiKey, borrowerId, fullName) {
  const created = await postJson(base, "/borrowers", apiKey, {
    borrowerId,
    borrowerType: "individual",
    fullName,
    dateOfBirth: "1990-01-01",
    residencyCountry: "IN",
    primaryAddressCountry: "IN",
    primaryAddress: "Mumbai, India",
    contact: { email: `${borrowerId}@example.in`, mobile: "9876543210" },
    economicProfile: { occupation: "salaried", monthlyIncome: 100000 }
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
}

async function getJson(base, path, apiKey) {
  const response = await fetch(`${base}${path}`, { headers: { "x-api-key": apiKey } });
  return { response, body: await response.json() };
}

async function postJson(base, path, apiKey, payload) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(payload)
  });
  return { response, body: await response.json() };
}
