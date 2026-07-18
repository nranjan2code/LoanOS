import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import {
  assessDetectionCoverage,
  createDetectionRule,
  createSecurityAlert,
  createSecurityInvestigation,
  preserveInvestigationEvidence,
  transitionSecurityInvestigation,
  triageSecurityAlert
} from "@loanos/core";

const now = new Date("2026-07-14T12:00:00.000Z");

function ruleInput() {
  return { ruleId: "RULE-AUTH-1", version: 1, name: "Privileged authentication anomaly", description: "Detects anomalous privileged authentication activity.", severity: "high", logSources: ["identity", "audit"], detectionRef: "siem://rules/auth-anomaly-v1", playbookRef: "runbook://soc/privileged-auth", owner: "soc_team", proposedBy: "soc_analyst", approvedBy: "soc_reviewer", approvalRef: "approval://soc/rules/1", testEvidenceRef: "evidence://soc/rules/1/test" };
}

function alertInput() {
  return { alertId: "ALERT-1", tenantId: "tenant_a", ruleId: "RULE-AUTH-1", ruleVersion: 1, title: "Privileged login anomaly", summary: "A privileged login deviated from the approved access pattern.", logSource: "identity", deduplicationKey: "tenant_a:principal_1:auth_anomaly", evidenceRef: "siem://events/ALERT-1", eventSha256: "a".repeat(64), entityRefs: ["principal:principal_1"], detectedBy: "soc_analyst", observedAt: "2026-07-14T11:30:00.000Z" };
}

test("detection rule and alert enforce four-eyes approval, source coverage, deduplication and SLA", () => {
  assert.throws(() => createDetectionRule({ ...ruleInput(), approvedBy: "soc_analyst" }, [], now), (error) => error.code === "detection_rule_four_eyes_required");
  const rule = createDetectionRule(ruleInput(), [], now);
  const alert = createSecurityAlert(alertInput(), [rule], [], now);
  assert.equal(alert.severity, "high");
  assert.equal(alert.acknowledgementDueAt, "2026-07-14T12:00:00.000Z");
  assert.throws(() => createSecurityAlert({ ...alertInput(), alertId: "ALERT-2" }, [rule], [alert], now), (error) => error.code === "security_alert_duplicate_signal");
  assert.throws(() => createSecurityAlert({ ...alertInput(), alertId: "ALERT-3", logSource: "database" }, [rule], [], now), (error) => error.code === "security_alert_invalid");
});

test("alert dismissal is independently reviewed while confirmed signals escalate", () => {
  const rule = createDetectionRule(ruleInput(), [], now);
  const alert = createSecurityAlert(alertInput(), [rule], [], now);
  assert.throws(() => triageSecurityAlert(alert, { analyst: "soc_analyst", disposition: "false_positive", analysis: "Expected administrative testing generated this signal.", evidenceRef: "evidence://alert/1/triage", reviewedBy: "soc_analyst", approvalRef: "approval://alert/1" }, now), (error) => error.code === "security_alert_four_eyes_required");
  const escalated = triageSecurityAlert(alert, { analyst: "soc_analyst", disposition: "confirmed", analysis: "Authentication source and audit activity confirm unauthorized access.", evidenceRef: "evidence://alert/1/triage" }, now);
  assert.equal(escalated.status, "escalated");
  assert.equal(escalated.acknowledgementStatus, "met");
});

test("investigation evidence is hash-linked and closure requires independent recovery review", () => {
  const rule = createDetectionRule(ruleInput(), [], now);
  const alert = triageSecurityAlert(createSecurityAlert(alertInput(), [rule], [], now), { analyst: "soc_analyst", disposition: "confirmed", analysis: "Authentication and audit evidence confirms malicious activity.", evidenceRef: "evidence://alert/1/triage" }, now);
  let investigation = createSecurityInvestigation({ investigationId: "INV-SOC-1", tenantId: "tenant_a", title: "Privileged account compromise", hypothesis: "A stolen privileged credential was used for unauthorized access.", alertIds: [alert.alertId], incidentId: "INC-1", supportCaseId: "SUP-1", lead: "soc_analyst", createdBy: "soc_analyst", playbookRef: "runbook://soc/account-compromise" }, [alert], [], now);
  const first = preserveInvestigationEvidence(investigation, { evidenceId: "E-1", source: "identity-log", storageRef: "vault://soc/INV-SOC-1/E-1", description: "Original identity provider event export.", contentSha256: "b".repeat(64), collectedBy: "soc_analyst", collectedAt: "2026-07-14T11:45:00.000Z", dataResidencyCountry: "IN", retentionUntil: "2027-01-14T00:00:00.000Z", legalHold: true }, now);
  investigation = first.investigation;
  const second = preserveInvestigationEvidence(investigation, { evidenceId: "E-2", source: "audit-log", storageRef: "vault://soc/INV-SOC-1/E-2", description: "Platform audit events for the affected principal.", contentSha256: "c".repeat(64), collectedBy: "soc_analyst", collectedAt: "2026-07-14T11:50:00.000Z", dataResidencyCountry: "IN", retentionUntil: "2027-01-14T00:00:00.000Z" }, now);
  investigation = second.investigation;
  assert.equal(second.evidence.priorEvidenceHash, first.evidence.evidenceHash);
  investigation = transitionSecurityInvestigation(investigation, { status: "contained", updatedBy: "soc_analyst", actions: ["Disable principal", "Revoke sessions"], evidenceRef: "evidence://investigation/containment" }, now);
  investigation = transitionSecurityInvestigation(investigation, { status: "eradicated", updatedBy: "soc_analyst", actions: ["Rotate privileged credentials", "Remove persistence"], evidenceRef: "evidence://investigation/eradication" }, now);
  investigation = transitionSecurityInvestigation(investigation, { status: "recovered", updatedBy: "soc_analyst", recoveryEvidenceRef: "evidence://investigation/recovery", monitoringRef: "siem://monitoring/recovery-1" }, now);
  assert.throws(() => transitionSecurityInvestigation(investigation, { status: "closed", updatedBy: "soc_analyst", rootCause: "Privileged credential was exposed through an unmanaged endpoint.", lessons: ["Require managed-device posture"], detectionRuleChanges: ["Add endpoint posture correlation"], closureEvidenceRef: "evidence://investigation/closure", approvalRef: "approval://investigation/closure" }, now), (error) => error.code === "security_investigation_four_eyes_required");
  investigation = transitionSecurityInvestigation(investigation, { status: "closed", updatedBy: "soc_reviewer", rootCause: "Privileged credential was exposed through an unmanaged endpoint.", lessons: ["Require managed-device posture"], detectionRuleChanges: ["Add endpoint posture correlation"], closureEvidenceRef: "evidence://investigation/closure", approvalRef: "approval://investigation/closure" }, now);
  assert.equal(investigation.status, "closed");
});

test("coverage assessment measures ingestion, 180-day retention and trusted time gaps", () => {
  const assessment = assessDetectionCoverage({ assessmentId: "COV-1", requiredSources: ["identity", "audit", "database"], sources: [{ logSource: "identity", active: true, retentionDays: 180, timeSynchronized: true, ingestionEvidenceRef: "siem://identity", timeSyncEvidenceRef: "ntp://identity" }, { logSource: "audit", active: true, retentionDays: 90, timeSynchronized: true, ingestionEvidenceRef: "siem://audit", timeSyncEvidenceRef: "ntp://audit" }], actions: ["Extend audit retention", "Onboard database logs"], evidenceRef: "evidence://coverage/1", assessedBy: "soc_analyst", approvedBy: "soc_reviewer", approvalRef: "approval://coverage/1" }, now);
  assert.equal(assessment.status, "gaps_found");
  assert.equal(assessment.coveragePct, 33.33);
  assert.deepEqual(assessment.checks[2].gaps, ["ingestion_inactive", "retention_below_180_days", "time_not_synchronized"]);
});

test("platform APIs retain SOC rule, alert, evidence, investigation and coverage state", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-security-operations-"));
  const platformAdminKey = "soc-platform-key";
  const server = createLoanOsServer({ dataDir, platformAdminKey });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const adminHeaders = { "content-type": "application/json", "x-platform-admin-key": platformAdminKey };
  async function createUser(userId, email) { const response = await fetch(`${base}/platform/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ userId, email, displayName: userId, password: "PlatformPass1!", mfaRequired: false, mustChangePassword: false, roles: ["platform_admin", "security_admin", "auditor"] }) }); assert.equal(response.status, 201); }
  async function login(email) { const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "platform", email, password: "PlatformPass1!" }) }); assert.equal(response.status, 200); return response.headers.get("set-cookie").split(";")[0]; }
  await createUser("soc_analyst", "analyst@soc.example.in"); await createUser("soc_reviewer", "reviewer@soc.example.in");
  const analyst = await login("analyst@soc.example.in"); const reviewer = await login("reviewer@soc.example.in");
  const post = (path, body, cookie) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  let response = await post("/platform/security-operations/detection-rules", ruleInput(), reviewer); assert.equal(response.status, 201);
  response = await post("/platform/security-operations/alerts", alertInput(), analyst); assert.equal(response.status, 201);
  response = await post("/platform/security-operations/alerts/ALERT-1/triage", { analyst: "soc_analyst", disposition: "confirmed", analysis: "Identity and audit evidence confirm malicious privileged access.", evidenceRef: "evidence://alert/1/triage" }, analyst); assert.equal(response.status, 200);
  response = await post("/platform/security-operations/investigations", { investigationId: "INV-SOC-1", tenantId: "tenant_a", title: "Privileged account compromise", hypothesis: "A stolen privileged credential was used for access.", alertIds: ["ALERT-1"], incidentId: "INC-1", supportCaseId: "SUP-1", lead: "soc_analyst", createdBy: "soc_analyst", playbookRef: "runbook://soc/account-compromise" }, analyst); assert.equal(response.status, 201);
  response = await post("/platform/security-operations/investigations/INV-SOC-1/evidence", { evidenceId: "E-1", source: "identity-log", storageRef: "vault://soc/INV-SOC-1/E-1", description: "Original identity provider event export.", contentSha256: "b".repeat(64), collectedBy: "soc_analyst", collectedAt: "2026-07-14T11:45:00.000Z", dataResidencyCountry: "IN", retentionUntil: "2027-01-14T00:00:00.000Z", legalHold: true }, analyst); assert.equal(response.status, 201);
  for (const body of [{ status: "contained", updatedBy: "soc_analyst", actions: ["Disable principal"], evidenceRef: "evidence://containment" }, { status: "eradicated", updatedBy: "soc_analyst", actions: ["Rotate credentials"], evidenceRef: "evidence://eradication" }, { status: "recovered", updatedBy: "soc_analyst", recoveryEvidenceRef: "evidence://recovery", monitoringRef: "siem://monitoring/recovery" }]) { response = await post("/platform/security-operations/investigations/INV-SOC-1/transition", body, analyst); assert.equal(response.status, 200); }
  response = await post("/platform/security-operations/investigations/INV-SOC-1/transition", { status: "closed", updatedBy: "soc_reviewer", rootCause: "Credential exposure through an unmanaged endpoint.", lessons: ["Require device posture"], detectionRuleChanges: ["Correlate endpoint posture"], closureEvidenceRef: "evidence://closure", approvalRef: "approval://closure" }, reviewer); assert.equal(response.status, 200);
  response = await post("/platform/security-operations/coverage-assessments", { assessmentId: "COV-1", requiredSources: ["identity", "audit"], sources: [{ logSource: "identity", active: true, retentionDays: 180, timeSynchronized: true, ingestionEvidenceRef: "siem://identity", timeSyncEvidenceRef: "ntp://identity" }, { logSource: "audit", active: true, retentionDays: 180, timeSynchronized: true, ingestionEvidenceRef: "siem://audit", timeSyncEvidenceRef: "ntp://audit" }], evidenceRef: "evidence://coverage/1", assessedBy: "soc_analyst", approvedBy: "soc_reviewer", approvalRef: "approval://coverage/1" }, reviewer); assert.equal(response.status, 201);
  response = await fetch(`${base}/platform/security-operations`, { headers: { cookie: reviewer } }); assert.equal(response.status, 200);
  const controls = await response.json(); assert.equal(controls.rules.length, 1); assert.equal(controls.alerts[0].status, "closed"); assert.equal(controls.alerts[0].investigationId, "INV-SOC-1"); assert.equal(controls.investigations[0].status, "closed"); assert.equal(controls.investigations[0].evidence.length, 1); assert.equal(controls.coverageAssessments[0].status, "covered");
});
