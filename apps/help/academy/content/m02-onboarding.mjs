// Module 2 — LOS I: acquisition, consent and KYC.
export default {
  id: "m02-onboarding",
  number: 2,
  title: "LOS I — Acquisition, consent and KYC",
  tagline: "A loan begins with a person: finding them lawfully, asking permission properly, and knowing who they are.",
  summary: "Origination starts long before underwriting. This module covers the front door: acquisition channels and neutral offers, DPDP consent and notices, the KYC/CDD machinery (CKYC, V-CIP, Aadhaar boundaries), and the fraud screening that protects the book from bad applications.",
  lessons: [
    {
      id: "acquisition-channels",
      title: "Acquisition: channels, leads and neutral offers",
      duration: "15 min",
      verified: "17 Jul 2026",
      objectives: [
        "List the acquisition channels an RE typically runs and their governance differences",
        "Explain lead attribution and why duplicate/existing-customer matching matters",
        "State the neutrality rules for multi-lender offer presentation"
      ],
      sections: [
        { heading: "Where applications come from", body: "An RE's pipeline blends channels with very different risk profiles:\n\n- **Digital self-serve** — the borrower applies on the RE's own DLA.\n- **Branch-assisted** — staff capture the application with the borrower present.\n- **Partner-sourced** — DSAs, business correspondents, dealers, merchants and LSPs bring leads.\n- **API / embedded finance** — a partner platform originates inside its own journey.\n\nEach channel carries its own conduct duties: partner channels need commission governance and conduct monitoring; digital channels need consent and disclosure evidence; every channel needs source attribution so the RE can answer 'who brought this borrower and what were they promised?'" },
        { heading: "Leads are governed objects too", body: "Before an application exists there is a lead: a source, a campaign, a referral, an attribution trail, and a follow-up history. Two controls matter early:\n\n1. **Duplicate and existing-customer matching** — the same person applying twice through two DSAs must converge on one customer record, or exposure and KYC fragment.\n2. **Channel eligibility and serviceability** — geography, product entitlement and branch routing decide whether the RE may even serve the lead.\n\nA BA writing acquisition requirements should treat abandonment, re-application and channel switching as first-class paths, not exceptions." },
        { heading: "Presenting offers without tricks", body: "When a surface presents offers from multiple lenders, the Digital Lending Directions and consumer-protection rules require neutrality: complete offers (all-in cost, not teaser rates), objective and disclosed ranking, unmatched lenders visible where required, and no dark patterns — no pre-ticked add-ons, no buried fees, no countdown pressure. LoanOS encodes ranking disclosure and dark-pattern prevention as offer-surface capabilities rather than leaving it to marketing judgement." }
      ],
      regulatory: [
        { id: "RBI-DL-2025", note: "Channel sourcing never transfers lender responsibility; partner conduct stays visible and auditable to the RE." },
        { id: "CCPA-DARK-PATTERNS", note: "Offer comparison must avoid deceptive patterns; ranking must be explained." }
      ],
      platform: [
        { type: "capability", ref: "CHN-003", note: "DSA, BC, connector, dealer, merchant and LSP lead intake." },
        { type: "capability", ref: "CHN-007", note: "Duplicate-lead and existing-customer matching." },
        { type: "capability", ref: "OFR-002", note: "Multi-lender matching and complete offer presentation." },
        { type: "surface", ref: "/t/{tenantId}/portal/", note: "Borrower-facing journey portal — the RE-owned digital channel (tenant-scoped)." }
      ],
      terms: ["DSA", "LSP", "DLA"],
      related: ["m01-landscape/digital-lending-model", "m08-partners/lsp-dla-governance"],
      check: [
        { q: "Why must duplicate leads converge on one customer record?", options: ["To save storage", "So exposure, KYC and conduct history aggregate on one person", "To pay only one DSA", "RBI mandates one lead per person"], answer: 1, why: "Fragmented identity breaks exposure aggregation, KYC reuse and conduct attribution — all of which regulation expects at the customer level." }
      ]
    },
    {
      id: "consent-dpdp",
      title: "Consent and DPDP: notice, purpose and the consent ledger",
      duration: "18 min",
      verified: "17 Jul 2026",
      objectives: [
        "Explain purpose-bound consent and the DPDP notice",
        "Describe withdrawal, correction and erasure — and the statutory-retention tension",
        "Show where consent gates the LoanOS application flow"
      ],
      sections: [
        { heading: "Consent is a contract about data", body: "The DPDP Act makes personal-data processing lawful only with a valid basis — for lending, overwhelmingly **notice and consent**. A valid consent is specific: it names the purpose (credit assessment, bureau pull, marketing), the data involved, and the recipients. Blanket 'we may use your data for anything' consent is exactly what the regime forbids.\n\nThe borrower also holds rights: access to what is held, correction of what is wrong, erasure of what is no longer needed, and a grievance path. Each right is a workflow, not a sentiment." },
        { heading: "The ledger, not the checkbox", body: "LoanOS records consent in a **consent ledger**: purpose-specific entries with notice evidence, grant/withdrawal status and timestamps. The application preflight reads the ledger — an application without current, purpose-matched consent fails closed. Withdrawal propagates: a revoked marketing consent must stop campaigns, and a revoked processing consent routes the case to a governed exception, because a live loan cannot simply forget its borrower.\n\nThat is the tension a BA must internalise: **DPDP rights meet statutory retention**. KYC records and transaction history carry mandatory retention periods under PMLA/RBI rules; an erasure request is honoured by erasing what can be erased and placing a documented statutory hold on what cannot — with the reason disclosed to the borrower." },
        { heading: "Digital lending adds its own data rules", body: "The Digital Lending Directions layer lending-specific duties on top of DPDP: data collection by DLAs must be **need-based**, with borrower consent; no access to phone contacts, media or other invasive scopes; personal data stays on India servers (if processed abroad, it is deleted there and returned within 24 hours). Purpose limitation is enforced at the integration boundary — a document collected for KYC does not silently become a marketing asset." }
      ],
      regulatory: [
        { id: "DPDP-2023", note: "Lawful purpose, notice/consent, principal rights, breach duties." },
        { id: "DPDP-RULES-2025", note: "Operational notice/consent and breach-notification detail under a phased commencement schedule." },
        { id: "RBI-DATA-RESIDENCY", note: "Digital-lending personal data stays in India; 24-hour return rule for offshore processing." }
      ],
      platform: [
        { type: "capability", ref: "CON-001", note: "Purpose-specific notice and consent ledger." },
        { type: "capability", ref: "CON-003", note: "Consent denial, withdrawal and downstream propagation." },
        { type: "capability", ref: "CON-008", note: "Erasure request with statutory-retention hold." },
        { type: "code", ref: "packages/core/src/compliance-controls.js", note: "Consent and DPDP notice evidence checks in the application preflight." }
      ],
      terms: ["DPDP", "Cooling-off period"],
      related: ["m09-compliance/data-protection", "m02-onboarding/kyc-cdd"],
      check: [
        { q: "A borrower with a live loan demands full erasure. The correct outcome is:", options: ["Erase everything immediately", "Refuse — borrowers cannot ask", "Erase what is erasable and place a documented statutory hold on retained records, informing the borrower", "Close the loan first"], answer: 2, why: "DPDP rights operate alongside PMLA/RBI retention duties; the platform models this as erasure-with-hold, never silent refusal." },
        { q: "What makes a consent entry usable by the application preflight?", options: ["Any signed T&C", "Purpose-matched, currently granted, with notice evidence", "A verbal confirmation noted by staff", "The KYC record"], answer: 1, why: "Consent is purpose-specific and time-variant; the preflight checks the ledger for a current grant matching the processing purpose." }
      ]
    },
    {
      id: "kyc-cdd",
      title: "KYC and CDD: CKYC, V-CIP and the KYC state machine",
      duration: "22 min",
      verified: "17 Jul 2026",
      objectives: [
        "Walk the KYC/CDD pipeline: acceptance, identification, verification, risk categorisation",
        "Explain CKYC reuse, V-CIP rules and the Aadhaar storage prohibition",
        "Describe ongoing due diligence: periodic re-KYC and screening"
      ],
      sections: [
        { heading: "Know Your Customer is a pipeline, not a form", body: "The KYC Master Direction requires a **Customer Acceptance Policy**, customer identification via officially valid documents (PAN plus an OVD such as passport, driving licence, Aadhaar-derived documents), verification of those documents, and **risk categorisation** (low / medium / high) that drives everything downstream — the depth of due diligence, the re-KYC cycle and the monitoring intensity.\n\nDue diligence deepens with risk: beneficial-owner identification for entities, source-of-funds checks for high-risk profiles, PEP (politically exposed person) treatment with senior-management approval." },
        { heading: "The reuse and remote rails: CKYC and V-CIP", body: "Two rails make KYC scale:\n\n- **CKYC** — the central registry. An RE searches by identifier, downloads an existing KYC record with the customer's consent, and uploads new/updated records in the prescribed template. Reuse cuts friction, but the RE remains responsible for currency and accuracy.\n- **V-CIP** — video-based customer identification: a trained official conducts a live, geo-tagged, liveness-checked video session; the recording and logs are **stored in India** and the output is approved by an authorised official.\n\nAnd one hard boundary: **Aadhaar biometrics, OTPs and PID blocks are never stored**. Aadhaar-based authentication happens at the boundary service; only the outcome and permitted references persist. LoanOS enforces this with prohibited-storage checks — it is a test, not a guideline." },
        { heading: "KYC never finishes", body: "Verification is a state with an expiry, not a milestone. The direction requires **periodic re-KYC** on a risk-based cycle (high risk most frequently, low risk least), advance notices to customers, and ongoing screening: PEP lists, UN/UAPA sanctions, internal negative lists — with rescreening when lists refresh. Transaction monitoring feeds AML alerts, investigations and, where warranted, **STR filings to FIU-IND** — with strict tipping-off controls so the customer never learns a report was made.\n\nIn LoanOS the KYC record is a state machine: verified states carry expiry; an expired or deficient KYC blocks dependent transitions; V-CIP evidence and India-storage attributes are recorded on the record itself." }
      ],
      regulatory: [
        { id: "RBI-KYC-2016", note: "The Master Direction behind CAP, CDD, V-CIP, periodic updation, screening and FIU-IND reporting." },
        { id: "UIDAI-AADHAAR", note: "No biometric/OTP/PID persistence; authentication follows UIDAI controls." },
        { id: "CERSAI-CKYC", note: "CKYC registry operations: search, download, upload in prescribed templates." }
      ],
      platform: [
        { type: "capability", ref: "KYC-003", note: "CKYC search, download, update and upload." },
        { type: "capability", ref: "KYC-004", note: "V-CIP evidence, liveness, location and official approval." },
        { type: "capability", ref: "KYC-005", note: "Aadhaar boundary with prohibited-data controls." },
        { type: "capability", ref: "KYC-011", note: "PEP, UAPA, UN sanctions and internal negative-list screening." },
        { type: "code", ref: "packages/core/src/compliance-controls.js", note: "KYC verified-state and Aadhaar prohibited-storage checks feeding the preflight." }
      ],
      terms: ["CKYC", "V-CIP", "Aadhaar", "PAN", "FIU-IND", "STR"],
      related: ["m02-onboarding/consent-dpdp", "m02-onboarding/fraud-screening", "m09-compliance/data-protection"],
      check: [
        { q: "Which of these may LoanOS store after an Aadhaar-based authentication?", options: ["The fingerprint template, encrypted", "The OTP, hashed", "Only the authentication outcome and permitted references", "The full PID block for audit"], answer: 2, why: "UIDAI rules prohibit persisting biometrics, OTP and PID in any form; the platform records outcomes and evidence references only." },
        { q: "What does risk categorisation drive?", options: ["Only the interest rate", "Depth of due diligence, re-KYC frequency and monitoring intensity", "Branch assignment", "Nothing after onboarding"], answer: 1, why: "Low/medium/high categorisation is the dial for the whole ongoing-KYC machine, including periodic updation cycles." }
      ]
    },
    {
      id: "fraud-screening",
      title: "Application risk: fraud, identity and screening",
      duration: "15 min",
      verified: "17 Jul 2026",
      objectives: [
        "Distinguish credit risk from fraud risk at application time",
        "List the screening signals: device, velocity, synthetic identity, negative lists",
        "Explain natural justice in fraud classification"
      ],
      sections: [
        { heading: "Fraud is not bad credit", body: "A credit-risky borrower intends to repay and might fail; a fraudulent applicant never intends to repay, or is not who they claim to be. The screens differ accordingly. Application fraud controls look at:\n\n- **Identity integrity** — document tampering, face/document mismatch, synthetic identities stitched from real fragments.\n- **Behavioural signals** — device fingerprints, IP and location anomalies, application velocity (the same device applying for ten lenders in an hour).\n- **Linkage** — shared bank accounts, addresses, employers or devices across unrelated applicants; mule-account indicators; internal and external negative lists.\n\nSignals combine into a fraud score and policy decision: pass, review or decline-and-investigate." },
        { heading: "Classification carries consequences — so it carries process", body: "Formally classifying a borrower or account as **fraud** has severe downstream effects: reporting to the RBI, potential law-enforcement referral, and a long shadow on the person's financial life. The 2024 fraud-risk directions therefore require **natural justice**: a show-cause process where the person can respond before classification, four-eyes decision-making, committee oversight and documented reporting (FMR/LEA evidence).\n\nIn LoanOS fraud handling is a case workflow inside LWS — investigation, response window, committee pack, classification decision — with the audit chain preserving who decided what, on which evidence. Post-disbursement, early-warning signals keep feeding the same machinery." }
      ],
      regulatory: [
        { id: "RBI-FRAUD-2024", note: "Fraud governance, natural-justice classification, committee oversight and LEA/regulator reporting." },
        { id: "RBI-KYC-2016", note: "Screening and monitoring obligations that catch identity abuse at intake." }
      ],
      platform: [
        { type: "capability", ref: "FRD-002", note: "Device, IP, velocity, location and behavioural signals." },
        { type: "capability", ref: "FRD-008", note: "Natural-justice show-cause and response workflow." },
        { type: "capability", ref: "FRD-009", note: "Four-eyes fraud classification and committee pack." },
        { type: "guide", ref: "incident-response", note: "Operational incident guide — containment duties when fraud meets operations." }
      ],
      terms: ["Maker-checker", "LWS"],
      related: ["m07-lws/grievance-fraud-cases", "m02-onboarding/kyc-cdd"],
      check: [
        { q: "Why does fraud classification require a show-cause step?", options: ["To slow down operations", "Natural justice: the consequences are severe, so the person must be heard first", "To collect more documents", "Because insurers demand it"], answer: 1, why: "The fraud directions embed natural justice — classification without a response opportunity is procedurally invalid and reversible." }
      ]
    }
  ]
};
