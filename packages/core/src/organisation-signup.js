import { createHash, timingSafeEqual } from "node:crypto";

const TERMINAL = new Set(["cancelled", "expired"]);
const CONTACTS = Object.freeze(["email", "mobile"]);
const LEGAL_ACCEPTANCES = Object.freeze(["terms", "privacy", "dpa", "subscription"]);
const REQUIRED_ORGANISATION_EVIDENCE = Object.freeze([
  "corporateRegistryEvidenceRef",
  "taxRegistryEvidenceRef",
  "regulatedEntityLicenceEvidenceRef",
  "sanctionsScreeningEvidenceRef",
  "adverseMediaEvidenceRef"
]);
const REQUIRED_ADMISSION_CONTROLS = Object.freeze([
  "fraudAssessmentRef",
  "deviceRiskRef",
  "rateControlRef"
]);

/**
 * Starts a deliberately non-active organisation application. Identity values and
 * challenge secrets are never accepted; callers provide only SHA-256 digests.
 */
export function startOrganisationSignup(registry = {}, input = {}, now = new Date()) {
  realm(input); id(input.signupId, "signupId"); required(input.idempotencyKey, "idempotencyKey");
  required(input.requestedBy, "requestedBy"); digest(input.emailHashSha256, "emailHashSha256");
  digest(input.mobileHashSha256, "mobileHashSha256"); digest(input.emailChallengeHashSha256, "emailChallengeHashSha256");
  digest(input.mobileChallengeHashSha256, "mobileChallengeHashSha256");
  const duplicateCommand = Object.values(registry).find((item) => item.platformRealmId === input.platformRealmId && item.commandKeys?.includes(input.idempotencyKey));
  if (duplicateCommand) return { registry, signup: duplicateCommand, idempotent: true };
  if (registry[input.signupId]) fail("organisation_signup_duplicate", "signupId already exists.");
  const expiresAt = future(input.expiresAt, now, "expiresAt");
  const challengeExpiresAt = future(input.challengeExpiresAt, now, "challengeExpiresAt");
  if (Date.parse(challengeExpiresAt) > Date.parse(expiresAt)) invalid("Contact challenge cannot outlive signup.");
  let signup = {
    platformRealmId: input.platformRealmId, signupId: input.signupId, proposedTenantId: null,
    status: "signup_pending", revision: 1, requestedBy: input.requestedBy,
    contact: {
      emailHashSha256: input.emailHashSha256.toLowerCase(), mobileHashSha256: input.mobileHashSha256.toLowerCase(),
      challenges: Object.fromEntries(CONTACTS.map((channel) => [channel, {
        secretHashSha256: input[`${channel}ChallengeHashSha256`].toLowerCase(), expiresAt: challengeExpiresAt,
        attemptCount: 0, maxAttempts: bounded(input.challengeMaxAttempts ?? 5, 1, 10, "challengeMaxAttempts"),
        verifiedAt: null, evidenceRef: null
      }]))
    },
    organisation: null, organisationDecision: null, domainProof: null, representativeProof: null,
    legalAcceptances: {}, admission: { status: "pending", assessments: null, decision: null },
    ownerInvitation: null, owner: null, provisioningRequest: null, appeal: null,
    commandKeys: [input.idempotencyKey], auditEvents: [], outboxEvents: [],
    createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt
  };
  signup = emit(signup, "organisation.signup.started", { status: signup.status }, input.requestedBy, now);
  return { registry: { ...registry, [signup.signupId]: signup }, signup, idempotent: false };
}

export function verifySignupContact(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.contact_verification_attempted", (signup) => {
    if (!CONTACTS.includes(input.channel)) invalid("channel must be email or mobile.");
    digest(input.responseHashSha256, "responseHashSha256"); required(input.verificationEvidenceRef, "verificationEvidenceRef");
    const challenge = signup.contact.challenges[input.channel];
    if (challenge.verifiedAt) return signup;
    if (Date.parse(challenge.expiresAt) <= now.getTime()) fail("organisation_signup_challenge_expired", "Contact challenge has expired.");
    const attempts = challenge.attemptCount + 1;
    if (attempts > challenge.maxAttempts) fail("organisation_signup_challenge_locked", "Contact challenge is locked.");
    const matched = safeDigestEqual(challenge.secretHashSha256, input.responseHashSha256);
    const updated = { ...challenge, attemptCount: attempts, lastAttemptEvidenceRef: input.verificationEvidenceRef, verifiedAt: matched ? now.toISOString() : null, evidenceRef: matched ? input.verificationEvidenceRef : null };
    if (!matched) {
      const next = { ...signup, contact: { ...signup.contact, challenges: { ...signup.contact.challenges, [input.channel]: { ...updated, lastVerificationMatched: false } } } };
      return attempts >= challenge.maxAttempts ? { ...next, status: "admission_manual_review" } : next;
    }
    const challenges = { ...signup.contact.challenges, [input.channel]: updated };
    const bothVerified = CONTACTS.every((channel) => challenges[channel].verifiedAt);
    return { ...signup, contact: { ...signup.contact, challenges }, status: bothVerified ? "contacts_verified" : signup.status };
  });
}

export function submitOrganisationIdentity(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.identity_submitted", (signup) => {
    contactsVerified(signup);
    if (!['create', 'claim'].includes(input.intent)) invalid("intent must be create or claim.");
    const legal = {
      legalNameRef: required(input.legalNameRef, "legalNameRef"), cin: legalId(input.cin, "cin", /^[A-Z][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/),
      gstin: legalId(input.gstin, "gstin", /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/),
      pan: legalId(input.pan, "pan", /^[A-Z]{5}[0-9]{4}[A-Z]$/),
      regulatedEntityRef: required(input.regulatedEntityRef, "regulatedEntityRef"),
      licenceRef: required(input.licenceRef, "licenceRef"), claimedOrganisationRef: input.intent === "claim" ? required(input.claimedOrganisationRef, "claimedOrganisationRef") : null,
      corporateDomainHashSha256: lowerDigest(input.corporateDomainHashSha256, "corporateDomainHashSha256"),
      evidence: Object.fromEntries(REQUIRED_ORGANISATION_EVIDENCE.map((field) => [field, required(input[field], field)]))
    };
    const conflict = findOrganisationConflict(registry, signup, legal, input.intent);
    if (conflict) fail("organisation_signup_organisation_conflict", `Organisation identity conflicts with ${conflict.signupId}.`);
    return { ...signup, organisation: { intent: input.intent, ...legal, submittedAt: now.toISOString() }, status: "organisation_verification_pending", organisationDecision: null };
  }, { registry });
}

export function recordCorporateDomainProof(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.domain_proved", (signup) => {
    organisationSubmitted(signup); digest(input.domainHashSha256, "domainHashSha256");
    if (!safeDigestEqual(signup.organisation.corporateDomainHashSha256, input.domainHashSha256)) fail("organisation_signup_domain_mismatch", "Domain proof does not match the organisation domain.");
    return { ...signup, domainProof: { method: oneOf(input.method, ["dns", "signed_file", "corporate_email"], "method"), evidenceRef: required(input.evidenceRef, "evidenceRef"), verifiedBy: required(input.verifiedBy, "verifiedBy"), verifiedAt: now.toISOString() } };
  });
}

export function recordAuthorisedRepresentativeProof(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.representative_proved", (signup) => {
    organisationSubmitted(signup); digest(input.representativeIdentityHashSha256, "representativeIdentityHashSha256");
    return { ...signup, representativeProof: { representativeIdentityHashSha256: input.representativeIdentityHashSha256.toLowerCase(), authorityEvidenceRef: required(input.authorityEvidenceRef, "authorityEvidenceRef"), identityEvidenceRef: required(input.identityEvidenceRef, "identityEvidenceRef"), designationRef: required(input.designationRef, "designationRef"), verifiedBy: required(input.verifiedBy, "verifiedBy"), verifiedAt: now.toISOString() } };
  });
}

export function acceptSignupLegalDocuments(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.legal_accepted", (signup) => {
    organisationSubmitted(signup); const acceptedBy = required(input.acceptedBy, "acceptedBy");
    const legalAcceptances = { ...signup.legalAcceptances };
    for (const type of LEGAL_ACCEPTANCES) {
      const acceptance = input[type]; if (!acceptance || acceptance.accepted !== true) invalid(`${type} acceptance is required.`);
      legalAcceptances[type] = { versionRef: required(acceptance.versionRef, `${type}.versionRef`), evidenceRef: required(acceptance.evidenceRef, `${type}.evidenceRef`), acceptedBy, acceptedAt: now.toISOString() };
    }
    return { ...signup, legalAcceptances };
  });
}

/** Admission is explicitly decided by a different platform principal. */
export function decideOrganisationAdmission(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.admission_decided", (signup) => {
    organisationSubmitted(signup); required(input.decidedBy, "decidedBy"); required(input.proposedBy, "proposedBy");
    if (input.decidedBy === input.proposedBy) fail("organisation_signup_four_eyes_required", "Admission requires independent approval.");
    if (!['approved', 'manual_edd', 'rejected'].includes(input.decision)) invalid("decision is invalid.");
    const assessments = Object.fromEntries(REQUIRED_ADMISSION_CONTROLS.map((field) => [field, required(input[field], field)]));
    assessments.sanctionsDecisionRef = required(input.sanctionsDecisionRef, "sanctionsDecisionRef");
    assessments.adverseRiskDecisionRef = required(input.adverseRiskDecisionRef, "adverseRiskDecisionRef");
    assessments.eddEvidenceRef = input.decision === "manual_edd" || (signup.status === "admission_manual_review" && input.decision === "approved") ? required(input.eddEvidenceRef, "eddEvidenceRef") : input.eddEvidenceRef ?? null;
    const organisationReady = signup.domainProof && signup.representativeProof && LEGAL_ACCEPTANCES.every((type) => signup.legalAcceptances[type]);
    if (input.decision === "approved" && !organisationReady) fail("organisation_signup_admission_blocked", "Organisation, authority, domain and legal evidence must be complete.");
    if (signup.organisation.intent === "claim" && input.claimApproved !== true && input.decision === "approved") fail("organisation_signup_claim_unapproved", "An existing organisation claim requires explicit approval.");
    const decision = { outcome: input.decision, reasonCode: required(input.reasonCode, "reasonCode"), proposedBy: input.proposedBy, decidedBy: input.decidedBy, evidenceRef: required(input.decisionEvidenceRef, "decisionEvidenceRef"), decidedAt: now.toISOString() };
    const status = input.decision === "approved" ? "verified_pending_provisioning" : input.decision === "manual_edd" ? "admission_manual_review" : "rejected";
    return { ...signup, status, admission: { status: input.decision, assessments, decision }, organisationDecision: { claimApproved: signup.organisation.intent === "claim" ? input.claimApproved === true : null, organisationRef: required(input.organisationRef, "organisationRef"), decidedAt: now.toISOString() }, proposedTenantId: input.decision === "approved" ? id(input.proposedTenantId, "proposedTenantId") : null };
  });
}

export function appealOrganisationRejection(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.appealed", (signup) => {
    if (signup.status !== "rejected") fail("organisation_signup_appeal_invalid", "Only a rejected signup can be appealed.");
    return { ...signup, status: "appeal_pending", appeal: { appealRef: required(input.appealRef, "appealRef"), groundsEvidenceRef: required(input.groundsEvidenceRef, "groundsEvidenceRef"), appealedBy: required(input.appealedBy, "appealedBy"), appealedAt: now.toISOString(), decision: null } };
  }, { allowRejected: true });
}

export function decideOrganisationAppeal(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.appeal_decided", (signup) => {
    if (signup.status !== "appeal_pending") fail("organisation_signup_appeal_invalid", "No appeal is pending.");
    if (!['reverify', 'rejected'].includes(input.decision)) invalid("Appeal decision must be reverify or rejected.");
    required(input.decidedBy, "decidedBy"); required(input.decisionEvidenceRef, "decisionEvidenceRef");
    if (input.decidedBy === signup.appeal.appealedBy) fail("organisation_signup_four_eyes_required", "Appeal requires independent review.");
    return { ...signup, status: input.decision === "reverify" ? "reverification_required" : "rejected", admission: input.decision === "reverify" ? { status: "pending", assessments: null, decision: null } : signup.admission, appeal: { ...signup.appeal, decision: input.decision, decidedBy: input.decidedBy, decisionEvidenceRef: input.decisionEvidenceRef, decidedAt: now.toISOString() } };
  }, { allowRejected: true });
}

export function resumeOrganisationReverification(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.reverification_resumed", (signup) => {
    if (signup.status !== "reverification_required") fail("organisation_signup_reverification_invalid", "Reverification was not authorised.");
    return { ...signup, status: "organisation_verification_pending", domainProof: null, representativeProof: null, organisationDecision: null, proposedTenantId: null };
  }, { allowRejected: true });
}

export function issueFirstOwnerInvitation(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.owner_invited", (signup) => {
    scopeTenant(signup, input);
    const reissue = signup.status === "owner_invited" && signup.ownerInvitation && (signup.ownerInvitation.revokedAt || Date.parse(signup.ownerInvitation.expiresAt) <= now.getTime());
    if (signup.status !== "verified_pending_provisioning" && !reissue) fail("organisation_signup_owner_invite_blocked", "Owner invitation requires approved admission or an expired/revoked prior invitation.");
    digest(input.invitationTokenHashSha256, "invitationTokenHashSha256"); digest(input.ownerIdentityHashSha256, "ownerIdentityHashSha256");
    const expiresAt = future(input.invitationExpiresAt, now, "invitationExpiresAt");
    if (Date.parse(expiresAt) > Date.parse(signup.expiresAt)) invalid("Owner invitation cannot outlive signup.");
    return { ...signup, status: "owner_invited", ownerInvitation: { invitationId: id(input.invitationId, "invitationId"), tokenHashSha256: input.invitationTokenHashSha256.toLowerCase(), ownerIdentityHashSha256: input.ownerIdentityHashSha256.toLowerCase(), deliveryEvidenceRef: required(input.deliveryEvidenceRef, "deliveryEvidenceRef"), issuedBy: required(input.issuedBy, "issuedBy"), issuedAt: now.toISOString(), expiresAt, usedAt: null, revokedAt: null } };
  });
}

export function activateFirstOwner(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.owner_activated", (signup) => {
    scopeTenant(signup, input); const invitation = signup.ownerInvitation;
    if (invitation?.usedAt) fail("organisation_signup_invitation_replayed", "Owner invitation has already been used.");
    if (signup.status !== "owner_invited" || !invitation) fail("organisation_signup_owner_activation_blocked", "No active owner invitation exists.");
    if (invitation.revokedAt) fail("organisation_signup_invitation_revoked", "Owner invitation was revoked.");
    if (Date.parse(invitation.expiresAt) <= now.getTime()) fail("organisation_signup_invitation_expired", "Owner invitation has expired.");
    digest(input.invitationTokenHashSha256, "invitationTokenHashSha256");
    if (!safeDigestEqual(invitation.tokenHashSha256, input.invitationTokenHashSha256)) fail("organisation_signup_invitation_invalid", "Owner invitation token is invalid.");
    digest(input.ownerIdentityHashSha256, "ownerIdentityHashSha256");
    if (!safeDigestEqual(invitation.ownerIdentityHashSha256, input.ownerIdentityHashSha256)) fail("organisation_signup_owner_identity_mismatch", "Activated owner does not match the invited identity.");
    required(input.passwordCredentialRef, "passwordCredentialRef"); required(input.mfaEnrollmentRef, "mfaEnrollmentRef");
    if (!Array.isArray(input.mfaFactors) || input.mfaFactors.length < 1 || input.mfaFactors.some((factor) => !['totp', 'webauthn', 'hardware_key'].includes(factor))) invalid("At least one approved MFA factor is required.");
    const owner = { principalId: id(input.principalId, "principalId"), authority: "bootstrap_owner", passwordCredentialRef: input.passwordCredentialRef, mfaEnrollmentRef: input.mfaEnrollmentRef, mfaFactors: [...new Set(input.mfaFactors)], activationEvidenceRef: required(input.activationEvidenceRef, "activationEvidenceRef"), activatedAt: now.toISOString() };
    return { ...signup, status: "owner_activated_pending_provisioning", owner, ownerInvitation: { ...invitation, tokenHashSha256: null, usedAt: now.toISOString() } };
  });
}

export function requestTenantProvisioning(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.provisioning_requested", (signup) => {
    scopeTenant(signup, input); if (signup.status !== "owner_activated_pending_provisioning") fail("organisation_signup_provisioning_blocked", "Verified organisation and activated MFA owner are required.");
    return { ...signup, status: "provisioning_requested", provisioningRequest: { sagaId: id(input.sagaId, "sagaId"), deploymentBlueprintRef: required(input.deploymentBlueprintRef, "deploymentBlueprintRef"), subscriptionRef: required(input.subscriptionRef, "subscriptionRef"), requestedBy: required(input.requestedBy, "requestedBy"), requestedAt: now.toISOString() } };
  });
}

export function cancelOrganisationSignup(registry, signupId, input = {}, now = new Date()) {
  return mutate(registry, signupId, input, now, "organisation.signup.cancelled", (signup) => {
    if (signup.status === "provisioning_requested") fail("organisation_signup_cancel_blocked", "Provisioning cancellation must use the provisioning saga rollback.");
    return { ...signup, status: "cancelled", cancellation: { reasonCode: required(input.reasonCode, "reasonCode"), evidenceRef: required(input.evidenceRef, "evidenceRef"), cancelledBy: required(input.cancelledBy, "cancelledBy"), cancelledAt: now.toISOString() } };
  }, { allowRejected: true });
}

export function resumeOrganisationSignup(registry, signupId, input = {}, now = new Date()) {
  const signup = local(registry, signupId, input); scopeTenantIfProvided(signup, input);
  if (signup.status === "cancelled") fail("organisation_signup_cancelled", "Signup was cancelled.");
  if (Date.parse(signup.expiresAt) <= now.getTime()) {
    if (signup.status === "expired") return { registry, signup, progress: projectOrganisationSignup(signup, now), idempotent: true };
    const expired = emit({ ...signup, status: "expired", revision: signup.revision + 1, updatedAt: now.toISOString() }, "organisation.signup.expired", { priorStatus: signup.status }, "system", now);
    return { registry: { ...registry, [signupId]: expired }, signup: expired, progress: projectOrganisationSignup(expired, now), idempotent: false };
  }
  return { registry, signup, progress: projectOrganisationSignup(signup, now), idempotent: true };
}

export function projectOrganisationSignup(signup, now = new Date()) {
  if (!signup) invalid("signup is required."); const blockers = [];
  if (Date.parse(signup.expiresAt) <= now.getTime() || signup.status === "expired") blockers.push("signup_expired");
  for (const channel of CONTACTS) if (!signup.contact.challenges[channel].verifiedAt) blockers.push(`${channel}_unverified`);
  if (!signup.organisation) blockers.push("organisation_identity_missing");
  if (!signup.domainProof) blockers.push("corporate_domain_unproved");
  if (!signup.representativeProof) blockers.push("authorised_representative_unproved");
  for (const type of LEGAL_ACCEPTANCES) if (!signup.legalAcceptances[type]) blockers.push(`${type}_unaccepted`);
  if (signup.admission.status !== "approved") blockers.push(`admission_${signup.admission.status}`);
  if (!signup.owner) blockers.push("first_owner_not_activated");
  if (!signup.provisioningRequest) blockers.push("provisioning_not_requested");
  return { platformRealmId: signup.platformRealmId, signupId: signup.signupId, proposedTenantId: signup.proposedTenantId, status: signup.status, blockers, canInviteOwner: signup.status === "verified_pending_provisioning", canRequestProvisioning: signup.status === "owner_activated_pending_provisioning", tenantActive: false, projectedAt: now.toISOString() };
}

function mutate(registry, signupId, input, now, eventType, transform, options = {}) {
  const current = local(registry, signupId, input); scopeTenantIfProvided(current, input); required(input.idempotencyKey, "idempotencyKey");
  if (current.commandKeys.includes(input.idempotencyKey)) return { registry, signup: current, idempotent: true, progress: projectOrganisationSignup(current, now) };
  if (TERMINAL.has(current.status)) fail(`organisation_signup_${current.status}`, `Signup is ${current.status}.`);
  if (current.status === "rejected" && !options.allowRejected) fail("organisation_signup_rejected", "Signup was rejected.");
  if (Date.parse(current.expiresAt) <= now.getTime()) fail("organisation_signup_expired", "Signup has expired.");
  let signup = transform(structuredClone(current));
  signup = { ...signup, revision: current.revision + 1, commandKeys: [...current.commandKeys, input.idempotencyKey], updatedAt: now.toISOString() };
  signup = emit(signup, eventType, { status: signup.status }, input.actor ?? input.decidedBy ?? input.acceptedBy ?? input.requestedBy ?? "system", now);
  return { registry: { ...registry, [signupId]: signup }, signup, idempotent: false, progress: projectOrganisationSignup(signup, now) };
}

function emit(signup, type, payload, actor, now) {
  const sequence = signup.auditEvents.length + 1;
  const base = { eventId: `${signup.signupId}:${sequence}`, sequence, platformRealmId: signup.platformRealmId, signupId: signup.signupId, tenantId: signup.proposedTenantId, type, actor, payload, occurredAt: now.toISOString() };
  const audit = { ...base, checksumSha256: hash(base) };
  const outboxPayload = { signupId: signup.signupId, tenantId: signup.proposedTenantId, status: signup.status };
  const outbox = { eventId: base.eventId, platformRealmId: signup.platformRealmId, tenantId: signup.proposedTenantId, topic: type, payload: outboxPayload, payloadChecksumSha256: hash(outboxPayload), status: "pending", createdAt: now.toISOString() };
  return { ...signup, auditEvents: [...signup.auditEvents, audit], outboxEvents: [...signup.outboxEvents, outbox] };
}

function local(registry, signupId, input) { realm(input); id(signupId, "signupId"); const signup = registry[signupId]; if (!signup || signup.platformRealmId !== input.platformRealmId) fail("organisation_signup_not_found", "Realm-local signup was not found."); return signup; }
function realm(input) { id(input.platformRealmId, "platformRealmId"); }
function scopeTenantIfProvided(signup, input) { if (input.tenantId !== undefined) scopeTenant(signup, input); }
function scopeTenant(signup, input) { id(input.tenantId, "tenantId"); if (!signup.proposedTenantId || signup.proposedTenantId !== input.tenantId) fail("organisation_signup_not_found", "Tenant-local signup was not found."); }
function contactsVerified(signup) { if (!CONTACTS.every((channel) => signup.contact.challenges[channel].verifiedAt)) fail("organisation_signup_contacts_unverified", "Verified email and mobile are required."); }
function organisationSubmitted(signup) { if (!signup.organisation) fail("organisation_signup_identity_missing", "Organisation identity is required."); }
function findOrganisationConflict(registry, current, legal, intent) {
  return Object.values(registry).find((item) => item.signupId !== current.signupId && item.platformRealmId === current.platformRealmId && !['cancelled', 'expired', 'rejected'].includes(item.status) && item.organisation && (
    item.organisation.cin === legal.cin || item.organisation.gstin === legal.gstin || item.organisation.pan === legal.pan ||
    item.organisation.corporateDomainHashSha256 === legal.corporateDomainHashSha256 ||
    (intent === "claim" && item.organisation.claimedOrganisationRef === legal.claimedOrganisationRef)
  ));
}
function legalId(value, field, pattern) { if (typeof value !== "string" || !pattern.test(value.toUpperCase())) invalid(`${field} is invalid.`); return value.toUpperCase(); }
function oneOf(value, choices, field) { if (!choices.includes(value)) invalid(`${field} is invalid.`); return value; }
function id(value, field) { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/.test(value)) invalid(`${field} is invalid.`); return value; }
function required(value, field) { if (typeof value !== "string" || !value.trim()) invalid(`${field} is required.`); return value; }
function digest(value, field) { if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) invalid(`${field} must be a SHA-256 digest.`); return value; }
function lowerDigest(value, field) { digest(value, field); return value.toLowerCase(); }
function safeDigestEqual(left, right) { const a = Buffer.from(left.toLowerCase(), "hex"); const b = Buffer.from(right.toLowerCase(), "hex"); return a.length === b.length && timingSafeEqual(a, b); }
function future(value, now, field) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= now.getTime()) invalid(`${field} must be a future ISO date-time.`); return new Date(value).toISOString(); }
function bounded(value, min, max, field) { if (!Number.isInteger(value) || value < min || value > max) invalid(`${field} is invalid.`); return value; }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function invalid(message) { fail("organisation_signup_invalid", message); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

export { CONTACTS, LEGAL_ACCEPTANCES, REQUIRED_ADMISSION_CONTROLS, REQUIRED_ORGANISATION_EVIDENCE };
