# LoanOS India — Guide for AI Coding Agents

LoanOS is a multi-tenant, RBI-compliance-first lending platform (LOS + LMS + LWS + compliance control plane) for India. This file orients any AI agent (or new human) working in the repo. It is a map, not a spec — follow the pointers.

## Architecture in one view

```
apps/web, apps/tenant, apps/customer, apps/dashboard, apps/help, apps/android-field-ops, apps/android-dsa-ops   frontends & Android apps
apps/api          Node HTTP API (no framework), multi-tenant, session/API-key auth
packages/core     domain kernel (@loanos/core workspace package): compliance controls,
                  KYC, KFS, loan policy, audit hash chain, model governance (kill-switch
                  source of truth); modules grouped by domain under src/ (ADR 0008)
db/               Postgres schema (optional driver; RLS per tenant)
rules/            THE DECISION ENGINE (Rust cargo workspace) — see below
deploy/aws/       generation-2 synthetic-showcase infrastructure and immutable release tooling (server/browser only; never Android)
docs/             product, architecture, compliance, decision records (ADRs)
tests/            Node test suite (node:test): npm test
```

Two runtimes, one system:

1. **Node control/data plane** (`apps/api` + `packages/core`) — workflows, storage (file-backed JSON or Postgres+RLS), tenancy, audit chain. Run: `npm test`, `npm run dev:api`, or `./loanos.sh start`.
2. **Rust decision engine** (`rules/`) — the deterministic policy brain: one fully isolated runtime instance per tenant, signed policy bundles, fail-closed evaluation, AI kill-switch enforcement, agent guardrails. Run: `cd rules && cargo test --workspace`. Read `rules/README.md`.

They meet at two deliberately isolated gateways: `apps/api/src/rules-engine.js` for lending/business decisions and `apps/api/src/control-rules-engine.js` for identity/staffing authority. Production requires separate per-tenant business and `ctrl-*` runtime instances (ADR 0005); they may not share a URL, bundle, identity or operator boundary.

## Load-bearing documents (read before structural changes)

| Document | Why it matters |
| --- | --- |
| `docs/architecture/decision-engine-design.md` | Source of truth for the engine. Requirements carry stable IDs — INV-n (invariants = test obligations), DEC-n (design decisions), SEC-n (security controls), PH-n (phases). If code and doc disagree, the doc wins until amended. Cite IDs in commits. |
| `docs/decisions/000*.md` | ADRs: compliance-first foundation, multi-tenant SaaS delivery, per-tenant pure-Rust engine. |
| `docs/architecture/current-implementation.md` | What exists today and where each control lives. |
| `docs/architecture/aws-showcase-deployment.md` | Canonical generation-2 AWS showcase contract: selective artifact boundary, immutable release/update lifecycle, domains, ownership, recovery, and production gaps. Read before changing `deploy/aws/`. |
| `docs/architecture/help-centre-and-academy.md` | Canonical human guidance contract, verification metadata and future tenant/RE overlay boundary. |
| `docs/architecture/tenant-role-staffing-and-feature-gating.md` | Canonical roles, feature staffing, IdP/SCIM, agents, revocation/pause and activity-attribution source. |
| `docs/compliance/india-regulatory-register.md` | Regulatory control families (RBI Digital Lending Directions 2025 etc.). |
| `docs/operations/demo-handbook.md` | Canonical showcase/workshop demo operating model, AWS release, presentation, recovery and teardown guide. |
| `docs/README.md` | Documentation map + definition of done: features are incomplete until the relevant docs are updated. |

## Non-negotiable engineering rules

- **Fail closed.** In the engine and anything feeding it, error paths land on the restrictive outcome (`refer`/`deny`), never a permissive default (INV-5). This includes "service unreachable".
- **Exact money math.** In Rust: `rust_decimal` only; f32/f64 are denied by a clippy gate on evaluation-path crates; money/ratios travel as JSON strings (INV-6). In JS domain code, follow existing rounding helpers.
- **Tenant isolation is absolute.** One engine runtime per tenant (ADR 0003); app-layer tenant partitions plus Postgres RLS on the Node side. Never introduce cross-tenant state.
- **Policy is data.** New lending/guardrail policy becomes a decision model (JSON) with a golden corpus — not engine code, not scattered `if`s in `server.js`.
- **Determinism and lineage.** Engine evaluation reads no clock, no RNG, no I/O; every decision is replayable byte-identically from its audit record (INV-1/8/12).
- **AI is gated.** Model outputs enter decisions only as provenance-tagged facts (DEC-4); the kill switch (`packages/core/src/ai/model-governance.js` is the state source; the engine enforces) degrades model-dependent decisions to manual review. Agent actions go through `guardrail.*` decisions (`allow/deny/require_human`).
- **AI cannot approve releases.** A scoped platform agent may propose releases or rollback and submit attributed canary evidence only with installation/model/prompt/guardrail lineage. Release approval, production promotion and rollback approval require independent authenticated humans; see `docs/architecture/delivery-operations.md`.
- **The AWS showcase release boundary is explicit.** `deploy/aws/demo-package-manifest.txt` is the allowlist; never archive the repository root, add `apps/android-*`, package local dependencies/build outputs, or bypass the committed-`HEAD` default. Releases use immutable S3 keys plus SHA-256 verification; bootstrap is first-boot only and ordinary updates go through SSM with an atomic release switch and health rollback. A database-schema difference must fail closed until a reviewed migration or replacement-stack path exists. Do not manually mutate CloudFormation-owned CloudFront, IAM, network, instance, or alias resources. Read `docs/architecture/aws-showcase-deployment.md` and `deploy/aws/README.md`.
- **Docs are part of done.** Architecture change → update `docs/architecture/`; irreversible choice → new ADR; engine change → check the design doc's INV/DEC tables; user-visible workflow change → update the canonical Guide & Academy content and verification date.
- **AWS demo changes have a documentation set.** A change to packaging, bootstrap, updates, CloudFormation, domains, smoke tests, credentials, recovery, or teardown must review the AWS showcase architecture, AWS runbook, demo handbook, current implementation map, and this file. Update the sales demo narrative/claim register when the visible capability changes.

## Commands

```bash
npm test                                   # Node suite (148+ tests)
npm run dev:api                            # local API (file store)
./loanos.sh build|start|stop|clean         # orchestration
npm run demo:audit                         # validate canonical synthetic showcase profile
./deploy/aws/package-demo.sh --help        # inspect selective server/browser packaging options
./deploy/aws/release-demo.sh deploy --email you@example.com  # create/update the generation-2 showcase
./deploy/aws/release-demo.sh status        # inspect AWS demo and bootstrap state
./deploy/aws/release-demo.sh smoke         # GET-based public demo acceptance checks
./deploy/aws/release-demo.sh dns           # print the external-DNS plan for configured aliases
cd rules && cargo test --workspace         # engine suite (73+ tests)
cd rules && cargo clippy --workspace --all-targets -- -D warnings
node rules/tools/gen-eligibility-corpus.mjs  # regen differential corpus after JS policy changes
```

CI (`.github/workflows/ci.yml`): Node tests (file + Postgres drivers) and the Rust lane (fmt, clippy with float-deny, tests, cargo-audit). All must pass.

## Conventions

- Commit messages: `feat(scope): summary` with body explaining invariants touched; cite INV/DEC/SEC IDs where relevant.
- The repo commits directly to `main` (single-maintainer trunk flow).
- ESM JavaScript throughout (`import`/`export`); no new npm dependencies without strong cause (the API deliberately has one: `pg`).
- Import the domain kernel as `@loanos/core` (barrel) or `@loanos/core/<domain>/<module>.js` — never by relative path across the package boundary (ADR 0008). Inside `packages/core`, plain relative specifiers.
- Rust: workspace lints are load-bearing (`#![forbid(unsafe_code)]`, float denies); keep pure crates (`rules-core/expr/model/eval`) free of I/O and async deps.
