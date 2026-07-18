import {
  assessFraudSignals,
  buildPortfolioRiskSnapshot,
  buildRiskCommitteePack,
  conductOngoingCddReview,
  createRcsaAssessment,
  createRecurringModelReport,
  createTransactionMonitoringRule,
  evaluateTransactions,
  registerFraudRiskPolicy,
  registerScreeningList,
  stressPortfolio
} from "@loanos/core";

export async function routeRiskAmlControls(context) {
  const { method, path, req, res, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;
  if (!path.startsWith("/risk/") && !path.startsWith("/aml/") && !path.startsWith("/fraud/") && path !== "/model-governance/monitoring-reports") return false;
  const allowed = method === "GET" ? ["tenant_admin", "security_admin", "auditor", "operator"] : ["tenant_admin", "security_admin", "operator"];
  if (!hasTenantAdminRole(authContext, allowed)) { sendJson(res, 403, { error: { code: "risk_control_forbidden", message: "Risk or compliance administration access is required." } }); return true; }
  const state = await store.load();
  if (method === "GET" && path === "/risk/controls") { sendJson(res, 200, { screeningLists: Object.values(state.screeningLists), cddReviews: Object.values(state.cddReviews), transactionMonitoringRules: Object.values(state.transactionMonitoringRules), amlAlerts: Object.values(state.amlAlerts), fraudRiskPolicies: Object.values(state.fraudRiskPolicies), fraudSignalAssessments: Object.values(state.fraudSignalAssessments), portfolioRiskSnapshots: Object.values(state.portfolioRiskSnapshots), portfolioStressTests: Object.values(state.portfolioStressTests), rcsaAssessments: Object.values(state.rcsaAssessments), modelMonitoringReports: Object.values(state.modelMonitoringReports), riskCommitteePacks: Object.values(state.riskCommitteePacks) }); return true; }
  if (method !== "POST") return false;
  const body = await readJson(req); const actor = authActor(authContext);
  try {
    if (body.approvedBy && body.approvedBy !== actor) { sendJson(res, 403, { error: { code: "risk_actor_mismatch", message: "approvedBy must be the authenticated actor." } }); return true; }
    let nextState; let record; let event;
    if (path === "/aml/screening-lists") { const result = registerScreeningList(state.screeningLists, body); nextState = { ...state, screeningLists: result.registry }; record = result.list; event = "risk.screening_list.registered"; }
    else if (path === "/aml/cdd-reviews") { record = conductOngoingCddReview(state, body); nextState = { ...state, cddReviews: add(state.cddReviews, record.reviewId, record) }; event = "risk.cdd.reviewed"; }
    else if (path === "/aml/transaction-monitoring/rules") { const result = createTransactionMonitoringRule(state.transactionMonitoringRules, body); nextState = { ...state, transactionMonitoringRules: result.registry }; record = result.rule; event = "risk.tm.rule_approved"; }
    else if (path === "/aml/transaction-monitoring/assessments") { const result = evaluateTransactions(state, { ...body, assessedBy: actor }); record = result.assessment; nextState = { ...state, transactionMonitoringAssessments: add(state.transactionMonitoringAssessments, record.assessmentId, record), amlAlerts: { ...state.amlAlerts, ...Object.fromEntries(result.alerts.map((alert) => [alert.alertId, alert])) } }; event = "risk.tm.assessed"; }
    else if (path === "/fraud/risk-policies") { const result = registerFraudRiskPolicy(state.fraudRiskPolicies, body); nextState = { ...state, fraudRiskPolicies: result.registry }; record = result.policy; event = "risk.fraud.policy_approved"; }
    else if (path === "/fraud/signal-assessments") { record = assessFraudSignals(state, { ...body, assessedBy: actor }); nextState = { ...state, fraudSignalAssessments: add(state.fraudSignalAssessments, record.assessmentId, record) }; event = "risk.fraud.assessed"; }
    else if (path === "/risk/portfolio/snapshots") { record = buildPortfolioRiskSnapshot(body); nextState = { ...state, portfolioRiskSnapshots: add(state.portfolioRiskSnapshots, record.snapshotId, record) }; event = "risk.portfolio.snapshotted"; }
    else if (path === "/risk/portfolio/stress-tests") { record = stressPortfolio(state.portfolioRiskSnapshots[body.snapshotId], body); nextState = { ...state, portfolioStressTests: add(state.portfolioStressTests, record.stressTestId, record) }; event = "risk.portfolio.stress_tested"; }
    else if (path === "/risk/rcsa-assessments") { record = createRcsaAssessment(body); nextState = { ...state, rcsaAssessments: add(state.rcsaAssessments, record.assessmentId, record) }; event = "risk.rcsa.assessed"; }
    else if (path === "/model-governance/monitoring-reports") { record = createRecurringModelReport(state, body); nextState = { ...state, modelMonitoringReports: add(state.modelMonitoringReports, record.reportId, record) }; event = "risk.model.monitoring_reported"; }
    else if (path === "/risk/committee-packs") { record = buildRiskCommitteePack(state, body); nextState = { ...state, riskCommitteePacks: add(state.riskCommitteePacks, record.packId, record) }; event = "risk.committee_pack.sealed"; }
    else return false;
    const id = record.reviewId ?? record.ruleId ?? record.assessmentId ?? record.policyId ?? record.snapshotId ?? record.stressTestId ?? record.reportId ?? record.packId ?? record.listId;
    await store.save(appendEvent(nextState, { type: event, resourceId: id, status: record.status, evidenceChecksumSha256: record.evidenceChecksumSha256 ?? record.packChecksumSha256 ?? null, actor })); sendJson(res, 201, record); return true;
  } catch (error) { sendJson(res, error.code?.includes("duplicate") ? 409 : 422, { error: { code: error.code ?? "risk_control_invalid", message: error.message } }); return true; }
}

function add(registry, id, record) { if (!id || registry?.[id]) throw Object.assign(new Error("Record id already exists."), { code: "risk_control_duplicate" }); return { ...(registry ?? {}), [id]: record }; }
