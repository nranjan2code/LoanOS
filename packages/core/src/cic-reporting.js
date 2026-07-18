/**
 * Credit Information Company (CIC) reporting: builds the canonical UCRF
 * (Uniform Credit Reporting Format) record for a loan account (RBI Credit
 * Information Reporting 2025), batches records into a fortnightly
 * submission cycle (15th or calendar month-end only —
 * `deriveCicReportingPeriod`), and tracks the batch through submission,
 * CIC acknowledgement (accepted/rejected/partially rejected), resubmission
 * of rejected records, and the separate borrower-initiated correction-
 * request lifecycle. This module does not compute the account's actual
 * balances/DPD/asset-classification itself — it calls
 * `generateCicSnapshot` (`loan-account.js`) and reshapes that snapshot into
 * the CIC's field-per-field schema.
 *
 * Any record reporting a positive `daysPastDue` requires evidenced
 * customer default-alert notification (SMS/email) before the batch can
 * actually be submitted (`submitCicBatch` fails closed otherwise) — RBI
 * requires borrowers be told before their default is reported. A
 * resubmission (`createCicResubmission`) may only correct records that
 * were actually rejected, and cannot change a record's identity (segment,
 * account, member, cycle) — only the erroneous fields. Borrower correction
 * requests carry their own SLA clock: 21 days for the institution, 30 days
 * overall, accruing a per-day rupee compensation once the overall deadline
 * is breached (`enrichCicCorrection`).
 */
import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { generateCicSnapshot } from "./loan-account.js";
import { createLoanId } from "./loan-policy.js";

export const CIC_REPORTING_PROFILE = "rbi-credit-information-reporting-2025-11-28";
export const CIC_SEGMENTS = Object.freeze({ CONSUMER: "consumer", COMMERCIAL: "commercial" });
export const CIC_BATCH_STATUSES = Object.freeze({
  READY: "ready",
  SUBMITTED: "submitted",
  ACCEPTED: "accepted",
  PARTIALLY_REJECTED: "partially_rejected",
  REJECTED: "rejected"
});
export const CIC_CORRECTION_STATUSES = Object.freeze({ OPEN: "open", ACCEPTED: "accepted", REJECTED: "rejected" });

const CIC_NAMES = new Set(["crif_high_mark", "equifax", "experian", "transunion_cibil"]);
const RE_TYPES = new Set(["bank", "commercial_bank", "nbfc", "hfc", "cooperative_bank", "aifi", "arc"]);

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function isMonthEnd(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  const next = new Date(parsed);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCMonth() !== parsed.getUTCMonth();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function money(value) {
  if (!Number.isFinite(value)) return null;
  return (Math.round(value * 100) / 100).toFixed(2);
}

function clean(value) {
  return value === undefined ? null : value;
}

/**
 * Determine whether a candidate date is a valid CIC reporting cycle date
 * (must be the 15th of the month or the calendar month-end) and, if so,
 * the fortnightly submission due date (cycle date + 7 days).
 * @param {string|Date} cycleDateInput
 * @returns {{cycleDate: string, frequency: "fortnightly", submissionDueDate: string}|null} null if the date isn't a valid cycle date.
 */
export function deriveCicReportingPeriod(cycleDateInput) {
  const cycleDate = isoDate(cycleDateInput);
  if (!cycleDate) return null;
  const day = Number(cycleDate.slice(8, 10));
  if (day !== 15 && !isMonthEnd(cycleDate)) return null;
  return { cycleDate, frequency: "fortnightly", submissionDueDate: addDays(cycleDate, 7) };
}

function required(findings, value, path, message) {
  if (value === null || value === undefined || value === "") {
    findings.push(createFinding("error", "RBI-CIR-2025", message, path));
  }
}

/**
 * Build one canonical UCRF record (consumer or commercial schema, per
 * `borrower.borrowerType`) for a loan account at a given cycle date. Fails
 * closed unless the cycle date is valid, the account/borrower/CIC-member
 * identifiers are present, and the segment-specific identity/address
 * fields (name+DOB+identity for consumer; legal name+constitution+PAN for
 * commercial) are all present. Numeric fields are shaped through `money()`
 * (fixed 2-decimal string) to match the CIC's exact reporting format.
 * @param {object} account - loan account.
 * @param {object} borrower - borrower profile.
 * @param {{memberCode: string, memberName: string}} member - reporting CIC member identity.
 * @param {string|Date} cycleDateInput
 * @returns {{record: object|null, findings: Array<object>, summary: object}}
 */
export function buildCicUcrfRecord(account, borrower, member, cycleDateInput) {
  const findings = [];
  const period = deriveCicReportingPeriod(cycleDateInput);
  if (!period) findings.push(createFinding("error", "RBI-CIR-2025", "Cycle date must be the 15th or calendar month-end.", "cycleDate"));
  required(findings, account?.loanAccountId, "loanAccountId", "Loan account is required.");
  required(findings, borrower?.borrowerId, "borrowerId", "Borrower profile is required.");
  required(findings, member?.memberCode, "member.memberCode", "CIC member code is required.");
  required(findings, member?.memberName, "member.memberName", "CIC member name is required.");
  const reporting = borrower?.creditReporting ?? {};
  const segment = borrower?.borrowerType === "individual" ? CIC_SEGMENTS.CONSUMER : CIC_SEGMENTS.COMMERCIAL;
  const snapshot = account && period ? generateCicSnapshot(account, new Date(`${period.cycleDate}T23:59:59.999Z`)) : null;
  const identity = reporting.identity ?? {};
  const address = reporting.address ?? {};

  if (segment === CIC_SEGMENTS.CONSUMER) {
    required(findings, borrower?.fullName, "borrower.fullName", "Consumer full name is required.");
    required(findings, borrower?.dateOfBirth, "borrower.dateOfBirth", "Consumer date of birth is required.");
    required(findings, identity.type, "creditReporting.identity.type", "Consumer identity type is required.");
    required(findings, identity.number, "creditReporting.identity.number", "Consumer identity number is required.");
  } else {
    required(findings, borrower?.legalName, "borrower.legalName", "Commercial legal name is required.");
    required(findings, reporting.legalConstitution, "creditReporting.legalConstitution", "Commercial legal constitution is required.");
    required(findings, identity.pan, "creditReporting.identity.pan", "Commercial PAN is required.");
  }
  required(findings, address.line1 ?? borrower?.primaryAddress, "creditReporting.address.line1", "Primary address is required.");
  required(findings, address.stateCode, "creditReporting.address.stateCode", "State code is required.");
  required(findings, address.pinCode, "creditReporting.address.pinCode", "PIN code is required.");

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { record: null, findings, summary };
  const common = {
    memberCode: member.memberCode,
    memberName: member.memberName,
    cycleDate: period.cycleDate,
    accountNumber: account.loanAccountId,
    accountType: account.facilityType ?? "term_loan",
    ownershipIndicator: reporting.ownershipIndicator ?? "individual",
    dateOpenedOrDisbursed: isoDate(account.disbursedAt ?? account.openedAt),
    dateClosed: isoDate(account.closedAt),
    dateReportedAndCertified: period.cycleDate,
    sanctionedAmount: money(snapshot.sanctionedAmount),
    currentBalance: money(snapshot.currentBalance),
    amountOverdue: money(snapshot.amountOverdue),
    daysPastDue: String(snapshot.daysPastDue),
    assetClassification: snapshot.assetClass,
    lastPaymentDate: isoDate(snapshot.lastPaymentDate),
    writtenOffAmount: money(snapshot.writeOffAmount),
    settlementAmount: money(snapshot.settlementSacrifice),
    facilityStatus: snapshot.accountStatus,
    currency: snapshot.currency ?? "INR"
  };
  const data = segment === CIC_SEGMENTS.CONSUMER
    ? {
        ...common,
        name: borrower.fullName,
        dateOfBirth: borrower.dateOfBirth,
        gender: clean(reporting.gender),
        identificationType: identity.type,
        identificationNumber: identity.number,
        telephoneNumber: borrower.contact?.mobile ?? null,
        email: borrower.contact?.email ?? null,
        addressLine1: address.line1 ?? borrower.primaryAddress,
        stateCode: address.stateCode,
        pinCode: address.pinCode,
        residenceCode: address.residenceCode ?? null,
        occupationCode: reporting.occupationCode ?? borrower.economicProfile?.occupation ?? null,
        income: money(borrower.economicProfile?.monthlyIncome),
        incomeFrequency: "monthly",
        interestRate: account.annualInterestRateBps ? money(account.annualInterestRateBps / 100) : null,
        repaymentTenure: account.tenorMonths ?? null,
        emiAmount: money(account.schedule?.[0]?.totalDue),
        paymentFrequency: account.repaymentFrequency ?? "monthly"
      }
    : {
        ...common,
        borrowerName: borrower.legalName,
        borrowerShortName: reporting.shortName ?? null,
        legalConstitution: reporting.legalConstitution,
        pan: identity.pan,
        cin: identity.cin ?? null,
        udyamNumber: identity.udyamNumber ?? null,
        dateOfIncorporation: reporting.dateOfIncorporation ?? null,
        businessCategory: reporting.businessCategory ?? null,
        industryType: reporting.industryType ?? null,
        addressLine1: address.line1 ?? borrower.primaryAddress,
        stateCode: address.stateCode,
        pinCode: address.pinCode,
        creditType: account.facilityType ?? "term_loan",
        drawingPower: money(snapshot.facilitySnapshot?.drawingPower),
        creditLimit: money(snapshot.facilitySnapshot?.creditLimit),
        highCredit: money(snapshot.sanctionedAmount),
        repaymentFrequency: account.repaymentFrequency ?? "monthly",
        restructuringReason: account.restructures?.at(-1)?.reason ?? null,
        securities: Array.isArray(reporting.securities) ? reporting.securities : [],
        guarantors: Array.isArray(reporting.guarantors) ? reporting.guarantors : [],
        relatedParties: Array.isArray(reporting.relatedParties) ? reporting.relatedParties : []
      };
  const recordId = `cicrec_${sha256(`${segment}|${account.loanAccountId}|${period.cycleDate}`).slice(0, 24)}`;
  return { record: { recordId, segment, schema: `ucrf.${segment}.canonical.v1`, data }, findings, summary };
}

/**
 * Build a `"ready"` submission batch: one UCRF record per in-scope loan
 * account for the cycle, plus a default-alert placeholder for any record
 * reporting a positive DPD. Idempotent on `batchId`. Fails closed unless
 * the cycle date is valid and not in the future, the CIC and regulated-
 * entity type are recognized, and independent maker-checker approval is
 * present.
 * @param {Record<string, object>} registry - batchId -> batch record.
 * @param {{loanAccounts?: object, borrowerProfiles?: object}} context
 * @param {object} input - batchId, cycleDate, cic, regulatedEntityType, regulatedEntityId, member, proposedBy, approvedBy, approvalRef.
 * @param {Date} [now]
 * @returns {{registry: object, batch: object|null, findings: Array<object>, summary: object, idempotent: boolean}}
 */
export function createCicSubmissionBatch(registry = {}, context = {}, input = {}, now = new Date()) {
  const findings = [];
  const period = deriveCicReportingPeriod(input.cycleDate);
  if (!period) findings.push(createFinding("error", "RBI-CIR-2025", "cycleDate must be the 15th or calendar month-end.", "cycleDate"));
  if (period && period.cycleDate > isoDate(now)) findings.push(createFinding("error", "RBI-CIR-2025", "A CIC batch cannot certify a future reporting cycle.", "cycleDate"));
  if (!CIC_NAMES.has(input.cic)) findings.push(createFinding("error", "RBI-CIR-2025", "A supported CIC is required.", "cic"));
  if (!RE_TYPES.has(input.regulatedEntityType)) findings.push(createFinding("error", "RBI-CIR-2025", "A supported regulated entity reporting profile is required.", "regulatedEntityType"));
  required(findings, input.regulatedEntityId, "regulatedEntityId", "Regulated entity ID is required.");
  if (!input.proposedBy || !input.approvedBy || input.proposedBy === input.approvedBy || !input.approvalRef) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Independent maker-checker approval and approvalRef are required.", "approval"));
  }
  const batchId = input.batchId ?? createLoanId("cicbatch");
  if (registry[batchId]) return { registry, batch: registry[batchId], findings: [], summary: summarizeFindings([]), idempotent: true };
  const accounts = Object.values(context.loanAccounts ?? {}).filter((account) => !input.regulatedEntityId || account.regulatedEntityId === input.regulatedEntityId);
  if (accounts.length === 0) findings.push(createFinding("error", "RBI-CIR-2025", "At least one in-scope loan account is required.", "loanAccounts"));
  const records = [];
  if (period) for (const account of accounts.sort((a, b) => a.loanAccountId.localeCompare(b.loanAccountId))) {
    const result = buildCicUcrfRecord(account, context.borrowerProfiles?.[account.borrowerId], input.member, period.cycleDate);
    findings.push(...result.findings);
    if (result.record) records.push(result.record);
  }
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { registry, batch: null, findings, summary, idempotent: false };
  const fileContent = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  const alerts = records.filter((record) => Number(record.data.daysPastDue) > 0).map((record) => ({ recordId: record.recordId, borrowerId: context.loanAccounts[record.data.accountNumber]?.borrowerId ?? null, status: "pending", requiredReason: "default_or_dpd_reported" }));
  const batch = {
    batchId,
    profileVersion: CIC_REPORTING_PROFILE,
    regulatedEntityId: input.regulatedEntityId,
    regulatedEntityType: input.regulatedEntityType,
    cic: input.cic,
    member: input.member,
    cycleDate: period.cycleDate,
    submissionDueDate: period.submissionDueDate,
    status: CIC_BATCH_STATUSES.READY,
    mediaType: "application/x-loanos-ucrf+jsonl",
    recordCount: records.length,
    records,
    fileContent,
    checksumSha256: sha256(fileContent),
    customerDefaultAlerts: alerts,
    parentBatchId: input.parentBatchId ?? null,
    proposedBy: input.proposedBy,
    approvedBy: input.approvedBy,
    approvalRef: input.approvalRef,
    createdAt: now.toISOString(),
    events: [{ type: "cic.batch.created", at: now.toISOString(), actor: input.approvedBy }]
  };
  return { registry: { ...registry, [batchId]: batch }, batch, findings, summary, idempotent: false };
}

/**
 * Submit a `"ready"` batch to the CIC. Fails closed unless: transport
 * evidence (provider submission ref, transmitter, transport evidence ref)
 * is present, and every record flagged for a customer default alert has
 * matching evidenced delivery (SMS/email, with a delivery ref and time) —
 * a batch cannot go out reporting a default the borrower wasn't told
 * about. Flags `lateSubmission` if submitted after the cycle's due date,
 * without blocking it.
 * @param {Record<string, object>} registry - batchId -> batch record.
 * @param {string} batchId
 * @param {object} input - providerSubmissionRef, transmittedBy, transportEvidenceRef, customerAlertEvidence.
 * @param {Date} [now]
 * @returns {{registry: object, batch: object, findings: Array<object>, summary: object}}
 */
export function submitCicBatch(registry = {}, batchId, input = {}, now = new Date()) {
  const batch = registry[batchId];
  const findings = [];
  if (!batch) findings.push(createFinding("error", "RBI-CIR-2025", "CIC batch was not found.", "batchId"));
  if (batch && batch.status !== CIC_BATCH_STATUSES.READY) findings.push(createFinding("error", "RBI-CIR-2025", "Only a ready batch can be submitted.", "status"));
  if (!input.providerSubmissionRef || !input.transmittedBy || !input.transportEvidenceRef) findings.push(createFinding("error", "RBI-CIR-2025", "Provider submission reference, actor, and transport evidence are required.", "submission"));
  const requiredAlerts = batch?.customerDefaultAlerts ?? [];
  const evidence = input.customerAlertEvidence ?? [];
  for (const alert of requiredAlerts) {
    const match = evidence.find((item) => item.recordId === alert.recordId && item.deliveryRef && item.deliveredAt && ["sms", "email"].includes(item.channel));
    if (!match) findings.push(createFinding("error", "RBI-CIR-2025", `Default reporting alert evidence is required for ${alert.recordId}.`, "customerAlertEvidence"));
  }
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { registry, batch, findings, summary };
  const submitted = { ...batch, status: CIC_BATCH_STATUSES.SUBMITTED, submittedAt: now.toISOString(), providerSubmissionRef: input.providerSubmissionRef, transportEvidenceRef: input.transportEvidenceRef, customerDefaultAlerts: requiredAlerts.map((alert) => ({ ...alert, status: "delivered", ...evidence.find((item) => item.recordId === alert.recordId) })), lateSubmission: isoDate(now) > batch.submissionDueDate, events: [...batch.events, { type: "cic.batch.submitted", at: now.toISOString(), actor: input.transmittedBy, providerSubmissionRef: input.providerSubmissionRef }] };
  return { registry: { ...registry, [batchId]: submitted }, batch: submitted, findings, summary };
}

/**
 * Apply the CIC's acknowledgement to a `"submitted"` batch. Fails closed
 * unless `recordResults` contains exactly one valid, uniquely-keyed result
 * per record in the batch, and every `"rejected"` result carries a reject
 * code and message. The batch's overall status becomes `"accepted"`
 * (no rejects), `"rejected"` (all rejected), or `"partially_rejected"`
 * (mixed); any rejects open a 7-day repair window (`repairDueDate`).
 * @param {Record<string, object>} registry - batchId -> batch record.
 * @param {string} batchId
 * @param {object} input - acknowledgementRef, receivedBy, recordResults.
 * @param {Date} [now]
 * @returns {{registry: object, batch: object, findings: Array<object>, summary: object}}
 */
export function acknowledgeCicBatch(registry = {}, batchId, input = {}, now = new Date()) {
  const batch = registry[batchId];
  const findings = [];
  if (!batch || batch.status !== CIC_BATCH_STATUSES.SUBMITTED) findings.push(createFinding("error", "RBI-CIR-2025", "A submitted CIC batch is required.", "batchId"));
  if (!input.acknowledgementRef || !input.receivedBy) findings.push(createFinding("error", "RBI-CIR-2025", "Acknowledgement reference and receiving actor are required.", "acknowledgement"));
  const results = Array.isArray(input.recordResults) ? input.recordResults : [];
  if (batch && (results.length !== batch.records.length || new Set(results.map((item) => item.recordId)).size !== batch.records.length || results.some((item) => !batch.records.some((record) => record.recordId === item.recordId) || !["accepted", "rejected"].includes(item.status) || (item.status === "rejected" && (!item.rejectCode || !item.rejectMessage))))) {
    findings.push(createFinding("error", "RBI-CIR-2025", "Acknowledgement must contain exactly one valid result for every record; rejects require code and message.", "recordResults"));
  }
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { registry, batch, findings, summary };
  const rejected = results.filter((item) => item.status === "rejected");
  const status = rejected.length === 0 ? CIC_BATCH_STATUSES.ACCEPTED : rejected.length === results.length ? CIC_BATCH_STATUSES.REJECTED : CIC_BATCH_STATUSES.PARTIALLY_REJECTED;
  const acknowledged = { ...batch, status, acknowledgementRef: input.acknowledgementRef, acknowledgedAt: now.toISOString(), repairDueDate: rejected.length ? addDays(isoDate(now), 7) : null, recordResults: results, events: [...batch.events, { type: "cic.batch.acknowledged", at: now.toISOString(), actor: input.receivedBy, acknowledgementRef: input.acknowledgementRef, rejectedCount: rejected.length }] };
  return { registry: { ...registry, [batchId]: acknowledged }, batch: acknowledged, findings, summary };
}

/**
 * Create a repair batch containing corrected versions of a rejected/
 * partially-rejected source batch's rejected records. Idempotent on
 * `batchId`. Fails closed unless: independent repair approval and source-
 * correction evidence are present, every rejected record (and only those)
 * is corrected exactly once, and each correction preserves the original
 * record's identity (schema/segment/account/member/cycle) and every
 * canonical required field — a repair can fix the erroneous values, not
 * relabel which record/account/cycle is being reported.
 * @param {Record<string, object>} registry - batchId -> batch record.
 * @param {string} sourceBatchId - must reference a rejected/partially-rejected batch.
 * @param {object} input - batchId, proposedBy, approvedBy, approvalRef, correctionEvidenceRef, correctedRecords.
 * @param {Date} [now]
 * @returns {{registry: object, batch: object|null, findings: Array<object>, summary: object, idempotent: boolean}}
 */
export function createCicResubmission(registry = {}, sourceBatchId, input = {}, now = new Date()) {
  const source = registry[sourceBatchId];
  const findings = [];
  if (!source || ![CIC_BATCH_STATUSES.REJECTED, CIC_BATCH_STATUSES.PARTIALLY_REJECTED].includes(source.status)) findings.push(createFinding("error", "RBI-CIR-2025", "A rejected or partially rejected source batch is required.", "sourceBatchId"));
  if (!input.proposedBy || !input.approvedBy || input.proposedBy === input.approvedBy || !input.approvalRef || !input.correctionEvidenceRef) findings.push(createFinding("error", "RBI-IT-GRC", "Independent repair approval, approvalRef, and source correction evidence are required.", "approval"));
  const rejectedIds = new Set((source?.recordResults ?? []).filter((item) => item.status === "rejected").map((item) => item.recordId));
  const corrections = Array.isArray(input.correctedRecords) ? input.correctedRecords : [];
  if (source && (corrections.length !== rejectedIds.size || corrections.some((record) => !rejectedIds.has(record.recordId)))) findings.push(createFinding("error", "RBI-CIR-2025", "Every rejected record must be corrected exactly once.", "correctedRecords"));
  for (const corrected of corrections) {
    const original = source?.records?.find((record) => record.recordId === corrected.recordId);
    if (!original || corrected.schema !== original.schema || corrected.segment !== original.segment || corrected.data?.accountNumber !== original.data?.accountNumber || corrected.data?.memberCode !== original.data?.memberCode || corrected.data?.cycleDate !== original.data?.cycleDate) {
      findings.push(createFinding("error", "RBI-CIR-2025", "Repair cannot change record identity, segment, member, account, or reporting cycle.", "correctedRecords"));
      continue;
    }
    const identityComplete = corrected.segment === CIC_SEGMENTS.CONSUMER
      ? corrected.data?.name && corrected.data?.dateOfBirth && corrected.data?.identificationType && corrected.data?.identificationNumber
      : corrected.data?.borrowerName && corrected.data?.legalConstitution && corrected.data?.pan;
    if (!identityComplete || !corrected.data?.addressLine1 || !corrected.data?.stateCode || !corrected.data?.pinCode || corrected.data?.currentBalance === null || corrected.data?.amountOverdue === null || corrected.data?.daysPastDue === null) {
      findings.push(createFinding("error", "RBI-CIR-2025", "Corrected record must retain all canonical required identity, address, and account fields.", "correctedRecords"));
    }
  }
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { registry, batch: null, findings, summary };
  const records = corrections.sort((a, b) => a.recordId.localeCompare(b.recordId));
  const fileContent = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  const batchId = input.batchId ?? createLoanId("cicbatch");
  if (registry[batchId]) return { registry, batch: registry[batchId], findings: [], summary: summarizeFindings([]), idempotent: true };
  const batch = { ...source, batchId, parentBatchId: sourceBatchId, status: CIC_BATCH_STATUSES.READY, recordCount: records.length, records, fileContent, checksumSha256: sha256(fileContent), customerDefaultAlerts: source.customerDefaultAlerts.filter((alert) => rejectedIds.has(alert.recordId)).map((alert) => ({ ...alert, status: "pending" })), providerSubmissionRef: null, transportEvidenceRef: null, submittedAt: null, acknowledgementRef: null, acknowledgedAt: null, recordResults: null, repairDueDate: source.repairDueDate, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, correctionEvidenceRef: input.correctionEvidenceRef, createdAt: now.toISOString(), events: [{ type: "cic.batch.resubmission_created", at: now.toISOString(), actor: input.approvedBy, sourceBatchId }] };
  return { registry: { ...registry, [batchId]: batch }, batch, findings, summary, idempotent: false };
}

/**
 * Open a borrower-initiated correction request against a previously
 * reported field. Idempotent on `correctionId`. Fails closed unless the
 * borrower and loan account exist and actually match, and all correction
 * fields (fieldPath, reportedValue, requestedValue, reason, submittedBy,
 * sourceReportRef) are present. Sets the 21-day institution and 30-day
 * overall SLA due dates and a fixed compensation rate at open time.
 * @param {Record<string, object>} registry - correctionId -> correction record.
 * @param {{borrowerProfiles?: object, loanAccounts?: object}} context
 * @param {object} input - correctionId, borrowerId, loanAccountId, fieldPath, reportedValue, requestedValue, reason, sourceReportRef, submittedBy.
 * @param {Date} [now]
 * @returns {{registry: object, correction: object|null, findings: Array<object>, summary: object, idempotent: boolean}}
 */
export function createCicCorrectionRequest(registry = {}, context = {}, input = {}, now = new Date()) {
  const findings = [];
  if (!context.borrowerProfiles?.[input.borrowerId]) findings.push(createFinding("error", "RBI-CIR-2025", "Borrower was not found.", "borrowerId"));
  if (!context.loanAccounts?.[input.loanAccountId] || context.loanAccounts?.[input.loanAccountId]?.borrowerId !== input.borrowerId) findings.push(createFinding("error", "RBI-CIR-2025", "Loan account does not belong to the borrower.", "loanAccountId"));
  for (const field of ["fieldPath", "reportedValue", "requestedValue", "reason", "submittedBy", "sourceReportRef"]) required(findings, input[field], field, `${field} is required.`);
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { registry, correction: null, findings, summary };
  const correctionId = input.correctionId ?? createLoanId("ciccor");
  if (registry[correctionId]) return { registry, correction: registry[correctionId], findings: [], summary: summarizeFindings([]), idempotent: true };
  const opened = isoDate(now);
  const correction = { correctionId, borrowerId: input.borrowerId, loanAccountId: input.loanAccountId, fieldPath: input.fieldPath, reportedValue: input.reportedValue, requestedValue: input.requestedValue, reason: input.reason, sourceReportRef: input.sourceReportRef, status: CIC_CORRECTION_STATUSES.OPEN, submittedBy: input.submittedBy, openedAt: now.toISOString(), institutionDueDate: addDays(opened, 21), overallDueDate: addDays(opened, 30), compensationPerDayRupees: 100, events: [{ type: "cic.correction.opened", at: now.toISOString(), actor: input.submittedBy }] };
  return { registry: { ...registry, [correctionId]: correction }, correction, findings, summary, idempotent: false };
}

/**
 * Resolve an open correction request as accepted or rejected. Requires an
 * independent resolver/approver and a decision reason; an `"accepted"`
 * decision additionally requires source-correction evidence and a valid
 * next reporting cycle date to actually push the fix. Computes
 * `compensationDueRupees` from however many days past `overallDueDate` the
 * resolution landed (0 if resolved on time).
 * @param {Record<string, object>} registry - correctionId -> correction record.
 * @param {string} correctionId
 * @param {object} input - resolvedBy, approvedBy, decision, decisionReason, sourceCorrectionRef, nextReportingCycleDate.
 * @param {Date} [now]
 * @returns {{registry: object, correction: object, findings: Array<object>, summary: object}}
 */
export function resolveCicCorrectionRequest(registry = {}, correctionId, input = {}, now = new Date()) {
  const correction = registry[correctionId];
  const findings = [];
  if (!correction || correction.status !== CIC_CORRECTION_STATUSES.OPEN) findings.push(createFinding("error", "RBI-CIR-2025", "An open CIC correction request is required.", "correctionId"));
  if (!input.resolvedBy || !input.approvedBy || input.resolvedBy === input.approvedBy || !input.decisionReason || !["accepted", "rejected"].includes(input.decision)) findings.push(createFinding("error", "RBI-IT-GRC", "Valid decision, reason, and independent resolver/approver are required.", "resolution"));
  if (input.decision === "accepted" && (!input.sourceCorrectionRef || !input.nextReportingCycleDate || !deriveCicReportingPeriod(input.nextReportingCycleDate))) findings.push(createFinding("error", "RBI-CIR-2025", "Accepted correction requires source correction evidence and a valid next reporting cycle.", "sourceCorrectionRef"));
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { registry, correction, findings, summary };
  const daysLate = Math.max(0, Math.ceil((now.getTime() - new Date(`${correction.overallDueDate}T23:59:59.999Z`).getTime()) / 86400000));
  const resolved = { ...correction, status: input.decision, decisionReason: input.decisionReason, sourceCorrectionRef: input.sourceCorrectionRef ?? null, nextReportingCycleDate: input.nextReportingCycleDate ?? null, resolvedBy: input.resolvedBy, approvedBy: input.approvedBy, resolvedAt: now.toISOString(), compensationDueRupees: daysLate * correction.compensationPerDayRupees, events: [...correction.events, { type: `cic.correction.${input.decision}`, at: now.toISOString(), actor: input.approvedBy }] };
  return { registry: { ...registry, [correctionId]: resolved }, correction: resolved, findings, summary };
}

/**
 * Derive read-only SLA status on an open correction: whether the
 * institution's 21-day internal deadline or the overall 30-day deadline
 * has been breached, and the compensation accrued so far if it has.
 * @param {object} correction
 * @param {Date} [asOf]
 * @returns {object|null} the correction with `institutionSlaBreached`/`overallSlaBreached`/`accruedCompensationRupees` added, or null if none given.
 */
export function enrichCicCorrection(correction, asOf = new Date()) {
  if (!correction) return null;
  const open = correction.status === CIC_CORRECTION_STATUSES.OPEN;
  const daysLate = open ? Math.max(0, Math.ceil((asOf.getTime() - new Date(`${correction.overallDueDate}T23:59:59.999Z`).getTime()) / 86400000)) : 0;
  return { ...correction, institutionSlaBreached: open && isoDate(asOf) > correction.institutionDueDate, overallSlaBreached: daysLate > 0, accruedCompensationRupees: daysLate * correction.compensationPerDayRupees };
}
