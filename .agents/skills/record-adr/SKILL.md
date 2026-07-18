---
name: record-adr
description: Use when making an irreversible or hard-to-reverse architecture decision in the LoanOS repo (a technology choice, a boundary, a policy that later code will depend on). Produces a numbered ADR and wires it into the decision-record index and the knowledge graph.
---

# Record an architecture decision

Irreversible technical decisions are captured as ADRs so the reasoning survives.
The existing records are `docs/decisions/NNNN-*.md` (0001–0008 at time of
writing). ADR references elsewhere (`ADR NNNN`) are checked by `graph:check`, so
the file must exist before anything cites it.

## Workflow

1. Pick the next number: one above the highest existing `docs/decisions/NNNN-*`.
2. Create `docs/decisions/NNNN-short-kebab-title.md`. Follow the shape of a
   recent ADR (e.g. `0008-core-domain-package-boundary.md`): context, decision,
   consequences, alternatives considered.
3. Add it to the decision-record index `docs/decisions/README.md` **and** to the
   summary line in `docs/README.md` that enumerates ADRs — otherwise `docs:check`
   fails (every doc must be reachable) and the enumeration goes stale.
4. If the decision changes an engineering rule or command, update `AGENTS.md`.
5. Cite the ADR from the code/docs it governs as `ADR NNNN`. Confirm:
   ```bash
   npm run docs:check     # reachability + links
   npm run graph:check    # ADR references resolve
   ```

## When is it an ADR?

If a future engineer would reasonably ask "why is it done this way, and can we
change it?" and the answer is expensive to reverse, it is an ADR. Reversible or
low-stakes choices are not.
