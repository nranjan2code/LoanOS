import test from "node:test";
import assert from "node:assert/strict";
import {
  activateTenantAiAgent, approveAiAgentPricingContract, authorizeAiAgentExecution, buildAiAgentGovernanceReport,
  completeAiAgentExecution, createAiAgentPlatformState,
  installTenantAiAgent, projectAiAgentMarketplace, proposeAiAgentPricingContract, recordAiAgentUsage,
  recordTenantAiAgentApproval, suspendTenantAiAgent, proposeAiAgentUsageBudget, approveAiAgentUsageBudget,
  reserveAiAgentUsageBudget, proposeAiAgentInvoice, approveAiAgentInvoice
} from "../packages/core/src/ai-agent-platform.js";
import { routeAiAgentPlatform } from "../apps/api/src/routes/ai-agent-platform.js";

const NOW = new Date("2026-07-15T00:00:00.000Z");
const H = "a".repeat(64);
const decision = (key) => ({ decision: "allow", traceRef: `trace:${key}`, source: "isolated_business_engine", decisionKey: key, rulesetHash: H });
const registry = (globalActive = false) => ({ globalKillSwitch: { active: globalActive, reason: globalActive ? "incident" : null }, models: { fm1: { modelId: "fm1", version: "2026-07", status: "active", validationStatus: "approved", riskTier: "low", materialDecision: false, customerFacing: false } }, incidents: {}, events: [] });

function contracted() {
  let state = proposeAiAgentPricingContract(createAiAgentPlatformState(), { contractId: "price1", tenantId: "re1", templateIds: ["credit.cam", "service.borrower_support"], effectiveFrom: "2026-07-01", validUntil: "2027-07-01", proposedBy: "commercial_maker", pricing: { per_execution_paise: "25", per_1k_input_tokens_paise: "10", per_1k_output_tokens_paise: "20" } }, NOW).state;
  return approveAiAgentPricingContract(state, { contractId: "price1", tenantId: "re1", approvedBy: "commercial_checker", commercialApprovalRef: "contract/1" }, NOW).state;
}

function proposed(state, templateId = "credit.cam") {
  return installTenantAiAgent(state, registry(), { installationId: "agent1", tenantId: "re1", templateId, contractId: "price1", modelId: "fm1", modelVersion: "2026-07", workloadPrincipalId: "agent_principal", humanSponsorPrincipalId: "sponsor", promptRef: "prompts/cam/v1", promptHash: H, configurationRef: "config/re1/cam/v1", productTypes: ["personal_loan"], dataScopes: ["application.read"], proposedBy: "agent_admin" }, NOW).state;
}

function active(state) {
  for (const [i, role] of ["model_owner", "model_validator", "human_reviewer", "model_risk_manager"].entries()) state = recordTenantAiAgentApproval(state, { installationId: "agent1", tenantId: "re1", role, principalId: `human_${i}`, principalType: "human", approvalRef: `approval/${role}` }, NOW).state;
  const governanceEvidence = Object.fromEntries(["riskAssessmentRef", "independentValidationRef", "fairnessAssessmentRef", "explainabilityRef", "redTeamRef", "monitoringPlanRef", "incidentRunbookRef", "indiaResidencyRef"].map((key) => [key, `evidence/${key}`]));
  return activateTenantAiAgent(state, registry(), { installationId: "agent1", tenantId: "re1", governanceEvidence, controlDecision: { ...decision("guardrail.platform_control.staffing"), source: "isolated_control_engine" } }, NOW).state;
}

test("minimum marketplace publishes four proposal-only digital workers and INR pricing dimensions", () => {
  const market = projectAiAgentMarketplace();
  assert.equal(market.templates.length, 4);
  assert.ok(market.templates.every((x) => x.decisionAuthority === "none" && x.outputType === "proposal_only"));
  assert.equal(market.currency, "INR");
});

test("commercial contracts require a separate authenticated approver", () => {
  let state = proposeAiAgentPricingContract(createAiAgentPlatformState(), { contractId: "p", tenantId: "re1", templateIds: ["credit.cam"], effectiveFrom: "2026-07-01", validUntil: "2027-07-01", proposedBy: "maker", pricing: {} }, NOW).state;
  assert.equal(state.pricingContracts.p.status, "pending_approval");
  assert.throws(() => approveAiAgentPricingContract(state, { contractId: "p", tenantId: "re1", approvedBy: "maker", commercialApprovalRef: "c" }, NOW), (e) => e.code === "ai_agent_pricing_self_approval");
  state = approveAiAgentPricingContract(state, { contractId: "p", tenantId: "re1", approvedBy: "checker", commercialApprovalRef: "c" }, NOW).state;
  assert.equal(state.pricingContracts.p.status, "active");
});

test("pricing API binds maker and checker to their authenticated identities", async () => {
  let tenantState = { aiAgentPlatform: createAiAgentPlatformState(), modelRegistry: registry(), events: [] };
  const store = { load: async () => tenantState, save: async (next) => { tenantState = next; } };
  const call = async (path, actor, body) => {
    let response;
    const handled = await routeAiAgentPlatform({ method: "POST", path, req: { url: path, _loanosRequestId: `req:${actor}` }, res: {}, store,
      readJson: async () => body, sendJson: (_res, status, payload) => { response = { status, payload }; }, appendEvent: (state) => state,
      authContext: { tenantId: "re1" }, hasTenantAdminRole: () => true, authActor: () => actor });
    assert.equal(handled, true); return response;
  };
  let response = await call("/ai/pricing-contracts", "maker", { contractId: "api-price", templateIds: ["credit.cam"], effectiveFrom: "2026-07-01", validUntil: "2027-07-01", proposedBy: "spoofed", pricing: {} });
  assert.equal(response.status, 201);
  assert.equal(response.payload.proposedBy, "maker");
  response = await call("/ai/pricing-contracts/api-price/approve", "checker", { commercialApprovalRef: "contract/api", approvedBy: "spoofed" });
  assert.equal(response.status, 200);
  assert.equal(response.payload.approvedBy, "checker");
});

test("tenant customization cannot expand template tools and activation needs four independent humans", () => {
  const state = contracted();
  assert.throws(() => installTenantAiAgent(state, registry(), { installationId: "bad", tenantId: "re1", templateId: "credit.cam", contractId: "price1", modelId: "fm1", modelVersion: "2026-07", workloadPrincipalId: "a", humanSponsorPrincipalId: "h", promptRef: "p", promptHash: H, configurationRef: "c", allowedActions: ["loan.sanction"], proposedBy: "p" }, NOW), (e) => e.code === "ai_agent_action_scope_expanded");
  let pending = proposed(state);
  pending = recordTenantAiAgentApproval(pending, { installationId: "agent1", tenantId: "re1", role: "model_owner", principalId: "one_human", principalType: "human", approvalRef: "a/1" }, NOW).state;
  assert.throws(() => recordTenantAiAgentApproval(pending, { installationId: "agent1", tenantId: "re1", role: "model_validator", principalId: "one_human", principalType: "human", approvalRef: "a/2" }, NOW), (e) => e.code === "ai_agent_approval_independence_required");
});

test("execution is fail-closed, traceable and bills exact integer paise", () => {
  let state = active(proposed(contracted()));
  assert.throws(() => authorizeAiAgentExecution(state, registry(true), { executionId: "run0", tenantId: "re1", installationId: "agent1", action: "cam.draft", purpose: "prepare CAM", inputRef: "application/a1", inputHash: H, modelConsumptionDecision: decision("guardrail.model_consumption"), actionGuardrailDecision: decision("guardrail.agent_action") }, NOW), (e) => e.code === "ai_agent_model_not_usable");
  let result = authorizeAiAgentExecution(state, registry(), { executionId: "run1", tenantId: "re1", installationId: "agent1", action: "cam.draft", purpose: "prepare CAM", inputRef: "application/a1", inputHash: H, modelConsumptionDecision: decision("guardrail.model_consumption"), actionGuardrailDecision: decision("guardrail.agent_action") }, NOW);
  state = result.state;
  assert.equal(result.record.modelConsumptionDecision.traceRef, "trace:guardrail.model_consumption");
  result = completeAiAgentExecution(state, { executionId: "run1", tenantId: "re1", outputRef: "proposal/cam/1", outputHash: H, outcome: "proposal_created", citations: ["doc/1#p2"] }, NOW); state = result.state;
  result = recordAiAgentUsage(state, { usageId: "u1", executionId: "run1", tenantId: "re1", inputTokens: "1001", outputTokens: "999", toolCalls: "2" }, NOW); state = result.state;
  assert.equal(result.record.chargePaise, "65");
  const report = buildAiAgentGovernanceReport(state, "re1");
  assert.equal(report.executions.completed, 1);
  assert.equal(report.usage.chargePaise, "65");
  assert.equal(report.lineage.traceComplete, true);
  assert.equal(report.lineage.rawPromptsStored, false);
});

test("emergency suspension immediately blocks new work", () => {
  let state = active(proposed(contracted()));
  state = suspendTenantAiAgent(state, { installationId: "agent1", tenantId: "re1", reason: "drift alert", actor: "risk", incidentRef: "incident/1" }, NOW).state;
  assert.throws(() => authorizeAiAgentExecution(state, registry(), { executionId: "run2", tenantId: "re1", installationId: "agent1", action: "cam.draft", purpose: "x", inputRef: "a", inputHash: H, modelConsumptionDecision: decision("guardrail.model_consumption"), actionGuardrailDecision: decision("guardrail.agent_action") }, NOW), (e) => e.code === "ai_agent_installation_inactive");
});

test("approved tenant budget reserves exact paise before model work and cannot be exceeded", () => {
  let state = active(proposed(contracted()));
  state = proposeAiAgentUsageBudget(state, { budgetId: "budget1", tenantId: "re1", contractId: "price1", effectiveFrom: "2026-07-01", validUntil: "2026-08-01", proposedBy: "commercial_maker", limits: { maxExecutions: "1", maxInputTokens: "1001", maxOutputTokens: "999", maxChargePaise: "65" } }, NOW).state;
  state = approveAiAgentUsageBudget(state, { budgetId: "budget1", tenantId: "re1", approvedBy: "commercial_checker", commercialApprovalRef: "budget/approval/1" }, NOW).state;
  assert.throws(() => reserveAiAgentUsageBudget(state, { reservationId: "too-much", tenantId: "re1", installationId: "agent1", expectedInputTokens: "1002", expectedOutputTokens: "999" }, NOW), (e) => e.code === "ai_agent_budget_exceeded");
  state = reserveAiAgentUsageBudget(state, { reservationId: "reserve1", tenantId: "re1", installationId: "agent1", expectedInputTokens: "1001", expectedOutputTokens: "999" }, NOW).state;
  let outcome = authorizeAiAgentExecution(state, registry(), { executionId: "budget-run", tenantId: "re1", installationId: "agent1", action: "cam.draft", purpose: "CAM", inputRef: "app/1", inputHash: H, usageReservationId: "reserve1", modelConsumptionDecision: decision("guardrail.model_consumption"), actionGuardrailDecision: decision("guardrail.agent_action") }, NOW);
  state = outcome.state;
  state = completeAiAgentExecution(state, { executionId: "budget-run", tenantId: "re1", outputRef: "proposal/1", outputHash: H, outcome: "proposal_created" }, NOW).state;
  assert.throws(() => recordAiAgentUsage(state, { usageId: "bad-use", executionId: "budget-run", tenantId: "re1", inputTokens: "1002", outputTokens: "999" }, NOW), (e) => e.code === "ai_agent_budget_reservation_exceeded");
  state = recordAiAgentUsage(state, { usageId: "good-use", executionId: "budget-run", tenantId: "re1", inputTokens: "1001", outputTokens: "999" }, NOW).state;
  assert.equal(state.budgetReservations.reserve1.status, "consumed");
});

test("GST-ready invoice uses immutable ledger lineage and independent commercial approval", () => {
  let state = active(proposed(contracted()));
  let outcome = authorizeAiAgentExecution(state, registry(), { executionId: "invoice-run", tenantId: "re1", installationId: "agent1", action: "cam.draft", purpose: "CAM", inputRef: "app/1", inputHash: H, modelConsumptionDecision: decision("guardrail.model_consumption"), actionGuardrailDecision: decision("guardrail.agent_action") }, NOW);
  state = completeAiAgentExecution(outcome.state, { executionId: "invoice-run", tenantId: "re1", outputRef: "proposal/1", outputHash: H, outcome: "proposal_created" }, NOW).state;
  state = recordAiAgentUsage(state, { usageId: "invoice-use", executionId: "invoice-run", tenantId: "re1", inputTokens: "1001", outputTokens: "999" }, NOW).state;
  outcome = proposeAiAgentInvoice(state, { invoiceId: "inv1", tenantId: "re1", contractId: "price1", periodFrom: "2026-07-01", periodTo: "2026-08-01", proposedBy: "billing_maker", tax: { supplyType: "intra_state", rateBasisPoints: "1800", supplierGstinRef: "tax/supplier", recipientGstinRef: "tax/recipient", placeOfSupplyState: "KA" } }, NOW);
  state = outcome.state;
  assert.equal(outcome.record.charges.subtotalPaise, "65");
  assert.equal(outcome.record.tax.totalTaxPaise, "12");
  assert.equal(outcome.record.tax.cgstPaise, "6");
  assert.equal(outcome.record.usage.ledgerEntries[0].usageId, "invoice-use");
  assert.throws(() => approveAiAgentInvoice(state, { invoiceId: "inv1", tenantId: "re1", approvedBy: "billing_maker", commercialApprovalRef: "bad" }, NOW), (e) => e.code === "ai_agent_invoice_self_approval");
  outcome = approveAiAgentInvoice(state, { invoiceId: "inv1", tenantId: "re1", approvedBy: "billing_checker", commercialApprovalRef: "billing/approval/1" }, NOW);
  assert.equal(outcome.record.status, "approved");
  assert.equal(outcome.record.totalPaise, "77");
});

test("explicit demo mode runs an already-authorized execution through the mock provider only", async () => {
  let platform = active(proposed(contracted()));
  platform = authorizeAiAgentExecution(platform, registry(), { executionId: "demo-run", tenantId: "re1", installationId: "agent1", action: "cam.draft", purpose: "CAM", inputRef: "synthetic/application/1", inputHash: H, modelConsumptionDecision: decision("guardrail.model_consumption"), actionGuardrailDecision: decision("guardrail.agent_action") }, NOW).state;
  let tenantState = { aiAgentPlatform: platform, modelRegistry: registry(), events: [] };
  const store = { load: async () => tenantState, save: async (next) => { tenantState = next; } };
  const call = async () => {
    let response;
    await routeAiAgentPlatform({ method: "POST", path: "/ai/agents/executions/demo-run/demo-run", req: { url: "/ai/agents/executions/demo-run/demo-run", _loanosRequestId: "demo-request" }, res: {}, store,
      readJson: async () => ({ scenario: "incomplete_evidence" }), sendJson: (_res, status, payload) => { response = { status, payload }; }, appendEvent: (state) => state,
      authContext: { tenantId: "re1" }, hasTenantAdminRole: () => true, authActor: () => "demo_operator" });
    return response;
  };
  const original = process.env.LOANOS_AI_DEMO_MODE;
  delete process.env.LOANOS_AI_DEMO_MODE;
  let response = await call();
  assert.equal(response.status, 403);
  process.env.LOANOS_AI_DEMO_MODE = "true";
  response = await call();
  if (original === undefined) delete process.env.LOANOS_AI_DEMO_MODE; else process.env.LOANOS_AI_DEMO_MODE = original;
  assert.equal(response.status, 201);
  assert.equal(response.payload.demo.simulated, true);
  assert.equal(response.payload.demo.commerciallyLive, false);
  assert.equal(response.payload.demo.proposal.needsHumanReview, true);
  assert.equal(tenantState.aiAgentPlatform.executions["demo-run"].status, "completed");
  assert.ok(tenantState.aiAgentPlatform.usageLedger["demo-usage:demo-run"]);
});
