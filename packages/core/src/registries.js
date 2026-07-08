import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { ALLOWED_RE_TYPES } from "./loan-policy.js";

const ACTIVE_STATUS = "active";
const ALLOWED_PRODUCT_TYPES = new Set([
  "personal_loan",
  "business_loan",
  "msme_loan",
  "consumer_durable_loan",
  "vehicle_loan",
  "housing_loan",
  "education_loan",
  "gold_loan",
  "loan_against_property"
]);
const ALLOWED_DLA_OWNER_TYPES = new Set(["self_owned", "lsp_owned"]);
const ALLOWED_DLA_STATUSES = new Set(["draft", "active", "ceased"]);
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

export function validateRegulatedEntity(entity) {
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
  const validation = validateRegulatedEntity(entity);
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

export function validateDigitalLendingApp(app, regulatedEntities = {}) {
  const findings = [];
  const entity = app?.regulatedEntityId ? regulatedEntities[app.regulatedEntityId] : null;
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

export function normalizeDigitalLendingApp(input, regulatedEntities = {}, now = new Date()) {
  const entity = regulatedEntities?.[input.regulatedEntityId] ?? null;
  const ownerType = input.ownerType ?? (input.lspId || input.lspName ? "lsp_owned" : "self_owned");
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
    ownerName: ownerType === "self_owned" ? (input.ownerName ?? "Self-owned") : input.ownerName ?? input.lspName,
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

export function upsertDigitalLendingApp(registry, input, regulatedEntities = {}, now = new Date()) {
  const app = normalizeDigitalLendingApp(input, regulatedEntities, now);
  const validation = validateDigitalLendingApp(app, regulatedEntities);
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
  const apps = Object.values(digitalLendingApps)
    .filter((app) => app.status === ACTIVE_STATUS)
    .filter((app) => !options.regulatedEntityId || app.regulatedEntityId === options.regulatedEntityId)
    .sort((left, right) => left.digitalLendingAppId.localeCompare(right.digitalLendingAppId));

  for (const app of apps) {
    const validation = validateDigitalLendingApp(app, regulatedEntities);
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
  if (!product?.recoveryMechanism) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product recoveryMechanism is required.", "recoveryMechanism"));
  }
  if (!product?.policyRefs?.boardApprovalRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product boardApprovalRef is required.", "policyRefs.boardApprovalRef"));
  }
  if (!Number.isFinite(product?.eligibility?.minAgeYears) || product.eligibility.minAgeYears < 18) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product eligibility minAgeYears must be at least 18.", "eligibility.minAgeYears"));
  }
  if (!Number.isFinite(product?.eligibility?.minMonthlyIncome) || product.eligibility.minMonthlyIncome < 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "Product eligibility minMonthlyIncome is required.", "eligibility.minMonthlyIncome"));
  }

  validateCharges("charges", product?.charges, findings);
  validateCharges("contingentCharges", product?.contingentCharges, findings);
  validateCharges("penalCharges", product?.penalCharges, findings, { penal: true });

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
    status: input.status ?? ACTIVE_STATUS,
    currency: input.currency ?? "INR",
    minAmount: input.minAmount,
    maxAmount: input.maxAmount,
    minTenorMonths: input.minTenorMonths,
    maxTenorMonths: input.maxTenorMonths,
    annualInterestRateBps: input.annualInterestRateBps,
    aprBps: input.aprBps ?? input.annualInterestRateBps,
    repaymentFrequency: input.repaymentFrequency ?? "monthly",
    coolingOffDays: input.coolingOffDays ?? 1,
    recoveryMechanism: input.recoveryMechanism,
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
    createdAt: input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function upsertProductPolicy(registry, input, regulatedEntities = {}, now = new Date()) {
  const product = normalizeProductPolicy(input, now);
  const validation = validateProductPolicy(product, regulatedEntities);
  const nextRegistry =
    validation.summary.status === "blocked"
      ? registry ?? {}
      : {
          ...(registry ?? {}),
          [product.productId]: product
        };

  return {
    registry: nextRegistry,
    product,
    findings: validation.findings,
    summary: validation.summary
  };
}

export function resolveLoanApplicationReferences(application, registries = {}) {
  const findings = [];
  let resolved = { ...application };

  if (application.regulatedEntityId) {
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
          grievanceOfficer: entity.grievanceOfficer,
          privacyPolicyUrl: entity.privacyPolicyUrl,
          websiteUrl: entity.websiteUrl,
          boardPolicyRefs: entity.boardPolicyRefs
        },
        dataResidency: {
          ...entity.dataResidency,
          ...(application.dataResidency ?? {})
        }
      };
    }
  }

  if (application.productId || application.productCode) {
    const product = findProductPolicy(application, registries.productPolicies ?? {}, resolved.regulatedEntityId);
    if (!product) {
      findings.push(
        createFinding("error", "RBI-DL-2025", "Application productId/productCode does not match an active product policy.", "productId")
      );
    } else if (product.status !== ACTIVE_STATUS) {
      findings.push(createFinding("error", "RBI-DL-2025", "Referenced product policy is not active.", "productId"));
    } else {
      resolved = {
        ...resolved,
        productId: product.productId,
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
    if (options.penal && charge.type === "penal_interest") {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Penalties must not be configured as penal interest.", `${path}.${index}.type`));
    }
    if (options.penal && charge.capitalizes === true) {
      findings.push(createFinding("error", "RBI-FPC-PENAL", "Penal charges must not be capitalized.", `${path}.${index}.capitalizes`));
    }
  }
}
