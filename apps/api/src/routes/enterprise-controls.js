import {
  applyScimIdentityEvent,
  applyFederatedRevocationEvent,
  approveFederatedRevocationVerifier,
  assessFederationPolicy,
  assessPlatformCapacity,
  certifyFederationPolicy,
  createFederationPolicy,
  createWebhookSubscription,
  projectEnterprisePlatform,
  pauseComposedJourneysForPrincipal,
  pauseSpecialistCasesForPrincipal,
  proposeFederatedRevocationVerifier,
  queueWebhookDelivery,
  recordWebhookOutcome,
  registerApiContract,
  registerDatabaseTopology,
  registerDeploymentAutomationPolicy,
  registerEventSchema,
  registerManagedKeyAttestation,
  registerPitrPolicy,
  registerSaasPrincipal,
  registerSecurityLogCustody,
  revokePrincipalSessions,
  scimUserProjection,
  scimUserResourceToIdentityEvent,
  suspendSaasPrincipalFromIdentityProvider,
  verifyFederatedRevocationEnvelope
} from "@loanos/core";

export async function routeEnterpriseTenantControls(context) {
  const { method, path, req, res, store, stateRef, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor, upsertFederatedTenantUser } = context;
  if (path === "/scim/v2" || path.startsWith("/scim/v2/")) return routeScimProtocol(context);
  if (path === "/federation/v1/logout-events") return routeFederatedLogoutEvent(context);
  if (!path.startsWith("/admin/federation") && !path.startsWith("/admin/scim")) return false;
  const allowedTenantRoles = method === "GET" ? ["tenant_admin", "security_admin", "user_admin", "auditor"] : ["tenant_admin", "security_admin", "user_admin"];
  if (!hasTenantAdminRole(authContext, allowedTenantRoles)) { sendJson(res, 403, { error: { code: "enterprise_identity_forbidden", message: "Tenant identity administration access is required." } }); return true; }
  if (method === "GET" && path === "/admin/federation/policies") {
    const state = await store.load(); const policies = Object.values(state.federationPolicies ?? {}).map((policy) => ({ ...policy, readiness: assessFederationPolicy(policy) })); sendJson(res, 200, { policies }); return true;
  }
  if (method === "GET" && path === "/admin/federation/revocation-verifiers") {
    const state = await store.load(); sendJson(res, 200, { profiles: Object.values(state.federatedRevocationVerifierProfiles ?? {}) }); return true;
  }
  if (method === "POST" && path === "/admin/federation/revocation-verifiers/proposals") {
    const body = await readJson(req); const state = await store.load(); const actor = authActor(authContext); const policy = state.federationPolicies?.[body.policyId];
    if (!policy || !["active", "suspended"].includes(policy.status)) { sendJson(res, 422, { error: { code: "federated_revocation_policy_missing", message: "An active or suspended federation policy is required." } }); return true; }
    try {
      const result = proposeFederatedRevocationVerifier(state.federatedRevocationVerifierProfiles, { ...body, tenantId: authContext.tenantId, issuer: policy.issuer, audience: policy.audience, proposedBy: actor, commerciallyLive: false });
      await store.save(appendEvent({ ...state, federatedRevocationVerifierProfiles: result.registry }, { type: "identity.federation.revocation_verifier_proposed", profileId: result.profile.profileId, policyId: result.profile.policyId, profileChecksumSha256: result.profile.profileChecksumSha256, actor }));
      sendJson(res, 201, { profile: result.profile });
    } catch (error) { sendEnterpriseError(res, sendJson, error); }
    return true;
  }
  const verifierApproval = path.match(/^\/admin\/federation\/revocation-verifiers\/([^/]+)\/approval$/);
  if (method === "POST" && verifierApproval) {
    const body = await readJson(req); const state = await store.load(); const actor = authActor(authContext);
    try {
      const result = approveFederatedRevocationVerifier(state.federatedRevocationVerifierProfiles, { ...body, profileId: decodeURIComponent(verifierApproval[1]), tenantId: authContext.tenantId, approvedBy: actor });
      await store.save(appendEvent({ ...state, federatedRevocationVerifierProfiles: result.registry }, { type: "identity.federation.revocation_verifier_activated", profileId: result.profile.profileId, policyId: result.profile.policyId, activationChecksumSha256: result.profile.activationChecksumSha256, actor }));
      sendJson(res, 200, { profile: result.profile });
    } catch (error) { sendEnterpriseError(res, sendJson, error); }
    return true;
  }
  if (method === "POST" && path === "/admin/federation/policies") {
    const body = await readJson(req); const state = await store.load();
    try { const result = createFederationPolicy(state.federationPolicies, { ...body, proposedBy: authActor(authContext) }); await store.save(appendEvent({ ...state, federationPolicies: result.registry }, { type: "identity.federation.policy_created", policyId: result.policy.policyId, protocol: result.policy.protocol, actor: authActor(authContext) })); sendJson(res, 201, result.policy); } catch (error) { sendEnterpriseError(res, sendJson, error); } return true;
  }
  const certification = path.match(/^\/admin\/federation\/policies\/([^/]+)\/certification$/);
  if (method === "POST" && certification) {
    const body = await readJson(req); const state = await store.load(); const actor = authActor(authContext);
    if (body.approvedBy !== actor) { sendJson(res, 403, { error: { code: "enterprise_identity_actor_mismatch", message: "approvedBy must be the authenticated tenant actor." } }); return true; }
    try { const result = certifyFederationPolicy(state.federationPolicies, decodeURIComponent(certification[1]), body); await store.save(appendEvent({ ...state, federationPolicies: result.registry }, { type: "identity.federation.policy_certified", policyId: result.policy.policyId, metadataChecksumSha256: result.policy.metadataChecksumSha256, actor })); sendJson(res, 200, result.policy); } catch (error) { sendEnterpriseError(res, sendJson, error); } return true;
  }
  if (method === "GET" && path === "/admin/scim/events") { const state = await store.load(); sendJson(res, 200, { events: Object.values(state.scimEvents ?? {}) }); return true; }
  if (method === "POST" && path === "/admin/scim/events") {
    const body = await readJson(req); const state = await store.load();
    try {
      const applied = applyScimIdentityEvent(state.users, state.scimEvents, state.federationPolicies, { ...body, appliedBy: authActor(authContext) });
      const userResult = upsertFederatedTenantUser(state.users, applied.userInput);
      if (userResult.findings.length) { sendJson(res, 422, { error: { code: "scim_user_invalid", message: "SCIM identity could not be applied." }, findings: userResult.findings }); return true; }
      let next = { ...state, users: userResult.users, scimEvents: applied.events };
      const principalKey = `${authContext.tenantId}:${applied.event.userId}`;
      let principal = next.saasPrincipals?.[principalKey] ?? null;
      let staffingImpact = null;
      let escalations = [];
      let pausedSpecialistCaseIds = [];
      let pausedComposedJourneyIds = [];
      if (applied.event.operation === "upsert" && !principal) {
        const registered = registerSaasPrincipal(next, { tenantId: authContext.tenantId, principalId: applied.event.userId, principalType: "human", displayName: userResult.user.displayName, status: "active", emailVerified: true, mfaEnrolled: true, identityEvidenceRef: `scim:${applied.event.eventId}:${applied.event.evidenceChecksumSha256}` });
        next = registered.state;
        principal = registered.principal;
      }
      if (applied.event.operation === "deactivate" && principal) {
        const suspended = suspendSaasPrincipalFromIdentityProvider(next, { tenantId: authContext.tenantId, principalId: principal.principalId, policyId: applied.event.policyId, evidenceRef: `scim:${applied.event.eventId}:${applied.event.evidenceChecksumSha256}` });
        next = suspended.state;
        principal = suspended.principal;
        staffingImpact = suspended.staffingImpact;
        escalations = suspended.escalations;
        const causeRef = `scim:${applied.event.eventId}:${applied.event.evidenceChecksumSha256}`;
        const specialist = pauseSpecialistCasesForPrincipal(next, { tenantId: authContext.tenantId, principalId: principal.principalId, actor: authActor(authContext), causeType: "identity_provider_deactivation", causeRef });
        const composed = pauseComposedJourneysForPrincipal(specialist.state, { tenantId: authContext.tenantId, principalId: principal.principalId, actor: authActor(authContext), causeType: "identity_provider_deactivation", causeRef });
        next = composed.state;
        pausedSpecialistCaseIds = specialist.affectedCaseIds;
        pausedComposedJourneyIds = composed.affectedLifecycleIds;
        escalations = [...escalations, ...specialist.escalations, ...composed.escalations];
      }
      let revokedSessionIds = [];
      if (applied.event.operation === "deactivate") {
        const revoked = revokePrincipalSessions(stateRef.get().controlPlane.sessions, { tenantId: authContext.tenantId, userId: applied.event.userId, revokedBy: authActor(authContext), reason: `SCIM deactivation ${applied.event.eventId}` });
        revokedSessionIds = revoked.revokedSessionIds;
        await stateRef.set({ ...stateRef.get(), controlPlane: { ...stateRef.get().controlPlane, sessions: revoked.sessions } });
      }
      await store.save(appendEvent(next, { type: `identity.scim.${applied.event.operation}_applied`, eventId: applied.event.eventId, userId: applied.event.userId, policyId: applied.event.policyId, evidenceChecksumSha256: applied.event.evidenceChecksumSha256, requestedCanonicalRoleIds: applied.event.requestedCanonicalRoleIds, canonicalRoleDisposition: applied.event.canonicalRoleDisposition, staffingImpact, pausedSpecialistCaseIds, pausedComposedJourneyIds, revokedSessionIds, actor: authActor(authContext) }));
      sendJson(res, 201, { event: applied.event, user: userResult.user, principal, staffingImpact, escalations, pausedSpecialistCaseIds, pausedComposedJourneyIds, revokedSessionIds });
    } catch (error) { sendEnterpriseError(res, sendJson, error); } return true;
  }
  return false;
}

async function routeFederatedLogoutEvent(context) {
  const { method, req, res, store, stateRef, readJson, sendJson, appendEvent, authContext, authActor } = context;
  const scopes = authContext?.serviceCredential?.scopes ?? [];
  if (method !== "POST") { sendJson(res, 405, { error: { code: "federated_logout_method_invalid", message: "Only POST is supported." } }); return true; }
  if (authContext?.principalType !== "tenant_service" || (!scopes.includes("*") && !scopes.includes("federation:revoke"))) {
    sendJson(res, 401, { error: { code: "federated_logout_credential_required", message: "A tenant federation-revocation service credential is required." } }); return true;
  }
  try {
    const body = await readJson(req); const state = await store.load(); const whole = stateRef.get();
    const verified = verifyFederatedRevocationEnvelope(state.federatedRevocationVerifierProfiles, { ...body, tenantId: authContext.tenantId });
    const result = applyFederatedRevocationEvent(state.federatedRevocationEvents, whole.controlPlane.sessions, state.federationPolicies, state.users, { ...verified.event, verification: verified.verification, tenantId: authContext.tenantId, commerciallyLive: false });
    if (!result.idempotent) {
      await stateRef.set({ ...whole, controlPlane: { ...whole.controlPlane, sessions: result.sessions } });
      await store.save(appendEvent({ ...state, federatedRevocationEvents: result.events }, { type: "identity.federation.revocation_applied", eventId: result.event.eventId, policyId: result.event.policyId, protocol: result.event.protocol, verificationProfileId: result.event.verificationProfileId, verificationKeyId: result.event.verificationKeyId, revokedSessionIds: result.revokedSessionIds, evidenceChecksumSha256: result.event.evidenceChecksumSha256, actor: authActor(authContext) }));
    }
    sendJson(res, result.idempotent ? 200 : 201, { event: result.event, revokedSessionIds: result.revokedSessionIds, idempotent: result.idempotent });
  } catch (error) { sendEnterpriseError(res, sendJson, error); }
  return true;
}

async function routeScimProtocol(context) {
  const { method, path, req, res, store, readJson, sendJson, appendEvent, authContext, authActor, upsertFederatedTenantUser } = context;
  const scopes = authContext?.serviceCredential?.scopes ?? [];
  const requiredScope = method === "GET" ? "scim:read" : "scim:write";
  if (authContext?.principalType !== "tenant_service" || (!scopes.includes("*") && !scopes.includes(requiredScope))) {
    scimError(res, sendJson, 401, "A tenant SCIM bearer credential with the required scope is required."); return true;
  }
  if (method === "GET" && path === "/scim/v2/ServiceProviderConfig") {
    scimJson(res, sendJson, 200, { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"], patch: { supported: true }, bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 }, filter: { supported: true, maxResults: 200 }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false }, authenticationSchemes: [{ type: "oauthbearertoken", name: "Tenant-scoped bearer token", description: "LoanOS service credential", primary: true }] }); return true;
  }
  if (method === "GET" && path === "/scim/v2/ResourceTypes") {
    scimJson(res, sendJson, 200, listResponse([{ schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: "urn:ietf:params:scim:schemas:core:2.0:User" }, { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "Group", name: "Group", endpoint: "/Groups", schema: "urn:ietf:params:scim:schemas:core:2.0:Group" }])); return true;
  }
  if (method === "GET" && path === "/scim/v2/Schemas") {
    scimJson(res, sendJson, 200, listResponse([{ schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"], id: "urn:ietf:params:scim:schemas:core:2.0:User", name: "User" }, { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"], id: "urn:ietf:params:scim:schemas:core:2.0:Group", name: "Group" }])); return true;
  }
  if (method === "GET" && path === "/scim/v2/Users") {
    const state = await store.load(); const url = new URL(req.url, "http://localhost");
    const filter = url.searchParams.get("filter");
    let users = Object.values(state.users ?? {}).filter((user) => user.authenticationSource === "federated");
    if (filter) {
      const match = filter.match(/^userName eq "([^"]+)"$/i);
      if (!match) { scimError(res, sendJson, 400, "Only exact userName eq filtering is supported.", "invalidFilter"); return true; }
      users = users.filter((user) => user.email === match[1].trim().toLowerCase());
    }
    scimJson(res, sendJson, 200, listResponse(users.map((user) => scimUserProjection(user, "/scim/v2")))); return true;
  }
  if (method === "GET" && path === "/scim/v2/Groups") {
    const state = await store.load();
    const groups = Object.values(state.federationPolicies ?? {}).filter((policy) => policy.status === "active").flatMap((policy) => Object.keys(policy.groupMappings ?? {}).map((displayName) => ({ schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], id: `${policy.policyId}:${displayName}`, displayName, members: [], meta: { resourceType: "Group", location: `/scim/v2/Groups/${encodeURIComponent(`${policy.policyId}:${displayName}`)}` } })));
    scimJson(res, sendJson, 200, listResponse(groups)); return true;
  }
  if (method === "POST" && path === "/scim/v2/Users") {
    const body = await readJson(req);
    try {
      const input = scimUserResourceToIdentityEvent(body, { policyId: header(req, "x-loanos-federation-policy"), eventId: `scim_${req._loanosRequestId}`, idempotencyKey: header(req, "idempotency-key"), appliedBy: authActor(authContext) });
      const result = await applyScimProtocolEvent(context, input);
      scimJson(res, sendJson, result.idempotent ? 200 : 201, scimUserProjection(result.user, "/scim/v2"), { location: `/scim/v2/Users/${encodeURIComponent(result.user.federationExternalId)}` });
    } catch (error) { scimError(res, sendJson, 400, error.message, error.code); }
    return true;
  }
  const userPatch = path.match(/^\/scim\/v2\/Users\/([^/]+)$/);
  if (method === "PATCH" && userPatch) {
    const body = await readJson(req); const state = await store.load(); const externalId = decodeURIComponent(userPatch[1]);
    const existing = Object.values(state.users ?? {}).find((user) => user.federationExternalId === externalId);
    if (!existing) { scimError(res, sendJson, 404, "SCIM user was not found."); return true; }
    const operations = Array.isArray(body.Operations) ? body.Operations : [];
    const deactivate = operations.some((operation) => String(operation.op).toLowerCase() === "replace" && String(operation.path).toLowerCase() === "active" && operation.value === false);
    if (!deactivate) { scimError(res, sendJson, 400, "Only an active=false PATCH is accepted; group additions remain governed role requests.", "mutability"); return true; }
    try {
      const input = { eventId: `scim_${req._loanosRequestId}`, policyId: existing.federationPolicyId, externalId, email: existing.email, displayName: existing.displayName, groups: [], operation: "deactivate", idempotencyKey: header(req, "idempotency-key"), appliedBy: authActor(authContext) };
      const result = await applyScimProtocolEvent(context, input);
      scimJson(res, sendJson, 200, scimUserProjection(result.user, "/scim/v2"));
    } catch (error) { scimError(res, sendJson, 400, error.message, error.code); }
    return true;
  }
  scimError(res, sendJson, 404, "SCIM resource was not found."); return true;
}

async function applyScimProtocolEvent(context, input) {
  const { store, stateRef, appendEvent, authContext, authActor, upsertFederatedTenantUser } = context;
  const state = await store.load();
  const replay = Object.values(state.scimEvents ?? {}).find((event) => event.idempotencyKey === input.idempotencyKey);
  if (replay) {
    if (replay.policyId !== input.policyId || replay.externalId !== input.externalId || replay.operation !== input.operation || JSON.stringify(replay.groups) !== JSON.stringify(input.groups)) throw Object.assign(new Error("SCIM idempotency key was already used for different identity data."), { code: "scim_idempotency_conflict" });
    const user = state.users?.[replay.userId];
    if (!user) throw Object.assign(new Error("SCIM replay evidence points to a missing user."), { code: "scim_replay_inconsistent" });
    return { event: replay, user, principal: state.saasPrincipals?.[`${authContext.tenantId}:${replay.userId}`] ?? null, idempotent: true };
  }
  const applied = applyScimIdentityEvent(state.users, state.scimEvents, state.federationPolicies, input);
  const userResult = upsertFederatedTenantUser(state.users, applied.userInput);
  if (userResult.findings.length) throw Object.assign(new Error("SCIM identity could not be applied."), { code: "scim_user_invalid" });
  let next = { ...state, users: userResult.users, scimEvents: applied.events };
  const principalKey = `${authContext.tenantId}:${applied.event.userId}`;
  let principal = next.saasPrincipals?.[principalKey] ?? null;
  let pausedSpecialistCaseIds = [];
  let pausedComposedJourneyIds = [];
  if (applied.event.operation === "upsert" && !principal) {
    const registered = registerSaasPrincipal(next, { tenantId: authContext.tenantId, principalId: applied.event.userId, principalType: "human", displayName: userResult.user.displayName, status: "active", emailVerified: true, mfaEnrolled: true, identityEvidenceRef: `scim:${applied.event.eventId}:${applied.event.evidenceChecksumSha256}` });
    next = registered.state; principal = registered.principal;
  }
  if (applied.event.operation === "deactivate" && principal) {
    const suspended = suspendSaasPrincipalFromIdentityProvider(next, { tenantId: authContext.tenantId, principalId: principal.principalId, policyId: applied.event.policyId, evidenceRef: `scim:${applied.event.eventId}:${applied.event.evidenceChecksumSha256}` });
    next = suspended.state; principal = suspended.principal;
    const causeRef = `scim:${applied.event.eventId}:${applied.event.evidenceChecksumSha256}`;
    const specialist = pauseSpecialistCasesForPrincipal(next, { tenantId: authContext.tenantId, principalId: principal.principalId, actor: authActor(authContext), causeType: "identity_provider_deactivation", causeRef });
    const composed = pauseComposedJourneysForPrincipal(specialist.state, { tenantId: authContext.tenantId, principalId: principal.principalId, actor: authActor(authContext), causeType: "identity_provider_deactivation", causeRef });
    next = composed.state;
    pausedSpecialistCaseIds = specialist.affectedCaseIds;
    pausedComposedJourneyIds = composed.affectedLifecycleIds;
  }
  let revokedSessionIds = [];
  if (applied.event.operation === "deactivate") {
    const revoked = revokePrincipalSessions(stateRef.get().controlPlane.sessions, { tenantId: authContext.tenantId, userId: applied.event.userId, revokedBy: authActor(authContext), reason: `SCIM deactivation ${applied.event.eventId}` });
    revokedSessionIds = revoked.revokedSessionIds;
    await stateRef.set({ ...stateRef.get(), controlPlane: { ...stateRef.get().controlPlane, sessions: revoked.sessions } });
  }
  await store.save(appendEvent(next, { type: `identity.scim.${applied.event.operation}_applied`, eventId: applied.event.eventId, userId: applied.event.userId, policyId: applied.event.policyId, evidenceChecksumSha256: applied.event.evidenceChecksumSha256, requestedCanonicalRoleIds: applied.event.requestedCanonicalRoleIds, canonicalRoleDisposition: applied.event.canonicalRoleDisposition, pausedSpecialistCaseIds, pausedComposedJourneyIds, revokedSessionIds, actor: authActor(authContext) }));
  return { event: applied.event, user: userResult.user, principal, pausedSpecialistCaseIds, pausedComposedJourneyIds, revokedSessionIds, idempotent: false };
}

function listResponse(resources) { return { schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"], totalResults: resources.length, startIndex: 1, itemsPerPage: resources.length, Resources: resources }; }
function scimError(res, sendJson, status, detail, scimType) { scimJson(res, sendJson, status, { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: String(status), detail, ...(scimType ? { scimType } : {}) }); }
function scimJson(res, sendJson, status, payload, headers = {}) { sendJson(res, status, payload, { "content-type": "application/scim+json; charset=utf-8", ...headers }); }
function header(req, name) { const value = req.headers[name]; const scalar = Array.isArray(value) ? value[0] : value; if (!scalar || !String(scalar).trim()) throw Object.assign(new Error(`${name} header is required.`), { code: "scim_header_required" }); return String(scalar); }

export async function routeEnterprisePlatformControls(context) {
  const { method, path, req, res, dataDir, authContext, readJson, sendJson, hasPlatformRole, authActor, loadWholeState, saveWholeState, appendPlatformEvent } = context;
  if (!path.startsWith("/platform/enterprise") && !path.startsWith("/platform/api-governance")) return false;
  const allowedPlatformRoles = method === "GET" ? ["platform_admin", "security_admin", "auditor"] : ["platform_admin", "security_admin"];
  if (!hasPlatformRole(authContext, allowedPlatformRoles)) { sendJson(res, 403, { error: { code: "platform_role_forbidden", message: "Insufficient platform role." } }); return true; }
  if (method === "GET" && ["/platform/enterprise/controls", "/platform/api-governance/controls"].includes(path)) {
    const state = await loadWholeState(dataDir); const projection = projectEnterprisePlatform(state.controlPlane.platformEvents ?? []);
    sendJson(res, 200, path.includes("api-governance") ? { apiContracts: projection.apiContracts, eventSchemas: projection.eventSchemas, webhookSubscriptions: projection.webhookSubscriptions, webhookDeliveries: projection.webhookDeliveries } : projection); return true;
  }
  if (method !== "POST") return false;
  const body = await readJson(req); const actor = authActor(authContext); const state = await loadWholeState(dataDir); const projection = projectEnterprisePlatform(state.controlPlane.platformEvents ?? []);
  try {
    const definitions = {
      "/platform/enterprise/key-attestations": ["attestation", "platform.enterprise.key_attested", () => registerManagedKeyAttestation(body, projection.keyAttestations)],
      "/platform/enterprise/log-custody": ["custody", "platform.enterprise.log_custody_approved", () => registerSecurityLogCustody(body, projection.logCustody)],
      "/platform/enterprise/database-topologies": ["topology", "platform.enterprise.database_topology_approved", () => registerDatabaseTopology(body, projection.databaseTopologies, projection.keyAttestations)],
      "/platform/enterprise/pitr-policies": ["policy", "platform.enterprise.pitr_policy_approved", () => registerPitrPolicy(body, projection.pitrPolicies, projection.databaseTopologies, projection.keyAttestations)],
      "/platform/enterprise/capacity-assessments": ["assessment", "platform.enterprise.capacity_assessed", () => assessPlatformCapacity(body, projection.capacityAssessments)],
      "/platform/enterprise/deployment-policies": ["policy", "platform.enterprise.deployment_policy_approved", () => registerDeploymentAutomationPolicy(body, projection.deploymentPolicies, projection)],
      "/platform/api-governance/contracts": ["contract", "platform.api.contract_published", () => registerApiContract(body, projection.apiContracts)],
      "/platform/api-governance/event-schemas": ["schema", "platform.api.event_schema_published", () => registerEventSchema(body, projection.eventSchemas)],
      "/platform/api-governance/webhook-subscriptions": ["subscription", "platform.api.webhook_subscription_approved", () => createWebhookSubscription(body, projection.webhookSubscriptions, projection.eventSchemas)],
      "/platform/api-governance/webhook-deliveries": ["delivery", "platform.api.webhook_delivery_queued", () => queueWebhookDelivery(body, projection.webhookSubscriptions, projection.eventSchemas, projection.webhookDeliveries)]
    };
    const definition = definitions[path];
    if (definition) {
      if (body.approvedBy && body.approvedBy !== actor) { sendJson(res, 403, { error: { code: "enterprise_actor_mismatch", message: "approvedBy must be the authenticated platform actor." } }); return true; }
      const value = definition[2](); const nextState = appendPlatformEvent(state, { type: definition[1], [definition[0]]: value }, { actor }); await saveWholeState(nextState, dataDir); sendJson(res, 201, { [definition[0]]: value }); return true;
    }
    const outcome = path.match(/^\/platform\/api-governance\/webhook-deliveries\/([^/]+)\/outcomes$/);
    if (outcome) {
      if (body.observedBy !== actor) { sendJson(res, 403, { error: { code: "enterprise_actor_mismatch", message: "observedBy must be the authenticated platform actor." } }); return true; }
      const delivery = projection.webhookDeliveries.find((item) => item.deliveryId === decodeURIComponent(outcome[1])); const subscription = projection.webhookSubscriptions.find((item) => item.subscriptionId === delivery?.subscriptionId); const updated = recordWebhookOutcome(delivery, subscription, body); const nextState = appendPlatformEvent(state, { type: `platform.api.webhook_delivery_${updated.status}`, delivery: updated }, { actor }); await saveWholeState(nextState, dataDir); sendJson(res, 200, { delivery: updated }); return true;
    }
  } catch (error) { sendEnterpriseError(res, sendJson, error); return true; }
  return false;
}

function sendEnterpriseError(res, sendJson, error) { sendJson(res, /(duplicate|conflict|exists|four_eyes|not_pending)/.test(error.code ?? "") ? 409 : 422, { error: { code: error.code ?? "enterprise_control_invalid", message: error.message } }); }
