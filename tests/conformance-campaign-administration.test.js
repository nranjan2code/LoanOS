import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFORMANCE_CAMPAIGN_STATUSES,
  CONFORMANCE_CAMPAIGN_TARGET_TYPES,
  approveConformanceCampaign,
  assessConformanceCampaign,
  expireConformanceCampaigns,
  projectConformanceCampaignAdministration,
  proposeConformanceCampaign,
  proposeConformanceReassessment,
  recordConformanceCampaignEvidence,
  registerConformanceCandidateProfile
} from "@loanos/core/operations/conformance-campaign-administration.js";

const T0 = new Date("2026-07-15T00:00:00.000Z");
const DAY_2 = new Date("2026-07-17T00:00:00.000Z");

function candidate(registry = {}, overrides = {}) {
  return registerConformanceCandidateProfile(registry, {
    tenantId: "tenant-a",
    profileId: "candidate-1",
    providerName: "Candidate Provider",
    providerCategory: "platform_and_admission",
    adapterContractVersion: "adapter/v1",
    simulatorConfigurationRef: "simulator/config/1",
    dueDiligenceRef: "diligence/candidate-1",
    organisationAdmissionIntegrationIds: ["INT-ADM-09"],
    enterprisePlatformFamilies: ["deployment_controller"],
    createdBy: "user-profile-maker",
    ...overrides
  }, T0);
}

function proposed(campaigns, profiles, overrides = {}) {
  return proposeConformanceCampaign(campaigns, profiles, {
    tenantId: "tenant-a",
    campaignId: "campaign-1",
    profileId: "candidate-1",
    targetType: "organisation_admission",
    targetId: "INT-ADM-09",
    validityDays: 1,
    proposedBy: "user-maker",
    proposalRef: "change/conformance-1",
    ...overrides
  }, T0);
}

function approved(campaigns, profiles, overrides = {}) {
  return approveConformanceCampaign(campaigns, profiles, {
    tenantId: "tenant-a",
    campaignId: "campaign-1",
    approvedBy: "user-checker",
    approvalRef: "approval/conformance-1",
    ...overrides
  }, T0);
}

function completeCampaign(campaigns, profiles, campaignId = "campaign-1", recordedAt = T0) {
  let registry = campaigns;
  const campaign = registry[`tenant-a:${campaignId}`];
  for (const scenario of campaign.manifest.scenarios) {
    const recorded = recordConformanceCampaignEvidence(registry, profiles, {
      tenantId: "tenant-a",
      campaignId,
      scenarioId: scenario.scenarioId,
      idempotencyKey: `run:${scenario.scenarioId}`,
      runId: `run:${scenario.scenarioId}`,
      observedDisposition: scenario.expectedDisposition,
      observedSafetyState: scenario.expectedSafetyState ?? undefined,
      evidenceRef: `evidence/${scenario.scenarioId}`,
      executedBy: "conformance-runner"
    }, recordedAt);
    registry = recorded.registry;
  }
  return registry;
}

test("candidate profiles are tenant scoped, checksum sealed, idempotent, and never live", () => {
  assert.deepEqual(CONFORMANCE_CAMPAIGN_TARGET_TYPES, ["organisation_admission", "enterprise_platform"]);
  assert.ok(CONFORMANCE_CAMPAIGN_STATUSES.includes("simulator_certified"));
  const first = candidate();
  assert.equal(first.profile.executionMode, "simulated");
  assert.equal(first.profile.simulated, true);
  assert.equal(first.profile.commerciallyLive, false);
  assert.equal(first.profile.activationAuthority, "none");
  assert.match(first.profile.profileChecksumSha256, /^[a-f0-9]{64}$/);
  assert.equal(candidate(first.registry).idempotent, true);
  assert.throws(() => candidate(first.registry, { providerName: "Changed Provider" }), (error) => error.code === "conformance_candidate_profile_conflict");
  assert.throws(() => candidate({}, { commerciallyLive: true }), (error) => error.code === "conformance_campaign_live_claim_forbidden");
  assert.throws(() => candidate({}, { enterprisePlatformFamilies: ["unknown"] }), (error) => error.code === "conformance_candidate_scope_invalid");

  const tampered = { ...first.registry, "tenant-a:candidate-1": { ...first.profile, providerName: "Tampered" } };
  assert.throws(() => proposed({}, tampered), (error) => error.code === "conformance_candidate_profile_tampered");
  assert.throws(() => proposed({}, first.registry, { tenantId: "tenant-b" }), (error) => error.code === "conformance_candidate_profile_missing");
});

test("campaign proposal seals a complete canonical manifest and approval enforces four eyes", () => {
  const profiles = candidate().registry;
  const result = proposed({}, profiles);
  const campaign = result.campaign;
  assert.equal(campaign.status, "pending_approval");
  assert.equal(campaign.manifest.scenarios.length, 16);
  assert.equal(campaign.manifest.executionMode, "simulated");
  assert.equal(campaign.manifest.commerciallyLive, false);
  assert.match(campaign.manifestChecksumSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => approved(result.registry, profiles, { approvedBy: "user-maker" }), (error) => error.code === "conformance_campaign_four_eyes_required");
  const approval = approved(result.registry, profiles);
  assert.equal(approval.campaign.status, "approved");
  assert.equal(approved(approval.registry, profiles).idempotent, true);
  assert.throws(() => proposed({}, profiles, { targetId: "INT-ADM-01" }), (error) => error.code === "conformance_campaign_target_not_profiled");
  assert.throws(() => proposed({}, profiles, { executionMode: "live" }), (error) => error.code === "conformance_campaign_live_claim_forbidden");

  const alteredManifest = { ...approval.campaign.manifest, validityDays: 365 };
  const tampered = { ...approval.registry, "tenant-a:campaign-1": { ...approval.campaign, manifest: alteredManifest } };
  assert.throws(() => recordConformanceCampaignEvidence(tampered, profiles, {
    tenantId: "tenant-a", campaignId: "campaign-1", scenarioId: campaign.manifest.scenarios[0].scenarioId,
    idempotencyKey: "run-1", observedDisposition: campaign.manifest.scenarios[0].expectedDisposition,
    evidenceRef: "evidence/1", executedBy: "runner"
  }, T0), (error) => error.code === "conformance_campaign_manifest_tampered");
});

test("scenario evidence is append-only, replay safe, tenant bound, and tamper evident", () => {
  const profiles = candidate().registry;
  const proposedResult = proposed({}, profiles);
  const approval = approved(proposedResult.registry, profiles);
  const scenario = approval.campaign.manifest.scenarios[0];
  const input = {
    tenantId: "tenant-a",
    campaignId: "campaign-1",
    scenarioId: scenario.scenarioId,
    idempotencyKey: "execution-1",
    runId: "execution-1",
    observedDisposition: scenario.expectedDisposition,
    evidenceRef: "worm/evidence-1",
    executedBy: "runner-1"
  };
  const first = recordConformanceCampaignEvidence(approval.registry, profiles, input, T0);
  assert.equal(first.result.passed, true);
  assert.equal(first.result.commerciallyLive, false);
  assert.match(first.result.evidenceChecksumSha256, /^[a-f0-9]{64}$/);
  assert.equal(recordConformanceCampaignEvidence(first.registry, profiles, input, DAY_2).idempotent, true);
  assert.throws(() => recordConformanceCampaignEvidence(first.registry, profiles, { ...input, evidenceRef: "changed" }, DAY_2), (error) => error.code === "conformance_campaign_replay_conflict");
  assert.throws(() => recordConformanceCampaignEvidence(first.registry, profiles, { ...input, idempotencyKey: "new-key" }, DAY_2), (error) => error.code === "conformance_campaign_evidence_immutable");
  assert.throws(() => recordConformanceCampaignEvidence(first.registry, profiles, { ...input, tenantId: "tenant-b" }, T0), (error) => error.code === "conformance_campaign_missing");

  const tamperedResult = { ...first.result, observedDisposition: "tampered" };
  const tamperedCampaign = { ...first.campaign, results: { [scenario.scenarioId]: tamperedResult } };
  const tamperedRegistry = { ...first.registry, "tenant-a:campaign-1": tamperedCampaign };
  assert.throws(() => assessConformanceCampaign(tamperedRegistry, profiles, { tenantId: "tenant-a", campaignId: "campaign-1", assessedBy: "checker", assessmentRef: "assessment/1" }, T0), (error) => error.code === "conformance_campaign_evidence_tampered");

  const replayIndexRemoved = { ...first.campaign, replayIndex: {} };
  assert.throws(() => assessConformanceCampaign({ ...first.registry, "tenant-a:campaign-1": replayIndexRemoved }, profiles, {
    tenantId: "tenant-a", campaignId: "campaign-1", assessedBy: "checker", assessmentRef: "assessment/2"
  }, T0), (error) => error.code === "conformance_campaign_replay_index_tampered");

  const actorTampered = { ...first.campaign, approvedBy: "attacker" };
  assert.throws(() => assessConformanceCampaign({ ...first.registry, "tenant-a:campaign-1": actorTampered }, profiles, {
    tenantId: "tenant-a", campaignId: "campaign-1", assessedBy: "checker", assessmentRef: "assessment/3"
  }, T0), (error) => error.code === "conformance_campaign_state_tampered");
});

test("organisation-admission and enterprise-platform campaigns certify only complete passing evidence", () => {
  const profiles = candidate().registry;
  let campaigns = approved(proposed({}, profiles).registry, profiles).registry;
  campaigns = completeCampaign(campaigns, profiles);
  assert.throws(() => assessConformanceCampaign(campaigns, profiles, {
    tenantId: "tenant-a", campaignId: "campaign-1", assessedBy: "conformance-runner", assessmentRef: "assessment/self"
  }, T0), (error) => error.code === "conformance_campaign_assessor_independence_required");
  const admissionAssessment = assessConformanceCampaign(campaigns, profiles, {
    tenantId: "tenant-a", campaignId: "campaign-1", assessedBy: "assessor", assessmentRef: "assessment/admission"
  }, T0);
  assert.equal(admissionAssessment.assessment.status, "simulator_certified");
  assert.equal(admissionAssessment.assessment.resultChecksums.length, 16);
  assert.equal(admissionAssessment.campaign.certifiedUntil, "2026-07-16T00:00:00.000Z");

  const enterpriseProposal = proposed(admissionAssessment.registry, profiles, {
    campaignId: "enterprise-1",
    targetType: "enterprise_platform",
    targetId: "deployment_controller"
  });
  const enterpriseApproval = approveConformanceCampaign(enterpriseProposal.registry, profiles, {
    tenantId: "tenant-a", campaignId: "enterprise-1", approvedBy: "user-checker", approvalRef: "approval/enterprise"
  }, T0);
  const enterpriseComplete = completeCampaign(enterpriseApproval.registry, profiles, "enterprise-1");
  const enterpriseAssessment = assessConformanceCampaign(enterpriseComplete, profiles, {
    tenantId: "tenant-a", campaignId: "enterprise-1", assessedBy: "assessor", assessmentRef: "assessment/enterprise"
  }, T0);
  assert.equal(enterpriseAssessment.assessment.status, "simulator_certified");
  assert.ok(enterpriseAssessment.assessment.resultChecksums.length >= 13);
  assert.equal(enterpriseAssessment.assessment.commerciallyLive, false);

  const incompleteProposal = proposed(enterpriseAssessment.registry, profiles, { campaignId: "incomplete-1" });
  const incompleteApproval = approveConformanceCampaign(incompleteProposal.registry, profiles, {
    tenantId: "tenant-a", campaignId: "incomplete-1", approvedBy: "user-checker", approvalRef: "approval/incomplete"
  }, T0);
  const blocked = assessConformanceCampaign(incompleteApproval.registry, profiles, {
    tenantId: "tenant-a", campaignId: "incomplete-1", assessedBy: "assessor", assessmentRef: "assessment/incomplete"
  }, T0);
  assert.equal(blocked.assessment.status, "blocked");
  assert.equal(blocked.assessment.missingScenarioIds.length, 16);
});

test("expiry is tenant-local and reassessment creates a new immutable four-eyes campaign", () => {
  const profilesA = candidate().registry;
  const profilesB = candidate(profilesA, { tenantId: "tenant-b", profileId: "candidate-b" }).registry;
  let campaigns = approved(proposed({}, profilesB).registry, profilesB).registry;
  campaigns = completeCampaign(campaigns, profilesB);
  campaigns = assessConformanceCampaign(campaigns, profilesB, {
    tenantId: "tenant-a", campaignId: "campaign-1", assessedBy: "assessor", assessmentRef: "assessment/1"
  }, T0).registry;
  const expiration = expireConformanceCampaigns(campaigns, { tenantId: "tenant-a" }, DAY_2);
  assert.deepEqual(expiration.expiredCampaignIds, ["campaign-1"]);
  assert.equal(expiration.registry["tenant-a:campaign-1"].status, "expired");

  const reassessment = proposeConformanceReassessment(expiration.registry, profilesB, {
    tenantId: "tenant-a",
    previousCampaignId: "campaign-1",
    campaignId: "campaign-2",
    validityDays: 30,
    proposedBy: "new-maker",
    proposalRef: "change/reassessment-1"
  }, DAY_2);
  assert.equal(reassessment.campaign.status, "pending_approval");
  assert.equal(reassessment.campaign.manifest.reassessmentOfCampaignId, "campaign-1");
  assert.equal(reassessment.registry["tenant-a:campaign-1"].status, "expired");
  assert.throws(() => approveConformanceCampaign(reassessment.registry, profilesB, {
    tenantId: "tenant-a", campaignId: "campaign-2", approvedBy: "new-maker", approvalRef: "same-actor"
  }, DAY_2), (error) => error.code === "conformance_campaign_four_eyes_required");
  assert.deepEqual(expireConformanceCampaigns(reassessment.registry, { tenantId: "tenant-b" }, DAY_2).expiredCampaignIds, []);

  const projection = projectConformanceCampaignAdministration({
    conformanceCandidateProfiles: profilesB,
    conformanceCampaigns: reassessment.registry
  }, "tenant-a", DAY_2);
  assert.equal(projection.profileCount, 1);
  assert.equal(projection.totals.pendingApproval, 1);
  assert.equal(projection.totals.reassessmentDue, 1);
  assert.equal(projection.commerciallyLive, false);
});
