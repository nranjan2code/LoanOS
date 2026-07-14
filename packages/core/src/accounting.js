// Finance-grade journal projection from immutable loan events. Entries are
// derived, never manually editable; the originating ledger event remains the
// source of truth and every journal is balanced by construction.
const abs = (value) => Math.abs(Number(value ?? 0));

export function buildLoanJournalEntries(account) {
  const entries = [];
  const linesByEventId = new Map();
  for (const event of account?.ledger ?? []) {
    const lines = event.type === "reversal"
      ? reverseLines(linesByEventId.get(event.reversalOfEventId) ?? [])
      : journalLines(event, account.accountingProfile?.accounts);
    if (!lines.length) continue;
    const debit = lines.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.amount, 0);
    const credit = lines.filter((line) => line.side === "credit").reduce((sum, line) => sum + line.amount, 0);
    if (Math.round(debit * 100) !== Math.round(credit * 100)) throw new Error(`Unbalanced journal projection for ${event.eventId}`);
    entries.push({ journalId: `jrnl_${event.eventId}`, loanAccountId: account.loanAccountId, eventId: event.eventId, eventType: event.type, eventDate: event.eventDate, currency: account.currency, lines, debitTotal: debit, creditTotal: credit });
    linesByEventId.set(event.eventId, lines);
  }
  return entries;
}

function journalLines(event, configuredAccounts = {}) {
  const accounts = {
    bankClearing: "bank_clearing", principalReceivable: "loan_principal_receivable", interestReceivable: "interest_receivable", interestIncome: "interest_income", chargesReceivable: "charges_receivable", chargesIncome: "charges_income", outputGstPayable: "output_gst_payable", customerCreditBalance: "customer_credit_balance", chargeWaiverExpense: "charge_waiver_expense", settlementLoss: "settlement_loss",
    ...configuredAccounts
  };
  const principal = abs(event.principalDebit || event.principalCredit || event.principalWaiverCredit);
  const interest = abs(event.interestCredit || event.interestDebit || event.interestWaiverCredit);
  const charges = abs(event.chargesCredit || event.chargesDebit || event.chargesWaiverCredit);
  const amount = abs(event.amount);
  if (event.type === "disbursement") return [{ account: accounts.principalReceivable, side: "debit", amount: principal }, { account: accounts.bankClearing, side: "credit", amount: principal }];
  if (event.type === "interest_accrual") return [{ account: accounts.interestReceivable, side: "debit", amount }, { account: accounts.interestIncome, side: "credit", amount }];
  if (event.type === "charge_assessed") {
    const gst = abs(event.gstAmount);
    const base = gst ? abs(event.baseAmount) : amount;
    return [{ account: accounts.chargesReceivable, side: "debit", amount }, { account: accounts.chargesIncome, side: "credit", amount: base }, ...(gst ? [{ account: accounts.outputGstPayable, side: "credit", amount: gst }] : [])];
  }
  if (event.type === "charge_waiver") return [{ account: accounts.chargeWaiverExpense, side: "debit", amount }, { account: accounts.chargesReceivable, side: "credit", amount }];
  if (event.type === "payment" || event.type === "cash_recovery_payment") {
    const unapplied = abs(event.unappliedAmount);
    return [{ account: accounts.bankClearing, side: "debit", amount }, { account: accounts.principalReceivable, side: "credit", amount: principal }, { account: accounts.interestIncome, side: "credit", amount: interest }, { account: accounts.chargesIncome, side: "credit", amount: charges }, ...(unapplied ? [{ account: accounts.customerCreditBalance, side: "credit", amount: unapplied }] : [])];
  }
  if (event.type === "refund") return [{ account: accounts.customerCreditBalance, side: "debit", amount }, { account: accounts.bankClearing, side: "credit", amount }];
  if (event.type === "disbursement_return") return [{ account: accounts.bankClearing, side: "debit", amount }, { account: accounts.principalReceivable, side: "credit", amount: principal }];
  if (event.type === "cooling_off_cancellation") return [{ account: accounts.bankClearing, side: "debit", amount }, { account: accounts.principalReceivable, side: "credit", amount: principal }, ...(event.coolingOffInterestCollected ? [{ account: accounts.interestIncome, side: "credit", amount: event.coolingOffInterestCollected }] : [])];
  if (event.type === "settlement_sacrifice") return [{ account: accounts.settlementLoss, side: "debit", amount }, ...(principal ? [{ account: accounts.principalReceivable, side: "credit", amount: principal }] : []), ...(interest ? [{ account: accounts.interestReceivable, side: "credit", amount: interest }] : []), ...(charges ? [{ account: accounts.chargesReceivable, side: "credit", amount: charges }] : [])];
  return [];
}

function reverseLines(lines) {
  return lines.map((line) => ({ ...line, side: line.side === "debit" ? "credit" : "debit" }));
}
