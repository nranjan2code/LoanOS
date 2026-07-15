import {
  activateTenantAiAgent, approveAiAgentPricingContract, authorizeAiAgentExecution, buildAiAgentGovernanceReport,
  completeAiAgentExecution, installTenantAiAgent, projectAiAgentMarketplace,
  proposeAiAgentPricingContract, recordAiAgentUsage, recordTenantAiAgentApproval, suspendTenantAiAgent
} from "../../../../packages/core/src/ai-agent-platform.js";
import { authorizeStaffedFeatureAction, projectTenantFeatureStaffing } from "../../../../packages/core/src/saas-identity-governance.js";
import { decidePlatformControlStaffing } from "../control-rules-engine.js";
import { decideAiAgentAction, decideAiModelConsumption } from "../rules-engine.js";

export async function routeAiAgentPlatform(context) {
  const { method, path, req, res, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;
  if (path !== "/ai" && !path.startsWith("/ai/")) return false;
  if (!hasTenantAdminRole(authContext, method === "GET" ? ["tenant_admin", "security_admin", "auditor", "operator"] : ["tenant_admin", "security_admin", "operator"])) {
    sendJson(res, 403, { error: { code: "ai_agent_platform_forbidden", message: "AI agent governance access is required." } }); return true;
  }
  let state = await store.load();
  const tenantId = authContext.tenantId;
  if (method === "GET" && path === "/ai/marketplace") { sendJson(res, 200, projectAiAgentMarketplace()); return true; }
  if (method === "GET" && path === "/ai/agents") { sendJson(res, 200, workspace(state.aiAgentPlatform, tenantId)); return true; }
  if (method === "GET" && path === "/ai/agents/governance-report") {
    const url = new URL(req.url, "http://localhost");
    try { sendJson(res, 200, buildAiAgentGovernanceReport(state.aiAgentPlatform, tenantId, { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined })); }
    catch (cause) { sendJson(res, cause.status ?? 422, { error: { code: cause.code ?? "ai_agent_report_invalid", message: cause.message } }); }
    return true;
  }
  if (method !== "POST") return false;
  const body = await readJson(req);
  const actor = authActor(authContext);
  try {
    let outcome;
    if (path === "/ai/pricing-contracts") outcome = proposeAiAgentPricingContract(state.aiAgentPlatform, { ...body, tenantId, proposedBy: actor });
    else if (match(path, "/ai/pricing-contracts/:id/approve")) outcome = approveAiAgentPricingContract(state.aiAgentPlatform, { ...body, contractId: idOf(path, 3), tenantId, approvedBy: actor });
    else if (path === "/ai/agents/installations") outcome = installTenantAiAgent(state.aiAgentPlatform, state.modelRegistry, { ...body, tenantId, proposedBy: actor });
    else if (match(path, "/ai/agents/installations/:id/approvals/:role")) {
      const role = idOf(path, 6);
      const local = authorizeStaffedFeatureAction(state, { tenantId, featureId: "FST-034", principalId: actor, requiredRoleId: role });
      if (local.outcome !== "allow") throw Object.assign(new Error("Authenticated principal does not hold the required AI governance role."), { code: "ai_agent_approval_role_forbidden", status: 403 });
      outcome = recordTenantAiAgentApproval(state.aiAgentPlatform, { ...body, installationId: idOf(path, 4), tenantId, role, principalId: actor, principalType: "human" });
    }
    else if (match(path, "/ai/agents/installations/:id/activate")) {
      const readiness = projectTenantFeatureStaffing(state, tenantId).features.find((item) => item.featureId === "FST-034");
      const controlDecision = await decidePlatformControlStaffing({ tenantId, requestId: `${req._loanosRequestId}:activation`, readiness, actorAuthorized: true });
      outcome = activateTenantAiAgent(state.aiAgentPlatform, state.modelRegistry, { ...body, installationId: idOf(path, 4), tenantId, controlDecision: { decision: controlDecision.decision, traceRef: controlDecision.trace_ref ?? controlDecision.traceRef ?? `fail_closed:${req._loanosRequestId}`, source: controlDecision.source, decisionKey: "guardrail.platform_control.staffing", rulesetHash: controlDecision?.ruleset?.platform_pack ?? null } });
    }
    else if (match(path, "/ai/agents/installations/:id/suspend")) outcome = suspendTenantAiAgent(state.aiAgentPlatform, { ...body, installationId: idOf(path, 4), tenantId, actor });
    else if (path === "/ai/agents/executions/authorize") {
      const installation = state.aiAgentPlatform?.installations?.[body.installationId];
      const modelDecision = await decideAiModelConsumption({ tenantId, requestId: `${req._loanosRequestId}:model`, modelId: installation?.modelId ?? "unknown", modelVersion: installation?.modelVersion ?? "unknown" });
      const actionDecision = await decideAiAgentAction({ tenantId, requestId: `${req._loanosRequestId}:action`, facts: {
        installation: { active: installation?.status === "active", tenant_match: installation?.tenantId === tenantId },
        action: { approved: installation?.allowedActions?.includes(body.action) === true, proposal_only: true, human_control_attempt: body.humanControlAttempt === true },
        data: { india_region: installation?.dataRegion === "ap-south-1" }, customer: { customer_facing: installation?.customerFacing === true, disclosure_present: Boolean(body.customerDisclosureRef) }
      }});
      outcome = authorizeAiAgentExecution(state.aiAgentPlatform, state.modelRegistry, { ...body, tenantId, modelConsumptionDecision: modelDecision, actionGuardrailDecision: actionDecision });
    }
    else if (match(path, "/ai/agents/executions/:id/complete")) outcome = completeAiAgentExecution(state.aiAgentPlatform, { ...body, executionId: idOf(path, 4), tenantId });
    else if (path === "/ai/agents/usage") outcome = recordAiAgentUsage(state.aiAgentPlatform, { ...body, tenantId });
    else return false;
    const next = { ...state, aiAgentPlatform: outcome.state };
    const record = outcome.record;
    const type = outcome.state.events.at(-1)?.type ?? "ai_agent.changed";
    await store.save(appendEvent(next, { type, actor, resourceId: resourceId(record), recordHash: record.recordHash, dataClass: "tenant_scoped" }));
    sendJson(res, path.endsWith("/activate") || path.endsWith("/suspend") || path.endsWith("/approve") || path.includes("/approvals/") ? 200 : 201, record);
    return true;
  } catch (cause) {
    sendJson(res, cause.status ?? 422, { error: { code: cause.code ?? "ai_agent_platform_invalid", message: cause.message }, details: cause.details }); return true;
  }
}

function workspace(platform = {}, tenantId) { const own = (values) => Object.values(values ?? {}).filter((x) => x.tenantId === tenantId); return { marketplace: projectAiAgentMarketplace(), pricingContracts: own(platform.pricingContracts), installations: own(platform.installations), executions: own(platform.executions), usage: own(platform.usageLedger) }; }
function resourceId(record) { return record.installationId ?? record.executionId ?? record.usageId ?? record.contractId; }
function match(path, pattern) { const a = path.split("/"), b = pattern.split("/"); return a.length === b.length && b.every((x, i) => x.startsWith(":") || x === a[i]); }
function idOf(path, index) { return decodeURIComponent(path.split("/")[index]); }
