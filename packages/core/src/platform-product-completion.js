import { createHash } from "node:crypto";

export function approveTenantPlan(input = {}, existing = [], now = new Date()) {
  base(input); fields(input, ["planId", "version", "proposedBy", "approvedBy", "approvalRef", "termsRef"]); fourEyes(input);
  if (existing.some((x) => x.tenantId === input.tenantId && x.planId === input.planId && x.version === input.version)) fail("tenant_plan_duplicate", "Tenant plan version already exists.");
  const entitlements = strings(input.entitlements, "entitlements", true); const limits = objectOfNonNegativeIntegers(input.limits, "limits");
  return { tenantId: input.tenantId, planId: input.planId, version: input.version, entitlements, limits, status: "approved", proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, termsRef: input.termsRef, approvedAt: now.toISOString() };
}

export function authorizePlanUsage(plan, input = {}) {
  same(plan, input); fields(input, ["entitlement"]); if (plan.status !== "approved" || !plan.entitlements.includes(input.entitlement)) fail("entitlement_denied", "Approved plan entitlement is required.");
  const limit = plan.limits[input.limitKey]; if (input.limitKey != null) { if (!Number.isInteger(input.currentUsage) || input.currentUsage < 0 || limit == null || input.currentUsage + 1 > limit) fail("plan_limit_exceeded", "Plan usage limit exceeded."); }
  return { tenantId: input.tenantId, entitlement: input.entitlement, decision: "allow", planId: plan.planId, planVersion: plan.version };
}

export function promoteEnvironmentConfiguration(input = {}, existing = [], now = new Date()) {
  base(input); fields(input, ["configurationId", "version", "sourceEnvironment", "targetEnvironment", "payloadChecksumSha256", "sourceEvidenceRef", "testEvidenceRef", "proposedBy", "approvedBy", "approvalRef"]); fourEyes(input); digest(input.payloadChecksumSha256);
  const order = { development: 0, test: 1, staging: 2, production: 3 };
  if (order[input.sourceEnvironment] == null || order[input.targetEnvironment] !== order[input.sourceEnvironment] + 1) fail("configuration_promotion_invalid", "Configuration must promote exactly one environment forward.");
  if (existing.some((x) => x.tenantId === input.tenantId && x.configurationId === input.configurationId && x.version === input.version && x.targetEnvironment === input.targetEnvironment)) fail("configuration_promotion_duplicate", "Configuration was already promoted.");
  return { ...pick(input, ["tenantId", "configurationId", "version", "sourceEnvironment", "targetEnvironment", "payloadChecksumSha256", "sourceEvidenceRef", "testEvidenceRef", "proposedBy", "approvedBy", "approvalRef"]), status: "promoted", promotedAt: now.toISOString() };
}

export function importTenantPortablePackage(input = {}, existing = [], now = new Date()) {
  base(input); fields(input, ["importId", "packageId", "schemaVersion", "archiveRef", "archiveChecksumSha256", "manifestChecksumSha256", "exportTenantId", "proposedBy", "approvedBy", "approvalRef", "validationEvidenceRef"]); fourEyes(input); digest(input.archiveChecksumSha256); digest(input.manifestChecksumSha256);
  if (input.exportTenantId !== input.tenantId) fail("portability_tenant_mismatch", "Portable packages cannot be reloaded into another tenant.");
  if (input.checksumVerified !== true || input.schemaCompatible !== true || input.rowCountsReconciled !== true) fail("portability_validation_failed", "Checksum, schema, and row-count validation must pass.");
  if (existing.some((x) => x.tenantId === input.tenantId && x.packageId === input.packageId)) fail("portability_replay", "Portable package was already imported.");
  return { ...pick(input, ["tenantId", "importId", "packageId", "schemaVersion", "archiveRef", "archiveChecksumSha256", "manifestChecksumSha256", "exportTenantId", "proposedBy", "approvedBy", "approvalRef", "validationEvidenceRef"]), status: "imported", importedAt: now.toISOString() };
}

export function createTenantCommunication(input = {}, existing = [], now = new Date()) {
  base(input); fields(input, ["communicationId", "type", "subject", "messageRef", "audience", "proposedBy", "approvedBy", "approvalRef"]); fourEyes(input);
  if (!["sla", "maintenance", "release", "incident"].includes(input.type)) fail("tenant_communication_invalid", "Communication type is invalid.");
  if (existing.some((x) => x.tenantId === input.tenantId && x.communicationId === input.communicationId)) fail("tenant_communication_duplicate", "communicationId already exists.");
  const startsAt = iso(input.startsAt, "startsAt"); const endsAt = input.endsAt == null ? null : iso(input.endsAt, "endsAt"); if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) fail("tenant_communication_invalid", "endsAt must follow startsAt.");
  if (["maintenance", "incident"].includes(input.type) && !input.impactRef) fail("tenant_communication_invalid", "Impact evidence is required.");
  return { ...pick(input, ["tenantId", "communicationId", "type", "subject", "messageRef", "audience", "impactRef", "proposedBy", "approvedBy", "approvalRef"]), startsAt, endsAt, status: "approved", approvedAt: now.toISOString() };
}

export function approveRiskPricingMatrix(input = {}, existing = [], now = new Date()) {
  base(input); fields(input, ["matrixId", "version", "policyRef", "proposedBy", "approvedBy", "approvalRef"]); fourEyes(input);
  const bands = array(input.bands, "bands", true).map((x) => ({ riskBand: required(x.riskBand, "riskBand"), minScore: integer(x.minScore, "minScore"), maxScore: integer(x.maxScore, "maxScore"), annualRateBps: nonnegativeString(x.annualRateBps, "annualRateBps"), processingFeePaise: nonnegativeString(x.processingFeePaise, "processingFeePaise") }));
  if (bands.some((x) => x.minScore > x.maxScore) || bands.some((x, i) => bands.some((y, j) => i !== j && x.minScore <= y.maxScore && y.minScore <= x.maxScore))) fail("pricing_matrix_overlap", "Risk score bands must be valid and non-overlapping.");
  if (existing.some((x) => x.tenantId === input.tenantId && x.matrixId === input.matrixId && x.version === input.version)) fail("pricing_matrix_duplicate", "Pricing matrix version exists.");
  return { tenantId: input.tenantId, matrixId: input.matrixId, version: input.version, bands, policyRef: input.policyRef, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "approved", approvedAt: now.toISOString() };
}

export function diffProductVersions(from, to, input = {}, now = new Date()) {
  same(from, input); same(to, input); fields(input, ["assessmentId", "assessedBy", "approvedBy", "approvalRef"]); if (input.assessedBy === input.approvedBy) fail("platform_product_four_eyes_required", "Independent approval is required.");
  const fromChecksum = checksum(from.definition); const toChecksum = checksum(to.definition); if (fromChecksum === toChecksum) fail("product_version_unchanged", "Product versions have no definition change.");
  const keys = [...new Set([...Object.keys(from.definition ?? {}), ...Object.keys(to.definition ?? {})])].sort(); const changes = keys.filter((key) => JSON.stringify(from.definition?.[key]) !== JSON.stringify(to.definition?.[key])).map((key) => ({ field: key, from: from.definition?.[key] ?? null, to: to.definition?.[key] ?? null }));
  return { tenantId: input.tenantId, assessmentId: input.assessmentId, productId: from.productId, fromVersion: from.version, toVersion: to.version, fromChecksumSha256: fromChecksum, toChecksumSha256: toChecksum, changes, impactedActiveAccountCount: integer(input.impactedActiveAccountCount, "impactedActiveAccountCount"), migrationRequired: input.impactedActiveAccountCount > 0, assessedBy: input.assessedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, assessedAt: now.toISOString() };
}

export function approveProductAddon(input = {}, existing = [], now = new Date()) {
  base(input); fields(input, ["addonId", "version", "addonType", "providerRef", "disclosureRef", "consentTextRef", "proposedBy", "approvedBy", "approvalRef"]); fourEyes(input);
  if (!["insurance", "service"].includes(input.addonType)) fail("product_addon_invalid", "addonType is invalid.");
  const premiumPaise = nonnegativeString(input.premiumPaise, "premiumPaise"); const commissionBps = nonnegativeString(input.commissionBps, "commissionBps");
  if (input.optional !== true || input.preselected === true) fail("product_addon_consent_invalid", "Add-ons must be optional and never preselected.");
  if (existing.some((x) => x.tenantId === input.tenantId && x.addonId === input.addonId && x.version === input.version)) fail("product_addon_duplicate", "Add-on version exists.");
  return { ...pick(input, ["tenantId", "addonId", "version", "addonType", "providerRef", "disclosureRef", "consentTextRef", "proposedBy", "approvedBy", "approvalRef"]), premiumPaise, commissionBps, optional: true, preselected: false, status: "approved", approvedAt: now.toISOString() };
}

export function approveProfitabilityParameters(input = {}, existing = [], now = new Date()) {
  base(input); fields(input, ["parameterSetId", "version", "methodologyRef", "proposedBy", "approvedBy", "approvalRef"]); fourEyes(input);
  const names = ["costOfFundsBps", "operatingCostPaise", "expectedLossBps", "capitalAllocationBps", "targetRarocBps"];
  const parameters = Object.fromEntries(names.map((name) => [name, nonnegativeString(input[name], name)]));
  if (existing.some((x) => x.tenantId === input.tenantId && x.parameterSetId === input.parameterSetId && x.version === input.version)) fail("profitability_parameters_duplicate", "Parameter version exists.");
  return { tenantId: input.tenantId, parameterSetId: input.parameterSetId, version: input.version, ...parameters, methodologyRef: input.methodologyRef, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "approved", approvedAt: now.toISOString() };
}

function base(x) { required(x.tenantId, "tenantId"); }
function same(record, input) { base(input); if (!record || record.tenantId !== input.tenantId) fail("platform_product_tenant_mismatch", "Record tenant mismatch."); }
function fields(x, names) { names.forEach((name) => required(x[name], name)); }
function fourEyes(x) { if (x.proposedBy === x.approvedBy) fail("platform_product_four_eyes_required", "Independent approval is required."); }
function required(v, name) { if (typeof v !== "string" || !v.trim()) fail("platform_product_invalid", `${name} is required.`); return v; }
function strings(v, name, needed) { if (!Array.isArray(v)) fail("platform_product_invalid", `${name} must be an array.`); const result = [...new Set(v.map(String).map((x) => x.trim()).filter(Boolean))]; if (needed && !result.length) fail("platform_product_invalid", `${name} is required.`); return result; }
function array(v, name, needed) { if (!Array.isArray(v) || (needed && !v.length)) fail("platform_product_invalid", `${name} must be a non-empty array.`); return v; }
function integer(v, name) { if (!Number.isInteger(v) || v < 0) fail("platform_product_invalid", `${name} must be a non-negative integer.`); return v; }
function nonnegativeString(v, name) { if (typeof v !== "string" || !/^\d+$/.test(v)) fail("platform_product_invalid", `${name} must be an exact non-negative integer string.`); return v.replace(/^0+(?=\d)/, ""); }
function objectOfNonNegativeIntegers(v, name) { if (!v || Array.isArray(v) || typeof v !== "object") fail("platform_product_invalid", `${name} must be an object.`); return Object.fromEntries(Object.entries(v).map(([k, n]) => [required(k, name), integer(n, `${name}.${k}`)])); }
function digest(v) { if (!/^[a-fA-F0-9]{64}$/.test(v)) fail("platform_product_invalid", "SHA-256 checksum is invalid."); }
function iso(v, name) { if (typeof v !== "string" || !Number.isFinite(Date.parse(v))) fail("platform_product_invalid", `${name} must be ISO date-time.`); return new Date(v).toISOString(); }
function checksum(v) { return createHash("sha256").update(JSON.stringify(v)).digest("hex"); }
function pick(x, names) { return Object.fromEntries(names.filter((n) => x[n] != null).map((n) => [n, x[n]])); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
