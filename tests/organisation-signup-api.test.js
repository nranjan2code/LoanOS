import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { totpCode } from "../apps/api/src/identity.js";

const jsonHeaders = (idempotencyKey, adminKey = null, signupAccessToken = null) => ({
  "content-type": "application/json",
  ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
  ...(adminKey ? { "x-platform-admin-key": adminKey } : {}),
  ...(signupAccessToken ? { "x-signup-access-token": signupAccessToken } : {})
});

async function post(base, path, body, idempotencyKey, adminKey = null, signupAccessToken = null) {
  return fetch(`${base}${path}`, { method: "POST", headers: jsonHeaders(idempotencyKey, adminKey, signupAccessToken), body: JSON.stringify(body) });
}

async function postSession(base, path, body, idempotencyKey, cookie) {
  return fetch(`${base}${path}`, { method: "POST", headers: { ...jsonHeaders(idempotencyKey), cookie }, body: JSON.stringify(body) });
}

async function createAndLoginPlatformUser(base, adminKey, userId) {
  const email = `${userId}@loanos.example`;
  let response = await post(base, "/platform/users", { userId, email, displayName: userId, password: "PlatformPass1!", mustChangePassword: false, mfaRequired: false, roles: ["platform_admin", "security_admin"] }, null, adminKey);
  assert.equal(response.status, 201);
  response = await post(base, "/auth/login", { scope: "platform", email, password: "PlatformPass1!" });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test("verified organisation admission creates only a quarantined tenant and single-use MFA owner", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-signup-api-"));
  const adminKey = "platform-signup-admin";
  const server = createLoanOsServer({ dataDir, platformAdminKey: adminKey });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const makerCookie = await createAndLoginPlatformUser(base, adminKey, "admission_maker");
  const checkerCookie = await createAndLoginPlatformUser(base, adminKey, "admission_checker");

  const starts = await Promise.all([
    post(base, "/organisation-signups", { email: "owner@verifiedbank.example", mobile: "+919876543210" }, "start-same"),
    post(base, "/organisation-signups", { email: "owner@verifiedbank.example", mobile: "+919876543210" }, "start-same")
  ]);
  assert.deepEqual(starts.map((response) => response.status).sort(), [200, 202]);
  const startBodies = await Promise.all(starts.map((response) => response.json()));
  assert.equal(startBodies[0].application.signupId, startBodies[1].application.signupId, "concurrent idempotent starts converge");
  const delivered = startBodies.find((body) => body.verificationDelivery.provider === "mock");
  const signupId = delivered.application.signupId;
  const signupToken = delivered.verificationDelivery.signupAccessToken;
  assert.equal(delivered.application.tenantActive, false);
  assert.equal((await fetch(`${base}/platform/tenants`, { headers: { "x-platform-admin-key": adminKey } }).then((response) => response.json())).tenants.length, 0);

  for (const channel of ["email", "mobile"]) {
    const unauthorised = await post(base, `/organisation-signups/${signupId}/contacts/${channel}/verification`, { challengeResponse: delivered.verificationDelivery[`${channel}Challenge`] }, `verify-${channel}-no-case-secret`);
    assert.equal(unauthorised.status, 202, "case identifier alone never authorises a public signup mutation");
    const response = await post(base, `/organisation-signups/${signupId}/contacts/${channel}/verification`, { challengeResponse: delivered.verificationDelivery[`${channel}Challenge`] }, `verify-${channel}`, null, signupToken);
    assert.equal(response.status, 200);
  }
  let response = await post(base, `/organisation-signups/${signupId}/identity`, {
    intent: "create", legalNameRef: "vault:legal-name", cin: "U65990MH2024PLC123456", gstin: "27ABCDE1234F1Z5", pan: "ABCDE1234F",
    regulatedEntityRef: "re:verified-bank", licenceRef: "rbi:licence", corporateDomain: "verifiedbank.example",
    corporateRegistryEvidenceRef: "mca:verified", taxRegistryEvidenceRef: "gst:verified", regulatedEntityLicenceEvidenceRef: "rbi:verified",
    sanctionsScreeningEvidenceRef: "screening:clear", adverseMediaEvidenceRef: "adverse:clear"
  }, "identity", null, signupToken);
  assert.equal(response.status, 200);
  response = await post(base, `/organisation-signups/${signupId}/proofs`, {
    corporateDomain: "verifiedbank.example", domainMethod: "dns", domainEvidenceRef: "dns:verified", domainVerifierRef: "provider:dns",
    representativeIdentity: "owner-authorised-representative", authorityEvidenceRef: "board-resolution:1", identityEvidenceRef: "kyc:owner",
    designationRef: "director:1", verifiedBy: "provider:representative-kyc"
  }, "proofs", null, signupToken);
  assert.equal(response.status, 200);
  const acceptance = (name) => ({ accepted: true, versionRef: `${name}:v1`, evidenceRef: `${name}:acceptance` });
  response = await post(base, `/organisation-signups/${signupId}/legal-acceptances`, { terms: acceptance("terms"), privacy: acceptance("privacy"), dpa: acceptance("dpa"), subscription: acceptance("subscription") }, "legal", null, signupToken);
  assert.equal(response.status, 200);

  const admission = {
    decision: "approved", reasonCode: "verified",
    fraudAssessmentRef: "fraud:clear", deviceRiskRef: "device:clear", rateControlRef: "rate:clear",
    sanctionsDecisionRef: "sanctions:clear", adverseRiskDecisionRef: "adverse:clear", decisionEvidenceRef: "decision:1",
    organisationRef: "org:verified-bank", proposedTenantId: "tenant_verified_bank"
  };
  response = await post(base, `/platform/organisation-signups/${signupId}/admission`, admission, "key-cannot-approve", adminKey);
  assert.equal(response.status, 403, "platform bootstrap key cannot make a human admission decision");
  response = await postSession(base, `/platform/organisation-signups/${signupId}/admission-proposal`, admission, "admission-proposal", makerCookie);
  assert.equal(response.status, 201);
  response = await postSession(base, `/platform/organisation-signups/${signupId}/admission`, {}, "self-approval", makerCookie);
  assert.equal(response.status, 422, "maker cannot approve their own proposal");
  response = await postSession(base, `/platform/organisation-signups/${signupId}/admission`, {}, "admission-approval", checkerCookie);
  assert.equal(response.status, 200);

  response = await post(base, `/platform/organisation-signups/${signupId}/tenant`, { name: "Verified Bank", isolationTier: "pooled" }, "tenant", adminKey);
  assert.equal(response.status, 201);
  const tenantCreated = await response.json();
  assert.equal(tenantCreated.tenant.status, "provisioning");
  assert.equal(tenantCreated.apiKey, undefined);

  response = await post(base, `/platform/organisation-signups/${signupId}/owner-invitation`, {}, "owner-invite", adminKey);
  assert.equal(response.status, 201);
  const invitationToken = (await response.json()).delivery.invitationToken;
  const neutral = await post(base, `/organisation-signups/not-a-real-signup/owner/mfa-setup`, { invitationToken }, "neutral");
  assert.equal(neutral.status, 202);

  response = await post(base, `/organisation-signups/${signupId}/owner/mfa-setup`, { invitationToken }, "mfa-setup");
  assert.equal(response.status, 200);
  const mfa = await response.json();
  response = await post(base, `/organisation-signups/${signupId}/owner/acceptance`, {
    invitationToken, email: "owner@verifiedbank.example", displayName: "Verified Bank Owner", password: "OwnerChosenPass1!",
    mfaSecret: mfa.secret, mfaCode: totpCode(mfa.secret), activationEvidenceRef: "activation:totp"
  }, "owner-accept");
  assert.equal(response.status, 201);
  const ownerAccepted = await response.json();
  assert.equal(ownerAccepted.owner.bootstrapAuthority, "bootstrap_owner");
  assert.equal(ownerAccepted.owner.mfaEnabled, true);
  assert.equal(ownerAccepted.owner.mfaSetupPending, false);

  response = await post(base, "/auth/login", {
    scope: "tenant",
    tenantId: "tenant_verified_bank",
    email: "owner@verifiedbank.example",
    password: "OwnerChosenPass1!",
    mfaCode: totpCode(mfa.secret)
  });
  assert.equal(response.status, 200, "verified first owner can enter the provisioning control plane");
  const ownerLogin = await response.json();
  assert.equal(ownerLogin.session.restricted, "bootstrap");
  const ownerCookie = response.headers.get("set-cookie").split(";")[0];

  response = await fetch(`${base}/admin/me`, { headers: { cookie: ownerCookie } });
  assert.equal(response.status, 200, "bootstrap owner can inspect their quarantined tenant context");
  response = await fetch(`${base}/admin/users`, { headers: { cookie: ownerCookie } });
  assert.equal(response.status, 403, "bootstrap session cannot browse the general tenant administration plane");
  const bootstrapExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  response = await postSession(base, `/admin/identity-governance/principals/${ownerAccepted.owner.userId}/sync`, {
    identityEvidenceRef: "verified-user:first-owner",
    bootstrapRole: "bootstrap_owner",
    authorizedRepresentativeEvidenceRef: "verified-authorised-representative:first-owner",
    expiresAt: bootstrapExpiresAt
  }, "sync-bootstrap-owner", ownerCookie);
  assert.equal(response.status, 200, "first owner binds the canonical bootstrap authority to their verified login");
  response = await postSession(base, "/admin/users/invite", {
    userId: "bootstrap_checker_candidate",
    email: "checker@verifiedbank.example",
    displayName: "Verified Bank Bootstrap Checker",
    adminRoles: ["user_admin"],
    roles: ["operations_checker"],
    mfaRequired: true
  }, "invite-bootstrap-checker", ownerCookie);
  assert.equal(response.status, 201, "first owner can invite the independent next administrator");
  const checkerInvitation = await response.json();

  response = await post(base, "/auth/accept-invite", {
    tenantId: "tenant_verified_bank",
    token: checkerInvitation.inviteToken,
    password: "CheckerChosenPass1!"
  });
  assert.equal(response.status, 200, "next administrator chooses their own password through the single-use invitation");
  response = await post(base, "/auth/login", {
    scope: "tenant",
    tenantId: "tenant_verified_bank",
    email: "checker@verifiedbank.example",
    password: "CheckerChosenPass1!"
  });
  assert.equal(response.status, 200, "next user receives only an MFA-setup session during provisioning");
  const checkerSetupLogin = await response.json();
  assert.equal(checkerSetupLogin.session.restricted, "mfa_setup");
  const checkerSetupCookie = response.headers.get("set-cookie").split(";")[0];
  response = await postSession(base, "/auth/mfa/setup", { password: "CheckerChosenPass1!" }, null, checkerSetupCookie);
  assert.equal(response.status, 200);
  const checkerMfa = await response.json();
  response = await postSession(base, "/auth/mfa/enable", { code: totpCode(checkerMfa.secret) }, null, checkerSetupCookie);
  assert.equal(response.status, 200, "MFA is mandatory before checker authority can be bound");

  response = await postSession(base, "/admin/identity-governance/principals/bootstrap_checker_candidate/sync", {
    identityEvidenceRef: "verified-user:bootstrap-checker",
    bootstrapRole: "bootstrap_checker",
    authorizedRepresentativeEvidenceRef: "verified-authorised-representative:bootstrap-checker",
    expiresAt: bootstrapExpiresAt
  }, "sync-bootstrap-checker", ownerCookie);
  assert.equal(response.status, 200, "owner may bind only a verified, MFA-enrolled independent checker");
  response = await post(base, "/auth/login", {
    scope: "tenant",
    tenantId: "tenant_verified_bank",
    email: "checker@verifiedbank.example",
    password: "CheckerChosenPass1!",
    mfaCode: totpCode(checkerMfa.secret)
  });
  assert.equal(response.status, 200);
  const checkerLogin = await response.json();
  assert.equal(checkerLogin.session.restricted, "bootstrap");

  const replay = await post(base, `/organisation-signups/${signupId}/owner/acceptance`, { invitationToken, email: "owner@verifiedbank.example", password: "OtherPass1!", mfaSecret: mfa.secret, mfaCode: totpCode(mfa.secret) }, "owner-replay");
  assert.equal(replay.status, 202, "used invitation is neutral and cannot change credentials");

  response = await post(base, `/platform/organisation-signups/${signupId}/provisioning`, { sagaId: "saga_verified_bank", deploymentBlueprintRef: "blueprint:shared-v1", subscriptionRef: "subscription:verified-bank" }, "provision", adminKey);
  assert.equal(response.status, 202);
  response = await post(base, `/platform/organisation-signups/${signupId}/activation`, {}, "activate", adminKey);
  assert.equal(response.status, 409);
  const blocked = await response.json();
  assert.deepEqual(blocked.blockers, ["provisioning", "roleCoverage", "uat", "handover"]);
  response = await post(base, "/platform/tenants/tenant_verified_bank/status", { status: "active" }, null, adminKey);
  assert.equal(response.status, 409, "generic tenant status endpoint cannot bypass signup gates");

  const persisted = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
  const storedSignup = persisted.controlPlane.organisationSignups[signupId];
  assert.equal(storedSignup.status, "provisioning_requested");
  assert.equal(storedSignup.ownerInvitation.tokenHashSha256, null);
  assert.equal(storedSignup.ownerMfaEnrollment, null);
  assert(storedSignup.auditEvents.length >= 8);
  assert(persisted.controlPlane.platformEvents.some((event) => event.type === "platform.organisation_signup.owner_activated"));
});

test("production mode disables direct active-tenant minting", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-signup-direct-disabled-"));
  const adminKey = "platform-direct-disabled-admin";
  const server = createLoanOsServer({
    dataDir,
    platformAdminKey: adminKey,
    allowDirectTenantProvisioning: false
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await post(base, "/platform/tenants", {
    tenantId: "tenant_unverified_direct",
    name: "Unverified Direct Tenant",
    status: "active"
  }, "direct-tenant", adminKey);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "verified_organisation_admission_required");
});
