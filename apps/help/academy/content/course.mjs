// BA Lending Academy — course index and glossary.
// Content contract: docs/product/ba-lending-academy-curriculum.md
// Pages are rendered by scripts/build-academy.mjs; edit content here, never the HTML.
import m01 from "./m01-landscape.mjs";
import m02 from "./m02-onboarding.mjs";
import m03 from "./m03-underwriting.mjs";
import m04 from "./m04-kfs-sanction.mjs";
import m05 from "./m05-lms.mjs";
import m06 from "./m06-collections.mjs";
import m07 from "./m07-lws.mjs";
import m08 from "./m08-partners.mjs";
import m09 from "./m09-compliance.mjs";
import m10 from "./m10-capstone.mjs";
import m11 from "./m11-journeys.mjs";
import mProductCustomer from "./m10-product-customer.mjs";
import mLendingTerms from "./m11-lending-terms.mjs";
import mCollateral from "./m12-collateral.mjs";
import mBaPractice from "./m13-ba-practice.mjs";

export const course = {
  id: "ba-lending-academy",
  title: "BA Lending Academy",
  subtitle: "Indian lending end to end — LOS, LMS, LWS, collections and the compliance control plane, taught through LoanOS.",
  audience: "Business analysts, implementation consultants and product managers working on LoanOS or a regulated-entity programme.",
  verified: "17 Jul 2026",
  disclaimer: "Educational content, not legal advice. Regulatory statements summarise the control families in the India regulatory register and must be verified with compliance and counsel before reliance. A capability citation reflects catalogue status, not production readiness.",
  modules: [m01, m02, m03, m04, m05, m06, m07, m08, m09, mProductCustomer, mLendingTerms, mCollateral, mBaPractice, m11, m10]
};

// Course glossary. Lessons reference these terms by exact name; the generator
// links each mention to /help/academy/glossary.html. Regulatory meanings track
// docs/gtm/glossary.md and docs/compliance/india-regulatory-register.md.
export const glossary = [
  { term: "LoanOS India", def: "India-only, multi-tenant SaaS lending operating system for RBI-regulated entities." },
  { term: "LOS", def: "Loan Origination System — customer onboarding through sanction and disbursement readiness." },
  { term: "LMS", def: "Loan Management System — the live loan account: ledger, repayment, servicing, collections, closure." },
  { term: "LWS", def: "Loan Workflow System — routes human and operational work: maker-checker, exceptions, grievance, fraud." },
  { term: "Compliance OS", def: "The control plane: regulatory catalog, policy registry, DLA/LSP registries, consent ledger, model governance." },
  { term: "Decision engine", def: "Per-tenant, fail-closed, byte-replayable Rust engine that evaluates lending policy and AI guardrails and enforces the kill switch." },
  { term: "Tenant", def: "One contracting regulated entity; all of its data lives inside a hard-isolated boundary." },
  { term: "Policy bundle", def: "Content-hashed, four-eyes-approved, signed package of lending and guardrail policy that the decision engine evaluates." },
  { term: "Kill switch", def: "Control that instantly blocks a model (model-scoped or global); affected decisions degrade to human review, fail closed." },
  { term: "Audit hash chain", def: "Per-tenant, append-only SHA-256 chain sealing every state change; tamper-evident and verifiable." },
  { term: "Evidence pack", def: "Integrity-attested export of a tenant's audit evidence for an authorised request." },
  { term: "Sandbox", def: "Evaluation environment enforcing synthetic-only borrowers and mock integrations." },
  { term: "Maker-checker", def: "Four-eyes control: the person who prepares an action cannot be the person who approves it." },
  { term: "Digital worker", def: "A governed, proposal-only AI agent installed per tenant with pinned model, prompt, knowledge and action scope." },
  { term: "RE", def: "Regulated Entity — bank, small finance bank, payments bank, co-operative bank, NBFC, HFC or All-India Financial Institution accountable to the RBI." },
  { term: "RBI", def: "Reserve Bank of India — the banking regulator; issues the directions this course keeps citing." },
  { term: "DLD 2025", def: "Reserve Bank of India (Digital Lending) Directions, 2025 — the current source of truth for digital lending conduct." },
  { term: "KFS", def: "Key Facts Statement — mandatory pre-contract disclosure of APR, fees, penal charges, cooling-off and grievance path." },
  { term: "LSP", def: "Lending Service Provider — a partner acting for the RE; must stay inside the RE's accountability boundary." },
  { term: "DLA", def: "Digital Lending App/website (RE- or LSP-owned); reportable to the RBI in CIMS-ready form." },
  { term: "CIMS", def: "RBI's Centralised Information Management System — the reporting channel for DLAs and statutory returns." },
  { term: "DLG", def: "Default Loss Guarantee — capped loss cover (5% of the portfolio) from an eligible LSP, with a 120-day invocation window." },
  { term: "Co-lending", def: "Arrangement where regulated entities jointly fund a loan: shares sum to 100%, an originating-RE retention floor applies, the borrower sees one blended rate, funds move through escrow." },
  { term: "FPC", def: "Fair Practices Code — conduct rules for lenders, including recovery contact-hours limits enforced in collections." },
  { term: "V-CIP", def: "Video-based Customer Identification Process; recordings and logs must be stored in India." },
  { term: "CKYC", def: "Central KYC registry (CKYCRR) — reusable KYC records searched, downloaded and uploaded by REs." },
  { term: "CERSAI", def: "Central registry for security interests (SARFAESI); secured lending registers and satisfies charges here." },
  { term: "FIU-IND", def: "Financial Intelligence Unit – India; receives STR/CTR/CCR filings through the FINnet gateway." },
  { term: "STR", def: "Suspicious Transaction Report filed with FIU-IND when AML monitoring finds reportable behaviour." },
  { term: "DPD", def: "Days Past Due — how many days the oldest unpaid amount has been overdue; drives buckets and classification." },
  { term: "SMA", def: "Special Mention Account — pre-NPA stress signal: SMA-0 (1–30 days), SMA-1 (31–60), SMA-2 (61–90)." },
  { term: "NPA", def: "Non-Performing Asset — an account overdue beyond 90 days; triggers income-recognition reversal and provisioning." },
  { term: "IRACP", def: "RBI's Income Recognition, Asset Classification and Provisioning norms — the rulebook behind SMA/NPA treatment." },
  { term: "CIC", def: "Credit Information Company (credit bureau) — receives fortnightly loan performance data in the UCRF format." },
  { term: "UCRF", def: "Uniform Credit Reporting Format — the consumer/commercial/MFI reporting annex under the 2025 CIC directions." },
  { term: "AA", def: "Account Aggregator — RBI-licensed consent-based rail for sharing a customer's financial information with the lender." },
  { term: "DPDP", def: "Digital Personal Data Protection Act, 2023 — consent, notice, access, correction and erasure duties for personal data." },
  { term: "CERT-In", def: "India's computer emergency response team; qualifying cyber incidents must be reported within 6 hours." },
  { term: "Cooling-off period", def: "Board-approved window after a digital loan is disbursed during which the borrower may exit by paying principal and proportionate charges." },
  { term: "Penal charges", def: "Charges for contract breach. RBI requires them to be reasonable, disclosed upfront and never capitalised — penal interest is prohibited." },
  { term: "APR", def: "Annual Percentage Rate — the all-inclusive cost of the loan expressed as a rate, disclosed in the KFS." },
  { term: "EMI", def: "Equated Monthly Instalment — the level payment that amortises principal and interest over the tenor." },
  { term: "Amortisation", def: "The schedule by which each instalment splits into interest (on the outstanding balance) and principal." },
  { term: "FOIR", def: "Fixed Obligation to Income Ratio — share of income already committed to EMIs; a core affordability test." },
  { term: "Moratorium", def: "A sanctioned pause in repayment (full or interest-only) at the start of, or during, a loan." },
  { term: "Foreclosure", def: "Early full repayment that closes the loan before the scheduled end of tenor." },
  { term: "Restructuring", def: "Changing sanctioned terms (tenor, rate, schedule) for a borrower in difficulty; carries classification consequences." },
  { term: "OTS", def: "One-Time Settlement — accepting less than full dues to close an account, under a policy and authority matrix." },
  { term: "Write-off", def: "Removing dues from the earning book (often 'technical' write-off) while retaining the legal right to recover." },
  { term: "NOC", def: "No Objection / no-dues certificate issued to the borrower at closure." },
  { term: "PTP", def: "Promise to Pay — a dated repayment commitment captured during collections, tracked as kept or broken." },
  { term: "NACH", def: "National Automated Clearing House — mandate-based auto-debit rail commonly used for EMI collection." },
  { term: "UPI AutoPay", def: "UPI-based recurring debit mandate; an alternative EMI collection rail." },
  { term: "SARFAESI", def: "Act letting secured lenders enforce collateral (60-day demand notice, possession, sale) without a court decree." },
  { term: "Section 138", def: "Negotiable Instruments Act provision criminalising cheque dishonour; a common recovery lever." },
  { term: "Lok Adalat", def: "Statutory conciliation forum used to settle smaller recovery disputes." },
  { term: "DRT", def: "Debts Recovery Tribunal — adjudicates larger secured-recovery actions." },
  { term: "Grievance officer", def: "Named officer accountable for complaint resolution inside the RBI's 30-day window." },
  { term: "RBI CMS", def: "RBI's Complaint Management System — where unresolved borrower complaints escalate to the Ombudsman." },
  { term: "PAN", def: "Permanent Account Number — the tax identifier verified during KYC." },
  { term: "Aadhaar", def: "India's biometric identity number. Biometrics, OTP and PID artefacts must never be stored by the platform." },
  { term: "MITC", def: "Most Important Terms and Conditions — borrower-facing summary of contract terms." },
  { term: "Sanction letter", def: "The lender's formal offer recording approved amount, terms and conditions, with a validity window." },
  { term: "Conditions precedent", def: "Conditions that must be satisfied (or formally waived) before disbursement; open ones block funds." },
  { term: "DSA", def: "Direct Selling Agent — a sourcing channel whose conduct and payouts the RE must govern." },
  { term: "Escrow", def: "A neutral account through which co-lending funds must flow — no single-partner pass-through." },
  { term: "GST", def: "Goods and Services Tax — applies to fees and charges; must be disclosed and accounted correctly." },
  { term: "CAM", def: "Credit Assessment Memo — the underwriter's structured case note supporting a credit decision." }
];
