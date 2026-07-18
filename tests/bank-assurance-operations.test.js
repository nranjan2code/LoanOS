import test from "node:test";
import assert from "node:assert/strict";
import { assessProductionRelease, recordGovernanceSignoff, recordIndependentAssuranceTest, recordOperationalReadiness, recordSourceEtlRun, registerInstitutionConfiguration, remediateAssuranceFinding } from "@loanos/core/compliance/bank-assurance-operations.js";
const NOW = new Date("2026-07-15T00:00:00.000Z"); const sha = "a".repeat(64); const approval = { proposedBy: "maker", approvedBy: "checker", approvalRef: "approval/1", evidenceRefs: ["evidence/1"] };

test("configuration and ETL require independent approval and exact reconciliation", () => {
  assert.throws(() => registerInstitutionConfiguration({}, { configurationId: "cfg", policyRef: "p", riskMethodologyRef: "r", approvalMatrixRef: "a", configurationChecksumSha256: sha, ...approval, approvedBy: "maker" }, NOW), (e) => e.code === "bank_assurance_four_eyes_required");
  let result = registerInstitutionConfiguration({}, { configurationId: "cfg", policyRef: "p", riskMethodologyRef: "r", approvalMatrixRef: "a", configurationChecksumSha256: sha, ...approval }, NOW);
  assert.throws(() => recordSourceEtlRun(result.state, { runId: "etl", sourceChecksumSha256: sha, targetChecksumSha256: sha, extractedCount: 10, loadedCount: 9, rejectedCount: 1, reconciliationStatus: "variance", ...approval }, NOW), (e) => e.code === "bank_etl_reconciliation_failed");
  result = recordSourceEtlRun(result.state, { runId: "etl", sourceChecksumSha256: sha, targetChecksumSha256: sha, extractedCount: 10, loadedCount: 10, rejectedCount: 0, reconciliationStatus: "exact", ...approval }, NOW); assert.equal(result.run.status, "certified");
});

test("operational readiness binds UAT, training, witnessed cutover and DR evidence", () => {
  const input = { readinessId: "ready", uat: { status: "passed", businessSignoffRef: "uat/1", openCriticalDefects: 0 }, training: { status: "completed", completionPercent: 100, attendanceEvidenceRef: "training/1" }, cutover: { status: "passed", witnessedBy: "auditor", rollbackPlanRef: "rollback/1" }, drExercise: { status: "passed", witnessedBy: "auditor", rtoMet: true, rpoMet: true, restorationEvidenceRef: "dr/1" }, ...approval };
  assert.equal(recordOperationalReadiness({}, input, NOW).readiness.status, "ready");
  assert.throws(() => recordOperationalReadiness({}, { ...input, drExercise: { ...input.drExercise, rpoMet: false } }, NOW), (e) => e.code === "bank_dr_failed");
});

test("independent assurance findings require independently verified remediation", () => {
  let result = recordIndependentAssuranceTest({}, { testId: "sec", domain: "security", assessor: "auditor", assessorOrganisation: "auditco", implementerOrganisation: "bank", controlOwner: "owner", findings: [{ findingId: "f1", severity: "high", description: "Access weakness" }], evidenceRefs: ["report/sec"] }, NOW);
  assert.equal(result.testRecord.status, "issues_open");
  assert.throws(() => remediateAssuranceFinding(result.state, { testId: "sec", findingId: "f1", remediatedBy: "operator", remediationRef: "fix/1", ...approval, approvedBy: "operator" }, NOW), (e) => e.code === "bank_assurance_remediation_independence_required");
  result = remediateAssuranceFinding(result.state, { testId: "sec", findingId: "f1", remediatedBy: "operator", remediationRef: "fix/1", ...approval }, NOW); assert.equal(result.testRecord.status, "passed");
});

test("production assessment denies missing controls and allows only the complete evidence chain", () => {
  assert.deepEqual(assessProductionRelease({}, {}).outcome, "deny"); let state = {};
  state = registerInstitutionConfiguration(state, { configurationId: "cfg", policyRef: "p", riskMethodologyRef: "r", approvalMatrixRef: "a", configurationChecksumSha256: sha, ...approval }, NOW).state;
  state = recordSourceEtlRun(state, { runId: "etl", sourceChecksumSha256: sha, targetChecksumSha256: sha, extractedCount: 1, loadedCount: 1, rejectedCount: 0, reconciliationStatus: "exact", ...approval }, NOW).state;
  state = recordOperationalReadiness(state, { readinessId: "ready", uat: { status: "passed", businessSignoffRef: "u", openCriticalDefects: 0 }, training: { status: "completed", completionPercent: 100, attendanceEvidenceRef: "t" }, cutover: { status: "passed", witnessedBy: "auditor", rollbackPlanRef: "rb" }, drExercise: { status: "passed", witnessedBy: "auditor", rtoMet: true, rpoMet: true, restorationEvidenceRef: "dr" }, ...approval }, NOW).state;
  for (const domain of ["security", "model", "compliance", "control_effectiveness"]) state = recordIndependentAssuranceTest(state, { testId: domain, domain, assessor: `auditor-${domain}`, assessorOrganisation: "auditco", implementerOrganisation: "bank", controlOwner: "owner", findings: [], evidenceRefs: [`report/${domain}`] }, NOW).state;
  state = recordGovernanceSignoff(state, { signoffId: "sign", certificationStatus: "certified", certificationRef: "cert/1", committeeDecision: "approved", committeeMinutesRef: "minutes/1", ...approval }, NOW).state;
  const assessment = assessProductionRelease(state, { configurationId: "cfg", etlRunId: "etl", readinessId: "ready", signoffId: "sign" }); assert.equal(assessment.outcome, "allow"); assert.deepEqual(assessment.blockers, []); assert.match(assessment.evidenceChecksumSha256, /^[a-f0-9]{64}$/);
});
