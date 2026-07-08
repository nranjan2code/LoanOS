import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId, validateKfsBeforeDecision } from "./loan-policy.js";

export const APPLICATION_STATUSES = {
  BLOCKED_COMPLIANCE: "blocked_compliance",
  READY_FOR_KFS: "ready_for_kfs",
  KFS_ISSUED: "kfs_issued",
  READY_FOR_DECISION: "ready_for_decision",
  HUMAN_REVIEW_REQUIRED: "human_review_required",
  PENDING_DECISION_APPROVAL: "pending_decision_approval",
  APPROVED: "approved",
  DECLINED: "declined",
  DECISION_REJECTED: "decision_rejected",
  DISBURSED: "disbursed"
};

const DECISION_READY_STATUSES = new Set([APPLICATION_STATUSES.READY_FOR_DECISION, APPLICATION_STATUSES.HUMAN_REVIEW_REQUIRED]);

export function initializeApplicationWorkflow(application, compliance, now = new Date()) {
  const status = compliance?.summary?.status === "blocked" ? APPLICATION_STATUSES.BLOCKED_COMPLIANCE : APPLICATION_STATUSES.READY_FOR_KFS;
  return withWorkflowEvent(
    {
      ...application,
      status
    },
    {
      type: "application.preflight.completed",
      status,
      findingSummary: compliance?.summary ?? null
    },
    now
  );
}

export function applyKfsWorkflow(application, compliance, now = new Date()) {
  if (compliance?.summary?.status === "blocked") {
    return withWorkflowEvent(
      {
        ...application,
        status: APPLICATION_STATUSES.BLOCKED_COMPLIANCE
      },
      {
        type: "application.kfs.blocked",
        status: APPLICATION_STATUSES.BLOCKED_COMPLIANCE,
        findingSummary: compliance.summary
      },
      now
    );
  }

  const readiness = validateKfsBeforeDecision(application);
  const status =
    readiness.summary.status === "blocked" ? APPLICATION_STATUSES.KFS_ISSUED : APPLICATION_STATUSES.READY_FOR_DECISION;

  return withWorkflowEvent(
    {
      ...application,
      kfsReadiness: readiness,
      status
    },
    {
      type: status === APPLICATION_STATUSES.READY_FOR_DECISION ? "application.kfs.accepted" : "application.kfs.issued",
      status,
      kfsId: application.kfs?.kfsId ?? null,
      findingSummary: readiness.summary
    },
    now
  );
}

export function recordHumanReview(application, input, now = new Date()) {
  const findings = [];
  if (!input?.reviewedBy) {
    findings.push(createFinding("error", "FREE-AI-2025", "Human review requires reviewedBy.", "reviewedBy"));
  }
  if (!input?.reviewRef) {
    findings.push(createFinding("error", "FREE-AI-2025", "Human review requires reviewRef.", "reviewRef"));
  }
  if (!["approved_to_continue", "requires_rework", "declined"].includes(input?.outcome)) {
    findings.push(createFinding("error", "FREE-AI-2025", "Human review outcome is invalid.", "outcome"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      application,
      findings,
      summary
    };
  }

  const review = {
    reviewId: input.reviewId ?? createLoanId("review"),
    reviewRef: input.reviewRef,
    reviewedBy: input.reviewedBy,
    outcome: input.outcome,
    notes: input.notes ?? null,
    reviewedAt: now.toISOString()
  };
  const nextAiDecision = application.aiDecision
    ? {
        ...application.aiDecision,
        humanReviewRef: application.aiDecision.humanReviewRef ?? review.reviewRef
      }
    : application.aiDecision;
  const nextStatus =
    application.status === APPLICATION_STATUSES.HUMAN_REVIEW_REQUIRED && input.outcome === "approved_to_continue"
      ? APPLICATION_STATUSES.READY_FOR_DECISION
      : application.status;
  const updated = withWorkflowEvent(
    {
      ...application,
      aiDecision: nextAiDecision,
      status: nextStatus,
      humanReviews: [...(application.humanReviews ?? []), review]
    },
    {
      type: "application.human_review.recorded",
      status: nextStatus,
      reviewId: review.reviewId,
      outcome: review.outcome,
      actor: review.reviewedBy
    },
    now
  );

  return {
    application: updated,
    humanReview: review,
    findings,
    summary
  };
}

export function proposeDecision(application, input, findings = [], now = new Date()) {
  const allFindings = [...findings];

  if (!DECISION_READY_STATUSES.has(application.status)) {
    allFindings.push(
      createFinding(
        "error",
        "RBI-DL-2025",
        "Application must be ready_for_decision before a decision can be proposed.",
        "status"
      )
    );
  }
  if (!input?.proposedBy && !input?.decidedBy) {
    allFindings.push(createFinding("error", "RBI-DL-2025", "Decision proposal requires proposedBy.", "proposedBy"));
  }
  if (!["approved", "declined"].includes(input?.status)) {
    allFindings.push(createFinding("error", "RBI-DL-2025", "Decision status must be approved or declined.", "status"));
  }

  const hasHumanReviewWarning = allFindings.some((finding) => finding.path === "aiDecision.humanReviewRef");
  if (hasHumanReviewWarning) {
    const updated = withWorkflowEvent(
      {
        ...application,
        status: APPLICATION_STATUSES.HUMAN_REVIEW_REQUIRED,
        compliance: {
          findings: allFindings,
          summary: summarizeFindings(allFindings)
        }
      },
      {
        type: "application.human_review.required",
        status: APPLICATION_STATUSES.HUMAN_REVIEW_REQUIRED
      },
      now
    );

    return {
      application: updated,
      findings: allFindings,
      summary: summarizeFindings(allFindings),
      requiresHumanReview: true
    };
  }

  const summary = summarizeFindings(allFindings);
  if (summary.status === "blocked") {
    return {
      application,
      findings: allFindings,
      summary,
      requiresHumanReview: false
    };
  }

  const proposal = {
    proposalId: input.proposalId ?? createLoanId("decision"),
    status: input.status,
    proposedBy: input.proposedBy ?? input.decidedBy,
    proposedAt: now.toISOString(),
    reason: input.reason ?? null,
    aiDecision: input.aiDecision ?? application.aiDecision ?? null
  };

  const updated = withWorkflowEvent(
    {
      ...application,
      status: APPLICATION_STATUSES.PENDING_DECISION_APPROVAL,
      pendingDecision: proposal,
      compliance: {
        findings: allFindings,
        summary
      }
    },
    {
      type: "application.decision.proposed",
      status: APPLICATION_STATUSES.PENDING_DECISION_APPROVAL,
      proposalId: proposal.proposalId,
      decisionStatus: proposal.status,
      actor: proposal.proposedBy
    },
    now
  );

  return {
    application: updated,
    proposal,
    findings: allFindings,
    summary,
    requiresHumanReview: false
  };
}

export function applyDecisionApproval(application, input, now = new Date()) {
  const findings = [];
  if (application.status !== APPLICATION_STATUSES.PENDING_DECISION_APPROVAL || !application.pendingDecision) {
    findings.push(
      createFinding("error", "RBI-DL-2025", "Application must have a pending decision approval.", "status")
    );
  }
  if (!input?.approvedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Decision approval requires approvedBy.", "approvedBy"));
  }
  if (!input?.approvalRef) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Decision approval requires approvalRef.", "approvalRef"));
  }
  if (!["approved", "rejected"].includes(input?.outcome)) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Decision approval outcome must be approved or rejected.", "outcome"));
  }
  if (input?.approvedBy && application.pendingDecision?.proposedBy === input.approvedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Maker-checker approval must be by a different actor.", "approvedBy"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      application,
      findings,
      summary
    };
  }

  const approval = {
    approvalId: input.approvalId ?? createLoanId("approval"),
    approvalRef: input.approvalRef,
    approvedBy: input.approvedBy,
    outcome: input.outcome,
    notes: input.notes ?? null,
    approvedAt: now.toISOString()
  };
  const finalStatus =
    input.outcome === "approved" ? application.pendingDecision.status : APPLICATION_STATUSES.DECISION_REJECTED;
  const decision =
    input.outcome === "approved"
      ? {
          status: application.pendingDecision.status,
          proposedBy: application.pendingDecision.proposedBy,
          proposedAt: application.pendingDecision.proposedAt,
          approvedBy: approval.approvedBy,
          approvalRef: approval.approvalRef,
          decidedAt: approval.approvedAt,
          reason: application.pendingDecision.reason,
          aiDecision: application.pendingDecision.aiDecision
        }
      : null;

  const updated = withWorkflowEvent(
    {
      ...application,
      status: finalStatus,
      decision: decision ?? application.decision ?? null,
      decisionApproval: approval,
      pendingDecision: null
    },
    {
      type: input.outcome === "approved" ? "application.decision.approved" : "application.decision.rejected",
      status: finalStatus,
      approvalId: approval.approvalId,
      actor: approval.approvedBy
    },
    now
  );

  return {
    application: updated,
    approval,
    findings,
    summary
  };
}

export function markDisbursed(application, disbursement, now = new Date()) {
  return withWorkflowEvent(
    {
      ...application,
      status: APPLICATION_STATUSES.DISBURSED,
      disbursement
    },
    {
      type: "application.disbursed",
      status: APPLICATION_STATUSES.DISBURSED,
      disbursementId: disbursement.disbursementId ?? null
    },
    now
  );
}

function withWorkflowEvent(application, event, now = new Date()) {
  const workflow = application.workflow ?? {
    events: []
  };

  return {
    ...application,
    workflow: {
      ...workflow,
      status: event.status ?? application.status,
      updatedAt: now.toISOString(),
      events: [
        ...(workflow.events ?? []),
        {
          ...event,
          at: event.at ?? now.toISOString()
        }
      ]
    }
  };
}

