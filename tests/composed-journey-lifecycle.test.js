import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPOSED_JOURNEY_STAGES,
  COMPOSED_JOURNEY_STAGE_DEFINITIONS,
  approveComposedJourneyTransition,
  createComposedJourneyInstance,
  pauseComposedJourneysForPrincipal,
  pauseComposedJourneysForProduct,
  projectComposedJourneyInstance,
  projectComposedJourneyPortfolio,
  proposeComposedJourneyTransition,
  recordComposedJourneyFailure,
  resumeComposedJourneyInstance,
  validateComposedJourneyLifecycleCatalogue
} from "../packages/core/src/composed-journey-lifecycle.js";
import { JOURNEY_WORKSPACE_SCHEMAS, PRODUCT_TO_WORKSPACE_ARCHETYPE } from "../packages/core/src/journey-workspace.js";
import { PRODUCT_JOURNEY_TYPES } from "../packages/core/src/product-journey-administration.js";
import { PRODUCT_TEMPLATE_CATALOGUE } from "../packages/core/src/product-template-catalogue.js";
import { PERSISTENT_SPECIALIST_JOURNEY_TYPES } from "../packages/core/src/specialist-journey-service.js";

const NOW = "2026-07-15T06:30:00.000Z";
const H = "a".repeat(64);
const subscription = { subscriptionId: "sub-all", tenantId: "tenant-a", productTypes: PRODUCT_JOURNEY_TYPES, effectiveFrom: "2026-01-01T00:00:00.000Z", validUntil: "2030-01-01T00:00:00.000Z", status: "active" };
const initialState = () => ({
  tenantProductSubscriptions: { "sub-all": subscription },
  specialistJourneyConfigurations: Object.fromEntries(PERSISTENT_SPECIALIST_JOURNEY_TYPES.map((journeyType) => [`tenant-a:config-${journeyType}`, { tenantId: "tenant-a", configurationId: `config-${journeyType}`, journeyType, version: 1, status: "active", configurationChecksumSha256: H }]))
});
const evidence = (kind) => ({ kind, ref: `evidence/${kind}`, checksumSha256: H });

function creation(journeyType = "personal_loan", suffix = journeyType) {
  const archetype = PRODUCT_TO_WORKSPACE_ARCHETYPE[journeyType];
  const template = PRODUCT_TEMPLATE_CATALOGUE[journeyType];
  return {
    tenantId: "tenant-a", lifecycleId: `lc-${suffix}`, journeyType,
    subjectRef: `subject/${suffix}`, applicationRef: `application/${suffix}`,
    requestedAmountPaise: "2500000", assignedPrincipalIds: ["maker-1", "checker-1"],
    idempotencyKey: `create/${suffix}`, createdBy: "maker-1",
    lineage: {
      productTemplateRef: template.templateId, productTemplateVersion: template.version, productTemplateChecksumSha256: template.templateChecksumSha256,
      workspaceSchemaId: JOURNEY_WORKSPACE_SCHEMAS[archetype].schemaId, workspaceSchemaVersion: 1, workspaceSchemaChecksumSha256: JOURNEY_WORKSPACE_SCHEMAS[archetype].schemaChecksumSha256,
      policyBundleRef: `policy/${journeyType}`, policyBundleVersion: 1, policyBundleChecksumSha256: H,
      workflowRef: `workflow/${journeyType}`, workflowVersion: 1, workflowChecksumSha256: H,
      accountingPolicyRef: `accounting/${journeyType}`, accountingPolicyVersion: 1, accountingPolicyChecksumSha256: H,
      tenantConfigurationRef: "configuration/tenant-a", tenantConfigurationVersion: 1, tenantConfigurationChecksumSha256: H,
      accessGrantSnapshotRef: "access/snapshot-1", accessGrantSnapshotChecksumSha256: H,
      ...(PERSISTENT_SPECIALIST_JOURNEY_TYPES.includes(journeyType) ? { specialistConfigurationRef: `config-${journeyType}`, specialistConfigurationVersion: 1, specialistConfigurationChecksumSha256: H } : {})
    }
  };
}

function proposal(lifecycle, suffix = "1") {
  const definition = COMPOSED_JOURNEY_STAGE_DEFINITIONS[lifecycle.currentStage];
  return {
    tenantId: "tenant-a", lifecycleId: lifecycle.lifecycleId, transitionId: `transition-${suffix}`,
    idempotencyKey: `transition/${suffix}`, expectedRevision: lifecycle.revision,
    expectedCurrentStage: lifecycle.currentStage, targetStage: definition.nextStage,
    proposedBy: "maker-1", purpose: "complete governed stage",
    evidenceManifest: {
      sourceStateRef: lifecycle.stateRef, sourceStateChecksumSha256: lifecycle.stateChecksumSha256,
      artifacts: definition.requiredEvidenceKinds.map(evidence), financials: { requestedAmountPaise: "2500000" }
    }
  };
}

test("the 13-step composed lifecycle covers all 21 products through 11 governed workspace archetypes", () => {
  assert.deepEqual(validateComposedJourneyLifecycleCatalogue(), { valid: true, errors: [], journeyCount: 21, stageCount: 13 });
  assert.equal(COMPOSED_JOURNEY_STAGES.at(-1), "completed");
  assert.equal(new Set(PRODUCT_JOURNEY_TYPES.map((type) => PRODUCT_TO_WORKSPACE_ARCHETYPE[type])).size, 11);
  let state = initialState();
  for (const journeyType of PRODUCT_JOURNEY_TYPES) {
    const result = createComposedJourneyInstance(state, creation(journeyType), NOW);
    state = result.state;
    assert.equal(result.lifecycle.workspaceArchetype, PRODUCT_TO_WORKSPACE_ARCHETYPE[journeyType]);
    assert.match(result.lifecycle.stateChecksumSha256, /^[a-f0-9]{64}$/);
  }
  const portfolio = projectComposedJourneyPortfolio(state, { tenantId: "tenant-a" });
  assert.equal(portfolio.summary.total, 21);
  assert.equal(projectComposedJourneyPortfolio(state, { tenantId: "tenant-b" }).summary.total, 0);
});

test("all 21 products execute every ordered composition gate through completed", () => {
  for (const journeyType of PRODUCT_JOURNEY_TYPES) {
    let result = createComposedJourneyInstance(initialState(), creation(journeyType, `full-${journeyType}`), NOW);
    let state = result.state;
    let lifecycle = result.lifecycle;
    for (let index = 0; index < COMPOSED_JOURNEY_STAGES.length - 1; index += 1) {
      const input = proposal(lifecycle, `${journeyType}-${index}`);
      const proposed = proposeComposedJourneyTransition(state, input, NOW);
      const approved = approveComposedJourneyTransition(proposed.state, { tenantId: "tenant-a", transitionId: proposed.transition.transitionId, approvedBy: "checker-1", approvalRef: `approval/${journeyType}/${index}` }, NOW);
      state = approved.state;
      lifecycle = approved.lifecycle;
    }
    assert.equal(lifecycle.currentStage, "completed", journeyType);
    assert.equal(lifecycle.status, "completed", journeyType);
    assert.equal(lifecycle.transitionHistory.length, 12, journeyType);
  }
});

test("entitlement, exact money, staffing, assignment and tenant scope fail closed", () => {
  assert.throws(() => createComposedJourneyInstance({}, creation(), NOW), (error) => error.code === "composed_journey_not_entitled");
  assert.throws(() => createComposedJourneyInstance(initialState(), { ...creation(), requestedAmountPaise: "25000.00" }, NOW), (error) => error.code === "composed_journey_money_invalid");
  assert.throws(() => createComposedJourneyInstance(initialState(), { ...creation(), assignedPrincipalIds: ["maker-1"] }, NOW), (error) => error.code === "composed_journey_understaffed");
  assert.throws(() => createComposedJourneyInstance(initialState(), { ...creation(), createdBy: "intruder" }, NOW), (error) => error.code === "composed_journey_actor_not_assigned");
  const created = createComposedJourneyInstance(initialState(), creation(), NOW);
  assert.throws(() => projectComposedJourneyInstance(created.state, { tenantId: "tenant-b", lifecycleId: created.lifecycle.lifecycleId }), (error) => error.code === "composed_journey_not_found");
  const tampered = structuredClone(created.state);
  tampered.composedJourneyLifecycles[created.lifecycle.lifecycleId].lineage.policyBundleRef = "policy/tampered";
  assert.throws(() => projectComposedJourneyInstance(tampered, { tenantId: "tenant-a", lifecycleId: created.lifecycle.lifecycleId }), (error) => error.code === "composed_journey_integrity_failure");
  const specialistInput = creation("home_loan");
  assert.throws(() => createComposedJourneyInstance({ ...initialState(), specialistJourneyConfigurations: {} }, specialistInput, NOW), (error) => error.code === "composed_journey_specialist_configuration_mismatch");
});

test("ordered evidence-bound transitions are replay safe and require an independent assigned checker", () => {
  const created = createComposedJourneyInstance(initialState(), creation(), NOW);
  assert.throws(() => proposeComposedJourneyTransition(created.state, { ...proposal(created.lifecycle), targetStage: "credit_decision" }, NOW), (error) => error.code === "composed_journey_stage_skip");
  const incomplete = proposal(created.lifecycle, "incomplete");
  incomplete.evidenceManifest.artifacts = incomplete.evidenceManifest.artifacts.slice(1);
  assert.throws(() => proposeComposedJourneyTransition(created.state, incomplete, NOW), (error) => error.code === "composed_journey_evidence_incomplete");
  const proposed = proposeComposedJourneyTransition(created.state, proposal(created.lifecycle), NOW);
  assert.equal(proposeComposedJourneyTransition(proposed.state, proposal(created.lifecycle), NOW).idempotent, true);
  assert.throws(() => approveComposedJourneyTransition(proposed.state, { tenantId: "tenant-a", transitionId: proposed.transition.transitionId, approvedBy: "maker-1", approvalRef: "approval/self" }, NOW), (error) => error.code === "composed_journey_self_approval");
  assert.throws(() => approveComposedJourneyTransition(proposed.state, { tenantId: "tenant-a", transitionId: proposed.transition.transitionId, approvedBy: "intruder", approvalRef: "approval/intruder" }, NOW), (error) => error.code === "composed_journey_actor_not_assigned");
  const tampered = structuredClone(proposed.state);
  tampered.composedJourneyTransitionRequests[proposed.transition.transitionId].targetStage = "credit_decision";
  assert.throws(() => approveComposedJourneyTransition(tampered, { tenantId: "tenant-a", transitionId: proposed.transition.transitionId, approvedBy: "checker-1", approvalRef: "approval/tampered" }, NOW), (error) => error.code === "composed_journey_transition_integrity_failure");
  const approved = approveComposedJourneyTransition(proposed.state, { tenantId: "tenant-a", transitionId: proposed.transition.transitionId, approvedBy: "checker-1", approvalRef: "approval/1" }, NOW);
  assert.equal(approved.lifecycle.currentStage, "kyc_aml");
  assert.equal(approved.lifecycle.revision, 2);
});

test("a downstream failure preserves compensation evidence and immediately stops advancement", () => {
  const created = createComposedJourneyInstance(initialState(), creation(), NOW);
  const failed = recordComposedJourneyFailure(created.state, {
    tenantId: "tenant-a", lifecycleId: created.lifecycle.lifecycleId, expectedRevision: 1,
    failureId: "failure-1", idempotencyKey: "failure/1", failedOperation: "kyc_provider_call",
    failureCode: "provider_timeout", failureMessage: "No signed outcome was returned.",
    evidenceRef: "provider/request-1", evidenceChecksumSha256: H, recordedBy: "maker-1",
    compensation: { mode: "manual_intervention", actionRef: "runbook/kyc-timeout", ownerRole: "operations_checker", dueAt: "2026-07-16T06:30:00.000Z" }
  }, NOW);
  assert.equal(failed.lifecycle.status, "paused");
  assert.equal(failed.escalation.status, "open");
  assert.equal(failed.state.composedJourneyLifecycles[created.lifecycle.lifecycleId].failures[0].compensation.mode, "manual_intervention");
  assert.equal(recordComposedJourneyFailure(failed.state, {
    tenantId: "tenant-a", lifecycleId: created.lifecycle.lifecycleId, expectedRevision: 1,
    failureId: "failure-1", idempotencyKey: "failure/1", failedOperation: "kyc_provider_call",
    failureCode: "provider_timeout", failureMessage: "No signed outcome was returned.",
    evidenceRef: "provider/request-1", evidenceChecksumSha256: H, recordedBy: "maker-1",
    compensation: { mode: "manual_intervention", actionRef: "runbook/kyc-timeout", ownerRole: "operations_checker", dueAt: "2026-07-16T06:30:00.000Z" }
  }, NOW).idempotent, true);
  assert.throws(() => proposeComposedJourneyTransition(failed.state, proposal(failed.lifecycle), NOW), (error) => error.code === "composed_journey_not_active");
  const resume = resumeComposedJourneyInstance(failed.state, {
    tenantId: "tenant-a", lifecycleId: failed.lifecycle.lifecycleId, transitionId: "resume-1", idempotencyKey: "resume/1",
    expectedRevision: failed.lifecycle.revision, resumedBy: "maker-1", blockerResolutionRefs: ["resolution/kyc-1"], purpose: "verified compensation and manual reconciliation"
  }, NOW);
  assert.equal(resume.transition.actionType, "resume");
  assert.throws(() => approveComposedJourneyTransition(resume.state, { tenantId: "tenant-a", transitionId: "resume-1", approvedBy: "maker-1", approvalRef: "approval/self" }, NOW), (error) => error.code === "composed_journey_self_approval");
  const approved = approveComposedJourneyTransition(resume.state, { tenantId: "tenant-a", transitionId: "resume-1", approvedBy: "checker-1", approvalRef: "approval/recovery" }, NOW);
  assert.equal(approved.lifecycle.status, "active");
  assert.equal(approved.lifecycle.currentStage, "application_capture");
  assert.deepEqual(approved.resolvedFailureIds, ["failure-1"]);
  assert.equal(approved.state.composedJourneyEscalations[failed.escalation.escalationId].status, "resolved");
  assert.equal(approved.state.composedJourneyLifecycles[created.lifecycle.lifecycleId].failures[0].status, "resolved");
});

test("principal containment pauses every assigned or pending lifecycle and invalidates in-flight work", () => {
  const first = createComposedJourneyInstance(initialState(), creation("personal_loan", "one"), NOW);
  const second = createComposedJourneyInstance(first.state, creation("home_loan", "two"), NOW);
  const pending = proposeComposedJourneyTransition(second.state, proposal(first.lifecycle, "pending"), NOW);
  const contained = pauseComposedJourneysForPrincipal(pending.state, { tenantId: "tenant-a", principalId: "maker-1", actor: "security-admin-1", causeType: "principal_access_revoked", causeRef: "revocation/1" }, NOW);
  assert.deepEqual(contained.affectedLifecycleIds.sort(), ["lc-one", "lc-two"]);
  assert.equal(contained.escalations.length, 2);
  assert.equal(projectComposedJourneyPortfolio(contained.state, { tenantId: "tenant-a" }).summary.paused, 2);
  assert.equal(contained.state.composedJourneyTransitionRequests["transition-pending"].status, "invalidated");
  const replay = pauseComposedJourneysForPrincipal(contained.state, { tenantId: "tenant-a", principalId: "maker-1", actor: "security-admin-1", causeType: "principal_access_revoked", causeRef: "revocation/1" }, NOW);
  assert.equal(Object.keys(replay.state.composedJourneyEscalations).length, 2);
  assert.deepEqual(replay.affectedLifecycleIds, []);
  const productPaused = pauseComposedJourneysForProduct(second.state, { tenantId: "tenant-a", journeyType: "home_loan", actor: "product-admin-1", causeType: "specialist_configuration_suspended", causeRef: "configuration/suspension-1" }, NOW);
  assert.deepEqual(productPaused.affectedLifecycleIds, ["lc-two"]);
  assert.equal(productPaused.state.composedJourneyLifecycles["lc-one"].status, "active");
  assert.equal(productPaused.state.composedJourneyLifecycles["lc-two"].status, "paused");
});
