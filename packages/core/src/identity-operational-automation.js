import { createHash } from "node:crypto";
import { revokePrincipalSessions } from "./identity-operations.js";
import { IDENTITY_INTEGRATION_FAMILIES } from "./identity-integration-conformance.js";

export const FEDERATED_REVOCATION_PROTOCOLS = Object.freeze(["oidc_backchannel_logout", "oidc_token_revocation", "saml_single_logout", "provider_session_revocation"]);
export const IDENTITY_DRILL_SCENARIOS = Object.freeze(["idp_outage", "signing_key_compromise", "scim_credential_compromise", "leaver_containment", "control_engine_outage", "siem_worm_outage", "metadata_rollover", "directory_drift"]);

export function applyFederatedRevocationEvent(eventRegistry = {}, sessions = {}, policies = {}, users = {}, input = {}, now = new Date()) {
  for (const field of ["eventId", "tenantId", "policyId", "protocol", "issuer", "audience", "subject", "providerEvidenceRef", "evidenceChecksumSha256"]) required(input[field], field);
  if (!FEDERATED_REVOCATION_PROTOCOLS.includes(input.protocol)) fail("federated_revocation_protocol_invalid", "Federated revocation protocol is unsupported.");
  if (input.signatureVerified !== true) fail("federated_revocation_signature_invalid", "Provider revocation evidence must have a verified signature.");
  digest(input.evidenceChecksumSha256, "evidenceChecksumSha256");
  if (input.verification?.cryptographicallyVerified !== true || input.verification.payloadChecksumSha256 !== input.evidenceChecksumSha256) fail("federated_revocation_verification_missing", "Cryptographic verifier lineage must match the signed payload checksum.");
  for (const field of ["profileId", "keyId", "algorithm", "profileChecksumSha256", "activationChecksumSha256", "verificationEvidenceRef"]) required(input.verification[field], `verification.${field}`);
  const policy = policies[input.policyId];
  if (!policy || !["active", "suspended"].includes(policy.status)) fail("federated_revocation_policy_missing", "An active or suspended same-tenant federation policy is required.");
  if (policy.tenantId && policy.tenantId !== input.tenantId) fail("federated_revocation_tenant_mismatch", "Federation policy and revocation event must belong to the same tenant.");
  if (policy.issuer !== input.issuer || policy.audience !== input.audience) fail("federated_revocation_claim_mismatch", "Revocation issuer or audience does not match the certified policy.");
  const issuedAt = time(input.issuedAt, "issuedAt");
  const expiresAt = time(input.expiresAt, "expiresAt");
  if (issuedAt > now.getTime() + 60_000 || now.getTime() - issuedAt > 5 * 60_000 || expiresAt <= now.getTime() || expiresAt - issuedAt > 10 * 60_000) fail("federated_revocation_stale", "Revocation evidence is stale, future-dated or has an excessive validity window.");
  const canonical = { tenantId: input.tenantId, policyId: input.policyId, protocol: input.protocol, issuer: input.issuer, audience: input.audience, subject: input.subject, providerSessionId: input.providerSessionId ?? null, issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), evidenceChecksumSha256: input.evidenceChecksumSha256, verificationProfileId: input.verification.profileId, verificationKeyId: input.verification.keyId };
  const eventChecksumSha256 = hash(canonical);
  const replay = eventRegistry[input.eventId];
  if (replay) {
    if (replay.eventChecksumSha256 !== eventChecksumSha256) fail("federated_revocation_replay_conflict", "Revocation event ID was reused for different evidence.");
    return { events: eventRegistry, sessions, event: replay, revokedSessionIds: replay.revokedSessionIds, idempotent: true };
  }
  const user = Object.values(users).find((candidate) => (!candidate.tenantId || candidate.tenantId === input.tenantId) && candidate.federationPolicyId === input.policyId && candidate.federationExternalId === input.subject);
  const revokedSessionIds = [];
  const nextSessions = Object.fromEntries(Object.entries(sessions).map(([id, session]) => {
    const subjectMatches = session.federationSubject === input.subject || (user && session.userId === user.userId);
    const providerSessionMatches = !input.providerSessionId || session.providerSessionId === input.providerSessionId;
    if (session.tenantId !== input.tenantId || session.federationPolicyId !== input.policyId || !subjectMatches || !providerSessionMatches || session.status !== "active") return [id, session];
    revokedSessionIds.push(id);
    return [id, { ...session, status: "revoked", revokedAt: now.toISOString(), revokedBy: `federation:${input.policyId}`, revocationReason: `${input.protocol}:${input.eventId}` }];
  }));
  const event = Object.freeze({ eventId: input.eventId, ...canonical, providerEvidenceRef: input.providerEvidenceRef, verification: Object.freeze({ ...input.verification }), eventChecksumSha256, revokedSessionIds, status: "applied", appliedAt: now.toISOString(), executionMode: "simulated", commerciallyLive: false });
  return { events: { ...eventRegistry, [event.eventId]: event }, sessions: nextSessions, event, revokedSessionIds, idempotent: false };
}

export function planIdentityOperationalRun(state = {}, sessions = {}, input = {}, now = new Date()) {
  required(input.runId, "runId"); required(input.tenantId, "tenantId"); required(input.plannedBy, "plannedBy");
  const metadataWarningMs = bounded(input.metadataWarningDays ?? 30, 1, 180, "metadataWarningDays") * 86_400_000;
  const staleConformanceMs = bounded(input.conformanceMaxAgeDays ?? 90, 1, 365, "conformanceMaxAgeDays") * 86_400_000;
  const requestSlaMs = bounded(input.requestSlaHours ?? 24, 1, 720, "requestSlaHours") * 3_600_000;
  const reconciliationMaxAgeMs = bounded(input.reconciliationMaxAgeHours ?? 24, 1, 720, "reconciliationMaxAgeHours") * 3_600_000;
  const findings = [];
  const containment = [];
  for (const policy of Object.values(state.federationPolicies ?? {})) {
    const expires = Date.parse(policy.metadataValidUntil);
    if (!Number.isFinite(expires) || expires <= now.getTime()) finding(findings, "critical", "federation_metadata_expired", policy.policyId, "Suspend federation and certify current metadata.");
    else if (expires - now.getTime() <= metadataWarningMs) finding(findings, "warning", "federation_metadata_expiring", policy.policyId, "Open a governed metadata/key rotation.");
  }
  for (const campaign of Object.values(state.identityConformanceCampaigns ?? {})) {
    if (campaign.status !== "simulator_certified") finding(findings, "warning", "conformance_incomplete", campaign.campaignId, "Complete every required simulator scenario.");
    else if (now.getTime() - Date.parse(campaign.assessedAt) > staleConformanceMs) finding(findings, "warning", "conformance_stale", campaign.campaignId, "Create a fresh conformance campaign.");
  }
  for (const family of input.requiredConformanceFamilies ?? IDENTITY_INTEGRATION_FAMILIES) {
    if (!Object.values(state.identityConformanceCampaigns ?? {}).some((campaign) => campaign.family === family && campaign.status === "simulator_certified" && now.getTime() - Date.parse(campaign.assessedAt) <= staleConformanceMs)) finding(findings, "warning", "conformance_family_missing_or_stale", family, "Approve and complete a fresh simulator campaign; this does not establish a live integration.");
  }
  for (const [kind, registry] of [["rotation", state.federationRotationRequests], ["recovery", state.authenticatorRecoveryRequests], ["role", state.saasRoleRequests]]) {
    for (const request of Object.values(registry ?? {})) if (request.status === "pending" && now.getTime() - Date.parse(request.proposedAt ?? request.requestedAt) > requestSlaMs) finding(findings, "warning", `${kind}_request_overdue`, request.requestId, "Escalate to the independent checker; do not auto-approve.");
  }
  for (const review of Object.values(state.accessReviews ?? {})) if (review.status === "open" && review.dueAt && Date.parse(review.dueAt) < now.getTime()) finding(findings, "critical", "access_review_overdue", review.reviewId, "Escalate the overdue access review.");
  const reconciliations = Object.values(state.directoryReconciliations ?? {}).sort((a, b) => Date.parse(b.executedAt) - Date.parse(a.executedAt));
  for (const policy of Object.values(state.federationPolicies ?? {}).filter((item) => item.status === "active")) {
    const latest = reconciliations.find((item) => item.policyId === policy.policyId);
    if (!latest || now.getTime() - Date.parse(latest.executedAt) > reconciliationMaxAgeMs) finding(findings, "warning", "directory_reconciliation_stale", policy.policyId, "Run a provider-directory reconciliation.");
  }
  for (const session of Object.values(sessions)) {
    if (session.tenantId !== input.tenantId || session.status !== "active") continue;
    const user = state.users?.[session.userId]; const policy = session.federationPolicyId ? state.federationPolicies?.[session.federationPolicyId] : null;
    const reason = !user || user.status !== "active" ? "inactive_principal_session" : session.federationPolicyId && (!policy || policy.status !== "active") ? "inactive_federation_session" : null;
    if (reason) containment.push({ actionId: `${input.runId}:revoke:${session.sessionId}`, type: "revoke_principal_sessions", userId: session.userId, reason, sessionId: session.sessionId });
  }
  for (const batch of Object.values(state.activityExportBatches ?? {})) if (!batch.custody && batch.status !== "custodied") finding(findings, "critical", "activity_custody_pending", batch.exportId ?? batch.batchId, "Escalate the uncustodied activity batch.");
  const plan = { runId: input.runId, tenantId: input.tenantId, plannedBy: input.plannedBy, plannedAt: now.toISOString(), findings: dedupe(findings), containment: dedupe(containment), automaticActions: ["revoke_principal_sessions"], prohibitedAutomaticActions: ["approve_role", "approve_recovery", "activate_federation", "close_escalation"], status: findings.some((item) => item.severity === "critical") || containment.length ? "action_required" : findings.length ? "attention" : "clear" };
  return Object.freeze({ ...plan, planChecksumSha256: hash(plan) });
}

export function executeIdentityOperationalRun(state = {}, sessions = {}, plan, input = {}, now = new Date()) {
  required(input.executedBy, "executedBy"); required(input.executionEvidenceRef, "executionEvidenceRef");
  if (!plan || plan.planChecksumSha256 !== hash(without(plan, "planChecksumSha256"))) fail("identity_operational_plan_tampered", "Operational plan checksum is invalid.");
  if (state.identityOperationalRuns?.[plan.runId]) fail("identity_operational_run_exists", "Operational run already exists.");
  let nextSessions = sessions; const results = [];
  for (const action of plan.containment) {
    const revoked = revokePrincipalSessions(nextSessions, { tenantId: plan.tenantId, userId: action.userId, revokedBy: input.executedBy, reason: action.reason }, now);
    nextSessions = revoked.sessions; results.push({ actionId: action.actionId, type: action.type, revokedSessionIds: revoked.revokedSessionIds, status: "completed" });
  }
  const run = Object.freeze({ ...plan, status: plan.findings.length ? "completed_with_findings" : "completed", executedBy: input.executedBy, executionEvidenceRef: input.executionEvidenceRef, executedAt: now.toISOString(), results });
  return { state: { ...state, identityOperationalRuns: { ...(state.identityOperationalRuns ?? {}), [run.runId]: run } }, sessions: nextSessions, run };
}

export function proposeIdentityOperationsDrill(state = {}, input = {}, now = new Date()) {
  for (const field of ["drillId", "tenantId", "scenario", "proposedBy", "objective", "runbookRef"]) required(input[field], field);
  if (!IDENTITY_DRILL_SCENARIOS.includes(input.scenario)) fail("identity_drill_scenario_invalid", "Identity drill scenario is unsupported.");
  if (state.identityOperationsDrills?.[input.drillId]) fail("identity_drill_exists", "Identity drill already exists.");
  const drill = Object.freeze({ drillId: input.drillId, tenantId: input.tenantId, scenario: input.scenario, objective: input.objective, runbookRef: input.runbookRef, targetDetectionMs: bounded(input.targetDetectionMs, 1, 86_400_000, "targetDetectionMs"), targetContainmentMs: bounded(input.targetContainmentMs, 1, 86_400_000, "targetContainmentMs"), targetRecoveryMs: bounded(input.targetRecoveryMs, 1, 604_800_000, "targetRecoveryMs"), simulation: true, commerciallyLive: false, status: "pending_witness", proposedBy: input.proposedBy, proposedAt: now.toISOString() });
  return { state: { ...state, identityOperationsDrills: { ...(state.identityOperationsDrills ?? {}), [drill.drillId]: drill } }, drill };
}

export function witnessIdentityOperationsDrill(state = {}, input = {}, now = new Date()) {
  const drill = state.identityOperationsDrills?.[input.drillId];
  if (!drill || drill.status !== "pending_witness") fail("identity_drill_not_pending", "A pending identity drill is required.");
  for (const field of ["witnessedBy", "executionEvidenceRef", "recoveryEvidenceRef"]) required(input[field], field);
  if (input.witnessedBy === drill.proposedBy) fail("identity_drill_four_eyes_required", "Drill witness must be independent of the proposer.");
  const detectionMs = bounded(input.detectionMs, 0, 86_400_000, "detectionMs"); const containmentMs = bounded(input.containmentMs, 0, 86_400_000, "containmentMs"); const recoveryMs = bounded(input.recoveryMs, 0, 604_800_000, "recoveryMs");
  const objectivesMet = detectionMs <= drill.targetDetectionMs && containmentMs <= drill.targetContainmentMs && recoveryMs <= drill.targetRecoveryMs && input.failClosedObserved === true && input.auditComplete === true;
  const witnessed = Object.freeze({ ...drill, status: objectivesMet ? "passed" : "failed", witnessedBy: input.witnessedBy, executionEvidenceRef: input.executionEvidenceRef, recoveryEvidenceRef: input.recoveryEvidenceRef, detectionMs, containmentMs, recoveryMs, failClosedObserved: input.failClosedObserved === true, auditComplete: input.auditComplete === true, observations: String(input.observations ?? ""), witnessedAt: now.toISOString() });
  return { state: { ...state, identityOperationsDrills: { ...state.identityOperationsDrills, [drill.drillId]: witnessed } }, drill: witnessed };
}

function finding(items, severity, code, subjectId, requiredAction) { items.push({ findingId: `${code}:${subjectId}`, severity, code, subjectId, requiredAction }); }
function dedupe(values) { return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()]; }
function without(value, field) { const copy = { ...value }; delete copy[field]; return copy; }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function digest(value, field) { if (!/^[a-f0-9]{64}$/i.test(value)) fail("identity_operational_input_invalid", `${field} must be a SHA-256 digest.`); }
function time(value, field) { const result = Date.parse(value); if (!Number.isFinite(result)) fail("identity_operational_input_invalid", `${field} must be an ISO date-time.`); return result; }
function bounded(value, min, max, field) { if (!Number.isInteger(value) || value < min || value > max) fail("identity_operational_input_invalid", `${field} is outside its allowed range.`); return value; }
function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("identity_operational_input_invalid", `${field} is required.`); return value; }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
