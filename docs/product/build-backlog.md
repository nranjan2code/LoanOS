# Build Backlog

This backlog turns the roadmap into implementation work. It is ordered for a compliance-first LoanOS build.

## Epic 1: Tenant and Regulated Entity Setup

Status: first executable slice complete; LSP and DLA CIMS reporting first slices complete.

Goal: every loan runs under a clearly identified regulated entity.

Tasks:

- Create tenant/RE data model. Done.
- Add supported RE categories and license metadata. Partial.
- Add RE public website disclosure fields. Done.
- Add grievance officer registry. Done.
- Add board-approved policy references. Done.
- Add LSP registry with RE agreement, due diligence, periodic review, data, recovery, and fee-control evidence. Done.
- Add DLA registry for own and LSP apps/websites. Done.
- Add CIMS export shape for DLA reporting. Done.
- Add tests for missing RE, missing grievance officer, and unsupported RE type. Partial.

Done when:

- No application can be created without active RE setup.
- DLA data can be exported in RBI CIMS-ready shape. Done.

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
- Policy versioning and effective dates. First slice done: a product policy carries a `version` and `effectiveFrom`/`effectiveTo`; `upsertProductPolicy` publishes each material change as a new version (must increase and take effect after the current one), archiving the superseded version with its window closed in `priorVersions`. `selectProductPolicyVersion(product, asOf)` (and `GET /products/{id}?asOf=`) resolve the version governing a given date, so an application is always priced by the policy effective on its date.
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
- Data retention choice and deletion request workflow. First slice done: `packages/core/src/data-retention.js` runs a DPDP right-to-erasure request (`requested → fulfilled/rejected`) gated by statutory retention — `assessErasureEligibility` holds erasure while the borrower has an active loan relationship or any closed account is within the 5-year RBI/PMLA retention window (`retainUntil`). `POST/GET /erasure-requests`, `GET /erasure-requests/{id}`, and `POST /erasure-requests/{id}/(fulfillment|rejection)` drive it; fulfilment irreversibly redacts the borrower profile in place (`redactBorrowerProfile`) while retaining the request and its audit trail as evidence.
- KYC state machine: created, pending, verified, rejected, expired, refresh_required. Done: `refresh_required` is a first-class status; `evaluateKycStatus`/`computeKycReviewDueAt` derive an effective status from the RBI risk-based periodic-review cycle (high 2y, medium 8y, low 10y) on top of the stored status and expiry. A verified record past its review-due date reads as `refresh_required`, and preflight (`resolveBorrowerApplicationReferences`) blocks new sanction on a refresh-due or expired KYC. `GET /borrowers/{id}/kyc-records` surfaces the effective status and `nextReviewDueAt`.
- CKYC search/download/upload adapter boundary.
- V-CIP evidence object. Partial.
- Aadhaar connector guardrails with no biometric/OTP/PID persistence. Done.
- Legal entity onboarding and beneficial owner model.
- Tests for consent revocation, KYC expiry, Aadhaar prohibited storage. Done.

Done when:

- Application preflight can reference borrower profile, KYC record, and consent ledger by ID.
- KYC refresh requirements block new sanction where required. Done.

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
- Rendered LMS statement document packet. First slice done: the period statement renders as a checksum-sealed HTML/text borrower document.
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

Status: first executable slice complete; hardship restructure and settlement/write-off first slices complete.

Goal: manage overdue accounts without violating borrower protection and recovery rules.

Tasks:

- Delinquency buckets. Done.
- Reminder and notice workflow.
- Recovery-agent registry. Partial.
- Recovery-agent assignment notice before contact. Done.
- Cash recovery exception workflow. Partial.
- Same-day cash recovery posting. Done.
- Hardship and restructure workflow. First slice done: `restructureLoanAccount` (`packages/core/src/loan-account.js`) modifies a stressed but active loan under maker-checker approval (four-eyes) — extending the remaining tenure and/or conceding the rate and re-amortizing the remaining principal over the new term (past installments untouched). The account is flagged `restructured`, which surfaces in `classifyLoanAsset` and the CIC snapshot. `POST /loan-accounts/{id}/restructure` drives it and seals the event into the audit spine.
- Settlement and write-off approval. First slice done: `settleLoanAccount` closes an active loan for less than the full outstanding under maker-checker approval (four-eyes) — the borrower pays the agreed amount and the RE waives (sacrifices) the shortfall via principal/interest waiver ledger credits, closing the account as `settled`; `writeOffLoanAccount` marks an account `written_off` as a book loss while retaining the borrower's legal dues on the ledger. Both are reported to the CIC snapshot (`settled`/`closureType`, `writtenOff`/`writeOffAmount`). `POST /loan-accounts/{id}/settlement` and `POST /loan-accounts/{id}/write-off` drive them and seal events into the audit spine.
- Tests for recovery notice and same-day cash posting. Done.

Done when:

- Recovery action cannot start until borrower notice exists.
- Cash recovery cannot remain unposted beyond same day.

## Epic 7: LWS Compliance Operations

Status: first executable slice complete; fraud case module + natural-justice fraud classification first slice complete.

Goal: compliance work is native workflow, not spreadsheets.

Tasks:

- Workflow engine with queues, tasks, SLA, assignment, status. Derived queues, SLA clocks, and assignment/start/release/comment first slice done.
- Staff actor registry and role/queue policy. First slice done.
- Maker-checker approvals. First slice done for credit decision approval task with `credit_checker` enforcement.
- Collections workflow queue. First slice done for delinquent recovery-assignment task.
- NPA review queue. First slice done from asset classification.
- Override approval with reason and evidence. First slice done: manual underwriting override on a refer-band approval captures underwriter, reason, and policy reference, flows into the final decision evidence, and enforces four-eyes separation (the checker cannot be the underwriter).
- Grievance module and 30-day RBI CMS escalation clock. First slice done.
- Fraud case module. First slice done: `packages/core/src/fraud-case.js` runs a tenant-scoped fraud case (`reported → under_investigation → show_cause_issued → classified_fraud/classified_not_fraud`). `POST/GET /fraud-cases`, `GET /fraud-cases/{id}`, and `POST /fraud-cases/{id}/(show-cause-notice|responses|classification)` drive it; every action seals into the audit spine.
- Natural justice notice and response workflow. First slice done (fraud path): an adverse (fraud) classification is blocked until a show-cause notice has been issued (with delivery proof) and either the borrower has responded or the RBI FRM-2024 21-day response window has elapsed, and the classifying authority must be independent of the investigator (four-eyes).
- Committee pack generator. First slice done (fraud): `generateFraudCommitteePack` (`packages/core/src/fraud-case.js`) and `GET /fraud-cases/{id}/committee-pack` assemble a checksum-sealed, tamper-evident pack — case facts, the natural-justice trail (show-cause notice + borrower response), the event timeline, and an explicit `classificationPermitted` verdict with `blockers` — so a committee can see at a glance whether an adverse finding is lawful.
- Audit export.
- Tests for LWS approval, recovery queues, wrong-role assignment, and SLA metadata. First slice done.
- Tests for grievance lifecycle and RBI CMS escalation. First slice done.
- Tests for override workflows.

Done when:

- Every exception has actor, reason, approver, timestamp, and policy reference.

## Epic 8: AI Governance and Model Risk

Status: first executable slice complete; drift monitoring first slice complete.

Goal: all model-assisted decisions are inventoried, validated, monitored, and kill-switchable.

Tasks:

- Model lifecycle states: draft, validation_pending, approved, active, suspended, retired. Done: governed transitions with legal state guards.
- Model validation workflow. First slice done: approving validation requires independent validation evidence and an approver independent of the owner before a model can be activated.
- High-risk model approval workflow. First slice done: high-risk approval additionally requires fairness, explainability, and monitoring evidence.
- Bias/fairness evidence.
- Explainability evidence.
- Drift monitoring. First slice done: `recordDriftObservation` (`packages/core/src/model-governance.js`) records a drift metric reading against an active model (against a `driftThreshold` set on the model or the observation); a reading that breaches the threshold auto-trips a model-scoped kill switch — suspending the model and opening an incident that must be reviewed before the model runs again. `POST /ai/models/{id}/drift-observations` drives it and seals the event into the audit spine.
- Hallucination and adversarial testing for generative AI.
- Customer-facing AI disclosure and human handoff.
- AI incident workflow. First slice done: a kill-switch trigger opens an incident record tracking scope, reason, trigger actor, and status.
- Kill-switch post-incident review. First slice done: the global switch cannot be cleared until a post-incident review (root cause, remediation) is recorded, and clearance closes the incident while retaining the evidence.
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

## Epic 11: SaaS Tenancy and Platform Isolation

Status: S1–S6 first slice complete for every task (tenant partitioning, tenant-scoped auth, isolation suite, hash-chained audit spine + evidence export, tenant portability export + evidenced offboarding, disclosed sub-processor register, 6-hour incident-notification workflow, audited platform-staff break-glass access, uniform audit provenance stamping).

Goal: LoanOS runs as a multi-tenant SaaS where cross-tenant access is impossible by construction and the platform satisfies RE outsourcing obligations.

Tasks:

- State partitioned into a control plane (tenant registry) and per-tenant data planes. Done.
- Tenant-scoped storage accessor; endpoint code cannot express a cross-tenant query. Done: handlers receive only their tenant's partition through a scoped store.
- Tenant registry in the control plane with isolation-tier and contract facts. First slice done (tenantId, name, isolation tier, status, hashed api key).
- Tenant-scoped API credentials and tenant-context middleware on every route. Done: `x-api-key`/bearer resolves the tenant, 401 otherwise.
- Platform control plane to mint tenants. Done: `POST /platform/tenants` behind a platform admin key returns a one-time api key stored only as a hash.
- Cross-tenant isolation regression suite covering every resource type. Done.
- Platform-staff break-glass access with audit and tenant reporting. First slice done: `POST /platform/tenants/{id}/break-glass` (platform admin) mints a time-boxed, tenant-scoped break-glass credential (returned once, stored only as a hash); presenting it via `x-break-glass-key` authenticates as that one tenant and seals a `platform.break_glass.access` event (staff id, reason, method, path) into the tenant's own audit chain on every request. Tenants read every grant scoped to them via `GET /break-glass-grants`; `POST /platform/break-glass/{grantId}/revoke` and TTL expiry immediately stop authentication.
- Hash-chained, tenant-scoped audit event module; migrate module event emission onto it. Done: `packages/core/src/audit.js` seals each tenant's events into a tamper-evident SHA-256 chain on every save.
- Uniform actor/data-class stamping on audit events. Done: `stampAuditEvents`/`classifyAuditDataClass` (`packages/core/src/audit.js`) centrally fill an `actor`/`actorType`/`dataClass` provenance envelope on every event at the seal seam — attributed to the tenant on ordinary requests and to platform staff under break-glass — so no handler can persist an unclassified event and the envelope is hashed into the chain.
- Evidence export pack generated from the audit spine. Done: `GET /audit/export` (integrity-attested, filterable) and `GET /audit/events` (chain + validity verdict).
- Tenant onboarding/offboarding workflow with exit/portability export and evidenced deletion. First slice done: `GET /platform/tenants/{id}/export` returns a reproducible portability pack (control record + full data plane + audit evidence pack), and `POST /platform/tenants/{id}/offboarding` performs evidenced deletion — purging the data plane, revoking the api key, and retaining a control-plane deletion attestation (erased event count, audit head hash, content digest, actor, reason).
- Incident notification workflow supporting RE 6-hour RBI reporting and CERT-In duties. First slice done: `packages/core/src/incident-notification.js` records a tenant-scoped security/data incident and runs an independent 6-hour reporting clock per authority (CERT-In 2022 and RBI). `POST/GET /incidents`, `GET /incidents/{id}`, and `POST /incidents/{id}/notifications` capture reports and regulator acknowledgements; a duty unreported past 6 hours from detection surfaces as `overdue`/`reporting_overdue`, and every report and notification is sealed into the audit spine.
- Sub-processor register. First slice done: `POST/GET /platform/sub-processors` (platform admin) maintains a control-plane register requiring a data-processing agreement and a declared data-residency country per sub-processor; `GET /sub-processors` exposes it to every authenticated tenant as a standing disclosure, flagging cross-border processing.

Done when:

- No API call executes without an authenticated tenant context. Done.
- The isolation suite proves two provisioned tenants cannot touch each other's data. Done.
- A full tenant export is reproducible from source-of-truth records. Done.
