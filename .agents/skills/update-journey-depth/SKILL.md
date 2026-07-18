---
name: update-journey-depth
description: Use when advancing or correcting the recorded platform depth of any of the 21 product journeys — docs/product/product-journey-platform-depth.json. The depth:check gate blocks drift, so the record only moves together with real evidence.
---

# Update the journey platform-depth record

`docs/product/product-journey-platform-depth.json` is the machine-checked
depth record for all 21 journeys, validated by `npm run depth:check`
(`scripts/audit-product-journey-depth.mjs`) against the canonical catalogues
in `@loanos/core` and against evidence files on disk. The gate runs in
`knowledge:check`, the pre-commit hook and CI — so this record cannot be
edited casually, and that is the point.

## Workflow

1. **Land the reality first.** Code, tests and architecture docs merge before
   the depth record moves — the JSON describes what exists, never what is
   intended.
2. **Advance the journey's entry truthfully:** `maturity`, `apiDepth`,
   `experienceDepth`, `testDepth` and `kernelEvidence` (every ref must resolve
   to a real repository file). The validator pins truthful-label rules — for
   example the current `composed_lifecycle_partial` API/test depth — and
   rejects a journey that drops an open production boundary (`JD-05`/`JD-06`
   must remain in `gaps` until those batches genuinely close).
3. **Closing a batch (`JD-n`) is one atomic change:** add the batch's evidence
   list to `completedBatchEvidence` (minimum evidence counts are enforced),
   remove the batch from every journey's `gaps`, and update the validator's
   own assertions where the batch closure changes what "truthful" means — the
   script is the machine form of the audit and must evolve with it,
   consciously and in the same commit.
4. **Move the companion narrative:** `product-journey-platform-depth-audit.md`
   and the journey support matrix must tell the same story as the JSON.
5. **Gate:**
   ```bash
   npm run depth:check
   npm run knowledge:check
   ```
6. If the depth change alters what may be claimed externally, sweep the claim
   register (`update-gtm-claim`); reflect epic/bundle movement via
   `groom-backlog`.
