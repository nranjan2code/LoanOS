import {
  approveComposedJourneyTransition,
  createComposedJourneyInstance,
  pauseComposedJourneyInstance,
  projectComposedJourneyPortfolio,
  proposeComposedJourneyTransition,
  recordComposedJourneyFailure,
  resumeComposedJourneyInstance
} from "../../../../packages/core/src/index.js";

const PREFIX = "/admin/composed-journeys";
const READ_ROLES = ["tenant_admin", "operator", "credit_manager", "security_admin", "auditor"];
const WRITE_ROLES = ["tenant_admin", "operator", "credit_manager", "security_admin"];
const APPROVAL_ROLES = ["tenant_admin", "credit_manager", "security_admin"];

export async function routeComposedJourneys(context) {
  const { method, path, req, res, tenant, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;

  const roles = method === "GET" ? READ_ROLES : isApprovalPath(path) ? APPROVAL_ROLES : WRITE_ROLES;
  if (authContext?.principalType !== "tenant_user" || !hasTenantAdminRole(authContext, roles)) {
    sendJson(res, 403, {
      error: {
        code: "composed_journey_forbidden",
        message: "A same-tenant authorised human lending operator is required."
      }
    });
    return true;
  }

  const actor = authActor(authContext);
  try {
    const state = await store.load();
    if (method === "GET" && path === PREFIX) {
      sendJson(res, 200, { workspace: projectComposedJourneyPortfolio(state, { tenantId: tenant.tenantId }) });
      return true;
    }
    if (method !== "POST") return false;

    const body = await readJson(req);
    let result;
    let eventType;
    let status = 201;
    if (path === `${PREFIX}/instances`) {
      result = createComposedJourneyInstance(state, {
        ...body,
        tenantId: tenant.tenantId,
        createdBy: actor
      });
      eventType = "composed_journey.instance_created";
      status = result.idempotent ? 200 : 201;
    } else {
      const transitionInstanceId = match(path, `${PREFIX}/instances/`, "/transitions");
      const transitionId = match(path, `${PREFIX}/transitions/`, "/approval");
      const failureInstanceId = match(path, `${PREFIX}/instances/`, "/failures");
      const pauseInstanceId = match(path, `${PREFIX}/instances/`, "/pause");
      const resumeInstanceId = match(path, `${PREFIX}/instances/`, "/resume");
      if (transitionInstanceId) {
        result = proposeComposedJourneyTransition(state, {
          ...body,
          tenantId: tenant.tenantId,
          lifecycleId: transitionInstanceId,
          proposedBy: actor
        });
        eventType = "composed_journey.transition_proposed";
        status = result.idempotent ? 200 : 201;
      } else if (transitionId) {
        result = approveComposedJourneyTransition(state, {
          ...body,
          tenantId: tenant.tenantId,
          transitionId,
          approvedBy: actor
        });
        eventType = result.blocked ? "composed_journey.transition_blocked" : "composed_journey.transition_approved";
        status = result.blocked ? 422 : 200;
      } else if (failureInstanceId) {
        result = recordComposedJourneyFailure(state, {
          ...body,
          tenantId: tenant.tenantId,
          lifecycleId: failureInstanceId,
          recordedBy: actor
        });
        eventType = "composed_journey.failure_recorded";
        status = result.idempotent ? 200 : 201;
      } else if (pauseInstanceId) {
        result = pauseComposedJourneyInstance(state, {
          ...body,
          tenantId: tenant.tenantId,
          lifecycleId: pauseInstanceId,
          pausedBy: actor
        });
        eventType = "composed_journey.paused";
        status = 200;
      } else if (resumeInstanceId) {
        result = resumeComposedJourneyInstance(state, {
          ...body,
          tenantId: tenant.tenantId,
          lifecycleId: resumeInstanceId,
          resumedBy: actor
        });
        eventType = "composed_journey.resume_proposed";
        status = result.idempotent ? 200 : 201;
      } else return false;
    }

    await store.save(appendEvent(result.state, auditEvent(eventType, actor, result)));
    sendJson(res, status, response(result));
    return true;
  } catch (cause) {
    sendJson(res, errorStatus(cause), {
      error: { code: cause.code ?? "composed_journey_invalid", message: cause.message }
    });
    return true;
  }
}

function auditEvent(type, actor, result) {
  const instance = result.lifecycle ?? result.instance ?? result.journey ?? null;
  const transition = result.transition ?? result.request ?? null;
  const failure = result.failure ?? null;
  return {
    type,
    actor,
    lifecycleId: instance?.lifecycleId ?? transition?.lifecycleId ?? failure?.lifecycleId,
    transitionId: transition?.transitionId,
    failureId: failure?.failureId,
    status: transition?.status ?? failure?.status ?? instance?.status,
    stage: instance?.currentStage ?? instance?.stage,
    revision: instance?.revision,
    evidenceChecksumSha256: transition?.transitionChecksumSha256 ?? failure?.failureChecksumSha256 ?? instance?.stateChecksumSha256
  };
}

function response(result) {
  const { state, persistedInstance, ...body } = result;
  return body;
}

function isApprovalPath(path) {
  const prefix = `${PREFIX}/transitions/`;
  const suffix = "/approval";
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return false;
  const value = path.slice(prefix.length, -suffix.length);
  return Boolean(value && !value.includes("/"));
}

function match(path, prefix, suffix) {
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return null;
  const value = path.slice(prefix.length, -suffix.length);
  return value && !value.includes("/") ? decodeURIComponent(value) : null;
}

function errorStatus(cause) {
  if (cause.statusCode) return cause.statusCode;
  const code = cause.code ?? "";
  if (code.includes("forbidden") || code.includes("not_entitled")) return 403;
  if (code.includes("not_found") || code.includes("missing")) return 404;
  if (code.includes("conflict") || code.includes("exists") || code.includes("stale")) return 409;
  return 422;
}
