import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acceptKfs,
  attachSanctionValidity,
  createUnderwritingCondition,
  evaluateOriginationReadiness,
  initializeOriginationJourney,
  recordApplicationDocument,
  reviewApplicationDocument,
  satisfyUnderwritingCondition,
  validateOriginationBeforeDecision,
  validateOriginationBeforeDisbursement,
} from "../packages/core/src/index.js";
import { createLoanOsServer } from "../apps/api/src/server.js";

const TENANT = { tenantId: "tnt_origination", name: "Origination NBFC", apiKey: "origination-key" };
const checksum = createHash("sha256").update("document bytes").digest("hex");

function governedApplication() {
  const application = {
    applicationId: "app_origination_001",
    borrowerId: "bor_001",
    status: "ready_for_decision",
    product: {
      sanctionValidityDays: 15,
      sanctionValidityPolicyRef: "sanction_policy_v1",
      documentRequirements: [{ type: "income_proof", label: "Income proof", required: true }],
    },
  };
  const result = initializeOriginationJourney(application, {
    channel: "borrower_self_service",
    source: "borrower_portal",
    preferredLanguage: "hi",
    languageUnderstood: true,
    languageConfirmationRef: "language_confirmation_001",
    informationAccurate: true,
    applicationDeclarationRef: "application_declaration_001",
  }, new Date("2026-07-14T00:00:00.000Z"));
  assert.equal(result.summary.status, "ready");
  return result.application;
}

function cleanDocumentInput(overrides = {}) {
  return {
    type: "income_proof",
    fileName: "salary-slip.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4096,
    checksumSha256: checksum,
    storageCountry: "IN",
    malwareScan: {
      status: "clean",
      engine: "clamav",
      signatureVersion: "2026.07.14",
      evidenceRef: "scan_evidence_001",
      scannedAt: "2026-07-14T00:01:00.000Z",
    },
    ...overrides,
  };
}

test("governed digital journey requires declarations and borrower-understood language", () => {
  const blocked = initializeOriginationJourney({ product: {} }, {
    channel: "borrower_self_service",
    preferredLanguage: "hi",
  });
  assert.equal(blocked.summary.status, "blocked");
  assert(blocked.findings.some((finding) => finding.path === "applicationDeclarationRef"));
  assert(blocked.findings.some((finding) => finding.path === "languageConfirmationRef"));

  const application = governedApplication();
  assert.equal(application.origination.documentRequirements.length, 1);
  assert.equal(application.origination.languageName, "Hindi");
});

test("document intake quarantines malware and requires independent verification or governed waiver", () => {
  const application = governedApplication();
  const infected = recordApplicationDocument(application, cleanDocumentInput({
    documentId: "doc_infected",
    malwareScan: { ...cleanDocumentInput().malwareScan, status: "infected" },
  }), { actorId: "bor_001", actorType: "borrower" });
  assert.equal(infected.summary.status, "blocked");
  assert.equal(infected.document.status, "quarantined");

  const upload = recordApplicationDocument(infected.application, cleanDocumentInput({ documentId: "doc_clean" }), { actorId: "bor_001", actorType: "borrower" });
  assert.equal(upload.summary.status, "ready");
  assert.equal(validateOriginationBeforeDecision(upload.application).summary.status, "blocked");

  const selfReview = reviewApplicationDocument(upload.application, "doc_clean", {
    outcome: "verified", reviewedBy: "bor_001", evidenceRef: "review_001",
  });
  assert.equal(selfReview.summary.status, "blocked");

  const reviewed = reviewApplicationDocument(upload.application, "doc_clean", {
    outcome: "verified", reviewedBy: "credit_officer_1", evidenceRef: "review_002",
  });
  assert.equal(reviewed.summary.status, "ready");
  assert.equal(validateOriginationBeforeDecision(reviewed.application).summary.status, "ready");
  assert.equal(evaluateOriginationReadiness(reviewed.application).documentsReady, true);
});

test("conditions precedent and sanction expiry fail closed before disbursement", () => {
  let application = governedApplication();
  const uploaded = recordApplicationDocument(application, cleanDocumentInput({ documentId: "doc_clean" }), { actorId: "bor_001", actorType: "borrower" });
  application = reviewApplicationDocument(uploaded.application, "doc_clean", {
    outcome: "verified", reviewedBy: "credit_officer_1", evidenceRef: "review_002",
  }).application;
  application = attachSanctionValidity({ ...application, status: "approved" }, new Date("2026-07-14T00:00:00.000Z"));
  assert.equal(application.sanctionValidity.expiresAt, "2026-07-29T00:00:00.000Z");

  const conditioned = createUnderwritingCondition(application, {
    conditionId: "condition_001",
    type: "precedent",
    description: "Verify salary credit in latest bank statement",
    policyRef: "underwriting_policy_v1",
    createdBy: "credit_officer_1",
    approvedBy: "credit_checker_1",
  });
  assert.equal(validateOriginationBeforeDisbursement(conditioned.application, new Date("2026-07-20T00:00:00.000Z")).summary.status, "blocked");

  const satisfied = satisfyUnderwritingCondition(conditioned.application, "condition_001", {
    evidenceRef: "salary_credit_match_001",
    satisfiedBy: "operations_1",
    verifiedBy: "credit_checker_1",
  });
  assert.equal(satisfied.summary.status, "ready");
  assert.equal(validateOriginationBeforeDisbursement(satisfied.application, new Date("2026-07-20T00:00:00.000Z")).summary.status, "ready");
  const expired = validateOriginationBeforeDisbursement(satisfied.application, new Date("2026-07-30T00:00:00.000Z"));
  assert.equal(expired.summary.status, "blocked");
  assert(expired.findings.some((finding) => finding.path === "sanctionValidity.expiresAt"));
});

test("non-English KFS acceptance retains language-understanding evidence", () => {
  const application = {
    kfs: { language: "hi", validUntil: "2099-01-01T00:00:00.000Z" },
  };
  const blocked = acceptKfs(application, { acceptedBy: "bor_001", acceptanceEvidenceRef: "session_001" });
  assert.equal(blocked.summary.status, "blocked");
  const accepted = acceptKfs(application, {
    acceptedBy: "bor_001",
    acceptanceEvidenceRef: "session_001",
    understoodLanguage: "hi",
    languageConfirmationRef: "language_confirmation_001",
  }, new Date("2026-07-14T00:00:00.000Z"));
  assert.equal(accepted.summary.status, "ready");
  assert.equal(accepted.application.kfs.understoodLanguage, "hi");
});

test("borrower API exposes products, grounds identity, creates checklist, and quarantines infected uploads", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-origination-api-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [TENANT] });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const staffPost = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": TENANT.apiKey }, body: JSON.stringify(body) });

  assert.equal((await staffPost("/regulated-entities", validRegulatedEntity())).status, 201);
  assert.equal((await staffPost("/products", validProductPolicy())).status, 201);
  assert.equal((await staffPost("/borrowers", validBorrower())).status, 201);
  assert.equal((await staffPost("/borrowers/bor_001/consents", validConsent())).status, 201);
  assert.equal((await staffPost("/borrowers/bor_001/kyc-records", validKyc())).status, 201);

  const challengeResponse = await fetch(`${base}/auth/borrower-challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: TENANT.tenantId, borrowerId: "bor_001", email: "asha@example.in" }) });
  const challenge = await challengeResponse.json();
  assert.equal(challengeResponse.status, 202);
  const loginResponse = await fetch(`${base}/auth/borrower-connect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: TENANT.tenantId, borrowerId: "bor_001", email: "asha@example.in", code: challenge.debugCode }) });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get("set-cookie").split(";")[0];
  const borrowerFetch = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { ...(options.headers ?? {}), cookie } });

  const optionsResponse = await borrowerFetch("/borrower/application-options");
  const options = await optionsResponse.json();
  assert.equal(optionsResponse.status, 200);
  assert.equal(options.products.length, 1);
  assert.equal(options.products[0].documentRequirements.length, 1);

  const applicationResponse = await borrowerFetch("/borrower/applications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      borrowerId: "spoofed_borrower",
      regulatedEntityId: "re_example_nbfc",
      productId: "prod_personal_loan",
      requestedAmount: 100000,
      requestedTenorMonths: 12,
      preferredLanguage: "hi",
      languageUnderstood: true,
      languageConfirmationRef: "language_confirmation_api_001",
      informationAccurate: true,
      applicationDeclarationRef: "declaration_api_001",
      destinationAccount: { ifsc: "HDFC0000001", accountNumberLast4: "9012" },
    }),
  });
  const application = await applicationResponse.json();
  assert.equal(applicationResponse.status, 201, JSON.stringify(application));
  assert.equal(application.borrowerId, "bor_001");
  assert.equal(application.origination.channel, "borrower_self_service");
  assert.equal(application.origination.documentRequirements.length, 1);

  const infectedResponse = await borrowerFetch(`/loans/applications/${application.applicationId}/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cleanDocumentInput({ documentId: "doc_api_infected", malwareScan: { ...cleanDocumentInput().malwareScan, status: "infected" } })),
  });
  const infected = await infectedResponse.json();
  assert.equal(infectedResponse.status, 422);
  assert.equal(infected.document.status, "quarantined");
  const readiness = await (await borrowerFetch(`/loans/applications/${application.applicationId}/origination-readiness`)).json();
  assert.equal(readiness.documentsReady, false);
  assert.equal(readiness.requirementStatus[0].documents[0].status, "quarantined");
});

function validRegulatedEntity() {
  return {
    regulatedEntityId: "re_example_nbfc", regulatedEntityName: "Example India NBFC Ltd", regulatedEntityType: "nbfc", rbiRegistrationNumber: "B-00.00000", country: "IN", status: "active", websiteUrl: "https://example.in", privacyPolicyUrl: "https://example.in/privacy",
    grievanceOfficer: { name: "Nodal Officer", email: "grievance@example.in", phone: "+91-9999999999" },
    dataResidency: { primaryStorageCountry: "IN", paymentDataStorageCountry: "IN", processedOutsideIndia: false },
    boardPolicyRefs: { digitalLendingPolicyRef: "digital_v1", kycPolicyRef: "kyc_v1", penalChargesPolicyRef: "penal_v1", outsourcingPolicyRef: "outsourcing_v1", grievancePolicyRef: "grievance_v1" },
    licenseMetadata: { category: "NBFC-ICC", licenseNumber: "RBI-LIC-2026-999", issuingAuthority: "Reserve Bank of India", issueDate: "2026-01-01", status: "active" },
  };
}

function validProductPolicy() {
  return {
    productId: "prod_personal_loan", regulatedEntityId: "re_example_nbfc", productCode: "PL_IN_DIGITAL", productName: "Digital Personal Loan", productType: "personal_loan", status: "active", currency: "INR",
    minAmount: 10000, maxAmount: 500000, minTenorMonths: 3, maxTenorMonths: 36, annualInterestRateBps: 1800, aprBps: 2100, repaymentFrequency: "monthly", coolingOffDays: 1, recoveryMechanism: "NACH debit to RE account", sanctionValidityDays: 15,
    documentRequirements: [{ type: "income_proof", label: "Income proof", required: true, acceptedMimeTypes: ["application/pdf"], maxSizeBytes: 1048576 }],
    charges: [], penalCharges: [], eligibility: { minAgeYears: 21, maxAgeYears: 65, minMonthlyIncome: 25000, allowedResidencyCountry: "IN" },
    policyRefs: { boardApprovalRef: "board_product_v1", pricingPolicyRef: "pricing_v1", penalChargesPolicyRef: "penal_v1" },
  };
}

function validBorrower() {
  return { borrowerId: "bor_001", borrowerType: "individual", status: "active", fullName: "Asha Sharma", dateOfBirth: "1990-01-01", residencyCountry: "IN", primaryAddressCountry: "IN", primaryAddress: "Bengaluru", contact: { mobile: "+919999999999", email: "asha@example.in" }, economicProfile: { occupation: "salaried", monthlyIncome: 75000, employerName: "Example Services", incomeEvidenceRef: "income_001" } };
}

function validConsent() {
  return { consentId: "consent_001", borrowerId: "bor_001", purpose: "data_processing", status: "granted", noticeVersion: "dpdp-v1", purposeDescription: "Process data to originate and service the loan.", dataCategories: ["identity", "financial"], retentionPeriod: "Statutory term", withdrawalMechanism: "Borrower portal", acceptedAt: "2026-07-08T06:30:00.000Z", channel: "web", evidenceRef: "consent_evidence_001" };
}

function validKyc() {
  return { kycRecordId: "kyc_001", borrowerId: "bor_001", status: "verified", method: "v_cip", riskCategory: "low", verifiedAt: "2026-07-08T06:45:00.000Z", expiresAt: "2027-07-08T06:45:00.000Z", screening: { status: "clear", screenedAt: "2026-07-08T06:44:00.000Z", evidenceRef: "screening_001", sources: ["unsc", "uapa", "pep"] }, aadhaar: { biometricStored: false, otpStored: false, pidStored: false }, vCip: { used: true, storageCountry: "IN", recordingRef: "vcip_001", activityLogRef: "vcip_log_001" } };
}
