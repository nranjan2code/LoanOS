# Build Backlog

This backlog turns the roadmap into implementation work. It is ordered for a compliance-first LoanOS build.

## Epic 1: Tenant and Regulated Entity Setup

Status: first executable slice complete.

Goal: every loan runs under a clearly identified regulated entity.

Tasks:

- Create tenant/RE data model. Done.
- Add supported RE categories and license metadata. Partial.
- Add RE public website disclosure fields. Done.
- Add grievance officer registry. Done.
- Add board-approved policy references. Done.
- Add DLA registry for own and LSP apps/websites.
- Add CIMS export shape for DLA reporting.
- Add tests for missing RE, missing grievance officer, and unsupported RE type. Partial.

Done when:

- No application can be created without active RE setup.
- DLA data can be exported in RBI CIMS-ready shape.

## Epic 2: Product and Policy Registry

Status: first executable slice complete.

Goal: no loan product exists without approved policy, fees, and compliance configuration.

Tasks:

- Product model: product code, borrower segment, loan type, min/max amount, min/max tenor. Done.
- Pricing model: interest method, APR components, processing fees, verification charges, maintenance charges. Partial.
- Penal-charge policy model. Done.
- Cooling-off policy. Done.
- Prepayment/foreclosure policy.
- Floating-rate reset policy where applicable.
- Policy versioning and effective dates. Planned.
- Tests for missing policy, invalid cooling-off, undisclosed fee posting. Partial.

Done when:

- KFS generation pulls fees and charges from product policy.
- Fees cannot be posted outside product/KFS disclosure.

## Epic 3: Borrower, Consent, and KYC

Status: first executable slice complete.

Goal: borrower onboarding is reusable, auditable, and DPDP/KYC aligned.

Tasks:

- Borrower profile store. Done.
- Consent notice model. Done.
- Consent grant/revoke ledger. Done.
- Third-party sharing consent.
- Data retention choice and deletion request workflow.
- KYC state machine: created, pending, verified, rejected, expired, refresh_required. Partial.
- CKYC search/download/upload adapter boundary.
- V-CIP evidence object. Partial.
- Aadhaar connector guardrails with no biometric/OTP/PID persistence. Done.
- Legal entity onboarding and beneficial owner model.
- Tests for consent revocation, KYC expiry, Aadhaar prohibited storage. Done.

Done when:

- Application preflight can reference borrower profile, KYC record, and consent ledger by ID.
- KYC refresh requirements block new sanction where required.

## Epic 4: LOS Workflow

Status: first executable slice complete.

Goal: complete origination from application to sanction and disbursement readiness.

Tasks:

- Application state machine. Done.
- Eligibility rules engine. First slice done: EMI/FOIR affordability, age-at-maturity, and amount/tenor bounds gate approval.
- Underwriting policy rules. First slice done: approving a refer-band application requires a recorded manual underwriting override (underwriter, reason, policy reference), the named underwriter must be a registered, active credit officer, and a declined decision must cite a coded reason from the decline-reason taxonomy.
- Manual review queue. Partial. Eligibility `refer` outcomes route to a manual underwriting LWS task, and that task's approval is gated on a manual underwriting override captured as decision evidence.
- Maker-checker decision approval. Done.
- AI model-use evidence on decision. Partial.
- Offer generation.
- KFS generation from product policy. Done.
- Document packet model: KFS, sanction letter, agreement summary, privacy policy. First execution packet slice done.
- Rendered LMS statement document packet. Planned.
- Digital delivery evidence. First execution packet slice done.
- Sanction readiness gate. Done.
- Disbursement readiness gate. Done.
- Tests for each state transition and blocked unsafe transition.

Done when:

- A valid application can move from draft to approved with full evidence.
- Invalid applications stop at the exact failed gate with actionable findings.

## Epic 5: LMS Ledger and Repayment

Status: first executable slice complete.

Goal: create a reconstructable loan account after disbursement.

Tasks:

- Loan account model. Done.
- Immutable ledger events. First slices done.
- Repayment schedule generator. Done.
- EMI/amortization calculator. Done.
- Interest accrual. First slice done: scheduled interest is recognized as immutable `interest_accrual` ledger events per installment, idempotent, reconstructable from the ledger, and reconciled against the schedule.
- Payment allocation. First slice done.
- Charges, waivers, reversals. First slice done.
- SMA/NPA asset classification. Done.
- Part prepayment and foreclosure. Foreclosure first slice done: payoff quote (principal + due interest + charges + KFS-disclosed foreclosure charge), full-payoff settlement, and account closure. Part-prepayment first slice done: over-EMI payment reduces principal and re-amortizes the remaining schedule in reduce-EMI or reduce-tenure mode.
- Closure and NOC. First slice done: a settled account issues a checksum-sealed No-Objection Certificate (no dues, security release), gated on closed status and zero outstanding, with idempotent re-issue.
- Borrower statements. First slice done.
- CIC-ready reporting snapshot. First slice done.
- Tests for ledger reconstruction, statement accuracy, classification, and CIC snapshots. Partial.

Done when:

- Balance can be rebuilt from ledger events.
- Statements match ledger state.

## Epic 6: Collections, Recovery, and Delinquency

Status: first executable slice complete.

Goal: manage overdue accounts without violating borrower protection and recovery rules.

Tasks:

- Delinquency buckets. Done.
- Reminder and notice workflow.
- Recovery-agent registry. Partial.
- Recovery-agent assignment notice before contact. Done.
- Cash recovery exception workflow. Partial.
- Same-day cash recovery posting. Done.
- Hardship and restructure workflow.
- Settlement and write-off approval.
- Tests for recovery notice and same-day cash posting. Done.

Done when:

- Recovery action cannot start until borrower notice exists.
- Cash recovery cannot remain unposted beyond same day.

## Epic 7: LWS Compliance Operations

Status: first executable slice complete.

Goal: compliance work is native workflow, not spreadsheets.

Tasks:

- Workflow engine with queues, tasks, SLA, assignment, status. Derived queues, SLA clocks, and assignment/start/release/comment first slice done.
- Staff actor registry and role/queue policy. First slice done.
- Maker-checker approvals. First slice done for credit decision approval task with `credit_checker` enforcement.
- Collections workflow queue. First slice done for delinquent recovery-assignment task.
- NPA review queue. First slice done from asset classification.
- Override approval with reason and evidence. First slice done: manual underwriting override on a refer-band approval captures underwriter, reason, and policy reference, flows into the final decision evidence, and enforces four-eyes separation (the checker cannot be the underwriter).
- Grievance module and 30-day RBI CMS escalation clock. First slice done.
- Fraud case module.
- Natural justice notice and response workflow.
- Committee pack generator.
- Audit export.
- Tests for LWS approval, recovery queues, wrong-role assignment, and SLA metadata. First slice done.
- Tests for grievance lifecycle and RBI CMS escalation. First slice done.
- Tests for override workflows.

Done when:

- Every exception has actor, reason, approver, timestamp, and policy reference.

## Epic 8: AI Governance and Model Risk

Goal: all model-assisted decisions are inventoried, validated, monitored, and kill-switchable.

Tasks:

- Model lifecycle states: draft, validation_pending, approved, active, suspended, retired.
- Model validation workflow.
- High-risk model approval workflow.
- Bias/fairness evidence.
- Explainability evidence.
- Drift monitoring.
- Hallucination and adversarial testing for generative AI.
- Customer-facing AI disclosure and human handoff.
- AI incident workflow.
- Kill-switch post-incident review.
- Tests for global/model/workflow kill switch.

Done when:

- No model can be called unless inventory, validation, status, and kill-switch gates pass.

## Epic 9: Regulatory Reporting and Integrations

Goal: generate required reporting evidence from runtime data.

Tasks:

- CIC reporting feed. Internal snapshot first slice done.
- CKYC integration.
- CERSAI security-interest registration, modification, satisfaction.
- DLA CIMS export.
- FIU-IND suspicious transaction support.
- Payment integrations: NACH/UPI/bank account verification.
- eSign/document vault.
- SMS/email delivery provider.
- Vendor data-residency checks.

Done when:

- Reporting exports can be generated from source-of-truth records, not manual re-entry.

## Epic 10: Security and Production Platform

Goal: production-grade operating platform for regulated data.

Tasks:

- Authentication.
- Role-based access control.
- Maker-checker authorization policies.
- Secrets management.
- Audit log hardening.
- Encryption at rest and in transit.
- Key management.
- Vulnerability scanning.
- Observability and alerting.
- Backup and restore.
- DR and BCP runbooks.
- Data retention/deletion jobs.
- Security tests and threat model.

Done when:

- Production readiness gate can be reviewed by security, compliance, and risk.
