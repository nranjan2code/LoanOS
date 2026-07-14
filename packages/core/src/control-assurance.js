import { createHash } from "node:crypto";

const PLAN_FREQUENCIES = new Set(["monthly", "quarterly", "half_yearly", "annual", "event_driven"]);
const TEST_RESULTS = new Set(["effective", "deficiency"]);
const ISSUE_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const ISSUE_STATUSES = new Set(["open", "in_remediation", "remediated", "verified", "closed"]);
const CERTIFICATION_RESULTS = new Set(["effective", "exception"]);
const ENGAGEMENT_TYPES = new Set(["internal_audit", "statutory_audit", "rbi_inspection", "regulatory_review"]);
const ENGAGEMENT_STATUSES = new Set(["planned", "in_progress", "fieldwork_complete", "responded", "closed"]);

export function createAssurancePlan(input, knownControlIds = [], existing = [], now = new Date()) {
  requireText(input.planId, "planId");
  if (existing.some((item) => item.planId === input.planId)) throw assuranceError("assurance_plan_duplicate", "planId already exists.");
  requireText(input.name, "name", 5);
  requirePeriod(input.periodStart, input.periodEnd);
  if (!PLAN_FREQUENCIES.has(input.frequency)) throw assuranceError("assurance_plan_invalid", "frequency is invalid.");
  const controlIds = stringList(input.controlIds, "controlIds", true);
  if (controlIds.some((id) => !knownControlIds.includes(id))) throw assuranceError("assurance_control_unknown", "Every plan control must exist in the regulatory control library.");
  for (const field of ["methodologyRef", "sampleStrategy", "owner", "proposedBy", "approvedBy", "approvalRef"]) requireText(input[field], field, field === "sampleStrategy" ? 8 : 1);
  if (input.proposedBy === input.approvedBy) throw assuranceError("assurance_four_eyes_required", "Assurance plan requires independent approval.");
  return { planId: String(input.planId), name: String(input.name), periodStart: isoDate(input.periodStart), periodEnd: isoDate(input.periodEnd), frequency: input.frequency, controlIds, methodologyRef: String(input.methodologyRef), sampleStrategy: String(input.sampleStrategy), owner: String(input.owner), proposedBy: String(input.proposedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), status: "active", approvedAt: now.toISOString() };
}

export function recordControlTest(input, plans = [], existing = [], now = new Date()) {
  requireText(input.testId, "testId");
  if (existing.some((item) => item.testId === input.testId)) throw assuranceError("control_test_duplicate", "testId already exists.");
  const plan = plans.find((item) => item.planId === input.planId && item.status === "active");
  if (!plan || !plan.controlIds.includes(input.controlId)) throw assuranceError("control_test_plan_invalid", "Test requires an active plan covering the control.");
  if (!TEST_RESULTS.has(input.result)) throw assuranceError("control_test_invalid", "result is invalid.");
  const populationSize = nonNegativeInteger(input.populationSize, "populationSize");
  const sampleSize = positiveInteger(input.sampleSize, "sampleSize");
  if (populationSize > 0 && sampleSize > populationSize) throw assuranceError("control_test_invalid", "sampleSize cannot exceed populationSize.");
  for (const field of ["sampleRef", "procedureRef", "tester", "workpaperRef"]) requireText(input[field], field);
  const evidenceRefs = stringList(input.evidenceRefs, "evidenceRefs", true);
  const findings = stringList(input.findings, "findings");
  if (input.result === "deficiency" && findings.length === 0) throw assuranceError("control_test_findings_missing", "A deficient test requires findings.");
  const testedAt = isoAtOrBefore(input.testedAt, now, "testedAt");
  return { testId: String(input.testId), planId: plan.planId, controlId: String(input.controlId), populationSize, sampleSize, sampleRef: String(input.sampleRef), procedureRef: String(input.procedureRef), tester: String(input.tester), workpaperRef: String(input.workpaperRef), evidenceRefs, result: input.result, findings, testedAt, recordedAt: now.toISOString() };
}

export function createAssuranceIssue(input, tests = [], existing = [], now = new Date()) {
  requireText(input.issueId, "issueId");
  if (existing.some((item) => item.issueId === input.issueId)) throw assuranceError("assurance_issue_duplicate", "issueId already exists.");
  const test = tests.find((item) => item.testId === input.testId && item.result === "deficiency");
  if (!test) throw assuranceError("assurance_issue_test_invalid", "Issue requires a deficient control test.");
  if (!ISSUE_SEVERITIES.has(input.severity)) throw assuranceError("assurance_issue_invalid", "severity is invalid.");
  for (const field of ["title", "description", "owner", "remediationPlan", "detectedBy"]) requireText(input[field], field, ["title", "description", "remediationPlan"].includes(field) ? 8 : 1);
  requireIsoDate(input.dueAt, "dueAt");
  if (Date.parse(input.dueAt) <= now.getTime()) throw assuranceError("assurance_issue_invalid", "dueAt must be in the future.");
  return { issueId: String(input.issueId), testId: test.testId, planId: test.planId, controlId: test.controlId, title: String(input.title), description: String(input.description), severity: input.severity, owner: String(input.owner), remediationPlan: String(input.remediationPlan), detectedBy: String(input.detectedBy), dueAt: new Date(input.dueAt).toISOString(), status: "open", createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

export function transitionAssuranceIssue(issue, input, now = new Date()) {
  requireText(input.updatedBy, "updatedBy");
  if (!ISSUE_STATUSES.has(input.status)) throw assuranceError("assurance_issue_transition_invalid", "status is invalid.");
  const allowed = { open: ["in_remediation"], in_remediation: ["remediated"], remediated: ["verified", "in_remediation"], verified: ["closed", "in_remediation"] };
  if (!(allowed[issue.status] ?? []).includes(input.status)) throw assuranceError("assurance_issue_transition_invalid", `Cannot transition issue from ${issue.status} to ${input.status}.`);
  const next = { ...issue, status: input.status, updatedAt: now.toISOString() };
  if (input.status === "in_remediation") { requireText(input.changeTicket, "changeTicket"); next.changeTicket = String(input.changeTicket); }
  if (input.status === "remediated") { requireText(input.remediationEvidenceRef, "remediationEvidenceRef"); next.remediationEvidenceRef = String(input.remediationEvidenceRef); next.remediatedBy = String(input.updatedBy); next.remediatedAt = now.toISOString(); }
  if (input.status === "verified") { requireText(input.retestEvidenceRef, "retestEvidenceRef"); if (input.updatedBy === issue.remediatedBy) throw assuranceError("assurance_four_eyes_required", "Issue verification must be independent of remediation."); next.retestEvidenceRef = String(input.retestEvidenceRef); next.verifiedBy = String(input.updatedBy); next.verifiedAt = now.toISOString(); }
  if (input.status === "closed") { requireText(input.closureApprovalRef, "closureApprovalRef"); if (input.updatedBy === issue.verifiedBy) throw assuranceError("assurance_four_eyes_required", "Issue closure must be independent of verification."); next.closureApprovalRef = String(input.closureApprovalRef); next.closedBy = String(input.updatedBy); next.closedAt = now.toISOString(); }
  return next;
}

export function createControlCertification(input, tests = [], issues = [], existing = [], now = new Date()) {
  requireText(input.certificationId, "certificationId");
  if (existing.some((item) => item.certificationId === input.certificationId)) throw assuranceError("certification_duplicate", "certificationId already exists.");
  requireText(input.controlId, "controlId");
  requirePeriod(input.periodStart, input.periodEnd);
  if (Date.parse(input.periodEnd) > now.getTime()) throw assuranceError("certification_period_invalid", "Certification period cannot end in the future.");
  if (!CERTIFICATION_RESULTS.has(input.result)) throw assuranceError("certification_invalid", "result is invalid.");
  const testIds = stringList(input.testIds, "testIds", true);
  if (testIds.some((id) => !tests.some((test) => test.testId === id && test.controlId === input.controlId))) throw assuranceError("certification_test_invalid", "Every certification test must exist for the control.");
  const issueIds = stringList(input.issueIds, "issueIds");
  if (issueIds.some((id) => !issues.some((issue) => issue.issueId === id && issue.controlId === input.controlId))) throw assuranceError("certification_issue_invalid", "Every certification issue must exist for the control.");
  if (input.result === "exception" && issueIds.length === 0) throw assuranceError("certification_issue_invalid", "Exception certification requires linked issues.");
  if (input.result === "effective" && testIds.some((id) => tests.find((test) => test.testId === id).result !== "effective")) throw assuranceError("certification_invalid", "Effective certification cannot include a deficient test.");
  requireText(input.certifiedBy, "certifiedBy");
  requireText(input.statement, "statement", 12);
  return { certificationId: String(input.certificationId), controlId: String(input.controlId), periodStart: isoDate(input.periodStart), periodEnd: isoDate(input.periodEnd), testIds, issueIds, evidenceRefs: stringList(input.evidenceRefs, "evidenceRefs", true), result: input.result, statement: String(input.statement), certifiedBy: String(input.certifiedBy), status: "pending_approval", certifiedAt: now.toISOString() };
}

export function approveControlCertification(certification, input, now = new Date()) {
  if (!certification || certification.status !== "pending_approval") throw assuranceError("certification_transition_invalid", "Certification is not pending approval.");
  requireText(input.approvedBy, "approvedBy"); requireText(input.approvalRef, "approvalRef");
  if (input.approvedBy === certification.certifiedBy) throw assuranceError("assurance_four_eyes_required", "Certification sign-off must be independent of the control owner.");
  return { ...certification, status: "approved", approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), approvedAt: now.toISOString() };
}

export function createAuditEngagement(input, existing = [], knownIssues = [], now = new Date()) {
  requireText(input.engagementId, "engagementId");
  if (existing.some((item) => item.engagementId === input.engagementId)) throw assuranceError("audit_engagement_duplicate", "engagementId already exists.");
  if (!ENGAGEMENT_TYPES.has(input.type)) throw assuranceError("audit_engagement_invalid", "type is invalid.");
  for (const field of ["title", "authority", "scope", "owner", "createdBy"]) requireText(input[field], field, ["title", "scope"].includes(field) ? 8 : 1);
  requirePeriod(input.periodStart, input.periodEnd);
  if (!Array.isArray(input.requests) || input.requests.length === 0) throw assuranceError("audit_engagement_invalid", "requests require at least one item.");
  const ids = new Set();
  const requests = input.requests.map((request) => { requireText(request.requestId, "requests.requestId"); if (ids.has(request.requestId)) throw assuranceError("audit_engagement_invalid", "requestId values must be unique."); ids.add(request.requestId); requireText(request.description, "requests.description", 8); requireText(request.owner, "requests.owner"); requireIsoDate(request.dueAt, "requests.dueAt"); return { requestId: String(request.requestId), description: String(request.description), owner: String(request.owner), dueAt: new Date(request.dueAt).toISOString(), status: "open" }; });
  const linkedIssueIds = stringList(input.linkedIssueIds, "linkedIssueIds");
  if (linkedIssueIds.some((id) => !knownIssues.some((issue) => issue.issueId === id))) throw assuranceError("audit_issue_unknown", "Every linked assurance issue must exist.");
  return { engagementId: String(input.engagementId), type: input.type, title: String(input.title), authority: String(input.authority), scope: String(input.scope), periodStart: isoDate(input.periodStart), periodEnd: isoDate(input.periodEnd), owner: String(input.owner), createdBy: String(input.createdBy), status: "planned", requests, linkedIssueIds, createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

export function respondAuditRequest(engagement, input, now = new Date()) {
  if (!engagement || engagement.status === "closed") throw assuranceError("audit_request_invalid", "Request response requires an active engagement.");
  const request = engagement.requests.find((item) => item.requestId === input.requestId);
  if (!request || request.status === "responded") throw assuranceError("audit_request_invalid", "An open request is required.");
  requireText(input.respondedBy, "respondedBy"); requireText(input.response, "response", 8);
  const updated = { ...request, status: "responded", response: String(input.response), evidenceRefs: stringList(input.evidenceRefs, "evidenceRefs", true), respondedBy: String(input.respondedBy), respondedAt: now.toISOString() };
  return { ...engagement, requests: engagement.requests.map((item) => item.requestId === updated.requestId ? updated : item), updatedAt: now.toISOString() };
}

export function transitionAuditEngagement(engagement, input, issues = [], now = new Date()) {
  requireText(input.updatedBy, "updatedBy");
  if (!ENGAGEMENT_STATUSES.has(input.status)) throw assuranceError("audit_engagement_transition_invalid", "status is invalid.");
  const allowed = { planned: ["in_progress"], in_progress: ["fieldwork_complete"], fieldwork_complete: ["responded"], responded: ["closed", "in_progress"] };
  if (!(allowed[engagement.status] ?? []).includes(input.status)) throw assuranceError("audit_engagement_transition_invalid", `Cannot transition engagement from ${engagement.status} to ${input.status}.`);
  if (["fieldwork_complete", "responded", "closed"].includes(input.status) && engagement.requests.some((item) => item.status !== "responded")) throw assuranceError("audit_requests_open", "Every audit request must be responded before fieldwork completion.");
  const next = { ...engagement, status: input.status, updatedAt: now.toISOString() };
  if (input.status === "fieldwork_complete") { requireText(input.fieldworkEvidenceRef, "fieldworkEvidenceRef"); next.fieldworkEvidenceRef = String(input.fieldworkEvidenceRef); }
  if (input.status === "responded") { requireText(input.managementResponseRef, "managementResponseRef"); next.managementResponseRef = String(input.managementResponseRef); next.respondedBy = String(input.updatedBy); }
  if (input.status === "closed") { requireText(input.closureReportRef, "closureReportRef"); requireText(input.approvalRef, "approvalRef"); if (input.updatedBy === engagement.respondedBy) throw assuranceError("assurance_four_eyes_required", "Engagement closure must be independent of management response."); const unresolved = engagement.linkedIssueIds.filter((id) => issues.some((issue) => issue.issueId === id && issue.status !== "closed")); if (unresolved.length) throw assuranceError("audit_issues_open", "Linked assurance issues must be closed before engagement closure."); next.closureReportRef = String(input.closureReportRef); next.approvalRef = String(input.approvalRef); next.closedBy = String(input.updatedBy); next.closedAt = now.toISOString(); }
  return next;
}

export function generateGovernancePack(input, projection, now = new Date()) {
  for (const field of ["packId", "committee", "generatedBy", "approvedBy", "approvalRef"]) requireText(input[field], field);
  if (input.generatedBy === input.approvedBy) throw assuranceError("assurance_four_eyes_required", "Governance pack requires independent approval.");
  requirePeriod(input.periodStart, input.periodEnd);
  if (Date.parse(input.periodEnd) > now.getTime()) throw assuranceError("governance_pack_period_invalid", "Governance pack period cannot end in the future.");
  const inPeriod = (value) => value && Date.parse(value) >= Date.parse(input.periodStart) && Date.parse(value) <= Date.parse(input.periodEnd);
  const tests = projection.tests.filter((item) => inPeriod(item.testedAt));
  const issues = projection.issues.filter((item) => Date.parse(item.createdAt) <= Date.parse(input.periodEnd));
  const certifications = projection.certifications.filter((item) => item.status === "approved" && item.periodEnd === isoDate(input.periodEnd));
  const engagements = projection.engagements.filter((item) => Date.parse(item.createdAt) <= Date.parse(input.periodEnd));
  const summary = { tests: tests.length, effectiveTests: tests.filter((item) => item.result === "effective").length, deficientTests: tests.filter((item) => item.result === "deficiency").length, openIssues: issues.filter((item) => item.status !== "closed").length, overdueIssues: issues.filter((item) => item.status !== "closed" && Date.parse(item.dueAt) < now.getTime()).length, approvedCertifications: certifications.length, openEngagements: engagements.filter((item) => item.status !== "closed").length };
  const exceptions = issues.filter((item) => item.status !== "closed" && ["critical", "high"].includes(item.severity)).map((item) => ({ issueId: item.issueId, controlId: item.controlId, severity: item.severity, owner: item.owner, dueAt: item.dueAt, status: item.status }));
  const body = { packId: String(input.packId), committee: String(input.committee), periodStart: isoDate(input.periodStart), periodEnd: isoDate(input.periodEnd), summary, exceptions, certificationIds: certifications.map((item) => item.certificationId), engagementIds: engagements.map((item) => item.engagementId), sourceEvidenceRef: optionalText(input.sourceEvidenceRef) };
  return { ...body, packSha256: digest(body), generatedBy: String(input.generatedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), generatedAt: now.toISOString() };
}

export function projectControlAssurance(events = []) {
  const plans = new Map(); const tests = []; const issues = new Map(); const certifications = new Map(); const engagements = new Map(); const governancePacks = [];
  for (const event of events) {
    if (event.type === "platform.assurance.plan_approved" && event.plan) plans.set(event.plan.planId, event.plan);
    if (event.type === "platform.assurance.test_recorded" && event.test) tests.push(event.test);
    if (event.type?.startsWith("platform.assurance.issue_") && event.issue) issues.set(event.issue.issueId, event.issue);
    if (event.type?.startsWith("platform.assurance.certification_") && event.certification) certifications.set(event.certification.certificationId, event.certification);
    if (event.type?.startsWith("platform.assurance.engagement_") && event.engagement) engagements.set(event.engagement.engagementId, event.engagement);
    if (event.type === "platform.assurance.governance_pack_generated" && event.pack) governancePacks.push(event.pack);
  }
  return { plans: [...plans.values()], tests, issues: [...issues.values()], certifications: [...certifications.values()], engagements: [...engagements.values()], governancePacks };
}

function requirePeriod(start, end) { requireIsoDate(start, "periodStart"); requireIsoDate(end, "periodEnd"); if (Date.parse(start) >= Date.parse(end)) throw assuranceError("assurance_period_invalid", "periodEnd must be after periodStart."); }
function stringList(value, field, required = false) { if (value == null && !required) return []; if (!Array.isArray(value)) throw assuranceError("assurance_invalid", `${field} must be an array.`); const items = [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]; if (required && items.length === 0) throw assuranceError("assurance_invalid", `${field} requires at least one value.`); return items; }
function requireText(value, field, minimum = 1) { if (typeof value !== "string" || value.trim().length < minimum) throw assuranceError("assurance_invalid", `${field} is required.`); }
function optionalText(value) { return value == null || String(value).trim() === "" ? null : String(value); }
function positiveInteger(value, field) { if (!Number.isInteger(value) || value <= 0) throw assuranceError("assurance_invalid", `${field} must be a positive integer.`); return value; }
function nonNegativeInteger(value, field) { if (!Number.isInteger(value) || value < 0) throw assuranceError("assurance_invalid", `${field} must be a non-negative integer.`); return value; }
function requireIsoDate(value, field) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw assuranceError("assurance_invalid", `${field} must be an ISO date-time.`); }
function isoAtOrBefore(value, now, field) { requireIsoDate(value, field); if (Date.parse(value) > now.getTime()) throw assuranceError("assurance_invalid", `${field} cannot be in the future.`); return new Date(value).toISOString(); }
function isoDate(value) { return new Date(value).toISOString(); }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function assuranceError(code, message) { return Object.assign(new Error(message), { code }); }

export { CERTIFICATION_RESULTS, ENGAGEMENT_STATUSES, ENGAGEMENT_TYPES, ISSUE_SEVERITIES, ISSUE_STATUSES, PLAN_FREQUENCIES, TEST_RESULTS };
