# Digital Worker Provider Contract

This is the LoanOS-owned, provider-neutral boundary for a live model or agent SDK. It is implemented in `packages/core/src/digital-worker-provider.js`; the adapter is deliberately injected and this repository contains no provider credentials, network client, or live model call.

## Preconditions

The caller must first obtain a fresh authorized execution from the AI agent control plane. The request carries the tenant, installation, exact model/version, input and prompt SHA-256 hashes, purpose, action, India region (`ap-south-1`), provider/model allow-lists, and both deterministic guardrail trace references. `proposalOnly` is mandatory. This boundary is not a replacement for the control-plane authorization, and it cannot create a domain mutation.

## Adapter contract

An injected provider has an `id` and an async `invoke(request)` method. It receives trusted context only, a constrained output schema, and an `AbortSignal`. It returns a provider request ID, exact region, exact model/version, schema-conforming proposal, non-negative token/tool usage, and optional latency. The boundary rejects a missing/changed provider, model, region, response field, or output schema. It calculates deterministic request and proposal checksums for execution evidence without retaining raw prompts.

Calls are bounded by a timeout; timeout, cancellation, transport failure, malformed output, and provider mismatch all fail closed. The current supported residency is Mumbai only. A future Bedrock/Strands adapter must prove each model and service path stays in the allow-listed India region before it is registered for a tenant.

## Completion path

The runtime caller persists only the returned proposal through the existing `completeAiAgentExecution` and `recordAiAgentUsage` control-plane operations, retaining output references/checksums and integer usage evidence. It must map a failed boundary call to the existing `failed` proposal-only outcome/human handoff; it must never retry into a different region, model alias, or provider.

See [Agentic AI Digital Workers](agentic-ai-digital-workers.md) and [AI Agent Platform Operations](ai-agent-platform-operations.md) for governance and operational controls.
