import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "../lending/loan-policy.js";
import { createHash } from "node:crypto";

// Under PMLA 2002 (Prevention of Money Laundering Act), PML Rules, and RBI
// Master Direction on KYC/AML/CFT, regulated entities must file Suspicious
// Transaction Reports (STRs), Cash Transaction Reports (CTRs), and Counterfeit
// Currency Reports (CCRs) with FIU-IND (Financial Intelligence Unit – India).
//
// Key rules:
// - STRs must be filed within 7 days of suspicion arising.
// - CTRs must be filed monthly for transactions ≥ ₹10 lakh.
// - Tipping-off is prohibited: the subject must not be informed of the STR.
// - The designated Principal Officer reviews and approves STRs before filing.

export const REPORT_TYPES = {
  SUSPICIOUS_TRANSACTION: "suspicious_transaction",
  CASH_TRANSACTION: "cash_transaction",
  COUNTERFEIT_CURRENCY: "counterfeit_currency"
};

export const REPORT_STATUSES = {
  DRAFT: "draft",
  REVIEWED: "reviewed",
  FILED: "filed",
  ACKNOWLEDGED: "acknowledged",
  REJECTED: "rejected"
};

export const FINNET_XML_PROFILE = "fiu-ind-finnet-canonical-2.0";
export const FINNET_REPORTING_FORMATS = { ACCOUNT_BASED: "ARF", TRANSACTION_BASED: "TRF", COUNTERFEIT_CURRENCY: "CRF" };

export const CTR_THRESHOLD_INR = 1000000; // ₹10 lakh
const VALID_REPORT_TYPES = new Set(Object.values(REPORT_TYPES));
const TERMINAL_STATUSES = new Set([REPORT_STATUSES.ACKNOWLEDGED]);
const STR_FILING_DEADLINE_DAYS = 7;

// --- STR/CTR creation ---

export function createFiuReport(registry = {}, input = {}, context = {}, now = new Date()) {
  const report = normalizeReport(input, {}, now);
  const findings = [];

  if (!report.reportType || !VALID_REPORT_TYPES.has(report.reportType)) {
    findings.push(createFinding("error", "PMLA-2002", `Report type must be one of: ${[...VALID_REPORT_TYPES].join(", ")}.`, "reportType"));
  }
  if (!report.regulatedEntityId) {
    findings.push(createFinding("error", "PMLA-2002", "FIU report requires a regulatedEntityId.", "regulatedEntityId"));
  }
  if (!report.subjectBorrowerId) {
    findings.push(createFinding("error", "PMLA-2002", "FIU report requires a subjectBorrowerId.", "subjectBorrowerId"));
  }
  if (!report.createdBy) {
    findings.push(createFinding("error", "PMLA-2002", "FIU report requires createdBy.", "createdBy"));
  }

  // STR-specific validations
  if (report.reportType === REPORT_TYPES.SUSPICIOUS_TRANSACTION) {
    if (!report.suspicionGrounds) {
      findings.push(createFinding("error", "PMLA-2002", "STR requires suspicionGrounds.", "suspicionGrounds"));
    }
    if (!report.transactionDetails || !Array.isArray(report.transactionDetails) || report.transactionDetails.length === 0) {
      findings.push(createFinding("error", "PMLA-2002", "STR requires at least one transaction detail.", "transactionDetails"));
    }
  }

  // CTR-specific validations
  if (report.reportType === REPORT_TYPES.CASH_TRANSACTION) {
    if (typeof report.totalAmountInr !== "number" || report.totalAmountInr < CTR_THRESHOLD_INR) {
      findings.push(
        createFinding(
          "error",
          "PMLA-2002",
          `Cash Transaction Report requires totalAmountInr ≥ ₹${(CTR_THRESHOLD_INR / 100000).toFixed(0)} lakh (${CTR_THRESHOLD_INR}).`,
          "totalAmountInr"
        )
      );
    }
  }

  // Validate RE exists
  if (report.regulatedEntityId && context.regulatedEntities && !context.regulatedEntities[report.regulatedEntityId]) {
    findings.push(createFinding("error", "PMLA-2002", "Regulated entity not found.", "regulatedEntityId"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { registry, report, findings, summary };
  }

  const eventType = report.reportType === REPORT_TYPES.CASH_TRANSACTION ? "fiu.ctr.created" : report.reportType === REPORT_TYPES.COUNTERFEIT_CURRENCY ? "fiu.ccr.created" : "fiu.str.created";
  const event = fiuEvent(eventType, {
    reportId: report.reportId,
    reportType: report.reportType,
    subjectBorrowerId: report.subjectBorrowerId,
    actor: report.createdBy
  }, now);
  const stored = { ...report, events: [event], updatedAt: now.toISOString() };

  return {
    registry: { ...registry, [stored.reportId]: stored },
    report: enrichFiuReport(stored, now),
    event,
    findings: [],
    summary: summarizeFindings([])
  };
}

// --- Principal Officer review ---

export function reviewFiuReport(report, input = {}, context = {}, now = new Date()) {
  const findings = [];
  if (!report) {
    findings.push(createFinding("error", "PMLA-2002", "FIU report is required.", "reportId"));
    return blockedResult(report, findings, now);
  }
  if (report.status !== REPORT_STATUSES.DRAFT) {
    findings.push(createFinding("error", "PMLA-2002", "Only draft reports can be reviewed.", "status"));
  }
  if (!input.actor) {
    findings.push(createFinding("error", "PMLA-2002", "Review requires an actor.", "actor"));
  }
  if (!input.actorRole || input.actorRole !== "principal_officer") {
    findings.push(createFinding("error", "PMLA-2002", "STR review must be performed by a designated Principal Officer.", "actorRole"));
  }
  if (input.reviewNotes === undefined || input.reviewNotes === null || input.reviewNotes === "") {
    findings.push(createFinding("error", "PMLA-2002", "Review requires reviewNotes.", "reviewNotes"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedResult(report, findings, now);
  }

  const event = fiuEvent("fiu.str.reviewed", {
    reportId: report.reportId,
    actor: input.actor,
    actorRole: input.actorRole
  }, now);
  const updated = {
    ...report,
    status: REPORT_STATUSES.REVIEWED,
    reviewedAt: now.toISOString(),
    reviewedBy: input.actor,
    reviewNotes: input.reviewNotes,
    events: [...(report.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyResult(updated, event, now);
}

// --- Filing with FIU-IND ---

export function fileFiuReport(report, input = {}, context = {}, now = new Date()) {
  const findings = [];
  if (!report) {
    findings.push(createFinding("error", "PMLA-2002", "FIU report is required.", "reportId"));
    return blockedResult(report, findings, now);
  }
  // STRs must be reviewed before filing; CTRs can be filed directly from draft
  if (report.reportType === REPORT_TYPES.SUSPICIOUS_TRANSACTION) {
    if (report.status !== REPORT_STATUSES.REVIEWED) {
      findings.push(createFinding("error", "PMLA-2002", "STR must be reviewed by the Principal Officer before filing.", "status"));
    }
  } else {
    if (report.status !== REPORT_STATUSES.DRAFT && report.status !== REPORT_STATUSES.REVIEWED) {
      findings.push(createFinding("error", "PMLA-2002", "Report cannot be filed from its current status.", "status"));
    }
  }
  if (TERMINAL_STATUSES.has(report.status)) {
    findings.push(createFinding("error", "PMLA-2002", "Report is already filed.", "status"));
  }
  if (!input.actor) {
    findings.push(createFinding("error", "PMLA-2002", "Filing requires an actor.", "actor"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedResult(report, findings, now);
  }

  const packetResult = buildFinnetXml(report, context, input, now);
  findings.push(...packetResult.findings);
  const packetSummary = summarizeFindings(findings);
  if (packetSummary.status === "blocked") return blockedResult(report, findings, now);
  const eventType = report.reportType === REPORT_TYPES.CASH_TRANSACTION
    ? "fiu.ctr.filed"
    : "fiu.str.filed";
  const event = fiuEvent(eventType, {
    reportId: report.reportId,
    finnetChecksumSha256: packetResult.packet.checksumSha256,
    actor: input.actor
  }, now);
  const updated = {
    ...report,
    status: REPORT_STATUSES.FILED,
    filedAt: now.toISOString(),
    filedBy: input.actor,
    finnetPacket: packetResult.packet,
    fiuAcknowledgementId: null,
    events: [...(report.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyResult(updated, event, now);
}

export function buildFinnetXml(report, context = {}, input = {}, now = new Date()) {
  const findings = [];
  const subject = context.borrowerProfiles?.[report?.subjectBorrowerId] ?? report?.subjectProfile ?? null;
  const reportingEntityCode = input.reportingEntityCode ?? report?.reportingEntityCode;
  const reportReference = input.reportReference ?? report?.reportReference ?? report?.reportId;
  const format = report?.reportType === REPORT_TYPES.COUNTERFEIT_CURRENCY
    ? FINNET_REPORTING_FORMATS.COUNTERFEIT_CURRENCY
    : input.reportingFormat ?? report?.reportingFormat ?? (report?.subjectAccountIds?.length ? FINNET_REPORTING_FORMATS.ACCOUNT_BASED : FINNET_REPORTING_FORMATS.TRANSACTION_BASED);
  if (!report) findings.push(createFinding("error", "PMLA-2002", "FIU report is required.", "report"));
  if (!reportingEntityCode || !/^[A-Za-z0-9_-]{1,30}$/.test(reportingEntityCode)) findings.push(createFinding("error", "PMLA-2002", "FINnet reportingEntityCode (1-30 alphanumeric, underscore, or hyphen) is required.", "reportingEntityCode"));
  if (!reportReference || !/^[A-Za-z0-9_-]{1,20}$/.test(reportReference)) findings.push(createFinding("error", "PMLA-2002", "FINnet reportReference (1-20 alphanumeric, underscore, or hyphen) is required.", "reportReference"));
  if (!Object.values(FINNET_REPORTING_FORMATS).includes(format)) findings.push(createFinding("error", "PMLA-2002", "FINnet format must be ARF, TRF, or CRF.", "reportingFormat"));
  if (report?.reportType === REPORT_TYPES.COUNTERFEIT_CURRENCY && format !== FINNET_REPORTING_FORMATS.COUNTERFEIT_CURRENCY) findings.push(createFinding("error", "PMLA-2002", "CCR must use the CRF reporting format.", "reportingFormat"));
  if (report?.reportType !== REPORT_TYPES.COUNTERFEIT_CURRENCY && format === FINNET_REPORTING_FORMATS.COUNTERFEIT_CURRENCY) findings.push(createFinding("error", "PMLA-2002", "CRF is reserved for counterfeit currency reports.", "reportingFormat"));
  if (!subject?.fullName && !subject?.legalName) findings.push(createFinding("error", "PMLA-2002", "FINnet packet requires the subject KYC name.", "subjectProfile"));
  if (!subject?.contact?.mobile && !subject?.contact?.email) findings.push(createFinding("error", "PMLA-2002", "FINnet packet requires a subject contact channel.", "subjectProfile.contact"));
  const transactions = Array.isArray(report?.transactionDetails) ? report.transactionDetails : [];
  if (report?.reportType !== REPORT_TYPES.COUNTERFEIT_CURRENCY && transactions.length === 0) findings.push(createFinding("error", "PMLA-2002", "FINnet STR/CTR packet requires at least one transaction.", "transactionDetails"));
  for (const [index, transaction] of transactions.entries()) {
    if (!transaction?.transactionRef || !/^[A-Za-z0-9_-]{1,50}$/.test(transaction.transactionRef)) findings.push(createFinding("error", "PMLA-2002", "Transaction reference is required and must be 1-50 safe characters.", `transactionDetails.${index}.transactionRef`));
    if (!transaction?.transactionDate || Number.isNaN(new Date(transaction.transactionDate).getTime())) findings.push(createFinding("error", "PMLA-2002", "Transaction date is required.", `transactionDetails.${index}.transactionDate`));
    if (!Number.isFinite(transaction?.amountInr) || transaction.amountInr <= 0 || Math.abs(transaction.amountInr * 100 - Math.round(transaction.amountInr * 100)) >= 1e-8) findings.push(createFinding("error", "PMLA-2002", "Transaction amount must be positive and paise-exact.", `transactionDetails.${index}.amountInr`));
    if (!transaction?.mode) findings.push(createFinding("error", "PMLA-2002", "Transaction mode is required.", `transactionDetails.${index}.mode`));
  }
  if (report?.reportType === REPORT_TYPES.COUNTERFEIT_CURRENCY && (!report.counterfeitDetails?.denomination || !report.counterfeitDetails?.currency || !report.counterfeitDetails?.seizureReference)) findings.push(createFinding("error", "PMLA-2002", "CCR requires denomination, currency, and seizure reference.", "counterfeitDetails"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { packet: null, findings, summary };
  const reportCode = report.reportType === REPORT_TYPES.SUSPICIOUS_TRANSACTION ? "STR" : report.reportType === REPORT_TYPES.CASH_TRANSACTION ? "CTR" : "CCR";
  const name = subject.fullName ?? subject.legalName;
  const kyc = `<KycProfile><CustomerId>${xml(report.subjectBorrowerId)}</CustomerId><Name>${xml(name)}</Name><CustomerType>${subject.borrowerType === "individual" ? "INDIVIDUAL" : "LEGAL_ENTITY"}</CustomerType><Mobile>${xml(subject.contact?.mobile ?? "")}</Mobile><Email>${xml(subject.contact?.email ?? "")}</Email></KycProfile>`;
  const accounts = format === FINNET_REPORTING_FORMATS.ACCOUNT_BASED ? `<AccountProfiles>${(report.subjectAccountIds ?? []).map((id) => `<AccountProfile><AccountId>${xml(id)}</AccountId></AccountProfile>`).join("")}</AccountProfiles>` : "";
  const transactionXml = transactions.map((transaction) => `<Transaction><TransactionRef>${xml(transaction.transactionRef)}</TransactionRef><TransactionDate>${xml(new Date(transaction.transactionDate).toISOString().slice(0, 10))}</TransactionDate><Amount currency="INR">${transaction.amountInr.toFixed(2)}</Amount><Mode>${xml(transaction.mode)}</Mode><Source>${xml(transaction.source ?? "")}</Source><Destination>${xml(transaction.destination ?? "")}</Destination></Transaction>`).join("");
  const reportSpecific = reportCode === "STR" ? `<Suspicion><Grounds>${xml(report.suspicionGrounds)}</Grounds><Indicators>${(report.suspicionIndicators ?? []).map((item) => `<Indicator>${xml(item)}</Indicator>`).join("")}</Indicators></Suspicion>` : reportCode === "CCR" ? `<CounterfeitCurrency><Denomination>${xml(report.counterfeitDetails.denomination)}</Denomination><Currency>${xml(report.counterfeitDetails.currency)}</Currency><SeizureReference>${xml(report.counterfeitDetails.seizureReference)}</SeizureReference></CounterfeitCurrency>` : "";
  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?><FINnetReport profile="${FINNET_XML_PROFILE}" format="${format}"><ReportHeader><ReportReference>${xml(reportReference)}</ReportReference><ReportType>${reportCode}</ReportType><ReportingEntityCode>${xml(reportingEntityCode)}</ReportingEntityCode><GeneratedAt>${now.toISOString()}</GeneratedAt></ReportHeader>${kyc}${accounts}<Transactions>${transactionXml}</Transactions>${reportSpecific}</FINnetReport>`;
  return { packet: { profile: FINNET_XML_PROFILE, format, reportReference, contentType: "application/xml", xml: xmlContent, checksumSha256: createHash("sha256").update(xmlContent).digest("hex"), generatedAt: now.toISOString() }, findings, summary };
}

export function acknowledgeFiuReport(report, input = {}, now = new Date()) {
  const findings = [];
  if (!report || report.status !== REPORT_STATUSES.FILED) findings.push(createFinding("error", "PMLA-2002", "Only a filed FIU report can be acknowledged.", "status"));
  if (!input.acknowledgementRef || !input.receivedBy || !["accepted", "rejected"].includes(input.status)) findings.push(createFinding("error", "PMLA-2002", "Acknowledgement reference, receiver, and accepted/rejected status are required.", "acknowledgement"));
  if (input.checksumSha256 !== report?.finnetPacket?.checksumSha256) findings.push(createFinding("error", "PMLA-2002", "FIU acknowledgement checksum must exactly match the filed FINnet XML packet.", "checksumSha256"));
  if (input.status === "rejected" && (!input.errorCode || !input.errorMessage)) findings.push(createFinding("error", "PMLA-2002", "Rejected FIU acknowledgement requires error code and message.", "error"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return blockedResult(report, findings, now);
  const accepted = input.status === "accepted"; const event = fiuEvent(`fiu.${report.reportType === REPORT_TYPES.CASH_TRANSACTION ? "ctr" : report.reportType === REPORT_TYPES.COUNTERFEIT_CURRENCY ? "ccr" : "str"}.${input.status}`, { reportId: report.reportId, acknowledgementRef: input.acknowledgementRef, actor: input.receivedBy }, now);
  const updated = { ...report, status: accepted ? REPORT_STATUSES.ACKNOWLEDGED : REPORT_STATUSES.REJECTED, fiuAcknowledgementId: input.acknowledgementRef, acknowledgedAt: now.toISOString(), acknowledgement: { status: input.status, acknowledgementRef: input.acknowledgementRef, checksumSha256: input.checksumSha256, receivedBy: input.receivedBy, errorCode: input.errorCode ?? null, errorMessage: input.errorMessage ?? null }, events: [...(report.events ?? []), event], updatedAt: now.toISOString() };
  return readyResult(updated, event, now);
}

export function repairFiuReport(registry = {}, rejectedReportId, input = {}, context = {}, now = new Date()) {
  const rejected = registry[rejectedReportId]; const findings = [];
  if (!rejected || rejected.status !== REPORT_STATUSES.REJECTED) findings.push(createFinding("error", "PMLA-2002", "A rejected FIU report is required for repair.", "rejectedReportId"));
  if (!input.proposedBy || !input.approvedBy || input.proposedBy === input.approvedBy || !input.approvalRef || !input.sourceCorrectionRef || !input.correctedReport) findings.push(createFinding("error", "RBI-IT-GRC", "Independent repair approval, source correction evidence, and corrected report are required.", "repair"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { registry, report: null, findings, summary };
  const result = createFiuReport(registry, { ...rejected, ...input.correctedReport, reportId: input.reportId ?? createLoanId("fiu"), parentReportId: rejectedReportId, createdBy: input.proposedBy, repairApproval: { proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, sourceCorrectionRef: input.sourceCorrectionRef } }, context, now);
  return { ...result, report: result.report ? { ...result.report, parentReportId: rejectedReportId } : null };
}

// --- Enrichment ---

export function enrichFiuReport(report, now = new Date()) {
  if (!report) return null;
  const enriched = { ...report };

  // STR filing deadline (7 days from creation)
  if (report.reportType === REPORT_TYPES.SUSPICIOUS_TRANSACTION && report.createdAt) {
    const deadline = new Date(report.createdAt);
    deadline.setUTCDate(deadline.getUTCDate() + STR_FILING_DEADLINE_DAYS);
    enriched.filingDeadline = deadline.toISOString();
    enriched.filingOverdue = !TERMINAL_STATUSES.has(report.status) && now.getTime() > deadline.getTime();
  }

  return enriched;
}

export function listFiuReports(registry = {}, filters = {}) {
  let reports = Object.values(registry);
  if (filters.reportType) {
    reports = reports.filter((r) => r.reportType === filters.reportType);
  }
  if (filters.subjectBorrowerId) {
    reports = reports.filter((r) => r.subjectBorrowerId === filters.subjectBorrowerId);
  }
  if (filters.status) {
    reports = reports.filter((r) => r.status === filters.status);
  }
  return reports;
}

// Tipping-off guard: prevents exposing STR information to the subject borrower.
// This function returns true if the given borrowerId matches the subject of any
// non-satisfied STR in the registry. API handlers should check this before
// returning STR data to a borrower-facing endpoint.
export function isTippingOffRisk(registry = {}, borrowerId) {
  if (!borrowerId) return false;
  return Object.values(registry).some(
    (r) =>
      r.reportType === REPORT_TYPES.SUSPICIOUS_TRANSACTION &&
      r.subjectBorrowerId === borrowerId
  );
}

// --- Internal helpers ---

function normalizeReport(input, existing = {}, now = new Date()) {
  return {
    ...existing,
    reportId: input.reportId ?? existing.reportId ?? createLoanId("fiu"),
    reportType: input.reportType ?? existing.reportType ?? null,
    regulatedEntityId: input.regulatedEntityId ?? existing.regulatedEntityId ?? null,
    subjectBorrowerId: input.subjectBorrowerId ?? existing.subjectBorrowerId ?? null,
    subjectAccountIds: input.subjectAccountIds ?? existing.subjectAccountIds ?? [],
    subjectProfile: input.subjectProfile ?? existing.subjectProfile ?? null,
    transactionDetails: input.transactionDetails ?? existing.transactionDetails ?? [],
    totalAmountInr: input.totalAmountInr ?? existing.totalAmountInr ?? null,
    suspicionGrounds: input.suspicionGrounds ?? existing.suspicionGrounds ?? null,
    suspicionIndicators: input.suspicionIndicators ?? existing.suspicionIndicators ?? [],
    counterfeitDetails: input.counterfeitDetails ?? existing.counterfeitDetails ?? null,
    reportingEntityCode: input.reportingEntityCode ?? existing.reportingEntityCode ?? null,
    reportReference: input.reportReference ?? existing.reportReference ?? null,
    reportingFormat: input.reportingFormat ?? existing.reportingFormat ?? null,
    parentReportId: input.parentReportId ?? existing.parentReportId ?? null,
    repairApproval: input.repairApproval ?? existing.repairApproval ?? null,
    status: existing.status ?? REPORT_STATUSES.DRAFT,
    createdBy: input.createdBy ?? existing.createdBy ?? null,
    fiuAcknowledgementId: existing.fiuAcknowledgementId ?? null,
    events: Array.isArray(existing.events) ? existing.events : [],
    createdAt: existing.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function xml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function fiuEvent(type, data, now) {
  return { eventId: createLoanId("fiuevt"), type, at: now.toISOString(), ...data };
}

function readyResult(report, event, now) {
  return { report: enrichFiuReport(report, now), event, findings: [], summary: summarizeFindings([]) };
}

function blockedResult(report, findings, now) {
  return { report: report ? enrichFiuReport(report, now) : null, event: null, findings, summary: summarizeFindings(findings) };
}
