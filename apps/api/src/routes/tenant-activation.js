import { assessTenantActivation } from "@loanos/core";

const PREFIX = "/admin/tenant-activation";

export async function routeTenantActivation(context) {
  const { method, path, req, res, tenant, authContext, store, readJson, sendJson, appendEvent, hasTenantAdminRole, authActor } = context;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  if (authContext?.principalType !== "tenant_user" || !hasTenantAdminRole(authContext, method === "GET" ? ["tenant_admin", "security_admin", "auditor"] : ["tenant_admin", "security_admin"])) {
    sendJson(res, 403, { error: { code: "tenant_activation_forbidden", message: "A same-tenant human administrator is required." } }); return true;
  }
  try {
    const state = await store.load();
    if (method === "GET" && path === `${PREFIX}/assessments`) {
      sendJson(res, 200, { assessments: Object.values(state.tenantActivationAssessments ?? {}).map((record) => record.assessment), policy: { simulatorEvidenceCanReachProduction: false, activationRequiresPlatformApproval: true } }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/assessments`) {
      const body = await readJson(req); const assessment = assessTenantActivation({ ...body, tenantId: tenant.tenantId });
      if (state.tenantActivationAssessments?.[assessment.assessmentId]) throw Object.assign(new Error("Activation assessment ID already exists."), { code: "tenant_activation_assessment_exists" });
      const record = Object.freeze({ assessment, input: { ...body, tenantId: tenant.tenantId }, assessedBy: authActor(authContext), recordedAt: new Date().toISOString(), activationAuthority: "platform_independent_approval_required" });
      const next = { ...state, tenantActivationAssessments: { ...(state.tenantActivationAssessments ?? {}), [assessment.assessmentId]: record } };
      await store.save(appendEvent(next, { type: "tenant.activation.assessed", assessmentId: assessment.assessmentId, status: assessment.status, assessmentChecksumSha256: assessment.assessmentChecksumSha256, blockerCount: assessment.blockers.length, productionGapCount: assessment.productionGaps.length, actor: authActor(authContext) }));
      sendJson(res, 201, { assessment, activationAuthority: record.activationAuthority }); return true;
    }
    sendJson(res, 404, { error: { code: "not_found", message: "Tenant activation route not found." } }); return true;
  } catch (error) {
    sendJson(res, error.code?.includes("exists") ? 409 : 422, { error: { code: error.code ?? "tenant_activation_invalid", message: error.message } }); return true;
  }
}
