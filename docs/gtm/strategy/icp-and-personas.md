# ICP & Personas

Horizontal across RBI-regulated entity (RE) types. Use the segment table to
adapt emphasis; use the persona cards to adapt language.

## Ideal Customer Profile (firmographic)

| Attribute | Fit |
| --- | --- |
| Entity type | RBI-regulated: commercial bank, small finance bank, payments bank (in scope), co-operative bank, NBFC, HFC, All-India Financial Institution |
| Geography | India lending only (INR, India-resident borrowers, India-hosted systems) |
| Lending motion | Digital / assisted-digital lending, especially with LSP/DLA distribution |
| Trigger | New RBI Digital Lending Directions 2025 alignment, DLA/CIMS obligations, model-risk readiness, a supervisory finding, a new product launch, or a core/LOS replacement cycle |
| Anti-fit | Non-India lending; entities with no regulated-entity accountability; pure BNPL merchants outside RE boundary; anyone wanting to bypass fund-flow rules |

## Segment emphasis matrix

| Segment | Sharpest pain | Lead pillar | Watch-outs |
| --- | --- | --- | --- |
| **Mid/large NBFC** | DLA/LSP liability, DLG, fast product velocity vs. compliance drag | In-flow compliance + decision engine | Price sensitivity; wants speed-to-launch proof |
| **Small finance bank** | Board/RBI scrutiny, model risk, grievance SLAs | Evidence by design + AI governance | Procurement rigor; needs SOC2/ISO roadmap |
| **HFC** | CERSAI/SARFAESI security-interest lifecycle, secured-loan gates | LMS + CERSAI + evidence | Longer secured-loan workflows |
| **Co-operative bank** | Limited compliance staff, manual evidence | Evidence-as-export, low-ops | Budget; needs hand-holding, managed onboarding |
| **Commercial bank** | Tenant isolation, audit, scale, vendor governance | Multi-tenant SaaS + RE-outsourcing posture | Long cycle; security review heavy; CBS boundary |
| **LSP / fintech distributor** | Staying inside RE boundary, no fund control, clean audit handoffs | Scoped workflows + DLA registry | They influence, RE signs; multi-thread required |

## Personas

### Chief Compliance Officer (CCO) — economic buyer / champion
- **Cares about:** provable compliance, audit readiness, DLA/LSP governance,
  grievance SLAs, data residency, personal accountability to the board/RBI.
- **Success looks like:** producing an evidence pack on demand; zero unexplained
  decisions; passing supervisory review without a fire drill.
- **Hook:** "Every KFS, consent, fund-flow, and model decision leaves a
  tamper-evident trail you can export in minutes."
- **Objection reflex:** "Is this actually RBI-aligned or marketing?" → show the
  regulatory register + claims-sync matrix.

### Chief Risk Officer / Head of Credit — technical buyer
- **Cares about:** policy fidelity, underwriting control, model governance,
  portfolio risk, kill-switch readiness.
- **Success looks like:** credit policy runs as versioned, replayable rules;
  refer/deny bands route to human review; any model killable instantly.
- **Hook:** "Your credit policy becomes signed, versioned data — replayable
  byte-for-byte — with a kill switch over every model."

### CTO / Head of Engineering — technical buyer / gatekeeper
- **Cares about:** tenant isolation, data residency, security posture, integration
  surface, exit/portability, not owning a compliance rebuild.
- **Success looks like:** proven isolation, clean API, India hosting, Postgres RLS,
  no lock-in.
- **Hook:** "Hard multi-tenant isolation proven in CI, exact-decimal money math,
  append-only audit chain, and a documented, re-loadable exit export."

### CEO / Business Head — economic buyer
- **Cares about:** speed to launch compliant products, cost of compliance,
  regulatory risk to the franchise.
- **Success looks like:** ship new India lending products without compliance
  becoming the bottleneck.
- **Hook:** "Compliance enforced in the flow means faster, safer product launches."

### Head of Collections / Operations — user buyer
- **Cares about:** FPC-compliant collections, recovery-agent governance,
  restructuring, NPA classification, grievance workflow.
- **Success looks like:** every recovery contact is noticed and within FPC hours;
  agents are empanelled; NPA/SMA classification is automatic.
- **Hook:** "Collections that enforce RBI Fair Practices contact-hours and
  empanelled-agent rules by construction."

### Internal Auditor / Board Risk Committee — influencer
- **Cares about:** immutable evidence, override trails, model use logs.
- **Hook:** "Immutable, hash-chained evidence for every decision, override,
  document, and model use."

## Buying committee & typical deal shape

- **Champion:** usually CCO or Head of Credit/Risk.
- **Economic buyer:** CEO/CFO for larger REs; CCO/CRO may hold budget in NBFCs.
- **Gatekeepers:** CTO (security/architecture), Procurement, InfoSec.
- **Influencers:** Internal Audit, Collections/Ops heads, LSP partners.
- **Multi-thread rule:** never single-thread on the champion; secure CTO + an
  economic buyer early. Security review is the most common stall — engage InfoSec
  in the first third of the cycle with the tenancy/vendor-posture pack.

## Qualifying signals (green / red)

**Green:** new product launch on a compressed timeline; recent RBI inspection or
DLA/CIMS filing pressure; model-risk board mandate; LSP-heavy distribution;
core/LOS migration underway; a named CCO with budget authority.

**Red:** wants to store Aadhaar biometrics/OTP; wants LSP fund control; non-India
lending; "just need a cheap LMS"; no regulated-entity accountability; no
executive sponsor for compliance.
