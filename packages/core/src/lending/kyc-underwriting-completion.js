import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "../compliance/compliance-controls.js";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const finding = (message, field) => createFinding("error", "RBI-KYC-DIRECTIONS", message, field);
const output = (findings, values = {}) => ({ ...values, findings, summary: summarizeFindings(findings) });
const exact = (value, zero = true) => Number.isSafeInteger(value) && (zero ? value >= 0 : value > 0);
const validTime = (value) => Boolean(value) && !Number.isNaN(new Date(value).getTime());
const approval = (input) => input?.proposedBy && input?.approvedBy && input.proposedBy !== input.approvedBy && input.approvalRef;

export function assessGuardianSpecialCategory(input, now = new Date()) {
  const findings = [];
  if (!input?.assessmentId || !input?.customerId || !["minor", "legally_incapacitated", "visually_impaired", "illiterate", "other_assisted"].includes(input?.category)) findings.push(finding("Customer and recognized special category are required.", "category"));
  if (!input?.guardianId || !input?.relationship || !input?.authorityEvidenceRef || !input?.guardianKycEvidenceRef || !validTime(input?.authorityValidUntil) || new Date(input.authorityValidUntil) <= now) findings.push(finding("Current guardian authority and KYC evidence are required.", "guardian"));
  if (!input?.assistanceRecordRef || input?.customerConsent !== true || !approval(input)) findings.push(finding("Assistance, customer consent, and independent approval are required.", "consent"));
  if (findings.length) return output(findings, { assessment: null });
  const body = { assessmentId: input.assessmentId, customerId: input.customerId, category: input.category, guardianId: input.guardianId, relationship: input.relationship, authorityEvidenceRef: input.authorityEvidenceRef, guardianKycEvidenceRef: input.guardianKycEvidenceRef, authorityValidUntil: input.authorityValidUntil, assistanceRecordRef: input.assistanceRecordRef, customerConsent: true, restrictions: [...new Set(input.restrictions ?? [])].sort(), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  return output([], { assessment: { ...body, checksumSha256: hash(body), status: "approved_with_restrictions", assessedAt: now.toISOString() } });
}

export function buildPeriodicKycAction(customer, input, asOf = new Date()) {
  const findings = [];
  if (!customer?.customerId || !validTime(customer?.kycDueAt) || !input?.noticeTemplateRef || !input?.deliveryChannel) findings.push(finding("KYC due date and approved notice delivery evidence are required.", "notice"));
  const due = new Date(customer?.kycDueAt); const daysToDue = Math.ceil((due - asOf) / 86400000);
  const lowRiskGrace = customer?.riskCategory === "low" && exact(input?.lowRiskGraceDays) ? input.lowRiskGraceDays : 0;
  const graceEndsAt = new Date(due.getTime() + lowRiskGrace * 86400000);
  const stage = daysToDue > 30 ? "not_due" : daysToDue > 0 ? "reminder" : asOf <= graceEndsAt && lowRiskGrace ? "low_risk_grace" : "overdue_restrict";
  if (stage === "low_risk_grace" && (!input?.gracePolicyRef || !input?.monitoringEvidenceRef)) findings.push(finding("Low-risk grace requires policy and ongoing monitoring evidence.", "grace"));
  if (findings.length) return output(findings, { action: null });
  const body = { customerId: customer.customerId, kycDueAt: customer.kycDueAt, riskCategory: customer.riskCategory, stage, daysToDue, graceEndsAt: lowRiskGrace ? graceEndsAt.toISOString() : null, noticeTemplateRef: input.noticeTemplateRef, deliveryChannel: input.deliveryChannel, gracePolicyRef: input.gracePolicyRef ?? null, monitoringEvidenceRef: input.monitoringEvidenceRef ?? null };
  return output([], { action: { ...body, checksumSha256: hash(body), generatedAt: asOf.toISOString() } });
}

export function acknowledgeBcAssistedKycUpdate(input, now = new Date()) {
  const findings = [];
  if (!input?.updateId || !input?.customerId || !input?.bcAgentId || !input?.bcOutletId || !input?.requestEvidenceRef || !input?.customerAcknowledgementRef || !input?.coreUpdateRef) findings.push(finding("BC identity, update, core posting, and customer acknowledgement evidence are required.", "bcUpdate"));
  if (input?.customerAcknowledged !== true || !approval(input)) findings.push(finding("Positive customer acknowledgement and independent approval are required.", "approval"));
  if (findings.length) return output(findings, { update: null });
  const body = { updateId: input.updateId, customerId: input.customerId, bcAgentId: input.bcAgentId, bcOutletId: input.bcOutletId, requestEvidenceRef: input.requestEvidenceRef, coreUpdateRef: input.coreUpdateRef, customerAcknowledgementRef: input.customerAcknowledgementRef, customerAcknowledged: true, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  return output([], { update: { ...body, checksumSha256: hash(body), status: "acknowledged", acknowledgedAt: now.toISOString() } });
}

export function recordPhysicalOriginalCustody(existing = [], input, now = new Date()) {
  const findings = [];
  if (!input?.custodyEventId || !input?.idempotencyKey || !input?.documentId || !input?.originalType || !input?.sealedPacketRef || !input?.locationRef || !input?.receivedBy || !input?.witnessedBy || input.receivedBy === input.witnessedBy) findings.push(finding("Original document, sealed packet, location, custodian, and independent witness are required.", "custody"));
  if (!input?.conditionEvidenceRef || !input?.chainOfCustodyRef) findings.push(finding("Condition and chain-of-custody evidence are required.", "evidence"));
  const body = { custodyEventId: input?.custodyEventId, idempotencyKey: input?.idempotencyKey, documentId: input?.documentId, originalType: input?.originalType, sealedPacketRef: input?.sealedPacketRef, locationRef: input?.locationRef, conditionEvidenceRef: input?.conditionEvidenceRef, chainOfCustodyRef: input?.chainOfCustodyRef, receivedBy: input?.receivedBy, witnessedBy: input?.witnessedBy };
  const prior = existing.find((r) => r.idempotencyKey === input?.idempotencyKey || r.custodyEventId === input?.custodyEventId);
  if (prior) return prior.checksumSha256 === hash(body) ? output([], { custody: prior, idempotent: true }) : output([finding("Custody idempotency conflict.", "idempotencyKey")], { custody: null, idempotent: false });
  if (findings.length) return output(findings, { custody: null, idempotent: false });
  return output([], { custody: { ...body, checksumSha256: hash(body), status: "in_custody", receivedAt: now.toISOString() }, idempotent: false });
}

export function analyzeBankStatement(input) {
  const findings = [];
  if (!input?.statementEvidenceRef || !Array.isArray(input?.months) || input.months.length < 3) findings.push(finding("At least three evidence-bound statement months are required.", "months"));
  if ((input?.months ?? []).some((m) => !m.month || !exact(m.creditsPaise) || !exact(m.debitsPaise) || !exact(m.cashCreditsPaise) || !exact(m.closingBalancePaise) || !Number.isSafeInteger(m.bounces))) findings.push(finding("All statement values must be exact non-negative paise and bounce counts.", "months"));
  if (findings.length) return output(findings, { analysis: null });
  const months = [...input.months].sort((a, b) => a.month.localeCompare(b.month)); const n = months.length;
  const totalCreditsPaise = months.reduce((s, m) => s + m.creditsPaise, 0); const averageCreditsPaise = Math.floor(totalCreditsPaise / n); const averageBalancePaise = Math.floor(months.reduce((s, m) => s + m.closingBalancePaise, 0) / n); const cashCreditsPaise = months.reduce((s, m) => s + m.cashCreditsPaise, 0); const bounceCount = months.reduce((s, m) => s + m.bounces, 0);
  const min = Math.min(...months.map((m) => m.creditsPaise)); const max = Math.max(...months.map((m) => m.creditsPaise)); const stabilityBps = max === 0 ? 0 : Math.floor((min * 10000) / max); const cashCreditBps = totalCreditsPaise === 0 ? 0 : Math.floor((cashCreditsPaise * 10000) / totalCreditsPaise);
  const body = { statementEvidenceRef: input.statementEvidenceRef, monthCount: n, totalCreditsPaise, averageCreditsPaise, averageBalancePaise, cashCreditsPaise, cashCreditBps, bounceCount, stabilityBps };
  return output([], { analysis: { ...body, checksumSha256: hash(body), outcome: bounceCount > (input.maxBounces ?? 3) ? "refer" : "complete" } });
}

export function verifyUnderwritingSources(input) {
  const required = input?.applicantType === "salaried" ? ["employment"] : ["gst", "itr", "udyam", "business"];
  const findings = [];
  if (!input?.verificationId || !input?.applicantId || !["salaried", "self_employed"].includes(input?.applicantType)) findings.push(finding("Applicant and supported applicant type are required.", "applicant"));
  for (const type of required) { const evidence = input?.sources?.[type]; if (!evidence?.reference || evidence.status !== "verified" || !validTime(evidence.verifiedAt)) findings.push(finding(`Verified ${type} evidence is required.`, type)); }
  if (!approval(input)) findings.push(finding("Independent underwriting verification approval is required.", "approval"));
  if (findings.length) return output(findings, { verification: null });
  const body = { verificationId: input.verificationId, applicantId: input.applicantId, applicantType: input.applicantType, sources: Object.fromEntries(required.map((type) => [type, input.sources[type]])), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  return output([], { verification: { ...body, checksumSha256: hash(body), status: "verified" } });
}

export function calculateHouseholdIndebtedness(input) {
  const findings = [];
  if (!input?.householdId || !input?.bureauEvidenceRef || !input?.mfiEvidenceRef || !exact(input?.monthlyHouseholdIncomePaise, false) || !exact(input?.proposedEmiPaise)) findings.push(finding("Household income, proposed EMI, bureau, and MFI evidence are required in exact paise.", "household"));
  if (!Array.isArray(input?.obligationsPaise) || input.obligationsPaise.some((v) => !exact(v))) findings.push(finding("Every household obligation must be exact non-negative paise.", "obligations"));
  if (findings.length) return output(findings, { assessment: null });
  const existingObligationsPaise = input.obligationsPaise.reduce((s, v) => s + v, 0); const totalObligationsPaise = existingObligationsPaise + input.proposedEmiPaise; const foirBps = Math.floor((totalObligationsPaise * 10000) / input.monthlyHouseholdIncomePaise); const mfiIndebtednessPaise = input.mfiIndebtednessPaise ?? 0;
  if (!exact(mfiIndebtednessPaise)) return output([finding("MFI indebtedness must be exact non-negative paise.", "mfiIndebtednessPaise")], { assessment: null });
  const outcome = foirBps <= input.maxFoirBps && mfiIndebtednessPaise + input.proposedPrincipalPaise <= input.maxMfiIndebtednessPaise ? "eligible" : "refer";
  const body = { householdId: input.householdId, monthlyHouseholdIncomePaise: input.monthlyHouseholdIncomePaise, existingObligationsPaise, proposedEmiPaise: input.proposedEmiPaise, totalObligationsPaise, foirBps, mfiIndebtednessPaise, bureauEvidenceRef: input.bureauEvidenceRef, mfiEvidenceRef: input.mfiEvidenceRef, outcome };
  return output([], { assessment: { ...body, checksumSha256: hash(body) } });
}

export function assignRiskGradeAndPrice(input) {
  const findings = [];
  if (!input?.pricingPolicyRef || !input?.scoreEvidenceRef || !Number.isSafeInteger(input?.score) || !Array.isArray(input?.bands) || !input.bands.length || !exact(input?.principalPaise, false)) findings.push(finding("Score evidence, policy, bands, and exact principal are required.", "pricing"));
  const bands = [...(input?.bands ?? [])].sort((a, b) => b.minScore - a.minScore); const band = bands.find((b) => input.score >= b.minScore && Number.isSafeInteger(b.annualRateBps) && b.grade);
  if (!band) findings.push(finding("Score does not map to an approved deterministic pricing band.", "score"));
  if (!approval(input)) findings.push(finding("Independent risk-pricing approval is required.", "approval"));
  if (findings.length) return output(findings, { pricing: null });
  const body = { pricingPolicyRef: input.pricingPolicyRef, scoreEvidenceRef: input.scoreEvidenceRef, score: input.score, rating: band.rating ?? band.grade, grade: band.grade, annualRateBps: band.annualRateBps, principalPaise: input.principalPaise, annualInterestPaise: Math.floor((input.principalPaise * band.annualRateBps) / 10000), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef };
  return output([], { pricing: { ...body, checksumSha256: hash(body), outcome: "priced" } });
}
