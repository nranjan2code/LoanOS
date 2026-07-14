# Competitive Landscape

We compete less against a single named product and more against **three default
alternatives** the buyer already has in mind. Win the frame, then the vendor
comparison follows.

## The three real competitors

### 1. "Stitch it together" — best-of-breed point tools
A separate LOS, a separate LMS, a separate compliance/GRC tool, a separate
model-risk spreadsheet, glued by integration and manual reconciliation.

- **Their pitch:** flexibility, pick the best of each.
- **Where they lose:** the handoffs. Evidence lives in four systems; nobody can
  reconstruct *why* a loan was approved end-to-end; audit becomes a project;
  model governance is disconnected from the decision that used the model.
- **Our line:** "Best-of-breed is where the audit trail goes to die. One system,
  one hash chain, one replayable decision."

### 2. "Build it in-house" — the platform/core team
Large banks especially believe they can extend the CBS or build on internal
platforms.

- **Their pitch:** control, no vendor, fits our stack.
- **Where they lose:** compliance is a moving regulatory target (DLD 2025, model-
  risk drafts, DPDP, CERT-In). Building fail-closed decisioning, tenant isolation,
  exact-decimal math, signed policy bundles, and an AI kill switch is a multi-year
  program that competes with revenue features — and it is never "done."
- **Our line:** "You can build a lending system. Building a *provable* one, and
  keeping it aligned to every RBI change, is a standing tax you can outsource."

### 3. "Do nothing / current process" — manual compliance
Spreadsheets, PDFs, after-the-fact evidence assembly.

- **Their pitch:** it has passed inspections before.
- **Where they lose:** it is slow, personnel-dependent, and one supervisory
  finding or DLA obligation away from a remediation program. Cost is hidden until
  it is not.
- **Our line:** "Manual compliance works until the day it is examined. We make the
  evidence a by-product of the flow."

## Category vendors (adapt as market intel is gathered)

> Do not fabricate competitor claims. This table is a **frame**, not a datasheet.
> Fill specific vendor facts only from verified, dated research. Where a cell is
> unknown, leave it as `verify` — an AI agent or rep must confirm before using it
> in a battlecard.

| Vendor type | Typical strength | Typical gap vs. LoanOS | Status |
| --- | --- | --- | --- |
| Global LOS/LMS suites | Breadth, scale, references | India-regulatory depth, in-flow evidence, AI kill switch, data residency | verify per-vendor |
| India LOS specialists | Local origination features | Unified LMS+compliance+model governance, byte-replay, tenant-isolation proof | verify per-vendor |
| GRC / model-risk tools | Governance workflows | Not in the lending decision path; governance is disconnected from execution | verify per-vendor |
| Fintech LaaS platforms | Speed, embedded finance | RE-accountability boundary, fund-flow discipline, auditability depth | verify per-vendor |

Detailed head-to-head cards live in [`../sales/battlecards.md`](../sales/battlecards.md).

## Our defensible differentiators (hard to copy)

1. **Compliance-as-code, not compliance-as-content.** Controls are executable
   gates, not documents.
2. **Per-tenant, fail-closed, byte-replayable decision engine** with signed policy
   bundles — an architecture, not a feature toggle.
3. **AI kill switch wired into the runtime decision path**, not a governance
   binder — with drift auto-trip and post-incident-review-to-clear.
4. **Evidence as an export**, backed by a tamper-evident per-tenant hash chain.
5. **India-only depth** as a deliberate constraint: INR, residency, V-CIP,
   Aadhaar-prohibition, CERSAI, FIU-IND, DLG, co-lending, AA — modelled, not
   generic.

## Traps to set (discovery questions that favour us)

- "When your last audit asked *why* a specific loan was approved, how long did it
  take to assemble the answer across your systems?"
- "If a model started drifting on a Friday, what stops it from being used on
  Saturday — and who has to approve turning it back on?"
- "Can you export a tamper-evident evidence pack for a single tenant/product line
  today, or is that a data-pull project?"
- "Who carries the liability when your LSP touches a borrower — and where is that
  boundary enforced in software?"

## Landmines to avoid (where we are not yet strong — sell honestly)

- Live certified integrations (CIC bureaus, FINnet, CKYC, live payment rails) are
  governed-slice/mock today. Position as "governed boundary + roadmap," never as
  "done." See [`claims-and-backlog-sync.md`](claims-and-backlog-sync.md).
- SOC 2 / ISO 27001 are roadmap, not certified. Share the roadmap, not a badge.
- We are not a core banking system. Respect the CBS boundary in the pitch.
