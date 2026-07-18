import {
  createComplaint,
  enrichComplaint,
  assignComplaint,
  startComplaintReview,
  resolveComplaint,
  escalateComplaintToRbiCms,
  validateGrievanceOfficerAccess,
  summarizeFindings
} from "@loanos/core";

export async function routeComplaints(context) {
  const { method, path, url, req, res, store, readJson, sendJson, appendEvent, authContext, resolveSessionActorId } = context;

  if (method === "GET" && path === "/complaints") {
    const state = await store.load();
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const complaints = Object.values(state.complaints)
      .map((complaint) => enrichComplaint(complaint, asOf))
      .filter((complaint) => authContext?.principalType !== "borrower" || complaint.borrowerId === authContext.userId)
      .filter((complaint) => complaintMatchesFilters(complaint, url));
    sendJson(res, 200, {
      asOf: asOf.toISOString(),
      count: complaints.length,
      complaints
    });
    return true;
  }

  if (method === "POST" && path === "/complaints") {
    const submittedBody = await readJson(req);
    const body = authContext?.principalType === "borrower"
      ? { ...submittedBody, borrowerId: authContext.userId, receivedFrom: "borrower_portal" }
      : submittedBody;
    const state = await store.load();
    const result = createComplaint(state.complaints, body, state);
    const nextState =
      result.summary.status === "blocked"
        ? state
        : appendEvent(
            {
              ...state,
              complaints: result.registry
            },
            {
              type: "complaint.received",
              complaintId: result.complaint.complaintId,
              category: result.complaint.category
            }
          );
    await store.save(nextState);
    sendJson(res, result.summary.status === "blocked" ? 422 : 201, result);
    return true;
  }

  const complaintMatch = path.match(/^\/complaints\/([^/]+)$/);
  if (method === "GET" && complaintMatch) {
    const state = await store.load();
    const complaint = state.complaints[decodeURIComponent(complaintMatch[1])];
    if (!complaint) {
      sendJson(res, 404, { error: { code: "not_found", message: "Complaint not found." } });
      return true;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, enrichComplaint(complaint, asOf));
    return true;
  }

  const complaintActionMatch = path.match(/^\/complaints\/([^/]+)\/(assignments|reviews|resolution|rbi-cms-escalation)$/);
  if (method === "POST" && complaintActionMatch) {
    const submittedBody = await readJson(req);
    const body = authContext?.principalType === "borrower"
      ? { ...submittedBody, borrowerId: authContext.userId, requestedBy: authContext.userId }
      : submittedBody;
    const state = await store.load();
    const complaintId = decodeURIComponent(complaintActionMatch[1]);
    const action = complaintActionMatch[2];
    const complaint = state.complaints[complaintId];
    if (!complaint) {
      sendJson(res, 404, { error: { code: "not_found", message: "Complaint not found." } });
      return true;
    }

    if (action !== "assignments") {
      body.actor = resolveSessionActorId(authContext, body.actor);
    }
    const actorPath = action === "assignments" ? "assignedTo" : "actor";
    const actorId = action === "assignments" ? body.assignedTo : body.actor;
    const accessFindings = validateGrievanceOfficerAccess(state.users, actorId, actorPath);
    const accessSummary = summarizeFindings(accessFindings);
    if (accessSummary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "complaint_access_blocked",
          message: "Complaint action is blocked by grievance-officer role policy."
        },
        findings: accessFindings
      });
      return true;
    }

    const actionResult =
      action === "assignments"
        ? assignComplaint(complaint, body)
        : action === "reviews"
          ? startComplaintReview(complaint, body)
          : action === "resolution"
            ? resolveComplaint(complaint, body)
            : escalateComplaintToRbiCms(complaint, body);
    if (actionResult.summary.status === "blocked") {
      sendJson(res, 422, {
        error: {
          code: "complaint_action_blocked",
          message: "Complaint action is blocked by workflow findings."
        },
        findings: actionResult.findings
      });
      return true;
    }

    const stored = actionResult.complaint;
    const nextState = appendEvent(
      {
        ...state,
        complaints: {
          ...state.complaints,
          [stored.complaintId]: stored
        }
      },
      {
        type: actionResult.event.type,
        complaintId: stored.complaintId,
        actor: body.actor ?? body.assignedTo ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, action === "assignments" ? 201 : 200, {
      complaint: stored,
      event: actionResult.event
    });
    return true;
  }

  return false;
}

function complaintMatchesFilters(complaint, url) {
  const filters = {
    status: url.searchParams.get("status"),
    effectiveStatus: url.searchParams.get("effectiveStatus"),
    assignedTo: url.searchParams.get("assignedTo"),
    category: url.searchParams.get("category")
  };
  if (filters.status && complaint.status !== filters.status) {
    return false;
  }
  if (filters.effectiveStatus && complaint.effectiveStatus !== filters.effectiveStatus) {
    return false;
  }
  if (filters.assignedTo && complaint.assignedTo !== filters.assignedTo) {
    return false;
  }
  if (filters.category && complaint.category !== filters.category) {
    return false;
  }
  return true;
}
