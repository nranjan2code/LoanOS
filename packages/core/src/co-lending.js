import { createFinding, summarizeFindings } from "./compliance-controls.js";

// Co-Lending — RBI Co-Lending Arrangements (CLA) Directions, 2025 (effective
// January 1, 2026), which supersede the 2020 Co-Lending Model (CLM). Two or
// more regulated entities jointly originate and fund a loan under a prior
// written agreement, sharing risk and reward per disclosed proportions.
//
// Hard rules the platform enforces:
// - Each partner's funding share is disclosed and all shares sum to 100%.
// - The originating RE must retain at least a minimum share of each loan on its
//   own books (skin in the game); it cannot originate and offload the whole
//   book.
// - The borrower sees a single blended interest rate and is told the loan is
//   co-lent (single KFS, both grievance channels).
// - Funds move through a designated escrow arrangement, not pass-through
//   control by a single partner.
// - Each loan allocation must reconcile to the partner shares.

export const CO_LENDING_STATUSES = {
  PROPOSED: "proposed",
  ACTIVE: "active",
  CLOSED: "closed"
};

export const CO_LENDING_ROLES = {
  ORIGINATING: "originating",
  PARTNER: "partner"
};

export const MIN_ORIGINATING_RETENTION_PERCENT = 10;
// Allocation shares are matched to the arrangement within this rounding
// tolerance (paise-level rounding across partners).
const SHARE_TOLERANCE_PERCENT = 0.000001;
const ACTIVE_STATUS = "active";
const VALID_STATUSES = new Set(Object.values(CO_LENDING_STATUSES));

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function normalizePartner(partner = {}) {
  const sharePercent = partner.sharePercent ?? null;
  return {
    regulatedEntityId: partner.regulatedEntityId ?? null,
    role: partner.role ?? CO_LENDING_ROLES.PARTNER,
    sharePercent,
    interestSharePercent: partner.interestSharePercent ?? sharePercent,
    feeSharePercent: partner.feeSharePercent ?? sharePercent,
    transferPriceBps: partner.transferPriceBps ?? 0,
    servicingFeeBps: partner.servicingFeeBps ?? 0,
    servicingGstRateBps: partner.servicingGstRateBps ?? 0,
    servicingTdsRateBps: partner.servicingTdsRateBps ?? 0,
    grievanceContact: partner.grievanceContact ?? null
  };
}

export function computeCoLendingExposure(arrangement) {
  const allocations = arrangement?.allocations ?? [];
  const byPartner = {};
  for (const partner of arrangement?.partners ?? []) {
    byPartner[partner.regulatedEntityId] = { regulatedEntityId: partner.regulatedEntityId, sharePercent: partner.sharePercent, allocatedPaise: 0, loanCount: 0 };
  }
  for (const allocation of allocations) {
    for (const leg of allocation.legs ?? []) {
      const bucket = byPartner[leg.regulatedEntityId];
      if (bucket) {
        bucket.allocatedPaise += Math.round((Number(leg.amountInr) || 0) * 100);
        bucket.loanCount += 1;
      }
    }
  }
  const partners = Object.values(byPartner).map(({ allocatedPaise, ...bucket }) => ({ ...bucket, allocatedInr: allocatedPaise / 100 }));
  const totalAllocatedInr = partners.reduce((sum, bucket) => sum + Math.round(bucket.allocatedInr * 100), 0) / 100;
  return {
    totalAllocatedInr,
    loanCount: allocations.length,
    partners
  };
}

export function validateCoLendingArrangement(arrangement, context = {}) {
  const { regulatedEntities = {} } = context;
  const findings = [];
  const status = arrangement?.status ?? CO_LENDING_STATUSES.PROPOSED;

  if (!arrangement?.coLendingArrangementId) {
    findings.push(createFinding("error", "RBI-DL-2025", "coLendingArrangementId is required.", "coLendingArrangementId"));
  }
  if (!arrangement?.agreementRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "A prior written co-lending agreement reference is required.", "agreementRef"));
  }
  if (!arrangement?.escrowAccountRef) {
    findings.push(createFinding("error", "RBI-DL-2025", "An escrow account reference is required — funds must not be routed through a single partner's pass-through account.", "escrowAccountRef"));
  }
  if (!arrangement?.blendedRateDisclosed) {
    findings.push(createFinding("error", "RBI-KFS-2024", "The borrower must be shown a single blended interest rate (blendedRateDisclosed).", "blendedRateDisclosed"));
  }

  const partners = arrangement?.partners ?? [];
  if (partners.length < 2) {
    findings.push(createFinding("error", "RBI-DL-2025", "A co-lending arrangement requires at least two partner regulated entities.", "partners"));
  }

  const originating = partners.filter((p) => p.role === CO_LENDING_ROLES.ORIGINATING);
  if (originating.length !== 1) {
    findings.push(createFinding("error", "RBI-DL-2025", "Exactly one partner must be marked as the originating regulated entity.", "partners"));
  }

  let shareSum = 0;
  let interestShareSum = 0;
  let feeShareSum = 0;
  for (const [index, partner] of partners.entries()) {
    const share = toNumber(partner.sharePercent);
    if (!partner.regulatedEntityId) {
      findings.push(createFinding("error", "RBI-DL-2025", `Partner ${index + 1} requires a regulatedEntityId.`, `partners.${index}.regulatedEntityId`));
    } else {
      const entity = regulatedEntities[partner.regulatedEntityId];
      if (!entity) {
        findings.push(createFinding("error", "RBI-DL-2025", `Partner ${partner.regulatedEntityId} must reference an existing regulated entity.`, `partners.${index}.regulatedEntityId`));
      } else if (entity.status !== ACTIVE_STATUS) {
        findings.push(createFinding("error", "RBI-DL-2025", `Partner ${partner.regulatedEntityId} regulated entity must be active.`, `partners.${index}.regulatedEntityId`));
      }
    }
    if (!Number.isFinite(share) || share <= 0 || share >= 100) {
      findings.push(createFinding("error", "RBI-DL-2025", `Partner ${index + 1} sharePercent must be between 0 and 100 (exclusive).`, `partners.${index}.sharePercent`));
    } else {
      shareSum += share;
    }
    const interestShare = toNumber(partner.interestSharePercent);
    const feeShare = toNumber(partner.feeSharePercent);
    if (!Number.isFinite(interestShare) || interestShare < 0 || interestShare > 100) findings.push(createFinding("error", "RBI-DL-2025", `Partner ${index + 1} interestSharePercent must be between 0 and 100.`, `partners.${index}.interestSharePercent`)); else interestShareSum += interestShare;
    if (!Number.isFinite(feeShare) || feeShare < 0 || feeShare > 100) findings.push(createFinding("error", "RBI-DL-2025", `Partner ${index + 1} feeSharePercent must be between 0 and 100.`, `partners.${index}.feeSharePercent`)); else feeShareSum += feeShare;
    if (!Number.isInteger(partner.transferPriceBps) || partner.transferPriceBps < 0 || partner.transferPriceBps > 10000) findings.push(createFinding("error", "RBI-DL-2025", `Partner ${index + 1} transferPriceBps must be an integer from 0 to 10000.`, `partners.${index}.transferPriceBps`));
    if (!Number.isInteger(partner.servicingFeeBps) || partner.servicingFeeBps < 0 || partner.servicingFeeBps > 10000) findings.push(createFinding("error", "RBI-DL-2025", `Partner ${index + 1} servicingFeeBps must be an integer from 0 to 10000.`, `partners.${index}.servicingFeeBps`));
    if (![0, 1800].includes(partner.servicingGstRateBps)) findings.push(createFinding("error", "GST-ACT-2017", `Partner ${index + 1} servicingGstRateBps must be 0 or 1800.`, `partners.${index}.servicingGstRateBps`));
    if (!Number.isInteger(partner.servicingTdsRateBps) || partner.servicingTdsRateBps < 0 || partner.servicingTdsRateBps > 10000) findings.push(createFinding("error", "INCOME-TAX-ACT", `Partner ${index + 1} servicingTdsRateBps must be an integer from 0 to 10000.`, `partners.${index}.servicingTdsRateBps`));
    if (Number.isInteger(partner.servicingFeeBps) && Number.isInteger(partner.servicingGstRateBps) && Number.isInteger(partner.servicingTdsRateBps) && partner.servicingFeeBps * (10000 + partner.servicingGstRateBps - partner.servicingTdsRateBps) > 100000000) findings.push(createFinding("error", "RBI-DL-2025", `Partner ${index + 1} servicing fee plus net tax cannot exceed its gross collection entitlement.`, `partners.${index}.servicingFeeBps`));
  }

  if (partners.length >= 2 && Math.abs(shareSum - 100) > SHARE_TOLERANCE_PERCENT) {
    findings.push(createFinding("error", "RBI-DL-2025", `Partner shares must sum to 100% (currently ${shareSum}%).`, "partners"));
  }
  if (partners.length >= 2 && Math.abs(interestShareSum - 100) > SHARE_TOLERANCE_PERCENT) findings.push(createFinding("error", "RBI-DL-2025", `Partner interest shares must sum to 100% (currently ${interestShareSum}%).`, "partners"));
  if (partners.length >= 2 && Math.abs(feeShareSum - 100) > SHARE_TOLERANCE_PERCENT) findings.push(createFinding("error", "RBI-DL-2025", `Partner fee shares must sum to 100% (currently ${feeShareSum}%).`, "partners"));

  const originatingPartner = originating[0];
  if (originatingPartner) {
    const share = toNumber(originatingPartner.sharePercent);
    if (Number.isFinite(share) && share < MIN_ORIGINATING_RETENTION_PERCENT) {
      findings.push(
        createFinding(
          "error",
          "RBI-DL-2025",
          `The originating RE must retain at least ${MIN_ORIGINATING_RETENTION_PERCENT}% of each loan (currently ${share}%).`,
          "partners"
        )
      );
    }
  }

  if (!VALID_STATUSES.has(status)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Co-lending arrangement status is invalid.", "status"));
  }

  return { findings, summary: summarizeFindings(findings) };
}

export function normalizeCoLendingArrangement(input, existing = {}, now = new Date()) {
  return {
    coLendingArrangementId: input.coLendingArrangementId ?? existing.coLendingArrangementId,
    agreementRef: input.agreementRef ?? existing.agreementRef ?? null,
    escrowAccountRef: input.escrowAccountRef ?? existing.escrowAccountRef ?? null,
    blendedRateDisclosed: input.blendedRateDisclosed ?? existing.blendedRateDisclosed ?? false,
    productCode: input.productCode ?? existing.productCode ?? null,
    partners: (input.partners ?? existing.partners ?? []).map(normalizePartner),
    status: input.status ?? existing.status ?? CO_LENDING_STATUSES.PROPOSED,
    statusReason: input.statusReason ?? existing.statusReason ?? null,
    allocations: existing.allocations ?? [],
    createdAt: existing.createdAt ?? input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function upsertCoLendingArrangement(registry, input, context = {}, now = new Date()) {
  const existing = (registry ?? {})[input?.coLendingArrangementId] ?? {};
  const arrangement = normalizeCoLendingArrangement(input, existing, now);
  const validation = validateCoLendingArrangement(arrangement, context);
  if (existing.allocations?.length && (JSON.stringify(arrangement.partners) !== JSON.stringify(existing.partners) || arrangement.agreementRef !== existing.agreementRef || arrangement.escrowAccountRef !== existing.escrowAccountRef)) validation.findings.push(createFinding("error", "RBI-IT-GRC", "Agreement, escrow, and partner economics are immutable after the first loan allocation.", "partners"));
  validation.summary = summarizeFindings(validation.findings);
  const nextRegistry =
    validation.summary.status === "blocked"
      ? registry ?? {}
      : { ...(registry ?? {}), [arrangement.coLendingArrangementId]: arrangement };

  return {
    registry: nextRegistry,
    coLendingArrangement: arrangement,
    exposure: computeCoLendingExposure(arrangement),
    findings: validation.findings,
    summary: validation.summary
  };
}

// Split one loan's principal across the co-lending partners per the arrangement
// shares, enforcing that the legs reconcile to the total and match the disclosed
// proportions within rounding tolerance.
export function recordCoLendingLoanAllocation(arrangement, input = {}, now = new Date()) {
  const findings = [];
  if (!arrangement) {
    findings.push(createFinding("error", "RBI-DL-2025", "Co-lending arrangement not found.", "coLendingArrangementId"));
    return { arrangement, findings, summary: summarizeFindings(findings) };
  }
  if (arrangement.status !== CO_LENDING_STATUSES.ACTIVE) {
    findings.push(createFinding("error", "RBI-DL-2025", "Loans can only be allocated on an active co-lending arrangement.", "status"));
  }
  if (!input.loanAccountId && !input.loanApplicationId) {
    findings.push(createFinding("error", "RBI-DL-2025", "loanAccountId or loanApplicationId is required.", "loanAccountId"));
  }
  if (input.allocationId && arrangement.allocations?.some((record) => record.allocationId === input.allocationId)) findings.push(createFinding("error", "RBI-IT-GRC", "allocationId already exists.", "allocationId"));
  if (input.loanAccountId && arrangement.allocations?.some((record) => record.loanAccountId === input.loanAccountId)) findings.push(createFinding("error", "RBI-IT-GRC", "Loan account is already allocated under this arrangement.", "loanAccountId"));
  const principalInr = Number(input.principalInr);
  if (!Number.isFinite(principalInr) || principalInr <= 0 || Math.abs(principalInr * 100 - Math.round(principalInr * 100)) >= 1e-8) {
    findings.push(createFinding("error", "RBI-DL-2025", "principalInr must be a positive, paise-exact loan principal.", "principalInr"));
  }

  let legs = [];
  if (Number.isFinite(principalInr) && principalInr > 0 && arrangement.partners?.length) {
    // Allocate by share; the originating RE absorbs any rounding remainder so
    // legs always reconcile to the exact principal.
    const principalPaise = Math.round(principalInr * 100);
    let allocatedPaise = 0;
    const ordered = [...arrangement.partners].sort((a, b) =>
      (a.role === CO_LENDING_ROLES.ORIGINATING ? 1 : 0) - (b.role === CO_LENDING_ROLES.ORIGINATING ? 1 : 0)
    );
    legs = ordered.map((partner, index) => {
      let amountInr;
      if (index === ordered.length - 1) {
        amountInr = (principalPaise - allocatedPaise) / 100;
      } else {
        const amountPaise = Math.round((principalPaise * Number(partner.sharePercent)) / 100);
        amountInr = amountPaise / 100;
        allocatedPaise += amountPaise;
      }
      return { regulatedEntityId: partner.regulatedEntityId, role: partner.role, sharePercent: partner.sharePercent, interestSharePercent: partner.interestSharePercent, feeSharePercent: partner.feeSharePercent, transferPriceBps: partner.transferPriceBps, servicingFeeBps: partner.servicingFeeBps, amountInr };
    });
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { arrangement, findings, summary };
  }

  const allocation = {
    allocationId: input.allocationId ?? `cla_${arrangement.allocations.length + 1}`,
    loanAccountId: input.loanAccountId ?? null,
    loanApplicationId: input.loanApplicationId ?? null,
    principalInr,
    blendedRateBps: input.blendedRateBps ?? null,
    legs,
    allocatedAt: now.toISOString()
  };
  const allocations = [...arrangement.allocations, allocation];
  const nextArrangement = { ...arrangement, allocations, updatedAt: now.toISOString() };
  return { arrangement: nextArrangement, allocation, exposure: computeCoLendingExposure(nextArrangement), findings, summary };
}
