import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";

const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const error = (message, field) => createFinding("error", "RBI-IT-GRC", message, field);
const out = (findings, values = {}) => ({ ...values, findings, summary: summarizeFindings(findings) });
const exact = (v, positive = false) => Number.isSafeInteger(v) && (positive ? v > 0 : v >= 0);
const approval = (i) => i?.proposedBy && i?.approvedBy && i.proposedBy !== i.approvedBy && i.approvalRef;
const instant = (v) => Boolean(v) && !Number.isNaN(new Date(v).getTime());

export function manageLspIncident(existing = [], input, now = new Date()) {
  const findings = [];
  if (!input?.incidentId || !input?.idempotencyKey || !input?.partnerId || !["breach", "incident"].includes(input?.type) || !input?.evidenceRef || !input?.impactAssessmentRef || !input?.remediationPlanRef || !instant(input?.remediationDueAt)) findings.push(error("Partner incident, impact, remediation, due date, and evidence are required.", "incident"));
  if (!["remediate", "suspend", "exit"].includes(input?.action) || !approval(input)) findings.push(error("Approved remediation, suspension, or exit action is required.", "action"));
  if (["suspend", "exit"].includes(input?.action) && (!input?.customerContinuityPlanRef || !input?.dataReturnDeletionPlanRef)) findings.push(error("Suspension or exit requires customer continuity and data return/deletion plans.", "exit"));
  const body = { incidentId: input?.incidentId, idempotencyKey: input?.idempotencyKey, partnerId: input?.partnerId, type: input?.type, severity: input?.severity, evidenceRef: input?.evidenceRef, impactAssessmentRef: input?.impactAssessmentRef, remediationPlanRef: input?.remediationPlanRef, remediationDueAt: input?.remediationDueAt, action: input?.action, customerContinuityPlanRef: input?.customerContinuityPlanRef ?? null, dataReturnDeletionPlanRef: input?.dataReturnDeletionPlanRef ?? null, proposedBy: input?.proposedBy, approvedBy: input?.approvedBy, approvalRef: input?.approvalRef };
  const prior = existing.find((r) => r.idempotencyKey === input?.idempotencyKey || r.incidentId === input?.incidentId);
  if (prior) return prior.checksumSha256 === hash(body) ? out([], { incident: prior, idempotent: true }) : out([error("Incident idempotency conflict.", "idempotencyKey")], { incident: null, idempotent: false });
  if (findings.length) return out(findings, { incident: null, idempotent: false });
  return out([], { incident: { ...body, checksumSha256: hash(body), status: input.action === "remediate" ? "remediation_open" : input.action === "suspend" ? "suspended" : "exit_controlled", recordedAt: now.toISOString() }, idempotent: false });
}

export function approveServicingPortfolioTransfer(input, now = new Date()) {
  const findings = [];
  if (!input?.transferId || !input?.fromEntityId || !input?.toEntityId || input.fromEntityId === input.toEntityId || !["servicing_transfer", "portfolio_sale", "assignment", "participation"].includes(input?.transferType)) findings.push(error("Distinct transfer parties and a supported transfer type are required.", "transfer"));
  if (!Array.isArray(input?.accountIds) || !input.accountIds.length || new Set(input.accountIds).size !== input.accountIds.length) findings.push(error("A non-empty unique account manifest is required.", "accountIds"));
  for (const ref of ["agreementEvidenceRef", "dueDiligenceEvidenceRef", "borrowerNoticeEvidenceRef", "reconciliationEvidenceRef", "dataMigrationPlanRef"]) if (!input?.[ref]) findings.push(error(`Required transfer evidence is missing: ${ref}.`, ref));
  if (![input?.considerationPaise, input?.portfolioPrincipalPaise].every((v) => exact(v)) || !approval(input)) findings.push(error("Exact-paise transfer values and independent approval are required.", "approval"));
  if (findings.length) return out(findings, { transfer: null });
  const body = { transferId: input.transferId, transferType: input.transferType, fromEntityId: input.fromEntityId, toEntityId: input.toEntityId, accountIds: [...input.accountIds].sort(), considerationPaise: input.considerationPaise, portfolioPrincipalPaise: input.portfolioPrincipalPaise, agreementEvidenceRef: input.agreementEvidenceRef, dueDiligenceEvidenceRef: input.dueDiligenceEvidenceRef, borrowerNoticeEvidenceRef: input.borrowerNoticeEvidenceRef, reconciliationEvidenceRef: input.reconciliationEvidenceRef, dataMigrationPlanRef: input.dataMigrationPlanRef, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  return out([], { transfer: { ...body, checksumSha256: hash(body), status: "approved_for_controlled_execution", approvedAt: now.toISOString() } });
}

export function assessPartnerOversight(input) {
  const findings = [];
  if (!input?.partnerId || !input?.period || !input?.slaEvidenceRef || !input?.auditEvidenceRef || !input?.concentrationPolicyRef) findings.push(error("Partner, period, SLA, audit, and concentration evidence are required.", "oversight"));
  for (const v of [input?.slaTargetBps, input?.slaActualBps, input?.concentrationBps, input?.maxConcentrationBps]) if (!exact(v)) findings.push(error("Performance and concentration metrics must be exact basis points.", "metrics"));
  if (!approval(input)) findings.push(error("Independent partner oversight approval is required.", "approval"));
  if (findings.length) return out(findings, { assessment: null });
  const breaches = []; if (input.slaActualBps < input.slaTargetBps) breaches.push("sla"); if (input.concentrationBps > input.maxConcentrationBps) breaches.push("concentration"); if (input.auditOutcome !== "effective") breaches.push("audit");
  const body = { partnerId: input.partnerId, period: input.period, slaTargetBps: input.slaTargetBps, slaActualBps: input.slaActualBps, concentrationBps: input.concentrationBps, maxConcentrationBps: input.maxConcentrationBps, auditOutcome: input.auditOutcome, slaEvidenceRef: input.slaEvidenceRef, auditEvidenceRef: input.auditEvidenceRef, concentrationPolicyRef: input.concentrationPolicyRef, breaches, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  return out([], { assessment: { ...body, checksumSha256: hash(body), outcome: breaches.length ? "remediation_required" : "effective" } });
}

export function approveGrievanceRcaCapa(input, now = new Date()) {
  const findings = [];
  if (!input?.caseId || !input?.rootCauseCode || !input?.rootCauseEvidenceRef || !input?.correctiveAction || !input?.preventiveAction || !input?.ownerId || !instant(input?.dueAt)) findings.push(error("Evidence-bound RCA, CAPA, owner, and due date are required.", "capa"));
  if (![input?.restitutionPaise, input?.compensationPaise].every((v) => exact(v)) || !input?.calculationEvidenceRef || !approval(input)) findings.push(error("Exact-paise redress calculation and independent approval are required.", "redress"));
  if (findings.length) return out(findings, { capa: null });
  const body = { caseId: input.caseId, rootCauseCode: input.rootCauseCode, rootCauseEvidenceRef: input.rootCauseEvidenceRef, correctiveAction: input.correctiveAction, preventiveAction: input.preventiveAction, ownerId: input.ownerId, dueAt: input.dueAt, restitutionPaise: input.restitutionPaise, compensationPaise: input.compensationPaise, totalRedressPaise: input.restitutionPaise + input.compensationPaise, calculationEvidenceRef: input.calculationEvidenceRef, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  return out([], { capa: { ...body, checksumSha256: hash(body), status: "approved_pending_execution", approvedAt: now.toISOString() } });
}

export function createAssistedComplaint(input, now = new Date()) {
  const findings = [];
  if (!input?.caseId || !input?.customerId || !input?.complaintText || !input?.preferredLanguage || !input?.assistanceMode || !input?.assistedBy || !input?.customerAcknowledgementRef) findings.push(error("Complaint, language, assistance, and acknowledgement are required.", "complaint"));
  if (input?.vulnerable === true && (!input?.vulnerabilityType || !input?.accessibilityAdjustmentRef || !input?.priorityOwnerId)) findings.push(error("Vulnerable customers require documented adjustment and priority ownership.", "vulnerability"));
  if (input?.customerAcknowledged !== true) findings.push(error("Positive customer acknowledgement is required.", "acknowledgement"));
  if (findings.length) return out(findings, { complaint: null });
  const body = { caseId: input.caseId, customerId: input.customerId, complaintText: input.complaintText, preferredLanguage: input.preferredLanguage, assistanceMode: input.assistanceMode, assistedBy: input.assistedBy, vulnerable: input.vulnerable === true, vulnerabilityType: input.vulnerabilityType ?? null, accessibilityAdjustmentRef: input.accessibilityAdjustmentRef ?? null, priorityOwnerId: input.priorityOwnerId ?? null, customerAcknowledgementRef: input.customerAcknowledgementRef, customerAcknowledged: true };
  return out([], { complaint: { ...body, checksumSha256: hash(body), status: "registered", registeredAt: now.toISOString() } });
}

export function buildGrievanceAnalytics(cases = [], input) {
  if (!input?.reportId || !input?.period || !input?.boardPackEvidenceRef) return out([error("Report period and board-pack evidence are required.", "report")], { report: null });
  const group = (field) => Object.fromEntries([...new Set(cases.map((c) => c[field] ?? "unknown"))].sort().map((key) => [key, cases.filter((c) => (c[field] ?? "unknown") === key).length]));
  const repeatCustomers = Object.entries(group("customerId")).filter(([, count]) => count > 1).map(([customerId, count]) => ({ customerId, count }));
  const body = { reportId: input.reportId, period: input.period, caseCount: cases.length, repeats: repeatCustomers, byProduct: group("productCode"), byChannel: group("channel"), byRootCause: group("rootCauseCode"), boardPackEvidenceRef: input.boardPackEvidenceRef };
  return out([], { report: { ...body, checksumSha256: hash(body), status: "board_ready" } });
}

export function closeOmbudsmanAward(input, now = new Date()) {
  const findings = [];
  if (!input?.caseId || !input?.awardRef || !instant(input?.awardDate) || !instant(input?.complianceDueAt) || !input?.paymentEvidenceRef || !input?.customerReceiptRef || !input?.ombudsmanSubmissionRef) findings.push(error("Award, deadline, payment, customer receipt, and submission evidence are required.", "award"));
  if (!exact(input?.awardAmountPaise, true) || !exact(input?.paidAmountPaise, true) || input?.awardAmountPaise !== input?.paidAmountPaise) findings.push(error("Award must be paid exactly in paise before closure.", "paidAmountPaise"));
  if (!instant(input?.paidAt) || new Date(input?.paidAt) > new Date(input?.complianceDueAt) || !approval(input)) findings.push(error("Timely payment and independent closure approval are required.", "closure"));
  if (findings.length) return out(findings, { closure: null });
  const body = { caseId: input.caseId, awardRef: input.awardRef, awardDate: input.awardDate, complianceDueAt: input.complianceDueAt, awardAmountPaise: input.awardAmountPaise, paidAmountPaise: input.paidAmountPaise, paidAt: input.paidAt, paymentEvidenceRef: input.paymentEvidenceRef, customerReceiptRef: input.customerReceiptRef, ombudsmanSubmissionRef: input.ombudsmanSubmissionRef, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  return out([], { closure: { ...body, checksumSha256: hash(body), status: "complied_closed", closedAt: now.toISOString() } });
}
