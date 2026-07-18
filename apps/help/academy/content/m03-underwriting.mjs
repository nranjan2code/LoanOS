// Module 3 — LOS II: credit data and decisioning.
export default {
  id: "m03-underwriting",
  number: 3,
  title: "LOS II — Credit data and decisioning",
  tagline: "How a lender decides: the data it may use, the policy that judges it, and the humans and machines allowed to say yes.",
  summary: "Underwriting turns verified facts into a governed decision. This module covers the lawful data rails (credit bureaus and the Account Aggregator), credit policy as executable data, the deterministic decision engine, the human controls around referrals and overrides, and the guardrails on AI in credit.",
  lessons: [
    {
      id: "credit-data",
      title: "Credit data: bureaus (CICs) and the Account Aggregator",
      duration: "18 min",
      verified: "17 Jul 2026",
      objectives: [
        "Explain what a bureau pull is, its permissible-purpose rule and what it returns",
        "Describe the Account Aggregator consent artefact and data flow",
        "Contrast bureau data with cash-flow data in underwriting"
      ],
      sections: [
        { heading: "The bureau: borrowing history on demand", body: "India has four licensed **Credit Information Companies**. A bureau pull requires a **permissible purpose and borrower consent**, and returns the credit report: score, active and closed trade lines, current obligations (the EMIs the person already pays), delinquency history, past write-offs or settlements, and recent enquiry counts.\n\nUnderwriting reads that report in structured ways: score bands and policy knockouts (a recent write-off may be an automatic decline), obligation extraction for affordability, enquiry velocity as a stress signal, and thin-file rules for people with little history. Remember the loop: after disbursement the RE reports this very loan back to the CICs — module 9 covers the reporting duty." },
        { heading: "The Account Aggregator: consented cash-flow data", body: "The **AA framework** is India's consent rail for financial data. The borrower approves a **consent artefact** — machine-readable, specifying purpose, the financial-information types, one-time or periodic fetch, validity period and data-life (how long the recipient may keep it). Data then flows from the FIP (the bank holding the account) via the licensed AA to the RE as FIU — encrypted, never seen by the AA itself, India-resident.\n\nBank statements via AA power **cash-flow underwriting**: income detection and stability, existing EMI outflows, bounce incidence, balance behaviour. This reaches borrowers whom bureau files underserve — and every derived analytic must retain provenance back to the consented fetch." },
        { heading: "Facts, not vibes", body: "In LoanOS, whatever the source — bureau, AA, GST/ITR verification, employer checks — data enters the decision as **verified facts with provenance**: what was fetched, when, under which consent, from which provider. The decision engine consumes those facts; it does not reach out to fetch anything itself. That separation (facts gathered by workflows, judged by policy) is what makes every decision explainable and replayable." }
      ],
      regulatory: [
        { id: "RBI-CIR-2025", note: "Credit information reporting directions — the same CIC relationship that supplies bureau reports." },
        { id: "RBI-AA-2016", note: "Account Aggregator framework: consent artefact, FIP→AA→FIU flow, India residency." },
        { id: "DPDP-2023", note: "Purpose-bound consent governs every data fetch used in underwriting." }
      ],
      platform: [
        { type: "capability", ref: "UWG-001", note: "Bureau pull with permissible purpose and consent." },
        { type: "capability", ref: "UWG-005", note: "Account Aggregator consent and FI fetch." },
        { type: "capability", ref: "UWG-007", note: "Bank-statement categorisation, stability, bounce and cash-flow analysis." },
        { type: "code", ref: "packages/core/src/integrations/account-aggregator.js", note: "AA consent module: artefact lifecycle and evidence." }
      ],
      terms: ["CIC", "AA", "EMI", "FOIR"],
      related: ["m03-underwriting/policy-as-data", "m09-compliance/cic-reporting"],
      check: [
        { q: "What does the AA consent artefact NOT contain?", options: ["Purpose of the fetch", "Validity period and data-life", "The borrower's account balance", "Financial-information types covered"], answer: 2, why: "The artefact is the permission, not the data: it defines purpose, scope, fetch type, validity and data-life; the data flows separately, encrypted end-to-end." },
        { q: "Why must derived analytics (e.g. detected income) retain provenance?", options: ["For marketing attribution", "So the decision can be explained and replayed from consented source data", "To bill the FIP", "Provenance is optional"], answer: 1, why: "Decision lineage requires every input fact to trace to its consented, timestamped source — that is what makes an audit answerable." }
      ]
    },
    {
      id: "policy-as-data",
      title: "Credit policy as data: eligibility and the decision engine",
      duration: "20 min",
      verified: "17 Jul 2026",
      objectives: [
        "Explain FOIR and the standard eligibility knockouts",
        "Describe why policy lives as versioned data, not code",
        "State the decision engine's guarantees: deterministic, fail-closed, replayable"
      ],
      sections: [
        { heading: "What a credit policy actually says", body: "Strip the mystique and a retail credit policy is a structured document: **who** may borrow (age band, residency, occupation classes), **how much** (amount and tenor bounds, exposure caps), **affordability** (FOIR — the share of income already committed to obligations plus the new EMI, capped by policy, e.g. 'total obligations may not exceed 55% of verified income'), **knockouts** (minimum bureau score, no recent write-offs, no active fraud flags), and **pricing** (rate grids by risk grade, fees, penal-charge policy).\n\nDeviations happen — a good customer just above the FOIR cap — and are themselves governed: a **deviation matrix** defines who may approve which departure, at which level." },
        { heading: "Policy is data, versioned and approved", body: "LoanOS's rule is that lending policy never lives as scattered if-statements in application code. A policy is a **decision model**: a JSON artefact with effective dates, validated against a golden corpus of test cases, approved four-eyes, signed and bound to a tenant. Changing policy means shipping a new version with evidence — not editing production behaviour in place.\n\nFor a BA this is liberating: 'change the FOIR cap to 50% for salaried applicants from 1 August' is a policy-version change request with a test corpus, an approval trail and an effective date — a fully specifiable, fully auditable artefact." },
        { heading: "The engine that says no by default", body: "Policies are evaluated by the per-tenant **decision engine** — deliberately boring in the best way:\n\n- **Deterministic** — no clock, no randomness, no network in evaluation; the same inputs always produce the same answer.\n- **Exact** — money math uses exact decimals; floats are forbidden on the evaluation path.\n- **Fail-closed** — missing facts, expired policy, unreachable service: the outcome is refer or deny, never approve.\n- **Replayable** — every decision's audit record lets you re-run it byte-identically years later.\n\nOutcomes are approve, refer or deny with reason codes. 'Refer' is not an error: it is the engine handing a case to human judgement, which module 7 picks up." }
      ],
      regulatory: [
        { id: "RBI-IT-GRC", note: "Straight-through-processing controls and audit trails demand exactly this discipline around automated decisions." },
        { id: "RBI-DL-2025", note: "Credit assessment must be demonstrably the RE's own act — versioned policy with lineage proves it." }
      ],
      platform: [
        { type: "capability", ref: "UWG-009", note: "EMI, FOIR, age, amount and tenor eligibility." },
        { type: "capability", ref: "UWG-018", note: "Deterministic decision models with golden corpus." },
        { type: "capability", ref: "UWG-019", note: "Decision trace, policy/data/model lineage and replay." },
        { type: "doc", ref: "docs/architecture/decision-engine-design.md", note: "Engine source of truth: invariants INV-1 (determinism), INV-5 (fail closed), INV-6 (exact money)." },
        { type: "code", ref: "rules/", note: "The Rust decision-engine workspace — one isolated runtime per tenant." },
        { type: "guide", ref: "configure-product", note: "Operating guide: configure a lending product as effective-dated policy." }
      ],
      terms: ["FOIR", "Decision engine", "Policy bundle", "EMI"],
      related: ["m03-underwriting/referrals-overrides", "m01-landscape/regulation-as-controls", "m08-partners/product-families"],
      check: [
        { q: "A borrower earns ₹1,00,000/month, pays ₹30,000 in existing EMIs, and the new loan's EMI is ₹18,000. Policy caps FOIR at 45%. What happens?", options: ["Approved — 30% is under the cap", "Referred or declined — total FOIR is 48%, over the cap", "Approved — new EMI alone is under 45%", "FOIR doesn't apply to salaried borrowers"], answer: 1, why: "FOIR counts total fixed obligations: (30,000 + 18,000) / 1,00,000 = 48% > 45%. The policy outcome is the restrictive one, possibly with a governed deviation path." },
        { q: "Why does the decision engine read no clock and no network during evaluation?", options: ["Performance", "So every decision is deterministic and byte-replayable from its audit record", "Cost savings", "Security theatre"], answer: 1, why: "Determinism is the foundation of replay: an auditor must be able to reproduce any historical decision exactly from recorded inputs and the policy version." }
      ]
    },
    {
      id: "referrals-overrides",
      title: "Referrals, overrides and maker-checker",
      duration: "15 min",
      verified: "17 Jul 2026",
      objectives: [
        "Treat 'refer' as a designed outcome with a governed resolution path",
        "Explain override discipline: policy permission, independence, evidence",
        "Describe the underwriter's workspace: CAM, conditions, sanction validity"
      ],
      sections: [
        { heading: "The refer lane", body: "A referral means the policy could not say yes on the facts as they stand — a document unverified, income borderline, a rule needing human judgement. The resolution path is strict: correct inaccurate facts **through the recorded workflow** (never by editing inputs out-of-band), attach the required evidence, and resubmit. The audit record keeps the original decision, the new facts, the actor and the final outcome as one lineage.\n\nWhat is never acceptable: treating an unavailable decision service as approval, or 'fixing' data outside the workflow to make the engine say yes." },
        { heading: "Overrides exist — under discipline", body: "Sometimes the human decision is to depart from policy. That is lawful when the policy itself permits it: the **deviation/approval matrix** names who may approve which departure, the approver must be **independent** of the preparer (maker-checker), and the override carries its justification and evidence into the record. Deviation trends are monitored — an underwriter whose every case needs an override is a policy problem or a conduct problem, and risk teams watch for both.\n\nDecline discipline matters too: a decline carries **coded reasons** and a borrower-facing explanation. 'Computer says no' is not a compliant answer." },
        { heading: "The credit workspace", body: "Around the decision sits the underwriter's machinery: the **CAM** (credit assessment memo) recording analysis and recommendation; **conditions precedent and subsequent** (module 4 shows CPs blocking disbursement); and **sanction validity** — an approval expires if not acted on, and material changes (new delinquency, job loss) require reassessment before funds move." }
      ],
      regulatory: [
        { id: "RBI-IAM-SOD", note: "Segregation of duties and independent control functions — the regulatory root of maker-checker." },
        { id: "RBI-DL-2025", note: "Credit decisions are the RE's responsibility; declines require explanation to the borrower." }
      ],
      platform: [
        { type: "capability", ref: "UWG-012", note: "Policy deviations and approval-authority matrix." },
        { type: "capability", ref: "UWG-015", note: "Maker-checker and four-eyes approval." },
        { type: "capability", ref: "UWG-014", note: "Coded decline and borrower explanation." },
        { type: "guide", ref: "resolve-referral", note: "Operating guide: resolve a referred decision without breaking lineage." }
      ],
      terms: ["Maker-checker", "CAM", "Conditions precedent", "Sanction letter"],
      related: ["m07-lws/maker-checker", "m04-kfs-sanction/sanction-contracting"],
      check: [
        { q: "An underwriter edits the applicant's stated income directly in the database so the engine approves. What has gone wrong?", options: ["Nothing, if the income was genuinely wrong", "Decision lineage is broken and the correction bypassed the recorded workflow — an audit and conduct failure", "Only a style issue", "The engine should have caught it"], answer: 1, why: "Facts may only change through the authorised workflow with evidence; out-of-band edits destroy replayability and constitute control bypass." }
      ]
    },
    {
      id: "ai-in-decisions",
      title: "AI-assisted decisions: guardrails, human review and the kill switch",
      duration: "18 min",
      verified: "17 Jul 2026",
      objectives: [
        "Explain how model outputs may lawfully influence a credit decision",
        "Describe the kill switch and what 'degrade to human review' means",
        "Summarise the governance around models and AI agents"
      ],
      sections: [
        { heading: "AI proposes; policy and humans dispose", body: "Scorecards and ML models are useful — and regulated. LoanOS's design keeps them in their lane: a model's output enters a decision only as a **provenance-tagged fact** ('model X version Y scored 0.71 on these inputs at this time'), which the deterministic policy then weighs. Models never call the shots directly, and **material AI influence triggers mandatory human review** — an underwriter confirms before the outcome stands.\n\nEvery model that materially affects decisions — vendor models and clever spreadsheets included — sits in a **model inventory** with an owner, use case, version, validation evidence, fairness/performance monitoring and a risk tier." },
        { heading: "The kill switch is a product control", body: "When a model misbehaves — drift, bias, a bad release — the RE needs to stop it **now**, not at the next deployment. The **kill switch** does that: model-scoped or global, it blocks runtime model use immediately, records who pulled it and why, and **degrades affected decisions to manual review** — fail closed, never fail open. Draft RBI model-risk guidance points exactly this way: inventory, validation, human oversight, override controls.\n\nAgentic AI gets the same treatment with tighter bounds: digital workers are **proposal-only**, tenant-scoped, guardrail-checked before every action, and approving their material actions requires authenticated humans. Module 9 goes deeper." },
        { heading: "Fairness is testable", body: "The FREE-AI committee's principles — fairness, explainability, accountability, resilience — translate into artefacts a BA can demand: cohort-level performance and fairness reports, explainability evidence for adverse decisions, red-team results for generative systems, incident processes with affected-decision identification. If a vendor cannot produce these, the model does not belong in a credit path." }
      ],
      regulatory: [
        { id: "RBI-MRM-DRAFT-2026", note: "Model inventory, validation, human oversight and kill-switch controls." },
        { id: "FREE-AI-2025", note: "Fairness, accountability, explainability, resilience — the principles behind the artefacts." },
        { id: "INDIA-AI-GOV-2025", note: "Cross-sector AI governance guidance layered under RBI directions." }
      ],
      platform: [
        { type: "capability", ref: "AIG-008", note: "Global, model, workflow and use-case kill switches." },
        { type: "capability", ref: "AIG-010", note: "Human review, customer disclosure and human handoff." },
        { type: "capability", ref: "AIG-014", note: "Decision reason lineage from the actual deciding authority." },
        { type: "code", ref: "packages/core/src/ai/model-governance.js", note: "Kill-switch state source of truth; the decision engine enforces it." }
      ],
      terms: ["Kill switch", "Digital worker", "Decision engine"],
      related: ["m09-compliance/model-governance", "m03-underwriting/policy-as-data"],
      check: [
        { q: "The kill switch is activated for the income-estimation model. What happens to in-flight applications that depend on it?", options: ["They auto-approve on last known scores", "They fail with errors", "They degrade to manual review — the human queue picks them up", "They are cancelled"], answer: 2, why: "Kill-switch semantics are fail-closed-to-humans: model-dependent decisions route to review rather than proceeding on stale or absent model output." },
        { q: "How does a model's opinion legally enter a LoanOS credit decision?", options: ["The model API is called from the engine at evaluation time", "As a provenance-tagged fact evaluated by deterministic policy", "Via a webhook that sets the outcome", "It doesn't — models are banned"], answer: 1, why: "Facts in, deterministic policy over them — with material AI influence forcing human review. The engine itself never performs I/O." }
      ]
    }
  ]
};
