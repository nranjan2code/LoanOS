# Documentation Governance and Audit

This document defines how LoanOS keeps human guidance and AI-agent context aligned with the executable platform. It also records the latest repository-wide documentation audit.

## Audience and source hierarchy

| Audience | Primary entry point | Purpose |
| --- | --- | --- |
| Platform users | `/help/` Guide and Academy | Task guidance, learning paths, expected evidence and recovery instructions |
| Borrowers | Tenant customer portal | Plain-language application, document, repayment, grievance and privacy guidance |
| Product, implementation and compliance teams | `docs/README.md` | Product scope, maturity, architecture, controls, operations and delivery evidence |
| Engineers and AI coding agents | `AGENTS.md` | Repository map, load-bearing sources, invariants, commands and conventions |
| Sales, marketing and customer success | `docs/gtm/README.md` | Approved claims, playbooks, onboarding and customer-success operations |

When sources disagree, executable policy and load-bearing architecture/control documents take precedence. The Guide and Academy explains how to operate the system; it cannot grant authority, change a policy outcome or establish production readiness.

## Required update matrix

| Change | Required documentation |
| --- | --- |
| User-visible workflow or error | Guide article, verification date and current implementation map |
| Product capability or maturity | Capability catalogue, evidence trace, journey matrix where applicable, roadmap/backlog |
| Architecture or service boundary | Architecture document and current implementation map |
| Compliance/control interpretation | Regulatory register or control document plus Guide control note where user action is affected |
| Irreversible technical decision | ADR |
| Public capability claim | Claims/backlog register and relevant public content |
| Repository layout, command or agent rule | `AGENTS.md` |
| Tenant/RE customization | Help-centre architecture, authorization model, audit lineage and isolation tests |

## Audit record — 2026-07-15

Scope: all Markdown under `docs/`, the root `AGENTS.md`, public and authenticated frontend navigation, the capability catalogue/trace system, and the GTM claim register.

Checks completed:

- all Markdown documents are reachable from `docs/README.md` and have valid local links;
- canonical technical, product, compliance, decision and GTM collections remain separated by audience and purpose;
- the Guide and Academy is represented in the architecture index, implementation map, product definition, capability catalogue, backlog, roadmap and claim register;
- human and AI-agent entry points identify the new guidance surface and its documentation obligation;
- platform navigation exposes the guide from the public resource room, public navigation, tenant landing and authenticated staff workspace;
- product maturity remains conservative: the guide does not promote any lending journey to production-ready;
- tenant/RE customization is explicitly future work and cannot yet introduce unreviewed content.

Result: the repository documentation set is structurally aligned for the current Guide and Academy slice. This is not a permanent certification that every statement will remain current. Currency is maintained through the change matrix, automated integrity/evidence checks and named verification dates on user guidance.

## Known follow-on work

- Move guide content from the frontend controller to a governed content store with stable schemas and approval history.
- Add automated checks for required guide metadata, expired verification dates and route-to-guide coverage.
- Add tenant/RE overlay authoring only with tenant isolation, immutable canonical sections, maker-checker publication and audit evidence.
- Add role assignments, assessments, completion evidence and expiring certification before describing the Academy as a full LMS.
