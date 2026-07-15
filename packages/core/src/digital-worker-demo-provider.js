import { INDIA_REGION } from "./digital-worker-provider.js";

// Deterministic, network-free provider for demonstrations. It deliberately
// receives only the already-minimized provider envelope, never raw borrower data.
export function createDemoDigitalWorkerProvider({ scenario = "standard" } = {}) {
  if (!DEMO_SCENARIOS.includes(scenario)) fail("digital_worker_demo_scenario_invalid", "Unknown digital-worker demo scenario.");
  return Object.freeze({
    id: "loanos-demo-provider",
    async invoke(request) {
      const proposal = proposalFor(request, scenario);
      return {
        providerRequestId: `demo:${request.executionId}:${scenario}`,
        region: INDIA_REGION,
        modelId: request.modelId,
        modelVersion: request.modelVersion,
        proposal,
        usage: { inputTokens: 120, outputTokens: 80, toolCalls: 0 },
        providerLatencyMs: 15
      };
    }
  });
}

export const DEMO_SCENARIOS = Object.freeze(["standard", "needs_human_review", "incomplete_evidence"]);

function proposalFor(request, scenario) {
  const reasons = {
    standard: "Synthetic demonstration proposal. A human must review before any workflow action.",
    needs_human_review: "Synthetic demonstration proposal flagged for mandatory human review.",
    incomplete_evidence: "Synthetic demonstration proposal identifies missing evidence and requires human follow-up."
  };
  return {
    proposalType: request.action,
    summary: reasons[scenario],
    evidenceGaps: scenario === "incomplete_evidence" ? ["synthetic_income_evidence"] : [],
    needsHumanReview: true,
    simulated: true,
    commerciallyLive: false
  };
}

function fail(code, message) { throw Object.assign(new Error(message), { code, status: 422 }); }
