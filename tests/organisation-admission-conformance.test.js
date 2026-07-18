import assert from "node:assert/strict";
import test from "node:test";

import {
  ORGANISATION_ADMISSION_CONFORMANCE_PACKS,
  ORGANISATION_ADMISSION_INTEGRATIONS,
  ORGANISATION_ADMISSION_SOURCE_VERSION,
  REQUIRED_ORGANISATION_ADMISSION_CLASSES,
  assessOrganisationAdmissionConformancePack,
  assessOrganisationAdmissionConformanceSuite,
  buildOrganisationAdmissionSimulatorScenarios,
  createOrganisationAdmissionConformanceSimulator,
  createProviderSimulator
} from "@loanos/core";

test("INT-ADM-01 through INT-ADM-10 have complete stable simulator-only packs", () => {
  const suite = assessOrganisationAdmissionConformanceSuite();
  assert.equal(suite.status, "complete");
  assert.equal(suite.integrationCount, 10);
  assert.equal(suite.scenarioCount, 153);
  assert.equal(suite.sourceVersion, ORGANISATION_ADMISSION_SOURCE_VERSION);
  assert.equal(suite.executionMode, "simulated");
  assert.equal(suite.simulated, true);
  assert.equal(suite.commerciallyLive, false);
  for (const assessment of suite.assessments) {
    assert.equal(assessment.status, "complete");
    assert.match(assessment.packChecksumSha256, /^[a-f0-9]{64}$/);
    for (const scenarioClass of REQUIRED_ORGANISATION_ADMISSION_CLASSES) assert.ok(assessment.coveredClasses.includes(scenarioClass));
    for (const scenario of ORGANISATION_ADMISSION_CONFORMANCE_PACKS[assessment.integrationId]) {
      assert.match(scenario.scenarioId, /^INT-ADM-(0[1-9]|10)\.[a-z_]+\.[a-z0-9_]+$/);
      assert.equal(scenario.sourceVersion, ORGANISATION_ADMISSION_SOURCE_VERSION);
      assert.match(scenario.sourceChecksumSha256, /^[a-f0-9]{64}$/);
      assert.equal(scenario.executionMode, "simulated");
      assert.equal(scenario.simulated, true);
      assert.equal(scenario.commerciallyLive, false);
    }
  }
});

test("family-specific adverse controls cover admission, compensation, and continuing reverification", () => {
  const classes = (id) => new Set(ORGANISATION_ADMISSION_CONFORMANCE_PACKS[id].map((entry) => entry.scenarioClass));
  assert.deepEqual([...ORGANISATION_ADMISSION_INTEGRATIONS.map((entry) => entry.integrationId)], ["INT-ADM-01", "INT-ADM-02", "INT-ADM-03", "INT-ADM-04", "INT-ADM-05", "INT-ADM-06", "INT-ADM-07", "INT-ADM-08", "INT-ADM-09", "INT-ADM-10"]);
  for (const required of ["invite_expired", "bounce", "complaint", "suppression"]) assert.ok(classes("INT-ADM-01").has(required));
  for (const required of ["identity_mismatch", "registry_status_change"]) assert.ok(classes("INT-ADM-02").has(required));
  for (const required of ["permission_mismatch", "licence_revoked"]) assert.ok(classes("INT-ADM-03").has(required));
  for (const required of ["authority_expired", "certificate_revoked", "revocation_source_unavailable"]) assert.ok(classes("INT-ADM-04").has(required));
  for (const required of ["dns_challenge_mismatch", "domain_reputation_reject", "official_contact_mismatch"]) assert.ok(classes("INT-ADM-05").has(required));
  for (const required of ["bot_detected", "velocity_exceeded", "device_reuse", "confirmed_abuse"]) assert.ok(classes("INT-ADM-06").has(required));
  for (const required of ["contract_version_superseded", "due_diligence_incomplete", "subprocessor_change"]) assert.ok(classes("INT-ADM-07").has(required));
  for (const required of ["tax_validation_failure", "payment_failure", "meter_correction", "dunning"]) assert.ok(classes("INT-ADM-08").has(required));
  for (const required of ["partial_failure", "compensation_success", "compensation_failure", "rollback_failure"]) assert.ok(classes("INT-ADM-09").has(required));
  for (const required of ["key_rollover", "reverification_failure", "deprovision_failure", "authority_drift"]) assert.ok(classes("INT-ADM-10").has(required));
});

test("suite assessment fails closed for missing, altered, duplicate, and live-claim scenarios", () => {
  const canonical = ORGANISATION_ADMISSION_CONFORMANCE_PACKS["INT-ADM-09"];
  const missing = canonical.filter((entry) => entry.scenarioClass !== "compensation_failure");
  assert.equal(assessOrganisationAdmissionConformancePack("INT-ADM-09", missing).status, "blocked");

  const altered = canonical.map((entry, index) => index === 0 ? { ...entry, sourceChecksumSha256: "0".repeat(64), commerciallyLive: true } : entry);
  const alteredAssessment = assessOrganisationAdmissionConformancePack("INT-ADM-09", altered);
  assert.equal(alteredAssessment.status, "blocked");
  assert.ok(alteredAssessment.findings.some((finding) => finding.code === "source_checksum_mismatch"));
  assert.ok(alteredAssessment.findings.some((finding) => finding.code === "live_claim_forbidden"));

  const duplicate = [...canonical, canonical[0]];
  assert.ok(assessOrganisationAdmissionConformancePack("INT-ADM-09", duplicate).findings.some((finding) => finding.code === "duplicate_scenario_id"));
});

test("execution enforces tenant, purpose, source lineage, replay safety, and non-live status", () => {
  const scenario = ORGANISATION_ADMISSION_CONFORMANCE_PACKS["INT-ADM-09"].find((entry) => entry.scenarioClass === "partial_failure");
  const simulator = createOrganisationAdmissionConformanceSimulator({ tenantId: "tenant-a", purpose: scenario.purpose, seed: "fixed-seed" });
  const input = { tenantId: "tenant-a", purpose: scenario.purpose, scenarioId: scenario.scenarioId, idempotencyKey: "provision-1", sourceVersion: scenario.sourceVersion, sourceChecksumSha256: scenario.sourceChecksumSha256, payload: { topologyRef: "topology-v1" } };
  const first = simulator.execute(input);
  const replay = simulator.execute(input);
  assert.deepEqual(replay, first);
  assert.equal(first.observedDisposition, "fail_closed");
  assert.equal(first.executionMode, "simulated");
  assert.equal(first.simulated, true);
  assert.equal(first.commerciallyLive, false);
  assert.match(first.evidenceChecksumSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => simulator.execute({ ...input, tenantId: "tenant-b" }), (error) => error.code === "admission_conformance_tenant_mismatch");
  assert.throws(() => simulator.execute({ ...input, purpose: "borrower_kyc" }), (error) => error.code === "admission_conformance_purpose_mismatch");
  assert.throws(() => simulator.execute({ ...input, sourceChecksumSha256: "f".repeat(64) }), (error) => error.code === "admission_conformance_source_mismatch");
  assert.throws(() => simulator.execute({ ...input, payload: { topologyRef: "changed" } }), (error) => error.code === "admission_conformance_replay_conflict");
  assert.throws(() => createOrganisationAdmissionConformanceSimulator({ tenantId: "tenant-a", purpose: scenario.purpose, seed: "seed", executionMode: "live" }), (error) => error.code === "admission_conformance_live_claim_forbidden");
});

test("all packs compile into DeterministicProviderSimulator contracts", () => {
  const scenarios = buildOrganisationAdmissionSimulatorScenarios();
  assert.equal(Object.keys(scenarios).length, 153);
  const representative = ORGANISATION_ADMISSION_CONFORMANCE_PACKS["INT-ADM-04"].find((entry) => entry.scenarioClass === "certificate_revoked");
  const simulator = createProviderSimulator({ tenantId: "tenant-a", seed: "admission", callbackSecret: "secret", scenarios });
  const result = simulator.submit({ tenantId: "tenant-a", provider: representative.family, operation: representative.operation, idempotencyKey: "rep-1", scenario: representative.scenarioId, payload: { evidenceRef: "signature-evidence" } });
  assert.equal(result.success, false);
  assert.equal(result.response.commerciallyLive, false);
  assert.equal(result.response.sourceChecksumSha256, representative.sourceChecksumSha256);

  const timeout = ORGANISATION_ADMISSION_CONFORMANCE_PACKS["INT-ADM-08"].find((entry) => entry.scenarioClass === "timeout");
  assert.throws(() => simulator.submit({ tenantId: "tenant-a", provider: timeout.family, operation: timeout.operation, idempotencyKey: "bill-1", scenario: timeout.scenarioId, payload: {} }), (error) => error.code === "provider_simulator_timeout");

  const compensationFailure = ORGANISATION_ADMISSION_CONFORMANCE_PACKS["INT-ADM-09"].find((entry) => entry.scenarioClass === "compensation_failure");
  const failed = simulator.submit({ tenantId: "tenant-a", provider: compensationFailure.family, operation: compensationFailure.operation, idempotencyKey: "infra-1", scenario: compensationFailure.scenarioId, payload: {} });
  assert.equal(failed.success, false);
});
