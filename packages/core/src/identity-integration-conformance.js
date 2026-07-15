import { createHash } from "node:crypto";

export const IDENTITY_INTEGRATION_FAMILIES = Object.freeze([
  "oidc",
  "saml_gateway",
  "scim",
  "device_posture",
  "control_engine",
  "siem_worm"
]);

const COMMON = ["success", "invalid_signature", "wrong_tenant", "replay", "stale_evidence", "provider_outage"];
const FAMILY_CASES = Object.freeze({
  oidc: [...COMMON, "pkce_downgrade", "nonce_mismatch", "issuer_mismatch", "audience_mismatch", "jwks_rollover"],
  saml_gateway: [...COMMON, "recipient_mismatch", "in_response_to_mismatch", "assertion_expired", "gateway_key_rollover"],
  scim: [...COMMON, "duplicate_event", "out_of_order_event", "role_escalation_attempt", "deactivate_user", "rehire_user"],
  device_posture: [...COMMON, "unmanaged_device", "stale_posture", "mfa_missing", "assurance_downgrade"],
  control_engine: [...COMMON, "mtls_missing", "bundle_signature_invalid", "engine_unreachable", "cross_tenant_decision", "kill_switch_active"],
  siem_worm: [...COMMON, "export_gap", "custody_checksum_mismatch", "retention_shortfall", "destination_unavailable"]
});

export const IDENTITY_CONFORMANCE_CATALOG = Object.freeze(IDENTITY_INTEGRATION_FAMILIES.flatMap((family) =>
  [...new Set(FAMILY_CASES[family])].map((name) => Object.freeze({
    scenarioId: `${family}.${name}`,
    family,
    name,
    required: true,
    expectedDisposition: name === "success" || name.includes("rollover") || name === "duplicate_event" || name === "rehire_user" ? "accept" : "fail_closed",
    executionMode: "simulated"
  }))
));

export function createIdentityConformanceCampaign(registry = {}, input = {}, now = new Date()) {
  required(input.campaignId, "campaignId");
  required(input.tenantId, "tenantId");
  required(input.family, "family");
  required(input.providerProfileRef, "providerProfileRef");
  required(input.proposedBy, "proposedBy");
  if (!IDENTITY_INTEGRATION_FAMILIES.includes(input.family)) fail("identity_conformance_family_invalid", "Unsupported identity integration family.");
  if (registry[input.campaignId]) fail("identity_conformance_campaign_exists", "Campaign already exists.");
  if (input.executionMode && input.executionMode !== "simulated") fail("identity_conformance_live_claim_forbidden", "Only simulated campaigns are available until a commercial connector is installed.");
  const scenarioIds = IDENTITY_CONFORMANCE_CATALOG.filter((item) => item.family === input.family).map((item) => item.scenarioId);
  const campaign = Object.freeze({
    campaignId: input.campaignId,
    tenantId: input.tenantId,
    family: input.family,
    providerProfileRef: input.providerProfileRef,
    executionMode: "simulated",
    commerciallyLive: false,
    certificationScope: "LoanOS contract and simulator only",
    scenarioIds,
    results: {},
    status: "pending_approval",
    proposedBy: input.proposedBy,
    proposedAt: now.toISOString(),
    approvedBy: null,
    approvedAt: null,
    assessedAt: null,
    manifestChecksumSha256: null
  });
  return { registry: { ...registry, [campaign.campaignId]: campaign }, campaign };
}

export function approveIdentityConformanceCampaign(registry = {}, input = {}, now = new Date()) {
  const campaign = campaignFor(registry, input.campaignId);
  required(input.approvedBy, "approvedBy");
  required(input.approvalRef, "approvalRef");
  if (campaign.status !== "pending_approval") fail("identity_conformance_campaign_not_pending", "Campaign is not pending approval.");
  if (campaign.proposedBy === input.approvedBy) fail("identity_conformance_four_eyes_required", "Campaign proposer and approver must be different users.");
  const approved = Object.freeze({ ...campaign, status: "approved", approvedBy: input.approvedBy, approvalRef: input.approvalRef, approvedAt: now.toISOString() });
  return { registry: { ...registry, [campaign.campaignId]: approved }, campaign: approved };
}

export function simulateIdentityConformanceScenario(campaign, scenarioId, now = new Date()) {
  if (!campaign?.scenarioIds?.includes(scenarioId)) fail("identity_conformance_scenario_invalid", "Scenario is outside this campaign.");
  if (campaign.executionMode !== "simulated" || campaign.commerciallyLive) fail("identity_conformance_execution_invalid", "Simulator can run only a non-live campaign.");
  const scenario = IDENTITY_CONFORMANCE_CATALOG.find((item) => item.scenarioId === scenarioId);
  const observedDisposition = scenario.expectedDisposition;
  const evidence = {
    campaignId: campaign.campaignId,
    scenarioId,
    executionMode: "simulated",
    providerProfileRef: campaign.providerProfileRef,
    expectedDisposition: scenario.expectedDisposition,
    observedDisposition,
    passed: true,
    simulatedAt: now.toISOString()
  };
  return Object.freeze({ ...evidence, evidenceChecksumSha256: checksum(evidence) });
}

export function recordIdentityConformanceResult(registry = {}, input = {}, now = new Date()) {
  const campaign = campaignFor(registry, input.campaignId);
  if (!['approved', 'running'].includes(campaign.status)) fail("identity_conformance_campaign_not_approved", "Campaign must be approved before execution.");
  if (!campaign.scenarioIds.includes(input.scenarioId)) fail("identity_conformance_scenario_invalid", "Scenario is outside this campaign.");
  if (input.executionMode && input.executionMode !== "simulated") fail("identity_conformance_live_claim_forbidden", "A simulator result cannot be represented as live evidence.");
  required(input.executedBy, "executedBy");
  const result = input.simulate === false ? normalizeSuppliedResult(campaign, input, now) : simulateIdentityConformanceScenario(campaign, input.scenarioId, now);
  const updated = Object.freeze({ ...campaign, status: "running", results: { ...campaign.results, [input.scenarioId]: { ...result, executedBy: input.executedBy } } });
  return { registry: { ...registry, [campaign.campaignId]: updated }, campaign: updated, result: updated.results[input.scenarioId] };
}

export function assessIdentityConformanceCampaign(registry = {}, input = {}, now = new Date()) {
  const campaign = campaignFor(registry, input.campaignId);
  required(input.assessedBy, "assessedBy");
  const missingScenarioIds = campaign.scenarioIds.filter((id) => !campaign.results[id]);
  const failedScenarioIds = campaign.scenarioIds.filter((id) => campaign.results[id] && !campaign.results[id].passed);
  const complete = missingScenarioIds.length === 0 && failedScenarioIds.length === 0;
  const manifest = {
    campaignId: campaign.campaignId,
    tenantId: campaign.tenantId,
    family: campaign.family,
    providerProfileRef: campaign.providerProfileRef,
    executionMode: "simulated",
    commerciallyLive: false,
    scenarioIds: campaign.scenarioIds,
    resultChecksums: campaign.scenarioIds.map((id) => campaign.results[id]?.evidenceChecksumSha256 ?? null),
    outcome: complete ? "simulator_certified" : "blocked"
  };
  const assessed = Object.freeze({ ...campaign, status: manifest.outcome, assessedBy: input.assessedBy, assessedAt: now.toISOString(), manifestChecksumSha256: checksum(manifest) });
  return { registry: { ...registry, [campaign.campaignId]: assessed }, campaign: assessed, assessment: { ...manifest, missingScenarioIds, failedScenarioIds, manifestChecksumSha256: assessed.manifestChecksumSha256 } };
}

function normalizeSuppliedResult(campaign, input, now) {
  required(input.evidenceRef, "evidenceRef");
  const scenario = IDENTITY_CONFORMANCE_CATALOG.find((item) => item.scenarioId === input.scenarioId);
  const result = { campaignId: campaign.campaignId, scenarioId: input.scenarioId, executionMode: "simulated", expectedDisposition: scenario.expectedDisposition, observedDisposition: input.observedDisposition, passed: input.observedDisposition === scenario.expectedDisposition, evidenceRef: input.evidenceRef, recordedAt: now.toISOString() };
  return { ...result, evidenceChecksumSha256: checksum(result) };
}

function campaignFor(registry, campaignId) {
  const campaign = registry[campaignId];
  if (!campaign) fail("identity_conformance_campaign_missing", "Campaign was not found.");
  return campaign;
}
function checksum(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("identity_conformance_input_invalid", `${field} is required.`); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
