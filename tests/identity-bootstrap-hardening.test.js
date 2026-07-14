import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptTenantUserInvite,
  createTenantUserInvite,
  isLastActiveTenantAdmin,
  upsertTenantUser
} from "../apps/api/src/identity.js";

const NOW = new Date("2026-07-15T10:00:00.000Z");

function user(users, input) {
  return upsertTenantUser(users, {
    email: `${input.userId}@example.in`,
    displayName: input.userId,
    password: "CorrectHorse1!",
    ...input
  }, NOW);
}

test("unknown administration and workflow roles fail closed", () => {
  const badAdmin = user({}, { userId: "bad-admin", adminRoles: ["tenant_admn"] });
  assert.equal(badAdmin.findings[0].code, "user_role_invalid");

  const badStaff = user({}, { userId: "bad-staff", roles: ["credit_makr"] });
  assert.equal(badStaff.findings[0].code, "user_staff_role_invalid");

  const intentionallyUnprivileged = user({}, { userId: "no-admin", adminRoles: [] });
  assert.deepEqual(intentionallyUnprivileged.findings, []);
  assert.deepEqual(intentionallyUnprivileged.user.adminRoles, [], "an explicit empty grant must not become an operator/admin default");
});

test("identity records accept the canonical roles required by product templates", () => {
  const result = user({}, {
    userId: "product-team",
    roles: ["product_manager", "credit_maker", "operations_maker", "operations_checker", "compliance_officer"]
  });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.user.roles, ["product_manager", "credit_maker", "operations_maker", "operations_checker", "compliance_officer"]);
});

test("operator and auditor do not satisfy last effective administrator protection", () => {
  let users = user({}, { userId: "owner", adminRoles: ["tenant_admin"] }).users;
  users = user(users, { userId: "operator", adminRoles: ["operator"] }).users;
  users = user(users, { userId: "auditor", adminRoles: ["auditor"] }).users;
  assert.equal(isLastActiveTenantAdmin(users, "owner"), true);

  users = user(users, { userId: "security", adminRoles: ["security_admin"] }).users;
  assert.equal(isLastActiveTenantAdmin(users, "owner"), false);
});

test("first-party invitation is single use, expiring and lets the invitee choose the password", () => {
  const invited = createTenantUserInvite({}, {
    userId: "checker",
    email: "checker@example.in",
    displayName: "Independent Checker",
    adminRoles: ["operator"],
    roles: ["credit_checker"]
  }, NOW);
  assert.equal(invited.findings.length, 0);
  assert.equal(invited.user.status, "inactive");

  const accepted = acceptTenantUserInvite(invited.users, {
    token: invited.token,
    password: "InviteeChosen1!"
  }, new Date("2026-07-16T10:00:00.000Z"));
  assert.equal(accepted.findings.length, 0);
  assert.equal(accepted.user.status, "active");
  assert.equal(acceptTenantUserInvite(accepted.users, { token: invited.token, password: "AnotherPass1!" }, NOW).findings[0].code, "invite_token_invalid");
  assert.equal(acceptTenantUserInvite(invited.users, { token: invited.token, password: "AnotherPass1!" }, new Date("2026-07-23T10:00:00.001Z")).findings[0].code, "invite_token_invalid");
});
