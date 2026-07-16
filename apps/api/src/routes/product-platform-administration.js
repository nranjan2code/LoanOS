import { createHash } from "node:crypto";

import {
  PRODUCT_JOURNEY_CONTRACTS,
  activateTenantProduct,
  administerTenantProgramme,
  approveTenantProductConfiguration,
  assessTenantProductReadiness,
  createProductPlatformAdministrationState,
  diffTenantProductConfigurations,
  proposeTenantProductConfiguration,
  retireTenantProduct,
  subscribeTenantProduct,
  suspendTenantProduct
} from "../../../../packages/core/src/index.js";

const PREFIX = "/admin/product-platform";
const READ_ROLES = ["tenant_admin", "operator", "credit_manager", "compliance_officer", "security_admin", "auditor"];
const WRITE_ROLES = ["tenant_admin", "operator", "credit_manager"];
const APPROVAL_ROLES = ["tenant_admin", "credit_manager", "compliance_officer"];

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
      sendJson(res, 200, projectWorkspace(administration, tenant.tenantId, root.productPlatformTransitionRequests));
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
    const productMatch = path.match(/^\/admin\/product-platform\/products\/([^/]+)\/(subscription|configuration|approval|activation-proposal|activation|suspension-proposal|suspension|retirement-proposal|retirement)$/);
    const programmeMatch = path.match(/^\/admin\/product-platform\/programmes\/([^/]+)\/(proposal|approval)$/);
    let result;
    let eventType;
    let nextRoot = root;
    if (productMatch) {
      const productType = decodeURIComponent(productMatch[1]);
      const action = productMatch[2];
      if (action === "subscription") {
        result = subscribeTenantProduct(administration, { ...body, tenantId: tenant.tenantId, productType, subscribedBy: actor });
        eventType = "product_platform.product_subscribed";
      } else if (action === "configuration") {
        result = proposeTenantProductConfiguration(administration, { ...body, tenantId: tenant.tenantId, productType, proposedBy: actor });
        eventType = "product_platform.configuration_proposed";
      } else if (action === "approval") {
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

    nextRoot = clearTransition({ ...root, productPlatformAdministration: result.state }, tenant.tenantId, result.product?.productType ?? result.programme?.productType, result.product ? transitionTarget(eventType) : "programme", result.programme?.programmeId);
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

function projectWorkspace(state, tenantId, transitionRequests = {}) {
  const products = Object.values(state.products).filter((item) => item.tenantId === tenantId).map((product) => ({ ...product, readiness: assessTenantProductReadiness(product, state) }));
  const programmes = Object.values(state.programmes).filter((item) => item.tenantId === tenantId);
  const templates = Object.values(state.templates).filter((item) => item.status === "published").map((item) => ({ templateId: item.templateId, productType: item.productType, version: item.version, specificationChecksumSha256: item.specificationChecksumSha256 }));
  const pendingTransitions = Object.values(transitionRequests ?? {}).filter((item) => item.tenantId === tenantId && item.status === "pending_approval");
  return { tenantId, canonicalJourneyCount: Object.keys(PRODUCT_JOURNEY_CONTRACTS).length, contracts: Object.values(PRODUCT_JOURNEY_CONTRACTS), templates, products, programmes, pendingTransitions };
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
function isApprovalPath(path) { return /\/(approval|activation|suspension|retirement)$/.test(path) || /\/programmes\/[^/]+\/approval$/.test(path); }
function status(cause) { return cause.code?.includes("forbidden") || cause.code?.includes("four_eyes") ? 403 : cause.code?.includes("not_found") ? 404 : cause.code?.includes("conflict") || cause.code?.includes("exists") || cause.code?.includes("stale") ? 409 : 422; }
