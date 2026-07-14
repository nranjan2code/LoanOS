# Backup, Disaster Recovery, and Business Continuity

Status date: 2026-07-14

## Control objective

LoanOS must recover tenant and control-plane state without accepting a corrupt, unauthenticated, cross-region, or operationally unapproved recovery point. The current implementation is an application-level recovery control and evidence slice. It does not claim database HA, PITR, multi-AZ/region failover, or a complete business-continuity programme.

## Recovery package

`POST /platform/recovery/backups` creates `loanos.recovery.v1`. Creation fails closed unless:

- the versioned master-key provider is configured;
- the manifest identifies an India source region, India residency, storage-location reference, future retention date, safe backup id, and specific reason;
- the state has valid control-plane/tenant structure;
- every active control-plane tenant has a data partition and every partition has a control-plane tenant; and
- the platform audit chain and every tenant audit chain verify completely.

The complete normalized state is encrypted with AES-256-GCM. Its key is derived from the selected master key using a recovery-specific HKDF domain and the backup id, separating backup keys from live tenant envelope keys. The authenticated manifest binds backup/key identity, creation time, source/storage/retention posture, state version, tenant count, content size and checksum, and audit-chain heads. A separate checksum covers the complete manifest and ciphertext envelope.

The package contains credential-bearing state only as authenticated ciphertext. Recovery history stores only manifest/checksum evidence, never ciphertext or decrypted state.

## Validation and restore

`POST /platform/recovery/backups/validate` is non-mutating and available to platform admin, security admin, and auditor authority. It verifies package checksum, manifest authentication, key id, GCM authentication, plaintext checksum, JSON/state structure, tenant mapping, state version/count, and every audit chain.

`POST /platform/recovery/restores` is destructive and restricted to platform/security authority. It additionally requires:

- exact `expectedPackageSha256` confirmation;
- India residency and a named target region;
- recovery/change identifiers and a specific reason;
- an independent proposer; and
- `approvedBy` equal to the authenticated platform actor and different from the proposer.

After full validation, LoanOS appends `platform.recovery.restored` to the recovered platform audit chain and saves the recovered state plus evidence together. There is no permissive partial restore. If target RPO/RTO is breached, recovery still completes—availability must not remain down merely to preserve a KPI—but status becomes `restored_objectives_breached` for remediation.

## RPO and RTO

The caller supplies the recovery declaration time and approved targets:

- actual RPO = recovery declaration time − backup creation time, floored at zero;
- actual RTO = recovered/exercise completion time − recovery declaration time.

Both are recorded with targets and individual pass/fail results. Production objectives must be defined per tenant/service tier and contract; the API does not invent contractual targets.

## Recovery exercises

`POST /platform/recovery/drills` decrypts and validates the actual selected package without modifying live state. Supported scenarios are:

- backup restore;
- data corruption;
- availability-zone failover;
- regional failover;
- failback; and
- business continuity.

Every exercise requires a change ticket, reason, independent proposer/authenticated approver, RPO/RTO targets, and a declared recovery time. Findings or objective breaches set `needs_remediation`; follow-up actions are retained with the exercise in the platform audit chain. `GET /platform/recovery/history` exposes backup/restore/exercise evidence without package ciphertext.

## Operator procedure

1. Declare the incident and preserve its timestamp; open the governed incident record when applicable.
2. Select the newest recovery point that predates corruption and remains inside approved retention. Confirm its India location, key availability, checksum, and expected RPO.
3. Run package validation before any restore. A failed check blocks restore; never bypass package, GCM, content, state, tenant, or audit integrity errors.
4. Obtain independent restore approval and change ticket. Confirm target region/residency and the exact package checksum out of band.
5. Restore first into the designated isolated recovery environment in production operations, execute application/finance reconciliation and smoke tests, then promote traffic under the infrastructure runbook.
6. Record actual RTO/RPO, data reconciliation, tenant communication, regulatory impact, findings, and remediation. Exercise failback separately.

## Production completion requirements

Before D4 Production, the adopting RE and LoanOS operator must evidence:

- database-native full/incremental/WAL backup, PITR, corruption detection, and automated backup cataloguing;
- immutable India-hosted multi-account custody, retention/expiry/legal hold, KMS/HSM keys, access monitoring, and restore-only permissions;
- automated schedules with missed/failed backup alerts and independent restore verification;
- multi-AZ/region database replication plus ordered traffic, data, queue, object, secret, provider, and decision-engine failover/failback;
- isolated recovery infrastructure and application, ledger, payment, audit, and reporting reconciliation;
- dependency/vendor continuity, workforce/site loss, manual business workarounds, tenant/status/regulatory communications, and crisis command;
- contractual per-service RTO/RPO, capacity under degraded mode, and at least annual independently witnessed BCP/DR exercises; and
- tracked remediation closure and board/RE assurance evidence.

Until these controls are implemented and exercised, OPS-003, OPS-004, and OPS-005 remain `Partial`.
