import {
  approveSpecialistJourneyAction,
  approveSpecialistJourneyConfiguration,
  openSpecialistJourneyCase,
  pauseComposedJourneysForProduct,
  projectSpecialistJourneyWorkspace,
  proposeSpecialistJourneyAction,
  proposeSpecialistJourneyConfiguration,
  suspendSpecialistJourneyConfiguration
} from "@loanos/core";

const PREFIX = "/admin/specialist-journeys";

export async function routeSpecialistJourneys(context) {
  const { method, path, req, res, tenant, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  const allowed = method === "GET" ? ["tenant_admin", "auditor", "operator", "credit_manager", "security_admin"] : ["tenant_admin", "operator", "credit_manager", "security_admin"];
  if (authContext?.principalType !== "tenant_user" || !hasTenantAdminRole(authContext, allowed)) {
    sendJson(res, 403, { error: { code: "specialist_journey_forbidden", message: "A same-tenant human specialist-lending administrator is required." } });
    return true;
  }
  const actor = authActor(authContext);
  try {
    const state = await store.load();
    if (method === "GET" && path === PREFIX) {
      sendJson(res, 200, { workspace: projectSpecialistJourneyWorkspace(state, tenant.tenantId) });
      return true;
    }
    if (method !== "POST") return false;
    const body = await readJson(req);
    let result;
    let eventType;
    let status = 201;
    if (path === `${PREFIX}/configurations/proposals`) {
      result = proposeSpecialistJourneyConfiguration(state, { ...body, tenantId: tenant.tenantId, proposedBy: actor });
      eventType = "specialist_journey.configuration_proposed";
      status = result.idempotent ? 200 : 201;
    } else {
      const configurationApproval = match(path, `${PREFIX}/configurations/`, "/approval");
      const configurationSuspension = match(path, `${PREFIX}/configurations/`, "/suspension");
      const caseAction = match(path, `${PREFIX}/cases/`, "/actions");
      const actionApproval = match(path, `${PREFIX}/actions/`, "/approval");
      if (configurationApproval) {
        result = approveSpecialistJourneyConfiguration(state, { ...body, tenantId: tenant.tenantId, requestId: configurationApproval, approvedBy: actor });
        eventType = "specialist_journey.configuration_approved"; status = 200;
      } else if (configurationSuspension) {
        result = suspendSpecialistJourneyConfiguration(state, { ...body, tenantId: tenant.tenantId, configurationId: configurationSuspension, actor });
        const composed = pauseComposedJourneysForProduct(result.state, { tenantId: tenant.tenantId, journeyType: result.configuration.journeyType, actor, causeType: "specialist_configuration_suspended", causeRef: body.evidenceRef });
        result = { ...result, state: composed.state, affectedLifecycleIds: composed.affectedLifecycleIds, composedJourneyEscalations: composed.escalations };
        eventType = "specialist_journey.configuration_suspended"; status = 200;
      } else if (path === `${PREFIX}/cases`) {
        result = openSpecialistJourneyCase(state, { ...body, tenantId: tenant.tenantId, openedBy: actor });
        eventType = "specialist_journey.case_opened"; status = result.idempotent ? 200 : 201;
      } else if (caseAction) {
        result = proposeSpecialistJourneyAction(state, { ...body, tenantId: tenant.tenantId, caseId: caseAction, proposedBy: actor });
        eventType = "specialist_journey.action_proposed"; status = result.idempotent ? 200 : 201;
      } else if (actionApproval) {
        result = approveSpecialistJourneyAction(state, { ...body, tenantId: tenant.tenantId, actionId: actionApproval, approvedBy: actor });
        eventType = result.blocked ? "specialist_journey.action_blocked" : "specialist_journey.action_executed"; status = result.blocked ? 422 : 200;
      } else return false;
    }
    await store.save(appendEvent(result.state, auditEvent(eventType, actor, result)));
    sendJson(res, status, response(result));
    return true;
  } catch (cause) {
    sendJson(res, cause.code?.includes("conflict") || cause.code?.includes("exists") ? 409 : 422, { error: { code: cause.code ?? "specialist_journey_invalid", message: cause.message } });
    return true;
  }
}

function auditEvent(type, actor, result) {
  const record = result.configuration ?? result.request ?? result.case ?? result.action;
  return { type, actor, resourceId: record?.configurationId ?? record?.requestId ?? record?.caseId ?? record?.actionId, status: record?.status, evidenceChecksumSha256: record?.configurationChecksumSha256 ?? record?.requestChecksumSha256 ?? record?.caseChecksumSha256 ?? record?.actionChecksumSha256, affectedCaseIds: result.affectedCaseIds ?? undefined, affectedLifecycleIds: result.affectedLifecycleIds ?? undefined };
}
function response(result) { const { state, ...body } = result; return body; }
function match(path, prefix, suffix) { if (!path.startsWith(prefix) || !path.endsWith(suffix)) return null; const value = path.slice(prefix.length, -suffix.length); return value && !value.includes("/") ? decodeURIComponent(value) : null; }
