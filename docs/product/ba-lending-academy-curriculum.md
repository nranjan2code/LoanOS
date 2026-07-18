# BA Lending Academy — Curriculum Design

The BA Lending Academy is a complete, end-to-end training course on Indian regulated lending — LOS, LMS, LWS, collections, partnerships and the compliance control plane — taught through LoanOS itself. It lives inside the canonical LoanOS Guide & Academy (`apps/help/academy/`) and is published as generated, cross-linked static tutorial pages at `/help/academy/`.

This document is the curriculum's source of truth: audience, learning outcomes, module map, per-lesson content contract, citation rules and the build pipeline. The architecture boundary for the guidance surface remains `docs/architecture/help-centre-and-academy.md`.

## Audience and intent

Primary audience: business analysts (LoanOS or regulated-entity implementation teams) who must understand the *business* of Indian lending — the processes, the regulatory reasons behind them, and where each obligation is realised in the platform. Secondary audiences: new product managers, implementation consultants, and onboarding operations staff.

The course teaches process and regulation, not software operation. Task-level "how do I click" guidance stays in the Guide's operating articles; the Academy explains *why the process exists*, asks the learner to apply the control to a realistic decision and cites where the platform enforces it.

## Learning outcomes

A BA who completes the course can:

1. Name the RBI-regulated entity types, the digital lending operating model (RE / LSP / DLA), and why accountability never leaves the regulated entity.
2. Walk a loan from consent → KYC → underwriting → KFS → sanction → disbursement → servicing → collections → closure and state the control and evidence produced at each step.
3. Map every major process step to its regulatory control family in `docs/compliance/india-regulatory-register.md` and to its platform capability in `docs/product/complete-system-capability-catalog.md`.
4. Explain LMS mechanics: ledger, amortisation, interest accrual, penal charges as charges, floating-rate resets, prepayment and foreclosure.
5. Explain delinquency classification (DPD, SMA, NPA), collections conduct rules, legal recovery tracks and resolution paths (restructure, settlement, write-off, closure).
6. Explain LWS: maker-checker, task queues, SLA clocks, grievance redressal (30-day clock, RBI CMS) and fraud case handling.
7. Explain partner economics: LSP governance, DLG caps and invocation, co-lending shares/retention/escrow.
8. Read a capability status (Implemented / Partial / Mock) and use the platform's maturity language correctly — a lesson existing is not evidence of production readiness.

## Module map

Fifteen modules, seventy-eight lessons. Order follows the lending lifecycle, then closes the previously implicit BA knowledge areas—product/party/document design, the shared lending term set, collateral/finance/reporting and delivery practice—before the per-journey deep dives and capstone.

| # | Module | Lessons |
| --- | --- | --- |
| 1 | Foundations: the Indian lending landscape | Regulated entities and the RBI perimeter · The digital lending operating model · The regulatory map · From circular to control |
| 2 | LOS I — Acquisition, consent and KYC | Acquisition and neutral offers · Consent and DPDP · KYC and CDD · Application risk and fraud screening |
| 3 | LOS II — Credit data and decisioning | Credit data: CICs and Account Aggregator · Credit policy as data · Referrals, overrides and maker-checker · AI-assisted decisions |
| 4 | LOS III — KFS, sanction and disbursement | The Key Facts Statement · Sanction and contracting · Disbursement and direct fund flow |
| 5 | LMS — The live loan account | Loan account and ledger · Schedules, EMI and interest · Payments, mandates and reconciliation · Servicing events |
| 6 | Collections and recovery | DPD, SMA and NPA · Collections operations and conduct · Legal recovery · Restructuring, settlement, write-off and closure |
| 7 | LWS — Workflow and human control | Queues, SLA and attribution · Maker-checker and committees · Grievance and fraud cases |
| 8 | Partnerships and product families | LSP and DLA governance · Default Loss Guarantee · Co-lending · Product families |
| 9 | Compliance operations, data and AI governance | Audit chain and evidence packs · CIC reporting · Data protection operations · Model and AI governance |
| 10 | Product, pricing, parties and documents | Product architecture · Pricing and economics · Party model · Document lifecycle · Communications and accessibility |
| 11 | The lending term set | Facilities and drawdowns · Security and credit support · Cash-flow and pricing terms · Working-capital and trade terms · Asset quality and resolution · Control and evidence terms |
| 12 | Secured lending, finance and portfolio control | Collateral lifecycle · Security perfection · Accounting and reconciliation · Portfolio and regulatory reporting |
| 13 | Business analysis practice for lending | Scope and stakeholders · Process/state modelling · Data and migration · Control requirements · Acceptance/UAT · Change and rollout |
| 14 | The 21 product journeys: deep dives | One lesson per canonical journey — personal loan through trade finance, co-lending and working capital (module id `journeys`) |
| 15 | Capstone | Trace one compliant loan end to end · The BA toolkit (module id `m10-capstone`; display numbers derive from course order) |

## Lesson content contract

Curriculum content is data, not markup — one ES module per course module under `apps/help/academy/content/`, aggregated by `content/course.mjs`. Every lesson must provide:

| Field | Rule |
| --- | --- |
| `id`, `title`, `duration` | Stable kebab-case id, unique within the course. |
| `objectives` | 2–4 outcome statements ("you can …"). |
| `sections` | 2–6 `{ heading, body }` narrative sections. Body supports paragraphs, `- ` lists, `1. ` lists and `**bold**` only. |
| `regulatory` | ≥ 1 anchor: `{ id, note }` where `id` is a control-family ID from the India regulatory register (e.g. `RBI-KFS-2024`). |
| `platform` | ≥ 1 citation: `{ type: doc\|code\|capability\|surface\|guide, ref, note }`. `capability` refs are catalogue IDs (e.g. `CLL-006`); `guide` refs are Guide article ids; `surface` refs are served app paths. |
| `terms` | Glossary terms used in the lesson; each must exist in the course glossary. |
| `related` | Cross-links to other lessons as `module-id/lesson-id`; must resolve. |
| `check` | ≥ 1 knowledge-check question `{ q, options, answer, why }`. |
| `journeyType` | Journey deep-dive lessons only: a canonical journey type from `packages/core/src/journeys/product-journey-contracts.js`. The build derives the lesson's journey-contract panel (archetype, facility, security, required facts/evidence, servicing capabilities, contract id and checksum) directly from that module and the platform-support panel from `docs/product/product-journey-support-matrix.md`, so structural detail cannot drift from the shipped contracts. Both references are validated; a missing contract or matrix row fails the build. |

Citation rules:

- Regulatory claims cite the control-family ID; the register (not the lesson) owns the source URL and legal caveats.
- Platform claims must respect maturity: cite the capability ID and let its catalogue status speak. Lessons must never state or imply production readiness that the catalogue and journey support matrix do not.
- Every page carries the standing disclaimer: educational content, not legal advice, verify against the register and counsel before relying on it.

The renderer supplies the shared lesson frame around this content contract: course position and duration, outcomes, a short learning rhythm, linked contents, focused narrative chunks, regulatory and platform panels, key terms, retrieval-practice instructions, answer reasoning, related lessons and previous/next navigation. Checks are for learning feedback, not formal assessment or certification. Learners should answer before revealing the explanation.

## Build pipeline

`scripts/build-academy.mjs` (Node, ESM, no dependencies) is the only writer of published pages:

1. Loads `apps/help/academy/content/course.mjs`.
2. Validates the full contract above — unique ids, resolvable `related` links, known regulatory IDs (against the register file), known glossary terms, minimum citations and checks. Validation failure stops the build; no partial output.
3. Emits static pages under `apps/help/academy/`: course home (`index.html`), one module page per module, one page per lesson, and `glossary.html`. Lesson pages carry breadcrumbs, course position, previous/next lesson navigation, linked in-page contents, "Where this lives in LoanOS" citation panels, glossary term links, active-recall instructions and related-lesson links. Course, module and lesson headers use subject-relevant, human-led Indian photography shared with the public site and portals; journey lessons resolve to the matching product photograph. Academy-only photographs live under `apps/help/academy/assets/images/`, use descriptive alternative text and are preserved across generated-page rebuilds.
4. `--check` verifies the committed pages are byte-identical to a fresh render (drift gate for CI and reviews).

Commands: `npm run academy:build` (render) and `npm run academy:check` (drift gate). Generated files carry a do-not-edit header; content changes happen only in `content/*.mjs` followed by a rebuild. Pages are static, self-contained, use the shared design tokens, and store nothing in the browser. Because `apps/help` is a whole-directory entry in `deploy/aws/demo-package-manifest.txt`, the rendered course ships with the AWS showcase without packaging changes.

## Governance

- Each lesson records a `verified` date. A change to a cited process, control or capability re-opens the lesson: update content, re-verify, rebuild.
- Compliance-sensitive lessons (modules 1, 4, 6, 8, 9) require control-owner review before the verification date is advanced, matching the Guide's definition of done.
- Tenant-authored overlays remain out of scope, exactly as in the Guide & Academy architecture contract; the course is LoanOS-canonical content.
- Tests (`tests/ba-academy.test.js`) enforce the content contract, link integrity and render drift so the course cannot silently rot.
