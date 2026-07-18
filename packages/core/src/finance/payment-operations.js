import { createFinding, summarizeFindings } from "../compliance/compliance-controls.js";
import { createLoanId } from "../lending/loan-policy.js";
import { postPaymentToLoanAccount } from "../lending/loan-account.js";

const REASON_CODES = new Set(["unidentified", "advance", "excess", "provider_mismatch", "bank_unmatched"]);
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const hasPaisePrecision = (value) => Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
const validDate = (value) => !Number.isNaN(new Date(value).getTime());
const validValueDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export function createSuspenseReceipt(state, input, now = new Date()) {
  const findings = [];
  if (!input?.transactionRef) findings.push(createFinding("error", "RBI-IT-GRC", "transactionRef is required.", "transactionRef"));
  if (!hasPaisePrecision(input?.amount) || input.amount <= 0) findings.push(createFinding("error", "RBI-IT-GRC", "Suspense amount must be positive and exact to two decimal places.", "amount"));
  if (!REASON_CODES.has(input?.reasonCode)) findings.push(createFinding("error", "RBI-IT-GRC", "A supported suspense reasonCode is required.", "reasonCode"));
  if (Object.values(state.paymentSuspenseReceipts ?? {}).some((record) => record.transactionRef === input?.transactionRef)) findings.push(createFinding("error", "RBI-IT-GRC", "transactionRef already exists.", "transactionRef"));
  if (input?.receivedAt && !validDate(input.receivedAt)) findings.push(createFinding("error", "RBI-IT-GRC", "receivedAt must be a valid date.", "receivedAt"));
  if (input?.valueDate && !validValueDate(input.valueDate)) findings.push(createFinding("error", "RBI-IT-GRC", "valueDate must be a valid YYYY-MM-DD date.", "valueDate"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { receipt: null, findings, summary };
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : now; const valueDate = input.valueDate ?? receivedAt.toISOString().slice(0, 10);
  const receipt = { suspenseId: input.suspenseId ?? createLoanId("suspense"), transactionRef: input.transactionRef, amount: money(input.amount), remainingAmount: money(input.amount), currency: "INR", reasonCode: input.reasonCode, receivedAt: receivedAt.toISOString(), valueDate, source: input.source ?? "bank_statement", status: "open", resolutions: [], createdBy: input.createdBy ?? "system" };
  return { receipt, findings, summary };
}

export function resolveSuspenseReceipt(state, receipt, input, now = new Date()) {
  const findings = []; const account = state.loanAccounts?.[input?.loanAccountId];
  if (!receipt || !["open", "partially_resolved"].includes(receipt.status)) findings.push(createFinding("error", "RBI-IT-GRC", "Only open suspense can be resolved.", "status"));
  if (!account) findings.push(createFinding("error", "RBI-IT-GRC", "Target loan account is required.", "loanAccountId"));
  if (!hasPaisePrecision(input?.amount) || input.amount <= 0 || input.amount > (receipt?.remainingAmount ?? 0)) findings.push(createFinding("error", "RBI-IT-GRC", "Resolution amount must be positive, exact to two decimals, and within remaining suspense.", "amount"));
  if (!input?.resolutionId || !input?.proposedBy || !input?.approvedBy || input.proposedBy === input.approvedBy || !input?.approvalRef || !input?.reason) findings.push(createFinding("error", "RBI-IT-GRC", "Resolution ID, reason, and independent approval are required.", "approval"));
  if (input?.valueDate && !validValueDate(input.valueDate)) findings.push(createFinding("error", "RBI-IT-GRC", "valueDate must be a valid YYYY-MM-DD date.", "valueDate"));
  let summary = summarizeFindings(findings); if (summary.status === "blocked") return { receipt, loanAccounts: state.loanAccounts, paymentEvent: null, findings, summary };
  const valueDate = input.valueDate ?? receipt.valueDate;
  const payment = postPaymentToLoanAccount(account, { amount: input.amount, receivedAt: `${valueDate}T00:00:00.000Z`, paymentRef: `suspense:${receipt.transactionRef}:${input.resolutionId}`, channel: "suspense_resolution", actor: input.approvedBy }, now);
  if (payment.summary.status === "blocked") return { receipt, loanAccounts: state.loanAccounts, paymentEvent: null, findings: payment.findings, summary: payment.summary };
  const remainingAmount = money(receipt.remainingAmount - input.amount); const resolution = { resolutionId: input.resolutionId, loanAccountId: input.loanAccountId, amount: money(input.amount), valueDate, paymentEventId: payment.paymentEvent.eventId, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, reason: input.reason, resolvedAt: now.toISOString() };
  const updated = { ...receipt, remainingAmount, status: remainingAmount === 0 ? "resolved" : "partially_resolved", resolutions: [...receipt.resolutions, resolution] };
  return { receipt: updated, loanAccounts: { ...state.loanAccounts, [account.loanAccountId]: payment.loanAccount }, paymentEvent: payment.paymentEvent, resolution, findings, summary };
}

export function writeOffSuspenseReceipt(receipt, input, now = new Date()) {
  const findings = [];
  if (!receipt || !["open", "partially_resolved"].includes(receipt.status) || receipt.remainingAmount <= 0) findings.push(createFinding("error", "RBI-IT-GRC", "Open remaining suspense is required.", "status"));
  if (!input?.writeOffId || !input?.proposedBy || !input?.approvedBy || input.proposedBy === input.approvedBy || !input?.approvalRef || !input?.reason) findings.push(createFinding("error", "RBI-IT-GRC", "Write-off ID, reason, and independent approval are required.", "approval"));
  if (input?.eventDate && !validDate(input.eventDate)) findings.push(createFinding("error", "RBI-IT-GRC", "eventDate must be a valid date.", "eventDate"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { receipt, writeOff: null, findings, summary };
  const writeOff = { writeOffId: input.writeOffId, suspenseId: receipt.suspenseId, amount: receipt.remainingAmount, eventDate: input.eventDate ?? now.toISOString(), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, reason: input.reason };
  return { receipt: { ...receipt, remainingAmount: 0, status: "written_off", writeOff }, writeOff, findings, summary };
}
