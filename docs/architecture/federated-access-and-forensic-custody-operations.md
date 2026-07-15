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

Create/update is idempotent and domain/policy/group bound. Group membership produces `pending_loanos_maker_checker` canonical-role requests. Deactivation immediately makes the login inactive, suspends the canonical principal, invalidates session resolution, assesses staffing loss, pauses affected features and opens escalations. Re-enabling a directory user does not restore historical LoanOS grants automatically.

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

- vendor-specific OIDC and SAML positive/adverse conformance, PKCE interception, nonce/replay, audience mix-up, expired/not-yet-valid token and key-rollover tests;
- SCIM create, exact filter, duplicate, local-account collision, cross-tenant token, unknown group, deactivation and rehire tests with p95/p99 leaver latency;
- password/MFA/federated/WebAuthn/device/session/logout/recovery threat scenarios;
- complete mutation-route inventory with zero unclassified paths and shadow/active decision reconciliation;
- tenant-to-tenant and business-vs-control fleet isolation, mTLS peer mismatch, KMS key mismatch, outage, rollback and failover exercises;
- activity sequence completeness, external checksum, WORM retention/legal hold, trusted-time, restore and missing-collector detection;
- SOC, IAM, internal-audit and regulated-entity owner sign-off with dated evidence references.
