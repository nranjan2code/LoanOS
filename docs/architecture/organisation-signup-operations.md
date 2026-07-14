# Organisation Signup and Bootstrap Identity Operations

## 1. Purpose and operating posture

This runbook governs the public-to-production path for a new LoanOS RE tenant and the joiner/mover/leaver path for its administrators and staff. It is designed for a regulated SaaS control plane: signup is an application for admission, not instant account creation, and production activation is an independently approved operational event.

The official-source applicability and admission gates are maintained in [platform-admission-control-map.md](../compliance/platform-admission-control-map.md). This runbook does not treat LoanOS platform admission as borrower KYC. Borrower KYC/CDD is the RE's regulated customer process and remains in the lending modules. Platform admission verifies the prospective contracting organisation and representative to prevent impersonation, misuse and unsafe provisioning.

## 2. Service ownership and RACI

| Activity | Accountable | Responsible | Consulted | Informed |
| --- | --- | --- | --- | --- |
| Admission policy/risk appetite | LoanOS compliance head | Admission-control owner | Legal, security, product | Support, sales |
| Automated verification adapters | Platform engineering head | Integration/SRE team | Compliance, vendor management | Admission operations |
| Manual organisation/representative verification | Admission operations head | Assigned verifier | Compliance/legal | Applicant |
| Admission decision | Compliance/business authority | Admission maker and independent checker per tier | Security/legal | Applicant, provisioning |
| Contract/DPA/order readiness | Commercial/legal owner | Legal and deal operations | Security, compliance, finance | Applicant |
| Tenant reservation | Platform product owner | Control-plane service | Admission, SRE | Tenant owner |
| Identity/bootstrap operations | IAM owner | IAM operations | Security, tenant owner | Support |
| Deployment blueprint approval | Architecture owner | Architecture maker/checker | Security, SRE, tenant technology owner | Admission/product |
| Provisioning execution | SRE owner | Leased provisioning workers/operators | IAM, database, network, security | Tenant owner |
| Irreversible-step approval | Change authority | Independent approver/witness | SRE, tenant owner | Audit |
| Product/UAT readiness | Tenant business owner | Implementation team | Product, finance, compliance, security | Operations |
| Production activation | Platform service owner | Activation proposer and independent approver | Tenant executive, compliance, security, SRE | Support/all stakeholders |
| Operational handover | Operations head | Service transition manager | SRE, security, tenant operations | Support desk |
| Access review | Tenant accountable owner | Independent access reviewer | IAM, managers, audit | Users |
| Incident restriction/restoration | Security incident commander | Security/SRE | Compliance, tenant incident contact, legal | Executives/support |
| Offboarding/exit | Service owner | Exit manager | Tenant, legal, security, data/infra owners | Audit/support |

No RACI assignment removes mandatory separation. One person may hold multiple organisational responsibilities only where the SoD policy and the specific action permit it.

## 3. Queues and case priorities

| Queue | Entry condition | Target handling |
| --- | --- | --- |
| Contact/abuse review | Challenge anomaly, velocity/device/domain signal | Automated cooldown or security review |
| Duplicate organisation | Legal identifier/domain/name candidate | Prevent second tenant; resolve ownership safely |
| Standard verification | Complete low-risk case | Verify official sources and representative authority |
| Enhanced due diligence | Mismatch, high-risk use, adverse/sanctions signal, unusual structure | Trained analyst plus checker/legal as required |
| Request for information | Missing/correctable evidence | Applicant-facing dated request; no production access |
| Admission appeal | Eligible rejected decision | Reviewer independent of original decision |
| Provisioning retry | Retryable step failure | Automated bounded retry/backoff |
| Provisioning manual intervention | Exhausted retry, compensation/checkpoint conflict | Incident/change-controlled operator recovery |
| Bootstrap expiry/recovery | Owner inactive, token expired, staffing incomplete | Verified representative recovery workflow |
| Identity/security exception | MFA/federation/SCIM/grant conflict | IAM/security review |
| Activation blocker | Readiness evidence absent/stale/wrong tenant | Owning workstream remediation; no waiver by support |

Queue dashboards show safe case references, age, risk tier, current stage, owner and next action. Sensitive identity/legal data is opened only after case assignment and is access-audited.

## 4. Service objectives and indicators

These are initial internal objectives, not contractual promises. Contracts may define stricter targets by deployment model.

| Service indicator | Initial objective | Measurement boundary |
| --- | --- | --- |
| Public signup/challenge API availability | 99.9% monthly | Valid requests excluding planned maintenance and upstream provider failure shown separately |
| Authenticated admin/identity API availability | 99.95% monthly | Server-side success/latency |
| Signup API latency | p95 ≤ 500 ms excluding external verification | Edge to committed response |
| Challenge dispatch enqueue | p95 ≤ 2 s | Commit to durable outbox/queue; delivery measured separately |
| Verification adapter completion | p95 ≤ 5 min when provider is available | Queue to reconciled result; manual cases excluded |
| Standard manual admission first action | 4 business hours | Ready-for-review to analyst action |
| EDD/appeal first action | 1 business day | Queue entry to assigned review action |
| Invite dispatch enqueue | p95 ≤ 2 s | Approved invitation to durable dispatch |
| Urgent user suspension/session revocation | p95 ≤ 5 min | Approved/incident command to all LoanOS sessions revoked |
| SCIM deactivation propagation | p95 ≤ 5 min, p99 ≤ 15 min | Valid request to downstream reconciliation |
| Shared-tenant infrastructure provisioning | 95% ≤ 30 min after all inputs | Saga planned to infrastructure foundation ready; product/UAT excluded |
| Stuck provisioning detection | ≤ 5 min after lease/age threshold | Alert evaluation |
| Audit event durability | No acknowledged mutation without committed event/outbox | Transactional invariant |
| Recovery objectives | Per approved deployment blueprint | Evidenced restore/drill, not assumed |

Track manual-review false positives, rejection reversals, invitation failure, accessibility/help requests and abandonment by stage. Do not optimise approval speed at the expense of admission quality or independent control.

## 5. Standard operating procedure: new organisation

### 5.1 Intake and abuse gate

1. Confirm edge, rate-limit, challenge-provider and fraud-signal health.
2. Accept only the current terms/privacy versions; preserve evidence of older-case acceptances.
3. Apply limits by IP/network, device/risk bucket, contact lookup hash, domain and legal identifier. Never log the raw token or full identifiers.
4. Uniformly acknowledge challenge and case requests to prevent enumeration.
5. Route elevated but non-conclusive signals to manual review. Block clearly abusive automation with cooldown and security evidence.

### 5.2 Organisation and representative verification

1. Compare legal name, CIN/LLPIN/status/registered office against official MCA evidence where applicable.
2. Verify PAN status/name through an approved official/provider surface and GSTIN legal name/status/place where applicable.
3. Verify RBI/other regulator category, licence/CoR and current status against official directories/evidence; record observed time and source.
4. Verify the representative's identity and corporate authority through board resolution/authority letter/DSC or independent corporate contact.
5. Prove corporate-domain control and cross-check it against official records. Domain proof alone does not prove authority.
6. Screen duplicates, internal denylist and policy-required sanctions/adverse risk. Resolve possible matches rather than automatically rejecting on fuzzy similarity.
7. Record every discrepancy, evidence reference, checksum and policy outcome.
8. For EDD, obtain the additional facts required by the risk tier and perform maker-checker review. Do not copy irrelevant personal data into notes.

### 5.3 Contract and admission

1. Confirm MSA/order, DPA/processor terms, SLA/support, audit/RBI access, incident notification, subcontractors, India residency, BCP/DR, exit/portability and acceptable-use obligations.
2. Record the intended products, DLA/channel/partner model, deployment topology, data classes and expected volumes.
3. Admission maker proposes the exact evidence checksum and coded outcome.
4. Checker confirms authority, conflicts, conditions and evidence freshness where policy requires independent approval.
5. Approved cases enter `verified_pending_provisioning`; conditional cases remain blocked on their pre-activation conditions.
6. Rejection communicates a safe reason category and correction/appeal process when permitted. Never disclose fraud rules, sanctions-sensitive details or another tenant's existence.

### 5.4 Tenant reservation and bootstrap

1. Reserve the tenant ID and unique organisation binding idempotently. Confirm tenant status is not `active`.
2. Generate a single-use bootstrap invitation; deliver it to the independently verified contact. No operator sets the owner's password.
3. Verify invitation acceptance, credential enrollment, mandatory MFA and recovery contact.
4. Confirm `bootstrap_owner` expiry and restrictions are visible to the user and monitoring.
5. Owner selects deployment model/products, configures structure and invites independent officers.
6. IAM monitors minimum staffing, invitation age, MFA/training and SoD. Support may explain blockers but cannot waive them.

### 5.5 Provisioning and configuration

1. Compile the plan only from an approved deployment blueprint and tenant-scoped resource names.
2. Execute leased/fenced steps. Store external resource identifiers and checkpoint checksums.
3. On timeout, poll/reconcile before retrying creation. Treat unknown external outcome as unknown, not failed.
4. Obtain approval before migration/initial-data and activation irreversible boundaries.
5. Configure product, workflow, channel, partner, integration, finance, compliance, reporting, training and UAT workstreams.
6. Mocks/simulators are allowed in sandbox but mark provider mode visibly. Live launch requires live provider certification/readiness where applicable.
7. Complete operations/security/finance/compliance/UAT handover evidence with independent acceptance.

### 5.6 Activation and bootstrap reduction

1. Regenerate coverage and readiness immediately before proposal.
2. Validate all evidence is same-tenant, current, approved and bound to the exact deployment/product/configuration revisions.
3. Activation proposer freezes the decision checksum; approver independently reviews; handover acceptor confirms operational ownership.
4. Commit tenant `active` and activation decision atomically, then enable production routing through idempotent adapters.
5. Reduce bootstrap authority to approved permanent grants. Confirm the owner cannot retain unapproved auditor/checker/security powers.
6. Revoke bootstrap-only sessions/tokens, issue the production welcome/handover pack and start hypercare.

## 6. Standard operating procedure: next user

1. Require an approved sponsor/manager and exact role/scope/dates/justification.
2. Run canonical-role, prerequisite, static/transactional SoD and coverage-impact checks.
3. Obtain independent approval for privileged/custom/wildcard/external/support grants.
4. Issue invitation; verify delivery. Resend revokes the previous token.
5. Invitee verifies contact, establishes credential/federation, enrolls MFA, accepts duties and completes required training.
6. Activate membership/grants and reconcile queue/group/application provisioning.
7. Verify the user can reach only assigned tenant/product/unit/channel/queue scope through positive and negative smoke tests.
8. Schedule access review and role/training expiry. Immediate suspension revokes sessions and machine credentials delegated to the user.

For movers, calculate removed and added access as one governed plan; remove obsolete access before or atomically with elevated access. For leavers, suspend immediately on authoritative event, revoke sessions/tokens/service delegations, reconcile downstream removal and preserve evidence.

## 7. Monitoring and alerts

| Alert | Severity | First response |
| --- | --- | --- |
| Public signup enumeration/rate anomaly | High | Enable stricter challenge/cooldown, inspect safe signals, preserve evidence |
| Repeated legal identifier/domain claims | High | Quarantine cases; duplicate/impersonation investigation |
| Verification provider signature/schema failure | High | Open circuit, fail closed, contact vendor; no manual pass based only on callback |
| Admission queue age breach | Medium/High by risk | Assign backup reviewer; communicate delay safely |
| Privileged invitation/token anomaly | High | Revoke invitation/sessions, contact verified sponsor, security investigation |
| MFA/federation failure spike | High | Check provider/key/time state; preserve break-glass path |
| SCIM deactivation lag | Critical for leaver | Suspend in LoanOS, revoke sessions, reconcile downstream, incident if SLA breached |
| Role coverage drops below production minimum | High | Restrict affected approvals/new production actions per policy; notify tenant owners |
| SoD conflict appears | Critical if active | Freeze affected permission/action, revoke/adjust grant through controlled response |
| Provisioning lease/checkpoint conflict | High | Fence worker, stop affected saga, reconcile external reality |
| Compensation failure/manual intervention | High | Incident/change record, named recovery owner, prohibit activation |
| Tenant activation without complete evidence | Critical | Restrict tenant immediately, incident, audit evidence and root-cause review |
| Cross-tenant access signal | Critical | Contain platform/tenant scopes, preserve logs, invoke regulatory/contract incident process |
| Licence/legal status adverse change | Critical/High | Admission reverification; suspend branding/new origination or tenant per policy |

Alert payloads contain tenant/case references and coded facts, not credentials or identity documents. All critical alerts page a human and have a tracked acknowledgement/escalation clock.

## 8. Failure-mode runbooks

### 8.1 Email/SMS delivery outage

- Keep cases/invitations pending; do not mark delivery or verification successful.
- Retry through the durable queue within policy and expose a safe delay message.
- Do not switch to an unapproved personal channel.
- Reconcile provider callbacks/polls; revoke duplicate/superseded tokens.
- If prolonged, activate the approved alternate provider under change control and validate DLT/template/sender configuration.

### 8.2 Official registry or verification-provider outage

- Open circuit after threshold; classify tasks as unavailable/retry, not pass/fail.
- Retain submitted state and next retry time.
- Manual verification is permitted only with the approved evidence hierarchy, trained reviewer and required checker.
- Reverify automated sources before production if manual evidence is time-limited.

### 8.3 Duplicate organisation or impersonation

- Quarantine both the new claim and any unsafe public branding change; do not disclose existing tenant users.
- Notify the existing tenant through verified contacts without forwarding applicant secrets.
- Require independent authority proof and security review.
- Record decision/rejection and monitor repeat attempts; escalate credible fraud.

### 8.4 Lost bootstrap owner

- Expire/revoke outstanding bootstrap token and sessions.
- Start an ownership-recovery case using official organisation contacts and new authority evidence.
- Require an admission/IAM maker-checker decision. Support cannot edit the owner directly.
- Issue a new bootstrap revision; invalidate approvals tied to the old identity and reassess role coverage.

### 8.5 MFA loss or suspected account takeover

- Suspend sessions and active recovery flows; confirm through verified independent channels.
- Privileged reset requires approved recovery evidence, cooldown, independent approval and new MFA.
- Revoke old authenticators/recovery codes, rotate affected credentials and review activity.
- Treat suspicious privileged use as a security incident.

### 8.6 Federation lockout/key rollover

- Validate issuer availability, metadata/signature, audience, clock and key rollover.
- Use only audited break-glass accounts; never disable authorisation/tenant scoping.
- Roll back the federation policy revision if tested and approved.
- Reconcile sessions/claims before re-enabling enforcement and complete post-incident review.

### 8.7 Provisioning step timeout/worker death

- Wait for lease expiry and increment the fence before reassignment.
- Inspect external resource tags/poll API before retry.
- Reconcile matching same-tenant checkpoint; fail closed on checksum or ownership conflict.
- Do not hand-edit the saga to `completed`.

### 8.8 Exhausted retry and rollback

- Enter `rollback_required`; freeze new forward work.
- Approve rollback scope when policy requires and lease reverse-order compensations.
- Preserve irreversible/WORM/audit/data evidence. Never destroy evidence to make rollback appear clean.
- Compensation failure enters `manual_intervention`; open incident/change and document external reality.

### 8.9 Accidental/premature activation

- Immediately restrict production routes and service credentials while preserving audit/exit access.
- Snapshot tenant, activation evidence, sessions, grants, deployments and audit chain.
- Assess borrower/financial activity and cross-tenant/security impact; invoke incident notification obligations.
- Correct through an independently approved recovery decision—never rewrite the historical event.

### 8.10 Required officer departure

- Suspend identity and sessions immediately.
- Recompute coverage/SoD and invalidate pending approvals made ineffective by policy.
- Restrict affected high-risk functions; appoint trained replacement through governed grant workflow.
- Do not keep a departed identity active to satisfy a dashboard count.

## 9. Reverification operations

Schedule by admission risk and at material events. Daily/near-real-time monitoring should cover known licence/legal/sanctions/security triggers where approved sources support it; full evidence renewal occurs at the policy interval.

Material changes include legal name/status, merger, ownership/control, directors/authorised representatives, RBI CoR/category/status, GST/PAN anomalies, domain, products/DLAs, LSP/partners, deployment/residency, contract, adverse enforcement, security incident or prolonged inactivity.

The reviewer compares new source observations to the pinned prior version, classifies impact and proposes `no_change`, `information_required`, `condition`, `restrict`, `suspend` or `terminate`. High-impact decisions are independently approved. Restrictions are proportionate but fail closed for unverified regulated authority, impersonation or tenant-isolation risk.

## 10. Evidence, privacy and records operations

- Evidence vault access is case/role/purpose scoped and reviewed.
- Every download/view of restricted evidence is audited; bulk export is prohibited outside approved audit/legal workflows.
- Retention classes distinguish abandoned/rejected applications, admitted-customer contract/identity evidence, security/fraud evidence, authenticator metadata and audit events.
- Legal/regulatory/security holds override deletion through an approved, visible hold. Expiry resumes deletion.
- Applicant correction changes the current view but preserves immutable decision/audit lineage.
- Never place identity documents, OTPs, password/MFA secrets, provider credentials or raw tokens in tickets, chat, email or general logs.
- Provider and subprocessor records must include India/cross-border location, purpose, fields, retention, contractual deletion and incident obligations.

The privacy schedule must be reviewed against the [Digital Personal Data Protection Act, 2023](https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf) and the official [Digital Personal Data Protection Rules, 2025](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa), including their applicable commencement schedule; this document does not invent a universal retention duration.

## 11. Incident and regulatory/contractual coordination

Security events follow the platform incident process. CERT-In's directions dated April 28, 2022 cover reportable cyber incidents, time synchronisation and protected logs; current official material is linked at [CERT-In Directions under section 70B](https://cert-in.org.in/Directions70B.jsp). The operations team must maintain a decision tree and contacts capable of meeting applicable CERT-In, RBI/RE contractual and other legal notification clocks. A six-hour clock is not a target to wait for; evidence and customer notification coordination begin immediately.

The tenant RE remains responsible for its regulatory duties. LoanOS supplies timely facts, evidence, preservation, audit/regulator access and remediation under contract. Communications are coordinated with incident commander, legal, compliance and the verified tenant incident contacts. Support staff must not speculate or promise regulatory outcomes.

## 12. Backup, disaster recovery and business continuity

### 12.1 Protected assets

Back up and restore-test the organisation/tenant registry, signup/admission decisions, restricted evidence metadata and encrypted objects, identities/grants/federation policies, idempotency/outbox, audit chain/anchors, deployment blueprints/plans/sagas/checkpoints and activation evidence.

### 12.2 Recovery rules

- Recovery uses the approved deployment model's RPO/RTO and India-residency boundary.
- Keys, database, object/evidence store, audit anchor, queue and configuration are restored in documented dependency order.
- Validate tenant binding, encryption envelopes, hash chain, unique organisation binding, idempotency records and saga fences before reopening writes.
- Do not replay external side effects until reconciliation proves their outcome.
- Restore does not reset bootstrap/token expiry, revive revoked grants or reopen consumed invitations.
- A restored activation decision must match current infrastructure/readiness; otherwise tenant remains restricted pending validation.

### 12.3 Exercises

At least annually and after material topology change, exercise control-plane recovery and one representative tenant per deployment model. Include verification/provider outage, outbox replay, identity/session revocation, federation failover, provisioning worker recovery, checksum conflict, evidence restore, customer-managed responsibility handoff and portability/exit. Record measured RTO/RPO, defects, owner and closure evidence.

## 13. Support model

Support may explain status, resend through the governed command, start verified recovery, collect an RFI response and route a case. Support may not approve admission, reveal duplicate-tenant details, view identity evidence without case assignment, set a user's password, disable MFA, grant roles, alter saga checkpoints or activate a tenant.

Privileged support access is tenant-approved or incident-authorised, case-scoped, time-limited, MFA protected, fully audited and reviewed. Customer-managed deployments follow the blueprint responsibility matrix; a customer-owned component is not silently operated by LoanOS.

Escalation paths include admission operations, IAM/security, SRE/provisioning, integration vendor, privacy/legal, compliance, commercial and executive incident management. The support knowledge base must contain safe messages for pending, RFI, delay, rejection/appeal and outage without leaking detection logic.

## 14. Daily, weekly, monthly and quarterly controls

### Daily

- review critical alerts, aged admission/provisioning/manual-intervention queues and deprovision failures;
- reconcile notification/verification callbacks and external unknown outcomes;
- monitor licence/legal/adverse triggers and expiring bootstrap/invitations;
- confirm audit/outbox, KMS, queue and time-synchronisation health.

### Weekly

- review admission decision quality/overrides, rejection appeals and support escalations;
- inspect stuck provisioning, retries, compensation and capacity trends;
- review privileged grants, break-glass use, SoD/coverage findings and federation/SCIM errors;
- validate provider SLA and security issues.

### Monthly

- access review for LoanOS admission/support/provisioning operators;
- metrics/SLO/error-budget and risk committee pack;
- idempotency/outbox/audit completeness sampling;
- deletion/retention/hold and evidence-access sampling;
- vendor concentration, expiry and live-certification review.

### Quarterly or risk-based

- tenant privileged-access certification and minimum-staffing attestation;
- official-source/admission-policy review and sample re-performance;
- SoD/custom-role simulation and exception review;
- restore/tabletop/incident and federation-break-glass exercises according to schedule;
- operations documentation, contacts and RACI recertification.

## 15. Go-live checklist

### Product and implementation

- [ ] Public signup UI/API implements resumable states and accessible safe errors.
- [ ] Admission aggregates, duplicate detection, RFI, decision, correction, appeal and reverification persist atomically.
- [ ] Tenant creation cannot set `active`; all production routes enforce lifecycle.
- [ ] Bootstrap invitation, own credential, MFA, expiry, recovery and automatic reduction work end to end.
- [ ] Canonical roles/permissions/scopes and all mandatory SoD rules are enforced by every route/workflow.
- [ ] Minimum distinct-person coverage is recomputed at activation and continuously monitored.
- [ ] Later user invite/local/federation/SCIM/mover/leaver paths are implemented and reconciled.
- [ ] Deployment blueprints and provisioning saga have persistent workers/adapters for each offered topology.
- [ ] Activation joins admission, identity, deployment, product/UAT and handover evidence.

### Integration and operational readiness

- [ ] Official-source/provider integrations are contracted, certified, signed/replay-safe and monitored; mocks visibly disabled for live mode.
- [ ] Email/SMS/DLT/domain/DNS/KMS/database/queue/storage/WORM/monitoring/backup adapters pass adverse conformance.
- [ ] Runbooks, dashboards, alerts, paging, case queues and support safe messages are production-ready.
- [ ] SLO/capacity/error-budget, backup/restore/DR and exit exercises pass for each deployment model.
- [ ] RACI, on-call, customer contacts, responsibility matrix and escalation paths are accepted.

### Security, privacy, compliance and assurance

- [ ] Threat model, privacy impact, retention schedule and provider/subprocessor register are approved.
- [ ] VAPT/security assurance, secret scanning, tenant-negative/RLS and abuse/load testing pass.
- [ ] Audit completeness/hash-chain/WORM/evidence access and CERT-In operational controls pass.
- [ ] Official regulatory-source map and legal/applicability review are current.
- [ ] Independent control assurance samples admission, bootstrap, roles/SoD, provisioning and activation.
- [ ] No critical/high findings or unapproved exceptions remain.

### Evidence and release decision

- [ ] Complete E2E matrix in the detailed design passes in a production-like India environment.
- [ ] Release, rollback, feature gate and canary/first-customer plan are independently approved.
- [ ] First customer admission is supervised with hypercare and predefined stop conditions.
- [ ] Operations handover pack is checksum-sealed and accepted.

## 16. Greenfield note

There is no legacy identity or tenant migration in scope. Test/dev bootstrap fixtures must not be promoted into production behaviour. Any pre-production seeded tenant is destroyed and recreated through the admission journey before real data or credentials are permitted. No compatibility aliases, silently normalised old roles or bypass endpoints remain in the production configuration.
