import test from "node:test";
import assert from "node:assert/strict";
import {
  activateTenantAiAgent, approveAiAgentPricingContract, authorizeAiAgentExecution,
  completeAiAgentExecution, createAiAgentPlatformState, installTenantAiAgent,
  proposeAiAgentPricingContract, recordAiAgentProposalReview, recordTenantAiAgentApproval
} from "@loanos/core/ai/ai-agent-platform.js";
import { deriveWorkflowTasks } from "@loanos/core/journeys/workflow-tasks.js";

const NOW = new Date("2026-07-21T10:00:00.000Z");
const H = "a".repeat(64);
const decision = (key) => ({ decision: "allow", traceRef: `trace:${key}`, source: "isolated_business_engine", decisionKey: key, rulesetHash: H });
const registry = () => ({ globalKillSwitch: { active: false, reason: null }, models: { fm1: { modelId: "fm1", version: "2026-07", status: "active", validationStatus: "approved", riskTier: "low", materialDecision: false, customerFacing: false } }, incidents: {}, events: [] });

function setupAgentWithProposalExecution() {
  let platformState = createAiAgentPlatformState();
  platformState = proposeAiAgentPricingContract(platformState, { contractId: "price1", tenantId: "re1", templateIds: ["credit.cam"], effectiveFrom: "2026-07-01", validUntil: "2027-07-01", proposedBy: "commercial_maker", pricing: { per_execution_paise: "25" } }, NOW).state;
  platformState = approveAiAgentPricingContract(platformState, { contractId: "price1", tenantId: "re1", approvedBy: "commercial_checker", commercialApprovalRef: "contract/1" }, NOW).state;
  platformState = installTenantAiAgent(platformState, registry(), { installationId: "agent1", tenantId: "re1", templateId: "credit.cam", contractId: "price1", modelId: "fm1", modelVersion: "2026-07", workloadPrincipalId: "agent_principal", humanSponsorPrincipalId: "sponsor", promptRef: "prompts/cam/v1", promptHash: H, configurationRef: "config/cam/v1", productTypes: ["personal_loan"], dataScopes: ["application.read"], proposedBy: "agent_admin" }, NOW).state;
  for (const [i, role] of ["model_owner", "model_validator", "human_reviewer", "model_risk_manager"].entries()) {
    platformState = recordTenantAiAgentApproval(platformState, { installationId: "agent1", tenantId: "re1", role, principalId: `human_${i}`, principalType: "human", approvalRef: `approval/${role}` }, NOW).state;
  }
  const governanceEvidence = Object.fromEntries(["riskAssessmentRef", "independentValidationRef", "fairnessAssessmentRef", "explainabilityRef", "redTeamRef", "monitoringPlanRef", "incidentRunbookRef", "indiaResidencyRef"].map((key) => [key, `evidence/${key}`]));
  platformState = activateTenantAiAgent(platformState, registry(), { installationId: "agent1", tenantId: "re1", governanceEvidence, controlDecision: { ...decision("guardrail.platform_control.staffing"), source: "isolated_control_engine" } }, NOW).state;
  platformState = authorizeAiAgentExecution(platformState, registry(), { executionId: "run1", tenantId: "re1", installationId: "agent1", action: "cam.draft", purpose: "prepare CAM", inputRef: "application/a1", inputHash: H, modelConsumptionDecision: decision("guardrail.model_consumption"), actionGuardrailDecision: decision("guardrail.agent_action") }, NOW).state;
  platformState = completeAiAgentExecution(platformState, { executionId: "run1", tenantId: "re1", outputRef: "proposal/cam/1", outputHash: H, outcome: "proposal_created" }, NOW).state;
  return platformState;
}

test("deriveWorkflowTasks projects unreviewed agent proposal execution into staff workspace task queues", () => {
  const platformState = setupAgentWithProposalExecution();
  const state = { aiAgentPlatform: platformState };

  const tasks = deriveWorkflowTasks(state, { asOf: NOW });
  const agentTask = tasks.find((t) => t.entityId === "run1" || t.taskId === "task_agent_review_run1");

  assert.ok(agentTask, "Pending agent proposal execution must project into deriveWorkflowTasks");
  assert.equal(agentTask.type, "agent.proposal_review");
  assert.equal(agentTask.queue, "model_risk");
  assert.equal(agentTask.role, "human_reviewer");
  assert.equal(agentTask.entityType, "agent_execution");
  assert.equal(agentTask.action.method, "POST");
  assert.equal(agentTask.action.path, "/ai/agents/executions/run1/human-review");
});

test("deriveWorkflowTasks queue filter supports agent.proposal_review in model_risk queue", () => {
  const platformState = setupAgentWithProposalExecution();
  const state = { aiAgentPlatform: platformState };

  const modelRiskTasks = deriveWorkflowTasks(state, { asOf: NOW, filters: { queue: "model_risk" } });
  assert.ok(modelRiskTasks.some((t) => t.taskId === "task_agent_review_run1"));

  const underwritingTasks = deriveWorkflowTasks(state, { asOf: NOW, filters: { queue: "underwriting" } });
  assert.equal(underwritingTasks.length, 0);
});

test("recording human review disposition removes task from deriveWorkflowTasks and seals lineage", () => {
  let platformState = setupAgentWithProposalExecution();
  let state = { aiAgentPlatform: platformState };

  let tasks = deriveWorkflowTasks(state, { asOf: NOW });
  assert.ok(tasks.some((t) => t.taskId === "task_agent_review_run1"));

  // Record review
  platformState = recordAiAgentProposalReview(platformState, {
    executionId: "run1",
    tenantId: "re1",
    reviewerId: "reviewer-1",
    reviewerType: "human",
    disposition: "accepted",
    reviewRef: "review/1"
  }, NOW).state;

  state = { aiAgentPlatform: platformState };
  tasks = deriveWorkflowTasks(state, { asOf: NOW });
  assert.equal(tasks.some((t) => t.taskId === "task_agent_review_run1"), false);
});
