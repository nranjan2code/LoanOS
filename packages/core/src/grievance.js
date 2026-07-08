import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";

export const COMPLAINT_STATUSES = {
  RECEIVED: "received",
  ASSIGNED: "assigned",
  UNDER_REVIEW: "under_review",
  RESOLVED: "resolved",
  ESCALATED_TO_RBI_CMS: "escalated_to_rbi_cms"
};

export const COMPLAINT_EFFECTIVE_STATUSES = {
  ...COMPLAINT_STATUSES,
  ESCALATION_DUE: "escalation_due"
};

export const COMPLAINT_CATEGORIES = [
  "digital_lending",
  "kfs_disclosure",
  "collections",
  "repayment",
  "privacy",
  "kyc",
  "payment",
  "account_servicing",
  "other"
];

const COMPLAINT_CHANNELS = new Set(["web", "mobile_app", "email", "phone", "branch", "lsp", "postal", "rbi_cms"]);
const TERMINAL_STATUSES = new Set([COMPLAINT_STATUSES.RESOLVED, COMPLAINT_STATUSES.ESCALATED_TO_RBI_CMS]);
const RBI_OMBUDSMAN_DAYS = 30;

export function createComplaint(registry = {}, input = {}, context = {}, now = new Date()) {
  const complaint = normalizeComplaint(input, {}, now);
  const validation = validateComplaint(complaint, context);
  if (validation.summary.status === "blocked") {
    return {
      registry,
      complaint,
      findings: validation.findings,
      summary: validation.summary
    };
  }

  const event = complaintEvent("complaint.received", {
    actor: input.actor ?? null,
    channel: complaint.channel,
    acknowledgementRef: complaint.acknowledgementRef
  }, now);
  const stored = {
    ...complaint,
    events: [event],
    updatedAt: now.toISOString()
  };

  return {
    registry: {
      ...registry,
      [stored.complaintId]: stored
    },
    complaint: enrichComplaint(stored, now),
    event,
    findings: [],
    summary: summarizeFindings([])
  };
}

export function assignComplaint(complaint, input = {}, now = new Date()) {
  const findings = validateComplaintAction(complaint, input);
  if (!input.assignedTo) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Complaint assignment requires assignedTo.", "assignedTo"));
  }
  if (!input.assignedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Complaint assignment requires assignedBy.", "assignedBy"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedComplaintResult(complaint, findings, now);
  }

  const event = complaintEvent("complaint.assigned", {
    assignedTo: input.assignedTo,
    assignedBy: input.assignedBy,
    notes: input.notes ?? null
  }, now);
  const updated = {
    ...complaint,
    status: COMPLAINT_STATUSES.ASSIGNED,
    assignedTo: input.assignedTo,
    assignedBy: input.assignedBy,
    assignedAt: now.toISOString(),
    events: [...(complaint.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyComplaintResult(updated, event, now);
}

export function startComplaintReview(complaint, input = {}, now = new Date()) {
  const findings = validateComplaintAction(complaint, input);
  if (!input.actor) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Complaint review requires actor.", "actor"));
  }
  if (complaint?.assignedTo && input.actor && complaint.assignedTo !== input.actor) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Only the assigned grievance officer can start review.", "actor"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedComplaintResult(complaint, findings, now);
  }

  const event = complaintEvent("complaint.review_started", {
    actor: input.actor,
    notes: input.notes ?? null
  }, now);
  const updated = {
    ...complaint,
    status: COMPLAINT_STATUSES.UNDER_REVIEW,
    reviewedBy: input.actor,
    reviewStartedAt: now.toISOString(),
    events: [...(complaint.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyComplaintResult(updated, event, now);
}

export function resolveComplaint(complaint, input = {}, now = new Date()) {
  const findings = validateComplaintAction(complaint, input);
  if (!input.actor) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Complaint resolution requires actor.", "actor"));
  }
  if (!input.resolutionSummary) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint resolution requires resolutionSummary.", "resolutionSummary"));
  }
  if (!input.closureEvidenceRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint resolution requires closureEvidenceRef.", "closureEvidenceRef"));
  }
  if (!["resolved", "rejected", "partially_resolved"].includes(input.outcome)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint resolution outcome is invalid.", "outcome"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedComplaintResult(complaint, findings, now);
  }

  const event = complaintEvent("complaint.resolved", {
    actor: input.actor,
    outcome: input.outcome,
    closureEvidenceRef: input.closureEvidenceRef
  }, now);
  const updated = {
    ...complaint,
    status: COMPLAINT_STATUSES.RESOLVED,
    resolvedAt: now.toISOString(),
    resolvedBy: input.actor,
    resolution: {
      outcome: input.outcome,
      summary: input.resolutionSummary,
      borrowerCommunicationRef: input.borrowerCommunicationRef ?? null,
      closureEvidenceRef: input.closureEvidenceRef
    },
    events: [...(complaint.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyComplaintResult(updated, event, now);
}

export function escalateComplaintToRbiCms(complaint, input = {}, now = new Date()) {
  const findings = validateComplaintAction(complaint, input);
  const sla = complaint ? computeComplaintSla(complaint, now) : null;
  if (!input.actor) {
    findings.push(createFinding("error", "RBI-IT-GRC", "RBI CMS escalation requires actor.", "actor"));
  }
  if (!input.rbiCmsRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "RBI CMS escalation requires rbiCmsRef.", "rbiCmsRef"));
  }
  if (!input.reason) {
    findings.push(createFinding("error", "RBI-DL-2025", "RBI CMS escalation requires reason.", "reason"));
  }
  if (sla && !sla.breached && input.reason !== "borrower_dissatisfied") {
    findings.push(
      createFinding(
        "error",
        "RBI-IOS-2021",
        "RBI CMS escalation requires 30-day breach or borrower dissatisfaction reason.",
        "reason"
      )
    );
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedComplaintResult(complaint, findings, now);
  }

  const escalation = {
    escalationId: input.escalationId ?? createLoanId("rbicms"),
    rbiCmsRef: input.rbiCmsRef,
    reason: input.reason,
    escalatedBy: input.actor,
    escalatedAt: now.toISOString(),
    notes: input.notes ?? null,
    slaAtEscalation: sla
  };
  const event = complaintEvent("complaint.escalated_to_rbi_cms", {
    actor: input.actor,
    escalationId: escalation.escalationId,
    rbiCmsRef: escalation.rbiCmsRef,
    reason: escalation.reason
  }, now);
  const updated = {
    ...complaint,
    status: COMPLAINT_STATUSES.ESCALATED_TO_RBI_CMS,
    escalations: [...(complaint.escalations ?? []), escalation],
    events: [...(complaint.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyComplaintResult(updated, event, now);
}

export function enrichComplaint(complaint, asOf = new Date()) {
  const sla = computeComplaintSla(complaint, asOf);
  const effectiveStatus =
    !TERMINAL_STATUSES.has(complaint.status) && sla.breached
      ? COMPLAINT_EFFECTIVE_STATUSES.ESCALATION_DUE
      : complaint.status;

  return {
    ...complaint,
    effectiveStatus,
    sla
  };
}

export function computeComplaintSla(complaint, asOf = new Date()) {
  const receivedAt = normalizeDate(complaint?.receivedAt) ?? asOf;
  const dueAt = addDays(receivedAt, RBI_OMBUDSMAN_DAYS);
  const resolvedOrEscalatedAt = normalizeDate(complaint?.resolvedAt) ?? normalizeDate((complaint?.escalations ?? []).at(-1)?.escalatedAt);
  const clockAt = resolvedOrEscalatedAt ?? asOf;
  const remainingMinutes = Math.ceil((dueAt.getTime() - clockAt.getTime()) / 60000);
  const breached = remainingMinutes < 0;
  const status = TERMINAL_STATUSES.has(complaint?.status)
    ? breached
      ? "closed_after_breach"
      : "closed_in_time"
    : breached
      ? "breached"
      : remainingMinutes <= 24 * 60
        ? "due_soon"
        : "on_track";

  return {
    policyId: "rbi.grievance.ombudsman.30_day.v1",
    targetDays: RBI_OMBUDSMAN_DAYS,
    receivedAt: receivedAt.toISOString(),
    dueAt: dueAt.toISOString(),
    status,
    breached,
    remainingMinutes
  };
}

function normalizeComplaint(input, existing = {}, now = new Date()) {
  const receivedAt = normalizeDate(input.receivedAt) ?? normalizeDate(existing.receivedAt) ?? now;
  return {
    ...existing,
    complaintId: input.complaintId ?? existing.complaintId ?? createLoanId("cmp"),
    status: input.status ?? existing.status ?? COMPLAINT_STATUSES.RECEIVED,
    channel: input.channel ?? existing.channel ?? null,
    category: input.category ?? existing.category ?? null,
    summary: input.summary ?? existing.summary ?? null,
    description: input.description ?? existing.description ?? null,
    borrowerId: input.borrowerId ?? existing.borrowerId ?? null,
    applicationId: input.applicationId ?? existing.applicationId ?? null,
    loanAccountId: input.loanAccountId ?? existing.loanAccountId ?? null,
    regulatedEntityId: input.regulatedEntityId ?? existing.regulatedEntityId ?? null,
    productId: input.productId ?? existing.productId ?? null,
    complainant: {
      ...(existing.complainant ?? {}),
      ...(input.complainant ?? {})
    },
    receivedAt: receivedAt.toISOString(),
    acknowledgedAt: (normalizeDate(input.acknowledgedAt) ?? normalizeDate(existing.acknowledgedAt) ?? now).toISOString(),
    acknowledgementRef: input.acknowledgementRef ?? existing.acknowledgementRef ?? null,
    assignedTo: existing.assignedTo ?? null,
    assignedBy: existing.assignedBy ?? null,
    assignedAt: existing.assignedAt ?? null,
    reviewedBy: existing.reviewedBy ?? null,
    reviewStartedAt: existing.reviewStartedAt ?? null,
    resolution: existing.resolution ?? null,
    escalations: Array.isArray(existing.escalations) ? existing.escalations : [],
    events: Array.isArray(existing.events) ? existing.events : [],
    createdAt: existing.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function validateComplaint(complaint, context = {}) {
  const findings = [];
  if (!complaint.complaintId) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint requires complaintId.", "complaintId"));
  }
  if (!COMPLAINT_CHANNELS.has(complaint.channel)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint channel is invalid.", "channel"));
  }
  if (!COMPLAINT_CATEGORIES.includes(complaint.category)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint category is invalid.", "category"));
  }
  if (!complaint.summary) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint requires summary.", "summary"));
  }
  if (!complaint.acknowledgementRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint requires acknowledgementRef.", "acknowledgementRef"));
  }
  if (!complaint.borrowerId && !complaint.complainant?.mobile && !complaint.complainant?.email) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint requires borrowerId or complainant contact.", "complainant"));
  }
  if (complaint.regulatedEntityId && context.regulatedEntities && !context.regulatedEntities[complaint.regulatedEntityId]) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint regulatedEntityId is not registered.", "regulatedEntityId"));
  }
  if (complaint.borrowerId && context.borrowerProfiles && !context.borrowerProfiles[complaint.borrowerId]) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint borrowerId is not registered.", "borrowerId"));
  }
  if (complaint.applicationId && context.loanApplications && !context.loanApplications[complaint.applicationId]) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint applicationId is not registered.", "applicationId"));
  }
  if (complaint.loanAccountId && context.loanAccounts && !context.loanAccounts[complaint.loanAccountId]) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint loanAccountId is not registered.", "loanAccountId"));
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

function validateComplaintAction(complaint, input) {
  const findings = [];
  if (!complaint) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint is required.", "complaintId"));
  }
  if (complaint && TERMINAL_STATUSES.has(complaint.status)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint is already terminal.", "status"));
  }
  if (!input || typeof input !== "object") {
    findings.push(createFinding("error", "RBI-DL-2025", "Complaint action body is required.", "body"));
  }
  return findings;
}

function readyComplaintResult(complaint, event, now) {
  return {
    complaint: enrichComplaint(complaint, now),
    event,
    findings: [],
    summary: summarizeFindings([])
  };
}

function blockedComplaintResult(complaint, findings, now) {
  return {
    complaint: complaint ? enrichComplaint(complaint, now) : null,
    event: null,
    findings,
    summary: summarizeFindings(findings)
  };
}

function complaintEvent(type, event, now) {
  return {
    eventId: createLoanId("cmpevt"),
    type,
    at: now.toISOString(),
    ...event
  };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
