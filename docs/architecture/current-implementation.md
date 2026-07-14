# Current Implementation Map

This document describes what exists in the repository today.

## Runtime Shape

The current implementation is intentionally small:

- One external npm dependency (`pg`), used only by the optional Postgres storage driver — see below.
- Node.js built-in HTTP server. Routes are served both unprefixed and under an explicit `/v1` API-version namespace (stripped once at the dispatch seam) so a future `/v2` can be added within a documented deprecation window; `GET /health` reports `apiVersion`.
- Containerized: a slim `Dockerfile` (`npm ci --omit=dev`, non-root `node` user, `/health` HEALTHCHECK) and a `docker-compose.yml` bringing up the API on the Postgres/RLS driver against a schema-seeded Postgres 18.
- CI: `.github/workflows/ci.yml` runs `npm test` on the file store, plus a second job with a Postgres 18 service (trust auth) and `DATABASE_URL_TEST` set so the previously-skipped `tests/postgres-store.test.js` RLS/advisory-lock suite actually executes.
- Two interchangeable storage drivers, selected via `LOANOS_STORAGE_DRIVER` (defaults to `file` outside production):
  - **File-backed** (development/test default): JSON state under `.loanos-data/state.json`, partitioned into a control plane and one data plane per tenant; production rejects this driver.
  - **Postgres-backed** (opt-in, `LOANOS_STORAGE_DRIVER=postgres`): tenant data-plane documents live one-per-row in a `tenant_data` table under Postgres Row-Level Security — a second, database-enforced isolation layer beneath the application-layer one — with per-tenant advisory locking and per-tenant fetching so concurrent requests for different tenants no longer serialize behind one global lock. See [`db/schema.sql`](../../db/schema.sql), [`apps/api/src/postgres-store.js`](../../apps/api/src/postgres-store.js), and the [Postgres migration doc](postgres-migration.md) for the full v1/v2/v3 design and live-verification results.
- Multi-tenant: every data-plane request runs inside exactly one tenant, resolved from a tenant user session or `x-api-key`/bearer service token; cross-tenant access is impossible by construction because each request only ever receives its own tenant's partition (and, on the Postgres driver, is also blocked at the database layer by RLS).
- Core domain logic in `packages/core/src`.
- Decision engine (Rust) in `rules/`: API eligibility, KFS and decision call sites are wired through `LOANOS_RULES_ENGINE=off|shadow|active`. Enabled engine modes require a JSON `LOANOS_RULES_ENGINE_URLS` map with one URL per tenant; missing tenant routing fails closed before a request is sent. In active mode, the engine owns the stored decision, reasons, summary, outputs, and signed lineage. The engine remains tenant-bound, bundle-verified, deterministic and fail-closed as specified in the [decision engine design](decision-engine-design.md); that document's §15 checklist remains authoritative for phase status.
- Pure backend API in `apps/api/src`.
- Public platform website in `apps/web/`.
- Tenant-branded landing template in `apps/tenant/`.
- Internal staff workspace in `apps/dashboard/`.
- Borrower customer portal in `apps/customer/`: a responsive, white-labelled journey home with prioritised next actions, visual application milestones, repayment schedules, a document centre, guided media, grievance tracking, and DPDP access/correction/erasure controls.
- Shared design system tokens in `apps/shared/`.
- Automated tests in `tests/`: 182 file-driver/domain tests that always run, plus 5 Postgres integration tests that self-skip unless `DATABASE_URL_TEST` is set.

Run it:

```bash
npm test
npm run dev:api
```

## File Map

| Path | Role |
| --- | --- |
| `packages/core/src/compliance-controls.js` | Regulatory control catalog and finding helpers. |
| `rules/crates/rules-core/` | Decision engine contract types (`DecisionRequest`/`DecisionResponse`, decimal newtypes, reasons, outcomes, errors) — PH-0 of the [decision engine design](decision-engine-design.md). |
| `packages/core/src/audit.js` | Tenant-scoped, append-only audit hash chain: tenant-bound genesis, canonical hashing, `sealAuditChain`, `verifyAuditChain`, and `buildAuditEvidencePack`. |
| `packages/core/src/access-control.js` | Staff actor registry, role checks, queue assignment authority, and regulated-action actor validation. |
| `packages/core/src/grievance.js` | Complaint registry, grievance lifecycle, 30-day RBI Ombudsman clock, and RBI CMS escalation evidence. |
| `packages/core/src/document-packet.js` | KFS, sanction letter, loan agreement summary, and privacy notice rendering, rendered borrower loan-statement document, plus delivery evidence controls. |
| `packages/core/src/document-vault.js` | Document-vault receipt builder for signed execution packets: signature evidence, India storage policy, retention policy, per-document checksums, and manifest checksum. |
| `packages/core/src/registries.js` | Regulated-entity, LSP, DLA, and product-policy registries, prepayment/foreclosure/reset validations, DLA CIMS export shape, plus application reference resolution. |
| `packages/core/src/offer-marketplace.js` | Multi-lender offer marketplace: validates offer presentation neutrality, enforces ranking and partner disclosures, blocks dark patterns, and performs objective sorting. |
| `packages/core/src/borrower-onboarding.js` | Borrower profile, granular consent ledger, KYC records with sanctions/UAPA/PEP screening and risk-based review, corrected PMLA beneficial-owner thresholds/declaration evidence, borrower reference resolution, and DPDP erasure redaction. |
| `packages/core/src/eligibility.js` | Policy-driven creditworthiness/affordability engine: EMI/FOIR computation, age-at-maturity, amount/tenor bounds, and eligible/refer/ineligible decision. |
| `packages/core/src/data-sharing.js` | Third-party data-disclosure ledger: consent-gated `consent`-basis sharing, `legal_obligation`-basis sharing requiring a legal reference, both logged as DPDP record-of-processing entries. |
| `packages/core/src/data-retention.js` | DPDP right-to-erasure workflow: `assessErasureEligibility` holds erasure while a statutory retention window (active loan, or a closed account inside the 5-year RBI/PMLA window) applies; fulfilment and automated data-retention cleanup redact the borrower profile, KYC records, and beneficial owners in place. |
| `packages/core/src/fraud-case.js` | Fraud case module: natural-justice gate (show-cause notice + response or 21-day RBI FRM-2024 window) and four-eyes classification, plus a checksum-sealed committee pack generator. |
| `packages/core/src/recovery-agent.js` | Recovery-agent empanelment registry: an active agent requires due-diligence/police-verification, training certification, code-of-conduct acknowledgment, and authorization-letter/ID-card evidence, referencing an active regulated entity. |
| `packages/core/src/collections-recovery.js` | Assigned-agent call/field evidence, deterministic PTP evaluation, and maker-checker legal recovery across SARFAESI, Section 138, Lok Adalat, arbitration, DRT, civil suit, and insolvency, including checksum-sealed statutory notices and fail-closed clocks. |
| `packages/core/src/application-workflow.js` | LOS application state machine, KFS workflow, human review, decision proposal, manual underwriting override gate for referred applications, coded decline-reason taxonomy, maker-checker approval, disbursement transition. |
| `packages/core/src/repayment-schedule.js` | Shared KFS/LMS paise-exact schedule engine for weekly, fortnightly, monthly, and quarterly amortising, bullet, moratorium, and step-up structures. |
| `packages/core/src/loan-account.js` | LMS term and revolving account creation, ledger reconstruction, scheduled/daily-utilisation interest, bounded drawdowns, facility reviews, payment posting, part-prepayment, foreclosure, statements, charges, recovery controls, restructure/reset, resolution, classification, and CIC snapshots. |
| `packages/core/src/cic-reporting.js` | Versioned consumer/commercial canonical UCRF records, 15th/month-end reporting calendar, checksum-sealed maker-checker batches, default-reporting alert evidence, bureau acknowledgement reconciliation, rejected-row repair/resubmission, and 21/30-day CIC correction controls. Provider-specific proprietary files and transport are adapter responsibilities. |
| `packages/core/src/ckyc-reporting.js` | Versioned individual/legal-entity CKYCRR canonical packets, scan/photo/document-manifest constraints, checksum and maker-checker controls, signed SFTP/portal transmission evidence, accepted/rejected/probable-match responses, seven-day reconciliation, provider-only identifier assignment, customer notification, and consent/authentication-gated downloads. |
| `packages/core/src/finance-accounting.js` | Governed ECL assessment and allowance movements, including co-lender entity allocation, finance-only journal projection, IRAC income-reversal journals, TDS journals/return extracts, and GST invoice/credit-note return aggregation. |
| `packages/core/src/payment-operations.js` | Suspense-receipt creation, partial loan allocation, and independently approved residual write-off; all amounts remain exact to paise and resolutions post through the canonical loan-payment function. |
| `packages/core/src/finance-management.js` | EIR fee-amortisation journals, funding-cost attribution, ALM maturity buckets, profitability, economic-capital, and RAROC reporting. |
| `packages/core/src/co-lending.js` | RBI CLA agreement validation, partner funding/interest/fee and servicing GST/TDS economics, originating-RE retention, escrow evidence, exposure, and paise-exact loan allocation. |
| `packages/core/src/co-lending-finance.js` | Partner transfer pricing, entity-level ECL/provision attribution, GST/TDS-adjusted statements, checksum-sealed tax exchange, exact settlement reconciliation, and balanced partner/servicing journals. |
| `packages/core/src/external-services.js` | India-resident mock-or-real external provider boundary, including fail-closed checksum-bound co-lending escrow instructions and core-banking journal batches. |
| `packages/core/src/loan-policy.js` | India-only loan validation, KFS validation (including prepayment/foreclosure checks), sanction readiness, disbursement checks. |
| `packages/core/src/model-governance.js` | AI/model inventory (including generative model class), model status, governed lifecycle transitions with a validation gate (fairness/explainability/monitoring for high-risk, adversarial/hallucination testing for generative), drift monitoring with auto kill-switch, global/model kill switch, kill-switch incident and post-incident review workflow, runtime model-use evaluation. |
| `packages/core/src/ai-interaction.js` | Customer-facing AI disclosure generation (blocked for back-office/inactive/kill-switched models) and human-handoff request/resolution workflow. |
| `packages/core/src/incident-notification.js` | Tenant-scoped incident tracking with CERT-In/RBI six-hour clocks plus immediate and detailed DPDP Board and affected-data-principal notice duties. |
| `packages/core/src/workflow-tasks.js` | LWS task derivation from LOS/LMS state (including pending DPDP access/correction requests) plus task assignment, start, release, and comment lifecycle. |
| `packages/core/src/cersai.js` | CERSAI security-interest lifecycle with checksum-sealed canonical registration packets, India-resident provider submission evidence, payment/certificate-bound responses, rejection repair lineage, maker-checker modification, closure-gated satisfaction, prior-encumbrance search, and a `securedLoan` disbursement gate (SARFAESI Act). Certified gateway schema conformance remains an adapter/onboarding boundary. |
| `packages/core/src/data-principal-rights.js` | DPDP data-principal access requests (portable data pack assembly) and correction requests (apply/reject with profile propagation), both under a 30-day SLA clock with overdue detection. |
| `packages/core/src/fiu-str.js` | FIU-IND STR/CTR/CCR lifecycle with canonical FINnet XML (ARF/TRF/CRF) packets, Principal Officer review, ₹10 lakh CTR threshold, source-field validation, checksum-sealed filing, exact acknowledgement/reject handling, independent repair lineage, and a tipping-off guard (PMLA). Certified FIU XSD/rules validation remains the provider adapter boundary. |
| `packages/core/src/external-services.js` | Switchable `ExternalServiceManager` for external integrations (SMS, email, WhatsApp, credit bureau, V-CIP, bank-account verification, NACH/UPI payment rails, eSign, CERSAI, FIU-IND) with mock/real providers selected per integration and India data-residency checks enforced across all external services. CERSAI/FIU real submissions use bounded timeout/retry, checksum-derived idempotency keys, and a fail-closed circuit breaker. |
| `packages/core/src/audit.js` | Tenant-scoped, append-only audit hash chain: tenant-bound genesis, canonical hashing, `sealAuditChain`/`verifyAuditChain`/`buildAuditEvidencePack`, plus uniform `stampAuditEvents`/`classifyAuditDataClass` actor/data-class provenance. |
| `packages/core/src/index.js` | Public exports for core domain modules. |
| `apps/shared/design-tokens.css` | Shared CSS variables and styling presets (typography, neobrutalist buttons, forms, status tags, alerts, toasts). |
| `apps/web/index.html` | Public SaaS landing page for LoanOS. |
| `apps/tenant/index.html` | Dynamic template for a tenant's own landing page (white-labeled via `/t/{tenantId}/branding`). |
| `apps/customer/index.html` | Accessible page structure for the white-labelled borrower portal: secure sign-in, journey home, applications, repayments, documents, help, privacy, and compliant customer dialogs. |
| `apps/customer/assets/portal.css` | Responsive customer-experience design system and layouts, including mobile navigation, application milestones, media surfaces, documents, support, privacy, dialogs, and reduced-motion handling. |
| `apps/customer/assets/portal.js` | Borrower portal controller: one-time-code sign-in, tenant branding, prioritised next-action guidance, API-backed application/loan/complaint/document views, KFS acceptance, eSign, grievances, and DPDP rights. |
| `apps/customer/assets/images/customer-welcome.jpg` | Customer-facing editorial welcome media used by the secure sign-in experience. |
| `apps/dashboard/index.html` | Tenant staff workspace dashboard. |
| `apps/api/src/identity.js` | Local IAM helpers for tenant/platform users, PBKDF2 password hashes, HTTP session records, tenant access reviews, and role checks. `resolveSession` splits into `resolveSessionRecord` (control-plane only — session lookup and tenant validation) and `resolveSessionUser` (given one tenant's already-fetched data, validates the login record), so a caller that doesn't have every tenant's data loaded can still resolve a session. |
| `apps/api/src/file-store.js` | Local JSON state load/save helpers; control-plane tenant registry (api-key hashing, tenant resolution), sub-processor register, and break-glass grants; per-tenant data partitions and tenant-scoped accessors; `buildTenantExport`/`offboardTenant` for portability and evidenced deletion; targeted `loadControlPlaneOnly`/`loadTenantDataOnly`/`saveTenantDataOnly`/`saveControlPlaneOnly` accessors (thin wrappers here — the file driver can't do partial I/O — but a real optimization on the Postgres driver). `ensureBootstrapTenants` accepts injectable `loadStateFn`/`saveStateFn` so the Postgres driver can reuse its seeding logic. |
| `apps/api/src/postgres-store.js` | Postgres-backed storage driver (opt-in via `LOANOS_STORAGE_DRIVER=postgres`): `loadState`/`saveState`/`withStateLock` (now lock-key-scoped) mirror file-store.js's whole-state interface for control-plane operations; `loadControlPlaneOnly`/`loadTenantDataOnly`/`saveTenantDataOnly`/`saveControlPlaneOnly` are genuine per-tenant, RLS-scoped accessors used by `route()`'s hot path, switching to the `loanos_app` role via `SET ROLE` for exactly the tenant-scoped statement. Verified against a live PostgreSQL 18 instance; see the [Postgres migration doc](postgres-migration.md). |
| `apps/api/src/storage.js` | Storage-driver façade: re-exports every pure, in-memory function from `file-store.js` unchanged, and selects the file- or Postgres-backed I/O functions (`loadState`/`saveState`/`withStateLock`/`ensureBootstrapTenants`/`peekControlPlaneState`/the four per-tenant accessors) based on `LOANOS_STORAGE_DRIVER`. `server.js` imports from here, not `file-store.js` directly. |
| `db/schema.sql` | Postgres schema for the optional storage driver: `tenant_data` (one JSONB row per tenant, Row-Level Security), the control-plane tables (tenant registry, sessions, platform users, append-only audit events, sub-processors, break-glass grants), and the two-role model (`loanos_control_plane`, `BYPASSRLS`, what the app authenticates as; `loanos_app`, `NOBYPASSRLS`, reached only via `SET ROLE`, RLS-enforced for the per-tenant hot path). |
| `apps/api/src/server.js` | HTTP API with tenant isolation, borrower one-time-code sessions and resource ownership authorization, security headers, server-grounded KFS issuance and separate borrower acceptance, centralized audit stamping, bounded request bodies, admin/platform routes, and LOS/LMS/LWS/compliance endpoints. Production startup requires Postgres, evidenced database encryption, active per-tenant rules routing, and a real email provider. |
| `tests/compliance.test.js` | Regression tests for compliance, API, tenancy, audit, LOS/LMS/LWS, and integration-ledger gates. |
| `tests/external-services.test.js` | Provider-boundary tests for `ExternalServiceManager` mock/real dispatch and residency guards. |
| `tests/postgres-store.test.js` | Integration tests for the Postgres storage driver — RLS enforcement (direct and via the two-role model), advisory-lock serialization (same key) and non-serialization (different keys), and a full multi-tenant HTTP round-trip. Self-skips unless `DATABASE_URL_TEST` is set; not part of the default `npm test` gate but part of the `tests/*.test.js` glob it runs. |

## Implemented API Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Service health. Open route, no tenant context. |
| `GET /compliance/controls` | Returns regulatory control catalog. Open route. |
| `GET /reference/decline-reasons` | Returns the coded decline-reason taxonomy. Open route. |
| `POST /auth/login` | Authenticates a tenant user or platform user, returning public principal data and setting an HTTP-only session cookie. |
| `GET /auth/me` | Reads the current session principal. |
| `POST /auth/logout` | Revokes the current session and clears the session cookie. |
| `GET /platform/admin-summary` | Returns platform-level counts for tenants, sandboxes, sub-processors, break-glass grants, and platform users. |
| `GET /platform/users` | Lists platform users (no password hashes); requires platform admin/security/auditor role or platform admin key. |
| `POST /platform/users` | Creates or updates a platform user with PBKDF2-hashed password and platform roles. |
| `GET /platform/onboarding-options` | Lists supported tenant-onboarding modules, flows, launch modes, and isolation tiers. |
| `POST /platform/tenants` | Onboards a tenant, optionally creating the first owner user, regulated entity profile, initial product policies, enabled module/flow blueprint, readiness checklist, and one-time api key; requires platform tenant-provisioning authority. |
| `GET /platform/tenants` | Lists tenants (no secrets); requires platform authority. |
| `GET /platform/tenants/:id` | Reads one tenant record; requires platform authority. |
| `GET /platform/tenants/:id/onboarding` | Reads the tenant onboarding blueprint, readiness, seeded regulated entities, and seeded product policies. |
| `GET /platform/tenants/:id/export` | Produces a reproducible tenant portability export (control record, data plane, audit evidence pack); requires platform authority. |
| `POST /platform/tenants/:id/offboarding` | Purges the tenant's data plane, revokes its api key, and retains a deletion attestation; requires platform authority. |
| `POST /platform/tenants/:id/break-glass` | Mints a time-boxed, tenant-scoped break-glass credential (returned once, hashed at rest); requires platform authority. |
| `GET /platform/tenants/:id/break-glass` | Lists break-glass grants minted for a tenant; requires platform authority. |
| `POST /platform/break-glass/:grantId/revoke` | Revokes a break-glass grant immediately; requires platform authority. |
| `POST /platform/sub-processors` | Registers a sub-processor with DPA and data-residency evidence; requires platform authority. |
| `GET /platform/sub-processors` | Lists the sub-processor register; requires platform authority. |
| `GET /admin/me` | Reads the current tenant admin/service auth context. |
| `GET /admin/governance-summary` | Summarizes tenant users, access-review status, service-key rotation metadata, and onboarding readiness. |
| `GET /admin/users` | Lists tenant users (no password hashes). |
| `POST /admin/users` | Creates or updates tenant users, optionally creating a linked staff actor. |
| `GET /admin/users/:id` | Reads one tenant user. |
| `POST /admin/users/:id/status` | Activates/suspends/inactivates a tenant user. |
| `POST /admin/users/:id/password` | Resets a tenant user's password. |
| `GET /admin/access-reviews` | Lists access reviews. |
| `POST /admin/access-reviews` | Captures a point-in-time user access review snapshot. |
| `POST /admin/access-reviews/:id/complete` | Completes an access review and can suspend users or remove admin roles. |
| `POST /admin/api-key/rotation` | Rotates the tenant service api key, returns the one-time replacement, and seals an audit event. |
| `GET /audit/events` | Lists the tenant's sealed audit chain (filterable by `type`/`subjectId`/`from`/`to`) with a chain-validity verdict. |
| `GET /audit/export` | Produces an integrity-attested evidence pack from the tenant's audit chain; 409 if the chain fails verification. |
| `GET /sub-processors` | Standing disclosure of the sub-processor register to every authenticated tenant, flagging cross-border processing. |
| `GET /break-glass-grants` | Lists every break-glass grant scoped to the calling tenant, with effective status. |
| `GET /document-vault` | Lists signed document-vault receipts, filterable by `applicationId`, `borrowerId`, or `packetId`. |
| `GET /document-vault/:id` | Reads a document-vault receipt by id. |
| `GET /document-vault/:id/documents/:docId` | Downloads a specific document from the vault by ID, supporting content negotiation (JSON, HTML, or binary PDF). |
| `GET /communications` | Lists tenant communication dispatch receipts, filterable by channel, purpose, borrower, application, or loan account. |
| `POST /integrations/communications` | Dispatches SMS/email/WhatsApp through `ExternalServiceManager`, stores a masked/hash-only communication receipt, and seals the attempt into the tenant audit chain. |
| `GET /payment-rails` | Lists NACH/UPI payment rail initiation receipts, filterable by type, channel, status, borrower, application, loan account, or provider reference. |
| `POST /integrations/payment-rails/nach-mandates` | Registers a NACH mandate through `ExternalServiceManager`, stores sanitized mandate evidence (account last-four/hash, provider ref, amount/frequency, consent/bank-verification refs), and seals the initiation into the tenant audit chain. |
| `POST /integrations/payment-rails/nach-presentments` | Creates a single NACH debit presentment against a registered mandate; initiation itself cannot credit a loan account. |
| `POST /integrations/payment-rails/upi-collects` | Creates a UPI collect request through `ExternalServiceManager`, stores masked/hash-only VPA evidence with provider/status data, and seals the initiation into the tenant audit chain. |
| `POST /integrations/payment-rails/settlements` | Reconciles one idempotent UPI provider callback. Only an exact match to an initiated collect and active loan account posts a repayment; failed, returned, mismatched, and unknown callbacks remain exception records. |
| `GET/POST /integrations/payment-rails/settlement-files` | Lists or ingests an idempotent checksum-sealed provider file, independently acknowledging every matched, duplicate, exception, or rejected row while using the canonical settlement reconciler. |
| `POST /integrations/payment-rails/nach-due-presentments` | Creates a tenant due-collection batch from ledger-derived overdue amounts, active registered mandates, mandate caps, and same-due duplicate prevention. |
| `GET /payment-reconciliations` | Lists provider settlement reconciliation records, including matched postings and unresolved exceptions. |
| `POST /payment-reconciliations/:id/resolution` | Resolves an unresolved provider-settlement exception with named resolver, approval evidence, and reason. |
| `POST /bank-statements/entries` | Matches an idempotent bank-statement credit to an already-posted provider settlement; unmatched or mismatched credits remain finance exceptions and cannot create a borrower payment. |
| `GET /bank-reconciliations` | Lists matched and exception bank-statement reconciliation records. |
| `POST /bank-reconciliations/:id/resolution` | Resolves an unresolved bank-statement exception with named resolver, approval evidence, and reason. |
| `GET/POST /payment-suspense/receipts` | Lists or records unidentified, advance, excess, provider-mismatch, and bank-unmatched receipts in the suspense liability. |
| `POST /payment-suspense/receipts/:id/resolution` | Partially or fully allocates suspense to an active loan through the canonical payment ledger under independent maker-checker approval. |
| `POST /payment-suspense/receipts/:id/write-off` | Writes off only the remaining open suspense under independent approval and creates a balanced finance journal. |
| `GET /finance/reconciliation-breaks` | Unifies open provider, bank, and suspense breaks with ageing, ownership, due-date status, and resolution/write-off links. |
| `POST /finance/reconciliation-breaks/:id/assignment` | Assigns an open break to a named operator with an accountable owner and due date. |
| `POST /finance/reconciliation-breaks/:id/write-off` | Writes off provider or bank exceptions only under maker-checker control; suspense uses its dedicated write-off route. |
| `GET /accounting/journals` | Projects immutable loan-ledger events into balanced, read-only double-entry journals using the accounting profile frozen on each loan at disbursement; optionally filters by `loanAccountId`. |
| `GET /accounting/trial-balance` | Returns a tenant-scoped derived trial balance from journal projections, optionally for one loan account. |
| `GET /accounting/posting-runs` | Lists immutable, approval-evidenced tenant GL posting-run snapshots. |
| `GET /accounting/gl-export` | Exports posted journals in a versioned GL-line schema with a SHA-256 checksum and entity/book/co-lending dimensions; may filter by `postingRunId`. |
| `GET/POST /accounting/gl-deliveries` | Lists or creates an immutable API/SFTP/file delivery attempt for one posting run, retaining target, exact totals, line count, and export checksum. |
| `POST /accounting/gl-deliveries/:id/acknowledgement` | Records one immutable downstream acknowledgement; acceptance requires the exact exported checksum and line count, otherwise a finance exception is opened. |
| `GET/POST /accounting/gl-reconciliations` | Lists or independently certifies downstream GL versus posted subledger checksum, debit/credit totals, and line count; variances fail closed into the exception queue. |
| `GET /accounting/finance-exceptions` | Lists downstream delivery/reconciliation exceptions, optionally filtered by open/resolved status. |
| `POST /accounting/finance-exceptions/:id/assignment` | Assigns an open finance exception to a named owner with a due date. |
| `POST /accounting/finance-exceptions/:id/resolution` | Records maker-checker remediation evidence without bypassing the underlying GL acceptance/reconciliation close gates. |
| `GET/POST /accounting/close-schedules` | Lists or approves India-timezone daily/month-end close schedules with EOD/BOD times, effective date, and holiday-calendar reference. |
| `GET /accounting/operational-runs` | Lists EOD and BOD runs with posting, delivery, reconciliation, certification, and closure checkpoints. |
| `POST /accounting/eod-runs` | Posts the remaining balanced journal inventory and packages every outstanding posting run for GL delivery, pausing at downstream acknowledgement. |
| `POST /accounting/eod-runs/:id/complete` | Completes EOD only after every close blocker is clear, using independent certification and close approvals. |
| `POST /accounting/bod-runs` | Opens a business date only after the previous date has a completed EOD and closed business date. |
| `GET/POST /accounting/period-closures` | Lists or closes non-overlapping finance periods under a month-end schedule after the period-end date and downstream GL are closed and reconciled. |
| `GET/POST /accounting/ecl-parameter-sets` | Lists or approves versioned PD/LGD parameter sets under maker-checker control. |
| `GET /accounting/ecl-provisions` | Lists approved ECL provision snapshots and allowance movements. |
| `GET/POST /accounting/eir-amortizations` | Lists or records maker-checker EIR period amortisation and balanced journals. |
| `GET/POST /accounting/funding-facilities` | Lists or approves funding facilities with limits, outstanding, maturity, and cost. |
| `POST /accounting/funding-allocations` | Attributes available facility funding to a loan account. |
| `GET /accounting/alm-report` | Produces contractual inflow/outflow maturity buckets and cumulative liquidity gaps. |
| `GET /accounting/profitability-report` | Produces loan/product contribution, funding cost, ECL, economic capital, and RAROC. |
| `GET/POST /accounting/core-banking-deliveries` | Lists or submits maker-checker GL batches through the mock-or-real CBS adapter; provider acceptance must exactly match checksum and line count. |
| `GET /accounting/tax/gst-return-data` | Nets issued GST invoices and credit notes for a requested date range. |
| `GET/POST /accounting/tax/gst-invoices` | Lists or issues uniquely numbered invoices grounded in taxable charge events. |
| `POST /accounting/tax/gst-credit-notes` | Issues a maker-checker full credit note and balanced reversal journal against one invoice. |
| `GET/POST /accounting/tax/withholdings` | Lists or records maker-checker TDS withholdings and balanced finance journals. |
| `POST /accounting/tax/withholdings/:id/certificate` | Issues one uniquely numbered TDS certificate for a withholding. |
| `GET /accounting/tax/tds-return-data` | Produces a dated TDS return extract with certificate linkage. |
| `GET/POST /accounting/tax/filings` | Lists or creates checksum-sealed, maker-checker GST/TDS filing snapshots. |
| `POST /accounting/tax/filings/:id/acknowledgement` | Records accepted/rejected filing acknowledgement evidence. |
| `GET/POST /accounting/irac-income-adjustments` | Lists or records NPA income reversals limited to accrued, uncollected interest. |
| `GET/POST /accounting/irac-memorandum-interest` | Lists or records off-book NPA memorandum interest with policy evidence. |
| `POST /accounting/irac-recovery-recognitions` | Links cash-basis recovery recognition to an earlier reversal and an actual interest-bearing payment. |
| `POST /accounting/posting-runs` | Posts all unposted balanced journals through a date into an immutable tenant batch; run ID retries are idempotent. |
| `GET /accounting/reconciliation-certifications` | Lists dated finance reconciliation certifications for the tenant. |
| `POST /accounting/reconciliation-certifications` | Certifies a business date only after journals are posted, downstream GL is accepted and exactly reconciled, and provider/bank/suspense/tax/finance exceptions are clear. |
| `POST /accounting/business-dates/:date/close` | Closes a reconciliation-certified business date, blocking later posting through that date. |
| `POST /accounting/business-dates/:date/reopen` | Reopens a closed date only with independent actor, approval evidence, and reason, invalidating the prior certification; dates inside a closed finance period cannot reopen. |
| `POST /loan-accounts/:id/refunds` | Issues an approved, idempotent refund only against the unapplied portion of an existing payment; principal and interest corrections remain ledger reversals. |
| `POST /loan-accounts/:id/disbursement-return` | Cancels a failed outward disbursement before any repayment or servicing activity, reversing the original principal debit with approval evidence. |
| `GET /loan-accounts/:id/cooling-off-quote` | Quotes principal plus proportionate interest within the KFS cooling-off period; execution/payout remains the next workflow step. |
| `POST /loan-accounts/:id/cooling-off-cancellation` | Cancels an account within the quoted KFS cooling-off window after exact borrower repayment, preserving the principal and proportionate-interest evidence. |
| `POST /loan-accounts/:id/payment-corrections` | Posts an idempotent, value-dated payment through the canonical payment authority with receipt date, backdated flag, reason, and independent approval; future and closed-period value dates fail closed. |
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
| `POST /data-retention/cleanup` | Runs automated DPDP data retention cleanup for expired borrowers. |
| `GET /borrowers/:id/access-requests` | Lists a borrower's DPDP data-principal access requests with SLA status. |
| `POST /borrowers/:id/access-requests` | Creates a DPDP access request for a borrower. |
| `POST /borrowers/:id/access-requests/:reqId/fulfillment` | Fulfils an access request, assembling and returning the portable data pack. |
| `GET /borrowers/:id/correction-requests` | Lists a borrower's DPDP correction requests with SLA status. |
| `POST /borrowers/:id/correction-requests` | Creates a DPDP correction request capturing current and proposed field values. |
| `POST /borrowers/:id/correction-requests/:reqId/review` | Applies or rejects a correction request; applied corrections propagate into the borrower profile. |
| `GET /loan-accounts/:id/security-interests` | Lists CERSAI security interests for a loan account. |
| `POST /loan-accounts/:id/security-interests` | Creates a draft CERSAI security interest. |
| `POST /loan-accounts/:id/security-interests/:siId/filing` | Builds and submits a checksum-sealed canonical CERSAI security-interest packet. |
| `POST /loan-accounts/:id/security-interests/:siId/registration` | Reconciles a CERSAI registered/rejected response with exact packet checksum, fee receipt, and certificate/error evidence. |
| `POST /loan-accounts/:id/security-interests/:siId/repairs` | Creates an independently approved replacement for a rejected CERSAI submission. |
| `POST /loan-accounts/:id/security-interests/:siId/modification` | Files a maker-checker modification to a registered charge. |
| `POST /loan-accounts/:id/security-interests/:siId/satisfaction` | Files satisfaction/release of a charge on loan closure. |
| `GET /cersai/search` | Searches existing CERSAI charges on an asset (prior-encumbrance check). |
| `GET /integrations/readiness` | Returns credential-safe, tenant/sandbox-aware readiness for every external-provider boundary; real mode is blocked until endpoint, credential, and India-residency configuration are present. |
| `POST /integrations/:provider/callbacks` | Accepts a tenant-authenticated, HMAC-verified provider callback once, stores only its event identity and keyed payload hash, and seals an audit event. |
| `GET /fiu/reports` | Lists FIU-IND STR/CTR reports (filterable by type, subject, status). |
| `POST /fiu/reports` | Creates an STR or CTR (CTR enforces the ₹10 lakh threshold). |
| `GET /fiu/reports/:id` | Reads one FIU-IND report. |
| `POST /fiu/reports/:id/review` | Records the designated Principal Officer's review of an STR. |
| `POST /fiu/reports/:id/filing` | Builds and submits a checksum-sealed canonical FINnet XML packet through the FIU-IND provider boundary. |
| `POST /fiu/reports/:id/acknowledgement` | Records an accepted/rejected FIU response only when its checksum exactly matches the filed packet. |
| `POST /fiu/reports/:id/repairs` | Creates a source-correction-evidenced, independently approved replacement for a rejected FIU report. |
| `GET /data-disclosures` | Lists third-party data-disclosure records (filterable by `borrowerId`). |
| `POST /data-disclosures` | Records a third-party data disclosure, gated on active consent or a cited legal reference. |
| `GET /regulated-entities` | Lists regulated entities. |
| `POST /regulated-entities` | Creates or updates a regulated entity after compliance validation. |
| `GET /regulated-entities/:id` | Reads one regulated entity. |
| `GET/POST /co-lending-arrangements` | Lists or validates co-lending agreements with regulated-entity roles, funding/interest/fee shares, transfer pricing, servicing fees, retention floor, blended rate, and escrow evidence. |
| `POST /co-lending-arrangements/:id/allocations` | Freezes one paise-exact partner allocation onto an existing loan before any GL posting, preventing later accounting-shape drift. |
| `GET /co-lending-arrangements/:id/partner-subledger` | Returns balanced entity-dimension loan journals with inter-company due-to/due-from balancing; filterable by entity and loan. |
| `GET /co-lending-arrangements/:id/transfer-pricing` | Reports partner average outstanding, funding cost, collection economics, servicing fee, payable, and contribution margin for a period. |
| `GET /co-lending-arrangements/:id/provision-report` | Reconciles approved loan ECL snapshots into paise-exact regulated-entity allowance and movement rows. |
| `GET/POST /co-lending-arrangements/:id/settlement-statements` | Lists or creates non-overlapping checksum-sealed partner settlement statements under maker-checker approval. |
| `GET/POST /co-lending-settlement-statements/:id/tax-exchanges` | Lists or creates a maker-checker servicing GST/TDS invoice exchange sealed to the approved partner economics. |
| `POST /co-lending-tax-exchanges/:id/acknowledgement` | Accepts only an exact partner checksum/GST/TDS acknowledgement; mismatches open a finance exception. |
| `POST /co-lending-settlement-statements/:id/escrow-instructions` | Sends a maker-checker, checksum-bound net-payable instruction through the India-resident mock-or-real escrow adapter. |
| `POST /co-lending-settlement-statements/:id/payments` | Reconciles an approved partner payable to an exact bank confirmation only after accepted tax and escrow evidence; mismatches enter the finance-exception queue. |
| `GET/POST /co-lending-arrangements/:id/intercompany-reconciliation` | Reports or certifies equality of due-to/due-from balances for finance close under independent approval. |
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
| `POST /borrowers/:id/ckyc/search` | Searches the CKYC registry by identifier and returns only masked name/identifier plus year-of-birth match data. |
| `POST /borrowers/:id/ckyc/download` | Downloads and syncs a verified record only with explicit active CKYC consent, an allowed authentication factor, provider reference, and actor evidence. |
| `POST /borrowers/:id/ckyc/upload` | Legacy direct upload is fail-closed because CKYC identifiers cannot be generated locally; callers use the governed CKYCRR submission lifecycle. |
| `GET/POST /reporting/ckycrr/submissions` | Lists tenant-local submissions or creates a checksum-sealed individual/legal-entity canonical CKYCRR packet under maker-checker approval. |
| `GET /reporting/ckycrr/submissions/:id` | Reads packet, document manifest, checksum, response, notification, and reconciliation lineage. |
| `POST /reporting/ckycrr/submissions/:id/submit` | Records digital-signature and SFTP/portal transport evidence; portal bulk files at or above 20 MB are rejected. |
| `POST /reporting/ckycrr/submissions/:id/response` | Records accepted, rejected, or probable-match provider response; only an accepted response can assign the returned identifier to KYC. |
| `POST /reporting/ckycrr/submissions/:id/probable-match-resolution` | Records an independent exact/no-match decision within seven calendar days, including customer notification for a selected identifier. |
| `POST /borrowers/:id/vcip/evidence` | Records V-CIP evidence (video recording hash, India GPS coordinates, liveness confirmation, face match score >=0.8, official digital signature) and updates borrower KYC record. |
| `GET /borrowers/:id/vcip/evidence` | Retrieves V-CIP evidence details for the borrower's V-CIP KYC record. |
| `GET /borrowers/:id/beneficial-owners` | Lists a legal-entity borrower's declared beneficial owners. |
| `POST /borrowers/:id/beneficial-owners` | Declares or updates a beneficial owner (ownership/control/senior-managing-official) with identification and verification evidence. |
| `GET /staff/actors` | Lists tenant login users that carry a workflow role — a read-only projection of `state.users`, not a separate registry. |
| `GET /staff/actors/:id` | Reads one such user's workflow-facing identity. |
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
| `GET /loan-accounts/:id/schedule` | Reads facility type, frequency, structure, and contractual schedule; revolving/OD facilities correctly return no fixed EMI schedule. |
| `POST /loan-accounts/:id/drawdowns` | Posts an idempotent maker-checker revolving draw within sanctioned limit, drawing power, and expiry. |
| `POST /loan-accounts/:id/revolving-interest-accruals` | Accrues immutable actual/365 interest from exact daily utilised balances, blocking duplicate periods and closed dates. |
| `POST /loan-accounts/:id/facility-reviews` | Reviews limit, drawing power, and expiry under maker-checker control without permitting drawing power below utilisation. |
| `GET /loan-accounts/:id/statement` | Generates borrower statement for a `from`/`to` period. |
| `GET /loan-accounts/:id/statement/document` | Renders the period statement as a checksum-sealed borrower-facing document. |
| `GET /loan-accounts/:id/delinquency` | Computes DPD, bucket, overdue amounts, and earliest unpaid due. |
| `GET /loan-accounts/:id/asset-classification` | Computes standard, SMA, or NPA asset class from DPD. |
| `GET /loan-accounts/:id/ecl-assessment` | Calculates a Stage 1/2/3 ECL estimate using a named approved parameter set. |
| `POST /loan-accounts/:id/ecl-provisions` | Records maker-checker ECL allowance and movement journals without changing borrower dues. |
| `GET /loan-accounts/:id/cic-snapshot` | Generates a CIC-ready internal reporting snapshot for one account. |
| `GET /reporting/cic/snapshots` | Generates CIC-ready internal reporting snapshots for the portfolio. |
| `GET/POST /reporting/cic/submissions` | Lists filtered reporting batches or creates a fail-closed, maker-checker, checksum-sealed canonical UCRF batch for one CIC and reporting cycle. |
| `GET /reporting/cic/submissions/:id` | Reads the immutable record set, canonical JSONL file, checksum, reporting deadline, alerts, and lifecycle evidence for a batch. |
| `POST /reporting/cic/submissions/:id/submit` | Records transport evidence and provider reference; any DPD/default record must first carry SMS/email delivery evidence. |
| `POST /reporting/cic/submissions/:id/acknowledgement` | Reconciles exactly one accepted/rejected outcome per submitted record and opens the seven-day reject-repair clock. |
| `POST /reporting/cic/submissions/:id/resubmissions` | Creates an independently approved, source-evidenced batch containing every rejected record exactly once. |
| `GET/POST /borrowers/:id/cic-corrections` | Lists SLA-enriched correction requests or opens a source-report-linked disputed-field request. |
| `POST /borrowers/:id/cic-corrections/:correctionId/resolution` | Independently approves acceptance/rejection; acceptance requires source correction evidence and a valid next reporting cycle. |
| `POST /loan-accounts/:id/recovery-assignments` | Assigns a recovery agent only with borrower notice evidence. |
| `GET/POST /loan-accounts/:id/collection-contacts` | Lists or records assigned-agent call/IVR/field dispositions; field visits require geo/time/evidence and all contacts enforce conduct hours. |
| `GET/POST /loan-accounts/:id/promises-to-pay` | Lists evaluated pending/kept/broken PTPs or records a paise-exact promise linked to an evidenced contact. |
| `GET/POST /loan-accounts/:id/legal-recovery-cases` | Lists legal cases or opens an independently approved recovery strategy; SARFAESI requires NPA plus registered CERSAI security. |
| `GET /legal-recovery-cases/:id` | Reads an enriched legal case with statutory-clock and hearing status. |
| `POST /legal-recovery-cases/:id/notices` | Generates and records an independently approved, checksum-sealed statutory notice with delivery evidence and track-specific deadline. |
| `POST /legal-recovery-cases/:id/events` | Records idempotent representation, filing, hearing, order, enforcement, settlement, withdrawal, or closure evidence. |
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
| Tenant authentication | Data-plane routes require either a tenant user session cookie or a valid `x-api-key`/bearer token mapping to an active tenant; missing or invalid tenant context returns 401. Only health and static reference routes are open. |
| Tenant users and sessions | `POST /auth/login` authenticates tenant users with PBKDF2-hashed passwords, issues HTTP-only session cookies, and stamps session-backed events as `tenant_user` in the audit chain. |
| Login lockout | Failed logins are throttled two ways: per-account (5 attempts / 15 min, keyed by scope+email) and per-source-IP (20 attempts / 15 min) — the IP throttle catches both credential stuffing across many accounts from one source and the fact that knowing someone's email alone is enough to trigger the per-account lock. |
| Request body hardening | Every request body is buffered with a 5MB cap and a 15s deadline before the state lock is acquired, so a slow or oversized client can't hold every tenant's requests hostage; oversized/slow bodies return 413 without tearing down the connection mid-write. |
| Tenant administration | Tenant admins manage users, linked staff actors, access reviews, and service-key rotation through `/admin/*`; tenant service keys remain valid for integrations and bootstrap administration. |
| Tenant provisioning and onboarding | The platform control plane onboards tenants behind an admin key or platform admin session, optionally creates the first tenant owner, seeds the regulated entity and first product policies through the same compliance validators as data-plane APIs, captures enabled modules/flows, computes readiness, and returns a one-time api key stored only as a SHA-256 hash. |
| Platform administration | Platform users can log in with sessions, list/provision tenants, administer platform users, manage sub-processors, and mint/revoke break-glass grants according to platform roles. |
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
| LWS task queues | Derives active tasks for blocked compliance, KFS acceptance, credit decision, manual underwriting review for eligibility-referred applications, AI human review, checker approval, document delivery, disbursement, recovery assignment, broken PTP follow-up, NPA review, legal notice/statutory/hearing action, complaint handling, and RBI CMS escalation. Each task includes SLA target, due time, and breach status. |
| LWS task audit | Persists assignment, start, release, and comment events while the domain state remains the source of truth for task resolution. |
| Fraud case module | Runs a tenant-scoped fraud case (`reported → under_investigation → show_cause_issued → classified_fraud/classified_not_fraud`). |
| Natural justice and four-eyes fraud classification | An adverse (fraud) classification is blocked until a show-cause notice was issued (with delivery proof) and the borrower responded or the RBI FRM-2024 21-day window elapsed, and the classifier must be independent of the investigator. |
| Fraud committee pack | A checksum-sealed, read-only pack assembling case facts, the natural-justice trail, the event timeline, and an explicit `classificationPermitted`/`blockers` verdict. |
| Loan account opening | Disbursement opens an LMS loan account and creates a disbursement ledger event. |
| Repayment schedule | KFS and LMS share one deterministic engine: frequency drives period rate/count/dates, and amortising, bullet, serviced/deferred moratorium, and step-up structures reconcile principal exactly to paise. |
| Revolving/OD facilities | Product/KFS distinguish non-amortising facilities; account summary exposes limit, drawing power, utilisation, availability, minimum due, and expiry. Drawdowns require independent approval and cannot breach availability; actual/365 interest derives from exact daily utilisation; repayment restores availability without closing a zero-balance facility; reviews cannot strand excess utilisation. |
| Loan ledger | Reconstructs principal, interest, paid amounts, outstanding balance, and next due from ledger and schedule. |
| Interest accrual | Term accounts recognize scheduled interest once per installment. Revolving accounts recognize checksum-free deterministic actual/365 interest once per period from retained daily-balance evidence. Both are immutable, idempotent, payable through the common waterfall, and journalled to interest receivable/income. |
| Foreclosure | Quotes a payoff of outstanding principal plus interest and charges already due (no future interest); any foreclosure charge must be KFS-disclosed, and enforces lock-in period and floating-rate individual retail fee prohibitions. Execution requires the amount to cover the payoff, settles it through the ledger, and closes the account. |
| Closure NOC | A settled (closed, zero-dues) account can issue a checksum-sealed No-Objection Certificate declaring no dues remain and no objection to releasing securities; re-issue returns the same certificate. |
| Payment posting | Posts payment events, allocates to due interest first and principal next, and updates account status. A duplicate `paymentRef` on the same loan account (payment, prepayment, foreclosure, settlement, or cash recovery — all funnel through `postPaymentToLoanAccount`) is rejected as a blocking finding rather than double-crediting the ledger, so a client retry after a network timeout is safe. |
| Ledger summation exactness | `summarizeLoanAccount` and `generateLoanStatement` sum ledger/schedule amounts using exact integer-paise arithmetic (`sumMoney`) rather than float-sum-then-round, eliminating dependence on `roundMoney`'s epsilon-rounding heuristic continuing to absorb accumulated floating-point drift as ledgers grow. |
| Part-prepayment | Enforces lock-in period and floating-rate individual retail fee prohibitions, clears dues then reduces principal, requiring a real principal reduction, and rebuilds the future schedule either to lower each EMI over the same term (`reduce_emi`) or keep the EMI and shorten the tenure (`reduce_tenure`). |
| Borrower statements | Generates period statement from schedule and ledger transactions; revolving statements additionally expose facility utilisation, availability, minimum due, draws, and daily-utilisation interest. |
| Rendered statement document | Renders the period statement into a checksum-sealed HTML/text borrower document (opening/closing balances, dues, transactions, totals) in the same shape as the execution packet. |
| Charge controls | Grounds KFS charges in Product Policy, validates KFS limits, and blocks ad-hoc ledger charge assessment, foreclosure charges, and prepayment charges exceeding KFS caps and policy ceilings. |
| Waivers and reversals | Requires approval evidence for waivers and reversals, and prevents duplicate reversal of the same event. |
| Delinquency buckets | Computes DPD bucket, earliest unpaid installment, and overdue amounts from schedule plus ledger. |
| Collections reminder workflow | Logs each borrower reminder/notice (channel, stage, delinquency snapshot); voice-channel (call/IVR) contact outside the RBI FPC 08:00-19:00 IST window is blocked. |
| Field collection and PTP | Requires active noticed assignment, assigned-agent identity, evidence and 08:00-19:00 IST contact time; field visits additionally require valid geo evidence. PTPs link to contacts and allocate subsequent payments once across promises to derive pending, kept, or broken status and follow-up tasks. |
| Statutory legal recovery | Strategy selection is maker-checker. SARFAESI requires NPA plus registered CERSAI security, creates a checksum-sealed Section 13(2) demand record and blocks enforcement before its 60-day clock. Section 138 retains cheque/return memo evidence, enforces notice within 30 days and computes 15 days after delivery. Filing/hearing/order/settlement/withdrawal evidence and LWS clocks are retained. |
| Hardship restructure | Modifies a stressed active loan under four-eyes approval, extending tenure and/or conceding rate, and re-amortizes the remaining principal (past installments untouched); flags the account `restructured`. |
| Floating-rate reset | Resets the interest rate on a floating loan under four-eyes approval, offering choice-based re-amortization (extend tenor, increase EMI, switch to fixed with fee). |
| Settlement and write-off | `settleLoanAccount` closes a loan for less than outstanding under four-eyes approval via principal/interest waiver credits (`closureType: "settled"`); `writeOffLoanAccount` marks `written_off` as a book loss while retaining ledger dues; both surface in the CIC snapshot. |
| Asset classification | Maps DPD to standard, SMA-0, SMA-1, SMA-2, and NPA classes. |
| CIC reporting | Produces account snapshots plus consumer/commercial canonical UCRF batches from ledger and structured borrower-reporting state; enforces fortnight dates, seven-day submission/reject clocks, four-eyes approval, content checksum, complete acknowledgements, default alerts, source repair, resubmission lineage, and correction compensation clocks. |
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

- Persistence defaults to local JSON (tenant-partitioned); an optional Postgres/RLS driver exists (`LOANOS_STORAGE_DRIVER=postgres`, see the [Postgres migration doc](postgres-migration.md)) but sandbox management and the platform control plane (`routePlatform`/`routeAuth`) still use whole-state load/save even on that driver — genuinely cross-tenant by design and admin-frequency, not migrated to per-tenant fetching.
- Per-tenant encryption at rest is implemented for the file store (opt-in via `LOANOS_MASTER_KEY`): each tenant's data-plane partition is sealed with a per-tenant AES-256-GCM key derived from the root key via HKDF-SHA256 (`apps/api/src/encryption.js`), so no two tenants share a key and purging a tenant's ciphertext makes its data unrecoverable. With no master key set, the store writes plaintext as before. The control plane stays plaintext (cross-tenant by construction), and wiring the same envelope into the Postgres driver's per-tenant rows is a follow-on.
- Tenant human login/session auth is implemented locally, but external IAM/SSO, enforced MFA, SCIM, and production-grade password policy are still integration work.
- Tenant service api keys are hashed at rest and rotatable, but there is still one active service key per tenant/environment rather than multiple named integration keys with independent scopes.
- The platform admin key remains as a bootstrap/emergency secret; individual platform users and roles are implemented for normal platform administration.
- No certified live KYC, CKYC, bureau, bank-account, payment settlement/reconciliation, eSign, SMS, email, WhatsApp, CERSAI, escrow, or core-banking provider onboarding yet; mock-or-real fail-closed adapter contracts exist for the latter two.
- Registries are file-backed; tenant user administration and access reviews exist, but external IAM sync and maker-checker approval for admin changes are still planned.
- Borrower/consent/KYC records are file-backed, but support CKYC registry and V-CIP evidence vault validation boundaries.
- Workflow is file-backed; the local dashboard is not a production workflow UI and outbound RBI CMS API integration is still planned.
- LMS restructure/settlement/write-off, cooling-off cancellation, refunds, field collections/PTP, and statutory legal case control have first slices. UPI/NACH and bank matching provide provider-to-bank-to-ledger controls. Balanced journals, trial balance, governed posting/GL delivery/reconciliation, EOD/BOD and period close cover the finance path. Co-lent loans split into regulated-entity books with transfer pricing, entity ECL, GST/TDS exchange, escrow-gated settlement, and inter-company certification. Certified vendor payloads, secure transport/credentials, external CIC submission, possession/auction economics, court integrations, and partner-scale dialer/mobile operations remain planned.
- Document packet renders HTML/text and stores document-vault receipts, but does not yet create PDFs or external eSign envelopes.
- UI is limited to the local operations/admin dashboard; there is no production borrower application yet.
- AI governance has first slices for lifecycle, validation gates (fairness/explainability/monitoring for high-risk, adversarial/hallucination for generative), drift-triggered kill switch, disclosure, and human handoff; recurring fairness reports and a sectoral incident-intelligence pack are still planned.
- The audit spine stamps a uniform actor/actorType/dataClass envelope on every event at the seal seam; signed external anchoring is a follow-on.
- Compliance docs are source-grounded but still require counsel/compliance review before production.
- The Rust decision engine remains off by default until each tenant has completed its signed-bundle, kill-switch, shadow-divergence, and operational-readiness checks. The gateway is covered for off, shadow, active, tenant-routing, and fail-closed behavior; active mode has no single-instance fallback. The remaining decision-engine release decision is tracked in [review-findings-2026-07-12](../product/review-findings-2026-07-12.md) (REV-14).
- The live JS affordability path now quantises money at the boundary and calculates EMI and FOIR with integer paise/BigInt arithmetic; the LMS ledger path is likewise paise-exact. Product inputs must use integral basis-point rates. The Rust differential corpus is regenerated and tested against this path.

## Test Coverage

Current tests prove:

- A duplicate `paymentRef` retry on an already-posted payment is blocked (422) rather than double-crediting the ledger, and the account balance/ledger are unchanged after the retry.
- `summarizeLoanAccount` sums 5,000 ledger events to an exact match against an independently-computed BigInt total, proving the integer-paise summation is exact by construction rather than dependent on `roundMoney`'s rounding heuristic continuing to work at scale.
- An oversized request body (over the 5MB cap) is rejected with 413 before reaching any handler, and the server remains responsive to subsequent requests.
- Login lockout enforces both a per-account threshold (independent of whether the password was ever guessed) and a per-source-IP threshold (independent of which account was targeted).
- (Postgres driver, `tests/postgres-store.test.js`, requires `DATABASE_URL_TEST`) The RLS policy blocks cross-tenant reads and writes at the database level, both connecting directly as the RLS-enforced role and via the application's actual `SET ROLE` switching from its bypass-capable connection role; the bypass-capable role genuinely bypasses RLS directly (required for legitimately cross-tenant control-plane operations); advisory locks serialize callers sharing a lock key and do not serialize callers using different keys; and a full HTTP round-trip proves cross-tenant isolation over the API while connected as the actual production role (not a superuser, so the test cannot pass on a broken role grant).
- Data-plane routes reject missing or invalid tenant context with 401, while health and compliance-controls stay open.
- Sealing events produces a verifiable hash chain; editing, dropping, or reordering an event breaks verification, a chain does not verify under another tenant's genesis, and re-sealing is idempotent.
- The API seals origination events into an audit chain, reports chain validity, exports an integrity-attested (and filterable) evidence pack, and keeps the audit spine tenant-scoped.
- The platform admin can mint a tenant, receives a one-time api key, and that key immediately authenticates data-plane calls; duplicate tenant ids are rejected.
- The platform onboarding flow can create a tenant owner, seed a regulated entity and product policy, persist enabled modules/flows, compute readiness, and expose onboarding readback.
- Two provisioned tenants are isolated: tenant B sees none of tenant A's records across resource types, by-id reads return 404, a re-used id writes only into B's own partition, and tenant A's data is unchanged.
- Tenant users can log in with session cookies, create/suspend users, create and complete access reviews, rotate the tenant service key, and leave `tenant_user` audit evidence.
- Platform users can log in with session cookies and provision a tenant with an initial owner user who can immediately log in to that tenant.
- Valid India-only loan application passes preflight.
- Non-India borrower/currency/storage are blocked.
- LSP/pass-through fund flow is blocked.
- Aadhaar biometric/OTP persistence is blocked.
- Invalid KFS cooling-off and penal-charge design are blocked.
- KFS acceptance and delivery evidence gate sanction readiness.
- AI model kill switch blocks model-assisted underwriting; decision proposal locks model-use evidence in a permanent, tamper-evident snapshot immune to later suspensions.
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
- Collections reminders and assigned-agent field contacts enforce the RBI FPC contact-hours window; geo evidence and PTP kept/broken outcomes are retained. A hardship restructure re-amortizes under four-eyes approval; settlement and write-off both close a loan under four-eyes approval and surface on the CIC snapshot.
- SARFAESI strategy is blocked without NPA plus registered security, early enforcement is blocked until the 60-day demand clock expires, and Section 138 notices enforce the official 30-day issue and 15-day payment windows.
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
- API blocks approval of a refer-band application unless the LWS manual underwriting task is assigned and the override underwriter matches the assigned staff actor, and successfully completes the task on proposal.
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
- API generates account/portfolio snapshots and governed CIC reporting batches, acknowledgements, reject repair/resubmission, borrower alert evidence, and correction workflows. A live provider adapter must still map the canonical UCRF interchange to each CIC's certified proprietary wire layout and transport.
- API exposes collections workflow tasks until recovery-agent notice assignment is recorded.
- API manages complaint lifecycle, 30-day grievance SLA, and RBI CMS escalation tasks.
- API generates rendered document packets and transitions LWS from document delivery to disbursement readiness.
