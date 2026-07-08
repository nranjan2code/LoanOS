import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { calculateAgeYears, createLoanId } from "./loan-policy.js";

const ACTIVE_STATUS = "active";
const GRANTED_STATUS = "granted";
const VERIFIED_KYC_STATUS = "verified";
const CONSENT_PURPOSES = new Set(["data_processing", "third_party_sharing", "credit_bureau", "ckyc", "communications"]);
const BORROWER_TYPES = new Set(["individual", "sole_proprietor", "company", "partnership", "llp", "trust"]);

export function validateBorrowerProfile(profile, now = new Date()) {
  const findings = [];

  if (!profile?.borrowerId) {
    findings.push(createFinding("error", "RBI-KYC-2016", "borrowerId is required.", "borrowerId"));
  }
  if (!profile?.borrowerType || !BORROWER_TYPES.has(profile.borrowerType)) {
    findings.push(createFinding("error", "RBI-KYC-2016", "borrowerType is invalid.", "borrowerType"));
  }
  if ((profile?.residencyCountry ?? "IN") !== "IN") {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower residencyCountry must be IN.", "residencyCountry"));
  }
  if ((profile?.primaryAddressCountry ?? "IN") !== "IN") {
    findings.push(createFinding("error", "RBI-DL-2025", "Borrower primaryAddressCountry must be IN.", "primaryAddressCountry"));
  }
  if (profile?.status && !["draft", "active", "suspended", "closed"].includes(profile.status)) {
    findings.push(createFinding("error", "RBI-KYC-2016", "Borrower status is invalid.", "status"));
  }

  if (profile?.borrowerType === "individual") {
    if (!profile?.fullName) {
      findings.push(createFinding("error", "RBI-KYC-2016", "Individual borrower fullName is required.", "fullName"));
    }
    const age = profile?.dateOfBirth ? calculateAgeYears(profile.dateOfBirth, now) : profile?.ageYears;
    if (!Number.isFinite(age) || age < 18) {
      findings.push(createFinding("error", "RBI-DL-2025", "Individual borrower must be at least 18.", "dateOfBirth"));
    }
  } else if (!profile?.legalName) {
    findings.push(createFinding("error", "RBI-KYC-2016", "Non-individual borrower legalName is required.", "legalName"));
  }

  if (!profile?.contact?.mobile && !profile?.contact?.email) {
    findings.push(createFinding("error", "RBI-DL-2025", "At least one borrower contact channel is required.", "contact"));
  }

  if ((profile?.status ?? ACTIVE_STATUS) === ACTIVE_STATUS) {
    if (!profile?.economicProfile?.occupation && profile.borrowerType === "individual") {
      findings.push(createFinding("error", "RBI-DL-2025", "Active individual borrower requires occupation.", "economicProfile.occupation"));
    }
    if (!Number.isFinite(profile?.economicProfile?.monthlyIncome) || profile.economicProfile.monthlyIncome <= 0) {
      findings.push(createFinding("error", "RBI-DL-2025", "Active borrower requires positive monthlyIncome.", "economicProfile.monthlyIncome"));
    }
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function normalizeBorrowerProfile(input, now = new Date()) {
  return {
    borrowerId: input.borrowerId,
    borrowerType: input.borrowerType ?? "individual",
    status: input.status ?? ACTIVE_STATUS,
    fullName: input.fullName ?? null,
    legalName: input.legalName ?? null,
    dateOfBirth: input.dateOfBirth ?? null,
    residencyCountry: input.residencyCountry ?? "IN",
    primaryAddressCountry: input.primaryAddressCountry ?? "IN",
    primaryAddress: input.primaryAddress ?? null,
    contact: {
      mobile: input.contact?.mobile ?? null,
      email: input.contact?.email ?? null
    },
    economicProfile: {
      occupation: input.economicProfile?.occupation ?? null,
      monthlyIncome: input.economicProfile?.monthlyIncome ?? null,
      employerName: input.economicProfile?.employerName ?? null,
      incomeEvidenceRef: input.economicProfile?.incomeEvidenceRef ?? null
    },
    createdAt: input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function upsertBorrowerProfile(registry, input, now = new Date()) {
  const borrower = normalizeBorrowerProfile(input, now);
  const validation = validateBorrowerProfile(borrower, now);
  const nextRegistry =
    validation.summary.status === "blocked"
      ? registry ?? {}
      : {
          ...(registry ?? {}),
          [borrower.borrowerId]: borrower
        };

  return {
    registry: nextRegistry,
    borrower,
    findings: validation.findings,
    summary: validation.summary
  };
}

export function validateConsentRecord(record) {
  const findings = [];

  if (!record?.consentId) {
    findings.push(createFinding("error", "DPDP-2023", "consentId is required.", "consentId"));
  }
  if (!record?.borrowerId) {
    findings.push(createFinding("error", "DPDP-2023", "borrowerId is required for consent.", "borrowerId"));
  }
  if (!record?.purpose || !CONSENT_PURPOSES.has(record.purpose)) {
    findings.push(createFinding("error", "DPDP-2023", "Consent purpose is invalid.", "purpose"));
  }
  if (!record?.noticeVersion) {
    findings.push(createFinding("error", "DPDP-RULES-2025", "noticeVersion is required.", "noticeVersion"));
  }
  if (!["granted", "revoked"].includes(record?.status)) {
    findings.push(createFinding("error", "DPDP-2023", "Consent status must be granted or revoked.", "status"));
  }
  if (record?.status === GRANTED_STATUS && !record?.acceptedAt) {
    findings.push(createFinding("error", "DPDP-2023", "Granted consent requires acceptedAt.", "acceptedAt"));
  }
  if (record?.status === "revoked" && !record?.revokedAt) {
    findings.push(createFinding("error", "DPDP-2023", "Revoked consent requires revokedAt.", "revokedAt"));
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function normalizeConsentRecord(input, now = new Date()) {
  return {
    consentId: input.consentId ?? createLoanId("consent"),
    borrowerId: input.borrowerId,
    purpose: input.purpose ?? "data_processing",
    status: input.status ?? GRANTED_STATUS,
    noticeVersion: input.noticeVersion,
    lawfulBasis: input.lawfulBasis ?? "consent",
    acceptedAt: input.acceptedAt ?? input.dataProcessingAcceptedAt ?? null,
    revokedAt: input.revokedAt ?? null,
    channel: input.channel ?? null,
    evidenceRef: input.evidenceRef ?? null,
    createdAt: input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function upsertConsentRecord(registry, input, borrowerProfiles = {}, now = new Date()) {
  const record = normalizeConsentRecord(input, now);
  const validation = validateConsentRecord(record);
  const findings = [...validation.findings];

  if (record.borrowerId && !borrowerProfiles[record.borrowerId]) {
    findings.push(createFinding("error", "DPDP-2023", "Consent must reference an existing borrower.", "borrowerId"));
  }

  const summary = summarizeFindings(findings);
  const nextRegistry =
    summary.status === "blocked"
      ? registry ?? {}
      : {
          ...(registry ?? {}),
          [record.consentId]: record
        };

  return {
    registry: nextRegistry,
    consent: record,
    findings,
    summary
  };
}

export function validateKycRecord(record, now = new Date()) {
  const findings = [];

  if (!record?.kycRecordId) {
    findings.push(createFinding("error", "RBI-KYC-2016", "kycRecordId is required.", "kycRecordId"));
  }
  if (!record?.borrowerId) {
    findings.push(createFinding("error", "RBI-KYC-2016", "borrowerId is required for KYC.", "borrowerId"));
  }
  if (!["created", "pending", "verified", "rejected", "expired"].includes(record?.status)) {
    findings.push(createFinding("error", "RBI-KYC-2016", "KYC status is invalid.", "status"));
  }
  if (record?.riskCategory && !["low", "medium", "high"].includes(record.riskCategory)) {
    findings.push(createFinding("error", "RBI-KYC-2016", "KYC riskCategory must be low, medium, or high.", "riskCategory"));
  }
  if (record?.status === VERIFIED_KYC_STATUS && !record?.verifiedAt) {
    findings.push(createFinding("error", "RBI-KYC-2016", "Verified KYC requires verifiedAt.", "verifiedAt"));
  }
  if (record?.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) {
    findings.push(createFinding("warning", "RBI-KYC-2016", "KYC record is expired.", "expiresAt"));
  }
  if (record?.aadhaar?.biometricStored === true || record?.aadhaar?.otpStored === true || record?.aadhaar?.pidStored === true) {
    findings.push(createFinding("error", "UIDAI-AADHAAR", "Aadhaar biometric, OTP, or PID data must not be stored.", "aadhaar"));
  }
  if (record?.vCip?.used && record.vCip.storageCountry !== "IN") {
    findings.push(createFinding("error", "RBI-KYC-2016", "V-CIP recordings and logs must be stored in India.", "vCip.storageCountry"));
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function normalizeKycRecord(input, now = new Date()) {
  return {
    kycRecordId: input.kycRecordId ?? createLoanId("kyc"),
    borrowerId: input.borrowerId,
    status: input.status ?? "pending",
    method: input.method ?? "manual",
    riskCategory: input.riskCategory ?? null,
    verifiedAt: input.verifiedAt ?? null,
    expiresAt: input.expiresAt ?? null,
    ckycRef: input.ckycRef ?? null,
    vCip: {
      used: Boolean(input.vCip?.used),
      storageCountry: input.vCip?.storageCountry ?? null,
      recordingRef: input.vCip?.recordingRef ?? null,
      activityLogRef: input.vCip?.activityLogRef ?? null
    },
    aadhaar: {
      biometricStored: Boolean(input.aadhaar?.biometricStored),
      otpStored: Boolean(input.aadhaar?.otpStored),
      pidStored: Boolean(input.aadhaar?.pidStored)
    },
    createdAt: input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function upsertKycRecord(registry, input, borrowerProfiles = {}, now = new Date()) {
  const record = normalizeKycRecord(input, now);
  const validation = validateKycRecord(record, now);
  const findings = [...validation.findings];

  if (record.borrowerId && !borrowerProfiles[record.borrowerId]) {
    findings.push(createFinding("error", "RBI-KYC-2016", "KYC record must reference an existing borrower.", "borrowerId"));
  }

  const summary = summarizeFindings(findings);
  const nextRegistry =
    summary.status === "blocked"
      ? registry ?? {}
      : {
          ...(registry ?? {}),
          [record.kycRecordId]: record
        };

  return {
    registry: nextRegistry,
    kycRecord: record,
    findings,
    summary
  };
}

export function resolveBorrowerApplicationReferences(application, registries = {}, now = new Date()) {
  const findings = [];
  let resolved = { ...application };

  if (!application.borrowerId) {
    return {
      application: resolved,
      findings,
      summary: summarizeFindings(findings)
    };
  }

  const borrower = registries.borrowerProfiles?.[application.borrowerId];
  if (!borrower) {
    findings.push(createFinding("error", "RBI-KYC-2016", "borrowerId does not match an existing borrower.", "borrowerId"));
    return {
      application: resolved,
      findings,
      summary: summarizeFindings(findings)
    };
  }
  if (borrower.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-KYC-2016", "Referenced borrower is not active.", "borrowerId"));
  }

  const dataConsent = findLatestConsent(registries.consentRecords ?? {}, borrower.borrowerId, "data_processing");
  if (!dataConsent || dataConsent.status !== GRANTED_STATUS) {
    findings.push(createFinding("error", "DPDP-2023", "Active data-processing consent is required.", "borrowerId"));
  }

  const thirdPartyConsent = application.thirdPartySharing?.enabled
    ? findLatestConsent(registries.consentRecords ?? {}, borrower.borrowerId, "third_party_sharing")
    : null;
  if (application.thirdPartySharing?.enabled && (!thirdPartyConsent || thirdPartyConsent.status !== GRANTED_STATUS)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Active third-party sharing consent is required.", "borrowerId"));
  }

  const kycRecord = findLatestKyc(registries.kycRecords ?? {}, borrower.borrowerId);
  if (!kycRecord || kycRecord.status !== VERIFIED_KYC_STATUS) {
    findings.push(createFinding("error", "RBI-KYC-2016", "A verified KYC record is required.", "borrowerId"));
  } else if (kycRecord.expiresAt && new Date(kycRecord.expiresAt).getTime() <= now.getTime()) {
    findings.push(createFinding("error", "RBI-KYC-2016", "Verified KYC record is expired.", "borrowerId"));
  }

  resolved = {
    ...resolved,
    borrower: {
      borrowerId: borrower.borrowerId,
      borrowerType: borrower.borrowerType,
      fullName: borrower.fullName,
      legalName: borrower.legalName,
      dateOfBirth: borrower.dateOfBirth,
      residencyCountry: borrower.residencyCountry,
      primaryAddressCountry: borrower.primaryAddressCountry
    },
    economicProfile: {
      ...(borrower.economicProfile ?? {}),
      ...(application.economicProfile ?? {})
    },
    consent: dataConsent
      ? {
          consentRecordId: dataConsent.consentId,
          noticeVersion: dataConsent.noticeVersion,
          dataProcessingAcceptedAt: dataConsent.acceptedAt,
          thirdPartySharingAcceptedAt: thirdPartyConsent?.acceptedAt ?? application.consent?.thirdPartySharingAcceptedAt ?? null
        }
      : application.consent,
    kyc: kycRecord
      ? {
          kycRecordId: kycRecord.kycRecordId,
          status: kycRecord.status,
          method: kycRecord.method,
          riskCategory: kycRecord.riskCategory,
          verifiedAt: kycRecord.verifiedAt,
          expiresAt: kycRecord.expiresAt,
          aadhaar: kycRecord.aadhaar,
          vCip: kycRecord.vCip
        }
      : application.kyc
  };

  return {
    application: resolved,
    findings,
    summary: summarizeFindings(findings)
  };
}

export function listBorrowerConsents(consentRecords, borrowerId) {
  return Object.values(consentRecords ?? {}).filter((record) => record.borrowerId === borrowerId);
}

export function listBorrowerKycRecords(kycRecords, borrowerId) {
  return Object.values(kycRecords ?? {}).filter((record) => record.borrowerId === borrowerId);
}

function findLatestConsent(consentRecords, borrowerId, purpose) {
  return (
    Object.values(consentRecords)
      .filter((record) => record.borrowerId === borrowerId && record.purpose === purpose)
      .sort((a, b) => latestTime(b) - latestTime(a))[0] ?? null
  );
}

function findLatestKyc(kycRecords, borrowerId) {
  return (
    Object.values(kycRecords)
      .filter((record) => record.borrowerId === borrowerId)
      .sort((a, b) => latestTime(b) - latestTime(a))[0] ?? null
  );
}

function latestTime(record) {
  return new Date(record.revokedAt ?? record.verifiedAt ?? record.acceptedAt ?? record.updatedAt ?? record.createdAt ?? 0).getTime();
}

