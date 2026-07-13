import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { generateLoanStatement } from "./loan-account.js";
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

// Renders the LMS statement data into a borrower-facing, checksum-sealed
// document in the same shape as the execution packet documents, so a periodic
// account statement can be delivered and evidenced.
export function renderLoanStatementDocument(account, input = {}, now = new Date()) {
  if (!account) {
    const findings = [createFinding("error", "RBI-DL-2025", "Loan account is required.", "loanAccount")];
    return { document: null, statement: null, findings, summary: summarizeFindings(findings) };
  }

  const statement = generateLoanStatement(account, input, now);
  const currency = statement.currency;
  const summaryRows = [
    ["Statement ID", statement.statementId],
    ["Loan account", statement.loanAccountId],
    ["Borrower ID", statement.borrowerId],
    ["Period", `${statement.periodStart} to ${statement.periodEnd}`],
    ["Currency", currency]
  ];
  const dueRows = statement.scheduledDues.map((installment) => [
    `#${installment.installmentNumber} due ${installment.dueDate}`,
    `${money(installment.principalDue, currency)} principal + ${money(installment.interestDue, currency)} interest = ${money(installment.totalDue, currency)}`
  ]);
  const transactionRows = statement.transactions.map((event) => [
    `${String(event.eventDate).slice(0, 10)} ${event.type}`,
    money(event.amount, currency)
  ]);
  const totalsRows = [
    ["Principal due", money(statement.totals.principalDue, currency)],
    ["Interest due", money(statement.totals.interestDue, currency)],
    ["Charges assessed (incl. GST)", money(statement.totals.chargesAssessed, currency)],
    ["— of which GST", money(statement.totals.gstCollected ?? 0, currency)],
    ["Charges waived", money(statement.totals.chargesWaived, currency)],
    ["Payments received", money(statement.totals.payments, currency)]
  ];
  const body = [
    tableHtml(summaryRows),
    heading("Opening Balance"),
    tableHtml(balanceRows(statement.openingSummary, currency)),
    heading("Scheduled Dues"),
    dueRows.length ? tableHtml(dueRows) : paragraph("No installments fell due in this period."),
    heading("Transactions"),
    transactionRows.length ? tableHtml(transactionRows) : paragraph("No transactions in this period."),
    heading("Period Totals"),
    tableHtml(totalsRows),
    heading("Closing Balance"),
    tableHtml(balanceRows(statement.closingSummary, currency))
  ].join("\n");

  const rendered = document("loan_statement", "Loan Account Statement", body, statement.generatedAt, ["RBI-DL-2025"]);
  return { document: rendered, statement, findings: [], summary: summarizeFindings([]) };
}

function balanceRows(summary, currency) {
  return [
    ["Principal outstanding", money(summary.principalOutstanding, currency)],
    ["Interest outstanding", money(summary.interestOutstanding, currency)],
    ["Charges outstanding", money(summary.chargesOutstanding, currency)],
    ["Total outstanding", money(summary.totalOutstanding, currency)]
  ];
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
    if (application.documentPacket.status !== "signed" || !application.documentPacket.signature?.signatureRef) {
      findings.push(
        createFinding(
          "error",
          "RBI-DL-2025",
          "Document packet must be signed via eSign before disbursement.",
          "documentPacket.status"
        )
      );
    }
  }
  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function signDocumentPacket(application, input = {}, now = new Date()) {
  const findings = [];
  if (!application?.documentPacket) {
    findings.push(createFinding("error", "RBI-DL-2025", "Document packet is required before signing.", "documentPacket"));
  } else if (application.documentPacket.status !== "delivered") {
    findings.push(
      createFinding(
        "error",
        "RBI-DL-2025",
        `Document packet must be delivered before signing. Current status: ${application.documentPacket.status}`,
        "documentPacket.status"
      )
    );
  }
  if (!input.aadhaarNumber || input.aadhaarNumber.length !== 12 || !/^\d{12}$/.test(input.aadhaarNumber)) {
    findings.push(createFinding("error", "RBI-KYC-2016", "Signer Aadhaar number is required and must be 12 numeric digits.", "aadhaarNumber"));
  }
  if (!input.signerName) {
    findings.push(createFinding("error", "RBI-DL-2025", "Signer name is required.", "signerName"));
  }
  if (!input.signatureRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "Signature transaction reference is required.", "signatureRef"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      packet: application?.documentPacket ?? null,
      findings,
      summary
    };
  }

  const signedAt = input.signedAt ?? now.toISOString();
  const packet = {
    ...application.documentPacket,
    status: "signed",
    signedAt,
    signature: {
      signedAt,
      signerName: input.signerName,
      aadhaarMasked: "XXXX-XXXX-" + input.aadhaarNumber.slice(-4),
      signatureRef: input.signatureRef,
      esignProvider: input.esignProvider ?? "mock",
      envelopeId: input.envelopeId ?? null,
      externalEnvelopeStorageUrl: input.externalEnvelopeStorageUrl ?? null
    }
  };

  return {
    packet,
    findings: [],
    summary: summarizeFindings([])
  };
}

function buildKfsDocument(application, generatedAt) {
  const kfs = application.kfs;
  const rows = [
    ["Lender", kfs.lenderName],
    ["Borrower ID", kfs.borrowerId],
    ["Application ID", kfs.applicationId],
    ["Proposal number", kfs.proposalNumber],
    ["Proposal valid until", kfs.validUntil],
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
  const chargeLine = (charge) => {
    const inclusive = money(charge.amount, kfs.currency);
    const taxNote =
      charge.gstApplicable && Number.isFinite(charge.gstAmount)
        ? ` (incl. GST ${money(charge.gstAmount, kfs.currency)}; base ${money(charge.baseAmount, kfs.currency)})`
        : Number.isFinite(charge.amount)
          ? " (GST not applicable)"
          : "";
    return [charge.name, `${inclusive}${taxNote} - ${charge.reason}`];
  };
  const gstNote = kfs.taxDisclosure?.note
    ? paragraph(kfs.taxDisclosure.note)
    : "";
  const body = [
    tableHtml(rows),
    heading("APR computation sheet"),
    tableHtml([
      ["Method", kfs.aprComputation?.method],
      ["Amount disbursed", money(kfs.aprComputation?.amountDisbursed, kfs.currency)],
      ["Mandatory upfront charges", money(kfs.aprComputation?.mandatoryUpfrontCharges, kfs.currency)],
      ["Number of instalments", kfs.aprComputation?.installmentCount],
      ["Total repayment amount", money(kfs.aprComputation?.totalRepaymentAmount, kfs.currency)]
    ]),
    heading("Amortisation schedule"),
    tableHtml([
      ["Instalment", "Due date / Opening / Principal / Interest / Total / Closing"],
      ...(kfs.amortizationSchedule ?? []).map((row) => [
        row.installmentNumber,
        `${row.dueDate} / ${money(row.openingPrincipal, kfs.currency)} / ${money(row.principalDue, kfs.currency)} / ${money(row.interestDue, kfs.currency)} / ${money(row.totalDue, kfs.currency)} / ${money(row.closingPrincipal, kfs.currency)}`
      ])
    ]),
    heading("Charges and Penal Charges"),
    charges.length ? tableHtml(charges.map(chargeLine)) : paragraph("No charges disclosed."),
    gstNote
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
    `<meta charset="utf-8"><title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<p><strong>Generated at:</strong> ${escapeHtml(generatedAt)}</p>`,
    body,
    "</body>",
    "</html>"
  ].join("\n");
  const text = htmlToText(html);
  const pdfString = generateMockPdfString(title, text, generatedAt);
  const pdfChecksum = createHash("sha256").update(pdfString).digest("hex");
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
    text,
    pdfMimeType: "application/pdf",
    pdfChecksumSha256: pdfChecksum,
    pdf: Buffer.from(pdfString).toString("base64")
  };
}

function generateMockPdfString(title, textSummary, generatedAt) {
  const streamText = `BT /F1 12 Tf 70 700 Td (${title}) Tj 70 680 Td (Generated at: ${generatedAt}) Tj 70 640 Td (${textSummary.slice(0, 60)}) Tj ET`;
  const streamLength = Buffer.byteLength(streamText);
  return [
    "%PDF-1.4",
    "1 0 obj",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "endobj",
    "2 0 obj",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "endobj",
    "3 0 obj",
    `<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 612 792] /Contents 4 0 R >>`,
    "endobj",
    "4 0 obj",
    `<< /Length ${streamLength} >>`,
    "stream",
    streamText,
    "endstream",
    "endobj",
    "xref",
    "0 5",
    "0000000000 65535 f",
    "0000000009 00000 n",
    "0000000058 00000 n",
    "0000000115 00000 n",
    "0000000222 00000 n",
    "trailer",
    "<< /Size 5 /Root 1 0 R >>",
    "startxref",
    "321",
    "%%EOF"
  ].join("\n");
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
