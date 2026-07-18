import {
  createIncident,
  enrichIncident,
  recordIncidentNotification
} from "@loanos/core";

export async function routeIncidents(context) {
  const { method, path, url, req, res, store, readJson, sendJson, appendEvent } = context;

  if (method === "GET" && path === "/incidents") {
    const state = await store.load();
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const incidents = Object.values(state.incidents)
      .map((incident) => enrichIncident(incident, asOf))
      .filter((incident) => incidentMatchesFilters(incident, url));
    sendJson(res, 200, {
      asOf: asOf.toISOString(),
      count: incidents.length,
      incidents
    });
    return true;
  }

  if (method === "POST" && path === "/incidents") {
    const body = await readJson(req);
    const state = await store.load();
    const result = createIncident(state.incidents, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "incident_invalid", message: "Incident report is invalid." },
        findings: result.findings
      });
      return true;
    }
    const nextState = appendEvent(
      { ...state, incidents: result.registry },
      {
        type: "incident.reported",
        incidentId: result.incident.incidentId,
        category: result.incident.category,
        severity: result.incident.severity
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { incident: result.incident, event: result.event });
    return true;
  }

  const incidentMatch = path.match(/^\/incidents\/([^/]+)$/);
  if (method === "GET" && incidentMatch) {
    const state = await store.load();
    const incident = state.incidents[decodeURIComponent(incidentMatch[1])];
    if (!incident) {
      sendJson(res, 404, { error: { code: "not_found", message: "Incident not found." } });
      return true;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, enrichIncident(incident, asOf));
    return true;
  }

  const incidentNotificationMatch = path.match(/^\/incidents\/([^/]+)\/notifications$/);
  if (method === "POST" && incidentNotificationMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const incidentId = decodeURIComponent(incidentNotificationMatch[1]);
    const incident = state.incidents[incidentId];
    if (!incident) {
      sendJson(res, 404, { error: { code: "not_found", message: "Incident not found." } });
      return true;
    }
    const result = recordIncidentNotification(incident, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "incident_notification_blocked", message: "Incident notification is invalid." },
        findings: result.findings
      });
      return true;
    }
    const stored = result.incident;
    const nextState = appendEvent(
      { ...state, incidents: { ...state.incidents, [stored.incidentId]: stored } },
      {
        type: result.event.type,
        incidentId: stored.incidentId,
        authority: body.authority,
        actor: body.actor ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { incident: stored, event: result.event });
    return true;
  }

  return false;
}

function incidentMatchesFilters(incident, url) {
  const filters = {
    status: url.searchParams.get("status"),
    severity: url.searchParams.get("severity"),
    category: url.searchParams.get("category"),
    reportingStatus: url.searchParams.get("reportingStatus")
  };
  if (filters.status && incident.status !== filters.status) {
    return false;
  }
  if (filters.severity && incident.severity !== filters.severity) {
    return false;
  }
  if (filters.category && incident.category !== filters.category) {
    return false;
  }
  if (filters.reportingStatus && incident.reportingStatus !== filters.reportingStatus) {
    return false;
  }
  return true;
}
