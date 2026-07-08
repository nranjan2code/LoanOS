# What We Are Building

## One-Line Definition

LoanOS India is a full-stack, India-only lending operating system for regulated digital lending. It combines LOS, LMS, LWS, compliance operations, and AI/model-risk governance into one auditable platform.

## Why This Exists

India lending platforms usually break at the handoffs:

- Origination captures data, but servicing cannot reconstruct why a loan was approved.
- KFS and borrower disclosures become documents, not machine-enforced controls.
- LSPs and vendors are integrated, but the regulated entity still carries responsibility.
- AI and scorecards influence credit decisions, but model inventory, validation, and kill-switch controls are treated as separate governance paperwork.
- Compliance evidence is assembled after the fact, which is slow, risky, and incomplete.

LoanOS India is built so compliance evidence is produced while the business flow runs.

## Product Planes

### LOS: Loan Origination System

Purpose: originate compliant India loans from customer onboarding to sanction and disbursement readiness.

Core capabilities:

- Borrower onboarding.
- Consent and DPDP notice capture.
- KYC/CDD workflow.
- Economic profile capture: age, occupation, income, employment/business details.
- Product eligibility.
- Credit policy and underwriting.
- AI/model-assisted decision guard.
- Offer presentation.
- KFS generation.
- Sanction letter and agreement packet.
- Disbursement readiness and fund-flow guard.

### LMS: Loan Management System

Purpose: manage the live loan account after sanction/disbursement.

Core capabilities:

- Loan account ledger.
- Repayment schedule.
- EMI and amortization.
- Interest accrual.
- Penal charges as charges, not penal interest.
- Statements.
- Prepayment and foreclosure.
- Floating-rate reset communications where applicable.
- Delinquency, collections, recovery assignment, restructuring, settlement, write-off, closure.
- CIC reporting events.
- CERSAI security-interest lifecycle for secured loans.

### LWS: Loan Workflow System

Purpose: route human and operational work across makers, checkers, risk, compliance, vendors, and committees.

Core capabilities:

- Maker-checker workflows.
- Exceptions and overrides.
- Human review of model-assisted decisions.
- Vendor/LSP due diligence.
- Recovery-agent assignment and notices.
- Grievance redressal and RBI CMS escalation clock.
- Fraud case handling and natural justice workflow.
- Committee packs for board/risk/compliance.
- Audit evidence export.

### Compliance OS

Purpose: make regulatory controls executable.

Core capabilities:

- Regulatory control catalog.
- Product policy registry.
- KFS and fee disclosure rules.
- Data residency and retention controls.
- Consent ledger.
- DLA and LSP registry.
- AI model inventory.
- AI kill switch and incident evidence.
- Audit events.
- Regulatory reporting exports.

## Who Uses It

| User | Needs |
| --- | --- |
| Borrower | Transparent loan terms, KFS, privacy choices, grievance path, statements, repayment clarity. |
| Loan officer | Clean onboarding, eligibility, underwriting workflow, document packet, exception handling. |
| Credit/risk team | Policy execution, model evidence, human review, portfolio controls, delinquency signals. |
| Operations team | Disbursement checks, repayment tracking, collections tasks, closure and NOC workflows. |
| Compliance officer | Proof of KFS, KYC, consent, fund-flow, DLA/LSP, data residency, grievance, fraud, and model governance. |
| Auditor | Immutable evidence for decisions, communications, overrides, documents, and model use. |
| Regulated entity leadership | Board packs, policy status, risk metrics, vendor posture, kill-switch readiness. |
| LSP/vendor | Limited scoped workflows, no unauthorized fund control, audit-ready handoffs. |

## India-Only Boundary

The platform is only for India lending.

Hard boundaries:

- Borrower residency must be India for this product.
- Loan currency must be INR.
- Primary data storage must be India.
- Payment data storage must be India where payment-system data is in scope.
- V-CIP recordings and logs must be India-stored.
- Aadhaar biometric, OTP, and PID artifacts must not be stored.
- RBI Digital Lending fund-flow controls are enforced.

## Regulatory Boundary

The platform is built for lending by or on behalf of RBI-regulated entities:

- Commercial banks.
- Small finance banks.
- Payments banks where relevant to product scope.
- Co-operative banks.
- NBFCs.
- HFCs.
- All-India Financial Institutions.

The platform can support LSP/DLA models, but the regulated entity remains accountable.

## What Is Already Built

The current codebase contains Phase 0 executable controls:

- Compliance control catalog.
- Regulated entity registry with India, RE type, public disclosure, grievance officer, board policy, and data-residency validation.
- DLA registry for RE-owned and LSP-owned app/web surfaces, with CIMS-ready export rows, grievance contact, RE website linkage, India data controls, and CCO/compliance attestation.
- Product policy registry with RE linkage, INR, APR, amount/tenor limits, cooling-off, recovery mechanism, eligibility, and charge validation.
- Registry-backed applications that can inherit approved RE/product facts by reference.
- Borrower profile registry with active India borrower and economic-profile checks.
- Consent ledger with purpose, notice, granted/revoked status, and evidence timestamps.
- KYC record registry with verified-state, expiry, V-CIP India storage, and Aadhaar prohibited-storage checks.
- Staff actor registry with role, queue, assignment-authority, and India-operations controls.
- Complaint registry with acknowledgement evidence, grievance-officer workflow, 30-day RBI clock, and RBI CMS escalation evidence.
- Borrower-backed applications that can inherit borrower/KYC/consent/economic facts by reference.
- LOS workflow state machine with KFS readiness, material-AI human review, decision proposal, maker-checker approval, and disbursement transition.
- LWS derived task queues for compliance exceptions, KFS evidence, credit decisions, AI human review, checker approval, disbursement, collections, NPA review, grievance resolution, and RBI CMS escalation, with SLA clocks, role checks, and assignment/start/release/comment audit.
- LMS loan account model that opens on disbursement, generates a repayment schedule, records ledger events, reconstructs balance, accrues interest, posts payments, supports part-prepayment, foreclosure, closure NOC, borrower statements and statement documents, controls charges/waivers/reversals, computes delinquency, classifies assets, generates CIC-ready snapshots, and enforces noticed recovery plus same-day cash posting.
- India-only application checks.
- Regulated entity type validation.
- Consent and DPDP notice evidence checks.
- KYC verified-state checks.
- Aadhaar prohibited-storage checks.
- Economic profile checks.
- Data residency checks.
- Direct fund-flow checks.
- KFS generator and validator.
- Sanction readiness gate requiring KFS acceptance and digital delivery evidence.
- Execution document packet renderer for KFS, sanction letter, agreement summary, privacy notice, checksums, and delivery evidence.
- AI model registry.
- Model-level and global kill switch.
- API endpoints backed by local JSON state.
- Automated tests for the main compliance gates.

## What We Build Next

Immediate next build:

1. LSP registry, due diligence, agreement lifecycle, and periodic review evidence.
2. Product policy versioning with effective dates and explicit prepayment/foreclosure policy rules.
3. CKYC adapter boundary and fuller V-CIP evidence vault.
4. Data-retention, deletion-request, and third-party sharing consent workflows.
5. Offer generation and borrower-facing execution upgrades such as PDF/eSign delivery.
6. Recovery contact logging, hardship/restructure workflow, settlement, and write-off approval.
7. Drift monitoring, recurring fairness evidence, and model incident pack generation.

## Non-Goals for Now

- We are not building a generic global lending platform.
- We are not supporting non-INR loans in the first product.
- We are not storing Aadhaar biometrics, OTP, or PID.
- We are not allowing LSPs to control disbursement or repayment funds.
- We are not treating AI governance as optional.
- We are not claiming production compliance until legal/compliance review, security review, operational controls, and live integrations are complete.

## Success Criteria

LoanOS India is successful when:

- A loan can be traced from consent to KYC to underwriting to KFS to sanction to disbursement to repayment to closure.
- Every material decision has policy, actor, data, and model evidence.
- Every borrower-facing charge is disclosed and enforceable through KFS rules.
- Every vendor and LSP action is scoped and auditable.
- Every AI/model decision can be blocked instantly through a kill switch.
- Compliance can produce evidence without reconstructing history manually.
