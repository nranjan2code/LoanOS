// Finance-grade journal projection from immutable loan events. Entries are
// derived, never manually editable; the originating ledger event remains the
// source of truth and every journal is balanced by construction.
//
// This module owns only the projection from ledger event -> double-entry
// journal lines; it does not own the ledger itself (event sourcing/append
// lives wherever `account.ledger` is written) and does not own co-lending
// split *policy* (share percentages, leg roles) — it only applies whatever
// `account.coLendingAllocation` already carries (see `co-lending.js` /
// `co-lending-finance.js` for where that allocation is decided). A
// co-lending loan's single ledger event fans out into one balanced journal
// per participating entity (`splitCoLendingJournal`), each closed with an
// intercompany due-to/due-from line for any rounding remainder, so every
// per-entity book still balances exactly even though shares are computed in
// integer paise.
const abs = (value) => Math.abs(Number(value ?? 0));

/**
 * Project a loan account's immutable ledger events into balanced double-entry
 * journal entries. A `"reversal"` event replays the original event's lines
 * with debit/credit flipped (`reverseLines`) rather than re-deriving from
 * scratch, so a reversal always exactly cancels what it reverses. Throws if
 * any single-entity journal doesn't balance to the paisa — that indicates a
 * bug in `journalLines`, not a legitimate business state, so it is not
 * caught/degraded here (fail loud at the projection boundary rather than
 * persist an unbalanced book).
 * @param {object} account - loan account with `ledger` events, `accountingProfile`, and optional `coLendingAllocation`.
 * @returns {Array<object>} one journal entry per ledger event (or per co-lending leg).
 */
export function buildLoanJournalEntries(account) {
  const entries = [];
  const linesByEventId = new Map();
  for (const event of account?.ledger ?? []) {
    const lines = event.type === "reversal"
      ? reverseLines(linesByEventId.get(event.reversalOfEventId) ?? [])
      : journalLines(event, account.accountingProfile?.accounts);
    if (!lines.length) continue;
    linesByEventId.set(event.eventId, lines);
    const allocation = account.coLendingAllocation;
    if (allocation?.legs?.length) {
      entries.push(...splitCoLendingJournal(account, event, lines, allocation));
      continue;
    }
    const debit = lines.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.amount, 0);
    const credit = lines.filter((line) => line.side === "credit").reduce((sum, line) => sum + line.amount, 0);
    if (Math.round(debit * 100) !== Math.round(credit * 100)) throw new Error(`Unbalanced journal projection for ${event.eventId}`);
    entries.push({ journalId: `jrnl_${event.eventId}`, loanAccountId: account.loanAccountId, eventId: event.eventId, eventType: event.type, eventDate: event.eventDate, currency: account.currency, lines, debitTotal: debit, creditTotal: credit });
  }
  return entries;
}

// Fan a single-entity journal out into one journal per co-lending leg,
// allocating each line's amount by the leg's share (interest/fee/principal
// shares can differ per leg) in integer paise, with the last leg absorbing
// any rounding remainder so paise-level splits always sum exactly to the
// original amount. Each per-leg journal is force-balanced with an
// intercompany due-to/due-from line since splitting by share can leave a
// leg's debits and credits momentarily unequal.
function splitCoLendingJournal(account, event, lines, allocation) {
  const ordered = [...allocation.legs].sort((left, right) => (left.role === "originating" ? 1 : 0) - (right.role === "originating" ? 1 : 0));
  const partnerLines = new Map(ordered.map((leg) => [leg.regulatedEntityId, []]));
  for (const line of lines) {
    const amountPaise = Math.round(line.amount * 100); let allocatedPaise = 0;
    for (let index = 0; index < ordered.length; index += 1) {
      const leg = ordered[index]; const share = shareForLine(line.account, leg); const linePaise = index === ordered.length - 1 ? amountPaise - allocatedPaise : Math.round((amountPaise * share) / 100); allocatedPaise += index === ordered.length - 1 ? 0 : linePaise;
      if (!linePaise) continue;
      partnerLines.get(leg.regulatedEntityId).push({ ...line, account: coLendingAccount(line.account, line.side, event.type, leg.role), amount: linePaise / 100 });
    }
  }
  return ordered.map((leg) => {
    const entityLines = partnerLines.get(leg.regulatedEntityId); const debitPaise = entityLines.filter((line) => line.side === "debit").reduce((sum, line) => sum + Math.round(line.amount * 100), 0); const creditPaise = entityLines.filter((line) => line.side === "credit").reduce((sum, line) => sum + Math.round(line.amount * 100), 0);
    if (debitPaise > creditPaise) entityLines.push({ account: "intercompany_due_to_co_lender", side: "credit", amount: (debitPaise - creditPaise) / 100 });
    if (creditPaise > debitPaise) entityLines.push({ account: "intercompany_due_from_co_lender", side: "debit", amount: (creditPaise - debitPaise) / 100 });
    const totalPaise = Math.max(debitPaise, creditPaise);
    return { journalId: `jrnl_${event.eventId}:${leg.regulatedEntityId}`, loanAccountId: account.loanAccountId, eventId: event.eventId, eventType: event.type, eventDate: event.eventDate, currency: account.currency, entityId: leg.regulatedEntityId, partnerRole: leg.role, coLendingArrangementId: allocation.coLendingArrangementId, allocationId: allocation.allocationId, book: "co_lending_entity", lines: entityLines, debitTotal: totalPaise / 100, creditTotal: totalPaise / 100 };
  });
}

// Pick which of a leg's differentiated share percentages applies to a given
// account line (interest vs. fee/GST vs. the default principal share).
function shareForLine(account, leg) {
  if (String(account).includes("interest")) return Number(leg.interestSharePercent ?? leg.sharePercent);
  if (String(account).includes("charges") || String(account).includes("gst")) return Number(leg.feeSharePercent ?? leg.sharePercent);
  return Number(leg.sharePercent);
}

// Retarget the shared "bank_clearing" account to the partner-specific
// funding/collections clearing account for a co-lending partner's leg, so
// partner cash flows are distinguishable from the originating entity's own.
function coLendingAccount(account, side, eventType, role) {
  if (role !== "partner" || account !== "bank_clearing") return account;
  if (eventType === "disbursement" && side === "credit") return "co_lending_funding_clearing";
  if (["payment", "cash_recovery_payment", "cooling_off_cancellation"].includes(eventType) && side === "debit") return "co_lending_collections_clearing";
  return account;
}

// The actual chart-of-accounts mapping: which debit/credit lines a given
// ledger event type produces. `configuredAccounts` lets a tenant override
// individual GL account codes without changing the debit/credit structure.
function journalLines(event, configuredAccounts = {}) {
  const accounts = {
    bankClearing: "bank_clearing", principalReceivable: "loan_principal_receivable", interestReceivable: "interest_receivable", interestIncome: "interest_income", chargesReceivable: "charges_receivable", chargesIncome: "charges_income", outputGstPayable: "output_gst_payable", customerCreditBalance: "customer_credit_balance", chargeWaiverExpense: "charge_waiver_expense", settlementLoss: "settlement_loss",
    ...configuredAccounts
  };
  const principal = abs(event.principalDebit || event.principalCredit || event.principalWaiverCredit);
  const interest = abs(event.interestCredit || event.interestDebit || event.interestWaiverCredit);
  const charges = abs(event.chargesCredit || event.chargesDebit || event.chargesWaiverCredit);
  const amount = abs(event.amount);
  if (["disbursement", "revolving_drawdown"].includes(event.type)) return [{ account: accounts.principalReceivable, side: "debit", amount: principal }, { account: accounts.bankClearing, side: "credit", amount: principal }];
  if (["interest_accrual", "revolving_interest_accrual"].includes(event.type)) return [{ account: accounts.interestReceivable, side: "debit", amount }, { account: accounts.interestIncome, side: "credit", amount }];
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

// Flip debit<->credit on every line, so replaying a reversal event exactly
// cancels the original event's journal impact.
function reverseLines(lines) {
  return lines.map((line) => ({ ...line, side: line.side === "debit" ? "credit" : "debit" }));
}
