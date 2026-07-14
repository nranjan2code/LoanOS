import {
  CANONICAL_ROLE_CATALOGUE,
  MINIMUM_LAUNCH_ROLE_COVERAGE,
  SEGREGATION_OF_DUTIES_RULES,
  approveEmergencyAccess,
  approveOwnershipTransfer,
  approveRoleGrant,
  approveRoleRevocation,
  assessMinimumLaunchCoverage,
  authorizeSaasAction,
  closeEmergencyAccess,
  completeBootstrapTransition,
  issueBootstrapChecker,
  issueBootstrapOwner,
  projectPrincipalAccess,
  proposeRoleGrant,
  proposeRoleRevocation,
  registerSaasPrincipal,
  requestEmergencyAccess,
  requestOwnershipTransfer
} from "../../../../packages/core/src/saas-identity-governance.js";

const PREFIX = "/admin/identity-governance";
const LEGACY_BOOTSTRAP_ADMIN_ROLES = new Set(["tenant_admin", "user_admin", "security_admin"]);

export async function routeSaasIdentityGovernance(req, res, { method, path, tenant, authContext, store, stateRef, readJson }) {
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;

  try {
    if (method === "GET" && path === `${PREFIX}/roles`) {
      sendJson(res, 200, {
        roles: Object.values(CANONICAL_ROLE_CATALOGUE),
        segregationOfDutiesRules: SEGREGATION_OF_DUTIES_RULES,
        minimumLaunchRoleCoverage: MINIMUM_LAUNCH_ROLE_COVERAGE
      });
      return true;
    }

    const actor = humanActor(authContext, tenant.tenantId);
    const body = method === "POST" ? await readJson(req) : {};
    let state = await store.load();

    const syncMatch = path.match(/^\/admin\/identity-governance\/principals\/([^/]+)\/sync$/);
    if (method === "POST" && syncMatch) {
      const principalId = decodeURIComponent(syncMatch[1]);
      const user = state.users?.[principalId];
      if (!user) fail("saas_user_binding_missing", "The principal must be bound to an existing tenant user.", 404);
      if (user.status !== "active") fail("saas_user_binding_inactive", "The bound tenant user must be active.", 409);
      if (!user.mfaEnabled) fail("saas_principal_verification_incomplete", "MFA enrollment is required before canonical access registration.", 422);

      const key = `${tenant.tenantId}:${principalId}`;
      let principal = state.saasPrincipals?.[key];
      if (!principal) {
        const isFirstPrincipal = Object.keys(state.saasPrincipals ?? {}).length === 0;
        if (isFirstPrincipal) {
          if (actor !== principalId || !authContext.roles?.some((role) => LEGACY_BOOTSTRAP_ADMIN_ROLES.has(role))) {
            fail("saas_bootstrap_owner_binding_forbidden", "The verified first tenant administrator must bind their own bootstrap identity.", 403);
          }
          if (!tenant.organisationSignupId) fail("saas_verified_admission_required", "A verified organisation admission is required before bootstrap access is issued.", 409);
        } else {
          requireCanonicalAction(state, tenant.tenantId, actor, "user.invite");
        }
        const registered = registerSaasPrincipal(state, {
          tenantId: tenant.tenantId,
          principalId,
          principalType: "human",
          displayName: user.displayName,
          status: "active",
          emailVerified: true,
          mfaEnrolled: true,
          identityEvidenceRef: required(body.identityEvidenceRef, "identityEvidenceRef")
        });
        state = registered.state;
        principal = registered.principal;
      }

      let bootstrapGrant = null;
      if (body.bootstrapRole === "bootstrap_owner" && !state.tenantOwnership?.[tenant.tenantId]) {
        if (actor !== principalId) fail("saas_bootstrap_owner_binding_forbidden", "Only the first verified user may activate bootstrap ownership.", 403);
        const issued = issueBootstrapOwner(state, {
          tenantId: tenant.tenantId,
          principalId,
          verificationRef: required(body.authorizedRepresentativeEvidenceRef, "authorizedRepresentativeEvidenceRef"),
          expiresAt: required(body.expiresAt, "expiresAt")
        });
        state = issued.state;
        bootstrapGrant = issued.grant;
        state = { ...state, users: { ...state.users, [principalId]: { ...user, bootstrapAuthority: "bootstrap_owner" } } };
      } else if (body.bootstrapRole === "bootstrap_checker") {
        requireCanonicalAction(state, tenant.tenantId, actor, "user.invite");
        const issued = issueBootstrapChecker(state, {
          tenantId: tenant.tenantId,
          principalId,
          authorizedRepresentativeEvidenceRef: required(body.authorizedRepresentativeEvidenceRef, "authorizedRepresentativeEvidenceRef"),
          expiresAt: required(body.expiresAt, "expiresAt")
        });
        state = issued.state;
        bootstrapGrant = issued.grant;
        state = { ...state, users: { ...state.users, [principalId]: { ...user, bootstrapAuthority: "bootstrap_checker" } } };
      } else if (body.bootstrapRole && body.bootstrapRole !== "bootstrap_owner") {
        fail("saas_bootstrap_role_invalid", "Bootstrap role is invalid.", 422);
      }

      await persist(store, state, "saas_identity.principal_synced", actor, { principalId, bootstrapRole: bootstrapGrant?.roleId ?? null });
      sendJson(res, 200, { principal, bootstrapGrant, access: projectPrincipalAccess(state, tenant.tenantId, principalId) });
      return true;
    }

    if (method === "GET" && path === `${PREFIX}/launch-coverage`) {
      sendJson(res, 200, { coverage: assessMinimumLaunchCoverage(state, tenant.tenantId) });
      return true;
    }

    if (method === "POST" && path === `${PREFIX}/role-grants/proposals`) {
      const result = proposeRoleGrant(state, { ...body, tenantId: tenant.tenantId, proposedBy: actor });
      await persistAndSyncCoverage(store, stateRef, tenant, result.state, "saas_identity.role_grant_proposed", actor, { requestId: result.request.requestId });
      sendJson(res, 201, { request: result.request });
      return true;
    }

    const grantApproval = path.match(/^\/admin\/identity-governance\/role-grants\/([^/]+)\/approval$/);
    if (method === "POST" && grantApproval) {
      const requestId = decodeURIComponent(grantApproval[1]);
      const result = approveRoleGrant(state, { ...body, requestId, tenantId: tenant.tenantId, approvedBy: actor });
      await persistAndSyncCoverage(store, stateRef, tenant, result.state, "saas_identity.role_grant_approved", actor, { requestId });
      sendJson(res, 200, { request: result.request, grants: result.grants });
      return true;
    }

    if (method === "POST" && path === `${PREFIX}/role-revocations/proposals`) {
      const result = proposeRoleRevocation(state, { ...body, tenantId: tenant.tenantId, proposedBy: actor });
      await persist(store, result.state, "saas_identity.role_revocation_proposed", actor, { requestId: result.request.requestId });
      sendJson(res, 201, { request: result.request });
      return true;
    }

    const revokeApproval = path.match(/^\/admin\/identity-governance\/role-revocations\/([^/]+)\/approval$/);
    if (method === "POST" && revokeApproval) {
      const requestId = decodeURIComponent(revokeApproval[1]);
      const result = approveRoleRevocation(state, { ...body, requestId, tenantId: tenant.tenantId, approvedBy: actor });
      await persistAndSyncCoverage(store, stateRef, tenant, result.state, "saas_identity.role_revocation_approved", actor, { requestId });
      sendJson(res, 200, { request: result.request, grants: result.grants });
      return true;
    }

    if (method === "POST" && path === `${PREFIX}/bootstrap-transition/proposal`) {
      requireCanonicalAction(state, tenant.tenantId, actor, "provisioning.start");
      const requestId = required(body.requestId, "requestId");
      if (state.bootstrapTransitionRequests?.[requestId]) fail("saas_bootstrap_transition_request_exists", "Bootstrap transition request already exists.", 409);
      const request = { requestId, tenantId: tenant.tenantId, proposedBy: actor, approvalRef: required(body.approvalRef, "approvalRef"), status: "pending", proposedAt: new Date().toISOString() };
      state = { ...state, bootstrapTransitionRequests: { ...(state.bootstrapTransitionRequests ?? {}), [requestId]: request } };
      await persist(store, state, "saas_identity.bootstrap_transition_proposed", actor, { requestId });
      sendJson(res, 201, { request });
      return true;
    }

    const transitionApproval = path.match(/^\/admin\/identity-governance\/bootstrap-transition\/([^/]+)\/approval$/);
    if (method === "POST" && transitionApproval) {
      const requestId = decodeURIComponent(transitionApproval[1]);
      const request = state.bootstrapTransitionRequests?.[requestId];
      if (!request || request.tenantId !== tenant.tenantId || request.status !== "pending") fail("saas_bootstrap_transition_not_pending", "A pending same-tenant bootstrap transition is required.", 409);
      const result = completeBootstrapTransition(state, { tenantId: tenant.tenantId, proposedBy: request.proposedBy, approvedBy: actor, approvalRef: required(body.approvalRef ?? request.approvalRef, "approvalRef") });
      const decided = { ...request, status: "approved", approvedBy: actor, decidedAt: new Date().toISOString() };
      const transitionedUsers = Object.fromEntries(Object.entries(result.state.users ?? {}).map(([userId, user]) => [userId, user.bootstrapAuthority ? { ...user, bootstrapAuthority: null } : user]));
      const next = { ...result.state, users: transitionedUsers, bootstrapTransitionRequests: { ...(result.state.bootstrapTransitionRequests ?? {}), [requestId]: decided } };
      await persistAndSyncCoverage(store, stateRef, tenant, next, "saas_identity.bootstrap_transition_completed", actor, { requestId });
      sendJson(res, 200, { request: decided, ownership: result.ownership, readiness: result.readiness });
      return true;
    }

    if (method === "POST" && path === `${PREFIX}/ownership-transfers/proposals`) {
      const result = requestOwnershipTransfer(state, { ...body, tenantId: tenant.tenantId, proposedBy: actor });
      await persist(store, result.state, "saas_identity.ownership_transfer_proposed", actor, { requestId: result.request.requestId });
      sendJson(res, 201, { request: result.request });
      return true;
    }

    const ownershipApproval = path.match(/^\/admin\/identity-governance\/ownership-transfers\/([^/]+)\/approval$/);
    if (method === "POST" && ownershipApproval) {
      const requestId = decodeURIComponent(ownershipApproval[1]);
      const request = state.ownershipTransferRequests?.[requestId];
      if (!request || request.tenantId !== tenant.tenantId) fail("saas_ownership_transfer_not_pending", "A pending same-tenant ownership transfer is required.", 409);
      const result = approveOwnershipTransfer(state, { requestId, approvedBy: actor, approvalRef: required(body.approvalRef, "approvalRef") });
      await persist(store, result.state, "saas_identity.ownership_transfer_approved", actor, { requestId });
      sendJson(res, 200, { request: result.request, ownership: result.ownership });
      return true;
    }

    if (method === "POST" && path === `${PREFIX}/emergency-access/proposals`) {
      const result = requestEmergencyAccess(state, { ...body, tenantId: tenant.tenantId, requestedBy: actor });
      await persist(store, result.state, "saas_identity.emergency_access_requested", actor, { requestId: result.request.requestId });
      sendJson(res, 201, { request: result.request });
      return true;
    }

    const emergencyApproval = path.match(/^\/admin\/identity-governance\/emergency-access\/([^/]+)\/approval$/);
    if (method === "POST" && emergencyApproval) {
      const requestId = decodeURIComponent(emergencyApproval[1]);
      const request = state.emergencyAccessRequests?.[requestId];
      if (!request || request.tenantId !== tenant.tenantId) fail("saas_emergency_request_inactive", "A live same-tenant emergency request is required.", 409);
      const result = approveEmergencyAccess(state, { requestId, approvedBy: actor, approvalRef: required(body.approvalRef, "approvalRef") });
      await persist(store, result.state, "saas_identity.emergency_access_approved", actor, { requestId });
      sendJson(res, 200, { request: result.request, grant: result.grant });
      return true;
    }

    const emergencyClosure = path.match(/^\/admin\/identity-governance\/emergency-access\/([^/]+)\/closure$/);
    if (method === "POST" && emergencyClosure) {
      const emergencyGrantId = decodeURIComponent(emergencyClosure[1]);
      const result = closeEmergencyAccess(state, { ...body, tenantId: tenant.tenantId, emergencyGrantId, closedBy: actor });
      await persist(store, result.state, "saas_identity.emergency_access_closed", actor, { emergencyGrantId });
      sendJson(res, 200, { grant: result.grant });
      return true;
    }

    sendJson(res, 404, { error: { code: "not_found", message: "Identity governance route not found." } });
    return true;
  } catch (error) {
    sendJson(res, error.statusCode ?? statusFor(error.code), { error: { code: error.code ?? "saas_identity_error", message: error.message } });
    return true;
  }
}

function humanActor(authContext, tenantId) {
  if (authContext?.principalType !== "tenant_user" || authContext.tenantId !== tenantId || !authContext.userId) fail("saas_human_actor_required", "A same-tenant authenticated human session is required.", 403);
  return authContext.userId;
}

function requireCanonicalAction(state, tenantId, principalId, action) {
  const decision = authorizeSaasAction(state, { tenantId, principalId, action });
  if (decision.outcome !== "allow") fail("saas_action_forbidden", `${action} is not granted.`, 403);
}

async function persistAndSyncCoverage(store, stateRef, tenant, state, eventType, actor, details) {
  await persist(store, state, eventType, actor, details);
  const coverage = assessMinimumLaunchCoverage(state, tenant.tenantId);
  const whole = stateRef.get();
  const current = whole.controlPlane.tenants[tenant.tenantId];
  await stateRef.set({ ...whole, controlPlane: { ...whole.controlPlane, tenants: { ...whole.controlPlane.tenants, [tenant.tenantId]: { ...current, activationGates: { ...(current.activationGates ?? {}), roleCoverage: coverage.ready }, updatedAt: new Date().toISOString() } } } });
}

async function persist(store, state, type, actor, details) {
  await store.save({ ...state, events: [...(state.events ?? []), { type, actor, ...details, occurredAt: new Date().toISOString() }] });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function required(value, field) {
  if (typeof value !== "string" || !value.trim()) fail("saas_identity_input_invalid", `${field} is required.`, 422);
  return value.trim();
}

function fail(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function statusFor(code = "") {
  if (code.includes("forbidden") || code === "saas_action_forbidden") return 403;
  if (code.includes("missing")) return 404;
  if (code.includes("exists") || code.includes("not_pending") || code.includes("inactive") || code.includes("four_eyes") || code.includes("sod_conflict") || code.includes("last_effective_admin") || code.includes("coverage_incomplete")) return 409;
  return 422;
}
