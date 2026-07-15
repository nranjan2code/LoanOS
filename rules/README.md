# LoanOS Decision Engine

The deterministic policy brain of LoanOS: a pure-Rust decision engine that runs as one fully isolated instance per tenant, evaluates versioned/signed policy bundles, enforces the AI kill switch, and gates every AI-agent action.

Authority: this README is operational documentation. The specification is [docs/architecture/decision-engine-design.md](../docs/architecture/decision-engine-design.md) (invariants INV-1..13, decisions DEC-1..11, security controls SEC-1..12, phases PH-0..6). The why is in [ADR 0003](../docs/decisions/0003-decision-engine-pure-rust-per-tenant.md) and [ADR 0005](../docs/decisions/0005-isolated-platform-control-policy-engine.md). If this README and the design doc disagree, the design doc wins.

## The one-paragraph mental model

Policy is data, not code: a `DecisionModel` (JSON — typed fact bindings, expressions in a total language, a findings table, an outcome fold) is content-hashed, four-eyes approved, signed (ed25519), encrypted, and shipped to a per-tenant runtime. Callers send facts, the engine answers `eligible/refer/ineligible` (lending) or `allow/deny/require_human` (guardrails) with reasons and a replayable audit trace. Every error path lands on the restrictive outcome — there is no permissive default anywhere. The agent proposes; the engine disposes.

## Crate map

| Crate | Role |
| --- | --- |
| `crates/rules-core` | Decision contract (`DecisionRequest`/`DecisionResponse`), decimal newtypes, reasons/audiences, fail-closed outcome vocabulary |
| `crates/rules-expr` | Total, typed expression language (spec: `crates/rules-expr/SPEC.md`): lexer → parser → typechecker → fuel-bounded evaluator + domain stdlib (`emi`, `age_years`, …) |
| `crates/rules-model` | Decision-model types, canonical JSON, sha256 content hashing |
| `crates/rules-compile` | Model → executable plan: cross-node type-check, structural validation |
| `crates/rules-eval` | Pure evaluator: `decide()` (infallible, fail-closed), guardrail overlays (`decide_with_guardrails`), shadow mode |
| `crates/rules-bundle` | Signed + encrypted bundle format; verification is the only load path |
| `crates/rules-governance` | Version lifecycle: four-eyes approval, golden-corpus gate, IST effective dating, append-only activation schedule |
| `crates/rules-provider` | `DecisionProvider` federation: native + REST adapters, per-tenant router (legacy-BRMS strangler migration) |
| `crates/rules-service` | The per-tenant instance (axum): tenant binding at boot, kill-switch TTL cache, audit emission — primary deployment shape |
| `crates/rules-napi`, `crates/rules-wasm` | Dev/test bindings; never load napi in a multi-tenant process (DEC-3) |
| `tools/rules-fleet` | Sign bundles, spawn/stop instances, health checks, kill-switch broadcast |
| `tools/rules-replay` | Determinism canary: replays audit records, requires byte-identical reproduction (INV-8) |
| `tools/rules-diff` | Shadow divergence report between two models over a corpus |
| `fixtures/` | `lending-eligibility.json` (the ported credit policy), platform guardrails including `platform-control-staffing.json`, the 542-case differential corpus |

## Build and test

```bash
cd rules
cargo test --workspace                             # 73+ tests incl. invariant suites
cargo clippy --workspace --all-targets -- -D warnings   # includes the f32/f64 deny gate (INV-6)
cargo fmt --all --check
cargo audit
```

The differential harness (`rules-eval/tests/differential_eligibility.rs`) replays the checked-in corpus generated from the JS implementation and requires zero divergence. Regenerate the corpus after changing `packages/core/src/eligibility.js`:

```bash
node tools/gen-eligibility-corpus.mjs
```

## Run a local fleet

```bash
cargo build

# 1. Sign bundles (dev key; production keys live in KMS — SEC-2)
./target/debug/rules-fleet sign --kind tenant --tenant ten_dev \
  --label 2026.07-r1 --effective "2026-07-01T00:00:00+05:30" \
  --author maker --approver checker \
  --signing-key <hex32> --out /tmp/tenant-bundle.json \
  fixtures/lending-eligibility.json

./target/debug/rules-fleet sign --kind platform --label platform-r1 \
  --effective "2026-07-01T00:00:00+05:30" --author a --approver b \
  --signing-key <hex32> --out /tmp/platform-bundle.json \
  fixtures/guardrail-eligibility.json fixtures/guardrail-collections-contact.json

# 2. Fleet config + boot (see tools/rules-fleet for the config schema)
./target/debug/rules-fleet up --config fleet.json
./target/debug/rules-fleet health --config fleet.json

# 3. The instance boots STALE and refuses model-tagged decisions until the
#    control plane affirms kill-switch state (INV-5):
./target/debug/rules-fleet kill-switch --config fleet.json \
  --global false --model cibil_gateway=active

# 4. Decide: POST /v1/decide with a DecisionRequest (see design doc §7).

# Kill-switch drill / teardown
./target/debug/rules-fleet kill-switch --config fleet.json --global true --reason "drill"
./target/debug/rules-fleet down --config fleet.json
```

Every decision appends `{request, response}` to the tenant's audit JSONL; verify determinism any time:

```bash
./target/debug/rules-replay fixtures/lending-eligibility.json \
  fixtures/guardrail-eligibility.json --audit <audit.jsonl>   # exit 0 = byte-identical
```

## API integration

`apps/api/src/server.js` routes all eligibility call sites through `apps/api/src/rules-engine.js`, gated by `LOANOS_RULES_ENGINE`:

- `off` (default) — JS evaluator only, zero behavior change.
- `shadow` — JS decides; the engine runs alongside; divergences are logged; engine failure never affects the caller. Run this in every environment first.
- `active` — the engine's decision, findings, summary, and signed-bundle lineage are authoritative; an unreachable engine fails closed to `refer` for manual handling.

`LOANOS_RULES_ENGINE_URLS` is a required JSON object mapping every tenant ID to its isolated instance URL. There is no shared-instance or single-URL fallback: an absent tenant mapping fails closed before a request is sent.

### Separate platform-control instance

Identity, feature staffing, SoD and agent-authority decisions use `apps/api/src/control-rules-engine.js`, never the business gateway above. Production requires:

```bash
LOANOS_CONTROL_RULES_ENGINE=active
LOANOS_UNIVERSAL_STAFFING=active
LOANOS_CONTROL_RULES_ENGINE_URLS='{
  "ten_dev": {
    "url": "https://ctrl-ten-dev.internal",
    "instanceId": "ctrl-ten-dev-1",
    "tenantBundleHash": "sha256:<approved-control-bundle>",
    "mtlsRequired": true,
    "clientIdentityRef": "spiffe://loanos/api/ten-dev",
    "serverIdentityRef": "spiffe://loanos/control/ten-dev",
    "trustBundleRef": "kms://trust/control-fleet",
    "bundleSigningKeyRef": "kms://keys/ten-dev-control-signing"
  }
}'
```

Every tenant control URL and `ctrl-*` identity must be unique and differ from `LOANOS_RULES_ENGINE_URLS[tenant]`. Provision it as a separate process/pod or stronger isolation unit with distinct service identity, mTLS trust, bundle/key grants, audit partition and operator permissions. The response must attest the exact client/peer identities and verified KMS/HSM signing-key reference. `off` and `shadow` exist for local development and cutover evidence only; production validation rejects them. Any unavailable endpoint, shared/non-HTTPS URL, wrong instance/transport/key/bundle identity or malformed response denies the action (INV-13/SEC-12). New protected staff mutations are also denied until classified into FST-001..034.

## Rules of engagement for changes

- Invariants (INV-n) are test obligations: a change that weakens one is wrong even if tests pass — amend the design doc first or escalate.
- No floats on the evaluation path (INV-6): money/ratios are decimal strings; CI's clippy gate enforces it.
- Evaluation must stay a pure function of (bundle, request): no clock, no I/O, no RNG (INV-1, INV-12).
- New policy goes in as a decision model + golden corpus, never as engine code. New stdlib functions require a platform release and a SPEC.md amendment (DEC-8).
- One runtime, one tenant — nothing may introduce cross-tenant state into an instance (INV-2, ADR 0003).
