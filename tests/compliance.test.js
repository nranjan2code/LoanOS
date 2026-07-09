import assert from "node:assert/strict";
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
  createIncident,
  createModelRegistryState,
  recordIncidentNotification,
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
  upsertDigitalLendingApp,
  upsertLendingServiceProvider,
  upsertBorrowerProfile,
  upsertConsentRecord,
  upsertKycRecord,
  upsertProductPolicy,
  upsertRegulatedEntity,
  validateKfs,
  validateKfsBeforeDecision
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
    receiptRef: "cash_receipt_001"
  });
  assert.equal(latePosting.status, 422);

  const cashRecovery = await postJson(`${base}/loan-accounts/${account.loanAccountId}/cash-recoveries`, {
    recoveryAgentId: "agent_001",
    amount: firstInstallment.totalDue,
    collectedAt: `${overdueDate}T11:00:00.000Z`,
    postedAt: `${overdueDate}T12:00:00.000Z`,
    receiptRef: "cash_receipt_002"
  });
  assert.equal(cashRecovery.status, 200);
  assert.equal(cashRecovery.body.paymentEvent.type, "cash_recovery_payment");
  assert.equal(cashRecovery.body.paymentEvent.receiptRef, "cash_receipt_002");
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
    tenant: {
      regulatedEntityName: "Example India NBFC Ltd",
      regulatedEntityType: "nbfc",
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
