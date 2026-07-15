import { createHash } from "node:crypto";

const RELEASE_RISKS = new Set(["low", "medium", "high", "critical"]);
const RELEASE_ENVIRONMENTS = new Set(["development", "test", "uat", "production"]);
const RESILIENCE_SCENARIOS = new Set(["load", "soak", "concurrency", "volume", "dependency_failure", "recovery", "degraded_mode"]);

export function createPlatformRelease(input, existingReleases = [], now = new Date()) {
  requireText(input.releaseId, "releaseId");
  requireText(input.version, "version");
  requireDigest(input.artifactSha256, "artifactSha256");
  requireText(input.sourceRevision, "sourceRevision");
  requireText(input.changeTicket, "changeTicket");
  requireText(input.proposedBy, "proposedBy");
  const proposer = normalizeReleasePrincipal(input.proposer, input.proposedBy, "proposer");
  requireText(input.rollbackVersion, "rollbackVersion");
  requireText(input.rollbackProcedureRef, "rollbackProcedureRef");
  if (!RELEASE_RISKS.has(input.riskLevel)) throw deliveryError("release_invalid", "riskLevel is invalid.");
  const environment = input.environment ?? "production";
  if (!RELEASE_ENVIRONMENTS.has(environment)) throw deliveryError("release_invalid", "environment is invalid.");
  if (existingReleases.some((release) => release.releaseId === input.releaseId || (release.version === input.version && release.environment === environment && release.status !== "rolled_back"))) {
    throw deliveryError("release_duplicate", "Release id or active version already exists in this environment.");
  }
  const evidence = normalizeEvidence(input.evidence);
  const required = ["testRunRef", "securityScanRef", "buildProvenanceRef", "recoveryPointRef"];
  if (required.some((field) => !evidence[field])) throw deliveryError("release_evidence_missing", `Release evidence requires ${required.join(", ")}.`);
  return {
    releaseId: String(input.releaseId),
    version: String(input.version),
    artifactSha256: input.artifactSha256.toLowerCase(),
    sourceRevision: String(input.sourceRevision),
    environment,
    riskLevel: input.riskLevel,
    changeTicket: String(input.changeTicket),
    proposedBy: String(input.proposedBy),
    proposer,
    rollbackVersion: String(input.rollbackVersion),
    rollbackProcedureRef: String(input.rollbackProcedureRef),
    evidence,
    status: "pending_approval",
    createdAt: now.toISOString()
  };
}

export function approvePlatformRelease(release, input, now = new Date()) {
  requireStatus(release, "pending_approval");
  requireText(input.approvedBy, "approvedBy");
  requireText(input.approvalRef, "approvalRef");
  const approver = normalizeReleasePrincipal(input.approver, input.approvedBy, "approver");
  requireHumanReleasePrincipal(approver, "Release approval");
  if (input.approvedBy === release.proposedBy) throw deliveryError("release_four_eyes_required", "Release approver must be independent of proposer.");
  return { ...release, status: "approved", approvedBy: String(input.approvedBy), approver, approvalRef: String(input.approvalRef), approvedAt: now.toISOString() };
}

export function evaluatePlatformCanary(release, input, now = new Date()) {
  requireStatus(release, "approved", "canary_failed");
  const requestCount = positiveInteger(input.requestCount, "requestCount");
  const errorRatePct = nonNegativeNumber(input.errorRatePct, "errorRatePct");
  const p95LatencyMs = nonNegativeNumber(input.p95LatencyMs, "p95LatencyMs");
  const errorRateThresholdPct = nonNegativeNumber(input.errorRateThresholdPct, "errorRateThresholdPct");
  const p95LatencyThresholdMs = positiveNumber(input.p95LatencyThresholdMs, "p95LatencyThresholdMs");
  requireText(input.observedBy, "observedBy");
  requireText(input.evidenceRef, "evidenceRef");
  const observer = normalizeReleasePrincipal(input.observer, input.observedBy, "observer");
  const minimumRequests = positiveInteger(input.minimumRequests ?? 100, "minimumRequests");
  const passed = requestCount >= minimumRequests && errorRatePct <= errorRateThresholdPct && p95LatencyMs <= p95LatencyThresholdMs;
  return {
    ...release,
    status: passed ? "canary_passed" : "canary_failed",
    canary: {
      requestCount,
      minimumRequests,
      errorRatePct,
      errorRateThresholdPct,
      p95LatencyMs,
      p95LatencyThresholdMs,
      observedBy: String(input.observedBy),
      observer,
      evidenceRef: String(input.evidenceRef),
      outcome: passed ? "passed" : "failed",
      evaluatedAt: now.toISOString()
    }
  };
}

export function promotePlatformRelease(release, input, now = new Date()) {
  requireStatus(release, "canary_passed");
  requireText(input.promotedBy, "promotedBy");
  requireText(input.promotionRef, "promotionRef");
  const promoter = normalizeReleasePrincipal(input.promoter, input.promotedBy, "promoter");
  requireHumanReleasePrincipal(promoter, "Production promotion");
  if (input.promotedBy === release.proposedBy) throw deliveryError("release_four_eyes_required", "Release promoter must be independent of proposer.");
  return { ...release, status: "deployed", promotedBy: String(input.promotedBy), promoter, promotionRef: String(input.promotionRef), deployedAt: now.toISOString() };
}

export function rollbackPlatformRelease(release, input, now = new Date()) {
  const proposed = proposePlatformRollback(release, input, now);
  return approvePlatformRollback(proposed, input, now);
}

export function proposePlatformRollback(release, input, now = new Date()) {
  requireStatus(release, "deployed");
  requireText(input.proposedBy, "proposedBy");
  requireText(input.reason, "reason", 8);
  requireText(input.incidentRef ?? input.changeTicket, "incidentRef or changeTicket");
  const proposer = normalizeReleasePrincipal(input.proposer, input.proposedBy, "rollback proposer");
  return { ...release, status: "rollback_pending_approval", rollbackProposal: { targetVersion: release.rollbackVersion, proposedBy: String(input.proposedBy), proposer, reason: String(input.reason), incidentRef: input.incidentRef ? String(input.incidentRef) : null, changeTicket: input.changeTicket ? String(input.changeTicket) : null, proposedAt: now.toISOString() } };
}

export function approvePlatformRollback(release, input, now = new Date()) {
  requireStatus(release, "rollback_pending_approval");
  requireText(input.approvedBy, "approvedBy");
  requireText(input.approvalRef, "approvalRef");
  const rollbackApprover = normalizeReleasePrincipal(input.approver, input.approvedBy, "rollback approver");
  requireHumanReleasePrincipal(rollbackApprover, "Rollback approval");
  if (release.rollbackProposal.proposedBy === input.approvedBy) throw deliveryError("release_four_eyes_required", "Rollback requires independent proposer and approver.");
  return {
    ...release,
    status: "rolled_back",
    rollback: {
      targetVersion: release.rollbackVersion,
      proposedBy: release.rollbackProposal.proposedBy,
      proposer: release.rollbackProposal.proposer,
      approvedBy: String(input.approvedBy),
      approver: rollbackApprover,
      approvalRef: String(input.approvalRef),
      reason: release.rollbackProposal.reason,
      incidentRef: release.rollbackProposal.incidentRef,
      changeTicket: release.rollbackProposal.changeTicket,
      rolledBackAt: now.toISOString()
    }
  };
}

function normalizeReleasePrincipal(value, fallbackId, label) {
  const principal = value ?? { principalId: fallbackId, principalType: "human", authenticationSource: "legacy_domain_call" };
  requireText(principal.principalId, `${label}.principalId`);
  if (!["human", "ai_agent", "service"].includes(principal.principalType)) throw deliveryError("release_principal_invalid", `${label}.principalType is invalid.`);
  requireText(principal.authenticationSource, `${label}.authenticationSource`);
  if (principal.principalId !== String(fallbackId)) throw deliveryError("release_principal_mismatch", `${label}.principalId must match the attributed actor.`);
  if (principal.principalType === "ai_agent") {
    requireText(principal.agentInstallationId, `${label}.agentInstallationId`);
    requireText(principal.modelId, `${label}.modelId`);
    requireText(principal.modelVersion, `${label}.modelVersion`);
    requireDigest(principal.promptHash, `${label}.promptHash`);
    requireText(principal.guardrailDecisionRef, `${label}.guardrailDecisionRef`);
  }
  return {
    principalId: String(principal.principalId),
    principalType: principal.principalType,
    authenticationSource: String(principal.authenticationSource),
    ...(principal.credentialId ? { credentialId: String(principal.credentialId) } : {}),
    ...(principal.agentInstallationId ? { agentInstallationId: String(principal.agentInstallationId) } : {}),
    ...(principal.modelId ? { modelId: String(principal.modelId) } : {}),
    ...(principal.modelVersion ? { modelVersion: String(principal.modelVersion) } : {}),
    ...(principal.promptHash ? { promptHash: String(principal.promptHash).toLowerCase() } : {}),
    ...(principal.guardrailDecisionRef ? { guardrailDecisionRef: String(principal.guardrailDecisionRef) } : {})
  };
}

function requireHumanReleasePrincipal(principal, action) {
  if (principal.principalType !== "human") throw deliveryError("release_human_authority_required", `${action} requires an authenticated human principal.`);
}

export function createConfigurationBaseline(input, now = new Date()) {
  requireText(input.baselineId, "baselineId");
  if (!RELEASE_ENVIRONMENTS.has(input.environment)) throw deliveryError("configuration_baseline_invalid", "environment is invalid.");
  requireText(input.changeTicket, "changeTicket");
  requireText(input.proposedBy, "proposedBy");
  requireText(input.approvedBy, "approvedBy");
  requireText(input.approvalRef, "approvalRef");
  if (input.proposedBy === input.approvedBy) throw deliveryError("configuration_four_eyes_required", "Configuration baseline requires an independent approver.");
  const configuration = normalizeConfiguration(input.configuration);
  const secretRefs = normalizeSecretRefs(input.secretRefs);
  return {
    baselineId: String(input.baselineId),
    environment: input.environment,
    changeTicket: String(input.changeTicket),
    proposedBy: String(input.proposedBy),
    approvedBy: String(input.approvedBy),
    approvalRef: String(input.approvalRef),
    configuration,
    secretRefs,
    configurationSha256: canonicalDigest({ configuration, secretRefs }),
    status: "active",
    approvedAt: now.toISOString()
  };
}

export function assessConfigurationDrift(baseline, input, now = new Date()) {
  if (!baseline || baseline.status !== "active") throw deliveryError("configuration_baseline_missing", "An active configuration baseline is required.");
  requireText(input.assessmentId, "assessmentId");
  requireText(input.observedBy, "observedBy");
  requireText(input.evidenceRef, "evidenceRef");
  const observed = normalizeConfiguration(input.configuration);
  const observedSecretRefs = normalizeSecretRefs(input.secretRefs);
  const expectedKeys = new Set(Object.keys(baseline.configuration));
  const observedKeys = new Set(Object.keys(observed));
  const missing = [...expectedKeys].filter((key) => !observedKeys.has(key)).sort();
  const unexpected = [...observedKeys].filter((key) => !expectedKeys.has(key)).sort();
  const changed = [...expectedKeys].filter((key) => observedKeys.has(key) && JSON.stringify(baseline.configuration[key]) !== JSON.stringify(observed[key])).sort().map((key) => ({ key, expected: baseline.configuration[key], observed: observed[key] }));
  const expectedSecretRefs = new Set(baseline.secretRefs);
  const secretRefsMissing = [...expectedSecretRefs].filter((ref) => !observedSecretRefs.includes(ref)).sort();
  const secretRefsUnexpected = observedSecretRefs.filter((ref) => !expectedSecretRefs.has(ref)).sort();
  const driftCount = missing.length + unexpected.length + changed.length + secretRefsMissing.length + secretRefsUnexpected.length;
  return {
    assessmentId: String(input.assessmentId),
    baselineId: baseline.baselineId,
    environment: baseline.environment,
    status: driftCount === 0 ? "in_sync" : "drift_detected",
    driftCount,
    differences: { missing, unexpected, changed, secretRefsMissing, secretRefsUnexpected },
    observedConfigurationSha256: canonicalDigest({ configuration: observed, secretRefs: observedSecretRefs }),
    observedBy: String(input.observedBy),
    evidenceRef: String(input.evidenceRef),
    assessedAt: now.toISOString()
  };
}

export function assessConfigurationParity(baselines, input, now = new Date()) {
  requireText(input.assessmentId, "assessmentId");
  requireText(input.observedBy, "observedBy");
  requireText(input.evidenceRef, "evidenceRef");
  if (input.sourceEnvironment === input.targetEnvironment) throw deliveryError("configuration_parity_invalid", "Parity requires two different environments.");
  const source = baselines.find((baseline) => baseline.environment === input.sourceEnvironment && baseline.status === "active");
  const target = baselines.find((baseline) => baseline.environment === input.targetEnvironment && baseline.status === "active");
  if (!source || !target) throw deliveryError("configuration_baseline_missing", "Active source and target environment baselines are required.");
  const excludedKeys = [...new Set(Array.isArray(input.environmentScopedKeys) ? input.environmentScopedKeys.map(String) : [])].sort();
  for (const key of excludedKeys) if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(key)) throw deliveryError("configuration_parity_invalid", `Environment-scoped key ${key} is invalid.`);
  const sourceConfig = Object.fromEntries(Object.entries(source.configuration).filter(([key]) => !excludedKeys.includes(key)));
  const targetConfig = Object.fromEntries(Object.entries(target.configuration).filter(([key]) => !excludedKeys.includes(key)));
  const sourceKeys = new Set(Object.keys(sourceConfig));
  const targetKeys = new Set(Object.keys(targetConfig));
  const missingInTarget = [...sourceKeys].filter((key) => !targetKeys.has(key)).sort();
  const unexpectedInTarget = [...targetKeys].filter((key) => !sourceKeys.has(key)).sort();
  const changed = [...sourceKeys].filter((key) => targetKeys.has(key) && JSON.stringify(sourceConfig[key]) !== JSON.stringify(targetConfig[key])).sort().map((key) => ({ key, source: sourceConfig[key], target: targetConfig[key] }));
  const sourceSecretRefs = new Set(source.secretRefs);
  const targetSecretRefs = new Set(target.secretRefs);
  const secretRefsMissingInTarget = [...sourceSecretRefs].filter((ref) => !targetSecretRefs.has(ref)).sort();
  const secretRefsUnexpectedInTarget = [...targetSecretRefs].filter((ref) => !sourceSecretRefs.has(ref)).sort();
  const differenceCount = missingInTarget.length + unexpectedInTarget.length + changed.length + secretRefsMissingInTarget.length + secretRefsUnexpectedInTarget.length;
  return {
    assessmentId: String(input.assessmentId),
    sourceBaselineId: source.baselineId,
    targetBaselineId: target.baselineId,
    sourceEnvironment: source.environment,
    targetEnvironment: target.environment,
    excludedEnvironmentScopedKeys: excludedKeys,
    status: differenceCount === 0 ? "in_parity" : "parity_gap",
    differenceCount,
    differences: { missingInTarget, unexpectedInTarget, changed, secretRefsMissingInTarget, secretRefsUnexpectedInTarget },
    observedBy: String(input.observedBy),
    evidenceRef: String(input.evidenceRef),
    assessedAt: now.toISOString()
  };
}

export function buildResilienceAssessment(input, now = new Date()) {
  requireText(input.assessmentId, "assessmentId");
  if (!RESILIENCE_SCENARIOS.has(input.scenario)) throw deliveryError("resilience_assessment_invalid", "scenario is invalid.");
  requireText(input.targetRef, "targetRef");
  requireText(input.changeTicket, "changeTicket");
  requireText(input.proposedBy, "proposedBy");
  requireText(input.approvedBy, "approvedBy");
  requireText(input.approvalRef, "approvalRef");
  if (input.proposedBy === input.approvedBy) throw deliveryError("resilience_four_eyes_required", "Resilience assessment requires an independent approver.");
  const result = normalizeProbeResult(input.result);
  const thresholds = {
    minimumRequests: positiveInteger(input.thresholds?.minimumRequests, "thresholds.minimumRequests"),
    maximumErrorRatePct: nonNegativeNumber(input.thresholds?.maximumErrorRatePct, "thresholds.maximumErrorRatePct"),
    maximumP95LatencyMs: positiveNumber(input.thresholds?.maximumP95LatencyMs, "thresholds.maximumP95LatencyMs"),
    minimumThroughputRps: positiveNumber(input.thresholds?.minimumThroughputRps, "thresholds.minimumThroughputRps")
  };
  const checks = {
    requestVolume: result.requestCount >= thresholds.minimumRequests,
    errorRate: result.errorRatePct <= thresholds.maximumErrorRatePct,
    latency: result.p95LatencyMs <= thresholds.maximumP95LatencyMs,
    throughput: result.throughputRps >= thresholds.minimumThroughputRps
  };
  const passed = Object.values(checks).every(Boolean);
  return {
    assessmentId: String(input.assessmentId),
    scenario: input.scenario,
    targetRef: String(input.targetRef),
    changeTicket: String(input.changeTicket),
    proposedBy: String(input.proposedBy),
    approvedBy: String(input.approvedBy),
    approvalRef: String(input.approvalRef),
    status: passed ? "passed" : "failed",
    result,
    thresholds,
    checks,
    evidenceSha256: canonicalDigest({ result, thresholds, checks }),
    findings: Array.isArray(input.findings) ? input.findings.map(String).filter(Boolean) : [],
    actions: Array.isArray(input.actions) ? input.actions.map(String).filter(Boolean) : [],
    assessedAt: now.toISOString()
  };
}

export function projectPlatformDelivery(events = []) {
  const releases = new Map();
  const baselines = new Map();
  const configurationAssessments = [];
  const parityAssessments = [];
  const resilienceAssessments = [];
  for (const event of events) {
    if (event.type?.startsWith("platform.delivery.release_") && event.release?.releaseId) releases.set(event.release.releaseId, event.release);
    if (event.type === "platform.delivery.configuration_baseline_approved" && event.baseline?.environment) baselines.set(event.baseline.environment, event.baseline);
    if (event.type === "platform.delivery.configuration_assessed" && event.assessment) configurationAssessments.push(event.assessment);
    if (event.type === "platform.delivery.configuration_parity_assessed" && event.assessment) parityAssessments.push(event.assessment);
    if (event.type === "platform.delivery.resilience_assessed" && event.assessment) resilienceAssessments.push(event.assessment);
  }
  return { releases: [...releases.values()], baselines: [...baselines.values()], configurationAssessments, parityAssessments, resilienceAssessments };
}

function normalizeEvidence(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && String(item).trim()).map(([key, item]) => [key, String(item)]));
}

function normalizeConfiguration(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw deliveryError("configuration_invalid", "configuration must be an object.");
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(key)) throw deliveryError("configuration_invalid", `Configuration key ${key} is invalid.`);
    if (/(SECRET|PASSWORD|TOKEN|PRIVATE_KEY|API_KEY|MASTER_KEY|CREDENTIAL)/.test(key)) throw deliveryError("configuration_secret_forbidden", `Secret-bearing key ${key} must be represented only by a secret reference.`);
    const item = value[key];
    if (!["string", "number", "boolean"].includes(typeof item) || (typeof item === "string" && item.length > 512)) throw deliveryError("configuration_invalid", `Configuration value ${key} must be a bounded scalar.`);
    result[key] = item;
  }
  return result;
}

function normalizeSecretRefs(value = []) {
  if (!Array.isArray(value)) throw deliveryError("configuration_invalid", "secretRefs must be an array.");
  return [...new Set(value.map(String))].sort().map((ref) => {
    if (!/^(kms|vault|secret):\/\/[a-zA-Z0-9._\/-]{3,256}$/.test(ref)) throw deliveryError("configuration_secret_ref_invalid", "Secret references must use kms://, vault://, or secret:// without secret values.");
    return ref;
  });
}

function normalizeProbeResult(result = {}) {
  const requestCount = positiveInteger(result.requestCount, "result.requestCount");
  const errorCount = nonNegativeInteger(result.errorCount, "result.errorCount");
  if (errorCount > requestCount) throw deliveryError("resilience_assessment_invalid", "errorCount cannot exceed requestCount.");
  const p50LatencyMs = nonNegativeNumber(result.p50LatencyMs, "result.p50LatencyMs");
  const p95LatencyMs = nonNegativeNumber(result.p95LatencyMs, "result.p95LatencyMs");
  const p99LatencyMs = nonNegativeNumber(result.p99LatencyMs, "result.p99LatencyMs");
  if (p50LatencyMs > p95LatencyMs || p95LatencyMs > p99LatencyMs) throw deliveryError("resilience_assessment_invalid", "Latency percentiles must be monotonic.");
  const durationMs = positiveNumber(result.durationMs, "result.durationMs");
  return {
    requestCount,
    errorCount,
    errorRatePct: round((errorCount / requestCount) * 100, 4),
    p50LatencyMs,
    p95LatencyMs,
    p99LatencyMs,
    throughputRps: round(requestCount / (durationMs / 1000), 4),
    durationMs,
    concurrency: positiveInteger(result.concurrency, "result.concurrency")
  };
}

function requireStatus(release, ...statuses) {
  if (!release || !statuses.includes(release.status)) throw deliveryError("release_transition_invalid", `Release must be ${statuses.join(" or ")}.`);
}

function requireText(value, label, minimum = 1) {
  if (typeof value !== "string" || value.trim().length < minimum) throw deliveryError("delivery_field_required", `${label} is required.`);
}

function requireDigest(value, label) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ""))) throw deliveryError("release_invalid", `${label} must be a SHA-256 digest.`);
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw deliveryError("delivery_number_invalid", `${label} must be a positive integer.`);
  return parsed;
}

function nonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw deliveryError("delivery_number_invalid", `${label} must be a non-negative integer.`);
  return parsed;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw deliveryError("delivery_number_invalid", `${label} must be positive.`);
  return parsed;
}

function nonNegativeNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw deliveryError("delivery_number_invalid", `${label} must be non-negative.`);
  return parsed;
}

function canonicalDigest(value) {
  return createHash("sha256").update(JSON.stringify(sortDeep(value))).digest("hex");
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]));
  return value;
}

function deliveryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
