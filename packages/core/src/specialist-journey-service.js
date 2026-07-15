import { createHash } from "node:crypto";

import { assessSpecialisedJourney, registerSpecialisedJourney } from "./specialised-lending-journeys.js";
import {
  approveTradeFacilityTransaction,
  configureTradeJourneyPack,
  drawTradeFacility,
  registerTradeAsset,
  registerTradeParty,
  settleTradeProceeds
} from "./working-capital-trade-journeys.js";

export const SPECIALIST_JOURNEY_TYPE_TO_FAMILY = Object.freeze({
  agriculture_allied_finance: "agriculture_allied",
  commercial_vehicle_finance: "commercial_vehicle",
  consumer_durable_finance: "consumer_durable",
  education_loan: "education",
  equipment_machinery_finance: "equipment",
  gold_loan: "gold",
  green_equipment_finance: "green_equipment",
  home_loan: "home",
  loan_against_property: "lap",
  microfinance_group_lending: "microfinance_group",
  personal_vehicle_loan: "personal_vehicle",
  professional_practice_loan: "professional_practice",
  secured_business_loan: "secured_business"
});

export const PERSISTENT_SPECIALIST_JOURNEY_TYPES = Object.freeze([
  ...Object.keys(SPECIALIST_JOURNEY_TYPE_TO_FAMILY),
  "invoice_discounting",
  "purchase_order_finance",
  "supply_chain_finance",
  "trade_finance_workflow"
].sort());

const TYPE_SET = new Set(PERSISTENT_SPECIALIST_JOURNEY_TYPES);
const TRADE_TYPES = new Set(["invoice_discounting", "purchase_order_finance", "supply_chain_finance", "trade_finance_workflow"]);
const ACTIONS = new Set(["assess", "register_party", "register_asset", "approve_transaction", "draw", "settle", "resolve_exception", "resume", "reassign", "close"]);
const TERMINAL_CASE_STATUSES = new Set(["closed", "cancelled"]);

export function proposeSpecialistJourneyConfiguration(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const requestId = text(input.requestId, "requestId");
  const configurationId = text(input.configurationId, "configurationId");
  const journeyType = text(input.journeyType, "journeyType");
  if (!TYPE_SET.has(journeyType)) fail("specialist_journey_type_invalid", "A supported specialist journey type is required.");
  const proposedBy = text(input.proposedBy, "proposedBy");
  const immutable = {
    tenantId,
    requestId,
    configurationId,
    journeyType,
    productTemplateRef: text(input.productTemplateRef, "productTemplateRef"),
    productTemplateVersion: text(input.productTemplateVersion, "productTemplateVersion"),
    productTemplateChecksumSha256: sha(input.productTemplateChecksumSha256, "productTemplateChecksumSha256"),
    schemaVersion: text(input.schemaVersion, "schemaVersion"),
    policyVersionRef: text(input.policyVersionRef, "policyVersionRef"),
    workflowVersionRef: text(input.workflowVersionRef, "workflowVersionRef"),
    accountingPolicyRef: text(input.accountingPolicyRef, "accountingPolicyRef"),
    assignedRoleIds: nonEmptyStrings(input.assignedRoleIds, "assignedRoleIds"),
    kernelConfiguration: object(input.kernelConfiguration, "kernelConfiguration"),
    idempotencyKey: text(input.idempotencyKey, "idempotencyKey")
  };
  const requestChecksumSha256 = hash(immutable);
  const prior = sameTenantValues(state.specialistJourneyConfigurationRequests, tenantId).find((item) => item.requestId === requestId || item.idempotencyKey === immutable.idempotencyKey);
  if (prior) {
    if (prior.requestChecksumSha256 !== requestChecksumSha256) fail("specialist_configuration_conflict", "Configuration request identity was reused with different content.");
    return { state, request: prior, idempotent: true };
  }
  if (state.specialistJourneyConfigurations?.[key(tenantId, configurationId)]) fail("specialist_configuration_exists", "Configuration already exists in this tenant.");
  const request = Object.freeze({ ...immutable, requestChecksumSha256, proposedBy, status: "pending", proposedAt: instant(now) });
  return { state: put(state, "specialistJourneyConfigurationRequests", key(tenantId, requestId), request), request, idempotent: false };
}

export function approveSpecialistJourneyConfiguration(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const requestId = text(input.requestId, "requestId");
  const requestKey = key(tenantId, requestId);
  const request = state.specialistJourneyConfigurationRequests?.[requestKey];
  if (!request || request.status !== "pending" || request.tenantId !== tenantId) fail("specialist_configuration_request_invalid", "A pending same-tenant configuration request is required.");
  verifyRequest(request);
  const approvedBy = text(input.approvedBy, "approvedBy");
  if (approvedBy === request.proposedBy) fail("specialist_four_eyes_required", "Configuration approval requires an independent authenticated human.");
  const approvalRef = text(input.approvalRef, "approvalRef");
  const configurationKey = key(tenantId, request.configurationId);
  if (state.specialistJourneyConfigurations?.[configurationKey]) fail("specialist_configuration_exists", "Configuration already exists in this tenant.");

  let next = state;
  let kernelRecord;
  if (TRADE_TYPES.has(request.journeyType)) {
    const result = configureTradeJourneyPack(state.tradeJourneyPacks ?? {}, {
      ...request.kernelConfiguration,
      tenantId,
      packId: request.configurationId,
      journeyType: request.journeyType,
      accountingPolicyRef: request.accountingPolicyRef,
      proposedBy: request.proposedBy,
      approvedBy,
      approvalRef
    }, now);
    next = { ...next, tradeJourneyPacks: result.registry };
    kernelRecord = result.pack;
  } else {
    const result = registerSpecialisedJourney({ specialisedJourneys: state.specialisedJourneys ?? {} }, {
      ...request.kernelConfiguration,
      tenantId,
      journeyId: request.configurationId,
      family: SPECIALIST_JOURNEY_TYPE_TO_FAMILY[request.journeyType],
      accountingPolicyRef: request.accountingPolicyRef,
      proposedBy: request.proposedBy,
      approvedBy,
      approvalRef
    }, now);
    next = { ...next, specialisedJourneys: result.state.specialisedJourneys };
    kernelRecord = result.journey;
  }
  const core = {
    tenantId,
    configurationId: request.configurationId,
    journeyType: request.journeyType,
    kernelKind: TRADE_TYPES.has(request.journeyType) ? "trade" : "specialised",
    kernelFamily: TRADE_TYPES.has(request.journeyType) ? request.journeyType : SPECIALIST_JOURNEY_TYPE_TO_FAMILY[request.journeyType],
    productTemplateRef: request.productTemplateRef,
    productTemplateVersion: request.productTemplateVersion,
    productTemplateChecksumSha256: request.productTemplateChecksumSha256,
    schemaVersion: request.schemaVersion,
    policyVersionRef: request.policyVersionRef,
    workflowVersionRef: request.workflowVersionRef,
    accountingPolicyRef: request.accountingPolicyRef,
    assignedRoleIds: request.assignedRoleIds,
    kernelRecordChecksumSha256: hash(kernelRecord),
    version: 1
  };
  const configuration = Object.freeze({ ...core, configurationChecksumSha256: hash(core), status: "active", proposedBy: request.proposedBy, approvedBy, approvalRef, activatedAt: instant(now), suspendedAt: null });
  const decided = Object.freeze({ ...request, status: "approved", approvedBy, approvalRef, decidedAt: instant(now) });
  next = put(put(next, "specialistJourneyConfigurations", configurationKey, configuration), "specialistJourneyConfigurationRequests", requestKey, decided);
  return { state: next, request: decided, configuration };
}

export function openSpecialistJourneyCase(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const caseId = text(input.caseId, "caseId");
  const configurationId = text(input.configurationId, "configurationId");
  const configuration = activeConfiguration(state, tenantId, configurationId);
  if (input.expectedConfigurationVersion !== configuration.version) fail("specialist_configuration_version_conflict", "The approved configuration version changed.");
  verifyConfiguration(configuration);
  const immutable = {
    tenantId,
    caseId,
    configurationId,
    configurationVersion: configuration.version,
    configurationChecksumSha256: configuration.configurationChecksumSha256,
    journeyType: configuration.journeyType,
    productTemplateVersion: configuration.productTemplateVersion,
    productTemplateChecksumSha256: configuration.productTemplateChecksumSha256,
    schemaVersion: configuration.schemaVersion,
    policyVersionRef: configuration.policyVersionRef,
    workflowVersionRef: configuration.workflowVersionRef,
    subjectRef: text(input.subjectRef, "subjectRef"),
    sourceApplicationRef: text(input.sourceApplicationRef, "sourceApplicationRef"),
    assignedPrincipalIds: nonEmptyStrings(input.assignedPrincipalIds, "assignedPrincipalIds"),
    idempotencyKey: text(input.idempotencyKey, "idempotencyKey")
  };
  const caseChecksumSha256 = hash(immutable);
  const prior = sameTenantValues(state.specialistJourneyCases, tenantId).find((item) => item.caseId === caseId || item.idempotencyKey === immutable.idempotencyKey);
  if (prior) {
    if (prior.caseChecksumSha256 !== caseChecksumSha256) fail("specialist_case_conflict", "Case identity was reused with different content.");
    return { state, case: prior, idempotent: true };
  }
  const openedBy = text(input.openedBy, "openedBy");
  const record = Object.freeze({ ...immutable, caseChecksumSha256, status: "active", openedBy, openedAt: instant(now), updatedAt: instant(now), lastActionId: null, pause: null, history: [{ type: "case_opened", actor: openedBy, at: instant(now) }] });
  return { state: put(state, "specialistJourneyCases", key(tenantId, caseId), record), case: record, idempotent: false };
}

export function proposeSpecialistJourneyAction(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const caseId = text(input.caseId, "caseId");
  const caseRecord = sameTenantCase(state, tenantId, caseId);
  const actionType = text(input.actionType, "actionType");
  if (!ACTIONS.has(actionType)) fail("specialist_action_type_invalid", "Unsupported specialist journey action.");
  if (TERMINAL_CASE_STATUSES.has(caseRecord.status)) fail("specialist_case_terminal", "A terminal case cannot accept new actions.");
  if (["paused", "exception"].includes(caseRecord.status) && !["resolve_exception", "resume", "reassign", "close"].includes(actionType)) fail("specialist_case_paused", "Paused or exception cases require governed recovery before business actions.");
  const configuration = state.specialistJourneyConfigurations?.[key(tenantId, caseRecord.configurationId)];
  if (!configuration || configuration.status !== "active") fail("specialist_configuration_inactive", "The case configuration is not active.");
  if (caseRecord.configurationChecksumSha256 !== configuration.configurationChecksumSha256 || caseRecord.configurationVersion !== configuration.version) fail("specialist_case_lineage_invalid", "Case configuration lineage changed.");
  validateActionForJourney(configuration, actionType);
  const immutable = {
    tenantId,
    actionId: text(input.actionId, "actionId"),
    caseId,
    actionType,
    configurationId: configuration.configurationId,
    configurationVersion: configuration.version,
    payload: object(input.payload, "payload"),
    idempotencyKey: text(input.idempotencyKey, "idempotencyKey")
  };
  const actionChecksumSha256 = hash(immutable);
  const prior = sameTenantValues(state.specialistJourneyActionRequests, tenantId).find((item) => item.actionId === immutable.actionId || item.idempotencyKey === immutable.idempotencyKey);
  if (prior) {
    if (prior.actionChecksumSha256 !== actionChecksumSha256) fail("specialist_action_conflict", "Action identity was reused with different content.");
    return { state, action: prior, idempotent: true };
  }
  const action = Object.freeze({ ...immutable, actionChecksumSha256, proposedBy: text(input.proposedBy, "proposedBy"), status: "pending", proposedAt: instant(now), result: null });
  return { state: put(state, "specialistJourneyActionRequests", key(tenantId, action.actionId), action), action, idempotent: false };
}

export function approveSpecialistJourneyAction(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const actionId = text(input.actionId, "actionId");
  const actionKey = key(tenantId, actionId);
  const action = state.specialistJourneyActionRequests?.[actionKey];
  if (!action || action.status !== "pending" || action.tenantId !== tenantId) fail("specialist_action_request_invalid", "A pending same-tenant action is required.");
  verifyAction(action);
  const approvedBy = text(input.approvedBy, "approvedBy");
  if (approvedBy === action.proposedBy) fail("specialist_four_eyes_required", "Action approval requires an independent authenticated human.");
  const approvalRef = text(input.approvalRef, "approvalRef");
  const caseRecord = sameTenantCase(state, tenantId, action.caseId);
  const configuration = state.specialistJourneyConfigurations?.[key(tenantId, caseRecord.configurationId)];
  if (!configuration || configuration.status !== "active") fail("specialist_configuration_inactive", "The case configuration is not active.");

  try {
    const executed = executeAction(state, configuration, caseRecord, action, approvedBy, approvalRef, now);
    const approvedAction = Object.freeze({ ...action, status: "executed", approvedBy, approvalRef, approvedAt: instant(now), result: executed.result, resultChecksumSha256: hash(executed.result) });
    const next = put(executed.state, "specialistJourneyActionRequests", actionKey, approvedAction);
    return { state: next, action: approvedAction, case: executed.case, result: executed.result, blocked: false };
  } catch (cause) {
    if (!cause?.code) throw cause;
    const exceptionId = `exception:${action.actionId}`;
    const exception = Object.freeze({ exceptionId, tenantId, caseId: action.caseId, actionId, code: cause.code, message: cause.message, status: "open", openedAt: instant(now), openedBy: approvedBy, resolutionRef: null });
    const blockedAction = Object.freeze({ ...action, status: "blocked", approvedBy, approvalRef, approvedAt: instant(now), result: { outcome: "blocked", exceptionId, code: cause.code }, resultChecksumSha256: hash({ outcome: "blocked", exceptionId, code: cause.code }) });
    const blockedCase = Object.freeze({ ...caseRecord, status: "exception", lastActionId: actionId, updatedAt: instant(now), history: [...caseRecord.history, { type: "action_blocked", actionId, code: cause.code, actor: approvedBy, at: instant(now) }] });
    let next = put(state, "specialistJourneyExceptions", key(tenantId, exceptionId), exception);
    next = put(next, "specialistJourneyCases", key(tenantId, caseRecord.caseId), blockedCase);
    next = put(next, "specialistJourneyActionRequests", actionKey, blockedAction);
    return { state: next, action: blockedAction, case: blockedCase, result: blockedAction.result, exception, blocked: true };
  }
}

export function suspendSpecialistJourneyConfiguration(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const configurationId = text(input.configurationId, "configurationId");
  const configurationKey = key(tenantId, configurationId);
  const configuration = state.specialistJourneyConfigurations?.[configurationKey];
  if (!configuration || configuration.tenantId !== tenantId || configuration.status !== "active") fail("specialist_configuration_inactive", "An active same-tenant configuration is required.");
  const actor = text(input.actor, "actor");
  const reason = text(input.reason, "reason");
  const evidenceRef = text(input.evidenceRef, "evidenceRef");
  let next = put(state, "specialistJourneyConfigurations", configurationKey, { ...configuration, status: "suspended", suspendedAt: instant(now), suspendedBy: actor, suspensionReason: reason, suspensionEvidenceRef: evidenceRef });
  const affectedCaseIds = [];
  for (const record of sameTenantValues(next.specialistJourneyCases, tenantId)) {
    if (record.configurationId !== configurationId || TERMINAL_CASE_STATUSES.has(record.status)) continue;
    affectedCaseIds.push(record.caseId);
    next = pauseCase(next, record, { causeType: "configuration_suspended", causeRef: evidenceRef, actor, reason }, now);
  }
  return { state: next, configuration: next.specialistJourneyConfigurations[configurationKey], affectedCaseIds, escalations: affectedCaseIds.map((caseId) => next.specialistJourneyEscalations[key(tenantId, `escalation:${caseId}:configuration_suspended`)]) };
}

export function pauseSpecialistCasesForPrincipal(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const principalId = text(input.principalId, "principalId");
  const actor = text(input.actor, "actor");
  const causeType = text(input.causeType, "causeType");
  const causeRef = text(input.causeRef, "causeRef");
  let next = state;
  const affectedCaseIds = [];
  for (const record of sameTenantValues(state.specialistJourneyCases, tenantId)) {
    if (TERMINAL_CASE_STATUSES.has(record.status)) continue;
    const pendingByPrincipal = sameTenantValues(state.specialistJourneyActionRequests, tenantId).some((action) => action.caseId === record.caseId && action.status === "pending" && action.proposedBy === principalId);
    if (!record.assignedPrincipalIds.includes(principalId) && !pendingByPrincipal) continue;
    affectedCaseIds.push(record.caseId);
    next = pauseCase(next, record, { causeType, causeRef, actor, reason: `Access authority changed for ${principalId}.`, affectedPrincipalId: principalId }, now);
  }
  return { state: next, affectedCaseIds, escalations: affectedCaseIds.map((caseId) => next.specialistJourneyEscalations[key(tenantId, `escalation:${caseId}:${causeType}`)]) };
}

export function projectSpecialistJourneyWorkspace(state = {}, tenantId) {
  text(tenantId, "tenantId");
  const cases = sameTenantValues(state.specialistJourneyCases, tenantId);
  return {
    tenantId,
    supportedJourneyTypes: PERSISTENT_SPECIALIST_JOURNEY_TYPES,
    configurationRequests: sameTenantValues(state.specialistJourneyConfigurationRequests, tenantId),
    configurations: sameTenantValues(state.specialistJourneyConfigurations, tenantId),
    cases,
    actionRequests: sameTenantValues(state.specialistJourneyActionRequests, tenantId),
    exceptions: sameTenantValues(state.specialistJourneyExceptions, tenantId),
    escalations: sameTenantValues(state.specialistJourneyEscalations, tenantId),
    tasks: projectSpecialistJourneyTasks(state, tenantId)
  };
}

export function projectSpecialistJourneyTasks(state = {}, tenantId) {
  return sameTenantValues(state.specialistJourneyCases, tenantId).filter((record) => !TERMINAL_CASE_STATUSES.has(record.status)).map((record) => ({
    taskId: `task_specialist_${record.caseId}`,
    type: record.status === "exception" ? "specialist_journey.exception" : record.status === "paused" ? "specialist_journey.recovery" : "specialist_journey.action",
    entityType: "specialist_journey_case",
    entityId: record.caseId,
    title: record.status === "exception" ? "Resolve specialist journey exception" : record.status === "paused" ? "Recover paused specialist journey" : "Continue specialist journey",
    description: `Operate the ${record.journeyType} case against its exact approved configuration lineage.`,
    queue: record.status === "exception" ? "credit_exceptions" : "specialist_lending",
    role: "credit_operations_officer",
    priority: ["exception", "paused"].includes(record.status) ? "critical" : "high",
    openedAt: record.openedAt,
    action: { method: "POST", path: `/admin/specialist-journeys/cases/${record.caseId}/actions`, description: "Propose the next governed case action." },
    context: { journeyType: record.journeyType, status: record.status, configurationId: record.configurationId, configurationVersion: record.configurationVersion }
  }));
}

function executeAction(state, configuration, caseRecord, action, approvedBy, approvalRef, now) {
  const control = { proposedBy: action.proposedBy, approvedBy, approvalRef };
  const payload = action.payload;
  let next = state;
  let result;
  let status = caseRecord.status;
  if (action.actionType === "assess") {
    result = assessSpecialisedJourney({ specialisedJourneys: state.specialisedJourneys ?? {} }, { tenantId: action.tenantId, journeyId: configuration.configurationId, expectedVersion: configuration.version, facts: payload.facts });
    status = result.outcome === "allow" ? "assessed" : "exception";
    if (result.outcome !== "allow") {
      const exceptionId = `exception:${action.actionId}:assessment`;
      const exception = { exceptionId, tenantId: action.tenantId, caseId: caseRecord.caseId, actionId: action.actionId, code: "specialist_assessment_refer", message: "Specialist assessment requires manual resolution.", gaps: result.gaps, status: "open", openedAt: instant(now), openedBy: approvedBy, resolutionRef: null };
      next = put(next, "specialistJourneyExceptions", key(action.tenantId, exceptionId), exception);
      result = { ...result, exceptionId };
    }
  } else if (action.actionType === "register_party") {
    const output = registerTradeParty(state.tradeParties ?? {}, { ...payload, tenantId: action.tenantId, ...control }, now); next = { ...next, tradeParties: output.registry }; result = output.party; status = "in_progress";
  } else if (action.actionType === "register_asset") {
    const output = registerTradeAsset(state.tradeAssets ?? {}, tradeState(state), { ...payload, tenantId: action.tenantId, packId: configuration.configurationId }, now); next = { ...next, tradeAssets: output.registry }; result = output.asset; status = "in_progress";
  } else if (action.actionType === "approve_transaction") {
    const output = approveTradeFacilityTransaction(state.tradeTransactions ?? {}, tradeState(state), { ...payload, tenantId: action.tenantId, ...control }, now); next = { ...next, tradeTransactions: output.registry }; result = output.transaction; status = "approved";
  } else if (action.actionType === "draw") {
    const output = drawTradeFacility(state.tradeTransactions ?? {}, { ...payload, tenantId: action.tenantId, ...control }, now); next = { ...next, tradeTransactions: output.registry }; result = output.transaction; status = "in_progress";
  } else if (action.actionType === "settle") {
    const output = settleTradeProceeds(state.tradeTransactions ?? {}, { ...payload, tenantId: action.tenantId, ...control }, now); next = { ...next, tradeTransactions: output.registry }; result = output.transaction; status = output.transaction.status === "settled" ? "assessed" : "in_progress";
  } else if (action.actionType === "resolve_exception") {
    const exceptionKey = key(action.tenantId, text(payload.exceptionId, "payload.exceptionId")); const exception = state.specialistJourneyExceptions?.[exceptionKey];
    if (!exception || exception.caseId !== caseRecord.caseId || exception.status !== "open") fail("specialist_exception_invalid", "An open same-case exception is required.");
    const resolved = { ...exception, status: "resolved", resolutionRef: text(payload.resolutionRef, "payload.resolutionRef"), resolvedBy: approvedBy, resolvedAt: instant(now) };
    next = put(next, "specialistJourneyExceptions", exceptionKey, resolved); result = resolved; status = "paused";
  } else if (action.actionType === "resume") {
    if (sameTenantValues(state.specialistJourneyExceptions, action.tenantId).some((item) => item.caseId === caseRecord.caseId && item.status === "open")) fail("specialist_exception_open", "All exceptions must be resolved before resume.");
    text(payload.reauthorizationRef, "payload.reauthorizationRef"); result = { reauthorizationRef: payload.reauthorizationRef }; status = "active";
    for (const escalation of sameTenantValues(state.specialistJourneyEscalations, action.tenantId)) {
      if (escalation.caseId !== caseRecord.caseId || escalation.status !== "open") continue;
      next = put(next, "specialistJourneyEscalations", key(action.tenantId, escalation.escalationId), { ...escalation, status: "resolved", resolutionRef: payload.reauthorizationRef, resolvedBy: approvedBy, resolvedAt: instant(now) });
    }
  } else if (action.actionType === "reassign") {
    const assignedPrincipalIds = nonEmptyStrings(payload.assignedPrincipalIds, "payload.assignedPrincipalIds"); result = { assignedPrincipalIds, assignmentRef: text(payload.assignmentRef, "payload.assignmentRef") };
  } else if (action.actionType === "close") {
    if (sameTenantValues(state.specialistJourneyExceptions, action.tenantId).some((item) => item.caseId === caseRecord.caseId && item.status === "open")) fail("specialist_exception_open", "Open exceptions block case closure.");
    result = { closureEvidenceRef: text(payload.closureEvidenceRef, "payload.closureEvidenceRef") }; status = "closed";
  }
  const updated = Object.freeze({ ...caseRecord, ...(result?.assignedPrincipalIds ? { assignedPrincipalIds: result.assignedPrincipalIds } : {}), status, lastActionId: action.actionId, pause: status === "active" ? null : caseRecord.pause, updatedAt: instant(now), history: [...caseRecord.history, { type: "action_executed", actionId: action.actionId, actionType: action.actionType, actor: approvedBy, at: instant(now) }] });
  next = put(next, "specialistJourneyCases", key(action.tenantId, caseRecord.caseId), updated);
  return { state: next, case: updated, result };
}

function pauseCase(state, record, cause, now) {
  const escalationId = `escalation:${record.caseId}:${cause.causeType}`;
  const at = instant(now);
  const paused = { ...record, status: "paused", pause: { ...cause, pausedAt: at }, updatedAt: at, history: [...record.history, { type: "case_paused", actor: cause.actor, causeType: cause.causeType, causeRef: cause.causeRef, at }] };
  const escalation = { escalationId, tenantId: record.tenantId, caseId: record.caseId, configurationId: record.configurationId, causeType: cause.causeType, causeRef: cause.causeRef, affectedPrincipalId: cause.affectedPrincipalId ?? null, status: "open", severity: "critical", openedAt: at, openedBy: cause.actor };
  return put(put(state, "specialistJourneyCases", key(record.tenantId, record.caseId), paused), "specialistJourneyEscalations", key(record.tenantId, escalationId), escalation);
}

function validateActionForJourney(configuration, actionType) {
  if (configuration.kernelKind === "specialised" && ["register_party", "register_asset", "approve_transaction", "draw", "settle"].includes(actionType)) fail("specialist_action_journey_mismatch", "Trade action cannot run on a specialised lending configuration.");
  if (configuration.kernelKind === "trade" && actionType === "assess") fail("specialist_action_journey_mismatch", "Specialised assessment cannot run on a trade configuration.");
}
function activeConfiguration(state, tenantId, configurationId) { const value = state.specialistJourneyConfigurations?.[key(tenantId, configurationId)]; if (!value || value.tenantId !== tenantId || value.status !== "active") fail("specialist_configuration_inactive", "An active same-tenant specialist configuration is required."); return value; }
function sameTenantCase(state, tenantId, caseId) { const value = state.specialistJourneyCases?.[key(tenantId, caseId)]; if (!value || value.tenantId !== tenantId) fail("specialist_case_missing", "A same-tenant specialist journey case is required."); return value; }
function tradeState(state) { return { packs: state.tradeJourneyPacks ?? {}, parties: state.tradeParties ?? {}, assets: state.tradeAssets ?? {}, transactions: state.tradeTransactions ?? {} }; }
function verifyRequest(request) { const { proposedBy, status, proposedAt, requestChecksumSha256, ...immutable } = request; if (hash(immutable) !== requestChecksumSha256) fail("specialist_configuration_tampered", "Configuration request checksum is invalid."); }
function verifyAction(action) { const { proposedBy, status, proposedAt, result, actionChecksumSha256, ...immutable } = action; if (hash(immutable) !== actionChecksumSha256) fail("specialist_action_tampered", "Action request checksum is invalid."); }
function verifyConfiguration(configuration) { const { configurationChecksumSha256, status, proposedBy, approvedBy, approvalRef, activatedAt, suspendedAt, suspendedBy, suspensionReason, suspensionEvidenceRef, ...core } = configuration; if (hash(core) !== configurationChecksumSha256) fail("specialist_configuration_tampered", "Configuration checksum is invalid."); }
function put(state, collection, recordKey, value) { return { ...state, [collection]: { ...(state[collection] ?? {}), [recordKey]: value } }; }
function sameTenantValues(registry, tenantId) { return Object.values(registry ?? {}).filter((item) => item?.tenantId === tenantId); }
function key(tenantId, id) { return `${tenantId}:${id}`; }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("specialist_input_invalid", `${field} is required.`); return value.trim(); }
function sha(value, field) { const output = text(value, field).toLowerCase(); if (!/^[a-f0-9]{64}$/.test(output)) fail("specialist_input_invalid", `${field} must be a SHA-256 digest.`); return output; }
function object(value, field) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("specialist_input_invalid", `${field} must be an object.`); return structuredClone(value); }
function nonEmptyStrings(value, field) { if (!Array.isArray(value) || !value.length) fail("specialist_input_invalid", `${field} must contain at least one value.`); return [...new Set(value.map((item) => text(item, field)))].sort(); }
function instant(value) { const result = value instanceof Date ? value : new Date(value); if (!Number.isFinite(result.getTime())) fail("specialist_input_invalid", "A valid timestamp is required."); return result.toISOString(); }
function canonical(value) { if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value); if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${canonical(value[name])}`).join(",")}}`; throw new Error("invalid_json"); }
function hash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
