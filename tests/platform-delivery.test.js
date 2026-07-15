import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { runResilienceProbe } from "../apps/api/src/resilience-probe.js";
import {
  approvePlatformRelease,
  assessConfigurationDrift,
  assessConfigurationParity,
  buildResilienceAssessment,
  createConfigurationBaseline,
  createPlatformRelease,
  evaluatePlatformCanary,
  promotePlatformRelease,
  rollbackPlatformRelease
} from "../packages/core/src/index.js";

function releaseInput() {
  return {
    releaseId: "rel_2026_07_14_1",
    version: "2026.07.14.1",
    artifactSha256: "a".repeat(64),
    sourceRevision: "7845622",
    environment: "production",
    riskLevel: "high",
    changeTicket: "CHG-2001",
    proposedBy: "release_maker",
    rollbackVersion: "2026.07.13.4",
    rollbackProcedureRef: "runbook://release/rollback-v1",
    evidence: {
      testRunRef: "ci://runs/2001",
      securityScanRef: "scan://security/2001",
      buildProvenanceRef: "slsa://build/2001",
      recoveryPointRef: "backup://pre-release/2001"
    }
  };
}

test("release lifecycle enforces four-eyes approval, measured canary, promotion, and rollback", () => {
  const created = createPlatformRelease(releaseInput(), [], new Date("2026-07-14T10:00:00.000Z"));
  assert.equal(created.status, "pending_approval");
  assert.throws(() => approvePlatformRelease(created, { approvedBy: "release_maker", approvalRef: "CAB-1" }), (error) => error.code === "release_four_eyes_required");
  const approved = approvePlatformRelease(created, { approvedBy: "release_checker", approvalRef: "CAB-1" }, new Date("2026-07-14T10:05:00.000Z"));
  const failed = evaluatePlatformCanary(approved, { requestCount: 50, minimumRequests: 100, errorRatePct: 0, errorRateThresholdPct: 1, p95LatencyMs: 100, p95LatencyThresholdMs: 500, observedBy: "release_checker", evidenceRef: "metrics://canary/1" });
  assert.equal(failed.status, "canary_failed");
  assert.throws(() => promotePlatformRelease(failed, { promotedBy: "release_checker", promotionRef: "deploy://1" }), (error) => error.code === "release_transition_invalid");
  const passed = evaluatePlatformCanary(failed, { requestCount: 500, minimumRequests: 100, errorRatePct: 0.2, errorRateThresholdPct: 1, p95LatencyMs: 200, p95LatencyThresholdMs: 500, observedBy: "release_checker", evidenceRef: "metrics://canary/2" });
  const deployed = promotePlatformRelease(passed, { promotedBy: "release_checker", promotionRef: "deploy://1" });
  assert.equal(deployed.status, "deployed");
  const rolledBack = rollbackPlatformRelease(deployed, { proposedBy: "incident_commander", approvedBy: "release_checker", approvalRef: "CAB-EMERGENCY-2", reason: "Payment error rate exceeded approved threshold", incidentRef: "INC-20" });
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(rolledBack.rollback.targetVersion, releaseInput().rollbackVersion);
});

test("AI agents may propose releases with immutable provenance but cannot approve or promote", () => {
  const agent = {
    principalId: "agent_release_1",
    principalType: "ai_agent",
    authenticationSource: "scoped_agent_credential",
    credentialId: "cred_release_1",
    agentInstallationId: "install_release_1",
    modelId: "release-copilot",
    modelVersion: "1.0.0",
    promptHash: "b".repeat(64),
    guardrailDecisionRef: "guardrail://release/proposal/1"
  };
  const created = createPlatformRelease({ ...releaseInput(), proposedBy: agent.principalId, proposer: agent });
  assert.equal(created.proposer.principalType, "ai_agent");
  assert.equal(created.proposer.promptHash, "b".repeat(64));
  assert.throws(() => approvePlatformRelease(created, { approvedBy: agent.principalId, approver: agent, approvalRef: "CAB-AI-1" }), (error) => error.code === "release_human_authority_required");
  const approved = approvePlatformRelease(created, { approvedBy: "human_checker", approvalRef: "CAB-HUMAN-1" });
  const canary = evaluatePlatformCanary(approved, { requestCount: 500, minimumRequests: 100, errorRatePct: 0, errorRateThresholdPct: 1, p95LatencyMs: 50, p95LatencyThresholdMs: 500, observedBy: agent.principalId, observer: agent, evidenceRef: "metrics://agent/canary/1" });
  assert.equal(canary.canary.observer.principalType, "ai_agent");
  assert.throws(() => promotePlatformRelease(canary, { promotedBy: agent.principalId, promoter: agent, promotionRef: "deploy://agent/1" }), (error) => error.code === "release_human_authority_required");
});

test("platform agent credential is proposal-only and API records model lineage", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-release-agent-"));
  const credential = { agentId: "agent_release_api", secret: "agent-secret-1", status: "active", credentialId: "cred_release_api", agentInstallationId: "install_release_api", modelId: "release-copilot", modelVersion: "1.0.0", promptHash: "c".repeat(64), guardrailDecisionRef: "guardrail://release/api/1" };
  const server = createLoanOsServer({ dataDir, platformAgentCredentials: [credential] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { "content-type": "application/json", "x-platform-agent-id": credential.agentId, "x-platform-agent-key": credential.secret };
  const proposal = { ...releaseInput(), releaseId: "rel_agent_api", version: "2026.07.15-agent", proposedBy: credential.agentId };
  let response = await fetch(`${base}/platform/delivery/releases`, { method: "POST", headers, body: JSON.stringify(proposal) });
  assert.equal(response.status, 201, await response.clone().text());
  const created = (await response.json()).release;
  assert.equal(created.proposer.principalType, "ai_agent");
  assert.equal(created.proposer.modelId, credential.modelId);
  assert.equal(created.proposer.credentialId, credential.credentialId);
  response = await fetch(`${base}/platform/delivery/releases/${proposal.releaseId}/approval`, { method: "POST", headers, body: JSON.stringify({ approvedBy: credential.agentId, approvalRef: "CAB-AI-BLOCKED" }) });
  assert.equal(response.status, 403);
});

test("configuration baseline rejects secrets and reports exact drift", () => {
  assert.throws(() => createConfigurationBaseline({ baselineId: "base_bad", environment: "production", changeTicket: "CHG-1", proposedBy: "maker", approvedBy: "checker", approvalRef: "CAB-1", configuration: { DATABASE_PASSWORD: "secret" } }), (error) => error.code === "configuration_secret_forbidden");
  const baseline = createConfigurationBaseline({
    baselineId: "base_prod_1",
    environment: "production",
    changeTicket: "CHG-2",
    proposedBy: "maker",
    approvedBy: "checker",
    approvalRef: "CAB-2",
    configuration: { LOANOS_RULES_ENGINE: "active", LOANOS_STORAGE_DRIVER: "postgres", API_REPLICAS: 3 },
    secretRefs: ["kms://loanos/master-key", "vault://loanos/database"]
  });
  const assessment = assessConfigurationDrift(baseline, {
    assessmentId: "cfg_assess_1",
    observedBy: "checker",
    evidenceRef: "deploy://config-snapshot/1",
    configuration: { LOANOS_RULES_ENGINE: "shadow", LOANOS_STORAGE_DRIVER: "postgres", EXTRA_FLAG: true },
    secretRefs: ["kms://loanos/master-key"]
  });
  assert.equal(assessment.status, "drift_detected");
  assert.deepEqual(assessment.differences.missing, ["API_REPLICAS"]);
  assert.deepEqual(assessment.differences.unexpected, ["EXTRA_FLAG"]);
  assert.equal(assessment.differences.changed[0].key, "LOANOS_RULES_ENGINE");
  assert.deepEqual(assessment.differences.secretRefsMissing, ["vault://loanos/database"]);
  const uat = createConfigurationBaseline({ baselineId: "base_uat_1", environment: "uat", changeTicket: "CHG-3", proposedBy: "maker", approvedBy: "checker", approvalRef: "CAB-3", configuration: { LOANOS_RULES_ENGINE: "active", LOANOS_STORAGE_DRIVER: "postgres", API_REPLICAS: 1 }, secretRefs: ["kms://loanos/master-key", "vault://loanos/database"] });
  const parity = assessConfigurationParity([baseline, uat], { assessmentId: "parity_1", sourceEnvironment: "uat", targetEnvironment: "production", environmentScopedKeys: ["API_REPLICAS"], observedBy: "checker", evidenceRef: "deploy://parity/1" });
  assert.equal(parity.status, "in_parity");
  assert.deepEqual(parity.excludedEnvironmentScopedKeys, ["API_REPLICAS"]);
});

test("resilience assessment derives error rate and throughput from probe counters", () => {
  const assessment = buildResilienceAssessment({
    assessmentId: "res_1",
    scenario: "concurrency",
    targetRef: "service://loanos-api/health",
    changeTicket: "CHG-3",
    proposedBy: "maker",
    approvedBy: "checker",
    approvalRef: "CAB-3",
    result: { requestCount: 100, errorCount: 1, errorRatePct: 99, p50LatencyMs: 10, p95LatencyMs: 30, p99LatencyMs: 45, throughputRps: 1, durationMs: 2000, concurrency: 10 },
    thresholds: { minimumRequests: 100, maximumErrorRatePct: 2, maximumP95LatencyMs: 50, minimumThroughputRps: 40 }
  });
  assert.equal(assessment.result.errorRatePct, 1);
  assert.equal(assessment.result.throughputRps, 50);
  assert.equal(assessment.status, "passed");
});

test("bounded probe executes concurrent HTTP requests and platform APIs retain delivery evidence", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-platform-delivery-"));
  const platformAdminKey = "delivery-platform-key";
  const server = createLoanOsServer({ dataDir, platformAdminKey });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const adminHeaders = { "content-type": "application/json", "x-platform-admin-key": platformAdminKey };
  async function createUser(userId, email, displayName) {
    const response = await fetch(`${base}/platform/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ userId, email, displayName, password: "PlatformPass1!", mfaRequired: false, mustChangePassword: false, roles: ["platform_admin", "security_admin", "auditor"] }) });
    assert.equal(response.status, 201);
  }
  async function login(email) {
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "platform", email, password: "PlatformPass1!" }) });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  }
  await createUser("release_maker", "maker@delivery.example.in", "Release Maker");
  await createUser("release_checker", "checker@delivery.example.in", "Release Checker");
  const makerCookie = await login("maker@delivery.example.in");
  const checkerCookie = await login("checker@delivery.example.in");
  const post = (path, body, cookie) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });

  const createdResponse = await post("/platform/delivery/releases", releaseInput(), makerCookie);
  assert.equal(createdResponse.status, 201);
  const scanBundleResponse = await post("/platform/security-assurance/scan-bundles", {
    bundleId: "bundle_delivery_2001",
    artifactSha256: releaseInput().artifactSha256,
    sourceRevision: releaseInput().sourceRevision,
    pipelineRunRef: "ci://runs/2001/security",
    recordedBy: "release_maker",
    scans: ["sast", "dast", "dependency", "container", "iac", "secret"].map((type, index) => ({ scanId: `scan_delivery_${type}`, type, status: "passed", tool: `scanner-${type}`, toolVersion: "1.0.0", rulesetRef: `policy://security/${type}/v1`, evidenceRef: `evidence://security/${type}/2001`, startedAt: `2026-07-14T08:0${index}:00.000Z`, completedAt: `2026-07-14T08:1${index}:00.000Z`, findings: { critical: 0, high: 0, medium: 0, low: 0 } }))
  }, makerCookie);
  assert.equal(scanBundleResponse.status, 201);
  const sbomResponse = await post("/platform/security-assurance/sboms", { sbomId: "sbom_delivery_2001", artifactSha256: releaseInput().artifactSha256, documentSha256: "d".repeat(64), format: "cyclonedx", formatVersion: "1.6", componentCount: 20, generator: "delivery-test-pipeline", evidenceRef: "evidence://sbom/2001", signatureRef: "signature://sbom/2001", recordedBy: "release_maker", generatedAt: "2026-07-14T08:20:00.000Z" }, makerCookie);
  assert.equal(sbomResponse.status, 201);
  const approvalResponse = await post(`/platform/delivery/releases/${releaseInput().releaseId}/approval`, { approvedBy: "release_checker", approvalRef: "CAB-2001" }, checkerCookie);
  assert.equal(approvalResponse.status, 200);
  const canaryResponse = await post(`/platform/delivery/releases/${releaseInput().releaseId}/canary`, { requestCount: 1000, minimumRequests: 500, errorRatePct: 0, errorRateThresholdPct: 1, p95LatencyMs: 120, p95LatencyThresholdMs: 500, observedBy: "release_checker", evidenceRef: "metrics://canary/2001" }, checkerCookie);
  assert.equal(canaryResponse.status, 200);
  const promotionResponse = await post(`/platform/delivery/releases/${releaseInput().releaseId}/promotion`, { promotedBy: "release_checker", promotionRef: "deploy://production/2001" }, checkerCookie);
  assert.equal(promotionResponse.status, 200);

  const baselineResponse = await post("/platform/delivery/configuration-baselines", { baselineId: "base_api_prod", environment: "production", changeTicket: "CHG-2002", proposedBy: "release_maker", approvedBy: "release_checker", approvalRef: "CAB-2002", configuration: { LOANOS_RULES_ENGINE: "active", LOANOS_STORAGE_DRIVER: "postgres" }, secretRefs: ["kms://loanos/master-key"] }, checkerCookie);
  assert.equal(baselineResponse.status, 201);
  const uatBaselineResponse = await post("/platform/delivery/configuration-baselines", { baselineId: "base_api_uat", environment: "uat", changeTicket: "CHG-2002-UAT", proposedBy: "release_maker", approvedBy: "release_checker", approvalRef: "CAB-2002-UAT", configuration: { LOANOS_RULES_ENGINE: "shadow", LOANOS_STORAGE_DRIVER: "postgres" }, secretRefs: ["kms://loanos/master-key"] }, checkerCookie);
  assert.equal(uatBaselineResponse.status, 201);
  const driftResponse = await post("/platform/delivery/configuration-assessments", { assessmentId: "cfg_api_1", baselineId: "base_api_prod", observedBy: "release_checker", evidenceRef: "deploy://snapshot/2002", configuration: { LOANOS_RULES_ENGINE: "shadow", LOANOS_STORAGE_DRIVER: "postgres" }, secretRefs: ["kms://loanos/master-key"] }, checkerCookie);
  assert.equal(driftResponse.status, 201);
  assert.equal((await driftResponse.json()).assessment.status, "drift_detected");
  const parityResponse = await post("/platform/delivery/configuration-parity-assessments", { assessmentId: "parity_api_1", sourceEnvironment: "uat", targetEnvironment: "production", environmentScopedKeys: [], observedBy: "release_checker", evidenceRef: "deploy://parity/2002" }, checkerCookie);
  assert.equal(parityResponse.status, 201);
  assert.equal((await parityResponse.json()).assessment.status, "parity_gap");

  const probe = await runResilienceProbe({ targetUrl: `${base}/health`, concurrency: 4, iterations: 20, timeoutMs: 2000 });
  assert.equal(probe.requestCount, 20);
  assert.equal(probe.errorCount, 0);
  assert.equal(Object.values(probe.statusCounts).reduce((sum, count) => sum + count, 0), 20);
  const resilienceResponse = await post("/platform/delivery/resilience-assessments", { assessmentId: "res_api_1", scenario: "concurrency", targetRef: "service://loanos-api/health", changeTicket: "CHG-2003", proposedBy: "release_maker", approvedBy: "release_checker", approvalRef: "CAB-2003", result: probe, thresholds: { minimumRequests: 20, maximumErrorRatePct: 0, maximumP95LatencyMs: 1000, minimumThroughputRps: 1 } }, checkerCookie);
  assert.equal(resilienceResponse.status, 201);
  assert.equal((await resilienceResponse.json()).assessment.status, "passed");

  const rollbackProposalResponse = await post(`/platform/delivery/releases/${releaseInput().releaseId}/rollback-proposal`, { proposedBy: "release_maker", reason: "Canary regression surfaced after full traffic promotion", incidentRef: "INC-2001" }, makerCookie);
  assert.equal(rollbackProposalResponse.status, 200);
  assert.equal((await rollbackProposalResponse.json()).release.status, "rollback_pending_approval");
  const rollbackResponse = await post(`/platform/delivery/releases/${releaseInput().releaseId}/rollback`, { approvedBy: "release_checker", approvalRef: "CAB-EMERGENCY-1" }, checkerCookie);
  assert.equal(rollbackResponse.status, 200);
  assert.equal((await rollbackResponse.json()).release.status, "rolled_back");

  const controlsResponse = await fetch(`${base}/platform/delivery/controls`, { headers: { cookie: checkerCookie } });
  assert.equal(controlsResponse.status, 200);
  const controls = await controlsResponse.json();
  assert.equal(controls.releases[0].status, "rolled_back");
  assert.equal(controls.baselines.length, 2);
  assert.equal(controls.configurationAssessments.length, 1);
  assert.equal(controls.parityAssessments.length, 1);
  assert.equal(controls.resilienceAssessments.length, 1);
});
