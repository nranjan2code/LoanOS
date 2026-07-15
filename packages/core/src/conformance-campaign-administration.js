import { createHash } from "node:crypto";

import {
  ORGANISATION_ADMISSION_CONFORMANCE_PACKS,
  ORGANISATION_ADMISSION_INTEGRATIONS
} from "./organisation-admission-conformance.js";
import {
  ENTERPRISE_PLATFORM_CONFORMANCE_PACKS,
  ENTERPRISE_PLATFORM_FAMILIES
} from "./enterprise-platform-conformance.js";

export const CONFORMANCE_CAMPAIGN_TARGET_TYPES = Object.freeze([
  "organisation_admission",
  "enterprise_platform"
]);

export const CONFORMANCE_CAMPAIGN_STATUSES = Object.freeze([
  "pending_approval",
  "approved",
  "running",
  "simulator_certified",
  "blocked",
  "expired"
]);

export const CONFORMANCE_CERTIFICATION_MAX_DAYS = 366;

export function registerConformanceCandidateProfile(registry = {}, input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId");
  const profileId = required(input.profileId, "profileId");
  rejectLiveClaim(input);
  const organisationAdmissionIntegrationIds = canonicalUnique(input.organisationAdmissionIntegrationIds ?? []);
  const enterprisePlatformFamilies = canonicalUnique(input.enterprisePlatformFamilies ?? []);
  if (!organisationAdmissionIntegrationIds.length && !enterprisePlatformFamilies.length) {
    fail("conformance_candidate_scope_missing", "At least one canonical simulator scope is required.");
  }
  const knownIntegrations = new Set(ORGANISATION_ADMISSION_INTEGRATIONS.map((item) => item.integrationId));
  for (const integrationId of organisationAdmissionIntegrationIds) {
    if (!knownIntegrations.has(integrationId)) fail("conformance_candidate_scope_invalid", `Unsupported organisation-admission integration: ${integrationId}.`);
  }
  for (const family of enterprisePlatformFamilies) {
    if (!ENTERPRISE_PLATFORM_FAMILIES.includes(family)) fail("conformance_candidate_scope_invalid", `Unsupported enterprise-platform family: ${family}.`);
  }
  const immutable = {
    schemaVersion: "conformance-candidate-profile/v1",
    tenantId,
    profileId,
    providerName: required(input.providerName, "providerName"),
    providerCategory: required(input.providerCategory, "providerCategory"),
    adapterContractVersion: required(input.adapterContractVersion, "adapterContractVersion"),
    simulatorConfigurationRef: required(input.simulatorConfigurationRef, "simulatorConfigurationRef"),
    dueDiligenceRef: required(input.dueDiligenceRef, "dueDiligenceRef"),
    organisationAdmissionIntegrationIds,
    enterprisePlatformFamilies,
    executionMode: "simulated",
    simulated: true,
    commerciallyLive: false,
    activationAuthority: "none",
    createdBy: required(input.createdBy, "createdBy")
  };
  const profileContentChecksumSha256 = checksum(immutable);
  const key = scopedKey(tenantId, profileId);
  const prior = registry[key];
  if (prior) {
    verifyProfile(prior, tenantId);
    if (prior.profileContentChecksumSha256 !== profileContentChecksumSha256) fail("conformance_candidate_profile_conflict", "Candidate profile identity was reused with different immutable content.");
    return { registry, profile: prior, idempotent: true };
  }
  const envelope = { ...immutable, profileContentChecksumSha256, createdAt: normalizeTime(now) };
  const profile = deepFreeze({ ...envelope, profileChecksumSha256: checksum(envelope) });
  return { registry: { ...registry, [key]: profile }, profile, idempotent: false };
}

export function proposeConformanceCampaign(registry = {}, profileRegistry = {}, input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId");
  const campaignId = required(input.campaignId, "campaignId");
  const profile = profileFor(profileRegistry, tenantId, required(input.profileId, "profileId"));
  rejectLiveClaim(input);
  const targetType = required(input.targetType, "targetType");
  const targetId = required(input.targetId, "targetId");
  assertProfileScope(profile, targetType, targetId);
  const validityDays = positiveInteger(input.validityDays ?? 90, "validityDays");
  if (validityDays > CONFORMANCE_CERTIFICATION_MAX_DAYS) fail("conformance_campaign_validity_invalid", `validityDays cannot exceed ${CONFORMANCE_CERTIFICATION_MAX_DAYS}.`);
  const key = scopedKey(tenantId, campaignId);
  if (registry[key]) fail("conformance_campaign_exists", "Campaign already exists for this tenant.");
  const manifest = buildManifest({
    tenantId,
    campaignId,
    profile,
    targetType,
    targetId,
    validityDays,
    reassessmentOfCampaignId: nullableString(input.reassessmentOfCampaignId)
  });
  const proposedAt = normalizeTime(now);
  const campaign = sealCampaign({
    schemaVersion: "conformance-campaign/v1",
    tenantId,
    campaignId,
    profileId: profile.profileId,
    profileChecksumSha256: profile.profileChecksumSha256,
    targetType,
    targetId,
    executionMode: "simulated",
    simulated: true,
    commerciallyLive: false,
    status: "pending_approval",
    manifest,
    manifestChecksumSha256: manifest.manifestChecksumSha256,
    results: {},
    replayIndex: {},
    proposedBy: required(input.proposedBy, "proposedBy"),
    proposalRef: required(input.proposalRef, "proposalRef"),
    proposedAt,
    approvedBy: null,
    approvalRef: null,
    approvedAt: null,
    assessedBy: null,
    assessedAt: null,
    assessmentChecksumSha256: null,
    certifiedUntil: null,
    expiredAt: null
  });
  return { registry: { ...registry, [key]: campaign }, campaign };
}

export function approveConformanceCampaign(registry = {}, profileRegistry = {}, input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId");
  const campaign = campaignFor(registry, tenantId, required(input.campaignId, "campaignId"), profileRegistry);
  const approvedBy = required(input.approvedBy, "approvedBy");
  const approvalRef = required(input.approvalRef, "approvalRef");
  if (campaign.status === "approved" && campaign.approvedBy === approvedBy && campaign.approvalRef === approvalRef) {
    return { registry, campaign, idempotent: true };
  }
  if (campaign.status !== "pending_approval") fail("conformance_campaign_not_pending", "Campaign is not pending approval.");
  if (campaign.proposedBy === approvedBy) fail("conformance_campaign_four_eyes_required", "Campaign proposer and approver must be different principals.");
  const approved = sealCampaign({ ...campaign, status: "approved", approvedBy, approvalRef, approvedAt: normalizeTime(now) });
  return { registry: replaceCampaign(registry, approved), campaign: approved, idempotent: false };
}

export function recordConformanceCampaignEvidence(registry = {}, profileRegistry = {}, input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId");
  const campaign = campaignFor(registry, tenantId, required(input.campaignId, "campaignId"), profileRegistry);
  if (!["approved", "running"].includes(campaign.status)) fail("conformance_campaign_not_executable", "Only an approved or running campaign can record evidence.");
  rejectLiveClaim(input);
  const scenarioId = required(input.scenarioId, "scenarioId");
  const definition = scenarioDefinition(campaign.manifest, scenarioId);
  const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
  const replayKey = checksum(`${tenantId}:${campaign.campaignId}:${idempotencyKey}`);
  const replayedScenarioId = campaign.replayIndex[replayKey];
  if (replayedScenarioId) {
    const prior = campaign.results[replayedScenarioId];
    verifyResult(campaign, prior);
    const attempted = resultCanonical(campaign, definition, input, prior.recordedAt);
    if (replayedScenarioId !== scenarioId || prior.evidenceChecksumSha256 !== checksum(attempted)) {
      fail("conformance_campaign_replay_conflict", "Idempotency key was replayed with different evidence content.");
    }
    return { registry, campaign, result: prior, idempotent: true };
  }
  if (campaign.results[scenarioId]) fail("conformance_campaign_evidence_immutable", "Scenario evidence is immutable and cannot be replaced.");
  const canonical = resultCanonical(campaign, definition, input, normalizeTime(now));
  const result = deepFreeze({ ...canonical, evidenceChecksumSha256: checksum(canonical) });
  const updated = sealCampaign({
    ...campaign,
    status: "running",
    results: { ...campaign.results, [scenarioId]: result },
    replayIndex: { ...campaign.replayIndex, [replayKey]: scenarioId }
  });
  return { registry: replaceCampaign(registry, updated), campaign: updated, result, idempotent: false };
}

export function assessConformanceCampaign(registry = {}, profileRegistry = {}, input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId");
  const campaign = campaignFor(registry, tenantId, required(input.campaignId, "campaignId"), profileRegistry);
  if (!["approved", "running"].includes(campaign.status)) fail("conformance_campaign_not_assessable", "Only an approved or running campaign can be assessed.");
  const assessedBy = required(input.assessedBy, "assessedBy");
  const assessmentRef = required(input.assessmentRef, "assessmentRef");
  const missingScenarioIds = campaign.manifest.scenarios.map((item) => item.scenarioId).filter((id) => !campaign.results[id]);
  const invalidScenarioIds = [];
  const failedScenarioIds = [];
  for (const [scenarioId, result] of Object.entries(campaign.results)) {
    try { verifyResult(campaign, result); } catch { invalidScenarioIds.push(scenarioId); continue; }
    if (!result.passed) failedScenarioIds.push(scenarioId);
  }
  const status = missingScenarioIds.length || invalidScenarioIds.length || failedScenarioIds.length ? "blocked" : "simulator_certified";
  if (status === "simulator_certified" && Object.values(campaign.results).some((result) => result.executedBy === assessedBy)) fail("conformance_campaign_assessor_independence_required", "Simulator certification requires an assessor independent of every evidence executor.");
  const assessedAt = normalizeTime(now);
  const certifiedUntil = status === "simulator_certified"
    ? new Date(Date.parse(assessedAt) + campaign.manifest.validityDays * 86_400_000).toISOString()
    : null;
  const assessment = {
    schemaVersion: "conformance-campaign-assessment/v1",
    tenantId,
    campaignId: campaign.campaignId,
    profileId: campaign.profileId,
    targetType: campaign.targetType,
    targetId: campaign.targetId,
    executionMode: "simulated",
    simulated: true,
    commerciallyLive: false,
    status,
    manifestChecksumSha256: campaign.manifestChecksumSha256,
    resultChecksums: campaign.manifest.scenarios.map((item) => campaign.results[item.scenarioId]?.evidenceChecksumSha256 ?? null),
    missingScenarioIds,
    failedScenarioIds,
    invalidScenarioIds,
    assessedBy,
    assessmentRef,
    assessedAt,
    certifiedUntil
  };
  const assessmentChecksumSha256 = checksum(assessment);
  const updated = sealCampaign({ ...campaign, status, assessedBy, assessmentRef, assessedAt, certifiedUntil, assessmentChecksumSha256 });
  return {
    registry: replaceCampaign(registry, updated),
    campaign: updated,
    assessment: deepFreeze({ ...assessment, assessmentChecksumSha256 })
  };
}

export function expireConformanceCampaigns(registry = {}, input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId");
  const at = normalizeTime(now);
  let changed = false;
  const expiredCampaignIds = [];
  const next = { ...registry };
  for (const [key, candidate] of Object.entries(registry)) {
    if (candidate?.tenantId !== tenantId || candidate.status !== "simulator_certified") continue;
    verifyCampaign(candidate);
    if (!candidate.certifiedUntil || Date.parse(candidate.certifiedUntil) > Date.parse(at)) continue;
    const expired = sealCampaign({ ...candidate, status: "expired", expiredAt: at });
    next[key] = expired;
    expiredCampaignIds.push(candidate.campaignId);
    changed = true;
  }
  return { registry: changed ? next : registry, expiredCampaignIds: Object.freeze(expiredCampaignIds.sort()), changed };
}

export function proposeConformanceReassessment(registry = {}, profileRegistry = {}, input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId");
  const previous = campaignFor(registry, tenantId, required(input.previousCampaignId, "previousCampaignId"), profileRegistry);
  if (!["simulator_certified", "blocked", "expired"].includes(previous.status)) fail("conformance_campaign_reassessment_invalid", "Only a completed, blocked, or expired campaign can originate a reassessment.");
  if (previous.status === "simulator_certified" && Date.parse(previous.certifiedUntil) > normalizeDate(now).getTime()) {
    fail("conformance_campaign_reassessment_not_due", "Certification is still current; explicit expiry or elapsed validity is required.");
  }
  return proposeConformanceCampaign(registry, profileRegistry, {
    ...input,
    tenantId,
    profileId: previous.profileId,
    targetType: previous.targetType,
    targetId: previous.targetId,
    reassessmentOfCampaignId: previous.campaignId
  }, now);
}

export function projectConformanceCampaignAdministration(state = {}, tenantId, now = new Date()) {
  required(tenantId, "tenantId");
  const profiles = Object.values(state.conformanceCandidateProfiles ?? {}).filter((item) => item?.tenantId === tenantId);
  const campaigns = Object.values(state.conformanceCampaigns ?? {}).filter((item) => item?.tenantId === tenantId);
  for (const profile of profiles) verifyProfile(profile, tenantId);
  for (const campaign of campaigns) verifyCampaign(campaign, tenantId);
  const currentAt = normalizeDate(now).getTime();
  return deepFreeze({
    tenantId,
    executionMode: "simulated",
    commerciallyLive: false,
    profileCount: profiles.length,
    campaignCount: campaigns.length,
    profiles,
    campaigns,
    totals: {
      pendingApproval: campaigns.filter((item) => item.status === "pending_approval").length,
      running: campaigns.filter((item) => item.status === "running").length,
      certifiedCurrent: campaigns.filter((item) => item.status === "simulator_certified" && Date.parse(item.certifiedUntil) > currentAt).length,
      reassessmentDue: campaigns.filter((item) => item.status === "expired" || (item.status === "simulator_certified" && Date.parse(item.certifiedUntil) <= currentAt)).length,
      blocked: campaigns.filter((item) => item.status === "blocked").length
    },
    generatedAt: normalizeTime(now)
  });
}

function buildManifest({ tenantId, campaignId, profile, targetType, targetId, validityDays, reassessmentOfCampaignId }) {
  const scenarios = targetType === "organisation_admission"
    ? ORGANISATION_ADMISSION_CONFORMANCE_PACKS[targetId].map((item) => ({
      scenarioId: item.scenarioId,
      expectedDisposition: item.expectedDisposition,
      expectedSafetyState: null,
      definitionChecksumSha256: item.sourceChecksumSha256
    }))
    : ENTERPRISE_PLATFORM_CONFORMANCE_PACKS[targetId].map((item) => ({
      scenarioId: item.scenarioId,
      expectedDisposition: item.expectedDisposition,
      expectedSafetyState: item.safetyState,
      definitionChecksumSha256: checksum(item)
    }));
  const unsigned = {
    schemaVersion: "conformance-campaign-manifest/v1",
    tenantId,
    campaignId,
    profileId: profile.profileId,
    profileChecksumSha256: profile.profileChecksumSha256,
    targetType,
    targetId,
    validityDays,
    reassessmentOfCampaignId,
    executionMode: "simulated",
    simulated: true,
    commerciallyLive: false,
    certificationScope: "LoanOS canonical contract and deterministic simulator only",
    scenarios
  };
  return deepFreeze({ ...unsigned, manifestChecksumSha256: checksum(unsigned) });
}

function resultCanonical(campaign, definition, input, recordedAt) {
  const expectedSafetyState = definition.expectedSafetyState;
  const observedDisposition = required(input.observedDisposition, "observedDisposition");
  const observedSafetyState = expectedSafetyState === null ? null : required(input.observedSafetyState, "observedSafetyState");
  return {
    schemaVersion: "conformance-campaign-evidence/v1",
    tenantId: campaign.tenantId,
    campaignId: campaign.campaignId,
    profileId: campaign.profileId,
    targetType: campaign.targetType,
    targetId: campaign.targetId,
    scenarioId: definition.scenarioId,
    executionMode: "simulated",
    simulated: true,
    commerciallyLive: false,
    manifestChecksumSha256: campaign.manifestChecksumSha256,
    definitionChecksumSha256: definition.definitionChecksumSha256,
    expectedDisposition: definition.expectedDisposition,
    observedDisposition,
    expectedSafetyState,
    observedSafetyState,
    passed: observedDisposition === definition.expectedDisposition && observedSafetyState === expectedSafetyState,
    runId: required(input.runId, "runId"),
    evidenceRef: required(input.evidenceRef, "evidenceRef"),
    executedBy: required(input.executedBy, "executedBy"),
    idempotencyKeySha256: checksum(`${campaign.tenantId}:${campaign.campaignId}:${required(input.idempotencyKey, "idempotencyKey")}`),
    recordedAt
  };
}

function campaignFor(registry, tenantId, campaignId, profileRegistry) {
  const campaign = registry[scopedKey(tenantId, campaignId)];
  if (!campaign) fail("conformance_campaign_missing", "Campaign was not found for this tenant.");
  verifyCampaign(campaign, tenantId);
  const profile = profileFor(profileRegistry, tenantId, campaign.profileId);
  if (profile.profileChecksumSha256 !== campaign.profileChecksumSha256) fail("conformance_campaign_profile_changed", "Candidate profile lineage no longer matches the campaign manifest.");
  return campaign;
}

function profileFor(registry, tenantId, profileId) {
  const profile = registry[scopedKey(tenantId, profileId)];
  if (!profile) fail("conformance_candidate_profile_missing", "Candidate profile was not found for this tenant.");
  verifyProfile(profile, tenantId);
  return profile;
}

function verifyProfile(profile, tenantId = profile?.tenantId) {
  if (!profile || profile.tenantId !== tenantId || profile.executionMode !== "simulated" || profile.simulated !== true || profile.commerciallyLive !== false || profile.activationAuthority !== "none") {
    fail("conformance_candidate_profile_invalid", "A tenant-bound non-live candidate profile is required.");
  }
  const { profileChecksumSha256, ...envelope } = profile;
  if (checksum(envelope) !== profileChecksumSha256) fail("conformance_candidate_profile_tampered", "Candidate profile checksum validation failed.");
  const { profileContentChecksumSha256, createdAt, ...immutable } = envelope;
  if (checksum(immutable) !== profileContentChecksumSha256) fail("conformance_candidate_profile_tampered", "Candidate profile content checksum validation failed.");
  if (normalizeTime(createdAt) !== createdAt) fail("conformance_candidate_profile_invalid", "Candidate profile creation time is invalid.");
}

function verifyCampaign(campaign, tenantId = campaign?.tenantId) {
  if (!campaign || campaign.tenantId !== tenantId || campaign.executionMode !== "simulated" || campaign.simulated !== true || campaign.commerciallyLive !== false || !CONFORMANCE_CAMPAIGN_STATUSES.includes(campaign.status)) {
    fail("conformance_campaign_invalid", "A tenant-bound simulator-only campaign is required.");
  }
  const manifest = campaign.manifest;
  if (!manifest || manifest.manifestChecksumSha256 !== campaign.manifestChecksumSha256) fail("conformance_campaign_manifest_tampered", "Campaign manifest lineage is invalid.");
  const { manifestChecksumSha256, ...unsigned } = manifest;
  if (checksum(unsigned) !== manifestChecksumSha256) fail("conformance_campaign_manifest_tampered", "Campaign manifest checksum validation failed.");
  if (manifest.tenantId !== campaign.tenantId || manifest.campaignId !== campaign.campaignId || manifest.profileId !== campaign.profileId || manifest.targetType !== campaign.targetType || manifest.targetId !== campaign.targetId) {
    fail("conformance_campaign_manifest_tampered", "Campaign manifest scope does not match its envelope.");
  }
  assertCanonicalManifest(manifest);
  for (const result of Object.values(campaign.results ?? {})) verifyResult(campaign, result);
  const indexedScenarioIds = new Set();
  for (const [idempotencyKeySha256, scenarioId] of Object.entries(campaign.replayIndex ?? {})) {
    const result = campaign.results?.[scenarioId];
    if (!/^[a-f0-9]{64}$/.test(idempotencyKeySha256) || !result || result.idempotencyKeySha256 !== idempotencyKeySha256 || indexedScenarioIds.has(scenarioId)) {
      fail("conformance_campaign_replay_index_tampered", "Campaign replay index does not match its immutable evidence.");
    }
    indexedScenarioIds.add(scenarioId);
  }
  if (indexedScenarioIds.size !== Object.keys(campaign.results ?? {}).length) fail("conformance_campaign_replay_index_tampered", "Every evidence result must have one replay index entry.");
  const { campaignStateChecksumSha256, ...unsignedCampaign } = campaign;
  if (checksum(unsignedCampaign) !== campaignStateChecksumSha256) fail("conformance_campaign_state_tampered", "Campaign state checksum validation failed.");
}

function assertCanonicalManifest(manifest) {
  if (manifest.schemaVersion !== "conformance-campaign-manifest/v1" || manifest.executionMode !== "simulated" || manifest.simulated !== true || manifest.commerciallyLive !== false || manifest.certificationScope !== "LoanOS canonical contract and deterministic simulator only") {
    fail("conformance_campaign_manifest_invalid", "Campaign manifest is not simulator-only or uses an unsupported schema.");
  }
  const expected = buildManifest({
    tenantId: manifest.tenantId,
    campaignId: manifest.campaignId,
    profile: { profileId: manifest.profileId, profileChecksumSha256: manifest.profileChecksumSha256 },
    targetType: manifest.targetType,
    targetId: manifest.targetId,
    validityDays: manifest.validityDays,
    reassessmentOfCampaignId: manifest.reassessmentOfCampaignId
  });
  if (expected.manifestChecksumSha256 !== manifest.manifestChecksumSha256) fail("conformance_campaign_manifest_stale", "Campaign manifest no longer matches the canonical scenario pack.");
}

function verifyResult(campaign, result) {
  if (!result || result.tenantId !== campaign.tenantId || result.campaignId !== campaign.campaignId || result.profileId !== campaign.profileId || result.targetType !== campaign.targetType || result.targetId !== campaign.targetId || result.executionMode !== "simulated" || result.simulated !== true || result.commerciallyLive !== false || result.manifestChecksumSha256 !== campaign.manifestChecksumSha256) {
    fail("conformance_campaign_evidence_invalid", "Evidence is outside the campaign scope or claims live execution.");
  }
  const definition = scenarioDefinition(campaign.manifest, result.scenarioId);
  const { evidenceChecksumSha256, ...unsigned } = result;
  if (checksum(unsigned) !== evidenceChecksumSha256 || result.definitionChecksumSha256 !== definition.definitionChecksumSha256 || result.expectedDisposition !== definition.expectedDisposition || result.expectedSafetyState !== definition.expectedSafetyState) {
    fail("conformance_campaign_evidence_tampered", "Evidence checksum or canonical expectation validation failed.");
  }
  const expectedPass = result.observedDisposition === result.expectedDisposition && result.observedSafetyState === result.expectedSafetyState;
  if (result.passed !== expectedPass) fail("conformance_campaign_evidence_tampered", "Evidence pass status is inconsistent with observed outcomes.");
}

function scenarioDefinition(manifest, scenarioId) {
  const definition = manifest.scenarios.find((item) => item.scenarioId === scenarioId);
  if (!definition) fail("conformance_campaign_scenario_invalid", "Scenario is outside the immutable campaign manifest.");
  return definition;
}

function assertProfileScope(profile, targetType, targetId) {
  if (!CONFORMANCE_CAMPAIGN_TARGET_TYPES.includes(targetType)) fail("conformance_campaign_target_invalid", "Unsupported campaign target type.");
  const allowed = targetType === "organisation_admission"
    ? profile.organisationAdmissionIntegrationIds.includes(targetId)
    : profile.enterprisePlatformFamilies.includes(targetId);
  if (!allowed) fail("conformance_campaign_target_not_profiled", "Campaign target is outside the candidate profile scope.");
}

function replaceCampaign(registry, campaign) {
  return { ...registry, [scopedKey(campaign.tenantId, campaign.campaignId)]: campaign };
}

function sealCampaign(value) {
  const { campaignStateChecksumSha256: _priorChecksum, ...unsigned } = value;
  return deepFreeze({ ...unsigned, campaignStateChecksumSha256: checksum(unsigned) });
}

function rejectLiveClaim(input) {
  if (input.executionMode && input.executionMode !== "simulated") fail("conformance_campaign_live_claim_forbidden", "Only simulated conformance administration is available.");
  if (input.commerciallyLive === true || input.activationAuthority === "production") fail("conformance_campaign_live_claim_forbidden", "Simulator evidence cannot establish a commercial or production activation.");
}

function scopedKey(tenantId, id) { return `${tenantId}:${id}`; }
function checksum(value) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function canonicalUnique(values) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) fail("conformance_campaign_input_invalid", "Scope lists must contain non-empty strings.");
  return Object.freeze([...new Set(values.map((value) => value.trim()))].sort());
}
function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) fail("conformance_campaign_input_invalid", `${field} must be a positive integer.`);
  return value;
}
function required(value, field) {
  if (typeof value !== "string" || !value.trim()) fail("conformance_campaign_input_invalid", `${field} is required.`);
  return value.trim();
}
function nullableString(value) {
  if (value == null || value === "") return null;
  return required(value, "reassessmentOfCampaignId");
}
function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail("conformance_campaign_input_invalid", "A valid date-time is required.");
  return date;
}
function normalizeTime(value) { return normalizeDate(value).toISOString(); }
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
