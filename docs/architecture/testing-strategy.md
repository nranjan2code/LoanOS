# Testing strategy

Verified: 2026-07-18

This is the canonical map of how LoanOS is tested: which layers exist, what
each must cover, when a golden corpus is required, and the rules every new
test follows. The practice already runs in CI and the pre-commit gate; this
document makes the strategy itself load-bearing so QA-minded humans and agents
do not have to reassemble it from scattered sources.

## The test-layer map

| Layer | Where | Runs via | What it must cover |
| --- | --- | --- | --- |
| Node domain + route + app tests | `tests/*.test.js` (`node:test`, no framework) | `npm test`; CI file-store lane; area-triggered locally | Domain kernels in `@loanos/core`, route modules through the real server composition, app/content contracts (help, academy, dashboard, demo). |
| Local interactive-browser harness | `tests/browser/jd05-interactive-harness.*` | `npm run jd05:browser`, then open the printed loopback URL | A disposable synthetic borrower session drives the actual journey-workspace DOM through unauthenticated denial, all 21 journeys, malformed/required-field denial, save/resume/submit, injected outage/recovery, bilingual projection, focus/live regions and no-store checks. The result is recorded only as non-production evidence. |
| Postgres/RLS lane | `tests/postgres-store.test.js` (un-skipped by `DATABASE_URL_TEST`) plus `tests/product-journey-generated-conformance-postgres.test.js` (selected only by the dedicated command) | CI `test-postgres` job; mandatory `npm run test:journey-postgres` JD-05 command | Schema application, the two-role model, RLS-scoped assertions proving tenant isolation, and persistence/recovery of the complete 21 × 17 non-production journey evidence corpus. The dedicated command fails when the selected database is absent instead of silently accepting a skip, and keeps its schema-resetting corpus isolated from the general database suite. |
| Rust engine suite | `rules/` workspace tests | `cd rules && cargo test --workspace`; CI Rust lane | Engine invariants (`INV-n` IDs in `decision-engine-design.md` are test obligations), fail-closed evaluation, determinism/replay. |
| JS↔Rust differential corpus | `rules/fixtures/eligibility-corpus.json` replayed by `differential_eligibility.rs` | `npm run corpus:check` (hard gate: hook + CI) | Byte-identical outcomes between the JS policy and the Rust model; the corpus regenerates deterministically (fixed seed, fixed `now`). |
| Lint/format as tests | clippy float-deny on eval-path crates, `cargo fmt --check`, `cargo audit`; Android `lintDebug` | CI lanes; `loanos.sh build` | Exact-money discipline (INV-6), unsafe-code prohibition, dependency advisories, Android static analysis. |
| Content/artifact contract tests | `tests/help-centre.test.js`, `ba-academy`, `technical-academy`, `capability-tracking`, `demo-system` | inside `npm test` | Generated learning content, course counts, capability catalogue↔trace↔dashboard parity, canonical demo profile. |
| Knowledge gates as tests | `docs:check`, `trace:validate`, `graph:check`, `dashboard:check`, `depth:check` | pre-commit hook + CI | Documentation reachability, evidence resolution, identifier citations, derived-artifact drift. |
| Android build lanes | `apps/android-field-ops`, `apps/android-dsa-ops` | CI matrix (`assembleDebug` + `lintDebug`) | The two Android apps compile and pass lint; no instrumented device tests yet. |

## Non-negotiable testing rules

- **Adverse path first.** For anything that gates, verifies, or moves money,
  the restrictive-path test (`refer`/`deny`/`hold`, invalid input, service
  unreachable) is written before the happy path. A control without a test for
  its restrictive path is not done (INV-5 discipline).
- **A bug fix starts as a failing test** and its regression test is kept
  forever, named after the behavior it protects (`fix-bug` skill).
- **Evidence floors bind maturity to tests.** A capability may be marked
  `Implemented` only with both executable test evidence and code/endpoint
  evidence (`capability-evidence-policy.json`); the floors only ratchet up.
- **A golden corpus is required** whenever the same decision logic exists in
  two runtimes or a committed artifact is derived from code. The corpus is
  regenerated deterministically and committed with the change; a drift gate
  (`corpus:check`, `depth:check`, `dashboard:check`) fails CI otherwise.
- **Route tests exercise the real composition** — through `server.js` with
  authentication, tenant resolution and staffing in place — not the router
  function in isolation, so fail-closed and isolation behavior is what is
  actually asserted.
- **Cross-tenant isolation is proven, not assumed**: app-layer isolation in
  the Node suite and RLS assertions in the Postgres lane.
- **No new test frameworks.** `node:test` and cargo's built-in harness; a new
  dependency for testing needs the same strong cause as any other.

## Known boundaries (honest gaps)

- The JD-05 browser harness is local and browser-executable, not a CI-managed
  cross-browser/device suite. It does not provide visual regression,
  assistive-technology certification or production operating evidence; other
  frontends still use content contracts plus manual visual verification paths.
- No code-coverage metric or floor; coverage discipline is carried by the
  evidence policy and adverse-path rule instead.
- No load/performance or chaos testing; the resilience probe
  (`npm run probe`) is a bounded operational check, not a load test.
- Android lanes build and lint but do not run instrumented tests.

Extending any of these is a `start-feature`-anchored change; removing or
weakening an existing lane requires an ADR.
