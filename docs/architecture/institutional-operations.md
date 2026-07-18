# Institutional Governance and Configurable Operations

Status date: 2026-07-14

## Implemented scope

`packages/core/src/operations/institutional-operations.js` and `apps/api/src/routes/institutional-operations.js` add a tenant-scoped institutional operating layer above the existing lending domain and derived task engine:

- Operating hierarchy registers legal entity, region, business unit and branch nodes beneath one regulated entity. Parent-child types, RE ownership, state/serviceability, cost centre, status and maker-checker evidence are validated.
- Lending programmes bind one RE to approved product policies, active operating units, channels, borrower segments, an exact-paise portfolio limit, policy lineage and a bounded effective period.
- Regulatory applicability profiles determine known canonical controls as applicable, not applicable or conditional for an institution/product set. Non-applicability needs legal-opinion evidence; conditional scope needs its condition. An approved profile is the source for a compliance-obligation calendar with recurrence, owner/reviewer, due or event trigger, evidence requirements and escalation lead time.
- India business calendars define working weekdays, holidays, working hours, allowed SLA-pause reasons, maximum pause and approval role. They are governed policy records; the existing derived task clock remains unchanged until a task family is explicitly migrated to them.
- Configurable workflow definitions are versioned, maker-checker-approved data with exactly one initial state, reachable intermediate/final states, queues, SLA hours and role/evidence/condition/four-eyes transition policy. Configured cases pin the definition version and enforce that policy on every transition.
- Approval matrices resolve exact-paise amount, product, risk rating and deviation facts through ordered policy rules. They return required roles, approval count and unanimity; unmatched cases fail to `require_human` or `deny`, never automatic approval.
- Workforce policy records actor/queue capacity, leave state, time-bounded approved substitution, ageing escalation and least-open-task or round-robin balancing policy.
- Bulk-action plans are checksum-bound, idempotency-keyed and maker-checker approved, limited to 100 tasks, with separate high-volume approval above 25. This slice governs the plan; actual task mutations remain on the existing individually authorized task APIs.
- Exception taxonomy versions code, severity, root-cause requirement, owner role and remediation SLA. Operational exceptions pin taxonomy version, evidence, owner and derived deadline and cannot omit a mandatory root cause.

All mutation routes require tenant administrator, security administrator or operator access; auditors can read the projection. The HTTP boundary binds the declared checker to the authenticated actor, records remain inside one tenant data partition, and every mutation is sealed into that tenant's audit chain.

## API surface

`GET /institution/operations` returns the tenant projection. POST resources cover units, programmes, applicability profiles, obligation calendars, business calendars, workflow definitions/cases/transitions, approval matrices/resolutions, workforce policies, bulk-action plans, exception taxonomies and operational exceptions.

## Boundaries

This is the governed policy and evidence layer, not a full BPMN engine, HR/workforce system, regulatory-content subscription, enterprise GRC calendar, or bulk-task executor. Production depth still requires organisation/HR and branch master feeds, rule conflict/coverage analysis, workflow migration/version retirement, runtime timer scheduling, holiday-feed administration, pause/resume application to every task family, live workload routing, delegated-authority administration, notification/escalation workers, safe transactional bulk execution, taxonomy analytics and independent institution methodology.

## Verification

`tests/institutional-operations.test.js` covers same-RE hierarchy and programme lineage, applicability-driven obligations, state/role/evidence/condition/four-eyes transitions, exact-paise approval resolution, delegation/capacity/escalation, bounded bulk approval, exception root cause/deadline and authenticated tenant persistence.
