import { projectJourneyApplication, promoteSubmittedJourneyDraft } from "../../../../packages/core/src/index.js";

const PREFIX = "/journey-applications";
const PROMOTION_ROLES = ["tenant_admin", "branch_operator", "partner_user", "partner_admin", "field_officer", "field_supervisor", "operator"];
const OVERSIGHT_ROLES = ["tenant_admin", "credit_manager", "operations_maker", "operations_checker", "compliance_officer", "auditor"];

export async function routeJourneyApplications(context) {
  const { method, path, req, res, tenant, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  const actor = authActor(authContext);
  if (!actor || !["tenant_user", "borrower"].includes(authContext?.principalType)) {
    sendJson(res, 403, { error: { code: "journey_application_forbidden", message: "An authenticated same-tenant interactive human is required." } });
    return true;
  }
  try {
    const state = await store.load();
    if (method === "GET" && path === PREFIX) {
      const oversight = authContext.principalType === "tenant_user" && hasTenantAdminRole(authContext, OVERSIGHT_ROLES);
      const applications = Object.values(state.journeyApplications ?? {}).filter((item) => item.tenantId === tenant.tenantId && (oversight || [item.proposedBy, item.assignedCheckerId, item.subjectRef].includes(actor))).map(summary);
      sendJson(res, 200, { tenantId: tenant.tenantId, applications });
      return true;
    }
    const applicationMatch = path.match(/^\/journey-applications\/([^/]+)$/);
    if (method === "GET" && applicationMatch) {
      const application = projectJourneyApplication(state, { tenantId: tenant.tenantId, applicationId: decodeURIComponent(applicationMatch[1]) });
      const oversight = authContext.principalType === "tenant_user" && hasTenantAdminRole(authContext, OVERSIGHT_ROLES);
      if (!oversight && ![application.proposedBy, application.assignedCheckerId, application.subjectRef].includes(actor)) {
        sendJson(res, 403, { error: { code: "journey_application_forbidden", message: "The application is outside this principal's assigned scope." } });
        return true;
      }
      sendJson(res, 200, { application });
      return true;
    }
    if (method === "POST" && path === `${PREFIX}/promotions`) {
      if (authContext.principalType !== "tenant_user" || !hasTenantAdminRole(authContext, PROMOTION_ROLES)) {
        sendJson(res, 403, { error: { code: "journey_application_promotion_forbidden", message: "An authorised assisted-origination maker is required." } });
        return true;
      }
      const body = await readJson(req);
      const result = promoteSubmittedJourneyDraft(state, { ...body, tenantId: tenant.tenantId, makerPrincipalId: actor });
      await store.save(appendEvent(result.state, { type: "journey_application.promoted", actor, applicationId: result.application.applicationId, journeyType: result.application.journeyType, sourceDraftRef: result.application.sourceDraftRef, productContractChecksumSha256: result.application.productContractChecksumSha256, applicationChecksumSha256: result.application.applicationChecksumSha256, lifecycleId: result.application.lifecycleId, specialistCaseId: result.application.specialistCaseId }));
      sendJson(res, result.idempotent ? 200 : 201, { application: result.application, specialistCase: result.specialistCase, lifecycle: result.lifecycle, idempotent: result.idempotent });
      return true;
    }
    return false;
  } catch (cause) {
    sendJson(res, cause.statusCode ?? (cause.code?.includes("forbidden") || cause.code?.includes("authority") || cause.code?.includes("staffing") || cause.code?.includes("four_eyes") ? 403 : cause.code?.includes("missing") ? 404 : cause.code?.includes("conflict") || cause.code?.includes("stale") || cause.code?.includes("tampered") || cause.code?.includes("integrity") ? 409 : 422), { error: { code: cause.code ?? "journey_application_invalid", message: cause.message } });
    return true;
  }
}

function summary(item) { return { applicationId: item.applicationId, journeyType: item.journeyType, subjectRef: item.subjectRef, status: item.status, proposedAt: item.proposedAt, assignedCheckerId: item.assignedCheckerId, specialistCaseId: item.specialistCaseId, lifecycleId: item.lifecycleId, applicationChecksumSha256: item.applicationChecksumSha256 }; }
