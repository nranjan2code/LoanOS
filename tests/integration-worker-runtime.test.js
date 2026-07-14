import test from "node:test";
import assert from "node:assert/strict";
import { IntegrationWorkerRuntime, createIntegrationWorkerHandlers } from "../packages/core/src/integration-worker-runtime.js";

const NOW = new Date("2026-07-15T00:00:00.000Z");
function memory(jobs = []) { const values = new Map(jobs.map((job) => [job.jobId, structuredClone(job)])); return { values, async loadJobs({ limit }) { return [...values.values()].filter((j) => ["pending", "retry"].includes(j.status)).slice(0, limit).map((item) => structuredClone(item)); }, async saveJob(job, { expectedStatus }) { const prior = values.get(job.jobId); if (prior && prior.status !== expectedStatus) throw Object.assign(new Error("optimistic conflict"), { code: "conflict" }); values.set(job.jobId, structuredClone(job)); } }; }
function leases() { let held = false; return { async acquire() { if (held) return { acquired: false }; held = true; return { acquired: true, fencingToken: "fence-1" }; }, async release() { held = false; } }; }
const job = (jobId, type = "provider_callback_dispatch") => ({ jobId, tenantId: "t1", type, status: "pending", attempt: 0, maxAttempts: 2, payload: { ref: jobId } });

test("bounded run-once dispatches callback and signed-file ports with persistent evidence", async () => {
  const store = memory([job("j1"), job("j2", "signed_file_poll"), job("j3", "signed_file_process")]); const calls = [];
  const handlers = createIntegrationWorkerHandlers({ dispatchProviderCallback: async (c) => (calls.push(c.job.type), { accepted: true, evidenceRef: "callback/evidence" }), pollSignedFile: async (c) => (calls.push(c.job.type), { accepted: true, evidenceRef: "poll/evidence", outcome: "pending" }), processSignedFileAcknowledgement: async (c) => (calls.push(c.job.type), { accepted: true, evidenceRef: "ack/evidence" }) });
  const runtime = new IntegrationWorkerRuntime({ store, leaseStore: leases(), handlers, ownerId: "worker-1", maxJobsPerRun: 2 }); const result = await runtime.runOnce({ runId: "run-1", now: NOW });
  assert.equal(result.processed, 2); assert.equal(store.values.get("j1").status, "completed"); assert.equal(store.values.get("j2").evidenceRef, "poll/evidence"); assert.equal(store.values.get("j3").status, "pending"); assert.deepEqual(calls, ["provider_callback_dispatch", "signed_file_poll"]); assert.equal(runtime.health().metrics.jobsSucceeded, 2);
});

test("lease contention excludes concurrent ownership and fencing token reaches persistence", async () => {
  const store = memory([job("j")]); let release; const leaseStore = { async acquire() { return release ? { acquired: false } : (release = true, { acquired: true, fencingToken: "fence-9" }); }, async release() { release = false; } };
  const runtime = new IntegrationWorkerRuntime({ store, leaseStore, handlers: { provider_callback_dispatch: async () => new Promise((resolve) => setTimeout(() => resolve({ accepted: true, evidenceRef: "ev" }), 20)) } });
  const first = runtime.runOnce({ runId: "r1", now: NOW }); const second = await runtime.runOnce({ runId: "r2", now: NOW }); assert.equal(second.status, "lease_unavailable"); await first; assert.equal(store.values.get("j").fencingToken, "fence-9"); assert.equal(runtime.health().metrics.leaseContentions, 1);
});

test("handler failure, timeout, missing evidence, and malformed jobs fail closed into retry/dead-letter", async () => {
  const store = memory([job("throw"), job("timeout", "signed_file_poll"), job("no-evidence", "signed_file_process"), { ...job("bad"), type: "unknown", maxAttempts: 0 }]);
  const runtime = new IntegrationWorkerRuntime({ store, leaseStore: leases(), maxJobsPerRun: 10, jobTimeoutMs: 10, handlers: { provider_callback_dispatch: async () => { throw Object.assign(new Error("provider unavailable"), { code: "provider_down" }); }, signed_file_poll: async () => new Promise(() => {}), signed_file_process: async () => ({ accepted: true }) } });
  const result = await runtime.runOnce({ now: NOW }); assert.equal(result.processed, 4); assert.equal(store.values.get("throw").status, "retry"); assert.equal(store.values.get("timeout").lastError.code, "worker_job_timeout"); assert.equal(store.values.get("no-evidence").status, "retry"); assert.equal(store.values.get("bad").status, "dead_letter"); assert.equal(runtime.health().status, "degraded");
});

test("graceful shutdown stops accepting runs and exposes health metrics", async () => {
  const runtime = new IntegrationWorkerRuntime({ store: memory([]), leaseStore: leases(), handlers: {} }); const health = await runtime.shutdown(); assert.equal(health.status, "stopping"); assert.equal(health.acceptingRuns, false); assert.equal((await runtime.runOnce()).status, "stopping");
});
