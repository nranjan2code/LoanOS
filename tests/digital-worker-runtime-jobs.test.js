import test from "node:test";
import assert from "node:assert/strict";
import {
  claimDigitalWorkerRuntimeJob,
  completeDigitalWorkerRuntimeJob,
  enqueueDigitalWorkerRuntimeJob,
  failDigitalWorkerRuntimeJob,
  replayDigitalWorkerDeadLetter
} from "@loanos/core/ai/digital-worker-runtime-jobs.js";

const NOW = new Date("2026-07-22T10:00:00.000Z");
const H = "a".repeat(64);
const base = () => ({
  revision: 0,
  runtimeJobs: {},
  executions: { e1: { executionId: "e1", tenantId: "bank-a", installationId: "i1", status: "authorized", inputHash: H, promptHash: H } },
  usageLedger: {}, budgetReservations: {},
  pricingContracts: { c1: { contractId: "c1", tenantId: "bank-a", status: "active", pricing: { per_execution_paise: "25", per_1k_input_tokens_paise: "10", per_1k_output_tokens_paise: "20" } } },
  installations: { i1: { installationId: "i1", tenantId: "bank-a", contractId: "c1", status: "active" } },
  events: []
});

test("runtime job enqueue is content-idempotent and rejects conflicting replay", () => {
  const input = { tenantId: "bank-a", jobId: "j1", executionId: "e1", idempotencyKey: "execute:e1", payload: { outputRef: "proposal/e1" }, payloadChecksumSha256: H };
  // Checksum mismatch is restrictive.
  assert.throws(() => enqueueDigitalWorkerRuntimeJob(base(), input, NOW), (error) => error.code === "digital_worker_job_checksum_mismatch");
  const valid = { ...input, payloadChecksumSha256: "d622f0d59a306a64d7d307f5d737911c98961f147e64ace65b0303b0061ff756" };
  const first = enqueueDigitalWorkerRuntimeJob(base(), valid, NOW);
  const duplicate = enqueueDigitalWorkerRuntimeJob(first.state, { ...valid, jobId: "j2" }, NOW);
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.job.jobId, "j1");
  assert.throws(() => enqueueDigitalWorkerRuntimeJob(first.state, { ...valid, jobId: "j3", payload: { outputRef: "different" }, payloadChecksumSha256: H }, NOW), (error) => ["digital_worker_job_checksum_mismatch", "digital_worker_job_idempotency_conflict"].includes(error.code));
});

test("lease fencing rejects stale workers and exactly one completion records output and usage", () => {
  const input = { tenantId: "bank-a", jobId: "j1", executionId: "e1", idempotencyKey: "execute:e1", payload: {}, payloadChecksumSha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a" };
  let state = enqueueDigitalWorkerRuntimeJob(base(), input, NOW).state;
  const claim = claimDigitalWorkerRuntimeJob(state, { tenantId: "bank-a", workerId: "worker-1", leaseMs: 30_000 }, NOW);
  state = claim.state;
  assert.equal(claim.job.lease.fence, 1);
  assert.throws(() => completeDigitalWorkerRuntimeJob(state, { tenantId: "bank-a", jobId: "j1", workerId: "worker-2", fence: 1, outputRef: "proposal/e1", outputHash: H, providerEvidenceRef: "provider/run/1", usage: { inputTokens: "10", outputTokens: "5", toolCalls: "1" } }, NOW), (error) => error.code === "digital_worker_job_lease_fenced");
  const completed = completeDigitalWorkerRuntimeJob(state, { tenantId: "bank-a", jobId: "j1", workerId: "worker-1", fence: 1, outputRef: "proposal/e1", outputHash: H, providerEvidenceRef: "provider/run/1", usage: { inputTokens: "10", outputTokens: "5", toolCalls: "1" } }, NOW);
  assert.equal(completed.job.status, "completed");
  assert.equal(completed.state.executions.e1.status, "completed");
  assert.ok(completed.state.usageLedger["runtime-usage:e1"]);
  const replay = completeDigitalWorkerRuntimeJob(completed.state, { tenantId: "bank-a", jobId: "j1", workerId: "worker-1", fence: 1, outputRef: "proposal/e1", outputHash: H, providerEvidenceRef: "provider/run/1", usage: { inputTokens: "10", outputTokens: "5", toolCalls: "1" } }, NOW);
  assert.equal(replay.idempotent, true);
});

test("failures retry with bounded attempts then require four-eyes dead-letter replay", () => {
  const input = { tenantId: "bank-a", jobId: "j1", executionId: "e1", idempotencyKey: "execute:e1", payload: {}, payloadChecksumSha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a", maxAttempts: 1 };
  let state = enqueueDigitalWorkerRuntimeJob(base(), input, NOW).state;
  let claim = claimDigitalWorkerRuntimeJob(state, { tenantId: "bank-a", workerId: "w" }, NOW); state = claim.state;
  const failed = failDigitalWorkerRuntimeJob(state, { tenantId: "bank-a", jobId: "j1", workerId: "w", fence: claim.job.lease.fence, errorCode: "provider_timeout", errorEvidenceRef: "runtime/error/1" }, NOW);
  assert.equal(failed.job.status, "dead_letter");
  assert.throws(() => replayDigitalWorkerDeadLetter(failed.state, { tenantId: "bank-a", jobId: "j1", proposedBy: "risk", approvedBy: "risk", approvalRef: "approval/1", reason: "provider recovered" }, NOW), (error) => error.code === "digital_worker_job_replay_four_eyes_required");
  const replayed = replayDigitalWorkerDeadLetter(failed.state, { tenantId: "bank-a", jobId: "j1", proposedBy: "risk", approvedBy: "validator", approvalRef: "approval/1", reason: "provider recovered" }, NOW);
  assert.equal(replayed.job.status, "queued");
});
