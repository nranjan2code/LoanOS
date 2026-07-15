import { createHash } from "node:crypto";

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
  claimIdentityOperationsJobs,
  finalizeIdentityOperationsWorkerRun,
  recordIdentityOperationsJobOutcome,
  replayIdentityOperationsDeadLetter,
  scheduleIdentityOperationsJob,
  revokePrincipalSessions,
  suspendFederationPolicy,
  witnessIdentityOperationsDrill
} from "../../../../packages/core/src/index.js";

const PREFIX = "/admin/identity-operations";
const WORKER_PREFIX = "/identity-operations-worker/v1";

export async function routeIdentityOperationsWorker(context) {
  const { method, path, req, res, tenant, authContext, store, readJson, sendJson, appendEvent, authActor } = context;
  if (path !== WORKER_PREFIX && !path.startsWith(`${WORKER_PREFIX}/`)) return false;
  const credential = authContext?.serviceCredential;
  const scopes = credential?.scopes ?? [];
  if (authContext?.principalType !== "tenant_service" || (!scopes.includes("*") && !scopes.includes("identity-operations:work"))) {
    sendJson(res, 401, { error: { code: "identity_worker_credential_required", message: "A tenant service credential with identity-operations:work scope is required." } }); return true;
  }
  if (method !== "POST") { sendJson(res, 405, { error: { code: "identity_worker_method_invalid", message: "The worker plane accepts POST only." } }); return true; }
  const workloadIdentityRef = serviceWorkloadRef(tenant.tenantId, credential.credentialId);
  const actor = authActor(authContext);
  try {
    const body = await readJson(req); const state = await store.load();
    if (path === `${WORKER_PREFIX}/claims`) {
      const result = claimIdentityOperationsJobs(state, { ...body, tenantId: tenant.tenantId, workloadIdentityRef });
      if (!result.idempotent) await save(store, appendEvent, result.state, "identity.worker.claimed", actor, { runId: result.run.runId, workerId: result.run.workerId, claimedJobIds: result.run.claimedJobIds, runChecksumSha256: result.run.runChecksumSha256 });
      sendJson(res, 200, { run: result.run, claimed: result.claimed, alerts: result.emittedAlerts, escalations: result.emittedEscalations, idempotent: result.idempotent }); return true;
    }
    const outcome = match(path, `${WORKER_PREFIX}/jobs/`, "/outcome");
    if (outcome) {
      const result = recordIdentityOperationsJobOutcome(state, { ...body, tenantId: tenant.tenantId, jobId: outcome, workloadIdentityRef });
      await save(store, appendEvent, result.state, `identity.worker.job_${result.job.status}`, actor, { jobId: result.job.jobId, runId: body.runId, attempt: result.job.attempt, status: result.job.status, evidenceChecksumSha256: body.evidenceChecksumSha256 });
      sendJson(res, 200, { job: result.job, deadLetter: result.deadLetter, alerts: result.emittedAlerts, escalations: result.emittedEscalations }); return true;
    }
    const finalization = match(path, `${WORKER_PREFIX}/runs/`, "/finalize");
    if (finalization) {
      const result = finalizeIdentityOperationsWorkerRun(state, { ...body, tenantId: tenant.tenantId, runId: finalization, workloadIdentityRef });
      await save(store, appendEvent, result.state, "identity.worker.run_finalized", actor, { runId: result.run.runId, workerId: result.run.workerId, status: result.run.status, runChecksumSha256: result.run.runChecksumSha256 });
      sendJson(res, 200, { run: result.run }); return true;
    }
    sendJson(res, 404, { error: { code: "not_found", message: "Identity operations worker route not found." } }); return true;
  } catch (error) {
    sendJson(res, statusFor(error.code), { error: { code: error.code ?? "identity_worker_invalid", message: error.message } }); return true;
  }
}

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
    if (method === "GET" && path === `${PREFIX}/worker`) {
      const sameTenant = (value) => Object.values(value ?? {}).filter((record) => record?.tenantId === tenant.tenantId);
      sendJson(res, 200, { jobs: sameTenant(state.identityOperationsJobs), runs: sameTenant(state.identityOperationsWorkerRuns), deadLetters: sameTenant(state.identityOperationsDeadLetters), replayRequests: sameTenant(state.identityOperationsDeadLetterReplayRequests), replays: sameTenant(state.identityOperationsJobReplays), alerts: sameTenant(state.identityOperationsAlerts), escalations: sameTenant(state.identityOperationsEscalations) }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/worker/jobs`) {
      requireOperationRoles(["tenant_admin", "security_admin"]);
      const body = await readJson(req); const credential = tenant.serviceCredentials?.[body.serviceCredentialId];
      if (!credential || credential.status !== "active" || (!credential.scopes?.includes("*") && !credential.scopes?.includes("identity-operations:work"))) fail("identity_worker_service_credential_invalid", "An active identity-operations worker service credential is required.", 422);
      const result = scheduleIdentityOperationsJob(state, { ...body, tenantId: tenant.tenantId, workloadIdentityRef: serviceWorkloadRef(tenant.tenantId, credential.credentialId) });
      if (!result.idempotent) await save(store, appendEvent, result.state, "identity.worker.job_scheduled", actor, { jobId: result.job.jobId, jobType: result.job.type, serviceCredentialId: credential.credentialId, envelopeChecksumSha256: result.job.envelopeChecksumSha256 });
      sendJson(res, result.idempotent ? 200 : 201, { job: result.job, idempotent: result.idempotent }); return true;
    }
    const replayProposal = match(path, `${PREFIX}/worker/dead-letters/`, "/replay-proposals");
    if (method === "POST" && replayProposal) {
      requireOperationRoles(["tenant_admin", "security_admin"]);
      const body = await readJson(req); const replayId = required(body.replayId, "replayId");
      const key = `${tenant.tenantId}:${replayId}`; const requests = state.identityOperationsDeadLetterReplayRequests ?? {};
      if (requests[key]) fail("identity_worker_replay_request_exists", "Replay request already exists.", 409);
      const requestCore = { tenantId: tenant.tenantId, replayId, deadLetterId: replayProposal, replayIdempotencyKey: required(body.replayIdempotencyKey, "replayIdempotencyKey"), newJobId: required(body.newJobId, "newJobId"), reason: required(body.reason, "reason"), scheduledAt: body.scheduledAt ?? new Date().toISOString(), requestedBy: actor, status: "pending_approval", requestedAt: new Date().toISOString() };
      const request = Object.freeze({ ...requestCore, requestChecksumSha256: digest(requestCore) });
      await save(store, appendEvent, { ...state, identityOperationsDeadLetterReplayRequests: { ...requests, [key]: request } }, "identity.worker.replay_proposed", actor, { replayId, deadLetterId: replayProposal, requestChecksumSha256: request.requestChecksumSha256 });
      sendJson(res, 201, { request }); return true;
    }
    const replayApproval = match(path, `${PREFIX}/worker/replay-proposals/`, "/approval");
    if (method === "POST" && replayApproval) {
      requireOperationRoles(["tenant_admin", "security_admin"]);
      const body = await readJson(req); const key = `${tenant.tenantId}:${replayApproval}`; const request = state.identityOperationsDeadLetterReplayRequests?.[key];
      if (!request || request.status !== "pending_approval" || digest(without(request, "requestChecksumSha256")) !== request.requestChecksumSha256) fail("identity_worker_replay_request_invalid", "A valid same-tenant pending replay request is required.", 409);
      const result = replayIdentityOperationsDeadLetter(state, { ...request, tenantId: tenant.tenantId, authorizedBy: actor, authorizationRef: required(body.authorizationRef, "authorizationRef") });
      const approvedRequestCore = { ...request, status: "approved", authorizedBy: actor, authorizationRef: body.authorizationRef, approvedAt: new Date().toISOString(), replayChecksumSha256: result.replay.replayChecksumSha256 };
      const approvedRequest = Object.freeze({ ...approvedRequestCore, requestChecksumSha256: digest(without(approvedRequestCore, "requestChecksumSha256")) });
      const next = { ...result.state, identityOperationsDeadLetterReplayRequests: { ...(result.state.identityOperationsDeadLetterReplayRequests ?? {}), [key]: approvedRequest } };
      await save(store, appendEvent, next, "identity.worker.replay_approved", actor, { replayId: result.replay.replayId, deadLetterId: result.replay.deadLetterId, newJobId: result.job.jobId, replayChecksumSha256: result.replay.replayChecksumSha256 });
      sendJson(res, 200, { request: approvedRequest, replay: result.replay, job: result.job }); return true;
    }
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
function serviceWorkloadRef(tenantId, credentialId) { return `loanos-service://${encodeURIComponent(tenantId)}/${encodeURIComponent(credentialId)}`; }
function match(path, prefix, suffix) { if (!path.startsWith(prefix) || !path.endsWith(suffix)) return null; const encoded = path.slice(prefix.length, -suffix.length); return encoded && !encoded.includes("/") ? decodeURIComponent(encoded) : null; }
function digest(value) { return createHash("sha256").update(stable(value)).digest("hex"); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function without(value, field) { const result = { ...value }; delete result[field]; return result; }
