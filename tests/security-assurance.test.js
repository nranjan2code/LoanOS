import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import {
  approveVulnerabilityException,
  createSecurityScanBundle,
  createVulnerability,
  evaluateReleaseSecurityGate,
  registerSbom,
  transitionVulnerability
} from "@loanos/core";

const now = new Date("2026-07-14T12:00:00.000Z");
const artifactSha256 = "b".repeat(64);

function scans(findings = {}) {
  return ["sast", "dast", "dependency", "container", "iac", "secret"].map((type, index) => ({
    scanId: `scan_${type}`,
    type,
    status: "passed",
    tool: `scanner-${type}`,
    toolVersion: "1.0.0",
    rulesetRef: `policy://security/${type}/v1`,
    evidenceRef: `evidence://security/${type}/run-1`,
    startedAt: `2026-07-14T10:0${index}:00.000Z`,
    completedAt: `2026-07-14T10:1${index}:00.000Z`,
    findings: findings[type] ?? { critical: 0, high: 0, medium: 0, low: 0 }
  }));
}

function bundleInput(findings) {
  return { bundleId: "bundle_1", artifactSha256, sourceRevision: "ce0463d", pipelineRunRef: "ci://runs/security-1", recordedBy: "security_maker", scans: scans(findings) };
}

function sbomInput() {
  return { sbomId: "sbom_1", artifactSha256, documentSha256: "c".repeat(64), format: "cyclonedx", formatVersion: "1.6", componentCount: 42, generator: "build-pipeline", evidenceRef: "evidence://sbom/1", signatureRef: "signature://sbom/1", recordedBy: "security_maker", generatedAt: "2026-07-14T10:20:00.000Z" };
}

function release() {
  return { releaseId: "rel_security_1", artifactSha256, sourceRevision: "ce0463d" };
}

test("security scan bundle requires every SDLC scan type and an artifact-bound SBOM", () => {
  assert.throws(() => createSecurityScanBundle({ ...bundleInput(), scans: scans().slice(0, 5) }, [], now), (error) => error.code === "scan_bundle_incomplete");
  const bundle = createSecurityScanBundle(bundleInput(), [], now);
  const sbom = registerSbom(sbomInput(), [], now);
  assert.equal(bundle.status, "passed");
  assert.equal(bundle.scans.length, 6);
  assert.equal(sbom.artifactSha256, artifactSha256);
  assert.equal(evaluateReleaseSecurityGate(release(), { scanBundles: [bundle], sboms: [sbom], vulnerabilities: [], exceptions: [] }, now).status, "passed");
});

test("release gate blocks untracked and unaccepted findings while bounded risk exception is explicit", () => {
  const bundle = createSecurityScanBundle(bundleInput({ dependency: { critical: 0, high: 1, medium: 0, low: 0 } }), [], now);
  const sbom = registerSbom(sbomInput(), [], now);
  let gate = evaluateReleaseSecurityGate(release(), { scanBundles: [bundle], sboms: [sbom], vulnerabilities: [], exceptions: [] }, now);
  assert.deepEqual(gate.blockers, ["untracked_high_findings"]);
  const vulnerability = createVulnerability({ vulnerabilityId: "VULN-1", externalId: "CVE-TEST-1", title: "Dependency permits unsafe request parsing", severity: "high", cvss: "8.1", component: "example-lib", affectedVersion: "1.0.0", scanId: "scan_dependency", artifactSha256, discoveredBy: "security_maker" }, [bundle], [], now);
  gate = evaluateReleaseSecurityGate(release(), { scanBundles: [bundle], sboms: [sbom], vulnerabilities: [vulnerability], exceptions: [] }, now);
  assert.deepEqual(gate.blockers, ["high_vulnerability:VULN-1"]);
  const exception = approveVulnerabilityException(vulnerability, { exceptionId: "EXC-1", rationale: "Upgrade awaits upstream compatibility validation.", compensatingControls: ["Disable affected parser path", "Monitor exploit indicators"], proposedBy: "security_maker", approvedBy: "security_checker", approvalRef: "risk://approvals/EXC-1", expiresAt: "2026-08-01T00:00:00.000Z" }, [], now);
  gate = evaluateReleaseSecurityGate(release(), { scanBundles: [bundle], sboms: [sbom], vulnerabilities: [vulnerability], exceptions: [exception] }, now);
  assert.equal(gate.status, "passed");
  assert.throws(() => approveVulnerabilityException({ ...vulnerability, severity: "critical" }, { exceptionId: "EXC-2" }, [], now), (error) => error.code === "critical_exception_forbidden");
});

test("vulnerability remediation requires independent verification and closure", () => {
  const bundle = createSecurityScanBundle(bundleInput(), [], now);
  let vulnerability = createVulnerability({ vulnerabilityId: "VULN-2", externalId: "CVE-TEST-2", title: "Container base image package is outdated", severity: "medium", component: "base-image", affectedVersion: "2026.06", scanId: "scan_container", artifactSha256, discoveredBy: "security_maker" }, [bundle], [], now);
  vulnerability = transitionVulnerability(vulnerability, { status: "triaged", updatedBy: "security_maker", owner: "platform_security", triageEvidenceRef: "evidence://vuln/2/triage" }, now);
  vulnerability = transitionVulnerability(vulnerability, { status: "in_remediation", updatedBy: "security_maker", remediationPlan: "Rebuild on the patched approved base image.", changeTicket: "CHG-SEC-2" }, now);
  vulnerability = transitionVulnerability(vulnerability, { status: "remediated", updatedBy: "security_maker", fixedVersion: "2026.07", remediationEvidenceRef: "evidence://vuln/2/build" }, now);
  assert.throws(() => transitionVulnerability(vulnerability, { status: "verified", updatedBy: "security_maker", retestScanId: "scan_container_retest", verificationEvidenceRef: "evidence://vuln/2/retest" }, now), (error) => error.code === "vulnerability_four_eyes_required");
  vulnerability = transitionVulnerability(vulnerability, { status: "verified", updatedBy: "security_checker", retestScanId: "scan_container_retest", verificationEvidenceRef: "evidence://vuln/2/retest" }, now);
  vulnerability = transitionVulnerability(vulnerability, { status: "closed", updatedBy: "security_maker", closureApprovalRef: "approval://vuln/2" }, now);
  assert.equal(vulnerability.status, "closed");
});

test("platform release approval fails closed until scan and SBOM evidence are recorded", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-security-assurance-"));
  const platformAdminKey = "security-assurance-key";
  const server = createLoanOsServer({ dataDir, platformAdminKey });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const adminHeaders = { "content-type": "application/json", "x-platform-admin-key": platformAdminKey };
  async function createUser(userId, email) {
    const response = await fetch(`${base}/platform/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ userId, email, displayName: userId, password: "PlatformPass1!", mfaRequired: false, mustChangePassword: false, roles: ["platform_admin", "security_admin", "auditor"] }) });
    assert.equal(response.status, 201);
  }
  async function login(email) {
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "platform", email, password: "PlatformPass1!" }) });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  }
  await createUser("security_maker", "maker@security.example.in");
  await createUser("security_checker", "checker@security.example.in");
  const maker = await login("maker@security.example.in");
  const checker = await login("checker@security.example.in");
  const post = (path, body, cookie) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  const releaseInput = { releaseId: "rel_security_1", version: "2026.07.14-sec1", artifactSha256, sourceRevision: "ce0463d", environment: "production", riskLevel: "high", changeTicket: "CHG-SEC-1", proposedBy: "security_maker", rollbackVersion: "2026.07.13", rollbackProcedureRef: "runbook://release/rollback", evidence: { testRunRef: "ci://runs/1", securityScanRef: "security://bundle_1", buildProvenanceRef: "provenance://build/1", recoveryPointRef: "backup://release/1" } };
  let response = await post("/platform/delivery/releases", releaseInput, maker);
  assert.equal(response.status, 201);
  response = await post("/platform/delivery/releases/rel_security_1/approval", { approvedBy: "security_checker", approvalRef: "CAB-SEC-1" }, checker);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "release_security_gate_blocked");
  response = await post("/platform/security-assurance/scan-bundles", bundleInput({ dependency: { critical: 0, high: 1, medium: 0, low: 0 } }), maker);
  assert.equal(response.status, 201);
  response = await post("/platform/security-assurance/sboms", sbomInput(), maker);
  assert.equal(response.status, 201);
  response = await post("/platform/security-assurance/vulnerabilities", { vulnerabilityId: "VULN-API-1", externalId: "CVE-TEST-API-1", title: "Release dependency requires bounded exception", severity: "high", component: "example-lib", affectedVersion: "1.0.0", scanId: "scan_dependency", artifactSha256, discoveredBy: "security_maker" }, maker);
  assert.equal(response.status, 201);
  response = await post("/platform/delivery/releases/rel_security_1/approval", { approvedBy: "security_checker", approvalRef: "CAB-SEC-1" }, checker);
  assert.equal(response.status, 422);
  response = await post("/platform/security-assurance/vulnerabilities/VULN-API-1/exceptions", { exceptionId: "EXC-API-1", rationale: "Upstream compatibility validation is still in progress.", compensatingControls: ["Disable affected feature path", "Monitor exploitation indicators"], proposedBy: "security_maker", approvedBy: "security_checker", approvalRef: "risk://approvals/EXC-API-1", expiresAt: "2026-08-01T00:00:00.000Z" }, checker);
  assert.equal(response.status, 201);
  response = await post("/platform/delivery/releases/rel_security_1/approval", { approvedBy: "security_checker", approvalRef: "CAB-SEC-1" }, checker);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).release.securityGate.status, "passed");
  response = await fetch(`${base}/platform/security-assurance/release-gates/rel_security_1`, { headers: { cookie: checker } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "passed");
  response = await fetch(`${base}/platform/security-assurance`, { headers: { cookie: checker } });
  assert.equal(response.status, 200);
  const assurance = await response.json();
  assert.equal(assurance.vulnerabilities.length, 1);
  assert.equal(assurance.exceptions.length, 1);
});
