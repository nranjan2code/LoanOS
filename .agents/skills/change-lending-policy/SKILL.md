---
name: change-lending-policy
description: Use when changing the JS lending eligibility policy (packages/core/src/lending/eligibility.js) or any decision logic mirrored by the Rust engine. Prevents the JS implementation and the Rust decision engine from silently diverging.
---

# Change lending policy safely

`packages/core/src/lending/eligibility.js` is the incumbent JS implementation.
The Rust engine test `rules/crates/rules-eval/tests/differential_eligibility.rs`
replays a **recorded** corpus (`rules/fixtures/eligibility-corpus.json`) and
requires byte-identical outcomes. The corpus is a snapshot: if you change the JS
policy and do not regenerate it, both CI lanes stay green while JS and Rust
diverge. This skill closes that gap.

## Workflow

1. Make the policy change in `packages/core/src/lending/eligibility.js`.
2. Regenerate the differential corpus:
   ```bash
   node rules/tools/gen-eligibility-corpus.mjs
   ```
   It is deterministic (fixed seed, fixed `now`), so a re-run with no policy
   change produces no diff.
3. Inspect the diff — `git diff rules/fixtures/eligibility-corpus.json`. The
   outcome-count summary printed by the generator (`ineligible/eligible/refer`)
   should move in the direction you intended. If it moved unexpectedly, your
   policy change had a side effect — investigate before continuing.
4. Run the Rust differential test to confirm the ported model still matches:
   ```bash
   cd rules && cargo test --workspace
   ```
   If the Rust decision model needs to change too, update it so the differential
   test passes against the new corpus.
5. Confirm the drift gate is satisfied:
   ```bash
   npm run corpus:check   # regenerates + fails on any uncommitted drift
   ```
6. Commit the policy change **and** the regenerated corpus together. CI runs
   `corpus:check` and will fail the build if they are out of sync.

## Invariants to keep

- Fail closed (INV-5): error paths land on `refer`/`deny`, never a permissive
  default.
- Exact money math (INV-6): money/ratios as decimal strings; no float.
- Policy is data: prefer expressing new policy as decision-model data with a
  golden corpus over scattered `if`s.
