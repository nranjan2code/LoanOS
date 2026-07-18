import { createHash } from "node:crypto";

export const ENTERPRISE_PLATFORM_FAMILIES = Object.freeze([
  "kms_hsm_vault",
  "broker_dlq",
  "cdc_checkpoint",
  "mdm_device",
  "deployment_controller",
  "trusted_time"
]);

export const REQUIRED_ENTERPRISE_SCENARIO_CLASSES = Object.freeze([
  "success",
  "authentication",
  "tenant_isolation",
  "integrity",
  "freshness",
  "replay_idempotency",
  "ordering_checkpoint",
  "partial_failure",
  "recovery_rollback",
  "outage"
]);

const scenario = (family, name, scenarioClass, expectedDisposition, safetyState = "contained") => Object.freeze({
  scenarioId: `${family}.${name}`,
  family,
  name,
  scenarioClass,
  expectedDisposition,
  safetyState,
  required: true,
  executionMode: "simulated",
  commerciallyLive: false
});

const pack = (family, definitions) => Object.freeze(definitions.map((definition) => scenario(family, ...definition)));

export const ENTERPRISE_PLATFORM_CONFORMANCE_PACKS = Object.freeze({
  kms_hsm_vault: pack("kms_hsm_vault", [
    ["non_exportable_operation", "success", "accept", "operational"],
    ["workload_identity_invalid", "authentication", "deny"],
    ["vault_token_expired", "freshness", "deny"],
    ["cross_tenant_key_reference", "tenant_isolation", "deny"],
    ["purpose_grant_mismatch", "authentication", "deny"],
    ["attestation_tamper", "integrity", "deny"],
    ["duplicate_operation_id", "replay_idempotency", "return_original", "idempotent"],
    ["disabled_key_version", "ordering_checkpoint", "deny"],
    ["rotation_overlap_valid", "recovery_rollback", "recover_safe", "rotated"],
    ["rotation_overlap_missing", "partial_failure", "pause"],
    ["plaintext_export_attempt", "integrity", "deny"],
    ["destruction_with_live_references", "recovery_rollback", "deny"],
    ["vault_sealed", "outage", "pause"],
    ["kms_provider_outage", "outage", "pause"]
  ]),
  broker_dlq: pack("broker_dlq", [
    ["ordered_delivery", "success", "accept", "operational"],
    ["producer_identity_invalid", "authentication", "deny"],
    ["cross_tenant_topic", "tenant_isolation", "deny"],
    ["message_signature_tamper", "integrity", "quarantine"],
    ["expired_message", "freshness", "quarantine"],
    ["duplicate_message", "replay_idempotency", "return_original", "idempotent"],
    ["out_of_order_sequence", "ordering_checkpoint", "pause"],
    ["consumer_offset_regression", "ordering_checkpoint", "pause"],
    ["poison_message_to_dlq", "partial_failure", "quarantine"],
    ["ack_lost_after_commit", "partial_failure", "return_original", "idempotent"],
    ["approved_dlq_replay", "recovery_rollback", "recover_safe", "replayed"],
    ["unapproved_dlq_replay", "recovery_rollback", "deny"],
    ["dlq_retention_expired", "freshness", "escalate"],
    ["broker_partition_outage", "outage", "pause"]
  ]),
  cdc_checkpoint: pack("cdc_checkpoint", [
    ["checkpoint_advance", "success", "accept", "operational"],
    ["connector_identity_invalid", "authentication", "deny"],
    ["cross_tenant_row", "tenant_isolation", "quarantine"],
    ["record_checksum_tamper", "integrity", "quarantine"],
    ["stale_checkpoint", "freshness", "pause"],
    ["duplicate_log_position", "replay_idempotency", "return_original", "idempotent"],
    ["checkpoint_regression", "ordering_checkpoint", "pause"],
    ["schema_incompatible", "ordering_checkpoint", "pause"],
    ["sink_partial_commit", "partial_failure", "reconcile"],
    ["snapshot_log_gap", "partial_failure", "pause"],
    ["approved_backfill_overlap", "recovery_rollback", "recover_safe", "reconciled"],
    ["transform_checksum_mismatch", "integrity", "quarantine"],
    ["source_reconnect_from_checkpoint", "recovery_rollback", "recover_safe", "resumed"],
    ["sink_outage", "outage", "pause"]
  ]),
  mdm_device: pack("mdm_device", [
    ["enrol_compliant_device", "success", "accept", "operational"],
    ["enrolment_identity_invalid", "authentication", "deny"],
    ["cross_tenant_device", "tenant_isolation", "deny"],
    ["attestation_tamper", "integrity", "deny"],
    ["stale_posture", "freshness", "deny"],
    ["duplicate_enrolment_callback", "replay_idempotency", "return_original", "idempotent"],
    ["certificate_revoked", "ordering_checkpoint", "deny"],
    ["certificate_rotation_overlap", "recovery_rollback", "recover_safe", "rotated"],
    ["jailbreak_or_root_detected", "integrity", "deny"],
    ["wipe_acknowledged", "recovery_rollback", "recover_safe", "wiped"],
    ["wipe_timeout", "partial_failure", "escalate"],
    ["offline_work_pack_expired", "freshness", "deny"],
    ["posture_provider_outage", "outage", "deny"],
    ["wipe_provider_outage", "outage", "escalate"]
  ]),
  deployment_controller: pack("deployment_controller", [
    ["healthy_release", "success", "accept", "operational"],
    ["controller_identity_invalid", "authentication", "deny"],
    ["cross_tenant_target", "tenant_isolation", "deny"],
    ["artifact_signature_tamper", "integrity", "deny"],
    ["stale_approval", "freshness", "deny"],
    ["duplicate_deployment_command", "replay_idempotency", "return_original", "idempotent"],
    ["release_sequence_regression", "ordering_checkpoint", "deny"],
    ["health_gate_failure", "partial_failure", "rollback"],
    ["partial_resource_creation", "partial_failure", "compensate"],
    ["compensation_succeeds", "recovery_rollback", "recover_safe", "compensated"],
    ["compensation_fails", "recovery_rollback", "escalate"],
    ["rollback_succeeds", "recovery_rollback", "recover_safe", "rolled_back"],
    ["rollback_artifact_unavailable", "recovery_rollback", "pause"],
    ["runtime_drift_detected", "integrity", "pause"],
    ["secret_material_in_manifest", "integrity", "deny"],
    ["controller_outage", "outage", "pause"]
  ]),
  trusted_time: pack("trusted_time", [
    ["fresh_attested_time", "success", "accept", "operational"],
    ["authority_identity_invalid", "authentication", "deny"],
    ["cross_tenant_attestation", "tenant_isolation", "deny"],
    ["unsigned_attestation", "integrity", "deny"],
    ["custody_timestamp_mismatch", "integrity", "quarantine"],
    ["stale_attestation", "freshness", "deny"],
    ["future_clock_skew", "freshness", "pause"],
    ["attestation_replay", "replay_idempotency", "deny"],
    ["monotonic_time_regression", "ordering_checkpoint", "pause"],
    ["quorum_divergence", "partial_failure", "pause"],
    ["leap_or_offset_anomaly", "partial_failure", "pause"],
    ["authority_recovery_with_quorum", "recovery_rollback", "recover_safe", "resynchronised"],
    ["time_authority_outage", "outage", "pause"]
  ])
});

export function assessEnterprisePlatformConformancePack(family, supplied = ENTERPRISE_PLATFORM_CONFORMANCE_PACKS[family]) {
  assertFamily(family);
  const entries = Array.isArray(supplied) ? supplied : [];
  const ids = new Set();
  const coveredClasses = new Set();
  const findings = [];
  const certifiedById = new Map(ENTERPRISE_PLATFORM_CONFORMANCE_PACKS[family].map((entry) => [entry.scenarioId, entry]));
  for (const entry of entries) {
    if (!entry?.scenarioId || entry.family !== family || !REQUIRED_ENTERPRISE_SCENARIO_CLASSES.includes(entry.scenarioClass)) {
      findings.push({ code: "invalid_scenario", scenarioId: entry?.scenarioId ?? null });
      continue;
    }
    if (ids.has(entry.scenarioId)) findings.push({ code: "duplicate_scenario_id", scenarioId: entry.scenarioId });
    ids.add(entry.scenarioId);
    coveredClasses.add(entry.scenarioClass);
    const certified = certifiedById.get(entry.scenarioId);
    if (!certified) findings.push({ code: "unexpected_scenario_id", scenarioId: entry.scenarioId });
    else if (checksum(entry) !== checksum(certified)) findings.push({ code: "scenario_definition_tampered", scenarioId: entry.scenarioId });
    if (entry.required !== true) findings.push({ code: "required_scenario_disabled", scenarioId: entry.scenarioId });
    if (entry.executionMode !== "simulated" || entry.commerciallyLive !== false) {
      findings.push({ code: "live_claim_forbidden", scenarioId: entry.scenarioId });
    }
    if (entry.scenarioClass !== "success" && entry.expectedDisposition === "accept") {
      findings.push({ code: "unsafe_adverse_disposition", scenarioId: entry.scenarioId });
    }
  }
  for (const scenarioClass of REQUIRED_ENTERPRISE_SCENARIO_CLASSES) {
    if (!coveredClasses.has(scenarioClass)) findings.push({ code: "missing_scenario_class", scenarioClass });
  }
  for (const scenarioId of certifiedById.keys()) {
    if (!ids.has(scenarioId)) findings.push({ code: "missing_scenario_id", scenarioId });
  }
  return Object.freeze({
    family,
    status: findings.length === 0 ? "complete" : "blocked",
    executionMode: "simulated",
    commerciallyLive: false,
    scenarioCount: entries.length,
    coveredClasses: [...coveredClasses].sort(),
    packChecksumSha256: checksum(canonicalPack(entries)),
    findings
  });
}

export function assessEnterprisePlatformConformanceSuite(packs = ENTERPRISE_PLATFORM_CONFORMANCE_PACKS) {
  const assessments = ENTERPRISE_PLATFORM_FAMILIES.map((family) => assessEnterprisePlatformConformancePack(family, packs[family]));
  return Object.freeze({
    status: assessments.every((assessment) => assessment.status === "complete") ? "complete" : "blocked",
    executionMode: "simulated",
    commerciallyLive: false,
    familyCount: assessments.length,
    scenarioCount: assessments.reduce((total, assessment) => total + assessment.scenarioCount, 0),
    assessments
  });
}

export function buildEnterprisePlatformSimulatorManifest(input = {}) {
  required(input.tenantId, "tenantId");
  required(input.campaignId, "campaignId");
  required(input.family, "family");
  required(input.providerProfileRef, "providerProfileRef");
  assertFamily(input.family);
  if (input.executionMode && input.executionMode !== "simulated") fail("enterprise_conformance_live_claim_forbidden", "Enterprise platform emulators cannot create live-provider evidence.");
  const assessment = assessEnterprisePlatformConformancePack(input.family);
  if (assessment.status !== "complete") fail("enterprise_conformance_pack_incomplete", "The conformance pack is incomplete and cannot execute.");
  const manifest = {
    schemaVersion: "enterprise-platform-conformance/v1",
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    family: input.family,
    providerProfileRef: input.providerProfileRef,
    executionMode: "simulated",
    commerciallyLive: false,
    certificationScope: "LoanOS contract and deterministic emulator only",
    logicalTime: normalizeLogicalTime(input.logicalTime ?? "2026-01-01T00:00:00.000Z"),
    packChecksumSha256: assessment.packChecksumSha256,
    scenarioIds: ENTERPRISE_PLATFORM_CONFORMANCE_PACKS[input.family].map((item) => item.scenarioId)
  };
  return Object.freeze({ ...manifest, manifestChecksumSha256: checksum(manifest) });
}

export function simulateEnterprisePlatformScenario(manifest = {}, input = {}) {
  verifyManifest(manifest);
  required(input.tenantId, "tenantId");
  required(input.scenarioId, "scenarioId");
  if (input.tenantId !== manifest.tenantId) fail("enterprise_conformance_tenant_mismatch", "A simulator manifest cannot execute for another tenant.");
  if (!manifest.scenarioIds.includes(input.scenarioId)) fail("enterprise_conformance_scenario_invalid", "Scenario is outside the manifest.");
  const definition = ENTERPRISE_PLATFORM_CONFORMANCE_PACKS[manifest.family].find((item) => item.scenarioId === input.scenarioId);
  const evidence = {
    schemaVersion: "enterprise-platform-conformance-evidence/v1",
    tenantId: manifest.tenantId,
    campaignId: manifest.campaignId,
    family: manifest.family,
    providerProfileRef: manifest.providerProfileRef,
    scenarioId: definition.scenarioId,
    scenarioClass: definition.scenarioClass,
    executionMode: "simulated",
    commerciallyLive: false,
    logicalTime: manifest.logicalTime,
    expectedDisposition: definition.expectedDisposition,
    observedDisposition: input.observedDisposition ?? definition.expectedDisposition,
    expectedSafetyState: definition.safetyState,
    observedSafetyState: input.observedSafetyState ?? definition.safetyState,
    manifestChecksumSha256: manifest.manifestChecksumSha256
  };
  const passed = evidence.observedDisposition === evidence.expectedDisposition && evidence.observedSafetyState === evidence.expectedSafetyState;
  const result = { ...evidence, passed };
  return Object.freeze({ ...result, evidenceChecksumSha256: checksum(result) });
}

export function assessEnterprisePlatformSimulation(manifest = {}, suppliedResults = []) {
  verifyManifest(manifest);
  const results = Array.isArray(suppliedResults) ? suppliedResults : [];
  const resultByScenario = new Map();
  const invalidScenarioIds = [];
  for (const result of results) {
    const scenarioId = result?.scenarioId ?? null;
    if (!manifest.scenarioIds.includes(scenarioId) || !verifyEvidence(manifest, result) || resultByScenario.has(scenarioId)) {
      invalidScenarioIds.push(scenarioId);
      continue;
    }
    resultByScenario.set(scenarioId, result);
  }
  const missingScenarioIds = manifest.scenarioIds.filter((scenarioId) => !resultByScenario.has(scenarioId));
  const failedScenarioIds = manifest.scenarioIds.filter((scenarioId) => resultByScenario.has(scenarioId) && !resultByScenario.get(scenarioId).passed);
  const status = invalidScenarioIds.length === 0 && missingScenarioIds.length === 0 && failedScenarioIds.length === 0 ? "simulator_certified" : "blocked";
  const assessment = {
    schemaVersion: "enterprise-platform-conformance-assessment/v1",
    tenantId: manifest.tenantId,
    campaignId: manifest.campaignId,
    family: manifest.family,
    executionMode: "simulated",
    commerciallyLive: false,
    status,
    manifestChecksumSha256: manifest.manifestChecksumSha256,
    resultChecksums: manifest.scenarioIds.map((scenarioId) => resultByScenario.get(scenarioId)?.evidenceChecksumSha256 ?? null),
    missingScenarioIds,
    failedScenarioIds,
    invalidScenarioIds
  };
  return Object.freeze({ ...assessment, assessmentChecksumSha256: checksum(assessment) });
}

function verifyManifest(manifest) {
  if (!manifest || manifest.executionMode !== "simulated" || manifest.commerciallyLive !== false) fail("enterprise_conformance_manifest_invalid", "A simulator-only manifest is required.");
  assertFamily(manifest.family);
  for (const field of ["tenantId", "campaignId", "providerProfileRef"]) required(manifest[field], field);
  if (manifest.schemaVersion !== "enterprise-platform-conformance/v1" || manifest.certificationScope !== "LoanOS contract and deterministic emulator only") fail("enterprise_conformance_manifest_invalid", "Manifest schema or certification scope is invalid.");
  const { manifestChecksumSha256, ...unsigned } = manifest;
  if (checksum(unsigned) !== manifestChecksumSha256) fail("enterprise_conformance_manifest_tampered", "Manifest checksum validation failed.");
  const assessment = assessEnterprisePlatformConformancePack(manifest.family);
  if (manifest.packChecksumSha256 !== assessment.packChecksumSha256) fail("enterprise_conformance_pack_changed", "Manifest pack checksum no longer matches the canonical pack.");
  const expectedScenarioIds = ENTERPRISE_PLATFORM_CONFORMANCE_PACKS[manifest.family].map((item) => item.scenarioId);
  if (!Array.isArray(manifest.scenarioIds) || JSON.stringify(manifest.scenarioIds) !== JSON.stringify(expectedScenarioIds)) fail("enterprise_conformance_manifest_incomplete", "Manifest must contain the complete canonical scenario pack in order.");
  if (normalizeLogicalTime(manifest.logicalTime) !== manifest.logicalTime) fail("enterprise_conformance_manifest_invalid", "Manifest logical time is not canonical.");
}

function verifyEvidence(manifest, result) {
  if (!result || result.tenantId !== manifest.tenantId || result.campaignId !== manifest.campaignId || result.family !== manifest.family || result.executionMode !== "simulated" || result.commerciallyLive !== false || result.manifestChecksumSha256 !== manifest.manifestChecksumSha256) return false;
  const { evidenceChecksumSha256, ...unsigned } = result;
  if (checksum(unsigned) !== evidenceChecksumSha256) return false;
  const definition = ENTERPRISE_PLATFORM_CONFORMANCE_PACKS[manifest.family].find((item) => item.scenarioId === result.scenarioId);
  if (!definition) return false;
  const expectedPass = result.observedDisposition === definition.expectedDisposition && result.observedSafetyState === definition.safetyState;
  return result.schemaVersion === "enterprise-platform-conformance-evidence/v1"
    && result.providerProfileRef === manifest.providerProfileRef
    && result.logicalTime === manifest.logicalTime
    && result.scenarioClass === definition.scenarioClass
    && result.expectedDisposition === definition.expectedDisposition
    && result.expectedSafetyState === definition.safetyState
    && result.passed === expectedPass;
}

function canonicalPack(entries) {
  return entries.map((entry) => ({
    scenarioId: entry?.scenarioId ?? null,
    family: entry?.family ?? null,
    name: entry?.name ?? null,
    scenarioClass: entry?.scenarioClass ?? null,
    expectedDisposition: entry?.expectedDisposition ?? null,
    safetyState: entry?.safetyState ?? null,
    required: entry?.required === true,
    executionMode: entry?.executionMode ?? null,
    commerciallyLive: entry?.commerciallyLive ?? null
  })).sort((left, right) => String(left.scenarioId).localeCompare(String(right.scenarioId)));
}

function normalizeLogicalTime(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail("enterprise_conformance_input_invalid", "logicalTime must be an ISO date-time.");
  return new Date(parsed).toISOString();
}

function assertFamily(family) {
  if (!ENTERPRISE_PLATFORM_FAMILIES.includes(family)) fail("enterprise_conformance_family_invalid", "Unsupported enterprise platform family.");
}

function required(value, field) {
  if (typeof value !== "string" || !value.trim()) fail("enterprise_conformance_input_invalid", `${field} is required.`);
}

function checksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}
