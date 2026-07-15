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

All institutional roles use the canonical LoanOS Guide and Academy for searchable task guidance, role-based learning paths and sandbox-first control education. The guide complements—not overrides—the platform's executable policies and approval outcomes.

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

## Delivery Model: SaaS

LoanOS India is delivered as an India-hosted multi-tenant SaaS (ADR 0002):

- A tenant is one contracting regulated entity. All borrower, loan, workflow, and model data lives inside the tenant boundary. Implemented: state is partitioned per tenant, and each request is scoped to one tenant resolved from its api key.
- Default tier is pooled compute with logically isolated, per-tenant-encrypted data; a dedicated data plane is available for REs that require it.
- Cross-tenant access is impossible by construction and proven by a regression suite. Implemented in the current slice.
- As the RE's IT service provider, LoanOS itself must satisfy RBI IT-outsourcing obligations (due diligence, audit rights, incident notification, BCP/DR, exit plan), CERT-In incident and log-retention duties, and DPDP data-processor duties.
- Exit is a feature: a tenant can leave with a documented, re-loadable export of records, audit evidence, and rendered documents.

Details live in the SaaS tenancy and operating model document under `docs/architecture/`.

## What Is Already Built

The current codebase contains Phase 0 executable controls:

- Compliance control catalog.
- Regulated entity registry with India, RE type, public disclosure, grievance officer, board policy, and data-residency validation.
- LSP registry with RE agreement, enhanced due diligence, periodic review, portfolio monitoring, borrower-facing grievance/privacy disclosure, India data controls, recovery guidance, and RE-paid fee controls.
- DLA registry for RE-owned and LSP-owned app/web surfaces, with CIMS-ready export rows, grievance contact, RE website linkage, India data controls, and CCO/compliance attestation.
- Product policy registry with RE linkage, INR, APR, amount/tenor limits, cooling-off, recovery mechanism, eligibility, and charge validation.
- Registry-backed applications that can inherit approved RE/product facts by reference.
- Borrower profile registry with active India borrower and economic-profile checks.
- Consent ledger with purpose, notice, granted/revoked status, and evidence timestamps.
- KYC record registry with verified-state, expiry, V-CIP India storage, and Aadhaar prohibited-storage checks.
- Staff actor registry with role, queue, assignment-authority, and India-operations controls.
- Complaint registry with acknowledgement evidence, grievance-officer workflow, 30-day RBI clock, and RBI CMS escalation evidence.
- Borrower-backed applications that can inherit borrower/KYC/consent/economic facts by reference.
- White-labelled borrower journey portal with one-time-code access, a prioritised next action, visual application milestones, repayment schedules, a document centre, short educational media, grievance tracking, and DPDP access/correction/erasure controls.
- Canonical LoanOS Guide and Academy with role-based discovery, task search, learning paths, control/environment/maturity labels and verified operating guides, linked from the staff workspace, tenant landing and public resource room.
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
- Bank-account verification evidence before disbursement.
- NACH/UPI payment rail initiation evidence with masked/hash-only mandate and collect records.
- SMS/email/WhatsApp communication dispatch evidence with masked recipients and message hashes.
- KFS generator and validator.
- Sanction readiness gate requiring KFS acceptance and digital delivery evidence.
- Execution document packet renderer for KFS, sanction letter, agreement summary, privacy notice, checksums, delivery evidence, eSign evidence, and document-vault receipt.
- AI model registry.
- Model-level and global kill switch.
- Governed digital-worker marketplace with proposal-only CAM, underwriting, document/compliance, and service-support templates.
- Tenant pricing contracts, installations, four-role human approval, control-engine activation, dual runtime guardrails, execution/output lineage, exact-paise usage, reports, and suspension controls.
- API endpoints backed by local JSON state.
- Automated tests for the main compliance gates.

## What We Build Next

Recently completed: SaaS tenancy groundwork, tenant onboarding, human login/admin, the audit spine, and the first governed digital-worker control plane — including tenant-scoped commercial contracts and installations, FST-034 four-human activation, dual decision-engine authorization, checksum-sealed execution/output lineage, exact-paise usage, reporting, and suspension. These are control-plane capabilities; no external LLM invocation is represented as complete.

Immediate next build:

1. Connect a provider-neutral model/agent adapter to an approved AWS India runtime while preserving model inventory, kill-switch, tenant isolation, dual guardrails, and complete request/response lineage.
2. Wire the implemented specialized deterministic guardrails for tenant-scoped retrieval/data minimization, outbound communications, eligibility/decision influence and domain mutations into the provider runtime and domain workflows; maintain their golden/adverse regression corpus.
3. Establish worker-specific evaluation and monitoring: versioned task suites, groundedness/completeness/safety thresholds, red-team and regression evidence, cohort reports, alerts, and automatic suspension.
4. Build marketplace and tenant administration journeys for catalogue discovery, pricing approval, installation diff, staffing readiness, activation, usage budgets, reporting, and uninstall/export.
5. Complete commercial operations with quotas, invoice aggregation, GST/tax treatment, credits, reconciliation, and contract-entitlement enforcement.
6. Production harden tenancy and operations with live federation/SCIM, KMS/HSM custody, India-resident telemetry/SIEM, managed backup/PITR, DR, and independent assurance.
7. Complete and certify live external lending integrations, institutional UAT, model-risk approval, security testing, and RE production admission.

## Non-Goals for Now

- We are not building a generic global lending platform.
- We are not supporting non-INR loans in the first product.
- We are not storing Aadhaar biometrics, OTP, or PID.
- We are not allowing LSPs to control disbursement or repayment funds.
- We are not treating AI governance as optional.
- We are not claiming production compliance until legal/compliance review, security review, operational controls, and live integrations are complete.
- We are not supporting Microfinance (MFI) joint-liability group (JLG) loans, household income caps, or multi-lender aggregate FOIR rules.

## Success Criteria

LoanOS India is successful when:

- A loan can be traced from consent to KYC to underwriting to KFS to sanction to disbursement to repayment to closure.
- Every material decision has policy, actor, data, and model evidence.
- Every borrower-facing charge is disclosed and enforceable through KFS rules.
- Every vendor and LSP action is scoped and auditable.
- Every AI/model decision can be blocked instantly through a kill switch.
- Every digital-worker action is proposal only, tenant scoped, independently authorized, attributable to humans and service identity, and reproducible from immutable lineage.
- Compliance can produce evidence without reconstructing history manually.
