import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildCkycrrPacket, createCkycrrSubmission, deriveWorkflowTasks, recordCkycrrResponse,
  resolveCkycrrProbableMatch, submitCkycrrSubmission, validateCkycrrDownload
} from "@loanos/core";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { loadState, saveState } from "../apps/api/src/file-store.js";

const NOW = new Date("2026-07-14T10:00:00.000Z");
const CHECKSUM = "a".repeat(64);
const PHOTO = { documentType: "photograph", fileName: "photo.jpg", mediaType: "image/jpeg", sizeBytes: 50000, dpi: 200, checksumSha256: CHECKSUM, widthPixels: 200, heightPixels: 230, colour: true };
const PAN = { documentType: "proof_of_identity", fileName: "pan.pdf", mediaType: "application/pdf", sizeBytes: 80000, dpi: 150, checksumSha256: "b".repeat(64) };

function borrower(overrides = {}) {
  return { borrowerId: "bor_1", borrowerType: "individual", fullName: "Asha Sharma", dateOfBirth: "1990-01-01", primaryAddress: "10 MG Road", contact: { mobile: "+919999999999", email: "asha@example.in" }, economicProfile: { occupation: "salaried", monthlyIncome: 50000 }, creditReporting: { gender: "F", identity: { type: "pan", number: "ABCDE1234F" }, address: { line1: "10 MG Road", city: "Mumbai", stateCode: "27", pinCode: "400001" } }, ...overrides };
}
function kyc(overrides = {}) { return { kycRecordId: "kyc_1", borrowerId: "bor_1", status: "verified", method: "manual", verifiedAt: NOW.toISOString(), ...overrides }; }
function createInput(overrides = {}) { return { submissionId: "sub_1", borrowerId: "bor_1", kycRecordId: "kyc_1", operation: "new", institutionCode: "INST01", branchCode: "BR001", documents: [PHOTO, PAN], proposedBy: "maker", approvedBy: "checker", approvalRef: "APR-1", ...overrides }; }

test("CKYCRR packet validates official individual and legal-entity template essentials", () => {
  let result = buildCkycrrPacket(borrower(), kyc(), createInput(), NOW);
  assert.equal(result.summary.status, "ready"); assert.equal(result.packet.customerType, "individual"); assert.match(result.packet.checksumSha256, /^[a-f0-9]{64}$/);
  result = buildCkycrrPacket(borrower(), kyc(), createInput({ documents: [PAN] }), NOW);
  assert.equal(result.summary.status, "blocked"); assert(result.findings.some((item) => item.message.includes("photograph")));
  result = buildCkycrrPacket(borrower(), kyc(), createInput({ operation: "update" }), NOW);
  assert.equal(result.summary.status, "blocked"); assert(result.findings.some((item) => item.path === "ckycIdentifier"));

  const company = borrower({ borrowerType: "company", fullName: null, legalName: "Acme Private Limited", dateOfBirth: null, creditReporting: { legalConstitution: "private_limited", dateOfIncorporation: "2020-01-01", identity: { pan: "AACCA1234A", cin: "U12345MH2020PTC123456" }, address: { line1: "1 BKC", stateCode: "27", pinCode: "400051" }, relatedParties: [] } });
  result = buildCkycrrPacket(company, kyc(), createInput({ documents: [PAN] }), NOW);
  assert.equal(result.summary.status, "ready"); assert.equal(result.packet.customerType, "legal_entity"); assert.equal(result.packet.record.identity.pan, "AACCA1234A");
});

test("CKYCRR submission, provider response, and probable-match reconciliation fail closed", () => {
  let result = createCkycrrSubmission({}, { borrowerProfiles: { bor_1: borrower() }, kycRecords: { kyc_1: kyc() } }, createInput(), NOW);
  assert.equal(result.submission.status, "ready"); let registry = result.registry;
  result = submitCkycrrSubmission(registry, "sub_1", { transmittedBy: "ops", transport: "sftp", transportRef: "SFTP-1", digitalSignatureRef: "DSC-1", fileName: "INST01_20260714.zip", fileSizeBytes: 200000 }, NOW);
  assert.equal(result.submission.status, "submitted"); registry = result.registry;
  const invented = recordCkycrrResponse(registry, "sub_1", { outcome: "accepted", ckycIdentifier: "123", responseRef: "RESP-1", receivedBy: "ops" }, NOW);
  assert.equal(invented.summary.status, "blocked");
  result = recordCkycrrResponse(registry, "sub_1", { outcome: "probable_match", responseRef: "RESP-2", receivedBy: "ops", matches: [{ ckycIdentifier: "12345678901234", name: "Asha Sharma" }] }, NOW);
  assert.equal(result.submission.reconciliationDueDate, "2026-07-21"); registry = result.registry;
  result = resolveCkycrrProbableMatch(registry, "sub_1", { decision: "exact_match", ckycIdentifier: "12345678901234", reason: "PAN and DOB matched", reviewedBy: "reviewer", approvedBy: "checker", customerNotification: { channel: "sms", deliveryRef: "SMS-MATCH", deliveredAt: "2026-07-18T10:00:00.000Z" } }, new Date("2026-07-18T10:00:00.000Z"));
  assert.equal(result.submission.status, "accepted"); assert.equal(result.submission.ckycIdentifier, "12345678901234");

  let expired = createCkycrrSubmission({}, { borrowerProfiles: { bor_1: borrower() }, kycRecords: { kyc_1: kyc() } }, createInput(), NOW);
  expired = submitCkycrrSubmission(expired.registry, "sub_1", { transmittedBy: "ops", transport: "sftp", transportRef: "SFTP-X", digitalSignatureRef: "DSC-X", fileName: "record.zip", fileSizeBytes: 100000 }, NOW);
  expired = recordCkycrrResponse(expired.registry, "sub_1", { outcome: "probable_match", responseRef: "RESP-X", receivedBy: "ops", matches: [{ ckycIdentifier: "12345678901234" }] }, NOW);
  expired = resolveCkycrrProbableMatch(expired.registry, "sub_1", { decision: "no_match", reason: "No identity match", reviewedBy: "reviewer", approvedBy: "checker" }, new Date("2026-07-22T10:00:00.000Z"));
  assert.equal(expired.submission.status, "withdrawn");
});

test("CKYCRR accepted response requires customer notification and assigns the provider identifier", () => {
  let result = createCkycrrSubmission({}, { borrowerProfiles: { bor_1: borrower() }, kycRecords: { kyc_1: kyc() } }, createInput(), NOW);
  result = submitCkycrrSubmission(result.registry, "sub_1", { transmittedBy: "ops", transport: "portal", transportRef: "PORTAL-1", digitalSignatureRef: "DSC-1", fileName: "record.zip", fileSizeBytes: 100000 }, NOW);
  const missingNotice = recordCkycrrResponse(result.registry, "sub_1", { outcome: "accepted", ckycIdentifier: "12345678901234", responseRef: "RESP-1", receivedBy: "ops" }, NOW);
  assert.equal(missingNotice.summary.status, "blocked");
  result = recordCkycrrResponse(result.registry, "sub_1", { outcome: "accepted", ckycIdentifier: "12345678901234", responseRef: "RESP-1", receivedBy: "ops", customerNotification: { channel: "sms", deliveryRef: "SMS-1", deliveredAt: NOW.toISOString() } }, NOW);
  assert.equal(result.submission.status, "accepted"); assert.equal(result.submission.customerNotification.deliveryRef, "SMS-1");
});

test("CKYCRR download requires explicit active consent and authentication evidence", () => {
  const input = { borrowerId: "bor_1", ckycIdentifier: "12345678901234", consentId: "consent_1", authenticationFactor: { type: "date_of_birth", evidenceRef: "DOB-MATCH-1" }, downloadRef: "DL-1", downloadedBy: "kyc_ops" };
  assert.equal(validateCkycrrDownload(input, {}).summary.status, "blocked");
  const result = validateCkycrrDownload(input, { consent_1: { consentId: "consent_1", borrowerId: "bor_1", purpose: "ckyc", status: "granted" } });
  assert.equal(result.summary.status, "ready");
});

test("CKYCRR workflow exposes ready, rejected, and probable-match work", () => {
  let result = createCkycrrSubmission({}, { borrowerProfiles: { bor_1: borrower() }, kycRecords: { kyc_1: kyc() } }, createInput(), NOW);
  let tasks = deriveWorkflowTasks({ ckycrrSubmissions: result.registry, workflowTasks: {} }, { asOf: NOW });
  assert(tasks.some((task) => task.type === "ckycrr.submission"));
  result = submitCkycrrSubmission(result.registry, "sub_1", { transmittedBy: "ops", transport: "sftp", transportRef: "SFTP-1", digitalSignatureRef: "DSC-1", fileName: "record.zip", fileSizeBytes: 100000 }, NOW);
  result = recordCkycrrResponse(result.registry, "sub_1", { outcome: "rejected", responseRef: "RESP-1", receivedBy: "ops", errorCode: "E100", errorMessage: "Invalid document" }, NOW);
  tasks = deriveWorkflowTasks({ ckycrrSubmissions: result.registry, workflowTasks: {} }, { asOf: NOW });
  assert(tasks.some((task) => task.type === "ckycrr.response_repair"));
});

test("CKYCRR API persists governed lifecycle and assigns identifier only after accepted response", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-ckycrr-api-")); const tenant = { tenantId: "tnt_ckyc", name: "CKYC Test", apiKey: "ckyc-test-key" };
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`; const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { "x-api-key": tenant.apiKey, "content-type": "application/json", ...(init.headers ?? {}) } });
  await request("/loan-accounts"); const state = await loadState(dataDir); state.tenants[tenant.tenantId].borrowerProfiles = { bor_1: borrower() }; state.tenants[tenant.tenantId].kycRecords = { kyc_1: kyc() }; await saveState(state, dataDir);

  let response = await request("/reporting/ckycrr/submissions", { method: "POST", body: JSON.stringify(createInput({ submissionId: "api_sub" })) });
  assert.equal(response.status, 201, response.status === 201 ? undefined : await response.text()); let body = await response.json(); assert.equal(body.submission.status, "ready");
  response = await request("/reporting/ckycrr/submissions/api_sub/submit", { method: "POST", body: JSON.stringify({ transmittedBy: "ops", transport: "sftp", transportRef: "SFTP-API", digitalSignatureRef: "DSC-API", fileName: "packet.zip", fileSizeBytes: 200000 }) });
  assert.equal(response.status, 200); body = await response.json(); assert.equal(body.submission.status, "submitted"); assert.equal(body.kycRecord.ckycRef, undefined);
  response = await request("/reporting/ckycrr/submissions/api_sub/response", { method: "POST", body: JSON.stringify({ outcome: "accepted", ckycIdentifier: "12345678901234", responseRef: "RESP-API", receivedBy: "ops", customerNotification: { channel: "email", deliveryRef: "EMAIL-API", deliveredAt: NOW.toISOString() } }) });
  assert.equal(response.status, 200); body = await response.json(); assert.equal(body.kycRecord.ckycRef, "12345678901234");
  response = await request("/workflow/tasks?type=ckycrr.submission"); assert.equal((await response.json()).tasks.length, 0);
  const persisted = await loadState(dataDir); assert.equal(persisted.tenants[tenant.tenantId].kycRecords.kyc_1.ckycRef, "12345678901234"); assert(persisted.tenants[tenant.tenantId].events.some((event) => event.type === "ckycrr.submission.accepted"));
});
