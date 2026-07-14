import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import {
  assessDependencyConcentration,
  assessVendorSla,
  assignSupportCase,
  createProblemRecord,
  createSupportCase,
  createVendorProfile,
  enrichSupportCase,
  escalateSupportCase,
  transitionProblemRecord,
  transitionSupportCase
} from "../packages/core/src/index.js";

const start = new Date("2026-07-14T10:00:00.000Z");

function supportInput() {
  return {
    caseId: "SUP-1001",
    tenantId: "tenant_a",
    title: "Payment provider callbacks delayed",
    description: "Payment callbacks are delayed for production repayment posting.",
    severity: "sev1",
    category: "provider",
    channel: "monitoring",
    openedBy: "operator_one",
    incidentId: "INC-1001",
    affectedServices: ["payment-posting"],
    runbookRef: "runbook://payments/callback-delay"
  };
}

function vendorInput(overrides = {}) {
  return {
    vendorId: "vendor_payments",
    name: "Payment Provider",
    dependencyType: "provider",
    tier: "critical",
    services: ["payment-posting"],
    dependentTenantIds: ["tenant_a", "tenant_b"],
    contractRef: "contract://payments/2026",
    owner: "vendor_manager",
    exitPlanRef: "runbook://vendors/payments-exit",
    dueDiligenceRef: "evidence://vendors/payments/dd-2026",
    dataResidencyCountry: "IN",
    reviewCadenceDays: 365,
    slaTargets: { availabilityPct: 99.9, responseMinutes: 15, restorationMinutes: 240 },
    ...overrides
  };
}

test("support lifecycle measures SLA clocks and enforces escalation and four-eyes closure", () => {
  let supportCase = createSupportCase(supportInput(), [], start);
  assert.equal(supportCase.sla.acknowledgeDueAt, "2026-07-14T10:15:00.000Z");
  supportCase = assignSupportCase(supportCase, { assignedBy: "operator_one", onCallOwner: "oncall_primary", supportTeam: "platform_sre", escalationPolicyRef: "policy://oncall/sev1" }, new Date("2026-07-14T10:03:00.000Z"));
  supportCase = transitionSupportCase(supportCase, { status: "acknowledged", updatedBy: "operator_one" }, new Date("2026-07-14T10:10:00.000Z"));
  supportCase = transitionSupportCase(supportCase, { status: "investigating", updatedBy: "operator_one" }, new Date("2026-07-14T10:12:00.000Z"));
  supportCase = escalateSupportCase(supportCase, { level: 1, escalationTarget: "incident_commander", reason: "Provider degradation affects repayment posting", escalatedBy: "operator_one" }, new Date("2026-07-14T10:20:00.000Z"));
  assert.throws(() => escalateSupportCase(supportCase, { level: 1, escalationTarget: "cto", reason: "Repeated escalation attempt", escalatedBy: "operator_one" }), (error) => error.code === "support_escalation_invalid");
  supportCase = transitionSupportCase(supportCase, { status: "resolved", updatedBy: "operator_one", resolutionSummary: "Provider recovered callback processing and backlog was reconciled.", resolutionEvidenceRef: "evidence://support/SUP-1001/reconciliation" }, new Date("2026-07-14T13:00:00.000Z"));
  const measured = enrichSupportCase(supportCase, new Date("2026-07-14T13:01:00.000Z"));
  assert.equal(measured.sla.checks.acknowledgement, "met");
  assert.equal(measured.sla.checks.restoration, "met");
  assert.throws(() => transitionSupportCase(supportCase, { status: "closed", updatedBy: "operator_one", closureApprovalRef: "approval://support/1" }), (error) => error.code === "support_four_eyes_required");
  const closed = transitionSupportCase(supportCase, { status: "closed", updatedBy: "operator_two", closureApprovalRef: "approval://support/1" });
  assert.equal(closed.status, "closed");
});

test("problem management retains case lineage and requires verified independent closure", () => {
  const supportCase = createSupportCase(supportInput(), [], start);
  let problem = createProblemRecord({ problemId: "PRB-1001", title: "Provider callback instability", description: "Repeated callback delays require a systemic corrective action.", owner: "platform_sre", createdBy: "operator_one", relatedCaseIds: [supportCase.caseId], relatedIncidentIds: ["INC-1001"] }, [supportCase], [], start);
  problem = transitionProblemRecord(problem, { status: "known_error", updatedBy: "operator_one", rootCause: "Provider retry queues had an undersized concurrency limit.", workaroundRef: "runbook://payments/manual-replay" });
  problem = transitionProblemRecord(problem, { status: "remediation_in_progress", updatedBy: "operator_one", rootCause: problem.rootCause });
  problem = transitionProblemRecord(problem, { status: "resolved", updatedBy: "operator_one", correctiveActions: ["Increase queue concurrency", "Add backlog-age alert"], verificationRef: "evidence://problems/PRB-1001/soak-test" });
  assert.throws(() => transitionProblemRecord(problem, { status: "closed", updatedBy: "operator_one", closureApprovalRef: "approval://problem/1" }), (error) => error.code === "problem_four_eyes_required");
  problem = transitionProblemRecord(problem, { status: "closed", updatedBy: "operator_two", closureApprovalRef: "approval://problem/1" });
  assert.equal(problem.status, "closed");
  assert.deepEqual(problem.relatedCaseIds, ["SUP-1001"]);
});

test("vendor SLA and concentration assessments fail visibly on breaches and single points", () => {
  const vendor = createVendorProfile(vendorInput(), [], [], [], start);
  const sla = assessVendorSla(vendor, { assessmentId: "VSLA-1", windowStart: "2026-06-01T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z", actuals: { availabilityPct: 99.5, responseMinutes: 20, restorationMinutes: 200, incidentCount: 2 }, evidenceRef: "metrics://vendor/payments/june", findings: ["Monthly availability and response target missed"], actions: ["Open vendor corrective-action plan"], assessedBy: "vendor_manager" }, start);
  assert.equal(sla.status, "breached");
  assert.equal(sla.checks.restoration, true);
  const concentration = assessDependencyConcentration([vendor], { assessmentId: "CONC-1", thresholdPct: 60, evidenceRef: "evidence://vendors/concentration/q2", actions: ["Qualify an alternate payment provider"], assessedBy: "risk_manager" }, start);
  assert.equal(concentration.status, "action_required");
  assert.deepEqual(concentration.exposures[0].riskReasons, ["tenant_concentration", "single_point_of_failure"]);
  assert.throws(() => createVendorProfile(vendorInput({ vendorId: "vendor_foreign", dataResidencyCountry: "US" }), [], [], [], start), (error) => error.code === "vendor_cross_border_evidence_missing");
});

test("platform APIs retain support, problem, vendor review, SLA and concentration evidence", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-service-operations-"));
  const platformAdminKey = "operations-platform-key";
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
  await createUser("operator_one", "operator1@operations.example.in");
  await createUser("operator_two", "operator2@operations.example.in");
  const operatorOne = await login("operator1@operations.example.in");
  const operatorTwo = await login("operator2@operations.example.in");
  const post = (path, body, cookie = operatorOne) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });

  let response = await post("/platform/support/cases", supportInput());
  assert.equal(response.status, 201);
  response = await post("/platform/support/cases/SUP-1001/assignment", { assignedBy: "operator_one", onCallOwner: "operator_one", supportTeam: "platform_sre", escalationPolicyRef: "policy://oncall/sev1" });
  assert.equal(response.status, 200);
  response = await post("/platform/support/cases/SUP-1001/transition", { status: "investigating", updatedBy: "operator_one" });
  assert.equal(response.status, 200);
  response = await post("/platform/support/cases/SUP-1001/escalation", { level: 1, escalationTarget: "incident_commander", reason: "Provider callback degradation is continuing", escalatedBy: "operator_one" });
  assert.equal(response.status, 200);
  response = await post("/platform/support/cases/SUP-1001/transition", { status: "resolved", updatedBy: "operator_one", resolutionSummary: "Provider queues recovered and repayment callbacks reconciled.", resolutionEvidenceRef: "evidence://support/SUP-1001/reconciled" });
  assert.equal(response.status, 200);
  response = await post("/platform/support/cases/SUP-1001/transition", { status: "closed", updatedBy: "operator_two", closureApprovalRef: "approval://support/SUP-1001" }, operatorTwo);
  assert.equal(response.status, 200);

  response = await post("/platform/support/problems", { problemId: "PRB-1001", title: "Provider queue instability", description: "Recurring callback delays require systemic vendor remediation.", owner: "operator_one", createdBy: "operator_one", relatedCaseIds: ["SUP-1001"], relatedIncidentIds: ["INC-1001"] });
  assert.equal(response.status, 201);
  response = await post("/platform/support/problems/PRB-1001/transition", { status: "remediation_in_progress", updatedBy: "operator_one", rootCause: "Provider retry queue concurrency was undersized." });
  assert.equal(response.status, 200);
  response = await post("/platform/support/problems/PRB-1001/transition", { status: "resolved", updatedBy: "operator_one", correctiveActions: ["Increase provider queue concurrency", "Alert on backlog age"], verificationRef: "evidence://problem/PRB-1001/soak" });
  assert.equal(response.status, 200);
  response = await post("/platform/support/problems/PRB-1001/transition", { status: "closed", updatedBy: "operator_two", closureApprovalRef: "approval://problem/PRB-1001" }, operatorTwo);
  assert.equal(response.status, 200);

  response = await post("/platform/vendor-controls", vendorInput());
  assert.equal(response.status, 201);
  response = await post("/platform/vendor-controls/vendor_payments/reviews", { reviewId: "VREV-1", reviewedBy: "operator_one", dueDiligenceRef: "evidence://vendor/dd", securityAssessmentRef: "evidence://vendor/security", bcpTestRef: "evidence://vendor/bcp", exitReadinessRef: "evidence://vendor/exit", approvalRef: "approval://vendor/VREV-1", findings: [], actions: [] });
  assert.equal(response.status, 201);
  response = await post("/platform/vendor-controls/vendor_payments/sla-assessments", { assessmentId: "VSLA-1", assessedBy: "operator_one", windowStart: "2026-06-01T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z", actuals: { availabilityPct: 99.5, responseMinutes: 20, restorationMinutes: 200, incidentCount: 2 }, evidenceRef: "metrics://vendor/payments/june", findings: ["Availability and response target missed"], actions: ["Track vendor corrective action"] });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).assessment.status, "breached");
  response = await post("/platform/vendor-controls/concentration-assessments", { assessmentId: "CONC-1", thresholdPct: 60, evidenceRef: "evidence://vendors/concentration/q2", actions: ["Qualify alternate payment provider"], assessedBy: "operator_one" });
  assert.equal(response.status, 201);

  response = await fetch(`${base}/platform/service-operations`, { headers: { cookie: operatorTwo } });
  assert.equal(response.status, 200);
  const controls = await response.json();
  assert.equal(controls.supportCases[0].status, "closed");
  assert.equal(controls.problems[0].status, "closed");
  assert.equal(controls.vendors.length, 1);
  assert.equal(controls.vendorReviews.length, 1);
  assert.equal(controls.vendorSlaAssessments[0].status, "breached");
  assert.equal(controls.concentrationAssessments[0].status, "action_required");
});
