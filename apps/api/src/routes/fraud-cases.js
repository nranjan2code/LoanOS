import {
  classifyFraudCase,
  createFraudCase,
  enrichFraudCase,
  generateFraudCommitteePack,
  issueShowCauseNotice,
  recordFraudResponse
} from "@loanos/core";

// RBI Fraud Risk Management 2024 lifecycle. Authentication, tenant resolution,
// mutation staffing and central request/audit attribution run before this
// boundary in server.js; this router owns only the tenant-partitioned resource.
export async function routeFraudCases(context) {
  const { method, path, url, req, res, store, readJson, sendJson, appendEvent } = context;

  if (method === "GET" && path === "/fraud-cases") {
    const state = await store.load();
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const fraudCases = Object.values(state.fraudCases)
      .map((fraudCase) => enrichFraudCase(fraudCase, asOf))
      .filter((fraudCase) => fraudCaseMatchesFilters(fraudCase, url));
    sendJson(res, 200, { asOf: asOf.toISOString(), count: fraudCases.length, fraudCases });
    return true;
  }

  if (method === "POST" && path === "/fraud-cases") {
    const body = await readJson(req);
    const state = await store.load();
    const result = createFraudCase(state.fraudCases, body, state);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "fraud_case_invalid", message: "Fraud case is invalid." },
        findings: result.findings
      });
      return true;
    }
    const nextState = appendEvent(
      { ...state, fraudCases: result.registry },
      {
        type: "fraud_case.reported",
        fraudCaseId: result.fraudCase.fraudCaseId,
        category: result.fraudCase.category,
        actor: body.reportedBy ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { fraudCase: result.fraudCase, event: result.event });
    return true;
  }

  const fraudCaseMatch = path.match(/^\/fraud-cases\/([^/]+)$/);
  if (method === "GET" && fraudCaseMatch) {
    const state = await store.load();
    const fraudCase = state.fraudCases[decodeURIComponent(fraudCaseMatch[1])];
    if (!fraudCase) {
      sendJson(res, 404, { error: { code: "not_found", message: "Fraud case not found." } });
      return true;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    sendJson(res, 200, enrichFraudCase(fraudCase, asOf));
    return true;
  }

  const fraudCommitteePackMatch = path.match(/^\/fraud-cases\/([^/]+)\/committee-pack$/);
  if (method === "GET" && fraudCommitteePackMatch) {
    const state = await store.load();
    const fraudCase = state.fraudCases[decodeURIComponent(fraudCommitteePackMatch[1])];
    if (!fraudCase) {
      sendJson(res, 404, { error: { code: "not_found", message: "Fraud case not found." } });
      return true;
    }
    const asOf = url.searchParams.get("asOf") ? new Date(url.searchParams.get("asOf")) : new Date();
    const result = generateFraudCommitteePack(fraudCase, {}, asOf);
    sendJson(res, 200, result.committeePack);
    return true;
  }

  const fraudCaseActionMatch = path.match(/^\/fraud-cases\/([^/]+)\/(show-cause-notice|responses|classification)$/);
  if (method === "POST" && fraudCaseActionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const fraudCaseId = decodeURIComponent(fraudCaseActionMatch[1]);
    const action = fraudCaseActionMatch[2];
    const fraudCase = state.fraudCases[fraudCaseId];
    if (!fraudCase) {
      sendJson(res, 404, { error: { code: "not_found", message: "Fraud case not found." } });
      return true;
    }
    const actionResult =
      action === "show-cause-notice"
        ? issueShowCauseNotice(fraudCase, body)
        : action === "responses"
          ? recordFraudResponse(fraudCase, body)
          : classifyFraudCase(fraudCase, body);
    if (actionResult.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "fraud_case_action_blocked", message: "Fraud case action is blocked by natural-justice or workflow findings." },
        findings: actionResult.findings
      });
      return true;
    }
    const stored = actionResult.fraudCase;
    const nextState = appendEvent(
      { ...state, fraudCases: { ...state.fraudCases, [stored.fraudCaseId]: stored } },
      {
        type: actionResult.event.type,
        fraudCaseId: stored.fraudCaseId,
        actor: body.actor ?? null
      }
    );
    await store.save(nextState);
    sendJson(res, 200, { fraudCase: stored, event: actionResult.event });
    return true;
  }

  return false;
}

function fraudCaseMatchesFilters(fraudCase, url) {
  const filters = {
    status: url.searchParams.get("status"),
    category: url.searchParams.get("category"),
    subjectBorrowerId: url.searchParams.get("subjectBorrowerId"),
    subjectLoanAccountId: url.searchParams.get("subjectLoanAccountId")
  };
  if (filters.status && fraudCase.status !== filters.status) {
    return false;
  }
  if (filters.category && fraudCase.category !== filters.category) {
    return false;
  }
  if (filters.subjectBorrowerId && fraudCase.subjectBorrowerId !== filters.subjectBorrowerId) {
    return false;
  }
  if (filters.subjectLoanAccountId && fraudCase.subjectLoanAccountId !== filters.subjectLoanAccountId) {
    return false;
  }
  return true;
}
