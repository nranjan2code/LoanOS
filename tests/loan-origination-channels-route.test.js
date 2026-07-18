import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { routeLoanOriginationChannels } from "../apps/api/src/routes/loan-origination-channels.js";

test("origination channels route owns product options and marketplace offers", async () => {
  const source = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
  assert.match(source, /routeLoanOriginationChannels/);
  assert.doesNotMatch(source, /const marketplaceOffersMatch/);
});

test("application options expose only active term-loan catalogue fields", async () => {
  const responses = [];
  const handled = await routeLoanOriginationChannels({
    method: "GET",
    path: "/borrower/application-options",
    store: {
      load: async () => ({
        productPolicies: {
          active: { productId: "active", status: "active", facilityType: "term_loan", productName: "Active loan", annualInterestRateBps: 1800, internalPolicy: "must-not-leak" },
          revolving: { productId: "revolving", status: "active", facilityType: "revolving_credit" },
          draft: { productId: "draft", status: "draft", facilityType: "term_loan" }
        }
      })
    },
    sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload })
  });

  assert.equal(handled, true);
  assert.equal(responses[0].statusCode, 200);
  assert.deepEqual(responses[0].payload.products.map(({ productId }) => productId), ["active"]);
  assert.equal(Object.hasOwn(responses[0].payload.products[0], "internalPolicy"), false);
});

test("borrower sessions cannot access marketplace offer records", async () => {
  let storeRead = false;
  const responses = [];
  const handled = await routeLoanOriginationChannels({
    method: "GET",
    path: "/loans/marketplace-offers/offer-a",
    authContext: { principalType: "borrower", userId: "borrower-a" },
    store: { load: async () => { storeRead = true; return {}; } },
    sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload })
  });

  assert.equal(handled, true);
  assert.equal(storeRead, false);
  assert.equal(responses[0].statusCode, 403);
  assert.equal(responses[0].payload.error.code, "borrower_forbidden");
});
