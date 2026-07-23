import test from "node:test";
import assert from "node:assert/strict";
import {
  activateTenantAiAgent, approveAiAgentPricingContract, autoTriggerCamDigitalWorker,
  createAiAgentPlatformState, installTenantAiAgent, proposeAiAgentPricingContract,
  recordTenantAiAgentApproval
} from "@loanos/core/ai/ai-agent-platform.js";
import { claimDigitalWorkerRuntimeJob, completeDigitalWorkerRuntimeJob } from "@loanos/core/ai/digital-worker-runtime-jobs.js";
import { deriveWorkflowTasks } from "@loanos/core/journeys/workflow-tasks.js";

const NOW = new Date("2026-07-21T10:00:00.000Z");
const H = "a".repeat(64);
const decision = (key) => ({ decision: "allow", traceRef: `trace:${key}`, source: "isolated_business_engine", decisionKey: key, rulesetHash: H });
const registry = () => ({
  globalKillSwitch: { active: false, reason: null },
  models: { fm1: { modelId: "fm1", version: "2026-07", status: "active", validationStatus: "approved", riskTier: "low", materialDecision: false, customerFacing: false } },
  incidents: {}, events: []
});

function setupActiveCamAgent() {
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

test("autoTriggerCamDigitalWorker generates CAM proposal for loan application and projects into workflow tasks", () => {
  const platformState = setupActiveCamAgent();
  const state = { aiAgentPlatform: platformState };

  const result = autoTriggerCamDigitalWorker(state, registry(), {
    tenantId: "re1",
    applicationId: "app_1001",
    inputHash: H,
    modelConsumptionDecision: decision("guardrail.model_consumption"),
    actionGuardrailDecision: decision("guardrail.agent_action")
  }, NOW);

  assert.equal(result.triggered, true);
  assert.ok(result.record.executionId);
  assert.ok(result.job.jobId);
  assert.equal(result.job.status, "queued");

  // Worker claims and completes the runtime job with real provider output evidence
  const claimed = claimDigitalWorkerRuntimeJob(result.state, { tenantId: "re1", workerId: "worker_1" }, NOW);
  const completed = completeDigitalWorkerRuntimeJob(claimed.state, {
    tenantId: "re1",
    jobId: result.job.jobId,
    workerId: "worker_1",
    fence: claimed.job.lease.fence,
    outputRef: "proposals/cam/app_1001",
    outputHash: H,
    providerEvidenceRef: "evidence/bedrock/run_1001",
    outcome: "proposal_created"
  }, NOW);

  const updatedState = { aiAgentPlatform: completed.state };
  const tasks = deriveWorkflowTasks(updatedState, { asOf: NOW });
  const camTask = tasks.find((t) => t.entityId === result.record.executionId);

  assert.ok(camTask);
  assert.equal(camTask.type, "agent.proposal_review");
});

test("autoTriggerCamDigitalWorker returns triggered false when no active CAM agent is installed", () => {
  const state = { aiAgentPlatform: createAiAgentPlatformState() };

  const result = autoTriggerCamDigitalWorker(state, registry(), {
    tenantId: "re1",
    applicationId: "app_1002",
    inputHash: H,
    modelConsumptionDecision: decision("guardrail.model_consumption"),
    actionGuardrailDecision: decision("guardrail.agent_action")
  }, NOW);

  assert.equal(result.triggered, false);
});

test("autoTriggerCamDigitalWorker fails closed when explicit engine decisions are missing", () => {
  const platformState = setupActiveCamAgent();
  const state = { aiAgentPlatform: platformState };

  assert.throws(() => {
    autoTriggerCamDigitalWorker(state, registry(), {
      tenantId: "re1",
      applicationId: "app_1003",
      inputHash: H
      // missing modelConsumptionDecision and actionGuardrailDecision
    }, NOW);
  }, (err) => err.code === "ai_agent_field_required");
});

