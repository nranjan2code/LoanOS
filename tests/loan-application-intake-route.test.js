import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { routeLoanApplicationIntake } from "../apps/api/src/routes/loan-application-intake.js";

test("loan application intake route owns capture and pre-decision evidence paths", async () => {
  const serverSource = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
  assert.match(serverSource, /routeLoanApplicationIntake/);
  assert.doesNotMatch(serverSource, /const applicationDocumentsMatch/);
  assert.doesNotMatch(serverSource, /const applicationConditionsMatch/);
  assert.doesNotMatch(serverSource, /method === "POST" && \["\/loans\/applications", "\/borrower\/applications"\]/);
});

test("borrower application list is filtered to the authenticated borrower", async () => {
  const responses = [];
  const handled = await routeLoanApplicationIntake({
    method: "GET",
    path: "/loans/applications",
    authContext: { principalType: "borrower", userId: "borrower-a" },
    store: {
      load: async () => ({
        loanApplications: {
          first: { applicationId: "first", borrowerId: "borrower-a" },
          second: { applicationId: "second", borrower: { borrowerId: "borrower-b" } }
        }
      })
    },
    sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload })
  });

  assert.equal(handled, true);
  assert.equal(responses[0].statusCode, 200);
  assert.deepEqual(responses[0].payload.applications.map(({ applicationId }) => applicationId), ["first"]);
});

test("self-service capture fails closed without a borrower session", async () => {
  let storeRead = false;
  const responses = [];
  const handled = await routeLoanApplicationIntake({
    method: "POST",
    path: "/borrower/applications",
    req: {},
    res: {},
    authContext: { principalType: "tenant_user", userId: "staff-a" },
    readJson: async () => ({}),
    store: { load: async () => { storeRead = true; return {}; } },
    sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload })
  });

  assert.equal(handled, true);
  assert.equal(storeRead, false);
  assert.equal(responses[0].statusCode, 403);
  assert.equal(responses[0].payload.error.code, "borrower_session_required");
});

test("borrower cannot read readiness or add documents for another borrower application", async () => {
  const state = {
    loanApplications: {
      "application-b": { applicationId: "application-b", borrowerId: "borrower-b" }
    }
  };
  let saveCalled = false;
  const request = async (method, path) => {
    const responses = [];
    const handled = await routeLoanApplicationIntake({
      method,
      path,
      req: {},
      res: {},
      authContext: { principalType: "borrower", userId: "borrower-a" },
      store: {
        load: async () => state,
        save: async () => { saveCalled = true; }
      },
      readJson: async () => ({ type: "identity", storageRef: "vault:other-borrower" }),
      sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload })
    });
    assert.equal(handled, true);
    assert.equal(responses[0].statusCode, 404);
    assert.equal(responses[0].payload.error.code, "not_found");
  };

  await request("GET", "/loans/applications/application-b");
  await request("GET", "/loans/applications/application-b/origination-readiness");
  await request("POST", "/loans/applications/application-b/documents");
  assert.equal(saveCalled, false);
});

test("loan application intake route declines unrelated and later-stage paths", async () => {
  assert.equal(await routeLoanApplicationIntake({ method: "GET", path: "/loan-accounts" }), false);
  assert.equal(await routeLoanApplicationIntake({ method: "POST", path: "/loans/applications/app-1/decision" }), false);
  assert.equal(await routeLoanApplicationIntake({ method: "POST", path: "/loans/applications/app-1/kfs" }), false);
});
