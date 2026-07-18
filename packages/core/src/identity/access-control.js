/**
 * Role-based access control for staff-actor operations across the platform:
 * given a registry of staff actors and an action's actor id(s), returns
 * `createFinding`-shaped findings (never throws) if the actor doesn't
 * exist, isn't active, lacks the required role, or lacks queue access for a
 * workflow task. This module is pure authorization logic — it does not own
 * identity, session, or the staff/user record shape itself (see the comment
 * below on the registry merge into tenant users), and it does not decide
 * *what* the action does, only *whether the actor may perform it* (RBI-IT-GRC,
 * segregation-of-duties-flavored checks like maker/checker independence live
 * in the calling modules, e.g. `loan-policy.js`'s four-eyes checks).
 */
import { createFinding, summarizeFindings } from "../compliance/compliance-controls.js";

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

/**
 * Require the proposer of a credit decision (`input.proposedBy`, falling
 * back to the legacy `decidedBy` field) to be an active `credit_officer`.
 * @param {Record<string, object>} staffActors - actorId -> {status, roles, queues}.
 * @param {{proposedBy?: string, decidedBy?: string}} input
 * @returns {Array<object>} findings (empty if access is valid).
 */
export function validateDecisionProposalAccess(staffActors = {}, input) {
  const actorId = input?.proposedBy ?? input?.decidedBy;
  return validateActorRole(staffActors, actorId, STAFF_ROLES.CREDIT_OFFICER, "proposedBy");
}

/**
 * Require the approver of a credit decision to be an active
 * `credit_checker` — the independent checker role in the maker/checker
 * split enforced alongside this by the caller (e.g. `loan-policy.js`).
 * @param {Record<string, object>} staffActors
 * @param {{approvedBy?: string}} input
 * @returns {Array<object>} findings.
 */
export function validateDecisionApprovalAccess(staffActors = {}, input) {
  return validateActorRole(staffActors, input?.approvedBy, STAFF_ROLES.CREDIT_CHECKER, "approvedBy");
}

/**
 * Require a manual underwriting override to be performed by an active
 * `credit_officer`.
 * @param {Record<string, object>} staffActors
 * @param {{manualUnderwriting?: {underwriterId?: string}}} input
 * @returns {Array<object>} findings.
 */
export function validateManualUnderwritingAccess(staffActors = {}, input) {
  return validateActorRole(
    staffActors,
    input?.manualUnderwriting?.underwriterId,
    STAFF_ROLES.CREDIT_OFFICER,
    "manualUnderwriting.underwriterId"
  );
}

/**
 * Require access to a borrower document packet to be by an active `loan_officer`.
 * @param {Record<string, object>} staffActors
 * @param {string} actorId
 * @param {string} [path] - field path used in findings.
 * @returns {Array<object>} findings.
 */
export function validateDocumentPacketAccess(staffActors = {}, actorId, path = "actor") {
  return validateActorRole(staffActors, actorId, STAFF_ROLES.LOAN_OFFICER, path);
}

/**
 * Require an AI/model-assisted decision's human review to be performed by an
 * active `human_reviewer` — the access-control half of the model-governance
 * "material decisions need a human review reference" rule (see `model-governance.js`).
 * @param {Record<string, object>} staffActors
 * @param {{reviewedBy?: string}} input
 * @returns {Array<object>} findings.
 */
export function validateHumanReviewAccess(staffActors = {}, input) {
  return validateActorRole(staffActors, input?.reviewedBy, STAFF_ROLES.HUMAN_REVIEWER, "reviewedBy");
}

/**
 * Require a collections-recovery case assignment to be made by an active
 * `collections_manager`.
 * @param {Record<string, object>} staffActors
 * @param {{assignedBy?: string}} input
 * @returns {Array<object>} findings.
 */
export function validateRecoveryAssignmentAccess(staffActors = {}, input) {
  return validateActorRole(staffActors, input?.assignedBy, STAFF_ROLES.COLLECTIONS_MANAGER, "assignedBy");
}

/**
 * Require a cash-recovery approval to be made by an active `collections_manager`.
 * @param {Record<string, object>} staffActors
 * @param {{approvedBy?: string}} input
 * @returns {Array<object>} findings.
 */
export function validateCashRecoveryApprovalAccess(staffActors = {}, input) {
  return validateActorRole(staffActors, input?.approvedBy, STAFF_ROLES.COLLECTIONS_MANAGER, "approvedBy");
}

/**
 * Require grievance-handling access to be by an active `grievance_officer`.
 * @param {Record<string, object>} staffActors
 * @param {string} actorId
 * @param {string} [path]
 * @returns {Array<object>} findings.
 */
export function validateGrievanceOfficerAccess(staffActors = {}, actorId, path = "actor") {
  return validateActorRole(staffActors, actorId, STAFF_ROLES.GRIEVANCE_OFFICER, path);
}

/**
 * Validate a workflow-queue task assignment from both sides: the assigner
 * must be active and either a `workflow_admin` or explicitly permitted to
 * assign the task's queue (`canAssignQueues`); the assignee must be active
 * and hold the task's required role plus access to its queue.
 * @param {Record<string, object>} staffActors
 * @param {{queue: string, role: string}} task
 * @param {{assignedBy?: string, assignedTo?: string}} input
 * @returns {Array<object>} findings.
 */
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

/**
 * Validate that a single actor may operate on a workflow task, whether by
 * working it directly (has the task's role + queue access) or by virtue of
 * being able to assign it (e.g. a `workflow_admin`).
 * @param {Record<string, object>} staffActors
 * @param {{queue: string, role: string}} task
 * @param {string} actorId
 * @param {string} [path]
 * @returns {Array<object>} findings.
 */
export function validateWorkflowActorAccess(staffActors = {}, task, actorId, path = "actor") {
  const findings = validateActiveActor(staffActors, actorId, path);
  const actor = staffActors[actorId];
  if (actor && task && !canWorkTask(actor, task) && !canAssignTask(actor, task)) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Actor cannot operate this workflow task.", path));
  }
  return findings;
}

// Shared shape behind every role-specific validator: actor must exist, be
// active, and hold `role`.
function validateActorRole(staffActors, actorId, role, path) {
  const findings = validateActiveActor(staffActors, actorId, path);
  const actor = staffActors[actorId];
  if (actor && !hasRole(actor, role)) {
    findings.push(createFinding("error", "RBI-IT-GRC", `Actor must have role ${role}.`, path));
  }
  return findings;
}

// Base existence/active check shared by every access validator above.
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

// An actor may assign a task's queue if they're a workflow_admin or the
// queue is explicitly listed in their `canAssignQueues`.
function canAssignTask(actor, task) {
  return hasRole(actor, STAFF_ROLES.WORKFLOW_ADMIN) || actor.canAssignQueues?.includes(task.queue);
}

// An actor may work a task if they hold its role (or are a workflow_admin,
// who can work anything) and have access to its queue.
function canWorkTask(actor, task) {
  return (hasRole(actor, STAFF_ROLES.WORKFLOW_ADMIN) || hasRole(actor, task.role)) && hasQueueAccess(actor, task.queue);
}

function hasRole(actor, role) {
  return actor?.roles?.includes(role);
}

// "*" is the wildcard queue grant; workflow_admin implicitly has access to every queue.
function hasQueueAccess(actor, queue) {
  return actor?.queues?.includes(queue) || actor?.queues?.includes("*") || hasRole(actor, STAFF_ROLES.WORKFLOW_ADMIN);
}

