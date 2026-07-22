import test from "node:test";
import assert from "node:assert/strict";
import {
  activateTenantAiAgent, approveAiAgentPricingContract, authorizeAiAgentExecution,
  createAiAgentPlatformState, installTenantAiAgent, proposeAiAgentPricingContract,
  recordTenantAiAgentApproval
} from "@loanos/core/ai/ai-agent-platform.js";

const NOW = new Date("2026-07-21T10:00:00.000Z");
const H = "a".repeat(64);
const decision = (key, outcome = "allow") => ({
  decision: outcome, traceRef: `trace:${key}`, source: "isolated_business_engine", decisionKey: key, rulesetHash: H
});
const registry = () => ({
  globalKillSwitch: { active: false, reason: null },
  models: { fm1: { modelId: "fm1", version: "2026-07", status: "active", validationStatus: "approved", riskTier: "low", materialDecision: false, customerFacing: false } },
  incidents: {}, events: []
});

function setupActiveAgent() {
  let platformState = createAiAgentPlatformState();
  platformState = proposeAiAgentPricingContract(platformState, { contractId: "price1", tenantId: "re1", templateIds: ["credit.cam"], effectiveFrom: "2026-07-01", validUntil: "2027-07-01", proposedBy: "commercial_maker", pricing: { per_execution_paise: "25" } }, NOW).state;
  platformState = approveAiAgentPricingContract(platformState, { contractId: "price1", tenantId: "re1", approvedBy: "commercial_checker", commercialApprovalRef: "contract/1" }, NOW).state;
  platformState = installTenantAiAgent(platformState, registry(), { installationId: "agent1", tenantId: "re1", templateId: "credit.cam", contractId: "price1", modelId: "fm1", modelVersion: "2026-07", workloadPrincipalId: "agent_principal", humanSponsorPrincipalId: "sponsor", promptRef: "prompts/cam/v1", promptHash: H, configurationRef: "config/cam/v1", productTypes: ["personal_loan"], dataScopes: ["application.read"], proposedBy: "agent_admin" }, NOW).state;
  for (const [i, role] of ["model_owner", "model_validator", "human_reviewer", "model_risk_manager"].entries()) {
    platformState = recordTenantAiAgentApproval(platformState, { installationId: "agent1", tenantId: "re1", role, principalId: `human_${i}`, principalType: "human", approvalRef: `approval/${role}` }, NOW).state;
  }
  const governanceEvidence = Object.fromEntries(["riskAssessmentRef", "independentValidationRef", "fairnessAssessmentRef", "explainabilityRef", "redTeamRef", "monitoringPlanRef", "incidentRunbookRef", "indiaResidencyRef"].map((key) => [key, `evidence/${key}`]));
  platformState = activateTenantAiAgent(platformState, registry(), { installationId: "agent1", tenantId: "re1", governanceEvidence, controlDecision: { ...decision("guardrail.platform_control.staffing"), source: "isolated_control_engine" } }, NOW).state;
  return platformState;
}

test("authorizeAiAgentExecution accepts affirmative domain guardrail decisions", () => {
  const platformState = setupActiveAgent();
  const domainDecisions = {
    dataAccess: decision("guardrail.data_access", "allow"),
    communicationDispatch: decision("guardrail.communication_dispatch", "allow")
  };

  const { record } = authorizeAiAgentExecution(platformState, registry(), {
    executionId: "run_domain_1", tenantId: "re1", installationId: "agent1", action: "cam.draft",
    purpose: "prepare CAM", inputRef: "application/a1", inputHash: H,
    modelConsumptionDecision: decision("guardrail.model_consumption"),
    actionGuardrailDecision: decision("guardrail.agent_action"),
    domainGuardrailDecisions: domainDecisions
  }, NOW);

  assert.equal(record.status, "authorized");
  assert.ok(record.domainGuardrailDecisions);
  assert.equal(record.domainGuardrailDecisions.dataAccess.decision, "allow");
});

test("authorizeAiAgentExecution fails closed when any domain guardrail decision denies", () => {
  const platformState = setupActiveAgent();
  const domainDecisions = {
    dataAccess: decision("guardrail.data_access", "deny")
  };

  assert.throws(() => authorizeAiAgentExecution(platformState, registry(), {
    executionId: "run_domain_2", tenantId: "re1", installationId: "agent1", action: "cam.draft",
    purpose: "prepare CAM", inputRef: "application/a1", inputHash: H,
    modelConsumptionDecision: decision("guardrail.model_consumption"),
    actionGuardrailDecision: decision("guardrail.agent_action"),
    domainGuardrailDecisions: domainDecisions
  }, NOW), (err) => err.code.includes("guardrail_denied"));
});
