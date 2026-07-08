import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId, validateKfsBeforeDecision } from "./loan-policy.js";

const DOCUMENT_TYPES = [
  "key_fact_statement",
  "sanction_letter",
  "loan_agreement_summary",
  "privacy_notice"
];

const DELIVERY_CHANNELS = new Set(["email", "sms_link", "mobile_app", "web", "physical"]);

export function generateDocumentPacket(application, input = {}, now = new Date()) {
  const findings = validateDocumentPacketGeneration(application);
  if (findings.length > 0) {
    return {
      packet: null,
      findings,
      summary: summarizeFindings(findings)
    };
  }

  const generatedAt = now.toISOString();
  const documents = [
    buildKfsDocument(application, generatedAt),
    buildSanctionLetter(application, generatedAt),
    buildLoanAgreementSummary(application, generatedAt),
    buildPrivacyNotice(application, generatedAt)
  ];
  const packet = {
    packetId: input.packetId ?? createLoanId("docpkt"),
    applicationId: application.applicationId,
    borrowerId: application.borrowerId ?? application.borrower?.borrowerId ?? null,
    regulatedEntityId: application.regulatedEntityId ?? application.tenant?.regulatedEntityId ?? null,
    productId: application.productId ?? application.product?.productId ?? null,
    status: "generated",
    version: input.version ?? "v1",
    generatedAt,
    generatedBy: input.actor ?? input.generatedBy ?? null,
    documents,
    delivery: null
  };

  return {
    packet,
    findings: [],
    summary: summarizeFindings([])
  };
}

export function recordDocumentPacketDelivery(application, input = {}, now = new Date()) {
  const findings = [];
  if (!application?.documentPacket) {
    findings.push(createFinding("error", "RBI-DL-2025", "Document packet must be generated before delivery.", "documentPacket"));
  } else {
    for (const type of DOCUMENT_TYPES) {
      if (!(application.documentPacket.documents ?? []).some((document) => document.type === type)) {
        findings.push(createFinding("error", "RBI-DL-2025", `Document packet is missing ${type}.`, "documentPacket.documents"));
      }
    }
  }
  if (!DELIVERY_CHANNELS.has(input.deliveryChannel)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Document packet deliveryChannel is invalid.", "deliveryChannel"));
  }
  if (!input.deliveryRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "Document packet deliveryRef is required.", "deliveryRef"));
  }
  if (!input.deliveredTo) {
    findings.push(createFinding("error", "RBI-DL-2025", "Document packet deliveredTo is required.", "deliveredTo"));
  }
  if (!input.deliveredBy && !input.actor) {
    findings.push(createFinding("error", "RBI-IT-GRC", "Document packet delivery requires deliveredBy or actor.", "deliveredBy"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      packet: application?.documentPacket ?? null,
      findings,
      summary
    };
  }

  const deliveredAt = input.deliveredAt ?? now.toISOString();
  const packet = {
    ...application.documentPacket,
    status: "delivered",
    deliveredAt,
    delivery: {
      deliveryChannel: input.deliveryChannel,
      deliveryRef: input.deliveryRef,
      deliveredTo: input.deliveredTo,
      deliveredBy: input.deliveredBy ?? input.actor,
      deliveredAt,
      consentNoticeVersion: application.consent?.noticeVersion ?? null,
      kfsDeliveryRef: application.kfs?.deliveryRef ?? null,
      borrowerAcceptedKfsAt: application.kfs?.acceptedAt ?? null
    }
  };

  return {
    packet,
    findings: [],
    summary: summarizeFindings([])
  };
}

export function validateDocumentPacketGeneration(application) {
  const findings = [];
  if (!application) {
    findings.push(createFinding("error", "RBI-DL-2025", "Application is required.", "application"));
    return findings;
  }
  if (!["approved", "disbursed"].includes(application.status)) {
    findings.push(
      createFinding("error", "RBI-DL-2025", "Document packet requires approved or disbursed application.", "status")
    );
  }
  const kfsReadiness = validateKfsBeforeDecision(application);
  findings.push(...kfsReadiness.findings);
  if (!application.decision || application.decision.status !== "approved") {
    findings.push(createFinding("error", "RBI-DL-2025", "Document packet requires approved decision evidence.", "decision"));
  }
  if (!application.tenant?.privacyPolicyUrl && !application.kfs?.privacyPolicyUrl) {
    findings.push(createFinding("error", "DPDP-RULES-2025", "Privacy policy URL is required in document packet.", "privacyPolicyUrl"));
  }
  return findings;
}

export function validateDocumentPacketBeforeDisbursement(application) {
  const findings = [];
  if (!application?.documentPacket) {
    findings.push(createFinding("error", "RBI-DL-2025", "Document packet is required before disbursement.", "documentPacket"));
  } else {
    for (const type of DOCUMENT_TYPES) {
      if (!(application.documentPacket.documents ?? []).some((document) => document.type === type)) {
        findings.push(createFinding("error", "RBI-DL-2025", `Document packet is missing ${type}.`, "documentPacket.documents"));
      }
    }
    if (application.documentPacket.status !== "delivered" || !application.documentPacket.delivery?.deliveryRef) {
      findings.push(
        createFinding("error", "RBI-DL-2025", "Document packet delivery evidence is required before disbursement.", "documentPacket.delivery")
      );
    }
  }
  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

function buildKfsDocument(application, generatedAt) {
  const kfs = application.kfs;
  const rows = [
    ["Lender", kfs.lenderName],
    ["Borrower ID", kfs.borrowerId],
    ["Application ID", kfs.applicationId],
    ["Product", kfs.productCode],
    ["Principal", money(kfs.principalAmount, kfs.currency)],
    ["Tenor", `${kfs.tenorMonths} months`],
    ["Annual interest rate", bps(kfs.annualInterestRateBps)],
    ["APR", bps(kfs.aprBps)],
    ["Repayment frequency", kfs.repaymentFrequency],
    ["Cooling-off period", `${kfs.coolingOffDays} day(s)`],
    ["Recovery mechanism", kfs.recoveryMechanism],
    ["Grievance officer", `${kfs.grievanceOfficer?.name ?? ""} <${kfs.grievanceOfficer?.email ?? ""}>`]
  ];
  const charges = [...(kfs.charges ?? []), ...(kfs.penalCharges ?? []), ...(kfs.contingentCharges ?? [])];
  const body = [
    tableHtml(rows),
    heading("Charges and Penal Charges"),
    charges.length ? tableHtml(charges.map((charge) => [charge.name, `${money(charge.amount, kfs.currency)} - ${charge.reason}`])) : paragraph("No charges disclosed.")
  ].join("\n");

  return document("key_fact_statement", "Key Facts Statement", body, generatedAt, ["RBI-KFS-2024", "RBI-DL-2025"]);
}

function buildSanctionLetter(application, generatedAt) {
  const decision = application.decision;
  const kfs = application.kfs;
  const rows = [
    ["Sanction status", decision.status],
    ["Approved by", decision.approvedBy],
    ["Approval reference", decision.approvalRef],
    ["Decision timestamp", decision.decidedAt],
    ["Sanctioned amount", money(kfs.principalAmount, kfs.currency)],
    ["Tenor", `${kfs.tenorMonths} months`],
    ["APR", bps(kfs.aprBps)]
  ];
  return document(
    "sanction_letter",
    "Sanction Letter",
    `${paragraph("This sanction is subject to the accepted KFS, loan agreement terms, verified KYC, and compliant fund flow.")}\n${tableHtml(rows)}`,
    generatedAt,
    ["RBI-DL-2025", "RBI-IT-GRC"]
  );
}

function buildLoanAgreementSummary(application, generatedAt) {
  const kfs = application.kfs;
  const rows = [
    ["Borrower obligations", "Repay dues as per schedule and maintain updated contact/KYC information."],
    ["Fees", "Only charges disclosed in the KFS or permitted contingent charge schedule may be assessed."],
    ["Penal charges", "Penal charges are not penal interest and cannot be capitalized."],
    ["Pre-disbursement documents", "KFS, sanction letter, agreement summary, and privacy notice are delivered in this packet."],
    ["Cooling-off period", `${kfs.coolingOffDays} day(s)`]
  ];
  return document("loan_agreement_summary", "Loan Agreement Summary", tableHtml(rows), generatedAt, ["RBI-DL-2025", "RBI-FPC-PENAL"]);
}

function buildPrivacyNotice(application, generatedAt) {
  const rows = [
    ["Notice version", application.consent?.noticeVersion],
    ["Data-processing consent at", application.consent?.dataProcessingAcceptedAt],
    ["Privacy policy", application.kfs?.privacyPolicyUrl ?? application.tenant?.privacyPolicyUrl],
    ["Primary storage country", application.dataResidency?.primaryStorageCountry],
    ["Payment data storage country", application.dataResidency?.paymentDataStorageCountry]
  ];
  return document("privacy_notice", "Privacy Notice", tableHtml(rows), generatedAt, ["DPDP-2023", "DPDP-RULES-2025", "RBI-PAY-DATA"]);
}

function document(type, title, body, generatedAt, regulatoryRefs) {
  const html = [
    "<!doctype html>",
    "<html>",
    "<head>",
    `<meta charset=\"utf-8\"><title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<p><strong>Generated at:</strong> ${escapeHtml(generatedAt)}</p>`,
    body,
    "</body>",
    "</html>"
  ].join("\n");
  const text = htmlToText(html);
  return {
    documentId: createLoanId("doc"),
    type,
    title,
    format: "html",
    mimeType: "text/html",
    generatedAt,
    regulatoryRefs,
    checksumSha256: createHash("sha256").update(html).digest("hex"),
    html,
    text
  };
}

function tableHtml(rows) {
  return [
    "<table>",
    ...rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value ?? "N/A")}</td></tr>`),
    "</table>"
  ].join("\n");
}

function heading(value) {
  return `<h2>${escapeHtml(value)}</h2>`;
}

function paragraph(value) {
  return `<p>${escapeHtml(value)}</p>`;
}

function money(amount, currency = "INR") {
  if (!Number.isFinite(amount)) {
    return "N/A";
  }
  return `${currency} ${amount.toFixed(2)}`;
}

function bps(value) {
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  return `${(value / 100).toFixed(2)}%`;
}

function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
