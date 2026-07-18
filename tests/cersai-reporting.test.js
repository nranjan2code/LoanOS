import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SECURITY_INTEREST_STATUSES,
  acknowledgeCersaiSubmission,
  buildCersaiSubmission,
  createSecurityInterest,
  fileSecurityInterest,
  repairCersaiSecurityInterest
} from "@loanos/core";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { loadState, saveState } from "../apps/api/src/file-store.js";

const context = {
  loanAccounts: { la_1: { loanAccountId: "la_1", status: "active" } },
  borrowerProfiles: { borrower_1: { fullName: "Asha Shah", identity: { type: "PAN", value: "ABCDE1234F" }, address: { line1: "4 MG Road", pincode: "560001" } } }
};
const packetInput = {
  creditor: { legalName: "Example Bank Limited", registrationCode: "RE-001", registeredAddress: "1 Bank Street, Mumbai" },
  asset: { assetIdentifier: "KA-01-AB-1234", location: "Bengaluru", state: "Karnataka", pincode: "560001" },
  chargeCreatedAt: "2026-07-14", authorisedBy: "security-maker-1", authorisationRef: "AUTH-001"
};

test("CERSAI packet is canonical and a response is checksum-bound", () => {
  const created = createSecurityInterest({}, { securityInterestId: "si_1", loanAccountId: "la_1", borrowerId: "borrower_1", assetType: "movable", assetDescription: "Vehicle", chargeType: "hypothecation", chargeAmountInr: 500000, createdBy: "security-maker-1" }, context, new Date("2026-07-14T00:00:00.000Z"));
  const packet = buildCersaiSubmission(created.securityInterest, context, packetInput, new Date("2026-07-14T00:00:00.000Z"));
  assert.equal(packet.summary.status, "ready");
  assert.equal(packet.packet.checksumSha256.length, 64);
  const filed = fileSecurityInterest(created.securityInterest, { actor: "security-maker-1", ...packetInput }, context, new Date("2026-07-14T00:00:00.000Z"));
  const badResponse = acknowledgeCersaiSubmission(filed.securityInterest, { outcome: "registered", responseRef: "RESP-001", receivedBy: "security-checker-1", checksumSha256: "0".repeat(64), cersaiRegistrationNumber: "REG-001", payment: { receiptRef: "PAY-001", amountInr: 100, paidAt: "2026-07-14T00:00:00.000Z" }, certificate: { certificateRef: "CERT-001", checksumSha256: "a".repeat(64) } });
  assert.equal(badResponse.summary.status, "blocked");
  const accepted = acknowledgeCersaiSubmission(filed.securityInterest, { outcome: "registered", responseRef: "RESP-001", receivedBy: "security-checker-1", checksumSha256: filed.securityInterest.cersaiSubmission.checksumSha256, cersaiRegistrationNumber: "REG-001", payment: { receiptRef: "PAY-001", amountInr: 100, paidAt: "2026-07-14T00:00:00.000Z" }, certificate: { certificateRef: "CERT-001", checksumSha256: "a".repeat(64) } });
  assert.equal(accepted.securityInterest.status, SECURITY_INTEREST_STATUSES.REGISTERED);
});

test("CERSAI rejected packet requires independently approved replacement", () => {
  const created = createSecurityInterest({}, { securityInterestId: "si_reject", loanAccountId: "la_1", borrowerId: "borrower_1", assetType: "movable", assetDescription: "Vehicle", chargeType: "hypothecation", chargeAmountInr: 500000, createdBy: "security-maker-1" }, context);
  const filed = fileSecurityInterest(created.securityInterest, { actor: "security-maker-1", ...packetInput }, context);
  const rejected = acknowledgeCersaiSubmission(filed.securityInterest, { outcome: "rejected", responseRef: "RESP-REJECT", receivedBy: "security-checker-1", checksumSha256: filed.securityInterest.cersaiSubmission.checksumSha256, payment: { receiptRef: "PAY-002", amountInr: 0, paidAt: "2026-07-14T00:00:00.000Z" }, errorCode: "ASSET_ID", errorMessage: "Asset identifier invalid" });
  assert.equal(rejected.securityInterest.status, SECURITY_INTEREST_STATUSES.REJECTED);
  const repaired = repairCersaiSecurityInterest({ si_reject: rejected.securityInterest }, "si_reject", { proposedBy: "security-maker-1", approvedBy: "security-checker-1", approvalRef: "APR-001", sourceCorrectionRef: "SRC-001", correctedSecurityInterest: { assetDetails: { assetIdentifier: "KA-01-AB-1234", location: "Bengaluru", state: "Karnataka", pincode: "560001" } } }, context);
  assert.equal(repaired.summary.status, "ready");
  assert.equal(repaired.securityInterest.parentSecurityInterestId, "si_reject");
});

test("CERSAI API reconciles a signed registered callback with payment and certificate evidence", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-cersai-callback-")); const tenant = { tenantId: "tnt_cersai", name: "CERSAI", apiKey: "cersai-key" }; const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); delete process.env.LOANOS_PROVIDER_CALLBACK_SECRETS; });
  const base = `http://127.0.0.1:${server.address().port}`; const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { "x-api-key": tenant.apiKey, "content-type": "application/json", ...(init.headers ?? {}) } });
  await request("/loan-accounts"); const state = await loadState(dataDir); state.tenants[tenant.tenantId].loanAccounts = { la_1: { loanAccountId: "la_1", status: "active" } }; await saveState(state, dataDir);
  let response = await request("/loan-accounts/la_1/security-interests", { method: "POST", body: JSON.stringify({ securityInterestId: "si_api", borrowerId: "borrower_1", assetType: "movable", assetDescription: "Vehicle", chargeType: "hypothecation", chargeAmountInr: 500000, createdBy: "security-maker-1" }) }); assert.equal(response.status, 201);
  response = await request("/loan-accounts/la_1/security-interests/si_api/filing", { method: "POST", body: JSON.stringify({ actor: "security-maker-1", ...packetInput, debtor: context.borrowerProfiles.borrower_1 }) }); assert.equal(response.status, 200); const filed = (await response.json()).securityInterest;
  process.env.LOANOS_PROVIDER_CALLBACK_SECRETS = JSON.stringify({ cersai: "callback-secret" }); const payload = { securityInterestId: "si_api", outcome: "registered", responseRef: "RESP-API", receivedBy: "security-officer", checksumSha256: filed.cersaiSubmission.checksumSha256, cersaiRegistrationNumber: "REG-API", payment: { receiptRef: "PAY-API", amountInr: 100, paidAt: "2026-07-14T00:00:00.000Z" }, certificate: { certificateRef: "CERT-API", checksumSha256: "d".repeat(64) } }; const eventId = "evt_cersai_001"; const signature = createHmac("sha256", "callback-secret").update(`cersai.${eventId}.${JSON.stringify(payload)}`).digest("hex");
  response = await request("/integrations/cersai/callbacks", { method: "POST", headers: { "x-provider-signature": `sha256=${signature}` }, body: JSON.stringify({ eventId, payload }) }); assert.equal(response.status, 202); assert.equal((await response.json()).callback.reconciled.outcome, "registered");
});
