# LoanOS India — Guide for AI Coding Agents

LoanOS is a multi-tenant, RBI-compliance-first lending platform (LOS + LMS + LWS + compliance control plane) for India. This file orients any AI agent (or new human) working in the repo. It is a map, not a spec — follow the pointers.

## Architecture in one view

```
apps/web, apps/tenant, apps/customer, apps/dashboard   static frontends
apps/api          Node HTTP API (no framework), multi-tenant, session/API-key auth
packages/core     domain kernel: compliance controls, KYC, KFS, loan policy,
                  audit hash chain, model governance (kill-switch source of truth)
db/               Postgres schema (optional driver; RLS per tenant)
rules/            THE DECISION ENGINE (Rust cargo workspace) — see below
docs/             product, architecture, compliance, decision records (ADRs)
tests/            Node test suite (node:test): npm test
```

Two runtimes, one system:

1. **Node control/data plane** (`apps/api` + `packages/core`) — workflows, storage (file-backed JSON or Postgres+RLS), tenancy, audit chain. Run: `npm test`, `npm run dev:api`, or `./loanos.sh start`.
2. **Rust decision engine** (`rules/`) — the deterministic policy brain: one fully isolated runtime instance per tenant, signed policy bundles, fail-closed evaluation, AI kill-switch enforcement, agent guardrails. Run: `cd rules && cargo test --workspace`. Read `rules/README.md`.

They meet at `apps/api/src/rules-engine.js`: eligibility call sites in `server.js` are gated by `LOANOS_RULES_ENGINE=off|shadow|active` (default `off`).

## Load-bearing documents (read before structural changes)

| Document | Why it matters |
| --- | --- |
| `docs/architecture/decision-engine-design.md` | Source of truth for the engine. Requirements carry stable IDs — INV-n (invariants = test obligations), DEC-n (design decisions), SEC-n (security controls), PH-n (phases). If code and doc disagree, the doc wins until amended. Cite IDs in commits. |
| `docs/decisions/000*.md` | ADRs: compliance-first foundation, multi-tenant SaaS delivery, per-tenant pure-Rust engine. |
| `docs/architecture/current-implementation.md` | What exists today and where each control lives. |
| `docs/compliance/india-regulatory-register.md` | Regulatory control families (RBI Digital Lending Directions 2025 etc.). |
| `docs/README.md` | Documentation map + definition of done: features are incomplete until the relevant docs are updated. |

## Non-negotiable engineering rules

- **Fail closed.** In the engine and anything feeding it, error paths land on the restrictive outcome (`refer`/`deny`), never a permissive default (INV-5). This includes "service unreachable".
- **Exact money math.** In Rust: `rust_decimal` only; f32/f64 are denied by a clippy gate on evaluation-path crates; money/ratios travel as JSON strings (INV-6). In JS domain code, follow existing rounding helpers.
- **Tenant isolation is absolute.** One engine runtime per tenant (ADR 0003); app-layer tenant partitions plus Postgres RLS on the Node side. Never introduce cross-tenant state.
- **Policy is data.** New lending/guardrail policy becomes a decision model (JSON) with a golden corpus — not engine code, not scattered `if`s in `server.js`.
- **Determinism and lineage.** Engine evaluation reads no clock, no RNG, no I/O; every decision is replayable byte-identically from its audit record (INV-1/8/12).
- **AI is gated.** Model outputs enter decisions only as provenance-tagged facts (DEC-4); the kill switch (`packages/core/src/model-governance.js` is the state source; the engine enforces) degrades model-dependent decisions to manual review. Agent actions go through `guardrail.*` decisions (`allow/deny/require_human`).
- **Docs are part of done.** Architecture change → update `docs/architecture/`; irreversible choice → new ADR; engine change → check the design doc's INV/DEC tables.

## Commands

```bash
npm test                                   # Node suite (148+ tests)
npm run dev:api                            # local API (file store)
./loanos.sh build|start|stop|clean         # orchestration
cd rules && cargo test --workspace         # engine suite (73+ tests)
cd rules && cargo clippy --workspace --all-targets -- -D warnings
node rules/tools/gen-eligibility-corpus.mjs  # regen differential corpus after JS policy changes
```

CI (`.github/workflows/ci.yml`): Node tests (file + Postgres drivers) and the Rust lane (fmt, clippy with float-deny, tests, cargo-audit). All must pass.

## Conventions

- Commit messages: `feat(scope): summary` with body explaining invariants touched; cite INV/DEC/SEC IDs where relevant.
- The repo commits directly to `main` (single-maintainer trunk flow).
- ESM JavaScript throughout (`import`/`export`); no new npm dependencies without strong cause (the API deliberately has one: `pg`).
- Rust: workspace lints are load-bearing (`#![forbid(unsafe_code)]`, float denies); keep pure crates (`rules-core/expr/model/eval`) free of I/O and async deps.
