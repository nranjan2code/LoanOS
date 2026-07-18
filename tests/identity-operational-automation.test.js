import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  applyFederatedRevocationEvent,
  executeIdentityOperationalRun,
  planIdentityOperationalRun,
  proposeIdentityOperationsDrill,
  witnessIdentityOperationsDrill
} from "@loanos/core";

const now = new Date("2026-07-15T12:00:00.000Z");
const digest = createHash("sha256").update("revocation-evidence").digest("hex");

test("signed federation revocation is tenant scoped, replay safe and session exact", () => {
  const policies = { idp: { policyId: "idp", tenantId: "tenant-a", status: "active", issuer: "https://idp.bank.in", audience: "loanos" } };
  const users = { u1: { userId: "u1", tenantId: "tenant-a", federationPolicyId: "idp", federationExternalId: "subject-1" } };
  const sessions = {
    s1: { sessionId: "s1", tenantId: "tenant-a", userId: "u1", federationPolicyId: "idp", federationSubject: "subject-1", providerSessionId: "sid-1", status: "active" },
    s2: { sessionId: "s2", tenantId: "tenant-a", userId: "u1", federationPolicyId: "idp", federationSubject: "subject-1", providerSessionId: "sid-2", status: "active" },
    s3: { sessionId: "s3", tenantId: "tenant-b", userId: "u1", federationPolicyId: "idp", federationSubject: "subject-1", providerSessionId: "sid-1", status: "active" }
  };
  const input = { eventId: "logout-1", tenantId: "tenant-a", policyId: "idp", protocol: "oidc_backchannel_logout", issuer: "https://idp.bank.in", audience: "loanos", subject: "subject-1", providerSessionId: "sid-1", issuedAt: "2026-07-15T11:59:00Z", expiresAt: "2026-07-15T12:04:00Z", signatureVerified: true, providerEvidenceRef: "idp-event-1", evidenceChecksumSha256: digest, verification: { profileId: "verifier-1", keyId: "key-1", algorithm: "RS256", payloadChecksumSha256: digest, profileChecksumSha256: "a".repeat(64), activationChecksumSha256: "b".repeat(64), verificationEvidenceRef: "verifier-evidence-1", cryptographicallyVerified: true } };
  const result = applyFederatedRevocationEvent({}, sessions, policies, users, input, now);
  assert.deepEqual(result.revokedSessionIds, ["s1"]); assert.equal(result.sessions.s1.status, "revoked"); assert.equal(result.sessions.s2.status, "active"); assert.equal(result.sessions.s3.status, "active"); assert.equal(result.event.commerciallyLive, false);
  const replay = applyFederatedRevocationEvent(result.events, result.sessions, policies, users, input, now); assert.equal(replay.idempotent, true);
  assert.throws(() => applyFederatedRevocationEvent(result.events, result.sessions, policies, users, { ...input, providerSessionId: "sid-2" }, now), /different evidence/);
  assert.throws(() => applyFederatedRevocationEvent({}, sessions, policies, users, { ...input, signatureVerified: false }, now), /verified signature/);
  assert.throws(() => applyFederatedRevocationEvent({}, sessions, { idp: { ...policies.idp, tenantId: "tenant-b" } }, users, input, now), /same tenant/);
});

test("automation identifies expiry, overdue governance and unsafe sessions but auto-executes containment only", () => {
  const state = {
    federationPolicies: { idp: { policyId: "idp", status: "suspended", metadataValidUntil: "2026-07-14T00:00:00Z" } },
    users: { u1: { userId: "u1", status: "inactive" } },
    authenticatorRecoveryRequests: { r1: { requestId: "r1", status: "pending", proposedAt: "2026-07-13T00:00:00Z" } },
    accessReviews: { a1: { reviewId: "a1", status: "open", dueAt: "2026-07-14T00:00:00Z" } }
  };
  const sessions = { s1: { sessionId: "s1", tenantId: "tenant-a", userId: "u1", federationPolicyId: "idp", status: "active" } };
  const plan = planIdentityOperationalRun(state, sessions, { runId: "run-1", tenantId: "tenant-a", plannedBy: "security" }, now);
  assert.equal(plan.status, "action_required"); assert.ok(plan.findings.some((item) => item.code === "access_review_overdue")); assert.deepEqual(plan.automaticActions, ["revoke_principal_sessions"]); assert.ok(plan.prohibitedAutomaticActions.includes("approve_recovery"));
  const executed = executeIdentityOperationalRun(state, sessions, plan, { executedBy: "security", executionEvidenceRef: "scheduler-run-1" }, now);
  assert.equal(executed.sessions.s1.status, "revoked"); assert.equal(executed.state.authenticatorRecoveryRequests.r1.status, "pending");
});

test("identity resilience drill is simulated, four-eyes and objective measured", () => {
  const proposed = proposeIdentityOperationsDrill({}, { drillId: "drill-1", tenantId: "tenant-a", scenario: "signing_key_compromise", proposedBy: "maker", objective: "contain compromised signing key", runbookRef: "IAM-RUNBOOK-7", targetDetectionMs: 60_000, targetContainmentMs: 120_000, targetRecoveryMs: 600_000 }, now);
  assert.equal(proposed.drill.commerciallyLive, false);
  assert.throws(() => witnessIdentityOperationsDrill(proposed.state, { drillId: "drill-1", witnessedBy: "maker", executionEvidenceRef: "E", recoveryEvidenceRef: "R", detectionMs: 1, containmentMs: 1, recoveryMs: 1, failClosedObserved: true, auditComplete: true }, now), /independent/);
  const witnessed = witnessIdentityOperationsDrill(proposed.state, { drillId: "drill-1", witnessedBy: "checker", executionEvidenceRef: "E", recoveryEvidenceRef: "R", detectionMs: 30_000, containmentMs: 90_000, recoveryMs: 300_000, failClosedObserved: true, auditComplete: true }, now);
  assert.equal(witnessed.drill.status, "passed");
});
