---
name: definition-of-done
description: Run before finishing any change in the LoanOS repo. The repo's definition of done is not "tests pass" — it is "tests pass AND the knowledge graph and companion docs stay consistent." Use when wrapping up a feature, fix, or refactor and before committing.
---

# Definition of done (LoanOS)

A change is done when code, the knowledge graph, and the companion documents are
all consistent — not just when tests are green. Work through this before you
consider a task complete.

## 1. Run the gates that match what you touched

Always cheap to run, always run at least these:

```bash
npm run knowledge:check      # docs reachable + evidence + cross-link graph + journey depth + currency
npm run currency:check -- --staged   # did the companion docs for my change move?
```

The pre-commit hook (`tools/git-hooks/pre-commit`) runs the blocking subset of
these automatically on `git commit` — treat a hook failure as an unfinished
change, not an obstacle. Do not use `--no-verify` to get around it.

Then, by area:

- Touched `packages/core/**` or any JS domain code → `npm test`
- Touched `packages/core/src/lending/eligibility.js` → also `npm run corpus:check`
  (regenerate the JS↔Rust differential corpus, or CI fails). See the
  `change-lending-policy` skill.
- Touched `rules/**` → `cd rules && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
- Touched a capability's scope → `npm run dashboard` (re-syncs trace + dashboard)
- Touched `deploy/aws/**` → review the AWS showcase doc set (the currency
  advisory names them).

## 2. Resolve every currency advisory

`currency:check` prints an advisory when you changed something whose companion
documentation (per `docs/documentation-governance-rules.json`) did not move.
Either update the named companion, or be able to say why it legitimately does
not apply. Do not ignore advisories silently.

## 3. Keep identifier citations resolving

If you added or cited a capability, engine invariant (`INV/DEC/SEC/PH-n`), ADR,
or GTM claim, `graph:check` must stay green. New IDs and their schemes live in
`docs/identifier-registry.md`. Namespace any document-local invariant table
(e.g. `ORG-INV-n`) so it is not read as an engine ID.

## 4. Commit message

`feat(scope): summary`, body explaining invariants touched, citing INV/DEC/SEC
IDs where relevant. Direct to `main` (single-maintainer trunk flow).
