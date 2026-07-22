# LoanOS Technical Academy — Curriculum Contract

The LoanOS Technical Academy is the system-level companion to the BA Lending Academy. It is published at `/help/technical-academy/` and explains how the complete platform works: product planes, runtime boundaries, tenancy, identity, LOS/LMS/LWS lifecycles, decisioning, AI governance, all 21 product journeys, integrations, data/security, deployment, recovery and production admission.

## Product alignment

The Academy does not create a second PRD. Content is derived from and links back to:

1. `docs/product/what-we-are-building.md` — canonical product definition and boundary;
2. `docs/product/complete-system-capability-catalog.md` and `capability-trace.json` — requirement status and evidence;
3. `docs/product/product-journey-support-matrix.md` — maturity source for all 21 journeys;
4. load-bearing architecture documents and ADRs — designed technical contracts;
5. code and tests — executable implementation evidence.

A lesson, route or screen is not evidence of production readiness. The course must preserve the support matrix's maturity language and distinguish platform evidence from tenant configuration, live-provider, UAT and operating-effectiveness evidence.

## Curriculum

The course has twelve modules and 71 deep-dive sessions. The journey module contains one composition overview, one dedicated lesson for each of the 21 canonical product journeys, and three shared casebooks for adverse outcomes, state/evidence tracing and production certification.

The generated Capability Atlas is the exhaustive individual-requirement companion to the curriculum. It publishes all 465 unique capability IDs from the 33-family complete-system catalogue with their canonical names, applicability and current status, plus a route into the primary technical lesson for each family. Every individual record includes its acceptance boundary, current maturity/gap, accountable owner, plane, dependencies, review date and expandable implementation/test/document evidence from `capability-trace.json`. The build fails if a capability disappears, an ID is duplicated, a write-up or evidence set is incomplete, catalogue and trace disagree, a family lacks a lesson mapping or the rendered atlas drifts from its source.

The generated Integration Atlas is the exhaustive external-boundary companion. It renders all 115 `INT-*` contracts from the platform module integration and API map across 12 domains. Each write-up includes required operations, direction and response, current mock/live boundary, downstream consumers, restrictive failure behavior and the certification/production checklist. The build fails if an integration disappears, duplicates another ID or rendered content drifts.

- System orientation: whole-platform map, product planes, request lifecycle and sources of truth.
- Tenancy, identity and activation: isolation, staffing authority and organisation bootstrap.
- Channels, APIs, storage and data: user-surface authority, API composition and idempotency, file/PostgreSQL storage with RLS, and governed reporting/data products.
- Customers, identity and application risk: CRM/party graphs, consent and data-principal rights, KYC/CDD/AML, fraud operations, and document/OCR custody.
- Lending lifecycle: origination, KFS/contract/disbursement, LMS exact-money ledger, servicing through closure.
- Credit, collateral and payments: CAM and human underwriting, asset/security perfection, payment rails, allocation and reconciliation.
- The Rules Engine: architecture invariants, typed facts and expressions, bundle compilation/signing, exact deterministic evaluation, per-tenant runtime topology, gateways, replay, testing and fleet operations.
- Workflow, AI and evidence: LWS, governed workers and audit/compliance around deterministic decisions.
- All product journeys: the composition framework; 21 individual end-to-end technical lessons; and adverse-case, state/evidence and production-certification casebooks.
- Institutional control and economics: product administration, partner economics, finance/tax/treasury, portfolio risk, customer protection and regulatory reporting.
- Field delivery, implementation and engineering quality: branch/DSA/field architecture, migration/UAT/adoption and the repository definition of done.
- Integrations, security and operations: provider conformance, data/security, AWS releases, observability/recovery and an end-to-end capstone.

Every session contains 2–3 learning outcomes, at least three detailed explanations, a subject-relevant human-led Indian orientation image, an accessible generated technical flow, an active-recall self-check and at least two existing repository sources. Six optimised Academy-owned photographs provide a coherent visual language across the 12 modules and their sessions; useful alternative text is mandatory, while precise system relationships remain in generated flows and architecture diagrams rather than being delegated to photography. The self-check requires the learner to name tenant/actor authority, source of truth, restrictive failure behaviour and retained evidence; it is formative practice, not certification. Every individual journey lesson additionally exposes its exact contract facts/evidence, facility/security/accounting model, eight lifecycle sections, current maturity boundary and a 17-case matrix covering happy path, policy decline, evidence failure, provider timeout, replay, stale versions, tenant/role/self-approval violations, revocation, reconciliation/accounting failures, delinquency, cancellation, closure, rollback and audit replay. Content lives in `apps/help/technical-academy/content/`; generated HTML is never edited directly.

The journey UX contract is shared across all 21 products: a scannable catalogue card, maturity badge, blueprint summary, responsive stage diagram, fact/evidence chips, journey-level regulatory-control cards, six lifecycle cards, evidence/readiness panels, progressively disclosed adverse cases and source links. The drift gate rejects a journey that falls back to the legacy sticky contents sidebar or wide case table.

## Build and governance

`node scripts/build-technical-academy.mjs` validates source references and the 21-row journey matrix before generating static pages. `--check` is the drift gate. Generated pages expose current session position, linked contents, active section, reading progress and session-only focus mode. The course stores no learner data and inherits the canonical/tenant-overlay boundary in `docs/architecture/help-centre-and-academy.md`.

Any structural platform change reopens the affected session. Journey changes must reconcile the contract registry, support matrix and journey lesson together. Compliance, security, deployment and production-admission sessions require the relevant control owner before advancing their verification date.
