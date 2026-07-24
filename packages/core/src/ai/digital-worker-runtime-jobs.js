import { completeAiAgentExecution, normalizeAiAgentPlatformState, recordAiAgentUsage } from "./ai-agent-platform.js";
import { contentHash, isSha256Hex } from "./record-seal.js";

// ADR 0010 durable execution state. The enclosing PostgreSQL request lock/RLS
// transaction supplies atomic persistence; revision, idempotency and fencing
// make every state transition explicit and portable to a dedicated worker.
export function enqueueDigitalWorkerRuntimeJob(state, input = {}, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input.tenantId, "tenantId"); required(input.jobId, "jobId"); required(input.executionId, "executionId"); required(input.idempotencyKey, "idempotencyKey"); digest(input.payloadChecksumSha256, "payloadChecksumSha256");
  const payload = structuredClone(input.payload ?? {});
  if (contentHash(payload) !== input.payloadChecksumSha256.toLowerCase()) fail("digital_worker_job_checksum_mismatch", "Runtime job payload checksum does not match its content.");
  const execution = owned(platform.executions[input.executionId], input.tenantId, "digital_worker_job_execution_missing");
  if (execution.status !== "authorized") fail("digital_worker_job_execution_not_authorized", "Only an authorized execution may be queued.", 409);
  const duplicate = Object.values(platform.runtimeJobs).find((job) => job.tenantId === input.tenantId && job.idempotencyKey === input.idempotencyKey);
  if (duplicate) {
    if (duplicate.payloadChecksumSha256 !== input.payloadChecksumSha256.toLowerCase() || duplicate.executionId !== input.executionId) fail("digital_worker_job_idempotency_conflict", "Runtime job idempotency key has different content.", 409);
    return { state: platform, job: duplicate, idempotent: true };
  }
  if (platform.runtimeJobs[input.jobId]) fail("digital_worker_job_duplicate", "Runtime job ID already exists.", 409);
  const job = Object.freeze({ tenantId: input.tenantId, jobId: input.jobId, executionId: input.executionId, installationId: execution.installationId, idempotencyKey: input.idempotencyKey, payload, payloadChecksumSha256: input.payloadChecksumSha256.toLowerCase(), status: "queued", attemptCount: 0, maxAttempts: bounded(input.maxAttempts ?? 3, 1, 10, "maxAttempts"), availableAt: iso(input.availableAt ?? now.toISOString(), "availableAt"), lease: null, lastError: null, resultEvidenceRef: null, replayHistory: [], createdAt: now.toISOString(), updatedAt: now.toISOString() });
  return { state: replace(platform, job), job, idempotent: false };
}

export function claimDigitalWorkerRuntimeJob(state, input = {}, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state); required(input.tenantId, "tenantId"); required(input.workerId, "workerId"); const leaseMs = bounded(input.leaseMs ?? 30_000, 1_000, 300_000, "leaseMs");
  const eligible = Object.values(platform.runtimeJobs).filter((job) => job.tenantId === input.tenantId && ["queued", "retry_wait"].includes(job.status) && Date.parse(job.availableAt) <= now.getTime() && (!job.lease || Date.parse(job.lease.expiresAt) <= now.getTime())).sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt) || a.jobId.localeCompare(b.jobId));
  const source = eligible[0]; if (!source) return { state: platform, job: null };
  const job = Object.freeze({ ...source, status: "leased", attemptCount: source.attemptCount + 1, lease: { workerId: input.workerId, fence: (source.lease?.fence ?? 0) + 1, acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + leaseMs).toISOString() }, updatedAt: now.toISOString() });
  return { state: replace(platform, job), job };
}

export function completeDigitalWorkerRuntimeJob(state, input = {}, now = new Date()) {
  let platform = normalizeAiAgentPlatformState(state); required(input.tenantId, "tenantId"); required(input.jobId, "jobId");
  const prior = owned(platform.runtimeJobs[input.jobId], input.tenantId, "digital_worker_job_missing");
  const completion = completionShape(input);
  if (prior.status === "completed") {
    if (prior.completionChecksumSha256 !== contentHash(completion)) fail("digital_worker_job_completion_conflict", "Completed runtime job cannot be overwritten.", 409);
    return { state: platform, job: prior, idempotent: true };
  }
  leased(prior, input, now);
  required(input.outputRef, "outputRef"); digest(input.outputHash, "outputHash"); required(input.providerEvidenceRef, "providerEvidenceRef");
  const completedExecution = completeAiAgentExecution(platform, { executionId: prior.executionId, tenantId: input.tenantId, outputRef: input.outputRef, outputHash: input.outputHash, outcome: input.outcome ?? "proposal_created", citations: input.citations ?? [] }, now);
  const metered = recordAiAgentUsage(completedExecution.state, { usageId: `runtime-usage:${prior.executionId}`, executionId: prior.executionId, tenantId: input.tenantId, inputTokens: input.usage?.inputTokens ?? "0", outputTokens: input.usage?.outputTokens ?? "0", toolCalls: input.usage?.toolCalls ?? "0" }, now);
  const job = Object.freeze({ ...prior, status: "completed", lease: null, resultEvidenceRef: input.providerEvidenceRef, outputRef: input.outputRef, outputHash: input.outputHash.toLowerCase(), usageId: metered.record.usageId, completionChecksumSha256: contentHash(completion), completedAt: now.toISOString(), updatedAt: now.toISOString(), lastError: null });
  return { state: replace(metered.state, job), job, execution: metered.state.executions[prior.executionId], usage: metered.record, idempotent: false };
}

export function failDigitalWorkerRuntimeJob(state, input = {}, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state); const source = owned(platform.runtimeJobs[input.jobId], input.tenantId, "digital_worker_job_missing"); leased(source, input, now); required(input.errorCode, "errorCode"); required(input.errorEvidenceRef, "errorEvidenceRef");
  const exhausted = source.attemptCount >= source.maxAttempts; const retryDelayMs = bounded(input.retryDelayMs ?? 1_000, 0, 86_400_000, "retryDelayMs");
  const job = Object.freeze({ ...source, status: exhausted ? "dead_letter" : "retry_wait", lease: null, availableAt: exhausted ? source.availableAt : new Date(now.getTime() + retryDelayMs).toISOString(), lastError: { code: input.errorCode, evidenceRef: input.errorEvidenceRef, failedAt: now.toISOString() }, deadLetteredAt: exhausted ? now.toISOString() : null, updatedAt: now.toISOString() });
  return { state: replace(platform, job), job };
}

export function replayDigitalWorkerDeadLetter(state, input = {}, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state); const source = owned(platform.runtimeJobs[input.jobId], input.tenantId, "digital_worker_job_missing"); required(input.proposedBy, "proposedBy"); required(input.approvedBy, "approvedBy"); required(input.approvalRef, "approvalRef"); required(input.reason, "reason");
  if (input.proposedBy === input.approvedBy) fail("digital_worker_job_replay_four_eyes_required", "Runtime dead-letter replay requires an independent approver.", 403);
  if (source.status !== "dead_letter") fail("digital_worker_job_replay_invalid", "Only a dead-letter runtime job can be replayed.", 409);
  const replay = { proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, reason: input.reason, replayedAt: now.toISOString(), priorAttemptCount: source.attemptCount };
  const job = Object.freeze({ ...source, status: "queued", attemptCount: 0, lease: null, availableAt: now.toISOString(), lastError: null, deadLetteredAt: null, replayHistory: [...source.replayHistory, replay], updatedAt: now.toISOString() });
  return { state: replace(platform, job), job };
}

export function digitalWorkerRuntimeHealth(state, tenantId, now = new Date()) {
  const jobs = Object.values(normalizeAiAgentPlatformState(state).runtimeJobs).filter((job) => job.tenantId === tenantId);
  const counts = Object.fromEntries(["queued", "leased", "retry_wait", "dead_letter", "completed"].map((status) => [status, jobs.filter((job) => job.status === status).length]));
  const expiredLeases = jobs.filter((job) => job.status === "leased" && Date.parse(job.lease?.expiresAt) <= now.getTime()).length;
  return { tenantId, counts, expiredLeases, status: counts.dead_letter || expiredLeases ? "degraded" : "healthy", assessedAt: now.toISOString() };
}

export function digitalWorkerRuntimePayloadChecksum(payload) { return contentHash(payload ?? {}); }
function completionShape(input) { return { outputRef: input.outputRef, outputHash: input.outputHash?.toLowerCase(), providerEvidenceRef: input.providerEvidenceRef, outcome: input.outcome ?? "proposal_created", citations: [...new Set(input.citations ?? [])].sort(), usage: { inputTokens: String(input.usage?.inputTokens ?? "0"), outputTokens: String(input.usage?.outputTokens ?? "0"), toolCalls: String(input.usage?.toolCalls ?? "0") } }; }
function replace(state, job) { return { ...state, revision: state.revision + 1, runtimeJobs: { ...state.runtimeJobs, [job.jobId]: job } }; }
function leased(job, input, now) { required(input.workerId, "workerId"); if (!Number.isInteger(input.fence) || input.fence <= 0) fail("digital_worker_job_lease_fenced", "A current fencing token is required.", 409); if (job.status !== "leased" || job.lease?.workerId !== input.workerId || job.lease.fence !== input.fence) fail("digital_worker_job_lease_fenced", "Runtime job lease ownership or fencing token is stale.", 409); if (Date.parse(job.lease.expiresAt) <= now.getTime()) fail("digital_worker_job_lease_expired", "Runtime job lease expired before mutation.", 409); }
function owned(record, tenantId, code) { if (!record || record.tenantId !== tenantId) fail(code, "Tenant-local runtime record was not found.", 404); return record; }
function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("digital_worker_job_invalid", `${field} is required.`); }
function digest(value, field) { if (!isSha256Hex(value ?? "")) fail("digital_worker_job_invalid", `${field} must be SHA-256 hex.`); }
function iso(value, field) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("digital_worker_job_invalid", `${field} must be ISO date-time.`); return new Date(value).toISOString(); }
function bounded(value, min, max, field) { if (!Number.isInteger(value) || value < min || value > max) fail("digital_worker_job_invalid", `${field} must be between ${min} and ${max}.`); return value; }
function fail(code, message, status = 422) { throw Object.assign(new Error(message), { code, status }); }
