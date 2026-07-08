import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { evaluateModelUse } from "./model-governance.js";

export const ALLOWED_RE_TYPES = new Set([
  "commercial_bank",
  "small_finance_bank",
  "payments_bank",
  "cooperative_bank",
  "nbfc",
  "hfc",
  "all_india_financial_institution"
]);

const ALLOWED_LOAN_CURRENCIES = new Set(["INR"]);
const ALLOWED_ACCOUNT_ROLES_FOR_DISBURSEMENT = new Set(["borrower", "end_beneficiary"]);
const PROHIBITED_FUND_CONTROL_ROLES = new Set(["lsp", "dla", "pass_through", "pool_account"]);

export function createLoanId(prefix = "loan") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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

  return {
    kfsId: createLoanId("kfs"),
    generatedAt: now.toISOString(),
    borrowerId: application.borrower?.borrowerId ?? null,
    applicationId: application.applicationId ?? null,
    lenderName: application.tenant?.regulatedEntityName ?? null,
    productCode: product.productCode ?? null,
    currency: terms?.currency ?? product.currency ?? "INR",
    principalAmount: terms?.principalAmount ?? product.requestedAmount ?? null,
    tenorMonths: terms?.tenorMonths ?? product.requestedTenorMonths ?? product.defaultTenorMonths ?? null,
    annualInterestRateBps: terms?.annualInterestRateBps ?? product.annualInterestRateBps ?? null,
    aprBps: terms?.aprBps ?? product.aprBps ?? terms?.annualInterestRateBps ?? product.annualInterestRateBps ?? null,
    repaymentFrequency: terms?.repaymentFrequency ?? product.repaymentFrequency ?? "monthly",
    coolingOffDays: terms?.coolingOffDays ?? product.coolingOffDays ?? 1,
    charges,
    contingentCharges,
    penalCharges,
    recoveryMechanism: terms?.recoveryMechanism ?? application.repayment?.recoveryMechanism ?? product.recoveryMechanism ?? null,
    grievanceOfficer: terms?.grievanceOfficer ?? application.tenant?.grievanceOfficer ?? null,
    privacyPolicyUrl: terms?.privacyPolicyUrl ?? application.tenant?.privacyPolicyUrl ?? null,
    allFeesDisclosed: true,
    digitallyDeliverable: true
  };
}

export function attachKfs(application, kfs, acceptance = {}) {
  return {
    ...application,
    kfs: {
      ...kfs,
      acceptedAt: acceptance.acceptedAt ?? null,
      deliveryChannel: acceptance.deliveryChannel ?? null,
      deliveryRef: acceptance.deliveryRef ?? null
    }
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
  if (!Number.isFinite(kfs.coolingOffDays) || kfs.coolingOffDays < 1) {
    findings.push(createFinding("error", "RBI-KFS-2024", "Digital loans require coolingOffDays of at least one day.", "kfs.coolingOffDays"));
  }
  if (!kfs.grievanceOfficer?.name || !kfs.grievanceOfficer?.email) {
    findings.push(createFinding("error", "RBI-DL-2025", "KFS must include grievance officer name and email.", "kfs.grievanceOfficer"));
  }
  if (!kfs.recoveryMechanism) {
    findings.push(createFinding("error", "RBI-DL-2025", "KFS must disclose recovery mechanism.", "kfs.recoveryMechanism"));
  }

  for (const charge of [...(kfs.charges ?? []), ...(kfs.penalCharges ?? [])]) {
    if (!charge.name || !charge.reason) {
      findings.push(createFinding("error", "RBI-KFS-2024", "Each KFS charge must include name and reason.", "kfs.charges"));
    }
    if (charge.type === "penal_interest") {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Penalties must not be represented as penal interest.", "kfs.penalCharges"));
    }
    if (charge.capitalizes === true) {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Penal charges must not be capitalized.", "kfs.penalCharges"));
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
  const tenant = application.tenant;
  if (!tenant?.regulatedEntityName) {
    findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityName is required.", "tenant.regulatedEntityName"));
  }
  if (!tenant?.regulatedEntityType || !ALLOWED_RE_TYPES.has(tenant.regulatedEntityType)) {
    findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityType must be an RBI-covered RE type.", "tenant.regulatedEntityType"));
  }
  if (!tenant?.grievanceOfficer?.name || !tenant?.grievanceOfficer?.email) {
    findings.push(createFinding("error", "RBI-DL-2025", "Tenant must configure grievance officer name and email.", "tenant.grievanceOfficer"));
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
  const age = borrower?.dateOfBirth ? calculateAgeYears(borrower.dateOfBirth, now) : borrower?.ageYears;

  if (!Number.isFinite(age) || age < 18) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower age must be captured and at least 18.", "borrower.dateOfBirth"));
  }
  if (!profile?.occupation) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower occupation must be captured.", "economicProfile.occupation"));
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
