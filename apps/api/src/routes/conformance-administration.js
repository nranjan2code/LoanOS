import {
  CONFORMANCE_CAMPAIGN_TARGET_TYPES,
  approveConformanceCampaign,
  assessConformanceCampaign,
  expireConformanceCampaigns,
  projectConformanceCampaignAdministration,
  proposeConformanceCampaign,
  proposeConformanceReassessment,
  recordConformanceCampaignEvidence,
  registerConformanceCandidateProfile
} from "@loanos/core";

const PREFIX = "/admin/conformance";

export async function routeConformanceAdministration(context) {
  const { method, path, req, res, tenant, authContext, store, readJson, sendJson, appendEvent, hasTenantAdminRole, authActor } = context;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  const roles = method === "GET" ? ["tenant_admin", "security_admin", "auditor"] : ["tenant_admin", "security_admin"];
  if (authContext?.principalType !== "tenant_user" || !hasTenantAdminRole(authContext, roles)) {
    sendJson(res, 403, { error: { code: "conformance_administration_forbidden", message: "A same-tenant human conformance administrator is required." } });
    return true;
  }
  const actor = authActor(authContext);
  try {
    const state = await store.load();
    if (method === "GET" && path === `${PREFIX}/summary`) {
      sendJson(res, 200, { summary: projectConformanceCampaignAdministration(state, tenant.tenantId), targetTypes: CONFORMANCE_CAMPAIGN_TARGET_TYPES }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/candidates`) {
      const body = await readJson(req);
      const result = registerConformanceCandidateProfile(state.conformanceCandidateProfiles, { ...body, tenantId: tenant.tenantId, createdBy: actor, executionMode: "simulated", commerciallyLive: false });
      if (!result.idempotent) await save(store, appendEvent, { ...state, conformanceCandidateProfiles: result.registry }, "conformance.candidate_registered", actor, { profileId: result.profile.profileId, profileChecksumSha256: result.profile.profileChecksumSha256 });
      sendJson(res, result.idempotent ? 200 : 201, { profile: result.profile, idempotent: result.idempotent }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/campaigns/proposals`) {
      const body = await readJson(req);
      const result = proposeConformanceCampaign(state.conformanceCampaigns, state.conformanceCandidateProfiles, { ...body, tenantId: tenant.tenantId, proposedBy: actor, executionMode: "simulated", commerciallyLive: false });
      await save(store, appendEvent, { ...state, conformanceCampaigns: result.registry }, "conformance.campaign_proposed", actor, { campaignId: result.campaign.campaignId, targetType: result.campaign.targetType, targetId: result.campaign.targetId, manifestChecksumSha256: result.campaign.manifestChecksumSha256 });
      sendJson(res, 201, { campaign: result.campaign }); return true;
    }
    const approval = match(path, `${PREFIX}/campaigns/`, "/approval");
    if (method === "POST" && approval) {
      const body = await readJson(req);
      const result = approveConformanceCampaign(state.conformanceCampaigns, state.conformanceCandidateProfiles, { ...body, tenantId: tenant.tenantId, campaignId: approval, approvedBy: actor });
      if (!result.idempotent) await save(store, appendEvent, { ...state, conformanceCampaigns: result.registry }, "conformance.campaign_approved", actor, { campaignId: result.campaign.campaignId, manifestChecksumSha256: result.campaign.manifestChecksumSha256 });
      sendJson(res, 200, { campaign: result.campaign, idempotent: result.idempotent }); return true;
    }
    const evidence = match(path, `${PREFIX}/campaigns/`, "/evidence");
    if (method === "POST" && evidence) {
      const body = await readJson(req);
      const result = recordConformanceCampaignEvidence(state.conformanceCampaigns, state.conformanceCandidateProfiles, { ...body, tenantId: tenant.tenantId, campaignId: evidence, executedBy: actor, executionMode: "simulated", commerciallyLive: false });
      if (!result.idempotent) await save(store, appendEvent, { ...state, conformanceCampaigns: result.registry }, "conformance.campaign_evidence_recorded", actor, { campaignId: result.campaign.campaignId, scenarioId: result.result.scenarioId, passed: result.result.passed, evidenceChecksumSha256: result.result.evidenceChecksumSha256 });
      sendJson(res, result.idempotent ? 200 : 201, { campaign: result.campaign, result: result.result, idempotent: result.idempotent }); return true;
    }
    const assessment = match(path, `${PREFIX}/campaigns/`, "/assessment");
    if (method === "POST" && assessment) {
      const body = await readJson(req);
      const result = assessConformanceCampaign(state.conformanceCampaigns, state.conformanceCandidateProfiles, { ...body, tenantId: tenant.tenantId, campaignId: assessment, assessedBy: actor });
      await save(store, appendEvent, { ...state, conformanceCampaigns: result.registry }, "conformance.campaign_assessed", actor, { campaignId: result.campaign.campaignId, status: result.campaign.status, assessmentChecksumSha256: result.assessment.assessmentChecksumSha256 });
      sendJson(res, 200, { campaign: result.campaign, assessment: result.assessment }); return true;
    }
    const reassessment = match(path, `${PREFIX}/campaigns/`, "/reassessment");
    if (method === "POST" && reassessment) {
      const body = await readJson(req);
      const result = proposeConformanceReassessment(state.conformanceCampaigns, state.conformanceCandidateProfiles, { ...body, tenantId: tenant.tenantId, previousCampaignId: reassessment, proposedBy: actor, executionMode: "simulated", commerciallyLive: false });
      await save(store, appendEvent, { ...state, conformanceCampaigns: result.registry }, "conformance.reassessment_proposed", actor, { campaignId: result.campaign.campaignId, previousCampaignId: reassessment, manifestChecksumSha256: result.campaign.manifestChecksumSha256 });
      sendJson(res, 201, { campaign: result.campaign }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/campaigns/expire`) {
      const result = expireConformanceCampaigns(state.conformanceCampaigns, { tenantId: tenant.tenantId });
      if (result.changed) await save(store, appendEvent, { ...state, conformanceCampaigns: result.registry }, "conformance.campaigns_expired", actor, { campaignIds: result.expiredCampaignIds });
      sendJson(res, 200, { expiredCampaignIds: result.expiredCampaignIds, changed: result.changed }); return true;
    }
    sendJson(res, 404, { error: { code: "not_found", message: "Conformance administration route not found." } }); return true;
  } catch (error) {
    sendJson(res, statusFor(error.code), { error: { code: error.code ?? "conformance_administration_invalid", message: error.message } }); return true;
  }
}

function match(path, prefix, suffix) {
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return null;
  const encoded = path.slice(prefix.length, -suffix.length);
  return encoded && !encoded.includes("/") ? decodeURIComponent(encoded) : null;
}
async function save(store, appendEvent, state, type, actor, details) { await store.save(appendEvent(state, { type, actor, ...details })); }
function statusFor(code = "") { if (code.includes("forbidden")) return 403; if (code.includes("missing")) return 404; if (code.includes("exists") || code.includes("conflict") || code.includes("four_eyes") || code.includes("not_pending") || code.includes("immutable")) return 409; return 422; }
