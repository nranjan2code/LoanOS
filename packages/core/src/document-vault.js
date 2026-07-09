import { createHash } from "node:crypto";
import { createFinding, summarizeFindings } from "./compliance-controls.js";

const REQUIRED_DOCUMENT_TYPES = new Set([
  "key_fact_statement",
  "sanction_letter",
  "loan_agreement_summary",
  "privacy_notice"
]);

export function vaultDocumentPacket(registry = {}, application, packet = application?.documentPacket, input = {}, now = new Date()) {
  const findings = validateVaultInput(application, packet, input);
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      registry,
      record: null,
      findings,
      summary,
      existing: false
    };
  }

  const existing = Object.values(registry ?? {}).find((record) => record.packetId === packet.packetId);
  if (existing) {
    return {
      registry,
      record: existing,
      findings: [],
      summary: summarizeFindings([]),
      existing: true
    };
  }

  const vaultedAt = input.vaultedAt ?? now.toISOString();
  const documents = (packet.documents ?? []).map((document) => ({
    documentId: document.documentId,
    type: document.type,
    title: document.title,
    mimeType: document.mimeType,
    checksumSha256: document.checksumSha256,
    generatedAt: document.generatedAt,
    regulatoryRefs: document.regulatoryRefs ?? []
  }));
  const storageCountry = input.storageCountry ?? application?.dataResidency?.primaryStorageCountry ?? "IN";
  const retentionPolicyId = input.retentionPolicyId ?? "loan_document_retention_v1";
  const manifestHash = hash({
    packetId: packet.packetId,
    applicationId: packet.applicationId,
    signatureRef: packet.signature.signatureRef,
    documents,
    storageCountry,
    retentionPolicyId
  });
  const record = {
    vaultRecordId: input.vaultRecordId ?? `docvault_${packet.packetId}`,
    packetId: packet.packetId,
    applicationId: packet.applicationId,
    borrowerId: packet.borrowerId ?? application?.borrowerId ?? application?.borrower?.borrowerId ?? null,
    regulatedEntityId: packet.regulatedEntityId ?? application?.regulatedEntityId ?? null,
    productId: packet.productId ?? application?.productId ?? null,
    status: "vaulted",
    vaultedAt,
    vaultedBy: input.vaultedBy ?? input.actor ?? "system",
    storageCountry,
    retentionPolicyId,
    signature: {
      signatureRef: packet.signature.signatureRef,
      signedAt: packet.signature.signedAt,
      signerName: packet.signature.signerName,
      aadhaarMasked: packet.signature.aadhaarMasked,
      esignProvider: packet.signature.esignProvider
    },
    documents,
    documentCount: documents.length,
    manifestChecksumSha256: manifestHash
  };

  return {
    registry: {
      ...registry,
      [record.vaultRecordId]: record
    },
    record,
    findings: [],
    summary: summarizeFindings([]),
    existing: false
  };
}

export function listDocumentVaultRecords(registry = {}, filters = {}) {
  return Object.values(registry ?? {}).filter((record) => {
    if (filters.applicationId && record.applicationId !== filters.applicationId) return false;
    if (filters.borrowerId && record.borrowerId !== filters.borrowerId) return false;
    if (filters.packetId && record.packetId !== filters.packetId) return false;
    return true;
  });
}

function validateVaultInput(application, packet, input) {
  const findings = [];
  if (!application) {
    findings.push(createFinding("error", "RBI-DL-2025", "Application is required for document vaulting.", "application"));
  }
  if (!packet) {
    findings.push(createFinding("error", "RBI-DL-2025", "Signed document packet is required for vaulting.", "documentPacket"));
    return findings;
  }
  if (packet.status !== "signed") {
    findings.push(createFinding("error", "RBI-DL-2025", "Only signed document packets can be vaulted.", "documentPacket.status"));
  }
  if (!packet.signature?.signatureRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "Vaulted document packet requires signatureRef.", "documentPacket.signature.signatureRef"));
  }
  if (application?.applicationId && packet.applicationId !== application.applicationId) {
    findings.push(createFinding("error", "RBI-DL-2025", "Document packet applicationId must match the application.", "documentPacket.applicationId"));
  }
  const documents = packet.documents ?? [];
  for (const type of REQUIRED_DOCUMENT_TYPES) {
    if (!documents.some((document) => document.type === type)) {
      findings.push(createFinding("error", "RBI-DL-2025", `Vaulted packet is missing ${type}.`, "documentPacket.documents"));
    }
  }
  for (const document of documents) {
    if (!document.documentId) {
      findings.push(createFinding("error", "RBI-DL-2025", "Vaulted document requires documentId.", "documentPacket.documents.documentId"));
    }
    if (!/^[a-f0-9]{64}$/.test(document.checksumSha256 ?? "")) {
      findings.push(createFinding("error", "RBI-DL-2025", "Vaulted document requires a SHA-256 checksum.", "documentPacket.documents.checksumSha256"));
    }
  }
  const storageCountry = input.storageCountry ?? application?.dataResidency?.primaryStorageCountry ?? "IN";
  if (storageCountry !== "IN") {
    findings.push(createFinding("error", "RBI-PAY-DATA", "Document vault storage country must be IN.", "storageCountry"));
  }
  if (input.retentionPolicyId === "") {
    findings.push(createFinding("error", "RBI-IT-GRC", "Document vault requires a retentionPolicyId.", "retentionPolicyId"));
  }
  return findings;
}

function hash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
