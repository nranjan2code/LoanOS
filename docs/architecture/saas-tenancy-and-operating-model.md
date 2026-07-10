# SaaS Tenancy and Operating Model

LoanOS India is operated as an India-hosted multi-tenant SaaS. This document defines the tenancy architecture, the platform's own vendor-compliance posture, and the engineering direction that follows from ADR 0002. It complements the [architecture blueprint](loanos-india-blueprint.md), which describes the lending domain; this document describes how that domain is delivered to many regulated entities at once.

## Tenancy Model

- A tenant is one contracting regulated entity (RE). One RE contract, one tenant.
- Programs, products, LSPs, DLAs, borrowers, loans, complaints, workflow tasks, and models all live inside a tenant. Nothing borrower- or loan-related is ever shared across tenants.
- Platform-level objects live in a control plane: the regulatory control catalog, tenant registry, platform staff and operations tooling, plans/entitlements, and platform audit.

### Isolation Tiers

| Tier | Compute | Data | Intended customer |
| --- | --- | --- | --- |
| Pooled (default) | Shared application tier | Logically isolated, tenant-scoped keys, per-tenant encryption keys | NBFCs, HFCs, fintech-program REs |
| Dedicated data plane | Shared or dedicated application tier | Separate database and key hierarchy, optionally separate infrastructure | Banks and REs whose policy requires it |

Both tiers are India-hosted. Tier choice is a tenant-contract fact recorded in the tenant registry, not a code fork.

### Isolation Rules

1. Every domain record carries a `tenantId`.
2. Storage access is tenant-scoped at the data-access layer. Endpoint code cannot express a cross-tenant query; isolation must not depend on per-endpoint `WHERE` discipline.
3. Every API request executes in an authenticated tenant context resolved before any handler runs.
4. Cross-tenant isolation is a tested invariant: the regression suite must prove that tenant A's credentials can never read or mutate tenant B's records, for every resource type.
5. Platform staff access to tenant data is break-glass: logged in the audit spine with actor, reason, and scope, and reportable to the affected tenant.

## Identity and Access

- Local IAM now authenticates tenant/platform humans with HTTP-only sessions and services with scoped tenant API credentials; production IAM should federate this through OIDC/SSO per tenant.
- One identity, not two: workflow roles (maker, checker, credit officer, grievance officer, human reviewer), queues, and assignment authority are fields directly on the tenant login user record — there is no separate staff-actor registry to keep in sync. A request's acting identity is always the authenticated session's own login user; the server ignores any different actor id a client claims to act as.
- Maker-checker and four-eyes rules already enforced in the domain remain the source of truth; IAM never bypasses them.

## Audit Evidence Spine

*Implemented (S4).* Every save seals the tenant's events into an append-only, tenant-scoped SHA-256 hash chain in `packages/core/src/audit.js`; `GET /audit/events` reports chain validity and `GET /audit/export` produces an integrity-attested evidence pack (which 409s rather than hand out a tampered pack). The chain root is bound to the tenant, so a chain cannot be transplanted between tenants. Each event carries:

- `sequence`, `eventId`, `tenantId`, `occurredAt` — stamped by the spine today.
- `previousHash` and `hash` — the per-tenant SHA-256 chain; stamped by the spine today.
- `type` plus subject references (application, account, complaint, model, task) — carried from the emitting handler today.
- `actor`/acting role, `dataClass`, `storageCountry`, `consentReference`, `policyVersion` — carried when the emitting handler includes them; a follow-on pass will make actor and data-class stamping uniform across every emission.

Export packs for auditors, RE compliance teams, and supervisors are generated from this spine, never assembled by hand: `GET /audit/export` returns the sealed events (optionally filtered by `type`/`subjectId`/date) plus a whole-chain integrity verdict and genesis/head anchors.

## Data Residency, Privacy, and Keys

- All data classes from the [blueprint](loanos-india-blueprint.md#data-residency-and-privacy) apply per tenant: identity/KYC, credit/application, payment/ledger, model input/output, audit evidence.
- Per-tenant encryption keys; a dedicated-tier tenant gets its own key hierarchy. Key destruction is part of tenant offboarding evidence.
- DPDP roles: the RE is the data fiduciary; LoanOS is the data processor. Processor obligations (security safeguards, breach support, processing only on instruction, deletion on instruction) are contract terms backed by platform features: retention jobs, deletion workflows, and breach-notification tooling are per-tenant.
- Retention and deletion jobs run per tenant against tenant-declared retention policies and leave evidence in the audit spine.

## Tenant Lifecycle

| Stage | Platform behavior |
| --- | --- |
| Onboarding | Tenant created in control plane; RE registry validation (already implemented) gates activation: RE type, grievance officer, board policies, disclosures, data-residency posture. |
| Environments | Each tenant gets sandbox and production; sandbox uses synthetic borrowers only. |
| API versioning | Versioned APIs with a documented deprecation window; regulated flows never break unannounced. |
| Operations | Uptime SLAs, incident communication, and a status page are contract commitments; incident tooling supports the RE's own RBI reporting clocks. |
| Exit | Full tenant data export in a documented, re-loadable format (records plus audit spine plus rendered documents) within the contractual window, then evidenced deletion and key destruction. Exit support is an RBI IT-outsourcing exit-plan requirement, not a courtesy. |

## LoanOS as a Regulated Entity's Service Provider

REs can only buy LoanOS if the platform satisfies their own outsourcing obligations. These are build targets:

| Obligation on the RE | What LoanOS must provide | Source |
| --- | --- | --- |
| Due diligence on IT service providers | Standing due-diligence pack: ownership, financials, security posture, subcontractors, certifications | RBI IT-Outsourcing MD 2023 |
| Audit and inspection rights, including RBI access | Contractual audit rights plus practical support: audit logs, evidence exports, environment access procedures | RBI IT-Outsourcing MD 2023 |
| Cyber-incident reporting to RBI within 6 hours | Incident notification to affected tenants without undue delay, with enough detail to file | RBI IT-Outsourcing MD 2023 |
| Business continuity and recovery | Documented, tested BCP/DR with RTO/RPO commitments | RBI IT-Outsourcing MD 2023 |
| Exit strategy | Data portability export, transition support, evidenced deletion | RBI IT-Outsourcing MD 2023 |
| Sub-outsourcing control | Sub-processor register, notification of changes, flow-down of obligations | RBI IT-Outsourcing MD 2023, DPDP |
| Concentration risk assessment | Transparency on shared infrastructure and dependencies | RBI IT-Outsourcing MD 2023 |

Platform-direct obligations (ours, regardless of customer):

- CERT-In directions (April 28, 2022): report qualifying cyber incidents to CERT-In within 6 hours; retain logs for 180 days within India; synchronize clocks to NIC/NPL NTP.
- DPDP 2023 processor duties for every tenant's borrower data.
- Certification roadmap: ISO 27001 first, then SOC 2 Type II, then RE-specific audits as contracts demand. Certifications are evidence for tenant due diligence, not a substitute for the controls above.

Whether LoanOS also constitutes a lending service provider (LSP) under the Digital Lending Directions depends on the functions performed per tenant program (customer acquisition, servicing, recovery). This is a per-contract legal determination; the platform must support operating either as a pure technology provider or as a registered LSP under a tenant's oversight.

## Engineering Direction (Sequenced)

1. **Tenant context groundwork.** *Done.* State is partitioned into a control plane (tenant registry) and per-tenant data planes in `apps/api/src/file-store.js`; a tenant-scoped store in `apps/api/src/server.js` hands each request only its own partition.
2. **API and human authentication.** *Done.* Every data-plane route resolves a tenant from either a tenant user session or `x-api-key`/bearer service credential and returns 401 without a valid tenant context. Tenants are minted through `POST /platform/tenants` behind a platform admin key or platform admin session; api keys are stored only as hashes, tenant service keys are rotatable, and tenant/platform users have PBKDF2-hashed passwords with HTTP-only sessions.
3. **Cross-tenant isolation tests.** *Done.* A regression suite provisions two tenants and proves tenant B cannot read or mutate tenant A's records across resource types, plus 401 on missing/invalid keys.
4. **Audit spine.** *Done.* Every save seals tenant events into a tamper-evident SHA-256 chain; `GET /audit/events` reports chain validity, and `GET /audit/export` produces a verifiable evidence pack.
5. **Tenant lifecycle.** *Done.* Platform onboarding can create the tenant shell, owner user, regulated entity profile, first product policies, enabled module/flow blueprint, readiness checklist, and one-time service key in one transaction; `GET /platform/tenants/:id/export` produces a reproducible portability pack; `POST /platform/tenants/:id/offboarding` performs evidenced deletion; sandbox environments can be provisioned, reset, and deleted with synthetic-only borrower checks and automatic mock overrides.
6. **Vendor posture pack.** *Done.* CERT-In/RBI 6-hour incident clock is tracked in `GET`/`POST /incidents`; sub-processor register is active in `GET`/`POST /platform/sub-processors`; platform staff break-glass is active, time-boxed, and sealed into tenant audit chains; platform users can log in and perform control-plane administration by role.
7. **Pooled-tier database isolation (RLS).** *Done, opt-in.* The pooled tier's "logically isolated, tenant-scoped keys" commitment above now has an executable slice: an optional Postgres storage driver (`LOANOS_STORAGE_DRIVER=postgres`, default remains the file store) puts every tenant's data-plane document in one row of a `tenant_data` table under Postgres Row-Level Security, enforced against the application's own connection (not just a hypothetical stricter role) via a two-role model — see `db/schema.sql`, `apps/api/src/postgres-store.js`, and [`docs/architecture/postgres-migration.md`](postgres-migration.md). This is a second, database-enforced isolation layer beneath the tenant-context-groundwork isolation in step 1, not a replacement for it. The dedicated-tier commitment (separate database/key hierarchy per tenant) is a deployment topology choice this same schema supports, not additional code.

Steps 1–7 have executable first slices. Contract terms, BCP/DR evidence, certifications, external IAM/SSO/MFA integration, and production key-management infrastructure (per-tenant encryption keys specifically — RLS is isolation, not encryption) remain outside this local implementation.
