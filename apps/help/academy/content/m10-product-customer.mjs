const C = (ref, note) => ({ type: "capability", ref, note });
const R = (id, note) => ({ id, note });
const Q = (q, options, answer, why) => ({ q, options, answer, why });

export default {
  id: "m10-product-customer",
  title: "Product, pricing, parties and documents",
  tagline: "Turn a product idea into governed terms, a complete party model and decision-grade evidence.",
  summary: "A BA must design more than a happy-path application form. This module covers product hierarchy and versioning, price construction, party relationships, document lifecycles and communication obligations—the reusable domain model beneath every lending journey.",
  lessons: [
    {
      id: "product-architecture", title: "Product architecture, schemes and policy versions", duration: "22 min", verified: "17 Jul 2026",
      objectives: ["Separate product, scheme, programme and policy version", "Define effective dating and in-flight treatment", "Write rollback-safe product requirements"],
      sections: [
        { heading: "Four objects that should not collapse", body: "A **product family** describes the economic form—term loan, revolving facility, invoice finance. A programme binds the participating RE, channel and commercial arrangement. A scheme narrows segment, geography or campaign. A policy version owns executable eligibility, pricing and authority rules. Treating these as one configuration blob makes audit, reuse and change impact impossible.\n\nThe application stores references to the versions it actually used. Later edits must not silently rewrite an earlier decision." },
        { heading: "Effective dating and the in-flight book", body: "Every publication needs draft, review, approval, effective-from and retirement states. The BA must specify which milestone freezes each term: lead creation, application submission, decision, sanction or disbursement. A rate change may apply to new applications while a compliance correction may require controlled migration.\n\nThe safe default is no implicit migration. Impact analysis identifies affected applications and a maker-checker action records any re-price, re-decision or grandfathering." },
        { heading: "Acceptance cases", body: "Cover future-dated activation, overlapping versions, expired sanctions, rollback after applications exist, and a replay using the original bundle. A product screen is incomplete until the same rules are proven at API and decision-engine boundaries." }
      ],
      regulatory: [R("RBI-IT-GRC", "Governed change, traceability and controlled processing apply to product configuration."), R("RBI-KFS-2024", "The active product and price must resolve to the terms disclosed in the KFS.")],
      platform: [C("PRD-001", "Product family and segment definition."), C("PRD-002", "Effective-dated product policy."), C("PRD-010", "Maker-checker publication and rollback."), C("PRD-011", "Golden-case product simulation.")],
      terms: ["Policy bundle", "Maker-checker", "Decision engine"], related: ["m03-underwriting/policy-as-data", "m13-ba-practice/change-rollout"],
      check: [Q("A policy is edited after an application was approved. What should replay use?", ["The newest policy", "The exact version referenced by the original decision", "A manually reconstructed rule", "Whichever produces the same answer"], 1, "Replay and lineage require the exact effective policy used at decision time.")]
    },
    {
      id: "pricing-economics", title: "Pricing, APR, charges, tax and profitability", duration: "24 min", verified: "17 Jul 2026",
      objectives: ["Decompose borrower price and lender economics", "Reconcile APR, fees, GST and schedule cash flows", "Specify risk-based pricing without hidden discretion"],
      sections: [
        { heading: "The borrower price", body: "Nominal interest is only one component. Processing fees, mandatory third-party charges, GST, insurance and timing of cash flows affect the amount received and total amount paid. **APR** is the comparable all-in annualised cost disclosed through the KFS; its inputs must come from governed product and fee registries, not from free text." },
        { heading: "Pricing is a decision", body: "A pricing matrix can use risk grade, amount, tenor, channel or collateral band, but each input needs provenance and each adjustment needs an authority rule. Dealer subvention and partner commission are commercial legs; they cannot be hidden as borrower charges. Penal charges are separate, reasonable, disclosed and never capitalised." },
        { heading: "Economics and reconciliation", body: "The BA should trace one example from approved rate through APR sheet, amortisation, accounting entries, tax, partner payout and portfolio yield. Test boundary tiers, waived fees, refunds, cooling-off exits and rounding at every cash-flow boundary." }
      ],
      regulatory: [R("RBI-KFS-2024", "APR and all borrower charges must be disclosed consistently."), R("RBI-FPC-PENAL", "Penal charges cannot become penal interest or be capitalised.")],
      platform: [C("PRD-003", "Interest-method configuration."), C("PRD-004", "Risk-based pricing matrices."), C("PRD-005", "APR composition."), C("PRD-006", "GST treatment."), C("PRD-015", "Risk-adjusted product economics.")],
      terms: ["APR", "GST", "Penal charges", "Amortisation"], related: ["m04-kfs-sanction/kfs", "m05-lms/schedules-interest"],
      check: [Q("A mandatory valuation fee is deducted before disbursement. Where does it belong?", ["Outside the loan cost", "In the governed charge set and APR cash flows", "Only in accounting", "Only in the agreement appendix"], 1, "Mandatory charges affecting borrower cash flows belong in the KFS/APR computation and downstream accounting.")]
    },
    {
      id: "party-model", title: "Customers, households, businesses and related parties", duration: "24 min", verified: "17 Jul 2026",
      objectives: ["Model a customer separately from roles in a facility", "Represent households, groups and business control", "Aggregate exposure without unsafe record merging"],
      sections: [
        { heading: "A person is not an application", body: "The stable customer record represents an individual or legal entity across time. An application assigns roles—applicant, co-applicant, guarantor, beneficial owner, signatory—and a facility assigns obligors and security providers. Keeping identity separate from role prevents duplicate KYC, broken exposure and contradictory communication preferences." },
        { heading: "Relationships change risk", body: "Household membership drives microfinance indebtedness and FOIR. Business ownership and control drive beneficial-owner KYC and connected exposure. Group/JLG membership creates joint-liability evidence. Guarantors and co-borrowers require their own consent, documents, affordability treatment and signing journey." },
        { heading: "Identity resolution with governance", body: "Matching may use PAN, CKYC, phone, address or device, but a similarity is not permission to merge. Specify candidate-match review, survivorship of fields, retained aliases, audit history and rollback. Deceased-borrower, legal-heir and nominee flows must preserve both privacy and servicing continuity." }
      ],
      regulatory: [R("RBI-KYC-2016", "CDD includes legal entities, beneficial ownership, risk categorisation and ongoing review."), R("DPDP-2023", "Party data and relationship processing require purpose, minimisation and rights handling.")],
      platform: [C("CUS-001", "Individual and legal-entity customer profile."), C("CUS-003", "Deduplication and merge governance."), C("CUS-005", "Co-applicant, co-borrower and guarantor relationships."), C("CUS-006", "Household, group and JLG relationships."), C("CUS-007", "Beneficial owners and controllers."), C("CUS-008", "Succession workflows."), C("CUS-012", "Exposure aggregation.")],
      terms: ["KFS", "FOIR", "CKYC"], related: ["m02-onboarding/kyc-cdd", "journeys/microfinance-group-lending"],
      check: [Q("Two customer records share an address and device. What is the safe action?", ["Merge automatically", "Create a governed match candidate and retain evidence", "Delete the newer record", "Ignore the match"], 1, "Signals support review; they do not prove identity or authorise an irreversible merge.")]
    },
    {
      id: "document-lifecycle", title: "Documents, verification and evidence custody", duration: "23 min", verified: "17 Jul 2026",
      objectives: ["Design stage-specific document requirements", "Separate extraction, verification and approval", "Specify custody, expiry and legal-hold behaviour"],
      sections: [
        { heading: "A checklist is conditional", body: "Document requirements depend on product, party role, employment type, security and lifecycle stage. Each item needs allowed type, issuer, recency, mandatory/conditional rule and waiver authority. A missing or expired item becomes a deficiency task; it should not disappear behind a generic completeness percentage." },
        { heading: "OCR is not verification", body: "Upload, malware scan and quarantine precede use. OCR produces extracted values plus confidence and provenance. Verification compares those values with authoritative evidence and records discrepancies. A human may resolve or waive within authority, but the original, every version and the disposition remain linked." },
        { heading: "Custody survives the decision", body: "The vault records checksum, access, download, retention, legal hold and borrower delivery. Physical originals need movement, custodian and release acknowledgement. Expiry can trigger servicing covenants; closure can trigger time-bound release of property documents and CERSAI satisfaction." }
      ],
      regulatory: [R("RBI-KYC-2016", "KYC evidence requires controlled capture, verification and retrieval."), R("RBI-IT-GRC", "Security, access evidence and audit trails apply to the document estate.")],
      platform: [C("DOC-001", "Conditional document checklists."), C("DOC-002", "Secure upload and quarantine."), C("DOC-003", "OCR with confidence."), C("DOC-004", "Verification and discrepancy resolution."), C("DOC-005", "Version and expiry."), C("DOC-008", "Access and download audit."), C("DOC-013", "Physical-document custody.")],
      terms: ["Evidence pack", "CERSAI", "Conditions precedent"], related: ["m04-kfs-sanction/sanction-contracting", "m12-collateral/security-perfection"],
      check: [Q("OCR reads an income value with 98% confidence. Is it verified?", ["Yes", "No; extraction confidence and business verification are separate states", "Only for repeat borrowers", "Only below a threshold"], 1, "OCR confidence describes extraction, not authenticity, currency or policy acceptance.")]
    },
    {
      id: "communications-accessibility", title: "Borrower communications, language and accessibility", duration: "20 min", verified: "17 Jul 2026",
      objectives: ["Build an event-to-communication matrix", "Handle preference, legal notice and delivery evidence", "Design for language, vulnerability and accessibility"],
      sections: [
        { heading: "Every event has a communication contract", body: "Submission, KFS, sanction, disbursement, due date, failed payment, delinquency, rate reset, complaint and closure each need audience, channel, template version, timing, language and delivery evidence. The triggering business event—not an operator's memory—should create the communication." },
        { heading: "Preference is not the only legal basis", body: "Marketing opt-out must propagate. Servicing notices may still be required under contract or law. Requirements must distinguish purpose and legal basis, apply do-not-contact windows, avoid leaking sensitive debt information, and define retries and alternate channels without duplicate harassment." },
        { heading: "Comprehension is a control", body: "Record preferred language and accessibility need; provide the KFS and material notices in an understood language; make digital documents accessible; and preserve evidence of explanation where required. Vulnerable customers may need assisted service, never reduced disclosure or coerced consent." }
      ],
      regulatory: [R("RBI-DL-2025", "Digital lending conduct requires clear borrower disclosures and communications."), R("DPDP-2023", "Purpose and preference govern personal-data communication."), R("RBI-KFS-2024", "KFS delivery and comprehension are controlled evidence.")],
      platform: [C("CUS-010", "Vulnerability, language and accessibility preferences."), C("CUS-011", "Communication and do-not-contact controls."), C("SRV-013", "Multilingual templates and preferred-language delivery."), C("UX-015", "Accessible multilingual experience.")],
      terms: ["KFS", "DPDP", "Grievance officer"], related: ["m07-lws/grievance-fraud-cases", "m06-collections/collections-operations"],
      check: [Q("A borrower opts out of marketing. Can the lender send a statutory rate-reset notice?", ["No communication is allowed", "Yes, under the servicing/legal purpose with correct controls", "Only by phone", "Only after fresh marketing consent"], 1, "Purpose-specific preference separates marketing from required servicing communications.")]
    }
  ]
};
