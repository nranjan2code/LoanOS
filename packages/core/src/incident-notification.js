import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";

// A security/data incident inside a tenant's perimeter carries statutory
// reporting duties the RE (and LoanOS as its IT service provider) must meet on a
// hard clock: the CERT-In 2022 directions require reporting within 6 hours of
// noticing, and RBI's cyber-incident expectations run to the same 6-hour window.
// This module tracks each incident and an independent reporting clock per
// authority so a breach of either duty is detectable at read time.

export const INCIDENT_STATUSES = {
  OPEN: "open",
  CONTAINED: "contained",
  CLOSED: "closed"
};

export const INCIDENT_CATEGORIES = [
  "data_breach",
  "unauthorized_access",
  "system_outage",
  "cyber_attack",
  "data_loss",
  "third_party",
  "other"
];

export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"];

// Both authorities operate on a 6-hour-from-detection window.
export const INCIDENT_REPORTING_TARGETS = {
  cert_in: { authority: "cert_in", policyId: "certin.2022.6_hour.v1", targetHours: 6 },
  rbi: { authority: "rbi", policyId: "rbi.cyber_incident.6_hour.v1", targetHours: 6 }
};

const REPORTABLE_AUTHORITIES = new Set(Object.keys(INCIDENT_REPORTING_TARGETS));

export function createIncident(registry = {}, input = {}, now = new Date()) {
  const incident = normalizeIncident(input, {}, now);
  const findings = validateIncident(incident);
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { registry, incident, findings, summary };
  }

  const event = incidentEvent("incident.reported", {
    actor: input.actor ?? null,
    category: incident.category,
    severity: incident.severity,
    reportableTo: incident.reportableTo
  }, now);
  const stored = {
    ...incident,
    events: [event],
    updatedAt: now.toISOString()
  };

  return {
    registry: { ...registry, [stored.incidentId]: stored },
    incident: enrichIncident(stored, now),
    event,
    findings: [],
    summary: summarizeFindings([])
  };
}

export function recordIncidentNotification(incident, input = {}, now = new Date()) {
  const findings = [];
  if (!incident) {
    findings.push(createFinding("error", "CERTIN-2022", "Incident is required.", "incidentId"));
  }
  if (!input.authority || !REPORTABLE_AUTHORITIES.has(input.authority)) {
    findings.push(createFinding("error", "CERTIN-2022", "A valid reporting authority is required.", "authority"));
  }
  if (incident && input.authority && !incident.reportableTo.includes(input.authority)) {
    findings.push(
      createFinding("error", "CERTIN-2022", "Incident is not marked reportable to this authority.", "authority")
    );
  }
  if (!input.referenceNumber) {
    findings.push(createFinding("error", "CERTIN-2022", "A regulator acknowledgement reference is required.", "referenceNumber"));
  }
  if (!input.actor) {
    findings.push(createFinding("error", "CERTIN-2022", "Reporting requires an actor.", "actor"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { incident: incident ? enrichIncident(incident, now) : null, event: null, findings, summary };
  }

  const notifiedAt = normalizeDate(input.notifiedAt) ?? now;
  const notification = {
    authority: input.authority,
    notifiedAt: notifiedAt.toISOString(),
    referenceNumber: input.referenceNumber,
    reportedBy: input.actor,
    notes: input.notes ?? null
  };
  const event = incidentEvent("incident.authority_notified", {
    actor: input.actor,
    authority: input.authority,
    referenceNumber: input.referenceNumber
  }, now);
  const updated = {
    ...incident,
    notifications: { ...(incident.notifications ?? {}), [input.authority]: notification },
    events: [...(incident.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return { incident: enrichIncident(updated, now), event, findings: [], summary: summarizeFindings([]) };
}

export function enrichIncident(incident, asOf = new Date()) {
  const reporting = incident.reportableTo.map((authority) =>
    computeIncidentReportingClock(incident, authority, asOf)
  );
  const reportingBreached = reporting.some((clock) => clock.breached);
  return {
    ...incident,
    reporting,
    reportingStatus: reportingBreached ? "reporting_overdue" : "on_track",
    fullyReported: reporting.every((clock) => clock.notified)
  };
}

export function computeIncidentReportingClock(incident, authority, asOf = new Date()) {
  const target = INCIDENT_REPORTING_TARGETS[authority];
  const detectedAt = normalizeDate(incident?.detectedAt) ?? asOf;
  const dueAt = addHours(detectedAt, target.targetHours);
  const notification = incident?.notifications?.[authority] ?? null;
  const notifiedAt = normalizeDate(notification?.notifiedAt);
  const clockAt = notifiedAt ?? asOf;
  const remainingMinutes = Math.floor((dueAt.getTime() - clockAt.getTime()) / 60000);
  const breached = remainingMinutes < 0;

  let status;
  if (notifiedAt) {
    status = breached ? "reported_late" : "reported_in_time";
  } else if (breached) {
    status = "overdue";
  } else if (remainingMinutes <= 60) {
    status = "due_soon";
  } else {
    status = "on_track";
  }

  return {
    authority,
    policyId: target.policyId,
    targetHours: target.targetHours,
    detectedAt: detectedAt.toISOString(),
    dueAt: dueAt.toISOString(),
    notified: Boolean(notifiedAt),
    notifiedAt: notifiedAt ? notifiedAt.toISOString() : null,
    referenceNumber: notification?.referenceNumber ?? null,
    status,
    breached,
    remainingMinutes
  };
}

function normalizeIncident(input, existing = {}, now = new Date()) {
  const detectedAt = normalizeDate(input.detectedAt) ?? normalizeDate(existing.detectedAt) ?? now;
  const reportableTo = normalizeReportableTo(input.reportableTo ?? existing.reportableTo);
  return {
    ...existing,
    incidentId: input.incidentId ?? existing.incidentId ?? createLoanId("inc"),
    status: input.status ?? existing.status ?? INCIDENT_STATUSES.OPEN,
    category: input.category ?? existing.category ?? null,
    severity: input.severity ?? existing.severity ?? null,
    summary: input.summary ?? existing.summary ?? null,
    description: input.description ?? existing.description ?? null,
    affectedSystems: Array.isArray(input.affectedSystems)
      ? input.affectedSystems
      : existing.affectedSystems ?? [],
    detectedAt: detectedAt.toISOString(),
    reportableTo,
    notifications: existing.notifications ?? {},
    events: Array.isArray(existing.events) ? existing.events : [],
    createdAt: existing.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

// Default to both statutory authorities unless the caller narrows the set; an
// incident that reaches this workflow is presumed reportable.
function normalizeReportableTo(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [...REPORTABLE_AUTHORITIES];
  }
  return value.filter((authority) => REPORTABLE_AUTHORITIES.has(authority));
}

function validateIncident(incident) {
  const findings = [];
  if (!incident.incidentId) {
    findings.push(createFinding("error", "CERTIN-2022", "Incident requires incidentId.", "incidentId"));
  }
  if (!INCIDENT_CATEGORIES.includes(incident.category)) {
    findings.push(createFinding("error", "CERTIN-2022", "Incident category is invalid.", "category"));
  }
  if (!INCIDENT_SEVERITIES.includes(incident.severity)) {
    findings.push(createFinding("error", "CERTIN-2022", "Incident severity is invalid.", "severity"));
  }
  if (!incident.summary) {
    findings.push(createFinding("error", "CERTIN-2022", "Incident requires a summary.", "summary"));
  }
  if (!normalizeDate(incident.detectedAt)) {
    findings.push(createFinding("error", "CERTIN-2022", "Incident requires a valid detectedAt.", "detectedAt"));
  }
  if (incident.reportableTo.length === 0) {
    findings.push(
      createFinding("error", "CERTIN-2022", "Incident must be reportable to at least one authority.", "reportableTo")
    );
  }
  return findings;
}

function incidentEvent(type, event, now) {
  return {
    eventId: createLoanId("incevt"),
    type,
    at: now.toISOString(),
    ...event
  };
}

function addHours(date, hours) {
  return new Date(new Date(date).getTime() + hours * 60 * 60 * 1000);
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
