import test from "node:test";
import assert from "node:assert/strict";
import { acknowledgeBcAssistedKycUpdate, analyzeBankStatement, assessGuardianSpecialCategory, assignRiskGradeAndPrice, buildPeriodicKycAction, calculateHouseholdIndebtedness, recordPhysicalOriginalCustody, verifyUnderwritingSources } from "@loanos/core/lending/kyc-underwriting-completion.js";

const approval = { proposedBy: "maker", approvedBy: "checker", approvalRef: "APR-1" };
test("special-category, periodic KYC grace, and BC updates fail closed without evidence", () => {
  const guardian = assessGuardianSpecialCategory({ assessmentId: "a1", customerId: "c1", category: "minor", guardianId: "g1", relationship: "parent", authorityEvidenceRef: "auth", guardianKycEvidenceRef: "kyc", authorityValidUntil: "2027-01-01T00:00:00Z", assistanceRecordRef: "assist", customerConsent: true, restrictions: ["debit", "debit"], ...approval }, new Date("2026-01-01T00:00:00Z"));
  assert.equal(guardian.assessment.restrictions.length, 1);
  const grace = buildPeriodicKycAction({ customerId: "c1", kycDueAt: "2026-01-01T00:00:00Z", riskCategory: "low" }, { noticeTemplateRef: "notice", deliveryChannel: "sms", lowRiskGraceDays: 30, gracePolicyRef: "policy", monitoringEvidenceRef: "monitor" }, new Date("2026-01-10T00:00:00Z"));
  assert.equal(grace.action.stage, "low_risk_grace");
  assert.equal(buildPeriodicKycAction({ customerId: "c1", kycDueAt: "2026-01-01T00:00:00Z", riskCategory: "low" }, { noticeTemplateRef: "n", deliveryChannel: "sms", lowRiskGraceDays: 30 }, new Date("2026-01-10T00:00:00Z")).action, null);
  assert.equal(acknowledgeBcAssistedKycUpdate({ updateId: "u", customerId: "c", bcAgentId: "a", bcOutletId: "o", requestEvidenceRef: "r", customerAcknowledgementRef: "ack", coreUpdateRef: "core", customerAcknowledged: true, ...approval }).update.status, "acknowledged");
});

test("physical originals maintain witnessed idempotent custody", () => {
  const input = { custodyEventId: "ce1", idempotencyKey: "ik1", documentId: "doc1", originalType: "title", sealedPacketRef: "seal", locationRef: "vault", conditionEvidenceRef: "photo", chainOfCustodyRef: "chain", receivedBy: "custodian", witnessedBy: "witness" };
  const first = recordPhysicalOriginalCustody([], input).custody;
  assert.equal(recordPhysicalOriginalCustody([first], input).idempotent, true);
  assert.equal(recordPhysicalOriginalCustody([first], { ...input, locationRef: "other" }).custody, null);
});

test("bank analysis and source verification are deterministic and evidence-bound", () => {
  const analysis = analyzeBankStatement({ statementEvidenceRef: "aa-data", months: [{ month: "2026-01", creditsPaise: 10000, debitsPaise: 9000, cashCreditsPaise: 1000, closingBalancePaise: 1000, bounces: 0 }, { month: "2026-02", creditsPaise: 8000, debitsPaise: 7000, cashCreditsPaise: 0, closingBalancePaise: 2000, bounces: 1 }, { month: "2026-03", creditsPaise: 9000, debitsPaise: 8500, cashCreditsPaise: 500, closingBalancePaise: 2500, bounces: 0 }] }).analysis;
  assert.equal(analysis.averageCreditsPaise, 9000); assert.equal(analysis.stabilityBps, 8000); assert.equal(analysis.bounceCount, 1);
  const verification = verifyUnderwritingSources({ verificationId: "v", applicantId: "a", applicantType: "self_employed", sources: Object.fromEntries(["gst", "itr", "udyam", "business"].map((k) => [k, { reference: `${k}-ref`, status: "verified", verifiedAt: "2026-01-01T00:00:00Z" }])), ...approval });
  assert.equal(verification.verification.status, "verified");
  assert.equal(verifyUnderwritingSources({ verificationId: "v", applicantId: "a", applicantType: "self_employed", sources: {}, ...approval }).verification, null);
});

test("household FOIR, MFI indebtedness, grade and risk pricing use exact integer math", () => {
  const debt = calculateHouseholdIndebtedness({ householdId: "h", monthlyHouseholdIncomePaise: 100001, obligationsPaise: [10000, 5000], proposedEmiPaise: 20000, proposedPrincipalPaise: 100000, bureauEvidenceRef: "bureau", mfiEvidenceRef: "mfi", mfiIndebtednessPaise: 50000, maxFoirBps: 4000, maxMfiIndebtednessPaise: 200000 }).assessment;
  assert.equal(debt.foirBps, 3499); assert.equal(debt.outcome, "eligible");
  const pricing = assignRiskGradeAndPrice({ pricingPolicyRef: "policy-v1", scoreEvidenceRef: "bureau-score", score: 750, principalPaise: 100001, bands: [{ minScore: 700, grade: "A", rating: "prime", annualRateBps: 1200 }, { minScore: 600, grade: "B", annualRateBps: 1600 }], ...approval }).pricing;
  assert.equal(pricing.grade, "A"); assert.equal(pricing.annualInterestPaise, 12000);
  assert.equal(assignRiskGradeAndPrice({ pricingPolicyRef: "p", scoreEvidenceRef: "s", score: 500, principalPaise: 1, bands: [{ minScore: 600, grade: "B", annualRateBps: 1600 }], ...approval }).pricing, null);
});
