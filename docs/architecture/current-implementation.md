# Current Implementation Map

This document describes what exists in the repository today.

## Runtime Shape

The current implementation is intentionally small:

- No external npm dependencies.
- Node.js built-in HTTP server.
- File-backed JSON state under `.loanos-data/state.json`, partitioned into a control plane (tenant registry) and one data plane per tenant.
- Multi-tenant: every data-plane request runs inside exactly one tenant, resolved from an `x-api-key`/bearer token; cross-tenant access is impossible by construction because each request only ever receives its own tenant's partition.
- Core domain logic in `packages/core/src`.
- API wrapper in `apps/api/src`.
- Automated tests in `tests/` (119 tests as of the latest commit).

Run it:

```bash
npm test
npm run dev:api
```

## File Map

| Path | Role |
| --- | --- |
| `packages/core/src/compliance-controls.js` | Regulatory control catalog and finding helpers. |
| `packages/core/src/audit.js` | Tenant-scoped, append-only audit hash chain: tenant-bound genesis, canonical hashing, `sealAuditChain`, `verifyAuditChain`, and `buildAuditEvidencePack`. |
| `packages/core/src/access-control.js` | Staff actor registry, role checks, queue assignment authority, and regulated-action actor validation. |
| `packages/core/src/grievance.js` | Complaint registry, grievance lifecycle, 30-day RBI Ombudsman clock, and RBI CMS escalation evidence. |
| `packages/core/src/document-packet.js` | KFS, sanction letter, loan agreement summary, and privacy notice rendering, rendered borrower loan-statement document, plus delivery evidence controls. |
| `packages/core/src/document-vault.js` | Document-vault receipt builder for signed execution packets: signature evidence, India storage policy, retention policy, per-document checksums, and manifest checksum. |
| `packages/core/src/registries.js` | Regulated-entity, LSP, DLA, and product-policy registries, prepayment/foreclosure/reset validations, DLA CIMS export shape, plus application reference resolution. |
| `packages/core/src/offer-marketplace.js` | Multi-lender offer marketplace: validates offer presentation neutrality, enforces ranking and partner disclosures, blocks dark patterns, and performs objective sorting. |
| `packages/core/src/borrower-onboarding.js` | Borrower profile, consent ledger, KYC records (with RBI risk-based periodic-review refresh status), a PMLA beneficial-owner registry for legal-entity borrowers, borrower reference resolution, and in-place redaction for DPDP erasure. |
| `packages/core/src/eligibility.js` | Policy-driven creditworthiness/affordability engine: EMI/FOIR computation, age-at-maturity, amount/tenor bounds, and eligible/refer/ineligible decision. |
| `packages/core/src/data-sharing.js` | Third-party data-disclosure ledger: consent-gated `consent`-basis sharing, `legal_obligation`-basis sharing requiring a legal reference, both logged as DPDP record-of-processing entries. |
| `packages/core/src/data-retention.js` | DPDP right-to-erasure workflow: `assessErasureEligibility` holds erasure while a statutory retention window (active loan, or a closed account inside the 5-year RBI/PMLA window) applies; fulfilment redacts the borrower profile in place. |
| `packages/core/src/fraud-case.js` | Fraud case module: natural-justice gate (show-cause notice + response or 21-day RBI FRM-2024 window) and four-eyes classification, plus a checksum-sealed committee pack generator. |
| `packages/core/src/recovery-agent.js` | Recovery-agent empanelment registry: an active agent requires due-diligence/police-verification, training certification, code-of-conduct acknowledgment, and authorization-letter/ID-card evidence, referencing an active regulated entity. |
| `packages/core/src/application-workflow.js` | LOS application state machine, KFS workflow, human review, decision proposal, manual underwriting override gate for referred applications, coded decline-reason taxonomy, maker-checker approval, disbursement transition. |
| `packages/core/src/loan-account.js` | LMS loan account creation, amortization schedule, ledger balance reconstruction, interest accrual, payment posting, part-prepayment re-amortization, foreclosure quote and payoff, closure No-Objection Certificate, statements, charges, waivers, reversals, delinquency, collections reminders (RBI FPC contact-hours gate), recovery controls, hardship restructure, floating-rate interest rate resets, settlement/write-off, asset classification, and CIC snapshots. |
| `packages/core/src/loan-policy.js` | India-only loan validation, KFS validation (including prepayment/foreclosure checks), sanction readiness, disbursement checks. |
| `packages/core/src/model-governance.js` | AI/model inventory (including generative model class), model status, governed lifecycle transitions with a validation gate (fairness/explainability/monitoring for high-risk, adversarial/hallucination testing for generative), drift monitoring with auto kill-switch, global/model kill switch, kill-switch incident and post-incident review workflow, runtime model-use evaluation. |
| `packages/core/src/ai-interaction.js` | Customer-facing AI disclosure generation (blocked for back-office/inactive/kill-switched models) and human-handoff request/resolution workflow. |
| `packages/core/src/incident-notification.js` | Tenant-scoped security/data incident tracking with an independent 6-hour reporting clock per authority (CERT-In and RBI), surfacing overdue reporting duties. |
| `packages/core/src/workflow-tasks.js` | LWS task derivation from LOS/LMS state (including pending DPDP access/correction requests) plus task assignment, start, release, and comment lifecycle. |
| `packages/core/src/cersai.js` | CERSAI security-interest lifecycle (draft → filed → registered → modified → satisfied): maker-checker modification, closure-gated satisfaction, prior-encumbrance search, and a `securedLoan` disbursement gate (SARFAESI Act). |
| `packages/core/src/data-principal-rights.js` | DPDP data-principal access requests (portable data pack assembly) and correction requests (apply/reject with profile propagation), both under a 30-day SLA clock with overdue detection. |
| `packages/core/src/fiu-str.js` | FIU-IND STR/CTR/CCR lifecycle (draft → reviewed → filed → acknowledged): Principal Officer review gate, ₹10 lakh CTR threshold, and a tipping-off guard (PMLA). |
| `packages/core/src/external-services.js` | Switchable `ExternalServiceManager` for external integrations (SMS, email, WhatsApp, credit bureau, V-CIP, bank-account verification, NACH/UPI payment rails, eSign, CERSAI, FIU-IND) with mock/real providers selected per integration and India data-residency checks enforced across all external services. |
| `packages/core/src/audit.js` | Tenant-scoped, append-only audit hash chain: tenant-bound genesis, canonical hashing, `sealAuditChain`/`verifyAuditChain`/`buildAuditEvidencePack`, plus uniform `stampAuditEvents`/`classifyAuditDataClass` actor/data-class provenance. |
| `packages/core/src/index.js` | Public exports for core domain modules. |
| `apps/api/src/file-store.js` | Local JSON state load/save helpers; control-plane tenant registry (api-key hashing, tenant resolution), sub-processor register, and break-glass grants; per-tenant data partitions and tenant-scoped accessors; `buildTenantExport`/`offboardTenant` for portability and evidenced deletion. |
| `apps/api/src/server.js` | HTTP API: platform control plane (tenant minting, export, offboarding, break-glass, sub-processors), tenant-context resolution with break-glass fallback and 401 gate, tenant-scoped store with centralized audit stamping, plus endpoints for compliance controls, AI models, kill switch, workflow tasks, applications, loan accounts, document vault, communications, payment rails, fraud cases, erasure requests, data disclosures, incidents, bank-account verification, CERSAI security interests, DPDP access/correction requests, and FIU-IND reports. |
| `tests/compliance.test.js` | Regression tests for compliance, API, tenancy, audit, LOS/LMS/LWS, and integration-ledger gates. |
| `tests/external-services.test.js` | Provider-boundary tests for `ExternalServiceManager` mock/real dispatch and residency guards. |

## Implemented API Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Service health. Open route, no tenant context. |
| `GET /compliance/controls` | Returns regulatory control catalog. Open route. |
| `GET /reference/decline-reasons` | Returns the coded decline-reason taxonomy. Open route. |
| `POST /platform/tenants` | Mints a tenant and returns a one-time api key; requires the platform admin key. |
| `GET /platform/tenants` | Lists tenants (no secrets); requires the platform admin key. |
| `GET /platform/tenants/:id` | Reads one tenant record; requires the platform admin key. |
| `GET /platform/tenants/:id/export` | Produces a reproducible tenant portability export (control record, data plane, audit evidence pack); requires the platform admin key. |
| `POST /platform/tenants/:id/offboarding` | Purges the tenant's data plane, revokes its api key, and retains a deletion attestation; requires the platform admin key. |
| `POST /platform/tenants/:id/break-glass` | Mints a time-boxed, tenant-scoped break-glass credential (returned once, hashed at rest); requires the platform admin key. |
| `GET /platform/tenants/:id/break-glass` | Lists break-glass grants minted for a tenant; requires the platform admin key. |
| `POST /platform/break-glass/:grantId/revoke` | Revokes a break-glass grant immediately; requires the platform admin key. |
| `POST /platform/sub-processors` | Registers a sub-processor with DPA and data-residency evidence; requires the platform admin key. |
| `GET /platform/sub-processors` | Lists the sub-processor register; requires the platform admin key. |
| `GET /audit/events` | Lists the tenant's sealed audit chain (filterable by `type`/`subjectId`/`from`/`to`) with a chain-validity verdict. |
| `GET /audit/export` | Produces an integrity-attested evidence pack from the tenant's audit chain; 409 if the chain fails verification. |
| `GET /sub-processors` | Standing disclosure of the sub-processor register to every authenticated tenant, flagging cross-border processing. |
| `GET /break-glass-grants` | Lists every break-glass grant scoped to the calling tenant, with effective status. |
| `GET /document-vault` | Lists signed document-vault receipts, filterable by `applicationId`, `borrowerId`, or `packetId`. |
| `GET /document-vault/:id` | Reads a document-vault receipt by id. |
| `GET /communications` | Lists tenant communication dispatch receipts, filterable by channel, purpose, borrower, application, or loan account. |
| `POST /integrations/communications` | Dispatches SMS/email/WhatsApp through `ExternalServiceManager`, stores a masked/hash-only communication receipt, and seals the attempt into the tenant audit chain. |
| `GET /payment-rails` | Lists NACH/UPI payment rail initiation receipts, filterable by type, channel, status, borrower, application, loan account, or provider reference. |
| `POST /integrations/payment-rails/nach-mandates` | Registers a NACH mandate through `ExternalServiceManager`, stores sanitized mandate evidence (account last-four/hash, provider ref, amount/frequency, consent/bank-verification refs), and seals the initiation into the tenant audit chain. |
| `POST /integrations/payment-rails/upi-collects` | Creates a UPI collect request through `ExternalServiceManager`, stores masked/hash-only VPA evidence with provider/status data, and seals the initiation into the tenant audit chain. |
| `POST /integrations/bank-account-verification` | Verifies a borrower/end-beneficiary bank account through `ExternalServiceManager`, returning sanitized evidence (`verificationRef`, IFSC, last four digits, status/name match) and sealing the attempt into the tenant audit chain. |
| `POST /integrations/credit-bureau` | Queries Credit Bureau (CIBIL equivalent) score for a given PAN; enforces data residency and returns the bureau report. |
| `POST /integrations/vcip/video-analysis` | Invokes V-CIP video analysis / facial match; enforces data residency and returns V-CIP verification outcome. |
| `GET /incidents` | Lists tenant security/data incidents with computed CERT-In/RBI reporting-clock status. |
| `POST /incidents` | Creates a tenant security/data incident, starting the 6-hour reporting clock. |
| `GET /incidents/:id` | Reads one incident with computed reporting-clock status. |
| `POST /incidents/:id/notifications` | Records a regulator notification (CERT-In/RBI) against an incident. |
| `GET /sandbox-environments` | Lists all sandbox environments created by the tenant. |
| `POST /sandbox-environments` | Creates a new isolated sandbox environment partition and generates a test API key. |
| `POST /sandbox-environments/:name/reset` | Resets a sandbox environment state; optionally preserves configuration parameters. |
| `DELETE /sandbox-environments/:name` | Deletes a sandbox environment and purges its data partition. |
| `GET /fraud-cases` | Lists fraud cases. |
| `POST /fraud-cases` | Creates a fraud case (reported → under_investigation). |
| `GET /fraud-cases/:id` | Reads one fraud case. |
| `POST /fraud-cases/:id/show-cause-notice` | Records a show-cause notice with delivery proof. |
| `POST /fraud-cases/:id/responses` | Records the borrower's response to a show-cause notice. |
| `POST /fraud-cases/:id/classification` | Classifies the case (fraud/not-fraud) under the natural-justice and four-eyes gate. |
| `GET /fraud-cases/:id/committee-pack` | Generates a checksum-sealed committee pack with the natural-justice trail and classification verdict. |
| `GET /erasure-requests` | Lists DPDP erasure requests. |
| `POST /erasure-requests` | Creates a DPDP erasure request for a borrower. |
| `GET /erasure-requests/:id` | Reads one erasure request with computed retention-eligibility status. |
| `POST /erasure-requests/:id/fulfillment` | Fulfils an eligible erasure request, redacting the borrower profile in place. |
| `POST /erasure-requests/:id/rejection` | Rejects an erasure request still held by statutory retention. |
| `GET /borrowers/:id/access-requests` | Lists a borrower's DPDP data-principal access requests with SLA status. |
| `POST /borrowers/:id/access-requests` | Creates a DPDP access request for a borrower. |
| `POST /borrowers/:id/access-requests/:reqId/fulfillment` | Fulfils an access request, assembling and returning the portable data pack. |
| `GET /borrowers/:id/correction-requests` | Lists a borrower's DPDP correction requests with SLA status. |
| `POST /borrowers/:id/correction-requests` | Creates a DPDP correction request capturing current and proposed field values. |
| `POST /borrowers/:id/correction-requests/:reqId/review` | Applies or rejects a correction request; applied corrections propagate into the borrower profile. |
| `GET /loan-accounts/:id/security-interests` | Lists CERSAI security interests for a loan account. |
| `POST /loan-accounts/:id/security-interests` | Creates a draft CERSAI security interest. |
| `POST /loan-accounts/:id/security-interests/:siId/filing` | Files the security interest with CERSAI. |
| `POST /loan-accounts/:id/security-interests/:siId/registration` | Records CERSAI registration of a filed security interest. |
| `POST /loan-accounts/:id/security-interests/:siId/modification` | Files a maker-checker modification to a registered charge. |
| `POST /loan-accounts/:id/security-interests/:siId/satisfaction` | Files satisfaction/release of a charge on loan closure. |
| `GET /cersai/search` | Searches existing CERSAI charges on an asset (prior-encumbrance check). |
| `GET /fiu/reports` | Lists FIU-IND STR/CTR reports (filterable by type, subject, status). |
| `POST /fiu/reports` | Creates an STR or CTR (CTR enforces the ₹10 lakh threshold). |
| `GET /fiu/reports/:id` | Reads one FIU-IND report. |
| `POST /fiu/reports/:id/review` | Records the designated Principal Officer's review of an STR. |
| `POST /fiu/reports/:id/filing` | Files the report with FIU-IND and records the acknowledgement. |
| `GET /data-disclosures` | Lists third-party data-disclosure records (filterable by `borrowerId`). |
| `POST /data-disclosures` | Records a third-party data disclosure, gated on active consent or a cited legal reference. |
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
| `POST /products` | Creates or updates a product policy after compliance validation; a higher `version` publishes a new policy version, archiving the superseded one. |
| `GET /products/:id` | Reads one product policy; `?asOf=` resolves the version governing a given date. |
| `GET /borrowers` | Lists borrower profiles. |
| `POST /borrowers` | Creates or updates a borrower profile after India/KYC/economic-profile validation. |
| `GET /borrowers/:id` | Reads one borrower profile. |
| `GET /borrowers/:id/consents` | Lists borrower consent records. |
| `POST /borrowers/:id/consents` | Creates or updates a borrower consent record. |
| `GET /borrowers/:id/kyc-records` | Lists borrower KYC records. |
| `POST /borrowers/:id/kyc-records` | Creates or updates a borrower KYC record. |
| `POST /borrowers/:id/ckyc/search` | Searches the CKYC registry by identifier (PAN). |
| `POST /borrowers/:id/ckyc/download` | Downloads and syncs a verified record from CKYC to borrower profile. |
| `POST /borrowers/:id/ckyc/upload` | Uploads a local verified KYC record to CKYC registry. |
| `POST /borrowers/:id/vcip/evidence` | Records V-CIP evidence (video recording hash, India GPS coordinates, liveness confirmation, face match score >=0.8, official digital signature) and updates borrower KYC record. |
| `GET /borrowers/:id/vcip/evidence` | Retrieves V-CIP evidence details for the borrower's V-CIP KYC record. |
| `GET /borrowers/:id/beneficial-owners` | Lists a legal-entity borrower's declared beneficial owners. |
| `POST /borrowers/:id/beneficial-owners` | Declares or updates a beneficial owner (ownership/control/senior-managing-official) with identification and verification evidence. |
| `GET /staff/actors` | Lists operational staff actors. |
| `POST /staff/actors` | Creates or updates an operational actor with roles, queues, and assignment authority. |
| `GET /staff/actors/:id` | Reads one operational staff actor. |
| `GET /recovery-agents` | Lists empanelled recovery agents. |
| `POST /recovery-agents` | Registers or updates a recovery agent; an active agent requires due-diligence, training, code-of-conduct, and authorization evidence. |
| `GET /recovery-agents/:id` | Reads one recovery agent. |
| `GET /complaints` | Lists complaints with computed SLA and effective status. |
| `POST /complaints` | Creates a borrower complaint with acknowledgement evidence. |
| `GET /complaints/:id` | Reads one complaint with computed SLA and effective status. |
| `POST /complaints/:id/assignments` | Assigns a complaint to a grievance officer. |
| `POST /complaints/:id/reviews` | Starts grievance-officer review. |
| `POST /complaints/:id/resolution` | Records complaint resolution and closure evidence. |
| `POST /complaints/:id/rbi-cms-escalation` | Records RBI CMS escalation reference and reason. |
| `GET /ai/models` | Returns model registry and kill-switch state. |
| `POST /ai/models` | Registers or updates a model in inventory. |
| `POST /ai/models/:id/transitions` | Moves a model through its governed lifecycle (submit, approve validation, activate, suspend, reinstate, retire); a generative model additionally requires adversarial (`redTeamRef`) and hallucination (`hallucinationTestRef`) evidence to approve validation. |
| `POST /ai/models/:id/drift-observations` | Records a drift metric reading against an active model; a threshold breach auto-trips a model-scoped kill switch and opens an incident. |
| `GET /ai/models/:id/disclosure` | Generates the mandated customer disclosure for a customer-facing, active model; blocked for back-office, inactive, or kill-switched models. |
| `GET /ai/handoff-requests` | Lists AI-to-human handoff requests. |
| `POST /ai/handoff-requests` | Requests a human handoff from an AI interaction. |
| `POST /ai/handoff-requests/:id/resolution` | Resolves a handoff request, recording the named human agent who handled it. |
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
| `POST /loans/marketplace-offers` | Evaluates, validates, and ranks multi-lender marketplace offers, blocking dark patterns. |
| `GET /loans/marketplace-offers/:id` | Reads a stored marketplace offer evaluation record. |
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
| `POST /loan-accounts/:id/reminders` | Logs a collections reminder/notice, blocking voice-channel contact outside the RBI FPC 08:00-19:00 IST window. |
| `POST /loan-accounts/:id/restructure` | Restructures a stressed loan under four-eyes approval (tenure extension and/or rate concession, re-amortized). |
| `POST /loan-accounts/:id/rate-resets` | Resets interest rate on a floating-rate loan under four-eyes approval (options: extend tenor, increase EMI, switch to fixed). |
| `POST /loan-accounts/:id/settlement` | Closes a loan for less than outstanding under four-eyes approval, waiving the shortfall. |
| `POST /loan-accounts/:id/write-off` | Marks a loan written off (book loss) while retaining the ledger dues. |
| `POST /loan-accounts/:id/charges` | Assesses a KFS-disclosed charge. |
| `POST /loan-accounts/:id/accruals` | Posts interest-accrual ledger events for installments due as of a date and returns the reconciled balance summary. |
| `GET /loan-accounts/:id/foreclosure-quote` | Returns a foreclosure payoff quote (principal, due interest, charges, disclosed foreclosure charge) for an `asOf` date. |
| `POST /loan-accounts/:id/foreclosure` | Executes foreclosure: settles the payoff, records the foreclosure, and closes the account. |
| `GET /loan-accounts/:id/closure-certificate` | Reads the issued No-Objection closure certificate. |
| `POST /loan-accounts/:id/closure-certificate` | Issues a No-Objection closure certificate for a settled account (idempotent re-issue). |
| `POST /loan-accounts/:id/payments` | Posts payment ledger event and returns updated balance summary. |
| `POST /loan-accounts/:id/prepayments` | Posts a part-prepayment and re-amortizes the remaining schedule (`reduce_emi` or `reduce_tenure`). |
| `POST /loan-accounts/:id/cash-recoveries` | Posts noticed-agent cash recovery with same-day reflection control, a coded exception reason, and a role-checked approver. |
| `POST /loan-accounts/:id/waivers` | Posts approved charge waiver. |
| `POST /loan-accounts/:id/reversals` | Posts approved reversal of a ledger event. |

## Current Control Coverage

| Control | Current behavior |
| --- | --- |
| Tenant isolation | State is partitioned per tenant; each data-plane request receives only its own tenant's partition, so a handler has no code path to another tenant's records. |
| Tenant authentication | Data-plane routes require a valid `x-api-key`/bearer token mapping to an active tenant; missing or invalid keys return 401. Only health and static reference routes are open. |
| Tenant provisioning | The platform control plane mints tenants behind an admin key and returns a one-time api key stored only as a SHA-256 hash. |
| Audit spine | Every save seals the tenant's events into an append-only SHA-256 hash chain with a tenant-bound genesis; `verifyAuditChain` detects any edit, drop, reorder, or genesis swap. |
| Uniform audit provenance | Every event is stamped with an `actor`/`actorType`/`dataClass` envelope before sealing (tenant-attributed normally, platform-staff under break-glass), hashed into the chain. |
| Evidence export | `GET /audit/export` emits an auditor-ready pack (genesis/head anchors, whole-chain integrity verdict, optionally filtered events) and 409s rather than release a broken chain. |
| Tenant portability export | `GET /platform/tenants/:id/export` produces a reproducible export (control record, full data plane, audit evidence pack) from source-of-truth records. |
| Tenant offboarding | `POST /platform/tenants/:id/offboarding` purges the data plane, revokes the api key, and retains a control-plane deletion attestation (erased event count, audit head hash, content digest, actor, reason); requires actor+reason and blocks re-offboarding. |
| Sub-processor register | Platform admin registers sub-processors with a DPA and data-residency country; every tenant reads the register standing-disclosed, with cross-border processing flagged. |
| Break-glass access | Platform admin mints a time-boxed, tenant-scoped credential; using it authenticates as that tenant and seals a `platform.break_glass.access` event into the tenant's own audit chain on every request. Tenants see every grant scoped to them; revoke and TTL expiry cut off auth. |
| Incident notification | A tenant-scoped security/data incident runs an independent 6-hour reporting clock per authority (CERT-In and RBI); a duty unreported past 6 hours from detection surfaces `overdue`/`reporting_overdue`. |
| India-only lending | Blocks non-IN borrower residency/address, non-INR currency, non-IN data storage. |
| Regulated entity | Requires supported RE type and grievance officer. |
| Regulated entity registry | Requires active India RE, website, privacy policy, grievance officer, data-residency posture, and board policy references. |
| LSP registry | Requires active LSPs to reference an active RE, carry a clear agreement/scope, enhanced due-diligence evidence, periodic review evidence, portfolio monitoring, borrower-facing grievance/privacy disclosures, India data controls, RE-paid fee controls, and recovery-agent guidance where applicable. |
| DLA registry and CIMS export | Requires active own/LSP DLA records to reference an active RE; LSP-owned DLAs must also reference an active LSP governed by the same RE. Active records must expose availability/link, grievance contact, privacy/disclosure URLs, India data controls, RE website linkage, and CCO/compliance attestation; active records export to RBI CIMS-ready rows. |
| Product policy registry | Requires active product linked to an active RE, INR, amount/tenor bounds, APR, cooling-off, recovery mechanism, eligibility, board approval, and safe charge design. |
| Product policy versioning | A product policy carries `version`/`effectiveFrom`/`effectiveTo`; a higher version publishes a new version and archives the superseded one into `priorVersions`; `selectProductPolicyVersion`/`?asOf=` resolve the version governing a given date. |
| Registry-backed applications | Application can reference `regulatedEntityId` and `productId`/`productCode`; policy facts are resolved before preflight. |
| Borrower profile registry | Requires active India borrower profile, contact channel, and economic profile for active borrowers. |
| Consent ledger | Requires borrower-linked purpose, notice version, granted/revoked status, and evidence timestamps. |
| Third-party data disclosure | Consent-basis (`consent`) disclosures are blocked without an active `third_party_sharing` consent; legal-obligation-basis disclosures (CIC/regulator) require a cited `legalReference`; both are logged as DPDP record-of-processing entries. |
| DPDP right-to-erasure | An erasure request is held while the borrower has an active loan or any closed account is within the 5-year RBI/PMLA retention window; fulfilment redacts the borrower profile in place, retaining a skeleton for audit. |
| KYC record registry | Requires borrower-linked KYC status, risk category, verified timestamp, V-CIP India storage, and no Aadhaar biometric/OTP/PID persistence. |
| V-CIP evidence vault | Enforces video recording hash, India GPS coordinates boundary, PAN reference, liveness check, facial match score (>=0.8), official digital signature, and active kyc_officer/credit_officer actor validation. |
| KYC periodic-review refresh | A verified KYC record past its RBI risk-based review cycle (high 2y / medium 8y / low 10y) reads as `refresh_required`; preflight blocks new sanction on a refresh-due or expired KYC record. |
| Beneficial-owner registry (PMLA) | A legal-entity (company/partnership/llp/trust) borrower's application preflight is blocked without at least one verified beneficial owner meeting the PMLA controlling-interest threshold (25% company, 15% partnership/llp/trust) or declared as control/senior-managing-official. |
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
| Execution document packet | Renders borrower-facing HTML/text KFS, sanction letter, agreement summary, and privacy notice with SHA-256 checksums, delivery evidence, eSign evidence, and document-vault receipt indexing. |
| Document vault | Successful eSign stores a tenant-scoped receipt with signed-packet signature evidence, India storage country, retention policy, per-document checksum manifest, and manifest checksum; the receipt is readable without duplicating full HTML bodies. |
| LWS task queues | Derives active tasks for blocked compliance, KFS acceptance, credit decision, manual underwriting review for eligibility-referred applications, AI human review, checker approval (surfacing any manual underwriting override for the checker to review), document packet delivery, disbursement, recovery assignment, NPA review, complaint assignment, complaint resolution, and RBI CMS escalation. Each task includes SLA target, due time, and breach status. |
| LWS task audit | Persists assignment, start, release, and comment events while the domain state remains the source of truth for task resolution. |
| Fraud case module | Runs a tenant-scoped fraud case (`reported → under_investigation → show_cause_issued → classified_fraud/classified_not_fraud`). |
| Natural justice and four-eyes fraud classification | An adverse (fraud) classification is blocked until a show-cause notice was issued (with delivery proof) and the borrower responded or the RBI FRM-2024 21-day window elapsed, and the classifier must be independent of the investigator. |
| Fraud committee pack | A checksum-sealed, read-only pack assembling case facts, the natural-justice trail, the event timeline, and an explicit `classificationPermitted`/`blockers` verdict. |
| Loan account opening | Disbursement opens an LMS loan account and creates a disbursement ledger event. |
| Repayment schedule | Generates monthly reducing-balance amortization schedule from KFS/product terms. |
| Loan ledger | Reconstructs principal, interest, paid amounts, outstanding balance, and next due from ledger and schedule. |
| Interest accrual | Recognizes scheduled interest as immutable `interest_accrual` ledger events once each installment period closes; idempotent per installment, reconstructable from the ledger, and reconciled against the schedule in the balance summary. |
| Foreclosure | Quotes a payoff of outstanding principal plus interest and charges already due (no future interest); any foreclosure charge must be KFS-disclosed, and enforces lock-in period and floating-rate individual retail fee prohibitions. Execution requires the amount to cover the payoff, settles it through the ledger, and closes the account. |
| Closure NOC | A settled (closed, zero-dues) account can issue a checksum-sealed No-Objection Certificate declaring no dues remain and no objection to releasing securities; re-issue returns the same certificate. |
| Payment posting | Posts payment events, allocates to due interest first and principal next, and updates account status. |
| Part-prepayment | Enforces lock-in period and floating-rate individual retail fee prohibitions, clears dues then reduces principal, requiring a real principal reduction, and rebuilds the future schedule either to lower each EMI over the same term (`reduce_emi`) or keep the EMI and shorten the tenure (`reduce_tenure`). |
| Borrower statements | Generates period statement from schedule and ledger transactions. |
| Rendered statement document | Renders the period statement into a checksum-sealed HTML/text borrower document (opening/closing balances, dues, transactions, totals) in the same shape as the execution packet. |
| Charge controls | Grounds KFS charges in Product Policy, validates KFS limits, and blocks ad-hoc ledger charge assessment, foreclosure charges, and prepayment charges exceeding KFS caps and policy ceilings. |
| Waivers and reversals | Requires approval evidence for waivers and reversals, and prevents duplicate reversal of the same event. |
| Delinquency buckets | Computes DPD bucket, earliest unpaid installment, and overdue amounts from schedule plus ledger. |
| Collections reminder workflow | Logs each borrower reminder/notice (channel, stage, delinquency snapshot); voice-channel (call/IVR) contact outside the RBI FPC 08:00-19:00 IST window is blocked. |
| Hardship restructure | Modifies a stressed active loan under four-eyes approval, extending tenure and/or conceding rate, and re-amortizes the remaining principal (past installments untouched); flags the account `restructured`. |
| Floating-rate reset | Resets the interest rate on a floating loan under four-eyes approval, offering choice-based re-amortization (extend tenor, increase EMI, switch to fixed with fee). |
| Settlement and write-off | `settleLoanAccount` closes a loan for less than outstanding under four-eyes approval via principal/interest waiver credits (`closureType: "settled"`); `writeOffLoanAccount` marks `written_off` as a book loss while retaining ledger dues; both surface in the CIC snapshot. |
| Asset classification | Maps DPD to standard, SMA-0, SMA-1, SMA-2, and NPA classes. |
| CIC snapshots | Produces account and portfolio reporting snapshots from schedule, ledger, borrower, RE, product, and asset-classification state. |
| Recovery-agent registry | An active recovery agent must reference an active regulated entity and carry due-diligence/police-verification, training-certification, code-of-conduct, and authorization-letter/ID-card evidence. |
| Recovery-agent notice | Recovery assignment requires delinquent account, an empanelled active recovery agent, borrower notice timestamp, and delivery reference. |
| Cash recovery posting | Cash recovery requires active noticed assignment, same-India-day posting to borrower account, a coded exception reason (cash is treated as an exception, not the default channel), and an approver checked against the active `collections_manager` staff-actor role. |
| Consent | Requires data-processing evidence and notice version. |
| KYC | Requires `verified` KYC state and risk category validation. |
| Aadhaar | Blocks biometric, OTP, or PID persistence flags. |
| Economic profile | Requires adult borrower, occupation, and monthly income. |
| KFS | Requires APR, amount, tenor, cooling-off, recovery mechanism, grievance details, charge structure. |
| Penal charges | Blocks penal interest and capitalization of penal charges. |
| Fund flow | Blocks LSP, DLA, pass-through, and pool account fund control. |
| Bank-account verification | `ExternalServiceManager.verifyBankAccount` supports mock/real providers; the API returns sanitized verification evidence and seals each attempt into the tenant audit chain. |
| Payment rails | `ExternalServiceManager.createNachMandate` and `createUpiCollect` support mock/real providers with India residency checks; API receipts store provider refs, status, amount/frequency/purpose, account last-four/hash, and masked/hash-only VPA evidence rather than raw payment credentials. |
| Communications provider | `ExternalServiceManager` dispatches SMS/email/WhatsApp through mock/real providers with India data-residency checks; API dispatch receipts store masked recipient, provider ref, purpose, residency country, and SHA-256 hashes rather than message bodies. |
| Disbursement | Requires approved loan, valid KFS, signed and delivered document packet, registered CERSAI charge when applicable, verified borrower/end-beneficiary bank account evidence, and direct borrower/end-beneficiary account ownership. |
| Model lifecycle | Governed transitions (draft → validation_pending → approved → active, plus suspend/reinstate/retire) with legal state guards. Approving validation requires independent validation evidence, an approver independent of the owner, and — for high-risk models — fairness, explainability, and monitoring evidence; a model reaches `active` only through this path. |
| AI model inventory | Blocks model use if missing from inventory. |
| AI model validation | Blocks active use without approved validation. |
| AI kill switch | Blocks model use when global switch is active or model is suspended. |
| AI drift monitoring | A drift metric reading breaching the model's threshold auto-trips a model-scoped kill switch, suspending the model and opening an incident that requires post-incident review before the model can run again. |
| Generative-AI testing gate | A model registered `modelClass: "generative"` must additionally evidence adversarial (`redTeamRef`) and hallucination (`hallucinationTestRef`) testing before validation can be approved. |
| Customer-facing AI disclosure | Generated only for a customer-facing, active model; blocked for back-office, inactive, or globally kill-switched models. |
| AI human handoff | Handoff requests move `pending → handled` by a named human agent, sealing `ai.human_handoff.*` events into the audit spine. |
| AI incident and clearance | A kill-switch trigger opens an incident; the global switch cannot be cleared until a post-incident review (root cause, remediation) is recorded, and clearance closes the incident while retaining the review evidence. |

## Known Limitations

- Persistence is local JSON only (now tenant-partitioned), not a production database.
- Tenant authentication is a static api key per tenant (hashed at rest); there is no human login/session or key rotation yet. Actor-level authorization remains API-level registry validation within a tenant.
- The platform admin key is a single shared secret from env/option; break-glass access is audited, but there are no individual platform-staff identities/roles yet (break-glass grants are minted by whoever holds the shared admin key).
- No live KYC, CKYC, bureau, bank-account, payment settlement/reconciliation, eSign, SMS, email, WhatsApp, or CERSAI integrations yet.
- Registries are file-backed and lack external IAM, maker-checker administration workflow, and periodic access review.
- Borrower/consent/KYC records are file-backed, but support CKYC registry and V-CIP evidence vault validation boundaries.
- Workflow is file-backed; the local dashboard is not a production workflow UI and outbound RBI CMS API integration is still planned.
- LMS restructure/settlement/write-off and collections reminders have first slices; full NACH file exchange, payment reconciliation, refunds, external CIC file/API submission, and full multi-channel recovery contact logging are still planned.
- Document packet renders HTML/text and stores document-vault receipts, but does not yet create PDFs or external eSign envelopes.
- UI is limited to the local operations dashboard; there is no production borrower/admin application yet.
- AI governance has first slices for lifecycle, validation gates (fairness/explainability/monitoring for high-risk, adversarial/hallucination for generative), drift-triggered kill switch, disclosure, and human handoff; recurring fairness reports and a sectoral incident-intelligence pack are still planned.
- The audit spine stamps a uniform actor/actorType/dataClass envelope on every event at the seal seam; signed external anchoring is a follow-on.
- Compliance docs are source-grounded but still require counsel/compliance review before production.

## Test Coverage

Current tests prove:

- Data-plane routes reject a missing or invalid tenant api key with 401, while health and compliance-controls stay open.
- Sealing events produces a verifiable hash chain; editing, dropping, or reordering an event breaks verification, a chain does not verify under another tenant's genesis, and re-sealing is idempotent.
- The API seals origination events into an audit chain, reports chain validity, exports an integrity-attested (and filterable) evidence pack, and keeps the audit spine tenant-scoped.
- The platform admin can mint a tenant, receives a one-time api key, and that key immediately authenticates data-plane calls; duplicate tenant ids are rejected.
- Two provisioned tenants are isolated: tenant B sees none of tenant A's records across resource types, by-id reads return 404, a re-used id writes only into B's own partition, and tenant A's data is unchanged.
- Valid India-only loan application passes preflight.
- Non-India borrower/currency/storage are blocked.
- LSP/pass-through fund flow is blocked.
- Aadhaar biometric/OTP persistence is blocked.
- Invalid KFS cooling-off and penal-charge design are blocked.
- KFS acceptance and delivery evidence gate sanction readiness.
- AI model kill switch blocks model-assisted underwriting.
- Model lifecycle blocks illegal transitions and un-validated approval, and only a validated, activated model can be used; API drives draft → active.
- A kill-switch trigger opens an incident, the global switch cannot be cleared before a recorded post-incident review, and clearance closes the incident while retaining the review evidence.
- A generative model must evidence adversarial (red-team) and hallucination testing before validation approval; a drift observation breaching threshold trips a model-scoped kill switch and opens an incident.
- The API discloses customer-facing AI (blocked for back-office/inactive/kill-switched models) and records a human-handoff request through to resolution by a named agent.
- Product policy versioning retains a prior version's window when superseded and resolves the version governing a given `asOf` date.
- A KYC record past its risk-based review cycle reads as `refresh_required` and blocks new sanction; the API surfaces refresh status and blocks on a refresh-due record.
- Third-party data sharing is gated on active consent for consent-basis disclosures, requires a legal reference for legal-obligation-basis disclosures, and both are logged.
- A DPDP erasure request is held by an active loan and by the 5-year statutory retention window, then redacts the borrower profile in place once eligible.
- A fraud case's adverse classification is gated on natural justice (show-cause notice + response/21-day window) and four-eyes separation; the committee pack seals the case and states classification readiness.
- A security/data incident's CERT-In/RBI reporting clock breaches after 6 hours undetected, and the API tracks the incident through report and notification.
- Collections reminders enforce the RBI FPC contact-hours window; a hardship restructure re-amortizes under four-eyes approval; settlement and write-off both close a loan under four-eyes approval and surface on the CIC snapshot.
- The platform can export a tenant (reproducible portability pack) and offboard it with evidenced deletion; break-glass access is time-boxed, tenant-visible, and seals an audit event on every use; the sub-processor register is disclosed to every tenant.
- Every sealed audit event carries a uniform actor/actorType/dataClass provenance envelope, attributed to the tenant or to platform staff under break-glass.
- Recovery-agent empanelment requires training, authorization, and code-of-conduct evidence for an active agent (and blocks an unknown regulated entity); a recovery assignment is blocked unless it names a registered, active recovery agent.
- Cash recovery is blocked without a coded exception reason and an approver holding the active `collections_manager` role; an unregistered approver is rejected before the domain gate runs.
- A legal-entity borrower's application preflight is blocked without a verified beneficial owner above the PMLA threshold (a below-threshold ownership stake still blocks), and unblocks once a qualifying owner is on file; a beneficial-owner declaration is rejected for an individual borrower.
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
- API creates a document-vault receipt when eSign succeeds, exposes it by list/id routes, and seals a `document_vault.packet_vaulted` audit event.
- API verifies borrower/end-beneficiary bank accounts through the integration boundary, seals sanitized evidence in the audit chain, and blocks disbursement without verified account proof.
- API initiates NACH mandates and UPI collects through the integration boundary, keeps masked/hash-only payment rail evidence, enforces India data-residency posture, and seals payment rail audit events as financial data.
- API dispatches SMS/email/WhatsApp communications through the integration boundary, keeps a masked/hash-only communication ledger, enforces India data-residency posture, and seals communication audit events as personal data.
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
