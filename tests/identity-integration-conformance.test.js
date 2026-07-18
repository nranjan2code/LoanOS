import test from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY_CONFORMANCE_CATALOG,
  IDENTITY_INTEGRATION_FAMILIES,
  approveIdentityConformanceCampaign,
  assessIdentityConformanceCampaign,
  createIdentityConformanceCampaign,
  recordIdentityConformanceResult
} from "@loanos/core";

test("identity conformance catalogue is exhaustive, vendor-neutral, and simulator-only", () => {
  assert.deepEqual([...new Set(IDENTITY_CONFORMANCE_CATALOG.map((item) => item.family))], IDENTITY_INTEGRATION_FAMILIES);
  for (const family of IDENTITY_INTEGRATION_FAMILIES) {
    const scenarios = IDENTITY_CONFORMANCE_CATALOG.filter((item) => item.family === family);
    assert.ok(scenarios.length >= 10, `${family} has a substantial negative-path pack`);
    assert.ok(scenarios.some((item) => item.name === "wrong_tenant"));
    assert.ok(scenarios.some((item) => item.name === "provider_outage"));
    assert.ok(scenarios.every((item) => item.executionMode === "simulated"));
  }
});

test("campaign requires four eyes, all scenarios, and can never claim live certification", () => {
  const created = createIdentityConformanceCampaign({}, { campaignId: "camp-1", tenantId: "tenant-a", family: "oidc", providerProfileRef: "candidate-idp", proposedBy: "maker" });
  assert.equal(created.campaign.commerciallyLive, false);
  assert.throws(() => approveIdentityConformanceCampaign(created.registry, { campaignId: "camp-1", approvedBy: "maker", approvalRef: "same" }), /different/);
  let registry = approveIdentityConformanceCampaign(created.registry, { campaignId: "camp-1", approvedBy: "checker", approvalRef: "CAB-1" }).registry;
  let assessment = assessIdentityConformanceCampaign(registry, { campaignId: "camp-1", assessedBy: "checker" });
  assert.equal(assessment.campaign.status, "blocked");
  for (const scenarioId of registry["camp-1"].scenarioIds) registry = recordIdentityConformanceResult(registry, { campaignId: "camp-1", scenarioId, executedBy: "operator" }).registry;
  assessment = assessIdentityConformanceCampaign(registry, { campaignId: "camp-1", assessedBy: "checker" });
  assert.equal(assessment.campaign.status, "simulator_certified");
  assert.equal(assessment.assessment.commerciallyLive, false);
  assert.match(assessment.campaign.manifestChecksumSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => createIdentityConformanceCampaign({}, { campaignId: "live", tenantId: "tenant-a", family: "oidc", providerProfileRef: "idp", proposedBy: "maker", executionMode: "live" }), /Only simulated/);
});
