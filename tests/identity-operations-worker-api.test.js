import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLoanOsServer } from "../apps/api/src/server.js";
import { totpCode } from "../apps/api/src/identity.js";

const PASSWORD = "TenantAccessPass1!"; const MFA = "JBSWY3DPEHPK3PXP";
const digest = (value) => createHash("sha256").update(value).digest("hex");

test("identity operations worker API durably schedules, fences, completes and finalizes service work", async (t) => {
  const tenant = { tenantId: "tenant_worker_api", name: "Worker Bank", apiKey: "worker-api-key" }; const dataDir = await mkdtemp(join(tmpdir(), "loanos-worker-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`; await fetch(`${base}/health`);
  let response = await fetch(`${base}/admin/users`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify({ userId: "admin", email: "admin@worker.example", displayName: "Worker admin", password: PASSWORD, mustChangePassword: false, adminRoles: ["security_admin"], mfaRequired: true, mfaEnabled: true, mfaSecret: MFA }) }); assert.equal(response.status, 201);
  response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: tenant.tenantId, email: "admin@worker.example", password: PASSWORD, mfaCode: totpCode(MFA) }) }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie").split(";", 1)[0];
  response = await fetch(`${base}/admin/identity-operations/worker/jobs`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ serviceCredentialId: "svc_default", jobId: "job-api-1", type: "identity_readiness_assessment", purpose: "scheduled readiness verification", idempotencyKey: "worker-api/job-1", payload: { policyRef: "identity-readiness/v1" } }) }); assert.equal(response.status, 201, await response.clone().text());
  const serviceHeaders = { "content-type": "application/json", "x-api-key": tenant.apiKey };
  response = await fetch(`${base}/identity-operations-worker/v1/claims`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ runId: "run-api-1", workerId: "worker-pod-1", leaseMs: 30_000 }) }); assert.equal(response.status, 200, await response.clone().text()); const claim = await response.json(); assert.equal(claim.claimed.length, 1);
  const job = claim.claimed[0];
  response = await fetch(`${base}/identity-operations-worker/v1/jobs/job-api-1/outcome`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ runId: "run-api-1", fencingToken: job.lease.fencingToken, outcome: "succeeded", accepted: true, evidenceRef: "evidence://worker/job-api-1", evidenceChecksumSha256: digest("job-evidence"), resultChecksumSha256: digest("job-result") }) }); assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).job.status, "completed");
  response = await fetch(`${base}/identity-operations-worker/v1/runs/run-api-1/finalize`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ workerId: "worker-pod-1", runEvidenceRef: "evidence://worker/run-api-1", runEvidenceChecksumSha256: digest("run-evidence") }) }); assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).run.status, "completed");
  response = await fetch(`${base}/admin/identity-operations/worker`, { headers: { cookie } }); assert.equal(response.status, 200); const projection = await response.json(); assert.equal(projection.jobs[0].status, "completed"); assert.equal(projection.runs[0].status, "completed");
});
