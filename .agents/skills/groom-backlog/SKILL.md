---
name: groom-backlog
description: Use when opening, updating or closing epics, delivery bundles, roadmap phases or review findings — the status lifecycle of docs/product/build-backlog.md, roadmap.md and the review-findings trackers. Statuses only move with evidence.
---

# Groom the backlog

`build-backlog.md` (epics + the Large Delivery Bundle table), `roadmap.md`
(phases) and `review-findings-*.md` (`REV-n` items) are status records, not
aspirations. The trap is a status that outruns the evidence — a bundle marked
Complete whose capabilities are still `Partial`, or a REV item closed in the
summary table but not its detail block.

## Workflow

1. **Statuses move only with evidence.** Before marking anything Complete/
   DONE, name the tests, capabilities, endpoints or docs that prove it — the
   same discipline as the capability evidence policy. A bundle can never be
   more complete than the maturity of the capabilities inside it
   (`add-capability` owns that side).
2. **When work ships:** update the owning epic's rows; if it closes a bundle,
   update the bundle table in the same change; if it resolves a review
   finding, update the `REV-n` status **in both the summary table and the
   item's detail block**, with the commit/date.
3. **When adding:** a new epic is a heading in `build-backlog.md` (Epic IDs
   are registry-listed identifiers — see `docs/identifier-registry.md`); a new
   review tracker uses its own dated file with stable, namespaced item IDs,
   following `review-findings-2026-07-12.md` as the shape.
4. **Never delete history** — supersede. A wrong status gets corrected with a
   note, not silently rewritten; a dropped item is marked out of scope with
   the reason, so future readers don't re-litigate it.
5. **Keep the three sources pointing at each other, not duplicating:** the
   roadmap links the review tracker rather than restating it; bundles roll up
   epics; detailed rows stay the source of truth.
6. Gate with `npm run knowledge:check` (reachability + graph) and resolve any
   currency advisory naming a companion that should have moved.
