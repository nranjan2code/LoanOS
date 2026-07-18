import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORIGINATION_PROVIDER_CONFORMANCE_PACKS,
  ORIGINATION_PROVIDER_FAMILIES,
  REQUIRED_CONFORMANCE_CLASSES,
  assessOriginationConformancePack,
  assessOriginationConformanceSuite,
  buildOriginationSimulatorScenarios
} from "@loanos/core/integrations/origination-provider-conformance.js";
import { createProviderSimulator } from "@loanos/core/integrations/provider-simulator.js";
import { ExternalServiceManager } from "@loanos/core/integrations/external-services.js";

test("origination provider suite supplies every adverse class for every family", () => {
  const result = assessOriginationConformanceSuite();
  assert.equal(result.status, "complete");
  assert.equal(result.familyCount, 8);
  assert.equal(result.scenarioCount, 72);
  for (const assessment of result.assessments) {
    assert.equal(assessment.status, "complete");
    assert.deepEqual(assessment.coveredClasses, [...REQUIRED_CONFORMANCE_CLASSES].sort());
    assert.match(assessment.packChecksumSha256, /^[a-f0-9]{64}$/);
  }
});

test("origination conformance fails closed when one required class is absent", () => {
  const family = "bureau";
  const incomplete = ORIGINATION_PROVIDER_CONFORMANCE_PACKS[family].filter((scenario) => scenario.scenarioClass !== "tamper");
  const result = assessOriginationConformancePack(family, incomplete);
  assert.equal(result.status, "blocked");
  assert(result.findings.some((finding) => finding.code === "missing_scenario_class" && finding.scenarioClass === "tamper"));
});

test("scenario identifiers are stable and unique across the suite", () => {
  const ids = ORIGINATION_PROVIDER_FAMILIES.flatMap((family) => ORIGINATION_PROVIDER_CONFORMANCE_PACKS[family].map((scenario) => scenario.scenarioId));
  assert.equal(new Set(ids).size, ids.length);
  assert(ids.every((id) => /^[a-z_]+\.[a-z_]+$/.test(id)));
});

test("conformance packs compile into executable deterministic simulator scenarios", () => {
  const scenarios = buildOriginationSimulatorScenarios("bureau");
  const simulator = createProviderSimulator({ tenantId: "tenant_1", seed: "seed_1", callbackSecret: "secret_1", scenarios });
  const noHit = simulator.submit({ tenantId: "tenant_1", provider: "bureau", operation: "enquiry", idempotencyKey: "enquiry_1", scenario: "bureau.no_hit", payload: { panHash: "abc" } });
  assert.equal(noHit.status, "no_hit");
  assert.equal(noHit.response.scenarioClass, "business_reject");
  assert.throws(() => simulator.submit({ tenantId: "tenant_1", provider: "bureau", operation: "enquiry", idempotencyKey: "enquiry_2", scenario: "bureau.enquiry_timeout", payload: {} }), (error) => error.code === "provider_simulator_timeout");
});

test("ExternalServiceManager exposes simulator only for an explicit mock provider", () => {
  const simulator = createProviderSimulator({ tenantId: "tenant_1", seed: "seed_1", callbackSecret: "secret_1", scenarios: buildOriginationSimulatorScenarios("bureau") });
  const manager = new ExternalServiceManager({ simulator, simulatorTenantId: "tenant_1" });
  const result = manager.simulateMockProvider({ provider: "bureau", operation: "enquiry", idempotencyKey: "enquiry_1", scenario: "bureau.report_available", payload: { panHash: "abc" } });
  assert.equal(result.status, "available");
  const realManager = new ExternalServiceManager({ bureauProvider: "real", simulator, simulatorTenantId: "tenant_1" });
  assert.throws(() => realManager.simulateMockProvider({ provider: "bureau", operation: "enquiry", idempotencyKey: "enquiry_2", scenario: "bureau.report_available" }), /cannot execute for a real provider/);
});
