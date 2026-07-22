# ADR 0010: Production digital-worker runtime boundary

- Status: accepted
- Date: 2026-07-22

## Context

LoanOS already has tenant installations, proposal-only authorization, model and
action guardrails, provider-neutral invocation, usage lineage and human review.
The first Bedrock adapter nevertheless contained a silent fabricated-response
fallback, specialized guardrails were policy fixtures rather than mandatory
tool call-site gates, and AI mutations were persisted by replacing a tenant
aggregate. Those choices are unsuitable for multi-replica production operation
and could allow simulation, authority or concurrency ambiguity at the boundary
that handles model output.

The platform needs a boundary that remains portable across model providers but
is strict enough for India residency, tenant isolation, deterministic authority,
exactly-once observable effects and independent human accountability.

## Decision

1. The LoanOS-owned `DigitalWorkerProvider` remains the only model/agent SDK
   boundary. A live adapter requires an injected configured client and exact
   pinned provider, region, model and version. Missing live configuration fails
   closed; simulation exists only behind the explicit demo provider and is
   always marked non-commercial.
2. Model workers receive references and checksums, not direct database access.
   Every retrieval, outbound communication, underwriting handoff and case write
   resolves through a versioned LoanOS tool catalogue. The catalogue names the
   required specialized Rust decision; missing mappings or missing, stale,
   malformed or restrictive decisions deny execution (INV-5).
3. A worker can create proposals only. Human review and the owning domain API
   remain separate steps. The owning API revalidates current human authority,
   case/version state, evidence, idempotency and deterministic policy; accepting
   a proposal is never sanction, pricing, disbursement or policy approval.
4. Production execution state uses tenant-RLS, entity-revisioned persistence,
   content idempotency, lease fencing and a transactional audit/outbox boundary.
   The file aggregate is a non-production profile and cannot substantiate a
   production-admission claim.
5. Interactive governance, workload execution, scheduling, commercial approval,
   evidence verification and audit reads are distinct authorities. HTTP routes
   default unclassified operations to deny and preserve maker/checker separation.
6. Deployment evidence is per tenant, installation, provider feature, model and
   region. `ap-south-1` product availability is not proof that every inference,
   embedding, guardrail, evaluation, log, backup or support path stays in India.

## Consequences

- Live provider adapters cannot offer a convenient local fallback. Developers
  must use explicit demo mode or inject a test client.
- Tool and decision traces become part of the immutable execution envelope and
  must survive replay and incident investigation.
- A durable worker may retry delivery, but idempotency and fencing prevent a
  duplicate proposal, charge or domain effect.
- PostgreSQL/RLS and deployed worker evidence are mandatory for production;
  repository-only controls remain a governed first slice.
- Provider or orchestration SDKs can change without changing domain authority,
  because their types stop at the provider port.

## Alternatives considered

**Let the model SDK own tools and orchestration.** Rejected because provider
tool definitions would become a second authorization system and a hidden durable
workflow engine.

**Keep aggregate persistence and rely on one process.** Rejected because
production scheduling, retries and human actions are concurrent; last-writer-wins
replacement can erase approvals, suspensions or usage evidence.

**Allow a Bedrock-shaped synthetic fallback.** Rejected because it is
indistinguishable from missing production configuration at the call-site and can
create false provider-readiness evidence.

**Permit direct worker writes after policy approval.** Rejected because policy
approval does not replace current authenticated human authority or the owning
domain's validation, accounting and audit transaction.

## References

- Capabilities AIG-020, AIG-022, AIG-024 and AIG-025
- `docs/architecture/agentic-ai-digital-workers.md`
- `docs/architecture/digital-worker-provider-contract.md`
- `docs/product/review-findings-agent-studio-workspace-2026-07-22.md`
- `packages/core/src/ai/digital-worker-provider.js`
