const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_SAMPLES = 10000;

export function createObservabilityRegistry(options = {}) {
  const startedAt = options.startedAt ?? new Date();
  const now = options.now ?? (() => new Date());
  const windowMs = positiveNumber(options.windowMs, DEFAULT_WINDOW_MS);
  const maxSamples = positiveNumber(options.maxSamples, DEFAULT_MAX_SAMPLES);
  const availabilityTargetPct = positiveNumber(options.availabilityTargetPct, 99.9);
  const p95LatencyTargetMs = positiveNumber(options.p95LatencyTargetMs, 750);
  const samples = [];
  let inFlight = 0;
  let maxInFlight = 0;

  function observeRequest(sample) {
    const observedAt = normalizeDate(sample.observedAt) ?? now();
    samples.push({
      method: String(sample.method ?? "GET").toUpperCase(),
      route: normalizeRoutePath(sample.route ?? "/unknown"),
      statusCode: Number(sample.statusCode ?? 500),
      durationMs: Math.max(0, Number(sample.durationMs ?? 0)),
      tenantId: sample.tenantId ?? null,
      observedAt: observedAt.toISOString()
    });
    prune(observedAt);
  }

  function trackRequest(req, res) {
    const beganAt = process.hrtime.bigint();
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    let finalized = false;
    const finalize = (statusCode) => {
      if (finalized) return;
      finalized = true;
      inFlight = Math.max(0, inFlight - 1);
      observeRequest({
        method: req.method,
        route: new URL(req.url ?? "/", "http://localhost").pathname,
        statusCode,
        durationMs: Number(process.hrtime.bigint() - beganAt) / 1_000_000,
        tenantId: res._loanosTenantId ?? null
      });
    };
    res.once("finish", () => finalize(res.statusCode));
    res.once("close", () => finalize(res.writableEnded ? res.statusCode : 499));
  }

  function snapshot(filters = {}) {
    const asOf = normalizeDate(filters.asOf) ?? now();
    prune(asOf);
    const selected = samples.filter((sample) => !filters.tenantId || sample.tenantId === filters.tenantId);
    const requestCount = selected.length;
    const failures = selected.filter((sample) => sample.statusCode >= 500).length;
    const latencies = selected.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const availabilityPct = requestCount === 0 ? 100 : ((requestCount - failures) / requestCount) * 100;
    const p95LatencyMs = percentile(latencies, 0.95);
    const budgetFraction = Math.max(0.000001, 1 - availabilityTargetPct / 100);
    const consumedFraction = requestCount === 0 ? 0 : failures / requestCount;
    const errorBudgetRemainingPct = Math.max(0, ((budgetFraction - consumedFraction) / budgetFraction) * 100);
    const status = availabilityPct < availabilityTargetPct || p95LatencyMs > p95LatencyTargetMs
      ? errorBudgetRemainingPct === 0 ? "breached" : "degraded"
      : "healthy";
    const byRoute = aggregateRoutes(selected);
    return {
      generatedAt: asOf.toISOString(),
      windowMinutes: windowMs / 60000,
      status,
      sli: {
        requestCount,
        serverErrorCount: failures,
        availabilityPct: round(availabilityPct, 4),
        p50LatencyMs: round(percentile(latencies, 0.5), 3),
        p95LatencyMs: round(p95LatencyMs, 3),
        p99LatencyMs: round(percentile(latencies, 0.99), 3)
      },
      slo: {
        availabilityTargetPct,
        p95LatencyTargetMs,
        errorBudgetRemainingPct: round(errorBudgetRemainingPct, 2)
      },
      capacity: {
        inFlight,
        maxInFlight,
        observedRequestsPerMinute: round(requestCount / Math.max(1, windowMs / 60000), 3),
        retainedSampleCount: samples.length,
        maxRetainedSamples: maxSamples
      },
      routes: byRoute
    };
  }

  function prometheus() {
    const current = snapshot();
    const lines = [
      "# HELP loanos_uptime_seconds Process uptime in seconds.",
      "# TYPE loanos_uptime_seconds gauge",
      `loanos_uptime_seconds ${Math.max(0, (now().getTime() - startedAt.getTime()) / 1000).toFixed(3)}`,
      "# HELP loanos_http_requests_total HTTP requests observed in the current process window.",
      "# TYPE loanos_http_requests_total gauge"
    ];
    for (const route of current.routes) {
      lines.push(`loanos_http_requests_total{method="${escapeLabel(route.method)}",route="${escapeLabel(route.route)}",status_class="${route.statusClass}"} ${route.count}`);
    }
    lines.push(
      "# HELP loanos_http_availability_percent HTTP availability over the current SLI window.",
      "# TYPE loanos_http_availability_percent gauge",
      `loanos_http_availability_percent ${current.sli.availabilityPct}`,
      "# HELP loanos_http_latency_p95_milliseconds HTTP p95 latency over the current SLI window.",
      "# TYPE loanos_http_latency_p95_milliseconds gauge",
      `loanos_http_latency_p95_milliseconds ${current.sli.p95LatencyMs}`,
      "# HELP loanos_http_in_flight_requests Current in-flight HTTP requests.",
      "# TYPE loanos_http_in_flight_requests gauge",
      `loanos_http_in_flight_requests ${inFlight}`,
      ""
    );
    return lines.join("\n");
  }

  function prune(asOf) {
    const cutoff = asOf.getTime() - windowMs;
    while (samples.length > 0 && (new Date(samples[0].observedAt).getTime() < cutoff || samples.length > maxSamples)) {
      samples.shift();
    }
  }

  return { observeRequest, trackRequest, snapshot, prometheus };
}

export function normalizeRoutePath(path) {
  const stripped = String(path).replace(/^\/v1(?=\/|$)/, "") || "/";
  const segments = stripped.split("/").map((segment) => {
    if (!segment) return segment;
    if (/^[0-9]+$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id";
    if (/^[a-z][a-z0-9]*_[a-z0-9-]{6,}$/i.test(segment)) return ":id";
    return segment;
  });
  if (segments[1] === "t" && segments[2]) segments[2] = ":tenant";
  return segments.join("/");
}

function aggregateRoutes(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const statusClass = `${Math.floor(sample.statusCode / 100)}xx`;
    const key = `${sample.method}\u0000${sample.route}\u0000${statusClass}`;
    const current = groups.get(key) ?? { method: sample.method, route: sample.route, statusClass, count: 0, durations: [] };
    current.count += 1;
    current.durations.push(sample.durationMs);
    groups.set(key, current);
  }
  return [...groups.values()].map((group) => ({
    method: group.method,
    route: group.route,
    statusClass: group.statusClass,
    count: group.count,
    p95LatencyMs: round(percentile(group.durations.sort((a, b) => a - b), 0.95), 3)
  })).sort((left, right) => left.route.localeCompare(right.route) || left.method.localeCompare(right.method) || left.statusClass.localeCompare(right.statusClass));
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function escapeLabel(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}
