import { createHash } from "node:crypto";
import { KNOWN_STAFF_ROLES } from "./access-control.js";

const FEDERATION_PROTOCOLS = new Set(["oidc", "saml"]);
const POLICY_STATUSES = new Set(["draft", "active", "suspended"]);
const TENANT_ADMIN_ROLES = new Set(["tenant_admin", "user_admin", "security_admin", "auditor", "operator"]);

export function createFederationPolicy(registry = {}, input = {}, now = new Date()) {
  requireText(input.policyId, "policyId");
  if (registry[input.policyId]) throw identityError("federation_policy_duplicate", "policyId already exists.");
  if (!FEDERATION_PROTOCOLS.has(input.protocol)) throw identityError("federation_policy_invalid", "protocol must be oidc or saml.");
  for (const field of ["issuer", "metadataUrl", "audience", "owner", "proposedBy"]) requireText(input[field], field);
  requireHttps(input.metadataUrl, "metadataUrl");
  const allowedDomains = stringList(input.allowedDomains, "allowedDomains", true).map((item) => item.toLowerCase());
  const groupMappings = normalizeGroupMappings(input.groupMappings);
  if (input.protocol === "oidc" && input.pkceRequired !== true) throw identityError("federation_policy_invalid", "OIDC requires PKCE.");
  if (input.protocol === "saml" && input.signedAssertionsRequired !== true) throw identityError("federation_policy_invalid", "SAML requires signed assertions.");
  if (input.mfaRequired !== true) throw identityError("federation_policy_invalid", "Federated staff access requires MFA at the identity provider.");
  const policy = {
    policyId: String(input.policyId), protocol: input.protocol, issuer: String(input.issuer), metadataUrl: String(input.metadataUrl),
    audience: String(input.audience), allowedDomains, groupMappings, mfaRequired: true,
    pkceRequired: input.protocol === "oidc", signedAssertionsRequired: input.protocol === "saml",
    secretRef: optionalText(input.secretRef), owner: String(input.owner), proposedBy: String(input.proposedBy),
    status: "draft", createdAt: now.toISOString(), certifiedAt: null
  };
  return { registry: { ...registry, [policy.policyId]: policy }, policy };
}

export function certifyFederationPolicy(registry = {}, policyId, input = {}, now = new Date()) {
  const current = registry[policyId];
  if (!current || current.status !== "draft") throw identityError("federation_policy_transition_invalid", "A draft federation policy is required.");
  for (const field of ["approvedBy", "approvalRef", "metadataChecksumSha256", "loginTestRef", "logoutTestRef", "mfaTestRef"]) requireText(input[field], field);
  if (input.approvedBy === current.proposedBy) throw identityError("federation_four_eyes_required", "Federation certification requires an independent approver.");
  requireDigest(input.metadataChecksumSha256, "metadataChecksumSha256");
  const metadataValidUntil = futureIso(input.metadataValidUntil, now, "metadataValidUntil");
  const policy = { ...current, status: "active", metadataChecksumSha256: input.metadataChecksumSha256.toLowerCase(), metadataValidUntil, loginTestRef: String(input.loginTestRef), logoutTestRef: String(input.logoutTestRef), mfaTestRef: String(input.mfaTestRef), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), certifiedAt: now.toISOString() };
  return { registry: { ...registry, [policyId]: policy }, policy };
}

export function applyScimIdentityEvent(users = {}, events = {}, policies = {}, input = {}, now = new Date()) {
  requireText(input.eventId, "eventId"); requireText(input.policyId, "policyId"); requireText(input.externalId, "externalId"); requireText(input.email, "email"); requireText(input.displayName, "displayName"); requireText(input.idempotencyKey, "idempotencyKey");
  if (events[input.eventId] || Object.values(events).some((event) => event.idempotencyKey === input.idempotencyKey)) throw identityError("scim_event_duplicate", "SCIM event or idempotency key already exists.");
  const policy = policies[input.policyId];
  if (!policy || policy.status !== "active" || Date.parse(policy.metadataValidUntil) <= now.getTime()) throw identityError("federation_policy_inactive", "An active, current federation policy is required.");
  const email = String(input.email).trim().toLowerCase();
  if (!policy.allowedDomains.some((domain) => email.endsWith(`@${domain}`))) throw identityError("scim_domain_forbidden", "Identity email is outside the policy's allowed domains.");
  if (!["upsert", "deactivate"].includes(input.operation)) throw identityError("scim_event_invalid", "operation must be upsert or deactivate.");
  const existing = Object.values(users).find((user) => user.federationExternalId === input.externalId || user.email === email);
  if (input.operation === "deactivate" && !existing) throw identityError("scim_identity_not_found", "Deactivation requires an existing federated identity.");
  const groups = stringList(input.groups, "groups");
  const mapped = groups.map((group) => policy.groupMappings[group]).filter(Boolean);
  const adminRoles = [...new Set(mapped.flatMap((item) => item.adminRoles))];
  const roles = [...new Set(mapped.flatMap((item) => item.roles))];
  const queues = [...new Set(mapped.flatMap((item) => item.queues))];
  if (input.operation === "upsert" && (mapped.length === 0 || adminRoles.length === 0)) throw identityError("scim_group_unmapped", "At least one SCIM group must map to an explicit tenant admin role set.");
  const userInput = {
    userId: existing?.userId ?? `fusr_${digest(`${policy.policyId}:${input.externalId}`).slice(0, 20)}`, email, displayName: String(input.displayName),
    status: input.operation === "deactivate" ? "inactive" : "active",
    adminRoles: input.operation === "deactivate" ? existing.adminRoles : adminRoles,
    roles: input.operation === "deactivate" ? existing.roles : roles,
    queues: input.operation === "deactivate" ? existing.queues : queues,
    canAssignQueues: input.operation === "deactivate" ? existing.canAssignQueues : [], country: "IN",
    federationPolicyId: policy.policyId, federationExternalId: String(input.externalId), authenticationSource: "federated", mfaRequired: true
  };
  const event = { eventId: String(input.eventId), policyId: policy.policyId, externalId: String(input.externalId), userId: userInput.userId, operation: input.operation, groups, idempotencyKey: String(input.idempotencyKey), status: "applied", appliedBy: String(input.appliedBy ?? "scim"), appliedAt: now.toISOString(), evidenceChecksumSha256: digest({ policyId: policy.policyId, externalId: input.externalId, operation: input.operation, groups }) };
  return { userInput, event, events: { ...events, [event.eventId]: event } };
}

export function assessFederationPolicy(policy, now = new Date()) {
  if (!policy || !POLICY_STATUSES.has(policy.status)) return { status: "blocked", reasons: ["policy_missing"] };
  const reasons = [];
  if (policy.status !== "active") reasons.push("policy_not_active");
  if (!policy.metadataValidUntil || Date.parse(policy.metadataValidUntil) <= now.getTime()) reasons.push("metadata_expired");
  return { policyId: policy.policyId, status: reasons.length ? "blocked" : "ready", reasons };
}

function normalizeGroupMappings(value) {
  if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).length === 0) throw identityError("federation_policy_invalid", "groupMappings must define at least one group.");
  return Object.fromEntries(Object.entries(value).map(([group, mapping]) => {
    requireText(group, "groupMappings group");
    const adminRoles = stringList(mapping?.adminRoles, "adminRoles", true); const roles = stringList(mapping?.roles, "roles");
    if (adminRoles.some((role) => !TENANT_ADMIN_ROLES.has(role))) throw identityError("federation_policy_invalid", `Unknown tenant admin role in group ${group}.`);
    if (roles.some((role) => !KNOWN_STAFF_ROLES.has(role))) throw identityError("federation_policy_invalid", `Unknown staff role in group ${group}.`);
    return [group, { adminRoles, roles, queues: stringList(mapping?.queues, "queues") }];
  }));
}
function stringList(value, field, required = false) { if (value == null && !required) return []; if (!Array.isArray(value)) throw identityError("enterprise_identity_invalid", `${field} must be an array.`); const result = [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]; if (required && !result.length) throw identityError("enterprise_identity_invalid", `${field} requires at least one value.`); return result; }
function requireText(value, field) { if (typeof value !== "string" || !value.trim()) throw identityError("enterprise_identity_invalid", `${field} is required.`); }
function requireHttps(value, field) { try { if (new URL(value).protocol !== "https:") throw new Error(); } catch { throw identityError("enterprise_identity_invalid", `${field} must be an HTTPS URL.`); } }
function requireDigest(value, field) { if (!/^[a-fA-F0-9]{64}$/.test(value ?? "")) throw identityError("enterprise_identity_invalid", `${field} must be a SHA-256 digest.`); }
function futureIso(value, now, field) { const time = Date.parse(value); if (!Number.isFinite(time) || time <= now.getTime()) throw identityError("enterprise_identity_invalid", `${field} must be in the future.`); return new Date(time).toISOString(); }
function optionalText(value) { return value == null || String(value).trim() === "" ? null : String(value); }
function digest(value) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function identityError(code, message) { return Object.assign(new Error(message), { code }); }
