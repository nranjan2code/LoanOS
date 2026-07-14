import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import {
  approveControlCertification,
  createAssuranceIssue,
  createAssurancePlan,
  createAuditEngagement,
  createControlCertification,
  generateGovernancePack,
  recordControlTest,
  respondAuditRequest,
  transitionAssuranceIssue,
  transitionAuditEngagement
} from "../packages/core/src/index.js";

const now = new Date("2026-07-14T12:00:00.000Z");
const controlIds = ["RBI-IT-GRC", "RBI-DL-2025"];

function planInput() {
  return { planId: "PLAN-2026", name: "2026 technology controls assurance", periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-12-31T23:59:59.000Z", frequency: "quarterly", controlIds: ["RBI-IT-GRC"], methodologyRef: "methodology://assurance/technology-v1", sampleStrategy: "Risk-based sample of privileged access and recovery evidence.", owner: "control_owner", proposedBy: "control_owner", approvedBy: "assurance_reviewer", approvalRef: "approval://plans/2026" };
}

function deficientTestInput() {
  return { testId: "TEST-1", planId: "PLAN-2026", controlId: "RBI-IT-GRC", populationSize: 100, sampleSize: 20, sampleRef: "sample://access/q2", procedureRef: "procedure://access-review/v1", tester: "assurance_tester", workpaperRef: "workpaper://TEST-1", evidenceRefs: ["evidence://access/q2"], result: "deficiency", findings: ["Two privileged reviews exceeded the approved completion SLA"], testedAt: "2026-06-30T10:00:00.000Z" };
}

test("assurance plans bind approved methodology and known regulatory controls", () => {
  assert.throws(() => createAssurancePlan({ ...planInput(), controlIds: ["UNKNOWN"] }, controlIds, [], now), (error) => error.code === "assurance_control_unknown");
  assert.throws(() => createAssurancePlan({ ...planInput(), approvedBy: "control_owner" }, controlIds, [], now), (error) => error.code === "assurance_four_eyes_required");
  const plan = createAssurancePlan(planInput(), controlIds, [], now);
  assert.equal(plan.status, "active");
  assert.deepEqual(plan.controlIds, ["RBI-IT-GRC"]);
});

test("deficient sample creates an owned issue with independent remediation verification and closure", () => {
  const plan = createAssurancePlan(planInput(), controlIds, [], now);
  const controlTest = recordControlTest(deficientTestInput(), [plan], [], now);
  let issue = createAssuranceIssue({ issueId: "ISSUE-1", testId: controlTest.testId, title: "Privileged access review delays", description: "Two sampled privileged access reviews exceeded the approved completion SLA.", severity: "high", owner: "control_owner", remediationPlan: "Automate reminders and escalation before access-review due dates.", detectedBy: "assurance_tester", dueAt: "2026-08-31T00:00:00.000Z" }, [controlTest], [], now);
  issue = transitionAssuranceIssue(issue, { status: "in_remediation", updatedBy: "control_owner", changeTicket: "CHG-AUD-1" }, now);
  issue = transitionAssuranceIssue(issue, { status: "remediated", updatedBy: "control_owner", remediationEvidenceRef: "evidence://issues/1/remediation" }, now);
  assert.throws(() => transitionAssuranceIssue(issue, { status: "verified", updatedBy: "control_owner", retestEvidenceRef: "evidence://issues/1/retest" }, now), (error) => error.code === "assurance_four_eyes_required");
  issue = transitionAssuranceIssue(issue, { status: "verified", updatedBy: "assurance_tester", retestEvidenceRef: "evidence://issues/1/retest" }, now);
  issue = transitionAssuranceIssue(issue, { status: "closed", updatedBy: "assurance_reviewer", closureApprovalRef: "approval://issues/1" }, now);
  assert.equal(issue.status, "closed");
});

test("control-owner exception certification retains deficient test and issue lineage", () => {
  const plan = createAssurancePlan(planInput(), controlIds, [], now);
  const controlTest = recordControlTest(deficientTestInput(), [plan], [], now);
  const issue = createAssuranceIssue({ issueId: "ISSUE-1", testId: controlTest.testId, title: "Privileged access review delays", description: "Two sampled reviews exceeded the approved completion SLA.", severity: "high", owner: "control_owner", remediationPlan: "Automate reminders and escalation before due dates.", detectedBy: "assurance_tester", dueAt: "2026-08-31T00:00:00.000Z" }, [controlTest], [], now);
  let certification = createControlCertification({ certificationId: "CERT-1", controlId: "RBI-IT-GRC", periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-07-14T12:00:00.000Z", testIds: [controlTest.testId], issueIds: [issue.issueId], evidenceRefs: ["workpaper://TEST-1"], result: "exception", statement: "Control operated with the disclosed access-review exception under remediation.", certifiedBy: "control_owner" }, [controlTest], [issue], [], now);
  assert.throws(() => approveControlCertification(certification, { approvedBy: "control_owner", approvalRef: "approval://cert/1" }, now), (error) => error.code === "assurance_four_eyes_required");
  certification = approveControlCertification(certification, { approvedBy: "assurance_reviewer", approvalRef: "approval://cert/1" }, now);
  assert.equal(certification.status, "approved");
});

test("audit engagement requires complete evidence requests and closes only after linked issues", () => {
  let engagement = createAuditEngagement({ engagementId: "AUDIT-1", type: "rbi_inspection", title: "RBI technology controls inspection", authority: "RBI", scope: "Technology governance, privileged access and resilience controls.", periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-06-30T23:59:59.000Z", owner: "audit_liaison", createdBy: "assurance_tester", requests: [{ requestId: "REQ-1", description: "Provide privileged-access review evidence.", owner: "control_owner", dueAt: "2026-07-31T00:00:00.000Z" }] }, [], [], now);
  engagement = transitionAuditEngagement(engagement, { status: "in_progress", updatedBy: "assurance_tester" }, [], now);
  assert.throws(() => transitionAuditEngagement(engagement, { status: "fieldwork_complete", updatedBy: "assurance_tester", fieldworkEvidenceRef: "evidence://audit/fieldwork" }, [], now), (error) => error.code === "audit_requests_open");
  engagement = respondAuditRequest(engagement, { requestId: "REQ-1", response: "Attached the complete quarterly access-review population and samples.", evidenceRefs: ["evidence://audit/REQ-1"], respondedBy: "control_owner" }, now);
  engagement = transitionAuditEngagement(engagement, { status: "fieldwork_complete", updatedBy: "assurance_tester", fieldworkEvidenceRef: "evidence://audit/fieldwork" }, [], now);
  engagement = transitionAuditEngagement(engagement, { status: "responded", updatedBy: "control_owner", managementResponseRef: "response://audit/1" }, [], now);
  engagement = transitionAuditEngagement(engagement, { status: "closed", updatedBy: "assurance_reviewer", closureReportRef: "report://audit/1", approvalRef: "approval://audit/1" }, [], now);
  assert.equal(engagement.status, "closed");
});

test("governance pack derives exception metrics and seals the source snapshot", () => {
  const plan = createAssurancePlan(planInput(), controlIds, [], now);
  const controlTest = recordControlTest(deficientTestInput(), [plan], [], now);
  const issue = createAssuranceIssue({ issueId: "ISSUE-1", testId: controlTest.testId, title: "Privileged access review delays", description: "Two reviews exceeded the approved completion SLA.", severity: "high", owner: "control_owner", remediationPlan: "Automate reminders and escalation before due dates.", detectedBy: "assurance_tester", dueAt: "2026-08-31T00:00:00.000Z" }, [controlTest], [], now);
  const pack = generateGovernancePack({ packId: "PACK-1", committee: "Board IT Strategy Committee", periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-07-14T12:00:00.000Z", generatedBy: "assurance_tester", approvedBy: "assurance_reviewer", approvalRef: "approval://packs/1", sourceEvidenceRef: "snapshot://assurance/2026-07" }, { plans: [plan], tests: [controlTest], issues: [issue], certifications: [], engagements: [] }, now);
  assert.equal(pack.summary.deficientTests, 1);
  assert.equal(pack.exceptions[0].issueId, "ISSUE-1");
  assert.match(pack.packSha256, /^[a-f0-9]{64}$/);
});

test("platform APIs retain plans, tests, issues, certifications, inspections and governance packs", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-control-assurance-")); const platformAdminKey = "assurance-platform-key"; const server = createLoanOsServer({ dataDir, platformAdminKey }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`; const adminHeaders = { "content-type": "application/json", "x-platform-admin-key": platformAdminKey };
  async function createUser(userId, email) { const response = await fetch(`${base}/platform/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ userId, email, displayName: userId, password: "PlatformPass1!", mfaRequired: false, mustChangePassword: false, roles: ["platform_admin", "security_admin", "auditor"] }) }); assert.equal(response.status, 201); }
  async function login(email) { const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "platform", email, password: "PlatformPass1!" }) }); assert.equal(response.status, 200); return response.headers.get("set-cookie").split(";")[0]; }
  for (const [id, email] of [["control_owner", "owner@assurance.example.in"], ["assurance_tester", "tester@assurance.example.in"], ["assurance_reviewer", "reviewer@assurance.example.in"]]) await createUser(id, email);
  const owner = await login("owner@assurance.example.in"); const tester = await login("tester@assurance.example.in"); const reviewer = await login("reviewer@assurance.example.in"); const post = (path, body, cookie) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  let response = await post("/platform/control-assurance/plans", planInput(), reviewer); assert.equal(response.status, 201);
  response = await post("/platform/control-assurance/tests", deficientTestInput(), tester); assert.equal(response.status, 201);
  const issueInput = { issueId: "ISSUE-1", testId: "TEST-1", title: "Privileged access review delays", description: "Two sampled reviews exceeded the approved completion SLA.", severity: "high", owner: "control_owner", remediationPlan: "Automate reminders and escalation before due dates.", detectedBy: "assurance_tester", dueAt: "2026-08-31T00:00:00.000Z" };
  response = await post("/platform/control-assurance/issues", issueInput, tester); assert.equal(response.status, 201);
  response = await post("/platform/control-assurance/certifications", { certificationId: "CERT-1", controlId: "RBI-IT-GRC", periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-07-14T12:00:00.000Z", testIds: ["TEST-1"], issueIds: ["ISSUE-1"], evidenceRefs: ["workpaper://TEST-1"], result: "exception", statement: "Control operated with the disclosed exception under remediation.", certifiedBy: "control_owner" }, owner); assert.equal(response.status, 201);
  response = await post("/platform/control-assurance/certifications/CERT-1/approval", { approvedBy: "assurance_reviewer", approvalRef: "approval://cert/1" }, reviewer); assert.equal(response.status, 200);
  response = await post("/platform/control-assurance/engagements", { engagementId: "AUDIT-1", type: "rbi_inspection", title: "RBI technology controls inspection", authority: "RBI", scope: "Technology governance and access controls.", periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-06-30T23:59:59.000Z", owner: "assurance_tester", createdBy: "assurance_tester", requests: [{ requestId: "REQ-1", description: "Provide access-review evidence.", owner: "control_owner", dueAt: "2026-07-31T00:00:00.000Z" }] }, tester); assert.equal(response.status, 201);
  response = await post("/platform/control-assurance/engagements/AUDIT-1/transition", { status: "in_progress", updatedBy: "assurance_tester" }, tester); assert.equal(response.status, 200);
  response = await post("/platform/control-assurance/engagements/AUDIT-1/responses", { requestId: "REQ-1", response: "Attached access-review population and sampled evidence.", evidenceRefs: ["evidence://audit/REQ-1"], respondedBy: "control_owner" }, owner); assert.equal(response.status, 200);
  response = await post("/platform/control-assurance/engagements/AUDIT-1/transition", { status: "fieldwork_complete", updatedBy: "assurance_tester", fieldworkEvidenceRef: "evidence://audit/fieldwork" }, tester); assert.equal(response.status, 200);
  response = await post("/platform/control-assurance/engagements/AUDIT-1/transition", { status: "responded", updatedBy: "control_owner", managementResponseRef: "response://audit/1" }, owner); assert.equal(response.status, 200);
  response = await post("/platform/control-assurance/engagements/AUDIT-1/transition", { status: "closed", updatedBy: "assurance_reviewer", closureReportRef: "report://audit/1", approvalRef: "approval://audit/1" }, reviewer); assert.equal(response.status, 200);
  response = await post("/platform/control-assurance/governance-packs", { packId: "PACK-1", committee: "Board IT Strategy Committee", periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-07-14T12:00:00.000Z", generatedBy: "assurance_tester", approvedBy: "assurance_reviewer", approvalRef: "approval://packs/1", sourceEvidenceRef: "snapshot://assurance/2026-07" }, reviewer); assert.equal(response.status, 201);
  response = await fetch(`${base}/platform/control-assurance`, { headers: { cookie: reviewer } }); assert.equal(response.status, 200); const projection = await response.json(); assert.equal(projection.plans.length, 1); assert.equal(projection.tests.length, 1); assert.equal(projection.issues.length, 1); assert.equal(projection.certifications[0].status, "approved"); assert.equal(projection.engagements[0].status, "closed"); assert.equal(projection.governancePacks.length, 1);
});
