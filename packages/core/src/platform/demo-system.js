import { createHash } from "node:crypto";
import { ExternalServiceManager } from "../integrations/external-services.js";
import { PRODUCT_JOURNEY_TYPES } from "../journeys/product-journey-administration.js";
import {
  normalizeProductPolicy,
  normalizeRegulatedEntity,
  validateProductPolicy,
  validateRegulatedEntity
} from "../shared/registries.js";

export const DEMO_REFERENCE_TIME = "2026-07-01T00:00:00.000Z";
export const DEMO_SHOWCASE_PROFILE_ID = "showcase-v1";
export const DEMO_WORKSHOP_PROFILE_ID = "workshop-v1";

export const DEMO_INTEGRATION_KEYS = Object.freeze([
  "account_aggregator",
  "bank_account",
  "bureau",
  "cersai",
  "cic",
  "ckycrr",
  "core_banking",
  "email",
  "escrow",
  "esign",
  "fiu",
  "payment_rail",
  "sms",
  "vcip",
  "whatsapp"
]);

export const DEMO_PRODUCT_ADMIN_ROLES = Object.freeze([
  "journey_admin",
  "product_owner",
  "checker",
  "operator",
  "auditor"
]);

export const DEMO_PERSONAS = Object.freeze([
  { userId: "tenant_admin_1", label: "Tenant administrator", principalRole: "journey_admin" },
  { userId: "credit_maker_1", label: "Credit maker" },
  { userId: "credit_checker_1", label: "Credit checker", principalRole: "checker" },
  { userId: "credit_lead_1", label: "Credit lead", principalRole: "product_owner" },
  { userId: "credit_reviewer_1", label: "Human reviewer" },
  { userId: "loan_officer_1", label: "Loan officer", principalRole: "operator" },
  { userId: "disbursement_maker_1", label: "Disbursement maker" },
  { userId: "compliance_analyst_1", label: "Compliance analyst", principalRole: "auditor" },
  { userId: "collections_manager_1", label: "Collections manager" },
  { userId: "collections_lead_1", label: "Collections lead" },
  { userId: "portfolio_risk_1", label: "Portfolio risk manager" },
  { userId: "grievance_officer_1", label: "Grievance officer" },
  { userId: "grievance_lead_1", label: "Grievance lead" },
  { userId: "kyc_officer_1", label: "KYC officer" }
]);

const SECURED_PRODUCT_TYPES = new Set([
  "commercial_vehicle_finance",
  "equipment_machinery_finance",
  "gold_loan",
  "green_equipment_finance",
  "home_loan",
  "loan_against_property",
  "personal_vehicle_loan",
  "secured_business_loan"
]);

const PRINCIPAL_BY_PRODUCT_ROLE = Object.freeze({
  journey_admin: "tenant_admin_1",
  product_owner: "credit_lead_1",
  checker: "credit_checker_1",
  operator: "loan_officer_1",
  auditor: "compliance_analyst_1"
});

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function humanize(value) {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function demoRegulatedEntity(tenantId, now) {
  return normalizeRegulatedEntity({
    regulatedEntityId: "re_1",
    regulatedEntityName: "LoanOS Showcase NBFC Limited",
    regulatedEntityType: "nbfc",
    rbiRegistrationNumber: `DEMO-${tenantId.toUpperCase()}-0001`,
    country: "IN",
    status: "active",
    websiteUrl: "https://demo.loanos.invalid",
    privacyPolicyUrl: "https://demo.loanos.invalid/privacy",
    grievanceOfficer: {
      name: "Asha Nair",
      email: "grievance@demo.loanos.invalid",
      phone: "+91-9999999999"
    },
    dataResidency: {
      primaryStorageCountry: "IN",
      paymentDataStorageCountry: "IN",
      processedOutsideIndia: false
    },
    boardPolicyRefs: {
      digitalLendingPolicyRef: "DEMO-BOARD-DL-2026-V1",
      kycPolicyRef: "DEMO-BOARD-KYC-2026-V1",
      penalChargesPolicyRef: "DEMO-BOARD-PENAL-2026-V1",
      outsourcingPolicyRef: "DEMO-BOARD-OUTSOURCING-2026-V1",
      modelRiskPolicyRef: "DEMO-BOARD-MRM-2026-V1",
      grievancePolicyRef: "DEMO-BOARD-GRIEVANCE-2026-V1"
    },
    licenseMetadata: {
      category: "NBFC-ICC (synthetic demo)",
      licenseNumber: "DEMO-RBI-LICENCE-NOT-REAL",
      issuingAuthority: "Synthetic demo authority",
      issueDate: "2024-01-01",
      status: "active"
    }
  }, now);
}

function demoProductPolicy(productType, now) {
  const productId = productType === "personal_loan" ? "prod_1" : `prod_${productType}`;
  const revolving = productType === "msme_working_capital";
  const securedLoan = SECURED_PRODUCT_TYPES.has(productType);
  return normalizeProductPolicy({
    productId,
    regulatedEntityId: "re_1",
    productCode: `DEMO_${productType.toUpperCase()}`,
    productName: humanize(productType),
    productType,
    version: 1,
    effectiveFrom: "2026-01-01",
    status: "active",
    currency: "INR",
    securedLoan,
    minAmount: revolving ? 100000 : 10000,
    maxAmount: revolving ? 5000000 : securedLoan ? 10000000 : 1000000,
    minTenorMonths: 3,
    maxTenorMonths: securedLoan ? 240 : 60,
    annualInterestRateBps: securedLoan ? 1050 : 1600,
    aprBps: securedLoan ? 1200 : 1850,
    interestCalcMethod: "reducing_balance",
    facilityType: revolving ? "overdraft" : "term_loan",
    repaymentFrequency: "monthly",
    repaymentStructure: "amortizing",
    ...(revolving
      ? {
          creditLimit: 5000000,
          drawingPower: 4000000,
          minimumPaymentPercent: 5,
          reviewFrequencyMonths: 12,
          facilityExpiryDate: "2035-12-31"
        }
      : {}),
    coolingOffDays: 3,
    sanctionValidityDays: 30,
    recoveryMechanism: "RE-controlled NACH mandate with authorised-agency escalation",
    documentRequirements: [
      {
        type: "identity_evidence",
        label: "Identity evidence",
        required: true,
        acceptedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
        maxSizeBytes: 5242880
      },
      {
        type: `${productType}_evidence`,
        label: `${humanize(productType)} evidence`,
        required: true,
        acceptedMimeTypes: ["application/pdf"],
        maxSizeBytes: 10485760
      }
    ],
    charges: [],
    contingentCharges: [],
    penalCharges: [],
    eligibility: {
      minAgeYears: 21,
      maxAgeYears: 70,
      minMonthlyIncome: revolving ? 100000 : 25000,
      allowedResidencyCountry: "IN"
    },
    prepaymentPolicy: { allowed: true, chargeBps: 0, lockInMonths: 0 },
    foreclosurePolicy: { allowed: true, chargeBps: 0, lockInMonths: 0 },
    policyRefs: {
      boardApprovalRef: `DEMO-BOARD-${productType.toUpperCase()}-V1`,
      pricingPolicyRef: `DEMO-PRICING-${productType.toUpperCase()}-V1`,
      penalChargesPolicyRef: "DEMO-BOARD-PENAL-2026-V1"
    }
  }, now);
}

function buildProductAdminGrants(tenantId) {
  return Object.fromEntries(PRODUCT_JOURNEY_TYPES.flatMap((productType) =>
    DEMO_PRODUCT_ADMIN_ROLES.map((role) => {
      const grantId = `${tenantId}:${productType}:${role}`;
      return [grantId, {
        grantId,
        tenantId,
        principalId: PRINCIPAL_BY_PRODUCT_ROLE[role],
        role,
        productType,
        templateId: productType,
        templateVersion: 1,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2036-01-01T00:00:00.000Z",
        status: "active",
        proposedBy: "demo_platform_maker",
        approvedBy: "demo_platform_checker",
        approvalRef: "DEMO-PRODUCT-ADMIN-2026-V1",
        grantedAt: DEMO_REFERENCE_TIME
      }];
    })
  ));
}

function buildSubscription(tenantId) {
  const subscriptionId = `${tenantId}:showcase:all-products`;
  return {
    subscriptionId,
    tenantId,
    productTypes: [...PRODUCT_JOURNEY_TYPES],
    productEntitlements: PRODUCT_JOURNEY_TYPES.map((productType) => ({
      productType,
      source: "builtin",
      templateId: productType,
      templateVersion: 1
    })),
    licenceRef: "DEMO-SYNTHETIC-ALL-PRODUCTS-NOT-FOR-PRODUCTION",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2036-01-01T00:00:00.000Z",
    status: "active",
    proposedBy: "demo_platform_maker",
    approvedBy: "demo_platform_checker",
    approvalRef: "DEMO-SHOWCASE-SUBSCRIPTION-2026-V1",
    approvedAt: DEMO_REFERENCE_TIME
  };
}

export function buildShowcaseDemoProfile({ tenantId = "dev", referenceTime = DEMO_REFERENCE_TIME } = {}) {
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(tenantId)) {
    fail("demo_tenant_id_invalid", "Demo tenantId must be a safe lower-case identifier.");
  }
  const now = new Date(referenceTime);
  if (Number.isNaN(now.getTime())) fail("demo_reference_time_invalid", "A valid referenceTime is required.");
  const regulatedEntity = demoRegulatedEntity(tenantId, now);
  const productPolicies = Object.fromEntries(
    PRODUCT_JOURNEY_TYPES.map((productType) => {
      const policy = demoProductPolicy(productType, now);
      return [policy.productId, policy];
    })
  );
  const subscription = buildSubscription(tenantId);
  const body = {
    profileId: DEMO_SHOWCASE_PROFILE_ID,
    tenantId,
    syntheticOnly: true,
    isSandbox: true,
    generatedAt: now.toISOString(),
    regulatedEntity,
    productPolicies,
    tenantProductSubscriptions: { [subscription.subscriptionId]: subscription },
    productAdminGrants: buildProductAdminGrants(tenantId),
    personas: [...DEMO_PERSONAS],
    integrationPosture: Object.fromEntries(DEMO_INTEGRATION_KEYS.map((key) => [key, "mock"])),
    engineBoundaries: {
      businessDecisionEngine: "dedicated_per_tenant",
      showcaseBusinessEngineProvisioned: true,
      controlDecisionEngine: "not_provisioned_in_synthetic_demo",
      productionReady: false
    }
  };
  const profile = { ...body, checksumSha256: stableHash(body) };
  validateDemoProfile(profile);
  return profile;
}

export function validateDemoProfile(profile) {
  if (!profile || profile.syntheticOnly !== true || profile.isSandbox !== true) {
    fail("demo_profile_not_synthetic", "Demo profiles must be synthetic sandbox tenants.");
  }
  if (profile.engineBoundaries?.businessDecisionEngine !== "dedicated_per_tenant") {
    fail("demo_engine_isolation_required", "Each demo tenant requires its own business decision engine.");
  }
  if (profile.engineBoundaries?.productionReady !== false) {
    fail("demo_profile_production_claim_forbidden", "Synthetic demo profiles cannot claim production readiness.");
  }
  const integrationEntries = Object.entries(profile.integrationPosture ?? {});
  if (
    integrationEntries.length !== DEMO_INTEGRATION_KEYS.length ||
    integrationEntries.some(([key, mode]) => !DEMO_INTEGRATION_KEYS.includes(key) || mode !== "mock")
  ) {
    fail("demo_integration_mode_invalid", "Every demo integration must be explicitly configured for mock mode.");
  }
  const sandboxReadiness = new ExternalServiceManager({ isSandbox: true }).integrationReadiness();
  if (sandboxReadiness.some((integration) => integration.mode !== "mock" || integration.status !== "mock")) {
    fail("demo_mock_enforcement_failed", "Sandbox provider enforcement did not resolve every integration to mock mode.");
  }
  const regulatedEntityValidation = validateRegulatedEntity(profile.regulatedEntity, new Date(profile.generatedAt));
  if (regulatedEntityValidation.findings.some((finding) => finding.severity === "error")) {
    fail("demo_regulated_entity_invalid", "The showcase regulated entity is not registry-valid.");
  }
  const products = Object.values(profile.productPolicies ?? {});
  const productTypes = products.map((product) => product.productType).sort();
  const canonicalTypes = [...PRODUCT_JOURNEY_TYPES].sort();
  if (JSON.stringify(productTypes) !== JSON.stringify(canonicalTypes)) {
    fail("demo_product_catalogue_incomplete", "The showcase profile must cover exactly all 21 canonical product journeys.");
  }
  const entityRegistry = { [profile.regulatedEntity.regulatedEntityId]: profile.regulatedEntity };
  for (const product of products) {
    const validation = validateProductPolicy(product, entityRegistry);
    if (validation.findings.some((finding) => finding.severity === "error")) {
      fail("demo_product_policy_invalid", `The ${product.productType} showcase policy is invalid.`);
    }
  }
  const subscriptions = Object.values(profile.tenantProductSubscriptions ?? {});
  if (subscriptions.length !== 1 || subscriptions[0].productTypes.length !== PRODUCT_JOURNEY_TYPES.length) {
    fail("demo_subscription_incomplete", "The showcase subscription must cover all canonical product journeys.");
  }
  if (Object.keys(profile.productAdminGrants ?? {}).length !== PRODUCT_JOURNEY_TYPES.length * DEMO_PRODUCT_ADMIN_ROLES.length) {
    fail("demo_product_administration_incomplete", "Every showcase product requires all five administration roles.");
  }
  const { checksumSha256, ...body } = profile;
  if (checksumSha256 !== stableHash(body)) {
    fail("demo_profile_checksum_invalid", "Demo profile checksum verification failed.");
  }
  return {
    valid: true,
    productCount: products.length,
    personaCount: profile.personas?.length ?? 0,
    productAdminGrantCount: Object.keys(profile.productAdminGrants).length,
    integrationCount: integrationEntries.length,
    checksumSha256
  };
}

export function applyShowcaseDemoProfile(tenantData, profile) {
  validateDemoProfile(profile);
  return {
    ...tenantData,
    regulatedEntities: {
      ...(tenantData.regulatedEntities ?? {}),
      [profile.regulatedEntity.regulatedEntityId]: profile.regulatedEntity
    },
    productPolicies: {
      ...(tenantData.productPolicies ?? {}),
      ...profile.productPolicies
    },
    tenantProductSubscriptions: {
      ...(tenantData.tenantProductSubscriptions ?? {}),
      ...profile.tenantProductSubscriptions
    },
    productAdminGrants: {
      ...(tenantData.productAdminGrants ?? {}),
      ...profile.productAdminGrants
    }
  };
}

export function buildWorkshopTenantManifest({
  sessionId,
  name = "Customer Workshop Tenant",
  referenceTime = DEMO_REFERENCE_TIME
} = {}) {
  const safeSessionId = String(sessionId ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  if (!safeSessionId) fail("demo_workshop_session_invalid", "A workshop sessionId is required.");
  const tenantId = `workshop-${safeSessionId}`;
  const now = new Date(referenceTime);
  const regulatedEntity = demoRegulatedEntity(tenantId, now);
  const product = demoProductPolicy("personal_loan", now);
  product.productId = `${tenantId}-personal-loan`;
  product.productCode = `WORKSHOP_${safeSessionId.replaceAll("-", "_").toUpperCase()}_PL`;
  product.accountingProfile.profileId = `${product.productCode}_v1`;
  const regulatedEntityValidation = validateRegulatedEntity(regulatedEntity, now);
  const productValidation = validateProductPolicy(product, { [regulatedEntity.regulatedEntityId]: regulatedEntity });
  if (
    regulatedEntityValidation.findings.some((finding) => finding.severity === "error") ||
    productValidation.findings.some((finding) => finding.severity === "error")
  ) {
    fail("demo_workshop_manifest_invalid", "Generated workshop registry data failed validation.");
  }
  const tenantRequest = {
    tenantId,
    name,
    status: "active",
    isolationTier: "pooled",
    isSandbox: true,
    syntheticOnly: true,
    demoProfile: DEMO_WORKSHOP_PROFILE_ID,
    onboarding: {
      status: "configured",
      launchMode: "workshop",
      primaryRegulatedEntityId: regulatedEntity.regulatedEntityId,
      productIds: [product.productId],
      notes: "Synthetic customer workshop tenant; external integrations are mock-only."
    },
    regulatedEntity,
    products: [product]
  };
  const body = {
    profileId: DEMO_WORKSHOP_PROFILE_ID,
    tenantId,
    syntheticOnly: true,
    generatedAt: now.toISOString(),
    tenantRequest,
    operatorInputs: ["ownerUser", "dedicatedBusinessEngine"],
    integrationPosture: Object.fromEntries(DEMO_INTEGRATION_KEYS.map((key) => [key, "mock"])),
    engineProvisioning: {
      status: "required_before_decisioning",
      businessDecisionEngine: "dedicated_per_tenant",
      controlDecisionEngine: "not_provisioned_in_synthetic_demo",
      mayReuseShowcaseEngine: false,
      productionReady: false
    }
  };
  return { ...body, checksumSha256: stableHash(body) };
}
