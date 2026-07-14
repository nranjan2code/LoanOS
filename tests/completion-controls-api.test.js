import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLoanOsServer } from "../apps/api/src/server.js";

test("completion controls persist tenant-local partner onboarding and expose the joined projection", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-completion-")); const tenant = { tenantId: "tenant_completion", name: "Completion Bank", apiKey: "completion-key" }; const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve())); t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); }); const base = `http://127.0.0.1:${server.address().port}`; const headers = { "content-type": "application/json", "x-api-key": tenant.apiKey };
  let response = await fetch(`${base}/completion/channel/partner-onboardings`, { method: "POST", headers, body: JSON.stringify({ partnerId: "dsa-1", partnerType: "dsa", legalName: "Trusted DSA", territoryIds: ["mum-west"], agreementRef: "agreement/1", dueDiligenceRef: "dd/1", conductPolicyRef: "conduct/1", trainingEvidenceRef: "training/1" }) }); assert.equal(response.status, 201, await response.clone().text()); assert.equal((await response.json()).status, "pending_approval");
  response = await fetch(`${base}/completion/operations`, { headers }); assert.equal(response.status, 200); const operations = await response.json(); assert.equal(operations.partnerOnboardings[0].partnerId, "dsa-1"); assert.deepEqual(operations.partnerFinanceInvoices, []);
});
