import { randomUUID } from "node:crypto";

const JOB_TYPES = new Set(["provider_callback_dispatch", "signed_file_poll", "signed_file_process"]);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const nowIso = (now) => now.toISOString();

export class IntegrationWorkerRuntime {
  #stopping = false;
  #activeRuns = new Set();
  #runWaiters = new Map();

  constructor(options = {}) {
    if (!options.store?.loadJobs || !options.store?.saveJob) fail("worker_store_invalid", "Injected store must implement loadJobs and saveJob.");
    if (!options.leaseStore?.acquire || !options.leaseStore?.release) fail("worker_lease_store_invalid", "Injected lease store must implement acquire and release.");
    this.store = options.store; this.leaseStore = options.leaseStore; this.handlers = options.handlers ?? {}; this.ownerId = options.ownerId ?? `worker-${randomUUID()}`;
    this.maxJobsPerRun = integer(options.maxJobsPerRun ?? 25, 1, 1000, "maxJobsPerRun"); this.leaseTtlMs = integer(options.leaseTtlMs ?? 30000, 1000, 3600000, "leaseTtlMs"); this.jobTimeoutMs = integer(options.jobTimeoutMs ?? 10000, 10, 3600000, "jobTimeoutMs");
    this.metrics = { runs: 0, leaseContentions: 0, jobsClaimed: 0, jobsSucceeded: 0, jobsFailed: 0, jobsTimedOut: 0, lastRunStartedAt: null, lastRunCompletedAt: null, lastSuccessAt: null, lastFailureAt: null, consecutiveRunFailures: 0 };
  }

  async runOnce(input = {}) {
    const now = input.now ?? new Date(); if (this.#stopping) return { status: "stopping", processed: 0, results: [] };
    const runId = input.runId ?? randomUUID(); const leaseName = input.leaseName ?? "integration-worker"; const lease = await this.leaseStore.acquire({ leaseName, ownerId: this.ownerId, runId, ttlMs: this.leaseTtlMs, now: nowIso(now) });
    if (!lease?.acquired || !lease.fencingToken) { this.metrics.leaseContentions += 1; return { status: "lease_unavailable", processed: 0, results: [] }; }
    let resolveRun; const runWaiter = new Promise((resolve) => { resolveRun = resolve; }); this.#runWaiters.set(runId, runWaiter);
    this.#activeRuns.add(runId); this.metrics.runs += 1; this.metrics.lastRunStartedAt = nowIso(now); const results = [];
    try {
      const jobs = await this.store.loadJobs({ dueAtOrBefore: nowIso(now), statuses: ["pending", "retry"], limit: this.maxJobsPerRun, fencingToken: lease.fencingToken });
      if (!Array.isArray(jobs)) fail("worker_store_invalid", "loadJobs must return an array.");
      for (const source of jobs.slice(0, this.maxJobsPerRun)) {
        if (this.#stopping) break;
        const result = await this.#execute(source, lease, now); results.push(result);
      }
      this.metrics.lastRunCompletedAt = new Date().toISOString(); this.metrics.consecutiveRunFailures = 0;
      return { status: this.#stopping ? "stopping" : "completed", runId, fencingToken: lease.fencingToken, processed: results.length, results };
    } catch (error) {
      this.metrics.lastFailureAt = new Date().toISOString(); this.metrics.consecutiveRunFailures += 1;
      return { status: "failed_closed", runId, processed: results.length, results, error: sanitize(error) };
    } finally {
      this.#activeRuns.delete(runId);
      await this.leaseStore.release({ leaseName, ownerId: this.ownerId, runId, fencingToken: lease.fencingToken }).catch(() => undefined);
      resolveRun(); this.#runWaiters.delete(runId);
    }
  }

  async #execute(source, lease, now) {
    const job = structuredClone(source); const errors = [];
    if (!job.jobId || !JOB_TYPES.has(job.type) || !job.tenantId || !Number.isInteger(job.attempt) || job.attempt < 0) errors.push("invalid_job_envelope");
    const handler = this.handlers[job.type]; if (typeof handler !== "function") errors.push("handler_unavailable");
    if (errors.length) return this.#persistFailure(job, lease, now, { code: "worker_job_invalid", message: errors.join(",") });
    this.metrics.jobsClaimed += 1;
    const running = { ...job, status: "running", attempt: job.attempt + 1, claimedBy: this.ownerId, fencingToken: lease.fencingToken, startedAt: nowIso(now), updatedAt: nowIso(now) };
    try { await this.store.saveJob(running, { expectedStatus: job.status, fencingToken: lease.fencingToken }); } catch (error) { return { jobId: job.jobId, status: "claim_conflict", error: sanitize(error) }; }
    try {
      const value = await timeout(handler({ job: running, payload: structuredClone(job.payload), tenantId: job.tenantId, fencingToken: lease.fencingToken, signal: this.signal }), this.jobTimeoutMs);
      if (!value || value.accepted !== true || !value.evidenceRef) fail("worker_handler_unverified", "Handler must return accepted=true and evidenceRef.");
      const completed = { ...running, status: "completed", outcome: value.outcome ?? "accepted", evidenceRef: value.evidenceRef, result: value.result ?? null, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastError: null };
      await this.store.saveJob(completed, { expectedStatus: "running", fencingToken: lease.fencingToken }); this.metrics.jobsSucceeded += 1; this.metrics.lastSuccessAt = completed.completedAt;
      return { jobId: job.jobId, status: "completed", outcome: completed.outcome };
    } catch (error) { if (error.code === "worker_job_timeout") this.metrics.jobsTimedOut += 1; return this.#persistFailure(running, lease, new Date(), error); }
  }

  async #persistFailure(job, lease, now, error) {
    const retryable = job.attempt < (job.maxAttempts ?? 3); const failed = { ...job, status: retryable ? "retry" : "dead_letter", lastError: sanitize(error), nextAttemptAt: retryable ? new Date(now.getTime() + Math.min(3600000, 1000 * (2 ** Math.max(0, job.attempt)))).toISOString() : null, updatedAt: nowIso(now) };
    try { await this.store.saveJob(failed, { expectedStatus: job.status, fencingToken: lease.fencingToken }); } catch (persistError) { return { jobId: job.jobId ?? null, status: "failure_persistence_failed", error: sanitize(persistError), originalError: sanitize(error) }; }
    this.metrics.jobsFailed += 1; this.metrics.lastFailureAt = nowIso(now); return { jobId: job.jobId ?? null, status: failed.status, error: failed.lastError };
  }

  get signal() { if (!this.abortController) this.abortController = new AbortController(); return this.abortController.signal; }
  health(now = new Date()) { const active = this.#activeRuns.size; const degraded = this.metrics.consecutiveRunFailures > 0 || this.metrics.jobsFailed > this.metrics.jobsSucceeded; return { status: this.#stopping ? "stopping" : degraded ? "degraded" : "healthy", ownerId: this.ownerId, acceptingRuns: !this.#stopping, activeRuns: active, boundedMaxJobsPerRun: this.maxJobsPerRun, metrics: { ...this.metrics }, observedAt: nowIso(now) }; }
  async shutdown() { this.#stopping = true; this.abortController?.abort(); await Promise.all([...this.#runWaiters.values()]); return this.health(); }
}

export function createIntegrationWorkerHandlers(ports = {}) {
  return {
    provider_callback_dispatch: async (context) => verified(await requiredPort(ports.dispatchProviderCallback, "dispatchProviderCallback")(context)),
    signed_file_poll: async (context) => verified(await requiredPort(ports.pollSignedFile, "pollSignedFile")(context)),
    signed_file_process: async (context) => verified(await requiredPort(ports.processSignedFileAcknowledgement, "processSignedFileAcknowledgement")(context))
  };
}

function requiredPort(port, name) { if (typeof port !== "function") fail("worker_port_unavailable", `${name} port is unavailable.`); return port; }
function verified(value) { if (!value?.evidenceRef) fail("worker_port_evidence_missing", "Provider port response requires evidenceRef."); return { accepted: value.accepted === true, evidenceRef: value.evidenceRef, outcome: value.outcome, result: value.result }; }
function integer(value, min, max, name) { if (!Number.isInteger(value) || value < min || value > max) fail("worker_configuration_invalid", `${name} is invalid.`); return value; }
function sanitize(error) { return { code: error?.code ?? "worker_job_failed", message: String(error?.message ?? "Worker job failed.").slice(0, 500) }; }
function timeout(promise, milliseconds) { let id; return Promise.race([Promise.resolve(promise), new Promise((_, reject) => { id = setTimeout(() => reject(Object.assign(new Error("Worker job timed out."), { code: "worker_job_timeout" })), milliseconds); })]).finally(() => clearTimeout(id)); }
