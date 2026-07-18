import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { routeLoanApplicationContracting } from "../apps/api/src/routes/loan-application-contracting.js";

test("contracting route owns document packet and disbursement handlers", async () => {
  const source = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
  assert.match(source, /routeLoanApplicationContracting/);
  for (const legacyName of ["documentPacketMatch", "documentPacketDeliveryMatch", "documentPacketEsignMatch", "disbursementMatch"]) {
    assert.doesNotMatch(source, new RegExp(`const ${legacyName}`));
  }
});

test("borrower cannot access another borrower's packet, e-sign or disbursement", async () => {
  const state = {
    loanApplications: {
      "application-b": { applicationId: "application-b", borrowerId: "borrower-b" }
    }
  };
  let saveCalled = false;
  const request = async (method, path) => {
    const responses = [];
    const handled = await routeLoanApplicationContracting({
      method,
      path,
      req: {},
      res: {},
      authContext: { principalType: "borrower", userId: "borrower-a" },
      store: {
        load: async () => state,
        save: async () => { saveCalled = true; }
      },
      readJson: async () => ({ aadhaarNumber: "123412341234", otp: "123456" }),
      sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload })
    });
    assert.equal(handled, true);
    assert.equal(responses[0].statusCode, 404);
    assert.equal(responses[0].payload.error.code, "not_found");
  };

  await request("GET", "/loans/applications/application-b/document-packet");
  await request("POST", "/loans/applications/application-b/document-packet/esign");
  await request("POST", "/loans/applications/application-b/disbursement");
  assert.equal(saveCalled, false);
});

test("borrower session cannot generate or deliver packets or disburse", async () => {
  const state = {
    loanApplications: {
      "application-a": { applicationId: "application-a", borrowerId: "borrower-a" }
    }
  };
  let bodyRead = false;
  const request = async (path) => {
    const responses = [];
    await routeLoanApplicationContracting({
      method: "POST",
      path,
      req: {},
      res: {},
      authContext: { principalType: "borrower", userId: "borrower-a" },
      store: { load: async () => state },
      readJson: async () => { bodyRead = true; return {}; },
      sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload })
    });
    assert.equal(responses[0].statusCode, 403);
    assert.equal(responses[0].payload.error.code, "borrower_forbidden");
  };

  await request("/loans/applications/application-a/document-packet");
  await request("/loans/applications/application-a/document-packet/delivery");
  await request("/loans/applications/application-a/disbursement");
  assert.equal(bodyRead, false);
});

test("contracting route leaves intake and underwriting paths untouched", async () => {
  assert.equal(await routeLoanApplicationContracting({ method: "POST", path: "/borrower/applications" }), false);
  assert.equal(await routeLoanApplicationContracting({ method: "POST", path: "/loans/applications/app-1/decision" }), false);
});
