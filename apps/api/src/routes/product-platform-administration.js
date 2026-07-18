import { createHash } from "node:crypto";

import {
  PRODUCT_JOURNEY_CONTRACTS,
  PRODUCT_ADMINISTRATION_FORM_SCHEMA_VERSION,
  assessFeatureStaffingReadiness,
  activateTenantProduct,
  administerTenantProgramme,
  approveTenantProductConfiguration,
  assessTenantProductReadiness,
  createProductPlatformAdministrationState,
  diffTenantProductConfigurations,
  getProductAdministrationFormSchema,
  projectTenantProductDocuments,
  projectTenantProductLifecycleHistory,
  projectTenantProductNextActions,
  proposeTenantProductConfiguration,
  retireTenantProduct,
  subscribeTenantProduct,
  suspendTenantProduct
} from "@loanos/core";

const PREFIX = "/admin/product-platform";
const READ_ROLES = ["tenant_admin", "product_manager", "product_owner", "product_checker", "product_approver", "compliance_officer", "security_admin", "auditor"];
const WRITE_ROLES = ["tenant_admin", "product_manager", "product_owner"];
const APPROVAL_ROLES = ["tenant_admin", "product_checker", "product_approver", "compliance_officer"];

export async function routeProductPlatformAdministration(context) {
  const { method, path, req, res, tenant, store, stateRef, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  const roles = isApprovalPath(path) ? APPROVAL_ROLES : method === "GET" ? READ_ROLES : WRITE_ROLES;
  if (authContext?.principalType !== "tenant_user" || !hasTenantAdminRole(authContext, roles)) {
    sendJson(res, 403, { error: { code: "product_platform_admin_forbidden", message: "A same-tenant authorised human administrator is required." } });
    return true;
  }

  const actor = authActor(authContext);
  try {
    const root = await store.load();
    const sharedTemplates = stateRef?.get?.()?.controlPlane?.productPlatformAdministration?.templates ?? {};
    const administration = normalizeAdministration(root.productPlatformAdministration, sharedTemplates);
    if (method === "GET" && path === PREFIX) {
      sendJson(res, 200, projectWorkspace(administration, tenant.tenantId, root));
      return true;
    }
    const detailMatch = path.match(/^\/admin\/product-platform\/products\/([^/]+)$/);
    if (method === "GET" && detailMatch) {
      const productType = decodeURIComponent(detailMatch[1]);
      sendJson(res, 200, projectProductDetail(administration, tenant.tenantId, productType, root));
      return true;
    }
    const historyMatch = path.match(/^\/admin\/product-platform\/products\/([^/]+)\/history$/);
    if (method === "GET" && historyMatch) {
      const product = tenantProduct(administration, tenant.tenantId, decodeURIComponent(historyMatch[1]));
      sendJson(res, 200, { tenantId: tenant.tenantId, productType: product.productType, history: projectTenantProductLifecycleHistory(product), configurationDiffs: configurationDiffs(product) });
      return true;
    }
    const documentsMatch = path.match(/^\/admin\/product-platform\/products\/([^/]+)\/documents$/);
    if (method === "GET" && documentsMatch) {
      const product = tenantProduct(administration, tenant.tenantId, decodeURIComponent(documentsMatch[1]));
      sendJson(res, 200, { tenantId: tenant.tenantId, productType: product.productType, documents: projectTenantProductDocuments(product) });
      return true;
    }
    const formMatch = path.match(/^\/admin\/product-platform\/products\/([^/]+)\/form-schema$/);
    if (method === "GET" && formMatch) {
      const url = new URL(req.url, "http://local");
      const productType = decodeURIComponent(formMatch[1]);
      const requestedAction = url.searchParams.get("action");
      const formAction = requestedAction === "subscription" && root.productPlatformTransitionRequests?.[transitionKey(tenant.tenantId, productType, "subscription")] ? "subscription-approval" : requestedAction;
      sendJson(res, 200, { formSchema: getProductAdministrationFormSchema(productType, formAction) });
      return true;
    }
    const diffMatch = path.match(/^\/admin\/product-platform\/products\/([^/]+)\/diffs$/);
    if (method === "GET" && diffMatch) {
      const url = new URL(req.url, "http://local");
      const product = administration.products[`${tenant.tenantId}:${decodeURIComponent(diffMatch[1])}`];
      sendJson(res, 200, { diff: diffTenantProductConfigurations(product, Number(url.searchParams.get("fromVersion")), Number(url.searchParams.get("toVersion"))) });
      return true;
    }
    if (method !== "POST") return false;

    const body = await readJson(req);
    const productMatch = path.match(/^\/admin\/product-platform\/products\/([^/]+)\/(subscription-proposal|subscription|configuration|approval|activation-proposal|activation|suspension-proposal|suspension|retirement-proposal|retirement)$/);
    const programmeMatch = path.match(/^\/admin\/product-platform\/programmes\/([^/]+)\/(proposal|approval)$/);
    let result;
    let eventType;
    let nextRoot = root;
    let completedTransitionTarget = null;
    if (productMatch) {
      const productType = decodeURIComponent(productMatch[1]);
      const action = productMatch[2];
      if (action === "subscription-proposal") {
        if (!isLaterProduct(administration, tenant.tenantId)) fail("product_admin_add_product_not_required", "The first tenant product does not use the later-product amendment flow.");
        const provisioningLineage = requireCompletedAddProductSaga(root, administration, tenant.tenantId, productType, body.sagaId);
        const staffingLineage = requireAuthoritativeAdministrationStaffing(root, tenant.tenantId, productType);
        const templateLineage = requirePublishedTemplateLineage(administration, productType, body.templateVersion);
        const proposed = proposeTransition(root, { tenantId: tenant.tenantId, productType, target: "subscription", body: { ...body, provisioningLineage, staffingLineage, templateLineage }, actor });
        await store.save(appendEvent(proposed.state, { type: "product_platform.subscription_proposed", actor, productType, requestId: proposed.request.requestId, sagaId: provisioningLineage.sagaId }));
        sendJson(res, proposed.idempotent ? 200 : 201, { request: proposed.request, idempotent: proposed.idempotent });
        return true;
      } else if (action === "subscription") {
        let subscription = { ...body, tenantId: tenant.tenantId, productType, subscribedBy: actor };
        if (isLaterProduct(administration, tenant.tenantId)) {
          const pending = pendingTransition(root, tenant.tenantId, productType, "subscription");
          requireIndependent(pending, actor);
          const provisioningLineage = requireCompletedAddProductSaga(root, administration, tenant.tenantId, productType, pending.payload.sagaId);
          const staffingLineage = requireAuthoritativeAdministrationStaffing(root, tenant.tenantId, productType);
          const templateLineage = requirePublishedTemplateLineage(administration, productType, pending.payload.templateVersion);
          requireLineage(pending.payload.provisioningLineage, provisioningLineage, "product_admin_provisioning_lineage_stale");
          requireLineage(pending.payload.staffingLineage, staffingLineage, "product_admin_staffing_lineage_stale");
          requireLineage(pending.payload.templateLineage, templateLineage, "product_admin_template_lineage_stale");
          subscription = { ...pending.payload, commandId: body.commandId, tenantId: tenant.tenantId, productType, subscribedBy: actor, provisioningLineage, staffingLineage };
          completedTransitionTarget = "subscription";
        }
        result = subscribeTenantProduct(administration, subscription);
        eventType = "product_platform.product_subscribed";
      } else if (action === "configuration") {
        const administrationAuthority = requireAuthoritativeAdministrationStaffing(root, tenant.tenantId, productType, body.configuration?.staffingGrants);
        result = proposeTenantProductConfiguration(administration, { ...body, tenantId: tenant.tenantId, productType, proposedBy: actor, administrationAuthority });
        eventType = "product_platform.configuration_proposed";
      } else if (action === "approval") {
        requireCurrentAdministrationAuthority(root, tenantProduct(administration, tenant.tenantId, productType));
        result = approveTenantProductConfiguration(administration, { ...body, tenantId: tenant.tenantId, productType, approvedBy: actor });
        eventType = "product_platform.configuration_approved";
      } else if (action.endsWith("-proposal")) {
        const target = action.slice(0, -"-proposal".length);
        const proposed = proposeTransition(root, { tenantId: tenant.tenantId, productType, target, body, actor });
        await store.save(appendEvent(proposed.state, { type: `product_platform.${target}_proposed`, actor, productType, requestId: proposed.request.requestId }));
        sendJson(res, proposed.idempotent ? 200 : 201, { request: proposed.request, idempotent: proposed.idempotent });
        return true;
      } else if (action === "activation") {
        const pending = pendingTransition(root, tenant.tenantId, productType, action);
        requireIndependent(pending, actor);
        requireCurrentAdministrationAuthority(root, tenantProduct(administration, tenant.tenantId, productType));
        result = activateTenantProduct(administration, { ...pending.payload, ...body, tenantId: tenant.tenantId, productType, proposedBy: pending.proposedBy, approvedBy: actor });
        eventType = "product_platform.product_activated";
      } else if (action === "suspension") {
        const pending = pendingTransition(root, tenant.tenantId, productType, action);
        requireIndependent(pending, actor);
        result = suspendTenantProduct(administration, { ...pending.payload, ...body, tenantId: tenant.tenantId, productType, proposedBy: pending.proposedBy, approvedBy: actor });
        eventType = "product_platform.product_suspended";
      } else {
        const pending = pendingTransition(root, tenant.tenantId, productType, action);
        requireIndependent(pending, actor);
        result = retireTenantProduct(administration, { ...pending.payload, ...body, tenantId: tenant.tenantId, productType, proposedBy: pending.proposedBy, approvedBy: actor });
        eventType = "product_platform.product_retired";
      }
    } else if (programmeMatch) {
      const programmeId = decodeURIComponent(programmeMatch[1]);
      if (programmeMatch[2] === "proposal") {
        const proposed = proposeTransition(root, { tenantId: tenant.tenantId, productType: body.productType, programmeId, target: "programme", body, actor });
        await store.save(appendEvent(proposed.state, { type: "product_platform.programme_proposed", actor, productType: body.productType, programmeId, requestId: proposed.request.requestId }));
        sendJson(res, proposed.idempotent ? 200 : 201, { request: proposed.request, idempotent: proposed.idempotent });
        return true;
      }
      const pending = pendingTransition(root, tenant.tenantId, pendingProductType(root, tenant.tenantId, programmeId), "programme", programmeId);
      requireIndependent(pending, actor);
      result = administerTenantProgramme(administration, { ...pending.payload, ...body, tenantId: tenant.tenantId, programmeId, productType: pending.productType, proposedBy: pending.proposedBy, approvedBy: actor });
      eventType = "product_platform.programme_administered";
    } else return false;

    nextRoot = clearTransition({ ...root, productPlatformAdministration: result.state }, tenant.tenantId, result.product?.productType ?? result.programme?.productType, result.product ? (completedTransitionTarget ?? transitionTarget(eventType)) : "programme", result.programme?.programmeId);
    await store.save(appendEvent(nextRoot, auditEvent(eventType, actor, result)));
    sendJson(res, result.idempotentReplay ? 200 : 201, response(result));
    return true;
  } catch (cause) {
    sendJson(res, status(cause), { error: { code: cause.code ?? "product_platform_admin_invalid", message: cause.message } });
    return true;
  }
}

function normalizeAdministration(value, sharedTemplates = {}) {
  if (!value) return { ...createProductPlatformAdministrationState(), templates: { ...sharedTemplates } };
  return {
    templates: { ...sharedTemplates, ...(value.templates ?? {}) },
    products: value.products ?? {},
    programmes: value.programmes ?? {},
    commands: value.commands ?? {}
  };
}

function projectWorkspace(state, tenantId, root) {
  const products = Object.values(state.products).filter((item) => item.tenantId === tenantId).map((product) => ({ ...product, readiness: assessTenantProductReadiness(product, state), nextActions: projectTenantProductNextActions(product, state) }));
  const programmes = Object.values(state.programmes).filter((item) => item.tenantId === tenantId);
  const templates = Object.values(state.templates).filter((item) => item.status === "published").map((item) => ({ templateId: item.templateId, productType: item.productType, version: item.version, specificationChecksumSha256: item.specificationChecksumSha256 }));
  const pendingTransitions = Object.values(root.productPlatformTransitionRequests ?? {}).filter((item) => item.tenantId === tenantId && item.status === "pending_approval");
  return { tenantId, formSchemaVersion: PRODUCT_ADMINISTRATION_FORM_SCHEMA_VERSION, canonicalJourneyCount: Object.keys(PRODUCT_JOURNEY_CONTRACTS).length, contracts: Object.values(PRODUCT_JOURNEY_CONTRACTS), templates, products, programmes, pendingTransitions, authoritativeStaffingConfigurationVersion: root.tenantFeatureStaffingConfigs?.[tenantId]?.version ?? 0 };
}

function projectProductDetail(state, tenantId, productType, root) {
  const contract = PRODUCT_JOURNEY_CONTRACTS[productType];
  if (!contract) throw Object.assign(new Error("Canonical product type is required."), { code: "product_admin_unknown_product" });
  const templates = Object.values(state.templates).filter((item) => item.productType === productType && item.status === "published").sort((a, b) => b.version - a.version).map((item) => ({ templateId: item.templateId, version: item.version, specificationChecksumSha256: item.specificationChecksumSha256 }));
  const product = state.products[`${tenantId}:${productType}`] ?? null;
  const pendingTransitions = Object.values(root.productPlatformTransitionRequests ?? {}).filter((item) => item.tenantId === tenantId && item.productType === productType && item.status === "pending_approval");
  if (!product) {
    const later = isLaterProduct(state, tenantId);
    const staffing = later ? projectAuthoritativeAdministrationStaffing(root, tenantId, productType) : null;
    const pending = pendingTransitions.find((item) => item.target === "subscription");
    const blockers = [...(templates.length ? [] : ["published_template"]), ...(later && !staffing.ready ? staffing.blockers : []), ...(pending ? ["pending_independent_approval"] : [])];
    const nextActions = [{ action: later ? "subscription-proposal" : "subscription", enabled: blockers.length === 0, blockers }];
    if (pending) nextActions.push({ action: "subscription", enabled: true, blockers: [], pendingRequestId: pending.requestId });
    return { tenantId, productType, contract, templates, product: null, readiness: null, administrationStaffing: staffing, nextActions, pendingTransitions, history: [], configurationDiffs: [], documents: [] };
  }
  const pendingTargets = new Set(pendingTransitions.map((item) => item.target));
  const nextActions = projectTenantProductNextActions(product, state).map((item) => pendingTargets.has(item.action.replace("-proposal", "")) ? { ...item, enabled: false, blockers: ["pending_independent_approval"] } : item);
  for (const item of pendingTransitions) nextActions.push({ action: item.target, enabled: true, blockers: [], pendingRequestId: item.requestId });
  return { tenantId, productType, contract, templates, product, readiness: assessTenantProductReadiness(product, state), nextActions, pendingTransitions, history: projectTenantProductLifecycleHistory(product), configurationDiffs: configurationDiffs(product), documents: projectTenantProductDocuments(product) };
}

function isLaterProduct(state, tenantId) { return Object.values(state.products).some((item) => item.tenantId === tenantId); }

function requireCompletedAddProductSaga(root, administration, tenantId, productType, sagaId) {
  if (typeof sagaId !== "string" || !sagaId.trim()) fail("product_admin_provisioning_saga_required", "A completed add-product provisioning saga is required.");
  const saga = root.tenantProvisioningSagas?.[sagaId];
  if (!saga || saga.sagaId !== sagaId || saga.tenantId !== tenantId) fail("product_admin_provisioning_saga_not_found", "A same-tenant provisioning saga was not found.");
  if (saga.mode !== "add_product" || saga.status !== "completed" || !saga.handover) fail("product_admin_provisioning_incomplete", "A completed add-product handover is required.");
  if (!saga.requestedProducts.includes(productType)) fail("product_admin_provisioning_scope_mismatch", "Provisioning saga does not cover this product.");
  if (Object.values(saga.steps ?? {}).some((step) => step.status !== "completed")) fail("product_admin_provisioning_compensated", "A rolled-back or compensated provisioning scope cannot be subscribed.");
  if (saga.handover.handoverBy === saga.handover.acceptedBy || !saga.handover.approvalRef) fail("product_admin_provisioning_handover_invalid", "Provisioning handover is missing independent acceptance.");
  const expectedScopeChecksum = createHash("sha256").update(JSON.stringify({ mode: saga.mode, requestedProducts: saga.requestedProducts, activeProductsSnapshot: saga.activeProductsSnapshot })).digest("hex");
  if (saga.handover.scopeChecksumSha256 !== expectedScopeChecksum) fail("product_admin_provisioning_integrity", "Provisioning handover scope checksum is invalid.");
  const currentActive = Object.values(administration.products).filter((item) => item.tenantId === tenantId && item.status === "active").map((item) => item.productType).sort();
  if (JSON.stringify([...saga.activeProductsSnapshot].sort()) !== JSON.stringify(currentActive)) fail("product_admin_provisioning_snapshot_stale", "Active-product scope changed after the provisioning plan.");
  const lineage = { sagaId: saga.sagaId, sagaRevision: saga.revision, mode: saga.mode, requestedProducts: [...saga.requestedProducts].sort(), activeProductsSnapshot: [...saga.activeProductsSnapshot].sort(), scopeChecksumSha256: saga.handover.scopeChecksumSha256, handoverApprovalRef: saga.handover.approvalRef, completedAt: saga.handover.completedAt };
  return Object.freeze({ ...lineage, checksumSha256: hash(lineage) });
}

function requirePublishedTemplateLineage(administration, productType, version) {
  const template = administration.templates[`${productType}:${version}`];
  if (!template || template.status !== "published") fail("product_admin_template_unavailable", "Published template version is required.");
  const lineage = { productType, templateId: template.templateId, templateVersion: template.version, templateChecksumSha256: template.specificationChecksumSha256 };
  return Object.freeze({ ...lineage, checksumSha256: hash(lineage) });
}

function projectAuthoritativeAdministrationStaffing(root, tenantId, productType, staffingGrants = []) {
  const configuredFeatures = root.tenantFeatureStaffingConfigs?.[tenantId]?.features ?? [];
  const features = ["FST-002", "FST-030"].map((featureId) => {
    const configured = configuredFeatures.find((item) => item.featureId === featureId && item.scope?.type === "product" && item.scope.id === productType) ?? configuredFeatures.find((item) => item.featureId === featureId && item.scope?.type === "tenant" && item.scope.id === tenantId);
    return assessFeatureStaffingReadiness(root, { tenantId, featureId, scope: configured?.scope ?? { type: "product", id: productType } });
  });
  const grantBlockers = [];
  const grantLineage = [];
  for (const reference of staffingGrants ?? []) {
    const grant = root.saasRoleGrants?.[reference.grantId];
    const principal = root.saasPrincipals?.[`${tenantId}:${reference.principalId}`];
    const active = grant?.tenantId === tenantId && grant.principalId === reference.principalId && grant.status === "active" && Date.parse(grant.effectiveFrom) <= Date.now() && (!grant.validUntil || Date.parse(grant.validUntil) > Date.now());
    const scoped = grant?.scope?.type === "tenant" && grant.scope.id === tenantId || grant?.scope?.type === "product" && grant.scope.id === productType;
    const human = principal?.tenantId === tenantId && principal.status === "active" && principal.principalType === "human" && principal.emailVerified === true && principal.mfaEnrolled === true;
    const roleBound = Array.isArray(reference.roles) && reference.roles.includes(grant?.roleId);
    const evidenceBound = reference.evidenceRef === (grant?.approvalRef ?? grant?.evidenceRef);
    if (!active || !scoped || !human || !roleBound || !evidenceBound) grantBlockers.push(`staffing_grant:${reference.grantId}`);
    else grantLineage.push({ grantId: grant.grantId, principalId: grant.principalId, roleId: grant.roleId, scope: grant.scope, effectiveFrom: grant.effectiveFrom, validUntil: grant.validUntil ?? null, approvedBy: grant.approvedBy ?? grant.issuedBy ?? null, approvalRef: grant.approvalRef ?? grant.evidenceRef ?? null });
  }
  const blockers = [...features.flatMap((feature) => feature.blockers.map((blocker) => `${feature.featureId}:${blocker}`)), ...grantBlockers].sort();
  const lineage = { tenantId, productType, configurationVersion: root.tenantFeatureStaffingConfigs?.[tenantId]?.version ?? 0, features: features.map((feature) => ({ featureId: feature.featureId, scope: feature.scope, distinctPrincipalIds: feature.distinctPrincipalIds, blockers: feature.blockers })), grants: grantLineage.sort((a, b) => a.grantId.localeCompare(b.grantId)) };
  return { ready: blockers.length === 0, blockers, ...lineage, checksumSha256: hash(lineage) };
}

function requireAuthoritativeAdministrationStaffing(root, tenantId, productType, staffingGrants = []) {
  const result = projectAuthoritativeAdministrationStaffing(root, tenantId, productType, staffingGrants);
  if (!result.ready) fail("product_admin_authoritative_staffing_incomplete", `Authoritative staffing is incomplete: ${result.blockers.join(", ")}`);
  const { ready, blockers, ...lineage } = result;
  return Object.freeze(lineage);
}

function requireCurrentAdministrationAuthority(root, product) {
  const current = requireAuthoritativeAdministrationStaffing(root, product.tenantId, product.productType, product.configuration?.staffingGrants);
  requireLineage(product.administrationAuthority, current, "product_admin_staffing_lineage_stale");
  return current;
}

function requireLineage(expected, actual, code) { if (!expected || expected.checksumSha256 !== actual.checksumSha256) fail(code, "Authoritative approval lineage changed after proposal."); }

function tenantProduct(state, tenantId, productType) {
  if (!PRODUCT_JOURNEY_CONTRACTS[productType]) throw Object.assign(new Error("Canonical product type is required."), { code: "product_admin_unknown_product" });
  const product = state.products[`${tenantId}:${productType}`];
  if (!product) throw Object.assign(new Error("Tenant-local product was not found."), { code: "product_admin_product_not_found" });
  return product;
}

function configurationDiffs(product) {
  const versions = [...(product.history ?? []).map((item) => item.configurationVersion), product.configurationVersion].filter((version) => version > 0).sort((a, b) => a - b);
  return versions.slice(1).map((toVersion, index) => diffTenantProductConfigurations(product, versions[index], toVersion));
}

function response(result) {
  const { state, ...body } = result;
  return body;
}
function auditEvent(type, actor, result) {
  const record = result.product ?? result.programme;
  return { type, actor, productType: record?.productType, programmeId: record?.programmeId, configurationVersion: record?.configurationVersion, status: record?.status };
}
function proposeTransition(root, { tenantId, productType, programmeId = null, target, body, actor }) {
  if (typeof body.requestId !== "string" || !body.requestId.trim()) throw Object.assign(new Error("requestId is required."), { code: "product_admin_invalid" });
  if (typeof productType !== "string" || !productType.trim()) throw Object.assign(new Error("productType is required."), { code: "product_admin_invalid" });
  const key = transitionKey(tenantId, productType, target, programmeId);
  const payload = Object.fromEntries(Object.entries(body).filter(([field]) => !["requestId", "proposedBy", "approvedBy", "approvalRef", "commandId"].includes(field)));
  const request = Object.freeze({ tenantId, productType, programmeId, target, requestId: body.requestId.trim(), payload, proposedBy: actor, status: "pending_approval", contentChecksumSha256: hash({ tenantId, productType, programmeId, target, requestId: body.requestId.trim(), payload, proposedBy: actor }) });
  const prior = root.productPlatformTransitionRequests?.[key];
  if (prior) {
    if (prior.contentChecksumSha256 !== request.contentChecksumSha256) throw Object.assign(new Error("A pending transition already exists with different content."), { code: "product_admin_transition_conflict" });
    return { state: root, request: prior, idempotent: true };
  }
  return { state: { ...root, productPlatformTransitionRequests: { ...(root.productPlatformTransitionRequests ?? {}), [key]: request } }, request, idempotent: false };
}
function pendingTransition(root, tenantId, productType, target, programmeId = null) {
  const request = root.productPlatformTransitionRequests?.[transitionKey(tenantId, productType, target, programmeId)];
  if (!request || request.status !== "pending_approval") throw Object.assign(new Error("A pending authenticated proposal is required."), { code: "product_admin_transition_not_found" });
  if (request.contentChecksumSha256 !== hash({ tenantId: request.tenantId, productType: request.productType, programmeId: request.programmeId, target: request.target, requestId: request.requestId, payload: request.payload, proposedBy: request.proposedBy })) throw Object.assign(new Error("Transition request integrity verification failed."), { code: "product_admin_transition_integrity" });
  return request;
}
function pendingProductType(root, tenantId, programmeId) {
  const matches = Object.values(root.productPlatformTransitionRequests ?? {}).filter((item) => item.tenantId === tenantId && item.programmeId === programmeId && item.target === "programme" && item.status === "pending_approval");
  if (matches.length !== 1) throw Object.assign(new Error("A unique pending programme proposal is required."), { code: "product_admin_transition_not_found" });
  return matches[0].productType;
}
function requireIndependent(request, actor) { if (request.proposedBy === actor) throw Object.assign(new Error("An independent authenticated checker is required."), { code: "product_admin_four_eyes_required" }); }
function clearTransition(root, tenantId, productType, target, programmeId = null) { const requests = { ...(root.productPlatformTransitionRequests ?? {}) }; delete requests[transitionKey(tenantId, productType, target, programmeId)]; return { ...root, productPlatformTransitionRequests: requests }; }
function transitionTarget(eventType) { return eventType.endsWith("activated") ? "activation" : eventType.endsWith("suspended") ? "suspension" : eventType.endsWith("retired") ? "retirement" : null; }
function transitionKey(tenantId, productType, target, programmeId) { return `${tenantId}:${productType}:${target}:${programmeId ?? "product"}`; }
function hash(value) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value; }
function isApprovalPath(path) { return /\/(subscription|approval|activation|suspension|retirement)$/.test(path) || /\/programmes\/[^/]+\/approval$/.test(path); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function status(cause) { return cause.code?.includes("forbidden") || cause.code?.includes("four_eyes") ? 403 : cause.code?.includes("not_found") ? 404 : cause.code?.includes("conflict") || cause.code?.includes("exists") || cause.code?.includes("stale") ? 409 : 422; }
