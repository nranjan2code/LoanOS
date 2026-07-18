import {
  createComplianceObligationCalendar,
  createConfiguredWorkflowCase,
  createRegulatoryApplicabilityProfile,
  planBulkAction,
  recordOperationalException,
  registerApprovalMatrix,
  registerBusinessCalendar,
  registerExceptionTaxonomy,
  registerLendingProgramme,
  registerOperatingUnit,
  registerWorkflowDefinition,
  registerWorkforcePolicy,
  resolveApprovalRequirement,
  transitionConfiguredWorkflowCase
} from "@loanos/core";

export async function routeInstitutionalOperations(context) {
  const { method, path, req, res, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;
  if (!path.startsWith("/institution/operations")) return false;
  const allowed = method === "GET" ? ["tenant_admin", "security_admin", "auditor", "operator"] : ["tenant_admin", "security_admin", "operator"];
  if (!hasTenantAdminRole(authContext, allowed)) { sendJson(res, 403, { error: { code: "institution_operations_forbidden", message: "Institution operations administration access is required." } }); return true; }
  const state = await store.load();
  if (method === "GET" && path === "/institution/operations") { sendJson(res, 200, projection(state)); return true; }
  if (method !== "POST") return false;
  const body = await readJson(req); const actor = authActor(authContext);
  try {
    if (body.approvedBy && body.approvedBy !== actor) { sendJson(res, 403, { error: { code: "institution_actor_mismatch", message: "approvedBy must be the authenticated actor." } }); return true; }
    let record; let nextState; let event;
    if (path === "/institution/operations/units") { const result = registerOperatingUnit(state.institutionOperatingUnits, state, body); record = result.unit; nextState = { ...state, institutionOperatingUnits: result.registry }; event = "institution.unit.registered"; }
    else if (path === "/institution/operations/programmes") { const result = registerLendingProgramme(state.lendingProgrammes, state, body); record = result.programme; nextState = { ...state, lendingProgrammes: result.registry }; event = "institution.programme.registered"; }
    else if (path === "/institution/operations/applicability-profiles") { const result = createRegulatoryApplicabilityProfile(state.regulatoryApplicabilityProfiles, state, body); record = result.profile; nextState = { ...state, regulatoryApplicabilityProfiles: result.registry }; event = "institution.applicability.approved"; }
    else if (path === "/institution/operations/obligation-calendars") { const result = createComplianceObligationCalendar(state.complianceObligationCalendars, state, body); record = result.calendar; nextState = { ...state, complianceObligationCalendars: result.registry }; event = "institution.obligations.scheduled"; }
    else if (path === "/institution/operations/business-calendars") { const result = registerBusinessCalendar(state.businessCalendars, body); record = result.calendar; nextState = { ...state, businessCalendars: result.registry }; event = "institution.business_calendar.approved"; }
    else if (path === "/institution/operations/workflow-definitions") { if (!state.businessCalendars[body.businessCalendarId]) throw error("business_calendar_missing", "A registered business calendar is required."); const result = registerWorkflowDefinition(state.workflowDefinitions, body); record = result.definition; nextState = { ...state, workflowDefinitions: result.registry }; event = "institution.workflow.approved"; }
    else if (path === "/institution/operations/approval-matrices") { const result = registerApprovalMatrix(state.approvalMatrices, state, body); record = result.matrix; nextState = { ...state, approvalMatrices: result.registry }; event = "institution.approval_matrix.approved"; }
    else if (path === "/institution/operations/approval-resolutions") { record = { resolutionId: body.resolutionId, ...resolveApprovalRequirement(state.approvalMatrices[body.matrixId], body.facts), resolvedAt: new Date().toISOString() }; if (!record.resolutionId) throw error("institution_invalid", "resolutionId is required."); nextState = { ...state, approvalResolutions: add(state.approvalResolutions, record.resolutionId, record) }; event = "institution.approval_matrix.resolved"; }
    else if (path === "/institution/operations/workforce-policies") { const result = registerWorkforcePolicy(state.workforcePolicies, body); record = result.policy; nextState = { ...state, workforcePolicies: result.registry }; event = "institution.workforce_policy.approved"; }
    else if (path === "/institution/operations/bulk-actions") { record = planBulkAction(body); nextState = { ...state, bulkActionPlans: add(state.bulkActionPlans, record.bulkActionId, record) }; event = "institution.bulk_action.approved"; }
    else if (path === "/institution/operations/exception-taxonomies") { const result = registerExceptionTaxonomy(state.exceptionTaxonomies, body); record = result.taxonomy; nextState = { ...state, exceptionTaxonomies: result.registry }; event = "institution.exception_taxonomy.approved"; }
    else if (path === "/institution/operations/exceptions") { record = recordOperationalException(state, { ...body, recordedBy: actor }); nextState = { ...state, operationalExceptions: add(state.operationalExceptions, record.exceptionId, record) }; event = "institution.exception.recorded"; }
    else if (path === "/institution/operations/workflow-cases") { record = createConfiguredWorkflowCase(state, { ...body, createdBy: actor }); nextState = { ...state, configuredWorkflowCases: add(state.configuredWorkflowCases, record.caseId, record) }; event = "institution.workflow_case.created"; }
    else { const match = path.match(/^\/institution\/operations\/workflow-cases\/([^/]+)\/transitions$/); if (!match) return false; const caseId = decodeURIComponent(match[1]); record = transitionConfiguredWorkflowCase(state, state.configuredWorkflowCases[caseId], { ...body, actor }); nextState = { ...state, configuredWorkflowCases: { ...state.configuredWorkflowCases, [caseId]: record } }; event = "institution.workflow_case.transitioned"; }
    const id = record.unitId ?? record.programmeId ?? record.profileId ?? record.calendarId ?? record.businessCalendarId ?? record.workflowId ?? record.matrixId ?? record.resolutionId ?? record.policyId ?? record.bulkActionId ?? record.taxonomyId ?? record.exceptionId ?? record.caseId;
    await store.save(appendEvent(nextState, { type: event, resourceId: id, status: record.status ?? record.outcome, evidenceChecksumSha256: record.evidenceChecksumSha256 ?? null, actor })); sendJson(res, 201, record); return true;
  } catch (cause) { sendJson(res, cause.code?.includes("duplicate") ? 409 : 422, { error: { code: cause.code ?? "institution_operations_invalid", message: cause.message } }); return true; }
}

function projection(state) { return { institutionOperatingUnits: Object.values(state.institutionOperatingUnits), lendingProgrammes: Object.values(state.lendingProgrammes), regulatoryApplicabilityProfiles: Object.values(state.regulatoryApplicabilityProfiles), complianceObligationCalendars: Object.values(state.complianceObligationCalendars), businessCalendars: Object.values(state.businessCalendars), workflowDefinitions: Object.values(state.workflowDefinitions), approvalMatrices: Object.values(state.approvalMatrices), approvalResolutions: Object.values(state.approvalResolutions), workforcePolicies: Object.values(state.workforcePolicies), bulkActionPlans: Object.values(state.bulkActionPlans), exceptionTaxonomies: Object.values(state.exceptionTaxonomies), operationalExceptions: Object.values(state.operationalExceptions), configuredWorkflowCases: Object.values(state.configuredWorkflowCases) }; }
function add(registry, id, record) { if (!id || registry?.[id]) throw error("institution_record_duplicate", "Record id already exists."); return { ...(registry ?? {}), [id]: record }; }
function error(code, message) { return Object.assign(new Error(message), { code }); }
