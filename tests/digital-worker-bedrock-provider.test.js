import test from "node:test";
import assert from "node:assert/strict";
import { invokeBedrockWorker } from "@loanos/core/ai/digital-worker-bedrock-provider.js";

const H = "a".repeat(64);

function buildValidRequest(overrides = {}) {
  return {
    requestId: "req-1",
    tenantId: "re1",
    executionId: "exec-1",
    installationId: "inst-1",
    action: "cam.draft",
    purpose: "prepare CAM",
    inputRef: "app-1",
    inputHash: H,
    promptHash: H,
    modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
    modelVersion: "1",
    region: "ap-south-1",
    providerAllowlist: ["aws.bedrock"],
    modelAllowlist: [{ modelId: "anthropic.claude-3-sonnet-20240229-v1:0", version: "1" }],
    authorization: {
      modelConsumptionTraceRef: "trace:consumption",
      actionGuardrailTraceRef: "trace:action",
      proposalOnly: true
    },
    outputSchema: {
      type: "object",
      required: ["proposal_summary", "status"],
      properties: {
        proposal_summary: { type: "string" },
        status: { type: "string" }
      }
    },
    ...overrides
  };
}

test("invokeBedrockWorker executes successfully in ap-south-1 with allow-listed Bedrock provider", async () => {
  const result = await invokeBedrockWorker(buildValidRequest());
  assert.equal(result.proposal.status, "proposal_created");
  assert.equal(result.evidence.providerId, "aws.bedrock");
  assert.equal(result.evidence.region, "ap-south-1");
  assert.equal(result.evidence.usage.inputTokens, 450);
  assert.equal(result.evidence.usage.outputTokens, 180);
});

test("invokeBedrockWorker fails closed when region is not ap-south-1", async () => {
  await assert.rejects(
    () => invokeBedrockWorker(buildValidRequest({ region: "us-east-1" })),
    (err) => err.code === "digital_worker_region_invalid"
  );
});
