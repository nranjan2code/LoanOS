import {
  PRODUCT_JOURNEY_TYPES,
  approveProductJourneyConformanceCampaign,
  assessProductJourneyConformanceCampaign,
  projectProductJourneyConformanceCoverage,
  recordProductJourneyConformanceResult,
  registerProductJourneyConformanceCampaign
} from "@loanos/core";

const PREFIX = "/admin/product-journey-conformance";

export async function routeProductJourneyConformance(context) {
  const { method, path, req, res, tenant, authContext, store, readJson, sendJson, appendEvent, hasTenantAdminRole, authActor } = context;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  if (authContext?.principalType !== "tenant_user" || !hasTenantAdminRole(authContext, method === "GET" ? ["tenant_admin", "auditor", "compliance_admin", "security_admin"] : ["tenant_admin", "compliance_admin", "security_admin"])) {
    sendJson(res, 403, { error: { code: "product_journey_conformance_forbidden", message: "A same-tenant human product-control administrator is required." } }); return true;
  }
  const actor = authActor(authContext);
  try {
    const state = await store.load();
    const registry = state.productJourneyConformanceCampaigns ?? {};
    if (method === "GET" && path === PREFIX) {
      sendJson(res, 200, { catalogue: PRODUCT_JOURNEY_TYPES, coverage: projectProductJourneyConformanceCoverage(registry, tenant.tenantId), campaigns: Object.values(registry).filter((item) => item.tenantId === tenant.tenantId) }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/campaigns`) {
      const body = await readJson(req); const result = registerProductJourneyConformanceCampaign(registry, { ...body, tenantId: tenant.tenantId, proposedBy: actor });
      if (!result.idempotent) await save(store, appendEvent, state, result.registry, "product_journey.conformance_proposed", actor, { campaignId: result.campaign.campaignId, journeyType: result.campaign.journeyType, manifestChecksumSha256: result.campaign.manifestChecksumSha256 });
      sendJson(res, result.idempotent ? 200 : 201, { campaign: result.campaign, idempotent: result.idempotent }); return true;
    }
    const approval = match(path, `${PREFIX}/campaigns/`, "/approval");
    if (method === "POST" && approval) {
      const body = await readJson(req); const result = approveProductJourneyConformanceCampaign(registry, { ...body, tenantId: tenant.tenantId, campaignId: approval, approvedBy: actor });
      await save(store, appendEvent, state, result.registry, "product_journey.conformance_approved", actor, { campaignId: approval, approvalRef: result.campaign.approvalRef });
      sendJson(res, 200, { campaign: result.campaign }); return true;
    }
    const resultPath = match(path, `${PREFIX}/campaigns/`, "/results");
    if (method === "POST" && resultPath) {
      const body = await readJson(req); const result = recordProductJourneyConformanceResult(registry, { ...body, tenantId: tenant.tenantId, campaignId: resultPath, executedBy: actor });
      if (!result.idempotent) await save(store, appendEvent, state, result.registry, "product_journey.conformance_result_recorded", actor, { campaignId: resultPath, scenarioId: result.result.scenarioId, outcome: result.result.outcome, resultChecksumSha256: result.result.resultChecksumSha256 });
      sendJson(res, result.idempotent ? 200 : 201, { result: result.result, idempotent: result.idempotent }); return true;
    }
    const assessment = match(path, `${PREFIX}/campaigns/`, "/assessment");
    if (method === "POST" && assessment) {
      const body = await readJson(req); const result = assessProductJourneyConformanceCampaign(registry, { ...body, tenantId: tenant.tenantId, campaignId: assessment, assessedBy: actor });
      await save(store, appendEvent, state, result.registry, "product_journey.conformance_assessed", actor, { campaignId: assessment, status: result.assessment.status, assessmentChecksumSha256: result.assessment.assessmentChecksumSha256 });
      sendJson(res, 200, { assessment: result.assessment }); return true;
    }
    sendJson(res, 404, { error: { code: "not_found", message: "Product journey conformance route not found." } }); return true;
  } catch (error) {
    sendJson(res, error.code?.includes("conflict") ? 409 : 422, { error: { code: error.code ?? "product_journey_conformance_invalid", message: error.message } }); return true;
  }
}

async function save(store, appendEvent, state, registry, type, actor, data) { await store.save(appendEvent({ ...state, productJourneyConformanceCampaigns: registry }, { type, actor, ...data })); }
function match(path, prefix, suffix) { if (!path.startsWith(prefix) || !path.endsWith(suffix)) return null; const value = path.slice(prefix.length, -suffix.length); return value && !value.includes("/") ? decodeURIComponent(value) : null; }
