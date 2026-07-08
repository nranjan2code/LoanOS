import { APPLICATION_STATUSES } from "./application-workflow.js";
import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { COMPLAINT_STATUSES, computeComplaintSla, enrichComplaint } from "./grievance.js";
import { classifyLoanAsset, computeDelinquency } from "./loan-account.js";
import { createLoanId } from "./loan-policy.js";

export const WORKFLOW_TASK_STATUSES = {
  OPEN: "open",
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress"
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
  "loan_account.npa_review": 24,
  "complaint.assignment": 24,
  "complaint.resolution": 720,
  "complaint.rbi_cms_escalation": 24
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
    ...deriveComplaintTasks(Object.values(state?.complaints ?? {}), asOf)
  ]
    .map((task) => applyTaskRecord(task, taskStore.records[task.taskId]))
    .map((task) => withTaskSla(task, asOf));

  return tasks.filter((task) => matchesTaskFilters(task, options.filters ?? {}));
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
      return [
        applicationTask(application, {
          type: "application.decision_approval",
          title: "Checker approval for credit decision",
          description: "A checker must approve or reject the pending credit decision before disbursement.",
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
            pendingDecision: application.pendingDecision ?? null
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
