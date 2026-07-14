# FAQ (Sales & Marketing)

Approved answers to recurring buyer questions. Answers assert only `Built` claims
as present capability; `Partial`/`Roadmap` are labelled. Keep answers honest and
short.

### What exactly is LoanOS India?
An India-only, multi-tenant SaaS lending operating system for RBI-regulated
entities. It unifies loan origination (LOS), loan management (LMS), loan workflow
(LWS), and a compliance/AI-governance control plane so regulatory evidence is
produced while the loan runs.

### Who is it for?
Commercial banks, small finance banks, payments banks (in scope), co-operative
banks, NBFCs, HFCs, and All-India Financial Institutions — and the LSPs that
distribute on their behalf, within the RE's accountability boundary.

### Is it RBI-certified / guaranteed compliant?
No — we don't make that claim, and we're wary of anyone who does. Certification
depends on your own legal, security, and integration review. What we provide is
controls *enforced in software* and a clear map of what's built, first-slice, and
roadmap.

### How is this different from our existing LOS/LMS?
Those originate and service. LoanOS makes compliance an enforced part of that flow
and produces the evidence as a by-product — one audit trail, byte-replayable
decisions, and an exportable evidence pack, rather than reconstructing "why" across
separate systems.

### Can you really stop an AI model instantly?
Yes. The kill switch is wired into the runtime decision path (not a governance
document). Model-dependent decisions degrade to manual review, drift auto-trips the
switch, and clearing it requires a recorded post-incident review.

### Are your regulatory integrations live?
Straight answer: CERSAI, FIU-IND/FINnet, eSign, and payment rails ship as governed
submission slices today (`Partial`); credit-bureau/CIC live integration and
certified live gateways are on the roadmap. The governance and evidence boundary
around them is built now.

### Are you SOC 2 / ISO 27001 certified?
Those are on our roadmap. Today we offer evidence-by-design and a full vendor-
posture: a disclosed sub-processor register, 6-hour CERT-In/RBI incident clocks,
audited break-glass, and a reproducible tenant export.

### How do you prove multi-tenant isolation?
A cross-tenant regression suite runs in CI proving tenant A cannot read or mutate
tenant B for every resource type; optional Postgres Row-Level Security and
per-tenant encryption sit beneath the application-layer isolation. A dedicated data
plane is available for REs that require it.

### What about data residency and Aadhaar?
India-hosted primary systems, INR only, India-resident borrowers. Aadhaar
biometric, OTP, and PID artefacts are never stored — the system rejects them by
construction. V-CIP recordings are India-stored.

### What happens if we want to leave?
Exit is a product feature. A reproducible, re-loadable portability export includes
records, the audit spine, and rendered documents; offboarding is evidenced with a
data-plane purge, key revocation, and a deletion attestation.

### How do we evaluate it safely?
A sandbox environment enforces synthetic-only borrowers with mock integration
overrides — your team can evaluate with zero production risk before any live data.

### How is it priced?
Annual platform fee by RE tier + module uplifts (AI Governance, Distribution,
Integrations) + usage on active loan accounts; dedicated data plane as an
Enterprise uplift. See `../strategy/pricing-and-packaging.md` (framework, not a
final rate card).

### How do you keep marketing claims accurate?
Every external claim maps to a built capability in
`../strategy/claims-and-backlog-sync.md`, and a script
(`../automation/gtm-backlog-sync.mjs`) checks assets before they ship.
