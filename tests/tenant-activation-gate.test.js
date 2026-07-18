import test from "node:test";
import assert from "node:assert/strict";
import {
  assessTenantActivation,
  checksumTenantActivationEvidence,
  TENANT_ACTIVATION_DIMENSIONS
} from "@loanos/core/platform/tenant-activation-gate.js";

const NOW = new Date("2026-07-15T10:00:00.000Z");
const VALID_UNTIL = "2026-10-15T10:00:00.000Z";

function item(idField, id, mode = "simulated", status = "ready") {
  return { tenantId: "tenant-1", [idField]: id, status, mode, commerciallyLive: mode === "live", validUntil: VALID_UNTIL };
}

function payloads(mode = "simulated") {
  return {
    organisation_admission: { decision: "approved", requiredChecksComplete: true },
    iam_staffing: { launchRoleCoverageComplete: true, featureStaffingComplete: true, segregationViolations: [], orphanedRequiredRoles: [], activeHumanPrincipalCount: 2 },
    products: { products: [item("productId", "personal-loan", mode)] },
    integrations: { campaigns: [item("integrationId", "kyc-provider", mode, "passed")] },
    deployment: { components: [item("componentId", "api", mode, "healthy")], rollbackVerified: true },
    security_controls: { controls: [item("controlId", "session-revocation", mode, "effective")], failClosedVerified: true },
    uat: { status: "passed", adverseCasesComplete: true, tenantSignoffComplete: true },
    drills: { drills: [item("scenarioId", "idp-outage", mode, "passed")], independentWitnessComplete: true }
  };
}

function envelope(dimension, payload, mode = "simulated", overrides = {}) {
  const evidence = {
    evidenceId: `evidence-${dimension}`,
    tenantId: "tenant-1",
    dimension,
    evidenceRef: `evidence://${dimension}`,
    observedAt: "2026-07-15T09:00:00.000Z",
    validUntil: VALID_UNTIL,
    mode,
    commerciallyLive: mode === "live",
    payload,
    ...overrides
  };
  evidence.evidenceChecksumSha256 = checksumTenantActivationEvidence(evidence);
  return evidence;
}

function input(mode = "simulated") {
  const payload = payloads(mode);
  return {
    assessmentId: "assessment-1",
    tenantId: "tenant-1",
    selectedProductIds: ["personal-loan"],
    requiredIntegrationIds: ["kyc-provider"],
    requiredDeploymentComponentIds: ["api"],
    requiredSecurityControlIds: ["session-revocation"],
    requiredDrillScenarioIds: ["idp-outage"],
    evidence: Object.fromEntries(TENANT_ACTIVATION_DIMENSIONS.map((dimension) => [dimension, envelope(dimension, payload[dimension], mode)]))
  };
}

test("complete simulator evidence reaches sandbox readiness but never production readiness", () => {
  const assessment = assessTenantActivation(input(), NOW);
  assert.equal(assessment.status, "sandbox_ready");
  assert.equal(assessment.blockers.length, 0);
  assert.ok(assessment.productionGaps.length >= TENANT_ACTIVATION_DIMENSIONS.length * 2);
  assert.deepEqual(
    [...new Set(assessment.productionGaps.filter((finding) => finding.code === "simulator_evidence_only").map((finding) => finding.dimension))].sort(),
    [...TENANT_ACTIVATION_DIMENSIONS].sort()
  );
  assert.equal(assessment.policy.simulatorEvidenceCanReachProduction, false);
  assert.equal(assessment.dimensions.integrations.productionReady, false);
});

test("current same-tenant live evidence can establish production readiness", () => {
  const assessment = assessTenantActivation(input("live"), NOW);
  assert.equal(assessment.status, "production_ready");
  assert.equal(assessment.blockers.length, 0);
  assert.equal(assessment.productionGaps.length, 0);
  assert.equal(assessment.dimensions.drills.productionReady, true);
});

test("missing, cross-tenant, stale and tampered evidence all fail closed with specific reasons", () => {
  const value = input();
  delete value.evidence.uat;
  value.evidence.organisation_admission = envelope("organisation_admission", payloads().organisation_admission, "simulated", { tenantId: "tenant-2" });
  value.evidence.iam_staffing = envelope("iam_staffing", payloads().iam_staffing, "simulated", { observedAt: "2025-01-01T00:00:00.000Z" });
  value.evidence.products.payload.products[0].status = "disabled"; // checksum is now intentionally stale
  const assessment = assessTenantActivation(value, NOW);
  assert.equal(assessment.status, "blocked");
  assert.ok(assessment.blockers.some((finding) => finding.code === "evidence_missing" && finding.dimension === "uat"));
  assert.ok(assessment.blockers.some((finding) => finding.code === "evidence_tenant_mismatch"));
  assert.ok(assessment.blockers.some((finding) => finding.code === "evidence_stale"));
  assert.ok(assessment.blockers.some((finding) => finding.code === "evidence_checksum_mismatch"));
  assert.equal(assessment.staleEvidence.length, 1);
});

test("incomplete staffing, selected products and required campaigns remain blocked", () => {
  const value = input();
  const iamPayload = { ...payloads().iam_staffing, activeHumanPrincipalCount: 1, segregationViolations: ["maker-is-checker"] };
  value.evidence.iam_staffing = envelope("iam_staffing", iamPayload);
  value.evidence.products = envelope("products", { products: [] });
  value.evidence.integrations = envelope("integrations", { campaigns: [item("integrationId", "kyc-provider", "simulated", "failed")] });
  const assessment = assessTenantActivation(value, NOW);
  assert.equal(assessment.status, "blocked");
  assert.ok(assessment.blockers.some((finding) => finding.code === "segregation_violation"));
  assert.ok(assessment.blockers.some((finding) => finding.code === "insufficient_human_principals"));
  assert.ok(assessment.blockers.some((finding) => finding.code === "product_missing"));
  assert.ok(assessment.blockers.some((finding) => finding.code === "integration_not_ready"));
});

test("assessment checksum is deterministic across evidence and requirement insertion order", () => {
  const first = input();
  const second = input();
  second.evidence = Object.fromEntries(Object.entries(second.evidence).reverse());
  const a = assessTenantActivation(first, NOW);
  const b = assessTenantActivation(second, NOW);
  assert.equal(a.assessmentChecksumSha256, b.assessmentChecksumSha256);
  assert.deepEqual(a, b);
});

test("invalid request scope is rejected before assessment", () => {
  assert.throws(() => assessTenantActivation({ ...input(), selectedProductIds: [] }, NOW), (error) => error.code === "tenant_activation_input_invalid");
  assert.throws(() => assessTenantActivation({ ...input(), requiredDrillScenarioIds: ["idp-outage", "idp-outage"] }, NOW), (error) => error.code === "tenant_activation_input_invalid");
});
