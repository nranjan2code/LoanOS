# Build Backlog

This backlog turns the roadmap into implementation work. It is ordered for a compliance-first LoanOS build.

## Large Delivery Bundle Sequence (2026-07-14)

This rollup groups the detailed epics into the large execution bundles used for
the current build. Update this table when a bundle closes; the detailed epic and
capability rows remain the source of truth for individual features.

| Bundle | Outcome | Status |
| --- | --- | --- |
| A | Exhaustive capability tracking: shared parser, trace/dashboard parity, and regression coverage for every catalogue family | Complete — all 453 capabilities across 33 categories, including 17 `UX-*` entries, are synchronized and test-pinned. |
| B | One production-ready unsecured personal term-loan journey across acquisition, documents, underwriting, contracting, servicing, and operational UX | Complete at the application/control layer — borrower intake/UI, policy checklist, upload/quarantine evidence, review/waiver, conditions, sanction expiry and KFS-language evidence now join the existing LOS/LMS journey. Live provider certification remains Bundle C. |
| C | Live/certified CIC, CKYCRR, FIU, CERSAI, bureau, AA, bank-verification, eSign, V-CIP, payment, and communication integrations | Product control plane complete — all 15 families have fail-closed certification/readiness governance; CIC/CKYCRR/AA join the existing transports and signed reconciliation boundary. Each RE must still complete external contracts, credentials and provider/regulator certification before real mode can become ready. |
| D | Audit integrity and data governance: external/WORM anchoring, event-completeness reconciliation, retention, evidence, lineage, and data-quality controls | Product control plane complete — exact-head WORM evidence, five-registry completeness, custody/hold/deletion proof, field lineage and declarative DQ certification are executable. External TSA/object-lock custody, schedules and institution-wide catalogue/remediation remain deployment depth. |
| E | Enterprise security and scale: federation, SCIM, KMS/HSM, SIEM custody, HA/PITR, Postgres scale, event/API governance, and deployment automation | Product control plane complete — certified tenant federation/SCIM state, managed-key and log-custody attestations, dependency-linked PostgreSQL HA/PITR/capacity, OpenAPI/event/webhook governance and automation readiness are executable. Live IdP/KMS/SIEM/database/queue/deployment controllers remain external deployment work. |
| F | Risk, AML, and fraud depth: ongoing CDD, transaction monitoring, fraud signals, portfolio analytics, limits, stress, RCSA, and recurring model monitoring | Planned |
| G | Migration and go-live: mapping, conversion, balance validation, parallel run, UAT, training, readiness, cutover, and hypercare | Planned |

## Epic 1: Tenant and Regulated Entity Setup

Status: first executable slice complete; LSP and DLA CIMS reporting first slices complete.

Goal: every loan runs under a clearly identified regulated entity.

Tasks:

- Create tenant/RE data model. Done.
- Add supported RE categories and license metadata. Done: validateRegulatedEntity checks licenseMetadata (category, issueDate, status, licenseNumber, issuingAuthority) and preflight evaluates them.
- Add RE public website disclosure fields. Done.
- Add grievance officer registry. Done.
- Add board-approved policy references. Done.
- Add LSP registry with RE agreement, due diligence, periodic review, data, recovery, and fee-control evidence. Done.
- Add DLA registry for own and LSP apps/websites. Done.
- Add CIMS export shape for DLA reporting. Done.
- Add tests for missing RE, missing grievance officer, and unsupported RE type. Done: tests verify validateRegulatedEntity, resolveLoanApplicationReferences, and API endpoints POST /regulated-entities and POST /loans/applications block invalid or missing RE setups.

Done when:

- No application can be created without active RE setup.
- DLA data can be exported in RBI CIMS-ready shape. Done.

## Epic 2: Product and Policy Registry

Status: first executable slice complete.

Goal: no loan product exists without approved policy, fees, and compliance configuration.

Tasks:

- Product model: product code, borrower segment, loan type, min/max amount, min/max tenor. Done.
- Pricing model: interest method, APR components, processing fees, verification charges, maintenance charges. Done: validateCharges and validateKfs validate that each charge belongs to ALLOWED_CHARGE_TYPES (representing upfront and recurring APR components: processing_fee, verification_charge, maintenance_charge, etc.) and enforces name, reason, and limit checks. GST (18%) disclosed on fees (REV-42): `packages/core/src/tax.js` decomposes each GST-inclusive charge into base + GST (exact paise; interest, stamp duty, insurance premium, and penal charges exempt), surfaced on the KFS (`taxDisclosure` + per-charge breakdown), the charge-assessment ledger event, and borrower statements.
- Penal-charge policy model. Done.
- Cooling-off policy. Done.
- Prepayment/foreclosure policy. Done: product policy validates allowability, lock-in period, and blocks fees on floating-rate individual retail loans; quoteForeclosure and prepayLoanAccount enforce these checks at transaction level.
- Floating-rate reset policy where applicable. Done: resetFloatingRate implements choice-based re-amortization options (extend tenor, increase EMI, switch to fixed with switch fee) under maker-checker flow.
- Sanction validity and product document policy. First slice done: product policy carries a 1–365 day sanction-validity window and optional typed document requirements with MIME/size limits; the governed digital journey binds both to the application snapshot.
- Policy versioning and effective dates. Done: a product policy carries a `version` and `effectiveFrom`/`effectiveTo`; `upsertProductPolicy` publishes each material change as a new version (must increase and take effect after the current one), archiving the superseded version with its window closed in `priorVersions`. `selectProductPolicyVersion(product, asOf)` (and `GET /products/{id}?asOf=` / `GET /products?asOf=`) resolve the version governing a given date. `resolveLoanApplicationReferences` evaluates and binds the specific version active on the application's `appliedAt` or `createdAt` date, ensuring correct interest rates, charges, and parameters are locked at origination.
- Tests for missing policy, invalid cooling-off, undisclosed fee posting. Done.

Done when:

- KFS generation pulls fees and charges from product policy. Done: buildKeyFactStatement maps product policies, and validateKfsBeforeDecision grounds KFS charges and prepayment/foreclosure policy parameters in approved Product Policy limits.
- Fees cannot be posted outside product/KFS disclosure. Done: assessChargeToLoanAccount, quoteForeclosure, and prepayLoanAccount enforce KFS-disclosed caps and computed policy ceilings.


## Epic 3: Borrower, Consent, and KYC

Status: first executable slice complete.

Goal: borrower onboarding is reusable, auditable, and DPDP/KYC aligned.

Tasks:

- Borrower profile store. Done.
- Consent notice model. Done.
- Consent grant/revoke ledger. Done.
- Third-party sharing consent. First slice done: `packages/core/src/data-sharing.js` records every disclosure of borrower data to a third party as a DPDP record-of-processing entry. Consent-based sharing (`legalBasis: consent`) is blocked unless an active `third_party_sharing` consent stands; statutory sharing (`legal_obligation`, e.g. CIC/regulator reporting) is permitted without consent but must cite a `legalReference` and is still logged. `POST/GET /data-disclosures` drive it (filterable by borrowerId) and seal a `data_disclosure.recorded` audit event.
- Data retention choice and deletion request workflow. Done: `packages/core/src/data-retention.js` runs a DPDP right-to-erasure request (`requested → fulfilled/rejected`) gated by statutory retention — `assessErasureEligibility` holds erasure while the borrower has an active loan relationship or any closed account is within the 5-year RBI/PMLA retention window (`retainUntil`). Fulfilment irreversibly redacts the borrower profile, KYC records, and declared beneficial owners in place while retaining the request and its audit trail as evidence. An automated cleanup job (`executeAutoRetentionCleanup` / `POST /data-retention/cleanup`) runs on a scheduler or manually to search for and redact expired inactive borrowers who have no active loans and whose closed loans are past the 5-year statutory retention limit.
- Data principal access and correction rights. First slice done: `packages/core/src/data-principal-rights.js` runs DPDP access requests (`requested → fulfilled`, assembling a portable data pack of profile, consent ledger, KYC summary, loan accounts, and disclosures) and correction requests (`requested → applied/rejected`, applied corrections propagate into the borrower profile), both under a 30-day SLA clock with overdue detection. `GET/POST /borrowers/{id}/access-requests`, `POST /borrowers/{id}/access-requests/{reqId}/fulfillment`, `GET/POST /borrowers/{id}/correction-requests`, and `POST /borrowers/{id}/correction-requests/{reqId}/review` drive it; pending requests derive LWS workflow tasks.
- KYC state machine: created, pending, verified, rejected, expired, refresh_required. Done: `refresh_required` is a first-class status; `evaluateKycStatus`/`computeKycReviewDueAt` derive an effective status from the RBI risk-based periodic-review cycle (high 2y, medium 8y, low 10y) on top of the stored status and expiry. A verified record past its review-due date reads as `refresh_required`, and preflight (`resolveBorrowerApplicationReferences`) blocks new sanction on a refresh-due or expired KYC. `GET /borrowers/{id}/kyc-records` surfaces the effective status and `nextReviewDueAt`.
- CKYC search/download/upload adapter boundary. Done.
- V-CIP evidence vault: recording hash, timestamp, GPS boundaries check, PAN ref, liveness, facial match score (>=0.8), official digital signature, and actor role check. Done.
- Aadhaar connector guardrails with no biometric/OTP/PID persistence. Done.
- Legal entity onboarding and beneficial owner model. First slice done: `borrowerType` already supported `company`/`partnership`/`llp`/`trust` (legalName-keyed) alongside `individual`. `packages/core/src/borrower-onboarding.js` adds a beneficial-owner registry (`normalizeBeneficialOwner`/`validateBeneficialOwner`/`upsertBeneficialOwner`) recording each declared owner's identification, PMLA-basis type (`ownership`/`control`/`senior_managing_official`), and verification evidence. `resolveBorrowerApplicationReferences` blocks sanction for a legal-entity borrower unless at least one *verified* beneficial owner meets the PMLA controlling-interest threshold (25% company, 15% partnership/llp/trust) or is declared as control/senior-managing-official. `POST/GET /borrowers/{id}/beneficial-owners` drive it. Also fixed `checkEconomicProfile` (`loan-policy.js`), which previously required age/occupation unconditionally, blocking every legal-entity application at preflight regardless of beneficial-owner status.
- Tests for consent revocation, KYC expiry, Aadhaar prohibited storage. Done.

Done when:

- Application preflight can reference borrower profile, KYC record, and consent ledger by ID.
- KYC refresh requirements block new sanction where required. Done.

## Epic 4: LOS Workflow

Status: first executable slice complete.

Goal: complete origination from application to sanction and disbursement readiness.

Tasks:

- Application state machine. Done.
- Borrower self-service application capture. First governed slice done: the authenticated borrower portal lists safe active-term-product options and submits a session-grounded application with amount/tenor, destination-account identifiers, source/attribution, declaration and preferred-language evidence. Client-supplied borrower identity is ignored.
- Eligibility rules engine. Done, twice over: the JS first slice (EMI/FOIR affordability, age-at-maturity, amount/tenor bounds; plus policy-data multi-bureau underwriting per REV-30 — per-bureau score bands and knockout attributes read from `product.eligibility.bureauPolicy`, evaluating single or multiple `bureauReports[]` with the most conservative outcome winning) remains the default path, and the same policy is ported to the Rust decision engine (`rules/fixtures/lending-eligibility.json`, verified by a 542-case zero-divergence differential corpus). API call sites are wired through `LOANOS_RULES_ENGINE=off|shadow|active` (default off); run shadow to a clean window, then flip per tenant. See docs/architecture/decision-engine-design.md. Open hardening before the engine is on the critical path: gateway test coverage, a CI lane that starts `rules-service`, per-tenant instance routing, and `active`-mode reason lineage — tracked as REV-10..REV-14 in [review-findings-2026-07-12](review-findings-2026-07-12.md). Engine phase/status is authoritative in `docs/architecture/decision-engine-design.md` §15 (REV-03); do not restate it here.
- Underwriting policy rules. First slice done: approving a refer-band application requires a recorded manual underwriting override (underwriter, reason, policy reference), the named underwriter must be a registered, active credit officer, and a declined decision must cite a coded reason from the decline-reason taxonomy.
- Application documents and conditions. First governed slice done: product-driven required checklists; checksum/type/size/India-residency/malware evidence; quarantine; independent verification, deficiency and policy-backed waiver; maker-checker conditions precedent/subsequent; and evidence-backed independent satisfaction. Required documents block approval and open conditions precedent block disbursement.
- Manual review queue. Done: Eligibility `refer` outcomes route to a manual underwriting LWS task, task resolution/approval is gated on manual underwriting task assignment matching the override underwriter, and task completion is recorded.
- Maker-checker decision approval. Done.
- AI model-use evidence on decision. Done: proposeDecision retrieves model details from the registry and records a locked modelEvidence snapshot (version, validation refs, risk parameters) in the proposed decision.
- Offer generation and neutrality. Done: validateMarketplaceNeutrality and rankMarketplaceOffers implement multi-lender offer marketplace checks, dark-pattern prevention, partner completeness, and objective sorting.
- KFS generation from product policy. Done.
- Document packet model: KFS, sanction letter, agreement summary, privacy policy. First execution packet slice done.
- Rendered LMS statement document packet. First slice done: the period statement renders as a checksum-sealed HTML/text borrower document.
- Digital delivery evidence. First execution packet slice done.
- Sanction readiness gate. Done.
- Sanction validity and language-understanding evidence. Done for the governed digital path: final approval attaches the policy window; expired sanction fails closed; KFS records the chosen language and non-English acceptance requires matching confirmation evidence.
- Disbursement readiness gate. Done, including required-document, conditions-precedent and sanction-expiry checks for governed borrower applications.
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
- Balanced finance subledger. Controlled first slice done: `buildLoanJournalEntries` and finance projections feed balanced journals, trial balance, immutable posting runs, GL delivery packages, downstream reconciliation, and close blockers. Product policy owns the accounting profile frozen on each account. Co-lender entity legs and a checksum/line-count-bound mock-or-real core-banking delivery boundary exist; institution-specific chart expansion, vendor payload mapping, signing/encryption, and credential-vault onboarding remain planned.
- Controlled GL posting and handoff. Governed first slice done: posting runs snapshot balanced journals; `loanos.gl.v1` exports carry exact totals, line count, and checksum. Each API/SFTP/file delivery attempt is immutable and requires an accepted acknowledgement matching checksum and line count. A separately approved downstream reconciliation compares checksum, totals, and line count; any variance becomes a finance exception. Vendor-specific transport, signing/encryption, delivery workers, and external credentials remain planned.
- Reconciliation certification. Strengthened slice done: certification now requires every journal posted, every posting run accepted by downstream GL and exactly reconciled, and no open finance, provider, bank, suspense, or tax blockers. The named certifier and approval reference are audit-sealed.
- Finance exception operations. First slice done: rejected/mismatched GL acknowledgements and subledger variances enter an owned queue with due-date assignment and maker-checker remediation. Resolving an exception cannot bypass the underlying delivery/reconciliation blocker.
- EOD/BOD and period close. Governed first slice done: approved India-timezone daily/month-end schedules retain cutoff/open times and holiday-calendar evidence. EOD posts the remaining balanced journal inventory and creates delivery packages, then pauses at the external acknowledgement boundary; completion independently certifies and closes only after exact GL reconciliation. BOD requires the prior date's completed EOD and closure. Month-end close requires a closed period-end date, no finance blockers, non-overlap, and maker-checker approval. Business-date reopen invalidates its certification and is prohibited inside a closed finance period. A durable clock-driven worker, real holiday-calendar evaluation, missed-run alerts, and governed period reopen remain planned.
- ECL provisioning. Governed first slice done: independent maker-checker approval creates versioned PD/LGD parameter sets; assessments reference an approved set, derive Stage 1/2/3 from IRAC-aware account state, and calculate EAD × PD × LGD. Approved provision snapshots calculate movement against the prior allowance and produce balanced `ecl_expense ↔ ecl_loss_allowance` journals included in trial balance, posting runs, GL export, and close blockers. Forward-looking scenarios, overlays, collective assessment, model validation, and regulatory disclosure schedules remain planned.
- IRAC income recognition. Governed first slice done: only an NPA account with accrued, unpaid, not-already-reversed interest can post a maker-checker income reversal. The adjustment creates a balanced `interest_income ↔ interest_receivable` journal, participates in posting/close, and cannot be backdated into a closed period. NPA memorandum interest is retained off-book with policy evidence, while recovery recognition must link an actual interest-bearing payment to the earlier reversal and cannot exceed either leg. Automated suspension accrual and portfolio IRAC schedules remain planned.
- Tax operations. Governed first slice done: assessed taxable charges split fee income from `output_gst_payable`; a unique charge event issues one numbered GST invoice, and a maker-checker credit note reverses fee income, GST payable, and receivable through posting/close. GST return data nets invoices and credit notes. Maker-checker TDS records calculate gross/net/withholding in paise, produce balanced expense/bank/`tds_payable` journals, issue unique certificates, and feed a dated TDS return extract. GSTIN validation, statutory numbering administration, challan/payment integration, correction returns, and external tax-system integration remain planned.
- Ind AS effective interest. First slice done: maker-checker period records calculate EIR interest from opening amortised cost, effective rate, and exact day count; the difference from contractual interest posts as a balanced deferred-origination-fee/interest-income journal and participates in posting and close. Automated cash-flow IRR solving, modification accounting, derecognition, and portfolio disclosures remain planned.
- Treasury and ALM. First slice done: approved INR funding facilities retain lender, limit, outstanding, maturity, and annual cost; allocations bind facility funding to individual loans without exceeding available outstanding. The ALM report buckets contractual loan inflows and facility maturities into five horizons with period and cumulative gaps. Behavioural assumptions, undrawn commitments, prepayment/runoff scenarios, interest-rate sensitivity, and regulatory ALM formats remain planned.
- Profitability and RAROC. First slice done: the profitability report combines account interest, base-fee income, attributed facility cost, latest ECL, net contribution, explicit economic capital, and RAROC per loan/product. Co-lending transfer-pricing reports now add partner-level average outstanding, funding cost, servicing fee, collections, payable, and contribution margin. Branch/channel/customer dimensions, operating-cost allocation, scenario comparison, and board MIS remain planned.
- Co-lending finance. Governed finance layer done (REV-72): allocation is paise-exact, immutable before first GL posting, and frozen with funding, interest, fee, transfer-price, servicing, GST, and TDS economics per regulated entity. Loan and ECL movements split into balanced entity books; partner provision reports reconcile exactly to the institution allowance. Period statements calculate GST/TDS-adjusted net payable, a checksum-sealed maker-checker tax invoice exchange must be accepted exactly, and settlement requires an accepted checksum-bound escrow instruction. Mismatches enter the shared finance-exception queue; inter-company, provision, tax, and settlement gates block finance close. The integration boundary can submit escrow instructions and exact GL batches to mock or real India-resident providers and fails closed on mismatched acknowledgements. Recovery-sale economics, real vendor payload mapping/signing/encryption, credential-vault onboarding, and production provider certification remain planned.
- Tax filing evidence. First slice done: GST now allocates output tax into paise-exact CGST/SGST or IGST according to supplier state and place of supply. Approved GST/TDS filing snapshots are checksum-sealed and retain accepted/rejected acknowledgement evidence; unacknowledged filings block finance certification. GSTIN verification, statutory series administration, challan/payment integration, and live GSTN/Income Tax filing adapters remain external work.
- Repayment schedule generator. Multi-structure slice done (REV-40): one shared KFS/LMS generator honors weekly, fortnightly, monthly, or quarterly frequency and produces paise-exact amortising, bullet, deferred-or-serviced moratorium, and step-up schedules. Irregular/holiday calendars, balloon, step-down, seasonal cash flows, and structure-preserving modification simulations remain planned.
- EMI/amortization calculator. Done for supported structures; exact integer-paise money math (REV-20) carries principal without drift. Affordability-path EMI in `eligibility.js` remains a monthly-term estimate pending product-aware underwriting and the decimal-engine cutover.
- Revolving credit and overdraft. Governed first slice done (REV-41): policy/KFS distinguish facility type and disclose limit, drawing power, expiry, minimum payment, review cadence, daily actual/365 utilisation interest, and an illustrative full-utilisation cash flow. The LMS has no fixed EMI schedule; maker-checker draws cannot exceed available drawing power, daily interest posts immutably, repayments restore limit without closing a zero-balance facility, reviews cannot create unapproved excess, statements expose utilisation, and draw/accrual/payment journals flow through finance close. Stock/book-debt statements, formula drawing power, ad-hoc limits, covenants, current-account sweeps, renewal/recall, and BNPL-specific cycles remain planned.
- Interest accrual. First slice done: scheduled interest is recognized as immutable `interest_accrual` ledger events per installment, idempotent, reconstructable from the ledger, and reconciled against the schedule.
- Payment allocation. Governed first slice done: each product version owns a validated permutation of interest, charges, and principal; the waterfall is frozen on disbursement and retained on every payment event. Institution-specific component expansion and allocation simulation remain planned.
- Payment operations. Governed first slice done: unidentified, advance, excess, and mismatched receipts enter a tenant-scoped suspense ledger; partial resolution into a loan or residual write-off requires maker-checker approval and produces balanced bridge journals. The reconciliation-break queue merges provider, bank, and suspense exceptions with ageing, ownership, due dates, resolution links, and controlled write-off. Finance certification blocks while suspense remains open.
- Value-date corrections and controlled reprocessing. First slice done: an independently approved correction posts through the normal idempotent loan-payment authority, retains value date versus receipt date, reason, approval evidence, and backdated flag, and refuses closed-period or future-value-date posting. Full bulk replay/orchestration and correction-versus-reversal policy matrices remain planned.
- Payment batches. First slice done: provider settlement files are checksum-sealed, idempotent, row-acknowledged, and retain invalid/exception rows without crediting a borrower. Due NACH batching derives overdue amounts from the loan ledger, requires a registered mandate, caps at mandate value, and prevents a second pending/settled presentation for the same oldest due date. Live provider file schemas, SFTP/API transport, cryptographic provider signatures, retries, and automated EOD scheduling remain external/planned.
- Charges, waivers, reversals. First slice done.
- SMA/NPA asset classification. Done; RBI IRAC upgrade guard (REV-21) added: an NPA account holds at `npa` until all principal and interest arrears are cleared — a partial catch-up that only drops DPD below 90 does not upgrade it. `classifyLoanAsset` reconstructs the class trajectory from schedule + ledger and exposes `dpdAssetClass`, `npaHeldForArrears`, and `basis`.
- Part prepayment and foreclosure. Foreclosure first slice done: payoff quote (principal + due interest + charges + KFS-disclosed foreclosure charge), full-payoff settlement, and account closure. Part-prepayment first slice done: over-EMI payment reduces principal and re-amortizes the remaining schedule in reduce-EMI or reduce-tenure mode.
- Closure and NOC. First slice done: a settled account issues a checksum-sealed No-Objection Certificate (no dues, security release), gated on closed status and zero outstanding, with idempotent re-issue.
- Borrower statements. First slice done.
- CIC-ready reporting snapshot. First slice done.
- Tests for ledger reconstruction, statement accuracy, classification, and CIC snapshots. Done: integrated tests verify balance reconstruction from raw ledger history, statement alignment, SMA asset classifications, and generated CIC reporting snapshots.

Done when:

- Balance can be rebuilt from ledger events.
- Statements match ledger state.

## Epic 6: Collections, Recovery, and Delinquency

Status: controlled collections and statutory legal-recovery first slices complete; partner integrations and enforcement depth remain.

Goal: manage overdue accounts without violating borrower protection and recovery rules.

Tasks:

- Delinquency buckets. Done.
- Reminder and notice workflow. First slice done: `recordCollectionsReminder` (`packages/core/src/loan-account.js`) logs each borrower reminder/notice (channel, stage, delinquency state at the time) and enforces the RBI Fair Practices Code contact window — voice-channel (call/IVR) recovery contact outside 08:00–19:00 IST is blocked; asynchronous channels are unrestricted. `POST /loan-accounts/{id}/reminders` drives it and seals a `loan_account.reminder_sent` event into the audit spine.
- Recovery-agent registry. Done: `packages/core/src/recovery-agent.js` empanels a recovery agent against an active regulated entity, requiring (for `active` status) due-diligence/police-verification evidence, a training-certification reference, a signed code-of-conduct acknowledgment, and an authorization-letter/ID-card reference. `POST/GET /recovery-agents`, `GET /recovery-agents/{id}` drive it; `assignRecoveryAgent` now blocks a recovery assignment unless `recoveryAgentId` names a registered, active agent.
- Recovery-agent assignment notice before contact. Done.
- Cash recovery exception workflow. Done: cash is treated as an exception channel, not the default — `postCashRecoveryToLoanAccount` (`loan-account.js`) requires a coded `exceptionReason` (`CASH_RECOVERY_EXCEPTION_REASONS`; `other` requires a narrative) plus `approvedBy`/`approvalRef`, and the API additionally role-checks `approvedBy` against a registered, active `collections_manager` staff actor (`validateCashRecoveryApprovalAccess`) before the domain gate runs.
- Same-day cash recovery posting. Done.
- Telecalling and field execution. First slice done (REV-51): assigned-agent call, IVR, and field-visit contacts retain disposition, delinquency snapshot, timestamp, evidence reference, and conduct-hour validation; field visits require valid latitude/longitude plus geo-evidence. Live dialer campaigns, route planning, offline mobile sync, and media transport remain partner/planned.
- Promise-to-pay. Done for the core ledger slice (REV-51): each PTP links to an evidenced contact, carries paise-exact amount/date/actor lineage, and is deterministically evaluated as pending, kept, or broken from subsequent payment events without double-allocating the same payment across promises. Broken promises derive a high-priority collections task.
- Legal recovery. First slice done (REV-50): maker-checker strategy cases support SARFAESI, Section 138, Lok Adalat, arbitration, DRT, civil suit, and insolvency. SARFAESI requires NPA plus registered CERSAI security, issues a checksum-sealed Section 13(2) demand record with delivery evidence and a 60-day clock, and blocks early enforcement. Section 138 preserves cheque/memo evidence, enforces the 30-day notice limit and 15-day payment clock. Generic filing, hearing, order, settlement, withdrawal, and closure events are audit-sealed and task-driven. Possession/auction, track-specific pleadings, legal-expense accounting, advocate panels, court integration, and limitation engines remain planned.
- Hardship and restructure workflow. First slice done: `restructureLoanAccount` (`packages/core/src/loan-account.js`) modifies a stressed but active loan under maker-checker approval (four-eyes) — extending the remaining tenure and/or conceding the rate and re-amortizing the remaining principal over the new term (past installments untouched). The account is flagged `restructured`, which surfaces in `classifyLoanAsset` and the CIC snapshot. `POST /loan-accounts/{id}/restructure` drives it and seals the event into the audit spine.
- Settlement and write-off approval. First slice done: `settleLoanAccount` closes an active loan for less than the full outstanding under maker-checker approval (four-eyes) — the borrower pays the agreed amount and the RE waives (sacrifices) the shortfall via principal/interest waiver ledger credits, closing the account as `settled`; `writeOffLoanAccount` marks an account `written_off` as a book loss while retaining the borrower's legal dues on the ledger. Both are reported to the CIC snapshot (`settled`/`closureType`, `writtenOff`/`writeOffAmount`). `POST /loan-accounts/{id}/settlement` and `POST /loan-accounts/{id}/write-off` drive them and seal events into the audit spine.
- Tests for recovery notice, same-day cash posting, field evidence, PTP status, and statutory legal clocks. Done.

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
- Ongoing CDD, sanctions rescreening and AML transaction monitoring. Governed first slice done: current checksum-bound UN/UAPA/PEP/internal-negative lists and complete screening are mandatory; exact-paise activity profiles can escalate EDD; approved deterministic amount/velocity/structuring/geography/watchlist rules emit tipping-off-restricted alerts. Live list and transaction feeds, matching/tuning, case investigation and FIU operating procedures remain external/institutional.
- Fraud signal policy. Governed first slice done: versioned maker-checker weights cover device/IP/velocity/location/identity-link/entity-duplicate/negative-list/mule/early-warning facts and produce deterministic clear/refer/block results. Provider intelligence, graph resolution and investigator tooling remain planned.
- Portfolio and operational risk. Governed first slice done: exact-paise exposure aggregation, connected groups, risk-appetite limits/remediation, stress tests/capital buffers, RCSA/control/KRI/loss/action records, and checksum-sealed risk-committee packs. Institution data feeds, approved methodologies and committee operation remain external.
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
- Recurring cohort monitoring. Governed first slice done: a maker-checker period report binds an active model/version to cohort approval spread, bad rate and drift thresholds, and requires remediation evidence for any breach. Automated source feeds and independent model-risk validation remain institutional.
- Hallucination and adversarial testing for generative AI. First slice done: a model registered with `modelClass: "generative"` (or `generative: true`) must additionally evidence adversarial (`redTeamRef`) and hallucination (`hallucinationTestRef`) testing before validation can be approved — `transitionModel` blocks `approve_validation` otherwise, mirroring the high-risk fairness/explainability gate. Evidence is retained on the model.
- Customer-facing AI disclosure and human handoff. First slice done: `packages/core/src/ai-interaction.js` produces the mandated customer disclosure for a customer-facing, active model (blocked for back-office models, inactive models, or while the global kill switch is on) via `GET /ai/models/{id}/disclosure`, and records human-handoff requests (`requestHumanHandoff` → pending, `resolveHumanHandoff` → handled by a named human agent) via `POST/GET /ai/handoff-requests` and `POST /ai/handoff-requests/{id}/resolution`, sealing `ai.human_handoff.*` events into the audit spine.
- AI incident workflow. First slice done: a kill-switch trigger opens an incident record tracking scope, reason, trigger actor, and status.
- Kill-switch post-incident review. First slice done: the global switch cannot be cleared until a post-incident review (root cause, remediation) is recorded, and clearance closes the incident while retaining the evidence.
- Tests for global/model/workflow kill switch.

Done when:

- No model can be called unless inventory, validation, status, and kill-switch gates pass.

## Epic 9: Regulatory Reporting and Integrations

Goal: generate required reporting evidence from runtime data.

Tasks:

- CIC reporting feed. Governed external-boundary slice done: canonical UCRF batches preflight borrower-alert evidence, submit through the certification-gated provider adapter with checksum/idempotency evidence, and reconcile record-complete HMAC callbacks. Proprietary CIC certification remains external.
- CKYC integration. Governed external-boundary slice done: checksum-sealed CKYCRR packets submit through the certification-gated adapter and accepted/rejected/probable-match HMAC callbacks reconcile into the provider-owned identifier lifecycle. CKYCRR conformance certification remains external.
- Account Aggregator integration. Governed external-boundary slice done: active consent and one-time/periodic frequency are preflighted before provider invocation; retained evidence is limited to provider ref, count, India residency and payload hash. AA/FIP ecosystem onboarding remains external.
- CERSAI security-interest registration, modification, satisfaction. Governed canonical submission slice done: packet checksum, provider submission reference, fee/certificate evidence, signed callback reconciliation, rejection repair, maker-checker modification, closure-gated satisfaction, prior-encumbrance search, and the secured-loan disbursement gate. Certified gateway schema and live onboarding remain planned.
- DLA CIMS export.
- FIU-IND suspicious transaction support. Governed FINnet slice done: STR/CTR/CCR packets (ARF/TRF/CRF), Principal Officer review, CTR threshold, tipping-off guard, provider submission reference, signed checksum-bound callback acknowledgement/rejection, and approved repair lineage. Certified XSD/rule-set validation and live FINGate onboarding remain planned.
- Payment integrations: NACH/UPI/bank account verification. Bank-account verification first slice done: `ExternalServiceManager` provides mock/real provider switching, the tenant API returns sanitized active-account/name-match evidence, and disbursement is blocked without matching verified-account proof. NACH/UPI first slice done: `ExternalServiceManager` registers NACH mandates, creates NACH presentments, and creates UPI collect requests through mock/real payment rail providers with India residency enforcement; the tenant API stores masked/hash-only initiation evidence in `GET /payment-rails` and seals financial audit events. UPI and NACH settlement callbacks reconcile idempotently by provider event reference, post only exact matched collections to the loan ledger, and retain failed/returned/unmatched/mismatched callbacks for exception handling in `GET /payment-reconciliations`. Bank statement entries now match only to already-posted provider settlements through `GET /bank-reconciliations`; unmatched bank credits remain finance exceptions. Refunds and production provider onboarding remain planned.
- eSign/document vault. Done: signed document packets are indexed into a tenant-scoped document vault with signature evidence, storage country (enforced to 'IN'), retention policy, per-document HTML and PDF checksums, and manifest checksum. Supports mock external eSign envelope storage tracking (recording unique envelope IDs and partner storage URLs). Provides a vaulted document download sub-resource endpoint with format negotiation (HTML vs binary PDF).
- SMS/email/WhatsApp delivery provider. First slice done: `ExternalServiceManager` supports SMS/email/WhatsApp mock/real provider switching with India data-residency enforcement, and the tenant API stores masked/hash-only communication dispatch evidence. Production vendor onboarding remains planned.
- Provider certification and vendor data-residency checks. Product control plane done: all 15 external families require India residency; real readiness additionally requires endpoint, credential, current production certification, evidence SHA-256 and four-eyes approval. Certification suspension/expiry fails closed. Commercial/provider/regulator onboarding remains external per RE.

Done when:

- Reporting exports can be generated from source-of-truth records, not manual re-entry.

## Epic 10: Security and Production Platform

Goal: production-grade operating platform for regulated data.

Tasks:

- Authentication. Enterprise control layer complete: tenant OIDC/SAML policies require HTTPS metadata, MFA, PKCE or signed assertions, allowed domains, explicit group mapping and independent checksum/test certification. Live token validation and IdP connectivity remain deployment work.
- SCIM provisioning. Enterprise control layer complete: idempotent policy-bound provisioning/deactivation creates passwordless federated users, rejects local-account takeover and immediately invalidates deactivated-user session resolution. Live SCIM bearer/connector operation remains deployment work.
- Role-based access control.
- Maker-checker authorization policies.
- Secrets management. First containment slice done: named credentials can be declared compromised through `POST /admin/service-credential-compromises`; selected or all active credentials are revoked fail-closed, each revocation is linked to a high/critical tenant incident, and CERT-In/RBI clocks plus audit evidence start immediately. External secret-vault/KMS custody, workload identity, and automated leak detection/rotation remain planned.
- Audit log hardening.
- Encryption at rest and in transit. Application-envelope first slice done for both file and Postgres drivers: tenant-bound HKDF/AES-256-GCM encryption, ciphertext-only tenant JSON, authenticated key-version metadata, and fail-closed unavailable-key behavior. Production managed database/WAL/replica/backup evidence, field/object encryption, and transport-certificate operations remain planned.
- Key management. Governed rotation plus enterprise-attestation layer done: a versioned local provider supports re-encryption; managed-key evidence now requires India-region, non-exportable HSM custody, purpose, dual control, rotation and destruction policy, and database/PITR controls resolve purpose-correct attestations. Direct KMS/HSM calls, grant validation, scheduled ceremonies and destruction execution remain deployment work.
- Secure SDLC scanning. Governed first slice done: an artifact/revision-bound bundle requires exactly one SAST, DAST, dependency, container, IaC, and secret scan with tool/version, ruleset, timestamps, evidence, execution status and severity counts. Missing/failed scans and untracked severe findings block release approval. External scanner execution, authenticated pipeline submission, report/signature validation, ruleset administration, coverage metrics, and penetration/red-team integrations remain planned.
- SBOM and vulnerability governance. Governed first slice done: CycloneDX/SPDX metadata binds the signed SBOM document checksum to the release artifact; vulnerabilities carry severity SLAs, ownership, triage, change/remediation/fixed-version evidence, independent retest and closure. Critical exceptions are forbidden; other risk acceptance requires compensating controls, maker-checker approval and at most 90-day expiry. CVE/KEV/advisory feeds, VEX/reachability, deduplication, automated tickets/escalation/patching, signature verification, false-positive workflow, metrics and board reporting remain planned.
- Observability and alerting. First operational slice done: the API keeps a bounded, process-local request window with normalized low-cardinality routes, availability and latency SLIs, configurable SLOs, error-budget state, in-flight/capacity signals, and a token-protected Prometheus scrape. Tenant and platform health APIs combine those runtime signals with provider readiness, circuit state, overdue workflow SLAs, unresolved reconciliation/suspense/finance exceptions, and pending provider work. Durable metrics/log/trace storage, multi-replica aggregation, dashboards, SIEM export, external paging/notification, alert acknowledgement/suppression, and on-call ownership remain planned.
- SIEM/SOC and security investigations. Governed detection/investigation plus custody-attestation layer done: independently approved rules/alerts/investigations retain evidence, while supported log families can now be certified for authenticated schema-bound collection, encryption, trusted time, searchable immutable India custody and ≥180-day retention. The SIEM/log lake, WORM/NTP/collectors, UEBA/threat intelligence, SOAR, forensics, staffing and effectiveness exercises remain external.
- Backup, HA and PITR. Recovery packages remain executable. Enterprise controls now require one PostgreSQL primary plus synchronous standby across India AZs, RLS/pooling/encryption/automatic failover, continuous WAL, full/incremental schedules, ≥35-day immutable cross-account India custody, purpose-attested backup keys, bounded RPO/RTO, restore drill and corruption evidence. Actual database/replication/WAL/archive infrastructure remains deployment work.
- DR and BCP runbooks. Governed exercise first slice done: non-destructive backup-restore, corruption, AZ/region failover, failback, and business-continuity drills decrypt and fully validate the chosen recovery point, measure target versus actual RPO/RTO, retain findings/actions, require maker-checker evidence, and appear in platform recovery history. Real multi-AZ/region replication, traffic/data failover and failback automation, dependency continuity, business workarounds, tenant communications, and independently witnessed exercises remain planned.
- Release and rollback governance. Existing immutable release/canary/rollback authority now joins a production automation policy that requires India targets, source/IaC checksum, signed artifact/SBOM/provenance verification, vault secrets, expand-contract migration, progressive delivery, automatic rollback, drift controller and ready HA/PITR/capacity dependencies. CI/CD/cloud controller execution and authenticated evidence submission remain deployment work.
- API, event and webhook governance. Governed layer complete: checksum-bound OpenAPI 3.1 contracts declare auth/tenancy/errors/idempotency; contiguous event schemas require tenant/order/idempotency fields and reject removal/type changes; HTTPS vault-backed India subscriptions produce checksum/idempotency/sequence-bound delivery, exponential retry and dead-letter evidence. Portal/SDK generation, signing/dispatch workers, partitioned queues and replay operation remain deployment work.
- Configuration drift and environment parity. First slice done: approved per-environment non-secret baselines are canonically hashed; secret values are rejected in favor of KMS/vault references; runtime snapshots produce exact missing/unexpected/changed/ref drift; and two approved environments can be compared with explicit environment-scoped exclusions. Automated collectors, policy-as-code/IaC reconciliation, continuous drift alerts, secret-version posture, and remediation workflow remain planned.
- Performance and resilience testing. First slice done: a bounded dependency-free concurrent HTTP probe measures exact request/error counts, p50/p95/p99, throughput, duration, concurrency, and status distribution; governed assessments recompute error rate/throughput rather than trusting supplied summaries, compare declared thresholds, require maker-checker evidence, and retain findings/actions. Production-scale soak/volume/chaos tests, realistic lending/finance workloads, database/queue saturation, dependency fault injection, capacity models, and scheduled regression gates remain planned.
- Support and problem management. Governed first slice done: severity-based acknowledgement/restoration/resolution clocks, affected-service and incident lineage, runbook reference, on-call/team assignment, monotonic escalation, measured SLA outcomes, evidence-backed resolution, independent closure, and root-cause/corrective-action problem records are projected from the platform audit chain. ITSM intake, paging/rosters, status communications, alert-to-ticket automation, 24x7 staffing, runbook drills, and tenant-facing support channels remain planned.
- Vendor SLA and dependency concentration. Governed first slice done: vendor tier/type, contract, residency/cross-border approval, due diligence, exit plan, review cadence, alternate-provider posture and service/tenant exposure are registered; periodic reviews require security/BCP/exit evidence; SLA assessment derives breaches; concentration assessment flags tenant-share thresholds, critical single points, and overdue reviews. Procurement/contract feeds, telemetry-derived SLA calculations, service credits, fourth-party mapping, portfolio/transaction/regional concentration, automated reminders, and contractual enforcement remain planned.
- Data retention/deletion jobs. Governed layer complete: borrower statutory cleanup/redaction remains automated; general evidence custody now enforces India-immutable storage, retention, legal-hold placement/release and proof-bearing deletion after holds expire.
- Audit anchoring and completeness. Governed layer complete: external timestamp/WORM evidence must match the verified chain head/count; critical application/account/CIC/CKYCRR/provider-certification records reconcile to their required audit events and failures remain explicit.
- Data lineage and quality. Governed layer complete: approved field-level source→versioned transform→output lineage plus declarative required/pattern/enum/unique/reference rules, hashed exceptions and fail-closed high-risk certification.
- Security tests and threat model. The scan/SBOM/vulnerability evidence and release gate are implemented; maintained threat models, abuse-case suites, independent penetration/red-team exercises, remediation/retest evidence and assurance reporting remain planned.
- Compliance control assurance and audit workspace. Governed first slice done: maker-checker plans target only canonical regulatory controls; tests retain population/sample/procedure/workpaper/evidence and effective/deficiency results; deficiencies become owned dated issues with independent remediation verification and closure; control-owner certification retains test/issue lineage and independent sign-off; internal/statutory/RBI engagements track evidence requests and management response; checksum-sealed committee packs derive test, issue, certification and engagement metrics. Granular obligation/control hierarchy, schedulers, statistical sampling, evidence/workpaper connectors, issue escalation/risk acceptance, confidential auditor spaces, regulator portals, e-signatures, rendered board papers/minutes/actions, trends/KRIs and independent operating-effectiveness procedures remain planned.

Done when:

- Production readiness gate can be reviewed by security, compliance, and risk.

## Epic 11: SaaS Tenancy and Platform Isolation

Status: S1–S6 first slice complete for every task (tenant partitioning, tenant-scoped service auth, tenant/platform human sessions, tenant user admin, access reviews, service-key rotation, isolation suite, hash-chained audit spine + evidence export, tenant portability export + evidenced offboarding, disclosed sub-processor register, 6-hour incident-notification workflow, audited platform-staff break-glass access, uniform audit provenance stamping).

Goal: LoanOS runs as a multi-tenant SaaS where cross-tenant access is impossible by construction and the platform satisfies RE outsourcing obligations.

Tasks:

- State partitioned into a control plane (tenant registry) and per-tenant data planes. Done.
- Tenant-scoped storage accessor; endpoint code cannot express a cross-tenant query. Done: handlers receive only their tenant's partition through a scoped store.
- Tenant registry in the control plane with isolation-tier and contract facts. First slice done (tenantId, name, isolation tier, status, hashed api key).
- Tenant-scoped API credentials and tenant-context middleware on every route. Done: tenant user session or `x-api-key`/bearer resolves the tenant, 401 otherwise.
- Tenant/platform human login and sessions. Done: `/auth/login`, `/auth/me`, and `/auth/logout` issue and revoke HTTP-only sessions backed by PBKDF2-hashed user credentials.
- Tenant administrative system. Done: `/admin/users`, `/admin/access-reviews`, `/admin/governance-summary`, default-key rotation, and named service-credential create/list/rotate/revoke support user provisioning, access certification, and independently scoped integration access.
- Platform control plane to onboard tenants. Done: the admin wizard and `POST /platform/tenants` can create the tenant shell, initial owner, regulated entity profile, first product policy, enabled module/flow blueprint, readiness checklist, and one-time api key stored only as a hash; `GET /platform/onboarding-options` and `GET /platform/tenants/{id}/onboarding` support wizard metadata and readback.
- Cross-tenant isolation regression suite covering every resource type. Done.
- Platform-staff break-glass access with audit and tenant reporting. First slice done: `POST /platform/tenants/{id}/break-glass` (platform admin) mints a time-boxed, tenant-scoped break-glass credential (returned once, stored only as a hash); presenting it via `x-break-glass-key` authenticates as that one tenant and seals a `platform.break_glass.access` event (staff id, reason, method, path) into the tenant's own audit chain on every request. Tenants read every grant scoped to them via `GET /break-glass-grants`; `POST /platform/break-glass/{grantId}/revoke` and TTL expiry immediately stop authentication.
- Hash-chained, tenant-scoped audit event module; migrate module event emission onto it. Done: `packages/core/src/audit.js` seals each tenant's events into a tamper-evident SHA-256 chain on every save.
- Uniform actor/data-class stamping on audit events. Done: `stampAuditEvents`/`classifyAuditDataClass` (`packages/core/src/audit.js`) centrally fill an `actor`/`actorType`/`dataClass` provenance envelope on every event at the seal seam — attributed to the tenant on ordinary requests and to platform staff under break-glass — so no handler can persist an unclassified event and the envelope is hashed into the chain.
- Evidence export pack generated from the audit spine. Done: `GET /audit/export` (integrity-attested, filterable) and `GET /audit/events` (chain + validity verdict).
- Tenant onboarding/offboarding workflow with exit/portability export and evidenced deletion. First slice done: platform onboarding captures tenant, owner, RE, product, module/flow choices, and readiness in one transaction; `GET /platform/tenants/{id}/export` returns a reproducible portability pack (control record + full data plane + audit evidence pack), and `POST /platform/tenants/{id}/offboarding` performs evidenced deletion — purging the data plane, revoking the api key, and retaining a control-plane deletion attestation (erased event count, audit head hash, content digest, actor, reason).
- Incident notification workflow supporting RE 6-hour RBI reporting and CERT-In duties. First slice done: `packages/core/src/incident-notification.js` records a tenant-scoped security/data incident and runs an independent 6-hour reporting clock per authority (CERT-In 2022 and RBI). `POST/GET /incidents`, `GET /incidents/{id}`, and `POST /incidents/{id}/notifications` capture reports and regulator acknowledgements; a duty unreported past 6 hours from detection surfaces as `overdue`/`reporting_overdue`, and every report and notification is sealed into the audit spine.
- Sub-processor register. First slice done: `POST/GET /platform/sub-processors` (platform admin) maintains a control-plane register requiring a data-processing agreement and a declared data-residency country per sub-processor; `GET /sub-processors` exposes it to every authenticated tenant as a standing disclosure, flagging cross-border processing.

Done when:

- No API call executes without an authenticated tenant context. Done.
- The isolation suite proves two provisioned tenants cannot touch each other's data. Done.
- A full tenant export is reproducible from source-of-truth records. Done.
