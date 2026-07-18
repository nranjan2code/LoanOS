/**
 * Loan application workflow state machine: the sequence an application
 * moves through from compliance preflight, through KFS, to a maker-checker
 * decision (propose -> approve/reject), through disbursement. This module
 * owns the *workflow* (status transitions, event trail, maker-checker
 * gating) — it does not own compliance checking itself (delegates to
 * `validateKfsBeforeDecision` from `loan-policy.js`), the eligibility
 * decision (`application.eligibility.decision`, computed elsewhere), or
 * model governance state (only reads it via `normalizeModelRegistryState`
 * to snapshot evidence onto a proposed decision).
 *
 * Every workflow-mutating function appends to `application.workflow.events`
 * via `withWorkflowEvent` so the application always carries its own audit
 * trail alongside the top-level audit chain. Decision approval is
 * maker-checker: the approver must differ from both the proposer and (if
 * present) the manual-underwriting underwriter (RBI-IT-GRC). A `"refer"`
 * eligibility outcome being approved requires a documented manual
 * underwriting override (RBI Digital Lending Directions require a human
 * creditworthiness judgement when the affordability engine can't clear the
 * borrower straight through) and, if a workflow task exists for it, the
 * override's underwriter must match whoever the task was actually assigned
 * to. A decline must carry one of `DECLINE_REASON_CODES` (free-text `other`
 * requires a narrative) so adverse-action communication and CIC reporting
 * have a consistent, queryable trail instead of free text.
 */
import { createFinding, summarizeFindings } from "../compliance/compliance-controls.js";
import { createLoanId, validateKfsBeforeDecision } from "./loan-policy.js";
import { normalizeModelRegistryState } from "../ai/model-governance.js";

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

/**
 * Set the application's initial workflow status from its compliance
 * preflight result: `"blocked_compliance"` if the preflight found any
 * blocking finding, else `"ready_for_kfs"`.
 * @param {object} application
 * @param {{summary?: {status: string}}} compliance - preflight compliance result.
 * @param {Date} [now]
 * @returns {object} application with status set and a workflow event appended.
 */
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

/**
 * Advance the workflow after KFS is generated: blocked if the KFS-stage
 * compliance check found blocking findings; otherwise checks
 * `validateKfsBeforeDecision` and moves to `"ready_for_decision"` if that
 * clears, or stays `"kfs_issued"` if it doesn't (e.g. KFS not yet accepted
 * by the borrower).
 * @param {object} application
 * @param {{summary?: {status: string}}} compliance - KFS-stage compliance result.
 * @param {Date} [now]
 * @returns {object} application with status set and a workflow event appended.
 */
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

/**
 * Record a human's review of an AI-assisted decision path. Fails closed
 * unless `reviewedBy`, `reviewRef`, and a recognized `outcome` are given.
 * If the application was sitting in `"human_review_required"` and the
 * outcome is `"approved_to_continue"`, advances it back to
 * `"ready_for_decision"`; also back-fills `aiDecision.humanReviewRef` if
 * not already set, satisfying the model-governance material-decision
 * evidence requirement.
 * @param {object} application
 * @param {{reviewId?: string, reviewRef: string, reviewedBy: string, outcome: "approved_to_continue"|"requires_rework"|"declined", notes?: string}} input
 * @param {Date} [now]
 * @returns {{application: object, humanReview?: object, findings: Array<object>, summary: object}}
 */
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

/**
 * Propose a lending decision (the "maker" half of maker-checker). Fails
 * closed unless the application is decision-ready, a proposer is named,
 * status is `approved`/`declined`, and — depending on the case —
 * manual-underwriting evidence (`manualUnderwritingFindings`) or a decline
 * reason code (`declineReasonFindings`) checks out. If any finding flags a
 * missing `aiDecision.humanReviewRef`, the application is routed to
 * `"human_review_required"` instead of proceeding (`requiresHumanReview:
 * true`) rather than being blocked outright — this is the fail-closed-but-
 * recoverable path for a material AI-assisted decision lacking review.
 * On success, locks a snapshot of the AI decision's model evidence (from
 * `options.modelRegistry`, if given) onto the proposal so later review of
 * the decision doesn't depend on the model registry still having the same
 * state.
 * @param {object} application
 * @param {object} input - proposedBy/decidedBy, status, reason, manualUnderwriting, declineReasonCode, declineNarrative, aiDecision, proposalId.
 * @param {Array<object>} [findings] - pre-existing findings to fold in.
 * @param {{activeTasks?: Array<object>, modelRegistry?: object}|Date} [options] - may be passed as `now` for legacy call sites (positional shift is handled).
 * @param {Date} [now]
 * @returns {{application: object, proposal?: object, findings: Array<object>, summary: object, requiresHumanReview: boolean}}
 */
export function proposeDecision(application, input, findings = [], options = {}, now = new Date()) {
  let opts = options;
  let date = now;
  if (options instanceof Date) {
    date = options;
    opts = {};
  }
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
  allFindings.push(...manualUnderwritingFindings(application, input, opts));
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
      date
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

  const inputAi = input.aiDecision ?? application.aiDecision ?? null;
  let lockedAiDecision = null;
  if (inputAi && inputAi.modelId) {
    lockedAiDecision = { ...inputAi };
    if (opts.modelRegistry) {
      const registry = normalizeModelRegistryState(opts.modelRegistry);
      const model = registry.models[inputAi.modelId];
      if (model) {
        lockedAiDecision.modelEvidence = {
          modelId: model.modelId,
          version: model.version,
          riskTier: model.riskTier,
          validationStatus: model.validationStatus,
          materialDecision: model.materialDecision,
          customerFacing: model.customerFacing,
          independentValidationRef: model.independentValidationRef ?? null,
          fairnessAssessmentRef: model.fairnessAssessmentRef ?? null,
          explainabilityRef: model.explainabilityRef ?? null,
          adversarialTestRef: model.adversarialTestRef ?? null,
          hallucinationTestRef: model.hallucinationTestRef ?? null,
          driftThreshold: model.driftThreshold ?? null,
          driftStatus: model.driftStatus ?? "normal"
        };
      }
    }
  }

  const proposal = {
    proposalId: input.proposalId ?? createLoanId("decision"),
    status: input.status,
    proposedBy: input.proposedBy ?? input.decidedBy,
    proposedAt: date.toISOString(),
    reason: input.reason ?? null,
    manualUnderwriting: manualUnderwritingEvidence(application, input, date),
    declineReason: declineReasonEvidence(input),
    aiDecision: lockedAiDecision
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

/**
 * Approve or reject a pending decision proposal (the "checker" half).
 * Fails closed unless: a pending decision actually exists, `approvedBy`/
 * `approvalRef`/`outcome` are present, and the approver is independent of
 * both the proposer and (if applicable) the manual-underwriting
 * underwriter. On `"approved"`, materializes the proposal into
 * `application.decision`; on `"rejected"`, moves to
 * `"decision_rejected"` without recording a decision.
 * @param {object} application - must have `status === "pending_decision_approval"` with a `pendingDecision`.
 * @param {object} input - approvedBy, approvalRef, outcome, notes, approvalId.
 * @param {Date} [now]
 * @returns {{application: object, approval?: object, findings: Array<object>, summary: object}}
 */
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

/**
 * Mark the application as disbursed, attaching the disbursement record.
 * @param {object} application
 * @param {object} disbursement
 * @param {Date} [now]
 * @returns {object} application with status `"disbursed"` and a workflow event appended.
 */
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

/**
 * Attach a generated loan-document packet to the application (status
 * unchanged) and log the event.
 * @param {object} application
 * @param {object} packet
 * @param {Date} [now]
 * @returns {object} application with `documentPacket` set and a workflow event appended.
 */
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

/**
 * Attach a delivered loan-document packet to the application (status
 * unchanged) and log the event.
 * @param {object} application
 * @param {object} packet
 * @param {Date} [now]
 * @returns {object} application with `documentPacket` set and a workflow event appended.
 */
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

// Validate the manual-underwriting override required to approve a
// "refer"-band application: underwriterId/reason/policyReference must be
// present, and if a workflow task for this override exists, the override's
// underwriter must be whoever the task was actually assigned to (not just
// anyone claiming the override).
function manualUnderwritingFindings(application, input, options = {}) {
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

  if (Array.isArray(options.activeTasks)) {
    const task = options.activeTasks.find((t) => t.entity.type === "loan_application" && t.entity.id === application.applicationId && t.type === "application.manual_underwriting");
    if (task) {
      if (!task.assignedTo) {
        findings.push(createFinding("error", "RBI-DL-2025", "Manual underwriting task must be assigned before approval.", "manualUnderwriting"));
      } else {
        if (override.underwriterId && override.underwriterId !== task.assignedTo) {
          findings.push(createFinding("error", "RBI-DL-2025", `Decision proposal underwriter ${override.underwriterId} must match the actor assigned to the manual underwriting task (${task.assignedTo}).`, "manualUnderwriting.underwriterId"));
        }
      }
    }
  }

  return findings;
}

// Shape the manual-underwriting override into the evidence record attached
// to a decision proposal, once `manualUnderwritingFindings` has cleared it.
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

// A decline must carry a recognized code; "other" additionally requires a narrative.
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

// Shape the decline reason into the evidence record attached to a decision proposal.
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

// Shared event-append helper: every workflow mutation in this module routes
// through here so `application.workflow.events` is a complete, ordered trail.
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
