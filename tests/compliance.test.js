import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  attachKfs,
  buildAuditEvidencePack,
  buildKeyFactStatement,
  classifyLoanAsset,
  clearGlobalKillSwitch,
  computeDelinquency,
  computeIncidentReportingClock,
  classifyAuditDataClass,
  classifyFraudCase,
  assessErasureEligibility,
  createErasureRequest,
  createFraudCase,
  generateFraudCommitteePack,
  createIncident,
  createModelRegistryState,
  evaluateKycStatus,
  fulfillErasureRequest,
  issueShowCauseNotice,
  recordDriftObservation,
  recordFraudResponse,
  recordIncidentNotification,
  stampAuditEvents,
  recordPostIncidentReview,
  ELIGIBILITY_DECISIONS,
  estimateEmi,
  evaluateEligibility,
  evaluateLoanApplication,
  evaluateModelUse,
  generateDlaCimsExport,
  generateRepaymentSchedule,
  registerModel,
  sealAuditChain,
  transitionModel,
  verifyAuditChain,
  resolveBorrowerApplicationReferences,
  resolveLoanApplicationReferences,
  triggerKillSwitch,
  upsertBeneficialOwner,
  upsertDigitalLendingApp,
  upsertLendingServiceProvider,
  upsertBorrowerProfile,
  upsertConsentRecord,
  upsertKycRecord,
  selectProductPolicyVersion,
  upsertProductPolicy,
  upsertRecoveryAgent,
  upsertRegulatedEntity,
  validateKfs,
  validateKfsBeforeDecision,
  validateMarketplaceNeutrality,
  rankMarketplaceOffers
} from "../packages/core/src/index.js";
import { createLoanOsServer } from "../apps/api/src/server.js";

// Every data-plane request runs inside a tenant. Tests bootstrap a primary
// tenant (A) and inject its api key by default; the isolation suite adds a
// second tenant (B) to prove cross-tenant access is impossible.
const TENANT_A = { tenantId: "tnt_test_a", name: "Test RE A", apiKey: "test-key-a" };
const TENANT_B = { tenantId: "tnt_test_b", name: "Test RE B", apiKey: "test-key-b" };
const DEFAULT_TEST_KEY = TENANT_A.apiKey;

function apiFetch(url, init = {}, apiKey = DEFAULT_TEST_KEY) {
  const headers = { ...(init.headers ?? {}) };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return globalThis.fetch(url, { ...init, headers });
}

function rawFetch(url, init = {}) {
  return globalThis.fetch(url, init);
}

test("valid India-only loan application passes preflight", () => {
  const result = evaluateLoanApplication(validApplication());

  assert.equal(result.summary.status, "ready");
  assert.equal(result.summary.errorCount, 0);
});

test("non-India borrower and currency are blocked", () => {
  const app = merge(validApplication(), {
    borrower: {
      residencyCountry: "US",
      primaryAddressCountry: "US"
    },
    product: {
      currency: "USD"
    },
    dataResidency: {
      primaryStorageCountry: "US"
    }
  });

  const result = evaluateLoanApplication(app);

  assert.equal(result.summary.status, "blocked");
  assert(result.findings.some((finding) => finding.path === "borrower.residencyCountry"));
  assert(result.findings.some((finding) => finding.path === "product.currency"));
  assert(result.findings.some((finding) => finding.path === "dataResidency.primaryStorageCountry"));
});

test("LSP pass-through fund flow is blocked", () => {
  const app = merge(validApplication(), {
    disbursement: {
      destinationAccount: {
        country: "IN",
        ifsc: "HDFC0000001",
        ownerRole: "lsp"
      }
    },
    repayment: {
      collectionAccount: {
        country: "IN",
        ifsc: "HDFC0000002",
        ownerRole: "pool_account"
      }
    }
  });

  const result = evaluateLoanApplication(app);

  assert.equal(result.summary.status, "blocked");
  assert(result.findings.some((finding) => finding.message.includes("cannot control fund flow")));
});

test("Aadhaar biometric or OTP persistence is blocked", () => {
  const app = merge(validApplication(), {
    kyc: {
      aadhaar: {
        biometricStored: true,
        otpStored: false,
        pidStored: false
      }
    }
  });

  const result = evaluateLoanApplication(app);

  assert.equal(result.summary.status, "blocked");
  assert(result.findings.some((finding) => finding.controlId === "UIDAI-AADHAAR"));
});

test("KFS must include RBI-required lending disclosures", () => {
  const app = validApplication();
  const kfs = buildKeyFactStatement(app, {
    principalAmount: 100000,
    tenorMonths: 12,
    annualInterestRateBps: 1800,
    aprBps: 2100,
    coolingOffDays: 0,
    recoveryMechanism: "NACH debit to RE account",
    penalCharges: [
      {
        name: "Late payment penalty",
        reason: "Default in repayment",
        type: "penal_interest",
        amount: 500,
        capitalizes: true
      }
    ]
  });

  const result = validateKfs(kfs);

  assert.equal(result.summary.status, "blocked");
  assert(result.findings.some((finding) => finding.path === "kfs.coolingOffDays"));
  assert(result.findings.some((finding) => finding.controlId === "RBI-FPC-PENAL"));
});

test("KFS acceptance and delivery evidence gates sanction readiness", () => {
  const app = validApplication();
  const kfs = buildKeyFactStatement(app, {
    principalAmount: 100000,
    tenorMonths: 12,
    annualInterestRateBps: 1800,
    aprBps: 2100,
    coolingOffDays: 1,
    recoveryMechanism: "NACH debit to RE account"
  });
  const withoutAcceptance = attachKfs(app, kfs);
  const withAcceptance = attachKfs(app, kfs, {
    acceptedAt: "2026-07-08T07:00:00.000Z",
    deliveryChannel: "email",
    deliveryRef: "email_msg_123"
  });

  assert.equal(validateKfsBeforeDecision(withoutAcceptance).summary.status, "blocked");
  assert.equal(validateKfsBeforeDecision(withAcceptance).summary.status, "ready");
});

test("repayment schedule amortizes principal over tenor", () => {
  const result = generateRepaymentSchedule({
    principalAmount: 100000,
    annualInterestRateBps: 1200,
    tenorMonths: 12,
    startDate: "2026-07-08T00:00:00.000Z"
  });

  assert.equal(result.summary.status, "ready");
  assert.equal(result.schedule.length, 12);
  assert.equal(result.schedule.at(-1).closingPrincipal, 0);
  assert(result.schedule[0].interestDue > 0);
  assert(result.schedule[0].principalDue > 0);
});

test("delinquency computation buckets unpaid installments", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
  const asOf = `${addDays(account.schedule[0].dueDate, 10)}T00:00:00.000Z`;
  const delinquency = computeDelinquency(account, new Date(asOf));

  assert.equal(delinquency.bucket, "dpd_1_30");
  assert(delinquency.daysPastDue >= 10);
  assert.equal(delinquency.earliestUnpaidDueDate, account.schedule[0].dueDate);
  assert(delinquency.totalOverdue > 0);
});

test("asset classification promotes overdue accounts through SMA to NPA", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
  const firstDueDate = account.schedule[0].dueDate;

  assert.equal(classifyLoanAsset(account, new Date(`${firstDueDate}T00:00:00.000Z`)).assetClass, "standard");
  assert.equal(classifyLoanAsset(account, new Date(`${addDays(firstDueDate, 1)}T00:00:00.000Z`)).assetClass, "sma_0");
  assert.equal(classifyLoanAsset(account, new Date(`${addDays(firstDueDate, 45)}T00:00:00.000Z`)).assetClass, "sma_1");
  assert.equal(classifyLoanAsset(account, new Date(`${addDays(firstDueDate, 75)}T00:00:00.000Z`)).assetClass, "sma_2");
  assert.equal(classifyLoanAsset(account, new Date(`${addDays(firstDueDate, 91)}T00:00:00.000Z`)).assetClass, "npa");
});

test("AI model kill switch blocks credit-impacting model use", () => {
  const baseRegistry = createModelRegistryState();
  const registered = registerModel(baseRegistry, {
    modelId: "uw_score_v1",
    name: "Underwriting scorecard",
    owner: "risk",
    purpose: "credit_underwriting",
    riskTier: "high",
    validationStatus: "approved",
    independentValidationRef: "ivr_001",
    materialDecision: true,
    actor: "model-risk"
  });
  const app = merge(validApplication(), {
    aiDecision: {
      modelId: "uw_score_v1",
      humanReviewRef: "review_001"
    }
  });

  const allowed = evaluateLoanApplication(app, {
    modelRegistry: registered.registry
  });
  assert.equal(allowed.summary.status, "ready");

  const killed = triggerKillSwitch(registered.registry, {
    scope: "model",
    modelId: "uw_score_v1",
    reason: "Bias drift detected in monitoring",
    actor: "chief-risk-officer"
  });
  const blocked = evaluateLoanApplication(app, {
    modelRegistry: killed.registry
  });

  assert.equal(blocked.summary.status, "blocked");
  assert(blocked.findings.some((finding) => finding.message.includes("not active")));
});

test("model lifecycle enforces validation before a model can be used", () => {
  const base = createModelRegistryState();
  const registered = registerModel(base, {
    modelId: "uw_llm_v2",
    name: "Underwriting assistant",
    owner: "risk-owner",
    purpose: "credit_underwriting",
    riskTier: "high",
    validationStatus: "pending",
    materialDecision: true,
    actor: "model-risk"
  });
  assert.equal(registered.model.status, "draft");
  assert.equal(evaluateModelUse(registered.registry, { modelId: "uw_llm_v2", humanReviewRef: "hr_1" }).allowed, false);

  // Cannot jump straight from draft to active.
  const badJump = transitionModel(registered.registry, { modelId: "uw_llm_v2", action: "activate", actor: "model-risk" });
  assert.equal(badJump.summary.status, "blocked");
  assert(badJump.findings.some((finding) => finding.path === "status"));

  const submitted = transitionModel(registered.registry, {
    modelId: "uw_llm_v2",
    action: "submit_for_validation",
    actor: "risk-owner"
  });
  assert.equal(submitted.model.status, "validation_pending");

  // Approval requires independent validation evidence.
  const noEvidence = transitionModel(submitted.registry, { modelId: "uw_llm_v2", action: "approve_validation", actor: "validator-1" });
  assert.equal(noEvidence.summary.status, "blocked");
  assert(noEvidence.findings.some((finding) => finding.path === "independentValidationRef"));

  // The approver cannot be the model owner.
  const ownerApproves = transitionModel(submitted.registry, {
    modelId: "uw_llm_v2",
    action: "approve_validation",
    actor: "risk-owner",
    independentValidationRef: "ivr_9",
    fairnessAssessmentRef: "fair_9",
    explainabilityRef: "xai_9",
    monitoringPlanRef: "mon_9"
  });
  assert.equal(ownerApproves.summary.status, "blocked");
  assert(ownerApproves.findings.some((finding) => finding.path === "actor"));

  // A high-risk model requires fairness, explainability, and monitoring evidence.
  const missingHighRisk = transitionModel(submitted.registry, {
    modelId: "uw_llm_v2",
    action: "approve_validation",
    actor: "validator-1",
    independentValidationRef: "ivr_9"
  });
  assert.equal(missingHighRisk.summary.status, "blocked");
  assert(missingHighRisk.findings.some((finding) => finding.path === "fairnessAssessmentRef"));

  const approved = transitionModel(submitted.registry, {
    modelId: "uw_llm_v2",
    action: "approve_validation",
    actor: "validator-1",
    independentValidationRef: "ivr_9",
    fairnessAssessmentRef: "fair_9",
    explainabilityRef: "xai_9",
    monitoringPlanRef: "mon_9"
  });
  assert.equal(approved.summary.status, "ready");
  assert.equal(approved.model.status, "approved");
  assert.equal(approved.model.validationStatus, "approved");
  assert.equal(approved.model.validatedBy, "validator-1");
  // Approved but not yet activated cannot be used.
  assert.equal(evaluateModelUse(approved.registry, { modelId: "uw_llm_v2", humanReviewRef: "hr_1" }).allowed, false);

  const active = transitionModel(approved.registry, { modelId: "uw_llm_v2", action: "activate", actor: "model-risk" });
  assert.equal(active.model.status, "active");
  assert.equal(evaluateModelUse(active.registry, { modelId: "uw_llm_v2", humanReviewRef: "hr_1" }).allowed, true);

  const retired = transitionModel(active.registry, {
    modelId: "uw_llm_v2",
    action: "retire",
    actor: "model-risk",
    reason: "Superseded by v3"
  });
  assert.equal(retired.model.status, "retired");
  assert.equal(evaluateModelUse(retired.registry, { modelId: "uw_llm_v2", humanReviewRef: "hr_1" }).allowed, false);
});

test("API drives the model lifecycle from draft to active", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const register = await postJson(`${base}/ai/models`, {
    modelId: "col_llm_v1",
    name: "Collections assistant",
    owner: "risk-owner",
    purpose: "collections",
    riskTier: "medium",
    validationStatus: "pending",
    actor: "model-risk"
  });
  assert.equal(register.status, 201);
  assert.equal(register.body.model.status, "draft");

  assert.equal(
    (await postJson(`${base}/ai/models/col_llm_v1/transitions`, { action: "submit_for_validation", actor: "risk-owner" })).status,
    200
  );
  const approve = await postJson(`${base}/ai/models/col_llm_v1/transitions`, {
    action: "approve_validation",
    actor: "validator-1",
    independentValidationRef: "ivr_1"
  });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.model.status, "approved");

  const activate = await postJson(`${base}/ai/models/col_llm_v1/transitions`, { action: "activate", actor: "model-risk" });
  assert.equal(activate.status, 200);
  assert.equal(activate.body.model.status, "active");

  const models = await (await apiFetch(`${base}/ai/models`)).json();
  assert.equal(models.models.col_llm_v1.status, "active");

  // A transition from the wrong state surfaces a 422.
  const badActivate = await postJson(`${base}/ai/models/col_llm_v1/transitions`, { action: "activate", actor: "model-risk" });
  assert.equal(badActivate.status, 422);
  assert.equal(badActivate.body.error.code, "model_transition_blocked");

  // Drift monitoring on the active model: a breach auto-suspends it.
  const stable = await postJson(`${base}/ai/models/col_llm_v1/drift-observations`, {
    metric: "psi",
    value: 0.1,
    threshold: 0.25,
    actor: "monitor"
  });
  assert.equal(stable.status, 200);
  assert.equal(stable.body.breached, false);

  const breach = await postJson(`${base}/ai/models/col_llm_v1/drift-observations`, {
    metric: "psi",
    value: 0.4,
    threshold: 0.25,
    actor: "monitor"
  });
  assert.equal(breach.status, 200);
  assert.equal(breach.body.breached, true);
  assert.equal(breach.body.model.status, "suspended");
  assert.ok(breach.body.incident.incidentId);

  const events = await (await apiFetch(`${base}/audit/events`)).json();
  assert.ok(events.events.some((event) => event.type === "api.ai.model.drift_observed"));
});

test("API discloses customer-facing AI and records a human handoff", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // A back-office (non customer-facing) model has no customer disclosure.
  assert.equal(
    (await postJson(`${base}/ai/models`, {
      modelId: "score_bo",
      name: "Back-office score",
      owner: "risk-owner",
      purpose: "credit_scoring",
      riskTier: "medium",
      validationStatus: "approved",
      customerFacing: false,
      actor: "model-risk"
    })).status,
    201
  );
  const noDisclosure = await apiFetch(`${base}/ai/models/score_bo/disclosure`);
  assert.equal(noDisclosure.status, 422);

  // A customer-facing active model yields the mandated disclosure.
  assert.equal(
    (await postJson(`${base}/ai/models`, {
      modelId: "chat_v1",
      name: "Loan assistant",
      owner: "risk-owner",
      purpose: "customer support",
      riskTier: "medium",
      validationStatus: "approved",
      customerFacing: true,
      actor: "model-risk"
    })).status,
    201
  );
  const disclosure = await (await apiFetch(`${base}/ai/models/chat_v1/disclosure`)).json();
  assert.equal(disclosure.aiAssisted, true);
  assert.equal(disclosure.humanHandoffAvailable, true);
  assert.ok(disclosure.statement.includes("Loan assistant"));

  // A borrower requests a human; a support agent then resolves it.
  const handoff = await postJson(`${base}/ai/handoff-requests`, {
    borrowerId: "bor_001",
    modelId: "chat_v1",
    reason: "wants to discuss hardship options"
  });
  assert.equal(handoff.status, 201);
  assert.equal(handoff.body.handoffRequest.status, "pending");
  const handoffId = handoff.body.handoffRequest.handoffId;

  // Resolution requires a human agent.
  assert.equal(
    (await postJson(`${base}/ai/handoff-requests/${handoffId}/resolution`, {})).status,
    422
  );
  const resolved = await postJson(`${base}/ai/handoff-requests/${handoffId}/resolution`, {
    handledBy: "support-agent-1",
    resolutionNotes: "Discussed restructure; case opened"
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.handoffRequest.status, "handled");

  const pending = await (await apiFetch(`${base}/ai/handoff-requests?status=pending`)).json();
  assert.equal(pending.count, 0);
  const events = await (await apiFetch(`${base}/audit/events`)).json();
  assert.ok(events.events.some((event) => event.type === "ai.human_handoff.requested"));
  assert.ok(events.events.some((event) => event.type === "ai.human_handoff.handled"));
});

test("kill-switch clearance requires a post-incident review", () => {
  const base = createModelRegistryState();
  const killed = triggerKillSwitch(base, {
    scope: "global",
    reason: "Systemic hallucination spike in generative underwriting",
    actor: "chief-risk-officer"
  });
  assert.equal(killed.registry.globalKillSwitch.active, true);
  assert(killed.incident.incidentId);
  assert.equal(killed.registry.globalKillSwitch.incidentId, killed.incident.incidentId);
  assert.equal(killed.registry.incidents[killed.incident.incidentId].status, "open");

  // The switch cannot be cleared before a post-incident review.
  const earlyClear = clearGlobalKillSwitch(killed.registry, { actor: "coo", approvalRef: "board_ref_1" });
  assert.equal(earlyClear.summary.status, "blocked");
  assert(earlyClear.findings.some((finding) => finding.path === "incidentId"));

  // A review must capture root cause and remediation.
  const incompleteReview = recordPostIncidentReview(killed.registry, {
    incidentId: killed.incident.incidentId,
    reviewedBy: "model-risk",
    reviewRef: "pir_1"
  });
  assert.equal(incompleteReview.summary.status, "blocked");
  assert(incompleteReview.findings.some((finding) => finding.path === "rootCause"));

  const reviewed = recordPostIncidentReview(killed.registry, {
    incidentId: killed.incident.incidentId,
    reviewedBy: "model-risk",
    reviewRef: "pir_1",
    rootCause: "Prompt injection via unsanitised free-text field",
    remediation: "Input sanitisation and a guardrail classifier before the generative model"
  });
  assert.equal(reviewed.incident.status, "reviewed");

  const cleared = clearGlobalKillSwitch(reviewed.registry, { actor: "coo", approvalRef: "board_ref_1" });
  assert.equal(cleared.summary.status, "ready");
  assert.equal(cleared.registry.globalKillSwitch.active, false);
  assert.equal(cleared.registry.globalKillSwitch.clearanceApprovalRef, "board_ref_1");
  const closed = cleared.registry.incidents[killed.incident.incidentId];
  assert.equal(closed.status, "closed");
  // The original review evidence is retained after closure.
  assert.equal(closed.postIncidentReview.rootCause, "Prompt injection via unsanitised free-text field");
});

test("API clears the global kill switch only after a post-incident review", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const killed = await postJson(`${base}/ai/kill-switch`, {
    scope: "global",
    reason: "Systemic drift across scoring models",
    actor: "chief-risk-officer"
  });
  assert.equal(killed.status, 200);
  const incidentId = killed.body.incident.incidentId;
  assert(incidentId);

  const earlyClear = await postJson(`${base}/ai/kill-switch/clear`, { actor: "coo", approvalRef: "board_ref_1" });
  assert.equal(earlyClear.status, 422);
  assert(earlyClear.body.findings.some((finding) => finding.path === "incidentId"));

  const review = await postJson(`${base}/ai/incidents/${incidentId}/post-incident-review`, {
    reviewedBy: "model-risk",
    reviewRef: "pir_1",
    rootCause: "Feature pipeline regression",
    remediation: "Rollback and add drift alarms"
  });
  assert.equal(review.status, 200);
  assert.equal(review.body.incident.status, "reviewed");

  const cleared = await postJson(`${base}/ai/kill-switch/clear`, { actor: "coo", approvalRef: "board_ref_1" });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.registry.globalKillSwitch.active, false);
  assert.equal(cleared.body.incident.status, "closed");
});

test("regulated entity and product registries resolve an application", () => {
  const reResult = upsertRegulatedEntity({}, validRegulatedEntity());
  assert.equal(reResult.summary.status, "ready");

  const productResult = upsertProductPolicy({}, validProductPolicy(), reResult.registry);
  assert.equal(productResult.summary.status, "ready");

  const resolution = resolveLoanApplicationReferences(
    {
      regulatedEntityId: "re_example_nbfc",
      productId: "prod_personal_loan",
      requestedAmount: 150000,
      requestedTenorMonths: 18,
      borrower: validApplication().borrower,
      consent: validApplication().consent,
      kyc: validApplication().kyc,
      economicProfile: validApplication().economicProfile,
      disbursement: validApplication().disbursement,
      repayment: validApplication().repayment
    },
    {
      regulatedEntities: reResult.registry,
      productPolicies: productResult.registry
    }
  );
  const evaluation = evaluateLoanApplication(resolution.application);

  assert.equal(resolution.summary.status, "ready");
  assert.equal(evaluation.summary.status, "ready");
  assert.equal(resolution.application.tenant.regulatedEntityName, "Example India NBFC Ltd");
  assert.equal(resolution.application.product.productCode, "PL_IN_DIGITAL");
  assert.equal(resolution.application.product.requestedAmount, 150000);
});

test("regulated entity validation hardening rejects missing/invalid RE metadata", () => {
  // 1. validateRegulatedEntity rejects registration without rbiRegistrationNumber
  const invalidReInput = {
    ...validRegulatedEntity(),
    rbiRegistrationNumber: ""
  };
  const reResult = upsertRegulatedEntity({}, invalidReInput);
  assert.equal(reResult.summary.status, "blocked");
  assert(reResult.findings.some(f => f.path === "rbiRegistrationNumber" && f.message.includes("is required")));

  // 2. resolveLoanApplicationReferences blocks missing regulatedEntityId
  const appWithoutReId = {
    ...validApplication(),
    regulatedEntityId: undefined
  };
  const resolution1 = resolveLoanApplicationReferences(appWithoutReId, {});
  assert.equal(resolution1.summary.status, "blocked");
  assert(resolution1.findings.some(f => f.path === "regulatedEntityId" && f.message.includes("is required")));

  // 3. evaluateLoanApplication blocks missing regulatedEntityId / tenant details
  const eval1 = evaluateLoanApplication(appWithoutReId);
  assert.equal(eval1.summary.status, "blocked");
  assert(eval1.findings.some(f => f.path === "regulatedEntityId" && f.message.includes("is required")));

  const appWithoutTenant = {
    ...validApplication(),
    tenant: undefined
  };
  const eval2 = evaluateLoanApplication(appWithoutTenant);
  assert.equal(eval2.summary.status, "blocked");
  assert(eval2.findings.some(f => f.path === "tenant" && f.message.includes("details are missing")));

  // 4. evaluateLoanApplication blocks missing rbiRegistrationNumber
  const appWithoutRegNum = {
    ...validApplication(),
    tenant: {
      ...validApplication().tenant,
      rbiRegistrationNumber: ""
    }
  };
  const eval3 = evaluateLoanApplication(appWithoutRegNum);
  assert.equal(eval3.summary.status, "blocked");
  assert(eval3.findings.some(f => f.path === "tenant.rbiRegistrationNumber" && f.message.includes("cannot be empty")));

  // 5. evaluateLoanApplication blocks unsupported RE type
  const appWithBadReType = {
    ...validApplication(),
    tenant: {
      ...validApplication().tenant,
      regulatedEntityType: "not_a_bank"
    }
  };
  const eval4 = evaluateLoanApplication(appWithBadReType);
  assert.equal(eval4.summary.status, "blocked");
  assert(eval4.findings.some(f => f.path === "tenant.regulatedEntityType" && f.message.includes("must be an RBI-covered RE type")));

  // 6. evaluateLoanApplication blocks missing grievance officer name/email
  const appWithoutGovName = {
    ...validApplication(),
    tenant: {
      ...validApplication().tenant,
      grievanceOfficer: { name: "", email: "grievance@example.in" }
    }
  };
  const eval5 = evaluateLoanApplication(appWithoutGovName);
  assert.equal(eval5.summary.status, "blocked");
  assert(eval5.findings.some(f => f.path === "tenant.grievanceOfficer" && f.message.includes("grievance officer name and email")));
});

test("product policy rejects unsafe penal charge design", () => {
  const reResult = upsertRegulatedEntity({}, validRegulatedEntity());
  const productResult = upsertProductPolicy(
    {},
    merge(validProductPolicy(), {
      penalCharges: [
        {
          name: "Late payment penalty",
          reason: "Repayment default",
          type: "penal_interest",
          amount: 500,
          capitalizes: true
        }
      ]
    }),
    reResult.registry
  );

  assert.equal(productResult.summary.status, "blocked");
  assert(productResult.findings.some((finding) => finding.controlId === "RBI-FPC-PENAL"));
});

test("product policy versioning retains prior versions and resolves by effective date", () => {
  const reResult = upsertRegulatedEntity({}, validRegulatedEntity());

  // Version 1 effective from Jan 2026.
  const v1 = upsertProductPolicy(
    {},
    merge(validProductPolicy(), { version: 1, effectiveFrom: "2026-01-01", annualInterestRateBps: 1800 }),
    reResult.registry
  );
  assert.equal(v1.summary.status, "ready");
  assert.equal(v1.product.version, 1);

  // A new version must take effect after the current one.
  const badBump = upsertProductPolicy(
    v1.registry,
    merge(validProductPolicy(), { version: 2, effectiveFrom: "2026-01-01", annualInterestRateBps: 2000 }),
    reResult.registry
  );
  assert.equal(badBump.summary.status, "blocked");
  assert(badBump.findings.some((finding) => finding.path === "effectiveFrom"));

  // A version cannot go backwards.
  const badVersion = upsertProductPolicy(
    v1.registry,
    merge(validProductPolicy(), { version: 1, effectiveFrom: "2026-06-01" }),
    reResult.registry
  );
  // Same version is an in-place correction, not a decrease — allowed.
  assert.equal(badVersion.summary.status, "ready");

  // Version 2 effective from Jul 2026, archiving v1 with a closed window.
  const v2 = upsertProductPolicy(
    v1.registry,
    merge(validProductPolicy(), { version: 2, effectiveFrom: "2026-07-01", annualInterestRateBps: 2000 }),
    reResult.registry
  );
  assert.equal(v2.summary.status, "ready");
  assert.equal(v2.product.version, 2);
  assert.equal(v2.product.priorVersions.length, 1);
  assert.equal(v2.product.priorVersions[0].version, 1);
  assert.equal(v2.product.priorVersions[0].effectiveTo, "2026-07-01");

  // Resolving by date returns the version governing that day.
  assert.equal(selectProductPolicyVersion(v2.product, new Date("2026-03-01")).annualInterestRateBps, 1800);
  assert.equal(selectProductPolicyVersion(v2.product, new Date("2026-09-01")).annualInterestRateBps, 2000);
  // Before the earliest version, the earliest governing policy is returned.
  assert.equal(selectProductPolicyVersion(v2.product, new Date("2025-01-01")).version, 1);
});

test("LSP registry enforces agreement, due diligence, review, data, and fee controls", () => {
  const reResult = upsertRegulatedEntity({}, validRegulatedEntity());
  assert.equal(reResult.summary.status, "ready");

  const missingDiligence = upsertLendingServiceProvider(
    {},
    merge(validLendingServiceProvider(), {
      dueDiligence: {
        approvalRef: null
      }
    }),
    reResult.registry
  );
  assert.equal(missingDiligence.summary.status, "blocked");
  assert(missingDiligence.findings.some((finding) => finding.path === "dueDiligence.approvalRef"));

  const badFeeDesign = upsertLendingServiceProvider(
    {},
    merge(validLendingServiceProvider(), {
      feeControls: {
        paidByRegulatedEntity: false,
        borrowerChargedSeparately: true
      }
    }),
    reResult.registry
  );
  assert.equal(badFeeDesign.summary.status, "blocked");
  assert(badFeeDesign.findings.some((finding) => finding.path === "feeControls.paidByRegulatedEntity"));
  assert(badFeeDesign.findings.some((finding) => finding.path === "feeControls.borrowerChargedSeparately"));

  const lspResult = upsertLendingServiceProvider({}, validLendingServiceProvider(), reResult.registry);
  assert.equal(lspResult.summary.status, "ready");
  assert.equal(lspResult.lendingServiceProvider.status, "active");

  const lspDla = upsertDigitalLendingApp(
    {},
    validDigitalLendingApp({
      digitalLendingAppId: "dla_partner_mobile",
      name: "Partner Loan Marketplace",
      ownerType: "lsp_owned",
      lspId: "lsp_example_001",
      ownerName: null,
      availability: [
        {
          channel: "app_store",
          availableOn: "Google Play Store",
          link: "https://play.google.com/store/apps/details?id=in.example.partner"
        }
      ],
      grievanceOfficer: {
        name: "Partner Nodal Officer",
        email: "grievance@partner.example.in",
        telephone: "+91-80-40000000",
        mobile: "+919888888888"
      },
      privacyPolicyUrl: "https://partner.example.in/privacy",
      publicDisclosureUrl: "https://example.in/digital-lending-apps"
    }),
    reResult.registry,
    lspResult.registry
  );
  assert.equal(lspDla.summary.status, "ready");
  assert.equal(lspDla.digitalLendingApp.ownerName, "Example LSP Services Pvt Ltd");

  const unknownLspDla = upsertDigitalLendingApp(
    {},
    validDigitalLendingApp({
      digitalLendingAppId: "dla_unknown_lsp",
      ownerType: "lsp_owned",
      lspId: "missing_lsp",
      ownerName: "Missing LSP"
    }),
    reResult.registry,
    lspResult.registry
  );
  assert.equal(unknownLspDla.summary.status, "blocked");
  assert(unknownLspDla.findings.some((finding) => finding.path === "lspId"));
});

test("recovery-agent registry requires empanelment evidence for an active agent", () => {
  const reResult = upsertRegulatedEntity({}, validRegulatedEntity());
  assert.equal(reResult.summary.status, "ready");

  const missingTraining = upsertRecoveryAgent(
    {},
    merge(validRecoveryAgent(), { training: { certificationRef: null } }),
    reResult.registry
  );
  assert.equal(missingTraining.summary.status, "blocked");
  assert(missingTraining.findings.some((finding) => finding.path === "training.certificationRef"));

  const missingAuthorization = upsertRecoveryAgent(
    {},
    merge(validRecoveryAgent(), { authorization: { letterRef: null, idCardRef: null } }),
    reResult.registry
  );
  assert.equal(missingAuthorization.summary.status, "blocked");
  assert(missingAuthorization.findings.some((finding) => finding.path === "authorization.letterRef"));
  assert(missingAuthorization.findings.some((finding) => finding.path === "authorization.idCardRef"));

  const suspendedAgentIsPermitted = upsertRecoveryAgent(
    {},
    merge(validRecoveryAgent(), { status: "suspended", training: { certificationRef: null, certifiedAt: null } }),
    reResult.registry
  );
  assert.equal(suspendedAgentIsPermitted.summary.status, "ready");
  assert.equal(suspendedAgentIsPermitted.recoveryAgent.status, "suspended");

  const agentResult = upsertRecoveryAgent({}, validRecoveryAgent(), reResult.registry);
  assert.equal(agentResult.summary.status, "ready");
  assert.equal(agentResult.recoveryAgent.status, "active");

  const unknownRe = upsertRecoveryAgent(
    {},
    merge(validRecoveryAgent(), { recoveryAgentId: "agent_orphan", regulatedEntityId: "missing_re" }),
    reResult.registry
  );
  assert.equal(unknownRe.summary.status, "blocked");
  assert(unknownRe.findings.some((finding) => finding.path === "regulatedEntityId"));
});

test("DLA registry exports own and LSP apps in CIMS-ready shape", () => {
  const reResult = upsertRegulatedEntity({}, validRegulatedEntity());
  assert.equal(reResult.summary.status, "ready");
  const lspResult = upsertLendingServiceProvider({}, validLendingServiceProvider(), reResult.registry);
  assert.equal(lspResult.summary.status, "ready");

  const ownDla = upsertDigitalLendingApp({}, validDigitalLendingApp(), reResult.registry);
  assert.equal(ownDla.summary.status, "ready");

  const lspDla = upsertDigitalLendingApp(
    ownDla.registry,
    validDigitalLendingApp({
      digitalLendingAppId: "dla_partner_mobile",
      name: "Partner Loan Marketplace",
      ownerType: "lsp_owned",
      lspId: "lsp_example_001",
      availability: [
        {
          channel: "app_store",
          availableOn: "Google Play Store",
          link: "https://play.google.com/store/apps/details?id=in.example.partner"
        },
        {
          channel: "app_store",
          availableOn: "Apple App Store",
          link: "https://apps.apple.com/in/app/example-partner/id123456789"
        }
      ],
      grievanceOfficer: {
        name: "Partner Nodal Officer",
        email: "grievance@partner.example.in",
        telephone: "+91-80-40000000",
        mobile: "+919888888888"
      },
      privacyPolicyUrl: "https://partner.example.in/privacy",
      publicDisclosureUrl: "https://example.in/digital-lending-apps",
      complianceAttestation: {
        lspGrievanceOfficerDisplayed: true
      }
    }),
    reResult.registry,
    lspResult.registry
  );
  assert.equal(lspDla.summary.status, "ready");

  const exportResult = generateDlaCimsExport(lspDla.registry, reResult.registry, {
    lendingServiceProviders: lspResult.registry,
    asOf: "2026-07-08T00:00:00.000Z"
  });
  assert.equal(exportResult.summary.status, "ready");
  assert.equal(exportResult.count, 3);
  assert(exportResult.columns.some((column) => column.key === "grievanceOfficerEmail"));
  assert.deepEqual(
    exportResult.rows.map((row) => row.ownerName),
    ["Self-owned", "Example LSP Services Pvt Ltd", "Example LSP Services Pvt Ltd"]
  );
  assert.equal(exportResult.rows[1].availableOn, "Google Play Store");
  assert.equal(exportResult.rows[2].availableOn, "Apple App Store");

  const unsafeDla = upsertDigitalLendingApp(
    lspDla.registry,
    validDigitalLendingApp({
      digitalLendingAppId: "dla_unsafe",
      dataCollection: {
        prohibitedMobileResourcesAccessed: true
      }
    }),
    reResult.registry
  );
  assert.equal(unsafeDla.summary.status, "blocked");
  assert(unsafeDla.findings.some((finding) => finding.path === "dataCollection.prohibitedMobileResourcesAccessed"));
});

test("borrower profile, consent, and KYC records resolve an application", () => {
  const borrowerResult = upsertBorrowerProfile({}, validBorrowerProfile());
  assert.equal(borrowerResult.summary.status, "ready");

  const consentResult = upsertConsentRecord({}, validConsentRecord(), borrowerResult.registry);
  assert.equal(consentResult.summary.status, "ready");

  const kycResult = upsertKycRecord({}, validKycRecord(), borrowerResult.registry);
  assert.equal(kycResult.summary.status, "ready");

  const resolution = resolveBorrowerApplicationReferences(
    {
      borrowerId: "bor_001"
    },
    {
      borrowerProfiles: borrowerResult.registry,
      consentRecords: consentResult.registry,
      kycRecords: kycResult.registry
    },
    new Date("2026-07-08T00:00:00.000Z")
  );

  assert.equal(resolution.summary.status, "ready");
  assert.equal(resolution.application.borrower.residencyCountry, "IN");
  assert.equal(resolution.application.consent.noticeVersion, "dpdp-notice-v1");
  assert.equal(resolution.application.kyc.status, "verified");
  assert.equal(resolution.application.economicProfile.monthlyIncome, 75000);
});

test("borrower resolution blocks revoked consent and expired KYC", () => {
  const borrowerResult = upsertBorrowerProfile({}, validBorrowerProfile());
  const consentResult = upsertConsentRecord(
    {},
    merge(validConsentRecord(), {
      status: "revoked",
      revokedAt: "2026-07-07T00:00:00.000Z"
    }),
    borrowerResult.registry
  );
  const kycResult = upsertKycRecord(
    {},
    merge(validKycRecord(), {
      expiresAt: "2026-07-07T00:00:00.000Z"
    }),
    borrowerResult.registry,
    new Date("2026-07-08T00:00:00.000Z")
  );

  assert.equal(consentResult.summary.status, "ready");
  assert.equal(kycResult.summary.status, "review");

  const resolution = resolveBorrowerApplicationReferences(
    {
      borrowerId: "bor_001"
    },
    {
      borrowerProfiles: borrowerResult.registry,
      consentRecords: consentResult.registry,
      kycRecords: kycResult.registry
    },
    new Date("2026-07-08T00:00:00.000Z")
  );

  assert.equal(resolution.summary.status, "blocked");
  assert(resolution.findings.some((finding) => finding.message.includes("data-processing consent")));
  assert(resolution.findings.some((finding) => finding.message.includes("expired")));
});

test("legal-entity borrower resolution requires a verified beneficial owner above the PMLA threshold", () => {
  const borrowerResult = upsertBorrowerProfile(
    {},
    merge(validBorrowerProfile(), {
      borrowerId: "bor_company_001",
      borrowerType: "company",
      legalName: "Example Textiles Pvt Ltd"
    })
  );
  assert.equal(borrowerResult.summary.status, "ready");

  const missingIdentification = upsertBeneficialOwner(
    {},
    { beneficialOwnerId: "bo_bad", borrowerId: "bor_company_001", name: "Someone", type: "ownership", ownershipPercentage: 40 },
    borrowerResult.registry
  );
  assert.equal(missingIdentification.summary.status, "blocked");
  assert(missingIdentification.findings.some((finding) => finding.path === "identificationRef"));

  const individualBorrowerResult = upsertBorrowerProfile({}, validBorrowerProfile());
  const boForIndividual = upsertBeneficialOwner(
    {},
    { beneficialOwnerId: "bo_invalid", borrowerId: "bor_001", name: "Someone", identificationRef: "PAN000", type: "ownership", ownershipPercentage: 40 },
    individualBorrowerResult.registry
  );
  assert.equal(boForIndividual.summary.status, "blocked");
  assert(boForIndividual.findings.some((finding) => finding.path === "borrowerId"));

  const consentResult = upsertConsentRecord({}, merge(validConsentRecord(), { borrowerId: "bor_company_001" }), borrowerResult.registry);
  const kycResult = upsertKycRecord({}, merge(validKycRecord(), { borrowerId: "bor_company_001" }), borrowerResult.registry);
  const registries = { borrowerProfiles: borrowerResult.registry, consentRecords: consentResult.registry, kycRecords: kycResult.registry };

  const blockedNoOwner = resolveBorrowerApplicationReferences({ borrowerId: "bor_company_001" }, registries, new Date("2026-07-08T00:00:00.000Z"));
  assert.equal(blockedNoOwner.summary.status, "blocked");
  assert(blockedNoOwner.findings.some((finding) => finding.message.includes("beneficial owner")));

  const belowThreshold = upsertBeneficialOwner(
    {},
    {
      beneficialOwnerId: "bo_minor",
      borrowerId: "bor_company_001",
      name: "Minor Stakeholder",
      identificationRef: "PAN_MINOR",
      type: "ownership",
      ownershipPercentage: 10,
      verification: { status: "verified", verifiedAt: "2026-06-01T00:00:00.000Z", verifiedBy: "compliance-analyst-1" }
    },
    borrowerResult.registry
  );
  assert.equal(belowThreshold.summary.status, "ready");

  const blockedBelowThreshold = resolveBorrowerApplicationReferences(
    { borrowerId: "bor_company_001" },
    { ...registries, beneficialOwners: belowThreshold.registry },
    new Date("2026-07-08T00:00:00.000Z")
  );
  assert.equal(blockedBelowThreshold.summary.status, "blocked");

  const controllingOwner = upsertBeneficialOwner(
    belowThreshold.registry,
    {
      beneficialOwnerId: "bo_controlling",
      borrowerId: "bor_company_001",
      name: "Controlling Shareholder",
      identificationRef: "PAN_MAJOR",
      type: "ownership",
      ownershipPercentage: 40,
      verification: { status: "verified", verifiedAt: "2026-06-01T00:00:00.000Z", verifiedBy: "compliance-analyst-1" }
    },
    borrowerResult.registry
  );
  assert.equal(controllingOwner.summary.status, "ready");

  const resolved = resolveBorrowerApplicationReferences(
    { borrowerId: "bor_company_001" },
    { ...registries, beneficialOwners: controllingOwner.registry },
    new Date("2026-07-08T00:00:00.000Z")
  );
  assert.equal(resolved.summary.status, "ready");
});

test("KYC periodic-review lapse turns a verified record refresh_required and blocks sanction", () => {
  // A high-risk KYC is on a 2-year review cycle. Just under 2 years in, it is
  // still good; past the review-due date it becomes refresh_required.
  const highRisk = {
    status: "verified",
    riskCategory: "high",
    verifiedAt: "2024-01-01T00:00:00.000Z"
  };
  assert.equal(evaluateKycStatus(highRisk, new Date("2025-06-01T00:00:00.000Z")).effectiveStatus, "verified");
  const lapsed = evaluateKycStatus(highRisk, new Date("2026-02-01T00:00:00.000Z"));
  assert.equal(lapsed.effectiveStatus, "refresh_required");
  assert.equal(lapsed.reviewDue, true);

  // A refresh-due verified KYC blocks a new sanction even though it is not expired.
  const borrowerResult = upsertBorrowerProfile({}, validBorrowerProfile());
  const consentResult = upsertConsentRecord({}, validConsentRecord(), borrowerResult.registry);
  const kycResult = upsertKycRecord(
    {},
    merge(validKycRecord(), {
      riskCategory: "high",
      verifiedAt: "2024-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z"
    }),
    borrowerResult.registry
  );
  assert.equal(kycResult.summary.status, "ready");

  const resolution = resolveBorrowerApplicationReferences(
    { borrowerId: "bor_001" },
    {
      borrowerProfiles: borrowerResult.registry,
      consentRecords: consentResult.registry,
      kycRecords: kycResult.registry
    },
    new Date("2026-06-01T00:00:00.000Z")
  );
  assert.equal(resolution.summary.status, "blocked");
  assert.equal(resolution.application.kyc.effectiveStatus, "refresh_required");
  assert(resolution.findings.some((finding) => finding.message.includes("periodic refresh")));
});

test("API surfaces KYC refresh status and blocks an application on a refresh-due KYC", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  await seedOperationalActors(base);
  assert.equal((await postJson(`${base}/regulated-entities`, validRegulatedEntity())).status, 201);
  assert.equal((await postJson(`${base}/products`, validProductPolicy())).status, 201);
  assert.equal((await postJson(`${base}/borrowers`, validBorrowerProfile())).status, 201);
  assert.equal((await postJson(`${base}/borrowers/bor_001/consents`, validConsentRecord())).status, 201);
  // A high-risk KYC verified over two years ago is past its review cycle.
  assert.equal(
    (await postJson(`${base}/borrowers/bor_001/kyc-records`, {
      ...validKycRecord(),
      riskCategory: "high",
      verifiedAt: "2023-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z"
    })).status,
    201
  );

  // The KYC list reflects the derived refresh_required status.
  const kycList = await (await apiFetch(`${base}/borrowers/bor_001/kyc-records`)).json();
  assert.equal(kycList.kycRecords[0].effectiveStatus, "refresh_required");
  assert.ok(kycList.kycRecords[0].nextReviewDueAt);

  // An application on the refresh-due KYC is blocked at preflight.
  const application = await postJson(`${base}/loans/applications`, {
    regulatedEntityId: "re_example_nbfc",
    productId: "prod_personal_loan",
    borrowerId: "bor_001",
    requestedAmount: 125000,
    requestedTenorMonths: 12,
    disbursement: validApplication().disbursement,
    repayment: validApplication().repayment
  });
  assert.equal(application.status, 422);
  assert.ok(
    JSON.stringify(application.body).includes("periodic refresh"),
    "sanction is blocked citing KYC periodic refresh"
  );
});

test("API stores blocked compliance applications", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const response = await apiFetch(`${base}/loans/applications`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(
      merge(validApplication(), {
        borrower: {
          residencyCountry: "US"
        }
      })
    )
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.status, "blocked_compliance");
  assert.equal(body.compliance.summary.status, "blocked");

  const lookup = await apiFetch(`${base}/loans/applications/${body.applicationId}`);
  assert.equal(lookup.status, 200);
});

test("API versions a product policy and resolves it by effective date", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  assert.equal((await postJson(`${base}/regulated-entities`, validRegulatedEntity())).status, 201);
  assert.equal(
    (await postJson(`${base}/products`, merge(validProductPolicy(), { version: 1, effectiveFrom: "2026-01-01", annualInterestRateBps: 1800 }))).status,
    201
  );
  // Publish version 2 effective mid-year.
  const v2 = await postJson(
    `${base}/products`,
    merge(validProductPolicy(), { version: 2, effectiveFrom: "2026-07-01", annualInterestRateBps: 2000 })
  );
  assert.equal(v2.status, 201);
  assert.equal(v2.body.product.version, 2);
  assert.equal(v2.body.product.priorVersions.length, 1);

  // The current fetch returns v2; an asOf in H1 returns v1's pricing.
  const current = await (await apiFetch(`${base}/products/prod_personal_loan`)).json();
  assert.equal(current.annualInterestRateBps, 2000);
  const asOfH1 = await (await apiFetch(`${base}/products/prod_personal_loan?asOf=2026-03-15`)).json();
  assert.equal(asOfH1.annualInterestRateBps, 1800);
  assert.equal(asOfH1.version, 1);
});

test("API supports RE and product policy backed loan applications", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const reResponse = await postJson(`${base}/regulated-entities`, validRegulatedEntity());
  assert.equal(reResponse.status, 201);

  const productResponse = await postJson(`${base}/products`, validProductPolicy());
  assert.equal(productResponse.status, 201);

  const applicationResponse = await postJson(`${base}/loans/applications`, {
    regulatedEntityId: "re_example_nbfc",
    productId: "prod_personal_loan",
    requestedAmount: 200000,
    requestedTenorMonths: 24,
    borrower: validApplication().borrower,
    consent: validApplication().consent,
    kyc: validApplication().kyc,
    economicProfile: validApplication().economicProfile,
    disbursement: validApplication().disbursement,
    repayment: validApplication().repayment
  });
  const application = applicationResponse.body;

  assert.equal(applicationResponse.status, 201);
  assert.equal(application.status, "ready_for_kfs");
  assert.equal(application.tenant.regulatedEntityName, "Example India NBFC Ltd");
  assert.equal(application.product.productCode, "PL_IN_DIGITAL");
  assert.equal(application.product.requestedAmount, 200000);
});

test("API stores DLAs and exposes CIMS-ready DLA reporting export", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  assert.equal((await postJson(`${base}/regulated-entities`, validRegulatedEntity())).status, 201);

  const invalidLsp = await postJson(
    `${base}/lending-service-providers`,
    merge(validLendingServiceProvider(), {
      agreement: {
        agreementRef: null
      }
    })
  );
  assert.equal(invalidLsp.status, 422);
  assert(invalidLsp.body.findings.some((finding) => finding.path === "agreement.agreementRef"));

  const lsp = await postJson(`${base}/lending-service-providers`, validLendingServiceProvider());
  assert.equal(lsp.status, 201);
  assert.equal(lsp.body.lendingServiceProvider.legalName, "Example LSP Services Pvt Ltd");

  const blocked = await postJson(
    `${base}/digital-lending-apps`,
    validDigitalLendingApp({
      digitalLendingAppId: "dla_bad_mobile",
      complianceAttestation: {
        dataCollectionAndStorageCompliant: false
      }
    })
  );
  assert.equal(blocked.status, 422);
  assert(blocked.body.findings.some((finding) => finding.path === "complianceAttestation.dataCollectionAndStorageCompliant"));

  const unknownLsp = await postJson(
    `${base}/digital-lending-apps`,
    validDigitalLendingApp({
      digitalLendingAppId: "dla_unknown_lsp",
      ownerType: "lsp_owned",
      ownerName: "Unknown LSP",
      lspId: "missing_lsp"
    })
  );
  assert.equal(unknownLsp.status, 422);
  assert(unknownLsp.body.findings.some((finding) => finding.path === "lspId"));

  const created = await postJson(`${base}/digital-lending-apps`, validDigitalLendingApp());
  assert.equal(created.status, 201);
  assert.equal(created.body.digitalLendingApp.status, "active");
  assert.equal(created.body.digitalLendingApp.grievanceOfficer.email, "grievance@example.in");

  const partnerDla = await postJson(
    `${base}/digital-lending-apps`,
    validDigitalLendingApp({
      digitalLendingAppId: "dla_partner_mobile",
      name: "Partner Loan Marketplace",
      ownerType: "lsp_owned",
      ownerName: null,
      lspId: "lsp_example_001",
      availability: [
        {
          channel: "app_store",
          availableOn: "Google Play Store",
          link: "https://play.google.com/store/apps/details?id=in.example.partner"
        }
      ],
      grievanceOfficer: {
        name: "Partner Nodal Officer",
        email: "grievance@partner.example.in",
        telephone: "+91-80-40000000",
        mobile: "+919888888888"
      },
      privacyPolicyUrl: "https://partner.example.in/privacy",
      publicDisclosureUrl: "https://example.in/digital-lending-apps"
    })
  );
  assert.equal(partnerDla.status, 201);
  assert.equal(partnerDla.body.digitalLendingApp.ownerName, "Example LSP Services Pvt Ltd");

  const lookup = await apiFetch(`${base}/digital-lending-apps/dla_example_web`);
  assert.equal(lookup.status, 200);
  assert.equal((await lookup.json()).name, "Example Loan Web");

  const cimsResponse = await apiFetch(`${base}/reporting/dla/cims?regulatedEntityId=re_example_nbfc&asOf=2026-07-08T00:00:00.000Z`);
  assert.equal(cimsResponse.status, 200);
  const cims = await cimsResponse.json();
  assert.equal(cims.reportType, "rbi_dla_cims");
  assert.equal(cims.count, 2);
  assert.equal(cims.rows[0].dlaName, "Example Loan Web");
  assert.equal(cims.rows[0].ownerName, "Self-owned");
  assert.equal(cims.rows[0].reWebsite, "https://example.in");
  assert.equal(cims.rows[1].ownerName, "Example LSP Services Pvt Ltd");
});

test("API supports borrower-backed applications without embedded borrower KYC consent blobs", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  assert.equal((await postJson(`${base}/regulated-entities`, validRegulatedEntity())).status, 201);
  assert.equal((await postJson(`${base}/products`, validProductPolicy())).status, 201);
  assert.equal((await postJson(`${base}/borrowers`, validBorrowerProfile())).status, 201);
  assert.equal((await postJson(`${base}/borrowers/bor_001/consents`, validConsentRecord())).status, 201);
  assert.equal((await postJson(`${base}/borrowers/bor_001/kyc-records`, validKycRecord())).status, 201);

  const applicationResponse = await postJson(`${base}/loans/applications`, {
    regulatedEntityId: "re_example_nbfc",
    productId: "prod_personal_loan",
    borrowerId: "bor_001",
    requestedAmount: 125000,
    requestedTenorMonths: 12,
    disbursement: validApplication().disbursement,
    repayment: validApplication().repayment
  });
  const application = applicationResponse.body;

  assert.equal(applicationResponse.status, 201);
  assert.equal(application.status, "ready_for_kfs");
  assert.equal(application.borrower.borrowerId, "bor_001");
  assert.equal(application.consent.consentRecordId, "consent_data_processing");
  assert.equal(application.kyc.kycRecordId, "kyc_verified_001");
  assert.equal(application.economicProfile.occupation, "salaried");
});

test("API blocks a legal-entity borrower's application until a qualifying beneficial owner is on file", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  assert.equal((await postJson(`${base}/regulated-entities`, validRegulatedEntity())).status, 201);
  assert.equal((await postJson(`${base}/products`, validProductPolicy())).status, 201);
  assert.equal(
    (
      await postJson(`${base}/borrowers`, {
        borrowerId: "bor_company_001",
        borrowerType: "company",
        status: "active",
        legalName: "Example Textiles Pvt Ltd",
        residencyCountry: "IN",
        primaryAddressCountry: "IN",
        contact: { email: "finance@exampletextiles.in" },
        economicProfile: { monthlyIncome: 900000 }
      })
    ).status,
    201
  );
  assert.equal(
    (await postJson(`${base}/borrowers/bor_company_001/consents`, merge(validConsentRecord(), { borrowerId: "bor_company_001" }))).status,
    201
  );
  assert.equal(
    (await postJson(`${base}/borrowers/bor_company_001/kyc-records`, merge(validKycRecord(), { borrowerId: "bor_company_001" }))).status,
    201
  );

  const companyApplication = {
    regulatedEntityId: "re_example_nbfc",
    productId: "prod_personal_loan",
    borrowerId: "bor_company_001",
    requestedAmount: 125000,
    requestedTenorMonths: 12,
    disbursement: validApplication().disbursement,
    repayment: validApplication().repayment
  };

  const blocked = await postJson(`${base}/loans/applications`, companyApplication);
  assert.equal(blocked.status, 422);
  assert(blocked.body.compliance.findings.some((finding) => finding.message.includes("beneficial owner")));

  assert.equal(
    (
      await postJson(`${base}/borrowers/bor_company_001/beneficial-owners`, {
        beneficialOwnerId: "bo_minor",
        name: "Minor Stakeholder",
        identificationRef: "PAN_MINOR",
        type: "ownership",
        ownershipPercentage: 10,
        verification: { status: "verified", verifiedAt: "2026-06-01T00:00:00.000Z", verifiedBy: "compliance-analyst-1" }
      })
    ).status,
    201
  );
  const stillBlocked = await postJson(`${base}/loans/applications`, companyApplication);
  assert.equal(stillBlocked.status, 422);

  assert.equal(
    (
      await postJson(`${base}/borrowers/bor_company_001/beneficial-owners`, {
        beneficialOwnerId: "bo_controlling",
        name: "Controlling Shareholder",
        identificationRef: "PAN_MAJOR",
        type: "ownership",
        ownershipPercentage: 40,
        verification: { status: "verified", verifiedAt: "2026-06-01T00:00:00.000Z", verifiedBy: "compliance-analyst-1" }
      })
    ).status,
    201
  );

  const allowed = await postJson(`${base}/loans/applications`, companyApplication);
  assert.equal(allowed.status, 201);
  assert.equal(allowed.body.status, "ready_for_kfs");

  const listResponse = await apiFetch(`${base}/borrowers/bor_company_001/beneficial-owners`);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.beneficialOwners.length, 2);
});

test("API requires maker-checker approval before disbursement", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await createRegistryBackedApplication(base);

  const kfsResponse = await postJson(`${base}/loans/applications/${application.applicationId}/kfs`, {
    acceptance: {
      acceptedAt: "2026-07-08T07:00:00.000Z",
      deliveryChannel: "email",
      deliveryRef: "email_msg_123"
    }
  });
  assert.equal(kfsResponse.status, 201);
  assert.equal(kfsResponse.body.status, "ready_for_decision");

  const decisionResponse = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    status: "approved",
    proposedBy: "credit-maker-1",
    reason: "Policy checks passed"
  });
  assert.equal(decisionResponse.status, 202);
  assert.equal(decisionResponse.body.status, "pending_decision_approval");

  const earlyDisbursement = await postJson(`${base}/loans/applications/${application.applicationId}/disbursement`, {
    destinationAccount: validApplication().disbursement.destinationAccount
  });
  assert.equal(earlyDisbursement.status, 422);

  const sameActorApproval = await postJson(`${base}/loans/applications/${application.applicationId}/approvals`, {
    outcome: "approved",
    approvedBy: "credit-maker-1",
    approvalRef: "approval_001"
  });
  assert.equal(sameActorApproval.status, 422);

  const approvalResponse = await postJson(`${base}/loans/applications/${application.applicationId}/approvals`, {
    outcome: "approved",
    approvedBy: "credit-checker-1",
    approvalRef: "approval_002"
  });
  assert.equal(approvalResponse.status, 200);
  assert.equal(approvalResponse.body.status, "approved");
  assert.equal(approvalResponse.body.decision.approvedBy, "credit-checker-1");

  const disbursementResponse = await postJson(`${base}/loans/applications/${application.applicationId}/disbursement`, {
    destinationAccount: validApplication().disbursement.destinationAccount
  });
  assert.equal(disbursementResponse.status, 422);
  assert(disbursementResponse.body.findings.some((finding) => finding.path === "documentPacket"));

  const packet = await generateAndDeliverDocumentPacket(base, application.applicationId);
  assert.equal(packet.status, "delivered");

  const readyDisbursementResponse = await postJson(`${base}/loans/applications/${application.applicationId}/disbursement`, {
    destinationAccount: validApplication().disbursement.destinationAccount
  });
  assert.equal(readyDisbursementResponse.status, 200);
  assert.equal(readyDisbursementResponse.body.status, "disbursed");
  assert(readyDisbursementResponse.body.loanAccountId);
});

test("API generates and delivers execution document packet before disbursement", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await createRegistryBackedApplication(base);
  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/kfs`, {
        acceptance: {
          acceptedAt: "2026-07-08T07:00:00.000Z",
          deliveryChannel: "email",
          deliveryRef: "email_msg_123"
        }
      })
    ).status,
    201
  );
  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
        status: "approved",
        proposedBy: "credit-maker-1",
        reason: "Policy checks passed"
      })
    ).status,
    202
  );
  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/approvals`, {
        outcome: "approved",
        approvedBy: "credit-checker-1",
        approvalRef: "approval_004"
      })
    ).status,
    200
  );

  const taskResponse = await apiFetch(`${base}/workflow/tasks?type=application.document_packet_delivery`);
  assert.equal(taskResponse.status, 200);
  const tasks = await taskResponse.json();
  assert.equal(tasks.count, 1);
  assert.equal(tasks.tasks[0].queue, "loan_ops");

  const wrongActor = await postJson(`${base}/loans/applications/${application.applicationId}/document-packet`, {
    actor: "credit-maker-1"
  });
  assert.equal(wrongActor.status, 422);

  const generated = await postJson(`${base}/loans/applications/${application.applicationId}/document-packet`, {
    actor: "loan-officer-1"
  });
  assert.equal(generated.status, 201);
  assert.equal(generated.body.status, "generated");
  assert.equal(generated.body.documents.length, 4);
  assert(generated.body.documents.every((document) => document.checksumSha256.length === 64));
  assert(generated.body.documents.some((document) => document.type === "key_fact_statement"));
  assert(generated.body.documents.some((document) => document.type === "sanction_letter"));

  const fetched = await apiFetch(`${base}/loans/applications/${application.applicationId}/document-packet`);
  assert.equal(fetched.status, 200);
  const fetchedPacket = await fetched.json();
  assert.equal(fetchedPacket.packetId, generated.body.packetId);

  const delivery = await postJson(`${base}/loans/applications/${application.applicationId}/document-packet/delivery`, {
    actor: "loan-officer-1",
    deliveryChannel: "email",
    deliveryRef: "doc_email_001",
    deliveredTo: "asha@example.in"
  });
  assert.equal(delivery.status, 200);
  assert.equal(delivery.body.status, "delivered");

  const taskAfterDeliveryResponse = await apiFetch(`${base}/workflow/tasks?type=application.document_packet_delivery`);
  assert.equal(taskAfterDeliveryResponse.status, 200);
  const taskAfterDelivery = await taskAfterDeliveryResponse.json();
  assert.equal(taskAfterDelivery.count, 0);

  const disbursementTaskResponse = await apiFetch(`${base}/workflow/tasks?type=application.disbursement`);
  assert.equal(disbursementTaskResponse.status, 200);
  const disbursementTasks = await disbursementTaskResponse.json();
  assert.equal(disbursementTasks.count, 1);

  const disbursementResponse = await postJson(`${base}/loans/applications/${application.applicationId}/disbursement`, {
    destinationAccount: validApplication().disbursement.destinationAccount
  });
  assert.equal(disbursementResponse.status, 200);
  assert.equal(disbursementResponse.body.status, "disbursed");
  assert(disbursementResponse.body.loanAccountId);
});

test("API opens loan account on disbursement and posts ledger payment", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);

  const accountResponse = await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`);
  assert.equal(accountResponse.status, 200);
  const account = await accountResponse.json();

  assert.equal(account.applicationId, application.applicationId);
  assert.equal(account.principalAmount, 125000);
  assert.equal(account.schedule.length, 12);
  assert.equal(account.ledger[0].type, "disbursement");
  assert.equal(account.summary.principalOutstanding, 125000);

  const firstInstallment = account.schedule[0];
  const paymentResponse = await postJson(`${base}/loan-accounts/${account.loanAccountId}/payments`, {
    amount: firstInstallment.totalDue,
    receivedAt: `${firstInstallment.dueDate}T00:00:00.000Z`,
    paymentRef: "nach_payment_001",
    channel: "nach"
  });

  assert.equal(paymentResponse.status, 200);
  assert.equal(paymentResponse.body.paymentEvent.type, "payment");
  assert(paymentResponse.body.paymentEvent.interestCredit > 0);
  assert(paymentResponse.body.paymentEvent.principalCredit > 0);
  assert(paymentResponse.body.summary.principalOutstanding < 125000);

  const scheduleResponse = await apiFetch(`${base}/loan-accounts/${account.loanAccountId}/schedule`);
  assert.equal(scheduleResponse.status, 200);
  const scheduleBody = await scheduleResponse.json();
  assert.equal(scheduleBody.schedule.length, 12);
});

test("API generates borrower statement from schedule and ledger", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
  const firstInstallment = account.schedule[0];
  await postJson(`${base}/loan-accounts/${account.loanAccountId}/payments`, {
    amount: firstInstallment.totalDue,
    receivedAt: `${firstInstallment.dueDate}T00:00:00.000Z`,
    paymentRef: "nach_payment_001",
    channel: "nach"
  });

  const statementResponse = await apiFetch(
    `${base}/loan-accounts/${account.loanAccountId}/statement?from=${firstInstallment.dueDate}&to=${firstInstallment.dueDate}`
  );
  assert.equal(statementResponse.status, 200);
  const statement = await statementResponse.json();

  assert.equal(statement.loanAccountId, account.loanAccountId);
  assert.equal(statement.scheduledDues.length, 1);
  assert.equal(statement.transactions.filter((event) => event.type === "payment").length, 1);
  assert.equal(statement.totals.payments, firstInstallment.totalDue);
  assert(statement.closingSummary.principalOutstanding < statement.openingSummary.principalOutstanding);
});

test("API renders a borrower-facing loan statement document", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();

  // Span the disbursement and the first two installment due dates.
  const from = addDays(account.schedule[0].dueDate, -40);
  const to = account.schedule[1].dueDate;

  const response = await apiFetch(
    `${base}/loan-accounts/${account.loanAccountId}/statement/document?from=${from}&to=${to}`
  );
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.document.type, "loan_statement");
  assert.equal(body.document.format, "html");
  assert.equal(body.document.mimeType, "text/html");
  assert(body.document.checksumSha256);
  assert(body.document.html.includes("Loan Account Statement"));
  assert(body.document.html.includes("Opening Balance"));
  assert(body.document.html.includes("Closing Balance"));
  assert(body.document.html.includes("disbursement"));
  assert(body.document.text.includes("Loan Account Statement"));
  assert.equal(body.statement.loanAccountId, account.loanAccountId);
});

test("API controls disclosed charges, waivers, and reversals", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();

  const undisclosed = await postJson(`${base}/loan-accounts/${account.loanAccountId}/charges`, {
    name: "Mystery fee",
    reason: "Not disclosed",
    amount: 99
  });
  assert.equal(undisclosed.status, 422);

  const charge = await postJson(`${base}/loan-accounts/${account.loanAccountId}/charges`, {
    name: "Late payment charge",
    reason: "Repayment default",
    amount: 500,
    type: "penal_charge"
  });
  assert.equal(charge.status, 201);
  assert.equal(charge.body.chargeEvent.type, "charge_assessed");
  assert.equal(charge.body.summary.chargesOutstanding, 500);

  const waiver = await postJson(`${base}/loan-accounts/${account.loanAccountId}/waivers`, {
    amount: 200,
    approvedBy: "ops-checker-1",
    approvalRef: "waiver_001",
    reason: "Customer service goodwill"
  });
  assert.equal(waiver.status, 200);
  assert.equal(waiver.body.waiverEvent.type, "charge_waiver");
  assert.equal(waiver.body.summary.chargesOutstanding, 300);

  const reversal = await postJson(`${base}/loan-accounts/${account.loanAccountId}/reversals`, {
    eventId: charge.body.chargeEvent.eventId,
    approvedBy: "ops-checker-2",
    reversalRef: "reversal_001",
    reason: "Charge assessed in error"
  });
  assert.equal(reversal.status, 200);
  assert.equal(reversal.body.reversalEvent.type, "reversal");
  assert.equal(reversal.body.summary.chargesOutstanding, 0);
});

test("API accrues scheduled interest into the ledger and reconciles with the schedule", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();

  const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const asOf = `${account.schedule[2].dueDate}T12:00:00.000Z`;
  const expectedInterest = round2(
    account.schedule[0].interestDue + account.schedule[1].interestDue + account.schedule[2].interestDue
  );

  const accrual = await postJson(`${base}/loan-accounts/${account.loanAccountId}/accruals`, { asOf });
  assert.equal(accrual.status, 200);
  assert.equal(accrual.body.accrualEvents.length, 3);
  assert.equal(accrual.body.accrualEvents[0].type, "interest_accrual");
  assert.equal(accrual.body.summary.interestAccrued, expectedInterest);
  assert.equal(accrual.body.summary.interestAccrualReconciled, true);

  // Interest income is reconstructable from immutable ledger events.
  const accrualLedger = accrual.body.loanAccount.ledger.filter((event) => event.type === "interest_accrual");
  assert.equal(accrualLedger.length, 3);
  assert.equal(round2(accrualLedger.reduce((sum, event) => sum + event.interestDebit, 0)), expectedInterest);

  // Re-running accrual to the same date is idempotent: no duplicate events.
  const rerun = await postJson(`${base}/loan-accounts/${account.loanAccountId}/accruals`, { asOf });
  assert.equal(rerun.status, 200);
  assert.equal(rerun.body.accrualEvents.length, 0);
  assert.equal(rerun.body.summary.interestAccrued, expectedInterest);
});

test("API part-prepayment re-amortizes the remaining schedule", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

  // Account A exercises reduce_emi; Account B exercises reduce_tenure.
  const applicationA = await approveAndDisburseApplication(base);
  const accountA = await (await apiFetch(`${base}/loan-accounts/${applicationA.loanAccountId}`)).json();
  const applicationB = await approveAndDisburseApplication(base);
  const accountB = await (await apiFetch(`${base}/loan-accounts/${applicationB.loanAccountId}`)).json();

  const originalEmi = accountA.schedule[0].totalDue;
  const originalCount = accountA.schedule.length;
  const prepaidAt = `${addDays(accountA.schedule[0].dueDate, -1)}T12:00:00.000Z`;
  const expectedRemaining = round2(accountA.principalAmount - 25000);

  const badMode = await postJson(`${base}/loan-accounts/${accountA.loanAccountId}/prepayments`, {
    amount: 25000,
    paymentRef: "pp_bad",
    mode: "magic",
    receivedAt: prepaidAt
  });
  assert.equal(badMode.status, 422);
  assert.equal(badMode.body.error.code, "prepayment_blocked");
  assert(badMode.body.findings.some((finding) => finding.path === "mode"));

  const reduceEmi = await postJson(`${base}/loan-accounts/${accountA.loanAccountId}/prepayments`, {
    amount: 25000,
    paymentRef: "pp_emi",
    mode: "reduce_emi",
    receivedAt: prepaidAt
  });
  assert.equal(reduceEmi.status, 200);
  assert.equal(reduceEmi.body.prepayment.principalReduced, 25000);
  assert.equal(reduceEmi.body.summary.principalOutstanding, expectedRemaining);
  // Same remaining term (all installments were still in the future), lower EMI.
  assert.equal(reduceEmi.body.schedule.length, originalCount);
  assert(reduceEmi.body.schedule[0].totalDue < originalEmi);
  assert.equal(
    round2(reduceEmi.body.schedule.reduce((sum, installment) => sum + installment.principalDue, 0)),
    expectedRemaining
  );
  assert.equal(reduceEmi.body.schedule[reduceEmi.body.schedule.length - 1].closingPrincipal, 0);

  const reduceTenure = await postJson(`${base}/loan-accounts/${accountB.loanAccountId}/prepayments`, {
    amount: 25000,
    paymentRef: "pp_tenure",
    mode: "reduce_tenure",
    receivedAt: prepaidAt
  });
  assert.equal(reduceTenure.status, 200);
  // Fewer installments, EMI retained (within rounding).
  assert(reduceTenure.body.schedule.length < originalCount);
  assert(reduceTenure.body.schedule.length > 0);
  assert(Math.abs(reduceTenure.body.schedule[0].totalDue - originalEmi) <= 1);
  assert.equal(reduceTenure.body.schedule[reduceTenure.body.schedule.length - 1].closingPrincipal, 0);
  assert.equal(
    round2(reduceTenure.body.schedule.reduce((sum, installment) => sum + installment.principalDue, 0)),
    expectedRemaining
  );
});

test("API logs collections reminders and blocks out-of-hours recovery calls", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();

  // A call at 21:00 IST (15:30 UTC) is outside the 08:00-19:00 window.
  const lateCall = await postJson(`${base}/loan-accounts/${account.loanAccountId}/reminders`, {
    channel: "call",
    stage: "overdue",
    actor: "collections-1",
    sentAt: "2026-08-01T15:30:00.000Z"
  });
  assert.equal(lateCall.status, 422);
  assert(lateCall.body.findings.some((finding) => finding.controlId === "RBI-FPC-PENAL"));

  // The same call at 11:00 IST (05:30 UTC) is within the permitted window.
  const okCall = await postJson(`${base}/loan-accounts/${account.loanAccountId}/reminders`, {
    channel: "call",
    stage: "overdue",
    actor: "collections-1",
    messageRef: "call-log-1",
    sentAt: "2026-08-01T05:30:00.000Z"
  });
  assert.equal(okCall.status, 201);
  assert.equal(okCall.body.reminder.channel, "call");

  // An SMS is unrestricted by time of day.
  const sms = await postJson(`${base}/loan-accounts/${account.loanAccountId}/reminders`, {
    channel: "sms",
    stage: "pre_due",
    actor: "collections-1",
    sentAt: "2026-08-01T20:00:00.000Z"
  });
  assert.equal(sms.status, 201);
  assert.equal(sms.body.loanAccount.collectionsReminders.length, 2);

  const events = await (await apiFetch(`${base}/audit/events`)).json();
  assert.ok(events.events.some((event) => event.type === "loan_account.reminder_sent"));
});

test("API restructures a hardship loan under four-eyes approval and flags it", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
  const originalCount = account.schedule.length;
  const originalEmi = account.schedule[0].totalDue;

  // Restructure requires an approving checker distinct from the proposer.
  const fourEyes = await postJson(`${base}/loan-accounts/${account.loanAccountId}/restructure`, {
    reason: "Borrower job loss",
    newRemainingTermMonths: 24,
    proposedBy: "collections-1",
    approvedBy: "collections-1",
    approvalReference: "RES-APP-1"
  });
  assert.equal(fourEyes.status, 422);
  assert(fourEyes.body.findings.some((finding) => finding.path === "approvedBy"));

  // A valid restructure extends the term and concedes the rate, lowering the EMI.
  const restructured = await postJson(`${base}/loan-accounts/${account.loanAccountId}/restructure`, {
    reason: "Borrower job loss",
    hardshipCategory: "income_loss",
    newRemainingTermMonths: 24,
    newAnnualInterestRateBps: 1400,
    proposedBy: "collections-1",
    approvedBy: "collections-lead-1",
    approvalReference: "RES-APP-2"
  });
  assert.equal(restructured.status, 200);
  assert.equal(restructured.body.loanAccount.restructured, true);
  assert.equal(restructured.body.restructure.approvedBy, "collections-lead-1");
  assert(restructured.body.schedule.length > originalCount, "the extended term lengthens the schedule");
  assert(restructured.body.schedule[restructured.body.schedule.length - 1].closingPrincipal === 0);
  const newEmi = restructured.body.schedule[restructured.body.schedule.length - 1].totalDue;
  assert(newEmi < originalEmi, "a longer term at a lower rate reduces the instalment");

  // The restructure is reflected in the CIC-ready snapshot for reporting.
  const snapshot = await (await apiFetch(`${base}/loan-accounts/${account.loanAccountId}/cic-snapshot`)).json();
  assert.equal(snapshot.restructured, true);
  assert.ok(snapshot.restructuredAt);

  // A repeat with a fully repaid or closed account is rejected; here we confirm
  // the event was sealed into the audit spine.
  const events = await (await apiFetch(`${base}/audit/events`)).json();
  assert.ok(events.events.some((event) => event.type === "loan_account.restructured"));
});

test("API settles a loan for less than outstanding and writes off another, both four-eyes", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

  const applicationA = await approveAndDisburseApplication(base);
  const accountA = await (await apiFetch(`${base}/loan-accounts/${applicationA.loanAccountId}`)).json();
  const outstanding = accountA.principalAmount;

  // A settlement at or above the outstanding is rejected (use full repayment).
  const tooHigh = await postJson(`${base}/loan-accounts/${accountA.loanAccountId}/settlement`, {
    settlementAmount: outstanding,
    paymentRef: "set_full",
    reason: "hardship",
    proposedBy: "collections-1",
    approvedBy: "collections-lead-1",
    approvalReference: "SET-1"
  });
  assert.equal(tooHigh.status, 422);

  // Four-eyes: proposer cannot also approve.
  const sameActor = await postJson(`${base}/loan-accounts/${accountA.loanAccountId}/settlement`, {
    settlementAmount: round2(outstanding * 0.6),
    paymentRef: "set_x",
    reason: "hardship",
    proposedBy: "collections-1",
    approvedBy: "collections-1",
    approvalReference: "SET-2"
  });
  assert.equal(sameActor.status, 422);

  // A valid compromise settlement: borrower pays 60%, the rest is sacrificed and
  // the account closes as `settled` with a zero balance.
  const settlementAmount = round2(outstanding * 0.6);
  const settled = await postJson(`${base}/loan-accounts/${accountA.loanAccountId}/settlement`, {
    settlementAmount,
    paymentRef: "set_ok",
    reason: "hardship - permanent income loss",
    proposedBy: "collections-1",
    approvedBy: "collections-lead-1",
    approvalReference: "SET-3"
  });
  assert.equal(settled.status, 200);
  assert.equal(settled.body.loanAccount.status, "closed");
  assert.equal(settled.body.loanAccount.closureType, "settled");
  assert.equal(settled.body.settlement.settlementAmount, settlementAmount);
  assert.equal(settled.body.settlement.sacrificeAmount, round2(outstanding - settlementAmount));
  assert.equal(settled.body.summary.totalOutstanding, 0);
  // The sacrifice is a waiver, not cash: total paid stays at the settlement sum.
  assert.equal(settled.body.summary.totalPaid, settlementAmount);

  // The settlement is reported to the CIC as such.
  const snapshotA = await (await apiFetch(`${base}/loan-accounts/${accountA.loanAccountId}/cic-snapshot`)).json();
  assert.equal(snapshotA.settled, true);
  assert.equal(snapshotA.closureType, "settled");

  // A separate account is written off: the account is marked but dues are retained.
  const applicationB = await approveAndDisburseApplication(base);
  const accountB = await (await apiFetch(`${base}/loan-accounts/${applicationB.loanAccountId}`)).json();
  const writtenOff = await postJson(`${base}/loan-accounts/${accountB.loanAccountId}/write-off`, {
    reason: "unrecoverable after recovery efforts",
    proposedBy: "collections-1",
    approvedBy: "collections-lead-1",
    approvalReference: "WO-1"
  });
  assert.equal(writtenOff.status, 200);
  assert.equal(writtenOff.body.loanAccount.status, "written_off");
  assert.equal(writtenOff.body.writeOff.duesRetained, true);
  assert.equal(writtenOff.body.writeOff.writeOffAmount, accountB.principalAmount);
  const snapshotB = await (await apiFetch(`${base}/loan-accounts/${accountB.loanAccountId}/cic-snapshot`)).json();
  assert.equal(snapshotB.writtenOff, true);
  // Dues are retained on the ledger despite the book write-off.
  assert.equal(snapshotB.currentBalance, accountB.principalAmount);

  const events = await (await apiFetch(`${base}/audit/events`)).json();
  assert.ok(events.events.some((event) => event.type === "loan_account.settled"));
  assert.ok(events.events.some((event) => event.type === "loan_account.written_off"));
});

test("API quotes and executes foreclosure, closing the loan account", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();

  // Foreclose before the first installment falls due: only principal is owed.
  const asOf = `${addDays(account.schedule[0].dueDate, -1)}T12:00:00.000Z`;

  const quoteResponse = await apiFetch(`${base}/loan-accounts/${account.loanAccountId}/foreclosure-quote?asOf=${asOf}`);
  assert.equal(quoteResponse.status, 200);
  const quote = await quoteResponse.json();
  assert.equal(quote.interestOutstanding, 0);
  assert.equal(quote.payoffAmount, account.principalAmount);

  const underpay = await postJson(`${base}/loan-accounts/${account.loanAccountId}/foreclosure`, {
    amount: quote.payoffAmount - 1,
    paymentRef: "fc_ref_low",
    foreclosedAt: asOf
  });
  assert.equal(underpay.status, 422);
  assert.equal(underpay.body.error.code, "foreclosure_blocked");
  assert(underpay.body.findings.some((finding) => finding.path === "amount"));

  const foreclosure = await postJson(`${base}/loan-accounts/${account.loanAccountId}/foreclosure`, {
    amount: quote.payoffAmount,
    paymentRef: "fc_ref_full",
    foreclosedAt: asOf
  });
  assert.equal(foreclosure.status, 200);
  assert.equal(foreclosure.body.loanAccount.status, "closed");
  assert.equal(foreclosure.body.foreclosure.payoffAmount, account.principalAmount);
  assert.equal(foreclosure.body.summary.principalOutstanding, 0);
  assert.equal(foreclosure.body.summary.totalOutstanding, 0);

  // A closed account cannot be foreclosed again.
  const repeat = await postJson(`${base}/loan-accounts/${account.loanAccountId}/foreclosure`, {
    amount: quote.payoffAmount,
    paymentRef: "fc_ref_repeat",
    foreclosedAt: asOf
  });
  assert.equal(repeat.status, 422);
  assert.equal(repeat.body.error.code, "foreclosure_blocked");
  assert(repeat.body.findings.some((finding) => finding.path === "status"));
});

test("API rejects prepayment/foreclosure charges on floating-rate individual retail loans and validates resets", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  await seedOperationalActors(base);
  assert.equal((await postJson(`${base}/regulated-entities`, validRegulatedEntity())).status, 201);

  // 1. Prohibits non-zero prepayment/foreclosure charge in prepaymentPolicy/foreclosurePolicy on floating retail
  const invalidPolicy1 = {
    ...validProductPolicy(),
    productId: "invalid_floating_prod",
    productCode: "FL_INVALID",
    interestRateType: "floating",
    interestRateResetPolicy: {
      resetBenchmark: "EBLR",
      resetFrequencyMonths: 3,
      fixedSwitchAllowed: true,
      fixedSwitchFeeAmount: 500
    },
    prepaymentPolicy: { allowed: true, chargeBps: 200, lockInMonths: 0 }
  };
  const invalidResult1 = await postJson(`${base}/products`, invalidPolicy1);
  assert.equal(invalidResult1.status, 422);
  assert(invalidResult1.body.findings.some((f) => f.controlId === "RBI-FPC-PENAL"));

  // 2. Prohibits foreclosure/prepayment charges in the general charges lists on floating retail
  const invalidPolicy2 = {
    ...validProductPolicy(),
    productId: "invalid_floating_prod2",
    productCode: "FL_INVALID2",
    interestRateType: "floating",
    interestRateResetPolicy: {
      resetBenchmark: "EBLR",
      resetFrequencyMonths: 3
    },
    charges: [
      {
        name: "Foreclosure Penalty Charge",
        reason: "penalty on foreclosure",
        amount: 2000,
        type: "fixed"
      }
    ]
  };
  const invalidResult2 = await postJson(`${base}/products`, invalidPolicy2);
  assert.equal(invalidResult2.status, 422);
  assert(invalidResult2.body.findings.some((f) => f.controlId === "RBI-FPC-PENAL"));

  // 3. Register valid floating rate policy
  const validFloatingPolicy = {
    ...validProductPolicy(),
    productId: "floating_prod",
    productCode: "FL_VALID",
    interestRateType: "floating",
    interestRateResetPolicy: {
      resetBenchmark: "EBLR",
      resetFrequencyMonths: 3,
      fixedSwitchAllowed: true,
      fixedSwitchFeeAmount: 1000
    },
    prepaymentPolicy: { allowed: true, chargeBps: 0, lockInMonths: 0 },
    foreclosurePolicy: { allowed: true, chargeBps: 0, lockInMonths: 0 },
    contingentCharges: [
      {
        name: "Rate switch fee",
        reason: "Option to switch to fixed rate exercised at interest rate reset",
        amount: 1000,
        type: "fixed"
      }
    ]
  };
  assert.equal((await postJson(`${base}/products`, validFloatingPolicy)).status, 201);

  // 4. Onboard borrower and create loan account
  assert.equal((await postJson(`${base}/borrowers`, validBorrowerProfile())).status, 201);
  assert.equal((await postJson(`${base}/borrowers/bor_001/consents`, validConsentRecord())).status, 201);
  assert.equal((await postJson(`${base}/borrowers/bor_001/kyc-records`, validKycRecord())).status, 201);

  const application = await postJson(`${base}/loans/applications`, {
    regulatedEntityId: "re_example_nbfc",
    productId: "floating_prod",
    borrowerId: "bor_001",
    requestedAmount: 120000,
    requestedTenorMonths: 12,
    disbursement: validApplication().disbursement,
    repayment: validApplication().repayment
  });
  assert.equal(application.status, 201);

  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.body.applicationId}/kfs`, {
        acceptance: {
          acceptedAt: "2026-07-08T07:00:00.000Z",
          deliveryChannel: "email",
          deliveryRef: "email_msg_123"
        }
      })
    ).status,
    201
  );
  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.body.applicationId}/decision`, {
        status: "approved",
        proposedBy: "credit-maker-1",
        reason: "Approved floating-rate"
      })
    ).status,
    202
  );
  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.body.applicationId}/approvals`, {
        outcome: "approved",
        approvedBy: "credit-checker-1",
        approvalRef: "approval_002"
      })
    ).status,
    200
  );
  await generateAndDeliverDocumentPacket(base, application.body.applicationId);
  const disbursement = await postJson(`${base}/loans/applications/${application.body.applicationId}/disbursement`, {
    destinationAccount: validApplication().disbursement.destinationAccount
  });
  assert.equal(disbursement.status, 200);

  const accountId = disbursement.body.loanAccountId;
  
  // 5. Verify foreclosure quote blocks charging a fee on this floating individual loan
  const quoteRes = await apiFetch(`${base}/loan-accounts/${accountId}/foreclosure-quote?asOf=2026-07-08T12:00:00.000Z`);
  assert.equal(quoteRes.status, 200);
  const quote = await quoteRes.json();
  assert.equal(quote.foreclosureCharge, 0);

  // Try foreclosing with an explicit charge - should fail
  const badForeclose = await postJson(`${base}/loan-accounts/${accountId}/foreclosure`, {
    amount: quote.payoffAmount + 1000,
    foreclosureChargeName: "Foreclosure charge",
    foreclosureChargeAmount: 1000,
    paymentRef: "pmt_fc_001"
  });
  assert.equal(badForeclose.status, 422);

  // 6. Test Interest Rate Resets
  // Propose without checker -> blocked (four-eyes)
  const badReset = await postJson(`${base}/loan-accounts/${accountId}/rate-resets`, {
    newAnnualInterestRateBps: 2000,
    optionSelected: "increase_emi",
    proposedBy: "credit-maker-1",
    approvedBy: "credit-maker-1",
    approvalReference: "ref_001"
  });
  assert.equal(badReset.status, 422);

  // Valid reset: Increase EMI
  const resetEmi = await postJson(`${base}/loan-accounts/${accountId}/rate-resets`, {
    newAnnualInterestRateBps: 2000,
    optionSelected: "increase_emi",
    proposedBy: "credit-maker-1",
    approvedBy: "credit-checker-1",
    approvalReference: "ref_002"
  });
  if (resetEmi.status !== 200) {
    console.log("resetEmi failed body:", JSON.stringify(resetEmi.body, null, 2));
  }
  assert.equal(resetEmi.status, 200);
  assert.equal(resetEmi.body.loanAccount.annualInterestRateBps, 2000);
  assert.equal(resetEmi.body.reset.optionSelected, "increase_emi");
  assert.equal(resetEmi.body.loanAccount.schedule.length, 12);

  // Valid reset: Switch to fixed
  const resetFixed = await postJson(`${base}/loan-accounts/${accountId}/rate-resets`, {
    newAnnualInterestRateBps: 1800,
    optionSelected: "switch_to_fixed",
    proposedBy: "credit-maker-1",
    approvedBy: "credit-checker-1",
    approvalReference: "ref_003"
  });
  if (resetFixed.status !== 200) {
    console.log("resetFixed failed body:", JSON.stringify(resetFixed.body, null, 2));
  }
  assert.equal(resetFixed.status, 200);
  assert.equal(resetFixed.body.loanAccount.interestRateType, "fixed");
  assert(resetFixed.body.events.some((e) => e.chargeName === "Rate switch fee" && e.amount === 1000));
});

test("API enforces lock-in period restrictions for prepayment and foreclosure", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  await seedOperationalActors(base);
  assert.equal((await postJson(`${base}/regulated-entities`, validRegulatedEntity())).status, 201);

  // Register product policy with lock-in periods
  const lockInProduct = {
    ...validProductPolicy(),
    productId: "lockin_prod",
    productCode: "PL_LOCKIN",
    prepaymentPolicy: { allowed: true, chargeBps: 200, lockInMonths: 6 },
    foreclosurePolicy: { allowed: true, chargeBps: 300, lockInMonths: 6 }
  };
  assert.equal((await postJson(`${base}/products`, lockInProduct)).status, 201);

  // Onboard borrower and create loan account
  assert.equal((await postJson(`${base}/borrowers`, validBorrowerProfile())).status, 201);
  assert.equal((await postJson(`${base}/borrowers/bor_001/consents`, validConsentRecord())).status, 201);
  assert.equal((await postJson(`${base}/borrowers/bor_001/kyc-records`, validKycRecord())).status, 201);

  const application = await postJson(`${base}/loans/applications`, {
    regulatedEntityId: "re_example_nbfc",
    productId: "lockin_prod",
    borrowerId: "bor_001",
    requestedAmount: 120000,
    requestedTenorMonths: 12,
    disbursement: validApplication().disbursement,
    repayment: validApplication().repayment
  });
  assert.equal(application.status, 201);

  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.body.applicationId}/kfs`, {
        acceptance: {
          acceptedAt: "2026-07-08T07:00:00.000Z",
          deliveryChannel: "email",
          deliveryRef: "email_msg_123"
        }
      })
    ).status,
    201
  );
  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.body.applicationId}/decision`, {
        status: "approved",
        proposedBy: "credit-maker-1",
        reason: "Approved"
      })
    ).status,
    202
  );
  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.body.applicationId}/approvals`, {
        outcome: "approved",
        approvedBy: "credit-checker-1",
        approvalRef: "approval_002"
      })
    ).status,
    200
  );
  await generateAndDeliverDocumentPacket(base, application.body.applicationId);
  const disbursement = await postJson(`${base}/loans/applications/${application.body.applicationId}/disbursement`, {
    destinationAccount: validApplication().disbursement.destinationAccount,
    disbursedAt: "2026-07-08T12:00:00.000Z"
  });
  assert.equal(disbursement.status, 200);

  const accountId = disbursement.body.loanAccountId;

  // Prepayment on Day 1 (0 months elapsed) -> should fail lock-in
  const badPrepay = await postJson(`${base}/loan-accounts/${accountId}/prepayments`, {
    amount: 10000,
    paymentRef: "pmt_pre_001",
    receivedAt: "2026-07-08T12:00:00.000Z",
    mode: "reduce_emi"
  });
  assert.equal(badPrepay.status, 422);
  assert(badPrepay.body.findings.some((f) => f.path === "prepaymentPolicy.lockInMonths"));

  // Foreclosure quote on Day 1 (0 months elapsed) -> should fail lock-in
  const badQuote = await apiFetch(`${base}/loan-accounts/${accountId}/foreclosure-quote?asOf=2026-07-08T12:00:00.000Z`);
  assert.equal(badQuote.status, 422);
  const badQuoteBody = await badQuote.json();
  assert.equal(badQuoteBody.error.code, "foreclosure_quote_blocked");
  assert(badQuoteBody.findings.some((f) => f.path === "foreclosurePolicy.lockInMonths"));

  // Now test after lock-in period passes (e.g. 7 months later: 2027-02-08)
  const goodPrepay = await postJson(`${base}/loan-accounts/${accountId}/prepayments`, {
    amount: 10000,
    paymentRef: "pmt_pre_002",
    receivedAt: "2027-02-08T12:00:00.000Z",
    mode: "reduce_emi"
  });
  assert.equal(goodPrepay.status, 200);

  const goodQuote = await apiFetch(`${base}/loan-accounts/${accountId}/foreclosure-quote?asOf=2027-02-08T12:00:00.000Z`);
  assert.equal(goodQuote.status, 200);
});

test("API issues a No-Objection closure certificate for a settled loan", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();

  // An active account cannot yet receive a No-Objection Certificate.
  const early = await postJson(`${base}/loan-accounts/${account.loanAccountId}/closure-certificate`, {
    issuedBy: "loan-officer-1"
  });
  assert.equal(early.status, 422);
  assert.equal(early.body.error.code, "closure_certificate_blocked");
  assert(early.body.findings.some((finding) => finding.path === "status"));

  // Settle the loan in full before the first installment falls due.
  const settledAt = `${addDays(account.schedule[0].dueDate, -1)}T12:00:00.000Z`;
  const payoff = await postJson(`${base}/loan-accounts/${account.loanAccountId}/payments`, {
    amount: account.principalAmount,
    paymentRef: "settle_full",
    receivedAt: settledAt
  });
  assert.equal(payoff.status, 200);
  assert.equal(payoff.body.loanAccount.status, "closed");

  const certificate = await postJson(`${base}/loan-accounts/${account.loanAccountId}/closure-certificate`, {
    issuedBy: "loan-officer-1"
  });
  assert.equal(certificate.status, 201);
  assert.equal(certificate.body.reissued, false);
  assert.equal(certificate.body.closureCertificate.documentType, "no_objection_certificate");
  assert.equal(certificate.body.closureCertificate.closureType, "scheduled_closure");
  assert.equal(certificate.body.closureCertificate.totalPaid, account.principalAmount);
  assert(certificate.body.closureCertificate.checksumSha256);
  assert(certificate.body.closureCertificate.declarations.length >= 1);

  const read = await apiFetch(`${base}/loan-accounts/${account.loanAccountId}/closure-certificate`);
  assert.equal(read.status, 200);
  const readBody = await read.json();
  assert.equal(readBody.certificateId, certificate.body.closureCertificate.certificateId);

  // Re-issuing returns the same certificate rather than minting a duplicate.
  const reissue = await postJson(`${base}/loan-accounts/${account.loanAccountId}/closure-certificate`, {
    issuedBy: "loan-officer-1"
  });
  assert.equal(reissue.status, 200);
  assert.equal(reissue.body.reissued, true);
  assert.equal(reissue.body.closureCertificate.certificateId, certificate.body.closureCertificate.certificateId);
});

test("API enforces recovery-agent notice and same-day cash recovery posting", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
  const firstInstallment = account.schedule[0];
  const overdueDate = addDays(firstInstallment.dueDate, 7);

  const delinquencyResponse = await apiFetch(`${base}/loan-accounts/${account.loanAccountId}/delinquency?asOf=${overdueDate}T00:00:00.000Z`);
  assert.equal(delinquencyResponse.status, 200);
  const delinquency = await delinquencyResponse.json();
  assert.equal(delinquency.bucket, "dpd_1_30");

  const unregisteredAgent = await postJson(`${base}/loan-accounts/${account.loanAccountId}/recovery-assignments`, {
    recoveryAgentId: "agent_001",
    recoveryAgentName: "Ravi Collector",
    assignedBy: "collections-manager-1",
    assignedAt: `${overdueDate}T10:00:00.000Z`,
    noticeSentAt: `${overdueDate}T09:00:00.000Z`,
    noticeDeliveryRef: "sms_notice_001"
  });
  assert.equal(unregisteredAgent.status, 422);

  assert.equal((await postJson(`${base}/recovery-agents`, validRecoveryAgent())).status, 201);

  const missingNotice = await postJson(`${base}/loan-accounts/${account.loanAccountId}/recovery-assignments`, {
    recoveryAgentId: "agent_001",
    recoveryAgentName: "Ravi Collector",
    assignedBy: "collections-manager-1",
    assignedAt: `${overdueDate}T10:00:00.000Z`
  });
  assert.equal(missingNotice.status, 422);

  const assignment = await postJson(`${base}/loan-accounts/${account.loanAccountId}/recovery-assignments`, {
    recoveryAgentId: "agent_001",
    recoveryAgentName: "Ravi Collector",
    agencyName: "Example Recovery Services",
    assignedBy: "collections-manager-1",
    assignedAt: `${overdueDate}T10:00:00.000Z`,
    noticeSentAt: `${overdueDate}T09:00:00.000Z`,
    noticeDeliveryRef: "sms_notice_001"
  });
  assert.equal(assignment.status, 201);
  assert.equal(assignment.body.assignment.noticeDeliveryRef, "sms_notice_001");

  const latePosting = await postJson(`${base}/loan-accounts/${account.loanAccountId}/cash-recoveries`, {
    recoveryAgentId: "agent_001",
    amount: firstInstallment.totalDue,
    collectedAt: `${overdueDate}T11:00:00.000Z`,
    postedAt: `${addDays(overdueDate, 1)}T09:00:00.000Z`,
    receiptRef: "cash_receipt_001",
    exceptionReason: "no_digital_access",
    approvedBy: "collections-manager-1",
    approvalRef: "cash_exception_approval_001"
  });
  assert.equal(latePosting.status, 422);

  const missingApprover = await postJson(`${base}/loan-accounts/${account.loanAccountId}/cash-recoveries`, {
    recoveryAgentId: "agent_001",
    amount: firstInstallment.totalDue,
    collectedAt: `${overdueDate}T11:00:00.000Z`,
    postedAt: `${overdueDate}T12:00:00.000Z`,
    receiptRef: "cash_receipt_002"
  });
  assert.equal(missingApprover.status, 422);
  assert.equal(missingApprover.body.error.code, "cash_recovery_access_blocked");
  assert(missingApprover.body.findings.some((finding) => finding.path === "approvedBy"));

  const missingExceptionReason = await postJson(`${base}/loan-accounts/${account.loanAccountId}/cash-recoveries`, {
    recoveryAgentId: "agent_001",
    amount: firstInstallment.totalDue,
    collectedAt: `${overdueDate}T11:00:00.000Z`,
    postedAt: `${overdueDate}T12:00:00.000Z`,
    receiptRef: "cash_receipt_002",
    approvedBy: "collections-manager-1",
    approvalRef: "cash_exception_approval_001"
  });
  assert.equal(missingExceptionReason.status, 422);
  assert.equal(missingExceptionReason.body.error.code, "cash_recovery_blocked");
  assert(missingExceptionReason.body.findings.some((finding) => finding.path === "exceptionReason"));

  const unregisteredApprover = await postJson(`${base}/loan-accounts/${account.loanAccountId}/cash-recoveries`, {
    recoveryAgentId: "agent_001",
    amount: firstInstallment.totalDue,
    collectedAt: `${overdueDate}T11:00:00.000Z`,
    postedAt: `${overdueDate}T12:00:00.000Z`,
    receiptRef: "cash_receipt_002",
    exceptionReason: "no_digital_access",
    approvedBy: "agent_001",
    approvalRef: "cash_exception_approval_001"
  });
  assert.equal(unregisteredApprover.status, 422);

  const cashRecovery = await postJson(`${base}/loan-accounts/${account.loanAccountId}/cash-recoveries`, {
    recoveryAgentId: "agent_001",
    amount: firstInstallment.totalDue,
    collectedAt: `${overdueDate}T11:00:00.000Z`,
    postedAt: `${overdueDate}T12:00:00.000Z`,
    receiptRef: "cash_receipt_002",
    exceptionReason: "no_digital_access",
    approvedBy: "collections-manager-1",
    approvalRef: "cash_exception_approval_001"
  });
  assert.equal(cashRecovery.status, 200);
  assert.equal(cashRecovery.body.paymentEvent.type, "cash_recovery_payment");
  assert.equal(cashRecovery.body.paymentEvent.receiptRef, "cash_receipt_002");
  assert.equal(cashRecovery.body.paymentEvent.exceptionReason, "no_digital_access");
  assert.equal(cashRecovery.body.paymentEvent.approvedBy, "collections-manager-1");
  assert(cashRecovery.body.paymentEvent.interestCredit > 0);
  assert(cashRecovery.body.paymentEvent.principalCredit > 0);
  assert(cashRecovery.body.summary.principalOutstanding < account.summary.principalOutstanding);
});

test("API generates CIC-ready snapshots with asset classification", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
  const asOf = `${addDays(account.schedule[0].dueDate, 91)}T00:00:00.000Z`;

  const classificationResponse = await apiFetch(`${base}/loan-accounts/${account.loanAccountId}/asset-classification?asOf=${asOf}`);
  assert.equal(classificationResponse.status, 200);
  const classification = await classificationResponse.json();
  assert.equal(classification.assetClass, "npa");
  assert.equal(classification.isNpa, true);

  const snapshotResponse = await apiFetch(`${base}/loan-accounts/${account.loanAccountId}/cic-snapshot?asOf=${asOf}`);
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();
  assert.equal(snapshot.loanAccountId, account.loanAccountId);
  assert.equal(snapshot.borrowerId, "bor_001");
  assert.equal(snapshot.assetClass, "npa");
  assert(snapshot.amountOverdue > 0);
  assert(snapshot.currentBalance > 0);

  const allSnapshotsResponse = await apiFetch(`${base}/reporting/cic/snapshots?asOf=${asOf}`);
  assert.equal(allSnapshotsResponse.status, 200);
  const allSnapshots = await allSnapshotsResponse.json();
  assert.equal(allSnapshots.snapshots.length, 1);
  assert.equal(allSnapshots.snapshots[0].assetClass, "npa");
});

test("API routes material AI decisions to human review before proposal", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await createRegistryBackedApplication(base);

  assert.equal(
    (
      await postJson(`${base}/ai/models`, {
        modelId: "uw_score_v1",
        name: "Underwriting scorecard",
        owner: "risk",
        purpose: "credit_underwriting",
        riskTier: "high",
        validationStatus: "approved",
        independentValidationRef: "ivr_001",
        materialDecision: true,
        actor: "model-risk"
      })
    ).status,
    201
  );

  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/kfs`, {
        acceptance: {
          acceptedAt: "2026-07-08T07:00:00.000Z",
          deliveryChannel: "email",
          deliveryRef: "email_msg_123"
        }
      })
    ).status,
    201
  );

  const firstDecision = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    status: "approved",
    proposedBy: "credit-maker-1",
    reason: "AI score supports approval",
    aiDecision: {
      modelId: "uw_score_v1"
    }
  });
  assert.equal(firstDecision.status, 202);
  assert.equal(firstDecision.body.status, "human_review_required");

  const reviewResponse = await postJson(`${base}/loans/applications/${application.applicationId}/human-reviews`, {
    reviewedBy: "credit-reviewer-1",
    reviewRef: "human_review_001",
    outcome: "approved_to_continue",
    notes: "Reviewed model inputs and affordability evidence"
  });
  assert.equal(reviewResponse.status, 200);
  assert.equal(reviewResponse.body.status, "ready_for_decision");

  const secondDecision = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    status: "approved",
    proposedBy: "credit-maker-1",
    reason: "Human review complete"
  });
  assert.equal(secondDecision.status, 202);
  assert.equal(secondDecision.body.status, "pending_decision_approval");
});

test("API routes a referred application to a manual underwriting task", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await createRegistryBackedApplication(base, { requestedAmount: 360000 });

  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/kfs`, {
        acceptance: {
          acceptedAt: "2026-07-08T07:00:00.000Z",
          deliveryChannel: "email",
          deliveryRef: "email_msg_123"
        }
      })
    ).status,
    201
  );

  const storedEligibility = await apiFetch(`${base}/loans/applications/${application.applicationId}/eligibility`);
  assert.equal((await storedEligibility.json()).decision, "refer");

  const referralTasksResponse = await apiFetch(`${base}/workflow/tasks?type=application.manual_underwriting`);
  assert.equal(referralTasksResponse.status, 200);
  const referralTasks = await referralTasksResponse.json();
  assert.equal(referralTasks.count, 1);
  assert.equal(referralTasks.tasks[0].queue, "credit_ops");
  assert.equal(referralTasks.tasks[0].priority, "high");
  assert.equal(referralTasks.tasks[0].sla.targetHours, 8);
  assert.equal(referralTasks.tasks[0].context.eligibility.decision, "refer");

  const creditDecisionTasksResponse = await apiFetch(`${base}/workflow/tasks?type=application.credit_decision`);
  assert.equal((await creditDecisionTasksResponse.json()).count, 0);

  const withoutOverride = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    status: "approved",
    proposedBy: "credit-maker-1",
    reason: "Manual underwriting cleared affordability"
  });
  assert.equal(withoutOverride.status, 422);
  assert.equal(withoutOverride.body.error.code, "decision_blocked");
  assert(withoutOverride.body.findings.some((finding) => finding.path === "manualUnderwriting"));

  const decision = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    status: "approved",
    proposedBy: "credit-maker-1",
    reason: "Manual underwriting cleared affordability",
    manualUnderwriting: {
      underwriterId: "credit-maker-1",
      reason: "Stable salaried income and 9-month bank statements support the review-band FOIR.",
      policyReference: "board_underwriting_policy_v1"
    }
  });
  assert.equal(decision.status, 202);
  assert.equal(decision.body.status, "pending_decision_approval");
  assert.equal(decision.body.pendingDecision.manualUnderwriting.underwriterId, "credit-maker-1");
  assert.equal(decision.body.pendingDecision.manualUnderwriting.policyReference, "board_underwriting_policy_v1");
});

test("API carries manual underwriting override into the approved decision", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await createRegistryBackedApplication(base, { requestedAmount: 360000 });

  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/kfs`, {
        acceptance: {
          acceptedAt: "2026-07-08T07:00:00.000Z",
          deliveryChannel: "email",
          deliveryRef: "email_msg_123"
        }
      })
    ).status,
    201
  );

  const decision = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    status: "approved",
    proposedBy: "credit-maker-1",
    reason: "Review-band affordability cleared on manual assessment",
    manualUnderwriting: {
      underwriterId: "credit-maker-1",
      reason: "Compensating savings balance and clean bureau support the review-band FOIR.",
      policyReference: "board_underwriting_policy_v1",
      compensatingFactors: ["savings_balance", "clean_bureau"]
    }
  });
  assert.equal(decision.status, 202);

  const approvalTasksResponse = await apiFetch(`${base}/workflow/tasks?type=application.decision_approval`);
  const approvalTasks = await approvalTasksResponse.json();
  assert.equal(approvalTasks.count, 1);
  assert.equal(approvalTasks.tasks[0].context.requiresManualUnderwritingReview, true);
  assert.equal(approvalTasks.tasks[0].context.manualUnderwriting.underwriterId, "credit-maker-1");
  assert.equal(approvalTasks.tasks[0].context.manualUnderwriting.policyReference, "board_underwriting_policy_v1");

  const approval = await postJson(`${base}/loans/applications/${application.applicationId}/approvals`, {
    outcome: "approved",
    approvedBy: "credit-checker-1",
    approvalRef: "approval_ref_refer_1"
  });
  assert.equal(approval.status, 200);
  assert.equal(approval.body.status, "approved");
  assert.equal(approval.body.decision.manualUnderwriting.underwriterId, "credit-maker-1");
  assert.equal(approval.body.decision.manualUnderwriting.policyReference, "board_underwriting_policy_v1");
  assert.deepEqual(approval.body.decision.manualUnderwriting.compensatingFactors, [
    "savings_balance",
    "clean_bureau"
  ]);
});

test("API requires the manual underwriting override actor to be a credit officer", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await createRegistryBackedApplication(base, { requestedAmount: 360000 });

  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/kfs`, {
        acceptance: {
          acceptedAt: "2026-07-08T07:00:00.000Z",
          deliveryChannel: "email",
          deliveryRef: "email_msg_123"
        }
      })
    ).status,
    201
  );

  const overrideBody = {
    status: "approved",
    proposedBy: "credit-maker-1",
    reason: "Review-band affordability cleared on manual assessment",
    manualUnderwriting: {
      reason: "Compensating savings balance supports the review-band FOIR.",
      policyReference: "board_underwriting_policy_v1"
    }
  };

  const wrongRole = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    ...overrideBody,
    manualUnderwriting: { ...overrideBody.manualUnderwriting, underwriterId: "credit-checker-1" }
  });
  assert.equal(wrongRole.status, 422);
  assert.equal(wrongRole.body.error.code, "decision_access_blocked");
  assert(wrongRole.body.findings.some((finding) => finding.path === "manualUnderwriting.underwriterId"));

  const unregistered = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    ...overrideBody,
    manualUnderwriting: { ...overrideBody.manualUnderwriting, underwriterId: "ghost-underwriter" }
  });
  assert.equal(unregistered.status, 422);
  assert.equal(unregistered.body.error.code, "decision_access_blocked");

  const valid = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    ...overrideBody,
    manualUnderwriting: { ...overrideBody.manualUnderwriting, underwriterId: "credit-maker-1" }
  });
  assert.equal(valid.status, 202);
  assert.equal(valid.body.status, "pending_decision_approval");
});

test("API blocks a checker who is also the manual underwriting underwriter", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await createRegistryBackedApplication(base, { requestedAmount: 360000 });

  // A dual-role actor could both underwrite and check; four-eyes must still hold.
  assert.equal(
    (
      await postJson(`${base}/staff/actors`, {
        actorId: "credit-dual-1",
        displayName: "Credit Dual Role",
        roles: ["credit_officer", "credit_checker"],
        queues: ["credit_ops", "credit_checker"]
      })
    ).status,
    201
  );

  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/kfs`, {
        acceptance: {
          acceptedAt: "2026-07-08T07:00:00.000Z",
          deliveryChannel: "email",
          deliveryRef: "email_msg_123"
        }
      })
    ).status,
    201
  );

  const decision = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    status: "approved",
    proposedBy: "credit-maker-1",
    reason: "Review-band affordability cleared on manual assessment",
    manualUnderwriting: {
      underwriterId: "credit-dual-1",
      reason: "Compensating savings balance supports the review-band FOIR.",
      policyReference: "board_underwriting_policy_v1"
    }
  });
  assert.equal(decision.status, 202);

  const sameActor = await postJson(`${base}/loans/applications/${application.applicationId}/approvals`, {
    outcome: "approved",
    approvedBy: "credit-dual-1",
    approvalRef: "approval_ref_dual"
  });
  assert.equal(sameActor.status, 422);
  assert.equal(sameActor.body.error.code, "approval_blocked");
  assert(sameActor.body.findings.some((finding) => finding.path === "approvedBy"));

  const distinctChecker = await postJson(`${base}/loans/applications/${application.applicationId}/approvals`, {
    outcome: "approved",
    approvedBy: "credit-checker-1",
    approvalRef: "approval_ref_ok"
  });
  assert.equal(distinctChecker.status, 200);
  assert.equal(distinctChecker.body.status, "approved");
});

test("API requires a coded decline reason and carries it into the decision", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const referenceResponse = await apiFetch(`${base}/reference/decline-reasons`);
  assert.equal(referenceResponse.status, 200);
  const reference = await referenceResponse.json();
  assert(reference.declineReasons.some((entry) => entry.code === "affordability"));

  const application = await createRegistryBackedApplication(base);
  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/kfs`, {
        acceptance: {
          acceptedAt: "2026-07-08T07:00:00.000Z",
          deliveryChannel: "email",
          deliveryRef: "email_msg_123"
        }
      })
    ).status,
    201
  );

  const decisionPath = `${base}/loans/applications/${application.applicationId}/decision`;

  const missingCode = await postJson(decisionPath, {
    status: "declined",
    proposedBy: "credit-maker-1",
    reason: "Not a fit"
  });
  assert.equal(missingCode.status, 422);
  assert.equal(missingCode.body.error.code, "decision_blocked");
  assert(missingCode.body.findings.some((finding) => finding.path === "declineReasonCode"));

  const invalidCode = await postJson(decisionPath, {
    status: "declined",
    proposedBy: "credit-maker-1",
    declineReasonCode: "vibes"
  });
  assert.equal(invalidCode.status, 422);
  assert(invalidCode.body.findings.some((finding) => finding.path === "declineReasonCode"));

  const otherWithoutNarrative = await postJson(decisionPath, {
    status: "declined",
    proposedBy: "credit-maker-1",
    declineReasonCode: "other"
  });
  assert.equal(otherWithoutNarrative.status, 422);
  assert(otherWithoutNarrative.body.findings.some((finding) => finding.path === "declineReasonCode"));

  const decline = await postJson(decisionPath, {
    status: "declined",
    proposedBy: "credit-maker-1",
    declineReasonCode: "adverse_credit_history",
    declineNarrative: "Two active bureau defaults within the last 12 months."
  });
  assert.equal(decline.status, 202);
  assert.equal(decline.body.pendingDecision.declineReason.code, "adverse_credit_history");
  assert.equal(
    decline.body.pendingDecision.declineReason.narrative,
    "Two active bureau defaults within the last 12 months."
  );

  const approval = await postJson(`${base}/loans/applications/${application.applicationId}/approvals`, {
    outcome: "approved",
    approvedBy: "credit-checker-1",
    approvalRef: "approval_ref_decline_1"
  });
  assert.equal(approval.status, 200);
  assert.equal(approval.body.status, "declined");
  assert.equal(approval.body.decision.declineReason.code, "adverse_credit_history");
  assert.equal(approval.body.decision.declineReason.label, "Adverse credit bureau history");
});

test("API exposes LWS decision approval task with assignment lifecycle", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await createRegistryBackedApplication(base);
  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/kfs`, {
        acceptance: {
          acceptedAt: "2026-07-08T07:00:00.000Z",
          deliveryChannel: "email",
          deliveryRef: "email_msg_123"
        }
      })
    ).status,
    201
  );
  const decision = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    status: "approved",
    proposedBy: "credit-maker-1",
    reason: "Policy checks passed"
  });
  assert.equal(decision.status, 202);
  assert.equal(decision.body.status, "pending_decision_approval");

  const taskListResponse = await apiFetch(`${base}/workflow/tasks?type=application.decision_approval`);
  assert.equal(taskListResponse.status, 200);
  const taskList = await taskListResponse.json();
  assert.equal(taskList.count, 1);
  assert.equal(taskList.tasks[0].queue, "credit_checker");
  assert.equal(taskList.tasks[0].status, "open");
  assert.equal(taskList.tasks[0].sla.targetHours, 4);
  assert.equal(taskList.tasks[0].sla.status, "on_track");

  const taskId = encodeURIComponent(taskList.tasks[0].taskId);
  const wrongRoleAssignment = await postJson(`${base}/workflow/tasks/${taskId}/assignments`, {
    assignedTo: "credit-maker-1",
    assignedBy: "credit-lead-1",
    notes: "Wrong role assignment"
  });
  assert.equal(wrongRoleAssignment.status, 422);
  assert(wrongRoleAssignment.body.findings.some((finding) => finding.path === "assignedTo"));

  const assignment = await postJson(`${base}/workflow/tasks/${taskId}/assignments`, {
    assignedTo: "credit-checker-1",
    assignedBy: "credit-lead-1",
    notes: "Checker queue assignment"
  });
  assert.equal(assignment.status, 201);
  assert.equal(assignment.body.task.status, "assigned");
  assert.equal(assignment.body.task.assignedTo, "credit-checker-1");

  const wrongStarter = await postJson(`${base}/workflow/tasks/${taskId}/start`, {
    actor: "credit-maker-1"
  });
  assert.equal(wrongStarter.status, 422);

  const start = await postJson(`${base}/workflow/tasks/${taskId}/start`, {
    actor: "credit-checker-1"
  });
  assert.equal(start.status, 200);
  assert.equal(start.body.task.status, "in_progress");

  const taskAfterStartResponse = await apiFetch(`${base}/workflow/tasks/${taskId}`);
  assert.equal(taskAfterStartResponse.status, 200);
  const taskAfterStart = await taskAfterStartResponse.json();
  assert.equal(taskAfterStart.status, "in_progress");

  const approval = await postJson(`${base}/loans/applications/${application.applicationId}/approvals`, {
    outcome: "approved",
    approvedBy: "credit-checker-1",
    approvalRef: "approval_003"
  });
  assert.equal(approval.status, 200);
  assert.equal(approval.body.status, "approved");

  const taskAfterApprovalResponse = await apiFetch(`${base}/workflow/tasks?type=application.decision_approval`);
  assert.equal(taskAfterApprovalResponse.status, 200);
  const taskAfterApproval = await taskAfterApprovalResponse.json();
  assert.equal(taskAfterApproval.count, 0);
});

test("API exposes LWS recovery task until noticed recovery assignment is recorded", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await apiFetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
  const overdueDate = addDays(account.schedule[0].dueDate, 10);
  const asOf = `${overdueDate}T00:00:00.000Z`;

  const tasksResponse = await apiFetch(`${base}/workflow/tasks?type=loan_account.recovery_assignment&asOf=${asOf}`);
  assert.equal(tasksResponse.status, 200);
  const tasks = await tasksResponse.json();
  assert.equal(tasks.count, 1);
  assert.equal(tasks.tasks[0].queue, "collections_ops");
  assert.equal(tasks.tasks[0].context.delinquency.bucket, "dpd_1_30");
  assert.equal(tasks.tasks[0].sla.targetHours, 24);

  const taskId = encodeURIComponent(tasks.tasks[0].taskId);
  const wrongRoleAssignment = await postJson(`${base}/workflow/tasks/${taskId}/assignments`, {
    assignedTo: "credit-checker-1",
    assignedBy: "collections-lead-1",
    asOf
  });
  assert.equal(wrongRoleAssignment.status, 422);

  const assignment = await postJson(`${base}/workflow/tasks/${taskId}/assignments`, {
    assignedTo: "collections-manager-1",
    assignedBy: "collections-lead-1",
    asOf
  });
  assert.equal(assignment.status, 201);
  assert.equal(assignment.body.task.status, "assigned");

  assert.equal(
    (await postJson(`${base}/recovery-agents`, validRecoveryAgent({ recoveryAgentId: "agent_002", name: "Meera Collector" }))).status,
    201
  );

  const recoveryAssignment = await postJson(`${base}/loan-accounts/${account.loanAccountId}/recovery-assignments`, {
    recoveryAgentId: "agent_002",
    recoveryAgentName: "Meera Collector",
    agencyName: "Example Recovery Services",
    assignedBy: "collections-manager-1",
    assignedAt: `${overdueDate}T10:00:00.000Z`,
    noticeSentAt: `${overdueDate}T09:00:00.000Z`,
    noticeDeliveryRef: "sms_notice_002"
  });
  assert.equal(recoveryAssignment.status, 201);

  const tasksAfterDomainActionResponse = await apiFetch(`${base}/workflow/tasks?type=loan_account.recovery_assignment&asOf=${asOf}`);
  assert.equal(tasksAfterDomainActionResponse.status, 200);
  const tasksAfterDomainAction = await tasksAfterDomainActionResponse.json();
  assert.equal(tasksAfterDomainAction.count, 0);
});

test("API manages grievance complaint lifecycle with LWS tasks", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const complaintResponse = await postJson(`${base}/complaints`, {
    borrowerId: "bor_001",
    regulatedEntityId: "re_example_nbfc",
    applicationId: application.applicationId,
    loanAccountId: application.loanAccountId,
    channel: "email",
    category: "collections",
    summary: "Borrower disputes collection call timing",
    description: "Borrower says contact was made outside permitted hours.",
    acknowledgementRef: "ack_email_001",
    receivedAt: "2026-07-09T10:00:00.000Z",
    complainant: {
      fullName: "Asha Sharma",
      email: "asha@example.in"
    }
  });
  assert.equal(complaintResponse.status, 201);
  assert.equal(complaintResponse.body.complaint.status, "received");
  assert.equal(complaintResponse.body.complaint.sla.targetDays, 30);

  const assignmentTasksResponse = await apiFetch(`${base}/workflow/tasks?type=complaint.assignment&asOf=2026-07-09T11:00:00.000Z`);
  assert.equal(assignmentTasksResponse.status, 200);
  const assignmentTasks = await assignmentTasksResponse.json();
  assert.equal(assignmentTasks.count, 1);
  assert.equal(assignmentTasks.tasks[0].queue, "grievance_ops");
  assert.equal(assignmentTasks.tasks[0].role, "grievance_officer");

  const wrongAssignment = await postJson(`${base}/complaints/${complaintResponse.body.complaint.complaintId}/assignments`, {
    assignedTo: "credit-checker-1",
    assignedBy: "grievance-lead-1"
  });
  assert.equal(wrongAssignment.status, 422);

  const assignment = await postJson(`${base}/complaints/${complaintResponse.body.complaint.complaintId}/assignments`, {
    assignedTo: "grievance-officer-1",
    assignedBy: "grievance-lead-1",
    notes: "Route to grievance officer"
  });
  assert.equal(assignment.status, 201);
  assert.equal(assignment.body.complaint.status, "assigned");

  const resolutionTasksResponse = await apiFetch(`${base}/workflow/tasks?type=complaint.resolution&asOf=2026-07-10T10:00:00.000Z`);
  assert.equal(resolutionTasksResponse.status, 200);
  const resolutionTasks = await resolutionTasksResponse.json();
  assert.equal(resolutionTasks.count, 1);
  assert.equal(resolutionTasks.tasks[0].sla.targetHours, 720);

  const review = await postJson(`${base}/complaints/${complaintResponse.body.complaint.complaintId}/reviews`, {
    actor: "grievance-officer-1",
    notes: "Review call logs and recovery assignment evidence"
  });
  assert.equal(review.status, 200);
  assert.equal(review.body.complaint.status, "under_review");

  const resolution = await postJson(`${base}/complaints/${complaintResponse.body.complaint.complaintId}/resolution`, {
    actor: "grievance-officer-1",
    outcome: "resolved",
    resolutionSummary: "Call logs reviewed; borrower informed of corrected contact window.",
    borrowerCommunicationRef: "email_resolution_001",
    closureEvidenceRef: "closure_pack_001"
  });
  assert.equal(resolution.status, 200);
  assert.equal(resolution.body.complaint.status, "resolved");
  assert.equal(resolution.body.complaint.sla.status, "closed_in_time");

  const tasksAfterResolutionResponse = await apiFetch(`${base}/workflow/tasks?entityType=complaint`);
  assert.equal(tasksAfterResolutionResponse.status, 200);
  const tasksAfterResolution = await tasksAfterResolutionResponse.json();
  assert.equal(tasksAfterResolution.count, 0);
});

test("API raises RBI CMS escalation task for 30-day grievance breach", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  await createRegistryBackedApplication(base);
  const complaintResponse = await postJson(`${base}/complaints`, {
    borrowerId: "bor_001",
    regulatedEntityId: "re_example_nbfc",
    channel: "web",
    category: "kfs_disclosure",
    summary: "Borrower says APR disclosure was unclear",
    acknowledgementRef: "ack_web_002",
    receivedAt: "2026-07-01T09:00:00.000Z",
    complainant: {
      fullName: "Asha Sharma",
      mobile: "+919999999999"
    }
  });
  assert.equal(complaintResponse.status, 201);

  const overdueComplaintResponse = await apiFetch(`${base}/complaints/${complaintResponse.body.complaint.complaintId}?asOf=2026-08-02T09:00:00.000Z`);
  assert.equal(overdueComplaintResponse.status, 200);
  const overdueComplaint = await overdueComplaintResponse.json();
  assert.equal(overdueComplaint.effectiveStatus, "escalation_due");
  assert.equal(overdueComplaint.sla.status, "breached");

  const escalationTasksResponse = await apiFetch(`${base}/workflow/tasks?type=complaint.rbi_cms_escalation&asOf=2026-08-02T09:00:00.000Z`);
  assert.equal(escalationTasksResponse.status, 200);
  const escalationTasks = await escalationTasksResponse.json();
  assert.equal(escalationTasks.count, 1);
  assert.equal(escalationTasks.tasks[0].priority, "critical");

  const prematureEscalation = await postJson(`${base}/complaints/${complaintResponse.body.complaint.complaintId}/rbi-cms-escalation`, {
    actor: "grievance-officer-1",
    rbiCmsRef: "CMS-2026-0001",
    reason: "awaiting_internal_review"
  });
  assert.equal(prematureEscalation.status, 422);

  const escalation = await postJson(`${base}/complaints/${complaintResponse.body.complaint.complaintId}/rbi-cms-escalation`, {
    actor: "grievance-officer-1",
    rbiCmsRef: "CMS-2026-0001",
    reason: "borrower_dissatisfied",
    notes: "Borrower opted to escalate through RBI CMS."
  });
  assert.equal(escalation.status, 200);
  assert.equal(escalation.body.complaint.status, "escalated_to_rbi_cms");
  assert.equal(escalation.body.complaint.escalations[0].rbiCmsRef, "CMS-2026-0001");
});

test("eligibility engine assesses affordability and product bounds", () => {
  const affordable = evaluateEligibility(eligibilityApplication(), { now: new Date("2026-07-08T00:00:00.000Z") });
  assert.equal(affordable.assessment.decision, ELIGIBILITY_DECISIONS.ELIGIBLE);
  assert.equal(affordable.summary.status, "ready");
  assert(Number.isFinite(affordable.assessment.metrics.estimatedEmi));
  assert.equal(affordable.assessment.metrics.estimatedEmi, estimateEmi(125000, 1800, 12));

  const foirBreach = evaluateEligibility(
    eligibilityApplication({
      economicProfile: { occupation: "salaried", monthlyIncome: 75000 },
      product: { requestedAmount: 450000, requestedTenorMonths: 12 }
    }),
    { now: new Date("2026-07-08T00:00:00.000Z") }
  );
  assert.equal(foirBreach.assessment.decision, ELIGIBILITY_DECISIONS.INELIGIBLE);
  assert(foirBreach.assessment.metrics.foir > 0.5);
  assert(foirBreach.findings.some((finding) => finding.path === "economicProfile.monthlyIncome"));

  const overMax = evaluateEligibility(
    eligibilityApplication({ product: { requestedAmount: 600000, requestedTenorMonths: 12 } }),
    { now: new Date("2026-07-08T00:00:00.000Z") }
  );
  assert.equal(overMax.assessment.decision, ELIGIBILITY_DECISIONS.INELIGIBLE);
  assert(overMax.findings.some((finding) => finding.path === "product.requestedAmount"));

  const refer = evaluateEligibility(
    eligibilityApplication({
      economicProfile: { occupation: "salaried", monthlyIncome: 30000 },
      product: { requestedAmount: 140000, requestedTenorMonths: 12 }
    }),
    { now: new Date("2026-07-08T00:00:00.000Z") }
  );
  assert.equal(refer.assessment.decision, ELIGIBILITY_DECISIONS.REFER);
  assert.equal(refer.summary.status, "review");
});

test("API assesses eligibility and blocks approval of an ineligible borrower", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await createRegistryBackedApplication(base, { requestedAmount: 450000 });

  const eligibilityResponse = await postJson(`${base}/loans/applications/${application.applicationId}/eligibility`, {});
  assert.equal(eligibilityResponse.status, 200);
  assert.equal(eligibilityResponse.body.assessment.decision, "ineligible");
  assert(eligibilityResponse.body.assessment.metrics.foir > 0.5);

  const storedEligibility = await apiFetch(`${base}/loans/applications/${application.applicationId}/eligibility`);
  assert.equal(storedEligibility.status, 200);
  assert.equal((await storedEligibility.json()).decision, "ineligible");

  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/kfs`, {
        acceptance: {
          acceptedAt: "2026-07-08T07:00:00.000Z",
          deliveryChannel: "email",
          deliveryRef: "email_msg_123"
        }
      })
    ).status,
    201
  );

  const approval = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    status: "approved",
    proposedBy: "credit-maker-1",
    reason: "Override attempt"
  });
  assert.equal(approval.status, 422);
  assert.equal(approval.body.error.code, "decision_blocked");
  assert(approval.body.findings.some((finding) => finding.path === "economicProfile.monthlyIncome"));

  const decline = await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
    status: "declined",
    proposedBy: "credit-maker-1",
    reason: "Affordability not met",
    declineReasonCode: "affordability"
  });
  assert.equal(decline.status, 202);
  assert.equal(decline.body.status, "pending_decision_approval");
  assert.equal(decline.body.pendingDecision.declineReason.code, "affordability");
});

test("data-plane rejects a missing or invalid tenant api key", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // No key at all.
  const noKey = await rawFetch(`${base}/regulated-entities`);
  assert.equal(noKey.status, 401);
  assert.equal((await noKey.json()).error.code, "tenant_auth_required");

  // A key that maps to no tenant.
  const badKey = await apiFetch(`${base}/regulated-entities`, {}, "not-a-real-key");
  assert.equal(badKey.status, 401);

  // Writes are rejected too, so an unauthenticated caller cannot seed data.
  const blockedWrite = await postJson(`${base}/regulated-entities`, validRegulatedEntity(), "not-a-real-key");
  assert.equal(blockedWrite.status, 401);

  // Open routes stay reachable without a tenant.
  assert.equal((await rawFetch(`${base}/health`)).status, 200);
  assert.equal((await rawFetch(`${base}/compliance/controls`)).status, 200);

  // The valid tenant key works.
  const ok = await apiFetch(`${base}/regulated-entities`);
  assert.equal(ok.status, 200);
});

test("platform admin can mint a tenant and its api key", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const adminKey = "platform-admin-secret";
  const server = createLoanOsServer({ dataDir, platformAdminKey: adminKey });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // Minting requires the platform admin key, not a tenant key.
  const forbidden = await rawFetch(`${base}/platform/tenants`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: "tnt_minted" })
  });
  assert.equal(forbidden.status, 403);

  const created = await rawFetch(`${base}/platform/tenants`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-platform-admin-key": adminKey },
    body: JSON.stringify({ tenantId: "tnt_minted", name: "Minted RE" })
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.tenant.tenantId, "tnt_minted");
  assert.equal(createdBody.tenant.isolationTier, "pooled");
  assert.ok(createdBody.apiKey, "a one-time api key is returned");
  // The secret is never persisted in listable form.
  assert.equal(createdBody.tenant.apiKeyHash, undefined);

  // The minted key immediately authenticates data-plane calls.
  const asMinted = await apiFetch(`${base}/regulated-entities`, {}, createdBody.apiKey);
  assert.equal(asMinted.status, 200);

  // Duplicate tenant ids are rejected.
  const dup = await rawFetch(`${base}/platform/tenants`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-platform-admin-key": adminKey },
    body: JSON.stringify({ tenantId: "tnt_minted" })
  });
  assert.equal(dup.status, 409);
});

test("tenants are isolated: one tenant cannot read or mutate another's data", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A, TENANT_B] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // Tenant A seeds a full set of records across resource types.
  assert.equal((await postJson(`${base}/regulated-entities`, validRegulatedEntity(), TENANT_A.apiKey)).status, 201);
  assert.equal((await postJson(`${base}/products`, validProductPolicy(), TENANT_A.apiKey)).status, 201);
  assert.equal((await postJson(`${base}/borrowers`, validBorrowerProfile(), TENANT_A.apiKey)).status, 201);
  assert.equal(
    (await postJson(`${base}/borrowers/bor_001/consents`, validConsentRecord(), TENANT_A.apiKey)).status,
    201
  );
  assert.equal(
    (await postJson(`${base}/staff/actors`, {
      actorId: "credit-maker-1",
      displayName: "Credit Maker",
      roles: ["credit_officer"],
      queues: ["credit_ops"]
    }, TENANT_A.apiKey)).status,
    201
  );

  // Tenant B sees none of tenant A's records across every collection.
  const listChecks = [
    ["regulated-entities", "regulatedEntities"],
    ["products", "products"],
    ["borrowers", "borrowers"],
    ["staff/actors", "actors"],
    ["loan-accounts", "loanAccounts"]
  ];
  for (const [path, key] of listChecks) {
    const asB = await apiFetch(`${base}/${path}`, {}, TENANT_B.apiKey);
    assert.equal(asB.status, 200);
    const body = await asB.json();
    assert.equal(body[key].length, 0, `tenant B must not see tenant A ${path}`);
  }

  // Direct-by-id reads from tenant B 404, even though the record exists for A.
  assert.equal((await apiFetch(`${base}/regulated-entities/re_example_nbfc`, {}, TENANT_B.apiKey)).status, 404);
  assert.equal((await apiFetch(`${base}/borrowers/bor_001`, {}, TENANT_B.apiKey)).status, 404);
  assert.equal((await apiFetch(`${base}/staff/actors/credit-maker-1`, {}, TENANT_B.apiKey)).status, 404);

  // Tenant B cannot mutate tenant A's borrower by re-using the id: the write
  // lands in tenant B's own partition and never touches tenant A.
  assert.equal(
    (await postJson(`${base}/borrowers/bor_001/consents`, validConsentRecord(), TENANT_B.apiKey)).status,
    404
  );

  // Tenant A still sees exactly its own data, unchanged.
  const aEntities = await (await apiFetch(`${base}/regulated-entities`, {}, TENANT_A.apiKey)).json();
  assert.equal(aEntities.regulatedEntities.length, 1);
  const aBorrower = await apiFetch(`${base}/borrowers/bor_001`, {}, TENANT_A.apiKey);
  assert.equal(aBorrower.status, 200);
});

test("audit spine hash-chains events with a verifiable, tamper-evident chain", () => {
  // Pure-function proof: sealing produces a linked chain, verification passes,
  // and any edit, reorder, or genesis swap is detected.
  const raw = [
    { type: "loan.application.created", applicationId: "app_1", at: "2026-07-01T00:00:00.000Z" },
    { type: "loan.kfs.generated", applicationId: "app_1", at: "2026-07-02T00:00:00.000Z" },
    { type: "loan.decision.approved", applicationId: "app_1", at: "2026-07-03T00:00:00.000Z" }
  ];
  const sealed = sealAuditChain(raw, "tnt_x");

  assert.deepEqual(sealed.map((event) => event.sequence), [0, 1, 2]);
  assert.ok(sealed.every((event) => event.tenantId === "tnt_x" && event.hash && event.previousHash));
  assert.equal(sealed[1].previousHash, sealed[0].hash);
  assert.equal(sealed[2].previousHash, sealed[1].hash);
  assert.equal(verifyAuditChain(sealed, "tnt_x").valid, true);

  // A chain sealed for one tenant does not verify under another tenant's root.
  assert.equal(verifyAuditChain(sealed, "tnt_other").valid, false);

  // Editing a payload field breaks the chain at that event.
  const edited = sealed.map((event, index) => (index === 1 ? { ...event, applicationId: "app_999" } : event));
  const editedResult = verifyAuditChain(edited, "tnt_x");
  assert.equal(editedResult.valid, false);
  assert.equal(editedResult.brokenAt, 1);
  assert.equal(editedResult.reason, "hash_mismatch");

  // Dropping an event breaks the sequence/linkage.
  const dropped = [sealed[0], sealed[2]];
  assert.equal(verifyAuditChain(dropped, "tnt_x").valid, false);

  // Re-sealing an already-sealed chain is a no-op (idempotent).
  const reSealed = sealAuditChain(sealed, "tnt_x");
  assert.deepEqual(reSealed.map((event) => event.hash), sealed.map((event) => event.hash));

  // A filtered evidence pack still attests integrity over the whole chain.
  const pack = buildAuditEvidencePack(sealed, "tnt_x", { filters: { type: "loan.kfs.generated" } });
  assert.equal(pack.eventCount, 3);
  assert.equal(pack.exportedCount, 1);
  assert.equal(pack.integrity.valid, true);
});

test("API seals events into an audit chain and exports a verifiable evidence pack", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A, TENANT_B] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // Drive a full origination under tenant A; this emits many audit events.
  await approveAndDisburseApplication(base);

  const events = await (await apiFetch(`${base}/audit/events`, {}, TENANT_A.apiKey)).json();
  assert.ok(events.count > 3, "origination should emit several audit events");
  assert.equal(events.chainValid, true);
  assert.deepEqual(
    events.events.map((event) => event.sequence),
    events.events.map((_event, index) => index)
  );
  assert.ok(events.events.every((event) => event.tenantId === TENANT_A.tenantId && event.hash));
  assert.ok(events.events.some((event) => event.type === "loan.disbursement.recorded"));

  // The export pack verifies and carries genesis/head anchors.
  const exportResponse = await apiFetch(`${base}/audit/export`, {}, TENANT_A.apiKey);
  assert.equal(exportResponse.status, 200);
  const pack = await exportResponse.json();
  assert.equal(pack.tenantId, TENANT_A.tenantId);
  assert.equal(pack.integrity.valid, true);
  assert.equal(pack.eventCount, events.count);
  assert.ok(pack.genesisHash && pack.headHash);

  // Filtering narrows the exported events but keeps whole-chain integrity.
  const filtered = await (
    await apiFetch(`${base}/audit/export?type=loan.disbursement.recorded`, {}, TENANT_A.apiKey)
  ).json();
  assert.equal(filtered.exportedCount, 1);
  assert.equal(filtered.eventCount, events.count);
  assert.equal(filtered.integrity.valid, true);

  // The audit spine is tenant-scoped: tenant B sees none of tenant A's events.
  const bEvents = await (await apiFetch(`${base}/audit/events`, {}, TENANT_B.apiKey)).json();
  assert.equal(bEvents.count, 0);
  assert.equal(bEvents.chainValid, true);
});

test("DPDP erasure is held by an active loan and by statutory retention", () => {
  // Active loan relationship blocks erasure outright.
  const active = assessErasureEligibility(
    "bor_001",
    { loanAccounts: { acct_1: { loanAccountId: "acct_1", borrowerId: "bor_001", status: "active" } } },
    new Date("2026-07-09T00:00:00.000Z")
  );
  assert.equal(active.eligible, false);
  assert(active.holds.some((hold) => hold.code === "active_loan_relationship"));

  // A recently closed loan is within the 5-year statutory retention window.
  const recentlyClosed = assessErasureEligibility(
    "bor_001",
    {
      loanAccounts: {
        acct_1: { loanAccountId: "acct_1", borrowerId: "bor_001", status: "closed", closedAt: "2024-01-01T00:00:00.000Z" }
      }
    },
    new Date("2026-07-09T00:00:00.000Z")
  );
  assert.equal(recentlyClosed.eligible, false);
  assert.equal(recentlyClosed.retainUntil, "2029-01-01T00:00:00.000Z");

  // Past the retention window, erasure is eligible.
  const longClosed = assessErasureEligibility(
    "bor_001",
    {
      loanAccounts: {
        acct_1: { loanAccountId: "acct_1", borrowerId: "bor_001", status: "closed", closedAt: "2018-01-01T00:00:00.000Z" }
      }
    },
    new Date("2026-07-09T00:00:00.000Z")
  );
  assert.equal(longClosed.eligible, true);

  // Fulfilment is blocked while a retention hold stands.
  const created = createErasureRequest(
    {},
    { borrowerId: "bor_001", requestedBy: "dpo-1" },
    { borrowerProfiles: { bor_001: { borrowerId: "bor_001" } } }
  );
  assert.equal(created.summary.status, "ready");
  const blocked = fulfillErasureRequest(
    created.request,
    { actor: "dpo-1", confirmationRef: "ERASE-1" },
    {
      loanAccounts: {
        acct_1: { loanAccountId: "acct_1", borrowerId: "bor_001", status: "closed", closedAt: "2024-01-01T00:00:00.000Z" }
      }
    },
    new Date("2026-07-09T00:00:00.000Z")
  );
  assert.equal(blocked.summary.status, "blocked");
});

test("generative model validation requires adversarial and hallucination testing", () => {
  const registered = registerModel(createModelRegistryState(), {
    modelId: "gen_assist_v1",
    name: "Generative loan assistant",
    owner: "risk-owner",
    purpose: "customer support",
    riskTier: "medium",
    modelClass: "generative",
    validationStatus: "pending",
    actor: "model-risk"
  });
  assert.equal(registered.model.modelClass, "generative");

  const submitted = transitionModel(registered.registry, {
    modelId: "gen_assist_v1",
    action: "submit_for_validation",
    actor: "risk-owner"
  });

  // With independent validation but no red-team/hallucination evidence, blocked.
  const missing = transitionModel(submitted.registry, {
    modelId: "gen_assist_v1",
    action: "approve_validation",
    actor: "validator-1",
    independentValidationRef: "ivr_1"
  });
  assert.equal(missing.summary.status, "blocked");
  assert(missing.findings.some((finding) => finding.path === "redTeamRef"));
  assert(missing.findings.some((finding) => finding.path === "hallucinationTestRef"));

  // Providing both testing references clears validation.
  const approved = transitionModel(submitted.registry, {
    modelId: "gen_assist_v1",
    action: "approve_validation",
    actor: "validator-1",
    independentValidationRef: "ivr_1",
    redTeamRef: "redteam_1",
    hallucinationTestRef: "halluc_1"
  });
  assert.equal(approved.summary.status, "ready");
  assert.equal(approved.model.status, "approved");
  assert.equal(approved.model.redTeamRef, "redteam_1");
  assert.equal(approved.model.hallucinationTestRef, "halluc_1");
});

test("model drift monitoring trips a kill switch on a threshold breach", () => {
  // An approved model registers straight into active with a drift threshold.
  const registered = registerModel(createModelRegistryState(), {
    modelId: "score_v1",
    name: "Behaviour score",
    owner: "risk-owner",
    purpose: "credit_scoring",
    riskTier: "high",
    validationStatus: "approved",
    driftThreshold: 0.2,
    actor: "model-risk"
  });
  assert.equal(registered.model.status, "active");

  // Drift monitoring rejects a reading with no numeric value.
  const invalid = recordDriftObservation(registered.registry, { modelId: "score_v1", metric: "psi", actor: "monitor" });
  assert.equal(invalid.summary.status, "blocked");

  // A within-threshold reading is recorded and leaves the model active.
  const stable = recordDriftObservation(registered.registry, {
    modelId: "score_v1",
    metric: "psi",
    value: 0.12,
    actor: "monitor"
  });
  assert.equal(stable.breached, false);
  assert.equal(stable.model.status, "active");
  assert.equal(stable.model.driftObservations.length, 1);

  // A breaching reading trips the model kill switch: suspended + incident opened.
  const breach = recordDriftObservation(stable.registry, {
    modelId: "score_v1",
    metric: "psi",
    value: 0.35,
    actor: "monitor"
  });
  assert.equal(breach.breached, true);
  assert.equal(breach.model.status, "suspended");
  assert.ok(breach.incident);
  assert.equal(breach.incident.scope, "model");
  assert.equal(breach.incident.status, "open");
  // A suspended model no longer accepts drift observations.
  const afterSuspend = recordDriftObservation(breach.registry, {
    modelId: "score_v1",
    metric: "psi",
    value: 0.1,
    actor: "monitor"
  });
  assert.equal(afterSuspend.summary.status, "blocked");
});

test("fraud classification is gated on natural justice and four-eyes approval", () => {
  const created = createFraudCase(
    {},
    {
      category: "diversion_of_funds",
      summary: "Loan proceeds routed to an unrelated third party",
      subjectBorrowerId: "bor_001",
      reportedBy: "fraud-analyst-1"
    }
  );
  assert.equal(created.summary.status, "ready");
  const fraudCase = created.fraudCase;

  // Classifying as fraud before any show-cause notice is blocked (natural justice).
  const premature = classifyFraudCase(fraudCase, {
    classification: "fraud",
    actor: "fraud-committee-1",
    reason: "Funds diverted"
  });
  assert.equal(premature.summary.status, "blocked");
  assert(premature.findings.some((finding) => finding.message.includes("show-cause notice")));

  // Issue the show-cause notice; the borrower gets a 21-day response window.
  const noticed = issueShowCauseNotice(
    fraudCase,
    {
      actor: "fraud-analyst-1",
      noticeReference: "SCN-001",
      deliveryRef: "email-ack-001",
      issuedAt: "2026-06-01T00:00:00.000Z"
    },
    new Date("2026-06-01T00:00:00.000Z")
  );
  assert.equal(noticed.summary.status, "ready");
  assert.equal(noticed.fraudCase.naturalJustice.responseDueBy, "2026-06-22T00:00:00.000Z");

  // Within the window and with no response, classification is still blocked.
  const tooSoon = classifyFraudCase(
    noticed.fraudCase,
    { classification: "fraud", actor: "fraud-committee-1", reason: "Funds diverted" },
    new Date("2026-06-10T00:00:00.000Z")
  );
  assert.equal(tooSoon.summary.status, "blocked");

  // Once the borrower responds, the four-eyes rule still applies.
  const responded = recordFraudResponse(
    noticed.fraudCase,
    { actor: "fraud-analyst-1", summary: "Borrower denies diversion", receivedAt: "2026-06-08T00:00:00.000Z" },
    new Date("2026-06-08T00:00:00.000Z")
  );
  const sameActor = classifyFraudCase(
    responded.fraudCase,
    { classification: "fraud", actor: "fraud-analyst-1", reason: "Rejecting representation" },
    new Date("2026-06-09T00:00:00.000Z")
  );
  assert.equal(sameActor.summary.status, "blocked");
  assert(sameActor.findings.some((finding) => finding.message.includes("other than the investigator")));

  // An independent authority can now classify the case.
  const classified = classifyFraudCase(
    responded.fraudCase,
    { classification: "fraud", actor: "fraud-committee-1", reason: "Representation rejected", committeeRef: "FC-2026-01" },
    new Date("2026-06-09T00:00:00.000Z")
  );
  assert.equal(classified.summary.status, "ready");
  assert.equal(classified.fraudCase.status, "classified_fraud");
});

test("fraud committee pack seals the case and states classification readiness", () => {
  const created = createFraudCase(
    {},
    {
      category: "misrepresentation",
      summary: "Inflated turnover in the application",
      subjectBorrowerId: "bor_001",
      reportedBy: "fraud-analyst-1"
    }
  );

  // Before any notice, the pack flags that classification is not yet permitted.
  const early = generateFraudCommitteePack(created.fraudCase, {}, new Date("2026-06-01T00:00:00.000Z"));
  assert.equal(early.summary.status, "ready");
  assert.equal(early.committeePack.classificationPermitted, false);
  assert.ok(early.committeePack.blockers.some((blocker) => blocker.includes("show-cause")));
  assert.ok(early.committeePack.checksumSha256);

  // Any edit to the sealed content changes the checksum (tamper-evident).
  const tampered = { ...early.committeePack, case: { ...early.committeePack.case, summary: "edited" } };
  const { checksumSha256, ...content } = tampered;
  const recomputed = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  assert.notEqual(recomputed, checksumSha256);

  // After notice + response, the pack reports classification is permitted.
  const noticed = issueShowCauseNotice(created.fraudCase, {
    actor: "fraud-analyst-1",
    noticeReference: "SCN-2",
    deliveryRef: "ack-2",
    issuedAt: "2026-06-01T00:00:00.000Z"
  });
  const responded = recordFraudResponse(noticed.fraudCase, {
    actor: "fraud-analyst-1",
    summary: "Borrower disputes the figures"
  });
  const ready = generateFraudCommitteePack(responded.fraudCase, {}, new Date("2026-06-05T00:00:00.000Z"));
  assert.equal(ready.committeePack.classificationPermitted, true);
  assert.equal(ready.committeePack.blockers.length, 0);
  assert.equal(ready.committeePack.naturalJustice.responded, true);
});

test("incident reporting clock breaches after the 6-hour CERT-In/RBI window", () => {
  const detectedAt = "2026-07-09T00:00:00.000Z";
  const created = createIncident(
    {},
    {
      category: "data_breach",
      severity: "high",
      summary: "Unauthorized access to a KYC datastore",
      detectedAt,
      actor: "ciso"
    },
    new Date(detectedAt)
  );
  assert.equal(created.summary.status, "ready");
  const incident = created.incident;
  // Reportable to both authorities by default, each on a 6-hour clock.
  assert.deepEqual(
    incident.reporting.map((clock) => clock.authority).sort(),
    ["cert_in", "rbi"]
  );

  // Within the window, unreported, the clock is on track.
  const inWindow = computeIncidentReportingClock(incident, "cert_in", new Date("2026-07-09T03:00:00.000Z"));
  assert.equal(inWindow.breached, false);
  assert.equal(inWindow.status, "on_track");

  // Past 6 hours with no notification, the duty is overdue.
  const overdue = computeIncidentReportingClock(incident, "cert_in", new Date("2026-07-09T07:00:00.000Z"));
  assert.equal(overdue.breached, true);
  assert.equal(overdue.status, "overdue");

  // A missing acknowledgement reference or authority blocks the notification.
  const blocked = recordIncidentNotification(incident, { authority: "cert_in", actor: "ciso" });
  assert.equal(blocked.summary.status, "blocked");

  // Reporting inside the window records the acknowledgement and stops the clock.
  const reported = recordIncidentNotification(
    incident,
    { authority: "cert_in", actor: "ciso", referenceNumber: "CERTIN-ACK-1", notifiedAt: "2026-07-09T04:00:00.000Z" },
    new Date("2026-07-09T04:00:00.000Z")
  );
  assert.equal(reported.summary.status, "ready");
  const certInClock = reported.incident.reporting.find((clock) => clock.authority === "cert_in");
  assert.equal(certInClock.notified, true);
  assert.equal(certInClock.status, "reported_in_time");
  assert.equal(certInClock.referenceNumber, "CERTIN-ACK-1");
  // The RBI duty is still outstanding, so the incident is not fully reported.
  assert.equal(reported.incident.fullyReported, false);
});

test("API tracks a security incident and its 6-hour reporting duties", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A, TENANT_B] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // An incident without a valid category/severity is rejected.
  const invalid = await postJson(`${base}/incidents`, { summary: "vague" });
  assert.equal(invalid.status, 422);

  // Report an incident detected 7 hours ago: past the CERT-In/RBI window.
  const detectedAt = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  const created = await postJson(`${base}/incidents`, {
    category: "unauthorized_access",
    severity: "critical",
    summary: "Suspicious admin login from an unrecognized ASN",
    detectedAt,
    reportableTo: ["cert_in", "rbi"],
    actor: "ciso"
  });
  assert.equal(created.status, 201);
  const incidentId = created.body.incident.incidentId;
  assert.equal(created.body.incident.reportingStatus, "reporting_overdue");

  // The overdue duties surface in a filtered list view.
  const overdueList = await (
    await apiFetch(`${base}/incidents?reportingStatus=reporting_overdue`)
  ).json();
  assert.equal(overdueList.count, 1);
  assert.equal(overdueList.incidents[0].incidentId, incidentId);

  // Record the CERT-In acknowledgement; only that authority's clock stops.
  const notified = await postJson(`${base}/incidents/${incidentId}/notifications`, {
    authority: "cert_in",
    referenceNumber: "CERTIN-ACK-9",
    actor: "ciso"
  });
  assert.equal(notified.status, 200);
  const certIn = notified.body.incident.reporting.find((clock) => clock.authority === "cert_in");
  assert.equal(certIn.notified, true);
  assert.equal(notified.body.incident.fullyReported, false);

  // Notifying an authority the incident is not reportable to is rejected.
  const wrongAuthority = await postJson(`${base}/incidents/${incidentId}/notifications`, {
    authority: "not_an_authority",
    referenceNumber: "X",
    actor: "ciso"
  });
  assert.equal(wrongAuthority.status, 422);

  // The incident and its reporting events are sealed into the audit spine.
  const events = await (await apiFetch(`${base}/audit/events`)).json();
  assert.ok(events.events.some((event) => event.type === "incident.reported"));
  assert.ok(events.events.some((event) => event.type === "incident.authority_notified"));

  // Incidents are tenant-scoped: tenant B sees none of tenant A's incidents.
  const bIncidents = await (await apiFetch(`${base}/incidents`, {}, TENANT_B.apiKey)).json();
  assert.equal(bIncidents.count, 0);
});

test("API runs a fraud case through the natural-justice classification gate", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A, TENANT_B] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  assert.equal((await postJson(`${base}/borrowers`, validBorrowerProfile())).status, 201);

  // A fraud case referencing an unregistered subject is rejected.
  const invalid = await postJson(`${base}/fraud-cases`, {
    category: "document_forgery",
    summary: "Forged salary slips",
    subjectBorrowerId: "bor_unknown",
    reportedBy: "fraud-analyst-1"
  });
  assert.equal(invalid.status, 422);

  const created = await postJson(`${base}/fraud-cases`, {
    category: "document_forgery",
    summary: "Forged salary slips",
    subjectBorrowerId: "bor_001",
    reportedBy: "fraud-analyst-1"
  });
  assert.equal(created.status, 201);
  const fraudCaseId = created.body.fraudCase.fraudCaseId;

  // A committee pack is available and reports classification not yet permitted.
  const earlyPack = await (await apiFetch(`${base}/fraud-cases/${fraudCaseId}/committee-pack`)).json();
  assert.equal(earlyPack.documentType, "fraud_committee_pack");
  assert.equal(earlyPack.classificationPermitted, false);
  assert.ok(earlyPack.checksumSha256);

  // Classifying as fraud without a show-cause notice is blocked.
  const premature = await postJson(`${base}/fraud-cases/${fraudCaseId}/classification`, {
    classification: "fraud",
    actor: "fraud-committee-1",
    reason: "Forgery confirmed"
  });
  assert.equal(premature.status, 422);

  // Issue the notice, record the borrower response, then classify independently.
  assert.equal(
    (await postJson(`${base}/fraud-cases/${fraudCaseId}/show-cause-notice`, {
      actor: "fraud-analyst-1",
      noticeReference: "SCN-9",
      deliveryRef: "post-ack-9"
    })).status,
    200
  );
  assert.equal(
    (await postJson(`${base}/fraud-cases/${fraudCaseId}/responses`, {
      actor: "fraud-analyst-1",
      summary: "Borrower could not explain the discrepancy"
    })).status,
    200
  );
  // Four-eyes: the investigator cannot classify.
  const sameActor = await postJson(`${base}/fraud-cases/${fraudCaseId}/classification`, {
    classification: "fraud",
    actor: "fraud-analyst-1",
    reason: "Rejecting representation"
  });
  assert.equal(sameActor.status, 422);

  const classified = await postJson(`${base}/fraud-cases/${fraudCaseId}/classification`, {
    classification: "fraud",
    actor: "fraud-committee-1",
    reason: "Representation rejected",
    committeeRef: "FC-2026-9"
  });
  assert.equal(classified.status, 200);
  assert.equal(classified.body.fraudCase.status, "classified_fraud");

  // Events sealed into the audit spine; fraud cases are tenant-isolated.
  const events = await (await apiFetch(`${base}/audit/events`)).json();
  assert.ok(events.events.some((event) => event.type === "fraud_case.classified"));
  const bCases = await (await apiFetch(`${base}/fraud-cases`, {}, TENANT_B.apiKey)).json();
  assert.equal(bCases.count, 0);
});

test("API holds a DPDP erasure request until retention clears, then redacts the borrower", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // Drive a full origination so the borrower has an active loan account.
  await approveAndDisburseApplication(base);

  const created = await postJson(`${base}/erasure-requests`, {
    borrowerId: "bor_001",
    requestedBy: "dpo-1",
    requestChannel: "email"
  });
  assert.equal(created.status, 201);
  const requestId = created.body.erasureRequest.erasureRequestId;
  // The active loan relationship makes the request ineligible.
  assert.equal(created.body.erasureRequest.eligibility.eligible, false);
  assert.ok(
    created.body.erasureRequest.eligibility.holds.some((hold) => hold.code === "active_loan_relationship")
  );

  // Fulfilment is blocked while the loan is active.
  const blocked = await postJson(`${base}/erasure-requests/${requestId}/fulfillment`, {
    actor: "dpo-1",
    confirmationRef: "ERASE-9"
  });
  assert.equal(blocked.status, 422);

  // Foreclose the loan so it closes; then age the record past retention via asOf.
  const account = (await (await apiFetch(`${base}/loan-accounts`)).json()).loanAccounts[0];
  const quote = await (await apiFetch(`${base}/loan-accounts/${account.loanAccountId}/foreclosure-quote`)).json();
  const foreclosed = await postJson(`${base}/loan-accounts/${account.loanAccountId}/foreclosure`, {
    amount: quote.payoffAmount,
    paymentRef: "pay-foreclose-1",
    actor: "ops-1"
  });
  assert.equal(foreclosed.status, 200);

  // Ten years on, the statutory retention window has cleared and erasure fulfils.
  const asOf = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const eligible = await (
    await apiFetch(`${base}/erasure-requests/${requestId}?asOf=${encodeURIComponent(asOf)}`)
  ).json();
  assert.equal(eligible.eligibility.eligible, true);

  const fulfilled = await postJson(`${base}/erasure-requests/${requestId}/fulfillment`, {
    actor: "dpo-1",
    confirmationRef: "ERASE-9",
    asOf
  });
  assert.equal(fulfilled.status, 200);
  assert.equal(fulfilled.body.erasureRequest.status, "fulfilled");

  // The borrower's personal data is redacted in place; the record skeleton stays.
  const borrower = await (await apiFetch(`${base}/borrowers/bor_001`)).json();
  assert.equal(borrower.status, "erased");
  assert.equal(borrower.fullName, null);
  assert.equal(borrower.contact.mobile, null);
  assert.ok(borrower.erasedAt);
});

test("API gates third-party data sharing on consent and logs statutory disclosures", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  assert.equal((await postJson(`${base}/borrowers`, validBorrowerProfile())).status, 201);

  // Consent-based sharing with no third-party-sharing consent is blocked.
  const noConsent = await postJson(`${base}/data-disclosures`, {
    borrowerId: "bor_001",
    recipientName: "PartnerCo LSP",
    recipientType: "lsp",
    purpose: "loan servicing",
    dataCategories: ["contact", "loan_account"],
    legalBasis: "consent",
    actor: "ops-1"
  });
  assert.equal(noConsent.status, 422);

  // Grant a third-party-sharing consent, then the disclosure is permitted.
  assert.equal(
    (await postJson(`${base}/borrowers/bor_001/consents`, {
      consentId: "consent_tps",
      borrowerId: "bor_001",
      purpose: "third_party_sharing",
      status: "granted",
      noticeVersion: "dpdp-notice-v1",
      acceptedAt: "2026-07-08T06:30:00.000Z"
    })).status,
    201
  );
  const shared = await postJson(`${base}/data-disclosures`, {
    borrowerId: "bor_001",
    recipientName: "PartnerCo LSP",
    recipientType: "lsp",
    purpose: "loan servicing",
    dataCategories: ["contact", "loan_account"],
    legalBasis: "consent",
    actor: "ops-1"
  });
  assert.equal(shared.status, 201);
  assert.equal(shared.body.disclosure.consentId, "consent_tps");

  // A statutory disclosure (CIC reporting) needs no consent but must cite the law.
  const noRef = await postJson(`${base}/data-disclosures`, {
    borrowerId: "bor_001",
    recipientName: "CIBIL",
    recipientType: "credit_information_company",
    purpose: "credit reporting",
    dataCategories: ["loan_account"],
    legalBasis: "legal_obligation",
    actor: "ops-1"
  });
  assert.equal(noRef.status, 422);
  const statutory = await postJson(`${base}/data-disclosures`, {
    borrowerId: "bor_001",
    recipientName: "CIBIL",
    recipientType: "credit_information_company",
    purpose: "credit reporting",
    dataCategories: ["loan_account"],
    legalBasis: "legal_obligation",
    legalReference: "CICRA-2005",
    actor: "ops-1"
  });
  assert.equal(statutory.status, 201);
  assert.equal(statutory.body.disclosure.consentId, null);

  // The record of processing lists both disclosures for the borrower.
  const ledger = await (await apiFetch(`${base}/data-disclosures?borrowerId=bor_001`)).json();
  assert.equal(ledger.count, 2);
  const events = await (await apiFetch(`${base}/audit/events`)).json();
  assert.ok(events.events.some((event) => event.type === "data_disclosure.recorded"));
});

test("platform can export a tenant and offboard it with evidenced deletion", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const adminKey = "platform-admin-secret";
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A], platformAdminKey: adminKey });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const adminHeaders = { "x-platform-admin-key": adminKey };

  // Drive a full origination under tenant A: seeds data-plane records + audit events.
  await approveAndDisburseApplication(base);

  // Export requires the platform admin key, not a tenant key.
  const forbidden = await rawFetch(`${base}/platform/tenants/${TENANT_A.tenantId}/export`);
  assert.equal(forbidden.status, 403);

  // The portability export reproduces the source-of-truth records + audit spine.
  const exportResponse = await rawFetch(`${base}/platform/tenants/${TENANT_A.tenantId}/export`, {
    headers: adminHeaders
  });
  assert.equal(exportResponse.status, 200);
  const exportPack = await exportResponse.json();
  assert.equal(exportPack.tenantId, TENANT_A.tenantId);
  assert.ok(Object.keys(exportPack.dataPlane.regulatedEntities).length > 0, "export carries data-plane records");
  assert.ok(Object.keys(exportPack.dataPlane.loanAccounts).length > 0, "export carries loan accounts");
  assert.equal(exportPack.integrity.chainValid, true);
  assert.ok(exportPack.integrity.eventCount > 0);
  assert.ok(exportPack.integrity.headHash && exportPack.integrity.contentDigest);
  assert.equal(exportPack.audit.integrity.valid, true);
  const capturedEventCount = exportPack.integrity.eventCount;
  const capturedHeadHash = exportPack.integrity.headHash;

  // Offboarding requires an actor and reason.
  const badOffboard = await rawFetch(`${base}/platform/tenants/${TENANT_A.tenantId}/offboarding`, {
    method: "POST",
    headers: { "content-type": "application/json", ...adminHeaders },
    body: JSON.stringify({ actor: "platform-ops" })
  });
  assert.equal(badOffboard.status, 422);

  // Evidenced deletion returns an attestation of what was erased.
  const offboard = await rawFetch(`${base}/platform/tenants/${TENANT_A.tenantId}/offboarding`, {
    method: "POST",
    headers: { "content-type": "application/json", ...adminHeaders },
    body: JSON.stringify({ actor: "platform-ops", reason: "contract terminated" })
  });
  assert.equal(offboard.status, 200);
  const offboardBody = await offboard.json();
  assert.equal(offboardBody.tenant.status, "offboarded");
  assert.equal(offboardBody.offboarding.actor, "platform-ops");
  assert.equal(offboardBody.offboarding.reason, "contract terminated");
  assert.equal(offboardBody.offboarding.erasedEventCount, capturedEventCount);
  assert.equal(offboardBody.offboarding.auditHeadHash, capturedHeadHash);
  assert.equal(offboardBody.offboarding.chainValidAtDeletion, true);

  // The tenant's api key no longer authenticates: the data plane is gone.
  const afterAuth = await apiFetch(`${base}/regulated-entities`, {}, TENANT_A.apiKey);
  assert.equal(afterAuth.status, 401);

  // Export is no longer available now that the data plane is purged.
  const afterExport = await rawFetch(`${base}/platform/tenants/${TENANT_A.tenantId}/export`, {
    headers: adminHeaders
  });
  assert.equal(afterExport.status, 404);

  // The control-plane record survives with the retained deletion attestation.
  const record = await (
    await rawFetch(`${base}/platform/tenants/${TENANT_A.tenantId}`, { headers: adminHeaders })
  ).json();
  assert.equal(record.status, "offboarded");
  assert.equal(record.offboarding.erasedEventCount, capturedEventCount);

  // Re-offboarding an already-offboarded tenant is rejected.
  const again = await rawFetch(`${base}/platform/tenants/${TENANT_A.tenantId}/offboarding`, {
    method: "POST",
    headers: { "content-type": "application/json", ...adminHeaders },
    body: JSON.stringify({ actor: "platform-ops", reason: "duplicate" })
  });
  assert.equal(again.status, 409);
});

test("platform break-glass access is scoped, audit-sealed, and tenant-visible", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const adminKey = "platform-admin-secret";
  const server = createLoanOsServer({
    dataDir,
    bootstrapTenants: [TENANT_A, TENANT_B],
    platformAdminKey: adminKey
  });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const adminHeaders = { "content-type": "application/json", "x-platform-admin-key": adminKey };

  // A random break-glass header does not authenticate.
  const noGrant = await rawFetch(`${base}/regulated-entities`, { headers: { "x-break-glass-key": "bgk_nope" } });
  assert.equal(noGrant.status, 401);

  // Minting requires a staffId and reason.
  const invalidMint = await rawFetch(`${base}/platform/tenants/${TENANT_A.tenantId}/break-glass`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ staffId: "sre-1" })
  });
  assert.equal(invalidMint.status, 422);

  // Platform admin mints a time-boxed grant scoped to tenant A.
  const mint = await rawFetch(`${base}/platform/tenants/${TENANT_A.tenantId}/break-glass`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ staffId: "sre-1", reason: "P1 incident recovery", ttlMinutes: 30 })
  });
  assert.equal(mint.status, 201);
  const mintBody = await mint.json();
  assert.ok(mintBody.credential.startsWith("bgk_"));
  assert.equal(mintBody.grant.tenantId, TENANT_A.tenantId);
  assert.equal(mintBody.grant.effectiveStatus, "active");
  assert.equal(mintBody.grant.credentialHash, undefined);
  const credential = mintBody.credential;
  const grantId = mintBody.grant.grantId;

  // The credential grants access to tenant A's data plane.
  const access = await rawFetch(`${base}/regulated-entities`, { headers: { "x-break-glass-key": credential } });
  assert.equal(access.status, 200);

  // The reach-in is sealed into tenant A's own audit chain, visible to the tenant.
  const events = await (await apiFetch(`${base}/audit/events`, {}, TENANT_A.apiKey)).json();
  assert.equal(events.chainValid, true);
  const breakGlassEvents = events.events.filter((event) => event.type === "platform.break_glass.access");
  assert.ok(breakGlassEvents.length >= 1);
  assert.equal(breakGlassEvents[0].staffId, "sre-1");
  assert.equal(breakGlassEvents[0].reason, "P1 incident recovery");
  assert.equal(breakGlassEvents[0].actorType, "platform_staff");

  // The tenant can see every grant scoped to it.
  const tenantView = await (await apiFetch(`${base}/break-glass-grants`, {}, TENANT_A.apiKey)).json();
  assert.equal(tenantView.grants.length, 1);
  assert.equal(tenantView.grants[0].grantId, grantId);

  // The grant is scoped to tenant A only: it cannot reach tenant B's data.
  const wrongTenant = await rawFetch(`${base}/break-glass-grants`, {
    headers: { "x-break-glass-key": credential }
  });
  // The credential authenticates as tenant A, so it only ever sees tenant A.
  const wrongTenantBody = await wrongTenant.json();
  assert.equal(wrongTenant.status, 200);
  assert.ok(wrongTenantBody.grants.every((grant) => grant.tenantId === TENANT_A.tenantId));

  // Revoking the grant immediately stops it authenticating.
  const revoke = await rawFetch(`${base}/platform/break-glass/${grantId}/revoke`, {
    method: "POST",
    headers: adminHeaders
  });
  assert.equal(revoke.status, 200);
  assert.equal((await revoke.json()).grant.effectiveStatus, "revoked");
  const afterRevoke = await rawFetch(`${base}/regulated-entities`, {
    headers: { "x-break-glass-key": credential }
  });
  assert.equal(afterRevoke.status, 401);
});

test("platform maintains a sub-processor register disclosed to every tenant", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const adminKey = "platform-admin-secret";
  const server = createLoanOsServer({
    dataDir,
    bootstrapTenants: [TENANT_A, TENANT_B],
    platformAdminKey: adminKey
  });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const adminHeaders = { "content-type": "application/json", "x-platform-admin-key": adminKey };

  // Writing the register requires the platform admin key, not a tenant key.
  const forbidden = await rawFetch(`${base}/platform/sub-processors`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subProcessorId: "sp_kyc" })
  });
  assert.equal(forbidden.status, 403);

  // A sub-processor without a data-processing agreement is rejected.
  const noDpa = await rawFetch(`${base}/platform/sub-processors`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      subProcessorId: "sp_kyc",
      name: "CKYC Gateway Pvt Ltd",
      purpose: "KYC verification",
      dataResidencyCountry: "IN",
      dpaInPlace: false
    })
  });
  assert.equal(noDpa.status, 422);
  const noDpaBody = await noDpa.json();
  assert.ok(noDpaBody.findings.some((finding) => finding.code === "sub_processor_dpa_required"));

  // A compliant sub-processor registers and reports its residency posture.
  const created = await rawFetch(`${base}/platform/sub-processors`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      subProcessorId: "sp_kyc",
      name: "CKYC Gateway Pvt Ltd",
      purpose: "KYC verification",
      dataCategories: ["identity", "contact"],
      dataResidencyCountry: "IN",
      contractReference: "DPA-2026-001",
      dpaInPlace: true
    })
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.subProcessor.subProcessorId, "sp_kyc");
  assert.equal(createdBody.subProcessor.crossBorder, false);

  // A cross-border sub-processor is disclosed as such.
  const crossBorder = await rawFetch(`${base}/platform/sub-processors`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      subProcessorId: "sp_notify",
      name: "Global Notify Inc",
      purpose: "Transactional email delivery",
      dataResidencyCountry: "US",
      contractReference: "DPA-2026-002",
      dpaInPlace: true
    })
  });
  assert.equal(crossBorder.status, 201);
  assert.equal((await crossBorder.json()).subProcessor.crossBorder, true);

  // Every authenticated tenant sees the same standing disclosure.
  for (const tenant of [TENANT_A, TENANT_B]) {
    const disclosure = await apiFetch(`${base}/sub-processors`, {}, tenant.apiKey);
    assert.equal(disclosure.status, 200);
    const body = await disclosure.json();
    assert.equal(body.subProcessors.length, 2);
    const notify = body.subProcessors.find((sp) => sp.subProcessorId === "sp_notify");
    assert.equal(notify.crossBorder, true);
  }

  // The disclosure requires a tenant context.
  assert.equal((await rawFetch(`${base}/sub-processors`)).status, 401);
});

test("audit events carry a uniform actor/actorType/dataClass provenance envelope", () => {
  // Classification is by event type.
  assert.equal(classifyAuditDataClass("borrower_profile.upserted"), "personal_data");
  assert.equal(classifyAuditDataClass("complaint.received"), "personal_data");
  assert.equal(classifyAuditDataClass("loan.disbursement.recorded"), "financial");
  assert.equal(classifyAuditDataClass("model.transitioned"), "model_governance");
  assert.equal(classifyAuditDataClass("platform.break_glass.access"), "platform");
  assert.equal(classifyAuditDataClass("regulated_entity.upserted"), "operational");

  // Stamping fills the envelope but never overrides explicit values.
  const stamped = stampAuditEvents(
    [
      { type: "loan.application.created" },
      { type: "platform.break_glass.access", actor: "platform:sre-1", actorType: "platform_staff", dataClass: "tenant_scoped" }
    ],
    { actor: "tnt_x", actorType: "tenant" }
  );
  assert.equal(stamped[0].actor, "tnt_x");
  assert.equal(stamped[0].actorType, "tenant");
  assert.equal(stamped[0].dataClass, "financial");
  assert.equal(stamped[1].actor, "platform:sre-1");
  assert.equal(stamped[1].dataClass, "tenant_scoped");
});

test("API stamps every sealed audit event with tenant provenance", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  await approveAndDisburseApplication(base);

  const events = await (await apiFetch(`${base}/audit/events`)).json();
  assert.equal(events.chainValid, true);
  // Every event carries the full envelope, attributed to the tenant.
  assert.ok(
    events.events.every(
      (event) => event.actorType && event.dataClass && Object.hasOwn(event, "actor")
    )
  );
  assert.ok(events.events.every((event) => event.actorType === "tenant"));
  // A borrower event is personal data; a disbursement is financial.
  const borrowerEvent = events.events.find((event) => event.type === "borrower_profile.upserted");
  assert.equal(borrowerEvent.dataClass, "personal_data");
  const disbursement = events.events.find((event) => event.type === "loan.disbursement.recorded");
  assert.equal(disbursement.dataClass, "financial");
});

function eligibilityApplication(overrides = {}) {
  const base = {
    borrower: {
      borrowerId: "bor_001",
      residencyCountry: "IN",
      primaryAddressCountry: "IN",
      dateOfBirth: "1990-01-01"
    },
    economicProfile: {
      occupation: "salaried",
      monthlyIncome: 75000
    },
    product: {
      productCode: "PL_IN_DIGITAL",
      currency: "INR",
      requestedAmount: 125000,
      requestedTenorMonths: 12,
      annualInterestRateBps: 1800,
      aprBps: 2100,
      minAmount: 10000,
      maxAmount: 500000,
      minTenorMonths: 3,
      maxTenorMonths: 36,
      eligibility: {
        minAgeYears: 21,
        maxAgeYears: 65,
        minMonthlyIncome: 25000
      }
    }
  };
  return {
    ...base,
    ...overrides,
    borrower: { ...base.borrower, ...(overrides.borrower ?? {}) },
    economicProfile: { ...base.economicProfile, ...(overrides.economicProfile ?? {}) },
    product: { ...base.product, ...(overrides.product ?? {}) }
  };
}

function validApplication() {
  return {
    regulatedEntityId: "re_example_nbfc",
    tenant: {
      regulatedEntityName: "Example India NBFC Ltd",
      regulatedEntityType: "nbfc",
      rbiRegistrationNumber: "B-00.00000",
      grievanceOfficer: {
        name: "Nodal Officer",
        email: "grievance@example.in"
      },
      privacyPolicyUrl: "https://example.in/privacy"
    },
    borrower: {
      borrowerId: "bor_001",
      residencyCountry: "IN",
      primaryAddressCountry: "IN",
      dateOfBirth: "1990-01-01"
    },
    consent: {
      noticeVersion: "dpdp-notice-v1",
      dataProcessingAcceptedAt: "2026-07-08T06:30:00.000Z"
    },
    kyc: {
      status: "verified",
      riskCategory: "low",
      aadhaar: {
        biometricStored: false,
        otpStored: false,
        pidStored: false
      },
      vCip: {
        used: true,
        storageCountry: "IN"
      }
    },
    economicProfile: {
      occupation: "salaried",
      monthlyIncome: 75000
    },
    product: {
      productCode: "PL_IN_DIGITAL",
      requestedAmount: 100000,
      currency: "INR",
      coolingOffDays: 1
    },
    dataResidency: {
      primaryStorageCountry: "IN",
      paymentDataStorageCountry: "IN",
      processedOutsideIndia: false
    },
    disbursement: {
      destinationAccount: {
        country: "IN",
        ifsc: "HDFC0000001",
        ownerRole: "borrower"
      }
    },
    repayment: {
      recoveryMechanism: "NACH debit to RE account",
      collectionAccount: {
        country: "IN",
        ifsc: "HDFC0000002",
        ownerRole: "regulated_entity"
      }
    }
  };
}

function validBorrowerProfile() {
  return {
    borrowerId: "bor_001",
    borrowerType: "individual",
    status: "active",
    fullName: "Asha Sharma",
    dateOfBirth: "1990-01-01",
    residencyCountry: "IN",
    primaryAddressCountry: "IN",
    primaryAddress: "Bengaluru, Karnataka",
    contact: {
      mobile: "+919999999999",
      email: "asha@example.in"
    },
    economicProfile: {
      occupation: "salaried",
      monthlyIncome: 75000,
      employerName: "Example Services Pvt Ltd",
      incomeEvidenceRef: "bank_statement_001"
    }
  };
}

function validConsentRecord() {
  return {
    consentId: "consent_data_processing",
    borrowerId: "bor_001",
    purpose: "data_processing",
    status: "granted",
    noticeVersion: "dpdp-notice-v1",
    acceptedAt: "2026-07-08T06:30:00.000Z",
    channel: "web",
    evidenceRef: "consent_click_001"
  };
}

function validKycRecord() {
  return {
    kycRecordId: "kyc_verified_001",
    borrowerId: "bor_001",
    status: "verified",
    method: "v_cip",
    riskCategory: "low",
    verifiedAt: "2026-07-08T06:45:00.000Z",
    expiresAt: "2027-07-08T06:45:00.000Z",
    ckycRef: "ckyc_001",
    aadhaar: {
      biometricStored: false,
      otpStored: false,
      pidStored: false
    },
    vCip: {
      used: true,
      storageCountry: "IN",
      recordingRef: "vcip_recording_001",
      activityLogRef: "vcip_log_001"
    }
  };
}

function validRegulatedEntity() {
  return {
    regulatedEntityId: "re_example_nbfc",
    regulatedEntityName: "Example India NBFC Ltd",
    regulatedEntityType: "nbfc",
    rbiRegistrationNumber: "B-00.00000",
    country: "IN",
    status: "active",
    websiteUrl: "https://example.in",
    privacyPolicyUrl: "https://example.in/privacy",
    grievanceOfficer: {
      name: "Nodal Officer",
      email: "grievance@example.in",
      phone: "+91-9999999999"
    },
    dataResidency: {
      primaryStorageCountry: "IN",
      paymentDataStorageCountry: "IN",
      processedOutsideIndia: false
    },
    boardPolicyRefs: {
      digitalLendingPolicyRef: "board_digital_lending_policy_v1",
      kycPolicyRef: "board_kyc_policy_v1",
      penalChargesPolicyRef: "board_penal_charges_policy_v1",
      outsourcingPolicyRef: "board_outsourcing_policy_v1",
      grievancePolicyRef: "board_grievance_policy_v1"
    }
  };
}

function validLendingServiceProvider(overrides = {}) {
  const base = {
    lspId: "lsp_example_001",
    regulatedEntityId: "re_example_nbfc",
    legalName: "Example LSP Services Pvt Ltd",
    tradeName: "Example LSP",
    country: "IN",
    status: "active",
    services: ["customer_acquisition", "servicing", "recovery", "dla_operations"],
    interfaceWithBorrower: true,
    websiteUrl: "https://partner.example.in",
    privacyPolicyUrl: "https://partner.example.in/privacy",
    publicDisclosureUrl: "https://example.in/partners/example-lsp",
    grievanceOfficer: {
      name: "Partner Nodal Officer",
      email: "grievance@partner.example.in",
      phone: "+91-80-40000000",
      mobile: "+919888888888"
    },
    agreement: {
      agreementRef: "lsp_agreement_001",
      effectiveFrom: "2026-07-08",
      rolesAndObligationsRef: "lsp_roles_obligations_001",
      rightsAndObligationsRef: "lsp_rights_obligations_001",
      scopeOfWorkRef: "lsp_scope_001"
    },
    dueDiligence: {
      completedAt: "2026-07-07T10:00:00.000Z",
      approvedBy: "cco-1",
      approvalRef: "lsp_due_diligence_approval_001",
      technicalCapabilityReviewRef: "tech_review_001",
      dataPrivacyReviewRef: "privacy_review_001",
      fairConductReviewRef: "conduct_review_001",
      pastConductReviewRef: "past_conduct_review_001",
      regulatoryComplianceReviewRef: "reg_compliance_review_001"
    },
    periodicReview: {
      lastReviewedAt: "2026-07-07T12:00:00.000Z",
      nextReviewDueAt: "2026-10-07T12:00:00.000Z",
      reviewedBy: "cco-1",
      reviewRef: "lsp_periodic_review_001",
      outcome: "satisfactory"
    },
    monitoring: {
      portfolioMonitoringPolicyRef: "portfolio_monitoring_policy_001",
      reportingCadence: "monthly",
      metrics: ["approval_rate", "complaint_rate", "collection_contact_exceptions"]
    },
    dataControls: {
      primaryStorageCountry: "IN",
      processedOutsideIndia: false,
      storesOnlyMinimalBorrowerData: true,
      prohibitedBorrowerDataStored: false
    },
    feeControls: {
      paidByRegulatedEntity: true,
      borrowerChargedSeparately: false
    },
    recoveryControls: {
      recoveryAgentGuidanceRef: "recovery_agent_guidance_001"
    }
  };
  return merge(base, overrides);
}

function validDigitalLendingApp(overrides = {}) {
  const base = {
    digitalLendingAppId: "dla_example_web",
    regulatedEntityId: "re_example_nbfc",
    name: "Example Loan Web",
    ownerType: "self_owned",
    status: "active",
    availability: [
      {
        channel: "website",
        availableOn: "Website",
        link: "https://app.example.in"
      }
    ],
    grievanceOfficer: {
      name: "Nodal Officer",
      email: "grievance@example.in",
      telephone: "+91-80-40000000",
      mobile: "+919999999999"
    },
    publicDisclosureUrl: "https://example.in/digital-lending-apps",
    dataCollection: {
      consentAuditTrail: true,
      prohibitedMobileResourcesAccessed: false,
      primaryStorageCountry: "IN",
      processedOutsideIndia: false
    },
    complianceAttestation: {
      certifiedBy: "cco-1",
      certifiedAt: "2026-07-08T08:00:00.000Z",
      certifierRole: "chief_compliance_officer",
      boardDesignationRef: "board_cco_designation_v1",
      reWebsiteLinked: true,
      lspGrievanceOfficerDisplayed: true,
      dataCollectionAndStorageCompliant: true,
      disclosedOnReWebsite: true
    }
  };
  return merge(base, overrides);
}

function validProductPolicy() {
  return {
    productId: "prod_personal_loan",
    regulatedEntityId: "re_example_nbfc",
    productCode: "PL_IN_DIGITAL",
    productName: "Digital Personal Loan",
    productType: "personal_loan",
    status: "active",
    currency: "INR",
    minAmount: 10000,
    maxAmount: 500000,
    minTenorMonths: 3,
    maxTenorMonths: 36,
    annualInterestRateBps: 1800,
    aprBps: 2100,
    repaymentFrequency: "monthly",
    coolingOffDays: 1,
    recoveryMechanism: "NACH debit to RE account",
    charges: [
      {
        name: "Processing fee",
        reason: "One-time processing charge disclosed upfront",
        amount: 1000,
        type: "fixed"
      }
    ],
    penalCharges: [
      {
        name: "Late payment charge",
        reason: "Repayment default",
        amount: 500,
        type: "penal_charge",
        capitalizes: false
      }
    ],
    eligibility: {
      minAgeYears: 21,
      maxAgeYears: 65,
      minMonthlyIncome: 25000,
      allowedResidencyCountry: "IN"
    },
    policyRefs: {
      boardApprovalRef: "board_product_approval_v1",
      pricingPolicyRef: "pricing_policy_v1",
      penalChargesPolicyRef: "board_penal_charges_policy_v1"
    }
  };
}

function validRecoveryAgent(overrides = {}) {
  const base = {
    recoveryAgentId: "agent_001",
    regulatedEntityId: "re_example_nbfc",
    name: "Ravi Collector",
    agencyName: "Example Recovery Services",
    dueDiligence: {
      policeVerificationRef: "police_verification_001",
      verifiedAt: "2026-01-01T00:00:00.000Z",
      verifiedBy: "compliance-analyst-1"
    },
    training: {
      certificationRef: "iibf_cert_001",
      certifiedAt: "2026-01-05T00:00:00.000Z"
    },
    codeOfConduct: {
      acknowledgmentRef: "coc_ack_001",
      acknowledgedAt: "2026-01-05T00:00:00.000Z"
    },
    authorization: {
      letterRef: "auth_letter_001",
      idCardRef: "id_card_001"
    }
  };
  return merge(base, overrides);
}

function merge(base, patch) {
  const output = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      output[key] = merge(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function postJson(url, payload, apiKey) {
  const response = await apiFetch(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    apiKey
  );
  const body = await response.json();
  return {
    status: response.status,
    body
  };
}

async function createRegistryBackedApplication(base, overrides = {}) {
  await seedOperationalActors(base);
  assert.equal((await postJson(`${base}/regulated-entities`, validRegulatedEntity())).status, 201);
  assert.equal((await postJson(`${base}/products`, validProductPolicy())).status, 201);
  assert.equal((await postJson(`${base}/borrowers`, validBorrowerProfile())).status, 201);
  assert.equal((await postJson(`${base}/borrowers/bor_001/consents`, validConsentRecord())).status, 201);
  assert.equal((await postJson(`${base}/borrowers/bor_001/kyc-records`, validKycRecord())).status, 201);

  const response = await postJson(`${base}/loans/applications`, {
    regulatedEntityId: "re_example_nbfc",
    productId: "prod_personal_loan",
    borrowerId: "bor_001",
    requestedAmount: overrides.requestedAmount ?? 125000,
    requestedTenorMonths: overrides.requestedTenorMonths ?? 12,
    disbursement: validApplication().disbursement,
    repayment: validApplication().repayment
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.status, "ready_for_kfs");
  return response.body;
}

async function seedOperationalActors(base) {
  for (const actor of operationalActors()) {
    const response = await postJson(`${base}/staff/actors`, actor);
    assert.equal(response.status, 201);
  }
}

function operationalActors() {
  return [
    {
      actorId: "credit-maker-1",
      displayName: "Credit Maker",
      roles: ["credit_officer"],
      queues: ["credit_ops"]
    },
    {
      actorId: "credit-checker-1",
      displayName: "Credit Checker",
      roles: ["credit_checker"],
      queues: ["credit_checker"]
    },
    {
      actorId: "credit-lead-1",
      displayName: "Credit Lead",
      roles: ["workflow_admin"],
      queues: ["*"],
      canAssignQueues: ["credit_checker"]
    },
    {
      actorId: "credit-reviewer-1",
      displayName: "Credit Human Reviewer",
      roles: ["human_reviewer"],
      queues: ["model_risk"]
    },
    {
      actorId: "loan-officer-1",
      displayName: "Loan Officer",
      roles: ["loan_officer"],
      queues: ["loan_ops"]
    },
    {
      actorId: "collections-manager-1",
      displayName: "Collections Manager",
      roles: ["collections_manager"],
      queues: ["collections_ops"]
    },
    {
      actorId: "collections-lead-1",
      displayName: "Collections Lead",
      roles: ["workflow_admin"],
      queues: ["*"],
      canAssignQueues: ["collections_ops"]
    },
    {
      actorId: "portfolio-risk-1",
      displayName: "Portfolio Risk Manager",
      roles: ["portfolio_risk_manager"],
      queues: ["risk_ops"]
    },
    {
      actorId: "grievance-officer-1",
      displayName: "Grievance Officer",
      roles: ["grievance_officer"],
      queues: ["grievance_ops"]
    },
    {
      actorId: "grievance-lead-1",
      displayName: "Grievance Lead",
      roles: ["workflow_admin"],
      queues: ["*"],
      canAssignQueues: ["grievance_ops"]
    }
  ];
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function approveAndDisburseApplication(base) {
  const application = await createRegistryBackedApplication(base);
  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/kfs`, {
        acceptance: {
          acceptedAt: "2026-07-08T07:00:00.000Z",
          deliveryChannel: "email",
          deliveryRef: "email_msg_123"
        }
      })
    ).status,
    201
  );
  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/decision`, {
        status: "approved",
        proposedBy: "credit-maker-1",
        reason: "Policy checks passed"
      })
    ).status,
    202
  );
  assert.equal(
    (
      await postJson(`${base}/loans/applications/${application.applicationId}/approvals`, {
        outcome: "approved",
        approvedBy: "credit-checker-1",
        approvalRef: "approval_002"
      })
    ).status,
    200
  );
  await generateAndDeliverDocumentPacket(base, application.applicationId);
  const disbursement = await postJson(`${base}/loans/applications/${application.applicationId}/disbursement`, {
    destinationAccount: validApplication().disbursement.destinationAccount
  });
  assert.equal(disbursement.status, 200);
  assert.equal(disbursement.body.status, "disbursed");
  return disbursement.body;
}

async function generateAndDeliverDocumentPacket(base, applicationId) {
  const generated = await postJson(`${base}/loans/applications/${applicationId}/document-packet`, {
    actor: "loan-officer-1"
  });
  assert.equal(generated.status, 201);
  const delivered = await postJson(`${base}/loans/applications/${applicationId}/document-packet/delivery`, {
    actor: "loan-officer-1",
    deliveryChannel: "email",
    deliveryRef: `doc_delivery_${applicationId}`,
    deliveredTo: "asha@example.in"
  });
  assert.equal(delivered.status, 200);
  return delivered.body;
}

test("validateMarketplaceNeutrality detects dark patterns and ensures partner completeness", () => {
  const activePartnerLenderIds = ["re_partner_1", "re_partner_2"];

  // Valid, compliant request
  const validRequest = {
    lspId: "lsp_example",
    dlaId: "dla_example",
    rankingCriteria: "lowest_apr",
    disclosureRef: "disclosure_v1",
    partnerLendersDisclosureRef: "partners_v1",
    darkPatternCheck: {
      preSelectedLender: false,
      preSelectedAddOns: false,
      deceptiveUrgency: false,
      commercialBias: false,
      obfuscatedCost: false
    },
    offers: [
      { regulatedEntityId: "re_partner_1", aprBps: 1200, status: "offered" },
      { regulatedEntityId: "re_partner_2", status: "unmatched" }
    ]
  };

  const check1 = validateMarketplaceNeutrality(validRequest, activePartnerLenderIds);
  assert.equal(check1.summary.status, "ready");

  // Rejects pre-selected lender (dark pattern)
  const badRequest1 = {
    ...validRequest,
    darkPatternCheck: {
      ...validRequest.darkPatternCheck,
      preSelectedLender: true
    }
  };
  const check2 = validateMarketplaceNeutrality(badRequest1, activePartnerLenderIds);
  assert.equal(check2.summary.status, "blocked");
  assert(check2.findings.some(f => f.path === "darkPatternCheck.preSelectedLender"));

  // Rejects missing partner lender
  const badRequest2 = {
    ...validRequest,
    offers: [
      { regulatedEntityId: "re_partner_1", aprBps: 1200, status: "offered" }
    ]
  };
  const check3 = validateMarketplaceNeutrality(badRequest2, activePartnerLenderIds);
  assert.equal(check3.summary.status, "blocked");
  assert(check3.findings.some(f => f.controlId === "CCPA-DARK-PATTERNS" && f.message.includes("must be represented")));

  // Rejects missing disclosure
  const badRequest3 = {
    ...validRequest,
    disclosureRef: null
  };
  const check4 = validateMarketplaceNeutrality(badRequest3, activePartnerLenderIds);
  assert.equal(check4.summary.status, "blocked");
  assert(check4.findings.some(f => f.path === "disclosureRef"));
});

test("rankMarketplaceOffers sorts offers neutrally based on objective criteria", () => {
  const offers = [
    { regulatedEntityId: "re_b", regulatedEntityName: "Lender B", aprBps: 1400, processingFee: 500, tenorMonths: 12 },
    { regulatedEntityId: "re_a", regulatedEntityName: "Lender A", aprBps: 1200, processingFee: 1000, tenorMonths: 24 },
    { regulatedEntityId: "re_c", regulatedEntityName: "Lender C", status: "unmatched" }
  ];

  // lowest_apr sorting: Lender A (1200), Lender B (1400), Lender C (unmatched stays at bottom)
  const sortedApr = rankMarketplaceOffers(offers, "lowest_apr");
  assert.equal(sortedApr[0].regulatedEntityId, "re_a");
  assert.equal(sortedApr[1].regulatedEntityId, "re_b");
  assert.equal(sortedApr[2].regulatedEntityId, "re_c");

  // highest_tenor sorting: Lender A (24), Lender B (12), Lender C (unmatched stays at bottom)
  const sortedTenor = rankMarketplaceOffers(offers, "highest_tenor");
  assert.equal(sortedTenor[0].regulatedEntityId, "re_a");
  assert.equal(sortedTenor[1].regulatedEntityId, "re_b");

  // lowest_processing_fee sorting: Lender B (500), Lender A (1000)
  const sortedFee = rankMarketplaceOffers(offers, "lowest_processing_fee");
  assert.equal(sortedFee[0].regulatedEntityId, "re_b");
  assert.equal(sortedFee[1].regulatedEntityId, "re_a");
});

test("API marketplace offers routes manage multi-lender offer evaluations and block dark patterns", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "loanos-test-marketplace-"));
  const server = createLoanOsServer({ dataDir: dir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // Register active Regulated Entity
    const rePayload = {
      ...validRegulatedEntity(),
      regulatedEntityId: "re_test_lender"
    };
    const reRes = await postJson(`${base}/regulated-entities`, rePayload);
    assert.equal(reRes.status, 201);

    // Register active LSP partner
    const lspPayload = validLendingServiceProvider({
      lspId: "lsp_test_marketplace",
      regulatedEntityId: "re_test_lender",
      status: "active"
    });
    const lspRes = await postJson(`${base}/lending-service-providers`, lspPayload);
    if (lspRes.status !== 201) {
      console.log("DEBUG: POST /lending-service-providers failed with body:", JSON.stringify(lspRes.body, null, 2));
    }
    assert.equal(lspRes.status, 201);

    // 1. Submit valid multi-lender offers
    const evaluationRequest = {
      lspId: "lsp_test_marketplace",
      dlaId: "dla_test_mkt",
      rankingCriteria: "lowest_apr",
      disclosureRef: "ranking_disclosure_v1",
      partnerLendersDisclosureRef: "partner_disclosure_v1",
      darkPatternCheck: {
        preSelectedLender: false,
        preSelectedAddOns: false,
        deceptiveUrgency: false,
        commercialBias: false,
        obfuscatedCost: false
      },
      offers: [
        { regulatedEntityId: "re_test_lender", regulatedEntityName: "Test Lender", aprBps: 1100, status: "offered" }
      ]
    };

    const res = await postJson(`${base}/loans/marketplace-offers`, evaluationRequest);
    if (res.status !== 201) {
      console.log("DEBUG: POST /loans/marketplace-offers failed with body:", JSON.stringify(res.body, null, 2));
    }
    assert.equal(res.status, 201);
    assert.equal(res.body.compliance.summary.status, "ready");
    assert.ok(res.body.marketplaceOfferId);

    // Retrieve by ID
    const getRes = await apiFetch(`${base}/loans/marketplace-offers/${res.body.marketplaceOfferId}`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.lspId, "lsp_test_marketplace");

    // 2. Submit invalid offers with pre-selected lender (dark pattern)
    const badRequest = {
      ...evaluationRequest,
      darkPatternCheck: {
        ...evaluationRequest.darkPatternCheck,
        preSelectedLender: true
      }
    };
    const badRes = await postJson(`${base}/loans/marketplace-offers`, badRequest);
    assert.equal(badRes.status, 422);
    assert.equal(badRes.body.compliance.summary.status, "blocked");
    assert(badRes.body.compliance.findings.some(f => f.path === "darkPatternCheck.preSelectedLender"));

  } finally {
    await close(server);
    await rm(dir, { recursive: true, force: true });
  }
});

test("KFS grounding validation checks prevent undisclosed or exceeding charges", () => {
  const product = validProductPolicy(); // has Processing fee (1000) and Late payment charge (500)
  
  // Compliant KFS
  const validKfs = {
    currency: "INR",
    aprBps: 2100,
    principalAmount: 125000,
    tenorMonths: 12,
    coolingOffDays: 1,
    grievanceOfficer: { name: "Grievance Officer", email: "grievance@bank.com" },
    recoveryMechanism: "NACH debit to RE account",
    charges: [{ name: "Processing fee", reason: "One-time processing charge disclosed upfront", amount: 1000, type: "fixed" }],
    penalCharges: [{ name: "Late payment charge", reason: "Repayment default", amount: 500, type: "penal_charge", capitalizes: false }],
    prepaymentPolicy: { allowed: true, chargeBps: 0, lockInMonths: 0 },
    foreclosurePolicy: { allowed: true, chargeBps: 0, lockInMonths: 0 },
    acceptedAt: "2026-07-08T07:00:00.000Z",
    deliveryRef: "delivery_ref_1"
  };
  
  const appValid = { kfs: validKfs, product };
  const checkValid = validateKfsBeforeDecision(appValid);
  assert.equal(checkValid.summary.status, "ready");

  // Undisclosed charge in KFS
  const badKfs1 = {
    ...validKfs,
    charges: [...validKfs.charges, { name: "Ad-hoc fee", reason: "Mystery fee", amount: 200, type: "fixed" }]
  };
  const appBad1 = { kfs: badKfs1, product };
  const checkBad1 = validateKfsBeforeDecision(appBad1);
  assert.equal(checkBad1.summary.status, "blocked");
  assert(checkBad1.findings.some(f => f.message.includes("is not disclosed in the product policy")));

  // KFS charge exceeding product policy limit
  const badKfs2 = {
    ...validKfs,
    charges: [{ name: "Processing fee", reason: "One-time processing charge disclosed upfront", amount: 1500, type: "fixed" }]
  };
  const appBad2 = { kfs: badKfs2, product };
  const checkBad2 = validateKfsBeforeDecision(appBad2);
  assert.equal(checkBad2.summary.status, "blocked");
  assert(checkBad2.findings.some(f => f.message.includes("exceeds the product policy limit")));

  // KFS prepayment fee rate exceeding product policy limit
  const badKfs3 = {
    ...validKfs,
    prepaymentPolicy: { allowed: true, chargeBps: 300, lockInMonths: 0 }
  };
  const productWithPrepayLimit = {
    ...product,
    prepaymentPolicy: { allowed: true, chargeBps: 200, lockInMonths: 0 }
  };
  const appBad3 = { kfs: badKfs3, product: productWithPrepayLimit };
  const checkBad3 = validateKfsBeforeDecision(appBad3);
  assert.equal(checkBad3.summary.status, "blocked");
  assert(checkBad3.findings.some(f => f.message.includes("KFS prepayment fee rate") && f.message.includes("exceeds the product policy limit")));
});

test("API controls undisclosed charge caps and enforces computed ceilings", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-charges-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  
  // Seed a fixed-rate product that allows foreclosure charges (e.g. 2% / 200 bps)
  const seedProduct = {
    ...validProductPolicy(),
    interestRateType: "fixed",
    prepaymentPolicy: { allowed: true, chargeBps: 200, lockInMonths: 0 },
    foreclosurePolicy: { allowed: true, chargeBps: 200, lockInMonths: 0 },
    charges: [
      { name: "Processing fee", reason: "One-time processing charge disclosed upfront", amount: 1000, type: "fixed" },
      { name: "Foreclosure fee", reason: "Early foreclosure fee", amount: 3000, type: "fixed" },
      { name: "Prepayment fee", reason: "Part prepayment fee", amount: 2500, type: "fixed" }
    ]
  };

  // Setup the application with custom product overrides
  await seedOperationalActors(base);
  assert.equal((await postJson(`${base}/regulated-entities`, validRegulatedEntity())).status, 201);
  assert.equal((await postJson(`${base}/products`, seedProduct)).status, 201);
  assert.equal((await postJson(`${base}/borrowers`, validBorrowerProfile())).status, 201);
  assert.equal((await postJson(`${base}/borrowers/bor_001/consents`, validConsentRecord())).status, 201);
  assert.equal((await postJson(`${base}/borrowers/bor_001/kyc-records`, validKycRecord())).status, 201);

  const response = await postJson(`${base}/loans/applications`, {
    regulatedEntityId: "re_example_nbfc",
    productId: "prod_personal_loan",
    borrowerId: "bor_001",
    requestedAmount: 100000,
    requestedTenorMonths: 12,
    disbursement: validApplication().disbursement,
    repayment: validApplication().repayment
  });
  assert.equal(response.status, 201);

  // Generate KFS with seeded charges
  const kfsRes = await postJson(`${base}/loans/applications/${response.body.applicationId}/kfs`, {
    acceptance: {
      acceptedAt: "2026-07-08T07:00:00.000Z",
      deliveryChannel: "email",
      deliveryRef: "email_msg_999"
    }
  });
  assert.equal(kfsRes.status, 201);

  // Approve and Checker approve
  await postJson(`${base}/loans/applications/${response.body.applicationId}/decision`, {
    status: "approved",
    proposedBy: "credit-maker-1",
    reason: "Seeded test PL"
  });
  await postJson(`${base}/loans/applications/${response.body.applicationId}/approvals`, {
    outcome: "approved",
    approvedBy: "credit-checker-1",
    approvalRef: "checker_approval_999"
  });

  // Document packet and disburse
  await generateAndDeliverDocumentPacket(base, response.body.applicationId);
  const disburseRes = await postJson(`${base}/loans/applications/${response.body.applicationId}/disbursement`, {
    destinationAccount: validApplication().disbursement.destinationAccount
  });
  assert.equal(disburseRes.status, 200);

  const accountId = disburseRes.body.loanAccountId;

  // 1. Post a charge exceeding the KFS amount cap
  const badCharge = await postJson(`${base}/loan-accounts/${accountId}/charges`, {
    name: "Processing fee",
    reason: "Upfront processing",
    amount: 1500 // Disclosed limit is 1000
  });
  assert.equal(badCharge.status, 422);
  assert(badCharge.body.findings.some(f => f.message.includes("exceeds the disclosed KFS limit")));

  // 2. Foreclosure quote with charge exceeding the KFS disclosed limit
  const badForeclosureQuote = await apiFetch(`${base}/loan-accounts/${accountId}/foreclosure-quote?foreclosureChargeName=Foreclosure fee&foreclosureChargeAmount=4000`);
  assert.equal(badForeclosureQuote.status, 422);
  const badFqBody = await badForeclosureQuote.json();
  assert(badFqBody.findings.some(f => f.message.includes("exceeds the disclosed KFS limit")));

  // 3. Foreclosure quote with charge exceeding computed policy BPS ceiling
  // principalOutstanding is 100000. 2% of 100000 is 2000. Foreclosure charge of 2500 exceeds policy ceiling.
  const badForeclosureCeiling = await apiFetch(`${base}/loan-accounts/${accountId}/foreclosure-quote?foreclosureChargeName=Foreclosure fee&foreclosureChargeAmount=2500`);
  assert.equal(badForeclosureCeiling.status, 422);
  const badFcBody = await badForeclosureCeiling.json();
  assert(badFcBody.findings.some(f => f.message.includes("exceeds the product policy ceiling")));

  // 4. Prepayment with charge exceeding KFS disclosed limit
  const badPrepayLimit = await postJson(`${base}/loan-accounts/${accountId}/prepayments`, {
    amount: 20000,
    paymentRef: "pay_prepay_bad_limit",
    prepaymentChargeName: "Prepayment fee",
    prepaymentChargeAmount: 3000 // Disclosed limit is 2500
  });
  assert.equal(badPrepayLimit.status, 422);
  assert(badPrepayLimit.body.findings.some(f => f.message.includes("exceeds the disclosed KFS limit")));

  // 5. Prepayment with charge exceeding computed policy BPS ceiling
  // principalPrepaid is 20000. 2% of 20000 is 400. Prepayment charge of 500 exceeds 2% ceiling.
  const badPrepayCeiling = await postJson(`${base}/loan-accounts/${accountId}/prepayments`, {
    amount: 20000,
    paymentRef: "pay_prepay_bad_ceil",
    prepaymentChargeName: "Prepayment fee",
    prepaymentChargeAmount: 500
  });
  assert.equal(badPrepayCeiling.status, 422);
  assert(badPrepayCeiling.body.findings.some(f => f.message.includes("exceeds the product policy ceiling")));

  // 6. Valid prepayment charge assessment
  // principalPrepaid is 20000. Prepayment charge of 300 (which is <= 400 ceiling and <= 2500 catalog cap)
  const validPrepay = await postJson(`${base}/loan-accounts/${accountId}/prepayments`, {
    amount: 20300, // 20000 principal prepayment + 300 prepayment fee
    paymentRef: "pay_prepay_ok",
    prepaymentChargeName: "Prepayment fee",
    prepaymentChargeAmount: 300
  });
  assert.equal(validPrepay.status, 200);
  // Verify that the prepayment charge was assessed on the ledger
  const prepayAccount = validPrepay.body.loanAccount;
  const chargeEvent = prepayAccount.ledger.find(e => e.type === "charge_assessed" && e.chargeName === "Prepayment fee");
  assert.ok(chargeEvent);
  assert.equal(chargeEvent.amount, 300);
});

test("CKYC Search, Download, and Upload flow", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-ckyc-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT_A] });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // 1. Seed RE and Borrower (in draft state)
  await seedOperationalActors(base);
  assert.equal((await postJson(`${base}/regulated-entities`, validRegulatedEntity())).status, 201);
  
  // Seed borrower profile with valid placeholder values in draft state
  const draftBorrower = {
    ...validBorrowerProfile(),
    fullName: "Draft Placeholder Name",
    dateOfBirth: "1990-01-01",
    status: "draft"
  };
  assert.equal((await postJson(`${base}/borrowers`, draftBorrower)).status, 201);

  // 2. Search CKYC by PAN (should find the pre-seeded record)
  const searchRes = await postJson(`${base}/borrowers/bor_001/ckyc/search`, {
    idType: "pan",
    idNumber: "ABCDE1234F"
  });
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.body.results.length, 1);
  assert.equal(searchRes.body.results[0].ckycNumber, "99999999999999");
  assert.equal(searchRes.body.results[0].fullName, "Aaditya Patel");

  // 3. Download the record and sync it
  const downloadRes = await postJson(`${base}/borrowers/bor_001/ckyc/download`, {
    ckycNumber: "99999999999999"
  });
  assert.equal(downloadRes.status, 200);
  assert.equal(downloadRes.body.status, "verified");
  assert.equal(downloadRes.body.method, "ckyc");
  assert.equal(downloadRes.body.ckycRef, "99999999999999");

  // Verify borrower profile was updated
  const borrowerRes = await apiFetch(`${base}/borrowers/bor_001`);
  const bBody = await borrowerRes.json();
  assert.equal(bBody.fullName, "Aaditya Patel");
  assert.equal(bBody.dateOfBirth, "1990-01-01");
  assert.equal(bBody.status, "active");

  // 4. Upload a local verified KYC record to CKYC
  // Seed a new borrower profile
  const newBorrower = {
    ...validBorrowerProfile(),
    borrowerId: "bor_002",
    fullName: "Karan Johar",
    pan: "ABCDE1234F"
  };
  assert.equal((await postJson(`${base}/borrowers`, newBorrower)).status, 201);

  // Create a verified local KYC record
  const kycInput = {
    borrowerId: "bor_002",
    status: "verified",
    riskCategory: "medium",
    verifiedAt: new Date().toISOString(),
    method: "manual"
  };
  const seedKyc = await postJson(`${base}/borrowers/bor_002/kyc-records`, kycInput);
  assert.equal(seedKyc.status, 201);

  // Upload to CKYC
  const uploadRes = await postJson(`${base}/borrowers/bor_002/ckyc/upload`, {
    kycRecordId: seedKyc.body.kycRecord.kycRecordId
  });
  assert.equal(uploadRes.status, 200);
  assert.equal(uploadRes.body.success, true);
  assert.ok(uploadRes.body.ckycNumber);
  assert.equal(uploadRes.body.kycRecord.ckycRef, uploadRes.body.ckycNumber);

  // Verify that we can search for the uploaded record in CKYC
  const searchRes2 = await postJson(`${base}/borrowers/bor_002/ckyc/search`, {
    idType: "pan",
    idNumber: "IDbor_002"
  });
  assert.equal(searchRes2.status, 200);
  assert(searchRes2.body.results.some(r => r.fullName === "Karan Johar"));
});

