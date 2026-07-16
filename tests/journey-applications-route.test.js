import test from "node:test";
import assert from "node:assert/strict";

import { routeJourneyApplications } from "../apps/api/src/routes/journey-applications.js";

function context(state, { method = "GET", path = "/journey-applications", principalType = "tenant_user", actor = "maker_1", roles = ["tenant_admin"], body = {} } = {}) {
  const sent = {};
  return { sent, value: { method, path, req: { url: path }, res: {}, tenant: { tenantId: "tenant_a" }, store: { load: async () => state, save: async () => {} }, readJson: async () => body, sendJson: (_res, status, payload) => Object.assign(sent, { status, payload }), appendEvent: (next) => next, authContext: { principalType, roles }, hasTenantAdminRole: (_context, allowed) => roles.some((role) => allowed.includes(role)), authActor: () => actor } };
}

const state = { journeyApplications: {
  "tenant_a:app_1": { tenantId: "tenant_a", applicationId: "app_1", journeyType: "personal_loan", subjectRef: "borrower_1", status: "open", proposedAt: "2026-07-16T00:00:00.000Z", proposedBy: "maker_1", assignedCheckerId: "checker_1", specialistCaseId: null, lifecycleId: "lifecycle:app_1", applicationChecksumSha256: "a".repeat(64) },
  "tenant_b:app_2": { tenantId: "tenant_b", applicationId: "app_2", journeyType: "gold_loan", subjectRef: "borrower_2", status: "open", proposedAt: "2026-07-16T00:00:00.000Z", proposedBy: "maker_2", assignedCheckerId: "checker_2", specialistCaseId: "specialist:app_2", lifecycleId: "lifecycle:app_2", applicationChecksumSha256: "b".repeat(64) }
} };

test("journey application portfolio is tenant-local and assignment-aware", async () => {
  const admin = context(state);
  await routeJourneyApplications(admin.value);
  assert.equal(admin.sent.status, 200);
  assert.deepEqual(admin.sent.payload.applications.map((item) => item.applicationId), ["app_1"]);
  const borrower = context(state, { principalType: "borrower", actor: "borrower_1", roles: [] });
  await routeJourneyApplications(borrower.value);
  assert.equal(borrower.sent.status, 200);
  assert.deepEqual(borrower.sent.payload.applications.map((item) => item.applicationId), ["app_1"]);
});

test("borrowers cannot invoke assisted application promotion", async () => {
  const borrower = context(state, { method: "POST", path: "/journey-applications/promotions", principalType: "borrower", actor: "borrower_1", roles: [], body: { proposedBy: "maker_1" } });
  await routeJourneyApplications(borrower.value);
  assert.equal(borrower.sent.status, 403);
  assert.equal(borrower.sent.payload.error.code, "journey_application_promotion_forbidden");
});
