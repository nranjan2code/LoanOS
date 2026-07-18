import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  claimIdentityOperationsJobs,
  finalizeIdentityOperationsWorkerRun,
  IDENTITY_OPERATION_JOB_TYPES,
  IDENTITY_OPERATIONS_WORKER_STATE_FIELDS,
  recordIdentityOperationsJobOutcome,
  replayIdentityOperationsDeadLetter,
  scheduleIdentityOperationsJob
} from "@loanos/core/identity/identity-operations-worker.js";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const WORKLOAD = "workload://tenant-a/identity-operations";

function input(overrides = {}) {
  return {
    tenantId: "tenant-a",
    jobId: "job-1",
    type: "identity_readiness_assessment",
    workloadIdentityRef: WORKLOAD,
    purpose: "continuous-tenant-readiness",
    idempotencyKey: "ready/tenant-a/2026-07-15T12",
    payload: { tenantRef: "tenant-a", policyRef: "policy/identity-readiness/v1" },
    scheduledAt: NOW,
    maxAttempts: 2,
    baseBackoffMs: 1_000,
    maximumBackoffMs: 4_000,
    ...overrides
  };
}

function claim(state, overrides = {}, now = NOW) {
  return claimIdentityOperationsJobs(state, { tenantId: "tenant-a", runId: "run-1", workerId: "worker-a", workloadIdentityRef: WORKLOAD, leaseMs: 30_000, ...overrides }, now);
}

function failure(state, job, overrides = {}, now = new Date("2026-07-15T12:00:01.000Z")) {
  return recordIdentityOperationsJobOutcome(state, {
    tenantId: "tenant-a",
    jobId: job.jobId,
    runId: job.lease.runId,
    workloadIdentityRef: WORKLOAD,
    fencingToken: job.lease.fencingToken,
    outcome: "failed",
    retryable: true,
    errorCode: "provider_unavailable",
    errorMessage: "The authoritative source did not respond.",
    evidenceRef: "evidence://worker/failure",
    evidenceChecksumSha256: digest("failure"),
    ...overrides
  }, now);
}

test("worker state contract and operational job families are explicit", () => {
  assert.deepEqual(IDENTITY_OPERATION_JOB_TYPES, ["identity_readiness_assessment", "directory_reconciliation", "federation_metadata_validation", "activity_custody_verification"]);
  assert.deepEqual(IDENTITY_OPERATIONS_WORKER_STATE_FIELDS, ["identityOperationsJobs", "identityOperationsWorkerRuns", "identityOperationsDeadLetters", "identityOperationsJobReplays", "identityOperationsAlerts", "identityOperationsEscalations"]);
});

test("scheduling is checksummed, tenant-scoped and idempotent while rejecting unnamed identities", () => {
  const first = scheduleIdentityOperationsJob({}, input(), NOW);
  assert.equal(first.job.status, "scheduled");
  assert.equal(first.job.payloadChecksumSha256, digest(JSON.stringify({ policyRef: "policy/identity-readiness/v1", tenantRef: "tenant-a" })));
  const duplicate = scheduleIdentityOperationsJob(first.state, input(), NOW);
  assert.equal(duplicate.idempotent, true);
  assert.throws(() => scheduleIdentityOperationsJob(first.state, input({ payload: { changed: true } }), NOW), (error) => error.code === "identity_worker_job_idempotency_conflict");
  assert.throws(() => scheduleIdentityOperationsJob({}, input({ workloadIdentityRef: "worker-a" }), NOW), (error) => error.code === "identity_worker_workload_identity_invalid");
  const otherTenant = scheduleIdentityOperationsJob(first.state, input({ tenantId: "tenant-b" }), NOW);
  assert.equal(Object.keys(otherTenant.state.identityOperationsJobs).length, 2);
});

test("claiming is tenant and workload fenced, bounded, run-idempotent and rejects stale tokens", () => {
  let state = scheduleIdentityOperationsJob({}, input(), NOW).state;
  state = scheduleIdentityOperationsJob(state, input({ jobId: "job-2", type: "directory_reconciliation", idempotencyKey: "reconcile/1" }), NOW).state;
  const wrongIdentity = claim(state, { runId: "wrong", workloadIdentityRef: "workload://tenant-a/other" });
  assert.equal(wrongIdentity.claimed.length, 0);
  const first = claim(state, { limit: 1 });
  assert.equal(first.claimed.length, 1);
  assert.equal(first.claimed[0].lease.workloadIdentityRef, WORKLOAD);
  const sameRun = claim(first.state, { limit: 100 });
  assert.equal(sameRun.idempotent, true);
  assert.equal(sameRun.claimed.length, 1);
  assert.throws(() => recordIdentityOperationsJobOutcome(first.state, {
    tenantId: "tenant-a", jobId: first.claimed[0].jobId, runId: "run-1", workloadIdentityRef: WORKLOAD, fencingToken: "stale", outcome: "succeeded", accepted: true, evidenceRef: "evidence://success", evidenceChecksumSha256: digest("evidence"), resultChecksumSha256: digest("result")
  }, new Date("2026-07-15T12:00:01Z")), (error) => error.code === "identity_worker_fence_invalid");
  assert.throws(() => recordIdentityOperationsJobOutcome(first.state, {
    tenantId: "tenant-b", jobId: first.claimed[0].jobId, runId: "run-1", workloadIdentityRef: WORKLOAD, fencingToken: first.claimed[0].lease.fencingToken, outcome: "succeeded", accepted: true, evidenceRef: "evidence://success", evidenceChecksumSha256: digest("evidence"), resultChecksumSha256: digest("result")
  }, new Date("2026-07-15T12:00:01Z")), (error) => error.code === "identity_worker_job_not_found");
});

test("retry uses deterministic exponential backoff and emits visible alert output", () => {
  const scheduled = scheduleIdentityOperationsJob({}, input(), NOW);
  const claimed = claim(scheduled.state);
  const result = failure(claimed.state, claimed.claimed[0]);
  assert.equal(result.job.status, "retry_wait");
  assert.equal(result.job.nextAttemptAt, "2026-07-15T12:00:02.000Z");
  assert.equal(result.emittedAlerts.length, 1);
  assert.equal(result.emittedAlerts[0].severity, "warning");
  assert.equal(result.emittedEscalations.length, 0);
  const notDue = claimIdentityOperationsJobs(result.state, { tenantId: "tenant-a", runId: "run-2", workerId: "worker-a", workloadIdentityRef: WORKLOAD }, new Date("2026-07-15T12:00:01.500Z"));
  assert.equal(notDue.claimed.length, 0);
  const retry = claimIdentityOperationsJobs(result.state, { tenantId: "tenant-a", runId: "run-2", workerId: "worker-a", workloadIdentityRef: WORKLOAD }, new Date("2026-07-15T12:00:02Z"));
  assert.equal(retry.claimed[0].attempt, 2);
});

test("lease expiry reclaims with a higher fence and the former worker fails closed", () => {
  const scheduled = scheduleIdentityOperationsJob({}, input(), NOW);
  const first = claim(scheduled.state, { leaseMs: 1_000 });
  const reclaimed = claimIdentityOperationsJobs(first.state, { tenantId: "tenant-a", runId: "run-2", workerId: "worker-b", workloadIdentityRef: WORKLOAD, leaseMs: 30_000 }, new Date("2026-07-15T12:00:02Z"));
  assert.equal(reclaimed.claimed[0].fenceGeneration, 2);
  assert.notEqual(reclaimed.claimed[0].lease.fencingToken, first.claimed[0].lease.fencingToken);
  assert.ok(reclaimed.emittedAlerts.some((alert) => alert.code === "identity_worker_lease_expired"));
  assert.throws(() => recordIdentityOperationsJobOutcome(reclaimed.state, {
    tenantId: "tenant-a", jobId: "job-1", runId: "run-1", workloadIdentityRef: WORKLOAD, fencingToken: first.claimed[0].lease.fencingToken, outcome: "succeeded", accepted: true, evidenceRef: "evidence://late", evidenceChecksumSha256: digest("late"), resultChecksumSha256: digest("result")
  }, new Date("2026-07-15T12:00:03Z")), (error) => error.code === "identity_worker_fence_invalid");
});

test("an expired final-attempt lease is dead-lettered instead of exceeding the retry bound", () => {
  const scheduled = scheduleIdentityOperationsJob({}, input({ maxAttempts: 1 }), NOW);
  const first = claim(scheduled.state, { leaseMs: 1_000 });
  const swept = claimIdentityOperationsJobs(first.state, { tenantId: "tenant-a", runId: "run-2", workerId: "worker-b", workloadIdentityRef: WORKLOAD }, new Date("2026-07-15T12:00:02Z"));
  assert.equal(swept.claimed.length, 0);
  assert.equal(swept.state.identityOperationsJobs["tenant-a:job-1"].status, "dead_letter");
  assert.equal(Object.keys(swept.state.identityOperationsDeadLetters).length, 1);
  assert.equal(swept.emittedEscalations.length, 1);
});

test("exhausted failure creates a checksummed DLQ record, alert and escalation", () => {
  let state = scheduleIdentityOperationsJob({}, input({ maxAttempts: 1 }), NOW).state;
  const claimed = claim(state);
  const failed = failure(claimed.state, claimed.claimed[0]);
  assert.equal(failed.job.status, "dead_letter");
  assert.equal(failed.deadLetter.status, "open");
  assert.equal(failed.emittedAlerts[0].severity, "critical");
  assert.equal(failed.emittedEscalations.length, 1);
  assert.match(failed.emittedEscalations[0].requiredAction, /independently authorize/);
});

test("dead-letter replay requires independent authority and creates a new lineage-linked job", () => {
  const scheduled = scheduleIdentityOperationsJob({}, input({ maxAttempts: 1 }), NOW);
  const claimed = claim(scheduled.state);
  const failed = failure(claimed.state, claimed.claimed[0]);
  const replayInput = { tenantId: "tenant-a", deadLetterId: failed.deadLetter.deadLetterId, replayId: "replay-1", replayIdempotencyKey: "replay/tenant-a/job-1/1", newJobId: "job-1-replay-1", requestedBy: "operator-maker", authorizedBy: "security-checker", authorizationRef: "approval://replay/1", reason: "Provider restored and evidence reviewed." };
  assert.throws(() => replayIdentityOperationsDeadLetter(failed.state, { ...replayInput, authorizedBy: "operator-maker" }, NOW), (error) => error.code === "identity_worker_replay_four_eyes");
  const replayed = replayIdentityOperationsDeadLetter(failed.state, replayInput, NOW);
  assert.equal(replayed.job.parentDeadLetterId, failed.deadLetter.deadLetterId);
  assert.equal(replayed.state.identityOperationsDeadLetters[`tenant-a:${failed.deadLetter.deadLetterId}`].status, "replayed");
  assert.equal(replayIdentityOperationsDeadLetter(replayed.state, replayInput, NOW).idempotent, true);
  assert.throws(() => replayIdentityOperationsDeadLetter(replayed.state, { ...replayInput, reason: "Different authorization context." }, NOW), (error) => error.code === "identity_worker_replay_idempotency_conflict");
  assert.throws(() => replayIdentityOperationsDeadLetter(failed.state, { ...replayInput, tenantId: "tenant-b" }, NOW), (error) => error.code === "identity_worker_dead_letter_not_open");
});

test("run finalization requires every durable outcome and marks runs with retries failed closed", () => {
  const scheduled = scheduleIdentityOperationsJob({}, input(), NOW);
  const claimed = claim(scheduled.state);
  const finalizeInput = { tenantId: "tenant-a", runId: "run-1", workerId: "worker-a", workloadIdentityRef: WORKLOAD, runEvidenceRef: "evidence://worker/run-1", runEvidenceChecksumSha256: digest("run-1") };
  assert.throws(() => finalizeIdentityOperationsWorkerRun(claimed.state, finalizeInput, NOW), (error) => error.code === "identity_worker_run_incomplete");
  const failed = failure(claimed.state, claimed.claimed[0]);
  const finalized = finalizeIdentityOperationsWorkerRun(failed.state, finalizeInput, new Date("2026-07-15T12:00:02Z"));
  assert.equal(finalized.run.status, "failed_closed");
  assert.deepEqual(finalized.run.summary, { completed: 0, retryWait: 1, deadLetter: 0, displaced: 0 });
  assert.match(finalized.run.runChecksumSha256, /^[a-f0-9]{64}$/);
});
