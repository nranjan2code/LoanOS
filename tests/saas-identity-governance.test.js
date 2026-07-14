import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOTSTRAP_OWNER_ACTIONS,
  CANONICAL_ROLE_CATALOGUE,
  MINIMUM_LAUNCH_ROLE_COVERAGE,
  PRODUCT_TEMPLATE_REQUIRED_ROLE_IDS,
  approveEmergencyAccess,
  approveOwnershipTransfer,
  approveRoleGrant,
  approveRoleRevocation,
  assessFeatureStaffingReadiness,
  assessMinimumLaunchCoverage,
  authorizeStaffedFeatureAction,
  authorizeSaasAction,
  changeSaasPrincipalStatus,
  closeEmergencyAccess,
  completeBootstrapTransition,
  configureTenantFeatureStaffing,
  getCanonicalRole,
  issueBootstrapChecker,
  issueBootstrapOwner,
  projectPrincipalAccess,
  proposeRoleGrant,
  proposeRoleRevocation,
  registerSaasPrincipal,
  requestEmergencyAccess,
  requestOwnershipTransfer,
  validateCanonicalRoles
} from "../packages/core/src/saas-identity-governance.js";

const NOW = new Date("2026-07-15T10:00:00.000Z");
const FUTURE = "2026-07-20T10:00:00.000Z";

function addPrincipal(state, principalId, { tenantId = "tenant-a", status = "active", verified = true } = {}) {
  return registerSaasPrincipal(state, { tenantId, principalId, displayName: principalId, status, emailVerified: verified, mfaEnrolled: verified, identityEvidenceRef: `identity/${principalId}` }, NOW).state;
}

function bootstrap(principalIds = ["owner", "bootstrap-checker", "admin", "access-reviewer", "security", "audit", "credit-maker", "credit-checker", "ops-maker", "ops-checker", "product", "compliance"]) {
  let state = {};
  state = addPrincipal(state, "owner");
  state = issueBootstrapOwner(state, { tenantId: "tenant-a", principalId: "owner", verificationRef: "verification/owner", expiresAt: FUTURE }, NOW).state;
  for (const principalId of principalIds.filter((item) => item !== "owner")) state = addPrincipal(state, principalId);
  state = issueBootstrapChecker(state, { tenantId: "tenant-a", principalId: "bootstrap-checker", authorizedRepresentativeEvidenceRef: "verification/checker", expiresAt: FUTURE }, NOW).state;
  return state;
}

function grant(state, requestId, principalId, roleIds, proposedBy = "owner", approvedBy = "bootstrap-checker", scope = { type: "tenant", id: "tenant-a" }) {
  state = proposeRoleGrant(state, { requestId, tenantId: "tenant-a", principalId, roleIds, scope, proposedBy, reason: `assign ${roleIds.join(",")}` }, NOW).state;
  return approveRoleGrant(state, { requestId, tenantId: "tenant-a", approvedBy, approvalRef: `approval/${requestId}` }, NOW).state;
}

function launchReadyState() {
  let state = bootstrap();
  state = grant(state, "g-admin", "admin", ["tenant_admin", "user_admin"]);
  state = grant(state, "g-access-reviewer", "access-reviewer", ["access_reviewer"]);
  state = grant(state, "g-security", "security", ["security_admin"]);
  state = grant(state, "g-audit", "audit", ["auditor"]);
  state = grant(state, "g-credit-maker", "credit-maker", ["credit_maker"]);
  state = grant(state, "g-credit-checker", "credit-checker", ["credit_checker"]);
  state = grant(state, "g-ops-maker", "ops-maker", ["operations_maker"]);
  state = grant(state, "g-ops-checker", "ops-checker", ["operations_checker"]);
  state = grant(state, "g-product", "product", ["product_manager"]);
  state = grant(state, "g-compliance", "compliance", ["compliance_officer"]);
  return state;
}

test("canonical catalogue contains exact product-template roles with stable metadata and rejects unknown roles", () => {
  assert.deepEqual(PRODUCT_TEMPLATE_REQUIRED_ROLE_IDS, ["tenant_admin", "product_manager", "credit_maker", "credit_checker", "operations_maker", "operations_checker", "compliance_officer"]);
  for (const roleId of PRODUCT_TEMPLATE_REQUIRED_ROLE_IDS) {
    assert.equal(getCanonicalRole(roleId).roleId, roleId);
    assert.ok(getCanonicalRole(roleId).scopes.includes("tenant"));
  }
  assert.equal(CANONICAL_ROLE_CATALOGUE.platform_security_admin.domain, "platform");
  assert.deepEqual(CANONICAL_ROLE_CATALOGUE.platform_security_admin.scopes, ["platform"]);
  assert.deepEqual(validateCanonicalRoles(["tenant_admin", "tenant_admin"]), ["tenant_admin"]);
  assert.throws(() => validateCanonicalRoles(["tenant_admin", "typo_admin"]), { code: "saas_role_unknown" });
});

test("first verified organisation user receives only expiring bootstrap actions and second checker is independent", () => {
  let state = {};
  state = addPrincipal(state, "owner");
  const issued = issueBootstrapOwner(state, { tenantId: "tenant-a", principalId: "owner", verificationRef: "ar/1", expiresAt: FUTURE }, NOW);
  state = issued.state;
  assert.equal(issued.ownership.status, "bootstrap");
  assert.deepEqual(BOOTSTRAP_OWNER_ACTIONS, getCanonicalRole("bootstrap_owner").allowedActions);
  assert.equal(authorizeSaasAction(state, { tenantId: "tenant-a", principalId: "owner", action: "user.invite" }, NOW).outcome, "allow");
  assert.equal(authorizeSaasAction(state, { tenantId: "tenant-a", principalId: "owner", action: "role.approve" }, NOW).outcome, "deny");
  assert.equal(authorizeSaasAction(state, { tenantId: "tenant-a", principalId: "owner", action: "user.invite" }, new Date("2026-07-21T10:00:00Z")).outcome, "deny");
  state = addPrincipal(state, "checker");
  assert.throws(() => issueBootstrapChecker(state, { tenantId: "tenant-a", principalId: "owner", authorizedRepresentativeEvidenceRef: "ar/2", expiresAt: FUTURE }, NOW), { code: "saas_bootstrap_checker_not_independent" });
  assert.equal(issueBootstrapChecker(state, { tenantId: "tenant-a", principalId: "checker", authorizedRepresentativeEvidenceRef: "ar/2", expiresAt: FUTURE }, NOW).grant.roleId, "bootstrap_checker");
});

test("bootstrap owner must be the first active verified principal and temporary duration is bounded", () => {
  let state = addPrincipal({}, "owner", { verified: false });
  assert.throws(() => issueBootstrapOwner(state, { tenantId: "tenant-a", principalId: "owner", verificationRef: "ar/1", expiresAt: FUTURE }, NOW), { code: "saas_principal_verification_incomplete" });
  state = addPrincipal({}, "owner");
  state = addPrincipal(state, "other");
  assert.throws(() => issueBootstrapOwner(state, { tenantId: "tenant-a", principalId: "owner", verificationRef: "ar/1", expiresAt: FUTURE }, NOW), { code: "saas_bootstrap_owner_not_first" });
  state = addPrincipal({}, "owner");
  assert.throws(() => issueBootstrapOwner(state, { tenantId: "tenant-a", principalId: "owner", verificationRef: "ar/1", expiresAt: "2026-08-01T00:00:00Z" }, NOW), { code: "saas_temporary_grant_duration_invalid" });
});

test("role grant is same-tenant maker-checker and unknown, self, cross-tenant, scope and SoD access fail closed", () => {
  let state = bootstrap(["owner", "bootstrap-checker", "target"]);
  state = addPrincipal(state, "foreign", { tenantId: "tenant-b" });
  assert.throws(() => proposeRoleGrant(state, { requestId: "unknown", tenantId: "tenant-a", principalId: "target", roleIds: ["made_up"], proposedBy: "owner", reason: "bad" }, NOW), { code: "saas_role_unknown" });
  assert.throws(() => proposeRoleGrant(state, { requestId: "self", tenantId: "tenant-a", principalId: "owner", roleIds: ["tenant_admin"], proposedBy: "owner", reason: "bad" }, NOW), { code: "saas_role_self_grant" });
  assert.throws(() => proposeRoleGrant(state, { requestId: "foreign", tenantId: "tenant-a", principalId: "foreign", roleIds: ["tenant_admin"], proposedBy: "owner", reason: "bad" }, NOW), { code: "saas_principal_tenant_mismatch" });
  assert.throws(() => proposeRoleGrant(state, { requestId: "scope", tenantId: "tenant-a", principalId: "target", roleIds: ["journey_admin"], scope: { type: "tenant", id: "tenant-a" }, proposedBy: "owner", reason: "bad" }, NOW), { code: "saas_role_scope_invalid" });
  state = proposeRoleGrant(state, { requestId: "maker", tenantId: "tenant-a", principalId: "target", roleIds: ["credit_maker"], proposedBy: "owner", reason: "maker" }, NOW).state;
  assert.throws(() => approveRoleGrant(state, { requestId: "maker", tenantId: "tenant-a", approvedBy: "owner", approvalRef: "same" }, NOW), { code: "saas_role_four_eyes_required" });
  state = approveRoleGrant(state, { requestId: "maker", tenantId: "tenant-a", approvedBy: "bootstrap-checker", approvalRef: "approval/maker" }, NOW).state;
  assert.throws(() => proposeRoleGrant(state, { requestId: "checker", tenantId: "tenant-a", principalId: "target", roleIds: ["credit_checker"], proposedBy: "owner", reason: "conflict" }, NOW), { code: "saas_role_sod_conflict" });
});

test("minimum launch coverage requires every template/admin role, independent pairs and three principals", () => {
  const incomplete = assessMinimumLaunchCoverage(bootstrap(), "tenant-a", NOW);
  assert.equal(incomplete.ready, false);
  assert.deepEqual(incomplete.missingRoles, MINIMUM_LAUNCH_ROLE_COVERAGE);
  const state = launchReadyState();
  const ready = assessMinimumLaunchCoverage(state, "tenant-a", NOW);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missingRoles, []);
  assert.ok(ready.distinctPrincipalIds.length >= 3);
  assert.ok(ready.independentPairs.every((item) => item.independent));
});

test("bootstrap transition requires readiness and reduces temporary authority to accountable ownership", () => {
  let state = bootstrap();
  assert.throws(() => completeBootstrapTransition(state, { tenantId: "tenant-a", proposedBy: "owner", approvedBy: "bootstrap-checker", approvalRef: "launch/1" }, NOW), { code: "saas_launch_role_coverage_incomplete" });
  state = launchReadyState();
  const result = completeBootstrapTransition(state, { tenantId: "tenant-a", proposedBy: "owner", approvedBy: "admin", approvalRef: "launch/1" }, NOW);
  assert.equal(result.ownership.status, "active");
  assert.equal(result.ownerGrant.roleId, "tenant_owner");
  const access = projectPrincipalAccess(result.state, "tenant-a", "owner", NOW);
  assert.deepEqual(access.roleIds, ["tenant_owner"]);
  assert.equal(authorizeSaasAction(result.state, { tenantId: "tenant-a", principalId: "owner", action: "user.invite" }, NOW).outcome, "deny");

  let activeState = addPrincipal(result.state, "new-operator");
  activeState = proposeRoleGrant(activeState, { requestId: "post-bootstrap-role", tenantId: "tenant-a", principalId: "new-operator", roleIds: ["operator"], proposedBy: "admin", reason: "operations access" }, NOW).state;
  assert.throws(() => approveRoleGrant(activeState, { requestId: "post-bootstrap-role", tenantId: "tenant-a", approvedBy: "security", approvalRef: "approval/wrong" }, NOW), { code: "saas_action_forbidden" });
  const approved = approveRoleGrant(activeState, { requestId: "post-bootstrap-role", tenantId: "tenant-a", approvedBy: "access-reviewer", approvalRef: "approval/access-reviewer" }, NOW);
  assert.equal(approved.grants[0].roleId, "operator");
});

test("revocation is independently approved, takes effect immediately, and escalates administrative lockout", () => {
  let state = launchReadyState();
  state = configureTenantFeatureStaffing(state, { tenantId: "tenant-a", features: [{ featureId: "FST-001", requestedStatus: "enabled" }], proposedBy: "owner", approvedBy: "bootstrap-checker", approvalRef: "approval/staffing", reason: "enable IAM" }, NOW).state;
  const adminAccess = projectPrincipalAccess(state, "tenant-a", "admin", NOW);
  const userAdminGrant = adminAccess.activeGrants.find((item) => item.roleId === "user_admin");
  const tenantAdminGrant = adminAccess.activeGrants.find((item) => item.roleId === "tenant_admin");
  state = proposeRoleRevocation(state, { requestId: "revoke-both", tenantId: "tenant-a", grantIds: [userAdminGrant.grantId, tenantAdminGrant.grantId], proposedBy: "owner", reason: "compromise containment" }, NOW).state;
  assert.throws(() => approveRoleRevocation(state, { requestId: "revoke-both", tenantId: "tenant-a", approvedBy: "owner", approvalRef: "same" }, NOW), { code: "saas_role_four_eyes_required" });
  const revoked = approveRoleRevocation(state, { requestId: "revoke-both", tenantId: "tenant-a", approvedBy: "bootstrap-checker", approvalRef: "approval/revoke" }, NOW);
  assert.ok(revoked.grants.every((item) => item.status === "revoked"));
  assert.equal(revoked.staffingImpact.administrativeLockout, true);
  assert.ok(revoked.escalations.some((item) => item.featureId === "administrative_lockout"));
  assert.equal(assessFeatureStaffingReadiness(revoked.state, { tenantId: "tenant-a", featureId: "FST-001" }, NOW).ready, false);
});

test("suspension contains access immediately and pauses affected control-plane work", () => {
  let state = launchReadyState();
  state = configureTenantFeatureStaffing(state, { tenantId: "tenant-a", features: [{ featureId: "FST-001", requestedStatus: "enabled" }], proposedBy: "owner", approvedBy: "bootstrap-checker", approvalRef: "approval/staffing", reason: "enable IAM" }, NOW).state;
  const result = changeSaasPrincipalStatus(state, { tenantId: "tenant-a", principalId: "admin", status: "suspended", reason: "investigation", evidenceRef: "incident/1", changedBy: "security" }, NOW);
  assert.equal(result.principal.status, "suspended");
  assert.throws(() => authorizeSaasAction(result.state, { tenantId: "tenant-a", principalId: "admin", action: "user.manage" }, NOW), { code: "saas_principal_inactive" });
  assert.equal(result.staffingImpact.administrativeLockout, true);
});

test("staffing policy counts only distinct verified humans and agents cannot fill human controls", () => {
  let state = launchReadyState();
  state = configureTenantFeatureStaffing(state, { tenantId: "tenant-a", features: [{ featureId: "FST-003", requestedStatus: "enabled" }], proposedBy: "owner", approvedBy: "bootstrap-checker", approvalRef: "approval/credit", reason: "enable credit" }, NOW).state;
  const readiness = assessFeatureStaffingReadiness(state, { tenantId: "tenant-a", featureId: "FST-003" }, NOW);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.includes("missing_role_set:loan_officer"));
  state = addPrincipal(state, "loan-officer");
  state = grant(state, "g-loan-officer", "loan-officer", ["loan_officer"]);
  assert.equal(assessFeatureStaffingReadiness(state, { tenantId: "tenant-a", featureId: "FST-003" }, NOW).ready, true);
  assert.equal(authorizeStaffedFeatureAction(state, { tenantId: "tenant-a", featureId: "FST-003", principalId: "credit-checker", requiredRoleId: "credit_checker" }, NOW).outcome, "allow");

  const agent = registerSaasPrincipal(state, { tenantId: "tenant-a", principalId: "agent-1", principalType: "dynamic_agent", displayName: "Credit helper", status: "active", sponsorPrincipalId: "admin", agentDefinitionRef: "agent/credit-helper/v1", modelRef: "model/credit-helper/v1", workloadIdentityRef: "spiffe://tenant-a/agent-1", workloadIdentityVerified: true, identityEvidenceRef: "workload/agent-1", expiresAt: "2026-07-15T20:00:00.000Z" }, NOW);
  assert.throws(() => proposeRoleGrant(agent.state, { requestId: "agent-human-role", tenantId: "tenant-a", principalId: "agent-1", roleIds: ["credit_checker"], proposedBy: "owner", reason: "bad" }, NOW), { code: "saas_agent_role_forbidden" });
});

test("emergency access is limited, independently approved, time-bounded, auditable and does not create a role", () => {
  let state = launchReadyState();
  assert.throws(() => requestEmergencyAccess(state, { requestId: "e-bad", tenantId: "tenant-a", requestedBy: "credit-maker", beneficiaryPrincipalId: "credit-maker", actions: ["role.approve"], incidentRef: "inc/1", reason: "bad", expiresAt: "2026-07-15T12:00:00Z" }, NOW), { code: "saas_emergency_action_forbidden" });
  state = requestEmergencyAccess(state, { requestId: "e-1", tenantId: "tenant-a", requestedBy: "credit-maker", beneficiaryPrincipalId: "credit-maker", actions: ["security.contain", "audit.read"], incidentRef: "inc/1", reason: "cyber incident", expiresAt: "2026-07-15T12:00:00Z" }, NOW).state;
  assert.throws(() => approveEmergencyAccess(state, { requestId: "e-1", approvedBy: "credit-maker", approvalRef: "approval/e" }, NOW), { code: "saas_emergency_four_eyes" });
  const approved = approveEmergencyAccess(state, { requestId: "e-1", approvedBy: "security", approvalRef: "approval/e" }, NOW);
  state = approved.state;
  assert.equal(authorizeSaasAction(state, { tenantId: "tenant-a", principalId: "credit-maker", action: "security.contain" }, NOW).reason, "active_emergency_grant");
  assert.ok(!projectPrincipalAccess(state, "tenant-a", "credit-maker", NOW).roleIds.includes("security_admin"));
  const closed = closeEmergencyAccess(state, { tenantId: "tenant-a", emergencyGrantId: approved.grant.emergencyGrantId, closedBy: "security", closureEvidenceRef: "incident/closure" }, NOW);
  assert.equal(authorizeSaasAction(closed.state, { tenantId: "tenant-a", principalId: "credit-maker", action: "security.contain" }, NOW).outcome, "deny");
});

test("ownership transfer requires current owner proposal, target acceptance and independent admin approval", () => {
  let state = launchReadyState();
  state = addPrincipal(state, "new-owner");
  state = grant(state, "g-new-owner", "new-owner", ["tenant_admin"]);
  state = completeBootstrapTransition(state, { tenantId: "tenant-a", proposedBy: "owner", approvedBy: "admin", approvalRef: "launch/1" }, NOW).state;
  assert.throws(() => requestOwnershipTransfer(state, { requestId: "ot-bad", tenantId: "tenant-a", newOwnerPrincipalId: "new-owner", proposedBy: "admin", reason: "succession", targetAcceptanceRef: "accept/1" }, NOW), { code: "saas_ownership_transfer_forbidden" });
  state = requestOwnershipTransfer(state, { requestId: "ot-1", tenantId: "tenant-a", newOwnerPrincipalId: "new-owner", proposedBy: "owner", reason: "succession", targetAcceptanceRef: "accept/1" }, NOW).state;
  assert.throws(() => approveOwnershipTransfer(state, { requestId: "ot-1", approvedBy: "new-owner", approvalRef: "approval/ot" }, NOW), { code: "saas_ownership_transfer_four_eyes" });
  const transferred = approveOwnershipTransfer(state, { requestId: "ot-1", approvedBy: "security", approvalRef: "approval/ot" }, NOW);
  assert.equal(transferred.ownership.ownerPrincipalId, "new-owner");
  assert.equal(transferred.grant.roleId, "tenant_owner");
});
