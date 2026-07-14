# Positioning & Messaging

## Category

**Compliance-first lending operating system for India.** Not a loan management
system with compliance bolted on; a compliance control plane that happens to
originate and service loans. This framing is the wedge — it is what no incumbent
LOS/LMS leads with.

## Positioning statement

> For RBI-regulated lenders (banks, SFBs, NBFCs, HFCs, co-operative banks,
> AI-FIs) and the LSPs that serve them, who must prove digital-lending compliance
> on demand, **LoanOS India** is a multi-tenant lending operating system that
> produces regulatory evidence while the loan runs — origination, servicing,
> workflow, and AI-model governance in one auditable system. Unlike stitched-together
> LOS + LMS + point compliance tools, LoanOS makes every KFS disclosure, consent,
> fund-flow rule, and model decision a machine-enforced control with a
> tamper-evident, byte-replayable audit trail.

## The problem we sell against

India lending platforms break at the handoffs (from `what-we-are-building.md`):

1. Origination captures data, but servicing cannot reconstruct **why** a loan
   was approved.
2. KFS and borrower disclosures become documents, not enforced controls.
3. LSPs/vendors are integrated, but the regulated entity still carries the
   liability with no scoped guardrails.
4. AI scorecards influence credit, but model inventory, validation, and
   kill-switch controls sit in separate governance paperwork.
5. Compliance evidence is assembled after the fact — slow, risky, incomplete —
   right when a regulator, auditor, or board is asking for it.

Cost of the problem to the buyer: RBI supervisory findings, penalties, DLA
delisting risk, remediation programmes, delayed product launches, and personal
accountability for the CCO and board.

## The one-sentence pitch (per audience)

- **CCO / Compliance head:** "Evidence for every KFS, consent, fund-flow, DLA/LSP,
  and model decision — exportable as a tamper-evident pack, without your team
  reconstructing history by hand."
- **CRO / Credit head:** "A per-tenant, fail-closed decision engine that runs your
  credit policy as signed, versioned, replayable rules — and lets you kill any
  model instantly."
- **CTO / Head of Engineering:** "Multi-tenant SaaS with hard tenant isolation
  proven by a regression suite, Postgres RLS, exact-decimal money math, and an
  append-only audit hash chain. India-hosted."
- **CEO / Business head:** "Launch compliant India lending products faster,
  because compliance is enforced in the flow instead of slowing every release."
- **LSP / fintech partner:** "Scoped, auditable workflows that keep you inside the
  regulated entity's boundary — no unauthorised fund control, clean handoffs."

## Value pillars (with proof)

Each pillar maps to built capabilities. Full traceability in
[`claims-and-backlog-sync.md`](claims-and-backlog-sync.md).

### 1. Compliance produced in-flow, not after the fact
KFS-before-contract gate; consent + DPDP notice ledger; direct fund-flow
enforcement (no LSP pass-through); India-only/INR/data-residency boundaries;
Aadhaar prohibited-storage checks. Every control is executable, not a checklist.

### 2. Evidence by design
Per-tenant SHA-256 hash-chained audit spine; integrity-attested evidence export
pack; uniform actor/dataClass provenance on every event; reproducible tenant
portability export. "Show me the evidence" becomes an export, not a project.

### 3. A decision engine you can trust and replay
Per-tenant pure-Rust engine; content-hashed, four-eyes-approved, ed25519-signed
policy bundles; exact decimal arithmetic; fail-closed (`refer`/`deny`) on any
error; byte-identical replay from the audit record.

### 4. AI under human command
Model inventory + governed lifecycle with independent-validation gate;
model-scoped and global kill switch; drift monitoring that auto-trips the switch;
generative-model adversarial/hallucination gate; customer-facing AI disclosure +
human handoff; post-incident review required to clear a switch.

### 5. Multi-tenant SaaS built for RE outsourcing obligations
Hard tenant isolation proven by a cross-tenant regression suite; Postgres RLS
option; disclosed sub-processor register; 6-hour CERT-In/RBI incident clocks;
audited break-glass; tenant onboarding wizard, export, and evidenced offboarding.

## Messaging do / don't

**Do**
- Lead with compliance evidence and auditability — that is the differentiator.
- Use exact, RBI-anchored language: "RBI Digital Lending Directions, 2025",
  "KFS", "DLG 5% cap", "FPC contact-hours", "V-CIP", "CERSAI", "FIU-IND".
- Attach a proof point (a control, an endpoint, an ADR/INV ID) to every claim.
- Say "first slice" / "roadmap" where the capability is partial. Buyers in this
  space punish overclaiming.

**Don't**
- Do not claim "production compliant" or "RBI certified." We claim *built to
  enforce* the controls; certification/production readiness requires the buyer's
  own legal, security, and integration review (see Non-Goals in
  `what-we-are-building.md`).
- Do not position as a global/multi-country platform. India-only is a feature.
- Do not promise live regulator/bureau integrations as done where they are
  canonical-slice/mock (CIC, FINnet, CKYC, live payment rails). Sell the governed
  boundary + roadmap.
- Do not treat AI governance as optional or as a nice-to-have add-on.

## Proof-point glossary (for quick recall)

| Term | What to say it proves |
| --- | --- |
| KFS gate | No contract can execute before Key Facts Statement is disclosed and accepted |
| Fund-flow guard | Disbursement/repayment cannot route through an LSP pass-through account |
| Audit hash chain | Every state change is tamper-evident and independently verifiable |
| Kill switch | Any model can be blocked instantly; runtime use stops fail-closed |
| Tenant isolation suite | Cross-tenant read/write is impossible by construction, proven in CI |
| Byte-replay | Any decision reproduces identically from its audit record |
