# LoanOS Decision Engine — Design

Status: Approved design, pre-implementation. Companion decision record: `docs/decisions/0003-decision-engine-pure-rust-per-tenant.md`.

Classification: Internal — restricted. This document describes the platform's decision brain. It contains no tenant rule content, but its threat model and control descriptions are sensitive. Do not share outside the engineering and compliance teams.

## 1. How to Use This Document

This document is written for three readers and each has a contract with it:

- Human architects and reviewers: sections 2–6 give the shape and the reasoning; section 12 gives the threat model. Disagreement is resolved by amending this document first, code second.
- AI coding agents and human implementers: this document is the specification. Requirements carry stable IDs — `INV-n` (invariants), `DEC-n` (design decisions), `SEC-n` (security controls), `PH-n` (delivery phases). Rules of engagement:
  - Treat every `INV-n` as a test obligation. An invariant without an automated test is unimplemented.
  - Cite IDs in commit messages, PR descriptions, and code comments where a non-obvious constraint is enforced (for example `// INV-12: time must come from the request`).
  - Do not implement ahead of the current phase (section 15). Do not weaken an invariant to make a test pass; escalate instead.
  - If the code and this document disagree, the document wins until the document is amended through review.
- Auditors and compliance: sections 8 (lineage), 10 (kill switch), and 12 (controls) map to the regulatory register in `docs/compliance/india-regulatory-register.md`.

## 2. Purpose and Scope

The Decision Engine is the deterministic policy brain of LoanOS. It answers exactly one kind of question: given these facts, under this tenant's policy as of this moment, what is the decision, and why?

It serves two decision families:

1. Lending decisions — eligibility, affordability (FOIR), pricing bounds, offer validation, collections treatments.
2. Guardrail decisions — whether an AI model output may be consumed, and whether an AI agent / digital worker may perform a proposed action (`allow` / `deny` / `require_human`), with bound constraints.

The engine is the enforcement point where the probabilistic layer (models, agents) meets the deterministic layer (policy, regulation): the agent proposes, the engine disposes.

### Non-goals

- Not a general-purpose BRMS. No arbitrary rule flows, no Turing-complete rule scripts, no tenant-defined functions (v1).
- Not a model host. The engine never invokes AI models (DEC-4). Model outputs arrive as facts.
- Not a workflow engine. It decides; LWS routes and executes.
- Not a data platform. It holds no borrower data at rest; facts arrive on each request and traces are written to the tenant's encrypted audit stream.

## 3. Glossary

| Term | Meaning |
| --- | --- |
| Decision key | Stable logical name of a decision, namespaced by family: `lending.eligibility`, `guardrail.collections_contact`. |
| Decision model | A declarative graph of typed nodes (tables, expressions, scorecards) that computes one decision. |
| Ruleset | A versioned collection of decision models plus their input/output schemas. |
| Bundle | The signed, encrypted, content-addressed distribution unit of a ruleset. Two kinds: platform guardrail pack, tenant pack. |
| Facts | The JSON input payload for one decision request. |
| Provenance tag | Metadata attached to a fact path recording its source, in particular `model:<id>:<version>`. |
| Trace | The complete evaluation record of one decision: nodes visited, rules fired, guardrail checks, outcome. |
| Instance | One per-tenant engine runtime process. Bound to exactly one `tenant_id` for its lifetime. |
| Control plane | Shared services: authoring, review/approval, bundle signing, fleet controller, kill-switch feed. Holds per-tenant-encrypted stores. |
| Guardrail pack | The platform ruleset encoding RBI floors. Non-overridable, evaluated on every request. |
| Overlay | The tighten-only relationship of tenant rules over platform guardrails. |
| Fuel | A hard budget of evaluation steps; exhaustion aborts evaluation fail-closed. |

## 4. Invariants

These are the load-bearing guarantees. Each must have automated verification (see section 14 for the test strategy).

- INV-1 Determinism. Identical (engine build, bundles, request) produce byte-identical response and trace, on any platform, any number of times. During evaluation the engine performs no wall-clock reads, no RNG, no network or filesystem I/O, and no iteration over nondeterministically ordered collections.
- INV-2 Tenant isolation. One runtime instance serves exactly one tenant. No cross-tenant data ever shares an address space. A request whose `tenant_id` differs from the instance binding is rejected and raises a security alarm.
- INV-3 Signed bundles only. An instance loads a bundle only after verifying its signature and content hash against the control plane's published keys. Unverifiable bundles are rejected and alarmed, never "loaded in degraded mode".
- INV-4 Guardrails always run. Platform guardrail pre-checks and post-checks execute on every evaluation and cannot be disabled, skipped, or overridden by tenant rules. Tenant rules may only tighten platform bounds.
- INV-5 Fail closed. Any evaluation error — missing required fact, type mismatch, fuel exhaustion, internal error — and any stale kill-switch state on a model-tagged path yields the decision family's restrictive outcome (`refer` for lending, `deny` or `require_human` for guardrails). There is no permissive default, ever.
- INV-6 Exact arithmetic. All money and ratio arithmetic is fixed-point decimal (`rust_decimal`). Binary floating point is forbidden on the evaluation path. Money and ratio facts are transported as JSON strings, never JSON numbers.
- INV-7 Totality. The expression language is not Turing-complete: no recursion, no unbounded loops; list operations are fuel-bounded. Every evaluation terminates.
- INV-8 Full lineage. Every decision emits a trace sufficient to replay it: request, bundle hashes, engine build, node-by-node evaluation record. Replaying a trace against its pinned bundle reproduces the outcome byte-identically (this is INV-1 exercised from stored data).
- INV-9 Four-eyes activation. No ruleset version becomes active without distinct authenticated author and approver identities, both recorded in the version's signed metadata.
- INV-10 Rule confidentiality. Rule content exists only in the control plane store and inside the owning tenant's instance memory. Logs, metrics, and error messages carry rule/node IDs and hashes only. Responses to agent-facing or borrower-facing callers carry audience-filtered reasons, never traces or rule internals.
- INV-11 Data, not code. Bundles are declarative data. Instances load no dynamic code, no plugins, no tenant-supplied functions. Engine behavior changes only via signed platform releases.
- INV-12 Time is an input. `effective_at` and `evaluated_at` arrive on the request (stamped by the gateway). The engine never reads the system clock during evaluation. All tenant-facing effective dates are interpreted in IST.

## 5. System Topology

Per ADR 0003, the runtime is per-tenant; the control plane and gateway are shared but thin.

```
callers (API app, LWS workflows, AI agents)
        │  DecisionRequest / DecisionResponse (one contract)
        ▼
shared gateway ── authN, tenant resolution, request stamping; NO rule logic
        │  mTLS, tenant-scoped identity
        ▼
tenant instance (one per tenant; process/pod/microVM/tenant-VPC tier)
  ├─ verified bundles: platform guardrail pack + this tenant's pack only
  ├─ compiled decision graphs (in-memory, cached by hash)
  ├─ kill-switch cache (TTL-bound, fail-closed)
  └─ trace emitter → tenant's encrypted audit stream
        ▲
control plane ── authoring, four-eyes review, canonicalization, signing,
                 bundle distribution, kill-switch feed, fleet controller
```

Shared components hold no evaluation state and never see decrypted tenant rule content outside the control-plane store boundary. The gateway routes; the instance decides.

Isolation tiers (same binary, escalating boundary): supervised process with cgroup limits → per-tenant pod with network policy → Firecracker microVM or dedicated node → instance deployed in the tenant's own VPC. The tier is a commercial/contractual attribute of the tenant, recorded in the tenant registry.

## 6. Design Decisions

- DEC-1 Pure Rust cargo workspace at `rules/`. Rationale: deterministic runtime (no GC), exact decimal arithmetic, ~5–15 MB instances enabling the isolation mandate, memory safety in a closely guarded component.
- DEC-2 Stateless compiled decision graphs, not RETE. Lending decisioning is request/response over a bounded fact payload. Graphs compile once per bundle hash and evaluate in microseconds. RETE is reconsidered only for future continuous-matching workloads.
- DEC-3 Per-tenant isolated runtime. See ADR 0003. The napi-rs in-process binding exists for dev/test and single-tenant dedicated deployments only; it must never be loaded in a multi-tenant process.
- DEC-4 Models are upstream, never in-line. The engine consumes model outputs as provenance-tagged facts. This keeps evaluation pure (INV-1) and reduces kill-switch enforcement to a deterministic provenance check (section 10).
- DEC-5 Content-addressed immutable versions. A ruleset version ID is the SHA-256 of its canonical JSON form. Versions are never mutated; activation is a pointer move with an effective window.
- DEC-6 Dual guardrail enforcement. Tighten-only is checked statically at approval time where provable, and unconditionally at runtime by platform post-checks that clamp or override tenant outputs breaching a floor (recording the override in the trace). Runtime enforcement is the guarantee; static checking is developer experience.
- DEC-7 Federation via `DecisionProvider`. The native engine is one provider among adapters (legacy BRMS REST, OPA, GoRules ZEN, DMN). A per-tenant router binds each decision key to a provider, enabling proxy-first onboarding and strangler-fig migration with trace diffing. All providers emit the same trace envelope.
- DEC-8 Small total expression language. CEL-like, statically typed, with a vetted domain standard library (`emi`, `age_years`, `round` with explicit rounding mode, date/tenor arithmetic). No tenant-defined functions in v1; stdlib grows only via platform release.
- DEC-9 JSON everywhere, decimals as strings. Wire format, canonical form, and authoring format are JSON. Canonicalization: UTF-8 NFC, lexicographically sorted keys, no insignificant whitespace, decimals as strings. The canonical bytes are what gets hashed and signed.
- DEC-10 Evaluation core: first-party. Resolved 2026-07-10 during PH-1. Rationale: (a) INV-6 requires decimals-as-strings and decimal-only arithmetic through the entire evaluation path — ZEN's JDM evaluates JSON numbers natively and would need forking to uphold INV-5/INV-6 semantics unmodified; (b) SEC-7's minimal-dependency policy for eval-path crates is trivially met by the first-party core (serde, rust_decimal, chrono, sha2 only); (c) the v1 node set proved small enough that the eligibility port plus differential harness cost less than adapter integration would have. JDM format compatibility at the model layer remains open for authoring-tool reuse, and the `DecisionProvider` trait (DEC-7) keeps a future ZEN adapter possible per tenant.

## 7. The Decision Contract

One request/response envelope for every decision, every provider, every deployment shape.

### DecisionRequest

```json
{
  "request_id": "req_01JZX4Y8K2",
  "tenant_id": "ten_udaan_nbfc",
  "decision_key": "lending.eligibility",
  "effective_at": "2026-07-10T11:30:00+05:30",
  "version_pin": null,
  "facts": {
    "borrower": { "date_of_birth": "1991-04-02" },
    "economic_profile": {
      "monthly_income": "85000.00",
      "existing_monthly_obligations": "22000.00"
    },
    "product": {
      "requested_amount": "300000.00",
      "requested_tenor_months": 24,
      "annual_interest_rate_bps": 1850
    },
    "bureau": { "score": 742 }
  },
  "fact_provenance": {
    "/bureau/score": { "source": "model", "model_id": "cibil_gateway", "model_version": "2" }
  },
  "context": {
    "channel": "dla_app",
    "caller": "workflow:underwriting",
    "kill_switch": {
      "as_of": "2026-07-10T11:29:41+05:30",
      "global": { "active": false },
      "models": { "cibil_gateway": "active" }
    }
  }
}
```

Contract rules:

- `facts` is validated against the decision model's declared input schema before evaluation; unknown required fields fail closed (INV-5).
- Money and ratios are strings (INV-6). Integers (counts, bps, months) may be JSON numbers.
- `fact_provenance` keys are JSON Pointers into `facts`. Model-derived facts must be tagged; the guardrail pack rejects untagged facts on paths the schema declares as model-sourced.
- `effective_at` selects the ruleset version by effective window; `version_pin` (a bundle hash) overrides it for replay and simulation. Callers outside audit/simulation roles may not pin.
- `context.kill_switch` is stamped by the instance from its local cache, not supplied by the caller; a caller-supplied value is ignored and alarmed.

### DecisionResponse

```json
{
  "request_id": "req_01JZX4Y8K2",
  "decision": "refer",
  "outputs": {
    "foir": "0.4359",
    "estimated_emi": "15049.81",
    "max_eligible_amount": "250000.00"
  },
  "reasons": [
    {
      "severity": "info",
      "code": "FOIR_NEAR_CEILING",
      "regulation": "RBI-DL-2025",
      "message": "FOIR is within policy but above the straight-through threshold.",
      "path": "economic_profile",
      "audience": "internal"
    }
  ],
  "ruleset": {
    "tenant_pack": "sha256:9f2c41d0…",
    "platform_pack": "sha256:77aa10b3…",
    "version_label": "2026.07-r2",
    "effective_from": "2026-07-01T00:00:00+05:30"
  },
  "trace_ref": "audit://ten_udaan_nbfc/decisions/tr_01JZX4YA7Q",
  "engine": { "instance_id": "eng-ten_udaan_nbfc-2", "build": "0.1.0+sha.4be1" },
  "evaluated_at": "2026-07-10T11:30:00.412+05:30"
}
```

Contract rules:

- `decision` values are fixed per family: lending → `eligible | refer | ineligible` (aligned with `ELIGIBILITY_DECISIONS` in `packages/core/src/eligibility.js`); guardrail → `allow | deny | require_human`.
- `reasons[]` matches the shape of `createFinding(severity, regulation, message, path)` in `packages/core/src/compliance-controls.js`, extended with `code` and `audience`. Audience values: `internal`, `tenant_ops`, `borrower`. The gateway strips reasons above the caller's audience level (INV-10).
- `trace_ref` points into the tenant's encrypted audit stream. Traces are never inlined to agent- or borrower-facing callers (INV-10).

## 8. Decision Model, Versioning, Lineage

### Model

A decision model is a directed acyclic graph. Node kinds (v1): `input` (declares typed fact schema), `expression`, `decision_table` (hit policies: `first`, `all`, `collect`), `scorecard`, `switch`, `subdecision` (invoke another model in the same bundle), `output` (declares outcome mapping and typed outputs). The compiler (`rules-compile`) validates: acyclicity, full type-checking across node boundaries, exhaustive `switch`/table defaults (a table with no matching row and no default is a compile error, not a runtime surprise), and overlay legality (section 9).

Decision-table sketch for the FOIR referral (illustrative, not tenant policy):

```json
{
  "kind": "decision_table",
  "id": "t_foir_disposition",
  "hit_policy": "first",
  "inputs": ["foir", "policy.max_foir", "policy.refer_fraction"],
  "rules": [
    { "when": ["foir > policy.max_foir"],                          "then": { "disposition": "ineligible", "reason_code": "FOIR_EXCEEDED" } },
    { "when": ["foir > policy.max_foir * policy.refer_fraction"],  "then": { "disposition": "refer",      "reason_code": "FOIR_NEAR_CEILING" } },
    { "when": [],                                                  "then": { "disposition": "eligible" } }
  ]
}
```

### Expression language

Typed, total, CEL-like (DEC-8). Types: `bool, int, decimal, money, string, date, datetime, duration, enum, list<T>, record, optional<T>`. Null-safe access `a?.b`; membership `in`; bounded combinators `all/any/filter/map` charged against fuel; comparison and decimal arithmetic with explicit rounding only through `round(value, places, mode)`. Standard library is versioned with the engine build and includes vetted domain functions (`emi(principal, rate_bps, months)` matching the LMS amortization, `age_years(dob, at)`). Any expression that could fail (division, missing optional) must be handled or the evaluation fails closed (INV-5). Grammar and stdlib are specified in `rules/crates/rules-expr/SPEC.md` once scaffolded; that file inherits this section's authority.

### Versioning and governance lifecycle

```
draft ──review──▶ in_review ──approve──▶ approved ──schedule──▶ active(effective_from) ──▶ superseded
                     │                                                        │
                     └──reject──▶ draft                    emergency rollback─┘ (pointer revert, four-eyes expedited)
```

- Version ID = SHA-256 of canonical JSON (DEC-5, DEC-9). Author and approver identities are distinct and recorded (INV-9), then the control plane signs the bundle.
- Effective-dating is first-class: approve today, activate at an IST-midnight boundary matching an RBI circular. Historical versions remain replayable forever.
- Shadow mode: a candidate version evaluates alongside the active one on live traffic; divergences are logged, nothing is decided by the candidate. Activation of a materially divergent version requires an attached simulation report (replay of a historical request corpus) reviewed at approval.

### Lineage

Every evaluation appends a trace to the tenant's encrypted audit stream: request (with facts), bundle hashes, engine build, per-node record (node ID, rules fired, outputs, fuel used), guardrail checks and overrides, kill-switch snapshot, outcome. Replay tooling re-evaluates any trace against its pinned bundle and asserts byte-identical outcome (INV-8); a scheduled job replays samples continuously as a determinism canary.

## 9. Tenancy and Overlay Semantics

Two packs load per instance: the platform guardrail pack and the tenant pack (INV-2, INV-3).

- The guardrail pack encodes regulatory floors as pre-checks (gate before tenant logic: for example, KFS completeness before offer dispatch) and post-checks (validate tenant outputs: DLG cap at 5%, APR disclosure bounds, collections contact windows).
- Tighten-only (INV-4, DEC-6): a tenant rule may lower a ceiling or raise a floor, never the reverse. The compiler rejects provable loosening at approval; at runtime, post-checks clamp or override breaching outputs and record `guardrail_override` in the trace with the platform rule ID — such an override is also an operational alert, since it means a tenant ruleset in production attempted to breach a floor.
- Tenant packs never reference other tenants' anything. There is no cross-tenant rule reuse mechanism; shared best-practice templates are copied into a tenant pack at authoring time, not linked.

## 10. Kill Switch and AI Integration

The existing kill-switch state machine (`packages/core/src/model-governance.js`: global / model / workflow levels, incident-gated clearing) remains the source of truth. The engine is its uniform enforcement point.

- Distribution: the control plane pushes kill-switch state to instances (stream) with polling fallback. Each instance caches state with a TTL.
- Enforcement (deterministic, via DEC-4): a decision path "consumes AI" exactly when it reads a fact tagged `model:*`. Guardrail rules evaluate: if global switch active, or the tagged model is suspended/killed, or the cache is stale beyond TTL — the path's outcome degrades to `refer` (lending) or `deny`/`require_human` (guardrail), with a reason naming the switch state (INV-5). Purely deterministic paths continue evaluating during a partition; only model-tagged paths degrade.
- Clearing follows the existing governed path (incident review, approval reference); the engine only ever consumes switch state, never mutates it.

### Agent and digital-worker guardrails

Every action an agent proposes is a guardrail decision before it is an action. The action is modeled as facts: action type, target borrower/account state, amounts, channel, proposed time (IST), prior contact counts. Illustrative decision keys:

- `guardrail.collections_contact` — RBI contact window (08:00–19:00 IST), frequency caps, harassment rules → `allow | deny | require_human` plus permitted-window outputs.
- `guardrail.offer_dispatch` — KFS complete, APR within product policy, cooling-off honored.
- `guardrail.data_access` — purpose limitation and consent scope for data an agent wants to read.
- `guardrail.model_consumption` — the kill-switch/provenance gate above, callable standalone.

Guardrail responses to agent callers contain the outcome and audience-filtered reasons only — never thresholds, rule text, or traces (INV-10). This both protects rule IP and denies a misbehaving agent the information needed to probe its own cage. Agents have no authoring or approval privileges anywhere in the control plane; rule changes are human, credentialed, maker-checker operations (SEC-8).

## 11. External Engine Federation

```rust
#[async_trait]
pub trait DecisionProvider: Send + Sync {
    async fn evaluate(&self, req: DecisionRequest) -> Result<DecisionResponse, DecisionError>;
    fn capabilities(&self) -> ProviderCapabilities; // trace fidelity, batch, dry-run, version pinning
}
```

- Providers (planned): `NativeEngine`, `ZenAdapter`, `OpaAdapter`, `RestBrmsAdapter` (legacy Drools/ODM behind the tenant's own endpoint), `DmnAdapter`.
- A per-tenant router binds each decision key to a provider. Remote adapters run inside the tenant's instance (their credentials and endpoints are tenant data; INV-2 applies).
- Migration playbook (strangler fig): (1) onboard by proxying the tenant's incumbent engine — live on day one; (2) author the native equivalent, run in shadow, diff traces; (3) flip the router binding per decision key; (4) keep the adapter for rollback until confidence, then retire.
- Every adapter must translate its engine's output into the standard response and trace envelope, so audit lineage is uniform regardless of who answered. An adapter that cannot produce per-rule traces declares reduced `trace_fidelity` in capabilities, which is surfaced in the tenant's compliance posture.

## 12. Security and Threat Model

The engine is the most closely guarded component of the platform: tenant packs are banks' trade secrets, and outputs gate money movement.

Assets: tenant rule IP; platform guardrail pack; decision traces (borrower PII + policy behavior); bundle-signing keys; kill-switch channel; the engine binary itself.

Adversaries considered: external attacker; curious or malicious co-tenant; malicious insider with authoring access; compromised CI/supply chain; compromised LSP integration; a misaligned agent attempting to influence or infer its own guardrails.

Controls:

- SEC-1 Bundle confidentiality. Bundles are encrypted at rest with per-tenant keys (consistent with the platform's per-tenant file-store encryption) and decrypted only in the owning instance's memory. Instances hold KMS grants for exactly their tenant's keys.
- SEC-2 Bundle integrity and provenance. Control plane signs canonical bundle bytes (ed25519, keys in KMS/HSM, documented rotation). Instances pin the verification keys and refuse unsigned/unverifiable bundles (INV-3). Bundle hash appears in every trace.
- SEC-3 Identity and transport. Gateway↔instance and control-plane↔instance use mTLS with tenant-scoped identities; the instance's certificate encodes its `tenant_id`, and the instance independently re-checks `tenant_id` on every request (INV-2 defense in depth behind gateway routing).
- SEC-4 Egress lockdown. Instances may reach only: the control plane (bundles, kill switch), the tenant audit sink, and — where federated — the tenant's declared external engine endpoint. No general internet egress.
- SEC-5 Log hygiene. Rule content, fact values, and thresholds never appear in logs, metrics, or error strings; only IDs, hashes, and counts (INV-10). Traces, which do contain fact values, go exclusively to the per-tenant encrypted audit stream with auditor-role access control.
- SEC-6 No dynamic code (INV-11). The attack surface of a tenant "rule" is data parsed by a memory-safe parser, not code. If tenant-authored expressions are ever evaluated in a lower-trust context, they run in a WASM sandbox with fuel metering inside that tenant's own instance. WASM is never the tenant-to-tenant boundary — the process/VM is (side channels and shared fate rule it out).
- SEC-7 Supply chain. Locked dependencies, `cargo audit`/`cargo vet` in CI, minimal-dependency policy for `rules-core`/`rules-expr`/`rules-eval`, reproducible builds, SBOM published per release, signed release artifacts.
- SEC-8 Human-only authoring. Authoring/approval APIs require human credentials and maker-checker (INV-9); agent service identities are structurally denied these scopes. Approval UI shows a canonical diff of the exact bytes to be signed.
- SEC-9 RBAC. Roles: rule author, reviewer/approver, platform guardrail owner (separate from tenant authors), fleet operator (no rule read access), auditor (read-only traces + versions). No role combines author and approver over the same version (INV-9).
- SEC-10 Memory hygiene. Key material zeroized on drop; instances run non-root, read-only filesystem, seccomp/AppArmor profile per isolation tier.
- SEC-11 Anti-inference. Audience filtering of reasons (INV-10) plus rate limits and anomaly detection on guardrail probing patterns (an agent systematically sweeping fact values to map a threshold is a reportable security event).

## 13. Crate Architecture

Cargo workspace at `rules/` in this repository:

```
rules/
  Cargo.toml            # workspace; deny(float arithmetic) lints on eval-path crates
  crates/
    rules-core          # DecisionRequest/Response, Decimal newtypes (Money, Ratio, Bps),
                        # reasons, trace types, errors. No I/O. Minimal deps.
    rules-expr          # expression language: lexer, parser, typechecker, total evaluator,
                        # versioned stdlib. Fuzz targets. SPEC.md.
    rules-model         # decision-graph model types, JSON (de)serialization,
                        # canonicalization, content hashing.
    rules-compile       # model → executable plan: acyclicity, cross-node type-check,
                        # exhaustiveness, overlay legality (tighten-only static checks).
    rules-eval          # plan evaluator: fuel metering, trace emission, shadow mode,
                        # guardrail pre/post wrapping. No I/O; pure function of (plan, request).
    rules-bundle        # canonical bytes, ed25519 sign/verify, encryption envelope,
                        # bundle fetch/load protocol.
    rules-governance    # version lifecycle: four-eyes review, golden-corpus gate,
                        # IST effective dating, append-only activation schedule.
                        # (Added during PH-2 — not in the original crate list.)
    rules-provider      # DecisionProvider trait, per-tenant router, remote adapters.
    rules-service       # axum service: the per-tenant instance. mTLS, tenant binding,
                        # kill-switch cache, audit emitter, health/metrics. PRIMARY shape.
    rules-napi          # napi-rs binding for dev/test and single-tenant embeds only (DEC-3).
    rules-wasm          # wasm32 build of rules-expr/eval for sandboxed authoring previews.
  tools/
    rules-replay        # trace replay / determinism canary (INV-8).
    rules-diff          # shadow-mode and migration trace diffing.
```

Dependency rule: `rules-core`, `rules-expr`, `rules-model`, `rules-eval` must not depend on tokio, network, or storage crates. Everything effectful lives in `rules-bundle`, `rules-provider`, `rules-service`.

## 14. Testing and Verification Strategy

- Determinism (INV-1/8): property tests evaluating identical inputs repeatedly and across debug/release and x86/ARM CI runners, asserting byte-identical responses; nightly replay canary over sampled production traces.
- Fail-closed (INV-5): fault-injection suite — withheld facts, malformed types, fuel exhaustion, stale kill-switch cache — each asserting the restrictive outcome and a reason, never a permissive default.
- Arithmetic (INV-6): property tests for decimal ops and rounding modes; a lint/CI gate denying `f32`/`f64` in eval-path crates; golden EMI values cross-checked against the LMS amortization.
- Language totality (INV-7): fuzzing (`cargo fuzz`) on lexer/parser/typechecker; adversarial expression corpus (deep nesting, huge lists) asserting fuel-bounded termination.
- Bundles (INV-3, SEC-2): tampered-bundle, wrong-key, and downgrade tests asserting rejection + alarm.
- Overlay (INV-4): approval-time tests for provable loosening; runtime tests asserting post-check override + trace record + alert.
- Golden decision corpus: every ruleset version carries a fixture set (inputs → expected outcome + key outputs); approval requires green goldens. Slice 1 seeds this corpus from the existing JS eligibility tests.
- Differential shadow (PH-1): the ported eligibility graph runs against `packages/core/src/eligibility.js` outcomes over the seed-user corpus; cutover requires zero unexplained divergence.

## 15. Delivery Phases

**This checklist is the single source of truth for engine phase and status (REV-03).** Other documents (`current-implementation.md`, `build-backlog.md` Epic 4) must link here rather than restate phase/status — restating is what produced the REV-01 self-contradiction. Update status here first, then anywhere that links back.

Each phase has acceptance criteria; a phase is done when all its criteria have automated verification or a recorded waiver. Implementers (human or agent) work strictly within the open phase.

### PH-0 — Foundations (docs + scaffold) — complete 2026-07-10
- [x] ADR 0003 and this document merged; docs index updated.
- [x] `rules/` workspace scaffolded with crate skeletons (all crates `publish = false`), CI lanes (fmt, clippy, test, `cargo audit`, float-deny lint via `rules/clippy.toml` disallowed-types + `clippy::float_arithmetic`).
- [x] `rules-core` contract types compile; JSON round-trip tests for DecisionRequest/Response pass (fixtures are the section 7 examples).

### PH-1 — Prove the spine — complete 2026-07-10
- [x] `rules-expr` v1 (grammar per `rules/crates/rules-expr/SPEC.md`, typechecker, fuel-bounded evaluator, stdlib incl. `emi`, `age_years`, `coalesce`) with a 20k-case seeded adversarial parser-robustness corpus in CI. (Amendment: dedicated cargo-fuzz targets deferred to a hardening pass — the in-tree corpus is deterministic and runs on every CI build, which full nightly fuzzing would not.)
- [x] `rules-model` + `rules-compile` + `rules-eval` evaluate the ported `lending.eligibility` graph (`rules/fixtures/lending-eligibility.json`, content-hashed per DEC-5).
- [x] DEC-10 resolved: first-party evaluation core; rationale recorded in section 6.
- [x] Differential harness: 542-case corpus generated from `eligibility.js` by `rules/tools/gen-eligibility-corpus.mjs` (seeded, fixed `now`, checked in), replayed by `rules-eval/tests/differential_eligibility.rs` — zero divergence.
- [x] INV-1, INV-5, INV-6, INV-7 test suites green (`rules-eval/tests/invariants.rs`, `rules-expr/tests/language.rs`).

### PH-2 — Governance and bundles — complete 2026-07-10
- [x] `rules-bundle`: canonicalization, content hashing, ed25519 sign/verify, AES-256-GCM envelope; tamper/wrong-key/downgrade tests green (SEC-1/SEC-2/INV-3). Structural gates enforced at signing AND verification: four-eyes (INV-9), IST effective dates, tenant packs may not carry `guardrail.*` models (DEC-6 static leg).
- [x] Version lifecycle in `rules-governance`: draft → in_review → approved → activation schedule, four-eyes approval gated on a green golden-corpus report, IST effective dating with boundary tests, append-only emergency rollback requiring two distinct operators. (Amendment: v1 store is in-memory; the Postgres-backed control-plane store and KMS key custody land in PH-3 with the fleet controller.)
- [x] Runtime overlay enforcement (INV-4): `decide_with_guardrails` in `rules-eval` — the guardrail pack always evaluates, sees tenant outputs under `/tenant_outputs/`, downgrades breaching outcomes with a `GUARDRAIL_OVERRIDE` audit reason, never upgrades, and an unevaluable guardrail fails the decision closed.
- [x] Shadow mode (`shadow()` — candidate decides nothing) + `rules-diff` CLI operational: verified 0 divergences on identical models (exit 0) and detected 3 divergences on a threshold-mutated eligibility model (exit 1) over the 542-case corpus.

### PH-3 — Per-tenant runtime — core complete 2026-07-10; two items open
- [x] `rules-service` instance: boot-time tenant binding with foreign-bundle refusal, tenant-mismatch rejection + alarm (INV-2), INV-3 verification as the only load path (bad signature = refusal to boot), guardrail pairing by naming convention (`lending.X` -> `guardrail.X`). (Amendment: v1 transport is loopback HTTP; mTLS identities (SEC-3) land with deployment infrastructure, tenant binding is enforced at the application layer meanwhile.)
- [x] Fleet controller (`rules-fleet`, minimal single-node v1): bundle signing CLI, instance spawn/stop from a fleet config, health checks, authenticated kill-switch broadcast with per-model states. Cloud fleet (pods, KMS custody, mTLS issuance) is deployment infrastructure.
- [x] Kill-switch feed + TTL cache + fail-closed degradation, all tested: boot state is deliberately STALE (absence of information is not permission), stale/global/model-killed/unknown-model all degrade model-tagged requests to `refer` while deterministic requests continue; recovery restores evaluation; pushes require the control-plane token.
- [x] Gateway routing from `apps/api` — wired 2026-07-10: all three `evaluateEligibility` call sites in `server.js` (eligibility, KFS, decision) route through `assessEligibilityGated` in `apps/api/src/rules-engine.js`, gated by `LOANOS_RULES_ENGINE=off|shadow|active` (default `off`). Verified live against a running instance: shadow attaches an `engineShadow` record (zero divergence on the reference case) and never affects the caller even with the engine down; active carries engine decision + signed-bundle lineage and fails CLOSED to `refer` when the engine is unreachable (INV-5). Full JS retirement still requires a clean shadow window on real traffic — run `shadow` first in every environment.
- [x] Trace emission: every decision appends `{request(with stamped kill-switch), response}` to the tenant's append-only audit stream; `rules-replay` reproduces live-service audit records byte-identically (verified end-to-end: 2 replayed, 0 divergences). (Amendments: v1 sink is a per-tenant JSONL file pending the encrypted audit-service integration; canary *scheduling* is an ops task once a scheduler exists.)

### PH-4 — AI control plane — complete 2026-07-10 (local staging)
- [x] Fact provenance enforced (DEC-4): bindings may declare `requires_model_provenance`; a present value on such a path without a `source: model` tag fails the decision closed. The eligibility model's bureau score now requires tagging; the 542-case differential corpus passes with tags. `guardrail.model_consumption` is live as a directly callable decision: `allow` on fresh affirmative switch state, `deny` naming the switch otherwise.
- [x] Agent guardrail decisions: `guardrail.collections_contact` (platform pack, `rules/fixtures/guardrail-collections-contact.json`) enforces the RBI 08:00–19:00 IST window, daily/weekly contact caps, hardship human-review, and open-grievance blocks — `allow | deny | require_human`. Guardrail-family decisions are directly callable and never overlay-wrapped (regression-tested: a guardrail must not pair with itself). Audience filtering (INV-10) enforced at the instance via `context.audience`: responses are stripped to the caller's level, audit records always keep the full reason set. (Amendment: agent tool-call *paths* wire through the same `/v1/decide` contract; the agent framework itself does not exist yet — the enforcement point is ready for it.)
- [x] Kill-switch drills, scripted end-to-end against a live instance: global trip → `deny KILL_SWITCH_GLOBAL`, model-only trip → `deny KILL_SWITCH_MODEL`, restore → `allow`; 07:00 IST agent contact denied with the borrower-safe reason only; audit + replay canary byte-identical throughout. (Amendment: workflow-level trips remain represented as model/global states pending the LWS workflow registry integration.)

### PH-5 — Federation — complete 2026-07-10 (in-process pilot)
- [x] `DecisionProvider` trait (`rules-provider`), `NativeProvider` (with optional guardrail wrapping — INV-4 applies through the provider path too), and the per-tenant `Router` with `posture()` reporting each binding's trace fidelity for the tenant's compliance record. An unbound key errors (caller maps to fail-closed, INV-5); a dead remote errors, never a fabricated approval.
- [x] First remote adapter: `RestProvider` for engines speaking the decision contract over HTTP (incumbent behind a shim, another rules-service, OPA/BRMS behind a mapper), declaring `OutcomeOnly` trace fidelity. Strangler playbook executed against a mock incumbent (Drools-shim simulation): proxy on day one → shadow surfaced the incumbent's undocumented 9L referral band as exactly one explained divergence → binding flipped to native (a data change) → rollback binding verified still live. (Amendments: pilot ran in-process against a simulated incumbent — no tenant has a real legacy engine yet; instance-level router config wiring accompanies the first real one. Format-specific adapters (DMN, OPA rego I/O) are written when a concrete target exists.)

## 16. Open Questions

- Instance API: start HTTP/JSON for debuggability; revisit gRPC when fleet size or latency budgets demand it.
- Trace retention and purge mechanics must align with the data-retention module and DPDP obligations — needs a joint design note with compliance.
- Authoring UX: JDM-compatible format would unlock existing table editors (relevant to DEC-10); first-party authoring UI is out of scope until PH-2 ships.
- Control-plane store layout: per-tenant Postgres schemas vs shared schema with per-tenant encryption — align with the platform's Postgres migration direction.
- Scale-to-zero policy per isolation tier (warm pools vs on-demand) — defer until PH-3 load data exists.
