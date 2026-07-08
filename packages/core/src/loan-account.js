import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";

const ACTIVE_STATUS = "active";
const CLOSED_STATUS = "closed";

export function generateRepaymentSchedule(input) {
  const principalAmount = roundMoney(input.principalAmount);
  const annualInterestRateBps = input.annualInterestRateBps ?? 0;
  const tenorMonths = input.tenorMonths;
  const startDate = input.startDate ? new Date(input.startDate) : new Date();
  const findings = [];

  if (!Number.isFinite(principalAmount) || principalAmount <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "principalAmount must be positive.", "principalAmount"));
  }
  if (!Number.isFinite(tenorMonths) || tenorMonths <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "tenorMonths must be positive.", "tenorMonths"));
  }
  if (!Number.isFinite(annualInterestRateBps) || annualInterestRateBps < 0) {
    findings.push(createFinding("error", "RBI-KFS-2024", "annualInterestRateBps must be non-negative.", "annualInterestRateBps"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      schedule: [],
      findings,
      summary
    };
  }

  const monthlyRate = annualInterestRateBps / 10000 / 12;
  const emi = monthlyRate === 0
    ? roundMoney(principalAmount / tenorMonths)
    : roundMoney((principalAmount * monthlyRate * (1 + monthlyRate) ** tenorMonths) / ((1 + monthlyRate) ** tenorMonths - 1));
  const schedule = [];
  let openingPrincipal = principalAmount;

  for (let index = 1; index <= tenorMonths; index += 1) {
    const interestDue = roundMoney(openingPrincipal * monthlyRate);
    const principalDue =
      index === tenorMonths ? openingPrincipal : roundMoney(Math.min(openingPrincipal, Math.max(0, emi - interestDue)));
    const closingPrincipal = roundMoney(Math.max(0, openingPrincipal - principalDue));

    schedule.push({
      installmentNumber: index,
      dueDate: addMonthsUtc(startDate, index).toISOString().slice(0, 10),
      openingPrincipal,
      principalDue,
      interestDue,
      totalDue: roundMoney(principalDue + interestDue),
      closingPrincipal,
      status: "scheduled"
    });

    openingPrincipal = closingPrincipal;
  }

  return {
    schedule,
    findings,
    summary
  };
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
  const scheduleResult = generateRepaymentSchedule({
    principalAmount,
    annualInterestRateBps,
    tenorMonths,
    startDate: disbursement.disbursedAt ?? now.toISOString()
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
    type: "disbursement",
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
    status: ACTIVE_STATUS,
    currency: application.kfs?.currency ?? application.product?.currency ?? "INR",
    principalAmount: roundMoney(principalAmount),
    annualInterestRateBps,
    aprBps: application.kfs?.aprBps ?? application.product?.aprBps ?? annualInterestRateBps,
    tenorMonths,
    repaymentFrequency: application.kfs?.repaymentFrequency ?? application.product?.repaymentFrequency ?? "monthly",
    openedAt: now.toISOString(),
    disclosedChargeCatalog: normalizeChargeCatalog(application.kfs),
    schedule: scheduleResult.schedule,
    ledger: [disbursementEvent]
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
  const principalDisbursed = roundMoney(ledger.reduce((sum, event) => sum + (event.principalDebit ?? 0), 0));
  const principalPaid = roundMoney(ledger.reduce((sum, event) => sum + (event.principalCredit ?? 0), 0));
  const interestPaid = roundMoney(ledger.reduce((sum, event) => sum + (event.interestCredit ?? 0), 0));
  const interestAccrued = roundMoney(ledger.reduce((sum, event) => sum + (event.interestDebit ?? 0), 0));
  const chargesAssessed = roundMoney(ledger.reduce((sum, event) => sum + (event.chargesDebit ?? 0), 0));
  const chargesWaived = roundMoney(ledger.reduce((sum, event) => sum + (event.chargesWaiverCredit ?? 0), 0));
  const chargesPaid = roundMoney(ledger.reduce((sum, event) => sum + (event.chargesCredit ?? 0), 0));
  const totalPaid = roundMoney(principalPaid + interestPaid + chargesPaid);
  const principalOutstanding = roundMoney(Math.max(0, principalDisbursed - principalPaid));
  const interestDueAsOf = roundMoney(
    (account.schedule ?? [])
      .filter((installment) => new Date(`${installment.dueDate}T00:00:00.000Z`).getTime() <= asOf.getTime())
      .reduce((sum, installment) => sum + installment.interestDue, 0)
  );
  const principalDueAsOf = roundMoney(
    (account.schedule ?? [])
      .filter((installment) => new Date(`${installment.dueDate}T00:00:00.000Z`).getTime() <= asOf.getTime())
      .reduce((sum, installment) => sum + installment.principalDue, 0)
  );
  const interestOutstanding = roundMoney(Math.max(0, interestDueAsOf - interestPaid));
  const chargesOutstanding = roundMoney(Math.max(0, chargesAssessed - chargesWaived - chargesPaid));
  const principalOverdue = roundMoney(Math.max(0, principalDueAsOf - principalPaid));
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
    totalPaid,
    principalOutstanding,
    interestOutstanding,
    chargesOutstanding,
    principalOverdue,
    totalOutstanding: roundMoney(principalOutstanding + interestOutstanding + chargesOutstanding),
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

export function computeDelinquency(account, asOf = new Date()) {
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
  const assetClass = assetClassFromDpd(delinquency.daysPastDue);

  return {
    asOf: asOf.toISOString(),
    assetClass,
    daysPastDue: delinquency.daysPastDue,
    delinquencyBucket: delinquency.bucket,
    isNpa: assetClass === "npa",
    basis: "days_past_due",
    npaThresholdDays: 90,
    delinquency
  };
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
    openedAt: account.openedAt,
    closedAt: account.closedAt ?? null,
    sanctionedAmount: account.principalAmount,
    currentBalance: summary.principalOutstanding,
    amountOverdue: classification.delinquency.totalOverdue,
    daysPastDue: classification.daysPastDue,
    assetClass: classification.assetClass,
    delinquencyBucket: classification.delinquencyBucket,
    isNpa: classification.isNpa,
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

export function assignRecoveryAgent(account, input, now = new Date()) {
  const findings = [];
  const assignedAt = input?.assignedAt ? new Date(input.assignedAt) : now;
  const noticeSentAt = input?.noticeSentAt ? new Date(input.noticeSentAt) : null;
  const delinquency = account ? computeDelinquency(account, assignedAt) : null;

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

  const initialSummary = summarizeFindings(findings);
  if (initialSummary.status === "blocked") {
    return {
      loanAccount: account,
      paymentEvent: null,
      findings,
      summary: initialSummary
    };
  }

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : now;
  const balance = summarizeLoanAccount(account, receivedAt);
  let remaining = roundMoney(input.amount);
  const interestCredit = roundMoney(Math.min(remaining, balance.interestOutstanding));
  remaining = roundMoney(remaining - interestCredit);
  const chargesCredit = roundMoney(Math.min(remaining, balance.chargesOutstanding));
  remaining = roundMoney(remaining - chargesCredit);
  const principalCredit = roundMoney(Math.min(remaining, balance.principalOutstanding));
  remaining = roundMoney(remaining - principalCredit);
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
    actor: input.actor ?? "system"
  };
  const updatedLedger = [...(account.ledger ?? []), paymentEvent];
  const updated = {
    ...account,
    ledger: updatedLedger,
    status: roundMoney(balance.principalOutstanding - principalCredit) === 0 ? CLOSED_STATUS : ACTIVE_STATUS,
    closedAt: roundMoney(balance.principalOutstanding - principalCredit) === 0 ? receivedAt.toISOString() : account.closedAt ?? null,
    updatedAt: now.toISOString()
  };

  return {
    loanAccount: updated,
    paymentEvent,
    findings,
    summary: summarizeFindings(findings)
  };
}

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
    assignmentId: activeAssignment.assignmentId
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

// Foreclosure lets a borrower settle early by paying outstanding principal plus
// interest and charges already due as of the foreclosure date. Future interest
// is not owed. Any foreclosure charge must be disclosed in the KFS to be
// applied, mirroring the KFS charge-disclosure control on ordinary charges.
export function quoteForeclosure(account, input = {}, now = new Date()) {
  const findings = [];
  const asOf = input.asOf ? new Date(input.asOf) : now;

  if (!account) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount"));
  }
  if (account && account.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Only an active loan account can be foreclosed.", "status"));
  }

  let foreclosureCharge = 0;
  let disclosedChargeRef = null;
  if (input.foreclosureChargeName) {
    const disclosed = findDisclosedCharge(account?.disclosedChargeCatalog ?? [], input.foreclosureChargeName);
    if (!disclosed) {
      findings.push(createFinding("error", "RBI-KFS-2024", "Foreclosure charge must be disclosed in KFS.", "foreclosureChargeName"));
    } else {
      foreclosureCharge = roundMoney(disclosed.amount ?? input.foreclosureChargeAmount ?? 0);
      disclosedChargeRef = disclosed.name;
    }
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked" || !account) {
    return { quote: null, findings, summary };
  }

  const balance = summarizeLoanAccount(account, asOf);
  return {
    quote: {
      asOf: asOf.toISOString(),
      principalOutstanding: balance.principalOutstanding,
      interestOutstanding: balance.interestOutstanding,
      chargesOutstanding: balance.chargesOutstanding,
      foreclosureCharge,
      disclosedChargeRef,
      payoffAmount: roundMoney(
        balance.principalOutstanding + balance.interestOutstanding + balance.chargesOutstanding + foreclosureCharge
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
    chargeType: input.type ?? disclosedCharge.type ?? "charge",
    reason: input.reason,
    disclosedChargeRef: disclosedCharge.name,
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
    openingSummary: summarizeLoanAccount(account, openingAsOf),
    closingSummary: summarizeLoanAccount(account, periodEnd),
    scheduledDues,
    transactions,
    totals: {
      principalDue: roundMoney(scheduledDues.reduce((sum, installment) => sum + installment.principalDue, 0)),
      interestDue: roundMoney(scheduledDues.reduce((sum, installment) => sum + installment.interestDue, 0)),
      chargesAssessed: roundMoney(transactions.reduce((sum, event) => sum + (event.chargesDebit ?? 0), 0)),
      chargesWaived: roundMoney(transactions.reduce((sum, event) => sum + (event.chargesWaiverCredit ?? 0), 0)),
      payments: roundMoney(
        transactions
          .filter((event) => event.type === "payment")
          .reduce((sum, event) => sum + (event.amount ?? 0), 0)
      )
    }
  };
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
