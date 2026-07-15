# LoanOS India Documentation

This folder is the working documentation set for the LoanOS India build. It explains what we are building, why we are building it this way, what is already implemented, and what remains.

## Start Here

1. [What we are building](/Users/nisheethranjan/Projects/AIBank/docs/product/what-we-are-building.md)
2. [LoanOS architecture blueprint](/Users/nisheethranjan/Projects/AIBank/docs/architecture/loanos-india-blueprint.md)
3. [India regulatory register](/Users/nisheethranjan/Projects/AIBank/docs/compliance/india-regulatory-register.md)
4. [Current implementation map](/Users/nisheethranjan/Projects/AIBank/docs/architecture/current-implementation.md)
5. [Complete-system capability catalogue](/Users/nisheethranjan/Projects/AIBank/docs/product/complete-system-capability-catalog.md)
6. [Platform module integration and API map](/Users/nisheethranjan/Projects/AIBank/docs/architecture/platform-module-integration-api-map.md)
7. [Build backlog](/Users/nisheethranjan/Projects/AIBank/docs/product/build-backlog.md)

## Documentation Map

| Document | Purpose |
| --- | --- |
| [What we are building](/Users/nisheethranjan/Projects/AIBank/docs/product/what-we-are-building.md) | Product definition, users, modules, scope, non-goals, and success criteria. |
| [Complete-system capability catalogue](/Users/nisheethranjan/Projects/AIBank/docs/product/complete-system-capability-catalog.md) | Canonical exhaustive target capability register across lending, operations, accounting, risk, compliance, technology, and product-specific journeys, with current maturity classifications. |
| [Product journey support matrix](/Users/nisheethranjan/Projects/AIBank/docs/product/product-journey-support-matrix.md) | Evidence-tier status for the 21 public journeys, their implemented platform boundary, tenant-specific activation requirements, and remaining production gaps. |
| [Capability & build dashboard](/Users/nisheethranjan/Projects/AIBank/docs/dashboard.md) | How `docs/dashboard.html` is generated: plane/category/feature status view, completion scoring, product-plane mapping, and how it auto-updates on `./loanos.sh build`. |
| [Roadmap](/Users/nisheethranjan/Projects/AIBank/docs/product/roadmap.md) | Phased delivery plan from compliance foundation to AI governance hardening. |
| [Build backlog](/Users/nisheethranjan/Projects/AIBank/docs/product/build-backlog.md) | Actionable engineering backlog grouped by epic. |
| [Architecture blueprint](/Users/nisheethranjan/Projects/AIBank/docs/architecture/loanos-india-blueprint.md) | Target architecture across LOS, LMS, LWS, and compliance control plane. |
| [Platform module integration and API map](/Users/nisheethranjan/Projects/AIBank/docs/architecture/platform-module-integration-api-map.md) | Complete external dependency map organised by channels, LOS, decision/risk, LWS, LMS, collections, collateral, finance, compliance, partners, platform and SaaS organisation admission, with stable IDs, lifecycle trigger, direction and current state. |
| [Integration and Indian vendor procurement catalogue](/Users/nisheethranjan/Projects/AIBank/docs/architecture/integration-vendor-procurement-catalog.md) | Required API/event/file contracts, including organisation admission and tenant provisioning, mock gaps, Indian vendor candidates, commercial units, dated public prices and RFQ requirements. |
| [SaaS tenancy and operating model](/Users/nisheethranjan/Projects/AIBank/docs/architecture/saas-tenancy-and-operating-model.md) | Multi-tenant SaaS delivery: tenant isolation, audit spine, tenant lifecycle, and LoanOS's own vendor-compliance posture. |
| [RE tenant onboarding and product administration](/Users/nisheethranjan/Projects/AIBank/docs/architecture/re-tenant-onboarding-and-product-administration.md) | Self-service RE bootstrap, built-in/future/custom product templates, organisation/users/channels/partners/integrations, finance/compliance, UAT/go-live and continuous tenant administration. |
| [Organisation signup and bootstrap identity](/Users/nisheethranjan/Projects/AIBank/docs/architecture/organisation-signup-and-bootstrap-identity.md) | Greenfield organisation admission, verified first owner, next-user lifecycle, canonical roles/SoD, tenant provisioning and activation architecture. |
| [Organisation signup detailed design](/Users/nisheethranjan/Projects/AIBank/docs/architecture/organisation-signup-detailed-design.md) | State, data, API, concurrency, security, identity, role, provisioning and exhaustive test design for the public-to-production journey. |
| [Organisation signup operations](/Users/nisheethranjan/Projects/AIBank/docs/architecture/organisation-signup-operations.md) | Admission, EDD, identity, provisioning, incident, recovery, reverification, RACI, SLO and go-live operating runbook. |
| [Tenant role, staffing, federation and activity attribution](/Users/nisheethranjan/Projects/AIBank/docs/architecture/tenant-role-staffing-and-feature-gating.md) | Exhaustive canonical roles, 34 feature staffing baselines, assignment/revocation authority, IdP/SCIM and agent rules, immediate containment, activity lineage, edge cases and production gaps. |
| [Federated access and forensic-custody operations](/Users/nisheethranjan/Projects/AIBank/docs/architecture/federated-access-and-forensic-custody-operations.md) | OIDC/SAML/SCIM runtime, MFA/WebAuthn/device assurance, universal mutation rollout, isolated mTLS/KMS control fleet, activity WORM custody, incident and acceptance runbooks. |
| [Platform admission regulatory control map](/Users/nisheethranjan/Projects/AIBank/docs/compliance/platform-admission-control-map.md) | Official-source RBI/Indian control mapping for organisation and representative verification, misuse prevention and the borrower-KYC boundary. |
| [Decision engine design](/Users/nisheethranjan/Projects/AIBank/docs/architecture/decision-engine-design.md) | Pure-Rust decision engine: per-tenant isolated runtimes, decision contract, invariants, kill-switch enforcement, agent guardrails, security threat model, and phased delivery plan (PH-0..5 all implemented). Source of truth for engine implementation. |
| [Agentic AI digital workers on AWS](/Users/nisheethranjan/Projects/AIBank/docs/architecture/agentic-ai-digital-workers.md) | Investigated target architecture, worker catalogue, autonomy boundaries, AWS/Strands framework decision, India-residency controls, regulatory status map, governance lifecycle, and phased delivery plan for bounded digital workers. |
| [Decision engine operations](/Users/nisheethranjan/Projects/AIBank/rules/README.md) | Developer/operator guide: crate map, build and test, local fleet (sign/up/health/kill-switch), replay canary, API integration modes. |
| [AWS synthetic demo deployment](/Users/nisheethranjan/Projects/AIBank/deploy/aws/README.md) | End-to-end disposable, credit-conscious CloudFormation demo: packaging, bootstrap, applications, updates, external-DNS custom domains, troubleshooting, and teardown; synthetic data only. |
| [Agent guide](/Users/nisheethranjan/Projects/AIBank/AGENTS.md) | Orientation for AI coding agents and new engineers: architecture map, load-bearing documents, non-negotiable engineering rules, commands. (`CLAUDE.md` imports it.) |
| [Current implementation map](/Users/nisheethranjan/Projects/AIBank/docs/architecture/current-implementation.md) | What code exists today, how it runs, and where each current control lives. |
| [Governed digital origination journey](/Users/nisheethranjan/Projects/AIBank/docs/architecture/origination-journey.md) | Borrower self-service intake, product-driven document controls, conditions precedent, sanction validity, KFS language evidence, fail-closed gates, and production boundaries. |
| [Provider integration governance](/Users/nisheethranjan/Projects/AIBank/docs/architecture/provider-integration-governance.md) | Certification lifecycle, live-readiness gates, India-residency posture, provider transports, signed callbacks, and external onboarding boundaries. |
| [Audit integrity and data governance](/Users/nisheethranjan/Projects/AIBank/docs/architecture/data-governance.md) | External-anchor evidence, business-event completeness, evidence custody/legal hold/deletion proof, field lineage, and data-quality certification. |
| [Enterprise security and scale control plane](/Users/nisheethranjan/Projects/AIBank/docs/architecture/enterprise-security-and-scale.md) | Federation/SCIM, managed-key and SIEM custody evidence, PostgreSQL HA/PITR/capacity, API/event/webhook governance, and deployment-automation readiness. |
| [Tenant identity operations and conformance lab](/Users/nisheethranjan/Projects/AIBank/docs/architecture/identity-operations-and-conformance-lab.md) | Canonical IAM administration workspace, federation rotation/suspension, signed provider logout, explicit session revocation, maker-checker recovery, operational runs, resilience drills and identity/enterprise/admission simulator packs. |
| [Risk, AML, fraud, and model-monitoring control plane](/Users/nisheethranjan/Projects/AIBank/docs/architecture/risk-aml-fraud-governance.md) | Ongoing CDD/rescreening, transaction monitoring, fraud scoring, portfolio limits/stress, RCSA, recurring model reports, and risk-committee packs. |
| [Implementation, migration, and go-live governance](/Users/nisheethranjan/Projects/AIBank/docs/architecture/implementation-migration-go-live.md) | Configuration/mapping, conversion reconciliation, balance validation, parallel run, UAT/training, readiness, cutover/rollback, and hypercare exit. |
| [Institutional governance and configurable operations](/Users/nisheethranjan/Projects/AIBank/docs/architecture/institutional-operations.md) | RE programme/hierarchy, regulatory applicability/obligations, business calendars, configurable workflows/approvals, workforce, bulk action and exception taxonomy. |
| [Customer and channel experience operations](/Users/nisheethranjan/Projects/AIBank/docs/architecture/customer-channel-experiences.md) | Governed branch/partner intake, lead matching/routing/lifecycle, party graph, merge plans, customer preferences, succession, customer-360, and privacy-safe PWA boundary. |
| [Observability operations](/Users/nisheethranjan/Projects/AIBank/docs/architecture/observability-operations.md) | Runtime SLI/SLO, provider/stuck-work monitoring, access surfaces, initial response, and production telemetry gaps. |
| [Backup, DR, and BCP operations](/Users/nisheethranjan/Projects/AIBank/docs/architecture/recovery-operations.md) | Encrypted recovery packages, validation/restore controls, RTO/RPO exercises, operator procedure, and production recovery gaps. |
| [Release, configuration, and resilience operations](/Users/nisheethranjan/Projects/AIBank/docs/architecture/delivery-operations.md) | Governed releases/canaries/rollback, secret-safe configuration drift/parity, bounded HTTP probes, and production automation gaps. |
| [Service operations and vendor oversight](/Users/nisheethranjan/Projects/AIBank/docs/architecture/service-operations.md) | Support SLA/on-call/escalation/problem controls, vendor review/SLA/concentration evidence, operating procedure, and production integration gaps. |
| [Secure SDLC and vulnerability assurance](/Users/nisheethranjan/Projects/AIBank/docs/architecture/security-assurance.md) | Artifact-bound scan/SBOM evidence, vulnerability SLA/remediation/exception controls, release gate, and production security-tooling gaps. |
| [SIEM, SOC, and security investigation operations](/Users/nisheethranjan/Projects/AIBank/docs/architecture/security-operations.md) | Detection/alert SLA, investigation and evidence-chain controls, logging coverage, response procedure, and production SOC gaps. |
| [Compliance control assurance and audit workspace](/Users/nisheethranjan/Projects/AIBank/docs/architecture/control-assurance.md) | Control plans/tests/issues/certifications, audit and RBI evidence requests, committee packs, operating procedure, and production GRC gaps. |
| [India regulatory register](/Users/nisheethranjan/Projects/AIBank/docs/compliance/india-regulatory-register.md) | Source-grounded control families and implementation anchors. |
| [Compliance build checklist](/Users/nisheethranjan/Projects/AIBank/docs/compliance/compliance-build-checklist.md) | Regulatory control-to-platform checklist with build status. |
| [Decision records](/Users/nisheethranjan/Projects/AIBank/docs/decisions/0001-india-only-compliance-first.md) | Architecture decisions and why they were made. ADR 0002 covers multi-tenant SaaS, ADR 0003 the per-tenant decision engine, ADR 0004 verified bootstrap identity, and ADR 0005 the isolated per-tenant platform-control policy engine. |
| [GTM asset library](/Users/nisheethranjan/Projects/AIBank/docs/gtm/README.md) | Go-to-market library for Sales & Marketing (humans + AI agents): strategy, sales playbook/scripts, marketing, brand guide, AI-agent runbooks, and automation. Kept in sync with the product via a claims↔backlog matrix and a claims-discipline check script. |
| [GTM operating model](/Users/nisheethranjan/Projects/AIBank/docs/gtm/operating-model.md) | The human ↔ AI-agent GTM process: end-to-end flow, agent orchestration, human-in-the-loop checkpoints, RACI, and maintenance cadence. |
| [Public-site content operations](/Users/nisheethranjan/Projects/AIBank/docs/gtm/marketing/public-site-operations.md) | Fast, governed human and AI workflow for drafting, reviewing, validating and approving public-site updates. |

## Definition of Done for Documentation

A feature is not considered complete unless it updates the relevant docs:

- Product behavior: update `docs/product/`.
- Architecture or service ownership: update `docs/architecture/`.
- Compliance or risk control: update `docs/compliance/`.
- Major irreversible technical choice: add a decision record under `docs/decisions/`.
- Externally-visible capability that changes what Sales/Marketing may claim: update the claim's Status/Evidence in `docs/gtm/strategy/claims-and-backlog-sync.md` and re-run `node docs/gtm/automation/gtm-backlog-sync.mjs`.
