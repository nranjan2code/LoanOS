# Compliance Build Checklist

This checklist maps regulatory control families to concrete platform behavior and build status.

Legend:

- Done: implemented in the current code and tested.
- Partial: implemented partly, needs more product or integration work.
- Planned: documented but not implemented yet.
- External: needs regulated entity policy, legal review, vendor contract, or external integration.

## RBI Digital Lending Directions, 2025

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| RE remains responsible for LSP/DLA actions | Tenant model requires RE; LSP registry planned. | Partial |
| Active RE setup before origination | Regulated entity registry validates RE type, India country, website, privacy policy, grievance officer, board policies, and data residency. | Done |
| LSP agreement and due diligence | LSP registry, due diligence workflow, periodic review. | Planned |
| Multiple-lender LSP offer neutrality | Offer marketplace with ranking disclosure and dark-pattern checks. | Planned |
| Borrower economic profile | Age, occupation, income required in preflight. | Done |
| Creditworthiness assessment before sanction | Eligibility engine computes EMI/FOIR affordability, age-at-maturity, and amount/tenor bounds; ineligible borrowers cannot be approved. | Done |
| KFS before execution | KFS validation and acceptance gate. | Done |
| Product policy before origination | Product registry validates active RE link, board approval, INR, amount/tenor bounds, APR, cooling-off, recovery mechanism, eligibility, and charges. | Done |
| Digitally delivered KFS/documents | KFS delivery evidence gates decision; execution document packet delivery gates disbursement. | Done |
| Direct disbursement to borrower/end-beneficiary | LSP/pass-through disbursement blocked. | Done |
| Direct repayment to RE account | LSP/pass-through repayment blocked. | Done |
| LSP fees paid by RE, not borrower | Fee registry and vendor settlement module. | Planned |
| Recovery-agent notice before contact | Recovery assignment requires borrower notice evidence before a recovery agent can contact the borrower. | Done |
| Grievance officer and 30-day escalation path | Staff actor role, complaint registry, 30-day SLA, LWS grievance queue, and RBI CMS escalation evidence. | Done |
| Data minimization and explicit consent | Consent evidence required; detailed consent ledger planned. | Partial |
| Purpose-specific consent ledger | Borrower-linked consent records track purpose, notice version, status, accepted/revoked timestamps, and evidence reference. | Done |
| India data storage | Primary storage country required as IN. | Done |
| Overseas processing return/delete within 24 hours | Processing duration check implemented. | Done |
| DLA CIMS reporting | Active DLA registry validates own/LSP app and web surfaces, CCO/compliance attestation, grievance contact, RE website linkage, India data controls, and exports CIMS-ready rows. | Done |
| CIC reporting | Internal account-level and portfolio-level CIC-ready snapshots from ledger/schedule state; external CIC submission planned. | Partial |

## KFS for Loans and Advances

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| KFS generated before sanction | KFS is required before decision. | Done |
| APR disclosed | KFS requires `aprBps`. | Done |
| Loan amount and tenor disclosed | KFS requires principal and tenor. | Done |
| Cooling-off period | KFS requires at least one day. | Done |
| Recovery mechanism | KFS requires recovery mechanism. | Done |
| Grievance officer | KFS requires name and email. | Done |
| Undisclosed fees cannot be charged later | Fee-posting module must enforce KFS fee registry. | Planned |
| Digitally signed/rendered KFS | HTML/text document packet renderer with checksum and delivery evidence; eSign/PDF planned. | Partial |
| KFS workflow state | KFS route separates issued KFS from decision-ready KFS based on acceptance and delivery evidence. | Done |

## Fair Lending and Penal Charges

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Penal charges, not penal interest | KFS validator blocks `penal_interest`. | Done |
| No capitalization of penal charges | KFS validator blocks capitalizing penal charges. | Done |
| Reasonable and non-discriminatory policy | Product policy registry and board-approved policy. | Planned |
| Upfront disclosure | KFS charge reason/name required. | Partial |
| Product-level penal-charge safety | Product policy rejects penal interest and capitalization for penal charges. | Done |

## KYC, AML, CFT

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| KYC verified before lending | Preflight requires verified KYC. | Done |
| Risk categorization | Validates low/medium/high. | Done |
| Borrower profile and economic profile | Borrower registry captures India borrower profile, contact channel, and economic profile for active borrowers. | Done |
| KYC record expiry | Borrower-backed application resolution blocks expired verified KYC records. | Done |
| CKYC search/upload | CKYC connector. | Planned |
| V-CIP evidence | India storage check exists; full evidence vault planned. | Partial |
| FIU-IND reporting support | AML alerts and reporting pack. | Planned |
| Beneficial-owner checks for legal entities | Legal entity onboarding. | Planned |

## Aadhaar and UIDAI Constraints

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Do not store biometric/OTP/PID | Preflight blocks those flags. | Done |
| Encrypted PID boundary | Aadhaar connector boundary. | Planned |
| Audit metadata only where allowed | Connector audit policy. | Planned |

## DPDP Act and Rules

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Notice and consent evidence | Consent timestamp and notice version required. | Done |
| Consent revocation | Consent ledger with revocation workflow. | Planned |
| Data principal rights | Access/correction/deletion workflow. | Planned |
| Breach workflow | Incident and DPBI reporting evidence. | Planned |
| Retention and deletion | Retention policy engine. | Planned |

## IT Governance, Cybersecurity, and Data Residency

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| India-hosted primary data | Preflight requires IN primary storage. | Done |
| Payment data in India | Preflight requires IN payment data storage if specified. | Done |
| Straight-through processing audit trail | Event model started; full STP checks planned. | Partial |
| Need-based access | Staff actor registry, roles, queue access, and regulated-action checks. External IAM and reviews planned. | Partial |
| DC/DR and BCP | Production infrastructure design. | Planned |

## Fraud Risk Management

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Fraud case workflow | LWS fraud module. | Planned |
| LEA reporting for threshold frauds | Fraud reporting pack. | Planned |
| Natural justice workflow | Notices, response capture, committee decision. | Planned |
| Fraud monitoring return support | FMR export. | Planned |

## AI, FREE-AI, and Model Risk

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Model inventory | Model registry implemented. | Done |
| Approved validation before use | Model-use guard checks validation status. | Done |
| Independent validation for high-risk models | High-risk model requires independent validation reference. | Done |
| Human review for material decisions | Warning emitted if missing. | Partial |
| Human review workflow for material AI decisions | Decision proposal routes to `human_review_required` when a material model lacks human review evidence. | Done |
| Customer disclosure for customer-facing AI | Warning emitted if missing. | Partial |
| Global kill switch | Implemented. | Done |
| Model-level kill switch | Implemented. | Done |
| Red-teaming and adversarial tests | Evidence fields exist; workflow planned. | Partial |
| Drift, bias, hallucination monitoring | Monitoring service planned. | Planned |
| AI incident reporting | Kill-switch incident record and post-incident review first slice implemented; sectoral incident pack planned. | Partial |

## Maker-Checker and Workflow

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Decision proposal before sanction | Decision endpoint creates a pending proposal instead of final approval. | Done |
| Checker approval before disbursement | Approval endpoint must approve the pending proposal before disbursement can proceed. | Done |
| Maker/checker separation | Approval by the same actor who proposed the decision is blocked. | Done |
| Workflow event trail | Application workflow records transition events for preflight, KFS, human review, decision proposal, approval, and disbursement. | Done |
| LWS task queues | Active work queues are derived from application, account, and complaint states for compliance, KFS, decisioning, human review, checker approval, disbursement, collections, NPA review, grievance resolution, and RBI CMS escalation. | Done |
| LWS SLA clocks | Derived tasks include SLA target hours, opened time, due time, and breach status. | Done |
| LWS task assignment audit | Assignment, start, release, and comment events are persisted against deterministic task IDs and actor policy. | Done |
| Role-based authorization | Staff actor role/queue checks for credit proposal, checker approval, human review, recovery assignment, and workflow task actions. | Partial |
| External IAM and access reviews | Login/session auth, access certification, and approval-matrix administration. | Planned |

## LMS Ledger and Servicing

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Loan account opened after disbursement | Disbursement creates an LMS account linked to application, borrower, RE, product, and KFS terms. | Done |
| Ledger event for disbursement | Loan account ledger starts with a disbursement event. | Done |
| Repayment schedule | Reducing-balance monthly schedule generated from principal, rate, tenor, and disbursement date. | Done |
| Balance reconstruction | Account summary reconstructs principal paid/outstanding, interest paid/outstanding, and next due from schedule plus ledger. | Done |
| Payment posting | Payment endpoint records a ledger payment and allocates due interest before principal. | Done |
| Borrower statements | Statement generation from ledger and schedule for a requested period. | Done |
| Disclosed charges only | Charge endpoint blocks charges not present in KFS charge catalog. | Done |
| Penal charge guardrails | Charge endpoint blocks penal interest and capitalized penal charges. | Done |
| Waivers | Waiver endpoint requires approver, approval reference, reason, and outstanding charges. | Done |
| Reversals | Reversal endpoint requires original event, approval evidence, reason, and blocks duplicate reversal. | Done |
| Delinquency buckets | DPD bucket, earliest unpaid installment, and overdue amounts are computed from schedule and ledger. | Done |
| Recovery-agent notice | Recovery assignment requires borrower notice timestamp and delivery reference before active assignment. | Done |
| Cash recovery same-day posting | Cash recovery requires active noticed recovery assignment and same-India-day account posting. | Done |
| SMA/NPA asset classification | Asset class maps DPD to standard, SMA-0, SMA-1, SMA-2, and NPA. | Done |
| CIC-ready snapshots | Internal account-level and portfolio-level CIC reporting snapshots are generated from account lifecycle state. | Done |
| External CIC submission | Provider-specific CIC file/API integration and acknowledgement handling. | Planned |

## Production Readiness Gates

Before production, the platform needs:

1. Legal and compliance review of control interpretation.
2. Board-approved policies for products, penal charges, LSP, DLG, outsourcing, model risk, data retention, and recovery.
3. Authentication, authorization, maker-checker, and audit hardening.
4. Secure secrets management.
5. India-hosted production database and object storage.
6. Observability, SIEM, incident response, backup, DR, and BCP.
7. Vendor due diligence and contracts with audit rights and data residency obligations.
8. Penetration testing and vulnerability management.
9. Privacy impact assessment and DPDP operating model.
10. Integration certification where required by external providers.
