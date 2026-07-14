// Platform-control policy gateway. This is deliberately separate from the
// lending/business rules gateway: a tenant's access and staffing controls may
// never share a runtime, URL, instance identity, bundle or operator boundary
// with its lending decisions.

const MODES = new Set(["off", "shadow", "active"]);

export function controlEngineMode(env = process.env) {
  const mode = env.LOANOS_CONTROL_RULES_ENGINE ?? "off";
  return MODES.has(mode) ? mode : "off";
}

export function buildPlatformControlStaffingFacts(readiness, {
  actorAuthorized,
  agentAttemptsHumanControl = false,
  agentGuardrailAllowed = true
} = {}) {
  return {
    staffing: {
      feature_configured: readiness?.configured === true && readiness?.requestedStatus === "enabled",
      missing_role_sets: readiness?.missingRoleSets?.length ?? 0,
      independence_failures: readiness?.independentPairs?.filter((item) => !item.independent).length ?? 0,
      sod_violations: readiness?.sodViolations?.length ?? 0,
      active_human_principals: readiness?.distinctPrincipalIds?.length ?? 0,
      minimum_distinct_principals: readiness?.minimumDistinctPrincipals ?? 1,
      open_operational_pauses: readiness?.operationalPauses?.length ?? 0
    },
    action: {
      actor_authorized: actorAuthorized === true,
      agent_attempts_human_control: agentAttemptsHumanControl === true,
      agent_guardrail_allowed: agentGuardrailAllowed === true
    }
  };
}

export async function decidePlatformControlStaffing({
  tenantId,
  requestId,
  readiness,
  actorAuthorized,
  agentAttemptsHumanControl = false,
  agentGuardrailAllowed = true,
  now = new Date(),
  env = process.env,
  fetchImpl = fetch
}) {
  const localDecision = readiness?.ready === true && actorAuthorized === true && !agentAttemptsHumanControl && agentGuardrailAllowed
    ? "allow"
    : "deny";
  const mode = controlEngineMode(env);
  if (mode === "off") return { decision: localDecision, source: "local_reference", mode, failClosed: localDecision !== "allow" };

  try {
    const route = controlRoute(tenantId, env);
    assertSeparateFromBusinessEngine(tenantId, route.url, env);
    const request = {
      request_id: requestId,
      tenant_id: tenantId,
      decision_key: "guardrail.platform_control.staffing",
      effective_at: toIstIso(now),
      facts: buildPlatformControlStaffingFacts(readiness, { actorAuthorized, agentAttemptsHumanControl, agentGuardrailAllowed }),
      context: { channel: "platform-control", caller: "identity-governance", audience: "internal" }
    };
    const response = await fetchImpl(`${route.url}/v1/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    });
    if (!response.ok) throw new Error(`control-rules-engine: HTTP ${response.status}`);
    const result = await response.json();
    if (result?.engine?.instance_id !== route.instanceId) throw new Error("control-rules-engine: instance identity mismatch");
    if (!String(result.engine.instance_id).startsWith("ctrl-")) throw new Error("control-rules-engine: control instance namespace required");
    if (route.tenantBundleHash && result?.ruleset?.tenant_pack !== route.tenantBundleHash) throw new Error("control-rules-engine: tenant bundle mismatch");
    if (!['allow', 'deny', 'require_human'].includes(result?.decision)) throw new Error("control-rules-engine: invalid decision");
    if (mode === "shadow") {
      return { decision: localDecision, source: "local_reference", mode, shadow: { decision: result.decision, diverged: result.decision !== localDecision, traceRef: result.trace_ref, instance: result.engine } };
    }
    return { ...result, source: "isolated_control_engine", mode, failClosed: result.decision !== "allow" };
  } catch (error) {
    if (mode === "active") return { decision: "deny", source: "isolated_control_engine", mode, failClosed: true, error: "control_engine_unavailable_or_untrusted" };
    return { decision: localDecision, source: "local_reference", mode, shadow: { error: error.message } };
  }
}

function controlRoute(tenantId, env) {
  let routes;
  try { routes = JSON.parse(env.LOANOS_CONTROL_RULES_ENGINE_URLS ?? "{}"); }
  catch { throw new Error("LOANOS_CONTROL_RULES_ENGINE_URLS must be valid JSON"); }
  const configured = routes?.[tenantId];
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) throw new Error(`control-rules-engine: no isolated control instance configured for tenant ${tenantId}`);
  if (typeof configured.url !== "string" || !configured.url || typeof configured.instanceId !== "string" || !configured.instanceId) throw new Error("control-rules-engine: url and instanceId are required");
  return { url: configured.url.replace(/\/$/, ""), instanceId: configured.instanceId, tenantBundleHash: configured.tenantBundleHash ?? null };
}

function assertSeparateFromBusinessEngine(tenantId, controlUrl, env) {
  let business = {};
  try { business = JSON.parse(env.LOANOS_RULES_ENGINE_URLS ?? "{}"); } catch { /* business validation belongs to its gateway */ }
  const businessUrl = typeof business?.[tenantId] === "string" ? business[tenantId] : business?.[tenantId]?.url;
  if (businessUrl && businessUrl.replace(/\/$/, "") === controlUrl) throw new Error("control-rules-engine: control and business instances must be physically separate");
}

function toIstIso(date) {
  const shifted = new Date(date.getTime() + 330 * 60 * 1000).toISOString();
  return shifted.replace("Z", "+05:30");
}
