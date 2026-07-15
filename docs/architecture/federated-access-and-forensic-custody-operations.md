# Federated access, universal authorization and forensic-custody operations

## Purpose and boundary

This runbook is the production operating contract for enterprise staff login, SCIM joiner/mover/leaver signals, protected API authorization, the isolated platform-control fleet and external custody of API/UI activity. It complements the canonical role/staffing design. LoanOS contains executable protocol and fail-closed control logic; no commercial IdP, MDM, SIEM, WORM, KMS or mTLS service is presently connected.

## End-to-end trust path

1. A certified tenant federation policy pins protocol, issuer, audience/client id, HTTPS metadata, corporate domains, redirect URIs, group mappings, MFA/authentication-age requirements and optional WebAuthn/managed-device requirements.
2. `POST /auth/federated/start` creates a five-minute single-use state/nonce challenge. OIDC requires an S256 PKCE challenge; SAML returns a request/relay-state contract for the certified SAML gateway.
3. OIDC exchange sends the authorization code and verifier to the discovered HTTPS token endpoint, then verifies the ID-token signature against discovered JWKS plus issuer, audience/`azp`, time, nonce, subject, MFA and policy assurance. SAML exchange accepts only a gateway attestation that proves XML schema/signature, assertion encryption, issuer/audience, time window, request binding and assertion checksum.
4. The verified subject must already be an active SCIM-provisioned tenant user for the same policy. IdP claims never create a user or grant a LoanOS canonical role during login.
5. The issued session retains authentication source, assurance level, authentication methods, hardware/device evidence reference, policy id and evidence checksum. Raw tokens/assertions, private keys, device data and form values are not retained.
6. Every authenticated request and outcome enters the tenant activity chain. Every protected staff mutation is classified before dispatch. Active mode denies unclassified routes, missing/unsafe staffing, missing actor role, control-engine outage or identity/attestation mismatch.
7. Activity batches are exported from the verified chain and independently acknowledged into India-resident WORM compliance-mode custody. Reconciliation proves sequence coverage.

## SCIM service surface

The tenant is selected only from an active LoanOS service credential. `scim:read` allows discovery/list operations; `scim:write` allows User creation/deactivation. `*` is accepted only for explicitly issued bootstrap/integration credentials. Endpoints are:

- `GET /scim/v2/ServiceProviderConfig`, `/ResourceTypes`, `/Schemas`;
- `GET /scim/v2/Users` with optional exact `userName eq "..."` filtering;
- `POST /scim/v2/Users` with `x-loanos-federation-policy` and `Idempotency-Key`;
- `PATCH /scim/v2/Users/{externalId}` for `active=false` immediate containment;
- `GET /scim/v2/Groups` for approved policy mappings.

Create/update is idempotent and domain/policy/group bound. Group membership produces `pending_loanos_maker_checker` canonical-role requests. Deactivation immediately makes the login inactive, suspends the canonical principal, explicitly marks every persisted matching session revoked with actor/reason, records the revoked session IDs, assesses staffing loss, pauses affected features and opens escalations. Re-enabling a directory user does not restore historical LoanOS grants automatically.

Provider-initiated logout uses `POST /federation/v1/logout-events` with a tenant service credential scoped to `federation:revoke`. The trusted adapter must attest that it verified the provider signature and supply exact issuer/audience/policy/subject, a five-minute freshness limit, no more than a ten-minute validity window, an evidence checksum and an optional provider session id. Exact replay is idempotent; changed evidence under the same event id is rejected. Matching persisted sessions are revoked with exact attribution. The current endpoint is a non-live provider contract; production acceptance still requires a certified signature-validation adapter, provider-native global logout/token-revocation fixtures and witnessed latency evidence.

## Identity operations and deterministic conformance

The tenant IAM control room and `/admin/identity-operations/*` API govern planned metadata/signing-key rotation, emergency federation suspension, direct all-session containment, maker-checker authenticator recovery and provider-directory reconciliation. Rotation retains former key/metadata lineage and enforces a bounded overlap. Recovery excludes both the subject and proposer from approval and forces clean MFA re-enrolment after revoking all sessions. The separate canonical IAM workspace projects effective access, role/staffing approvals, hard SoD, ownership and emergency access without creating an alternate mutation path.

Governed operational runs find expired metadata, stale conformance, overdue requests/reviews, stale reconciliation, uncustodied activity and unsafe sessions. They may automatically revoke unsafe sessions, but never approve access/recovery/federation or close escalations. Maker-checker resilience drills measure detection, containment and recovery across identity and custody failures and require fail-closed plus complete-audit evidence.

The vendor-neutral conformance lab contains mandatory OIDC, SAML-gateway, SCIM, device-posture, isolated-control-engine and SIEM/WORM packs. Every pack includes cross-tenant, invalid-signature, replay, stale-evidence and provider-outage cases plus family-specific rollover/deactivation/custody cases. Campaigns require distinct proposal and approval and can produce only `simulator_certified`, never a live certification. See [tenant identity operations and conformance lab](identity-operations-and-conformance-lab.md).

## Universal mutation rollout

`LOANOS_UNIVERSAL_STAFFING` has three modes:

- `off`: local development only; no central classifier decision;
- `shadow`: handler remains available, but `access.authorization.decision` records the would-allow result and control-engine divergence;
- `active`: denial is enforced before the route handler.

Roll out one tenant at a time: configure and approve FST features; run shadow; inventory every unclassified path; resolve role/staffing gaps; compare local and isolated-engine decisions; obtain security/access-review approval; activate; test engine outage, wrong instance, wrong signing key and staffing removal. Production startup rejects any mode other than `active`. New mutation endpoints fail closed until added to the central classifier and covered by tests.

Identity-governance bootstrap/self-management endpoints are marked `self_governed`: their own canonical maker-checker and trusted-provisioning state machine remains authoritative so the control cannot deadlock its initial staffing. Borrower mutations use borrower-resource ownership. Service/agent routes use scoped workload identity and domain authorization; they never impersonate a human control role.

## Isolated control-engine fleet

Each tenant configuration must provide a unique HTTPS URL, unique `ctrl-*` instance id, mTLS client identity reference, expected server identity reference, trust-bundle reference and KMS/HSM bundle-signing key reference. No URL, process/pod, mutable cache, bundle, workload credential, key grant or audit partition may be shared with the business-decision fleet or another tenant.

The gateway requires response evidence for the expected instance and tenant pack. Hardened routes additionally require `transport.mtls_verified`, exact workload/peer references, `ruleset.signature_verified` and the exact signing-key reference. Failure is `deny`; production does not fall back to the JavaScript evaluator.

Provisioning order is identity/trust bundle → KMS/HSM signing grant → tenant control instance → signed platform-control pack → health/identity attestation → shadow comparison → independent activation. Rollback changes the active signed bundle or route revision with maker-checker evidence; it never redirects to the business engine. Deprovisioning revokes workload/key grants first, stops traffic, exports traces, destroys ephemeral state and retains audit/custody evidence.

## Activity export and WORM custody

`POST /activity/exports` specifies an export id, last exported sequence and retention end. The platform first verifies the complete activity hash chain, then returns a contiguous payload containing schema, tenant, range, previous hash, head hash and events plus a payload checksum. The batch stores no vendor claim until a different actor calls `/activity/exports/{id}/custody` with matching checksum, provider/custody references, India location, immutable WORM compliance mode, trusted timestamp and sufficient retention.

`GET /activity/exports` returns batches and reconciliation: event count, custody count, highest custodied sequence, pending batches, gaps and completeness. Overlap, tampering, checksum mismatch, short retention, non-India storage, mutable/governance-mode storage or self-approval is rejected.

Recommended schedule is continuous collector delivery plus at least daily sealed batches and daily reconciliation. Alert immediately on chain failure, export gap, overdue pending batch, custody mismatch, trusted-time failure or provider retention drift. Retain the originating human/session/request correlation when sending to SIEM; a collector/workload identity supplements rather than replaces it.

## Failure, recovery and rollback matrix

| Failure | Immediate behavior | Recovery evidence |
| --- | --- | --- |
| IdP discovery/JWKS/token endpoint unavailable | New federated login fails; existing sessions follow approved lifetime | Provider incident, endpoint/key recovery, successful adverse login test |
| Unknown/rotated signing key | Login denied; never accept an untrusted `kid` | Metadata/JWKS checksum, certified rollover, old/new overlap test |
| SAML gateway unavailable or invalid attestation | SAML login denied | Gateway signature/schema/encryption/request-binding test |
| MDM/posture stale or unsigned | Managed-device policy denies login | Signed fresh posture and device remediation reference |
| SCIM credential compromise | Revoke/rotate service credential; stop provisioning; reconcile IdP vs LoanOS | Credential event, user/group delta, leaver-latency report |
| SCIM deactivation removes last checker/admin | Revoke first; pause/escalate affected features | Restaffing, independent grants, readiness and escalation closure |
| Control engine unavailable/wrong identity/key | Protected mutation denied | Fleet incident, mTLS/key/instance attestation, replayed shadow corpus |
| New route unclassified | Protected staff mutation denied in active mode | Classifier mapping, policy owner approval and route test |
| Activity chain invalid | Export/view reports conflict; do not issue trusted batch | Incident, source recovery, independent integrity investigation |
| SIEM/WORM unavailable | Prepared batch remains pending and gap is visible | Provider custody receipt, checksum/timestamp/retention evidence |

## Production acceptance evidence

- LoanOS simulator-certified OIDC/SAML/SCIM/device/control-engine/SIEM-WORM packs, followed by vendor-specific positive/adverse conformance, PKCE interception, nonce/replay, audience mix-up, expired/not-yet-valid token and key-rollover tests;
- SCIM create, exact filter, duplicate, local-account collision, cross-tenant token, unknown group, deactivation and rehire tests with p95/p99 leaver latency;
- password/MFA/federated/WebAuthn/device/session/logout/recovery threat scenarios;
- complete mutation-route inventory with zero unclassified paths and shadow/active decision reconciliation;
- tenant-to-tenant and business-vs-control fleet isolation, mTLS peer mismatch, KMS key mismatch, outage, rollback and failover exercises;
- activity sequence completeness, external checksum, WORM retention/legal hold, trusted-time, restore and missing-collector detection;
- SOC, IAM, internal-audit and regulated-entity owner sign-off with dated evidence references.
