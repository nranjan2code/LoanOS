import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { calculateAgeYears, createLoanId } from "./loan-policy.js";

// Fixed obligation to income ratio ceiling used when a product policy does not
// set its own. Kept conservative for unsecured retail credit.
const DEFAULT_MAX_FOIR = 0.5;
// Fraction of the FOIR ceiling above which an otherwise-affordable case is
// routed to manual underwriting instead of straight-through approval.
const REFER_FOIR_FRACTION = 0.8;

// Default credit-bureau score bands when a product policy does not set its own.
// CIBIL-style (300–900): reject below 600, refer 600–699, approve from 700.
const DEFAULT_BUREAU_BANDS = { rejectBelow: 600, referBelow: 700 };
// Default knockout attributes: any active default account rejects. Other
// attributes (write-offs, settlements, severe DPD, enquiry velocity, trade-line
// vintage) only bite when a product policy configures a threshold for them.
const DEFAULT_BUREAU_KNOCKOUTS = { defaultAccounts: { max: 0 } };
// How a thin/absent bureau file is treated by default: manual underwriting.
const DEFAULT_THIN_FILE_DECISION = "refer";

// Knockout attributes evaluated as "reject when the reported count/value exceeds
// the configured maximum". Each maps a bureau-report field to a KFS finding path.
const MAX_KNOCKOUT_ATTRIBUTES = [
  { key: "defaultAccounts", label: "active default accounts", path: "defaultAccounts" },
  { key: "writeOffs", label: "written-off accounts", path: "writeOffs" },
  { key: "settlements", label: "settled accounts", path: "settlements" },
  { key: "maxDpd", label: "days past due", path: "maxDpd" },
  { key: "enquiriesLast90Days", label: "credit enquiries in 90 days", path: "enquiriesLast90Days" }
];

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

  // Credit Bureau (CIBIL equivalent) scoring.
  evaluateBureauReports(application, eligibilityPolicy, findings);

  const estimatedEmi = estimateEmi(requestedAmount, annualInterestRateBps, requestedTenorMonths);

  // Affordability must reflect real debt, not only what the borrower declares.
  // Derive monthly obligations from the bureau trade lines and use the more
  // conservative of the declared and bureau-derived figures (REV-32).
  const bureauDerivedObligations = deriveBureauObligations(application);
  const obligationsUsed = Math.max(existingMonthlyObligations, bureauDerivedObligations);

  let foir = null;
  if (Number.isFinite(monthlyIncome) && monthlyIncome > 0 && Number.isFinite(estimatedEmi)) {
    foir = roundRatio((obligationsUsed + estimatedEmi) / monthlyIncome);
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
      bureauDerivedObligations,
      obligationsUsed,
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

function decisionSeverity(decision) {
  return decision === "reject" ? "error" : "warning";
}

// The bureau reports in play: the `bureauReports[]` array if present, otherwise
// the legacy single `bureauReport`, otherwise none.
function resolveBureauReports(application) {
  if (Array.isArray(application.bureauReports) && application.bureauReports.length > 0) {
    return application.bureauReports;
  }
  return application.bureauReport ? [application.bureauReport] : [];
}

// Monthly debt obligations implied by a single bureau report: a directly
// reported `monthlyObligations` total wins, else the sum of trade-line EMIs.
function deriveMonthlyObligationsFromReport(report) {
  if (Number.isFinite(report?.monthlyObligations)) {
    return Math.max(0, report.monthlyObligations);
  }
  if (Array.isArray(report?.tradeLines)) {
    return report.tradeLines.reduce((sum, line) => {
      const emi = Number.isFinite(line?.emiAmount)
        ? line.emiAmount
        : Number.isFinite(line?.monthlyPayment)
          ? line.monthlyPayment
          : 0;
      return sum + Math.max(0, emi);
    }, 0);
  }
  return 0;
}

// Bureau-derived monthly obligations across all reports. We take the maximum
// rather than the sum: the same live loan is often reported to several bureaus,
// so summing would double-count; the max is the conservative single-source view
// (REV-32).
function deriveBureauObligations(application) {
  let max = 0;
  for (const report of resolveBureauReports(application)) {
    const derived = deriveMonthlyObligationsFromReport(report);
    if (derived > max) {
      max = derived;
    }
  }
  return max;
}

// Resolve the score band governing a report: a per-bureau override wins, then
// the policy's `default`, then the built-in CIBIL-style default. Bureaus run on
// different scales (CIBIL 300–900, CRIF/Experian/Equifax variants), so bands are
// keyed by bureau name.
function resolveBureauBands(bureauPolicy, bureauName) {
  const bands = bureauPolicy?.bands ?? {};
  const key = bureauName ? String(bureauName).toLowerCase() : null;
  const resolved = (key && (bands[bureauName] ?? bands[key])) ?? bands.default ?? DEFAULT_BUREAU_BANDS;
  return {
    rejectBelow: Number.isFinite(resolved.rejectBelow) ? resolved.rejectBelow : DEFAULT_BUREAU_BANDS.rejectBelow,
    referBelow: Number.isFinite(resolved.referBelow) ? resolved.referBelow : DEFAULT_BUREAU_BANDS.referBelow
  };
}

// Policy-data credit-bureau underwriting (REV-30). Reads score bands and
// knockout attributes from the product's eligibility policy
// (`eligibility.bureauPolicy`) rather than a single hardcoded threshold, and
// evaluates one or many bureau reports (`bureauReports[]`, or the legacy single
// `bureauReport`). Each report may name its `bureau`; attributes beyond the
// score — write-offs, settlements, severe DPD, enquiry velocity, trade-line
// vintage — knock out or refer only when the policy configures a threshold. The
// most conservative outcome across bureaus wins because every finding is
// summarised together (any error ⇒ ineligible, any warning ⇒ refer).
function evaluateBureauReports(application, eligibilityPolicy, findings) {
  const bureauPolicy = eligibilityPolicy?.bureauPolicy ?? {};
  const knockouts = bureauPolicy.knockouts ?? DEFAULT_BUREAU_KNOCKOUTS;
  const thinFileDecision = bureauPolicy.thinFileDecision ?? DEFAULT_THIN_FILE_DECISION;
  const noBureauDecision = bureauPolicy.noBureauDecision ?? thinFileDecision;

  const fromArray = Array.isArray(application.bureauReports) && application.bureauReports.length > 0;
  const reports = fromArray
    ? application.bureauReports
    : application.bureauReport
      ? [application.bureauReport]
      : [];

  if (reports.length === 0) {
    if (noBureauDecision !== "approve") {
      findings.push(
        createFinding(
          decisionSeverity(noBureauDecision),
          "RBI-DL-2025",
          "Borrower has no credit bureau history; routing to manual underwriting.",
          "bureauReport"
        )
      );
    }
    return;
  }

  reports.forEach((report, index) => {
    const base = fromArray ? `bureauReports.${index}` : "bureauReport";
    const label = report.bureau ? `${report.bureau} ` : "";

    // Count/value knockouts: reject when the reported figure exceeds the cap.
    for (const attr of MAX_KNOCKOUT_ATTRIBUTES) {
      const rule = knockouts[attr.key];
      if (!rule || !Number.isFinite(rule.max)) {
        continue;
      }
      const value = report[attr.key];
      if (Number.isFinite(value) && value > rule.max) {
        findings.push(
          createFinding(
            "error",
            "RBI-DL-2025",
            `Borrower has ${value} ${attr.label} on ${label}credit bureau (limit ${rule.max}).`,
            `${base}.${attr.path}`
          )
        );
      }
    }

    // Trade-line seasoning: too-young a file routes to manual underwriting.
    const vintageRule = knockouts.minTradeLineVintageMonths;
    if (
      vintageRule &&
      Number.isFinite(vintageRule.min) &&
      Number.isFinite(report.oldestTradeLineMonths) &&
      report.oldestTradeLineMonths < vintageRule.min
    ) {
      findings.push(
        createFinding(
          "warning",
          "RBI-DL-2025",
          `Borrower's oldest ${label}trade line (${report.oldestTradeLineMonths} months) is below the seasoning minimum of ${vintageRule.min}; routing to manual underwriting.`,
          `${base}.oldestTradeLineMonths`
        )
      );
    }

    // Score bands (per bureau scale).
    if (Number.isFinite(report.score)) {
      const bands = resolveBureauBands(bureauPolicy, report.bureau);
      if (report.score < bands.rejectBelow) {
        findings.push(
          createFinding(
            "error",
            "RBI-DL-2025",
            `Borrower ${label}credit score (${report.score}) is below the minimum limit of ${bands.rejectBelow}.`,
            `${base}.score`
          )
        );
      } else if (report.score < bands.referBelow) {
        findings.push(
          createFinding(
            "warning",
            "RBI-DL-2025",
            `Borrower ${label}credit score (${report.score}) is within review band and requires manual underwriting.`,
            `${base}.score`
          )
        );
      }
    } else if (thinFileDecision !== "approve") {
      findings.push(
        createFinding(
          decisionSeverity(thinFileDecision),
          "RBI-DL-2025",
          `Borrower ${label}credit report has no score (thin file); routing to manual underwriting.`,
          `${base}.score`
        )
      );
    }
  });
}
