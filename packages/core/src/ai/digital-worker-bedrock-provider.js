import { INDIA_REGION, invokeDigitalWorkerProvider } from "./digital-worker-provider.js";

/**
 * Amazon Bedrock Digital Worker Provider for ap-south-1 (Mumbai).
 * Implements the DigitalWorkerProvider contract around Bedrock / Strands Agents SDK.
 */
export function createBedrockDigitalWorkerProvider(options = {}) {
  const providerId = options.providerId ?? "aws.bedrock";
  const endpointRegion = options.region ?? INDIA_REGION;
  const bedrockClient = options.bedrockClient ?? null;

  return {
    id: providerId,
    region: endpointRegion,

    async invoke(request) {
      if (endpointRegion !== INDIA_REGION || request.region !== INDIA_REGION) {
        throw Object.assign(new Error("Bedrock digital workers must execute in ap-south-1."), {
          code: "digital_worker_region_invalid", status: 403
        });
      }
      if (!bedrockClient || typeof bedrockClient.invokeModel !== "function") {
        throw Object.assign(new Error("A configured live Bedrock client is required; simulation belongs only to explicit demo mode."), {
          code: "digital_worker_bedrock_client_unavailable", status: 503
        });
      }

      const startTime = Date.now();
      const bedrockResponse = await bedrockClient.invokeModel(request);
      if (!bedrockResponse?.bedrockRequestId || !bedrockResponse?.outputPayload || !bedrockResponse?.usage) {
        throw Object.assign(new Error("Bedrock response is missing request, proposal or usage evidence."), {
          code: "digital_worker_bedrock_response_invalid", status: 502
        });
      }

      const latencyMs = Date.now() - startTime;

      return {
        providerRequestId: bedrockResponse.bedrockRequestId,
        region: INDIA_REGION,
        modelId: request.modelId,
        modelVersion: request.modelVersion,
        proposal: bedrockResponse.outputPayload,
        usage: {
          inputTokens: bedrockResponse.usage.inputTokens ?? 0,
          outputTokens: bedrockResponse.usage.outputTokens ?? 0,
          toolCalls: bedrockResponse.usage.toolCalls ?? 0
        },
        providerLatencyMs: latencyMs
      };
    }
  };
}

export async function invokeBedrockWorker(request, options = {}) {
  const provider = createBedrockDigitalWorkerProvider(options);
  return invokeDigitalWorkerProvider(provider, request, options);
}
