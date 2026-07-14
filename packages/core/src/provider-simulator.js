import { createHash, createHmac } from "node:crypto";

const OUTCOMES = new Set(["success", "failure", "timeout", "rate_limit"]);

export class DeterministicProviderSimulator {
  constructor(config = {}) {
    required(config.tenantId, "tenantId"); required(config.seed, "seed"); required(config.callbackSecret, "callbackSecret");
    this.tenantId = config.tenantId; this.seed = config.seed; this.callbackSecret = config.callbackSecret;
    this.timeMs = parseTime(config.startAt ?? "2026-01-01T00:00:00.000Z", "startAt");
    this.scenarios = normalizeScenarios(config.scenarios ?? { success: { outcome: "success" } });
    this.sequence = 0; this.requests = []; this.callbacks = []; this.idempotency = new Map();
  }

  now() { return new Date(this.timeMs).toISOString(); }
  advance(milliseconds) { if (!Number.isInteger(milliseconds) || milliseconds < 0) invalid("milliseconds must be a non-negative integer."); this.timeMs += milliseconds; return this.now(); }

  submit(input = {}) {
    for (const field of ["provider", "operation", "idempotencyKey", "scenario"]) required(input[field], field);
    if (input.tenantId !== this.tenantId) fail("provider_simulator_tenant_mismatch", "Simulator cannot accept another tenant's request.");
    const scenario = this.scenarios[input.scenario]; if (!scenario) fail("provider_simulator_scenario_missing", "Requested scenario is not configured.");
    const existing = this.idempotency.get(`${input.provider}:${input.operation}:${input.idempotencyKey}`);
    if (existing) { this.requests.push(freeze({ ...existing.request, attemptId: this.id("attempt"), duplicate: true, receivedAt: this.now() })); return clone(existing.result); }
    const requestId = this.id("request");
    const request = freeze({ tenantId: this.tenantId, requestId, attemptId: this.id("attempt"), provider: input.provider, operation: input.operation, idempotencyKey: input.idempotencyKey, payloadSha256: sha(input.payload ?? {}), scenario: input.scenario, duplicate: false, receivedAt: this.now() });
    this.requests.push(request);
    if (["timeout", "rate_limit"].includes(scenario.outcome)) {
      const error = simulatorError(scenario.outcome === "timeout" ? "provider_simulator_timeout" : "provider_simulator_rate_limited", scenario.outcome === "timeout" ? "Simulated provider timed out." : "Simulated provider rate limit exceeded.", { retryAfterMs: scenario.retryAfterMs ?? null, requestId });
      this.idempotency.set(`${input.provider}:${input.operation}:${input.idempotencyKey}`, { request, result: { error: serializeError(error) } }); throw error;
    }
    const result = freeze({ success: scenario.outcome === "success", provider: input.provider, operation: input.operation, providerReference: this.id("provider_ref"), requestId, status: scenario.outcome === "success" ? (scenario.responseStatus ?? "accepted") : (scenario.responseStatus ?? "rejected"), responseCode: scenario.responseCode ?? null, response: clone(scenario.response ?? {}), respondedAt: this.now() });
    this.idempotency.set(`${input.provider}:${input.operation}:${input.idempotencyKey}`, { request, result });
    this.scheduleCallbacks(request, result, scenario);
    return clone(result);
  }

  scheduleCallbacks(request, result, scenario) {
    const specs = scenario.callbacks?.length ? scenario.callbacks : scenario.callback === false ? [] : [{ eventType: `${request.operation}.${result.status}`, delayMs: scenario.delayMs ?? 0 }];
    const ordered = scenario.outOfOrder ? [...specs].reverse() : specs;
    ordered.forEach((spec, index) => {
      const eventId = this.id("event"); const payload = { tenantId: this.tenantId, requestId: request.requestId, providerReference: result.providerReference, eventType: spec.eventType ?? `${request.operation}.${result.status}`, status: spec.status ?? result.status, sequence: spec.sequence ?? index + 1, ...clone(spec.payload ?? {}) };
      const signature = sign(this.callbackSecret, request.provider, eventId, payload);
      const callback = freeze({ tenantId: this.tenantId, callbackId: this.id("callback"), deliverySequence: this.sequence, provider: request.provider, eventId, payload, signature: scenario.tamper || spec.tamper ? tamper(signature) : signature, deliverAt: new Date(this.timeMs + nonnegative(spec.delayMs ?? 0, "delayMs")).toISOString(), duplicate: false });
      this.callbacks.push(callback);
      if (scenario.duplicates || spec.duplicate) this.callbacks.push(freeze({ ...callback, callbackId: this.id("callback"), duplicate: true }));
    });
  }

  drainCallbacks(asOf = this.now()) {
    const cutoff = parseTime(asOf, "asOf"); const due = this.callbacks.filter((item) => Date.parse(item.deliverAt) <= cutoff).sort((a, b) => Date.parse(a.deliverAt) - Date.parse(b.deliverAt) || a.deliverySequence - b.deliverySequence);
    const ids = new Set(due.map((item) => item.callbackId)); this.callbacks = this.callbacks.filter((item) => !ids.has(item.callbackId)); return clone(due);
  }

  requestJournal() { return clone(this.requests); }
  pendingCallbacks() { return clone(this.callbacks); }
  verify(callback) { return callback?.tenantId === this.tenantId && callback.signature === sign(this.callbackSecret, callback.provider, callback.eventId, callback.payload); }
  id(kind) { this.sequence += 1; return `${kind}_${sha(`${this.seed}:${this.sequence}:${kind}`).slice(0, 20)}`; }
}

function normalizeScenarios(value) { if (!value || Array.isArray(value) || typeof value !== "object") invalid("scenarios must be an object."); return Object.fromEntries(Object.entries(value).map(([name, scenario]) => { required(name, "scenario name"); if (!scenario || !OUTCOMES.has(scenario.outcome)) invalid(`Scenario ${name} has an invalid outcome.`); if (scenario.callbacks != null && !Array.isArray(scenario.callbacks)) invalid(`Scenario ${name} callbacks must be an array.`); return [name, clone(scenario)]; })); }
function sign(secret, provider, eventId, payload) { return `sha256=${createHmac("sha256", secret).update(`${provider}.${eventId}.${JSON.stringify(payload)}`).digest("hex")}`; }
function tamper(value) { return `${value.slice(0, -1)}${value.endsWith("0") ? "1" : "0"}`; }
function sha(value) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function parseTime(value, field) { const time = Date.parse(value); if (!Number.isFinite(time)) invalid(`${field} must be an ISO date-time.`); return time; }
function nonnegative(value, field) { if (!Number.isInteger(value) || value < 0) invalid(`${field} must be a non-negative integer.`); return value; }
function required(value, field) { if (typeof value !== "string" || !value.trim()) invalid(`${field} is required.`); }
function clone(value) { return value == null ? value : structuredClone(value); }
function freeze(value) { return Object.freeze(clone(value)); }
function serializeError(error) { return { code: error.code, message: error.message, retryAfterMs: error.retryAfterMs ?? null, requestId: error.requestId }; }
function simulatorError(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
function invalid(message) { fail("provider_simulator_invalid", message); }
function fail(code, message) { throw simulatorError(code, message); }

export function createProviderSimulator(config) { return new DeterministicProviderSimulator(config); }
export function verifySimulatedProviderCallback(callback, secret) { required(secret, "secret"); return Boolean(callback?.provider && callback?.eventId && callback?.payload && callback.signature === sign(secret, callback.provider, callback.eventId, callback.payload)); }
