import { APPLICATION_STATUSES } from "../lending/application-workflow.js";
import { createFinding, summarizeFindings } from "../compliance/compliance-controls.js";
import { COMPLAINT_STATUSES, computeComplaintSla, enrichComplaint } from "../compliance/grievance.js";
import { classifyLoanAsset, computeDelinquency } from "../lending/loan-account.js";
import { createLoanId } from "../lending/loan-policy.js";
import { enrichLegalRecoveryCase, evaluatePromisesToPay } from "../lending/collections-recovery.js";
import { enrichCicCorrection } from "../compliance/cic-reporting.js";
import { REPORT_STATUSES, REPORT_TYPES, enrichFiuReport } from "../compliance/fiu-str.js";
import { SECURITY_INTEREST_STATUSES, enrichSecurityInterest } from "../compliance/cersai.js";
import { projectSpecialistJourneyTasks } from "./specialist-journey-service.js";

export const WORKFLOW_TASK_STATUSES = {
  OPEN: "open",
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed"
};

const TASK_STATUS_VALUES = new Set(Object.values(WORKFLOW_TASK_STATUSES));
const TASK_SLA_HOURS = {
  "application.compliance_exception": 24,
  "application.kfs_acceptance": 24,
  "application.credit_decision": 8,
  "application.manual_underwriting": 8,
  "application.ai_human_review": 4,
  "application.decision_approval": 4,
  "application.document_packet_delivery": 4,
  "application.disbursement": 4,
  "loan_account.recovery_assignment": 24,
  "loan_account.broken_ptp_follow_up": 4,
  "loan_account.npa_review": 24,
  "legal_recovery.notice_issue": 24,
  "legal_recovery.statutory_action": 24,
  "legal_recovery.hearing_follow_up": 24,
  "complaint.assignment": 24,
  "complaint.resolution": 720,
  "complaint.rbi_cms_escalation": 24,
  "data_principal.access_request": 720,
  "data_principal.correction_request": 720,
  "cic.submission": 168,
  "cic.rejected_record_repair": 168,
  "cic.correction_review": 504,
  "ckycrr.submission": 24,
  "ckycrr.response_repair": 24,
  "ckycrr.probable_match": 168,
  "fiu.str_review": 24,
  "fiu.filing": 24,
  "fiu.acknowledgement": 24,
  "fiu.repair": 24,
  "cersai.filing": 24,
  "cersai.response": 24,
  "cersai.repair": 24,
  "specialist_journey.action": 8,
  "specialist_journey.exception": 4,
  "specialist_journey.recovery": 4,
  "agent.proposal_review": 4
};

export function normalizeWorkflowTaskStore(store = {}) {
  return {
    records: store?.records ?? {},
    events: Array.isArray(store?.events) ? store.events : []
  };
}

export function deriveWorkflowTasks(state, options = {}) {
  const asOf = normalizeDate(options.asOf) ?? new Date();
  const taskStore = normalizeWorkflowTaskStore(state?.workflowTasks);
  const tasks = [
    ...deriveApplicationTasks(Object.values(state?.loanApplications ?? {}), asOf),
    ...deriveLoanAccountTasks(Object.values(state?.loanAccounts ?? {}), asOf),
    ...deriveLegalRecoveryTasks(Object.values(state?.legalRecoveryCases ?? {}), asOf),
    ...deriveComplaintTasks(Object.values(state?.complaints ?? {}), asOf),
    ...deriveDataPrincipalTasks(state, asOf),
    ...deriveCicTasks(state, asOf),
    ...deriveCkycrrTasks(state, asOf),
    ...deriveFiuTasks(state, asOf),
    ...deriveCersaiTasks(state, asOf),
    ...deriveSpecialistJourneyTasks(state),
    ...deriveAgentExecutionTasks(state, asOf)
  ]
    .map((task) => applyTaskRecord(task, taskStore.records[task.taskId]))
    .map((task) => withTaskSla(task, asOf));

  return tasks.filter((task) => matchesTaskFilters(task, options.filters ?? {}));
}

function deriveAgentExecutionTasks(state, asOf) {
  const platformState = state?.aiAgentPlatform ?? state;
  const executions = Object.values(platformState?.executions ?? {});
  const installations = platformState?.installations ?? {};

  return executions.flatMap((execution) => {
    if (!execution?.executionId) return [];
    const needsReview = (execution.outcome === "proposal_created" || execution.outcome === "human_handoff") && !execution.humanReview?.disposition;
    if (!needsReview) return [];

    const installation = installations[execution.installationId] ?? {};
    const openedAt = normalizeDate(execution.updatedAt ?? execution.createdAt) ?? asOf;

    return [{
      taskId: `task_agent_review_${execution.executionId}`,
      entityType: "agent_execution",
      entityId: execution.executionId,
      type: "agent.proposal_review",
      title: `Review AI Digital Worker proposal (${installation.templateId ?? "agent_execution"})`,
      description: `Material model output proposal produced by installation ${execution.installationId} requires independent human review.`,
      queue: "model_risk",
      role: "human_reviewer",
      priority: "high",
      regulatoryRefs: ["FREE-AI-2025", "RBI-IT-GRC"],
      openedAt,
      action: {
        method: "POST",
        path: `/ai/agents/executions/${execution.executionId}/human-review`,
        description: "Record human review outcome for agent proposal."
      },
      context: {
        executionId: execution.executionId,
        installationId: execution.installationId,
        outcome: execution.outcome,
        outputRef: execution.outputRef ?? null,
        outputHash: execution.outputHash ?? null
      }
    }];
  });
}

function deriveSpecialistJourneyTasks(state) {
  const tenantIds = [...new Set(Object.values(state?.specialistJourneyCases ?? {}).map((item) => item.tenantId).filter(Boolean))];
  return tenantIds.flatMap((tenantId) => projectSpecialistJourneyTasks(state, tenantId));
}

function deriveCersaiTasks(state, asOf) {
  return Object.values(state?.securityInterests ?? {}).flatMap((interest) => {
    if (!interest?.securityInterestId || interest.status === SECURITY_INTEREST_STATUSES.SATISFIED) return [];
    const enriched = enrichSecurityInterest(interest, asOf); const base = { entityType: "security_interest", entityId: interest.securityInterestId, queue: "security_operations", regulatoryRefs: ["SARFAESI"], openedAt: interest.updatedAt ?? interest.createdAt };
    if (interest.status === SECURITY_INTEREST_STATUSES.DRAFT) return [{ ...base, taskId: `task_cersai_filing_${interest.securityInterestId}`, type: "cersai.filing", title: "Submit CERSAI security interest", description: "Submit the authorised, checksum-sealed CERSAI packet before the filing deadline.", role: "security_officer", priority: enriched.filingOverdue ? "critical" : "high", dueAt: enriched.filingDeadline ?? null, action: { method: "POST", path: `/loan-accounts/${interest.loanAccountId}/security-interests/${interest.securityInterestId}/filing`, description: "Submit CERSAI packet." }, context: { filingDeadline: enriched.filingDeadline } }];
    if (interest.status === SECURITY_INTEREST_STATUSES.FILED) return [{ ...base, taskId: `task_cersai_response_${interest.securityInterestId}`, type: "cersai.response", title: "Reconcile CERSAI response", description: "Record the CERSAI response, fee receipt, and certificate against the exact submitted packet checksum.", role: "security_officer", priority: "high", action: { method: "POST", path: `/loan-accounts/${interest.loanAccountId}/security-interests/${interest.securityInterestId}/registration`, description: "Record CERSAI response." }, context: { checksumSha256: interest.cersaiSubmission?.checksumSha256 ?? null, providerSubmissionRef: interest.cersaiTransactionId ?? null } }];
    if (interest.status === SECURITY_INTEREST_STATUSES.REJECTED) return [{ ...base, taskId: `task_cersai_repair_${interest.securityInterestId}`, type: "cersai.repair", title: "Repair rejected CERSAI submission", description: "Correct source data and create an independently approved replacement security interest.", role: "security_officer", priority: "critical", action: { method: "POST", path: `/loan-accounts/${interest.loanAccountId}/security-interests/${interest.securityInterestId}/repairs`, description: "Create repaired CERSAI security interest." }, context: { errorCode: interest.cersaiResponse?.errorCode ?? null, errorMessage: interest.cersaiResponse?.errorMessage ?? null } }];
    return [];
  });
}

function deriveFiuTasks(state, asOf) {
  return Object.values(state?.fiuReports ?? {}).flatMap((report) => {
    if (!report?.reportId || report.status === REPORT_STATUSES.ACKNOWLEDGED) return [];
    const enriched = enrichFiuReport(report, asOf); const base = { entityType: "fiu_report", entityId: report.reportId, queue: "aml_ops", regulatoryRefs: ["PMLA-2002"], openedAt: report.updatedAt ?? report.createdAt };
    if (report.reportType === REPORT_TYPES.SUSPICIOUS_TRANSACTION && report.status === REPORT_STATUSES.DRAFT) return [{ ...base, taskId: `task_fiu_review_${report.reportId}`, type: "fiu.str_review", title: "Principal Officer review of STR", description: "Review the suspicious transaction report before FINnet filing. Do not disclose the report to the subject.", role: "principal_officer", priority: enriched.filingOverdue ? "critical" : "high", dueAt: enriched.filingDeadline ?? null, action: { method: "POST", path: `/fiu/reports/${report.reportId}/review`, description: "Record Principal Officer review." }, context: { reportType: report.reportType, filingDeadline: enriched.filingDeadline } }];
    if ([REPORT_STATUSES.DRAFT, REPORT_STATUSES.REVIEWED].includes(report.status)) return [{ ...base, taskId: `task_fiu_filing_${report.reportId}`, type: "fiu.filing", title: "Submit FINnet report", description: "File the checksum-sealed FINnet XML packet through the FIU-IND provider boundary.", role: "principal_officer", priority: enriched.filingOverdue ? "critical" : "high", dueAt: enriched.filingDeadline ?? null, action: { method: "POST", path: `/fiu/reports/${report.reportId}/filing`, description: "Submit FINnet XML." }, context: { reportType: report.reportType } }];
    if (report.status === REPORT_STATUSES.FILED) return [{ ...base, taskId: `task_fiu_ack_${report.reportId}`, type: "fiu.acknowledgement", title: "Reconcile FIU-IND acknowledgement", description: "Record the accepted or rejected provider response against the exact FINnet XML checksum.", role: "principal_officer", priority: "high", action: { method: "POST", path: `/fiu/reports/${report.reportId}/acknowledgement`, description: "Record FIU-IND acknowledgement." }, context: { checksumSha256: report.finnetPacket?.checksumSha256 ?? null, providerSubmissionRef: report.providerSubmissionRef ?? null } }];
    if (report.status === REPORT_STATUSES.REJECTED) return [{ ...base, taskId: `task_fiu_repair_${report.reportId}`, type: "fiu.repair", title: "Repair rejected FINnet report", description: "Correct source data and create an independently approved replacement report.", role: "aml_analyst", priority: "critical", action: { method: "POST", path: `/fiu/reports/${report.reportId}/repairs`, description: "Create repaired FINnet report." }, context: { errorCode: report.acknowledgement?.errorCode ?? null, errorMessage: report.acknowledgement?.errorMessage ?? null } }];
    return [];
  });
}

function deriveCkycrrTasks(state, asOf) {
  return Object.values(state?.ckycrrSubmissions ?? {}).flatMap((submission) => {
    if (!submission?.submissionId) return [];
    const base = { entityType: "ckycrr_submission", entityId: submission.submissionId, regulatoryRefs: ["CERSAI-CKYC", "RBI-KYC-2016"] };
    if (submission.status === "ready") return [{ ...base, taskId: `task_ckycrr_submit_${submission.submissionId}`, type: "ckycrr.submission", title: submission.probableMatchDecision === "no_match" ? "Resubmit CKYCRR no-match record" : "Submit approved CKYCRR packet", description: "Digitally sign and transmit the checksum-sealed CKYCRR packet using SFTP or the permitted portal channel.", queue: "kyc_ops", role: "kyc_officer", priority: "high", openedAt: submission.createdAt, action: { method: "POST", path: `/reporting/ckycrr/submissions/${submission.submissionId}/submit`, description: "Record signed CKYCRR transmission." }, context: { borrowerId: submission.borrowerId, operation: submission.operation, checksumSha256: submission.packet.checksumSha256 } }];
    if (submission.status === "rejected") return [{ ...base, taskId: `task_ckycrr_repair_${submission.submissionId}`, type: "ckycrr.response_repair", title: "Repair rejected CKYCRR record", description: "Correct the source KYC data and prepare a new independently approved packet.", queue: "kyc_ops", role: "kyc_officer", priority: "high", openedAt: submission.respondedAt, action: { method: "POST", path: "/reporting/ckycrr/submissions", description: "Create corrected CKYCRR submission." }, context: { errorCode: submission.errorCode, errorMessage: submission.errorMessage } }];
    if (submission.status === "probable_match") return [{ ...base, taskId: `task_ckycrr_match_${submission.submissionId}`, type: "ckycrr.probable_match", title: "Resolve CKYCRR probable match", description: "Select an exact existing customer or confirm no match before CKYCRR withdraws the record after seven calendar days.", queue: "kyc_ops", role: "kyc_checker", priority: "critical", openedAt: submission.respondedAt, dueAt: `${submission.reconciliationDueDate}T23:59:59.999Z`, action: { method: "POST", path: `/reporting/ckycrr/submissions/${submission.submissionId}/probable-match-resolution`, description: "Record independent probable-match decision." }, context: { probableMatches: submission.probableMatches } }];
    return [];
  });
}

function deriveCicTasks(state, asOf) {
  const batchTasks = Object.values(state?.cicSubmissionBatches ?? {}).flatMap((batch) => {
    if (!batch?.batchId) return [];
    if (batch.status === "ready") return [{
      taskId: `task_cic_submission_${batch.batchId}`,
      type: "cic.submission", entityType: "cic_submission_batch", entityId: batch.batchId,
      title: batch.parentBatchId ? "Submit repaired CIC records" : "Submit fortnightly CIC batch",
      description: "Transmit the checksum-sealed UCRF batch and retain provider and borrower-alert evidence.",
      queue: "regulatory_reporting", role: "reporting_officer", priority: "high",
      openedAt: batch.createdAt, dueAt: `${batch.repairDueDate ?? batch.submissionDueDate}T23:59:59.999Z`,
      regulatoryRefs: ["RBI-CIR-2025"],
      action: { method: "POST", path: `/reporting/cic/submissions/${batch.batchId}/submit`, description: "Record CIC transmission evidence." },
      context: { cic: batch.cic, cycleDate: batch.cycleDate, recordCount: batch.recordCount, checksumSha256: batch.checksumSha256 }
    }];
    if (["rejected", "partially_rejected"].includes(batch.status)) return [{
      taskId: `task_cic_repair_${batch.batchId}`,
      type: "cic.rejected_record_repair", entityType: "cic_submission_batch", entityId: batch.batchId,
      title: "Repair and resubmit rejected CIC records", description: "Correct every bureau-rejected record at source and create an approved resubmission within seven days.",
      queue: "data_quality", role: "reporting_officer", priority: "critical", openedAt: batch.acknowledgedAt,
      dueAt: `${batch.repairDueDate}T23:59:59.999Z`, regulatoryRefs: ["RBI-CIR-2025"],
      action: { method: "POST", path: `/reporting/cic/submissions/${batch.batchId}/resubmissions`, description: "Create a corrected resubmission batch." },
      context: { rejectedRecords: batch.recordResults.filter((item) => item.status === "rejected") }
    }];
    return [];
  });
  const correctionTasks = Object.values(state?.cicCorrectionRequests ?? {}).filter((item) => item.status === "open").map((correction) => {
    const enriched = enrichCicCorrection(correction, asOf);
    return {
      taskId: `task_cic_correction_${correction.correctionId}`,
      type: "cic.correction_review", entityType: "cic_correction", entityId: correction.correctionId,
      title: "Investigate CIC data correction", description: "Verify the disputed value against source records, correct at source where accepted, and schedule the corrected reporting cycle.",
      queue: "data_quality", role: "grievance_officer", priority: enriched.institutionSlaBreached ? "critical" : "high",
      openedAt: correction.openedAt, dueAt: `${correction.institutionDueDate}T23:59:59.999Z`, regulatoryRefs: ["RBI-CIR-2025"],
      action: { method: "POST", path: `/borrowers/${correction.borrowerId}/cic-corrections/${correction.correctionId}/resolution`, description: "Resolve the CIC correction request." },
      context: { fieldPath: correction.fieldPath, overallDueDate: correction.overallDueDate, accruedCompensationRupees: enriched.accruedCompensationRupees }
    };
  });
  return [...batchTasks, ...correctionTasks];
}

export function assignWorkflowTask(taskStore, taskId, input, activeTasks, now = new Date()) {
  const findings = validateActiveTaskAction(taskId, input, activeTasks);
  if (!input?.assignedTo) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Task assignment requires assignedTo.", "assignedTo"));
  }
  if (!input?.assignedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Task assignment requires assignedBy.", "assignedBy"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedTaskResult(taskStore, taskId, findings);
  }

  const task = findActiveTask(activeTasks, taskId);
  return updateTaskRecord(taskStore, task, {
    status: WORKFLOW_TASK_STATUSES.ASSIGNED,
    assignedTo: input.assignedTo,
    assignedBy: input.assignedBy,
    assignedAt: now.toISOString(),
    dueAt: input.dueAt ?? task.dueAt ?? null,
    event: {
      type: "workflow.task.assigned",
      assignedTo: input.assignedTo,
      assignedBy: input.assignedBy,
      notes: input.notes ?? null
    }
  }, now);
}

export function startWorkflowTask(taskStore, taskId, input, activeTasks, now = new Date()) {
  const findings = validateActiveTaskAction(taskId, input, activeTasks);
  if (!input?.actor) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Task start requires actor.", "actor"));
  }

  const task = findActiveTask(activeTasks, taskId);
  if (task?.assignedTo && input?.actor && task.assignedTo !== input.actor) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Only the assigned actor can start this task.", "actor"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedTaskResult(taskStore, taskId, findings);
  }

  return updateTaskRecord(taskStore, task, {
    status: WORKFLOW_TASK_STATUSES.IN_PROGRESS,
    startedBy: input.actor,
    startedAt: now.toISOString(),
    event: {
      type: "workflow.task.started",
      actor: input.actor,
      notes: input.notes ?? null
    }
  }, now);
}

export function releaseWorkflowTask(taskStore, taskId, input, activeTasks, now = new Date()) {
  const findings = validateActiveTaskAction(taskId, input, activeTasks);
  if (!input?.actor) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Task release requires actor.", "actor"));
  }
  if (!input?.reason) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Task release requires reason.", "reason"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedTaskResult(taskStore, taskId, findings);
  }

  const task = findActiveTask(activeTasks, taskId);
  return updateTaskRecord(taskStore, task, {
    status: WORKFLOW_TASK_STATUSES.OPEN,
    assignedTo: null,
    assignedBy: null,
    assignedAt: null,
    startedBy: null,
    startedAt: null,
    event: {
      type: "workflow.task.released",
      actor: input.actor,
      reason: input.reason
    }
  }, now);
}

export function commentOnWorkflowTask(taskStore, taskId, input, activeTasks, now = new Date()) {
  const findings = validateActiveTaskAction(taskId, input, activeTasks);
  if (!input?.actor) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Task comment requires actor.", "actor"));
  }
  if (!input?.comment) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Task comment requires comment.", "comment"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedTaskResult(taskStore, taskId, findings);
  }

  const task = findActiveTask(activeTasks, taskId);
  return updateTaskRecord(taskStore, task, {
    event: {
      type: "workflow.task.commented",
      actor: input.actor,
      comment: input.comment
    }
  }, now);
}

export function completeWorkflowTask(taskStore, taskId, input, activeTasks, now = new Date()) {
  const findings = validateActiveTaskAction(taskId, input, activeTasks);
  if (!input?.actor) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Task completion requires actor.", "actor"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedTaskResult(taskStore, taskId, findings);
  }

  const task = findActiveTask(activeTasks, taskId);
  return updateTaskRecord(taskStore, task, {
    status: WORKFLOW_TASK_STATUSES.COMPLETED,
    completedBy: input.actor,
    completedAt: now.toISOString(),
    event: {
      type: "workflow.task.completed",
      actor: input.actor,
      notes: input.notes ?? null
    }
  }, now);
}

function deriveApplicationTasks(applications, asOf) {
  return applications.flatMap((application) => {
    if (!application?.applicationId) {
      return [];
    }

    if (application.status === APPLICATION_STATUSES.BLOCKED_COMPLIANCE) {
      return [
        applicationTask(application, {
          type: "application.compliance_exception",
          title: "Resolve blocked compliance preflight",
          description: "Review compliance findings and update the application or source registries before lending can continue.",
          queue: "compliance_ops",
          role: "compliance_analyst",
          priority: "high",
          openedAt: findApplicationWorkflowAt(application, ["application.preflight.completed"]) ?? application.createdAt,
          action: {
            method: "POST",
            path: "/loans/applications",
            description: "Submit a corrected application or update referenced borrower/product/RE records."
          },
          context: {
            findingSummary: application.compliance?.summary ?? null,
            findings: application.compliance?.findings ?? []
          }
        })
      ];
    }

    if (application.status === APPLICATION_STATUSES.KFS_ISSUED) {
      return [
        applicationTask(application, {
          type: "application.kfs_acceptance",
          title: "Capture KFS delivery and acceptance",
          description: "Collect KFS delivery channel, delivery reference, and borrower acceptance evidence.",
          queue: "loan_ops",
          role: "loan_officer",
          priority: "medium",
          openedAt: findApplicationWorkflowAt(application, ["application.kfs.issued"]) ?? application.updatedAt,
          action: {
            method: "POST",
            path: `/loans/applications/${application.applicationId}/kfs`,
            description: "Attach KFS acceptance evidence."
          },
          context: {
            kfsId: application.kfs?.kfsId ?? null,
            kfsReadiness: application.kfsReadiness ?? null
          }
        })
      ];
    }

    if (application.status === APPLICATION_STATUSES.READY_FOR_DECISION) {
      const openedAt = findApplicationWorkflowAt(application, ["application.kfs.accepted"]) ?? application.updatedAt;
      if (application.eligibility?.decision === "refer") {
        return [
          applicationTask(application, {
            type: "application.manual_underwriting",
            title: "Manual underwriting review for referred application",
            description: "Eligibility engine referred this application for manual affordability judgement. Approval requires a manual underwriting override with underwriter, reason, and policy reference.",
            queue: "credit_ops",
            role: "credit_officer",
            priority: "high",
            regulatoryRefs: ["RBI-DL-2025"],
            openedAt,
            action: {
              method: "POST",
              path: `/loans/applications/${application.applicationId}/decision`,
              description: "Approve with a manual underwriting override (underwriterId, reason, policyReference) or record a decline."
            },
            context: {
              eligibility: application.eligibility,
              requiresManualUnderwritingOverride: true
            }
          })
        ];
      }
      return [
        applicationTask(application, {
          type: "application.credit_decision",
          title: "Propose credit decision",
          description: "Review policy, KYC, KFS, and underwriting evidence and propose approve or decline.",
          queue: "credit_ops",
          role: "credit_officer",
          priority: "medium",
          openedAt,
          action: {
            method: "POST",
            path: `/loans/applications/${application.applicationId}/decision`,
            description: "Submit decision proposal."
          },
          context: {
            eligibility: application.eligibility ?? null
          }
        })
      ];
    }

    if (application.status === APPLICATION_STATUSES.HUMAN_REVIEW_REQUIRED) {
      return [
        applicationTask(application, {
          type: "application.ai_human_review",
          title: "Complete human review for AI-assisted decision",
          description: "Review material model output before the credit decision can proceed.",
          queue: "model_risk",
          role: "human_reviewer",
          priority: "high",
          regulatoryRefs: ["FREE-AI-2025", "RBI-IT-GRC"],
          openedAt: findApplicationWorkflowAt(application, ["application.human_review.required"]) ?? application.updatedAt,
          action: {
            method: "POST",
            path: `/loans/applications/${application.applicationId}/human-reviews`,
            description: "Record human review outcome."
          },
          context: {
            aiDecision: application.aiDecision ?? null
          }
        })
      ];
    }

    if (application.status === APPLICATION_STATUSES.PENDING_DECISION_APPROVAL) {
      const pendingDecision = application.pendingDecision ?? null;
      const manualUnderwriting = pendingDecision?.manualUnderwriting ?? null;
      return [
        applicationTask(application, {
          type: "application.decision_approval",
          title: "Checker approval for credit decision",
          description: manualUnderwriting
            ? "A checker must approve or reject the pending credit decision before disbursement. This referred application carries a manual underwriting override: review the underwriter's rationale and policy reference, and note that the checker cannot be the underwriter."
            : "A checker must approve or reject the pending credit decision before disbursement.",
          queue: "credit_checker",
          role: "credit_checker",
          priority: "high",
          openedAt: findApplicationWorkflowAt(application, ["application.decision.proposed"]) ?? application.updatedAt,
          action: {
            method: "POST",
            path: `/loans/applications/${application.applicationId}/approvals`,
            description: "Approve or reject the decision proposal."
          },
          context: {
            pendingDecision,
            manualUnderwriting,
            requiresManualUnderwritingReview: Boolean(manualUnderwriting)
          }
        })
      ];
    }

    if (application.status === APPLICATION_STATUSES.APPROVED && !application.documentPacket?.delivery?.deliveryRef) {
      return [
        applicationTask(application, {
          type: "application.document_packet_delivery",
          title: "Generate and deliver execution document packet",
          description: "Approved application needs KFS, sanction letter, agreement summary, and privacy notice delivery before disbursement.",
          queue: "loan_ops",
          role: "loan_officer",
          priority: "high",
          regulatoryRefs: ["RBI-KFS-2024", "RBI-DL-2025", "DPDP-RULES-2025"],
          openedAt: findApplicationWorkflowAt(application, ["application.decision.approved"]) ?? application.updatedAt,
          action: {
            method: "POST",
            path: `/loans/applications/${application.applicationId}/document-packet`,
            description: "Generate and deliver document packet."
          }
        })
      ];
    }

    if (application.status === APPLICATION_STATUSES.APPROVED && !application.disbursement?.disbursementId) {
      return [
        applicationTask(application, {
          type: "application.disbursement",
          title: "Execute compliant disbursement",
          description: "Disburse only to borrower or permitted end-beneficiary account after KFS and fund-flow checks.",
          queue: "disbursement_ops",
          role: "disbursement_maker",
          priority: "high",
          openedAt: findApplicationWorkflowAt(application, ["application.decision.approved"]) ?? application.updatedAt,
          action: {
            method: "POST",
            path: `/loans/applications/${application.applicationId}/disbursement`,
            description: "Record disbursement."
          }
        })
      ];
    }

    return [];
  });
}

function deriveLoanAccountTasks(loanAccounts, asOf) {
  return loanAccounts.flatMap((account) => {
    if (!account?.loanAccountId || account.status !== "active") {
      return [];
    }

    const tasks = [];
    const delinquency = computeDelinquency(account, asOf);
    const hasActiveRecoveryAssignment = (account.recoveryAssignments ?? []).some((assignment) => assignment.status === "active");

    if (delinquency.daysPastDue > 0 && !hasActiveRecoveryAssignment) {
      tasks.push(loanAccountTask(account, {
        type: "loan_account.recovery_assignment",
        title: "Assign noticed recovery agent",
        description: "Delinquent account needs borrower notice evidence before a recovery agent is assigned.",
        queue: "collections_ops",
        role: "collections_manager",
        priority: delinquency.daysPastDue > 30 ? "high" : "medium",
        regulatoryRefs: ["RBI-DL-2025"],
        openedAt: delinquency.earliestUnpaidDueDate ? `${addDays(delinquency.earliestUnpaidDueDate, 1)}T00:00:00.000Z` : asOf.toISOString(),
        action: {
          method: "POST",
          path: `/loan-accounts/${account.loanAccountId}/recovery-assignments`,
          description: "Assign recovery agent with notice evidence."
        },
        context: {
          delinquency
        }
      }));
    }

    const classification = classifyLoanAsset(account, asOf);
    if (classification.isNpa) {
      tasks.push(loanAccountTask(account, {
        type: "loan_account.npa_review",
        title: "Review NPA account",
        description: "NPA account requires risk review, provisioning evidence, and reporting readiness checks.",
        queue: "risk_ops",
        role: "portfolio_risk_manager",
        priority: "critical",
        regulatoryRefs: ["RBI-PRUDENTIAL"],
        openedAt: classification.delinquency?.earliestUnpaidDueDate
          ? `${addDays(classification.delinquency.earliestUnpaidDueDate, 91)}T00:00:00.000Z`
          : asOf.toISOString(),
        action: {
          method: "GET",
          path: `/loan-accounts/${account.loanAccountId}/cic-snapshot`,
          description: "Review asset classification and CIC snapshot."
        },
        context: {
          classification
        }
      }));
    }

    const brokenPromises = evaluatePromisesToPay(account, asOf).filter((promise) => promise.status === "broken");
    if (brokenPromises.length > 0) {
      tasks.push(loanAccountTask(account, {
        type: "loan_account.broken_ptp_follow_up",
        title: "Follow up broken promise-to-pay",
        description: "One or more borrower payment promises matured with a shortfall and require a recorded follow-up treatment.",
        queue: "collections_ops",
        role: "collections_manager",
        priority: "high",
        openedAt: `${brokenPromises[0].promisedDate}T23:59:59.999Z`,
        action: { method: "POST", path: `/loan-accounts/${account.loanAccountId}/collection-contacts`, description: "Record the follow-up contact and disposition." },
        context: { brokenPromises }
      }));
    }

    return tasks;
  });
}

function deriveLegalRecoveryTasks(cases, asOf) {
  return cases.flatMap((legalCase) => {
    if (!legalCase?.caseId || ["closed", "withdrawn"].includes(legalCase.status)) return [];
    const enriched = enrichLegalRecoveryCase(legalCase, asOf); const tasks = [];
    if (legalCase.status === "strategy_approved") tasks.push(legalRecoveryTask(legalCase, { type: "legal_recovery.notice_issue", title: "Issue approved legal notice", description: "Generate, independently approve, deliver, and evidence the track-specific legal notice.", queue: "collections_ops", role: "collections_manager", priority: "critical", openedAt: legalCase.openedAt, dueAt: legalCase.chequeDetails?.noticeIssueDeadline ?? null, action: { method: "POST", path: `/legal-recovery-cases/${legalCase.caseId}/notices`, description: "Issue and evidence the legal notice." }, context: { track: legalCase.track, chequeDetails: legalCase.chequeDetails } }));
    if (legalCase.status === "notice_issued" && enriched.statutoryClock?.expired) tasks.push(legalRecoveryTask(legalCase, { type: "legal_recovery.statutory_action", title: "Review expired statutory recovery clock", description: "The notice response period expired; record payment, settlement, filing, or approved enforcement action.", queue: "collections_ops", role: "collections_manager", priority: "critical", openedAt: enriched.statutoryClock.deadline, action: { method: "POST", path: `/legal-recovery-cases/${legalCase.caseId}/events`, description: "Record the governed next legal action." }, context: { track: legalCase.track, statutoryClock: enriched.statutoryClock } }));
    if (enriched.hearingOverdue) tasks.push(legalRecoveryTask(legalCase, { type: "legal_recovery.hearing_follow_up", title: "Update overdue legal hearing", description: "The recorded hearing date has passed without a subsequent case event.", queue: "collections_ops", role: "collections_manager", priority: "high", openedAt: `${legalCase.nextHearingDate}T23:59:59.999Z`, action: { method: "POST", path: `/legal-recovery-cases/${legalCase.caseId}/events`, description: "Record hearing outcome or next hearing." }, context: { nextHearingDate: legalCase.nextHearingDate, courtCaseNumber: legalCase.courtCaseNumber } }));
    return tasks;
  });
}

function deriveComplaintTasks(complaints, asOf) {
  return complaints.flatMap((complaint) => {
    if (!complaint?.complaintId || complaint.status === COMPLAINT_STATUSES.RESOLVED || complaint.status === COMPLAINT_STATUSES.ESCALATED_TO_RBI_CMS) {
      return [];
    }

    const enriched = enrichComplaint(complaint, asOf);
    const sla = computeComplaintSla(complaint, asOf);
    const tasks = [];

    if (enriched.effectiveStatus === "escalation_due") {
      tasks.push(complaintTask(complaint, {
        type: "complaint.rbi_cms_escalation",
        title: "Escalate overdue complaint to RBI CMS",
        description: "Complaint crossed the 30-day RBI Ombudsman threshold and needs RBI CMS escalation evidence.",
        queue: "grievance_ops",
        role: "grievance_officer",
        priority: "critical",
        regulatoryRefs: ["RBI-IOS-2021", "RBI-DL-2025"],
        openedAt: sla.dueAt,
        action: {
          method: "POST",
          path: `/complaints/${complaint.complaintId}/rbi-cms-escalation`,
          description: "Record RBI CMS escalation reference."
        },
        context: {
          complaint: enriched
        }
      }));
      return tasks;
    }

    if (complaint.status === COMPLAINT_STATUSES.RECEIVED) {
      tasks.push(complaintTask(complaint, {
        type: "complaint.assignment",
        title: "Assign complaint to grievance officer",
        description: "New borrower complaint needs assignment to a grievance officer.",
        queue: "grievance_ops",
        role: "grievance_officer",
        priority: "high",
        regulatoryRefs: ["RBI-DL-2025", "RBI-IOS-2021"],
        openedAt: complaint.receivedAt,
        action: {
          method: "POST",
          path: `/complaints/${complaint.complaintId}/assignments`,
          description: "Assign complaint."
        },
        context: {
          complaint: enriched
        }
      }));
    }

    if ([COMPLAINT_STATUSES.ASSIGNED, COMPLAINT_STATUSES.UNDER_REVIEW].includes(complaint.status)) {
      tasks.push(complaintTask(complaint, {
        type: "complaint.resolution",
        title: "Resolve borrower complaint",
        description: "Complaint must be reviewed and resolved within the 30-day RBI Ombudsman threshold.",
        queue: "grievance_ops",
        role: "grievance_officer",
        priority: sla.status === "due_soon" ? "high" : "medium",
        regulatoryRefs: ["RBI-DL-2025", "RBI-IOS-2021"],
        openedAt: complaint.receivedAt,
        dueAt: sla.dueAt,
        action: {
          method: "POST",
          path: `/complaints/${complaint.complaintId}/resolution`,
          description: "Record complaint resolution evidence."
        },
        context: {
          complaint: enriched
        }
      }));
    }

    return tasks;
  });
}

function deriveDataPrincipalTasks(state, asOf) {
  const tasks = [];

  for (const request of Object.values(state?.accessRequests ?? {})) {
    if (!request?.accessRequestId || request.status !== "requested") {
      continue;
    }
    tasks.push(dataPrincipalTask("access_request", request.accessRequestId, request, {
      type: "data_principal.access_request",
      title: "Fulfil DPDP data-principal access request",
      description: "Assemble and deliver the borrower's portable data pack within the 30-day DPDP SLA.",
      queue: "privacy_ops",
      role: "data_protection_officer",
      priority: "high",
      regulatoryRefs: ["DPDP-2023"],
      openedAt: request.requestedAt ?? request.createdAt,
      action: {
        method: "POST",
        path: `/borrowers/${request.borrowerId}/access-requests/${request.accessRequestId}/fulfillment`,
        description: "Fulfil the access request and deliver the data pack."
      },
      context: { borrowerId: request.borrowerId }
    }));
  }

  for (const request of Object.values(state?.correctionRequests ?? {})) {
    if (!request?.correctionRequestId || request.status !== "requested") {
      continue;
    }
    tasks.push(dataPrincipalTask("correction_request", request.correctionRequestId, request, {
      type: "data_principal.correction_request",
      title: "Review DPDP data-principal correction request",
      description: "Review the requested correction and apply or reject it within the 30-day DPDP SLA.",
      queue: "privacy_ops",
      role: "data_protection_officer",
      priority: "high",
      regulatoryRefs: ["DPDP-2023"],
      openedAt: request.requestedAt ?? request.createdAt,
      action: {
        method: "POST",
        path: `/borrowers/${request.borrowerId}/correction-requests/${request.correctionRequestId}/review`,
        description: "Apply or reject the correction request."
      },
      context: { borrowerId: request.borrowerId, fieldPath: request.fieldPath }
    }));
  }

  return tasks;
}

function dataPrincipalTask(entityType, entityId, request, task) {
  return baseTask({
    ...task,
    entity: {
      type: `data_principal_${entityType}`,
      id: entityId
    },
    sourceStatus: request.status,
    borrowerId: request.borrowerId ?? null,
    regulatedEntityId: null,
    productId: null
  });
}

function applicationTask(application, task) {
  return baseTask({
    ...task,
    entity: {
      type: "loan_application",
      id: application.applicationId
    },
    sourceStatus: application.status,
    borrowerId: application.borrowerId ?? application.borrower?.borrowerId ?? null,
    regulatedEntityId: application.regulatedEntityId ?? application.regulatedEntity?.regulatedEntityId ?? null,
    productId: application.productId ?? application.product?.productId ?? null
  });
}

function loanAccountTask(account, task) {
  return baseTask({
    ...task,
    entity: {
      type: "loan_account",
      id: account.loanAccountId
    },
    sourceStatus: account.status,
    borrowerId: account.borrowerId ?? null,
    regulatedEntityId: account.regulatedEntityId ?? null,
    productId: account.productId ?? null
  });
}

function legalRecoveryTask(legalCase, task) {
  return baseTask({ ...task, entity: { type: "legal_recovery_case", id: legalCase.caseId }, sourceStatus: legalCase.status, borrowerId: legalCase.borrowerId ?? null, regulatedEntityId: null, productId: null });
}

function complaintTask(complaint, task) {
  return baseTask({
    ...task,
    entity: {
      type: "complaint",
      id: complaint.complaintId
    },
    sourceStatus: complaint.status,
    borrowerId: complaint.borrowerId ?? null,
    regulatedEntityId: complaint.regulatedEntityId ?? null,
    productId: complaint.productId ?? null
  });
}

function baseTask(task) {
  return {
    taskId: `${task.type}:${task.entity.id}`,
    status: WORKFLOW_TASK_STATUSES.OPEN,
    regulatoryRefs: task.regulatoryRefs ?? ["RBI-DL-2025", "RBI-IT-GRC"],
    assignedTo: null,
    assignedBy: null,
    assignedAt: null,
    startedBy: null,
    startedAt: null,
    openedAt: normalizeDate(task.openedAt)?.toISOString() ?? null,
    dueAt: task.dueAt ?? null,
    sla: null,
    updatedAt: null,
    events: [],
    ...task
  };
}

function applyTaskRecord(task, record = {}) {
  const status = TASK_STATUS_VALUES.has(record.status) ? record.status : task.status;
  return {
    ...task,
    status,
    assignedTo: record.assignedTo ?? task.assignedTo,
    assignedBy: record.assignedBy ?? task.assignedBy,
    assignedAt: record.assignedAt ?? task.assignedAt,
    startedBy: record.startedBy ?? task.startedBy,
    startedAt: record.startedAt ?? task.startedAt,
    openedAt: record.openedAt ?? task.openedAt,
    dueAt: record.dueAt ?? task.dueAt,
    updatedAt: record.updatedAt ?? task.updatedAt,
    events: Array.isArray(record.events) ? record.events : task.events
  };
}

function updateTaskRecord(taskStore, task, changes, now) {
  const store = normalizeWorkflowTaskStore(taskStore);
  const previous = store.records[task.taskId] ?? {};
  const event = {
    eventId: createLoanId("taskevt"),
    taskId: task.taskId,
    type: changes.event.type,
    at: now.toISOString(),
    ...changes.event
  };
  const record = {
    taskId: task.taskId,
    type: task.type,
    entity: task.entity,
    queue: task.queue,
    status: changes.status ?? previous.status ?? task.status,
    assignedTo: changes.assignedTo === undefined ? previous.assignedTo ?? task.assignedTo : changes.assignedTo,
    assignedBy: changes.assignedBy === undefined ? previous.assignedBy ?? task.assignedBy : changes.assignedBy,
    assignedAt: changes.assignedAt === undefined ? previous.assignedAt ?? task.assignedAt : changes.assignedAt,
    startedBy: changes.startedBy === undefined ? previous.startedBy ?? task.startedBy : changes.startedBy,
    startedAt: changes.startedAt === undefined ? previous.startedAt ?? task.startedAt : changes.startedAt,
    openedAt: previous.openedAt ?? task.openedAt,
    dueAt: changes.dueAt === undefined ? previous.dueAt ?? task.dueAt : changes.dueAt,
    updatedAt: now.toISOString(),
    events: [...(previous.events ?? []), event]
  };
  const workflowTasks = {
    records: {
      ...store.records,
      [task.taskId]: record
    },
    events: [...store.events, event]
  };

  return {
    workflowTasks,
    task: withTaskSla(applyTaskRecord(task, record), now),
    event,
    findings: [],
    summary: summarizeFindings([])
  };
}

function validateActiveTaskAction(taskId, input, activeTasks) {
  const findings = [];
  if (!taskId) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Task id is required.", "taskId"));
  }
  if (!findActiveTask(activeTasks, taskId)) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Workflow task is not currently active.", "taskId"));
  }
  if (!input || typeof input !== "object") {
    findings.push(createFinding("error", "RBI-IT-GRC", "Task action body is required.", "body"));
  }
  return findings;
}

function blockedTaskResult(taskStore, taskId, findings) {
  return {
    workflowTasks: normalizeWorkflowTaskStore(taskStore),
    task: null,
    event: null,
    taskId,
    findings,
    summary: summarizeFindings(findings)
  };
}

function findActiveTask(activeTasks, taskId) {
  return Array.isArray(activeTasks) ? activeTasks.find((task) => task.taskId === taskId) ?? null : null;
}

function matchesTaskFilters(task, filters) {
  if (filters.queue && task.queue !== filters.queue) {
    return false;
  }
  if (filters.type && task.type !== filters.type) {
    return false;
  }
  if (filters.entityType && task.entity.type !== filters.entityType) {
    return false;
  }
  if (filters.assignedTo && task.assignedTo !== filters.assignedTo) {
    return false;
  }
  if (filters.slaStatus && task.sla?.status !== filters.slaStatus) {
    return false;
  }
  if (filters.status) {
    if (filters.status === "active") {
      return TASK_STATUS_VALUES.has(task.status);
    }
    return task.status === filters.status;
  }
  return true;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function withTaskSla(task, asOf) {
  const targetHours = TASK_SLA_HOURS[task.type] ?? 24;
  const openedAt = normalizeDate(task.openedAt) ?? asOf;
  const dueAt = normalizeDate(task.dueAt) ?? addHours(openedAt, targetHours);
  const remainingMinutes = Math.ceil((dueAt.getTime() - asOf.getTime()) / 60000);
  const status = remainingMinutes < 0 ? "breached" : remainingMinutes <= 60 ? "due_soon" : "on_track";

  return {
    ...task,
    openedAt: openedAt.toISOString(),
    dueAt: dueAt.toISOString(),
    sla: {
      policyId: `${task.type}.sla.v1`,
      targetHours,
      openedAt: openedAt.toISOString(),
      dueAt: dueAt.toISOString(),
      status,
      breached: status === "breached",
      remainingMinutes
    }
  };
}

function findApplicationWorkflowAt(application, eventTypes) {
  const types = new Set(eventTypes);
  const events = [...(application.workflow?.events ?? [])].reverse();
  return events.find((event) => types.has(event.type))?.at ?? null;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
