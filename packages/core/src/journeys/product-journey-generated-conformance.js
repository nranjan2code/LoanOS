import { createHash } from "node:crypto";

import { PRODUCT_JOURNEY_TYPES } from "./product-journey-administration.js";
import { activateProductJourney } from "./product-journey-administration.js";
import {
  PRODUCT_JOURNEY_ARCHETYPES,
  buildProductJourneyConformanceManifest
} from "./product-journey-conformance.js";
import { createComposedJourneyInstance, pauseComposedJourneysForPrincipal } from "./composed-journey-lifecycle.js";
import { getProductJourneyContract } from "./product-journey-contracts.js";
import { JOURNEY_WORKSPACE_SCHEMAS, projectJourneyWorkspaceSchema } from "./journey-workspace.js";
import {
  PERSISTENT_SPECIALIST_JOURNEY_TYPES,
  SPECIALIST_JOURNEY_TYPE_TO_FAMILY,
  approveSpecialistJourneyAction,
  approveSpecialistJourneyConfiguration,
  openSpecialistJourneyCase,
  proposeSpecialistJourneyAction,
  proposeSpecialistJourneyConfiguration
} from "./specialist-journey-service.js";
import { PRODUCT_TEMPLATE_CATALOGUE } from "../platform/product-template-catalogue.js";
import { buildLoanJournalEntries } from "../finance/accounting.js";
import { reconcilePaymentRailSettlement } from "../finance/payment-reconciliation.js";
import { createProviderSimulator } from "../integrations/provider-simulator.js";
import { evaluateEligibility } from "../lending/eligibility.js";
import {
  computeDelinquency,
  forecloseLoanAccount,
  generateCicSnapshot,
  generateClosureCertificate,
  generateLoanStatement,
  generateRepaymentSchedule,
  postPaymentToLoanAccount,
  quoteForeclosure
} from "../lending/loan-account.js";
import {
  acquireProvisioningStep,
  approveIrreversibleProvisioningStep,
  completeProvisioningStep,
  failProvisioningStep,
  nextProvisioningCompensation,
  planTenantProvisioningSaga,
  recordProvisioningCompensation
} from "../platform/tenant-provisioning-saga.js";
import { buildAuditEvidencePack, sealAuditChain, verifyAuditChain } from "../shared/audit.js";

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

export const PRODUCT_JOURNEY_DOWNSTREAM_SCENARIO_IDS = Object.freeze([
  "JRN-COM-001",
  "JRN-COM-002",
  "JRN-COM-003",
  "JRN-COM-004",
  "JRN-COM-005",
  "JRN-COM-006",
  "JRN-COM-007",
  "JRN-COM-008",
  "JRN-COM-009",
  "JRN-COM-010",
  "JRN-COM-011",
  "JRN-COM-012",
  "JRN-COM-013",
  "JRN-COM-014",
  "JRN-COM-015",
  "JRN-COM-016"
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
          tenantId,
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

/**
 * Build an api_file-lane executor for the repository's reusable downstream
 * lifecycle. The executor deliberately supports only scenario contracts it
 * can prove with domain-kernel behavior. Every other scenario is blocked so
 * a partial downstream slice cannot be mistaken for complete JD-05 evidence.
 */
export function createProductJourneyDownstreamConformanceExecutor(input = {}) {
  const evidencePrefix = text(input.evidencePrefix ?? "domain://jd05/downstream", "evidencePrefix").replace(/\/+$/, "");
  const now = instant(input.now ?? "2026-01-01T00:00:00.000Z", "now");
  return async (testCase) => {
    if (!testCase || testCase.laneId !== "api_file") {
      return { outcome: "blocked", reasonCode: "downstream_lane_unsupported" };
    }
    if (!PRODUCT_JOURNEY_DOWNSTREAM_SCENARIO_IDS.includes(testCase.scenarioId) && !testCase.scenarioId.startsWith("JRN-ARC-")) {
      return { outcome: "blocked", reasonCode: "downstream_scenario_not_implemented" };
    }
    assertCanonicalCase(testCase);
    const fixture = buildDownstreamFixture(testCase, now);
    const observations = executeDownstreamScenario(testCase.scenarioId, fixture, now);
    if (!Array.isArray(observations) || observations.length === 0) {
      fail("journey_generated_conformance_evidence_missing", "Downstream execution produced no observations.");
    }
    const observation = Object.freeze({
      executor: "repository_domain_lifecycle/v1",
      tenantId: testCase.tenantId,
      journeyType: testCase.journeyType,
      scenarioId: testCase.scenarioId,
      templateVersion: testCase.templateVersion,
      productionReady: false,
      observations: Object.freeze(observations)
    });
    const evidenceChecksumSha256 = hash(observation);
    return {
      outcome: "passed",
      evidenceRef: `${evidencePrefix}/${testCase.journeyType}/${testCase.scenarioId}/${evidenceChecksumSha256}`,
      observation: Object.freeze({ ...observation, evidenceChecksumSha256 })
    };
  };
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
    if (item.tenantId !== matrix.tenantId) errors.push(`${item.caseId} has invalid tenant lineage`);
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

function assertCanonicalCase(testCase) {
  const template = PRODUCT_TEMPLATE_CATALOGUE[testCase.journeyType];
  const schema = JOURNEY_WORKSPACE_SCHEMAS[testCase.journeyType];
  if (!template || !schema) fail("journey_generated_conformance_case_invalid", "A canonical journey fixture is required.");
  if (testCase.templateVersion !== template.version || testCase.templateChecksumSha256 !== template.templateChecksumSha256) {
    fail("journey_generated_conformance_template_mismatch", "The case template lineage does not match the repository catalogue.");
  }
  if (testCase.workspaceSchemaVersion !== schema.schemaVersion || testCase.workspaceSchemaChecksumSha256 !== schema.schemaChecksumSha256) {
    fail("journey_generated_conformance_schema_mismatch", "The case workspace lineage does not match the repository catalogue.");
  }
}

function buildDownstreamFixture(testCase, now) {
  const principalAmount = 120000;
  const scheduleResult = generateRepaymentSchedule({
    principalAmount,
    annualInterestRateBps: 1200,
    tenorMonths: 12,
    startDate: now.toISOString()
  });
  requireReady(scheduleResult, "repayment_schedule");
  const template = PRODUCT_TEMPLATE_CATALOGUE[testCase.journeyType];
  const account = {
    loanAccountId: `jd05-${testCase.journeyType}`,
    applicationId: `jd05-application-${testCase.journeyType}`,
    borrowerId: `jd05-borrower-${testCase.journeyType}`,
    regulatedEntityId: "jd05-regulated-entity",
    productId: template.templateId,
    productCode: testCase.journeyType,
    productType: testCase.journeyType,
    accountingProfile: { profileId: template.accountingProfile },
    paymentAllocationWaterfall: ["interest", "charges", "principal"],
    status: "active",
    currency: "INR",
    principalAmount,
    annualInterestRateBps: 1200,
    aprBps: 1200,
    tenorMonths: 12,
    repaymentFrequency: "monthly",
    repaymentStructure: "amortizing",
    facilityType: "term_loan",
    coolingOffDays: 1,
    openedAt: now.toISOString(),
    disbursedAt: now.toISOString(),
    schedule: scheduleResult.schedule,
    disclosedChargeCatalog: [],
    foreclosurePolicy: { allowed: true, chargeBps: 0, lockInMonths: 0 },
    interestRateType: "fixed",
    borrowerType: "individual",
    ledger: [{
      eventId: `jd05-disbursement-${testCase.journeyType}`,
      type: "disbursement",
      eventDate: now.toISOString(),
      amount: principalAmount,
      principalDebit: principalAmount,
      principalCredit: 0,
      interestDebit: 0,
      interestCredit: 0,
      chargesDebit: 0,
      chargesCredit: 0,
      chargesWaiverCredit: 0,
      unappliedAmount: 0,
      actor: "jd05-system"
    }]
  };
  return { account, schedule: scheduleResult.schedule, tenantId: testCase.tenantId };
}

function executeDownstreamScenario(scenarioId, fixture, now) {
  if (scenarioId === "JRN-COM-001") return executeFullDownstreamLifecycle(fixture, now);
  if (scenarioId === "JRN-COM-002") return [executePolicyDecline(fixture, now)];
  if (scenarioId === "JRN-COM-003") return [executeMissingEvidenceDenial(fixture.account, now)];
  if (scenarioId === "JRN-COM-004") return [executeProviderTimeout(fixture, now)];
  if (scenarioId === "JRN-COM-005") return [executeDuplicateFinancialReplay(fixture, now)];
  if (scenarioId === "JRN-COM-006") return [executeStaleVersionDenial(fixture, now)];
  if (scenarioId === "JRN-COM-007") return [executeAuditReplay(fixture, now)];
  if (scenarioId === "JRN-COM-008") return [executeWrongRoleDenial(fixture)];
  if (scenarioId === "JRN-COM-009") return [executeSelfApprovalDenial(fixture, now)];
  if (scenarioId === "JRN-COM-010") return [executeRevocationContainment(fixture, now)];
  if (scenarioId === "JRN-COM-011") return [executeReconciliationMismatch(fixture, now)];
  if (scenarioId === "JRN-COM-012") return [executeBalancedAccounting(fixture.account)];
  if (scenarioId === "JRN-COM-013") return [executeReporting(fixture.account, now)];
  if (scenarioId === "JRN-COM-014") return executeRepaymentDelinquencyClosure(fixture, now);
  if (scenarioId === "JRN-COM-015") return [executeRollback(fixture, now)];
  if (scenarioId === "JRN-COM-016") return [executeAuditReplay(fixture, now)];
  if (scenarioId.startsWith("JRN-ARC-")) return [executeArchetypeContract(fixture)];
  fail("journey_generated_conformance_scenario_not_implemented", `No downstream executor is defined for ${scenarioId}.`);
}

function executePolicyDecline(fixture, now) {
  const evaluated = evaluateEligibility({
    product: { productType: fixture.account.productType, requestedAmount: fixture.account.principalAmount, requestedTenorMonths: 12, annualInterestRateBps: 1200, minAmount: 1000, maxAmount: 500000, eligibility: { minAgeYears: 18, minMonthlyIncome: 25000, maxFoir: 0.5 } },
    borrower: { dateOfBirth: "1990-01-01" },
    economicProfile: { monthlyIncome: 10000, existingMonthlyObligations: 9000 },
    bureauReport: { bureau: "cibil", score: 500, defaultAccounts: 1, monthlyObligations: 9000 }
  }, { now, eligibilityId: `jd05-decline-${fixture.account.productType}` });
  if (evaluated.assessment?.decision !== "ineligible" || evaluated.summary.status !== "blocked" || !evaluated.findings.length) {
    fail("journey_generated_conformance_policy_decline_permitted", "A policy-declined fixture must remain ineligible and non-disbursable.");
  }
  return Object.freeze({ stage: "policy_decline", decision: evaluated.assessment.decision, findingCount: evaluated.findings.length, evidenceChecksumSha256: hash(evaluated.assessment) });
}

function executeProviderTimeout(fixture, now) {
  const simulator = createProviderSimulator({ tenantId: fixture.tenantId, seed: `jd05-timeout-${fixture.account.productType}`, callbackSecret: "jd05-synthetic-secret", startAt: now.toISOString(), scenarios: { timeout: { outcome: "timeout" } } });
  let denied = null;
  try {
    simulator.submit({ tenantId: fixture.tenantId, provider: "bank_account_verification", operation: "verify", idempotencyKey: `jd05-timeout-${fixture.account.productType}`, scenario: "timeout", payload: { accountRef: "synthetic://redacted" } });
  } catch (cause) {
    denied = cause;
  }
  if (denied?.code !== "provider_simulator_timeout" || simulator.requestJournal().length !== 1 || simulator.pendingCallbacks().length !== 0) {
    fail("journey_generated_conformance_provider_timeout_permitted", "A provider timeout must fail closed without a success callback.");
  }
  return Object.freeze({ stage: "provider_timeout", outcome: "blocked_as_expected", reasonCode: denied.code, requestChecksumSha256: hash(simulator.requestJournal()) });
}

function executeStaleVersionDenial(fixture, now) {
  const journeyId = `jd05-stale-${fixture.account.productType}`;
  const stale = {
    tenantId: fixture.tenantId,
    journeyId,
    journeyType: fixture.account.productType,
    version: 1,
    status: "approved",
    regulatedEntityRef: "regulated-entity/jd05",
    productPolicyRefs: ["policy/jd05"],
    channelRefs: ["channel/jd05"],
    controlRequirements: [{ requirementId: "control/jd05", required: true, evidenceRef: "evidence/jd05" }],
    roleAssignments: [{ role: "operator", principalId: "operator-1" }],
    adminAssignments: [{ role: "tenant_admin", principalId: "admin-1" }],
    onboardingChecklist: [],
    effectiveFrom: now.toISOString(),
    configurationChecksumSha256: hash({ version: "current" }),
    approval: { checksumSha256: hash({ version: "stale" }) }
  };
  let denied = null;
  try {
    activateProductJourney({ [`${fixture.tenantId}:${journeyId}`]: stale }, journeyId, { tenantId: fixture.tenantId, activatedBy: "jd05-operator", readinessEvidence: {} }, now);
  } catch (cause) {
    denied = cause;
  }
  if (denied?.code !== "product_journey_approval_stale") fail("journey_generated_conformance_stale_version_permitted", "A stale approved configuration must not activate.");
  return Object.freeze({ stage: "stale_version", outcome: "blocked_as_expected", reasonCode: denied.code });
}

function executeWrongRoleDenial(fixture) {
  let denied = null;
  try {
    projectJourneyWorkspaceSchema({}, { tenantId: fixture.tenantId, journeyType: fixture.account.productType, channel: "credit", principalType: "tenant_user", roles: ["grievance_officer"], entitledJourneyTypes: [fixture.account.productType] });
  } catch (cause) {
    denied = cause;
  }
  if (denied?.code !== "journey_workspace_channel_forbidden" || denied.statusCode !== 403) fail("journey_generated_conformance_wrong_role_permitted", "An unstaffed role must not enter the credit workspace.");
  return Object.freeze({ stage: "wrong_role", outcome: "blocked_as_expected", reasonCode: denied.code, statusCode: denied.statusCode });
}

function executeRevocationContainment(fixture, now) {
  const h = "a".repeat(64);
  const journeyType = fixture.account.productType;
  const schema = JOURNEY_WORKSPACE_SCHEMAS[journeyType];
  const template = PRODUCT_TEMPLATE_CATALOGUE[journeyType];
  const state = {
    tenantProductSubscriptions: { "jd05-all": { subscriptionId: "jd05-all", tenantId: fixture.tenantId, productTypes: [journeyType], effectiveFrom: "2025-01-01T00:00:00.000Z", validUntil: "2030-01-01T00:00:00.000Z", status: "active" } },
    specialistJourneyConfigurations: PERSISTENT_SPECIALIST_JOURNEY_TYPES.includes(journeyType) ? { [`${fixture.tenantId}:jd05-config-${journeyType}`]: { tenantId: fixture.tenantId, configurationId: `jd05-config-${journeyType}`, journeyType, version: 1, status: "active", configurationChecksumSha256: h } } : {}
  };
  const created = createComposedJourneyInstance(state, {
    tenantId: fixture.tenantId,
    lifecycleId: `jd05-lifecycle-${journeyType}`,
    journeyType,
    subjectRef: `subject/${journeyType}`,
    applicationRef: `application/${journeyType}`,
    requestedAmountPaise: "12000000",
    assignedPrincipalIds: ["jd05-maker", "jd05-checker"],
    idempotencyKey: `jd05-lifecycle-${journeyType}`,
    createdBy: "jd05-maker",
    lineage: {
      productTemplateRef: template.templateId, productTemplateVersion: template.version, productTemplateChecksumSha256: template.templateChecksumSha256,
      workspaceSchemaId: schema.schemaId, workspaceSchemaVersion: schema.schemaVersion, workspaceSchemaChecksumSha256: schema.schemaChecksumSha256,
      policyBundleRef: `policy/${journeyType}`, policyBundleVersion: 1, policyBundleChecksumSha256: h,
      workflowRef: `workflow/${journeyType}`, workflowVersion: 1, workflowChecksumSha256: h,
      accountingPolicyRef: `accounting/${journeyType}`, accountingPolicyVersion: 1, accountingPolicyChecksumSha256: h,
      tenantConfigurationRef: `configuration/${fixture.tenantId}`, tenantConfigurationVersion: 1, tenantConfigurationChecksumSha256: h,
      accessGrantSnapshotRef: "access/jd05", accessGrantSnapshotChecksumSha256: h,
      ...(PERSISTENT_SPECIALIST_JOURNEY_TYPES.includes(journeyType) ? { specialistConfigurationRef: `jd05-config-${journeyType}`, specialistConfigurationVersion: 1, specialistConfigurationChecksumSha256: h } : {})
    }
  }, now.toISOString());
  const paused = pauseComposedJourneysForPrincipal(created.state, { tenantId: fixture.tenantId, principalId: "jd05-maker", actor: "jd05-security-admin", causeType: "principal_access_revoked", causeRef: `revocation/${journeyType}` }, now.toISOString());
  if (paused.affectedLifecycleIds.length !== 1 || paused.escalations.length !== 1 || paused.state.composedJourneyLifecycles[created.lifecycle.lifecycleId].status !== "paused" || paused.escalations[0].severity !== "critical") {
    fail("journey_generated_conformance_revocation_not_contained", "Principal revocation must pause in-flight work and open a critical escalation.");
  }
  return Object.freeze({ stage: "revocation_mid_work", status: "paused", escalationSeverity: paused.escalations[0].severity, evidenceChecksumSha256: hash(paused.escalations[0]) });
}

function executeArchetypeContract(fixture) {
  const journeyType = fixture.account.productType;
  const contract = getProductJourneyContract(journeyType);
  const schema = JOURNEY_WORKSPACE_SCHEMAS[journeyType];
  const template = PRODUCT_TEMPLATE_CATALOGUE[journeyType];
  const fieldIds = new Set(schema.sections.flatMap((section) => section.fields.map((field) => field.fieldId)));
  const documentIds = new Set(schema.documents.map((document) => document.documentType));
  if (schema.contractChecksumSha256 !== contract.checksumSha256 || contract.requiredFacts.some((field) => !fieldIds.has(field)) || contract.requiredEvidence.some((document) => !documentIds.has(document)) || contract.accounting.postingMode !== "double_entry_idempotent") {
    fail("journey_generated_conformance_archetype_contract_incomplete", "The journey-specific facts, evidence and accounting contract must be complete.");
  }
  const accounting = executeBalancedAccounting(fixture.account);
  const specialist = PERSISTENT_SPECIALIST_JOURNEY_TYPES.includes(journeyType)
    ? executePersistentSpecialistPath(fixture, template, schema)
    : executeComposedArchetypePath(fixture, template, schema);
  return Object.freeze({ stage: "archetype_specialist_path", archetype: contract.archetype, requiredFactCount: contract.requiredFacts.length, requiredEvidenceCount: contract.requiredEvidence.length, contractChecksumSha256: contract.checksumSha256, accountingChecksumSha256: accounting.journalChecksumSha256, specialist });
}

function executePersistentSpecialistPath(fixture, template, schema) {
  const journeyType = fixture.account.productType;
  const now = new Date(fixture.account.openedAt);
  const configurationId = `jd05-specialist-${journeyType}`;
  let result = proposeSpecialistJourneyConfiguration({}, {
    tenantId: fixture.tenantId,
    requestId: `request-${configurationId}`,
    configurationId,
    journeyType,
    productTemplateRef: template.templateId,
    productTemplateVersion: template.version,
    productTemplateChecksumSha256: template.templateChecksumSha256,
    schemaVersion: String(schema.schemaVersion),
    policyVersionRef: `policy/${journeyType}/v1`,
    workflowVersionRef: `workflow/${journeyType}/v1`,
    accountingPolicyRef: template.accountingProfile,
    assignedRoleIds: ["credit_operations_officer", "credit_approver"],
    kernelConfiguration: specialistKernelConfiguration(journeyType),
    idempotencyKey: `configuration/${configurationId}`,
    proposedBy: "jd05-specialist-maker"
  }, now);
  result = approveSpecialistJourneyConfiguration(result.state, { tenantId: fixture.tenantId, requestId: result.request.requestId, approvedBy: "jd05-specialist-checker", approvalRef: `approval/${configurationId}` }, now);
  const configuration = result.configuration;
  const opened = openSpecialistJourneyCase(result.state, {
    tenantId: fixture.tenantId,
    caseId: `case-${journeyType}`,
    configurationId,
    expectedConfigurationVersion: configuration.version,
    subjectRef: `subject/${journeyType}`,
    sourceApplicationRef: `application/${journeyType}`,
    assignedPrincipalIds: ["jd05-specialist-maker"],
    idempotencyKey: `case/${journeyType}`,
    openedBy: "jd05-specialist-maker"
  }, now);
  if (SPECIALIST_JOURNEY_TYPE_TO_FAMILY[journeyType]) {
    const assessed = executeSpecialistAction(opened.state, fixture.tenantId, journeyType, "assess", { facts: specialistFacts(SPECIALIST_JOURNEY_TYPE_TO_FAMILY[journeyType]) }, now);
    if (assessed.blocked || assessed.result?.outcome !== "allow" || assessed.case.status !== "assessed") fail("journey_generated_conformance_specialist_path_incomplete", "The persistent specialist assessment did not complete with approved lineage.");
    return Object.freeze({ service: "persistent_specialist_journey/v1", actionCount: 1, finalStatus: assessed.case.status, configurationChecksumSha256: configuration.configurationChecksumSha256, caseChecksumSha256: assessed.case.caseChecksumSha256, resultChecksumSha256: assessed.action.resultChecksumSha256 });
  }
  return executeTradeSpecialistPath(opened.state, fixture.tenantId, journeyType, configuration, now);
}

function executeTradeSpecialistPath(initialState, tenantId, journeyType, configuration, now) {
  let state = initialState;
  let actionCount = 0;
  const act = (suffix, actionType, payload) => {
    const executed = executeSpecialistAction(state, tenantId, `${journeyType}-${suffix}`, actionType, payload, now, `case-${journeyType}`);
    if (executed.blocked) fail("journey_generated_conformance_trade_path_blocked", `The ${actionType} specialist action was blocked.`);
    state = executed.state;
    actionCount += 1;
    return executed;
  };
  act("supplier", "register_party", tradeParty("supplier", "supplier"));
  act("buyer", "register_party", tradeParty("buyer", "buyer"));
  if (journeyType === "supply_chain_finance") act("anchor", "register_party", tradeParty("anchor", "anchor"));
  const documentType = journeyType === "purchase_order_finance" ? "purchase_order" : journeyType === "trade_finance_workflow" ? "trade_order" : "invoice";
  const assetId = `asset-${journeyType}`;
  act("asset", "register_asset", {
    assetId,
    idempotencyKey: `asset/${journeyType}`,
    assetType: documentType,
    supplierId: "supplier",
    buyerId: "buyer",
    ...(journeyType === "supply_chain_finance" ? { anchorId: "anchor" } : {}),
    externalRef: `external/${journeyType}`,
    faceValuePaise: "500000",
    issueDate: "2026-01-01",
    dueDate: "2026-02-01",
    documents: [{ type: documentType, evidenceRef: `document/${documentType}` }],
    ...(journeyType === "invoice_discounting" ? { assignment: { status: "acknowledged", noticeRef: "assignment/notice", acknowledgementRef: "assignment/acknowledgement" } } : {}),
    ...(["purchase_order_finance", "trade_finance_workflow"].includes(journeyType) ? { shipment: { incoterm: "FOB", destination: "IN", evidenceRef: "shipment/evidence" } } : {})
  });
  const transactionId = `transaction-${journeyType}`;
  act("transaction", "approve_transaction", { transactionId, idempotencyKey: `transaction/${journeyType}`, assetId, requestedPaise: "400000", eligiblePaise: "400000", milestones: [{ name: "credit_approved", status: "completed", evidenceRef: "credit/approved" }], accountingRef: `accounting/${journeyType}` });
  act("draw", "draw", { transactionId, drawId: `draw-${journeyType}`, amountPaise: "400000", disbursementInstructionRef: "bank/disbursement", beneficiaryVerificationRef: "bank/beneficiary", accountingPostingRef: "accounting/draw" });
  const settled = act("settle", "settle", { transactionId, settlementId: `settlement-${journeyType}`, proceedsPaise: "405000", principalAllocationPaise: "400000", interestAllocationPaise: "4000", feeAllocationPaise: "1000", supplierSurplusPaise: "0", bankReceiptRef: "bank/receipt", accountingPostingRef: "accounting/settlement" });
  if (settled.result?.status !== "settled" || settled.case.status !== "assessed") fail("journey_generated_conformance_trade_path_incomplete", "The persistent trade journey did not reach exact settlement.");
  return Object.freeze({ service: "persistent_specialist_journey/v1", actionCount, finalStatus: settled.case.status, configurationChecksumSha256: configuration.configurationChecksumSha256, caseChecksumSha256: settled.case.caseChecksumSha256, resultChecksumSha256: settled.action.resultChecksumSha256 });
}

function executeSpecialistAction(state, tenantId, suffix, actionType, payload, now, caseId = `case-${suffix}`) {
  const proposed = proposeSpecialistJourneyAction(state, { tenantId, caseId, actionId: `action-${suffix}`, actionType, payload, idempotencyKey: `action/${suffix}`, proposedBy: "jd05-specialist-maker" }, now);
  return approveSpecialistJourneyAction(proposed.state, { tenantId, actionId: proposed.action.actionId, approvedBy: "jd05-specialist-checker", approvalRef: `approval/${suffix}` }, now);
}

function executeComposedArchetypePath(fixture, template, schema) {
  const journeyType = fixture.account.productType;
  const h = "b".repeat(64);
  const created = createComposedJourneyInstance({ tenantProductSubscriptions: { "jd05-all": { subscriptionId: "jd05-all", tenantId: fixture.tenantId, productTypes: [journeyType], effectiveFrom: "2025-01-01T00:00:00.000Z", validUntil: "2030-01-01T00:00:00.000Z", status: "active" } } }, {
    tenantId: fixture.tenantId,
    lifecycleId: `jd05-archetype-${journeyType}`,
    journeyType,
    subjectRef: `subject/${journeyType}`,
    applicationRef: `application/${journeyType}`,
    requestedAmountPaise: "12000000",
    assignedPrincipalIds: ["jd05-maker", "jd05-checker"],
    idempotencyKey: `jd05-archetype-${journeyType}`,
    createdBy: "jd05-maker",
    lineage: {
      productTemplateRef: template.templateId, productTemplateVersion: template.version, productTemplateChecksumSha256: template.templateChecksumSha256,
      workspaceSchemaId: schema.schemaId, workspaceSchemaVersion: schema.schemaVersion, workspaceSchemaChecksumSha256: schema.schemaChecksumSha256,
      policyBundleRef: `policy/${journeyType}`, policyBundleVersion: 1, policyBundleChecksumSha256: h,
      workflowRef: `workflow/${journeyType}`, workflowVersion: 1, workflowChecksumSha256: h,
      accountingPolicyRef: template.accountingProfile, accountingPolicyVersion: 1, accountingPolicyChecksumSha256: h,
      tenantConfigurationRef: `configuration/${fixture.tenantId}`, tenantConfigurationVersion: 1, tenantConfigurationChecksumSha256: h,
      accessGrantSnapshotRef: "access/jd05", accessGrantSnapshotChecksumSha256: h
    }
  }, fixture.account.openedAt);
  return Object.freeze({ service: "composed_journey_lifecycle/v1", actionCount: 1, finalStatus: created.lifecycle.status, lifecycleChecksumSha256: created.lifecycle.lifecycleChecksumSha256 });
}

function specialistKernelConfiguration(journeyType) {
  if (!SPECIALIST_JOURNEY_TYPE_TO_FAMILY[journeyType]) return { facilityLimitPaise: "1000000", singleObligorLimitPaise: "800000", maxConcentrationBps: 8000, advanceRateBps: 8000, requiredMilestones: ["credit_approved"], requiredDocuments: [journeyType === "purchase_order_finance" ? "purchase_order" : journeyType === "trade_finance_workflow" ? "trade_order" : "invoice"], msmeBinding: { productType: "msme_working_capital", productConfigRef: "product/msme-working-capital", udyamRequired: true } };
  return { minimumAmountPaise: "100", maximumAmountPaise: "1000000", maximumLtvPercent: "75.0000", eligibilityPolicyRef: "eligibility/v1", kycControlRef: "kyc/v1", agreementTemplateRef: "agreement/v1", servicingPolicyRef: "servicing/v1", collateralPolicyRef: "collateral/v1" };
}

function specialistFacts(family) {
  const base = { requestedAmountPaise: "500000" };
  if (["home", "lap", "secured_business"].includes(family)) return { ...base, propertyRef: "property/1", titleReviewStatus: "clear", valuationRef: "valuation/1", ...(family === "home" ? { constructionStageRef: "stage/1", stageCertified: true } : {}) };
  if (["personal_vehicle", "commercial_vehicle"].includes(family)) return { ...base, vehicleQuotationRef: "vehicle/quotation", dealerId: "dealer/1", dealerVerified: true, registrationPlanRef: "vehicle/registration", ...(family === "commercial_vehicle" ? { permitVerified: true } : {}) };
  if (["equipment", "green_equipment"].includes(family)) return { ...base, supplierId: "supplier/1", invoiceRef: "invoice/1", assetSerialNumber: "SERIAL-1", installationRequired: true, installationCertified: true, ...(family === "green_equipment" ? { greenTaxonomyEvidenceRef: "green/evidence" } : {}) };
  if (family === "gold") return { ...base, assayRef: "assay/1", grossWeightMg: "10000", netGoldWeightMg: "9000", purityPercent: "91.6000", packetId: "packet/1", custodyStatus: "sealed_received", auctionPolicyRef: "auction/v1", collateralValuePaise: "1000000" };
  if (family === "education") return { ...base, institutionRef: "institution/1", courseRef: "course/1", admissionVerified: true, coBorrowerId: "co-borrower/1", moratoriumMonths: 6 };
  if (family === "agriculture_allied") return { ...base, landOrActivityEvidenceRef: "agriculture/land", cropOrAlliedActivity: "crop", seasonRef: "season/kharif", harvestOrCashflowDate: "2026-09-01", weatherAndPriceRiskAssessed: true };
  if (family === "microfinance_group") return { ...base, groupId: "group/1", householdIncomeAssessed: true, householdIndebtednessAssessed: true, groupConductAccepted: true, noCoerciveRecoveryAcknowledged: true };
  if (family === "consumer_durable") return { ...base, merchantId: "merchant/1", merchantVerified: true, sku: "SKU-1", invoiceRef: "invoice/1", invoiceAmountPaise: "500000" };
  if (family === "professional_practice") return { ...base, professionalRegistrationRef: "registration/1", registrationActive: true, practiceCashflowRef: "cashflow/1", assetBacked: false };
  fail("journey_generated_conformance_specialist_fixture_missing", `No specialist fixture exists for ${family}.`);
}

function tradeParty(partyId, role) { return { partyId, role, name: partyId, legalEntityRef: `legal/${partyId}`, kycEvidenceRef: `kyc/${partyId}`, bankVerificationRef: `bank/${partyId}`, sanctionsScreeningRef: `screen/${partyId}`, residencyCountry: "IN", ...(role === "supplier" ? { udyamRef: "udyam/1" } : {}), ...(role === "anchor" ? { anchorProgrammeRef: "anchor/programme" } : {}) }; }

function executeMissingEvidenceDenial(account, now) {
  const denied = generateClosureCertificate(account, {}, now);
  if (denied.summary.status !== "blocked" || denied.closureCertificate !== null || denied.loanAccount !== account) {
    fail("journey_generated_conformance_missing_evidence_permitted", "Closure without zero-balance evidence must fail closed without mutation.");
  }
  return Object.freeze({ stage: "missing_evidence", outcome: "blocked_as_expected", findingCodes: denied.findings.map((finding) => finding.controlId), evidenceChecksumSha256: hash(denied.findings) });
}

function executeDuplicateFinancialReplay(fixture, now) {
  const input = { amount: fixture.schedule[0].totalDue, receivedAt: now.toISOString(), paymentRef: `jd05-replay-${fixture.account.productType}`, channel: "synthetic_conformance", actor: "jd05-borrower" };
  const first = postPaymentToLoanAccount(fixture.account, input, now);
  requireReady(first, "initial_repayment");
  const replay = postPaymentToLoanAccount(first.loanAccount, input, now);
  if (replay.summary.status !== "blocked" || replay.duplicate !== true || replay.paymentEvent?.eventId !== first.paymentEvent.eventId || replay.loanAccount.ledger.length !== first.loanAccount.ledger.length) {
    fail("journey_generated_conformance_duplicate_effect", "A duplicate payment reference must preserve the original effect without another ledger event.");
  }
  return Object.freeze({ stage: "duplicate_replay", duplicateRejected: true, ledgerEventCount: replay.loanAccount.ledger.length, originalEventChecksumSha256: hash(stablePaymentEvidence(first.paymentEvent)) });
}

function executeSelfApprovalDenial(fixture, now) {
  const saga = planTenantProvisioningSaga({ tenantId: fixture.tenantId, sagaId: `jd05-four-eyes-${fixture.account.productType}`, idempotencyKey: `jd05-four-eyes-${fixture.account.productType}`, mode: "tenant_launch", requestedProducts: [fixture.account.productType], activeProductsSnapshot: [], createdBy: "jd05-admin" }, now);
  let denied = null;
  try {
    approveIrreversibleProvisioningStep(saga, { tenantId: fixture.tenantId, stepId: "migration", proposedBy: "jd05-maker", approvedBy: "jd05-maker", approvalRef: "approval://jd05/self" }, now);
  } catch (cause) {
    denied = cause;
  }
  if (denied?.code !== "provisioning_four_eyes_required") fail("journey_generated_conformance_self_approval_permitted", "A maker must not approve their own irreversible step.");
  return Object.freeze({ stage: "self_approval", outcome: "blocked_as_expected", reasonCode: denied.code });
}

function executeReconciliationMismatch(fixture, now) {
  const rail = { paymentRailId: `jd05-rail-${fixture.account.productType}`, providerRef: `jd05-provider-${fixture.account.productType}`, loanAccountId: fixture.account.loanAccountId, type: "upi_collect", amount: fixture.schedule[0].totalDue, currency: "INR", channel: "upi" };
  const reconciled = reconcilePaymentRailSettlement({ paymentRails: { [rail.paymentRailId]: rail }, loanAccounts: { [fixture.account.loanAccountId]: fixture.account } }, {
    reconciliationId: `jd05-reconciliation-${fixture.account.productType}`,
    paymentRailId: rail.paymentRailId,
    providerRef: rail.providerRef,
    providerEventRef: `jd05-provider-event-${fixture.account.productType}`,
    status: "settled",
    amount: rail.amount + 1,
    currency: "INR",
    settledAt: now.toISOString()
  }, now);
  if (reconciled.reconciliation?.outcome !== "exception" || reconciled.reconciliation?.exceptionCode !== "amount_mismatch" || reconciled.paymentEvent || reconciled.loanAccounts[fixture.account.loanAccountId].ledger.length !== fixture.account.ledger.length) {
    fail("journey_generated_conformance_reconciliation_permitted", "A settlement mismatch must remain an exception without a ledger effect.");
  }
  return Object.freeze({ stage: "reconciliation_mismatch", outcome: reconciled.reconciliation.outcome, exceptionCode: reconciled.reconciliation.exceptionCode, ledgerMutationRejected: true, evidenceChecksumSha256: hash(reconciled.reconciliation) });
}

function executeFullDownstreamLifecycle(fixture, now) {
  return [
    executeBalancedAccounting(fixture.account),
    executeReporting(fixture.account, now),
    ...executeRepaymentDelinquencyClosure(fixture, now),
    executeRollback(fixture, now),
    executeAuditReplay(fixture, now)
  ];
}

function executeBalancedAccounting(account) {
  const journals = buildLoanJournalEntries(account);
  if (!journals.length || journals.some((journal) => Math.round(journal.debitTotal * 100) !== Math.round(journal.creditTotal * 100))) {
    fail("journey_generated_conformance_accounting_unbalanced", "Repository journal projection did not balance exactly.");
  }
  return Object.freeze({ stage: "accounting", journalCount: journals.length, journalChecksumSha256: hash(journals) });
}

function executeReporting(account, now) {
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  const statement = generateLoanStatement(account, { periodStart: now.toISOString(), periodEnd: periodEnd.toISOString() }, periodEnd);
  const cic = generateCicSnapshot(account, periodEnd);
  if (statement.loanAccountId !== account.loanAccountId || cic.loanAccountId !== account.loanAccountId || cic.reportingPurpose !== "credit_information_company_snapshot") {
    fail("journey_generated_conformance_reporting_incomplete", "Statement and regulatory snapshot lineage are required.");
  }
  return Object.freeze({
    stage: "reporting",
    statementTransactionCount: statement.transactions.length,
    statementChecksumSha256: hash({ ...statement, statementId: null }),
    regulatoryPurpose: cic.reportingPurpose,
    regulatoryChecksumSha256: hash({ ...cic, snapshotId: null, generatedAt: null })
  });
}

function executeRepaymentDelinquencyClosure(fixture, now) {
  const firstDue = fixture.schedule[0];
  const delinquencyAsOf = new Date(`${firstDue.dueDate}T00:00:00.000Z`);
  delinquencyAsOf.setUTCDate(delinquencyAsOf.getUTCDate() + 10);
  const delinquency = computeDelinquency(fixture.account, delinquencyAsOf);
  if (delinquency.daysPastDue < 10 || delinquency.totalOverdue <= 0) {
    fail("journey_generated_conformance_delinquency_missing", "The repository did not derive the expected overdue state.");
  }

  const repayment = postPaymentToLoanAccount(fixture.account, {
    amount: firstDue.totalDue,
    receivedAt: delinquencyAsOf.toISOString(),
    paymentRef: `jd05-installment-${fixture.account.productType}`,
    channel: "synthetic_conformance",
    actor: "jd05-borrower"
  }, delinquencyAsOf);
  requireReady(repayment, "repayment");
  if (!repayment.paymentEvent || repayment.duplicate === true || repayment.loanAccount.ledger.length !== fixture.account.ledger.length + 1) {
    fail("journey_generated_conformance_repayment_incomplete", "A single immutable repayment effect is required.");
  }

  const closureAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 20));
  const quote = quoteForeclosure(fixture.account, { asOf: closureAt.toISOString() }, closureAt);
  requireReady(quote, "foreclosure_quote");
  if (!quote.quote || quote.quote.payoffAmount <= 0) fail("journey_generated_conformance_closure_quote_missing", "A positive payoff quote is required.");
  const closure = forecloseLoanAccount(fixture.account, {
    foreclosedAt: closureAt.toISOString(),
    amount: quote.quote.payoffAmount,
    paymentRef: `jd05-closure-${fixture.account.productType}`,
    foreclosureId: `jd05-foreclosure-${fixture.account.productType}`,
    actor: "jd05-borrower"
  }, closureAt);
  requireReady(closure, "foreclosure");
  if (closure.loanAccount.status !== "closed" || !closure.foreclosure) fail("journey_generated_conformance_closure_incomplete", "The account must close with foreclosure evidence.");
  const certificate = generateClosureCertificate(closure.loanAccount, {
    certificateId: `jd05-noc-${fixture.account.productType}`,
    issuedBy: "jd05-operations"
  }, closureAt);
  requireReady(certificate, "closure_certificate");
  if (!certificate.closureCertificate?.checksumSha256) fail("journey_generated_conformance_closure_evidence_missing", "A checksummed closure certificate is required.");

  return [
    Object.freeze({ stage: "delinquency", daysPastDue: delinquency.daysPastDue, bucket: delinquency.bucket, evidenceChecksumSha256: hash(delinquency) }),
    Object.freeze({ stage: "repayment", paymentRef: repayment.paymentEvent.paymentRef, ledgerEventCount: repayment.loanAccount.ledger.length, evidenceChecksumSha256: hash(stablePaymentEvidence(repayment.paymentEvent)) }),
    Object.freeze({ stage: "closure", status: closure.loanAccount.status, closureCertificateChecksumSha256: certificate.closureCertificate.checksumSha256 })
  ];
}

function executeRollback(fixture, now) {
  const input = {
    tenantId: fixture.tenantId,
    sagaId: `jd05-rollback-${fixture.account.productType}`,
    idempotencyKey: `jd05-rollback-${fixture.account.productType}`,
    mode: "tenant_launch",
    requestedProducts: [fixture.account.productType],
    activeProductsSnapshot: [],
    createdBy: "jd05-admin"
  };
  let saga = planTenantProvisioningSaga(input, now);
  let leased = acquireProvisioningStep(saga, { tenantId: fixture.tenantId, workerId: "jd05-worker" }, now);
  saga = completeProvisioningStep(leased.saga, {
    tenantId: fixture.tenantId,
    stepId: leased.step.stepId,
    workerId: "jd05-worker",
    fence: leased.step.lease.fence,
    checkpointRef: "evidence://jd05/namespace",
    evidenceChecksumSha256: hash({ journeyType: fixture.account.productType, step: leased.step.stepId })
  }, now);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    leased = acquireProvisioningStep(saga, { tenantId: fixture.tenantId, workerId: "jd05-worker" }, now);
    saga = failProvisioningStep(leased.saga, {
      tenantId: fixture.tenantId,
      stepId: leased.step.stepId,
      workerId: "jd05-worker",
      fence: leased.step.lease.fence,
      errorCode: "synthetic_provider_failure",
      errorEvidenceRef: `evidence://jd05/failure/${attempt}`,
      retryDelayMs: 0
    }, now);
  }
  if (saga.status !== "rollback_required") fail("journey_generated_conformance_rollback_not_required", "Exhausted execution must require rollback.");
  let compensation = nextProvisioningCompensation(saga, { tenantId: fixture.tenantId, workerId: "jd05-rollback" }, now);
  saga = recordProvisioningCompensation(compensation.saga, {
    tenantId: fixture.tenantId,
    stepId: compensation.step.stepId,
    workerId: "jd05-rollback",
    fence: compensation.step.compensation.fence,
    success: true,
    evidenceRef: "evidence://jd05/compensation/namespace"
  }, now);
  compensation = nextProvisioningCompensation(saga, { tenantId: fixture.tenantId, workerId: "jd05-rollback" }, now);
  if (compensation.step !== null || compensation.saga.status !== "rolled_back") {
    fail("journey_generated_conformance_rollback_incomplete", "Governed compensation must reach rolled_back.");
  }
  return Object.freeze({ stage: "rollback", status: compensation.saga.status, eventCount: compensation.saga.events.length, evidenceChecksumSha256: hash(compensation.saga.events) });
}

function executeAuditReplay(fixture, now) {
  const rawEvents = fixture.account.ledger.map((event) => ({
    eventId: `audit-${event.eventId}`,
    type: `loan.${event.type}`,
    loanAccountId: fixture.account.loanAccountId,
    productType: fixture.account.productType,
    actor: event.actor,
    at: event.eventDate
  }));
  const sealed = sealAuditChain(rawEvents, fixture.tenantId, { now });
  const replayed = sealAuditChain(sealed, fixture.tenantId, { now });
  const integrity = verifyAuditChain(replayed, fixture.tenantId);
  const transplanted = verifyAuditChain(replayed, `${fixture.tenantId}-other`);
  const pack = buildAuditEvidencePack(replayed, fixture.tenantId, { now });
  if (!integrity.valid || transplanted.valid || pack.integrity.valid !== true || pack.eventCount !== rawEvents.length || replayed.some((event, index) => event.hash !== sealed[index].hash)) {
    fail("journey_generated_conformance_audit_replay_diverged", "Audit replay must be byte-stable, tenant-bound and integrity-valid.");
  }
  return Object.freeze({ stage: "audit_replay", eventCount: pack.eventCount, headHash: pack.headHash, tenantTransplantRejected: true });
}

function requireReady(value, stage) {
  if (value?.summary?.status !== "ready") fail("journey_generated_conformance_dependency_blocked", `${stage} did not produce ready evidence.`);
}

function stablePaymentEvidence({ eventId: _runtimeGeneratedEventId, ...event }) { return event; }

function result(testCase, outcome, reasonCode, evidenceRef, observation = null) {
  const core = { caseId: testCase.caseId, journeyType: testCase.journeyType, scenarioId: testCase.scenarioId, laneId: testCase.laneId, outcome, reasonCode, evidenceRef, observation };
  return Object.freeze({ ...core, evidenceChecksumSha256: hash(core) });
}

function safeToken(value) { return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-"); }
function instant(value, field) { const result = value instanceof Date ? new Date(value) : new Date(value); if (!Number.isFinite(result.getTime())) fail("journey_generated_conformance_input_invalid", `${field} must be a valid timestamp.`); return result; }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("journey_generated_conformance_input_invalid", `${field} is required.`); return value.trim(); }
function canonical(value) { if (value === undefined) return "null"; if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value); if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; throw new Error("invalid_json"); }
function hash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
