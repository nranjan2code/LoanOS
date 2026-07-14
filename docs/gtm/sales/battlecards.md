# Battlecards

Head-to-head cards against the buyer's real alternatives. Structure: **when we
win, when we lose, killer questions, landmines.** Vendor-specific facts must be
verified and dated before use — do not fabricate. See
[`../strategy/competitive-landscape.md`](../strategy/competitive-landscape.md).

## Card 1 — vs. "Best-of-breed point tools" (separate LOS + LMS + GRC)

**When we win**
- Buyer has been burned by audit-evidence assembly across systems.
- Model governance is disconnected from the decision that used the model.
- Nobody can reconstruct end-to-end *why* a loan was approved.

**When we lose**
- Buyer only needs one plane (e.g., pure LMS) and price is the sole driver.
- Deep incumbent contracts with years left and no compliance trigger.

**Killer questions**
- "When your audit asked why a loan was approved, how many systems did you touch?"
- "Where does your model inventory live relative to the decision path?"

**Our proof:** one hash chain (C-05), one replayable decision (C-17), one export
(C-06). **Landmine:** don't disparage tools they rely on operationally — attack
the *seams*, not the tools.

## Card 2 — vs. "Build in-house / extend the CBS"

**When we win**
- Engineering is revenue-constrained; compliance work competes with features.
- Leadership underestimates the *ongoing* cost of RBI alignment.
- They want provable isolation and auditability, not just function.

**When we lose**
- Very large bank with a funded multi-year platform program and internal mandate.
- "Not invented here" culture with no compliance urgency.

**Killer questions**
- "Who owns keeping fail-closed decisioning and the kill switch aligned to every
  RBI change — and what's that costing in engineering time?"
- "Can you prove tenant isolation to an auditor today, or would you build that?"

**Our proof:** isolation in CI (C-07), exact-decimal math (C-16), signed policy
bundles (C-15), kill switch (C-09). **Landmine:** respect the CBS boundary; we are
not core banking.

## Card 3 — vs. "Do nothing / manual compliance"

**When we win**
- A recent supervisory finding, DLA obligation, or model-risk mandate.
- Evidence assembly is personnel-dependent and slow.

**When we lose**
- No trigger, no sponsor, "it's passed before" complacency. (Nurture, don't force.)

**Killer questions**
- "What would an incomplete evidence pack cost you at the next inspection?"
- "How many FTEs touch evidence assembly per quarter?"

**Our proof:** evidence-as-export (C-06), in-flow controls (C-01/02/03/04).
**Landmine:** don't fear-monger; quantify calmly.

## Card 4 — vs. "Fintech LaaS / embedded-finance platform"

**When we win**
- The RE (not the fintech) carries regulatory accountability and needs the
  boundary enforced in software.
- Fund-flow discipline and DLA/LSP governance matter.

**When we lose**
- Buyer prioritises speed-to-embed over provable RE accountability.

**Killer questions**
- "Where is the RE↔LSP boundary enforced in software, and who carries the
  liability when an LSP touches a borrower?"
- "How is disbursement prevented from routing through a pass-through account?"

**Our proof:** fund-flow guard (C-03), DLA registry + CIMS export (C-44), scoped
LSP workflows, DLG cap (C-22), co-lending reconciliation (C-23).

## Universal "trap-setting" questions (favour LoanOS in any comparison)

1. Reconstruct a 6-month-old decision byte-for-byte — can the alternative?
2. Stop a drifting model instantly, fail-closed — can the alternative?
3. Export a tamper-evident evidence pack for one product line — export or project?
4. Prove cross-tenant isolation to an auditor — asserted or proven in CI?
5. Leave with a re-loadable export of records + audit + documents — feature or
   fight?

## Card maintenance

Vendor cells marked `verify` in `competitive-landscape.md` must be filled only from
dated, verified research (an AI agent may draft; a human confirms). Re-review cards
each quarter and after any major competitor announcement.
