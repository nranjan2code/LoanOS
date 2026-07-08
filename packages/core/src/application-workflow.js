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

// Coded decline reasons give adverse-action communication and CIC reporting a
// consistent, queryable trail instead of free text. `other` still demands a
// narrative so no decline is recorded without an explanation.
export const DECLINE_REASON_CODES = {
  affordability: "Repayment affordability outside policy (FOIR/EMI)",
  insufficient_income: "Income below product eligibility",
  age_eligibility: "Age or age at maturity outside policy",
  adverse_credit_history: "Adverse credit bureau history",
  incomplete_kyc: "KYC incomplete or unverified",
  insufficient_documentation: "Supporting documentation insufficient",
  policy_exclusion: "Borrower or purpose excluded by product policy",
  suspected_fraud: "Suspected fraud or misrepresentation",
  existing_delinquency: "Existing delinquency or default with the lender",
  other: "Other (requires narrative)"
};

const DECLINE_REASON_CODE_VALUES = new Set(Object.keys(DECLINE_REASON_CODES));

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
  allFindings.push(...manualUnderwritingFindings(application, input));
  allFindings.push(...declineReasonFindings(input));

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
    manualUnderwriting: manualUnderwritingEvidence(application, input, now),
    declineReason: declineReasonEvidence(input),
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
  if (input?.approvedBy && application.pendingDecision?.manualUnderwriting?.underwriterId === input.approvedBy) {
    findings.push(
      createFinding(
        "error",
        "RBI-IT-GRC",
        "Decision approver must be different from the manual underwriting underwriter.",
        "approvedBy"
      )
    );
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
          manualUnderwriting: application.pendingDecision.manualUnderwriting ?? null,
          declineReason: application.pendingDecision.declineReason ?? null,
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

export function recordDocumentPacketGenerated(application, packet, now = new Date()) {
  return withWorkflowEvent(
    {
      ...application,
      documentPacket: packet
    },
    {
      type: "application.document_packet.generated",
      status: application.status,
      packetId: packet.packetId,
      actor: packet.generatedBy ?? null
    },
    now
  );
}

export function recordDocumentPacketDelivered(application, packet, now = new Date()) {
  return withWorkflowEvent(
    {
      ...application,
      documentPacket: packet
    },
    {
      type: "application.document_packet.delivered",
      status: application.status,
      packetId: packet.packetId,
      deliveryRef: packet.delivery?.deliveryRef ?? null,
      actor: packet.delivery?.deliveredBy ?? null
    },
    now
  );
}

// A `refer`-band eligibility outcome means the affordability engine could not
// clear the borrower straight through. RBI Digital Lending requires a
// documented creditworthiness judgement, so an approval of a referred
// application must carry an explicit manual underwriting override.
function requiresManualUnderwriting(application, input) {
  return application.eligibility?.decision === "refer" && input?.status === "approved";
}

function manualUnderwritingFindings(application, input) {
  if (!requiresManualUnderwriting(application, input)) {
    return [];
  }

  const override = input.manualUnderwriting;
  if (!override || typeof override !== "object") {
    return [
      createFinding(
        "error",
        "RBI-DL-2025",
        "Referred application requires a manual underwriting override before approval.",
        "manualUnderwriting"
      )
    ];
  }

  const findings = [];
  if (!override.underwriterId) {
    findings.push(createFinding("error", "RBI-DL-2025", "Manual underwriting override requires underwriterId.", "manualUnderwriting.underwriterId"));
  }
  if (!override.reason) {
    findings.push(createFinding("error", "RBI-DL-2025", "Manual underwriting override requires a documented reason.", "manualUnderwriting.reason"));
  }
  if (!override.policyReference) {
    findings.push(createFinding("error", "RBI-DL-2025", "Manual underwriting override requires a policyReference.", "manualUnderwriting.policyReference"));
  }
  return findings;
}

function manualUnderwritingEvidence(application, input, now) {
  if (!requiresManualUnderwriting(application, input) || !input.manualUnderwriting) {
    return null;
  }

  const override = input.manualUnderwriting;
  return {
    underwriterId: override.underwriterId,
    reason: override.reason,
    policyReference: override.policyReference,
    compensatingFactors: Array.isArray(override.compensatingFactors) ? override.compensatingFactors : [],
    eligibilityId: application.eligibility?.eligibilityId ?? null,
    recordedAt: now.toISOString()
  };
}

function declineReasonFindings(input) {
  if (input?.status !== "declined") {
    return [];
  }

  const code = input.declineReasonCode;
  if (!code) {
    return [createFinding("error", "RBI-DL-2025", "A declined decision requires a declineReasonCode.", "declineReasonCode")];
  }
  if (!DECLINE_REASON_CODE_VALUES.has(code)) {
    return [createFinding("error", "RBI-DL-2025", `Decline reason code is not recognized: ${code}.`, "declineReasonCode")];
  }
  if (code === "other" && !(input.declineNarrative ?? input.reason)) {
    return [createFinding("error", "RBI-DL-2025", "Decline reason code 'other' requires a narrative.", "declineReasonCode")];
  }
  return [];
}

function declineReasonEvidence(input) {
  if (input?.status !== "declined" || !DECLINE_REASON_CODE_VALUES.has(input?.declineReasonCode)) {
    return null;
  }

  return {
    code: input.declineReasonCode,
    label: DECLINE_REASON_CODES[input.declineReasonCode],
    narrative: input.declineNarrative ?? input.reason ?? null
  };
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
