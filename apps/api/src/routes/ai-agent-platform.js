import {
  activateTenantAiAgent, approveAiAgentPricingContract, authorizeAiAgentExecution, buildAiAgentGovernanceReport,
  completeAiAgentExecution, installTenantAiAgent, projectAiAgentMarketplace,
  proposeAiAgentPricingContract, recordAiAgentProposalReview, recordAiAgentUsage, recordTenantAiAgentApproval,
  suspendTenantAiAgent, approveAiAgentUsageBudget, proposeAiAgentUsageBudget, reserveAiAgentUsageBudget,
  approveAiAgentInvoice, proposeAiAgentInvoice
} from "@loanos/core/ai/ai-agent-platform.js";
import { invokeDigitalWorkerProvider } from "@loanos/core/ai/digital-worker-provider.js";
import { createDemoDigitalWorkerProvider } from "@loanos/core/ai/digital-worker-demo-provider.js";
import { approveAgentKnowledgePack, approveAgentMemoryStore, approveAgentProviderEvidence, approveAgentRollback, assessAgentProductionAdmission, compareAgentInstallations, containExpiredAgentKnowledge, createAgentKnowledgePack, createAgentMemoryStore, createAgentTestSuite, createAgentWorkflowDraft, projectAgentConfigurationExport, projectAgentOperationsQueue, proposeAgentProviderEvidence, proposeAgentRollback, publishAgentVersion, retireAgentInstallation, runAgentTestSuite } from "@loanos/core/ai/agent-studio-governance.js";
import { authorizeStaffedFeatureAction, projectTenantFeatureStaffing } from "@loanos/core/identity/saas-identity-governance.js";
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
  if (method === "GET" && path === "/ai/agents") { sendJson(res, 200, workspace(state, tenantId)); return true; }
  if (method === "GET" && path === "/ai/agents/operations-queue") { sendJson(res, 200, { items: projectAgentOperationsQueue(state.aiAgentPlatform, tenantId) }); return true; }
  if (method === "GET" && match(path, "/ai/agents/installations/:id/production-admission")) { try { sendJson(res, 200, assessAgentProductionAdmission(state.aiAgentPlatform, { tenantId, installationId: idOf(path, 4) }, new Date(), state.modelRegistry)); } catch (cause) { sendJson(res, cause.status ?? 422, { error: { code: cause.code, message: cause.message } }); } return true; }
  if (method === "GET" && match(path, "/ai/agents/installations/:id/export")) { try { sendJson(res, 200, projectAgentConfigurationExport(state.aiAgentPlatform, { tenantId, installationId: idOf(path, 4) })); } catch (cause) { sendJson(res, cause.status ?? 422, { error: { code: cause.code, message: cause.message } }); } return true; }
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
    else if (path === "/ai/usage-budgets") outcome = proposeAiAgentUsageBudget(state.aiAgentPlatform, { ...body, tenantId, proposedBy: actor });
    else if (match(path, "/ai/usage-budgets/:id/approve")) outcome = approveAiAgentUsageBudget(state.aiAgentPlatform, { ...body, budgetId: idOf(path, 3), tenantId, approvedBy: actor });
    else if (path === "/ai/usage-budgets/reservations") outcome = reserveAiAgentUsageBudget(state.aiAgentPlatform, { ...body, tenantId });
    else if (path === "/ai/invoices") outcome = proposeAiAgentInvoice(state.aiAgentPlatform, { ...body, tenantId, proposedBy: actor });
    else if (match(path, "/ai/invoices/:id/approve")) outcome = approveAiAgentInvoice(state.aiAgentPlatform, { ...body, invoiceId: idOf(path, 3), tenantId, approvedBy: actor });
    else if (path === "/ai/agents/installations") outcome = installTenantAiAgent(state.aiAgentPlatform, state.modelRegistry, { ...body, tenantId, proposedBy: actor, allowedProductTypes: enabledProductTypes(state, tenantId) });
    else if (path === "/ai/agents/knowledge-packs") outcome = createAgentKnowledgePack(state.aiAgentPlatform, { ...body, tenantId, proposedBy: actor });
    else if (match(path, "/ai/agents/knowledge-packs/:id/approve")) outcome = approveAgentKnowledgePack(state.aiAgentPlatform, { ...body, packId: idOf(path, 4), tenantId, approvedBy: actor });
    else if (path === "/ai/agents/knowledge-packs/contain-expired") outcome = containExpiredAgentKnowledge(state.aiAgentPlatform, { tenantId, actor });
    else if (path === "/ai/agents/memory-stores") outcome = createAgentMemoryStore(state.aiAgentPlatform, { ...body, tenantId, proposedBy: actor });
    else if (match(path, "/ai/agents/memory-stores/:id/approve")) outcome = approveAgentMemoryStore(state.aiAgentPlatform, { ...body, memoryStoreId: idOf(path, 4), tenantId, approvedBy: actor });
    else if (path === "/ai/agents/provider-evidence") outcome = proposeAgentProviderEvidence(state.aiAgentPlatform, { ...body, tenantId, proposedBy: actor });
    else if (match(path, "/ai/agents/provider-evidence/:id/approve")) outcome = approveAgentProviderEvidence(state.aiAgentPlatform, { ...body, evidenceId: idOf(path, 4), tenantId, approvedBy: actor });
    else if (path === "/ai/agents/workflows") outcome = createAgentWorkflowDraft(state.aiAgentPlatform, { ...body, tenantId, proposedBy: actor, allowedProductTypes: enabledProductTypes(state, tenantId) });
    else if (path === "/ai/agents/test-suites") outcome = createAgentTestSuite(state.aiAgentPlatform, { ...body, tenantId, proposedBy: actor });
    // The harness derives every observed outcome server-side; client-supplied
    // results are never read, so a browser cannot fabricate a passing gate.
    else if (match(path, "/ai/agents/test-suites/:id/runs")) outcome = runAgentTestSuite(state.aiAgentPlatform, { runId: body.runId, suiteId: idOf(path, 4), tenantId, runBy: actor });
    else if (path === "/ai/agents/versions") outcome = publishAgentVersion(state.aiAgentPlatform, { ...body, tenantId, publishedBy: actor });
    else if (path === "/ai/agents/rollbacks") outcome = proposeAgentRollback(state.aiAgentPlatform, { ...body, tenantId, proposedBy: actor });
    else if (match(path, "/ai/agents/rollbacks/:id/approve")) outcome = approveAgentRollback(state.aiAgentPlatform, { ...body, rollbackId: idOf(path, 4), tenantId, approvedBy: actor });
    else if (path === "/ai/agents/compare") outcome = { state: state.aiAgentPlatform, record: compareAgentInstallations(state.aiAgentPlatform, { ...body, tenantId }) };
    else if (match(path, "/ai/agents/installations/:id/retire")) outcome = retireAgentInstallation(state.aiAgentPlatform, { ...body, tenantId, installationId: idOf(path, 4), actor });
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
    else if (match(path, "/ai/agents/executions/:id/demo-run")) {
      outcome = await runDemoExecution(state, tenantId, idOf(path, 4), body.scenario);
    }
    else if (match(path, "/ai/agents/executions/:id/complete")) outcome = completeAiAgentExecution(state.aiAgentPlatform, { ...body, executionId: idOf(path, 4), tenantId });
    // Reviewer identity binds to the authenticated principal; the disposition
    // and reference come from the body, the reviewer never does.
    else if (match(path, "/ai/agents/executions/:id/human-review")) outcome = recordAiAgentProposalReview(state.aiAgentPlatform, { disposition: body.disposition, reviewRef: body.reviewRef, executionId: idOf(path, 4), tenantId, reviewerId: actor, reviewerType: "human" });
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

function workspace(state = {}, tenantId) { const platform = state.aiAgentPlatform ?? {}; const own = (values) => Object.values(values ?? {}).filter((x) => x.tenantId === tenantId); const installations = own(platform.installations); return { marketplace: projectAiAgentMarketplace(), enabledProductTypes: enabledProductTypes(state, tenantId), pricingContracts: own(platform.pricingContracts), usageBudgets: own(platform.usageBudgets), budgetReservations: own(platform.budgetReservations), invoices: own(platform.invoices), installations, knowledgePacks: own(platform.knowledgePacks), memoryStores: own(platform.memoryStores), providerEvidence: own(platform.providerEvidence), productionAdmission: installations.map((item) => assessAgentProductionAdmission(platform, { tenantId, installationId: item.installationId }, new Date(), state.modelRegistry)), workflowDrafts: own(platform.workflowDrafts), testSuites: own(platform.testSuites), testRuns: own(platform.testRuns), agentVersions: own(platform.agentVersions), rollbackRequests: own(platform.rollbackRequests), operationsQueue: projectAgentOperationsQueue(platform, tenantId), executions: own(platform.executions), usage: own(platform.usageLedger) }; }
function enabledProductTypes(state, tenantId, now = new Date()) { return [...new Set(Object.values(state.tenantProductSubscriptions ?? {}).filter((item) => item.tenantId === tenantId && item.status === "active" && Date.parse(item.effectiveFrom) <= now.getTime() && Date.parse(item.validUntil) > now.getTime()).flatMap((item) => item.productTypes ?? []))].sort(); }
function resourceId(record) { return record.versionId ?? record.memoryStoreId ?? record.containmentId ?? record.rollbackId ?? record.runId ?? record.installationId ?? record.workflowId ?? record.packId ?? record.suiteId ?? record.executionId ?? record.usageId ?? record.contractId ?? record.budgetId ?? record.reservationId ?? record.invoiceId ?? record.toInstallationId; }
function match(path, pattern) { const a = path.split("/"), b = pattern.split("/"); return a.length === b.length && b.every((x, i) => x.startsWith(":") || x === a[i]); }
function idOf(path, index) { return decodeURIComponent(path.split("/")[index]); }

async function runDemoExecution(state, tenantId, executionId, scenario = "standard") {
  if (process.env.LOANOS_AI_DEMO_MODE !== "true") throw Object.assign(new Error("AI demo mode is disabled."), { code: "ai_agent_demo_mode_disabled", status: 403 });
  const execution = state.aiAgentPlatform?.executions?.[executionId];
  if (!execution || execution.tenantId !== tenantId) throw Object.assign(new Error("A same-tenant authorized execution is required."), { code: "ai_agent_execution_missing", status: 404 });
  if (execution.status !== "authorized") throw Object.assign(new Error("Only an authorized execution may run in demo mode."), { code: "ai_agent_execution_not_authorized", status: 409 });
  const installation = state.aiAgentPlatform.installations?.[execution.installationId];
  if (!installation || installation.tenantId !== tenantId) throw Object.assign(new Error("A same-tenant installation is required."), { code: "ai_agent_installation_missing", status: 404 });
  const provider = createDemoDigitalWorkerProvider({ scenario });
  const runtime = await invokeDigitalWorkerProvider(provider, {
    requestId: `demo:${executionId}`, tenantId, executionId, installationId: installation.installationId,
    action: execution.action, purpose: execution.purpose, inputRef: execution.inputRef, inputHash: execution.inputHash,
    promptHash: execution.promptHash, region: installation.dataRegion, modelId: execution.modelId, modelVersion: execution.modelVersion,
    providerAllowlist: [provider.id], modelAllowlist: [{ modelId: execution.modelId, version: execution.modelVersion }],
    authorization: { modelConsumptionTraceRef: execution.modelConsumptionDecision.traceRef, actionGuardrailTraceRef: execution.actionGuardrailDecision.traceRef, proposalOnly: true },
    outputSchema: demoOutputSchema()
  });
  const completed = completeAiAgentExecution(state.aiAgentPlatform, { executionId, tenantId, outputRef: `demo://${executionId}/${scenario}`, outputHash: runtime.evidence.proposalChecksum, outcome: "proposal_created", citations: [] }).state;
  const usage = recordAiAgentUsage(completed, { usageId: `demo-usage:${executionId}`, executionId, tenantId, ...runtime.evidence.usage }).state;
  const usageRecord = usage.usageLedger[`demo-usage:${executionId}`];
  return { state: usage, record: { ...usageRecord, demo: { simulated: true, commerciallyLive: false, scenario, proposal: runtime.proposal, providerEvidence: runtime.evidence } } };
}

function demoOutputSchema() { return { type: "object", required: ["proposalType", "summary", "evidenceGaps", "needsHumanReview", "simulated", "commerciallyLive"], additionalProperties: false, properties: { proposalType: { type: "string" }, summary: { type: "string" }, evidenceGaps: { type: "array" }, needsHumanReview: { type: "boolean" }, simulated: { type: "boolean" }, commerciallyLive: { type: "boolean" } } }; }
