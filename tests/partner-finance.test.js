import test from "node:test";
import assert from "node:assert/strict";
import { approvePartnerFinanceReversal, buildPartnerStatement, createPartnerBankPaymentFile, createPartnerPayableInstruction, openPartnerFinanceDispute, reconcilePartnerPayment, validatePartnerCommissionInvoice } from "@loanos/core/finance/partner-finance.js";

const approval = { proposedBy: "maker", approvedBy: "checker", approvalRef: "APR-1" };
const invoiceInput = { invoiceId: "inv-1", idempotencyKey: "ik-inv-1", partnerId: "p-1", invoiceNumber: "P/1", invoiceDate: "2026-07-15", supplierGstin: "27ABCDE1234F1Z5", recipientGstin: "29ABCDE1234F1Z3", taxableAmountPaise: 10001, gstAmountPaise: 1800, tdsAmountPaise: 1000, gstEvidenceRef: "gst-1", tdsEvidenceRef: "tds-1", tdsSection: "194H", ...approval };

test("invoice validation is paise-exact, evidence-bound, maker-checker and idempotent", () => {
  const first = validatePartnerCommissionInvoice([], invoiceInput);
  assert.equal(first.invoice.netPayablePaise, 10801);
  assert.equal(validatePartnerCommissionInvoice([first.invoice], invoiceInput).idempotent, true);
  assert.equal(validatePartnerCommissionInvoice([], { ...invoiceInput, approvedBy: "maker" }).invoice, null);
  assert.equal(validatePartnerCommissionInvoice([], { ...invoiceInput, gstEvidenceRef: null }).summary.status, "blocked");
  assert.equal(validatePartnerCommissionInvoice([first.invoice], { ...invoiceInput, taxableAmountPaise: 10002 }).invoice, null);
});

test("payable GL balances exactly and bank file fails closed without beneficiary evidence", () => {
  const invoice = validatePartnerCommissionInvoice([], invoiceInput).invoice;
  const payableInput = { payableId: "payable-1", idempotencyKey: "ik-payable-1", expenseAccount: "commission_expense", gstAccount: "input_gst", tdsAccount: "tds_payable", partnerPayableAccount: "partner_payable", ...approval };
  const payable = createPartnerPayableInstruction([], invoice, payableInput).payable;
  assert.equal(payable.debitTotalPaise, 11801); assert.equal(payable.creditTotalPaise, 11801);
  assert.equal(createPartnerPayableInstruction([payable], invoice, payableInput).idempotent, true);
  const fileInput = { paymentFileId: "pf-1", idempotencyKey: "ik-pf-1", debitAccountRef: "bank-1", ...approval };
  assert.equal(createPartnerBankPaymentFile([], [payable], fileInput).paymentFile, null);
  const enriched = { ...payable, beneficiaryAccountRef: "masked-acct", beneficiaryIfsc: "HDFC0000001" };
  const paymentFile = createPartnerBankPaymentFile([], [enriched], fileInput).paymentFile;
  assert.equal(paymentFile.totalAmountPaise, 10801); assert.equal(paymentFile.status, "ready_for_bank");
});

test("reconciliation, statements, disputes, and reversals retain exact paise controls", () => {
  const invoice = validatePartnerCommissionInvoice([], invoiceInput).invoice;
  const payable = { ...createPartnerPayableInstruction([], invoice, { payableId: "payable-1", idempotencyKey: "ik-p", expenseAccount: "expense", gstAccount: "gst", tdsAccount: "tds", partnerPayableAccount: "partner", ...approval }).payable, beneficiaryAccountRef: "acct", beneficiaryIfsc: "IFSC0000001" };
  const paymentFile = createPartnerBankPaymentFile([], [payable], { paymentFileId: "file-1", idempotencyKey: "ik-file", debitAccountRef: "bank", ...approval }).paymentFile;
  const mismatch = reconcilePartnerPayment(paymentFile, { payableId: "payable-1", paymentId: "payment-x", amountPaise: 10800, bankReference: "utr-x", bankEvidenceRef: "bank-x", recordedBy: "ops" }).payment;
  assert.equal(mismatch.reconciliationStatus, "exception");
  const payment = reconcilePartnerPayment(paymentFile, { payableId: "payable-1", paymentId: "payment-1", amountPaise: 10801, bankReference: "utr-1", bankEvidenceRef: "bank-1", recordedBy: "ops" }).payment;
  const statement = buildPartnerStatement("p-1", [invoice], [payment], [], [], { statementId: "stmt-1", from: "2026-07-01", to: "2026-07-31" });
  assert.equal(statement.outstandingPaise, 0);
  assert.equal(openPartnerFinanceDispute([], statement, { disputeId: "d-1", idempotencyKey: "ik-d", reasonCode: "short_pay", disputedAmountPaise: 1, evidenceRef: "e-1", raisedBy: "partner" }).dispute, null);
  const reversalInput = { reversalId: "rev-1", idempotencyKey: "ik-rev", amountPaise: 1, reason: "duplicate", evidenceRef: "e-2", ...approval };
  const reversal = approvePartnerFinanceReversal([], payment, reversalInput).reversal;
  assert.equal(reversal.glInstruction[0].amountPaise, 1);
  assert.equal(approvePartnerFinanceReversal([reversal], payment, reversalInput).idempotent, true);
  assert.equal(approvePartnerFinanceReversal([], payment, { ...reversalInput, approvedBy: "maker" }).reversal, null);
});
