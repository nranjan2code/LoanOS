// Decision-engine gateway client (decision engine design, PH-3).
//
// This is the LENDING/BUSINESS gateway to the Rust decision engine (`rules/`)
// — one of the two deliberately isolated gateways described in AGENTS.md and
// ADR 0005. Its sibling, `control-rules-engine.js`, gates identity/staffing
// authority instead; per ADR 0005 the two may never share a runtime, URL,
// bundle, instance identity, or operator boundary, and this file does not
// import from or reference that one. This module owns eligibility decisions
// and the AI/agent guardrail decisions (`guardrail.model_consumption`,
// `guardrail.agent_action`) — it does not own the engine itself (see
// `rules/`) or model lifecycle/kill-switch state (see
// `packages/core/src/ai/model-governance.js`); it only calls out to whichever of
// those the tenant's engine instance enforces.
//
// Bridges the Node API to the per-tenant rules-service instance. Modes via
// LOANOS_RULES_ENGINE:
//   off    (default) JS eligibility only; engine never called.
//   shadow JS decides; the engine is also consulted and divergences are
//          logged for cutover sign-off. Engine failures never affect the
//          caller in shadow mode.
//   active engine decides; JS path retired for this decision.
//
// Fail-closed (INV-5) is the thread running through every function here: an
// unreachable or untrusted engine in "active" mode never falls back to a
// permissive local decision — eligibility falls back to "refer" and
// guardrail checks fall back to "deny".
//
// The JS eligibility call sites live in server.js; wire them through
// decideEligibilityWithEngine once the current server.js work lands. This
// module is deliberately self-contained until then.

const IST_OFFSET = "+05:30";

/**
 * Read the active lending-engine rollout mode from the environment, so every
 * call site (and shadow/active behavior below) agrees on a single mode per
 * process. Falls back to the safe default ("off") for any unrecognized value
 * rather than throwing, since this is read on every decision call site.
 * @returns {"off"|"shadow"|"active"}
 */
export function engineMode() {
  const mode = process.env.LOANOS_RULES_ENGINE ?? "off";
  return ["off", "shadow", "active"].includes(mode) ? mode : "off";
}

// Resolves a tenant's isolated business-engine URL from LOANOS_RULES_ENGINE_URLS
// (JSON map of tenantId -> base URL). Throws rather than falling back to a
// shared/default URL — ADR 0003 requires one engine runtime per tenant, so an
// unconfigured tenant must fail rather than silently borrow another's instance.
function engineBaseUrl(tenantId) {
  let urls;
  try {
    urls = JSON.parse(process.env.LOANOS_RULES_ENGINE_URLS ?? "{}");
  } catch {
    throw new Error("LOANOS_RULES_ENGINE_URLS must be valid JSON");
  }
  if (typeof urls?.[tenantId] !== "string" || !urls[tenantId]) {
    throw new Error(`rules-engine: no isolated instance configured for tenant ${tenantId}`);
  }
  return urls[tenantId].replace(/\/$/, "");
}

// Money crosses the JS/engine boundary as a fixed-2dp string, never a float
// (INV-6 applies engine-side; this is where a JS number is converted for
// transport). `undefined` fields are dropped by JSON.stringify, so an absent
// value is simply omitted from facts rather than sent as "NaN" or null.
const money = (value) => (Number.isFinite(value) ? value.toFixed(2) : undefined);

/**
 * Maps the JS application shape (as passed to the local `evaluateEligibility`)
 * to the engine's facts contract: money and ratios as strings (INV-6),
 * snake_case paths matching `rules/fixtures/lending-eligibility.json`
 * bindings. Only a JS-shape -> facts-shape translation — carries no policy
 * logic of its own.
 * @param {object} application - application object as built by the JS
 *   eligibility path (`product`, `borrower`, `economicProfile`, `bureauReport`).
 * @returns {object} facts payload suitable for the engine's `/v1/decide` request.
 */
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

/**
 * Call the tenant's isolated engine instance for a `lending.eligibility`
 * decision. Facts derived from a credit bureau model must be
 * provenance-tagged (DEC-4) so the engine's kill-switch gate applies to
 * them — see `fact_provenance` below, which is only populated when a
 * `bureauReport` is present.
 * @param {object} params
 * @param {string} params.tenantId - selects the isolated engine instance (ADR 0003).
 * @param {string} params.requestId - caller-supplied idempotency/trace key.
 * @param {object} params.application - JS application shape; converted via `buildEligibilityFacts`.
 * @param {Date} [params.now] - clock override; converted to IST per the engine's wall-clock contract.
 * @param {string} [params.channel] - originating channel, for context/audit only.
 * @param {string} [params.caller] - logical caller identity, for context/audit only.
 * @param {string} [params.bureauModelId] - provenance tag for the bureau score fact.
 * @param {string} [params.bureauModelVersion] - provenance tag for the bureau score fact.
 * @param {string} [params.audience] - INV-10: set to "tenant_ops" or "borrower" for
 *   agent/borrower-facing callers; the instance strips reasons above this
 *   level from the response (the audit record always keeps the full set).
 * @returns {Promise<object>} the engine's raw `/v1/decide` response (decision, reasons, outputs, ruleset, trace_ref, ...).
 * @throws {Error} if the HTTP call fails or returns a non-2xx status; callers
 *   (e.g. `assessEligibilityGated`) are responsible for the fail-closed behavior.
 */
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

/**
 * Guardrail gate for AI model output consumption (`guardrail.model_consumption`).
 * Production AI workers must pass the platform guardrail pack even when the
 * general lending engine is otherwise in off/shadow migration mode — this
 * function ignores `engineMode()` and always calls the engine. There is
 * deliberately no permissive local fallback: an unreachable tenant engine, a
 * malformed response, or a decision value outside `allow/deny/require_human`
 * is treated as a denial to consume the model's output (INV-5, DEC-4).
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.requestId
 * @param {string} params.modelId - provenance-tagged onto `/agent_output`.
 * @param {string|number} params.modelVersion - provenance-tagged onto `/agent_output`.
 * @param {Date} [params.now]
 * @returns {Promise<{decision: "allow"|"deny"|"require_human", traceRef: string, source: string, decisionKey: string, rulesetHash: string|null, failClosed?: boolean, error?: string}>}
 *   on any failure, returns a synthetic fail-closed `deny` result (never throws).
 */
export async function decideAiModelConsumption({ tenantId, requestId, modelId, modelVersion, now = new Date() }) {
  const request = {
    request_id: requestId,
    tenant_id: tenantId,
    decision_key: "guardrail.model_consumption",
    effective_at: toIstIso(now),
    facts: {},
    fact_provenance: {
      "/agent_output": { source: "model", model_id: modelId, model_version: String(modelVersion) }
    },
    context: { channel: "agent-runtime", caller: "workflow:ai-agent", audience: "internal" }
  };
  try {
    const response = await fetch(`${engineBaseUrl(tenantId)}/v1/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(Number(process.env.LOANOS_RULES_ENGINE_TIMEOUT_MS ?? 3000))
    });
    if (!response.ok) throw new Error(`rules-engine: HTTP ${response.status}`);
    const decision = await response.json();
    if (!['allow', 'deny', 'require_human'].includes(decision?.decision) || !decision?.trace_ref) throw new Error("rules-engine: invalid guardrail response");
    return { decision: decision.decision, traceRef: decision.trace_ref, source: "isolated_business_engine", decisionKey: request.decision_key, rulesetHash: decision?.ruleset?.platform_pack ?? null };
  } catch (error) {
    return { decision: "deny", traceRef: `fail_closed:${requestId}`, source: "isolated_business_engine", decisionKey: request.decision_key, rulesetHash: null, failClosed: true, error: "business_engine_unavailable_or_untrusted" };
  }
}

/**
 * Guardrail gate for an autonomous agent's proposed action
 * (`guardrail.agent_action`, e.g. a release proposal or rollback request —
 * see AGENTS.md "AI cannot approve releases"). Same fail-closed contract as
 * `decideAiModelConsumption`: any engine failure or invalid response yields a
 * synthetic `deny`, never a permissive default.
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.requestId
 * @param {object} params.facts - decision-key-specific facts for the engine's `guardrail.agent_action` ruleset.
 * @param {Date} [params.now]
 * @returns {Promise<{decision: "allow"|"deny"|"require_human", traceRef: string, source: string, decisionKey: string, rulesetHash: string|null, failClosed?: boolean, error?: string}>}
 */
export async function decideAiAgentAction({ tenantId, requestId, facts, now = new Date() }) {
  return decideAiGuardrail({ tenantId, requestId, decisionKey: "guardrail.agent_action", facts, now });
}

const SPECIALIZED_AI_GUARDRAILS = new Set([
  "guardrail.data_access",
  "guardrail.outbound_communication",
  "guardrail.underwriting_influence",
  "guardrail.case_mutation"
]);

// ADR 0010: a tool call-site supplies the exact decision key declared by the
// versioned tool catalogue. Unknown keys are denied locally, and every engine
// error or malformed response becomes a synthetic denial rather than a throw
// that a caller might accidentally ignore.
export async function decideAiSpecializedGuardrail({ tenantId, requestId, decisionKey, facts, now = new Date() }) {
  if (!SPECIALIZED_AI_GUARDRAILS.has(decisionKey)) {
    return { decision: "deny", traceRef: `fail_closed:${requestId ?? "missing"}`, source: "isolated_business_engine", decisionKey: decisionKey ?? "unknown", rulesetHash: null, failClosed: true, error: "specialized_guardrail_unregistered" };
  }
  return decideAiGuardrail({ tenantId, requestId, decisionKey, facts, now });
}

async function decideAiGuardrail({ tenantId, requestId, decisionKey, facts, now }) {
  const request = { request_id: requestId, tenant_id: tenantId, decision_key: decisionKey, effective_at: toIstIso(now), facts, fact_provenance: {}, context: { channel: "agent-runtime", caller: "workflow:ai-agent", audience: "internal" } };
  try {
    const response = await fetch(`${engineBaseUrl(tenantId)}/v1/decide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(Number(process.env.LOANOS_RULES_ENGINE_TIMEOUT_MS ?? 3000)) });
    if (!response.ok) throw new Error(`rules-engine: HTTP ${response.status}`);
    const decision = await response.json();
    if (!['allow', 'deny', 'require_human'].includes(decision?.decision) || !decision?.trace_ref) throw new Error("rules-engine: invalid guardrail response");
    return { decision: decision.decision, traceRef: decision.trace_ref, source: "isolated_business_engine", decisionKey: request.decision_key, rulesetHash: decision?.ruleset?.platform_pack ?? null };
  } catch {
    return { decision: "deny", traceRef: `fail_closed:${requestId}`, source: "isolated_business_engine", decisionKey: request.decision_key, rulesetHash: null, failClosed: true, error: "business_engine_unavailable_or_untrusted" };
  }
}

// The gated eligibility assessment used by server.js call sites.
//
// Always runs the JS evaluator first in off/shadow mode. In active mode the
// engine is authoritative for the decision and its reason lineage; local
// metrics remain only as non-authoritative operational context.
//   off    return the JS result untouched;
//   shadow consult the engine, log divergences, attach an engineShadow
//          record to the assessment; engine failure NEVER affects the caller;
//   active the engine's decision, findings, summary, outputs and signed
//          lineage are persisted; engine failure fails CLOSED to "refer"
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
    // Active mode is a greenfield cutover: do not retain JavaScript findings
    // as the recorded decision rationale when the Rust engine is decisive.
    const reasons = engineReasonsToFindings(engineResponse.reasons);
    return {
      ...jsResult,
      assessment: {
        ...jsResult.assessment,
        decision: engineResponse.decision,
        reasons,
        summary: summarizeEngineReasons(reasons),
        engine: {
          decidedBy: "rules-engine",
          outputs: engineResponse.outputs,
          ruleset: engineResponse.ruleset,
          traceRef: engineResponse.trace_ref,
          instance: engineResponse.engine,
          evaluatedAt: engineResponse.evaluated_at
        }
      },
      findings: reasons,
      summary: summarizeEngineReasons(reasons)
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
          reasons: [engineUnavailableFinding()],
          summary: { status: "review", errorCount: 0, warningCount: 1 },
          engine: { decidedBy: "rules-engine", error: "engine_unavailable_fail_closed" }
        },
        findings: [engineUnavailableFinding()],
        summary: { status: "review", errorCount: 0, warningCount: 1 }
      };
    }
    console.warn(`[rules-engine shadow] engine unreachable (caller unaffected): ${err.message}`);
    return jsResult;
  }
}

function engineReasonsToFindings(reasons) {
  return (Array.isArray(reasons) ? reasons : []).map((reason) => ({
    severity: reason.severity === "error" ? "error" : reason.severity === "warn" ? "warning" : "info",
    controlId: reason.regulation ?? "PLATFORM",
    code: reason.code ?? "ENGINE_REASON",
    message: reason.message ?? "Decision-engine finding.",
    path: reason.path || null,
    audience: reason.audience ?? "internal"
  }));
}

function summarizeEngineReasons(reasons) {
  const errors = reasons.filter((reason) => reason.severity === "error").length;
  const warnings = reasons.filter((reason) => reason.severity === "warning").length;
  return {
    status: errors > 0 ? "blocked" : warnings > 0 ? "review" : "ready",
    errorCount: errors,
    warningCount: warnings
  };
}

function engineUnavailableFinding() {
  return {
    severity: "warning",
    controlId: "PLATFORM",
    code: "ENGINE_UNAVAILABLE_FAIL_CLOSED",
    message: "Automated decisioning is unavailable; the application requires manual review.",
    path: null,
    audience: "internal"
  };
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
