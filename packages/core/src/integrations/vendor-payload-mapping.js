import { createHash } from "node:crypto";

export const VENDOR_UAT_SCENARIOS = Object.freeze(["success", "validation_reject", "business_reject", "timeout", "duplicate", "out_of_order", "partial", "tamper", "expiry", "correction", "reconciliation", "disaster_recovery", "exit_export"]);
export const VENDOR_MAPPING_TRANSFORMS = Object.freeze(["copy", "trim", "uppercase", "lowercase", "date_iso", "boolean_string", "paise_string"]);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const text = (value, field) => { if (typeof value !== "string" || !value.trim()) fail("vendor_mapping_invalid", `${field} is required.`); return value.trim(); };
const checksum = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const shaPattern = /^[a-f0-9]{64}$/;
const pathPattern = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const set = (object, path, value) => { const parts = path.split("."); let cursor = object; for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {}; cursor[parts.at(-1)] = value; };
const approve = (input) => { text(input.proposedBy, "proposedBy"); text(input.approvedBy, "approvedBy"); text(input.approvalRef, "approvalRef"); if (input.proposedBy === input.approvedBy) fail("vendor_mapping_four_eyes", "Independent approval is required."); };

function transform(value, name) {
  if (name === "copy") return value;
  if (name === "trim") return typeof value === "string" ? value.trim() : fail("vendor_mapping_transform_invalid", "trim requires a string.");
  if (name === "uppercase" || name === "lowercase") return typeof value === "string" ? value[name === "uppercase" ? "toUpperCase" : "toLowerCase"]() : fail("vendor_mapping_transform_invalid", `${name} requires a string.`);
  if (name === "date_iso") { const date = new Date(value); if (!Number.isFinite(date.getTime())) fail("vendor_mapping_transform_invalid", "date_iso requires a valid date."); return date.toISOString(); }
  if (name === "boolean_string") { if (typeof value !== "boolean") fail("vendor_mapping_transform_invalid", "boolean_string requires a boolean."); return String(value); }
  if (name === "paise_string") { if (typeof value !== "string" || !/^-?(0|[1-9]\d*)$/.test(value)) fail("vendor_mapping_money_invalid", "Money must be an exact integer paise string."); return value; }
  fail("vendor_mapping_transform_invalid", "Unsupported mapping transform.");
}

export function registerVendorMapping(registry = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId"); const mappingId = text(input.mappingId, "mappingId"); approve(input);
  for (const field of ["family", "provider", "operation", "sourceSchemaVersion", "targetSchemaVersion", "certificationRef"]) text(input[field], field);
  if (input.dataResidencyCountry !== "IN") fail("vendor_mapping_residency_invalid", "Mapping processing must be India-resident.");
  if (!shaPattern.test(input.sourceSchemaChecksumSha256 ?? "") || !shaPattern.test(input.targetSchemaChecksumSha256 ?? "")) fail("vendor_mapping_checksum_invalid", "Schema checksums must be SHA-256.");
  if (!Array.isArray(input.fields) || !input.fields.length) fail("vendor_mapping_fields_missing", "At least one field mapping is required.");
  const targets = new Set(); const fields = input.fields.map((field) => { const source = text(field.source, "field.source"); const target = text(field.target, "field.target"); if (!pathPattern.test(source) || !pathPattern.test(target)) fail("vendor_mapping_path_invalid", "Only dotted data paths are allowed."); if (targets.has(target)) fail("vendor_mapping_target_duplicate", "Each target may be mapped once."); targets.add(target); const operation = field.transform ?? "copy"; if (!VENDOR_MAPPING_TRANSFORMS.includes(operation)) fail("vendor_mapping_transform_invalid", "Unsupported mapping transform."); return { source, target, transform: operation, required: field.required !== false }; });
  const key = `${tenantId}:${mappingId}`; if (registry[key]) fail("vendor_mapping_duplicate", "Mapping already exists in this tenant.");
  const mapping = { tenantId, mappingId, family: input.family, provider: input.provider, operation: input.operation, sourceSchemaVersion: input.sourceSchemaVersion, sourceSchemaChecksumSha256: input.sourceSchemaChecksumSha256, targetSchemaVersion: input.targetSchemaVersion, targetSchemaChecksumSha256: input.targetSchemaChecksumSha256, dataResidencyCountry: "IN", certificationRef: input.certificationRef, fields, mappingChecksumSha256: checksum(fields), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "active", registeredAt: now.toISOString() };
  return { registry: { ...registry, [key]: mapping }, mapping };
}

export function mapVendorPayload(registry = {}, input = {}) {
  const mapping = registry[`${text(input.tenantId, "tenantId")}:${text(input.mappingId, "mappingId")}`]; if (!mapping || mapping.status !== "active") fail("vendor_mapping_unavailable", "Active same-tenant mapping is required.");
  if (input.sourceSchemaChecksumSha256 !== mapping.sourceSchemaChecksumSha256) fail("vendor_mapping_schema_mismatch", "Source schema checksum does not match the certified mapping.");
  const output = {}; for (const field of mapping.fields) { const value = get(input.payload, field.source); if (value === undefined || value === null) { if (field.required) fail("vendor_mapping_required_field", `Required source field ${field.source} is missing.`); continue; } set(output, field.target, transform(value, field.transform)); }
  return { payload: output, mappingId: mapping.mappingId, mappingChecksumSha256: mapping.mappingChecksumSha256, sourcePayloadChecksumSha256: checksum(input.payload), targetPayloadChecksumSha256: checksum(output) };
}

export function certifyVendorUat(registry = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId"); const certificationId = text(input.certificationId, "certificationId"); approve(input); for (const field of ["family", "provider", "environment", "mappingChecksumSha256", "transportEvidenceRef", "cryptographicEvidenceRef", "reconciliationEvidenceRef", "drEvidenceRef", "exitEvidenceRef"]) text(input[field], field);
  if (input.environment !== "production_equivalent") fail("vendor_uat_environment_invalid", "UAT must use a production-equivalent environment."); if (!shaPattern.test(input.mappingChecksumSha256)) fail("vendor_mapping_checksum_invalid", "Mapping checksum must be SHA-256.");
  const results = Array.isArray(input.results) ? input.results : []; const byScenario = new Map(results.map((result) => [result.scenario, result])); const missing = VENDOR_UAT_SCENARIOS.filter((scenario) => !byScenario.has(scenario)); const failed = results.filter((result) => !VENDOR_UAT_SCENARIOS.includes(result.scenario) || result.status !== "passed" || !result.evidenceRef); if (missing.length || failed.length || byScenario.size !== results.length) fail("vendor_uat_incomplete", "Every required adverse UAT scenario must pass with evidence.");
  const expiresAt = new Date(input.expiresAt); if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) fail("vendor_uat_expiry_invalid", "Certification requires a future expiry."); const key = `${tenantId}:${certificationId}`; if (registry[key]) fail("vendor_uat_duplicate", "Certification already exists in this tenant.");
  const certification = { tenantId, certificationId, family: input.family, provider: input.provider, environment: input.environment, mappingChecksumSha256: input.mappingChecksumSha256, results: [...results].sort((a, b) => a.scenario.localeCompare(b.scenario)), evidenceRefs: { transport: input.transportEvidenceRef, cryptographic: input.cryptographicEvidenceRef, reconciliation: input.reconciliationEvidenceRef, disasterRecovery: input.drEvidenceRef, exit: input.exitEvidenceRef }, resultChecksumSha256: checksum(results), status: "certified", expiresAt: expiresAt.toISOString(), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, certifiedAt: now.toISOString() };
  return { registry: { ...registry, [key]: certification }, certification };
}

export function assessVendorActivation(mappings = {}, certifications = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId"); const mapping = mappings[`${tenantId}:${text(input.mappingId, "mappingId")}`]; const certification = certifications[`${tenantId}:${text(input.certificationId, "certificationId")}`];
  const reasons = []; if (!mapping || mapping.status !== "active") reasons.push("mapping_missing"); if (!certification || certification.status !== "certified") reasons.push("certification_missing"); if (certification && new Date(certification.expiresAt) <= now) reasons.push("certification_expired"); if (mapping && certification && (mapping.mappingChecksumSha256 !== certification.mappingChecksumSha256 || mapping.family !== certification.family || mapping.provider !== certification.provider)) reasons.push("certification_scope_mismatch"); if (!input.credentialRef) reasons.push("credential_reference_missing"); if (!input.contractRef) reasons.push("contract_reference_missing");
  return { tenantId, status: reasons.length ? "blocked" : "ready", reasons, mappingId: mapping?.mappingId ?? null, certificationId: certification?.certificationId ?? null };
}
