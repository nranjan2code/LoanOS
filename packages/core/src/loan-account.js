import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";
import { decomposeGstInclusive } from "./tax.js";
import { generateContractualSchedule } from "./repayment-schedule.js";

const ACTIVE_STATUS = "active";
const CLOSED_STATUS = "closed";

export function generateRepaymentSchedule(input) {
  return generateContractualSchedule(input);
}

export function createLoanAccountFromApplication(application, disbursement, now = new Date()) {
  const findings = [];

  if (application.status !== "disbursed") {
    findings.push(createFinding("error", "RBI-DL-2025", "Application must be disbursed before creating a loan account.", "status"));
  }
  if (application.loanAccountId) {
    findings.push(createFinding("error", "RBI-DL-2025", "Application already has a loan account.", "loanAccountId"));
  }

  const principalAmount = application.kfs?.principalAmount ?? application.product?.requestedAmount;
  const tenorMonths = application.kfs?.tenorMonths ?? application.product?.requestedTenorMonths;
  const annualInterestRateBps = application.kfs?.annualInterestRateBps ?? application.product?.annualInterestRateBps ?? 0;
  const facilityType = application.kfs?.facilityType ?? application.product?.facilityType ?? "term_loan";
  const isRevolving = ["revolving_credit", "overdraft"].includes(facilityType);
  const creditLimit = application.kfs?.facilityTerms?.creditLimit ?? application.product?.creditLimit;
  if (isRevolving && (!Number.isFinite(creditLimit) || creditLimit <= 0 || principalAmount > creditLimit)) findings.push(createFinding("error", "RBI-DL-2025", "Revolving initial draw must be within the approved credit limit.", "creditLimit"));
  const scheduleResult = isRevolving ? { schedule: [], findings: [], summary: summarizeFindings([]) } : generateRepaymentSchedule({
    principalAmount,
    annualInterestRateBps,
    tenorMonths,
    startDate: disbursement.disbursedAt ?? now.toISOString(),
    repaymentFrequency: application.kfs?.repaymentFrequency ?? application.product?.repaymentFrequency ?? "monthly",
    repaymentStructure: application.kfs?.repaymentStructure ?? application.product?.repaymentStructure ?? "amortizing",
    moratoriumPeriods: application.kfs?.moratoriumPeriods ?? application.product?.moratoriumPeriods ?? 0,
    moratoriumInterestTreatment: application.kfs?.moratoriumInterestTreatment ?? application.product?.moratoriumInterestTreatment ?? "serviced",
    stepUpBps: application.kfs?.stepUpBps ?? application.product?.stepUpBps ?? 0,
    stepUpEveryPeriods: application.kfs?.stepUpEveryPeriods ?? application.product?.stepUpEveryPeriods
  });
  findings.push(...scheduleResult.findings);

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      loanAccount: null,
      findings,
      summary
    };
  }

  const loanAccountId = createLoanId("acct");
  const disbursementEvent = {
    eventId: createLoanId("ledger"),
    type: isRevolving ? "revolving_drawdown" : "disbursement",
    eventDate: disbursement.disbursedAt ?? now.toISOString(),
    amount: roundMoney(principalAmount),
    principalDebit: roundMoney(principalAmount),
    principalCredit: 0,
    interestCredit: 0,
    chargesDebit: 0,
    chargesCredit: 0,
    chargesWaiverCredit: 0,
    paymentRef: disbursement.disbursementId ?? null,
    actor: disbursement.actor ?? "system"
  };
  const loanAccount = {
    loanAccountId,
    applicationId: application.applicationId,
    borrowerId: application.borrower?.borrowerId ?? application.borrowerId ?? null,
    regulatedEntityId: application.regulatedEntityId ?? null,
    productId: application.productId ?? application.product?.productId ?? null,
    productCode: application.product?.productCode ?? null,
    accountingProfile: application.product?.accountingProfile ?? null,
    paymentAllocationWaterfall: application.product?.paymentAllocationWaterfall ?? ["interest", "charges", "principal"],
    status: ACTIVE_STATUS,
    currency: application.kfs?.currency ?? application.product?.currency ?? "INR",
    principalAmount: roundMoney(principalAmount),
    annualInterestRateBps,
    aprBps: application.kfs?.aprBps ?? application.product?.aprBps ?? annualInterestRateBps,
    tenorMonths,
    repaymentFrequency: application.kfs?.repaymentFrequency ?? application.product?.repaymentFrequency ?? "monthly",
    repaymentStructure: application.kfs?.repaymentStructure ?? application.product?.repaymentStructure ?? "amortizing",
    moratoriumPeriods: application.kfs?.moratoriumPeriods ?? application.product?.moratoriumPeriods ?? 0,
    moratoriumInterestTreatment: application.kfs?.moratoriumInterestTreatment ?? application.product?.moratoriumInterestTreatment ?? "serviced",
    stepUpBps: application.kfs?.stepUpBps ?? application.product?.stepUpBps ?? 0,
    stepUpEveryPeriods: application.kfs?.stepUpEveryPeriods ?? application.product?.stepUpEveryPeriods ?? null,
    facilityType,
    creditLimit: isRevolving ? roundMoney(application.kfs?.facilityTerms?.creditLimit ?? application.product?.creditLimit ?? principalAmount) : null,
    drawingPower: isRevolving ? roundMoney(application.kfs?.facilityTerms?.drawingPower ?? application.product?.drawingPower ?? application.product?.creditLimit ?? principalAmount) : null,
    minimumPaymentPercent: isRevolving ? (application.kfs?.facilityTerms?.minimumPaymentPercent ?? application.product?.minimumPaymentPercent ?? 5) : null,
    reviewFrequencyMonths: isRevolving ? (application.kfs?.facilityTerms?.reviewFrequencyMonths ?? application.product?.reviewFrequencyMonths ?? 12) : null,
    facilityExpiryDate: isRevolving ? (application.kfs?.facilityTerms?.facilityExpiryDate ?? application.product?.facilityExpiryDate ?? addMonthsUtc(now, tenorMonths).toISOString().slice(0, 10)) : null,
    coolingOffDays: application.kfs?.coolingOffDays ?? application.product?.coolingOffDays ?? 1,
    openedAt: now.toISOString(),
    disbursedAt: disbursement.disbursedAt ?? now.toISOString(),
    disclosedChargeCatalog: normalizeChargeCatalog(application.kfs),
    schedule: scheduleResult.schedule,
    ledger: [disbursementEvent],
    interestRateType: application.kfs?.interestRateType ?? application.product?.interestRateType ?? "fixed",
    borrowerType: application.borrower?.borrowerType ?? "individual",
    productType: application.product?.productType ?? null,
    prepaymentPolicy: application.kfs?.prepaymentPolicy ?? application.product?.prepaymentPolicy ?? { allowed: true, chargeBps: 0, lockInMonths: 0 },
    foreclosurePolicy: application.kfs?.foreclosurePolicy ?? application.product?.foreclosurePolicy ?? { allowed: true, chargeBps: 0, lockInMonths: 0 },
    interestRateResetPolicy: application.kfs?.interestRateResetPolicy ?? application.product?.interestRateResetPolicy ?? null
  };

  return {
    loanAccount,
    findings,
    summary
  };
}

export function summarizeLoanAccount(account, asOf = new Date()) {
  const ledger = (Array.isArray(account?.ledger) ? account.ledger : []).filter(
    (event) => new Date(event.eventDate).getTime() <= asOf.getTime()
  );
  const principalDisbursed = sumMoney(ledger, (event) => event.principalDebit);
  const principalPaid = sumMoney(ledger, (event) => event.principalCredit);
  const interestPaid = sumMoney(ledger, (event) => event.interestCredit);
  const interestAccrued = sumMoney(ledger, (event) => event.interestDebit);
  const chargesAssessed = sumMoney(ledger, (event) => event.chargesDebit);
  const chargesWaived = sumMoney(ledger, (event) => event.chargesWaiverCredit);
  const chargesPaid = sumMoney(ledger, (event) => event.chargesCredit);
  // Principal and interest waived (e.g. a settlement sacrifice) reduce what is
  // owed without counting as cash paid, so payoff figures stay honest.
  const principalWaived = sumMoney(ledger, (event) => event.principalWaiverCredit);
  const interestWaived = sumMoney(ledger, (event) => event.interestWaiverCredit);
  const totalPaid = roundMoney(principalPaid + interestPaid + chargesPaid);
  const principalOutstanding = roundMoney(Math.max(0, principalDisbursed - principalPaid - principalWaived));
  const dueInstallmentsAsOf = (account.schedule ?? []).filter(
    (installment) => new Date(`${installment.dueDate}T00:00:00.000Z`).getTime() <= asOf.getTime()
  );
  const scheduledInterestDueAsOf = sumMoney(dueInstallmentsAsOf, (installment) => installment.interestDue);
  const interestDueAsOf = roundMoney(Math.max(scheduledInterestDueAsOf, interestAccrued));
  const principalDueAsOf = sumMoney(dueInstallmentsAsOf, (installment) => installment.principalDue);
  const interestOutstanding = roundMoney(Math.max(0, interestDueAsOf - interestPaid - interestWaived));
  const chargesOutstanding = roundMoney(Math.max(0, chargesAssessed - chargesWaived - chargesPaid));
  const principalOverdue = roundMoney(Math.max(0, principalDueAsOf - principalPaid - principalWaived));
  const nextInstallment = (account.schedule ?? []).find(
    (installment) => new Date(`${installment.dueDate}T00:00:00.000Z`).getTime() > asOf.getTime()
  ) ?? null;

  return {
    principalDisbursed,
    principalPaid,
    interestPaid,
    interestAccrued,
    interestDueAsOf,
    interestAccrualReconciled: Math.abs(interestAccrued - interestDueAsOf) < 0.005,
    chargesAssessed,
    chargesWaived,
    chargesPaid,
    principalWaived,
    interestWaived,
    totalPaid,
    principalOutstanding,
    interestOutstanding,
    chargesOutstanding,
    principalOverdue,
    totalOutstanding: roundMoney(principalOutstanding + interestOutstanding + chargesOutstanding),
    facility: ["revolving_credit", "overdraft"].includes(account.facilityType) ? { facilityType: account.facilityType, creditLimit: account.creditLimit, drawingPower: account.drawingPower, utilizedAmount: principalOutstanding, availableAmount: roundMoney(Math.max(0, Math.min(account.creditLimit, account.drawingPower) - principalOutstanding)), minimumPaymentDue: roundMoney(interestOutstanding + chargesOutstanding + (principalOutstanding * account.minimumPaymentPercent) / 100), expiryDate: account.facilityExpiryDate } : null,
    nextDue: nextInstallment
      ? {
          dueDate: nextInstallment.dueDate,
          amount: nextInstallment.totalDue,
          principalDue: nextInstallment.principalDue,
          interestDue: nextInstallment.interestDue
        }
      : null
  };
}

// Recognize scheduled interest income as immutable ledger events once each
// installment period closes, so accrued interest can be reconstructed from the
// ledger rather than only implied by the schedule. Idempotent: an installment
// already carrying an accrual event is not accrued again, so it is safe to run
// repeatedly (e.g. on a daily job) as due dates pass.
export function accrueInterest(account, input = {}, now = new Date()) {
  const findings = [];
  const asOf = input.asOf ? new Date(input.asOf) : now;

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account && account.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Interest accrual requires an active loan account.", "status"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      loanAccount: account,
      accrualEvents: [],
      findings,
      summary
    };
  }

  const alreadyAccrued = new Set(
    (account.ledger ?? [])
      .filter((event) => event.type === "interest_accrual" && Number.isFinite(event.installmentNumber))
      .map((event) => event.installmentNumber)
  );

  const accrualEvents = (account.schedule ?? [])
    .filter(
      (installment) =>
        installment.interestDue > 0 &&
        !alreadyAccrued.has(installment.installmentNumber) &&
        new Date(`${installment.dueDate}T00:00:00.000Z`).getTime() <= asOf.getTime()
    )
    .map((installment) => ({
      eventId: createLoanId("ledger"),
      type: "interest_accrual",
      eventDate: `${installment.dueDate}T00:00:00.000Z`,
      amount: roundMoney(installment.interestDue),
      principalDebit: 0,
      principalCredit: 0,
      interestDebit: roundMoney(installment.interestDue),
      interestCredit: 0,
      chargesDebit: 0,
      chargesCredit: 0,
      chargesWaiverCredit: 0,
      installmentNumber: installment.installmentNumber,
      accruedThrough: installment.dueDate,
      actor: input.actor ?? "system"
    }));

  const updated = accrualEvents.length
    ? {
        ...account,
        ledger: [...(account.ledger ?? []), ...accrualEvents],
        updatedAt: now.toISOString()
      }
    : account;

  return {
    loanAccount: updated,
    accrualEvents,
    findings,
    summary
  };
}

export function drawRevolvingCredit(account, input = {}, now = new Date()) {
  const findings = []; const drawnAt = input.drawnAt ? new Date(input.drawnAt) : now;
  if (!account || account.status !== ACTIVE_STATUS || !["revolving_credit", "overdraft"].includes(account?.facilityType)) findings.push(createFinding("error", "RBI-DL-2025", "An active revolving or overdraft facility is required.", "facilityType"));
  if (Number.isNaN(drawnAt.getTime())) findings.push(createFinding("error", "RBI-IT-GRC", "drawnAt must be a valid timestamp.", "drawnAt"));
  if (!Number.isFinite(input.amount) || input.amount <= 0 || Math.abs(input.amount * 100 - Math.round(input.amount * 100)) >= 1e-8) findings.push(createFinding("error", "RBI-DL-2025", "Draw amount must be positive and paise-exact.", "amount"));
  if (!input.drawdownId || !input.destinationAccountRef || !input.proposedBy || !input.approvedBy || input.proposedBy === input.approvedBy || !input.approvalRef) findings.push(createFinding("error", "RBI-IT-GRC", "Drawdown ID, destination, and independent approval are required.", "approval"));
  if (!Number.isNaN(drawnAt.getTime()) && account?.facilityExpiryDate && drawnAt.getTime() > new Date(`${account.facilityExpiryDate}T23:59:59.999Z`).getTime()) findings.push(createFinding("error", "RBI-DL-2025", "Facility has expired and cannot be drawn.", "facilityExpiryDate"));
  if ((account?.ledger ?? []).some((event) => event.drawdownId === input.drawdownId)) findings.push(createFinding("error", "RBI-IT-GRC", "drawdownId already exists.", "drawdownId"));
  const balance = account ? summarizeLoanAccount(account, drawnAt) : null; const available = balance?.facility?.availableAmount ?? 0;
  if (Number.isFinite(input.amount) && input.amount > available) findings.push(createFinding("error", "RBI-DL-2025", "Draw exceeds the lower of sanctioned limit and current drawing power.", "amount"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { loanAccount: account, drawdownEvent: null, findings, summary };
  const drawdownEvent = { eventId: createLoanId("ledger"), type: "revolving_drawdown", eventDate: drawnAt.toISOString(), amount: roundMoney(input.amount), principalDebit: roundMoney(input.amount), principalCredit: 0, interestCredit: 0, chargesDebit: 0, chargesCredit: 0, chargesWaiverCredit: 0, drawdownId: input.drawdownId, destinationAccountRef: input.destinationAccountRef, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, actor: input.approvedBy };
  return { loanAccount: { ...account, ledger: [...account.ledger, drawdownEvent], updatedAt: now.toISOString() }, drawdownEvent, findings, summary };
}

export function accrueRevolvingInterest(account, input = {}, now = new Date()) {
  const findings = []; const start = new Date(`${input.periodStart}T00:00:00.000Z`); const end = new Date(`${input.periodEnd}T00:00:00.000Z`); const days = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (!account || account.status !== ACTIVE_STATUS || !["revolving_credit", "overdraft"].includes(account?.facilityType)) findings.push(createFinding("error", "RBI-DL-2025", "An active revolving or overdraft facility is required.", "facilityType"));
  if (!input.accrualId || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || days <= 0) findings.push(createFinding("error", "RBI-IT-GRC", "accrualId and a valid positive interest period are required.", "period"));
  if ((account?.ledger ?? []).some((event) => event.accrualId === input.accrualId || (event.type === "revolving_interest_accrual" && event.periodStart === input.periodStart && event.periodEnd === input.periodEnd))) findings.push(createFinding("error", "RBI-IT-GRC", "Revolving interest period is already accrued.", "accrualId"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { loanAccount: account, accrualEvent: null, findings, summary };
  let balancePaiseDays = 0; const dailyBalances = [];
  for (let offset = 0; offset < days; offset += 1) { const day = new Date(start.getTime() + offset * 86400000); const dayBalance = summarizeLoanAccount(account, day).principalOutstanding; balancePaiseDays += toPaise(dayBalance); dailyBalances.push({ date: day.toISOString().slice(0, 10), utilizedAmount: dayBalance }); }
  const interestPaise = Math.round((balancePaiseDays * account.annualInterestRateBps) / 3650000); const accrualEvent = { eventId: createLoanId("ledger"), type: "revolving_interest_accrual", eventDate: end.toISOString(), amount: fromPaise(interestPaise), principalDebit: 0, principalCredit: 0, interestDebit: fromPaise(interestPaise), interestCredit: 0, chargesDebit: 0, chargesCredit: 0, chargesWaiverCredit: 0, accrualId: input.accrualId, periodStart: input.periodStart, periodEnd: input.periodEnd, days, balancePaiseDays, dailyBalances, annualInterestRateBps: account.annualInterestRateBps, actor: input.actor ?? "system" };
  return { loanAccount: { ...account, ledger: [...account.ledger, accrualEvent], updatedAt: now.toISOString() }, accrualEvent, findings, summary };
}

export function reviewRevolvingFacility(account, input = {}, now = new Date()) {
  const findings = []; const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : now; const expiryAt = new Date(`${input.facilityExpiryDate}T23:59:59.999Z`);
  if (!account || account.status !== ACTIVE_STATUS || !["revolving_credit", "overdraft"].includes(account?.facilityType)) findings.push(createFinding("error", "RBI-DL-2025", "An active revolving or overdraft facility is required.", "facilityType"));
  if (!input.reviewId || !Number.isFinite(input.creditLimit) || input.creditLimit <= 0 || !Number.isFinite(input.drawingPower) || input.drawingPower < 0 || input.drawingPower > input.creditLimit || !input.facilityExpiryDate || !input.proposedBy || !input.approvedBy || input.proposedBy === input.approvedBy || !input.approvalRef) findings.push(createFinding("error", "RBI-IT-GRC", "Review economics, expiry, and independent approval are required.", "review"));
  if (Number.isNaN(effectiveAt.getTime()) || Number.isNaN(expiryAt.getTime()) || expiryAt.getTime() < effectiveAt.getTime()) findings.push(createFinding("error", "RBI-DL-2025", "Review effective date and a non-expired facility expiry date are required.", "facilityExpiryDate"));
  if ((account?.facilityReviews ?? []).some((review) => review.reviewId === input.reviewId)) findings.push(createFinding("error", "RBI-IT-GRC", "reviewId already exists.", "reviewId"));
  const outstanding = account ? summarizeLoanAccount(account, effectiveAt).principalOutstanding : 0; if (Number.isFinite(input.drawingPower) && input.drawingPower < outstanding) findings.push(createFinding("error", "RBI-DL-2025", "Drawing power cannot be reduced below current utilization without an approved excess regularization workflow.", "drawingPower"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { loanAccount: account, review: null, findings, summary };
  const review = { reviewId: input.reviewId, priorCreditLimit: account.creditLimit, creditLimit: roundMoney(input.creditLimit), priorDrawingPower: account.drawingPower, drawingPower: roundMoney(input.drawingPower), facilityExpiryDate: input.facilityExpiryDate, effectiveAt: effectiveAt.toISOString(), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  return { loanAccount: { ...account, creditLimit: review.creditLimit, drawingPower: review.drawingPower, facilityExpiryDate: review.facilityExpiryDate, facilityReviews: [...(account.facilityReviews ?? []), review], updatedAt: now.toISOString() }, review, findings, summary };
}

export function computeDelinquency(account, asOf = new Date()) {
  if (["revolving_credit", "overdraft"].includes(account?.facilityType)) {
    const summary = summarizeLoanAccount(account, asOf); const accruals = (account.ledger ?? []).filter((event) => event.type === "revolving_interest_accrual" && new Date(event.eventDate).getTime() <= asOf.getTime()).sort((left, right) => left.eventDate.localeCompare(right.eventDate)); let paidInterestPaise = toPaise(summary.interestPaid); let earliest = null;
    for (const accrual of accruals) { const duePaise = toPaise(accrual.interestDebit); if (paidInterestPaise >= duePaise) paidInterestPaise -= duePaise; else { earliest = accrual; break; } }
    const dueDate = earliest?.periodEnd ?? null; const daysPastDue = dueDate ? Math.max(0, Math.floor((asOf.getTime() - new Date(`${dueDate}T00:00:00.000Z`).getTime()) / 86400000)) : 0;
    return { asOf: asOf.toISOString(), bucket: delinquencyBucket(daysPastDue), daysPastDue, earliestUnpaidDueDate: dueDate, overdueInstallmentCount: earliest ? accruals.length - accruals.indexOf(earliest) : 0, principalOverdue: 0, interestOutstanding: summary.interestOutstanding, chargesOutstanding: summary.chargesOutstanding, totalOverdue: roundMoney(summary.interestOutstanding + summary.chargesOutstanding) };
  }
  const dueInstallments = (account.schedule ?? []).filter(
    (installment) => new Date(`${installment.dueDate}T00:00:00.000Z`).getTime() <= asOf.getTime()
  );
  const summary = summarizeLoanAccount(account, asOf);
  let remainingPaidForSchedule = roundMoney(summary.principalPaid + summary.interestPaid);
  let earliestUnpaidInstallment = null;

  for (const installment of dueInstallments) {
    if (remainingPaidForSchedule >= installment.totalDue) {
      remainingPaidForSchedule = roundMoney(remainingPaidForSchedule - installment.totalDue);
      continue;
    }
    earliestUnpaidInstallment = installment;
    break;
  }

  const daysPastDue = earliestUnpaidInstallment
    ? Math.max(0, Math.floor((asOf.getTime() - new Date(`${earliestUnpaidInstallment.dueDate}T00:00:00.000Z`).getTime()) / 86400000))
    : 0;

  return {
    asOf: asOf.toISOString(),
    bucket: delinquencyBucket(daysPastDue),
    daysPastDue,
    earliestUnpaidDueDate: earliestUnpaidInstallment?.dueDate ?? null,
    overdueInstallmentCount: earliestUnpaidInstallment ? dueInstallments.length - dueInstallments.indexOf(earliestUnpaidInstallment) : 0,
    principalOverdue: summary.principalOverdue,
    interestOutstanding: summary.interestOutstanding,
    chargesOutstanding: summary.chargesOutstanding,
    totalOverdue: roundMoney(summary.principalOverdue + summary.interestOutstanding + summary.chargesOutstanding)
  };
}

export function classifyLoanAsset(account, asOf = new Date()) {
  const delinquency = computeDelinquency(account, asOf);
  const dpdAssetClass = assetClassFromDpd(delinquency.daysPastDue);
  const irac = applyIracUpgradeGuard(account, asOf, dpdAssetClass, delinquency);

  return {
    asOf: asOf.toISOString(),
    assetClass: irac.assetClass,
    dpdAssetClass,
    daysPastDue: delinquency.daysPastDue,
    delinquencyBucket: delinquency.bucket,
    isNpa: irac.assetClass === "npa",
    // RBI IRAC (Nov 2021): once NPA, upgrade to standard only after all
    // principal and interest arrears are cleared — not merely when DPD < 90.
    npaHeldForArrears: irac.held,
    restructured: Boolean(account.restructured),
    writtenOff: Boolean(account.writtenOff),
    basis: irac.held ? "irac_arrears_upgrade_guard" : "days_past_due",
    npaThresholdDays: 90,
    delinquency
  };
}

// Reconstruct the IRAC-compliant asset class purely from the schedule and
// ledger. An account that has ever been NPA cannot upgrade below NPA until its
// principal and interest arrears are fully cleared; a partial catch-up that
// only drops DPD below 90 keeps the account NPA (RBI IRAC clarification, Nov
// 2021). We replay the DPD-based class at every due/payment checkpoint up to
// asOf and thread that guard through the trajectory.
function applyIracUpgradeGuard(account, asOf, dpdAssetClassAtAsOf, delinquencyAtAsOf) {
  if (dpdAssetClassAtAsOf === "npa") {
    return { assetClass: "npa", held: false };
  }

  const asOfTime = asOf.getTime();
  const checkpointTimes = new Set();
  for (const installment of account.schedule ?? []) {
    const dueTime = new Date(`${installment.dueDate}T00:00:00.000Z`).getTime();
    // The due date itself, and the exact moment it would tip into NPA (91 DPD)
    // if still the earliest unpaid installment. Without the latter, an NPA
    // crossing that occurs between two ledger events would be missed.
    const npaCrossingTime = dueTime + 91 * 86400000;
    if (dueTime <= asOfTime) {
      checkpointTimes.add(dueTime);
    }
    if (npaCrossingTime <= asOfTime) {
      checkpointTimes.add(npaCrossingTime);
    }
  }
  for (const event of account.ledger ?? []) {
    if (event.type !== "payment" && event.type !== "cash_recovery_payment") {
      continue;
    }
    const time = new Date(event.eventDate).getTime();
    if (time <= asOfTime) {
      checkpointTimes.add(time);
    }
  }
  const ordered = [...checkpointTimes].sort((a, b) => a - b);

  let everNpa = false;
  for (const time of ordered) {
    if (time >= asOfTime) {
      break;
    }
    const priorDelinquency = computeDelinquency(account, new Date(time));
    if (assetClassFromDpd(priorDelinquency.daysPastDue) === "npa") {
      everNpa = true;
    } else if (everNpa && arrearsCleared(priorDelinquency)) {
      // Arrears fully cured before asOf: the NPA episode is closed and a fresh
      // one would require crossing 90 DPD again.
      everNpa = false;
    }
  }

  if (everNpa && !arrearsCleared(delinquencyAtAsOf)) {
    return { assetClass: "npa", held: true };
  }
  return { assetClass: dpdAssetClassAtAsOf, held: false };
}

// RBI IRAC upgrade test: entire arrears of principal AND interest paid. Charges
// alone do not hold an NPA classification.
function arrearsCleared(delinquency) {
  return roundMoney(delinquency.principalOverdue + delinquency.interestOutstanding) <= 0;
}

export function generateCicSnapshot(account, asOf = new Date()) {
  const summary = summarizeLoanAccount(account, asOf);
  const classification = classifyLoanAsset(account, asOf);
  const lastPayment = [...(account.ledger ?? [])]
    .filter((event) => ["payment", "cash_recovery_payment"].includes(event.type))
    .filter((event) => new Date(event.eventDate).getTime() <= asOf.getTime())
    .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())[0] ?? null;

  return {
    snapshotId: createLoanId("cic"),
    generatedAt: new Date().toISOString(),
    asOf: asOf.toISOString(),
    reportingPurpose: "credit_information_company_snapshot",
    loanAccountId: account.loanAccountId,
    applicationId: account.applicationId,
    borrowerId: account.borrowerId,
    regulatedEntityId: account.regulatedEntityId,
    productId: account.productId,
    productCode: account.productCode,
    accountStatus: account.status,
    currency: account.currency,
    facilityType: account.facilityType ?? "term_loan",
    repaymentStructure: account.repaymentStructure ?? "amortizing",
    facilitySnapshot: summarizeLoanAccount(account, asOf).facility,
    openedAt: account.openedAt,
    closedAt: account.closedAt ?? null,
    sanctionedAmount: account.principalAmount,
    currentBalance: summary.principalOutstanding,
    amountOverdue: classification.delinquency.totalOverdue,
    daysPastDue: classification.daysPastDue,
    assetClass: classification.assetClass,
    delinquencyBucket: classification.delinquencyBucket,
    isNpa: classification.isNpa,
    restructured: Boolean(account.restructured),
    restructuredAt: (account.restructures ?? []).at(-1)?.restructuredAt ?? null,
    closureType: account.closureType ?? (account.foreclosure ? "foreclosure" : null),
    settled: account.closureType === "settled",
    settlementSacrifice: account.settlement?.sacrificeAmount ?? null,
    writtenOff: Boolean(account.writtenOff),
    writeOffAmount: account.writeOff?.writeOffAmount ?? null,
    lastPaymentDate: lastPayment?.eventDate ?? null,
    lastPaymentAmount: lastPayment?.amount ?? null,
    totalPaid: summary.totalPaid,
    principalPaid: summary.principalPaid,
    interestPaid: summary.interestPaid,
    chargesPaid: summary.chargesPaid,
    nextDueDate: summary.nextDue?.dueDate ?? null,
    nextDueAmount: summary.nextDue?.amount ?? null
  };
}

export function assignRecoveryAgent(account, input, recoveryAgents = {}, now = new Date()) {
  const findings = [];
  const assignedAt = input?.assignedAt ? new Date(input.assignedAt) : now;
  const noticeSentAt = input?.noticeSentAt ? new Date(input.noticeSentAt) : null;
  const delinquency = account ? computeDelinquency(account, assignedAt) : null;
  const agent = input?.recoveryAgentId ? recoveryAgents[input.recoveryAgentId] : null;

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account?.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Recovery assignment requires an active loan account.", "status"));
  }
  if (!delinquency || delinquency.daysPastDue <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Recovery assignment requires a delinquent account.", "asOf"));
  }
  if (!input?.recoveryAgentId) {
    findings.push(createFinding("error", "RBI-DL-2025", "recoveryAgentId is required.", "recoveryAgentId"));
  } else if (!agent) {
    findings.push(createFinding("error", "RBI-DL-2025", "recoveryAgentId must reference an empanelled recovery agent.", "recoveryAgentId"));
  } else if (agent.status !== "active") {
    findings.push(createFinding("error", "RBI-DL-2025", "Recovery agent must be active to receive an assignment.", "recoveryAgentId"));
  }
  if (!input?.recoveryAgentName) {
    findings.push(createFinding("error", "RBI-DL-2025", "recoveryAgentName is required.", "recoveryAgentName"));
  }
  if (!input?.assignedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Recovery assignment requires assignedBy.", "assignedBy"));
  }
  if (!noticeSentAt) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower recovery-agent notice timestamp is required.", "noticeSentAt"));
  }
  if (!input?.noticeDeliveryRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower recovery-agent notice delivery reference is required.", "noticeDeliveryRef"));
  }
  if (noticeSentAt && noticeSentAt.getTime() > assignedAt.getTime()) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower recovery-agent notice must be sent no later than assignment.", "noticeSentAt"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      loanAccount: account,
      assignment: null,
      delinquency,
      findings,
      summary
    };
  }

  const assignment = {
    assignmentId: input.assignmentId ?? createLoanId("recovery"),
    recoveryAgentId: input.recoveryAgentId,
    recoveryAgentName: input.recoveryAgentName,
    agencyName: input.agencyName ?? null,
    assignedBy: input.assignedBy,
    assignedAt: assignedAt.toISOString(),
    noticeSentAt: noticeSentAt.toISOString(),
    noticeDeliveryRef: input.noticeDeliveryRef,
    status: "active",
    delinquencyAtAssignment: delinquency
  };
  const updated = {
    ...account,
    recoveryAssignments: [...(account.recoveryAssignments ?? []), assignment],
    servicingEvents: [
      ...(account.servicingEvents ?? []),
      {
        type: "recovery_agent_assigned",
        assignmentId: assignment.assignmentId,
        recoveryAgentId: assignment.recoveryAgentId,
        at: assignedAt.toISOString(),
        actor: assignment.assignedBy
      }
    ],
    updatedAt: now.toISOString()
  };

  return {
    loanAccount: updated,
    assignment,
    delinquency,
    findings,
    summary
  };
}

// A payment posting is a financial-effect event a client can legitimately
// retry (network timeout, gateway ambiguity). Every caller in this module —
// direct payment, cash recovery, foreclosure, part-prepayment, settlement —
// funnels through here with a caller-supplied paymentRef, so this is the one
// place a duplicate-post guard needs to live. A ledger event's paymentRef
// namespace is distinct from a disbursement's (a client never mints a
// disbursementId), so only prior *payment-family* events are checked.
const PAYMENT_FAMILY_LEDGER_TYPES = new Set(["payment", "cash_recovery_payment"]);

export function findDuplicatePaymentEvent(account, paymentRef) {
  if (!paymentRef) return null;
  return (
    (account?.ledger ?? []).find(
      (event) => PAYMENT_FAMILY_LEDGER_TYPES.has(event.type) && event.paymentRef === paymentRef
    ) ?? null
  );
}

export function postPaymentToLoanAccount(account, input, now = new Date()) {
  const findings = [];

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account?.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Payments can only be posted to active loan accounts.", "status"));
  }
  if (!Number.isFinite(input?.amount) || input.amount <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Payment amount must be positive.", "amount"));
  }
  if (!input?.paymentRef) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Payment reference is required.", "paymentRef"));
  }
  const duplicateEvent = account ? findDuplicatePaymentEvent(account, input?.paymentRef) : null;
  if (duplicateEvent) {
    findings.push(
      createFinding(
        "error",
        "RBI-IT-GRC",
        "A payment with this paymentRef has already been posted to this loan account; retry with a new reference or treat the original as successful.",
        "paymentRef"
      )
    );
  }

  const initialSummary = summarizeFindings(findings);
  if (initialSummary.status === "blocked") {
    return {
      loanAccount: account,
      paymentEvent: duplicateEvent ?? null,
      duplicate: Boolean(duplicateEvent),
      findings,
      summary: initialSummary
    };
  }

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : now;
  const balance = summarizeLoanAccount(account, receivedAt);
  let remaining = roundMoney(input.amount);
  const allocated = { interest: 0, charges: 0, principal: 0 };
  const outstanding = { interest: balance.interestOutstanding, charges: balance.chargesOutstanding, principal: balance.principalOutstanding };
  for (const component of account.paymentAllocationWaterfall ?? ["interest", "charges", "principal"]) {
    allocated[component] = roundMoney(Math.min(remaining, outstanding[component]));
    remaining = roundMoney(remaining - allocated[component]);
  }
  const interestCredit = allocated.interest;
  const chargesCredit = allocated.charges;
  const principalCredit = allocated.principal;
  const unappliedAmount = roundMoney(Math.max(0, remaining));

  const paymentEvent = {
    eventId: createLoanId("ledger"),
    type: "payment",
    eventDate: receivedAt.toISOString(),
    amount: roundMoney(input.amount),
    principalDebit: 0,
    principalCredit,
    interestCredit,
    chargesDebit: 0,
    chargesCredit,
    chargesWaiverCredit: 0,
    unappliedAmount,
    paymentRef: input.paymentRef,
    channel: input.channel ?? null,
    allocationWaterfall: [...(account.paymentAllocationWaterfall ?? ["interest", "charges", "principal"])],
    actor: input.actor ?? "system"
  };
  const updatedLedger = [...(account.ledger ?? []), paymentEvent];
  const revolving = ["revolving_credit", "overdraft"].includes(account.facilityType);
  const updated = {
    ...account,
    ledger: updatedLedger,
    status: !revolving && roundMoney(balance.principalOutstanding - principalCredit) === 0 ? CLOSED_STATUS : ACTIVE_STATUS,
    closedAt: !revolving && roundMoney(balance.principalOutstanding - principalCredit) === 0 ? receivedAt.toISOString() : account.closedAt ?? null,
    updatedAt: now.toISOString()
  };

  return {
    loanAccount: updated,
    paymentEvent,
    duplicate: false,
    findings,
    summary: summarizeFindings(findings)
  };
}

// Cash is an exception channel, not the default: RBI's Fair Practices Code
// expects repayment through traceable (digital/cheque/NACH) channels, so a
// cash collection must carry a coded justification plus a registered,
// role-checked internal approver — the same actor/reason/approver/timestamp/
// policy-reference shape used for waivers and reversals.
export const CASH_RECOVERY_EXCEPTION_REASONS = {
  no_digital_access: "Borrower or location lacks access to digital repayment",
  digital_payment_failed: "A digital repayment attempt failed at the time of collection",
  borrower_requested_cash: "Borrower requested cash settlement",
  field_recovery_drive: "Scheduled field recovery/collection drive",
  other: "Other (requires narrative)"
};
const CASH_RECOVERY_EXCEPTION_REASON_CODES = new Set(Object.keys(CASH_RECOVERY_EXCEPTION_REASONS));

export function postCashRecoveryToLoanAccount(account, input, now = new Date()) {
  const findings = [];
  const collectedAt = input?.collectedAt ? new Date(input.collectedAt) : null;
  const postedAt = input?.postedAt ? new Date(input.postedAt) : null;
  const activeAssignment = (account?.recoveryAssignments ?? []).find(
    (assignment) => assignment.recoveryAgentId === input?.recoveryAgentId && assignment.status === "active"
  );
  const delinquency = account && collectedAt ? computeDelinquency(account, collectedAt) : null;

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (!Number.isFinite(input?.amount) || input.amount <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Cash recovery amount must be positive.", "amount"));
  }
  if (!input?.receiptRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "Cash recovery receiptRef is required.", "receiptRef"));
  }
  if (!input?.recoveryAgentId) {
    findings.push(createFinding("error", "RBI-DL-2025", "Cash recovery requires recoveryAgentId.", "recoveryAgentId"));
  }
  if (!activeAssignment?.noticeSentAt || !activeAssignment?.noticeDeliveryRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "Cash recovery requires an active noticed recovery-agent assignment.", "recoveryAgentId"));
  }
  if (!collectedAt) {
    findings.push(createFinding("error", "RBI-DL-2025", "Cash recovery collectedAt is required.", "collectedAt"));
  }
  if (!postedAt) {
    findings.push(createFinding("error", "RBI-DL-2025", "Cash recovery postedAt is required.", "postedAt"));
  }
  if (collectedAt && postedAt && !sameIndiaDate(collectedAt, postedAt)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Cash recovery must be reflected in the borrower account on the same day.", "postedAt"));
  }
  if (!delinquency || delinquency.daysPastDue <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Cash recovery is allowed only for delinquent loan accounts.", "collectedAt"));
  }
  if (!input?.exceptionReason || !CASH_RECOVERY_EXCEPTION_REASON_CODES.has(input.exceptionReason)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Cash recovery requires a coded exceptionReason.", "exceptionReason"));
  } else if (input.exceptionReason === "other" && !input?.exceptionNarrative) {
    findings.push(createFinding("error", "RBI-DL-2025", "Cash recovery exceptionReason 'other' requires exceptionNarrative.", "exceptionNarrative"));
  }
  if (!input?.approvedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Cash recovery requires approvedBy.", "approvedBy"));
  }
  if (!input?.approvalRef) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Cash recovery requires approvalRef.", "approvalRef"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      loanAccount: account,
      paymentEvent: null,
      delinquency,
      findings,
      summary
    };
  }

  const paymentResult = postPaymentToLoanAccount(
    account,
    {
      amount: input.amount,
      receivedAt: postedAt.toISOString(),
      paymentRef: input.receiptRef,
      channel: "cash_recovery",
      actor: input.recoveryAgentId
    },
    now
  );
  if (paymentResult.summary.status === "blocked") {
    return {
      ...paymentResult,
      delinquency
    };
  }

  const paymentEvent = {
    ...paymentResult.paymentEvent,
    type: "cash_recovery_payment",
    collectedAt: collectedAt.toISOString(),
    postedAt: postedAt.toISOString(),
    receiptRef: input.receiptRef,
    recoveryAgentId: input.recoveryAgentId,
    assignmentId: activeAssignment.assignmentId,
    exceptionReason: input.exceptionReason,
    exceptionNarrative: input.exceptionNarrative ?? null,
    approvedBy: input.approvedBy,
    approvalRef: input.approvalRef
  };
  const updated = {
    ...paymentResult.loanAccount,
    ledger: paymentResult.loanAccount.ledger.map((event) =>
      event.eventId === paymentResult.paymentEvent.eventId ? paymentEvent : event
    ),
    servicingEvents: [
      ...(paymentResult.loanAccount.servicingEvents ?? []),
      {
        type: "cash_recovery_posted",
        eventId: paymentEvent.eventId,
        recoveryAgentId: input.recoveryAgentId,
        at: postedAt.toISOString()
      }
    ]
  };

  return {
    loanAccount: updated,
    paymentEvent,
    delinquency,
    findings,
    summary
  };
}

function calculateMonthsElapsed(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const years = end.getFullYear() - start.getFullYear();
  const months = end.getMonth() - start.getMonth();
  return years * 12 + months;
}

// Foreclosure lets a borrower settle early by paying outstanding principal plus
// interest and charges already due as of the foreclosure date. Future interest
// is not owed. Any foreclosure charge must be disclosed in the KFS to be
// applied, mirroring the KFS charge-disclosure control on ordinary charges.
export function quoteForeclosure(account, input = {}, now = new Date()) {
  const findings = [];
  const asOf = input.asOf ? new Date(input.asOf) : now;

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
    return { quote: null, findings, summary: summarizeFindings(findings) };
  }
  if (account.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Only an active loan account can be foreclosed.", "status"));
  }

  const balance = summarizeLoanAccount(account, asOf);

  let foreclosureCharge = 0;
  let disclosedChargeRef = null;
  if (input.foreclosureChargeName) {
    const disclosed = findDisclosedCharge(account.disclosedChargeCatalog ?? [], input.foreclosureChargeName);
    if (!disclosed) {
      findings.push(createFinding("error", "RBI-KFS-2024", "Foreclosure charge must be disclosed in KFS.", "foreclosureChargeName"));
    } else {
      foreclosureCharge = roundMoney(input.foreclosureChargeAmount ?? disclosed.amount ?? 0);
      disclosedChargeRef = disclosed.name;
      if (Number.isFinite(disclosed.amount) && foreclosureCharge > disclosed.amount) {
        findings.push(createFinding("error", "RBI-KFS-2024", `Foreclosure charge (${foreclosureCharge}) exceeds the disclosed KFS limit of ${disclosed.amount}.`, "foreclosureCharge"));
      }
    }
  }

  const foreclPolicy = account.foreclosurePolicy ?? { allowed: true, chargeBps: 0, lockInMonths: 0 };
  if (foreclPolicy.allowed === false) {
    findings.push(createFinding("error", "RBI-DL-2025", "Foreclosure is not allowed under product policy.", "foreclosurePolicy.allowed"));
  }
  if (foreclPolicy.lockInMonths > 0 && account.disbursedAt) {
    const monthsElapsed = calculateMonthsElapsed(account.disbursedAt, asOf);
    if (monthsElapsed < foreclPolicy.lockInMonths) {
      findings.push(createFinding("error", "RBI-DL-2025", `Foreclosure is blocked within the lock-in period of ${foreclPolicy.lockInMonths} months.`, "foreclosurePolicy.lockInMonths"));
    }
  }

  const rateType = account.interestRateType ?? "fixed";
  const bType = account.borrowerType ?? "individual";
  const isBusiness = account.productType === "business_loan" || account.productType === "msme_loan";
  if (rateType === "floating" && bType === "individual" && !isBusiness) {
    if (foreclosureCharge > 0 || (input.foreclosureChargeAmount ?? 0) > 0) {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Foreclosure charges are prohibited on floating-rate individual retail loans.", "foreclosureCharge"));
    }
  } else if (foreclPolicy.chargeBps > 0 && foreclosureCharge > 0) {
    const ceiling = fromPaise(Math.round((toPaise(balance.principalOutstanding) * foreclPolicy.chargeBps) / 10000));
    if (foreclosureCharge > ceiling) {
      findings.push(createFinding(
        "error",
        "RBI-KFS-2024",
        `Foreclosure charge (${foreclosureCharge}) exceeds the product policy ceiling of ${ceiling} (${foreclPolicy.chargeBps} bps of outstanding principal).`,
        "foreclosureCharge"
      ));
    }
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { quote: null, findings, summary };
  }

  return {
    quote: {
      asOf: asOf.toISOString(),
      principalOutstanding: balance.principalOutstanding,
      interestOutstanding: balance.interestOutstanding,
      chargesOutstanding: balance.chargesOutstanding,
      foreclosureCharge,
      disclosedChargeRef,
      // Exact integer-paise summation of already-rounded components (REV-20).
      payoffAmount: sumMoney(
        [
          balance.principalOutstanding,
          balance.interestOutstanding,
          balance.chargesOutstanding,
          foreclosureCharge
        ],
        (value) => value
      )
    },
    findings,
    summary
  };
}

export function forecloseLoanAccount(account, input = {}, now = new Date()) {
  const foreclosedAt = input.foreclosedAt ? new Date(input.foreclosedAt) : now;
  const quoteResult = quoteForeclosure(
    account,
    {
      asOf: foreclosedAt.toISOString(),
      foreclosureChargeName: input.foreclosureChargeName,
      foreclosureChargeAmount: input.foreclosureChargeAmount
    },
    now
  );
  const findings = [...quoteResult.findings];

  if (!input.paymentRef) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Foreclosure requires paymentRef.", "paymentRef"));
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Foreclosure amount must be positive.", "amount"));
  }
  if (quoteResult.quote && Number.isFinite(input.amount) && roundMoney(input.amount) < quoteResult.quote.payoffAmount) {
    findings.push(createFinding("error", "RBI-DL-2025", "Foreclosure amount must cover the full payoff.", "amount"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked" || !quoteResult.quote) {
    return { loanAccount: account, foreclosure: null, quote: quoteResult.quote, events: [], findings, summary };
  }

  const quote = quoteResult.quote;
  let working = account;
  const events = [];

  if (quote.foreclosureCharge > 0) {
    const chargeResult = assessChargeToLoanAccount(
      working,
      {
        name: input.foreclosureChargeName,
        reason: "Foreclosure charge disclosed in KFS",
        amount: quote.foreclosureCharge,
        assessedAt: foreclosedAt.toISOString(),
        actor: input.actor ?? "system"
      },
      now
    );
    if (chargeResult.summary.status === "blocked") {
      return { loanAccount: account, foreclosure: null, quote, events: [], findings: chargeResult.findings, summary: chargeResult.summary };
    }
    working = chargeResult.loanAccount;
    events.push(chargeResult.chargeEvent);
  }

  const paymentResult = postPaymentToLoanAccount(
    working,
    {
      amount: quote.payoffAmount,
      receivedAt: foreclosedAt.toISOString(),
      paymentRef: input.paymentRef,
      channel: input.channel ?? "foreclosure",
      actor: input.actor ?? "system"
    },
    now
  );
  if (paymentResult.summary.status === "blocked") {
    return { loanAccount: account, foreclosure: null, quote, events, findings: paymentResult.findings, summary: paymentResult.summary };
  }
  events.push(paymentResult.paymentEvent);

  const foreclosure = {
    foreclosureId: input.foreclosureId ?? createLoanId("foreclosure"),
    foreclosedAt: foreclosedAt.toISOString(),
    payoffAmount: quote.payoffAmount,
    principalSettled: quote.principalOutstanding,
    interestSettled: quote.interestOutstanding,
    chargesSettled: quote.chargesOutstanding,
    foreclosureCharge: quote.foreclosureCharge,
    paymentRef: input.paymentRef,
    actor: input.actor ?? "system"
  };
  const updated = {
    ...paymentResult.loanAccount,
    status: CLOSED_STATUS,
    closedAt: paymentResult.loanAccount.closedAt ?? foreclosedAt.toISOString(),
    foreclosure,
    servicingEvents: [
      ...(paymentResult.loanAccount.servicingEvents ?? []),
      {
        type: "loan_account.foreclosed",
        foreclosureId: foreclosure.foreclosureId,
        at: foreclosedAt.toISOString(),
        actor: foreclosure.actor
      }
    ]
  };

  return {
    loanAccount: updated,
    foreclosure,
    quote,
    events,
    findings: [],
    summary: summarizeFindings([])
  };
}

// On full repayment (scheduled or foreclosure) the borrower is entitled to a
// No-Objection Certificate confirming no dues remain and that the regulated
// entity has no objection to releasing any securities or documents held.
// Idempotent: a re-issue returns the certificate already on the account.
export function generateClosureCertificate(account, input = {}, now = new Date()) {
  const findings = [];

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account && account.status !== CLOSED_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "A closure certificate can only be issued for a closed loan account.", "status"));
  }

  const asOf = account?.closedAt ? new Date(account.closedAt) : now;
  const balance = account ? summarizeLoanAccount(account, asOf) : null;
  if (balance && balance.totalOutstanding > 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "A closure certificate requires zero outstanding dues.", "totalOutstanding"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { loanAccount: account, closureCertificate: null, reissued: false, findings, summary };
  }

  if (account.closureCertificate) {
    return {
      loanAccount: account,
      closureCertificate: account.closureCertificate,
      reissued: true,
      findings: [],
      summary: summarizeFindings([])
    };
  }

  const certificate = {
    certificateId: input.certificateId ?? createLoanId("noc"),
    documentType: "no_objection_certificate",
    loanAccountId: account.loanAccountId,
    applicationId: account.applicationId,
    borrowerId: account.borrowerId,
    regulatedEntityId: account.regulatedEntityId,
    productId: account.productId,
    productCode: account.productCode,
    currency: account.currency,
    sanctionedAmount: account.principalAmount,
    closureType: account.foreclosure ? "foreclosure" : "scheduled_closure",
    closedAt: account.closedAt,
    issuedAt: now.toISOString(),
    issuedBy: input.issuedBy ?? "system",
    principalRepaid: balance.principalPaid,
    interestPaid: balance.interestPaid,
    chargesPaid: balance.chargesPaid,
    totalPaid: balance.totalPaid,
    declarations: [
      "The borrower has repaid all amounts due under this loan account in full.",
      "No dues remain outstanding as of the closure date.",
      "The regulated entity has no objection to the release of any securities, documents, or charges held for this loan."
    ]
  };
  const closureCertificate = {
    ...certificate,
    checksumSha256: createHash("sha256").update(JSON.stringify(certificate)).digest("hex")
  };
  const updated = {
    ...account,
    closureCertificate,
    servicingEvents: [
      ...(account.servicingEvents ?? []),
      {
        type: "loan_account.closure_certificate_issued",
        certificateId: closureCertificate.certificateId,
        at: now.toISOString(),
        actor: closureCertificate.issuedBy
      }
    ],
    updatedAt: now.toISOString()
  };

  return { loanAccount: updated, closureCertificate, reissued: false, findings: [], summary };
}

// Part-prepayment lets a borrower pay down principal ahead of schedule. The
// payment clears any dues first, then reduces principal; the remaining schedule
// is rebuilt either to lower each EMI over the same remaining term
// (`reduce_emi`) or to keep the EMI and shorten the term (`reduce_tenure`).
export function prepayLoanAccount(account, input = {}, now = new Date()) {
  const findings = [];
  const mode = input.mode ?? "reduce_emi";
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : now;

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account && account.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Part-prepayment requires an active loan account.", "status"));
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Prepayment amount must be positive.", "amount"));
  }
  if (!input.paymentRef) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Prepayment requires paymentRef.", "paymentRef"));
  }
  if (!["reduce_emi", "reduce_tenure"].includes(mode)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Prepayment mode must be reduce_emi or reduce_tenure.", "mode"));
  }

  let prepaymentCharge = 0;
  let disclosedChargeRef = null;
  if (account && input.prepaymentChargeName) {
    const disclosed = findDisclosedCharge(account.disclosedChargeCatalog ?? [], input.prepaymentChargeName);
    if (!disclosed) {
      findings.push(createFinding("error", "RBI-KFS-2024", "Prepayment charge must be disclosed in KFS.", "prepaymentChargeName"));
    } else {
      prepaymentCharge = roundMoney(input.prepaymentChargeAmount ?? disclosed.amount ?? 0);
      disclosedChargeRef = disclosed.name;
      if (Number.isFinite(disclosed.amount) && prepaymentCharge > disclosed.amount) {
        findings.push(createFinding("error", "RBI-KFS-2024", `Prepayment charge (${prepaymentCharge}) exceeds the disclosed KFS limit of ${disclosed.amount}.`, "prepaymentCharge"));
      }
    }
  }

  if (account) {
    const prepayPolicy = account.prepaymentPolicy ?? { allowed: true, chargeBps: 0, lockInMonths: 0 };
    if (prepayPolicy.allowed === false) {
      findings.push(createFinding("error", "RBI-DL-2025", "Part-prepayment is not allowed under product policy.", "prepaymentPolicy.allowed"));
    }
    if (prepayPolicy.lockInMonths > 0 && account.disbursedAt) {
      const monthsElapsed = calculateMonthsElapsed(account.disbursedAt, receivedAt);
      if (monthsElapsed < prepayPolicy.lockInMonths) {
        findings.push(createFinding("error", "RBI-DL-2025", `Part-prepayment is blocked within the lock-in period of ${prepayPolicy.lockInMonths} months.`, "prepaymentPolicy.lockInMonths"));
      }
    }

    const rateType = account.interestRateType ?? "fixed";
    const bType = account.borrowerType ?? "individual";
    const isBusiness = account.productType === "business_loan" || account.productType === "msme_loan";
    if (rateType === "floating" && bType === "individual" && !isBusiness) {
      if (prepaymentCharge > 0 || (input.prepaymentChargeAmount ?? 0) > 0) {
        findings.push(createFinding("error", "RBI-FPC-PENAL", "Prepayment charges are prohibited on floating-rate individual retail loans.", "prepaymentCharge"));
      }
    } else if (prepayPolicy.chargeBps > 0 && prepaymentCharge > 0) {
      const balance = summarizeLoanAccount(account, receivedAt);
      const prepaidPrincipal = Math.max(0, input.amount - balance.interestOutstanding - balance.chargesOutstanding);
      const ceiling = roundMoney((prepaidPrincipal * prepayPolicy.chargeBps) / 10000);
      if (prepaymentCharge > ceiling) {
        findings.push(createFinding(
          "error",
          "RBI-KFS-2024",
          `Prepayment charge (${prepaymentCharge}) exceeds the product policy ceiling of ${ceiling} (${prepayPolicy.chargeBps} bps of prepaid principal).`,
          "prepaymentCharge"
        ));
      }
    }
  }

  const preSummary = summarizeFindings(findings);
  if (preSummary.status === "blocked" || !account) {
    return { loanAccount: account, paymentEvent: null, prepayment: null, schedule: account?.schedule ?? [], findings, summary: preSummary };
  }

  let workingAccount = account;
  if (prepaymentCharge > 0) {
    const chargeResult = assessChargeToLoanAccount(
      workingAccount,
      {
        name: input.prepaymentChargeName,
        reason: "Part-prepayment fee",
        amount: prepaymentCharge,
        assessedAt: receivedAt.toISOString(),
        actor: input.actor ?? "system"
      },
      now
    );
    if (chargeResult.summary.status === "blocked") {
      return { loanAccount: account, paymentEvent: null, prepayment: null, schedule: account.schedule ?? [], findings: chargeResult.findings, summary: chargeResult.summary };
    }
    workingAccount = chargeResult.loanAccount;
  }

  const paymentResult = postPaymentToLoanAccount(
    workingAccount,
    {
      amount: input.amount,
      receivedAt: receivedAt.toISOString(),
      paymentRef: input.paymentRef,
      channel: input.channel ?? "part_prepayment",
      actor: input.actor ?? "system"
    },
    now
  );
  if (paymentResult.summary.status === "blocked") {
    return { loanAccount: account, paymentEvent: null, prepayment: null, schedule: account.schedule ?? [], findings: paymentResult.findings, summary: paymentResult.summary };
  }

  const paymentEvent = paymentResult.paymentEvent;
  if (paymentEvent.principalCredit <= 0) {
    const blocked = [createFinding("error", "RBI-DL-2025", "Prepayment must reduce outstanding principal after clearing dues.", "amount")];
    return { loanAccount: account, paymentEvent: null, prepayment: null, schedule: account.schedule ?? [], findings: blocked, summary: summarizeFindings(blocked) };
  }

  const paidAccount = paymentResult.loanAccount;
  const monthlyRate = (paidAccount.annualInterestRateBps ?? 0) / 10000 / 12;
  const balance = summarizeLoanAccount(paidAccount, receivedAt);
  const remainingPrincipal = balance.principalOutstanding;
  const receivedTime = receivedAt.getTime();
  const pastInstallments = (account.schedule ?? []).filter((installment) => dueTime(installment.dueDate) <= receivedTime);
  const futureDueDates = (account.schedule ?? [])
    .filter((installment) => dueTime(installment.dueDate) > receivedTime)
    .map((installment) => installment.dueDate);

  // Original contractual EMI, retained when shortening the tenure.
  const originalEmi = computeEmi(account.principalAmount, monthlyRate, account.tenorMonths);
  const rebuiltFuture =
    paidAccount.status === CLOSED_STATUS || remainingPrincipal <= 0 || futureDueDates.length === 0
      ? []
      : reamortizeInstallments(remainingPrincipal, monthlyRate, mode, futureDueDates, originalEmi, pastInstallments.length + 1);
  const schedule = [...pastInstallments, ...rebuiltFuture];

  const prepayment = {
    prepaymentId: input.prepaymentId ?? createLoanId("prepay"),
    mode,
    amount: paymentEvent.amount,
    principalReduced: paymentEvent.principalCredit,
    prepaidAt: receivedAt.toISOString(),
    principalOutstandingAfter: remainingPrincipal,
    remainingInstallments: rebuiltFuture.length,
    paymentRef: input.paymentRef,
    actor: input.actor ?? "system"
  };
  const updated = {
    ...paidAccount,
    schedule,
    prepayments: [...(paidAccount.prepayments ?? []), prepayment],
    servicingEvents: [
      ...(paidAccount.servicingEvents ?? []),
      {
        type: "loan_account.part_prepaid",
        prepaymentId: prepayment.prepaymentId,
        mode,
        at: receivedAt.toISOString(),
        actor: prepayment.actor
      }
    ]
  };

  return { loanAccount: updated, paymentEvent, prepayment, schedule, findings: [], summary: summarizeFindings([]) };
}

// A hardship restructure modifies the remaining terms of a stressed but active
// loan — extending the tenure and/or conceding the rate to lower the EMI — under
// maker-checker approval. Per RBI norms a restructure for financial difficulty
// is a material event, so the account is flagged `restructured` and asset
// classification / CIC reporting reflect it. Past installments are untouched;
// the remaining principal is re-amortized over the new remaining term.
export function restructureLoanAccount(account, input = {}, now = new Date()) {
  const findings = [];
  const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : now;

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account && account.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Only an active loan account can be restructured.", "status"));
  }
  if (!input.reason) {
    findings.push(createFinding("error", "RBI-DL-2025", "Restructure requires a hardship reason.", "reason"));
  }
  if (!input.proposedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Restructure requires a proposing maker.", "proposedBy"));
  }
  if (!input.approvedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Restructure requires an approving checker.", "approvedBy"));
  }
  if (!input.approvalReference) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Restructure requires an approvalReference.", "approvalReference"));
  }
  if (input.proposedBy && input.approvedBy && input.proposedBy === input.approvedBy) {
    findings.push(
      createFinding("error", "RBI-IT-GRC", "Restructure approver must differ from the proposer (four-eyes).", "approvedBy")
    );
  }
  if (!Number.isFinite(input.newRemainingTermMonths) || input.newRemainingTermMonths < 1) {
    findings.push(
      createFinding("error", "RBI-DL-2025", "Restructure requires a positive newRemainingTermMonths.", "newRemainingTermMonths")
    );
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { loanAccount: account, restructure: null, schedule: account?.schedule ?? [], findings, summary };
  }

  const balance = summarizeLoanAccount(account, effectiveAt);
  const remainingPrincipal = balance.principalOutstanding;
  if (remainingPrincipal <= 0) {
    const blocked = [createFinding("error", "RBI-DL-2025", "A fully repaid loan cannot be restructured.", "status")];
    return { loanAccount: account, restructure: null, schedule: account.schedule ?? [], findings: blocked, summary: summarizeFindings(blocked) };
  }

  const newRateBps = Number.isFinite(input.newAnnualInterestRateBps)
    ? input.newAnnualInterestRateBps
    : account.annualInterestRateBps ?? 0;
  const effectiveTime = effectiveAt.getTime();
  const pastInstallments = (account.schedule ?? []).filter((installment) => dueTime(installment.dueDate) <= effectiveTime);
  const anchorDate =
    pastInstallments.length > 0 ? new Date(`${pastInstallments.at(-1).dueDate}T00:00:00.000Z`) : effectiveAt;

  const rebuilt = generateRepaymentSchedule({
    principalAmount: remainingPrincipal,
    annualInterestRateBps: newRateBps,
    tenorMonths: input.newRemainingTermMonths,
    startDate: anchorDate.toISOString()
  });
  if (rebuilt.summary.status === "blocked") {
    return { loanAccount: account, restructure: null, schedule: account.schedule ?? [], findings: rebuilt.findings, summary: rebuilt.summary };
  }
  const rebuiltFuture = rebuilt.schedule.map((installment, index) => ({
    ...installment,
    installmentNumber: pastInstallments.length + index + 1
  }));
  const schedule = [...pastInstallments, ...rebuiltFuture];

  const restructure = {
    restructureId: input.restructureId ?? createLoanId("restructure"),
    reason: input.reason,
    hardshipCategory: input.hardshipCategory ?? null,
    restructuredAt: effectiveAt.toISOString(),
    priorTerms: {
      annualInterestRateBps: account.annualInterestRateBps ?? null,
      tenorMonths: account.tenorMonths ?? null,
      remainingInstallments: (account.schedule ?? []).filter((i) => dueTime(i.dueDate) > effectiveTime).length
    },
    newTerms: {
      annualInterestRateBps: newRateBps,
      remainingInstallments: rebuiltFuture.length,
      principalReamortized: remainingPrincipal,
      firstNewDueDate: rebuiltFuture[0]?.dueDate ?? null
    },
    proposedBy: input.proposedBy,
    approvedBy: input.approvedBy,
    approvalReference: input.approvalReference
  };
  const updated = {
    ...account,
    schedule,
    annualInterestRateBps: newRateBps,
    tenorMonths: schedule.length,
    restructured: true,
    restructures: [...(account.restructures ?? []), restructure],
    servicingEvents: [
      ...(account.servicingEvents ?? []),
      {
        type: "loan_account.restructured",
        restructureId: restructure.restructureId,
        at: effectiveAt.toISOString(),
        actor: restructure.approvedBy
      }
    ],
    updatedAt: now.toISOString()
  };

  return { loanAccount: updated, restructure, schedule, findings: [], summary: summarizeFindings([]) };
}

// A floating-rate reset implements the RBI-mandated option flow for interest rate
// resets on floating-rate term loans. The RE must offer options: extend tenor,
// increase EMI, switch to fixed rate, or prepay. Resets require four-eyes maker-checker.
export function resetFloatingRate(account, input = {}, now = new Date()) {
  const findings = [];
  const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : now;
  const optionSelected = input.optionSelected ?? "increase_emi";

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account && account.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Only an active loan account can have its rate reset.", "status"));
  }
  if (account && account.interestRateType !== "floating") {
    findings.push(createFinding("error", "RBI-DL-2025", "Rate reset is only applicable to floating-rate loans.", "interestRateType"));
  }
  if (!input.proposedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Rate reset requires a proposing maker.", "proposedBy"));
  }
  if (!input.approvedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Rate reset requires an approving checker.", "approvedBy"));
  }
  if (!input.approvalReference) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Rate reset requires an approvalReference.", "approvalReference"));
  }
  if (input.proposedBy && input.approvedBy && input.proposedBy === input.approvedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Rate reset checker must differ from the proposer (four-eyes).", "approvedBy"));
  }
  if (!Number.isFinite(input.newAnnualInterestRateBps) || input.newAnnualInterestRateBps <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Rate reset requires a positive newAnnualInterestRateBps.", "newAnnualInterestRateBps"));
  }
  if (!["extend_tenor", "increase_emi", "switch_to_fixed"].includes(optionSelected)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Option selected must be extend_tenor, increase_emi, or switch_to_fixed.", "optionSelected"));
  }

  if (account && optionSelected === "switch_to_fixed") {
    const resetPolicy = account.interestRateResetPolicy ?? {};
    if (!resetPolicy.fixedSwitchAllowed) {
      findings.push(createFinding("error", "RBI-DL-2025", "Switch to fixed rate is not allowed under product policy.", "optionSelected"));
    }
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked" || !account) {
    return { loanAccount: account, reset: null, events: [], findings, summary };
  }

  const balance = summarizeLoanAccount(account, effectiveAt);
  const remainingPrincipal = balance.principalOutstanding;
  if (remainingPrincipal <= 0) {
    const blocked = [createFinding("error", "RBI-DL-2025", "A fully repaid loan cannot have its rate reset.", "status")];
    return { loanAccount: account, reset: null, events: [], findings: blocked, summary: summarizeFindings(blocked) };
  }

  const newRateBps = input.newAnnualInterestRateBps;
  const effectiveTime = effectiveAt.getTime();
  const pastInstallments = (account.schedule ?? []).filter((installment) => dueTime(installment.dueDate) <= effectiveTime);
  const futureInstallments = (account.schedule ?? []).filter((installment) => dueTime(installment.dueDate) > effectiveTime);

  if (futureInstallments.length === 0) {
    const blocked = [createFinding("error", "RBI-DL-2025", "No future installments available to re-amortize.", "schedule")];
    return { loanAccount: account, reset: null, events: [], findings: blocked, summary: summarizeFindings(blocked) };
  }

  const anchorDate = pastInstallments.length > 0 ? new Date(`${pastInstallments.at(-1).dueDate}T00:00:00.000Z`) : effectiveAt;
  const currentEmi = roundMoney(futureInstallments[0].principalAmount + futureInstallments[0].interestAmount);

  let newRemainingTermMonths = futureInstallments.length;
  let validationFindings = [];

  if (optionSelected === "extend_tenor") {
    const monthlyRate = newRateBps / 120000;
    if (monthlyRate === 0) {
      newRemainingTermMonths = Math.ceil(remainingPrincipal / currentEmi);
    } else {
      const ratio = (remainingPrincipal * monthlyRate) / currentEmi;
      if (ratio >= 1) {
        validationFindings.push(createFinding("error", "RBI-DL-2025", "Tenor extension is impossible because interest at the new rate exceeds the current EMI. Please select increase_emi.", "optionSelected"));
      } else {
        newRemainingTermMonths = Math.round(-Math.log(1 - ratio) / Math.log(1 + monthlyRate));
      }
    }
    if (newRemainingTermMonths < 1) {
      newRemainingTermMonths = 1;
    }
  }

  const valSummary = summarizeFindings(validationFindings);
  if (valSummary.status === "blocked") {
    return { loanAccount: account, reset: null, events: [], findings: validationFindings, summary: valSummary };
  }

  let working = account;
  const events = [];

  if (optionSelected === "switch_to_fixed") {
    const switchFee = account.interestRateResetPolicy?.fixedSwitchFeeAmount ?? 0;
    if (switchFee > 0) {
      const chargeResult = assessChargeToLoanAccount(
        working,
        {
          name: "Rate switch fee",
          reason: "Option to switch to fixed rate exercised at interest rate reset",
          amount: switchFee,
          assessedAt: effectiveAt.toISOString(),
          actor: input.approvedBy
        },
        now
      );
      if (chargeResult.summary.status === "blocked") {
        return { loanAccount: account, reset: null, events: [], findings: chargeResult.findings, summary: chargeResult.summary };
      }
      working = chargeResult.loanAccount;
      events.push(chargeResult.chargeEvent);
    }
  }

  const rebuilt = generateRepaymentSchedule({
    principalAmount: remainingPrincipal,
    annualInterestRateBps: newRateBps,
    tenorMonths: newRemainingTermMonths,
    startDate: anchorDate.toISOString()
  });

  if (rebuilt.summary.status === "blocked") {
    return { loanAccount: working, reset: null, events, findings: rebuilt.findings, summary: rebuilt.summary };
  }

  const rebuiltFuture = rebuilt.schedule.map((installment, index) => ({
    ...installment,
    installmentNumber: pastInstallments.length + index + 1
  }));
  const schedule = [...pastInstallments, ...rebuiltFuture];

  const resetDetails = {
    resetId: input.resetId ?? createLoanId("reset"),
    optionSelected,
    resetAt: effectiveAt.toISOString(),
    priorTerms: {
      annualInterestRateBps: account.annualInterestRateBps ?? null,
      interestRateType: account.interestRateType ?? "fixed",
      remainingInstallments: futureInstallments.length,
      currentEmi
    },
    newTerms: {
      annualInterestRateBps: newRateBps,
      interestRateType: optionSelected === "switch_to_fixed" ? "fixed" : "floating",
      remainingInstallments: rebuiltFuture.length,
      newEmi: rebuiltFuture[0] ? roundMoney(rebuiltFuture[0].principalAmount + rebuiltFuture[0].interestAmount) : 0
    },
    proposedBy: input.proposedBy,
    approvedBy: input.approvedBy,
    approvalReference: input.approvalReference
  };

  const updated = {
    ...working,
    schedule,
    annualInterestRateBps: newRateBps,
    interestRateType: optionSelected === "switch_to_fixed" ? "fixed" : "floating",
    interestRateResets: [...(working.interestRateResets ?? []), resetDetails],
    servicingEvents: [
      ...(working.servicingEvents ?? []),
      {
        type: "loan_account.interest_rate_reset",
        resetId: resetDetails.resetId,
        optionSelected,
        at: effectiveAt.toISOString(),
        actor: resetDetails.approvedBy
      }
    ],
    updatedAt: now.toISOString()
  };

  return { loanAccount: updated, reset: resetDetails, events, findings: [], summary: summarizeFindings([]) };
}

// A compromise settlement (one-time settlement) closes the account for a sum
// less than the full outstanding under maker-checker approval: the borrower pays
// the agreed amount and the RE waives (sacrifices) the shortfall. The account
// closes as `settled` — materially different from full closure and reported as
// such to the credit bureau.
export function settleLoanAccount(account, input = {}, now = new Date()) {
  const findings = [];
  const settledAt = input.settledAt ? new Date(input.settledAt) : now;

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account && account.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Only an active loan account can be settled.", "status"));
  }
  if (!Number.isFinite(input.settlementAmount) || input.settlementAmount <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Settlement amount must be positive.", "settlementAmount"));
  }
  if (!input.paymentRef) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Settlement requires paymentRef.", "paymentRef"));
  }
  requireMakerChecker(findings, input);

  const balance = account ? summarizeLoanAccount(account, settledAt) : null;
  if (balance && Number.isFinite(input.settlementAmount) && roundMoney(input.settlementAmount) >= balance.totalOutstanding) {
    findings.push(
      createFinding(
        "error",
        "RBI-DL-2025",
        "Settlement amount meets or exceeds the outstanding; use full repayment or foreclosure instead.",
        "settlementAmount"
      )
    );
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { loanAccount: account, settlement: null, events: [], findings, summary };
  }

  // Post the borrower's payment first (allocated interest -> charges -> principal).
  const paymentResult = postPaymentToLoanAccount(
    account,
    {
      amount: input.settlementAmount,
      receivedAt: settledAt.toISOString(),
      paymentRef: input.paymentRef,
      channel: input.channel ?? "settlement",
      actor: input.actor ?? input.proposedBy ?? "system"
    },
    now
  );
  if (paymentResult.summary.status === "blocked") {
    return { loanAccount: account, settlement: null, events: [], findings: paymentResult.findings, summary: paymentResult.summary };
  }

  // Whatever remains after the payment is the sacrifice, waived off the ledger so
  // the account genuinely zeroes out.
  const residual = summarizeLoanAccount(paymentResult.loanAccount, settledAt);
  const sacrificeEvent = {
    eventId: createLoanId("ledger"),
    type: "settlement_sacrifice",
    eventDate: settledAt.toISOString(),
    amount: roundMoney(residual.principalOutstanding + residual.interestOutstanding + residual.chargesOutstanding),
    principalDebit: 0,
    principalCredit: 0,
    interestCredit: 0,
    chargesDebit: 0,
    chargesCredit: 0,
    principalWaiverCredit: residual.principalOutstanding,
    interestWaiverCredit: residual.interestOutstanding,
    chargesWaiverCredit: residual.chargesOutstanding,
    reason: input.reason ?? "compromise_settlement",
    actor: input.approvedBy
  };
  const settlement = {
    settlementId: input.settlementId ?? createLoanId("settlement"),
    settlementAmount: roundMoney(input.settlementAmount),
    sacrificeAmount: sacrificeEvent.amount,
    outstandingBeforeSettlement: balance.totalOutstanding,
    reason: input.reason ?? null,
    settledAt: settledAt.toISOString(),
    proposedBy: input.proposedBy,
    approvedBy: input.approvedBy,
    approvalReference: input.approvalReference,
    paymentRef: input.paymentRef
  };
  const updated = {
    ...paymentResult.loanAccount,
    ledger: [...paymentResult.loanAccount.ledger, sacrificeEvent],
    status: CLOSED_STATUS,
    closedAt: settledAt.toISOString(),
    closureType: "settled",
    settlement,
    servicingEvents: [
      ...(paymentResult.loanAccount.servicingEvents ?? []),
      {
        type: "loan_account.settled",
        settlementId: settlement.settlementId,
        at: settledAt.toISOString(),
        actor: settlement.approvedBy
      }
    ],
    updatedAt: now.toISOString()
  };

  return {
    loanAccount: updated,
    settlement,
    events: [paymentResult.paymentEvent, sacrificeEvent],
    findings: [],
    summary: summarizeFindings([])
  };
}

// A prudential/technical write-off recognizes the outstanding as a loss in the
// RE's books under maker-checker approval. It does NOT extinguish the borrower's
// legal dues, so the ledger balance is retained; the account is marked
// `written_off` and reported as such. Recovery efforts may continue off-book.
export function writeOffLoanAccount(account, input = {}, now = new Date()) {
  const findings = [];
  const writtenOffAt = input.writtenOffAt ? new Date(input.writtenOffAt) : now;

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account && account.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Only an active loan account can be written off.", "status"));
  }
  if (!input.reason) {
    findings.push(createFinding("error", "RBI-DL-2025", "Write-off requires a reason.", "reason"));
  }
  requireMakerChecker(findings, input);

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { loanAccount: account, writeOff: null, findings, summary };
  }

  const balance = summarizeLoanAccount(account, writtenOffAt);
  const writeOff = {
    writeOffId: input.writeOffId ?? createLoanId("writeoff"),
    writeOffAmount: balance.totalOutstanding,
    principalWrittenOff: balance.principalOutstanding,
    interestWrittenOff: balance.interestOutstanding,
    chargesWrittenOff: balance.chargesOutstanding,
    reason: input.reason,
    duesRetained: true,
    writtenOffAt: writtenOffAt.toISOString(),
    proposedBy: input.proposedBy,
    approvedBy: input.approvedBy,
    approvalReference: input.approvalReference
  };
  const updated = {
    ...account,
    status: "written_off",
    writtenOff: true,
    writeOff,
    servicingEvents: [
      ...(account.servicingEvents ?? []),
      {
        type: "loan_account.written_off",
        writeOffId: writeOff.writeOffId,
        at: writtenOffAt.toISOString(),
        actor: writeOff.approvedBy
      }
    ],
    updatedAt: now.toISOString()
  };

  return { loanAccount: updated, writeOff, findings: [], summary: summarizeFindings([]) };
}

// Collections reminders and notices. RBI's Fair Practices Code bars recovery
// calls to a borrower before 8:00 a.m. or after 7:00 p.m., so voice-channel
// contact outside that IST window is blocked; asynchronous channels (SMS, email,
// letter) are unrestricted. Every reminder is logged with the delinquency state
// at the time, building an auditable contact history.
const REMINDER_CHANNELS = new Set(["sms", "email", "ivr", "call", "whatsapp", "letter"]);
const VOICE_REMINDER_CHANNELS = new Set(["call", "ivr"]);
const REMINDER_STAGES = new Set(["pre_due", "overdue", "reminder", "final_notice", "legal_notice"]);

export function recordCollectionsReminder(account, input = {}, now = new Date()) {
  const findings = [];
  const sentAt = input.sentAt ? new Date(input.sentAt) : now;

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account && account.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Reminders can only be sent on active loan accounts.", "status"));
  }
  if (!REMINDER_CHANNELS.has(input.channel)) {
    findings.push(createFinding("error", "RBI-FPC-PENAL", "Reminder channel is invalid.", "channel"));
  }
  if (!REMINDER_STAGES.has(input.stage)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Reminder stage is invalid.", "stage"));
  }
  if (!input.actor) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Reminder requires an actor.", "actor"));
  }
  if (Number.isNaN(sentAt.getTime())) {
    findings.push(createFinding("error", "RBI-DL-2025", "Reminder sentAt is invalid.", "sentAt"));
  } else if (VOICE_REMINDER_CHANNELS.has(input.channel)) {
    const istHour = new Date(sentAt.getTime() + 330 * 60 * 1000).getUTCHours();
    if (istHour < 8 || istHour >= 19) {
      findings.push(
        createFinding("error", "RBI-FPC-PENAL", "Recovery calls are only permitted between 08:00 and 19:00 IST.", "sentAt")
      );
    }
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { loanAccount: account, reminder: null, findings, summary };
  }

  const delinquency = computeDelinquency(account, sentAt);
  const reminder = {
    reminderId: input.reminderId ?? createLoanId("reminder"),
    channel: input.channel,
    stage: input.stage,
    messageRef: input.messageRef ?? null,
    templateRef: input.templateRef ?? null,
    sentAt: sentAt.toISOString(),
    daysPastDue: delinquency.daysPastDue,
    delinquencyBucket: delinquency.bucket,
    actor: input.actor
  };
  const updated = {
    ...account,
    collectionsReminders: [...(account.collectionsReminders ?? []), reminder],
    servicingEvents: [
      ...(account.servicingEvents ?? []),
      {
        type: "loan_account.reminder_sent",
        reminderId: reminder.reminderId,
        channel: reminder.channel,
        stage: reminder.stage,
        at: reminder.sentAt,
        actor: reminder.actor
      }
    ],
    updatedAt: now.toISOString()
  };

  return { loanAccount: updated, reminder, findings: [], summary: summarizeFindings([]) };
}

function requireMakerChecker(findings, input) {
  if (!input.reason) {
    findings.push(createFinding("error", "RBI-DL-2025", "A reason is required.", "reason"));
  }
  if (!input.proposedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "A proposing maker is required.", "proposedBy"));
  }
  if (!input.approvedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "An approving checker is required.", "approvedBy"));
  }
  if (!input.approvalReference) {
    findings.push(createFinding("error", "RBI-IT-GRC", "An approvalReference is required.", "approvalReference"));
  }
  if (input.proposedBy && input.approvedBy && input.proposedBy === input.approvedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "The approver must differ from the proposer (four-eyes).", "approvedBy"));
  }
}

export function assessChargeToLoanAccount(account, input, now = new Date()) {
  const findings = [];

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account?.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Charges can only be assessed on active loan accounts.", "status"));
  }
  if (!input?.name) {
    findings.push(createFinding("error", "RBI-KFS-2024", "Charge name is required.", "name"));
  }
  if (!input?.reason) {
    findings.push(createFinding("error", "RBI-KFS-2024", "Charge reason is required.", "reason"));
  }
  if (!Number.isFinite(input?.amount) || input.amount <= 0) {
    findings.push(createFinding("error", "RBI-KFS-2024", "Charge amount must be positive.", "amount"));
  }
  if (input?.type === "penal_interest") {
    findings.push(createFinding("error", "RBI-FPC-PENAL", "Penalties must not be represented as penal interest.", "type"));
  }
  if (input?.capitalizes === true) {
    findings.push(createFinding("error", "RBI-FPC-PENAL", "Penal charges must not be capitalized.", "capitalizes"));
  }

  const disclosedCharge = findDisclosedCharge(account?.disclosedChargeCatalog ?? [], input?.name);
  if (!disclosedCharge) {
    findings.push(createFinding("error", "RBI-KFS-2024", "Charge must be disclosed in KFS before assessment.", "name"));
  } else if (Number.isFinite(disclosedCharge.amount) && input.amount > disclosedCharge.amount) {
    findings.push(createFinding(
      "error",
      "RBI-KFS-2024",
      `Assessed amount for '${input.name}' (${input.amount}) exceeds the disclosed KFS limit of ${disclosedCharge.amount}.`,
      "amount"
    ));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      loanAccount: account,
      chargeEvent: null,
      findings,
      summary
    };
  }

  const assessedAt = input.assessedAt ? new Date(input.assessedAt) : now;
  const chargeType = input.type ?? disclosedCharge.type ?? "charge";
  // The assessed amount is GST-inclusive; decompose it for disclosure (REV-42).
  // gstApplicable/gstRateBps may be carried on the input or the disclosed charge.
  const gst = decomposeGstInclusive(input.amount, {
    type: chargeType,
    gstApplicable: input.gstApplicable ?? disclosedCharge.gstApplicable,
    gstRateBps: input.gstRateBps ?? disclosedCharge.gstRateBps
  });
  const chargeEvent = {
    eventId: createLoanId("ledger"),
    type: "charge_assessed",
    eventDate: assessedAt.toISOString(),
    amount: roundMoney(input.amount),
    principalDebit: 0,
    principalCredit: 0,
    interestCredit: 0,
    chargesDebit: roundMoney(input.amount),
    chargesCredit: 0,
    chargesWaiverCredit: 0,
    chargeName: input.name,
    chargeType,
    reason: input.reason,
    disclosedChargeRef: disclosedCharge.name,
    gstApplicable: gst.gstApplicable,
    gstRateBps: gst.gstRateBps,
    baseAmount: gst.baseAmount,
    gstAmount: gst.gstAmount,
    actor: input.actor ?? "system"
  };
  const updated = {
    ...account,
    ledger: [...(account.ledger ?? []), chargeEvent],
    updatedAt: now.toISOString()
  };

  return {
    loanAccount: updated,
    chargeEvent,
    findings,
    summary
  };
}

export function waiveLoanAccountCharge(account, input, now = new Date()) {
  const findings = [];

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account?.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Waivers can only be posted to active loan accounts.", "status"));
  }
  if (!Number.isFinite(input?.amount) || input.amount <= 0) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Waiver amount must be positive.", "amount"));
  }
  if (!input?.approvedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Waiver requires approvedBy.", "approvedBy"));
  }
  if (!input?.approvalRef) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Waiver requires approvalRef.", "approvalRef"));
  }
  if (!input?.reason) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Waiver reason is required.", "reason"));
  }

  const balance = account ? summarizeLoanAccount(account, input?.waivedAt ? new Date(input.waivedAt) : now) : null;
  if (balance && input?.amount > balance.chargesOutstanding) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Waiver cannot exceed outstanding charges.", "amount"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      loanAccount: account,
      waiverEvent: null,
      findings,
      summary
    };
  }

  const waivedAt = input.waivedAt ? new Date(input.waivedAt) : now;
  const waiverEvent = {
    eventId: createLoanId("ledger"),
    type: "charge_waiver",
    eventDate: waivedAt.toISOString(),
    amount: roundMoney(input.amount),
    principalDebit: 0,
    principalCredit: 0,
    interestCredit: 0,
    chargesDebit: 0,
    chargesCredit: 0,
    chargesWaiverCredit: roundMoney(input.amount),
    reason: input.reason,
    approvedBy: input.approvedBy,
    approvalRef: input.approvalRef,
    actor: input.approvedBy
  };
  const updated = {
    ...account,
    ledger: [...(account.ledger ?? []), waiverEvent],
    updatedAt: now.toISOString()
  };

  return {
    loanAccount: updated,
    waiverEvent,
    findings,
    summary
  };
}

export function reverseLoanAccountEvent(account, input, now = new Date()) {
  const findings = [];
  const original = (account?.ledger ?? []).find((event) => event.eventId === input?.eventId);
  const alreadyReversed = (account?.ledger ?? []).some((event) => event.reversalOfEventId === input?.eventId);

  if (!account) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Loan account is required.", "loanAccount"));
  }
  if (!original) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Original ledger event was not found.", "eventId"));
  }
  if (alreadyReversed) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Ledger event has already been reversed.", "eventId"));
  }
  if (!input?.approvedBy) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Reversal requires approvedBy.", "approvedBy"));
  }
  if (!input?.reversalRef) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Reversal requires reversalRef.", "reversalRef"));
  }
  if (!input?.reason) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Reversal reason is required.", "reason"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      loanAccount: account,
      reversalEvent: null,
      findings,
      summary
    };
  }

  const reversedAt = input.reversedAt ? new Date(input.reversedAt) : now;
  const reversalEvent = {
    eventId: createLoanId("ledger"),
    type: "reversal",
    eventDate: reversedAt.toISOString(),
    amount: -roundMoney(original.amount ?? 0),
    principalDebit: -roundMoney(original.principalDebit ?? 0),
    principalCredit: -roundMoney(original.principalCredit ?? 0),
    interestDebit: -roundMoney(original.interestDebit ?? 0),
    interestCredit: -roundMoney(original.interestCredit ?? 0),
    chargesDebit: -roundMoney(original.chargesDebit ?? 0),
    chargesCredit: -roundMoney(original.chargesCredit ?? 0),
    chargesWaiverCredit: -roundMoney(original.chargesWaiverCredit ?? 0),
    reversalOfEventId: original.eventId,
    reversalRef: input.reversalRef,
    reason: input.reason,
    approvedBy: input.approvedBy,
    actor: input.approvedBy
  };
  const updated = {
    ...account,
    ledger: [...(account.ledger ?? []), reversalEvent],
    status: ACTIVE_STATUS,
    closedAt: null,
    updatedAt: now.toISOString()
  };

  return {
    loanAccount: updated,
    reversalEvent,
    findings,
    summary
  };
}

// Refund only cash that was never allocated to principal, interest, or charges.
// Any principal/interest correction remains a separately approved ledger reversal.
export function refundUnappliedPayment(account, input, now = new Date()) {
  const findings = [];
  const payment = (account?.ledger ?? []).find((event) => event.eventId === input?.paymentEventId && event.type === "payment");
  const priorRefunded = (account?.ledger ?? [])
    .filter((event) => event.refundOfPaymentEventId === input?.paymentEventId)
    .reduce((sum, event) => sum + Math.abs(event.amount ?? 0), 0);
  if (!payment) findings.push(createFinding("error", "RBI-IT-GRC", "Refund must reference an existing payment event.", "paymentEventId"));
  if (!Number.isFinite(input?.amount) || input.amount <= 0) findings.push(createFinding("error", "RBI-IT-GRC", "Refund amount must be positive.", "amount"));
  if (!input?.refundRef || !input?.approvedBy || !input?.reason) findings.push(createFinding("error", "RBI-IT-GRC", "Refund requires refundRef, approvedBy, and reason.", "refund"));
  const available = Math.max(0, (payment?.unappliedAmount ?? 0) - priorRefunded);
  if (Number.isFinite(input?.amount) && input.amount > available) findings.push(createFinding("error", "RBI-DL-2025", "Refund cannot exceed the payment's unapplied amount.", "amount"));
  if ((account?.ledger ?? []).some((event) => event.refundRef === input?.refundRef)) findings.push(createFinding("error", "RBI-IT-GRC", "Refund reference has already been used.", "refundRef"));
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { loanAccount: account, refundEvent: null, findings, summary };
  const refundedAt = input.refundedAt ? new Date(input.refundedAt) : now;
  const refundEvent = { eventId: createLoanId("ledger"), type: "refund", eventDate: refundedAt.toISOString(), amount: -roundMoney(input.amount), principalDebit: 0, principalCredit: 0, interestCredit: 0, chargesDebit: 0, chargesCredit: 0, chargesWaiverCredit: 0, refundOfPaymentEventId: payment.eventId, refundRef: input.refundRef, reason: input.reason, approvedBy: input.approvedBy, actor: input.approvedBy };
  return { loanAccount: { ...account, ledger: [...(account.ledger ?? []), refundEvent], updatedAt: now.toISOString() }, refundEvent, findings, summary };
}

// A failed outward disbursement can be returned only before the account has
// any servicing activity. It cancels the principal debit itself; it is not a
// borrower refund and cannot be used to unwind a live loan.
export function returnFailedDisbursement(account, input, now = new Date()) {
  const findings = [];
  const disbursement = (account?.ledger ?? []).find((event) => event.type === "disbursement");
  const alreadyReturned = (account?.ledger ?? []).some((event) => event.returnOfDisbursementEventId === disbursement?.eventId);
  const servicingActivity = (account?.ledger ?? []).some((event) => !["disbursement", "interest_accrual"].includes(event.type));
  if (!account || account.status !== ACTIVE_STATUS) findings.push(createFinding("error", "RBI-DL-2025", "Only an active loan account can record a failed disbursement return.", "status"));
  if (!disbursement) findings.push(createFinding("error", "RBI-IT-GRC", "Original disbursement event was not found.", "loanAccount"));
  if (alreadyReturned) findings.push(createFinding("error", "RBI-IT-GRC", "Disbursement has already been returned.", "returnRef"));
  if (servicingActivity) findings.push(createFinding("error", "RBI-DL-2025", "Disbursement return is blocked after repayment, charges, or other servicing activity; use a governed reversal/refund workflow.", "loanAccount"));
  if (!input?.returnRef || !input?.approvedBy || !input?.reason) findings.push(createFinding("error", "RBI-IT-GRC", "Failed disbursement return requires returnRef, approvedBy, and reason.", "return"));
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { loanAccount: account, returnEvent: null, findings, summary };
  const returnedAt = input.returnedAt ? new Date(input.returnedAt) : now;
  const returnEvent = { eventId: createLoanId("ledger"), type: "disbursement_return", eventDate: returnedAt.toISOString(), amount: -roundMoney(disbursement.amount), principalDebit: -roundMoney(disbursement.principalDebit), principalCredit: 0, interestCredit: 0, chargesDebit: 0, chargesCredit: 0, chargesWaiverCredit: 0, returnOfDisbursementEventId: disbursement.eventId, returnRef: input.returnRef, reason: input.reason, approvedBy: input.approvedBy, actor: input.approvedBy };
  return { loanAccount: { ...account, ledger: [...(account.ledger ?? []), returnEvent], status: "cancelled", closedAt: returnedAt.toISOString(), updatedAt: now.toISOString() }, returnEvent, findings, summary };
}

export function quoteCoolingOffCancellation(account, input = {}, now = new Date()) {
  const findings = [];
  const asOf = input.asOf ? new Date(input.asOf) : now;
  const elapsedDays = Math.max(0, Math.ceil((asOf.getTime() - new Date(account?.disbursedAt).getTime()) / 86400000));
  if (!account || account.status !== ACTIVE_STATUS) findings.push(createFinding("error", "RBI-KFS-2024", "Cooling-off quote requires an active loan account.", "status"));
  if (Number.isNaN(asOf.getTime()) || elapsedDays > (account?.coolingOffDays ?? 0)) findings.push(createFinding("error", "RBI-KFS-2024", "Cooling-off period has expired.", "asOf"));
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { quote: null, findings, summary };
  const principal = account.principalAmount;
  const proportionateInterest = roundMoney((principal * account.annualInterestRateBps * elapsedDays) / (10000 * 365));
  return { quote: { loanAccountId: account.loanAccountId, asOf: asOf.toISOString(), elapsedDays, principalAmount: principal, proportionateInterest, permittedCharges: 0, totalPayable: roundMoney(principal + proportionateInterest), currency: account.currency }, findings, summary };
}

export function executeCoolingOffCancellation(account, input, now = new Date()) {
  const quoteResult = quoteCoolingOffCancellation(account, { asOf: input?.paidAt }, now);
  const findings = [...quoteResult.findings];
  const duplicate = (account?.ledger ?? []).some((event) => event.coolingOffPaymentRef === input?.paymentRef);
  if (!input?.paymentRef || !input?.paidBy) findings.push(createFinding("error", "RBI-IT-GRC", "Cooling-off cancellation requires paymentRef and paidBy.", "payment"));
  if (duplicate) findings.push(createFinding("error", "RBI-IT-GRC", "Cooling-off payment reference has already been used.", "paymentRef"));
  if (!Number.isFinite(input?.amount) || input.amount !== quoteResult.quote?.totalPayable) findings.push(createFinding("error", "RBI-KFS-2024", "Cooling-off payment must exactly equal the quoted total payable.", "amount"));
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { loanAccount: account, cancellationEvent: null, quote: quoteResult.quote, findings, summary };
  const paidAt = input.paidAt ? new Date(input.paidAt) : now;
  const cancellationEvent = { eventId: createLoanId("ledger"), type: "cooling_off_cancellation", eventDate: paidAt.toISOString(), amount: roundMoney(input.amount), principalDebit: 0, principalCredit: quoteResult.quote.principalAmount, interestDebit: 0, interestCredit: 0, chargesDebit: 0, chargesCredit: 0, chargesWaiverCredit: 0, coolingOffInterestCollected: quoteResult.quote.proportionateInterest, coolingOffPaymentRef: input.paymentRef, actor: input.paidBy };
  return { loanAccount: { ...account, ledger: [...(account.ledger ?? []), cancellationEvent], status: "cancelled", closedAt: paidAt.toISOString(), coolingOffCancelledAt: paidAt.toISOString(), updatedAt: now.toISOString() }, cancellationEvent, quote: quoteResult.quote, findings, summary };
}

export function generateLoanStatement(account, input = {}, now = new Date()) {
  const periodEnd = input.periodEnd ? new Date(input.periodEnd) : now;
  const periodStart = input.periodStart ? new Date(input.periodStart) : new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1));
  const openingAsOf = new Date(periodStart.getTime() - 1);
  const transactions = (account.ledger ?? []).filter((event) => {
    const at = new Date(event.eventDate).getTime();
    return at >= periodStart.getTime() && at <= periodEnd.getTime();
  });
  const scheduledDues = (account.schedule ?? []).filter((installment) => {
    const dueAt = new Date(`${installment.dueDate}T00:00:00.000Z`).getTime();
    return dueAt >= periodStart.getTime() && dueAt <= periodEnd.getTime();
  });

  return {
    statementId: createLoanId("stmt"),
    loanAccountId: account.loanAccountId,
    borrowerId: account.borrowerId,
    generatedAt: now.toISOString(),
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
    currency: account.currency,
    facilityType: account.facilityType ?? "term_loan",
    repaymentStructure: account.repaymentStructure ?? "amortizing",
    facilitySnapshot: summarizeLoanAccount(account, periodEnd).facility,
    openingSummary: summarizeLoanAccount(account, openingAsOf),
    closingSummary: summarizeLoanAccount(account, periodEnd),
    scheduledDues,
    transactions,
    totals: {
      principalDue: sumMoney(scheduledDues, (installment) => installment.principalDue),
      interestDue: sumMoney(scheduledDues, (installment) => installment.interestDue),
      revolvingInterestAccrued: sumMoney(transactions.filter((event) => event.type === "revolving_interest_accrual"), (event) => event.interestDebit),
      revolvingDrawdowns: sumMoney(transactions.filter((event) => event.type === "revolving_drawdown"), (event) => event.principalDebit),
      chargesAssessed: sumMoney(transactions, (event) => event.chargesDebit),
      // GST component within the charges assessed this period, disclosed
      // separately for borrower transparency (REV-42). chargesAssessed is
      // GST-inclusive; chargesBaseFees is the net-of-tax fee.
      gstCollected: sumMoney(
        transactions.filter((event) => event.type === "charge_assessed"),
        (event) => event.gstAmount
      ),
      chargesBaseFees: sumMoney(
        transactions.filter((event) => event.type === "charge_assessed"),
        (event) => event.baseAmount ?? event.chargesDebit
      ),
      chargesWaived: sumMoney(transactions, (event) => event.chargesWaiverCredit),
      payments: sumMoney(
        transactions.filter((event) => event.type === "payment"),
        (event) => event.amount
      )
    }
  };
}

// Equated monthly installment in exact integer paise. The reducing-balance
// compounding factor (1+r)^n is irrational, so it is computed in float, but the
// EMI is rounded once to whole paise — no float rupee amount is carried between
// installments, which is where drift accumulates (REV-20).
function computeEmiPaise(principalPaise, monthlyRate, tenorMonths) {
  if (monthlyRate === 0) {
    return Math.round(principalPaise / tenorMonths);
  }
  const factor = (1 + monthlyRate) ** tenorMonths;
  return Math.round((principalPaise * monthlyRate * factor) / (factor - 1));
}

// Reducing-balance interest for one period in exact integer paise:
// interest = openingPaise * monthlyRate, rounded to whole paise. Deterministic
// and independent of the Number.EPSILON rounding heuristic (REV-20).
function interestForPeriodPaise(openingPaise, monthlyRate) {
  if (!monthlyRate) {
    return 0;
  }
  return Math.round(openingPaise * monthlyRate);
}

// Rupee-denominated EMI kept for callers that work in rupees; delegates to the
// exact paise computation.
function computeEmi(principalAmount, monthlyRate, tenorMonths) {
  return fromPaise(computeEmiPaise(toPaise(principalAmount), monthlyRate, tenorMonths));
}

function dueTime(dueDate) {
  return new Date(`${dueDate}T00:00:00.000Z`).getTime();
}

// Rebuild the future portion of a schedule from a reduced principal. In
// reduce_emi mode the remaining term is fixed and the EMI is recomputed; in
// reduce_tenure mode the EMI is fixed and the loan amortizes over however many
// installments that takes.
function reamortizeInstallments(remainingPrincipal, monthlyRate, mode, futureDueDates, originalEmi, startNumber) {
  const emiPaise =
    mode === "reduce_emi"
      ? computeEmiPaise(toPaise(remainingPrincipal), monthlyRate, futureDueDates.length)
      : toPaise(originalEmi);
  const maxTerm = mode === "reduce_emi" ? futureDueDates.length : futureDueDates.length + 600;
  const installments = [];
  // Exact integer-paise principal carry (REV-20).
  let openingPaise = toPaise(remainingPrincipal);

  for (let index = 0; index < maxTerm && openingPaise > 0; index += 1) {
    const interestPaise = interestForPeriodPaise(openingPaise, monthlyRate);
    const scheduledPrincipal = Math.max(0, emiPaise - interestPaise);
    const isFinal = mode === "reduce_emi" ? index === futureDueDates.length - 1 : scheduledPrincipal >= openingPaise;
    const principalPaise = isFinal ? openingPaise : Math.min(openingPaise, scheduledPrincipal);
    const closingPaise = Math.max(0, openingPaise - principalPaise);
    const dueDate =
      futureDueDates[index] ??
      addMonthsUtc(new Date(`${futureDueDates[futureDueDates.length - 1]}T00:00:00.000Z`), index - futureDueDates.length + 1)
        .toISOString()
        .slice(0, 10);

    installments.push({
      installmentNumber: startNumber + index,
      dueDate,
      openingPrincipal: fromPaise(openingPaise),
      principalDue: fromPaise(principalPaise),
      interestDue: fromPaise(interestPaise),
      totalDue: fromPaise(principalPaise + interestPaise),
      closingPrincipal: fromPaise(closingPaise),
      status: "scheduled"
    });
    openingPaise = closingPaise;
  }

  return installments;
}

function addMonthsUtc(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function delinquencyBucket(daysPastDue) {
  if (daysPastDue <= 0) {
    return "current";
  }
  if (daysPastDue <= 30) {
    return "dpd_1_30";
  }
  if (daysPastDue <= 60) {
    return "dpd_31_60";
  }
  if (daysPastDue <= 90) {
    return "dpd_61_90";
  }
  return "dpd_90_plus";
}

function assetClassFromDpd(daysPastDue) {
  if (daysPastDue <= 0) {
    return "standard";
  }
  if (daysPastDue <= 30) {
    return "sma_0";
  }
  if (daysPastDue <= 60) {
    return "sma_1";
  }
  if (daysPastDue <= 90) {
    return "sma_2";
  }
  return "npa";
}

function sameIndiaDate(a, b) {
  return indiaDateKey(a) === indiaDateKey(b);
}

function indiaDateKey(date) {
  return new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeChargeCatalog(kfs) {
  return [...(kfs?.charges ?? []), ...(kfs?.contingentCharges ?? []), ...(kfs?.penalCharges ?? [])].map((charge) => ({
    name: charge.name,
    reason: charge.reason ?? null,
    type: charge.type ?? "charge",
    amount: charge.amount ?? null,
    capitalizes: Boolean(charge.capitalizes)
  }));
}

function findDisclosedCharge(catalog, name) {
  return catalog.find((charge) => charge.name === name) ?? null;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// Money is transported as rupee floats rounded to 2 decimal places (paisa),
// but 0.01 has no exact binary floating-point representation — the classic
// 0.1 + 0.2 !== 0.3 problem — so summing many already-rounded ledger amounts
// with plain `+` can drift by fractions of a paisa, especially over a ledger
// with hundreds of events across a loan's life. toPaise/fromPaise convert to
// and from integer paise, where addition is exact (values here stay far
// below Number.MAX_SAFE_INTEGER), so sumMoney below eliminates that drift
// class without changing the external rupee-float representation any
// existing caller or test observes.
function toPaise(rupees) {
  return Math.round((Number(rupees) || 0) * 100);
}

function fromPaise(paise) {
  return paise / 100;
}

// Sums a `selector(item)` rupee amount across `items` using exact integer
// paise arithmetic, returning a rupee float rounded to 2 decimals — a
// drop-in, drift-free replacement for `roundMoney(items.reduce((s, x) => s +
// (selector(x) ?? 0), 0))`.
function sumMoney(items, selector) {
  const totalPaise = (items ?? []).reduce((sum, item) => sum + toPaise(selector(item) ?? 0), 0);
  return fromPaise(totalPaise);
}
