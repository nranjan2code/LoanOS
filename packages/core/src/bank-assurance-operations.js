import { createHash } from "node:crypto";

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("bank_assurance_input_invalid", `${field} is required.`); return value.trim(); }
function fourEyes(input) { text(input.proposedBy, "proposedBy"); text(input.approvedBy, "approvedBy"); text(input.approvalRef, "approvalRef"); if (input.proposedBy === input.approvedBy) fail("bank_assurance_four_eyes_required", "Independent approval is required."); }
function sha(value) { return createHash("sha256").update(JSON.stringify(value, Object.keys(value).sort())).digest("hex"); }
function validSha(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function map(state, key) { return state[key] ?? {}; }
function evidence(input) { if (!input.evidenceRefs?.length || input.evidenceRefs.some((item) => typeof item !== "string" || !item)) fail("bank_assurance_evidence_required", "Retained evidence is required."); }

export function registerInstitutionConfiguration(state, input, now = new Date()) {
  fourEyes(input); const configurationId = text(input.configurationId, "configurationId");
  if (map(state, "institutionConfigurations")[configurationId]) fail("bank_configuration_exists", "Configuration already exists.");
  for (const field of ["policyRef", "riskMethodologyRef", "approvalMatrixRef"]) text(input[field], field);
  if (!validSha(input.configurationChecksumSha256)) fail("bank_assurance_checksum_invalid", "Configuration checksum must be SHA-256."); evidence(input);
  const configuration = { ...input, configurationId, status: "approved", approvedAt: now.toISOString() };
  return { state: { ...state, institutionConfigurations: { ...map(state, "institutionConfigurations"), [configurationId]: configuration } }, configuration };
}

export function recordSourceEtlRun(state, input, now = new Date()) {
  fourEyes(input); const runId = text(input.runId, "runId"); evidence(input);
  if (!validSha(input.sourceChecksumSha256) || !validSha(input.targetChecksumSha256)) fail("bank_assurance_checksum_invalid", "Source and target checksums are required.");
  if (!Number.isInteger(input.extractedCount) || input.extractedCount < 0 || input.extractedCount !== input.loadedCount || input.rejectedCount !== 0 || input.reconciliationStatus !== "exact") fail("bank_etl_reconciliation_failed", "ETL must reconcile exactly with no rejected records.");
  const run = { ...input, runId, status: "certified", certifiedAt: now.toISOString() };
  return { state: { ...state, sourceEtlRuns: { ...map(state, "sourceEtlRuns"), [runId]: run } }, run };
}

export function recordOperationalReadiness(state, input, now = new Date()) {
  fourEyes(input); evidence(input); const readinessId = text(input.readinessId, "readinessId");
  const uat = input.uat; const training = input.training; const cutover = input.cutover; const dr = input.drExercise;
  if (uat?.status !== "passed" || !uat.businessSignoffRef || uat.openCriticalDefects !== 0) fail("bank_uat_incomplete", "UAT must pass with business signoff and no critical defects.");
  if (training?.status !== "completed" || training.completionPercent !== 100 || !training.attendanceEvidenceRef) fail("bank_training_incomplete", "Required staff training must be complete.");
  if (cutover?.status !== "passed" || !cutover.witnessedBy || cutover.witnessedBy === input.proposedBy || !cutover.rollbackPlanRef) fail("bank_cutover_not_witnessed", "Cutover must pass with an independent witness and rollback plan.");
  if (dr?.status !== "passed" || !dr.witnessedBy || !dr.rtoMet || !dr.rpoMet || !dr.restorationEvidenceRef) fail("bank_dr_failed", "Witnessed DR must meet RTO and RPO.");
  const readiness = { ...input, readinessId, status: "ready", approvedAt: now.toISOString() };
  return { state: { ...state, operationalReadiness: { ...map(state, "operationalReadiness"), [readinessId]: readiness } }, readiness };
}

export function recordIndependentAssuranceTest(state, input, now = new Date()) {
  const testId = text(input.testId, "testId"); const domain = text(input.domain, "domain");
  if (!["security", "model", "compliance", "control_effectiveness"].includes(domain)) fail("bank_assurance_domain_invalid", "Unsupported assurance domain.");
  text(input.assessor, "assessor"); text(input.assessorOrganisation, "assessorOrganisation"); evidence(input);
  if (input.assessor === input.controlOwner || input.assessorOrganisation === input.implementerOrganisation) fail("bank_assurance_independence_required", "Assessor must be independent of implementation and control ownership.");
  if (!Array.isArray(input.findings)) fail("bank_assurance_findings_required", "Assurance findings are required.");
  const findings = input.findings.map((item, index) => ({ findingId: item.findingId ?? `${testId}:${index + 1}`, severity: item.severity, description: text(item.description, "description"), status: "open" }));
  if (findings.some((item) => !["low", "medium", "high", "critical"].includes(item.severity))) fail("bank_assurance_severity_invalid", "Finding severity is invalid.");
  const testRecord = { ...input, testId, domain, findings, status: findings.length ? "issues_open" : "passed", assessedAt: now.toISOString() };
  return { state: { ...state, independentAssuranceTests: { ...map(state, "independentAssuranceTests"), [testId]: testRecord } }, testRecord };
}

export function remediateAssuranceFinding(state, input, now = new Date()) {
  fourEyes(input); evidence(input); const testRecord = map(state, "independentAssuranceTests")[input.testId];
  if (!testRecord) fail("bank_assurance_test_missing", "Assurance test does not exist.");
  const finding = testRecord.findings.find((item) => item.findingId === input.findingId); if (!finding || finding.status !== "open") fail("bank_assurance_finding_not_open", "Open finding does not exist.");
  if (input.approvedBy === testRecord.controlOwner || input.approvedBy === input.remediatedBy) fail("bank_assurance_remediation_independence_required", "Independent remediation verification is required.");
  const findings = testRecord.findings.map((item) => item.findingId === input.findingId ? { ...item, status: "closed", remediationRef: text(input.remediationRef, "remediationRef"), verifiedBy: input.approvedBy, closedAt: now.toISOString() } : item);
  const updated = { ...testRecord, findings, status: findings.every((item) => item.status === "closed") ? "passed" : "issues_open" };
  return { state: { ...state, independentAssuranceTests: { ...map(state, "independentAssuranceTests"), [input.testId]: updated } }, testRecord: updated };
}

export function recordGovernanceSignoff(state, input, now = new Date()) {
  fourEyes(input); evidence(input); const signoffId = text(input.signoffId, "signoffId");
  if (input.certificationStatus !== "certified" || input.committeeDecision !== "approved" || !input.committeeMinutesRef || !input.certificationRef) fail("bank_governance_signoff_incomplete", "Certification and committee approval are required.");
  const signoff = { ...input, signoffId, status: "approved", approvedAt: now.toISOString() };
  return { state: { ...state, governanceSignoffs: { ...map(state, "governanceSignoffs"), [signoffId]: signoff } }, signoff };
}

export function assessProductionRelease(state, input) {
  const configuration = map(state, "institutionConfigurations")[input.configurationId]; const etl = map(state, "sourceEtlRuns")[input.etlRunId]; const readiness = map(state, "operationalReadiness")[input.readinessId]; const signoff = map(state, "governanceSignoffs")[input.signoffId];
  const requiredDomains = ["security", "model", "compliance", "control_effectiveness"];
  const tests = Object.values(map(state, "independentAssuranceTests")); const missingDomains = requiredDomains.filter((domain) => !tests.some((item) => item.domain === domain && item.status === "passed"));
  const blockers = [];
  if (configuration?.status !== "approved") blockers.push("institution_configuration"); if (etl?.status !== "certified") blockers.push("source_etl"); if (readiness?.status !== "ready") blockers.push("operational_readiness"); if (signoff?.status !== "approved") blockers.push("governance_signoff"); blockers.push(...missingDomains.map((domain) => `assurance:${domain}`));
  return { outcome: blockers.length ? "deny" : "allow", blockers, evidenceChecksumSha256: sha({ configurationId: input.configurationId, etlRunId: input.etlRunId, readinessId: input.readinessId, signoffId: input.signoffId, passedTestIds: tests.filter((item) => item.status === "passed").map((item) => item.testId).sort() }) };
}
