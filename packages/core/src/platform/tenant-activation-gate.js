import { createHash } from "node:crypto";

export const TENANT_ACTIVATION_STATUSES = Object.freeze(["blocked", "sandbox_ready", "production_ready"]);
export const TENANT_ACTIVATION_EVIDENCE_MODES = Object.freeze(["simulated", "live"]);
export const TENANT_ACTIVATION_DIMENSIONS = Object.freeze([
  "organisation_admission",
  "iam_staffing",
  "products",
  "integrations",
  "deployment",
  "security_controls",
  "uat",
  "drills"
]);

/**
 * Produces the digest accepted by assessTenantActivation. The checksum binds the
 * complete envelope (tenant, dimension, validity, source reference and payload),
 * not only the provider result embedded in the payload.
 */
export function checksumTenantActivationEvidence(evidence) {
  return sha256(without(evidence ?? {}, "evidenceChecksumSha256"));
}

/**
 * Conservatively joins every tenant launch prerequisite. Invalid evidence is a
 * finding rather than an exception so operators get a complete, fail-closed
 * remediation list in one assessment.
 */
export function assessTenantActivation(input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId");
  const assessmentId = required(input.assessmentId, "assessmentId");
  const asOf = validDate(now, "now");
  const maxEvidenceAgeDays = boundedInteger(input.maxEvidenceAgeDays ?? 90, 1, 365, "maxEvidenceAgeDays");
  const requirements = Object.freeze({
    selectedProductIds: identifiers(input.selectedProductIds, "selectedProductIds", true),
    requiredIntegrationIds: identifiers(input.requiredIntegrationIds, "requiredIntegrationIds", false),
    requiredDeploymentComponentIds: identifiers(input.requiredDeploymentComponentIds, "requiredDeploymentComponentIds", true),
    requiredSecurityControlIds: identifiers(input.requiredSecurityControlIds, "requiredSecurityControlIds", true),
    requiredDrillScenarioIds: identifiers(input.requiredDrillScenarioIds, "requiredDrillScenarioIds", true)
  });

  const dimensions = {};
  const blockers = [];
  const productionGaps = [];
  const staleEvidence = [];

  for (const dimension of TENANT_ACTIVATION_DIMENSIONS) {
    const findings = validateEnvelope(input.evidence?.[dimension], { tenantId, dimension, asOf, maxEvidenceAgeDays });
    if (!findings.length) findings.push(...validateDimension(dimension, input.evidence[dimension].payload, requirements, tenantId, asOf));
    const sandboxReady = findings.length === 0;
    const liveFindings = sandboxReady ? validateLiveEvidence(dimension, input.evidence[dimension], requirements, tenantId, asOf) : [];
    const productionReady = sandboxReady && liveFindings.length === 0;
    const entry = Object.freeze({
      dimension,
      evidenceId: input.evidence?.[dimension]?.evidenceId ?? null,
      sandboxReady,
      productionReady,
      mode: input.evidence?.[dimension]?.mode ?? null,
      commerciallyLive: input.evidence?.[dimension]?.commerciallyLive === true,
      findings: Object.freeze(sortFindings(findings)),
      productionGaps: Object.freeze(sortFindings(liveFindings))
    });
    dimensions[dimension] = entry;
    blockers.push(...entry.findings);
    productionGaps.push(...entry.productionGaps);
    staleEvidence.push(...entry.findings.filter((finding) => ["evidence_stale", "evidence_expired", "item_expired"].includes(finding.code)));
  }

  const status = blockers.length
    ? "blocked"
    : productionGaps.length
      ? "sandbox_ready"
      : "production_ready";
  const body = {
    assessmentId,
    tenantId,
    status,
    requirements,
    dimensions,
    blockers: sortFindings(blockers),
    productionGaps: sortFindings(productionGaps),
    staleEvidence: sortFindings(staleEvidence),
    assessedAt: asOf.toISOString(),
    policy: Object.freeze({
      maxEvidenceAgeDays,
      productionRequiresLiveEvidence: true,
      simulatorEvidenceCanReachProduction: false
    })
  };
  return Object.freeze({ ...body, assessmentChecksumSha256: sha256(body) });
}

function validateEnvelope(evidence, context) {
  const findings = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return [finding(context.dimension, "evidence_missing", context.dimension, "Current checksum-bound evidence is required.")];
  }
  for (const field of ["evidenceId", "tenantId", "dimension", "evidenceRef", "observedAt", "validUntil", "mode", "evidenceChecksumSha256"]) {
    if (typeof evidence[field] !== "string" || !evidence[field].trim()) findings.push(finding(context.dimension, "evidence_field_missing", field, `${field} is required.`));
  }
  if (evidence.tenantId !== context.tenantId) findings.push(finding(context.dimension, "evidence_tenant_mismatch", evidence.evidenceId ?? context.dimension, "Evidence belongs to another tenant."));
  if (evidence.dimension !== context.dimension) findings.push(finding(context.dimension, "evidence_dimension_mismatch", evidence.evidenceId ?? context.dimension, "Evidence was issued for another activation dimension."));
  if (!TENANT_ACTIVATION_EVIDENCE_MODES.includes(evidence.mode)) findings.push(finding(context.dimension, "evidence_mode_invalid", evidence.evidenceId ?? context.dimension, "Evidence mode must be simulated or live."));
  if (typeof evidence.commerciallyLive !== "boolean") findings.push(finding(context.dimension, "commercial_live_flag_missing", evidence.evidenceId ?? context.dimension, "commerciallyLive must be explicit."));
  if (!evidence.payload || typeof evidence.payload !== "object" || Array.isArray(evidence.payload)) findings.push(finding(context.dimension, "evidence_payload_invalid", evidence.evidenceId ?? context.dimension, "A structured evidence payload is required."));
  const observedAt = Date.parse(evidence.observedAt);
  const validUntil = Date.parse(evidence.validUntil);
  if (!Number.isFinite(observedAt) || observedAt > context.asOf.getTime() + 60_000) findings.push(finding(context.dimension, "evidence_time_invalid", evidence.evidenceId ?? context.dimension, "Evidence observation time is invalid or future-dated."));
  else if (context.asOf.getTime() - observedAt > context.maxEvidenceAgeDays * 86_400_000) findings.push(finding(context.dimension, "evidence_stale", evidence.evidenceId ?? context.dimension, "Evidence exceeds the configured maximum age."));
  if (!Number.isFinite(validUntil)) findings.push(finding(context.dimension, "evidence_time_invalid", evidence.evidenceId ?? context.dimension, "Evidence validity end is invalid."));
  else if (validUntil <= context.asOf.getTime()) findings.push(finding(context.dimension, "evidence_expired", evidence.evidenceId ?? context.dimension, "Evidence is expired."));
  if (evidence.evidenceChecksumSha256 !== checksumTenantActivationEvidence(evidence)) findings.push(finding(context.dimension, "evidence_checksum_mismatch", evidence.evidenceId ?? context.dimension, "Evidence envelope checksum does not match its content."));
  return dedupeFindings(findings);
}

function validateDimension(dimension, payload, requirements, tenantId, asOf) {
  const findings = [];
  if (dimension === "organisation_admission") {
    exact(payload.decision, "approved", findings, dimension, "admission_not_approved", "organisation", "Organisation admission must be approved.");
    truth(payload.requiredChecksComplete, findings, dimension, "admission_checks_incomplete", "organisation", "Every required organisation-admission check must be complete.");
  } else if (dimension === "iam_staffing") {
    truth(payload.launchRoleCoverageComplete, findings, dimension, "launch_role_coverage_incomplete", "iam", "Minimum launch-role coverage is incomplete.");
    truth(payload.featureStaffingComplete, findings, dimension, "feature_staffing_incomplete", "iam", "Selected features are not fully staffed.");
    empty(payload.segregationViolations, findings, dimension, "segregation_violation", "iam", "Segregation-of-duties violations remain open.");
    empty(payload.orphanedRequiredRoles, findings, dimension, "required_role_orphaned", "iam", "A required role has no active assignee.");
    if (!Number.isInteger(payload.activeHumanPrincipalCount) || payload.activeHumanPrincipalCount < 2) findings.push(finding(dimension, "insufficient_human_principals", "iam", "At least two active human principals are required."));
  } else if (dimension === "products") {
    validateRequiredItems(payload.products, requirements.selectedProductIds, "productId", ["ready", "active"], dimension, "product", tenantId, asOf, findings);
  } else if (dimension === "integrations") {
    validateRequiredItems(payload.campaigns, requirements.requiredIntegrationIds, "integrationId", ["passed", "certified", "active"], dimension, "integration", tenantId, asOf, findings);
  } else if (dimension === "deployment") {
    validateRequiredItems(payload.components, requirements.requiredDeploymentComponentIds, "componentId", ["ready", "healthy"], dimension, "deployment_component", tenantId, asOf, findings);
    truth(payload.rollbackVerified, findings, dimension, "rollback_unverified", "deployment", "Deployment rollback must be verified.");
  } else if (dimension === "security_controls") {
    validateRequiredItems(payload.controls, requirements.requiredSecurityControlIds, "controlId", ["effective"], dimension, "security_control", tenantId, asOf, findings);
    truth(payload.failClosedVerified, findings, dimension, "fail_closed_unverified", "security", "Fail-closed behaviour must be verified.");
  } else if (dimension === "uat") {
    exact(payload.status, "passed", findings, dimension, "uat_not_passed", "uat", "Tenant UAT must pass.");
    truth(payload.adverseCasesComplete, findings, dimension, "uat_adverse_cases_incomplete", "uat", "Required adverse UAT cases must be complete.");
    truth(payload.tenantSignoffComplete, findings, dimension, "uat_signoff_missing", "uat", "Tenant UAT sign-off is required.");
  } else if (dimension === "drills") {
    validateRequiredItems(payload.drills, requirements.requiredDrillScenarioIds, "scenarioId", ["passed"], dimension, "drill", tenantId, asOf, findings);
    truth(payload.independentWitnessComplete, findings, dimension, "drill_witness_missing", "drills", "Independent drill witness evidence is required.");
  }
  return dedupeFindings(findings);
}

function validateLiveEvidence(dimension, evidence, requirements, tenantId, asOf) {
  const findings = [];
  if (evidence.mode !== "live") findings.push(finding(dimension, "simulator_evidence_only", evidence.evidenceId, "Simulator evidence cannot establish production readiness."));
  if (evidence.commerciallyLive !== true) findings.push(finding(dimension, "commercial_activation_missing", evidence.evidenceId, "Commercial/live activation is not evidenced."));
  const itemConfiguration = {
    products: [evidence.payload.products, requirements.selectedProductIds, "productId"],
    integrations: [evidence.payload.campaigns, requirements.requiredIntegrationIds, "integrationId"],
    deployment: [evidence.payload.components, requirements.requiredDeploymentComponentIds, "componentId"],
    security_controls: [evidence.payload.controls, requirements.requiredSecurityControlIds, "controlId"],
    drills: [evidence.payload.drills, requirements.requiredDrillScenarioIds, "scenarioId"]
  }[dimension];
  if (itemConfiguration) {
    const [items, requiredIds, idField] = itemConfiguration;
    for (const id of requiredIds) {
      const item = Array.isArray(items) ? items.find((candidate) => candidate?.[idField] === id) : null;
      if (!item) continue;
      if (item.mode !== "live" || item.commerciallyLive !== true) findings.push(finding(dimension, "item_not_live", id, `${id} is supported only by simulated or non-commercial evidence.`));
      if (item.tenantId !== tenantId) findings.push(finding(dimension, "item_tenant_mismatch", id, `${id} belongs to another tenant.`));
      if (item.validUntil && Date.parse(item.validUntil) <= asOf.getTime()) findings.push(finding(dimension, "item_expired", id, `${id} production evidence is expired.`));
    }
  }
  return dedupeFindings(findings);
}

function validateRequiredItems(items, requiredIds, idField, acceptedStatuses, dimension, subject, tenantId, asOf, findings) {
  if (!Array.isArray(items)) {
    findings.push(finding(dimension, `${subject}_evidence_invalid`, subject, `${subject} evidence must be an array.`));
    return;
  }
  const duplicates = new Set();
  const seen = new Set();
  for (const item of items) {
    const id = item?.[idField];
    if (typeof id !== "string" || !id.trim()) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  for (const id of duplicates) findings.push(finding(dimension, `${subject}_duplicate`, id, `Duplicate ${subject} evidence is not allowed.`));
  for (const id of requiredIds) {
    const item = items.find((candidate) => candidate?.[idField] === id);
    if (!item) {
      findings.push(finding(dimension, `${subject}_missing`, id, `Required ${subject} evidence is missing.`));
      continue;
    }
    if (item.tenantId !== tenantId) findings.push(finding(dimension, `${subject}_tenant_mismatch`, id, `Required ${subject} evidence belongs to another tenant.`));
    if (!acceptedStatuses.includes(item.status)) findings.push(finding(dimension, `${subject}_not_ready`, id, `Required ${subject} is not ready.`));
    if (item.validUntil && (!Number.isFinite(Date.parse(item.validUntil)) || Date.parse(item.validUntil) <= asOf.getTime())) findings.push(finding(dimension, "item_expired", id, `Required ${subject} evidence is expired.`));
    if (!TENANT_ACTIVATION_EVIDENCE_MODES.includes(item.mode) || typeof item.commerciallyLive !== "boolean") findings.push(finding(dimension, `${subject}_mode_missing`, id, `Required ${subject} must explicitly identify live or simulated operation.`));
  }
}

function finding(dimension, code, subjectId, message) {
  return Object.freeze({ findingId: `${dimension}:${code}:${subjectId}`, dimension, code, subjectId, message });
}
function exact(actual, expected, findings, dimension, code, subject, message) { if (actual !== expected) findings.push(finding(dimension, code, subject, message)); }
function truth(actual, findings, dimension, code, subject, message) { if (actual !== true) findings.push(finding(dimension, code, subject, message)); }
function empty(actual, findings, dimension, code, subject, message) { if (!Array.isArray(actual) || actual.length) findings.push(finding(dimension, code, subject, message)); }
function dedupeFindings(items) { return [...new Map(items.map((item) => [item.findingId, item])).values()]; }
function sortFindings(items) { return dedupeFindings(items).sort((a, b) => a.findingId.localeCompare(b.findingId)); }
function identifiers(value, field, requireOne) {
  if (!Array.isArray(value) || (requireOne && value.length === 0)) fail("tenant_activation_input_invalid", `${field} must be ${requireOne ? "a non-empty" : "an"} array.`);
  const result = [...new Set(value.map((item) => required(item, field)))].sort();
  if (result.length !== value.length) fail("tenant_activation_input_invalid", `${field} cannot contain duplicates.`);
  return Object.freeze(result);
}
function without(value, field) { const result = { ...value }; delete result[field]; return result; }
function sha256(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("tenant_activation_input_invalid", `${field} is required.`); return value.trim(); }
function boundedInteger(value, min, max, field) { if (!Number.isInteger(value) || value < min || value > max) fail("tenant_activation_input_invalid", `${field} is outside its allowed range.`); return value; }
function validDate(value, field) { const date = value instanceof Date ? new Date(value) : new Date(value); if (!Number.isFinite(date.getTime())) fail("tenant_activation_input_invalid", `${field} is invalid.`); return date; }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
