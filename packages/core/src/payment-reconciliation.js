import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";
import { postPaymentToLoanAccount } from "./loan-account.js";

const SETTLEMENT_STATUSES = new Set(["settled", "failed", "returned"]);

// Reconciles one immutable provider callback to one initiated UPI collect and,
// only after a full match, posts the repayment to the loan ledger. Unmatched
// and failed callbacks are retained as exceptions; they can never credit a
// borrower account by inference or operator convenience.
export function reconcilePaymentRailSettlement(state, input, now = new Date()) {
  const findings = [];
  const paymentRails = state.paymentRails ?? {};
  const reconciliations = state.paymentReconciliations ?? {};
  const loanAccounts = state.loanAccounts ?? {};
  const providerEventRef = String(input?.providerEventRef ?? "").trim();
  const status = String(input?.status ?? "").trim().toLowerCase();

  if (!providerEventRef) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Provider event reference is required for idempotent reconciliation.", "providerEventRef"));
  }
  if (!SETTLEMENT_STATUSES.has(status)) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Settlement status must be settled, failed, or returned.", "status"));
  }
  const existing = Object.values(reconciliations).find((record) => record.providerEventRef === providerEventRef);
  if (existing) {
    return { paymentRails, reconciliations, loanAccounts, reconciliation: existing, findings, summary: summarizeFindings(findings), duplicate: true };
  }

  const initialSummary = summarizeFindings(findings);
  if (initialSummary.status === "blocked") {
    return { paymentRails, reconciliations, loanAccounts, reconciliation: null, findings, summary: initialSummary, duplicate: false };
  }

  const paymentRail = Object.values(paymentRails).find(
    (record) => record.paymentRailId === input.paymentRailId || record.providerRef === input.providerRef
  );
  const settledAt = input.settledAt ? new Date(input.settledAt) : now;
  const reconciliation = {
    reconciliationId: input.reconciliationId ?? createLoanId("recon"),
    providerEventRef,
    providerRef: input.providerRef ?? paymentRail?.providerRef ?? null,
    paymentRailId: paymentRail?.paymentRailId ?? input.paymentRailId ?? null,
    status,
    amount: Number.isFinite(input.amount) ? input.amount : null,
    currency: input.currency ?? "INR",
    bankReference: input.bankReference ?? null,
    settledAt: Number.isNaN(settledAt.getTime()) ? null : settledAt.toISOString(),
    receivedAt: now.toISOString(),
    failureReason: input.failureReason ?? null,
    loanAccountId: paymentRail?.loanAccountId ?? null,
    outcome: "exception",
    paymentEventId: null
  };

  if (!paymentRail || !["upi_collect", "nach_presentment"].includes(paymentRail.type)) {
    reconciliation.exceptionCode = "unmatched_payment_rail";
    findings.push(createFinding("warning", "RBI-IT-GRC", "Provider callback does not match an active payment collect; retained for operations reconciliation.", "providerRef"));
    return {
      paymentRails,
      reconciliations: { ...reconciliations, [reconciliation.reconciliationId]: reconciliation },
      loanAccounts,
      reconciliation,
      findings,
      summary: summarizeFindings(findings),
      duplicate: false
    };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount !== paymentRail.amount) {
    reconciliation.exceptionCode = "amount_mismatch";
    findings.push(createFinding("warning", "RBI-IT-GRC", "Provider settlement amount does not exactly match the initiated collect; retained for operations reconciliation.", "amount"));
    return {
      paymentRails,
      reconciliations: { ...reconciliations, [reconciliation.reconciliationId]: reconciliation },
      loanAccounts,
      reconciliation,
      findings,
      summary: summarizeFindings(findings),
      duplicate: false
    };
  }

  if (status !== "settled") {
    const updatedRail = { ...paymentRail, status, settlementRef: providerEventRef, settledAt: reconciliation.settledAt, failureReason: reconciliation.failureReason };
    reconciliation.outcome = "matched_not_collected";
    return {
      paymentRails: { ...paymentRails, [updatedRail.paymentRailId]: updatedRail },
      reconciliations: { ...reconciliations, [reconciliation.reconciliationId]: reconciliation },
      loanAccounts,
      reconciliation,
      findings,
      summary: summarizeFindings(findings),
      duplicate: false
    };
  }

  const account = loanAccounts[paymentRail.loanAccountId];
  if (!account) {
    reconciliation.exceptionCode = "loan_account_not_found";
    findings.push(createFinding("warning", "RBI-IT-GRC", "Matched provider settlement has no loan account; retained for operations reconciliation.", "loanAccountId"));
    return {
      paymentRails,
      reconciliations: { ...reconciliations, [reconciliation.reconciliationId]: reconciliation },
      loanAccounts,
      reconciliation,
      findings,
      summary: summarizeFindings(findings),
      duplicate: false
    };
  }

  const payment = postPaymentToLoanAccount(account, {
    amount: input.amount,
    receivedAt: reconciliation.settledAt,
    paymentRef: `rail:${paymentRail.providerRef}:${providerEventRef}`,
    channel: paymentRail.channel,
    actor: "payment_rail_reconciliation"
  }, now);
  if (payment.summary.status === "blocked") {
    reconciliation.exceptionCode = "ledger_posting_blocked";
    findings.push(...payment.findings.map((finding) => ({ ...finding, severity: "warning" })));
    return {
      paymentRails,
      reconciliations: { ...reconciliations, [reconciliation.reconciliationId]: reconciliation },
      loanAccounts,
      reconciliation,
      findings,
      summary: summarizeFindings(findings),
      duplicate: false
    };
  }

  const updatedRail = { ...paymentRail, status: "settled", settlementRef: providerEventRef, settledAt: reconciliation.settledAt, paymentEventId: payment.paymentEvent.eventId };
  reconciliation.outcome = "matched_posted";
  reconciliation.paymentEventId = payment.paymentEvent.eventId;
  return {
    paymentRails: { ...paymentRails, [updatedRail.paymentRailId]: updatedRail },
    reconciliations: { ...reconciliations, [reconciliation.reconciliationId]: reconciliation },
    loanAccounts: { ...loanAccounts, [payment.loanAccount.loanAccountId]: payment.loanAccount },
    reconciliation,
    paymentEvent: payment.paymentEvent,
    findings,
    summary: summarizeFindings(findings),
    duplicate: false
  };
}

// Matches an ingested bank-statement credit to a previously matched provider
// settlement. This is deliberately downstream of ledger posting: it proves
// cash reached the RE bank account without ever using a bank entry to create a
// borrower credit on its own.
export function reconcileBankStatementEntry(state, input, now = new Date()) {
  const findings = [];
  const bankReconciliations = state.bankReconciliations ?? {};
  const transactionRef = String(input?.transactionRef ?? "").trim();
  if (!transactionRef) findings.push(createFinding("error", "RBI-IT-GRC", "Bank transaction reference is required for idempotent reconciliation.", "transactionRef"));
  if (!Number.isFinite(input?.amount) || input.amount <= 0) findings.push(createFinding("error", "RBI-IT-GRC", "Bank statement credit amount must be positive.", "amount"));
  const existing = Object.values(bankReconciliations).find((record) => record.transactionRef === transactionRef);
  if (existing) return { bankReconciliations, bankReconciliation: existing, findings, summary: summarizeFindings(findings), duplicate: true };
  const initialSummary = summarizeFindings(findings);
  if (initialSummary.status === "blocked") return { bankReconciliations, bankReconciliation: null, findings, summary: initialSummary, duplicate: false };

  const settlement = Object.values(state.paymentReconciliations ?? {}).find(
    (record) => record.outcome === "matched_posted" && (record.bankReference === input.bankReference || record.providerEventRef === input.providerEventRef)
  );
  const bankReconciliation = {
    bankReconciliationId: input.bankReconciliationId ?? createLoanId("bankrecon"), transactionRef, bankReference: input.bankReference ?? null,
    providerEventRef: input.providerEventRef ?? null, amount: input.amount, currency: input.currency ?? "INR",
    valueDate: input.valueDate ?? null, accountRef: input.accountRef ?? null, receivedAt: now.toISOString(),
    paymentReconciliationId: settlement?.reconciliationId ?? null, loanAccountId: settlement?.loanAccountId ?? null, outcome: "exception", exceptionCode: null
  };
  if (!settlement) {
    bankReconciliation.exceptionCode = "unmatched_bank_credit";
    findings.push(createFinding("warning", "RBI-IT-GRC", "Bank credit does not match a posted provider settlement; retained for finance reconciliation.", "bankReference"));
  } else if (settlement.amount !== input.amount || settlement.currency !== bankReconciliation.currency) {
    bankReconciliation.exceptionCode = "bank_amount_or_currency_mismatch";
    findings.push(createFinding("warning", "RBI-IT-GRC", "Bank credit amount or currency does not match the provider settlement; retained for finance reconciliation.", "amount"));
  } else {
    bankReconciliation.outcome = "matched";
    bankReconciliation.exceptionCode = null;
  }
  return { bankReconciliations: { ...bankReconciliations, [bankReconciliation.bankReconciliationId]: bankReconciliation }, bankReconciliation, findings, summary: summarizeFindings(findings), duplicate: false };
}
