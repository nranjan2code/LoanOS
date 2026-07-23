/**
 * SaaS-platform identity, role and feature-staffing governance: the canonical
 * catalogue of control-plane and tenant roles (`CANONICAL_ROLE_CATALOGUE`),
 * segregation-of-duties rules, and the feature-staffing policies
 * (`FEATURE_STAFFING_POLICIES`) that gate a tenant feature "on" only when it
 * has the roles, independence and minimum head-count the policy demands. This
 * module owns bootstrap ownership hand-off, maker-checker role grant/revoke,
 * ownership transfer, break-glass emergency access, and the safety response
 * that automatically opens a staffing escalation (and can force an
 * administrative-lockout escalation) whenever a role revocation or principal
 * suspension would leave a previously-ready feature under-staffed. It does
 * NOT own workflow/task routing, product-journey business logic, or the
 * Rust decision engine's own guardrail evaluation — this is the identity and
 * staffing substrate those layers are authorized against. See
 * `docs/architecture/tenant-role-staffing-and-feature-gating.md` for the
 * canonical roles/staffing/IdP/agents/revocation contract this file
 * implements, and AGENTS.md's "AI is gated" / "agent actions go through
 * guardrail.*" rule for why agent principals (`fixed_agent`/`dynamic_agent`)
 * are deliberately restricted to a narrow, non-human-control role set here
 * (`AGENT_ASSIGNABLE_ROLE_IDS`) and always denied when a human-only action
 * requires a human principal (`authorizeStaffedFeatureAction`).
 */
const MAX_BOOTSTRAP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EMERGENCY_MS = 4 * 60 * 60 * 1000;
const MAX_DYNAMIC_AGENT_MS = 24 * 60 * 60 * 1000;
const HUMAN_PRINCIPAL_TYPE = "human";
const AGENT_PRINCIPAL_TYPES = new Set(["fixed_agent", "dynamic_agent"]);

const ROLE_ROWS = [
  // LoanOS control-plane roles are deliberately distinct from tenant roles.
  ["platform_admin", "Platform administrator", "platform", ["platform"], "privileged", ["platform.manage"]],
  ["tenant_provisioner", "Tenant provisioner", "platform", ["platform"], "privileged", ["tenant.provision"]],
  ["platform_security_admin", "Platform security administrator", "platform", ["platform"], "privileged", ["platform.security.manage"]],
  ["platform_auditor", "Platform auditor", "platform", ["platform"], "control", ["platform.audit.read"]],
  ["support_engineer", "Support engineer", "platform", ["platform"], "privileged", ["support.diagnose"]],
  ["release_operator", "Release operator", "platform", ["platform"], "privileged", ["release.execute"]],
  ["release_approver", "Release approver", "platform", ["platform"], "control", ["release.approve"]],

  // Bootstrap roles are issued only by the trusted provisioning boundary.
  ["bootstrap_owner", "Bootstrap organisation owner", "bootstrap", ["tenant"], "temporary", ["organisation.update", "subscription.select", "deployment.configure", "product.select", "user.invite", "role.propose", "identity_provider.configure", "onboarding.view", "provisioning.start"]],
  ["bootstrap_checker", "Bootstrap independent checker", "bootstrap", ["tenant"], "temporary", ["role.approve", "bootstrap.review", "onboarding.view"]],

  // Tenant administration and accountable ownership.
  ["tenant_owner", "Organisation owner", "tenant_administration", ["tenant"], "accountable", ["organisation.read", "ownership.transfer.propose"]],
  ["tenant_admin", "Tenant administrator", "tenant_administration", ["tenant"], "privileged", ["tenant.manage", "user.invite", "role.propose", "role.approve"]],
  ["user_admin", "User administrator", "tenant_administration", ["tenant"], "privileged", ["user.manage", "user.invite", "role.propose", "role.approve"]],
  ["security_admin", "Security administrator", "tenant_administration", ["tenant"], "privileged", ["security.manage", "emergency.approve"]],
  ["access_reviewer", "Access reviewer", "tenant_administration", ["tenant"], "control", ["access.review", "role.approve"]],
  ["auditor", "Tenant auditor", "tenant_administration", ["tenant"], "control", ["audit.read"]],
  ["operator", "Tenant operator", "tenant_administration", ["tenant"], "standard", ["operations.workspace"]],
  ["integration_admin", "Integration administrator", "tenant_administration", ["tenant"], "privileged", ["integration.manage"]],
  ["workflow_admin", "Workflow administrator", "tenant_administration", ["tenant"], "privileged", ["workflow.manage"]],

  // Product governance. Product templates may require these at tenant or product scope.
  ["product_manager", "Product manager", "product", ["tenant", "product"], "privileged", ["product.configure", "product.change.propose"]],
  ["product_approver", "Product approver", "product", ["tenant", "product"], "control", ["product.change.approve"]],
  ["journey_admin", "Product journey administrator", "product", ["product"], "privileged", ["journey.configure"]],
  ["product_owner", "Product owner", "product", ["product"], "accountable", ["product.read", "product.change.propose"]],
  ["product_checker", "Product checker", "product", ["product"], "control", ["product.change.approve"]],

  // Lending, operations, finance, compliance and control-function roles.
  ["loan_officer", "Loan officer", "operations", ["tenant", "product"], "standard", ["application.operate"]],
  ["credit_maker", "Credit maker", "credit", ["tenant", "product"], "standard", ["credit.propose"]],
  ["credit_officer", "Credit officer", "credit", ["tenant", "product"], "standard", ["credit.propose"]],
  ["credit_checker", "Credit checker", "credit", ["tenant", "product"], "control", ["credit.approve"]],
  ["operations_maker", "Operations maker", "operations", ["tenant", "product"], "standard", ["operations.propose"]],
  ["operations_checker", "Operations checker", "operations", ["tenant", "product"], "control", ["operations.approve"]],
  ["kyc_officer", "KYC officer", "compliance", ["tenant", "product"], "standard", ["kyc.operate"]],
  ["kyc_checker", "KYC checker", "compliance", ["tenant", "product"], "control", ["kyc.approve"]],
  ["human_reviewer", "Human decision reviewer", "credit", ["tenant", "product"], "control", ["decision.human_review"]],
  ["disbursement_maker", "Disbursement maker", "operations", ["tenant", "product"], "privileged", ["disbursement.propose"]],
  ["disbursement_checker", "Disbursement checker", "operations", ["tenant", "product"], "control", ["disbursement.approve"]],
  ["collections_manager", "Collections manager", "servicing", ["tenant", "product"], "privileged", ["collections.manage"]],
  ["grievance_officer", "Grievance officer", "compliance", ["tenant"], "control", ["grievance.manage"]],
  ["portfolio_risk_manager", "Portfolio risk manager", "risk", ["tenant", "product"], "control", ["portfolio_risk.manage"]],
  ["compliance_officer", "Compliance officer", "compliance", ["tenant"], "control", ["compliance.approve"]],
  ["compliance_analyst", "Compliance analyst", "compliance", ["tenant"], "standard", ["compliance.operate"]],
  ["principal_officer", "Principal Officer", "compliance", ["tenant"], "control", ["fiu.approve"]],
  ["reporting_officer", "Regulatory reporting officer", "compliance", ["tenant"], "control", ["reporting.submit"]],
  ["security_officer", "Security interest officer", "operations", ["tenant", "product"], "standard", ["security_interest.operate"]],
  ["data_protection_officer", "Data protection officer", "compliance", ["tenant"], "control", ["privacy.approve"]],
  ["finance_admin", "Finance administrator", "finance", ["tenant"], "privileged", ["finance.configure"]],
  ["finance_maker", "Finance maker", "finance", ["tenant", "product"], "standard", ["finance.propose"]],
  ["finance_checker", "Finance checker", "finance", ["tenant", "product"], "control", ["finance.approve"]],
  ["model_risk_manager", "Model risk manager", "risk", ["tenant"], "control", ["model.approve"]],

  // Named statutory/accountable, assurance and specialist operating roles.
  ["designated_director", "PMLA designated director", "compliance", ["tenant"], "accountable", ["aml.oversight"]],
  ["chief_information_security_officer", "Chief Information Security Officer", "security", ["tenant"], "accountable", ["security.oversight", "incident.approve"]],
  ["head_of_it", "Head of IT", "technology", ["tenant"], "accountable", ["technology.operate", "recovery.propose"]],
  ["internal_auditor", "Internal auditor", "assurance", ["tenant"], "control", ["audit.execute"]],
  ["risk_manager", "Enterprise risk manager", "risk", ["tenant"], "control", ["risk.approve"]],
  ["fraud_investigator", "Fraud investigator", "risk", ["tenant", "product"], "standard", ["fraud.investigate"]],
  ["fraud_classifier", "Fraud classification approver", "risk", ["tenant", "product"], "control", ["fraud.classify"]],
  ["servicing_maker", "Servicing maker", "servicing", ["tenant", "product"], "standard", ["servicing.propose"]],
  ["servicing_checker", "Servicing checker", "servicing", ["tenant", "product"], "control", ["servicing.approve"]],
  ["collections_maker", "Collections maker", "servicing", ["tenant", "product"], "standard", ["collections.propose"]],
  ["collections_checker", "Collections checker", "servicing", ["tenant", "product"], "control", ["collections.approve"]],
  ["legal_maker", "Legal recovery maker", "legal", ["tenant", "product"], "standard", ["legal.propose"]],
  ["legal_checker", "Legal recovery checker", "legal", ["tenant", "product"], "control", ["legal.approve"]],
  ["collateral_maker", "Collateral and security maker", "operations", ["tenant", "product"], "standard", ["collateral.propose"]],
  ["collateral_checker", "Collateral and security checker", "operations", ["tenant", "product"], "control", ["collateral.approve"]],
  ["treasury_maker", "Treasury maker", "finance", ["tenant"], "standard", ["treasury.propose"]],
  ["treasury_checker", "Treasury checker", "finance", ["tenant"], "control", ["treasury.approve"]],
  ["reconciliation_maker", "Reconciliation maker", "finance", ["tenant", "product"], "standard", ["reconciliation.propose"]],
  ["reconciliation_checker", "Reconciliation checker", "finance", ["tenant", "product"], "control", ["reconciliation.approve"]],
  ["tax_maker", "Tax maker", "finance", ["tenant"], "standard", ["tax.propose"]],
  ["tax_checker", "Tax checker", "finance", ["tenant"], "control", ["tax.approve"]],
  ["regulatory_reporting_maker", "Regulatory reporting maker", "compliance", ["tenant"], "standard", ["reporting.prepare"]],
  ["regulatory_reporting_checker", "Regulatory reporting checker", "compliance", ["tenant"], "control", ["reporting.approve"]],
  ["model_owner", "Model owner", "risk", ["tenant"], "accountable", ["model.propose"]],
  ["model_validator", "Independent model validator", "risk", ["tenant"], "control", ["model.validate"]],
  ["vendor_manager", "Vendor manager", "vendor", ["tenant"], "standard", ["vendor.propose"]],
  ["vendor_risk_approver", "Vendor risk approver", "vendor", ["tenant"], "control", ["vendor.approve"]],
  ["change_manager", "Technology change manager", "technology", ["tenant"], "standard", ["change.propose"]],
  ["change_approver", "Technology change approver", "technology", ["tenant"], "control", ["change.approve"]],
  ["business_continuity_manager", "Business continuity manager", "technology", ["tenant"], "standard", ["recovery.propose"]],
  ["business_continuity_approver", "Business continuity approver", "technology", ["tenant"], "control", ["recovery.approve"]],
  ["data_migration_maker", "Data migration maker", "technology", ["tenant"], "standard", ["migration.propose"]],
  ["data_migration_checker", "Data migration checker", "technology", ["tenant"], "control", ["migration.approve"]],
  ["grievance_checker", "Grievance independent checker", "compliance", ["tenant"], "control", ["grievance.approve"]],
  ["privacy_analyst", "Privacy operations analyst", "compliance", ["tenant"], "standard", ["privacy.operate"]],

  // Non-human principals have deliberately narrow execution/suggestion roles.
  ["automation_agent", "Deterministic automation agent", "automation", ["tenant", "product"], "automation", ["automation.execute"]],
  ["ai_agent", "AI agent", "automation", ["tenant", "product"], "automation", ["ai.suggest", "ai.request_human"]],
  ["ai_agent_worker", "AI agent execution worker", "automation", ["tenant"], "automation", ["ai.execute", "runtime.job"]],
  ["integration_worker", "Integration workload", "automation", ["tenant"], "automation", ["integration.execute"]]
];

export const CANONICAL_ROLE_CATALOGUE = Object.freeze(Object.fromEntries(ROLE_ROWS.map(([roleId, displayName, domain, scopes, privilege, allowedActions]) => [roleId, Object.freeze({ roleId, displayName, domain, scopes: Object.freeze(scopes), privilege, allowedActions: Object.freeze(allowedActions), assignable: domain !== "bootstrap" && domain !== "platform", temporaryOnly: domain === "bootstrap" })])));
export const CANONICAL_ROLE_IDS = Object.freeze(Object.keys(CANONICAL_ROLE_CATALOGUE));

export const PRODUCT_TEMPLATE_REQUIRED_ROLE_IDS = Object.freeze(["tenant_admin", "product_manager", "credit_maker", "credit_checker", "operations_maker", "operations_checker", "compliance_officer"]);
export const BOOTSTRAP_OWNER_ACTIONS = CANONICAL_ROLE_CATALOGUE.bootstrap_owner.allowedActions;
export const EMERGENCY_ALLOWED_ACTIONS = Object.freeze(["user.unlock", "integration.disable", "session.revoke", "security.contain", "service.fail_closed", "audit.read"]);

export const SEGREGATION_OF_DUTIES_RULES = Object.freeze([
  pair("platform_admin", "platform_auditor", "platform_administration_audit"),
  pair("release_operator", "release_approver", "release_four_eyes"),
  pair("user_admin", "access_reviewer", "identity_administration_review"),
  pair("security_admin", "auditor", "security_administration_audit"),
  pair("product_manager", "product_approver", "product_change_four_eyes"),
  pair("product_owner", "product_checker", "product_ownership_check"),
  pair("credit_maker", "credit_checker", "credit_four_eyes"),
  pair("credit_officer", "credit_checker", "credit_four_eyes"),
  pair("operations_maker", "operations_checker", "operations_four_eyes"),
  pair("kyc_officer", "kyc_checker", "kyc_four_eyes"),
  pair("disbursement_maker", "disbursement_checker", "disbursement_four_eyes"),
  pair("finance_maker", "finance_checker", "finance_four_eyes"),
  pair("principal_officer", "designated_director", "pmla_accountability_separation"),
  pair("chief_information_security_officer", "head_of_it", "ciso_it_reporting_independence"),
  pair("fraud_investigator", "fraud_classifier", "fraud_classification_independence"),
  pair("servicing_maker", "servicing_checker", "servicing_four_eyes"),
  pair("collections_maker", "collections_checker", "collections_four_eyes"),
  pair("legal_maker", "legal_checker", "legal_four_eyes"),
  pair("collateral_maker", "collateral_checker", "collateral_four_eyes"),
  pair("treasury_maker", "treasury_checker", "treasury_four_eyes"),
  pair("reconciliation_maker", "reconciliation_checker", "reconciliation_four_eyes"),
  pair("tax_maker", "tax_checker", "tax_four_eyes"),
  pair("regulatory_reporting_maker", "regulatory_reporting_checker", "regulatory_reporting_four_eyes"),
  pair("model_owner", "model_validator", "model_validation_independence"),
  pair("vendor_manager", "vendor_risk_approver", "vendor_risk_four_eyes"),
  pair("change_manager", "change_approver", "change_four_eyes"),
  pair("business_continuity_manager", "business_continuity_approver", "recovery_four_eyes"),
  pair("data_migration_maker", "data_migration_checker", "migration_four_eyes"),
  pair("grievance_officer", "grievance_checker", "grievance_four_eyes"),
  pair("privacy_analyst", "data_protection_officer", "privacy_four_eyes"),
  pair("internal_auditor", "security_admin", "audit_security_administration_independence"),
  pair("internal_auditor", "finance_admin", "audit_finance_administration_independence"),
  pair("internal_auditor", "integration_admin", "audit_integration_administration_independence"),
  pair("internal_auditor", "workflow_admin", "audit_workflow_administration_independence")
]);

export const MINIMUM_LAUNCH_ROLE_COVERAGE = Object.freeze([
  ...PRODUCT_TEMPLATE_REQUIRED_ROLE_IDS,
  "user_admin", "access_reviewer", "security_admin", "auditor"
]);

export const FEATURE_STAFFING_POLICIES = Object.freeze(Object.fromEntries([
  staffingPolicy("FST-001", "Identity and access administration", "platform", [["tenant_admin", "user_admin"], ["access_reviewer", "security_admin"]], [["user_admin", "access_reviewer"]], 2, ["RBI-IT-19", "RBI-IT-23"]),
  staffingPolicy("FST-002", "Product configuration, approval and publication", "LOS", [["product_manager", "product_owner"], ["product_approver", "product_checker"]], [["product_manager", "product_approver"], ["product_owner", "product_checker"]], 2, ["RBI-IT-12", "RBI-IT-13"]),
  staffingPolicy("FST-003", "Credit underwriting and sanction", "LOS", [["loan_officer"], ["credit_maker", "credit_officer"], ["credit_checker"]], [["credit_maker", "credit_checker"], ["credit_officer", "credit_checker"]], 3, ["RBI-IT-23", "RE-CREDIT-POLICY"]),
  staffingPolicy("FST-004", "Borrower KYC and AML onboarding", "LOS", [["kyc_officer"], ["kyc_checker"], ["principal_officer"], ["designated_director"]], [["kyc_officer", "kyc_checker"], ["principal_officer", "designated_director"]], 4, ["RBI-KYC-6", "RBI-KYC-7", "RBI-KYC-8"]),
  staffingPolicy("FST-005", "Manual decision override and human review", "LOS", [["credit_maker", "credit_officer"], ["credit_checker"], ["human_reviewer"]], [["credit_maker", "credit_checker"], ["credit_officer", "credit_checker"]], 3, ["RBI-IT-23", "MODEL-HUMAN-OVERSIGHT"]),
  staffingPolicy("FST-006", "Contract completion and disbursement", "LOS", [["disbursement_maker"], ["disbursement_checker"], ["operations_checker"]], [["disbursement_maker", "disbursement_checker"]], 3, ["RBI-DL-2025", "RBI-IT-23"]),
  staffingPolicy("FST-007", "Loan servicing adjustments and closure", "LMS", [["servicing_maker"], ["servicing_checker"]], [["servicing_maker", "servicing_checker"]], 2, ["RBI-IT-23", "RE-SERVICING-POLICY"]),
  staffingPolicy("FST-008", "Payment reconciliation, suspense and refunds", "LMS", [["reconciliation_maker"], ["reconciliation_checker"]], [["reconciliation_maker", "reconciliation_checker"]], 2, ["RBI-IT-23", "RBI-IT-15"]),
  staffingPolicy("FST-009", "Finance posting, EOD and period close", "finance", [["finance_maker"], ["finance_checker"], ["finance_admin"]], [["finance_maker", "finance_checker"]], 3, ["RBI-IT-23", "RE-FINANCE-CONTROLS"]),
  staffingPolicy("FST-010", "GST, TDS and tax filing", "finance", [["tax_maker"], ["tax_checker"]], [["tax_maker", "tax_checker"]], 2, ["GST-INCOME-TAX", "RBI-IT-23"]),
  staffingPolicy("FST-011", "Treasury, funding and settlement", "finance", [["treasury_maker"], ["treasury_checker"]], [["treasury_maker", "treasury_checker"]], 2, ["RE-TREASURY-POLICY", "RBI-IT-23"]),
  staffingPolicy("FST-012", "Collections strategy and agency operations", "collections", [["collections_manager"], ["collections_maker"], ["collections_checker"]], [["collections_maker", "collections_checker"]], 3, ["RBI-FAIR-PRACTICES", "RBI-DL-2025"]),
  staffingPolicy("FST-013", "Cash or field collection posting", "collections", [["collections_maker"], ["collections_checker"], ["reconciliation_checker"]], [["collections_maker", "collections_checker"]], 3, ["RBI-FAIR-PRACTICES", "RE-CASH-EXCEPTION"]),
  staffingPolicy("FST-014", "Customer grievance and Ombudsman response", "LWS", [["grievance_officer"], ["grievance_checker"]], [["grievance_officer", "grievance_checker"]], 2, ["RBI-DL-2025", "RB-IOS"]),
  staffingPolicy("FST-015", "Legal recovery, possession and auction", "collections", [["legal_maker"], ["legal_checker"], ["compliance_officer"]], [["legal_maker", "legal_checker"]], 3, ["SARFAESI", "RBI-FAIR-PRACTICES"]),
  staffingPolicy("FST-016", "Collateral valuation and security perfection", "collateral", [["collateral_maker", "security_officer"], ["collateral_checker"]], [["collateral_maker", "collateral_checker"], ["security_officer", "collateral_checker"]], 2, ["CERSAI", "RE-COLLATERAL-POLICY"]),
  staffingPolicy("FST-017", "Regulatory return preparation and submission", "compliance", [["regulatory_reporting_maker"], ["regulatory_reporting_checker"], ["reporting_officer"]], [["regulatory_reporting_maker", "regulatory_reporting_checker"]], 3, ["RBI-FILING-DIRECTIONS", "RBI-IT-15"]),
  staffingPolicy("FST-018", "AML transaction monitoring and FIU reporting", "compliance", [["compliance_analyst"], ["principal_officer"], ["designated_director"]], [["principal_officer", "designated_director"]], 3, ["RBI-KYC-6", "RBI-KYC-7", "PMLA"]),
  staffingPolicy("FST-019", "CIC furnishing and correction", "compliance", [["regulatory_reporting_maker"], ["regulatory_reporting_checker"], ["reporting_officer"]], [["regulatory_reporting_maker", "regulatory_reporting_checker"]], 3, ["CICRA", "RBI-CREDIT-REPORTING"]),
  staffingPolicy("FST-020", "Model governance and validation", "risk", [["model_owner"], ["model_validator"], ["model_risk_manager", "risk_manager"]], [["model_owner", "model_validator"]], 3, ["RBI-IT-23", "MODEL-RISK-POLICY"]),
  staffingPolicy("FST-021", "Privacy rights, disclosure and erasure", "compliance", [["privacy_analyst"], ["data_protection_officer"]], [["privacy_analyst", "data_protection_officer"]], 2, ["DPDP-ACT", "RBI-DL-2025"]),
  staffingPolicy("FST-022", "Provider integration activation", "platform", [["integration_admin"], ["vendor_manager"], ["vendor_risk_approver"]], [["vendor_manager", "vendor_risk_approver"]], 3, ["RBI-IT-10", "RBI-OUTSOURCING-IT"]),
  staffingPolicy("FST-023", "Vendor outsourcing approval and renewal", "platform", [["vendor_manager"], ["vendor_risk_approver"], ["compliance_officer"]], [["vendor_manager", "vendor_risk_approver"]], 3, ["RBI-OUTSOURCING-IT", "RBI-IT-10"]),
  staffingPolicy("FST-024", "Security administration and independent assurance", "platform", [["security_admin"], ["chief_information_security_officer"], ["internal_auditor", "auditor"]], [["chief_information_security_officer", "head_of_it"]], 3, ["RBI-IT-24", "RBI-IT-30"]),
  staffingPolicy("FST-025", "Cyber incident response and regulatory notification", "platform", [["chief_information_security_officer"], ["security_admin"], ["head_of_it"]], [["chief_information_security_officer", "head_of_it"]], 3, ["RBI-IT-27", "CERT-IN"]),
  staffingPolicy("FST-026", "Technology change and production release", "platform", [["change_manager"], ["change_approver"]], [["change_manager", "change_approver"]], 2, ["RBI-IT-13"]),
  staffingPolicy("FST-027", "Business continuity, DR failover and failback", "platform", [["business_continuity_manager"], ["business_continuity_approver"], ["head_of_it"]], [["business_continuity_manager", "business_continuity_approver"]], 3, ["RBI-IT-28", "RBI-IT-29"]),
  staffingPolicy("FST-028", "Data migration, cutover and rollback", "implementation", [["data_migration_maker"], ["data_migration_checker"], ["finance_checker"]], [["data_migration_maker", "data_migration_checker"]], 3, ["RBI-IT-14"]),
  staffingPolicy("FST-029", "Internal audit and control assurance", "compliance", [["internal_auditor"], ["auditor"], ["compliance_officer"]], [], 3, ["RBI-IT-30", "RBI-KYC-8"]),
  staffingPolicy("FST-030", "Product subscription add-on or removal", "platform", [["tenant_admin"], ["product_manager", "product_owner"], ["product_checker", "product_approver"]], [["product_manager", "product_approver"], ["product_owner", "product_checker"]], 3, ["RE-DELEGATION-POLICY", "RBI-IT-23"]),
  staffingPolicy("FST-031", "Tenant provisioning, handover and activation", "platform", [["tenant_admin"], ["security_admin"], ["auditor"]], [["security_admin", "auditor"]], 3, ["RBI-IT-12", "RBI-IT-23"]),
  staffingPolicy("FST-032", "Co-lending allocation and settlement", "finance", [["finance_maker"], ["finance_checker"], ["compliance_officer"]], [["finance_maker", "finance_checker"]], 3, ["RBI-CO-LENDING", "RBI-IT-23"]),
  staffingPolicy("FST-033", "Fraud investigation and classification", "risk", [["fraud_investigator"], ["fraud_classifier"], ["compliance_officer"]], [["fraud_investigator", "fraud_classifier"]], 3, ["RBI-FRAUD-RISK-MANAGEMENT"]),
  staffingPolicy("FST-034", "AI model or agent production action", "risk", [["model_owner"], ["model_validator"], ["human_reviewer"], ["model_risk_manager"]], [["model_owner", "model_validator"]], 4, ["RBI-IT-23", "MODEL-HUMAN-OVERSIGHT"])
].map((item) => [item.featureId, item])));

export const FEATURE_STAFFING_POLICY_IDS = Object.freeze(Object.keys(FEATURE_STAFFING_POLICIES));
export const AGENT_ASSIGNABLE_ROLE_IDS = Object.freeze(["automation_agent", "ai_agent", "ai_agent_worker", "integration_worker"]);

/** Looks up a role in the canonical catalogue; fails closed on any unknown roleId rather than treating it as no-access. */
export function getCanonicalRole(roleId) {
  return CANONICAL_ROLE_CATALOGUE[required(roleId, "roleId")] ?? fail("saas_role_unknown", `Unknown canonical role: ${roleId}.`);
}

/** Validates a set of proposed role ids against the canonical catalogue, de-duplicating and rejecting anything unknown. */
export function validateCanonicalRoles(roleIds) {
  if (!Array.isArray(roleIds) || !roleIds.length) fail("saas_roles_required", "At least one canonical role is required.");
  const unique = [...new Set(roleIds.map((roleId) => required(roleId, "roleId")))];
  for (const roleId of unique) getCanonicalRole(roleId);
  return unique;
}

/**
 * Records which of a tenant's gated features (per `FEATURE_STAFFING_POLICIES`)
 * are requested enabled/disabled, at which scope. This is a maker-checker
 * configuration step only — it does not itself grant staffing readiness;
 * `assessFeatureStaffingReadiness`/`projectTenantFeatureStaffing` compute
 * whether the configured features are actually operable.
 * @returns {{state: object, configuration: object, readiness: object}}
 */
export function configureTenantFeatureStaffing(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const proposedBy = sameTenantPrincipal(state, tenantId, input.proposedBy, { active: true, human: true, now }).principalId;
  const approvedBy = sameTenantPrincipal(state, tenantId, input.approvedBy, { active: true, human: true, now }).principalId;
  if (proposedBy === approvedBy) fail("saas_feature_staffing_four_eyes", "Independent feature-staffing approval is required.");
  requireAction(state, tenantId, proposedBy, "role.propose", now);
  requireAction(state, tenantId, approvedBy, "role.approve", now);
  if (!Array.isArray(input.features)) fail("saas_feature_staffing_invalid", "features must be an array.");
  const seen = new Set();
  const features = input.features.map((item) => {
    const featureId = required(item?.featureId, "featureId");
    if (!FEATURE_STAFFING_POLICIES[featureId]) fail("saas_feature_staffing_policy_unknown", `Unknown feature staffing policy: ${featureId}.`);
    const scope = normalizeScope(item.scope, tenantId);
    if (!FEATURE_STAFFING_POLICIES[featureId].scopes.includes(scope.type)) fail("saas_feature_staffing_scope_invalid", `${featureId} cannot be enabled at ${scope.type} scope.`);
    if (scope.type === "tenant" && scope.id !== tenantId) fail("saas_feature_staffing_tenant_mismatch", "Feature scope belongs to another tenant.");
    const key = featureConfigKey(featureId, scope);
    if (seen.has(key)) fail("saas_feature_staffing_duplicate", `Duplicate feature staffing configuration: ${key}.`);
    seen.add(key);
    return { featureId, scope, requestedStatus: item.requestedStatus === "disabled" ? "disabled" : "enabled" };
  });
  const configuration = {
    tenantId,
    version: (records(state, "tenantFeatureStaffingConfigs")[tenantId]?.version ?? 0) + 1,
    features,
    proposedBy,
    approvedBy,
    approvalRef: required(input.approvalRef, "approvalRef"),
    reason: required(input.reason, "reason"),
    approvedAt: now.toISOString()
  };
  const next = put(state, "tenantFeatureStaffingConfigs", tenantId, configuration);
  return { state: next, configuration, readiness: projectTenantFeatureStaffing(next, tenantId, now) };
}

/**
 * The single source of truth for whether one feature, at one scope, is
 * actually staffed well enough to operate: every required-role-set has at
 * least one active, verified human covering it, every independent-pair is
 * covered by two distinct principals (not the same person wearing both
 * hats), no segregation-of-duties rule is violated, the configured minimum
 * distinct-principal count is met, there's no open operational-pause
 * escalation, and the feature was actually configured "enabled". Any one
 * failure adds to `blockers` and the feature is fail-closed to "disabled".
 * @returns {object} readiness projection including `ready`, `blockers`, `roleCoverage`.
 */
export function assessFeatureStaffingReadiness(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const featureId = required(input?.featureId, "featureId");
  const policy = FEATURE_STAFFING_POLICIES[featureId] ?? fail("saas_feature_staffing_policy_unknown", `Unknown feature staffing policy: ${featureId}.`);
  const scope = normalizeScope(input.scope, tenantId);
  const configured = configuredFeature(state, tenantId, featureId, scope);
  const roleCoverage = Object.fromEntries(policy.requiredRoleSets.flatMap((roleSet) => roleSet).map((roleId) => [roleId, activeHumanPrincipalsForRole(state, tenantId, roleId, now, scope)]));
  const requirementCoverage = policy.requiredRoleSets.map((anyOf) => ({ anyOf, principalIds: [...new Set(anyOf.flatMap((roleId) => roleCoverage[roleId] ?? []))] }));
  const missingRoleSets = requirementCoverage.filter((item) => item.principalIds.length === 0).map((item) => item.anyOf);
  const independentPairs = policy.independentPairs.map(([left, right]) => {
    const leftIds = roleCoverage[left] ?? activeHumanPrincipalsForRole(state, tenantId, left, now, scope);
    const rightIds = roleCoverage[right] ?? activeHumanPrincipalsForRole(state, tenantId, right, now, scope);
    return { roles: [left, right], leftPrincipalIds: leftIds, rightPrincipalIds: rightIds, independent: leftIds.length === 0 || rightIds.length === 0 || leftIds.some((leftId) => rightIds.some((rightId) => leftId !== rightId)) };
  });
  const distinctPrincipalIds = [...new Set(requirementCoverage.flatMap((item) => item.principalIds))];
  const sodViolations = activeTenantHumanPrincipals(state, tenantId).flatMap((principal) => findSodViolations(activeRoleIds(state, tenantId, principal.principalId, now, scope)).map((rule) => ({ principalId: principal.principalId, ruleId: rule.ruleId, roles: rule.roles })));
  const operationalPauses = Object.values(records(state, "staffingEscalations")).filter((item) => item.tenantId === tenantId && item.featureId === featureId && featureConfigKey(item.featureId, item.scope) === featureConfigKey(featureId, scope) && item.status === "open");
  const blockers = [
    ...(configured?.requestedStatus === "enabled" ? [] : [configured ? "feature_disabled_by_configuration" : "feature_not_configured"]),
    ...missingRoleSets.map((roles) => `missing_role_set:${roles.join("|")}`),
    ...independentPairs.filter((item) => !item.independent).map((item) => `not_independent:${item.roles.join(":")}`),
    ...sodViolations.map((item) => `sod:${item.ruleId}:${item.principalId}`),
    ...(input.ignoreOperationalPause ? [] : operationalPauses.map((item) => `operational_pause:${item.escalationId}`))
  ];
  if (distinctPrincipalIds.length < policy.minimumDistinctPrincipals) blockers.push(`minimum_distinct_principals:${policy.minimumDistinctPrincipals}`);
  return {
    tenantId,
    featureId,
    name: policy.name,
    plane: policy.plane,
    scope,
    configured: Boolean(configured),
    requestedStatus: configured?.requestedStatus ?? "disabled",
    operationalStatus: blockers.length ? "disabled_staffing" : "enabled",
    ready: blockers.length === 0,
    requiredRoleSets: policy.requiredRoleSets,
    roleCoverage,
    missingRoleSets,
    independentPairs,
    minimumDistinctPrincipals: policy.minimumDistinctPrincipals,
    distinctPrincipalIds,
    sodViolations,
    operationalPauses,
    regulatoryRefs: policy.regulatoryRefs,
    blockers,
    assessedAt: now.toISOString()
  };
}

/** Read-only projection of every configured feature's staffing readiness for a tenant, used for dashboards and as the "before" snapshot staffing-safety responses diff against. */
export function projectTenantFeatureStaffing(state = {}, tenantId, now = new Date()) {
  required(tenantId, "tenantId");
  const configuration = records(state, "tenantFeatureStaffingConfigs")[tenantId] ?? null;
  const features = (configuration?.features ?? []).map((item) => assessFeatureStaffingReadiness(state, { tenantId, featureId: item.featureId, scope: item.scope }, now));
  return {
    tenantId,
    configurationVersion: configuration?.version ?? 0,
    configuredCount: features.length,
    enabledCount: features.filter((item) => item.ready).length,
    disabledCount: features.filter((item) => !item.ready).length,
    status: features.every((item) => item.ready) ? "ready" : "blocked",
    features,
    assessedAt: now.toISOString()
  };
}

export function authorizeStaffedFeatureAction(state = {}, input, now = new Date()) {
  const readiness = assessFeatureStaffingReadiness(state, input, now);
  if (!readiness.ready) return { outcome: "deny", reason: "feature_disabled_staffing", readiness };
  const principal = sameTenantPrincipal(state, input.tenantId, input.principalId, { active: true, now });
  const requiredRoleId = required(input.requiredRoleId, "requiredRoleId");
  if (!FEATURE_STAFFING_POLICIES[input.featureId].requiredRoleSets.some((roleSet) => roleSet.includes(requiredRoleId))) return { outcome: "deny", reason: "role_not_valid_for_feature", readiness };
  const roleIds = activeRoleIds(state, input.tenantId, principal.principalId, now, readiness.scope);
  if (!roleIds.includes(requiredRoleId)) return { outcome: "deny", reason: "required_role_not_granted", readiness, roleIds };
  if (AGENT_PRINCIPAL_TYPES.has(principal.principalType)) return { outcome: "deny", reason: "agent_cannot_perform_human_control", readiness, roleIds };
  return { outcome: "allow", reason: "staffing_and_role_ready", readiness, roleIds };
}

export function assessPrincipalRemovalImpact(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const principal = sameTenantPrincipal(state, tenantId, input.principalId);
  const before = projectTenantFeatureStaffing(state, tenantId, now);
  const simulated = put(state, "saasPrincipals", principalKey(tenantId, principal.principalId), { ...principal, status: "inactive" });
  const after = projectTenantFeatureStaffing(simulated, tenantId, now);
  const newlyDisabledFeatureIds = after.features.filter((item) => !item.ready && before.features.find((prior) => prior.featureId === item.featureId && featureConfigKey(prior.featureId, prior.scope) === featureConfigKey(item.featureId, item.scope))?.ready).map((item) => item.featureId);
  return { tenantId, principalId: principal.principalId, safeToRetire: newlyDisabledFeatureIds.length === 0, newlyDisabledFeatureIds, before, after, assessedAt: now.toISOString() };
}

export function closeStaffingEscalation(state = {}, input, now = new Date()) {
  const escalation = records(state, "staffingEscalations")[input?.escalationId];
  if (!escalation || escalation.status !== "open") fail("saas_staffing_escalation_not_open", "An open staffing escalation is required.");
  const proposedBy = sameTenantPrincipal(state, escalation.tenantId, input.proposedBy, { active: true, human: true, now }).principalId;
  const approvedBy = sameTenantPrincipal(state, escalation.tenantId, input.approvedBy, { active: true, human: true, now }).principalId;
  if (proposedBy === approvedBy || [escalation.triggeredByPrincipalId].includes(approvedBy)) fail("saas_staffing_escalation_four_eyes", "Independent staffing-escalation closure is required.");
  requireAction(state, escalation.tenantId, proposedBy, "role.propose", now);
  requireAction(state, escalation.tenantId, approvedBy, "role.approve", now);
  const readiness = assessFeatureStaffingReadiness(state, { tenantId: escalation.tenantId, featureId: escalation.featureId, scope: escalation.scope, ignoreOperationalPause: true }, now);
  if (readiness.blockers.length) fail("saas_staffing_escalation_unresolved", `Staffing remains incomplete: ${readiness.blockers.join(", ")}.`);
  const closed = { ...escalation, status: "closed", resolutionRef: required(input.resolutionRef, "resolutionRef"), proposedBy, approvedBy, approvalRef: required(input.approvalRef, "approvalRef"), closedAt: now.toISOString() };
  return { state: put(state, "staffingEscalations", escalation.escalationId, closed), escalation: closed };
}

export function registerSaasPrincipal(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const principalId = required(input?.principalId, "principalId");
  const key = principalKey(tenantId, principalId);
  if (records(state, "saasPrincipals")[key]) fail("saas_principal_exists", "Principal already exists in tenant scope.");
  if (!["invited", "active", "suspended", "inactive"].includes(input.status)) fail("saas_principal_status_invalid", "Principal status is invalid.");
  const principalType = input.principalType ?? HUMAN_PRINCIPAL_TYPE;
  if (principalType !== HUMAN_PRINCIPAL_TYPE && !AGENT_PRINCIPAL_TYPES.has(principalType)) fail("saas_principal_type_invalid", "Principal type must be human, fixed_agent or dynamic_agent.");
  let agent = null;
  if (AGENT_PRINCIPAL_TYPES.has(principalType)) {
    const sponsor = sameTenantPrincipal(state, tenantId, input.sponsorPrincipalId, { active: true, verified: true, human: true, now });
    if (input.workloadIdentityVerified !== true) fail("saas_agent_workload_identity_required", "A verified workload identity is required for an agent principal.");
    const expiresAt = principalType === "dynamic_agent" ? boundedFuture(input.expiresAt, now, MAX_DYNAMIC_AGENT_MS, "dynamic agent") : input.expiresAt ? validDate(input.expiresAt, "expiresAt") : null;
    agent = { sponsorPrincipalId: sponsor.principalId, agentDefinitionRef: required(input.agentDefinitionRef, "agentDefinitionRef"), modelRef: input.modelRef ? required(input.modelRef, "modelRef") : null, workloadIdentityRef: required(input.workloadIdentityRef, "workloadIdentityRef"), workloadIdentityVerified: true, expiresAt };
  }
  const principal = {
    tenantId,
    principalId,
    principalType,
    displayName: required(input.displayName, "displayName"),
    status: input.status,
    emailVerified: principalType === HUMAN_PRINCIPAL_TYPE && input.emailVerified === true,
    mfaEnrolled: principalType === HUMAN_PRINCIPAL_TYPE && input.mfaEnrolled === true,
    identityEvidenceRef: required(input.identityEvidenceRef, "identityEvidenceRef"),
    ...(agent ?? {}),
    createdAt: now.toISOString()
  };
  return { state: put(state, "saasPrincipals", key, principal), principal };
}

export function issueBootstrapOwner(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const principal = sameTenantPrincipal(state, tenantId, input.principalId, { active: true, verified: true, human: true, now });
  if (records(state, "tenantOwnership")[tenantId]) fail("saas_bootstrap_owner_exists", "Tenant already has an owner.");
  if (tenantPrincipals(state, tenantId).filter((item) => item.status === "active").length !== 1) fail("saas_bootstrap_owner_not_first", "Bootstrap owner must be the first active organisation principal.");
  const expiresAt = boundedFuture(input.expiresAt, now, MAX_BOOTSTRAP_MS, "bootstrap owner");
  const grant = trustedBootstrapGrant(tenantId, principal.principalId, "bootstrap_owner", expiresAt, input.verificationRef, now);
  const ownership = { tenantId, ownerPrincipalId: principal.principalId, status: "bootstrap", verificationRef: required(input.verificationRef, "verificationRef"), startedAt: now.toISOString(), bootstrapExpiresAt: expiresAt };
  return { state: put(put(state, "saasRoleGrants", grant.grantId, grant), "tenantOwnership", tenantId, ownership), grant, ownership };
}

export function issueBootstrapChecker(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const ownership = records(state, "tenantOwnership")[tenantId];
  if (!ownership || ownership.status !== "bootstrap") fail("saas_bootstrap_not_active", "Bootstrap ownership must be active.");
  const principal = sameTenantPrincipal(state, tenantId, input.principalId, { active: true, verified: true, human: true, now });
  if (principal.principalId === ownership.ownerPrincipalId) fail("saas_bootstrap_checker_not_independent", "Bootstrap checker must be independent of the owner.");
  if (!input.authorizedRepresentativeEvidenceRef) fail("saas_bootstrap_checker_evidence_required", "Independent authorized-representative evidence is required.");
  const expiresAt = boundedFuture(input.expiresAt, now, MAX_BOOTSTRAP_MS, "bootstrap checker");
  const grant = trustedBootstrapGrant(tenantId, principal.principalId, "bootstrap_checker", expiresAt, input.authorizedRepresentativeEvidenceRef, now);
  return { state: put(state, "saasRoleGrants", grant.grantId, grant), grant };
}

export function proposeRoleGrant(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const proposedBy = sameTenantPrincipal(state, tenantId, input.proposedBy, { active: true, human: true, now }).principalId;
  const target = sameTenantPrincipal(state, tenantId, input.principalId, { active: true, verified: true, now });
  if (proposedBy === target.principalId) fail("saas_role_self_grant", "A principal cannot propose their own access.");
  requireAction(state, tenantId, proposedBy, "role.propose", now);
  const roleIds = validateCanonicalRoles(input.roleIds);
  if (AGENT_PRINCIPAL_TYPES.has(target.principalType) && roleIds.some((roleId) => !AGENT_ASSIGNABLE_ROLE_IDS.includes(roleId))) fail("saas_agent_role_forbidden", "Agents may receive only the dedicated automation, AI-agent or integration-workload roles.");
  if (target.principalType === HUMAN_PRINCIPAL_TYPE && roleIds.some((roleId) => AGENT_ASSIGNABLE_ROLE_IDS.includes(roleId))) fail("saas_human_agent_role_forbidden", "Agent workload roles cannot be granted to human principals.");
  for (const roleId of roleIds) {
    const role = getCanonicalRole(roleId);
    if (!role.assignable) fail("saas_role_not_assignable", `${roleId} is not assignable through tenant administration.`);
    validateScope(role, input.scope, tenantId);
  }
  validateNoSodConflict(state, tenantId, target.principalId, roleIds, now);
  const requestId = required(input.requestId, "requestId");
  if (records(state, "saasRoleRequests")[requestId]) fail("saas_role_request_exists", "Role request already exists.");
  const request = { requestId, requestType: "grant", tenantId, principalId: target.principalId, roleIds, scope: normalizeScope(input.scope, tenantId), proposedBy, reason: required(input.reason, "reason"), status: "pending", proposedAt: now.toISOString() };
  return { state: put(state, "saasRoleRequests", requestId, request), request };
}

export function approveRoleGrant(state = {}, input, now = new Date()) {
  const request = pendingRequest(state, input, "grant");
  const approvedBy = independentApprover(state, request, input.approvedBy, now);
  validateNoSodConflict(state, request.tenantId, request.principalId, request.roleIds, now);
  const effectiveFrom = input.effectiveFrom ? validDate(input.effectiveFrom, "effectiveFrom") : now.toISOString();
  const validUntil = input.validUntil ? validDate(input.validUntil, "validUntil") : null;
  if (validUntil && Date.parse(validUntil) <= Math.max(now.getTime(), Date.parse(effectiveFrom))) fail("saas_role_grant_dates_invalid", "Role grant validity is invalid.");
  let next = state;
  const grants = request.roleIds.map((roleId) => {
    const grantId = `${request.requestId}:${roleId}`;
    const grant = { grantId, tenantId: request.tenantId, principalId: request.principalId, roleId, scope: request.scope, status: "active", effectiveFrom, validUntil, proposedBy: request.proposedBy, approvedBy, approvalRef: required(input.approvalRef, "approvalRef"), approvedAt: now.toISOString() };
    next = put(next, "saasRoleGrants", grantId, grant);
    return grant;
  });
  const decided = { ...request, status: "approved", approvedBy, approvalRef: input.approvalRef, decidedAt: now.toISOString() };
  return { state: put(next, "saasRoleRequests", request.requestId, decided), request: decided, grants };
}

export function proposeRoleRevocation(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const proposedBy = sameTenantPrincipal(state, tenantId, input.proposedBy, { active: true, human: true, now }).principalId;
  requireAction(state, tenantId, proposedBy, "role.propose", now);
  const grantIds = uniqueRequired(input.grantIds, "grantIds");
  const grants = grantIds.map((grantId) => {
    const grant = records(state, "saasRoleGrants")[grantId];
    if (!grant || grant.tenantId !== tenantId || !isActiveGrant(grant, now)) fail("saas_role_grant_inactive", "An active same-tenant grant is required.");
    return grant;
  });
  if (grants.some((grant) => grant.principalId === proposedBy)) fail("saas_role_self_revocation", "A principal cannot propose their own role revocation.");
  const requestId = required(input.requestId, "requestId");
  if (records(state, "saasRoleRequests")[requestId]) fail("saas_role_request_exists", "Role request already exists.");
  const request = { requestId, requestType: "revoke", tenantId, principalId: grants[0].principalId, grantIds, proposedBy, reason: required(input.reason, "reason"), status: "pending", proposedAt: now.toISOString() };
  if (grants.some((grant) => grant.principalId !== request.principalId)) fail("saas_role_revocation_mixed_principals", "One revocation request may affect only one principal.");
  return { state: put(state, "saasRoleRequests", requestId, request), request };
}

export function approveRoleRevocation(state = {}, input, now = new Date()) {
  const request = pendingRequest(state, input, "revoke");
  const approvedBy = independentApprover(state, request, input.approvedBy, now);
  const before = projectTenantFeatureStaffing(state, request.tenantId, now);
  let next = state;
  const grants = request.grantIds.map((grantId) => {
    const grant = records(next, "saasRoleGrants")[grantId];
    const revoked = { ...grant, status: "revoked", revokedBy: approvedBy, revocationApprovalRef: required(input.approvalRef, "approvalRef"), revokedAt: now.toISOString() };
    next = put(next, "saasRoleGrants", grantId, revoked);
    return revoked;
  });
  const decided = { ...request, status: "approved", approvedBy, approvalRef: input.approvalRef, decidedAt: now.toISOString() };
  next = put(next, "saasRoleRequests", request.requestId, decided);
  const safety = applyStaffingSafetyResponse(next, before, request.tenantId, { causeType: "role_revocation", causeRef: request.requestId, triggeredByPrincipalId: approvedBy, affectedPrincipalId: request.principalId }, now);
  return { state: safety.state, request: decided, grants, staffingImpact: safety.impact, escalations: safety.escalations };
}

export function assessMinimumLaunchCoverage(state = {}, tenantId, now = new Date()) {
  required(tenantId, "tenantId");
  const coverage = Object.fromEntries(MINIMUM_LAUNCH_ROLE_COVERAGE.map((roleId) => [roleId, activePrincipalsForRole(state, tenantId, roleId, now)]));
  const missingRoles = MINIMUM_LAUNCH_ROLE_COVERAGE.filter((roleId) => coverage[roleId].length === 0);
  const sodViolations = activeTenantPrincipals(state, tenantId).flatMap((principal) => findSodViolations(activeRoleIds(state, tenantId, principal.principalId, now)).map((rule) => ({ principalId: principal.principalId, ruleId: rule.ruleId, roles: rule.roles })));
  const distinctPrincipalIds = [...new Set(Object.values(coverage).flat())];
  const independentPairs = [
    independentCoverage(coverage, "credit_maker", "credit_checker"),
    independentCoverage(coverage, "operations_maker", "operations_checker"),
    independentCoverage(coverage, "security_admin", "auditor")
  ];
  const blockers = [...missingRoles.map((roleId) => `missing_role:${roleId}`), ...sodViolations.map((item) => `sod:${item.ruleId}:${item.principalId}`), ...independentPairs.filter((item) => !item.independent).map((item) => `not_independent:${item.roles.join(":")}`)];
  if (distinctPrincipalIds.length < 3) blockers.push("minimum_distinct_principals:3");
  return { tenantId, ready: blockers.length === 0, coverage, missingRoles, distinctPrincipalIds, sodViolations, independentPairs, blockers, assessedAt: now.toISOString() };
}

export function completeBootstrapTransition(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const ownership = records(state, "tenantOwnership")[tenantId];
  if (!ownership || ownership.status !== "bootstrap") fail("saas_bootstrap_not_active", "Bootstrap ownership must be active.");
  const proposedBy = sameTenantPrincipal(state, tenantId, input.proposedBy, { active: true, human: true, now }).principalId;
  const approvedBy = sameTenantPrincipal(state, tenantId, input.approvedBy, { active: true, human: true, now }).principalId;
  if (proposedBy === approvedBy || approvedBy === ownership.ownerPrincipalId) fail("saas_bootstrap_transition_four_eyes", "Independent non-owner approval is required.");
  requireAction(state, tenantId, approvedBy, "role.approve", now);
  const readiness = assessMinimumLaunchCoverage(state, tenantId, now);
  if (!readiness.ready) fail("saas_launch_role_coverage_incomplete", `Launch role coverage is incomplete: ${readiness.blockers.join(", ")}.`);
  let next = state;
  for (const grant of Object.values(records(state, "saasRoleGrants"))) {
    if (grant.tenantId === tenantId && ["bootstrap_owner", "bootstrap_checker"].includes(grant.roleId) && isActiveGrant(grant, now)) next = put(next, "saasRoleGrants", grant.grantId, { ...grant, status: "transitioned", transitionedAt: now.toISOString() });
  }
  const ownerGrant = { grantId: `ownership:${tenantId}:${ownership.ownerPrincipalId}`, tenantId, principalId: ownership.ownerPrincipalId, roleId: "tenant_owner", scope: { type: "tenant", id: tenantId }, status: "active", effectiveFrom: now.toISOString(), validUntil: null, proposedBy, approvedBy, approvalRef: required(input.approvalRef, "approvalRef"), approvedAt: now.toISOString() };
  next = put(next, "saasRoleGrants", ownerGrant.grantId, ownerGrant);
  const completed = { ...ownership, status: "active", activatedAt: now.toISOString(), bootstrapCompletedBy: proposedBy, bootstrapApprovedBy: approvedBy, approvalRef: input.approvalRef };
  return { state: put(next, "tenantOwnership", tenantId, completed), ownership: completed, ownerGrant, readiness };
}

export function requestOwnershipTransfer(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const ownership = records(state, "tenantOwnership")[tenantId];
  if (!ownership || ownership.status !== "active") fail("saas_ownership_not_active", "Active ownership is required.");
  if (input.proposedBy !== ownership.ownerPrincipalId) fail("saas_ownership_transfer_forbidden", "Only the current owner may propose transfer.");
  const target = sameTenantPrincipal(state, tenantId, input.newOwnerPrincipalId, { active: true, verified: true, human: true, now });
  if (target.principalId === ownership.ownerPrincipalId) fail("saas_ownership_transfer_same_owner", "New owner must be different.");
  if (!activeRoleIds(state, tenantId, target.principalId, now).includes("tenant_admin")) fail("saas_ownership_target_not_admin", "New owner must be an active tenant administrator.");
  const requestId = required(input.requestId, "requestId");
  const request = { requestId, tenantId, oldOwnerPrincipalId: ownership.ownerPrincipalId, newOwnerPrincipalId: target.principalId, proposedBy: ownership.ownerPrincipalId, reason: required(input.reason, "reason"), targetAcceptanceRef: required(input.targetAcceptanceRef, "targetAcceptanceRef"), status: "pending", proposedAt: now.toISOString() };
  return { state: put(state, "ownershipTransferRequests", requestId, request), request };
}

export function approveOwnershipTransfer(state = {}, input, now = new Date()) {
  const request = records(state, "ownershipTransferRequests")[input?.requestId];
  if (!request || request.status !== "pending") fail("saas_ownership_transfer_not_pending", "Pending ownership transfer is required.");
  const approvedBy = sameTenantPrincipal(state, request.tenantId, input.approvedBy, { active: true, human: true, now }).principalId;
  if ([request.proposedBy, request.newOwnerPrincipalId].includes(approvedBy)) fail("saas_ownership_transfer_four_eyes", "An independent administrator must approve ownership transfer.");
  const approverRoles = activeRoleIds(state, request.tenantId, approvedBy, now);
  if (!approverRoles.some((role) => ["tenant_admin", "security_admin"].includes(role))) fail("saas_ownership_transfer_approver_forbidden", "Tenant or security administrator approval is required.");
  let next = state;
  for (const grant of Object.values(records(state, "saasRoleGrants"))) if (grant.tenantId === request.tenantId && grant.roleId === "tenant_owner" && isActiveGrant(grant, now)) next = put(next, "saasRoleGrants", grant.grantId, { ...grant, status: "transferred", transferredAt: now.toISOString() });
  const grant = { grantId: `ownership:${request.tenantId}:${request.newOwnerPrincipalId}`, tenantId: request.tenantId, principalId: request.newOwnerPrincipalId, roleId: "tenant_owner", scope: { type: "tenant", id: request.tenantId }, status: "active", effectiveFrom: now.toISOString(), validUntil: null, proposedBy: request.proposedBy, approvedBy, approvalRef: required(input.approvalRef, "approvalRef"), approvedAt: now.toISOString() };
  next = put(next, "saasRoleGrants", grant.grantId, grant);
  const decided = { ...request, status: "approved", approvedBy, approvalRef: input.approvalRef, decidedAt: now.toISOString() };
  next = put(next, "ownershipTransferRequests", request.requestId, decided);
  const ownership = { ...records(next, "tenantOwnership")[request.tenantId], ownerPrincipalId: request.newOwnerPrincipalId, transferredAt: now.toISOString(), transferRequestId: request.requestId };
  return { state: put(next, "tenantOwnership", request.tenantId, ownership), request: decided, ownership, grant };
}

export function requestEmergencyAccess(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const requestedBy = sameTenantPrincipal(state, tenantId, input.requestedBy, { active: true, verified: true, human: true, now }).principalId;
  const beneficiary = sameTenantPrincipal(state, tenantId, input.beneficiaryPrincipalId, { active: true, verified: true, human: true, now });
  const actions = uniqueRequired(input.actions, "actions");
  if (actions.some((action) => !EMERGENCY_ALLOWED_ACTIONS.includes(action))) fail("saas_emergency_action_forbidden", "Emergency request contains a non-break-glass action.");
  const expiresAt = boundedFuture(input.expiresAt, now, MAX_EMERGENCY_MS, "emergency access");
  const requestId = required(input.requestId, "requestId");
  const request = { requestId, tenantId, requestedBy, beneficiaryPrincipalId: beneficiary.principalId, actions, incidentRef: required(input.incidentRef, "incidentRef"), reason: required(input.reason, "reason"), expiresAt, status: "pending", requestedAt: now.toISOString() };
  return { state: put(state, "emergencyAccessRequests", requestId, request), request };
}

export function approveEmergencyAccess(state = {}, input, now = new Date()) {
  const request = records(state, "emergencyAccessRequests")[input?.requestId];
  if (!request || request.status !== "pending" || Date.parse(request.expiresAt) <= now.getTime()) fail("saas_emergency_request_inactive", "A live pending emergency request is required.");
  const approvedBy = sameTenantPrincipal(state, request.tenantId, input.approvedBy, { active: true, human: true, now }).principalId;
  if ([request.requestedBy, request.beneficiaryPrincipalId].includes(approvedBy)) fail("saas_emergency_four_eyes", "Independent emergency approval is required.");
  requireAction(state, request.tenantId, approvedBy, "emergency.approve", now);
  const grant = { emergencyGrantId: `emergency:${request.requestId}`, tenantId: request.tenantId, principalId: request.beneficiaryPrincipalId, actions: request.actions, incidentRef: request.incidentRef, status: "active", approvedBy, approvalRef: required(input.approvalRef, "approvalRef"), activatedAt: now.toISOString(), expiresAt: request.expiresAt };
  const decided = { ...request, status: "approved", approvedBy, approvalRef: input.approvalRef, decidedAt: now.toISOString() };
  return { state: put(put(state, "emergencyAccessRequests", request.requestId, decided), "emergencyAccessGrants", grant.emergencyGrantId, grant), request: decided, grant };
}

export function closeEmergencyAccess(state = {}, input, now = new Date()) {
  const grant = records(state, "emergencyAccessGrants")[input?.emergencyGrantId];
  if (!grant || grant.tenantId !== input.tenantId || grant.status !== "active") fail("saas_emergency_grant_inactive", "Active same-tenant emergency grant is required.");
  const closedBy = sameTenantPrincipal(state, grant.tenantId, input.closedBy, { active: true, human: true, now }).principalId;
  const closed = { ...grant, status: "closed", closedBy, closureEvidenceRef: required(input.closureEvidenceRef, "closureEvidenceRef"), closedAt: now.toISOString() };
  return { state: put(state, "emergencyAccessGrants", grant.emergencyGrantId, closed), grant: closed };
}

export function changeSaasPrincipalStatus(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const principal = sameTenantPrincipal(state, tenantId, input.principalId);
  if (!["active", "suspended", "inactive"].includes(input.status)) fail("saas_principal_status_invalid", "Principal status is invalid.");
  const changedBy = sameTenantPrincipal(state, tenantId, input.changedBy, { active: true, human: true, now }).principalId;
  if (changedBy === principal.principalId && input.status !== "active") fail("saas_principal_self_disable", "A principal cannot disable their own identity.");
  if (input.status === "inactive") {
    assertEffectiveAdminRemains(state, tenantId, now, { inactivePrincipalIds: new Set([principal.principalId]) });
    const removal = assessPrincipalRemovalImpact(state, { tenantId, principalId: principal.principalId }, now);
    if (!removal.safeToRetire) fail("saas_principal_retirement_staffing_blocked", `Retirement would disable configured features: ${removal.newlyDisabledFeatureIds.join(", ")}. Suspend access immediately, then re-staff or disable those features before retirement.`);
  }
  const before = projectTenantFeatureStaffing(state, tenantId, now);
  const changed = { ...principal, status: input.status, statusReason: required(input.reason, "reason"), statusChangedBy: changedBy, statusChangedAt: now.toISOString(), forensicRecordRetained: true };
  const changedState = put(state, "saasPrincipals", principalKey(tenantId, principal.principalId), changed);
  const safety = input.status === "active" ? { state: changedState, impact: null, escalations: [] } : applyStaffingSafetyResponse(changedState, before, tenantId, { causeType: `principal_${input.status}`, causeRef: required(input.evidenceRef, "evidenceRef"), triggeredByPrincipalId: changedBy, affectedPrincipalId: principal.principalId }, now);
  return { state: safety.state, principal: changed, staffingImpact: safety.impact, escalations: safety.escalations };
}

export function suspendSaasPrincipalFromIdentityProvider(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const principal = sameTenantPrincipal(state, tenantId, input.principalId);
  if (principal.principalType !== HUMAN_PRINCIPAL_TYPE) fail("saas_idp_human_principal_required", "Enterprise identity deprovisioning applies only to human principals.");
  const before = projectTenantFeatureStaffing(state, tenantId, now);
  const changedBy = `idp:${required(input.policyId, "policyId")}`;
  const changed = {
    ...principal,
    status: "suspended",
    statusReason: "enterprise_identity_deactivated",
    statusChangedBy: changedBy,
    statusChangedAt: now.toISOString(),
    statusEvidenceRef: required(input.evidenceRef, "evidenceRef"),
    forensicRecordRetained: true
  };
  const changedState = put(state, "saasPrincipals", principalKey(tenantId, principal.principalId), changed);
  const safety = applyStaffingSafetyResponse(changedState, before, tenantId, {
    causeType: "identity_provider_deactivation",
    causeRef: input.evidenceRef,
    triggeredByPrincipalId: changedBy,
    affectedPrincipalId: principal.principalId
  }, now);
  return { state: safety.state, principal: changed, staffingImpact: safety.impact, escalations: safety.escalations };
}

export function authorizeSaasAction(state = {}, input, now = new Date()) {
  const principal = sameTenantPrincipal(state, input?.tenantId, input?.principalId, { active: true, now });
  const action = required(input.action, "action");
  const roleIds = activeRoleIds(state, principal.tenantId, principal.principalId, now, input.scope);
  const roleAllowed = roleIds.some((roleId) => getCanonicalRole(roleId).allowedActions.includes(action));
  const emergencyGrant = Object.values(records(state, "emergencyAccessGrants")).find((grant) => grant.tenantId === principal.tenantId && grant.principalId === principal.principalId && grant.status === "active" && Date.parse(grant.expiresAt) > now.getTime() && grant.actions.includes(action));
  return { outcome: roleAllowed || emergencyGrant ? "allow" : "deny", reason: roleAllowed ? "canonical_role" : emergencyGrant ? "active_emergency_grant" : "action_not_granted", roleIds, emergencyGrantId: emergencyGrant?.emergencyGrantId ?? null };
}

export function projectPrincipalAccess(state = {}, tenantId, principalId, now = new Date()) {
  const principal = sameTenantPrincipal(state, tenantId, principalId);
  const grants = Object.values(records(state, "saasRoleGrants")).filter((grant) => grant.tenantId === tenantId && grant.principalId === principalId);
  const activeGrants = grants.filter((grant) => isActiveGrant(grant, now));
  return { principal, grants, activeGrants, roleIds: [...new Set(activeGrants.map((grant) => grant.roleId))], sodViolations: findSodViolations(activeGrants.map((grant) => grant.roleId)), projectedAt: now.toISOString() };
}

// Read-only, tenant-contained projection for the IAM administration workspace.
// Mutation authority remains exclusively in the maker-checker functions above.
export function projectIdentityGovernanceWorkspace(state = {}, tenantId, now = new Date()) {
  required(tenantId, "tenantId");
  const tenantValues = (key) => Object.values(records(state, key)).filter((item) => item.tenantId === tenantId);
  const principals = tenantPrincipals(state, tenantId)
    .map((principal) => projectPrincipalAccess(state, tenantId, principal.principalId, now))
    .sort((left, right) => left.principal.displayName.localeCompare(right.principal.displayName));
  const roleRequests = tenantValues("saasRoleRequests").sort(newestFirst("proposedAt"));
  const staffingRequests = tenantValues("featureStaffingRequests").sort(newestFirst("proposedAt"));
  const staffingEscalations = tenantValues("staffingEscalations").sort(newestFirst("openedAt"));
  const staffingClosureRequests = tenantValues("staffingEscalationClosureRequests").sort(newestFirst("proposedAt"));
  const ownershipTransferRequests = tenantValues("ownershipTransferRequests").sort(newestFirst("proposedAt"));
  const emergencyAccessRequests = tenantValues("emergencyAccessRequests").sort(newestFirst("requestedAt"));
  const emergencyAccessGrants = tenantValues("emergencyAccessGrants")
    .map((grant) => ({ ...grant, effectiveStatus: grant.status === "active" && Date.parse(grant.expiresAt) <= now.getTime() ? "expired" : grant.status }))
    .sort(newestFirst("activatedAt"));
  const featureReadiness = projectTenantFeatureStaffing(state, tenantId, now);
  const launchCoverage = assessMinimumLaunchCoverage(state, tenantId, now);
  const pendingCount = (items) => items.filter((item) => item.status === "pending").length;
  return {
    tenantId,
    ownership: records(state, "tenantOwnership")[tenantId] ?? null,
    principals,
    roleRequests,
    staffingRequests,
    staffingEscalations,
    staffingClosureRequests,
    ownershipTransferRequests,
    emergencyAccessRequests,
    emergencyAccessGrants,
    featureReadiness,
    launchCoverage,
    summary: {
      principals: principals.length,
      activeHumans: principals.filter((item) => item.principal.principalType === HUMAN_PRINCIPAL_TYPE && item.principal.status === "active").length,
      activeAgents: principals.filter((item) => AGENT_PRINCIPAL_TYPES.has(item.principal.principalType) && item.principal.status === "active").length,
      pendingApprovals: pendingCount(roleRequests) + pendingCount(staffingRequests) + pendingCount(staffingClosureRequests) + pendingCount(ownershipTransferRequests) + pendingCount(emergencyAccessRequests),
      openEscalations: staffingEscalations.filter((item) => item.status === "open").length,
      activeEmergencyGrants: emergencyAccessGrants.filter((item) => item.effectiveStatus === "active").length
    },
    projectedAt: now.toISOString()
  };
}

function pair(left, right, ruleId) { return Object.freeze({ ruleId, roles: Object.freeze([left, right]), enforcement: "hard" }); }
function newestFirst(field) { return (left, right) => String(right?.[field] ?? "").localeCompare(String(left?.[field] ?? "")); }
function staffingPolicy(featureId, name, plane, requiredRoleSets, independentPairs, minimumDistinctPrincipals, regulatoryRefs) { return Object.freeze({ featureId, name, plane, scopes: Object.freeze(["tenant", "product"]), requiredRoleSets: Object.freeze(requiredRoleSets.map((set) => Object.freeze(set))), independentPairs: Object.freeze(independentPairs.map((set) => Object.freeze(set))), minimumDistinctPrincipals, regulatoryRefs: Object.freeze(regulatoryRefs) }); }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("saas_identity_input_invalid", `${field} is required.`); return value.trim(); }
function records(state, key) { return state?.[key] ?? {}; }
function put(state, key, id, value) { return { ...state, [key]: { ...records(state, key), [id]: value } }; }
function principalKey(tenantId, principalId) { return `${tenantId}:${principalId}`; }
function tenantPrincipals(state, tenantId) { return Object.values(records(state, "saasPrincipals")).filter((principal) => principal.tenantId === tenantId); }
function activeTenantPrincipals(state, tenantId) { return tenantPrincipals(state, tenantId).filter((principal) => principal.status === "active"); }
function uniqueRequired(value, field) { if (!Array.isArray(value) || !value.length) fail("saas_identity_input_invalid", `${field} is required.`); return [...new Set(value.map((item) => required(item, field)))]; }
function validDate(value, field) { const timestamp = Date.parse(value); if (!Number.isFinite(timestamp)) fail("saas_identity_input_invalid", `${field} must be a valid date.`); return new Date(timestamp).toISOString(); }
function boundedFuture(value, now, maxMs, label) { const iso = validDate(value, "expiresAt"); const duration = Date.parse(iso) - now.getTime(); if (duration <= 0 || duration > maxMs) fail("saas_temporary_grant_duration_invalid", `${label} expiry exceeds its permitted duration.`); return iso; }
function normalizeScope(scope, tenantId) { const type = scope?.type ?? "tenant"; const id = required(scope?.id ?? tenantId, "scope.id"); return { type, id }; }
function validateScope(role, scope, tenantId) { const normalized = normalizeScope(scope, tenantId); if (!role.scopes.includes(normalized.type)) fail("saas_role_scope_invalid", `${role.roleId} cannot be assigned at ${normalized.type} scope.`); if (normalized.type === "tenant" && normalized.id !== tenantId) fail("saas_role_tenant_mismatch", "Tenant scope does not match request tenant."); }
function sameTenantPrincipal(state, tenantIdValue, principalIdValue, options = {}) { const tenantId = required(tenantIdValue, "tenantId"), principalId = required(principalIdValue, "principalId"); const principal = records(state, "saasPrincipals")[principalKey(tenantId, principalId)]; if (!principal) { const crossTenant = Object.values(records(state, "saasPrincipals")).some((item) => item.principalId === principalId); fail(crossTenant ? "saas_principal_tenant_mismatch" : "saas_principal_missing", crossTenant ? "Principal belongs to another tenant." : "Principal does not exist in tenant."); } if (options.human && principal.principalType !== HUMAN_PRINCIPAL_TYPE) fail("saas_human_principal_required", "A human principal is required."); if (options.active && !principalOperational(state, principal, options.now ?? new Date())) fail("saas_principal_inactive", "An active, unexpired principal with an active sponsor is required."); if (options.verified && !principalVerified(principal)) fail("saas_principal_verification_incomplete", "A verified human identity with MFA or verified agent workload identity is required."); return principal; }
function trustedBootstrapGrant(tenantId, principalId, roleId, expiresAt, evidenceRef, now) { return { grantId: `${roleId}:${tenantId}:${principalId}`, tenantId, principalId, roleId, scope: { type: "tenant", id: tenantId }, status: "active", effectiveFrom: now.toISOString(), validUntil: expiresAt, issuedBy: "trusted_provisioning_boundary", evidenceRef: required(evidenceRef, "verificationRef"), issuedAt: now.toISOString() }; }
function isActiveGrant(grant, now) { return grant?.status === "active" && Date.parse(grant.effectiveFrom) <= now.getTime() && (!grant.validUntil || Date.parse(grant.validUntil) > now.getTime()); }
function scopeMatches(grant, requestedScope) { if (!requestedScope) return true; if (grant.scope.type === "tenant") return true; return grant.scope.type === requestedScope.type && grant.scope.id === requestedScope.id; }
function activeRoleIds(state, tenantId, principalId, now, requestedScope) { return [...new Set(Object.values(records(state, "saasRoleGrants")).filter((grant) => grant.tenantId === tenantId && grant.principalId === principalId && isActiveGrant(grant, now) && scopeMatches(grant, requestedScope)).map((grant) => grant.roleId))]; }
function activePrincipalsForRole(state, tenantId, roleId, now) { return activeTenantPrincipals(state, tenantId).filter((principal) => activeRoleIds(state, tenantId, principal.principalId, now).includes(roleId)).map((principal) => principal.principalId); }
function activeTenantHumanPrincipals(state, tenantId) { return activeTenantPrincipals(state, tenantId).filter((principal) => principal.principalType === HUMAN_PRINCIPAL_TYPE && principalVerified(principal)); }
function activeHumanPrincipalsForRole(state, tenantId, roleId, now, scope) { return activeTenantHumanPrincipals(state, tenantId).filter((principal) => activeRoleIds(state, tenantId, principal.principalId, now, scope).includes(roleId)).map((principal) => principal.principalId); }
function principalVerified(principal) { return principal.principalType === HUMAN_PRINCIPAL_TYPE ? principal.emailVerified === true && principal.mfaEnrolled === true : AGENT_PRINCIPAL_TYPES.has(principal.principalType) && principal.workloadIdentityVerified === true; }
function principalOperational(state, principal, now) { if (principal.status !== "active") return false; if (principal.expiresAt && Date.parse(principal.expiresAt) <= now.getTime()) return false; if (!AGENT_PRINCIPAL_TYPES.has(principal.principalType)) return true; const sponsor = records(state, "saasPrincipals")[principalKey(principal.tenantId, principal.sponsorPrincipalId)]; return sponsor?.principalType === HUMAN_PRINCIPAL_TYPE && sponsor.status === "active" && principalVerified(sponsor); }
function findSodViolations(roleIds) { const roles = new Set(roleIds); return SEGREGATION_OF_DUTIES_RULES.filter((rule) => rule.roles.every((role) => roles.has(role))); }
function validateNoSodConflict(state, tenantId, principalId, proposedRoles, now) { const allRoles = [...activeRoleIds(state, tenantId, principalId, now), ...proposedRoles]; const violations = findSodViolations(allRoles); if (violations.length) fail("saas_role_sod_conflict", `Segregation-of-duties conflict: ${violations.map((item) => item.ruleId).join(", ")}.`); }
function requireAction(state, tenantId, principalId, action, now) { const authorization = authorizeSaasAction(state, { tenantId, principalId, action }, now); if (authorization.outcome !== "allow") fail("saas_action_forbidden", `${action} is not granted.`); return authorization; }
function pendingRequest(state, input, requestType) { const request = records(state, "saasRoleRequests")[input?.requestId]; if (!request || request.status !== "pending" || request.requestType !== requestType) fail("saas_role_request_not_pending", `Pending ${requestType} request is required.`); if (input.tenantId !== request.tenantId) fail("saas_role_tenant_mismatch", "Role request belongs to another tenant."); return request; }
function independentApprover(state, request, approvedByValue, now) { const approvedBy = sameTenantPrincipal(state, request.tenantId, approvedByValue, { active: true, human: true, now }).principalId; if ([request.proposedBy, request.principalId].includes(approvedBy)) fail("saas_role_four_eyes_required", "Approver must be independent of proposer and target principal."); requireAction(state, request.tenantId, approvedBy, "role.approve", now); const ownership = records(state, "tenantOwnership")[request.tenantId]; if (ownership?.status === "active" && !activeRoleIds(state, request.tenantId, approvedBy, now).includes("access_reviewer")) fail("saas_role_approver_forbidden", "An independent access reviewer must approve post-bootstrap role changes."); return approvedBy; }
function independentCoverage(coverage, left, right) { const leftIds = coverage[left] ?? [], rightIds = coverage[right] ?? []; return { roles: [left, right], independent: leftIds.some((leftId) => rightIds.some((rightId) => leftId !== rightId)) }; }
function effectiveAdminPrincipalIds(state, tenantId, now, options = {}) { const revoked = options.revokedGrantIds ?? new Set(), inactive = options.inactivePrincipalIds ?? new Set(); return activeTenantPrincipals(state, tenantId).filter((principal) => !inactive.has(principal.principalId)).filter((principal) => Object.values(records(state, "saasRoleGrants")).some((grant) => grant.tenantId === tenantId && grant.principalId === principal.principalId && !revoked.has(grant.grantId) && isActiveGrant(grant, now) && ["tenant_admin", "user_admin"].includes(grant.roleId))).map((principal) => principal.principalId); }
function assertEffectiveAdminRemains(state, tenantId, now, options) { if (!effectiveAdminPrincipalIds(state, tenantId, now, options).length) fail("saas_last_effective_admin", "Operation would remove the last effective tenant or user administrator."); }
function featureConfigKey(featureId, scope) { return `${featureId}:${scope.type}:${scope.id}`; }
function configuredFeature(state, tenantId, featureId, scope) { return records(state, "tenantFeatureStaffingConfigs")[tenantId]?.features?.find((item) => featureConfigKey(item.featureId, item.scope) === featureConfigKey(featureId, scope)) ?? null; }
function applyStaffingSafetyResponse(state, before, tenantId, cause, now) {
  const afterBeforePause = projectTenantFeatureStaffing(state, tenantId, now);
  const newlyDisabled = afterBeforePause.features.filter((item) => !item.ready && before.features.find((prior) => featureConfigKey(prior.featureId, prior.scope) === featureConfigKey(item.featureId, item.scope))?.ready);
  let next = state;
  const escalations = [];
  for (const feature of newlyDisabled) {
    const escalationId = `staffing:${tenantId}:${featureConfigKey(feature.featureId, feature.scope)}:${now.toISOString()}`;
    const escalation = { escalationId, tenantId, featureId: feature.featureId, scope: feature.scope, status: "open", severity: "critical", causeType: cause.causeType, causeRef: cause.causeRef, triggeredByPrincipalId: cause.triggeredByPrincipalId, affectedPrincipalId: cause.affectedPrincipalId, blockers: feature.blockers, pausedWorkPolicy: "stop_new_actions_pause_uncommitted_work_preserve_evidence", escalationTargetRoles: ["tenant_admin", "security_admin", "compliance_officer", "auditor"], openedAt: now.toISOString() };
    next = put(next, "staffingEscalations", escalationId, escalation);
    escalations.push(escalation);
  }
  if (!effectiveAdminPrincipalIds(next, tenantId, now).length) {
    const escalationId = `staffing:${tenantId}:administrative_lockout:${now.toISOString()}`;
    const escalation = { escalationId, tenantId, featureId: "administrative_lockout", scope: { type: "tenant", id: tenantId }, status: "open", severity: "critical", causeType: cause.causeType, causeRef: cause.causeRef, triggeredByPrincipalId: cause.triggeredByPrincipalId, affectedPrincipalId: cause.affectedPrincipalId, blockers: ["no_effective_tenant_administrator"], pausedWorkPolicy: "deny_tenant_administration_use_governed_platform_recovery", escalationTargetRoles: ["platform_security_admin", "platform_auditor"], openedAt: now.toISOString() };
    next = put(next, "staffingEscalations", escalationId, escalation);
    escalations.push(escalation);
  }
  return { state: next, impact: { newlyDisabledFeatureIds: newlyDisabled.map((item) => item.featureId), administrativeLockout: !effectiveAdminPrincipalIds(next, tenantId, now).length }, escalations };
}
