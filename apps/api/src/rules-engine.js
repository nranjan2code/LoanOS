// Decision-engine gateway client (decision engine design, PH-3).
//
// Bridges the Node API to the per-tenant rules-service instance. Modes via
// LOANOS_RULES_ENGINE:
//   off    (default) JS eligibility only; engine never called.
//   shadow JS decides; the engine is also consulted and divergences are
//          logged for cutover sign-off. Engine failures never affect the
//          caller in shadow mode.
//   active engine decides; JS path retired for this decision.
//
// The JS eligibility call sites live in server.js; wire them through
// decideEligibilityWithEngine once the current server.js work lands. This
// module is deliberately self-contained until then.

const IST_OFFSET = "+05:30";

export function engineMode() {
  const mode = process.env.LOANOS_RULES_ENGINE ?? "off";
  return ["off", "shadow", "active"].includes(mode) ? mode : "off";
}

function engineBaseUrl(tenantId) {
  if (process.env.LOANOS_RULES_ENGINE_URLS) {
    let urls;
    try {
      urls = JSON.parse(process.env.LOANOS_RULES_ENGINE_URLS);
    } catch {
      throw new Error("LOANOS_RULES_ENGINE_URLS must be valid JSON");
    }
    if (typeof urls?.[tenantId] !== "string" || !urls[tenantId]) {
      throw new Error(`rules-engine: no isolated instance configured for tenant ${tenantId}`);
    }
    return urls[tenantId].replace(/\/$/, "");
  }
  return (process.env.LOANOS_RULES_ENGINE_URL ?? "http://127.0.0.1:47311").replace(/\/$/, "");
}

const money = (value) => (Number.isFinite(value) ? value.toFixed(2) : undefined);

// Maps the JS application shape (evaluateEligibility input) to the engine's
// facts contract: money and ratios as strings (INV-6), snake_case paths
// matching rules/fixtures/lending-eligibility.json bindings.
export function buildEligibilityFacts(application) {
  const product = application.product ?? {};
  const eligibility = product.eligibility ?? {};
  const profile = application.economicProfile ?? {};
  const borrower = application.borrower ?? {};
  const bureau = application.bureauReport;
  return {
    product: {
      requested_amount: money(product.requestedAmount),
      min_amount: money(product.minAmount),
      max_amount: money(product.maxAmount),
      requested_tenor_months: product.requestedTenorMonths,
      default_tenor_months: product.defaultTenorMonths,
      min_tenor_months: product.minTenorMonths,
      max_tenor_months: product.maxTenorMonths,
      annual_interest_rate_bps: product.annualInterestRateBps,
      apr_bps: product.aprBps,
      eligibility: {
        min_age_years: eligibility.minAgeYears,
        max_age_years: eligibility.maxAgeYears,
        min_monthly_income: money(eligibility.minMonthlyIncome),
        max_foir: Number.isFinite(eligibility.maxFoir) ? String(eligibility.maxFoir) : undefined
      }
    },
    borrower: {
      date_of_birth: borrower.dateOfBirth,
      age_years: borrower.ageYears
    },
    economic_profile: {
      monthly_income: money(profile.monthlyIncome),
      existing_monthly_obligations: money(profile.existingMonthlyObligations)
    },
    bureau_report: bureau
      ? { score: bureau.score, default_accounts: bureau.defaultAccounts }
      : undefined
  };
}

// Calls the tenant's engine instance. Facts derived from a credit bureau
// model must be provenance-tagged (DEC-4) so the engine's kill-switch gate
// applies to them.
export async function decideEligibilityWithEngine({
  tenantId,
  requestId,
  application,
  now = new Date(),
  channel = "api",
  caller = "workflow:underwriting",
  bureauModelId = "cibil_gateway",
  bureauModelVersion = "1",
  // INV-10: set to "tenant_ops" or "borrower" for agent/borrower-facing
  // callers; the instance strips reasons above this level from the response
  // (the audit record always keeps the full set).
  audience = undefined
}) {
  const factProvenance = application.bureauReport
    ? {
        "/bureau_report/score": {
          source: "model",
          model_id: bureauModelId,
          model_version: bureauModelVersion
        }
      }
    : {};
  const request = {
    request_id: requestId,
    tenant_id: tenantId,
    decision_key: "lending.eligibility",
    effective_at: toIstIso(now),
    facts: buildEligibilityFacts(application),
    fact_provenance: factProvenance,
    context: {
      channel,
      caller,
      audience,
      // Placeholder only: the instance ignores caller-supplied kill-switch
      // state and stamps its own (design section 7).
      kill_switch: {
        as_of: "1970-01-01T00:00:00+05:30",
        global: { active: false }
      }
    }
  };
  const response = await fetch(`${engineBaseUrl(tenantId)}/v1/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    throw new Error(`rules-engine: HTTP ${response.status}`);
  }
  return response.json();
}

// The gated eligibility assessment used by server.js call sites.
//
// Always runs the JS evaluator first (its assessment payload shape feeds the
// downstream workflow), then per LOANOS_RULES_ENGINE:
//   off    return the JS result untouched;
//   shadow consult the engine, log divergences, attach an engineShadow
//          record to the assessment; engine failure NEVER affects the caller;
//   active the engine's decision overrides the JS decision (JS metrics are
//          kept for the payload); engine failure fails CLOSED to "refer"
//          (INV-5 — the engine being unreachable is not an approval).
export async function assessEligibilityGated({ evaluateJs, application, tenantId, stage }) {
  const jsResult = evaluateJs(application);
  const mode = engineMode();
  if (mode === "off") {
    return jsResult;
  }
  const requestId = `req_${stage}_${globalThis.crypto.randomUUID()}`;
  try {
    const engineResponse = await decideEligibilityWithEngine({
      tenantId,
      requestId,
      application,
      caller: `workflow:${stage}`
    });
    if (mode === "shadow") {
      const comparison = shadowCompareEligibility(jsResult.assessment, engineResponse);
      if (comparison.diverged) {
        console.warn(
          `[rules-engine shadow] DIVERGENCE stage=${stage} request=${requestId} js=${comparison.jsDecision} engine=${comparison.engineDecision} trace=${comparison.traceRef}`
        );
      }
      return {
        ...jsResult,
        assessment: {
          ...jsResult.assessment,
          engineShadow: {
            decision: engineResponse.decision,
            diverged: comparison.diverged,
            ruleset: engineResponse.ruleset,
            traceRef: engineResponse.trace_ref
          }
        }
      };
    }
    // active
    return {
      ...jsResult,
      assessment: {
        ...jsResult.assessment,
        decision: engineResponse.decision,
        engine: {
          decidedBy: "rules-engine",
          reasons: engineResponse.reasons,
          ruleset: engineResponse.ruleset,
          traceRef: engineResponse.trace_ref,
          instance: engineResponse.engine
        }
      }
    };
  } catch (err) {
    if (mode === "active") {
      console.error(
        `[rules-engine] FAIL-CLOSED stage=${stage} request=${requestId}: ${err.message}`
      );
      return {
        ...jsResult,
        assessment: {
          ...jsResult.assessment,
          decision: "refer",
          engine: { decidedBy: "rules-engine", error: "engine_unavailable_fail_closed" }
        }
      };
    }
    console.warn(`[rules-engine shadow] engine unreachable (caller unaffected): ${err.message}`);
    return jsResult;
  }
}

// Shadow-mode comparison record: log these and require a clean window before
// flipping LOANOS_RULES_ENGINE to "active" (PH-3 acceptance: JS path is
// retired only after shadow sign-off).
export function shadowCompareEligibility(jsAssessment, engineResponse) {
  const jsDecision = jsAssessment?.decision ?? null;
  const engineDecision = engineResponse?.decision ?? null;
  return {
    diverged: jsDecision !== engineDecision,
    jsDecision,
    engineDecision,
    engineRuleset: engineResponse?.ruleset ?? null,
    traceRef: engineResponse?.trace_ref ?? null
  };
}

function toIstIso(date) {
  const istMillis = date.getTime() + (5 * 60 + 30) * 60 * 1000;
  const iso = new Date(istMillis).toISOString().replace("Z", IST_OFFSET);
  return iso;
}
