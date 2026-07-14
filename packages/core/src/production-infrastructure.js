import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";

export const REQUIRED_PRODUCTION_COMPONENTS = Object.freeze(["idp", "scim", "kms_hsm", "siem_worm", "trusted_time", "postgres_ha_pitr", "queue", "deployment_controller"]);
const TYPES = new Set(REQUIRED_PRODUCTION_COMPONENTS);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const finding = (message, field) => createFinding("error", "RBI-IT-GRC", message, field);
const result = (findings, values = {}) => ({ ...values, findings, summary: summarizeFindings(findings) });
const validInstant = (value) => Boolean(value) && !Number.isNaN(new Date(value).getTime());
const independent = (input) => input?.attestedBy && input?.approvedBy && input.attestedBy !== input.approvedBy && input.approvalRef;

export function attestProductionComponent(existing = [], input, now = new Date()) {
  const findings = [];
  if (!input?.attestationId || !input?.idempotencyKey || !input?.componentId || !TYPES.has(input?.componentType)) findings.push(finding("Known production component identity and idempotency key are required.", "component"));
  if (!input?.providerRef || !input?.environmentRef || !input?.configurationEvidenceRef || !input?.controlTestEvidenceRef) findings.push(finding("Provider, environment, configuration, and control-test evidence are required.", "evidence"));
  if (!validInstant(input?.evidenceValidUntil) || new Date(input.evidenceValidUntil) <= now) findings.push(finding("Component evidence must have a future expiry.", "evidenceValidUntil"));
  if (!independent(input)) findings.push(finding("Independent attestation approval is required.", "approval"));
  if (input?.status !== "certified") findings.push(finding("Only successfully certified live components may be attested.", "status"));
  const immutable = { attestationId: input?.attestationId, idempotencyKey: input?.idempotencyKey, componentId: input?.componentId, componentType: input?.componentType, providerRef: input?.providerRef, environmentRef: input?.environmentRef, configurationEvidenceRef: input?.configurationEvidenceRef, controlTestEvidenceRef: input?.controlTestEvidenceRef, evidenceValidUntil: input?.evidenceValidUntil, status: input?.status, dependencies: [...new Set(input?.dependencies ?? [])].sort(), attestedBy: input?.attestedBy, approvedBy: input?.approvedBy, approvalRef: input?.approvalRef };
  const prior = existing.find((row) => row.idempotencyKey === input?.idempotencyKey || row.attestationId === input?.attestationId);
  if (prior) return prior.checksumSha256 === hash(immutable) ? result([], { attestation: prior, idempotent: true }) : result([finding("Attestation idempotency conflict.", "idempotencyKey")], { attestation: null, idempotent: false });
  if (findings.length) return result(findings, { attestation: null, idempotent: false });
  return result([], { attestation: { ...immutable, checksumSha256: hash(immutable), attestedAt: now.toISOString() }, idempotent: false });
}

export function evaluateProductionDependencyGraph(attestations = [], asOf = new Date()) {
  const current = new Map();
  for (const row of attestations) if (!current.has(row.componentId) || new Date(current.get(row.componentId).attestedAt) < new Date(row.attestedAt)) current.set(row.componentId, row);
  const rows = [...current.values()].map((row) => {
    const expired = !validInstant(row.evidenceValidUntil) || new Date(row.evidenceValidUntil) <= asOf;
    const missingDependencies = (row.dependencies ?? []).filter((id) => !current.has(id));
    const unavailableDependencies = (row.dependencies ?? []).filter((id) => { const dep = current.get(id); return dep && (dep.status !== "certified" || new Date(dep.evidenceValidUntil) <= asOf); });
    return { componentId: row.componentId, componentType: row.componentType, expired, missingDependencies, unavailableDependencies, ready: row.status === "certified" && !expired && !missingDependencies.length && !unavailableDependencies.length };
  });
  const presentTypes = new Set(rows.filter((row) => row.ready).map((row) => row.componentType));
  const missingRequiredTypes = REQUIRED_PRODUCTION_COMPONENTS.filter((type) => !presentTypes.has(type));
  return { asOf: asOf.toISOString(), rows, missingRequiredTypes, ready: rows.every((row) => row.ready) && missingRequiredTypes.length === 0 };
}

export function recordProductionResilienceDrill(existing = [], input, now = new Date()) {
  const findings = [];
  if (!input?.drillId || !input?.idempotencyKey || !["idp_failover", "kms_failover", "siem_recovery", "postgres_failover", "pitr_restore", "queue_recovery", "deployment_rollback"].includes(input?.drillType)) findings.push(finding("Recognized drill identity and type are required.", "drill"));
  if (!input?.componentId || !input?.executionEvidenceRef || !input?.witnessedBy || !input?.executedBy || input.witnessedBy === input.executedBy) findings.push(finding("Execution evidence and an independent witness are required.", "evidence"));
  if (!validInstant(input?.startedAt) || !validInstant(input?.completedAt) || new Date(input.completedAt) < new Date(input.startedAt)) findings.push(finding("A valid drill execution window is required.", "period"));
  if (input?.outcome !== "passed" || !Number.isSafeInteger(input?.actualRtoSeconds) || !Number.isSafeInteger(input?.targetRtoSeconds) || input.actualRtoSeconds > input.targetRtoSeconds) findings.push(finding("Drill must pass within its exact RTO target.", "outcome"));
  if (["pitr_restore", "postgres_failover"].includes(input?.drillType) && (!Number.isSafeInteger(input?.actualRpoSeconds) || !Number.isSafeInteger(input?.targetRpoSeconds) || input.actualRpoSeconds > input.targetRpoSeconds)) findings.push(finding("Database drill must pass within its exact RPO target.", "rpo"));
  const immutable = { drillId: input?.drillId, idempotencyKey: input?.idempotencyKey, drillType: input?.drillType, componentId: input?.componentId, startedAt: input?.startedAt, completedAt: input?.completedAt, targetRtoSeconds: input?.targetRtoSeconds, actualRtoSeconds: input?.actualRtoSeconds, targetRpoSeconds: input?.targetRpoSeconds ?? null, actualRpoSeconds: input?.actualRpoSeconds ?? null, outcome: input?.outcome, executionEvidenceRef: input?.executionEvidenceRef, executedBy: input?.executedBy, witnessedBy: input?.witnessedBy };
  const prior = existing.find((row) => row.idempotencyKey === input?.idempotencyKey || row.drillId === input?.drillId);
  if (prior) return prior.checksumSha256 === hash(immutable) ? result([], { drill: prior, idempotent: true }) : result([finding("Drill idempotency conflict.", "idempotencyKey")], { drill: null, idempotent: false });
  if (findings.length) return result(findings, { drill: null, idempotent: false });
  return result([], { drill: { ...immutable, checksumSha256: hash(immutable), recordedAt: now.toISOString(), status: "effective" }, idempotent: false });
}

export function assessProductionGoLive(attestations = [], drills = [], input, now = new Date()) {
  const findings = [];
  if (!input?.assessmentId || !input?.releaseRef || !input?.proposedBy || !input?.approvedBy || input.proposedBy === input.approvedBy || !input?.approvalRef) findings.push(finding("Release identity and independent go-live approval are required.", "approval"));
  const graph = evaluateProductionDependencyGraph(attestations, now);
  if (!graph.ready) findings.push(finding("All required production components and their dependencies must have current certified evidence.", "components"));
  const effective = new Set(drills.filter((row) => row.status === "effective" && row.outcome === "passed").map((row) => row.drillType));
  for (const required of ["idp_failover", "kms_failover", "postgres_failover", "pitr_restore", "queue_recovery", "deployment_rollback"]) if (!effective.has(required)) findings.push(finding(`Required resilience drill is missing: ${required}.`, "drills"));
  const decision = findings.length ? "blocked" : "approved";
  const body = { assessmentId: input?.assessmentId, releaseRef: input?.releaseRef, componentGraphSha256: hash(graph), drillIds: drills.map((row) => row.drillId).sort(), proposedBy: input?.proposedBy, approvedBy: input?.approvedBy, approvalRef: input?.approvalRef, decision };
  return result(findings, { assessment: { ...body, checksumSha256: hash(body), assessedAt: now.toISOString() }, graph });
}
