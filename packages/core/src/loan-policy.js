import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { evaluateModelUse } from "./model-governance.js";
import { GST_RATE_BPS, summarizeGst, withGstDisclosure } from "./tax.js";
import { randomUUID } from "node:crypto";
import { generateContractualSchedule, periodsForTenor, periodsPerYearForFrequency } from "./repayment-schedule.js";

export const ALLOWED_RE_TYPES = new Set([
  "commercial_bank",
  "small_finance_bank",
  "cooperative_bank",
  "nbfc",
  "hfc",
  "all_india_financial_institution"
]);

export const ALLOWED_CHARGE_TYPES = new Set([
  "processing_fee",
  "verification_charge",
  "maintenance_charge",
  "documentation_charge",
  "stamp_duty",
  "legal_charge",
  "insurance_premium",
  "valuation_fee",
  "contingent_charge",
  "penal_charge",
  "prepayment_charge",
  "foreclosure_charge",
  "late_payment_penalty",
  "other",
  // Compatibility fallbacks
  "fixed",
  "bps"
]);

const ALLOWED_LOAN_CURRENCIES = new Set(["INR"]);
const ALLOWED_ACCOUNT_ROLES_FOR_DISBURSEMENT = new Set(["borrower", "end_beneficiary"]);
const PROHIBITED_FUND_CONTROL_ROLES = new Set(["lsp", "dla", "pass_through", "pool_account"]);

export function createLoanId(prefix = "loan") {
  return `${prefix}_${randomUUID()}`;
}

function roundMoney(value) {
  return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : null;
}

function addWorkingDays(date, days) {
  const result = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
}

function calculateCashFlowAprBps(principalAmount, upfrontCharges, schedule, periodsPerYear = 12) {
  const netDisbursal = principalAmount - upfrontCharges;
  if (!Number.isFinite(netDisbursal) || netDisbursal <= 0 || !Array.isArray(schedule) || schedule.length === 0) return null;
  let low = 0;
  let high = 10;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const rate = (low + high) / 2;
    const presentValue = schedule.reduce((sum, row, index) => sum + row.totalDue / ((1 + rate) ** (index + 1)), 0);
    if (presentValue > netDisbursal) low = rate;
    else high = rate;
  }
  const monthlyIrr = (low + high) / 2;
  return Math.round((((1 + monthlyIrr) ** periodsPerYear) - 1) * 10000);
}

export function calculateAgeYears(dateOfBirth, now = new Date()) {
  if (!dateOfBirth) {
    return null;
  }
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) {
    return null;
  }

  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  const dayDiff = now.getUTCDate() - birth.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  return age;
}

export function evaluateLoanApplication(application, options = {}) {
  const findings = [];
  const now = options.now ?? new Date();
  const modelRegistry = options.modelRegistry;

  checkTenant(application, findings);
  checkIndiaOnly(application, findings);
  checkConsent(application, findings);
  checkKyc(application, findings);
  checkEconomicProfile(application, findings, now);
  checkProduct(application, findings);
  checkDataResidency(application, findings);
  checkFundFlow(application, findings);
  checkKfsIfPresent(application, findings);
  checkAiDecision(application, findings, modelRegistry);

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function buildKeyFactStatement(application, terms, now = new Date()) {
  const product = application.product ?? {};
  const charges = Array.isArray(terms?.charges) ? terms.charges : product.charges ?? [];
  const contingentCharges = Array.isArray(terms?.contingentCharges)
    ? terms.contingentCharges
    : product.contingentCharges ?? [];
  const penalCharges = Array.isArray(terms?.penalCharges) ? terms.penalCharges : product.penalCharges ?? [];

  // Disclose GST on each fee (REV-42). Disclosed charge amounts are GST-inclusive;
  // each charge carries its base/GST breakdown, and a fee summary totals them so
  // the borrower sees net fees, GST, and the all-in payable on the KFS.
  const chargesWithGst = charges.map(withGstDisclosure);
  const contingentChargesWithGst = contingentCharges.map(withGstDisclosure);
  const penalChargesWithGst = penalCharges.map(withGstDisclosure);

  const principalAmount = terms?.principalAmount ?? product.requestedAmount ?? null;
  const tenorMonths = terms?.tenorMonths ?? product.requestedTenorMonths ?? product.defaultTenorMonths ?? null;
  const annualInterestRateBps = terms?.annualInterestRateBps ?? product.annualInterestRateBps ?? null;
  const facilityType = terms?.facilityType ?? product.facilityType ?? "term_loan";
  const isRevolving = ["revolving_credit", "overdraft"].includes(facilityType);
  const repaymentFrequency = terms?.repaymentFrequency ?? product.repaymentFrequency ?? "monthly";
  const repaymentStructure = isRevolving ? "bullet" : (terms?.repaymentStructure ?? product.repaymentStructure ?? "amortizing");
  const illustrativePrincipalAmount = isRevolving ? (terms?.creditLimit ?? product.creditLimit) : principalAmount;
  const scheduleResult = generateContractualSchedule({ principalAmount: illustrativePrincipalAmount, annualInterestRateBps, tenorMonths, startDate: now, repaymentFrequency, repaymentStructure, moratoriumPeriods: terms?.moratoriumPeriods ?? product.moratoriumPeriods ?? 0, moratoriumInterestTreatment: terms?.moratoriumInterestTreatment ?? product.moratoriumInterestTreatment ?? "serviced", stepUpBps: terms?.stepUpBps ?? product.stepUpBps ?? 0, stepUpEveryPeriods: terms?.stepUpEveryPeriods ?? product.stepUpEveryPeriods });
  const amortizationSchedule = scheduleResult.schedule;
  const mandatoryUpfrontCharges = chargesWithGst.reduce(
    (sum, charge) => sum + (Number.isFinite(charge.amount) ? charge.amount : 0),
    0
  );
  const aprBps = calculateCashFlowAprBps(illustrativePrincipalAmount, mandatoryUpfrontCharges, amortizationSchedule, periodsPerYearForFrequency(repaymentFrequency));
  const proposalNumber = createLoanId("proposal");
  const validUntil = addWorkingDays(now, tenorMonths && tenorMonths > 0 ? 3 : 1);

  return {
    kfsId: createLoanId("kfs"),
    proposalNumber,
    generatedAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
    borrowerId: application.borrower?.borrowerId ?? null,
    borrowerType: application.borrower?.borrowerType ?? "individual",
    applicationId: application.applicationId ?? null,
    lenderName: application.tenant?.regulatedEntityName ?? null,
    productCode: product.productCode ?? null,
    productType: product.productType ?? null,
    currency: terms?.currency ?? product.currency ?? "INR",
    principalAmount,
    tenorMonths,
    annualInterestRateBps,
    aprBps,
    aprComputation: {
      method: "cash_flow_irr_effective_annual",
      amountDisbursed: roundMoney(illustrativePrincipalAmount - mandatoryUpfrontCharges),
      assumption: isRevolving ? "full_sanctioned_limit_utilized_for_full_tenor" : "contractual_cash_flows",
      mandatoryUpfrontCharges: roundMoney(mandatoryUpfrontCharges),
      installmentCount: amortizationSchedule.length,
      totalRepaymentAmount: roundMoney(amortizationSchedule.reduce((sum, row) => sum + row.totalDue, 0))
    },
    amortizationSchedule,
    repaymentFrequency,
    repaymentStructure: isRevolving ? "revolving" : repaymentStructure,
    scheduleNature: isRevolving ? "illustrative_full_utilization" : "contractual",
    moratoriumPeriods: terms?.moratoriumPeriods ?? product.moratoriumPeriods ?? 0,
    moratoriumInterestTreatment: terms?.moratoriumInterestTreatment ?? product.moratoriumInterestTreatment ?? "serviced",
    stepUpBps: terms?.stepUpBps ?? product.stepUpBps ?? 0,
    stepUpEveryPeriods: terms?.stepUpEveryPeriods ?? product.stepUpEveryPeriods ?? null,
    facilityType,
    facilityTerms: isRevolving ? { creditLimit: terms?.creditLimit ?? product.creditLimit, drawingPower: terms?.drawingPower ?? product.drawingPower ?? product.creditLimit, minimumPaymentPercent: terms?.minimumPaymentPercent ?? product.minimumPaymentPercent, reviewFrequencyMonths: terms?.reviewFrequencyMonths ?? product.reviewFrequencyMonths, facilityExpiryDate: terms?.facilityExpiryDate ?? product.facilityExpiryDate, interestBasis: "daily_utilized_balance_actual_365" } : null,
    coolingOffDays: terms?.coolingOffDays ?? product.coolingOffDays ?? 1,
    charges: chargesWithGst,
    contingentCharges: contingentChargesWithGst,
    penalCharges: penalChargesWithGst,
    taxDisclosure: {
      gstRateBps: GST_RATE_BPS,
      note: "Disclosed charges are inclusive of GST at 18% where applicable; interest, stamp duty, insurance premium, and penal charges are not subject to GST.",
      charges: summarizeGst(chargesWithGst),
      contingentCharges: summarizeGst(contingentChargesWithGst)
    },
    recoveryMechanism: terms?.recoveryMechanism ?? application.repayment?.recoveryMechanism ?? product.recoveryMechanism ?? null,
    grievanceOfficer: terms?.grievanceOfficer ?? application.tenant?.grievanceOfficer ?? null,
    privacyPolicyUrl: terms?.privacyPolicyUrl ?? application.tenant?.privacyPolicyUrl ?? null,
    allFeesDisclosed: true,
    digitallyDeliverable: true,
    interestRateType: product.interestRateType ?? "fixed",
    interestRateResetPolicy: product.interestRateResetPolicy ?? null,
    prepaymentPolicy: product.prepaymentPolicy ?? { allowed: true, chargeBps: 0, lockInMonths: 0 },
    foreclosurePolicy: product.foreclosurePolicy ?? { allowed: true, chargeBps: 0, lockInMonths: 0 }
  };
}

export function attachKfs(application, kfs) {
  return {
    ...application,
    kfs: { ...kfs, acceptedAt: null, acceptedBy: null, acceptanceChannel: null, acceptanceEvidenceRef: null }
  };
}

export function acceptKfs(application, input = {}, now = new Date()) {
  const findings = [];
  if (!application?.kfs) {
    findings.push(createFinding("error", "RBI-KFS-2024", "An issued KFS is required before acceptance.", "kfs"));
  } else if (new Date(application.kfs.validUntil).getTime() < now.getTime()) {
    findings.push(createFinding("error", "RBI-KFS-2024", "The KFS proposal has expired and must be re-issued.", "kfs.validUntil"));
  }
  if (!input.acceptedBy) {
    findings.push(createFinding("error", "RBI-KFS-2024", "KFS acceptance must be bound to the authenticated borrower.", "acceptedBy"));
  }
  if (!input.acceptanceEvidenceRef) {
    findings.push(createFinding("error", "RBI-KFS-2024", "KFS acceptance evidence is required.", "acceptanceEvidenceRef"));
  }
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { application, findings, summary };
  return {
    application: {
      ...application,
      kfs: {
        ...application.kfs,
        acceptedAt: now.toISOString(),
        acceptedBy: input.acceptedBy,
        acceptanceChannel: input.acceptanceChannel ?? "borrower_portal",
        acceptanceEvidenceRef: input.acceptanceEvidenceRef
      }
    },
    findings,
    summary
  };
}

export function validateKfs(kfs) {
  const findings = [];

  if (!kfs) {
    findings.push(createFinding("error", "RBI-KFS-2024", "KFS is required before sanction.", "kfs"));
    return {
      findings,
      summary: summarizeFindings(findings)
    };
  }
  if (!kfs.proposalNumber) {
    findings.push(createFinding("error", "RBI-KFS-2024", "KFS must carry a unique proposal number.", "kfs.proposalNumber"));
  }
  if (!kfs.validUntil || Number.isNaN(new Date(kfs.validUntil).getTime())) {
    findings.push(createFinding("error", "RBI-KFS-2024", "KFS must carry a valid proposal expiry.", "kfs.validUntil"));
  }
  if (kfs.currency !== "INR") {
    findings.push(createFinding("error", "RBI-KFS-2024", "KFS currency must be INR for India-only lending.", "kfs.currency"));
  }
  if (!Number.isFinite(kfs.aprBps) || kfs.aprBps < 0) {
    findings.push(createFinding("error", "RBI-KFS-2024", "KFS must disclose APR in basis points.", "kfs.aprBps"));
  }
  if (!Number.isFinite(kfs.principalAmount) || kfs.principalAmount <= 0) {
    findings.push(createFinding("error", "RBI-KFS-2024", "KFS must disclose principal amount.", "kfs.principalAmount"));
  }
  if (!Number.isFinite(kfs.tenorMonths) || kfs.tenorMonths <= 0) {
    findings.push(createFinding("error", "RBI-KFS-2024", "KFS must disclose tenorMonths.", "kfs.tenorMonths"));
  }
  if (!kfs.aprComputation?.method || !Number.isFinite(kfs.aprComputation?.totalRepaymentAmount)) {
    findings.push(createFinding("error", "RBI-KFS-2024", "KFS must include an APR computation sheet.", "kfs.aprComputation"));
  }
  const expectedInstallmentCount = periodsForTenor(kfs.tenorMonths, kfs.repaymentFrequency);
  if (!Array.isArray(kfs.amortizationSchedule) || kfs.amortizationSchedule.length !== expectedInstallmentCount) {
    findings.push(createFinding("error", "RBI-KFS-2024", "KFS must include the complete amortisation schedule.", "kfs.amortizationSchedule"));
  }
  if (["revolving_credit", "overdraft"].includes(kfs.facilityType) && (!Number.isFinite(kfs.facilityTerms?.creditLimit) || !Number.isFinite(kfs.facilityTerms?.drawingPower) || !kfs.facilityTerms?.facilityExpiryDate || kfs.scheduleNature !== "illustrative_full_utilization")) findings.push(createFinding("error", "RBI-KFS-2024", "Revolving KFS must disclose limit, drawing power, expiry, daily-interest basis, and illustrative cash flows.", "kfs.facilityTerms"));
  if (!Number.isFinite(kfs.coolingOffDays) || kfs.coolingOffDays < 1) {
    findings.push(createFinding("error", "RBI-KFS-2024", "Digital loans require coolingOffDays of at least one day.", "kfs.coolingOffDays"));
  }
  if (!kfs.grievanceOfficer?.name || !kfs.grievanceOfficer?.email) {
    findings.push(createFinding("error", "RBI-DL-2025", "KFS must include grievance officer name and email.", "kfs.grievanceOfficer"));
  }
  if (!kfs.recoveryMechanism) {
    findings.push(createFinding("error", "RBI-DL-2025", "KFS must disclose recovery mechanism.", "kfs.recoveryMechanism"));
  }

  // Prepayment & Foreclosure validations in KFS
  const rateType = kfs.interestRateType ?? "fixed";
  const bType = kfs.borrowerType ?? "individual";
  const isBusiness = kfs.productType === "business_loan" || kfs.productType === "msme_loan";

  if (rateType === "floating" && bType === "individual" && !isBusiness) {
    if (kfs.prepaymentPolicy?.chargeBps > 0) {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Prepayment penalty is prohibited on floating-rate individual retail loans.", "kfs.prepaymentPolicy.chargeBps"));
    }
    if (kfs.foreclosurePolicy?.chargeBps > 0) {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Foreclosure charge is prohibited on floating-rate individual retail loans.", "kfs.foreclosurePolicy.chargeBps"));
    }
  }

  for (const charge of [...(kfs.charges ?? []), ...(kfs.penalCharges ?? [])]) {
    if (!charge.name || !charge.reason) {
      findings.push(createFinding("error", "RBI-KFS-2024", "Each KFS charge must include name and reason.", "kfs.charges"));
    }
    if (!charge.type) {
      findings.push(createFinding("error", "RBI-KFS-2024", "Each KFS charge must include a type.", "kfs.charges"));
    } else if (!ALLOWED_CHARGE_TYPES.has(charge.type)) {
      findings.push(createFinding("error", "RBI-KFS-2024", "KFS charge type is invalid.", "kfs.charges"));
    }
    if (charge.type === "penal_interest") {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Penalties must not be represented as penal interest.", "kfs.penalCharges"));
    }
    if (charge.capitalizes === true) {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Penal charges must not be capitalized.", "kfs.penalCharges"));
    }

    if (rateType === "floating" && bType === "individual" && !isBusiness) {
      const name = (charge.name ?? "").toLowerCase();
      const reason = (charge.reason ?? "").toLowerCase();
      if ((name.includes("foreclosure") || name.includes("prepayment") || reason.includes("foreclosure") || reason.includes("prepayment")) && (charge.amount > 0 || charge.chargeBps > 0)) {
        findings.push(createFinding("error", "RBI-FPC-PENAL", `Charge '${charge.name}' is prohibited on floating-rate individual retail loans.`, "kfs.charges"));
      }
    }
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function validateKfsBeforeDecision(application) {
  const kfsResult = validateKfs(application.kfs);
  const findings = [...kfsResult.findings];

  if (application.kfs && !application.kfs.acceptedAt) {
    findings.push(createFinding("error", "RBI-KFS-2024", "Borrower KFS acceptance is required before sanction.", "kfs.acceptedAt"));
  }
  if (application.kfs && !application.kfs.deliveryRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "Digitally delivered KFS evidence is required.", "kfs.deliveryRef"));
  }

  if (application.kfs && application.product) {
    const kfs = application.kfs;
    const product = application.product;

    const expectedPrincipal = product.requestedAmount;
    const expectedTenor = product.requestedTenorMonths ?? product.defaultTenorMonths;
    if (Number.isFinite(expectedPrincipal) && kfs.principalAmount !== expectedPrincipal) {
      findings.push(createFinding("error", "RBI-KFS-2024", "KFS principal does not match the approved application amount.", "kfs.principalAmount"));
    }
    if (Number.isFinite(expectedTenor) && kfs.tenorMonths !== expectedTenor) {
      findings.push(createFinding("error", "RBI-KFS-2024", "KFS tenor does not match the approved application tenor.", "kfs.tenorMonths"));
    }
    if (Number.isFinite(product.annualInterestRateBps) && kfs.annualInterestRateBps !== product.annualInterestRateBps) {
      findings.push(createFinding("error", "RBI-KFS-2024", "KFS interest rate does not match the approved product pricing.", "kfs.annualInterestRateBps"));
    }

    const validateChargeList = (kfsList, productList, path) => {
      if (!Array.isArray(kfsList)) return;
      const prodList = Array.isArray(productList) ? productList : [];
      for (const charge of kfsList) {
        if (!charge.name) continue;
        const matching = prodList.find(p => p.name === charge.name);
        if (!matching) {
          findings.push(createFinding(
            "error",
            "RBI-KFS-2024",
            `KFS charge '${charge.name}' is not disclosed in the product policy.`,
            `${path}.name`
          ));
        } else {
          if (Number.isFinite(charge.amount) && Number.isFinite(matching.amount) && charge.amount > matching.amount) {
            findings.push(createFinding(
              "error",
              "RBI-KFS-2024",
              `KFS charge '${charge.name}' amount (${charge.amount}) exceeds the product policy limit of ${matching.amount}.`,
              `${path}.amount`
            ));
          }
          if (Number.isFinite(charge.chargeBps) && Number.isFinite(matching.chargeBps) && charge.chargeBps > matching.chargeBps) {
            findings.push(createFinding(
              "error",
              "RBI-KFS-2024",
              `KFS charge '${charge.name}' rate (${charge.chargeBps} bps) exceeds the product policy limit of ${matching.chargeBps} bps.`,
              `${path}.chargeBps`
            ));
          }
        }
      }
    };

    validateChargeList(kfs.charges, product.charges, "kfs.charges");
    validateChargeList(kfs.penalCharges, product.penalCharges, "kfs.penalCharges");
    validateChargeList(kfs.contingentCharges, product.contingentCharges, "kfs.contingentCharges");

    if (kfs.prepaymentPolicy && product.prepaymentPolicy) {
      if (kfs.prepaymentPolicy.allowed === true && product.prepaymentPolicy.allowed === false) {
        findings.push(createFinding(
          "error",
          "RBI-KFS-2024",
          "KFS allows prepayment but product policy prohibits it.",
          "kfs.prepaymentPolicy.allowed"
        ));
      }
      if (Number.isFinite(kfs.prepaymentPolicy.chargeBps) && Number.isFinite(product.prepaymentPolicy.chargeBps) && kfs.prepaymentPolicy.chargeBps > product.prepaymentPolicy.chargeBps) {
        findings.push(createFinding(
          "error",
          "RBI-KFS-2024",
          `KFS prepayment fee rate (${kfs.prepaymentPolicy.chargeBps} bps) exceeds the product policy limit of ${product.prepaymentPolicy.chargeBps} bps.`,
          "kfs.prepaymentPolicy.chargeBps"
        ));
      }
      if (Number.isFinite(kfs.prepaymentPolicy.lockInMonths) && Number.isFinite(product.prepaymentPolicy.lockInMonths) && kfs.prepaymentPolicy.lockInMonths > product.prepaymentPolicy.lockInMonths) {
        findings.push(createFinding(
          "error",
          "RBI-KFS-2024",
          `KFS prepayment lock-in period (${kfs.prepaymentPolicy.lockInMonths} months) exceeds the product policy limit of ${product.prepaymentPolicy.lockInMonths} months.`,
          "kfs.prepaymentPolicy.lockInMonths"
        ));
      }
    }

    if (kfs.foreclosurePolicy && product.foreclosurePolicy) {
      if (kfs.foreclosurePolicy.allowed === true && product.foreclosurePolicy.allowed === false) {
        findings.push(createFinding(
          "error",
          "RBI-KFS-2024",
          "KFS allows foreclosure but product policy prohibits it.",
          "kfs.foreclosurePolicy.allowed"
        ));
      }
      if (Number.isFinite(kfs.foreclosurePolicy.chargeBps) && Number.isFinite(product.foreclosurePolicy.chargeBps) && kfs.foreclosurePolicy.chargeBps > product.foreclosurePolicy.chargeBps) {
        findings.push(createFinding(
          "error",
          "RBI-KFS-2024",
          `KFS foreclosure fee rate (${kfs.foreclosurePolicy.chargeBps} bps) exceeds the product policy limit of ${product.foreclosurePolicy.chargeBps} bps.`,
          "kfs.foreclosurePolicy.chargeBps"
        ));
      }
      if (Number.isFinite(kfs.foreclosurePolicy.lockInMonths) && Number.isFinite(product.foreclosurePolicy.lockInMonths) && kfs.foreclosurePolicy.lockInMonths > product.foreclosurePolicy.lockInMonths) {
        findings.push(createFinding(
          "error",
          "RBI-KFS-2024",
          `KFS foreclosure lock-in period (${kfs.foreclosurePolicy.lockInMonths} months) exceeds the product policy limit of ${product.foreclosurePolicy.lockInMonths} months.`,
          "kfs.foreclosurePolicy.lockInMonths"
        ));
      }
    }
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function validateDisbursement(application, disbursement) {
  const findings = [];

  if (application.status !== "approved") {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan must be approved before disbursement.", "status"));
  }
  const kfsDecision = validateKfsBeforeDecision(application);
  findings.push(...kfsDecision.findings);

  const destination = disbursement?.destinationAccount;
  if (!destination) {
    findings.push(createFinding("error", "RBI-DL-2025", "Disbursement destinationAccount is required.", "destinationAccount"));
  } else {
    checkAccountIndia("RBI-DL-2025", "Disbursement destination account", destination, "destinationAccount", findings);
    checkNoProhibitedFundControl(destination.ownerRole, "destinationAccount.ownerRole", findings);
    checkDisbursementAccountVerification(destination, "destinationAccount", findings);
    if (!ALLOWED_ACCOUNT_ROLES_FOR_DISBURSEMENT.has(destination.ownerRole)) {
      findings.push(
        createFinding(
          "error",
          "RBI-DL-2025",
          "Disbursement must go to borrower or permitted end-beneficiary account.",
          "destinationAccount.ownerRole"
        )
      );
    }
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

function checkTenant(application, findings) {
  if (!application.regulatedEntityId) {
    findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityId is required.", "regulatedEntityId"));
  }
  const tenant = application.tenant;
  if (!tenant) {
    findings.push(createFinding("error", "RBI-DL-2025", "Tenant (regulated entity) details are missing.", "tenant"));
    return;
  }
  if (!tenant.regulatedEntityName) {
    findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityName is required.", "tenant.regulatedEntityName"));
  }
  if (!tenant.regulatedEntityType || !ALLOWED_RE_TYPES.has(tenant.regulatedEntityType)) {
    findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityType must be an RBI-covered RE type.", "tenant.regulatedEntityType"));
  }
  if (!tenant.rbiRegistrationNumber || typeof tenant.rbiRegistrationNumber !== "string" || tenant.rbiRegistrationNumber.trim() === "") {
    findings.push(createFinding("error", "RBI-DL-2025", "rbiRegistrationNumber is required and cannot be empty.", "tenant.rbiRegistrationNumber"));
  }
  if (!tenant.grievanceOfficer?.name || !tenant.grievanceOfficer?.email) {
    findings.push(createFinding("error", "RBI-DL-2025", "Tenant must configure grievance officer name and email.", "tenant.grievanceOfficer"));
  }

  // Validate licenseMetadata in preflight
  if (!tenant.licenseMetadata || typeof tenant.licenseMetadata !== "object") {
    findings.push(createFinding("error", "RBI-DL-2025", "Tenant license metadata is required.", "tenant.licenseMetadata"));
  } else {
    if (!tenant.licenseMetadata.category || typeof tenant.licenseMetadata.category !== "string" || tenant.licenseMetadata.category.trim() === "") {
      findings.push(createFinding("error", "RBI-DL-2025", "Tenant license category is required.", "tenant.licenseMetadata.category"));
    }
    if (!tenant.licenseMetadata.licenseNumber || typeof tenant.licenseMetadata.licenseNumber !== "string" || tenant.licenseMetadata.licenseNumber.trim() === "") {
      findings.push(createFinding("error", "RBI-DL-2025", "Tenant license number is required.", "tenant.licenseMetadata.licenseNumber"));
    }
    if (!tenant.licenseMetadata.issuingAuthority || typeof tenant.licenseMetadata.issuingAuthority !== "string" || tenant.licenseMetadata.issuingAuthority.trim() === "") {
      findings.push(createFinding("error", "RBI-DL-2025", "Tenant license issuing authority is required.", "tenant.licenseMetadata.issuingAuthority"));
    }
    if (!tenant.licenseMetadata.issueDate || isNaN(Date.parse(tenant.licenseMetadata.issueDate))) {
      findings.push(createFinding("error", "RBI-DL-2025", "Tenant license issue date must be a valid date.", "tenant.licenseMetadata.issueDate"));
    } else if (new Date(tenant.licenseMetadata.issueDate) > new Date()) {
      findings.push(createFinding("error", "RBI-DL-2025", "Tenant license issue date cannot be in the future.", "tenant.licenseMetadata.issueDate"));
    }
    if (!tenant.licenseMetadata.status || !["active", "valid"].includes(tenant.licenseMetadata.status)) {
      findings.push(createFinding("error", "RBI-DL-2025", "Tenant license status must be 'active' or 'valid'.", "tenant.licenseMetadata.status"));
    }
  }
}

function checkIndiaOnly(application, findings) {
  const borrower = application.borrower;
  if (borrower?.residencyCountry !== "IN") {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower residencyCountry must be IN.", "borrower.residencyCountry"));
  }
  if (borrower?.primaryAddressCountry !== "IN") {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower primaryAddressCountry must be IN.", "borrower.primaryAddressCountry"));
  }
  if (application.product?.currency && !ALLOWED_LOAN_CURRENCIES.has(application.product.currency)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loan currency must be INR.", "product.currency"));
  }
}

function checkConsent(application, findings) {
  const consent = application.consent;
  if (!consent?.dataProcessingAcceptedAt) {
    findings.push(createFinding("error", "DPDP-2023", "Data processing consent/evidence is required.", "consent.dataProcessingAcceptedAt"));
  }
  if (!consent?.noticeVersion) {
    findings.push(createFinding("error", "DPDP-RULES-2025", "Consent noticeVersion is required.", "consent.noticeVersion"));
  }
  if (application.thirdPartySharing?.enabled && !consent?.thirdPartySharingAcceptedAt) {
    findings.push(createFinding("error", "RBI-DL-2025", "Explicit consent is required before third-party data sharing.", "consent.thirdPartySharingAcceptedAt"));
  }
}

function checkKyc(application, findings) {
  const kyc = application.kyc;
  if (kyc?.status !== "verified") {
    findings.push(createFinding("error", "RBI-KYC-2016", "KYC status must be verified before lending.", "kyc.status"));
  }
  if (
    kyc?.status === "verified" &&
    (kyc.screening?.status !== "clear" ||
      !kyc.screening?.screenedAt ||
      !kyc.screening?.evidenceRef ||
      !["unsc", "uapa", "pep"].every((source) => kyc.screening?.sources?.includes(source)))
  ) {
    findings.push(createFinding("error", "RBI-KYC-2016", "Verified KYC requires current sanctions, UAPA and PEP screening evidence.", "kyc.screening"));
  }
  if (kyc?.riskCategory && !["low", "medium", "high"].includes(kyc.riskCategory)) {
    findings.push(createFinding("error", "RBI-KYC-2016", "KYC riskCategory must be low, medium, or high.", "kyc.riskCategory"));
  }
  if (kyc?.aadhaar?.biometricStored === true || kyc?.aadhaar?.otpStored === true || kyc?.aadhaar?.pidStored === true) {
    findings.push(
      createFinding("error", "UIDAI-AADHAAR", "Aadhaar biometric, OTP, or PID data must not be stored.", "kyc.aadhaar")
    );
  }
  if (kyc?.vCip?.used && kyc.vCip.storageCountry !== "IN") {
    findings.push(createFinding("error", "RBI-KYC-2016", "V-CIP recordings and logs must be stored in India.", "kyc.vCip.storageCountry"));
  }
}

function checkEconomicProfile(application, findings, now) {
  const borrower = application.borrower;
  const profile = application.economicProfile;
  // Age and occupation are meaningful only for a natural-person borrower; a
  // legal-entity borrower (company/partnership/llp/trust) is identified by
  // its legalName and beneficial owners instead (see borrower-onboarding.js).
  const isIndividual = (borrower?.borrowerType ?? "individual") === "individual";

  if (isIndividual) {
    const age = borrower?.dateOfBirth ? calculateAgeYears(borrower.dateOfBirth, now) : borrower?.ageYears;
    if (!Number.isFinite(age) || age < 18) {
      findings.push(createFinding("error", "RBI-DL-2025", "Borrower age must be captured and at least 18.", "borrower.dateOfBirth"));
    }
    if (!profile?.occupation) {
      findings.push(createFinding("error", "RBI-DL-2025", "Borrower occupation must be captured.", "economicProfile.occupation"));
    }
  }
  if (!Number.isFinite(profile?.monthlyIncome) || profile.monthlyIncome <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower monthlyIncome must be captured.", "economicProfile.monthlyIncome"));
  }
}

function checkProduct(application, findings) {
  const product = application.product;
  if (!product?.productCode) {
    findings.push(createFinding("error", "RBI-DL-2025", "productCode is required.", "product.productCode"));
  }
  if (!Number.isFinite(product?.requestedAmount) || product.requestedAmount <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "requestedAmount must be positive.", "product.requestedAmount"));
  }
  if (Number.isFinite(product?.minAmount) && Number.isFinite(product?.requestedAmount) && product.requestedAmount < product.minAmount) {
    findings.push(createFinding("error", "RBI-DL-2025", "requestedAmount is below product minAmount.", "product.requestedAmount"));
  }
  if (Number.isFinite(product?.maxAmount) && Number.isFinite(product?.requestedAmount) && product.requestedAmount > product.maxAmount) {
    findings.push(createFinding("error", "RBI-DL-2025", "requestedAmount is above product maxAmount.", "product.requestedAmount"));
  }
  if (
    Number.isFinite(product?.requestedTenorMonths) &&
    Number.isFinite(product?.minTenorMonths) &&
    product.requestedTenorMonths < product.minTenorMonths
  ) {
    findings.push(createFinding("error", "RBI-DL-2025", "requestedTenorMonths is below product minTenorMonths.", "product.requestedTenorMonths"));
  }
  if (
    Number.isFinite(product?.requestedTenorMonths) &&
    Number.isFinite(product?.maxTenorMonths) &&
    product.requestedTenorMonths > product.maxTenorMonths
  ) {
    findings.push(createFinding("error", "RBI-DL-2025", "requestedTenorMonths is above product maxTenorMonths.", "product.requestedTenorMonths"));
  }
  if (
    Number.isFinite(product?.eligibility?.minMonthlyIncome) &&
    Number.isFinite(application.economicProfile?.monthlyIncome) &&
    application.economicProfile.monthlyIncome < product.eligibility.minMonthlyIncome
  ) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower income is below product eligibility minimum.", "economicProfile.monthlyIncome"));
  }
  if (!Number.isFinite(product?.coolingOffDays) || product.coolingOffDays < 1) {
    findings.push(createFinding("error", "RBI-KFS-2024", "coolingOffDays must be at least one day.", "product.coolingOffDays"));
  }
}

function checkDataResidency(application, findings) {
  const data = application.dataResidency;
  if (data?.primaryStorageCountry !== "IN") {
    findings.push(createFinding("error", "RBI-DL-2025", "Primary storage country must be IN.", "dataResidency.primaryStorageCountry"));
  }
  if (data?.paymentDataStorageCountry && data.paymentDataStorageCountry !== "IN") {
    findings.push(createFinding("error", "RBI-PAY-DATA", "Payment data storage country must be IN.", "dataResidency.paymentDataStorageCountry"));
  }
  if (data?.processedOutsideIndia === true) {
    if (!Number.isFinite(data.returnedAndDeletedOutsideIndiaWithinHours) || data.returnedAndDeletedOutsideIndiaWithinHours > 24) {
      findings.push(
        createFinding(
          "error",
          "RBI-DL-2025",
          "Data processed outside India must be returned to India and deleted outside India within 24 hours.",
          "dataResidency.returnedAndDeletedOutsideIndiaWithinHours"
        )
      );
    }
  }
}

function checkFundFlow(application, findings) {
  const disbursement = application.disbursement;
  const repayment = application.repayment;

  if (disbursement?.destinationAccount) {
    checkAccountIndia("RBI-DL-2025", "Disbursement destination account", disbursement.destinationAccount, "disbursement.destinationAccount", findings);
    checkNoProhibitedFundControl(disbursement.destinationAccount.ownerRole, "disbursement.destinationAccount.ownerRole", findings);
    if (!ALLOWED_ACCOUNT_ROLES_FOR_DISBURSEMENT.has(disbursement.destinationAccount.ownerRole)) {
      findings.push(
        createFinding(
          "error",
          "RBI-DL-2025",
          "Disbursement destination must be borrower or end_beneficiary.",
          "disbursement.destinationAccount.ownerRole"
        )
      );
    }
  }

  if (repayment?.collectionAccount) {
    checkAccountIndia("RBI-DL-2025", "Repayment collection account", repayment.collectionAccount, "repayment.collectionAccount", findings);
    checkNoProhibitedFundControl(repayment.collectionAccount.ownerRole, "repayment.collectionAccount.ownerRole", findings);
    if (repayment.collectionAccount.ownerRole !== "regulated_entity") {
      findings.push(
        createFinding(
          "error",
          "RBI-DL-2025",
          "Repayment collection account must be the regulated entity account except coded permitted exceptions.",
          "repayment.collectionAccount.ownerRole"
        )
      );
    }
  }
}

function checkKfsIfPresent(application, findings) {
  if (!application.kfs) {
    return;
  }
  const kfsValidation = validateKfs(application.kfs);
  findings.push(...kfsValidation.findings);
}

function checkAiDecision(application, findings, modelRegistry) {
  if (!application.aiDecision?.modelId) {
    return;
  }
  const modelResult = evaluateModelUse(modelRegistry, application.aiDecision);
  findings.push(...modelResult.findings);
}

function checkDisbursementAccountVerification(account, path, findings) {
  const verification = account.bankAccountVerification ?? account.verification;
  if (!verification) {
    findings.push(
      createFinding(
        "error",
        "RBI-DL-2025",
        "Disbursement destination account requires bank account verification evidence.",
        `${path}.bankAccountVerification`
      )
    );
    return;
  }

  if (verification.status !== "verified") {
    findings.push(
      createFinding(
        "error",
        "RBI-DL-2025",
        "Disbursement destination bank account must be verified before funds move.",
        `${path}.bankAccountVerification.status`
      )
    );
  }
  if (!verification.verificationRef) {
    findings.push(
      createFinding(
        "error",
        "RBI-DL-2025",
        "Bank account verification evidence must include verificationRef.",
        `${path}.bankAccountVerification.verificationRef`
      )
    );
  }
  if (!verification.verifiedAt) {
    findings.push(
      createFinding(
        "error",
        "RBI-DL-2025",
        "Bank account verification evidence must include verifiedAt.",
        `${path}.bankAccountVerification.verifiedAt`
      )
    );
  }
  if (verification.accountStatus && verification.accountStatus !== "active") {
    findings.push(
      createFinding(
        "error",
        "RBI-DL-2025",
        "Disbursement destination bank account must be active.",
        `${path}.bankAccountVerification.accountStatus`
      )
    );
  }
  if (verification.nameMatch === false) {
    findings.push(
      createFinding(
        "error",
        "RBI-DL-2025",
        "Disbursement destination bank account holder must match borrower or permitted end-beneficiary evidence.",
        `${path}.bankAccountVerification.nameMatch`
      )
    );
  }
  if (verification.ifsc && account.ifsc && verification.ifsc.toUpperCase() !== account.ifsc.toUpperCase()) {
    findings.push(
      createFinding(
        "error",
        "RBI-DL-2025",
        "Bank account verification IFSC must match the disbursement destination account.",
        `${path}.bankAccountVerification.ifsc`
      )
    );
  }
  if (
    verification.accountNumberLast4 &&
    account.accountNumberLast4 &&
    verification.accountNumberLast4 !== account.accountNumberLast4
  ) {
    findings.push(
      createFinding(
        "error",
        "RBI-DL-2025",
        "Bank account verification account suffix must match the disbursement destination account.",
        `${path}.bankAccountVerification.accountNumberLast4`
      )
    );
  }
}

function checkAccountIndia(controlId, label, account, path, findings) {
  if (account.country !== "IN") {
    findings.push(createFinding("error", controlId, `${label} country must be IN.`, `${path}.country`));
  }
  if (!account.ifsc) {
    findings.push(createFinding("error", controlId, `${label} must include IFSC.`, `${path}.ifsc`));
  }
}

function checkNoProhibitedFundControl(ownerRole, path, findings) {
  if (PROHIBITED_FUND_CONTROL_ROLES.has(ownerRole)) {
    findings.push(createFinding("error", "RBI-DL-2025", "LSP/DLA/pass-through/pool accounts cannot control fund flow.", path));
  }
}
