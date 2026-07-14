import { createHash, createHmac } from "node:crypto";
import { claimDueProviderCallbacks, projectProviderCallbackQueue, recordProviderCallbackAttempt } from "../../../packages/core/src/provider-callback-delivery.js";

export class ProviderCallbackDispatcher {
  constructor(options = {}) {
    this.fetch = options.fetch ?? globalThis.fetch; this.resolveTarget = options.resolveTarget ?? ((ref) => ref); this.resolveSecret = options.resolveSecret ?? (() => null);
    this.timeoutMs = bounded(options.timeoutMs ?? 5000, 100, 30000, "timeoutMs"); this.leaseMs = bounded(options.leaseMs ?? 30000, 1000, 300000, "leaseMs"); this.limit = bounded(options.limit ?? 25, 1, 500, "limit");
    this.circuitFailureThreshold = bounded(options.circuitFailureThreshold ?? 3, 1, 20, "circuitFailureThreshold"); this.circuitCooldownMs = bounded(options.circuitCooldownMs ?? 30000, 1000, 300000, "circuitCooldownMs"); this.circuits = new Map();
  }

  async runOnce(registry = {}, input = {}) {
    const started = Date.now(); const now = input.now ?? new Date(); const tenantId = required(input.tenantId, "tenantId"); const workerId = required(input.workerId, "workerId"); const maxRunMs = bounded(input.maxRunMs ?? 30000, 100, 300000, "maxRunMs");
    const claim = claimDueProviderCallbacks(registry, { tenantId, workerId, limit: input.limit ?? this.limit, leaseMs: Math.min(this.leaseMs, maxRunMs) }, now); let next = claim.registry;
    const metrics = { claimed: claim.claimed.length, delivered: 0, retryableFailures: 0, permanentFailures: 0, circuitRejected: 0, timedOut: 0, durationMs: 0 };
    for (const delivery of claim.claimed) {
      if (Date.now() - started >= maxRunMs) break;
      const circuit = this.circuits.get(delivery.provider); const clock = (input.clock ?? Date.now)(); let outcome;
      if (circuit?.openUntil > clock) { outcome = { outcome: "retryable_failure", errorCode: "CIRCUIT_OPEN", evidenceRef: evidence(delivery, "circuit_open") }; metrics.circuitRejected += 1; }
      else outcome = await this.#deliver(delivery, Math.min(this.timeoutMs, Math.max(1, maxRunMs - (Date.now() - started))), input);
      const recorded = recordProviderCallbackAttempt(next, delivery.deliveryId, { workerId, ...outcome }, { tenantId }, input.now ?? new Date()); next = recorded.registry;
      if (outcome.outcome === "delivered") { metrics.delivered += 1; this.circuits.delete(delivery.provider); }
      else {
        if (outcome.outcome === "permanent_failure") metrics.permanentFailures += 1; else metrics.retryableFailures += 1;
        if (outcome.errorCode === "TIMEOUT") metrics.timedOut += 1; this.#recordFailure(delivery.provider, clock);
        if (outcome.retryAfterMs && recorded.delivery.status === "pending") next = { ...next, [delivery.deliveryId]: { ...next[delivery.deliveryId], nextAttemptAt: new Date((input.now ?? new Date()).getTime() + outcome.retryAfterMs).toISOString() } };
      }
    }
    metrics.durationMs = Date.now() - started; const queue = projectProviderCallbackQueue(next, { tenantId });
    return { registry: next, metrics, health: { status: queue.counts.dead_letter ? "degraded" : metrics.circuitRejected ? "degraded" : "healthy", queue, circuits: [...this.circuits.entries()].map(([provider, value]) => ({ provider, failures: value.failures, openUntil: value.openUntil ? new Date(value.openUntil).toISOString() : null })) } };
  }

  async #deliver(delivery, timeoutMs, input) {
    let url; try { url = new URL(await this.resolveTarget(delivery.targetRef, delivery)); if (url.protocol !== "https:" && !input.allowHttpForTests) throw new Error("HTTPS required"); } catch { return { outcome: "permanent_failure", errorCode: "TARGET_INVALID", evidenceRef: evidence(delivery, "target_invalid") }; }
    const secret = await this.resolveSecret(delivery.provider, delivery); if (!secret) return { outcome: "permanent_failure", errorCode: "SECRET_MISSING", evidenceRef: evidence(delivery, "secret_missing") };
    const body = JSON.stringify(delivery.payload); const timestamp = new Date().toISOString(); const signature = createHmac("sha256", secret).update(`${delivery.eventId}.${timestamp}.${body}`).digest("hex"); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-loanos-event-id": delivery.eventId, "x-loanos-timestamp": timestamp, "x-loanos-signature": `sha256=${signature}`, "x-loanos-payload-sha256": createHash("sha256").update(body).digest("hex") }, body, signal: controller.signal });
      const status = response.status; const evidenceRef = evidence(delivery, `http_${status}`); if (status >= 200 && status < 300) return { outcome: "delivered", responseStatus: status, evidenceRef };
      if ([408, 425, 429].includes(status) || status >= 500) return { outcome: "retryable_failure", responseStatus: status, errorCode: `HTTP_${status}`, retryAfterMs: retryAfter(response.headers?.get?.("retry-after")), evidenceRef };
      return { outcome: "permanent_failure", responseStatus: status, errorCode: `HTTP_${status}`, evidenceRef };
    } catch (error) { return { outcome: "retryable_failure", errorCode: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR", evidenceRef: evidence(delivery, error?.name === "AbortError" ? "timeout" : "network") }; }
    finally { clearTimeout(timer); }
  }

  #recordFailure(provider, now) { const prior = this.circuits.get(provider) ?? { failures: 0, openUntil: null }; const failures = prior.failures + 1; this.circuits.set(provider, { failures, openUntil: failures >= this.circuitFailureThreshold ? now + this.circuitCooldownMs : null }); }
}

function retryAfter(value) { if (!value) return null; if (/^\d+$/.test(value)) return Math.min(Number(value) * 1000, 86400000); const time = Date.parse(value); return Number.isFinite(time) ? Math.max(0, Math.min(time - Date.now(), 86400000)) : null; }
function evidence(delivery, result) { return `callback-attempt://${delivery.deliveryId}/${delivery.attemptCount + 1}/${result}`; }
function required(value, field) { if (typeof value !== "string" || !value.trim()) throw Object.assign(new Error(`${field} is required.`), { code: "callback_dispatcher_invalid" }); return value; }
function bounded(value, min, max, field) { if (!Number.isInteger(value) || value < min || value > max) throw Object.assign(new Error(`${field} is invalid.`), { code: "callback_dispatcher_invalid" }); return value; }
