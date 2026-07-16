import {
  approveBrandRelease,
  projectBrandAdministration,
  proposeBrandRelease,
  publishBrandRelease,
  resolveBrandExperience,
  rollbackBrandRelease
} from "../../../../packages/core/src/index.js";

const ADMIN_PREFIX = "/admin/brand-governance";
const EXPERIENCE_PATH = "/brand-experience";
const READ_ROLES = ["tenant_admin", "operator", "compliance_officer", "security_admin", "auditor"];
const WRITE_ROLES = ["tenant_admin", "operator", "compliance_officer"];

export async function routeBrandGovernance(context) {
  const { method, path, req, res, tenant, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;
  if (path !== EXPERIENCE_PATH && path !== ADMIN_PREFIX && !path.startsWith(`${ADMIN_PREFIX}/`)) return false;
  const actor = authActor(authContext);
  try {
    const state = await store.load();
    if (method === "GET" && path === EXPERIENCE_PATH) {
      if (!authContext || !["tenant_user", "borrower"].includes(authContext.principalType)) {
        sendJson(res, 403, { error: { code: "brand_experience_forbidden", message: "An authenticated same-tenant interactive session is required." } });
        return true;
      }
      const url = new URL(req.url, "http://local");
      const experience = resolveBrandExperience(state, {
        tenantId: tenant.tenantId,
        journeyType: url.searchParams.get("journeyType") || undefined,
        programmeRef: url.searchParams.get("programmeRef") || undefined,
        regulatedEntityRef: url.searchParams.get("regulatedEntityRef") || undefined,
        channel: url.searchParams.get("channel") || "borrower",
        locale: url.searchParams.get("locale") || undefined
      });
      sendJson(res, 200, { experience });
      return true;
    }
    const roles = method === "GET" ? READ_ROLES : WRITE_ROLES;
    if (authContext?.principalType !== "tenant_user" || !hasTenantAdminRole(authContext, roles)) {
      sendJson(res, 403, { error: { code: "brand_administration_forbidden", message: "A same-tenant authorised brand administrator is required." } });
      return true;
    }
    if (method === "GET" && path === ADMIN_PREFIX) {
      sendJson(res, 200, { workspace: projectBrandAdministration(state, { tenantId: tenant.tenantId }) });
      return true;
    }
    if (method !== "POST") return false;
    const body = await readJson(req);
    let result;
    let eventType;
    if (path === `${ADMIN_PREFIX}/releases`) {
      result = proposeBrandRelease(state, { ...body, tenantId: tenant.tenantId, proposedBy: actor });
      eventType = "brand.release_proposed";
    } else if (path === `${ADMIN_PREFIX}/rollback`) {
      result = rollbackBrandRelease(state, { ...body, tenantId: tenant.tenantId, approvedBy: actor });
      eventType = "brand.release_rolled_back";
    } else {
      const match = path.match(/^\/admin\/brand-governance\/releases\/([^/]+)\/(approval|publication)$/);
      if (!match) return false;
      const releaseId = decodeURIComponent(match[1]);
      if (match[2] === "approval") {
        result = approveBrandRelease(state, { ...body, tenantId: tenant.tenantId, releaseId, approvedBy: actor });
        eventType = "brand.release_approved";
      } else {
        result = publishBrandRelease(state, { ...body, tenantId: tenant.tenantId, releaseId, publishedBy: actor });
        eventType = "brand.release_published";
      }
    }
    await store.save(appendEvent(result.state, { type: eventType, actor, releaseId: result.release.releaseId, brandVersion: result.release.version, scope: result.release.scope, contentChecksumSha256: result.release.contentChecksumSha256 }));
    sendJson(res, result.idempotent ? 200 : 201, { release: result.release, idempotent: result.idempotent ?? false });
    return true;
  } catch (cause) {
    sendJson(res, cause.statusCode ?? (cause.code?.includes("forbidden") || cause.code?.includes("independence") || cause.code?.includes("four_eyes") ? 403 : cause.code?.includes("missing") || cause.code?.includes("not_pending") ? 404 : cause.code?.includes("conflict") || cause.code?.includes("integrity") ? 409 : 422), { error: { code: cause.code ?? "brand_governance_invalid", message: cause.message } });
    return true;
  }
}
