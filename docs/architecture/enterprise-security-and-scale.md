# Enterprise Security and Scale Control Plane

## Scope

Bundle E joins the existing identity, encryption, SOC, recovery, delivery and
observability slices into one executable readiness control plane. It governs
tenant federation and SCIM identity state, managed-key and security-log
custody evidence, PostgreSQL HA/PITR/capacity dependencies, API and event
contracts, webhook delivery, and production deployment automation.

These controls fail closed over declared evidence. They do not impersonate the
external IdP, cloud KMS/HSM, SIEM/log lake, managed PostgreSQL service, or
deployment controller that must produce and operate that evidence.

## Enterprise identity

- Each tenant owns its federation policies. OIDC policies require HTTPS
  metadata, PKCE, IdP-enforced MFA, allowed email domains and explicit group
  mappings. SAML policies require signed assertions. A separate checker binds
  metadata checksum, validity, login/logout and MFA tests before activation.
- SCIM events are idempotent and policy-bound. Provisioning requires an active,
  unexpired federation policy, an allowed email domain and an explicit mapped
  tenant role. Accounts are passwordless/federated; a SCIM deactivation marks
  the user inactive, which immediately invalidates existing session resolution.
- SCIM cannot take over a locally managed identity with the same email address.
  Tenant audit events retain policy, external identity, operation and hashed
  evidence lineage.

The API now exposes OIDC authorization-code/S256-PKCE start and exchange,
fetches certified discovery/JWKS documents, verifies signature, issuer,
audience, authorised party, validity, nonce, MFA and authentication age, and
retains assurance in the session. SAML uses a deliberately explicit certified
gateway boundary: LoanOS accepts only schema/signature/encryption/time/request-
binding attestations, never an unparsed client assertion. WebAuthn/FIDO and
signed managed-device evidence can be required per policy. SCIM discovery,
exact filtering, User create/deactivate and Group projection require scoped
tenant bearer credentials; directory groups still request rather than grant
canonical roles.

Commercial IdP registration, live SAML XML validation gateway, device/MDM
signature adapter, global logout/revocation, continuous metadata/JWKS refresh
and provider adverse-conformance evidence remain deployment work.

## Keys, security logs, and trusted time

- Managed-key attestations require India-region custody, a non-exportable
  HSM-backed key, dual control, bounded rotation, destruction policy and
  evidence reference. Purpose is explicit (`tenant_data`, `database`, `backup`,
  `audit`, or `signing`). No key material is accepted by these APIs.
- Security-log custody requires supported source families, authenticated
  collectors, schema registry, encryption, trusted time, searchable immutable
  India storage and at least 180 days' retention.
- Database and backup controls cannot cite arbitrary key ids: their dependency
  must resolve to a current attestation with the correct purpose.

The existing application envelope provider still performs local encryption.
Production must connect it to the attested KMS/HSM, validate grants and key
state directly, and operate actual SIEM/WORM/NTP infrastructure.

The access ledger can now be exported as an exact verified contiguous payload.
Independent custody approval requires a matching checksum, India storage,
immutable WORM compliance mode, trusted time and at least 180 days' retention;
reconciliation exposes every uncustodied sequence. A live collector and object-
lock/SIEM acknowledgement adapter are still required.

## PostgreSQL HA, PITR, and capacity

- A production topology has exactly one PostgreSQL primary, at least one
  synchronous standby, two or more India availability zones, encryption,
  tenant RLS, connection pooling, automatic failover, monitoring and a runbook.
- A PITR policy depends on a ready topology and attested backup key. It requires
  continuous WAL, full and incremental schedules, at least 35 days' immutable
  cross-account India custody, RPO no greater than 15 minutes, RTO no greater
  than four hours, restore-drill evidence and corruption checks.
- Capacity assessment computes headroom for API CPU, database CPU/connections,
  storage and queue lag. Any breached threshold requires remediation actions.
- Deployment readiness depends on a ready topology, PITR policy and capacity
  assessment; missing dependencies cannot be certified away.

## API, event, and webhook governance

- Published API contracts bind service/version/base path to an OpenAPI 3.1
  checksum, authentication mode, owner, tenant-isolation declaration,
  consistent errors, idempotency posture and independent approval.
- Event schemas start at version 1 and advance contiguously. Tenant, ordering
  and idempotency fields must exist and be required. Published fields cannot be
  removed or change type; additive optional fields are accepted.
- Webhook subscriptions require HTTPS, vault-held signing-secret references,
  India processing, published event schemas, bounded timeouts/retries and
  maker-checker approval. Deliveries bind event/schema/tenant/order/sequence,
  payload checksum and per-subscription idempotency. Outcomes progress through
  delivered, exponential retry, or dead letter with evidence.

The registry governs contracts and delivery evidence. Generating SDKs, serving
an interactive API portal, cryptographic webhook dispatch, queue partitioning
and replay workers remain runtime work.

## Deployment automation

A production or UAT policy is ready only when it targets India and binds source,
IaC checksum, pipeline, artifact registry, signed artifacts, SBOM and provenance
verification, vault secrets, expand/contract database migrations, progressive
delivery, automatic rollback, continuous drift detection, HA/PITR and current
capacity evidence. The existing release/canary/rollback workflow remains the
change authority.

The policy does not execute Terraform/CloudFormation, migrations, Kubernetes
rollouts, traffic shifting or rollback. Those controllers must authenticate to
the platform and submit independently verifiable evidence before a bank may
treat the deployment leg as production complete.
