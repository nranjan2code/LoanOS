import { AI_AGENT_MARKETPLACE_TEMPLATES } from "./ai-agent-platform.js";
import { evaluateModelUse } from "./model-governance.js";
import { contentHash, sealRecord } from "./record-seal.js";

const SAFE_STEP_TYPES = new Set(["receive", "check", "prepare", "request_information", "route", "human_review", "notify", "close"]);

export function createAgentKnowledgePack(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["packId", "tenantId", "name", "version", "contentHash", "sourceRef", "validUntil", "proposedBy"]);
  if (platform.knowledgePacks[input.packId]) fail("agent_knowledge_pack_exists", "Knowledge pack already exists.", 409);
  if (!/^[a-f0-9]{64}$/i.test(input.contentHash)) fail("agent_knowledge_hash_invalid", "Knowledge pack requires a SHA-256 content checksum.");
  if ((input.memoryMode ?? "none") !== "none") fail("agent_knowledge_memory_invalid", "Knowledge packs cannot silently create persistent agent memory.");
  const validUntil = iso(input.validUntil); if (Date.parse(validUntil) <= now.getTime()) fail("agent_knowledge_expired", "Knowledge pack expiry must be in the future.");
  const record = seal({ packId: input.packId, tenantId: input.tenantId, name: input.name, version: String(input.version), contentHash: input.contentHash.toLowerCase(), sourceRef: input.sourceRef, validUntil, memoryMode: "none", status: "draft", proposedBy: input.proposedBy, createdAt: now.toISOString() });
  return save(platform, "knowledgePacks", record.packId, record, "ai_agent.knowledge_pack_created", now);
}

export function approveAgentKnowledgePack(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["packId", "tenantId", "approvedBy", "approvalRef"]); const pack = own(platform.knowledgePacks[input.packId], input.tenantId, "agent_knowledge_pack_missing");
  if (pack.status !== "draft") fail("agent_knowledge_not_pending", "Knowledge pack is not awaiting approval.", 409); if (pack.proposedBy === input.approvedBy) fail("agent_knowledge_self_approval", "Knowledge approval needs an independent checker.", 403);
  const record = seal({ ...pack, status: "active", approvedBy: input.approvedBy, approvalRef: input.approvalRef, approvedAt: now.toISOString() }); return save(platform, "knowledgePacks", record.packId, record, "ai_agent.knowledge_pack_approved", now);
}

export function containExpiredAgentKnowledge(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["tenantId", "actor"]); const expired = Object.values(platform.knowledgePacks).filter((pack) => pack.tenantId === input.tenantId && pack.status === "active" && Date.parse(pack.validUntil) <= now.getTime()); const expiredIds = new Set(expired.map((pack) => pack.packId)); let suspendedInstallations = 0;
  const installations = Object.fromEntries(Object.entries(platform.installations).map(([id, installation]) => { if (installation.tenantId !== input.tenantId || installation.status !== "active" || !(installation.knowledgeSources ?? []).some((source) => expiredIds.has(source.ref))) return [id, installation]; suspendedInstallations += 1; return [id, seal({ ...installation, status: "suspended", suspension: { reason: "required_knowledge_expired", actor: input.actor, expiredPackIds: [...expiredIds], suspendedAt: now.toISOString() } })]; }));
  const knowledgePacks = Object.fromEntries(Object.entries(platform.knowledgePacks).map(([id, pack]) => [id, expiredIds.has(id) ? seal({ ...pack, status: "expired", expiredAt: now.toISOString() }) : pack])); const record = seal({ containmentId: `knowledge-expiry:${input.tenantId}:${now.toISOString()}`, tenantId: input.tenantId, expiredPackIds: [...expiredIds], suspendedInstallations, actor: input.actor, containedAt: now.toISOString() }); return { state: { ...platform, installations, knowledgePacks, events: [...platform.events, { type: "ai_agent.knowledge_expiry_contained", resourceId: record.containmentId, recordHash: record.recordHash, at: now.toISOString() }] }, record };
}

export function scheduleKnowledgeExpiryContainment(state, input, now = new Date()) {
  const containment = containExpiredAgentKnowledge(state, input, now);
  const nextScheduledAt = new Date(now.getTime() + 60 * 60_000).toISOString();
  return {
    ...containment,
    schedule: {
      tenantId: input.tenantId,
      intervalMinutes: 60,
      nextScheduledAt,
      actor: input.actor
    }
  };
}

export function createAgentMemoryStore(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["memoryStoreId", "tenantId", "name", "purpose", "allowedFields", "region", "retentionDays", "consentRef", "accessPolicyRef", "correctionProcessRef", "deletionProcessRef", "legalHoldPolicyRef", "encryptionRef", "proposedBy"]); if (platform.memoryStores[input.memoryStoreId]) fail("agent_memory_store_exists", "Memory store already exists.", 409); if (input.region !== "ap-south-1") fail("agent_memory_region_invalid", "Agent memory must remain in the approved India region.", 403); const retentionDays = Number(input.retentionDays); if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) fail("agent_memory_retention_invalid", "Memory retention must be between 1 and 365 days."); const allowedFields = unique(input.allowedFields); if (!allowedFields.length) fail("agent_memory_fields_required", "Declare at least one permitted memory field.");
  const record = seal({ memoryStoreId: input.memoryStoreId, tenantId: input.tenantId, name: input.name, purpose: input.purpose, allowedFields, region: input.region, retentionDays, consentRef: input.consentRef, accessPolicyRef: input.accessPolicyRef, correctionProcessRef: input.correctionProcessRef, deletionProcessRef: input.deletionProcessRef, legalHoldPolicyRef: input.legalHoldPolicyRef, encryptionRef: input.encryptionRef, status: "pending_approval", proposedBy: input.proposedBy, createdAt: now.toISOString() }); return save(platform, "memoryStores", record.memoryStoreId, record, "ai_agent.memory_store_proposed", now);
}

export function approveAgentMemoryStore(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["memoryStoreId", "tenantId", "approvedBy", "approvalRef"]); const store = own(platform.memoryStores[input.memoryStoreId], input.tenantId, "agent_memory_store_missing"); if (store.status !== "pending_approval") fail("agent_memory_not_pending", "Memory store is not awaiting approval.", 409); if (store.proposedBy === input.approvedBy) fail("agent_memory_self_approval", "Memory approval needs an independent privacy checker.", 403); const record = seal({ ...store, status: "active", approvedBy: input.approvedBy, approvalRef: input.approvalRef, approvedAt: now.toISOString() }); return save(platform, "memoryStores", record.memoryStoreId, record, "ai_agent.memory_store_approved", now);
}

export function projectAgentOperationsQueue(state, tenantId, now = new Date()) {
  const platform = normalize(state); const items = [];
  for (const run of Object.values(platform.testRuns)) if (run.tenantId === tenantId && run.status === "failed") items.push({ taskId: `test:${run.runId}`, type: "failed_test", title: `Review failed rehearsal ${run.runId}`, ownerRole: "model_validator", dueAt: now.toISOString(), resourceId: run.runId, severity: "high" });
  for (const request of Object.values(platform.rollbackRequests)) if (request.tenantId === tenantId && request.status === "pending_approval") items.push({ taskId: `rollback:${request.rollbackId}`, type: "rollback_approval", title: `Independently review rollback ${request.rollbackId}`, ownerRole: "operator", dueAt: now.toISOString(), resourceId: request.rollbackId, severity: "high" });
  for (const pack of Object.values(platform.knowledgePacks)) if (pack.tenantId === tenantId && ["draft", "active"].includes(pack.status)) { const days = Math.ceil((Date.parse(pack.validUntil) - now.getTime()) / 86_400_000); if (pack.status === "draft") items.push({ taskId: `knowledge-approval:${pack.packId}`, type: "knowledge_approval", title: `Approve knowledge pack ${pack.name}`, ownerRole: "compliance", dueAt: pack.validUntil, resourceId: pack.packId, severity: "medium" }); else if (days <= 30) items.push({ taskId: `knowledge-expiry:${pack.packId}`, type: "knowledge_expiry", title: `${pack.name} expires in ${Math.max(0, days)} days`, ownerRole: "compliance", dueAt: pack.validUntil, resourceId: pack.packId, severity: days <= 7 ? "high" : "medium" }); }
  for (const budget of Object.values(platform.usageBudgets ?? {})) if (budget.tenantId === tenantId && budget.status === "pending_approval") items.push({ taskId: `budget:${budget.budgetId}`, type: "budget_approval", title: `Approve spending limit ${budget.budgetId}`, ownerRole: "finance", dueAt: budget.validUntil, resourceId: budget.budgetId, severity: "medium" });
  // Completed agent proposals are not done until a person disposes of them:
  // every unreviewed proposal/handoff execution is owned human work.
  for (const execution of Object.values(platform.executions)) if (execution.tenantId === tenantId && execution.status === "completed" && ["proposal_created", "human_handoff"].includes(execution.outcome) && !execution.humanReview) items.push({ taskId: `proposal:${execution.executionId}`, type: "proposal_review", title: `Review agent proposal from ${execution.installationId}`, ownerRole: "human_reviewer", dueAt: execution.completedAt ?? now.toISOString(), resourceId: execution.executionId, severity: execution.outcome === "human_handoff" ? "high" : "medium" });
  return items.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export function proposeAgentProviderEvidence(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["evidenceId", "tenantId", "installationId", "providerId", "region", "contractRef", "securityRef", "residencyRef", "monitoringRef", "incidentExerciseRef", "institutionUatRef", "validUntil", "proposedBy"]); if (platform.providerEvidence[input.evidenceId]) fail("agent_provider_evidence_exists", "Provider evidence already exists.", 409); own(platform.installations[input.installationId], input.tenantId, "ai_agent_installation_missing"); if (input.region !== "ap-south-1") fail("agent_provider_region_invalid", "Provider processing must be evidenced in the approved India region.", 403); const validUntil = iso(input.validUntil); if (Date.parse(validUntil) <= now.getTime()) fail("agent_provider_evidence_expired", "Provider evidence must be current."); const record = seal({ evidenceId: input.evidenceId, tenantId: input.tenantId, installationId: input.installationId, providerId: input.providerId, region: input.region, contractRef: input.contractRef, securityRef: input.securityRef, residencyRef: input.residencyRef, monitoringRef: input.monitoringRef, incidentExerciseRef: input.incidentExerciseRef, institutionUatRef: input.institutionUatRef, validUntil, status: "pending_approval", proposedBy: input.proposedBy, proposedAt: now.toISOString() }); return save(platform, "providerEvidence", record.evidenceId, record, "ai_agent.provider_evidence_proposed", now);
}

export function approveAgentProviderEvidence(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["evidenceId", "tenantId", "approvedBy", "approvalRef"]); const evidence = own(platform.providerEvidence[input.evidenceId], input.tenantId, "agent_provider_evidence_missing"); if (evidence.status !== "pending_approval") fail("agent_provider_evidence_not_pending", "Provider evidence is not awaiting approval.", 409); if (evidence.proposedBy === input.approvedBy) fail("agent_provider_self_approval", "Provider evidence needs an independent checker.", 403); const record = seal({ ...evidence, status: "active", approvedBy: input.approvedBy, approvalRef: input.approvalRef, approvedAt: now.toISOString() }); return save(platform, "providerEvidence", record.evidenceId, record, "ai_agent.provider_evidence_approved", now);
}

export function assessAgentProductionAdmission(state, input, now = new Date(), modelRegistry = null) {
  const platform = normalize(state); const installation = own(platform.installations[input.installationId], input.tenantId, "ai_agent_installation_missing"); const reasons = [];
  if (installation.status !== "active") reasons.push("installation_not_active");
  if (!installation.currentVersionId || !platform.agentVersions[installation.currentVersionId]) reasons.push("published_version_missing");
  if (Object.keys(installation.approvedByRole ?? {}).length !== 4) reasons.push("approvals_incomplete");
  if (installation.workflowId) {
    const workflow = platform.workflowDrafts[installation.workflowId];
    if (!workflow || workflow.tenantId !== input.tenantId) reasons.push("workflow_invalid_or_missing");
  }
  const provider = Object.values(platform.providerEvidence).find((item) => item.tenantId === input.tenantId && item.installationId === installation.installationId && item.status === "active" && Date.parse(item.validUntil) > now.getTime()); if (!provider) reasons.push("provider_evidence_missing_or_stale");
  if ((installation.knowledgeSources ?? []).some((source) => { const pack = platform.knowledgePacks[source.ref]; return !pack || pack.status !== "active" || Date.parse(pack.validUntil) <= now.getTime(); })) reasons.push("knowledge_not_current");
  if (installation.memoryMode === "governed_persistent") { const memory = platform.memoryStores[installation.memoryStoreId]; if (!memory || memory.status !== "active" || memory.region !== "ap-south-1") reasons.push("memory_store_not_approved"); }
  if (installation.contractId && !Object.values(platform.usageBudgets).some((budget) => budget.tenantId === input.tenantId && budget.contractId === installation.contractId && budget.status === "active" && Date.parse(budget.validUntil) > now.getTime())) reasons.push("active_budget_missing");
  if (modelRegistry) {
    const modelUse = evaluateModelUse(modelRegistry, { modelId: installation.modelId });
    if (!modelUse.allowed) reasons.push("model_not_usable");
  }
  return { installationId: installation.installationId, tenantId: input.tenantId, ready: reasons.length === 0, outcome: reasons.length ? "deny" : "allow", reasons, providerEvidenceId: provider?.evidenceId ?? null, assessedAt: now.toISOString(), productionCertificationClaimed: false };
}

export function createAgentWorkflowDraft(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["workflowId", "tenantId", "name", "templateId", "productTypes", "steps", "proposedBy"]);
  if (platform.workflowDrafts[input.workflowId]) fail("agent_workflow_exists", "Workflow draft already exists.", 409);
  if (!AI_AGENT_MARKETPLACE_TEMPLATES[input.templateId]) fail("agent_workflow_template_invalid", "Choose an approved banking template.");
  const productTypes = unique(input.productTypes); if (Array.isArray(input.allowedProductTypes) && productTypes.some((item) => !input.allowedProductTypes.includes(item))) fail("agent_workflow_product_not_entitled", "Workflow must stay within active tenant journeys.", 403);
  if (!Array.isArray(input.steps) || input.steps.length < 2 || input.steps.length > 12) fail("agent_workflow_steps_invalid", "Use between 2 and 12 workflow steps.");
  const steps = input.steps.map((step, index) => { required(step, ["type", "label"]); if (!SAFE_STEP_TYPES.has(step.type)) fail("agent_workflow_step_invalid", `Step ${index + 1} is not permitted.`); return { order: index + 1, type: step.type, label: String(step.label).slice(0, 120) }; });
  if (!steps.some((step) => step.type === "human_review")) fail("agent_workflow_human_review_required", "Every workflow needs an explicit human review step.");
  const record = seal({ workflowId: input.workflowId, tenantId: input.tenantId, name: input.name, templateId: input.templateId, productTypes, steps, status: "draft", proposedBy: input.proposedBy, createdAt: now.toISOString() });
  return save(platform, "workflowDrafts", record.workflowId, record, "ai_agent.workflow_draft_created", now);
}

export function createAgentTestSuite(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["suiteId", "tenantId", "name", "installationId", "cases", "proposedBy"]);
  if (platform.testSuites[input.suiteId]) fail("agent_test_suite_exists", "Test suite already exists.", 409);
  const installation = own(platform.installations[input.installationId], input.tenantId, "agent_test_installation_missing");
  if (!Array.isArray(input.cases) || input.cases.length < 2) fail("agent_test_cases_invalid", "Add at least two test cases.");
  if (!input.cases.some((item) => item.kind === "adverse")) fail("agent_test_adverse_required", "Include at least one uncertain, missing-data or unsafe case.");
  const cases = input.cases.map((item) => { required(item, ["caseId", "kind", "scenario", "expectedOutcome"]); if (!["expected", "adverse"].includes(item.kind) || !["proposal", "human_review", "deny"].includes(item.expectedOutcome)) fail("agent_test_case_invalid", "Test case kind or expected outcome is invalid."); if (item.probeAction !== undefined && (typeof item.probeAction !== "string" || !item.probeAction)) fail("agent_test_probe_invalid", "probeAction must be a non-empty action name when present."); return { caseId: item.caseId, kind: item.kind, scenario: item.scenario, expectedOutcome: item.expectedOutcome, probeAction: item.probeAction ?? null }; });
  const record = seal({ suiteId: input.suiteId, tenantId: input.tenantId, name: input.name, installationId: installation.installationId, installationHash: installation.recordHash ?? null, cases, caseCount: cases.length, status: "draft", proposedBy: input.proposedBy, createdAt: now.toISOString() });
  return save(platform, "testSuites", record.suiteId, record, "ai_agent.test_suite_created", now);
}

/**
 * Execute a rehearsal suite inside the governed server harness. The
 * observed outcome of every case is DERIVED HERE from the recorded
 * configuration — never accepted from a client — so a browser (or any
 * other caller) cannot fabricate a passing release gate:
 *
 * - an `expected` case observes `proposal` only when the configuration is
 *   coherent (known template, non-empty action subset within the template,
 *   valid prompt checksum, installation not suspended/retired);
 * - an `adverse` case with a `probeAction` outside the approved action
 *   subset observes `deny` — the harness proves out-of-scope requests are
 *   refused rather than escalated;
 * - any other `adverse` case observes `human_review` only when the human
 *   path is guaranteed (a human sponsor is recorded and any bound
 *   workflow contains an explicit `human_review` step); otherwise `deny`.
 *
 * Each result carries a recomputable evidence checksum over the checks the
 * harness evaluated. Runs remain synthetic: they verify configuration and
 * release controls, not live-model quality (`simulated: true`).
 */
export function runAgentTestSuite(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["runId", "suiteId", "tenantId", "runBy"]);
  if (platform.testRuns[input.runId]) fail("agent_test_run_exists", "Test run already exists.", 409);
  const suite = own(platform.testSuites[input.suiteId], input.tenantId, "agent_test_suite_missing");
  const installation = own(platform.installations[suite.installationId], input.tenantId, "agent_test_installation_missing");
  const template = AI_AGENT_MARKETPLACE_TEMPLATES[installation.templateId];
  const allowedActions = installation.allowedActions ?? [];
  const configOk = Boolean(template) && !["suspended", "retired"].includes(installation.status)
    && allowedActions.length > 0 && allowedActions.every((action) => template.allowedActions.includes(action))
    && /^[a-f0-9]{64}$/i.test(installation.promptHash ?? "");
  const workflow = installation.workflowId ? platform.workflowDrafts[installation.workflowId] : null;
  const humanPathOk = Boolean(installation.humanSponsorPrincipalId)
    && (!installation.workflowId || Boolean(workflow && workflow.tenantId === input.tenantId && workflow.steps.some((step) => step.type === "human_review")));
  const results = suite.cases.map((testCase) => {
    const observedOutcome = testCase.kind === "expected"
      ? (configOk ? "proposal" : "deny")
      : (testCase.probeAction && !allowedActions.includes(testCase.probeAction)) ? "deny"
      : (configOk && humanPathOk) ? "human_review" : "deny";
    const evidenceHash = hash({ runId: input.runId, caseId: testCase.caseId, checks: { configOk, humanPathOk, probeAction: testCase.probeAction ?? null }, observedOutcome });
    return { caseId: testCase.caseId, kind: testCase.kind, expectedOutcome: testCase.expectedOutcome, observedOutcome, passed: observedOutcome === testCase.expectedOutcome, evidenceHash };
  });
  const passedCount = results.filter((item) => item.passed).length; const scorePercent = Math.floor((passedCount * 100) / results.length); const adversePassed = results.filter((item) => item.kind === "adverse").every((item) => item.passed);
  const record = seal({ runId: input.runId, suiteId: suite.suiteId, tenantId: input.tenantId, installationId: suite.installationId, installationHash: suite.installationHash, source: "synthetic_harness", simulated: true, commerciallyLive: false, results, passedCount, caseCount: results.length, scorePercent, adversePassed, status: passedCount === results.length && adversePassed ? "passed" : "failed", runBy: input.runBy, runAt: now.toISOString() });
  return save(platform, "testRuns", record.runId, record, "ai_agent.test_run_recorded", now);
}

export function publishAgentVersion(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["versionId", "tenantId", "installationId", "testRunId", "publishedBy"]);
  if (platform.agentVersions[input.versionId]) fail("agent_version_exists", "Assistant version already exists.", 409);
  const installation = own(platform.installations[input.installationId], input.tenantId, "ai_agent_installation_missing"); const run = own(platform.testRuns[input.testRunId], input.tenantId, "agent_version_test_run_missing");
  if (run.installationId !== installation.installationId || run.installationHash !== (installation.recordHash ?? null)) fail("agent_version_test_stale", "Tests must match this exact assistant draft.");
  if (run.status !== "passed" || run.scorePercent !== 100 || !run.adversePassed) fail("agent_version_test_gate_failed", "Every normal and adverse test must pass before publication.", 409);
  if (input.publishedBy === installation.proposedBy) fail("agent_version_self_publication", "The assistant proposer cannot publish the version.", 403);
  if (Object.keys(installation.approvedByRole ?? {}).length !== 4) fail("agent_version_approvals_incomplete", "Four independent human approvals are required before publication.", 409);
  const configuration = snapshot(installation); const record = seal({ versionId: input.versionId, versionNumber: Object.values(platform.agentVersions).filter((item) => item.installationId === installation.installationId).length + 1, tenantId: input.tenantId, installationId: installation.installationId, configuration, configurationHash: hash(configuration), testRunId: run.runId, testRunHash: run.recordHash, status: "published", publishedBy: input.publishedBy, publishedAt: now.toISOString() });
  const nextInstallation = seal({ ...installation, currentVersionId: record.versionId, currentVersionNumber: record.versionNumber, versionPublishedAt: record.publishedAt });
  return { state: { ...platform, agentVersions: { ...platform.agentVersions, [record.versionId]: record }, installations: { ...platform.installations, [installation.installationId]: nextInstallation }, events: [...platform.events, { type: "ai_agent.version_published", resourceId: record.versionId, recordHash: record.recordHash, at: now.toISOString() }] }, record };
}

export function proposeAgentRollback(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["rollbackId", "tenantId", "installationId", "targetVersionId", "reason", "proposedBy"]);
  if (platform.rollbackRequests[input.rollbackId]) fail("agent_rollback_exists", "Rollback request already exists.", 409);
  own(platform.installations[input.installationId], input.tenantId, "ai_agent_installation_missing"); const target = own(platform.agentVersions[input.targetVersionId], input.tenantId, "agent_rollback_version_missing");
  if (target.installationId !== input.installationId || target.status !== "published") fail("agent_rollback_version_invalid", "Rollback target must be a published version of this assistant.");
  const record = seal({ rollbackId: input.rollbackId, tenantId: input.tenantId, installationId: input.installationId, targetVersionId: target.versionId, reason: input.reason, status: "pending_approval", proposedBy: input.proposedBy, proposedAt: now.toISOString(), approvedBy: null, approvalRef: null });
  return save(platform, "rollbackRequests", record.rollbackId, record, "ai_agent.rollback_proposed", now);
}

export function approveAgentRollback(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["rollbackId", "tenantId", "approvedBy", "approvalRef"]); const request = own(platform.rollbackRequests[input.rollbackId], input.tenantId, "agent_rollback_missing");
  if (request.status !== "pending_approval") fail("agent_rollback_not_pending", "Rollback is not pending approval.", 409); if (request.proposedBy === input.approvedBy) fail("agent_rollback_self_approval", "Rollback needs an independent checker.", 403);
  const target = own(platform.agentVersions[request.targetVersionId], input.tenantId, "agent_rollback_version_missing"); const installation = own(platform.installations[request.installationId], input.tenantId, "ai_agent_installation_missing"); const restored = seal({ ...installation, ...target.configuration, currentVersionId: target.versionId, currentVersionNumber: target.versionNumber, rolledBackAt: now.toISOString() }); const record = seal({ ...request, status: "completed", approvedBy: input.approvedBy, approvalRef: input.approvalRef, completedAt: now.toISOString() });
  return { state: { ...platform, installations: { ...platform.installations, [installation.installationId]: restored }, rollbackRequests: { ...platform.rollbackRequests, [record.rollbackId]: record }, events: [...platform.events, { type: "ai_agent.rollback_completed", resourceId: record.rollbackId, recordHash: record.recordHash, at: now.toISOString() }] }, record };
}

export function compareAgentInstallations(state, input) {
  const platform = normalize(state); const from = own(platform.installations[input.fromInstallationId], input.tenantId, "agent_comparison_source_missing"); const to = own(platform.installations[input.toInstallationId], input.tenantId, "agent_comparison_target_missing");
  const changes = { allowedActions: setDiff(from.allowedActions, to.allowedActions), productTypes: setDiff(from.productTypes, to.productTypes), dataScopes: setDiff(from.dataScopes, to.dataScopes), memoryMode: scalar(from.memoryMode, to.memoryMode), prompt: scalar(from.promptHash, to.promptHash), model: scalar(`${from.modelId ?? ""}:${from.modelVersion ?? ""}`, `${to.modelId ?? ""}:${to.modelVersion ?? ""}`) };
  return { fromInstallationId: from.installationId, toInstallationId: to.installationId, changes, requiresFreshApproval: Object.values(changes).some((change) => change.changed || change.added?.length || change.removed?.length) };
}

export function retireAgentInstallation(state, input, now = new Date()) {
  const platform = normalize(state); required(input, ["tenantId", "installationId", "actor", "reason", "exportRef"]); const installation = own(platform.installations[input.installationId], input.tenantId, "ai_agent_installation_missing");
  if (installation.status === "retired") fail("agent_installation_already_retired", "Assistant is already retired.", 409);
  const record = seal({ ...installation, status: "retired", retirement: { reason: input.reason, exportRef: input.exportRef, retiredBy: input.actor, retiredAt: now.toISOString() } });
  return save(platform, "installations", record.installationId, record, "ai_agent.installation_retired", now);
}

export function projectAgentConfigurationExport(state, input) {
  const installation = own(normalize(state).installations[input.installationId], input.tenantId, "ai_agent_installation_missing");
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), installation: Object.fromEntries(Object.entries(installation).filter(([key]) => !["approvedByRole", "governanceEvidence", "activationControl"].includes(key))), approvalsExcluded: true, borrowerDataIncluded: false };
}

function normalize(state = {}) { return { ...state, installations: state.installations ?? {}, executions: state.executions ?? {}, knowledgePacks: state.knowledgePacks ?? {}, memoryStores: state.memoryStores ?? {}, providerEvidence: state.providerEvidence ?? {}, workflowDrafts: state.workflowDrafts ?? {}, testSuites: state.testSuites ?? {}, testRuns: state.testRuns ?? {}, agentVersions: state.agentVersions ?? {}, rollbackRequests: state.rollbackRequests ?? {}, usageBudgets: state.usageBudgets ?? {}, events: state.events ?? [] }; }
function save(state, collection, id, record, type, now) { return { state: { ...state, [collection]: { ...state[collection], [id]: record }, events: [...state.events, { type, resourceId: id, recordHash: record.recordHash, at: now.toISOString() }] }, record }; }
const seal = sealRecord;
function required(value, keys) { for (const key of keys) if (value?.[key] === undefined || value?.[key] === null || value?.[key] === "") fail("agent_studio_field_required", `${key} is required.`); }
function own(record, tenantId, code) { if (!record || record.tenantId !== tenantId) fail(code, "A same-tenant record is required.", 404); return record; }
function unique(values) { if (!Array.isArray(values)) fail("agent_studio_array_invalid", "Expected a list."); return [...new Set(values.map(String))]; }
function iso(value) { const date = new Date(value); if (!Number.isFinite(date.getTime())) fail("agent_studio_date_invalid", "Enter a valid date."); return date.toISOString(); }
function setDiff(left = [], right = []) { return { added: right.filter((item) => !left.includes(item)), removed: left.filter((item) => !right.includes(item)) }; }
function scalar(from, to) { return { from, to, changed: from !== to }; }
const hash = contentHash;
function snapshot(installation) { return Object.fromEntries(["templateId", "templateVersion", "modelId", "modelVersion", "allowedActions", "productTypes", "dataScopes", "memoryMode", "promptRef", "promptHash", "configurationRef", "knowledgeSources", "workloadPrincipalId", "humanSponsorPrincipalId", "workflowId"].filter((key) => installation[key] !== undefined).map((key) => [key, installation[key]])); }
function fail(code, message, status = 422) { throw Object.assign(new Error(message), { code, status }); }
