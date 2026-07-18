import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  approveAuthenticatorRecovery,
  approveFederationRotation,
  projectIdentityOperationalReadiness,
  proposeAuthenticatorRecovery,
  proposeFederationRotation,
  reconcileFederatedDirectory,
  revokePrincipalSessions,
  suspendFederationPolicy
} from "@loanos/core";

const now = new Date("2026-07-15T10:00:00.000Z");
const base = () => ({
  federationPolicies: { idp: { policyId: "idp", status: "active", metadataChecksumSha256: "old", signingKeyIds: ["old-key"] } },
  users: { u1: { userId: "u1", status: "active", mfaEnabled: true, authenticationSource: "federated", federationPolicyId: "idp", federationExternalId: "external-1" } }
});

test("federation rotation is maker-checker and preserves an explicit key overlap", () => {
  const proposed = proposeFederationRotation(base(), { requestId: "rot-1", tenantId: "tenant-a", policyId: "idp", proposedBy: "maker", reason: "scheduled", proposedMetadata: "metadata-v2", proposedMetadataValidUntil: "2026-12-01T00:00:00Z", proposedSigningKeyIds: ["new-key"], overlapStartsAt: "2026-07-15T11:00:00Z", overlapEndsAt: "2026-07-16T11:00:00Z" }, now);
  assert.throws(() => approveFederationRotation(proposed.state, { requestId: "rot-1", approvedBy: "maker", approvalRef: "A", conformanceEvidenceRef: "C" }), /different/);
  const approved = approveFederationRotation(proposed.state, { requestId: "rot-1", approvedBy: "checker", approvalRef: "CAB-1", conformanceEvidenceRef: "camp-1" }, now);
  assert.equal(approved.policy.status, "active");
  assert.deepEqual(approved.policy.previousSigningKeyIds, ["old-key"]);
  assert.deepEqual(approved.policy.signingKeyIds, ["new-key"]);
});

test("emergency federation suspension and direct revocation immediately stop sessions", () => {
  const suspended = suspendFederationPolicy(base(), { policyId: "idp", suspendedBy: "security", reason: "compromise", evidenceRef: "INC-1" }, now);
  assert.deepEqual(suspended.affectedUserIds, ["u1"]);
  const sessions = { s1: { sessionId: "s1", tenantId: "tenant-a", userId: "u1", status: "active" }, s2: { sessionId: "s2", tenantId: "tenant-b", userId: "u1", status: "active" } };
  const revoked = revokePrincipalSessions(sessions, { tenantId: "tenant-a", userId: "u1", revokedBy: "security", reason: "compromise" }, now);
  assert.equal(revoked.sessions.s1.status, "revoked");
  assert.equal(revoked.sessions.s2.status, "active");
  assert.equal(revoked.sessions.s1.revocationReason, "compromise");
});

test("authenticator recovery excludes proposer and subject then forces clean MFA enrollment", () => {
  const proposed = proposeAuthenticatorRecovery(base(), { requestId: "rec-1", tenantId: "tenant-a", principalId: "u1", proposedBy: "admin-1", identityEvidenceRef: "video-check-1", reason: "lost device" }, now);
  assert.throws(() => approveAuthenticatorRecovery(proposed.state, { requestId: "rec-1", approvedBy: "admin-1", approvalRef: "A" }), /independent/);
  assert.throws(() => approveAuthenticatorRecovery(proposed.state, { requestId: "rec-1", approvedBy: "u1", approvalRef: "A" }), /independent/);
  const approved = approveAuthenticatorRecovery(proposed.state, { requestId: "rec-1", approvedBy: "admin-2", approvalRef: "A" }, now);
  assert.equal(approved.user.mfaEnabled, false);
  assert.equal(approved.user.requiredAction, "mfa_setup");
});

test("directory reconciliation reports drift and refuses provider-pushed roles by design", () => {
  const result = reconcileFederatedDirectory(base(), { reconciliationId: "recon-1", tenantId: "tenant-a", policyId: "idp", executedBy: "auditor", sourceEvidenceRef: "export-1", sourceUsers: [{ externalId: "external-1", active: false, roles: ["tenant_admin"] }, { externalId: "external-2", active: true }] }, now);
  assert.equal(result.reconciliation.status, "needs_attention");
  assert.deepEqual(result.reconciliation.statusMismatches, ["u1"]);
  assert.deepEqual(result.reconciliation.forbiddenRolePushes, ["external-1"]);
  assert.deepEqual(result.state.users.u1, base().users.u1);
});

test("operational readiness is explicit that simulator certification is not production live", () => {
  const projection = projectIdentityOperationalReadiness(base(), { tenantId: "tenant-a", sessions: {}, requiredFamilies: ["oidc"] }, now);
  assert.equal(projection.commerciallyLive, false);
  assert.equal(projection.status, "needs_attention");
  assert.ok(projection.blockers.includes("simulator_conformance_missing:oidc"));
});

test("tenant dashboard exposes the IAM control room and labels simulator evidence", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../apps/dashboard/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/dashboard/index.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /data-admin-tab="identity-ops"/);
  assert.match(html, /Integration state: simulated only/);
  assert.match(html, /Immediate session containment/);
  assert.match(html, /Federation rotation and emergency suspension/);
  assert.match(html, /Cross-platform conformance administration/);
  assert.match(html, /Durable identity operations worker/);
  assert.match(html, /Unified tenant activation gate/);
  assert.match(script, /\/admin\/identity-operations\/conformance\/campaigns/);
  assert.match(script, /\/admin\/identity-operations\/sessions\/revoke/);
  assert.match(script, /\/admin\/conformance\/campaigns\/proposals/);
  assert.match(script, /\/admin\/identity-operations\/worker\/jobs/);
  assert.match(script, /\/admin\/tenant-activation\/assessments/);
});
