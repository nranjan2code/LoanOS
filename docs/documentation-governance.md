# Documentation Governance and Audit

This document defines how LoanOS keeps human guidance and AI-agent context aligned with the executable platform. It also records the latest repository-wide documentation audit.

## Audience and source hierarchy

| Audience | Primary entry point | Purpose |
| --- | --- | --- |
| Platform users | `/help/` Guide and Academy | Task guidance, learning paths, expected evidence and recovery instructions |
| Borrowers | Tenant customer portal | Plain-language application, document, repayment, grievance and privacy guidance |
| Product, implementation and compliance teams | `docs/README.md` | Product scope, maturity, architecture, controls, operations and delivery evidence |
| Engineers and AI coding agents | `AGENTS.md` | Repository map, load-bearing sources, invariants, commands and conventions |
| Demo operators and solution consultants | `docs/operations/demo-handbook.md`, `docs/architecture/aws-showcase-deployment.md` and `deploy/aws/README.md` | Synthetic-only showcase/workshop operation, technical contract, command procedure, claims boundaries, recovery and teardown |
| Sales, marketing and customer success | `docs/gtm/README.md` | Approved claims, playbooks, onboarding and customer-success operations |

When sources disagree, executable policy and load-bearing architecture/control documents take precedence. The Guide and Academy explains how to operate the system; it cannot grant authority, change a policy outcome or establish production readiness.

## Required update matrix

This matrix has a machine-checkable form in
[documentation-governance-rules.json](documentation-governance-rules.json),
evaluated diff-aware by `npm run currency:check`
([check-currency.mjs](../scripts/check-currency.mjs)). It is advisory: it nudges
the author when a companion document looks stale, it does not block. The
identifier schemes these documents share are catalogued in the
[identifier registry](identifier-registry.md).

| Change | Required documentation |
| --- | --- |
| User-visible workflow or error | Guide article, verification date and current implementation map |
| Product capability or maturity | Capability catalogue, evidence trace, journey matrix where applicable, roadmap/backlog |
| Architecture or service boundary | Architecture document and current implementation map |
| Compliance/control interpretation | Regulatory register or control document plus Guide control note where user action is affected |
| Irreversible technical decision | ADR |
| Public capability claim | Claims/backlog register and relevant public content |
| Repository layout, command or agent rule | `AGENTS.md` |
| Demo seed, deployment, artifact, domain, mock, persona or operating flow | AWS showcase architecture, demo handbook, AWS runbook, current implementation map, `AGENTS.md`, and sales demo script/claim register when externally visible |
| Tenant/RE customization | Help-centre architecture, authorization model, audit lineage and isolation tests |

## Audit record — 2026-07-16

Scope: all Markdown under `docs/`, the root `AGENTS.md`, public and authenticated frontend navigation, the capability catalogue/trace system, and the GTM claim register.

Checks completed:

- all Markdown documents are reachable from `docs/README.md` and have valid local links;
- canonical technical, product, compliance, decision and GTM collections remain separated by audience and purpose;
- the Guide and Academy is represented in the architecture index, implementation map, product definition, capability catalogue, backlog, roadmap and claim register;
- human and AI-agent entry points identify the new guidance surface and its documentation obligation;
- platform navigation exposes the guide from the public resource room, public navigation, tenant landing and authenticated staff workspace;
- product maturity remains conservative: the guide does not promote any lending journey to production-ready;
- tenant/RE customization is explicitly future work and cannot yet introduce unreviewed content.
- the generation-2 AWS showcase now has a canonical architecture contract,
  command-level runbook and operator handbook, all linked from the repository,
  architecture and operations indexes and from `AGENTS.md`;
- the release boundary is explicit: committed source, manifest-selected
  server/browser paths, immutable checksum-bound S3 releases, zero Android
  content, first-boot-only bootstrap, SSM updates, health restoration and
  fail-closed schema handling; and
- the synthetic showcase/workshop operating model remains separate from
  production operations, with explicit mock, tenant-engine, credential, DNS,
  cost, evidence and teardown boundaries.

Result: the repository documentation set is structurally aligned for the
current Guide and Academy and generation-2 synthetic showcase slices. This is
not a permanent certification that every statement will remain current.
Currency is maintained through the change matrix, automated integrity/evidence
checks and named verification dates on user guidance and deployment contracts.

## Known follow-on work

- Move guide content from the frontend controller to a governed content store with stable schemas and approval history.
- Add automated checks for required guide metadata, expired verification dates and route-to-guide coverage.
- Add tenant/RE overlay authoring only with tenant isolation, immutable canonical sections, maker-checker publication and audit evidence.
- Add role assignments, assessments, completion evidence and expiring certification before describing the Academy as a full LMS.
- Add CI enforcement that builds the selective AWS archive and proves that its
  sidecar, contents, Android exclusion and local-document links are valid.
- Define reviewed expand/contract database migrations, backup/restore rehearsal
  and rollback compatibility before allowing in-place showcase schema updates.
- Define release retention and S3 lifecycle policy only after preserving the
  evidence window required for demonstrations and troubleshooting.
