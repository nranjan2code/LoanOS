import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assessGoLiveReadiness,
  assessParallelRun,
  createImplementationProject,
  createUatCampaign,
  executeCutover,
  recordMigrationRun,
  recordTrainingCertification,
  registerMigrationMapping,
  reviewHypercare,
  validateOpeningBalances
} from "../packages/core/src/index.js";
import { createLoanOsServer } from "../apps/api/src/server.js";

const NOW = new Date("2026-07-14T00:00:00.000Z"); const approval = { proposedBy: "implementation_maker", approvedBy: "implementation_checker", approvalRef: "approval-1" }; const sha = (value) => createHash("sha256").update(value).digest("hex");
function projectResult() { return createImplementationProject({}, { projectId: "project-1", name: "Core migration", products: ["personal-loan"], sourceSystems: ["legacy-los"], roles: ["operations", "finance"], configuration: { businessDate: "2026-08-01", productVersion: "v1" }, configurationChecksumSha256: sha("config"), targetEnvironment: "production", dataFreezeAt: "2026-08-01T00:00:00.000Z", rollbackPlanRef: "runbook/rollback", owner: "implementation_owner", ...approval }, NOW); }
function mappingResult(project) { return registerMigrationMapping({}, project, { mappingId: "mapping-1", entities: ["customer", "loan", "ledger"].map((entityType) => ({ entityType, sourceRef: `source/${entityType}`, targetRef: `target/${entityType}`, sourceRecordCount: 1, sourceChecksumSha256: sha(`source-${entityType}`), transformVersion: "1", transformChecksumSha256: sha(`transform-${entityType}`), requiredFields: ["id"], cleansingIssueCount: 0 })), reconciliationMethodRef: "method/control-totals", ...approval }, NOW); }
function migrationState() { const project = projectResult().project; const mapping = mappingResult(project).mapping; return { implementationProjects: { [project.projectId]: project }, migrationMappings: { [mapping.mappingId]: mapping } }; }
function passedRun(state, type = "dress_rehearsal") { return recordMigrationRun(state, { runId: `run-${type}`, projectId: "project-1", mappingId: "mapping-1", runType: type, results: ["customer", "loan", "ledger"].map((entityType) => ({ entityType, sourceCount: 1, acceptedCount: 1, rejectedCount: 0, sourceControlTotalPaise: "10000", targetControlTotalPaise: "10000", reconciliationChecksumSha256: sha(`recon-${entityType}`) })), startedAt: "2026-07-13T20:00:00.000Z", completedAt: "2026-07-13T23:00:00.000Z", ...approval }, NOW); }

test("configuration workbook and mapping retain approval, source, transform, and cleansing lineage", () => {
  const result = projectResult(); assert.equal(result.project.status, "configured"); const mapping = mappingResult(result.project).mapping; assert.equal(mapping.status, "approved"); assert.equal(mapping.entities.length, 3);
  const dirty = registerMigrationMapping({}, result.project, { mappingId: "dirty", entities: [{ entityType: "customer", sourceRef: "s", targetRef: "t", sourceRecordCount: 1, sourceChecksumSha256: sha("s"), transformVersion: "1", transformChecksumSha256: sha("t"), requiredFields: ["id"], cleansingIssueCount: 1, cleansingEvidenceRef: "issue/1" }], reconciliationMethodRef: "method", ...approval }, NOW).mapping; assert.equal(dirty.status, "cleansing_required");
});

test("migration and opening-balance controls fail on count or exact-paise differences", () => {
  const state = migrationState(); const run = passedRun(state); assert.equal(run.status, "passed");
  const validation = validateOpeningBalances(run, { validationId: "balance-1", accounts: [{ accountId: "loan-1", source: { principalPaise: "10000", interestPaise: "200", feesPaise: "10", ledgerDebitsPaise: "10210", ledgerCreditsPaise: "0", installmentCount: 12, scheduleChecksumSha256: sha("schedule") }, target: { principalPaise: "9999", interestPaise: "200", feesPaise: "10", ledgerDebitsPaise: "10210", ledgerCreditsPaise: "0", installmentCount: 12, scheduleChecksumSha256: sha("schedule") } }], ...approval }, NOW); assert.equal(validation.status, "failed"); assert.deepEqual(validation.blockers, ["loan-1:principalPaise"]);
  assert.throws(() => recordMigrationRun(state, { runId: "bad", projectId: "project-1", mappingId: "mapping-1", runType: "mock", results: [{ entityType: "loan", sourceCount: 2, acceptedCount: 1, rejectedCount: 0, sourceControlTotalPaise: "1", targetControlTotalPaise: "1", reconciliationChecksumSha256: sha("x") }], startedAt: NOW.toISOString(), completedAt: NOW.toISOString(), ...approval }, NOW), /Source count/);
});

test("parallel run and UAT require complete reconciled operating evidence", () => {
  assert.throws(() => assessParallelRun({ assessmentId: "short", projectId: "project-1", days: 4, reconciliations: [], ...approval }, NOW), /five days/);
  const reconciliations = ["finance", "regulatory", "portfolio"].map((outputType) => ({ outputType, sourceCount: 10, targetCount: 10, sourceAmountPaise: "100000", targetAmountPaise: "100000", sourceChecksumSha256: sha(outputType), targetChecksumSha256: sha(outputType), unexplainedDifferenceCount: 0 })); const parallel = assessParallelRun({ assessmentId: "parallel-1", projectId: "project-1", days: 7, reconciliations, ...approval }, NOW); assert.equal(parallel.status, "passed");
  const uat = createUatCampaign({ campaignId: "uat-1", projectId: "project-1", scenarios: ["product", "role", "exception", "regulatory_control"].map((coverageType) => ({ scenarioId: coverageType, coverageType, result: "passed", evidenceRef: `uat/${coverageType}` })), defects: [], ...approval }, NOW); assert.equal(uat.status, "passed");
});

test("go-live readiness joins migration, balance, parallel, UAT, training, DR, security, provider and signoffs", () => {
  const base = migrationState(); const run = passedRun(base); const balance = validateOpeningBalances(run, { validationId: "balance-pass", accounts: [{ accountId: "loan-1", source: { principalPaise: "100", interestPaise: "0", feesPaise: "0", ledgerDebitsPaise: "100", ledgerCreditsPaise: "0", installmentCount: 1, scheduleChecksumSha256: sha("schedule") }, target: { principalPaise: "100", interestPaise: "0", feesPaise: "0", ledgerDebitsPaise: "100", ledgerCreditsPaise: "0", installmentCount: 1, scheduleChecksumSha256: sha("schedule") } }], ...approval }, NOW); const reconciliations = ["finance", "regulatory", "portfolio"].map((outputType) => ({ outputType, sourceCount: 1, targetCount: 1, sourceAmountPaise: "100", targetAmountPaise: "100", sourceChecksumSha256: sha(outputType), targetChecksumSha256: sha(outputType), unexplainedDifferenceCount: 0 })); const parallel = assessParallelRun({ assessmentId: "parallel-pass", projectId: "project-1", days: 7, reconciliations, ...approval }, NOW); const uat = createUatCampaign({ campaignId: "uat-pass", projectId: "project-1", scenarios: ["product", "role", "exception", "regulatory_control"].map((coverageType) => ({ scenarioId: coverageType, coverageType, result: "passed", evidenceRef: coverageType })), ...approval }, NOW); const training = ["operations", "finance"].map((role) => recordTrainingCertification({ certificationId: `training-${role}`, projectId: "project-1", staffId: `staff-${role}`, role, modules: ["system", "control"], sopRefs: [`sop/${role}`], scorePct: 90, expiresAt: "2027-07-14T00:00:00.000Z", ...approval }, NOW));
  const state = { ...base, migrationRuns: { [run.runId]: run }, openingBalanceValidations: { [balance.validationId]: balance }, parallelRunAssessments: { [parallel.assessmentId]: parallel }, uatCampaigns: { [uat.campaignId]: uat }, trainingCertifications: Object.fromEntries(training.map((item) => [item.certificationId, item])) }; const readiness = assessGoLiveReadiness(state, { readinessId: "ready-1", projectId: "project-1", migrationRunId: run.runId, openingBalanceValidationId: balance.validationId, parallelRunAssessmentId: parallel.assessmentId, uatCampaignId: uat.campaignId, trainingCertificationIds: training.map((item) => item.certificationId), drEvidenceRef: "dr/1", securityApprovalRef: "security/1", providerReadinessRef: "providers/1", operationsSignoffRef: "ops/1", financeSignoffRef: "finance/1", complianceSignoffRef: "compliance/1", ...approval }, NOW); assert.equal(readiness.status, "ready");
});

test("cutover fails closed to rollback and hypercare exit requires time, severity, and SLA gates", () => {
  const readiness = { readinessId: "ready-1", projectId: "project-1", status: "ready" }; const steps = ["freeze", "export", "import", "reconcile", "switch"].map((name) => ({ name, status: "passed", evidenceRef: `cutover/${name}` })); const cutover = executeCutover(readiness, { cutoverId: "cutover-1", readinessId: "ready-1", steps, ...approval }, NOW); assert.equal(cutover.status, "completed");
  const review = reviewHypercare(cutover, { reviewId: "hypercare-1", startedAt: "2026-07-06T00:00:00.000Z", issues: [{ issueId: "issue-1", severity: "medium", status: "resolved", slaMet: true, evidenceRef: "issue/1" }], ...approval }, NOW); assert.equal(review.status, "exit_approved");
  assert.throws(() => executeCutover(readiness, { cutoverId: "bad-cutover", steps: steps.map((item) => item.name === "import" ? { ...item, status: "failed" } : item), ...approval }, NOW), /rollback evidence/);
});

test("implementation APIs persist project controls tenant-locally", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-implementation-")); const tenant = { tenantId: "tenant_impl", name: "Implementation Bank", apiKey: "impl-key" }; const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve())); t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); }); const base = `http://127.0.0.1:${server.address().port}`;
  const body = { projectId: "api-project", name: "API migration", products: ["personal"], sourceSystems: ["legacy"], roles: ["operations"], configuration: { version: "1" }, configurationChecksumSha256: sha("api-config"), targetEnvironment: "production", dataFreezeAt: "2027-01-01T00:00:00.000Z", rollbackPlanRef: "rollback/1", owner: "owner", proposedBy: "maker", approvedBy: "tenant_impl", approvalRef: "approval/api" }; let response = await fetch(`${base}/implementation/projects`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify(body) }); assert.equal(response.status, 201, await response.clone().text()); response = await fetch(`${base}/implementation/controls`, { headers: { "x-api-key": tenant.apiKey } }); const controls = await response.json(); assert.equal(controls.implementationProjects.length, 1);
});
