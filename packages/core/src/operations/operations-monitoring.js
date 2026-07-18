import { deriveWorkflowTasks } from "../journeys/workflow-tasks.js";

const DEFAULT_STUCK_MINUTES = 30;

export function buildTenantOperationalHealth(state = {}, options = {}) {
  const asOf = normalizeDate(options.asOf) ?? new Date();
  const providerReadiness = Array.isArray(options.providerReadiness) ? options.providerReadiness : [];
  const runtime = options.runtime ?? null;
  const stuckAfterMinutes = positiveNumber(options.stuckAfterMinutes, DEFAULT_STUCK_MINUTES);
  const stuckWork = [
    ...workflowBreaches(state, asOf),
    ...exceptionBacklog(state, asOf, stuckAfterMinutes),
    ...pendingProviderWork(state, asOf, stuckAfterMinutes)
  ].sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || right.ageMinutes - left.ageMinutes);
  const alerts = [
    ...providerAlerts(providerReadiness),
    ...stuckWork.map(stuckAlert),
    ...runtimeAlerts(runtime)
  ].sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || left.alertId.localeCompare(right.alertId));
  const criticalCount = alerts.filter((alert) => alert.severity === "critical").length;
  return {
    generatedAt: asOf.toISOString(),
    status: criticalCount > 0 ? "critical" : alerts.length > 0 ? "degraded" : "healthy",
    providers: {
      total: providerReadiness.length,
      ready: providerReadiness.filter((item) => item.status === "ready").length,
      mock: providerReadiness.filter((item) => item.status === "mock").length,
      degraded: providerReadiness.filter((item) => item.status === "degraded").length,
      blocked: providerReadiness.filter((item) => item.status === "blocked").length,
      integrations: providerReadiness
    },
    work: {
      stuckCount: stuckWork.length,
      criticalCount: stuckWork.filter((item) => item.severity === "critical").length,
      items: stuckWork
    },
    alerts: {
      openCount: alerts.length,
      criticalCount,
      items: alerts
    },
    runtime
  };
}

function workflowBreaches(state, asOf) {
  return deriveWorkflowTasks(state, { asOf })
    .filter((task) => task.status !== "completed" && task.sla?.breached)
    .map((task) => workItem({
      workId: task.taskId,
      type: "workflow_sla",
      source: task.type,
      status: task.status,
      severity: task.priority === "critical" ? "critical" : "high",
      openedAt: task.openedAt,
      dueAt: task.dueAt,
      owner: task.assignedTo,
      reason: "workflow_sla_breached"
    }, asOf));
}

function exceptionBacklog(state, asOf, threshold) {
  const sources = [
    ["payment_reconciliation", state.paymentReconciliations, (record) => record.outcome === "exception" && !record.resolvedAt, "receivedAt", "reconciliationId"],
    ["bank_reconciliation", state.bankReconciliations, (record) => record.outcome === "exception" && !record.resolvedAt, "receivedAt", "bankReconciliationId"],
    ["payment_suspense", state.paymentSuspenseReceipts, (record) => ["open", "partially_resolved"].includes(record.status), "receivedAt", "suspenseId"],
    ["finance_exception", state.financeExceptions, (record) => record.status !== "resolved", "createdAt", "exceptionId"]
  ];
  return sources.flatMap(([type, records, isOpen, dateField, idField]) => Object.values(records ?? {})
    .filter(isOpen)
    .map((record) => workItem({
      workId: record[idField] ?? `${type}:unknown`,
      type,
      source: type,
      status: record.status ?? record.outcome,
      severity: "high",
      openedAt: record[dateField],
      dueAt: record.assignment?.dueAt ?? null,
      owner: record.assignment?.assignedTo ?? null,
      reason: record.exceptionCode ?? record.reasonCode ?? "unresolved_exception"
    }, asOf))
    .filter((item) => item.ageMinutes >= threshold || item.overdue));
}

function pendingProviderWork(state, asOf, threshold) {
  return Object.values(state.paymentRails ?? {})
    .filter((record) => record.status === "pending")
    .map((record) => workItem({
      workId: record.paymentRailId,
      type: "provider_pending",
      source: record.type ?? record.channel ?? "payment_rail",
      status: record.status,
      severity: "high",
      openedAt: record.createdAt ?? record.initiatedAt ?? record.requestedAt,
      dueAt: record.expiresAt ?? null,
      owner: null,
      reason: "provider_callback_pending"
    }, asOf))
    .filter((item) => item.ageMinutes >= threshold || item.overdue);
}

function providerAlerts(readiness) {
  return readiness.filter((item) => ["blocked", "degraded"].includes(item.status)).map((item) => ({
    alertId: `provider:${item.integration}:${item.status}`,
    type: "provider_health",
    severity: item.status === "degraded" ? "critical" : "high",
    status: "open",
    title: `${item.label} provider is ${item.status}`,
    reason: item.reason,
    subject: { type: "provider", id: item.integration },
    runbook: "operations.provider_recovery.v1"
  }));
}

function stuckAlert(item) {
  return {
    alertId: `stuck:${item.type}:${item.workId}`,
    type: "stuck_work",
    severity: item.severity,
    status: "open",
    title: `${item.type} work item is stuck or overdue`,
    reason: item.reason,
    subject: { type: item.type, id: item.workId },
    runbook: item.type === "workflow_sla" ? "operations.workflow_sla.v1" : "operations.exception_queue.v1"
  };
}

function runtimeAlerts(runtime) {
  if (!runtime || runtime.status === "healthy") return [];
  const alerts = [];
  if (runtime.sli.availabilityPct < runtime.slo.availabilityTargetPct) alerts.push({ alertId: "runtime:availability", type: "slo_breach", severity: runtime.slo.errorBudgetRemainingPct === 0 ? "critical" : "high", status: "open", title: "API availability SLO is breached", reason: "availability_below_target", subject: { type: "runtime_sli", id: "availability" }, runbook: "operations.api_availability.v1" });
  if (runtime.sli.p95LatencyMs > runtime.slo.p95LatencyTargetMs) alerts.push({ alertId: "runtime:latency", type: "slo_breach", severity: "high", status: "open", title: "API latency SLO is breached", reason: "p95_latency_above_target", subject: { type: "runtime_sli", id: "latency" }, runbook: "operations.api_latency.v1" });
  return alerts;
}

function workItem(input, asOf) {
  const openedAt = normalizeDate(input.openedAt) ?? asOf;
  const dueAt = normalizeDate(input.dueAt);
  return {
    ...input,
    openedAt: openedAt.toISOString(),
    dueAt: dueAt?.toISOString() ?? null,
    ageMinutes: Math.max(0, Math.floor((asOf.getTime() - openedAt.getTime()) / 60000)),
    overdue: Boolean(dueAt && dueAt.getTime() < asOf.getTime())
  };
}

function severityRank(value) {
  return { critical: 3, high: 2, medium: 1, low: 0 }[value] ?? 0;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}
