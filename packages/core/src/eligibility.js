import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { calculateAgeYears, createLoanId } from "./loan-policy.js";

// Fixed obligation to income ratio ceiling used when a product policy does not
// set its own. Kept conservative for unsecured retail credit.
const DEFAULT_MAX_FOIR = 0.5;
// Fraction of the FOIR ceiling above which an otherwise-affordable case is
// routed to manual underwriting instead of straight-through approval.
const REFER_FOIR_FRACTION = 0.8;

export const ELIGIBILITY_DECISIONS = {
  ELIGIBLE: "eligible",
  REFER: "refer",
  INELIGIBLE: "ineligible"
};

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundRatio(value) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

// Reducing-balance EMI, matching the amortization used by the LMS schedule so
// affordability is assessed on the same repayment the borrower will owe.
export function estimateEmi(principalAmount, annualInterestRateBps, tenorMonths) {
  if (!Number.isFinite(principalAmount) || principalAmount <= 0) {
    return null;
  }
  if (!Number.isFinite(tenorMonths) || tenorMonths <= 0) {
    return null;
  }
  if (!Number.isFinite(annualInterestRateBps) || annualInterestRateBps < 0) {
    return null;
  }
  const monthlyRate = annualInterestRateBps / 10000 / 12;
  if (monthlyRate === 0) {
    return roundMoney(principalAmount / tenorMonths);
  }
  const factor = (1 + monthlyRate) ** tenorMonths;
  return roundMoney((principalAmount * monthlyRate * factor) / (factor - 1));
}

// Policy-driven creditworthiness/affordability assessment. Anchored to the
// RBI Digital Lending obligation that borrower creditworthiness be assessed
// using economic-profile data before a credit decision is taken.
export function evaluateEligibility(application, options = {}) {
  const now = options.now ?? new Date();
  const findings = [];

  const product = application.product ?? {};
  const eligibilityPolicy = product.eligibility ?? {};
  const profile = application.economicProfile ?? {};
  const borrower = application.borrower ?? {};

  const requestedAmount = product.requestedAmount;
  const requestedTenorMonths = product.requestedTenorMonths ?? product.defaultTenorMonths;
  const annualInterestRateBps = Number.isFinite(product.annualInterestRateBps)
    ? product.annualInterestRateBps
    : product.aprBps;

  const monthlyIncome = profile.monthlyIncome;
  const existingMonthlyObligations = Number.isFinite(profile.existingMonthlyObligations)
    ? profile.existingMonthlyObligations
    : 0;

  const minAgeYears = Number.isFinite(eligibilityPolicy.minAgeYears) ? eligibilityPolicy.minAgeYears : 18;
  const maxAgeYears = Number.isFinite(eligibilityPolicy.maxAgeYears) ? eligibilityPolicy.maxAgeYears : null;
  const minMonthlyIncome = Number.isFinite(eligibilityPolicy.minMonthlyIncome) ? eligibilityPolicy.minMonthlyIncome : 0;
  const maxFoir = Number.isFinite(eligibilityPolicy.maxFoir) ? eligibilityPolicy.maxFoir : DEFAULT_MAX_FOIR;
  const referFoir = roundRatio(maxFoir * REFER_FOIR_FRACTION);

  const age = borrower.dateOfBirth ? calculateAgeYears(borrower.dateOfBirth, now) : borrower.ageYears;
  const tenorYears = Number.isFinite(requestedTenorMonths) ? Math.ceil(requestedTenorMonths / 12) : null;
  const ageAtMaturity = Number.isFinite(age) && Number.isFinite(tenorYears) ? age + tenorYears : null;

  // Loan-parameter bounds against the product policy.
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Requested amount is required to assess eligibility.", "product.requestedAmount"));
  } else {
    if (Number.isFinite(product.minAmount) && requestedAmount < product.minAmount) {
      findings.push(createFinding("error", "RBI-DL-2025", "Requested amount is below the product minimum.", "product.requestedAmount"));
    }
    if (Number.isFinite(product.maxAmount) && requestedAmount > product.maxAmount) {
      findings.push(createFinding("error", "RBI-DL-2025", "Requested amount exceeds the product maximum.", "product.requestedAmount"));
    }
  }
  if (!Number.isFinite(requestedTenorMonths) || requestedTenorMonths <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Requested tenor is required to assess eligibility.", "product.requestedTenorMonths"));
  } else {
    if (Number.isFinite(product.minTenorMonths) && requestedTenorMonths < product.minTenorMonths) {
      findings.push(createFinding("error", "RBI-DL-2025", "Requested tenor is below the product minimum.", "product.requestedTenorMonths"));
    }
    if (Number.isFinite(product.maxTenorMonths) && requestedTenorMonths > product.maxTenorMonths) {
      findings.push(createFinding("error", "RBI-DL-2025", "Requested tenor exceeds the product maximum.", "product.requestedTenorMonths"));
    }
  }

  // Age eligibility at application and at maturity.
  if (!Number.isFinite(age)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower age is required to assess eligibility.", "borrower.dateOfBirth"));
  } else {
    if (age < minAgeYears) {
      findings.push(createFinding("error", "RBI-DL-2025", `Borrower age is below the product minimum of ${minAgeYears}.`, "borrower.dateOfBirth"));
    }
    if (Number.isFinite(maxAgeYears) && Number.isFinite(ageAtMaturity) && ageAtMaturity > maxAgeYears) {
      findings.push(createFinding("error", "RBI-DL-2025", `Borrower age at maturity exceeds the product maximum of ${maxAgeYears}.`, "borrower.dateOfBirth"));
    }
  }

  // Income and affordability.
  if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower monthly income is required to assess creditworthiness.", "economicProfile.monthlyIncome"));
  } else if (monthlyIncome < minMonthlyIncome) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower monthly income is below the product eligibility minimum.", "economicProfile.monthlyIncome"));
  }

  const estimatedEmi = estimateEmi(requestedAmount, annualInterestRateBps, requestedTenorMonths);
  let foir = null;
  if (Number.isFinite(monthlyIncome) && monthlyIncome > 0 && Number.isFinite(estimatedEmi)) {
    foir = roundRatio((existingMonthlyObligations + estimatedEmi) / monthlyIncome);
    if (foir > maxFoir) {
      findings.push(
        createFinding(
          "error",
          "RBI-DL-2025",
          `Fixed obligation to income ratio ${foir} exceeds the product ceiling of ${maxFoir}.`,
          "economicProfile.monthlyIncome"
        )
      );
    } else if (foir > referFoir) {
      findings.push(
        createFinding(
          "warning",
          "RBI-DL-2025",
          `Fixed obligation to income ratio ${foir} is within review band and requires manual underwriting.`,
          "economicProfile.monthlyIncome"
        )
      );
    }
  } else if (!Number.isFinite(estimatedEmi)) {
    findings.push(
      createFinding("warning", "RBI-DL-2025", "Affordability could not be computed without amount, tenor, and interest rate.", "product.annualInterestRateBps")
    );
  }

  const summary = summarizeFindings(findings);
  const decision =
    summary.status === "blocked"
      ? ELIGIBILITY_DECISIONS.INELIGIBLE
      : summary.status === "review"
        ? ELIGIBILITY_DECISIONS.REFER
        : ELIGIBILITY_DECISIONS.ELIGIBLE;

  const assessment = {
    eligibilityId: options.eligibilityId ?? createLoanId("elig"),
    assessedAt: now.toISOString(),
    decision,
    metrics: {
      requestedAmount: Number.isFinite(requestedAmount) ? requestedAmount : null,
      requestedTenorMonths: Number.isFinite(requestedTenorMonths) ? requestedTenorMonths : null,
      annualInterestRateBps: Number.isFinite(annualInterestRateBps) ? annualInterestRateBps : null,
      monthlyIncome: Number.isFinite(monthlyIncome) ? monthlyIncome : null,
      existingMonthlyObligations,
      estimatedEmi: Number.isFinite(estimatedEmi) ? estimatedEmi : null,
      foir,
      maxFoir,
      age: Number.isFinite(age) ? age : null,
      ageAtMaturity: Number.isFinite(ageAtMaturity) ? ageAtMaturity : null
    },
    summary,
    reasons: findings
  };

  return {
    assessment,
    findings,
    summary
  };
}
