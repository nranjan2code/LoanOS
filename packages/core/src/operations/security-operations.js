import { createHash } from "node:crypto";

const SECURITY_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const LOG_SOURCES = new Set(["identity", "application", "audit", "database", "cloud", "network", "endpoint", "provider", "decision_engine"]);
const ALERT_DISPOSITIONS = new Set(["benign", "false_positive", "suspicious", "confirmed"]);
const INVESTIGATION_STATUSES = new Set(["investigating", "contained", "eradicated", "recovered", "closed"]);
const ALERT_ACKNOWLEDGEMENT_MINUTES = Object.freeze({ critical: 15, high: 30, medium: 120, low: 480 });

export function createDetectionRule(input, existing = [], now = new Date()) {
  requireText(input.ruleId, "ruleId");
  const version = positiveInteger(input.version, "version");
  if (existing.some((item) => item.ruleId === input.ruleId && item.version === version)) throw securityOperationsError("detection_rule_duplicate", "ruleId and version already exist.");
  requireText(input.name, "name", 5);
  requireText(input.description, "description", 12);
  if (!SECURITY_SEVERITIES.has(input.severity)) throw securityOperationsError("detection_rule_invalid", "severity is invalid.");
  const logSources = enumList(input.logSources, LOG_SOURCES, "logSources", true);
  for (const field of ["detectionRef", "playbookRef", "owner", "proposedBy", "approvedBy", "approvalRef", "testEvidenceRef"]) requireText(input[field], field);
  if (input.proposedBy === input.approvedBy) throw securityOperationsError("detection_rule_four_eyes_required", "Detection rule requires independent approval.");
  return { ruleId: String(input.ruleId), version, name: String(input.name), description: String(input.description), severity: input.severity, logSources, detectionRef: String(input.detectionRef), playbookRef: String(input.playbookRef), owner: String(input.owner), proposedBy: String(input.proposedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), testEvidenceRef: String(input.testEvidenceRef), status: "active", approvedAt: now.toISOString() };
}

export function createSecurityAlert(input, rules = [], existing = [], now = new Date()) {
  requireText(input.alertId, "alertId");
  if (existing.some((item) => item.alertId === input.alertId)) throw securityOperationsError("security_alert_duplicate", "alertId already exists.");
  const rule = rules.find((item) => item.ruleId === input.ruleId && item.version === input.ruleVersion && item.status === "active");
  if (!rule) throw securityOperationsError("detection_rule_inactive", "An active detection rule version is required.");
  if (!rule.logSources.includes(input.logSource)) throw securityOperationsError("security_alert_invalid", "Alert logSource is not covered by its detection rule.");
  for (const field of ["title", "summary", "deduplicationKey", "evidenceRef", "eventSha256", "detectedBy"]) requireText(input[field], field, field === "summary" ? 12 : 1);
  requireDigest(input.eventSha256, "eventSha256");
  const observedAt = isoAtOrBefore(input.observedAt, now, "observedAt");
  if (existing.some((item) => item.deduplicationKey === input.deduplicationKey && item.status !== "closed")) throw securityOperationsError("security_alert_duplicate_signal", "An unresolved alert already has this deduplication key.");
  return { alertId: String(input.alertId), tenantId: optionalText(input.tenantId), ruleId: rule.ruleId, ruleVersion: rule.version, severity: rule.severity, title: String(input.title), summary: String(input.summary), logSource: input.logSource, deduplicationKey: String(input.deduplicationKey), evidenceRef: String(input.evidenceRef), eventSha256: input.eventSha256.toLowerCase(), entityRefs: stringList(input.entityRefs, "entityRefs"), detectedBy: String(input.detectedBy), observedAt, status: "open", acknowledgementDueAt: addMinutes(new Date(observedAt), ALERT_ACKNOWLEDGEMENT_MINUTES[rule.severity]), createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

export function triageSecurityAlert(alert, input, now = new Date()) {
  if (!alert || alert.status !== "open") throw securityOperationsError("security_alert_transition_invalid", "Only an open alert can be triaged.");
  requireText(input.analyst, "analyst");
  if (!ALERT_DISPOSITIONS.has(input.disposition)) throw securityOperationsError("security_alert_invalid", "disposition is invalid.");
  requireText(input.analysis, "analysis", 12);
  requireText(input.evidenceRef, "evidenceRef");
  const dismissing = ["benign", "false_positive"].includes(input.disposition);
  if (dismissing) {
    requireText(input.reviewedBy, "reviewedBy");
    requireText(input.approvalRef, "approvalRef");
    if (input.reviewedBy === input.analyst) throw securityOperationsError("security_alert_four_eyes_required", "Dismissal requires independent review.");
  }
  return { ...alert, status: dismissing ? "closed" : "escalated", disposition: input.disposition, analysis: String(input.analysis), triageEvidenceRef: String(input.evidenceRef), analyst: String(input.analyst), reviewedBy: dismissing ? String(input.reviewedBy) : null, approvalRef: dismissing ? String(input.approvalRef) : null, acknowledgedAt: now.toISOString(), acknowledgementStatus: now.getTime() <= Date.parse(alert.acknowledgementDueAt) ? "met" : "breached", updatedAt: now.toISOString(), ...(dismissing ? { closedAt: now.toISOString() } : {}) };
}

export function createSecurityInvestigation(input, alerts = [], existing = [], now = new Date()) {
  requireText(input.investigationId, "investigationId");
  if (existing.some((item) => item.investigationId === input.investigationId)) throw securityOperationsError("security_investigation_duplicate", "investigationId already exists.");
  const alertIds = stringList(input.alertIds, "alertIds", true);
  const linked = alertIds.map((id) => alerts.find((item) => item.alertId === id));
  if (linked.some((item) => !item || item.status !== "escalated")) throw securityOperationsError("security_investigation_alert_invalid", "Every linked alert must exist and be escalated.");
  const linkedTenantIds = [...new Set(linked.map((item) => item.tenantId).filter(Boolean))];
  if (linkedTenantIds.length > 1 || (input.tenantId && linkedTenantIds.length === 1 && input.tenantId !== linkedTenantIds[0])) throw securityOperationsError("security_investigation_tenant_mismatch", "An investigation cannot combine or override alert tenant scope.");
  for (const field of ["title", "hypothesis", "lead", "createdBy", "playbookRef"]) requireText(input[field], field, ["title", "hypothesis"].includes(field) ? 8 : 1);
  const order = { low: 1, medium: 2, high: 3, critical: 4 };
  const severity = linked.map((item) => item.severity).sort((a, b) => order[b] - order[a])[0];
  return { investigationId: String(input.investigationId), tenantId: optionalText(input.tenantId) ?? linkedTenantIds[0] ?? null, title: String(input.title), hypothesis: String(input.hypothesis), severity, alertIds, incidentId: optionalText(input.incidentId), supportCaseId: optionalText(input.supportCaseId), lead: String(input.lead), createdBy: String(input.createdBy), playbookRef: String(input.playbookRef), status: "investigating", evidence: [], createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

export function preserveInvestigationEvidence(investigation, input, now = new Date()) {
  if (!investigation || investigation.status === "closed") throw securityOperationsError("security_evidence_invalid", "Evidence requires an active investigation.");
  requireText(input.evidenceId, "evidenceId");
  if ((investigation.evidence ?? []).some((item) => item.evidenceId === input.evidenceId)) throw securityOperationsError("security_evidence_duplicate", "evidenceId already exists in the investigation.");
  for (const field of ["source", "storageRef", "collectedBy", "description"]) requireText(input[field], field, field === "description" ? 8 : 1);
  requireDigest(input.contentSha256, "contentSha256");
  if (String(input.dataResidencyCountry).toUpperCase() !== "IN") throw securityOperationsError("security_evidence_residency_invalid", "Investigation evidence must be retained in India.");
  const collectedAt = isoAtOrBefore(input.collectedAt, now, "collectedAt");
  requireIsoDate(input.retentionUntil, "retentionUntil");
  if (Date.parse(input.retentionUntil) <= now.getTime()) throw securityOperationsError("security_evidence_invalid", "retentionUntil must be in the future.");
  const priorEvidenceHash = investigation.evidence?.at(-1)?.evidenceHash ?? "0".repeat(64);
  const base = { evidenceId: String(input.evidenceId), source: String(input.source), storageRef: String(input.storageRef), description: String(input.description), contentSha256: input.contentSha256.toLowerCase(), collectedBy: String(input.collectedBy), collectedAt, dataResidencyCountry: "IN", retentionUntil: new Date(input.retentionUntil).toISOString(), legalHold: input.legalHold === true, priorEvidenceHash };
  const evidence = { ...base, evidenceHash: digest(base) };
  return { investigation: { ...investigation, evidence: [...(investigation.evidence ?? []), evidence], updatedAt: now.toISOString() }, evidence };
}

export function transitionSecurityInvestigation(investigation, input, now = new Date()) {
  requireText(input.updatedBy, "updatedBy");
  if (!INVESTIGATION_STATUSES.has(input.status)) throw securityOperationsError("security_investigation_transition_invalid", "status is invalid.");
  const allowed = { investigating: ["contained"], contained: ["eradicated"], eradicated: ["recovered"], recovered: ["closed", "eradicated"] };
  if (!(allowed[investigation.status] ?? []).includes(input.status)) throw securityOperationsError("security_investigation_transition_invalid", `Cannot transition investigation from ${investigation.status} to ${input.status}.`);
  const next = { ...investigation, status: input.status, updatedAt: now.toISOString() };
  if (input.status === "contained") { next.containmentActions = stringList(input.actions, "actions", true); requireText(input.evidenceRef, "evidenceRef"); next.containmentEvidenceRef = String(input.evidenceRef); next.containedAt = now.toISOString(); }
  if (input.status === "eradicated") { next.eradicationActions = stringList(input.actions, "actions", true); requireText(input.evidenceRef, "evidenceRef"); next.eradicationEvidenceRef = String(input.evidenceRef); next.eradicatedAt = now.toISOString(); }
  if (input.status === "recovered") { requireText(input.recoveryEvidenceRef, "recoveryEvidenceRef"); requireText(input.monitoringRef, "monitoringRef"); next.recoveryEvidenceRef = String(input.recoveryEvidenceRef); next.monitoringRef = String(input.monitoringRef); next.recoveredBy = String(input.updatedBy); next.recoveredAt = now.toISOString(); }
  if (input.status === "closed") {
    for (const field of ["rootCause", "closureEvidenceRef", "approvalRef"]) requireText(input[field], field, field === "rootCause" ? 12 : 1);
    const lessons = stringList(input.lessons, "lessons", true);
    const detectionRuleChanges = stringList(input.detectionRuleChanges, "detectionRuleChanges", true);
    if (input.updatedBy === investigation.recoveredBy) throw securityOperationsError("security_investigation_four_eyes_required", "Closure requires an actor independent of recovery.");
    next.rootCause = String(input.rootCause); next.lessons = lessons; next.detectionRuleChanges = detectionRuleChanges; next.closureEvidenceRef = String(input.closureEvidenceRef); next.approvalRef = String(input.approvalRef); next.closedBy = String(input.updatedBy); next.closedAt = now.toISOString();
  }
  return next;
}

export function assessDetectionCoverage(input, now = new Date()) {
  for (const field of ["assessmentId", "assessedBy", "approvedBy", "approvalRef", "evidenceRef"]) requireText(input[field], field);
  if (input.assessedBy === input.approvedBy) throw securityOperationsError("coverage_four_eyes_required", "Coverage assessment requires independent approval.");
  const requiredSources = enumList(input.requiredSources, LOG_SOURCES, "requiredSources", true);
  if (!Array.isArray(input.sources)) throw securityOperationsError("coverage_invalid", "sources must be an array.");
  const sources = input.sources.map((source) => {
    if (!LOG_SOURCES.has(source.logSource)) throw securityOperationsError("coverage_invalid", "logSource is invalid.");
    requireText(source.ingestionEvidenceRef, "ingestionEvidenceRef");
    requireText(source.timeSyncEvidenceRef, "timeSyncEvidenceRef");
    return { logSource: source.logSource, active: source.active === true, retentionDays: nonNegativeInteger(source.retentionDays, "retentionDays"), timeSynchronized: source.timeSynchronized === true, ingestionEvidenceRef: String(source.ingestionEvidenceRef), timeSyncEvidenceRef: String(source.timeSyncEvidenceRef) };
  });
  const checks = requiredSources.map((logSource) => { const source = sources.find((item) => item.logSource === logSource); const gaps = []; if (!source?.active) gaps.push("ingestion_inactive"); if (!source || source.retentionDays < 180) gaps.push("retention_below_180_days"); if (!source?.timeSynchronized) gaps.push("time_not_synchronized"); return { logSource, status: gaps.length ? "gap" : "covered", gaps }; });
  const status = checks.every((item) => item.status === "covered") ? "covered" : "gaps_found";
  const actions = stringList(input.actions, "actions");
  if (status === "gaps_found" && actions.length === 0) throw securityOperationsError("coverage_actions_missing", "Coverage gaps require remediation actions.");
  return { assessmentId: String(input.assessmentId), requiredSources, sources, checks, coveragePct: Number(((checks.filter((item) => item.status === "covered").length * 100) / checks.length).toFixed(2)), status, actions, evidenceRef: String(input.evidenceRef), assessedBy: String(input.assessedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), assessedAt: now.toISOString() };
}

export function projectSecurityOperations(events = [], asOf = new Date()) {
  const rules = new Map(); const alerts = new Map(); const investigations = new Map(); const coverageAssessments = [];
  for (const event of events) {
    if (event.type === "platform.soc.rule_approved" && event.rule) rules.set(`${event.rule.ruleId}:${event.rule.version}`, event.rule);
    if (event.type?.startsWith("platform.soc.alert_") && event.alert?.alertId) alerts.set(event.alert.alertId, event.alert);
    if (event.type?.startsWith("platform.soc.investigation_") && event.investigation?.investigationId) investigations.set(event.investigation.investigationId, event.investigation);
    if (event.type === "platform.soc.coverage_assessed" && event.assessment) coverageAssessments.push(event.assessment);
  }
  const investigationValues = [...investigations.values()];
  const alertValues = [...alerts.values()].map((alert) => {
    const investigation = investigationValues.find((item) => item.alertIds.includes(alert.alertId));
    return { ...alert, ...(investigation ? { status: investigation.status === "closed" ? "closed" : "investigating", investigationId: investigation.investigationId } : {}), acknowledgementStatus: alert.acknowledgedAt ? alert.acknowledgementStatus : asOf.getTime() > Date.parse(alert.acknowledgementDueAt) ? "breached" : "pending" };
  });
  return { rules: [...rules.values()], alerts: alertValues, investigations: investigationValues, coverageAssessments };
}

function enumList(value, allowed, field, required = false) { const items = stringList(value, field, required); if (items.some((item) => !allowed.has(item))) throw securityOperationsError("security_operations_invalid", `${field} contains an invalid value.`); return items; }
function stringList(value, field, required = false) { if (value == null && !required) return []; if (!Array.isArray(value)) throw securityOperationsError("security_operations_invalid", `${field} must be an array.`); const items = [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]; if (required && items.length === 0) throw securityOperationsError("security_operations_invalid", `${field} requires at least one value.`); return items; }
function requireText(value, field, minimum = 1) { if (typeof value !== "string" || value.trim().length < minimum) throw securityOperationsError("security_operations_invalid", `${field} is required.`); }
function optionalText(value) { return value == null || String(value).trim() === "" ? null : String(value); }
function positiveInteger(value, field) { if (!Number.isInteger(value) || value <= 0) throw securityOperationsError("security_operations_invalid", `${field} must be a positive integer.`); return value; }
function nonNegativeInteger(value, field) { if (!Number.isInteger(value) || value < 0) throw securityOperationsError("security_operations_invalid", `${field} must be a non-negative integer.`); return value; }
function requireDigest(value, field) { if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) throw securityOperationsError("security_operations_invalid", `${field} must be a SHA-256 hex digest.`); }
function requireIsoDate(value, field) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw securityOperationsError("security_operations_invalid", `${field} must be an ISO date-time.`); }
function isoAtOrBefore(value, now, field) { requireIsoDate(value, field); if (Date.parse(value) > now.getTime()) throw securityOperationsError("security_operations_invalid", `${field} cannot be in the future.`); return new Date(value).toISOString(); }
function addMinutes(now, minutes) { return new Date(now.getTime() + minutes * 60_000).toISOString(); }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function securityOperationsError(code, message) { return Object.assign(new Error(message), { code }); }

export { ALERT_ACKNOWLEDGEMENT_MINUTES, ALERT_DISPOSITIONS, INVESTIGATION_STATUSES, LOG_SOURCES, SECURITY_SEVERITIES };
