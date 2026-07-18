---
name: add-capability
description: Use when adding a new platform capability or changing a capability's maturity/status in the LoanOS catalogue. Keeps the capability catalogue, evidence trace, dashboard, and CI evidence floors consistent.
---

# Add or change a capability

Capabilities are tracked as a graph: the catalogue is the source of truth, the
evidence trace carries curated ownership/evidence, and the dashboard is a derived
artifact. All three must stay consistent, and CI enforces evidence floors that
may only ratchet upward. See `docs/identifier-registry.md`.

## Workflow

1. Edit the catalogue: `docs/product/complete-system-capability-catalog.md`. A
   capability ID is `PREFIX-NNN` (existing prefixes are listed in the identifier
   registry). Use the next free number in the relevant prefix. Set the maturity
   (`Implemented` / `Partial` / etc.) honestly — conservative by default.
2. Re-sync the derived registers:
   ```bash
   npm run trace:sync     # adds/updates the trace entry, preserving curated fields
   npm run dashboard      # rebuilds dashboard-data.json + dashboard.html
   ```
3. Fill in the curated trace fields for the new/changed entry in
   `docs/product/capability-trace.json`: `owner`, `evidence` (each ref must
   resolve to a real repository file or a well-formed endpoint), `acceptance`,
   `dependencies` (use real capability IDs — ID-shaped dependencies are graph
   edges and are checked), `notes`, `lastReviewed`.
4. To mark a capability `Implemented`, the evidence policy requires **both**
   executable test evidence and code/endpoint evidence. Add the test first.
5. Validate:
   ```bash
   npm run trace:validate   # evidence integrity + floors
   npm run graph:check      # dependency IDs resolve
   npm run dashboard:check  # derived-artifact integrity
   ```
6. Update companion docs the change implies (journey matrix, roadmap/backlog) —
   `npm run currency:check -- --staged` will name what looks stale.

## Notes

- Do not lower an evidence floor in `capability-evidence-policy.json`; floors
  only increase.
- A dangling ID-shaped dependency shows up as a `graph:check` warning. Point it
  at a real capability ID or drop it.
