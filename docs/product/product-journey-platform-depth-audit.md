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
| Product-specific experience missing | 19 | Co-lending, working-capital, asset, property, gold, field, merchant and trade facts do not have adequate specialized workspaces. Personal/MSME term have generic application surfaces only. |
| Production-ready | 0 | No selected-provider, tenant-UAT, operations, security and DR evidence chain exists. |

Important defects found by the audit:

- Resolved in the JD-01 foundation: `registries.js`, prepayment/foreclosure classification, tests and tenant onboarding now use only the canonical 21; legacy generic product IDs are rejected rather than aliased. Facility mechanics remain independently expressed as `term_loan`, `revolving_credit`, or `overdraft`.
- Resolved in the JD-01 foundation: the platform onboarding selector exposes exactly the canonical 21 and is regression-tested against the domain catalogue.
- Resolved in JD-02: `specialist-journey-service.js` wraps all 17 kernel-only journeys in persistent configurations, cases, checksum-bound action requests, independent approval, workflow tasks, visible exceptions, suspension and access-revocation containment. `/admin/specialist-journeys` binds tenant and actor authority to the authenticated session; file restart and PostgreSQL RLS tests cover persistence boundaries. A specialised UI consumer remains JD-03.
- The borrower form is a generic product/amount/tenor/destination-account form. It cannot capture property/title, dealer/vehicle, assay/custody, education, agricultural, group, merchant, invoice/PO/shipment, anchor, or co-lending facts.
- Staff workspaces implement generic task and selected operational actions, not complete archetype-specific origination-to-closure desks.
- JD-05 foundation implemented: every canonical journey receives 16 stable common scenarios plus one archetype-specific scenario; campaign proposal, independent approval, immutable result evidence, independent assessment, tenant persistence/API and audit events are executable. The scenario contracts exist, but the generated end-to-end runners that drive every platform layer are still to be implemented.

### JD-01/JD-02/JD-05 foundations delivered

- Canonical/business journey classification is centralized in `product-journey-administration.js`.
- Product-policy validation rejects every removed legacy ID and accepts all canonical built-ins.
- Tenant onboarding renders the exact canonical catalogue.
- `product-journey-conformance.js` creates checksum-bound 17-scenario manifests for all 21, with exact-content idempotency, four-eyes approval, evidence checksums, assessor independence and a simulated/live distinction.
- `/admin/product-journey-conformance` persists campaign administration and exposes tenant coverage; no conformance result directly marks a journey production-ready.
- The shared specialist service activates immutable configurations, opens version-bound cases, executes the 13 specialised and four trade kernels only after independent action approval, and preserves failures as actionable exceptions.
- Configuration suspension, principal suspension/inactivation and role revocation immediately pause affected cases and expose critical escalations/tasks.
- Remaining JD-01 work is the complete subscription/add-product/configuration/staffing administration workspace. JD-02 is complete at the persistent service/API boundary; JD-03 must render its schemas and workspaces, and JD-04 must compose it with the common lending lifecycle. Remaining JD-05 work is generated full-stack/API/browser execution for every scenario contract.

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

Status: persistent service slice delivered. All 17 use one service, exact template/configuration/schema/policy/workflow lineage, maker-checker configuration and actions, restart-safe storage, RLS-scoped Postgres storage, workflow projections, visible exception state, and immediate safety pause. Product-specific capture screens and common LOS/LMS composition deliberately remain JD-03/JD-04.

### JD-03 — Archetype schemas and workspaces · all 21

Create schema-driven capture and workspaces for: unsecured/business term, property secured, asset finance, gold custody, revolving working capital, co-lending, trade receivables, seasonal agriculture, group field, merchant POS, and education. Reuse components; do not fork 21 frontends.

Acceptance: schemas declare required facts, documents, roles, actions and redaction; borrower/partner/field/staff channels render only entitled journey schemas; accessibility, language, privacy, offline and authorization tests pass.

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

Start with JD-01 and the JD-05 conformance skeleton together: one establishes clean vocabulary and one prevents future overstatement. Then implement JD-02 once for all 17 kernel-only journeys. JD-03 and JD-04 should proceed by archetype, beginning with property/asset, business/trade, and field/POS clusters rather than individual product names. JD-06 remains explicit mock/provider-bound work until vendors are selected.

The key is that the six batches close shared platform layers. We do not have 21 independent builds; we have approximately 11 archetypes over one common lending lifecycle.
