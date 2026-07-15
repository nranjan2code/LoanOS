# Identity worker operations runbook

## Purpose and claim boundary

This runbook operates the tenant-fenced identity worker delivered in Bundle AK. It is an operational protocol runner, not an identity provider. Until a commercial adapter is selected, every execution is simulator-labelled and is ineligible for production activation evidence.

## Preflight

1. Confirm the tenant service credential is active, has only `identity-operations:work`, and is injected from the deployment secret manager.
2. Confirm the worker ID is unique within the tenant workload boundary.
3. Confirm `jobTimeoutMs < leaseMs`, the maximum batch is within provider rate limits, and API request timeout is below the lease.
4. For simulator use, record the non-production change ticket and set `LOANOS_ALLOW_SIMULATED_IDENTITY_WORKER=true`. Never reuse simulator evidence in a live activation assessment.
5. For a future live deployment, confirm all four injected ports have current vendor certification, India processing evidence, network allow-listing, key rotation and rollback approval. The generic runner intentionally cannot start live mode.

## Start and verify

Start the process using the environment contract in `deploy/identity-operations-worker.env.example`. Then verify:

```text
GET :3041/healthz  -> 200 and status healthy/degraded
GET :3041/readyz   -> 200 and ready true before scheduling work
GET :3041/metrics  -> Prometheus text without tenant data or credentials
```

Schedule a single canary job from the tenant identity administration API. Confirm the administration projection shows `scheduled -> leased -> completed` and the associated run is `completed`. A simulator canary must report `commerciallyLive: false`.

## Alert triage

| Signal | Immediate action | Recovery authority |
| --- | --- | --- |
| Readiness false | Stop new scheduling; inspect the last JSON run result and API/database availability. | Workload operator |
| Outcome persistence failure | Do not replay or force-complete. Wait for the lease to expire, prove database recovery, and allow a higher fence to reclaim. | Workload operator |
| Repeated lease expiry | Quarantine the worker instance; compare timeout/lease bounds and inspect provider latency. | Workload operator + security for suspected compromise |
| Retry exhaustion / DLQ | Investigate evidence and open escalation. Replay requires a separate human proposer and approver. | Tenant security/identity administration |
| Authentication failure | Revoke the credential if compromise is possible; pause affected jobs and issue a new scoped credential through governed rotation. | Tenant security administrator |
| Provider evidence mismatch | Fail closed, suspend the live adapter, retain exact request/response evidence, and initiate vendor incident procedure. | Identity owner + information security |

## Shutdown and restart

Send SIGTERM. The runner stops accepting new runs, aborts active handlers, waits for the current run boundary, and then closes health serving. Do not kill the process merely to clear a job. If termination happens mid-claim, the lease-expiry/higher-fence path is the only valid recovery.

After restart, verify readiness and run an empty/canary cycle. A stale process cannot persist an outcome because its old fencing token no longer matches.

## Dead-letter replay

1. Investigator reviews the job envelope, attempts, error evidence, alerts and escalation.
2. A human administrator proposes replay with a new job ID, idempotency key, reason and authorization reference.
3. A different authorized human approves it.
4. The platform creates a new immutable job linked to the original dead letter; it never mutates the failed job back to runnable.
5. Alert/escalation closure is a separate evidenced decision after the replay outcome is known.

## Evidence retained

- tenant/workload-derived claim identity;
- job envelope and payload checksum;
- attempt, lease, fence generation and run checksum;
- handler evidence reference, evidence checksum and result checksum;
- failure/retry/DLQ/alert/escalation lineage;
- independent replay authorization;
- API audit events and process health metrics.

## Production acceptance

Before declaring the worker live, execute the PostgreSQL claim-race test against the selected managed service, adverse provider UAT, credential rotation/revocation, timeout/retry/DLQ, pod termination, database failover, telemetry custody, load/soak and on-call exercises. Obtain institution and independent-security sign-off. Simulator completion is not acceptance.
