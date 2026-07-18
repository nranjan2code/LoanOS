import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { createObservabilityRegistry, normalizeRoutePath } from "../apps/api/src/observability.js";
import { createEmptyTenantData } from "../apps/api/src/file-store.js";
import { buildTenantOperationalHealth } from "@loanos/core";

test("runtime registry evaluates availability, latency, capacity, and low-cardinality routes", () => {
  const asOf = new Date("2026-07-14T12:00:00.000Z");
  const registry = createObservabilityRegistry({
    now: () => asOf,
    startedAt: new Date("2026-07-14T11:00:00.000Z"),
    availabilityTargetPct: 99,
    p95LatencyTargetMs: 500
  });
  registry.observeRequest({ method: "GET", route: "/v1/loans/123", statusCode: 200, durationMs: 40, tenantId: "tnt_secret", observedAt: asOf });
  registry.observeRequest({ method: "GET", route: "/loans/456", statusCode: 503, durationMs: 900, tenantId: "tnt_secret", observedAt: asOf });
  registry.observeRequest({ method: "POST", route: "/payments/pay_abcdef12", statusCode: 201, durationMs: 100, tenantId: "tnt_other", observedAt: asOf });

  const tenant = registry.snapshot({ tenantId: "tnt_secret", asOf });
  assert.equal(tenant.status, "breached");
  assert.equal(tenant.sli.requestCount, 2);
  assert.equal(tenant.sli.serverErrorCount, 1);
  assert.equal(tenant.sli.availabilityPct, 50);
  assert.equal(tenant.sli.p95LatencyMs, 900);
  assert.equal(tenant.slo.errorBudgetRemainingPct, 0);
  assert.equal(tenant.routes[0].route, "/loans/:id");
  assert.equal(normalizeRoutePath("/v1/applications/550e8400-e29b-41d4-a716-446655440000"), "/applications/:id");
  assert.equal(normalizeRoutePath("/t/named-bank/branding"), "/t/:tenant/branding");

  const prometheus = registry.prometheus();
  assert.match(prometheus, /loanos_http_availability_percent/);
  assert.match(prometheus, /loanos_uptime_seconds 3600\.000/);
  assert.doesNotMatch(prometheus, /tnt_secret|tnt_other/);
});

test("tenant operational health detects provider failures and stuck work", () => {
  const state = createEmptyTenantData();
  state.paymentReconciliations.rec_1 = {
    reconciliationId: "rec_1",
    outcome: "exception",
    receivedAt: "2026-07-14T10:00:00.000Z",
    exceptionCode: "amount_mismatch"
  };
  state.paymentRails.rail_1 = {
    paymentRailId: "rail_1",
    type: "disbursement",
    status: "pending",
    createdAt: "2026-07-14T10:30:00.000Z"
  };
  const runtime = {
    status: "breached",
    sli: { availabilityPct: 98, p95LatencyMs: 900 },
    slo: { availabilityTargetPct: 99.9, p95LatencyTargetMs: 750, errorBudgetRemainingPct: 0 }
  };
  const health = buildTenantOperationalHealth(state, {
    asOf: "2026-07-14T12:00:00.000Z",
    providerReadiness: [{ integration: "payment_rail", label: "Payment rail", status: "degraded", reason: "provider_circuit_open" }],
    runtime
  });

  assert.equal(health.status, "critical");
  assert.equal(health.work.stuckCount, 2);
  assert.equal(health.providers.degraded, 1);
  assert.ok(health.alerts.items.some((alert) => alert.alertId === "runtime:availability"));
  assert.ok(health.alerts.items.some((alert) => alert.alertId === "provider:payment_rail:degraded"));
  assert.ok(health.alerts.items.some((alert) => alert.alertId === "stuck:payment_reconciliation:rec_1"));
});

test("operations APIs expose tenant and platform health while metrics scrape is token protected", async (t) => {
  const previousMetricsToken = process.env.LOANOS_METRICS_TOKEN;
  process.env.LOANOS_METRICS_TOKEN = "metrics-secret";
  t.after(() => {
    if (previousMetricsToken === undefined) delete process.env.LOANOS_METRICS_TOKEN;
    else process.env.LOANOS_METRICS_TOKEN = previousMetricsToken;
  });

  const dataDir = await mkdtemp(join(tmpdir(), "loanos-observability-"));
  const tenant = { tenantId: "tnt_observe", name: "Observe Bank", apiKey: "observe-key" };
  const platformAdminKey = "platform-observe-key";
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant], platformAdminKey });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const tenantHeaders = { "x-api-key": tenant.apiKey };

  assert.equal((await fetch(`${base}/audit/events`, { headers: tenantHeaders })).status, 200);
  const metricsResponse = await fetch(`${base}/operations/metrics`, { headers: tenantHeaders });
  assert.equal(metricsResponse.status, 200);
  const tenantMetrics = await metricsResponse.json();
  assert.equal(tenantMetrics.tenantId, tenant.tenantId);
  assert.ok(tenantMetrics.runtime.sli.requestCount >= 1);

  const tenantHealthResponse = await fetch(`${base}/operations/health`, { headers: tenantHeaders });
  assert.equal(tenantHealthResponse.status, 200);
  const tenantHealth = await tenantHealthResponse.json();
  assert.equal(tenantHealth.tenantId, tenant.tenantId);
  assert.equal(tenantHealth.providers.total, 15);
  assert.equal(tenantHealth.runtime.routes.some((route) => route.route === "/platform/operations/health"), false);

  assert.equal((await fetch(`${base}/metrics`)).status, 401);
  const scrape = await fetch(`${base}/metrics`, { headers: { authorization: "Bearer metrics-secret" } });
  assert.equal(scrape.status, 200);
  assert.match(scrape.headers.get("content-type"), /text\/plain/);
  assert.match(await scrape.text(), /loanos_http_requests_total/);

  const platformResponse = await fetch(`${base}/platform/operations/health`, { headers: { "x-platform-admin-key": platformAdminKey } });
  assert.equal(platformResponse.status, 200);
  const platform = await platformResponse.json();
  assert.equal(platform.scope, "platform");
  assert.equal(platform.tenants.total, 1);
  assert.equal(platform.tenants.items[0].tenantId, tenant.tenantId);
});
