import { createFinding, summarizeFindings } from "../compliance/compliance-controls.js";

// Default Loss Guarantee (DLG) — RBI Digital Lending Directions, 2025
// (consolidating the "Guidelines on Default Loss Guarantee in Digital Lending"
// of June 8, 2023). A DLG is a contractual arrangement under which a Lending
// Service Provider (or other eligible entity) guarantees to compensate the
// Regulated Entity for loss due to default up to a capped percentage of the
// underlying loan portfolio.
//
// Hard rules the platform enforces:
// - Total DLG cover on an identifiable portfolio is capped at 5% of the amount
//   of that loan portfolio.
// - Permitted forms only: cash deposit, lien on a fixed deposit with a
//   scheduled commercial bank, or a bank guarantee.
// - The DLG provider must be an eligible entity — an LSP or RE governed by the
//   contracting RE, not the borrower.
// - The DLG cover tenor must be at least as long as the longest loan tenor in
//   the portfolio.
// - The RE must invoke DLG within 120 days of a loan account becoming overdue.
// - DLG does NOT defer the RE's own income-recognition, asset-classification,
//   and provisioning (NPA) duties — invocation and NPA recognition are tracked
//   independently. This module never lets a DLG invocation stand in for
//   classification.

export const DLG_FORMS = {
  CASH_DEPOSIT: "cash_deposit",
  FIXED_DEPOSIT_LIEN: "fixed_deposit_lien",
  BANK_GUARANTEE: "bank_guarantee"
};

export const DLG_STATUSES = {
  PROPOSED: "proposed",
  ACTIVE: "active",
  EXHAUSTED: "exhausted",
  EXPIRED: "expired",
  RELEASED: "released"
};

export const DLG_CAP_PERCENT = 5;
export const DLG_INVOCATION_WINDOW_DAYS = 120;

const VALID_FORMS = new Set(Object.values(DLG_FORMS));
const VALID_STATUSES = new Set(Object.values(DLG_STATUSES));
const ACTIVE_STATUS = "active";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

// Sum of invocations that have consumed cover so far.
function invokedAmountInr(arrangement) {
  return (arrangement?.invocations ?? []).reduce((sum, inv) => sum + (toInt(inv.amountInr) || 0), 0);
}

export function computeDlgPortfolioExposure(arrangement) {
  const portfolioAmountInr = toInt(arrangement?.portfolioAmountInr) || 0;
  const coverAmountInr = toInt(arrangement?.coverAmountInr) || 0;
  const capAmountInr = Math.floor((portfolioAmountInr * DLG_CAP_PERCENT) / 100);
  const invoked = invokedAmountInr(arrangement);
  const remainingCoverInr = Math.max(coverAmountInr - invoked, 0);
  return {
    portfolioAmountInr,
    coverAmountInr,
    capAmountInr,
    capPercent: DLG_CAP_PERCENT,
    coverExceedsCap: coverAmountInr > capAmountInr,
    invokedAmountInr: invoked,
    remainingCoverInr,
    coverUtilizationPercent:
      coverAmountInr > 0 ? Math.round((invoked / coverAmountInr) * 1000) / 10 : 0,
    exhausted: coverAmountInr > 0 && remainingCoverInr === 0
  };
}

export function validateDlgArrangement(arrangement, context = {}) {
  const { regulatedEntities = {}, lendingServiceProviders = {} } = context;
  const findings = [];
  const status = arrangement?.status ?? DLG_STATUSES.PROPOSED;
  const entity = arrangement?.regulatedEntityId ? regulatedEntities[arrangement.regulatedEntityId] : null;
  const provider = arrangement?.providerLspId ? lendingServiceProviders[arrangement.providerLspId] : null;

  if (!arrangement?.dlgArrangementId) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "dlgArrangementId is required.", "dlgArrangementId"));
  }
  if (!arrangement?.regulatedEntityId) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "regulatedEntityId is required for a DLG arrangement.", "regulatedEntityId"));
  } else if (!entity) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "DLG arrangement must reference an existing regulated entity.", "regulatedEntityId"));
  } else if (entity.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "DLG regulated entity must be active.", "regulatedEntityId"));
  }

  // The DLG provider must be an eligible entity governed by the RE — the
  // registered LSP — not an unvetted counterparty and never the borrower.
  if (!arrangement?.providerLspId) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "providerLspId is required — the DLG provider must be a registered LSP.", "providerLspId"));
  } else if (!provider) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "DLG provider must reference an existing lending service provider.", "providerLspId"));
  } else {
    if (provider.status !== ACTIVE_STATUS) {
      findings.push(createFinding("error", "RBI-LSP-DLG", "DLG provider LSP must be active.", "providerLspId"));
    }
    if (arrangement.regulatedEntityId && provider.regulatedEntityId !== arrangement.regulatedEntityId) {
      findings.push(createFinding("error", "RBI-LSP-DLG", "DLG provider LSP must be governed by the same regulated entity.", "providerLspId"));
    }
  }

  if (!arrangement?.agreementRef) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "A board-approved DLG agreement reference is required.", "agreementRef"));
  }

  if (!VALID_FORMS.has(arrangement?.form)) {
    findings.push(createFinding("error", "RBI-LSP-DLG", `DLG form must be one of: ${[...VALID_FORMS].join(", ")}.`, "form"));
  }

  const portfolioAmountInr = toInt(arrangement?.portfolioAmountInr);
  const coverAmountInr = toInt(arrangement?.coverAmountInr);
  if (!Number.isFinite(portfolioAmountInr) || portfolioAmountInr <= 0) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "portfolioAmountInr must be a positive amount identifying the guaranteed portfolio.", "portfolioAmountInr"));
  }
  if (!Number.isFinite(coverAmountInr) || coverAmountInr <= 0) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "coverAmountInr must be a positive DLG cover amount.", "coverAmountInr"));
  }
  if (Number.isFinite(portfolioAmountInr) && Number.isFinite(coverAmountInr) && portfolioAmountInr > 0) {
    const capAmountInr = Math.floor((portfolioAmountInr * DLG_CAP_PERCENT) / 100);
    if (coverAmountInr > capAmountInr) {
      findings.push(
        createFinding(
          "error",
          "RBI-LSP-DLG",
          `DLG cover (₹${coverAmountInr}) exceeds the ${DLG_CAP_PERCENT}% portfolio cap (₹${capAmountInr}).`,
          "coverAmountInr"
        )
      );
    }
  }

  if (!arrangement?.identifiablePortfolioId) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "identifiablePortfolioId is required — a DLG must cover an identifiable portfolio fixed at outset.", "identifiablePortfolioId"));
  }

  // The DLG cover must outlast the loans it guarantees.
  const coverTenorMonths = toInt(arrangement?.coverTenorMonths);
  const longestLoanTenorMonths = toInt(arrangement?.longestLoanTenorMonths);
  if (!Number.isFinite(coverTenorMonths) || coverTenorMonths <= 0) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "coverTenorMonths must be a positive tenor for the DLG cover.", "coverTenorMonths"));
  }
  if (!Number.isFinite(longestLoanTenorMonths) || longestLoanTenorMonths <= 0) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "longestLoanTenorMonths must state the longest loan tenor in the portfolio.", "longestLoanTenorMonths"));
  }
  if (
    Number.isFinite(coverTenorMonths) &&
    Number.isFinite(longestLoanTenorMonths) &&
    coverTenorMonths < longestLoanTenorMonths
  ) {
    findings.push(
      createFinding("error", "RBI-LSP-DLG", "DLG cover tenor must be at least the longest loan tenor in the portfolio.", "coverTenorMonths")
    );
  }

  if (!VALID_STATUSES.has(status)) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "DLG arrangement status is invalid.", "status"));
  }

  return { findings, summary: summarizeFindings(findings) };
}

export function normalizeDlgArrangement(input, existing = {}, now = new Date()) {
  return {
    dlgArrangementId: input.dlgArrangementId ?? existing.dlgArrangementId,
    regulatedEntityId: input.regulatedEntityId ?? existing.regulatedEntityId ?? null,
    providerLspId: input.providerLspId ?? existing.providerLspId ?? null,
    agreementRef: input.agreementRef ?? existing.agreementRef ?? null,
    form: input.form ?? existing.form ?? null,
    identifiablePortfolioId: input.identifiablePortfolioId ?? existing.identifiablePortfolioId ?? null,
    portfolioAmountInr: input.portfolioAmountInr ?? existing.portfolioAmountInr ?? null,
    coverAmountInr: input.coverAmountInr ?? existing.coverAmountInr ?? null,
    coverTenorMonths: input.coverTenorMonths ?? existing.coverTenorMonths ?? null,
    longestLoanTenorMonths: input.longestLoanTenorMonths ?? existing.longestLoanTenorMonths ?? null,
    status: input.status ?? existing.status ?? DLG_STATUSES.PROPOSED,
    statusReason: input.statusReason ?? existing.statusReason ?? null,
    disclosedOnDlaAt: input.disclosedOnDlaAt ?? existing.disclosedOnDlaAt ?? null,
    invocations: existing.invocations ?? [],
    createdAt: existing.createdAt ?? input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function upsertDlgArrangement(registry, input, context = {}, now = new Date()) {
  const arrangement = normalizeDlgArrangement(input, (registry ?? {})[input?.dlgArrangementId] ?? {}, now);
  const validation = validateDlgArrangement(arrangement, context);
  const nextRegistry =
    validation.summary.status === "blocked"
      ? registry ?? {}
      : { ...(registry ?? {}), [arrangement.dlgArrangementId]: arrangement };

  return {
    registry: nextRegistry,
    dlgArrangement: arrangement,
    exposure: computeDlgPortfolioExposure(arrangement),
    findings: validation.findings,
    summary: validation.summary
  };
}

// Invoke DLG against a specific overdue loan account. Enforces: the arrangement
// must be active, the account must be overdue, invocation must be within the
// 120-day window from the overdue date, and the invoked amount must not push
// cumulative invocations past the cover amount.
export function invokeDlg(arrangement, input = {}, now = new Date()) {
  const findings = [];
  if (!arrangement) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "DLG arrangement not found.", "dlgArrangementId"));
    return { arrangement, findings, summary: summarizeFindings(findings) };
  }
  if (arrangement.status !== DLG_STATUSES.ACTIVE) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "DLG can only be invoked on an active arrangement.", "status"));
  }
  if (!input.loanAccountId) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "loanAccountId is required to invoke DLG.", "loanAccountId"));
  }
  if (!input.overdueSince) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "overdueSince (the date the account became overdue) is required.", "overdueSince"));
  }
  const amountInr = toInt(input.amountInr);
  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "amountInr must be a positive invocation amount.", "amountInr"));
  }

  const overdueSince = input.overdueSince ? new Date(input.overdueSince) : null;
  const invokedAt = input.invokedAt ? new Date(input.invokedAt) : now;
  if (overdueSince && !Number.isNaN(overdueSince.getTime())) {
    const daysSinceOverdue = Math.floor((invokedAt.getTime() - overdueSince.getTime()) / MS_PER_DAY);
    if (daysSinceOverdue < 0) {
      findings.push(createFinding("error", "RBI-LSP-DLG", "Invocation cannot precede the overdue date.", "invokedAt"));
    } else if (daysSinceOverdue > DLG_INVOCATION_WINDOW_DAYS) {
      findings.push(
        createFinding(
          "error",
          "RBI-LSP-DLG",
          `DLG must be invoked within ${DLG_INVOCATION_WINDOW_DAYS} days of the account becoming overdue (this is ${daysSinceOverdue} days).`,
          "invokedAt"
        )
      );
    }
  }

  const exposure = computeDlgPortfolioExposure(arrangement);
  if (Number.isFinite(amountInr) && amountInr > exposure.remainingCoverInr) {
    findings.push(
      createFinding(
        "error",
        "RBI-LSP-DLG",
        `Invocation (₹${amountInr}) exceeds remaining DLG cover (₹${exposure.remainingCoverInr}).`,
        "amountInr"
      )
    );
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { arrangement, findings, summary };
  }

  const invocation = {
    invocationId: input.invocationId ?? `dlginv_${arrangement.invocations.length + 1}`,
    loanAccountId: input.loanAccountId,
    amountInr,
    overdueSince: overdueSince.toISOString(),
    invokedAt: invokedAt.toISOString(),
    invokedBy: input.invokedBy ?? null,
    reason: input.reason ?? null
  };
  const invocations = [...arrangement.invocations, invocation];
  const nextExposure = computeDlgPortfolioExposure({ ...arrangement, invocations });
  const nextArrangement = {
    ...arrangement,
    invocations,
    status: nextExposure.exhausted ? DLG_STATUSES.EXHAUSTED : arrangement.status,
    updatedAt: invokedAt.toISOString()
  };

  return { arrangement: nextArrangement, invocation, exposure: nextExposure, findings, summary };
}
