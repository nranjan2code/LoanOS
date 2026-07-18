import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acknowledgeCicBatch,
  buildCicUcrfRecord,
  createCicCorrectionRequest,
  createCicResubmission,
  createCicSubmissionBatch,
  deriveCicReportingPeriod,
  deriveWorkflowTasks,
  enrichCicCorrection,
  resolveCicCorrectionRequest,
  submitCicBatch
} from "@loanos/core";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { loadState, saveState } from "../apps/api/src/file-store.js";

const NOW = new Date("2026-07-18T10:00:00.000Z");
const MEMBER = { memberCode: "MEM001", memberName: "LoanOS Bank" };

function account(overrides = {}) {
  return {
    loanAccountId: "loan_1", applicationId: "app_1", borrowerId: "bor_1", regulatedEntityId: "re_1",
    productId: "prod_1", productCode: "PL", status: "active", currency: "INR", facilityType: "term_loan",
    repaymentStructure: "amortizing", repaymentFrequency: "monthly", principalAmount: 100000, annualInterestRateBps: 1200,
    tenorMonths: 12, openedAt: "2026-06-01T00:00:00.000Z", disbursedAt: "2026-06-01T00:00:00.000Z",
    schedule: [{ installmentNumber: 1, dueDate: "2026-08-01", principalDue: 8000, interestDue: 1000, totalDue: 9000 }],
    ledger: [{ eventId: "led_1", type: "disbursement", eventDate: "2026-06-01T00:00:00.000Z", principalDebit: 100000, principalCredit: 0, interestDebit: 0, interestCredit: 0, chargesDebit: 0, chargesCredit: 0, chargesWaiverCredit: 0 }],
    ...overrides
  };
}

function consumer(overrides = {}) {
  return {
    borrowerId: "bor_1", borrowerType: "individual", fullName: "Asha Sharma", dateOfBirth: "1990-02-03",
    primaryAddress: "10 MG Road", contact: { mobile: "+919999999999", email: "asha@example.in" },
    economicProfile: { occupation: "salaried", monthlyIncome: 50000 },
    creditReporting: { gender: "F", identity: { type: "pan", number: "ABCDE1234F" }, address: { line1: "10 MG Road", stateCode: "27", pinCode: "400001" } },
    ...overrides
  };
}

test("CIC calendar accepts only the 15th and calendar month-end", () => {
  assert.deepEqual(deriveCicReportingPeriod("2026-02-28"), { cycleDate: "2026-02-28", frequency: "fortnightly", submissionDueDate: "2026-03-07" });
  assert.equal(deriveCicReportingPeriod("2026-02-16"), null);
});

test("CIC UCRF builder emits consumer and commercial records and fails closed on identity gaps", () => {
  const consumerResult = buildCicUcrfRecord(account(), consumer(), MEMBER, "2026-07-15");
  assert.equal(consumerResult.summary.status, "ready");
  assert.equal(consumerResult.record.schema, "ucrf.consumer.canonical.v1");
  assert.equal(consumerResult.record.data.currentBalance, "100000.00");
  assert.equal(consumerResult.record.data.identificationNumber, "ABCDE1234F");

  const commercial = consumer({ borrowerType: "company", fullName: null, legalName: "Acme Private Limited", creditReporting: { legalConstitution: "private_limited", identity: { pan: "AACCA1234A", cin: "U12345MH2020PTC123456" }, address: { line1: "1 BKC", stateCode: "27", pinCode: "400051" } } });
  const commercialResult = buildCicUcrfRecord(account(), commercial, MEMBER, "2026-07-15");
  assert.equal(commercialResult.summary.status, "ready");
  assert.equal(commercialResult.record.schema, "ucrf.commercial.canonical.v1");
  assert.equal(commercialResult.record.data.pan, "AACCA1234A");

  const missingIdentity = buildCicUcrfRecord(account(), consumer({ creditReporting: null }), MEMBER, "2026-07-15");
  assert.equal(missingIdentity.summary.status, "blocked");
  assert(missingIdentity.findings.some((finding) => finding.path === "creditReporting.identity.number"));
});

test("CIC batch is sealed, requires default alerts, reconciles every acknowledgement, and resubmits rejects", () => {
  const delinquent = account({ schedule: [{ installmentNumber: 1, dueDate: "2026-06-15", principalDue: 8000, interestDue: 1000, totalDue: 9000 }] });
  let result = createCicSubmissionBatch({}, { loanAccounts: { loan_1: delinquent }, borrowerProfiles: { bor_1: consumer() } }, {
    batchId: "batch_1", cycleDate: "2026-07-15", cic: "transunion_cibil", regulatedEntityId: "re_1", regulatedEntityType: "nbfc", member: MEMBER,
    proposedBy: "maker", approvedBy: "checker", approvalRef: "APR-1"
  }, NOW);
  assert.equal(result.summary.status, "ready");
  assert.match(result.batch.checksumSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.batch.customerDefaultAlerts.length, 1);
  let registry = result.registry;

  const noAlert = submitCicBatch(registry, "batch_1", { providerSubmissionRef: "SUB-1", transmittedBy: "ops", transportEvidenceRef: "sftp-log-1" }, NOW);
  assert.equal(noAlert.summary.status, "blocked");
  result = submitCicBatch(registry, "batch_1", { providerSubmissionRef: "SUB-1", transmittedBy: "ops", transportEvidenceRef: "sftp-log-1", customerAlertEvidence: [{ recordId: result.batch.records[0].recordId, channel: "sms", deliveryRef: "SMS-1", deliveredAt: NOW.toISOString() }] }, NOW);
  assert.equal(result.batch.status, "submitted"); registry = result.registry;

  const recordId = result.batch.records[0].recordId;
  const badAck = acknowledgeCicBatch(registry, "batch_1", { acknowledgementRef: "ACK-1", receivedBy: "ops", recordResults: [] }, NOW);
  assert.equal(badAck.summary.status, "blocked");
  result = acknowledgeCicBatch(registry, "batch_1", { acknowledgementRef: "ACK-1", receivedBy: "ops", recordResults: [{ recordId, status: "rejected", rejectCode: "E101", rejectMessage: "Invalid identity" }] }, NOW);
  assert.equal(result.batch.status, "rejected"); assert.equal(result.batch.repairDueDate, "2026-07-25"); registry = result.registry;

  result = createCicResubmission(registry, "batch_1", { batchId: "batch_2", correctedRecords: [{ ...result.batch.records[0], data: { ...result.batch.records[0].data, identificationNumber: "ABCDE1234G" } }], correctionEvidenceRef: "CORE-CHANGE-1", proposedBy: "maker", approvedBy: "checker", approvalRef: "APR-2" }, NOW);
  assert.equal(result.batch.status, "ready"); assert.equal(result.batch.parentBatchId, "batch_1"); assert.equal(result.batch.recordCount, 1);

  const tasks = deriveWorkflowTasks({ cicSubmissionBatches: result.registry, cicCorrectionRequests: {}, workflowTasks: {} }, { asOf: NOW });
  assert(tasks.some((task) => task.type === "cic.rejected_record_repair"));
  assert(tasks.some((task) => task.type === "cic.submission" && task.entityId === "batch_2"));
});

test("CIC correction tracks 21/30-day clocks, source correction, next cycle, and compensation", () => {
  let result = createCicCorrectionRequest({}, { borrowerProfiles: { bor_1: consumer() }, loanAccounts: { loan_1: account() } }, {
    correctionId: "cor_1", borrowerId: "bor_1", loanAccountId: "loan_1", fieldPath: "identity.pan", reportedValue: "BAD", requestedValue: "ABCDE1234F", reason: "Typographical error", submittedBy: "borrower", sourceReportRef: "CIC-RPT-1"
  }, new Date("2026-07-01T10:00:00.000Z"));
  assert.equal(result.correction.institutionDueDate, "2026-07-22"); assert.equal(result.correction.overallDueDate, "2026-07-31");
  assert.equal(enrichCicCorrection(result.correction, new Date("2026-08-03T12:00:00.000Z")).accruedCompensationRupees, 300);

  result = resolveCicCorrectionRequest(result.registry, "cor_1", { decision: "accepted", decisionReason: "Matched PAN source", resolvedBy: "analyst", approvedBy: "manager", sourceCorrectionRef: "BORROWER-MASTER-CHG-1", nextReportingCycleDate: "2026-07-31" }, new Date("2026-07-20T10:00:00.000Z"));
  assert.equal(result.summary.status, "ready"); assert.equal(result.correction.status, "accepted"); assert.equal(result.correction.compensationDueRupees, 0);
});

test("CIC API persists batch lifecycle, correction workflow, and audit events tenant-locally", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-cic-api-"));
  const tenant = { tenantId: "tnt_cic", name: "CIC Test", apiKey: "cic-test-key" };
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { "x-api-key": tenant.apiKey, "content-type": "application/json", ...(init.headers ?? {}) } });
  await request("/loan-accounts");
  const state = await loadState(dataDir);
  state.tenants[tenant.tenantId].loanAccounts = { loan_1: account() };
  state.tenants[tenant.tenantId].borrowerProfiles = { bor_1: consumer() };
  await saveState(state, dataDir);

  let response = await request("/reporting/cic/submissions", { method: "POST", body: JSON.stringify({ batchId: "api_batch", cycleDate: "2026-06-30", cic: "experian", regulatedEntityId: "re_1", regulatedEntityType: "nbfc", member: MEMBER, proposedBy: "maker", approvedBy: "checker", approvalRef: "APR-API" }) });
  assert.equal(response.status, 201, response.status === 201 ? undefined : await response.text());
  const created = await response.json();
  response = await request("/reporting/cic/submissions?status=ready");
  assert.equal((await response.json()).batches.length, 1);

  response = await request("/borrowers/bor_1/cic-corrections", { method: "POST", body: JSON.stringify({ correctionId: "api_cor", loanAccountId: "loan_1", fieldPath: "identity.pan", reportedValue: "BAD", requestedValue: "ABCDE1234F", reason: "Wrong value", submittedBy: "borrower", sourceReportRef: "RPT-API" }) });
  assert.equal(response.status, 201, response.status === 201 ? undefined : await response.text());
  response = await request("/workflow/tasks?type=cic.correction_review&asOf=2026-07-20T00:00:00.000Z");
  assert.equal((await response.json()).tasks.length, 1);

  const persisted = await loadState(dataDir);
  assert.equal(persisted.tenants[tenant.tenantId].cicSubmissionBatches.api_batch.checksumSha256, created.batch.checksumSha256);
  assert(persisted.tenants[tenant.tenantId].events.some((event) => event.type === "cic.batch.created"));
  assert(persisted.tenants[tenant.tenantId].events.some((event) => event.type === "cic.correction.opened"));
});
