const SUPPORT_SEVERITIES = new Set(["sev1", "sev2", "sev3", "sev4"]);
const SUPPORT_CATEGORIES = new Set(["availability", "security", "data_integrity", "provider", "performance", "compliance", "customer_operations", "change"]);
const SUPPORT_STATUSES = new Set(["open", "assigned", "acknowledged", "investigating", "monitoring", "resolved", "closed"]);
const PROBLEM_STATUSES = new Set(["investigating", "known_error", "remediation_in_progress", "resolved", "closed"]);
const VENDOR_TYPES = new Set(["sub_processor", "provider", "infrastructure", "critical_service"]);
const VENDOR_TIERS = new Set(["critical", "high", "standard"]);

const DEFAULT_SLA_MINUTES = Object.freeze({
  sev1: { acknowledge: 15, restore: 240, resolve: 1440 },
  sev2: { acknowledge: 30, restore: 480, resolve: 2880 },
  sev3: { acknowledge: 240, restore: 1440, resolve: 7200 },
  sev4: { acknowledge: 480, restore: 2880, resolve: 14400 }
});

export function createSupportCase(input, existingCases = [], now = new Date()) {
  requireText(input.caseId, "caseId");
  if (existingCases.some((item) => item.caseId === input.caseId)) throw operationsError("support_case_duplicate", "caseId already exists.");
  requireText(input.title, "title", 5);
  requireText(input.description, "description", 12);
  requireText(input.openedBy, "openedBy");
  requireText(input.channel, "channel");
  requireText(input.runbookRef, "runbookRef");
  if (!SUPPORT_SEVERITIES.has(input.severity)) throw operationsError("support_case_invalid", "severity is invalid.");
  if (!SUPPORT_CATEGORIES.has(input.category)) throw operationsError("support_case_invalid", "category is invalid.");
  const openedAt = now.toISOString();
  const targets = normalizeSupportTargets(input.slaMinutes, input.severity);
  if (input.slaMinutes != null) requireText(input.slaPolicyRef, "slaPolicyRef");
  return {
    caseId: String(input.caseId),
    tenantId: optionalText(input.tenantId),
    title: String(input.title),
    description: String(input.description),
    severity: input.severity,
    category: input.category,
    channel: String(input.channel),
    openedBy: String(input.openedBy),
    incidentId: optionalText(input.incidentId),
    affectedServices: stringList(input.affectedServices, "affectedServices", true),
    runbookRef: String(input.runbookRef),
    slaPolicyRef: optionalText(input.slaPolicyRef),
    status: "open",
    escalationLevel: 0,
    escalations: [],
    sla: {
      targetsMinutes: targets,
      acknowledgeDueAt: addMinutes(now, targets.acknowledge),
      restoreDueAt: addMinutes(now, targets.restore),
      resolveDueAt: addMinutes(now, targets.resolve)
    },
    openedAt,
    updatedAt: openedAt
  };
}

export function assignSupportCase(supportCase, input, now = new Date()) {
  requireCaseStatus(supportCase, ["open", "assigned", "acknowledged", "investigating"]);
  requireText(input.assignedBy, "assignedBy");
  requireText(input.onCallOwner, "onCallOwner");
  requireText(input.supportTeam, "supportTeam");
  requireText(input.escalationPolicyRef, "escalationPolicyRef");
  return {
    ...supportCase,
    status: supportCase.status === "open" ? "assigned" : supportCase.status,
    assignment: {
      onCallOwner: String(input.onCallOwner),
      supportTeam: String(input.supportTeam),
      escalationPolicyRef: String(input.escalationPolicyRef),
      assignedBy: String(input.assignedBy),
      assignedAt: now.toISOString()
    },
    updatedAt: now.toISOString()
  };
}

export function escalateSupportCase(supportCase, input, now = new Date()) {
  requireCaseStatus(supportCase, ["assigned", "acknowledged", "investigating", "monitoring"]);
  requireText(input.escalatedBy, "escalatedBy");
  requireText(input.escalationTarget, "escalationTarget");
  requireText(input.reason, "reason", 8);
  const level = positiveInteger(input.level, "level");
  if (level > 3 || level <= (supportCase.escalationLevel ?? 0)) throw operationsError("support_escalation_invalid", "Escalation level must increase and cannot exceed 3.");
  const entry = { level, escalationTarget: String(input.escalationTarget), reason: String(input.reason), escalatedBy: String(input.escalatedBy), escalatedAt: now.toISOString() };
  return { ...supportCase, escalationLevel: level, escalations: [...(supportCase.escalations ?? []), entry], updatedAt: now.toISOString() };
}

export function transitionSupportCase(supportCase, input, now = new Date()) {
  requireText(input.updatedBy, "updatedBy");
  if (!SUPPORT_STATUSES.has(input.status)) throw operationsError("support_transition_invalid", "status is invalid.");
  const allowed = {
    assigned: ["acknowledged", "investigating"],
    acknowledged: ["investigating"],
    investigating: ["monitoring", "resolved"],
    monitoring: ["investigating", "resolved"],
    resolved: ["closed", "investigating"]
  };
  if (!(allowed[supportCase.status] ?? []).includes(input.status)) throw operationsError("support_transition_invalid", `Cannot transition support case from ${supportCase.status} to ${input.status}.`);
  const next = { ...supportCase, status: input.status, updatedAt: now.toISOString() };
  if (input.status === "acknowledged" || (input.status === "investigating" && !supportCase.acknowledgedAt)) next.acknowledgedAt = now.toISOString();
  if (input.status === "monitoring") {
    requireText(input.restorationEvidenceRef, "restorationEvidenceRef");
    next.restoredAt = now.toISOString();
    next.restorationEvidenceRef = String(input.restorationEvidenceRef);
  }
  if (input.status === "resolved") {
    requireText(input.resolutionSummary, "resolutionSummary", 12);
    requireText(input.resolutionEvidenceRef, "resolutionEvidenceRef");
    next.resolutionSummary = String(input.resolutionSummary);
    next.resolutionEvidenceRef = String(input.resolutionEvidenceRef);
    next.problemId = optionalText(input.problemId) ?? supportCase.problemId ?? null;
    next.resolvedBy = String(input.updatedBy);
    next.resolvedAt = now.toISOString();
  }
  if (input.status === "closed") {
    requireText(input.closureApprovalRef, "closureApprovalRef");
    if (input.updatedBy === supportCase.resolvedBy) throw operationsError("support_four_eyes_required", "Support case closure requires an actor independent of the resolver.");
    next.closedBy = String(input.updatedBy);
    next.closureApprovalRef = String(input.closureApprovalRef);
    next.closedAt = now.toISOString();
  }
  return next;
}

export function enrichSupportCase(supportCase, asOf = new Date()) {
  const time = asOf.getTime();
  const acknowledgementMet = Boolean(supportCase.acknowledgedAt) && Date.parse(supportCase.acknowledgedAt) <= Date.parse(supportCase.sla.acknowledgeDueAt);
  const restorationAt = supportCase.restoredAt ?? supportCase.resolvedAt;
  const restorationMet = Boolean(restorationAt) && Date.parse(restorationAt) <= Date.parse(supportCase.sla.restoreDueAt);
  const resolutionMet = Boolean(supportCase.resolvedAt) && Date.parse(supportCase.resolvedAt) <= Date.parse(supportCase.sla.resolveDueAt);
  const checks = {
    acknowledgement: supportCase.acknowledgedAt ? (acknowledgementMet ? "met" : "breached") : time > Date.parse(supportCase.sla.acknowledgeDueAt) ? "breached" : "pending",
    restoration: restorationAt ? (restorationMet ? "met" : "breached") : time > Date.parse(supportCase.sla.restoreDueAt) ? "breached" : "pending",
    resolution: supportCase.resolvedAt ? (resolutionMet ? "met" : "breached") : time > Date.parse(supportCase.sla.resolveDueAt) ? "breached" : "pending"
  };
  return { ...supportCase, sla: { ...supportCase.sla, checks, status: Object.values(checks).includes("breached") ? "breached" : Object.values(checks).every((value) => value === "met") ? "met" : "in_progress" } };
}

export function createProblemRecord(input, supportCases = [], existingProblems = [], now = new Date()) {
  requireText(input.problemId, "problemId");
  if (existingProblems.some((item) => item.problemId === input.problemId)) throw operationsError("problem_duplicate", "problemId already exists.");
  requireText(input.title, "title", 5);
  requireText(input.description, "description", 12);
  requireText(input.owner, "owner");
  requireText(input.createdBy, "createdBy");
  const relatedCaseIds = stringList(input.relatedCaseIds, "relatedCaseIds", true);
  const knownIds = new Set(supportCases.map((item) => item.caseId));
  if (relatedCaseIds.some((id) => !knownIds.has(id))) throw operationsError("problem_case_unknown", "Every related support case must exist.");
  return {
    problemId: String(input.problemId), title: String(input.title), description: String(input.description), owner: String(input.owner), createdBy: String(input.createdBy),
    relatedCaseIds, relatedIncidentIds: stringList(input.relatedIncidentIds, "relatedIncidentIds"), status: "investigating", createdAt: now.toISOString(), updatedAt: now.toISOString()
  };
}

export function transitionProblemRecord(problem, input, now = new Date()) {
  requireText(input.updatedBy, "updatedBy");
  if (!PROBLEM_STATUSES.has(input.status)) throw operationsError("problem_transition_invalid", "status is invalid.");
  const allowed = { investigating: ["known_error", "remediation_in_progress"], known_error: ["remediation_in_progress"], remediation_in_progress: ["resolved"], resolved: ["closed", "remediation_in_progress"] };
  if (!(allowed[problem.status] ?? []).includes(input.status)) throw operationsError("problem_transition_invalid", `Cannot transition problem from ${problem.status} to ${input.status}.`);
  const next = { ...problem, status: input.status, updatedAt: now.toISOString() };
  if (input.status === "known_error" || input.status === "remediation_in_progress") {
    requireText(input.rootCause, "rootCause", 12);
    next.rootCause = String(input.rootCause);
    next.workaroundRef = optionalText(input.workaroundRef) ?? problem.workaroundRef ?? null;
  }
  if (input.status === "resolved") {
    requireText(input.rootCause ?? problem.rootCause, "rootCause", 12);
    const actions = stringList(input.correctiveActions, "correctiveActions", true);
    requireText(input.verificationRef, "verificationRef");
    next.rootCause = String(input.rootCause ?? problem.rootCause);
    next.correctiveActions = actions;
    next.verificationRef = String(input.verificationRef);
    next.resolvedBy = String(input.updatedBy);
    next.resolvedAt = now.toISOString();
  }
  if (input.status === "closed") {
    requireText(input.closureApprovalRef, "closureApprovalRef");
    if (input.updatedBy === problem.resolvedBy) throw operationsError("problem_four_eyes_required", "Problem closure requires independent approval.");
    next.closedBy = String(input.updatedBy);
    next.closureApprovalRef = String(input.closureApprovalRef);
    next.closedAt = now.toISOString();
  }
  return next;
}

export function createVendorProfile(input, existingProfiles = [], knownSubProcessors = [], knownTenantIds = [], now = new Date()) {
  requireText(input.vendorId, "vendorId");
  if (existingProfiles.some((item) => item.vendorId === input.vendorId)) throw operationsError("vendor_duplicate", "vendorId already exists.");
  requireText(input.name, "name");
  if (!VENDOR_TYPES.has(input.dependencyType)) throw operationsError("vendor_invalid", "dependencyType is invalid.");
  if (!VENDOR_TIERS.has(input.tier)) throw operationsError("vendor_invalid", "tier is invalid.");
  const subProcessor = knownSubProcessors.find((item) => item.subProcessorId === input.subProcessorId);
  if (input.dependencyType === "sub_processor" && !subProcessor) throw operationsError("vendor_sub_processor_unknown", "A registered sub-processor is required.");
  requireText(input.contractRef, "contractRef");
  requireText(input.owner, "owner");
  requireText(input.dueDiligenceRef, "dueDiligenceRef");
  requireText(input.exitPlanRef, "exitPlanRef");
  requireText(input.dataResidencyCountry, "dataResidencyCountry");
  if (subProcessor && String(subProcessor.dataResidencyCountry).toUpperCase() !== String(input.dataResidencyCountry).toUpperCase()) throw operationsError("vendor_sub_processor_mismatch", "Vendor residency must match the registered sub-processor.");
  if (String(input.dataResidencyCountry).toUpperCase() !== "IN" && !optionalText(input.crossBorderApprovalRef)) throw operationsError("vendor_cross_border_evidence_missing", "Cross-border processing requires approval evidence.");
  const reviewCadenceDays = positiveInteger(input.reviewCadenceDays, "reviewCadenceDays");
  const targets = {
    availabilityPct: percentage(input.slaTargets?.availabilityPct, "slaTargets.availabilityPct"),
    responseMinutes: positiveInteger(input.slaTargets?.responseMinutes, "slaTargets.responseMinutes"),
    restorationMinutes: positiveInteger(input.slaTargets?.restorationMinutes, "slaTargets.restorationMinutes")
  };
  const dependentTenantIds = stringList(input.dependentTenantIds, "dependentTenantIds", true);
  if (knownTenantIds.length > 0 && dependentTenantIds.some((tenantId) => !knownTenantIds.includes(tenantId))) throw operationsError("vendor_tenant_unknown", "Every dependent tenant must be registered.");
  return {
    vendorId: String(input.vendorId), subProcessorId: optionalText(input.subProcessorId), name: String(input.name), dependencyType: input.dependencyType, tier: input.tier,
    services: stringList(input.services, "services", true), dependentTenantIds, contractRef: String(input.contractRef), owner: String(input.owner),
    alternateProviderRef: optionalText(input.alternateProviderRef), exitPlanRef: String(input.exitPlanRef), dueDiligenceRef: String(input.dueDiligenceRef), dataResidencyCountry: String(input.dataResidencyCountry).toUpperCase(),
    crossBorderApprovalRef: optionalText(input.crossBorderApprovalRef), reviewCadenceDays, slaTargets: targets, status: "active", createdAt: now.toISOString(), updatedAt: now.toISOString(), nextReviewAt: addDays(now, reviewCadenceDays)
  };
}

export function completeVendorReview(profile, input, now = new Date()) {
  requireText(input.reviewId, "reviewId");
  requireText(input.reviewedBy, "reviewedBy");
  for (const field of ["dueDiligenceRef", "securityAssessmentRef", "bcpTestRef", "exitReadinessRef", "approvalRef"]) requireText(input[field], field);
  const findings = stringList(input.findings, "findings");
  const actions = stringList(input.actions, "actions");
  if (findings.length > 0 && actions.length === 0) throw operationsError("vendor_review_actions_missing", "Review findings require actions.");
  const review = { reviewId: String(input.reviewId), vendorId: profile.vendorId, reviewedBy: String(input.reviewedBy), dueDiligenceRef: String(input.dueDiligenceRef), securityAssessmentRef: String(input.securityAssessmentRef), bcpTestRef: String(input.bcpTestRef), exitReadinessRef: String(input.exitReadinessRef), approvalRef: String(input.approvalRef), findings, actions, outcome: findings.length ? "action_required" : "satisfactory", reviewedAt: now.toISOString() };
  return { profile: { ...profile, dueDiligenceRef: review.dueDiligenceRef, lastReviewAt: review.reviewedAt, nextReviewAt: addDays(now, profile.reviewCadenceDays), updatedAt: now.toISOString() }, review };
}

export function assessVendorSla(profile, input, now = new Date()) {
  requireText(input.assessmentId, "assessmentId");
  requireText(input.assessedBy, "assessedBy");
  requireText(input.evidenceRef, "evidenceRef");
  requireIsoDate(input.windowStart, "windowStart");
  requireIsoDate(input.windowEnd, "windowEnd");
  if (Date.parse(input.windowStart) >= Date.parse(input.windowEnd)) throw operationsError("vendor_sla_invalid", "windowEnd must be after windowStart.");
  if (Date.parse(input.windowEnd) > now.getTime()) throw operationsError("vendor_sla_invalid", "SLA assessment window cannot end in the future.");
  const actuals = { availabilityPct: percentage(input.actuals?.availabilityPct, "actuals.availabilityPct"), responseMinutes: nonNegativeNumber(input.actuals?.responseMinutes, "actuals.responseMinutes"), restorationMinutes: nonNegativeNumber(input.actuals?.restorationMinutes, "actuals.restorationMinutes"), incidentCount: nonNegativeInteger(input.actuals?.incidentCount, "actuals.incidentCount") };
  const checks = { availability: actuals.availabilityPct >= profile.slaTargets.availabilityPct, response: actuals.responseMinutes <= profile.slaTargets.responseMinutes, restoration: actuals.restorationMinutes <= profile.slaTargets.restorationMinutes };
  const status = Object.values(checks).every(Boolean) ? "met" : "breached";
  const findings = stringList(input.findings, "findings");
  const actions = stringList(input.actions, "actions");
  if (status === "breached" && (findings.length === 0 || actions.length === 0)) throw operationsError("vendor_sla_remediation_missing", "An SLA breach requires findings and remediation actions.");
  return { assessmentId: String(input.assessmentId), vendorId: profile.vendorId, windowStart: new Date(input.windowStart).toISOString(), windowEnd: new Date(input.windowEnd).toISOString(), targets: profile.slaTargets, actuals, checks, status, evidenceRef: String(input.evidenceRef), findings, actions, assessedBy: String(input.assessedBy), assessedAt: now.toISOString() };
}

export function assessDependencyConcentration(profiles, input, now = new Date()) {
  requireText(input.assessmentId, "assessmentId");
  requireText(input.assessedBy, "assessedBy");
  requireText(input.evidenceRef, "evidenceRef");
  const thresholdPct = percentage(input.thresholdPct, "thresholdPct");
  const active = profiles.filter((item) => item.status === "active");
  const services = [...new Set(active.flatMap((item) => item.services))].sort();
  const exposures = services.flatMap((service) => {
    const vendors = active.filter((item) => item.services.includes(service));
    const tenantUniverse = new Set(vendors.flatMap((item) => item.dependentTenantIds));
    return vendors.map((vendor) => {
      const tenantSharePct = tenantUniverse.size === 0 ? 0 : Number(((vendor.dependentTenantIds.length * 100) / tenantUniverse.size).toFixed(2));
      const riskReasons = [];
      if (tenantSharePct >= thresholdPct) riskReasons.push("tenant_concentration");
      if (vendor.tier === "critical" && !vendor.alternateProviderRef) riskReasons.push("single_point_of_failure");
      if (Date.parse(vendor.nextReviewAt) < now.getTime()) riskReasons.push("review_overdue");
      return { service, vendorId: vendor.vendorId, tier: vendor.tier, dependentTenantCount: vendor.dependentTenantIds.length, tenantUniverseCount: tenantUniverse.size, tenantSharePct, alternateProviderRef: vendor.alternateProviderRef, riskReasons, status: riskReasons.length ? "action_required" : "within_threshold" };
    });
  });
  const status = exposures.some((item) => item.status === "action_required") ? "action_required" : "within_threshold";
  const actions = stringList(input.actions, "actions");
  if (status === "action_required" && actions.length === 0) throw operationsError("vendor_concentration_remediation_missing", "Concentration findings require remediation actions.");
  return { assessmentId: String(input.assessmentId), thresholdPct, status, exposures, actions, evidenceRef: String(input.evidenceRef), assessedBy: String(input.assessedBy), assessedAt: now.toISOString() };
}

export function projectServiceOperations(events = [], asOf = new Date()) {
  const supportCases = new Map();
  const problems = new Map();
  const vendors = new Map();
  const vendorReviews = [];
  const vendorSlaAssessments = [];
  const concentrationAssessments = [];
  for (const event of events) {
    if (event.type?.startsWith("platform.operations.support_") && event.supportCase?.caseId) supportCases.set(event.supportCase.caseId, event.supportCase);
    if (event.type?.startsWith("platform.operations.problem_") && event.problem?.problemId) problems.set(event.problem.problemId, event.problem);
    if (event.type?.startsWith("platform.operations.vendor_") && event.vendor?.vendorId) vendors.set(event.vendor.vendorId, event.vendor);
    if (event.type === "platform.operations.vendor_reviewed" && event.review) vendorReviews.push(event.review);
    if (event.type === "platform.operations.vendor_sla_assessed" && event.assessment) vendorSlaAssessments.push(event.assessment);
    if (event.type === "platform.operations.concentration_assessed" && event.assessment) concentrationAssessments.push(event.assessment);
  }
  return { supportCases: [...supportCases.values()].map((item) => enrichSupportCase(item, asOf)), problems: [...problems.values()], vendors: [...vendors.values()], vendorReviews, vendorSlaAssessments, concentrationAssessments };
}

function normalizeSupportTargets(value, severity) {
  if (value == null) return { ...DEFAULT_SLA_MINUTES[severity] };
  const targets = { acknowledge: positiveInteger(value.acknowledge, "slaMinutes.acknowledge"), restore: positiveInteger(value.restore, "slaMinutes.restore"), resolve: positiveInteger(value.resolve, "slaMinutes.resolve") };
  if (!(targets.acknowledge <= targets.restore && targets.restore <= targets.resolve)) throw operationsError("support_sla_invalid", "SLA targets must be ordered acknowledge <= restore <= resolve.");
  return targets;
}

function requireCaseStatus(value, statuses) { if (!value || !statuses.includes(value.status)) throw operationsError("support_transition_invalid", "Support case is not in a valid state for this action."); }
function requireText(value, field, minimum = 1) { if (typeof value !== "string" || value.trim().length < minimum) throw operationsError("operations_invalid", `${field} is required.`); }
function optionalText(value) { return value == null || String(value).trim() === "" ? null : String(value); }
function stringList(value, field, required = false) { if (value == null && !required) return []; if (!Array.isArray(value)) throw operationsError("operations_invalid", `${field} must be an array.`); const items = [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]; if (required && items.length === 0) throw operationsError("operations_invalid", `${field} requires at least one value.`); return items; }
function positiveInteger(value, field) { if (!Number.isInteger(value) || value <= 0) throw operationsError("operations_invalid", `${field} must be a positive integer.`); return value; }
function nonNegativeInteger(value, field) { if (!Number.isInteger(value) || value < 0) throw operationsError("operations_invalid", `${field} must be a non-negative integer.`); return value; }
function nonNegativeNumber(value, field) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw operationsError("operations_invalid", `${field} must be a non-negative number.`); return value; }
function percentage(value, field) { const result = nonNegativeNumber(value, field); if (result > 100) throw operationsError("operations_invalid", `${field} cannot exceed 100.`); return result; }
function requireIsoDate(value, field) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw operationsError("operations_invalid", `${field} must be an ISO date-time.`); }
function addMinutes(now, minutes) { return new Date(now.getTime() + minutes * 60_000).toISOString(); }
function addDays(now, days) { return new Date(now.getTime() + days * 86_400_000).toISOString(); }
function operationsError(code, message) { return Object.assign(new Error(message), { code }); }

export { DEFAULT_SLA_MINUTES, PROBLEM_STATUSES, SUPPORT_CATEGORIES, SUPPORT_SEVERITIES, SUPPORT_STATUSES, VENDOR_TIERS, VENDOR_TYPES };
