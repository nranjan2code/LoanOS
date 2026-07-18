import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  acceptSignupLegalDocuments, activateFirstOwner, appealOrganisationRejection,
  cancelOrganisationSignup, decideOrganisationAdmission, decideOrganisationAppeal,
  issueFirstOwnerInvitation, projectOrganisationSignup, recordAuthorisedRepresentativeProof,
  recordCorporateDomainProof, requestTenantProvisioning, resumeOrganisationReverification,
  resumeOrganisationSignup, startOrganisationSignup, submitOrganisationIdentity, verifySignupContact
} from "@loanos/core/platform/organisation-signup.js";

const NOW = new Date("2026-07-15T10:00:00Z");
const h = (value) => createHash("sha256").update(value).digest("hex");
const scope = { platformRealmId: "india-prod", signupId: "signup-1" };
const command = (idempotencyKey, extra = {}) => ({ ...scope, idempotencyKey, actor: "platform:operator", ...extra });

function started(registry = {}) {
  return startOrganisationSignup(registry, {
    ...scope, idempotencyKey: "start-1", requestedBy: "prospect:1", emailHashSha256: h("owner@example.test"),
    mobileHashSha256: h("+919999999999"), emailChallengeHashSha256: h("email-otp"), mobileChallengeHashSha256: h("mobile-otp"),
    challengeExpiresAt: "2026-07-15T10:15:00Z", expiresAt: "2026-07-30T10:00:00Z"
  }, NOW);
}
function contacts(registry = started().registry) {
  let result = verifySignupContact(registry, scope.signupId, command("email-verify", { channel: "email", responseHashSha256: h("email-otp"), verificationEvidenceRef: "verify:email" }), NOW);
  return verifySignupContact(result.registry, scope.signupId, command("mobile-verify", { channel: "mobile", responseHashSha256: h("mobile-otp"), verificationEvidenceRef: "verify:mobile" }), NOW);
}
function identity(registry = contacts().registry, overrides = {}) {
  return submitOrganisationIdentity(registry, scope.signupId, command("identity", {
    intent: "create", legalNameRef: "legal-name:1", cin: "U65990MH2024PLC123456", gstin: "27ABCDE1234F1Z5", pan: "ABCDE1234F",
    regulatedEntityRef: "re:1", licenceRef: "rbi-licence:1", corporateDomainHashSha256: h("bank.example"),
    corporateRegistryEvidenceRef: "mca:evidence", taxRegistryEvidenceRef: "gst:evidence", regulatedEntityLicenceEvidenceRef: "rbi:evidence",
    sanctionsScreeningEvidenceRef: "sanctions:evidence", adverseMediaEvidenceRef: "adverse:evidence", ...overrides
  }), NOW);
}
function evidenced(registry = identity().registry) {
  let result = recordCorporateDomainProof(registry, scope.signupId, command("domain", { domainHashSha256: h("bank.example"), method: "dns", evidenceRef: "dns:evidence", verifiedBy: "platform:domain-verifier" }), NOW);
  result = recordAuthorisedRepresentativeProof(result.registry, scope.signupId, command("representative", { representativeIdentityHashSha256: h("owner-identity"), authorityEvidenceRef: "board-resolution:1", identityEvidenceRef: "kyc:owner", designationRef: "designation:director", verifiedBy: "platform:kyc" }), NOW);
  return acceptSignupLegalDocuments(result.registry, scope.signupId, command("legal", {
    acceptedBy: "prospect:1", terms: accepted("terms:v3"), privacy: accepted("privacy:v2"), dpa: accepted("dpa:v4"), subscription: accepted("subscription:v1")
  }), NOW);
}
function accepted(versionRef) { return { accepted: true, versionRef, evidenceRef: `acceptance:${versionRef}` }; }
function approved(registry = evidenced().registry, overrides = {}) {
  return decideOrganisationAdmission(registry, scope.signupId, command("admit", {
    proposedBy: "risk:maker", decidedBy: "risk:checker", decision: "approved", reasonCode: "all_checks_passed",
    fraudAssessmentRef: "fraud:1", deviceRiskRef: "device:1", rateControlRef: "rate:1", sanctionsDecisionRef: "sanctions:clear",
    adverseRiskDecisionRef: "adverse:clear", decisionEvidenceRef: "admission:1", organisationRef: "org:1", proposedTenantId: "tenant-1", ...overrides
  }), NOW);
}

test("signup is idempotent, stores only challenge digests and cannot become active", () => {
  const result = started();
  const replay = startOrganisationSignup(result.registry, {
    ...scope, idempotencyKey: "start-1", requestedBy: "prospect:1", emailHashSha256: h("owner@example.test"), mobileHashSha256: h("+919999999999"),
    emailChallengeHashSha256: h("email-otp"), mobileChallengeHashSha256: h("mobile-otp"), challengeExpiresAt: "2026-07-15T10:15:00Z", expiresAt: "2026-07-30T10:00:00Z"
  }, NOW);
  assert.equal(replay.idempotent, true); assert.equal(result.signup.status, "signup_pending");
  assert.equal(JSON.stringify(result.signup).includes("email-otp"), false); assert.equal(result.signup.auditEvents.length, 1);
  assert.equal(result.signup.outboxEvents.length, 1); assert.equal(projectOrganisationSignup(result.signup, NOW).tenantActive, false);
});

test("email and mobile verification fail closed and require hashed responses", () => {
  const result = started();
  const wrong = verifySignupContact(result.registry, scope.signupId, command("wrong", { channel: "email", responseHashSha256: h("wrong"), verificationEvidenceRef: "verify:failed" }), NOW);
  assert.equal(wrong.signup.contact.challenges.email.verifiedAt, null); assert.equal(wrong.signup.contact.challenges.email.attemptCount, 1);
  const verified = contacts(result.registry); assert.equal(verified.signup.status, "contacts_verified");
  assert.throws(() => submitOrganisationIdentity(started().registry, scope.signupId, command("early", {}), NOW), error => error.code === "organisation_signup_contacts_unverified");
});

test("repeated challenge failures are evidenced and route signup to manual review", () => {
  let result = started();
  for (let attempt = 1; attempt <= 5; attempt += 1) result = verifySignupContact(result.registry, scope.signupId, command(`wrong-${attempt}`, { channel: "email", responseHashSha256: h(`wrong-${attempt}`), verificationEvidenceRef: `verify:failed:${attempt}` }), NOW);
  assert.equal(result.signup.status, "admission_manual_review");
  assert.equal(result.signup.contact.challenges.email.lastAttemptEvidenceRef, "verify:failed:5");
  assert.throws(() => verifySignupContact(result.registry, scope.signupId, command("locked", { channel: "email", responseHashSha256: h("email-otp"), verificationEvidenceRef: "verify:late" }), NOW), error => error.code === "organisation_signup_challenge_locked");
});

test("organisation identity requires Indian legal, tax, licence and screening evidence", () => {
  const result = identity(); assert.equal(result.signup.organisation.cin, "U65990MH2024PLC123456");
  assert.equal(result.signup.organisation.evidence.regulatedEntityLicenceEvidenceRef, "rbi:evidence");
  assert.throws(() => identity(contacts().registry, { pan: "invalid" }), error => error.code === "organisation_signup_invalid");
});

test("duplicate create and concurrent organisation claims are rejected", () => {
  const first = identity();
  const secondStart = startedWithId(first.registry, "signup-2"); const secondContacts = contactsFor(secondStart.registry, "signup-2", "2");
  assert.throws(() => identityFor(secondContacts.registry, "signup-2", "2", { pan: "ABCDE1234F" }), error => error.code === "organisation_signup_organisation_conflict");
  const claimStart = startedWithId({}, "claim-1"); const claimContacts = contactsFor(claimStart.registry, "claim-1", "claim");
  const claim = identityFor(claimContacts.registry, "claim-1", "claim", { intent: "claim", claimedOrganisationRef: "org:existing", pan: "FGHIJ5678K", cin: "U65990MH2024PLC654321", gstin: "27FGHIJ5678K1Z5" });
  assert.equal(claim.signup.organisation.intent, "claim");
  const concurrentStart = startedWithId(claim.registry, "claim-2"); const concurrentContacts = contactsFor(concurrentStart.registry, "claim-2", "claim2");
  assert.throws(() => identityFor(concurrentContacts.registry, "claim-2", "claim2", { intent: "claim", claimedOrganisationRef: "org:existing", pan: "KLMNO6789P", cin: "U65990MH2024PLC654322", gstin: "27KLMNO6789P1Z5" }), error => error.code === "organisation_signup_organisation_conflict");
});

test("admission requires complete proofs, versioned legal acceptance and four eyes", () => {
  const incomplete = identity();
  assert.throws(() => decideOrganisationAdmission(incomplete.registry, scope.signupId, command("too-early", admissionInput()), NOW), error => error.code === "organisation_signup_admission_blocked");
  const complete = evidenced();
  assert.throws(() => decideOrganisationAdmission(complete.registry, scope.signupId, command("same", admissionInput({ proposedBy: "same", decidedBy: "same" })), NOW), error => error.code === "organisation_signup_four_eyes_required");
  const result = approved(complete.registry); assert.equal(result.signup.status, "verified_pending_provisioning"); assert.equal(result.signup.proposedTenantId, "tenant-1");
});

test("manual EDD, rejection, appeal and authorised reverification are explicit states", () => {
  let result = decideOrganisationAdmission(evidenced().registry, scope.signupId, command("edd", admissionInput({ decision: "manual_edd", eddEvidenceRef: "edd:case" })), NOW);
  assert.equal(result.signup.status, "admission_manual_review");
  result = decideOrganisationAdmission(result.registry, scope.signupId, command("reject", admissionInput({ decision: "rejected", reasonCode: "risk_unacceptable" })), NOW);
  assert.equal(result.signup.status, "rejected");
  result = appealOrganisationRejection(result.registry, scope.signupId, command("appeal", { appealedBy: "prospect:1", appealRef: "appeal:1", groundsEvidenceRef: "appeal:evidence" }), NOW);
  result = decideOrganisationAppeal(result.registry, scope.signupId, command("appeal-decision", { decision: "reverify", decidedBy: "appeal:checker", decisionEvidenceRef: "appeal:decision" }), NOW);
  result = resumeOrganisationReverification(result.registry, scope.signupId, command("reverify"), NOW);
  assert.equal(result.signup.status, "organisation_verification_pending"); assert.equal(result.signup.domainProof, null);
});

test("first owner invitation is single-use, expires, and MFA is mandatory", () => {
  const result = approved();
  const invited = issueFirstOwnerInvitation(result.registry, scope.signupId, command("invite", { tenantId: "tenant-1", invitationId: "invite-1", invitationTokenHashSha256: h("invite-token"), ownerIdentityHashSha256: h("owner-identity"), deliveryEvidenceRef: "delivery:1", issuedBy: "platform:identity", invitationExpiresAt: "2026-07-16T10:00:00Z" }), NOW);
  assert.throws(() => activateFirstOwner(invited.registry, scope.signupId, command("activate-no-mfa", { tenantId: "tenant-1", invitationTokenHashSha256: h("invite-token"), ownerIdentityHashSha256: h("owner-identity"), principalId: "user:owner", passwordCredentialRef: "credential:1", mfaFactors: [], activationEvidenceRef: "activation:1" }), NOW), error => error.code === "organisation_signup_invalid");
  const activated = activateFirstOwner(invited.registry, scope.signupId, command("activate", { tenantId: "tenant-1", invitationTokenHashSha256: h("invite-token"), ownerIdentityHashSha256: h("owner-identity"), principalId: "user:owner", passwordCredentialRef: "credential:1", mfaEnrollmentRef: "mfa:1", mfaFactors: ["webauthn"], activationEvidenceRef: "activation:1" }), NOW);
  assert.equal(activated.signup.status, "owner_activated_pending_provisioning"); assert.equal(activated.signup.owner.authority, "bootstrap_owner"); assert.equal(activated.signup.ownerInvitation.tokenHashSha256, null);
  assert.throws(() => activateFirstOwner(activated.registry, scope.signupId, command("replay", { tenantId: "tenant-1", invitationTokenHashSha256: h("invite-token") }), NOW), error => error.code === "organisation_signup_invitation_replayed");
});

test("an expired owner invitation cannot activate and may be replaced with a new single-use token", () => {
  const result = approved();
  const invited = issueFirstOwnerInvitation(result.registry, scope.signupId, command("invite-short", { tenantId: "tenant-1", invitationId: "invite-short", invitationTokenHashSha256: h("old-token"), ownerIdentityHashSha256: h("owner-identity"), deliveryEvidenceRef: "delivery:old", issuedBy: "platform:identity", invitationExpiresAt: "2026-07-15T10:01:00Z" }), NOW);
  const later = new Date("2026-07-15T10:02:00Z");
  assert.throws(() => activateFirstOwner(invited.registry, scope.signupId, command("old-activate", { tenantId: "tenant-1", invitationTokenHashSha256: h("old-token") }), later), error => error.code === "organisation_signup_invitation_expired");
  const reissued = issueFirstOwnerInvitation(invited.registry, scope.signupId, command("invite-new", { tenantId: "tenant-1", invitationId: "invite-new", invitationTokenHashSha256: h("new-token"), ownerIdentityHashSha256: h("owner-identity"), deliveryEvidenceRef: "delivery:new", issuedBy: "platform:identity", invitationExpiresAt: "2026-07-16T10:00:00Z" }), later);
  assert.equal(reissued.signup.ownerInvitation.invitationId, "invite-new");
  assert.throws(() => activateFirstOwner(reissued.registry, scope.signupId, command("old-token", { tenantId: "tenant-1", invitationTokenHashSha256: h("old-token"), ownerIdentityHashSha256: h("owner-identity"), principalId: "user:owner", passwordCredentialRef: "credential:1", mfaEnrollmentRef: "mfa:1", mfaFactors: ["webauthn"], activationEvidenceRef: "activation:1" }), later), error => error.code === "organisation_signup_invitation_invalid");
});

test("provisioning request is tenant-scoped and still never activates tenant", () => {
  const activated = activatedOwner();
  assert.throws(() => requestTenantProvisioning(activated.registry, scope.signupId, command("wrong-tenant", { tenantId: "tenant-2" }), NOW), error => error.code === "organisation_signup_not_found");
  const requested = requestTenantProvisioning(activated.registry, scope.signupId, command("provision", { tenantId: "tenant-1", sagaId: "saga-1", deploymentBlueprintRef: "blueprint:shared-v1", subscriptionRef: "subscription:1", requestedBy: "user:owner" }), NOW);
  assert.equal(requested.signup.status, "provisioning_requested"); assert.equal(projectOrganisationSignup(requested.signup, NOW).tenantActive, false);
  assert.throws(() => cancelOrganisationSignup(requested.registry, scope.signupId, command("cancel", { reasonCode: "changed_mind", evidenceRef: "cancel:1", cancelledBy: "user:owner" }), NOW), error => error.code === "organisation_signup_cancel_blocked");
});

test("realm isolation, cancellation, expiry and resume are fail closed", () => {
  const result = started();
  assert.throws(() => resumeOrganisationSignup(result.registry, scope.signupId, { platformRealmId: "other-realm" }, NOW), error => error.code === "organisation_signup_not_found");
  const cancelled = cancelOrganisationSignup(result.registry, scope.signupId, command("cancel", { reasonCode: "duplicate", evidenceRef: "cancel:evidence", cancelledBy: "prospect:1" }), NOW);
  assert.throws(() => resumeOrganisationSignup(cancelled.registry, scope.signupId, scope, NOW), error => error.code === "organisation_signup_cancelled");
  const expired = resumeOrganisationSignup(result.registry, scope.signupId, scope, new Date("2026-08-01T00:00:00Z"));
  assert.equal(expired.signup.status, "expired"); assert.equal(expired.signup.auditEvents.at(-1).type, "organisation.signup.expired");
});

function admissionInput(overrides = {}) { return { proposedBy: "risk:maker", decidedBy: "risk:checker", decision: "approved", reasonCode: "checks_passed", fraudAssessmentRef: "fraud:1", deviceRiskRef: "device:1", rateControlRef: "rate:1", sanctionsDecisionRef: "sanctions:clear", adverseRiskDecisionRef: "adverse:clear", decisionEvidenceRef: "admission:1", organisationRef: "org:1", proposedTenantId: "tenant-1", ...overrides }; }
function startedWithId(registry, signupId) { return startOrganisationSignup(registry, { platformRealmId: "india-prod", signupId, idempotencyKey: `start-${signupId}`, requestedBy: `prospect:${signupId}`, emailHashSha256: h(`${signupId}@example.test`), mobileHashSha256: h(`mobile-${signupId}`), emailChallengeHashSha256: h(`email-${signupId}`), mobileChallengeHashSha256: h(`mobile-${signupId}`), challengeExpiresAt: "2026-07-15T10:15:00Z", expiresAt: "2026-07-30T10:00:00Z" }, NOW); }
function contactsFor(registry, signupId, suffix) { const local = { platformRealmId: "india-prod", signupId }; let result = verifySignupContact(registry, signupId, { ...local, idempotencyKey: `email-${suffix}`, channel: "email", responseHashSha256: h(`email-${signupId}`), verificationEvidenceRef: `email:evidence:${suffix}` }, NOW); return verifySignupContact(result.registry, signupId, { ...local, idempotencyKey: `mobile-${suffix}`, channel: "mobile", responseHashSha256: h(`mobile-${signupId}`), verificationEvidenceRef: `mobile:evidence:${suffix}` }, NOW); }
function identityFor(registry, signupId, suffix, overrides = {}) { return submitOrganisationIdentity(registry, signupId, { platformRealmId: "india-prod", signupId, idempotencyKey: `identity-${suffix}`, intent: "create", legalNameRef: `legal:${suffix}`, cin: "U65990MH2024PLC123456", gstin: "27ABCDE1234F1Z5", pan: "ABCDE1234F", regulatedEntityRef: `re:${suffix}`, licenceRef: `licence:${suffix}`, corporateDomainHashSha256: h(`domain-${suffix}`), corporateRegistryEvidenceRef: `mca:${suffix}`, taxRegistryEvidenceRef: `gst:${suffix}`, regulatedEntityLicenceEvidenceRef: `rbi:${suffix}`, sanctionsScreeningEvidenceRef: `sanctions:${suffix}`, adverseMediaEvidenceRef: `adverse:${suffix}`, ...overrides }, NOW); }
function activatedOwner() { const result = approved(); const invited = issueFirstOwnerInvitation(result.registry, scope.signupId, command("invite", { tenantId: "tenant-1", invitationId: "invite-1", invitationTokenHashSha256: h("invite-token"), ownerIdentityHashSha256: h("owner-identity"), deliveryEvidenceRef: "delivery:1", issuedBy: "platform:identity", invitationExpiresAt: "2026-07-16T10:00:00Z" }), NOW); return activateFirstOwner(invited.registry, scope.signupId, command("activate", { tenantId: "tenant-1", invitationTokenHashSha256: h("invite-token"), ownerIdentityHashSha256: h("owner-identity"), principalId: "user:owner", passwordCredentialRef: "credential:1", mfaEnrollmentRef: "mfa:1", mfaFactors: ["webauthn"], activationEvidenceRef: "activation:1" }), NOW); }
