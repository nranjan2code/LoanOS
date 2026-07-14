import {
  applyScimIdentityEvent,
  assessFederationPolicy,
  assessPlatformCapacity,
  certifyFederationPolicy,
  createFederationPolicy,
  createWebhookSubscription,
  projectEnterprisePlatform,
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
  suspendSaasPrincipalFromIdentityProvider
} from "../../../../packages/core/src/index.js";

export async function routeEnterpriseTenantControls(context) {
  const { method, path, req, res, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor, upsertFederatedTenantUser } = context;
  if (!path.startsWith("/admin/federation") && !path.startsWith("/admin/scim")) return false;
  const allowedTenantRoles = method === "GET" ? ["tenant_admin", "security_admin", "user_admin", "auditor"] : ["tenant_admin", "security_admin", "user_admin"];
  if (!hasTenantAdminRole(authContext, allowedTenantRoles)) { sendJson(res, 403, { error: { code: "enterprise_identity_forbidden", message: "Tenant identity administration access is required." } }); return true; }
  if (method === "GET" && path === "/admin/federation/policies") {
    const state = await store.load(); const policies = Object.values(state.federationPolicies ?? {}).map((policy) => ({ ...policy, readiness: assessFederationPolicy(policy) })); sendJson(res, 200, { policies }); return true;
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
      }
      await store.save(appendEvent(next, { type: `identity.scim.${applied.event.operation}_applied`, eventId: applied.event.eventId, userId: applied.event.userId, policyId: applied.event.policyId, evidenceChecksumSha256: applied.event.evidenceChecksumSha256, requestedCanonicalRoleIds: applied.event.requestedCanonicalRoleIds, canonicalRoleDisposition: applied.event.canonicalRoleDisposition, staffingImpact, actor: authActor(authContext) }));
      sendJson(res, 201, { event: applied.event, user: userResult.user, principal, staffingImpact, escalations });
    } catch (error) { sendEnterpriseError(res, sendJson, error); } return true;
  }
  return false;
}

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

function sendEnterpriseError(res, sendJson, error) { sendJson(res, error.code?.includes("duplicate") ? 409 : 422, { error: { code: error.code ?? "enterprise_control_invalid", message: error.message } }); }
