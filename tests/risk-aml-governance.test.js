import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assessFraudSignals,
  buildPortfolioRiskSnapshot,
  buildRiskCommitteePack,
  conductOngoingCddReview,
  createRcsaAssessment,
  createRecurringModelReport,
  createTransactionMonitoringRule,
  evaluateTransactions,
  registerFraudRiskPolicy,
  registerScreeningList,
  stressPortfolio
} from "@loanos/core";
import { createLoanOsServer } from "../apps/api/src/server.js";

const NOW = new Date("2026-07-14T00:00:00.000Z"); const approval = { proposedBy: "risk_maker", approvedBy: "risk_checker", approvalRef: "risk-approval-1" }; const sha = (value) => createHash("sha256").update(value).digest("hex");
function screeningState() { let registry = {}; for (const type of ["un_sanctions", "uapa", "pep", "internal_negative"]) registry = registerScreeningList(registry, { listId: `list-${type}`, listType: type, provider: "compliance-provider", version: "2026-07-14", contentChecksumSha256: sha(type), recordCount: 10, storageCountry: "IN", evidenceRef: `evidence/${type}`, publishedAt: NOW.toISOString(), validUntil: "2026-08-14T00:00:00.000Z", ...approval }, NOW).registry; return registry; }

test("ongoing CDD requires current full-list rescreening and escalates profile deviations", () => {
  const state = { borrowerProfiles: { b1: { borrowerId: "b1" } }, screeningLists: screeningState() };
  const screenings = Object.values(state.screeningLists).map((list) => ({ listId: list.listId, outcome: "clear", evidenceRef: `screen/${list.listId}` }));
  const review = conductOngoingCddReview(state, { reviewId: "cdd-1", borrowerId: "b1", riskRating: "high", purposeAndNatureRef: "purpose-1", sourceOfFundsRef: "sof-1", beneficialOwnershipRef: "bo-1", screenings, transactionProfile: { expectedMonthlyCreditsPaise: "100000", observedMonthlyCreditsPaise: "250000", cashIntensityPct: 20, geographyRisk: "low" }, nextReviewAt: "2026-10-14T00:00:00.000Z", ...approval }, NOW);
  assert.equal(review.status, "enhanced_due_diligence_required"); assert.deepEqual(review.escalations, ["profile_deviation"]);
  assert.throws(() => conductOngoingCddReview({ ...state, screeningLists: {} }, { reviewId: "bad", borrowerId: "b1", screenings, transactionProfile: {}, ...approval }, NOW), /Current sanctions/);
});

test("transaction monitoring uses exact paise thresholds and creates restricted alerts", () => {
  const ruleResult = createTransactionMonitoringRule({}, { ruleId: "large-credit", name: "Large credit", ruleType: "single_amount", thresholdPaise: "1000000", severity: "high", owner: "aml_owner", ...approval }, NOW);
  const state = { borrowerProfiles: { b1: { borrowerId: "b1" } }, transactionMonitoringRules: ruleResult.registry };
  const result = evaluateTransactions(state, { assessmentId: "tm-1", borrowerId: "b1", assessedBy: "aml_analyst", transactions: [{ transactionId: "txn-1", amountPaise: "1000000", occurredAt: NOW.toISOString(), geography: "IN", counterpartyRef: "cp-1", direction: "credit" }] }, NOW);
  assert.equal(result.assessment.status, "alerts_generated"); assert.equal(result.alerts[0].tippingOffRestricted, true);
});

test("multi-signal fraud policy produces deterministic refer and block outcomes", () => {
  const policy = registerFraudRiskPolicy({}, { policyId: "fraud-v1", version: 1, weights: { device: 60, identity_link: 80, mule: 100 }, referThreshold: 50, blockThreshold: 120, owner: "fraud_owner", ...approval }, NOW);
  const state = { fraudRiskPolicies: policy.registry };
  const assessment = assessFraudSignals(state, { assessmentId: "fraud-assess-1", subjectId: "b1", policyId: "fraud-v1", assessedBy: "fraud_analyst", signals: [{ signalId: "s1", type: "device", confidencePct: 100, linkedSubjectRefs: ["b2"], evidenceRef: "device/e1" }, { signalId: "s2", type: "identity_link", confidencePct: 100, linkedSubjectRefs: ["b2"], evidenceRef: "link/e1" }] }, NOW);
  assert.equal(assessment.outcome, "block"); assert.equal(assessment.score, 140);
});

test("portfolio limits, connected exposure, and stress tests fail visibly", () => {
  const snapshot = buildPortfolioRiskSnapshot({ snapshotId: "portfolio-1", asOf: NOW.toISOString(), exposures: [{ exposureId: "e1", borrowerId: "b1", connectedGroup: "g1", product: "personal", segment: "retail", geography: "MH", channel: "digital", partner: "direct", vintage: "2026-01", assetClass: "standard", exposurePaise: "800000" }, { exposureId: "e2", borrowerId: "b2", connectedGroup: "g1", product: "business", segment: "msme", geography: "KA", channel: "branch", partner: "direct", vintage: "2026-02", assetClass: "sma_1", exposurePaise: "200000" }], limits: [{ dimension: "connectedGroup", value: "g1", maximumPct: 70 }], remediationActions: ["reduce connected exposure"], ...approval }, NOW);
  assert.equal(snapshot.status, "limit_breach"); assert.equal(snapshot.totalExposurePaise, "1000000");
  const stress = stressPortfolio(snapshot, { stressTestId: "stress-1", scenarios: [{ name: "severe", lossRateBps: 3000, capitalBufferPaise: "200000" }], managementActionRef: "action/capital", ...approval }, NOW);
  assert.equal(stress.status, "breached");
});

test("RCSA, recurring model monitoring, and risk committee pack retain linked evidence", () => {
  const rcsa = createRcsaAssessment({ assessmentId: "rcsa-1", period: "2026-Q2", risks: [{ riskId: "r1", process: "collections", category: "conduct", inherentScore: 20, controls: ["call-window"], controlEffectivenessPct: 25, kris: [{ name: "complaints", value: 6, threshold: 3 }], lossEvents: [{ lossEventId: "loss-1", amountPaise: "5000", rootCause: "agent conduct" }], actions: ["retrain agents"] }], ...approval }, NOW);
  assert.equal(rcsa.status, "actions_required");
  const modelState = { modelRegistry: { models: { m1: { modelId: "m1", version: "1", status: "active" } } } };
  const report = createRecurringModelReport(modelState, { reportId: "model-report-1", modelId: "m1", period: "2026-Q2", cohorts: [{ name: "A", sampleSize: 100, approvalRatePct: 80, badRatePct: 2 }, { name: "B", sampleSize: 100, approvalRatePct: 50, badRatePct: 4 }], performance: { badRatePct: 4, driftValue: 0.3 }, thresholds: { maximumApprovalSpreadPct: 10, maximumBadRatePct: 3, maximumDriftValue: 0.2 }, remediationRef: "model/action-1", ...approval }, NOW);
  assert.equal(report.status, "breached");
  const state = { portfolioRiskSnapshots: { p1: { snapshotId: "p1" } }, portfolioStressTests: { s1: { stressTestId: "s1" } }, rcsaAssessments: { "rcsa-1": rcsa }, modelMonitoringReports: { "model-report-1": report }, amlAlerts: {} };
  assert.equal(buildRiskCommitteePack(state, { packId: "pack-1", committee: "Board Risk Committee", period: "2026-Q2", portfolioSnapshotIds: ["p1"], stressTestIds: ["s1"], rcsaAssessmentIds: ["rcsa-1"], modelReportIds: ["model-report-1"], amlAlertIds: [], ...approval }, NOW).status, "sealed");
});

test("risk APIs persist portfolio controls tenant-locally", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-risk-")); const tenant = { tenantId: "tenant_risk", name: "Risk Bank", apiKey: "risk-key" }; const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve())); t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`; const body = { snapshotId: "api-portfolio", asOf: NOW.toISOString(), exposures: [{ exposureId: "e1", borrowerId: "b1", product: "personal", segment: "retail", geography: "MH", channel: "digital", vintage: "2026-01", assetClass: "standard", exposurePaise: "100000" }], limits: [{ dimension: "product", value: "personal", maximumPct: 100 }], remediationActions: [], proposedBy: "risk_maker", approvedBy: "tenant_risk", approvalRef: "api-approval" };
  let response = await fetch(`${base}/risk/portfolio/snapshots`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify(body) }); assert.equal(response.status, 201, await response.clone().text());
  response = await fetch(`${base}/risk/controls`, { headers: { "x-api-key": tenant.apiKey } }); const controls = await response.json(); assert.equal(controls.portfolioRiskSnapshots.length, 1);
});
