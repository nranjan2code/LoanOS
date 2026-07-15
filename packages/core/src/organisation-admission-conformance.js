import { createHash } from "node:crypto";

export const ORGANISATION_ADMISSION_SOURCE_VERSION = "organisation-admission-conformance/2026-07-15.v1";

export const ORGANISATION_ADMISSION_INTEGRATIONS = Object.freeze([
  Object.freeze({ integrationId: "INT-ADM-01", family: "contact_delivery", purpose: "organisation_contact_and_invitation", operation: "deliver_invitation" }),
  Object.freeze({ integrationId: "INT-ADM-02", family: "legal_tax_identity", purpose: "organisation_legal_and_tax_verification", operation: "verify_legal_tax_identity" }),
  Object.freeze({ integrationId: "INT-ADM-03", family: "regulated_entity_authority", purpose: "regulated_entity_authority_verification", operation: "verify_regulated_entity_authority" }),
  Object.freeze({ integrationId: "INT-ADM-04", family: "representative_signature", purpose: "representative_authority_and_signature", operation: "verify_representative" }),
  Object.freeze({ integrationId: "INT-ADM-05", family: "corporate_domain", purpose: "corporate_domain_and_contact_assurance", operation: "verify_corporate_domain" }),
  Object.freeze({ integrationId: "INT-ADM-06", family: "abuse_device", purpose: "signup_abuse_and_device_assurance", operation: "assess_signup_abuse" }),
  Object.freeze({ integrationId: "INT-ADM-07", family: "contract_due_diligence", purpose: "contracting_and_outsourcing_due_diligence", operation: "verify_contracting_readiness" }),
  Object.freeze({ integrationId: "INT-ADM-08", family: "billing", purpose: "subscription_billing_and_tax", operation: "verify_billing_readiness" }),
  Object.freeze({ integrationId: "INT-ADM-09", family: "infrastructure_provisioning", purpose: "tenant_infrastructure_provisioning", operation: "provision_tenant_infrastructure" }),
  Object.freeze({ integrationId: "INT-ADM-10", family: "workforce_federation", purpose: "workforce_federation_and_reverification", operation: "verify_workforce_federation" })
]);

export const REQUIRED_ORGANISATION_ADMISSION_CLASSES = Object.freeze([
  "success",
  "validation_reject",
  "business_reject",
  "delayed",
  "timeout",
  "duplicate",
  "replay_conflict",
  "cross_tenant",
  "purpose_mismatch",
  "stale_source",
  "tamper",
  "outage"
]);

const FAMILY_REQUIRED_CLASSES = Object.freeze({
  "INT-ADM-01": Object.freeze(["invite_expired", "bounce", "complaint", "suppression"]),
  "INT-ADM-02": Object.freeze(["identity_mismatch", "registry_status_change"]),
  "INT-ADM-03": Object.freeze(["permission_mismatch", "licence_revoked"]),
  "INT-ADM-04": Object.freeze(["authority_expired", "certificate_revoked", "revocation_source_unavailable"]),
  "INT-ADM-05": Object.freeze(["dns_challenge_mismatch", "domain_reputation_reject", "official_contact_mismatch"]),
  "INT-ADM-06": Object.freeze(["bot_detected", "velocity_exceeded", "device_reuse", "confirmed_abuse"]),
  "INT-ADM-07": Object.freeze(["contract_version_superseded", "due_diligence_incomplete", "subprocessor_change"]),
  "INT-ADM-08": Object.freeze(["tax_validation_failure", "payment_failure", "meter_correction", "dunning"]),
  "INT-ADM-09": Object.freeze(["partial_failure", "compensation_success", "compensation_failure", "rollback_failure"]),
  "INT-ADM-10": Object.freeze(["key_rollover", "reverification_failure", "deprovision_failure", "authority_drift"])
});

const BASE_SCENARIO_NAMES = Object.freeze({
  "INT-ADM-01": Object.freeze({ success: "invitation_delivered", validation_reject: "invalid_contact", business_reject: "delivery_policy_reject", delayed: "delivery_delayed", timeout: "delivery_timeout", duplicate: "duplicate_delivery_callback", replay_conflict: "delivery_idempotency_conflict", cross_tenant: "delivery_callback_cross_tenant", purpose_mismatch: "template_purpose_mismatch", stale_source: "template_version_stale", tamper: "delivery_signature_tamper", outage: "delivery_provider_outage" }),
  "INT-ADM-02": Object.freeze({ success: "legal_tax_identity_verified", validation_reject: "invalid_legal_identifier", business_reject: "inactive_legal_entity", delayed: "registry_response_delayed", timeout: "registry_timeout", duplicate: "duplicate_registry_result", replay_conflict: "registry_idempotency_conflict", cross_tenant: "registry_result_cross_tenant", purpose_mismatch: "registry_purpose_mismatch", stale_source: "registry_extract_stale", tamper: "registry_checksum_tamper", outage: "registry_outage" }),
  "INT-ADM-03": Object.freeze({ success: "regulated_authority_verified", validation_reject: "invalid_authority_identifier", business_reject: "authority_not_established", delayed: "authority_source_delayed", timeout: "authority_source_timeout", duplicate: "duplicate_authority_result", replay_conflict: "authority_idempotency_conflict", cross_tenant: "authority_result_cross_tenant", purpose_mismatch: "authority_purpose_mismatch", stale_source: "authority_list_stale", tamper: "authority_source_tamper", outage: "authority_source_outage" }),
  "INT-ADM-04": Object.freeze({ success: "representative_authorized", validation_reject: "invalid_representative_identifier", business_reject: "representative_not_authorized", delayed: "signature_validation_delayed", timeout: "signature_validation_timeout", duplicate: "duplicate_signature_result", replay_conflict: "signature_idempotency_conflict", cross_tenant: "signature_result_cross_tenant", purpose_mismatch: "signature_purpose_mismatch", stale_source: "authority_evidence_stale", tamper: "signed_document_tamper", outage: "signature_provider_outage" }),
  "INT-ADM-05": Object.freeze({ success: "corporate_domain_verified", validation_reject: "invalid_domain", business_reject: "domain_not_controlled", delayed: "dns_propagation_delayed", timeout: "dns_lookup_timeout", duplicate: "duplicate_dns_result", replay_conflict: "domain_idempotency_conflict", cross_tenant: "domain_result_cross_tenant", purpose_mismatch: "domain_purpose_mismatch", stale_source: "rdap_evidence_stale", tamper: "dns_evidence_tamper", outage: "dns_rdap_outage" }),
  "INT-ADM-06": Object.freeze({ success: "signup_risk_cleared", validation_reject: "invalid_risk_evidence", business_reject: "signup_risk_rejected", delayed: "risk_assessment_delayed", timeout: "risk_assessment_timeout", duplicate: "duplicate_risk_result", replay_conflict: "risk_idempotency_conflict", cross_tenant: "risk_result_cross_tenant", purpose_mismatch: "risk_purpose_mismatch", stale_source: "risk_signal_stale", tamper: "device_evidence_tamper", outage: "risk_provider_outage" }),
  "INT-ADM-07": Object.freeze({ success: "contract_due_diligence_complete", validation_reject: "invalid_contract_manifest", business_reject: "contract_terms_rejected", delayed: "due_diligence_delayed", timeout: "due_diligence_timeout", duplicate: "duplicate_contract_result", replay_conflict: "contract_idempotency_conflict", cross_tenant: "contract_result_cross_tenant", purpose_mismatch: "contract_purpose_mismatch", stale_source: "contract_version_stale", tamper: "contract_manifest_tamper", outage: "grc_dms_outage" }),
  "INT-ADM-08": Object.freeze({ success: "subscription_billing_ready", validation_reject: "invalid_billing_profile", business_reject: "subscription_not_approved", delayed: "invoice_generation_delayed", timeout: "billing_provider_timeout", duplicate: "duplicate_billing_event", replay_conflict: "billing_idempotency_conflict", cross_tenant: "billing_event_cross_tenant", purpose_mismatch: "billing_purpose_mismatch", stale_source: "price_plan_stale", tamper: "invoice_payload_tamper", outage: "billing_provider_outage" }),
  "INT-ADM-09": Object.freeze({ success: "tenant_infrastructure_provisioned", validation_reject: "invalid_topology_manifest", business_reject: "infrastructure_policy_reject", delayed: "provisioning_delayed", timeout: "provisioning_timeout", duplicate: "duplicate_provisioning_event", replay_conflict: "provisioning_idempotency_conflict", cross_tenant: "resource_cross_tenant", purpose_mismatch: "kms_purpose_mismatch", stale_source: "deployment_manifest_stale", tamper: "provisioning_evidence_tamper", outage: "cloud_control_outage" }),
  "INT-ADM-10": Object.freeze({ success: "workforce_federation_verified", validation_reject: "invalid_federation_metadata", business_reject: "federation_domain_mismatch", delayed: "directory_sync_delayed", timeout: "federation_provider_timeout", duplicate: "duplicate_directory_event", replay_conflict: "directory_idempotency_conflict", cross_tenant: "directory_event_cross_tenant", purpose_mismatch: "federation_purpose_mismatch", stale_source: "federation_metadata_stale", tamper: "federation_assertion_tamper", outage: "federation_provider_outage" })
});

const EXTRA_SCENARIO_NAMES = Object.freeze({
  "INT-ADM-01": Object.freeze({ invite_expired: "invitation_expired", bounce: "email_hard_bounce", complaint: "recipient_complaint", suppression: "destination_suppressed" }),
  "INT-ADM-02": Object.freeze({ identity_mismatch: "pan_gstin_cin_mismatch", registry_status_change: "legal_entity_status_changed" }),
  "INT-ADM-03": Object.freeze({ permission_mismatch: "activity_not_permitted", licence_revoked: "licence_cancelled_or_revoked" }),
  "INT-ADM-04": Object.freeze({ authority_expired: "board_resolution_expired", certificate_revoked: "signing_certificate_revoked", revocation_source_unavailable: "crl_ocsp_unavailable" }),
  "INT-ADM-05": Object.freeze({ dns_challenge_mismatch: "dns_txt_challenge_mismatch", domain_reputation_reject: "new_or_reputation_rejected_domain", official_contact_mismatch: "official_contact_not_corroborated" }),
  "INT-ADM-06": Object.freeze({ bot_detected: "automation_or_bot_detected", velocity_exceeded: "ip_phone_email_velocity_exceeded", device_reuse: "device_reused_across_organisations", confirmed_abuse: "confirmed_abuse_feedback" }),
  "INT-ADM-07": Object.freeze({ contract_version_superseded: "contract_version_superseded", due_diligence_incomplete: "subprocessor_bcp_dr_exit_incomplete", subprocessor_change: "unapproved_subprocessor_change" }),
  "INT-ADM-08": Object.freeze({ tax_validation_failure: "gst_profile_invalid", payment_failure: "subscription_payment_failed", meter_correction: "usage_meter_corrected", dunning: "invoice_entered_dunning" }),
  "INT-ADM-09": Object.freeze({ partial_failure: "partial_resource_provisioning_failure", compensation_success: "partial_failure_compensated", compensation_failure: "compensation_step_failed", rollback_failure: "rollback_incomplete" }),
  "INT-ADM-10": Object.freeze({ key_rollover: "identity_provider_key_rollover", reverification_failure: "licence_domain_representative_drift", deprovision_failure: "leaver_deprovision_failed", authority_drift: "regulated_authority_status_drift" })
});

function expectedDisposition(scenarioClass) {
  if (["success", "duplicate", "compensation_success", "key_rollover", "meter_correction"].includes(scenarioClass)) return "accept";
  if (scenarioClass === "delayed") return "pending";
  return "fail_closed";
}

function makeScenario(integration, name, scenarioClass) {
  const canonical = {
    scenarioId: `${integration.integrationId}.${integration.family}.${name}`,
    integrationId: integration.integrationId,
    family: integration.family,
    purpose: integration.purpose,
    operation: integration.operation,
    name,
    scenarioClass,
    expectedDisposition: expectedDisposition(scenarioClass),
    sourceVersion: ORGANISATION_ADMISSION_SOURCE_VERSION,
    required: true,
    executionMode: "simulated",
    simulated: true,
    commerciallyLive: false
  };
  return Object.freeze({ ...canonical, sourceChecksumSha256: checksum(canonical) });
}

function buildPack(integration) {
  const base = REQUIRED_ORGANISATION_ADMISSION_CLASSES.map((scenarioClass) => makeScenario(integration, BASE_SCENARIO_NAMES[integration.integrationId][scenarioClass], scenarioClass));
  const extras = FAMILY_REQUIRED_CLASSES[integration.integrationId].map((scenarioClass) => makeScenario(integration, EXTRA_SCENARIO_NAMES[integration.integrationId][scenarioClass], scenarioClass));
  return Object.freeze([...base, ...extras]);
}

export const ORGANISATION_ADMISSION_CONFORMANCE_PACKS = Object.freeze(Object.fromEntries(
  ORGANISATION_ADMISSION_INTEGRATIONS.map((integration) => [integration.integrationId, buildPack(integration)])
));

export class OrganisationAdmissionConformanceSimulator {
  constructor(config = {}) {
    required(config.tenantId, "tenantId");
    required(config.purpose, "purpose");
    required(config.seed, "seed");
    if (config.executionMode && config.executionMode !== "simulated") fail("admission_conformance_live_claim_forbidden", "The admission conformance harness can execute only simulated contracts.");
    if (config.commerciallyLive === true) fail("admission_conformance_live_claim_forbidden", "Simulator evidence cannot be represented as commercially live.");
    this.tenantId = config.tenantId;
    this.purpose = config.purpose;
    this.seed = config.seed;
    this.executionMode = "simulated";
    this.commerciallyLive = false;
    this.replays = new Map();
  }

  execute(input = {}) {
    required(input.tenantId, "tenantId");
    required(input.purpose, "purpose");
    required(input.scenarioId, "scenarioId");
    required(input.idempotencyKey, "idempotencyKey");
    required(input.sourceVersion, "sourceVersion");
    required(input.sourceChecksumSha256, "sourceChecksumSha256");
    if (input.tenantId !== this.tenantId) fail("admission_conformance_tenant_mismatch", "Admission simulation is isolated to one tenant.");
    if (input.purpose !== this.purpose) fail("admission_conformance_purpose_mismatch", "Admission simulation is isolated to one declared purpose.");
    const scenario = scenarioById(input.scenarioId);
    if (!scenario || scenario.purpose !== this.purpose) fail("admission_conformance_scenario_invalid", "Scenario is outside this simulator purpose.");
    if (input.sourceVersion !== scenario.sourceVersion || input.sourceChecksumSha256 !== scenario.sourceChecksumSha256) fail("admission_conformance_source_mismatch", "Scenario source version or checksum does not match the certified catalogue.");
    const payloadChecksumSha256 = checksum(input.payload ?? {});
    const replayKey = `${this.tenantId}:${this.purpose}:${input.idempotencyKey}`;
    const previous = this.replays.get(replayKey);
    if (previous) {
      if (previous.scenarioId !== scenario.scenarioId || previous.payloadChecksumSha256 !== payloadChecksumSha256) fail("admission_conformance_replay_conflict", "Idempotency key was replayed with different scenario or payload content.");
      return clone(previous.result);
    }
    const evidence = {
      evidenceId: `adm_sim_${checksum(`${this.seed}:${this.tenantId}:${this.purpose}:${input.idempotencyKey}`).slice(0, 24)}`,
      tenantId: this.tenantId,
      purpose: this.purpose,
      integrationId: scenario.integrationId,
      family: scenario.family,
      operation: scenario.operation,
      scenarioId: scenario.scenarioId,
      scenarioClass: scenario.scenarioClass,
      expectedDisposition: scenario.expectedDisposition,
      observedDisposition: scenario.expectedDisposition,
      payloadChecksumSha256,
      sourceVersion: scenario.sourceVersion,
      sourceChecksumSha256: scenario.sourceChecksumSha256,
      executionMode: "simulated",
      simulated: true,
      commerciallyLive: false,
      passed: true
    };
    const result = Object.freeze({ ...evidence, evidenceChecksumSha256: checksum(evidence) });
    this.replays.set(replayKey, { scenarioId: scenario.scenarioId, payloadChecksumSha256, result });
    return clone(result);
  }
}

export function assessOrganisationAdmissionConformancePack(integrationId, suppliedScenarios = ORGANISATION_ADMISSION_CONFORMANCE_PACKS[integrationId]) {
  const integration = integrationFor(integrationId);
  const entries = Array.isArray(suppliedScenarios) ? suppliedScenarios : [];
  const requiredClasses = [...REQUIRED_ORGANISATION_ADMISSION_CLASSES, ...FAMILY_REQUIRED_CLASSES[integrationId]];
  const certifiedScenarios = new Map(ORGANISATION_ADMISSION_CONFORMANCE_PACKS[integrationId].map((entry) => [entry.scenarioId, entry]));
  const coveredClasses = new Set();
  const scenarioIds = new Set();
  const findings = [];
  for (const entry of entries) {
    if (!entry?.scenarioId || entry.integrationId !== integrationId || entry.family !== integration.family || entry.purpose !== integration.purpose) {
      findings.push({ code: "invalid_scenario_scope", scenarioId: entry?.scenarioId ?? null });
      continue;
    }
    if (scenarioIds.has(entry.scenarioId)) findings.push({ code: "duplicate_scenario_id", scenarioId: entry.scenarioId });
    scenarioIds.add(entry.scenarioId);
    coveredClasses.add(entry.scenarioClass);
    const canonical = { ...entry };
    delete canonical.sourceChecksumSha256;
    const certified = certifiedScenarios.get(entry.scenarioId);
    if (!certified) findings.push({ code: "unexpected_scenario_id", scenarioId: entry.scenarioId });
    if (!requiredClasses.includes(entry.scenarioClass)) findings.push({ code: "unexpected_scenario_class", scenarioClass: entry.scenarioClass, scenarioId: entry.scenarioId });
    if (entry.sourceVersion !== ORGANISATION_ADMISSION_SOURCE_VERSION || entry.sourceChecksumSha256 !== checksum(canonical) || entry.sourceChecksumSha256 !== certified?.sourceChecksumSha256) findings.push({ code: "source_checksum_mismatch", scenarioId: entry.scenarioId });
    if (entry.executionMode !== "simulated" || entry.simulated !== true || entry.commerciallyLive !== false) findings.push({ code: "live_claim_forbidden", scenarioId: entry.scenarioId });
  }
  for (const scenarioClass of requiredClasses) if (!coveredClasses.has(scenarioClass)) findings.push({ code: "missing_scenario_class", scenarioClass });
  for (const scenarioId of certifiedScenarios.keys()) if (!scenarioIds.has(scenarioId)) findings.push({ code: "missing_scenario_id", scenarioId });
  const manifest = entries.map((entry) => ({ scenarioId: entry?.scenarioId ?? null, scenarioClass: entry?.scenarioClass ?? null, sourceChecksumSha256: entry?.sourceChecksumSha256 ?? null })).sort((a, b) => String(a.scenarioId).localeCompare(String(b.scenarioId)));
  return Object.freeze({
    integrationId,
    family: integration.family,
    purpose: integration.purpose,
    status: findings.length === 0 ? "complete" : "blocked",
    scenarioCount: entries.length,
    requiredClasses: Object.freeze(requiredClasses),
    coveredClasses: Object.freeze([...coveredClasses].sort()),
    sourceVersion: ORGANISATION_ADMISSION_SOURCE_VERSION,
    packChecksumSha256: checksum(manifest),
    executionMode: "simulated",
    commerciallyLive: false,
    findings: Object.freeze(findings)
  });
}

export function assessOrganisationAdmissionConformanceSuite(packs = ORGANISATION_ADMISSION_CONFORMANCE_PACKS) {
  const assessments = ORGANISATION_ADMISSION_INTEGRATIONS.map((integration) => assessOrganisationAdmissionConformancePack(integration.integrationId, packs[integration.integrationId]));
  return Object.freeze({
    status: assessments.every((assessment) => assessment.status === "complete") ? "complete" : "blocked",
    integrationCount: assessments.length,
    scenarioCount: assessments.reduce((total, assessment) => total + assessment.scenarioCount, 0),
    sourceVersion: ORGANISATION_ADMISSION_SOURCE_VERSION,
    executionMode: "simulated",
    simulated: true,
    commerciallyLive: false,
    assessments: Object.freeze(assessments)
  });
}

export function buildOrganisationAdmissionSimulatorScenarios(integrationId = null) {
  const integrations = integrationId ? [integrationFor(integrationId)] : ORGANISATION_ADMISSION_INTEGRATIONS;
  for (const integration of integrations) if (assessOrganisationAdmissionConformancePack(integration.integrationId).status !== "complete") fail("admission_conformance_pack_incomplete", `Conformance pack is incomplete for ${integration.integrationId}.`);
  return Object.fromEntries(integrations.flatMap((integration) => ORGANISATION_ADMISSION_CONFORMANCE_PACKS[integration.integrationId].map((scenario) => {
    const outcome = scenario.scenarioClass === "timeout" ? "timeout" : scenario.expectedDisposition === "fail_closed" ? "failure" : "success";
    const asynchronous = ["delayed", "duplicate", "tamper", "correction", "partial_failure", "compensation_success", "compensation_failure", "rollback_failure", "key_rollover", "deprovision_failure", "registry_status_change", "licence_revoked", "authority_drift"].includes(scenario.scenarioClass);
    const callback = asynchronous ? {
      eventType: `${scenario.family}.${scenario.expectedDisposition}`,
      status: scenario.expectedDisposition,
      delayMs: scenario.scenarioClass === "delayed" ? 60_000 : 0,
      duplicate: scenario.scenarioClass === "duplicate",
      tamper: scenario.scenarioClass === "tamper",
      payload: { integrationId: scenario.integrationId, purpose: scenario.purpose, scenarioId: scenario.scenarioId, scenarioClass: scenario.scenarioClass, sourceVersion: scenario.sourceVersion, sourceChecksumSha256: scenario.sourceChecksumSha256, simulated: true, commerciallyLive: false }
    } : null;
    return [scenario.scenarioId, {
      outcome,
      responseStatus: scenario.expectedDisposition,
      responseCode: scenario.scenarioClass,
      response: { integrationId: scenario.integrationId, purpose: scenario.purpose, scenarioId: scenario.scenarioId, scenarioClass: scenario.scenarioClass, sourceVersion: scenario.sourceVersion, sourceChecksumSha256: scenario.sourceChecksumSha256, executionMode: "simulated", simulated: true, commerciallyLive: false },
      callback: Boolean(callback),
      callbacks: callback ? [callback] : []
    }];
  })));
}

export function createOrganisationAdmissionConformanceSimulator(config) {
  return new OrganisationAdmissionConformanceSimulator(config);
}

function scenarioById(scenarioId) {
  for (const pack of Object.values(ORGANISATION_ADMISSION_CONFORMANCE_PACKS)) {
    const scenario = pack.find((entry) => entry.scenarioId === scenarioId);
    if (scenario) return scenario;
  }
  return null;
}

function integrationFor(integrationId) {
  const integration = ORGANISATION_ADMISSION_INTEGRATIONS.find((entry) => entry.integrationId === integrationId);
  if (!integration) fail("admission_conformance_integration_invalid", `Unsupported organisation-admission integration: ${integrationId}.`);
  return integration;
}

function checksum(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function required(value, field) {
  if (typeof value !== "string" || !value.trim()) fail("admission_conformance_input_invalid", `${field} is required.`);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}
