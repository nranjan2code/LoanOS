import { createServer } from "node:http";
import {
  accrueInterest,
  attachKfs,
  applyDecisionApproval,
  applyKfsWorkflow,
  assignComplaint,
  assignRecoveryAgent,
  assignWorkflowTask,
  assessChargeToLoanAccount,
  buildKeyFactStatement,
  classifyLoanAsset,
  clearGlobalKillSwitch,
  commentOnWorkflowTask,
  createLoanAccountFromApplication,
  createLoanId,
  computeDelinquency,
  createComplaint,
  DECLINE_REASON_CODES,
  deriveWorkflowTasks,
  forecloseLoanAccount,
  enrichComplaint,
  escalateComplaintToRbiCms,
  evaluateEligibility,
  evaluateLoanApplication,
  generateDlaCimsExport,
  generateClosureCertificate,
  generateDocumentPacket,
  generateCicSnapshot,
  generateLoanStatement,
  initializeApplicationWorkflow,
  listBorrowerConsents,
  listBorrowerKycRecords,
  listRegulatoryControls,
  registerModel,
  recordHumanReview,
  recordDocumentPacketDelivered,
  recordDocumentPacketDelivery,
  recordDocumentPacketGenerated,
  recordPostIncidentReview,
  releaseWorkflowTask,
  renderLoanStatementDocument,
  resolveComplaint,
  resolveBorrowerApplicationReferences,
  resolveLoanApplicationReferences,
  summarizeFindings,
  markDisbursed,
  postCashRecoveryToLoanAccount,
  postPaymentToLoanAccount,
  prepayLoanAccount,
  proposeDecision,
  quoteForeclosure,
  reverseLoanAccountEvent,
  summarizeLoanAccount,
  startComplaintReview,
  startWorkflowTask,
  transitionModel,
  triggerKillSwitch,
  upsertDigitalLendingApp,
  upsertLendingServiceProvider,
  upsertBorrowerProfile,
  upsertConsentRecord,
  upsertKycRecord,
  upsertProductPolicy,
  upsertRegulatedEntity,
  upsertStaffActor,
  validateDisbursement,
  validateDecisionApprovalAccess,
  validateDecisionProposalAccess,
  validateDocumentPacketAccess,
  validateDocumentPacketBeforeDisbursement,
  validateGrievanceOfficerAccess,
  validateHumanReviewAccess,
  validateKfsBeforeDecision,
  validateManualUnderwritingAccess,
  validateRecoveryAssignmentAccess,
  validateWorkflowActorAccess,
  validateWorkflowAssignmentAccess,
  waiveLoanAccountCharge
} from "../../../packages/core/src/index.js";
import {
  buildAuditEvidencePack,
  sealAuditChain
} from "../../../packages/core/src/index.js";
import {
  appendEvent,
  buildTenantExport,
  createEmptyTenantData,
  ensureBootstrapTenants,
  generateApiKey,
  getTenantData,
  listSubProcessors,
  listTenants,
  loadState as loadWholeState,
  offboardTenant,
  publicSubProcessor,
  publicTenant,
  registerSubProcessor,
  registerTenant,
  resolveTenantByApiKey,
  saveState as saveWholeState,
  setTenantData,
  validateSubProcessor
} from "./file-store.js";

const DEFAULT_PORT = Number(process.env.PORT || 3040);

export function createLoanOsServer({ dataDir, bootstrapTenants = [], platformAdminKey } = {}) {
  const adminKey = platformAdminKey ?? process.env.LOANOS_PLATFORM_ADMIN_KEY ?? null;
  let bootstrapPromise = null;
  return createServer(async (req, res) => {
    try {
      if (!bootstrapPromise) {
        bootstrapPromise = ensureBootstrapTenants(dataDir, bootstrapTenants);
      }
      await bootstrapPromise;
      await route(req, res, dataDir, adminKey);
    } catch (error) {
      sendJson(res, 500, {
        error: {
          code: "internal_error",
          message: error.message
        }
      });
    }
  });
}

async function route(req, res, dataDir, platformAdminKey) {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  // --- Open routes: no tenant context required. ---
  if (method === "GET" && path === "/health") {
    sendJson(res, 200, {
      status: "ok",
      service: "loanos-india-api"
    });
    return;
  }

  if (method === "GET" && path === "/compliance/controls") {
    sendJson(res, 200, {
      controls: listRegulatoryControls()
    });
    return;
  }

  if (method === "GET" && path === "/reference/decline-reasons") {
    sendJson(res, 200, {
      declineReasons: Object.entries(DECLINE_REASON_CODES).map(([code, label]) => ({ code, label }))
    });
    return;
  }

  // --- Platform control plane: administers tenants and the sub-processor
  // register, gated on the platform admin key (never a tenant api key). ---
  if (path === "/platform" || path.startsWith("/platform/")) {
    await routePlatform(req, res, { dataDir, platformAdminKey, method, path, url });
    return;
  }

  // --- Tenant context: every data-plane route runs inside exactly one tenant. ---
  const wholeState = await loadWholeState(dataDir);
  const apiKey = tenantApiKeyFromRequest(req);
  const tenant = resolveTenantByApiKey(wholeState, apiKey);
  if (!tenant) {
    sendJson(res, 401, {
      error: {
        code: "tenant_auth_required",
        message: "A valid tenant API key is required for this route."
      }
    });
    return;
  }

  // The store hands each handler ONLY this tenant's partition. There is no code
  // path from a handler back to another tenant's data. On every save the tenant's
  // audit events are sealed into an append-only hash chain, so the persisted
  // record is tamper-evident by construction.
  let scopedWholeState = wholeState;
  const store = {
    load: async () => getTenantData(scopedWholeState, tenant.tenantId) ?? createEmptyTenantData(),
    save: async (tenantData) => {
      const sealed = {
        ...tenantData,
        events: sealAuditChain(tenantData.events, tenant.tenantId)
      };
      scopedWholeState = setTenantData(scopedWholeState, tenant.tenantId, sealed);
      await saveWholeState(scopedWholeState, dataDir);
    }
  };

  if (method === "GET" && path === "/audit/events") {
    const state = await store.load();
    const filters = auditFiltersFromUrl(url);
    const pack = buildAuditEvidencePack(state.events, tenant.tenantId, { filters });
    sendJson(res, 200, {
      tenantId: pack.tenantId,
      count: pack.exportedCount,
      chainValid: pack.integrity.valid,
      integrity: pack.integrity,
      events: pack.events
    });
    return;
  }

  if (method === "GET" && path === "/audit/export") {
    const state = await store.load();
    const filters = auditFiltersFromUrl(url);
    const pack = buildAuditEvidencePack(state.events, tenant.tenantId, { filters });
    // The evidence pack is only handed out when the chain verifies; a broken
    // chain surfaces a 409 so an auditor never receives a silently-tampered pack.
    sendJson(res, pack.integrity.valid ? 200 : 409, pack);
    return;
  }

  // Standing sub-processor disclosure: every authenticated tenant RE can read
  // the platform-wide register of LoanOS sub-processors that apply to it.
  if (method === "GET" && path === "/sub-processors") {
    sendJson(res, 200, {
      subProcessors: listSubProcessors(wholeState)
    });
    return;
  }

  if (method === "GET" && path === "/staff/actors") {
    const state = await store.load();
    sendJson(res, 200, {
      actors: Object.values(state.staffActors)
    });
    return;
  }

  if (method === "GET" && path === "/complaints") {
    const state = await store.load();
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const complaints = Object.values(state.complaints)
      .map((complaint) => enrichComplaint(complaint, asOf))
      .filter((complaint) => complaintMatchesFilters(complaint, url));
    sendJson(res, 200, {
      asOf: asOf.toISOString(),
      count: complaints.length,
      complaints
    });
    return;
  }

  if (method === "POST" && path === "/complaints") {
    const body = await readJson(req);
    const state = await store.load();
    const result = createComplaint(state.complaints, body, state);
    const nextState =
      result.summary.status === "blocked"
        ? state
        : appendEvent(
            {
              ...state,
              complaints: result.registry
            },
            {
              type: "complaint.received",
              complaintId: result.complaint.complaintId,
              category: result.complaint.category
            }
          );
    await store.save(nextState);
    sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
    return;
  }

  const complaintMatch = path.match(/^\/complaints\/([^/]+)$/);
  if (method === "GET" && complaintMatch) {
    const state = await store.load();
    const complaint = state.complaints[decodeURIComponent(complaintMatch[1])];
    if (!complaint) {
      sendJson(res, 404, { error: { code: "not_found", message: "Complaint not found." } });
      return;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, enrichComplaint(complaint, asOf));
    return;
  }

  const complaintActionMatch = path.match(/^\/complaints\/([^/]+)\/(assignments|reviews|resolution|rbi-cms-escalation)$/);
  if (method === "POST" && complaintActionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const complaintId = decodeURIComponent(complaintActionMatch[1]);
    const action = complaintActionMatch[2];
    const complaint = state.complaints[complaintId];
    if (!complaint) {
      sendJson(res, 404, { error: { code: "not_found", message: "Complaint not found." } });
      return;
    }

    const actorPath = action === "assignments" ? "assignedTo" : "actor";
    const actorId = action === "assignments" ? body.assignedTo : body.actor;
    const accessFindings = validateGrievanceOfficerAccess(state.staffActors, actorId, actorPath);
    const accessSummary = summarizeFindings(accessFindings);
    if (accessSummary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "complaint_access_blocked",
          message: "Complaint action is blocked by grievance-officer role policy."
        },
        findings: accessFindings
      });
      return;
    }

    const actionResult =
      action === "assignments"
        ? assignComplaint(complaint, body)
        : action === "reviews"
          ? startComplaintReview(complaint, body)
          : action === "resolution"
            ? resolveComplaint(complaint, body)
            : escalateComplaintToRbiCms(complaint, body);
    if (actionResult.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "complaint_action_blocked",
          message: "Complaint action is blocked by workflow findings."
        },
        findings: actionResult.findings
      });
      return;
    }

    const stored = actionResult.complaint;
    const nextState = appendEvent(
      {
        ...state,
        complaints: {
          ...state.complaints,
          [stored.complaintId]: stored
        }
      },
      {
        type: actionResult.event.type,
        complaintId: stored.complaintId,
        actor: body.actor ?? body.assignedTo ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, action === "assignments" ? 201 : 200, {
      complaint: stored,
      event: actionResult.event
    });
    return;
  }

  if (method === "POST" && path === "/staff/actors") {
    const body = await readJson(req);
    const state = await store.load();
    const result = upsertStaffActor(state.staffActors, body);
    const nextState =
      result.summary.status === "blocked"
        ? state
        : appendEvent(
            {
              ...state,
              staffActors: result.registry
            },
            {
              type: "staff_actor.upserted",
              actorId: result.actor.actorId,
              roles: result.actor.roles
            }
          );
    await store.save(nextState);
    sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
    return;
  }

  const staffActorMatch = path.match(/^\/staff\/actors\/([^/]+)$/);
  if (method === "GET" && staffActorMatch) {
    const state = await store.load();
    const actor = state.staffActors[decodeURIComponent(staffActorMatch[1])];
    if (!actor) {
      sendJson(res, 404, { error: { code: "not_found", message: "Staff actor not found." } });
      return;
    }
    sendJson(res, 200, actor);
    return;
  }

  if (method === "GET" && path === "/workflow/tasks") {
    const state = await store.load();
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const filters = taskFiltersFromUrl(url);
    const tasks = deriveWorkflowTasks(state, { asOf, filters });
    sendJson(res, 200, {
      asOf: asOf.toISOString(),
      count: tasks.length,
      tasks
    });
    return;
  }

  const workflowTaskMatch = path.match(/^\/workflow\/tasks\/([^/]+)$/);
  if (method === "GET" && workflowTaskMatch) {
    const state = await store.load();
    const taskId = decodeURIComponent(workflowTaskMatch[1]);
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const task = deriveWorkflowTasks(state, { asOf }).find((candidate) => candidate.taskId === taskId);
    if (!task) {
      sendJson(res, 404, { error: { code: "not_found", message: "Workflow task not found or no longer active." } });
      return;
    }
    sendJson(res, 200, task);
    return;
  }

  const workflowTaskActionMatch = path.match(/^\/workflow\/tasks\/([^/]+)\/(assignments|start|release|comments)$/);
  if (method === "POST" && workflowTaskActionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const taskId = decodeURIComponent(workflowTaskActionMatch[1]);
    const action = workflowTaskActionMatch[2];
    const asOf = body.asOf ? new Date(body.asOf) : new Date();
    const activeTasks = deriveWorkflowTasks(state, { asOf });
    const activeTask = activeTasks.find((task) => task.taskId === taskId) ?? null;
    const accessFindings =
      action === "assignments"
        ? validateWorkflowAssignmentAccess(state.staffActors, activeTask, body)
        : validateWorkflowActorAccess(state.staffActors, activeTask, body.actor, "actor");
    const accessSummary = summarizeFindings(accessFindings);
    if (accessSummary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "workflow_task_access_blocked",
          message: "Workflow task action is blocked by actor role or queue access."
        },
        findings: accessFindings
      });
      return;
    }
    const taskAction =
      action === "assignments"
        ? assignWorkflowTask
        : action === "start"
          ? startWorkflowTask
          : action === "release"
            ? releaseWorkflowTask
            : commentOnWorkflowTask;
    const result = taskAction(state.workflowTasks, taskId, body, activeTasks);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "workflow_task_blocked",
          message: "Workflow task action is blocked by control findings."
        },
        findings: result.findings
      });
      return;
    }

    const nextState = appendEvent(
      {
        ...state,
        workflowTasks: result.workflowTasks
      },
      {
        type: result.event.type,
        taskId,
        actor: body.actor ?? body.assignedBy ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, action === "assignments" ? 201 : 200, {
      task: result.task,
      event: result.event
    });
    return;
  }

  if (method === "GET" && path === "/regulated-entities") {
    const state = await store.load();
    sendJson(res, 200, {
      regulatedEntities: Object.values(state.regulatedEntities)
    });
    return;
  }

  if (method === "POST" && path === "/regulated-entities") {
    const body = await readJson(req);
    const state = await store.load();
    const result = upsertRegulatedEntity(state.regulatedEntities, body);
    const nextState =
      result.summary.status === "blocked"
        ? state
        : appendEvent(
            {
              ...state,
              regulatedEntities: result.registry
            },
            {
              type: "regulated_entity.upserted",
              regulatedEntityId: result.entity.regulatedEntityId,
              status: result.entity.status
            }
          );
    await store.save(nextState);
    sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
    return;
  }

  const regulatedEntityMatch = path.match(/^\/regulated-entities\/([^/]+)$/);
  if (method === "GET" && regulatedEntityMatch) {
    const state = await store.load();
    const entity = state.regulatedEntities[decodeURIComponent(regulatedEntityMatch[1])];
    if (!entity) {
      sendJson(res, 404, { error: { code: "not_found", message: "Regulated entity not found." } });
      return;
    }
    sendJson(res, 200, entity);
    return;
  }

  if (method === "GET" && path === "/lending-service-providers") {
    const state = await store.load();
    sendJson(res, 200, {
      lendingServiceProviders: Object.values(state.lendingServiceProviders)
    });
    return;
  }

  if (method === "POST" && path === "/lending-service-providers") {
    const body = await readJson(req);
    const state = await store.load();
    const result = upsertLendingServiceProvider(state.lendingServiceProviders, body, state.regulatedEntities);
    const nextState =
      result.summary.status === "blocked"
        ? state
        : appendEvent(
            {
              ...state,
              lendingServiceProviders: result.registry
            },
            {
              type: "lending_service_provider.upserted",
              lspId: result.lendingServiceProvider.lspId,
              regulatedEntityId: result.lendingServiceProvider.regulatedEntityId,
              status: result.lendingServiceProvider.status
            }
          );
    await store.save(nextState);
    sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
    return;
  }

  const lendingServiceProviderMatch = path.match(/^\/lending-service-providers\/([^/]+)$/);
  if (method === "GET" && lendingServiceProviderMatch) {
    const state = await store.load();
    const lsp = state.lendingServiceProviders[decodeURIComponent(lendingServiceProviderMatch[1])];
    if (!lsp) {
      sendJson(res, 404, { error: { code: "not_found", message: "Lending service provider not found." } });
      return;
    }
    sendJson(res, 200, lsp);
    return;
  }

  if (method === "GET" && path === "/digital-lending-apps") {
    const state = await store.load();
    sendJson(res, 200, {
      digitalLendingApps: Object.values(state.digitalLendingApps)
    });
    return;
  }

  if (method === "POST" && path === "/digital-lending-apps") {
    const body = await readJson(req);
    const state = await store.load();
    const result = upsertDigitalLendingApp(
      state.digitalLendingApps,
      body,
      state.regulatedEntities,
      state.lendingServiceProviders
    );
    const nextState =
      result.summary.status === "blocked"
        ? state
        : appendEvent(
            {
              ...state,
              digitalLendingApps: result.registry
            },
            {
              type: "digital_lending_app.upserted",
              digitalLendingAppId: result.digitalLendingApp.digitalLendingAppId,
              regulatedEntityId: result.digitalLendingApp.regulatedEntityId,
              status: result.digitalLendingApp.status
            }
          );
    await store.save(nextState);
    sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
    return;
  }

  const digitalLendingAppMatch = path.match(/^\/digital-lending-apps\/([^/]+)$/);
  if (method === "GET" && digitalLendingAppMatch) {
    const state = await store.load();
    const app = state.digitalLendingApps[decodeURIComponent(digitalLendingAppMatch[1])];
    if (!app) {
      sendJson(res, 404, { error: { code: "not_found", message: "Digital lending app not found." } });
      return;
    }
    sendJson(res, 200, app);
    return;
  }

  if (method === "GET" && path === "/reporting/dla/cims") {
    const state = await store.load();
    const result = generateDlaCimsExport(state.digitalLendingApps, state.regulatedEntities, {
      lendingServiceProviders: state.lendingServiceProviders,
      regulatedEntityId: url.searchParams.get("regulatedEntityId") ?? undefined,
      asOf: url.searchParams.get("asOf") ?? undefined
    });
    sendJson(res, result.summary.status === "blocked" ? 422 : 200, result);
    return;
  }

  if (method === "GET" && path === "/products") {
    const state = await store.load();
    sendJson(res, 200, {
      products: Object.values(state.productPolicies)
    });
    return;
  }

  if (method === "POST" && path === "/products") {
    const body = await readJson(req);
    const state = await store.load();
    const result = upsertProductPolicy(state.productPolicies, body, state.regulatedEntities);
    const nextState =
      result.summary.status === "blocked"
        ? state
        : appendEvent(
            {
              ...state,
              productPolicies: result.registry
            },
            {
              type: "product_policy.upserted",
              productId: result.product.productId,
              productCode: result.product.productCode,
              regulatedEntityId: result.product.regulatedEntityId
            }
          );
    await store.save(nextState);
    sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
    return;
  }

  const productMatch = path.match(/^\/products\/([^/]+)$/);
  if (method === "GET" && productMatch) {
    const state = await store.load();
    const product = state.productPolicies[decodeURIComponent(productMatch[1])];
    if (!product) {
      sendJson(res, 404, { error: { code: "not_found", message: "Product policy not found." } });
      return;
    }
    sendJson(res, 200, product);
    return;
  }

  if (method === "GET" && path === "/ai/models") {
    const state = await store.load();
    sendJson(res, 200, state.modelRegistry);
    return;
  }

  if (method === "POST" && path === "/ai/models") {
    const body = await readJson(req);
    const state = await store.load();
    const result = registerModel(state.modelRegistry, body);
    const nextState = {
      ...state,
      modelRegistry: result.registry
    };
    await store.save(nextState);
    sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
    return;
  }

  const modelTransitionMatch = path.match(/^\/ai\/models\/([^/]+)\/transitions$/);
  if (method === "POST" && modelTransitionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const modelId = decodeURIComponent(modelTransitionMatch[1]);
    const result = transitionModel(state.modelRegistry, { ...body, modelId });
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "model_transition_blocked", message: "Model lifecycle transition is blocked by governance findings." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      {
        ...state,
        modelRegistry: result.registry
      },
      {
        type: "api.ai.model.transitioned",
        modelId,
        action: body.action ?? null,
        actor: body.actor ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, result);
    return;
  }

  if (method === "POST" && path === "/ai/kill-switch") {
    const body = await readJson(req);
    const state = await store.load();
    const result = triggerKillSwitch(state.modelRegistry, body);
    const nextState = appendEvent(
      {
        ...state,
        modelRegistry: result.registry
      },
      {
        type: "api.ai.kill_switch.triggered",
        actor: body.actor ?? null,
        scope: body.scope ?? "global",
        modelId: body.modelId ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, result.summary.status === "blocked" ? 422 : 200, result);
    return;
  }

  const incidentReviewMatch = path.match(/^\/ai\/incidents\/([^/]+)\/post-incident-review$/);
  if (method === "POST" && incidentReviewMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const incidentId = decodeURIComponent(incidentReviewMatch[1]);
    const result = recordPostIncidentReview(state.modelRegistry, { ...body, incidentId });
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "post_incident_review_blocked", message: "Post-incident review is blocked by governance findings." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      {
        ...state,
        modelRegistry: result.registry
      },
      {
        type: "api.ai.incident.reviewed",
        incidentId,
        actor: body.reviewedBy ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, result);
    return;
  }

  if (method === "POST" && path === "/ai/kill-switch/clear") {
    const body = await readJson(req);
    const state = await store.load();
    const result = clearGlobalKillSwitch(state.modelRegistry, body);
    const nextState = appendEvent(
      {
        ...state,
        modelRegistry: result.registry
      },
      {
        type: "api.ai.kill_switch.cleared",
        actor: body.actor ?? null,
        approvalRef: body.approvalRef ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, result.summary.status === "blocked" ? 422 : 200, result);
    return;
  }

  if (method === "GET" && path === "/borrowers") {
    const state = await store.load();
    sendJson(res, 200, {
      borrowers: Object.values(state.borrowerProfiles)
    });
    return;
  }

  if (method === "POST" && path === "/borrowers") {
    const body = await readJson(req);
    const state = await store.load();
    const result = upsertBorrowerProfile(state.borrowerProfiles, body);
    const nextState =
      result.summary.status === "blocked"
        ? state
        : appendEvent(
            {
              ...state,
              borrowerProfiles: result.registry
            },
            {
              type: "borrower_profile.upserted",
              borrowerId: result.borrower.borrowerId,
              status: result.borrower.status
            }
          );
    await store.save(nextState);
    sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
    return;
  }

  const borrowerMatch = path.match(/^\/borrowers\/([^/]+)$/);
  if (method === "GET" && borrowerMatch) {
    const state = await store.load();
    const borrower = state.borrowerProfiles[decodeURIComponent(borrowerMatch[1])];
    if (!borrower) {
      sendJson(res, 404, { error: { code: "not_found", message: "Borrower not found." } });
      return;
    }
    sendJson(res, 200, borrower);
    return;
  }

  const borrowerConsentsMatch = path.match(/^\/borrowers\/([^/]+)\/consents$/);
  if (borrowerConsentsMatch) {
    const borrowerId = decodeURIComponent(borrowerConsentsMatch[1]);
    const state = await store.load();
    if (!state.borrowerProfiles[borrowerId]) {
      sendJson(res, 404, { error: { code: "not_found", message: "Borrower not found." } });
      return;
    }

    if (method === "GET") {
      sendJson(res, 200, {
        consents: listBorrowerConsents(state.consentRecords, borrowerId)
      });
      return;
    }

    if (method === "POST") {
      const body = await readJson(req);
      const result = upsertConsentRecord(
        state.consentRecords,
        {
          ...body,
          borrowerId
        },
        state.borrowerProfiles
      );
      const nextState =
        result.summary.status === "blocked"
          ? state
          : appendEvent(
              {
                ...state,
                consentRecords: result.registry
              },
              {
                type: "borrower_consent.upserted",
                borrowerId,
                consentId: result.consent.consentId,
                purpose: result.consent.purpose,
                status: result.consent.status
              }
            );
      await store.save(nextState);
      sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
      return;
    }
  }

  const borrowerKycMatch = path.match(/^\/borrowers\/([^/]+)\/kyc-records$/);
  if (borrowerKycMatch) {
    const borrowerId = decodeURIComponent(borrowerKycMatch[1]);
    const state = await store.load();
    if (!state.borrowerProfiles[borrowerId]) {
      sendJson(res, 404, { error: { code: "not_found", message: "Borrower not found." } });
      return;
    }

    if (method === "GET") {
      sendJson(res, 200, {
        kycRecords: listBorrowerKycRecords(state.kycRecords, borrowerId)
      });
      return;
    }

    if (method === "POST") {
      const body = await readJson(req);
      const result = upsertKycRecord(
        state.kycRecords,
        {
          ...body,
          borrowerId
        },
        state.borrowerProfiles
      );
      const nextState =
        result.summary.status === "blocked"
          ? state
          : appendEvent(
              {
                ...state,
                kycRecords: result.registry
              },
              {
                type: "borrower_kyc.upserted",
                borrowerId,
                kycRecordId: result.kycRecord.kycRecordId,
                status: result.kycRecord.status
              }
            );
      await store.save(nextState);
      sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
      return;
    }
  }

  if (method === "POST" && path === "/loans/applications") {
    const body = await readJson(req);
    const state = await store.load();
    const application = {
      ...body,
      applicationId: body.applicationId ?? createLoanId("app"),
      status: "application_received",
      createdAt: new Date().toISOString()
    };
    const borrowerResolution = resolveBorrowerApplicationReferences(application, {
      borrowerProfiles: state.borrowerProfiles,
      consentRecords: state.consentRecords,
      kycRecords: state.kycRecords
    });
    const resolution = resolveLoanApplicationReferences(borrowerResolution.application, {
      regulatedEntities: state.regulatedEntities,
      productPolicies: state.productPolicies
    });
    const evaluation = evaluateLoanApplication(resolution.application, {
      modelRegistry: state.modelRegistry
    });
    const combined = combineComplianceResults(borrowerResolution, resolution, evaluation);
    const stored = initializeApplicationWorkflow({
      ...resolution.application,
      compliance: combined
    }, combined);
    const nextState = appendEvent(
      {
        ...state,
        loanApplications: {
          ...state.loanApplications,
          [stored.applicationId]: stored
        }
      },
      {
        type: "loan.application.created",
        applicationId: stored.applicationId,
        status: stored.status
      }
    );
    await store.save(nextState);
    sendJson(res, combined.summary.status === "blocked" ? 422 : 201, stored);
    return;
  }

  const applicationMatch = path.match(/^\/loans\/applications\/([^/]+)$/);
  if (method === "GET" && applicationMatch) {
    const state = await store.load();
    const application = state.loanApplications[applicationMatch[1]];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
      return;
    }
    sendJson(res, 200, application);
    return;
  }

  const eligibilityMatch = path.match(/^\/loans\/applications\/([^/]+)\/eligibility$/);
  if (method === "GET" && eligibilityMatch) {
    const state = await store.load();
    const application = state.loanApplications[eligibilityMatch[1]];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
      return;
    }
    sendJson(res, 200, application.eligibility ?? null);
    return;
  }
  if (method === "POST" && eligibilityMatch) {
    const state = await store.load();
    const application = state.loanApplications[eligibilityMatch[1]];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
      return;
    }
    const eligibility = evaluateEligibility(application);
    const stored = {
      ...application,
      eligibility: eligibility.assessment
    };
    const nextState = appendEvent(
      {
        ...state,
        loanApplications: {
          ...state.loanApplications,
          [stored.applicationId]: stored
        }
      },
      {
        type: "loan.eligibility.assessed",
        applicationId: stored.applicationId,
        decision: eligibility.assessment.decision
      }
    );
    await store.save(nextState);
    sendJson(res, 200, eligibility);
    return;
  }

  const kfsMatch = path.match(/^\/loans\/applications\/([^/]+)\/kfs$/);
  if (method === "POST" && kfsMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = state.loanApplications[kfsMatch[1]];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
      return;
    }
    const kfs = buildKeyFactStatement(application, body.terms ?? body);
    const updated = attachKfs(application, kfs, body.acceptance ?? {});
    const evaluation = evaluateLoanApplication(updated, {
      modelRegistry: state.modelRegistry
    });
    const eligibility = evaluateEligibility(updated);
    const withCompliance = {
      ...updated,
      compliance: evaluation,
      eligibility: eligibility.assessment
    };
    const stored = applyKfsWorkflow(withCompliance, evaluation);
    const nextState = appendEvent(
      {
        ...state,
        loanApplications: {
          ...state.loanApplications,
          [stored.applicationId]: stored
        }
      },
      {
        type: "loan.kfs.generated",
        applicationId: stored.applicationId,
        kfsId: kfs.kfsId
      }
    );
    await store.save(nextState);
    sendJson(res, evaluation.summary.status === "blocked" ? 422 : 201, stored);
    return;
  }

  const decisionMatch = path.match(/^\/loans\/applications\/([^/]+)\/decision$/);
  if (method === "POST" && decisionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = state.loanApplications[decisionMatch[1]];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
      return;
    }

    const eligibility = evaluateEligibility({
      ...application,
      aiDecision: body.aiDecision ?? application.aiDecision
    });
    const decisionApplication = {
      ...application,
      aiDecision: body.aiDecision ?? application.aiDecision,
      eligibility: eligibility.assessment
    };
    const preDecision = evaluateLoanApplication(decisionApplication, {
      modelRegistry: state.modelRegistry
    });
    // A refer-band approval carries a manual underwriting override; the named
    // underwriter must be a registered, active credit officer. Presence and
    // shape of the override are enforced separately by proposeDecision.
    const requiresUnderwriterAccessCheck =
      eligibility.assessment.decision === "refer" &&
      body.status === "approved" &&
      Boolean(body.manualUnderwriting?.underwriterId);
    const accessFindings = [
      ...validateDecisionProposalAccess(state.staffActors, body),
      ...(requiresUnderwriterAccessCheck ? validateManualUnderwritingAccess(state.staffActors, body) : [])
    ];
    const accessSummary = summarizeFindings(accessFindings);
    if (accessSummary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "decision_access_blocked",
          message: "Decision proposal is blocked by actor role policy."
        },
        findings: accessFindings
      });
      return;
    }
    const kfsCheck = validateKfsBeforeDecision(application);
    // An ineligible borrower cannot be approved; declines still proceed with the
    // assessment stored as evidence.
    const eligibilityFindings = body.status === "approved" ? eligibility.findings : [];
    const findings = [...preDecision.findings, ...kfsCheck.findings, ...eligibilityFindings];
    const proposal = proposeDecision(decisionApplication, body, findings);
    if (proposal.summary.status === "blocked" && !proposal.requiresHumanReview) {
      sendJson(res, 422, {
        error: {
          code: "decision_blocked",
          message: "Decision is blocked by compliance findings."
        },
        findings: proposal.findings
      });
      return;
    }

    const stored = proposal.application;
    const nextState = appendEvent(
      {
        ...state,
        loanApplications: {
          ...state.loanApplications,
          [stored.applicationId]: stored
        }
      },
      {
        type: proposal.requiresHumanReview ? "loan.human_review.required" : "loan.decision.proposed",
        applicationId: stored.applicationId,
        status: stored.status,
        proposalId: proposal.proposal?.proposalId ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 202, stored);
    return;
  }

  const humanReviewMatch = path.match(/^\/loans\/applications\/([^/]+)\/human-reviews$/);
  if (method === "POST" && humanReviewMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = state.loanApplications[humanReviewMatch[1]];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
      return;
    }

    const accessFindings = validateHumanReviewAccess(state.staffActors, body);
    const accessSummary = summarizeFindings(accessFindings);
    if (accessSummary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "human_review_access_blocked",
          message: "Human review is blocked by actor role policy."
        },
        findings: accessFindings
      });
      return;
    }

    const result = recordHumanReview(application, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "human_review_blocked",
          message: "Human review could not be recorded."
        },
        findings: result.findings
      });
      return;
    }

    const stored = result.application;
    const nextState = appendEvent(
      {
        ...state,
        loanApplications: {
          ...state.loanApplications,
          [stored.applicationId]: stored
        }
      },
      {
        type: "loan.human_review.recorded",
        applicationId: stored.applicationId,
        reviewId: result.humanReview.reviewId,
        outcome: result.humanReview.outcome
      }
    );
    await store.save(nextState);
    sendJson(res, 200, stored);
    return;
  }

  const approvalMatch = path.match(/^\/loans\/applications\/([^/]+)\/approvals$/);
  if (method === "POST" && approvalMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = state.loanApplications[approvalMatch[1]];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
      return;
    }

    const accessFindings = validateDecisionApprovalAccess(state.staffActors, body);
    const accessSummary = summarizeFindings(accessFindings);
    if (accessSummary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "approval_access_blocked",
          message: "Decision approval is blocked by actor role policy."
        },
        findings: accessFindings
      });
      return;
    }

    const result = applyDecisionApproval(application, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "approval_blocked",
          message: "Decision approval is blocked by workflow findings."
        },
        findings: result.findings
      });
      return;
    }

    const stored = result.application;
    const nextState = appendEvent(
      {
        ...state,
        loanApplications: {
          ...state.loanApplications,
          [stored.applicationId]: stored
        }
      },
      {
        type: "loan.decision.approval_recorded",
        applicationId: stored.applicationId,
        approvalId: result.approval.approvalId,
        status: stored.status
      }
    );
    await store.save(nextState);
    sendJson(res, 200, stored);
    return;
  }

  const documentPacketMatch = path.match(/^\/loans\/applications\/([^/]+)\/document-packet$/);
  if (documentPacketMatch) {
    const applicationId = decodeURIComponent(documentPacketMatch[1]);
    const state = await store.load();
    const application = state.loanApplications[applicationId];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
      return;
    }

    if (method === "GET") {
      if (!application.documentPacket) {
        sendJson(res, 404, { error: { code: "not_found", message: "Document packet not found." } });
        return;
      }
      sendJson(res, 200, application.documentPacket);
      return;
    }

    if (method === "POST") {
      const body = await readJson(req);
      const actorId = body.actor ?? body.generatedBy;
      const accessFindings = validateDocumentPacketAccess(state.staffActors, actorId, "actor");
      const accessSummary = summarizeFindings(accessFindings);
      if (accessSummary.status === "blocked") {
        sendJson(res, 422, {
          error: {
            code: "document_packet_access_blocked",
            message: "Document packet generation is blocked by actor role policy."
          },
          findings: accessFindings
        });
        return;
      }

      const packetResult = generateDocumentPacket(application, body);
      if (packetResult.summary.status === "blocked") {
        sendJson(res, 422, {
          error: {
            code: "document_packet_blocked",
            message: "Document packet generation is blocked by workflow findings."
          },
          findings: packetResult.findings
        });
        return;
      }

      const stored = recordDocumentPacketGenerated(application, packetResult.packet);
      const nextState = appendEvent(
        {
          ...state,
          loanApplications: {
            ...state.loanApplications,
            [stored.applicationId]: stored
          }
        },
        {
          type: "loan.document_packet.generated",
          applicationId: stored.applicationId,
          packetId: packetResult.packet.packetId
        }
      );
      await store.save(nextState);
      sendJson(res, 201, stored.documentPacket);
      return;
    }
  }

  const documentPacketDeliveryMatch = path.match(/^\/loans\/applications\/([^/]+)\/document-packet\/delivery$/);
  if (method === "POST" && documentPacketDeliveryMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = state.loanApplications[decodeURIComponent(documentPacketDeliveryMatch[1])];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
      return;
    }

    const actorId = body.actor ?? body.deliveredBy;
    const accessFindings = validateDocumentPacketAccess(state.staffActors, actorId, "actor");
    const accessSummary = summarizeFindings(accessFindings);
    if (accessSummary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "document_packet_access_blocked",
          message: "Document packet delivery is blocked by actor role policy."
        },
        findings: accessFindings
      });
      return;
    }

    const deliveryResult = recordDocumentPacketDelivery(application, body);
    if (deliveryResult.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "document_packet_delivery_blocked",
          message: "Document packet delivery is blocked by workflow findings."
        },
        findings: deliveryResult.findings
      });
      return;
    }

    const stored = recordDocumentPacketDelivered(application, deliveryResult.packet);
    const nextState = appendEvent(
      {
        ...state,
        loanApplications: {
          ...state.loanApplications,
          [stored.applicationId]: stored
        }
      },
      {
        type: "loan.document_packet.delivered",
        applicationId: stored.applicationId,
        packetId: deliveryResult.packet.packetId,
        deliveryRef: deliveryResult.packet.delivery.deliveryRef
      }
    );
    await store.save(nextState);
    sendJson(res, 200, stored.documentPacket);
    return;
  }

  if (method === "GET" && path === "/loan-accounts") {
    const state = await store.load();
    sendJson(res, 200, {
      loanAccounts: Object.values(state.loanAccounts)
    });
    return;
  }

  if (method === "GET" && path === "/reporting/cic/snapshots") {
    const state = await store.load();
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, {
      asOf: asOf.toISOString(),
      snapshots: Object.values(state.loanAccounts).map((loanAccount) => generateCicSnapshot(loanAccount, asOf))
    });
    return;
  }

  const loanAccountScheduleMatch = path.match(/^\/loan-accounts\/([^/]+)\/schedule$/);
  if (method === "GET" && loanAccountScheduleMatch) {
    const state = await store.load();
    const loanAccount = state.loanAccounts[decodeURIComponent(loanAccountScheduleMatch[1])];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }
    sendJson(res, 200, {
      loanAccountId: loanAccount.loanAccountId,
      schedule: loanAccount.schedule
    });
    return;
  }

  const loanAccountStatementMatch = path.match(/^\/loan-accounts\/([^/]+)\/statement$/);
  if (method === "GET" && loanAccountStatementMatch) {
    const state = await store.load();
    const loanAccount = state.loanAccounts[decodeURIComponent(loanAccountStatementMatch[1])];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }
    sendJson(res, 200, generateLoanStatement(loanAccount, {
      periodStart: url.searchParams.get("from"),
      periodEnd: url.searchParams.get("to")
    }));
    return;
  }

  const loanAccountStatementDocumentMatch = path.match(/^\/loan-accounts\/([^/]+)\/statement\/document$/);
  if (method === "GET" && loanAccountStatementDocumentMatch) {
    const state = await store.load();
    const loanAccount = state.loanAccounts[decodeURIComponent(loanAccountStatementDocumentMatch[1])];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }
    const result = renderLoanStatementDocument(loanAccount, {
      periodStart: url.searchParams.get("from"),
      periodEnd: url.searchParams.get("to")
    });
    sendJson(res, 200, {
      document: result.document,
      statement: result.statement
    });
    return;
  }

  const loanAccountDelinquencyMatch = path.match(/^\/loan-accounts\/([^/]+)\/delinquency$/);
  if (method === "GET" && loanAccountDelinquencyMatch) {
    const state = await store.load();
    const loanAccount = state.loanAccounts[decodeURIComponent(loanAccountDelinquencyMatch[1])];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, computeDelinquency(loanAccount, asOf));
    return;
  }

  const loanAccountAssetClassMatch = path.match(/^\/loan-accounts\/([^/]+)\/asset-classification$/);
  if (method === "GET" && loanAccountAssetClassMatch) {
    const state = await store.load();
    const loanAccount = state.loanAccounts[decodeURIComponent(loanAccountAssetClassMatch[1])];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, classifyLoanAsset(loanAccount, asOf));
    return;
  }

  const loanAccountCicSnapshotMatch = path.match(/^\/loan-accounts\/([^/]+)\/cic-snapshot$/);
  if (method === "GET" && loanAccountCicSnapshotMatch) {
    const state = await store.load();
    const loanAccount = state.loanAccounts[decodeURIComponent(loanAccountCicSnapshotMatch[1])];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, generateCicSnapshot(loanAccount, asOf));
    return;
  }

  const loanAccountRecoveryAssignmentMatch = path.match(/^\/loan-accounts\/([^/]+)\/recovery-assignments$/);
  if (method === "POST" && loanAccountRecoveryAssignmentMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountRecoveryAssignmentMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }

    const accessFindings = validateRecoveryAssignmentAccess(state.staffActors, body);
    const accessSummary = summarizeFindings(accessFindings);
    if (accessSummary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "recovery_assignment_access_blocked",
          message: "Recovery assignment is blocked by actor role policy."
        },
        findings: accessFindings
      });
      return;
    }

    const result = assignRecoveryAgent(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "recovery_assignment_blocked",
          message: "Recovery assignment is blocked by servicing findings."
        },
        findings: result.findings
      });
      return;
    }

    const stored = result.loanAccount;
    const nextState = appendEvent(
      {
        ...state,
        loanAccounts: {
          ...state.loanAccounts,
          [stored.loanAccountId]: stored
        }
      },
      {
        type: "loan_account.recovery_agent.assigned",
        loanAccountId: stored.loanAccountId,
        assignmentId: result.assignment.assignmentId,
        recoveryAgentId: result.assignment.recoveryAgentId
      }
    );
    await store.save(nextState);
    sendJson(res, 201, {
      loanAccount: stored,
      assignment: result.assignment,
      delinquency: result.delinquency
    });
    return;
  }

  const loanAccountCashRecoveryMatch = path.match(/^\/loan-accounts\/([^/]+)\/cash-recoveries$/);
  if (method === "POST" && loanAccountCashRecoveryMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountCashRecoveryMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }

    const result = postCashRecoveryToLoanAccount(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "cash_recovery_blocked",
          message: "Cash recovery posting is blocked by servicing findings."
        },
        findings: result.findings
      });
      return;
    }

    const stored = result.loanAccount;
    const nextState = appendEvent(
      {
        ...state,
        loanAccounts: {
          ...state.loanAccounts,
          [stored.loanAccountId]: stored
        }
      },
      {
        type: "loan_account.cash_recovery.posted",
        loanAccountId: stored.loanAccountId,
        eventId: result.paymentEvent.eventId,
        recoveryAgentId: result.paymentEvent.recoveryAgentId,
        receiptRef: result.paymentEvent.receiptRef
      }
    );
    await store.save(nextState);
    sendJson(res, 200, {
      loanAccount: stored,
      paymentEvent: result.paymentEvent,
      delinquency: result.delinquency,
      summary: summarizeLoanAccount(stored, new Date(result.paymentEvent.eventDate))
    });
    return;
  }

  const loanAccountChargeMatch = path.match(/^\/loan-accounts\/([^/]+)\/charges$/);
  if (method === "POST" && loanAccountChargeMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountChargeMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }

    const result = assessChargeToLoanAccount(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "charge_blocked",
          message: "Charge assessment is blocked by LMS findings."
        },
        findings: result.findings
      });
      return;
    }

    const stored = result.loanAccount;
    const nextState = appendEvent(
      {
        ...state,
        loanAccounts: {
          ...state.loanAccounts,
          [stored.loanAccountId]: stored
        }
      },
      {
        type: "loan_account.charge.assessed",
        loanAccountId: stored.loanAccountId,
        eventId: result.chargeEvent.eventId,
        amount: result.chargeEvent.amount
      }
    );
    await store.save(nextState);
    sendJson(res, 201, {
      loanAccount: stored,
      chargeEvent: result.chargeEvent,
      summary: summarizeLoanAccount(stored)
    });
    return;
  }

  const loanAccountWaiverMatch = path.match(/^\/loan-accounts\/([^/]+)\/waivers$/);
  if (method === "POST" && loanAccountWaiverMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountWaiverMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }

    const result = waiveLoanAccountCharge(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "waiver_blocked",
          message: "Waiver posting is blocked by LMS findings."
        },
        findings: result.findings
      });
      return;
    }

    const stored = result.loanAccount;
    const nextState = appendEvent(
      {
        ...state,
        loanAccounts: {
          ...state.loanAccounts,
          [stored.loanAccountId]: stored
        }
      },
      {
        type: "loan_account.charge.waived",
        loanAccountId: stored.loanAccountId,
        eventId: result.waiverEvent.eventId,
        amount: result.waiverEvent.amount
      }
    );
    await store.save(nextState);
    sendJson(res, 200, {
      loanAccount: stored,
      waiverEvent: result.waiverEvent,
      summary: summarizeLoanAccount(stored)
    });
    return;
  }

  const loanAccountReversalMatch = path.match(/^\/loan-accounts\/([^/]+)\/reversals$/);
  if (method === "POST" && loanAccountReversalMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountReversalMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }

    const result = reverseLoanAccountEvent(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "reversal_blocked",
          message: "Ledger reversal is blocked by LMS findings."
        },
        findings: result.findings
      });
      return;
    }

    const stored = result.loanAccount;
    const nextState = appendEvent(
      {
        ...state,
        loanAccounts: {
          ...state.loanAccounts,
          [stored.loanAccountId]: stored
        }
      },
      {
        type: "loan_account.ledger.reversed",
        loanAccountId: stored.loanAccountId,
        eventId: result.reversalEvent.eventId,
        reversalOfEventId: result.reversalEvent.reversalOfEventId
      }
    );
    await store.save(nextState);
    sendJson(res, 200, {
      loanAccount: stored,
      reversalEvent: result.reversalEvent,
      summary: summarizeLoanAccount(stored)
    });
    return;
  }

  const loanAccountPaymentMatch = path.match(/^\/loan-accounts\/([^/]+)\/payments$/);
  if (method === "POST" && loanAccountPaymentMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountPaymentMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }

    const result = postPaymentToLoanAccount(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "payment_blocked",
          message: "Payment posting is blocked by LMS findings."
        },
        findings: result.findings
      });
      return;
    }

    const stored = result.loanAccount;
    const nextState = appendEvent(
      {
        ...state,
        loanAccounts: {
          ...state.loanAccounts,
          [stored.loanAccountId]: stored
        }
      },
      {
        type: "loan_account.payment.posted",
        loanAccountId: stored.loanAccountId,
        eventId: result.paymentEvent.eventId,
        paymentRef: result.paymentEvent.paymentRef,
        amount: result.paymentEvent.amount
      }
    );
    await store.save(nextState);
    sendJson(res, 200, {
      loanAccount: stored,
      paymentEvent: result.paymentEvent,
      summary: summarizeLoanAccount(stored, new Date(result.paymentEvent.eventDate))
    });
    return;
  }

  const loanAccountAccrualMatch = path.match(/^\/loan-accounts\/([^/]+)\/accruals$/);
  if (method === "POST" && loanAccountAccrualMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountAccrualMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }

    const result = accrueInterest(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "accrual_blocked",
          message: "Interest accrual is blocked by LMS findings."
        },
        findings: result.findings
      });
      return;
    }

    const stored = result.loanAccount;
    const nextState = appendEvent(
      {
        ...state,
        loanAccounts: {
          ...state.loanAccounts,
          [stored.loanAccountId]: stored
        }
      },
      {
        type: "loan_account.interest.accrued",
        loanAccountId: stored.loanAccountId,
        accruedCount: result.accrualEvents.length
      }
    );
    await store.save(nextState);
    sendJson(res, 200, {
      loanAccount: stored,
      accrualEvents: result.accrualEvents,
      summary: summarizeLoanAccount(stored, body.asOf ? new Date(body.asOf) : new Date())
    });
    return;
  }

  const loanAccountPrepaymentMatch = path.match(/^\/loan-accounts\/([^/]+)\/prepayments$/);
  if (method === "POST" && loanAccountPrepaymentMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountPrepaymentMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }

    const result = prepayLoanAccount(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "prepayment_blocked", message: "Part-prepayment is blocked by LMS findings." },
        findings: result.findings
      });
      return;
    }

    const stored = result.loanAccount;
    const nextState = appendEvent(
      {
        ...state,
        loanAccounts: {
          ...state.loanAccounts,
          [stored.loanAccountId]: stored
        }
      },
      {
        type: "loan_account.part_prepaid",
        loanAccountId: stored.loanAccountId,
        prepaymentId: result.prepayment.prepaymentId,
        mode: result.prepayment.mode,
        principalReduced: result.prepayment.principalReduced
      }
    );
    await store.save(nextState);
    sendJson(res, 200, {
      loanAccount: stored,
      paymentEvent: result.paymentEvent,
      prepayment: result.prepayment,
      schedule: result.schedule,
      summary: summarizeLoanAccount(stored, new Date(result.paymentEvent.eventDate))
    });
    return;
  }

  const foreclosureQuoteMatch = path.match(/^\/loan-accounts\/([^/]+)\/foreclosure-quote$/);
  if (method === "GET" && foreclosureQuoteMatch) {
    const state = await store.load();
    const loanAccount = state.loanAccounts[decodeURIComponent(foreclosureQuoteMatch[1])];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }
    const result = quoteForeclosure(loanAccount, {
      asOf: url.searchParams.get("asOf") ?? undefined,
      foreclosureChargeName: url.searchParams.get("foreclosureChargeName") ?? undefined
    });
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "foreclosure_quote_blocked", message: "Foreclosure quote is blocked by LMS findings." },
        findings: result.findings
      });
      return;
    }
    sendJson(res, 200, result.quote);
    return;
  }

  const foreclosureMatch = path.match(/^\/loan-accounts\/([^/]+)\/foreclosure$/);
  if (method === "POST" && foreclosureMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(foreclosureMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }

    const result = forecloseLoanAccount(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "foreclosure_blocked", message: "Foreclosure is blocked by LMS findings." },
        findings: result.findings
      });
      return;
    }

    const stored = result.loanAccount;
    const nextState = appendEvent(
      {
        ...state,
        loanAccounts: {
          ...state.loanAccounts,
          [stored.loanAccountId]: stored
        }
      },
      {
        type: "loan_account.foreclosed",
        loanAccountId: stored.loanAccountId,
        foreclosureId: result.foreclosure.foreclosureId,
        payoffAmount: result.foreclosure.payoffAmount
      }
    );
    await store.save(nextState);
    sendJson(res, 200, {
      loanAccount: stored,
      foreclosure: result.foreclosure,
      quote: result.quote,
      summary: summarizeLoanAccount(stored, new Date(result.foreclosure.foreclosedAt))
    });
    return;
  }

  const closureCertificateMatch = path.match(/^\/loan-accounts\/([^/]+)\/closure-certificate$/);
  if (method === "POST" && closureCertificateMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(closureCertificateMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }

    const result = generateClosureCertificate(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "closure_certificate_blocked", message: "Closure certificate is blocked by LMS findings." },
        findings: result.findings
      });
      return;
    }

    const stored = result.loanAccount;
    if (!result.reissued) {
      const nextState = appendEvent(
        {
          ...state,
          loanAccounts: {
            ...state.loanAccounts,
            [stored.loanAccountId]: stored
          }
        },
        {
          type: "loan_account.closure_certificate.issued",
          loanAccountId: stored.loanAccountId,
          certificateId: result.closureCertificate.certificateId
        }
      );
      await store.save(nextState);
    }
    sendJson(res, result.reissued ? 200 : 201, {
      loanAccount: stored,
      closureCertificate: result.closureCertificate,
      reissued: result.reissued
    });
    return;
  }

  if (method === "GET" && closureCertificateMatch) {
    const state = await store.load();
    const loanAccount = state.loanAccounts[decodeURIComponent(closureCertificateMatch[1])];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }
    if (!loanAccount.closureCertificate) {
      sendJson(res, 404, { error: { code: "not_found", message: "No closure certificate has been issued." } });
      return;
    }
    sendJson(res, 200, loanAccount.closureCertificate);
    return;
  }

  const loanAccountMatch = path.match(/^\/loan-accounts\/([^/]+)$/);
  if (method === "GET" && loanAccountMatch) {
    const state = await store.load();
    const loanAccount = state.loanAccounts[decodeURIComponent(loanAccountMatch[1])];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }
    sendJson(res, 200, {
      ...loanAccount,
      summary: summarizeLoanAccount(loanAccount)
    });
    return;
  }

  const disbursementMatch = path.match(/^\/loans\/applications\/([^/]+)\/disbursement$/);
  if (method === "POST" && disbursementMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = state.loanApplications[disbursementMatch[1]];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
      return;
    }

    const result = validateDisbursement(application, body);
    const documentPacketCheck = validateDocumentPacketBeforeDisbursement(application);
    const findings = [...result.findings, ...documentPacketCheck.findings];
    const summary = summarizeFindings(findings);
    if (summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "disbursement_blocked",
          message: "Disbursement is blocked by compliance findings."
        },
        findings
      });
      return;
    }

    const disbursement = {
      ...body,
      disbursedAt: new Date().toISOString(),
      disbursementId: body.disbursementId ?? createLoanId("disb")
    };
    const disbursedApplication = markDisbursed(application, disbursement);
    const accountResult = createLoanAccountFromApplication(disbursedApplication, disbursement);
    if (accountResult.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "loan_account_blocked",
          message: "Loan account could not be opened after disbursement."
        },
        findings: accountResult.findings
      });
      return;
    }

    const stored = {
      ...disbursedApplication,
      loanAccountId: accountResult.loanAccount.loanAccountId
    };
    const nextState = appendEvent(
      {
        ...state,
        loanApplications: {
          ...state.loanApplications,
          [stored.applicationId]: stored
        },
        loanAccounts: {
          ...state.loanAccounts,
          [accountResult.loanAccount.loanAccountId]: accountResult.loanAccount
        }
      },
      {
        type: "loan.disbursement.recorded",
        applicationId: stored.applicationId,
        disbursementId: disbursement.disbursementId,
        loanAccountId: accountResult.loanAccount.loanAccountId
      }
    );
    await store.save(nextState);
    sendJson(res, 200, stored);
    return;
  }

  sendJson(res, 404, {
    error: {
      code: "not_found",
      message: "Route not found."
    }
  });
}

function tenantApiKeyFromRequest(req) {
  const headerKey = req.headers["x-api-key"];
  if (headerKey) {
    return Array.isArray(headerKey) ? headerKey[0] : headerKey;
  }
  const authorization = req.headers["authorization"];
  if (typeof authorization === "string" && authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return null;
}

function platformAdminKeyFromRequest(req) {
  const key = req.headers["x-platform-admin-key"];
  return Array.isArray(key) ? key[0] : key ?? null;
}

async function routePlatform(req, res, { dataDir, platformAdminKey, method, path }) {
  if (!platformAdminKey) {
    sendJson(res, 403, {
      error: {
        code: "platform_admin_disabled",
        message: "No platform admin key is configured; tenant administration is disabled."
      }
    });
    return;
  }
  if (platformAdminKeyFromRequest(req) !== platformAdminKey) {
    sendJson(res, 403, {
      error: {
        code: "platform_admin_forbidden",
        message: "A valid platform admin key is required for tenant administration."
      }
    });
    return;
  }

  // Sub-processor register administration (platform admin only). The register is
  // control-plane state; tenants read it through GET /sub-processors.
  if (method === "GET" && path === "/platform/sub-processors") {
    const state = await loadWholeState(dataDir);
    sendJson(res, 200, { subProcessors: listSubProcessors(state) });
    return;
  }

  if (method === "POST" && path === "/platform/sub-processors") {
    const body = await readJson(req);
    const findings = validateSubProcessor(body);
    if (findings.length > 0) {
      sendJson(res, 422, {
        error: { code: "sub_processor_invalid", message: "Sub-processor registration is invalid." },
        findings
      });
      return;
    }
    const state = await loadWholeState(dataDir);
    const nextState = registerSubProcessor(state, body);
    await saveWholeState(nextState, dataDir);
    sendJson(res, 201, {
      subProcessor: publicSubProcessor(nextState.controlPlane.subProcessors[body.subProcessorId])
    });
    return;
  }

  if (method === "GET" && path === "/platform/tenants") {
    const state = await loadWholeState(dataDir);
    sendJson(res, 200, { tenants: listTenants(state) });
    return;
  }

  if (method === "POST" && path === "/platform/tenants") {
    const body = await readJson(req);
    if (!body.tenantId) {
      sendJson(res, 422, {
        error: { code: "tenant_invalid", message: "tenantId is required to create a tenant." }
      });
      return;
    }
    const state = await loadWholeState(dataDir);
    if (state.controlPlane.tenants[body.tenantId]) {
      sendJson(res, 409, {
        error: { code: "tenant_exists", message: "A tenant with this tenantId already exists." }
      });
      return;
    }
    // The api key is returned once here and only ever stored as a hash.
    const apiKey = body.apiKey ?? generateApiKey();
    const nextState = registerTenant(state, {
      tenantId: body.tenantId,
      name: body.name,
      apiKey,
      isolationTier: body.isolationTier,
      status: body.status
    });
    await saveWholeState(nextState, dataDir);
    sendJson(res, 201, {
      tenant: publicTenant(nextState.controlPlane.tenants[body.tenantId]),
      apiKey
    });
    return;
  }

  // Portability export: a full, reproducible pack of a tenant's source-of-truth
  // records plus its audit evidence pack. Given to an exiting regulated entity.
  const tenantExportMatch = path.match(/^\/platform\/tenants\/([^/]+)\/export$/);
  if (method === "GET" && tenantExportMatch) {
    const state = await loadWholeState(dataDir);
    const tenantId = decodeURIComponent(tenantExportMatch[1]);
    const exportPack = buildTenantExport(state, tenantId);
    if (!exportPack) {
      sendJson(res, 404, {
        error: { code: "not_found", message: "Tenant not found or already offboarded." }
      });
      return;
    }
    sendJson(res, 200, exportPack);
    return;
  }

  // Evidenced deletion: purge the data plane, retain a deletion attestation, and
  // revoke access. Requires an actor and reason for the audit trail.
  const tenantOffboardMatch = path.match(/^\/platform\/tenants\/([^/]+)\/offboarding$/);
  if (method === "POST" && tenantOffboardMatch) {
    const body = await readJson(req);
    if (!body.actor || !body.reason) {
      sendJson(res, 422, {
        error: {
          code: "offboarding_invalid",
          message: "Offboarding requires an actor and a reason."
        }
      });
      return;
    }
    const state = await loadWholeState(dataDir);
    const tenantId = decodeURIComponent(tenantOffboardMatch[1]);
    const existing = state.controlPlane.tenants[tenantId];
    if (!existing) {
      sendJson(res, 404, { error: { code: "not_found", message: "Tenant not found." } });
      return;
    }
    if (existing.status === "offboarded") {
      sendJson(res, 409, {
        error: { code: "tenant_offboarded", message: "Tenant is already offboarded." },
        offboarding: existing.offboarding ?? null
      });
      return;
    }
    const result = offboardTenant(state, tenantId, { actor: body.actor, reason: body.reason });
    await saveWholeState(result.state, dataDir);
    sendJson(res, 200, {
      tenant: publicTenant(result.state.controlPlane.tenants[tenantId]),
      offboarding: result.attestation
    });
    return;
  }

  const tenantMatch = path.match(/^\/platform\/tenants\/([^/]+)$/);
  if (method === "GET" && tenantMatch) {
    const state = await loadWholeState(dataDir);
    const record = state.controlPlane.tenants[decodeURIComponent(tenantMatch[1])];
    if (!record) {
      sendJson(res, 404, { error: { code: "not_found", message: "Tenant not found." } });
      return;
    }
    sendJson(res, 200, publicTenant(record));
    return;
  }

  sendJson(res, 404, { error: { code: "not_found", message: "Platform route not found." } });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function auditFiltersFromUrl(url) {
  const filters = {};
  for (const key of ["type", "subjectId", "from", "to"]) {
    const value = url.searchParams.get(key);
    if (value) {
      filters[key] = value;
    }
  }
  return filters;
}

function taskFiltersFromUrl(url) {
  const filters = {};
  for (const key of ["queue", "status", "type", "entityType", "assignedTo", "slaStatus"]) {
    const value = url.searchParams.get(key);
    if (value) {
      filters[key] = value;
    }
  }
  return filters;
}

function complaintMatchesFilters(complaint, url) {
  const filters = {
    status: url.searchParams.get("status"),
    effectiveStatus: url.searchParams.get("effectiveStatus"),
    assignedTo: url.searchParams.get("assignedTo"),
    category: url.searchParams.get("category")
  };
  if (filters.status && complaint.status !== filters.status) {
    return false;
  }
  if (filters.effectiveStatus && complaint.effectiveStatus !== filters.effectiveStatus) {
    return false;
  }
  if (filters.assignedTo && complaint.assignedTo !== filters.assignedTo) {
    return false;
  }
  if (filters.category && complaint.category !== filters.category) {
    return false;
  }
  return true;
}

function combineComplianceResults(...results) {
  const findings = results.flatMap((result) => result?.findings ?? []);
  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Local dev bootstrap: set LOANOS_DEV_TENANT_KEY to get a ready-to-use tenant
  // ("dev") without going through the platform admin flow. Never enable this in
  // production; there, tenants are minted only through /platform/tenants.
  const devTenantKey = process.env.LOANOS_DEV_TENANT_KEY;
  const bootstrapTenants = devTenantKey
    ? [{ tenantId: "dev", name: "Local Dev RE", apiKey: devTenantKey }]
    : [];
  const server = createLoanOsServer({ bootstrapTenants });
  server.listen(DEFAULT_PORT, () => {
    console.log(`LoanOS India API listening on http://localhost:${DEFAULT_PORT}`);
    if (devTenantKey) {
      console.log(`Dev tenant "dev" ready. Send header: x-api-key: ${devTenantKey}`);
    } else {
      console.log(
        "No tenant configured. Set LOANOS_DEV_TENANT_KEY for a dev tenant, or LOANOS_PLATFORM_ADMIN_KEY to mint tenants via POST /platform/tenants."
      );
    }
  });
}
