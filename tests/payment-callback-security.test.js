import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { ExternalServiceManager } from "@loanos/core/integrations/external-services.js";
import { reconcilePaymentRailSettlement } from "@loanos/core/finance/payment-reconciliation.js";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const SECRET = "payment-callback-secret";
const manager = new ExternalServiceManager({ providerCallbackSecrets: { payment_rail: SECRET } });
const payload = { providerRef: "collect-1", providerEventRef: "event-1", status: "settled", amount: 100, currency: "INR", bankReference: "bank-1", settledAt: NOW.toISOString() };
const timestamp = NOW.toISOString();
const sign = (body = payload, time = timestamp) => createHmac("sha256", SECRET).update(`payment_rail.${time}.${body.providerEventRef}.${JSON.stringify(body)}`).digest("hex");

test("payment callbacks require a valid timestamp-bound signature", () => {
  const verified = manager.verifyPaymentSettlementCallback(payload.providerEventRef, payload, `sha256=${sign()}`, timestamp, NOW);
  assert.equal(verified.provider, "payment_rail"); assert.equal(verified.eventId, "event-1");
  assert.throws(() => manager.verifyPaymentSettlementCallback(payload.providerEventRef, payload, "sha256=" + "0".repeat(64), timestamp, NOW), /signature is invalid/);
  assert.throws(() => manager.verifyPaymentSettlementCallback(payload.providerEventRef, payload, sign(), "2026-07-15T11:54:59.000Z", NOW), /replay-protection window/);
});

test("success, failure, return and reversal lifecycle remains fail closed", () => {
  const verification = manager.verifyPaymentSettlementCallback(payload.providerEventRef, payload, sign(), timestamp, NOW);
  const rail = { paymentRailId: "rail-1", providerRef: "collect-1", type: "upi_collect", amount: 100, channel: "upi", loanAccountId: "loan-1", status: "pending" };
  const account = { loanAccountId: "loan-1", status: "active", principalAmount: 100, annualInterestRate: 0, termMonths: 1, disbursedAt: "2026-07-01T00:00:00.000Z", schedule: [{ installmentNumber: 1, dueDate: "2026-08-01", principalDue: 100, interestDue: 0, totalDue: 100 }], ledger: [], paymentAllocationWaterfall: ["interest", "charges", "principal"] };
  const settled = reconcilePaymentRailSettlement({ paymentRails: { "rail-1": rail }, loanAccounts: { "loan-1": account } }, { ...payload, callbackVerification: verification }, NOW);
  assert.equal(settled.reconciliation.outcome, "matched_posted"); assert.ok(settled.reconciliation.callbackFingerprintSha256);
  const failed = reconcilePaymentRailSettlement({ paymentRails: { "rail-2": { ...rail, paymentRailId: "rail-2", providerRef: "collect-2" } }, loanAccounts: { "loan-1": account } }, { providerRef: "collect-2", providerEventRef: "event-failed", status: "failed", amount: 100, failureReason: "insufficient_funds" }, NOW);
  assert.equal(failed.reconciliation.outcome, "matched_not_collected"); assert.equal(failed.paymentRails["rail-2"].status, "failed");
  const returnInput = { providerRef: "collect-1", providerEventRef: "event-return", status: "returned", amount: 100, failureReason: "bank_return", settledAt: "2026-07-15T12:01:00.000Z", callbackVerification: { payloadHash: "evidence" } };
  const returned = reconcilePaymentRailSettlement({ paymentRails: settled.paymentRails, paymentReconciliations: settled.reconciliations, loanAccounts: settled.loanAccounts }, returnInput, new Date("2026-07-15T12:01:00.000Z"));
  assert.equal(returned.reconciliation.outcome, "matched_reversed"); assert.equal(returned.reversalEvent.reversalOfEventId, settled.paymentEvent.eventId);
  const reversed = reconcilePaymentRailSettlement({ paymentRails: { "rail-3": { ...settled.paymentRails["rail-1"], paymentRailId: "rail-3", providerRef: "collect-3" } }, loanAccounts: settled.loanAccounts }, { ...returnInput, providerRef: "collect-3", providerEventRef: "event-reversal", status: "reversed" }, NOW);
  assert.equal(reversed.reconciliation.outcome, "matched_reversed");
});

test("duplicates are idempotent but changed replay, mismatch, and late callbacks are exceptions", () => {
  const rail = { paymentRailId: "rail", providerRef: "collect", type: "upi_collect", amount: 100, channel: "upi", loanAccountId: "missing", status: "pending" };
  const first = reconcilePaymentRailSettlement({ paymentRails: { rail } }, { providerRef: "collect", providerEventRef: "event", status: "failed", amount: 100 }, NOW);
  const duplicate = reconcilePaymentRailSettlement({ paymentRails: first.paymentRails, paymentReconciliations: first.reconciliations }, { providerRef: "collect", providerEventRef: "event", status: "failed", amount: 100 }, NOW);
  assert.equal(duplicate.duplicate, true);
  const replay = reconcilePaymentRailSettlement({ paymentRails: first.paymentRails, paymentReconciliations: first.reconciliations }, { providerRef: "collect", providerEventRef: "event", status: "settled", amount: 100 }, NOW);
  assert.equal(replay.summary.status, "blocked"); assert.equal(replay.replayConflict, true);
  const mismatch = reconcilePaymentRailSettlement({ paymentRails: { rail } }, { providerRef: "collect", providerEventRef: "mismatch", status: "settled", amount: 99 }, NOW);
  assert.equal(mismatch.reconciliation.exceptionCode, "amount_mismatch");
  const late = reconcilePaymentRailSettlement({ paymentRails: { rail } }, { providerRef: "collect", providerEventRef: "late", status: "failed", amount: 100, callbackVerification: { timestamp: "2026-07-15T11:58:00.000Z" } }, NOW);
  assert.equal(late.reconciliation.late, true);
});

test("settlement API rejects unsigned callbacks when payment callback authentication is configured", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-payment-callback-")); const tenant = { tenantId: "tnt_payment_callback", name: "Payment callback", apiKey: "payment-key" };
  process.env.LOANOS_PROVIDER_CALLBACK_SECRETS = JSON.stringify({ payment_rail: SECRET });
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { delete process.env.LOANOS_PROVIDER_CALLBACK_SECRETS; await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}/integrations/payment-rails/settlements`; const headers = { "x-api-key": tenant.apiKey, "content-type": "application/json" };
  let response = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) }); assert.equal(response.status, 401);
  const apiTimestamp = new Date().toISOString();
  response = await fetch(url, { method: "POST", headers: { ...headers, "x-provider-signature": `sha256=${sign(payload, apiTimestamp)}`, "x-provider-timestamp": apiTimestamp }, body: JSON.stringify(payload) });
  assert.equal(response.status, 202); const body = await response.json(); assert.equal(body.reconciliation.exceptionCode, "unmatched_payment_rail"); assert.equal(body.reconciliation.callbackVerification.provider, "payment_rail");
});
