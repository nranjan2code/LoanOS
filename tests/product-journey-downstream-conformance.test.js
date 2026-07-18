import assert from "node:assert/strict";
import test from "node:test";

import { PRODUCT_JOURNEY_TYPES, buildProductJourneyGeneratedConformanceMatrix, runProductJourneyGeneratedConformance } from "@loanos/core";
import {
  PRODUCT_JOURNEY_DOWNSTREAM_SCENARIO_IDS,
  createProductJourneyDownstreamConformanceExecutor
} from "@loanos/core/journeys/product-journey-generated-conformance.js";

test("JD-05 downstream executor runs real lifecycle dependencies for every canonical journey", async () => {
  const matrix = buildProductJourneyGeneratedConformanceMatrix({ lanes: ["api_file"] });
  const run = await runProductJourneyGeneratedConformance({
    matrix,
    executors: {
      api_file: createProductJourneyDownstreamConformanceExecutor({
        now: "2026-01-01T00:00:00.000Z",
        evidencePrefix: "test://jd05/downstream"
      })
    }
  });

  assert.equal(run.summary.selectedCaseCount, PRODUCT_JOURNEY_TYPES.length * 17);
  assert.equal(run.summary.passedCount, run.summary.selectedCaseCount);
  assert.equal(run.summary.failedCount, 0);
  assert.equal(run.summary.blockedCount, 0);
  assert.equal(run.summary.allPassed, true);
  assert.equal(run.summary.productionReady, false);
  assert.equal(run.commerciallyLive, false);

  const happy = run.results.filter((item) => item.scenarioId === "JRN-COM-001");
  assert.equal(happy.length, PRODUCT_JOURNEY_TYPES.length);
  for (const item of happy) {
    assert.deepEqual(item.observation.observations.map((observation) => observation.stage), [
      "accounting", "reporting", "delinquency", "repayment", "closure", "rollback", "audit_replay"
    ]);
    assert.match(item.evidenceRef, /^test:\/\/jd05\/downstream\/.+\/[a-f0-9]{64}$/);
    assert.match(item.observation.evidenceChecksumSha256, /^[a-f0-9]{64}$/);
    assert.equal(item.observation.productionReady, false);
  }
  const expectedStages = {
    "JRN-COM-002": ["policy_decline"],
    "JRN-COM-003": ["missing_evidence"],
    "JRN-COM-004": ["provider_timeout"],
    "JRN-COM-005": ["duplicate_replay"],
    "JRN-COM-006": ["stale_version"],
    "JRN-COM-007": ["audit_replay"],
    "JRN-COM-008": ["wrong_role"],
    "JRN-COM-009": ["self_approval"],
    "JRN-COM-010": ["revocation_mid_work"],
    "JRN-COM-011": ["reconciliation_mismatch"],
    "JRN-COM-012": ["accounting"],
    "JRN-COM-013": ["reporting"],
    "JRN-COM-014": ["delinquency", "repayment", "closure"],
    "JRN-COM-015": ["rollback"],
    "JRN-COM-016": ["audit_replay"]
  };
  for (const [scenarioId, stages] of Object.entries(expectedStages)) {
    const results = run.results.filter((item) => item.scenarioId === scenarioId);
    assert.equal(results.length, PRODUCT_JOURNEY_TYPES.length);
    assert.equal(results.every((item) => JSON.stringify(item.observation.observations.map((observation) => observation.stage)) === JSON.stringify(stages)), true);
  }
  const archetypeResults = run.results.filter((item) => item.scenarioId.startsWith("JRN-ARC-"));
  assert.equal(archetypeResults.length, PRODUCT_JOURNEY_TYPES.length);
  assert.equal(archetypeResults.every((item) => item.observation.observations[0].stage === "archetype_specialist_path"), true);
  const persistent = archetypeResults.filter((item) => item.observation.observations[0].specialist.service === "persistent_specialist_journey/v1");
  assert.equal(persistent.length, 17);
  assert.equal(persistent.every((item) => item.observation.observations[0].specialist.finalStatus === "assessed"), true);
  assert.equal(archetypeResults.filter((item) => item.observation.observations[0].specialist.service === "composed_journey_lifecycle/v1").length, 4);
});

test("JD-05 downstream executor evaluates the full 21×17 contract without a production claim", async () => {
  const matrix = buildProductJourneyGeneratedConformanceMatrix({ lanes: ["api_file"] });
  const run = await runProductJourneyGeneratedConformance({
    matrix,
    executors: { api_file: createProductJourneyDownstreamConformanceExecutor() }
  });

  assert.equal(run.summary.selectedCaseCount, 21 * 17);
  assert.equal(run.summary.passedCount, run.summary.selectedCaseCount);
  assert.equal(run.summary.blockedCount, 0);
  assert.equal(run.summary.failedCount, 0);
  assert.equal(run.summary.allPassed, true);
  assert.equal(run.summary.productionReady, false);
  assert.equal(run.results.filter((item) => item.outcome === "passed").every((item) => item.evidenceRef && item.observation?.observations?.length), true);
  assert.equal(PRODUCT_JOURNEY_DOWNSTREAM_SCENARIO_IDS.length, 16);
});

test("JD-05 downstream executor fails closed on wrong lanes and lineage drift", async () => {
  const executor = createProductJourneyDownstreamConformanceExecutor();
  const matrix = buildProductJourneyGeneratedConformanceMatrix({ journeyTypes: ["personal_loan"] });
  const apiCase = matrix.cases.find((item) => item.laneId === "api_file" && item.scenarioId === "JRN-COM-012");
  const browserCase = matrix.cases.find((item) => item.laneId === "browser_contract" && item.scenarioId === "JRN-COM-012");

  assert.deepEqual(await executor(browserCase), { outcome: "blocked", reasonCode: "downstream_lane_unsupported" });
  assert.deepEqual(await executor({ ...apiCase, scenarioId: "JRN-UNKNOWN-001" }), { outcome: "blocked", reasonCode: "downstream_scenario_not_implemented" });
  await assert.rejects(
    () => executor({ ...apiCase, templateChecksumSha256: "0".repeat(64) }),
    { code: "journey_generated_conformance_template_mismatch" }
  );
  await assert.rejects(
    () => executor({ ...apiCase, workspaceSchemaChecksumSha256: "0".repeat(64) }),
    { code: "journey_generated_conformance_schema_mismatch" }
  );
});

test("JD-05 repository evidence is deterministic across exact generated replays", async () => {
  const matrix = buildProductJourneyGeneratedConformanceMatrix({ journeyTypes: ["personal_loan", "home_loan", "supply_chain_finance"], lanes: ["api_file"] });
  const executor = createProductJourneyDownstreamConformanceExecutor({ now: "2026-01-01T00:00:00.000Z", evidencePrefix: "test://jd05/replay" });
  const first = await runProductJourneyGeneratedConformance({ matrix, executors: { api_file: executor } });
  const replay = await runProductJourneyGeneratedConformance({ matrix, executors: { api_file: executor } });
  assert.equal(first.summary.allPassed, true);
  assert.equal(replay.summary.allPassed, true);
  assert.deepEqual(replay.results.map((item) => item.evidenceRef), first.results.map((item) => item.evidenceRef));
  assert.deepEqual(replay.results.map((item) => item.observation.evidenceChecksumSha256), first.results.map((item) => item.observation.evidenceChecksumSha256));
});
