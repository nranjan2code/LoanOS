import { createLoanId, rankMarketplaceOffers, validateMarketplaceNeutrality } from "@loanos/core";

/** Owns borrower product discovery and governed marketplace offer ranking. */
export async function routeLoanOriginationChannels(context) {
  const { method, path, req, res, store, readJson, sendJson, appendEvent, authContext } = context;
  if (method === "GET" && path === "/borrower/application-options") {
    const state = await store.load();
    const products = Object.values(state.productPolicies ?? {})
      .filter((product) => product.status === "active" && (product.facilityType ?? "term_loan") === "term_loan")
      .map(applicationOption);
    sendJson(res, 200, { products });
    return true;
  }

  if (path !== "/loans/marketplace-offers" && !path.startsWith("/loans/marketplace-offers/")) return false;
  if (authContext?.principalType === "borrower") {
    sendJson(res, 403, { error: { code: "borrower_forbidden", message: "This operation is not available to borrower sessions." } });
    return true;
  }

  if (method === "POST" && path === "/loans/marketplace-offers") {
    const body = await readJson(req);
    const state = await store.load();
    const activePartnerLenderIds = Object.values(state.lendingServiceProviders ?? {})
      .filter((lsp) => lsp.lspId === body.lspId && lsp.status === "active")
      .map((lsp) => lsp.regulatedEntityId);
    const validation = validateMarketplaceNeutrality(body, activePartnerLenderIds);
    const record = {
      marketplaceOfferId: body.marketplaceOfferId ?? createLoanId("mko"),
      lspId: body.lspId,
      dlaId: body.dlaId,
      offers: rankMarketplaceOffers(body.offers ?? [], body.rankingCriteria ?? "lowest_apr"),
      rankingCriteria: body.rankingCriteria,
      disclosureRef: body.disclosureRef,
      partnerLendersDisclosureRef: body.partnerLendersDisclosureRef,
      darkPatternCheck: body.darkPatternCheck,
      compliance: validation,
      createdAt: new Date().toISOString()
    };
    await store.save(appendEvent(
      { ...state, marketplaceOffers: { ...(state.marketplaceOffers ?? {}), [record.marketplaceOfferId]: record } },
      { type: "marketplace.offers.evaluated", marketplaceOfferId: record.marketplaceOfferId, status: validation.summary.status }
    ));
    sendJson(res, validation.summary.status === "blocked" ? 422 : 201, record);
    return true;
  }

  const offerMatch = path.match(/^\/loans\/marketplace-offers\/([^/]+)$/);
  if (method === "GET" && offerMatch) {
    const state = await store.load();
    const record = state.marketplaceOffers?.[decodeURIComponent(offerMatch[1])];
    if (!record) sendJson(res, 404, { error: { code: "not_found", message: "Marketplace offers not found." } });
    else sendJson(res, 200, record);
    return true;
  }
  return false;
}

function applicationOption(product) {
  return {
    productId: product.productId,
    regulatedEntityId: product.regulatedEntityId,
    productCode: product.productCode,
    productName: product.productName,
    productType: product.productType,
    minAmount: product.minAmount,
    maxAmount: product.maxAmount,
    minTenorMonths: product.minTenorMonths,
    maxTenorMonths: product.maxTenorMonths,
    annualInterestRateBps: product.annualInterestRateBps,
    repaymentFrequency: product.repaymentFrequency ?? "monthly",
    sanctionValidityDays: product.sanctionValidityDays ?? 30,
    documentRequirements: product.documentRequirements ?? null
  };
}
