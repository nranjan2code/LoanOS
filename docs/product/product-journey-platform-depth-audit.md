# Product journey platform-depth audit

## Decision

The public website is excluded from this audit. A journey page proves only discoverability. Platform readiness means a regulated entity can provision, configure, staff, operate, evidence, reconcile, recover and retire that journey inside its tenant, and a borrower/partner/operator can complete every applicable lifecycle step through authorized platform surfaces.

The current claim must remain: **21 governed built-in templates, not 21 production-ready end-to-end products.** No journey is production-ready in the repository.

The machine-readable source is [product-journey-platform-depth.json](product-journey-platform-depth.json). Run:

```bash
node scripts/audit-product-journey-depth.mjs
```

The audit fails if the register diverges from `PRODUCT_JOURNEY_TYPES`, repeats a journey, cites missing evidence, omits deep dimensions, or references an undefined remediation batch.

## What “deeply ready” requires

Every journey is examined across 14 gates:

1. tenant entitlement, initial provisioning, later add-product and rollback;
2. governed product definition, pricing, policy versions and effective dates;
3. users, roles, feature staffing, maker-checker and workload identities;
4. customer, partner, branch, field, credit, operations and control experiences;
5. product-specific data capture and deterministic underwriting controls;
6. documents, KFS, sanction, agreement, eSign/eStamp and custody;
7. beneficiary verification, conditions, disbursement and direct fund flow;
8. account structure, schedules, ledger, accounting, tax and reconciliation;
9. servicing, changes, collections, recovery, closure and release;
10. journey-applicable RBI/CKYC/CIC/FIU/CERSAI/CRILC/PSL evidence;
11. live provider adapters, callbacks, retries, exceptions and reconciliation;
12. migration, operations, monitoring, security, DR, support and exit;
13. tenant-persistent APIs with idempotency and audit lineage; and
14. full-lifecycle automated tests, including adverse and recovery cases.

Readiness is fail closed. It is not a percentage average: a missing authority, accounting, reconciliation, regulatory, integration, or recovery gate blocks launch.

## Current evidence-based result

| Finding | Current result | Meaning |
| --- | ---: | --- |
| Canonical built-ins | 21 | Catalogue/provisioning definitions exist for the complete set. |
| Controlled first slices | 3 | Personal loan, co-lending programme and MSME working capital have the strongest composed domain/API paths. They are still not tenant-production-ready. |
| Configurable patterns | 18 | They have prerequisite templates and shared lifecycle building blocks, not complete products. |
| Specialist/trade persistent service | 17 | All thirteen specialised families and four trade families now have a shared tenant-persistent configuration/case/action API with exact version lineage. This remains a specialist-service slice, not a composed end-to-end product. |
| Schema-driven journey experience | 21 | All canonical journeys now project through 11 governed archetype schemas across borrower, branch, partner, field, credit, operations and control channels. This is the JD-03 capture/workspace slice, not full lifecycle composition. |
| Production-ready | 0 | No selected-provider, tenant-UAT, operations, security and DR evidence chain exists. |

Important defects found by the audit:

- Resolved in the JD-01 foundation: `registries.js`, prepayment/foreclosure classification, tests and tenant onboarding now use only the canonical 21; legacy generic product IDs are rejected rather than aliased. Facility mechanics remain independently expressed as `term_loan`, `revolving_credit`, or `overdraft`.
- Resolved in the JD-01 foundation: the platform onboarding selector exposes exactly the canonical 21 and is regression-tested against the domain catalogue.
- Resolved in JD-02: `specialist-journey-service.js` wraps all 17 kernel-only journeys in persistent configurations, cases, checksum-bound action requests, independent approval, workflow tasks, visible exceptions, suspension and access-revocation containment. `/admin/specialist-journeys` binds tenant and actor authority to the authenticated session; file restart and PostgreSQL RLS tests cover persistence boundaries.
- Resolved in JD-03: `journey-workspace.js` maps all 21 to 11 shared workspace schemas with facts, evidence, actions, field classifications, checksums and English/Hindi labels. Server projections enforce effective tenant entitlement, interactive principal type, channel and roles before returning a schema.
- Resolved in JD-03: borrower, branch, partner, field, credit, operations and control surfaces render one shared safe-DOM workspace. Drafts are server-persistent and schema-bound; business requests use no-store, browser persistence is forbidden, API projections mask classified values, and audit events contain lineage rather than captured values.
- Staff and borrower experiences remain a capture/workspace slice. JD-04 must compose these schemas with specialist assessment and the full common origination, LMS, accounting, servicing, reporting and closure lifecycle.
- JD-05 foundation implemented: every canonical journey receives 16 stable common scenarios plus one archetype-specific scenario; campaign proposal, independent approval, immutable result evidence, independent assessment, tenant persistence/API and audit events are executable. The scenario contracts exist, but the generated end-to-end runners that drive every platform layer are still to be implemented.

### JD-01/JD-02/JD-03/JD-05 foundations delivered

- Canonical/business journey classification is centralized in `product-journey-administration.js`.
- Product-policy validation rejects every removed legacy ID and accepts all canonical built-ins.
- Tenant onboarding renders the exact canonical catalogue.
- `product-journey-conformance.js` creates checksum-bound 17-scenario manifests for all 21, with exact-content idempotency, four-eyes approval, evidence checksums, assessor independence and a simulated/live distinction.
- `/admin/product-journey-conformance` persists campaign administration and exposes tenant coverage; no conformance result directly marks a journey production-ready.
- The shared specialist service activates immutable configurations, opens version-bound cases, executes the 13 specialised and four trade kernels only after independent action approval, and preserves failures as actionable exceptions.
- Configuration suspension, principal suspension/inactivation and role revocation immediately pause affected cases and expose critical escalations/tasks.
- The shared workspace registry maps the 21 to 11 schemas; entitlement/channel/role projection, classified fields/documents/actions, exact-money validation, redacted persistent drafts and accessible channel surfaces are executable.
- Remaining JD-01 work is the complete subscription/add-product/configuration/staffing administration workspace. JD-02 and JD-03 are complete at their persistent service and schema/workspace boundaries; JD-04 must compose both with the common lending lifecycle. Remaining JD-05 work is generated full-stack/API/browser execution for every scenario contract.

## Greenfield rule

There are zero users and no backward-compatibility requirement. Therefore:

- remove legacy product IDs rather than aliasing them;
- use the 21 canonical IDs as the only built-in product vocabulary;
- model future products as versioned platform or tenant-derived templates;
- do not build 21 copied services or UIs;
- use common lifecycle components plus archetype-specific schemas, policies and workflow packs;
- migrate repository fixtures/tests directly to canonical IDs; no dual-read or compatibility period is required.

## Six implementation batches

### JD-01 — Canonical tenant product administration · all 21

Delete legacy product types. Make the catalogue the single source for onboarding, subscription, add-product, configuration, staffing, readiness, suspension and retirement. Add a data-driven tenant product administration workspace with configuration diffs and next-action blockers.

Acceptance: every platform/product-policy record uses a canonical or governed custom template ID; all 21 can be selected initially or later; invalid legacy IDs fail; add-product cannot alter an active product; tests cover maker-checker, tenant isolation, compensation and rollback.

### JD-02 — Persistent specialized journey service · 17 journeys

Wrap the 13 specialized and four trade kernels in tenant-persistent services and API routes. Add immutable version binding, idempotency, actor attribution, maker-checker, audit events, workflow tasks, exception state, and safe suspension.

Acceptance: a tenant can configure and assess every specialized/trade pack through authenticated APIs; restart persistence and PostgreSQL RLS are proven; no body-supplied tenant/actor authority is trusted.

Status: persistent service slice delivered. All 17 use one service, exact template/configuration/schema/policy/workflow lineage, maker-checker configuration and actions, restart-safe storage, RLS-scoped Postgres storage, workflow projections, visible exception state, and immediate safety pause. JD-03 now supplies its schema/workspace consumer; common LOS/LMS composition remains JD-04.

### JD-03 — Archetype schemas and workspaces · all 21

Create schema-driven capture and workspaces for: unsecured/business term, property secured, asset finance, gold custody, revolving working capital, co-lending, trade receivables, seasonal agriculture, group field, merchant POS, and education. Reuse components; do not fork 21 frontends.

Acceptance: schemas declare required facts, documents, roles, actions and redaction; borrower/partner/field/staff channels render only entitled journey schemas; accessibility, language, privacy, offline and authorization tests pass.

Status: schema/workspace slice delivered. Exactly 11 checksum-bound schemas cover the canonical 21 and project across seven authorised channels. Effective tenant entitlement, principal/channel/role authorization, classified field/document/action projections, English/Hindi labels, exact-paise validation, actor-bound server drafts, redacted responses, privacy-safe audit, accessible safe-DOM rendering and offline no-cache behavior are tested. Full common lifecycle composition remains JD-04; generated browser/PostgreSQL adverse execution remains JD-05; deployment acceptance remains JD-06.

### JD-04 — Composed lifecycle orchestration · all 21

Introduce a journey instance that composes specialist assessment with common KYC, decision, KFS, contract, disbursement, LMS, accounting, servicing, collections, reporting and closure. State transitions are versioned and policy-driven.

Acceptance: no specialized approval can bypass common compliance gates; account/accounting profiles match the journey; every transition has actor/policy/evidence; pause/revocation stops work immediately; compensation and manual-intervention paths are visible.

### JD-05 — Journey conformance factory · all 21

Generate reusable tenant fixtures and run the same baseline corpus plus archetype-specific scenarios. Test file and PostgreSQL drivers, API, browser workspaces and recovery.

Minimum corpus: happy path, policy decline, missing evidence, provider timeout, replay/duplicate, stale version, wrong tenant, wrong role, self-approval, revocation mid-work, reconciliation mismatch, accounting balance, reporting output, repayment, delinquency, closure, rollback and audit replay.

Acceptance: the dashboard is generated from test evidence and cannot label a journey deeply ready unless every mandatory scenario passes for its current template version.

### JD-06 — Provider and production operations · all 21

Map each archetype to required vendors and authority interfaces; certify mappings/adverse UAT; deploy workers and reconciliation; execute migration, scale, security, DR, support and exit exercises. Evidence remains tenant/journey/version specific.

Acceptance: commercial contracts/credentials, India residency, native schemas, callbacks, reconciliation, SLO/capacity, on-call, backup/restore, failover/failback, security assurance and institution-witnessed UAT are current. Only then may a tenant journey be `production_ready`.

## Recommended execution order

JD-01/JD-05 foundations, JD-02 and JD-03 are now implemented at their stated internal boundaries. The next engineering batch is JD-04: one versioned lifecycle instance composing the schema capture, specialist service and common LOS/LMS/accounting controls. JD-05 then needs generated API/browser/PostgreSQL execution of every mandatory scenario. JD-06 remains explicit mock/provider-bound work until vendors are selected.

The key is that the six batches close shared platform layers. We do not have 21 independent builds; we have approximately 11 archetypes over one common lending lifecycle.
