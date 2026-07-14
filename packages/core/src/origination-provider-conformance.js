import { createHash } from "node:crypto";

export const ORIGINATION_PROVIDER_FAMILIES = Object.freeze([
  "identity",
  "ckycrr",
  "vcip",
  "bureau",
  "account_aggregator",
  "bank_account",
  "esign",
  "document_intelligence"
]);

export const REQUIRED_CONFORMANCE_CLASSES = Object.freeze([
  "success",
  "validation_reject",
  "business_reject",
  "delayed",
  "timeout",
  "duplicate",
  "correction",
  "tamper",
  "outage"
]);

const scenarios = (family, definitions) => Object.freeze(definitions.map(([name, scenarioClass, terminalStatus, asynchronous = false]) => Object.freeze({
  scenarioId: `${family}.${name}`,
  family,
  scenarioClass,
  terminalStatus,
  asynchronous
})));

export const ORIGINATION_PROVIDER_CONFORMANCE_PACKS = Object.freeze({
  identity: scenarios("identity", [
    ["verified", "success", "verified"], ["invalid_pan", "validation_reject", "rejected"], ["name_mismatch", "business_reject", "referred"], ["source_delay", "delayed", "verified", true], ["source_timeout", "timeout", "referred"], ["duplicate_request", "duplicate", "verified"], ["source_correction", "correction", "referred", true], ["response_tamper", "tamper", "rejected", true], ["source_outage", "outage", "referred"]
  ]),
  ckycrr: scenarios("ckycrr", [
    ["accepted", "success", "accepted", true], ["schema_reject", "validation_reject", "rejected", true], ["probable_match", "business_reject", "probable_match", true], ["delayed_ack", "delayed", "accepted", true], ["transport_timeout", "timeout", "repair_required"], ["duplicate_ack", "duplicate", "accepted", true], ["record_correction", "correction", "accepted", true], ["signature_tamper", "tamper", "repair_required", true], ["registry_outage", "outage", "repair_required"]
  ]),
  vcip: scenarios("vcip", [
    ["verified", "success", "verified", true], ["poor_quality", "validation_reject", "referred", true], ["spoof_detected", "business_reject", "rejected", true], ["analysis_delay", "delayed", "verified", true], ["session_timeout", "timeout", "referred"], ["duplicate_result", "duplicate", "verified", true], ["analyst_correction", "correction", "referred", true], ["recording_tamper", "tamper", "rejected", true], ["provider_outage", "outage", "referred"]
  ]),
  bureau: scenarios("bureau", [
    ["report_available", "success", "available"], ["invalid_enquiry", "validation_reject", "rejected"], ["no_hit", "business_reject", "no_hit"], ["report_delay", "delayed", "available", true], ["enquiry_timeout", "timeout", "referred"], ["duplicate_enquiry", "duplicate", "available"], ["dispute_correction", "correction", "available", true], ["report_tamper", "tamper", "rejected", true], ["bureau_outage", "outage", "referred"]
  ]),
  account_aggregator: scenarios("account_aggregator", [
    ["fi_delivered", "success", "delivered", true], ["invalid_consent", "validation_reject", "rejected"], ["partial_fip_failure", "business_reject", "partial", true], ["fi_delay", "delayed", "delivered", true], ["session_timeout", "timeout", "referred"], ["duplicate_notification", "duplicate", "delivered", true], ["fip_correction", "correction", "delivered", true], ["payload_tamper", "tamper", "rejected", true], ["aa_outage", "outage", "referred"]
  ]),
  bank_account: scenarios("bank_account", [
    ["verified", "success", "verified"], ["invalid_ifsc", "validation_reject", "rejected"], ["name_mismatch", "business_reject", "referred"], ["penny_drop_delay", "delayed", "verified", true], ["verification_timeout", "timeout", "referred"], ["duplicate_result", "duplicate", "verified", true], ["later_reversal", "correction", "reversed", true], ["callback_tamper", "tamper", "rejected", true], ["bank_outage", "outage", "referred"]
  ]),
  esign: scenarios("esign", [
    ["signed", "success", "signed", true], ["invalid_otp", "validation_reject", "rejected"], ["certificate_rejected", "business_reject", "rejected", true], ["signing_delay", "delayed", "signed", true], ["otp_timeout", "timeout", "expired"], ["duplicate_callback", "duplicate", "signed", true], ["certificate_revoked", "correction", "referred", true], ["pdf_tamper", "tamper", "rejected", true], ["esp_outage", "outage", "referred"]
  ]),
  document_intelligence: scenarios("document_intelligence", [
    ["extracted", "success", "extracted"], ["unsupported_document", "validation_reject", "rejected"], ["tamper_detected", "business_reject", "referred"], ["manual_review_delay", "delayed", "extracted", true], ["processing_timeout", "timeout", "referred"], ["duplicate_result", "duplicate", "extracted", true], ["corrected_extraction", "correction", "extracted", true], ["manifest_tamper", "tamper", "rejected", true], ["service_outage", "outage", "referred"]
  ])
});

export function assessOriginationConformancePack(family, suppliedScenarios = ORIGINATION_PROVIDER_CONFORMANCE_PACKS[family]) {
  if (!ORIGINATION_PROVIDER_FAMILIES.includes(family)) throw new Error(`Unsupported origination provider family: ${family}.`);
  const entries = Array.isArray(suppliedScenarios) ? suppliedScenarios : [];
  const scenarioIds = new Set();
  const classes = new Set();
  const findings = [];
  for (const entry of entries) {
    if (!entry?.scenarioId || entry.family !== family || !REQUIRED_CONFORMANCE_CLASSES.includes(entry.scenarioClass)) {
      findings.push({ code: "invalid_scenario", scenarioId: entry?.scenarioId ?? null });
      continue;
    }
    if (scenarioIds.has(entry.scenarioId)) findings.push({ code: "duplicate_scenario_id", scenarioId: entry.scenarioId });
    scenarioIds.add(entry.scenarioId);
    classes.add(entry.scenarioClass);
  }
  for (const scenarioClass of REQUIRED_CONFORMANCE_CLASSES) {
    if (!classes.has(scenarioClass)) findings.push({ code: "missing_scenario_class", scenarioClass });
  }
  const canonical = entries.map((entry) => ({ scenarioId: entry.scenarioId, family: entry.family, scenarioClass: entry.scenarioClass, terminalStatus: entry.terminalStatus, asynchronous: Boolean(entry.asynchronous) })).sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
  return {
    family,
    status: findings.length === 0 ? "complete" : "blocked",
    scenarioCount: entries.length,
    coveredClasses: [...classes].sort(),
    packChecksumSha256: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    findings
  };
}

export function assessOriginationConformanceSuite(packs = ORIGINATION_PROVIDER_CONFORMANCE_PACKS) {
  const assessments = ORIGINATION_PROVIDER_FAMILIES.map((family) => assessOriginationConformancePack(family, packs[family]));
  return {
    status: assessments.every((assessment) => assessment.status === "complete") ? "complete" : "blocked",
    familyCount: assessments.length,
    scenarioCount: assessments.reduce((total, assessment) => total + assessment.scenarioCount, 0),
    assessments
  };
}

export function buildOriginationSimulatorScenarios(family) {
  const assessment = assessOriginationConformancePack(family);
  if (assessment.status !== "complete") throw new Error(`Origination provider conformance pack is incomplete for ${family}.`);
  return Object.fromEntries(ORIGINATION_PROVIDER_CONFORMANCE_PACKS[family].map((scenario) => {
    const outcome = scenario.scenarioClass === "timeout" ? "timeout" : scenario.scenarioClass === "outage" ? "failure" : "success";
    const callback = scenario.asynchronous ? {
      eventType: `${family}.${scenario.terminalStatus}`,
      status: scenario.terminalStatus,
      delayMs: scenario.scenarioClass === "delayed" ? 60_000 : 0,
      duplicate: scenario.scenarioClass === "duplicate",
      tamper: scenario.scenarioClass === "tamper",
      payload: { scenarioId: scenario.scenarioId, scenarioClass: scenario.scenarioClass }
    } : null;
    return [scenario.scenarioId, {
      outcome,
      responseStatus: scenario.terminalStatus,
      responseCode: scenario.scenarioClass,
      response: { scenarioId: scenario.scenarioId, scenarioClass: scenario.scenarioClass },
      callback: Boolean(callback),
      callbacks: callback ? [callback] : []
    }];
  }));
}
