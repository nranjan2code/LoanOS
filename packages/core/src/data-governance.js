import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { verifyAuditChain } from "./audit.js";

const sha256 = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const validHash = (value) => /^[a-f0-9]{64}$/i.test(value ?? "");
const validDate = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const independent = (input) => Boolean(input.proposedBy && input.approvedBy && input.proposedBy !== input.approvedBy && input.approvalRef);

export const BUSINESS_EVENT_EXPECTATIONS = Object.freeze([
  { collection: "loanApplications", idField: "applicationId", eventType: "loan.application.created", eventIdField: "applicationId" },
  { collection: "loanAccounts", idField: "loanAccountId", eventType: "loan.disbursement.recorded", eventIdField: "loanAccountId" },
  { collection: "cicSubmissionBatches", idField: "batchId", eventType: "cic.batch.created", eventIdField: "batchId" },
  { collection: "ckycrrSubmissions", idField: "submissionId", eventType: "ckycrr.submission.created", eventIdField: "submissionId" },
  { collection: "providerCertifications", idField: "integration", eventType: "integration.provider_certified", eventIdField: "integration" }
]);

export function createAuditAnchor(events = [], tenantId, registry = {}, input = {}, now = new Date()) {
  const findings = [];
  const integrity = verifyAuditChain(events, tenantId);
  if (!integrity.valid) findings.push(createFinding("error", "RBI-IT-GRC", "A broken audit chain cannot be anchored.", "events"));
  if (!input.anchorId || registry[input.anchorId]) findings.push(createFinding("error", "RBI-IT-GRC", "A unique anchorId is required.", "anchorId"));
  if (!input.providerName || !input.providerRef || !input.externalTimestampRef || !input.evidenceChecksumSha256) findings.push(createFinding("error", "RBI-IT-GRC", "External provider, timestamp and evidence references are required.", "anchorEvidence"));
  if (!validHash(input.evidenceChecksumSha256)) findings.push(createFinding("error", "RBI-IT-GRC", "Anchor evidence requires a SHA-256 checksum.", "evidenceChecksumSha256"));
  if (input.storageCountry !== "IN" || input.immutable !== true || input.storageClass !== "worm") findings.push(createFinding("error", "CERT-IN-2022", "Anchor custody must be immutable WORM storage in India.", "storage"));
  const anchoredAt = validDate(input.anchoredAt);
  const retentionUntil = validDate(input.retentionUntil);
  if (!anchoredAt || anchoredAt > now || !retentionUntil || retentionUntil <= anchoredAt || retentionUntil <= now) findings.push(createFinding("error", "RBI-IT-GRC", "Anchor needs a non-future timestamp and future retention.", "retentionUntil"));
  if (!independent(input)) findings.push(createFinding("error", "RBI-IT-GRC", "Audit anchoring requires independent approval.", "approval"));
  if (integrity.valid && input.headHash !== integrity.headHash) findings.push(createFinding("error", "RBI-IT-GRC", "External anchor must match the current verified chain head.", "headHash"));
  if (integrity.valid && Number(input.eventCount) !== integrity.count) findings.push(createFinding("error", "RBI-IT-GRC", "External anchor event count must match the verified chain.", "eventCount"));
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { registry, anchor: null, integrity, findings, summary };
  const previous = Object.values(registry).sort((a, b) => a.anchoredAt.localeCompare(b.anchoredAt)).at(-1) ?? null;
  const anchor = { anchorId: input.anchorId, tenantId, headHash: integrity.headHash, eventCount: integrity.count, providerName: input.providerName, providerRef: input.providerRef, externalTimestampRef: input.externalTimestampRef, evidenceChecksumSha256: input.evidenceChecksumSha256.toLowerCase(), storageCountry: "IN", storageClass: "worm", immutable: true, anchoredAt: anchoredAt.toISOString(), retentionUntil: retentionUntil.toISOString(), previousAnchorId: previous?.anchorId ?? null, previousAnchorHeadHash: previous?.headHash ?? null, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, recordedAt: now.toISOString() };
  return { registry: { ...registry, [anchor.anchorId]: anchor }, anchor, integrity, findings, summary };
}

export function reconcileBusinessEventCompleteness(state = {}, input = {}, now = new Date()) {
  const findings = [];
  if (!input.reconciliationId || !independent(input)) findings.push(createFinding("error", "RBI-IT-GRC", "Completeness reconciliation requires id and independent approval.", "approval"));
  const integrity = verifyAuditChain(state.events ?? [], input.tenantId);
  if (!integrity.valid) findings.push(createFinding("error", "RBI-IT-GRC", "Completeness cannot be certified over a broken audit chain.", "events"));
  const checks = BUSINESS_EVENT_EXPECTATIONS.map((expectation) => {
    const resources = Object.values(state[expectation.collection] ?? {});
    const missing = resources.filter((resource) => !(state.events ?? []).some((event) => event.type === expectation.eventType && event[expectation.eventIdField] === resource[expectation.idField])).map((resource) => resource[expectation.idField]);
    return { ...expectation, resourceCount: resources.length, matchedCount: resources.length - missing.length, missingIds: missing, status: missing.length ? "failed" : "passed" };
  });
  for (const check of checks.filter((item) => item.status === "failed")) findings.push(createFinding("error", "RBI-IT-GRC", `${check.collection} has ${check.missingIds.length} business record(s) without the required audit event.`, check.collection));
  const summary = summarizeFindings(findings);
  const reconciliation = { reconciliationId: input.reconciliationId, tenantId: input.tenantId, status: summary.status === "blocked" ? "failed" : "certified", chainHeadHash: integrity.headHash ?? null, eventCount: integrity.count ?? state.events?.length ?? 0, checks, exceptionCount: checks.reduce((sum, item) => sum + item.missingIds.length, 0), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, reconciledAt: now.toISOString(), evidenceChecksumSha256: sha256({ headHash: integrity.headHash, checks }) };
  return { reconciliation, integrity, findings, summary };
}

export function createEvidenceCustodyRecord(registry = {}, input = {}, now = new Date()) {
  const findings = [];
  if (!input.evidenceId || registry[input.evidenceId] || !input.sourceType || !input.sourceId || !input.custodian || !input.storageRef) findings.push(createFinding("error", "RBI-IT-GRC", "Unique evidence identity, source, custodian and storage reference are required.", "evidence"));
  if (!validHash(input.contentChecksumSha256)) findings.push(createFinding("error", "RBI-IT-GRC", "Evidence content requires a SHA-256 checksum.", "contentChecksumSha256"));
  if (input.storageCountry !== "IN" || input.immutable !== true) findings.push(createFinding("error", "RBI-DATA-RESIDENCY", "Evidence custody must be immutable and India-resident.", "storage"));
  const collectedAt = validDate(input.collectedAt);
  const retentionUntil = validDate(input.retentionUntil);
  if (!collectedAt || collectedAt > now || !retentionUntil || retentionUntil <= collectedAt || retentionUntil <= now) findings.push(createFinding("error", "RBI-IT-GRC", "Evidence needs a non-future collection timestamp and future retention.", "retentionUntil"));
  if (!independent(input)) findings.push(createFinding("error", "RBI-IT-GRC", "Evidence admission requires independent approval.", "approval"));
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { registry, evidence: null, findings, summary };
  const previous = Object.values(registry).sort((a, b) => a.admittedAt.localeCompare(b.admittedAt)).at(-1) ?? null;
  const base = { evidenceId: input.evidenceId, sourceType: input.sourceType, sourceId: input.sourceId, contentChecksumSha256: input.contentChecksumSha256.toLowerCase(), mediaType: input.mediaType ?? "application/octet-stream", storageCountry: "IN", storageRef: input.storageRef, immutable: true, custodian: input.custodian, collectedAt: collectedAt.toISOString(), retentionUntil: retentionUntil.toISOString(), legalHolds: [], status: "retained", proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, previousEvidenceHash: previous?.custodyHash ?? null, admittedAt: now.toISOString(), deletionProof: null };
  const evidence = { ...base, custodyHash: sha256(base) };
  return { registry: { ...registry, [evidence.evidenceId]: evidence }, evidence, findings, summary };
}

export function placeEvidenceLegalHold(registry = {}, evidenceId, input = {}, now = new Date()) {
  const evidence = registry[evidenceId]; const findings = [];
  if (!evidence || evidence.status !== "retained") findings.push(createFinding("error", "RBI-IT-GRC", "Retained evidence is required.", "evidenceId"));
  if (!input.holdId || !input.reason || !input.authorityRef || !independent(input)) findings.push(createFinding("error", "RBI-IT-GRC", "Legal hold requires identity, reason, authority and independent approval.", "legalHold"));
  if (evidence?.legalHolds?.some((hold) => hold.holdId === input.holdId)) findings.push(createFinding("error", "RBI-IT-GRC", "holdId already exists.", "holdId"));
  const retainUntil = input.retainUntil ? validDate(input.retainUntil) : null;
  if (input.retainUntil && (!retainUntil || retainUntil <= now || retainUntil <= validDate(evidence?.retentionUntil))) findings.push(createFinding("error", "RBI-IT-GRC", "A legal-hold retention extension must be valid, future, and later than current retention.", "retainUntil"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { registry, evidence, findings, summary };
  const hold = { holdId: input.holdId, reason: input.reason, authorityRef: input.authorityRef, status: "active", placedAt: now.toISOString(), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  const updated = { ...evidence, legalHolds: [...evidence.legalHolds, hold], retentionUntil: retainUntil?.toISOString() ?? evidence.retentionUntil };
  return { registry: { ...registry, [evidenceId]: updated }, evidence: updated, hold, findings, summary };
}

export function releaseEvidenceLegalHold(registry = {}, evidenceId, holdId, input = {}, now = new Date()) {
  const evidence = registry[evidenceId]; const hold = evidence?.legalHolds?.find((item) => item.holdId === holdId); const findings = [];
  if (!evidence || evidence.status !== "retained" || !hold || hold.status !== "active") findings.push(createFinding("error", "RBI-IT-GRC", "An active legal hold on retained evidence is required.", "holdId"));
  if (!input.releaseReason || !input.authorityRef || !input.proposedBy || !input.approvedBy || input.proposedBy === input.approvedBy || !input.approvalRef) findings.push(createFinding("error", "RBI-IT-GRC", "Legal-hold release requires reason, authority and independent approval.", "release"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { registry, evidence, hold, findings, summary };
  const released = { ...hold, status: "released", releaseReason: input.releaseReason, releaseAuthorityRef: input.authorityRef, releasedAt: now.toISOString(), releaseProposedBy: input.proposedBy, releaseApprovedBy: input.approvedBy, releaseApprovalRef: input.approvalRef };
  const updated = { ...evidence, legalHolds: evidence.legalHolds.map((item) => item.holdId === holdId ? released : item) };
  return { registry: { ...registry, [evidenceId]: updated }, evidence: updated, hold: released, findings, summary };
}

export function deleteEvidenceWithProof(registry = {}, evidenceId, input = {}, now = new Date()) {
  const evidence = registry[evidenceId]; const findings = [];
  if (!evidence || evidence.status !== "retained") findings.push(createFinding("error", "RBI-IT-GRC", "Retained evidence is required.", "evidenceId"));
  if (evidence?.legalHolds?.some((hold) => hold.status === "active")) findings.push(createFinding("error", "RBI-IT-GRC", "Active legal hold blocks deletion.", "legalHolds"));
  if (evidence && new Date(evidence.retentionUntil) > now) findings.push(createFinding("error", "RBI-IT-GRC", "Retention period has not expired.", "retentionUntil"));
  if (!input.deletionRef || !input.storageDeletionEvidenceRef || !independent(input)) findings.push(createFinding("error", "DPDP-2023", "Deletion requires storage evidence and independent approval.", "deletion"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { registry, evidence, findings, summary };
  const proofBase = { deletionRef: input.deletionRef, evidenceId, priorCustodyHash: evidence.custodyHash, priorContentChecksumSha256: evidence.contentChecksumSha256, storageDeletionEvidenceRef: input.storageDeletionEvidenceRef, deletedAt: now.toISOString(), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  const updated = { ...evidence, status: "deleted", storageRef: null, deletionProof: { ...proofBase, proofChecksumSha256: sha256(proofBase) } };
  return { registry: { ...registry, [evidenceId]: updated }, evidence: updated, findings, summary };
}

export function registerDataLineage(registry = {}, input = {}, now = new Date()) {
  const findings = [];
  if (!input.lineageId || registry[input.lineageId] || !input.output?.system || !input.output?.entity || !input.output?.field) findings.push(createFinding("error", "RBI-IT-GRC", "Unique lineage id and output field are required.", "lineage"));
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.some((source) => !source.system || !source.entity || !source.field)) findings.push(createFinding("error", "RBI-IT-GRC", "At least one fully identified source field is required.", "sources"));
  if (!input.transform?.method || !input.transform?.version || !validHash(input.transform?.checksumSha256)) findings.push(createFinding("error", "RBI-IT-GRC", "Versioned checksum-bound transformation is required.", "transform"));
  if (!input.owner || !independent(input)) findings.push(createFinding("error", "RBI-IT-GRC", "Lineage requires owner and independent approval.", "approval"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { registry, lineage: null, findings, summary };
  const lineage = { lineageId: input.lineageId, sources: input.sources, transform: input.transform, output: input.output, purpose: input.purpose ?? null, regulatoryFields: input.regulatoryFields ?? [], owner: input.owner, status: "active", proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, registeredAt: now.toISOString(), lineageChecksumSha256: sha256({ sources: input.sources, transform: input.transform, output: input.output }) };
  return { registry: { ...registry, [lineage.lineageId]: lineage }, lineage, findings, summary };
}

export function createDataQualityRule(registry = {}, input = {}, now = new Date()) {
  const findings = [];
  if (!input.ruleId || registry[input.ruleId] || !input.collection || !input.field || !["required", "pattern", "enum", "unique", "reference"].includes(input.ruleType)) findings.push(createFinding("error", "RBI-IT-GRC", "Unique rule id, collection, field and supported rule type are required.", "rule"));
  if (input.ruleType === "pattern") { try { if (typeof input.parameter !== "string" || !input.parameter) throw new Error("missing"); new RegExp(input.parameter); } catch { findings.push(createFinding("error", "RBI-IT-GRC", "Pattern rule requires a valid non-empty expression.", "parameter")); } }
  if (input.ruleType === "enum" && (!Array.isArray(input.parameter) || !input.parameter.length)) findings.push(createFinding("error", "RBI-IT-GRC", "Enum rule requires allowed values.", "parameter"));
  if (input.ruleType === "reference" && (!input.parameter?.collection || !input.parameter?.field)) findings.push(createFinding("error", "RBI-IT-GRC", "Reference rule requires target collection and field.", "parameter"));
  if (!["critical", "high", "medium", "low"].includes(input.severity) || !input.owner || !independent(input)) findings.push(createFinding("error", "RBI-IT-GRC", "Rule severity, owner and independent approval are required.", "approval"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { registry, rule: null, findings, summary };
  const rule = { ruleId: input.ruleId, collection: input.collection, field: input.field, ruleType: input.ruleType, parameter: input.parameter ?? null, severity: input.severity, owner: input.owner, status: "active", proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, createdAt: now.toISOString() };
  return { registry: { ...registry, [rule.ruleId]: rule }, rule, findings, summary };
}

const fieldValue = (record, path) => String(path).split(".").reduce((value, key) => value?.[key], record);
export function assessDataQuality(state = {}, rules = {}, input = {}, now = new Date()) {
  const results = Object.values(rules).filter((rule) => rule.status === "active").map((rule) => {
    const collectionExists = Object.hasOwn(state, rule.collection); const records = Object.values(state[rule.collection] ?? {}); const values = records.map((record) => fieldValue(record, rule.field)); const failures = [];
    if (!collectionExists) failures.push({ recordIndex: null, valueHash: sha256(`unknown_collection:${rule.collection}`), reason: "unknown_collection" });
    for (let index = 0; index < records.length; index++) {
      const value = values[index]; let failed = false;
      if (rule.ruleType === "required") failed = value === null || value === undefined || value === "";
      if (rule.ruleType === "pattern") failed = value != null && !new RegExp(rule.parameter).test(String(value));
      if (rule.ruleType === "enum") failed = !rule.parameter.includes(value);
      if (rule.ruleType === "unique") failed = value != null && values.filter((candidate) => candidate === value).length > 1;
      if (rule.ruleType === "reference") { const targets = Object.values(state[rule.parameter.collection] ?? {}).map((record) => fieldValue(record, rule.parameter.field)); failed = value != null && !targets.includes(value); }
      if (failed) failures.push({ recordIndex: index, valueHash: sha256(String(value ?? "null")) });
    }
    return { ruleId: rule.ruleId, collection: rule.collection, field: rule.field, severity: rule.severity, recordCount: records.length, failureCount: failures.length, failures, status: failures.length ? "failed" : "passed" };
  });
  const assessment = { assessmentId: input.assessmentId, status: results.some((result) => result.status === "failed") ? "exceptions" : "passed", results, ruleCount: results.length, recordCount: results.reduce((sum, item) => sum + item.recordCount, 0), failureCount: results.reduce((sum, item) => sum + item.failureCount, 0), assessedBy: input.assessedBy, assessedAt: now.toISOString(), evidenceChecksumSha256: sha256(results) };
  const findings = [];
  if (!input.assessmentId || !input.assessedBy || results.length === 0) findings.push(createFinding("error", "RBI-IT-GRC", "Assessment id, actor, and at least one active rule are required.", "assessment"));
  return { assessment, findings, summary: summarizeFindings(findings) };
}

export function certifyDataQuality(assessment, input = {}, now = new Date()) {
  const findings = [];
  if (!assessment) findings.push(createFinding("error", "RBI-IT-GRC", "Data-quality assessment is required.", "assessmentId"));
  const criticalFailures = assessment?.results?.filter((result) => result.status === "failed" && ["critical", "high"].includes(result.severity)) ?? [];
  if (criticalFailures.length) findings.push(createFinding("error", "RBI-IT-GRC", "Critical or high data-quality failures block certification.", "results"));
  if (assessment?.failureCount > 0 && (!Array.isArray(input.exceptionRefs) || input.exceptionRefs.length === 0)) findings.push(createFinding("error", "RBI-IT-GRC", "Low-risk exception certification requires explicit exception references.", "exceptionRefs"));
  if (!input.certificationId || !input.certifiedBy || !input.approvedBy || input.certifiedBy === input.approvedBy || !input.approvalRef) findings.push(createFinding("error", "RBI-IT-GRC", "Certification requires identity and independent approval.", "approval"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { certification: null, findings, summary };
  const certification = { certificationId: input.certificationId, assessmentId: assessment.assessmentId, status: assessment.status === "passed" ? "certified" : "certified_with_low_risk_exceptions", assessmentEvidenceChecksumSha256: assessment.evidenceChecksumSha256, exceptionCount: assessment.failureCount, exceptionRefs: input.exceptionRefs ?? [], certifiedBy: input.certifiedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, certifiedAt: now.toISOString() };
  return { certification, findings, summary };
}
