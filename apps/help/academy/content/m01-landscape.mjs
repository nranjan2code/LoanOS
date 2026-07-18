// Module 1 — Foundations: the Indian lending landscape.
export default {
  id: "m01-landscape",
  number: 1,
  title: "Foundations: the Indian lending landscape",
  tagline: "Who may lend, who watches them, and why every process in this course exists.",
  summary: "Before touching a screen, a BA must know the actors: the RBI, the regulated entities that carry accountability, the service providers that act for them, and the directions that bind them all. This module builds that map and shows how LoanOS turns each regulation into an executable control.",
  lessons: [
    {
      id: "regulated-entities",
      title: "Who may lend: regulated entities and the RBI perimeter",
      duration: "15 min",
      verified: "17 Jul 2026",
      objectives: [
        "Name the RE types the RBI supervises and what distinguishes them",
        "Explain why accountability for a loan never leaves the RE",
        "Locate the RE registry controls inside LoanOS"
      ],
      sections: [
        { heading: "Lending is a licensed activity", body: "In India, lending at scale is not a free market activity — it is a licensed one. The RBI authorises and supervises the institutions that may lend: commercial banks, small finance banks, payments banks (within their limited scope), co-operative banks, NBFCs (non-banking financial companies), HFCs (housing finance companies) and All-India Financial Institutions. Together these are the **regulated entities** — REs.\n\nEach licence type carries different powers and limits. A bank takes deposits and lends broadly; an NBFC lends from borrowed and own funds but cannot take demand deposits; an HFC specialises in housing. For a BA the practical point is: every loan in the system must belong to exactly one RE, and that RE's licence type determines which rules apply to it." },
        { heading: "Accountability is non-transferable", body: "The single most important idea in Indian lending regulation: **the RE remains accountable for everything done in its name**. It may outsource sourcing to a DSA, technology to a SaaS vendor, servicing to an LSP, recovery to an agency — but it cannot outsource responsibility. If a recovery agent harasses a borrower, the RBI holds the RE responsible. If a partner app hides charges, the RE answers for it.\n\nThis is why LoanOS is built tenant-first: a tenant is one contracting RE, and every borrower, loan, workflow and model action lives inside that RE's boundary with full attribution. Cross-tenant access is impossible by construction, because a data leak between two REs would be a reportable event for both." },
        { heading: "The RE profile as a control object", body: "LoanOS does not treat the RE as a configuration afterthought. The regulated-entity registry records the licence type, public disclosure details, grievance officer, board policy references and data-residency posture — and product policies, applications and loans inherit these facts by reference. An application for a lender with no grievance officer on record, or a licence type outside the platform's scope, fails closed before any credit work begins." }
      ],
      regulatory: [
        { id: "RBI-DL-2025", note: "Digital Lending Directions govern banks, co-operative banks, NBFCs including HFCs and AIFIs — the RE list this lesson describes." },
        { id: "RBI-OUTSOURCE", note: "Outsourcing never dilutes RE responsibility; certain core management and decision functions cannot be outsourced at all." }
      ],
      platform: [
        { type: "doc", ref: "docs/product/what-we-are-building.md", note: "Regulatory boundary: the platform serves lending by or on behalf of RBI-regulated entities only." },
        { type: "code", ref: "packages/core/src/compliance/compliance-controls.js", note: "RE registry validation: India residency, RE type, public disclosure, grievance officer, board policy." },
        { type: "doc", ref: "docs/decisions/0001-india-only-compliance-first.md", note: "ADR: India-only, compliance-first foundation." }
      ],
      terms: ["RE", "RBI", "Tenant", "Grievance officer"],
      related: ["m01-landscape/digital-lending-model", "m09-compliance/audit-evidence"],
      check: [
        { q: "An RE outsources collections to an agency. A borrower is mistreated. Who does the RBI hold accountable?", options: ["The agency, since it acted", "The RE — accountability is non-transferable", "Both equally, by contract", "Whoever the loan agreement names"], answer: 1, why: "Outsourcing directions are explicit: responsibility for outsourced activity stays with the regulated entity." },
        { q: "Why is a LoanOS tenant exactly one regulated entity?", options: ["Simpler billing", "Because accountability, data isolation and reporting all attach to the RE", "Performance isolation", "RBI mandates single-tenant software"], answer: 1, why: "The tenant boundary mirrors the accountability boundary: every record must be attributable to one RE, and isolation between REs is itself a compliance control." }
      ]
    },
    {
      id: "digital-lending-model",
      title: "The digital lending operating model: RE, LSP and DLA",
      duration: "18 min",
      verified: "17 Jul 2026",
      objectives: [
        "Describe the RE–LSP–DLA triangle created by the Digital Lending Directions",
        "Explain DLA reporting and why app inventories exist",
        "State the conduct rules that follow an LSP everywhere"
      ],
      sections: [
        { heading: "Three actors, one accountability line", body: "Modern Indian lending is rarely the RE alone. The Digital Lending Directions define the operating model:\n\n- The **RE** holds the licence, the credit risk and the accountability.\n- An **LSP** (Lending Service Provider) acts for the RE — sourcing, servicing, support, collections — under a contract and due diligence.\n- A **DLA** (Digital Lending App or website) is the borrower-facing surface, owned by the RE or by an LSP.\n\nEvery DLA an RE uses — its own and its LSPs' — must be reported to the RBI through CIMS, with public disclosures kept current. An unreported app through which loans flow is a direct violation." },
        { heading: "Conduct duties that never switch off", body: "The directions attach conduct rules to this triangle that a BA will meet repeatedly in this course:\n\n- Borrowers must know they are dealing with the RE: identity, charges and grievance paths are disclosed up front.\n- An LSP presenting offers from multiple lenders must present them **neutrally** — complete, comparable, no dark patterns.\n- Fees to the LSP are paid by the RE, not smuggled into borrower charges.\n- Funds never sit in or pass through LSP-controlled accounts (module 4 covers the fund-flow rule in depth).\n- Data collected by a DLA is need-based, consented and India-resident." },
        { heading: "How LoanOS holds the triangle", body: "LoanOS keeps three registries the RE governs: the LSP registry (agreement, enhanced due diligence, periodic review, borrower-facing disclosures, RE-paid fee controls), the DLA registry (ownership, grievance contact, RE website linkage, CIMS-ready export rows, CCO attestation) and the channel-conduct evidence trail that attributes every partner action. Channel users can source and service within their scope, but they cannot approve credit or promise outcomes — authority stays with the RE's staff and policies." }
      ],
      regulatory: [
        { id: "RBI-DL-2025", note: "Defines the RE/LSP/DLA model, disclosure, neutrality and conduct duties." },
        { id: "RBI-DLA-CIMS", note: "Own and LSP DLAs must be reported on RBI CIMS with public disclosures." },
        { id: "CCPA-DARK-PATTERNS", note: "Multi-lender offer views must avoid deceptive patterns; ranking must be explained." }
      ],
      platform: [
        { type: "capability", ref: "PAR-001", note: "LSP agreement, role, due diligence, review, data and fee controls." },
        { type: "capability", ref: "RPT-002", note: "DLA CIMS export and CCO certification." },
        { type: "capability", ref: "CHN-010", note: "Channel conduct, consent and disclosure monitoring." },
        { type: "capability", ref: "OFR-003", note: "Objective ranking disclosure and dark-pattern prevention in offer views." }
      ],
      terms: ["LSP", "DLA", "CIMS", "DSA"],
      related: ["m08-partners/lsp-dla-governance", "m04-kfs-sanction/disbursement-fund-flow"],
      check: [
        { q: "Which DLAs must an RE report to RBI CIMS?", options: ["Only apps the RE owns", "Only apps that disburse loans", "Its own DLAs and those of its LSPs", "Only Android apps"], answer: 2, why: "The reporting duty covers every digital lending surface used in the RE's lending — RE-owned and LSP-owned alike." },
        { q: "An LSP marketplace shows offers from four REs but hides one lender's higher processing fee behind a tap. What rule does this break?", options: ["Fund-flow", "Offer neutrality / dark-pattern prevention", "KYC", "Data residency"], answer: 1, why: "Multi-lender presentation must be complete and comparable; obscuring cost information is a dark pattern the directions prohibit." }
      ]
    },
    {
      id: "regulatory-map",
      title: "The regulatory map every BA must know",
      duration: "20 min",
      verified: "17 Jul 2026",
      objectives: [
        "Recognise the major directions and acts that shape each lifecycle stage",
        "Use the India regulatory register as the working index",
        "Know which regulator owns which obligation"
      ],
      sections: [
        { heading: "One journey, many rulebooks", body: "No single document regulates a loan. A BA should be able to place the big ones on the lifecycle:\n\n- **Digital Lending Directions, 2025** — conduct of digital lending end to end: LSP/DLA model, disclosures, cooling-off, fund flow.\n- **KFS directions, 2024** — the standardised Key Facts Statement before contract execution.\n- **KYC Master Direction, 2016 (as amended)** — customer identification, due diligence, V-CIP, AML/CFT and FIU-IND reporting.\n- **Fair lending / penal charges** — penal charges as reasonable, disclosed charges; never capitalised, never penal interest.\n- **Credit Information Reporting Directions, 2025** — fortnightly UCRF reporting to the CICs, correction clocks and compensation.\n- **IRACP norms** — income recognition, asset classification (SMA/NPA) and provisioning.\n- **DPDP Act, 2023 and Rules, 2025** — personal-data consent, rights and breach duties (MeitY, not RBI).\n- **IT and outsourcing directions, CERT-In directions** — governance of the technology and vendors behind all of it." },
        { heading: "The register is the working index", body: "LoanOS maintains this map as a living artefact: the **India regulatory register**. Every control family has a stable ID (for example RBI-KFS-2024, RBI-LSP-DLG), a why-it-matters summary and an implementation anchor pointing at the code or workflow that realises it. This course cites those IDs throughout — when a lesson says a rule exists, the register row is where you verify the source, the date baseline and the platform anchor.\n\nTreat the register the way engineers treat the architecture docs: if a lesson and the register disagree, the register wins, and the lesson must be fixed." },
        { heading: "Who regulates what", body: "A quick ownership table keeps escalations sane:\n\n- **RBI** — everything prudential and conduct-related for REs: lending directions, KFS, KYC, IRACP, outsourcing, IT governance, fraud, credit reporting.\n- **MeitY / Data Protection Board** — DPDP: personal-data consent, principal rights, breach notification.\n- **CERT-In** — cyber-incident reporting (6-hour clock) and log retention for Indian service providers, including LoanOS itself.\n- **UIDAI** — Aadhaar authentication rules and the prohibition on storing biometrics/OTP/PID.\n- **CERSAI** — central KYC records registry and security-interest registration.\n- **FIU-IND** — suspicious/cash transaction reporting under PMLA." }
      ],
      regulatory: [
        { id: "RBI-DL-2025", note: "The spine of digital lending conduct." },
        { id: "DPDP-2023", note: "Personal-data duties sit with MeitY's regime, parallel to RBI's." },
        { id: "CERT-IN-2022", note: "Cyber-incident and log-retention duties apply to the platform provider directly." }
      ],
      platform: [
        { type: "doc", ref: "docs/compliance/india-regulatory-register.md", note: "The control-family register this course cites — IDs, sources and implementation anchors." },
        { type: "doc", ref: "docs/compliance/platform-admission-control-map.md", note: "How control families gate platform admission." }
      ],
      terms: ["DLD 2025", "KFS", "IRACP", "DPDP", "CERT-In", "UCRF"],
      related: ["m01-landscape/regulation-as-controls", "m09-compliance/data-protection"],
      check: [
        { q: "A borrower demands erasure of their data mid-loan. Which regime governs the request itself?", options: ["RBI Digital Lending Directions", "DPDP Act and Rules", "IRACP norms", "CERT-In directions"], answer: 1, why: "Data-principal rights come from the DPDP regime — though statutory retention duties under RBI/PMLA rules can lawfully delay actual erasure." },
        { q: "Where in this repository do you verify that a regulatory claim in this course is current?", options: ["The marketing site", "docs/compliance/india-regulatory-register.md", "Any RBI press release", "The test suite"], answer: 1, why: "The register is the maintained control map with source URLs and a research baseline date; lessons cite its family IDs." }
      ]
    },
    {
      id: "regulation-as-controls",
      title: "From circular to control: how LoanOS encodes regulation",
      duration: "15 min",
      verified: "17 Jul 2026",
      objectives: [
        "Explain 'compliance evidence produced while the business flow runs'",
        "Distinguish fail-closed controls from after-the-fact checklists",
        "Read a capability status honestly (Implemented / Partial / Mock)"
      ],
      sections: [
        { heading: "The core design bet", body: "Most lending stacks bolt compliance on afterwards: the business flow runs, and a reporting team reconstructs evidence when the auditor calls. LoanOS inverts this — **compliance evidence is produced while the business flow runs**. The KFS is not a PDF someone remembered to attach; it is a data object that gates sanction. Consent is not a checkbox log; it is a ledger the application preflight reads. A missing control does not produce a warning; it produces a blocked transition.\n\nFor a BA this changes how you write requirements: a regulatory obligation is done only when the flow cannot proceed without producing its evidence." },
        { heading: "Fail closed, by default", body: "The platform's non-negotiable rule is **fail closed**: when a check cannot be evaluated — service down, evidence missing, policy expired — the outcome is the restrictive one (refer or deny), never a permissive default. An unavailable KYC provider does not mean 'skip KYC'; an unreachable decision engine does not mean 'approve'.\n\nThis matters to BAs because edge cases are where compliance usually leaks. When you specify a flow, always specify the failure path — LoanOS's answer is predetermined: land on the safe side and route to a human queue." },
        { heading: "Honest maturity language", body: "The capability catalogue classifies every capability as Implemented, Partial, Mock or Planned, and the journey support matrix assigns evidence tiers per lending journey. The GTM glossary even bans phrases like 'RBI certified' and 'guaranteed compliant'. This course inherits that discipline: a lesson explaining a process cites capability IDs, and the catalogue row — not the lesson — tells you how much is real today. When you brief stakeholders, quote the status, never the aspiration." }
      ],
      regulatory: [
        { id: "RBI-IT-GRC", note: "IT governance directions demand controls, audit trails and straight-through-processing checks — the regulatory basis for controls-as-code." },
        { id: "RBI-KFS-2024", note: "Example of a rule that became a gate: KFS validation blocks decisioning and sanction." }
      ],
      platform: [
        { type: "doc", ref: "docs/product/complete-system-capability-catalog.md", note: "Capability register with Implemented/Partial/Mock status — the source of maturity truth." },
        { type: "doc", ref: "docs/product/product-journey-support-matrix.md", note: "Evidence tier for each lending journey; a guide existing is not production readiness." },
        { type: "code", ref: "packages/core/src/compliance/compliance-controls.js", note: "The executable control catalogue: application preflight checks that fail closed." }
      ],
      terms: ["KFS", "Decision engine", "Compliance OS"],
      related: ["m03-underwriting/policy-as-data", "m10-capstone/ba-toolkit"],
      check: [
        { q: "The KYC verification service is unreachable during an application. What does a fail-closed design do?", options: ["Approve and verify later", "Proceed with a warning banner", "Block the transition and route to the restrictive path", "Retry silently forever"], answer: 2, why: "Error paths land on the restrictive outcome — the application waits or refers; it never advances on missing evidence." },
        { q: "A stakeholder asks whether collections field receipts are production-ready. What is the BA's correct move?", options: ["Say yes — there's a lesson about it", "Check the capability catalogue status and quote it", "Say no to be safe", "Ask engineering informally"], answer: 1, why: "Maturity truth lives in the catalogue (e.g. CLL rows) and the journey support matrix; course content deliberately defers to them." }
      ]
    }
  ]
};
