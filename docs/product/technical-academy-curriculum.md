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

The course has six modules and 45 deep-dive sessions. The journey module contains one composition overview, one dedicated lesson for each of the 21 canonical product journeys, and three shared casebooks for adverse outcomes, state/evidence tracing and production certification.

- System orientation: whole-platform map, product planes, request lifecycle and sources of truth.
- Tenancy, identity and activation: isolation, staffing authority and organisation bootstrap.
- Lending lifecycle: origination, KFS/contract/disbursement, LMS exact-money ledger, servicing through closure.
- Workflow, policy, AI and evidence: LWS, deterministic Rust engine, governed workers and audit/compliance.
- All product journeys: the composition framework; 21 individual end-to-end technical lessons; and adverse-case, state/evidence and production-certification casebooks.
- Integrations, security and operations: provider conformance, data/security, AWS releases, observability/recovery and an end-to-end capstone.

Every session contains 2–3 learning outcomes, at least three detailed explanations, an accessible generated SVG technical flow and at least two existing repository sources. Every individual journey lesson additionally exposes its exact contract facts/evidence, facility/security/accounting model, eight lifecycle sections, current maturity boundary and a 17-case matrix covering happy path, policy decline, evidence failure, provider timeout, replay, stale versions, tenant/role/self-approval violations, revocation, reconciliation/accounting failures, delinquency, cancellation, closure, rollback and audit replay. Content lives in `apps/help/technical-academy/content/`; generated HTML is never edited directly.

The journey UX contract is shared across all 21 products: a scannable catalogue card, maturity badge, blueprint summary, responsive stage diagram, fact/evidence chips, journey-level regulatory-control cards, six lifecycle cards, evidence/readiness panels, progressively disclosed adverse cases and source links. The drift gate rejects a journey that falls back to the legacy sticky contents sidebar or wide case table.

## Build and governance

`node scripts/build-technical-academy.mjs` validates source references and the 21-row journey matrix before generating static pages. `--check` is the drift gate. The course stores no learner data and inherits the canonical/tenant-overlay boundary in `docs/architecture/help-centre-and-academy.md`.

Any structural platform change reopens the affected session. Journey changes must reconcile the contract registry, support matrix and journey lesson together. Compliance, security, deployment and production-admission sessions require the relevant control owner before advancing their verification date.
