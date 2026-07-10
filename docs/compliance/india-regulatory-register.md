# India Regulatory Register

This register is the first compliance spine for LoanOS India. It is not legal advice. It is a product and engineering control map that must be reviewed by counsel, compliance, risk, security, and the regulated entity before production use.

Date of research baseline: 2026-07-08.

## Control Families

| ID | Control family | Why it matters | Implementation anchor |
| --- | --- | --- | --- |
| RBI-DL-2025 | Digital lending conduct | Governs digital lending by banks, co-operative banks, NBFCs including HFCs, and All-India Financial Institutions. | `packages/core/src/compliance-controls.js`, loan application preflight, KFS issuance, fund-flow gates |
| RBI-KFS-2024 | Key Facts Statement | Requires standardized disclosure of APR, fees, charges, recovery, cooling-off, grievance, and other key terms before execution. | `buildKeyFactStatement`, `validateKfsBeforeDecision` |
| RBI-KYC-2016 | KYC, AML, CFT, V-CIP, recordkeeping | Requires customer acceptance, risk management, CDD, FIU-IND reporting support, record management, and India-hosted V-CIP data. | KYC state machine, CKYC/CERSAI integration, V-CIP evidence vault |
| RBI-FPC-PENAL | Fair lending and penal charges | Penal charges must be reasonable, non-discriminatory, not capitalized, and disclosed upfront in KFS/MITC/loan agreement. | KFS fee registry, penal-charge policy engine |
| RBI-FUND-FLOW | Direct fund flow | LSP/DLA cannot control disbursement/repayment flows except limited allowed cases. | Disbursement and collection account validator |
| RBI-DATA-RESIDENCY | Digital lending data residency | Personal data must be stored on India servers; if processed outside India, it must be deleted outside India and brought back within 24 hours. | Data location policy, vendor routing, event evidence |
| RBI-DLA-CIMS | Digital lending app reporting | REs must report own and LSP DLAs on RBI CIMS and maintain public disclosures. | DLA registry, CIMS export, CCO certification workflow |
| RBI-LSP-DLG | LSP and default loss guarantee | LSP due diligence, multiple-lender offer neutrality, DLG eligibility, 5% portfolio cap, permitted forms, 120-day invocation window, disclosure, and NPA-classification duty retained by the RE. | LSP registry, offer marketplace policy, `packages/core/src/dlg.js` DLG module |
| RBI-CLA-2025 | Co-lending arrangements | Two or more REs jointly originate and fund a loan under a prior agreement, with disclosed funding shares summing to 100%, an originating-RE retention floor, a single blended borrower rate, and escrow-routed funds (no single-partner pass-through). | `packages/core/src/co-lending.js` co-lending module |
| RBI-AA-2016 | Account Aggregator | Consent-based sharing of a customer's financial information from an FIP to the RE (FIU) via an RBI-licensed Account Aggregator, governed by a consent artefact (purpose, FI types, fetch type, validity, data-life) with India data residency. | `packages/core/src/account-aggregator.js` AA consent module |
| RBI-OUTSOURCE | Outsourcing of financial services | Outsourcing does not dilute RE responsibility. Certain core management and decision functions cannot be outsourced. | Vendor contracts, risk review, audit rights, exit plan |
| RBI-IT-OUTSOURCE-2023 | Outsourcing of IT services | LoanOS delivered as SaaS makes us the RE's IT service provider: REs must obtain due diligence, audit/inspection rights (including RBI access), incident notification supporting the RE's 6-hour RBI reporting window, BCP/DR assurance, sub-outsourcing control, and a documented exit plan. | SaaS tenancy and operating model, due-diligence pack, incident notification workflow, exit/portability export |
| CERT-IN-2022 | CERT-In cyber incident directions | As an Indian service provider, LoanOS itself must report qualifying cyber incidents to CERT-In within 6 hours, retain logs for 180 days in India, and synchronize clocks to NIC/NPL NTP. | Incident response workflow, log retention policy, infrastructure time sync |
| RBI-IT-GRC | IT governance, risk, controls, assurance | Requires IT governance, straight-through processing controls, access controls, audit trails, security, DC/DR controls. | IAM, STP event checks, audit log, BCP/DR module |
| RBI-FRAUD-2024 | Fraud risk management | Requires fraud governance, reporting, LEA workflows, natural justice in fraud classification. | Fraud case workflow, committee pack, FMR/LEA evidence |
| RBI-MRM-DRAFT-2026 | Model risk management and AI kill switch | Draft guidance indicates broad model inventory, validation, human oversight, customer-facing AI safeguards, and kill-switch/override controls. | AI model registry, kill switch, model use guard |
| FREE-AI-2025 | Responsible and ethical AI | RBI committee report recommends trust, people-first AI, fairness, accountability, explainability, resilience, red-teaming, incident reporting. | AI governance policy, model tests, incident process |
| DPDP-2023 | Digital personal data protection | Digital personal data processing needs lawful purpose, notice/consent where applicable, principal rights, breach response, fiduciary duties. | Consent ledger, data minimization, retention/deletion workflow |
| DPDP-RULES-2025 | DPDP implementation rules | Operationalizes notice, consent manager, breach notice, Data Protection Board, phased commencement. | Consent UX/API, breach workflow, DPBI reporting evidence |
| UIDAI-AADHAAR | Aadhaar/e-KYC constraints | Aadhaar biometrics/OTP/PID must not be stored on permanent storage; authentication must follow UIDAI controls. | Aadhaar connector boundaries, no biometric persistence test |
| CERSAI-CKYC | CKYC and security interest registries | CKYC supports reusable KYC records; CERSAI security interest registry matters for secured lending. | CKYC fetch/upload, SI registration/satisfaction workflows |
| RBI-PAY-DATA | Payment-system data storage | Payment system data must be stored only in India for payment system providers. | Payment vendor eligibility, payment log residency |
| CCPA-DARK-PATTERNS | Dark pattern prevention | Loan offer comparison must not use deceptive patterns; RBI Digital Lending Directions reference dark pattern rules for LSP multi-lender views. | Offer ranking disclosure, UI audit checklist |

## Source Baseline

- RBI, `Reserve Bank of India (Digital Lending) Directions, 2025`, May 8, 2025: https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12848&Mode=0
- RBI, `Key Facts Statement (KFS) for Loans and Advances`, April 15, 2024: https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12663&Mode=0
- RBI, `Master Direction - Know Your Customer (KYC) Direction, 2016`, updated August 14, 2025: https://www.rbi.org.in/commonman/english/scripts/notification.aspx?id=2607
- RBI, `Fair Lending Practice - Penal Charges in Loan Accounts` FAQ, January 15, 2024: https://www.rbi.org.in/commonperson/english/scripts/FAQs.aspx?Id=3558
- RBI, `Reset of Floating Interest Rate on Equated Monthly Instalments (EMI) based Personal Loans` FAQ, updated October 1, 2025: https://www.rbi.org.in/commonman/english/scripts/FAQs.aspx?Id=3687
- RBI, `Master Direction on Information Technology Governance, Risk, Controls and Assurance Practices`, 2023: https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12562
- RBI, `Directions on Managing Risks and Code of Conduct in Outsourcing of Financial Services by NBFCs`, November 9, 2017: https://www.rbi.org.in/commonman/english/scripts/Notification.aspx?Id=2646
- RBI, `Master Direction on Outsourcing of Information Technology Services` (RBI/2023-24/102), April 10, 2023: https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12486
- CERT-In, `Directions under sub-section (6) of section 70B of the Information Technology Act, 2000 relating to information security practices`, April 28, 2022: https://www.cert-in.org.in/Directions70B.jsp
- RBI, `FAQs on Master Directions on Fraud Risk Management in Regulated Entities, 2024`, April 22, 2025: https://www.rbi.org.in/commonman/english/scripts/FAQs.aspx?Id=3763
- RBI, `Storage of Payment System Data` FAQ, June 26, 2019: https://www.rbi.org.in/commonperson/english/scripts/FAQs.aspx?Id=2995
- RBI official PDF URL found for draft `Guidance on Regulatory Principles for Model Risk Management`, June 24, 2026, public consultation: https://rbidocs.rbi.org.in/rdocs/Content/PDFs/DRAFTGUIDANCE24062026FF12A4FF7BC84E8887009D5C5365F8BF.PDF
- RBI official PDF URL found for `FREE-AI` committee report, August 13, 2025: https://rbidocs.rbi.org.in/rdocs/PublicationReport/Pdfs/FREEAIR130820250A24FF2D4578453F824C72ED9F5D5851.PDF
- MeitY, `The Digital Personal Data Protection Act, 2023`: https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf
- MeitY, `Digital Personal Data Protection Rules, 2025`: https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025
- UIDAI, `Authentication Devices and Documents`: https://uidai.gov.in/en/ecosystem/authentication-devices-documents.html
- UIDAI, `Security in UIDAI system`: https://uidai.gov.in/en/my-aadhaar/about-your-aadhaar/security-in-uidai-system.html
- CERSAI, `About Us`: https://www.cersai.org.in/CERSAI/aboutus.prg

## Design Implications

1. The system must be built around a regulated entity tenant. LSP/DLA and vendor actions are still the RE's responsibility.
2. KFS is not a PDF afterthought. It is a pre-contract data object that gates sanction and disbursement.
3. Fund-flow design must reject any LSP/pass-through account involvement unless a specific RBI-permitted exception is coded and evidenced.
4. India-only data residency is not just hosting. Each data class needs storage location, processing location, retention, deletion, and breach response metadata.
5. Aadhaar/e-KYC integrations must be boundary services. No biometric, OTP, or PID persistence is allowed in LoanOS storage.
6. Every AI/ML model, including vendor models and spreadsheets that materially affect decisions, must be inventoried and governed.
7. AI kill switch is a product control, not an ops script. It must block runtime calls, record reason/actor/time, and route affected cases to human workflow.
8. Offer marketplaces for multiple lenders must be neutral, explain ranking, expose unmatched lenders where required, and avoid dark patterns.
9. LMS events must produce statements and borrower communications for rate resets, charges, recovery-agent assignment, and grievance escalation.
10. LWS must preserve approvals, exceptions, committee decisions, audit evidence, and customer notices.
11. LoanOS as a SaaS vendor is itself inside the regulatory perimeter: RE customers can only buy the platform if it satisfies their IT-outsourcing obligations (due diligence, audit rights, incident notification, BCP/DR, exit plan), and LoanOS carries direct CERT-In and DPDP-processor duties. See the SaaS tenancy and operating model document.
12. Tenant isolation is a compliance control, not only an engineering concern: a cross-tenant data leak between two REs is a reportable event for both customers.

