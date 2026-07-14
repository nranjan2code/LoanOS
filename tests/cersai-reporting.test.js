import test from "node:test";
import assert from "node:assert/strict";
import {
  SECURITY_INTEREST_STATUSES,
  acknowledgeCersaiSubmission,
  buildCersaiSubmission,
  createSecurityInterest,
  fileSecurityInterest,
  repairCersaiSecurityInterest
} from "../packages/core/src/index.js";

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
