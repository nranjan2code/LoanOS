import { createFinding, summarizeFindings } from "./compliance-controls.js";

export const STAFF_ACTOR_STATUSES = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  INACTIVE: "inactive"
};

export const STAFF_ROLES = {
  COMPLIANCE_ANALYST: "compliance_analyst",
  LOAN_OFFICER: "loan_officer",
  CREDIT_OFFICER: "credit_officer",
  KYC_OFFICER: "kyc_officer",
  HUMAN_REVIEWER: "human_reviewer",
  CREDIT_CHECKER: "credit_checker",
  DISBURSEMENT_MAKER: "disbursement_maker",
  COLLECTIONS_MANAGER: "collections_manager",
  GRIEVANCE_OFFICER: "grievance_officer",
  PORTFOLIO_RISK_MANAGER: "portfolio_risk_manager",
  WORKFLOW_ADMIN: "workflow_admin"
};

export const KNOWN_STAFF_ROLES = new Set(Object.values(STAFF_ROLES));
const ACTIVE_STATUS = STAFF_ACTOR_STATUSES.ACTIVE;

// The staff-actor registry used to be a separate store from tenant login
// users; it has been merged directly into the tenant user record
// (apps/api/src/identity.js: roles/queues/canAssignQueues/country fields), so
// there is no longer a standalone actor to normalize/validate/upsert here.
// Every function below is deliberately registry-shape-agnostic: it takes any
// `{id: {status, roles, queues, canAssignQueues}}` map — callers now pass
// `state.users` directly.

export function validateDecisionProposalAccess(staffActors = {}, input) {
  const actorId = input?.proposedBy ?? input?.decidedBy;
  return validateActorRole(staffActors, actorId, STAFF_ROLES.CREDIT_OFFICER, "proposedBy");
}

export function validateDecisionApprovalAccess(staffActors = {}, input) {
  return validateActorRole(staffActors, input?.approvedBy, STAFF_ROLES.CREDIT_CHECKER, "approvedBy");
}

export function validateManualUnderwritingAccess(staffActors = {}, input) {
  return validateActorRole(
    staffActors,
    input?.manualUnderwriting?.underwriterId,
    STAFF_ROLES.CREDIT_OFFICER,
    "manualUnderwriting.underwriterId"
  );
}

export function validateDocumentPacketAccess(staffActors = {}, actorId, path = "actor") {
  return validateActorRole(staffActors, actorId, STAFF_ROLES.LOAN_OFFICER, path);
}

export function validateHumanReviewAccess(staffActors = {}, input) {
  return validateActorRole(staffActors, input?.reviewedBy, STAFF_ROLES.HUMAN_REVIEWER, "reviewedBy");
}

export function validateRecoveryAssignmentAccess(staffActors = {}, input) {
  return validateActorRole(staffActors, input?.assignedBy, STAFF_ROLES.COLLECTIONS_MANAGER, "assignedBy");
}

export function validateCashRecoveryApprovalAccess(staffActors = {}, input) {
  return validateActorRole(staffActors, input?.approvedBy, STAFF_ROLES.COLLECTIONS_MANAGER, "approvedBy");
}

export function validateGrievanceOfficerAccess(staffActors = {}, actorId, path = "actor") {
  return validateActorRole(staffActors, actorId, STAFF_ROLES.GRIEVANCE_OFFICER, path);
}

export function validateWorkflowAssignmentAccess(staffActors = {}, task, input) {
  const findings = [];
  findings.push(...validateActiveActor(staffActors, input?.assignedBy, "assignedBy"));
  findings.push(...validateActiveActor(staffActors, input?.assignedTo, "assignedTo"));

  const assignedBy = staffActors[input?.assignedBy];
  const assignedTo = staffActors[input?.assignedTo];
  if (assignedBy && task && !canAssignTask(assignedBy, task)) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Actor cannot assign this workflow queue.", "assignedBy"));
  }
  if (assignedTo && task && !canWorkTask(assignedTo, task)) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Assigned actor does not have the task role and queue access.", "assignedTo"));
  }

  return findings;
}

export function validateWorkflowActorAccess(staffActors = {}, task, actorId, path = "actor") {
  const findings = validateActiveActor(staffActors, actorId, path);
  const actor = staffActors[actorId];
  if (actor && task && !canWorkTask(actor, task) && !canAssignTask(actor, task)) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Actor cannot operate this workflow task.", path));
  }
  return findings;
}

function validateActorRole(staffActors, actorId, role, path) {
  const findings = validateActiveActor(staffActors, actorId, path);
  const actor = staffActors[actorId];
  if (actor && !hasRole(actor, role)) {
    findings.push(createFinding("error", "RBI-IT-GRC", `Actor must have role ${role}.`, path));
  }
  return findings;
}

function validateActiveActor(staffActors, actorId, path) {
  const findings = [];
  if (!actorId) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Actor id is required.", path));
    return findings;
  }
  const actor = staffActors[actorId];
  if (!actor) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Actor must exist in the staff actor registry.", path));
    return findings;
  }
  if (actor.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Actor must be active.", path));
  }
  return findings;
}

function canAssignTask(actor, task) {
  return hasRole(actor, STAFF_ROLES.WORKFLOW_ADMIN) || actor.canAssignQueues?.includes(task.queue);
}

function canWorkTask(actor, task) {
  return (hasRole(actor, STAFF_ROLES.WORKFLOW_ADMIN) || hasRole(actor, task.role)) && hasQueueAccess(actor, task.queue);
}

function hasRole(actor, role) {
  return actor?.roles?.includes(role);
}

function hasQueueAccess(actor, queue) {
  return actor?.queues?.includes(queue) || actor?.queues?.includes("*") || hasRole(actor, STAFF_ROLES.WORKFLOW_ADMIN);
}

