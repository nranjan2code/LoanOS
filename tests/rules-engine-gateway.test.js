import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { assessEligibilityGated } from "../apps/api/src/rules-engine.js";

describe("Rules Engine Gateway Client", () => {
  const originalFetch = globalThis.fetch;
  const originalEnvMode = process.env.LOANOS_RULES_ENGINE;
  const originalEngineUrls = process.env.LOANOS_RULES_ENGINE_URLS;
  let mockFetchCalled = false;
  let mockFetchArgs = [];
  let mockFetchResponse = null;

  before(() => {
    globalThis.fetch = async (url, options) => {
      mockFetchCalled = true;
      mockFetchArgs = [url, options];
      if (mockFetchResponse instanceof Error) {
        throw mockFetchResponse;
      }
      return mockFetchResponse;
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
    if (originalEnvMode === undefined) {
      delete process.env.LOANOS_RULES_ENGINE;
    } else {
      process.env.LOANOS_RULES_ENGINE = originalEnvMode;
    }
    if (originalEngineUrls === undefined) {
      delete process.env.LOANOS_RULES_ENGINE_URLS;
    } else {
      process.env.LOANOS_RULES_ENGINE_URLS = originalEngineUrls;
    }
  });

  beforeEach(() => {
    mockFetchCalled = false;
    mockFetchArgs = [];
    mockFetchResponse = null;
    process.env.LOANOS_RULES_ENGINE_URLS = JSON.stringify({ dev: "http://engine-dev:47311" });
  });

  // Mock JS evaluator
  const mockEvaluateJs = (app) => ({
    assessment: {
      decision: app.shouldApprove ? "eligible" : "ineligible",
      reasons: app.reasons || []
    }
  });

  const sampleApp = {
    product: {
      requestedAmount: 10000,
      minAmount: 5000,
      maxAmount: 20000,
      requestedTenorMonths: 12,
      annualInterestRateBps: 1500,
      aprBps: 1500,
      eligibility: {
        minAgeYears: 21,
        maxAgeYears: 65,
        minMonthlyIncome: 15000,
        maxFoir: 0.5
      }
    },
    borrower: {
      ageYears: 25,
      dateOfBirth: "2001-01-01"
    },
    economicProfile: {
      monthlyIncome: 50000,
      existingMonthlyObligations: 500
    },
    shouldApprove: true
  };

  test("Mode 'off': returns JS decision and never calls the rules engine", async () => {
    process.env.LOANOS_RULES_ENGINE = "off";
    
    const result = await assessEligibilityGated({
      evaluateJs: mockEvaluateJs,
      application: sampleApp,
      tenantId: "dev",
      stage: "underwriting"
    });

    assert.strictEqual(mockFetchCalled, false);
    assert.strictEqual(result.assessment.decision, "eligible");
    assert.strictEqual(result.assessment.engineShadow, undefined);
    assert.strictEqual(result.assessment.engine, undefined);
  });

  test("Mode 'shadow': returns JS decision, queries engine, attaches comparison record on success", async () => {
    process.env.LOANOS_RULES_ENGINE = "shadow";
    mockFetchResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        decision: "eligible",
        reasons: [],
        ruleset: "lending-v1",
        trace_ref: "trace_123",
        engine: "eng-dev-1"
      })
    };

    const result = await assessEligibilityGated({
      evaluateJs: mockEvaluateJs,
      application: sampleApp,
      tenantId: "dev",
      stage: "underwriting"
    });

    assert.strictEqual(mockFetchCalled, true);
    assert.strictEqual(result.assessment.decision, "eligible"); // JS decision wins
    assert.ok(result.assessment.engineShadow);
    assert.strictEqual(result.assessment.engineShadow.decision, "eligible");
    assert.strictEqual(result.assessment.engineShadow.diverged, false);
    assert.strictEqual(result.assessment.engineShadow.ruleset, "lending-v1");
  });

  test("Mode 'shadow': logs divergence when JS and engine decisions differ", async () => {
    process.env.LOANOS_RULES_ENGINE = "shadow";
    mockFetchResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        decision: "refer", // Diverges from JS 'eligible'
        reasons: [{ code: "MIN_AGE" }],
        ruleset: "lending-v1",
        trace_ref: "trace_diverge",
        engine: "eng-dev-1"
      })
    };

    const result = await assessEligibilityGated({
      evaluateJs: mockEvaluateJs,
      application: sampleApp,
      tenantId: "dev",
      stage: "underwriting"
    });

    assert.strictEqual(result.assessment.decision, "eligible"); // JS still wins
    assert.ok(result.assessment.engineShadow);
    assert.strictEqual(result.assessment.engineShadow.decision, "refer");
    assert.strictEqual(result.assessment.engineShadow.diverged, true);
  });

  test("Mode 'shadow': does not affect caller if engine is unreachable", async () => {
    process.env.LOANOS_RULES_ENGINE = "shadow";
    mockFetchResponse = new Error("Connection refused");

    const result = await assessEligibilityGated({
      evaluateJs: mockEvaluateJs,
      application: sampleApp,
      tenantId: "dev",
      stage: "underwriting"
    });

    assert.strictEqual(mockFetchCalled, true);
    assert.strictEqual(result.assessment.decision, "eligible"); // unaffected
    assert.strictEqual(result.assessment.engineShadow, undefined);
  });

  test("Mode 'active': returns engine decision on success", async () => {
    process.env.LOANOS_RULES_ENGINE = "active";
    mockFetchResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        decision: "ineligible", // Overrides JS 'eligible'
        reasons: [{ severity: "error", code: "MAX_FOIR_EXCEEDED", regulation: "RBI-DL-2025", message: "FOIR exceeds the approved ceiling.", path: "/economic_profile/monthly_income", audience: "tenant_ops" }],
        ruleset: "lending-v1",
        trace_ref: "trace_active_fail",
        engine: "eng-dev-1"
      })
    };

    const result = await assessEligibilityGated({
      evaluateJs: mockEvaluateJs,
      application: sampleApp,
      tenantId: "dev",
      stage: "underwriting"
    });

    assert.strictEqual(mockFetchCalled, true);
    assert.strictEqual(result.assessment.decision, "ineligible"); // Engine decision overrides
    assert.ok(result.assessment.engine);
    assert.strictEqual(result.assessment.engine.decidedBy, "rules-engine");
    assert.strictEqual(result.assessment.engine.ruleset, "lending-v1");
    assert.deepStrictEqual(result.assessment.reasons, [
      {
        severity: "error",
        controlId: "RBI-DL-2025",
        code: "MAX_FOIR_EXCEEDED",
        message: "FOIR exceeds the approved ceiling.",
        path: "/economic_profile/monthly_income",
        audience: "tenant_ops"
      }
    ]);
    assert.strictEqual(result.assessment.summary.status, "blocked");
    assert.strictEqual(result.findings, result.assessment.reasons);
    assert.match(mockFetchArgs[0], /^http:\/\/engine-dev:47311\/v1\/decide$/);
  });

  test("Mode 'active': fails closed to 'refer' if engine is unreachable", async () => {
    process.env.LOANOS_RULES_ENGINE = "active";
    mockFetchResponse = new Error("Connection timed out");

    const result = await assessEligibilityGated({
      evaluateJs: mockEvaluateJs,
      application: sampleApp,
      tenantId: "dev",
      stage: "underwriting"
    });

    assert.strictEqual(mockFetchCalled, true);
    assert.strictEqual(result.assessment.decision, "refer"); // Fails closed!
    assert.ok(result.assessment.engine);
    assert.strictEqual(result.assessment.engine.error, "engine_unavailable_fail_closed");
    assert.strictEqual(result.assessment.summary.status, "review");
    assert.strictEqual(result.assessment.reasons[0].code, "ENGINE_UNAVAILABLE_FAIL_CLOSED");
  });

  test("routes each tenant only to its configured isolated instance", async () => {
    process.env.LOANOS_RULES_ENGINE = "active";
    process.env.LOANOS_RULES_ENGINE_URLS = JSON.stringify({ tenant_a: "http://engine-a:47311", tenant_b: "http://engine-b:47311" });
    mockFetchResponse = {
      ok: true,
      status: 200,
      json: async () => ({ decision: "eligible", reasons: [], ruleset: "lending-v1", trace_ref: "trace_a", engine: "eng-a" })
    };

    await assessEligibilityGated({ evaluateJs: mockEvaluateJs, application: sampleApp, tenantId: "tenant_a", stage: "underwriting" });
    assert.match(mockFetchArgs[0], /^http:\/\/engine-a:47311\/v1\/decide$/);

    await assessEligibilityGated({ evaluateJs: mockEvaluateJs, application: sampleApp, tenantId: "tenant_b", stage: "underwriting" });
    assert.match(mockFetchArgs[0], /^http:\/\/engine-b:47311\/v1\/decide$/);
  });

  test("fails closed when the tenant has no configured instance", async () => {
    process.env.LOANOS_RULES_ENGINE = "active";
    process.env.LOANOS_RULES_ENGINE_URLS = JSON.stringify({ tenant_a: "http://engine-a:47311" });

    const result = await assessEligibilityGated({ evaluateJs: mockEvaluateJs, application: sampleApp, tenantId: "tenant_b", stage: "underwriting" });

    assert.strictEqual(mockFetchCalled, false);
    assert.strictEqual(result.assessment.decision, "refer");
    assert.strictEqual(result.assessment.reasons[0].code, "ENGINE_UNAVAILABLE_FAIL_CLOSED");
  });

  test("Live Integration: queries actual running rules-service when available", async () => {
    // Check if the actual rules engine is running on port 47311
    try {
      const res = await originalFetch("http://127.0.0.1:47311/health");
      if (!res.ok) return; // skip if not running
    } catch {
      // service not running, skip live integration check
      return;
    }

    process.env.LOANOS_RULES_ENGINE = "active";
    process.env.LOANOS_RULES_ENGINE_URLS = JSON.stringify({ dev: "http://127.0.0.1:47311" });
    globalThis.fetch = originalFetch; // restore original fetch

    const result = await assessEligibilityGated({
      evaluateJs: mockEvaluateJs,
      application: sampleApp,
      tenantId: "dev",
      stage: "underwriting"
    });

    assert.ok(result.assessment.engine);
    assert.strictEqual(result.assessment.engine.decidedBy, "rules-engine");
    // Since sampleApp satisfies lending-eligibility, it should resolve to eligible or refer, but not fail closed
    assert.ok(["eligible", "refer"].includes(result.assessment.decision));
  });
});
