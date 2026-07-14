import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";

const tenant = { tenantId: "tenant-callbacks", name: "Callback Bank", apiKey: "callback-key" };
async function request(base, path, { method = "GET", body, key = tenant.apiKey } = {}) { return fetch(base + path, { method, headers: { "x-api-key": key, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); }

test("callback delivery API persists claim, retry, DLQ and four-eyes replay tenant-locally", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-provider-callbacks-")); const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant, { tenantId: "other", name: "Other", apiKey: "other-key" }] }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); }); const base = `http://127.0.0.1:${server.address().port}`;
  let response = await request(base, "/integrations/callback-deliveries", { method: "POST", body: { deliveryId: "delivery-1", provider: "bureau", eventId: "event-1", targetRef: "subscription-1", payload: { status: "available" }, signature: "sha256=abc", maxAttempts: 1, baseDelayMs: 1000 } }); assert.equal(response.status, 201, await response.clone().text());
  response = await request(base, "/integrations/callback-deliveries/claim", { method: "POST", body: { workerId: "worker-1" } }); assert.equal((await response.json()).claimed.length, 1);
  response = await request(base, "/integrations/callback-deliveries/delivery-1/attempt", { method: "POST", body: { workerId: "worker-1", outcome: "retryable_failure", errorCode: "HTTP_503", evidenceRef: "attempt-1" } }); assert.equal((await response.json()).delivery.status, "dead_letter");
  response = await request(base, "/integrations/callback-deliveries/delivery-1/replay", { method: "POST", body: { requestedBy: "ops-1", approvedBy: "ops-2", approvalRef: "approval-1", reason: "Provider recovered" } }); assert.equal((await response.json()).delivery.status, "pending");
  response = await request(base, "/integrations/callback-deliveries/queue"); assert.equal((await response.json()).counts.pending, 1);
  response = await request(base, "/integrations/callback-deliveries/queue", { key: "other-key" }); assert.equal((await response.json()).total, 0);
});
