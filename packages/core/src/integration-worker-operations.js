import { createHash } from "node:crypto";

const JOB_TYPES = new Set(["callback_dispatch", "signed_file_poll"]);

export function createIntegrationJob(state = emptyIntegrationWorkerState(), input = {}, now = new Date()) {
  tenant(input); required(input.jobId, "jobId"); if (!JOB_TYPES.has(input.type)) invalid("type is invalid."); required(input.idempotencyKey, "idempotencyKey"); required(input.payloadChecksumSha256, "payloadChecksumSha256"); digest(input.payloadChecksumSha256);
  if (hash(input.payload ?? {}) !== input.payloadChecksumSha256.toLowerCase()) fail("integration_job_checksum_mismatch", "Payload checksum does not match persisted payload.");
  const jobs = state.jobs ?? {}; const duplicate = Object.values(jobs).find((job) => job.tenantId === input.tenantId && job.idempotencyKey === input.idempotencyKey);
  if (duplicate) { if (duplicate.payloadChecksumSha256 !== input.payloadChecksumSha256) fail("integration_job_idempotency_conflict", "Idempotency key already has different payload."); return { state, job: duplicate, idempotent: true }; }
  if (jobs[input.jobId]) fail("integration_job_duplicate", "jobId already exists."); const maxAttempts = bounded(input.maxAttempts ?? 3, 1, 10, "maxAttempts"); const availableAt = iso(input.availableAt ?? now.toISOString(), "availableAt");
  const job = { tenantId: input.tenantId, jobId: input.jobId, type: input.type, idempotencyKey: input.idempotencyKey, payload: structuredClone(input.payload ?? {}), payloadChecksumSha256: input.payloadChecksumSha256.toLowerCase(), status: "queued", attemptCount: 0, maxAttempts, availableAt, lease: null, lastError: null, resultEvidenceRef: null, replayHistory: [], createdAt: now.toISOString(), updatedAt: now.toISOString() };
  return { state: next(state, { ...jobs, [job.jobId]: job }), job, idempotent: false };
}

export function acquireIntegrationJobLease(state, input = {}, now = new Date()) {
  tenant(input); required(input.workerId, "workerId"); const leaseMs = bounded(input.leaseMs ?? 30000, 1000, 300000, "leaseMs");
  const eligible = Object.values(state.jobs ?? {}).filter((job) => job.tenantId === input.tenantId && ["queued", "retry_wait"].includes(job.status) && Date.parse(job.availableAt) <= now.getTime() && (!job.lease || Date.parse(job.lease.expiresAt) <= now.getTime())).sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt) || a.jobId.localeCompare(b.jobId));
  const job = eligible[0]; if (!job) return { state, job: null };
  const fence = (job.lease?.fence ?? 0) + 1; const leased = { ...job, status: "leased", attemptCount: job.attemptCount + 1, lease: { workerId: input.workerId, fence, acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + leaseMs).toISOString() }, updatedAt: now.toISOString() };
  return { state: replace(state, leased), job: leased };
}

export function heartbeatIntegrationJobLease(state, input = {}, now = new Date()) { const job = leased(state, input, now); const leaseMs = bounded(input.leaseMs ?? 30000, 1000, 300000, "leaseMs"); const updated = { ...job, lease: { ...job.lease, expiresAt: new Date(now.getTime() + leaseMs).toISOString() }, updatedAt: now.toISOString() }; return { state: replace(state, updated), job: updated }; }
export function completeIntegrationJob(state, input = {}, now = new Date()) { const job = leased(state, input, now); required(input.resultEvidenceRef, "resultEvidenceRef"); const completed = { ...job, status: "completed", lease: null, resultEvidenceRef: input.resultEvidenceRef, completedAt: now.toISOString(), updatedAt: now.toISOString() }; return { state: replace(state, completed), job: completed }; }
export function failIntegrationJob(state, input = {}, now = new Date()) { const job = leased(state, input, now); required(input.errorCode, "errorCode"); required(input.errorEvidenceRef, "errorEvidenceRef"); const exhausted = job.attemptCount >= job.maxAttempts; const retryDelayMs = bounded(input.retryDelayMs ?? 1000, 0, 86400000, "retryDelayMs"); const failed = { ...job, status: exhausted ? "dead_letter" : "retry_wait", lease: null, availableAt: exhausted ? job.availableAt : new Date(now.getTime() + retryDelayMs).toISOString(), lastError: { code: input.errorCode, evidenceRef: input.errorEvidenceRef, failedAt: now.toISOString() }, deadLetteredAt: exhausted ? now.toISOString() : null, updatedAt: now.toISOString() }; return { state: replace(state, failed), job: failed }; }

export function replayDeadLetterJob(state, input = {}, now = new Date()) {
  tenant(input); required(input.jobId, "jobId"); required(input.proposedBy, "proposedBy"); required(input.approvedBy, "approvedBy"); required(input.approvalRef, "approvalRef"); required(input.reason, "reason"); if (input.proposedBy === input.approvedBy) fail("integration_replay_four_eyes_required", "DLQ replay requires independent approval.");
  const job = state.jobs?.[input.jobId]; if (!job || job.tenantId !== input.tenantId) fail("integration_job_not_found", "Tenant-local job was not found."); if (job.status !== "dead_letter") fail("integration_replay_invalid", "Only dead-letter jobs can be replayed.");
  const replay = { proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, reason: input.reason, replayedAt: now.toISOString(), priorAttemptCount: job.attemptCount };
  const updated = { ...job, status: "queued", attemptCount: 0, lease: null, availableAt: now.toISOString(), lastError: null, deadLetteredAt: null, replayHistory: [...job.replayHistory, replay], updatedAt: now.toISOString() }; return { state: replace(state, updated), job: updated };
}

export function integrationWorkerHealth(state, input = {}, now = new Date()) { tenant(input); const jobs = Object.values(state.jobs ?? {}).filter((job) => job.tenantId === input.tenantId); const counts = Object.fromEntries(["queued", "leased", "retry_wait", "dead_letter", "completed"].map((status) => [status, jobs.filter((job) => job.status === status).length])); const expiredLeases = jobs.filter((job) => job.status === "leased" && Date.parse(job.lease?.expiresAt) <= now.getTime()).length; const overdue = jobs.filter((job) => ["queued", "retry_wait"].includes(job.status) && Date.parse(job.availableAt) < now.getTime()).length; return { tenantId: input.tenantId, revision: state.revision ?? 0, counts, expiredLeases, overdue, status: counts.dead_letter || expiredLeases ? "degraded" : "healthy", assessedAt: now.toISOString() }; }

export async function runIntegrationWorkerOnce({ tenantId, workerId, store, handlers, now = new Date(), leaseMs = 30000, maxJobs = 10 } = {}) {
  tenant({ tenantId }); required(workerId, "workerId"); if (!store || typeof store.load !== "function" || typeof store.save !== "function") invalid("store must implement load and save."); if (!handlers || typeof handlers.callback_dispatch !== "function" || typeof handlers.signed_file_poll !== "function") invalid("Both production handlers are required."); bounded(maxJobs, 1, 100, "maxJobs"); const processed = [];
  for (let index = 0; index < maxJobs; index += 1) {
    let state = await store.load(tenantId); assertStateTenantSafe(state, tenantId); const leasedResult = acquireIntegrationJobLease(state, { tenantId, workerId, leaseMs }, now); if (!leasedResult.job) break; await store.save(leasedResult.state, { expectedRevision: state.revision }); state = leasedResult.state; const job = leasedResult.job;
    try { const result = await handlers[job.type]({ tenantId, jobId: job.jobId, payload: structuredClone(job.payload), payloadChecksumSha256: job.payloadChecksumSha256, idempotencyKey: job.idempotencyKey, fence: job.lease.fence }); if (!result?.evidenceRef) fail("integration_handler_evidence_missing", "Handler success requires evidenceRef."); const completed = completeIntegrationJob(state, { tenantId, jobId: job.jobId, workerId, fence: job.lease.fence, resultEvidenceRef: result.evidenceRef }, now); await store.save(completed.state, { expectedRevision: state.revision }); processed.push(completed.job); }
    catch (error) { const failed = failIntegrationJob(state, { tenantId, jobId: job.jobId, workerId, fence: job.lease.fence, errorCode: error.code ?? "handler_failed", errorEvidenceRef: error.evidenceRef ?? `worker-error:${job.jobId}:${job.attemptCount}`, retryDelayMs: error.retryDelayMs ?? 1000 }, now); await store.save(failed.state, { expectedRevision: state.revision }); processed.push(failed.job); }
  }
  return { tenantId, workerId, processed, processedCount: processed.length };
}

export function emptyIntegrationWorkerState() { return { revision: 0, jobs: {} }; }
export function integrationPayloadChecksum(payload) { return hash(payload ?? {}); }
function next(state, jobs) { return { ...state, revision: (state.revision ?? 0) + 1, jobs }; }
function replace(state, job) { return next(state, { ...(state.jobs ?? {}), [job.jobId]: job }); }
function leased(state, input, now) { tenant(input); required(input.jobId, "jobId"); required(input.workerId, "workerId"); if (!Number.isInteger(input.fence) || input.fence <= 0) invalid("fence is required."); const job = state.jobs?.[input.jobId]; if (!job || job.tenantId !== input.tenantId) fail("integration_job_not_found", "Tenant-local job was not found."); if (job.status !== "leased" || job.lease?.workerId !== input.workerId || job.lease.fence !== input.fence) fail("integration_lease_fenced", "Lease ownership or fencing token is stale."); if (Date.parse(job.lease.expiresAt) <= now.getTime()) fail("integration_lease_expired", "Lease expired before mutation."); return job; }
function assertStateTenantSafe(state, tenantId) { if (!state || !Number.isInteger(state.revision) || !state.jobs || Object.values(state.jobs).some((job) => job.tenantId !== tenantId)) fail("integration_store_tenant_mismatch", "Worker store returned cross-tenant or invalid state."); }
function tenant(input) { required(input.tenantId, "tenantId"); }
function required(value, field) { if (typeof value !== "string" || !value.trim()) invalid(`${field} is required.`); }
function digest(value) { if (!/^[a-fA-F0-9]{64}$/.test(value)) invalid("SHA-256 checksum is invalid."); }
function iso(value, field) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(`${field} must be ISO date-time.`); return new Date(value).toISOString(); }
function bounded(value, min, max, field) { if (!Number.isInteger(value) || value < min || value > max) invalid(`${field} must be between ${min} and ${max}.`); return value; }
function hash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function canonical(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; }
function invalid(message) { fail("integration_worker_invalid", message); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
export { JOB_TYPES };
