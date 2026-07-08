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
  HUMAN_REVIEWER: "human_reviewer",
  CREDIT_CHECKER: "credit_checker",
  DISBURSEMENT_MAKER: "disbursement_maker",
  COLLECTIONS_MANAGER: "collections_manager",
  GRIEVANCE_OFFICER: "grievance_officer",
  PORTFOLIO_RISK_MANAGER: "portfolio_risk_manager",
  WORKFLOW_ADMIN: "workflow_admin"
};

const KNOWN_ROLES = new Set(Object.values(STAFF_ROLES));
const ACTIVE_STATUS = STAFF_ACTOR_STATUSES.ACTIVE;

export function normalizeStaffActor(input, existing = {}, now = new Date()) {
  const actorId = input?.actorId ?? existing.actorId;
  return {
    ...existing,
    ...input,
    actorId,
    displayName: input?.displayName ?? existing.displayName ?? actorId ?? null,
    country: input?.country ?? existing.country ?? "IN",
    status: input?.status ?? existing.status ?? ACTIVE_STATUS,
    roles: normalizeStringList(input?.roles ?? existing.roles),
    queues: normalizeStringList(input?.queues ?? existing.queues),
    canAssignQueues: normalizeStringList(input?.canAssignQueues ?? existing.canAssignQueues),
    createdAt: existing.createdAt ?? input?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function validateStaffActor(actor) {
  const findings = [];

  if (!actor?.actorId) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Staff actor requires actorId.", "actorId"));
  }
  if (!actor?.displayName) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Staff actor requires displayName.", "displayName"));
  }
  if (actor?.country !== "IN") {
    findings.push(createFinding("error", "RBI-IT-GRC", "Staff actor must be India-operational for this platform.", "country"));
  }
  if (!Object.values(STAFF_ACTOR_STATUSES).includes(actor?.status)) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Staff actor status is invalid.", "status"));
  }
  if (!actor?.roles?.length) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Staff actor requires at least one role.", "roles"));
  }
  for (const role of actor?.roles ?? []) {
    if (!KNOWN_ROLES.has(role)) {
      findings.push(createFinding("error", "RBI-IT-GRC", `Staff actor role is not recognized: ${role}.`, "roles"));
    }
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function upsertStaffActor(registry = {}, input, now = new Date()) {
  const actor = normalizeStaffActor(input, registry?.[input?.actorId] ?? {}, now);
  const validation = validateStaffActor(actor);

  if (validation.summary.status === "blocked") {
    return {
      registry,
      actor,
      findings: validation.findings,
      summary: validation.summary
    };
  }

  return {
    registry: {
      ...registry,
      [actor.actorId]: actor
    },
    actor,
    findings: [],
    summary: summarizeFindings([])
  };
}

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

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()))];
}
