import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acknowledgeFiuReport, buildFinnetXml, createFiuReport, deriveWorkflowTasks, fileFiuReport, repairFiuReport, reviewFiuReport } from "@loanos/core";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { loadState, saveState } from "../apps/api/src/file-store.js";

const NOW = new Date("2026-07-14T10:00:00.000Z");
function context() { return { regulatedEntities: { re_1: { regulatedEntityId: "re_1" } }, borrowerProfiles: { bor_1: { borrowerId: "bor_1", borrowerType: "individual", fullName: "Asha & Sharma", contact: { mobile: "+919999999999", email: "asha@example.in" } } } }; }
function input(overrides = {}) { return { reportId: "fiu_1", reportType: "suspicious_transaction", regulatedEntityId: "re_1", subjectBorrowerId: "bor_1", createdBy: "analyst", reportingEntityCode: "RE001", reportReference: "STR001", suspicionGrounds: "Structuring & unusual cash", suspicionIndicators: ["cash_structuring"], transactionDetails: [{ transactionRef: "TXN001", transactionDate: "2026-07-01", amountInr: 900000, mode: "cash", source: "branch", destination: "loan" }], ...overrides }; }

test("FINnet XML packet uses ARF/TRF/CRF shapes and escapes source data", () => {
  const created = createFiuReport({}, input(), context(), NOW); assert.equal(created.summary.status, "ready");
  const packet = buildFinnetXml(created.report, context(), {}, NOW); assert.equal(packet.summary.status, "ready"); assert.match(packet.packet.xml, /format="TRF"/); assert.match(packet.packet.xml, /Asha &amp; Sharma/); assert.match(packet.packet.xml, /Structuring &amp; unusual cash/);
  const ccr = createFiuReport({}, input({ reportType: "counterfeit_currency", reportReference: "CCR001", suspicionGrounds: null, transactionDetails: [], counterfeitDetails: { denomination: "500", currency: "INR", seizureReference: "SEIZ-1" } }), context(), NOW);
  const ccrPacket = buildFinnetXml(ccr.report, context(), {}, NOW); assert.equal(ccrPacket.summary.status, "ready"); assert.match(ccrPacket.packet.xml, /format="CRF"/);
});

test("FINnet filing separates submission from acknowledgement and repairs rejected reports", () => {
  let result = createFiuReport({}, input(), context(), NOW); result = reviewFiuReport(result.report, { actor: "po", actorRole: "principal_officer", reviewNotes: "confirmed" }, context(), NOW); result = fileFiuReport(result.report, { actor: "po" }, context(), NOW);
  assert.equal(result.report.status, "filed"); const checksum = result.report.finnetPacket.checksumSha256;
  const bad = acknowledgeFiuReport(result.report, { status: "accepted", acknowledgementRef: "ACK1", checksumSha256: "0".repeat(64), receivedBy: "po" }, NOW); assert.equal(bad.summary.status, "blocked");
  result = acknowledgeFiuReport(result.report, { status: "rejected", acknowledgementRef: "ACK2", checksumSha256: checksum, receivedBy: "po", errorCode: "XSD001", errorMessage: "Invalid transaction" }, NOW); assert.equal(result.report.status, "rejected");
  const repaired = repairFiuReport({ [result.report.reportId]: result.report }, result.report.reportId, { reportId: "fiu_2", proposedBy: "maker", approvedBy: "checker", approvalRef: "APR1", sourceCorrectionRef: "CORE-1", correctedReport: { reportReference: "STR002", transactionDetails: [{ transactionRef: "TXN002", transactionDate: "2026-07-02", amountInr: 900000, mode: "cash" }] } }, context(), NOW);
  assert.equal(repaired.summary.status, "ready"); assert.equal(repaired.report.parentReportId, "fiu_1"); assert.equal(repaired.registry.fiu_2.status, "draft");
});

test("FINnet workflow covers STR review, filing, acknowledgement, and repair", () => {
  let result = createFiuReport({}, input(), context(), NOW); let tasks = deriveWorkflowTasks({ fiuReports: { [result.report.reportId]: result.report }, workflowTasks: {} }, { asOf: NOW }); assert(tasks.some((task) => task.type === "fiu.str_review"));
  result = reviewFiuReport(result.report, { actor: "po", actorRole: "principal_officer", reviewNotes: "confirmed" }, context(), NOW); tasks = deriveWorkflowTasks({ fiuReports: { [result.report.reportId]: result.report }, workflowTasks: {} }, { asOf: NOW }); assert(tasks.some((task) => task.type === "fiu.filing"));
  result = fileFiuReport(result.report, { actor: "po" }, context(), NOW); tasks = deriveWorkflowTasks({ fiuReports: { [result.report.reportId]: result.report }, workflowTasks: {} }, { asOf: NOW }); assert(tasks.some((task) => task.type === "fiu.acknowledgement"));
  result = acknowledgeFiuReport(result.report, { status: "rejected", acknowledgementRef: "ACK", checksumSha256: result.report.finnetPacket.checksumSha256, receivedBy: "po", errorCode: "XSD", errorMessage: "Invalid" }, NOW); tasks = deriveWorkflowTasks({ fiuReports: { [result.report.reportId]: result.report }, workflowTasks: {} }, { asOf: NOW }); assert(tasks.some((task) => task.type === "fiu.repair"));
});

test("FINnet API persists XML packet and exact acknowledgement", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-finnet-api-")); const tenant = { tenantId: "tnt_fiu", name: "FIU", apiKey: "fiu-key" }; const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`; const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { "x-api-key": tenant.apiKey, "content-type": "application/json", ...(init.headers ?? {}) } });
  await request("/loan-accounts"); const state = await loadState(dataDir); state.tenants[tenant.tenantId].regulatedEntities = { re_1: { regulatedEntityId: "re_1" } }; state.tenants[tenant.tenantId].borrowerProfiles = context().borrowerProfiles; await saveState(state, dataDir);
  let response = await request("/fiu/reports", { method: "POST", body: JSON.stringify(input()) }); assert.equal(response.status, 201); let body = await response.json();
  response = await request(`/fiu/reports/${body.report.reportId}/review`, { method: "POST", body: JSON.stringify({ actor: "po", actorRole: "principal_officer", reviewNotes: "confirmed" }) }); assert.equal(response.status, 200);
  response = await request(`/fiu/reports/${body.report.reportId}/filing`, { method: "POST", body: JSON.stringify({ actor: "po" }) }); assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text()); body = await response.json(); assert.equal(body.report.status, "filed"); assert.match(body.report.finnetPacket.xml, /FINnetReport/);
  process.env.LOANOS_PROVIDER_CALLBACK_SECRETS = JSON.stringify({ fiu: "callback-secret" });
  t.after(() => { delete process.env.LOANOS_PROVIDER_CALLBACK_SECRETS; });
  const payload = { reportId: body.report.reportId, status: "accepted", acknowledgementRef: "ACK-API", checksumSha256: body.report.finnetPacket.checksumSha256, receivedBy: "po" }; const eventId = "evt_fiu_001"; const signature = createHmac("sha256", "callback-secret").update(`fiu.${eventId}.${JSON.stringify(payload)}`).digest("hex");
  response = await request("/integrations/fiu/callbacks", { method: "POST", headers: { "x-provider-signature": `sha256=${signature}` }, body: JSON.stringify({ eventId, payload }) }); assert.equal(response.status, 202); body = await response.json(); assert.equal(body.callback.reconciled.outcome, "acknowledged");
});
