# Tenant role, staffing, identity federation and activity-attribution design

Status: implemented control kernel and local API/UI slice; production identity-provider connections and isolated control fleet are not commercially live.

## 1. Purpose and interpretation

This is the canonical whole-system access model for a greenfield LoanOS tenant. It answers who may join, who may assign or revoke authority, how many distinct verified humans must exist before a feature operates, what happens when coverage disappears, how enterprise IdPs and agents participate, and how activity is attributed.

RBI directions require accountable governance, need-based access, privileged-access control, effective segregation of duties, independent assurance and auditable actions. They do not prescribe one universal job-title list for every bank, NBFC, HFC, co-operative bank and programme. The canonical catalogue below is the LoanOS control baseline. Each RE must map its board-approved organisation design and regulatory applicability to these roles; compliance/legal review remains required.

Primary sources include the [RBI IT Governance, Risk, Controls and Assurance Practices Directions, 2023](https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=12562) and the RBI KYC Direction requirements for the Principal Officer, Designated Director, allocation of responsibilities and independent evaluation. Product-specific applicability is maintained in the regulatory register.

## 2. Non-negotiable invariants

1. A role is permission data, never a free-text claim from a UI, API body, SAML assertion or SCIM group.
2. Only active, verified, MFA-bound human principals count toward human staffing. Invited, unverified, suspended, inactive or expired identities do not count.
3. One human may hold compatible roles, but cannot satisfy both sides of a required independent pair.
4. A fixed or dynamic agent has its own workload identity and human sponsor. It never counts as a human, and never acts as maker, checker, accountable officer, access reviewer or auditor.
5. External IdPs authenticate and provision identity facts. Their groups may request roles; they cannot grant LoanOS canonical authority.
6. Suspension, SCIM deactivation and approved revocation take effect first. Newly unsafe work is then paused, preserved and escalated. Containment is never blocked merely to retain staffing.
7. Planned inactivation is blocked until configured features are re-staffed or explicitly disabled. Physical deletion of an identity or its forensic history is not supported.
8. Closing a staffing escalation is itself maker-checker and requires the feature to be ready when the open pause is ignored.
9. Production access/staffing decisions execute in the isolated platform-control rules instance from ADR 0005. Unavailability or identity mismatch is a denial.
10. Every authenticated API request and material screen activity is attributable to tenant, principal, principal type, session/credential/delegation, request correlation and pseudonymised client/network fingerprints.

## 3. Zero-user organisation journey

1. Public signup creates only a prospect application; it creates no tenant and no authority.
2. Contact, legal entity, RE status, authorised representative, domain, sanctions/adverse-risk and contracting evidence are verified.
3. Independent platform admission maker/checker approves the organisation.
4. Provisioning creates an isolated tenant in `provisioning`, including business and platform-control runtime allocations. Rollback removes incomplete resources but retains the admission/audit record.
5. A time-bound invitation is issued to the verified representative. Password/MFA or certified federation evidence binds the first human.
6. Exactly that first active verified human receives expiring `bootstrap_owner`; a second verified representative receives independent `bootstrap_checker`.
7. Bootstrap grants the minimum operating roles, including a distinct access reviewer. Product/feature selection remains disabled until staffing checks pass.
8. UAT, handover, product, infrastructure and role-coverage gates pass. An independent checker completes bootstrap transition; temporary grants are retired and the accountable owner receives `tenant_owner` only.
9. After transition, tenant/user admins propose role changes and an independent `access_reviewer` approves them. No IdP administrator or agent can bypass this workflow.

## 4. Canonical principal types

| Type | Authentication | Authority rule | Lifecycle |
| --- | --- | --- | --- |
| Human | Local password + MFA or certified OIDC/SAML + IdP MFA | May hold compatible human roles; counts only while verified and active | invite → active → suspended → active/inactive; no physical deletion |
| Fixed agent | Verified workload identity, immutable definition, active human sponsor | Dedicated `automation_agent`, `ai_agent` or `integration_worker` roles only | active until suspended/revoked/definition retired |
| Dynamic agent | Same as fixed plus mandatory expiry of at most 24 hours | Same narrow agent roles and separate agent guardrail | expires automatically; new execution needs new identity/grant |
| Tenant service | Scoped service credential | API scopes only; not a human maker/checker | rotate/revoke/contain; never used for interactive UI |
| Platform staff | Platform session or governed break-glass | Platform roles only; tenant reach-in is separately logged | time-bound session/grant with tenant-visible audit |
| Borrower | Borrower challenge/session | Own-resource customer routes only | short-lived session; no staff authority |

## 5. Canonical role catalogue

The executable source is `CANONICAL_ROLE_CATALOGUE` in `packages/core/src/saas-identity-governance.js`. The complete grouped inventory is:

| Domain | Roles |
| --- | --- |
| Platform | `platform_admin`, `tenant_provisioner`, `platform_security_admin`, `platform_auditor`, `support_engineer`, `release_operator`, `release_approver` |
| Temporary bootstrap | `bootstrap_owner`, `bootstrap_checker` |
| Tenant administration | `tenant_owner`, `tenant_admin`, `user_admin`, `security_admin`, `access_reviewer`, `auditor`, `operator`, `integration_admin`, `workflow_admin` |
| Product/journey | `product_manager`, `product_approver`, `journey_admin`, `product_owner`, `product_checker` |
| Credit/origination | `loan_officer`, `credit_maker`, `credit_officer`, `credit_checker`, `human_reviewer`, `operations_maker`, `operations_checker`, `kyc_officer`, `kyc_checker`, `disbursement_maker`, `disbursement_checker` |
| Servicing/collections/legal/collateral | `servicing_maker`, `servicing_checker`, `collections_manager`, `collections_maker`, `collections_checker`, `legal_maker`, `legal_checker`, `collateral_maker`, `collateral_checker`, `security_officer`, `grievance_officer`, `grievance_checker` |
| Finance | `finance_admin`, `finance_maker`, `finance_checker`, `treasury_maker`, `treasury_checker`, `reconciliation_maker`, `reconciliation_checker`, `tax_maker`, `tax_checker` |
| Compliance/statutory/privacy | `compliance_officer`, `compliance_analyst`, `principal_officer`, `designated_director`, `reporting_officer`, `regulatory_reporting_maker`, `regulatory_reporting_checker`, `data_protection_officer`, `privacy_analyst` |
| Risk/model/fraud | `portfolio_risk_manager`, `risk_manager`, `model_risk_manager`, `model_owner`, `model_validator`, `fraud_investigator`, `fraud_classifier` |
| Technology/assurance/vendor | `chief_information_security_officer`, `head_of_it`, `internal_auditor`, `vendor_manager`, `vendor_risk_approver`, `change_manager`, `change_approver`, `business_continuity_manager`, `business_continuity_approver`, `data_migration_maker`, `data_migration_checker` |
| Non-human workload | `automation_agent`, `ai_agent`, `integration_worker` |

The hard incompatibility register includes platform administration/audit, release maker/checker, user administration/access review, security administration/audit, every operational maker/checker pair, Principal Officer/Designated Director, CISO/Head of IT, model owner/validator, fraud investigation/classification, vendor/change/recovery/migration/privacy/grievance pairs, and internal audit versus security/finance/integration/workflow administration.

## 6. Exhaustive feature staffing baseline

`A|B` means any one role in the set. A semicolon separates required sets. The minimum is the number of distinct verified active humans across all required sets. Conditional independent pairs apply only when that alternative role is staffed.

| ID | Protected capability | Required human role sets | Independent pairs | Min |
| --- | --- | --- | --- | ---: |
| FST-001 | Identity/access administration | `tenant_admin|user_admin`; `access_reviewer|security_admin` | user admin / access reviewer | 2 |
| FST-002 | Product configuration/publication | `product_manager|product_owner`; `product_approver|product_checker` | corresponding maker/checker | 2 |
| FST-003 | Credit underwriting/sanction | `loan_officer`; `credit_maker|credit_officer`; `credit_checker` | credit maker/officer / checker | 3 |
| FST-004 | Borrower KYC/AML onboarding | `kyc_officer`; `kyc_checker`; `principal_officer`; `designated_director` | KYC pair; PO/DD | 4 |
| FST-005 | Manual override/human review | `credit_maker|credit_officer`; `credit_checker`; `human_reviewer` | credit pair | 3 |
| FST-006 | Contract/disbursement | `disbursement_maker`; `disbursement_checker`; `operations_checker` | disbursement pair | 3 |
| FST-007 | Servicing adjustment/closure | `servicing_maker`; `servicing_checker` | servicing pair | 2 |
| FST-008 | Reconciliation/suspense/refund | `reconciliation_maker`; `reconciliation_checker` | reconciliation pair | 2 |
| FST-009 | Finance posting/EOD/close | `finance_maker`; `finance_checker`; `finance_admin` | finance pair | 3 |
| FST-010 | GST/TDS/tax filing | `tax_maker`; `tax_checker` | tax pair | 2 |
| FST-011 | Treasury/funding/settlement | `treasury_maker`; `treasury_checker` | treasury pair | 2 |
| FST-012 | Collections strategy/agency | `collections_manager`; `collections_maker`; `collections_checker` | collections pair | 3 |
| FST-013 | Cash/field collection posting | `collections_maker`; `collections_checker`; `reconciliation_checker` | collections pair | 3 |
| FST-014 | Grievance/Ombudsman response | `grievance_officer`; `grievance_checker` | grievance pair | 2 |
| FST-015 | Legal recovery/possession/auction | `legal_maker`; `legal_checker`; `compliance_officer` | legal pair | 3 |
| FST-016 | Collateral/security perfection | `collateral_maker|security_officer`; `collateral_checker` | corresponding maker/checker | 2 |
| FST-017 | Regulatory return submission | `regulatory_reporting_maker`; `regulatory_reporting_checker`; `reporting_officer` | reporting pair | 3 |
| FST-018 | AML monitoring/FIU reporting | `compliance_analyst`; `principal_officer`; `designated_director` | PO/DD | 3 |
| FST-019 | CIC furnishing/correction | `regulatory_reporting_maker`; `regulatory_reporting_checker`; `reporting_officer` | reporting pair | 3 |
| FST-020 | Model governance/validation | `model_owner`; `model_validator`; `model_risk_manager|risk_manager` | owner/validator | 3 |
| FST-021 | Privacy rights/disclosure/erasure | `privacy_analyst`; `data_protection_officer` | analyst/DPO | 2 |
| FST-022 | Provider activation | `integration_admin`; `vendor_manager`; `vendor_risk_approver` | vendor pair | 3 |
| FST-023 | Vendor outsourcing/renewal | `vendor_manager`; `vendor_risk_approver`; `compliance_officer` | vendor pair | 3 |
| FST-024 | Security administration/assurance | `security_admin`; `chief_information_security_officer`; `internal_auditor|auditor` | CISO/Head IT separation applies globally | 3 |
| FST-025 | Cyber incident/notification | `chief_information_security_officer`; `security_admin`; `head_of_it` | CISO/Head IT | 3 |
| FST-026 | Technology change/release | `change_manager`; `change_approver` | change pair | 2 |
| FST-027 | BCP/DR failover/failback | `business_continuity_manager`; `business_continuity_approver`; `head_of_it` | recovery pair | 3 |
| FST-028 | Migration/cutover/rollback | `data_migration_maker`; `data_migration_checker`; `finance_checker` | migration pair | 3 |
| FST-029 | Internal audit/control assurance | `internal_auditor`; `auditor`; `compliance_officer` | hard SoD catalogue | 3 |
| FST-030 | Product add-on/removal | `tenant_admin`; `product_manager|product_owner`; `product_checker|product_approver` | corresponding product pair | 3 |
| FST-031 | Tenant provisioning/handover | `tenant_admin`; `security_admin`; `auditor` | security/audit | 3 |
| FST-032 | Co-lending allocation/settlement | `finance_maker`; `finance_checker`; `compliance_officer` | finance pair | 3 |
| FST-033 | Fraud investigation/classification | `fraud_investigator`; `fraud_classifier`; `compliance_officer` | fraud pair | 3 |
| FST-034 | AI model/agent production action | `model_owner`; `model_validator`; `human_reviewer`; `model_risk_manager` | model owner/validator | 4 |

These are safe platform defaults, not a claim that every RE must use every feature or title. Tenant policy may tighten them, never weaken a regulatory/platform floor.

## 7. Assignment, revocation and recovery authority

| Operation | Proposer | Approver/enforcer | Critical rules |
| --- | --- | --- | --- |
| Bootstrap role grant | bootstrap owner | bootstrap checker | distinct from target; hard SoD; expiry-bound bootstrap |
| Post-bootstrap role grant/revoke | tenant/user admin | access reviewer | distinct proposer/target; exact scope; IdP cannot approve |
| Principal suspension | user admin/security containment path | immediate | self-disable denied; work pause follows containment |
| SCIM deactivation | certified IdP event | trusted SCIM boundary | login record inactive and canonical principal suspended in same tenant transaction |
| Planned inactivation | user admin | pre-retirement impact check | denied if last admin or configured feature would become unsafe |
| Emergency access | eligible requester | independent security admin | narrow allow-list, incident ref, at most four hours, explicit closure |
| Staffing configuration | role proposer | independent role approver + isolated control engine | every enabled feature must be ready |
| Staffing-pause closure | role proposer | independent approver not implicated in trigger | readiness must pass excluding only the pause being closed |
| Administrative lockout recovery | platform security recovery | platform auditor/approved runbook | no silent tenant impersonation; tenant-visible evidence |

Concurrent commands require unique request/idempotency IDs and state serialization. A stale approval cannot resurrect a superseded request. Restoring a principal does not restore revoked grants or close pauses; each requires its own governed action.

## 8. Enterprise identity providers

Supported policy types are Entra ID/Azure AD, Okta, AD FS, Keycloak, OpenLDAP through an OIDC/SAML bridge, and generic OIDC/SAML. Direct LDAP bind from the application is not a production pattern; a broker/bridge should provide modern protocol, MFA and signed metadata.

Required federation controls are HTTPS metadata, exact issuer/audience, PKCE for OIDC, signed assertions for SAML, enforced IdP MFA, allowed corporate domains, metadata checksum/expiry, tested login/logout/MFA, independent certification and emergency suspension. SCIM events are idempotent and evidence-hashed.

Group mappings can populate legacy workspace roles/queues and request canonical roles. Requested canonical roles enter the LoanOS maker-checker queue. Deactivation is different: it is a containment signal and suspends access immediately. Re-activation never silently restores revoked canonical roles.

No commercial IdP connection is live today. The runtime now performs OIDC discovery, authorization-code exchange with S256 PKCE, JWKS signature/issuer/audience/time/nonce validation, certified SAML-gateway attestation validation, MFA/WebAuthn/device assurance evaluation and RFC-shaped SCIM discovery/User/Group operations. Production still needs vendor tenant registration, certificates/credentials, a certified SAML XML gateway, signed device-posture adapter, metadata/key-rotation operation, logout/token revocation tests and commercial SLAs.

## 9. Authentication, authorization and forensic activity chain

Authentication establishes a principal and authentication strength. Authorization then evaluates tenant, principal status, current scoped grants, SoD, feature staffing, open pauses, module entitlement, emergency delegation and—where applicable—agent guardrails. The client never supplies the effective human actor.

Every authenticated tenant API request appends `access.api.request` before dispatch to a separate tenant-scoped hash chain. Keeping access observation separate prevents an audit read or external-anchor command from changing the business-event chain head it is trying to observe or attest. `GET /activity/events` verifies and returns the activity chain to tenant admin/security/auditor roles.

- tenant audit partition and tamper-evident chain position;
- request ID returned as `X-Request-Id`;
- authenticated principal ID/type;
- session ID, service credential ID or break-glass grant ID;
- HTTP method and path, excluding query string and body;
- pseudonymised network and client fingerprints.

After dispatch, the same request ID is paired with `access.api.response`, the final HTTP status and completion time. Thus denied, failed and successful requests remain distinguishable even when no business mutation occurred.

When `LOANOS_UNIVERSAL_STAFFING=active`, every authenticated staff `POST`, `PUT`, `PATCH` or `DELETE` is classified into one of FST-001..034 before handler dispatch. A new/unclassified mutation is denied. Classified mutations require current canonical role, configured feature readiness and an allow response from the isolated control engine. `access.authorization.decision` records feature, mode, decision and source. Identity-bootstrap/control endpoints remain self-governed by their stronger internal maker-checker state machine; borrower and workload routes retain their resource/scope controls rather than pretending to be a human role.

Interactive apps may append `ui.activity.recorded` for a strict allow-list: screen view, task open/close, action intent and validation error. Only stable screen/action/entity type IDs and an optional hashed entity reference are accepted. Form values, keystrokes, page contents, borrower data and free-text descriptions are rejected by contract. Dashboard task views and borrower-portal panel views are wired to this endpoint.

Domain events continue to record the business outcome, maker, checker, evidence and correlation. API request → UI event → workflow/domain event → integration request/callback → decision trace can therefore be joined by principal/session/request/entity correlation. External calls must propagate a correlation ID and workload identity; vendor acknowledgements return provider correlation without replacing the originating human/agent attribution.

`POST /activity/exports` creates an exact contiguous payload over the verified activity chain, including previous/head hashes and a payload checksum. A different authenticated approver records India-resident immutable WORM compliance-mode custody, trusted timestamp and retention evidence. Reconciliation reports gaps, overlaps, pending batches and the highest externally custodied sequence.

## 10. Operational scenarios

- Compromised user: suspend immediately; active session fails user resolution; new actions deny; features losing staffing open critical pauses; SOC evidence and reason retained.
- Last admin compromised: suspend anyway; administrative lockout escalation opens; governed platform recovery is used. Fraud containment is not delayed to keep an admin online.
- Maker leaves mid-task: committed events remain; uncommitted work is paused; checker cannot adopt maker identity; queue is reassigned after staffing recovery.
- Checker absent: feature stays configured but operationally disabled; work is visible in the staffing escalation queue.
- IdP outage: existing sessions follow tenant session policy; new federated authentication fails; no local password fallback unless separately enrolled and approved.
- IdP group removed: SCIM deactivation suspends identity; group additions only request roles.
- Agent sponsor suspended: sponsored agent becomes non-operational immediately. Dynamic agent expiry is checked at authorization time.
- Role expiry during approval: approval re-evaluates current authority and fails closed.
- Rehire/reactivation: identity may be re-verified, but historical grants and evidence are retained; new grants require fresh approval.
- Tenant offboarding: sessions, credentials, agents and engine instances are revoked; legal holds/audit evidence survive according to retention policy.

## 11. Implemented APIs

- `GET /admin/identity-governance/roles`
- `GET /admin/identity-governance/workspace` returns one tenant-contained administration projection: effective principal access, pending role/staffing/ownership/emergency requests, staffing readiness and escalations. It requires a same-tenant human session; service credentials cannot read it.
- `GET /admin/identity-governance/launch-coverage`
- `GET /admin/identity-governance/feature-readiness`
- `GET /admin/identity-governance/staffing-escalations`
- `POST /admin/identity-governance/staffing-config/proposals`
- `POST /admin/identity-governance/staffing-config/{requestId}/approval`
- `POST /admin/identity-governance/feature-actions/authorize`
- `GET /admin/identity-governance/principals/{id}/removal-impact`
- `POST /admin/identity-governance/principals/{id}/status`
- `POST /admin/identity-governance/principals/agents`
- governed role grant/revocation, bootstrap, ownership, emergency access and staffing-escalation closure routes under the same prefix
- federation policy and SCIM routes under `/admin/federation` and `/admin/scim`
- `POST /auth/federated/start`, `POST /auth/federated/exchange`
- SCIM 2.0 discovery plus `/scim/v2/Users` and `/scim/v2/Groups` using scoped tenant service credentials
- `POST /activity/screen-events`
- `GET /activity/events`
- `GET|POST /activity/exports`, `POST /activity/exports/{id}/custody`

## 12. Remaining production work

1. Run universal staffing in shadow for each tenant, close every `mutation_unclassified` or divergence, then activate; the active runtime is fail-closed but rollout evidence is still institution-specific.
2. Deploy the separately addressed control fleet and supply the required unique `ctrl-*` identity, mTLS client/server/trust references, KMS/HSM signing reference, audit sink and witnessed cutover evidence.
3. Complete IdP-specific conformance packs for Entra, Okta, AD FS, Keycloak and LDAP bridges; procure at least one production route and certify the SAML/device-posture adapters.
4. Operate and independently accessibility-test the dashboard access-governance workspace for canonical roles/SoD, effective principal access, role maker-checker, feature staffing, removal impact/status, escalations, governed agents, ownership and emergency access. Federation operations are available in the adjacent identity control room.
5. Connect prepared activity exports to a live India SIEM/object-lock provider and reconcile collector/provider acknowledgements on schedule.
6. Add risk-adaptive step-up, federation global logout/back-channel logout, token revocation/introspection and user-visible authenticator recovery.
7. Produce route-coverage, IdP key-rollover, leaver-latency, WORM restore and control-engine failover operating evidence before bank production.
