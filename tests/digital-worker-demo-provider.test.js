import test from "node:test";
import assert from "node:assert/strict";
import { createDemoDigitalWorkerProvider, DEMO_SCENARIOS } from "../packages/core/src/digital-worker-demo-provider.js";

const request = { executionId: "demo-run", action: "cam.draft", modelId: "demo-model", modelVersion: "v1" };

test("demo provider is deterministic, proposal-only and explicitly simulated", async () => {
  const provider = createDemoDigitalWorkerProvider({ scenario: "incomplete_evidence" });
  const result = await provider.invoke(request);
  assert.equal(provider.id, "loanos-demo-provider");
  assert.equal(result.proposal.simulated, true);
  assert.equal(result.proposal.commerciallyLive, false);
  assert.equal(result.proposal.needsHumanReview, true);
  assert.deepEqual(result.proposal.evidenceGaps, ["synthetic_income_evidence"]);
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 80, toolCalls: 0 });
});

test("demo provider accepts only declared deterministic scenarios", () => {
  assert.deepEqual(DEMO_SCENARIOS, ["standard", "needs_human_review", "incomplete_evidence"]);
  assert.throws(() => createDemoDigitalWorkerProvider({ scenario: "live" }), (error) => error.code === "digital_worker_demo_scenario_invalid");
});
