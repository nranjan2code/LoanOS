/**
 * The regulatory control register: the canonical, in-code list of the Indian
 * lending regulations this platform is built to satisfy (RBI digital lending
 * directions, KFS, KYC, DPDP, Aadhaar, CERSAI/CKYC, dark-patterns rules,
 * etc). Each entry names the regulator, the source instrument, and the
 * concrete obligations it imposes — this is what other compliance checks
 * cite by `id` (e.g. "RBI-DL-2025") when a `finding` needs to point at *why*
 * something is blocked, not just that it is.
 *
 * This is documentation-as-data: the definitive human-and-regulator-facing
 * list lives in `docs/compliance/india-regulatory-register.md`
 * (see AGENTS.md's "load-bearing documents" table) — keep the two in sync
 * when a control is added, amended, or its status changes (e.g.
 * "draft" -> "final").
 */
export const REGULATORY_CONTROLS = [
  {
    id: "RBI-DL-2025",
    regulator: "RBI",
    title: "Reserve Bank of India (Digital Lending) Directions, 2025",
    status: "final",
    sourceUrl: "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12848&Mode=0",
    obligations: [
      "Digital lending by an RE involving an LSP must be governed by a clear contract.",
      "RE remains responsible for LSP and DLA acts and omissions.",
      "Borrower creditworthiness must be assessed using economic profile data.",
      "KFS and key disclosures must be provided before execution.",
      "Funds must move directly between borrower/end-beneficiary and RE except permitted cases.",
      "Borrower consent, data minimization, data residency, and deletion rights must be supported.",
      "DLAs must be reported to RBI CIMS and disclosed on the RE website."
    ]
  },
  {
    id: "RBI-KFS-2024",
    regulator: "RBI",
    title: "Key Facts Statement for Loans and Advances",
    status: "final",
    sourceUrl: "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12663&Mode=0",
    obligations: [
      "KFS must be provided before execution.",
      "APR and all fees/charges forming borrower cost must be disclosed.",
      "Cooling-off period for digital loans must be at least one day.",
      "Fees not disclosed in KFS cannot be charged later."
    ]
  },
  {
    id: "RBI-DLA-CIMS",
    regulator: "RBI",
    title: "Digital Lending App reporting to CIMS",
    status: "final",
    sourceUrl: "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12848&Mode=0",
    obligations: [
      "REs must report their own DLAs and LSP-operated DLAs through the RBI CIMS portal.",
      "Reported DLA data must identify the DLA, owner, availability surface, link, grievance officer contact, and RE website.",
      "The CCO or a designated compliance officer must certify DLA data and compliance with RBI digital lending directions."
    ]
  },
  {
    id: "RBI-DATA-RESIDENCY",
    regulator: "RBI",
    title: "Digital lending data residency",
    status: "final",
    sourceUrl: "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12848&Mode=0",
    obligations: [
      "Digital lending data must be stored on servers located in India.",
      "Data processed outside India must be brought back to India and deleted outside India within 24 hours.",
      "REs remain responsible for data privacy and security of borrower personal information."
    ]
  },
  {
    id: "RBI-KYC-2016",
    regulator: "RBI",
    title: "Master Direction - Know Your Customer (KYC) Direction, 2016",
    status: "final",
    sourceUrl: "https://www.rbi.org.in/commonman/english/scripts/notification.aspx?id=2607",
    obligations: [
      "Customer acceptance, CDD, risk categorization, record management, and reporting support are required.",
      "V-CIP data and recordings must be stored in systems located in India.",
      "Technology outsourcing for V-CIP must comply with relevant RBI guidelines."
    ]
  },
  {
    id: "RBI-FPC-PENAL",
    regulator: "RBI",
    title: "Fair Lending Practice - Penal Charges in Loan Accounts",
    status: "final",
    sourceUrl: "https://www.rbi.org.in/commonperson/english/scripts/FAQs.aspx?Id=3558",
    obligations: [
      "Penalties for non-compliance with material terms must be levied only as penal charges, not penal interest.",
      "Penal charges must be reasonable, non-discriminatory, and not capitalized.",
      "Quantum and reason for penal charges must be disclosed upfront in KFS/MITC/loan agreement."
    ]
  },
  {
    id: "RBI-IT-GRC",
    regulator: "RBI",
    title: "Master Direction on Information Technology Governance, Risk, Controls and Assurance Practices",
    status: "final",
    sourceUrl: "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12562",
    obligations: [
      "Critical data transfers require secure straight-through processing and audit trails.",
      "Access must be need-based, documented, approved, logged, and reviewed.",
      "DC and DR controls must be implemented and geographically separated."
    ]
  },
  {
    id: "RBI-OUTSOURCE",
    regulator: "RBI",
    title: "Directions on Managing Risks and Code of Conduct in Outsourcing of Financial Services by NBFCs",
    status: "final",
    sourceUrl: "https://www.rbi.org.in/commonman/english/scripts/Notification.aspx?Id=2646",
    obligations: [
      "Outsourcing must not weaken RE controls, conduct, supervision, or reputation.",
      "Core management functions and loan sanction decision-making cannot be outsourced.",
      "Outsourced financial-services providers need risk oversight, due diligence, access rights, and exit controls."
    ]
  },
  {
    id: "RBI-FRAUD-2024",
    regulator: "RBI",
    title: "Master Directions on Fraud Risk Management in Regulated Entities, 2024",
    status: "final",
    sourceUrl: "https://www.rbi.org.in/commonman/english/scripts/FAQs.aspx?Id=3763",
    obligations: [
      "Fraud governance and committee review thresholds must be board-defined.",
      "Frauds of INR 100000 or more must be reported to law enforcement agencies.",
      "Fraud classification workflows must support principles of natural justice where applicable."
    ]
  },
  {
    id: "RBI-MRM-DRAFT-2026",
    regulator: "RBI",
    title: "Draft Guidance on Regulatory Principles for Model Risk Management, 2026",
    status: "draft",
    sourceUrl: "https://rbidocs.rbi.org.in/rdocs/Content/PDFs/DRAFTGUIDANCE24062026FF12A4FF7BC84E8887009D5C5365F8BF.PDF",
    obligations: [
      "Maintain an inventory for models used by the RE, including third-party and AI/ML models.",
      "Validate models independently and monitor them across the lifecycle.",
      "Use human oversight for material decisions and customer-impacting AI.",
      "Provide override, suspension, or deactivation controls for harmful or unsafe model behavior."
    ]
  },
  {
    id: "FREE-AI-2025",
    regulator: "RBI committee",
    title: "Framework for Responsible and Ethical Enablement of Artificial Intelligence in the Financial Sector",
    status: "committee-report",
    sourceUrl: "https://rbidocs.rbi.org.in/rdocs/PublicationReport/Pdfs/FREEAIR130820250A24FF2D4578453F824C72ED9F5D5851.PDF",
    obligations: [
      "AI should augment human decision-making and defer to human judgement and citizen interest.",
      "AI systems should be fair, accountable, explainable, safe, resilient, and sustainable.",
      "AI systems need red-teaming, BCP coverage, cybersecurity controls, and incident reporting."
    ]
  },
  {
    id: "DPDP-2023",
    regulator: "MeitY",
    title: "Digital Personal Data Protection Act, 2023",
    status: "act",
    sourceUrl: "https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf",
    obligations: [
      "Process digital personal data for lawful purposes.",
      "Provide notice and collect consent where consent is the basis.",
      "Support data principal rights, security safeguards, and breach response."
    ]
  },
  {
    id: "DPDP-RULES-2025",
    regulator: "MeitY",
    title: "Digital Personal Data Protection Rules, 2025",
    status: "rules",
    sourceUrl: "https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025",
    obligations: [
      "Operationalize notice, consent, consent-manager, breach, and Data Protection Board workflows.",
      "Track phased commencement for applicable rules."
    ]
  },
  {
    id: "UIDAI-AADHAAR",
    regulator: "UIDAI",
    title: "Aadhaar authentication and e-KYC storage constraints",
    status: "final",
    sourceUrl: "https://uidai.gov.in/en/ecosystem/authentication-devices-documents.html",
    obligations: [
      "Biometric and OTP data captured for Aadhaar authentication must not be stored on permanent storage or database.",
      "PID blocks must be encrypted during capture and not sent in clear over a network.",
      "Aadhaar data use must stay within authorized purpose and consent boundaries."
    ]
  },
  {
    id: "CERSAI-CKYC",
    regulator: "CERSAI",
    title: "Central KYC Record Registry and Security Interest Registry",
    status: "operational",
    sourceUrl: "https://www.cersai.org.in/CERSAI/aboutus.prg",
    obligations: [
      "Use CKYC for reusable customer KYC records where applicable.",
      "Use CERSAI security-interest registry for secured lending workflows where applicable."
    ]
  },
  {
    id: "RBI-PAY-DATA",
    regulator: "RBI",
    title: "Storage of Payment System Data",
    status: "final",
    sourceUrl: "https://www.rbi.org.in/commonperson/english/scripts/FAQs.aspx?Id=2995",
    obligations: [
      "Payment-system data operated by payment system providers must be stored only in India."
    ]
  },
  {
    id: "CCPA-DARK-PATTERNS",
    regulator: "CCPA",
    title: "Guidelines for Prevention and Regulation of Dark Patterns, 2023",
    status: "final",
    sourceUrl: "https://consumeraffairs.nic.in/sites/default/files/Dark_Patterns_Guidelines_2023.pdf",
    obligations: [
      "LSP/DLA multi-lender offer marketplaces must be neutral and unbiased.",
      "Multi-lender loan comparisons must explicitly describe the criteria used for ranking and sorting offers.",
      "Pre-selected lender options, pre-checked add-on services, deceptive urgency, and commercial bias are prohibited dark patterns.",
      "All active partner lenders must be disclosed, and any unmatched partner must be transparently displayed."
    ]
  }
];

/**
 * @returns {Array<object>} a shallow-copied list of every registered control,
 *   safe for callers to filter/map without mutating the register.
 */
export function listRegulatoryControls() {
  return REGULATORY_CONTROLS.map((control) => ({ ...control }));
}

/**
 * @param {string} id - a control id, e.g. "RBI-DL-2025".
 * @returns {object|null} the matching control, or null if unknown.
 */
export function getRegulatoryControl(id) {
  return REGULATORY_CONTROLS.find((control) => control.id === id) ?? null;
}

/**
 * Build one compliance finding tying a message back to the control it
 * violates. Callers (KYC, KFS, loan policy, etc. checks) use this as the
 * uniform finding shape so findings from unrelated checks can be merged and
 * summarized together via `summarizeFindings`.
 * @param {"error"|"warning"} severity - "error" blocks; "warning" needs review.
 * @param {string} controlId - id from `REGULATORY_CONTROLS`.
 * @param {string} message - human-readable description of the violation.
 * @param {string|null} [path] - optional pointer to the offending field/record.
 * @returns {{severity: string, controlId: string, message: string, path: string|null}}
 */
export function createFinding(severity, controlId, message, path = null) {
  return {
    severity,
    controlId,
    message,
    path
  };
}

/**
 * Roll a list of findings up into a single verdict: any error blocks
 * ("blocked"), else any warning needs a human look ("review"), else clean
 * ("ready"). This fail-closed ordering means a single error always wins over
 * any number of warnings.
 * @param {Array<{severity: string}>} findings
 * @returns {{status: "blocked"|"review"|"ready", errorCount: number, warningCount: number}}
 */
export function summarizeFindings(findings) {
  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");

  if (errors.length > 0) {
    return {
      status: "blocked",
      errorCount: errors.length,
      warningCount: warnings.length
    };
  }

  if (warnings.length > 0) {
    return {
      status: "review",
      errorCount: 0,
      warningCount: warnings.length
    };
  }

  return {
    status: "ready",
    errorCount: 0,
    warningCount: 0
  };
}
