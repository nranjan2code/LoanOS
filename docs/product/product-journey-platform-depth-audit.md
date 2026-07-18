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
| Schema-driven journey experience | 21 | All canonical journeys now have contract-bound product schemas across borrower, branch, partner, field, credit, operations and control channels. Components remain archetype-reusable, but facts/evidence are product-specific. |
| Composed lifecycle control plane | 21 | Every canonical journey now enters the same versioned, tenant-persistent 12-stage application-to-closure orchestrator with evidence gates, maker-checker transitions, pause/manual intervention and exact lineage. This remains an internal composition slice, not production certification. |
| Production-ready | 0 | No selected-provider, tenant-UAT, operations, security and DR evidence chain exists. |

Important defects found by the audit:

- Resolved in the JD-01 foundation: `registries.js`, prepayment/foreclosure classification, tests and tenant onboarding now use only the canonical 21; legacy generic product IDs are rejected rather than aliased. Facility mechanics remain independently expressed as `term_loan`, `revolving_credit`, or `overdraft`.
- Resolved in the JD-01 foundation: the platform onboarding selector exposes exactly the canonical 21 and is regression-tested against the domain catalogue.
- Resolved in JD-02: `specialist-journey-service.js` wraps all 17 kernel-only journeys in persistent configurations, cases, checksum-bound action requests, independent approval, workflow tasks, visible exceptions, suspension and access-revocation containment. `/admin/specialist-journeys` binds tenant and actor authority to the authenticated session; file restart and PostgreSQL RLS tests cover persistence boundaries.
- Resolved in the greenfield JD-03 replacement: `journey-workspace.js` maps all 21 contracts to product-specific workspace schemas with complete typed facts/evidence, actions, classifications, checksums and genuine English/Hindi labels. Server projections enforce effective tenant entitlement, interactive principal type, channel and roles.
- Resolved in JD-03: borrower, branch, partner, field, credit, operations and control surfaces render one shared safe-DOM workspace. Drafts are server-persistent and schema-bound; business requests use no-store, browser persistence is forbidden, API projections mask classified values, and audit events contain lineage rather than captured values.
- Resolved in JD-04: `composed-journey-lifecycle.js` binds all 21 to one ordered application-capture through closure lifecycle. Each transition requires the exact stage evidence contract, current instance version, immutable checksum and independent checker; no stage can be skipped.
- Resolved in JD-04: authenticated `/admin/composed-journeys` operations persist instances, transition requests and escalations. Product/configuration/principal authority loss pauses work; failures become visible manual intervention; resume returns only to the recorded stage.
- The schema workspaces and specialist service are composed through controlled references and stage evidence. They are not yet 21 fully executed browser journeys: JD-05 still needs interactive browser lifecycle execution and an actual run against the selected PostgreSQL/RLS environment, and JD-06 must certify real providers and deployment operations.
- JD-05 repository execution implemented: every canonical journey receives 16 stable common scenarios plus one archetype-specific scenario; campaign proposal, independent approval, authenticated server-side generated execution, immutable result evidence, independent assessment, tenant persistence/API and audit events are executable. A non-production executor evaluates all 21 × 17 contracts with reusable policy, simulator, authority, accounting, reporting, servicing, rollback and audit kernels. Its archetype cases operate the persistent specialist service for all 17 specialist/trade journeys and the composed lifecycle for the remaining four. The environment-gated PostgreSQL test persists every result under RLS; interactive browser lifecycle and execution against the selected database environment remain required.

### JD-01/JD-02/JD-03/JD-04/JD-05 foundations delivered

- Canonical/business journey classification is centralized in `product-journey-administration.js`.
- Product-policy validation rejects every removed legacy ID and accepts all canonical built-ins.
- Tenant onboarding renders the exact canonical catalogue.
- `product-journey-conformance.js` creates checksum-bound 17-scenario manifests for all 21, with exact-content idempotency, four-eyes approval, evidence checksums, assessor independence and a simulated/live distinction.
- `product-journey-generated-conformance.js` expands those manifests into an exact 21-journey × 17-scenario × three-lane JD-05 execution matrix for API/file, browser-contract and PostgreSQL/RLS evidence. Missing executors, missing evidence and live/production claims fail closed; the runner never produces production readiness.
- The repository executor covers every generated journey/scenario contract and binds observations to the tenant, current product template and workspace schema. Shared downstream mechanics are reused; the archetype case executes governed specialist configuration/case/action paths and exact trade settlement where applicable. Approved campaigns can invoke that executor through the authenticated API and persist all 17 immutable results. This does not replace interactive browser execution, an actual selected-environment PostgreSQL/RLS run or provider execution.
- `/admin/product-journey-conformance` persists campaign administration and exposes tenant coverage; no conformance result directly marks a journey production-ready.
- The shared specialist service activates immutable configurations, opens version-bound cases, executes the 13 specialised and four trade kernels only after independent action approval, and preserves failures as actionable exceptions.
- Configuration suspension, principal suspension/inactivation and role revocation immediately pause affected cases and expose critical escalations/tasks.
- The workspace registry binds all 21 product contracts to distinct schemas; entitlement/channel/role projection, classified fields/documents/actions, exact-money validation, redacted persistent drafts and accessible channel surfaces are executable.
- The composed lifecycle registry covers every canonical journey and defines 12 monotonic evidence-gated stages plus terminal completion. Instance, stage, product/schema/policy/workflow/accounting and specialist lineage are immutable; transitions are current-version, content-idempotent and maker-checker controlled.
- Persistent pause, manual-intervention escalation and recovery make authority loss, specialist referral, stale lineage and ambiguous downstream effects visible. Recovery requires governed evidence and cannot skip a stage.
- JD-01 now closes its internal administration boundary: the governed surface covers subscription/add-product, repeatable staffing, server-versioned forms, configuration diffs, lifecycle history, evidence/document references, next-action blockers and maker-checker transitions. Later-product proposals bind completed same-tenant compensated-saga handovers and current FST-002/FST-030 readiness; configuration grants resolve to authoritative verified-human IAM resources and are rechecked at approval/activation. JD-02, JD-03 and JD-04 are also complete at their governed service, workspace and composition-control boundaries. JD-05 and JD-06 retain the execution and external-production gaps below.

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

Status: internal administration boundary delivered. The first product may use the bootstrap subscription path; every later product requires an immutable proposal and independent checker over a completed same-tenant `add_product` saga. The saga's requested products, active-product snapshot, handover checksum/revision and approval are retained. Compensated/rolled-back work, foreign scope and a changed active-product snapshot deny subscription. FST-002/FST-030 readiness and referenced active verified-human IAM grants are joined at proposal/configuration and revalidated against exact configuration/checksum lineage before approval and activation. Deployment controllers and institution operating evidence remain JD-06 work.

### JD-02 — Persistent specialized journey service · 17 journeys

Wrap the 13 specialized and four trade kernels in tenant-persistent services and API routes. Add immutable version binding, idempotency, actor attribution, maker-checker, audit events, workflow tasks, exception state, and safe suspension.

Acceptance: a tenant can configure and assess every specialized/trade pack through authenticated APIs; restart persistence and PostgreSQL RLS are proven; no body-supplied tenant/actor authority is trusted.

Status: persistent service slice delivered. All 17 use one service, exact template/configuration/schema/policy/workflow lineage, maker-checker configuration and actions, restart-safe storage, RLS-scoped Postgres storage, workflow projections, visible exception state, and immediate safety pause. JD-03 supplies its schema/workspace consumer and JD-04 now consumes the specialist evidence in the common lifecycle.

### JD-03 — Archetype schemas and workspaces · all 21

Create schema-driven capture and workspaces for: unsecured/business term, property secured, asset finance, gold custody, revolving working capital, co-lending, trade receivables, seasonal agriculture, group field, merchant POS, and education. Reuse components; do not fork 21 frontends.

Acceptance: schemas declare required facts, documents, roles, actions and redaction; borrower/partner/field/staff channels render only entitled journey schemas; accessibility, language, privacy, offline and authorization tests pass.

Status: product-schema/workspace slice delivered. Exactly 21 contract/checksum-bound schemas project across seven authorised channels while reusing archetype components. Effective tenant entitlement, principal/channel/role authorization, complete product facts/evidence, classified action projections, genuine English/Hindi labels, exact-paise validation, actor-bound server drafts, redacted responses, privacy-safe audit, accessible safe-DOM rendering and offline no-cache behavior are tested. Interactive browser lifecycle and downstream adverse execution remain JD-05; deployment acceptance remains JD-06.

### JD-04 — Composed lifecycle orchestration · all 21

Introduce a journey instance that composes specialist assessment with common KYC, decision, KFS, contract, disbursement, LMS, accounting, servicing, collections, reporting and closure. State transitions are versioned and policy-driven.

Acceptance: no specialized approval can bypass common compliance gates; account/accounting profiles match the journey; every transition has actor/policy/evidence; pause/revocation stops work immediately; compensation and manual-intervention paths are visible.

Status: composition control-plane slice delivered for all 21. One tenant-persistent instance moves monotonically through `application_capture`, `kyc_aml`, specialist assessment, credit decision, KFS acceptance, contracting, disbursement, LMS/accounting, servicing, collections, regulatory reporting and closure before terminal completion. Stage definitions declare mandatory evidence; product and workspace lineage is exact; specialist-backed journeys require their case/result evidence; transition proposals are immutable, current-version and independently approved. Persistent pause/manual-intervention escalations contain product, configuration, identity/role and ambiguous-effect failures, and governed resume restores only the recorded stage. The authenticated API binds tenant and actor authority and exposes controlled portfolio/transition/escalation projections. This closes JD-04 only at the internal orchestration boundary; JD-05 generated full-stack execution and JD-06 provider/deployment certification remain.

### JD-05 — Journey conformance factory · all 21

Generate reusable tenant fixtures and run the same baseline corpus plus archetype-specific scenarios. Test file and PostgreSQL drivers, API, browser workspaces and recovery.

Minimum corpus: happy path, policy decline, missing evidence, provider timeout, replay/duplicate, stale version, wrong tenant, wrong role, self-approval, revocation mid-work, reconciliation mismatch, accounting balance, reporting output, repayment, delinquency, closure, rollback and audit replay.

Acceptance: the dashboard is generated from test evidence and cannot label a journey deeply ready unless every mandatory scenario passes for its current template version.

Status: repository execution, selected-PostgreSQL persistence and an interactive capture slice are delivered, not JD-05 completion. The deterministic matrix and fail-closed runner cover all 1,071 journey/scenario/lane contracts. The tenant-bound executor evaluates all 357 journey/scenario contracts, produces stable replay evidence and remains explicitly non-live. Authenticated administrators can execute an approved campaign server-side and persist all 17 results; archetype cases run the persistent specialist/composed services rather than metadata checks. The separately executed selected PostgreSQL/RLS command passed all 3 tests, persisting 21 × 17 evidence with isolation/recovery. The loopback-only `npm run jd05:browser` harness then passed all 12 in-app checks: it established a disposable synthetic borrower session, opened every canonical workspace, blocked missing and malformed values, saved/resumed/submitted typed facts, injected a draft-service outage, recovered by refresh, and checked no-store, bilingual and accessibility behavior. Its checksum-sealed receipt is `docs/evidence/jd05-interactive-browser-2026-07-18.json`; neither result can claim live or production readiness. JD-05 remains open for cross-browser/device and assistive-technology certification plus interactive specialist full-lifecycle actions beyond capture.

### JD-06 — Provider and production operations · all 21

Map each archetype to required vendors and authority interfaces; certify mappings/adverse UAT; deploy workers and reconciliation; execute migration, scale, security, DR, support and exit exercises. Evidence remains tenant/journey/version specific.

Acceptance: commercial contracts/credentials, India residency, native schemas, callbacks, reconciliation, SLO/capacity, on-call, backup/restore, failover/failback, security assurance and institution-witnessed UAT are current. Only then may a tenant journey be `production_ready`.

Status: repository production-certification control and governed external-artifact intake delivered. The assessor requires eleven current tenant/journey/template/configuration-bound domains plus every provider family declared by the canonical template. Authenticated humans can submit external artifact metadata/checksum, source, India immutable custody, witness and expiry; payloads are rejected and an independent reviewer must attest all five checks. Provider, deployment and institution bundles accept reviewed artifact identifiers only, and artifact suspension, expiry, tamper or version drift blocks later resolution. Production proposals accept only registry identifiers, and approval/live activation re-resolve current records. This closes the repository intake and registry-join gap, not external certification: real contracts, credentials, native schemas, telemetry, institution UAT and witnessed operations must still be supplied and remain outside the repository, so no actual journey is labelled production-ready.

## Recommended execution order

JD-01 through JD-04 now have delivered internal governed boundaries. JD-05 now includes authenticated generated execution, file and selected-PostgreSQL persistence, persistent specialist/composed archetype execution, and an all-21 interactive browser capture/adverse/recovery harness. Next, extend browser evidence into specialist and composed lifecycle actions and certify cross-browser, mobile and assistive-technology operation. JD-06 now has governed artifact intake, registry assembly and live revalidation; remaining work is external: authorised humans must supply genuine provider/deployment/institution artifacts from selected systems, with their real checksums, source records, India custody, witnesses and review evidence. No such external evidence ships with the repository.

The key is that the six batches close shared platform layers. We do not copy 21 applications: 21 explicit product contracts and schemas reuse archetype components over one common lending lifecycle.
