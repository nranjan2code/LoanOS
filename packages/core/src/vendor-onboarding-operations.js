import { createHash } from "node:crypto";

export const PROVIDER_OPERATION_CATEGORIES = Object.freeze(["LOS", "LWS", "LMS", "finance", "compliance", "platform"]);
const CATEGORIES = new Set(PROVIDER_OPERATION_CATEGORIES);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const required = (value, field) => { if (typeof value !== "string" || !value.trim()) fail("vendor_input_invalid", `${field} is required.`); return value.trim(); };
const checksum = (value, field) => { if (!/^[a-f0-9]{64}$/.test(String(value ?? ""))) fail("vendor_checksum_invalid", `${field} must be a SHA-256 checksum.`); return value; };
const money = (value, field) => { if (!/^(0|[1-9]\d*)$/.test(String(value ?? ""))) fail("vendor_money_invalid", `${field} must be an exact non-negative paise string.`); return BigInt(value); };
const fourEyes = (input) => { required(input.proposedBy, "proposedBy"); required(input.approvedBy, "approvedBy"); required(input.approvalRef, "approvalRef"); if (input.proposedBy === input.approvedBy) fail("vendor_four_eyes_required", "Independent approval is required."); };
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const tenantRows = (registry, tenantId) => Object.values(registry ?? {}).filter((row) => row.tenantId === tenantId);
const future = (value, now, field) => { const timestamp = Date.parse(value); if (!Number.isFinite(timestamp) || timestamp <= now.getTime()) fail("vendor_evidence_expired", `${field} must be in the future.`); return new Date(timestamp).toISOString(); };

export function registerProviderMappingPack(registry = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId"); const mappingPackId = required(input?.mappingPackId, "mappingPackId"); const providerId = required(input?.providerId, "providerId"); const category = required(input?.category, "category");
  if (!CATEGORIES.has(category)) fail("vendor_category_invalid", "Provider category is invalid."); fourEyes(input);
  required(input.providerFamily, "providerFamily"); required(input.schemaVersion, "schemaVersion"); checksum(input.mappingChecksumSha256, "mappingChecksumSha256"); checksum(input.fixtureChecksumSha256, "fixtureChecksumSha256");
  if (!Array.isArray(input.operations) || !input.operations.length || new Set(input.operations).size !== input.operations.length) fail("vendor_mapping_operations_invalid", "Unique mapped operations are required.");
  for (const field of ["fieldMappingEvidenceRef", "errorMappingEvidenceRef", "idempotencyMappingRef", "dataClassificationRef"]) required(input[field], field);
  const key = `${tenantId}:${mappingPackId}`; if (registry[key]) fail("vendor_mapping_duplicate", "Mapping pack already exists in this tenant.");
  const pack = { tenantId, mappingPackId, providerId, providerFamily: input.providerFamily, category, schemaVersion: input.schemaVersion, operations: [...input.operations].sort(), mappingChecksumSha256: input.mappingChecksumSha256, fixtureChecksumSha256: input.fixtureChecksumSha256, fieldMappingEvidenceRef: input.fieldMappingEvidenceRef, errorMappingEvidenceRef: input.errorMappingEvidenceRef, idempotencyMappingRef: input.idempotencyMappingRef, dataClassificationRef: input.dataClassificationRef, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "approved", approvedAt: now.toISOString() };
  return { registry: { ...registry, [key]: pack }, mappingPack: pack };
}
export function recordSandboxCertificationCampaign(registry = {}, state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId"); const campaignId = required(input?.campaignId, "campaignId"); const mapping = state.mappingPacks?.[`${tenantId}:${input?.mappingPackId}`];
  if (!mapping || mapping.status !== "approved") fail("vendor_mapping_unavailable", "Approved same-tenant mapping pack is required."); fourEyes(input);
  if (!Array.isArray(input.scenarios) || !input.scenarios.length) fail("vendor_campaign_scenarios_missing", "Sandbox scenarios are required.");
  const requiredScenarios = ["success", "authentication_failure", "timeout", "schema_rejection", "duplicate_retry", "adverse_callback", "reconciliation_mismatch"];
  for (const name of requiredScenarios) { const scenario = input.scenarios.find((row) => row.name === name); if (!scenario || scenario.status !== "passed" || !scenario.fixtureRef || !scenario.executionEvidenceRef) fail("vendor_campaign_incomplete", `Passed sandbox evidence is required for ${name}.`); }
  for (const field of ["sandboxEnvironmentRef", "campaignLogRef", "resultChecksumSha256", "securityTestRef", "loadTestRef"]) required(input[field], field); checksum(input.resultChecksumSha256, "resultChecksumSha256");
  const key = `${tenantId}:${campaignId}`; const immutable = { tenantId, campaignId, providerId: mapping.providerId, mappingPackId: mapping.mappingPackId, category: mapping.category, sandboxEnvironmentRef: input.sandboxEnvironmentRef, scenarios: [...input.scenarios].sort((a, b) => a.name.localeCompare(b.name)), campaignLogRef: input.campaignLogRef, resultChecksumSha256: input.resultChecksumSha256, securityTestRef: input.securityTestRef, loadTestRef: input.loadTestRef, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  const prior = registry[key]; if (prior) { if (prior.evidenceChecksumSha256 !== hash(immutable)) fail("vendor_campaign_conflict", "Campaign identity was reused with different evidence."); return { registry, campaign: prior, idempotent: true }; }
  const campaign = { ...immutable, evidenceChecksumSha256: hash(immutable), status: "passed", completedAt: now.toISOString() };
  return { registry: { ...registry, [key]: campaign }, campaign, idempotent: false };
}

export function createVendorRfqComparison(registry = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId"); const comparisonId = required(input?.comparisonId, "comparisonId"); const category = required(input?.category, "category"); if (!CATEGORIES.has(category)) fail("vendor_category_invalid", "Provider category is invalid."); fourEyes(input);
  if (!Array.isArray(input.bids) || input.bids.length < 2) fail("vendor_rfq_competition_missing", "At least two evidence-bound bids are required.");
  const bids = input.bids.map((bid) => { required(bid.providerId, "providerId"); required(bid.rfqResponseRef, "rfqResponseRef"); const implementation = money(bid.implementationCostPaise, "implementationCostPaise"); const annual = money(bid.annualCostPaise, "annualCostPaise"); if (!Number.isInteger(bid.technicalScoreBps) || bid.technicalScoreBps < 0 || bid.technicalScoreBps > 10000) fail("vendor_rfq_score_invalid", "Technical score must be integer basis points."); return { providerId: bid.providerId, rfqResponseRef: bid.rfqResponseRef, implementationCostPaise: implementation.toString(), annualCostPaise: annual.toString(), threeYearCostPaise: (implementation + annual * 3n).toString(), technicalScoreBps: bid.technicalScoreBps, exceptionsRef: required(bid.exceptionsRef, "exceptionsRef") }; });
  if (new Set(bids.map((bid) => bid.providerId)).size !== bids.length) fail("vendor_rfq_bid_duplicate", "Each bid must represent a distinct provider.");
  const selected = bids.find((bid) => bid.providerId === input.selectedProviderId); if (!selected || !input.selectionRationale || !input.commercialApprovalRef) fail("vendor_rfq_selection_invalid", "Selected provider, rationale, and commercial approval evidence are required.");
  const key = `${tenantId}:${comparisonId}`; if (registry[key]) fail("vendor_rfq_duplicate", "RFQ comparison already exists in this tenant.");
  const comparison = { tenantId, comparisonId, category, rfqRef: required(input.rfqRef, "rfqRef"), bids, selectedProviderId: selected.providerId, selectionRationale: input.selectionRationale, commercialApprovalRef: input.commercialApprovalRef, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "approved", approvedAt: now.toISOString() };
  return { registry: { ...registry, [key]: comparison }, comparison };
}

export function approveVendorActivation(registry = {}, state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId"); const activationId = required(input?.activationId, "activationId"); const providerId = required(input?.providerId, "providerId"); fourEyes(input);
  const mapping = tenantRows(state.mappingPacks, tenantId).find((row) => row.providerId === providerId && row.mappingPackId === input.mappingPackId && row.status === "approved");
  const campaign = tenantRows(state.campaigns, tenantId).find((row) => row.providerId === providerId && row.campaignId === input.campaignId && row.status === "passed");
  const comparison = tenantRows(state.comparisons, tenantId).find((row) => row.selectedProviderId === providerId && row.comparisonId === input.comparisonId && row.status === "approved");
  if (!mapping || !campaign || campaign.mappingPackId !== mapping.mappingPackId || !comparison || comparison.category !== mapping.category) fail("vendor_activation_lineage_invalid", "Same-tenant mapping, passed campaign, and selected RFQ lineage are required.");
  const gates = input.gates ?? {}; const evidenceFields = ["contractRef", "slaRef", "dataResidencyEvidenceRef", "drPlanRef", "drTestEvidenceRef", "exitPlanRef", "dataReturnDeletionRef", "insuranceEvidenceRef", "securityCertificationRef", "supportRunbookRef"];
  for (const field of evidenceFields) required(gates[field], field);
  if (gates.dataResidencyCountry !== "IN" || gates.contractStatus !== "executed" || gates.slaStatus !== "approved" || gates.drTestOutcome !== "passed" || gates.exitReadiness !== "approved") fail("vendor_activation_gate_failed", "Executed contract, approved SLA, India residency, passed DR, and approved exit readiness are required.");
  const validUntil = future(gates.certificationValidUntil, now, "certificationValidUntil"); if (!Number.isInteger(gates.availabilityTargetBps) || gates.availabilityTargetBps < 0 || gates.availabilityTargetBps > 10000) fail("vendor_sla_invalid", "Availability target must be integer basis points.");
  const key = `${tenantId}:${activationId}`; if (registry[key]) fail("vendor_activation_duplicate", "Activation already exists in this tenant.");
  const activation = { tenantId, activationId, providerId, providerFamily: mapping.providerFamily, category: mapping.category, mappingPackId: mapping.mappingPackId, campaignId: campaign.campaignId, comparisonId: comparison.comparisonId, gates: { ...gates, certificationValidUntil: validUntil }, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "active", activatedAt: now.toISOString() };
  return { registry: { ...registry, [key]: activation }, activation };
}

export function projectVendorActivationDashboard(state = {}, tenantId, now = new Date()) {
  required(tenantId, "tenantId"); const activations = tenantRows(state.activations, tenantId); const mappingPacks = tenantRows(state.mappingPacks, tenantId); const campaigns = tenantRows(state.campaigns, tenantId); const comparisons = tenantRows(state.comparisons, tenantId);
  const categories = Object.fromEntries(PROVIDER_OPERATION_CATEGORIES.map((category) => { const active = activations.filter((row) => row.category === category && row.status === "active" && Date.parse(row.gates.certificationValidUntil) > now.getTime()); const expired = activations.filter((row) => row.category === category && Date.parse(row.gates.certificationValidUntil) <= now.getTime()); const mappedProviderIds = new Set(mappingPacks.filter((row) => row.category === category).map((row) => row.providerId)); return [category, { activeCount: active.length, expiredCount: expired.length, mappingPackCount: mappingPacks.filter((row) => row.category === category).length, passedCampaignCount: campaigns.filter((row) => row.category === category && row.status === "passed").length, approvedComparisonCount: comparisons.filter((row) => row.category === category && row.status === "approved").length, providerIds: [...new Set([...mappedProviderIds, ...active.map((row) => row.providerId)])].sort(), readiness: active.length ? "active" : mappedProviderIds.size ? "onboarding" : "not_started" }]; }));
  return { tenantId, categories, totals: { active: activations.filter((row) => row.status === "active" && Date.parse(row.gates.certificationValidUntil) > now.getTime()).length, expired: activations.filter((row) => Date.parse(row.gates.certificationValidUntil) <= now.getTime()).length, mappingPacks: mappingPacks.length, passedCampaigns: campaigns.filter((row) => row.status === "passed").length, comparisons: comparisons.filter((row) => row.status === "approved").length }, generatedAt: now.toISOString() };
}
