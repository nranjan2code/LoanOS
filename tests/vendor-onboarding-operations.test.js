import test from "node:test";
import assert from "node:assert/strict";
import { approveVendorActivation, createVendorRfqComparison, projectVendorActivationDashboard, recordSandboxCertificationCampaign, registerProviderMappingPack } from "@loanos/core/integrations/vendor-onboarding-operations.js";

const NOW = new Date("2026-07-15T00:00:00.000Z"); const H = "a".repeat(64); const approval = { proposedBy: "maker", approvedBy: "checker", approvalRef: "APR-1" };
const mappingInput = { tenantId: "t1", mappingPackId: "map1", providerId: "vendor1", providerFamily: "payment_rail", category: "LMS", schemaVersion: "1", operations: ["settle", "collect"], mappingChecksumSha256: H, fixtureChecksumSha256: H, fieldMappingEvidenceRef: "evidence/fields", errorMappingEvidenceRef: "evidence/errors", idempotencyMappingRef: "evidence/idempotency", dataClassificationRef: "evidence/classification", ...approval };
const scenarios = ["success", "authentication_failure", "timeout", "schema_rejection", "duplicate_retry", "adverse_callback", "reconciliation_mismatch"].map((name) => ({ name, status: "passed", fixtureRef: `fixture/${name}`, executionEvidenceRef: `evidence/${name}` }));

test("mapping packs and sandbox campaigns are tenant scoped, four-eyes, and evidence bound", () => {
  const mapped = registerProviderMappingPack({}, mappingInput, NOW); assert.equal(mapped.mappingPack.status, "approved");
  assert.throws(() => registerProviderMappingPack({}, { ...mappingInput, approvedBy: "maker" }, NOW), (e) => e.code === "vendor_four_eyes_required");
  const input = { tenantId: "t1", campaignId: "camp1", mappingPackId: "map1", sandboxEnvironmentRef: "sandbox/1", scenarios, campaignLogRef: "logs/1", resultChecksumSha256: H, securityTestRef: "security/1", loadTestRef: "load/1", ...approval };
  const campaign = recordSandboxCertificationCampaign({}, { mappingPacks: mapped.registry }, input, NOW); assert.equal(campaign.campaign.status, "passed"); assert.equal(recordSandboxCertificationCampaign(campaign.registry, { mappingPacks: mapped.registry }, input, NOW).idempotent, true);
  assert.throws(() => recordSandboxCertificationCampaign({}, { mappingPacks: mapped.registry }, { ...input, tenantId: "t2" }, NOW), (e) => e.code === "vendor_mapping_unavailable");
});

test("RFQ comparison retains exact integer-paise commercial evidence without inventing terms", () => {
  const bids = [{ providerId: "vendor1", rfqResponseRef: "rfq/v1", implementationCostPaise: "10001", annualCostPaise: "20000", technicalScoreBps: 9000, exceptionsRef: "exceptions/v1" }, { providerId: "vendor2", rfqResponseRef: "rfq/v2", implementationCostPaise: "5000", annualCostPaise: "30000", technicalScoreBps: 8000, exceptionsRef: "exceptions/v2" }];
  const result = createVendorRfqComparison({}, { tenantId: "t1", comparisonId: "cmp1", category: "LMS", rfqRef: "rfq/1", bids, selectedProviderId: "vendor1", selectionRationale: "Higher evidenced technical score", commercialApprovalRef: "commercial/1", ...approval }, NOW);
  assert.equal(result.comparison.bids[0].threeYearCostPaise, "70001");
  assert.throws(() => createVendorRfqComparison({}, { tenantId: "t1", comparisonId: "bad", category: "LMS", rfqRef: "r", bids: [{ ...bids[0], implementationCostPaise: "1.5" }, bids[1]], selectedProviderId: "vendor1", selectionRationale: "x", commercialApprovalRef: "c", ...approval }), (e) => e.code === "vendor_money_invalid");
});

test("activation fails closed on contract, SLA, residency, DR and exit gates", () => {
  const mapped = registerProviderMappingPack({}, mappingInput, NOW); const campaign = recordSandboxCertificationCampaign({}, { mappingPacks: mapped.registry }, { tenantId: "t1", campaignId: "camp1", mappingPackId: "map1", sandboxEnvironmentRef: "sandbox", scenarios, campaignLogRef: "logs", resultChecksumSha256: H, securityTestRef: "security", loadTestRef: "load", ...approval }, NOW);
  const comparison = createVendorRfqComparison({}, { tenantId: "t1", comparisonId: "cmp1", category: "LMS", rfqRef: "rfq", bids: [{ providerId: "vendor1", rfqResponseRef: "r1", implementationCostPaise: "1", annualCostPaise: "2", technicalScoreBps: 9000, exceptionsRef: "e1" }, { providerId: "vendor2", rfqResponseRef: "r2", implementationCostPaise: "2", annualCostPaise: "1", technicalScoreBps: 8000, exceptionsRef: "e2" }], selectedProviderId: "vendor1", selectionRationale: "evidenced fit", commercialApprovalRef: "commercial", ...approval }, NOW);
  const gates = { contractRef: "contract/executed", contractStatus: "executed", slaRef: "sla/1", slaStatus: "approved", availabilityTargetBps: 9990, dataResidencyCountry: "IN", dataResidencyEvidenceRef: "residency/1", drPlanRef: "dr/plan", drTestEvidenceRef: "dr/test", drTestOutcome: "passed", exitPlanRef: "exit/plan", exitReadiness: "approved", dataReturnDeletionRef: "exit/data", insuranceEvidenceRef: "insurance/1", securityCertificationRef: "security/cert", certificationValidUntil: "2027-01-01T00:00:00Z", supportRunbookRef: "runbook/1" };
  const state = { mappingPacks: mapped.registry, campaigns: campaign.registry, comparisons: comparison.registry }; const input = { tenantId: "t1", activationId: "act1", providerId: "vendor1", mappingPackId: "map1", campaignId: "camp1", comparisonId: "cmp1", gates, ...approval };
  assert.throws(() => approveVendorActivation({}, state, { ...input, gates: { ...gates, dataResidencyCountry: "US" } }, NOW), (e) => e.code === "vendor_activation_gate_failed");
  const active = approveVendorActivation({}, state, input, NOW); assert.equal(active.activation.status, "active");
  const dashboard = projectVendorActivationDashboard({ ...state, activations: active.registry }, "t1", NOW); assert.equal(dashboard.categories.LMS.activeCount, 1); assert.equal(dashboard.categories.LOS.readiness, "not_started"); assert.equal(projectVendorActivationDashboard({ ...state, activations: active.registry }, "t2", NOW).totals.active, 0);
});
