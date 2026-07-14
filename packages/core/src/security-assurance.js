const SCAN_TYPES = new Set(["sast", "dast", "dependency", "container", "iac", "secret"]);
const SCAN_STATUSES = new Set(["passed", "failed", "error"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const SBOM_FORMATS = new Set(["cyclonedx", "spdx"]);
const VULNERABILITY_STATUSES = new Set(["open", "triaged", "in_remediation", "remediated", "verified", "closed"]);
const VULNERABILITY_SLA_DAYS = Object.freeze({ critical: 1, high: 7, medium: 30, low: 90 });

export function createSecurityScanBundle(input, existing = [], now = new Date()) {
  requireText(input.bundleId, "bundleId");
  if (existing.some((item) => item.bundleId === input.bundleId)) throw securityError("scan_bundle_duplicate", "bundleId already exists.");
  requireDigest(input.artifactSha256, "artifactSha256");
  requireText(input.sourceRevision, "sourceRevision");
  requireText(input.pipelineRunRef, "pipelineRunRef");
  requireText(input.recordedBy, "recordedBy");
  if (!Array.isArray(input.scans)) throw securityError("scan_bundle_invalid", "scans must be an array.");
  const ids = new Set();
  const types = new Set();
  const scans = input.scans.map((scan) => {
    requireText(scan.scanId, "scans.scanId");
    if (ids.has(scan.scanId)) throw securityError("scan_bundle_invalid", "scanId values must be unique.");
    ids.add(scan.scanId);
    if (!SCAN_TYPES.has(scan.type) || types.has(scan.type)) throw securityError("scan_bundle_invalid", "Every required scan type must appear exactly once.");
    types.add(scan.type);
    if (!SCAN_STATUSES.has(scan.status)) throw securityError("scan_bundle_invalid", "scan status is invalid.");
    requireText(scan.tool, "scans.tool");
    requireText(scan.toolVersion, "scans.toolVersion");
    requireText(scan.rulesetRef, "scans.rulesetRef");
    requireText(scan.evidenceRef, "scans.evidenceRef");
    requireIsoDate(scan.startedAt, "scans.startedAt");
    requireIsoDate(scan.completedAt, "scans.completedAt");
    if (Date.parse(scan.startedAt) > Date.parse(scan.completedAt) || Date.parse(scan.completedAt) > now.getTime()) throw securityError("scan_bundle_invalid", "Scan timing is invalid or in the future.");
    const findings = normalizeSeverityCounts(scan.findings);
    return { scanId: String(scan.scanId), type: scan.type, status: scan.status, tool: String(scan.tool), toolVersion: String(scan.toolVersion), rulesetRef: String(scan.rulesetRef), evidenceRef: String(scan.evidenceRef), startedAt: new Date(scan.startedAt).toISOString(), completedAt: new Date(scan.completedAt).toISOString(), findings };
  });
  const missing = [...SCAN_TYPES].filter((type) => !types.has(type));
  if (missing.length > 0) throw securityError("scan_bundle_incomplete", `Missing required scan types: ${missing.join(", ")}.`);
  return { bundleId: String(input.bundleId), artifactSha256: input.artifactSha256.toLowerCase(), sourceRevision: String(input.sourceRevision), pipelineRunRef: String(input.pipelineRunRef), recordedBy: String(input.recordedBy), scans, status: scans.every((scan) => scan.status === "passed") ? "passed" : "failed", recordedAt: now.toISOString() };
}

export function registerSbom(input, existing = [], now = new Date()) {
  requireText(input.sbomId, "sbomId");
  if (existing.some((item) => item.sbomId === input.sbomId)) throw securityError("sbom_duplicate", "sbomId already exists.");
  requireDigest(input.artifactSha256, "artifactSha256");
  requireDigest(input.documentSha256, "documentSha256");
  if (!SBOM_FORMATS.has(input.format)) throw securityError("sbom_invalid", "format is invalid.");
  requireText(input.formatVersion, "formatVersion");
  requireText(input.generator, "generator");
  requireText(input.evidenceRef, "evidenceRef");
  requireText(input.signatureRef, "signatureRef");
  requireText(input.recordedBy, "recordedBy");
  requireIsoDate(input.generatedAt, "generatedAt");
  if (Date.parse(input.generatedAt) > now.getTime()) throw securityError("sbom_invalid", "generatedAt cannot be in the future.");
  return { sbomId: String(input.sbomId), artifactSha256: input.artifactSha256.toLowerCase(), documentSha256: input.documentSha256.toLowerCase(), format: input.format, formatVersion: String(input.formatVersion), componentCount: positiveInteger(input.componentCount, "componentCount"), generator: String(input.generator), evidenceRef: String(input.evidenceRef), signatureRef: String(input.signatureRef), recordedBy: String(input.recordedBy), generatedAt: new Date(input.generatedAt).toISOString(), recordedAt: now.toISOString() };
}

export function createVulnerability(input, scanBundles = [], existing = [], now = new Date()) {
  requireText(input.vulnerabilityId, "vulnerabilityId");
  if (existing.some((item) => item.vulnerabilityId === input.vulnerabilityId)) throw securityError("vulnerability_duplicate", "vulnerabilityId already exists.");
  requireText(input.externalId, "externalId");
  requireText(input.title, "title", 6);
  if (!SEVERITIES.has(input.severity)) throw securityError("vulnerability_invalid", "severity is invalid.");
  requireText(input.component, "component");
  requireText(input.affectedVersion, "affectedVersion");
  requireText(input.scanId, "scanId");
  requireDigest(input.artifactSha256, "artifactSha256");
  requireText(input.discoveredBy, "discoveredBy");
  const sourceBundle = scanBundles.find((bundle) => bundle.artifactSha256 === input.artifactSha256.toLowerCase() && bundle.scans.some((scan) => scan.scanId === input.scanId));
  if (!sourceBundle) throw securityError("vulnerability_scan_unknown", "Vulnerability must reference a scan bound to the same artifact.");
  const detectedAt = optionalIsoDate(input.detectedAt, now, "detectedAt");
  return { vulnerabilityId: String(input.vulnerabilityId), externalId: String(input.externalId), title: String(input.title), description: optionalText(input.description), severity: input.severity, cvss: normalizeCvss(input.cvss), component: String(input.component), affectedVersion: String(input.affectedVersion), fixedVersion: optionalText(input.fixedVersion), scanId: String(input.scanId), bundleId: sourceBundle.bundleId, artifactSha256: input.artifactSha256.toLowerCase(), sourceRevision: sourceBundle.sourceRevision, discoveredBy: String(input.discoveredBy), status: "open", detectedAt, dueAt: addDays(new Date(detectedAt), VULNERABILITY_SLA_DAYS[input.severity]), updatedAt: now.toISOString() };
}

export function transitionVulnerability(vulnerability, input, now = new Date()) {
  requireText(input.updatedBy, "updatedBy");
  if (!VULNERABILITY_STATUSES.has(input.status)) throw securityError("vulnerability_transition_invalid", "status is invalid.");
  const allowed = { open: ["triaged"], triaged: ["in_remediation"], in_remediation: ["remediated"], remediated: ["verified", "in_remediation"], verified: ["closed", "in_remediation"] };
  if (!(allowed[vulnerability.status] ?? []).includes(input.status)) throw securityError("vulnerability_transition_invalid", `Cannot transition vulnerability from ${vulnerability.status} to ${input.status}.`);
  const next = { ...vulnerability, status: input.status, updatedAt: now.toISOString() };
  if (input.status === "triaged") {
    requireText(input.owner, "owner");
    requireText(input.triageEvidenceRef, "triageEvidenceRef");
    next.owner = String(input.owner);
    next.triageEvidenceRef = String(input.triageEvidenceRef);
    next.triagedAt = now.toISOString();
  }
  if (input.status === "in_remediation") {
    requireText(input.remediationPlan, "remediationPlan", 12);
    requireText(input.changeTicket, "changeTicket");
    next.remediationPlan = String(input.remediationPlan);
    next.changeTicket = String(input.changeTicket);
  }
  if (input.status === "remediated") {
    requireText(input.fixedVersion, "fixedVersion");
    requireText(input.remediationEvidenceRef, "remediationEvidenceRef");
    next.fixedVersion = String(input.fixedVersion);
    next.remediationEvidenceRef = String(input.remediationEvidenceRef);
    next.remediatedBy = String(input.updatedBy);
    next.remediatedAt = now.toISOString();
  }
  if (input.status === "verified") {
    requireText(input.retestScanId, "retestScanId");
    requireText(input.verificationEvidenceRef, "verificationEvidenceRef");
    if (input.updatedBy === vulnerability.remediatedBy) throw securityError("vulnerability_four_eyes_required", "Verification must be independent of remediation.");
    next.retestScanId = String(input.retestScanId);
    next.verificationEvidenceRef = String(input.verificationEvidenceRef);
    next.verifiedBy = String(input.updatedBy);
    next.verifiedAt = now.toISOString();
  }
  if (input.status === "closed") {
    requireText(input.closureApprovalRef, "closureApprovalRef");
    if (input.updatedBy === vulnerability.verifiedBy) throw securityError("vulnerability_four_eyes_required", "Closure must be independent of verification.");
    next.closureApprovalRef = String(input.closureApprovalRef);
    next.closedBy = String(input.updatedBy);
    next.closedAt = now.toISOString();
  }
  return next;
}

export function approveVulnerabilityException(vulnerability, input, existing = [], now = new Date()) {
  requireText(input.exceptionId, "exceptionId");
  if (existing.some((item) => item.exceptionId === input.exceptionId)) throw securityError("vulnerability_exception_duplicate", "exceptionId already exists.");
  if (["verified", "closed"].includes(vulnerability.status)) throw securityError("vulnerability_exception_invalid", "A verified or closed vulnerability cannot receive an exception.");
  if (vulnerability.severity === "critical") throw securityError("critical_exception_forbidden", "Critical vulnerabilities cannot be risk-accepted for release.");
  requireText(input.rationale, "rationale", 12);
  const controls = stringList(input.compensatingControls, "compensatingControls", true);
  requireText(input.proposedBy, "proposedBy");
  requireText(input.approvedBy, "approvedBy");
  requireText(input.approvalRef, "approvalRef");
  if (input.proposedBy === input.approvedBy) throw securityError("vulnerability_four_eyes_required", "Risk exception requires an independent approver.");
  requireIsoDate(input.expiresAt, "expiresAt");
  const expiry = Date.parse(input.expiresAt);
  if (expiry <= now.getTime() || expiry > addDaysDate(now, 90).getTime()) throw securityError("vulnerability_exception_invalid", "Risk exception expiry must be within 90 days.");
  return { exceptionId: String(input.exceptionId), vulnerabilityId: vulnerability.vulnerabilityId, artifactSha256: vulnerability.artifactSha256, severity: vulnerability.severity, rationale: String(input.rationale), compensatingControls: controls, proposedBy: String(input.proposedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), status: "approved", approvedAt: now.toISOString(), expiresAt: new Date(input.expiresAt).toISOString() };
}

export function enrichVulnerability(vulnerability, exceptions = [], asOf = new Date()) {
  const activeException = exceptions.find((item) => item.vulnerabilityId === vulnerability.vulnerabilityId && item.status === "approved" && Date.parse(item.expiresAt) > asOf.getTime()) ?? null;
  const terminal = ["verified", "closed"].includes(vulnerability.status);
  return { ...vulnerability, overdue: !terminal && asOf.getTime() > Date.parse(vulnerability.dueAt), activeException };
}

export function evaluateReleaseSecurityGate(release, projection, asOf = new Date()) {
  if (!release) throw securityError("release_security_invalid", "Release is required.");
  const digest = String(release.artifactSha256 ?? "").toLowerCase();
  const bundle = [...projection.scanBundles].reverse().find((item) => item.artifactSha256 === digest && item.sourceRevision === release.sourceRevision) ?? null;
  const sbom = [...projection.sboms].reverse().find((item) => item.artifactSha256 === digest) ?? null;
  const vulnerabilities = projection.vulnerabilities.filter((item) => item.artifactSha256 === digest).map((item) => enrichVulnerability(item, projection.exceptions, asOf));
  const blockers = [];
  if (!bundle) blockers.push("scan_bundle_missing");
  else if (bundle.status !== "passed") blockers.push("scan_bundle_failed");
  if (!sbom) blockers.push("sbom_missing");
  if (bundle) {
    const reportedCritical = bundle.scans.reduce((sum, scan) => sum + scan.findings.critical, 0);
    const reportedHigh = bundle.scans.reduce((sum, scan) => sum + scan.findings.high, 0);
    if (vulnerabilities.filter((item) => item.severity === "critical").length < reportedCritical) blockers.push("untracked_critical_findings");
    if (vulnerabilities.filter((item) => item.severity === "high").length < reportedHigh) blockers.push("untracked_high_findings");
  }
  for (const item of vulnerabilities) {
    if (["verified", "closed"].includes(item.status)) continue;
    if (item.severity === "critical") blockers.push(`critical_vulnerability:${item.vulnerabilityId}`);
    else if (item.severity === "high" && !item.activeException) blockers.push(`high_vulnerability:${item.vulnerabilityId}`);
    else if (item.overdue && !item.activeException) blockers.push(`overdue_vulnerability:${item.vulnerabilityId}`);
  }
  return { releaseId: release.releaseId, artifactSha256: digest, sourceRevision: release.sourceRevision, status: blockers.length === 0 ? "passed" : "blocked", blockers, scanBundleId: bundle?.bundleId ?? null, sbomId: sbom?.sbomId ?? null, evaluatedAt: asOf.toISOString() };
}

export function projectSecurityAssurance(events = [], asOf = new Date()) {
  const scanBundles = [];
  const sboms = [];
  const vulnerabilities = new Map();
  const exceptions = [];
  for (const event of events) {
    if (event.type === "platform.security.scan_bundle_recorded" && event.bundle) scanBundles.push(event.bundle);
    if (event.type === "platform.security.sbom_recorded" && event.sbom) sboms.push(event.sbom);
    if (event.type?.startsWith("platform.security.vulnerability_") && event.vulnerability?.vulnerabilityId) vulnerabilities.set(event.vulnerability.vulnerabilityId, event.vulnerability);
    if (event.type === "platform.security.exception_approved" && event.exception) exceptions.push(event.exception);
  }
  return { scanBundles, sboms, vulnerabilities: [...vulnerabilities.values()].map((item) => enrichVulnerability(item, exceptions, asOf)), exceptions };
}

function normalizeSeverityCounts(value = {}) { return { critical: nonNegativeInteger(value.critical ?? 0, "findings.critical"), high: nonNegativeInteger(value.high ?? 0, "findings.high"), medium: nonNegativeInteger(value.medium ?? 0, "findings.medium"), low: nonNegativeInteger(value.low ?? 0, "findings.low") }; }
function normalizeCvss(value) { if (value == null || value === "") return null; const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > 10) throw securityError("vulnerability_invalid", "cvss must be between 0 and 10."); return number.toFixed(1); }
function requireDigest(value, field) { if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) throw securityError("security_digest_invalid", `${field} must be a SHA-256 hex digest.`); }
function requireText(value, field, minimum = 1) { if (typeof value !== "string" || value.trim().length < minimum) throw securityError("security_assurance_invalid", `${field} is required.`); }
function optionalText(value) { return value == null || String(value).trim() === "" ? null : String(value); }
function stringList(value, field, required = false) { if (value == null && !required) return []; if (!Array.isArray(value)) throw securityError("security_assurance_invalid", `${field} must be an array.`); const items = [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]; if (required && items.length === 0) throw securityError("security_assurance_invalid", `${field} requires at least one value.`); return items; }
function positiveInteger(value, field) { if (!Number.isInteger(value) || value <= 0) throw securityError("security_assurance_invalid", `${field} must be a positive integer.`); return value; }
function nonNegativeInteger(value, field) { if (!Number.isInteger(value) || value < 0) throw securityError("security_assurance_invalid", `${field} must be a non-negative integer.`); return value; }
function requireIsoDate(value, field) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw securityError("security_assurance_invalid", `${field} must be an ISO date-time.`); }
function optionalIsoDate(value, fallback, field) { if (value == null) return fallback.toISOString(); requireIsoDate(value, field); if (Date.parse(value) > fallback.getTime()) throw securityError("security_assurance_invalid", `${field} cannot be in the future.`); return new Date(value).toISOString(); }
function addDays(now, days) { return addDaysDate(now, days).toISOString(); }
function addDaysDate(now, days) { return new Date(now.getTime() + days * 86_400_000); }
function securityError(code, message) { return Object.assign(new Error(message), { code }); }

export { SBOM_FORMATS, SCAN_STATUSES, SCAN_TYPES, SEVERITIES, VULNERABILITY_SLA_DAYS, VULNERABILITY_STATUSES };
