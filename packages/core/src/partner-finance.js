import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const error = (message, field) => createFinding("error", "RBI-IT-GRC", message, field);
const blocked = (findings, extra = {}) => ({ ...extra, findings, summary: summarizeFindings(findings) });
const validPaise = (value, allowZero = false) => Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
const independent = (input, maker = "proposedBy", checker = "approvedBy") => input?.[maker] && input?.[checker] && input[maker] !== input[checker] && input.approvalRef;
const same = (record, immutable) => record?.checksumSha256 === hash(immutable);
const gstin = (value) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(value ?? ""));

export function validatePartnerCommissionInvoice(existing = [], input, now = new Date()) {
  const findings = [];
  const required = ["invoiceId", "idempotencyKey", "partnerId", "invoiceNumber", "invoiceDate", "gstEvidenceRef", "tdsEvidenceRef", "tdsSection"];
  if (required.some((field) => !input?.[field])) findings.push(error("Complete invoice, GST, TDS, and idempotency evidence is required.", "invoice"));
  if (!gstin(input?.supplierGstin) || !gstin(input?.recipientGstin)) findings.push(error("Valid supplier and recipient GSTIN evidence is required.", "gstin"));
  if (![input?.taxableAmountPaise, input?.gstAmountPaise, input?.tdsAmountPaise].every((v) => validPaise(v, true)) || !validPaise(input?.taxableAmountPaise)) findings.push(error("Invoice values must be non-negative exact paise integers.", "amounts"));
  if (!independent(input)) findings.push(error("Independent maker-checker approval is required.", "approval"));
  const grossAmountPaise = (input?.taxableAmountPaise ?? 0) + (input?.gstAmountPaise ?? 0);
  const netPayablePaise = grossAmountPaise - (input?.tdsAmountPaise ?? 0);
  if (!validPaise(netPayablePaise)) findings.push(error("TDS cannot reduce the invoice to a non-positive payable.", "tdsAmountPaise"));
  const immutable = { invoiceId: input?.invoiceId, idempotencyKey: input?.idempotencyKey, partnerId: input?.partnerId, invoiceNumber: input?.invoiceNumber, invoiceDate: input?.invoiceDate, supplierGstin: input?.supplierGstin, recipientGstin: input?.recipientGstin, taxableAmountPaise: input?.taxableAmountPaise, gstAmountPaise: input?.gstAmountPaise, tdsAmountPaise: input?.tdsAmountPaise, grossAmountPaise, netPayablePaise, gstEvidenceRef: input?.gstEvidenceRef, tdsEvidenceRef: input?.tdsEvidenceRef, tdsSection: input?.tdsSection, proposedBy: input?.proposedBy, approvedBy: input?.approvedBy, approvalRef: input?.approvalRef };
  const prior = existing.find((record) => record.idempotencyKey === input?.idempotencyKey || record.invoiceId === input?.invoiceId);
  if (prior) return same(prior, immutable) ? { invoice: prior, idempotent: true, findings: [], summary: summarizeFindings([]) } : blocked([error("Idempotency key or invoice identifier was reused with different content.", "idempotencyKey")], { invoice: null });
  if (findings.length) return blocked(findings, { invoice: null });
  const checksumSha256 = hash(immutable);
  return { invoice: { ...immutable, checksumSha256, status: "approved", approvedAt: now.toISOString() }, idempotent: false, findings, summary: summarizeFindings(findings) };
}

export function createPartnerPayableInstruction(existing = [], invoice, input, now = new Date()) {
  const findings = [];
  if (invoice?.status !== "approved" || !invoice?.checksumSha256) findings.push(error("A checksum-bound approved invoice is required.", "invoice"));
  if (!input?.payableId || !input?.idempotencyKey || !input?.expenseAccount || !input?.gstAccount || !input?.tdsAccount || !input?.partnerPayableAccount) findings.push(error("Complete payable and GL account instruction is required.", "payable"));
  if (!independent(input)) findings.push(error("Independent payable approval is required.", "approval"));
  const immutable = { payableId: input?.payableId, idempotencyKey: input?.idempotencyKey, invoiceId: invoice?.invoiceId, partnerId: invoice?.partnerId, currency: "INR", amountPaise: invoice?.netPayablePaise, lines: [{ account: input?.expenseAccount, side: "debit", amountPaise: invoice?.taxableAmountPaise }, ...(invoice?.gstAmountPaise ? [{ account: input?.gstAccount, side: "debit", amountPaise: invoice.gstAmountPaise }] : []), { account: input?.partnerPayableAccount, side: "credit", amountPaise: invoice?.netPayablePaise }, ...(invoice?.tdsAmountPaise ? [{ account: input?.tdsAccount, side: "credit", amountPaise: invoice.tdsAmountPaise }] : [])], proposedBy: input?.proposedBy, approvedBy: input?.approvedBy, approvalRef: input?.approvalRef };
  const prior = existing.find((record) => record.idempotencyKey === input?.idempotencyKey || record.payableId === input?.payableId);
  if (prior) return same(prior, immutable) ? { payable: prior, idempotent: true, findings: [], summary: summarizeFindings([]) } : blocked([error("Payable idempotency conflict.", "idempotencyKey")], { payable: null });
  if (findings.length) return blocked(findings, { payable: null });
  const debits = immutable.lines.filter((l) => l.side === "debit").reduce((n, l) => n + l.amountPaise, 0); const credits = immutable.lines.filter((l) => l.side === "credit").reduce((n, l) => n + l.amountPaise, 0);
  if (debits !== credits) return blocked([error("GL instruction is not exactly balanced in paise.", "lines")], { payable: null });
  return { payable: { ...immutable, debitTotalPaise: debits, creditTotalPaise: credits, checksumSha256: hash(immutable), status: "approved_for_payment", approvedAt: now.toISOString() }, idempotent: false, findings, summary: summarizeFindings(findings) };
}

export function createPartnerBankPaymentFile(existing = [], payables, input, now = new Date()) {
  const findings = [];
  if (!input?.paymentFileId || !input?.idempotencyKey || !input?.debitAccountRef || !independent(input)) findings.push(error("Payment file identity, debit account, and independent approval are required.", "paymentFile"));
  if (!Array.isArray(payables) || !payables.length || payables.some((p) => p.status !== "approved_for_payment" || !p.checksumSha256 || !p.beneficiaryAccountRef || !p.beneficiaryIfsc)) findings.push(error("Every payment requires an approved payable and complete beneficiary evidence.", "payables"));
  const immutable = { paymentFileId: input?.paymentFileId, idempotencyKey: input?.idempotencyKey, debitAccountRef: input?.debitAccountRef, payments: (payables ?? []).map((p) => ({ payableId: p.payableId, partnerId: p.partnerId, amountPaise: p.amountPaise, beneficiaryAccountRef: p.beneficiaryAccountRef, beneficiaryIfsc: p.beneficiaryIfsc })), totalAmountPaise: (payables ?? []).reduce((n, p) => n + (p.amountPaise ?? 0), 0), proposedBy: input?.proposedBy, approvedBy: input?.approvedBy, approvalRef: input?.approvalRef };
  const prior = existing.find((r) => r.idempotencyKey === input?.idempotencyKey || r.paymentFileId === input?.paymentFileId);
  if (prior) return same(prior, immutable) ? { paymentFile: prior, idempotent: true, findings: [], summary: summarizeFindings([]) } : blocked([error("Payment-file idempotency conflict.", "idempotencyKey")], { paymentFile: null });
  if (findings.length) return blocked(findings, { paymentFile: null });
  return { paymentFile: { ...immutable, checksumSha256: hash(immutable), status: "ready_for_bank", createdAt: now.toISOString() }, idempotent: false, findings, summary: summarizeFindings(findings) };
}

export function buildPartnerStatement(partnerId, invoices = [], payments = [], disputes = [], reversals = [], input = {}) {
  if (!partnerId || !input.statementId || !input.from || !input.to || input.from > input.to) throw new Error("Partner, statement, and valid period are required.");
  const relevant = (row) => row.partnerId === partnerId;
  const invoiceRows = invoices.filter(relevant); const paymentRows = payments.filter(relevant); const disputeRows = disputes.filter(relevant); const reversalRows = reversals.filter(relevant);
  const invoicedPaise = invoiceRows.reduce((n, r) => n + r.netPayablePaise, 0); const paidPaise = paymentRows.filter((r) => r.reconciliationStatus === "matched").reduce((n, r) => n + r.amountPaise, 0); const reversedPaise = reversalRows.filter((r) => r.status === "approved").reduce((n, r) => n + r.amountPaise, 0);
  const body = { statementId: input.statementId, partnerId, from: input.from, to: input.to, invoicedPaise, paidPaise, reversedPaise, outstandingPaise: invoicedPaise - paidPaise + reversedPaise, invoices: invoiceRows, payments: paymentRows, disputes: disputeRows, reversals: reversalRows };
  return { ...body, checksumSha256: hash(body) };
}

export function openPartnerFinanceDispute(existing = [], statement, input, now = new Date()) {
  const findings = [];
  if (!statement?.checksumSha256 || !input?.disputeId || !input?.idempotencyKey || !input?.reasonCode || !input?.evidenceRef || !input?.raisedBy) findings.push(error("Checksum-bound statement, reason, owner, and evidence are required.", "dispute"));
  const immutable = { disputeId: input?.disputeId, idempotencyKey: input?.idempotencyKey, statementId: statement?.statementId, partnerId: statement?.partnerId, reasonCode: input?.reasonCode, disputedAmountPaise: input?.disputedAmountPaise, evidenceRef: input?.evidenceRef, raisedBy: input?.raisedBy };
  if (!validPaise(input?.disputedAmountPaise) || input.disputedAmountPaise > statement?.outstandingPaise) findings.push(error("Disputed amount must be positive exact paise within statement outstanding.", "disputedAmountPaise"));
  const prior = existing.find((r) => r.idempotencyKey === input?.idempotencyKey || r.disputeId === input?.disputeId);
  if (prior) return same(prior, immutable) ? { dispute: prior, idempotent: true, findings: [], summary: summarizeFindings([]) } : blocked([error("Dispute idempotency conflict.", "idempotencyKey")], { dispute: null });
  if (findings.length) return blocked(findings, { dispute: null });
  return { dispute: { ...immutable, checksumSha256: hash(immutable), status: "open", openedAt: now.toISOString() }, idempotent: false, findings, summary: summarizeFindings(findings) };
}

export function approvePartnerFinanceReversal(existing = [], payment, input, now = new Date()) {
  const findings = [];
  if (payment?.reconciliationStatus !== "matched" || !input?.reversalId || !input?.idempotencyKey || !input?.reason || !input?.evidenceRef) findings.push(error("A matched payment and complete reversal evidence are required.", "reversal"));
  if (!validPaise(input?.amountPaise) || input?.amountPaise > payment?.amountPaise) findings.push(error("Reversal must be positive exact paise within the matched payment.", "amountPaise"));
  if (!independent(input)) findings.push(error("Independent reversal approval is required.", "approval"));
  const immutable = { reversalId: input?.reversalId, idempotencyKey: input?.idempotencyKey, paymentId: payment?.paymentId, partnerId: payment?.partnerId, amountPaise: input?.amountPaise, reason: input?.reason, evidenceRef: input?.evidenceRef, proposedBy: input?.proposedBy, approvedBy: input?.approvedBy, approvalRef: input?.approvalRef };
  const prior = existing.find((r) => r.idempotencyKey === input?.idempotencyKey || r.reversalId === input?.reversalId);
  if (prior) return same(prior, immutable) ? { reversal: prior, idempotent: true, findings: [], summary: summarizeFindings([]) } : blocked([error("Reversal idempotency conflict.", "idempotencyKey")], { reversal: null });
  if (findings.length) return blocked(findings, { reversal: null });
  return { reversal: { ...immutable, checksumSha256: hash(immutable), status: "approved", approvedAt: now.toISOString(), glInstruction: [{ account: "partner_payable", side: "debit", amountPaise: input.amountPaise }, { account: "bank_recovery_receivable", side: "credit", amountPaise: input.amountPaise }] }, idempotent: false, findings, summary: summarizeFindings(findings) };
}

export function reconcilePartnerPayment(paymentFile, input, now = new Date()) {
  const expected = paymentFile?.payments?.find((p) => p.payableId === input?.payableId);
  if (!expected || !input?.paymentId || !input?.bankReference || !input?.bankEvidenceRef || !validPaise(input?.amountPaise) || !input?.recordedBy) return blocked([error("Payment reconciliation requires an expected payment and complete bank evidence.", "payment")], { payment: null });
  const matched = input.amountPaise === expected.amountPaise;
  const payment = { paymentId: input.paymentId, paymentFileId: paymentFile.paymentFileId, payableId: expected.payableId, partnerId: expected.partnerId, expectedAmountPaise: expected.amountPaise, amountPaise: input.amountPaise, differencePaise: input.amountPaise - expected.amountPaise, bankReference: input.bankReference, bankEvidenceRef: input.bankEvidenceRef, recordedBy: input.recordedBy, reconciliationStatus: matched ? "matched" : "exception", reconciledAt: now.toISOString() };
  return { payment, findings: matched ? [] : [createFinding("warning", "RBI-IT-GRC", "Bank amount does not exactly match the approved payment instruction.", "amountPaise")], summary: summarizeFindings([]) };
}
