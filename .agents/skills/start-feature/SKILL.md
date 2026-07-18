---
name: start-feature
description: Use when starting any new feature, story or enhancement — before writing code. Anchors the work to an epic and capability ID, checks scope and journey impact, and names the skill chain the work will traverse.
---

# Start a feature

Feature work in LoanOS is anchored before it is written: to an epic, to a
capability ID, and to the governed workflows it will pass through. The trap is
code-first delivery — working software that the catalogue, backlog, docs and
claims don't know about, which the knowledge graph then reports as someone
else's drift.

## Workflow

1. **Anchor the work.** Find the epic in `docs/product/build-backlog.md` that
   owns this work (or add one via `groom-backlog`). Find or create the
   capability ID via `add-capability` — with conservative maturity
   (`Planned`/`Partial`); it advances only with evidence.
2. **Scope honestly.** Check `what-we-are-building.md` scope and non-goals —
   if the feature contradicts a non-goal, that's a product decision to raise,
   not code to write. If any of the 21 journeys are affected, check the
   journey support matrix; advancing recorded depth is `update-journey-depth`.
3. **Name the chain before coding.** List which change-class skills the slice
   will traverse — `extract-api-route` for new HTTP surface,
   `update-guide-academy` if user-visible, `compliance-control-change` if a
   control moves, `update-gtm-claim` if it changes what may be claimed,
   `record-adr` if a hard-to-reverse choice is embedded. This list is the
   implementation plan's skeleton and the commit's documentation obligation.
4. **Tests define done — restrictive path first.** For anything that gates,
   verifies or moves money, write the fail-closed/adverse test before the
   happy path (`docs/architecture/testing-strategy.md` maps the layers). New lending or guardrail policy is a decision model (JSON +
   golden corpus), never scattered `if`s (AGENTS.md: policy is data).
5. **Build the smallest honest vertical slice** — domain kernel in
   `@loanos/core`, HTTP in a route module, evidence wired — rather than a
   broad scaffold that leaves every layer partial.
6. **Close the loop.** `definition-of-done`; advance the capability's maturity
   and the epic/bundle status (`groom-backlog`) only to what the evidence
   supports. Commit as `feat(scope): …` citing capability/INV/ADR IDs.
