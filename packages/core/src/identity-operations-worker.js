import { createHash } from "node:crypto";

export const IDENTITY_OPERATION_JOB_TYPES = Object.freeze([
  "identity_readiness_assessment",
  "directory_reconciliation",
  "federation_metadata_validation",
  "activity_custody_verification"
]);

export const IDENTITY_OPERATIONS_WORKER_STATE_FIELDS = Object.freeze([
  "identityOperationsJobs",
  "identityOperationsWorkerRuns",
  "identityOperationsDeadLetters",
  "identityOperationsJobReplays",
  "identityOperationsAlerts",
  "identityOperationsEscalations"
]);

const JOB_TYPES = new Set(IDENTITY_OPERATION_JOB_TYPES);
const CLAIMABLE = new Set(["scheduled", "retry_wait"]);

/**
 * Persist an immutable, tenant-bound operational job envelope. Payloads are
 * checksummed and should contain references, never provider credentials.
 */
export function scheduleIdentityOperationsJob(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const jobId = text(input.jobId, "jobId");
  const type = text(input.type, "type");
  if (!JOB_TYPES.has(type)) fail("identity_worker_job_type_invalid", "Identity operations job type is unsupported.");
  const workloadIdentityRef = workloadRef(input.workloadIdentityRef);
  const idempotencyKey = text(input.idempotencyKey, "idempotencyKey");
  const scheduledAt = instant(input.scheduledAt ?? now, "scheduledAt");
  const payload = clone(input.payload ?? {});
  const maxAttempts = integer(input.maxAttempts ?? 5, 1, 10, "maxAttempts");
  const baseBackoffMs = integer(input.baseBackoffMs ?? 30_000, 1_000, 3_600_000, "baseBackoffMs");
  const maximumBackoffMs = integer(input.maximumBackoffMs ?? 3_600_000, baseBackoffMs, 86_400_000, "maximumBackoffMs");
  const immutable = {
    tenantId,
    jobId,
    type,
    workloadIdentityRef,
    purpose: text(input.purpose, "purpose"),
    idempotencyKey,
    parentDeadLetterId: input.parentDeadLetterId ? text(input.parentDeadLetterId, "parentDeadLetterId") : null,
    payload,
    payloadChecksumSha256: hash(payload),
    scheduledAt: scheduledAt.toISOString(),
    maxAttempts,
    baseBackoffMs,
    maximumBackoffMs
  };
  const envelopeChecksumSha256 = hash(immutable);
  const jobs = state.identityOperationsJobs ?? {};
  const duplicate = Object.values(jobs).find((candidate) => candidate.tenantId === tenantId && (candidate.jobId === jobId || candidate.idempotencyKey === idempotencyKey));
  if (duplicate) {
    if (duplicate.envelopeChecksumSha256 !== envelopeChecksumSha256) fail("identity_worker_job_idempotency_conflict", "Job identity or idempotency key was reused with different content.");
    return { state, job: duplicate, idempotent: true };
  }
  const job = Object.freeze({
    ...immutable,
    envelopeChecksumSha256,
    status: "scheduled",
    attempt: 0,
    fenceGeneration: 0,
    lease: null,
    lastError: null,
    result: null,
    nextAttemptAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  });
  return { state: { ...state, identityOperationsJobs: { ...jobs, [jobKey(tenantId, jobId)]: job } }, job, idempotent: false };
}

/**
 * Claim a bounded batch for exactly one tenant and one named workload identity.
 * Expired leases can be reclaimed; the monotonically increasing fence generation
 * makes every earlier token invalid even when an old worker later resumes.
 */
export function claimIdentityOperationsJobs(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const runId = text(input.runId, "runId");
  const workerId = text(input.workerId, "workerId");
  const workloadIdentityRef = workloadRef(input.workloadIdentityRef);
  const limit = integer(input.limit ?? 25, 1, 100, "limit");
  const leaseMs = integer(input.leaseMs ?? 30_000, 1_000, 3_600_000, "leaseMs");
  const existingRun = state.identityOperationsWorkerRuns?.[runKey(tenantId, runId)];
  if (existingRun) {
    if (existingRun.workerId !== workerId || existingRun.workloadIdentityRef !== workloadIdentityRef) fail("identity_worker_run_idempotency_conflict", "Worker run identity was reused by a different owner.");
    return { state, run: existingRun, claimed: currentRunJobs(state, existingRun), emittedAlerts: [], emittedEscalations: [], idempotent: true };
  }
  const jobs = { ...(state.identityOperationsJobs ?? {}) };
  const alerts = { ...(state.identityOperationsAlerts ?? {}) };
  const escalations = { ...(state.identityOperationsEscalations ?? {}) };
  const deadLetters = { ...(state.identityOperationsDeadLetters ?? {}) };
  const emittedAlerts = [];
  const emittedEscalations = [];
  const candidates = Object.values(jobs)
    .filter((job) => job.tenantId === tenantId && job.workloadIdentityRef === workloadIdentityRef && isDueOrLeaseExpired(job, now))
    .sort((a, b) => dueAt(a).localeCompare(dueAt(b)) || a.jobId.localeCompare(b.jobId))
    .slice(0, limit);
  const claimed = [];
  for (const source of candidates) {
    const leaseExpired = source.status === "leased";
    if (leaseExpired) {
      const exhausted = source.attempt >= source.maxAttempts;
      const output = createAlertAndEscalation(source, "identity_worker_lease_expired", exhausted ? "critical" : "warning", "An operational worker lease expired before a durable outcome was recorded.", now, { escalation: exhausted });
      addOutput(alerts, emittedAlerts, output.alert);
      if (output.escalation) addOutput(escalations, emittedEscalations, output.escalation);
      if (exhausted) {
        const updated = Object.freeze({ ...source, status: "dead_letter", lease: null, nextAttemptAt: null, lastError: Object.freeze({ errorCode: "identity_worker_lease_expired", errorMessage: "The final permitted lease expired without a durable outcome.", evidenceRef: null, evidenceChecksumSha256: null, failedAt: now.toISOString() }), deadLetteredAt: now.toISOString(), updatedAt: now.toISOString() });
        jobs[jobKey(tenantId, source.jobId)] = updated;
        const deadLetter = makeDeadLetter(updated, now);
        deadLetters[deadLetterKey(tenantId, deadLetter.deadLetterId)] = deadLetter;
        continue;
      }
    }
    const attempt = source.attempt + 1;
    const fenceGeneration = source.fenceGeneration + 1;
    const leasedAt = now.toISOString();
    const fencingToken = hash({ tenantId, jobId: source.jobId, runId, workerId, workloadIdentityRef, fenceGeneration, leasedAt });
    const job = Object.freeze({
      ...source,
      status: "leased",
      attempt,
      fenceGeneration,
      lease: Object.freeze({ runId, workerId, workloadIdentityRef, fencingToken, leasedAt, leaseUntil: new Date(now.getTime() + leaseMs).toISOString() }),
      updatedAt: leasedAt
    });
    jobs[jobKey(tenantId, source.jobId)] = job;
    claimed.push(job);
  }
  const runCore = {
    tenantId,
    runId,
    workerId,
    workloadIdentityRef,
    status: claimed.length ? "running" : "completed_empty",
    claimedJobIds: claimed.map((job) => job.jobId),
    claimedFenceGenerations: Object.fromEntries(claimed.map((job) => [job.jobId, job.fenceGeneration])),
    startedAt: now.toISOString(),
    completedAt: claimed.length ? null : now.toISOString()
  };
  const run = Object.freeze({ ...runCore, runChecksumSha256: hash(runCore) });
  return {
    state: {
      ...state,
      identityOperationsJobs: jobs,
      identityOperationsWorkerRuns: { ...(state.identityOperationsWorkerRuns ?? {}), [runKey(tenantId, runId)]: run },
      identityOperationsDeadLetters: deadLetters,
      identityOperationsAlerts: alerts,
      identityOperationsEscalations: escalations
    },
    run,
    claimed,
    emittedAlerts,
    emittedEscalations,
    idempotent: false
  };
}

/** Record a fenced success or a fail-closed retry/dead-letter outcome. */
export function recordIdentityOperationsJobOutcome(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const jobId = text(input.jobId, "jobId");
  const job = sameTenantJob(state, tenantId, jobId);
  const token = text(input.fencingToken, "fencingToken");
  if (job.status !== "leased" || job.lease?.fencingToken !== token || job.lease.runId !== input.runId || job.lease.workloadIdentityRef !== input.workloadIdentityRef) fail("identity_worker_fence_invalid", "The active run, workload identity and fencing token are required.");
  if (Date.parse(job.lease.leaseUntil) <= now.getTime()) fail("identity_worker_lease_expired", "Expired worker leases cannot record an outcome.");
  text(input.evidenceRef, "evidenceRef");
  sha256(input.evidenceChecksumSha256, "evidenceChecksumSha256");
  if (!new Set(["succeeded", "failed"]).has(input.outcome)) fail("identity_worker_outcome_invalid", "Outcome must be succeeded or failed.");
  const jobs = { ...(state.identityOperationsJobs ?? {}) };
  const alerts = { ...(state.identityOperationsAlerts ?? {}) };
  const escalations = { ...(state.identityOperationsEscalations ?? {}) };
  const deadLetters = { ...(state.identityOperationsDeadLetters ?? {}) };
  const emittedAlerts = [];
  const emittedEscalations = [];
  let updated;
  let deadLetter = null;
  if (input.outcome === "succeeded") {
    if (input.accepted !== true) fail("identity_worker_result_unverified", "Successful operational work must be explicitly accepted.");
    sha256(input.resultChecksumSha256, "resultChecksumSha256");
    updated = Object.freeze({
      ...job,
      status: "completed",
      lease: null,
      result: Object.freeze({ accepted: true, evidenceRef: input.evidenceRef, evidenceChecksumSha256: input.evidenceChecksumSha256, resultChecksumSha256: input.resultChecksumSha256 }),
      lastError: null,
      completedAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
  } else {
    const errorCode = text(input.errorCode, "errorCode");
    const errorMessage = text(input.errorMessage, "errorMessage").slice(0, 500);
    const retryable = input.retryable === true && job.attempt < job.maxAttempts;
    const delayMs = retryable ? retryDelay(job) : null;
    updated = Object.freeze({
      ...job,
      status: retryable ? "retry_wait" : "dead_letter",
      lease: null,
      lastError: Object.freeze({ errorCode, errorMessage, evidenceRef: input.evidenceRef, evidenceChecksumSha256: input.evidenceChecksumSha256, failedAt: now.toISOString() }),
      nextAttemptAt: retryable ? new Date(now.getTime() + delayMs).toISOString() : null,
      deadLetteredAt: retryable ? null : now.toISOString(),
      updatedAt: now.toISOString()
    });
    const output = createAlertAndEscalation(updated, errorCode, retryable ? "warning" : "critical", errorMessage, now, { escalation: !retryable });
    addOutput(alerts, emittedAlerts, output.alert);
    if (output.escalation) addOutput(escalations, emittedEscalations, output.escalation);
    if (!retryable) {
      deadLetter = makeDeadLetter(updated, now);
      deadLetters[deadLetterKey(tenantId, deadLetter.deadLetterId)] = deadLetter;
    }
  }
  jobs[jobKey(tenantId, jobId)] = updated;
  return {
    state: { ...state, identityOperationsJobs: jobs, identityOperationsDeadLetters: deadLetters, identityOperationsAlerts: alerts, identityOperationsEscalations: escalations },
    job: updated,
    deadLetter,
    emittedAlerts,
    emittedEscalations
  };
}

/**
 * Close a durable worker run only after every claim has a recorded disposition.
 * A reclaimed claim or any retry/DLQ makes the old run fail closed.
 */
export function finalizeIdentityOperationsWorkerRun(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const runId = text(input.runId, "runId");
  const key = runKey(tenantId, runId);
  const run = state.identityOperationsWorkerRuns?.[key];
  if (!run || run.tenantId !== tenantId) fail("identity_worker_run_not_found", "Same-tenant worker run is required.");
  if (run.status !== "running") fail("identity_worker_run_not_running", "Only a running worker run may be finalized.");
  if (run.workerId !== input.workerId || run.workloadIdentityRef !== input.workloadIdentityRef) fail("identity_worker_run_owner_invalid", "Run owner and workload identity must match.");
  text(input.runEvidenceRef, "runEvidenceRef");
  sha256(input.runEvidenceChecksumSha256, "runEvidenceChecksumSha256");
  const jobs = run.claimedJobIds.map((jobId) => sameTenantJob(state, tenantId, jobId));
  const unresolved = jobs.filter((job) => job.status === "leased" && job.lease?.runId === runId);
  if (unresolved.length) fail("identity_worker_run_incomplete", "Every claimed job requires a durable outcome before run finalization.");
  const displaced = jobs.filter((job) => job.fenceGeneration !== run.claimedFenceGenerations[job.jobId]);
  const summary = {
    completed: jobs.filter((job) => job.status === "completed").length,
    retryWait: jobs.filter((job) => job.status === "retry_wait").length,
    deadLetter: jobs.filter((job) => job.status === "dead_letter").length,
    displaced: displaced.length
  };
  const finalCore = {
    ...run,
    status: summary.retryWait || summary.deadLetter || summary.displaced ? "failed_closed" : "completed",
    summary,
    runEvidenceRef: input.runEvidenceRef,
    runEvidenceChecksumSha256: input.runEvidenceChecksumSha256,
    completedAt: now.toISOString()
  };
  const finalized = Object.freeze({ ...finalCore, runChecksumSha256: hash(without(finalCore, "runChecksumSha256")) });
  return { state: { ...state, identityOperationsWorkerRuns: { ...state.identityOperationsWorkerRuns, [key]: finalized } }, run: finalized };
}

/** Create a new immutable job from a DLQ entry under independent replay authority. */
export function replayIdentityOperationsDeadLetter(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const deadLetterId = text(input.deadLetterId, "deadLetterId");
  const requestedBy = text(input.requestedBy, "requestedBy");
  const authorizedBy = text(input.authorizedBy, "authorizedBy");
  if (requestedBy === authorizedBy) fail("identity_worker_replay_four_eyes", "Dead-letter replay requires independent authorization.");
  const authorizationRef = text(input.authorizationRef, "authorizationRef");
  const reason = text(input.reason, "reason");
  const replayId = text(input.replayId, "replayId");
  const replayIdempotencyKey = text(input.replayIdempotencyKey, "replayIdempotencyKey");
  const newJobId = text(input.newJobId, "newJobId");
  const requestedScheduleAt = instant(input.scheduledAt ?? now, "scheduledAt").toISOString();
  const replayRequestChecksumSha256 = hash({ tenantId, deadLetterId, replayId, replayIdempotencyKey, newJobId, requestedBy, authorizedBy, authorizationRef, reason, requestedScheduleAt });
  const existing = Object.values(state.identityOperationsJobReplays ?? {}).find((candidate) => candidate.tenantId === tenantId && (candidate.replayId === replayId || candidate.replayIdempotencyKey === replayIdempotencyKey));
  if (existing) {
    if (existing.replayRequestChecksumSha256 !== replayRequestChecksumSha256) fail("identity_worker_replay_idempotency_conflict", "Replay identity was reused with different authorization or content.");
    return { state, replay: existing, job: sameTenantJob(state, tenantId, existing.newJobId), idempotent: true };
  }
  const deadLetterKeyValue = deadLetterKey(tenantId, deadLetterId);
  const deadLetter = state.identityOperationsDeadLetters?.[deadLetterKeyValue];
  if (!deadLetter || deadLetter.tenantId !== tenantId || deadLetter.status !== "open") fail("identity_worker_dead_letter_not_open", "An open same-tenant dead letter is required.");
  const source = sameTenantJob(state, tenantId, deadLetter.jobId);
  const scheduled = scheduleIdentityOperationsJob(state, {
    tenantId,
    jobId: newJobId,
    type: source.type,
    workloadIdentityRef: source.workloadIdentityRef,
    purpose: source.purpose,
    idempotencyKey: replayIdempotencyKey,
    payload: source.payload,
    scheduledAt: requestedScheduleAt,
    maxAttempts: source.maxAttempts,
    baseBackoffMs: source.baseBackoffMs,
    maximumBackoffMs: source.maximumBackoffMs,
    parentDeadLetterId: deadLetterId
  }, now);
  const replayCore = { replayId, tenantId, deadLetterId, sourceJobId: deadLetter.jobId, newJobId: scheduled.job.jobId, replayIdempotencyKey, requestedBy, authorizedBy, authorizationRef, reason, requestedScheduleAt, replayRequestChecksumSha256, authorizedAt: now.toISOString() };
  const replay = Object.freeze({ ...replayCore, replayChecksumSha256: hash(replayCore) });
  const updatedDeadLetterCore = { ...deadLetter, status: "replayed", replayJobId: scheduled.job.jobId, replayId, replayedAt: now.toISOString() };
  const updatedDeadLetter = Object.freeze({ ...updatedDeadLetterCore, deadLetterChecksumSha256: hash(without(updatedDeadLetterCore, "deadLetterChecksumSha256")) });
  return {
    state: {
      ...scheduled.state,
      identityOperationsDeadLetters: { ...scheduled.state.identityOperationsDeadLetters, [deadLetterKeyValue]: updatedDeadLetter },
      identityOperationsJobReplays: { ...(scheduled.state.identityOperationsJobReplays ?? {}), [replayKey(tenantId, replayId)]: replay }
    },
    replay,
    job: scheduled.job,
    idempotent: false
  };
}

function currentRunJobs(state, run) {
  return run.claimedJobIds.map((jobId) => state.identityOperationsJobs?.[jobKey(run.tenantId, jobId)]).filter(Boolean);
}
function isDueOrLeaseExpired(job, now) {
  if (CLAIMABLE.has(job.status)) return Date.parse(dueAt(job)) <= now.getTime();
  return job.status === "leased" && Date.parse(job.lease?.leaseUntil) <= now.getTime();
}
function dueAt(job) { return job.status === "retry_wait" ? job.nextAttemptAt : job.scheduledAt; }
function retryDelay(job) { return Math.min(job.maximumBackoffMs, job.baseBackoffMs * (2 ** Math.max(0, job.attempt - 1))); }
function makeDeadLetter(job, now) {
  const core = { deadLetterId: `${job.tenantId}:${job.jobId}:attempt:${job.attempt}`, tenantId: job.tenantId, jobId: job.jobId, jobType: job.type, workloadIdentityRef: job.workloadIdentityRef, failedAttempt: job.attempt, jobEnvelopeChecksumSha256: job.envelopeChecksumSha256, lastError: job.lastError, status: "open", replayJobId: null, deadLetteredAt: now.toISOString() };
  return Object.freeze({ ...core, deadLetterChecksumSha256: hash(core) });
}
function createAlertAndEscalation(job, code, severity, message, now, options = {}) {
  const outputId = `${job.tenantId}:${job.jobId}:attempt:${job.attempt}:${code}`;
  const alertCore = { alertId: `alert:${outputId}`, tenantId: job.tenantId, jobId: job.jobId, jobType: job.type, severity, code, message, workloadIdentityRef: job.workloadIdentityRef, status: "open", createdAt: now.toISOString() };
  const alert = Object.freeze({ ...alertCore, checksumSha256: hash(alertCore) });
  const escalationCore = options.escalation ? { escalationId: `escalation:${outputId}`, tenantId: job.tenantId, jobId: job.jobId, jobType: job.type, severity: "critical", code, alertId: alert.alertId, requiredAction: "An authorized operator must investigate and independently authorize any dead-letter replay.", status: "open", createdAt: now.toISOString() } : null;
  return { alert, escalation: escalationCore ? Object.freeze({ ...escalationCore, checksumSha256: hash(escalationCore) }) : null };
}
function addOutput(registry, emitted, output) { if (!output || registry[output.alertId ?? output.escalationId]) return; registry[output.alertId ?? output.escalationId] = output; emitted.push(output); }
function sameTenantJob(state, tenantId, jobId) { const job = state.identityOperationsJobs?.[jobKey(tenantId, jobId)]; if (!job || job.tenantId !== tenantId) fail("identity_worker_job_not_found", "Same-tenant identity operations job is required."); return job; }
function jobKey(tenantId, jobId) { return `${tenantId}:${jobId}`; }
function runKey(tenantId, runId) { return `${tenantId}:${runId}`; }
function deadLetterKey(tenantId, deadLetterId) { return `${tenantId}:${deadLetterId}`; }
function replayKey(tenantId, replayId) { return `${tenantId}:${replayId}`; }
function workloadRef(value) { const result = text(value, "workloadIdentityRef"); if (!/^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i.test(result)) fail("identity_worker_workload_identity_invalid", "A named workload identity reference URI is required."); return result; }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("identity_worker_input_invalid", `${field} is required.`); return value.trim(); }
function integer(value, min, max, field) { if (!Number.isInteger(value) || value < min || value > max) fail("identity_worker_input_invalid", `${field} is outside its allowed range.`); return value; }
function instant(value, field) { const result = value instanceof Date ? new Date(value) : new Date(value); if (!Number.isFinite(result.getTime())) fail("identity_worker_input_invalid", `${field} must be a valid date-time.`); return result; }
function sha256(value, field) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) fail("identity_worker_input_invalid", `${field} must be a SHA-256 digest.`); return value; }
function hash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function clone(value) { try { const copy = structuredClone(value); canonical(copy); return copy; } catch { fail("identity_worker_input_invalid", "payload must be a plain JSON value."); } }
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  throw new Error("not_json");
}
function without(value, field) { const result = { ...value }; delete result[field]; return result; }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
