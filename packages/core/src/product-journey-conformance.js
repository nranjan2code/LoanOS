import { createHash } from "node:crypto";

import { PRODUCT_JOURNEY_TYPES, isCanonicalProductJourneyType } from "./product-journey-administration.js";

export const PRODUCT_JOURNEY_CONFORMANCE_BASELINE = Object.freeze([
  scenario("JRN-COM-001", "happy_lifecycle", "Complete tenant-scoped application-to-closure lifecycle."),
  scenario("JRN-COM-002", "policy_decline", "Policy decline is deterministic, reasoned and non-disbursable."),
  scenario("JRN-COM-003", "missing_evidence", "Missing mandatory evidence fails closed."),
  scenario("JRN-COM-004", "provider_timeout", "Provider timeout cannot become permissive success."),
  scenario("JRN-COM-005", "duplicate_replay", "Idempotent replay cannot duplicate a financial or workflow effect."),
  scenario("JRN-COM-006", "stale_version", "Stale policy, template or workflow versions are rejected."),
  scenario("JRN-COM-007", "cross_tenant", "Cross-tenant read, mutation and evidence reuse are rejected."),
  scenario("JRN-COM-008", "wrong_role", "A principal without the staffed role cannot act."),
  scenario("JRN-COM-009", "self_approval", "Maker and checker cannot be the same principal."),
  scenario("JRN-COM-010", "revocation_mid_work", "Revocation pauses in-flight work and creates visible escalation."),
  scenario("JRN-COM-011", "reconciliation_mismatch", "Provider, bank or accounting mismatch remains an open exception."),
  scenario("JRN-COM-012", "balanced_accounting", "Every posted journal and entity allocation balances exactly."),
  scenario("JRN-COM-013", "regulatory_output", "Applicable regulatory output retains source and acknowledgement lineage."),
  scenario("JRN-COM-014", "repayment_delinquency_closure", "Repayment, delinquency, recovery and closure preserve ledger truth."),
  scenario("JRN-COM-015", "rollback_recovery", "Failed provisioning or execution follows governed compensation/manual intervention."),
  scenario("JRN-COM-016", "audit_replay", "Decision and activity evidence reproduces without divergence.")
]);

export const PRODUCT_JOURNEY_ARCHETYPES = Object.freeze({
  agriculture_allied_finance: "seasonal_field",
  co_lending_programme: "co_lending",
  commercial_vehicle_finance: "asset_finance",
  consumer_durable_finance: "merchant_pos",
  education_loan: "priority_term",
  equipment_machinery_finance: "asset_finance",
  gold_loan: "gold_custody",
  green_equipment_finance: "asset_finance",
  home_loan: "property_secured",
  invoice_discounting: "trade_receivables",
  loan_against_property: "property_secured",
  microfinance_group_lending: "group_field",
  msme_term_loan: "business_term",
  msme_working_capital: "revolving_working_capital",
  personal_loan: "unsecured_term",
  personal_vehicle_loan: "asset_finance",
  professional_practice_loan: "business_term",
  purchase_order_finance: "trade_receivables",
  secured_business_loan: "property_secured",
  supply_chain_finance: "trade_receivables",
  trade_finance_workflow: "trade_receivables"
});

const ARCHETYPE_SCENARIOS = Object.freeze(Object.fromEntries([...new Set(Object.values(PRODUCT_JOURNEY_ARCHETYPES))].sort().map((archetype, index) => [archetype, scenario(`JRN-ARC-${String(index + 1).padStart(2, "0")}`, `${archetype}_specialist_path`, `The ${archetype} specialist facts, authority, documents, accounting and exception path are enforced.`)])));

export function buildProductJourneyConformanceManifest(input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const campaignId = text(input.campaignId, "campaignId");
  const journeyType = text(input.journeyType, "journeyType");
  if (!isCanonicalProductJourneyType(journeyType)) fail("journey_conformance_type_invalid", "A canonical product journey type is required.");
  const templateVersion = text(input.templateVersion, "templateVersion");
  const templateChecksumSha256 = sha(input.templateChecksumSha256, "templateChecksumSha256");
  const executionMode = oneOf(input.executionMode ?? "simulated", ["simulated", "sandbox", "live"], "executionMode");
  const commerciallyLive = input.commerciallyLive === true;
  if (executionMode !== "live" && commerciallyLive) fail("journey_conformance_mode_invalid", "Non-live conformance cannot be commercially live.");
  const proposedBy = text(input.proposedBy, "proposedBy");
  const archetype = PRODUCT_JOURNEY_ARCHETYPES[journeyType];
  const scenarios = [...PRODUCT_JOURNEY_CONFORMANCE_BASELINE, ARCHETYPE_SCENARIOS[archetype]];
  const immutable = { tenantId, campaignId, journeyType, archetype, templateVersion, templateChecksumSha256, executionMode, commerciallyLive, scenarioIds: scenarios.map((item) => item.scenarioId), scenarioCatalogueChecksumSha256: hash(scenarios), environmentRef: text(input.environmentRef, "environmentRef"), tenantConfigurationRef: text(input.tenantConfigurationRef, "tenantConfigurationRef") };
  const manifestChecksumSha256 = hash(immutable);
  const campaign = Object.freeze({ ...immutable, scenarios, manifestChecksumSha256, status: "proposed", proposedBy, proposedAt: instant(now).toISOString(), approvedBy: null, approvalRef: null, results: {}, assessment: null });
  return { campaign };
}

export function approveProductJourneyConformanceCampaign(registry = {}, input = {}, now = new Date()) {
  const key = campaignKey(input.tenantId, input.campaignId);
  const campaign = registry[key];
  if (!campaign || campaign.status !== "proposed" || campaign.tenantId !== input.tenantId) fail("journey_conformance_campaign_invalid", "A proposed same-tenant campaign is required.");
  verifyManifest(campaign);
  const approvedBy = text(input.approvedBy, "approvedBy");
  if (approvedBy === campaign.proposedBy) fail("journey_conformance_four_eyes", "Campaign approval requires a different authenticated human.");
  const approved = Object.freeze({ ...campaign, status: "approved", approvedBy, approvalRef: text(input.approvalRef, "approvalRef"), approvedAt: instant(now).toISOString() });
  return { registry: { ...registry, [key]: approved }, campaign: approved };
}

export function registerProductJourneyConformanceCampaign(registry = {}, input = {}, now = new Date()) {
  const built = buildProductJourneyConformanceManifest(input, now).campaign;
  const key = campaignKey(built.tenantId, built.campaignId);
  const prior = registry[key];
  if (prior) {
    if (prior.manifestChecksumSha256 !== built.manifestChecksumSha256) fail("journey_conformance_campaign_conflict", "Campaign identity was reused with a different manifest.");
    return { registry, campaign: prior, idempotent: true };
  }
  return { registry: { ...registry, [key]: built }, campaign: built, idempotent: false };
}

export function recordProductJourneyConformanceResult(registry = {}, input = {}, now = new Date()) {
  const key = campaignKey(input.tenantId, input.campaignId);
  const campaign = registry[key];
  if (!campaign || !["approved", "executing"].includes(campaign.status) || campaign.tenantId !== input.tenantId) fail("journey_conformance_campaign_invalid", "An approved same-tenant campaign is required.");
  verifyManifest(campaign);
  const scenarioId = text(input.scenarioId, "scenarioId");
  if (!campaign.scenarioIds.includes(scenarioId)) fail("journey_conformance_scenario_invalid", "Scenario is outside the approved manifest.");
  const outcome = oneOf(input.outcome, ["passed", "failed", "blocked"], "outcome");
  const immutable = { tenantId: campaign.tenantId, campaignId: campaign.campaignId, scenarioId, outcome, executedBy: text(input.executedBy, "executedBy"), evidenceRef: text(input.evidenceRef, "evidenceRef"), evidenceChecksumSha256: sha(input.evidenceChecksumSha256, "evidenceChecksumSha256"), sourceRunRef: text(input.sourceRunRef, "sourceRunRef") };
  const resultChecksumSha256 = hash(immutable);
  const prior = campaign.results?.[scenarioId];
  if (prior) {
    if (prior.resultChecksumSha256 !== resultChecksumSha256) fail("journey_conformance_result_conflict", "Scenario already has a different immutable result.");
    return { registry, campaign, result: prior, idempotent: true };
  }
  const result = Object.freeze({ ...immutable, resultChecksumSha256, recordedAt: instant(now).toISOString() });
  const updated = Object.freeze({ ...campaign, status: "executing", results: { ...(campaign.results ?? {}), [scenarioId]: result } });
  return { registry: { ...registry, [key]: updated }, campaign: updated, result, idempotent: false };
}

export function assessProductJourneyConformanceCampaign(registry = {}, input = {}, now = new Date()) {
  const key = campaignKey(input.tenantId, input.campaignId);
  const campaign = registry[key];
  if (!campaign || !["approved", "executing"].includes(campaign.status) || campaign.tenantId !== input.tenantId) fail("journey_conformance_campaign_invalid", "An approved same-tenant campaign is required.");
  verifyManifest(campaign);
  const assessedBy = text(input.assessedBy, "assessedBy");
  const executors = new Set(Object.values(campaign.results ?? {}).map((item) => item.executedBy));
  if (assessedBy === campaign.proposedBy || assessedBy === campaign.approvedBy || executors.has(assessedBy)) fail("journey_conformance_assessor_independence", "Assessment requires a human independent of proposal, approval and execution.");
  const missingScenarioIds = campaign.scenarioIds.filter((scenarioId) => !campaign.results?.[scenarioId]);
  const failedScenarioIds = campaign.scenarioIds.filter((scenarioId) => campaign.results?.[scenarioId]?.outcome !== "passed" && campaign.results?.[scenarioId]);
  const allPassed = missingScenarioIds.length === 0 && failedScenarioIds.length === 0;
  const liveEligible = allPassed && campaign.executionMode === "live" && campaign.commerciallyLive && Boolean(input.productionAcceptanceRef);
  const status = !allPassed ? "blocked" : liveEligible ? "ready_for_tenant_activation" : "controlled_first_slice";
  const assessmentCore = { tenantId: campaign.tenantId, campaignId: campaign.campaignId, journeyType: campaign.journeyType, templateVersion: campaign.templateVersion, status, allPassed, executionMode: campaign.executionMode, commerciallyLive: campaign.commerciallyLive, missingScenarioIds, failedScenarioIds, productionAcceptanceRef: liveEligible ? input.productionAcceptanceRef : null, assessedBy };
  const assessment = Object.freeze({ ...assessmentCore, assessmentChecksumSha256: hash(assessmentCore), assessedAt: instant(now).toISOString() });
  const completed = Object.freeze({ ...campaign, status: "assessed", assessment });
  return { registry: { ...registry, [key]: completed }, campaign: completed, assessment };
}

export function projectProductJourneyConformanceCoverage(registry = {}, tenantId) {
  text(tenantId, "tenantId");
  const campaigns = Object.values(registry).filter((item) => item.tenantId === tenantId);
  const journeys = PRODUCT_JOURNEY_TYPES.map((journeyType) => {
    const candidates = campaigns.filter((item) => item.journeyType === journeyType && item.status === "assessed").sort((a, b) => String(b.assessment?.assessedAt).localeCompare(String(a.assessment?.assessedAt)));
    const latest = candidates[0];
    return { journeyType, archetype: PRODUCT_JOURNEY_ARCHETYPES[journeyType], status: latest?.assessment?.status ?? "not_assessed", campaignId: latest?.campaignId ?? null, templateVersion: latest?.templateVersion ?? null, productionReady: false };
  });
  return { tenantId, journeyCount: journeys.length, assessedCount: journeys.filter((item) => item.status !== "not_assessed").length, activationCandidateCount: journeys.filter((item) => item.status === "ready_for_tenant_activation").length, productionReadyCount: 0, journeys };
}

function verifyManifest(campaign) {
  const immutable = { tenantId: campaign.tenantId, campaignId: campaign.campaignId, journeyType: campaign.journeyType, archetype: campaign.archetype, templateVersion: campaign.templateVersion, templateChecksumSha256: campaign.templateChecksumSha256, executionMode: campaign.executionMode, commerciallyLive: campaign.commerciallyLive, scenarioIds: campaign.scenarioIds, scenarioCatalogueChecksumSha256: campaign.scenarioCatalogueChecksumSha256, environmentRef: campaign.environmentRef, tenantConfigurationRef: campaign.tenantConfigurationRef };
  if (hash(campaign.scenarios) !== campaign.scenarioCatalogueChecksumSha256 || hash(immutable) !== campaign.manifestChecksumSha256) fail("journey_conformance_manifest_tampered", "Campaign manifest checksum is invalid.");
}
function scenario(scenarioId, scenarioClass, objective) { return Object.freeze({ scenarioId, scenarioClass, objective, mandatory: true }); }
function campaignKey(tenantId, campaignId) { return `${text(tenantId, "tenantId")}:${text(campaignId, "campaignId")}`; }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("journey_conformance_input_invalid", `${field} is required.`); return value.trim(); }
function sha(value, field) { const result = text(value, field); if (!/^[a-f0-9]{64}$/i.test(result)) fail("journey_conformance_input_invalid", `${field} must be a SHA-256 digest.`); return result.toLowerCase(); }
function oneOf(value, allowed, field) { if (!allowed.includes(value)) fail("journey_conformance_input_invalid", `${field} must be one of ${allowed.join(", ")}.`); return value; }
function instant(value) { const result = value instanceof Date ? new Date(value) : new Date(value); if (!Number.isFinite(result.getTime())) fail("journey_conformance_input_invalid", "A valid timestamp is required."); return result; }
function canonical(value) { if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value); if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; throw new Error("invalid_json"); }
function hash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
