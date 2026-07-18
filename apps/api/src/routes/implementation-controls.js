import {
  assessGoLiveReadiness,
  assessParallelRun,
  createImplementationProject,
  createUatCampaign,
  executeCutover,
  recordMigrationRun,
  recordTrainingCertification,
  registerMigrationMapping,
  reviewHypercare,
  validateOpeningBalances
} from "@loanos/core";

export async function routeImplementationControls(context) {
  const { method, path, req, res, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;
  if (!path.startsWith("/implementation/")) return false;
  const allowed = method === "GET" ? ["tenant_admin", "security_admin", "auditor", "operator"] : ["tenant_admin", "security_admin", "operator"];
  if (!hasTenantAdminRole(authContext, allowed)) { sendJson(res, 403, { error: { code: "implementation_forbidden", message: "Implementation administration access is required." } }); return true; }
  const state = await store.load();
  if (method === "GET" && path === "/implementation/controls") { sendJson(res, 200, projection(state)); return true; }
  if (method !== "POST") return false;
  const body = await readJson(req); const actor = authActor(authContext);
  try {
    if (body.approvedBy && body.approvedBy !== actor) { sendJson(res, 403, { error: { code: "implementation_actor_mismatch", message: "approvedBy must be the authenticated actor." } }); return true; }
    let nextState; let record; let event;
    if (path === "/implementation/projects") { const result = createImplementationProject(state.implementationProjects, body); record = result.project; nextState = { ...state, implementationProjects: result.registry }; event = "implementation.project.configured"; }
    else if (path === "/implementation/mappings") { const result = registerMigrationMapping(state.migrationMappings, state.implementationProjects[body.projectId], body); record = result.mapping; nextState = { ...state, migrationMappings: result.registry }; event = "implementation.mapping.approved"; }
    else if (path === "/implementation/migration-runs") { record = recordMigrationRun(state, body); nextState = { ...state, migrationRuns: add(state.migrationRuns, record.runId, record) }; event = "implementation.migration.recorded"; }
    else if (path === "/implementation/opening-balance-validations") { record = validateOpeningBalances(state.migrationRuns[body.runId], body); nextState = { ...state, openingBalanceValidations: add(state.openingBalanceValidations, record.validationId, record) }; event = "implementation.opening_balances.validated"; }
    else if (path === "/implementation/parallel-runs") { if (!state.implementationProjects[body.projectId]) throw error("implementation_project_missing", "Implementation project is required."); record = assessParallelRun(body); nextState = { ...state, parallelRunAssessments: add(state.parallelRunAssessments, record.assessmentId, record) }; event = "implementation.parallel_run.assessed"; }
    else if (path === "/implementation/uat-campaigns") { if (!state.implementationProjects[body.projectId]) throw error("implementation_project_missing", "Implementation project is required."); record = createUatCampaign(body); nextState = { ...state, uatCampaigns: add(state.uatCampaigns, record.campaignId, record) }; event = "implementation.uat.completed"; }
    else if (path === "/implementation/training-certifications") { if (!state.implementationProjects[body.projectId]) throw error("implementation_project_missing", "Implementation project is required."); record = recordTrainingCertification(body); nextState = { ...state, trainingCertifications: add(state.trainingCertifications, record.certificationId, record) }; event = "implementation.training.recorded"; }
    else if (path === "/implementation/go-live-readiness") { record = assessGoLiveReadiness(state, body); nextState = { ...state, goLiveReadinessAssessments: add(state.goLiveReadinessAssessments, record.readinessId, record) }; event = "implementation.go_live.assessed"; }
    else if (path === "/implementation/cutovers") { record = executeCutover(state.goLiveReadinessAssessments[body.readinessId], body); nextState = { ...state, cutoverRuns: add(state.cutoverRuns, record.cutoverId, record) }; event = "implementation.cutover.executed"; }
    else if (path === "/implementation/hypercare-reviews") { record = reviewHypercare(state.cutoverRuns[body.cutoverId], body); nextState = { ...state, hypercareReviews: add(state.hypercareReviews, record.reviewId, record) }; event = "implementation.hypercare.reviewed"; }
    else return false;
    const id = record.mappingId ?? record.runId ?? record.validationId ?? record.assessmentId ?? record.campaignId ?? record.certificationId ?? record.readinessId ?? record.cutoverId ?? record.reviewId ?? record.projectId;
    await store.save(appendEvent(nextState, { type: event, resourceId: id, status: record.status, evidenceChecksumSha256: record.evidenceChecksumSha256, actor })); sendJson(res, 201, record); return true;
  } catch (cause) { sendJson(res, cause.code?.includes("duplicate") ? 409 : 422, { error: { code: cause.code ?? "implementation_invalid", message: cause.message } }); return true; }
}

function projection(state) { return { implementationProjects: Object.values(state.implementationProjects), migrationMappings: Object.values(state.migrationMappings), migrationRuns: Object.values(state.migrationRuns), openingBalanceValidations: Object.values(state.openingBalanceValidations), parallelRunAssessments: Object.values(state.parallelRunAssessments), uatCampaigns: Object.values(state.uatCampaigns), trainingCertifications: Object.values(state.trainingCertifications), goLiveReadinessAssessments: Object.values(state.goLiveReadinessAssessments), cutoverRuns: Object.values(state.cutoverRuns), hypercareReviews: Object.values(state.hypercareReviews) }; }
function add(registry, id, record) { if (!id || registry?.[id]) throw error("implementation_duplicate", "Record id already exists."); return { ...(registry ?? {}), [id]: record }; }
function error(code, message) { return Object.assign(new Error(message), { code }); }
