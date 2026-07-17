// Module 4 — LOS III: KFS, sanction and disbursement.
export default {
  id: "m04-kfs-sanction",
  number: 4,
  title: "LOS III — KFS, sanction and disbursement",
  tagline: "The promise, the paper and the money: disclosure, contracting and the last gate before funds move.",
  summary: "Approval is not a loan. Between the credit decision and the money stand India's strictest conduct controls: the standardised Key Facts Statement, a governed contracting packet, conditions precedent, and the direct fund-flow rule. This module teaches each gate and the evidence it must leave behind.",
  lessons: [
    {
      id: "kfs",
      title: "The Key Facts Statement: India's pre-contract disclosure",
      duration: "20 min",
      verified: "17 Jul 2026",
      objectives: [
        "List what a KFS must contain and how APR is computed",
        "Explain the KFS as a gate: validity, acceptance, no-undisclosed-charges rule",
        "Describe language and comprehension evidence"
      ],
      sections: [
        { heading: "Why the KFS exists", body: "Borrowers historically discovered the true cost of a loan after signing: processing fees here, insurance there, penal interest compounding quietly. The KFS directions end that with one standardised, pre-contract document containing:\n\n- The **APR** — the all-inclusive annual cost combining interest and every charge, computed on the actual cash flows.\n- An **amortisation schedule** — every instalment, split into principal and interest.\n- **All charges, individually** — processing, insurance, documentation, penal charges policy, foreclosure charges — with GST shown.\n- The **cooling-off window**, recovery mechanism, grievance officer and escalation path.\n\nThe governing rule: **a charge not in the KFS cannot be charged**. Ever. That single sentence turns disclosure from a formality into an enforceable contract boundary." },
        { heading: "A data object, not a PDF", body: "LoanOS builds the KFS server-side from approved terms — `buildKeyFactStatement` — as a unique proposal with a validity period, and validates it before decisions proceed (`validateKfsBeforeDecision`). Acceptance is authenticated and bound to the exact proposal: what the borrower accepted is provably what was disclosed. Downstream, the fee registry rejects any charge the KFS did not disclose — the no-undisclosed-charges rule enforced as code.\n\nSanction readiness requires KFS acceptance plus digital delivery evidence. Missing either, the journey stops — there is no informal substitute document." },
        { heading: "Understood, not just delivered", body: "Disclosure only protects a borrower who can read it. The KFS must be issued **in a language the borrower understands**; LoanOS records the borrower's language choice at issuance, and a non-English KFS requires matching language-confirmation evidence at acceptance. Evidence that contents were explained — not merely transmitted — is a capability in its own right. For a BA, 'the borrower got the document' and 'the borrower understood the document' are separate requirements with separate evidence." }
      ],
      regulatory: [
        { id: "RBI-KFS-2024", note: "The KFS directions: standardised disclosure of APR, amortisation, fees, cooling-off, recovery and grievance before execution." },
        { id: "RBI-FPC-PENAL", note: "Penal charges must be disclosed upfront in KFS/MITC and the agreement." }
      ],
      platform: [
        { type: "code", ref: "packages/core/src/loan-policy.js", note: "Server-grounded KFS builder and validator (buildKeyFactStatement, validateKfsBeforeDecision)." },
        { type: "capability", ref: "OFR-004", note: "KFS unique proposal, validity, APR sheet and amortisation schedule." },
        { type: "capability", ref: "OFR-006", note: "KFS in a language understood by the borrower." },
        { type: "capability", ref: "OFR-007", note: "Evidence that KFS contents were explained and understood." },
        { type: "guide", ref: "generate-kfs", note: "Operating guide: generate and acknowledge a KFS." }
      ],
      terms: ["KFS", "APR", "Amortisation", "Cooling-off period", "Penal charges", "MITC", "GST"],
      related: ["m04-kfs-sanction/sanction-contracting", "m05-lms/servicing"],
      check: [
        { q: "Post-disbursement, operations wants to levy a 'document retrieval charge' that was never in the KFS. What happens?", options: ["Allowed if under ₹500", "Allowed with manager approval", "Blocked — a charge absent from the KFS cannot be levied", "Allowed if disclosed on the website"], answer: 2, why: "The KFS is the exhaustive charge disclosure; LoanOS's fee registry enforces the no-undisclosed-charges rule downstream." },
        { q: "What binds a borrower's acceptance to the disclosure they actually saw?", options: ["A scanned signature", "Acceptance is authenticated and bound to the unique KFS proposal ID and validity", "A call recording", "The sanction letter"], answer: 1, why: "The KFS is a unique, validity-bound proposal; acceptance references exactly that proposal, making the disclosure provable." }
      ]
    },
    {
      id: "sanction-contracting",
      title: "Sanction, the agreement packet and eSign",
      duration: "16 min",
      verified: "17 Jul 2026",
      objectives: [
        "Distinguish sanction from disbursement and explain sanction validity",
        "Describe the execution packet and its integrity evidence",
        "Explain conditions precedent vs conditions subsequent"
      ],
      sections: [
        { heading: "Sanction is an offer with an expiry date", body: "The **sanction letter** records the approved amount, rate, tenor, charges, and — critically — **conditions** and a **validity window**. It is the RE's formal offer; the borrower's acceptance and the executed agreement turn it into a contract. Sanction validity is a real control: approvals go stale as circumstances change, so disbursement after expiry fails closed and forces reassessment.\n\nConditions come in two flavours a BA must never confuse:\n\n- **Conditions precedent (CP)** — must be satisfied or formally waived **before** money moves (e.g. insurance assignment, employer verification). An open CP blocks disbursement.\n- **Conditions subsequent (CS)** — obligations after disbursement (e.g. submit final property papers within 60 days), tracked with follow-up workflows." },
        { heading: "The execution packet", body: "Contracting produces a governed document set: KFS, sanction letter, agreement summary, privacy notice — rendered with checksums, delivered with evidence, signed with **eSign** (signer authentication, envelope, callback evidence) and vaulted with a receipt. Multi-party cases (co-borrowers, guarantors) require every party's signature to complete.\n\nEach artefact carries integrity material: what was rendered, delivered, signed, by whom, when. Waivers of documents or conditions are themselves governed acts — policy reference, reason and a separate approver, per the origination journey design." },
        { heading: "Cooling-off: the borrower's exit door", body: "Digital lending's **cooling-off period** — a board-approved window after disbursement — lets the borrower exit by repaying principal plus proportionate APR-based cost, without penalty beyond that. The KFS disclosed it; servicing must honour it with a proper cancellation and refund workflow. It is a conduct control, not a courtesy." }
      ],
      regulatory: [
        { id: "RBI-DL-2025", note: "Cooling-off exit right and digital execution conduct." },
        { id: "RBI-KFS-2024", note: "KFS acceptance precedes execution; the packet embeds the disclosed terms." }
      ],
      platform: [
        { type: "capability", ref: "OFR-009", note: "Sanction letter with conditions and validity." },
        { type: "capability", ref: "DOC-011", note: "eSign envelope, signer authentication, callback and evidence." },
        { type: "capability", ref: "OFR-014", note: "Cooling-off cancellation, proportionate cost and refund." },
        { type: "doc", ref: "docs/architecture/origination-journey.md", note: "Governed journey: document verification/waiver, CP/CS evidence, sanction-validity fail-closed rule." }
      ],
      terms: ["Sanction letter", "Conditions precedent", "Cooling-off period", "NOC"],
      related: ["m03-underwriting/referrals-overrides", "m04-kfs-sanction/disbursement-fund-flow"],
      check: [
        { q: "A sanction expired yesterday; the borrower's file is otherwise complete. Operations asks to disburse 'since it's only a day'. The platform's answer?", options: ["Disburse with a note", "Disburse with manager sign-off", "Fail closed: expired sanction blocks disbursement until reassessment", "Extend validity retroactively"], answer: 2, why: "Sanction validity is a control against stale approvals; the origination design makes post-expiry disbursement fail closed." },
        { q: "An open condition precedent exists but the borrower is pressing for funds. What can operations lawfully do?", options: ["Disburse and chase the CP later", "Satisfy the CP with evidence, or obtain a governed waiver with policy reference, reason and a separate approver", "Convert it to a condition subsequent informally", "Delete the condition"], answer: 1, why: "CPs block funds by definition; the only paths are evidenced satisfaction or a governed, independently approved waiver." }
      ]
    },
    {
      id: "disbursement-fund-flow",
      title: "Disbursement and the direct fund-flow rule",
      duration: "16 min",
      verified: "17 Jul 2026",
      objectives: [
        "State the direct fund-flow rule and its limited exceptions",
        "Walk the disbursement readiness checklist",
        "Explain what happens after initiation: settlement, failure repair, advice"
      ],
      sections: [
        { heading: "Money moves directly, or not at all", body: "The Digital Lending Directions' fund-flow rule is blunt: **disbursement goes straight from the RE's account to the borrower's bank account, and repayments come straight back**. LSP-controlled accounts, marketplace wallets and pass-through pools are prohibited — the abuses of the app-lending era (funds hostage in intermediary accounts, phantom lenders) died here.\n\nExceptions are narrow and specifically permitted: co-lending escrow between REs (module 8), statutory/end-use payments to a third party (e.g. paying a dealer for the financed vehicle, where permitted per product norms). LoanOS's account validator rejects any other arrangement — an LSP account as destination is not a warning, it is a refusal." },
        { heading: "The readiness checklist", body: "Disbursement is the platform's most heavily gated transition. The checklist that must be green:\n\n1. KFS accepted, with delivery evidence.\n2. Execution packet signed and vaulted.\n3. Conditions precedent satisfied or governedly waived.\n4. Sanction within validity.\n5. **Destination account verified** as the borrower's (or permitted beneficiary's) — penny-drop/name-match evidence.\n6. Fund-flow check passed (no prohibited intermediary).\n7. **Maker-checker authorization** — the disburser cannot be the approver.\n\nAny red item blocks. There is no 'disburse now, fix later' path, because after the money moves the leverage is gone." },
        { heading: "After the button", body: "Initiation is not completion. The payment rail responds; settlement confirms; failures (wrong IFSC, closed account) enter a repair-and-retry workflow; cancellations and returns are handled with reversal accounting. The borrower receives a **disbursement advice**, and the loan account opens in the LMS — which is where module 5 begins. Tranche-based products (construction-linked home loans) repeat the gate per tranche." }
      ],
      regulatory: [
        { id: "RBI-FUND-FLOW", note: "Direct fund flow: no LSP/DLA control of disbursement or repayment except narrow permitted cases." },
        { id: "RBI-DL-2025", note: "The parent directions defining the conduct around money movement." }
      ],
      platform: [
        { type: "capability", ref: "DSB-001", note: "Disbursement-readiness checklist and blocking findings." },
        { type: "capability", ref: "DSB-002", note: "Verified borrower/end-beneficiary bank account." },
        { type: "capability", ref: "DSB-003", note: "Direct fund flow without LSP/pass-through control." },
        { type: "capability", ref: "DSB-004", note: "Maker-checker disbursement authorization." },
        { type: "code", ref: "packages/core/src/compliance-controls.js", note: "Disbursement and collection account validator — the fund-flow gate." }
      ],
      terms: ["Escrow", "Maker-checker", "NACH"],
      related: ["m05-lms/loan-account-ledger", "m08-partners/co-lending"],
      check: [
        { q: "A marketplace LSP proposes: 'route disbursements through our nodal account; we'll forward same-day.' What does the platform do?", options: ["Allow with an SLA", "Allow if the LSP is registered", "Reject — LSP pass-through accounts violate the fund-flow rule", "Allow for amounts under ₹50,000"], answer: 2, why: "Direct fund flow prohibits LSP-controlled intermediary accounts; same-day forwarding does not cure the violation." },
        { q: "Why does account verification precede disbursement?", options: ["To speed up NEFT", "To prove the destination belongs to the borrower or a permitted beneficiary before funds are irrecoverable", "Bank marketing requirement", "It's optional for small loans"], answer: 1, why: "Post-disbursement recovery of misdirected funds is near-impossible; verification evidence is a blocking readiness item." }
      ]
    }
  ]
};
