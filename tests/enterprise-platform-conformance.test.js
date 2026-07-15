import test from "node:test";
import assert from "node:assert/strict";
import {
  ENTERPRISE_PLATFORM_CONFORMANCE_PACKS,
  ENTERPRISE_PLATFORM_FAMILIES,
  REQUIRED_ENTERPRISE_SCENARIO_CLASSES,
  assessEnterprisePlatformConformancePack,
  assessEnterprisePlatformConformanceSuite,
  assessEnterprisePlatformSimulation,
  buildEnterprisePlatformSimulatorManifest,
  simulateEnterprisePlatformScenario
} from "../packages/core/src/index.js";

test("enterprise platform packs exhaustively cover mandatory safety classes", () => {
  const suite = assessEnterprisePlatformConformanceSuite();
  assert.equal(suite.status, "complete");
  assert.equal(suite.familyCount, 6);
  assert.equal(suite.scenarioCount, 85);
  assert.equal(suite.executionMode, "simulated");
  assert.equal(suite.commerciallyLive, false);
  for (const assessment of suite.assessments) {
    assert.ok(assessment.scenarioCount >= 13, `${assessment.family} should have a substantial adverse pack`);
    assert.deepEqual(assessment.coveredClasses, [...REQUIRED_ENTERPRISE_SCENARIO_CLASSES].sort());
    assert.match(assessment.packChecksumSha256, /^[a-f0-9]{64}$/);
  }
});

test("scenario identifiers are globally unique and no adverse case silently accepts", () => {
  const scenarios = ENTERPRISE_PLATFORM_FAMILIES.flatMap((family) => ENTERPRISE_PLATFORM_CONFORMANCE_PACKS[family]);
  assert.equal(new Set(scenarios.map((item) => item.scenarioId)).size, scenarios.length);
  assert.ok(scenarios.every((item) => item.executionMode === "simulated" && item.commerciallyLive === false));
  const successIds = new Set([
    "kms_hsm_vault.non_exportable_operation",
    "broker_dlq.ordered_delivery",
    "cdc_checkpoint.checkpoint_advance",
    "mdm_device.enrol_compliant_device",
    "deployment_controller.healthy_release",
    "trusted_time.fresh_attested_time"
  ]);
  assert.ok(scenarios.every((item) => successIds.has(item.scenarioId) || item.expectedDisposition !== "accept"));
});

test("pack assessment fails closed when a required adverse class is absent or a live claim appears", () => {
  const withoutOutage = ENTERPRISE_PLATFORM_CONFORMANCE_PACKS.mdm_device.filter((item) => item.scenarioClass !== "outage");
  const incomplete = assessEnterprisePlatformConformancePack("mdm_device", withoutOutage);
  assert.equal(incomplete.status, "blocked");
  assert.ok(incomplete.findings.some((finding) => finding.code === "missing_scenario_class" && finding.scenarioClass === "outage"));

  const liveClaim = ENTERPRISE_PLATFORM_CONFORMANCE_PACKS.trusted_time.map((item, index) => index === 0 ? { ...item, commerciallyLive: true } : item);
  const unsafe = assessEnterprisePlatformConformancePack("trusted_time", liveClaim);
  assert.equal(unsafe.status, "blocked");
  assert.ok(unsafe.findings.some((finding) => finding.code === "live_claim_forbidden"));

  const missingCanonicalScenario = ENTERPRISE_PLATFORM_CONFORMANCE_PACKS.mdm_device.filter((item) => item.name !== "jailbreak_or_root_detected");
  const nonExhaustive = assessEnterprisePlatformConformancePack("mdm_device", missingCanonicalScenario);
  assert.equal(nonExhaustive.status, "blocked");
  assert.ok(nonExhaustive.findings.some((finding) => finding.code === "missing_scenario_id" && finding.scenarioId === "mdm_device.jailbreak_or_root_detected"));
});

test("tenant-bound manifests and evidence are deterministic and reject cross-tenant execution", () => {
  const input = {
    tenantId: "tenant-a",
    campaignId: "platform-uat-1",
    family: "kms_hsm_vault",
    providerProfileRef: "candidate-kms",
    logicalTime: "2026-07-15T00:00:00+05:30"
  };
  const first = buildEnterprisePlatformSimulatorManifest(input);
  const second = buildEnterprisePlatformSimulatorManifest(input);
  assert.deepEqual(first, second);
  assert.equal(first.logicalTime, "2026-07-14T18:30:00.000Z");
  assert.match(first.manifestChecksumSha256, /^[a-f0-9]{64}$/);

  const result = simulateEnterprisePlatformScenario(first, { tenantId: "tenant-a", scenarioId: "kms_hsm_vault.cross_tenant_key_reference" });
  assert.equal(result.observedDisposition, "deny");
  assert.equal(result.passed, true);
  assert.match(result.evidenceChecksumSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result, simulateEnterprisePlatformScenario(first, { tenantId: "tenant-a", scenarioId: "kms_hsm_vault.cross_tenant_key_reference" }));
  assert.throws(() => simulateEnterprisePlatformScenario(first, { tenantId: "tenant-b", scenarioId: result.scenarioId }), (error) => error.code === "enterprise_conformance_tenant_mismatch");
  assert.throws(() => buildEnterprisePlatformSimulatorManifest({ ...input, executionMode: "live" }), (error) => error.code === "enterprise_conformance_live_claim_forbidden");
});

test("complete checksummed evidence earns simulator certification only", () => {
  for (const family of ENTERPRISE_PLATFORM_FAMILIES) {
    const manifest = buildEnterprisePlatformSimulatorManifest({ tenantId: "tenant-a", campaignId: `campaign-${family}`, family, providerProfileRef: `candidate-${family}` });
    const results = manifest.scenarioIds.map((scenarioId) => simulateEnterprisePlatformScenario(manifest, { tenantId: "tenant-a", scenarioId }));
    const assessment = assessEnterprisePlatformSimulation(manifest, results);
    assert.equal(assessment.status, "simulator_certified");
    assert.equal(assessment.commerciallyLive, false);
    assert.equal(assessment.missingScenarioIds.length, 0);
    assert.match(assessment.assessmentChecksumSha256, /^[a-f0-9]{64}$/);
  }
});

test("missing, unsafe, duplicate, or tampered evidence blocks assessment", () => {
  const manifest = buildEnterprisePlatformSimulatorManifest({ tenantId: "tenant-a", campaignId: "deploy-1", family: "deployment_controller", providerProfileRef: "candidate-controller" });
  const complete = manifest.scenarioIds.map((scenarioId) => simulateEnterprisePlatformScenario(manifest, { tenantId: "tenant-a", scenarioId }));

  const missing = assessEnterprisePlatformSimulation(manifest, complete.slice(1));
  assert.equal(missing.status, "blocked");
  assert.deepEqual(missing.missingScenarioIds, [manifest.scenarioIds[0]]);

  const failed = complete.map((result, index) => index === 0
    ? simulateEnterprisePlatformScenario(manifest, { tenantId: "tenant-a", scenarioId: result.scenarioId, observedDisposition: "pause" })
    : result);
  assert.equal(assessEnterprisePlatformSimulation(manifest, failed).status, "blocked");

  const tampered = complete.map((result, index) => index === 0 ? { ...result, observedDisposition: "deny" } : result);
  const tamperedAssessment = assessEnterprisePlatformSimulation(manifest, tampered);
  assert.equal(tamperedAssessment.status, "blocked");
  assert.deepEqual(tamperedAssessment.invalidScenarioIds, [manifest.scenarioIds[0]]);

  const duplicate = assessEnterprisePlatformSimulation(manifest, [...complete, complete[0]]);
  assert.equal(duplicate.status, "blocked");
  assert.deepEqual(duplicate.invalidScenarioIds, [complete[0].scenarioId]);
});

test("pack-specific recovery and containment outcomes are explicit", () => {
  assert.equal(ENTERPRISE_PLATFORM_CONFORMANCE_PACKS.mdm_device.find((item) => item.name === "wipe_timeout").expectedDisposition, "escalate");
  assert.equal(ENTERPRISE_PLATFORM_CONFORMANCE_PACKS.deployment_controller.find((item) => item.name === "partial_resource_creation").expectedDisposition, "compensate");
  assert.equal(ENTERPRISE_PLATFORM_CONFORMANCE_PACKS.deployment_controller.find((item) => item.name === "compensation_fails").expectedDisposition, "escalate");
  assert.equal(ENTERPRISE_PLATFORM_CONFORMANCE_PACKS.broker_dlq.find((item) => item.name === "unapproved_dlq_replay").expectedDisposition, "deny");
  assert.equal(ENTERPRISE_PLATFORM_CONFORMANCE_PACKS.trusted_time.find((item) => item.name === "time_authority_outage").expectedDisposition, "pause");
});
