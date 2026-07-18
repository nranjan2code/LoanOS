import { createHash } from "node:crypto";

// LoanOS-owned boundary around an LLM/agent SDK.  A concrete Bedrock/Strands
// adapter may implement `invoke`, but it must never receive authority to make
// a domain decision or invoke a LoanOS mutation tool directly.
export const INDIA_REGION = "ap-south-1";

export async function invokeDigitalWorkerProvider(provider, request, { timeoutMs = 30_000 } = {}) {
  required(provider?.id, "provider.id");
  if (typeof provider.invoke !== "function") fail("digital_worker_provider_invalid", "Provider must implement invoke(request).");
  validateRequest(request);
  const providerId = provider.id;
  if (!request.providerAllowlist?.includes(providerId)) fail("digital_worker_provider_not_allowlisted", "Provider is not allow-listed for this tenant.", 403);
  if (request.region !== INDIA_REGION) fail("digital_worker_region_invalid", "Digital workers may execute only in the India region.", 403);
  if (!request.modelAllowlist?.some((item) => item.modelId === request.modelId && String(item.version) === String(request.modelVersion))) fail("digital_worker_model_not_allowlisted", "Pinned model/version is not allow-listed.", 403);
  if (!request.authorization?.modelConsumptionTraceRef || !request.authorization?.actionGuardrailTraceRef) fail("digital_worker_authorization_missing", "Fresh model and action guardrail traces are required.", 403);
  if (request.authorization.proposalOnly !== true) fail("digital_worker_proposal_only_required", "Provider output must remain proposal-only.", 403);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("provider_timeout")), timeoutMs);
  const providerRequest = Object.freeze({
    requestId: request.requestId, tenantId: request.tenantId, executionId: request.executionId,
    installationId: request.installationId, action: request.action, purpose: request.purpose,
    region: request.region, modelId: request.modelId, modelVersion: request.modelVersion,
    inputRef: request.inputRef, inputHash: request.inputHash, promptHash: request.promptHash,
    outputSchema: request.outputSchema, proposalOnly: true, signal: controller.signal
  });
  const requestChecksum = checksum({ ...providerRequest, signal: undefined });
  try {
    const response = await provider.invoke(providerRequest);
    validateResponse(response, request);
    const proposalChecksum = checksum(response.proposal);
    return Object.freeze({
      proposal: response.proposal,
      evidence: Object.freeze({ providerId, providerRequestId: response.providerRequestId, region: response.region,
        modelId: response.modelId, modelVersion: String(response.modelVersion), requestChecksum, proposalChecksum,
        usage: normalizeUsage(response.usage), providerLatencyMs: integer(response.providerLatencyMs ?? 0, "providerLatencyMs") })
    });
  } catch (cause) {
    if (controller.signal.aborted) fail("digital_worker_provider_timeout", "Provider invocation timed out or was cancelled.", 504);
    if (cause?.code?.startsWith("digital_worker_")) throw cause;
    fail("digital_worker_provider_failed", "Provider invocation failed; execution is denied.", 502);
  } finally { clearTimeout(timeout); }
}

function validateRequest(x) {
  for (const key of ["requestId", "tenantId", "executionId", "installationId", "action", "purpose", "inputRef", "inputHash", "promptHash", "modelId", "modelVersion", "region"]) required(x?.[key], key);
  if (!hash(x.inputHash) || !hash(x.promptHash)) fail("digital_worker_checksum_invalid", "Input and prompt checksums must be SHA-256 hex.");
  if (!x.outputSchema || x.outputSchema.type !== "object") fail("digital_worker_output_schema_invalid", "A constrained object output schema is required.");
}

function validateResponse(x, request) {
  if (!x || typeof x !== "object") fail("digital_worker_provider_response_invalid", "Provider returned no response.");
  for (const key of ["providerRequestId", "region", "modelId", "modelVersion", "proposal", "usage"]) required(x[key], `response.${key}`);
  if (x.region !== INDIA_REGION || x.region !== request.region) fail("digital_worker_provider_region_mismatch", "Provider response is outside the approved India region.", 403);
  if (x.modelId !== request.modelId || String(x.modelVersion) !== String(request.modelVersion)) fail("digital_worker_provider_model_mismatch", "Provider response does not match the pinned model/version.", 403);
  validateSchema(x.proposal, request.outputSchema);
  normalizeUsage(x.usage);
}

function validateSchema(value, schema, path = "proposal") {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("digital_worker_output_invalid", `${path} must be an object.`);
    for (const key of schema.required ?? []) if (!(key in value)) fail("digital_worker_output_invalid", `${path}.${key} is required.`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, key)) fail("digital_worker_output_invalid", `${path}.${key} is not allowed.`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in value) validateSchema(value[key], child, `${path}.${key}`);
  } else if (schema.type === "string" && typeof value !== "string") fail("digital_worker_output_invalid", `${path} must be a string.`);
  else if (schema.type === "boolean" && typeof value !== "boolean") fail("digital_worker_output_invalid", `${path} must be a boolean.`);
  else if (schema.type === "array" && !Array.isArray(value)) fail("digital_worker_output_invalid", `${path} must be an array.`);
  else if (schema.type === "number" && !Number.isFinite(value)) fail("digital_worker_output_invalid", `${path} must be a finite number.`);
}

function normalizeUsage(usage) { return Object.freeze({ inputTokens: integer(usage?.inputTokens, "usage.inputTokens"), outputTokens: integer(usage?.outputTokens, "usage.outputTokens"), toolCalls: integer(usage?.toolCalls ?? 0, "usage.toolCalls") }); }
function integer(value, name) { if (!Number.isSafeInteger(value) || value < 0) fail("digital_worker_usage_invalid", `${name} must be a non-negative safe integer.`); return value; }
function checksum(value) { return createHash("sha256").update(stable(value)).digest("hex"); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`; return JSON.stringify(value); }
function hash(value) { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
function required(value, name) { if (value === undefined || value === null || value === "") fail("digital_worker_request_invalid", `${name} is required.`); }
function fail(code, message, status = 422) { throw Object.assign(new Error(message), { code, status }); }
