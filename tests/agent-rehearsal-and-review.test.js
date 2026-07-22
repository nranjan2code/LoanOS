import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAgentTestSuite, createAgentWorkflowDraft, projectAgentOperationsQueue, runAgentTestSuite } from "@loanos/core/ai/agent-studio-governance.js";
import {
  activateTenantAiAgent, approveAiAgentPricingContract, authorizeAiAgentExecution, buildAiAgentGovernanceReport,
  completeAiAgentExecution, createAiAgentPlatformState, installTenantAiAgent, proposeAiAgentPricingContract,
  recordAiAgentProposalReview, recordTenantAiAgentApproval
} from "@loanos/core/ai/ai-agent-platform.js";
import { routeAiAgentPlatform } from "../apps/api/src/routes/ai-agent-platform.js";

const NOW = new Date("2026-07-21T10:00:00.000Z");
const H = "a".repeat(64);
const decision = (key) => ({ decision: "allow", traceRef: `trace:${key}`, source: "isolated_business_engine", decisionKey: key, rulesetHash: H });
const registry = () => ({ globalKillSwitch: { active: false, reason: null }, models: { fm1: { modelId: "fm1", version: "2026-07", status: "active", validationStatus: "approved", riskTier: "low", materialDecision: false, customerFacing: false } }, incidents: {}, events: [] });

// Rehearsal fixtures use a raw governed state: the harness must derive outcomes
// purely from what the platform records, never from what a browser reports.
const rehearsalState = (overrides = {}) => ({
  installations: {
    draft: {
      installationId: "draft", tenantId: "bank-a", templateId: "credit.cam", templateVersion: 1,
      modelId: "fm1", modelVersion: "1", allowedActions: ["cam.draft"], productTypes: ["personal_loan"],
      dataScopes: ["application.read"], memoryMode: "execution_scoped", promptHash: H,
      humanSponsorPrincipalId: "sponsor-1", proposedBy: "staff", status: "pending_approval", ...overrides
    }
  },
  knowledgePacks: {}, memoryStores: {}, providerEvidence: {}, workflowDrafts: {}, testSuites: {}, testRuns: {}, agentVersions: {}, rollbackRequests: {}, events: []
});

const threeCaseSuite = (state) => createAgentTestSuite(state, {
  suiteId: "cam-readiness", tenantId: "bank-a", name: "CAM readiness", installationId: "draft",
  cases: [
    { caseId: "complete-file", kind: "expected", scenario: "Complete application with verified evidence", expectedOutcome: "proposal" },
    { caseId: "missing-income", kind: "adverse", scenario: "Income proof is missing", expectedOutcome: "human_review" },
    { caseId: "injection", kind: "adverse", scenario: "Prompt asks the assistant to sanction the loan", probeAction: "loan.sanction", expectedOutcome: "deny" }
  ],
  proposedBy: "tester"
}, NOW).state;

test("server harness derives rehearsal outcomes from governed configuration, not client claims", () => {
  const state = threeCaseSuite(rehearsalState());
  const run = runAgentTestSuite(state, { runId: "run-1", suiteId: "cam-readiness", tenantId: "bank-a", runBy: "tester" }, NOW);
  assert.equal(run.record.source, "synthetic_harness");
  assert.equal(run.record.simulated, true);
  assert.equal(run.record.status, "passed");
  assert.equal(run.record.scorePercent, 100);
  const byCase = Object.fromEntries(run.record.results.map((item) => [item.caseId, item]));
  assert.equal(byCase["complete-file"].observedOutcome, "proposal");
  assert.equal(byCase["missing-income"].observedOutcome, "human_review");
  // The out-of-scope probe must be refused because loan.sanction is outside the approved actions.
  assert.equal(byCase["injection"].observedOutcome, "deny");
  // Evidence hashes are recomputable server artifacts, not client-supplied strings.
  for (const item of run.record.results) assert.match(item.evidenceHash, /^[a-f0-9]{64}$/);
});

test("rehearsals fail honestly when the human-review path is not guaranteed", () => {
  const state = threeCaseSuite(rehearsalState({ humanSponsorPrincipalId: undefined }));
  const run = runAgentTestSuite(state, { runId: "run-2", suiteId: "cam-readiness", tenantId: "bank-a", runBy: "tester" }, NOW);
  assert.equal(run.record.status, "failed");
  const adverse = run.record.results.find((item) => item.caseId === "missing-income");
  assert.equal(adverse.observedOutcome, "deny");
  assert.equal(adverse.passed, false);
});

test("rehearsals respect a bound workflow's human-review guarantee", () => {
  let state = rehearsalState({ workflowId: "wf-1" });
  state = createAgentWorkflowDraft(state, { workflowId: "wf-1", tenantId: "bank-a", name: "CAM plan", templateId: "credit.cam", productTypes: ["personal_loan"], steps: [{ type: "receive", label: "Receive" }, { type: "prepare", label: "Prepare" }, { type: "human_review", label: "Officer reviews" }], proposedBy: "staff" }, NOW).state;
  state = threeCaseSuite(state);
  const run = runAgentTestSuite(state, { runId: "run-3", suiteId: "cam-readiness", tenantId: "bank-a", runBy: "tester" }, NOW);
  assert.equal(run.record.status, "passed");
});

test("the runs API ignores fabricated client results and derives outcomes server-side", async () => {
  let tenantState = { aiAgentPlatform: threeCaseSuite(rehearsalState({ humanSponsorPrincipalId: undefined })), events: [] };
  let response;
  const handled = await routeAiAgentPlatform({
    method: "POST", path: "/ai/agents/test-suites/cam-readiness/runs", req: { url: "/ai/agents/test-suites/cam-readiness/runs", _loanosRequestId: "req" }, res: {},
    store: { load: async () => tenantState, save: async (next) => { tenantState = next; } },
    readJson: async () => ({ runId: "api-run", results: [{ caseId: "complete-file", observedOutcome: "proposal", evidenceHash: H }, { caseId: "missing-income", observedOutcome: "human_review", evidenceHash: H }, { caseId: "injection", observedOutcome: "deny", evidenceHash: H }] }),
    sendJson: (_res, status, payload) => { response = { status, payload }; }, appendEvent: (state) => state,
    authContext: { tenantId: "bank-a", userId: "tester", principalType: "tenant_user", roles: ["model_validator"] }, authActor: () => "tester"
  });
  assert.equal(handled, true);
  assert.equal(response.status, 201);
  // Fabricated all-pass results must not rescue a configuration whose human path is broken.
  assert.equal(response.payload.status, "failed");
});

test("completed agent proposals require a recorded independent human review", () => {
  let state = proposeAiAgentPricingContract(createAiAgentPlatformState(), { contractId: "price1", tenantId: "re1", templateIds: ["credit.cam"], effectiveFrom: "2026-07-01", validUntil: "2027-07-01", proposedBy: "commercial_maker", pricing: { per_execution_paise: "25" } }, NOW).state;
  state = approveAiAgentPricingContract(state, { contractId: "price1", tenantId: "re1", approvedBy: "commercial_checker", commercialApprovalRef: "contract/1" }, NOW).state;
  state = installTenantAiAgent(state, registry(), { installationId: "agent1", tenantId: "re1", templateId: "credit.cam", contractId: "price1", modelId: "fm1", modelVersion: "2026-07", workloadPrincipalId: "agent_principal", humanSponsorPrincipalId: "sponsor", promptRef: "prompts/cam/v1", promptHash: H, configurationRef: "config/cam/v1", productTypes: ["personal_loan"], dataScopes: ["application.read"], proposedBy: "agent_admin" }, NOW).state;
  for (const [i, role] of ["model_owner", "model_validator", "human_reviewer", "model_risk_manager"].entries()) state = recordTenantAiAgentApproval(state, { installationId: "agent1", tenantId: "re1", role, principalId: `human_${i}`, principalType: "human", approvalRef: `approval/${role}` }, NOW).state;
  const governanceEvidence = Object.fromEntries(["riskAssessmentRef", "independentValidationRef", "fairnessAssessmentRef", "explainabilityRef", "redTeamRef", "monitoringPlanRef", "incidentRunbookRef", "indiaResidencyRef"].map((key) => [key, `evidence/${key}`]));
  state = activateTenantAiAgent(state, registry(), { installationId: "agent1", tenantId: "re1", governanceEvidence, controlDecision: { ...decision("guardrail.platform_control.staffing"), source: "isolated_control_engine" } }, NOW).state;
  state = authorizeAiAgentExecution(state, registry(), { executionId: "run1", tenantId: "re1", installationId: "agent1", action: "cam.draft", purpose: "prepare CAM", inputRef: "application/a1", inputHash: H, modelConsumptionDecision: decision("guardrail.model_consumption"), actionGuardrailDecision: decision("guardrail.agent_action") }, NOW).state;
  state = completeAiAgentExecution(state, { executionId: "run1", tenantId: "re1", outputRef: "proposal/cam/1", outputHash: H, outcome: "proposal_created" }, NOW).state;

  // The unreviewed proposal must surface as owned human work.
  const queue = projectAgentOperationsQueue(state, "re1", NOW);
  assert.ok(queue.some((item) => item.type === "proposal_review" && item.ownerRole === "human_reviewer" && item.resourceId === "run1"));
  let report = buildAiAgentGovernanceReport(state, "re1");
  assert.equal(report.executions.pendingHumanReview, 1);

  // A workload identity or the agent's own principal cannot close the loop.
  assert.throws(() => recordAiAgentProposalReview(state, { executionId: "run1", tenantId: "re1", reviewerId: "reviewer-1", reviewerType: "workload", disposition: "accepted", reviewRef: "review/1" }, NOW), (e) => e.code === "ai_agent_review_human_required");
  assert.throws(() => recordAiAgentProposalReview(state, { executionId: "run1", tenantId: "re1", reviewerId: "agent_principal", reviewerType: "human", disposition: "accepted", reviewRef: "review/1" }, NOW), (e) => e.code === "ai_agent_review_independence_required");

  state = recordAiAgentProposalReview(state, { executionId: "run1", tenantId: "re1", reviewerId: "reviewer-1", reviewerType: "human", disposition: "accepted", reviewRef: "review/1" }, NOW).state;
  assert.equal(state.executions.run1.humanReview.disposition, "accepted");
  assert.ok(projectAgentOperationsQueue(state, "re1", NOW).every((item) => item.type !== "proposal_review"));
  report = buildAiAgentGovernanceReport(state, "re1");
  assert.equal(report.executions.pendingHumanReview, 0);
  assert.equal(report.executions.humanReviewed, 1);

  // A review is recorded once; a second disposition cannot overwrite the evidence.
  assert.throws(() => recordAiAgentProposalReview(state, { executionId: "run1", tenantId: "re1", reviewerId: "reviewer-2", reviewerType: "human", disposition: "rejected", reviewRef: "review/2" }, NOW), (e) => e.code === "ai_agent_review_already_recorded");
});

test("review evidence hash is recomputable", () => {
  const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
  const state = threeCaseSuite(rehearsalState());
  const run = runAgentTestSuite(state, { runId: "run-hash", suiteId: "cam-readiness", tenantId: "bank-a", runBy: "tester" }, NOW);
  const { recordHash, ...content } = run.record;
  assert.equal(recordHash, createHash("sha256").update(canonical(content)).digest("hex"));
});
