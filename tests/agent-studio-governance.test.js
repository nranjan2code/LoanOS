import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createAgentKnowledgePack, createAgentTestSuite, createAgentWorkflowDraft,
  approveAgentKnowledgePack, approveAgentMemoryStore, approveAgentRollback,
  approveAgentProviderEvidence, assessAgentProductionAdmission, compareAgentInstallations,
  containExpiredAgentKnowledge, createAgentMemoryStore, projectAgentOperationsQueue,
  publishAgentVersion, proposeAgentProviderEvidence, proposeAgentRollback,
  retireAgentInstallation, runAgentTestSuite
} from "@loanos/core/ai/agent-studio-governance.js";
import { routeAiAgentPlatform } from "../apps/api/src/routes/ai-agent-platform.js";

const NOW = new Date("2026-07-21T10:00:00.000Z");
const HASH = "a".repeat(64);
const approvals = Object.fromEntries(["model_owner", "model_validator", "human_reviewer", "model_risk_manager"].map((role, index) => [role, { principalId: `human-${index}`, approvalRef: `approval/${role}` }]));
const base = () => ({ knowledgePacks: {}, memoryStores: {}, providerEvidence: {}, workflowDrafts: {}, testSuites: {}, testRuns: {}, agentVersions: {}, rollbackRequests: {}, installations: {
  original: { installationId: "original", tenantId: "bank-a", templateId: "credit.cam", allowedActions: ["cam.draft"], productTypes: ["personal_loan"], dataScopes: ["application.read"], memoryMode: "none", promptHash: HASH, status: "active" },
  draft: { installationId: "draft", tenantId: "bank-a", templateId: "credit.cam", templateVersion: 1, modelId: "fm1", modelVersion: "1", allowedActions: ["cam.draft", "evidence.gap_list"], productTypes: ["personal_loan"], dataScopes: ["application.read"], memoryMode: "execution_scoped", promptHash: "b".repeat(64), humanSponsorPrincipalId: "sponsor-1", approvedByRole: approvals, proposedBy: "staff", status: "pending_approval" }
}, events: [] });

test("knowledge packs are tenant scoped, checksum bound and cannot silently become persistent memory", () => {
  const result = createAgentKnowledgePack(base(), { packId: "credit-policy", tenantId: "bank-a", name: "Credit policy", version: "4", contentHash: HASH, sourceRef: "policy/credit/v4", validUntil: "2027-07-21", memoryMode: "none", proposedBy: "maker" }, NOW);
  assert.equal(result.record.status, "draft");
  assert.equal(result.record.memoryMode, "none");
  assert.throws(() => createAgentKnowledgePack(result.state, { packId: "bad", tenantId: "bank-a", name: "Bad", version: "1", contentHash: HASH, sourceRef: "x", validUntil: "2027-01-01", memoryMode: "persistent", proposedBy: "maker" }, NOW), (error) => error.code === "agent_knowledge_memory_invalid");
});

test("persistent memory requires purpose, India residency, lifecycle controls and independent approval", () => {
  const input = { memoryStoreId: "memory-1", tenantId: "bank-a", name: "Servicing preferences", purpose: "Remember accessibility preferences", allowedFields: ["preferred_language"], region: "ap-south-1", retentionDays: 90, consentRef: "consent/1", accessPolicyRef: "access/1", correctionProcessRef: "correction/1", deletionProcessRef: "deletion/1", legalHoldPolicyRef: "hold/1", encryptionRef: "kms/1", proposedBy: "privacy-maker" };
  let state = createAgentMemoryStore(base(), input, NOW).state;
  assert.throws(() => approveAgentMemoryStore(state, { memoryStoreId: "memory-1", tenantId: "bank-a", approvedBy: "privacy-maker", approvalRef: "privacy/1" }, NOW), (error) => error.code === "agent_memory_self_approval");
  state = approveAgentMemoryStore(state, { memoryStoreId: "memory-1", tenantId: "bank-a", approvedBy: "privacy-checker", approvalRef: "privacy/1" }, NOW).state;
  assert.equal(state.memoryStores["memory-1"].status, "active");
  assert.throws(() => createAgentMemoryStore(base(), { ...input, memoryStoreId: "outside", region: "ap-southeast-1" }, NOW), (error) => error.code === "agent_memory_region_invalid");
});

test("knowledge approval is four-eyes and expiry suspends dependent active assistants", () => {
  let state = createAgentKnowledgePack(base(), { packId: "credit-policy", tenantId: "bank-a", name: "Credit policy", version: "4", contentHash: HASH, sourceRef: "policy/credit/v4", validUntil: "2026-07-23", proposedBy: "maker" }, NOW).state;
  assert.throws(() => approveAgentKnowledgePack(state, { packId: "credit-policy", tenantId: "bank-a", approvedBy: "maker", approvalRef: "committee/1" }, NOW), (error) => error.code === "agent_knowledge_self_approval");
  state = approveAgentKnowledgePack(state, { packId: "credit-policy", tenantId: "bank-a", approvedBy: "checker", approvalRef: "committee/1" }, NOW).state;
  state.installations.original = { ...state.installations.original, knowledgeSources: [{ ref: "credit-policy", version: "4", contentHash: HASH }] };
  const contained = containExpiredAgentKnowledge(state, { tenantId: "bank-a", actor: "scheduler" }, new Date("2026-07-24T00:00:00Z"));
  assert.equal(contained.state.installations.original.status, "suspended");
  assert.equal(contained.record.suspendedInstallations, 1);
});

test("operations queue derives owned work from failed tests, approvals, expiry and rollback", () => {
  const state = base(); state.testRuns.failed = { runId: "failed", tenantId: "bank-a", installationId: "draft", status: "failed", scorePercent: 50 }; state.rollbackRequests.rb = { rollbackId: "rb", tenantId: "bank-a", status: "pending_approval", installationId: "draft" }; state.knowledgePacks.expiring = { packId: "expiring", tenantId: "bank-a", name: "Policy", status: "active", validUntil: "2026-07-25" };
  const queue = projectAgentOperationsQueue(state, "bank-a", NOW);
  assert.ok(queue.some((item) => item.type === "failed_test" && item.ownerRole === "model_validator"));
  assert.ok(queue.some((item) => item.type === "rollback_approval"));
  assert.ok(queue.some((item) => item.type === "knowledge_expiry"));
});

test("production admission remains blocked until independent current provider evidence exists", () => {
  const input = { evidenceId: "provider-1", tenantId: "bank-a", installationId: "original", providerId: "bedrock-approved", region: "ap-south-1", contractRef: "contract/1", securityRef: "security/1", residencyRef: "residency/1", monitoringRef: "monitoring/1", incidentExerciseRef: "incident/1", institutionUatRef: "uat/1", validUntil: "2027-01-01", proposedBy: "provider-maker" };
  let state = proposeAgentProviderEvidence(base(), input, NOW).state;
  assert.equal(assessAgentProductionAdmission(state, { tenantId: "bank-a", installationId: "original" }, NOW).ready, false);
  assert.throws(() => approveAgentProviderEvidence(state, { evidenceId: "provider-1", tenantId: "bank-a", approvedBy: "provider-maker", approvalRef: "approval/1" }, NOW), (error) => error.code === "agent_provider_self_approval");
  state = approveAgentProviderEvidence(state, { evidenceId: "provider-1", tenantId: "bank-a", approvedBy: "provider-checker", approvalRef: "approval/1" }, NOW).state;
  const assessment = assessAgentProductionAdmission(state, { tenantId: "bank-a", installationId: "original" }, NOW);
  assert.equal(assessment.ready, false);
  assert.ok(assessment.reasons.includes("published_version_missing"));
  assert.ok(assessment.reasons.includes("approvals_incomplete"));
});

test("production admission evaluates installation status, approvals, workflow and model kill-switch", () => {
  const state = base();
  state.installations.pending = { installationId: "pending", tenantId: "bank-a", status: "pending_approval", workflowId: "missing-wf" };
  const assessment = assessAgentProductionAdmission(state, { tenantId: "bank-a", installationId: "pending" }, NOW);
  assert.equal(assessment.ready, false);
  assert.ok(assessment.reasons.includes("installation_not_active"));
  assert.ok(assessment.reasons.includes("approvals_incomplete"));
  assert.ok(assessment.reasons.includes("workflow_invalid_or_missing"));
});

test("production admission consults the model registry without crashing and reports kill-switched models", () => {
  const registry = (globalActive) => ({ globalKillSwitch: { active: globalActive, reason: globalActive ? "incident" : null }, models: { fm1: { modelId: "fm1", version: "1", status: "active", validationStatus: "approved", riskTier: "low", materialDecision: false, customerFacing: false } }, incidents: {}, events: [] });
  const state = base();
  state.installations.original = { ...state.installations.original, modelId: "fm1", modelVersion: "1" };
  const healthy = assessAgentProductionAdmission(state, { tenantId: "bank-a", installationId: "original" }, NOW, registry(false));
  assert.equal(healthy.reasons.includes("model_not_usable"), false);
  const killSwitched = assessAgentProductionAdmission(state, { tenantId: "bank-a", installationId: "original" }, NOW, registry(true));
  assert.ok(killSwitched.reasons.includes("model_not_usable"));
  assert.equal(killSwitched.ready, false);
});

test("agent studio record seals are recomputable from canonical content", () => {
  const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
  const recomputed = (record) => { const { recordHash, ...content } = record; return createHash("sha256").update(canonical(content)).digest("hex"); };
  let state = createAgentKnowledgePack(base(), { packId: "seal-pack", tenantId: "bank-a", name: "Seal policy", version: "1", contentHash: HASH, sourceRef: "policy/seal/v1", validUntil: "2027-07-21", proposedBy: "maker" }, NOW).state;
  assert.equal(state.knowledgePacks["seal-pack"].recordHash, recomputed(state.knowledgePacks["seal-pack"]));
  state = approveAgentKnowledgePack(state, { packId: "seal-pack", tenantId: "bank-a", approvedBy: "checker", approvalRef: "committee/seal" }, NOW).state;
  assert.equal(state.knowledgePacks["seal-pack"].recordHash, recomputed(state.knowledgePacks["seal-pack"]));
});

test("visual workflow accepts only safe business steps and requires a human handoff", () => {
  const safe = createAgentWorkflowDraft(base(), { workflowId: "wf1", tenantId: "bank-a", name: "Application summary", templateId: "credit.cam", productTypes: ["personal_loan"], allowedProductTypes: ["personal_loan"], steps: [{ type: "receive", label: "Receive application" }, { type: "prepare", label: "Prepare summary" }, { type: "human_review", label: "Credit officer reviews" }], proposedBy: "staff" }, NOW);
  assert.equal(safe.record.status, "draft");
  assert.throws(() => createAgentWorkflowDraft(base(), { workflowId: "wf2", tenantId: "bank-a", name: "Unsafe", templateId: "credit.cam", productTypes: ["gold_loan"], allowedProductTypes: ["personal_loan"], steps: [{ type: "approve_loan", label: "Approve" }], proposedBy: "staff" }, NOW), (error) => ["agent_workflow_step_invalid", "agent_workflow_product_not_entitled"].includes(error.code));
});

test("test suites require adverse cases and version comparison highlights authority changes", () => {
  const result = createAgentTestSuite(base(), { suiteId: "suite1", tenantId: "bank-a", name: "CAM checks", installationId: "draft", cases: [{ caseId: "normal", kind: "expected", scenario: "Complete file", expectedOutcome: "proposal" }, { caseId: "missing", kind: "adverse", scenario: "Missing income proof", expectedOutcome: "human_review" }], proposedBy: "tester" }, NOW);
  assert.equal(result.record.caseCount, 2);
  assert.throws(() => createAgentTestSuite(base(), { suiteId: "suite2", tenantId: "bank-a", name: "Only happy", installationId: "draft", cases: [{ caseId: "normal", kind: "expected", scenario: "Complete", expectedOutcome: "proposal" }, { caseId: "normal2", kind: "expected", scenario: "Another complete file", expectedOutcome: "proposal" }], proposedBy: "tester" }, NOW), (error) => error.code === "agent_test_adverse_required");
  const comparison = compareAgentInstallations(base(), { tenantId: "bank-a", fromInstallationId: "original", toInstallationId: "draft" });
  assert.equal(comparison.requiresFreshApproval, true);
  assert.deepEqual(comparison.changes.allowedActions.added, ["evidence.gap_list"]);
});

test("retirement is reversible in record history and blocks active use without deleting evidence", () => {
  const result = retireAgentInstallation(base(), { tenantId: "bank-a", installationId: "original", actor: "operator", reason: "Replaced by v2", exportRef: "exports/original" }, NOW);
  assert.equal(result.record.status, "retired");
  assert.equal(result.state.installations.original.retirement.exportRef, "exports/original");
});

test("Agent Studio API persists visual plans and exposes tenant-scoped exports", async () => {
  let tenantState = { aiAgentPlatform: base(), tenantProductSubscriptions: { sub: { tenantId: "bank-a", status: "active", effectiveFrom: "2026-01-01", validUntil: "2027-01-01", productTypes: ["personal_loan"] } }, events: [] };
  const call = async (method, path, body = {}, actor = "staff", roles = ["auditor"]) => { let response; const handled = await routeAiAgentPlatform({ method, path, req: { url: path, _loanosRequestId: "req" }, res: {}, store: { load: async () => tenantState, save: async (next) => { tenantState = next; } }, readJson: async () => body, sendJson: (_res, status, payload) => { response = { status, payload }; }, appendEvent: (state) => state, authContext: { tenantId: "bank-a", userId: actor, principalType: "tenant_user", roles }, authActor: () => actor }); assert.equal(handled, true); return response; };
  const created = await call("POST", "/ai/agents/workflows", { workflowId: "wf-api", name: "API plan", templateId: "credit.cam", productTypes: ["personal_loan"], steps: [{ type: "receive", label: "Receive" }, { type: "human_review", label: "Review" }] }, "staff", ["model_owner"]);
  assert.equal(created.status, 201);
  const workspace = await call("GET", "/ai/agents");
  assert.equal(workspace.payload.workflowDrafts.length, 1);
  const exported = await call("GET", "/ai/agents/installations/original/export");
  assert.equal(exported.payload.borrowerDataIncluded, false);
  assert.equal(exported.payload.approvalsExcluded, true);
  await call("POST", "/ai/agents/test-suites", { suiteId: "api-suite", name: "API suite", installationId: "draft", cases: [{ caseId: "normal", kind: "expected", scenario: "Complete", expectedOutcome: "proposal" }, { caseId: "adverse", kind: "adverse", scenario: "Missing", expectedOutcome: "human_review" }] }, "staff", ["model_owner"]);
  const run = await call("POST", "/ai/agents/test-suites/api-suite/runs", { runId: "api-run" }, "validator", ["model_validator"]);
  assert.equal(run.payload.status, "passed");
  const version = await call("POST", "/ai/agents/versions", { versionId: "api-v1", installationId: "draft", testRunId: "api-run" }, "release-checker", ["model_validator"]);
  assert.equal(version.payload.status, "published");
  await call("POST", "/ai/agents/rollbacks", { rollbackId: "api-rb", installationId: "draft", targetVersionId: "api-v1", reason: "Regression" }, "operator", ["model_owner"]);
  const rollback = await call("POST", "/ai/agents/rollbacks/api-rb/approve", { approvalRef: "change/api" }, "checker", ["model_validator"]);
  assert.equal(rollback.payload.status, "completed");
  const memoryInput = { memoryStoreId: "api-memory", name: "Preferences", purpose: "Accessibility", allowedFields: ["preferred_language"], region: "ap-south-1", retentionDays: 30, consentRef: "consent/api", accessPolicyRef: "access/api", correctionProcessRef: "correct/api", deletionProcessRef: "delete/api", legalHoldPolicyRef: "hold/api", encryptionRef: "kms/api" };
  await call("POST", "/ai/agents/memory-stores", memoryInput, "privacy-maker", ["privacy_analyst"]);
  const approvedMemory = await call("POST", "/ai/agents/memory-stores/api-memory/approve", { approvalRef: "privacy/api" }, "privacy-checker", ["data_protection_officer"]);
  assert.equal(approvedMemory.payload.status, "active");
  const queue = await call("GET", "/ai/agents/operations-queue");
  assert.ok(Array.isArray(queue.payload.items));
});

test("synthetic test runs score every case and fail release on any unsafe result", () => {
  // An adverse case expecting an outright deny is only satisfied when the probe
  // targets an action outside the approved subset; an in-scope adverse case
  // escalates to a human instead, so this suite fails and blocks release.
  let state = createAgentTestSuite(base(), { suiteId: "suite-run", tenantId: "bank-a", name: "Release gate", installationId: "draft", cases: [{ caseId: "normal", kind: "expected", scenario: "Complete", expectedOutcome: "proposal" }, { caseId: "unsafe", kind: "adverse", scenario: "Prompt injection", expectedOutcome: "deny" }], proposedBy: "tester" }, NOW).state;
  const failed = runAgentTestSuite(state, { runId: "run-bad", suiteId: "suite-run", tenantId: "bank-a", runBy: "tester" }, NOW);
  assert.equal(failed.record.status, "failed");
  assert.throws(() => publishAgentVersion(failed.state, { versionId: "draft-v1", tenantId: "bank-a", installationId: "draft", testRunId: "run-bad", publishedBy: "release-checker" }, NOW), (error) => error.code === "agent_version_test_gate_failed");
  state = createAgentTestSuite(state, { suiteId: "suite-safe", tenantId: "bank-a", name: "Safe gate", installationId: "draft", cases: [{ caseId: "normal", kind: "expected", scenario: "Complete", expectedOutcome: "proposal" }, { caseId: "unsafe", kind: "adverse", scenario: "Prompt injection", probeAction: "loan.sanction", expectedOutcome: "deny" }], proposedBy: "tester" }, NOW).state;
  const passed = runAgentTestSuite(state, { runId: "run-good", suiteId: "suite-safe", tenantId: "bank-a", runBy: "tester" }, NOW);
  assert.equal(passed.record.scorePercent, 100);
});

test("published versions are immutable and rollback requires an independent checker", () => {
  let state = createAgentTestSuite(base(), { suiteId: "suite-release", tenantId: "bank-a", name: "Release", installationId: "draft", cases: [{ caseId: "normal", kind: "expected", scenario: "Complete", expectedOutcome: "proposal" }, { caseId: "adverse", kind: "adverse", scenario: "Missing", expectedOutcome: "human_review" }], proposedBy: "tester" }, NOW).state;
  state = runAgentTestSuite(state, { runId: "run-release", suiteId: "suite-release", tenantId: "bank-a", runBy: "tester" }, NOW).state;
  state = publishAgentVersion(state, { versionId: "draft-v1", tenantId: "bank-a", installationId: "draft", testRunId: "run-release", publishedBy: "release-checker" }, NOW).state;
  assert.equal(state.agentVersions["draft-v1"].status, "published");
  state = proposeAgentRollback(state, { rollbackId: "rb1", tenantId: "bank-a", installationId: "draft", targetVersionId: "draft-v1", reason: "Production regression", proposedBy: "operator" }, NOW).state;
  assert.throws(() => approveAgentRollback(state, { rollbackId: "rb1", tenantId: "bank-a", approvedBy: "operator", approvalRef: "change/1" }, NOW), (error) => error.code === "agent_rollback_self_approval");
  const rolledBack = approveAgentRollback(state, { rollbackId: "rb1", tenantId: "bank-a", approvedBy: "checker", approvalRef: "change/1" }, NOW);
  assert.equal(rolledBack.record.status, "completed");
  assert.equal(rolledBack.state.installations.draft.currentVersionId, "draft-v1");
});
