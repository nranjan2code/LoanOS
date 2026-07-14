const toPaise = (value) => Math.round(Number(value ?? 0) * 100);
const money = (paise) => paise / 100;
const DAY_MS = 86400000;

export function buildAlmReport(state, asOf = new Date()) {
  const buckets = [{ key: "0_30", max: 30 }, { key: "31_90", max: 90 }, { key: "91_180", max: 180 }, { key: "181_365", max: 365 }, { key: "over_365", max: Infinity }];
  const inflows = Object.fromEntries(buckets.map((bucket) => [bucket.key, 0]));
  for (const account of Object.values(state.loanAccounts ?? {})) for (const installment of account.schedule ?? []) {
    const days = Math.ceil((new Date(`${installment.dueDate}T00:00:00.000Z`) - asOf) / DAY_MS); if (days < 0) continue;
    const bucket = buckets.find((candidate, index) => days <= candidate.max && (index === 0 || days > buckets[index - 1].max));
    if (bucket) inflows[bucket.key] += toPaise(installment.totalDue);
  }
  const outflows = Object.fromEntries(buckets.map((bucket) => [bucket.key, 0]));
  for (const facility of Object.values(state.fundingFacilities ?? {})) {
    const days = Math.ceil((new Date(`${facility.maturityDate}T00:00:00.000Z`) - asOf) / DAY_MS); if (days < 0) continue;
    const bucket = buckets.find((candidate, index) => days <= candidate.max && (index === 0 || days > buckets[index - 1].max));
    if (bucket) outflows[bucket.key] += toPaise(facility.outstandingAmount);
  }
  const rows = buckets.map(({ key }) => ({ bucket: key, inflows: money(inflows[key]), outflows: money(outflows[key]), gap: money(inflows[key] - outflows[key]), cumulativeGap: 0 }));
  let cumulative = 0; for (const row of rows) { cumulative += toPaise(row.gap); row.cumulativeGap = money(cumulative); }
  return { asOf: asOf.toISOString(), currency: "INR", rows };
}

export function buildProfitabilityReport(state, asOf = new Date(), economicCapitalBps = 1000) {
  const allocations = Object.values(state.loanFundingAllocations ?? {}); const facilities = state.fundingFacilities ?? {};
  const rows = Object.values(state.loanAccounts ?? {}).map((account) => {
    const ledger = (account.ledger ?? []).filter((event) => new Date(event.eventDate) <= asOf);
    const interestIncome = money(ledger.reduce((sum, event) => sum + toPaise(event.interestCredit), 0));
    const feeIncome = money(ledger.filter((event) => event.type === "charge_assessed").reduce((sum, event) => sum + toPaise(event.baseAmount ?? event.amount), 0));
    const provision = Object.values(state.eclProvisions ?? {}).filter((item) => item.loanAccountId === account.loanAccountId).sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
    let fundingCostPaise = 0;
    for (const allocation of allocations.filter((item) => item.loanAccountId === account.loanAccountId)) { const facility = facilities[allocation.facilityId]; if (!facility) continue; const days = Math.max(0, Math.ceil((asOf - new Date(allocation.allocatedAt)) / DAY_MS)); fundingCostPaise += Math.round(toPaise(allocation.amount) * facility.annualCostBps * days / 3650000); }
    const creditLoss = provision?.expectedCreditLoss ?? 0; const fundingCost = money(fundingCostPaise); const netContribution = money(toPaise(interestIncome + feeIncome - fundingCost - creditLoss));
    const economicCapital = money(Math.round(toPaise(account.principalAmount) * economicCapitalBps / 10000)); const rarocPct = economicCapital > 0 ? Math.round(netContribution / economicCapital * 10000) / 100 : null;
    return { loanAccountId: account.loanAccountId, productCode: account.productCode, interestIncome, feeIncome, fundingCost, creditLoss, netContribution, economicCapital, rarocPct };
  });
  return { asOf: asOf.toISOString(), economicCapitalBps, rows };
}

export function buildManagementFinanceJournals(state) {
  return Object.values(state.eirAmortizations ?? {}).map((record) => ({ journalId: `jrnl_${record.amortizationId}`, loanAccountId: record.loanAccountId, eventId: record.amortizationId, eventType: "eir_fee_amortization", eventDate: record.periodEnd, currency: "INR", lines: [{ account: "deferred_origination_fee", side: "debit", amount: record.amortizedAmount }, { account: "interest_income", side: "credit", amount: record.amortizedAmount }], debitTotal: record.amortizedAmount, creditTotal: record.amortizedAmount }));
}
