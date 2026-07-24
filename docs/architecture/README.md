# Architecture Documentation

This index is the navigation root for LoanOS architecture. The current implementation map says what exists; target-state documents describe intended boundaries and must label remaining production gaps.

## Core architecture and SaaS

- [LoanOS India blueprint](loanos-india-blueprint.md)
- [Current implementation map](current-implementation.md)
- [Generated LoanOS system architecture diagram](loanos-system-architecture.svg) — edit the versioned bands, lanes and typed relationships in `loanos-system-map.json`, then run `npm run architecture:diagram`; `npm run architecture:diagram:check` rejects invalid sources, endpoints and stale output
- [Knowledge-to-execution stack audit](knowledge-execution-stack/README.md)
- [Persistent specialist journey service](persistent-specialist-journey-service.md)
- [Archetype journey workspaces](archetype-journey-workspaces.md)
- [Greenfield product applications](greenfield-product-applications.md)
- [Composed product-journey lifecycle](composed-product-journey-lifecycle.md)
- [LoanOS Guide and Academy](help-centre-and-academy.md)
- [SaaS tenancy and operating model](saas-tenancy-and-operating-model.md)
- [RE onboarding and product administration](re-tenant-onboarding-and-product-administration.md)
- [PostgreSQL migration and RLS](postgres-migration.md)
- [Decision engine design](decision-engine-design.md)
- [Tenant roles, staffing and feature gating](tenant-role-staffing-and-feature-gating.md)
- [Testing strategy](testing-strategy.md)
- [Design system](design-system.md)

## Agentic AI

- [Agentic AI architecture and governance specification](agentic-ai-architecture-and-governance.md)
- [Agentic AI digital workers on AWS](agentic-ai-digital-workers.md)
- [AI-agent platform operations](ai-agent-platform-operations.md)
- [Digital worker provider contract](digital-worker-provider-contract.md)

## Organisation admission and identity

- [Organisation signup and bootstrap identity](organisation-signup-and-bootstrap-identity.md)
- [Organisation signup detailed design](organisation-signup-detailed-design.md)
- [Organisation signup operations](organisation-signup-operations.md)
- [Federated access and forensic custody](federated-access-and-forensic-custody-operations.md)
- [Identity operations and conformance lab](identity-operations-and-conformance-lab.md)
- [Identity operations worker runtime](identity-operations-worker-runtime.md)
- [Identity worker operations runbook](identity-worker-operations-runbook.md)
- [Tenant activation runtime and conformance](tenant-activation-runtime-and-conformance.md)

## Lending, customers and integrations

- [Origination journey](origination-journey.md)
- [Customer and channel experiences](customer-channel-experiences.md)
- [Institutional operations](institutional-operations.md)
- [Risk, AML, fraud and model monitoring](risk-aml-fraud-governance.md)
- [Platform module integration and API map](platform-module-integration-api-map.md)
- [Integration and Indian vendor procurement catalogue](integration-vendor-procurement-catalog.md)
- [Provider integration governance](provider-integration-governance.md)

## Security, assurance and operations

- [AWS synthetic showcase deployment](aws-showcase-deployment.md)
- [Enterprise security and scale](enterprise-security-and-scale.md)
- [Data governance](data-governance.md)
- [Control assurance](control-assurance.md)
- [Security assurance](security-assurance.md)
- [Security operations](security-operations.md)
- [Delivery operations](delivery-operations.md)
- [Recovery operations](recovery-operations.md)
- [Observability operations](observability-operations.md)
- [Service operations](service-operations.md)
- [Implementation, migration and go-live](implementation-migration-go-live.md)

## Capability-completion records

These documents record executable closure waves and their remaining external/institutional boundaries. They are evidence, not claims that production rollout is complete.

- [Completion workstreams](completion-workstreams.md)
- [Production completion controls](production-completion-controls.md)
- [Missing-capability closure wave](missing-capability-closure-wave.md)
- [Final missing-capability wave](final-missing-capability-wave.md)
