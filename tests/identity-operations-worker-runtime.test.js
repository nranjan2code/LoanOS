import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  IdentityOperationsWorkerRuntime,
  claimIdentityOperationsJobs,
  createIdentityOperationsExecutionHandlers,
  createIdentityOperationsWorkerApiClient,
  finalizeIdentityOperationsWorkerRun,
  recordIdentityOperationsJobOutcome,
  scheduleIdentityOperationsJob
} from "@loanos/core";

const TENANT = "tenant-runtime";
const WORKLOAD = "loanos-service://tenant-runtime/svc-worker";
const NOW = new Date("2026-07-15T00:00:00.000Z");
const digest = (value) => createHash("sha256").update(value).digest("hex");

function protocolClient(payload = { policyRef: "identity-readiness/v1" }, options = {}) {
  let scheduled = scheduleIdentityOperationsJob({}, {
    tenantId: TENANT,
    jobId: "job-1",
    type: "identity_readiness_assessment",
    workloadIdentityRef: WORKLOAD,
    purpose: "runtime acceptance",
    idempotencyKey: "runtime/job-1",
    payload,
    maxAttempts: 2
  }, NOW).state;
  let finalizations = 0;
  return {
    get state() { return scheduled; },
    get finalizations() { return finalizations; },
    async claim(input) {
      const result = claimIdentityOperationsJobs(scheduled, { ...input, tenantId: TENANT, workloadIdentityRef: WORKLOAD }, NOW);
      scheduled = result.state;
      return { run: result.run, claimed: result.claimed };
    },
    async outcome(jobId, input) {
      if (options.rejectOutcome) throw Object.assign(new Error("database unavailable"), { code: "database_unavailable" });
      const result = recordIdentityOperationsJobOutcome(scheduled, { ...input, tenantId: TENANT, jobId, workloadIdentityRef: WORKLOAD }, new Date(NOW.getTime() + 1_000));
      scheduled = result.state;
      return { job: result.job };
    },
    async finalize(runId, input) {
      finalizations += 1;
      const result = finalizeIdentityOperationsWorkerRun(scheduled, { ...input, tenantId: TENANT, runId, workloadIdentityRef: WORKLOAD }, new Date(NOW.getTime() + 2_000));
      scheduled = result.state;
      return { run: result.run };
    }
  };
}

test("runnable simulator claims, checksums, completes and finalizes the durable protocol", async () => {
  const client = protocolClient();
  const runtime = new IdentityOperationsWorkerRuntime({ client, handlers: createIdentityOperationsExecutionHandlers({}, { executionMode: "simulated" }), workerId: "worker-1", executionMode: "simulated" });
  const result = await runtime.runOnce({ runId: "run-1", now: NOW });
  assert.equal(result.status, "completed");
  assert.equal(result.processed, 1);
  assert.equal(client.state.identityOperationsJobs[`${TENANT}:job-1`].status, "completed");
  assert.equal(client.state.identityOperationsWorkerRuns[`${TENANT}:run-1`].status, "completed");
  assert.equal(runtime.health().commerciallyLive, false);
  assert.match(runtime.prometheus(), /loanos_identity_worker_jobs_succeeded_total 1/);
});

test("reference-only simulator fails secret-bearing payloads closed to dead letter", async () => {
  const client = protocolClient({ policyRef: "identity-readiness/v1", apiKey: "must-not-enter-a-job" });
  const runtime = new IdentityOperationsWorkerRuntime({ client, handlers: createIdentityOperationsExecutionHandlers(), workerId: "worker-2" });
  const result = await runtime.runOnce({ runId: "run-secret", now: NOW });
  assert.equal(result.status, "failed_closed");
  assert.equal(result.results[0].status, "dead_letter");
  assert.equal(client.state.identityOperationsJobs[`${TENANT}:job-1`].lastError.errorCode, "identity_worker_payload_secret_forbidden");
  assert.equal(client.finalizations, 1);
});

test("outcome persistence failure leaves the lease unresolved and skips unsafe finalization", async () => {
  const client = protocolClient(undefined, { rejectOutcome: true });
  const runtime = new IdentityOperationsWorkerRuntime({ client, handlers: createIdentityOperationsExecutionHandlers(), workerId: "worker-3" });
  const result = await runtime.runOnce({ runId: "run-db-failure", now: NOW });
  assert.equal(result.status, "failed_closed");
  assert.equal(client.state.identityOperationsJobs[`${TENANT}:job-1`].status, "leased");
  assert.equal(client.finalizations, 0);
  assert.equal(runtime.health().metrics.outcomePersistenceFailures, 1);
  assert.equal(runtime.health().ready, false);
});

test("live handlers require injected accepted evidence and timeouts become bounded retries", async () => {
  const client = protocolClient();
  const handlers = createIdentityOperationsExecutionHandlers({ assessIdentityReadiness: async () => new Promise(() => {}) }, { executionMode: "live" });
  const runtime = new IdentityOperationsWorkerRuntime({ client, handlers, workerId: "worker-live", executionMode: "live", leaseMs: 2_000, jobTimeoutMs: 10 });
  const result = await runtime.runOnce({ runId: "run-timeout", now: NOW });
  assert.equal(result.status, "failed_closed");
  assert.equal(result.results[0].status, "retry_wait");
  assert.equal(client.state.identityOperationsJobs[`${TENANT}:job-1`].lastError.errorCode, "identity_worker_job_timeout");
  assert.equal(runtime.health().metrics.jobsTimedOut, 1);
});

test("service-plane client sends tenant credential only as auth and rejects non-success responses", async () => {
  const requests = [];
  const client = createIdentityOperationsWorkerApiClient({
    baseUrl: "https://api.example.test/base/",
    apiKey: "tenant-service-key",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ run: { runId: "run-1" }, claimed: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  await client.claim({ runId: "run-1", workerId: "worker" });
  assert.equal(requests[0].url, "https://api.example.test/identity-operations-worker/v1/claims");
  assert.equal(requests[0].init.headers["x-api-key"], "tenant-service-key");
  assert.equal(requests[0].init.body.includes("tenant-service-key"), false);

  const failing = createIdentityOperationsWorkerApiClient({ baseUrl: "https://api.example.test", apiKey: "key", fetchImpl: async () => new Response(JSON.stringify({ error: { code: "identity_worker_fence_invalid", message: "stale" } }), { status: 409 }) });
  await assert.rejects(() => failing.outcome("job", { fencingToken: digest("stale") }), { code: "identity_worker_fence_invalid" });
});

test("graceful shutdown stops new claims and reports non-ready", async () => {
  const runtime = new IdentityOperationsWorkerRuntime({ client: protocolClient(), handlers: createIdentityOperationsExecutionHandlers() });
  const health = await runtime.shutdown();
  assert.equal(health.status, "stopping");
  assert.equal(health.ready, false);
  assert.equal((await runtime.runOnce()).status, "stopping");
});
