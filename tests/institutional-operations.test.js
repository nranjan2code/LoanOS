import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
import { createLoanOsServer } from "../apps/api/src/server.js";

const NOW = new Date("2026-07-14T00:00:00.000Z"); const approval = { proposedBy: "operations_maker", approvedBy: "operations_checker", approvalRef: "approval-1" };
function baseState() { return { regulatedEntities: { re1: { regulatedEntityId: "re1" } }, productPolicies: { p1: { productPolicyId: "p1" } }, institutionOperatingUnits: {} }; }
function calendar() { return registerBusinessCalendar({}, { businessCalendarId: "india-calendar", name: "India operations", timezone: "Asia/Kolkata", workingWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-08-15"], workdayStart: "09:00", workdayEnd: "18:00", allowedPauseReasons: ["customer_dependency", "regulator_hold"], maximumPauseHours: 48, pauseApprovalRole: "operations_manager", ...approval }, NOW).calendar; }
function workflow(businessCalendarId = "india-calendar") { return registerWorkflowDefinition({}, { workflowId: "exception-workflow", version: 1, name: "Exception handling", entityType: "operational_exception", businessCalendarId, states: [{ state: "open", type: "initial", slaHours: 8, queue: "operations" }, { state: "review", type: "intermediate", slaHours: 16, queue: "risk" }, { state: "closed", type: "final" }], transitions: [{ transition: "submit", from: "open", to: "review", roles: ["operator"], makerChecker: false, evidenceRequired: true }, { transition: "approve", from: "review", to: "closed", roles: ["operations_manager"], makerChecker: true, evidenceRequired: true, conditionKeys: ["remediated"] }], ...approval }, NOW).definition; }

test("operating hierarchy and programmes remain within one regulated entity", () => {
  const state = baseState(); let units = {}; let result = registerOperatingUnit(units, state, { unitId: "legal", regulatedEntityId: "re1", unitType: "legal_entity", code: "LE", name: "Bank", costCentre: "100", ...approval }, NOW); units = result.registry; result = registerOperatingUnit(units, { ...state, institutionOperatingUnits: units }, { unitId: "region", regulatedEntityId: "re1", unitType: "region", parentUnitId: "legal", code: "WEST", name: "West", stateCode: "MH", costCentre: "110", ...approval }, NOW); units = result.registry; result = registerOperatingUnit(units, { ...state, institutionOperatingUnits: units }, { unitId: "branch", regulatedEntityId: "re1", unitType: "branch", parentUnitId: "region", code: "MUM01", name: "Mumbai", stateCode: "MH", serviceablePostalCodes: ["400001"], costCentre: "111", ...approval }, NOW); units = result.registry;
  const programme = registerLendingProgramme({}, { ...state, institutionOperatingUnits: units }, { programmeId: "programme-1", regulatedEntityId: "re1", name: "Digital personal loan", schemeCode: "DPL", productPolicyIds: ["p1"], operatingUnitIds: ["branch"], channels: ["digital"], borrowerSegments: ["salaried"], portfolioLimitPaise: "100000000", policyRef: "policy/programme", effectiveFrom: NOW.toISOString(), effectiveTo: "2027-07-14T00:00:00.000Z", owner: "business_owner", ...approval }, NOW).programme; assert.equal(programme.status, "active"); assert.equal(programme.operatingUnitIds[0], "branch");
  assert.throws(() => registerOperatingUnit(units, state, { unitId: "bad", regulatedEntityId: "re1", unitType: "region", parentUnitId: "branch", code: "BAD", name: "Bad", costCentre: "1", ...approval }, NOW), /not valid/);
});

test("regulatory applicability drives only applicable obligation schedules", () => {
  const state = baseState(); const profile = createRegulatoryApplicabilityProfile({}, state, { profileId: "profile-1", regulatedEntityId: "re1", productPolicyIds: ["p1"], institutionType: "NBFC", determinations: [{ controlId: "RBI-DL-2025", applicability: "applicable", rationale: "Digital lender", owner: "cco" }, { controlId: "CERSAI-CKYC", applicability: "not_applicable", rationale: "No secured product", legalOpinionRef: "legal/opinion", owner: "cco" }], reviewDueAt: "2027-07-14T00:00:00.000Z", ...approval }, NOW).profile;
  const calendarRecord = createComplianceObligationCalendar({}, { regulatoryApplicabilityProfiles: { [profile.profileId]: profile } }, { calendarId: "obligations-1", profileId: profile.profileId, obligations: [{ obligationId: "dla-return", controlId: "RBI-DL-2025", title: "DLA return", recurrence: "monthly", dueAt: "2026-08-10T00:00:00.000Z", owner: "compliance", reviewer: "cco", evidenceRequirements: ["submission", "acknowledgement"], escalationDaysBefore: 3 }], ...approval }, NOW).calendar; assert.equal(calendarRecord.status, "active");
  assert.throws(() => createComplianceObligationCalendar({}, { regulatoryApplicabilityProfiles: { [profile.profileId]: profile } }, { calendarId: "bad", profileId: profile.profileId, obligations: [{ obligationId: "cersai", controlId: "CERSAI-CKYC", title: "CERSAI", recurrence: "annual", dueAt: "2027-01-01T00:00:00.000Z", owner: "x", reviewer: "y", evidenceRequirements: ["z"], escalationDaysBefore: 1 }], ...approval }, NOW), /not applicable/);
});

test("configurable workflow enforces state, role, conditions, evidence, and four-eyes", () => {
  const businessCalendar = calendar(); const definition = workflow(); const state = { businessCalendars: { [businessCalendar.businessCalendarId]: businessCalendar }, workflowDefinitions: { [definition.workflowId]: definition } }; let workflowCase = createConfiguredWorkflowCase(state, { caseId: "case-1", workflowId: definition.workflowId, entityId: "exception-1", createdBy: "operator-1" }, NOW); assert.equal(workflowCase.state, "open"); workflowCase = transitionConfiguredWorkflowCase(state, workflowCase, { transition: "submit", actor: "operator-1", actorRole: "operator", evidenceRef: "evidence/submit" }, NOW); assert.equal(workflowCase.state, "review");
  assert.throws(() => transitionConfiguredWorkflowCase(state, workflowCase, { transition: "approve", actor: "manager-1", actorRole: "operations_manager", proposedBy: "manager-1", evidenceRef: "evidence/approve", conditions: { remediated: true } }, NOW), /independent/);
  workflowCase = transitionConfiguredWorkflowCase(state, workflowCase, { transition: "approve", actor: "manager-1", actorRole: "operations_manager", proposedBy: "operator-1", evidenceRef: "evidence/approve", conditions: { remediated: true } }, NOW); assert.equal(workflowCase.status, "completed");
});

test("approval matrix resolves exact-paise amount, product, risk, and deviation facts", () => {
  const definition = workflow(); const matrix = registerApprovalMatrix({}, { workflowDefinitions: { [definition.workflowId]: definition } }, { matrixId: "matrix-1", workflowId: definition.workflowId, version: 1, rules: [{ ruleId: "high-risk", priority: 1, productIds: ["p1"], riskRatings: ["high"], deviationCodes: ["FOIR"], minimumAmountPaise: "100000", maximumAmountPaise: "10000000", requiredRoles: ["credit_manager", "risk_manager"], approvalsRequired: 2, unanimous: true }], defaultOutcome: "require_human", ...approval }, NOW).matrix;
  const resolution = resolveApprovalRequirement(matrix, { amountPaise: "100000", productId: "p1", riskRating: "high", deviationCodes: ["FOIR"] }); assert.equal(resolution.ruleId, "high-risk"); assert.equal(resolution.approvalsRequired, 2);
  assert.equal(resolveApprovalRequirement(matrix, { amountPaise: "99999", productId: "p1", riskRating: "high", deviationCodes: ["FOIR"] }).outcome, "require_human");
});

test("workforce policy and bounded bulk actions retain substitution, capacity, escalation, and approval", () => {
  const policy = registerWorkforcePolicy({}, { policyId: "workforce-1", capacities: [{ actorId: "op-1", queues: ["operations"], maximumOpenTasks: 20, status: "leave" }, { actorId: "op-2", queues: ["operations"], maximumOpenTasks: 20, status: "available" }], delegations: [{ delegationId: "delegation-1", fromActorId: "op-1", toActorId: "op-2", queues: ["operations"], startsAt: NOW.toISOString(), endsAt: "2026-07-20T00:00:00.000Z", reason: "leave", delegationApprovalRef: "approval/delegation" }], escalations: [{ queue: "operations", ageingHours: 8, targetRole: "operations_manager", priority: "high" }], balancingMethod: "least_open_tasks", ...approval }, NOW).policy; assert.equal(policy.status, "active");
  const plan = planBulkAction({ bulkActionId: "bulk-1", taskIds: Array.from({ length: 30 }, (_, index) => `task-${index}`), action: "assign", actionInput: { actorId: "op-2" }, idempotencyKey: "bulk-key", highVolumeApprovalRef: "approval/high-volume", ...approval }, NOW); assert.equal(plan.taskIds.length, 30);
  assert.throws(() => planBulkAction({ bulkActionId: "bad", taskIds: Array.from({ length: 30 }, (_, index) => `task-${index}`), action: "assign", actionInput: { actorId: "op-2" }, idempotencyKey: "bad", ...approval }, NOW), /high-volume/);
});

test("exception taxonomy requires root cause and derives remediation deadline", () => {
  const taxonomy = registerExceptionTaxonomy({}, { taxonomyId: "taxonomy-1", version: 1, categories: [{ code: "PAYMENT_MISMATCH", name: "Payment mismatch", severity: "high", rootCauseRequired: true, remediationSlaDays: 2, ownerRole: "finance_manager" }], ...approval }, NOW).taxonomy; const state = { exceptionTaxonomies: { [taxonomy.taxonomyId]: taxonomy } };
  assert.throws(() => recordOperationalException(state, { exceptionId: "bad", taxonomyId: taxonomy.taxonomyId, code: "PAYMENT_MISMATCH", entityType: "payment", entityId: "p1", description: "Mismatch", evidenceRefs: ["evidence/1"], owner: "finance", recordedBy: "operator" }, NOW), /root cause/);
  const exception = recordOperationalException(state, { exceptionId: "exception-1", taxonomyId: taxonomy.taxonomyId, code: "PAYMENT_MISMATCH", entityType: "payment", entityId: "p1", description: "Mismatch", rootCause: "provider reference", evidenceRefs: ["evidence/1"], owner: "finance", recordedBy: "operator" }, NOW); assert.equal(exception.status, "open"); assert.equal(exception.remediationDueAt, "2026-07-16T00:00:00.000Z");
});

test("institution operations API persists approved business calendars tenant-locally", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-institution-")); const tenant = { tenantId: "tenant_inst", name: "Institution Bank", apiKey: "inst-key" }; const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve())); t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); }); const base = `http://127.0.0.1:${server.address().port}`;
  const body = { businessCalendarId: "api-calendar", name: "API calendar", timezone: "Asia/Kolkata", workingWeekdays: [1, 2, 3, 4, 5], holidays: [], workdayStart: "09:00", workdayEnd: "18:00", allowedPauseReasons: ["customer_dependency"], maximumPauseHours: 24, pauseApprovalRole: "operations_manager", proposedBy: "maker", approvedBy: "tenant_inst", approvalRef: "approval/api" }; let response = await fetch(`${base}/institution/operations/business-calendars`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify(body) }); assert.equal(response.status, 201, await response.clone().text()); response = await fetch(`${base}/institution/operations`, { headers: { "x-api-key": tenant.apiKey } }); const controls = await response.json(); assert.equal(controls.businessCalendars.length, 1);
});
