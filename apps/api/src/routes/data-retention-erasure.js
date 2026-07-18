import {
  createErasureRequest,
  enrichErasureRequest,
  executeAutoRetentionCleanup,
  fulfillErasureRequest,
  redactBorrowerBeneficialOwners,
  redactBorrowerKycRecords,
  redactBorrowerProfile,
  rejectErasureRequest
} from "@loanos/core";

// DPDP erasure and statutory-retention workflow. Authentication, tenant
// resolution, mutation staffing and central request/audit attribution run
// before this boundary in server.js; this router owns only the
// tenant-partitioned resource.
export async function routeDataRetentionErasure(context) {
  const { method, path, url, req, res, store, readJson, sendJson, appendEvent, authContext } = context;

  if (method === "GET" && path === "/erasure-requests") {
    const state = await store.load();
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const requests = Object.values(state.erasureRequests)
      .map((request) => enrichErasureRequest(request, state, asOf))
      .filter((request) => !url.searchParams.get("status") || request.status === url.searchParams.get("status"))
      .filter(
        (request) =>
          !url.searchParams.get("borrowerId") || request.borrowerId === url.searchParams.get("borrowerId")
      );
    sendJson(res, 200, { count: requests.length, erasureRequests: requests });
    return true;
  }

  if (method === "POST" && path === "/erasure-requests") {
    const submittedBody = await readJson(req);
    const body = authContext?.principalType === "borrower"
      ? { ...submittedBody, borrowerId: authContext.userId, requestedBy: authContext.userId }
      : submittedBody;
    const state = await store.load();
    const result = createErasureRequest(state.erasureRequests, body, state);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "erasure_request_invalid", message: "Erasure request is invalid." },
        findings: result.findings
      });
      return true;
    }
    const nextState = appendEvent(
      { ...state, erasureRequests: result.registry },
      {
        type: "data_erasure.requested",
        erasureRequestId: result.request.erasureRequestId,
        borrowerId: result.request.borrowerId,
        actor: body.requestedBy ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { erasureRequest: result.request, event: result.event });
    return true;
  }

  const erasureMatch = path.match(/^\/erasure-requests\/([^/]+)$/);
  if (method === "GET" && erasureMatch) {
    const state = await store.load();
    const request = state.erasureRequests[decodeURIComponent(erasureMatch[1])];
    if (!request) {
      sendJson(res, 404, { error: { code: "not_found", message: "Erasure request not found." } });
      return true;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, enrichErasureRequest(request, state, asOf));
    return true;
  }

  const erasureActionMatch = path.match(/^\/erasure-requests\/([^/]+)\/(fulfillment|rejection)$/);
  if (method === "POST" && erasureActionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const requestId = decodeURIComponent(erasureActionMatch[1]);
    const action = erasureActionMatch[2];
    const request = state.erasureRequests[requestId];
    if (!request) {
      sendJson(res, 404, { error: { code: "not_found", message: "Erasure request not found." } });
      return true;
    }
    // An injectable clock keeps retention-window evaluation deterministic with
    // the read endpoints.
    const now = body.asOf ? new Date(body.asOf) : new Date();
    const result =
      action === "fulfillment"
        ? fulfillErasureRequest(request, body, state, now)
        : rejectErasureRequest(request, body, state, now);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "erasure_action_blocked", message: "Erasure action is blocked by retention or workflow findings." },
        findings: result.findings
      });
      return true;
    }
    const stored = result.request;
    // Fulfilment irreversibly redacts personal data in place; the request and
    // audit trail remain as evidence.
    const borrowerProfiles =
      action === "fulfillment" && state.borrowerProfiles[stored.borrowerId]
        ? {
            ...state.borrowerProfiles,
            [stored.borrowerId]: redactBorrowerProfile(state.borrowerProfiles[stored.borrowerId])
          }
        : state.borrowerProfiles;
    const kycRecords =
      action === "fulfillment"
        ? redactBorrowerKycRecords(state.kycRecords, stored.borrowerId, now)
        : state.kycRecords;
    const beneficialOwners =
      action === "fulfillment"
        ? redactBorrowerBeneficialOwners(state.beneficialOwners, stored.borrowerId, now)
        : state.beneficialOwners;
    const nextState = appendEvent(
      {
        ...state,
        borrowerProfiles,
        kycRecords,
        beneficialOwners,
        erasureRequests: { ...state.erasureRequests, [stored.erasureRequestId]: stored }
      },
      {
        type: result.event.type,
        erasureRequestId: stored.erasureRequestId,
        borrowerId: stored.borrowerId,
        actor: body.actor ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { erasureRequest: stored, event: result.event });
    return true;
  }

  if (method === "POST" && path === "/data-retention/cleanup") {
    const state = await store.load();
    const now = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const result = executeAutoRetentionCleanup(state, now);

    let nextState = {
      ...state,
      borrowerProfiles: result.borrowerProfiles,
      kycRecords: result.kycRecords,
      beneficialOwners: result.beneficialOwners
    };
    for (const event of result.events) {
      nextState = appendEvent(nextState, event);
    }

    await store.save(nextState);
    sendJson(res, 200, {
      cleanedBorrowerIds: result.cleanedBorrowerIds,
      eventCount: result.events.length
    });
    return true;
  }

  return false;
}
