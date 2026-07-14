# RE Tenant Onboarding and Product Administration

LoanOS provides a versioned platform template library. The 21 public journeys are the initial built-in templates, not a ceiling and not automatically active for every tenant. Platform administrators can publish additional governed templates; a tenant can derive a custom template without changing another tenant or the platform source.

## Self-service lifecycle

1. **Create tenant and RE** — legal identity, licence/category, offices, India hosting, contracts, subscription, tenant owner and independent checker.
2. **Choose launch products** — browse built-in and entitled platform templates, compare prerequisites, select the smallest launch set, and request add-ons later.
3. **Configure operating model** — legal entities, programmes, organisation hierarchy, branches, business calendars, queues, roles, delegations and approval matrices.
4. **Configure products** — policy/version, borrower segment, amount/tenor/pricing, eligibility, documents, collateral, disbursement, schedule, charges, accounting and regulatory treatment.
5. **Configure experiences** — borrower/staff/branch/partner/field channels, branding, languages, accessibility, consent, customer content, notifications and grievance routes.
6. **Configure ecosystem** — LSP/DLA/DSA/BC/co-lender/valuer/legal/insurer/custodian/collection partners, scopes, contracts, access and concentration controls.
7. **Configure integrations** — provider mapping packs, endpoints, mTLS/SFTP/portal, vault references, callbacks, reconciliation, schemas, KMS/HSM/PGP and provider certification. Secrets never enter onboarding records.
8. **Configure finance and compliance** — chart of accounts, GST/TDS, bank/escrow/GL, EOD/BOD, reporting calendar, CIC/CKYCRR/FIU/CERSAI/CRILC/CIMS/PSL applicability and evidence owners.
9. **Prepare data and operations** — migration mapping/reconciliation, users/training, SOPs, support/incident/DR, capacity, security assurance and control testing.
10. **Sandbox and UAT** — happy/adverse product cases, roles, exceptions, accounting, reconciliation, regulatory outputs, accessibility and recovery evidence.
11. **Approve and launch** — maker-checker product approval, tenant readiness, provider readiness for live mode, cutover/rollback and operations/compliance/finance sign-off.
12. **Administer continuously** — add products, clone/customise templates, version policies/workflows, suspend/retire products, change channels/providers, recertify access and monitor readiness without affecting other active products.

## Authority model

Platform catalogue administration, tenant subscription entitlement, tenant product configuration, and production activation are separate authorities. A platform template being supported does not activate it for a tenant. A tenant subscription does not prove configuration. An approved configuration does not prove live provider readiness. Every boundary is tenant-scoped, version-bound, independently approved and auditable.

## Template model

- **Built-in template:** one of the initial 21, maintained and versioned by LoanOS.
- **Platform template:** a future reusable product published through platform governance.
- **Tenant-derived template:** a tenant-local clone with lineage to a built-in/platform version.
- **Tenant custom template:** a tenant-local governed definition assembled from supported capabilities and decision policies.

Customisation is data and policy: configuration schemas, decision models, workflow definitions, accounting profiles, document packs and integration mappings. Tenant-specific logic must not be added as scattered conditionals in shared server code.

## Readiness projection

The getting-started workspace must show progress and blockers by workstream: tenant/RE, subscription, products, organisation/users, channels, partners, workflows, integrations, security, finance, compliance/reporting, migration, UAT/training and go-live. Each blocker links to its owner, required evidence and next action. Adding a later product creates a new scoped onboarding amendment; it does not reopen or mutate unrelated active products.

## Deployment models

Deployment topology is an approved, versioned tenant attribute rather than an installation-time assumption. LoanOS supports four models:

- **Shared multi-tenant:** shared application and database infrastructure with tenant partitions, PostgreSQL RLS, tenant-negative tests, tenant-scoped runtime state, keys, queues and observability.
- **Dedicated tenant data plane:** shared control plane with a tenant-dedicated database, decision runtime, storage, workers, keys and monitoring scope.
- **Dedicated environment:** tenant-dedicated application and data planes, network zone, release ring, recovery policy and operations boundary.
- **Customer-managed private:** customer-controlled environment with an explicit provider/customer/shared responsibility matrix, customer acceptance evidence, release/upgrade contract, support boundary and exit plan.

Every model provisions the namespace, application and data partitions, database isolation, per-tenant decision runtime, keys/secrets, network/domain/certificates, storage/WORM, queues/workers, integrations, monitoring/SIEM, backup/PITR/DR, capacity/SLO, release ring, support operations, India residency and portability/exit controls. Readiness is fail closed and requires same-tenant evidence for every component.

## Provisioning and recovery semantics

Tenant creation and later product addition run as revisioned, resumable sagas with idempotent checkpoints, leased workers and fencing tokens. The dependency order is infrastructure isolation, security/audit foundations, RE and administrator authority, entitlements/configuration/workflows, channels/integrations, finance/compliance, migration/UAT, activation and independently accepted handover.

Reversible steps declare reverse-order compensation. Migration and activation are irreversible boundaries requiring maker-checker execution approval and witness evidence. Exhausted retries enter rollback; failed compensation enters manual intervention. Reconciliation can adopt externally verified checkpoints but cannot bypass dependencies or overwrite conflicting evidence. An add-product saga snapshots active products and is rejected if its scope overlaps or mutates them.
