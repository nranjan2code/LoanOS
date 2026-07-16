# ADR 0007: Greenfield product applications and administration

- Status: accepted
- Date: 2026-07-16

## Context

LoanOS has substantial lending, compliance, accounting and servicing kernels, but its authenticated web surfaces historically exposed generic capture forms, development onboarding fixtures and disconnected workspace, specialist-case and lifecycle records. The platform has no production users and no backward-compatibility requirement. Treating the eleven UI archetypes as the product definition concealed material differences between the 21 supported lending journeys.

White-labeling was also resolved from a single regulated entity name and a few URLs. That is insufficient for a multi-tenant regulated platform because marketing presentation, legal lender identity, programme co-branding, product content, communication templates and language packs have different authorities and release lifecycles.

## Decision

1. The 21 canonical product IDs are the only built-in product vocabulary. There are no legacy aliases or dual-read application contracts.
2. Every canonical journey has an immutable, checksummed product contract declaring its product-specific facts, evidence, channel actions, administration sections, facility/security/accounting properties, lifecycle capabilities and white-label content obligations.
3. Shared archetype components remain implementation aids. They cannot substitute for a product contract or product-specific acceptance evidence.
4. Platform template publication, tenant subscription, tenant configuration, staffing, programme administration, readiness, activation, suspension and retirement use one administration authority. Mutating release transitions require separately authenticated makers and checkers.
5. White-label releases are governed tenant data. Tenant, regulated-entity, programme and product overlays are versioned and checksum-bound. The regulated legal identity is resolved independently from marketing presentation and cannot be replaced by a product overlay.
6. Authenticated applications are separated by responsibility: customer, partner/field, banker/operations/control, tenant administration and platform administration. Shared UI packages may contain presentation primitives only; lending authority remains server projected.
7. Superseded generic web flows are removed when their replacement owns the complete workflow. No compatibility routes, hidden fallback actions or fake document/lifecycle controls are retained.

## Consequences

- A tenant cannot activate a product without all readiness gates, staffing, provider, document, brand/legal-identity and rollback evidence.
- Every future product is introduced as a new governed contract or tenant-derived template version rather than an alias.
- The application-to-case-to-lifecycle bridge must resolve actual stored records; arbitrary evidence references cannot certify a banking stage.
- Generated full-stack acceptance packs remain mandatory for every contract version and every applicable channel before production readiness.
