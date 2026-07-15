import test from "node:test";
import assert from "node:assert/strict";
import { INDIA_REGION, invokeDigitalWorkerProvider } from "../packages/core/src/digital-worker-provider.js";

const H = "a".repeat(64);
const request = () => ({ requestId: "req-1", tenantId: "re-1", executionId: "run-1", installationId: "agent-1", action: "cam.draft", purpose: "prepare CAM", inputRef: "case/1", inputHash: H, promptHash: H, region: INDIA_REGION, modelId: "model-1", modelVersion: "2026-07", providerAllowlist: ["test-provider"], modelAllowlist: [{ modelId: "model-1", version: "2026-07" }], authorization: { modelConsumptionTraceRef: "trace:model", actionGuardrailTraceRef: "trace:action", proposalOnly: true }, outputSchema: { type: "object", required: ["summary", "needsHumanReview"], additionalProperties: false, properties: { summary: { type: "string" }, needsHumanReview: { type: "boolean" } } } });
const provider = (response) => ({ id: "test-provider", invoke: async () => response });
const response = () => ({ providerRequestId: "provider-1", region: INDIA_REGION, modelId: "model-1", modelVersion: "2026-07", proposal: { summary: "Draft only", needsHumanReview: true }, usage: { inputTokens: 12, outputTokens: 8, toolCalls: 0 }, providerLatencyMs: 3 });

test("provider boundary returns schema-validated proposal and checksum/usage evidence", async () => {
  const result = await invokeDigitalWorkerProvider(provider(response()), request());
  assert.equal(result.proposal.summary, "Draft only");
  assert.match(result.evidence.requestChecksum, /^[a-f0-9]{64}$/);
  assert.match(result.evidence.proposalChecksum, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.evidence.usage, { inputTokens: 12, outputTokens: 8, toolCalls: 0 });
});

test("provider boundary fails closed for allow-list, residency, model and output violations", async () => {
  await assert.rejects(() => invokeDigitalWorkerProvider(provider(response()), { ...request(), providerAllowlist: [] }), (e) => e.code === "digital_worker_provider_not_allowlisted");
  await assert.rejects(() => invokeDigitalWorkerProvider(provider({ ...response(), region: "us-east-1" }), request()), (e) => e.code === "digital_worker_provider_region_mismatch");
  await assert.rejects(() => invokeDigitalWorkerProvider(provider({ ...response(), modelVersion: "other" }), request()), (e) => e.code === "digital_worker_provider_model_mismatch");
  await assert.rejects(() => invokeDigitalWorkerProvider(provider({ ...response(), proposal: { summary: "missing field" } }), request()), (e) => e.code === "digital_worker_output_invalid");
});

test("provider timeout cancels through AbortSignal and fails closed", async () => {
  const slow = { id: "test-provider", invoke: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))) };
  await assert.rejects(() => invokeDigitalWorkerProvider(slow, request(), { timeoutMs: 5 }), (e) => e.code === "digital_worker_provider_timeout");
});
