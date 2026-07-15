import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PRODUCT_JOURNEY_ARCHETYPES,
  PRODUCT_JOURNEY_CONFORMANCE_BASELINE,
  PRODUCT_JOURNEY_TYPES,
  approveProductJourneyConformanceCampaign,
  assessProductJourneyConformanceCampaign,
  buildProductJourneyConformanceManifest,
  isCanonicalProductJourneyType,
  projectProductJourneyConformanceCoverage,
  recordProductJourneyConformanceResult,
  registerProductJourneyConformanceCampaign,
  validateProductPolicy
} from "../packages/core/src/index.js";

const NOW = new Date("2026-07-15T00:00:00.000Z");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const input = (journeyType = "personal_loan", overrides = {}) => ({ tenantId: "tenant-a", campaignId: `campaign-${journeyType}`, journeyType, templateVersion: "1.0.0", templateChecksumSha256: sha(journeyType), executionMode: "simulated", commerciallyLive: false, environmentRef: "sandbox://tenant-a", tenantConfigurationRef: `config://${journeyType}/v1`, proposedBy: "maker", ...overrides });

function approved(journeyType = "personal_loan", overrides = {}) {
  let registry = registerProductJourneyConformanceCampaign({}, input(journeyType, overrides), NOW).registry;
  registry = approveProductJourneyConformanceCampaign(registry, { tenantId: "tenant-a", campaignId: `campaign-${journeyType}`, approvedBy: "checker", approvalRef: "approval://campaign" }, NOW).registry;
  return registry;
}

function passAll(registry, journeyType = "personal_loan") {
  const campaignId = `campaign-${journeyType}`;
  const campaign = registry[`tenant-a:${campaignId}`];
  for (const scenarioId of campaign.scenarioIds) {
    registry = recordProductJourneyConformanceResult(registry, { tenantId: "tenant-a", campaignId, scenarioId, outcome: "passed", executedBy: `executor-${scenarioId}`, evidenceRef: `evidence://${scenarioId}`, evidenceChecksumSha256: sha(scenarioId), sourceRunRef: `run://${scenarioId}` }, NOW).registry;
  }
  return registry;
}

test("greenfield product vocabulary is exactly the canonical 21 in domain and tenant onboarding", async () => {
  for (const journeyType of PRODUCT_JOURNEY_TYPES) assert.equal(isCanonicalProductJourneyType(journeyType), true);
  for (const legacy of ["business_loan", "msme_loan", "consumer_durable_loan", "vehicle_loan", "housing_loan", "working_capital_line", "overdraft"]) assert.equal(isCanonicalProductJourneyType(legacy), false);
  const html = await readFile(new URL("../apps/dashboard/index.html", import.meta.url), "utf8");
  const section = html.match(/<select id="platform-product-type">([\s\S]*?)<\/select>/)?.[1] ?? "";
  const values = [...section.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(values, [...PRODUCT_JOURNEY_TYPES].sort());
  for (const legacy of ["business_loan", "msme_loan", "consumer_durable_loan", "vehicle_loan", "housing_loan", "working_capital_line", "overdraft"]) {
    assert.equal(validateProductPolicy({ productType: legacy }).findings.some((finding) => finding.path === "productType" && finding.message === "productType is invalid."), true);
  }
  for (const journeyType of PRODUCT_JOURNEY_TYPES) assert.equal(validateProductPolicy({ productType: journeyType }).findings.some((finding) => finding.path === "productType" && finding.message === "productType is invalid."), false);
});

test("conformance factory creates one stable common corpus plus an archetype case for all 21", () => {
  assert.equal(PRODUCT_JOURNEY_CONFORMANCE_BASELINE.length, 16);
  assert.deepEqual(Object.keys(PRODUCT_JOURNEY_ARCHETYPES).sort(), [...PRODUCT_JOURNEY_TYPES].sort());
  for (const journeyType of PRODUCT_JOURNEY_TYPES) {
    const campaign = buildProductJourneyConformanceManifest(input(journeyType)).campaign;
    assert.equal(campaign.scenarios.length, 17);
    assert.equal(new Set(campaign.scenarioIds).size, 17);
    assert.equal(campaign.status, "proposed");
  }
});

test("simulated all-pass campaign is independently assessed but never becomes production ready", () => {
  let registry = passAll(approved());
  const result = assessProductJourneyConformanceCampaign(registry, { tenantId: "tenant-a", campaignId: "campaign-personal_loan", assessedBy: "independent-assessor" }, NOW);
  assert.equal(result.assessment.status, "controlled_first_slice");
  assert.equal(result.assessment.allPassed, true);
  const coverage = projectProductJourneyConformanceCoverage(result.registry, "tenant-a");
  assert.equal(coverage.journeyCount, 21);
  assert.equal(coverage.assessedCount, 1);
  assert.equal(coverage.productionReadyCount, 0);
});

test("missing, failed, tampered and non-independent evidence fail closed", () => {
  let registry = approved();
  const campaign = registry["tenant-a:campaign-personal_loan"];
  const first = campaign.scenarioIds[0];
  registry = recordProductJourneyConformanceResult(registry, { tenantId: "tenant-a", campaignId: campaign.campaignId, scenarioId: first, outcome: "failed", executedBy: "executor", evidenceRef: "evidence://failed", evidenceChecksumSha256: sha("failed"), sourceRunRef: "run://failed" }, NOW).registry;
  assert.throws(() => assessProductJourneyConformanceCampaign(registry, { tenantId: "tenant-a", campaignId: campaign.campaignId, assessedBy: "executor" }, NOW), { code: "journey_conformance_assessor_independence" });
  const assessed = assessProductJourneyConformanceCampaign(registry, { tenantId: "tenant-a", campaignId: campaign.campaignId, assessedBy: "independent" }, NOW);
  assert.equal(assessed.assessment.status, "blocked");
  const tampered = { ...registry, ["tenant-a:campaign-personal_loan"]: { ...registry["tenant-a:campaign-personal_loan"], journeyType: "gold_loan" } };
  assert.throws(() => assessProductJourneyConformanceCampaign(tampered, { tenantId: "tenant-a", campaignId: campaign.campaignId, assessedBy: "independent" }, NOW), { code: "journey_conformance_manifest_tampered" });
});

test("live conformance can only become an activation candidate with commercial and acceptance evidence", () => {
  let registry = approved("gold_loan", { executionMode: "live", commerciallyLive: true });
  registry = passAll(registry, "gold_loan");
  const result = assessProductJourneyConformanceCampaign(registry, { tenantId: "tenant-a", campaignId: "campaign-gold_loan", assessedBy: "independent", productionAcceptanceRef: "acceptance://gold/v1" }, NOW);
  assert.equal(result.assessment.status, "ready_for_tenant_activation");
  assert.equal(projectProductJourneyConformanceCoverage(result.registry, "tenant-a").productionReadyCount, 0);
});

test("registration and scenario recording are exact-content idempotent", () => {
  const first = registerProductJourneyConformanceCampaign({}, input(), NOW);
  assert.equal(registerProductJourneyConformanceCampaign(first.registry, input(), NOW).idempotent, true);
  const registry = approveProductJourneyConformanceCampaign(first.registry, { tenantId: "tenant-a", campaignId: "campaign-personal_loan", approvedBy: "checker", approvalRef: "approval://1" }, NOW).registry;
  const campaign = registry["tenant-a:campaign-personal_loan"];
  const resultInput = { tenantId: "tenant-a", campaignId: campaign.campaignId, scenarioId: campaign.scenarioIds[0], outcome: "passed", executedBy: "executor", evidenceRef: "evidence://1", evidenceChecksumSha256: sha("1"), sourceRunRef: "run://1" };
  const recorded = recordProductJourneyConformanceResult(registry, resultInput, NOW);
  assert.equal(recordProductJourneyConformanceResult(recorded.registry, resultInput, NOW).idempotent, true);
  assert.throws(() => recordProductJourneyConformanceResult(recorded.registry, { ...resultInput, outcome: "failed" }, NOW), { code: "journey_conformance_result_conflict" });
});
