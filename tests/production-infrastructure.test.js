import test from "node:test";
import assert from "node:assert/strict";
import { REQUIRED_PRODUCTION_COMPONENTS, assessProductionGoLive, attestProductionComponent, evaluateProductionDependencyGraph, recordProductionResilienceDrill } from "../packages/core/src/production-infrastructure.js";

const now = new Date("2026-07-15T00:00:00.000Z");
const approval = { attestedBy: "platform-maker", approvedBy: "risk-checker", approvalRef: "APR-1" };
const attest = (type, dependencies = []) => ({ attestationId: `att-${type}`, idempotencyKey: `ik-${type}`, componentId: `cmp-${type}`, componentType: type, providerRef: `provider-${type}`, environmentRef: "prod", configurationEvidenceRef: `cfg-${type}`, controlTestEvidenceRef: `test-${type}`, evidenceValidUntil: "2027-07-15T00:00:00.000Z", status: "certified", dependencies, ...approval });

test("component attestation is evidence-bound, independently approved, expiring, and idempotent", () => {
  const first = attestProductionComponent([], attest("idp"), now);
  assert.equal(first.attestation.status, "certified");
  assert.equal(attestProductionComponent([first.attestation], attest("idp"), now).idempotent, true);
  assert.equal(attestProductionComponent([first.attestation], { ...attest("idp"), providerRef: "changed" }, now).attestation, null);
  assert.equal(attestProductionComponent([], { ...attest("scim"), approvedBy: "platform-maker" }, now).summary.status, "blocked");
  assert.equal(attestProductionComponent([], { ...attest("scim"), evidenceValidUntil: now.toISOString() }, now).attestation, null);
});

test("dependency graph fails closed for missing and expired dependencies", () => {
  const idp = attestProductionComponent([], attest("idp"), now).attestation;
  const scim = attestProductionComponent([], attest("scim", ["cmp-idp"]), now).attestation;
  assert.equal(evaluateProductionDependencyGraph([scim], now).rows[0].ready, false);
  const graph = evaluateProductionDependencyGraph([idp, scim], new Date("2028-01-01T00:00:00.000Z"));
  assert.equal(graph.ready, false); assert.equal(graph.rows.every((row) => row.expired), true);
});

test("drills enforce witnessed RTO/RPO and go-live requires every component and drill", () => {
  const attestations = REQUIRED_PRODUCTION_COMPONENTS.map((type, index) => attestProductionComponent([], attest(type, index ? [`cmp-${REQUIRED_PRODUCTION_COMPONENTS[index - 1]}`] : []), now).attestation);
  const drillTypes = ["idp_failover", "kms_failover", "postgres_failover", "pitr_restore", "queue_recovery", "deployment_rollback"];
  const drills = drillTypes.map((drillType) => recordProductionResilienceDrill([], { drillId: `dr-${drillType}`, idempotencyKey: `ik-dr-${drillType}`, drillType, componentId: "component", startedAt: "2026-07-14T01:00:00.000Z", completedAt: "2026-07-14T01:01:00.000Z", targetRtoSeconds: 120, actualRtoSeconds: 60, ...(drillType.includes("pitr") || drillType.includes("postgres") ? { targetRpoSeconds: 60, actualRpoSeconds: 30 } : {}), outcome: "passed", executionEvidenceRef: `ev-${drillType}`, executedBy: "sre", witnessedBy: "risk" }, now).drill);
  assert.equal(recordProductionResilienceDrill([], { drillId: "bad", idempotencyKey: "bad", drillType: "pitr_restore", componentId: "db", startedAt: "2026-07-14T01:00:00.000Z", completedAt: "2026-07-14T01:01:00.000Z", targetRtoSeconds: 60, actualRtoSeconds: 61, targetRpoSeconds: 10, actualRpoSeconds: 11, outcome: "passed", executionEvidenceRef: "ev", executedBy: "same", witnessedBy: "same" }, now).drill, null);
  const input = { assessmentId: "go-1", releaseRef: "release-1", proposedBy: "release-maker", approvedBy: "risk-checker", approvalRef: "GO-1" };
  assert.equal(assessProductionGoLive(attestations, drills.slice(0, -1), input, now).assessment.decision, "blocked");
  const approved = assessProductionGoLive(attestations, drills, input, now);
  assert.equal(approved.assessment.decision, "approved"); assert.equal(approved.graph.ready, true);
});
