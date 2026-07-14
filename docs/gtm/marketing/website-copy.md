# Website Copy

Draft copy for the primary pages. Every factual claim is a `Built` claim unless
marked. Keep the compliance-led frame; no "RBI certified" language.

## Homepage

**Hero H1:** Compliance you can prove, produced while the loan runs.

**Hero subhead:** LoanOS India is the India-only lending operating system for
RBI-regulated lenders. Origination, servicing, workflow, and AI-model governance
in one auditable platform — where every KFS disclosure, consent, fund-flow rule,
and model decision is an enforced control, not a document.

**Primary CTA:** See an evidence pack exported live
**Secondary CTA:** Read the compliance approach

**Three-up pillar band:**
1. **Evidence in-flow** — Audit becomes an export, not a fire drill. KFS, consent,
   and fund-flow are enforced gates; every state change is sealed into a
   tamper-evident audit chain.
2. **Decisions you can replay** — A per-tenant, fail-closed decision engine runs
   your credit policy as signed, versioned rules — replayable byte-for-byte.
3. **AI under human command** — A kill switch wired into the runtime decision
   path. Drift trips it automatically; clearing it needs a post-incident review.

**Trust band:** India-hosted · Hard tenant isolation proven in CI · Aadhaar
artifacts never stored · Re-loadable exit export · Disclosed sub-processor register.

## Product page — "The platform"

**Intro:** Four planes, one system, one audit trail.

- **LOS — Origination:** borrower onboarding, consent/DPDP ledger, KYC with V-CIP
  India-storage, eligibility via the decision engine, KFS-before-contract, sanction
  and disbursement readiness with a direct fund-flow guard.
- **LMS — Servicing:** loan ledger reconstructable from immutable events,
  amortising/bullet/moratorium/step-up + revolving/OD structures, statements,
  prepayment/foreclosure, FPC-compliant collections, empanelled-agent recovery,
  automatic SMA/NPA classification.
- **LWS — Workflow:** maker-checker, exception queues with SLA clocks, grievance
  workflow with the 30-day RBI clock, fraud natural-justice gate, committee packs.
- **Compliance & AI OS:** regulatory control catalog, product-policy registry,
  DLA/LSP registries, model inventory + kill switch, evidence export.

## Compliance page — "How we handle compliance"

**Lead:** We don't claim certification — that's your legal, security, and
integration review to run. We claim the controls are enforced in software, and we
show you exactly what's built, what's first-slice, and what's on the roadmap.

Sections: In-flow controls (India-only, KFS gate, fund-flow, Aadhaar-prohibition,
data residency) · Evidence by design (hash chain, export, byte-replay) · AI
governance (inventory, kill switch, drift, validation) · Vendor posture
(sub-processor register, 6-hour incident clocks, break-glass, exit export).

**Honesty note (keep visible):** Live certified integrations (credit bureaus,
FINnet, CKYC, live payment rails) and SOC 2 / ISO 27001 are on our roadmap;
governed submission boundaries exist today.

## Security / trust page

For InfoSec: multi-tenant isolation proven by a cross-tenant regression suite;
optional Postgres Row-Level Security; per-tenant encryption at rest; append-only
audit hash chain; audited, time-boxed break-glass; reproducible tenant export;
evidenced offboarding. Dedicated data plane available.

## Segment landing pages (one per RE type)

Reuse the segment emphasis matrix in `../strategy/icp-and-personas.md`. Each: a
segment-specific H1 pain, the lead pillar, 3 proof points, and one CTA. Example
(NBFC): "Distribute through LSPs without carrying invisible liability — DLG caps,
co-lending reconciliation, and a fund-flow boundary enforced in software."

## Microcopy rules

- CTAs are specific and evidence-led ("See an evidence pack exported"), not
  generic ("Request a demo").
- No claim ships without a proof point behind it.
- Run `gtm-backlog-sync.mjs` before publishing any page.
