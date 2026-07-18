import { createHash } from "node:crypto";

import { PRODUCT_JOURNEY_TYPES } from "./product-journey-administration.js";
import {
  PRODUCT_JOURNEY_ARCHETYPES,
  buildProductJourneyConformanceManifest
} from "./product-journey-conformance.js";
import { JOURNEY_WORKSPACE_SCHEMAS } from "./journey-workspace.js";
import { PRODUCT_TEMPLATE_CATALOGUE } from "../platform/product-template-catalogue.js";

export const PRODUCT_JOURNEY_CONFORMANCE_LANES = Object.freeze([
  Object.freeze({ laneId: "api_file", boundary: "authenticated_api_with_file_restart", environmentRequired: false }),
  Object.freeze({ laneId: "browser_contract", boundary: "browser_static_contract", environmentRequired: false }),
  Object.freeze({ laneId: "postgres_rls", boundary: "postgres_persistence_and_rls", environmentRequired: true })
]);

const SCENARIO_CATEGORIES = Object.freeze({
  happy_lifecycle: "happy",
  policy_decline: "adverse",
  missing_evidence: "malformed_adverse",
  provider_timeout: "adverse_recovery",
  duplicate_replay: "idempotent_replay",
  stale_version: "malformed_adverse",
  cross_tenant: "tenant_isolation",
  wrong_role: "authorization_denial",
  self_approval: "authorization_denial",
  revocation_mid_work: "authorization_denial",
  reconciliation_mismatch: "adverse_recovery",
  balanced_accounting: "integrity",
  regulatory_output: "integrity",
  repayment_delinquency_closure: "integrity",
  rollback_recovery: "recovery",
  audit_replay: "idempotent_replay"
});

const REQUIRED_CATEGORIES = Object.freeze([
  "happy",
  "authorization_denial",
  "malformed_adverse",
  "idempotent_replay",
  "recovery",
  "tenant_isolation"
]);

/**
 * Generate the full JD-05 execution contract without claiming that a case
 * passed. Every row requires evidence from its named platform lane.
 */
export function buildProductJourneyGeneratedConformanceMatrix(input = {}) {
  const tenantId = text(input.tenantId ?? "jd05-synthetic-tenant", "tenantId");
  const journeyTypes = input.journeyTypes ?? PRODUCT_JOURNEY_TYPES;
  if (!Array.isArray(journeyTypes) || journeyTypes.length === 0 || journeyTypes.some((type) => !PRODUCT_JOURNEY_TYPES.includes(type))) {
    fail("journey_generated_conformance_scope_invalid", "journeyTypes must contain canonical product journeys only.");
  }
  const lanes = input.lanes ?? PRODUCT_JOURNEY_CONFORMANCE_LANES.map((lane) => lane.laneId);
  if (!Array.isArray(lanes) || lanes.length === 0 || lanes.some((laneId) => !PRODUCT_JOURNEY_CONFORMANCE_LANES.some((lane) => lane.laneId === laneId))) {
    fail("journey_generated_conformance_scope_invalid", "lanes must contain supported conformance lanes only.");
  }
  const cases = [];
  for (const journeyType of [...new Set(journeyTypes)].sort()) {
    const schema = JOURNEY_WORKSPACE_SCHEMAS[journeyType];
    const template = PRODUCT_TEMPLATE_CATALOGUE[journeyType];
    const version = text(input.templateVersions?.[journeyType] ?? template.version, `templateVersions.${journeyType}`);
    const templateChecksumSha256 = input.templateChecksums?.[journeyType] ?? template.templateChecksumSha256;
    const manifest = buildProductJourneyConformanceManifest({
      tenantId,
      campaignId: `generated-${journeyType}-${safeToken(version)}`,
      journeyType,
      templateVersion: version,
      templateChecksumSha256,
      executionMode: "simulated",
      commerciallyLive: false,
      environmentRef: "generated://jd05/non-production",
      tenantConfigurationRef: `generated://jd05/${journeyType}/${version}`,
      proposedBy: "generated-matrix"
    }).campaign;
    for (const scenario of manifest.scenarios) {
      const category = scenarioCategory(scenario.scenarioClass);
      for (const laneId of [...new Set(lanes)].sort()) {
        cases.push(Object.freeze({
          caseId: `JD05:${journeyType}:${version}:${scenario.scenarioId}:${laneId}`,
          journeyType,
          archetype: PRODUCT_JOURNEY_ARCHETYPES[journeyType],
          templateVersion: version,
          templateChecksumSha256,
          workspaceSchemaVersion: schema.schemaVersion,
          workspaceSchemaChecksumSha256: schema.schemaChecksumSha256,
          scenarioId: scenario.scenarioId,
          scenarioClass: scenario.scenarioClass,
          category,
          objective: scenario.objective,
          laneId,
          executionMode: "non_production",
          commerciallyLive: false
        }));
      }
    }
  }
  return Object.freeze({
    schemaVersion: "product-journey-generated-conformance/v1",
    tenantId,
    generatedFor: "JD-05",
    executionMode: "non_production",
    commerciallyLive: false,
    journeyCount: new Set(cases.map((item) => item.journeyType)).size,
    scenarioCount: new Set(cases.map((item) => `${item.journeyType}:${item.templateVersion}:${item.scenarioId}`)).size,
    caseCount: cases.length,
    matrixChecksumSha256: hash(cases),
    cases: Object.freeze(cases)
  });
}

/**
 * Execute generated cases through caller-owned lane adapters. Missing lanes
 * and incomplete evidence are blocked, never converted to a permissive pass.
 */
export async function runProductJourneyGeneratedConformance(input = {}) {
  const matrix = input.matrix ?? buildProductJourneyGeneratedConformanceMatrix(input);
  const validation = validateProductJourneyGeneratedConformanceMatrix(matrix);
  if (!validation.valid) fail("journey_generated_conformance_matrix_invalid", validation.errors.join("; "));
  if (input.executionMode === "live" || input.commerciallyLive === true) {
    fail("journey_generated_conformance_live_claim_forbidden", "The generated harness records non-production evidence only.");
  }
  const selected = typeof input.select === "function" ? matrix.cases.filter(input.select) : matrix.cases;
  const results = [];
  for (const testCase of selected) {
    const executor = input.executors?.[testCase.laneId];
    if (typeof executor !== "function") {
      results.push(result(testCase, "blocked", "executor_unavailable", null));
      continue;
    }
    try {
      const observed = await executor(testCase);
      if (!observed || !["passed", "failed", "blocked"].includes(observed.outcome)) {
        results.push(result(testCase, "blocked", "invalid_executor_result", null));
        continue;
      }
      if (observed.outcome === "passed" && (typeof observed.evidenceRef !== "string" || !observed.evidenceRef.trim())) {
        results.push(result(testCase, "blocked", "evidence_required", null));
        continue;
      }
      results.push(result(testCase, observed.outcome, observed.reasonCode ?? null, observed.evidenceRef ?? null, observed.observation ?? null));
    } catch (cause) {
      results.push(result(testCase, "failed", cause?.code ?? "executor_failed", null));
    }
  }
  const summary = Object.freeze({
    selectedCaseCount: results.length,
    passedCount: results.filter((item) => item.outcome === "passed").length,
    failedCount: results.filter((item) => item.outcome === "failed").length,
    blockedCount: results.filter((item) => item.outcome === "blocked").length,
    allPassed: results.length > 0 && results.every((item) => item.outcome === "passed"),
    productionReady: false
  });
  return Object.freeze({ matrixChecksumSha256: matrix.matrixChecksumSha256, executionMode: "non_production", commerciallyLive: false, summary, results: Object.freeze(results) });
}

export function validateProductJourneyGeneratedConformanceMatrix(matrix) {
  const errors = [];
  if (matrix?.schemaVersion !== "product-journey-generated-conformance/v1") errors.push("schema version is invalid");
  if (matrix?.executionMode !== "non_production" || matrix?.commerciallyLive !== false) errors.push("matrix makes an unsupported live claim");
  if (!Array.isArray(matrix?.cases) || matrix.cases.length === 0) errors.push("matrix contains no cases");
  if (matrix?.caseCount !== matrix?.cases?.length) errors.push("matrix case count is invalid");
  if (matrix?.journeyCount !== new Set((matrix?.cases ?? []).map((item) => item.journeyType)).size) errors.push("matrix journey count is invalid");
  if (matrix?.scenarioCount !== new Set((matrix?.cases ?? []).map((item) => `${item.journeyType}:${item.templateVersion}:${item.scenarioId}`)).size) errors.push("matrix scenario count is invalid");
  const identifiers = new Set();
  for (const item of matrix?.cases ?? []) {
    if (identifiers.has(item.caseId)) errors.push(`duplicate case ${item.caseId}`);
    identifiers.add(item.caseId);
    if (!PRODUCT_JOURNEY_TYPES.includes(item.journeyType)) errors.push(`${item.caseId} has a non-canonical journey`);
    if (!PRODUCT_JOURNEY_CONFORMANCE_LANES.some((lane) => lane.laneId === item.laneId)) errors.push(`${item.caseId} has an unsupported lane`);
    if (!item.category) errors.push(`${item.caseId} has no scenario category`);
    if (item.executionMode !== "non_production" || item.commerciallyLive !== false) errors.push(`${item.caseId} makes an unsupported live claim`);
  }
  if (hash(matrix?.cases ?? []) !== matrix?.matrixChecksumSha256) errors.push("matrix checksum is invalid");
  const categories = new Set((matrix?.cases ?? []).map((item) => item.category));
  for (const category of REQUIRED_CATEGORIES) if (!categories.has(category)) errors.push(`required category ${category} is absent`);
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function scenarioCategory(scenarioClass) {
  if (SCENARIO_CATEGORIES[scenarioClass]) return SCENARIO_CATEGORIES[scenarioClass];
  if (scenarioClass.endsWith("_specialist_path")) return "happy";
  fail("journey_generated_conformance_scenario_invalid", `No JD-05 category is defined for ${scenarioClass}.`);
}

function result(testCase, outcome, reasonCode, evidenceRef, observation = null) {
  const core = { caseId: testCase.caseId, journeyType: testCase.journeyType, scenarioId: testCase.scenarioId, laneId: testCase.laneId, outcome, reasonCode, evidenceRef, observation };
  return Object.freeze({ ...core, evidenceChecksumSha256: hash(core) });
}

function safeToken(value) { return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-"); }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("journey_generated_conformance_input_invalid", `${field} is required.`); return value.trim(); }
function canonical(value) { if (value === undefined) return "null"; if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value); if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; throw new Error("invalid_json"); }
function hash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
