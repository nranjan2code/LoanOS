import { createHash } from "node:crypto";

import { PRODUCT_JOURNEY_TYPES } from "./product-journey-administration.js";
import { JOURNEY_WORKSPACE_SCHEMAS, PRODUCT_TO_WORKSPACE_ARCHETYPE } from "./journey-workspace.js";
import { PRODUCT_TEMPLATE_CATALOGUE } from "./product-template-catalogue.js";
import { PERSISTENT_SPECIALIST_JOURNEY_TYPES } from "./specialist-journey-service.js";

export const COMPOSED_JOURNEY_STAGES = Object.freeze([
  "application_capture",
  "kyc_aml",
  "specialist_assessment",
  "credit_decision",
  "kfs_acceptance",
  "contracting",
  "disbursement",
  "lms_accounting",
  "servicing",
  "collections",
  "regulatory_reporting",
  "closure",
  "completed"
]);

const DEFINITION_INPUT = [
  ["application_capture", "kyc_aml", ["workspace_submission", "consent", "application_snapshot"]],
  ["kyc_aml", "specialist_assessment", ["identity_result", "aml_disposition", "kyc_verification"]],
  ["specialist_assessment", "credit_decision", ["assessment_result", "assessment_lineage", "open_exception_disposition"]],
  ["credit_decision", "kfs_acceptance", ["decision_result", "decision_trace", "sanction_approval"]],
  ["kfs_acceptance", "contracting", ["kfs_document", "kfs_delivery", "borrower_acceptance"]],
  ["contracting", "disbursement", ["signed_contract", "conditions_precedent", "document_vault_receipt"]],
  ["disbursement", "lms_accounting", ["disbursement_instruction", "provider_result", "fund_flow_reconciliation"]],
  ["lms_accounting", "servicing", ["loan_account", "repayment_schedule", "balanced_opening_journal"]],
  ["servicing", "collections", ["servicing_snapshot", "collections_disposition", "borrower_communication"]],
  ["collections", "regulatory_reporting", ["treatment_outcome", "balance_reconciliation", "closure_eligibility"]],
  ["regulatory_reporting", "closure", ["regulatory_submission", "reporting_reconciliation", "closure_readiness"]],
  ["closure", "completed", ["zero_balance", "noc", "release_and_retention"]]
];

export const COMPOSED_JOURNEY_STAGE_DEFINITIONS = Object.freeze(Object.fromEntries(
  DEFINITION_INPUT.map(([stage, nextStage, requiredEvidenceKinds]) => [stage, Object.freeze({
    stage,
    nextStage,
    material: true,
    requiredEvidenceKinds: Object.freeze(requiredEvidenceKinds)
  })])
));

const LINEAGE_FIELDS = Object.freeze([
  ["productTemplateRef", "productTemplateVersion", "productTemplateChecksumSha256"],
  ["workspaceSchemaId", "workspaceSchemaVersion", "workspaceSchemaChecksumSha256"],
  ["policyBundleRef", "policyBundleVersion", "policyBundleChecksumSha256"],
  ["workflowRef", "workflowVersion", "workflowChecksumSha256"],
  ["accountingPolicyRef", "accountingPolicyVersion", "accountingPolicyChecksumSha256"],
  ["tenantConfigurationRef", "tenantConfigurationVersion", "tenantConfigurationChecksumSha256"]
]);

export function validateComposedJourneyLifecycleCatalogue() {
  const errors = [];
  if (COMPOSED_JOURNEY_STAGES.length !== 13 || COMPOSED_JOURNEY_STAGES.at(-1) !== "completed") errors.push("The lifecycle must contain 12 ordered stages and terminal completed.");
  for (let index = 0; index < COMPOSED_JOURNEY_STAGES.length - 1; index += 1) {
    const stage = COMPOSED_JOURNEY_STAGES[index];
    const definition = COMPOSED_JOURNEY_STAGE_DEFINITIONS[stage];
    if (!definition) errors.push(`Missing lifecycle definition for ${stage}.`);
    else if (definition.nextStage !== COMPOSED_JOURNEY_STAGES[index + 1]) errors.push(`Invalid next stage for ${stage}.`);
    if (!definition?.requiredEvidenceKinds?.length) errors.push(`Missing evidence contract for ${stage}.`);
  }
  const products = new Set(PRODUCT_JOURNEY_TYPES);
  if (products.size !== 21) errors.push(`Expected 21 canonical product journeys, found ${products.size}.`);
  for (const journeyType of products) if (!PRODUCT_TO_WORKSPACE_ARCHETYPE[journeyType]) errors.push(`Missing workspace mapping for ${journeyType}.`);
  return { valid: errors.length === 0, errors, journeyCount: products.size, stageCount: COMPOSED_JOURNEY_STAGES.length };
}

export function createComposedJourneyInstance(state, input, now = new Date().toISOString()) {
  const tenantId = required(input.tenantId, "tenantId");
  const lifecycleId = required(input.lifecycleId ?? input.instanceId, "lifecycleId");
  const journeyType = required(input.journeyType, "journeyType");
  if (!PRODUCT_JOURNEY_TYPES.includes(journeyType)) fail("composed_journey_unknown_type", `Unknown canonical journey type: ${journeyType}.`);
  assertEntitled(state, tenantId, journeyType, now);
  const createdBy = required(input.createdBy, "createdBy");
  const assignedPrincipalIds = uniqueStrings(input.assignedPrincipalIds, "assignedPrincipalIds");
  if (assignedPrincipalIds.length < 2) fail("composed_journey_understaffed", "A composed journey requires at least two distinct assigned human principals.");
  if (!assignedPrincipalIds.includes(createdBy)) fail("composed_journey_actor_not_assigned", "The creator must be assigned to the journey.", 403);
  const requestedAmountPaise = money(input.requestedAmountPaise, "requestedAmountPaise");
  const lineage = validateLineage(input.lineage, journeyType);
  const expectedArchetype = PRODUCT_TO_WORKSPACE_ARCHETYPE[journeyType];
  const governedSchema = JOURNEY_WORKSPACE_SCHEMAS[journeyType];
  if (lineage.workspaceSchemaId !== governedSchema?.schemaId || String(lineage.workspaceSchemaVersion) !== String(governedSchema?.schemaVersion) || lineage.workspaceSchemaChecksumSha256 !== governedSchema?.schemaChecksumSha256) fail("composed_journey_schema_mismatch", `The workspace schema lineage must match the governed ${expectedArchetype} schema exactly.`);
  const governedTemplate = PRODUCT_TEMPLATE_CATALOGUE[journeyType];
  if (lineage.productTemplateRef !== governedTemplate?.templateId || String(lineage.productTemplateVersion) !== String(governedTemplate?.version) || lineage.productTemplateChecksumSha256 !== governedTemplate?.templateChecksumSha256) fail("composed_journey_template_mismatch", `The product-template lineage must match the governed ${journeyType} template exactly.`);
  if (PERSISTENT_SPECIALIST_JOURNEY_TYPES.includes(journeyType)) {
    const configuration = Object.values(state.specialistJourneyConfigurations ?? {}).find((candidate) => candidate.tenantId === tenantId && candidate.configurationId === lineage.specialistConfigurationRef);
    if (!configuration || configuration.status !== "active" || configuration.journeyType !== journeyType || String(configuration.version) !== String(lineage.specialistConfigurationVersion) || configuration.configurationChecksumSha256 !== lineage.specialistConfigurationChecksumSha256) fail("composed_journey_specialist_configuration_mismatch", "The specialist configuration must be active, same-tenant and checksum/version exact.");
  }
  const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
  const collection = state.composedJourneyLifecycles ?? {};
  const existing = collection[lifecycleId];
  const intentChecksumSha256 = checksum({ tenantId, lifecycleId, journeyType, subjectRef: input.subjectRef, applicationRef: input.applicationRef, requestedAmountPaise, assignedPrincipalIds, lineage, idempotencyKey });
  if (existing) {
    if (existing.tenantId === tenantId && existing.idempotencyKey === idempotencyKey && existing.intentChecksumSha256 === intentChecksumSha256) return { state, lifecycle: projectLifecycle(existing), idempotent: true };
    fail("composed_journey_exists", "The lifecycle identifier or idempotency key conflicts with an existing request.", 409);
  }
  for (const candidate of Object.values(collection)) {
    if (candidate.tenantId === tenantId && candidate.idempotencyKey === idempotencyKey) fail("composed_journey_idempotency_conflict", "The idempotency key is already bound to another lifecycle.", 409);
  }
  const lifecycle = sealLifecycle({
    lifecycleId,
    tenantId,
    journeyType,
    workspaceArchetype: expectedArchetype,
    subjectRef: required(input.subjectRef, "subjectRef"),
    applicationRef: required(input.applicationRef, "applicationRef"),
    requestedAmountPaise,
    assignedPrincipalIds,
    lineage,
    currentStage: "application_capture",
    status: "active",
    revision: 1,
    transitionHistory: [],
    failures: [],
    pause: null,
    idempotencyKey,
    intentChecksumSha256,
    createdBy,
    createdAt: now,
    updatedAt: now
  });
  return {
    state: { ...state, composedJourneyLifecycles: { ...collection, [lifecycleId]: lifecycle } },
    lifecycle: projectLifecycle(lifecycle),
    idempotent: false
  };
}

export function proposeComposedJourneyTransition(state, input, now = new Date().toISOString()) {
  const tenantId = required(input.tenantId, "tenantId");
  const lifecycle = findLifecycle(state, tenantId, required(input.lifecycleId ?? input.instanceId, "lifecycleId"));
  assertActive(lifecycle);
  const proposedBy = required(input.proposedBy, "proposedBy");
  assertAssigned(lifecycle, proposedBy);
  assertRevision(lifecycle, input.expectedRevision, input.expectedCurrentStage);
  const definition = COMPOSED_JOURNEY_STAGE_DEFINITIONS[lifecycle.currentStage];
  const targetStage = required(input.targetStage, "targetStage");
  if (!definition || definition.nextStage !== targetStage) fail("composed_journey_stage_skip", `Only ${definition?.nextStage ?? "no further stage"} may follow ${lifecycle.currentStage}.`);
  const evidenceManifest = validateEvidenceManifest(input.evidenceManifest, lifecycle, definition);
  return createTransitionRequest(state, lifecycle, {
    transitionId: input.transitionId,
    idempotencyKey: input.idempotencyKey,
    actionType: "advance",
    proposedBy,
    targetStage,
    evidenceManifest,
    purpose: input.purpose ?? `advance_${lifecycle.currentStage}_to_${targetStage}`
  }, now);
}

// A resume is itself a pending maker-checker request. This function never
// resumes work directly; approveComposedJourneyTransition performs execution.
export function resumeComposedJourneyInstance(state, input, now = new Date().toISOString()) {
  const tenantId = required(input.tenantId, "tenantId");
  const lifecycle = findLifecycle(state, tenantId, required(input.lifecycleId ?? input.instanceId, "lifecycleId"));
  if (lifecycle.status !== "paused" && lifecycle.status !== "manual_intervention") fail("composed_journey_not_paused", "Only paused work can be proposed for resume.", 409);
  const proposedBy = required(input.resumedBy ?? input.proposedBy, "resumedBy");
  assertAssigned(lifecycle, proposedBy);
  assertRevision(lifecycle, input.expectedRevision, lifecycle.currentStage);
  const blockerResolutionRefs = uniqueStrings(input.blockerResolutionRefs, "blockerResolutionRefs");
  if (!blockerResolutionRefs.length) fail("composed_journey_resolution_missing", "At least one blocker-resolution reference is required.");
  return createTransitionRequest(state, lifecycle, {
    transitionId: input.transitionId,
    idempotencyKey: input.idempotencyKey,
    actionType: "resume",
    proposedBy,
    targetStage: lifecycle.pause?.resumeStage ?? lifecycle.currentStage,
    evidenceManifest: { blockerResolutionRefs, pauseChecksumSha256: lifecycle.pause?.pauseChecksumSha256 },
    purpose: required(input.purpose, "purpose")
  }, now);
}

export function approveComposedJourneyTransition(state, input, now = new Date().toISOString()) {
  const tenantId = required(input.tenantId, "tenantId");
  const transitionId = required(input.transitionId, "transitionId");
  const transition = state.composedJourneyTransitionRequests?.[transitionId];
  if (!transition || transition.tenantId !== tenantId) fail("composed_journey_transition_not_found", "Transition request not found.", 404);
  verifySealed(transition, "transitionChecksumSha256", "composed_journey_transition_integrity_failure");
  if (transition.status !== "pending") fail("composed_journey_transition_not_pending", "Only a pending transition can be approved.", 409);
  const approvedBy = required(input.approvedBy, "approvedBy");
  if (approvedBy === transition.proposedBy) fail("composed_journey_self_approval", "A maker cannot approve their own lifecycle transition.");
  const lifecycle = findLifecycle(state, tenantId, transition.lifecycleId);
  assertAssigned(lifecycle, approvedBy);
  if (lifecycle.revision !== transition.expectedRevision || lifecycle.stateChecksumSha256 !== transition.expectedStateChecksumSha256 || lifecycle.currentStage !== transition.sourceStage) fail("composed_journey_stale_transition", "The lifecycle changed after proposal; submit a fresh transition.", 409);
  if (transition.actionType === "advance") assertActive(lifecycle);
  else if (lifecycle.status !== "paused" && lifecycle.status !== "manual_intervention") fail("composed_journey_resume_stale", "The lifecycle is no longer paused.", 409);
  const approvalRef = required(input.approvalRef, "approvalRef");
  const decidedTransition = { ...transition, status: "approved", approvedBy, approvalRef, approvedAt: now };
  const resolvedFailureIds = transition.actionType === "resume" ? lifecycle.failures.filter((failure) => failure.status === "open").map((failure) => failure.failureId) : [];
  const nextLifecycle = transition.actionType === "resume"
    ? sealLifecycle({ ...lifecycle, status: "active", pause: null, failures: lifecycle.failures.map((failure) => failure.status === "open" ? { ...failure, status: "resolved", resolvedBy: approvedBy, resolvedAt: now, resolutionRefs: transition.evidenceManifest.blockerResolutionRefs } : failure), revision: lifecycle.revision + 1, updatedAt: now, transitionHistory: [...lifecycle.transitionHistory, history(decidedTransition)] })
    : sealLifecycle({ ...lifecycle, currentStage: transition.targetStage, status: transition.targetStage === "completed" ? "completed" : "active", revision: lifecycle.revision + 1, updatedAt: now, transitionHistory: [...lifecycle.transitionHistory, history(decidedTransition)] });
  const escalationId = transition.actionType === "resume" ? lifecycle.pause?.escalationId : null;
  const escalations = { ...(state.composedJourneyEscalations ?? {}) };
  if (escalationId && escalations[escalationId]) escalations[escalationId] = { ...escalations[escalationId], status: "resolved", resolvedBy: approvedBy, resolvedAt: now, resolutionRefs: transition.evidenceManifest.blockerResolutionRefs };
  return {
    state: {
      ...state,
      composedJourneyLifecycles: { ...(state.composedJourneyLifecycles ?? {}), [lifecycle.lifecycleId]: nextLifecycle },
      composedJourneyTransitionRequests: { ...(state.composedJourneyTransitionRequests ?? {}), [transitionId]: decidedTransition },
      composedJourneyEscalations: escalations
    },
    lifecycle: projectLifecycle(nextLifecycle),
    transition: decidedTransition,
    blocked: false,
    resolvedFailureIds,
    resolvedEscalationId: escalationId
  };
}

export function pauseComposedJourneyInstance(state, input, now = new Date().toISOString()) {
  const tenantId = required(input.tenantId, "tenantId");
  const lifecycle = findLifecycle(state, tenantId, required(input.lifecycleId ?? input.instanceId, "lifecycleId"));
  const causeType = required(input.causeType, "causeType");
  const causeRef = required(input.causeRef ?? input.evidenceRef, "causeRef");
  if ((lifecycle.status === "paused" || lifecycle.status === "manual_intervention") && lifecycle.pause?.causeType === causeType && lifecycle.pause?.causeRef === causeRef) return { state, lifecycle: projectLifecycle(lifecycle), escalation: state.composedJourneyEscalations?.[lifecycle.pause.escalationId], idempotent: true };
  if (lifecycle.status === "completed") fail("composed_journey_completed", "Completed work cannot be paused through the normal workflow.", 409);
  const actor = required(input.pausedBy ?? input.actor, "pausedBy");
  const escalationId = input.escalationId ?? `composed-escalation:${lifecycle.lifecycleId}:${lifecycle.revision + 1}`;
  const pause = {
    causeType,
    causeRef,
    triggerPrincipalId: input.triggerPrincipalId ?? null,
    resumeStage: lifecycle.currentStage,
    escalationId,
    pausedBy: actor,
    pausedAt: now
  };
  pause.pauseChecksumSha256 = checksum(pause);
  const invalidated = invalidatePendingTransitions(state.composedJourneyTransitionRequests ?? {}, lifecycle.lifecycleId, now, causeType);
  const nextLifecycle = sealLifecycle({ ...lifecycle, status: input.manualIntervention ? "manual_intervention" : "paused", pause, revision: lifecycle.revision + 1, updatedAt: now });
  const escalation = {
    escalationId,
    tenantId,
    lifecycleId: lifecycle.lifecycleId,
    severity: "critical",
    status: "open",
    causeType,
    causeRef,
    ownerRole: input.ownerRole ?? "operations_manager",
    createdBy: actor,
    createdAt: now,
    pauseChecksumSha256: pause.pauseChecksumSha256
  };
  return {
    state: {
      ...state,
      composedJourneyLifecycles: { ...(state.composedJourneyLifecycles ?? {}), [lifecycle.lifecycleId]: nextLifecycle },
      composedJourneyTransitionRequests: invalidated,
      composedJourneyEscalations: { ...(state.composedJourneyEscalations ?? {}), [escalationId]: escalation }
    },
    lifecycle: projectLifecycle(nextLifecycle),
    escalation,
    idempotent: false
  };
}

export function recordComposedJourneyFailure(state, input, now = new Date().toISOString()) {
  const tenantId = required(input.tenantId, "tenantId");
  const lifecycle = findLifecycle(state, tenantId, required(input.lifecycleId ?? input.instanceId, "lifecycleId"));
  const recordedBy = required(input.recordedBy, "recordedBy");
  assertAssigned(lifecycle, recordedBy);
  const failureId = required(input.failureId, "failureId");
  const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
  const existing = lifecycle.failures.find((candidate) => candidate.failureId === failureId || candidate.idempotencyKey === idempotencyKey);
  const failureIntent = checksum({ failureId, idempotencyKey, failedOperation: input.failedOperation, failureCode: input.failureCode, evidenceRef: input.evidenceRef, evidenceChecksumSha256: input.evidenceChecksumSha256, compensation: input.compensation });
  if (existing) {
    if (existing.failureIntentChecksumSha256 === failureIntent) return { state, lifecycle: projectLifecycle(lifecycle), failure: existing, idempotent: true };
    fail("composed_journey_failure_conflict", "The failure identifier or idempotency key conflicts.", 409);
  }
  assertActive(lifecycle);
  assertRevision(lifecycle, input.expectedRevision, lifecycle.currentStage);
  hash(input.evidenceChecksumSha256, "evidenceChecksumSha256");
  const compensation = input.compensation ?? {};
  const compensationMode = required(compensation.mode, "compensation.mode");
  if (!["retry", "reconcile", "reverse", "manual_intervention", "cancel"].includes(compensationMode)) fail("composed_journey_compensation_invalid", "compensation.mode is not a governed recovery mode.");
  const dueAt = required(compensation.dueAt, "compensation.dueAt");
  if (!Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) <= Date.parse(now)) fail("composed_journey_compensation_due_invalid", "compensation.dueAt must be a future ISO timestamp.");
  const failure = {
    failureId,
    tenantId,
    lifecycleId: lifecycle.lifecycleId,
    idempotencyKey,
    failedOperation: required(input.failedOperation, "failedOperation"),
    failureCode: required(input.failureCode, "failureCode"),
    failureMessage: required(input.failureMessage, "failureMessage"),
    evidenceRef: required(input.evidenceRef, "evidenceRef"),
    evidenceChecksumSha256: input.evidenceChecksumSha256,
    compensation: {
      mode: compensationMode,
      actionRef: required(compensation.actionRef, "compensation.actionRef"),
      ownerRole: required(compensation.ownerRole, "compensation.ownerRole"),
      dueAt
    },
    recordedBy,
    recordedAt: now,
    status: "open",
    failureIntentChecksumSha256: failureIntent
  };
  failure.failureChecksumSha256 = checksum(failure);
  const withFailureLifecycle = sealLifecycle({ ...lifecycle, failures: [...lifecycle.failures, failure], updatedAt: now });
  const withFailure = { ...state, composedJourneyLifecycles: { ...(state.composedJourneyLifecycles ?? {}), [lifecycle.lifecycleId]: withFailureLifecycle } };
  const paused = pauseComposedJourneyInstance(withFailure, { tenantId, lifecycleId: lifecycle.lifecycleId, pausedBy: recordedBy, causeType: input.failureCode, causeRef: input.evidenceRef, ownerRole: failure.compensation.ownerRole }, now);
  return { ...paused, failure, idempotent: false };
}

export function pauseComposedJourneysForPrincipal(state, input, now = new Date().toISOString()) {
  const tenantId = required(input.tenantId, "tenantId");
  const principalId = required(input.principalId, "principalId");
  let next = state;
  const affectedLifecycleIds = [];
  const escalations = [];
  for (const lifecycle of Object.values(state.composedJourneyLifecycles ?? {})) {
    if (lifecycle.tenantId !== tenantId || lifecycle.status === "completed") continue;
    const pendingByPrincipal = Object.values(state.composedJourneyTransitionRequests ?? {}).some((request) => request.tenantId === tenantId && request.lifecycleId === lifecycle.lifecycleId && request.status === "pending" && request.proposedBy === principalId);
    if (!lifecycle.assignedPrincipalIds.includes(principalId) && !pendingByPrincipal) continue;
    const result = pauseComposedJourneyInstance(next, {
      tenantId,
      lifecycleId: lifecycle.lifecycleId,
      pausedBy: required(input.actor, "actor"),
      causeType: required(input.causeType, "causeType"),
      causeRef: required(input.causeRef, "causeRef"),
      triggerPrincipalId: principalId,
      ownerRole: "security_admin"
    }, now);
    next = result.state;
    if (!result.idempotent) affectedLifecycleIds.push(lifecycle.lifecycleId);
    if (result.escalation) escalations.push(result.escalation);
  }
  return { state: next, affectedLifecycleIds, escalations };
}

export function pauseComposedJourneysForProduct(state, input, now = new Date().toISOString()) {
  const tenantId = required(input.tenantId, "tenantId");
  const journeyType = required(input.journeyType, "journeyType");
  let next = state;
  const affectedLifecycleIds = [];
  const escalations = [];
  for (const lifecycle of Object.values(state.composedJourneyLifecycles ?? {})) {
    if (lifecycle.tenantId !== tenantId || lifecycle.journeyType !== journeyType || lifecycle.status === "completed") continue;
    const result = pauseComposedJourneyInstance(next, { tenantId, lifecycleId: lifecycle.lifecycleId, pausedBy: required(input.actor, "actor"), causeType: required(input.causeType, "causeType"), causeRef: required(input.causeRef, "causeRef"), ownerRole: input.ownerRole ?? "product_manager" }, now);
    next = result.state;
    if (!result.idempotent) affectedLifecycleIds.push(lifecycle.lifecycleId);
    if (result.escalation) escalations.push(result.escalation);
  }
  return { state: next, affectedLifecycleIds, escalations };
}

export function projectComposedJourneyInstance(state, input) {
  return projectLifecycle(findLifecycle(state, required(input.tenantId, "tenantId"), required(input.lifecycleId ?? input.instanceId, "lifecycleId")));
}

export function projectComposedJourneyPortfolio(state, input) {
  const tenantId = required(input.tenantId, "tenantId");
  const lifecycles = Object.values(state.composedJourneyLifecycles ?? {}).filter((item) => item.tenantId === tenantId).map(projectLifecycle).sort((a, b) => a.lifecycleId.localeCompare(b.lifecycleId));
  const transitions = Object.values(state.composedJourneyTransitionRequests ?? {}).filter((item) => item.tenantId === tenantId && item.status === "pending").sort((a, b) => a.transitionId.localeCompare(b.transitionId));
  const escalations = Object.values(state.composedJourneyEscalations ?? {}).filter((item) => item.tenantId === tenantId && item.status === "open").sort((a, b) => a.escalationId.localeCompare(b.escalationId));
  return { tenantId, lifecycles, transitions, escalations, summary: { total: lifecycles.length, active: lifecycles.filter((item) => item.status === "active").length, paused: lifecycles.filter((item) => item.status !== "active" && item.status !== "completed").length, completed: lifecycles.filter((item) => item.status === "completed").length } };
}

function createTransitionRequest(state, lifecycle, input, now) {
  const transitionId = required(input.transitionId, "transitionId");
  const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
  const collection = state.composedJourneyTransitionRequests ?? {};
  const transitionIntentChecksumSha256 = checksum({ lifecycleId: lifecycle.lifecycleId, expectedRevision: lifecycle.revision, sourceStage: lifecycle.currentStage, targetStage: input.targetStage, actionType: input.actionType, proposedBy: input.proposedBy, evidenceManifest: input.evidenceManifest, idempotencyKey, purpose: input.purpose });
  const existing = collection[transitionId] ?? Object.values(collection).find((candidate) => candidate.tenantId === lifecycle.tenantId && candidate.idempotencyKey === idempotencyKey);
  if (existing) {
    if (existing.transitionIntentChecksumSha256 === transitionIntentChecksumSha256) return { state, lifecycle: projectLifecycle(lifecycle), transition: existing, idempotent: true };
    fail("composed_journey_transition_conflict", "The transition identifier or idempotency key conflicts.", 409);
  }
  const transition = {
    transitionId,
    tenantId: lifecycle.tenantId,
    lifecycleId: lifecycle.lifecycleId,
    actionType: input.actionType,
    expectedRevision: lifecycle.revision,
    expectedStateChecksumSha256: lifecycle.stateChecksumSha256,
    sourceStage: lifecycle.currentStage,
    targetStage: input.targetStage,
    evidenceManifest: input.evidenceManifest,
    proposedBy: input.proposedBy,
    purpose: required(input.purpose, "purpose"),
    idempotencyKey,
    status: "pending",
    proposedAt: now,
    transitionIntentChecksumSha256
  };
  transition.transitionChecksumSha256 = checksum(transition);
  return { state: { ...state, composedJourneyTransitionRequests: { ...collection, [transitionId]: transition } }, lifecycle: projectLifecycle(lifecycle), transition, idempotent: false };
}

function validateEvidenceManifest(manifest, lifecycle, definition) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("composed_journey_evidence_missing", "evidenceManifest is required.");
  if (required(manifest.sourceStateRef, "evidenceManifest.sourceStateRef") !== lifecycle.stateRef || hash(manifest.sourceStateChecksumSha256, "evidenceManifest.sourceStateChecksumSha256") !== lifecycle.stateChecksumSha256) fail("composed_journey_stale_evidence", "Evidence must bind the exact current lifecycle state.", 409);
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts.map((artifact, index) => ({ kind: required(artifact?.kind, `artifacts[${index}].kind`), ref: required(artifact?.ref, `artifacts[${index}].ref`), checksumSha256: hash(artifact?.checksumSha256, `artifacts[${index}].checksumSha256`), producerRef: artifact?.producerRef ?? null, producedAt: artifact?.producedAt ?? null })) : [];
  const kinds = new Set(artifacts.map((artifact) => artifact.kind));
  for (const kind of definition.requiredEvidenceKinds) if (!kinds.has(kind)) fail("composed_journey_evidence_incomplete", `Missing required ${lifecycle.currentStage} evidence: ${kind}.`);
  if (kinds.size !== artifacts.length) fail("composed_journey_evidence_duplicate", "Evidence kinds must be unique.");
  if (manifest.financials) for (const [field, value] of Object.entries(manifest.financials)) money(value, `financials.${field}`);
  if (manifest.financials?.requestedAmountPaise && manifest.financials.requestedAmountPaise !== lifecycle.requestedAmountPaise) fail("composed_journey_financial_mismatch", "Evidence money must match the bound application amount.", 409);
  return { sourceStateRef: manifest.sourceStateRef, sourceStateChecksumSha256: manifest.sourceStateChecksumSha256, artifacts, financials: manifest.financials ?? {} };
}

function validateLineage(lineage, journeyType) {
  if (!lineage || typeof lineage !== "object" || Array.isArray(lineage)) fail("composed_journey_lineage_missing", "Exact lifecycle lineage is required.");
  const result = {};
  for (const [refField, versionField, checksumField] of LINEAGE_FIELDS) {
    result[refField] = required(lineage[refField], `lineage.${refField}`);
    result[versionField] = positiveVersion(lineage[versionField], `lineage.${versionField}`);
    result[checksumField] = hash(lineage[checksumField], `lineage.${checksumField}`);
  }
  result.accessGrantSnapshotRef = required(lineage.accessGrantSnapshotRef, "lineage.accessGrantSnapshotRef");
  result.accessGrantSnapshotChecksumSha256 = hash(lineage.accessGrantSnapshotChecksumSha256, "lineage.accessGrantSnapshotChecksumSha256");
  if (PERSISTENT_SPECIALIST_JOURNEY_TYPES.includes(journeyType)) {
    result.specialistConfigurationRef = required(lineage.specialistConfigurationRef, "lineage.specialistConfigurationRef");
    result.specialistConfigurationVersion = positiveVersion(lineage.specialistConfigurationVersion, "lineage.specialistConfigurationVersion");
    result.specialistConfigurationChecksumSha256 = hash(lineage.specialistConfigurationChecksumSha256, "lineage.specialistConfigurationChecksumSha256");
  }
  return result;
}

function assertEntitled(state, tenantId, journeyType, now) {
  const current = Date.parse(now);
  const subscriptions = Object.values(state.tenantProductSubscriptions ?? {});
  const entitled = subscriptions.some((subscription) => subscription.tenantId === tenantId && subscription.status === "active" && subscription.productTypes?.includes(journeyType) && (!subscription.effectiveFrom || Date.parse(subscription.effectiveFrom) <= current) && (!subscription.validUntil || Date.parse(subscription.validUntil) > current));
  if (!entitled) fail("composed_journey_not_entitled", "The tenant does not have a current active entitlement for this journey.", 403);
}

function findLifecycle(state, tenantId, lifecycleId) {
  const lifecycle = state.composedJourneyLifecycles?.[lifecycleId];
  if (!lifecycle || lifecycle.tenantId !== tenantId) fail("composed_journey_not_found", "Lifecycle not found.", 404);
  verifySealed(lifecycle, "stateChecksumSha256", "composed_journey_integrity_failure");
  return lifecycle;
}
function assertActive(lifecycle) { if (lifecycle.status !== "active") fail("composed_journey_not_active", "Paused, manual-intervention or completed work cannot advance.", 409); }
function assertAssigned(lifecycle, principalId) { if (!lifecycle.assignedPrincipalIds.includes(principalId)) fail("composed_journey_actor_not_assigned", "The actor is not assigned to this lifecycle.", 403); }
function assertRevision(lifecycle, revision, stage) { if (Number(revision) !== lifecycle.revision || stage !== lifecycle.currentStage) fail("composed_journey_stale_revision", "The expected lifecycle revision or stage is stale.", 409); }

function sealLifecycle(lifecycle) {
  const next = { ...lifecycle };
  next.stateRef = `composed-journey/${next.lifecycleId}/revision/${next.revision}`;
  delete next.stateChecksumSha256;
  next.stateChecksumSha256 = checksum(next);
  return next;
}
function projectLifecycle(lifecycle) {
  return {
    lifecycleId: lifecycle.lifecycleId,
    tenantId: lifecycle.tenantId,
    journeyType: lifecycle.journeyType,
    workspaceArchetype: lifecycle.workspaceArchetype,
    applicationRef: lifecycle.applicationRef,
    assignedPrincipalIds: [...lifecycle.assignedPrincipalIds],
    lineage: structuredClone(lifecycle.lineage),
    currentStage: lifecycle.currentStage,
    status: lifecycle.status,
    revision: lifecycle.revision,
    stateRef: lifecycle.stateRef,
    stateChecksumSha256: lifecycle.stateChecksumSha256,
    pause: lifecycle.pause ? structuredClone(lifecycle.pause) : null,
    transitionHistory: structuredClone(lifecycle.transitionHistory),
    failureCount: lifecycle.failures.length,
    createdBy: lifecycle.createdBy,
    createdAt: lifecycle.createdAt,
    updatedAt: lifecycle.updatedAt
  };
}
function history(transition) { return { transitionId: transition.transitionId, actionType: transition.actionType, sourceStage: transition.sourceStage, targetStage: transition.targetStage, proposedBy: transition.proposedBy, approvedBy: transition.approvedBy, approvalRef: transition.approvalRef, transitionChecksumSha256: transition.transitionChecksumSha256, proposedAt: transition.proposedAt, approvedAt: transition.approvedAt }; }
function invalidatePendingTransitions(collection, lifecycleId, now, causeType) { return Object.fromEntries(Object.entries(collection).map(([id, request]) => [id, request.lifecycleId === lifecycleId && request.status === "pending" ? { ...request, status: "invalidated", invalidatedAt: now, invalidationCause: causeType } : request])); }
function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("composed_journey_required", `${field} is required.`); return value.trim(); }
function positiveVersion(value, field) { if ((!Number.isInteger(value) || value < 1) && !(typeof value === "string" && /^[1-9]\d*(?:\.\d+){0,2}$/.test(value))) fail("composed_journey_version_invalid", `${field} must be a positive version.`); return value; }
function hash(value, field) { const normalized = required(value, field).toLowerCase(); if (!/^[a-f0-9]{64}$/.test(normalized)) fail("composed_journey_checksum_invalid", `${field} must be a SHA-256 checksum.`); return normalized; }
function money(value, field) { if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) fail("composed_journey_money_invalid", `${field} must be an exact non-negative paise string.`); return value; }
function uniqueStrings(values, field) { if (!Array.isArray(values)) fail("composed_journey_required", `${field} is required.`); const result = [...new Set(values.map((value) => required(value, field)))]; if (result.length !== values.length) fail("composed_journey_duplicate_value", `${field} cannot contain duplicates.`); return result.sort(); }
function checksum(value) { return createHash("sha256").update(stable(value)).digest("hex"); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function verifySealed(value, checksumField, code) { const expected = value?.[checksumField]; const content = { ...value }; delete content[checksumField]; if (!expected || checksum(content) !== expected) fail(code, "Persisted composed-journey state failed integrity verification.", 409); }
function fail(code, message, statusCode = 422) { const error = new Error(message); error.code = code; error.statusCode = statusCode; throw error; }
