import { createHash, randomUUID } from "node:crypto";

import { IDENTITY_OPERATION_JOB_TYPES } from "./identity-operations-worker.js";

const SECRET_FIELD = /(api[-_]?key|authorization|bearer|credential|password|private[-_]?key|refresh[-_]?token|secret)/i;
const JOB_TYPES = new Set(IDENTITY_OPERATION_JOB_TYPES);

/**
 * Executes the persistent identity-operations protocol through an injected
 * service-plane client. Claim, outcome and finalization are deliberately
 * separate durable calls: if a worker disappears between them, the existing
 * lease/fence transition layer reclaims or dead-letters the job fail closed.
 */
export class IdentityOperationsWorkerRuntime {
  #stopping = false;
  #activeRuns = new Set();
  #runWaiters = new Map();

  constructor(options = {}) {
    requireClient(options.client);
    this.client = options.client;
    this.handlers = options.handlers ?? {};
    this.workerId = text(options.workerId ?? `identity-worker-${randomUUID()}`, "workerId");
    this.executionMode = oneOf(options.executionMode ?? "simulated", ["simulated", "live"], "executionMode");
    this.maxJobsPerRun = integer(options.maxJobsPerRun ?? 25, 1, 100, "maxJobsPerRun");
    this.leaseMs = integer(options.leaseMs ?? 30_000, 1_000, 3_600_000, "leaseMs");
    this.jobTimeoutMs = integer(options.jobTimeoutMs ?? 10_000, 10, this.leaseMs - 1, "jobTimeoutMs");
    this.metrics = {
      runsStarted: 0,
      runsCompleted: 0,
      runsFailedClosed: 0,
      emptyRuns: 0,
      jobsClaimed: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      jobsTimedOut: 0,
      outcomePersistenceFailures: 0,
      finalizationFailures: 0,
      lastRunStartedAt: null,
      lastRunCompletedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveRunFailures: 0
    };
  }

  async runOnce(input = {}) {
    if (this.#stopping) return { status: "stopping", processed: 0, results: [] };
    const runId = text(input.runId ?? randomUUID(), "runId");
    const startedAt = normalizeDate(input.now ?? new Date(), "now");
    this.metrics.runsStarted += 1;
    this.metrics.lastRunStartedAt = startedAt.toISOString();
    this.#activeRuns.add(runId);
    let resolveRun;
    this.#runWaiters.set(runId, new Promise((resolve) => { resolveRun = resolve; }));
    const results = [];
    try {
      const claim = await this.client.claim({ runId, workerId: this.workerId, limit: this.maxJobsPerRun, leaseMs: this.leaseMs });
      const jobs = Array.isArray(claim?.claimed) ? claim.claimed : fail("identity_worker_claim_invalid", "Claim response must contain a claimed array.");
      if (!claim?.run || claim.run.runId !== runId) fail("identity_worker_claim_invalid", "Claim response must contain the requested run.");
      this.metrics.jobsClaimed += jobs.length;
      if (jobs.length === 0) {
        this.metrics.emptyRuns += 1;
        this.metrics.runsCompleted += 1;
        this.metrics.consecutiveRunFailures = 0;
        this.metrics.lastRunCompletedAt = new Date().toISOString();
        return { status: "completed_empty", runId, processed: 0, results: [], run: claim.run };
      }
      for (const job of jobs) {
        if (this.#stopping) fail("identity_worker_stopping", "Worker shutdown interrupted the claimed run.");
        const result = await this.#execute(job, runId);
        results.push(result);
      }
      const runEvidence = {
        schema: "loanos.identity-worker-run-evidence.v1",
        runId,
        workerId: this.workerId,
        executionMode: this.executionMode,
        jobOutcomes: results.map(({ jobId, status, evidenceChecksumSha256, resultChecksumSha256 = null }) => ({ jobId, status, evidenceChecksumSha256, resultChecksumSha256 }))
      };
      let finalized;
      try {
        finalized = await this.client.finalize(runId, {
          workerId: this.workerId,
          runEvidenceRef: `evidence://identity-operations/runs/${encodeURIComponent(runId)}`,
          runEvidenceChecksumSha256: hash(runEvidence)
        });
      } catch (error) {
        this.metrics.finalizationFailures += 1;
        throw error;
      }
      const finalStatus = finalized?.run?.status ?? "completed";
      if (finalStatus === "failed_closed") {
        this.metrics.runsFailedClosed += 1;
        this.metrics.consecutiveRunFailures += 1;
        this.metrics.lastFailureAt = new Date().toISOString();
      } else {
        this.metrics.runsCompleted += 1;
        this.metrics.consecutiveRunFailures = 0;
      }
      this.metrics.lastRunCompletedAt = new Date().toISOString();
      return { status: finalStatus, runId, processed: results.length, results, run: finalized?.run ?? null };
    } catch (error) {
      this.metrics.runsFailedClosed += 1;
      this.metrics.consecutiveRunFailures += 1;
      this.metrics.lastFailureAt = new Date().toISOString();
      return { status: "failed_closed", runId, processed: results.length, results, error: sanitize(error) };
    } finally {
      this.#activeRuns.delete(runId);
      resolveRun();
      this.#runWaiters.delete(runId);
    }
  }

  async #execute(job, runId) {
    validateClaimedJob(job, runId);
    const handler = this.handlers[job.type];
    if (typeof handler !== "function") return this.#recordFailure(job, runId, failValue("identity_worker_handler_unavailable", `No ${this.executionMode} handler is configured for ${job.type}.`, false));
    try {
      const response = await timeout(handler({
        job: structuredClone(job),
        payload: structuredClone(job.payload),
        tenantId: job.tenantId,
        workerId: this.workerId,
        executionMode: this.executionMode,
        fencingToken: job.lease.fencingToken,
        signal: this.signal
      }), this.jobTimeoutMs);
      if (response?.accepted !== true || !response.evidenceRef) fail("identity_worker_handler_unverified", "Handler must return accepted=true and an evidenceRef.");
      const evidence = {
        schema: "loanos.identity-worker-job-evidence.v1",
        tenantId: job.tenantId,
        jobId: job.jobId,
        jobType: job.type,
        runId,
        workerId: this.workerId,
        executionMode: this.executionMode,
        envelopeChecksumSha256: job.envelopeChecksumSha256,
        handlerEvidenceRef: response.evidenceRef,
        handlerEvidence: response.evidence ?? null
      };
      const result = response.result ?? { outcome: response.outcome ?? "accepted" };
      const evidenceChecksumSha256 = hash(evidence);
      const resultChecksumSha256 = hash(result);
      await this.#persistOutcome(job, {
        runId,
        fencingToken: job.lease.fencingToken,
        outcome: "succeeded",
        accepted: true,
        evidenceRef: response.evidenceRef,
        evidenceChecksumSha256,
        resultChecksumSha256
      });
      this.metrics.jobsSucceeded += 1;
      this.metrics.lastSuccessAt = new Date().toISOString();
      return { jobId: job.jobId, status: "completed", evidenceChecksumSha256, resultChecksumSha256 };
    } catch (error) {
      if (error?.code === "identity_worker_outcome_persistence_failed") throw error;
      if (error?.code === "identity_worker_job_timeout") this.metrics.jobsTimedOut += 1;
      return this.#recordFailure(job, runId, error);
    }
  }

  async #recordFailure(job, runId, error) {
    const failure = sanitize(error);
    const failureEvidence = {
      schema: "loanos.identity-worker-failure-evidence.v1",
      tenantId: job.tenantId,
      jobId: job.jobId,
      runId,
      workerId: this.workerId,
      executionMode: this.executionMode,
      error: failure
    };
    const evidenceChecksumSha256 = hash(failureEvidence);
    await this.#persistOutcome(job, {
      runId,
      fencingToken: job.lease.fencingToken,
      outcome: "failed",
      retryable: error?.retryable === true,
      errorCode: failure.code,
      errorMessage: failure.message,
      evidenceRef: `evidence://identity-operations/failures/${encodeURIComponent(job.jobId)}/attempt/${job.attempt}`,
      evidenceChecksumSha256
    });
    this.metrics.jobsFailed += 1;
    this.metrics.lastFailureAt = new Date().toISOString();
    return { jobId: job.jobId, status: error?.retryable === true ? "retry_wait" : "dead_letter", evidenceChecksumSha256, error: failure };
  }

  async #persistOutcome(job, outcome) {
    try {
      return await this.client.outcome(job.jobId, outcome);
    } catch (error) {
      this.metrics.outcomePersistenceFailures += 1;
      const wrapped = failValue("identity_worker_outcome_persistence_failed", "The worker outcome could not be durably persisted; the claim remains leased for fenced recovery.");
      wrapped.cause = error;
      throw wrapped;
    }
  }

  get signal() {
    if (!this.abortController) this.abortController = new AbortController();
    return this.abortController.signal;
  }

  health(now = new Date()) {
    const degraded = this.metrics.consecutiveRunFailures > 0 || this.metrics.outcomePersistenceFailures > 0 || this.metrics.finalizationFailures > 0;
    return {
      status: this.#stopping ? "stopping" : degraded ? "degraded" : "healthy",
      ready: !this.#stopping && !degraded,
      workerId: this.workerId,
      executionMode: this.executionMode,
      commerciallyLive: this.executionMode === "live",
      acceptingRuns: !this.#stopping,
      activeRuns: this.#activeRuns.size,
      bounds: { maxJobsPerRun: this.maxJobsPerRun, leaseMs: this.leaseMs, jobTimeoutMs: this.jobTimeoutMs },
      metrics: { ...this.metrics },
      observedAt: normalizeDate(now, "now").toISOString()
    };
  }

  prometheus() {
    const health = this.health();
    const metric = (name, help, value) => [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`];
    return [
      ...metric("loanos_identity_worker_ready", "Whether the worker is ready to accept a run.", health.ready ? 1 : 0),
      ...metric("loanos_identity_worker_active_runs", "Identity worker runs active in this process.", health.activeRuns),
      ...metric("loanos_identity_worker_runs_started_total", "Identity worker runs started.", health.metrics.runsStarted),
      ...metric("loanos_identity_worker_runs_failed_closed_total", "Identity worker runs that failed closed.", health.metrics.runsFailedClosed),
      ...metric("loanos_identity_worker_jobs_claimed_total", "Identity jobs claimed.", health.metrics.jobsClaimed),
      ...metric("loanos_identity_worker_jobs_succeeded_total", "Identity jobs completed with accepted evidence.", health.metrics.jobsSucceeded),
      ...metric("loanos_identity_worker_jobs_failed_total", "Identity jobs persisted as retry or dead letter.", health.metrics.jobsFailed),
      ...metric("loanos_identity_worker_outcome_persistence_failures_total", "Job outcomes that could not be durably persisted.", health.metrics.outcomePersistenceFailures),
      ""
    ].join("\n");
  }

  async shutdown() {
    this.#stopping = true;
    this.abortController?.abort();
    await Promise.all([...this.#runWaiters.values()]);
    return this.health();
  }
}

export function createIdentityOperationsWorkerApiClient(options = {}) {
  const baseUrl = new URL(text(options.baseUrl, "baseUrl"));
  const apiKey = text(options.apiKey, "apiKey");
  const requestTimeoutMs = integer(options.requestTimeoutMs ?? 10_000, 100, 3_600_000, "requestTimeoutMs");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") fail("identity_worker_client_invalid", "A fetch implementation is required.");
  const post = async (path, body) => {
    const response = await fetchImpl(new URL(path, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(value?.error?.message ?? `Worker service-plane request failed with HTTP ${response.status}.`);
      error.code = value?.error?.code ?? "identity_worker_service_request_failed";
      error.status = response.status;
      throw error;
    }
    return value;
  };
  return {
    claim: (body) => post("/identity-operations-worker/v1/claims", body),
    outcome: (jobId, body) => post(`/identity-operations-worker/v1/jobs/${encodeURIComponent(jobId)}/outcome`, body),
    finalize: (runId, body) => post(`/identity-operations-worker/v1/runs/${encodeURIComponent(runId)}/finalize`, body)
  };
}

/**
 * Builds either injected live handlers or the explicitly non-commercial local
 * simulator. Simulator results prove queue/handler contracts only.
 */
export function createIdentityOperationsExecutionHandlers(ports = {}, options = {}) {
  const executionMode = oneOf(options.executionMode ?? "simulated", ["simulated", "live"], "executionMode");
  return Object.fromEntries(IDENTITY_OPERATION_JOB_TYPES.map((type) => [type, executionMode === "simulated" ? simulator(type) : live(type, ports)]));
}

function simulator(type) {
  return async ({ job, payload, tenantId }) => {
    assertReferenceOnly(payload);
    return {
      accepted: true,
      outcome: "simulated_contract_verified",
      evidenceRef: `simulation://identity-operations/${encodeURIComponent(tenantId)}/${encodeURIComponent(job.jobId)}/${type}`,
      evidence: { schema: "loanos.identity-worker-simulation.v1", commerciallyLive: false, type, payloadChecksumSha256: job.payloadChecksumSha256 },
      result: { executionMode: "simulated", commerciallyLive: false, type, contractAccepted: true }
    };
  };
}

function live(type, ports) {
  const portName = {
    identity_readiness_assessment: "assessIdentityReadiness",
    directory_reconciliation: "reconcileDirectory",
    federation_metadata_validation: "validateFederationMetadata",
    activity_custody_verification: "verifyActivityCustody"
  }[type];
  return async (context) => {
    const port = ports[portName];
    if (typeof port !== "function") fail("identity_worker_live_port_unavailable", `Live provider port ${portName} is not configured.`);
    const value = await port(context);
    if (value?.accepted !== true || !value.evidenceRef) fail("identity_worker_live_evidence_missing", `Live provider port ${portName} did not return accepted evidence.`);
    return value;
  };
}

function validateClaimedJob(job, runId) {
  if (!job || !JOB_TYPES.has(job.type) || !job.tenantId || !job.jobId) fail("identity_worker_claimed_job_invalid", "Claimed job envelope is invalid.");
  if (job.status !== "leased" || job.lease?.runId !== runId || !job.lease?.fencingToken) fail("identity_worker_claimed_job_invalid", "Claimed job requires the active run lease and fencing token.");
  if (hash(job.payload) !== job.payloadChecksumSha256) fail("identity_worker_payload_checksum_invalid", "Claimed job payload checksum does not match.");
}

function assertReferenceOnly(value, path = "payload") {
  if (Array.isArray(value)) return value.forEach((entry, index) => assertReferenceOnly(entry, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) fail("identity_worker_payload_secret_forbidden", `${path}.${key} resembles secret material; jobs may carry references only.`);
    assertReferenceOnly(nested, `${path}.${key}`);
  }
}

function requireClient(client) {
  if (!client || ["claim", "outcome", "finalize"].some((name) => typeof client[name] !== "function")) fail("identity_worker_client_invalid", "Injected client must implement claim, outcome and finalize.");
}
function timeout(promise, milliseconds) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(failValue("identity_worker_job_timeout", "Identity operations job timed out.", true)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}
function hash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  throw failValue("identity_worker_value_invalid", "Worker values must be plain JSON.", false);
}
function sanitize(error) { return { code: error?.code ?? "identity_worker_execution_failed", message: String(error?.message ?? "Identity operations execution failed.").slice(0, 500), retryable: error?.retryable === true }; }
function failValue(code, message, retryable = false) { return Object.assign(new Error(message), { code, retryable }); }
function fail(code, message) { throw failValue(code, message); }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("identity_worker_runtime_configuration_invalid", `${field} is required.`); return value.trim(); }
function integer(value, min, max, field) { if (!Number.isInteger(value) || value < min || value > max) fail("identity_worker_runtime_configuration_invalid", `${field} must be between ${min} and ${max}.`); return value; }
function oneOf(value, allowed, field) { if (!allowed.includes(value)) fail("identity_worker_runtime_configuration_invalid", `${field} must be one of ${allowed.join(", ")}.`); return value; }
function normalizeDate(value, field) { const date = value instanceof Date ? new Date(value) : new Date(value); if (!Number.isFinite(date.getTime())) fail("identity_worker_runtime_configuration_invalid", `${field} must be a valid date-time.`); return date; }
