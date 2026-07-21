# LoanOS India Documentation

This folder is the working documentation set for the LoanOS India build. It explains what we are building, why we are building it this way, what is already implemented, and what remains.

## Start Here

1. [Product documentation](product/README.md)
2. [LoanOS architecture blueprint](architecture/loanos-india-blueprint.md)
3. [India regulatory register](compliance/india-regulatory-register.md)
4. [Current implementation map](architecture/current-implementation.md)
5. [Complete-system capability catalogue](product/complete-system-capability-catalog.md)
6. [Platform module integration and API map](architecture/platform-module-integration-api-map.md)
7. [Build backlog](product/build-backlog.md)
8. [Documentation governance and audit](documentation-governance.md)
9. [Identifier registry — the knowledge graph](identifier-registry.md)
10. [AWS synthetic showcase deployment architecture](architecture/aws-showcase-deployment.md)

Section indexes: [Architecture](architecture/README.md) · [Product](product/README.md) · [Compliance](compliance/README.md) · [Decision records](decisions/README.md) · [Operations](operations/README.md) · [GTM](gtm/README.md)

## Documentation Map

| Document | Purpose |
| --- | --- |
| [What we are building](product/what-we-are-building.md) | Product definition, users, modules, scope, non-goals, and success criteria. |
| [Complete-system capability catalogue](product/complete-system-capability-catalog.md) | Canonical exhaustive target capability register across lending, operations, accounting, risk, compliance, technology, and product-specific journeys, with current maturity classifications. |
| [Product journey support matrix](product/product-journey-support-matrix.md) | Evidence-tier status for the 21 public journeys, their implemented platform boundary, tenant-specific activation requirements, and remaining production gaps. |
| [Product journey platform-depth audit](product/product-journey-platform-depth-audit.md) | Machine-checked deep readiness across tenant administration, domain kernels, APIs, experiences, lifecycle composition, tests, integrations and operations for all 21 journeys, grouped into shared remediation batches. |
| [Persistent specialist journey service](architecture/persistent-specialist-journey-service.md) | JD-02 architecture, state, APIs, maker-checker execution, exception recovery, identity containment, persistence/RLS and remaining production boundaries for 17 journeys. |
| [Archetype journey workspaces](architecture/archetype-journey-workspaces.md) | JD-03 architecture, product-contract schema design, entitlement/channel projection, persistent drafts, privacy/accessibility controls, APIs, failure operations and remaining lifecycle/production boundaries. |
| [Role-specific operational workspaces](architecture/operational-workspaces.md) | Canonical tenant-scoped origination, servicing, collections, control and partner desks; role/queue projection, authenticated task controls, evidence-gated specialist actions, task timeline/evidence panels, privacy boundary, server-route extraction and remaining production UX work. |
| [Greenfield product applications](architecture/greenfield-product-applications.md) | Canonical 21-product contracts, unified administration, governed white-label releases, application boundaries and remaining replacement batches. |
| [Composed product-journey lifecycle](architecture/composed-product-journey-lifecycle.md) | JD-04 architecture, state machine, version/evidence contract, maker-checker transitions, pause/revocation containment, compensation, APIs and operations boundary for all 21 journeys. |
| [LoanOS Guide and Academy](architecture/help-centre-and-academy.md) | Platform-owned role-based help, interactive learning boundary, governed content contract, and the future tenant/RE customization model. |
| [Documentation governance and audit](documentation-governance.md) | Audience map, source hierarchy, required update matrix, latest repository-wide documentation audit and known follow-on work. |
| [Identifier registry — the knowledge graph](identifier-registry.md) | Every cross-referencing ID scheme (capability, engine INV/DEC/SEC/PH, ADR, GTM claim, epic, integration), its authoritative source, and the CI gates that keep citations from dangling. |
| [Capability & build dashboard](dashboard.md) | How `docs/dashboard.html` is generated: plane/category/feature status view, completion scoring, product-plane mapping, and how it auto-updates on `./loanos.sh build`. |
| [Roadmap](product/roadmap.md) | Phased delivery plan from compliance foundation to AI governance hardening. |
| [Build backlog](product/build-backlog.md) | Actionable engineering backlog grouped by epic. |
| [Architecture blueprint](architecture/loanos-india-blueprint.md) | Target architecture across LOS, LMS, LWS, and compliance control plane. |
| [Platform module integration and API map](architecture/platform-module-integration-api-map.md) | Complete external dependency map organised by channels, LOS, decision/risk, LWS, LMS, collections, collateral, finance, compliance, partners, platform and SaaS organisation admission, with stable IDs, lifecycle trigger, direction and current state. |
| [Integration and Indian vendor procurement catalogue](architecture/integration-vendor-procurement-catalog.md) | Required API/event/file contracts, including organisation admission and tenant provisioning, mock gaps, Indian vendor candidates, commercial units, dated public prices and RFQ requirements. |
| [Tenant pricing and cost recovery](commercial/tenant-pricing-and-cost-recovery.md) | Full-lifecycle tenant unit economics: five-meter pricing construct, journey cost banding across all 21 journeys and all 115 integrations, origination/servicing/collections cost engines, deal-desk approval thresholds, the billable-event set still to be built (INT-ADM-08 / INT-PLT-12), re-price triggers and honest model gaps. Companion to `commercial/loanos-tenant-cost-and-pricing-model.xlsx`. |
| [SaaS tenancy and operating model](architecture/saas-tenancy-and-operating-model.md) | Multi-tenant SaaS delivery: tenant isolation, audit spine, tenant lifecycle, and LoanOS's own vendor-compliance posture. |
| [RE tenant onboarding and product administration](architecture/re-tenant-onboarding-and-product-administration.md) | Self-service RE bootstrap, built-in/future/custom product templates, organisation/users/channels/partners/integrations, finance/compliance, UAT/go-live and continuous tenant administration. |
| [Organisation signup and bootstrap identity](architecture/organisation-signup-and-bootstrap-identity.md) | Greenfield organisation admission, verified first owner, next-user lifecycle, canonical roles/SoD, tenant provisioning and activation architecture. |
| [Organisation signup detailed design](architecture/organisation-signup-detailed-design.md) | State, data, API, concurrency, security, identity, role, provisioning and exhaustive test design for the public-to-production journey. |
| [Organisation signup operations](architecture/organisation-signup-operations.md) | Admission, EDD, identity, provisioning, incident, recovery, reverification, RACI, SLO and go-live operating runbook. |
| [Tenant role, staffing, federation and activity attribution](architecture/tenant-role-staffing-and-feature-gating.md) | Exhaustive canonical roles, 34 feature staffing baselines, assignment/revocation authority, IdP/SCIM and agent rules, immediate containment, activity lineage, edge cases and production gaps. |
| [Federated access and forensic-custody operations](architecture/federated-access-and-forensic-custody-operations.md) | OIDC/SAML/SCIM runtime, MFA/WebAuthn/device assurance, universal mutation rollout, isolated mTLS/KMS control fleet, activity WORM custody, incident and acceptance runbooks. |
| [Platform admission regulatory control map](compliance/platform-admission-control-map.md) | Official-source RBI/Indian control mapping for organisation and representative verification, misuse prevention and the borrower-KYC boundary. |
| [Decision engine design](architecture/decision-engine-design.md) | Pure-Rust decision engine: per-tenant isolated runtimes, decision contract, invariants, kill-switch enforcement, agent guardrails, security threat model, and phased delivery plan (PH-0..5 all implemented). Source of truth for engine implementation. |
| [Agentic AI digital workers on AWS](architecture/agentic-ai-digital-workers.md) | Investigated target architecture, worker catalogue, autonomy boundaries, AWS/Strands framework decision, India-residency controls, regulatory status map, governance lifecycle, and phased delivery plan for bounded digital workers. |
| [AI-agent platform operations](architecture/ai-agent-platform-operations.md) | Executable marketplace/pricing/install/approval/execution/usage/reporting lifecycle, incident procedure, API sequence and remaining AWS/provider production-admission evidence. |
| [Decision engine operations](../rules/README.md) | Developer/operator guide: crate map, build and test, local fleet (sign/up/health/kill-switch), replay canary, API integration modes. |
| [AWS synthetic showcase deployment architecture](architecture/aws-showcase-deployment.md) | Canonical generation-2 deployment contract: selective artifact boundary, infrastructure ownership, immutable updates, custom-domain topology, failure recovery, and the production promotion boundary. |
| [AWS synthetic demo deployment](../deploy/aws/README.md) | End-to-end disposable, credit-conscious CloudFormation demo: packaging, bootstrap, applications, updates, external-DNS custom domains, troubleshooting, and teardown; synthetic data only. |
| [Synthetic demo operator handbook](operations/demo-handbook.md) | Canonical showcase/workshop field guide: automation boundary, 21 journeys, 14 personas, mocked integrations, release and DNS operation, smoke tests, troubleshooting, evidence, cost and teardown. |
| [Agent guide](../AGENTS.md) | Orientation for AI coding agents and new engineers: architecture map, load-bearing documents, non-negotiable engineering rules, commands. (`CLAUDE.md` imports it.) |
| [Current implementation map](architecture/current-implementation.md) | What code exists today, how it runs, and where each current control lives. |
| [Testing strategy](architecture/testing-strategy.md) | Canonical test-layer map, non-negotiable testing rules (adverse path first, golden corpora, evidence floors), and honest coverage boundaries. |
| [Design system](architecture/design-system.md) | Canonical warm-paper UI standard: shared token source, reuse rules, platform-wide accessibility requirements, and known drift boundaries. |
| [Knowledge-to-execution stack audit](architecture/knowledge-execution-stack/README.md) | Six-layer audit from sources of truth and stable identifiers through graph enforcement, agent execution and human readiness, with a repository-local status infographic. |
| [Governed digital origination journey](architecture/origination-journey.md) | Borrower self-service intake, product-driven document controls, conditions precedent, sanction validity, KFS language evidence, fail-closed gates, and production boundaries. |
| [Provider integration governance](architecture/provider-integration-governance.md) | Certification lifecycle, live-readiness gates, India-residency posture, provider transports, signed callbacks, and external onboarding boundaries. |
| [Audit integrity and data governance](architecture/data-governance.md) | External-anchor evidence, business-event completeness, evidence custody/legal hold/deletion proof, field lineage, and data-quality certification. |
| [Enterprise security and scale control plane](architecture/enterprise-security-and-scale.md) | Federation/SCIM, managed-key and SIEM custody evidence, PostgreSQL HA/PITR/capacity, API/event/webhook governance, and deployment-automation readiness. |
| [Tenant identity operations and conformance lab](architecture/identity-operations-and-conformance-lab.md) | Canonical IAM administration workspace, federation rotation/suspension, signed provider logout, explicit session revocation, maker-checker recovery, operational runs, resilience drills and identity/enterprise/admission simulator packs. |
| [Tenant activation, persistent conformance and identity runtime](architecture/tenant-activation-runtime-and-conformance.md) | Unified eight-dimension activation gate, persistent expiring conformance campaigns, cryptographic provider revocation verification, durable fenced identity workers, rollback and production boundaries. |
| [Identity operations worker runtime](architecture/identity-operations-worker-runtime.md) | Tenant/workload-fenced job, lease, retry, dead-letter, replay, alert and escalation contract plus deployment obligations. |
| [Risk, AML, fraud, and model-monitoring control plane](architecture/risk-aml-fraud-governance.md) | Ongoing CDD/rescreening, transaction monitoring, fraud scoring, portfolio limits/stress, RCSA, recurring model reports, and risk-committee packs. |
| [Implementation, migration, and go-live governance](architecture/implementation-migration-go-live.md) | Configuration/mapping, conversion reconciliation, balance validation, parallel run, UAT/training, readiness, cutover/rollback, and hypercare exit. |
| [Institutional governance and configurable operations](architecture/institutional-operations.md) | RE programme/hierarchy, regulatory applicability/obligations, business calendars, configurable workflows/approvals, workforce, bulk action and exception taxonomy. |
| [Customer and channel experience operations](architecture/customer-channel-experiences.md) | Governed branch/partner intake, lead matching/routing/lifecycle, party graph, merge plans, customer preferences, succession, customer-360, and privacy-safe PWA boundary. |
| [Android field operations app](architecture/android-field-operations-app.md) | Security attestation, encrypted storage, and offline reconciliation architecture for collections, KYC, and collateral field agents. |
| [Android DSA & lead origination app](architecture/android-dsa-origination-app.md) | Security controls, threat modeling, and zero-local-data policy for unmanaged partner device onboarding. |
| [Observability operations](architecture/observability-operations.md) | Runtime SLI/SLO, provider/stuck-work monitoring, access surfaces, initial response, and production telemetry gaps. |
| [Backup, DR, and BCP operations](architecture/recovery-operations.md) | Encrypted recovery packages, validation/restore controls, RTO/RPO exercises, operator procedure, and production recovery gaps. |
| [Release, configuration, and resilience operations](architecture/delivery-operations.md) | Governed human/AI release proposals, human-only approval/promotion/rollback, agent provenance/revocation, security gates, canaries, secret-safe configuration drift/parity, bounded probes and production automation gaps. |
| [Service operations and vendor oversight](architecture/service-operations.md) | Support SLA/on-call/escalation/problem controls, vendor review/SLA/concentration evidence, operating procedure, and production integration gaps. |
| [Secure SDLC and vulnerability assurance](architecture/security-assurance.md) | Artifact-bound scan/SBOM evidence, vulnerability SLA/remediation/exception controls, release gate, and production security-tooling gaps. |
| [SIEM, SOC, and security investigation operations](architecture/security-operations.md) | Detection/alert SLA, investigation and evidence-chain controls, logging coverage, response procedure, and production SOC gaps. |
| [Compliance control assurance and audit workspace](architecture/control-assurance.md) | Control plans/tests/issues/certifications, audit and RBI evidence requests, committee packs, operating procedure, and production GRC gaps. |
| [India regulatory register](compliance/india-regulatory-register.md) | Source-grounded control families and implementation anchors. |
| [Compliance build checklist](compliance/compliance-build-checklist.md) | Regulatory control-to-platform checklist with build status. |
| [Decision records](decisions/README.md) | Architecture decisions and why they were made. ADR 0002 covers multi-tenant SaaS, ADR 0003 the per-tenant decision engine, ADR 0004 verified bootstrap identity, ADR 0005 the isolated per-tenant platform-control policy engine, ADR 0006 the strategic remediation decisions, ADR 0007 the greenfield product applications, ADR 0008 the domain-grouped `@loanos/core` package boundary, and ADR 0009 the fail-open usage meter — the one deliberate exception to fail-closed. |
| [GTM asset library](gtm/README.md) | Go-to-market library for Sales & Marketing (humans + AI agents): strategy, sales playbook/scripts, marketing, brand guide, AI-agent runbooks, and automation. Kept in sync with the product via a claims↔backlog matrix and a claims-discipline check script. |
| [GTM operating model](gtm/operating-model.md) | The human ↔ AI-agent GTM process: end-to-end flow, agent orchestration, human-in-the-loop checkpoints, RACI, and maintenance cadence. |
| [Public-site content operations](gtm/marketing/public-site-operations.md) | Fast, governed human and AI workflow for drafting, reviewing, validating and approving public-site updates. |

## Definition of Done for Documentation

A feature is not considered complete unless it updates the relevant docs:

- Product behavior: update `docs/product/`.
- Architecture or service ownership: update `docs/architecture/`.
- Compliance or risk control: update `docs/compliance/`.
- Major irreversible technical choice: add a decision record under `docs/decisions/`.
- Externally-visible capability that changes what Sales/Marketing may claim: update the claim's Status/Evidence in `docs/gtm/strategy/claims-and-backlog-sync.md` and re-run `node docs/gtm/automation/gtm-backlog-sync.mjs`.
- User-visible workflow: update its Guide & Academy article, maturity/environment/control labels and `last verified` date; if no article is needed, record that decision in the implementation document.
- Guide or Academy learning change: follow `apps/help/README.md`; update source content rather than generated HTML, retain the orient/explain/apply/check pattern, rebuild both affected course outputs and visually verify keyboard and mobile reading paths.
- AI-agent operating rule or repository map: update `AGENTS.md` and any load-bearing document it points to.
- AWS showcase packaging, infrastructure, release, domain, recovery or teardown: update `architecture/aws-showcase-deployment.md`, `../deploy/aws/README.md`, `operations/demo-handbook.md`, `architecture/current-implementation.md`, and `AGENTS.md`; update the sales narrative/claim register if externally visible behavior changes.
