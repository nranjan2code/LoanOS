import assert from "node:assert/strict";
import test from "node:test";

import {
  PERSISTENT_SPECIALIST_JOURNEY_TYPES,
  SPECIALIST_JOURNEY_TYPE_TO_FAMILY,
  approveSpecialistJourneyAction,
  approveSpecialistJourneyConfiguration,
  openSpecialistJourneyCase,
  pauseSpecialistCasesForPrincipal,
  projectSpecialistJourneyWorkspace,
  proposeSpecialistJourneyAction,
  proposeSpecialistJourneyConfiguration,
  suspendSpecialistJourneyConfiguration
} from "../packages/core/src/specialist-journey-service.js";
import { deriveWorkflowTasks } from "../packages/core/src/workflow-tasks.js";

const NOW = new Date("2026-07-15T00:00:00.000Z");
const H = "a".repeat(64);

function kernelConfiguration(journeyType) {
  if (["invoice_discounting", "purchase_order_finance", "supply_chain_finance", "trade_finance_workflow"].includes(journeyType)) return {
    facilityLimitPaise: "1000000", singleObligorLimitPaise: "800000", maxConcentrationBps: 8000, advanceRateBps: 8000,
    requiredMilestones: ["credit_approved"], requiredDocuments: journeyType === "purchase_order_finance" ? ["purchase_order"] : ["invoice"],
    msmeBinding: { productType: "msme_working_capital", productConfigRef: "product/msme-wc", udyamRequired: true }
  };
  return { minimumAmountPaise: "100", maximumAmountPaise: "1000000", maximumLtvPercent: "75.0000", eligibilityPolicyRef: "eligibility/v1", kycControlRef: "kyc/v1", agreementTemplateRef: "agreement/v1", servicingPolicyRef: "servicing/v1", collateralPolicyRef: "collateral/v1" };
}

function proposal(journeyType, suffix = journeyType) {
  return {
    tenantId: "t1", requestId: `request-${suffix}`, configurationId: `configuration-${suffix}`, journeyType,
    productTemplateRef: `builtin:${journeyType}`, productTemplateVersion: "1.0.0", productTemplateChecksumSha256: H,
    schemaVersion: "1.0.0", policyVersionRef: "policy/v1", workflowVersionRef: "workflow/v1", accountingPolicyRef: "accounting/v1",
    assignedRoleIds: ["credit_operations_officer", "credit_approver"], kernelConfiguration: kernelConfiguration(journeyType), idempotencyKey: `configuration/${suffix}`, proposedBy: "maker"
  };
}

function configure(state, journeyType, suffix = journeyType) {
  const proposed = proposeSpecialistJourneyConfiguration(state, proposal(journeyType, suffix), NOW);
  return approveSpecialistJourneyConfiguration(proposed.state, { tenantId: "t1", requestId: proposed.request.requestId, approvedBy: "checker", approvalRef: `approval/${suffix}` }, NOW);
}

function open(state, configurationId, caseId = "case-1", assignedPrincipalIds = ["operator-1"]) {
  return openSpecialistJourneyCase(state, { tenantId: "t1", caseId, configurationId, expectedConfigurationVersion: 1, subjectRef: `borrower/${caseId}`, sourceApplicationRef: `application/${caseId}`, assignedPrincipalIds, idempotencyKey: `case/${caseId}`, openedBy: "operator-1" }, NOW);
}

function execute(state, caseId, actionId, actionType, payload, maker = "operator-1", checker = "operator-2") {
  const proposed = proposeSpecialistJourneyAction(state, { tenantId: "t1", caseId, actionId, actionType, payload, idempotencyKey: `action/${actionId}`, proposedBy: maker }, NOW);
  return approveSpecialistJourneyAction(proposed.state, { tenantId: "t1", actionId, approvedBy: checker, approvalRef: `approval/${actionId}` }, NOW);
}

test("persistent specialist service covers exactly the 13 specialised and four trade journey types", () => {
  assert.equal(Object.keys(SPECIALIST_JOURNEY_TYPE_TO_FAMILY).length, 13);
  assert.equal(PERSISTENT_SPECIALIST_JOURNEY_TYPES.length, 17);
  let state = {};
  for (const journeyType of PERSISTENT_SPECIALIST_JOURNEY_TYPES) {
    const result = configure(state, journeyType);
    state = result.state;
    assert.equal(result.configuration.status, "active");
    assert.equal(result.configuration.journeyType, journeyType);
    assert.match(result.configuration.configurationChecksumSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(Object.keys(state.specialistJourneyConfigurations).length, 17);
  assert.equal(Object.keys(state.specialisedJourneys).length, 13);
  assert.equal(Object.keys(state.tradeJourneyPacks).length, 4);
});

test("configuration and case identities are exact-content idempotent, version-bound and tenant isolated", () => {
  const first = proposeSpecialistJourneyConfiguration({}, proposal("home_loan"), NOW);
  assert.equal(proposeSpecialistJourneyConfiguration(first.state, proposal("home_loan"), NOW).idempotent, true);
  assert.throws(() => proposeSpecialistJourneyConfiguration(first.state, { ...proposal("home_loan"), schemaVersion: "2.0.0" }, NOW), (error) => error.code === "specialist_configuration_conflict");
  assert.throws(() => approveSpecialistJourneyConfiguration(first.state, { tenantId: "t1", requestId: first.request.requestId, approvedBy: "maker", approvalRef: "self" }, NOW), (error) => error.code === "specialist_four_eyes_required");
  const tampered = { ...first.state, specialistJourneyConfigurationRequests: { ...first.state.specialistJourneyConfigurationRequests, "t1:request-home_loan": { ...first.request, schemaVersion: "9.0.0" } } };
  assert.throws(() => approveSpecialistJourneyConfiguration(tampered, { tenantId: "t1", requestId: first.request.requestId, approvedBy: "checker", approvalRef: "a" }, NOW), (error) => error.code === "specialist_configuration_tampered");
  const approved = approveSpecialistJourneyConfiguration(first.state, { tenantId: "t1", requestId: first.request.requestId, approvedBy: "checker", approvalRef: "a" }, NOW);
  assert.throws(() => openSpecialistJourneyCase(approved.state, { tenantId: "t1", caseId: "c", configurationId: approved.configuration.configurationId, expectedConfigurationVersion: 2, subjectRef: "b", sourceApplicationRef: "a", assignedPrincipalIds: ["p"], idempotencyKey: "c", openedBy: "p" }, NOW), (error) => error.code === "specialist_configuration_version_conflict");
  assert.throws(() => openSpecialistJourneyCase(approved.state, { tenantId: "other", caseId: "c", configurationId: approved.configuration.configurationId, expectedConfigurationVersion: 1, subjectRef: "b", sourceApplicationRef: "a", assignedPrincipalIds: ["p"], idempotencyKey: "c", openedBy: "p" }, NOW), (error) => error.code === "specialist_configuration_inactive");
});

test("specialised cases execute through independent actions and persist refer and kernel failures as exceptions", () => {
  let state = configure({}, "home_loan").state;
  state = open(state, "configuration-home_loan", "home-good").state;
  let result = execute(state, "home-good", "assess-good", "assess", { facts: { requestedAmountPaise: "500000", propertyRef: "property/1", titleReviewStatus: "clear", valuationRef: "valuation/1", constructionStageRef: "stage/1", stageCertified: true } });
  assert.equal(result.blocked, false); assert.equal(result.result.outcome, "allow"); assert.equal(result.case.status, "assessed"); state = result.state;

  state = open(state, "configuration-home_loan", "home-refer").state;
  result = execute(state, "home-refer", "assess-refer", "assess", { facts: { requestedAmountPaise: "500000" } });
  assert.equal(result.result.outcome, "refer"); assert.equal(result.case.status, "exception"); assert.ok(result.result.exceptionId); state = result.state;
  const exception = projectSpecialistJourneyWorkspace(state, "t1").exceptions.find((item) => item.caseId === "home-refer");
  assert.equal(exception.status, "open");

  state = open(state, "configuration-home_loan", "home-invalid").state;
  result = execute(state, "home-invalid", "assess-invalid", "assess", { facts: { requestedAmountPaise: "invalid" } });
  assert.equal(result.blocked, true); assert.equal(result.case.status, "exception"); assert.equal(result.exception.code, "journey_money_invalid");
});

test("trade case actions compose party, asset, transaction, draw and exact settlement kernels", () => {
  let state = configure({}, "invoice_discounting").state;
  state = open(state, "configuration-invoice_discounting", "trade-1", ["trade-maker"]).state;
  for (const [partyId, role] of [["supplier", "supplier"], ["buyer", "buyer"]]) {
    state = execute(state, "trade-1", `party-${partyId}`, "register_party", { partyId, role, name: partyId, legalEntityRef: `legal/${partyId}`, kycEvidenceRef: `kyc/${partyId}`, bankVerificationRef: `bank/${partyId}`, sanctionsScreeningRef: `screen/${partyId}`, residencyCountry: "IN", udyamRef: role === "supplier" ? "udyam/1" : null }, "trade-maker", "trade-checker").state;
  }
  state = execute(state, "trade-1", "asset-1", "register_asset", { assetId: "invoice-1", idempotencyKey: "asset/invoice-1", assetType: "invoice", supplierId: "supplier", buyerId: "buyer", externalRef: "INV-1", faceValuePaise: "500000", issueDate: "2026-07-01", dueDate: "2026-08-01", documents: [{ type: "invoice", evidenceRef: "document/invoice" }], assignment: { status: "acknowledged", noticeRef: "notice/1", acknowledgementRef: "ack/1" } }, "trade-maker", "trade-checker").state;
  state = execute(state, "trade-1", "transaction-1", "approve_transaction", { transactionId: "transaction-1", idempotencyKey: "transaction/1", assetId: "invoice-1", requestedPaise: "400000", eligiblePaise: "400000", milestones: [{ name: "credit_approved", status: "completed", evidenceRef: "credit/1" }], accountingRef: "accounting/transaction" }, "trade-maker", "trade-checker").state;
  state = execute(state, "trade-1", "draw-1", "draw", { transactionId: "transaction-1", drawId: "draw-1", amountPaise: "400000", disbursementInstructionRef: "bank/draw", beneficiaryVerificationRef: "bank/beneficiary", accountingPostingRef: "gl/draw" }, "trade-maker", "trade-checker").state;
  const settled = execute(state, "trade-1", "settle-1", "settle", { transactionId: "transaction-1", settlementId: "settlement-1", proceedsPaise: "405000", principalAllocationPaise: "400000", interestAllocationPaise: "4000", feeAllocationPaise: "1000", supplierSurplusPaise: "0", bankReceiptRef: "bank/receipt", accountingPostingRef: "gl/settlement" }, "trade-maker", "trade-checker");
  assert.equal(settled.result.status, "settled"); assert.equal(settled.case.status, "assessed");
});

test("configuration suspension and principal revocation pause cases immediately and expose critical tasks", () => {
  let state = configure({}, "gold_loan").state;
  state = open(state, "configuration-gold_loan", "gold-1", ["operator-1"]).state;
  let safety = pauseSpecialistCasesForPrincipal(state, { tenantId: "t1", principalId: "operator-1", actor: "security-admin", causeType: "principal_suspended", causeRef: "incident/1" }, NOW);
  assert.deepEqual(safety.affectedCaseIds, ["gold-1"]); assert.equal(safety.escalations[0].severity, "critical");
  let workspace = projectSpecialistJourneyWorkspace(safety.state, "t1"); assert.equal(workspace.cases[0].status, "paused"); assert.equal(workspace.tasks[0].type, "specialist_journey.recovery");
  assert.equal(deriveWorkflowTasks(safety.state, { filters: { tenantId: "t1" } }).some((task) => task.taskId === "task_specialist_gold-1"), true);

  state = open(state, "configuration-gold_loan", "gold-2", ["operator-2"]).state;
  safety = suspendSpecialistJourneyConfiguration(state, { tenantId: "t1", configurationId: "configuration-gold_loan", actor: "credit-admin", reason: "policy withdrawn", evidenceRef: "policy/withdrawal" }, NOW);
  assert.deepEqual(safety.affectedCaseIds.sort(), ["gold-1", "gold-2"]); workspace = projectSpecialistJourneyWorkspace(safety.state, "t1"); assert.equal(workspace.configurations[0].status, "suspended"); assert.ok(workspace.cases.every((item) => item.status === "paused"));
});
