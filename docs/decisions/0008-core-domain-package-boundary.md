# ADR 0008: Domain-grouped core kernel behind an explicit package boundary

- Status: accepted
- Date: 2026-07-18

## Context

The domain kernel grew to 121 flat JavaScript modules in `packages/core/src/`, spanning compliance controls, lending, identity, AI governance, tenancy and audit primitives. The directory had no package identity: roughly 150 consumer files in `apps/api`, `apps/help`, `tests/`, `scripts/` and `rules/tools/` reached into it with deep relative specifiers (`../packages/core/src/x.js`, `../../../../packages/core/src/x.js`), and evidence artefacts (`docs/product/capability-trace.json`, the dashboard data set, academy citations) pinned the same flat paths. Any internal move was therefore a repo-wide break, and nothing prevented a consumer from depending on kernel layout details.

## Decision

1. Kernel modules are grouped by domain under `packages/core/src/`: `compliance/`, `lending/`, `finance/`, `identity/`, `ai/`, `journeys/`, `integrations/`, `platform/`, `operations/` and `shared/`. The barrel `src/index.js` stays at the package root and re-exports every module.
2. `packages/core` is a real npm workspace package named `@loanos/core` (declared in the root `package.json` `workspaces` field) with an explicit `exports` map: `"."` resolves to the barrel, `"./*"` to `src/*`.
3. Consumers outside the package import only `@loanos/core` (barrel) or `@loanos/core/<domain>/<module>.js` (direct). Relative specifiers that cross the package boundary are prohibited, including computed `file://` URLs built from repository-root paths.
4. Inside the package, modules use plain relative specifiers (`./x.js` within a domain, `../<domain>/x.js` across domains); the package never imports itself by name.
5. Evidence artefacts, documentation and code comments cite kernel files by their real domain-qualified path (`packages/core/src/ai/model-governance.js`), keeping the fail-closed path-existence validators authoritative.

## Consequences

- Internal kernel layout can change again without touching consumers that import via the package name; only the `exports` map and evidence citations must follow.
- `npm ci`/`npm install` is now required before running anything from a fresh clone (it links the workspace); CI lanes and the AWS showcase bootstrap already ran `npm ci`, so no pipeline changed.
- `package-lock.json` records the workspace entry; the AWS demo manifest is unaffected because it allowlists `packages/core` at directory level and already ships the root `package.json` and lockfile.
- The reorganisation is behaviour-preserving by construction: the eligibility differential corpus regenerates byte-identically (INV-1 lineage unaffected), and the full Node and Rust suites pass unchanged.
