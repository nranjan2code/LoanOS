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
const SHARE_TOLERANCE_PERCENT = 0.5;
const ACTIVE_STATUS = "active";
const VALID_STATUSES = new Set(Object.values(CO_LENDING_STATUSES));

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function normalizePartner(partner = {}) {
  return {
    regulatedEntityId: partner.regulatedEntityId ?? null,
    role: partner.role ?? CO_LENDING_ROLES.PARTNER,
    sharePercent: partner.sharePercent ?? null,
    grievanceContact: partner.grievanceContact ?? null
  };
}

export function computeCoLendingExposure(arrangement) {
  const allocations = arrangement?.allocations ?? [];
  const byPartner = {};
  for (const partner of arrangement?.partners ?? []) {
    byPartner[partner.regulatedEntityId] = { regulatedEntityId: partner.regulatedEntityId, sharePercent: partner.sharePercent, allocatedInr: 0, loanCount: 0 };
  }
  for (const allocation of allocations) {
    for (const leg of allocation.legs ?? []) {
      const bucket = byPartner[leg.regulatedEntityId];
      if (bucket) {
        bucket.allocatedInr += Number(leg.amountInr) || 0;
        bucket.loanCount += 1;
      }
    }
  }
  const totalAllocatedInr = Object.values(byPartner).reduce((sum, b) => sum + b.allocatedInr, 0);
  return {
    totalAllocatedInr,
    loanCount: allocations.length,
    partners: Object.values(byPartner)
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
  }

  if (partners.length >= 2 && Math.abs(shareSum - 100) > SHARE_TOLERANCE_PERCENT) {
    findings.push(createFinding("error", "RBI-DL-2025", `Partner shares must sum to 100% (currently ${shareSum}%).`, "partners"));
  }

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
  const arrangement = normalizeCoLendingArrangement(input, (registry ?? {})[input?.coLendingArrangementId] ?? {}, now);
  const validation = validateCoLendingArrangement(arrangement, context);
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
  const principalInr = Number(input.principalInr);
  if (!Number.isFinite(principalInr) || principalInr <= 0) {
    findings.push(createFinding("error", "RBI-DL-2025", "principalInr must be a positive loan principal.", "principalInr"));
  }

  let legs = [];
  if (Number.isFinite(principalInr) && principalInr > 0 && arrangement.partners?.length) {
    // Allocate by share; the originating RE absorbs any rounding remainder so
    // legs always reconcile to the exact principal.
    let allocated = 0;
    const ordered = [...arrangement.partners].sort((a, b) =>
      (a.role === CO_LENDING_ROLES.ORIGINATING ? 1 : 0) - (b.role === CO_LENDING_ROLES.ORIGINATING ? 1 : 0)
    );
    legs = ordered.map((partner, index) => {
      let amountInr;
      if (index === ordered.length - 1) {
        amountInr = principalInr - allocated;
      } else {
        amountInr = Math.round((principalInr * Number(partner.sharePercent)) / 100);
        allocated += amountInr;
      }
      return { regulatedEntityId: partner.regulatedEntityId, role: partner.role, sharePercent: partner.sharePercent, amountInr };
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
