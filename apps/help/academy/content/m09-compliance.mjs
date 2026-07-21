// Module 9 — Compliance operations, data and AI governance.
export default {
  id: "m09-compliance",
  number: 9,
  title: "Compliance operations, data and AI governance",
  tagline: "Proving it: the audit spine, the reporting duties, the data rules and the machines under command.",
  summary: "Everything earlier in this course produces evidence; this module is about operating that evidence. The audit hash chain and evidence packs, the credit-information reporting cadence, data residency and DPDP operations, and the model/AI governance a BA must be able to explain to an auditor.",
  lessons: [
    {
      id: "audit-evidence",
      title: "The audit spine: hash chain and evidence packs",
      duration: "16 min",
      verified: "17 Jul 2026",
      objectives: [
        "Explain the append-only, hash-chained audit record and tamper evidence",
        "Describe what an evidence pack is and how exports stay governed",
        "Connect audit lineage to decision replay"
      ],
      sections: [
        { heading: "A chain, not a log", body: "Ordinary logs can be edited; audit evidence must not be. LoanOS seals every state change into a per-tenant, **append-only SHA-256 hash chain**: each event carries the hash of its predecessor, so deleting or altering any historical record breaks the chain visibly. Verification re-walks the chain and reports integrity; external timestamp anchoring or WORM retention adds independent custody where configured.\n\nEvery event carries full **provenance** — actor, session, role, tenant, correlation lineage across API, UI, domain, decision and integration layers. This is the substrate for module 7's promise: 'who did what, on whose authority' is always answerable." },
        { heading: "Evidence packs: audit on demand", body: "When an auditor, inspector or court asks, the RE exports an **evidence pack**: a scoped, integrity-attested extract — authorised requester, purpose, date range and exact control scope recorded; only the scoped records and their integrity material included; tenant isolation and field-level restrictions preserved. Custody is part of the control: who generated, received and retained the pack, under legal-hold and deletion rules.\n\nThe operating mechanics live in the Guide's evidence-pack article; what a BA must grasp is the posture — evidence is *assembled from the chain*, never reconstructed from memory and screenshots." },
        { heading: "Replay: the strongest form of proof", body: "For decisions, the audit record does more than describe — it **reproduces**. Because the decision engine is deterministic (module 3), the recorded inputs, policy version and model facts let anyone re-run a historical decision byte-identically. 'Why was this loan approved in March?' is answered by replaying March, not by interviewing whoever was on shift. That is the deepest sense in which compliance evidence is produced while the business flow runs." }
      ],
      regulatory: [
        { id: "RBI-IT-GRC", note: "Audit trails, integrity and assurance controls over IT processing." },
        { id: "RBI-IAM-SOD", note: "Attribution and activity accountability, including WORM custody expectations." }
      ],
      platform: [
        { type: "capability", ref: "AUD-001", note: "Tenant-scoped append-only hash-chained audit events." },
        { type: "capability", ref: "AUD-003", note: "Integrity verification and filtered evidence export." },
        { type: "capability", ref: "AIG-015", note: "Deterministic replay and audit reproduction." },
        { type: "guide", ref: "evidence-pack", note: "Operating guide: export an integrity-attested evidence pack." }
      ],
      terms: ["Audit hash chain", "Evidence pack", "Decision engine", "Tenant"],
      related: ["m03-underwriting/policy-as-data", "m07-lws/queues-sla", "m10-capstone/trace-a-loan"],
      check: [
        { q: "How does the audit chain make tampering visible?", options: ["Access logs", "Each event embeds its predecessor's hash — altering history breaks every later link", "Daily backups", "Manager review"], answer: 1, why: "Hash chaining means integrity is a mathematical property of the sequence, checkable by anyone re-walking it." },
        { q: "An auditor questions a two-year-old credit decision. The strongest available answer is…", options: ["The underwriter's recollection", "The policy document from that year", "A byte-identical replay from the recorded inputs and policy version", "The approval email"], answer: 2, why: "Determinism plus recorded lineage lets the platform reproduce the decision exactly — evidence stronger than any narrative." }
      ]
    },
    {
      id: "cic-reporting",
      title: "Credit information reporting: the fortnightly duty",
      duration: "15 min",
      verified: "17 Jul 2026",
      objectives: [
        "State the UCRF reporting cadence and repair clocks",
        "Explain borrower-facing duties: alerts, corrections, compensation",
        "See where reporting sits in LoanOS"
      ],
      sections: [
        { heading: "The cadence", body: "Module 3 used bureau data; this is the duty that creates it. Under the 2025 Credit Information Reporting Directions, REs submit borrower-level data to **all** CICs in the applicable **UCRF** format (consumer, commercial or MFI), with data current as of the **15th and month-end**, submitted **within seven calendar days** of those dates. Rejected records must be corrected and resubmitted **within seven days**; recurring rejects point at source-data defects that must be fixed at origin, not patched in the file.\n\nA BA should read this as a pipeline requirement: every reportable event (disbursement, payment, DPD change, classification, restructure, settlement, closure) must land in the reporting snapshot on time and correctly typed." },
        { heading: "The borrower's side of the file", body: "The directions strengthen the data subject's hand: borrowers receive **alerts when default is reported** about them; correction requests run on **21/30-day clocks**; and delayed corrections carry **compensation** to the borrower. Module 5's closure lesson showed the classic harm — a repaid loan still showing open. The correction machinery is how it gets fixed, and the compensation rule is why REs should care about not needing it.\n\nRemember tipping-off boundaries from module 2: CIC reporting is routine and visible to the borrower; FIU-IND suspicious-transaction reporting is neither — never conflate the two channels." },
        { heading: "In the platform", body: "LoanOS generates CIC-ready snapshots from the LMS ledger (delinquency, classification and balances derive from events, so the report matches the book by construction), manages submission/acknowledgement/reject-repair workflows, and runs borrower correction cases with their clocks as LWS tasks. Reporting lineage — from source transaction to submitted field — is itself a capability, because regulators increasingly audit the pipeline, not just the file." }
      ],
      regulatory: [
        { id: "RBI-CIR-2025", note: "UCRF formats, fortnightly cadence, seven-day submission and reject repair, alerts, 21/30-day correction clocks, compensation." }
      ],
      platform: [
        { type: "capability", ref: "RPT-003", note: "CIC consumer/commercial UCRF formats." },
        { type: "capability", ref: "RPT-004", note: "Fortnightly schedule, acknowledgement, rejects, repair and resubmission." },
        { type: "capability", ref: "RPT-005", note: "CIC dispute/correction and borrower communication." },
        { type: "code", ref: "packages/core/src/compliance/cic-reporting.js", note: "CIC reporting module and correction workflows." }
      ],
      terms: ["CIC", "UCRF", "DPD", "FIU-IND"],
      related: ["m06-collections/delinquency-classification", "m05-lms/servicing", "m03-underwriting/credit-data"],
      check: [
        { q: "How current must CIC-submitted data be?", options: ["Quarterly", "As of the 15th and month-end, submitted within seven days of each", "Annual", "Real-time"], answer: 1, why: "The 2025 directions set the fortnightly cadence with a seven-day submission window — and seven more for reject repair." },
        { q: "A borrower proves their reported default is wrong; the RE fixes it late. What follows?", options: ["Nothing — fixed is fixed", "An apology letter", "Compensation for the delayed correction, per the directions", "A CIC penalty on the borrower"], answer: 2, why: "Delayed-update compensation is the directions' enforcement of the correction clocks." }
      ]
    },
    {
      id: "data-protection",
      title: "Data operations: residency, retention and DPDP in practice",
      duration: "16 min",
      verified: "17 Jul 2026",
      objectives: [
        "Apply the India-residency rules per data class",
        "Operate retention, deletion and legal hold coherently",
        "Handle breach duties: DPDP, CERT-In and RBI clocks together"
      ],
      sections: [
        { heading: "Residency is per data class, not per server", body: "Saying 'we host in India' is not the control. Each data class carries its own rule:\n\n- **Digital-lending personal data** — stored on India servers; if processed abroad, deleted there and returned within 24 hours.\n- **Payment-system data** — India-only storage where in scope.\n- **V-CIP recordings and logs** — India-stored, full stop.\n- **Aadhaar biometrics/OTP/PID** — nowhere, ever (module 2).\n\nLoanOS models residency as metadata on data classes with vendor-routing consequences: an integration that would move a restricted class offshore fails validation. A BA adding any integration must classify its data flows first — that classification is the requirement." },
        { heading: "Retention: keep, then provably stop keeping", body: "Every class also carries a **retention schedule** by product and legal basis — KYC records and transaction evidence under PMLA/RBI rules (years after relationship end), complaint files, audit evidence. The other edge: DPDP expects data **not** to be kept beyond purpose. The reconciliation is module 2's erasure-with-hold pattern plus **automated deletion/anonymisation** when retention lapses, and **legal hold** freezing deletion when litigation or investigation intervenes. Proof of deletion is itself evidence." },
        { heading: "When it goes wrong: three clocks at once", body: "A serious security incident at a lender trips parallel duties: **CERT-In** — report qualifying cyber incidents within **6 hours** (a duty LoanOS carries directly as an Indian service provider, alongside 180-day India log retention and NTP-synchronised clocks); **RBI** — the RE's incident-notification duties under IT-outsourcing directions, which the platform's contracts must support within the RE's 6-hour window; **DPDP** — breach notification to the Data Protection Board and affected individuals per the Rules' timelines. The platform's incident workflow is built to feed all three from one evidence trail — a BA designing incident-adjacent features should assume every artefact may end up in front of three different authorities." }
      ],
      regulatory: [
        { id: "RBI-DATA-RESIDENCY", note: "India storage for digital-lending personal data; 24-hour return rule." },
        { id: "RBI-PAY-DATA", note: "Payment-system data India-only storage." },
        { id: "CERT-IN-2022", note: "6-hour incident reporting, 180-day India log retention, NTP sync." },
        { id: "DPDP-RULES-2025", note: "Breach assessment and notification duties under phased commencement." },
        { id: "RBI-IT-OUTSOURCE-2023", note: "The platform must support the RE's own incident and audit duties as its IT provider." }
      ],
      platform: [
        { type: "capability", ref: "CON-009", note: "Retention schedules by data class, product and legal basis." },
        { type: "capability", ref: "CON-010", note: "Automated deletion, anonymisation and legal hold." },
        { type: "capability", ref: "CON-014", note: "Data-breach notification to Board and affected principals." },
        { type: "capability", ref: "SEC-016", note: "CERT-In log retention and trusted time synchronization." },
        { type: "doc", ref: "docs/architecture/data-governance.md", note: "Data classes, residency and governance architecture." }
      ],
      terms: ["DPDP", "CERT-In", "V-CIP", "Aadhaar"],
      related: ["m02-onboarding/consent-dpdp", "m01-landscape/regulatory-map"],
      check: [
        { q: "Digital-lending personal data is processed by an offshore service. What must happen?", options: ["Nothing if encrypted", "Deleted offshore and brought back to India within 24 hours", "Kept offshore with consent", "Anonymised offshore"], answer: 1, why: "The residency rule permits offshore processing only with deletion abroad and 24-hour return — a hard integration constraint." },
        { q: "Which incident clock applies to LoanOS itself, not just its RE customers?", options: ["The RBI 6-hour RE window only", "CERT-In's 6-hour reporting duty as an Indian service provider", "DPDP only", "None — vendors are exempt"], answer: 1, why: "CERT-In directions bind Indian service providers directly; the platform is inside the regulatory perimeter, not behind it." }
      ]
    },
    {
      id: "model-governance",
      title: "Model risk and AI governance: the full picture",
      duration: "18 min",
      verified: "17 Jul 2026",
      objectives: [
        "Run a model's lifecycle: inventory → validation → activation → monitoring → retirement",
        "Explain digital-worker governance: proposal-only agents, guardrails, human approval",
        "Brief an auditor on AI controls without hand-waving"
      ],
      sections: [
        { heading: "The lifecycle every model must live", body: "Module 3 covered AI inside a credit decision; here is the governance machine around every model. It starts with **inventory**: scorecards, ML, vendor models, GenAI — and yes, the spreadsheet that materially affects decisions — each with an owner, use case, version, materiality and risk tier. Then the gates: independent **validation** and four-eyes approval before activation; **monitoring** in production — drift thresholds, fairness and performance cohorts, with automatic suspension on breach; **change control** with rollback and challenger windows; and eventual retirement.\n\nAn unregistered model influencing decisions is not a shortcut; it is a control gap that fails audit. That is the sentence a BA should carry into every 'can we just quickly use…' conversation." },
        { heading: "Agents: bounded, watched, reversible", body: "Digital workers extend governance to agentic AI, and the platform is strict:\n\n- **Proposal-only** — agents draft (a CAM, a document review, a service reply); humans decide. No agent holds approval authority, and an agent can never fill a human control role.\n- **Business-first creation** — tenant staff can begin with a banking template, copy an existing assistant into a fresh draft, or use guided setup. The server limits every draft to the tenant's currently active product journeys; copying never copies approvals or activation.\n- **Pinned configuration** — model, prompt, knowledge and action scope are versioned per installation; changing them is a governed act. Agent Studio lets staff describe the job in everyday language and narrow scope, but cannot expand authority, activate a worker or prove a live provider is ready.\n- **Bounded memory** — staff may select no memory or current-task memory. Persistent borrower memory remains blocked until it is separately governed as a personal-data store.\n- **Fresh guardrails per execution** — every action passes deterministic `guardrail` checks (allow / deny / require_human) evaluated by the same fail-closed engine as lending policy.\n- **Four-role human activation** for material agents; **hash-sealed lineage** for every execution and output; usage metered to the paisa.\n- **AI never approves releases** either — platform-side, release and rollback approval require independent authenticated humans.\n\nThe kill switch from module 3 sits above all of it, global or scoped." },
        { heading: "No-code still means controlled", body: "Agent Studio guides bank staff through five plain-language workspaces: Create, Knowledge & Memory, Test & Release, Operations and Governance. Staff can use eleven banking templates, arrange safe work plans, approve expiring knowledge, manage exact-rupee budgets and work from role-focused queues without facing one long technical form. Persistent memory is available only through an independently approved India-resident store with declared purpose, fields, consent, retention, correction and deletion controls. Knowledge expiry suspends dependent active assistants. Provider contract, security, residency, monitoring, incident exercise and institution-UAT references also need independent review, and production admission denies any missing or stale dependency. A passing synthetic rehearsal or repository admission projection proves control wiring only — never external evidence authenticity, live-model quality, provider certification or institution production authorization." },
        { heading: "Answering the auditor", body: "Put together, an AI audit answer sounds like: *every model is inventoried with validation evidence; runtime use passes a purpose-checked gate; material influence forces human review; customers are told when AI touches them and can reach a human; incidents identify affected decisions; any model can be stopped instantly; and every decision it ever influenced can be replayed*. Each clause is a capability you have now met. If a proposed feature would break one clause, it is not a feature — it is a finding." }
      ],
      regulatory: [
        { id: "RBI-MRM-DRAFT-2026", note: "Model inventory, validation, oversight, kill-switch controls." },
        { id: "FREE-AI-2025", note: "Fairness, accountability, explainability, red-teaming, incident reporting." },
        { id: "INDIA-AI-GOV-2025", note: "Cross-sector principles applied through risk-based controls." }
      ],
      platform: [
        { type: "capability", ref: "AIG-001", note: "Inventory of scorecards, ML, vendor, spreadsheet and GenAI models." },
        { type: "capability", ref: "AIG-016", note: "Governed digital-worker marketplace with proposal-only templates." },
        { type: "capability", ref: "AIG-025", note: "No-code Agent Studio for governed creation, visual work plans, knowledge packs, adverse test definitions, comparison and lifecycle controls." },
        { type: "capability", ref: "AIG-019", note: "Four-role human approval and control-engine activation for material agents." },
        { type: "capability", ref: "AIG-021", note: "Hash-sealed execution, output, usage and governance-report lineage." },
        { type: "doc", ref: "docs/architecture/agentic-ai-digital-workers.md", note: "The digital-workers architecture: identities, guardrails, autonomy bounds." },
        { type: "code", ref: "packages/core/src/ai/model-governance.js", note: "Model registry and kill-switch state source." }
      ],
      terms: ["Digital worker", "Kill switch", "CAM", "Maker-checker"],
      related: ["m03-underwriting/ai-in-decisions", "m09-compliance/audit-evidence"],
      check: [
        { q: "A vendor's pricing spreadsheet materially affects loan decisions. Does model governance apply?", options: ["No — it's Excel", "Only if it uses ML", "Yes — anything materially affecting decisions enters the inventory and its gates", "Only after an incident"], answer: 2, why: "Materiality, not technology, defines a model; the inventory explicitly includes spreadsheets and vendor artefacts." },
        { q: "What authority can a digital worker hold in LoanOS?", options: ["Approval of small loans", "Release sign-off", "None — agents propose; authenticated humans decide", "Checker duty at night"], answer: 2, why: "Proposal-only is structural: agents cannot fill human control roles, approve credit or sign releases." }
      ]
    }
  ]
};
