import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { routeLoanApplicationUnderwriting } from "../apps/api/src/routes/loan-application-underwriting.js";

test("underwriting route owns eligibility through maker-checker approval", async () => {
  const source = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
  assert.match(source, /routeLoanApplicationUnderwriting/);
  for (const legacyName of ["eligibilityMatch", "kfsMatch", "kfsAcceptMatch", "decisionMatch", "humanReviewMatch", "approvalMatch"]) {
    assert.doesNotMatch(source, new RegExp(`const ${legacyName}`));
  }
});

test("borrower ownership is enforced for eligibility and KFS acceptance", async () => {
  const state = {
    loanApplications: {
      "application-b": { applicationId: "application-b", borrowerId: "borrower-b" }
    }
  };
  let saveCalled = false;
  const request = async (method, path) => {
    const responses = [];
    const handled = await routeLoanApplicationUnderwriting({
      method,
      path,
      req: {},
      res: {},
      authContext: { principalType: "borrower", userId: "borrower-a", sessionId: "session-a" },
      store: {
        load: async () => state,
        save: async () => { saveCalled = true; }
      },
      readJson: async () => ({}),
      sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload })
    });
    assert.equal(handled, true);
    assert.equal(responses[0].statusCode, 404);
    assert.equal(responses[0].payload.error.code, "not_found");
  };

  await request("GET", "/loans/applications/application-b/eligibility");
  await request("POST", "/loans/applications/application-b/kfs/accept");
  assert.equal(saveCalled, false);
});

test("KFS acceptance requires a borrower session before state access", async () => {
  let storeRead = false;
  const responses = [];
  const handled = await routeLoanApplicationUnderwriting({
    method: "POST",
    path: "/loans/applications/application-a/kfs/accept",
    req: {},
    res: {},
    authContext: { principalType: "tenant_user", userId: "staff-a" },
    store: { load: async () => { storeRead = true; return {}; } },
    sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload })
  });

  assert.equal(handled, true);
  assert.equal(storeRead, false);
  assert.equal(responses[0].statusCode, 403);
  assert.equal(responses[0].payload.error.code, "borrower_acceptance_required");
});

test("underwriting route leaves contracting and disbursement to later boundaries", async () => {
  assert.equal(await routeLoanApplicationUnderwriting({ method: "POST", path: "/loans/applications/app-1/document-packet" }), false);
  assert.equal(await routeLoanApplicationUnderwriting({ method: "POST", path: "/loans/applications/app-1/document-packet/esign" }), false);
  assert.equal(await routeLoanApplicationUnderwriting({ method: "POST", path: "/loans/applications/app-1/disbursement" }), false);
});
