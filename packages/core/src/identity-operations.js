import { createHash } from "node:crypto";
import { projectTenantFeatureStaffing } from "./saas-identity-governance.js";

const MIN_KEY_OVERLAP_MS = 60 * 60 * 1000;
const MAX_KEY_OVERLAP_MS = 14 * 24 * 60 * 60 * 1000;

export function proposeFederationRotation(state = {}, input = {}, now = new Date()) {
  required(input.requestId, "requestId"); required(input.policyId, "policyId"); required(input.proposedBy, "proposedBy"); required(input.reason, "reason");
  required(input.proposedMetadata, "proposedMetadata");
  const policy = state.federationPolicies?.[input.policyId];
  if (!policy) fail("identity_rotation_policy_missing", "Federation policy was not found.");
  if (policy.status !== "active") fail("identity_rotation_policy_inactive", "Only an active federation policy can be rotated.");
  if (state.federationRotationRequests?.[input.requestId]) fail("identity_rotation_request_exists", "Rotation request already exists.");
  const overlapStartsAt = iso(input.overlapStartsAt, "overlapStartsAt");
  const overlapEndsAt = iso(input.overlapEndsAt, "overlapEndsAt");
  const overlapMs = Date.parse(overlapEndsAt) - Date.parse(overlapStartsAt);
  if (overlapMs < MIN_KEY_OVERLAP_MS || overlapMs > MAX_KEY_OVERLAP_MS) fail("identity_rotation_overlap_invalid", "Signing-key overlap must be between one hour and fourteen days.");
  const proposedMetadataValidUntil = iso(input.proposedMetadataValidUntil, "proposedMetadataValidUntil");
  if (Date.parse(proposedMetadataValidUntil) <= now.getTime()) fail("identity_rotation_metadata_expired", "Proposed federation metadata must remain valid after approval.");
  const request = Object.freeze({ requestId: input.requestId, tenantId: input.tenantId, policyId: input.policyId, proposedMetadataChecksumSha256: sha256(input.proposedMetadata), proposedMetadataValidUntil, proposedSigningKeyIds: unique(input.proposedSigningKeyIds), overlapStartsAt, overlapEndsAt, reason: input.reason, status: "pending", proposedBy: input.proposedBy, proposedAt: now.toISOString() });
  if (!request.proposedSigningKeyIds.length) fail("identity_rotation_keys_missing", "At least one proposed signing key is required.");
  return { state: { ...state, federationRotationRequests: { ...(state.federationRotationRequests ?? {}), [request.requestId]: request } }, request };
}

export function approveFederationRotation(state = {}, input = {}, now = new Date()) {
  const request = state.federationRotationRequests?.[input.requestId];
  if (!request || request.status !== "pending") fail("identity_rotation_request_not_pending", "A pending rotation request is required.");
  required(input.approvedBy, "approvedBy"); required(input.approvalRef, "approvalRef"); required(input.conformanceEvidenceRef, "conformanceEvidenceRef");
  if (request.proposedBy === input.approvedBy) fail("identity_rotation_four_eyes_required", "Rotation proposer and approver must be different users.");
  const policy = state.federationPolicies?.[request.policyId];
  if (!policy) fail("identity_rotation_policy_missing", "Federation policy was not found.");
  const decided = Object.freeze({ ...request, status: "approved", approvedBy: input.approvedBy, approvalRef: input.approvalRef, conformanceEvidenceRef: input.conformanceEvidenceRef, decidedAt: now.toISOString() });
  const rotated = Object.freeze({ ...policy, previousMetadataChecksumSha256: policy.metadataChecksumSha256 ?? null, metadataChecksumSha256: request.proposedMetadataChecksumSha256, metadataValidUntil: request.proposedMetadataValidUntil, previousSigningKeyIds: policy.signingKeyIds ?? [], signingKeyIds: request.proposedSigningKeyIds, signingKeyOverlap: { startsAt: request.overlapStartsAt, endsAt: request.overlapEndsAt }, lastRotatedAt: now.toISOString(), lastRotationRequestId: request.requestId, status: "active" });
  return { state: { ...state, federationPolicies: { ...state.federationPolicies, [policy.policyId]: rotated }, federationRotationRequests: { ...state.federationRotationRequests, [request.requestId]: decided } }, request: decided, policy: rotated };
}

export function suspendFederationPolicy(state = {}, input = {}, now = new Date()) {
  required(input.policyId, "policyId"); required(input.suspendedBy, "suspendedBy"); required(input.reason, "reason"); required(input.evidenceRef, "evidenceRef");
  const policy = state.federationPolicies?.[input.policyId];
  if (!policy) fail("identity_federation_policy_missing", "Federation policy was not found.");
  const suspended = Object.freeze({ ...policy, status: "suspended", suspendedAt: now.toISOString(), suspendedBy: input.suspendedBy, suspensionReason: input.reason, suspensionEvidenceRef: input.evidenceRef });
  const affectedUserIds = Object.values(state.users ?? {}).filter((user) => user.federationPolicyId === input.policyId && user.status === "active").map((user) => user.userId);
  return { state: { ...state, federationPolicies: { ...state.federationPolicies, [policy.policyId]: suspended } }, policy: suspended, affectedUserIds };
}

export function revokePrincipalSessions(sessions = {}, input = {}, now = new Date()) {
  required(input.tenantId, "tenantId"); required(input.userId, "userId"); required(input.revokedBy, "revokedBy"); required(input.reason, "reason");
  const revokedSessionIds = [];
  const next = Object.fromEntries(Object.entries(sessions).map(([id, session]) => {
    if (session.tenantId !== input.tenantId || session.userId !== input.userId || session.status !== "active") return [id, session];
    revokedSessionIds.push(id);
    return [id, { ...session, status: "revoked", revokedAt: now.toISOString(), revokedBy: input.revokedBy, revocationReason: input.reason }];
  }));
  return { sessions: next, revokedSessionIds };
}

export function proposeAuthenticatorRecovery(state = {}, input = {}, now = new Date()) {
  required(input.requestId, "requestId"); required(input.tenantId, "tenantId"); required(input.principalId, "principalId"); required(input.proposedBy, "proposedBy"); required(input.identityEvidenceRef, "identityEvidenceRef"); required(input.reason, "reason");
  if (!state.users?.[input.principalId]) fail("identity_recovery_principal_missing", "Recovery principal was not found.");
  if (state.authenticatorRecoveryRequests?.[input.requestId]) fail("identity_recovery_request_exists", "Recovery request already exists.");
  const request = Object.freeze({ requestId: input.requestId, tenantId: input.tenantId, principalId: input.principalId, proposedBy: input.proposedBy, identityEvidenceRef: input.identityEvidenceRef, reason: input.reason, status: "pending", proposedAt: now.toISOString() });
  return { state: { ...state, authenticatorRecoveryRequests: { ...(state.authenticatorRecoveryRequests ?? {}), [request.requestId]: request } }, request };
}

export function approveAuthenticatorRecovery(state = {}, input = {}, now = new Date()) {
  const request = state.authenticatorRecoveryRequests?.[input.requestId];
  if (!request || request.status !== "pending") fail("identity_recovery_request_not_pending", "A pending recovery request is required.");
  required(input.approvedBy, "approvedBy"); required(input.approvalRef, "approvalRef");
  if (request.proposedBy === input.approvedBy || request.principalId === input.approvedBy) fail("identity_recovery_four_eyes_required", "Recovery requires an independent approver who is not the subject.");
  const user = state.users?.[request.principalId];
  if (!user) fail("identity_recovery_principal_missing", "Recovery principal was not found.");
  const decided = Object.freeze({ ...request, status: "approved", approvedBy: input.approvedBy, approvalRef: input.approvalRef, decidedAt: now.toISOString() });
  const recoveredUser = { ...user, mfaRequired: true, mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, requiredAction: "mfa_setup", authenticatorResetAt: now.toISOString(), authenticatorResetBy: input.approvedBy };
  return { state: { ...state, users: { ...state.users, [request.principalId]: recoveredUser }, authenticatorRecoveryRequests: { ...state.authenticatorRecoveryRequests, [request.requestId]: decided } }, request: decided, user: recoveredUser };
}

export function reconcileFederatedDirectory(state = {}, input = {}, now = new Date()) {
  required(input.reconciliationId, "reconciliationId"); required(input.tenantId, "tenantId"); required(input.policyId, "policyId"); required(input.executedBy, "executedBy"); required(input.sourceEvidenceRef, "sourceEvidenceRef");
  const source = Array.isArray(input.sourceUsers) ? input.sourceUsers : [];
  const local = Object.values(state.users ?? {}).filter((user) => user.federationPolicyId === input.policyId);
  const sourceByExternalId = new Map(source.map((user) => [String(user.externalId), user]));
  const localByExternalId = new Map(local.map((user) => [String(user.federationExternalId), user]));
  const missingLocally = source.filter((user) => !localByExternalId.has(String(user.externalId))).map((user) => String(user.externalId));
  const missingAtProvider = local.filter((user) => !sourceByExternalId.has(String(user.federationExternalId))).map((user) => user.userId);
  const statusMismatches = local.filter((user) => { const remote = sourceByExternalId.get(String(user.federationExternalId)); return remote && Boolean(remote.active) !== (user.status === "active"); }).map((user) => user.userId);
  const forbiddenRolePushes = source.filter((user) => Array.isArray(user.roles) && user.roles.length).map((user) => String(user.externalId));
  const summary = { missingLocally, missingAtProvider, statusMismatches, forbiddenRolePushes };
  const record = Object.freeze({ reconciliationId: input.reconciliationId, tenantId: input.tenantId, policyId: input.policyId, sourceEvidenceRef: input.sourceEvidenceRef, executedBy: input.executedBy, executedAt: now.toISOString(), sourceCount: source.length, localCount: local.length, status: Object.values(summary).every((items) => items.length === 0) ? "reconciled" : "needs_attention", ...summary, evidenceChecksumSha256: sha256(summary) });
  return { state: { ...state, directoryReconciliations: { ...(state.directoryReconciliations ?? {}), [record.reconciliationId]: record } }, reconciliation: record };
}

export function projectIdentityOperationalReadiness(state = {}, input = {}, now = new Date()) {
  const tenantId = input.tenantId;
  const users = Object.values(state.users ?? {});
  const policies = Object.values(state.federationPolicies ?? {});
  const sessions = Object.values(input.sessions ?? {}).filter((session) => session.tenantId === tenantId && session.status === "active" && Date.parse(session.expiresAt) > now.getTime());
  const campaigns = Object.values(state.identityConformanceCampaigns ?? {});
  const requiredFamilies = input.requiredFamilies ?? [];
  const certifiedFamilies = new Set(campaigns.filter((item) => item.status === "simulator_certified").map((item) => item.family));
  const blockers = [];
  if (!users.some((user) => user.status === "active" && user.mfaEnabled)) blockers.push("no_active_mfa_user");
  if (policies.some((policy) => policy.status === "suspended")) blockers.push("federation_policy_suspended");
  for (const family of requiredFamilies) if (!certifiedFamilies.has(family)) blockers.push(`simulator_conformance_missing:${family}`);
  const staffing = projectTenantFeatureStaffing(state, tenantId);
  if (staffing.features?.some((feature) => feature.requestedStatus === "enabled" && !feature.ready)) blockers.push("enabled_feature_understaffed");
  const pending = {
    rotations: Object.values(state.federationRotationRequests ?? {}).filter((item) => item.status === "pending").length,
    recoveries: Object.values(state.authenticatorRecoveryRequests ?? {}).filter((item) => item.status === "pending").length,
    roleRequests: Object.values(state.saasRoleRequests ?? {}).filter((item) => item.status === "pending").length,
    escalations: Object.values(state.staffingEscalations ?? {}).filter((item) => item.status === "open").length
  };
  return Object.freeze({ tenantId, generatedAt: now.toISOString(), status: blockers.length ? "needs_attention" : "ready_for_simulated_operations", commerciallyLive: false, blockers, users: { total: users.length, active: users.filter((user) => user.status === "active").length, federated: users.filter((user) => user.authenticationSource === "federated").length }, sessions: { active: sessions.length }, federation: { policies: policies.length, active: policies.filter((item) => item.status === "active").length, suspended: policies.filter((item) => item.status === "suspended").length }, conformance: { requiredFamilies, simulatorCertifiedFamilies: [...certifiedFamilies].sort() }, pending, staffing });
}

function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("identity_operations_input_invalid", `${field} is required.`); }
function iso(value, field) { const time = Date.parse(value); if (!Number.isFinite(time)) fail("identity_operations_input_invalid", `${field} must be an ISO date-time.`); return new Date(time).toISOString(); }
function unique(values) { return [...new Set(Array.isArray(values) ? values.map(String).filter(Boolean) : [])].sort(); }
function sha256(value) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value ?? null)).digest("hex"); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
