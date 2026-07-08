import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  attachKfs,
  buildKeyFactStatement,
  classifyLoanAsset,
  computeDelinquency,
  createModelRegistryState,
  ELIGIBILITY_DECISIONS,
  estimateEmi,
  evaluateEligibility,
  evaluateLoanApplication,
  generateRepaymentSchedule,
  registerModel,
  resolveBorrowerApplicationReferences,
  resolveLoanApplicationReferences,
  triggerKillSwitch,
  upsertBorrowerProfile,
  upsertConsentRecord,
  upsertKycRecord,
  upsertProductPolicy,
  upsertRegulatedEntity,
  validateKfs,
  validateKfsBeforeDecision
} from "../packages/core/src/index.js";
import { createLoanOsServer } from "../apps/api/src/server.js";

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

  const server = createLoanOsServer({ dataDir });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await fetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
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

  const server = createLoanOsServer({ dataDir });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await fetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
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

  const server = createLoanOsServer({ dataDir });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(`${base}/loans/applications`, {
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

  const lookup = await fetch(`${base}/loans/applications/${body.applicationId}`);
  assert.equal(lookup.status, 200);
});

test("API supports RE and product policy backed loan applications", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir });
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

test("API supports borrower-backed applications without embedded borrower KYC consent blobs", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir });
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

  const server = createLoanOsServer({ dataDir });
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

  const server = createLoanOsServer({ dataDir });
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

  const taskResponse = await fetch(`${base}/workflow/tasks?type=application.document_packet_delivery`);
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

  const fetched = await fetch(`${base}/loans/applications/${application.applicationId}/document-packet`);
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

  const taskAfterDeliveryResponse = await fetch(`${base}/workflow/tasks?type=application.document_packet_delivery`);
  assert.equal(taskAfterDeliveryResponse.status, 200);
  const taskAfterDelivery = await taskAfterDeliveryResponse.json();
  assert.equal(taskAfterDelivery.count, 0);

  const disbursementTaskResponse = await fetch(`${base}/workflow/tasks?type=application.disbursement`);
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

  const server = createLoanOsServer({ dataDir });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);

  const accountResponse = await fetch(`${base}/loan-accounts/${application.loanAccountId}`);
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

  const scheduleResponse = await fetch(`${base}/loan-accounts/${account.loanAccountId}/schedule`);
  assert.equal(scheduleResponse.status, 200);
  const scheduleBody = await scheduleResponse.json();
  assert.equal(scheduleBody.schedule.length, 12);
});

test("API generates borrower statement from schedule and ledger", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await fetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
  const firstInstallment = account.schedule[0];
  await postJson(`${base}/loan-accounts/${account.loanAccountId}/payments`, {
    amount: firstInstallment.totalDue,
    receivedAt: `${firstInstallment.dueDate}T00:00:00.000Z`,
    paymentRef: "nach_payment_001",
    channel: "nach"
  });

  const statementResponse = await fetch(
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

test("API controls disclosed charges, waivers, and reversals", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await fetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();

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

test("API enforces recovery-agent notice and same-day cash recovery posting", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await fetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
  const firstInstallment = account.schedule[0];
  const overdueDate = addDays(firstInstallment.dueDate, 7);

  const delinquencyResponse = await fetch(`${base}/loan-accounts/${account.loanAccountId}/delinquency?asOf=${overdueDate}T00:00:00.000Z`);
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

  const server = createLoanOsServer({ dataDir });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await fetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
  const asOf = `${addDays(account.schedule[0].dueDate, 91)}T00:00:00.000Z`;

  const classificationResponse = await fetch(`${base}/loan-accounts/${account.loanAccountId}/asset-classification?asOf=${asOf}`);
  assert.equal(classificationResponse.status, 200);
  const classification = await classificationResponse.json();
  assert.equal(classification.assetClass, "npa");
  assert.equal(classification.isNpa, true);

  const snapshotResponse = await fetch(`${base}/loan-accounts/${account.loanAccountId}/cic-snapshot?asOf=${asOf}`);
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();
  assert.equal(snapshot.loanAccountId, account.loanAccountId);
  assert.equal(snapshot.borrowerId, "bor_001");
  assert.equal(snapshot.assetClass, "npa");
  assert(snapshot.amountOverdue > 0);
  assert(snapshot.currentBalance > 0);

  const allSnapshotsResponse = await fetch(`${base}/reporting/cic/snapshots?asOf=${asOf}`);
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

  const server = createLoanOsServer({ dataDir });
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

  const server = createLoanOsServer({ dataDir });
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

  const storedEligibility = await fetch(`${base}/loans/applications/${application.applicationId}/eligibility`);
  assert.equal((await storedEligibility.json()).decision, "refer");

  const referralTasksResponse = await fetch(`${base}/workflow/tasks?type=application.manual_underwriting`);
  assert.equal(referralTasksResponse.status, 200);
  const referralTasks = await referralTasksResponse.json();
  assert.equal(referralTasks.count, 1);
  assert.equal(referralTasks.tasks[0].queue, "credit_ops");
  assert.equal(referralTasks.tasks[0].priority, "high");
  assert.equal(referralTasks.tasks[0].sla.targetHours, 8);
  assert.equal(referralTasks.tasks[0].context.eligibility.decision, "refer");

  const creditDecisionTasksResponse = await fetch(`${base}/workflow/tasks?type=application.credit_decision`);
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

  const server = createLoanOsServer({ dataDir });
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

  const approvalTasksResponse = await fetch(`${base}/workflow/tasks?type=application.decision_approval`);
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

  const server = createLoanOsServer({ dataDir });
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

  const server = createLoanOsServer({ dataDir });
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

test("API exposes LWS decision approval task with assignment lifecycle", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir });
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

  const taskListResponse = await fetch(`${base}/workflow/tasks?type=application.decision_approval`);
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

  const taskAfterStartResponse = await fetch(`${base}/workflow/tasks/${taskId}`);
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

  const taskAfterApprovalResponse = await fetch(`${base}/workflow/tasks?type=application.decision_approval`);
  assert.equal(taskAfterApprovalResponse.status, 200);
  const taskAfterApproval = await taskAfterApprovalResponse.json();
  assert.equal(taskAfterApproval.count, 0);
});

test("API exposes LWS recovery task until noticed recovery assignment is recorded", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir });
  await listen(server);
  t.after(async () => {
    await close(server);
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const application = await approveAndDisburseApplication(base);
  const account = await (await fetch(`${base}/loan-accounts/${application.loanAccountId}`)).json();
  const overdueDate = addDays(account.schedule[0].dueDate, 10);
  const asOf = `${overdueDate}T00:00:00.000Z`;

  const tasksResponse = await fetch(`${base}/workflow/tasks?type=loan_account.recovery_assignment&asOf=${asOf}`);
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

  const tasksAfterDomainActionResponse = await fetch(`${base}/workflow/tasks?type=loan_account.recovery_assignment&asOf=${asOf}`);
  assert.equal(tasksAfterDomainActionResponse.status, 200);
  const tasksAfterDomainAction = await tasksAfterDomainActionResponse.json();
  assert.equal(tasksAfterDomainAction.count, 0);
});

test("API manages grievance complaint lifecycle with LWS tasks", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir });
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

  const assignmentTasksResponse = await fetch(`${base}/workflow/tasks?type=complaint.assignment&asOf=2026-07-09T11:00:00.000Z`);
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

  const resolutionTasksResponse = await fetch(`${base}/workflow/tasks?type=complaint.resolution&asOf=2026-07-10T10:00:00.000Z`);
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

  const tasksAfterResolutionResponse = await fetch(`${base}/workflow/tasks?entityType=complaint`);
  assert.equal(tasksAfterResolutionResponse.status, 200);
  const tasksAfterResolution = await tasksAfterResolutionResponse.json();
  assert.equal(tasksAfterResolution.count, 0);
});

test("API raises RBI CMS escalation task for 30-day grievance breach", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-api-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const server = createLoanOsServer({ dataDir });
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

  const overdueComplaintResponse = await fetch(`${base}/complaints/${complaintResponse.body.complaint.complaintId}?asOf=2026-08-02T09:00:00.000Z`);
  assert.equal(overdueComplaintResponse.status, 200);
  const overdueComplaint = await overdueComplaintResponse.json();
  assert.equal(overdueComplaint.effectiveStatus, "escalation_due");
  assert.equal(overdueComplaint.sla.status, "breached");

  const escalationTasksResponse = await fetch(`${base}/workflow/tasks?type=complaint.rbi_cms_escalation&asOf=2026-08-02T09:00:00.000Z`);
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

  const server = createLoanOsServer({ dataDir });
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

  const storedEligibility = await fetch(`${base}/loans/applications/${application.applicationId}/eligibility`);
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
    reason: "Affordability not met"
  });
  assert.equal(decline.status, 202);
  assert.equal(decline.body.status, "pending_decision_approval");
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

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
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
