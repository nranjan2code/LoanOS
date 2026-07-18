import { createFinding, summarizeFindings } from "../compliance/compliance-controls.js";

export const PROVIDER_INTEGRATIONS = Object.freeze([
  "sms", "email", "whatsapp", "bureau", "vcip", "bank_account", "payment_rail",
  "esign", "cersai", "fiu", "cic", "ckycrr", "account_aggregator", "escrow", "core_banking"
]);

const PROVIDERS = new Set(PROVIDER_INTEGRATIONS);

export function validateProviderCertification(input = {}, now = new Date()) {
  const findings = [];
  if (!PROVIDERS.has(input.integration)) findings.push(createFinding("error", "RBI-IT-GRC", "Certification references an unsupported provider integration.", "integration"));
  if (!input.providerName || !input.contractRef || !input.certificationRef || !input.evidenceChecksumSha256) findings.push(createFinding("error", "RBI-OUTSOURCING-2023", "Provider, contract, certification, and evidence checksum are required.", "certification"));
  if (!/^[a-f0-9]{64}$/i.test(input.evidenceChecksumSha256 ?? "")) findings.push(createFinding("error", "RBI-IT-GRC", "Certification evidence requires a SHA-256 checksum.", "evidenceChecksumSha256"));
  if (input.environment !== "production") findings.push(createFinding("error", "RBI-IT-GRC", "Live certification must be for the production environment.", "environment"));
  if (input.dataResidencyCountry !== "IN") findings.push(createFinding("error", "RBI-DATA-RESIDENCY", "Certified provider processing must be India-resident.", "dataResidencyCountry"));
  if (!input.proposedBy || !input.approvedBy || input.proposedBy === input.approvedBy || !input.approvalRef) findings.push(createFinding("error", "RBI-IT-GRC", "Provider certification requires independent maker-checker approval.", "approval"));
  const certifiedAt = new Date(input.certifiedAt);
  const expiresAt = new Date(input.expiresAt);
  if (Number.isNaN(certifiedAt.getTime()) || Number.isNaN(expiresAt.getTime()) || expiresAt <= certifiedAt || expiresAt <= now) findings.push(createFinding("error", "RBI-OUTSOURCING-2023", "Certification needs a valid future expiry after its certification date.", "expiresAt"));
  return { findings, summary: summarizeFindings(findings) };
}

export function certifyProvider(registry = {}, input = {}, now = new Date()) {
  const validation = validateProviderCertification(input, now);
  if (validation.summary.status === "blocked") return { registry, certification: null, ...validation };
  const existing = registry[input.integration];
  if (existing?.status === "certified" && existing.certificationRef !== input.certificationRef) {
    const findings = [createFinding("error", "RBI-IT-GRC", "Suspend or expire the active certification before replacing it.", "certificationRef")];
    return { registry, certification: existing, findings, summary: summarizeFindings(findings) };
  }
  const certification = {
    integration: input.integration,
    providerName: input.providerName,
    environment: "production",
    status: "certified",
    contractRef: input.contractRef,
    certificationRef: input.certificationRef,
    evidenceChecksumSha256: input.evidenceChecksumSha256.toLowerCase(),
    dataResidencyCountry: "IN",
    certifiedAt: new Date(input.certifiedAt).toISOString(),
    expiresAt: new Date(input.expiresAt).toISOString(),
    proposedBy: input.proposedBy,
    approvedBy: input.approvedBy,
    approvalRef: input.approvalRef,
    createdAt: now.toISOString(),
    suspendedAt: null,
    suspensionReason: null
  };
  return { registry: { ...registry, [input.integration]: certification }, certification, ...validation };
}

export function suspendProviderCertification(registry = {}, integration, input = {}, now = new Date()) {
  const current = registry[integration];
  const findings = [];
  if (!current || current.status !== "certified") findings.push(createFinding("error", "RBI-IT-GRC", "An active provider certification is required.", "integration"));
  if (!input.reason || !input.suspendedBy || !input.approvedBy || input.suspendedBy === input.approvedBy || !input.approvalRef) findings.push(createFinding("error", "RBI-IT-GRC", "Suspension requires reason and independent approval.", "suspension"));
  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") return { registry, certification: current, findings, summary };
  const certification = { ...current, status: "suspended", suspendedAt: now.toISOString(), suspensionReason: input.reason, suspendedBy: input.suspendedBy, suspensionApprovedBy: input.approvedBy, suspensionApprovalRef: input.approvalRef };
  return { registry: { ...registry, [integration]: certification }, certification, findings, summary };
}

export function assessProviderCertification(registry = {}, integration, now = new Date()) {
  const certification = registry[integration] ?? null;
  if (!certification) return { certified: false, status: "missing", reason: "certification_missing", certification: null };
  if (certification.status !== "certified") return { certified: false, status: certification.status, reason: "certification_not_active", certification };
  if (new Date(certification.expiresAt).getTime() <= now.getTime()) return { certified: false, status: "expired", reason: "certification_expired", certification };
  if (certification.environment !== "production" || certification.dataResidencyCountry !== "IN") return { certified: false, status: "invalid", reason: "certification_scope_invalid", certification };
  return { certified: true, status: "certified", reason: null, certification };
}
