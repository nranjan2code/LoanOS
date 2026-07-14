# Organisation Signup and Bootstrap Identity Detailed Design

## 1. Design status and intent

This is the target greenfield contract for implementing public organisation signup, platform admission, bootstrap identity, canonical tenant RBAC and activation orchestration. It does not preserve the existing administrator-created-active-tenant behaviour as a public contract. Existing low-level identity and provisioning primitives may be reused only where they meet these invariants.

The regulatory applicability boundary, current official primary sources and the stable `ADM-*` admission control IDs are in [platform-admission-control-map.md](../compliance/platform-admission-control-map.md). Implementations and tests should cite those IDs; this design does not reclassify platform admission as borrower KYC.

The design uses pure domain commands plus persistence/orchestration adapters. Domain functions validate complete input and return deterministic events/findings; routes authenticate, authorise, load tenant-scoped state, apply optimistic concurrency, append audit/outbox events and commit atomically.

## 2. Component model

| Component | Responsibility | Data boundary |
| --- | --- | --- |
| Signup edge | Public request validation, bot/rate controls, uniform responses, challenge initiation | Public signup partition |
| Admission service | Organisation/representative facts, verification tasks, duplicate detection, risk decision and appeal | Control plane, restricted EDD vault |
| Organisation registry | Stable legal-entity identity and verified identifiers | Control plane |
| Tenant lifecycle service | Tenant reservation and lifecycle transitions | Control plane |
| Identity service | Membership, authenticators, federation links, sessions and recovery | Tenant-scoped identity partition plus control-plane locator |
| Authorisation service | Canonical role catalogue, permissions, scopes, grants, SoD and coverage | Tenant data plane; catalogue in control plane |
| Invitation service | Single-use membership/access invitation and delivery status | Tenant data plane |
| Provisioning orchestrator | Deployment-plan/saga execution, leases, compensation and reconciliation | Control plane plus tenant-scoped saga records |
| Getting-started orchestrator | Subscription, product/configuration/UAT progress | Tenant data plane |
| Activation service | Joins immutable evidence into an independent launch decision | Control plane with tenant-bound references |
| Audit/evidence service | Hash-chained audit, evidence checksums, legal holds and evidence packs | Tenant audit spine / protected evidence vault |
| Notification adapter | Email/SMS/WhatsApp delivery and callback reconciliation | Provider boundary; no raw secret in event/log |
| Verification adapters | MCA/GST/RBI/domain/identity/risk fact retrieval | Provider boundary with signed/checksummed result |

## 3. Identifiers, tenancy and versioning

- IDs are opaque, non-sequential and globally unique. User-facing references may be shorter aliases but never storage keys.
- Every mutable aggregate has `revision`, `createdAt`, `updatedAt` and status. Commands carry `expectedRevision` where a stale write could alter authority or lifecycle.
- Every record after organisation binding carries `tenantId`. Pre-tenant records carry `signupCaseId` and a restricted `organisationCandidateId`.
- Sensitive exact identifiers are encrypted; searchable equality keys use domain-separated keyed hashes. Logs use last-four or opaque references.
- Role, policy, terms, privacy notice, verification schema, deployment blueprint and product template references include immutable versions.
- All timestamps are UTC ISO-8601 from the trusted service clock. Domain evaluation accepts a clock for deterministic tests.

## 4. Logical data model

### 4.1 `signup_case`

| Field | Notes |
| --- | --- |
| `signupCaseId`, `revision`, `status` | Aggregate identity and state. |
| `primaryEmailCiphertext`, `primaryEmailLookupHash` | Contact; never audit plaintext. |
| `mobileCiphertext`, `mobileLookupHash` | Optional/required by admission policy. |
| `contactVerification` | Challenge refs, attempts, verified timestamps; never OTP/token. |
| `representativeProfileRef` | Restricted evidence-vault reference. |
| `organisationCandidateId` | Link after organisation details submitted. |
| `termsVersion`, `privacyNoticeVersion`, `acceptanceEvidenceRef` | Exact accepted text/version and evidence. |
| `riskSignals` | Coded, explainable signals; no raw device fingerprint in general projection. |
| `admissionDecisionRef` | Immutable decision revision. |
| `expiresAt`, `retentionClass` | Abandonment and privacy lifecycle. |

### 4.2 `organisation`

Fields include `organisationId`, legal name, entity type, incorporation identifier type/value, PAN, GST registrations, RBI-regulated category, RBI CoR/licence identifiers and statuses, registered office, verified domains, authorised representatives, source facts, verification timestamps, risk classification and ongoing-review due date. Each identifier has a normalised lookup hash and source evidence. An organisation may bind to at most one active LoanOS tenant under the default one-RE-per-tenant rule.

### 4.3 `admission_case`

Stores policy version, verification tasks, duplicate candidates, discrepancies, fraud/device/velocity findings, sanctions/adverse-risk review, contract prerequisites, analyst assignment, proposed decision, independent approval where required, rejection codes, applicant-facing reason category, appeal/correction lineage and ongoing-reverification schedule.

### 4.4 `tenant`

Fields include `tenantId`, `organisationId`, contract/subscription references, deployment blueprint/version, data-residency policy, lifecycle status, current activation decision, restriction reasons, provisioning saga IDs, control-plane/data-plane locators and portability/exit plan. `activeAt` is null until activation succeeds.

### 4.5 `identity` and `tenant_membership`

Identity holds a stable person/service ID, verified contacts, assurance level, authentication sources and status. Membership binds it to exactly one tenant context and records sponsor, employment/contract status, start/end dates and lifecycle. The same natural person may have separately approved memberships in different tenants, but sessions and grants never cross those memberships.

Authenticator details are isolated: password hash parameters, TOTP/FIDO credential public data, recovery-code hashes, federation issuer/subject, last rotation and compromise/revocation state. Raw secrets never leave the secret ceremony response.

### 4.6 `invitation`

Fields: `invitationId`, tenant, intended contact lookup hash, identity/membership candidate, sponsor, exact proposed-grant checksum, token hash, delivery attempts, expiry, status, accepted/revoked timestamps and superseded invitation reference. Token lookup is tenant-bound and constant-time.

### 4.7 `role_definition`, `permission`, `role_grant`

`role_definition` is immutable per `roleId:version` and contains known permissions, allowed scope dimensions, prerequisites, privileged flag, approval policy, static/transactional SoD tags and custom-role lineage. A `role_grant` contains tenant, membership, exact role version, canonical scope, effective interval, request/proposal/approval references, status and access-review cadence.

### 4.8 `coverage_assessment`

An immutable projection listing required capability positions, qualifying distinct active people, missing coverage, SoD conflicts, training/MFA/federation findings and evidence checksum. Activation pins one assessment; a later staffing loss can restrict the tenant according to policy but never rewrites the historical activation evidence.

### 4.9 `activation_decision`

Contains tenant/organisation versions, admission decision, contract, bootstrap exit assessment, role coverage, deployment readiness, provisioning handover, product entitlements/configuration/certification, UAT, training, provider readiness, security, finance, compliance, DR/cutover and independent proposer/approver/acceptor evidence. Its canonical checksum prevents evidence substitution.

## 5. Command/state transition rules

Every command follows:

1. validate schema and reject unknown enum/role/scope;
2. authenticate actor or public challenge context;
3. authorise against tenant status, canonical permissions and scope;
4. load aggregate and verify tenant binding/revision;
5. check lifecycle transition, prerequisites, SoD and idempotency;
6. create deterministic domain result and audit/outbox events;
7. commit aggregate, idempotency result, audit event and outbox atomically;
8. dispatch external work asynchronously;
9. reconcile callback by tenant, operation, payload hash and provider signature.

No controller may assign `active` directly. No external provider callback performs a business transition without validation and policy evaluation.

## 6. Target API contract

All endpoints are versioned under `/v1`. Mutation endpoints require `Idempotency-Key`; authenticated mutations additionally require CSRF protection for cookie sessions. Responses include `requestId`, resource `revision` and safe coded findings. `If-Match` or `expectedRevision` is mandatory for privileged updates.

The tables in this section are the production-complete target. The current executable slice uses the repository's existing optional `/v1` prefix with these route families:

| Implemented route family | Current scope |
| --- | --- |
| `/organisation-signups` and `/:id/contacts/:channel/verification` | Start application, issue a one-time case access secret, and prove hashed email/mobile possession without tenant creation; the case ID alone is insufficient. |
| `/organisation-signups/:id/identity`, `/proofs`, `/legal-acceptances` | Legal/tax/RE, domain, representative and contractual evidence. |
| `/platform/organisation-signups/:id/admission-proposal`, `/admission` | Two authenticated platform-user commands with session-derived maker/checker identity. |
| `/platform/organisation-signups/:id/tenant`, `/owner-invitation`, `/provisioning`, `/activation` | Quarantined reservation without API key, owner invite, provisioning request and activation-blocker projection. |
| `/organisation-signups/:id/owner/mfa-setup`, `/owner/acceptance` | Single-use verified-owner credential choice and mandatory TOTP proof. |
| `/admin/identity-governance/*` | Canonical principal binding, bootstrap owner/checker, roles/SoD, role grants/revocations, coverage, bootstrap reduction, ownership transfer and emergency access. |

The current file-store slice is intentionally narrower than the target: appeal/reverification/operator queues, outbox delivery, CSRF, CAS/`If-Match`, workload-identity provisioning APIs, PostgreSQL persistence and final activation are still required. Direct active-tenant minting is disabled by default in production configuration; the remaining direct route is an explicitly enabled development/test fixture.

### 6.1 Public signup and admission

| Method and path | Purpose | Success |
| --- | --- | --- |
| `POST /v1/signup/cases` | Start case; record terms/privacy versions | `202`, opaque case and next action |
| `POST /v1/signup/cases/{id}/email-challenges` | Send/resend verification | `202`, uniform response |
| `POST /v1/signup/cases/{id}/email-challenges:verify` | Verify single-purpose code/token | `200` |
| `POST /v1/signup/cases/{id}/mobile-challenges` | Optional/required mobile challenge | `202` |
| `POST /v1/signup/cases/{id}/mobile-challenges:verify` | Verify mobile | `200` |
| `PUT /v1/signup/cases/{id}/representative` | Submit representative and authority evidence | `200` |
| `PUT /v1/signup/cases/{id}/organisation` | Submit legal/RE identifiers | `200` plus discrepancies |
| `POST /v1/signup/cases/{id}:submit` | Freeze a revision for admission | `202` |
| `GET /v1/signup/cases/{id}` | Challenge-authenticated status/next action | `200`; no internal risk details |
| `POST /v1/signup/cases/{id}/corrections` | New linked correction revision | `202` |
| `POST /v1/signup/cases/{id}/appeals` | Request governed review after eligible rejection | `202` |
| `POST /v1/signup/cases/{id}:cancel` | Withdraw and start retention workflow | `202` |

Public status lookup requires a case-bound secret/session; the case ID alone is insufficient. Responses do not reveal whether an email, domain, PAN, GSTIN, CIN or RBI CoR already exists.

### 6.2 Platform admission operations

| Method and path | Permission |
| --- | --- |
| `GET /v1/platform/admission-cases` | `admission.read`, scoped queue |
| `GET /v1/platform/admission-cases/{id}` | `admission.read_sensitive`, case assignment or independent oversight |
| `POST /v1/platform/admission-cases/{id}/verification-tasks` | `admission.verify` |
| `POST /v1/platform/admission-cases/{id}/decisions:propose` | `admission.decide_maker` |
| `POST /v1/platform/admission-cases/{id}/decisions:approve` | `admission.decide_checker`; different actor when policy requires |
| `POST /v1/platform/admission-cases/{id}/requests-for-information` | `admission.communicate` |
| `POST /v1/platform/admission-cases/{id}/appeals:resolve` | independent `admission.appeal` |
| `POST /v1/platform/organisations/{id}/reverification` | `admission.reverify` |
| `POST /v1/platform/organisations/{id}:restrict` | independently approved risk/security permission |

Admission approval reserves, but does not activate, a tenant. Tenant reservation is a separate command in the same atomic workflow or a durable outbox-driven process with a unique organisation binding.

### 6.3 Bootstrap activation

| Method and path | Purpose |
| --- | --- |
| `POST /v1/bootstrap/invitations/{opaque}:accept` | Validate token and intended identity |
| `POST /v1/bootstrap/credentials` | User selects password/FIDO/federation path |
| `POST /v1/bootstrap/mfa:begin` / `:confirm` | Complete factor enrollment |
| `GET /v1/bootstrap/workspace` | Next actions, expiry and blockers |
| `PUT /v1/bootstrap/organisation-profile` | Operating profile not legal-verification override |
| `POST /v1/bootstrap/deployment-selection` | Select entitled approved model |
| `POST /v1/bootstrap/products` | Select initial entitled templates |
| `POST /v1/bootstrap:complete` | Request bootstrap reduction after prerequisites |

### 6.4 Tenant users and access

| Method and path | Purpose |
| --- | --- |
| `POST /v1/admin/access-requests` | Propose invitation/grants with scopes and justification |
| `POST /v1/admin/access-requests/{id}:approve` | Resolve exact revision/checksum independently |
| `POST /v1/admin/invitations` | Issue approved invitation |
| `POST /v1/admin/invitations/{id}:resend` | Revoke prior token and reissue |
| `POST /v1/admin/invitations/{id}:revoke` | Revoke before use |
| `POST /v1/auth/invitations:accept` | Verify token, contact and role acceptance |
| `POST /v1/auth/mfa/enrolments` / `:confirm` | Enroll factor |
| `POST /v1/admin/grants` / `/{id}:approve` | Govern later grants |
| `POST /v1/admin/grants/{id}:revoke` | Revoke and terminate affected sessions |
| `POST /v1/admin/users/{id}:suspend` | Immediate containment |
| `POST /v1/admin/users/{id}:reactivate` | Independently governed where privileged |
| `GET /v1/admin/role-catalogue` | Canonical roles, permissions, prerequisites and SoD |
| `POST /v1/admin/custom-roles` | Governed allow-listed composition and simulation |
| `GET /v1/admin/role-coverage` | Current distinct-person coverage/blockers |
| `POST /v1/admin/access-reviews` | Periodic certification campaign |

### 6.5 Federation and SCIM

Target endpoints create versioned federation policies, upload or retrieve signed metadata, verify domains, test login/claim mapping, approve activation, roll back, rotate keys and manage break-glass evidence. SCIM `/v2/Users` and `/v2/Groups` are exposed only beneath a tenant-specific base URL/token and implement RFC-compatible filtering/pagination while preserving LoanOS approval rules. SCIM responses never expose another tenant through filter timing or identifiers.

### 6.6 Provisioning and activation

| Method and path | Purpose |
| --- | --- |
| `POST /v1/platform/tenants/{id}/provisioning-sagas` | Plan tenant launch/add-product saga |
| `POST /v1/platform/provisioning-sagas/{id}/steps:claim` | Worker lease/fence |
| `POST /v1/platform/provisioning-sagas/{id}/steps/{step}:complete` | Checkpoint/evidence checksum |
| `POST /v1/platform/provisioning-sagas/{id}/steps/{step}:fail` | Retry/rollback decision |
| `POST /v1/platform/provisioning-sagas/{id}/steps/{step}:approve` | Independent irreversible approval |
| `POST /v1/platform/provisioning-sagas/{id}:reconcile` | Adopt verified external checkpoints |
| `POST /v1/platform/provisioning-sagas/{id}/compensations:claim` | Reverse-order compensation lease |
| `POST /v1/platform/provisioning-sagas/{id}:handover` | Operations/security/finance/compliance/UAT acceptance |
| `POST /v1/tenants/{id}/activation-decisions:propose` | Freeze complete readiness join |
| `POST /v1/tenants/{id}/activation-decisions/{decision}:approve` | Independent activation |

Worker endpoints use workload identity, not human session or general platform API key. Workload identity is restricted to an operation/tenant/step and short duration.

## 7. Admission and enhanced due diligence decision

LoanOS admission EDD is vendor/customer acceptance for access to a regulated lending SaaS platform. It is not the RE's KYC of its borrowers and must not be represented as CKYCR customer onboarding. The architecture nevertheless adopts risk-based identity, legal-entity verification and ongoing-review controls because false RE claims, illegal lending operations and compromised representatives create platform, customer and regulatory risk.

### 7.1 Required facts

- verified representative name, official contact, employment/office and authority basis;
- board resolution/authorisation letter or independently confirmed authorised signatory;
- entity type, exact legal name, incorporation/registration identifier and current MCA status where applicable;
- PAN and name match; GSTIN/legal name/status and registered/principal place where applicable;
- RBI-regulated category, CoR/licence/authorisation number, current status and permitted activity, or a documented reason the organisation is not itself an RBI RE;
- registered office, operating addresses, corporate-domain control and official published contact cross-check;
- directors/partners/beneficial ownership only to the lawful, proportionate extent required for contracting, sanctions/risk and fraud prevention;
- sanctions/UAPA and internal denylist results, adverse regulatory/enforcement/media risk and prior LoanOS relationship;
- intended products, channels, partners/DLAs, data classes, volumes, deployment model and use case;
- executed MSA/order form, DPA/processor terms, RBI/auditor access, incident, BCP/DR, subcontractor, exit/portability and acceptable-use commitments.

### 7.2 Admission outcomes

`approve`, `approve_with_conditions`, `request_information`, `manual_review`, `reject`, `suspend` and `terminate`. Automated checks may clear low-risk facts but cannot auto-approve a discrepant, high-risk or sanctions-related case. A risk score is never the sole rejection reason; coded facts and reviewable policy determine the outcome.

Conditions have owners, deadlines, evidence and consequences. Production activation remains blocked until all pre-activation conditions close. Rejection provides a safe reason category and correction/appeal route unless prohibited by law, security or anti-tipping-off constraints. Appeals are assigned independently of the original decision.

### 7.3 Ongoing reverification

Reverify on a risk-based schedule and on changes to legal status, RBI registration, directors/authorised representative, ownership/control, corporate domain, contract, deployment, products/DLAs/LSP relationships, sanctions/adverse events or security posture. Failed reverification may restrict new origination or administrative change before full tenant suspension, according to a documented proportional policy. Evidence is versioned; old evidence is never overwritten.

## 8. RBAC permission and decision model

Permissions use `resource.action` IDs such as `identity.invite`, `grant.propose`, `grant.approve`, `product.configure`, `product.activate`, `provisioning.execute`, `provisioning.approve_irreversible`, `audit.read`, `support.assume_case` and `tenant.activate`.

The authorisation input is:

```json
{
  "tenantId": "tenant_...",
  "membershipId": "membership_...",
  "sessionAssurance": { "mfa": true, "freshAt": "...", "source": "federated" },
  "permission": "grant.approve",
  "resource": { "type": "role_grant", "id": "...", "productId": null, "unitId": "...", "amountPaise": null },
  "actionContext": { "proposedBy": "...", "policyVersion": "..." }
}
```

Evaluation verifies active tenant/membership/session, assurance freshness, role versions, effective dates, scope inclusion, prerequisite/training state, static and transactional SoD, delegation and emergency-access restrictions. Output is `allow`, `deny` or `require_human`, with stable reason codes and policy lineage. Missing or unavailable policy evaluation returns deny/refer, never allow.

### 8.1 Grant workflow

`draft → proposed → approval_pending → approved → activation_pending → active → expiring → expired/revoked`

Privileged, custom, wildcard, external/support and SoD-exception grants require independent approval. A scope/role/date edit after proposal creates a new revision and invalidates approvals. Revocation is immediate in LoanOS and asynchronous-but-monitored downstream. Failed downstream removal triggers a security incident and containment, not a false successful projection.

### 8.2 Delegation and emergency access

Delegations are narrower than the delegator, date-bounded and prohibited for non-delegable permissions. Break-glass grants require incident/change reference, reason, maximum duration, MFA, independent approval where delay permits, real-time alerting, enhanced audit and post-use review. Break-glass never disables tenant isolation, audit or core SoD for money movement.

## 9. Transaction, idempotency and concurrency semantics

### 9.1 Atomic write unit

Within one database transaction, store:

- aggregate revision;
- command result/idempotency record;
- audit event/outbox event;
- unique binding/lookup claims;
- any same-database dependent aggregate transition expressly designed as atomic.

External email, verification and infrastructure calls occur after commit through an outbox. Callback application is another transaction.

### 9.2 Idempotency

The idempotency record key is `(actor-or-public-case, endpoint/command, idempotencyKey)`, with request-body canonical hash, response status/body reference and expiry. Same key/hash returns the prior result. Same key/different hash returns `409 idempotency_conflict`. Keys cannot be reused across tenants or commands.

Provider operations use a separate tenant-bound idempotency key and payload hash. Provider timeout remains `unknown` until poll/reconciliation proves outcome; the orchestrator must not blindly create a duplicate external resource.

### 9.3 Optimistic concurrency and uniqueness

- CAS on aggregate `revision`; stale commands return `409 revision_conflict` with no partial event.
- Unique organisation binding on normalised legal identifier and active relationship.
- Unique active membership by tenant and identity; unique active invitation by tenant/contact/access-request revision.
- Unique active bootstrap owner policy position, while recovery may replace it through a serialised transition.
- Privileged approval checks both proposal revision/checksum and current actor independence at commit time.
- Coverage and activation are recomputed in the activation transaction to prevent a concurrent suspension/grant revocation from slipping through.

### 9.4 Saga concurrency

One worker leases a ready step with monotonically increasing fence. Completion/failure must present worker, fence, unexpired lease and expected saga revision. External resources carry tenant/saga/step/idempotency tags for reconciliation. Cancellation and completion serialize on saga revision. Compensation waits for or fences outstanding forward work.

## 10. Error model

Errors have stable code, safe message, retry classification, correlation ID and optional field findings. Public endpoints deliberately collapse enumeration-sensitive states. Internal details and provider payloads are evidence references, not response bodies.

Representative codes include:

- `signup_rate_limited`, `challenge_invalid`, `challenge_expired`, `signup_case_expired`;
- `organisation_duplicate_review`, `organisation_verification_failed`, `representative_authority_unverified`;
- `admission_manual_review`, `admission_rejected`, `admission_condition_open`;
- `role_unknown`, `permission_unknown`, `scope_invalid`, `sod_conflict`, `minimum_coverage_missing`;
- `invitation_invalid`, `invitation_superseded`, `mfa_required`, `federation_claim_invalid`;
- `revision_conflict`, `idempotency_conflict`, `tenant_not_activatable`;
- existing provisioning saga codes for fencing, lease expiry, approval, checkpoint conflict and manual intervention.

## 11. Audit and event contract

Events carry event ID/type/version, tenant or signup case, actor/workload identity, action, subject type/ID, command/idempotency reference, before/after status, policy/version, evidence references/checksums, request/correlation/causation IDs, occurred/recorded timestamps, data classification, storage country and event checksum.

Required event families:

- `signup.case.*`, `contact.challenge.*`, `admission.verification.*`, `admission.decision.*`, `admission.appeal.*`;
- `organisation.*`, `tenant.reserved`, `tenant.lifecycle.*`;
- `identity.*`, `invitation.*`, `authenticator.*`, `session.*`, `federation.*`, `scim.*`;
- `access_request.*`, `role_grant.*`, `coverage.*`, `bootstrap.*`;
- existing `provisioning.*`, getting-started/product events and `tenant.activation.*`.

Audit payloads exclude passwords, OTPs, raw tokens, authenticator secrets, private keys, full PAN/GSTIN where not necessary, identity documents and unredacted provider payloads. Access to sensitive evidence is itself audited.

## 12. Security and privacy design

- WAF/API gateway plus application rate limits by IP prefix, device/risk bucket, contact lookup hash and organisation identifier hash.
- Generic challenge response; strict attempt/expiry/cooldown; single-purpose, single-use token with hashed storage.
- Passwords use the approved memory-hard/adaptive hash; compromised-password screening must preserve privacy. Privileged local accounts require MFA.
- Cookies are Secure, HttpOnly, SameSite; login rotates session; privileged actions require fresh MFA and CSRF defence.
- Sensitive columns use envelope encryption with tenant/case-bound authenticated data; keys are KMS/HSM managed and rotated.
- Evidence uploads enforce type/size, malware quarantine, checksum, India residency, least privilege, retention and legal hold.
- Provider callbacks require mTLS or signed timestamped payload, replay window, canonical hash and tenant/operation binding.
- Domain verification uses DNS TXT and/or controlled mailbox plus registry cross-check; it is evidence of control, not legal authority.
- Device/risk signals inform rate/manual review; protected or unverifiable attributes are not used for discriminatory admission.
- Privacy notice states purpose, data categories, recipients, retention, grievance/contact and rights. Consent is granular where it is the applicable basis; contract/legal/security bases are separately recorded.

## 13. Observability design

Metrics use bounded labels; no email, phone, organisation identifier, tenant name or token. Required metrics include signup starts/completions, challenge delivery/verification, duplicate/manual-review/rejection rates, verification-provider latency/error, queue age, invite acceptance/expiry, MFA/federation success, coverage blockers, provisioning step duration/retry/rollback/manual intervention, activation lead time and access deprovision lag.

Traces propagate correlation/causation across edge, outbox, provider and saga without sensitive payloads. Logs are structured, India-resident, time-synchronised, access-controlled and retained according to the security/regulatory schedule. Alerts map to runbooks in the operations document.

## 14. Test design and traceability matrix

| Area | Mandatory tests |
| --- | --- |
| Signup | happy path, challenge expiry/replay/resend, enumeration resistance, rate/device/contact/identifier limits, consent/version pinning, abandon/retention |
| Admission | exact/fuzzy duplicate, MCA/GST/RBI match/mismatch/unavailable, representative authority, sanctions/adverse/manual review, conditional approval, reject/correct/appeal, reverify/restrict |
| Tenant reservation | atomic organisation binding, idempotent replay, conflicting payload, concurrent double-submit, no direct active state |
| Bootstrap | token theft/replay/expiry, intended-contact mismatch, own credential, MFA required, expiry/extension/recovery, prohibited self-approval, automatic reduction |
| Role catalogue | every known role/permission, reject unknown, schema/version immutability, custom-role allow list, scope canonicalisation |
| SoD | every static pair, transactional same-object conflicts, non-overlap allowed cases, proposer/approver concurrency, exception expiry |
| Coverage | distinct-person counting, suspended/expired/untrained/no-MFA exclusion, backups, product-specific roles, last-admin/last-checker protection |
| Later user | invite/resend/revoke/accept, role acceptance, training, local/MFA, federation, SCIM create/update/deactivate, sponsor removal |
| Authentication | password/MFA lockout, session fixation/revocation, CSRF, recovery, federation signature/issuer/audience/time/key rollover, break glass |
| Tenancy | cross-tenant IDs/tokens/email collisions, RLS negative tests, SCIM filtering, audit/evidence isolation, worker scope |
| Provisioning | dependency order, leases/fences, timeout unknown, retry/backoff, approval of irreversible steps, compensation order/failure, reconcile match/conflict, cancel races |
| Activation | every missing/stale/wrong-tenant evidence, concurrent role loss, same-person conflicts, open conditions, deployment models, product/UAT/live-provider requirements |
| Security/privacy | upload malware/type/size, secret/log scanning, encryption/tamper, provider callback replay, abuse load, deletion/legal hold |
| Resilience | database/outbox/provider/KMS/DNS/queue outage, worker crash, regional recovery, backup restore, RTO/RPO, duplicate delivery |
| Accessibility | keyboard/screen reader/focus/error, Indian-language content/fallback, low bandwidth/resume |

### 14.1 End-to-end release scenarios

At minimum, execute:

1. new verified RE, shared multi-tenant, local bootstrap, two later users, one product, UAT and activation;
2. existing-organisation claim requiring tenant approval;
3. dedicated data plane with failed database step, retry and completion;
4. dedicated environment cancelled before irreversible boundary and fully compensated;
5. customer-managed private deployment with customer-owned checkpoints and acceptance;
6. high-risk admission manual review followed by conditional approval and later reverification;
7. bootstrap owner abandons; authorised-representative recovery and safe replacement;
8. invitation replay/expiry plus SCIM/federation onboarding and emergency deprovision;
9. activation blocked by one-person SoD/minimum coverage, then succeeds after independent user activation;
10. provisioning checkpoint conflict enters fail-closed operator recovery;
11. incident-driven tenant restriction and evidence-preserving restoration;
12. offboarding/portability with identity revocation and retained audit.

## 15. Deployment sequence

This is greenfield, so rollout is capability-gated rather than compatibility-gated:

1. canonical role/permission/SoD catalogue and evaluator;
2. signup/admission aggregates, restricted persistence and public abuse boundary;
3. tenant lifecycle states and atomic reservation without activation;
4. bootstrap invitation/credential/MFA and minimum coverage;
5. persistent provisioning workers/adapters and readiness join;
6. self-service UI and operator workbench;
7. federation/SCIM and customer-managed responsibility workflows;
8. complete end-to-end, security, resilience, DR and operations certification;
9. production enablement behind an explicit platform-admission feature gate.

The old direct active-tenant construction is test/dev fixture behavior only and must not remain a production route once this target is released.
