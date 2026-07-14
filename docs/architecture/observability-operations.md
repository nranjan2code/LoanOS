# Observability and Operational Health

Status date: 2026-07-14

## Scope

This is the first executable observability slice for LoanOS. It gives tenant and platform operators an immediate, tenant-isolated view of API reliability, provider readiness, breached workflow SLAs, reconciliation/finance exception ageing, and provider work that has not completed. It is an operational control surface, not yet a complete production telemetry stack.

## Runtime signals

`apps/api/src/observability.js` retains a bounded rolling window in each Node process. The default is 15 minutes and 10,000 samples. Each finished HTTP request records method, a normalized route template, status class, latency, and the effective tenant id for internal filtering. Tenant ids are never emitted as Prometheus labels.

The snapshot exposes:

- request and HTTP 5xx counts;
- availability percentage, where HTTP 5xx is an unavailable request;
- p50, p95, and p99 request latency;
- availability and p95-latency targets;
- remaining availability error budget;
- current/maximum in-flight requests and observed request rate; and
- normalized per-route/status-class counts and p95 latency.

The initial targets are 99.9% availability and 750 ms p95 latency. They can be changed with:

| Variable | Meaning | Default |
| --- | --- | --- |
| `LOANOS_SLI_WINDOW_MINUTES` | Per-process rolling evaluation window | `15` |
| `LOANOS_SLO_AVAILABILITY_PCT` | Availability target percentage | `99.9` |
| `LOANOS_SLO_P95_LATENCY_MS` | p95 request-latency target | `750` |
| `LOANOS_METRICS_TOKEN` | Enables and authenticates `GET /metrics` | Disabled when absent |

Invalid or non-positive numeric configuration falls back to the restrictive documented default. The metrics token can be presented as `Authorization: Bearer …` or `x-metrics-token`; comparison is constant-time. If no token is configured, the scrape route returns 404.

## Operational health projection

`packages/core/src/operations-monitoring.js` is a read-only deterministic projection over tenant state plus current provider/runtime observations. It opens alerts for:

| Signal | Default trigger | Severity |
| --- | --- | --- |
| Provider circuit degraded | Circuit is open after real-provider failures | Critical |
| Provider blocked | Real provider endpoint, credential, or India residency is incomplete | High |
| Workflow SLA | Active derived task is past due | High/critical from task priority |
| Reconciliation, suspense, or finance exception | Unresolved for at least 30 minutes or past assigned due time | High |
| Provider work | Payment-rail work remains pending for at least 30 minutes or expires | High |
| Availability SLO | Availability is below target | High/critical when budget is exhausted |
| Latency SLO | p95 latency is above target | High |

The projection never changes provider, workflow, or accounting state. Remediation must use the governed domain workflow that owns the underlying record; clearing an alert by itself cannot bypass reconciliation, finance-close, or maker-checker gates.

## Access surfaces

| Route | Authority | Scope |
| --- | --- | --- |
| `GET /health` | Open | Minimal service and aggregate process SLI status |
| `GET /metrics` | Dedicated metrics token | Aggregate process Prometheus metrics, no tenant labels |
| `GET /operations/metrics` | Tenant admin, security admin, auditor, operator, or wildcard tenant service | Effective tenant only |
| `GET /operations/health` | Same tenant authority | Effective tenant providers, work, alerts, and runtime |
| `GET /operations/alerts` | Same tenant authority | Effective tenant alert and stuck-work queue |
| `GET /platform/operations/metrics` | Platform admin, security admin, auditor, or platform admin key | Aggregate process |
| `GET /platform/operations/health` | Same platform authority | Cross-tenant control-plane view |

Tenant health is computed only after tenant authentication and sandbox resolution; the request is tagged with the effective tenant id. A tenant endpoint cannot request another tenant id. The cross-tenant view exists only behind platform authority.

## Initial response procedure

1. Confirm whether the alert is tenant-specific or process-wide and capture `generatedAt`, the evaluation window, route/status aggregate, provider reason, and work-item id.
2. For availability or latency, compare affected routes and status classes, then inspect platform health for blast radius. Do not rely on this rolling window as the incident record.
3. For provider degradation, stop permissive retries, validate the circuit reason and India-resident configuration, and use the owning provider/reconciliation workflow. Failed dependencies remain fail closed.
4. For stuck work, open the referenced workflow, reconciliation, suspense, finance, or payment-rail record. Preserve maker-checker and finance-close blockers.
5. Open or update the governed incident record when severity and policy require it; the existing CERT-In/RBI/DPDP notification clocks remain the regulatory system of record.
6. For a security signal, use the platform SOC workflow to retain the approved detection rule, source checksum, triage SLA, investigation and evidence-chain references. This record does not replace the underlying SIEM/log vault.

## Production completion gaps

Before D4 Production, route these signals to an India-hosted durable telemetry stack and evidence:

- multi-replica aggregation, long-term metric retention, dashboards, and burn-rate alerts;
- structured application/security/audit logs with redaction, 180-day retention where applicable, SIEM export, and clock synchronization;
- trace-context propagation and distributed traces across provider and decision-engine calls;
- external paging, acknowledgement, ownership, suppression, maintenance windows, escalation, and post-incident linkage;
- synthetic probes, database/queue/resource saturation signals, capacity forecasts, and load/soak/resilience tests; and
- reviewed on-call runbooks, service ownership, alert-quality tuning, and recovery exercises.

The first governed SOC record slice is described in [SIEM, SOC, and security investigation operations](security-operations.md). Until durable telemetry and operating effectiveness are evidenced, capability catalogue entries OPS-006, OPS-007, OPS-008, SEC-014 and SEC-016 remain `Partial`.
