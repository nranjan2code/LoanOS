import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { routeFraudCases } from "../apps/api/src/routes/fraud-cases.js";

test("fraud case route owns the natural-justice HTTP family", async () => {
  const source = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
  assert.match(source, /routeFraudCases/);
  assert.doesNotMatch(source, /const fraudCaseMatch/);
  assert.doesNotMatch(source, /const fraudCommitteePackMatch/);
  assert.doesNotMatch(source, /const fraudCaseActionMatch/);
  assert.doesNotMatch(source, /function fraudCaseMatchesFilters/);
});

test("fraud case route declines unrelated paths without touching tenant state", async () => {
  let storeRead = false;
  const handled = await routeFraudCases({
    method: "GET",
    path: "/incidents",
    url: new URL("http://localhost/incidents"),
    store: { load: async () => { storeRead = true; return {}; } }
  });

  assert.equal(handled, false);
  assert.equal(storeRead, false);
});

test("fraud case creation remains fail closed for an unregistered subject", async () => {
  let saved = false;
  const responses = [];
  const handled = await routeFraudCases({
    method: "POST",
    path: "/fraud-cases",
    url: new URL("http://localhost/fraud-cases"),
    req: {},
    res: {},
    store: {
      load: async () => ({ fraudCases: {}, borrowerProfiles: {} }),
      save: async () => { saved = true; }
    },
    readJson: async () => ({
      category: "document_forgery",
      summary: "Forged salary slips",
      subjectBorrowerId: "bor_unknown",
      reportedBy: "fraud-analyst-1"
    }),
    sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload }),
    appendEvent: () => assert.fail("blocked creation must not append an audit event")
  });

  assert.equal(handled, true);
  assert.equal(saved, false);
  assert.equal(responses[0].statusCode, 422);
  assert.equal(responses[0].payload.error.code, "fraud_case_invalid");
});

test("fraud case creation persists the tenant resource and audit attribution", async () => {
  let savedState;
  const responses = [];
  const handled = await routeFraudCases({
    method: "POST",
    path: "/fraud-cases",
    url: new URL("http://localhost/fraud-cases"),
    req: {},
    res: {},
    store: {
      load: async () => ({ fraudCases: {}, borrowerProfiles: { bor_001: { borrowerId: "bor_001" } } }),
      save: async (state) => { savedState = state; }
    },
    readJson: async () => ({
      category: "document_forgery",
      summary: "Forged salary slips",
      subjectBorrowerId: "bor_001",
      reportedBy: "fraud-analyst-1"
    }),
    sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload }),
    appendEvent: (state, event) => ({ ...state, auditEvents: [event] })
  });

  assert.equal(handled, true);
  assert.equal(responses[0].statusCode, 201);
  assert.equal(Object.keys(savedState.fraudCases).length, 1);
  assert.deepEqual(savedState.auditEvents, [{
    type: "fraud_case.reported",
    fraudCaseId: responses[0].payload.fraudCase.fraudCaseId,
    category: "document_forgery",
    actor: "fraud-analyst-1"
  }]);
});

test("fraud case list retains the existing subject and category filters", async () => {
  const responses = [];
  const common = {
    status: "reported",
    summary: "Case",
    reportedBy: "analyst",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    events: []
  };
  const handled = await routeFraudCases({
    method: "GET",
    path: "/fraud-cases",
    url: new URL("http://localhost/fraud-cases?category=document_forgery&subjectBorrowerId=bor_001&asOf=2026-07-18T00:00:00.000Z"),
    res: {},
    store: {
      load: async () => ({
        fraudCases: {
          matching: { ...common, fraudCaseId: "fraud_match", category: "document_forgery", subjectBorrowerId: "bor_001" },
          other: { ...common, fraudCaseId: "fraud_other", category: "identity_fraud", subjectBorrowerId: "bor_002" }
        }
      })
    },
    sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload })
  });

  assert.equal(handled, true);
  assert.equal(responses[0].statusCode, 200);
  assert.equal(responses[0].payload.count, 1);
  assert.equal(responses[0].payload.fraudCases[0].fraudCaseId, "fraud_match");
});
