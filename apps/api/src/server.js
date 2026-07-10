import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
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
  completeWorkflowTask,
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
  redactBorrowerKycRecords,
  redactBorrowerBeneficialOwners,
  executeAutoRetentionCleanup,
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
  listDocumentVaultRecords,
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
  validateDisbursement,
  searchCkyc,
  downloadCkycRecord,
  uploadCkycRecord,
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
  waiveLoanAccountCharge,
  validateMarketplaceNeutrality,
  rankMarketplaceOffers,
  ExternalServiceManager,
  signDocumentPacket,
  vaultDocumentPacket,
  createSecurityInterest,
  enrichSecurityInterest,
  fileSecurityInterest,
  listSecurityInterests,
  modifySecurityInterest,
  registerSecurityInterest,
  satisfySecurityInterest,
  searchCersaiCharges,
  validateCersaiForDisbursement,
  createAccessRequest,
  fulfillAccessRequest,
  enrichAccessRequest,
  createCorrectionRequest,
  reviewCorrectionRequest,
  enrichCorrectionRequest,
  createFiuReport,
  reviewFiuReport,
  fileFiuReport,
  enrichFiuReport,
  listFiuReports
} from "../../../packages/core/src/index.js";
import {
  AUDIT_ACTOR_TYPES,
  buildAuditEvidencePack,
  sealAuditChain,
  stampAuditEvents
} from "../../../packages/core/src/index.js";
import {
  appendEvent,
  appendPlatformEvent,
  buildPlatformAuditEvidencePack,
  buildTenantExport,
  computeTenantOnboardingReadiness,
  createEmptyTenantData,
  ensureBootstrapTenants,
  generateApiKey,
  generateBreakGlassKey,
  getTenantData,
  grantBreakGlass,
  listBreakGlassGrants,
  listSubProcessors,
  listTenants,
  listSandboxes,
  resetSandbox,
  deleteSandbox,
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
  TENANT_ONBOARDING_FLOWS,
  TENANT_ONBOARDING_MODULES,
  validateSubProcessor,
  withStateLock
} from "./file-store.js";
import {
  acceptTenantUserInvite,
  authenticatePlatformUser,
  authenticateTenantUser,
  beginMfaEnrollment,
  changeOwnPassword,
  clearLoginAttempts,
  completeAccessReview,
  confirmMfaEnrollment,
  createAccessReview,
  createSessionRecord,
  createTenantUserInvite,
  disableMfa,
  hasPlatformRole,
  hasTenantAdminRole,
  isLastActiveTenantAdmin,
  isLoginLocked,
  loginAttemptKey,
  TENANT_ADMIN_ROLES,
  publicPlatformUser,
  publicSession,
  publicTenantUser,
  recordLoginFailure,
  resolveSession,
  revokeSession,
  upsertPlatformUser,
  upsertTenantUser,
  verifyTotpCode
} from "./identity.js";

const DEFAULT_PORT = Number(process.env.PORT || 3040);
const SESSION_COOKIE = "loanos_session";

export function createLoanOsServer({ dataDir, bootstrapTenants = [], platformAdminKey } = {}) {
  const adminKey = platformAdminKey ?? process.env.LOANOS_PLATFORM_ADMIN_KEY ?? null;
  let bootstrapPromise = null;
  return createServer(async (req, res) => {
    try {
      if (!bootstrapPromise) {
        bootstrapPromise = ensureBootstrapTenants(dataDir, bootstrapTenants);
      }
      await bootstrapPromise;
      // Serialize this request's full load-modify-save span against every other
      // request touching the same dataDir, so concurrent requests can't race a
      // lost update against the single state.json file.
      await withStateLock(dataDir, () => route(req, res, dataDir, adminKey));
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

  if (path === "/auth" || path.startsWith("/auth/")) {
    await routeAuth(req, res, { dataDir, method, path });
    return;
  }

  if (method === "GET" && (path === "/dashboard" || path.startsWith("/dashboard/"))) {
    try {
      if (path === "/dashboard") {
        res.writeHead(301, { Location: "/dashboard/" });
        res.end();
        return;
      }
      let fileSubpath = path.slice("/dashboard/".length);
      if (fileSubpath === "" || fileSubpath === "index.html") {
        fileSubpath = "index.html";
      }

      if (fileSubpath.includes("..")) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      const filePath = join(__dirname, "dashboard", fileSubpath);
      const content = await readFile(filePath);

      let contentType = "text/plain";
      if (fileSubpath.endsWith(".html")) contentType = "text/html; charset=utf-8";
      else if (fileSubpath.endsWith(".css")) contentType = "text/css; charset=utf-8";
      else if (fileSubpath.endsWith(".js")) contentType = "application/javascript; charset=utf-8";

      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch (err) {
      res.writeHead(404);
      res.end("Not Found");
    }
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
  const sessionResolution = resolveSession(wholeState, sessionTokenFromRequest(req));
  let tenant = null;
  let breakGlass = null;
  let authContext = null;

  if (sessionResolution?.session?.principalType === "tenant_user") {
    if (rejectIfRestricted(res, sessionResolution.session, path)) {
      return;
    }
    tenant = sessionResolution.tenant;
    authContext = {
      principalType: "tenant_user",
      tenantId: tenant.tenantId,
      userId: sessionResolution.user.userId,
      email: sessionResolution.user.email,
      displayName: sessionResolution.user.displayName,
      roles: sessionResolution.user.adminRoles ?? [],
      sessionId: sessionResolution.session.sessionId
    };
  }

  // A tenant session is the human path. A tenant api key remains the service
  // integration path. Failing both, platform staff may present a break-glass
  // credential scoped to exactly one tenant.
  if (!tenant) {
    const apiKey = tenantApiKeyFromRequest(req);
    tenant = resolveTenantByApiKey(wholeState, apiKey);
    if (tenant) {
      authContext = {
        principalType: "tenant_service",
        tenantId: tenant.tenantId,
        roles: ["tenant_service"],
        actor: tenant.tenantId
      };
    }
  }

  if (!tenant) {
    const resolved = resolveBreakGlass(wholeState, breakGlassKeyFromRequest(req));
    if (resolved) {
      tenant = resolved.tenant;
      breakGlass = resolved.grant;
      authContext = {
        principalType: "platform_staff",
        tenantId: tenant.tenantId,
        staffId: breakGlass.staffId,
        roles: ["break_glass"],
        grantId: breakGlass.grantId
      };
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

  // Resolve sandbox via x-sandbox-name header if called using parent's production API key
  if (tenant && !tenant.isSandbox) {
    const sandboxNameHeader = req.headers["x-sandbox-name"];
    const sandboxName = Array.isArray(sandboxNameHeader) ? sandboxNameHeader[0] : sandboxNameHeader;
    if (sandboxName) {
      const sandboxId = `${tenant.tenantId}_sandbox_${sandboxName}`;
      const sandboxRecord = wholeState.controlPlane.tenants[sandboxId];
      if (sandboxRecord && sandboxRecord.status === "active") {
        tenant = sandboxRecord;
      } else {
        sendJson(res, 404, {
          error: {
            code: "sandbox_not_found",
            message: `The sandbox environment "${sandboxName}" was not found or is inactive.`
          }
        });
        return;
      }
    }
  }
  if (authContext) {
    authContext.effectiveTenantId = tenant.tenantId;
  }

  // Module entitlements: modules default to enabled, so most tenants never hit
  // this gate. A platform admin can narrow a tenant's onboarding to a module
  // subset; requiredModuleForPath() maps the routes that belong to an
  // optional module, and a tenant whose onboarding disabled it is blocked.
  const requiredModule = requiredModuleForPath(path);
  if (requiredModule && !(tenant.onboarding?.enabledModules ?? []).includes(requiredModule)) {
    sendJson(res, 403, {
      error: {
        code: "module_disabled",
        message: `The "${requiredModule}" module is not enabled for this tenant.`
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
    : authContext?.principalType === "tenant_user"
      ? { actor: authContext.userId, actorType: AUDIT_ACTOR_TYPES.TENANT_USER }
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
  const stateRef = {
    get: () => scopedWholeState,
    set: (nextState) => {
      scopedWholeState = nextState;
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

  if (path === "/admin" || path.startsWith("/admin/")) {
    await routeTenantAdmin(req, res, { dataDir, method, path, tenant, authContext, store, stateRef });
    return;
  }

  if (method === "GET" && path === "/document-vault") {
    const state = await store.load();
    const records = listDocumentVaultRecords(state.documentVault, {
      applicationId: url.searchParams.get("applicationId") ?? undefined,
      borrowerId: url.searchParams.get("borrowerId") ?? undefined,
      packetId: url.searchParams.get("packetId") ?? undefined
    });
    sendJson(res, 200, {
      count: records.length,
      records
    });
    return;
  }

  const documentVaultMatch = path.match(/^\/document-vault\/([^/]+)$/);
  if (method === "GET" && documentVaultMatch) {
    const state = await store.load();
    const vaultRecordId = decodeURIComponent(documentVaultMatch[1]);
    const record = state.documentVault?.[vaultRecordId];
    if (!record) {
      sendJson(res, 404, { error: { code: "not_found", message: "Document vault record not found." } });
      return;
    }
    sendJson(res, 200, record);
    return;
  }

  const documentVaultDownloadMatch = path.match(/^\/document-vault\/([^/]+)\/documents\/([^/]+)$/);
  if (method === "GET" && documentVaultDownloadMatch) {
    const state = await store.load();
    const vaultRecordId = decodeURIComponent(documentVaultDownloadMatch[1]);
    const documentId = decodeURIComponent(documentVaultDownloadMatch[2]);
    const record = state.documentVault?.[vaultRecordId];
    if (!record) {
      sendJson(res, 404, { error: { code: "not_found", message: "Document vault record not found." } });
      return;
    }
    const application = state.loanApplications?.[record.applicationId];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Source loan application not found." } });
      return;
    }
    const fullDoc = (application.documentPacket?.documents ?? []).find(d => d.documentId === documentId);
    if (!fullDoc) {
      sendJson(res, 404, { error: { code: "not_found", message: "Document not found in packet." } });
      return;
    }

    const format = url.searchParams.get("format") || req.headers["accept"] || "application/json";
    if (format.includes("application/pdf")) {
      const pdfBuffer = Buffer.from(fullDoc.pdf, "base64");
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": pdfBuffer.length,
        "Content-Disposition": `attachment; filename="${fullDoc.type}.pdf"`
      });
      res.end(pdfBuffer);
      return;
    } else if (format.includes("text/html")) {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(fullDoc.html),
        "Content-Disposition": `inline; filename="${fullDoc.type}.html"`
      });
      res.end(fullDoc.html);
      return;
    }

    sendJson(res, 200, fullDoc);
    return;
  }

  if (method === "GET" && path === "/communications") {
    const state = await store.load();
    const communications = Object.values(state.communications ?? {}).filter((record) =>
      communicationMatchesFilters(record, url)
    );
    sendJson(res, 200, {
      count: communications.length,
      communications
    });
    return;
  }

  if (method === "POST" && path === "/integrations/communications") {
    const body = await readJson(req);
    let payload = null;
    try {
      payload = normalizeCommunicationPayload(body);
    } catch (err) {
      sendJson(res, 422, {
        error: {
          code: "communication_invalid",
          message: err.message
        }
      });
      return;
    }

    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox });
    let dispatch = null;
    try {
      dispatch = await manager.sendCommunication(payload);
    } catch (err) {
      sendJson(res, 422, {
        error: {
          code: "communication_dispatch_failed",
          message: err.message
        }
      });
      return;
    }

    const state = await store.load();
    const record = buildCommunicationRecord(body, payload, dispatch);
    const nextState = appendEvent(
      {
        ...state,
        communications: {
          ...(state.communications ?? {}),
          [record.communicationId]: record
        }
      },
      {
        type: "integration.communication.sent",
        communicationId: record.communicationId,
        channel: record.channel,
        purpose: record.purpose,
        borrowerId: record.borrowerId,
        applicationId: record.applicationId,
        provider: record.provider,
        providerRef: record.providerRef,
        dataResidencyCountry: record.dataResidencyCountry
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { communication: record });
    return;
  }

  if (method === "GET" && path === "/payment-rails") {
    const state = await store.load();
    const paymentRails = Object.values(state.paymentRails ?? {}).filter((record) =>
      paymentRailMatchesFilters(record, url)
    );
    sendJson(res, 200, {
      count: paymentRails.length,
      paymentRails
    });
    return;
  }

  if (method === "POST" && path === "/integrations/payment-rails/nach-mandates") {
    const body = await readJson(req);
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox });
    let providerResult = null;
    try {
      providerResult = await manager.createNachMandate(body);
    } catch (err) {
      sendJson(res, 422, {
        error: {
          code: "payment_rail_nach_mandate_failed",
          message: err.message
        }
      });
      return;
    }

    const state = await store.load();
    const record = buildNachMandateRecord(body, providerResult);
    const nextState = appendEvent(
      {
        ...state,
        paymentRails: {
          ...(state.paymentRails ?? {}),
          [record.paymentRailId]: record
        }
      },
      {
        type: "integration.payment_rail.nach_mandate_registered",
        paymentRailId: record.paymentRailId,
        borrowerId: record.borrowerId,
        loanAccountId: record.loanAccountId,
        applicationId: record.applicationId,
        provider: record.provider,
        providerRef: record.providerRef,
        status: record.status,
        amount: record.maxAmount,
        dataResidencyCountry: record.dataResidencyCountry
      }
    );
    await store.save(nextState);
    sendJson(res, providerResult.success === false ? 422 : 201, { paymentRail: record });
    return;
  }

  if (method === "POST" && path === "/integrations/payment-rails/upi-collects") {
    const body = await readJson(req);
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox });
    let providerResult = null;
    try {
      providerResult = await manager.createUpiCollect(body);
    } catch (err) {
      sendJson(res, 422, {
        error: {
          code: "payment_rail_upi_collect_failed",
          message: err.message
        }
      });
      return;
    }

    const state = await store.load();
    const record = buildUpiCollectRecord(body, providerResult);
    const nextState = appendEvent(
      {
        ...state,
        paymentRails: {
          ...(state.paymentRails ?? {}),
          [record.paymentRailId]: record
        }
      },
      {
        type: "integration.payment_rail.upi_collect_created",
        paymentRailId: record.paymentRailId,
        borrowerId: record.borrowerId,
        loanAccountId: record.loanAccountId,
        applicationId: record.applicationId,
        provider: record.provider,
        providerRef: record.providerRef,
        status: record.status,
        amount: record.amount,
        dataResidencyCountry: record.dataResidencyCountry
      }
    );
    await store.save(nextState);
    sendJson(res, providerResult.success === false ? 422 : 201, { paymentRail: record });
    return;
  }

  if (method === "POST" && path === "/integrations/bank-account-verification") {
    const body = await readJson(req);
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox });
    let verification = null;
    try {
      verification = await manager.verifyBankAccount(body);
    } catch (err) {
      sendJson(res, 422, {
        error: {
          code: "bank_account_verification_failed",
          message: err.message
        }
      });
      return;
    }

    const state = await store.load();
    const nextState = appendEvent(
      state,
      {
        type: "integration.bank_account.verification_completed",
        provider: verification.provider,
        status: verification.status,
        verificationRef: verification.verificationRef ?? null,
        ifsc: verification.ifsc ?? null,
        accountNumberLast4: verification.accountNumberLast4 ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, verification.success ? 200 : 422, { verification });
    return;
  }

  if (method === "POST" && path === "/integrations/credit-bureau") {
    const body = await readJson(req);
    const pan = body.pan;
    if (!pan) {
      sendJson(res, 400, { error: { code: "bad_request", message: "pan is required." } });
      return;
    }
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox });
    let report = null;
    try {
      report = await manager.queryCreditBureau(pan);
    } catch (err) {
      sendJson(res, 422, {
        error: {
          code: "credit_bureau_query_failed",
          message: err.message
        }
      });
      return;
    }

    const state = await store.load();
    const nextState = appendEvent(
      state,
      {
        type: "integration.credit_bureau.query_completed",
        provider: report.provider,
        score: report.score,
        activeAccounts: report.activeAccounts,
        defaultAccounts: report.defaultAccounts,
        dataResidencyCountry: report.dataResidencyCountry
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { report });
    return;
  }

  if (method === "POST" && path === "/integrations/vcip/video-analysis") {
    const body = await readJson(req);
    const { borrowerId, videoHash } = body;
    if (!borrowerId || !videoHash) {
      sendJson(res, 400, { error: { code: "bad_request", message: "borrowerId and videoHash are required." } });
      return;
    }
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox });
    let analysis = null;
    try {
      analysis = await manager.analyzeVcipVideo(borrowerId, videoHash);
    } catch (err) {
      sendJson(res, 422, {
        error: {
          code: "vcip_video_analysis_failed",
          message: err.message
        }
      });
      return;
    }

    const state = await store.load();
    const nextState = appendEvent(
      state,
      {
        type: "integration.vcip.video_analyzed",
        borrowerId: analysis.borrowerId,
        provider: analysis.provider,
        faceMatchScore: analysis.faceMatchScore,
        livenessConfirmed: analysis.livenessConfirmed,
        gps: analysis.gps,
        dataResidencyCountry: analysis.dataResidencyCountry
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { analysis });
    return;
  }

  if (method === "GET" && path === "/sandbox-environments") {
    if (tenant.isSandbox) {
      sendJson(res, 403, {
        error: { code: "sandbox_forbidden", message: "This operation is not permitted within a sandbox environment." }
      });
      return;
    }
    const list = listSandboxes(wholeState, tenant.tenantId);
    sendJson(res, 200, { sandboxes: list });
    return;
  }

  if (method === "POST" && path === "/sandbox-environments") {
    if (tenant.isSandbox) {
      sendJson(res, 403, {
        error: { code: "sandbox_forbidden", message: "This operation is not permitted within a sandbox environment." }
      });
      return;
    }
    const body = await readJson(req);
    const sandboxName = body.sandboxName;
    if (!sandboxName || !/^[a-zA-Z0-9_-]+$/.test(sandboxName)) {
      sendJson(res, 422, {
        error: {
          code: "sandbox_name_invalid",
          message: "A valid sandboxName containing only alphanumeric characters, hyphens, or underscores is required."
        }
      });
      return;
    }
    const sandboxId = `${tenant.tenantId}_sandbox_${sandboxName}`;
    if (wholeState.controlPlane.tenants[sandboxId]) {
      sendJson(res, 409, {
        error: { code: "sandbox_exists", message: "A sandbox environment with this name already exists." }
      });
      return;
    }

    const apiKey = generateApiKey(true);
    const nextState = registerTenant(wholeState, {
      tenantId: sandboxId,
      name: `${tenant.name} (${sandboxName} Sandbox)`,
      apiKey,
      isolationTier: tenant.isolationTier,
      status: "active",
      isSandbox: true,
      parentTenantId: tenant.tenantId,
      sandboxName
    });
    await saveWholeState(nextState, dataDir);
    sendJson(res, 201, {
      sandbox: publicTenant(nextState.controlPlane.tenants[sandboxId]),
      apiKey
    });
    return;
  }

  const sandboxResetMatch = path.match(/^\/sandbox-environments\/([^/]+)\/reset$/);
  if (method === "POST" && sandboxResetMatch) {
    if (tenant.isSandbox) {
      sendJson(res, 403, {
        error: { code: "sandbox_forbidden", message: "This operation is not permitted within a sandbox environment." }
      });
      return;
    }
    const sandboxName = decodeURIComponent(sandboxResetMatch[1]);
    const sandboxId = `${tenant.tenantId}_sandbox_${sandboxName}`;
    const sandboxRecord = wholeState.controlPlane.tenants[sandboxId];
    if (!sandboxRecord || sandboxRecord.status === "offboarded") {
      sendJson(res, 404, { error: { code: "not_found", message: "Sandbox environment not found." } });
      return;
    }
    const body = await readJson(req);
    const preserveConfig = !!body.preserveConfig;
    const nextState = resetSandbox(wholeState, sandboxId, preserveConfig);
    await saveWholeState(nextState, dataDir);
    sendJson(res, 200, {
      message: `Sandbox environment "${sandboxName}" has been reset.`,
      preserveConfig
    });
    return;
  }

  const sandboxDeleteMatch = path.match(/^\/sandbox-environments\/([^/]+)$/);
  if (method === "DELETE" && sandboxDeleteMatch) {
    if (tenant.isSandbox) {
      sendJson(res, 403, {
        error: { code: "sandbox_forbidden", message: "This operation is not permitted within a sandbox environment." }
      });
      return;
    }
    const sandboxName = decodeURIComponent(sandboxDeleteMatch[1]);
    const sandboxId = `${tenant.tenantId}_sandbox_${sandboxName}`;
    const sandboxRecord = wholeState.controlPlane.tenants[sandboxId];
    if (!sandboxRecord || sandboxRecord.status === "offboarded") {
      sendJson(res, 404, { error: { code: "not_found", message: "Sandbox environment not found." } });
      return;
    }
    const nextState = deleteSandbox(wholeState, sandboxId);
    await saveWholeState(nextState, dataDir);
    sendJson(res, 200, {
      message: `Sandbox environment "${sandboxName}" has been deleted.`
    });
    return;
  }

  // "Staff actors" are just tenant login users with a workflow role — there is
  // no separate registry. This read is intentionally not admin-gated (unlike
  // /admin/users): any signed-in tenant user needs to see who they can assign
  // work to, and the projection below excludes admin-sensitive fields
  // (email, adminRoles, credentials) that /admin/users would expose.
  if (method === "GET" && path === "/staff/actors") {
    const state = await store.load();
    sendJson(res, 200, {
      actors: Object.values(state.users)
        .filter((user) => (user.roles ?? []).length > 0)
        .map(publicStaffActorView)
    });
    return;
  }

  const staffActorViewMatch = path.match(/^\/staff\/actors\/([^/]+)$/);
  if (method === "GET" && staffActorViewMatch) {
    const state = await store.load();
    const user = state.users[decodeURIComponent(staffActorViewMatch[1])];
    if (!user || (user.roles ?? []).length === 0) {
      sendJson(res, 404, { error: { code: "not_found", message: "Staff actor not found." } });
      return;
    }
    sendJson(res, 200, publicStaffActorView(user));
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

    if (action !== "assignments") {
      body.actor = resolveSessionActorId(authContext, body.actor);
    }
    const actorPath = action === "assignments" ? "assignedTo" : "actor";
    const actorId = action === "assignments" ? body.assignedTo : body.actor;
    const accessFindings = validateGrievanceOfficerAccess(state.users, actorId, actorPath);
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
    const kycRecords =
      action === "fulfillment"
        ? redactBorrowerKycRecords(state.kycRecords, stored.borrowerId, now)
        : state.kycRecords;
    const beneficialOwners =
      action === "fulfillment"
        ? redactBorrowerBeneficialOwners(state.beneficialOwners, stored.borrowerId, now)
        : state.beneficialOwners;
    const nextState = appendEvent(
      {
        ...state,
        borrowerProfiles,
        kycRecords,
        beneficialOwners,
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

  if (method === "POST" && path === "/data-retention/cleanup") {
    const state = await store.load();
    const now = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const result = executeAutoRetentionCleanup(state, now);

    const nextState = {
      ...state,
      borrowerProfiles: result.borrowerProfiles,
      kycRecords: result.kycRecords,
      beneficialOwners: result.beneficialOwners
    };

    let finalState = nextState;
    for (const event of result.events) {
      finalState = appendEvent(finalState, event);
    }

    await store.save(finalState);
    sendJson(res, 200, {
      cleanedBorrowerIds: result.cleanedBorrowerIds,
      eventCount: result.events.length
    });
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
    if (action === "assignments") {
      body.assignedBy = resolveSessionActorId(authContext, body.assignedBy);
    } else {
      body.actor = resolveSessionActorId(authContext, body.actor);
    }
    const accessFindings =
      action === "assignments"
        ? validateWorkflowAssignmentAccess(state.users, activeTask, body)
        : validateWorkflowActorAccess(state.users, activeTask, body.actor, "actor");
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
    const asOfParam = url.searchParams.get("asOf");
    let productsList = Object.values(state.productPolicies);
    if (asOfParam) {
      const asOfDate = new Date(asOfParam);
      productsList = productsList
        .map((p) => selectProductPolicyVersion(p, asOfDate))
        .filter(Boolean);
    }
    sendJson(res, 200, {
      products: productsList
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
    const result = upsertBorrowerProfile(state.borrowerProfiles, body, new Date(), { isSandbox: tenant.isSandbox });
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
      const isPending = body.status === "pending_verification" || body.requestOtp === true;
      let otp = null;
      let otpVerification = null;
      if (isPending) {
        otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpVerification = {
          otp,
          attempts: 0,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
        };
      }
      const result = upsertConsentRecord(
        state.consentRecords,
        {
          ...body,
          borrowerId,
          status: isPending ? "pending_verification" : (body.status ?? "pending_verification"),
          otpVerification
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
      if (result.summary.status !== "blocked" && isPending) {
        const borrower = state.borrowerProfiles[borrowerId];
        const phone = borrower?.contact?.mobile || "+919999999999";
        const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox });
        try {
          await manager.sendSms(phone, `Your LoanOS Consent Verification OTP is ${otp}`);
        } catch (err) {
          // Ignore SMS dispatch failures in mock/test
        }
      }
      await store.save(nextState);
      sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
      return;
    }
  }

  const consentVerifyMatch = path.match(/^\/borrowers\/([^/]+)\/consents\/([^/]+)\/verify$/);
  if (method === "POST" && consentVerifyMatch) {
    const borrowerId = decodeURIComponent(consentVerifyMatch[1]);
    const consentId = decodeURIComponent(consentVerifyMatch[2]);
    const body = await readJson(req);
    const state = await store.load();
    if (!state.borrowerProfiles[borrowerId]) {
      sendJson(res, 404, { error: { code: "not_found", message: "Borrower not found." } });
      return;
    }
    const consent = state.consentRecords[consentId];
    if (!consent || consent.borrowerId !== borrowerId) {
      sendJson(res, 404, { error: { code: "not_found", message: "Consent record not found." } });
      return;
    }
    if (consent.status !== "pending_verification") {
      sendJson(res, 400, { error: { code: "bad_request", message: "Consent is not in pending_verification status." } });
      return;
    }
    const { otp } = body;
    if (!otp) {
      sendJson(res, 400, { error: { code: "bad_request", message: "otp is required." } });
      return;
    }
    const verification = consent.otpVerification;
    if (!verification) {
      sendJson(res, 422, { error: { code: "verification_failed", message: "No active OTP verification session found." } });
      return;
    }
    if (new Date().toISOString() > verification.expiresAt) {
      sendJson(res, 422, { error: { code: "verification_failed", message: "OTP has expired." } });
      return;
    }
    if (verification.otp !== otp) {
      const attempts = (verification.attempts ?? 0) + 1;
      let updatedConsent;
      if (attempts >= 3) {
        updatedConsent = {
          ...consent,
          status: "revoked",
          revokedAt: new Date().toISOString(),
          otpVerification: null
        };
      } else {
        updatedConsent = {
          ...consent,
          otpVerification: {
            ...verification,
            attempts
          }
        };
      }
      const nextState = appendEvent(
        {
          ...state,
          consentRecords: {
            ...state.consentRecords,
            [consentId]: updatedConsent
          }
        },
        {
          type: "borrower_consent.verification_failed",
          borrowerId,
          consentId,
          attempts
        }
      );
      await store.save(nextState);
      sendJson(res, 422, {
        error: {
          code: "verification_failed",
          message: attempts >= 3 ? "OTP verification locked. Consent revoked." : "Incorrect OTP."
        },
        attemptsRemaining: Math.max(0, 3 - attempts)
      });
      return;
    }
    const updatedConsent = {
      ...consent,
      status: "granted",
      acceptedAt: new Date().toISOString(),
      otpVerification: null
    };
    const nextState = appendEvent(
      {
        ...state,
        consentRecords: {
          ...state.consentRecords,
          [consentId]: updatedConsent
        }
      },
      {
        type: "borrower_consent.verified",
        borrowerId,
        consentId,
        purpose: consent.purpose
      }
    );
    await store.save(nextState);
    sendJson(res, 200, updatedConsent);
    return;
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

  const ckycSearchMatch = path.match(/^\/borrowers\/([^/]+)\/ckyc\/search$/);
  if (ckycSearchMatch) {
    const borrowerId = decodeURIComponent(ckycSearchMatch[1]);
    const state = await store.load();
    if (!state.borrowerProfiles[borrowerId]) {
      sendJson(res, 404, { error: { code: "not_found", message: "Borrower not found." } });
      return;
    }

    if (method === "POST") {
      const body = await readJson(req);
      const result = searchCkyc(scopedWholeState.controlPlane.ckycRegistry, body);
      sendJson(res, result.summary.status === "blocked" ? 422 : 200, result);
      return;
    }
  }

  const ckycDownloadMatch = path.match(/^\/borrowers\/([^/]+)\/ckyc\/download$/);
  if (ckycDownloadMatch) {
    const borrowerId = decodeURIComponent(ckycDownloadMatch[1]);
    const state = await store.load();
    const borrower = state.borrowerProfiles[borrowerId];
    if (!borrower) {
      sendJson(res, 404, { error: { code: "not_found", message: "Borrower not found." } });
      return;
    }

    if (method === "POST") {
      const body = await readJson(req);
      const result = downloadCkycRecord(scopedWholeState.controlPlane.ckycRegistry, body.ckycNumber);
      if (result.summary.status === "blocked") {
        sendJson(res, 422, result);
        return;
      }

      const record = result.record;
      const syncProfileResult = upsertBorrowerProfile(state.borrowerProfiles, {
        ...borrower,
        fullName: record.fullName,
        dateOfBirth: record.dateOfBirth,
        primaryAddress: record.address,
        contact: record.contact,
        status: "active"
      }, new Date(), { isSandbox: tenant.isSandbox });

      const syncKycResult = upsertKycRecord(
        state.kycRecords,
        {
          borrowerId,
          status: "verified",
          method: "ckyc",
          riskCategory: "low",
          verifiedAt: new Date().toISOString(),
          ckycRef: record.ckycNumber
        },
        syncProfileResult.registry
      );

      const nextState = appendEvent(
        {
          ...state,
          borrowerProfiles: syncProfileResult.registry,
          kycRecords: syncKycResult.registry
        },
        {
          type: "borrower.kyc_synced_from_ckyc",
          borrowerId,
          ckycNumber: record.ckycNumber,
          kycRecordId: syncKycResult.kycRecord.kycRecordId
        }
      );

      await store.save(nextState);
      sendJson(res, 200, syncKycResult.kycRecord);
      return;
    }
  }

  const ckycUploadMatch = path.match(/^\/borrowers\/([^/]+)\/ckyc\/upload$/);
  if (ckycUploadMatch) {
    const borrowerId = decodeURIComponent(ckycUploadMatch[1]);
    const state = await store.load();
    const borrower = state.borrowerProfiles[borrowerId];
    if (!borrower) {
      sendJson(res, 404, { error: { code: "not_found", message: "Borrower not found." } });
      return;
    }

    if (method === "POST") {
      const body = await readJson(req);
      const kycRecord = state.kycRecords[body.kycRecordId];
      if (!kycRecord) {
        sendJson(res, 404, { error: { code: "not_found", message: "KYC record not found." } });
        return;
      }
      if (kycRecord.borrowerId !== borrowerId) {
        sendJson(res, 422, { error: { code: "validation_failed", message: "KYC record does not belong to borrower." } });
        return;
      }

      scopedWholeState.controlPlane.ckycRegistry = scopedWholeState.controlPlane.ckycRegistry ?? {};

      const result = uploadCkycRecord(scopedWholeState.controlPlane.ckycRegistry, borrower, kycRecord);
      if (result.summary.status === "blocked") {
        sendJson(res, 422, result);
        return;
      }

      const updatedKyc = {
        ...kycRecord,
        ckycRef: result.ckycNumber
      };

      const nextState = appendEvent(
        {
          ...state,
          kycRecords: {
            ...state.kycRecords,
            [kycRecord.kycRecordId]: updatedKyc
          }
        },
        {
          type: "borrower.kyc_uploaded_to_ckyc",
          borrowerId,
          ckycNumber: result.ckycNumber,
          kycRecordId: kycRecord.kycRecordId
        }
      );

      await store.save(nextState);
      sendJson(res, 200, { success: true, ckycNumber: result.ckycNumber, kycRecord: updatedKyc });
      return;
    }
  }

  const vcipEvidenceMatch = path.match(/^\/borrowers\/([^/]+)\/vcip\/evidence$/);
  if (vcipEvidenceMatch) {
    const borrowerId = decodeURIComponent(vcipEvidenceMatch[1]);
    const state = await store.load();
    const borrower = state.borrowerProfiles[borrowerId];
    if (!borrower) {
      sendJson(res, 404, { error: { code: "not_found", message: "Borrower not found." } });
      return;
    }

    if (method === "POST") {
      const body = await readJson(req);
      const officialId = body.vCip?.officialActorId;
      const official = state.users?.[officialId];
      if (!official) {
        sendJson(res, 422, {
          summary: { status: "blocked", errors: 1 },
          findings: [{
            level: "error",
            controlId: "RBI-KYC-2016",
            message: `Official actor '${officialId}' not found.`,
            path: "vCip.officialActorId"
          }]
        });
        return;
      }
      if (official.status !== "active") {
        sendJson(res, 422, {
          summary: { status: "blocked", errors: 1 },
          findings: [{
            level: "error",
            controlId: "RBI-KYC-2016",
            message: `Official actor '${officialId}' is not active.`,
            path: "vCip.officialActorId"
          }]
        });
        return;
      }
      const hasCorrectRole = official.roles && (official.roles.includes("kyc_officer") || official.roles.includes("credit_officer") || official.roles.includes("compliance_analyst"));
      if (!hasCorrectRole) {
        sendJson(res, 422, {
          summary: { status: "blocked", errors: 1 },
          findings: [{
            level: "error",
            controlId: "RBI-KYC-2016",
            message: `Official actor '${officialId}' does not have kyc_officer, credit_officer, or compliance_analyst role.`,
            path: "vCip.officialActorId"
          }]
        });
        return;
      }

      let existingKyc = Object.values(state.kycRecords).find(k => k.borrowerId === borrowerId);
      const kycInput = {
        ...(existingKyc || {}),
        borrowerId,
        status: "verified",
        method: "vcip",
        verifiedAt: new Date().toISOString(),
        vCip: {
          used: true,
          storageCountry: body.vCip?.storageCountry,
          videoRecordingHash: body.vCip?.videoRecordingHash,
          recordingTimestamp: body.vCip?.recordingTimestamp || new Date().toISOString(),
          gpsCoordinates: body.vCip?.gpsCoordinates,
          panVerificationRef: body.vCip?.panVerificationRef,
          livenessConfirmed: body.vCip?.livenessConfirmed,
          faceMatchScore: body.vCip?.faceMatchScore,
          officialActorId: body.vCip?.officialActorId,
          signedByOfficial: body.vCip?.signedByOfficial
        }
      };

      const result = upsertKycRecord(state.kycRecords, kycInput, state.borrowerProfiles);
      if (result.summary.status === "blocked") {
        sendJson(res, 422, result);
        return;
      }

      const nextState = appendEvent(
        {
          ...state,
          kycRecords: {
            ...state.kycRecords,
            [result.kycRecord.kycRecordId]: result.kycRecord
          }
        },
        {
          type: "borrower.vcip_evidence_recorded",
          borrowerId,
          kycRecordId: result.kycRecord.kycRecordId,
          vCip: result.kycRecord.vCip
        }
      );

      await store.save(nextState);
      sendJson(res, 201, { success: true, kycRecord: result.kycRecord });
      return;
    }

    if (method === "GET") {
      const kycRecord = Object.values(state.kycRecords).find(k => k.borrowerId === borrowerId && k.method === "vcip");
      if (!kycRecord) {
        sendJson(res, 404, { error: { code: "not_found", message: "V-CIP evidence not found for borrower." } });
        return;
      }
      sendJson(res, 200, { vCip: kycRecord.vCip });
      return;
    }
  }

  if (method === "POST" && path === "/loans/applications") {
    const body = await readJson(req);
    const state = await store.load();
    const borrower = state.borrowerProfiles?.[body.borrowerId];
    const pan = borrower?.pan || "ABCDE1234F";
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox });
    let bureauReport = null;
    try {
      bureauReport = await manager.queryCreditBureau(pan);
    } catch (err) {
      if (err.message.includes("data residency") || err.message.includes("residency")) {
        sendJson(res, 422, {
          error: {
            code: "credit_bureau_query_failed",
            message: err.message
          }
        });
        return;
      }
      // Ignore other query errors (thin-file behavior)
    }
    const application = {
      ...body,
      applicationId: body.applicationId ?? createLoanId("app"),
      status: "application_received",
      createdAt: new Date().toISOString(),
      bureauReport
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

  if (method === "POST" && path === "/loans/marketplace-offers") {
    const body = await readJson(req);
    const state = await store.load();

    const activePartnerLenderIds = Object.values(state.lendingServiceProviders ?? {})
      .filter((lsp) => lsp.lspId === body.lspId && lsp.status === "active")
      .map((lsp) => lsp.regulatedEntityId);

    const validation = validateMarketplaceNeutrality(body, activePartnerLenderIds);
    const offers = rankMarketplaceOffers(body.offers ?? [], body.rankingCriteria ?? "lowest_apr");

    const record = {
      marketplaceOfferId: body.marketplaceOfferId ?? createLoanId("mko"),
      lspId: body.lspId,
      dlaId: body.dlaId,
      offers,
      rankingCriteria: body.rankingCriteria,
      disclosureRef: body.disclosureRef,
      partnerLendersDisclosureRef: body.partnerLendersDisclosureRef,
      darkPatternCheck: body.darkPatternCheck,
      compliance: validation,
      createdAt: new Date().toISOString()
    };

    const nextState = appendEvent(
      {
        ...state,
        marketplaceOffers: {
          ...(state.marketplaceOffers ?? {}),
          [record.marketplaceOfferId]: record
        }
      },
      {
        type: "marketplace.offers.evaluated",
        marketplaceOfferId: record.marketplaceOfferId,
        status: validation.summary.status
      }
    );

    await store.save(nextState);
    sendJson(res, validation.summary.status === "blocked" ? 422 : 201, record);
    return;
  }

  const marketplaceOffersMatch = path.match(/^\/loans\/marketplace-offers\/([^/]+)$/);
  if (method === "GET" && marketplaceOffersMatch) {
    const state = await store.load();
    const record = state.marketplaceOffers?.[marketplaceOffersMatch[1]];
    if (!record) {
      sendJson(res, 404, { error: { code: "not_found", message: "Marketplace offers not found." } });
      return;
    }
    sendJson(res, 200, record);
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
    const borrower = state.borrowerProfiles?.[application.borrowerId];
    const pan = borrower?.pan || "ABCDE1234F";
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox });
    let bureauReport = null;
    try {
      bureauReport = await manager.queryCreditBureau(pan);
    } catch (err) {
      if (err.message.includes("data residency") || err.message.includes("residency")) {
        sendJson(res, 422, {
          error: {
            code: "credit_bureau_query_failed",
            message: err.message
          }
        });
        return;
      }
      // Allow query failures to fall back to a null report (thin-file behavior)
    }
    const appWithBureau = {
      ...application,
      bureauReport
    };
    const eligibility = evaluateEligibility(appWithBureau);
    const stored = {
      ...appWithBureau,
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

    const resolvedProposer = resolveSessionActorId(authContext, body.proposedBy ?? body.decidedBy);
    body.proposedBy = resolvedProposer;
    body.decidedBy = resolvedProposer;
    if (body.manualUnderwriting?.underwriterId !== undefined) {
      body.manualUnderwriting = {
        ...body.manualUnderwriting,
        underwriterId: resolveSessionActorId(authContext, body.manualUnderwriting.underwriterId)
      };
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
      ...validateDecisionProposalAccess(state.users, body),
      ...(requiresUnderwriterAccessCheck ? validateManualUnderwritingAccess(state.users, body) : [])
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
    const activeTasks = deriveWorkflowTasks(state);
    const kfsCheck = validateKfsBeforeDecision(application);
    // An ineligible borrower cannot be approved; declines still proceed with the
    // assessment stored as evidence.
    const eligibilityFindings = body.status === "approved" ? eligibility.findings : [];
    const findings = [...preDecision.findings, ...kfsCheck.findings, ...eligibilityFindings];
    const proposal = proposeDecision(decisionApplication, body, findings, { modelRegistry: state.modelRegistry, activeTasks });
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
    let nextWorkflowTasks = state.workflowTasks;
    const task = activeTasks.find((t) => t.entity.type === "loan_application" && t.entity.id === application.applicationId && t.type === "application.manual_underwriting");
    if (task) {
      const completeRes = completeWorkflowTask(
        state.workflowTasks,
        task.taskId,
        { actor: body.proposedBy || body.decidedBy },
        activeTasks
      );
      if (completeRes.summary.status !== "blocked") {
        nextWorkflowTasks = completeRes.workflowTasks;
      }
    }

    const nextState = appendEvent(
      {
        ...state,
        loanApplications: {
          ...state.loanApplications,
          [stored.applicationId]: stored
        },
        workflowTasks: nextWorkflowTasks
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

    body.reviewedBy = resolveSessionActorId(authContext, body.reviewedBy);
    const accessFindings = validateHumanReviewAccess(state.users, body);
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

    body.approvedBy = resolveSessionActorId(authContext, body.approvedBy);
    const accessFindings = validateDecisionApprovalAccess(state.users, body);
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
      const actorId = resolveSessionActorId(authContext, body.actor ?? body.generatedBy);
      body.actor = actorId;
      body.generatedBy = actorId;
      const accessFindings = validateDocumentPacketAccess(state.users, actorId, "actor");
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

    const actorId = resolveSessionActorId(authContext, body.actor ?? body.deliveredBy);
    body.actor = actorId;
    body.deliveredBy = actorId;
    const accessFindings = validateDocumentPacketAccess(state.users, actorId, "actor");
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

  const documentPacketEsignMatch = path.match(/^\/loans\/applications\/([^/]+)\/document-packet\/esign$/);
  if (method === "POST" && documentPacketEsignMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = state.loanApplications[decodeURIComponent(documentPacketEsignMatch[1])];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
      return;
    }

    const { aadhaarNumber, otp, signerName } = body;
    if (!aadhaarNumber || !otp || !signerName) {
      sendJson(res, 400, { error: { code: "bad_request", message: "aadhaarNumber, otp, and signerName are required." } });
      return;
    }

    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox });
    let esignResult = null;
    try {
      const payloadHash = (application.documentPacket?.documents ?? []).map(d => d.checksumSha256).join(",");
      esignResult = await manager.verifyEsignOtp(aadhaarNumber, otp, payloadHash);
    } catch (err) {
      sendJson(res, 422, {
        error: {
          code: "esign_verification_failed",
          message: err.message
        }
      });
      return;
    }

    const signResult = signDocumentPacket(application, {
      aadhaarNumber,
      signerName,
      signatureRef: esignResult.signatureRef,
      esignProvider: esignResult.esignProvider,
      envelopeId: esignResult.envelopeId,
      externalEnvelopeStorageUrl: esignResult.externalEnvelopeStorageUrl
    });

    if (signResult.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "document_packet_signing_blocked",
          message: "Document packet signing is blocked by workflow findings."
        },
        findings: signResult.findings
      });
      return;
    }

    const stored = {
      ...application,
      documentPacket: signResult.packet
    };
    const vaultResult = vaultDocumentPacket(state.documentVault, stored, signResult.packet, {
      vaultedBy: body.actor ?? "esign",
      retentionPolicyId: body.retentionPolicyId ?? undefined,
      storageCountry: body.storageCountry ?? undefined
    });
    if (vaultResult.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "document_vault_blocked",
          message: "Signed document packet could not be vaulted."
        },
        findings: vaultResult.findings
      });
      return;
    }
    const stateWithSignedPacket = {
      ...state,
      loanApplications: {
        ...state.loanApplications,
        [stored.applicationId]: stored
      },
      documentVault: vaultResult.registry
    };
    const nextState = appendEvent(
      appendEvent(
        stateWithSignedPacket,
        {
          type: "loan.document_packet.signed",
          applicationId: stored.applicationId,
          packetId: signResult.packet.packetId,
          signatureRef: esignResult.signatureRef,
          signerName,
          vaultRecordId: vaultResult.record.vaultRecordId
        }
      ),
      {
        type: "document_vault.packet_vaulted",
        applicationId: stored.applicationId,
        packetId: signResult.packet.packetId,
        vaultRecordId: vaultResult.record.vaultRecordId,
        documentCount: vaultResult.record.documentCount,
        manifestChecksumSha256: vaultResult.record.manifestChecksumSha256
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

    body.assignedBy = resolveSessionActorId(authContext, body.assignedBy);
    const accessFindings = validateRecoveryAssignmentAccess(state.users, body);
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

    body.approvedBy = resolveSessionActorId(authContext, body.approvedBy);
    const accessFindings = validateCashRecoveryApprovalAccess(state.users, body);
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
      foreclosureChargeName: url.searchParams.get("foreclosureChargeName") ?? undefined,
      foreclosureChargeAmount: url.searchParams.get("foreclosureChargeAmount") ? Number(url.searchParams.get("foreclosureChargeAmount")) : undefined
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
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, {
      ...loanAccount,
      summary: summarizeLoanAccount(loanAccount, asOf)
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
    const cersaiCheck = validateCersaiForDisbursement(application, state);
    const findings = [...result.findings, ...documentPacketCheck.findings, ...cersaiCheck.findings];
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

  // --- CERSAI security-interest registration (SARFAESI Act) ---
  const securityInterestListMatch = path.match(/^\/loan-accounts\/([^/]+)\/security-interests$/);
  if (method === "GET" && securityInterestListMatch) {
    const state = await store.load();
    const loanAccountId = decodeURIComponent(securityInterestListMatch[1]);
    const now = new Date();
    const securityInterests = listSecurityInterests(state.securityInterests, loanAccountId).map((si) =>
      enrichSecurityInterest(si, now)
    );
    sendJson(res, 200, { count: securityInterests.length, securityInterests });
    return;
  }

  if (method === "POST" && securityInterestListMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const loanAccountId = decodeURIComponent(securityInterestListMatch[1]);
    const result = createSecurityInterest(state.securityInterests, { ...body, loanAccountId }, state);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "security_interest_invalid", message: "Security interest is invalid." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      { ...state, securityInterests: result.registry },
      {
        type: "cersai.security_interest.created",
        securityInterestId: result.securityInterest.securityInterestId,
        loanAccountId,
        actor: body.createdBy ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { securityInterest: result.securityInterest, event: result.event });
    return;
  }

  const securityInterestActionMatch = path.match(
    /^\/loan-accounts\/([^/]+)\/security-interests\/([^/]+)\/(filing|registration|modification|satisfaction)$/
  );
  if (method === "POST" && securityInterestActionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const siId = decodeURIComponent(securityInterestActionMatch[2]);
    const action = securityInterestActionMatch[3];
    const si = state.securityInterests[siId];
    if (!si) {
      sendJson(res, 404, { error: { code: "not_found", message: "Security interest not found." } });
      return;
    }
    let externalResult = {};
    if (action === "filing") {
      const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox });
      try {
        externalResult = await manager.fileCersaiSecurityInterest({
          securityInterestId: si.securityInterestId,
          loanAccountId: si.loanAccountId,
          assetType: si.assetType,
          chargeType: si.chargeType,
          chargeAmountInr: si.chargeAmountInr
        });
      } catch (err) {
        sendJson(res, 422, {
          error: {
            code: "security_interest_action_blocked",
            message: `CERSAI filing failed: ${err.message}`
          }
        });
        return;
      }
    }

    const now = new Date();
    const result =
      action === "filing"
        ? fileSecurityInterest(si, { ...body, cersaiTransactionId: externalResult.cersaiTransactionId }, state, now)
        : action === "registration"
          ? registerSecurityInterest(si, body, state, now)
          : action === "modification"
            ? modifySecurityInterest(si, body, state, now)
            : satisfySecurityInterest(si, body, state, now);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "security_interest_action_blocked", message: "Security interest action is blocked." },
        findings: result.findings
      });
      return;
    }
    const stored = result.securityInterest;
    const nextState = appendEvent(
      { ...state, securityInterests: { ...state.securityInterests, [stored.securityInterestId]: stored } },
      {
        type: result.event.type,
        securityInterestId: stored.securityInterestId,
        loanAccountId: stored.loanAccountId,
        actor: body.actor ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { securityInterest: stored, event: result.event });
    return;
  }

  if (method === "GET" && path === "/cersai/search") {
    const state = await store.load();
    const assetDescription = url.searchParams.get("asset") ?? "";
    const search = searchCersaiCharges(assetDescription, state);
    sendJson(res, 200, { assetDescription, ...search });
    return;
  }

  // --- DPDP data-principal access and correction rights ---
  const accessListMatch = path.match(/^\/borrowers\/([^/]+)\/access-requests$/);
  if (method === "GET" && accessListMatch) {
    const state = await store.load();
    const borrowerId = decodeURIComponent(accessListMatch[1]);
    const now = new Date();
    const requests = Object.values(state.accessRequests)
      .filter((r) => r.borrowerId === borrowerId)
      .map((r) => enrichAccessRequest(r, state, now));
    sendJson(res, 200, { count: requests.length, accessRequests: requests });
    return;
  }

  if (method === "POST" && accessListMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const borrowerId = decodeURIComponent(accessListMatch[1]);
    const result = createAccessRequest(state.accessRequests, { ...body, borrowerId }, state);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "access_request_invalid", message: "Access request is invalid." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      { ...state, accessRequests: result.registry },
      {
        type: "data_principal.access_request.created",
        accessRequestId: result.request.accessRequestId,
        borrowerId,
        actor: body.requestedBy ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { accessRequest: result.request, event: result.event });
    return;
  }

  const accessFulfillMatch = path.match(/^\/borrowers\/([^/]+)\/access-requests\/([^/]+)\/fulfillment$/);
  if (method === "POST" && accessFulfillMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const reqId = decodeURIComponent(accessFulfillMatch[2]);
    const request = state.accessRequests[reqId];
    if (!request) {
      sendJson(res, 404, { error: { code: "not_found", message: "Access request not found." } });
      return;
    }
    const result = fulfillAccessRequest(request, body, state);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "access_request_action_blocked", message: "Access request fulfilment is blocked." },
        findings: result.findings
      });
      return;
    }
    const stored = result.request;
    const nextState = appendEvent(
      { ...state, accessRequests: { ...state.accessRequests, [stored.accessRequestId]: stored } },
      {
        type: "data_principal.access_request.fulfilled",
        accessRequestId: stored.accessRequestId,
        borrowerId: stored.borrowerId,
        actor: body.actor ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { accessRequest: stored, event: result.event });
    return;
  }

  const correctionListMatch = path.match(/^\/borrowers\/([^/]+)\/correction-requests$/);
  if (method === "GET" && correctionListMatch) {
    const state = await store.load();
    const borrowerId = decodeURIComponent(correctionListMatch[1]);
    const now = new Date();
    const requests = Object.values(state.correctionRequests)
      .filter((r) => r.borrowerId === borrowerId)
      .map((r) => enrichCorrectionRequest(r, now));
    sendJson(res, 200, { count: requests.length, correctionRequests: requests });
    return;
  }

  if (method === "POST" && correctionListMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const borrowerId = decodeURIComponent(correctionListMatch[1]);
    const result = createCorrectionRequest(state.correctionRequests, { ...body, borrowerId }, state);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "correction_request_invalid", message: "Correction request is invalid." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      { ...state, correctionRequests: result.registry },
      {
        type: "data_principal.correction_request.created",
        correctionRequestId: result.request.correctionRequestId,
        borrowerId,
        actor: body.requestedBy ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { correctionRequest: result.request, event: result.event });
    return;
  }

  const correctionReviewMatch = path.match(/^\/borrowers\/([^/]+)\/correction-requests\/([^/]+)\/review$/);
  if (method === "POST" && correctionReviewMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const reqId = decodeURIComponent(correctionReviewMatch[2]);
    const request = state.correctionRequests[reqId];
    if (!request) {
      sendJson(res, 404, { error: { code: "not_found", message: "Correction request not found." } });
      return;
    }
    const result = reviewCorrectionRequest(request, body, state);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "correction_request_action_blocked", message: "Correction review is blocked." },
        findings: result.findings
      });
      return;
    }
    const stored = result.request;
    // When applied, propagate the corrected value into the borrower profile.
    let borrowerProfiles = state.borrowerProfiles;
    if (result.profileUpdate && state.borrowerProfiles[result.profileUpdate.borrowerId]) {
      borrowerProfiles = {
        ...state.borrowerProfiles,
        [result.profileUpdate.borrowerId]: setFieldPath(
          state.borrowerProfiles[result.profileUpdate.borrowerId],
          result.profileUpdate.fieldPath,
          result.profileUpdate.newValue
        )
      };
    }
    const nextState = appendEvent(
      {
        ...state,
        borrowerProfiles,
        correctionRequests: { ...state.correctionRequests, [stored.correctionRequestId]: stored }
      },
      {
        type: result.event.type,
        correctionRequestId: stored.correctionRequestId,
        borrowerId: stored.borrowerId,
        actor: body.actor ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { correctionRequest: stored, event: result.event, profileUpdate: result.profileUpdate });
    return;
  }

  // --- FIU-IND suspicious/cash transaction reporting (PMLA) ---
  if (method === "GET" && path === "/fiu/reports") {
    const state = await store.load();
    const filters = {
      reportType: url.searchParams.get("reportType") ?? undefined,
      subjectBorrowerId: url.searchParams.get("subjectBorrowerId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined
    };
    const now = new Date();
    const reports = listFiuReports(state.fiuReports, filters).map((r) => enrichFiuReport(r, now));
    sendJson(res, 200, { count: reports.length, reports });
    return;
  }

  if (method === "POST" && path === "/fiu/reports") {
    const body = await readJson(req);
    const state = await store.load();
    const result = createFiuReport(state.fiuReports, body, state);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "fiu_report_invalid", message: "FIU report is invalid." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      { ...state, fiuReports: result.registry },
      {
        type: result.event.type,
        reportId: result.report.reportId,
        reportType: result.report.reportType,
        actor: body.createdBy ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { report: result.report, event: result.event });
    return;
  }

  const fiuReportMatch = path.match(/^\/fiu\/reports\/([^/]+)$/);
  if (method === "GET" && fiuReportMatch) {
    const state = await store.load();
    const report = state.fiuReports[decodeURIComponent(fiuReportMatch[1])];
    if (!report) {
      sendJson(res, 404, { error: { code: "not_found", message: "FIU report not found." } });
      return;
    }
    sendJson(res, 200, enrichFiuReport(report, new Date()));
    return;
  }

  const fiuReportActionMatch = path.match(/^\/fiu\/reports\/([^/]+)\/(review|filing)$/);
  if (method === "POST" && fiuReportActionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const reportId = decodeURIComponent(fiuReportActionMatch[1]);
    const action = fiuReportActionMatch[2];
    const report = state.fiuReports[reportId];
    if (!report) {
      sendJson(res, 404, { error: { code: "not_found", message: "FIU report not found." } });
      return;
    }
    let externalResult = {};
    if (action === "filing") {
      const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox });
      try {
        externalResult = await manager.fileFiuReport({
          reportId: report.reportId,
          reportType: report.reportType,
          subjectBorrowerId: report.subjectBorrowerId,
          totalAmountInr: report.totalAmountInr
        });
      } catch (err) {
        sendJson(res, 422, {
          error: {
            code: "fiu_report_action_blocked",
            message: `FIU-IND filing failed: ${err.message}`
          }
        });
        return;
      }
    }

    const now = new Date();
    const result = action === "review"
      ? reviewFiuReport(report, body, state, now)
      : fileFiuReport(report, { ...body, fiuAcknowledgementId: externalResult.fiuAcknowledgementId }, state, now);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "fiu_report_action_blocked", message: "FIU report action is blocked." },
        findings: result.findings
      });
      return;
    }
    const stored = result.report;
    const nextState = appendEvent(
      { ...state, fiuReports: { ...state.fiuReports, [stored.reportId]: stored } },
      {
        type: result.event.type,
        reportId: stored.reportId,
        actor: body.actor ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { report: stored, event: result.event });
    return;
  }

  sendJson(res, 404, {
    error: {
      code: "not_found",
      message: "Route not found."
    }
  });
}

// Sets a (possibly dotted) field path on a shallow clone of an object.
function setFieldPath(obj, path, value) {
  const keys = String(path).split(".");
  const root = { ...obj };
  let cursor = root;
  for (let i = 0; i < keys.length - 1; i += 1) {
    cursor[keys[i]] = { ...(cursor[keys[i]] ?? {}) };
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
  return root;
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

function sessionTokenFromRequest(req) {
  const cookieHeader = req.headers["cookie"];
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader ?? "";
  for (const part of raw.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return null;
}

function cookieSecureAttribute() {
  const flag = (process.env.LOANOS_COOKIE_SECURE ?? "").toLowerCase();
  return flag === "true" || process.env.NODE_ENV === "production" ? "; Secure" : "";
}

function sessionCookie(token, expiresAt) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${cookieSecureAttribute()}; Expires=${new Date(expiresAt).toUTCString()}`;
}

function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${cookieSecureAttribute()}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

// Compares via fixed-length SHA-256 digests rather than the raw strings so a
// length mismatch can't short-circuit the byte-by-byte compare — the
// platform admin key is the one secret in this codebase that was still using
// plain `===`, which leaks comparison timing an attacker could use to guess
// the key byte-by-byte.
function timingSafeStringEqual(a, b) {
  const digestA = createHash("sha256").update(String(a ?? "")).digest();
  const digestB = createHash("sha256").update(String(b ?? "")).digest();
  return timingSafeEqual(digestA, digestB);
}

async function platformAuthFromRequest(req, dataDir, platformAdminKey) {
  const key = platformAdminKeyFromRequest(req);
  if (platformAdminKey && key && timingSafeStringEqual(key, platformAdminKey)) {
    return {
      authContext: {
        principalType: "platform_key",
        userId: "platform_admin_key",
        displayName: "Platform admin key",
        roles: ["platform_admin", "tenant_provisioner", "security_admin", "auditor"]
      }
    };
  }
  const state = await loadWholeState(dataDir);
  const resolved = resolveSession(state, sessionTokenFromRequest(req));
  if (resolved?.session?.principalType !== "platform_user") {
    return { authContext: null };
  }
  return {
    authContext: {
      principalType: "platform_user",
      userId: resolved.user.userId,
      email: resolved.user.email,
      displayName: resolved.user.displayName,
      roles: resolved.user.roles ?? [],
      sessionId: resolved.session.sessionId
    },
    session: resolved.session
  };
}

// Binds a request's "acting staff member" field to the authenticated
// session's own login identity (userId), rather than trusting whatever actor
// id the client sent in the body. Without this, a logged-in tenant user could
// name any other staff member (propose as one, approve as another) and defeat
// maker-checker four-eyes controls that only check the *named* user's role,
// not who is actually logged in. Service-key and break-glass callers have no
// personal session identity, so their explicit actor fields are trusted as
// before — this only tightens interactive human logins.
function resolveSessionActorId(authContext, providedActorId) {
  if (authContext?.principalType === "tenant_user") {
    return authContext.userId ?? null;
  }
  return providedActorId ?? null;
}

function requiredModuleForPath(path) {
  if (path.startsWith("/ai/")) return "ai_governance";
  if (path.startsWith("/integrations/")) return "integrations";
  if (path === "/recovery-agents" || path.startsWith("/recovery-agents/")) return "collections";
  if (path === "/loans/marketplace-offers" || path.startsWith("/loans/marketplace-offers/")) return "marketplace";
  return null;
}

// Decides whether a freshly-authenticated user gets a full session or one
// restricted to finishing an outstanding required action. MFA setup takes
// priority over a forced password change so a user isn't asked to rotate a
// password they're about to be told to re-enter anyway during enrollment.
function sessionRestriction(user) {
  if (user.mfaRequired && !user.mfaEnabled) return "mfa_setup";
  if (user.mustChangePassword) return "password_change";
  return null;
}

// Paths a restricted session may still reach — just enough to resolve the
// outstanding action (and to log out). Everything else 403s with the reason,
// so the client can route the user to the right screen instead of guessing.
const RESTRICTED_SESSION_ALLOWED_PATHS = new Set([
  "/auth/me",
  "/auth/logout",
  "/auth/password",
  "/auth/mfa/setup",
  "/auth/mfa/enable"
]);

// Clears a session's restriction once its matching required action resolves,
// so the same session becomes fully usable without forcing a re-login.
function clearSessionRestriction(sessions, sessionId, expectedReason) {
  const session = sessions[sessionId];
  if (!session || session.restricted !== expectedReason) return sessions;
  return { ...sessions, [sessionId]: { ...session, restricted: null } };
}

// A password change is a credential rotation: every *other* session for this
// user is revoked (the whole point of rotating is to invalidate whatever a
// leaked old password could still reach), while the session that performed
// the change is kept alive with its restriction cleared.
function clearSessionRestrictionAndRevokeOthers(sessions, userId, currentSessionId, expectedReason) {
  const now = new Date();
  const next = {};
  for (const [id, session] of Object.entries(sessions)) {
    if (session.userId !== userId) {
      next[id] = session;
      continue;
    }
    if (id === currentSessionId) {
      next[id] = session.restricted === expectedReason ? { ...session, restricted: null } : session;
      continue;
    }
    next[id] = session.status === "active" ? { ...session, status: "revoked", revokedAt: now.toISOString() } : session;
  }
  return next;
}

function rejectIfRestricted(res, session, path) {
  if (!session?.restricted || RESTRICTED_SESSION_ALLOWED_PATHS.has(path)) {
    return false;
  }
  sendJson(res, 403, {
    error: {
      code: "session_restricted",
      message:
        session.restricted === "mfa_setup"
          ? "MFA enrollment is required before this session can be used."
          : "A password change is required before this session can be used.",
      reason: session.restricted
    }
  });
  return true;
}

function authActor(authContext) {
  return authContext?.userId
    ?? authContext?.staffId
    ?? authContext?.actor
    ?? "system";
}

// A non-admin-safe projection of a tenant login user's workflow-facing
// identity — used by GET /staff/actors so any signed-in user can see who they
// can assign work to, without exposing email/adminRoles/credentials.
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

function publicAuthContext(authContext) {
  if (!authContext) return null;
  const { sessionId, ...rest } = authContext;
  return rest;
}

function mergeOnboardingConfig(input, patch) {
  return {
    ...(input ?? {}),
    productIds: [
      ...new Set([
        ...((input?.productIds && Array.isArray(input.productIds)) ? input.productIds : []),
        ...((patch?.productIds && Array.isArray(patch.productIds)) ? patch.productIds : [])
      ])
    ],
    primaryRegulatedEntityId:
      input?.primaryRegulatedEntityId ?? patch?.primaryRegulatedEntityId ?? null
  };
}

function validationErrorPayload(code, message, findings, context = {}) {
  return {
    error: { code, message },
    findings,
    ...context
  };
}

function provisionTenantSetup(state, tenantId, body, authContext, now = new Date()) {
  let tenantData = state.tenants[tenantId] ?? createEmptyTenantData();
  const seeded = {
    regulatedEntity: null,
    products: []
  };
  const actor = authActor(authContext);

  if (body.regulatedEntity) {
    const reResult = upsertRegulatedEntity(tenantData.regulatedEntities, body.regulatedEntity, now);
    if (reResult.summary.status === "blocked") {
      return {
        ok: false,
        statusCode: 422,
        payload: validationErrorPayload(
          "onboarding_regulated_entity_invalid",
          "The regulated entity profile is incomplete or non-compliant.",
          reResult.findings,
          { summary: reResult.summary }
        )
      };
    }
    seeded.regulatedEntity = reResult.entity;
    tenantData = appendEvent(
      {
        ...tenantData,
        regulatedEntities: reResult.registry
      },
      {
        type: "tenant_onboarding.regulated_entity_seeded",
        regulatedEntityId: reResult.entity.regulatedEntityId,
        actor
      },
      now
    );
  }

  const productInputs = Array.isArray(body.products) ? body.products : [];
  for (const inputProduct of productInputs) {
    const productInput = {
      ...inputProduct,
      regulatedEntityId:
        inputProduct.regulatedEntityId ??
        seeded.regulatedEntity?.regulatedEntityId ??
        body.onboarding?.primaryRegulatedEntityId
    };
    const productResult = upsertProductPolicy(tenantData.productPolicies, productInput, tenantData.regulatedEntities, now);
    if (productResult.summary.status === "blocked") {
      return {
        ok: false,
        statusCode: 422,
        payload: validationErrorPayload(
          "onboarding_product_invalid",
          `The product policy ${productInput.productCode ?? productInput.productId ?? ""} is incomplete or non-compliant.`.trim(),
          productResult.findings,
          { product: productResult.product, summary: productResult.summary }
        )
      };
    }
    seeded.products.push(productResult.product);
    tenantData = appendEvent(
      {
        ...tenantData,
        productPolicies: productResult.registry
      },
      {
        type: "tenant_onboarding.product_seeded",
        productId: productResult.product.productId,
        productCode: productResult.product.productCode,
        regulatedEntityId: productResult.product.regulatedEntityId,
        actor
      },
      now
    );
  }

  const sealedTenantData = {
    ...tenantData,
    events: sealAuditChain(
      stampAuditEvents(tenantData.events, { actor, actorType: AUDIT_ACTOR_TYPES.PLATFORM_STAFF }),
      tenantId
    )
  };
  const seededState = setTenantData(state, tenantId, sealedTenantData);
  const onboarding = mergeOnboardingConfig(body.onboarding, {
    primaryRegulatedEntityId: seeded.regulatedEntity?.regulatedEntityId,
    productIds: seeded.products.map((product) => product.productId)
  });
  const nextState = registerTenant(
    seededState,
    {
      tenantId,
      name: state.controlPlane.tenants[tenantId]?.name,
      isolationTier: state.controlPlane.tenants[tenantId]?.isolationTier,
      status: state.controlPlane.tenants[tenantId]?.status,
      isSandbox: state.controlPlane.tenants[tenantId]?.isSandbox,
      parentTenantId: state.controlPlane.tenants[tenantId]?.parentTenantId,
      sandboxName: state.controlPlane.tenants[tenantId]?.sandboxName,
      onboarding
    },
    now
  );

  return {
    ok: true,
    state: nextState,
    seeded
  };
}

async function routeAuth(req, res, { dataDir, method, path }) {
  if (method === "POST" && path === "/auth/login") {
    const body = await readJson(req);
    const scope = body.scope === "platform" ? "platform" : "tenant";
    const state = await loadWholeState(dataDir);
    const now = new Date();
    const attemptKey = loginAttemptKey(scope === "platform" ? "platform" : `tenant:${body.tenantId ?? ""}`, body.email);

    if (isLoginLocked(state.controlPlane.loginAttempts, attemptKey, now)) {
      sendJson(res, 429, {
        error: {
          code: "login_locked",
          message: "Too many failed login attempts. Try again later."
        }
      });
      return;
    }

    const failLogin = async () => {
      const nextState = {
        ...state,
        controlPlane: {
          ...state.controlPlane,
          loginAttempts: recordLoginFailure(state.controlPlane.loginAttempts, attemptKey, now)
        }
      };
      await saveWholeState(nextState, dataDir);
    };

    if (scope === "platform") {
      const authenticated = authenticatePlatformUser(state.controlPlane, body, now);
      if (!authenticated) {
        await failLogin();
        sendJson(res, 401, { error: { code: "invalid_credentials", message: "Invalid email or password." } });
        return;
      }
      if (authenticated.user.mfaEnabled && !verifyTotpCode(authenticated.storedUser.mfaSecret, body.mfaCode, { now })) {
        await failLogin();
        sendJson(res, 401, { error: { code: "mfa_code_required", message: "A valid MFA code is required." } });
        return;
      }
      const { token, session } = createSessionRecord({
        principalType: "platform_user",
        userId: authenticated.user.userId,
        email: authenticated.user.email,
        displayName: authenticated.user.displayName,
        roles: authenticated.user.roles,
        restricted: sessionRestriction(authenticated.user)
      }, now);
      const nextState = {
        ...state,
        controlPlane: {
          ...state.controlPlane,
          platformUsers: {
            ...state.controlPlane.platformUsers,
            [authenticated.user.userId]: authenticated.storedUser
          },
          sessions: {
            ...state.controlPlane.sessions,
            [session.sessionId]: session
          },
          loginAttempts: clearLoginAttempts(state.controlPlane.loginAttempts, attemptKey)
        }
      };
      await saveWholeState(nextState, dataDir);
      sendJson(
        res,
        200,
        { scope, user: authenticated.user, session: publicSession(session) },
        { "set-cookie": sessionCookie(token, session.expiresAt) }
      );
      return;
    }

    const tenantId = body.tenantId;
    const tenant = state.controlPlane.tenants?.[tenantId];
    const tenantData = state.tenants?.[tenantId];
    if (!tenant || tenant.status !== "active" || !tenantData) {
      await failLogin();
      sendJson(res, 401, { error: { code: "invalid_credentials", message: "Invalid tenant, email, or password." } });
      return;
    }
    const authenticated = authenticateTenantUser(tenantData, body, now);
    if (!authenticated) {
      await failLogin();
      sendJson(res, 401, { error: { code: "invalid_credentials", message: "Invalid tenant, email, or password." } });
      return;
    }
    if (authenticated.user.mfaEnabled && !verifyTotpCode(authenticated.storedUser.mfaSecret, body.mfaCode, { now })) {
      await failLogin();
      sendJson(res, 401, { error: { code: "mfa_code_required", message: "A valid MFA code is required." } });
      return;
    }
    const { token, session } = createSessionRecord({
      principalType: "tenant_user",
      tenantId,
      userId: authenticated.user.userId,
      email: authenticated.user.email,
      displayName: authenticated.user.displayName,
      roles: authenticated.user.adminRoles,
      restricted: sessionRestriction(authenticated.user)
    }, now);
    const nextTenantData = {
      ...tenantData,
      users: {
        ...tenantData.users,
        [authenticated.user.userId]: authenticated.storedUser
      }
    };
    const nextState = {
      ...state,
      controlPlane: {
        ...state.controlPlane,
        sessions: {
          ...state.controlPlane.sessions,
          [session.sessionId]: session
        },
        loginAttempts: clearLoginAttempts(state.controlPlane.loginAttempts, attemptKey)
      },
      tenants: {
        ...state.tenants,
        [tenantId]: nextTenantData
      }
    };
    await saveWholeState(nextState, dataDir);
    sendJson(
      res,
      200,
      { scope, tenant: publicTenant(tenant), user: authenticated.user, session: publicSession(session) },
      { "set-cookie": sessionCookie(token, session.expiresAt) }
    );
    return;
  }

  if (method === "POST" && path === "/auth/password") {
    const state = await loadWholeState(dataDir);
    const resolved = resolveSession(state, sessionTokenFromRequest(req));
    if (!resolved) {
      sendJson(res, 401, { error: { code: "session_required", message: "A valid login session is required." } });
      return;
    }
    const body = await readJson(req);
    const now = new Date();
    if (resolved.session.principalType === "tenant_user") {
      const tenantData = state.tenants[resolved.tenant.tenantId];
      const storedUser = tenantData.users[resolved.user.userId];
      const result = changeOwnPassword(storedUser, body, now);
      if (result.findings.length > 0) {
        sendJson(res, 422, { error: { code: "password_change_invalid", message: "Password change is invalid." }, findings: result.findings });
        return;
      }
      const nextSessions = clearSessionRestrictionAndRevokeOthers(
        state.controlPlane.sessions,
        resolved.user.userId,
        resolved.session.sessionId,
        "password_change"
      );
      await saveWholeState({
        ...state,
        controlPlane: { ...state.controlPlane, sessions: nextSessions },
        tenants: {
          ...state.tenants,
          [resolved.tenant.tenantId]: {
            ...tenantData,
            users: { ...tenantData.users, [result.user.userId]: result.user }
          }
        }
      }, dataDir);
      sendJson(res, 200, { ok: true });
      return;
    }
    const storedUser = state.controlPlane.platformUsers[resolved.user.userId];
    const result = changeOwnPassword(storedUser, body, now);
    if (result.findings.length > 0) {
      sendJson(res, 422, { error: { code: "password_change_invalid", message: "Password change is invalid." }, findings: result.findings });
      return;
    }
    const nextSessions = clearSessionRestrictionAndRevokeOthers(
      state.controlPlane.sessions,
      resolved.user.userId,
      resolved.session.sessionId,
      "password_change"
    );
    await saveWholeState({
      ...state,
      controlPlane: {
        ...state.controlPlane,
        sessions: nextSessions,
        platformUsers: { ...state.controlPlane.platformUsers, [result.user.userId]: result.user }
      }
    }, dataDir);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && path === "/auth/mfa/setup") {
    const state = await loadWholeState(dataDir);
    const resolved = resolveSession(state, sessionTokenFromRequest(req));
    if (!resolved) {
      sendJson(res, 401, { error: { code: "session_required", message: "A valid login session is required." } });
      return;
    }
    const body = await readJson(req);
    const now = new Date();
    if (resolved.session.principalType === "tenant_user") {
      const tenantData = state.tenants[resolved.tenant.tenantId];
      const storedUser = tenantData.users[resolved.user.userId];
      const result = beginMfaEnrollment(storedUser, body, now);
      if (result.findings.length > 0) {
        sendJson(res, 422, { error: { code: "mfa_setup_invalid", message: "MFA enrollment could not be started." }, findings: result.findings });
        return;
      }
      await saveWholeState({
        ...state,
        tenants: {
          ...state.tenants,
          [resolved.tenant.tenantId]: { ...tenantData, users: { ...tenantData.users, [result.user.userId]: result.user } }
        }
      }, dataDir);
      sendJson(res, 200, { secret: result.secret, otpauthUrl: result.otpauthUrl });
      return;
    }
    const storedUser = state.controlPlane.platformUsers[resolved.user.userId];
    const result = beginMfaEnrollment(storedUser, body, now);
    if (result.findings.length > 0) {
      sendJson(res, 422, { error: { code: "mfa_setup_invalid", message: "MFA enrollment could not be started." }, findings: result.findings });
      return;
    }
    await saveWholeState({
      ...state,
      controlPlane: { ...state.controlPlane, platformUsers: { ...state.controlPlane.platformUsers, [result.user.userId]: result.user } }
    }, dataDir);
    sendJson(res, 200, { secret: result.secret, otpauthUrl: result.otpauthUrl });
    return;
  }

  if (method === "POST" && path === "/auth/mfa/enable") {
    const state = await loadWholeState(dataDir);
    const resolved = resolveSession(state, sessionTokenFromRequest(req));
    if (!resolved) {
      sendJson(res, 401, { error: { code: "session_required", message: "A valid login session is required." } });
      return;
    }
    const body = await readJson(req);
    const now = new Date();
    if (resolved.session.principalType === "tenant_user") {
      const tenantData = state.tenants[resolved.tenant.tenantId];
      const storedUser = tenantData.users[resolved.user.userId];
      const result = confirmMfaEnrollment(storedUser, body.code, now);
      if (result.findings.length > 0) {
        sendJson(res, 422, { error: { code: "mfa_enable_invalid", message: "MFA enrollment could not be confirmed." }, findings: result.findings });
        return;
      }
      const nextSessions = clearSessionRestriction(state.controlPlane.sessions, resolved.session.sessionId, "mfa_setup");
      await saveWholeState({
        ...state,
        controlPlane: { ...state.controlPlane, sessions: nextSessions },
        tenants: {
          ...state.tenants,
          [resolved.tenant.tenantId]: { ...tenantData, users: { ...tenantData.users, [result.user.userId]: result.user } }
        }
      }, dataDir);
      sendJson(res, 200, { user: publicTenantUser(result.user) });
      return;
    }
    const storedUser = state.controlPlane.platformUsers[resolved.user.userId];
    const result = confirmMfaEnrollment(storedUser, body.code, now);
    if (result.findings.length > 0) {
      sendJson(res, 422, { error: { code: "mfa_enable_invalid", message: "MFA enrollment could not be confirmed." }, findings: result.findings });
      return;
    }
    const nextSessions = clearSessionRestriction(state.controlPlane.sessions, resolved.session.sessionId, "mfa_setup");
    await saveWholeState({
      ...state,
      controlPlane: { ...state.controlPlane, sessions: nextSessions, platformUsers: { ...state.controlPlane.platformUsers, [result.user.userId]: result.user } }
    }, dataDir);
    sendJson(res, 200, { user: publicPlatformUser(result.user) });
    return;
  }

  if (method === "POST" && path === "/auth/mfa/disable") {
    const state = await loadWholeState(dataDir);
    const resolved = resolveSession(state, sessionTokenFromRequest(req));
    if (!resolved) {
      sendJson(res, 401, { error: { code: "session_required", message: "A valid login session is required." } });
      return;
    }
    const body = await readJson(req);
    const now = new Date();
    if (resolved.session.principalType === "tenant_user") {
      const tenantData = state.tenants[resolved.tenant.tenantId];
      const storedUser = tenantData.users[resolved.user.userId];
      const result = disableMfa(storedUser, body, now);
      if (result.findings.length > 0) {
        sendJson(res, 422, { error: { code: "mfa_disable_invalid", message: "MFA could not be disabled." }, findings: result.findings });
        return;
      }
      await saveWholeState({
        ...state,
        tenants: {
          ...state.tenants,
          [resolved.tenant.tenantId]: { ...tenantData, users: { ...tenantData.users, [result.user.userId]: result.user } }
        }
      }, dataDir);
      sendJson(res, 200, { user: publicTenantUser(result.user) });
      return;
    }
    const storedUser = state.controlPlane.platformUsers[resolved.user.userId];
    const result = disableMfa(storedUser, body, now);
    if (result.findings.length > 0) {
      sendJson(res, 422, { error: { code: "mfa_disable_invalid", message: "MFA could not be disabled." }, findings: result.findings });
      return;
    }
    await saveWholeState({
      ...state,
      controlPlane: { ...state.controlPlane, platformUsers: { ...state.controlPlane.platformUsers, [result.user.userId]: result.user } }
    }, dataDir);
    sendJson(res, 200, { user: publicPlatformUser(result.user) });
    return;
  }

  if (method === "POST" && path === "/auth/accept-invite") {
    const body = await readJson(req);
    if (!body.tenantId) {
      sendJson(res, 422, { error: { code: "tenant_id_required", message: "tenantId is required to accept an invite." } });
      return;
    }
    const state = await loadWholeState(dataDir);
    const tenantData = state.tenants?.[body.tenantId];
    if (!tenantData) {
      sendJson(res, 404, { error: { code: "not_found", message: "Tenant not found." } });
      return;
    }
    const now = new Date();
    const result = acceptTenantUserInvite(tenantData.users ?? {}, body, now);
    if (result.findings.length > 0) {
      sendJson(res, 422, { error: { code: "invite_invalid", message: "Invite could not be accepted." }, findings: result.findings });
      return;
    }
    await saveWholeState({
      ...state,
      tenants: { ...state.tenants, [body.tenantId]: { ...tenantData, users: result.users } }
    }, dataDir);
    sendJson(res, 200, { user: result.user });
    return;
  }

  if (method === "GET" && path === "/auth/me") {
    const state = await loadWholeState(dataDir);
    const resolved = resolveSession(state, sessionTokenFromRequest(req));
    if (!resolved) {
      sendJson(res, 401, { error: { code: "session_required", message: "A valid login session is required." } });
      return;
    }
    if (resolved.session.principalType === "tenant_user") {
      sendJson(res, 200, {
        scope: "tenant",
        tenant: publicTenant(resolved.tenant),
        user: resolved.user,
        session: publicSession(resolved.session)
      });
      return;
    }
    sendJson(res, 200, {
      scope: "platform",
      user: resolved.user,
      session: publicSession(resolved.session)
    });
    return;
  }

  if (method === "POST" && path === "/auth/logout") {
    const state = await loadWholeState(dataDir);
    const resolved = resolveSession(state, sessionTokenFromRequest(req));
    const nextSessions = resolved
      ? revokeSession(state.controlPlane.sessions, resolved.session.sessionId)
      : state.controlPlane.sessions;
    await saveWholeState({
      ...state,
      controlPlane: {
        ...state.controlPlane,
        sessions: nextSessions
      }
    }, dataDir);
    sendJson(res, 200, { ok: true }, { "set-cookie": expiredSessionCookie() });
    return;
  }

  sendJson(res, 404, { error: { code: "not_found", message: "Auth route not found." } });
}

async function routeTenantAdmin(req, res, { dataDir, method, path, tenant, authContext, store, stateRef }) {
  if (!hasTenantAdminRole(authContext)) {
    sendJson(res, 403, {
      error: {
        code: "tenant_admin_forbidden",
        message: "A tenant admin, user admin, security admin, or tenant service key is required."
      }
    });
    return;
  }

  if (method === "GET" && path === "/admin/me") {
    sendJson(res, 200, {
      tenant: publicTenant(tenant),
      auth: publicAuthContext(authContext)
    });
    return;
  }

  if (method === "GET" && path === "/admin/governance-summary") {
    const state = await store.load();
    const users = Object.values(state.users ?? {});
    const reviews = Object.values(state.accessReviews ?? {});
    sendJson(res, 200, {
      tenant: publicTenant(tenant),
      users: {
        total: users.length,
        active: users.filter((user) => user.status === "active").length,
        suspended: users.filter((user) => user.status === "suspended").length
      },
      accessReviews: {
        total: reviews.length,
        open: reviews.filter((review) => review.status === "open").length,
        completed: reviews.filter((review) => review.status === "completed").length
      },
      serviceAccess: {
        apiKeyLastRotatedAt: tenant.apiKeyRotatedAt ?? tenant.updatedAt ?? null,
        apiKeyLastRotatedBy: tenant.apiKeyRotatedBy ?? null
      },
      onboarding: computeTenantOnboardingReadiness(tenant, state)
    });
    return;
  }

  if (method === "GET" && path === "/admin/users") {
    const state = await store.load();
    sendJson(res, 200, { users: Object.values(state.users ?? {}).map(publicTenantUser) });
    return;
  }

  if (method === "POST" && path === "/admin/users") {
    const body = await readJson(req);
    const state = await store.load();
    // roles/queues/canAssignQueues/country (the former staff-actor fields) are
    // now plain fields on the user creation body — one identity, no separate
    // registry to keep in sync.
    // An admin choosing a user's password directly (as opposed to the invite
    // flow, where only the invitee ever knows it) means the admin now knows
    // that credential — force a rotation at next login unless the caller
    // explicitly opts out.
    if (
      body.userId &&
      isLastActiveTenantAdmin(state.users ?? {}, body.userId) &&
      (body.status && body.status !== "active" ||
        (Array.isArray(body.adminRoles) && !body.adminRoles.some((role) => TENANT_ADMIN_ROLES.has(role))))
    ) {
      sendJson(res, 409, {
        error: {
          code: "last_tenant_admin",
          message: "This is the only active tenant admin; this change would lock the tenant out of its own admin console."
        }
      });
      return;
    }
    const result = upsertTenantUser(state.users ?? {}, {
      ...body,
      mustChangePassword: body.password ? body.mustChangePassword ?? true : body.mustChangePassword
    });
    if (result.findings.length > 0) {
      sendJson(res, 422, {
        error: { code: "tenant_user_invalid", message: "Tenant user is invalid." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      {
        ...state,
        users: result.users
      },
      {
        type: "tenant_user.upserted",
        userId: result.user.userId,
        email: result.user.email,
        adminRoles: result.user.adminRoles,
        roles: result.user.roles,
        actor: authActor(authContext)
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { user: result.user });
    return;
  }

  if (method === "POST" && path === "/admin/users/invite") {
    const body = await readJson(req);
    const state = await store.load();
    const result = createTenantUserInvite(state.users ?? {}, body);
    if (result.findings.length > 0) {
      sendJson(res, 422, {
        error: { code: "tenant_user_invite_invalid", message: "Tenant user invite is invalid." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      { ...state, users: result.users },
      {
        type: "tenant_user.invited",
        userId: result.user.userId,
        email: result.user.email,
        actor: authActor(authContext)
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { user: result.user, tenantId: tenant.tenantId, inviteToken: result.token });
    return;
  }

  const userMatch = path.match(/^\/admin\/users\/([^/]+)$/);
  if (method === "GET" && userMatch) {
    const state = await store.load();
    const user = state.users?.[decodeURIComponent(userMatch[1])];
    if (!user) {
      sendJson(res, 404, { error: { code: "not_found", message: "Tenant user not found." } });
      return;
    }
    sendJson(res, 200, { user: publicTenantUser(user) });
    return;
  }

  const userStatusMatch = path.match(/^\/admin\/users\/([^/]+)\/status$/);
  if (method === "POST" && userStatusMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const userId = decodeURIComponent(userStatusMatch[1]);
    const existing = state.users?.[userId];
    if (!existing) {
      sendJson(res, 404, { error: { code: "not_found", message: "Tenant user not found." } });
      return;
    }
    if (body.status !== "active" && isLastActiveTenantAdmin(state.users ?? {}, userId)) {
      sendJson(res, 409, {
        error: {
          code: "last_tenant_admin",
          message: "This is the only active tenant admin; suspending them would lock the tenant out of its own admin console."
        }
      });
      return;
    }
    const result = upsertTenantUser(state.users ?? {}, { ...existing, status: body.status });
    if (result.findings.length > 0) {
      sendJson(res, 422, {
        error: { code: "tenant_user_invalid", message: "Tenant user status is invalid." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      { ...state, users: result.users },
      { type: "tenant_user.status_changed", userId, status: body.status, actor: authActor(authContext) }
    );
    await store.save(nextState);
    sendJson(res, 200, { user: result.user });
    return;
  }

  const userPasswordMatch = path.match(/^\/admin\/users\/([^/]+)\/password$/);
  if (method === "POST" && userPasswordMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const userId = decodeURIComponent(userPasswordMatch[1]);
    const existing = state.users?.[userId];
    if (!existing) {
      sendJson(res, 404, { error: { code: "not_found", message: "Tenant user not found." } });
      return;
    }
    const result = upsertTenantUser(state.users ?? {}, { ...existing, password: body.password, mustChangePassword: true });
    if (result.findings.length > 0) {
      sendJson(res, 422, {
        error: { code: "tenant_user_invalid", message: "Tenant user password update is invalid." },
        findings: result.findings
      });
      return;
    }
    // An admin-driven reset invalidates whatever the user could reach with
    // the old credential — same reasoning as a self-service password change.
    const nextSessions = clearSessionRestrictionAndRevokeOthers(
      stateRef.get().controlPlane.sessions,
      userId,
      null,
      null
    );
    stateRef.set({ ...stateRef.get(), controlPlane: { ...stateRef.get().controlPlane, sessions: nextSessions } });
    const nextState = appendEvent(
      { ...state, users: result.users },
      { type: "tenant_user.password_reset", userId, actor: authActor(authContext) }
    );
    await store.save(nextState);
    sendJson(res, 200, { user: result.user });
    return;
  }

  if (method === "GET" && path === "/admin/access-reviews") {
    const state = await store.load();
    sendJson(res, 200, { accessReviews: Object.values(state.accessReviews ?? {}) });
    return;
  }

  if (method === "POST" && path === "/admin/access-reviews") {
    const body = await readJson(req);
    const state = await store.load();
    const { review } = createAccessReview(state.users ?? {}, body);
    const nextState = appendEvent(
      {
        ...state,
        accessReviews: {
          ...(state.accessReviews ?? {}),
          [review.reviewId]: review
        }
      },
      {
        type: "access_review.created",
        reviewId: review.reviewId,
        reviewer: review.reviewer,
        actor: authActor(authContext)
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { accessReview: review });
    return;
  }

  const accessReviewCompleteMatch = path.match(/^\/admin\/access-reviews\/([^/]+)\/complete$/);
  if (method === "POST" && accessReviewCompleteMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const reviewId = decodeURIComponent(accessReviewCompleteMatch[1]);
    const result = completeAccessReview(state.accessReviews ?? {}, state.users ?? {}, reviewId, body);
    if (result.findings.length > 0) {
      sendJson(res, 422, {
        error: { code: "access_review_invalid", message: "Access review cannot be completed." },
        findings: result.findings
      });
      return;
    }
    const nextState = appendEvent(
      {
        ...state,
        users: result.users,
        accessReviews: result.reviews
      },
      {
        type: "access_review.completed",
        reviewId,
        completedBy: body.completedBy ?? null,
        actor: authActor(authContext)
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { accessReview: result.review });
    return;
  }

  if (method === "POST" && path === "/admin/api-key/rotation") {
    if (!hasTenantAdminRole(authContext, ["tenant_admin", "security_admin"])) {
      sendJson(res, 403, {
        error: { code: "api_key_rotation_forbidden", message: "Tenant admin or security admin role is required." }
      });
      return;
    }
    const body = await readJson(req);
    const apiKey = generateApiKey(tenant.isSandbox);
    const now = new Date();
    const wholeState = stateRef.get();
    const rotatedState = registerTenant(wholeState, {
      tenantId: tenant.tenantId,
      name: tenant.name,
      apiKey,
      isolationTier: tenant.isolationTier,
      status: tenant.status,
      isSandbox: tenant.isSandbox,
      parentTenantId: tenant.parentTenantId,
      sandboxName: tenant.sandboxName
    }, now);
    rotatedState.controlPlane.tenants[tenant.tenantId] = {
      ...rotatedState.controlPlane.tenants[tenant.tenantId],
      apiKeyRotatedAt: now.toISOString(),
      apiKeyRotatedBy: authActor(authContext)
    };
    stateRef.set(rotatedState);
    const state = await store.load();
    const nextTenantData = appendEvent(state, {
      type: "tenant.api_key.rotated",
      actor: authActor(authContext),
      reason: body.reason ?? null
    });
    await store.save(nextTenantData);
    sendJson(res, 200, {
      tenant: publicTenant(stateRef.get().controlPlane.tenants[tenant.tenantId]),
      apiKey
    });
    return;
  }

  sendJson(res, 404, { error: { code: "not_found", message: "Admin route not found." } });
}

async function routePlatform(req, res, { dataDir, platformAdminKey, method, path }) {
  const platformAuth = await platformAuthFromRequest(req, dataDir, platformAdminKey);
  if (!platformAuth.authContext && !platformAdminKey) {
    sendJson(res, 403, {
      error: {
        code: "platform_admin_disabled",
        message: "No platform admin key is configured; tenant administration is disabled."
      }
    });
    return;
  }
  if (!platformAuth.authContext) {
    sendJson(res, 403, {
      error: {
        code: "platform_admin_forbidden",
        message: "A valid platform admin key is required for tenant administration."
      }
    });
    return;
  }
  if (platformAuth.session && rejectIfRestricted(res, platformAuth.session, path)) {
    return;
  }
  const authContext = platformAuth.authContext;

  if (method === "GET" && path === "/platform/admin-summary") {
    if (!hasPlatformRole(authContext, ["platform_admin", "tenant_provisioner", "security_admin", "auditor"])) {
      sendJson(res, 403, { error: { code: "platform_role_forbidden", message: "Insufficient platform role." } });
      return;
    }
    const state = await loadWholeState(dataDir);
    const tenants = Object.values(state.controlPlane.tenants ?? {});
    sendJson(res, 200, {
      tenants: {
        total: tenants.length,
        active: tenants.filter((tenant) => tenant.status === "active").length,
        offboarded: tenants.filter((tenant) => tenant.status === "offboarded").length,
        sandboxes: tenants.filter((tenant) => tenant.isSandbox).length
      },
      subProcessors: Object.keys(state.controlPlane.subProcessors ?? {}).length,
      breakGlassGrants: Object.keys(state.controlPlane.breakGlassGrants ?? {}).length,
      platformUsers: Object.keys(state.controlPlane.platformUsers ?? {}).length
    });
    return;
  }

  if (method === "GET" && path === "/platform/onboarding-options") {
    if (!hasPlatformRole(authContext, ["platform_admin", "tenant_provisioner", "security_admin", "auditor"])) {
      sendJson(res, 403, { error: { code: "platform_role_forbidden", message: "Insufficient platform role." } });
      return;
    }
    sendJson(res, 200, {
      modules: TENANT_ONBOARDING_MODULES,
      flows: TENANT_ONBOARDING_FLOWS,
      launchModes: ["pilot", "production", "sandbox_only"],
      isolationTiers: ["pooled", "dedicated"]
    });
    return;
  }

  if (method === "GET" && path === "/platform/users") {
    if (!hasPlatformRole(authContext, ["platform_admin", "security_admin", "auditor"])) {
      sendJson(res, 403, { error: { code: "platform_role_forbidden", message: "Insufficient platform role." } });
      return;
    }
    const state = await loadWholeState(dataDir);
    sendJson(res, 200, { users: Object.values(state.controlPlane.platformUsers ?? {}).map(publicPlatformUser) });
    return;
  }

  if (method === "POST" && path === "/platform/users") {
    if (!hasPlatformRole(authContext, ["platform_admin", "security_admin"])) {
      sendJson(res, 403, { error: { code: "platform_role_forbidden", message: "Insufficient platform role." } });
      return;
    }
    const body = await readJson(req);
    const state = await loadWholeState(dataDir);
    const result = upsertPlatformUser(state.controlPlane.platformUsers ?? {}, {
      ...body,
      mustChangePassword: body.password ? body.mustChangePassword ?? true : body.mustChangePassword
    });
    if (result.findings.length > 0) {
      sendJson(res, 422, {
        error: { code: "platform_user_invalid", message: "Platform user is invalid." },
        findings: result.findings
      });
      return;
    }
    let nextState = {
      ...state,
      controlPlane: {
        ...state.controlPlane,
        platformUsers: result.users
      }
    };
    nextState = appendPlatformEvent(
      nextState,
      { type: "platform.user.upserted", userId: result.user.userId, email: result.user.email, roles: result.user.roles },
      { actor: authActor(authContext) }
    );
    await saveWholeState(nextState, dataDir);
    sendJson(res, 201, { user: result.user });
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
    let nextState = registerSubProcessor(state, body);
    nextState = appendPlatformEvent(
      nextState,
      { type: "platform.sub_processor.registered", subProcessorId: body.subProcessorId },
      { actor: authActor(authContext) }
    );
    await saveWholeState(nextState, dataDir);
    sendJson(res, 201, {
      subProcessor: publicSubProcessor(nextState.controlPlane.subProcessors[body.subProcessorId])
    });
    return;
  }

  if (method === "GET" && path === "/platform/audit-events") {
    if (!hasPlatformRole(authContext, ["platform_admin", "security_admin", "auditor"])) {
      sendJson(res, 403, { error: { code: "platform_role_forbidden", message: "Insufficient platform role." } });
      return;
    }
    const state = await loadWholeState(dataDir);
    sendJson(res, 200, buildPlatformAuditEvidencePack(state));
    return;
  }

  // Break-glass grant administration (platform admin only). Minting returns a
  // one-time, time-boxed credential stored only as a hash.
  const breakGlassMintMatch = path.match(/^\/platform\/tenants\/([^/]+)\/break-glass$/);
  if (method === "POST" && breakGlassMintMatch) {
    if (!hasPlatformRole(authContext, ["platform_admin", "security_admin"])) {
      sendJson(res, 403, { error: { code: "platform_role_forbidden", message: "Insufficient platform role." } });
      return;
    }
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
    let nextState = grantBreakGlass(state, {
      grantId,
      tenantId,
      staffId: body.staffId,
      reason: body.reason,
      ttlMinutes: body.ttlMinutes,
      createdBy: authActor(authContext),
      credential
    });
    nextState = appendPlatformEvent(
      nextState,
      { type: "platform.break_glass.granted", grantId, tenantId, staffId: body.staffId, reason: body.reason },
      { actor: authActor(authContext) }
    );
    await saveWholeState(nextState, dataDir);
    sendJson(res, 201, {
      grant: publicBreakGlassGrant(nextState.controlPlane.breakGlassGrants[grantId]),
      credential
    });
    return;
  }

  if (method === "GET" && breakGlassMintMatch) {
    if (!hasPlatformRole(authContext, ["platform_admin", "security_admin", "auditor"])) {
      sendJson(res, 403, { error: { code: "platform_role_forbidden", message: "Insufficient platform role." } });
      return;
    }
    const state = await loadWholeState(dataDir);
    const tenantId = decodeURIComponent(breakGlassMintMatch[1]);
    sendJson(res, 200, { grants: listBreakGlassGrants(state, tenantId) });
    return;
  }

  const breakGlassRevokeMatch = path.match(/^\/platform\/break-glass\/([^/]+)\/revoke$/);
  if (method === "POST" && breakGlassRevokeMatch) {
    if (!hasPlatformRole(authContext, ["platform_admin", "security_admin"])) {
      sendJson(res, 403, { error: { code: "platform_role_forbidden", message: "Insufficient platform role." } });
      return;
    }
    const state = await loadWholeState(dataDir);
    const grantId = decodeURIComponent(breakGlassRevokeMatch[1]);
    let nextState = revokeBreakGlass(state, grantId);
    if (!nextState) {
      sendJson(res, 404, { error: { code: "not_found", message: "Break-glass grant not found." } });
      return;
    }
    nextState = appendPlatformEvent(
      nextState,
      { type: "platform.break_glass.revoked", grantId },
      { actor: authActor(authContext) }
    );
    await saveWholeState(nextState, dataDir);
    sendJson(res, 200, {
      grant: publicBreakGlassGrant(nextState.controlPlane.breakGlassGrants[decodeURIComponent(breakGlassRevokeMatch[1])])
    });
    return;
  }

  if (method === "GET" && path === "/platform/tenants") {
    if (!hasPlatformRole(authContext, ["platform_admin", "tenant_provisioner", "security_admin", "auditor"])) {
      sendJson(res, 403, { error: { code: "platform_role_forbidden", message: "Insufficient platform role." } });
      return;
    }
    const state = await loadWholeState(dataDir);
    sendJson(res, 200, { tenants: listTenants(state) });
    return;
  }

  if (method === "POST" && path === "/platform/tenants") {
    if (!hasPlatformRole(authContext, ["platform_admin", "tenant_provisioner"])) {
      sendJson(res, 403, { error: { code: "platform_role_forbidden", message: "Insufficient platform role." } });
      return;
    }
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
    const now = new Date();
    const productIds = Array.isArray(body.products) ? body.products.map((product) => product.productId).filter(Boolean) : [];
    const onboarding = mergeOnboardingConfig(body.onboarding, {
      primaryRegulatedEntityId: body.regulatedEntity?.regulatedEntityId,
      productIds
    });
    // The api key is returned once here and only ever stored as a hash.
    const apiKey = body.apiKey ?? generateApiKey();
    let nextState = registerTenant(state, {
      tenantId: body.tenantId,
      name: body.name,
      apiKey,
      isolationTier: body.isolationTier,
      status: body.status,
      onboarding
    }, now);
    let ownerUser = null;
    if (body.ownerUser) {
      const tenantData = nextState.tenants[body.tenantId];
      const result = upsertTenantUser(tenantData.users ?? {}, {
        ...body.ownerUser,
        adminRoles: body.ownerUser.adminRoles ?? ["tenant_admin", "user_admin", "security_admin", "auditor"]
      });
      if (result.findings.length > 0) {
        sendJson(res, 422, {
          error: { code: "tenant_owner_invalid", message: "Tenant owner user is invalid." },
          findings: result.findings
        });
        return;
      }
      ownerUser = result.user;
      nextState = setTenantData(nextState, body.tenantId, {
        ...tenantData,
        users: result.users
      });
    }
    if (body.regulatedEntity || (Array.isArray(body.products) && body.products.length > 0)) {
      const setup = provisionTenantSetup(nextState, body.tenantId, body, authContext, now);
      if (!setup.ok) {
        sendJson(res, setup.statusCode, setup.payload);
        return;
      }
      nextState = setup.state;
    }
    const readiness = computeTenantOnboardingReadiness(
      nextState.controlPlane.tenants[body.tenantId],
      nextState.tenants[body.tenantId]
    );
    nextState = appendPlatformEvent(
      nextState,
      { type: "platform.tenant.created", tenantId: body.tenantId, name: body.name ?? body.tenantId },
      { actor: authActor(authContext) }
    );
    await saveWholeState(nextState, dataDir);
    sendJson(res, 201, {
      tenant: publicTenant(nextState.controlPlane.tenants[body.tenantId]),
      ownerUser,
      readiness,
      apiKey
    });
    return;
  }

  const tenantStatusMatch = path.match(/^\/platform\/tenants\/([^/]+)\/status$/);
  if (method === "POST" && tenantStatusMatch) {
    if (!hasPlatformRole(authContext, ["platform_admin", "security_admin"])) {
      sendJson(res, 403, { error: { code: "platform_role_forbidden", message: "Insufficient platform role." } });
      return;
    }
    const body = await readJson(req);
    const tenantId = decodeURIComponent(tenantStatusMatch[1]);
    if (!["active", "suspended"].includes(body.status)) {
      sendJson(res, 422, {
        error: { code: "tenant_status_invalid", message: "status must be one of: active, suspended." }
      });
      return;
    }
    const state = await loadWholeState(dataDir);
    const existing = state.controlPlane.tenants[tenantId];
    if (!existing) {
      sendJson(res, 404, { error: { code: "not_found", message: "Tenant not found." } });
      return;
    }
    if (existing.status === "offboarded") {
      sendJson(res, 409, {
        error: { code: "tenant_offboarded", message: "An offboarded tenant cannot change status; it must be re-onboarded." }
      });
      return;
    }
    const now = new Date();
    let nextState = {
      ...state,
      controlPlane: {
        ...state.controlPlane,
        tenants: {
          ...state.controlPlane.tenants,
          [tenantId]: {
            ...existing,
            status: body.status,
            statusReason: body.reason ?? null,
            updatedAt: now.toISOString()
          }
        }
      }
    };
    nextState = appendPlatformEvent(
      nextState,
      { type: "platform.tenant.status_changed", tenantId, status: body.status, reason: body.reason ?? null },
      { actor: authActor(authContext) },
      now
    );
    await saveWholeState(nextState, dataDir);
    sendJson(res, 200, { tenant: publicTenant(nextState.controlPlane.tenants[tenantId]) });
    return;
  }

  const tenantOnboardingMatch = path.match(/^\/platform\/tenants\/([^/]+)\/onboarding$/);
  if (method === "GET" && tenantOnboardingMatch) {
    const state = await loadWholeState(dataDir);
    const tenantId = decodeURIComponent(tenantOnboardingMatch[1]);
    const record = state.controlPlane.tenants[tenantId];
    const tenantData = state.tenants[tenantId];
    if (!record || !tenantData) {
      sendJson(res, 404, { error: { code: "not_found", message: "Tenant not found." } });
      return;
    }
    sendJson(res, 200, {
      tenant: publicTenant(record),
      readiness: computeTenantOnboardingReadiness(record, tenantData),
      regulatedEntities: Object.values(tenantData.regulatedEntities ?? {}),
      products: Object.values(tenantData.productPolicies ?? {})
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

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers
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

function communicationMatchesFilters(record, url) {
  const filters = {
    channel: url.searchParams.get("channel"),
    purpose: url.searchParams.get("purpose"),
    borrowerId: url.searchParams.get("borrowerId"),
    applicationId: url.searchParams.get("applicationId"),
    loanAccountId: url.searchParams.get("loanAccountId")
  };
  if (filters.channel && record.channel !== filters.channel) return false;
  if (filters.purpose && record.purpose !== filters.purpose) return false;
  if (filters.borrowerId && record.borrowerId !== filters.borrowerId) return false;
  if (filters.applicationId && record.applicationId !== filters.applicationId) return false;
  if (filters.loanAccountId && record.loanAccountId !== filters.loanAccountId) return false;
  return true;
}

function paymentRailMatchesFilters(record, url) {
  const filters = {
    type: url.searchParams.get("type"),
    channel: url.searchParams.get("channel"),
    status: url.searchParams.get("status"),
    borrowerId: url.searchParams.get("borrowerId"),
    applicationId: url.searchParams.get("applicationId"),
    loanAccountId: url.searchParams.get("loanAccountId"),
    providerRef: url.searchParams.get("providerRef")
  };
  if (filters.type && record.type !== filters.type) return false;
  if (filters.channel && record.channel !== filters.channel) return false;
  if (filters.status && record.status !== filters.status) return false;
  if (filters.borrowerId && record.borrowerId !== filters.borrowerId) return false;
  if (filters.applicationId && record.applicationId !== filters.applicationId) return false;
  if (filters.loanAccountId && record.loanAccountId !== filters.loanAccountId) return false;
  if (filters.providerRef && record.providerRef !== filters.providerRef) return false;
  return true;
}

function normalizeCommunicationPayload(input = {}) {
  const channel = input.channel;
  if (!["sms", "email", "whatsapp"].includes(channel)) {
    throw new Error("Communication channel must be sms, email, or whatsapp.");
  }
  const to = input.to ?? input.phone ?? input.email;
  if (!to) {
    throw new Error("Communication recipient is required.");
  }
  if (!input.message) {
    throw new Error("Communication message is required.");
  }
  if (channel === "email" && !input.subject) {
    throw new Error("Email communication requires subject.");
  }
  return {
    channel,
    to,
    subject: input.subject ?? null,
    message: input.message
  };
}

function buildCommunicationRecord(input, payload, dispatch, now = new Date()) {
  const subject = payload.subject ?? "";
  const message = String(payload.message ?? "");
  return {
    communicationId: input.communicationId ?? createLoanId("comm"),
    channel: payload.channel,
    purpose: input.purpose ?? "transactional",
    borrowerId: input.borrowerId ?? null,
    applicationId: input.applicationId ?? null,
    loanAccountId: input.loanAccountId ?? null,
    templateId: input.templateId ?? null,
    recipientMasked: maskRecipient(payload.channel, payload.to),
    subjectSha256: subject ? hashString(subject) : null,
    subjectLength: subject.length,
    messageSha256: hashString(message),
    messageLength: message.length,
    provider: dispatch.provider,
    providerRef: dispatch.ref,
    dataResidencyCountry: dispatch.dataResidencyCountry,
    status: dispatch.success ? "sent" : "failed",
    sentAt: now.toISOString()
  };
}

function buildNachMandateRecord(input, providerResult, now = new Date()) {
  const accountNumber = input.accountNumber ? String(input.accountNumber).trim() : "";
  return {
    paymentRailId: input.paymentRailId ?? input.mandateId ?? createLoanId("payrail"),
    type: "nach_mandate",
    channel: "nach",
    borrowerId: input.borrowerId,
    applicationId: input.applicationId ?? null,
    loanAccountId: input.loanAccountId ?? null,
    maxAmount: Number(input.maxAmount),
    currency: input.currency ?? "INR",
    frequency: input.frequency ?? "monthly",
    startsAt: input.startsAt ?? null,
    expiresAt: input.expiresAt ?? null,
    consentRef: input.consentRef ?? null,
    bankAccountVerificationRef: input.bankAccountVerificationRef ?? null,
    ifsc: input.ifsc ? String(input.ifsc).trim().toUpperCase() : null,
    accountNumberLast4: input.accountNumberLast4 ?? (accountNumber ? accountNumber.slice(-4) : null),
    accountNumberSha256: accountNumber ? hashString(accountNumber) : null,
    provider: providerResult.provider,
    providerRef: providerResult.mandateRef ?? providerResult.ref ?? providerResult.providerRef ?? null,
    status: providerResult.status ?? (providerResult.success ? "registered" : "failed"),
    dataResidencyCountry: providerResult.dataResidencyCountry ?? "IN",
    registeredAt: providerResult.registeredAt ?? now.toISOString()
  };
}

function buildUpiCollectRecord(input, providerResult, now = new Date()) {
  const vpa = String(input.vpa ?? "").trim().toLowerCase();
  return {
    paymentRailId: input.paymentRailId ?? input.collectId ?? createLoanId("payrail"),
    type: "upi_collect",
    channel: "upi",
    borrowerId: input.borrowerId ?? null,
    applicationId: input.applicationId ?? null,
    loanAccountId: input.loanAccountId ?? null,
    amount: Number(input.amount),
    currency: input.currency ?? "INR",
    purpose: input.purpose ?? "repayment",
    vpaMasked: maskVpa(vpa),
    vpaSha256: hashString(vpa),
    provider: providerResult.provider,
    providerRef: providerResult.collectRef ?? providerResult.ref ?? providerResult.providerRef ?? null,
    status: providerResult.status ?? (providerResult.success ? "pending" : "failed"),
    dataResidencyCountry: providerResult.dataResidencyCountry ?? "IN",
    createdAt: providerResult.createdAt ?? now.toISOString(),
    expiresAt: input.expiresAt ?? null
  };
}

function maskRecipient(channel, value) {
  const recipient = String(value ?? "");
  if (channel === "email") {
    const [local, domain] = recipient.split("@");
    return `${(local ?? "").slice(0, 2)}***@${domain ?? "***"}`;
  }
  const digits = recipient.replace(/\D/g, "");
  return `***${digits.slice(-4)}`;
}

function maskVpa(value) {
  const [handle, provider] = String(value ?? "").split("@");
  return `${(handle ?? "").slice(0, 2)}***@${provider ?? "***"}`;
}

function hashString(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
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
