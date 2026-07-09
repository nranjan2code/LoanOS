import { createFinding, summarizeFindings } from "./compliance-controls.js";

/**
 * Validates offer marketplace neutrality and dark patterns.
 * 
 * @param {Object} evaluationRequest - The marketplace evaluation payload.
 * @param {string[]} activePartnerLenderIds - Array of active partner Regulated Entity IDs for the LSP.
 * @returns {Object} { findings, summary }
 */
export function validateMarketplaceNeutrality(evaluationRequest, activePartnerLenderIds = []) {
  const findings = [];

  if (!evaluationRequest) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "Marketplace evaluation request is required.", "request"));
    return { findings, summary: summarizeFindings(findings) };
  }

  const {
    lspId,
    dlaId,
    offers = [],
    rankingCriteria,
    disclosureRef,
    partnerLendersDisclosureRef,
    darkPatternCheck = {}
  } = evaluationRequest;

  if (!lspId) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "lspId is required.", "lspId"));
  }
  if (!dlaId) {
    findings.push(createFinding("error", "RBI-LSP-DLG", "dlaId is required.", "dlaId"));
  }

  // Dark pattern check validation
  if (darkPatternCheck.preSelectedLender === true) {
    findings.push(
      createFinding(
        "error",
        "CCPA-DARK-PATTERNS",
        "Pre-selecting a lender's offer is a prohibited dark pattern.",
        "darkPatternCheck.preSelectedLender"
      )
    );
  }
  if (darkPatternCheck.preSelectedAddOns === true) {
    findings.push(
      createFinding(
        "error",
        "CCPA-DARK-PATTERNS",
        "Pre-checking optional non-credit services is a prohibited dark pattern.",
        "darkPatternCheck.preSelectedAddOns"
      )
    );
  }
  if (darkPatternCheck.deceptiveUrgency === true) {
    findings.push(
      createFinding(
        "error",
        "CCPA-DARK-PATTERNS",
        "Artificial urgency countdowns or messages are prohibited dark patterns.",
        "darkPatternCheck.deceptiveUrgency"
      )
    );
  }
  if (darkPatternCheck.commercialBias === true) {
    findings.push(
      createFinding(
        "error",
        "CCPA-DARK-PATTERNS",
        "Promotional bias based on commercial deals/kickbacks rather than objective criteria is prohibited.",
        "darkPatternCheck.commercialBias"
      )
    );
  }
  if (darkPatternCheck.obfuscatedCost === true) {
    findings.push(
      createFinding(
        "error",
        "CCPA-DARK-PATTERNS",
        "Hiding or obfuscating fee breakdowns or APR is a prohibited dark pattern.",
        "darkPatternCheck.obfuscatedCost"
      )
    );
  }

  // Disclosure check
  if (!disclosureRef) {
    findings.push(
      createFinding("error", "CCPA-DARK-PATTERNS", "Ranking criteria disclosure reference is required.", "disclosureRef")
    );
  }
  if (!partnerLendersDisclosureRef) {
    findings.push(
      createFinding("error", "CCPA-DARK-PATTERNS", "Partner lenders disclosure reference is required.", "partnerLendersDisclosureRef")
    );
  }

  // Ranking criteria validation
  const allowedCriteria = new Set(["lowest_apr", "highest_tenor", "lowest_processing_fee", "alphabetical"]);
  if (!rankingCriteria || !allowedCriteria.has(rankingCriteria)) {
    findings.push(
      createFinding(
        "error",
        "RBI-LSP-DLG",
        "rankingCriteria must be an objective criteria: lowest_apr, highest_tenor, lowest_processing_fee, or alphabetical.",
        "rankingCriteria"
      )
    );
  }

  // Verify partner completeness to prevent hiding partners
  const offeredReIds = new Set(offers.map((o) => o.regulatedEntityId).filter(Boolean));
  for (const partnerId of activePartnerLenderIds) {
    if (!offeredReIds.has(partnerId)) {
      findings.push(
        createFinding(
          "error",
          "CCPA-DARK-PATTERNS",
          `Active partner lender ${partnerId} must be represented in the offer comparison view (either with an offer or marked as unmatched/not offered).`,
          `offers`
        )
      );
    }
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

/**
 * Ranks matched offers neutrally according to objective criteria.
 * 
 * @param {Object[]} offers - Array of offers.
 * @param {string} criteria - Objective ranking criteria.
 * @returns {Object[]} Sorted offers array.
 */
export function rankMarketplaceOffers(offers = [], criteria = "lowest_apr") {
  const matched = offers.filter((o) => o.status !== "not_offered" && o.status !== "unmatched");
  const unmatched = offers.filter((o) => o.status === "not_offered" || o.status === "unmatched");

  matched.sort((a, b) => {
    let diff = 0;
    if (criteria === "lowest_apr") {
      diff = (a.aprBps ?? 0) - (b.aprBps ?? 0);
    } else if (criteria === "highest_tenor") {
      diff = (b.tenorMonths ?? 0) - (a.tenorMonths ?? 0);
    } else if (criteria === "lowest_processing_fee") {
      diff = (a.processingFee ?? 0) - (b.processingFee ?? 0);
    }

    // Secondary tie-breaker: alphabetical by RE name
    if (diff === 0) {
      const nameA = (a.regulatedEntityName ?? "").toLowerCase();
      const nameB = (b.regulatedEntityName ?? "").toLowerCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    }
    return diff;
  });

  return [...matched, ...unmatched];
}
