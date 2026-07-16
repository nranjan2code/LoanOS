# Greenfield product applications

## Scope

This architecture replaces the disconnected authenticated web layer. Android and public marketing pages are outside this boundary. The target surfaces are customer, partner, field, branch, credit, operations, control, tenant administration and platform administration.

## Current delivered foundation

- `product-journey-contracts.js` defines immutable versioned contracts for all 21 canonical journeys. Contracts contain product-specific facts/evidence and cannot be looked up by aliases.
- `product-platform-administration.js` is the unified platform and tenant product authority. It covers template publication, subscription, configuration, staffing, programmes, readiness, activation, suspension and retirement.
- `brand-governance.js` governs tenant/RE/programme/product releases, legal identity, locale content, co-branding, channel themes, publication and rollback.
- `/admin/product-platform` exposes tenant-local governed product administration. Product activation, suspension and retirement use persisted authenticated proposals followed by a different authenticated checker.
- `/admin/brand-governance` administers releases; `/brand-experience` resolves the authenticated channel experience and exact release lineage.
- `apps/administration` renders all 21 contracts and tenant readiness from the administration APIs. It does not embed product fixtures.
- `apps/platform-administration` governs platform product-template proposals and publication against the exact immutable contracts.
- `product-journey-schemas.js` supplies 21 product-specific, typed, classified and bilingual schemas; archetypes now select reusable components only.
- `apps/journey-workspace` no longer hardcodes platform branding or Save/Submit controls. It resumes server drafts and renders only server-projected executable actions. Missing document and lifecycle services are reported as unavailable rather than simulated.
- `journey-application-service.js` promotes an assisted, staff-owned submitted draft atomically into an immutable application, one composed lifecycle and, for the 17 applicable products, a specialist case.
- `/admin/journey-applications` exposes assignment-scoped application portfolios, detail and assisted promotion. It never accepts tenant or maker identity from the request body.
- `apps/customer-application`, `apps/partner-application` and `apps/banker-application` are authenticated, brand-aware channel shells with no embedded product, payment, brand or dummy records. They remain additive until servicing and control operations are completely migrated.

## Separation of concerns

| Boundary | Responsibility | Must not contain |
| --- | --- | --- |
| Product contract | Product facts, evidence, actions, facility/accounting/security and content obligations | Tenant state, UI state, provider secrets |
| Product administration | Template/version, subscription, configuration, staffing, programmes and readiness | Loan-case decisions or customer PII |
| Brand governance | Presentation, localized content, legal identity lineage and co-branding | Credit policy or action authority |
| Channel application | Accessible rendering and user interaction for server-projected contracts/actions | Lending policy, role inference, hidden fallback actions |
| Application/case service | Submitted application, assignment, evidence and lifecycle record linkage | Arbitrary unverified evidence strings |
| Domain services | KYC, decision, KFS, contract, disbursement, LMS, accounting, servicing and recovery | Channel-specific presentation |

## Remaining mandatory batches

1. Separate borrower/partner self-service intake from staff assignment and lifecycle activation; the delivered bridge currently supports authenticated assisted origination only.
2. Replace evidence checklist projections with document/evidence persistence, malware scanning, classification, custody, verification and role-aware actions.
3. Bind lifecycle advancement to actual KYC, decision, KFS, contract, disbursement, account, accounting, servicing, collections, reporting and closure records.
4. Replace the remaining old customer, partner and staff shells after their new applications own navigation and all applicable operations.
5. Generate happy, adverse, authorization, provider-failure, reconciliation, recovery and closure execution for all 21 current contract versions across file/PostgreSQL and browser/API layers.
6. Remove the temporary composed-lifecycle dependency on the superseded tenant-product subscription projection and make the unified active product/readiness record the only entitlement authority.

No journey is production-ready until those batches and provider/operations certification are complete.
