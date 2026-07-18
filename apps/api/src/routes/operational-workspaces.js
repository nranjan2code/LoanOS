import { deriveWorkflowTasks } from "@loanos/core";

const WORKSPACES = Object.freeze({
  origination: {
    label: "Origination",
    description: "Application, KYC, underwriting, contracting and disbursement work.",
    collections: [
      ["loanApplications", "Loan application"],
      ["journeyWorkspaceDrafts", "Journey capture"],
      ["composedJourneyLifecycles", "Composed journey"],
      ["specialistJourneyCases", "Specialist assessment"],
      ["specialistJourneyExceptions", "Specialist exception"],
      ["disbursementTranches", "Disbursement tranche"]
    ]
  },
  servicing: {
    label: "Servicing",
    description: "Loan accounts, service requests, documents, complaints, privacy and closure work.",
    collections: [
      ["loanAccounts", "Loan account"],
      ["servicingChanges", "Servicing change"],
      ["servicingDocuments", "Servicing document"],
      ["successionServiceActions", "Succession service action"],
      ["complaints", "Complaint"],
      ["accessRequests", "Data access request"],
      ["correctionRequests", "Data correction request"],
      ["closureReleases", "Closure release"]
    ]
  },
  collections: {
    label: "Collections & field",
    description: "Treatment, allocation, recovery, legal action, repossession, auction and settlement work.",
    collections: [
      ["collectionTreatmentPlans", "Collection treatment"],
      ["collectionPortfolioAllocations", "Portfolio allocation"],
      ["legalRecoveryCases", "Legal recovery case"],
      ["recoveryRepossessions", "Repossession"],
      ["recoveryAuctions", "Recovery auction"],
      ["collectionAgencySettlements", "Agency settlement"],
      ["recoveryAccounting", "Recovery accounting"],
      ["closureSlaAssessments", "Closure SLA assessment"]
    ]
  },
  control: {
    label: "Control functions",
    description: "Compliance, AML, risk, finance, reporting, audit and operational exceptions.",
    collections: [
      ["amlAlerts", "AML alert"],
      ["fraudCases", "Fraud case"],
      ["portfolioRiskSnapshots", "Portfolio risk snapshot"],
      ["portfolioStressTests", "Portfolio stress test"],
      ["rcsaAssessments", "RCSA assessment"],
      ["modelMonitoringReports", "Model monitoring report"],
      ["financeExceptions", "Finance exception"],
      ["reconciliationBreakAssignments", "Reconciliation break"],
      ["regulatoryReturns", "Regulatory return"],
      ["taxFilings", "Tax filing"],
      ["cicSubmissionBatches", "CIC submission"],
      ["ckycrrSubmissions", "CKYCRR submission"],
      ["fiuReports", "FIU report"],
      ["operationalExceptions", "Operational exception"],
      ["dataQualityAssessments", "Data quality assessment"]
    ]
  },
  partner: {
    label: "Partner operations",
    description: "Channel onboarding, credentials, conduct, finance disputes and oversight work.",
    collections: [
      ["partnerOnboardings", "Partner onboarding"],
      ["partnerCredentials", "Partner credential"],
      ["partnerConductCases", "Partner conduct case"],
      ["partnerFinanceDisputes", "Partner finance dispute"],
      ["channelLeads", "Channel lead"],
      ["partnerOversightAssessments", "Partner oversight assessment"],
      ["partnerCommissionAssessments", "Partner commission assessment"],
      ["lspIncidents", "LSP incident"]
    ]
  }
});

const ADMIN_ROLES = new Set(["tenant_admin", "security_admin", "auditor", "operator"]);
const REFERENCE_FIELDS = ["applicationId", "loanAccountId", "draftId", "lifecycleId", "caseId", "exceptionId", "trancheId", "changeId", "documentId", "actionId", "complaintId", "requestId", "releaseId", "treatmentId", "allocationId", "repossessionId", "auctionId", "settlementId", "recoveryId", "assessmentId", "alertId", "snapshotId", "stressTestId", "reportId", "financeExceptionId", "exceptionId", "breakId", "returnId", "filingId", "batchId", "submissionId", "partnerId", "credentialId", "disputeId", "leadId", "incidentId", "id"];
const STATUS_FIELDS = ["status", "state", "result", "decision", "disposition"];
const OWNER_FIELDS = ["assignedTo", "owner", "ownerId", "caseOwner", "responsibleActor", "proposedBy", "createdBy"];
const DUE_FIELDS = ["dueAt", "dueDate", "slaDueAt", "deadline", "nextActionDueAt", "expiresAt"];
const WORKSPACE_AUTHORITY = Object.freeze({
  origination: /credit|underwrit|origination|loan_ops|disbursement|kyc|operations/,
  servicing: /servic|grievance|complaint|customer|loan_ops|operations/,
  collections: /collection|recovery|field/,
  control: /compliance|risk|fraud|aml|finance|audit|model|regulatory|security|data|operations/,
  partner: /partner|channel|dsa|lsp/
});

export async function routeOperationalWorkspaces(context) {
  const { method, path, res, store, sendJson, authContext } = context;
  if (method === "GET" && path === "/staff/actors") {
    const state = await store.load();
    sendJson(res, 200, {
      actors: Object.values(state.users)
        .filter((user) => (user.roles ?? []).length > 0)
        .map(publicStaffActorView)
    });
    return true;
  }

  const staffActorMatch = path.match(/^\/staff\/actors\/([^/]+)$/);
  if (method === "GET" && staffActorMatch) {
    const state = await store.load();
    const user = state.users[decodeURIComponent(staffActorMatch[1])];
    if (!user || (user.roles ?? []).length === 0) {
      sendJson(res, 404, { error: { code: "not_found", message: "Staff actor not found." } });
      return true;
    }
    sendJson(res, 200, publicStaffActorView(user));
    return true;
  }

  if (path !== "/operational-workspaces") return false;
  if (method !== "GET") return false;
  if (authContext?.principalType !== "tenant_user") {
    sendJson(res, 403, { error: { code: "operational_workspace_forbidden", message: "An authenticated tenant staff session is required." } });
    return true;
  }

  const state = await store.load();
  const user = state.users?.[authContext.userId] ?? {};
  const authority = staffAuthority(authContext, user);
  const requestedView = new URL(context.req.url, "http://localhost").searchParams.get("view");
  if (requestedView && !Object.hasOwn(WORKSPACES, requestedView)) {
    sendJson(res, 422, { error: { code: "operational_workspace_unknown", message: "Unknown operational workspace." } });
    return true;
  }
  const accessibleWorkspaces = Object.keys(WORKSPACES).filter((workspaceId) => canSeeWorkspace(authority, workspaceId));
  const requested = requestedView ?? accessibleWorkspaces[0];
  if (!requested || !accessibleWorkspaces.includes(requested)) {
    sendJson(res, 403, { error: { code: "operational_workspace_forbidden", message: "The authenticated staff actor does not hold authority for this workspace." } });
    return true;
  }

  const allTasks = deriveWorkflowTasks(state, { asOf: new Date() });
  const visibleTasks = allTasks.filter((task) => canSeeTask(authority, task));
  const items = [
    ...visibleTasks.filter((task) => taskWorkspace(task) === requested).map(projectTask),
    ...projectRecords(state, requested)
  ].sort(compareItems);

  sendJson(res, 200, {
    generatedAt: new Date().toISOString(),
    actor: {
      actorId: authContext.userId,
      displayName: user.displayName ?? authContext.userId,
      roles: authority.roles,
      queues: authority.queues,
      canAssignQueues: authority.canAssignQueues
    },
    workspaces: Object.entries(WORKSPACES).filter(([id]) => accessibleWorkspaces.includes(id)).map(([id, definition]) => ({
      id,
      label: definition.label,
      description: definition.description,
      taskCount: visibleTasks.filter((task) => taskWorkspace(task) === id).length
    })),
    activeWorkspace: requested,
    metrics: metrics(items),
    items
  });
  return true;
}

function publicStaffActorView(user) {
  return {
    actorId: user.userId,
    displayName: user.displayName,
    status: user.status,
    country: user.country,
    roles: user.roles,
    queues: user.queues,
    canAssignQueues: user.canAssignQueues
  };
}

function staffAuthority(authContext, user) {
  const adminRoles = [...new Set([...(authContext.roles ?? []), ...(user.adminRoles ?? [])])];
  return {
    admin: adminRoles.some((role) => ADMIN_ROLES.has(role)),
    roles: [...new Set(user.roles ?? [])],
    queues: [...new Set(user.queues ?? [])],
    canAssignQueues: [...new Set(user.canAssignQueues ?? [])]
  };
}

function canSeeTask(authority, task) {
  if (authority.admin || authority.roles.includes("workflow_admin")) return true;
  const queueVisible = authority.queues.includes("*") || authority.queues.includes(task.queue) || authority.canAssignQueues.includes(task.queue);
  return queueVisible && (authority.roles.includes(task.role) || authority.canAssignQueues.includes(task.queue));
}

function canSeeWorkspace(authority, workspaceId) {
  if (authority.admin || authority.roles.includes("workflow_admin")) return true;
  if (authority.queues.includes("*") || authority.canAssignQueues.includes("*")) return true;
  const authorityText = [...authority.roles, ...authority.queues, ...authority.canAssignQueues].join(" ").toLowerCase();
  return WORKSPACE_AUTHORITY[workspaceId].test(authorityText);
}

function taskWorkspace(task) {
  const value = `${task.type ?? ""} ${task.queue ?? ""} ${task.entityType ?? ""}`.toLowerCase();
  if (/partner|channel|dsa|lsp/.test(value)) return "partner";
  if (/collection|recovery|delinquen|legal_recovery|npa/.test(value)) return "collections";
  if (/application|underwrit|credit|kyc|kfs|disbursement|specialist_journey/.test(value)) return "origination";
  if (/servic|complaint|grievance|data_principal|privacy|closure/.test(value)) return "servicing";
  return "control";
}

function projectTask(task) {
  return {
    itemId: task.taskId,
    kind: "task",
    recordType: task.type,
    title: safeText(task.title, "Workflow task"),
    description: safeText(task.description, "Review the governed task and its evidence boundary."),
    status: task.status ?? "open",
    priority: task.priority ?? "medium",
    queue: task.queue ?? null,
    requiredRole: task.role ?? null,
    owner: task.assignedTo ?? null,
    openedAt: task.openedAt ?? null,
    dueAt: task.dueAt ?? null,
    overdue: Boolean(task.sla?.breached ?? task.overdue),
    entityType: task.entityType ?? task.entity?.type ?? null,
    entityId: task.entityId ?? task.entity?.id ?? null,
    action: task.action ? { method: safeText(task.action.method), path: safeText(task.action.path), description: safeText(task.action.description) } : null,
    taskControls: {
      assign: task.status === "open",
      start: ["open", "assigned"].includes(task.status),
      release: ["assigned", "in_progress"].includes(task.status),
      comment: true
    }
  };
}

function projectRecords(state, workspaceId) {
  return WORKSPACES[workspaceId].collections.flatMap(([collection, label]) => Object.entries(state[collection] ?? {}).map(([recordKey, record]) => projectRecord(record, recordKey, collection, label)));
}

function projectRecord(record, recordKey, collection, label) {
  const itemId = firstScalar(record, REFERENCE_FIELDS) ?? safeText(recordKey, `${collection}-record`);
  const status = firstScalar(record, STATUS_FIELDS) ?? "recorded";
  const dueAt = firstScalar(record, DUE_FIELDS);
  return {
    itemId: `${collection}:${itemId}`,
    kind: "record",
    recordType: collection,
    title: label,
    description: `${label} metadata is available. Open the governed domain action from its workflow task when action is required.`,
    status,
    priority: /blocked|breach|critical|rejected|failed|overdue/i.test(status) ? "high" : "normal",
    queue: null,
    requiredRole: null,
    owner: firstScalar(record, OWNER_FIELDS),
    openedAt: safeScalar(record?.createdAt) ?? safeScalar(record?.openedAt),
    dueAt,
    overdue: Boolean(dueAt && Date.parse(dueAt) < Date.now() && !/closed|completed|resolved|accepted|paid/i.test(status)),
    entityType: collection,
    entityId: String(itemId),
    action: null,
    taskControls: null
  };
}

function firstScalar(record, fields) {
  for (const field of fields) {
    const value = safeScalar(record?.[field]);
    if (value !== null) return value;
  }
  return null;
}

function safeScalar(value) {
  if (!["string", "number", "boolean"].includes(typeof value)) return null;
  return safeText(String(value));
}

function safeText(value, fallback = null) {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return value.slice(0, 240);
}

function metrics(items) {
  return {
    open: items.filter((item) => !/closed|completed|resolved|accepted|paid|cancelled/i.test(item.status)).length,
    overdue: items.filter((item) => item.overdue).length,
    exceptions: items.filter((item) => /exception|blocked|breach|rejected|failed|critical/i.test(`${item.recordType} ${item.status} ${item.priority}`)).length,
    unassigned: items.filter((item) => item.kind === "task" && !item.owner).length
  };
}

function compareItems(left, right) {
  if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
  const priorities = { critical: 0, high: 1, medium: 2, normal: 3, low: 4 };
  const priority = (priorities[left.priority] ?? 5) - (priorities[right.priority] ?? 5);
  return priority || String(left.dueAt ?? left.openedAt ?? "").localeCompare(String(right.dueAt ?? right.openedAt ?? ""));
}
