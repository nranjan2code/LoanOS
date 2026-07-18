---
name: fix-bug
description: Use when fixing any defect in the LoanOS repo — start here before touching code. Encodes failing-test-first, blast-radius classification, routing into the right change-class skill, and the honesty sweep of capability evidence and claims.
---

# Fix a bug

A bug fix in LoanOS is more than a code change: a defect is also evidence that
something the repo *claimed* — a capability maturity, a marketing claim, a
Guide article, a fail-closed guarantee — may have been overstated. Fix the
code, then correct the record.

## Workflow

1. **Reproduce as a failing test first.** A `node:test` case in `tests/` (or a
   Rust test in `rules/`) that fails for the reported reason — the layer map
   is `docs/architecture/testing-strategy.md`. If you cannot reproduce it, you
   do not yet understand it — keep isolating before editing product code.
2. **Classify the blast radius, and route:**
   - Lending eligibility or engine-mirrored decision logic →
     `change-lending-policy` (the corpus gate is why).
   - A compliance control or its interpretation → `compliance-control-change`.
   - Engine crates (`rules/**`) → check the INV/DEC tables in
     `decision-engine-design.md` still hold; cite the IDs; run the cargo gates.
   - Money amounts or ratios → exact math only (INV-6 discipline): existing
     rounding helpers in JS, `rust_decimal` in Rust, never floats.
   - The HTTP boundary → keep the restrictive status on error paths; module
     rules are in `extract-api-route`.
3. **Fix the cause, not the symptom.** Smallest change that makes the failing
   test pass; greenfield rules apply (no compatibility shims to preserve the
   buggy behavior for old callers).
4. **Honesty sweep — correct the record the bug falsified:**
   - Did the bug break behavior a capability cites as `Implemented` evidence?
     Re-verify or downgrade via `add-capability`.
   - Did a `Built` claim assert the broken behavior? `update-gtm-claim`.
   - Did the Guide/Academy teach the broken behavior as working?
     `update-guide-academy`.
   - Did the defect come from a tracked review finding (`REV-n`)? Update its
     status in the review tracker.
   Most fixes need none of these — but check, don't assume.
5. **Keep the regression test forever**, named after the behavior it protects,
   including the restrictive/adverse path if the bug was a fail-open.
6. Finish with `definition-of-done`. Commit as `fix(scope): …`, citing the
   invariant or capability the fix protects.
