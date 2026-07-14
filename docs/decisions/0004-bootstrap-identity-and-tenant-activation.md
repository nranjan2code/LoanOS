# ADR 0004: Verified Platform Admission, Temporary Bootstrap Identity and Evidence-Gated Tenant Activation

## Status

Accepted. 2026-07-15.

## Context

LoanOS is a multi-tenant lending SaaS platform for Indian regulated entities (REs). Allowing the first web registrant to create an immediately active tenant would let an unverified person claim an RE identity, obtain administrator authority, publish RE branding, configure digital lending channels or initiate live integrations. It would also collapse contact verification, legal-entity verification, contracting, infrastructure provisioning and production authorisation into one unsafe action.

The earlier administrative path could create an active tenant and give its first user tenant, user, security and auditor roles together. That is unsuitable for the greenfield production model: it violates least privilege, makes independent audit fictional, allows self-approval, and does not prove that the registrant represents the named organisation.

The risk is concrete. RBI has highlighted illegal digital lending applications and false claims of association with REs. An RE adopting LoanOS must also perform continuing due diligence and oversight of LoanOS under the RBI IT Outsourcing Directions. LoanOS needs reciprocal platform-admission evidence, controlled privileged access, tenant isolation, resilience, auditability and exit capability. The official-source applicability boundary and control mapping are recorded in [platform-admission-control-map.md](../compliance/platform-admission-control-map.md).

Platform admission is not borrower KYC. RBI KYC/CDD obligations for the RE's borrowers remain in the customer onboarding and AML capabilities. LoanOS verifies its prospective contracting organisation and authorised representatives to protect the SaaS platform and substantiate the commercial/outsourcing relationship; it does not claim that this constitutes RBI approval or completes the RE's borrower KYC or outsourcing assessment.

The codebase already has tenant-scoped identity primitives, invitation/MFA, product getting-started, deployment blueprints and a resumable provisioning saga. These need one lifecycle and authority model before public signup and production adapters are exposed.

## Decision

1. **Signup is an admission application, never instant activation.** Public signup creates only a restricted signup case. It grants no tenant data-plane credential, public RE branding, borrower channel, production integration or production authority.
2. **Verify the relationship in layers.** Contact possession, representative identity, representative authority, legal entity, PAN/GSTIN where applicable, RBI/other regulated status, corporate-domain control, duplicate/fraud/adverse risk, contract and outsourcing acceptance are separate, evidenced gates. Discrepancies fail closed into request-for-information, enhanced due diligence or rejection.
3. **Separate organisation, tenant and identity aggregates.** A verified person does not imply a verified organisation; a verified organisation does not imply a provisioned or active tenant. One organisation binds to at most one active tenant by default.
4. **Reserve before provisioning; activate only by decision.** Admission approval may reserve a tenant in `verified_pending_provisioning`. Only an immutable, independently approved activation decision can enter `active`, after joining organisation, contract, identity/staffing, deployment, product/UAT, live-provider, security, finance, compliance, DR and handover evidence.
5. **The first user receives temporary `bootstrap_owner`, not permanent superuser authority.** It is tenant-, purpose- and time-bound. It permits setup and invitations but never independent audit, approval of its own grants, approval of irreversible provisioning or production activation. It is automatically reduced to separately approved permanent grants at bootstrap exit.
6. **Use one canonical, versioned RBAC catalogue.** Administrative and business roles share one permission/scope evaluator. Unknown roles/scopes are rejected, not silently discarded. Role grants are versioned, effective-dated, tenant/resource scoped and approval/evidence bound.
7. **Enforce static and transactional separation of duties.** Maker/checker, identity-admin/access-review, security-admin/security-audit, product-configure/launch-approve, finance-maker/checker, provisioning-execute/approve and bootstrap-owner/activation-approve conflicts are mandatory. Exceptions are narrower, time-bound, independently approved and cannot waive core money-movement or activation independence.
8. **Require distinct-person minimum coverage.** Production readiness counts active, MFA/federation-ready, trained humans—not role labels. Tenant identity/security administration has backup coverage; product, operations, compliance, finance and launch functions have independent makers/checkers as applicable; audit is read-only and independent.
9. **All later users follow a governed access journey.** Sponsor/request, exact role/scope, SoD/prerequisite assessment, approval, single-use invitation or SCIM pre-authorisation, identity/credential/MFA/federation, role acceptance/training, activation, review and deprovisioning are evidenced stages.
10. **Federation authenticates; LoanOS authorises.** IdP/SCIM claims never directly grant unrestricted permissions. High-risk roles still require LoanOS approval. At least two tested, vaulted break-glass identities exist before federation enforcement.
11. **Join admission to an approved deployment topology and resumable saga.** Shared multi-tenant, dedicated data plane, dedicated environment and customer-managed private models use versioned responsibility matrices and tenant-scoped plans. Workers use leases, fences, idempotent checkpoints, bounded retry, reverse compensation and verified reconciliation.
12. **Irreversible boundaries require independent approval and witness evidence.** Initial/migrated data load and activation are not automatically compensated. Recovery preserves audit/WORM/evidence and follows an approved rollback or forward-recovery plan.
13. **Protect applicant data and platform evidence.** Public-signup data lives in a restricted pre-tenant partition. Secrets/tokens/identity documents never enter ordinary logs/audit. Purpose, source, residency, retention/hold and deletion are explicit; sensitive evidence access is itself audited.
14. **Admission is continuous, not one-time.** Legal/licence, representative, ownership/control, domain, contract, DLA/product/deployment and adverse-risk changes trigger risk-based reverification. Material unresolved changes can proportionately restrict, suspend or terminate access while preserving audit and exit duties.
15. **No backward compatibility is required.** Production uses only the new lifecycle, canonical roles and gates. Direct-active tenant construction and broad seeded roles remain test/development fixtures until removed; they are not a supported production path or API promise.

## Consequences

Positive:

- an unverified claimant cannot impersonate an RE or obtain production capability;
- tenant activation becomes explainable, reproducible and evidence-bound;
- the first user can make progress without defeating independent governance;
- later user onboarding, federation and SCIM share one role/SoD model;
- deployment failures can retry, compensate or reconcile without inventing success;
- RE vendor due-diligence, audit, resilience and exit evidence is available by design;
- greenfield semantics remove unsafe aliases, silent role normalisation and premature-active states.

Tradeoffs:

- onboarding takes longer than consumer-style instant signup and requires manual EDD for ambiguous/high-risk cases;
- a small prospective RE must identify independent people before production, even when one founder performs several maker-side setup tasks;
- canonical RBAC must replace disconnected role sets across existing routes and tests;
- control-plane persistence, workers, official verification adapters, notification delivery and self-service/operator UIs become release-critical;
- ongoing licence/legal/access reverification creates operational queues and contractual communication duties;
- customer-managed deployments require explicit shared-responsibility checkpoints rather than a single provider-controlled workflow.

## Alternatives considered

### Instant tenant plus later verification

Rejected. Restricting it later is not equivalent to preventing brand, credential, integration or data-plane misuse. It also creates destructive cleanup and evidence ambiguity.

### Platform administrator creates every tenant and chooses the owner's password

Rejected as the production model. It does not scale self-service onboarding, causes credential knowledge by staff and concentrates authority. Platform-assisted admission remains possible through the same case, verification and invitation commands.

### Give the first user all administrator and auditor roles

Rejected. Audit independence and maker-checker controls cannot be satisfied by labels assigned to one person. Temporary bootstrap authority is sufficient for setup.

### Trust corporate email/domain alone

Rejected. Domain control does not establish legal existence, regulated status or representative authority and can be compromised.

### Treat platform admission as full RBI KYC

Rejected. It misstates legal roles and risks conflating vendor/customer acceptance with the RE's borrower CDD/AML obligations. Risk-based platform admission has a separate purpose and policy.

### Let IdP groups or SCIM directly create permissions

Rejected. External identity systems authenticate and propose lifecycle/group facts; LoanOS remains responsible for tenant-scoped authorisation, high-risk approval and SoD.

### One synchronous distributed transaction

Rejected. Verification, email, DNS, cloud, KMS, databases and customer-managed components cannot participate atomically. Durable outbox plus idempotent, fenced sagas provide honest recovery semantics.

## Implementation obligations

- implement the invariants and contracts in [organisation-signup-and-bootstrap-identity.md](../architecture/organisation-signup-and-bootstrap-identity.md);
- implement the persistence/API/concurrency/test design in [organisation-signup-detailed-design.md](../architecture/organisation-signup-detailed-design.md);
- operationalise RACI, SLOs, alerts, runbooks, DR and go-live evidence in [organisation-signup-operations.md](../architecture/organisation-signup-operations.md);
- keep the official-source [platform admission control map](../compliance/platform-admission-control-map.md) current and obtain applicability/legal review;
- remove or production-disable every direct-active creation path, broad first-owner default and silent unknown-role filtering before public release;
- add end-to-end tests that begin at public signup rather than seeded tenant state;
- certify live official verification, notification and infrastructure adapters; mocks remain development evidence only.

## Review triggers

Review this decision if:

- Indian law/RBI directions materially change platform/vendor admission, identity, outsourcing, data residency or DLA obligations;
- the platform admits non-RE lenders, non-lender institutions or a non-India geography;
- RBI/another authority supplies an authoritative machine-verifiable RE/DLA directory or identity mechanism that changes admission evidence;
- a deployment model cannot support the required control-plane/tenant lifecycle or independent evidence;
- phishing-resistant authentication becomes universally feasible enough to replace TOTP baseline;
- operating evidence shows the minimum-staffing or SoD policy needs to be stricter. Core independent activation and tenant isolation cannot be relaxed without a superseding ADR.
