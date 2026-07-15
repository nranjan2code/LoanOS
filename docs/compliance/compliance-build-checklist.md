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
| RE remains responsible for LSP/DLA actions | Tenant model requires RE; LSP registry links each LSP to an active RE and blocks active LSPs without agreement, oversight, data, fee, and review evidence. | Done |
| Active RE setup before origination | Regulated entity registry validates RE type, India country, website, privacy policy, grievance officer, board policies, and data residency. | Done |
| LSP agreement and due diligence | LSP registry validates agreement/scope, enhanced due diligence, periodic review, portfolio monitoring, borrower-facing grievance/privacy disclosure, and recovery guidance where applicable. | Done |
| Multiple-lender LSP offer neutrality | Offer marketplace with ranking disclosure and dark-pattern checks. | Done |
| Default Loss Guarantee (DLG) | `dlg.js` empanels a DLG arrangement against an eligible LSP provider governed by the RE, enforces the 5% portfolio cap, permitted forms (cash deposit / FD lien / bank guarantee), and a cover-tenor floor; invocation enforces the 120-day window from overdue and consumes cover up to the cap without deferring the RE's own NPA classification. | Done |
| Co-lending arrangements | `co-lending.js` validates partner funding/economic/tax shares, originating-RE retention, blended-rate disclosure, escrow routing, and paise-exact allocation. `co-lending-finance.js` produces balanced entity books, entity-level ECL movements, transfer pricing, GST/TDS-adjusted statements, checksum-sealed tax exchange, escrow-gated settlement, inter-company certification, and close blockers. Mock-or-real escrow/CBS adapters enforce India residency and exact acknowledgements; real provider onboarding/certification remains external. | Partial |
| Account Aggregator (AA) data sharing | `account-aggregator.js` runs the consent lifecycle and frequency gates; the provider boundary now performs mock/real FI fetch after preflight and retains only provider reference/count/residency/payload hash. Real mode additionally requires an active production certification; Sahamati/AA/FIP onboarding remains external. | Partial |
| Borrower economic profile | Age, occupation, income required in preflight. | Done |
| Creditworthiness assessment before sanction | Eligibility engine computes EMI/FOIR affordability, age-at-maturity, and amount/tenor bounds; ineligible borrowers cannot be approved. | Done |
| Authenticated borrower application capture | Borrower portal lists safe active term-loan options and creates a session-grounded application; client-supplied borrower identity is ignored and declaration/source/language evidence is retained. | Partial |
| Origination document control | Product checklist drives required types; uploads retain checksum, MIME, size, India residency and malware-scan evidence; infected files quarantine; independent review/deficiency/waiver gates approval. Binary object storage and authenticated production scanner/DLP/OCR remain planned. | Partial |
| KFS before execution | KFS validation and acceptance gate. | Done |
| Product policy before origination | Product registry validates active RE link, board approval, INR, amount/tenor bounds, APR (must be ≥ annualInterestRateBps + annualised mandatory charge floor), cooling-off, recovery mechanism, sanction-validity days, optional typed document requirements, eligibility, charges, and mandatory `pricingPolicyRef`. `interestCalcMethod` must be `reducing_balance` or `flat`; flat-rate products must additionally disclose `flatToEirBps` (flat-to-EIR equivalent). | Done |
| Product policy versioning and effective dates | A higher `version` publishes a new policy version, archiving the superseded window; `selectProductPolicyVersion`/`?asOf=` resolve the version governing a given date. | Done |
| Digitally delivered KFS/documents | KFS delivery evidence gates decision; execution document packet delivery gates disbursement. | Done |
| Borrower communication dispatch evidence | SMS/email/WhatsApp provider boundary enforces India data-residency posture and stores masked/hash-only dispatch receipts. SMS additionally requires TRAI DLT registration (`dltEntityId`, `dltTemplateId`, registered `senderId`) or the dispatch is blocked. | Done |
| Direct disbursement to borrower/end-beneficiary | LSP/pass-through disbursement blocked; disbursement now requires verified active borrower/end-beneficiary bank-account evidence matching the destination account. | Done |
| Conditions precedent and sanction validity | Maker-checker conditions retain policy/evidence lineage; open precedent conditions and expired sanction validity fail closed at disbursement. | Done |
| Direct repayment to RE account | LSP/pass-through repayment blocked. | Done |
| NACH/UPI payment rail initiation evidence | Mock/real payment rail provider boundary registers NACH mandates, creates NACH presentments and UPI collect requests with India data-residency enforcement; tenant ledger stores masked/hash-only rail evidence and seals financial audit events. UPI and NACH settlement callbacks are idempotently reconciled to their initiated collections and post only exact matched payments; unknown, failed, returned, and mismatched callbacks remain exceptions. Bank-statement reconciliation remains planned. | Partial |
| LSP fees paid by RE, not borrower | LSP registry requires RE-paid fee controls and blocks separate borrower-charged LSP fees; vendor settlement module planned. | Partial |
| Recovery-agent notice before contact | Recovery assignment requires borrower notice evidence before a recovery agent can contact the borrower. | Done |
| Grievance officer and 30-day escalation path | Staff actor role, complaint registry, 30-day SLA, LWS grievance queue, and RBI CMS escalation evidence. | Done |
| Data minimization and explicit consent | Consent evidence required at preflight, backed by the purpose-specific consent ledger below. | Done |
| Purpose-specific consent ledger | Borrower-linked consent records track purpose, notice version, status, accepted/revoked timestamps, and evidence reference. | Done |
| India data storage | Primary storage country required as IN. | Done |
| Overseas processing return/delete within 24 hours | Processing duration check implemented. | Done |
| DLA CIMS reporting | Active DLA registry validates own/LSP app and web surfaces, CCO/compliance attestation, grievance contact, RE website linkage, India data controls, and exports CIMS-ready rows. | Done |
| CIC reporting | Internal account-level and portfolio-level CIC-ready snapshots from ledger/schedule state; external CIC submission planned. | Partial |
| Prepayment/foreclosure policy rules | Product registry validates interestRateType, interestRateResetPolicy, prepaymentPolicy, and foreclosurePolicy; blocks charging foreclosure/prepayment fees on floating-rate individual retail loans. | Done |
| Floating-rate reset options | resetFloatingRate allows rate resets under maker-checker flow and re-amortizes schedule based on borrower choice (extend tenor, increase EMI, switch to fixed). | Done |


## KFS for Loans and Advances

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| KFS generated before sanction | KFS is required before decision. | Done |
| APR disclosed | KFS requires `aprBps`. | Done |
| Loan amount and tenor disclosed | KFS requires principal and tenor. | Done |
| Language understood by borrower | KFS records the journey language; non-English acceptance requires matching borrower language-confirmation evidence. Translated legally approved template libraries remain planned. | Partial |
| Cooling-off period | KFS requires at least one day. | Done |
| Recovery mechanism | KFS requires recovery mechanism. | Done |
| Grievance officer | KFS requires name and email. | Done |
| Undisclosed fees cannot be charged later | Ground KFS charges in Product Policy and block ad-hoc, foreclosure, and prepayment ledger charges exceeding KFS/policy limits. | Done |
| Digitally signed/rendered KFS | HTML/text/PDF document packet renderer with checksum and delivery evidence; eSign creates a signed packet and document-vault receipt with manifest checksum. Certified external envelope onboarding remains planned. | Partial |
| KFS workflow state | Server derives terms from the approved product/application, computes cash-flow APR and amortisation, delivers a time-bound proposal, then requires a separate authenticated borrower acceptance bound to session and proposal. | Done |

## Fair Lending and Penal Charges

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Penal charges, not penal interest | KFS validator blocks `penal_interest`. | Done |
| No capitalization of penal charges | KFS validator blocks capitalizing penal charges. | Done |
| Reasonable and non-discriminatory policy | Product policy registry and board-approved policy. | Planned |
| Upfront disclosure | KFS charge name, reason, and type validation are enforced. | Done |
| Product-level penal-charge safety | Product policy rejects penal interest and capitalization for penal charges. | Done |

## KYC, AML, CFT

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| KYC verified before lending | Preflight requires verified KYC. | Done |
| Risk categorization | Validates low/medium/high. | Done |
| Borrower profile and economic profile | Borrower registry captures India borrower profile, contact channel, and economic profile for active borrowers. | Done |
| KYC record expiry | Borrower-backed application resolution blocks expired verified KYC records. | Done |
| KYC periodic-review refresh | A verified KYC record past its RBI risk-based review cycle (high 2y / medium 8y / low 10y) reads as `refresh_required` and blocks new sanction. | Done |
| CKYC search/download/upload | Consent/authentication-gated download plus governed individual/legal-entity canonical packets, scan/photo constraints, maker-checker, signed transport, provider response, provider-only identifier assignment, customer notice, and seven-day probable-match resolution. Certified CKYCRR bulk/API wire serialization and a live CERSAI connection remain external integration work. | Partial |
| V-CIP evidence | V-CIP evidence vault validates video hash, liveness, face match score (>=0.8), India GPS coordinates, official actor role (kyc_officer/credit_officer), and digital signature. | Done |
| Screening-list refresh and ongoing CDD | Current, checksum-bound UN, UAPA, PEP and internal-negative lists plus complete rescreening are mandatory for a maker-checker CDD review. Purpose/nature, source of funds, beneficial ownership, exact-paise transaction-profile deviation, geography risk and the next review date are retained; production feeds, matching and disposition operations remain external. | Partial |
| Transaction monitoring | Approved deterministic amount, velocity, structuring, geography and watchlist rules consume exact-paise transaction facts and emit restricted, checksum-bound AML alerts. Streaming transaction ingestion, scenario calibration and investigation operations remain deployment/institution work. | Partial |
| FIU-IND reporting support | STR/CTR/CCR records emit checksum-sealed canonical FINnet XML (TRF/ARF/CRF), block incomplete KYC/transaction/CCR data, require Principal Officer STR review, retain India-resident provider submission evidence, reconcile exact accepted/rejected responses, and create independently approved source-repair replacements. The FIU-published XSD/rule-set validation and live FINGate certification remain external adapter work. | Partial |
| Beneficial-owner checks for legal entities | Verified declaration evidence is mandatory. Ownership thresholds are >10% for companies/partnerships/LLPs, >15% for unincorporated associations, and ≥10% for trusts; trust authors, trustees and beneficiaries/controllers are verified, with senior-management fallback only after declaring no natural owner. | Done |

## Aadhaar and UIDAI Constraints

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Do not store biometric/OTP/PID | Preflight blocks those flags. | Done |
| Encrypted PID boundary | Aadhaar connector boundary. | Planned |
| Audit metadata only where allowed | Connector audit policy. | Planned |

## DPDP Act and Rules

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Granular notice and consent | Purpose description, data categories, retention criterion and equivalent withdrawal mechanism are mandatory; third-party sharing also names recipients/classes. | Done |
| Personal-data breach notice | Tracks notice without delay to affected principals and the Board, plus the detailed Board submission within 72 hours, alongside CERT-In/RBI clocks. | Done |
| Notice and consent evidence | Consent timestamp and notice version required. | Done |
| Consent revocation | Consent ledger with revocation workflow (revoked consent blocks borrower resolution). | Done |
| Third-party disclosure record-of-processing | `data-sharing.js` logs every disclosure; consent-basis sharing requires an active `third_party_sharing` consent, legal-obligation-basis sharing requires a cited legal reference. | Done |
| Data principal rights (erasure) | Right-to-erasure workflow (`data-retention.js`) gated on statutory retention (active loan or 5-year RBI/PMLA window); fulfilment/cleanup redacts the borrower profile, KYC records, and beneficial owners in place. | Done |
| Data principal rights (access/correction) | `data-principal-rights.js` implements access requests (assemble a portable data pack: profile, consent ledger, KYC summary, loan accounts, disclosures) and correction requests (apply/reject a field change, applied corrections propagate to the borrower profile), both under a 30-day DPDP SLA clock with overdue detection and LWS task derivation. | Done |
| Breach workflow | Incident tracking with independent CERT-In/RBI six-hour clocks, immediate affected-principal and Board notices, a detailed Board notice within 72 hours, and overdue detection. | Done |
| Retention and deletion | Statutory-retention-gated erasure workflow implemented for borrower profiles, KYC records, and beneficial owners; automated retention cleanup job redacts expired inactive borrowers. | Done |

## IT Governance, Cybersecurity, and Data Residency

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| India-hosted primary data | Preflight requires IN primary storage. | Done |
| Payment data in India | Preflight requires IN payment data storage if specified; payment rail provider dispatch also enforces IN data residency. | Done |
| Straight-through processing audit trail | Event model started; payment rail initiation evidence is sealed as financial audit events. Full STP settlement/reconciliation checks planned. | Partial |
| Need-based access | Staff actor registry, roles, queue access, and regulated-action checks. External IAM and reviews planned. | Partial |
| DC/DR and BCP | Encrypted recovery/restore remains executable. Declared PostgreSQL topology now requires India multi-AZ synchronous standby, automatic failover, RLS/pooling/encryption; PITR requires continuous WAL, full/incremental schedules, immutable cross-account custody, purpose-attested key, bounded RPO/RTO, restore drill and corruption evidence. Actual managed database/backup/failover and witnessed BCP remain infrastructure controls. | Partial |
| Support, escalation, and problem management | Platform cases retain severity-based clocks, runbook, affected service/tenant/incident lineage, on-call ownership, monotonic escalation, resolution evidence, independent closure, and linked root-cause/corrective-action problem records. External ITSM/paging, status communications, 24x7 staffing, and exercised operating procedures remain required. | Partial |
| Vendor SLA and concentration oversight | Vendor profiles retain contract, tier, owner, residency/cross-border approval, due-diligence, exit, review, alternate-provider, SLA, service and tenant exposure evidence. Reviews, SLA outcomes, critical single points, overdue reviews, and declared tenant-share concentration are derived. Contract enforcement, fourth-party and portfolio/region concentration, procurement feeds, and independently sourced telemetry remain required. | Partial |
| Secure SDLC and release security gate | Release approval requires artifact/revision-bound SAST, DAST, dependency, container, IaC and secret-scan evidence plus a checksum/signature-referenced SBOM. Missing/failed scans, unreconciled severe findings, critical vulnerabilities and unaccepted high/overdue vulnerabilities fail closed. Scanner execution, authenticated pipeline submission, external report/signature verification and coverage assurance remain required. | Partial |
| Vulnerability SLA, remediation and exception governance | Critical/high/medium/low deadlines are 1/7/30/90 days. Triage, change/remediation, independent retest and closure evidence are retained. Critical exceptions are prohibited; other exceptions need compensating controls, independent approval and ≤90-day expiry. External threat/advisory feeds, automated escalation/patching, VEX/reachability, pen tests and operating effectiveness evidence remain required. | Partial |
| SIEM/SOC detection and investigation | Independently approved/tested rules declare severity, log sources and playbook; alerts retain source-event checksum, evidence, deduplication and acknowledgement SLA; dismissal is independently reviewed; confirmed signals progress through evidence-backed containment, eradication, recovery and independent closure. India-hosted SIEM/log custody, authenticated collectors, SOAR/forensics, SOC staffing and effectiveness evidence remain required. | Partial |
| Security evidence, log retention and trusted time | Investigation/general custody remains governed. Security-log custody now certifies supported sources for authenticated schema-bound collectors, encryption, trusted time, searchable immutable India storage and ≥180-day retention. Actual SIEM/WORM/NTP/collector and TSA operation remains infrastructure work. | Partial |
| Compliance testing and issue remediation | Maker-checker assurance plans select canonical regulatory controls, period, frequency, methodology and sample strategy. Tests retain population/sample/workpaper/evidence and effective/deficiency outcome; deficiencies require findings and owned dated issues. Remediation, retest verification and closure enforce separate actors. Scheduling, granular obligation/control mapping, statistical sampling, evidence connectors and operating-effectiveness procedures remain required. | Partial |
| Control-owner certification and sign-off | Completed-period certification binds control-specific tests, evidence and exception issues; effective certification cannot include a deficient test, future periods are rejected, and independent sign-off is mandatory. Institutional owner hierarchy, delegated authority, e-signature and recurring certification campaigns remain required. | Partial |
| Audit, RBI inspection and board reporting | Internal/statutory/RBI/regulatory engagements track scope, requests, response evidence, management response and independent closure; linked issues must close. Committee packs derive test/issue/certification/engagement metrics and critical/high exceptions and checksum-seal the normalized source. Confidential audit spaces, regulator portals, rendered papers, minutes/actions, trends/KRIs and external audit operation remain required. | Partial |
| Regulatory applicability and obligation calendar | Approved product/RE determinations are restricted to canonical controls; not-applicable and conditional findings require legal/condition evidence. Only applicable controls schedule owner, reviewer, due/trigger, evidence and escalation facts. Regulatory-content feeds, schedulers and notification operation remain external. | Partial |
| Programme and organisation accountability | Programmes bind one regulated entity to approved products, active operating units, channels, borrower segments, policy, exact-paise portfolio limit and effective dates. Enterprise organisation/branch-master integration remains required. | Partial |
| Configurable workflow and delegated authority | Reachable state definitions and pinned cases enforce role, evidence, condition and four-eyes transitions; exact-paise approval matrices return required roles/count/unanimity and default fail closed. Institution-wide delegated-authority methodology and workflow migration remain required. | Partial |
| Business calendar, substitution and operational exceptions | India working calendars govern holidays/pause policy; capacity/leave/substitution/escalation and versioned exception/root-cause/SLA policy are retained. Runtime task timers/routing and enterprise HR feeds remain required. | Partial |

## Implementation and Migration Assurance

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Approved configuration and data mapping | Configuration checksum, source inventory, record/checksum totals, required fields, versioned transformations, cleansing evidence and maker-checker approval are retained per tenant. Source discovery and cleansing execution remain institutional. | Partial |
| Migration and opening-balance integrity | Mock/dress/final runs reconcile counts and exact-paise totals; account principal, interest, fee, ledger, installment and schedule evidence must match exactly. ETL and binary transfer remain external. | Partial |
| Parallel run, UAT and trained users | At least five days of exact finance/regulatory/portfolio reconciliation, product/role/exception/control UAT coverage, severe-defect blocking and score/expiry-bound role certification are required. Bank execution remains external. | Partial |
| Go-live, rollback and hypercare | Joined DR/security/provider/operations/finance/compliance evidence gates readiness; failed cutover requires rollback proof; hypercare exit requires seven days, no severe open issue and no SLA breach. Production commands and witnessed operation remain external. | Partial |

## Fraud Risk Management

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Fraud case workflow | `fraud-case.js` runs `reported → under_investigation → show_cause_issued → classified_fraud/classified_not_fraud`. | Done |
| LEA reporting for threshold frauds | Fraud reporting pack. | Planned |
| Natural justice workflow | An adverse classification is blocked until a show-cause notice (with delivery proof) and either a borrower response or the RBI FRM-2024 21-day window elapsed; classifier must be independent of investigator (four-eyes). Committee pack seals case facts, natural-justice trail, and verdict. | Done |
| Fraud monitoring return support | FMR export. | Planned |
| Preventive and detective fraud scoring | Versioned maker-checker policy weights device, IP, velocity, location, identity-link, duplicate entity, negative-list, mule and early-warning facts into deterministic clear/refer/block outcomes. Signal providers, link graph and investigation operations remain external. | Partial |

## AI, FREE-AI, and Model Risk

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Model inventory | Model registry implemented. | Done |
| Approved validation before use | Model-use guard checks validation status. | Done |
| Independent validation for high-risk models | High-risk model requires independent validation reference. | Done |
| Human review for material decisions | Warning emitted if missing. | Partial |
| Human review workflow for material AI decisions | Decision proposal routes to `human_review_required` when a material model lacks human review evidence. | Done |
| Customer disclosure for customer-facing AI | `GET /ai/models/:id/disclosure` generates the mandated disclosure for a customer-facing, active model; blocked for back-office, inactive, or kill-switched models. | Done |
| Human handoff from AI interaction | `POST/GET /ai/handoff-requests` and resolution endpoint track pending → handled handoff by a named human agent. | Done |
| Global kill switch | Implemented. | Done |
| Model-level kill switch | Implemented. | Done |
| Bias/fairness and explainability evidence | High-risk models require `fairnessAssessmentRef` and `explainabilityRef` (plus `monitoringPlanRef`) along with valid file hashes (`fairnessAssessmentHash`/`explainabilityHash`) and structured reports (`fairnessReport`/`explainabilityReport`) to approve validation. | Done |
| Red-teaming, adversarial, and hallucination tests for generative models | A `modelClass: "generative"` model requires `redTeamRef` and `hallucinationTestRef` to approve validation. | Done |
| Drift monitoring | `recordDriftObservation` records a metric against an active model; a threshold breach auto-trips a model-scoped kill switch and opens an incident. | Done |
| Recurring model monitoring | Maker-checker reports bind an active model/version to cohort approval spread, bad rate and drift thresholds; a breach cannot be recorded without remediation evidence. Independent model-risk operation and source-data certification remain institutional. | Partial |
| AI incident reporting | Kill-switch incident record and post-incident review first slice implemented; sectoral incident pack planned. | Partial |
| Bounded digital-worker catalogue | Four versioned proposal-only templates cover CAM preparation, underwriting review, document/compliance review, and service-support triage; none can sanction, disburse, post accounting, communicate, or mutate a case without separately authorized scope. | Done |
| Tenant installation and customization | Each tenant pins template/model/prompt/knowledge versions, approved action scope, limits, retention, disclosure, owner, and checksum without cross-tenant configuration or memory. | Done |
| Material-agent human governance | FST-034 requires four distinct authenticated humans covering business ownership, model-risk/compliance, information-security/data, and operations-control before a material worker can activate. | Done |
| Dual runtime authorization | Every run obtains fresh deterministic model-consumption and agent-action decisions; unreachable or non-allow outcomes fail closed and both traces are retained. | Done |
| Agent execution, output, and usage lineage | Input/output checksums, actor/service identity, correlation, policy, model, prompt, knowledge, action, human disposition, token/action units, and exact-paise rated usage are tenant scoped and audit sealed. This is a control-plane capability; no external LLM call is represented. | Done |
| Agent pricing and commercial control | Maker-checker pricing contracts and immutable rated usage/reporting exist; quotas, invoice aggregation, GST/tax, credits, collection, and accounting export remain. | Partial |
| India-resident model/agent runtime | Provider-neutral adapter, approved AWS India runtime, private connectivity, request/response custody, provider evidence, continuity, and exit are not yet connected. | Planned |
| Worker-specific evaluation and specialized guardrails | Generic model and agent-action controls exist; retrieval/data minimization, communication, eligibility influence, domain mutation, groundedness/completeness/safety suites, red-team regression, continuous monitoring, and automatic worker suspension need dedicated policies and evidence. | Partial |

Operational control ownership, activation, run authorization, metering, suspension, and production gaps are defined in the [AI agent platform operations runbook](../architecture/ai-agent-platform-operations.md).

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
| External IAM and access reviews | Local tenant/platform login sessions, tenant user admin, access-review snapshots/completion, and service-key rotation are implemented; external IAM/SSO/MFA and maker-checker approval for admin changes remain planned. | Partial |

## LMS Ledger and Servicing

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Loan account opened after disbursement | Disbursement creates an LMS account linked to application, borrower, RE, product, and KFS terms. | Done |
| Ledger event for disbursement | Loan account ledger starts with a disbursement event. | Done |
| Repayment schedule | Shared KFS/LMS generator produces paise-exact weekly, fortnightly, monthly, or quarterly amortising, bullet, serviced/deferred moratorium, and step-up schedules. | Done |
| Revolving and overdraft servicing | Separately typed facilities disclose limit/drawing power/expiry/minimum due; maker-checker draws and reviews, daily utilised-balance interest, repayments, statements, CIC snapshot, and balanced journals are executable. Stock-statement/covenant/renewal depth remains planned. | Partial |
| Balance reconstruction | Account summary reconstructs principal paid/outstanding, interest paid/outstanding, and next due from schedule plus ledger. | Done |
| Payment posting | Payment endpoint records a ledger payment and allocates due interest before principal. | Done |
| Borrower statements | Statement generation from ledger and schedule for a requested period. | Done |
| Disclosed charges only | Charge endpoint blocks charges not present in KFS charge catalog. | Done |
| Penal charge guardrails | Charge endpoint blocks penal interest and capitalized penal charges. | Done |
| Waivers | Waiver endpoint requires approver, approval reference, reason, and outstanding charges. | Done |
| Reversals | Reversal endpoint requires original event, approval evidence, reason, and blocks duplicate reversal. | Done |
| Delinquency buckets | DPD bucket, earliest unpaid installment, and overdue amounts are computed from schedule and ledger. | Done |
| Collections reminder/notice workflow | Reminder logging requires channel/stage evidence; voice-channel (call/IVR) contact outside the RBI FPC 08:00-19:00 IST window is blocked. | Done |
| Recovery-agent empanelment | An active recovery agent must reference an active regulated entity and carry due-diligence/police-verification, training-certification, code-of-conduct, and authorization-letter/ID-card evidence. | Done |
| Recovery-agent notice | Recovery assignment requires an empanelled active recovery agent, borrower notice timestamp, and delivery reference before active assignment. | Done |
| Cash recovery same-day posting | Cash recovery requires active noticed recovery assignment and same-India-day account posting. | Done |
| Cash recovery exception workflow | Cash recovery requires a coded exception reason (cash is an exception channel, not the default) plus an approver checked against the active `collections_manager` role, mirroring the actor/reason/approver/reference shape used for waivers and reversals. | Done |
| Field collection and PTP evidence | Assigned-agent contacts enforce 08:00-19:00 IST, retain disposition/evidence/delinquency, require geo evidence for field visits, and link paise-exact PTPs to subsequent payments for kept/broken follow-up. Dialer/mobile partner integration remains open. | Partial |
| SARFAESI legal recovery | A legal case requires NPA plus registered CERSAI security; the Section 13(2) demand record is checksum-sealed with delivery evidence and a 60-day clock, and early enforcement authorization fails closed. Possession/auction and regulator/court integrations remain open. | Partial |
| Section 138 cheque recovery | A case retains cheque and bank-return evidence, enforces demand-notice issue within 30 days and the 15-day payment period after receipt, then supports evidenced filing/hearing/order events. Court filing remains external. | Partial |
| Hardship restructure | Four-eyes tenure extension and/or rate concession, re-amortizing the remaining principal. | Done |
| Prepayment and foreclosure servicing | quoteForeclosure and prepayLoanAccount enforce product lock-in policies and block fees on floating-rate individual retail loans. | Done |
| Floating-rate interest reset servicing | resetFloatingRate implements choice-based re-amortization (extend tenor, increase EMI, switch to fixed with fee) under four-eyes check. | Done |
| Settlement and write-off | Four-eyes below-par closure via waiver credits (settlement) or book-loss marking retaining ledger dues (write-off); both surface on the CIC snapshot. | Done |
| SMA/NPA asset classification | Asset class maps DPD to standard, SMA-0, SMA-1, SMA-2, and NPA. | Done |
| CIC-ready snapshots | Internal account-level and portfolio-level CIC reporting snapshots are generated from account lifecycle state. | Done |
| External CIC submission | Canonical checksum-bound batches now cross a mock/real, certification-gated transport with stable idempotency; HMAC callbacks reconcile every record before commit. Proprietary CIC schema conformance and provider certification remain external. | Partial |
| CERSAI security-interest registration (SARFAESI) | `cersai.js` builds checksum-sealed canonical security-interest registration packets from creditor, debtor, asset, charge, and authority evidence; retains India-resident provider-submission evidence; reconciles exact registered/rejected responses with fee receipt and certificate/error evidence; and requires independently approved source-correction replacements. Maker-checker modification, closure-gated satisfaction, prior-encumbrance search, and the secured-loan disbursement gate remain enforced. Certified CERSAI portal/gateway schema and credential onboarding remain external adapter work. | Partial |

## SaaS Vendor Posture and Tenant Isolation

LoanOS is delivered as SaaS, so the platform itself has compliance obligations as the RE's IT service provider (RBI IT-Outsourcing MD 2023, CERT-In 2022, DPDP processor role). See ADR 0002 and the SaaS tenancy and operating model document.

| Requirement | Platform behavior | Status |
| --- | --- | --- |
| Tenant = contracting RE, tenant context on every record | State is partitioned per tenant; all domain collections live inside a tenant's data plane, minted through the control-plane tenant registry. | Done |
| Cross-tenant isolation by construction | The store hands each request only its tenant's partition; no handler has a code path to another tenant's data. | Done |
| Tenant-scoped authentication | Every data-plane route resolves a tenant from either a tenant user session or `x-api-key`/bearer service token and returns 401 without valid tenant context; open routes are limited to health and static reference. | Done |
| Cross-tenant isolation regression tests | Two-tenant suite proves tenant B cannot read or mutate tenant A's records across resource types, plus 401 on missing/invalid key. | Done |
| Platform control plane onboards tenants | `GET /platform/onboarding-options`, `POST /platform/tenants`, and `GET /platform/tenants/:id/onboarding` support a guided onboarding flow: tenant shell, owner user, regulated entity profile, first product policies, module/flow enablement, readiness checklist, and one-time api key stored only as a hash. | Done |
| Tenant user administration | `/admin/users` creates, reads, suspends, and resets tenant users; users can be linked to staff actors for regulated workflow actions. | Done |
| Periodic access review | `/admin/access-reviews` captures user/role snapshots and records completion decisions, including user suspension or admin-role removal. | Done |
| Tenant service-key rotation | `/admin/api-key/rotation` revokes the previous service key, returns a one-time replacement, and seals a tenant audit event. | Done |
| Named integration credentials | Tenant admins create multiple named, module-scoped, optionally expiring credentials; each secret is hash-only at rest, independently rotated/revoked, scope-gated at the API boundary, and audit-sealed. | Done |
| Cryptographic federated revocation | Public-only RS256/ES256 verifier profiles are tenant/policy/protocol/issuer/audience bound, maker-checker activated, time-bounded and explicitly rotated; provider logout is verified over exact bytes before immediate session containment. Commercial provider-native certification remains external. | Partial |
| Durable tenant identity workers | Named tenant service credentials claim lease/fence-protected jobs; retry is bounded, exhausted work produces immutable DLQ/alert/escalation state, and replay requires a different human approver. A bounded runner, explicit simulator/live-port boundary, tenant-lock/RLS persistence path, health metrics, container profile and runbook are executable. Certified commercial handlers, managed scheduling/alerting and witnessed production evidence remain. | Partial |
| Unified tenant activation | One checksum/currentness assessment joins admission, minimum staffing/SoD, products, integrations, deployment/rollback, security/fail-closed controls, UAT and independent drills; simulator evidence cannot authorize production and a separate platform human must approve the recomputed exact assessment. | Done |
| Append-only hash-chained audit spine | Every save seals the tenant's events into a per-tenant SHA-256 hash chain (tenant-bound genesis, previous-hash linkage); `verifyAuditChain` detects any edit, drop, reorder, or genesis swap. | Done |
| Evidence export pack | `GET /audit/export` produces an auditor-ready pack (genesis/head anchors, whole-chain integrity attestation, optionally filtered events); a broken chain returns 409 instead of a silently-tampered pack. `GET /audit/events` lists the chain with a validity verdict. | Done |
| External audit anchor and event completeness | Exact head/count external timestamp/WORM evidence requires India custody, retention and maker-checker approval. Five critical registries reconcile to required creation events; missing events or broken chains fail visibly. Institution-wide mappings and automated external anchoring remain depth work. | Partial |
| Evidence legal hold and deletion proof | Immutable evidence admission is checksum/source/custodian/retention bound; authority-backed holds can extend retention and block deletion; independent release and post-retention deletion retain proof checksums. | Done |
| Data lineage and quality certification | Field-level source/transform/output lineage is version/checksum/owner approved. Declarative DQ profiling retains hash-only exceptions and blocks certification on critical/high failures. Enterprise catalog connectors and stewardship operations remain external depth. | Partial |
| Enterprise federation and SCIM | Tenant OIDC/SAML policy requires MFA, PKCE/signed assertions, allowed domains, explicit group mapping and independent metadata/login/logout/MFA certification. Idempotent SCIM provisioning/deactivation is audit-sealed and cannot take over local identities. Live IdP/token/SCIM protocol integration remains external. | Partial |
| Managed-key custody | Key attestations require India region, non-exportable HSM custody, purpose, dual control, bounded rotation and destruction policy; database and backup controls resolve purpose-correct attestations. Direct KMS grants, key state, rotation and destruction execution remain external. | Partial |
| API, event and webhook governance | OpenAPI 3.1 contracts are checksum/owner/tenancy/error/idempotency bound; event schemas are contiguous and backward compatible; webhook subscriptions/deliveries enforce HTTPS, vault refs, India processing, schema, order, idempotency, retry and dead letter. Dispatch/signing/queue/replay runtime remains external. | Partial |
| Deployment automation readiness | Production policy binds India IaC, signed artifacts, SBOM/provenance, vault secrets, expand-contract migrations, progressive delivery, automatic rollback, drift, HA/PITR and capacity. Cloud/CI/CD controller execution remains external. | Partial |
| Platform-staff break-glass access with audit | Time-boxed, tenant-scoped credential; use seals a `platform.break_glass.access` event into the tenant's own audit chain; tenant-visible grants, revocation, and TTL expiry. | Done |
| Per-tenant encryption keys and key destruction on exit | File and Postgres boundaries use a versioned root-key provider and tenant-bound HKDF/AES-256-GCM envelopes. Tenant/key ids are authenticated; previous versions are decrypt-only; unknown versions fail closed; a governed all-tenant rekey records change ticket, actor, source/target versions, and tenant count. Recovery packages use a domain-separated AES-256-GCM key under the same versioned provider and bind India-resident retention/location metadata. Production KMS/HSM custody, managed immutable backup storage, rotation ceremony, and destruction evidence remain planned. | Partial |
| RE due-diligence pack (ownership, security, subcontractors) | Standing vendor-assessment pack. | External |
| RE audit and inspection rights support | Contract terms plus evidence-export tooling. | Planned |
| Incident notification supporting RE 6-hour RBI window | `incident-notification.js` tracks an independent 6-hour reporting clock per authority (CERT-In and RBI); overdue duties surface as `overdue`/`reporting_overdue`. | Done |
| CERT-In 6-hour reporting, 180-day India log retention, NTP sync | 6-hour incident-notification clock implemented; 180-day log retention and NTP sync are production infrastructure controls, still planned. | Partial |
| BCP/DR with RTO/RPO commitments | Platform recovery APIs govern encrypted backup/restore and exercises; enterprise topology/PITR records now fail closed on multi-AZ, WAL, immutable custody, key, RPO/RTO, restore-drill and corruption evidence. Contracted objectives, real failover/failback, business procedures and witnessed production exercises remain required. | Partial |
| Exit plan: portability export and evidenced deletion | `GET /platform/tenants/:id/export` (reproducible control record + data plane + audit evidence) and `POST /platform/tenants/:id/offboarding` (data-plane purge, api-key revocation, deletion attestation). | Done |
| Sub-processor register and flow-down obligations | `POST/GET /platform/sub-processors` requires a DPA and data-residency country per sub-processor; `GET /sub-processors` discloses the register to every tenant. A vendor-control profile can bind a registered sub-processor to due-diligence, SLA, BCP, exit, review and concentration evidence. Contract flow-down terms and enforcement remain external. | Partial |
| ISO 27001 / SOC 2 Type II roadmap | Certification program. | External |
| DPDP processor terms per tenant | Contract templates backed by retention/deletion/breach tooling. | External |

## Production Readiness Gates

Before production, the platform needs:

1. Legal and compliance review of control interpretation.
2. Board-approved policies for products, penal charges, LSP, DLG, outsourcing, model risk, data retention, and recovery.
3. Authentication, authorization, maker-checker, and audit hardening.
4. Secure secrets management. Partial: service secrets are one-time/hash-only with independent rotation and fail-closed compromise containment linked to incident reporting; production vault/KMS custody, workload identity, and automated leak detection remain required.
5. India-hosted production database and object storage.
6. Observability, SIEM, incident response, support/problem operations, backup, DR, BCP, change, and resilience. Partial: authenticated operational health, local SLI/SLO, provider/stuck-work alerts, protected metrics, governed detection/alert/investigation/evidence records, log-source retention/time coverage assessment, severity/on-call/escalation/problem evidence, encrypted recovery/four-eyes restore, RTO/RPO drills, governed artifact-to-canary-to-promotion/rollback evidence, secret-safe configuration drift/parity, and concurrent HTTP resilience assessment exist. External telemetry and India-hosted SIEM/log custody, authenticated collectors/WORM/NTP/SOAR/forensics, ITSM/paging/status communications, 24x7 staffing, managed backup/PITR, deployment-controller enforcement, continuous configuration reconciliation, production-scale soak/chaos, real failover/failback, and witnessed BCP exercises remain required.
7. Vendor due diligence and contracts with audit rights and data residency obligations. Partial: governed profiles, review/BCP/exit evidence, SLA breach calculation, and basic tenant/service concentration signals exist; procurement integration, fourth-party and portfolio/region concentration, independently sourced measures, and contractual enforcement remain required.
8. Penetration testing and vulnerability management. Partial: governed scan/SBOM evidence, fail-closed release gate, severity SLAs, remediation/retest and bounded exception workflow exist; independently operated scanners, CVE/KEV feeds, automated patch/escalation, penetration/red-team testing and demonstrated SLA performance remain required.
9. Privacy impact assessment and DPDP operating model.
10. Integration certification where required by external providers.
11. Tenant isolation proven by tests, tenant-scoped authentication, and the SaaS vendor-posture pack (due diligence, audit rights, incident notification, exit plan).
12. Compliance monitoring, independent assurance, audit/inspection response and board oversight. Partial: governed plans, samples/results, deficiencies/remediation, owner certification/sign-off, evidence-request engagements and checksum-sealed committee metrics exist; institutional methodology, granular control hierarchy, recurring campaigns, evidence connectors, confidential audit spaces, rendered packs/minutes and independent operating-effectiveness evidence remain required.
