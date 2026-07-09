import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";

// A fraud case cannot be classified as fraud by fiat. The RBI Master Directions
// on Fraud Risk Management (2024), reinforced by the Supreme Court in State Bank
// of India v. Rajesh Agarwal (2023), require natural justice: the borrower must
// receive a show-cause notice and a reasonable opportunity (min 21 days) to
// respond before an account is classified as fraud, and the classification must
// be approved by an authority independent of the investigator (four-eyes).

export const FRAUD_CASE_STATUSES = {
  REPORTED: "reported",
  UNDER_INVESTIGATION: "under_investigation",
  SHOW_CAUSE_ISSUED: "show_cause_issued",
  CLASSIFIED_FRAUD: "classified_fraud",
  CLASSIFIED_NOT_FRAUD: "classified_not_fraud"
};

export const FRAUD_CATEGORIES = [
  "identity_fraud",
  "document_forgery",
  "diversion_of_funds",
  "misrepresentation",
  "account_takeover",
  "collusion",
  "other"
];

const FRAUD_CLASSIFICATIONS = new Set(["fraud", "not_fraud"]);
const TERMINAL_STATUSES = new Set([
  FRAUD_CASE_STATUSES.CLASSIFIED_FRAUD,
  FRAUD_CASE_STATUSES.CLASSIFIED_NOT_FRAUD
]);

// RBI FRM 2024: the borrower gets a minimum of 21 days to respond to the notice.
export const NATURAL_JUSTICE_RESPONSE_DAYS = 21;

export function createFraudCase(registry = {}, input = {}, context = {}, now = new Date()) {
  const fraudCase = normalizeFraudCase(input, {}, now);
  const findings = validateFraudCase(fraudCase, context);
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { registry, fraudCase, findings, summary };
  }

  const event = fraudEvent("fraud_case.reported", {
    actor: input.reportedBy ?? null,
    category: fraudCase.category,
    subjectBorrowerId: fraudCase.subjectBorrowerId,
    subjectLoanAccountId: fraudCase.subjectLoanAccountId
  }, now);
  const stored = { ...fraudCase, events: [event], updatedAt: now.toISOString() };

  return {
    registry: { ...registry, [stored.fraudCaseId]: stored },
    fraudCase: enrichFraudCase(stored, now),
    event,
    findings: [],
    summary: summarizeFindings([])
  };
}

export function issueShowCauseNotice(fraudCase, input = {}, now = new Date()) {
  const findings = validateFraudCaseAction(fraudCase);
  if (!input.actor) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Show-cause notice requires an actor.", "actor"));
  }
  if (!input.noticeReference) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Show-cause notice requires a noticeReference.", "noticeReference"));
  }
  if (!input.deliveryRef) {
    findings.push(
      createFinding("error", "RBI-FRM-2024", "Show-cause notice requires proof of delivery to the borrower.", "deliveryRef")
    );
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedFraudResult(fraudCase, findings, now);
  }

  const issuedAt = normalizeDate(input.issuedAt) ?? now;
  const responseDueBy = addDays(issuedAt, NATURAL_JUSTICE_RESPONSE_DAYS);
  const notice = {
    noticeReference: input.noticeReference,
    issuedBy: input.actor,
    issuedAt: issuedAt.toISOString(),
    deliveryRef: input.deliveryRef,
    responseDueBy: responseDueBy.toISOString(),
    allegations: input.allegations ?? null
  };
  const event = fraudEvent("fraud_case.show_cause_issued", {
    actor: input.actor,
    noticeReference: notice.noticeReference,
    responseDueBy: notice.responseDueBy
  }, now);
  const updated = {
    ...fraudCase,
    status: FRAUD_CASE_STATUSES.SHOW_CAUSE_ISSUED,
    showCauseNotice: notice,
    events: [...(fraudCase.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyFraudResult(updated, event, now);
}

export function recordFraudResponse(fraudCase, input = {}, now = new Date()) {
  const findings = validateFraudCaseAction(fraudCase);
  if (fraudCase && !fraudCase.showCauseNotice) {
    findings.push(
      createFinding("error", "RBI-FRM-2024", "A borrower response requires a prior show-cause notice.", "status")
    );
  }
  if (!input.summary) {
    findings.push(createFinding("error", "RBI-FRM-2024", "A borrower response requires a summary.", "summary"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedFraudResult(fraudCase, findings, now);
  }

  const receivedAt = normalizeDate(input.receivedAt) ?? now;
  const response = {
    receivedAt: receivedAt.toISOString(),
    summary: input.summary,
    representationRef: input.representationRef ?? null,
    recordedBy: input.actor ?? null
  };
  const event = fraudEvent("fraud_case.response_recorded", {
    actor: input.actor ?? null,
    receivedAt: response.receivedAt
  }, now);
  const updated = {
    ...fraudCase,
    borrowerResponse: response,
    events: [...(fraudCase.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyFraudResult(updated, event, now);
}

export function classifyFraudCase(fraudCase, input = {}, now = new Date()) {
  const findings = validateFraudCaseAction(fraudCase);
  if (!FRAUD_CLASSIFICATIONS.has(input.classification)) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Classification must be fraud or not_fraud.", "classification"));
  }
  if (!input.actor) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Fraud classification requires an approving actor.", "actor"));
  }
  if (!input.reason) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Fraud classification requires a reason.", "reason"));
  }

  // The natural-justice gate applies only to an adverse (fraud) classification.
  if (input.classification === "fraud" && fraudCase) {
    const notice = fraudCase.showCauseNotice;
    if (!notice) {
      findings.push(
        createFinding("error", "RBI-FRM-2024", "Fraud classification requires a prior show-cause notice.", "showCauseNotice")
      );
    } else {
      const responded = Boolean(fraudCase.borrowerResponse);
      const windowElapsed = new Date(notice.responseDueBy).getTime() <= now.getTime();
      if (!responded && !windowElapsed) {
        findings.push(
          createFinding(
            "error",
            "RBI-FRM-2024",
            "Fraud classification is blocked until the borrower responds or the notice period elapses.",
            "showCauseNotice"
          )
        );
      }
    }
    // Four-eyes: the classifying authority cannot be the investigator/reporter.
    if (input.actor && (input.actor === fraudCase.reportedBy || input.actor === fraudCase.investigatedBy)) {
      findings.push(
        createFinding("error", "RBI-FRM-2024", "Fraud classification must be approved by someone other than the investigator.", "actor")
      );
    }
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return blockedFraudResult(fraudCase, findings, now);
  }

  const classifiedAt = normalizeDate(input.classifiedAt) ?? now;
  const classification = {
    classification: input.classification,
    reason: input.reason,
    approvedBy: input.actor,
    classifiedAt: classifiedAt.toISOString(),
    committeeRef: input.committeeRef ?? null
  };
  const event = fraudEvent("fraud_case.classified", {
    actor: input.actor,
    classification: input.classification,
    committeeRef: classification.committeeRef
  }, now);
  const updated = {
    ...fraudCase,
    status:
      input.classification === "fraud"
        ? FRAUD_CASE_STATUSES.CLASSIFIED_FRAUD
        : FRAUD_CASE_STATUSES.CLASSIFIED_NOT_FRAUD,
    classification,
    events: [...(fraudCase.events ?? []), event],
    updatedAt: now.toISOString()
  };

  return readyFraudResult(updated, event, now);
}

export function enrichFraudCase(fraudCase, asOf = new Date()) {
  const notice = fraudCase.showCauseNotice ?? null;
  let naturalJustice = null;
  if (notice) {
    const responded = Boolean(fraudCase.borrowerResponse);
    const windowElapsed = new Date(notice.responseDueBy).getTime() <= asOf.getTime();
    naturalJustice = {
      noticeIssued: true,
      responseDueBy: notice.responseDueBy,
      responded,
      windowElapsed,
      // Fraud classification is only permissible once the borrower has been heard
      // or the response window has lapsed.
      classificationPermitted: responded || windowElapsed
    };
  } else {
    naturalJustice = { noticeIssued: false, classificationPermitted: false };
  }
  return { ...fraudCase, naturalJustice };
}

// A checksum-sealed pack assembling everything a fraud/approval committee needs
// to decide a case: the allegations, the natural-justice trail (show-cause
// notice + borrower representation), the event timeline, and an explicit verdict
// on whether the case may lawfully be classified as fraud yet. The seal makes
// the pack tamper-evident once tabled.
export function generateFraudCommitteePack(fraudCase, input = {}, now = new Date()) {
  if (!fraudCase) {
    const findings = [createFinding("error", "RBI-FRM-2024", "Fraud case is required.", "fraudCaseId")];
    return { committeePack: null, findings, summary: summarizeFindings(findings) };
  }

  const enriched = enrichFraudCase(fraudCase, now);
  const naturalJustice = enriched.naturalJustice;
  const blockers = [];
  if (!naturalJustice.noticeIssued) {
    blockers.push("No show-cause notice has been issued.");
  } else if (!naturalJustice.classificationPermitted) {
    blockers.push("Borrower has neither responded nor exhausted the notice period.");
  }

  const content = {
    packId: input.packId ?? createLoanId("fcpack"),
    documentType: "fraud_committee_pack",
    fraudCaseId: fraudCase.fraudCaseId,
    generatedAt: now.toISOString(),
    generatedBy: input.actor ?? "system",
    case: {
      status: fraudCase.status,
      category: fraudCase.category,
      summary: fraudCase.summary,
      description: fraudCase.description,
      amountInvolved: fraudCase.amountInvolved,
      subjectBorrowerId: fraudCase.subjectBorrowerId,
      subjectLoanAccountId: fraudCase.subjectLoanAccountId,
      reportedBy: fraudCase.reportedBy,
      investigatedBy: fraudCase.investigatedBy
    },
    naturalJustice: {
      showCauseNotice: fraudCase.showCauseNotice,
      borrowerResponse: fraudCase.borrowerResponse,
      responseDueBy: naturalJustice.responseDueBy ?? null,
      responded: Boolean(fraudCase.borrowerResponse),
      windowElapsed: naturalJustice.windowElapsed ?? false
    },
    classification: fraudCase.classification,
    timeline: (fraudCase.events ?? []).map((event) => ({ type: event.type, at: event.at })),
    // The committee sees at a glance whether an adverse finding is lawful now.
    classificationPermitted: naturalJustice.classificationPermitted && blockers.length === 0,
    blockers
  };

  const committeePack = {
    ...content,
    checksumSha256: createHash("sha256").update(JSON.stringify(content)).digest("hex")
  };
  return { committeePack, findings: [], summary: summarizeFindings([]) };
}

function normalizeFraudCase(input, existing = {}, now = new Date()) {
  return {
    ...existing,
    fraudCaseId: input.fraudCaseId ?? existing.fraudCaseId ?? createLoanId("fraud"),
    status: input.status ?? existing.status ?? FRAUD_CASE_STATUSES.REPORTED,
    category: input.category ?? existing.category ?? null,
    summary: input.summary ?? existing.summary ?? null,
    description: input.description ?? existing.description ?? null,
    subjectBorrowerId: input.subjectBorrowerId ?? existing.subjectBorrowerId ?? null,
    subjectLoanAccountId: input.subjectLoanAccountId ?? existing.subjectLoanAccountId ?? null,
    amountInvolved: Number.isFinite(input.amountInvolved) ? input.amountInvolved : existing.amountInvolved ?? null,
    reportedBy: input.reportedBy ?? existing.reportedBy ?? null,
    investigatedBy: input.investigatedBy ?? existing.investigatedBy ?? null,
    showCauseNotice: existing.showCauseNotice ?? null,
    borrowerResponse: existing.borrowerResponse ?? null,
    classification: existing.classification ?? null,
    events: Array.isArray(existing.events) ? existing.events : [],
    createdAt: existing.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function validateFraudCase(fraudCase, context = {}) {
  const findings = [];
  if (!fraudCase.fraudCaseId) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Fraud case requires fraudCaseId.", "fraudCaseId"));
  }
  if (!FRAUD_CATEGORIES.includes(fraudCase.category)) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Fraud category is invalid.", "category"));
  }
  if (!fraudCase.summary) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Fraud case requires a summary.", "summary"));
  }
  if (!fraudCase.reportedBy) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Fraud case requires reportedBy.", "reportedBy"));
  }
  if (!fraudCase.subjectBorrowerId && !fraudCase.subjectLoanAccountId) {
    findings.push(
      createFinding("error", "RBI-FRM-2024", "Fraud case requires a subject borrower or loan account.", "subjectBorrowerId")
    );
  }
  if (
    fraudCase.subjectBorrowerId &&
    context.borrowerProfiles &&
    !context.borrowerProfiles[fraudCase.subjectBorrowerId]
  ) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Fraud case subject borrower is not registered.", "subjectBorrowerId"));
  }
  if (
    fraudCase.subjectLoanAccountId &&
    context.loanAccounts &&
    !context.loanAccounts[fraudCase.subjectLoanAccountId]
  ) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Fraud case subject loan account is not registered.", "subjectLoanAccountId"));
  }
  return findings;
}

function validateFraudCaseAction(fraudCase) {
  const findings = [];
  if (!fraudCase) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Fraud case is required.", "fraudCaseId"));
  }
  if (fraudCase && TERMINAL_STATUSES.has(fraudCase.status)) {
    findings.push(createFinding("error", "RBI-FRM-2024", "Fraud case is already classified.", "status"));
  }
  return findings;
}

function readyFraudResult(fraudCase, event, now) {
  return { fraudCase: enrichFraudCase(fraudCase, now), event, findings: [], summary: summarizeFindings([]) };
}

function blockedFraudResult(fraudCase, findings, now) {
  return {
    fraudCase: fraudCase ? enrichFraudCase(fraudCase, now) : null,
    event: null,
    findings,
    summary: summarizeFindings(findings)
  };
}

function fraudEvent(type, event, now) {
  return { eventId: createLoanId("fraudevt"), type, at: now.toISOString(), ...event };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
