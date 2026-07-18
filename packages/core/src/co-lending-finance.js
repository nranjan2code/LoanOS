/**
 * Co-lending finance: the money side of a co-lending arrangement (RBI's
 * co-origination/co-lending model, typically bank + NBFC) — transfer
 * pricing between partners, partner settlement statements and payments,
 * their journal postings, ECL provision splitting/journals, and the GST/TDS
 * tax-exchange lifecycle for the originator's servicing fee. This module
 * does not own the co-lending *policy* (each loan's per-leg share
 * percentages, roles, transfer-price/servicing-fee rates) — that comes in
 * on `arrangement.partners`/`allocation.legs` from `co-lending.js`; this
 * module only computes money flows from those already-decided shares.
 *
 * Every monetary computation here is done in integer paise
 * (`money()`/`paise()` convert at the boundary), and `splitPaise` always
 * assigns the *last* leg the remainder of a split rather than its
 * proportional share — this guarantees a paise-exact partition with no
 * rounding leakage, at the cost of concentrating rounding into whichever
 * leg happens to be ordered last (`orderedLegs` puts the originating
 * partner last on purpose, so it absorbs the remainder rather than a
 * lending partner). Settlement payments are reconciled by exact-paise
 * match against the approved statement leg (`paise(input.amount) ===
 * paise(leg.netPayable)`); a mismatch is recorded as an `"exception"`, not
 * silently accepted. Statement creation and tax-exchange creation both
 * require independent proposer/approver, per the platform's general
 * four-eyes discipline.
 */
import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";

const PAYMENT_TYPES = new Set(["payment", "cash_recovery_payment"]);
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const paise = (value) => Math.round(Number(value ?? 0) * 100);
const validDate = (value) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false; const parsed = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; };

/**
 * Compute each partner's transfer-pricing and collections position for an
 * arrangement over `[from, to]`: opening/closing principal outstanding,
 * principal/interest/fee actually collected in the window, the resulting
 * transfer-pricing carrying cost (on average outstanding, at the partner's
 * `transferPriceBps`, day-counted over the period), and — for the
 * `"partner"` role only — the servicing fee/GST/TDS deduction and net
 * payable. This is a pure read/report; it does not create a settlement
 * (see `createCoLendingSettlementStatement`, which calls this and then
 * persists the result).
 * @param {object} state - holds `loanAccounts`.
 * @param {object} arrangement - co-lending arrangement with `partners` and `allocations`.
 * @param {string} from - ISO date (yyyy-mm-dd), inclusive.
 * @param {string} to - ISO date (yyyy-mm-dd), inclusive.
 * @returns {object} per-partner rows plus arrangement totals.
 */
export function buildCoLendingTransferPricingReport(state, arrangement, from, to) {
  if (!arrangement || !validDate(from) || !validDate(to) || from > to) throw new Error("Arrangement and valid from/to dates are required.");
  const start = new Date(`${from}T00:00:00.000Z`).getTime(); const end = new Date(`${to}T23:59:59.999Z`).getTime(); const days = Math.max(1, Math.floor((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86400000) + 1);
  const buckets = new Map(arrangement.partners.map((partner) => [partner.regulatedEntityId, { regulatedEntityId: partner.regulatedEntityId, role: partner.role, sharePercent: partner.sharePercent, interestSharePercent: partner.interestSharePercent, feeSharePercent: partner.feeSharePercent, transferPriceBps: partner.transferPriceBps, servicingFeeBps: partner.servicingFeeBps, servicingGstRateBps: partner.servicingGstRateBps ?? 0, servicingTdsRateBps: partner.servicingTdsRateBps ?? 0, allocatedPrincipalPaise: 0, openingPrincipalPaise: 0, closingPrincipalPaise: 0, principalCollectedPaise: 0, interestCollectedPaise: 0, feesCollectedPaise: 0, loanAccountIds: new Set() }]));
  for (const allocation of arrangement.allocations ?? []) {
    const account = state.loanAccounts?.[allocation.loanAccountId]; if (!account) continue;
    const ordered = orderedLegs(allocation.legs); const principalCreditsBeforeStart = (account.ledger ?? []).filter((event) => new Date(event.eventDate).getTime() < start).reduce((sum, event) => sum + paise(event.principalCredit), 0); const principalCreditsThroughEnd = (account.ledger ?? []).filter((event) => new Date(event.eventDate).getTime() <= end).reduce((sum, event) => sum + paise(event.principalCredit), 0);
    const openingCredits = splitPaise(principalCreditsBeforeStart, ordered, "sharePercent"); const closingCredits = splitPaise(principalCreditsThroughEnd, ordered, "sharePercent");
    for (const leg of ordered) { const bucket = buckets.get(leg.regulatedEntityId); const allocated = paise(leg.amountInr); bucket.allocatedPrincipalPaise += allocated; bucket.openingPrincipalPaise += Math.max(0, allocated - openingCredits.get(leg.regulatedEntityId)); bucket.closingPrincipalPaise += Math.max(0, allocated - closingCredits.get(leg.regulatedEntityId)); bucket.loanAccountIds.add(account.loanAccountId); }
    for (const event of account.ledger ?? []) {
      const timestamp = new Date(event.eventDate).getTime(); if (!PAYMENT_TYPES.has(event.type) || timestamp < start || timestamp > end) continue;
      const principal = splitPaise(paise(event.principalCredit), ordered, "sharePercent"); const interest = splitPaise(paise(event.interestCredit), ordered, "interestSharePercent"); const fees = splitPaise(paise(event.chargesCredit), ordered, "feeSharePercent");
      for (const leg of ordered) { const bucket = buckets.get(leg.regulatedEntityId); bucket.principalCollectedPaise += principal.get(leg.regulatedEntityId); bucket.interestCollectedPaise += interest.get(leg.regulatedEntityId); bucket.feesCollectedPaise += fees.get(leg.regulatedEntityId); }
    }
  }
  const partners = [...buckets.values()].map((bucket) => { const averageOutstandingPaise = Math.round((bucket.openingPrincipalPaise + bucket.closingPrincipalPaise) / 2); const transferPricingCostPaise = Math.round((averageOutstandingPaise * bucket.transferPriceBps * days) / 3650000); const grossCollectionsPaise = bucket.principalCollectedPaise + bucket.interestCollectedPaise + bucket.feesCollectedPaise; const servicingFeePaise = bucket.role === "partner" ? Math.round((grossCollectionsPaise * bucket.servicingFeeBps) / 10000) : 0; const servicingGstPaise = Math.round((servicingFeePaise * bucket.servicingGstRateBps) / 10000); const servicingTdsPaise = Math.round((servicingFeePaise * bucket.servicingTdsRateBps) / 10000); const serviceDeductionPaise = servicingFeePaise + servicingGstPaise - servicingTdsPaise; const netPayablePaise = bucket.role === "partner" ? Math.max(0, grossCollectionsPaise - serviceDeductionPaise) : 0; const contributionMarginPaise = bucket.interestCollectedPaise + bucket.feesCollectedPaise - transferPricingCostPaise - servicingFeePaise; return { regulatedEntityId: bucket.regulatedEntityId, role: bucket.role, sharePercent: bucket.sharePercent, interestSharePercent: bucket.interestSharePercent, feeSharePercent: bucket.feeSharePercent, transferPriceBps: bucket.transferPriceBps, servicingFeeBps: bucket.servicingFeeBps, servicingGstRateBps: bucket.servicingGstRateBps, servicingTdsRateBps: bucket.servicingTdsRateBps, loanAccountIds: [...bucket.loanAccountIds], allocatedPrincipal: bucket.allocatedPrincipalPaise / 100, openingPrincipal: bucket.openingPrincipalPaise / 100, closingPrincipal: bucket.closingPrincipalPaise / 100, averageOutstanding: averageOutstandingPaise / 100, principalCollected: bucket.principalCollectedPaise / 100, interestCollected: bucket.interestCollectedPaise / 100, feesCollected: bucket.feesCollectedPaise / 100, grossCollections: grossCollectionsPaise / 100, servicingFee: servicingFeePaise / 100, servicingGst: servicingGstPaise / 100, servicingTds: servicingTdsPaise / 100, serviceDeduction: serviceDeductionPaise / 100, netPayable: netPayablePaise / 100, transferPricingCost: transferPricingCostPaise / 100, contributionMargin: contributionMarginPaise / 100 }; });
  return { coLendingArrangementId: arrangement.coLendingArrangementId, agreementRef: arrangement.agreementRef, from, to, days, partners, totals: sumPartnerRows(partners) };
}

/**
 * Freeze a transfer-pricing report into an immutable, checksummed
 * settlement statement for a period. Fails closed unless the arrangement
 * is active, the period is valid, and independent proposer/approver are
 * present. Each partner leg starts `"pending"` (owed) or `"not_payable"`
 * (originating role, or zero net payable); the statement itself starts
 * `"pending_payment"` if any leg is pending, else `"settled"`.
 * @param {object} state - holds `loanAccounts`, passed through to `buildCoLendingTransferPricingReport`.
 * @param {object} arrangement - the active co-lending arrangement.
 * @param {object} input - statementId, from, to, proposedBy, approvedBy, approvalRef.
 * @param {Date} [now]
 * @returns {{statement: object|null, findings: Array<object>, summary: object}}
 */
export function createCoLendingSettlementStatement(state, arrangement, input, now = new Date()) {
  const findings = [];
  if (!arrangement || arrangement.status !== "active") findings.push(createFinding("error", "RBI-DL-2025", "An active co-lending arrangement is required.", "coLendingArrangementId"));
  if (!input?.statementId || !validDate(input.from) || !validDate(input.to) || input.from > input.to) findings.push(createFinding("error", "RBI-IT-GRC", "statementId and valid from/to dates are required.", "period"));
  if (!input?.proposedBy || !input?.approvedBy || input.proposedBy === input.approvedBy || !input?.approvalRef) findings.push(createFinding("error", "RBI-IT-GRC", "Independent proposal and approval evidence are required.", "approval"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { statement: null, findings, summary };
  const report = buildCoLendingTransferPricingReport(state, arrangement, input.from, input.to); const partnerLegs = report.partners.map((row) => ({ ...row, settlementStatus: row.role === "partner" && row.netPayable > 0 ? "pending" : "not_payable", paymentId: null }));
  const immutable = { statementId: input.statementId, coLendingArrangementId: arrangement.coLendingArrangementId, agreementRef: arrangement.agreementRef, escrowAccountRef: arrangement.escrowAccountRef, from: input.from, to: input.to, days: report.days, partnerLegs, totals: report.totals, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  const checksumSha256 = createHash("sha256").update(JSON.stringify(immutable)).digest("hex");
  return { statement: { ...immutable, checksumSha256, status: partnerLegs.some((leg) => leg.settlementStatus === "pending") ? "pending_payment" : "settled", approvedAt: now.toISOString(), updatedAt: now.toISOString() }, findings, summary };
}

/**
 * Record a partner settlement payment against a statement's pending leg.
 * Requires independent recorder/approver. If the paid amount doesn't
 * exactly match the approved `netPayable` (to the paisa), the payment is
 * still recorded but tagged `outcome: "exception"` with a `differenceAmount`
 * and returned as a warning — the statement itself is *not* advanced to
 * paid, so an exact rematch/correction is still required.
 * @param {object} statement - existing settlement statement.
 * @param {object} input - regulatedEntityId, paymentId, bankReference, amount, recordedBy, approvedBy, approvalRef, escrowInstructionId, paidAt.
 * @param {Date} [now]
 * @returns {{statement: object, payment: object|null, findings: Array<object>, summary: object}}
 */
export function recordCoLendingSettlementPayment(statement, input, now = new Date()) {
  const findings = []; const leg = statement?.partnerLegs?.find((record) => record.regulatedEntityId === input?.regulatedEntityId && record.role === "partner");
  if (!statement || !leg || leg.settlementStatus !== "pending") findings.push(createFinding("error", "RBI-IT-GRC", "A pending partner settlement leg is required.", "regulatedEntityId"));
  if (!input?.paymentId || !input?.bankReference || !Number.isFinite(input?.amount) || input.amount <= 0 || Math.abs(input.amount * 100 - Math.round(input.amount * 100)) >= 1e-8) findings.push(createFinding("error", "RBI-IT-GRC", "paymentId, bankReference, and a positive paise-exact amount are required.", "payment"));
  if (!input?.recordedBy || !input?.approvedBy || input.recordedBy === input.approvedBy || !input?.approvalRef) findings.push(createFinding("error", "RBI-IT-GRC", "Independent payment approval evidence is required.", "approval"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { statement, payment: null, findings, summary };
  const matched = paise(input.amount) === paise(leg.netPayable); const payment = { paymentId: input.paymentId, statementId: statement.statementId, coLendingArrangementId: statement.coLendingArrangementId, regulatedEntityId: input.regulatedEntityId, amount: money(input.amount), expectedAmount: leg.netPayable, servicingFee: leg.servicingFee, servicingGst: leg.servicingGst ?? 0, servicingTds: leg.servicingTds ?? 0, grossCollections: leg.grossCollections, bankReference: input.bankReference, escrowInstructionId: input.escrowInstructionId ?? null, paidAt: input.paidAt ?? now.toISOString(), recordedBy: input.recordedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, outcome: matched ? "reconciled" : "exception", differenceAmount: money(input.amount - leg.netPayable) };
  if (!matched) return { statement, payment, findings: [createFinding("warning", "RBI-IT-GRC", "Partner payment does not exactly match the approved statement leg.", "amount")], summary: summarizeFindings([]) };
  const partnerLegs = statement.partnerLegs.map((record) => record.regulatedEntityId === leg.regulatedEntityId ? { ...record, settlementStatus: "paid", paymentId: payment.paymentId } : record); const settled = !partnerLegs.some((record) => record.settlementStatus === "pending");
  return { statement: { ...statement, partnerLegs, status: settled ? "settled" : "partially_settled", updatedAt: now.toISOString() }, payment, findings, summary };
}

/**
 * Project every reconciled co-lending settlement payment into its double-
 * entry journals: a partner-entity journal (cash paid, servicing fee
 * expense, input GST, against collections clearing and TDS payable) and,
 * when a servicing fee was actually charged, a matching originator-entity
 * journal recognizing the servicing fee income/output GST. Only
 * `outcome === "reconciled"` payments are projected — exceptions are
 * excluded until corrected.
 * @param {object} state - holds `coLendingSettlementPayments`, `coLendingArrangements`.
 * @returns {Array<object>} journal entries, one or two per reconciled payment.
 */
export function buildCoLendingSettlementJournals(state) {
  return Object.values(state.coLendingSettlementPayments ?? {}).filter((payment) => payment.outcome === "reconciled").flatMap((payment) => {
    const net = money(payment.amount); const fee = money(payment.servicingFee); const gst = money(payment.servicingGst); const tds = money(payment.servicingTds); const gross = money(net + fee + gst - tds); const partnerDebit = money(net + fee + gst); const partnerCredit = money(gross + tds); const partnerJournal = { journalId: `jrnl_${payment.paymentId}:partner`, eventId: payment.paymentId, eventType: "co_lending_partner_settlement", eventDate: payment.paidAt, currency: "INR", entityId: payment.regulatedEntityId, coLendingArrangementId: payment.coLendingArrangementId, book: "co_lending_entity", lines: [{ account: "bank_clearing", side: "debit", amount: net }, ...(fee ? [{ account: "co_lending_servicing_fee_expense", side: "debit", amount: fee }] : []), ...(gst ? [{ account: "input_gst_receivable", side: "debit", amount: gst }] : []), { account: "co_lending_collections_clearing", side: "credit", amount: gross }, ...(tds ? [{ account: "tds_payable", side: "credit", amount: tds }] : [])], debitTotal: partnerDebit, creditTotal: partnerCredit };
    if (!fee) return [partnerJournal]; const arrangement = state.coLendingArrangements?.[payment.coLendingArrangementId]; const originator = arrangement?.partners?.find((partner) => partner.role === "originating"); const cash = money(fee + gst - tds); const originatorJournal = { journalId: `jrnl_${payment.paymentId}:originator_fee`, eventId: payment.paymentId, eventType: "co_lending_servicing_fee", eventDate: payment.paidAt, currency: "INR", entityId: originator?.regulatedEntityId ?? null, coLendingArrangementId: payment.coLendingArrangementId, book: "co_lending_entity", lines: [{ account: "bank_clearing", side: "debit", amount: cash }, ...(tds ? [{ account: "tds_receivable", side: "debit", amount: tds }] : []), { account: "co_lending_servicing_fee_income", side: "credit", amount: fee }, ...(gst ? [{ account: "output_gst_payable", side: "credit", amount: gst }] : [])], debitTotal: money(cash + tds), creditTotal: money(fee + gst) }; return [partnerJournal, originatorJournal];
  });
}

/**
 * Report each loan's ECL (expected credit loss) provision, split across
 * co-lending partners by their share, for one arrangement as of an
 * optional cutoff date.
 * @param {object} state - holds `eclProvisions`, `loanAccounts`.
 * @param {string} arrangementId
 * @param {string|null} [asOf] - ISO date (yyyy-mm-dd); only provisions on or before this date are included.
 * @returns {object} per-provision-per-partner rows plus arrangement totals.
 * @throws {Error} if the arrangement doesn't exist.
 */
export function buildCoLendingProvisionReport(state, arrangementId, asOf = null) {
  const arrangement = state.coLendingArrangements?.[arrangementId];
  if (!arrangement) throw new Error("Co-lending arrangement not found.");
  const rows = Object.values(state.eclProvisions ?? {}).filter((record) => {
    const account = state.loanAccounts?.[record.loanAccountId];
    return account?.coLendingAllocation?.coLendingArrangementId === arrangementId && (!asOf || record.asOf.slice(0, 10) <= asOf);
  }).flatMap((record) => splitProvisionRecord(state.loanAccounts[record.loanAccountId], record));
  return { coLendingArrangementId: arrangementId, asOf, rowCount: rows.length, expectedCreditLoss: money(rows.reduce((sum, row) => sum + row.expectedCreditLoss, 0)), movementAmount: money(rows.reduce((sum, row) => sum + row.movementAmount, 0)), rows };
}

/**
 * Project every ECL provision movement (increase or decrease from the
 * prior provision) into per-partner journals, debiting/crediting ECL
 * expense against the loss-allowance account depending on the direction of
 * movement.
 * @param {object} state - holds `eclProvisions`, `loanAccounts`.
 * @returns {Array<object>} one journal entry per provision-record-per-partner.
 */
export function buildCoLendingProvisionJournals(state) {
  return Object.values(state.eclProvisions ?? {}).flatMap((record) => {
    const account = state.loanAccounts?.[record.loanAccountId];
    if (!account?.coLendingAllocation) return [];
    return splitProvisionRecord(account, record).map((row) => { const increase = row.movementAmount >= 0; const amount = Math.abs(row.movementAmount); return { journalId: `jrnl_${record.provisionId}:${row.regulatedEntityId}`, loanAccountId: record.loanAccountId, eventId: record.provisionId, eventType: "co_lending_ecl_provision_movement", eventDate: record.asOf, currency: "INR", entityId: row.regulatedEntityId, partnerRole: row.role, coLendingArrangementId: account.coLendingAllocation.coLendingArrangementId, allocationId: account.coLendingAllocation.allocationId, book: "co_lending_entity", lines: [{ account: increase ? "ecl_expense" : "ecl_loss_allowance", side: "debit", amount }, { account: increase ? "ecl_loss_allowance" : "ecl_expense", side: "credit", amount }], debitTotal: amount, creditTotal: amount }; });
  });
}

/**
 * Create a GST/TDS tax-exchange record for a partner's taxable servicing
 * fee on a settled leg. Fails closed unless the leg has a positive
 * servicing fee, invoice/GSTIN/place-of-supply/TDS-section identifiers are
 * present, and proposer/approver are independent. The tax figures
 * (`taxableValue`, `gstAmount`, `tdsAmount`) are taken directly from the
 * statement leg, not recomputed — this record only packages them for
 * exchange with the partner, it does not recalculate tax.
 * @param {object} statement - existing settlement statement with the taxable leg.
 * @param {object} input - regulatedEntityId, taxExchangeId, invoiceNumber, supplierGstin, recipientGstin, placeOfSupply, tdsSection, proposedBy, approvedBy, approvalRef.
 * @param {Date} [now]
 * @returns {{taxExchange: object|null, findings: Array<object>, summary: object}}
 */
export function createCoLendingTaxExchange(statement, input, now = new Date()) {
  const findings = []; const leg = statement?.partnerLegs?.find((row) => row.regulatedEntityId === input?.regulatedEntityId && row.role === "partner");
  if (!statement || !leg || leg.servicingFee <= 0) findings.push(createFinding("error", "GST-ACT-2017", "A statement partner leg with a taxable servicing fee is required.", "regulatedEntityId"));
  if (!input?.taxExchangeId || !input?.invoiceNumber || !input?.supplierGstin || !input?.recipientGstin || !input?.placeOfSupply || !input?.tdsSection) findings.push(createFinding("error", "GST-ACT-2017", "Tax exchange, invoice, GSTIN, place-of-supply, and TDS section identifiers are required.", "taxExchange"));
  if (!input?.proposedBy || !input?.approvedBy || input.proposedBy === input.approvedBy || !input?.approvalRef) findings.push(createFinding("error", "RBI-IT-GRC", "Independent tax exchange approval is required.", "approval"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { taxExchange: null, findings, summary };
  const immutable = { taxExchangeId: input.taxExchangeId, statementId: statement.statementId, coLendingArrangementId: statement.coLendingArrangementId, regulatedEntityId: leg.regulatedEntityId, invoiceNumber: input.invoiceNumber, supplierGstin: input.supplierGstin, recipientGstin: input.recipientGstin, placeOfSupply: input.placeOfSupply, taxableValue: leg.servicingFee, gstRateBps: leg.servicingGstRateBps, gstAmount: leg.servicingGst, tdsSection: input.tdsSection, tdsRateBps: leg.servicingTdsRateBps, tdsAmount: leg.servicingTds, grossInvoiceAmount: money(leg.servicingFee + leg.servicingGst), netServiceConsideration: leg.serviceDeduction, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  return { taxExchange: { ...immutable, checksumSha256: createHash("sha256").update(JSON.stringify(immutable)).digest("hex"), status: "pending_partner_acknowledgement", approvedAt: now.toISOString(), acknowledgement: null }, findings, summary };
}

/**
 * Record the partner's acknowledgement of a tax exchange. Accepted only if
 * the partner's own checksum, GST amount, and TDS amount (to the paisa)
 * exactly match what was sent — any discrepancy (including a merely-
 * malformed acknowledgement, `blocked: true`) resolves to `"rejected"`
 * rather than silently accepting a partial or divergent confirmation.
 * @param {object} taxExchange - existing `"pending_partner_acknowledgement"` tax exchange.
 * @param {object} input - acknowledgementRef, status, checksumSha256, gstAmount, tdsAmount, recordedBy.
 * @param {Date} [now]
 * @returns {{taxExchange: object, accepted: boolean, blocked: boolean}}
 */
export function acknowledgeCoLendingTaxExchange(taxExchange, input, now = new Date()) {
  const exact = input?.status === "accepted" && input?.checksumSha256 === taxExchange?.checksumSha256 && paise(input?.gstAmount) === paise(taxExchange?.gstAmount) && paise(input?.tdsAmount) === paise(taxExchange?.tdsAmount);
  const acknowledgement = { acknowledgementRef: input?.acknowledgementRef ?? null, providerStatus: input?.status ?? null, checksumSha256: input?.checksumSha256 ?? null, gstAmount: input?.gstAmount ?? null, tdsAmount: input?.tdsAmount ?? null, recordedBy: input?.recordedBy ?? null, acknowledgedAt: now.toISOString() };
  if (!input?.acknowledgementRef || !input?.recordedBy || !["accepted", "rejected"].includes(input?.status)) return { taxExchange, accepted: false, blocked: true };
  return { taxExchange: { ...taxExchange, status: exact ? "accepted" : "rejected", acknowledgement }, accepted: exact, blocked: false };
}

// Split one ECL provision record's expected-loss and prior-provision
// amounts across an account's co-lending legs by share, deriving each
// partner's movement (this period's expected loss minus its prior
// provision) for journaling.
function splitProvisionRecord(account, record) {
  const legs = orderedLegs(account.coLendingAllocation.legs); const expected = splitPaise(paise(record.expectedCreditLoss), legs, "sharePercent"); const prior = splitPaise(paise(record.priorProvisionAmount), legs, "sharePercent");
  return legs.map((leg) => ({ provisionId: record.provisionId, loanAccountId: record.loanAccountId, coLendingArrangementId: account.coLendingAllocation.coLendingArrangementId, regulatedEntityId: leg.regulatedEntityId, role: leg.role, sharePercent: leg.sharePercent, stage: record.stage, assetClass: record.assetClass, asOf: record.asOf, expectedCreditLoss: expected.get(leg.regulatedEntityId) / 100, priorProvisionAmount: prior.get(leg.regulatedEntityId) / 100, movementAmount: (expected.get(leg.regulatedEntityId) - prior.get(leg.regulatedEntityId)) / 100 }));
}

// Put the originating partner last, so splitPaise's remainder-absorption
// lands on the originator rather than a lending partner.
function orderedLegs(legs = []) { return [...legs].sort((left, right) => (left.role === "originating" ? 1 : 0) - (right.role === "originating" ? 1 : 0)); }
// Partition an integer-paise total across legs by their share field
// (falling back to sharePercent); the last leg absorbs whatever rounding
// remainder is left so the split always sums exactly to totalPaise.
function splitPaise(totalPaise, legs, shareField) { let allocated = 0; const values = new Map(); for (let index = 0; index < legs.length; index += 1) { const leg = legs[index]; const value = index === legs.length - 1 ? totalPaise - allocated : Math.round((totalPaise * Number(leg[shareField] ?? leg.sharePercent)) / 100); if (index !== legs.length - 1) allocated += value; values.set(leg.regulatedEntityId, value); } return values; }
function sumPartnerRows(rows) { const fields = ["allocatedPrincipal", "openingPrincipal", "closingPrincipal", "principalCollected", "interestCollected", "feesCollected", "grossCollections", "servicingFee", "servicingGst", "servicingTds", "serviceDeduction", "netPayable", "transferPricingCost", "contributionMargin"]; return Object.fromEntries(fields.map((field) => [field, money(rows.reduce((sum, row) => sum + row[field], 0))])); }
