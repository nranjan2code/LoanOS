import {
  IDENTITY_CONFORMANCE_CATALOG,
  IDENTITY_INTEGRATION_FAMILIES,
  approveAuthenticatorRecovery,
  approveFederationRotation,
  approveIdentityConformanceCampaign,
  assessIdentityConformanceCampaign,
  createIdentityConformanceCampaign,
  executeIdentityOperationalRun,
  planIdentityOperationalRun,
  projectIdentityOperationalReadiness,
  proposeAuthenticatorRecovery,
  proposeFederationRotation,
  proposeIdentityOperationsDrill,
  reconcileFederatedDirectory,
  recordIdentityConformanceResult,
  revokePrincipalSessions,
  suspendFederationPolicy,
  witnessIdentityOperationsDrill
} from "../../../../packages/core/src/index.js";

const PREFIX = "/admin/identity-operations";

export async function routeIdentityOperations(context) {
  const { method, path, req, res, tenant, authContext, store, stateRef, readJson, sendJson, appendEvent, hasTenantAdminRole, authActor } = context;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  const readRoles = ["tenant_admin", "security_admin", "user_admin", "auditor"];
  const writeRoles = ["tenant_admin", "security_admin", "user_admin"];
  if (!hasTenantAdminRole(authContext, method === "GET" ? readRoles : writeRoles) || authContext?.principalType !== "tenant_user") {
    sendJson(res, 403, { error: { code: "identity_operations_forbidden", message: "A same-tenant human identity administrator is required." } });
    return true;
  }
  const actor = authActor(authContext);
  const requireOperationRoles = (roles) => {
    if (!hasTenantAdminRole(authContext, roles)) fail("identity_operations_forbidden", `This operation requires one of: ${roles.join(", ")}.`, 403);
  };
  try {
    let state = await store.load();
    if (method === "GET" && path === `${PREFIX}/summary`) {
      sendJson(res, 200, { summary: projectIdentityOperationalReadiness(state, { tenantId: tenant.tenantId, sessions: stateRef.get().controlPlane.sessions, requiredFamilies: IDENTITY_INTEGRATION_FAMILIES }) });
      return true;
    }
    if (method === "GET" && path === `${PREFIX}/conformance/catalog`) {
      sendJson(res, 200, { families: IDENTITY_INTEGRATION_FAMILIES, scenarios: IDENTITY_CONFORMANCE_CATALOG, executionMode: "simulated", commerciallyLive: false });
      return true;
    }
    if (method === "GET" && path === `${PREFIX}/conformance/campaigns`) {
      sendJson(res, 200, { campaigns: Object.values(state.identityConformanceCampaigns ?? {}) });
      return true;
    }
    if (method === "POST" && path === `${PREFIX}/conformance/campaigns`) {
      const body = await readJson(req);
      const result = createIdentityConformanceCampaign(state.identityConformanceCampaigns, { ...body, tenantId: tenant.tenantId, proposedBy: actor });
      await save(store, appendEvent, { ...state, identityConformanceCampaigns: result.registry }, "identity.conformance.campaign_proposed", actor, { campaignId: result.campaign.campaignId, family: result.campaign.family });
      sendJson(res, 201, { campaign: result.campaign }); return true;
    }
    const campaignApproval = path.match(/^\/admin\/identity-operations\/conformance\/campaigns\/([^/]+)\/approval$/);
    if (method === "POST" && campaignApproval) {
      const body = await readJson(req);
      const result = approveIdentityConformanceCampaign(state.identityConformanceCampaigns, { ...body, campaignId: decodeURIComponent(campaignApproval[1]), approvedBy: actor });
      await save(store, appendEvent, { ...state, identityConformanceCampaigns: result.registry }, "identity.conformance.campaign_approved", actor, { campaignId: result.campaign.campaignId });
      sendJson(res, 200, { campaign: result.campaign }); return true;
    }
    const campaignRun = path.match(/^\/admin\/identity-operations\/conformance\/campaigns\/([^/]+)\/run$/);
    if (method === "POST" && campaignRun) {
      const campaignId = decodeURIComponent(campaignRun[1]);
      const campaign = state.identityConformanceCampaigns?.[campaignId];
      if (!campaign) fail("identity_conformance_campaign_missing", "Campaign was not found.", 404);
      let registry = state.identityConformanceCampaigns;
      for (const scenarioId of campaign.scenarioIds) registry = recordIdentityConformanceResult(registry, { campaignId, scenarioId, executedBy: actor }).registry;
      const assessed = assessIdentityConformanceCampaign(registry, { campaignId, assessedBy: actor });
      await save(store, appendEvent, { ...state, identityConformanceCampaigns: assessed.registry }, "identity.conformance.simulator_campaign_completed", actor, { campaignId, status: assessed.campaign.status, manifestChecksumSha256: assessed.campaign.manifestChecksumSha256 });
      sendJson(res, 200, { campaign: assessed.campaign, assessment: assessed.assessment }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/federation/rotations/proposals`) {
      requireOperationRoles(["tenant_admin", "security_admin"]);
      const body = await readJson(req); const result = proposeFederationRotation(state, { ...body, tenantId: tenant.tenantId, proposedBy: actor });
      await save(store, appendEvent, result.state, "identity.federation.rotation_proposed", actor, { requestId: result.request.requestId, policyId: result.request.policyId });
      sendJson(res, 201, { request: result.request }); return true;
    }
    const rotationApproval = path.match(/^\/admin\/identity-operations\/federation\/rotations\/([^/]+)\/approval$/);
    if (method === "POST" && rotationApproval) {
      requireOperationRoles(["tenant_admin", "security_admin"]);
      const body = await readJson(req); const result = approveFederationRotation(state, { ...body, requestId: decodeURIComponent(rotationApproval[1]), approvedBy: actor });
      await save(store, appendEvent, result.state, "identity.federation.rotation_approved", actor, { requestId: result.request.requestId, policyId: result.policy.policyId });
      sendJson(res, 200, { request: result.request, policy: result.policy }); return true;
    }
    const suspension = path.match(/^\/admin\/identity-operations\/federation\/policies\/([^/]+)\/suspension$/);
    if (method === "POST" && suspension) {
      requireOperationRoles(["tenant_admin", "security_admin"]);
      const body = await readJson(req); const result = suspendFederationPolicy(state, { ...body, policyId: decodeURIComponent(suspension[1]), suspendedBy: actor });
      const revoked = revokeAffectedSessions(stateRef.get().controlPlane.sessions, tenant.tenantId, result.affectedUserIds, actor, `Federation policy ${result.policy.policyId} suspended`);
      await stateRef.set({ ...stateRef.get(), controlPlane: { ...stateRef.get().controlPlane, sessions: revoked.sessions } });
      await save(store, appendEvent, result.state, "identity.federation.policy_suspended", actor, { policyId: result.policy.policyId, affectedUserIds: result.affectedUserIds, revokedSessionIds: revoked.revokedSessionIds, evidenceRef: body.evidenceRef });
      sendJson(res, 200, { policy: result.policy, affectedUserIds: result.affectedUserIds, revokedSessionIds: revoked.revokedSessionIds }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/sessions/revoke`) {
      const body = await readJson(req); required(body.userId, "userId"); required(body.reason, "reason");
      const result = revokePrincipalSessions(stateRef.get().controlPlane.sessions, { tenantId: tenant.tenantId, userId: body.userId, revokedBy: actor, reason: body.reason });
      await stateRef.set({ ...stateRef.get(), controlPlane: { ...stateRef.get().controlPlane, sessions: result.sessions } });
      await save(store, appendEvent, state, "identity.sessions.revoked", actor, { userId: body.userId, reason: body.reason, revokedSessionIds: result.revokedSessionIds });
      sendJson(res, 200, { userId: body.userId, revokedSessionIds: result.revokedSessionIds }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/recovery/proposals`) {
      const body = await readJson(req); const result = proposeAuthenticatorRecovery(state, { ...body, tenantId: tenant.tenantId, proposedBy: actor });
      await save(store, appendEvent, result.state, "identity.authenticator_recovery_proposed", actor, { requestId: result.request.requestId, principalId: result.request.principalId });
      sendJson(res, 201, { request: result.request }); return true;
    }
    const recoveryApproval = path.match(/^\/admin\/identity-operations\/recovery\/([^/]+)\/approval$/);
    if (method === "POST" && recoveryApproval) {
      const body = await readJson(req); const result = approveAuthenticatorRecovery(state, { ...body, requestId: decodeURIComponent(recoveryApproval[1]), approvedBy: actor });
      const revoked = revokePrincipalSessions(stateRef.get().controlPlane.sessions, { tenantId: tenant.tenantId, userId: result.request.principalId, revokedBy: actor, reason: "Authenticator recovery approved" });
      await stateRef.set({ ...stateRef.get(), controlPlane: { ...stateRef.get().controlPlane, sessions: revoked.sessions } });
      await save(store, appendEvent, result.state, "identity.authenticator_recovery_approved", actor, { requestId: result.request.requestId, principalId: result.request.principalId, revokedSessionIds: revoked.revokedSessionIds });
      sendJson(res, 200, { request: result.request, user: publicRecoveryUser(result.user), revokedSessionIds: revoked.revokedSessionIds }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/directory-reconciliations`) {
      const body = await readJson(req); const result = reconcileFederatedDirectory(state, { ...body, tenantId: tenant.tenantId, executedBy: actor });
      await save(store, appendEvent, result.state, "identity.directory.reconciled", actor, { reconciliationId: result.reconciliation.reconciliationId, status: result.reconciliation.status, evidenceChecksumSha256: result.reconciliation.evidenceChecksumSha256 });
      sendJson(res, 201, { reconciliation: result.reconciliation }); return true;
    }
    if (method === "GET" && path === `${PREFIX}/automation/runs`) {
      sendJson(res, 200, { runs: Object.values(state.identityOperationalRuns ?? {}), automaticActions: ["revoke_principal_sessions"], commerciallyLive: false }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/automation/runs`) {
      requireOperationRoles(["tenant_admin", "security_admin"]);
      const body = await readJson(req); const whole = stateRef.get();
      const plan = planIdentityOperationalRun(state, whole.controlPlane.sessions, { ...body, tenantId: tenant.tenantId, plannedBy: actor });
      const executed = executeIdentityOperationalRun(state, whole.controlPlane.sessions, plan, { executedBy: actor, executionEvidenceRef: required(body.executionEvidenceRef, "executionEvidenceRef") });
      await stateRef.set({ ...whole, controlPlane: { ...whole.controlPlane, sessions: executed.sessions } });
      await save(store, appendEvent, executed.state, "identity.operations.automation_executed", actor, { runId: executed.run.runId, status: executed.run.status, findingCount: executed.run.findings.length, containmentCount: executed.run.results.length, planChecksumSha256: executed.run.planChecksumSha256 });
      sendJson(res, 201, { run: executed.run }); return true;
    }
    if (method === "GET" && path === `${PREFIX}/drills`) {
      sendJson(res, 200, { drills: Object.values(state.identityOperationsDrills ?? {}), simulation: true, commerciallyLive: false }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/drills/proposals`) {
      requireOperationRoles(["tenant_admin", "security_admin"]);
      const body = await readJson(req); const result = proposeIdentityOperationsDrill(state, { ...body, tenantId: tenant.tenantId, proposedBy: actor });
      await save(store, appendEvent, result.state, "identity.operations.drill_proposed", actor, { drillId: result.drill.drillId, scenario: result.drill.scenario });
      sendJson(res, 201, { drill: result.drill }); return true;
    }
    const drillWitness = path.match(/^\/admin\/identity-operations\/drills\/([^/]+)\/witness$/);
    if (method === "POST" && drillWitness) {
      requireOperationRoles(["tenant_admin", "security_admin"]);
      const body = await readJson(req); const result = witnessIdentityOperationsDrill(state, { ...body, drillId: decodeURIComponent(drillWitness[1]), witnessedBy: actor });
      await save(store, appendEvent, result.state, "identity.operations.drill_witnessed", actor, { drillId: result.drill.drillId, scenario: result.drill.scenario, status: result.drill.status });
      sendJson(res, 200, { drill: result.drill }); return true;
    }
    sendJson(res, 404, { error: { code: "not_found", message: "Identity operations route not found." } }); return true;
  } catch (error) {
    sendJson(res, error.statusCode ?? statusFor(error.code), { error: { code: error.code ?? "identity_operations_error", message: error.message } }); return true;
  }
}

function revokeAffectedSessions(sessions, tenantId, userIds, actor, reason) {
  let current = sessions; const revokedSessionIds = [];
  for (const userId of userIds) { const result = revokePrincipalSessions(current, { tenantId, userId, revokedBy: actor, reason }); current = result.sessions; revokedSessionIds.push(...result.revokedSessionIds); }
  return { sessions: current, revokedSessionIds };
}
async function save(store, appendEvent, state, type, actor, details) { await store.save(appendEvent(state, { type, actor, ...details })); }
function publicRecoveryUser(user) { const { passwordHash, mfaSecret, ...safe } = user; return safe; }
function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("identity_operations_input_invalid", `${field} is required.`, 422); return value.trim(); }
function fail(code, message, statusCode) { throw Object.assign(new Error(message), { code, statusCode }); }
function statusFor(code = "") { if (code.includes("forbidden")) return 403; if (code.includes("missing")) return 404; if (code.includes("exists") || code.includes("not_pending") || code.includes("four_eyes")) return 409; return 422; }
