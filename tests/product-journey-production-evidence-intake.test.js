import assert from "node:assert/strict";
import test from "node:test";

import {
  approveProductJourneyProductionArtifact,
  projectProductJourneyProductionEvidenceBlockers,
  resolveProductJourneyProductionArtifacts,
  suspendProductJourneyProductionArtifact,
  validateProductJourneyProductionArtifactInput
} from "@loanos/core/journeys/product-journey-production-evidence-intake.js";
import { PRODUCT_TEMPLATE_CATALOGUE } from "@loanos/core/platform/product-template-catalogue.js";

const NOW = new Date("2026-07-18T10:00:00.000Z");
const SCOPE = { tenantId: "tenant-1", journeyType: "personal_loan", templateVersion: "1", configurationVersion: "7" };
const CHECKS = { sourceMatched: true, checksumMatched: true, custodyConfirmed: true, scopeConfirmed: true, witnessConfirmed: true };

function artifactInput(overrides = {}) {
  const artifactId = overrides.artifactId ?? "domain-provider-certification";
  return {
    ...SCOPE,
    artifactId,
    artifactType: "evidence_domain",
    domain: "provider_certification",
    evidenceStatus: "certified",
    externalArtifact: { reference: `external/${artifactId}`, checksumSha256: "a".repeat(64), mediaType: "application/pdf" },
    source: { system: "provider-assurance-portal", recordRef: `record/${artifactId}`, sourceOwnerRef: "provider-owner/1", retrievedAt: "2026-07-18T08:00:00.000Z" },
    custody: { custodianRef: "records/1", repositoryRef: `worm/${artifactId}`, storageCountry: "IN", immutable: true },
    witness: { witnessedBy: "witness-1", witnessRef: `witness/${artifactId}`, witnessedAt: "2026-07-18T09:00:00.000Z" },
    producedBy: "provider-operator-1",
    observedAt: "2026-07-18T09:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
    ...overrides
  };
}

function approve(registry, artifact) {
  return approveProductJourneyProductionArtifact(registry, { artifact, proposedBy: "maker-1", approvedBy: "reviewer-1", approvalRef: `approval/${artifact.artifactId}`, reviewEvidenceRef: `review/${artifact.artifactId}`, reviewChecklist: CHECKS }, NOW);
}

test("JD-06 artifact intake fails closed on payload-adjacent metadata gaps and non-independent review", () => {
  assert.throws(() => validateProductJourneyProductionArtifactInput(artifactInput({ externalArtifact: { reference: "external/x", checksumSha256: "not-a-sha", mediaType: "application/pdf" } }), NOW), (error) => error.code === "journey_production_artifact_checksum_invalid");
  assert.throws(() => validateProductJourneyProductionArtifactInput(artifactInput({ witness: { witnessedBy: "provider-operator-1", witnessRef: "witness/x", witnessedAt: "2026-07-18T09:00:00.000Z" } }), NOW), (error) => error.code === "journey_production_artifact_witness_independence");
  assert.throws(() => approveProductJourneyProductionArtifact({}, { artifact: artifactInput(), proposedBy: "maker-1", approvedBy: "witness-1", approvalRef: "approval/1", reviewEvidenceRef: "review/1", reviewChecklist: CHECKS }, NOW), (error) => error.code === "journey_production_artifact_review_independence");
  assert.throws(() => approveProductJourneyProductionArtifact({}, { artifact: artifactInput(), proposedBy: "maker-1", approvedBy: "reviewer-1", approvalRef: "approval/1", reviewEvidenceRef: "review/1", reviewChecklist: { ...CHECKS, checksumMatched: false } }, NOW), (error) => error.code === "journey_production_artifact_review_incomplete");
});

test("JD-06 evidence bundles resolve only current independently reviewed external artifact metadata", () => {
  let registry = {};
  registry = approve(registry, artifactInput()).registry;
  for (const providerFamily of PRODUCT_TEMPLATE_CATALOGUE.personal_loan.integrationsProviders) {
    const artifactId = `provider-${providerFamily}`;
    registry = approve(registry, artifactInput({ artifactId, artifactType: "provider_dependency", domain: undefined, evidenceStatus: undefined, providerFamily, providerLineage: { dataResidencyCountry: "IN", certificationRef: `cert/${providerFamily}`, mappingRef: `mapping/${providerFamily}`, reconciliationRef: `reconciliation/${providerFamily}` } })).registry;
  }
  const artifactRefs = Object.keys(registry);
  const resolved = resolveProductJourneyProductionArtifacts(registry, { ...SCOPE, registryType: "provider", artifactRefs }, NOW);
  assert.equal(resolved.evidence.length, 1);
  assert.equal(resolved.externalDependencies.length, PRODUCT_TEMPLATE_CATALOGUE.personal_loan.integrationsProviders.length);
  assert.equal(resolved.artifactBindings.length, artifactRefs.length);

  const suspended = suspendProductJourneyProductionArtifact(registry, { artifactId: artifactRefs[0], reason: "source withdrawn", incidentRef: "incident/1", proposedBy: "maker-2", approvedBy: "checker-2", approvalRef: "approval/suspend" }, NOW).registry;
  assert.throws(() => resolveProductJourneyProductionArtifacts(suspended, { ...SCOPE, registryType: "provider", artifactRefs }, NOW), (error) => error.code === "journey_production_artifact_missing");
});

test("JD-06 blocker projection exposes missing, suspended and expired external inputs without creating readiness", () => {
  let registry = approve({}, artifactInput({ artifactId: "expired-domain", validUntil: "2026-07-18T10:00:01.000Z" })).registry;
  const afterExpiry = new Date("2026-07-18T10:00:02.000Z");
  let projection = projectProductJourneyProductionEvidenceBlockers(registry, {}, SCOPE, afterExpiry);
  assert.equal(projection.status, "blocked");
  assert.equal(projection.domains.find((item) => item.domain === "provider_certification").state, "expired");
  assert.ok(projection.blockers.includes("registry:institution:missing"));

  registry = suspendProductJourneyProductionArtifact(registry, { artifactId: "expired-domain", reason: "invalidated", incidentRef: "incident/2", proposedBy: "maker-2", approvedBy: "checker-2", approvalRef: "approval/suspend" }, NOW).registry;
  projection = projectProductJourneyProductionEvidenceBlockers(registry, {}, SCOPE, NOW);
  assert.equal(projection.domains.find((item) => item.domain === "provider_certification").state, "suspended");
});
