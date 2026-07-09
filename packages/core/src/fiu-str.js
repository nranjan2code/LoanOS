import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";

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
  ACKNOWLEDGED: "acknowledged"
};

export const CTR_THRESHOLD_INR = 1000000; // ₹10 lakh
const VALID_REPORT_TYPES = new Set(Object.values(REPORT_TYPES));
const TERMINAL_STATUSES = new Set([REPORT_STATUSES.FILED, REPORT_STATUSES.ACKNOWLEDGED]);
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

  const eventType = report.reportType === REPORT_TYPES.CASH_TRANSACTION
    ? "fiu.ctr.created"
    : "fiu.str.created";
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

  // Mock FIU acknowledgement — ExternalServiceManager would call the real API
  const fiuAcknowledgementId = input.fiuAcknowledgementId ?? `FIU-ACK-${Date.now()}`;
  const eventType = report.reportType === REPORT_TYPES.CASH_TRANSACTION
    ? "fiu.ctr.filed"
    : "fiu.str.filed";
  const event = fiuEvent(eventType, {
    reportId: report.reportId,
    fiuAcknowledgementId,
    actor: input.actor
  }, now);
  const updated = {
    ...report,
    status: REPORT_STATUSES.FILED,
    filedAt: now.toISOString(),
    filedBy: input.actor,
    fiuAcknowledgementId,
    events: [...(report.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyResult(updated, event, now);
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
    transactionDetails: input.transactionDetails ?? existing.transactionDetails ?? [],
    totalAmountInr: input.totalAmountInr ?? existing.totalAmountInr ?? null,
    suspicionGrounds: input.suspicionGrounds ?? existing.suspicionGrounds ?? null,
    suspicionIndicators: input.suspicionIndicators ?? existing.suspicionIndicators ?? [],
    status: existing.status ?? REPORT_STATUSES.DRAFT,
    createdBy: input.createdBy ?? existing.createdBy ?? null,
    fiuAcknowledgementId: existing.fiuAcknowledgementId ?? null,
    events: Array.isArray(existing.events) ? existing.events : [],
    createdAt: existing.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
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
