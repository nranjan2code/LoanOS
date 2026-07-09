# LoanOS India

LoanOS India is a greenfield loan and lending operating system for India. The platform scope covers:

- LOS: loan origination, onboarding, KYC, eligibility, pricing, offer, KFS, sanction, document execution.
- LMS: repayment schedules, servicing, statements, collections, restructuring, NPA signals, write-off/settlement workflows.
- LWS: workflow orchestration for humans, vendors, regulated entities, exceptions, approvals, and audit.
- Compliance OS: India-only regulatory controls, evidence trails, data residency, model governance, and AI kill-switch operations.

This first slice is intentionally compliance-first. It gives us a runnable domain kernel and API that reject non-India lending flows, unsafe fund flows, missing KYC/economic profile, missing KFS disclosures, weak data-residency posture, and disabled AI models.

## Regulatory Stance

The source of truth for current digital lending is the RBI `Reserve Bank of India (Digital Lending) Directions, 2025`, dated May 8, 2025. The older September 2, 2022 digital lending circular is treated as repealed for new design work.

The AI kill-switch requirement is included as a hard platform control. As of July 8, 2026, the RBI model-risk guidance found during research is a June 24, 2026 draft/public-consultation item, not a final circular. We still implement it as a mandatory design constraint because the platform must be ready for RBI-supervised model risk management.

## Current Executable Slice

```bash
npm test
npm run dev:api
```

The API uses a local JSON store under `.loanos-data/` by default. Set `LOANOS_DATA_DIR` to use another location.

The API is multi-tenant. Every route except `GET /health`, `GET /compliance/controls`, `GET /reference/decline-reasons`, and the `/platform/*` control plane requires a tenant api key sent as `x-api-key: <key>` (or `Authorization: Bearer <key>`); calls without a valid key return 401. Tenants are minted through the platform control plane behind `LOANOS_PLATFORM_ADMIN_KEY`. For local dev, set `LOANOS_DEV_TENANT_KEY` to boot a ready-to-use `dev` tenant.

Control-plane endpoints (platform admin key via `x-platform-admin-key`):

- `POST /platform/tenants` — mint a tenant, returns a one-time api key
- `GET /platform/tenants`
- `GET /platform/tenants/:id`
- `GET /platform/tenants/:id/export` — reproducible tenant portability export
- `POST /platform/tenants/:id/offboarding` — evidenced tenant deletion
- `POST /platform/tenants/:id/break-glass` — mint a time-boxed break-glass credential
- `GET /platform/tenants/:id/break-glass` — list break-glass grants for a tenant
- `POST /platform/break-glass/:grantId/revoke`
- `POST /platform/sub-processors`
- `GET /platform/sub-processors`

Useful data-plane endpoints (tenant api key required):

- `GET /health`
- `GET /compliance/controls`
- `GET /reference/decline-reasons`
- `GET /audit/events`
- `GET /audit/export`
- `GET /sub-processors`
- `GET /break-glass-grants`
- `GET /document-vault`
- `GET /document-vault/:id`
- `GET /communications`
- `POST /integrations/communications`
- `GET /payment-rails`
- `POST /integrations/payment-rails/nach-mandates`
- `POST /integrations/payment-rails/upi-collects`
- `POST /integrations/bank-account-verification`
- `GET /incidents`
- `POST /incidents`
- `GET /incidents/:id`
- `POST /incidents/:id/notifications`
- `GET /fraud-cases`
- `POST /fraud-cases`
- `GET /fraud-cases/:id`
- `POST /fraud-cases/:id/show-cause-notice`
- `POST /fraud-cases/:id/responses`
- `POST /fraud-cases/:id/classification`
- `GET /fraud-cases/:id/committee-pack`
- `GET /erasure-requests`
- `POST /erasure-requests`
- `GET /erasure-requests/:id`
- `POST /erasure-requests/:id/fulfillment`
- `POST /erasure-requests/:id/rejection`
- `GET|POST /borrowers/:id/access-requests`
- `POST /borrowers/:id/access-requests/:reqId/fulfillment`
- `GET|POST /borrowers/:id/correction-requests`
- `POST /borrowers/:id/correction-requests/:reqId/review`
- `GET|POST /loan-accounts/:id/security-interests`
- `POST /loan-accounts/:id/security-interests/:siId/(filing|registration|modification|satisfaction)`
- `GET /cersai/search`
- `GET|POST /fiu/reports`
- `GET /fiu/reports/:id`
- `POST /fiu/reports/:id/(review|filing)`
- `GET /data-disclosures`
- `POST /data-disclosures`
- `GET /regulated-entities`
- `POST /regulated-entities`
- `GET /regulated-entities/:id`
- `GET /lending-service-providers`
- `POST /lending-service-providers`
- `GET /lending-service-providers/:id`
- `GET /digital-lending-apps`
- `POST /digital-lending-apps`
- `GET /digital-lending-apps/:id`
- `GET /reporting/dla/cims`
- `GET /products`
- `POST /products`
- `GET /products/:id`
- `GET /borrowers`
- `POST /borrowers`
- `GET /borrowers/:id`
- `GET /borrowers/:id/consents`
- `POST /borrowers/:id/consents`
- `GET /borrowers/:id/kyc-records`
- `POST /borrowers/:id/kyc-records`
- `GET /borrowers/:id/beneficial-owners`
- `POST /borrowers/:id/beneficial-owners`
- `GET /staff/actors`
- `POST /staff/actors`
- `GET /staff/actors/:id`
- `GET /recovery-agents`
- `POST /recovery-agents`
- `GET /recovery-agents/:id`
- `GET /complaints`
- `POST /complaints`
- `GET /complaints/:id`
- `POST /complaints/:id/assignments`
- `POST /complaints/:id/reviews`
- `POST /complaints/:id/resolution`
- `POST /complaints/:id/rbi-cms-escalation`
- `POST /ai/models`
- `POST /ai/models/:id/transitions`
- `POST /ai/models/:id/drift-observations`
- `GET /ai/models/:id/disclosure`
- `GET /ai/handoff-requests`
- `POST /ai/handoff-requests`
- `POST /ai/handoff-requests/:id/resolution`
- `POST /ai/kill-switch`
- `POST /ai/incidents/:id/post-incident-review`
- `POST /ai/kill-switch/clear`
- `GET /workflow/tasks`
- `GET /workflow/tasks/:id`
- `POST /workflow/tasks/:id/assignments`
- `POST /workflow/tasks/:id/start`
- `POST /workflow/tasks/:id/release`
- `POST /workflow/tasks/:id/comments`
- `POST /loans/applications`
- `GET /loans/applications/:id`
- `GET /loans/applications/:id/eligibility`
- `POST /loans/applications/:id/eligibility`
- `POST /loans/applications/:id/kfs`
- `POST /loans/applications/:id/decision`
- `POST /loans/applications/:id/human-reviews`
- `POST /loans/applications/:id/approvals`
- `GET /loans/applications/:id/document-packet`
- `POST /loans/applications/:id/document-packet`
- `POST /loans/applications/:id/document-packet/delivery`
- `POST /loans/applications/:id/disbursement`
- `GET /loan-accounts`
- `GET /loan-accounts/:id`
- `GET /loan-accounts/:id/schedule`
- `GET /loan-accounts/:id/statement`
- `GET /loan-accounts/:id/statement/document`
- `GET /loan-accounts/:id/delinquency`
- `GET /loan-accounts/:id/asset-classification`
- `GET /loan-accounts/:id/cic-snapshot`
- `GET /reporting/cic/snapshots`
- `POST /loan-accounts/:id/recovery-assignments`
- `POST /loan-accounts/:id/charges`
- `POST /loan-accounts/:id/accruals`
- `GET /loan-accounts/:id/foreclosure-quote`
- `POST /loan-accounts/:id/foreclosure`
- `GET /loan-accounts/:id/closure-certificate`
- `POST /loan-accounts/:id/closure-certificate`
- `POST /loan-accounts/:id/payments`
- `POST /loan-accounts/:id/prepayments`
- `POST /loan-accounts/:id/restructure`
- `POST /loan-accounts/:id/rate-resets`
- `POST /loan-accounts/:id/reminders`
- `POST /loan-accounts/:id/settlement`
- `POST /loan-accounts/:id/write-off`
- `POST /loan-accounts/:id/cash-recoveries`
- `POST /loan-accounts/:id/waivers`
- `POST /loan-accounts/:id/reversals`

## Build Principles

- India only: INR, India-resident borrowers, India-hosted primary systems, India-specific regulatory workflows.
- Regulated-entity boundary first: a bank/NBFC/HFC/co-operative/AI-FI remains accountable for LSP/DLA/vendor actions.
- No pass-through fund control by LSPs: disbursement and repayment flows must be direct as permitted by RBI directions.
- KFS before contract: fees, APR, penal charges, cooling-off and grievance details must be disclosed before execution.
- Human command over AI: every credit-impacting model must be inventoried, validated, monitored, reviewable, and kill-switchable.
- Evidence by design: every decision, consent, model use, override, document, and exception must leave an audit trail.
- SaaS with hard tenant isolation: one tenant per regulated entity, cross-tenant access impossible by construction, and the platform itself built to satisfy RE outsourcing obligations (RBI IT-Outsourcing MD 2023, CERT-In, DPDP processor duties).

## Design Docs

- [Documentation index](/Users/nisheethranjan/Projects/AIBank/docs/README.md)
- [What we are building](/Users/nisheethranjan/Projects/AIBank/docs/product/what-we-are-building.md)
- [Build backlog](/Users/nisheethranjan/Projects/AIBank/docs/product/build-backlog.md)
- [India regulatory register](/Users/nisheethranjan/Projects/AIBank/docs/compliance/india-regulatory-register.md)
- [Compliance build checklist](/Users/nisheethranjan/Projects/AIBank/docs/compliance/compliance-build-checklist.md)
- [LoanOS architecture blueprint](/Users/nisheethranjan/Projects/AIBank/docs/architecture/loanos-india-blueprint.md)
- [SaaS tenancy and operating model](/Users/nisheethranjan/Projects/AIBank/docs/architecture/saas-tenancy-and-operating-model.md)
- [Current implementation map](/Users/nisheethranjan/Projects/AIBank/docs/architecture/current-implementation.md)
- [Product roadmap](/Users/nisheethranjan/Projects/AIBank/docs/product/roadmap.md)

## Current Status

Phase 0 has a working executable foundation, and Epics 1-8 and 11 (S1-S6) each have at least a first executable slice:

- Multi-tenant SaaS foundation: state partitioned per tenant, tenant-scoped api-key authentication with 401 on missing/invalid keys, a platform control plane that mints tenants behind an admin key, and a cross-tenant isolation regression suite.
- Tamper-evident audit spine: every save seals the tenant's events into a per-tenant SHA-256 hash chain (tenant-bound genesis), with a chain-validity endpoint, an integrity-attested evidence export pack, and uniform actor/actorType/dataClass provenance stamped on every event.
- Tenant portability export and evidenced offboarding: a reproducible full-tenant export (control record, data plane, audit evidence) and an offboarding workflow that purges the data plane, revokes the api key, and retains a deletion attestation.
- Disclosed sub-processor register: platform admin maintains sub-processors with DPA and data-residency evidence, standing-disclosed to every tenant with cross-border flagging.
- 6-hour incident-notification workflow tracking CERT-In and RBI reporting duties independently, with overdue detection.
- Audited platform-staff break-glass access: time-boxed, tenant-scoped credentials that seal an access event into the tenant's own audit chain on every use, with tenant-visible grants and revocation.
- Compliance control catalog.
- Regulated entity registry with board-policy and grievance-officer gates.
- LSP registry with RE agreement, enhanced due diligence, periodic review, borrower-facing grievance, data, recovery, and fee-control gates.
- DLA registry for own and LSP app/web surfaces, with CIMS-ready export rows and compliance attestation gates.
- Product policy registry with pricing, KFS, eligibility, cooling-off, and penal-charge gates, plus versioning with effective dates so an application prices against the policy governing its date.
- Registry-backed loan application resolution through `regulatedEntityId` and `productId`/`productCode`.
- Borrower profile registry with India-only and economic-profile checks.
- Consent ledger for DPDP-style purpose/notice/evidence records, plus a third-party data-disclosure ledger gating consent-based sharing and logging statutory (CIC/regulator) sharing.
- KYC record registry with V-CIP India-storage, Aadhaar prohibited-storage, and RBI risk-based periodic-review refresh gating on new sanction.
- Legal-entity borrower types (company/partnership/llp/trust) with a PMLA beneficial-owner registry: sanction is blocked without a verified owner meeting the controlling-interest threshold (25% company, 15% partnership/llp/trust) or declared as control/senior-managing-official.
- DPDP right-to-erasure workflow gated on statutory retention (active loan or the 5-year RBI/PMLA window), fulfilling by redacting the borrower profile in place.
- DPDP data-principal access and correction rights: access requests assemble a portable data pack (profile, consent ledger, KYC summary, loan accounts, disclosures); correction requests apply or reject a field change (applied corrections propagate to the profile); both run under a 30-day SLA clock and derive LWS tasks.
- CERSAI security-interest registration (SARFAESI): draft → filed → registered → modified → satisfied lifecycle with maker-checker modification, closure-gated satisfaction, prior-encumbrance search, and a `securedLoan` disbursement gate.
- FIU-IND STR/CTR reporting (PMLA): draft → reviewed → filed → acknowledged lifecycle with a designated Principal Officer review gate, a ₹10 lakh CTR threshold, and a tipping-off guard against exposing reports to the subject.
- Bank-account verification first slice: a tenant-authenticated mock/real connector verifies active borrower/end-beneficiary account evidence, and disbursement is blocked without matching verified-account proof.
- Payment rail first slice: tenant-authenticated NACH mandate and UPI collect initiation uses a mock/real provider boundary with India data-residency enforcement, stores masked/hash-only rail evidence, and seals financial audit events.
- Communications provider first slice: tenant-authenticated SMS/email/WhatsApp dispatch uses mock/real providers with India data-residency enforcement and stores masked, hashed dispatch evidence.
- Staff actor registry with India-only operational actors, roles, queue access, and assignment authority.
- Complaint registry and grievance workflow with 30-day RBI Ombudsman clock and RBI CMS escalation evidence.
- Borrower-backed application resolution through `borrowerId`.
- LOS application workflow state machine for preflight, KFS, decision proposal, human review, maker-checker approval, and disbursement.
- LOS execution document packet with rendered KFS, sanction letter, loan agreement summary, privacy notice, checksums, and delivery evidence.
- Document-vault first slice: successful eSign stores a tenant-scoped vault receipt with signed-packet signature evidence, per-document checksums, storage country, retention policy, and manifest checksum.
- LWS task queues derived from LOS/LMS state, with SLA metadata, role checks, assignment, start, release, and comment audit.
- Fraud case module with a natural-justice gate (show-cause notice + response window, four-eyes classification) and a checksum-sealed committee pack.
- LMS loan account creation on disbursement with repayment schedule, ledger, balance summary, interest accrual, payment posting, part-prepayment, foreclosure, and closure NOC.
- LMS hardship restructure (four-eyes tenure/rate concession with re-amortization) and settlement/write-off (four-eyes below-par closure and book-loss marking).
- LMS borrower statement and rendered statement-document generation plus disclosed-charge, waiver, and reversal ledger controls.
- LMS delinquency buckets, collections reminder workflow enforcing RBI FPC contact hours, an empanelled recovery-agent registry (due diligence, training, code of conduct, authorization), noticed recovery-agent assignment restricted to registered active agents, and same-day cash recovery posting.
- LMS SMA/NPA asset classification and CIC-ready reporting snapshots from account state.
- India-only loan application preflight.
- KFS generation and sanction readiness checks.
- LSP/pass-through fund-flow rejection.
- Aadhaar prohibited-storage checks.
- AI model inventory, governed lifecycle with an independent-validation gate, model kill switch, global kill switch, and model-use guard.
- AI drift monitoring that auto-trips a model-scoped kill switch on threshold breach, requiring post-incident review to clear.
- Generative-model validation gated on adversarial (red-team) and hallucination testing evidence, mirroring the high-risk fairness/explainability gate.
- Customer-facing AI disclosure and human-handoff workflow (pending to handled by a named human agent).
- File-backed API for local development.
- Automated tests proving the compliance gates (`npm test`).
