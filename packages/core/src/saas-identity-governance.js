const MAX_BOOTSTRAP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EMERGENCY_MS = 4 * 60 * 60 * 1000;

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
  ["access_reviewer", "Access reviewer", "tenant_administration", ["tenant"], "control", ["access.review"]],
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
  ["model_risk_manager", "Model risk manager", "risk", ["tenant"], "control", ["model.approve"]]
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
  pair("finance_maker", "finance_checker", "finance_four_eyes")
]);

export const MINIMUM_LAUNCH_ROLE_COVERAGE = Object.freeze([
  ...PRODUCT_TEMPLATE_REQUIRED_ROLE_IDS,
  "user_admin", "security_admin", "auditor"
]);

export function getCanonicalRole(roleId) {
  return CANONICAL_ROLE_CATALOGUE[required(roleId, "roleId")] ?? fail("saas_role_unknown", `Unknown canonical role: ${roleId}.`);
}

export function validateCanonicalRoles(roleIds) {
  if (!Array.isArray(roleIds) || !roleIds.length) fail("saas_roles_required", "At least one canonical role is required.");
  const unique = [...new Set(roleIds.map((roleId) => required(roleId, "roleId")))];
  for (const roleId of unique) getCanonicalRole(roleId);
  return unique;
}

export function registerSaasPrincipal(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const principalId = required(input?.principalId, "principalId");
  const key = principalKey(tenantId, principalId);
  if (records(state, "saasPrincipals")[key]) fail("saas_principal_exists", "Principal already exists in tenant scope.");
  if (!["invited", "active", "suspended", "inactive"].includes(input.status)) fail("saas_principal_status_invalid", "Principal status is invalid.");
  const principal = {
    tenantId,
    principalId,
    principalType: input.principalType ?? "human",
    displayName: required(input.displayName, "displayName"),
    status: input.status,
    emailVerified: input.emailVerified === true,
    mfaEnrolled: input.mfaEnrolled === true,
    identityEvidenceRef: required(input.identityEvidenceRef, "identityEvidenceRef"),
    createdAt: now.toISOString()
  };
  return { state: put(state, "saasPrincipals", key, principal), principal };
}

export function issueBootstrapOwner(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const principal = sameTenantPrincipal(state, tenantId, input.principalId, { active: true, verified: true });
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
  const principal = sameTenantPrincipal(state, tenantId, input.principalId, { active: true, verified: true });
  if (principal.principalId === ownership.ownerPrincipalId) fail("saas_bootstrap_checker_not_independent", "Bootstrap checker must be independent of the owner.");
  if (!input.authorizedRepresentativeEvidenceRef) fail("saas_bootstrap_checker_evidence_required", "Independent authorized-representative evidence is required.");
  const expiresAt = boundedFuture(input.expiresAt, now, MAX_BOOTSTRAP_MS, "bootstrap checker");
  const grant = trustedBootstrapGrant(tenantId, principal.principalId, "bootstrap_checker", expiresAt, input.authorizedRepresentativeEvidenceRef, now);
  return { state: put(state, "saasRoleGrants", grant.grantId, grant), grant };
}

export function proposeRoleGrant(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const proposedBy = sameTenantPrincipal(state, tenantId, input.proposedBy, { active: true }).principalId;
  const target = sameTenantPrincipal(state, tenantId, input.principalId, { active: true, verified: true });
  if (proposedBy === target.principalId) fail("saas_role_self_grant", "A principal cannot propose their own access.");
  requireAction(state, tenantId, proposedBy, "role.propose", now);
  const roleIds = validateCanonicalRoles(input.roleIds);
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
  const proposedBy = sameTenantPrincipal(state, tenantId, input.proposedBy, { active: true }).principalId;
  requireAction(state, tenantId, proposedBy, "role.propose", now);
  const grantIds = uniqueRequired(input.grantIds, "grantIds");
  const grants = grantIds.map((grantId) => {
    const grant = records(state, "saasRoleGrants")[grantId];
    if (!grant || grant.tenantId !== tenantId || !isActiveGrant(grant, now)) fail("saas_role_grant_inactive", "An active same-tenant grant is required.");
    return grant;
  });
  if (grants.some((grant) => grant.principalId === proposedBy)) fail("saas_role_self_revocation", "A principal cannot propose their own role revocation.");
  assertEffectiveAdminRemains(state, tenantId, now, { revokedGrantIds: new Set(grantIds) });
  const requestId = required(input.requestId, "requestId");
  if (records(state, "saasRoleRequests")[requestId]) fail("saas_role_request_exists", "Role request already exists.");
  const request = { requestId, requestType: "revoke", tenantId, principalId: grants[0].principalId, grantIds, proposedBy, reason: required(input.reason, "reason"), status: "pending", proposedAt: now.toISOString() };
  if (grants.some((grant) => grant.principalId !== request.principalId)) fail("saas_role_revocation_mixed_principals", "One revocation request may affect only one principal.");
  return { state: put(state, "saasRoleRequests", requestId, request), request };
}

export function approveRoleRevocation(state = {}, input, now = new Date()) {
  const request = pendingRequest(state, input, "revoke");
  const approvedBy = independentApprover(state, request, input.approvedBy, now);
  assertEffectiveAdminRemains(state, request.tenantId, now, { revokedGrantIds: new Set(request.grantIds) });
  let next = state;
  const grants = request.grantIds.map((grantId) => {
    const grant = records(next, "saasRoleGrants")[grantId];
    const revoked = { ...grant, status: "revoked", revokedBy: approvedBy, revocationApprovalRef: required(input.approvalRef, "approvalRef"), revokedAt: now.toISOString() };
    next = put(next, "saasRoleGrants", grantId, revoked);
    return revoked;
  });
  const decided = { ...request, status: "approved", approvedBy, approvalRef: input.approvalRef, decidedAt: now.toISOString() };
  return { state: put(next, "saasRoleRequests", request.requestId, decided), request: decided, grants };
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
  const proposedBy = sameTenantPrincipal(state, tenantId, input.proposedBy, { active: true }).principalId;
  const approvedBy = sameTenantPrincipal(state, tenantId, input.approvedBy, { active: true }).principalId;
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
  const target = sameTenantPrincipal(state, tenantId, input.newOwnerPrincipalId, { active: true, verified: true });
  if (target.principalId === ownership.ownerPrincipalId) fail("saas_ownership_transfer_same_owner", "New owner must be different.");
  if (!activeRoleIds(state, tenantId, target.principalId, now).includes("tenant_admin")) fail("saas_ownership_target_not_admin", "New owner must be an active tenant administrator.");
  const requestId = required(input.requestId, "requestId");
  const request = { requestId, tenantId, oldOwnerPrincipalId: ownership.ownerPrincipalId, newOwnerPrincipalId: target.principalId, proposedBy: ownership.ownerPrincipalId, reason: required(input.reason, "reason"), targetAcceptanceRef: required(input.targetAcceptanceRef, "targetAcceptanceRef"), status: "pending", proposedAt: now.toISOString() };
  return { state: put(state, "ownershipTransferRequests", requestId, request), request };
}

export function approveOwnershipTransfer(state = {}, input, now = new Date()) {
  const request = records(state, "ownershipTransferRequests")[input?.requestId];
  if (!request || request.status !== "pending") fail("saas_ownership_transfer_not_pending", "Pending ownership transfer is required.");
  const approvedBy = sameTenantPrincipal(state, request.tenantId, input.approvedBy, { active: true }).principalId;
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
  const requestedBy = sameTenantPrincipal(state, tenantId, input.requestedBy, { active: true, verified: true }).principalId;
  const beneficiary = sameTenantPrincipal(state, tenantId, input.beneficiaryPrincipalId, { active: true, verified: true });
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
  const approvedBy = sameTenantPrincipal(state, request.tenantId, input.approvedBy, { active: true }).principalId;
  if ([request.requestedBy, request.beneficiaryPrincipalId].includes(approvedBy)) fail("saas_emergency_four_eyes", "Independent emergency approval is required.");
  requireAction(state, request.tenantId, approvedBy, "emergency.approve", now);
  const grant = { emergencyGrantId: `emergency:${request.requestId}`, tenantId: request.tenantId, principalId: request.beneficiaryPrincipalId, actions: request.actions, incidentRef: request.incidentRef, status: "active", approvedBy, approvalRef: required(input.approvalRef, "approvalRef"), activatedAt: now.toISOString(), expiresAt: request.expiresAt };
  const decided = { ...request, status: "approved", approvedBy, approvalRef: input.approvalRef, decidedAt: now.toISOString() };
  return { state: put(put(state, "emergencyAccessRequests", request.requestId, decided), "emergencyAccessGrants", grant.emergencyGrantId, grant), request: decided, grant };
}

export function closeEmergencyAccess(state = {}, input, now = new Date()) {
  const grant = records(state, "emergencyAccessGrants")[input?.emergencyGrantId];
  if (!grant || grant.tenantId !== input.tenantId || grant.status !== "active") fail("saas_emergency_grant_inactive", "Active same-tenant emergency grant is required.");
  const closedBy = sameTenantPrincipal(state, grant.tenantId, input.closedBy, { active: true }).principalId;
  const closed = { ...grant, status: "closed", closedBy, closureEvidenceRef: required(input.closureEvidenceRef, "closureEvidenceRef"), closedAt: now.toISOString() };
  return { state: put(state, "emergencyAccessGrants", grant.emergencyGrantId, closed), grant: closed };
}

export function changeSaasPrincipalStatus(state = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId");
  const principal = sameTenantPrincipal(state, tenantId, input.principalId);
  if (!["active", "suspended", "inactive"].includes(input.status)) fail("saas_principal_status_invalid", "Principal status is invalid.");
  if (input.status !== "active") assertEffectiveAdminRemains(state, tenantId, now, { inactivePrincipalIds: new Set([principal.principalId]) });
  const changed = { ...principal, status: input.status, statusReason: required(input.reason, "reason"), statusChangedBy: sameTenantPrincipal(state, tenantId, input.changedBy, { active: true }).principalId, statusChangedAt: now.toISOString() };
  return { state: put(state, "saasPrincipals", principalKey(tenantId, principal.principalId), changed), principal: changed };
}

export function authorizeSaasAction(state = {}, input, now = new Date()) {
  const principal = sameTenantPrincipal(state, input?.tenantId, input?.principalId, { active: true });
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

function pair(left, right, ruleId) { return Object.freeze({ ruleId, roles: Object.freeze([left, right]), enforcement: "hard" }); }
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
function sameTenantPrincipal(state, tenantIdValue, principalIdValue, options = {}) { const tenantId = required(tenantIdValue, "tenantId"), principalId = required(principalIdValue, "principalId"); const principal = records(state, "saasPrincipals")[principalKey(tenantId, principalId)]; if (!principal) { const crossTenant = Object.values(records(state, "saasPrincipals")).some((item) => item.principalId === principalId); fail(crossTenant ? "saas_principal_tenant_mismatch" : "saas_principal_missing", crossTenant ? "Principal belongs to another tenant." : "Principal does not exist in tenant."); } if (options.active && principal.status !== "active") fail("saas_principal_inactive", "Active principal is required."); if (options.verified && (!principal.emailVerified || !principal.mfaEnrolled)) fail("saas_principal_verification_incomplete", "Verified email and MFA are required."); return principal; }
function trustedBootstrapGrant(tenantId, principalId, roleId, expiresAt, evidenceRef, now) { return { grantId: `${roleId}:${tenantId}:${principalId}`, tenantId, principalId, roleId, scope: { type: "tenant", id: tenantId }, status: "active", effectiveFrom: now.toISOString(), validUntil: expiresAt, issuedBy: "trusted_provisioning_boundary", evidenceRef: required(evidenceRef, "verificationRef"), issuedAt: now.toISOString() }; }
function isActiveGrant(grant, now) { return grant?.status === "active" && Date.parse(grant.effectiveFrom) <= now.getTime() && (!grant.validUntil || Date.parse(grant.validUntil) > now.getTime()); }
function scopeMatches(grant, requestedScope) { if (!requestedScope) return true; if (grant.scope.type === "tenant") return true; return grant.scope.type === requestedScope.type && grant.scope.id === requestedScope.id; }
function activeRoleIds(state, tenantId, principalId, now, requestedScope) { return [...new Set(Object.values(records(state, "saasRoleGrants")).filter((grant) => grant.tenantId === tenantId && grant.principalId === principalId && isActiveGrant(grant, now) && scopeMatches(grant, requestedScope)).map((grant) => grant.roleId))]; }
function activePrincipalsForRole(state, tenantId, roleId, now) { return activeTenantPrincipals(state, tenantId).filter((principal) => activeRoleIds(state, tenantId, principal.principalId, now).includes(roleId)).map((principal) => principal.principalId); }
function findSodViolations(roleIds) { const roles = new Set(roleIds); return SEGREGATION_OF_DUTIES_RULES.filter((rule) => rule.roles.every((role) => roles.has(role))); }
function validateNoSodConflict(state, tenantId, principalId, proposedRoles, now) { const allRoles = [...activeRoleIds(state, tenantId, principalId, now), ...proposedRoles]; const violations = findSodViolations(allRoles); if (violations.length) fail("saas_role_sod_conflict", `Segregation-of-duties conflict: ${violations.map((item) => item.ruleId).join(", ")}.`); }
function requireAction(state, tenantId, principalId, action, now) { const authorization = authorizeSaasAction(state, { tenantId, principalId, action }, now); if (authorization.outcome !== "allow") fail("saas_action_forbidden", `${action} is not granted.`); return authorization; }
function pendingRequest(state, input, requestType) { const request = records(state, "saasRoleRequests")[input?.requestId]; if (!request || request.status !== "pending" || request.requestType !== requestType) fail("saas_role_request_not_pending", `Pending ${requestType} request is required.`); if (input.tenantId !== request.tenantId) fail("saas_role_tenant_mismatch", "Role request belongs to another tenant."); return request; }
function independentApprover(state, request, approvedByValue, now) { const approvedBy = sameTenantPrincipal(state, request.tenantId, approvedByValue, { active: true }).principalId; if ([request.proposedBy, request.principalId].includes(approvedBy)) fail("saas_role_four_eyes_required", "Approver must be independent of proposer and target principal."); requireAction(state, request.tenantId, approvedBy, "role.approve", now); return approvedBy; }
function independentCoverage(coverage, left, right) { const leftIds = coverage[left] ?? [], rightIds = coverage[right] ?? []; return { roles: [left, right], independent: leftIds.some((leftId) => rightIds.some((rightId) => leftId !== rightId)) }; }
function effectiveAdminPrincipalIds(state, tenantId, now, options = {}) { const revoked = options.revokedGrantIds ?? new Set(), inactive = options.inactivePrincipalIds ?? new Set(); return activeTenantPrincipals(state, tenantId).filter((principal) => !inactive.has(principal.principalId)).filter((principal) => Object.values(records(state, "saasRoleGrants")).some((grant) => grant.tenantId === tenantId && grant.principalId === principal.principalId && !revoked.has(grant.grantId) && isActiveGrant(grant, now) && ["tenant_admin", "user_admin"].includes(grant.roleId))).map((principal) => principal.principalId); }
function assertEffectiveAdminRemains(state, tenantId, now, options) { if (!effectiveAdminPrincipalIds(state, tenantId, now, options).length) fail("saas_last_effective_admin", "Operation would remove the last effective tenant or user administrator."); }
