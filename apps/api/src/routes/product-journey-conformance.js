import {
  PRODUCT_JOURNEY_TYPES,
  approveProductJourneyConformanceCampaign,
  assessProductJourneyConformanceCampaign,
  projectProductJourneyConformanceCoverage,
  recordProductJourneyConformanceResult,
  registerProductJourneyConformanceCampaign
} from "@loanos/core";
import {
  buildProductJourneyGeneratedConformanceMatrix,
  createProductJourneyDownstreamConformanceExecutor,
  runProductJourneyGeneratedConformance
} from "@loanos/core/journeys/product-journey-generated-conformance.js";

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
    const generatedExecution = match(path, `${PREFIX}/campaigns/`, "/generated-execution");
    if (method === "POST" && generatedExecution) {
      const key = `${tenant.tenantId}:${generatedExecution}`;
      const campaign = registry[key];
      if (!campaign || !["approved", "executing"].includes(campaign.status) || campaign.tenantId !== tenant.tenantId) throw coded("journey_conformance_campaign_invalid", "An approved same-tenant campaign is required.");
      if (campaign.executionMode === "live" || campaign.commerciallyLive === true) throw coded("journey_generated_conformance_live_claim_forbidden", "Repository-generated execution is non-production evidence only.");
      const matrix = buildProductJourneyGeneratedConformanceMatrix({
        tenantId: tenant.tenantId,
        journeyTypes: [campaign.journeyType],
        lanes: ["api_file"],
        templateVersions: { [campaign.journeyType]: campaign.templateVersion },
        templateChecksums: { [campaign.journeyType]: campaign.templateChecksumSha256 }
      });
      const run = await runProductJourneyGeneratedConformance({
        matrix,
        executors: {
          api_file: createProductJourneyDownstreamConformanceExecutor({
            now: campaign.approvedAt,
            evidencePrefix: `repository://jd05/${campaign.manifestChecksumSha256}`
          })
        }
      });
      if (!run.summary.allPassed || run.summary.productionReady !== false) throw coded("journey_generated_conformance_execution_incomplete", "Every generated non-production scenario must pass with evidence before persistence.");
      let nextRegistry = registry;
      let createdCount = 0;
      for (const observed of run.results) {
        const recorded = recordProductJourneyConformanceResult(nextRegistry, {
          tenantId: tenant.tenantId,
          campaignId: generatedExecution,
          scenarioId: observed.scenarioId,
          outcome: observed.outcome,
          executedBy: actor,
          evidenceRef: observed.evidenceRef,
          evidenceChecksumSha256: observed.observation.evidenceChecksumSha256,
          sourceRunRef: `repository://jd05/run/${run.matrixChecksumSha256}`
        }, new Date(campaign.approvedAt));
        nextRegistry = recorded.registry;
        if (!recorded.idempotent) createdCount += 1;
      }
      if (createdCount > 0) await save(store, appendEvent, state, nextRegistry, "product_journey.generated_conformance_executed", actor, { campaignId: generatedExecution, journeyType: campaign.journeyType, matrixChecksumSha256: run.matrixChecksumSha256, resultCount: run.results.length });
      sendJson(res, createdCount > 0 ? 201 : 200, { run, createdCount, idempotent: createdCount === 0 }); return true;
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
function coded(code, message) { return Object.assign(new Error(message), { code }); }
