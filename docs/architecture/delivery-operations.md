# Release, Configuration, and Resilience Operations

Status date: 2026-07-14

## Purpose

This control plane makes production changes and resilience evidence reviewable and fail-closed. It does not deploy software itself. A production deployment controller must call these gates and refuse promotion when the projected release is not `canary_passed` or when institutional policy has unresolved drift/resilience failures.

## Release lifecycle

The current lifecycle is:

`pending_approval → approved → canary_passed → deployed → rolled_back`

A canary may instead enter `canary_failed`; it cannot promote, but may be re-evaluated after remediation.

Release creation requires an immutable SHA-256 artifact digest, source revision, target environment, risk, change ticket, authenticated proposer, rollback version/runbook, and references for tests, security scan, build provenance, and pre-release recovery point. Approval additionally fails closed unless the exact artifact/revision has a complete six-class scan bundle, signed/checksum-bound SBOM record, reconciled severe findings, and no unaccepted release-blocking vulnerability; the evaluated security gate is retained on the release. Approval and promotion actors must be independent of the proposer. Canary evaluation requires a minimum request volume plus error-rate and p95-latency measurements and thresholds. Rollback is available only from `deployed`, uses the predeclared target, and retains reason, approval and incident/change evidence.

All transitions append the complete current release projection to the platform audit chain. `GET /platform/delivery/controls` reconstructs current state from that chain; there is no mutable unaudited release row.

## Configuration controls

Each approved baseline is environment-specific and canonically SHA-256 hashed. Configuration keys must be uppercase bounded scalars. Keys suggesting passwords, tokens, private/master/API keys, credentials, or secrets are rejected. Secret dependencies are retained only as `kms://`, `vault://`, or `secret://` references.

Drift assessment produces exact lists for:

- expected keys missing from the observed snapshot;
- unexpected observed keys;
- changed expected/observed values;
- missing secret references; and
- unexpected secret references.

Parity assessment compares two active approved baselines. Environment-specific differences such as replica count may be explicitly excluded by key; exclusions remain visible in evidence and cannot contain arbitrary names.

## Resilience probe and assessment

Run the probe against an approved test target:

```bash
LOANOS_PROBE_URL=http://127.0.0.1:3040/health \
LOANOS_PROBE_CONCURRENCY=10 \
LOANOS_PROBE_ITERATIONS=1000 \
LOANOS_PROBE_TIMEOUT_MS=5000 \
node scripts/run-resilience-probe.mjs
```

Optional `LOANOS_PROBE_BEARER_TOKEN` or `LOANOS_PROBE_API_KEY` supplies authentication. Do not put tokens in the URL or evidence file. The probe is bounded to 100 workers, 10,000 requests, and 60-second per-request timeout. It measures request/error counts, status distribution, p50/p95/p99, throughput and duration. Transport errors and every non-2xx response count as failures.

The governed assessment supports load, soak, concurrency, volume, dependency-failure, recovery and degraded-mode scenarios. It recomputes error rate and throughput from counters/duration, verifies monotonic percentiles, evaluates declared volume/error/latency/throughput thresholds, and checksum-seals the normalized evidence. An authenticated platform approver, independent proposer, approval reference and change ticket are required.

## Operating sequence

1. Establish approved development/test/UAT/production baselines and resolve unexplained parity gaps.
2. Build once; preserve artifact digest and source revision, run and register all required security scans, register signed/checksum-bound SBOM evidence, resolve the security release gate, and register the release.
3. Obtain independent change approval. Create and verify the pre-release recovery point.
4. Exercise realistic load/resilience scenarios in an isolated environment and record assessments/findings/actions.
5. Deploy the same digest to a bounded canary. Record sufficient volume, error and latency evidence.
6. Promote only after canary pass and policy checks. Monitor operational health and finance/provider queues.
7. On regression, stop promotion or invoke the declared rollback; open an incident when applicable. Reconcile data/ledger/provider state before closure.

## Production completion gaps

Bundle E adds an independently approved production automation policy that must bind signed artifacts, SBOM/provenance, vault secrets, expand-contract migrations, progressive delivery, automatic rollback, continuous drift detection, India topology, PITR and a passing capacity assessment. Before D4 Production, connect that policy to authenticated scanners/CI/CD and cloud rollout controllers, verify submitted content rather than references, automate traffic and migrations, collect drift continuously, communicate maintenance, and run production-representative soak/peak, saturation, dependency and region-failure tests. OPS-011, OPS-012 and OPS-013 therefore remain `Partial`.
