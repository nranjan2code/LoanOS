# LoanOS Guide and Academy

The LoanOS Guide and Academy is the platform-owned, task-based user guidance surface at `/help/`. It translates the repository's technical, product and compliance sources into role-aware operating guidance without replacing those sources of truth.

## Current boundary

The first release is a canonical LoanOS experience for regulated-entity staff and LoanOS operators. It includes searchable guides, responsibility-based learning paths, control-impact labels and sandbox-first guidance. The `/help/` responsibility catalogue pairs the BA and Technical Academy foundations with eight operational paths. Each path states the work owned, then opens a four-module curriculum with applied judgement prompts, a realistic case, a control checkpoint, relevant verified guides and estimated study time. Role and guide views have stable fragment routes, participate in browser Back/Forward history, retain the originating responsibility when opening a task guide and expose an in-path curriculum/case/guides navigator. Guide articles add a before-you-begin boundary, linked contents and a safe-completion self-check. Content is shipped with the application and does not accept tenant-authored material.

Borrower guidance remains part of the customer-channel experience and must not be mixed with institutional operating instructions.

## Content contract

Every published guide records:

- stable identifier, title, summary and category;
- intended roles;
- platform availability and environment boundary;
- control or approval impact;
- estimated completion time and last verification date;
- task steps, expected evidence, exceptions and production boundaries.

## Learning experience contract

The Guide and both Academies use one learner-centred rhythm: **orient → explain → apply → check**.

- Orient before detail: identify audience or task, intended outcome, position in the sequence, estimated time, environment and verification date.
- Explain in focused chunks: descriptive headings, one main idea per paragraph, readable line lengths and real contents links. Dense inventories use progressive disclosure; essential controls do not.
- Apply with judgement: every responsibility path or course session includes a realistic task, adverse path, evidence decision or source trace. Sandbox exercises use synthetic data.
- Check from memory: BA lessons use answer-and-reasoning knowledge checks; technical sessions use active-recall prompts tied to tenant, authority, failure and evidence boundaries; Guide tasks end with a completion check.
- Preserve focus and access: keyboard-visible focus, usable mobile navigation, minimum comfortable body text, reduced-motion support, session-only focus mode, reading progress and current-section indication are shared interaction requirements.
- Preserve orientation across cross-links: every Academy page exposes an explicit Back action. Academy links carry a validated same-origin return path; Back uses that context first, same-origin history second and course home for direct entry. Breadcrumbs show hierarchy; Back returns to learner context. Both are required because lessons, journeys, atlases and architecture pages are deliberately interlinked. Return context lives only in the URL and is not learner tracking.

Learning aids store no learner state. Progress display describes the current page or course position only; it must not imply completion, competence or certification. Formal learner records, assessment attempts and certification remain deferred LMS capabilities. The authoring and review workflow is documented in `apps/help/README.md`.

The existing product, architecture, compliance and decision-record documents remain authoritative. User guidance must use the maturity language from `product/product-journey-support-matrix.md`; a guide existing is not evidence of production readiness.

## BA Lending Academy course surface

The Academy additionally publishes the BA Lending Academy — an end-to-end Indian-lending training course (LOS, LMS, LWS, collections, partnerships, compliance operations) for business analysts — at `/help/academy/`. The curriculum design, module map, per-lesson content contract and governance live in `docs/product/ba-lending-academy-curriculum.md`.

Course pages are generated, never hand-edited: curriculum content is data under `apps/help/academy/content/`, and `scripts/build-academy.mjs` validates the contract (regulatory anchors against the India regulatory register, capability citations against the capability catalogue, guide references against published Guide articles, glossary and cross-link integrity) before rendering static, cross-linked pages. `npm run academy:build` renders; `npm run academy:check` is the drift gate; `tests/ba-academy.test.js` enforces both in CI. The course inherits this document's boundaries: LoanOS-canonical content only, no tenant-authored material, no browser storage, maturity language deferred to the capability catalogue and journey support matrix.

The BA Academy shares the human-led photographic language of the public site and operating portals. Images must be specific to the learning subject, show credible Indian borrower or operator contexts, carry useful alternative text, and never substitute decorative fintech imagery for an explanation. Existing shared/public photography is reused where the subject matches; Academy-only onboarding, servicing and collections scenes live in `apps/help/academy/assets/images/`. Product-journey lessons use the corresponding public product image so the same journey is represented consistently across marketing and training surfaces. The generator resolves every mapped image to a committed asset and fails the build when one is absent. Technical learning uses accessible generated flows and architecture diagrams where those communicate system relationships more accurately than photography.

## Technical Academy course surface

The Technical Academy at `/help/technical-academy/` is the system-level companion to the BA course. Its curriculum contract is `docs/product/technical-academy-curriculum.md`; structured content lives under `apps/help/technical-academy/content/`. It covers the product definition, architecture, code/runtime boundaries and every complete-system capability family: channel surfaces, customers/parties, consent, KYC/AML, fraud, documents, APIs, persistence, lending, collateral, payments, product and partner administration, institutional finance/risk, customer protection, regulatory reporting, field delivery, implementation, integrations, security and operations. The Rules Engine is a dedicated module rather than a lesson inside general controls: it follows policy from typed model and signed bundle through exact deterministic evaluation, isolated per-tenant business/control runtimes, replay, testing and fleet operations. All 21 canonical product contracts generate their own detailed journey lesson with contract facts/evidence, lifecycle, API/state/evidence map, maturity boundary and mandatory adverse-case matrix; shared casebooks cover failure handling and production certification. Every session carries a generated accessible SVG flow and direct repository sources.

`npm run technical-academy:build` renders the static 12-module, 71-session course and `npm run technical-academy:check` verifies drift. The generator validates cited sources and requires the canonical journey support matrix to contain all 21 journeys. Like the BA course, it is explanatory and does not elevate any capability or journey to production-ready.

The Technical Academy Capability Atlas at `/help/technical-academy/capability-atlas/` is generated directly from the complete-system capability catalogue. It exposes every individual capability ID, applicability and maturity status across all 33 families and links each family to its primary technical lesson. Generation fails closed unless all 463 unique catalogue records render, all family mappings resolve and no capability ID is duplicated.

The Enterprise Architecture Explorer at `/help/technical-academy/architecture/` is the Academy's visual orientation layer. It presents the complete system as six flat, navigable layers—from experiences and lending journeys through domains, decision controls, platform/data and operations. Each subsystem links to its canonical Technical Academy session, and responsibility filters help product, risk, operations, engineering, security, finance and implementation personas find the relevant learning without changing the underlying architecture or maturity claims.

The Integration Atlas at `/help/technical-academy/integration-atlas/` is generated from the canonical platform module integration and API map. It covers all 115 identified external boundaries across 12 domains: customer/channels, origination, risk, workflow, servicing, collections, collateral, finance, regulators, partners, platform infrastructure and organisation admission. Every record states the required external operations, direction/response, current implementation boundary, consuming modules, fail-closed behavior and certification/production checklist. The generator rejects missing or duplicate integration IDs; the procurement catalogue remains authoritative for vendor candidates and commercial assumptions.

## Future tenant and regulated-entity customization

Customization is intentionally deferred. A future overlay must:

1. resolve content by tenant and regulated entity without cross-tenant reads;
2. distinguish immutable LoanOS control guidance from tenant-authored operating notes;
3. require role-based authoring and maker-checker publication;
4. retain version, effective date, approval, supersession and audit lineage;
5. filter by entitled modules and staffed roles;
6. fail closed to canonical guidance when an overlay is missing, expired or unauthorized;
7. prevent tenant text from weakening platform or regulatory controls;
8. provide a preview and sandbox validation step before publication.

Formal assessment, certification expiry and external LMS interoperability may be added later. They should consume the same governed content identifiers rather than create a second manual.

## Definition of done

A user-visible workflow change is incomplete until its relevant guide is updated or explicitly marked unavailable. Compliance-sensitive guidance requires control-owner review. Release validation checks links, course counts, metadata, maturity labels, verification dates, linked contents, active-recall or completion checks, keyboard focus, readable responsive layouts and the no-browser-storage boundary.
