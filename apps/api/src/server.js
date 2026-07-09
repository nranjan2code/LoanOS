import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import {
  accrueInterest,
  attachKfs,
  applyDecisionApproval,
  applyKfsWorkflow,
  assignComplaint,
  assignRecoveryAgent,
  assignWorkflowTask,
  assessChargeToLoanAccount,
  buildAiDisclosure,
  buildKeyFactStatement,
  classifyLoanAsset,
  clearGlobalKillSwitch,
  commentOnWorkflowTask,
  createLoanAccountFromApplication,
  createLoanId,
  computeDelinquency,
  createComplaint,
  createErasureRequest,
  createFraudCase,
  createIncident,
  classifyFraudCase,
  DECLINE_REASON_CODES,
  deriveWorkflowTasks,
  enrichErasureRequest,
  forecloseLoanAccount,
  enrichComplaint,
  enrichFraudCase,
  enrichIncident,
  fulfillErasureRequest,
  generateFraudCommitteePack,
  issueShowCauseNotice,
  redactBorrowerProfile,
  recordFraudResponse,
  recordIncidentNotification,
  rejectErasureRequest,
  escalateComplaintToRbiCms,
  evaluateEligibility,
  evaluateKycStatus,
  evaluateLoanApplication,
  generateDlaCimsExport,
  generateClosureCertificate,
  generateDocumentPacket,
  generateCicSnapshot,
  generateLoanStatement,
  initializeApplicationWorkflow,
  listBorrowerBeneficialOwners,
  listBorrowerConsents,
  listBorrowerKycRecords,
  listDataDisclosures,
  recordDataDisclosure,
  listRegulatoryControls,
  registerModel,
  recordDriftObservation,
  recordHumanReview,
  recordDocumentPacketDelivered,
  recordDocumentPacketDelivery,
  recordDocumentPacketGenerated,
  recordPostIncidentReview,
  requestHumanHandoff,
  resolveHumanHandoff,
  listHumanHandoffRequests,
  releaseWorkflowTask,
  renderLoanStatementDocument,
  resolveComplaint,
  selectProductPolicyVersion,
  resolveBorrowerApplicationReferences,
  resolveLoanApplicationReferences,
  summarizeFindings,
  markDisbursed,
  postCashRecoveryToLoanAccount,
  postPaymentToLoanAccount,
  prepayLoanAccount,
  proposeDecision,
  recordCollectionsReminder,
  restructureLoanAccount,
  resetFloatingRate,
  settleLoanAccount,
  writeOffLoanAccount,
  quoteForeclosure,
  reverseLoanAccountEvent,
  summarizeLoanAccount,
  startComplaintReview,
  startWorkflowTask,
  transitionModel,
  triggerKillSwitch,
  upsertBeneficialOwner,
  upsertDigitalLendingApp,
  upsertLendingServiceProvider,
  upsertBorrowerProfile,
  upsertConsentRecord,
  upsertKycRecord,
  upsertProductPolicy,
  upsertRecoveryAgent,
  upsertRegulatedEntity,
  upsertStaffActor,
  validateDisbursement,
  validateCashRecoveryApprovalAccess,
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
  AUDIT_ACTOR_TYPES,
  buildAuditEvidencePack,
  sealAuditChain,
  stampAuditEvents
} from "../../../packages/core/src/index.js";
import {
  appendEvent,
  buildTenantExport,
  createEmptyTenantData,
  ensureBootstrapTenants,
  generateApiKey,
  generateBreakGlassKey,
  getTenantData,
  grantBreakGlass,
  listBreakGlassGrants,
  listSubProcessors,
  listTenants,
  loadState as loadWholeState,
  offboardTenant,
  publicBreakGlassGrant,
  publicSubProcessor,
  publicTenant,
  registerSubProcessor,
  registerTenant,
  resolveBreakGlass,
  resolveTenantByApiKey,
  revokeBreakGlass,
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
  let tenant = resolveTenantByApiKey(wholeState, apiKey);
  // A tenant's own api key is the primary path. Failing that, platform staff may
  // present a break-glass credential scoped to exactly one tenant.
  let breakGlass = null;
  if (!tenant) {
    const resolved = resolveBreakGlass(wholeState, breakGlassKeyFromRequest(req));
    if (resolved) {
      tenant = resolved.tenant;
      breakGlass = resolved.grant;
    }
  }
  if (!tenant) {
    sendJson(res, 401, {
      error: {
        code: "tenant_auth_required",
        message: "A valid tenant API key or break-glass credential is required for this route."
      }
    });
    return;
  }

  // The store hands each handler ONLY this tenant's partition. There is no code
  // path from a handler back to another tenant's data. On every save the tenant's
  // audit events are sealed into an append-only hash chain, so the persisted
  // record is tamper-evident by construction.
  let scopedWholeState = wholeState;
  // Every event gets a uniform provenance envelope (actor / actorType /
  // dataClass) stamped centrally before sealing, so no handler can persist an
  // unclassified event. Break-glass requests stamp platform-staff provenance;
  // ordinary requests attribute to the tenant.
  const auditActor = breakGlass
    ? { actor: `platform:${breakGlass.staffId}`, actorType: AUDIT_ACTOR_TYPES.PLATFORM_STAFF }
    : { actor: tenant.tenantId, actorType: AUDIT_ACTOR_TYPES.TENANT };
  const store = {
    load: async () => getTenantData(scopedWholeState, tenant.tenantId) ?? createEmptyTenantData(),
    save: async (tenantData) => {
      const stamped = stampAuditEvents(tenantData.events, auditActor);
      const sealed = {
        ...tenantData,
        events: sealAuditChain(stamped, tenant.tenantId)
      };
      scopedWholeState = setTenantData(scopedWholeState, tenant.tenantId, sealed);
      await saveWholeState(scopedWholeState, dataDir);
    }
  };

  // Break-glass access is never silent: record it into the tenant's own audit
  // chain before dispatching, so the reach-in is visible to the tenant via
  // GET /audit/events regardless of whether the request reads or writes.
  if (breakGlass) {
    const current = await store.load();
    await store.save(
      appendEvent(current, {
        type: "platform.break_glass.access",
        actor: `platform:${breakGlass.staffId}`,
        actorType: "platform_staff",
        dataClass: "tenant_scoped",
        grantId: breakGlass.grantId,
        staffId: breakGlass.staffId,
        reason: breakGlass.reason,
        method,
        path
      })
    );
  }

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

  // Break-glass transparency: a tenant can see every platform-staff break-glass
  // grant scoped to it, past and present, with its effective status.
  if (method === "GET" && path === "/break-glass-grants") {
    sendJson(res, 200, {
      grants: listBreakGlassGrants(scopedWholeState, tenant.tenantId)
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

  // --- Security/data incident notification (RE 6-hour RBI / CERT-In duties) ---
  if (method === "GET" && path === "/incidents") {
    const state = await store.load();
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const incidents = Object.values(state.incidents)
      .map((incident) => enrichIncident(incident, asOf))
      .filter((incident) => incidentMatchesFilters(incident, url));
    sendJson(res, 200, {
      asOf: asOf.toISOString(),
      count: incidents.length,
      incidents
    });
    return;
  }

  if (method === "POST" && path === "/incidents") {
    const body = await readJson(req);
    const state = await store.load();
    const result = createIncident(state.incidents, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "incident_invalid", message: "Incident report is invalid." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      { ...state, incidents: result.registry },
      {
        type: "incident.reported",
        incidentId: result.incident.incidentId,
        category: result.incident.category,
        severity: result.incident.severity
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { incident: result.incident, event: result.event });
    return;
  }

  const incidentMatch = path.match(/^\/incidents\/([^/]+)$/);
  if (method === "GET" && incidentMatch) {
    const state = await store.load();
    const incident = state.incidents[decodeURIComponent(incidentMatch[1])];
    if (!incident) {
      sendJson(res, 404, { error: { code: "not_found", message: "Incident not found." } });
      return;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, enrichIncident(incident, asOf));
    return;
  }

  const incidentNotificationMatch = path.match(/^\/incidents\/([^/]+)\/notifications$/);
  if (method === "POST" && incidentNotificationMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const incidentId = decodeURIComponent(incidentNotificationMatch[1]);
    const incident = state.incidents[incidentId];
    if (!incident) {
      sendJson(res, 404, { error: { code: "not_found", message: "Incident not found." } });
      return;
    }
    const result = recordIncidentNotification(incident, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "incident_notification_blocked", message: "Incident notification is invalid." },
        findings: result.findings
      });
      return;
    }
    const stored = result.incident;
    const nextState = appendEvent(
      { ...state, incidents: { ...state.incidents, [stored.incidentId]: stored } },
      {
        type: result.event.type,
        incidentId: stored.incidentId,
        authority: body.authority,
        actor: body.actor ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { incident: stored, event: result.event });
    return;
  }

  // --- Fraud case module (RBI FRM 2024 + natural-justice classification) ---
  if (method === "GET" && path === "/fraud-cases") {
    const state = await store.load();
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const fraudCases = Object.values(state.fraudCases)
      .map((fraudCase) => enrichFraudCase(fraudCase, asOf))
      .filter((fraudCase) => fraudCaseMatchesFilters(fraudCase, url));
    sendJson(res, 200, { asOf: asOf.toISOString(), count: fraudCases.length, fraudCases });
    return;
  }

  if (method === "POST" && path === "/fraud-cases") {
    const body = await readJson(req);
    const state = await store.load();
    const result = createFraudCase(state.fraudCases, body, state);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "fraud_case_invalid", message: "Fraud case is invalid." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      { ...state, fraudCases: result.registry },
      {
        type: "fraud_case.reported",
        fraudCaseId: result.fraudCase.fraudCaseId,
        category: result.fraudCase.category,
        actor: body.reportedBy ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { fraudCase: result.fraudCase, event: result.event });
    return;
  }

  const fraudCaseMatch = path.match(/^\/fraud-cases\/([^/]+)$/);
  if (method === "GET" && fraudCaseMatch) {
    const state = await store.load();
    const fraudCase = state.fraudCases[decodeURIComponent(fraudCaseMatch[1])];
    if (!fraudCase) {
      sendJson(res, 404, { error: { code: "not_found", message: "Fraud case not found." } });
      return;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, enrichFraudCase(fraudCase, asOf));
    return;
  }

  const fraudCommitteePackMatch = path.match(/^\/fraud-cases\/([^/]+)\/committee-pack$/);
  if (method === "GET" && fraudCommitteePackMatch) {
    const state = await store.load();
    const fraudCase = state.fraudCases[decodeURIComponent(fraudCommitteePackMatch[1])];
    if (!fraudCase) {
      sendJson(res, 404, { error: { code: "not_found", message: "Fraud case not found." } });
      return;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const result = generateFraudCommitteePack(fraudCase, {}, asOf);
    sendJson(res, 200, result.committeePack);
    return;
  }

  const fraudCaseActionMatch = path.match(/^\/fraud-cases\/([^/]+)\/(show-cause-notice|responses|classification)$/);
  if (method === "POST" && fraudCaseActionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const fraudCaseId = decodeURIComponent(fraudCaseActionMatch[1]);
    const action = fraudCaseActionMatch[2];
    const fraudCase = state.fraudCases[fraudCaseId];
    if (!fraudCase) {
      sendJson(res, 404, { error: { code: "not_found", message: "Fraud case not found." } });
      return;
    }
    const actionResult =
      action === "show-cause-notice"
        ? issueShowCauseNotice(fraudCase, body)
        : action === "responses"
          ? recordFraudResponse(fraudCase, body)
          : classifyFraudCase(fraudCase, body);
    if (actionResult.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "fraud_case_action_blocked", message: "Fraud case action is blocked by natural-justice or workflow findings." },
        findings: actionResult.findings
      });
      return;
    }
    const stored = actionResult.fraudCase;
    const nextState = appendEvent(
      { ...state, fraudCases: { ...state.fraudCases, [stored.fraudCaseId]: stored } },
      {
        type: actionResult.event.type,
        fraudCaseId: stored.fraudCaseId,
        actor: body.actor ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { fraudCase: stored, event: actionResult.event });
    return;
  }

  // --- DPDP data-retention and erasure (right-to-be-forgotten) workflow ---
  if (method === "GET" && path === "/erasure-requests") {
    const state = await store.load();
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const requests = Object.values(state.erasureRequests)
      .map((request) => enrichErasureRequest(request, state, asOf))
      .filter((request) => !url.searchParams.get("status") || request.status === url.searchParams.get("status"))
      .filter(
        (request) =>
          !url.searchParams.get("borrowerId") || request.borrowerId === url.searchParams.get("borrowerId")
      );
    sendJson(res, 200, { count: requests.length, erasureRequests: requests });
    return;
  }

  if (method === "POST" && path === "/erasure-requests") {
    const body = await readJson(req);
    const state = await store.load();
    const result = createErasureRequest(state.erasureRequests, body, state);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "erasure_request_invalid", message: "Erasure request is invalid." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      { ...state, erasureRequests: result.registry },
      {
        type: "data_erasure.requested",
        erasureRequestId: result.request.erasureRequestId,
        borrowerId: result.request.borrowerId,
        actor: body.requestedBy ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { erasureRequest: result.request, event: result.event });
    return;
  }

  const erasureMatch = path.match(/^\/erasure-requests\/([^/]+)$/);
  if (method === "GET" && erasureMatch) {
    const state = await store.load();
    const request = state.erasureRequests[decodeURIComponent(erasureMatch[1])];
    if (!request) {
      sendJson(res, 404, { error: { code: "not_found", message: "Erasure request not found." } });
      return;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, enrichErasureRequest(request, state, asOf));
    return;
  }

  const erasureActionMatch = path.match(/^\/erasure-requests\/([^/]+)\/(fulfillment|rejection)$/);
  if (method === "POST" && erasureActionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const requestId = decodeURIComponent(erasureActionMatch[1]);
    const action = erasureActionMatch[2];
    const request = state.erasureRequests[requestId];
    if (!request) {
      sendJson(res, 404, { error: { code: "not_found", message: "Erasure request not found." } });
      return;
    }
    // An injectable clock (asOf) lets retention windows be evaluated at a given
    // date, consistent with the read endpoints.
    const now = body.asOf ? new Date(body.asOf) : new Date();
    const result =
      action === "fulfillment"
        ? fulfillErasureRequest(request, body, state, now)
        : rejectErasureRequest(request, body, state, now);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "erasure_action_blocked", message: "Erasure action is blocked by retention or workflow findings." },
        findings: result.findings
      });
      return;
    }
    const stored = result.request;
    // On fulfilment the borrower's personal data is irreversibly redacted in
    // place; the erasure request and its audit trail are retained as evidence.
    const borrowerProfiles =
      action === "fulfillment" && state.borrowerProfiles[stored.borrowerId]
        ? {
            ...state.borrowerProfiles,
            [stored.borrowerId]: redactBorrowerProfile(state.borrowerProfiles[stored.borrowerId])
          }
        : state.borrowerProfiles;
    const nextState = appendEvent(
      {
        ...state,
        borrowerProfiles,
        erasureRequests: { ...state.erasureRequests, [stored.erasureRequestId]: stored }
      },
      {
        type: result.event.type,
        erasureRequestId: stored.erasureRequestId,
        borrowerId: stored.borrowerId,
        actor: body.actor ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { erasureRequest: stored, event: result.event });
    return;
  }

  // --- Third-party data-sharing disclosure ledger (DPDP record of processing) ---
  if (method === "GET" && path === "/data-disclosures") {
    const state = await store.load();
    const disclosures = listDataDisclosures(state.dataDisclosures, url.searchParams.get("borrowerId") ?? undefined);
    sendJson(res, 200, { count: disclosures.length, disclosures });
    return;
  }

  if (method === "POST" && path === "/data-disclosures") {
    const body = await readJson(req);
    const state = await store.load();
    const result = recordDataDisclosure(state.dataDisclosures, body, state);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "data_disclosure_blocked", message: "Data disclosure is blocked by consent or validation findings." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      { ...state, dataDisclosures: result.registry },
      {
        type: "data_disclosure.recorded",
        disclosureId: result.disclosure.disclosureId,
        borrowerId: result.disclosure.borrowerId,
        recipientType: result.disclosure.recipientType,
        legalBasis: result.disclosure.legalBasis
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { disclosure: result.disclosure, event: result.event });
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

  // Recovery-agent registry: empanelment evidence (due diligence, training,
  // code-of-conduct, authorization) an active agent must carry before a
  // recovery assignment can name them.
  if (method === "GET" && path === "/recovery-agents") {
    const state = await store.load();
    sendJson(res, 200, {
      recoveryAgents: Object.values(state.recoveryAgents)
    });
    return;
  }

  if (method === "POST" && path === "/recovery-agents") {
    const body = await readJson(req);
    const state = await store.load();
    const result = upsertRecoveryAgent(state.recoveryAgents, body, state.regulatedEntities);
    const nextState =
      result.summary.status === "blocked"
        ? state
        : appendEvent(
            {
              ...state,
              recoveryAgents: result.registry
            },
            {
              type: "recovery_agent.upserted",
              recoveryAgentId: result.recoveryAgent.recoveryAgentId,
              regulatedEntityId: result.recoveryAgent.regulatedEntityId,
              status: result.recoveryAgent.status
            }
          );
    await store.save(nextState);
    sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
    return;
  }

  const recoveryAgentMatch = path.match(/^\/recovery-agents\/([^/]+)$/);
  if (method === "GET" && recoveryAgentMatch) {
    const state = await store.load();
    const recoveryAgent = state.recoveryAgents[decodeURIComponent(recoveryAgentMatch[1])];
    if (!recoveryAgent) {
      sendJson(res, 404, { error: { code: "not_found", message: "Recovery agent not found." } });
      return;
    }
    sendJson(res, 200, recoveryAgent);
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
    // `asOf` returns the policy version effective on that date, drawn from the
    // retained version history; without it the current version is returned.
    if (url.searchParams.get("asOf")) {
      sendJson(res, 200, selectProductPolicyVersion(product, new Date(url.searchParams.get("asOf"))));
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

  const modelDriftMatch = path.match(/^\/ai\/models\/([^/]+)\/drift-observations$/);
  if (method === "POST" && modelDriftMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const modelId = decodeURIComponent(modelDriftMatch[1]);
    const result = recordDriftObservation(state.modelRegistry, { ...body, modelId });
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "drift_observation_blocked", message: "Drift observation is blocked by governance findings." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      { ...state, modelRegistry: result.registry },
      {
        type: "api.ai.model.drift_observed",
        modelId,
        metric: result.observation.metric,
        breached: result.breached,
        actor: body.actor ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, result);
    return;
  }

  // Customer-facing AI disclosure and human handoff (RBI DL / FREE-AI).
  const modelDisclosureMatch = path.match(/^\/ai\/models\/([^/]+)\/disclosure$/);
  if (method === "GET" && modelDisclosureMatch) {
    const state = await store.load();
    const modelId = decodeURIComponent(modelDisclosureMatch[1]);
    const result = buildAiDisclosure(state.modelRegistry, { modelId });
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "ai_disclosure_unavailable", message: "AI disclosure is unavailable for this model." },
        findings: result.findings
      });
      return;
    }
    sendJson(res, 200, result.disclosure);
    return;
  }

  if (method === "GET" && path === "/ai/handoff-requests") {
    const state = await store.load();
    const requests = listHumanHandoffRequests(state.aiHandoffRequests, {
      status: url.searchParams.get("status") ?? undefined,
      borrowerId: url.searchParams.get("borrowerId") ?? undefined
    });
    sendJson(res, 200, { count: requests.length, handoffRequests: requests });
    return;
  }

  if (method === "POST" && path === "/ai/handoff-requests") {
    const body = await readJson(req);
    const state = await store.load();
    const result = requestHumanHandoff(state.aiHandoffRequests, body, state);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "handoff_invalid", message: "Human handoff request is invalid." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      { ...state, aiHandoffRequests: result.registry },
      {
        type: "ai.human_handoff.requested",
        handoffId: result.request.handoffId,
        borrowerId: result.request.borrowerId,
        modelId: result.request.modelId
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { handoffRequest: result.request, event: result.event });
    return;
  }

  const handoffResolutionMatch = path.match(/^\/ai\/handoff-requests\/([^/]+)\/resolution$/);
  if (method === "POST" && handoffResolutionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const handoffId = decodeURIComponent(handoffResolutionMatch[1]);
    const request = state.aiHandoffRequests[handoffId];
    if (!request) {
      sendJson(res, 404, { error: { code: "not_found", message: "Handoff request not found." } });
      return;
    }
    const result = resolveHumanHandoff(request, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "handoff_resolution_blocked", message: "Handoff resolution is blocked by findings." },
        findings: result.findings
      });
      return;
    }
    const stored = result.request;
    const nextState = appendEvent(
      { ...state, aiHandoffRequests: { ...state.aiHandoffRequests, [stored.handoffId]: stored } },
      { type: "ai.human_handoff.handled", handoffId: stored.handoffId, handledBy: stored.handledBy }
    );
    await store.save(nextState);
    sendJson(res, 200, { handoffRequest: stored, event: result.event });
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
      const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
      sendJson(res, 200, {
        kycRecords: listBorrowerKycRecords(state.kycRecords, borrowerId).map((record) => ({
          ...record,
          ...evaluateKycStatus(record, asOf)
        }))
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

  // PMLA beneficial-owner declarations for a legal-entity (company/
  // partnership/llp/trust) borrower; resolveBorrowerApplicationReferences
  // blocks sanction for such a borrower without a verified, qualifying one.
  const borrowerBeneficialOwnersMatch = path.match(/^\/borrowers\/([^/]+)\/beneficial-owners$/);
  if (borrowerBeneficialOwnersMatch) {
    const borrowerId = decodeURIComponent(borrowerBeneficialOwnersMatch[1]);
    const state = await store.load();
    if (!state.borrowerProfiles[borrowerId]) {
      sendJson(res, 404, { error: { code: "not_found", message: "Borrower not found." } });
      return;
    }

    if (method === "GET") {
      sendJson(res, 200, {
        beneficialOwners: listBorrowerBeneficialOwners(state.beneficialOwners, borrowerId)
      });
      return;
    }

    if (method === "POST") {
      const body = await readJson(req);
      const result = upsertBeneficialOwner(
        state.beneficialOwners,
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
                beneficialOwners: result.registry
              },
              {
                type: "borrower_beneficial_owner.upserted",
                borrowerId,
                beneficialOwnerId: result.beneficialOwner.beneficialOwnerId,
                type: result.beneficialOwner.type
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
      kycRecords: state.kycRecords,
      beneficialOwners: state.beneficialOwners
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

    const result = assignRecoveryAgent(loanAccount, body, state.recoveryAgents);
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

    const accessFindings = validateCashRecoveryApprovalAccess(state.staffActors, body);
    const accessSummary = summarizeFindings(accessFindings);
    if (accessSummary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "cash_recovery_access_blocked",
          message: "Cash recovery approval is blocked by actor role policy."
        },
        findings: accessFindings
      });
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

  const loanAccountRestructureMatch = path.match(/^\/loan-accounts\/([^/]+)\/restructure$/);
  if (method === "POST" && loanAccountRestructureMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountRestructureMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }

    const result = restructureLoanAccount(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "restructure_blocked", message: "Restructure is blocked by LMS or approval findings." },
        findings: result.findings
      });
      return;
    }

    const stored = result.loanAccount;
    const nextState = appendEvent(
      { ...state, loanAccounts: { ...state.loanAccounts, [stored.loanAccountId]: stored } },
      {
        type: "loan_account.restructured",
        loanAccountId: stored.loanAccountId,
        restructureId: result.restructure.restructureId,
        approvedBy: result.restructure.approvedBy
      }
    );
    await store.save(nextState);
    sendJson(res, 200, {
      loanAccount: stored,
      restructure: result.restructure,
      schedule: result.schedule,
      summary: summarizeLoanAccount(stored, new Date())
    });
    return;
  }

  const loanAccountRateResetMatch = path.match(/^\/loan-accounts\/([^/]+)\/rate-resets$/);
  if (method === "POST" && loanAccountRateResetMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountRateResetMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }

    const result = resetFloatingRate(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "rate_reset_blocked", message: "Interest rate reset is blocked by LMS or approval findings." },
        findings: result.findings
      });
      return;
    }

    const stored = result.loanAccount;
    const nextState = appendEvent(
      { ...state, loanAccounts: { ...state.loanAccounts, [stored.loanAccountId]: stored } },
      {
        type: "loan_account.interest_rate_reset",
        loanAccountId: stored.loanAccountId,
        resetId: result.reset.resetId,
        approvedBy: result.reset.approvedBy
      }
    );
    await store.save(nextState);
    sendJson(res, 200, {
      loanAccount: stored,
      reset: result.reset,
      events: result.events,
      summary: summarizeLoanAccount(stored, new Date())
    });
    return;
  }

  const loanAccountReminderMatch = path.match(/^\/loan-accounts\/([^/]+)\/reminders$/);
  if (method === "POST" && loanAccountReminderMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountReminderMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }
    const result = recordCollectionsReminder(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "reminder_blocked", message: "Reminder is blocked by fair-practices or LMS findings." },
        findings: result.findings
      });
      return;
    }
    const stored = result.loanAccount;
    const nextState = appendEvent(
      { ...state, loanAccounts: { ...state.loanAccounts, [stored.loanAccountId]: stored } },
      {
        type: "loan_account.reminder_sent",
        loanAccountId: stored.loanAccountId,
        reminderId: result.reminder.reminderId,
        channel: result.reminder.channel,
        stage: result.reminder.stage
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { loanAccount: stored, reminder: result.reminder });
    return;
  }

  const loanAccountSettlementMatch = path.match(/^\/loan-accounts\/([^/]+)\/settlement$/);
  if (method === "POST" && loanAccountSettlementMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountSettlementMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }
    const result = settleLoanAccount(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "settlement_blocked", message: "Settlement is blocked by LMS or approval findings." },
        findings: result.findings
      });
      return;
    }
    const stored = result.loanAccount;
    const nextState = appendEvent(
      { ...state, loanAccounts: { ...state.loanAccounts, [stored.loanAccountId]: stored } },
      {
        type: "loan_account.settled",
        loanAccountId: stored.loanAccountId,
        settlementId: result.settlement.settlementId,
        approvedBy: result.settlement.approvedBy
      }
    );
    await store.save(nextState);
    sendJson(res, 200, {
      loanAccount: stored,
      settlement: result.settlement,
      summary: summarizeLoanAccount(stored, new Date(result.settlement.settledAt))
    });
    return;
  }

  const loanAccountWriteOffMatch = path.match(/^\/loan-accounts\/([^/]+)\/write-off$/);
  if (method === "POST" && loanAccountWriteOffMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(loanAccountWriteOffMatch[1]);
    const loanAccount = state.loanAccounts[loanAccountId];
    if (!loanAccount) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan account not found." } });
      return;
    }
    const result = writeOffLoanAccount(loanAccount, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "write_off_blocked", message: "Write-off is blocked by LMS or approval findings." },
        findings: result.findings
      });
      return;
    }
    const stored = result.loanAccount;
    const nextState = appendEvent(
      { ...state, loanAccounts: { ...state.loanAccounts, [stored.loanAccountId]: stored } },
      {
        type: "loan_account.written_off",
        loanAccountId: stored.loanAccountId,
        writeOffId: result.writeOff.writeOffId,
        approvedBy: result.writeOff.approvedBy
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { loanAccount: stored, writeOff: result.writeOff });
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

function breakGlassKeyFromRequest(req) {
  const key = req.headers["x-break-glass-key"];
  return Array.isArray(key) ? key[0] : key ?? null;
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

  // Break-glass grant administration (platform admin only). Minting returns a
  // one-time, time-boxed credential stored only as a hash.
  const breakGlassMintMatch = path.match(/^\/platform\/tenants\/([^/]+)\/break-glass$/);
  if (method === "POST" && breakGlassMintMatch) {
    const body = await readJson(req);
    const tenantId = decodeURIComponent(breakGlassMintMatch[1]);
    const state = await loadWholeState(dataDir);
    const tenantRecord = state.controlPlane.tenants[tenantId];
    if (!tenantRecord) {
      sendJson(res, 404, { error: { code: "not_found", message: "Tenant not found." } });
      return;
    }
    if (!body.staffId || !body.reason) {
      sendJson(res, 422, {
        error: {
          code: "break_glass_invalid",
          message: "Break-glass access requires a staffId and a reason."
        }
      });
      return;
    }
    const credential = generateBreakGlassKey();
    const grantId = `bg_${randomBytes(8).toString("hex")}`;
    const nextState = grantBreakGlass(state, {
      grantId,
      tenantId,
      staffId: body.staffId,
      reason: body.reason,
      ttlMinutes: body.ttlMinutes,
      createdBy: "platform_admin",
      credential
    });
    await saveWholeState(nextState, dataDir);
    sendJson(res, 201, {
      grant: publicBreakGlassGrant(nextState.controlPlane.breakGlassGrants[grantId]),
      credential
    });
    return;
  }

  if (method === "GET" && breakGlassMintMatch) {
    const state = await loadWholeState(dataDir);
    const tenantId = decodeURIComponent(breakGlassMintMatch[1]);
    sendJson(res, 200, { grants: listBreakGlassGrants(state, tenantId) });
    return;
  }

  const breakGlassRevokeMatch = path.match(/^\/platform\/break-glass\/([^/]+)\/revoke$/);
  if (method === "POST" && breakGlassRevokeMatch) {
    const state = await loadWholeState(dataDir);
    const nextState = revokeBreakGlass(state, decodeURIComponent(breakGlassRevokeMatch[1]));
    if (!nextState) {
      sendJson(res, 404, { error: { code: "not_found", message: "Break-glass grant not found." } });
      return;
    }
    await saveWholeState(nextState, dataDir);
    sendJson(res, 200, {
      grant: publicBreakGlassGrant(nextState.controlPlane.breakGlassGrants[decodeURIComponent(breakGlassRevokeMatch[1])])
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

function incidentMatchesFilters(incident, url) {
  const filters = {
    status: url.searchParams.get("status"),
    severity: url.searchParams.get("severity"),
    category: url.searchParams.get("category"),
    reportingStatus: url.searchParams.get("reportingStatus")
  };
  if (filters.status && incident.status !== filters.status) {
    return false;
  }
  if (filters.severity && incident.severity !== filters.severity) {
    return false;
  }
  if (filters.category && incident.category !== filters.category) {
    return false;
  }
  if (filters.reportingStatus && incident.reportingStatus !== filters.reportingStatus) {
    return false;
  }
  return true;
}

function fraudCaseMatchesFilters(fraudCase, url) {
  const filters = {
    status: url.searchParams.get("status"),
    category: url.searchParams.get("category"),
    subjectBorrowerId: url.searchParams.get("subjectBorrowerId"),
    subjectLoanAccountId: url.searchParams.get("subjectLoanAccountId")
  };
  if (filters.status && fraudCase.status !== filters.status) {
    return false;
  }
  if (filters.category && fraudCase.category !== filters.category) {
    return false;
  }
  if (filters.subjectBorrowerId && fraudCase.subjectBorrowerId !== filters.subjectBorrowerId) {
    return false;
  }
  if (filters.subjectLoanAccountId && fraudCase.subjectLoanAccountId !== filters.subjectLoanAccountId) {
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
