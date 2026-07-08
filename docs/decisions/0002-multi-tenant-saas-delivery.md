# ADR 0002: Multi-Tenant SaaS Delivery Model

## Status

Accepted.

## Context

LoanOS India is delivered as SaaS: one India-hosted platform operated by us, serving many regulated entities (REs) as customers. Until this record, the delivery model was undocumented. The domain model already keys records to `regulatedEntityId`, but the runtime is a single shared store with no tenant boundary, no API authentication, and no per-tenant isolation guarantees.

Being a SaaS vendor to RBI-regulated entities changes our own regulatory posture, not just our customers':

- Under the RBI `Master Direction on Outsourcing of Information Technology Services` (RBI/2023-24/102, April 10, 2023), LoanOS is a third-party IT service provider. REs must obtain due-diligence evidence, audit and inspection rights (including RBI access), incident notification that supports the RE's 6-hour reporting window to RBI, business continuity assurances, and a documented exit plan from us.
- Under DPDP 2023, the RE is the data fiduciary and LoanOS is a data processor operating under contract. Processor duties (security safeguards, breach support, deletion on instruction) must be designed in.
- Under CERT-In directions of April 28, 2022, LoanOS itself must report qualifying cyber incidents within 6 hours and retain logs in India for 180 days.
- A cross-tenant data leak between two REs is a reportable regulatory event for both customers, not just a software bug.

## Decision

1. **Tenant = contracting regulated entity.** Every tenant maps to exactly one RE contract. Sub-scoping (programs, partner LSPs) lives inside a tenant, never across tenants.
2. **Tenant context is mandatory everywhere.** Every domain record carries a `tenantId`. Every API call executes in an authenticated tenant context. Cross-tenant reads and writes must be impossible by construction (tenant-scoped storage access, not per-endpoint filtering).
3. **Control plane vs tenant data plane.** Platform-level objects (regulatory control catalog, platform staff, tenant registry, plans) live in a control plane. All RE, borrower, loan, complaint, workflow, and model data lives in the tenant's data plane.
4. **Isolation tiers.** Default is pooled compute with logically isolated, per-tenant-encrypted data. A dedicated data plane (separate database/keys/infrastructure) is offered for REs that require it. Both tiers are India-hosted.
5. **One audit spine.** All modules emit into a single append-only, hash-chained, tenant-scoped audit event stream carrying actor, action, subject, data class, storage country, consent reference, and policy version. This replaces the current flat `events` array as the evidence backbone.
6. **Vendor posture is a build target.** RE audit-rights pack, incident notification workflow, exit/portability export, and certification roadmap (ISO 27001, SOC 2 Type II) are platform deliverables, not sales collateral.
7. **Tenancy groundwork moves ahead of new feature slices.** Tenant scoping, API authentication, and cross-tenant isolation tests are the next engineering priority, because retrofitting tenancy after more modules land multiplies the cost.

## Consequences

Positive:

- Tenant isolation becomes testable now, while the codebase is small.
- The RE-accountability model in RBI Digital Lending Directions maps cleanly onto tenancy: what the RE must evidence, the tenant boundary contains.
- The audit spine turns "evidence by design" from a per-module habit into a platform guarantee that survives module growth.
- Sales-blocking vendor questions (isolation, audit rights, exit plan, residency) have designed answers.

Tradeoffs:

- API authentication arrives earlier than the original Epic 10 plan, before a full IAM product exists.
- Every existing module needs a tenant-scoping pass and isolation regression tests.
- The file-backed store gains per-tenant namespacing as an interim step even though a real database replaces it later.

## Review Triggers

Revisit this decision if:

- A regulated entity requires on-premise or single-tenant-only deployment as a market condition.
- RBI or DPDP rules impose isolation or residency requirements beyond per-tenant logical isolation with India hosting.
- The platform expands to non-RE customers or outside India (see ADR 0001 triggers).
