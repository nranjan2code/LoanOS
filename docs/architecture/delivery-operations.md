# Release, Configuration, and Resilience Operations

Status date: 2026-07-16

## Purpose

This control plane makes production changes and resilience evidence reviewable and fail-closed. It does not deploy software itself. A production deployment controller must call these gates and refuse promotion when the projected release is not `canary_passed` or when institutional policy has unresolved drift/resilience failures.

## Synthetic showcase controller boundary

`deploy/aws/` contains a separate generation-2 controller for the disposable
synthetic showcase. It provides selective server/browser packaging, immutable
checksummed S3 releases, first-boot CloudFormation provisioning, Systems
Manager updates, atomic host release switching, health-gated restoration, and
template-owned demo subdomains. It excludes Android applications and refuses
automatic database-schema changes.

That controller is production-like operational rehearsal, not the production
delivery controller described in this document. It does not satisfy the
human approval, scan/SBOM, canary, migration, India-residency, availability,
backup, secret-custody, or independently isolated tenant-engine requirements.
Its inputs must remain synthetic and its releases must not be recorded as
production admission evidence.

The detailed showcase contract is
[AWS synthetic showcase deployment](aws-showcase-deployment.md); exact operator
commands live in the [AWS runbook](../../deploy/aws/README.md), and presentation
and recovery procedure lives in the
[demo handbook](../operations/demo-handbook.md). Those documents cannot grant
production approval or weaken the human authority model below.

## Release lifecycle

The current lifecycle is:

`pending_approval → approved → canary_passed → deployed → rollback_pending_approval → rolled_back`

A canary may instead enter `canary_failed`; it cannot promote, but may be re-evaluated after remediation.

Release creation requires an immutable SHA-256 artifact digest, source revision, target environment, risk, change ticket, authenticated proposer, rollback version/runbook, and references for tests, security scan, build provenance, and pre-release recovery point. Approval additionally fails closed unless the exact artifact/revision has a complete six-class scan bundle, signed/checksum-bound SBOM record, reconciled severe findings, and no unaccepted release-blocking vulnerability; the evaluated security gate is retained on the release. Approval and promotion actors must be independent of the proposer. Canary evaluation requires a minimum request volume plus error-rate and p95-latency measurements and thresholds. Rollback is available only from `deployed`, uses the predeclared target, and retains reason, approval and incident/change evidence.

All transitions append the complete current release projection to the platform audit chain. `GET /platform/delivery/controls` reconstructs current state from that chain; there is no mutable unaudited release row.

## Human and AI authority model

Release actors are typed records rather than display-name strings. Every record carries `principalId`, `principalType` and `authenticationSource`. AI proposals additionally bind the credential, approved installation, model and model version, prompt SHA-256 and the guardrail decision reference. This provenance is copied into the immutable release projection and therefore survives later approval, canary, promotion and rollback events.

| Action | Human | AI agent | Service/platform key |
| --- | --- | --- | --- |
| Create a release proposal | Allowed with platform delivery authority | Allowed with an active scoped agent credential and complete model/guardrail lineage | Not an approval substitute; break-glass/bootstrap use only |
| Observe and submit canary measurements | Allowed | Allowed and attributed; measurements remain subject to deterministic thresholds | Allowed only where an authenticated automation boundary is explicitly configured |
| Approve a release | Independent authenticated human only | Forbidden | Forbidden |
| Promote to production | Independent authenticated human only | Forbidden | Forbidden |
| Approve rollback | Independent authenticated human only | Forbidden | Forbidden |

An AI agent is proposal-only even when its output is operationally useful. It cannot satisfy maker-checker, CAB, security, promotion or rollback approval. The domain layer enforces this independently of the HTTP role check, so a mis-scoped credential still fails closed.

The current executable agent authentication boundary is injected into the API process as `platformAgentCredentials`. A credential is accepted only when its `agentId`, secret and `active` state match using timing-safe comparison. It grants only `release_proposer`; unrelated platform routes and every release action endpoint remain forbidden. The credential metadata must include `credentialId`, `agentInstallationId`, `modelId`, `modelVersion`, `promptHash` and `guardrailDecisionRef`. Removing the credential or changing its state from `active` makes revocation effective on the next request; no cached agent session exists.

This injected boundary is the deterministic proxy until a commercial workload-identity and secret-manager integration is selected. Production must replace raw process configuration with India-resident secret custody or workload federation, short-lived credentials, automated rotation/revocation distribution, installation and model-governance lookups, and live `guardrail.*` evaluation. Missing or stale provenance must remain a denial.

## Governed API sequence

1. Human: authenticate with a platform session. AI: present `X-Platform-Agent-Id` and `X-Platform-Agent-Key` over TLS.
2. `POST /platform/delivery/releases` with the immutable artifact, source, change, rollback and evidence references. `proposedBy` must equal the authenticated principal; server-derived typed provenance overrides client attribution.
3. Register the exact artifact's scan bundle, SBOM and vulnerability disposition.
4. An independent human calls `POST /platform/delivery/releases/{id}/approval`. Agent credentials and platform bootstrap keys fail the human-authority gate.
5. Record canary evidence through `POST /platform/delivery/releases/{id}/canary`; a human or attributed agent observer may submit it.
6. An independent human calls `POST /platform/delivery/releases/{id}/promotion`.
7. If required, a human or scoped AI agent calls `POST /platform/delivery/releases/{id}/rollback-proposal` with the reason and incident/change evidence.
8. A different authenticated human calls `POST /platform/delivery/releases/{id}/rollback`; the declared target and both principals are retained.

Operational response is fail-closed: revoke the agent credential immediately, stop new proposals, preserve the platform event chain, identify proposals by `credentialId`/installation/model/prompt lineage, hold unapproved proposals, and independently decide whether approved releases require rollback or revalidation. Credential compromise never invalidates or deletes historical attribution.

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
2. Build once; preserve artifact digest and source revision, run and register all required security scans, register signed/checksum-bound SBOM evidence, resolve the security release gate, and register the human- or AI-proposed release with typed provenance.
3. Obtain independent change approval. Create and verify the pre-release recovery point.
4. Exercise realistic load/resilience scenarios in an isolated environment and record assessments/findings/actions.
5. Deploy the same digest to a bounded canary. Record sufficient volume, error and latency evidence.
6. Promote only after canary pass and policy checks. Monitor operational health and finance/provider queues.
7. On regression, stop promotion or invoke the declared rollback; open an incident when applicable. Reconcile data/ledger/provider state before closure.

## Production completion gaps

Bundle E adds an independently approved production automation policy that must bind signed artifacts, SBOM/provenance, vault secrets, expand-contract migrations, progressive delivery, automatic rollback, continuous drift detection, India topology, PITR and a passing capacity assessment. The repository now also has typed human/AI release principals, proposal-only scoped agent authentication, immutable model/prompt/guardrail lineage, human-only approval/promotion/rollback authority, and immediate request-time credential revocation. Before D4 Production, connect that policy to authenticated scanners/CI/CD and cloud rollout controllers; replace injected agent secrets with managed workload identity; evaluate live installation/model/guardrail state; verify submitted evidence content rather than references; automate traffic and migrations; collect drift continuously; communicate maintenance; and run production-representative soak/peak, saturation, dependency and region-failure tests. OPS-011, OPS-012 and OPS-013 therefore remain `Partial`.
