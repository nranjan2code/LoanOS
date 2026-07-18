import { createFinding, summarizeFindings } from "../compliance/compliance-controls.js";
import { ALLOWED_RE_TYPES, ALLOWED_CHARGE_TYPES } from "../lending/loan-policy.js";
import { periodsForTenor } from "../lending/repayment-schedule.js";
import { PRODUCT_JOURNEY_TYPES, isBusinessProductJourneyType } from "../journeys/product-journey-administration.js";

const ACTIVE_STATUS = "active";
const ALLOWED_PRODUCT_TYPES = new Set(PRODUCT_JOURNEY_TYPES);
const ALLOWED_LSP_STATUSES = new Set(["draft", "active", "suspended", "terminated"]);
const ALLOWED_LSP_SERVICES = new Set([
  "customer_acquisition",
  "underwriting_support",
  "servicing",
  "monitoring",
  "recovery",
  "collections",
  "customer_service",
  "dla_operations",
  "technology_provider"
]);
const BORROWER_FACING_LSP_SERVICES = new Set([
  "customer_acquisition",
  "servicing",
  "recovery",
  "collections",
  "customer_service",
  "dla_operations"
]);
const RECOVERY_LSP_SERVICES = new Set(["recovery", "collections"]);
const ALLOWED_LSP_REVIEW_OUTCOMES = new Set(["satisfactory", "deviation_found", "remediation_required"]);
const ALLOWED_DLA_OWNER_TYPES = new Set(["self_owned", "lsp_owned"]);
const ALLOWED_DLA_STATUSES = new Set(["draft", "active", "ceased"]);
const PAYMENT_ALLOCATION_COMPONENTS = ["interest", "charges", "principal"];
const DLA_CIMS_COLUMNS = [
  { key: "serialNumber", label: "Sl. No." },
  { key: "dlaName", label: "Name of the DLA" },
  { key: "ownerName", label: "Name of the owner of DLA" },
  { key: "availableOn", label: "Available on" },
  { key: "dlaLink", label: "Link to DLA" },
  { key: "grievanceOfficerName", label: "Name of Grievance Redressal Officer" },
  { key: "grievanceOfficerEmail", label: "Email id of Grievance Redressal Officer" },
  { key: "grievanceOfficerTelephone", label: "Telephone number of Grievance Redressal Officer" },
  { key: "grievanceOfficerMobile", label: "Mobile number of Grievance Redressal Officer" },
  { key: "reWebsite", label: "Website of RE" }
];
const REQUIRED_ACCOUNTING_KEYS = ["bankClearing", "principalReceivable", "interestReceivable", "interestIncome", "chargesReceivable", "chargesIncome", "outputGstPayable", "customerCreditBalance", "chargeWaiverExpense", "settlementLoss"];
const DEFAULT_ACCOUNTING_PROFILE = {
  bankClearing: "bank_clearing", principalReceivable: "loan_principal_receivable", interestReceivable: "interest_receivable", interestIncome: "interest_income", chargesReceivable: "charges_receivable", chargesIncome: "charges_income", outputGstPayable: "output_gst_payable", customerCreditBalance: "customer_credit_balance", chargeWaiverExpense: "charge_waiver_expense", settlementLoss: "settlement_loss"
};

export function validateRegulatedEntity(entity, now = new Date()) {
  const findings = [];

  if (!entity?.regulatedEntityId) {
    findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityId is required.", "regulatedEntityId"));
  }
  if (!entity?.regulatedEntityName) {
    findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityName is required.", "regulatedEntityName"));
  }
  if (!entity?.regulatedEntityType || !ALLOWED_RE_TYPES.has(entity.regulatedEntityType)) {
    findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityType must be an RBI-covered RE type.", "regulatedEntityType"));
  }
  if (!entity?.rbiRegistrationNumber || typeof entity.rbiRegistrationNumber !== "string" || entity.rbiRegistrationNumber.trim() === "") {
    findings.push(createFinding("error", "RBI-DL-2025", "rbiRegistrationNumber is required and cannot be empty.", "rbiRegistrationNumber"));
  }
  if ((entity?.country ?? "IN") !== "IN") {
    findings.push(createFinding("error", "RBI-DL-2025", "Regulated entity country must be IN.", "country"));
  }
  if (entity?.status && !["draft", "active", "suspended", "retired"].includes(entity.status)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Regulated entity status is invalid.", "status"));
  }
  if (!entity?.websiteUrl) {
    findings.push(createFinding("error", "RBI-DL-2025", "Regulated entity websiteUrl is required for public disclosures.", "websiteUrl"));
  }
  if (!entity?.privacyPolicyUrl) {
    findings.push(createFinding("error", "RBI-DL-2025", "Regulated entity privacyPolicyUrl is required.", "privacyPolicyUrl"));
  }
  if (!entity?.grievanceOfficer?.name || !entity?.grievanceOfficer?.email) {
    findings.push(createFinding("error", "RBI-DL-2025", "Grievance officer name and email are required.", "grievanceOfficer"));
  }
  if (!entity?.boardPolicyRefs?.digitalLendingPolicyRef) {
    findings.push(
      createFinding("error", "RBI-DL-2025", "Board-approved digital lending policy reference is required.", "boardPolicyRefs.digitalLendingPolicyRef")
    );
  }
  if (!entity?.boardPolicyRefs?.kycPolicyRef) {
    findings.push(createFinding("error", "RBI-KYC-2016", "Board-approved KYC policy reference is required.", "boardPolicyRefs.kycPolicyRef"));
  }
  if (!entity?.boardPolicyRefs?.penalChargesPolicyRef) {
    findings.push(
      createFinding("error", "RBI-FPC-PENAL", "Board-approved penal charges policy reference is required.", "boardPolicyRefs.penalChargesPolicyRef")
    );
  }
  if (entity?.dataResidency?.primaryStorageCountry !== "IN") {
    findings.push(createFinding("error", "RBI-DL-2025", "RE primary storage country must be IN.", "dataResidency.primaryStorageCountry"));
  }
  if (
    entity?.dataResidency?.paymentDataStorageCountry &&
    entity.dataResidency.paymentDataStorageCountry !== "IN"
  ) {
    findings.push(createFinding("error", "RBI-PAY-DATA", "RE payment data storage country must be IN.", "dataResidency.paymentDataStorageCountry"));
  }

  // Validate licenseMetadata
  if (!entity?.licenseMetadata || typeof entity.licenseMetadata !== "object") {
    findings.push(createFinding("error", "RBI-DL-2025", "License metadata is required.", "licenseMetadata"));
  } else {
    if (!entity.licenseMetadata.category || typeof entity.licenseMetadata.category !== "string" || entity.licenseMetadata.category.trim() === "") {
      findings.push(createFinding("error", "RBI-DL-2025", "License category is required.", "licenseMetadata.category"));
    }
    if (!entity.licenseMetadata.licenseNumber || typeof entity.licenseMetadata.licenseNumber !== "string" || entity.licenseMetadata.licenseNumber.trim() === "") {
      findings.push(createFinding("error", "RBI-DL-2025", "License number is required.", "licenseMetadata.licenseNumber"));
    }
    if (!entity.licenseMetadata.issuingAuthority || typeof entity.licenseMetadata.issuingAuthority !== "string" || entity.licenseMetadata.issuingAuthority.trim() === "") {
      findings.push(createFinding("error", "RBI-DL-2025", "License issuing authority is required.", "licenseMetadata.issuingAuthority"));
    }
    if (!entity.licenseMetadata.issueDate || isNaN(Date.parse(entity.licenseMetadata.issueDate))) {
      findings.push(createFinding("error", "RBI-DL-2025", "License issue date must be a valid date.", "licenseMetadata.issueDate"));
    } else if (new Date(entity.licenseMetadata.issueDate) > now) {
      findings.push(createFinding("error", "RBI-DL-2025", "License issue date cannot be in the future.", "licenseMetadata.issueDate"));
    }
    if (!entity.licenseMetadata.status || !["active", "valid"].includes(entity.licenseMetadata.status)) {
      findings.push(createFinding("error", "RBI-DL-2025", "License status must be 'active' or 'valid'.", "licenseMetadata.status"));
    }
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function normalizeRegulatedEntity(input, now = new Date()) {
  return {
    regulatedEntityId: input.regulatedEntityId,
    regulatedEntityName: input.regulatedEntityName,
    regulatedEntityType: input.regulatedEntityType,
    rbiRegistrationNumber: input.rbiRegistrationNumber ?? null,
    country: input.country ?? "IN",
    status: input.status ?? ACTIVE_STATUS,
    websiteUrl: input.websiteUrl,
    privacyPolicyUrl: input.privacyPolicyUrl,
    grievanceOfficer: {
      name: input.grievanceOfficer?.name,
      email: input.grievanceOfficer?.email,
      phone: input.grievanceOfficer?.phone ?? null
    },
    dataResidency: {
      primaryStorageCountry: input.dataResidency?.primaryStorageCountry ?? "IN",
      paymentDataStorageCountry: input.dataResidency?.paymentDataStorageCountry ?? "IN",
      processedOutsideIndia: Boolean(input.dataResidency?.processedOutsideIndia),
      returnedAndDeletedOutsideIndiaWithinHours:
        input.dataResidency?.returnedAndDeletedOutsideIndiaWithinHours ?? null
    },
    boardPolicyRefs: {
      digitalLendingPolicyRef: input.boardPolicyRefs?.digitalLendingPolicyRef ?? null,
      kycPolicyRef: input.boardPolicyRefs?.kycPolicyRef ?? null,
      penalChargesPolicyRef: input.boardPolicyRefs?.penalChargesPolicyRef ?? null,
      outsourcingPolicyRef: input.boardPolicyRefs?.outsourcingPolicyRef ?? null,
      modelRiskPolicyRef: input.boardPolicyRefs?.modelRiskPolicyRef ?? null,
      grievancePolicyRef: input.boardPolicyRefs?.grievancePolicyRef ?? null
    },
    licenseMetadata: {
      category: input.licenseMetadata?.category ?? null,
      licenseNumber: input.licenseMetadata?.licenseNumber ?? null,
      issuingAuthority: input.licenseMetadata?.issuingAuthority ?? "Reserve Bank of India",
      issueDate: input.licenseMetadata?.issueDate ?? null,
      status: input.licenseMetadata?.status ?? null
    },
    publicDisclosures: {
      sachetPortalUrl: input.publicDisclosures?.sachetPortalUrl ?? "https://sachet.rbi.org.in/",
      rbiCmsUrl: input.publicDisclosures?.rbiCmsUrl ?? "https://cms.rbi.org.in/"
    },
    createdAt: input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function upsertRegulatedEntity(registry, input, now = new Date()) {
  const entity = normalizeRegulatedEntity(input, now);
  const validation = validateRegulatedEntity(entity, now);
  const nextRegistry =
    validation.summary.status === "blocked"
      ? registry ?? {}
      : {
          ...(registry ?? {}),
          [entity.regulatedEntityId]: entity
        };

  return {
    registry: nextRegistry,
    entity,
    findings: validation.findings,
    summary: validation.summary
  };
}

export function validateLendingServiceProvider(lsp, regulatedEntities = {}) {
  const findings = [];
  const entity = lsp?.regulatedEntityId ? regulatedEntities[lsp.regulatedEntityId] : null;
  const status = lsp?.status ?? ACTIVE_STATUS;
  const services = Array.isArray(lsp?.services) ? lsp.services : [];

  if (!lsp?.lspId) {
    findings.push(createFinding("error", "RBI-DL-2025", "lspId is required.", "lspId"));
  }
  if (!lsp?.regulatedEntityId) {
    findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityId is required for LSP oversight.", "regulatedEntityId"));
  } else if (!entity) {
    findings.push(createFinding("error", "RBI-DL-2025", "LSP must reference an existing regulated entity.", "regulatedEntityId"));
  } else if (entity.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "LSP regulated entity must be active.", "regulatedEntityId"));
  }
  if (!lsp?.legalName) {
    findings.push(createFinding("error", "RBI-DL-2025", "LSP legalName is required.", "legalName"));
  }
  if ((lsp?.country ?? "IN") !== "IN") {
    findings.push(createFinding("error", "RBI-DL-2025", "LSP country must be IN for this India-only operating model.", "country"));
  }
  if (!ALLOWED_LSP_STATUSES.has(status)) {
    findings.push(createFinding("error", "RBI-DL-2025", "LSP status is invalid.", "status"));
  }
  if (services.length === 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "At least one LSP service is required.", "services"));
  }
  services.forEach((service, index) => {
    if (!ALLOWED_LSP_SERVICES.has(service)) {
      findings.push(createFinding("error", "RBI-DL-2025", "LSP service is not recognized.", `services.${index}`));
    }
  });

  if (status === ACTIVE_STATUS) {
    validateActiveLspAgreement(lsp, findings);
    validateActiveLspDueDiligence(lsp, findings);
    validateActiveLspPeriodicReview(lsp, findings);
    validateActiveLspDataControls(lsp, findings);
    validateActiveLspFeeControls(lsp, findings);

    if (!lsp?.monitoring?.portfolioMonitoringPolicyRef) {
      findings.push(
        createFinding("error", "RBI-DL-2025", "Portfolio monitoring policy reference is required.", "monitoring.portfolioMonitoringPolicyRef")
      );
    }
    if (!lsp?.monitoring?.reportingCadence) {
      findings.push(createFinding("error", "RBI-DL-2025", "LSP reporting cadence is required.", "monitoring.reportingCadence"));
    }
    if (lspHasBorrowerInterface(lsp)) {
      validateBorrowerFacingLsp(lsp, findings);
    }
    if (lspProvidesRecovery(lsp) && !lsp?.recoveryControls?.recoveryAgentGuidanceRef) {
      findings.push(
        createFinding("error", "RBI-DL-2025", "Recovery LSPs require responsible recovery-agent guidance evidence.", "recoveryControls.recoveryAgentGuidanceRef")
      );
    }
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function normalizeLendingServiceProvider(input, regulatedEntities = {}, now = new Date()) {
  const services = Array.isArray(input.services) ? input.services : [];
  const interfaceWithBorrower =
    input.interfaceWithBorrower ?? services.some((service) => BORROWER_FACING_LSP_SERVICES.has(service));
  const entity = regulatedEntities?.[input.regulatedEntityId] ?? null;

  return {
    lspId: input.lspId,
    regulatedEntityId: input.regulatedEntityId,
    legalName: input.legalName,
    tradeName: input.tradeName ?? input.legalName,
    country: input.country ?? "IN",
    status: input.status ?? ACTIVE_STATUS,
    services,
    interfaceWithBorrower,
    websiteUrl: input.websiteUrl ?? null,
    privacyPolicyUrl: input.privacyPolicyUrl ?? null,
    publicDisclosureUrl: input.publicDisclosureUrl ?? entity?.websiteUrl ?? null,
    grievanceOfficer: {
      name: input.grievanceOfficer?.name ?? null,
      email: input.grievanceOfficer?.email ?? null,
      phone: input.grievanceOfficer?.phone ?? input.grievanceOfficer?.telephone ?? null,
      mobile: input.grievanceOfficer?.mobile ?? null
    },
    agreement: {
      agreementRef: input.agreement?.agreementRef ?? null,
      effectiveFrom: input.agreement?.effectiveFrom ?? null,
      effectiveTo: input.agreement?.effectiveTo ?? null,
      rolesAndObligationsRef: input.agreement?.rolesAndObligationsRef ?? null,
      rightsAndObligationsRef: input.agreement?.rightsAndObligationsRef ?? null,
      scopeOfWorkRef: input.agreement?.scopeOfWorkRef ?? null
    },
    dueDiligence: {
      completedAt: input.dueDiligence?.completedAt ?? null,
      approvedBy: input.dueDiligence?.approvedBy ?? null,
      approvalRef: input.dueDiligence?.approvalRef ?? null,
      technicalCapabilityReviewRef: input.dueDiligence?.technicalCapabilityReviewRef ?? null,
      dataPrivacyReviewRef: input.dueDiligence?.dataPrivacyReviewRef ?? null,
      fairConductReviewRef: input.dueDiligence?.fairConductReviewRef ?? null,
      pastConductReviewRef: input.dueDiligence?.pastConductReviewRef ?? null,
      regulatoryComplianceReviewRef: input.dueDiligence?.regulatoryComplianceReviewRef ?? null
    },
    periodicReview: {
      lastReviewedAt: input.periodicReview?.lastReviewedAt ?? null,
      nextReviewDueAt: input.periodicReview?.nextReviewDueAt ?? null,
      reviewedBy: input.periodicReview?.reviewedBy ?? null,
      reviewRef: input.periodicReview?.reviewRef ?? null,
      outcome: input.periodicReview?.outcome ?? null,
      deviationActionRef: input.periodicReview?.deviationActionRef ?? null
    },
    monitoring: {
      portfolioMonitoringPolicyRef: input.monitoring?.portfolioMonitoringPolicyRef ?? null,
      reportingCadence: input.monitoring?.reportingCadence ?? null,
      metrics: Array.isArray(input.monitoring?.metrics) ? input.monitoring.metrics : []
    },
    dataControls: {
      primaryStorageCountry: input.dataControls?.primaryStorageCountry ?? "IN",
      processedOutsideIndia: Boolean(input.dataControls?.processedOutsideIndia),
      returnedAndDeletedOutsideIndiaWithinHours:
        input.dataControls?.returnedAndDeletedOutsideIndiaWithinHours ?? null,
      storesOnlyMinimalBorrowerData: Boolean(input.dataControls?.storesOnlyMinimalBorrowerData),
      prohibitedBorrowerDataStored: Boolean(input.dataControls?.prohibitedBorrowerDataStored)
    },
    feeControls: {
      paidByRegulatedEntity: Boolean(input.feeControls?.paidByRegulatedEntity),
      borrowerChargedSeparately: Boolean(input.feeControls?.borrowerChargedSeparately)
    },
    recoveryControls: {
      recoveryAgentGuidanceRef: input.recoveryControls?.recoveryAgentGuidanceRef ?? null
    },
    createdAt: input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function upsertLendingServiceProvider(registry, input, regulatedEntities = {}, now = new Date()) {
  const lsp = normalizeLendingServiceProvider(input, regulatedEntities, now);
  const validation = validateLendingServiceProvider(lsp, regulatedEntities);
  const nextRegistry =
    validation.summary.status === "blocked"
      ? registry ?? {}
      : {
          ...(registry ?? {}),
          [lsp.lspId]: lsp
        };

  return {
    registry: nextRegistry,
    lendingServiceProvider: lsp,
    findings: validation.findings,
    summary: validation.summary
  };
}

export function validateDigitalLendingApp(app, regulatedEntities = {}, lendingServiceProviders = {}) {
  const findings = [];
  const entity = app?.regulatedEntityId ? regulatedEntities[app.regulatedEntityId] : null;
  const lsp = app?.lspId ? lendingServiceProviders[app.lspId] : null;
  const status = app?.status ?? ACTIVE_STATUS;
  const ownerType = app?.ownerType;

  if (!app?.digitalLendingAppId) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "digitalLendingAppId is required.", "digitalLendingAppId"));
  }
  if (!app?.regulatedEntityId) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "regulatedEntityId is required for DLA reporting.", "regulatedEntityId"));
  } else if (!entity) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "DLA must reference an existing regulated entity.", "regulatedEntityId"));
  } else if (entity.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "DLA regulated entity must be active.", "regulatedEntityId"));
  }
  if (!app?.name) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "DLA name is required.", "name"));
  }
  if (!ownerType || !ALLOWED_DLA_OWNER_TYPES.has(ownerType)) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "ownerType must be self_owned or lsp_owned.", "ownerType"));
  }
  if (!ALLOWED_DLA_STATUSES.has(status)) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "DLA status is invalid.", "status"));
  }
  if (!app?.ownerName) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "DLA ownerName is required.", "ownerName"));
  }
  if (ownerType === "lsp_owned" && !app?.lspId) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "lspId is required for an LSP-owned DLA.", "lspId"));
  } else if (ownerType === "lsp_owned" && !lsp) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "LSP-owned DLA must reference a registered LSP.", "lspId"));
  } else if (ownerType === "lsp_owned" && lsp.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "LSP-owned DLA must reference an active LSP.", "lspId"));
  } else if (ownerType === "lsp_owned" && lsp.regulatedEntityId !== app.regulatedEntityId) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "LSP-owned DLA must use an LSP governed by the same RE.", "lspId"));
  }

  if (!Array.isArray(app?.availability) || app.availability.length === 0) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "At least one DLA availability entry is required.", "availability"));
  } else {
    app.availability.forEach((availability, index) => {
      if (!availability?.availableOn) {
        findings.push(createFinding("error", "RBI-DLA-CIMS", "availability.availableOn is required.", `availability.${index}.availableOn`));
      }
      if (!isHttpUrl(availability?.link)) {
        findings.push(createFinding("error", "RBI-DLA-CIMS", "availability.link must be an http(s) DLA URL.", `availability.${index}.link`));
      }
    });
  }

  if (!app?.grievanceOfficer?.name) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "DLA grievance officer name is required.", "grievanceOfficer.name"));
  }
  if (!app?.grievanceOfficer?.email) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "DLA grievance officer email is required.", "grievanceOfficer.email"));
  }
  if (!app?.grievanceOfficer?.telephone && !app?.grievanceOfficer?.mobile) {
    findings.push(
      createFinding(
        "error",
        "RBI-DLA-CIMS",
        "DLA grievance officer telephone or mobile number is required.",
        "grievanceOfficer.telephone"
      )
    );
  }
  if (!isHttpUrl(app?.reWebsiteUrl)) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "RE website URL is required for DLA reporting.", "reWebsiteUrl"));
  }
  if (!isHttpUrl(app?.privacyPolicyUrl)) {
    findings.push(createFinding("error", "RBI-DL-2025", "DLA privacyPolicyUrl is required.", "privacyPolicyUrl"));
  }
  if (!isHttpUrl(app?.publicDisclosureUrl)) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "DLA publicDisclosureUrl on the RE website is required.", "publicDisclosureUrl"));
  }

  if (status === ACTIVE_STATUS) {
    validateActiveDlaAttestation(app, findings);
    validateDlaDataCollection(app, findings);
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function normalizeDigitalLendingApp(input, regulatedEntities = {}, lendingServiceProviders = {}, now = new Date()) {
  const entity = regulatedEntities?.[input.regulatedEntityId] ?? null;
  const ownerType = input.ownerType ?? (input.lspId || input.lspName ? "lsp_owned" : "self_owned");
  const lsp = input.lspId ? lendingServiceProviders?.[input.lspId] : null;
  const availabilityInput = Array.isArray(input.availability)
    ? input.availability
    : [
        {
          channel: input.channel,
          availableOn: input.availableOn,
          link: input.link ?? input.dlaLink
        }
      ];
  const defaultOfficer = entity?.grievanceOfficer ?? {};

  return {
    digitalLendingAppId: input.digitalLendingAppId,
    regulatedEntityId: input.regulatedEntityId,
    name: input.name,
    ownerType,
    ownerName: ownerType === "self_owned" ? (input.ownerName ?? "Self-owned") : input.ownerName ?? input.lspName ?? lsp?.legalName,
    lspId: ownerType === "lsp_owned" ? input.lspId ?? null : null,
    status: input.status ?? ACTIVE_STATUS,
    availability: availabilityInput.map((availability) => ({
      channel: availability.channel ?? null,
      availableOn: availability.availableOn,
      link: availability.link
    })),
    grievanceOfficer: {
      name: input.grievanceOfficer?.name ?? defaultOfficer.name,
      email: input.grievanceOfficer?.email ?? defaultOfficer.email,
      telephone: input.grievanceOfficer?.telephone ?? input.grievanceOfficer?.phone ?? defaultOfficer.phone ?? null,
      mobile: input.grievanceOfficer?.mobile ?? null
    },
    reWebsiteUrl: input.reWebsiteUrl ?? entity?.websiteUrl,
    privacyPolicyUrl: input.privacyPolicyUrl ?? entity?.privacyPolicyUrl,
    publicDisclosureUrl: input.publicDisclosureUrl ?? entity?.websiteUrl,
    dataCollection: {
      consentAuditTrail: Boolean(input.dataCollection?.consentAuditTrail),
      prohibitedMobileResourcesAccessed: Boolean(input.dataCollection?.prohibitedMobileResourcesAccessed),
      primaryStorageCountry: input.dataCollection?.primaryStorageCountry ?? "IN",
      processedOutsideIndia: Boolean(input.dataCollection?.processedOutsideIndia),
      returnedAndDeletedOutsideIndiaWithinHours:
        input.dataCollection?.returnedAndDeletedOutsideIndiaWithinHours ?? null
    },
    complianceAttestation: {
      certifiedBy: input.complianceAttestation?.certifiedBy ?? null,
      certifiedAt: input.complianceAttestation?.certifiedAt ?? null,
      certifierRole: input.complianceAttestation?.certifierRole ?? null,
      boardDesignationRef: input.complianceAttestation?.boardDesignationRef ?? null,
      reWebsiteLinked: Boolean(input.complianceAttestation?.reWebsiteLinked),
      lspGrievanceOfficerDisplayed:
        input.complianceAttestation?.lspGrievanceOfficerDisplayed ?? ownerType === "self_owned",
      dataCollectionAndStorageCompliant: Boolean(input.complianceAttestation?.dataCollectionAndStorageCompliant),
      disclosedOnReWebsite: Boolean(input.complianceAttestation?.disclosedOnReWebsite)
    },
    createdAt: input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function upsertDigitalLendingApp(registry, input, regulatedEntities = {}, lendingServiceProviders = {}, now = new Date()) {
  const app = normalizeDigitalLendingApp(input, regulatedEntities, lendingServiceProviders, now);
  const validation = validateDigitalLendingApp(app, regulatedEntities, lendingServiceProviders);
  const nextRegistry =
    validation.summary.status === "blocked"
      ? registry ?? {}
      : {
          ...(registry ?? {}),
          [app.digitalLendingAppId]: app
        };

  return {
    registry: nextRegistry,
    digitalLendingApp: app,
    findings: validation.findings,
    summary: validation.summary
  };
}

export function generateDlaCimsExport(digitalLendingApps = {}, regulatedEntities = {}, options = {}) {
  const findings = [];
  const rows = [];
  const asOf = options.asOf ? new Date(options.asOf) : new Date();
  const lendingServiceProviders = options.lendingServiceProviders ?? {};
  const apps = Object.values(digitalLendingApps)
    .filter((app) => app.status === ACTIVE_STATUS)
    .filter((app) => !options.regulatedEntityId || app.regulatedEntityId === options.regulatedEntityId)
    .sort((left, right) => left.digitalLendingAppId.localeCompare(right.digitalLendingAppId));

  for (const app of apps) {
    const validation = validateDigitalLendingApp(app, regulatedEntities, lendingServiceProviders);
    findings.push(...validation.findings.map((finding) => ({ ...finding, digitalLendingAppId: app.digitalLendingAppId })));
    if (validation.summary.status === "blocked") {
      continue;
    }

    for (const [index, availability] of app.availability.entries()) {
      rows.push({
        serialNumber: rows.length + 1,
        dlaName: app.name,
        ownerName: app.ownerType === "self_owned" ? "Self-owned" : app.ownerName,
        availableOn: availability.availableOn,
        dlaLink: availability.link,
        grievanceOfficerName: app.grievanceOfficer.name,
        grievanceOfficerEmail: app.grievanceOfficer.email,
        grievanceOfficerTelephone: app.grievanceOfficer.telephone,
        grievanceOfficerMobile: app.grievanceOfficer.mobile,
        reWebsite: app.reWebsiteUrl,
        digitalLendingAppId: app.digitalLendingAppId,
        regulatedEntityId: app.regulatedEntityId,
        availabilityIndex: index
      });
    }
  }

  return {
    reportType: "rbi_dla_cims",
    generatedAt: asOf.toISOString(),
    regulatedEntityId: options.regulatedEntityId ?? null,
    columns: DLA_CIMS_COLUMNS,
    count: rows.length,
    rows,
    findings,
    summary: summarizeFindings(findings)
  };
}

export function validateProductPolicy(product, regulatedEntities = {}) {
  const findings = [];

  if (!product?.productId) {
    findings.push(createFinding("error", "RBI-DL-2025", "productId is required.", "productId"));
  }
  if (!product?.regulatedEntityId) {
    findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityId is required for product policy.", "regulatedEntityId"));
  } else if (!regulatedEntities[product.regulatedEntityId]) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product must reference an existing regulated entity.", "regulatedEntityId"));
  } else if (regulatedEntities[product.regulatedEntityId].status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product regulated entity must be active.", "regulatedEntityId"));
  }
  if (!product?.productCode) {
    findings.push(createFinding("error", "RBI-DL-2025", "productCode is required.", "productCode"));
  }
  if (!product?.productName) {
    findings.push(createFinding("error", "RBI-DL-2025", "productName is required.", "productName"));
  }
  if (!product?.productType || !ALLOWED_PRODUCT_TYPES.has(product.productType)) {
    findings.push(createFinding("error", "RBI-DL-2025", "productType is invalid.", "productType"));
  }
  if ((product?.status ?? ACTIVE_STATUS) !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product policy must be active for origination.", "status"));
  }
  if (product?.currency !== "INR") {
    findings.push(createFinding("error", "RBI-DL-2025", "Product currency must be INR.", "currency"));
  }
  if (!Number.isFinite(product?.minAmount) || product.minAmount <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product minAmount must be positive.", "minAmount"));
  }
  if (!Number.isFinite(product?.maxAmount) || product.maxAmount < product.minAmount) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product maxAmount must be greater than or equal to minAmount.", "maxAmount"));
  }
  if (!Number.isFinite(product?.minTenorMonths) || product.minTenorMonths <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product minTenorMonths must be positive.", "minTenorMonths"));
  }
  if (!Number.isFinite(product?.maxTenorMonths) || product.maxTenorMonths < product.minTenorMonths) {
    findings.push(
      createFinding("error", "RBI-DL-2025", "Product maxTenorMonths must be greater than or equal to minTenorMonths.", "maxTenorMonths")
    );
  }
  if (!Number.isFinite(product?.coolingOffDays) || product.coolingOffDays < 1) {
    findings.push(createFinding("error", "RBI-KFS-2024", "Product coolingOffDays must be at least one day.", "coolingOffDays"));
  }
  if (!Number.isFinite(product?.annualInterestRateBps) || product.annualInterestRateBps < 0) {
    findings.push(createFinding("error", "RBI-KFS-2024", "Product annualInterestRateBps is required.", "annualInterestRateBps"));
  }
  if (!Number.isFinite(product?.aprBps) || product.aprBps < product.annualInterestRateBps) {
    findings.push(createFinding("error", "RBI-KFS-2024", "Product aprBps must be at least annualInterestRateBps.", "aprBps"));
  }
  const facilityType = product?.facilityType ?? "term_loan"; const revolving = ["revolving_credit", "overdraft"].includes(facilityType);
  if (!["term_loan", "revolving_credit", "overdraft"].includes(facilityType)) findings.push(createFinding("error", "RBI-DL-2025", "facilityType must be term_loan, revolving_credit, or overdraft.", "facilityType"));
  if (!["weekly", "fortnightly", "monthly", "quarterly"].includes(product?.repaymentFrequency)) findings.push(createFinding("error", "RBI-KFS-2024", "repaymentFrequency must be weekly, fortnightly, monthly, or quarterly.", "repaymentFrequency"));
  if (!revolving && !["amortizing", "bullet", "moratorium", "step_up"].includes(product?.repaymentStructure)) findings.push(createFinding("error", "RBI-KFS-2024", "Term-loan repaymentStructure is invalid.", "repaymentStructure"));
  if (product?.repaymentStructure === "moratorium") { const periods = periodsForTenor(product.maxTenorMonths, product.repaymentFrequency); if (!Number.isInteger(product.moratoriumPeriods) || product.moratoriumPeriods <= 0 || product.moratoriumPeriods >= periods || !["serviced", "deferred"].includes(product.moratoriumInterestTreatment)) findings.push(createFinding("error", "RBI-KFS-2024", "Moratorium policy requires valid periods and serviced/deferred interest treatment.", "moratoriumPeriods")); }
  if (product?.repaymentStructure === "step_up" && (!Number.isInteger(product.stepUpBps) || product.stepUpBps <= 0 || product.stepUpBps > 10000 || !Number.isInteger(product.stepUpEveryPeriods) || product.stepUpEveryPeriods <= 0)) findings.push(createFinding("error", "RBI-KFS-2024", "Step-up policy requires valid escalation bps and cadence.", "stepUpBps"));
  if (revolving) {
    if (!Number.isFinite(product.creditLimit) || product.creditLimit <= 0 || !Number.isFinite(product.drawingPower) || product.drawingPower < 0 || product.drawingPower > product.creditLimit) findings.push(createFinding("error", "RBI-DL-2025", "Revolving facility requires valid creditLimit and drawingPower.", "creditLimit"));
    if (!Number.isFinite(product.minimumPaymentPercent) || product.minimumPaymentPercent <= 0 || product.minimumPaymentPercent > 100) findings.push(createFinding("error", "RBI-KFS-2024", "Revolving minimumPaymentPercent must be above 0 and at most 100.", "minimumPaymentPercent"));
    if (!Number.isInteger(product.reviewFrequencyMonths) || product.reviewFrequencyMonths <= 0 || !product.facilityExpiryDate || Number.isNaN(new Date(`${product.facilityExpiryDate}T23:59:59.999Z`).getTime())) findings.push(createFinding("error", "RBI-DL-2025", "Revolving facility requires review cadence and a valid expiry date.", "reviewFrequencyMonths"));
    if (facilityType === "overdraft" && product.productType !== "msme_working_capital") findings.push(createFinding("error", "RBI-DL-2025", "Overdraft facility requires the msme_working_capital journey type.", "productType"));
  }

  // Interest calculation method: must be declared and valid.
  const interestCalcMethod = product?.interestCalcMethod;
  if (interestCalcMethod !== undefined && interestCalcMethod !== null) {
    if (!["reducing_balance", "flat"].includes(interestCalcMethod)) {
      findings.push(createFinding("error", "RBI-KFS-2024", "interestCalcMethod must be 'reducing_balance' or 'flat'.", "interestCalcMethod"));
    }
    // Flat-rate products must disclose the flat-to-EIR equivalent so the full cost of credit is stated.
    if (interestCalcMethod === "flat" && !Number.isFinite(product?.flatToEirBps)) {
      findings.push(createFinding("error", "RBI-KFS-2024", "Flat-rate products must disclose flatToEirBps (effective interest rate equivalent).", "flatToEirBps"));
    }
  }

  // Product APR is indicative because a fixed fee has no meaningful bps
  // conversion without the actual principal and cash-flow dates. The issued
  // KFS computes authoritative APR from the application-specific cash flows.

  // Mandatory pricing policy reference.
  if (!product?.policyRefs?.pricingPolicyRef) {
    findings.push(createFinding("error", "RBI-KFS-2024", "Product pricingPolicyRef is required.", "policyRefs.pricingPolicyRef"));
  }
  if (!product?.recoveryMechanism) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product recoveryMechanism is required.", "recoveryMechanism"));
  }
  if (!product?.policyRefs?.boardApprovalRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product boardApprovalRef is required.", "policyRefs.boardApprovalRef"));
  }
  if (!Number.isInteger(product?.sanctionValidityDays) || product.sanctionValidityDays < 1 || product.sanctionValidityDays > 365) {
    findings.push(createFinding("error", "RBI-FPC", "Product sanctionValidityDays must be between 1 and 365.", "sanctionValidityDays"));
  }
  const documentTypes = new Set();
  for (const [index, requirement] of (product?.documentRequirements ?? []).entries()) {
    if (!requirement?.type || documentTypes.has(requirement.type)) {
      findings.push(createFinding("error", "RBI-FPC", "Product document requirements need unique non-empty types.", `documentRequirements.${index}.type`));
    }
    documentTypes.add(requirement?.type);
    if (requirement?.acceptedMimeTypes && (!Array.isArray(requirement.acceptedMimeTypes) || requirement.acceptedMimeTypes.length === 0)) {
      findings.push(createFinding("error", "RBI-IT-GRC", "Document acceptedMimeTypes must be a non-empty array when supplied.", `documentRequirements.${index}.acceptedMimeTypes`));
    }
  }

  if (!Number.isFinite(product?.eligibility?.minAgeYears) || product.eligibility.minAgeYears < 18) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product eligibility minAgeYears must be at least 18.", "eligibility.minAgeYears"));
  }
  if (!Number.isFinite(product?.eligibility?.minMonthlyIncome) || product.eligibility.minMonthlyIncome < 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product eligibility minMonthlyIncome is required.", "eligibility.minMonthlyIncome"));
  }

  // Prepayment, Foreclosure and Floating-rate Reset validations
  const rateType = product?.interestRateType ?? "fixed";
  if (!["fixed", "floating"].includes(rateType)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product interestRateType must be fixed or floating.", "interestRateType"));
  }

  if (rateType === "floating") {
    const resetPolicy = product?.interestRateResetPolicy;
    if (!resetPolicy) {
      findings.push(createFinding("error", "RBI-DL-2025", "Floating-rate products require an interestRateResetPolicy.", "interestRateResetPolicy"));
    } else {
      if (!resetPolicy.resetBenchmark) {
        findings.push(createFinding("error", "RBI-DL-2025", "Interest rate reset benchmark is required.", "interestRateResetPolicy.resetBenchmark"));
      }
      if (!Number.isInteger(resetPolicy.resetFrequencyMonths) || resetPolicy.resetFrequencyMonths <= 0) {
        findings.push(createFinding("error", "RBI-DL-2025", "Interest rate reset frequency in months must be a positive integer.", "interestRateResetPolicy.resetFrequencyMonths"));
      }
      if (Number.isFinite(resetPolicy.fixedSwitchFeeAmount) && resetPolicy.fixedSwitchFeeAmount < 0) {
        findings.push(createFinding("error", "RBI-DL-2025", "Fixed switch fee amount must be non-negative.", "interestRateResetPolicy.fixedSwitchFeeAmount"));
      }
    }
  }

  const prepay = product?.prepaymentPolicy;
  if (prepay) {
    if (typeof prepay.allowed !== "boolean") {
      findings.push(createFinding("error", "RBI-DL-2025", "Prepayment policy allowed flag must be a boolean.", "prepaymentPolicy.allowed"));
    }
    if (Number.isFinite(prepay.chargeBps) && prepay.chargeBps < 0) {
      findings.push(createFinding("error", "RBI-DL-2025", "Prepayment charge bps must be non-negative.", "prepaymentPolicy.chargeBps"));
    }
    if (Number.isFinite(prepay.lockInMonths) && prepay.lockInMonths < 0) {
      findings.push(createFinding("error", "RBI-DL-2025", "Prepayment lock-in period must be non-negative.", "prepaymentPolicy.lockInMonths"));
    }
  }

  const forecl = product?.foreclosurePolicy;
  if (forecl) {
    if (typeof forecl.allowed !== "boolean") {
      findings.push(createFinding("error", "RBI-DL-2025", "Foreclosure policy allowed flag must be a boolean.", "foreclosurePolicy.allowed"));
    }
    if (Number.isFinite(forecl.chargeBps) && forecl.chargeBps < 0) {
      findings.push(createFinding("error", "RBI-DL-2025", "Foreclosure charge bps must be non-negative.", "foreclosurePolicy.chargeBps"));
    }
    if (Number.isFinite(forecl.lockInMonths) && forecl.lockInMonths < 0) {
      findings.push(createFinding("error", "RBI-DL-2025", "Foreclosure lock-in period must be non-negative.", "foreclosurePolicy.lockInMonths"));
    }
  }

  // RBI Rule: No prepayment penalty/foreclosure charge on floating rate term loans to individual borrowers for non-business purposes.
  // Product type is canonical; facility mechanics remain a separate field.
  const isRetail = !isBusinessProductJourneyType(product?.productType);
  if (rateType === "floating" && isRetail) {
    if (prepay?.chargeBps > 0) {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Prepayment penalty is prohibited on floating-rate individual retail loans.", "prepaymentPolicy.chargeBps"));
    }
    if (forecl?.chargeBps > 0) {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Foreclosure charge is prohibited on floating-rate individual retail loans.", "foreclosurePolicy.chargeBps"));
    }

    // Also scan charges, contingentCharges, penalCharges for any non-zero foreclosure/prepayment fees
    const allCharges = [...(product?.charges ?? []), ...(product?.contingentCharges ?? []), ...(product?.penalCharges ?? [])];
    for (const c of allCharges) {
      const name = (c.name ?? "").toLowerCase();
      const reason = (c.reason ?? "").toLowerCase();
      if ((name.includes("foreclosure") || name.includes("prepayment") || reason.includes("foreclosure") || reason.includes("prepayment")) && (c.amount > 0 || c.chargeBps > 0)) {
        findings.push(createFinding("error", "RBI-FPC-PENAL", `Charge '${c.name}' is prohibited on floating-rate individual retail loans.`, "charges"));
      }
    }
  }

  validateCharges("charges", product?.charges, findings);
  validateCharges("contingentCharges", product?.contingentCharges, findings);
  validateCharges("penalCharges", product?.penalCharges, findings, { penal: true });
  for (const key of REQUIRED_ACCOUNTING_KEYS) {
    if (typeof product?.accountingProfile?.accounts?.[key] !== "string" || product.accountingProfile.accounts[key].trim() === "") {
      findings.push(createFinding("error", "RBI-IT-GRC", `Accounting profile account '${key}' is required.`, `accountingProfile.accounts.${key}`));
    }
  }
  const waterfall = product?.paymentAllocationWaterfall;
  if (!Array.isArray(waterfall) || waterfall.length !== PAYMENT_ALLOCATION_COMPONENTS.length || new Set(waterfall).size !== PAYMENT_ALLOCATION_COMPONENTS.length || waterfall.some((component) => !PAYMENT_ALLOCATION_COMPONENTS.includes(component))) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Payment allocation waterfall must contain interest, charges, and principal exactly once.", "paymentAllocationWaterfall"));
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function normalizeProductPolicy(input, now = new Date()) {
  return {
    productId: input.productId,
    regulatedEntityId: input.regulatedEntityId,
    productCode: input.productCode,
    productName: input.productName,
    productType: input.productType,
    // Policy versioning: each material change publishes a new version effective
    // from a stated date. Prior versions are retained so an application (and any
    // loan it becomes) is always governed by the version effective on its date.
    version: Number.isFinite(input.version) ? input.version : 1,
    effectiveFrom: input.effectiveFrom ?? now.toISOString().slice(0, 10),
    effectiveTo: input.effectiveTo ?? null,
    priorVersions: Array.isArray(input.priorVersions) ? input.priorVersions : [],
    status: input.status ?? ACTIVE_STATUS,
    currency: input.currency ?? "INR",
    // Secured loans (mortgage, hypothecation, etc.) require a CERSAI security
    // interest to be registered before disbursement under the SARFAESI Act.
    securedLoan: !!input.securedLoan,
    minAmount: input.minAmount,
    maxAmount: input.maxAmount,
    minTenorMonths: input.minTenorMonths,
    maxTenorMonths: input.maxTenorMonths,
    annualInterestRateBps: input.annualInterestRateBps,
    aprBps: input.aprBps ?? input.annualInterestRateBps,
    interestCalcMethod: input.interestCalcMethod ?? "reducing_balance",
    flatToEirBps: Number.isFinite(input.flatToEirBps) ? input.flatToEirBps : null,
    facilityType: input.facilityType ?? "term_loan",
    repaymentFrequency: input.repaymentFrequency ?? "monthly",
    repaymentStructure: input.repaymentStructure ?? "amortizing",
    moratoriumPeriods: Number.isInteger(input.moratoriumPeriods) ? input.moratoriumPeriods : 0,
    moratoriumInterestTreatment: input.moratoriumInterestTreatment ?? "serviced",
    stepUpBps: Number.isInteger(input.stepUpBps) ? input.stepUpBps : 0,
    stepUpEveryPeriods: Number.isInteger(input.stepUpEveryPeriods) ? input.stepUpEveryPeriods : 12,
    creditLimit: Number.isFinite(input.creditLimit) ? input.creditLimit : null,
    drawingPower: Number.isFinite(input.drawingPower) ? input.drawingPower : (Number.isFinite(input.creditLimit) ? input.creditLimit : null),
    minimumPaymentPercent: Number.isFinite(input.minimumPaymentPercent) ? input.minimumPaymentPercent : null,
    reviewFrequencyMonths: Number.isInteger(input.reviewFrequencyMonths) ? input.reviewFrequencyMonths : null,
    facilityExpiryDate: input.facilityExpiryDate ?? null,
    coolingOffDays: input.coolingOffDays ?? 1,
    sanctionValidityDays: Number.isInteger(input.sanctionValidityDays) ? input.sanctionValidityDays : 30,
    sanctionValidityPolicyRef: input.sanctionValidityPolicyRef ?? input.policyRefs?.boardApprovalRef ?? null,
    documentRequirements: Array.isArray(input.documentRequirements)
      ? input.documentRequirements.map((requirement) => ({
          type: requirement.type,
          label: requirement.label ?? requirement.type,
          required: requirement.required !== false,
          acceptedMimeTypes: Array.isArray(requirement.acceptedMimeTypes) ? [...requirement.acceptedMimeTypes] : undefined,
          maxSizeBytes: Number.isInteger(requirement.maxSizeBytes) ? requirement.maxSizeBytes : undefined
        }))
      : [],
    recoveryMechanism: input.recoveryMechanism,
    interestRateType: input.interestRateType ?? "fixed",
    interestRateResetPolicy: input.interestRateResetPolicy
      ? {
          resetBenchmark: input.interestRateResetPolicy.resetBenchmark ?? null,
          resetFrequencyMonths: Number.isInteger(input.interestRateResetPolicy.resetFrequencyMonths)
            ? input.interestRateResetPolicy.resetFrequencyMonths
            : null,
          fixedSwitchFeeAmount: Number.isFinite(input.interestRateResetPolicy.fixedSwitchFeeAmount)
            ? input.interestRateResetPolicy.fixedSwitchFeeAmount
            : 0,
          fixedSwitchAllowed: !!input.interestRateResetPolicy.fixedSwitchAllowed
        }
      : null,
    prepaymentPolicy: input.prepaymentPolicy
      ? {
          allowed: input.prepaymentPolicy.allowed ?? true,
          chargeBps: Number.isFinite(input.prepaymentPolicy.chargeBps) ? input.prepaymentPolicy.chargeBps : 0,
          lockInMonths: Number.isFinite(input.prepaymentPolicy.lockInMonths) ? input.prepaymentPolicy.lockInMonths : 0
        }
      : { allowed: true, chargeBps: 0, lockInMonths: 0 },
    foreclosurePolicy: input.foreclosurePolicy
      ? {
          allowed: input.foreclosurePolicy.allowed ?? true,
          chargeBps: Number.isFinite(input.foreclosurePolicy.chargeBps) ? input.foreclosurePolicy.chargeBps : 0,
          lockInMonths: Number.isFinite(input.foreclosurePolicy.lockInMonths) ? input.foreclosurePolicy.lockInMonths : 0
        }
      : { allowed: true, chargeBps: 0, lockInMonths: 0 },
    charges: Array.isArray(input.charges) ? input.charges : [],
    contingentCharges: Array.isArray(input.contingentCharges) ? input.contingentCharges : [],
    penalCharges: Array.isArray(input.penalCharges) ? input.penalCharges : [],
    eligibility: {
      minAgeYears: input.eligibility?.minAgeYears ?? 18,
      maxAgeYears: input.eligibility?.maxAgeYears ?? null,
      minMonthlyIncome: input.eligibility?.minMonthlyIncome ?? 0,
      allowedResidencyCountry: input.eligibility?.allowedResidencyCountry ?? "IN"
    },
    disbursementModes: Array.isArray(input.disbursementModes)
      ? input.disbursementModes
      : ["borrower_account", "end_beneficiary"],
    policyRefs: {
      boardApprovalRef: input.policyRefs?.boardApprovalRef ?? null,
      pricingPolicyRef: input.policyRefs?.pricingPolicyRef ?? null,
      penalChargesPolicyRef: input.policyRefs?.penalChargesPolicyRef ?? null
    },
    accountingProfile: {
      profileId: input.accountingProfile?.profileId ?? `${input.productCode ?? "product"}_v${Number.isFinite(input.version) ? input.version : 1}`,
      accounts: { ...DEFAULT_ACCOUNTING_PROFILE, ...(input.accountingProfile?.accounts ?? {}) }
    },
    paymentAllocationWaterfall: Array.isArray(input.paymentAllocationWaterfall)
      ? [...input.paymentAllocationWaterfall]
      : [...PAYMENT_ALLOCATION_COMPONENTS],
    createdAt: input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function stripVersionHistory(product) {
  const { priorVersions, ...snapshot } = product;
  return snapshot;
}

// Return the policy version effective at a given date, drawing on the retained
// prior versions. Before the earliest effectiveFrom, the earliest version is
// returned as the closest governing policy.
export function selectProductPolicyVersion(product, asOf = new Date()) {
  if (!product) {
    return null;
  }
  const asOfDate = (asOf instanceof Date ? asOf : new Date(asOf)).toISOString().slice(0, 10);
  const candidates = [...(product.priorVersions ?? []), stripVersionHistory(product)].sort(
    (a, b) => (a.effectiveFrom ?? "") < (b.effectiveFrom ?? "") ? -1 : 1
  );
  const match = candidates.find(
    (version) =>
      (version.effectiveFrom ?? "") <= asOfDate && (!version.effectiveTo || asOfDate < version.effectiveTo)
  );
  return match ?? candidates[0] ?? null;
}

export function upsertProductPolicy(registry, input, regulatedEntities = {}, now = new Date()) {
  const existing = (registry ?? {})[input?.productId] ?? null;
  const product = normalizeProductPolicy(input, now);
  const validation = validateProductPolicy(product, regulatedEntities);
  const findings = [...validation.findings];

  // A change to an existing product must publish a new version with a later
  // effective date; the superseded version is retained with its window closed.
  let stored = product;
  if (existing) {
    if (product.version < existing.version) {
      findings.push(createFinding("error", "RBI-DL-2025", "Product policy version must not decrease.", "version"));
    } else if (product.version > existing.version) {
      if (product.effectiveFrom <= existing.effectiveFrom) {
        findings.push(
          createFinding("error", "RBI-DL-2025", "A new product policy version must take effect after the current one.", "effectiveFrom")
        );
      }
      const archived = { ...stripVersionHistory(existing), effectiveTo: product.effectiveFrom };
      stored = {
        ...product,
        createdAt: existing.createdAt ?? product.createdAt,
        priorVersions: [...(existing.priorVersions ?? []), archived]
      };
    } else {
      // Same version: an in-place correction that keeps the effective window and
      // history of the current version.
      stored = {
        ...product,
        version: existing.version,
        effectiveFrom: existing.effectiveFrom,
        createdAt: existing.createdAt ?? product.createdAt,
        priorVersions: existing.priorVersions ?? []
      };
    }
  }

  const summary = summarizeFindings(findings);
  const nextRegistry =
    summary.status === "blocked"
      ? registry ?? {}
      : {
          ...(registry ?? {}),
          [stored.productId]: stored
        };

  return {
    registry: nextRegistry,
    product: stored,
    findings,
    summary
  };
}

export function resolveLoanApplicationReferences(application, registries = {}, now = new Date()) {
  const findings = [];
  let resolved = { ...application };

  if (!application.regulatedEntityId) {
    findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityId is required.", "regulatedEntityId"));
  } else {
    const entity = registries.regulatedEntities?.[application.regulatedEntityId];
    if (!entity) {
      findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityId does not match an existing RE.", "regulatedEntityId"));
    } else if (entity.status !== ACTIVE_STATUS) {
      findings.push(createFinding("error", "RBI-DL-2025", "Referenced regulated entity is not active.", "regulatedEntityId"));
    } else {
      resolved = {
        ...resolved,
        tenant: {
          regulatedEntityName: entity.regulatedEntityName,
          regulatedEntityType: entity.regulatedEntityType,
          rbiRegistrationNumber: entity.rbiRegistrationNumber,
          grievanceOfficer: entity.grievanceOfficer,
          privacyPolicyUrl: entity.privacyPolicyUrl,
          websiteUrl: entity.websiteUrl,
          boardPolicyRefs: entity.boardPolicyRefs,
          licenseMetadata: entity.licenseMetadata
        },
        dataResidency: {
          ...entity.dataResidency,
          ...(application.dataResidency ?? {})
        }
      };
    }
  }

  if (application.productId || application.productCode) {
    const baseProduct = findProductPolicy(application, registries.productPolicies ?? {}, resolved.regulatedEntityId);
    if (!baseProduct) {
      findings.push(
        createFinding("error", "RBI-DL-2025", "Application productId/productCode does not match an active product policy.", "productId")
      );
    } else {
      const asOf = application.appliedAt ?? application.createdAt ?? now;
      const product = selectProductPolicyVersion(baseProduct, asOf);
      if (!product) {
        findings.push(createFinding("error", "RBI-DL-2025", "No effective version of product policy was found for this date.", "productId"));
      } else if (product.status !== ACTIVE_STATUS) {
        findings.push(createFinding("error", "RBI-DL-2025", "Referenced product policy version is not active.", "productId"));
      } else {
        resolved = {
          ...resolved,
          productId: baseProduct.productId,
          product: {
            ...product,
            requestedAmount: application.product?.requestedAmount ?? application.requestedAmount,
            requestedTenorMonths: application.product?.requestedTenorMonths ?? application.requestedTenorMonths
          },
          repayment: {
            ...(application.repayment ?? {}),
            recoveryMechanism: application.repayment?.recoveryMechanism ?? product.recoveryMechanism
          }
        };
      }
    }
  }

  return {
    application: resolved,
    findings,
    summary: summarizeFindings(findings)
  };
}

function findProductPolicy(application, productPolicies, regulatedEntityId) {
  if (application.productId && productPolicies[application.productId]) {
    return productPolicies[application.productId];
  }

  if (!application.productCode) {
    return null;
  }

  return (
    Object.values(productPolicies).find((product) => {
      if (product.productCode !== application.productCode) {
        return false;
      }
      if (regulatedEntityId && product.regulatedEntityId !== regulatedEntityId) {
        return false;
      }
      return true;
    }) ?? null
  );
}

function validateActiveLspAgreement(lsp, findings) {
  const agreement = lsp?.agreement ?? {};
  if (!agreement.agreementRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "LSP agreement reference is required.", "agreement.agreementRef"));
  }
  if (!agreement.effectiveFrom) {
    findings.push(createFinding("error", "RBI-DL-2025", "LSP agreement effectiveFrom is required.", "agreement.effectiveFrom"));
  }
  if (!agreement.rolesAndObligationsRef) {
    findings.push(
      createFinding("error", "RBI-DL-2025", "LSP contract must evidence defined roles and obligations.", "agreement.rolesAndObligationsRef")
    );
  }
  if (!agreement.rightsAndObligationsRef) {
    findings.push(
      createFinding("error", "RBI-DL-2025", "LSP contract must evidence rights and obligations.", "agreement.rightsAndObligationsRef")
    );
  }
  if (!agreement.scopeOfWorkRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "LSP scope of work reference is required.", "agreement.scopeOfWorkRef"));
  }
}

function validateActiveLspDueDiligence(lsp, findings) {
  const dueDiligence = lsp?.dueDiligence ?? {};
  const required = [
    ["completedAt", "Enhanced due diligence completion timestamp is required."],
    ["approvedBy", "Enhanced due diligence approver is required."],
    ["approvalRef", "Enhanced due diligence approval reference is required."],
    ["technicalCapabilityReviewRef", "Technical capability review evidence is required."],
    ["dataPrivacyReviewRef", "Data privacy and storage review evidence is required."],
    ["fairConductReviewRef", "Fair borrower conduct review evidence is required."],
    ["pastConductReviewRef", "Past conduct review evidence is required."],
    ["regulatoryComplianceReviewRef", "Regulatory compliance review evidence is required."]
  ];
  for (const [key, message] of required) {
    if (!dueDiligence[key]) {
      findings.push(createFinding("error", "RBI-DL-2025", message, `dueDiligence.${key}`));
    }
  }
}

function validateActiveLspPeriodicReview(lsp, findings) {
  const periodicReview = lsp?.periodicReview ?? {};
  if (!periodicReview.lastReviewedAt) {
    findings.push(createFinding("error", "RBI-DL-2025", "Periodic LSP review timestamp is required.", "periodicReview.lastReviewedAt"));
  }
  if (!periodicReview.nextReviewDueAt) {
    findings.push(createFinding("error", "RBI-DL-2025", "Next periodic LSP review due date is required.", "periodicReview.nextReviewDueAt"));
  }
  if (
    periodicReview.lastReviewedAt &&
    periodicReview.nextReviewDueAt &&
    new Date(periodicReview.nextReviewDueAt).getTime() <= new Date(periodicReview.lastReviewedAt).getTime()
  ) {
    findings.push(createFinding("error", "RBI-DL-2025", "Next LSP review must be after the last review.", "periodicReview.nextReviewDueAt"));
  }
  if (!periodicReview.reviewedBy) {
    findings.push(createFinding("error", "RBI-DL-2025", "Periodic LSP reviewer is required.", "periodicReview.reviewedBy"));
  }
  if (!periodicReview.reviewRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "Periodic LSP review evidence reference is required.", "periodicReview.reviewRef"));
  }
  if (!periodicReview.outcome || !ALLOWED_LSP_REVIEW_OUTCOMES.has(periodicReview.outcome)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Periodic LSP review outcome is invalid.", "periodicReview.outcome"));
  }
  if (periodicReview.outcome && periodicReview.outcome !== "satisfactory" && !periodicReview.deviationActionRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "LSP review deviations require action evidence.", "periodicReview.deviationActionRef"));
  }
}

function validateActiveLspDataControls(lsp, findings) {
  const dataControls = lsp?.dataControls ?? {};
  if (dataControls.primaryStorageCountry !== "IN") {
    findings.push(createFinding("error", "RBI-DATA-RESIDENCY", "LSP primary data storage must be in India.", "dataControls.primaryStorageCountry"));
  }
  if (
    dataControls.processedOutsideIndia === true &&
    (!Number.isFinite(dataControls.returnedAndDeletedOutsideIndiaWithinHours) ||
      dataControls.returnedAndDeletedOutsideIndiaWithinHours > 24)
  ) {
    findings.push(
      createFinding(
        "error",
        "RBI-DATA-RESIDENCY",
        "LSP data processed outside India must return to India and be deleted outside India within 24 hours.",
        "dataControls.returnedAndDeletedOutsideIndiaWithinHours"
      )
    );
  }
  if (dataControls.storesOnlyMinimalBorrowerData !== true) {
    findings.push(
      createFinding("error", "RBI-DL-2025", "LSP may store only minimal borrower data required for its contracted scope.", "dataControls.storesOnlyMinimalBorrowerData")
    );
  }
  if (dataControls.prohibitedBorrowerDataStored === true) {
    findings.push(createFinding("error", "RBI-DL-2025", "LSP must not store prohibited borrower data.", "dataControls.prohibitedBorrowerDataStored"));
  }
}

function validateActiveLspFeeControls(lsp, findings) {
  const feeControls = lsp?.feeControls ?? {};
  if (feeControls.paidByRegulatedEntity !== true) {
    findings.push(createFinding("error", "RBI-FUND-FLOW", "LSP fees must be paid by the RE.", "feeControls.paidByRegulatedEntity"));
  }
  if (feeControls.borrowerChargedSeparately === true) {
    findings.push(createFinding("error", "RBI-FUND-FLOW", "LSP fees must not be charged separately to the borrower.", "feeControls.borrowerChargedSeparately"));
  }
}

function validateBorrowerFacingLsp(lsp, findings) {
  if (!isHttpUrl(lsp?.websiteUrl)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower-facing LSP websiteUrl is required.", "websiteUrl"));
  }
  if (!isHttpUrl(lsp?.privacyPolicyUrl)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower-facing LSP privacyPolicyUrl is required.", "privacyPolicyUrl"));
  }
  if (!isHttpUrl(lsp?.publicDisclosureUrl)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower-facing LSP public disclosure URL is required.", "publicDisclosureUrl"));
  }
  if (!lsp?.grievanceOfficer?.name) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower-facing LSP grievance officer name is required.", "grievanceOfficer.name"));
  }
  if (!lsp?.grievanceOfficer?.email) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower-facing LSP grievance officer email is required.", "grievanceOfficer.email"));
  }
  if (!lsp?.grievanceOfficer?.phone && !lsp?.grievanceOfficer?.mobile) {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower-facing LSP grievance officer phone or mobile is required.", "grievanceOfficer.phone"));
  }
}

function lspHasBorrowerInterface(lsp) {
  return Boolean(lsp?.interfaceWithBorrower) || (lsp?.services ?? []).some((service) => BORROWER_FACING_LSP_SERVICES.has(service));
}

function lspProvidesRecovery(lsp) {
  return (lsp?.services ?? []).some((service) => RECOVERY_LSP_SERVICES.has(service));
}

function validateActiveDlaAttestation(app, findings) {
  const attestation = app?.complianceAttestation ?? {};
  if (!attestation.certifiedBy) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "CCO/compliance certification actor is required.", "complianceAttestation.certifiedBy"));
  }
  if (!attestation.certifiedAt) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "CCO/compliance certification timestamp is required.", "complianceAttestation.certifiedAt"));
  }
  if (!attestation.certifierRole) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "Certification role is required.", "complianceAttestation.certifierRole"));
  }
  if (!attestation.boardDesignationRef) {
    findings.push(
      createFinding("error", "RBI-DLA-CIMS", "Board-designated CCO/compliance role reference is required.", "complianceAttestation.boardDesignationRef")
    );
  }
  if (attestation.reWebsiteLinked !== true) {
    findings.push(createFinding("error", "RBI-DLA-CIMS", "DLA must link back to the RE website.", "complianceAttestation.reWebsiteLinked"));
  }
  if (app.ownerType === "lsp_owned" && attestation.lspGrievanceOfficerDisplayed !== true) {
    findings.push(
      createFinding(
        "error",
        "RBI-DLA-CIMS",
        "LSP-owned DLA must display a grievance officer for borrower complaints.",
        "complianceAttestation.lspGrievanceOfficerDisplayed"
      )
    );
  }
  if (attestation.dataCollectionAndStorageCompliant !== true) {
    findings.push(
      createFinding(
        "error",
        "RBI-DLA-CIMS",
        "DLA data collection and storage compliance attestation is required.",
        "complianceAttestation.dataCollectionAndStorageCompliant"
      )
    );
  }
  if (attestation.disclosedOnReWebsite !== true) {
    findings.push(
      createFinding("error", "RBI-DLA-CIMS", "DLA must be disclosed on the RE website.", "complianceAttestation.disclosedOnReWebsite")
    );
  }
}

function validateDlaDataCollection(app, findings) {
  const dataCollection = app?.dataCollection ?? {};
  if (dataCollection.consentAuditTrail !== true) {
    findings.push(createFinding("error", "RBI-DL-2025", "DLA data collection must have a consent audit trail.", "dataCollection.consentAuditTrail"));
  }
  if (dataCollection.prohibitedMobileResourcesAccessed === true) {
    findings.push(
      createFinding(
        "error",
        "RBI-DL-2025",
        "DLA must not access prohibited mobile phone resources for lending.",
        "dataCollection.prohibitedMobileResourcesAccessed"
      )
    );
  }
  if (dataCollection.primaryStorageCountry !== "IN") {
    findings.push(createFinding("error", "RBI-DATA-RESIDENCY", "DLA primary data storage must be in India.", "dataCollection.primaryStorageCountry"));
  }
  if (
    dataCollection.processedOutsideIndia === true &&
    (!Number.isFinite(dataCollection.returnedAndDeletedOutsideIndiaWithinHours) ||
      dataCollection.returnedAndDeletedOutsideIndiaWithinHours > 24)
  ) {
    findings.push(
      createFinding(
        "error",
        "RBI-DATA-RESIDENCY",
        "DLA data processed outside India must return to India and be deleted outside India within 24 hours.",
        "dataCollection.returnedAndDeletedOutsideIndiaWithinHours"
      )
    );
  }
}

function isHttpUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  return value.startsWith("https://") || value.startsWith("http://");
}

function validateCharges(path, charges, findings, options = {}) {
  if (!Array.isArray(charges)) {
    return;
  }

  for (const [index, charge] of charges.entries()) {
    if (!charge.name) {
      findings.push(createFinding("error", "RBI-KFS-2024", "Charge name is required.", `${path}.${index}.name`));
    }
    if (!charge.reason) {
      findings.push(createFinding("error", "RBI-KFS-2024", "Charge reason is required.", `${path}.${index}.reason`));
    }
    if (!charge.type) {
      findings.push(createFinding("error", "RBI-KFS-2024", "Charge type is required.", `${path}.${index}.type`));
    } else if (!ALLOWED_CHARGE_TYPES.has(charge.type)) {
      findings.push(createFinding("error", "RBI-KFS-2024", "Charge type is invalid.", `${path}.${index}.type`));
    }
    if (options.penal && charge.type === "penal_interest") {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Penalties must not be configured as penal interest.", `${path}.${index}.type`));
    }
    if (options.penal && charge.capitalizes === true) {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Penal charges must not be capitalized.", `${path}.${index}.capitalizes`));
    }
  }
}
