import { performance } from "node:perf_hooks";

export async function runResilienceProbe(options = {}) {
  const targetUrl = new URL(options.targetUrl);
  if (!new Set(["http:", "https:"]).has(targetUrl.protocol)) throw new Error("Probe target must use HTTP or HTTPS.");
  const concurrency = boundedInteger(options.concurrency ?? 5, 1, 100, "concurrency");
  const iterations = boundedInteger(options.iterations ?? 100, 1, 10_000, "iterations");
  const timeoutMs = boundedInteger(options.timeoutMs ?? 5_000, 100, 60_000, "timeoutMs");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const headers = { ...(options.headers ?? {}) };
  const latencies = [];
  const statusCounts = {};
  let errorCount = 0;
  let next = 0;
  const beganAt = performance.now();

  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= iterations) return;
      const requestBeganAt = performance.now();
      try {
        const response = await fetchImpl(targetUrl, { method: options.method ?? "GET", headers, signal: AbortSignal.timeout(timeoutMs) });
        latencies.push(performance.now() - requestBeganAt);
        const key = String(response.status);
        statusCounts[key] = (statusCounts[key] ?? 0) + 1;
        if (!response.ok) errorCount += 1;
        await response.arrayBuffer();
      } catch {
        latencies.push(performance.now() - requestBeganAt);
        errorCount += 1;
        statusCounts.transport_error = (statusCounts.transport_error ?? 0) + 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, iterations) }, worker));
  const durationMs = Math.max(0.001, performance.now() - beganAt);
  latencies.sort((left, right) => left - right);
  return {
    generatedAt: new Date().toISOString(),
    target: `${targetUrl.origin}${targetUrl.pathname}`,
    requestCount: iterations,
    errorCount,
    errorRatePct: round((errorCount / iterations) * 100, 4),
    p50LatencyMs: round(percentile(latencies, 0.5), 3),
    p95LatencyMs: round(percentile(latencies, 0.95), 3),
    p99LatencyMs: round(percentile(latencies, 0.99), 3),
    throughputRps: round(iterations / (durationMs / 1000), 4),
    durationMs: round(durationMs, 3),
    concurrency,
    statusCounts
  };
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function boundedInteger(value, minimum, maximum, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  return parsed;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
