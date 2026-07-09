import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { createLoanId } from "./loan-policy.js";

// Every disclosure of a borrower's personal data to a third party is recorded as
// a ledger entry (DPDP record-of-processing). Sharing on the basis of consent is
// blocked unless an active third-party-sharing consent stands; sharing compelled
// by law (e.g. CIC/CERSAI/regulator reporting) is permitted without consent but
// is still recorded, so the borrower can always see who received their data.

export const SHARING_RECIPIENT_TYPES = new Set([
  "lsp",
  "credit_information_company",
  "recovery_agent",
  "sub_processor",
  "regulator",
  "other"
]);

export const SHARING_LEGAL_BASES = new Set(["consent", "legal_obligation", "contract"]);
const CONSENT_PURPOSE = "third_party_sharing";
const GRANTED_STATUS = "granted";

function findActiveSharingConsent(consentRecords = {}, borrowerId) {
  return (
    Object.values(consentRecords)
      .filter(
        (record) =>
          record.borrowerId === borrowerId &&
          record.purpose === CONSENT_PURPOSE &&
          record.status === GRANTED_STATUS
      )
      .sort((a, b) => new Date(b.acceptedAt ?? 0).getTime() - new Date(a.acceptedAt ?? 0).getTime())[0] ?? null
  );
}

export function recordDataDisclosure(registry = {}, input = {}, context = {}, now = new Date()) {
  const findings = [];
  if (!input.borrowerId) {
    findings.push(createFinding("error", "DPDP-2023", "Data disclosure requires a borrowerId.", "borrowerId"));
  }
  if (input.borrowerId && context.borrowerProfiles && !context.borrowerProfiles[input.borrowerId]) {
    findings.push(createFinding("error", "DPDP-2023", "Data disclosure borrower is not registered.", "borrowerId"));
  }
  if (!input.recipientName) {
    findings.push(createFinding("error", "DPDP-2023", "Data disclosure requires a recipientName.", "recipientName"));
  }
  if (!SHARING_RECIPIENT_TYPES.has(input.recipientType)) {
    findings.push(createFinding("error", "DPDP-2023", "Data disclosure recipientType is invalid.", "recipientType"));
  }
  if (!input.purpose) {
    findings.push(createFinding("error", "DPDP-2023", "Data disclosure requires a purpose.", "purpose"));
  }
  if (!Array.isArray(input.dataCategories) || input.dataCategories.length === 0) {
    findings.push(createFinding("error", "DPDP-2023", "Data disclosure requires at least one data category.", "dataCategories"));
  }
  const legalBasis = input.legalBasis ?? "consent";
  if (!SHARING_LEGAL_BASES.has(legalBasis)) {
    findings.push(createFinding("error", "DPDP-2023", "Data disclosure legalBasis is invalid.", "legalBasis"));
  }

  // Consent-based sharing needs a standing third-party-sharing consent; a
  // statutory obligation does not (but is still logged).
  const consent = input.borrowerId ? findActiveSharingConsent(context.consentRecords, input.borrowerId) : null;
  if (legalBasis === "consent" && !consent) {
    findings.push(
      createFinding("error", "DPDP-2023", "Consent-based data sharing requires an active third-party-sharing consent.", "legalBasis")
    );
  }
  if (legalBasis === "legal_obligation" && !input.legalReference) {
    findings.push(
      createFinding("error", "DPDP-2023", "Data sharing under legal obligation requires a legalReference.", "legalReference")
    );
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { registry, disclosure: null, findings, summary };
  }

  const disclosure = {
    disclosureId: input.disclosureId ?? createLoanId("disclosure"),
    borrowerId: input.borrowerId,
    recipientName: input.recipientName,
    recipientType: input.recipientType,
    purpose: input.purpose,
    dataCategories: input.dataCategories,
    legalBasis,
    consentId: legalBasis === "consent" ? consent.consentId : null,
    legalReference: input.legalReference ?? null,
    disclosedAt: input.disclosedAt ?? now.toISOString(),
    actor: input.actor ?? null
  };
  const event = {
    eventId: createLoanId("disclosureevt"),
    type: "data_disclosure.recorded",
    at: now.toISOString(),
    disclosureId: disclosure.disclosureId,
    borrowerId: disclosure.borrowerId,
    recipientType: disclosure.recipientType,
    legalBasis: disclosure.legalBasis
  };

  return {
    registry: { ...registry, [disclosure.disclosureId]: disclosure },
    disclosure,
    event,
    findings: [],
    summary: summarizeFindings([])
  };
}

export function listDataDisclosures(registry = {}, borrowerId) {
  return Object.values(registry).filter((record) => !borrowerId || record.borrowerId === borrowerId);
}
