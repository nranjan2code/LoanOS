# ADR 0003: Pure-Rust Decision Engine with Fully Isolated Per-Tenant Runtimes

## Status

Accepted. 2026-07-10.

## Context

Policy logic today is hand-coded JavaScript in `packages/core` (`eligibility.js`, `loan-policy.js`). Thresholds are parameterized from product config, but the decision logic itself is code: every policy change is a deploy, and every tenant shares the same logic. This does not scale to a multi-tenant platform where each regulated entity (RE) runs its own board-approved credit policy, and it makes the decision lineage promised in the architecture blueprint (policy snapshots, replayable decisions, model/policy version on every decision) expensive to retrofit.

Three forces make a dedicated decision engine necessary now:

1. Tenant-specific policy. REs will demand their own underwriting, pricing, and collections policies with their own change cadence. Policy must become versioned data, not shared code.
2. Regulatory lineage. RBI Digital Lending Directions and the draft model-risk guidance require that every material decision be explainable, attributable to a policy version, and reproducible for audit.
3. Agentic AI. The platform will run AI agents and digital workers. A probabilistic system must never act directly; every proposed action needs a deterministic, versioned, fully-traced policy check — including uniform enforcement of the existing AI kill switch, which today is a well-governed state machine (`model-governance.js`) enforced by scattered call-site checks.

The decision engine is the brain of the platform and of each tenant bank. Tenant rule sets are trade secrets (a bank's credit policy), and the engine output binds real money movement. It must therefore be treated as a closely guarded, high-assurance component: confidential, tamper-evident, deterministic, and isolated.

## Decision

1. Build a narrow, opinionated decision engine ("LoanOS Decision Engine"), not a general-purpose BRMS. Scope: lending/pricing/collections decisions and AI/agent guardrail decisions.
2. Implement the engine core in pure Rust, as a cargo workspace at `rules/` in this repository.
3. Run one engine runtime instance per tenant with full isolation. The evaluation runtime is never shared across tenants. Tenant identity is bound at instance boot and enforced on every request. Isolation tiers: OS process → container/pod → microVM/dedicated node → deployment into the tenant's own VPC.
4. Use stateless compiled decision graphs (decision tables, typed expressions, scorecards), not a RETE working-memory engine. Lending decisioning is request/response; RETE is reconsidered only if continuous fact-stream matching (for example fraud monitoring) is built later.
5. The engine never calls AI models. Model outputs enter as provenance-tagged facts. Kill-switch enforcement becomes a deterministic provenance check inside the engine.
6. Rule sets are immutable, content-addressed (SHA-256 of canonical form), signed by the control plane, and distributed to instances as encrypted bundles. Instances verify signatures before loading and record bundle hashes in every decision trace.
7. Platform guardrail rules (RBI floors) are non-overridable; tenant rules may only tighten them. Enforced statically at approval time and dynamically by always-on post-checks.
8. Expose the engine behind a `DecisionProvider` trait so external engines (legacy BRMS over REST, OPA, GoRules ZEN, DMN runtimes) can be federated or proxied per decision key, enabling strangler-fig migration onto the native engine.
9. All engine behavior, contracts, invariants, and phase acceptance criteria are specified in the companion design document: `docs/architecture/decision-engine-design.md`. That document is the source of truth for implementation.

## Alternatives Considered

- Keep extending hand-coded JS in `packages/core`. Rejected: no per-tenant policy without per-tenant deploys, no cheap lineage, floating-point money math, and no uniform guardrail point for agents.
- TypeScript/Node engine inside the existing API. Rejected: shared runtime violates the per-tenant isolation mandate; GC nondeterminism and float arithmetic are liabilities in an audit-grade component; no sandbox story for tenant-authored rules.
- JVM BRMS (Drools, IBM ODM) per tenant. Rejected: 300–500 MB heap and seconds of warmup per instance make full per-tenant isolation economically absurd; licensing and auditability concerns for ODM. These systems remain relevant as federation targets for tenants that already own them.
- Shared multi-tenant engine runtime with logical isolation. Rejected by explicit platform mandate: the engine holds each bank's most sensitive IP and gates money movement; the tenant boundary must be a process/VM boundary, not a row filter.
- SaaS decisioning vendor. Rejected: data residency, RBI outsourcing obligations, rule IP confidentiality, and kill-switch integration all argue for first-party ownership.
- Adopt GoRules ZEN wholesale. Partially deferred rather than rejected: ZEN's Rust core may be embedded as the initial evaluation core behind the `DecisionProvider` trait, and its JDM format is a candidate compatibility target. The governance, isolation, signing, tenancy, and guardrail layers are first-party regardless. Final embed-vs-own-core call is a Phase 1 spike (DEC-10 in the design document).

## Consequences

Positive:

- Policy becomes versioned, signed, effective-dated data with four-eyes activation and byte-replayable decisions.
- Per-tenant blast radius: a crashed or compromised instance affects exactly one tenant; noisy neighbors are structurally impossible.
- Per-tenant change windows and engine version pinning, which banks require.
- One deterministic enforcement point for the AI kill switch and for agent guardrails, making agentic operation defensible to auditors.
- Rust instance footprint (~5–15 MB RSS, millisecond cold start) makes full isolation the default economics, and enables scale-to-zero for dormant tenants plus future deployment inside a tenant's VPC.

Tradeoffs:

- A second implementation language in a Node monorepo: Rust toolchain, CI lanes, and review skills become mandatory.
- A distribution problem is created (bundle signing, fleet controller, kill-switch feeds) that a shared runtime would not have.
- Existing JS decision logic must be ported and shadow-verified before cutover; during transition both implementations coexist.
- Per-tenant instances add fleet operations (provisioning, health, upgrades) — accepted as the cost of the isolation mandate.

## Review Triggers

Revisit this decision if:

- The isolation mandate is relaxed or strengthened (for example regulator-required physical separation for specific RE classes).
- A continuous-matching workload (fraud stream monitoring) makes a RETE-style engine necessary.
- The Phase 1 spike shows embedding ZEN materially outperforms the first-party core on authoring velocity without compromising invariants.
- RBI finalizes model-risk guidance with requirements that change kill-switch or lineage semantics.
- A major tenant requires an engine deployment model not covered by the isolation tiers.
