---
name: update-gtm-claim
description: Use when adding or changing an externally-visible capability claim, or when a capability's maturity changes what Sales/Marketing may assert. Keeps the claims↔backlog matrix, public site and knowledge graph honest.
---

# Update a GTM claim safely

`docs/gtm/strategy/claims-and-backlog-sync.md` is the contract between GTM and
Product: every externally-facing claim lives there with a status and evidence.
The trap is drift in either direction — marketing asserting more than the
product does, or a shipped capability still sold as "roadmap". Claim IDs
(`C-NN`) are knowledge-graph nodes; their evidence citations are checked.

## Workflow

1. Edit the claim matrix in `docs/gtm/strategy/claims-and-backlog-sync.md`.
   A row is `| C-NN | claim | Status | Evidence |` where `Status` is exactly
   `Built | Partial | Roadmap` and `Evidence` is non-empty and cites a source
   doc, capability ID or endpoint that exists in the repo.
2. Apply the status semantics honestly:
   - `Built` — may be sold as present-tense capability. Requires executable
     evidence (test, endpoint, control), not intent.
   - `Partial` — sold only as "first slice / governed boundary".
   - `Roadmap` — sold as future direction only.
   Never upgrade a claim's status ahead of the capability catalogue's maturity
   for the same surface (`add-capability` skill governs that side).
3. If the claim appears on the public site, update the page content too
   (`docs/gtm/marketing/public-site-operations.md` governs that workflow).
4. Gate:
   ```bash
   npm run web:content:check   # claims discipline + public-site integrity
   npm run graph:check         # C-NN evidence citations resolve
   ```
5. Commit citing the claim ID(s).

## Notes

- The claims gate fails on a malformed row, an invalid status, an empty
  evidence cell, or a referenced source doc that does not exist.
- Banned-phrase warnings from `gtm-backlog-sync.mjs` are real review input —
  resolve them, do not silence them.
- When a journey or capability maturity changes, sweep the matrix for claims
  whose status that change affects; the currency advisory nudges this.
