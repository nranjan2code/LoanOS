import test from "node:test";
import assert from "node:assert/strict";
import { approveGrievanceRcaCapa, approveServicingPortfolioTransfer, assessPartnerOversight, buildGrievanceAnalytics, closeOmbudsmanAward, createAssistedComplaint, manageLspIncident } from "@loanos/core/operations/partner-grievance-completion.js";

const approval = { proposedBy: "maker", approvedBy: "checker", approvalRef: "APR-1" };
test("LSP incidents govern remediation, suspension, exit, and idempotency", () => {
  const input = { incidentId: "i1", idempotencyKey: "ik1", partnerId: "p1", type: "breach", severity: "high", evidenceRef: "ev", impactAssessmentRef: "impact", remediationPlanRef: "rem", remediationDueAt: "2027-01-01T00:00:00Z", action: "exit", customerContinuityPlanRef: "continuity", dataReturnDeletionPlanRef: "deletion", ...approval };
  const first = manageLspIncident([], input).incident; assert.equal(first.status, "exit_controlled");
  assert.equal(manageLspIncident([first], input).idempotent, true);
  assert.equal(manageLspIncident([], { ...input, customerContinuityPlanRef: null }).incident, null);
});
test("portfolio transfers and partner oversight require evidence and exact metrics", () => {
  const transfer = approveServicingPortfolioTransfer({ transferId: "t1", transferType: "assignment", fromEntityId: "a", toEntityId: "b", accountIds: ["l2", "l1"], considerationPaise: 100001, portfolioPrincipalPaise: 120000, agreementEvidenceRef: "agr", dueDiligenceEvidenceRef: "dd", borrowerNoticeEvidenceRef: "notice", reconciliationEvidenceRef: "recon", dataMigrationPlanRef: "migration", ...approval }).transfer;
  assert.deepEqual(transfer.accountIds, ["l1", "l2"]);
  const oversight = assessPartnerOversight({ partnerId: "p", period: "2026-Q2", slaTargetBps: 9900, slaActualBps: 9800, concentrationBps: 3000, maxConcentrationBps: 2500, auditOutcome: "ineffective", slaEvidenceRef: "sla", auditEvidenceRef: "audit", concentrationPolicyRef: "policy", ...approval }).assessment;
  assert.deepEqual(oversight.breaches, ["sla", "concentration", "audit"]); assert.equal(oversight.outcome, "remediation_required");
});
test("RCA/CAPA redress and assisted vulnerable complaint fail closed without evidence", () => {
  const capa = approveGrievanceRcaCapa({ caseId: "g1", rootCauseCode: "mis_sale", rootCauseEvidenceRef: "rca", correctiveAction: "refund", preventiveAction: "control", ownerId: "owner", dueAt: "2027-01-01T00:00:00Z", restitutionPaise: 10001, compensationPaise: 999, calculationEvidenceRef: "calc", ...approval }).capa;
  assert.equal(capa.totalRedressPaise, 11000);
  const complaint = createAssistedComplaint({ caseId: "g2", customerId: "c", complaintText: "issue", preferredLanguage: "hi", assistanceMode: "screen_reader_and_interpreter", assistedBy: "agent", vulnerable: true, vulnerabilityType: "visual_impairment", accessibilityAdjustmentRef: "adj", priorityOwnerId: "priority", customerAcknowledgementRef: "ack", customerAcknowledged: true }).complaint;
  assert.equal(complaint.status, "registered");
  assert.equal(createAssistedComplaint({ caseId: "g3", customerId: "c", complaintText: "x", preferredLanguage: "hi", assistanceMode: "agent", assistedBy: "a", vulnerable: true, customerAcknowledgementRef: "ack", customerAcknowledged: true }).complaint, null);
});
test("analytics exposes repeats/product/channel and Ombudsman closure requires exact timely compliance", () => {
  const report = buildGrievanceAnalytics([{ customerId: "c1", productCode: "pl", channel: "app", rootCauseCode: "delay" }, { customerId: "c1", productCode: "pl", channel: "branch", rootCauseCode: "delay" }], { reportId: "r", period: "2026-Q2", boardPackEvidenceRef: "board" }).report;
  assert.deepEqual(report.repeats, [{ customerId: "c1", count: 2 }]); assert.equal(report.byChannel.app, 1);
  const award = { caseId: "g", awardRef: "omb-1", awardDate: "2026-01-01T00:00:00Z", complianceDueAt: "2026-02-01T00:00:00Z", awardAmountPaise: 50001, paidAmountPaise: 50001, paidAt: "2026-01-15T00:00:00Z", paymentEvidenceRef: "utr", customerReceiptRef: "receipt", ombudsmanSubmissionRef: "submission", ...approval };
  assert.equal(closeOmbudsmanAward(award).closure.status, "complied_closed");
  assert.equal(closeOmbudsmanAward({ ...award, paidAmountPaise: 50000 }).closure, null);
});
