# LoanOS India Complete-System Capability Catalogue

Status date: 2026-07-14

## Purpose

This document is the canonical capability catalogue for a complete India-focused lending operating system. It describes the full target surface across LOS, LMS, LWS, accounting, compliance, risk, data, security, operations, partner management, and customer experience.

It is deliberately broader than the current implementation and broader than any one loan product. It exists to prevent three recurring errors:

1. marketing a product journey that the operating system cannot actually execute;
2. treating a domain object or mock integration as a production-ready capability; and
3. overlooking bank-operational requirements such as accounting, reconciliation, reporting acknowledgements, business continuity, and supervisory evidence.

This catalogue is not a legal opinion or a claim that every capability applies to every regulated entity. Applicability must be confirmed against the institution type, product, delivery model, regulatory perimeter, and board-approved policy. Regulatory interpretation remains anchored in the [India regulatory register](../compliance/india-regulatory-register.md) and [compliance build checklist](../compliance/compliance-build-checklist.md).

## Relationship to Other Documents

| Document | Question it answers |
| --- | --- |
| This catalogue | What could a complete LoanOS need, and what is the present maturity of each capability? |
| `what-we-are-building.md` | What product are we building and for whom? |
| `current-implementation.md` | What code and runtime behavior exist today? |
| `review-findings-2026-07-12.md` | Which reviewed gaps have committed remediation IDs? |
| `build-backlog.md` | What engineering work is currently planned? |
| `roadmap.md` | In what sequence will major outcomes ship? |

The catalogue is the scope baseline. It does not replace the implementation map, backlog, or roadmap.

## Classification Model

### Current status

| Status | Meaning |
| --- | --- |
| `Implemented` | Executable behavior exists on the primary path and has focused automated coverage. |
| `Partial` | A useful first slice exists, but material workflow, control, UI, scale, or operational depth is missing. |
| `Mock` | Domain lifecycle or provider boundary exists, but the external system interaction is simulated or not certification-ready. |
| `Missing` | No meaningful executable capability exists. |
| `Partner` | Intentionally expected from an integrated specialist provider; LoanOS still needs orchestration, evidence, reconciliation, and failure handling. |
| `External` | Primarily a policy, legal, contractual, certification, or operating-process obligation supported by product evidence. |

Composite labels such as `Partial/Mock` identify a mixed capability: some internal workflow exists, while a material provider or operational leg remains simulated. Status is a repository-based product assessment, not regulatory certification or production approval.

### Maturity

| Maturity | Meaning |
| --- | --- |
| `D0 Concept` | Named requirement only. |
| `D1 Domain` | Data model or pure domain behavior exists. |
| `D2 Demo` | Demonstrable through API/UI with local or mock dependencies. |
| `D3 Pilot` | Narrow real-world product can operate with live providers and supervised manual controls. |
| `D4 Production` | Security, scale, reconciliation, observability, support, and operating controls are evidenced. |
| `D5 Bank-assured` | Customer due diligence, audits, DR, certifications, regulatory formats, and control testing are complete for the adopting RE. |

### Applicability

| Code | Meaning |
| --- | --- |
| `Core` | Required for any production LoanOS deployment. |
| `Product` | Required only for products using the capability. |
| `Channel` | Required only for the relevant acquisition or servicing channel. |
| `Institution` | Depends on RE type, scale, reporting perimeter, or operating model. |
| `Optional` | Differentiating or efficiency capability rather than a universal prerequisite. |

## Executive Current-State Summary

LoanOS currently has a strong compliance-first domain foundation and executable slices for amortising, bullet, moratorium, step-up, and revolving facilities. Its best-developed capabilities are tenant isolation, KFS and fund-flow gates, policy/evidence lineage, maker-checker, audit integrity, borrower privacy rights, model governance, deterministic decision-engine infrastructure, and finance controls.

The principal gaps before bank production are live integrations, downstream GL certification, regulatory submission formats, product-specific lending depth, repossession/auction and legal-expense depth, enterprise IAM and key management, external observability/SIEM operations, DR/BCP, and bank-assurance evidence. A bounded in-process observability slice now evaluates API SLI/SLOs and tenant provider/stuck-work health, but durable telemetry, distributed tracing, external alert delivery, on-call operations, and capacity testing remain open. Collections and legal recovery have a controlled first slice, but dialer integration, route/capacity optimization, track-specific pleadings, court integration, possession, auction, and recovery accounting remain open. Public product positioning must remain narrower than this catalogue until each advertised journey reaches an agreed maturity level.

The detailed register contains **452 individually identified capabilities**. At this snapshot, 87 are classified `Implemented`, 183 `Partial`, 155 `Missing`, and 27 are mock, partner, external, or composite-status obligations. These counts measure scope coverage, not delivery percentage: a single missing ledger, reconciliation, security, or recovery control can block production even if many smaller capabilities exist.

## Capability Index

| Domain | Target outcome | Current assessment |
| --- | --- | --- |
| Platform and tenancy | Each RE operates inside an isolated, governed tenant | Partial, strong first slice |
| RE and programme governance | Every programme has accountable RE, policy, DLA and partner boundaries | Partial |
| Product and policy | Versioned product, pricing and control configuration | Partial |
| Channels and leads | Traceable acquisition across branch, DSA, BC, digital and partner channels | Missing |
| Customer and parties | Reusable customer-360 with all obligated parties | Partial |
| Consent and privacy | Purpose-bound processing and exercisable data rights | Partial |
| KYC, AML and screening | Compliant onboarding plus ongoing monitoring | Partial/Mock |
| Fraud and identity risk | Preventive and detective fraud controls | Partial |
| Documents and verification | Complete document, OCR, verification and deficiency lifecycle | Partial |
| Underwriting and decisioning | Explainable, policy-led credit decisions | Partial, strong narrow slice |
| Collateral and security | Asset, valuation, legal, perfection and release controls | Partial/Mock |
| Offer, KFS and contracting | Transparent offer through enforceable execution | Partial |
| Disbursement | Controlled direct and reconciled fund release | Partial/Mock |
| Loan accounting and LMS | Reconstructable account plus finance-grade books | Partial; balanced subledger, controlled close, suspense and value-date slices |
| Payments and reconciliation | Complete collection-to-ledger control | Partial/Mock; controlled operations core with mock provider boundary |
| Servicing | Customer and operations servicing over the full loan life | Partial |
| Delinquency and collections | Strategy, contact, field and agency operations | Partial |
| Legal recovery and repossession | Evidence-led statutory recovery | Partial; statutory case/notice/clock first slice |
| Restructure, settlement and closure | Governed resolution and security release | Partial |
| Co-lending, DLG and partners | Contract, economics and servicing by partner leg | Partial |
| Workflow and operations | Role-aware queues, approvals and SLAs | Partial |
| Grievance and conduct | End-to-end complaint resolution and escalation | Partial |
| Regulatory reporting | Source-to-submission regulatory reporting | Partial/Mock |
| Finance, tax and treasury | GL, tax, ECL, ALM and profitability | Partial; governed accounting, tax, treasury, profitability, and co-lender attribution slices exist |
| Portfolio and enterprise risk | Concentration, vintage, EWS and risk appetite | Mostly missing |
| AI and model governance | Inventoried, validated and interruptible model use | Partial, strong first slice |
| Audit and compliance assurance | Reproducible evidence and obligation oversight | Partial |
| Security and IAM | Enterprise identity, secrets and cyber controls | Partial |
| Integration and data platform | Reliable APIs, events, data quality and lineage | Partial |
| Reliability and service operations | Observable, recoverable, supportable production service | Partial; local SLI/SLO, provider and stuck-work monitoring slice |
| User experiences | Borrower, staff, branch, partner and field journeys | Partial |
| Implementation and migration | Repeatable adoption, migration and cutover | Mostly missing |

## Detailed Capability Register

### 1. Platform, Tenancy, and SaaS Control Plane

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| PLT-001 | Tenant registry bound to one contracting regulated entity | Core | Implemented |
| PLT-002 | Pooled tenant isolation at application and database layers | Core | Implemented |
| PLT-003 | Dedicated database/data-plane deployment tier | Institution | Partial |
| PLT-004 | Per-tenant data encryption and key hierarchy | Core | Partial |
| PLT-005 | Tenant onboarding with RE, product, owner, modules, and readiness | Core | Implemented |
| PLT-006 | Sandbox environments with synthetic-data enforcement | Core | Implemented |
| PLT-007 | Tenant branding and customer-facing identity | Core | Partial |
| PLT-008 | Entitlements, subscribed modules, limits, and commercial plan controls | Core | Missing |
| PLT-009 | Tenant configuration promotion across dev/test/UAT/production | Core | Missing |
| PLT-010 | Tenant portability export and evidenced offboarding | Core | Implemented |
| PLT-011 | Data reload/import from the portability format | Core | Missing |
| PLT-012 | Platform operations console and tenant health view | Core | Partial |
| PLT-013 | Time-boxed platform break-glass access with tenant visibility | Core | Implemented |
| PLT-014 | Data-residency and processing-location policy per tenant | Core | Partial |
| PLT-015 | Tenant-level SLA, maintenance, release, and incident communications | Core | Missing |

### 2. Regulated Entity, Programme, DLA, and Policy Governance

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| REG-001 | RE legal identity, licence, category, office, and public website | Core | Implemented |
| REG-002 | Board-approved policy register with owners and effective dates | Core | Partial |
| REG-003 | Lending programme and scheme configuration beneath an RE | Core | Missing |
| REG-004 | Branch, region, business unit, and legal-entity operating hierarchy | Institution | Missing |
| REG-005 | DLA registry for RE and LSP-operated surfaces | Channel | Implemented |
| REG-006 | Public disclosure publishing for products, DLAs, LSPs, grievance, CMS, and Sachet | Channel | Partial |
| REG-007 | CCO certification workflow and evidence pack | Institution | Partial |
| REG-008 | Policy exception, waiver, and temporary dispensation governance | Core | Partial |
| REG-009 | Regulatory applicability profile by RE type and product | Institution | Missing |
| REG-010 | Compliance-obligation calendar with owner, due date, and evidence | Core | Missing |

### 3. Product, Pricing, and Policy Configuration

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| PRD-001 | Product family, borrower segment, amount, tenor, and currency | Core | Implemented |
| PRD-002 | Versioned product policy with effective dating | Core | Implemented |
| PRD-003 | Fixed, floating, flat, and reducing-balance interest configuration | Product | Partial |
| PRD-004 | Risk-based pricing and pricing matrices | Product | Missing |
| PRD-005 | APR composition and mandatory third-party charges | Core | Partial |
| PRD-006 | GST applicability, inclusive/exclusive pricing, and tax disclosure | Core | Partial |
| PRD-007 | Penal-charge policy without penal interest/capitalisation | Core | Implemented |
| PRD-008 | Cooling-off, prepayment, foreclosure, and reset policy | Core | Implemented |
| PRD-009 | Product eligibility, bureau, FOIR, and knockout configuration | Core | Partial |
| PRD-010 | Product approval, maker-checker publication, and rollback | Core | Partial |
| PRD-011 | Product simulation and golden-case regression corpus | Core | Partial |
| PRD-012 | Product authoring UI with version diff and impact analysis | Core | Missing |
| PRD-013 | Sanction validity, renewal, review, and expiry policy | Product | Missing |
| PRD-014 | Credit insurance and optional add-on governance | Product | Missing |
| PRD-015 | Product profitability and risk-adjusted return parameters | Institution | Missing |

### 4. Acquisition Channels, Leads, and CRM

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| CHN-001 | Digital self-serve application capture | Channel | Missing |
| CHN-002 | Branch-assisted application capture | Channel | Missing |
| CHN-003 | DSA, BC, connector, dealer, merchant, and LSP lead intake | Channel | Missing |
| CHN-004 | API/embedded-finance application intake | Channel | Partial |
| CHN-005 | Lead source, campaign, referral, and attribution | Optional | Missing |
| CHN-006 | Lead qualification, follow-up, conversion, and abandonment | Channel | Missing |
| CHN-007 | Duplicate-lead and existing-customer matching | Core | Missing |
| CHN-008 | Channel eligibility, geographic serviceability, and branch routing | Channel | Missing |
| CHN-009 | Partner commission and payout basis | Channel | Missing |
| CHN-010 | Channel conduct, consent, and disclosure monitoring | Channel | Partial |

### 5. Customer, Parties, and Relationship Management

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| CUS-001 | Individual and legal-entity customer profile | Core | Implemented |
| CUS-002 | Stable customer ID and relationship across applications/accounts | Core | Partial |
| CUS-003 | Customer deduplication and merge governance | Core | Missing |
| CUS-004 | Customer-360 across loans, complaints, documents, and consents | Core | Partial |
| CUS-005 | Co-applicant, co-borrower, and guarantor relationships | Product | Missing |
| CUS-006 | Household, group, JLG, and connected-party relationships | Product | Missing |
| CUS-007 | Beneficial owner, controller, and authorised signatory | Product | Partial |
| CUS-008 | Nominee, legal heir, deceased borrower, and succession workflow | Product | Missing |
| CUS-009 | Address, contact, employment, and business history | Core | Partial |
| CUS-010 | Customer risk, vulnerability, language, and accessibility preferences | Core | Missing |
| CUS-011 | Communication preferences and do-not-contact controls | Core | Partial |
| CUS-012 | Exposure aggregation across all facilities and related parties | Core | Missing |

### 6. Consent, Privacy, and Data-Principal Rights

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| CON-001 | Purpose-specific notice and consent ledger | Core | Implemented |
| CON-002 | OTP/session-bound consent verification | Channel | Implemented |
| CON-003 | Consent denial, withdrawal, and downstream propagation | Core | Partial |
| CON-004 | Third-party sharing consent and legal-obligation basis | Core | Implemented |
| CON-005 | Record of processing and recipient disclosure | Core | Partial |
| CON-006 | Data access request and portable data pack | Core | Implemented |
| CON-007 | Data correction request and approved propagation | Core | Implemented |
| CON-008 | Erasure request with statutory-retention hold | Core | Implemented |
| CON-009 | Retention schedules by data class, product, and legal basis | Core | Partial |
| CON-010 | Automated deletion, anonymisation, and legal hold | Core | Partial |
| CON-011 | Consent-preference centre for the borrower | Channel | Partial |
| CON-012 | Privacy impact assessment and significant-data-fiduciary controls | Institution | External |
| CON-013 | Child/guardian and other special-category processing controls | Product | Missing |
| CON-014 | Data-breach notification to Board and affected principals | Core | Partial |

### 7. KYC, CDD, AML, and Screening

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| KYC-001 | Customer acceptance policy checks | Core | Partial |
| KYC-002 | PAN and officially valid document capture/verification | Core | Mock |
| KYC-003 | CKYC search, download, update, and upload | Core | Partial/Mock |
| KYC-004 | V-CIP evidence, liveness, location, and official approval | Channel | Partial/Mock |
| KYC-005 | Aadhaar boundary with prohibited-data controls | Core | Implemented |
| KYC-006 | Risk categorisation and periodic-review cycle | Core | Partial |
| KYC-007 | Advance KYC-update notices and post-due reminders | Core | Missing |
| KYC-008 | Low-risk customer grace and monitored continuation | Core | Missing |
| KYC-009 | BC-assisted KYC update and acknowledgement | Channel | Missing |
| KYC-010 | Beneficial-owner threshold and control declarations | Product | Implemented |
| KYC-011 | PEP, UAPA, UN sanctions, and internal negative-list screening | Core | Partial |
| KYC-012 | Screening-list refresh, rescreening, and match disposition | Core | Missing |
| KYC-013 | Ongoing customer due diligence and risk refresh | Core | Missing |
| KYC-014 | Transaction monitoring and AML alert investigation | Institution | Missing |
| KYC-015 | STR/CTR/CCR case preparation, review, filing, and acknowledgement | Institution | Partial/Mock |
| KYC-016 | Tipping-off controls and restricted case access | Institution | Partial |
| KYC-017 | Record retention and regulator/auditor retrieval | Core | Partial |

### 8. Fraud, Identity, and Application Risk

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| FRD-001 | Application fraud flags and investigation case | Core | Partial |
| FRD-002 | Device, IP, velocity, location, and behavioral signals | Channel | Missing |
| FRD-003 | Synthetic identity and identity-link analysis | Core | Missing |
| FRD-004 | Document tamper and face/document consistency checks | Channel | Partner |
| FRD-005 | Internal/external negative lists and mule indicators | Core | Missing |
| FRD-006 | Duplicate customer, bank account, address, device, and employer detection | Core | Missing |
| FRD-007 | Fraud scorecard and policy decision | Core | Missing |
| FRD-008 | Natural-justice show-cause and response workflow | Institution | Implemented |
| FRD-009 | Four-eyes fraud classification and committee pack | Institution | Implemented |
| FRD-010 | LEA, fraud registry, and regulator reporting evidence | Institution | Partial |
| FRD-011 | Early-warning signals after disbursement | Core | Missing |
| FRD-012 | Fraud losses, recoveries, root cause, and control remediation | Institution | Missing |

### 9. Documents, OCR, and Verification

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| DOC-001 | Product- and stage-specific document checklist | Core | Missing |
| DOC-002 | Secure upload, malware scan, type/size validation, and quarantine | Core | Missing |
| DOC-003 | OCR, classification, field extraction, and confidence | Optional | Partner |
| DOC-004 | Manual verification and discrepancy resolution | Core | Missing |
| DOC-005 | Document versioning, supersession, and expiry | Core | Partial |
| DOC-006 | KYC, income, bank, property, asset, and legal document categories | Product | Partial |
| DOC-007 | Deficiency, waiver, re-request, and SLA workflow | Core | Missing |
| DOC-008 | Document access control, watermarking, and download audit | Core | Partial |
| DOC-009 | India storage, retention, checksum, and legal hold | Core | Partial |
| DOC-010 | Production PDF generation and accessible rendering | Core | Partial |
| DOC-011 | eSign envelope, signer authentication, callback, and evidence | Core | Mock |
| DOC-012 | Document vault, manifest, and borrower delivery | Core | Partial |
| DOC-013 | Original physical-document custody and movement | Product | Missing |

### 10. Credit Data, Underwriting, and Decisioning

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| UWG-001 | Bureau pull with permissible purpose and consent | Core | Mock |
| UWG-002 | Multi-bureau score bands and policy knockouts | Core | Implemented |
| UWG-003 | Bureau trade-line obligations and delinquency analysis | Core | Partial |
| UWG-004 | Enquiry, vintage, write-off, settlement, and thin-file policy | Core | Partial |
| UWG-005 | Account Aggregator consent and FI fetch | Product | Mock |
| UWG-006 | AA income and obligation analytics with provenance | Product | Partial |
| UWG-007 | Bank-statement categorisation, stability, bounce, and cash-flow analysis | Product | Missing |
| UWG-008 | GST, ITR, Udyam, employment, and business verification | Product | Missing |
| UWG-009 | EMI, FOIR, age, amount, and tenor eligibility | Core | Implemented |
| UWG-010 | Household FOIR and microfinance indebtedness | Product | Missing |
| UWG-011 | Credit scorecard, rating, grade, and risk-based pricing | Product | Missing |
| UWG-012 | Policy deviations and approval-authority matrix | Core | Partial |
| UWG-013 | Manual underwriting workspace and credit note | Core | Partial |
| UWG-014 | Coded decline and borrower explanation | Core | Partial |
| UWG-015 | Maker-checker and four-eyes approval | Core | Implemented |
| UWG-016 | Conditions precedent/subsequent and covenants | Product | Missing |
| UWG-017 | Sanction validity and material-change reassessment | Core | Missing |
| UWG-018 | Deterministic decision models with golden corpus | Core | Partial |
| UWG-019 | Decision trace, policy/data/model lineage, and replay | Core | Partial |
| UWG-020 | Champion/challenger, shadow, divergence, and cutover | Optional | Partial |

### 11. Collateral, Valuation, Legal, and Security Perfection

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| COL-001 | Collateral and asset master | Product | Partial |
| COL-002 | Property, vehicle, equipment, gold, receivable, deposit, and guarantee types | Product | Partial |
| COL-003 | Ownership, encumbrance, and eligibility checks | Product | Partial/Mock |
| COL-004 | Valuer panel, valuation order, report, review, and expiry | Product | Missing |
| COL-005 | Legal counsel panel, title/legal opinion, and exception | Product | Missing |
| COL-006 | LTV, margin, haircut, and revaluation policy | Product | Missing |
| COL-007 | Insurance requirement, policy, renewal, assignment, and claim | Product | Missing |
| COL-008 | CERSAI search, filing, registration, modification, and satisfaction | Product | Partial/Mock |
| COL-009 | ROC, RTO, land registry, depository, lien, and other perfection evidence | Product | Missing |
| COL-010 | Document custody, release approval, and borrower acknowledgement | Product | Missing |
| COL-011 | Original-document release within the required closure timeline | Product | Missing |
| COL-012 | Collateral inspection, covenant, impairment, and early-warning monitoring | Product | Missing |

### 12. Offers, KFS, Sanction, and Contracting

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| OFR-001 | Offer generation from approved product and decision | Core | Partial |
| OFR-002 | Multi-lender matching and complete offer presentation | Channel | Implemented |
| OFR-003 | Objective ranking disclosure and dark-pattern prevention | Channel | Implemented |
| OFR-004 | KFS unique proposal, validity, APR sheet, and amortisation schedule | Core | Implemented |
| OFR-005 | KFS charges, GST, cooling-off, recovery, and grievance disclosure | Core | Implemented |
| OFR-006 | KFS in a language understood by the borrower | Core | Missing |
| OFR-007 | Evidence that KFS contents were explained and understood | Core | Partial |
| OFR-008 | Borrower acceptance bound to proposal and verified identity | Core | Implemented |
| OFR-009 | Sanction letter with conditions and validity | Core | Partial |
| OFR-010 | Agreement generation, versioning, negotiation, and acceptance | Core | Partial |
| OFR-011 | Multi-party signing for co-borrowers/guarantors | Product | Missing |
| OFR-012 | Production eSign envelope and callback reconciliation | Core | Mock |
| OFR-013 | Digitally signed document delivery and proof | Core | Partial |
| OFR-014 | Cooling-off cancellation, proportionate cost, and refund | Core | Partial |

### 13. Disbursement and Fund Flow

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| DSB-001 | Disbursement-readiness checklist and blocking findings | Core | Implemented |
| DSB-002 | Verified borrower/end-beneficiary bank account | Core | Mock |
| DSB-003 | Direct fund flow without LSP/pass-through control | Core | Implemented |
| DSB-004 | Maker-checker disbursement authorization | Core | Partial |
| DSB-005 | Single full disbursement | Core | Implemented |
| DSB-006 | Multiple, tranche, stage, and construction-linked disbursement | Product | Missing |
| DSB-007 | Supplier/dealer/end-use payment and invoice linkage | Product | Missing |
| DSB-008 | Conditions-precedent satisfaction and waiver | Product | Missing |
| DSB-009 | Payment initiation, bank response, settlement, and failure repair | Core | Mock |
| DSB-010 | Disbursement cancellation, reversal, return, and refund | Core | Partial |
| DSB-011 | Co-lending escrow and partner funding confirmation | Product | Partial |
| DSB-012 | Disbursement advice and borrower communication | Core | Partial |
| DSB-013 | Post-disbursement document and end-use follow-up | Product | Missing |

### 14. Loan Account, Ledger, and Accounting

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| ACC-001 | Loan account creation from approved disbursement | Core | Implemented |
| ACC-002 | Immutable operational ledger and balance reconstruction | Core | Implemented |
| ACC-003 | Idempotent financial-event ingestion | Core | Partial |
| ACC-004 | Configurable payment-allocation waterfall | Core | Partial |
| ACC-005 | Double-entry subledger and balanced journals | Core | Partial |
| ACC-006 | Chart-of-accounts mapping and GL export/interface | Core | Partial |
| ACC-007 | EOD/BOD, business date, period close, and rerun control | Core | Partial |
| ACC-008 | Accrued, overdue, suspended, and memorandum interest | Core | Partial |
| ACC-009 | NPA income reversal and recovery recognition | Institution | Partial |
| ACC-010 | Suspense, unapplied, excess, and unidentified receipts | Core | Partial |
| ACC-011 | Value date, backdating, correction, and controlled reprocessing | Core | Partial |
| ACC-012 | Charges, waivers, reversals, GST, and audit | Core | Partial |
| ACC-013 | Accounting reconciliation by event, day, provider, and GL | Core | Partial |
| ACC-014 | Trial balance, journal report, and finance sign-off | Core | Partial |
| ACC-015 | Multi-entity and co-lender accounting legs | Product | Partial |

### 15. Repayment Schedule, Interest, and Product Structures

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| LMS-001 | Monthly reducing-balance amortisation | Core | Implemented |
| LMS-002 | Flat-rate disclosure and effective-rate equivalence | Product | Partial |
| LMS-003 | Weekly, fortnightly, quarterly, and irregular frequency | Product | Partial |
| LMS-004 | Bullet, balloon, step-up, step-down, and seasonal schedules | Product | Partial |
| LMS-005 | Moratorium, pre-EMI, EMI holiday, and capitalised interest | Product | Partial |
| LMS-006 | Broken-period interest and first/last instalment variants | Product | Missing |
| LMS-007 | Daily reducing balance and utilisation-based interest | Product | Partial |
| LMS-008 | Revolving credit, OD, cash credit, and drawdown facilities | Product | Partial |
| LMS-009 | Credit limit, available limit, minimum due, and limit review | Product | Implemented |
| LMS-010 | Holiday calendar, due-date movement, and grace days | Core | Missing |
| LMS-011 | Floating benchmark, spread, reset date, and rate history | Product | Partial |
| LMS-012 | Borrower choice on floating-rate reset | Product | Implemented |
| LMS-013 | Part-prepayment with EMI/tenure choice | Product | Implemented |
| LMS-014 | Foreclosure quote, charge policy, payoff, and closure | Core | Implemented |
| LMS-015 | Schedule versioning and borrower communication after change | Core | Partial |

### 16. Payments, Mandates, and Reconciliation

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| PAY-001 | NACH mandate setup, amendment, suspension, and cancellation | Core | Partial/Mock |
| PAY-002 | UPI AutoPay/collect, eNACH, standing instruction, and bank transfer | Channel | Mock/Partner |
| PAY-003 | Mandate presentation and due collection | Core | Partial |
| PAY-004 | Settlement file/API ingestion and provider acknowledgement | Core | Partial |
| PAY-005 | Bounce/return reason, charge, retry, and borrower notice | Core | Partial/Mock |
| PAY-006 | Bank statement and virtual-account reconciliation | Core | Partial |
| PAY-007 | Partial, advance, excess, and unidentified payment handling | Core | Partial |
| PAY-008 | Refund, failed disbursement return, and cooling-off refund | Core | Partial |
| PAY-009 | Cash, cheque, DD, branch, and field receipt controls | Channel | Partial |
| PAY-010 | Same-day cash recovery posting | Channel | Implemented |
| PAY-011 | Duplicate-payment protection and idempotency | Core | Implemented |
| PAY-012 | Payment allocation, reversal, chargeback, and dispute | Core | Partial |
| PAY-013 | Daily provider-to-bank-to-ledger reconciliation | Core | Partial |
| PAY-014 | Reconciliation break queue, ageing, approval, and write-off | Core | Partial |
| PAY-015 | Payment data residency, masking, and tokenisation | Core | Partial |

### 17. Customer and Account Servicing

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| SRV-001 | Account summary, balance, next due, and repayment schedule | Core | Implemented |
| SRV-002 | Periodic and on-demand statements | Core | Implemented |
| SRV-003 | Payment receipts and transaction history | Core | Partial |
| SRV-004 | Contact, address, bank, mandate, and profile change request | Core | Partial |
| SRV-005 | Due-date, EMI, tenure, and repayment-mode change | Product | Missing |
| SRV-006 | Interest certificate, foreclosure letter, and tax documents | Product | Missing |
| SRV-007 | Rate-reset notice, options, consent, and revised schedule | Product | Partial |
| SRV-008 | Service request catalogue, SLA, fulfilment, and communication | Core | Partial |
| SRV-009 | Hardship request and assistance intake | Core | Partial |
| SRV-010 | Borrower self-service payment and mandate management | Channel | Missing |
| SRV-011 | Authorized representative and deceased-borrower servicing | Product | Missing |
| SRV-012 | Customer communication history and delivery evidence | Core | Partial |
| SRV-013 | Multilingual templates and preferred-language delivery | Core | Missing |

### 18. Delinquency, Collections, and Field Operations

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| CLL-001 | DPD, overdue amount, bucket, and delinquency status | Core | Implemented |
| CLL-002 | Collection strategy by product, risk, bucket, and customer | Core | Missing |
| CLL-003 | Treatment plans, next-best action, and channel sequencing | Core | Missing |
| CLL-004 | Reminder and notice logging with contact-hours guard | Core | Partial |
| CLL-005 | Telecalling/dialer campaign and call disposition | Channel | Partial |
| CLL-006 | Promise-to-pay, kept/broken PTP, and follow-up | Core | Implemented |
| CLL-007 | Recovery-agent registry, due diligence, and authorization | Core | Implemented |
| CLL-008 | Borrower notice before agent assignment/contact | Core | Implemented |
| CLL-009 | Agency, portfolio, geography, capacity, and performance allocation | Channel | Missing |
| CLL-010 | Field mobile app, visit, geo/time evidence, and receipt | Channel | Partial |
| CLL-011 | Cash exception approval and same-day account posting | Channel | Implemented |
| CLL-012 | Conduct complaints, call recording, QA, and agent suspension | Core | Partial |
| CLL-013 | Collection fees and LSP/agency settlement controls | Channel | Missing |
| CLL-014 | Collection analytics, roll rates, cure, and liquidation | Core | Missing |
| CLL-015 | Vulnerable-customer and hardship treatment | Core | Partial |

### 19. Legal Recovery, Repossession, and Enforcement

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| REC-001 | Legal-recovery case and strategy selection | Product | Implemented |
| REC-002 | SARFAESI demand notice and statutory clock | Product | Implemented |
| REC-003 | Possession, publication, valuation, and sale process | Product | Missing |
| REC-004 | Section 138 cheque-bounce notice and case | Product | Implemented |
| REC-005 | Arbitration, Lok Adalat, DRT, civil suit, and insolvency tracks | Product | Partial |
| REC-006 | Advocate panel, assignment, hearing, order, and expense | Product | Partial |
| REC-007 | Repossession authorization, inventory, yard, and release | Product | Missing |
| REC-008 | Auction reserve, bids, sale, proceeds, and shortfall | Product | Missing |
| REC-009 | Legal notice/document generation and delivery evidence | Product | Implemented |
| REC-010 | Settlement during legal action and case withdrawal | Product | Partial |
| REC-011 | Limitation dates, next hearing, SLA, and escalation | Product | Partial |
| REC-012 | Recovery proceeds and legal expense accounting | Product | Missing |

### 20. Restructuring, Settlement, Write-off, and Closure

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| CLS-001 | Hardship assessment and restructure proposal | Core | Partial |
| CLS-002 | Four-eyes restructure approval and re-amortisation | Core | Implemented |
| CLS-003 | Regulatory classification and reporting consequence | Institution | Partial |
| CLS-004 | OTS/settlement proposal, sacrifice, policy, and authority matrix | Core | Partial |
| CLS-005 | Settlement payment tracking and shortfall waiver | Core | Implemented |
| CLS-006 | Technical write-off while retaining legal dues | Institution | Implemented |
| CLS-007 | Recovery after write-off and accounting allocation | Institution | Missing |
| CLS-008 | Closure on scheduled repayment, foreclosure, or settlement | Core | Implemented |
| CLS-009 | NOC/no-dues certificate | Core | Implemented |
| CLS-010 | Original-document and collateral release workflow | Product | Missing |
| CLS-011 | CERSAI/registry satisfaction and closure evidence | Product | Partial/Mock |
| CLS-012 | CIC closure update and borrower confirmation | Core | Partial/Mock |
| CLS-013 | Closure SLA, delay compensation, and grievance linkage | Product | Missing |

### 21. Co-lending, DLG, LSP, and Partner Economics

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| PAR-001 | LSP agreement, role, due diligence, review, data, and fee controls | Channel | Implemented |
| PAR-002 | LSP incident, breach, remediation, suspension, and exit | Channel | Missing |
| PAR-003 | DLG provider eligibility, form, cap, tenor, and invocation | Product | Implemented |
| PAR-004 | DLG exposure, replenishment, recovery, disclosure, and accounting | Product | Partial |
| PAR-005 | Co-lending agreement, roles, shares, retention, rate, and escrow | Product | Implemented |
| PAR-006 | Loan-level allocation and share reconciliation | Product | Implemented |
| PAR-007 | Partner funding, disbursement, and settlement confirmation | Product | Partial |
| PAR-008 | Partner principal, interest, fee, tax, and provision ledger legs | Product | Implemented |
| PAR-009 | Collection and recovery allocation by partner share | Product | Partial |
| PAR-010 | Partner reconciliation, break management, and statements | Product | Partial |
| PAR-011 | Servicing transfer, portfolio sale, assignment, and participation | Product | Missing |
| PAR-012 | Partner SLA, performance, concentration, and audit | Channel | Missing |
| PAR-013 | DSA/BC/dealer/merchant commission and clawback | Channel | Missing |

### 22. Workflow, Maker-Checker, and Operations

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| LWS-001 | Derived queues by domain state and exception | Core | Implemented |
| LWS-002 | Task SLA, priority, due time, and breach status | Core | Implemented |
| LWS-003 | Role/queue visibility and server-side action authorization | Core | Implemented |
| LWS-004 | Assignment, start, release, comment, and audit | Core | Implemented |
| LWS-005 | Configurable workflow and state-machine designer | Core | Missing |
| LWS-006 | Configurable approval matrix by amount, product, risk, and deviation | Core | Missing |
| LWS-007 | Maker-checker/four-eyes policy library | Core | Partial |
| LWS-008 | Escalation, delegation, substitution, leave, and workload balancing | Core | Missing |
| LWS-009 | Bulk action with limits, approval, and audit | Optional | Missing |
| LWS-010 | Queue dashboards, ageing, throughput, and productivity | Core | Partial |
| LWS-011 | Case timeline combining data, decisions, documents, and communications | Core | Partial |
| LWS-012 | Committee agenda, circulation, decision, minutes, and conditions | Institution | Partial |
| LWS-013 | Operational exception taxonomy and root-cause reporting | Core | Missing |
| LWS-014 | Business-calendar and SLA pause/resume policy | Core | Missing |

### 23. Grievance, Conduct, and Customer Protection

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| GRV-001 | Complaint intake from portal, branch, phone, email, LSP, and post | Core | Partial |
| GRV-002 | Immediate acknowledgement and reference | Core | Implemented |
| GRV-003 | Categorisation, assignment, investigation, and resolution | Core | Implemented |
| GRV-004 | 30-day clock and overdue escalation | Core | Implemented |
| GRV-005 | Borrower dissatisfaction/rejection and RBI CMS eligibility | Core | Partial |
| GRV-006 | RBI CMS link, submission, acknowledgement, and order tracking | Core | Partial/Mock |
| GRV-007 | Root cause, corrective action, restitution, and compensation | Core | Missing |
| GRV-008 | LSP/DLA/recovery-agent conduct attribution | Channel | Partial |
| GRV-009 | Vulnerable customer, language, accessibility, and assisted complaint | Core | Missing |
| GRV-010 | Complaint analytics, repeat issues, product/channel trends, and board reporting | Institution | Missing |
| GRV-011 | Ombudsman award/compliance and closure evidence | Institution | Missing |

### 24. Regulatory and External Reporting

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| RPT-001 | Reporting data lineage from source transaction to submitted field | Core | Partial |
| RPT-002 | DLA CIMS export and CCO certification | Channel | Partial |
| RPT-003 | CIC consumer/commercial Uniform Credit Reporting Format | Institution | Partial |
| RPT-004 | Fortnightly CIC schedule, acknowledgement, rejects, repair, and resubmission | Institution | Implemented |
| RPT-005 | CIC dispute/correction and borrower communication | Institution | Partial |
| RPT-006 | CKYCRR production upload/download format and acknowledgement | Institution | Partial |
| RPT-007 | FIU FINnet 2.0 STR/CTR/CCR XML and acknowledgement | Institution | Partial |
| RPT-008 | CERSAI production payload, payment, response, and certificate | Product | Partial |
| RPT-009 | CRILC/SMA and large-exposure reporting | Institution | Missing |
| RPT-010 | XBRL/CIMS statutory returns | Institution | Missing |
| RPT-011 | PSL classification and reporting | Institution | Missing |
| RPT-012 | Fraud, wilful-default, LEA, and board reporting | Institution | Partial |
| RPT-013 | Regulatory calendar, maker-checker, filing, and evidence vault | Institution | Missing |
| RPT-014 | Submission reconciliation and amendment history | Institution | Missing |

### 25. Finance, Tax, Treasury, and Profitability

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| FIN-001 | Product/account accounting rules and GL mapping | Core | Partial |
| FIN-002 | Interest, fee, penal charge, waiver, and recovery income accounting | Core | Partial |
| FIN-003 | GST calculation, invoice, credit note, and return data | Institution | Partial |
| FIN-004 | TDS and other applicable tax treatment | Institution | Partial |
| FIN-005 | Ind AS effective-interest and fee amortisation | Institution | Partial |
| FIN-006 | ECL/provisioning stages, parameters, overlays, and journals | Institution | Partial |
| FIN-007 | RBI IRAC provision and income-recognition support | Institution | Partial |
| FIN-008 | ALM cash-flow buckets, liquidity, and interest-rate risk | Institution | Partial |
| FIN-009 | Funding source, facility, borrowing, and cost-of-funds attribution | Institution | Partial |
| FIN-010 | Product, branch, channel, partner, and customer profitability | Institution | Partial |
| FIN-011 | RAROC, margin, yield, cost, and loss analytics | Institution | Partial |
| FIN-012 | Finance close, reconciliation certification, and audit schedules | Institution | Partial |

### 26. Portfolio, Credit, Market, and Operational Risk

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| RSK-001 | Portfolio exposure by product, segment, geography, channel, and partner | Core | Missing |
| RSK-002 | Vintage, roll-rate, cure, loss, and recovery analysis | Core | Missing |
| RSK-003 | Concentration limits and risk-appetite thresholds | Institution | Missing |
| RSK-004 | Connected-counterparty and aggregate borrower exposure | Institution | Missing |
| RSK-005 | Early-warning signals and watchlist | Core | Missing |
| RSK-006 | Stress testing and scenario analysis | Institution | Missing |
| RSK-007 | Credit policy monitoring and override/deviation trends | Core | Partial |
| RSK-008 | Fraud, operational, conduct, vendor, and cyber risk events | Institution | Partial |
| RSK-009 | RCSA, controls, KRIs, issues, actions, and loss events | Institution | Missing |
| RSK-010 | Portfolio limits, breach workflow, approval, and remediation | Institution | Missing |
| RSK-011 | Board/risk committee dashboard and evidence pack | Institution | Missing |

### 27. AI, Model Risk, and Decision Governance

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| AIG-001 | Inventory of scorecards, ML, vendor, spreadsheet, and GenAI models | Core | Partial |
| AIG-002 | Owner, use case, version, materiality, and risk tier | Core | Implemented |
| AIG-003 | Development, validation, approval, activation, suspension, and retirement | Core | Implemented |
| AIG-004 | Independent-validation and four-eyes gate | Core | Implemented |
| AIG-005 | Fairness, explainability, performance, and monitoring evidence | Core | Partial |
| AIG-006 | GenAI red-team, hallucination, security, and misuse testing | Product | Partial |
| AIG-007 | Drift observation, threshold, alert, and automatic suspension | Core | Implemented |
| AIG-008 | Global, model, workflow, and use-case kill switches | Core | Partial |
| AIG-009 | Runtime model-use gate with purpose and borrower-impact evidence | Core | Implemented |
| AIG-010 | Human review, customer disclosure, and human handoff | Product | Implemented |
| AIG-011 | Incident, affected decisions, containment, and post-incident review | Core | Partial |
| AIG-012 | Recurring fairness/performance reports and cohort monitoring | Core | Missing |
| AIG-013 | Model change, rollback, challenger, and clean-shadow window | Core | Partial |
| AIG-014 | Decision reason lineage from the actual deciding authority | Core | Partial |
| AIG-015 | Deterministic replay and audit reproduction | Core | Partial |

### 28. Audit, Compliance Assurance, and Evidence

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| AUD-001 | Tenant-scoped append-only hash-chained audit events | Core | Implemented |
| AUD-002 | Uniform actor, role, data class, policy, and consent provenance | Core | Partial |
| AUD-003 | Integrity verification and filtered evidence export | Core | Implemented |
| AUD-004 | External timestamp/anchor or WORM retention | Core | Missing |
| AUD-005 | Business-event completeness reconciliation | Core | Missing |
| AUD-006 | Regulatory control library and implementation anchors | Core | Implemented |
| AUD-007 | Compliance testing plan, sample, result, issue, and remediation | Institution | Missing |
| AUD-008 | Obligation owner, evidence, certification, and sign-off | Institution | Missing |
| AUD-009 | Internal audit, statutory audit, and RBI inspection workspace | Institution | Missing |
| AUD-010 | Board/committee pack generation beyond fraud cases | Institution | Missing |
| AUD-011 | Record-retention, legal hold, purge, and proof of deletion | Core | Partial |
| AUD-012 | Policy-to-control-to-test-to-evidence traceability | Core | Partial |

### 29. Identity, Security, and Cyber Controls

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| SEC-001 | Local human authentication and secure password hashing | Core | Implemented |
| SEC-002 | Enterprise OIDC/SAML federation and tenant IdP policy | Core | Missing |
| SEC-003 | SCIM provisioning/deprovisioning and group mapping | Core | Missing |
| SEC-004 | Enforced MFA, step-up authentication, and recovery | Core | Partial |
| SEC-005 | Fine-grained RBAC/ABAC and separation-of-duty policy | Core | Partial |
| SEC-006 | Privileged access management and just-in-time elevation | Core | Partial |
| SEC-007 | Named, scoped, expiring, and independently rotatable service credentials | Core | Implemented |
| SEC-008 | KMS/HSM-backed key custody, rotation, and destruction | Core | Partial |
| SEC-009 | Encryption in transit, at rest, field/object level, and backup | Core | Partial |
| SEC-010 | Secrets management and credential-leak response | Core | Partial |
| SEC-011 | CSRF, CSP, session, rate-limit, lockout, and abuse controls | Core | Partial |
| SEC-012 | Secure SDLC, SAST, DAST, dependency, container, and IaC scanning | Core | Missing |
| SEC-013 | SBOM, vulnerability SLA, patching, and exception governance | Core | Missing |
| SEC-014 | SIEM, SOC, threat detection, investigation, and evidence | Core | Missing |
| SEC-015 | Penetration test, red team, remediation, and retest | Core | External |
| SEC-016 | CERT-In log retention and trusted time synchronization | Core | Partial |
| SEC-017 | ISO 27001, SOC 2, and RE-specific assurance | Institution | External |

### 30. Integrations, APIs, Events, and Data Platform

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| INT-001 | Versioned REST API and consistent error contract | Core | Partial |
| INT-002 | Tenant authentication, scopes, idempotency, and rate limits | Core | Partial |
| INT-003 | Webhooks/events with signing, retries, ordering, and replay | Core | Missing |
| INT-004 | Provider adapter boundary and India-residency guard | Core | Implemented |
| INT-005 | Provider health, timeout, retry, circuit breaker, and fail-closed policy | Core | Partial |
| INT-006 | Callback correlation, acknowledgement, and reconciliation | Core | Partial |
| INT-007 | API catalogue, OpenAPI, examples, SDK, and sandbox | Core | Missing |
| INT-008 | Core banking, GL, CRM, DMS, data warehouse, and identity connectors | Institution | Missing |
| INT-009 | Bureau, AA, CKYC, V-CIP, eSign, bank verify, payment, comms, CERSAI, and FIU providers | Product | Mock |
| INT-010 | Event schema registry, lineage, backward compatibility, and deprecation | Core | Missing |
| INT-011 | Operational and analytical data models separated by purpose | Core | Missing |
| INT-012 | Data-quality rules, profiling, exception queue, and certification | Core | Missing |
| INT-013 | Warehouse/lake exports, CDC, and regulatory data marts | Institution | Missing |
| INT-014 | Master/reference-data governance | Core | Missing |

### 31. Reliability, Observability, DR, and Service Operations

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| OPS-001 | Production deployment topology and India hosting | Core | Partial |
| OPS-002 | Horizontal scale, stateless API, background workers, and schedulers | Core | Partial |
| OPS-003 | Database HA, backup, PITR, restore, and corruption drills | Core | Missing |
| OPS-004 | Multi-AZ/region DR, RTO/RPO, failover, and failback | Core | Missing |
| OPS-005 | BCP runbook and business/technology recovery exercises | Core | External |
| OPS-006 | Metrics, logs, traces, dashboards, and alerting | Core | Partial |
| OPS-007 | SLI/SLO, uptime, latency, error budget, and capacity | Core | Partial |
| OPS-008 | Queue/batch/provider monitoring and stuck-work detection | Core | Partial |
| OPS-009 | Incident command, severity, status communication, and postmortem | Core | Partial |
| OPS-010 | CERT-In/RBI/DPDP notification clocks | Core | Implemented |
| OPS-011 | Release management, canary, rollback, and change approval | Core | Missing |
| OPS-012 | Configuration drift, environment parity, and audit | Core | Missing |
| OPS-013 | Performance, soak, concurrency, volume, and resilience tests | Core | Missing |
| OPS-014 | Support desk, runbooks, on-call, escalation, and problem management | Core | Missing |
| OPS-015 | Vendor SLA and dependency concentration monitoring | Core | Missing |

### 32. Borrower, Staff, Branch, Partner, and Field Experiences

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| UX-001 | Public platform and trust/product information | Optional | Partial |
| UX-002 | RE-branded DLA/tenant landing surface | Channel | Partial |
| UX-003 | Borrower application and onboarding journey | Channel | Missing |
| UX-004 | Borrower portal for application status and next action | Channel | Implemented |
| UX-005 | Borrower KFS, document, agreement, and signature journey | Channel | Partial |
| UX-006 | Borrower repayment, statement, payment, mandate, and receipt journey | Channel | Partial |
| UX-007 | Borrower complaint and privacy-rights journey | Channel | Implemented |
| UX-008 | Underwriter case desktop with financial, bureau, policy, deviations, and note | Core | Partial |
| UX-009 | Operations/disbursement task workspace | Core | Partial |
| UX-010 | Servicing account desktop and service-request workspace | Core | Missing |
| UX-011 | Collections/telecalling desktop and field mobile app | Channel | Missing |
| UX-012 | Compliance, CCO, risk, finance, and audit dashboards | Institution | Missing |
| UX-013 | Platform/tenant administration | Core | Partial |
| UX-014 | Branch, DSA, BC, dealer, merchant, LSP, and partner portals | Channel | Missing |
| UX-015 | Multilingual Indian-language content and templates | Core | Missing |
| UX-016 | Accessibility testing, assisted journeys, and reduced-motion support | Core | Partial |
| UX-017 | Mobile/PWA/offline capability | Channel | Missing |

### 33. Implementation, Migration, and Customer Adoption

| ID | Capability | Applicability | Status |
| --- | --- | --- | --- |
| IMP-001 | Product discovery and target-operating-model assessment | Core | External |
| IMP-002 | Regulatory applicability and control-mapping workshop | Core | External |
| IMP-003 | Configuration workbook and approval | Core | Missing |
| IMP-004 | Source-data inventory, mapping, cleansing, and reconciliation | Core | Missing |
| IMP-005 | Customer, application, loan, ledger, document, and audit migration | Core | Missing |
| IMP-006 | Opening-balance and historical-schedule validation | Core | Missing |
| IMP-007 | Mock conversion, dress rehearsal, cutover, and rollback | Core | Missing |
| IMP-008 | Parallel run and finance/regulatory reconciliation | Institution | Missing |
| IMP-009 | UAT packs by product, role, exception, and regulatory control | Core | Partial |
| IMP-010 | Training, role certification, SOPs, and operating manuals | Core | Missing |
| IMP-011 | Go-live readiness, hypercare, issue triage, and exit criteria | Core | Missing |
| IMP-012 | Tenant due-diligence pack, audit rights, contracts, and certifications | Core | External |
| IMP-013 | Data exit, transition support, and independent deletion assurance | Core | Partial |

## Product-Specific Capability Packs

The complete-system catalogue must be filtered into a product pack before a product is advertised or committed. Each pack inherits all applicable `Core` capabilities and adds its specific requirements.

### Unsecured personal term loan

- Individual KYC, bureau, affordability, KFS, direct disbursement, monthly servicing, payment reconciliation, CIC reporting, complaints, collections, and closure.
- This is the closest current LoanOS capability to a coherent end-to-end product.

### MSME term loan

- Legal entity/sole proprietor, beneficial owners, GST/ITR/Udyam, bank/AA cash flow, business bureau, guarantors, collateral where applicable, end-use evidence, and commercial CIC reporting.
- Current economic-profile and AA slices are insufficient for production MSME underwriting.

### Working capital, overdraft, and cash credit

- Limits, drawing power, stock/book-debt statements, drawdowns, utilisation interest, renewals, ad-hoc limits, covenants, current-account flows, and non-amortising servicing.
- A governed first slice now supports separately typed revolving/OD products, KFS limit and daily-interest disclosures, sanctioned limit versus drawing power, maker-checker drawdowns and reviews, daily utilised-balance interest, repayments that restore availability, minimum due, statements, and balanced accounting. Stock/book-debt statements, formula-driven drawing power, covenants, ad-hoc limits, current-account sweeps, expiry renewal/recall, and cash-credit-specific operations remain missing.

### Home loan and loan against property

- Property/legal/technical workflow, valuation, LTV, multiple tranches, construction stages, pre-EMI, insurance, title/custody, CERSAI, original-document release, and long-tenor rate resets.
- Current generic secured-loan/CERSAI objects are not a complete home-loan product.

### Vehicle and equipment finance

- Dealer/supplier workflow, invoice/end-use disbursement, asset/RTO or equipment identification, insurance, inspection, repossession, yard, valuation, and auction.

### Gold loan

- Assaying, purity/net-weight valuation, LTV monitoring, dual-control custody, packet/barcode, branch vault, auction notices, auction execution, surplus refund, and collateral release.
- Entire specialist workflow is currently missing.

### Education loan

- Student/co-borrower, institution/course verification, academic milestones, moratorium, staged disbursement, overseas remittance where applicable, and employment/repayment transition.

### Microfinance and JLG

- Household income, aggregate household indebtedness, 50% repayment cap, group/JLG, field sourcing, centre meetings, weekly/fortnightly schedules, conduct, and field collections.
- Current individual FOIR and monthly schedule do not satisfy this product shape.

### Agriculture and allied finance

- Land/crop/activity, seasonality, scale of finance, KCC/limits, crop cycle, interest subvention, insurance, warehouse/market linkage, and seasonal repayment.

### Supply-chain and invoice finance

- Anchor, buyer/supplier, programme limits, invoices/POs, acceptance, dilution, concentration, assignment, settlement waterfall, disputes, and TReDS/ERP integration.

### Co-lending

- Arrangement, allocation, escrow, partner funding, borrower disclosure, partner-level ledger economics, collections allocation, reconciliation, reporting, and servicing transfer.
- Arrangement validation exists; production servicing economics do not.

## Governance Rules for Using This Catalogue

1. A product may be marketed as `supported` only when its product pack has no unresolved `Core` or product-mandatory capability below the agreed maturity threshold.
2. `Implemented` is not synonymous with `D4 Production`; live dependencies, operations, reconciliation, and assurance must be assessed separately.
3. Every capability promoted to `Implemented` must link to code, API, UI where applicable, tests, operating procedure, and control evidence.
4. Mock-provider behavior must remain visibly classified as `Mock` until production credentials, certification, callbacks, reconciliation, failure handling, and support arrangements are verified.
5. Product-specific capabilities must be policy data and configuration where feasible; new product rules must not become scattered route-level conditionals.
6. Regulatory changes update the regulatory register first, then the affected capability rows, acceptance criteria, backlog, tests, and product packs.
7. A quarterly product council should review catalogue status with Product, Credit, Operations, Compliance, Risk, Finance, Security, and Technology owners.
8. The public website and sales material must be checked against this catalogue before release.

## Definition of Complete for a Capability

A capability is complete only when all applicable evidence exists:

- approved business and regulatory requirements;
- domain model and policy configuration;
- API/service behavior and failure semantics;
- human-usable workflow and UI where manual action is required;
- maker-checker, role, audit, retention, and data-residency controls;
- live integration, callback, acknowledgement, and reconciliation where external systems are involved;
- unit, integration, behavioral, security, and operational tests proportionate to risk;
- monitoring, alerting, runbook, support ownership, and recovery procedure;
- migration and backward-compatibility treatment;
- customer, finance, regulatory, and audit outputs;
- updated implementation map, compliance checklist, backlog, and release notes.

## Next Maintenance Step

Convert this baseline into a machine-trackable register with one row per capability carrying:

- owner;
- target product packs;
- mandatory/optional decision;
- current maturity and target maturity;
- regulatory control IDs;
- evidence links;
- dependencies;
- acceptance criteria;
- target release; and
- last review date.

Until that register exists, this Markdown document is the authoritative complete-system scope checklist.
