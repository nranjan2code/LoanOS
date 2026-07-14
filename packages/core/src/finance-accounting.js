import { classifyLoanAsset, summarizeLoanAccount } from "./loan-account.js";
import { buildCoLendingSettlementJournals } from "./co-lending-finance.js";

const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const paise = (value) => Math.round(Number(value ?? 0) * 100);
const fromPaise = (value) => value / 100;

export function calculateEclAssessment(account, parameterSet, asOf = new Date()) {
  if (!account || !parameterSet || parameterSet.status !== "approved") throw new Error("An account and approved ECL parameter set are required.");
  const asset = classifyLoanAsset(account, asOf);
  const balance = summarizeLoanAccount(account, asOf);
  const stage = asset.assetClass === "npa" ? 3 : asset.daysPastDue > 0 || asset.restructured ? 2 : 1;
  const exposureAtDefault = balance.principalOutstanding;
  const expectedCreditLossPaise = Math.round((paise(exposureAtDefault) * parameterSet.pdBps * parameterSet.lgdBps) / 100000000);
  return { asOf: asOf.toISOString(), loanAccountId: account.loanAccountId, parameterSetId: parameterSet.parameterSetId, parameterSetVersion: parameterSet.version, stage, assetClass: asset.assetClass, exposureAtDefault, pdBps: parameterSet.pdBps, lgdBps: parameterSet.lgdBps, expectedCreditLoss: fromPaise(expectedCreditLossPaise), methodology: "ead_x_pd_x_lgd" };
}

export function buildFinanceJournalEntries(state) {
  const provisionJournals = Object.values(state.eclProvisions ?? {}).map((record) => movementJournal(record, "ecl_expense", "ecl_loss_allowance"));
  const iracJournals = Object.values(state.iracIncomeAdjustments ?? {}).map((record) => movementJournal(record, "interest_income", "interest_receivable"));
  const tdsJournals = Object.values(state.taxWithholdings ?? {}).map((record) => ({ journalId: `jrnl_${record.withholdingId}`, eventId: record.withholdingId, eventType: "tds_withholding", eventDate: record.paymentDate, currency: "INR", lines: [{ account: record.expenseAccount, side: "debit", amount: record.grossAmount }, { account: "bank_clearing", side: "credit", amount: record.netAmount }, { account: "tds_payable", side: "credit", amount: record.tdsAmount }], debitTotal: record.grossAmount, creditTotal: money(record.netAmount + record.tdsAmount) }));
  const creditNoteJournals = Object.values(state.gstCreditNotes ?? {}).map((record) => { const accounts = record.accountingAccounts ?? {}; return { journalId: `jrnl_${record.creditNoteId}`, loanAccountId: record.loanAccountId, eventId: record.creditNoteId, eventType: "gst_credit_note", eventDate: record.issuedAt, currency: "INR", lines: [{ account: accounts.chargesIncome ?? "charges_income", side: "debit", amount: record.taxableValue }, { account: accounts.outputGstPayable ?? "output_gst_payable", side: "debit", amount: record.gstAmount }, { account: accounts.chargesReceivable ?? "charges_receivable", side: "credit", amount: record.grossAmount }], debitTotal: record.grossAmount, creditTotal: record.grossAmount }; });
  const suspenseJournals = Object.values(state.paymentSuspenseReceipts ?? {}).flatMap((record) => {
    const receipt = { journalId: `jrnl_${record.suspenseId}`, eventId: record.suspenseId, eventType: "payment_suspense_received", eventDate: `${record.valueDate}T00:00:00.000Z`, currency: "INR", lines: [{ account: "bank_clearing", side: "debit", amount: record.amount }, { account: "payment_suspense_liability", side: "credit", amount: record.amount }], debitTotal: record.amount, creditTotal: record.amount };
    const resolutions = (record.resolutions ?? []).map((resolution) => ({ journalId: `jrnl_${resolution.resolutionId}`, loanAccountId: resolution.loanAccountId, eventId: resolution.resolutionId, eventType: "payment_suspense_resolved", eventDate: `${resolution.valueDate}T00:00:00.000Z`, currency: "INR", lines: [{ account: "payment_suspense_liability", side: "debit", amount: resolution.amount }, { account: "bank_clearing", side: "credit", amount: resolution.amount }], debitTotal: resolution.amount, creditTotal: resolution.amount }));
    const writeOff = record.writeOff ? [{ journalId: `jrnl_${record.writeOff.writeOffId}`, eventId: record.writeOff.writeOffId, eventType: "payment_suspense_written_off", eventDate: record.writeOff.eventDate, currency: "INR", lines: [{ account: "payment_suspense_liability", side: "debit", amount: record.writeOff.amount }, { account: "payment_suspense_writeoff_income", side: "credit", amount: record.writeOff.amount }], debitTotal: record.writeOff.amount, creditTotal: record.writeOff.amount }] : [];
    return [receipt, ...resolutions, ...writeOff];
  });
  return [...provisionJournals, ...iracJournals, ...tdsJournals, ...creditNoteJournals, ...suspenseJournals, ...buildCoLendingSettlementJournals(state)];
}

function movementJournal(record, debitAccount, creditAccount) {
  const increase = record.movementAmount >= 0;
  const amount = Math.abs(record.movementAmount);
  return { journalId: `jrnl_${record.provisionId ?? record.adjustmentId}`, loanAccountId: record.loanAccountId, eventId: record.provisionId ?? record.adjustmentId, eventType: record.provisionId ? "ecl_provision_movement" : "irac_income_reversal", eventDate: record.asOf, currency: "INR", lines: [{ account: increase ? debitAccount : creditAccount, side: "debit", amount }, { account: increase ? creditAccount : debitAccount, side: "credit", amount }], debitTotal: amount, creditTotal: amount };
}

export function buildGstReturnData(invoices, creditNotes, from, to) {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T23:59:59.999Z`).getTime();
  const rows = Object.values(invoices ?? {}).filter((record) => new Date(record.issuedAt).getTime() >= start && new Date(record.issuedAt).getTime() <= end).map((record) => ({ documentType: "invoice", documentId: record.invoiceId, documentNumber: record.invoiceNumber, loanAccountId: record.loanAccountId, documentDate: record.issuedAt.slice(0, 10), taxableValue: record.taxableValue, gstRateBps: record.gstRateBps, outputGst: record.gstAmount, cgstAmount: record.cgstAmount, sgstAmount: record.sgstAmount, igstAmount: record.igstAmount, grossAmount: record.grossAmount }));
  const creditRows = Object.values(creditNotes ?? {}).filter((record) => new Date(record.issuedAt).getTime() >= start && new Date(record.issuedAt).getTime() <= end).map((record) => ({ documentType: "credit_note", documentId: record.creditNoteId, documentNumber: record.creditNoteNumber, loanAccountId: record.loanAccountId, documentDate: record.issuedAt.slice(0, 10), taxableValue: -record.taxableValue, gstRateBps: record.gstRateBps, outputGst: -record.gstAmount, cgstAmount: -record.cgstAmount, sgstAmount: -record.sgstAmount, igstAmount: -record.igstAmount, grossAmount: -record.grossAmount }));
  const allRows = [...rows, ...creditRows];
  return { from, to, rowCount: allRows.length, taxableValue: fromPaise(allRows.reduce((sum, row) => sum + paise(row.taxableValue), 0)), outputGst: fromPaise(allRows.reduce((sum, row) => sum + paise(row.outputGst), 0)), cgstAmount: fromPaise(allRows.reduce((sum, row) => sum + paise(row.cgstAmount), 0)), sgstAmount: fromPaise(allRows.reduce((sum, row) => sum + paise(row.sgstAmount), 0)), igstAmount: fromPaise(allRows.reduce((sum, row) => sum + paise(row.igstAmount), 0)), grossAmount: fromPaise(allRows.reduce((sum, row) => sum + paise(row.grossAmount), 0)), rows: allRows };
}

export function buildTdsReturnData(withholdings, certificates, from, to) {
  const start = new Date(`${from}T00:00:00.000Z`).getTime(); const end = new Date(`${to}T23:59:59.999Z`).getTime();
  const rows = Object.values(withholdings ?? {}).filter((record) => new Date(record.paymentDate).getTime() >= start && new Date(record.paymentDate).getTime() <= end).map((record) => { const certificate = Object.values(certificates ?? {}).find((item) => item.withholdingId === record.withholdingId); return { withholdingId: record.withholdingId, paymentDate: record.paymentDate, payeeId: record.payeeId, section: record.section, grossAmount: record.grossAmount, rateBps: record.rateBps, tdsAmount: record.tdsAmount, certificateNumber: certificate?.certificateNumber ?? null }; });
  return { from, to, rowCount: rows.length, grossAmount: fromPaise(rows.reduce((sum, row) => sum + paise(row.grossAmount), 0)), tdsAmount: fromPaise(rows.reduce((sum, row) => sum + paise(row.tdsAmount), 0)), rows };
}
