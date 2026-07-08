# Current Implementation Map

This document describes what exists in the repository today.

## Runtime Shape

The current implementation is intentionally small:

- No external npm dependencies.
- Node.js built-in HTTP server.
- File-backed JSON state under `.loanos-data/state.json`.
- Core domain logic in `packages/core/src`.
- API wrapper in `apps/api/src`.
- Automated tests in `tests/`.

Run it:

```bash
npm test
npm run dev:api
```

## File Map

| Path | Role |
| --- | --- |
| `packages/core/src/compliance-controls.js` | Regulatory control catalog and finding helpers. |
| `packages/core/src/access-control.js` | Staff actor registry, role checks, queue assignment authority, and regulated-action actor validation. |
| `packages/core/src/grievance.js` | Complaint registry, grievance lifecycle, 30-day RBI Ombudsman clock, and RBI CMS escalation evidence. |
| `packages/core/src/document-packet.js` | KFS, sanction letter, loan agreement summary, and privacy notice rendering, rendered borrower loan-statement document, plus delivery evidence controls. |
| `packages/core/src/registries.js` | Regulated-entity, LSP, DLA, and product-policy registries, DLA CIMS export shape, plus application reference resolution. |
| `packages/core/src/borrower-onboarding.js` | Borrower profile, consent ledger, KYC records, and borrower reference resolution. |
| `packages/core/src/eligibility.js` | Policy-driven creditworthiness/affordability engine: EMI/FOIR computation, age-at-maturity, amount/tenor bounds, and eligible/refer/ineligible decision. |
| `packages/core/src/application-workflow.js` | LOS application state machine, KFS workflow, human review, decision proposal, manual underwriting override gate for referred applications, coded decline-reason taxonomy, maker-checker approval, disbursement transition. |
| `packages/core/src/loan-account.js` | LMS loan account creation, amortization schedule, ledger balance reconstruction, interest accrual, payment posting, part-prepayment re-amortization, foreclosure quote and payoff, closure No-Objection Certificate, statements, charges, waivers, reversals, delinquency, recovery controls, asset classification, and CIC snapshots. |
| `packages/core/src/loan-policy.js` | India-only loan validation, KFS validation, sanction readiness, disbursement checks. |
| `packages/core/src/model-governance.js` | AI/model inventory, model status, governed lifecycle transitions with a validation gate, global/model kill switch, kill-switch incident and post-incident review workflow, runtime model-use evaluation. |
| `packages/core/src/workflow-tasks.js` | LWS task derivation from LOS/LMS state plus task assignment, start, release, and comment lifecycle. |
| `packages/core/src/index.js` | Public exports for core domain modules. |
| `apps/api/src/file-store.js` | Local JSON state load/save helpers. |
| `apps/api/src/server.js` | HTTP API endpoints for compliance controls, AI models, kill switch, workflow tasks, applications, and loan accounts. |
| `tests/compliance.test.js` | Regression tests for the first compliance gates. |

## Implemented API Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Service health. |
| `GET /compliance/controls` | Returns regulatory control catalog. |
| `GET /reference/decline-reasons` | Returns the coded decline-reason taxonomy. |
| `GET /regulated-entities` | Lists regulated entities. |
| `POST /regulated-entities` | Creates or updates a regulated entity after compliance validation. |
| `GET /regulated-entities/:id` | Reads one regulated entity. |
| `GET /lending-service-providers` | Lists LSPs governed by regulated entities. |
| `POST /lending-service-providers` | Creates or updates an LSP after agreement, due-diligence, review, data, recovery, and fee-control validation. |
| `GET /lending-service-providers/:id` | Reads one LSP record. |
| `GET /digital-lending-apps` | Lists registered digital lending apps and web surfaces. |
| `POST /digital-lending-apps` | Creates or updates an own or LSP-operated DLA after CIMS/data-control validation. |
| `GET /digital-lending-apps/:id` | Reads one digital lending app record. |
| `GET /reporting/dla/cims` | Generates active DLA rows in RBI CIMS-ready reporting shape, optionally filtered by `regulatedEntityId`. |
| `GET /products` | Lists product policies. |
| `POST /products` | Creates or updates a product policy after compliance validation. |
| `GET /products/:id` | Reads one product policy. |
| `GET /borrowers` | Lists borrower profiles. |
| `POST /borrowers` | Creates or updates a borrower profile after India/KYC/economic-profile validation. |
| `GET /borrowers/:id` | Reads one borrower profile. |
| `GET /borrowers/:id/consents` | Lists borrower consent records. |
| `POST /borrowers/:id/consents` | Creates or updates a borrower consent record. |
| `GET /borrowers/:id/kyc-records` | Lists borrower KYC records. |
| `POST /borrowers/:id/kyc-records` | Creates or updates a borrower KYC record. |
| `GET /staff/actors` | Lists operational staff actors. |
| `POST /staff/actors` | Creates or updates an operational actor with roles, queues, and assignment authority. |
| `GET /staff/actors/:id` | Reads one operational staff actor. |
| `GET /complaints` | Lists complaints with computed SLA and effective status. |
| `POST /complaints` | Creates a borrower complaint with acknowledgement evidence. |
| `GET /complaints/:id` | Reads one complaint with computed SLA and effective status. |
| `POST /complaints/:id/assignments` | Assigns a complaint to a grievance officer. |
| `POST /complaints/:id/reviews` | Starts grievance-officer review. |
| `POST /complaints/:id/resolution` | Records complaint resolution and closure evidence. |
| `POST /complaints/:id/rbi-cms-escalation` | Records RBI CMS escalation reference and reason. |
| `GET /ai/models` | Returns model registry and kill-switch state. |
| `POST /ai/models` | Registers or updates a model in inventory. |
| `POST /ai/models/:id/transitions` | Moves a model through its governed lifecycle (submit, approve validation, activate, suspend, reinstate, retire). |
| `POST /ai/kill-switch` | Triggers global or model-level kill switch. |
| `POST /ai/incidents/:id/post-incident-review` | Records the post-incident review (root cause, remediation) for a kill-switch incident. |
| `POST /ai/kill-switch/clear` | Clears global kill switch with approval reference, only after the incident's post-incident review. |
| `GET /workflow/tasks` | Lists active LWS tasks derived from application and loan-account state. |
| `GET /workflow/tasks/:id` | Reads one active LWS task. |
| `POST /workflow/tasks/:id/assignments` | Assigns an active task and stores assignment audit. |
| `POST /workflow/tasks/:id/start` | Starts an assigned task and stores actor audit. |
| `POST /workflow/tasks/:id/release` | Releases a task back to open queue with reason. |
| `POST /workflow/tasks/:id/comments` | Adds an audit comment to an active task. |
| `POST /loans/applications` | Creates application and runs compliance preflight. |
| `GET /loans/applications/:id` | Reads stored loan application. |
| `GET /loans/applications/:id/eligibility` | Reads the stored eligibility assessment. |
| `POST /loans/applications/:id/eligibility` | Runs the eligibility engine and stores the affordability/creditworthiness assessment. |
| `POST /loans/applications/:id/kfs` | Generates KFS and attaches delivery/acceptance evidence. |
| `POST /loans/applications/:id/decision` | Proposes approve/decline decision after compliance gates. |
| `POST /loans/applications/:id/human-reviews` | Records human review for material AI/model-assisted decisions. |
| `POST /loans/applications/:id/approvals` | Applies maker-checker approval/rejection for a pending decision proposal. |
| `GET /loans/applications/:id/document-packet` | Reads generated execution document packet. |
| `POST /loans/applications/:id/document-packet` | Generates rendered KFS, sanction letter, agreement summary, and privacy notice documents. |
| `POST /loans/applications/:id/document-packet/delivery` | Records document packet digital delivery evidence. |
| `POST /loans/applications/:id/disbursement` | Records disbursement after fund-flow and KFS checks. |
| `GET /loan-accounts` | Lists loan accounts. |
| `GET /loan-accounts/:id` | Reads a loan account with balance summary. |
| `GET /loan-accounts/:id/schedule` | Reads repayment schedule. |
| `GET /loan-accounts/:id/statement` | Generates borrower statement for a `from`/`to` period. |
| `GET /loan-accounts/:id/statement/document` | Renders the period statement as a checksum-sealed borrower-facing document. |
| `GET /loan-accounts/:id/delinquency` | Computes DPD, bucket, overdue amounts, and earliest unpaid due. |
| `GET /loan-accounts/:id/asset-classification` | Computes standard, SMA, or NPA asset class from DPD. |
| `GET /loan-accounts/:id/cic-snapshot` | Generates a CIC-ready internal reporting snapshot for one account. |
| `GET /reporting/cic/snapshots` | Generates CIC-ready internal reporting snapshots for the portfolio. |
| `POST /loan-accounts/:id/recovery-assignments` | Assigns a recovery agent only with borrower notice evidence. |
| `POST /loan-accounts/:id/charges` | Assesses a KFS-disclosed charge. |
| `POST /loan-accounts/:id/accruals` | Posts interest-accrual ledger events for installments due as of a date and returns the reconciled balance summary. |
| `GET /loan-accounts/:id/foreclosure-quote` | Returns a foreclosure payoff quote (principal, due interest, charges, disclosed foreclosure charge) for an `asOf` date. |
| `POST /loan-accounts/:id/foreclosure` | Executes foreclosure: settles the payoff, records the foreclosure, and closes the account. |
| `GET /loan-accounts/:id/closure-certificate` | Reads the issued No-Objection closure certificate. |
| `POST /loan-accounts/:id/closure-certificate` | Issues a No-Objection closure certificate for a settled account (idempotent re-issue). |
| `POST /loan-accounts/:id/payments` | Posts payment ledger event and returns updated balance summary. |
| `POST /loan-accounts/:id/prepayments` | Posts a part-prepayment and re-amortizes the remaining schedule (`reduce_emi` or `reduce_tenure`). |
| `POST /loan-accounts/:id/cash-recoveries` | Posts noticed-agent cash recovery with same-day reflection control. |
| `POST /loan-accounts/:id/waivers` | Posts approved charge waiver. |
| `POST /loan-accounts/:id/reversals` | Posts approved reversal of a ledger event. |

## Current Control Coverage

| Control | Current behavior |
| --- | --- |
| India-only lending | Blocks non-IN borrower residency/address, non-INR currency, non-IN data storage. |
| Regulated entity | Requires supported RE type and grievance officer. |
| Regulated entity registry | Requires active India RE, website, privacy policy, grievance officer, data-residency posture, and board policy references. |
| LSP registry | Requires active LSPs to reference an active RE, carry a clear agreement/scope, enhanced due-diligence evidence, periodic review evidence, portfolio monitoring, borrower-facing grievance/privacy disclosures, India data controls, RE-paid fee controls, and recovery-agent guidance where applicable. |
| DLA registry and CIMS export | Requires active own/LSP DLA records to reference an active RE; LSP-owned DLAs must also reference an active LSP governed by the same RE. Active records must expose availability/link, grievance contact, privacy/disclosure URLs, India data controls, RE website linkage, and CCO/compliance attestation; active records export to RBI CIMS-ready rows. |
| Product policy registry | Requires active product linked to an active RE, INR, amount/tenor bounds, APR, cooling-off, recovery mechanism, eligibility, board approval, and safe charge design. |
| Registry-backed applications | Application can reference `regulatedEntityId` and `productId`/`productCode`; policy facts are resolved before preflight. |
| Borrower profile registry | Requires active India borrower profile, contact channel, and economic profile for active borrowers. |
| Consent ledger | Requires borrower-linked purpose, notice version, granted/revoked status, and evidence timestamps. |
| KYC record registry | Requires borrower-linked KYC status, risk category, verified timestamp, V-CIP India storage, and no Aadhaar biometric/OTP/PID persistence. |
| Staff actor registry | Requires India-operational actors, active status, and recognized roles. |
| Borrower-backed applications | Application can reference `borrowerId`; borrower, consent, KYC, and economic profile are resolved before preflight. |
| LOS state machine | Tracks preflight, KFS issued/accepted, ready for decision, human review required, pending decision approval, approved/declined, and disbursed states. |
| Eligibility rules engine | Computes reducing-balance EMI, FOIR against product ceiling, age at maturity, and amount/tenor bounds; returns eligible, refer, or ineligible with evidence, and blocks approval of ineligible borrowers while allowing declines. |
| Manual underwriting referral | A `refer` eligibility outcome routes the ready-for-decision application to a dedicated manual underwriting LWS task instead of the straight-through credit-decision task. |
| Manual underwriting override | Approving a `refer`-band application requires a manual underwriting override with underwriter, reason, and policy reference; the override is stored on the pending decision and carried into the final approved decision as evidence. The named underwriter must be a registered, active `credit_officer`. Declines are unaffected. |
| Coded decline reasons | A declined decision must cite a code from the decline-reason taxonomy (`other` requires a narrative); the structured reason is stored on the proposal and carried into the final decision for adverse-action and CIC reporting. |
| Maker-checker decision approval | Decision submission creates a pending proposal; approval requires a registered `credit_checker` actor different from the maker, and — on referred applications — different from the manual underwriting underwriter, before disbursement. |
| Human review hook | Material AI/model decisions without human review are routed to `human_review_required`; human-review recording requires a registered `human_reviewer`. |
| Regulated-action RBAC | Credit proposal, manual underwriting override, checker approval, human review, recovery assignment, and LWS task actions validate actor role and queue policy. |
| Complaint workflow | Tracks received, assigned, under-review, resolved, escalation-due, and RBI CMS escalation states with acknowledgement, closure, and CMS references. |
| 30-day grievance clock | Computes due date, breach status, and escalation-due state from complaint received time. |
| Execution document packet | Renders borrower-facing HTML/text KFS, sanction letter, agreement summary, and privacy notice with SHA-256 checksums and delivery evidence. |
| LWS task queues | Derives active tasks for blocked compliance, KFS acceptance, credit decision, manual underwriting review for eligibility-referred applications, AI human review, checker approval (surfacing any manual underwriting override for the checker to review), document packet delivery, disbursement, recovery assignment, NPA review, complaint assignment, complaint resolution, and RBI CMS escalation. Each task includes SLA target, due time, and breach status. |
| LWS task audit | Persists assignment, start, release, and comment events while the domain state remains the source of truth for task resolution. |
| Loan account opening | Disbursement opens an LMS loan account and creates a disbursement ledger event. |
| Repayment schedule | Generates monthly reducing-balance amortization schedule from KFS/product terms. |
| Loan ledger | Reconstructs principal, interest, paid amounts, outstanding balance, and next due from ledger and schedule. |
| Interest accrual | Recognizes scheduled interest as immutable `interest_accrual` ledger events once each installment period closes; idempotent per installment, reconstructable from the ledger, and reconciled against the schedule in the balance summary. |
| Foreclosure | Quotes a payoff of outstanding principal plus interest and charges already due (no future interest); any foreclosure charge must be KFS-disclosed. Execution requires the amount to cover the payoff, settles it through the ledger, and closes the account. |
| Closure NOC | A settled (closed, zero-dues) account can issue a checksum-sealed No-Objection Certificate declaring no dues remain and no objection to releasing securities; re-issue returns the same certificate. |
| Payment posting | Posts payment events, allocates to due interest first and principal next, and updates account status. |
| Part-prepayment | Clears dues then reduces principal, requiring a real principal reduction, and rebuilds the future schedule either to lower each EMI over the same term (`reduce_emi`) or keep the EMI and shorten the tenure (`reduce_tenure`). |
| Borrower statements | Generates period statement from schedule and ledger transactions. |
| Rendered statement document | Renders the period statement into a checksum-sealed HTML/text borrower document (opening/closing balances, dues, transactions, totals) in the same shape as the execution packet. |
| Charge controls | Blocks undisclosed charges and penal-interest/capitalizing charge designs. |
| Waivers and reversals | Requires approval evidence for waivers and reversals, and prevents duplicate reversal of the same event. |
| Delinquency buckets | Computes DPD bucket, earliest unpaid installment, and overdue amounts from schedule plus ledger. |
| Asset classification | Maps DPD to standard, SMA-0, SMA-1, SMA-2, and NPA classes. |
| CIC snapshots | Produces account and portfolio reporting snapshots from schedule, ledger, borrower, RE, product, and asset-classification state. |
| Recovery-agent notice | Recovery assignment requires delinquent account, agent details, borrower notice timestamp, and delivery reference. |
| Cash recovery posting | Cash recovery requires active noticed assignment and same-India-day posting to borrower account. |
| Consent | Requires data-processing evidence and notice version. |
| KYC | Requires `verified` KYC state and risk category validation. |
| Aadhaar | Blocks biometric, OTP, or PID persistence flags. |
| Economic profile | Requires adult borrower, occupation, and monthly income. |
| KFS | Requires APR, amount, tenor, cooling-off, recovery mechanism, grievance details, charge structure. |
| Penal charges | Blocks penal interest and capitalization of penal charges. |
| Fund flow | Blocks LSP, DLA, pass-through, and pool account fund control. |
| Disbursement | Requires approved loan, valid KFS, delivered document packet, and borrower/end-beneficiary account. |
| Model lifecycle | Governed transitions (draft → validation_pending → approved → active, plus suspend/reinstate/retire) with legal state guards. Approving validation requires independent validation evidence, an approver independent of the owner, and — for high-risk models — fairness, explainability, and monitoring evidence; a model reaches `active` only through this path. |
| AI model inventory | Blocks model use if missing from inventory. |
| AI model validation | Blocks active use without approved validation. |
| AI kill switch | Blocks model use when global switch is active or model is suspended. |
| AI incident and clearance | A kill-switch trigger opens an incident; the global switch cannot be cleared until a post-incident review (root cause, remediation) is recorded, and clearance closes the incident while retaining the review evidence. |

## Known Limitations

- Persistence is local JSON only.
- No login/session authentication yet; actor authorization is API-level registry validation.
- No real KYC, CKYC, bureau, payment, eSign, SMS, email, or CERSAI integrations yet.
- Registries are file-backed and lack external IAM, maker-checker administration workflow, and periodic access review.
- Borrower/consent/KYC records are file-backed and do not yet integrate CKYC, V-CIP providers, consent managers, or document stores.
- Workflow is file-backed and does not yet include dashboard UI, notification dispatch, or outbound RBI CMS API integration.
- LMS is early-stage: no NACH files, refunds, restructure, external CIC file/API submission, or full recovery contact logging yet.
- Document packet renders HTML/text but does not yet create PDFs or eSign envelopes.
- No UI yet.
- AI governance is a runtime guard plus first lifecycle/incident slices, but does not yet include drift monitoring, recurring fairness reports, or sectoral incident pack generation.
- Compliance docs are source-grounded but still require counsel/compliance review before production.

## Test Coverage

Current tests prove:

- Valid India-only loan application passes preflight.
- Non-India borrower/currency/storage are blocked.
- LSP/pass-through fund flow is blocked.
- Aadhaar biometric/OTP persistence is blocked.
- Invalid KFS cooling-off and penal-charge design are blocked.
- KFS acceptance and delivery evidence gate sanction readiness.
- AI model kill switch blocks model-assisted underwriting.
- Model lifecycle blocks illegal transitions and un-validated approval, and only a validated, activated model can be used; API drives draft → active.
- A kill-switch trigger opens an incident, the global switch cannot be cleared before a recorded post-incident review, and clearance closes the incident while retaining the review evidence.
- API stores blocked compliance applications and supports lookup.
- Regulated entity and product policy registries resolve an application.
- Unsafe product penal-charge design is rejected.
- LSP registry blocks missing agreement/due-diligence/review evidence, unsafe fee design, and supports active LSP references from LSP-owned DLAs.
- DLA registry validates own/LSP active apps and exports RBI CIMS-ready rows, including one row per availability surface.
- API stores validated DLA records and exposes the CIMS-ready DLA export.
- API supports registry-backed loan applications.
- Borrower profile, consent, and KYC records resolve an application.
- Revoked consent and expired KYC block borrower resolution.
- API supports borrower-backed applications without embedded borrower/KYC/consent blobs.
- Eligibility engine computes affordability and returns eligible, refer, and ineligible outcomes.
- API assesses eligibility and blocks approval of an ineligible borrower while allowing a decline.
- API routes a refer-band application to a manual underwriting task instead of the straight-through credit-decision task.
- API blocks approval of a refer-band application until a manual underwriting override is recorded and carries that override into the final approved decision.
- API blocks a manual underwriting override whose named underwriter is not a registered, active credit officer.
- API blocks a decision checker who is also the manual underwriting underwriter, preserving four-eyes separation on referred approvals.
- The checker's decision-approval task surfaces the manual underwriting override rationale and policy reference for review.
- API blocks a declined decision without a valid decline-reason code and carries the coded reason into the final decision.
- API requires maker-checker approval before disbursement.
- API blocks disbursement until the execution document packet is generated and delivered.
- API routes material AI decisions to human review before decision proposal.
- API stores staff actors and enforces role/queue checks on regulated workflow actions.
- API exposes LWS task queues with SLA status and persists task assignment/start audit.
- Repayment schedule amortizes principal over tenor.
- API opens a loan account on disbursement and posts ledger payments.
- API generates borrower statements from schedule and ledger.
- API renders a checksum-sealed borrower-facing loan statement document.
- API accrues scheduled interest into immutable ledger events, reconciles accrued interest with the schedule, and is idempotent on re-run.
- API re-amortizes the remaining schedule on a part-prepayment in both reduce-EMI and reduce-tenure modes and blocks an unknown mode.
- API quotes a foreclosure payoff, blocks an underpayment, settles the payoff, closes the account, and blocks re-foreclosure of a closed account.
- API issues a No-Objection closure certificate only for a settled account, blocks it while active, and returns the same certificate on re-issue.
- API controls disclosed charges, waivers, and reversals.
- API computes delinquency buckets and enforces recovery-agent notice plus same-day cash recovery posting.
- API classifies assets across standard, SMA, and NPA bands.
- API generates account-level and portfolio-level CIC-ready reporting snapshots.
- API exposes collections workflow tasks until recovery-agent notice assignment is recorded.
- API manages complaint lifecycle, 30-day grievance SLA, and RBI CMS escalation tasks.
- API generates rendered document packets and transitions LWS from document delivery to disbursement readiness.
