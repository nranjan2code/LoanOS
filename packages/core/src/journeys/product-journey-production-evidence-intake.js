import { createHash } from "node:crypto";

import {
  JOURNEY_PRODUCTION_EVIDENCE_DOMAINS,
  JOURNEY_PRODUCTION_EVIDENCE_DOMAIN_GROUPS,
  JOURNEY_PRODUCTION_EVIDENCE_REGISTRY_TYPES,
  PRODUCT_JOURNEY_TYPES
} from "./product-journey-certification.js";
import { PRODUCT_TEMPLATE_CATALOGUE } from "../platform/product-template-catalogue.js";

export const JOURNEY_PRODUCTION_ARTIFACT_TYPES = Object.freeze(["evidence_domain", "provider_dependency"]);
const REVIEW_CHECKS = Object.freeze(["sourceMatched", "checksumMatched", "custodyConfirmed", "scopeConfirmed", "witnessConfirmed"]);

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const text = (value, field) => {
  if (typeof value !== "string" || !value.trim()) fail("journey_production_artifact_invalid", `${field} is required.`);
  return value.trim();
};
const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const isSha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const timestamp = (value, field, now, future = false) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || (future ? parsed <= now : parsed > now)) {
    fail("journey_production_artifact_time_invalid", `${field} must be a valid ${future ? "future" : "non-future"} timestamp.`);
  }
  return parsed.toISOString();
};

/**
 * Normalizes metadata about an externally retained artifact. It never accepts
 * the artifact payload: only a reference, digest, source, custody and witness
 * lineage can cross this repository boundary.
 */
export function validateProductJourneyProductionArtifactInput(input = {}, now = new Date()) {
  const artifactId = text(input.artifactId, "artifactId");
  const artifactType = text(input.artifactType, "artifactType");
  if (!JOURNEY_PRODUCTION_ARTIFACT_TYPES.includes(artifactType)) fail("journey_production_artifact_type_invalid", "Unknown production artifact type.");
  const tenantId = text(input.tenantId, "tenantId");
  const journeyType = text(input.journeyType, "journeyType");
  if (!PRODUCT_JOURNEY_TYPES.includes(journeyType)) fail("journey_type_invalid", "Production artifact requires a canonical journey type.");
  const templateVersion = text(input.templateVersion, "templateVersion");
  const configurationVersion = text(input.configurationVersion, "configurationVersion");
  const producedBy = text(input.producedBy, "producedBy");
  const observedAt = timestamp(input.observedAt, "observedAt", now);
  const validUntil = timestamp(input.validUntil, "validUntil", now, true);

  const externalArtifact = {
    reference: text(input.externalArtifact?.reference, "externalArtifact.reference"),
    checksumSha256: text(input.externalArtifact?.checksumSha256, "externalArtifact.checksumSha256").toLowerCase(),
    mediaType: text(input.externalArtifact?.mediaType, "externalArtifact.mediaType")
  };
  if (!isSha256(externalArtifact.checksumSha256)) fail("journey_production_artifact_checksum_invalid", "External artifact checksum must be SHA-256.");
  const source = {
    system: text(input.source?.system, "source.system"),
    recordRef: text(input.source?.recordRef, "source.recordRef"),
    sourceOwnerRef: text(input.source?.sourceOwnerRef, "source.sourceOwnerRef"),
    retrievedAt: timestamp(input.source?.retrievedAt, "source.retrievedAt", now)
  };
  const custody = {
    custodianRef: text(input.custody?.custodianRef, "custody.custodianRef"),
    repositoryRef: text(input.custody?.repositoryRef, "custody.repositoryRef"),
    storageCountry: text(input.custody?.storageCountry, "custody.storageCountry"),
    immutable: input.custody?.immutable === true
  };
  if (custody.storageCountry !== "IN" || !custody.immutable) fail("journey_production_artifact_custody_invalid", "India custody in an immutable repository is required.");
  const witness = {
    witnessedBy: text(input.witness?.witnessedBy, "witness.witnessedBy"),
    witnessRef: text(input.witness?.witnessRef, "witness.witnessRef"),
    witnessedAt: timestamp(input.witness?.witnessedAt, "witness.witnessedAt", now)
  };
  if (witness.witnessedBy === producedBy) fail("journey_production_artifact_witness_independence", "Artifact producer and witness must be independent.");

  let domain = null;
  let providerFamily = null;
  let evidenceStatus = null;
  let providerLineage = null;
  if (artifactType === "evidence_domain") {
    domain = text(input.domain, "domain");
    if (!JOURNEY_PRODUCTION_EVIDENCE_DOMAINS.includes(domain)) fail("journey_production_artifact_domain_invalid", "Unknown production evidence domain.");
    evidenceStatus = text(input.evidenceStatus, "evidenceStatus");
    if (!["passed", "certified", "accepted"].includes(evidenceStatus)) fail("journey_production_artifact_status_invalid", "Evidence-domain artifact must have an accepted external outcome.");
  } else {
    providerFamily = text(input.providerFamily, "providerFamily");
    const requiredFamilies = PRODUCT_TEMPLATE_CATALOGUE[journeyType]?.integrationsProviders ?? [];
    if (!requiredFamilies.includes(providerFamily)) fail("journey_production_artifact_provider_invalid", "Provider family is not declared by this journey template.");
    providerLineage = {
      dataResidencyCountry: text(input.providerLineage?.dataResidencyCountry, "providerLineage.dataResidencyCountry"),
      certificationRef: text(input.providerLineage?.certificationRef, "providerLineage.certificationRef"),
      mappingRef: text(input.providerLineage?.mappingRef, "providerLineage.mappingRef"),
      reconciliationRef: text(input.providerLineage?.reconciliationRef, "providerLineage.reconciliationRef")
    };
    if (providerLineage.dataResidencyCountry !== "IN") fail("journey_production_artifact_provider_residency_invalid", "Provider evidence must establish India data residency.");
  }

  return {
    artifactId, artifactType, tenantId, journeyType, templateVersion, configurationVersion,
    domain, providerFamily, evidenceStatus, providerLineage, externalArtifact, source, custody,
    witness, producedBy, observedAt, validUntil,
    verificationBoundary: "human_attested_external_metadata"
  };
}

export function approveProductJourneyProductionArtifact(registry = {}, input = {}, now = new Date()) {
  const artifact = validateProductJourneyProductionArtifactInput(input.artifact, now);
  const proposedBy = text(input.proposedBy, "proposedBy");
  const approvedBy = text(input.approvedBy, "approvedBy");
  const approvalRef = text(input.approvalRef, "approvalRef");
  const reviewEvidenceRef = text(input.reviewEvidenceRef, "reviewEvidenceRef");
  if ([proposedBy, artifact.producedBy, artifact.witness.witnessedBy].includes(approvedBy)) fail("journey_production_artifact_review_independence", "Reviewer must be independent of proposer, producer and witness.");
  const reviewChecklist = Object.fromEntries(REVIEW_CHECKS.map((field) => [field, input.reviewChecklist?.[field] === true]));
  if (Object.values(reviewChecklist).some((value) => !value)) fail("journey_production_artifact_review_incomplete", "All independent review checks must pass.");
  const review = { approvedBy, approvalRef, reviewEvidenceRef, reviewChecklist };
  const artifactChecksumSha256 = sha({ artifact, review });
  const current = registry[artifact.artifactId];
  if (current) {
    if (current.artifactChecksumSha256 === artifactChecksumSha256) return { registry, artifact: current, idempotent: true };
    fail("journey_production_artifact_conflict", "artifactId is already bound to different metadata.");
  }
  const record = { ...artifact, review, artifactChecksumSha256, status: "active", proposedBy, registeredAt: now.toISOString() };
  return { registry: { ...registry, [record.artifactId]: record }, artifact: record, idempotent: false };
}

export function suspendProductJourneyProductionArtifact(registry = {}, input = {}, now = new Date()) {
  const artifactId = text(input.artifactId, "artifactId");
  const current = registry[artifactId];
  if (!current || current.status !== "active") fail("journey_production_artifact_missing", "An active production artifact is required.");
  verifyArtifactRecord(current);
  const proposedBy = text(input.proposedBy, "proposedBy");
  const approvedBy = text(input.approvedBy, "approvedBy");
  if (proposedBy === approvedBy) fail("journey_production_artifact_suspension_four_eyes", "Artifact suspension requires independent approval.");
  const suspension = {
    reason: text(input.reason, "reason"), incidentRef: text(input.incidentRef, "incidentRef"), proposedBy,
    approvedBy, approvalRef: text(input.approvalRef, "approvalRef"), suspendedAt: now.toISOString()
  };
  const artifact = { ...current, status: "suspended", suspension };
  return { registry: { ...registry, [artifactId]: artifact }, artifact };
}

export function resolveProductJourneyProductionArtifacts(registry = {}, input = {}, now = new Date()) {
  const registryType = text(input.registryType, "registryType");
  if (!JOURNEY_PRODUCTION_EVIDENCE_REGISTRY_TYPES.includes(registryType)) fail("journey_production_registry_type_invalid", "Unknown production evidence registry type.");
  const scope = productionScope(input);
  const artifactRefs = Array.isArray(input.artifactRefs) ? input.artifactRefs.map((ref) => text(ref, "artifactRefs[]")) : [];
  if (new Set(artifactRefs).size !== artifactRefs.length) fail("journey_production_artifact_refs_duplicate", "Artifact references must be unique.");
  const artifacts = artifactRefs.map((artifactId) => {
    const artifact = registry[artifactId];
    if (!artifact || artifact.status !== "active") fail("journey_production_artifact_missing", `Active artifact ${artifactId} is required.`);
    verifyArtifactRecord(artifact);
    if (Date.parse(artifact.validUntil) <= now.getTime()) fail("journey_production_artifact_expired", `Artifact ${artifactId} has expired.`);
    for (const field of Object.keys(scope)) if (String(artifact[field]) !== scope[field]) fail("journey_production_artifact_scope_mismatch", `Artifact ${artifactId} ${field} does not match the bundle scope.`);
    return artifact;
  });
  const requiredDomains = JOURNEY_PRODUCTION_EVIDENCE_DOMAIN_GROUPS[registryType];
  for (const domain of requiredDomains) if (artifacts.filter((item) => item.artifactType === "evidence_domain" && item.domain === domain).length !== 1) fail("journey_production_artifact_domains_incomplete", `${registryType} requires exactly one ${domain} artifact.`);
  const unexpectedDomains = artifacts.filter((item) => item.artifactType === "evidence_domain" && !requiredDomains.includes(item.domain));
  if (unexpectedDomains.length) fail("journey_production_artifact_domains_incomplete", `${registryType} bundle contains unexpected evidence domains.`);
  const providerArtifacts = artifacts.filter((item) => item.artifactType === "provider_dependency");
  const requiredFamilies = PRODUCT_TEMPLATE_CATALOGUE[scope.journeyType]?.integrationsProviders ?? [];
  if (registryType === "provider") {
    for (const family of requiredFamilies) if (providerArtifacts.filter((item) => item.providerFamily === family).length !== 1) fail("journey_production_artifact_providers_incomplete", `Provider bundle requires exactly one ${family} artifact.`);
    if (providerArtifacts.some((item) => !requiredFamilies.includes(item.providerFamily))) fail("journey_production_artifact_providers_incomplete", "Provider bundle contains an unexpected provider family.");
  } else if (providerArtifacts.length) fail("journey_production_artifact_providers_incomplete", "Only provider bundles may contain provider-dependency artifacts.");

  return {
    artifacts,
    artifactBindings: artifacts.map((artifact) => ({ artifactId: artifact.artifactId, artifactChecksumSha256: artifact.artifactChecksumSha256 })),
    evidence: artifacts.filter((item) => item.artifactType === "evidence_domain").map(toEvidenceItem),
    externalDependencies: providerArtifacts.map(toProviderDependency)
  };
}

export function projectProductJourneyProductionEvidenceBlockers(artifactRegistry = {}, evidenceRegistries = {}, input = {}, now = new Date()) {
  const scope = productionScope(input);
  const current = Object.values(artifactRegistry).filter((artifact) => Object.keys(scope).every((field) => String(artifact?.[field]) === scope[field]));
  const artifactState = (artifact) => !artifact ? "missing" : artifact.status !== "active" ? artifact.status : Date.parse(artifact.validUntil) <= now.getTime() ? "expired" : safeArtifactChecksum(artifact) ? "ready" : "checksum_mismatch";
  const domains = JOURNEY_PRODUCTION_EVIDENCE_DOMAINS.map((domain) => {
    const matches = current.filter((artifact) => artifact.artifactType === "evidence_domain" && artifact.domain === domain);
    const state = matches.length > 1 ? "duplicate" : artifactState(matches[0]);
    return { domain, state, artifactId: matches.length === 1 ? matches[0].artifactId : null };
  });
  const providerFamilies = (PRODUCT_TEMPLATE_CATALOGUE[scope.journeyType]?.integrationsProviders ?? []).map((providerFamily) => {
    const matches = current.filter((artifact) => artifact.artifactType === "provider_dependency" && artifact.providerFamily === providerFamily);
    const state = matches.length > 1 ? "duplicate" : artifactState(matches[0]);
    return { providerFamily, state, artifactId: matches.length === 1 ? matches[0].artifactId : null };
  });
  const registryTypes = JOURNEY_PRODUCTION_EVIDENCE_REGISTRY_TYPES.map((registryType) => {
    const matches = Object.values(evidenceRegistries?.[registryType] ?? {}).filter((record) => Object.keys(scope).every((field) => String(record?.[field]) === scope[field]) && record.status === "active" && Date.parse(record.validUntil) > now.getTime());
    return { registryType, state: matches.length === 1 ? "ready" : matches.length > 1 ? "duplicate" : "missing", evidenceId: matches.length === 1 ? matches[0].evidenceId : null };
  });
  const blockers = [
    ...domains.filter((item) => item.state !== "ready").map((item) => `domain:${item.domain}:${item.state}`),
    ...providerFamilies.filter((item) => item.state !== "ready").map((item) => `provider:${item.providerFamily}:${item.state}`),
    ...registryTypes.filter((item) => item.state !== "ready").map((item) => `registry:${item.registryType}:${item.state}`)
  ];
  return { ...scope, status: blockers.length ? "blocked" : "ready_for_certification_proposal", domains, providerFamilies, registryTypes, blockers, assessedAt: now.toISOString() };
}

function productionScope(input) {
  const tenantId = text(input.tenantId, "tenantId");
  const journeyType = text(input.journeyType, "journeyType");
  if (!PRODUCT_JOURNEY_TYPES.includes(journeyType)) fail("journey_type_invalid", "Production evidence requires a canonical journey type.");
  return { tenantId, journeyType, templateVersion: text(input.templateVersion, "templateVersion"), configurationVersion: text(input.configurationVersion, "configurationVersion") };
}
function toEvidenceItem(artifact) {
  return { domain: artifact.domain, tenantId: artifact.tenantId, journeyType: artifact.journeyType, templateVersion: artifact.templateVersion, configurationVersion: artifact.configurationVersion, status: artifact.evidenceStatus, evidenceRef: artifact.externalArtifact.reference, evidenceChecksumSha256: artifact.externalArtifact.checksumSha256, observedAt: artifact.observedAt, validUntil: artifact.validUntil, producedBy: artifact.producedBy, approvedBy: artifact.review.approvedBy };
}
function toProviderDependency(artifact) {
  return { tenantId: artifact.tenantId, journeyType: artifact.journeyType, templateVersion: artifact.templateVersion, configurationVersion: artifact.configurationVersion, providerFamily: artifact.providerFamily, status: "certified", ...artifact.providerLineage, evidenceChecksumSha256: artifact.externalArtifact.checksumSha256, validUntil: artifact.validUntil };
}
function verifyArtifactRecord(record) {
  const { review, artifactChecksumSha256, status: _status, proposedBy, registeredAt: _registeredAt, suspension: _suspension, ...artifact } = record;
  if (!isSha256(artifactChecksumSha256) || sha({ artifact, review }) !== artifactChecksumSha256) fail("journey_production_artifact_checksum_mismatch", "Production artifact metadata checksum does not match persisted content.");
  if (!proposedBy) fail("journey_production_artifact_checksum_mismatch", "Production artifact proposer lineage is missing.");
}
function safeArtifactChecksum(record) {
  try { verifyArtifactRecord(record); return true; } catch { return false; }
}
