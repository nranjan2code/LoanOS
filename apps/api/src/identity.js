import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { KNOWN_STAFF_ROLES } from "../../../packages/core/src/index.js";

const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEYLEN = 32;
const PASSWORD_DIGEST = "sha256";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MINUTES = 15;
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const TENANT_USER_STATUSES = new Set(["active", "suspended", "inactive"]);
export const TENANT_ADMIN_ROLES = new Set(["tenant_admin", "user_admin", "security_admin", "auditor", "operator"]);
export const PLATFORM_USER_STATUSES = new Set(["active", "suspended", "inactive"]);
export const PLATFORM_ROLES = new Set(["platform_admin", "tenant_provisioner", "security_admin", "auditor"]);

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const digest = pbkdf2Sync(String(password ?? ""), salt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, PASSWORD_DIGEST).toString("hex");
  return `pbkdf2_${PASSWORD_DIGEST}$${PASSWORD_ITERATIONS}$${salt}$${digest}`;
}

export function verifyPassword(password, passwordHash) {
  if (!passwordHash || typeof passwordHash !== "string") {
    return false;
  }
  const [algorithm, iterationText, salt, expected] = passwordHash.split("$");
  if (algorithm !== `pbkdf2_${PASSWORD_DIGEST}` || !iterationText || !salt || !expected) {
    return false;
  }
  const iterations = Number(iterationText);
  if (!Number.isFinite(iterations) || iterations < 1) {
    return false;
  }
  const actual = pbkdf2Sync(String(password ?? ""), salt, iterations, Buffer.from(expected, "hex").length, PASSWORD_DIGEST);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

export function hashSecret(secret) {
  return createHash("sha256").update(String(secret ?? "")).digest("hex");
}

// --- TOTP (RFC 6238 / RFC 4226) — no external dependency ------------------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = "";
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let output = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder > 0) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, "0");
    output += BASE32_ALPHABET[parseInt(lastChunk, 2)];
  }
  return output;
}

function base32Decode(value) {
  const clean = String(value ?? "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpAuthUrl(secret, { issuer = "LoanOS", accountName = "" } = {}) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

function totpCodeForCounter(secret, counter) {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function totpCode(secret, now = new Date()) {
  const counter = Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
  return totpCodeForCounter(secret, counter);
}

export function verifyTotpCode(secret, code, { window = 1, now = new Date() } = {}) {
  if (!secret || !code) return false;
  const normalizedCode = String(code).trim();
  if (!/^\d{6}$/.test(normalizedCode)) return false;
  const counter = Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    if (totpCodeForCounter(secret, counter + offset) === normalizedCode) {
      return true;
    }
  }
  return false;
}

// --- Login attempt tracking / lockout --------------------------------------

export function loginAttemptKey(scope, email) {
  return `${scope}:${normalizeEmail(email)}`;
}

export function normalizeLoginAttempts(attempts = {}) {
  const normalized = {};
  for (const [key, record] of Object.entries(attempts ?? {})) {
    if (!record) continue;
    normalized[key] = {
      count: Number.isFinite(record.count) ? record.count : 0,
      firstAttemptAt: record.firstAttemptAt ?? null,
      lockedUntil: record.lockedUntil ?? null
    };
  }
  return normalized;
}

export function isLoginLocked(attempts = {}, key, now = new Date()) {
  const record = attempts[key];
  if (!record?.lockedUntil) return false;
  return new Date(record.lockedUntil).getTime() > now.getTime();
}

export function recordLoginFailure(attempts = {}, key, now = new Date(), {
  maxAttempts = LOGIN_MAX_ATTEMPTS,
  lockoutMinutes = LOGIN_LOCKOUT_MINUTES
} = {}) {
  const existing = attempts[key] ?? { count: 0, firstAttemptAt: now.toISOString(), lockedUntil: null };
  const count = existing.count + 1;
  const lockedUntil =
    count >= maxAttempts ? new Date(now.getTime() + lockoutMinutes * 60 * 1000).toISOString() : existing.lockedUntil;
  return {
    ...attempts,
    [key]: { count, firstAttemptAt: existing.firstAttemptAt ?? now.toISOString(), lockedUntil }
  };
}

export function clearLoginAttempts(attempts = {}, key) {
  if (!attempts[key]) return attempts;
  const next = { ...attempts };
  delete next[key];
  return next;
}

export function normalizeTenantUsers(users = {}) {
  const normalized = {};
  for (const [id, record] of Object.entries(users ?? {})) {
    const user = normalizeTenantUser(record, { userId: id });
    if (user.userId) {
      normalized[user.userId] = user;
    }
  }
  return normalized;
}

export function normalizePlatformUsers(users = {}) {
  const normalized = {};
  for (const [id, record] of Object.entries(users ?? {})) {
    const user = normalizePlatformUser(record, { userId: id });
    if (user.userId) {
      normalized[user.userId] = user;
    }
  }
  return normalized;
}

export function normalizeAccessReviews(reviews = {}) {
  const normalized = {};
  for (const [id, review] of Object.entries(reviews ?? {})) {
    if (!review) continue;
    const reviewId = review.reviewId ?? id;
    normalized[reviewId] = {
      reviewId,
      status: review.status ?? "open",
      scope: review.scope ?? "all_users",
      reviewer: review.reviewer ?? null,
      dueAt: review.dueAt ?? null,
      generatedAt: review.generatedAt ?? review.createdAt ?? null,
      completedAt: review.completedAt ?? null,
      completedBy: review.completedBy ?? null,
      snapshot: Array.isArray(review.snapshot) ? review.snapshot : [],
      decisions: Array.isArray(review.decisions) ? review.decisions : [],
      skippedDecisions: Array.isArray(review.skippedDecisions) ? review.skippedDecisions : []
    };
  }
  return normalized;
}

export function normalizeSessions(sessions = {}) {
  const normalized = {};
  for (const [id, session] of Object.entries(sessions ?? {})) {
    if (!session) continue;
    const sessionId = session.sessionId ?? id;
    normalized[sessionId] = {
      sessionId,
      tokenHash: session.tokenHash ?? null,
      principalType: session.principalType ?? null,
      tenantId: session.tenantId ?? null,
      userId: session.userId ?? null,
      email: normalizeEmail(session.email),
      displayName: session.displayName ?? session.email ?? session.userId ?? null,
      roles: normalizeStringList(session.roles),
      status: session.status ?? "active",
      restricted: session.restricted ?? null,
      challengePurpose: session.challengePurpose ?? null,
      createdAt: session.createdAt ?? null,
      expiresAt: session.expiresAt ?? null,
      lastSeenAt: session.lastSeenAt ?? null,
      revokedAt: session.revokedAt ?? null
    };
  }
  return normalized;
}

export function upsertTenantUser(users = {}, input, now = new Date()) {
  const existingRecord = input?.userId ? users[input.userId] : findUserByEmail(users, input?.email);
  const existing = existingRecord ?? {};
  const user = normalizeTenantUser(input, existing, now);
  const findings = validateTenantUser(user, {
    isCreate: !existingRecord,
    passwordProvided: !!input?.password,
    rawPassword: input?.password
  });
  if (findings.length > 0) {
    return { users, user: publicTenantUser(user), findings };
  }
  return {
    users: {
      ...users,
      [user.userId]: user
    },
    user: publicTenantUser(user),
    findings: []
  };
}

export function upsertFederatedTenantUser(users = {}, input, now = new Date()) {
  const existingRecord = input?.userId ? users[input.userId] : findUserByEmail(users, input?.email);
  if (existingRecord && existingRecord.authenticationSource !== "federated") {
    return { users, user: publicTenantUser(existingRecord), findings: [{ code: "federated_identity_conflict", message: "SCIM cannot take over a locally managed identity." }] };
  }
  const existing = existingRecord ?? {};
  const user = normalizeTenantUser({ ...input, passwordHash: null, mfaRequired: true }, existing, now);
  const findings = validateTenantUser(user, { isCreate: !existingRecord, passwordProvided: false, rawPassword: null, allowNoPassword: true });
  if (!input.federationPolicyId || !input.federationExternalId || input.authenticationSource !== "federated") findings.push({ code: "federated_identity_invalid", message: "Federation policy, external identity, and federated authentication source are required." });
  if (findings.length > 0) return { users, user: publicTenantUser(user), findings };
  return { users: { ...users, [user.userId]: user }, user: publicTenantUser(user), findings: [] };
}

export function upsertPlatformUser(users = {}, input, now = new Date()) {
  const existingRecord = input?.userId ? users[input.userId] : findUserByEmail(users, input?.email);
  const existing = existingRecord ?? {};
  const user = normalizePlatformUser(input, existing, now);
  const findings = validatePlatformUser(user, {
    isCreate: !existingRecord,
    passwordProvided: !!input?.password,
    rawPassword: input?.password
  });
  if (findings.length > 0) {
    return { users, user: publicPlatformUser(user), findings };
  }
  return {
    users: {
      ...users,
      [user.userId]: user
    },
    user: publicPlatformUser(user),
    findings: []
  };
}

export function publicTenantUser(user) {
  if (!user) return null;
  const { passwordHash, mfaSecret, mfaPendingSecret, inviteTokenHash, ...rest } = user;
  return { ...rest, mfaSetupPending: Boolean(user.mfaRequired && !user.mfaEnabled) };
}

export function publicPlatformUser(user) {
  if (!user) return null;
  const { passwordHash, mfaSecret, mfaPendingSecret, ...rest } = user;
  return { ...rest, mfaSetupPending: Boolean(user.mfaRequired && !user.mfaEnabled) };
}

export function authenticateTenantUser(tenantData, { email, password }, now = new Date()) {
  const user = findUserByEmail(tenantData?.users ?? {}, email);
  if (!user || user.status !== "active" || !verifyPassword(password, user.passwordHash)) {
    return null;
  }
  return {
    user: publicTenantUser({ ...user, lastLoginAt: now.toISOString() }),
    storedUser: { ...user, lastLoginAt: now.toISOString(), updatedAt: now.toISOString() }
  };
}

export function authenticatePlatformUser(controlPlane, { email, password }, now = new Date()) {
  const user = findUserByEmail(controlPlane?.platformUsers ?? {}, email);
  if (!user || user.status !== "active" || !verifyPassword(password, user.passwordHash)) {
    return null;
  }
  return {
    user: publicPlatformUser({ ...user, lastLoginAt: now.toISOString() }),
    storedUser: { ...user, lastLoginAt: now.toISOString(), updatedAt: now.toISOString() }
  };
}

export function createSessionRecord(input, now = new Date()) {
  const token = `los_sess_${randomBytes(32).toString("hex")}`;
  const sessionId = `sess_${randomBytes(10).toString("hex")}`;
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? SESSION_TTL_MS)).toISOString();
  const session = {
    sessionId,
    tokenHash: hashSecret(token),
    principalType: input.principalType,
    tenantId: input.tenantId ?? null,
    userId: input.userId,
    email: normalizeEmail(input.email),
    displayName: input.displayName ?? input.email ?? input.userId,
    roles: normalizeStringList(input.roles),
    status: "active",
    // Non-null while the account has an outstanding required action (MFA
    // enrollment, forced password rotation). The route layer only lets a
    // restricted session reach the specific /auth/* endpoints that resolve
    // that action — every other route is 403'd until it's cleared.
    restricted: input.restricted ?? null,
    createdAt: now.toISOString(),
    expiresAt,
    lastSeenAt: now.toISOString(),
    revokedAt: null
  };
  return { token, session };
}

// Resolves everything about a session that's determinable from control-plane
// data alone: the session record itself, and — for a tenant_user session —
// the tenant it belongs to (validated active). Deliberately does NOT
// validate the tenant_user's own login record, since that lives in
// tenant_data, not the control plane; see resolveSessionUser below, split
// out specifically so a caller holding only a control-plane snapshot (no
// tenant_data at all) can still get this far. resolveSession() below
// composes the two for callers that do have a full state — its behavior is
// unchanged.
export function resolveSessionRecord(state, token, now = new Date()) {
  if (!token) return null;
  const tokenHash = hashSecret(token);
  const session = Object.values(state?.controlPlane?.sessions ?? {}).find(
    (candidate) => candidate.tokenHash === tokenHash && sessionEffectiveStatus(candidate, now) === "active"
  );
  if (!session) return null;
  if (session.principalType === "tenant_user") {
    const tenant = state.controlPlane.tenants?.[session.tenantId];
    if (!tenant || tenant.status !== "active") {
      return null;
    }
    return { session, tenant };
  }
  if (session.principalType === "borrower" || session.principalType === "borrower_challenge") {
    const tenant = state.controlPlane.tenants?.[session.tenantId];
    if (!tenant || tenant.status !== "active") {
      return null;
    }
    return { session, tenant };
  }
  if (session.principalType === "platform_user") {
    const user = state.controlPlane.platformUsers?.[session.userId];
    if (!user || user.status !== "active") {
      return null;
    }
    return { session, user: publicPlatformUser(user) };
  }
  return null;
}

// Completes a tenant_user session resolution given that tenant's OWN
// data-plane document (fetched separately, however the caller obtained it —
// this function needs nothing else). Returns the public login record, or
// null if the user is missing/inactive.
export function resolveSessionUser(tenantData, session) {
  const user = tenantData?.users?.[session?.userId];
  if (!user || user.status !== "active") {
    return null;
  }
  return publicTenantUser(user);
}

export function resolveSession(state, token, now = new Date()) {
  const record = resolveSessionRecord(state, token, now);
  if (!record) return null;
  if (record.session.principalType === "platform_user") {
    return record;
  }
  if (record.session.principalType === "borrower") {
    const borrower = state?.tenants?.[record.session.tenantId]?.borrowerProfiles?.[record.session.userId];
    if (!borrower || borrower.status !== "active") return null;
    return { session: record.session, tenant: record.tenant, user: borrower };
  }
  if (record.session.principalType === "borrower_challenge") {
    return record;
  }
  const user = resolveSessionUser(state?.tenants?.[record.session.tenantId], record.session);
  if (!user) return null;
  return { session: record.session, tenant: record.tenant, user };
}

export function sessionEffectiveStatus(session, now = new Date()) {
  if (!session || session.status !== "active") {
    return session?.status ?? "unknown";
  }
  return new Date(session.expiresAt).getTime() < now.getTime() ? "expired" : "active";
}

export function publicSession(session) {
  if (!session) return null;
  const { tokenHash, ...rest } = session;
  return { ...rest, effectiveStatus: sessionEffectiveStatus(session) };
}

export function revokeSession(sessions = {}, sessionId, now = new Date()) {
  const session = sessions[sessionId];
  if (!session) return sessions;
  return {
    ...sessions,
    [sessionId]: {
      ...session,
      status: "revoked",
      revokedAt: now.toISOString()
    }
  };
}

export function createAccessReview(users = {}, input = {}, now = new Date()) {
  const reviewId = input.reviewId ?? `ar_${randomBytes(8).toString("hex")}`;
  const selectedUserIds = Array.isArray(input.userIds) && input.userIds.length > 0
    ? new Set(input.userIds)
    : null;
  const snapshot = Object.values(users)
    .filter((user) => !selectedUserIds || selectedUserIds.has(user.userId))
    .map(publicTenantUser)
    .map((user) => ({
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      adminRoles: user.adminRoles,
      roles: user.roles,
      capturedAt: now.toISOString()
    }));
  const review = {
    reviewId,
    status: "open",
    scope: input.scope ?? "all_users",
    reviewer: input.reviewer ?? null,
    dueAt: input.dueAt ?? null,
    generatedAt: now.toISOString(),
    completedAt: null,
    completedBy: null,
    snapshot,
    decisions: []
  };
  return { review };
}

export function completeAccessReview(reviews = {}, users = {}, reviewId, input = {}, now = new Date()) {
  const review = reviews[reviewId];
  if (!review) {
    return { reviews, users, review: null, findings: [{ code: "access_review_not_found", message: "Access review not found." }] };
  }
  if (review.status === "completed") {
    return { reviews, users, review, findings: [{ code: "access_review_completed", message: "Access review is already completed." }] };
  }
  const decisions = Array.isArray(input.decisions) ? input.decisions : [];
  let nextUsers = { ...users };
  const skipped = [];
  for (const decision of decisions) {
    const user = nextUsers[decision.userId];
    if (!user) continue;
    const isDowngrade = decision.action === "suspend" || decision.action === "remove_admin_roles";
    if (isDowngrade && isLastActiveTenantAdmin(nextUsers, user.userId)) {
      skipped.push({ userId: user.userId, action: decision.action });
      continue;
    }
    if (decision.action === "suspend") {
      nextUsers[user.userId] = { ...user, status: "suspended", updatedAt: now.toISOString() };
    }
    if (decision.action === "remove_admin_roles") {
      nextUsers[user.userId] = { ...user, adminRoles: ["operator"], updatedAt: now.toISOString() };
    }
  }
  const completed = {
    ...review,
    status: "completed",
    completedAt: now.toISOString(),
    completedBy: input.completedBy ?? null,
    decisions,
    skippedDecisions: skipped
  };
  return {
    reviews: {
      ...reviews,
      [reviewId]: completed
    },
    users: nextUsers,
    review: completed,
    findings: []
  };
}

export function hasTenantAdminRole(authContext, roles = ["tenant_admin", "user_admin", "security_admin"]) {
  if (authContext?.principalType === "tenant_service") {
    return authContext.serviceCredential?.scopes?.includes("*") === true;
  }
  if (authContext?.principalType !== "tenant_user") {
    return false;
  }
  return roles.some((role) => authContext.roles?.includes(role));
}

export function hasPlatformRole(authContext, roles = ["platform_admin"]) {
  if (authContext?.principalType === "platform_key") {
    return true;
  }
  if (authContext?.principalType !== "platform_user") {
    return false;
  }
  return roles.some((role) => authContext.roles?.includes(role));
}

// Guards against a tenant locking itself out of its own admin plane: true
// when `userId` is the *only* active user carrying a tenant-admin-family
// role, so removing that role or suspending them would leave nobody able to
// administer the tenant through the human login path (service key /
// break-glass would still work, but that's an escalation, not routine ops).
export function isLastActiveTenantAdmin(users = {}, userId) {
  const target = users[userId];
  if (!target || target.status !== "active") return false;
  if (!(target.adminRoles ?? []).some((role) => TENANT_ADMIN_ROLES.has(role))) return false;
  const otherActiveAdmins = Object.values(users).filter(
    (user) =>
      user.userId !== userId &&
      user.status === "active" &&
      (user.adminRoles ?? []).some((role) => TENANT_ADMIN_ROLES.has(role))
  );
  return otherActiveAdmins.length === 0;
}

// --- Self-service password change ------------------------------------------

export function changeOwnPassword(user, { currentPassword, newPassword }, now = new Date()) {
  if (!user) {
    return { findings: [{ code: "user_not_found", message: "User not found." }] };
  }
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    return { findings: [{ code: "current_password_invalid", message: "Current password is incorrect." }] };
  }
  if (String(newPassword ?? "").length < MIN_PASSWORD_LENGTH) {
    return {
      findings: [{ code: "user_password_too_short", message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }]
    };
  }
  return {
    findings: [],
    user: { ...user, passwordHash: hashPassword(newPassword), mustChangePassword: false, updatedAt: now.toISOString() }
  };
}

// --- Invitation-based onboarding: admin invites, user sets own password ----

export function createTenantUserInvite(users = {}, input, now = new Date()) {
  const existingRecord = input?.userId ? users[input.userId] : findUserByEmail(users, input?.email);
  const existing = existingRecord ?? {};
  const token = `los_inv_${randomBytes(24).toString("hex")}`;
  const user = normalizeTenantUser(
    {
      ...input,
      password: undefined,
      status: input.status ?? "inactive",
      inviteTokenHash: hashSecret(token),
      inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString()
    },
    existing,
    now
  );
  const findings = validateTenantUser(user, {
    isCreate: !existingRecord,
    passwordProvided: false,
    allowNoPassword: true
  });
  if (findings.length > 0) {
    return { users, user: publicTenantUser(user), findings, token: null };
  }
  return {
    users: { ...users, [user.userId]: user },
    user: publicTenantUser(user),
    findings: [],
    token
  };
}

export function acceptTenantUserInvite(users = {}, { token, password }, now = new Date()) {
  if (!token) {
    return { findings: [{ code: "invite_token_required", message: "An invite token is required." }] };
  }
  const tokenHash = hashSecret(token);
  const user = Object.values(users).find((candidate) => candidate.inviteTokenHash === tokenHash);
  if (!user || !user.inviteExpiresAt || new Date(user.inviteExpiresAt).getTime() < now.getTime()) {
    return { findings: [{ code: "invite_token_invalid", message: "Invite token is invalid or expired." }] };
  }
  if (String(password ?? "").length < MIN_PASSWORD_LENGTH) {
    return {
      findings: [{ code: "user_password_too_short", message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }]
    };
  }
  const updated = {
    ...user,
    passwordHash: hashPassword(password),
    inviteTokenHash: null,
    inviteExpiresAt: null,
    status: "active",
    updatedAt: now.toISOString()
  };
  return {
    findings: [],
    users: { ...users, [user.userId]: updated },
    user: publicTenantUser(updated)
  };
}

// --- MFA enrollment ---------------------------------------------------------

// Re-verifying the password before minting a new pending secret means a
// hijacked session (cookie theft, XSS) cannot silently swap a user's
// authenticator out from under them — the attacker would also need the
// password. Re-enrollment (mfaEnabled already true) additionally requires
// the *current* TOTP code, since the whole point of the existing factor is
// to gate replacing itself.
export function beginMfaEnrollment(user, { password, code } = {}, now = new Date()) {
  if (!verifyPassword(password, user.passwordHash)) {
    return { findings: [{ code: "current_password_invalid", message: "Current password is incorrect." }] };
  }
  if (user.mfaEnabled && !verifyTotpCode(user.mfaSecret, code, { now })) {
    return { findings: [{ code: "mfa_code_invalid", message: "A valid current MFA code is required to re-enroll MFA." }] };
  }
  const secret = generateTotpSecret();
  return {
    findings: [],
    user: { ...user, mfaPendingSecret: secret, updatedAt: now.toISOString() },
    secret,
    otpauthUrl: totpAuthUrl(secret, { accountName: user.email })
  };
}

export function confirmMfaEnrollment(user, code, now = new Date()) {
  if (!user?.mfaPendingSecret) {
    return { findings: [{ code: "mfa_enrollment_not_started", message: "Call MFA setup before confirming a code." }] };
  }
  if (!verifyTotpCode(user.mfaPendingSecret, code, { now })) {
    return { findings: [{ code: "mfa_code_invalid", message: "The MFA code is incorrect or expired." }] };
  }
  return {
    findings: [],
    user: {
      ...user,
      mfaSecret: user.mfaPendingSecret,
      mfaPendingSecret: null,
      mfaEnabled: true,
      mfaRequired: true,
      updatedAt: now.toISOString()
    }
  };
}

// Disabling MFA is a security-downgrade action, so it requires proof of both
// factors the user currently holds (password + a live TOTP code) — a
// password alone (e.g. phished, or read from a hijacked session) must not be
// enough to strip the second factor.
export function disableMfa(user, { password, code }, now = new Date()) {
  if (!verifyPassword(password, user.passwordHash)) {
    return { findings: [{ code: "current_password_invalid", message: "Current password is incorrect." }] };
  }
  if (user.mfaEnabled && !verifyTotpCode(user.mfaSecret, code, { now })) {
    return { findings: [{ code: "mfa_code_invalid", message: "A valid current MFA code is required to disable MFA." }] };
  }
  return {
    findings: [],
    user: { ...user, mfaSecret: null, mfaPendingSecret: null, mfaEnabled: false, mfaRequired: false, updatedAt: now.toISOString() }
  };
}

function normalizeTenantUser(input = {}, existing = {}, now = new Date()) {
  const email = normalizeEmail(input.email ?? existing.email);
  const userId = input.userId ?? existing.userId ?? idFromEmail("usr", email);
  return {
    ...existing,
    userId,
    email,
    displayName: input.displayName ?? existing.displayName ?? email,
    status: input.status ?? existing.status ?? "active",
    adminRoles: normalizeRoles(input.adminRoles ?? existing.adminRoles, TENANT_ADMIN_ROLES, ["operator"]),
    // Domain/workflow identity — who this person is as a staff member (loan
    // officer, credit checker, etc.), merged directly onto the login record
    // instead of a separate staff-actor registry linked by id. adminRoles
    // above governs platform/tenant administration; roles below governs what
    // loan-workflow actions this same identity may perform.
    roles: normalizeStringList(input.roles ?? existing.roles),
    queues: normalizeStringList(input.queues ?? existing.queues),
    canAssignQueues: normalizeStringList(input.canAssignQueues ?? existing.canAssignQueues),
    country: input.country ?? existing.country ?? "IN",
    authenticationSource: input.authenticationSource ?? existing.authenticationSource ?? "local",
    federationPolicyId: input.federationPolicyId ?? existing.federationPolicyId ?? null,
    federationExternalId: input.federationExternalId ?? existing.federationExternalId ?? null,
    passwordHash: input.password ? hashPassword(input.password) : input.passwordHash ?? existing.passwordHash ?? null,
    // An admin who directly sets/resets a password knows that credential, so
    // the account must rotate it at next login; self-service password
    // changes and invite acceptance (where only the user ever knows the
    // value) clear the flag. mustChangePassword defaults to false so the
    // very first admin-provisioned user isn't forced through an extra step.
    mustChangePassword:
      input.mustChangePassword !== undefined ? input.mustChangePassword : existing.mustChangePassword ?? false,
    mfaRequired: input.mfaRequired ?? existing.mfaRequired ?? false,
    mfaEnabled: input.mfaEnabled ?? existing.mfaEnabled ?? false,
    mfaSecret: input.mfaSecret !== undefined ? input.mfaSecret : existing.mfaSecret ?? null,
    mfaPendingSecret: input.mfaPendingSecret !== undefined ? input.mfaPendingSecret : existing.mfaPendingSecret ?? null,
    inviteTokenHash: input.inviteTokenHash !== undefined ? input.inviteTokenHash : existing.inviteTokenHash ?? null,
    inviteExpiresAt: input.inviteExpiresAt !== undefined ? input.inviteExpiresAt : existing.inviteExpiresAt ?? null,
    createdAt: existing.createdAt ?? input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    lastLoginAt: existing.lastLoginAt ?? null
  };
}

function normalizePlatformUser(input = {}, existing = {}, now = new Date()) {
  const email = normalizeEmail(input.email ?? existing.email);
  const userId = input.userId ?? existing.userId ?? idFromEmail("pusr", email);
  return {
    ...existing,
    userId,
    email,
    displayName: input.displayName ?? existing.displayName ?? email,
    status: input.status ?? existing.status ?? "active",
    roles: normalizeRoles(input.roles ?? existing.roles, PLATFORM_ROLES, ["platform_admin"]),
    passwordHash: input.password ? hashPassword(input.password) : input.passwordHash ?? existing.passwordHash ?? null,
    mustChangePassword:
      input.mustChangePassword !== undefined ? input.mustChangePassword : existing.mustChangePassword ?? false,
    mfaRequired: input.mfaRequired ?? existing.mfaRequired ?? true,
    mfaEnabled: input.mfaEnabled ?? existing.mfaEnabled ?? false,
    mfaSecret: input.mfaSecret !== undefined ? input.mfaSecret : existing.mfaSecret ?? null,
    mfaPendingSecret: input.mfaPendingSecret !== undefined ? input.mfaPendingSecret : existing.mfaPendingSecret ?? null,
    createdAt: existing.createdAt ?? input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    lastLoginAt: existing.lastLoginAt ?? null
  };
}

function validateTenantUser(user, { isCreate, passwordProvided, rawPassword, allowNoPassword = false }) {
  const findings = [];
  if (!user.email || !user.email.includes("@")) {
    findings.push({ code: "user_email_invalid", message: "A valid email is required." });
  }
  if (isCreate && !passwordProvided && !allowNoPassword) {
    findings.push({ code: "user_password_required", message: "A password is required when creating a user." });
  }
  if (passwordProvided && String(rawPassword ?? "").length < MIN_PASSWORD_LENGTH) {
    findings.push({
      code: "user_password_too_short",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    });
  }
  if (!TENANT_USER_STATUSES.has(user.status)) {
    findings.push({ code: "user_status_invalid", message: "User status is invalid." });
  }
  for (const role of user.adminRoles ?? []) {
    if (!TENANT_ADMIN_ROLES.has(role)) {
      findings.push({ code: "user_role_invalid", message: `Unknown tenant admin role: ${role}.` });
    }
  }
  for (const role of user.roles ?? []) {
    if (!KNOWN_STAFF_ROLES.has(role)) {
      findings.push({ code: "user_staff_role_invalid", message: `Unknown staff role: ${role}.` });
    }
  }
  if ((user.roles ?? []).length > 0 && user.country !== "IN") {
    findings.push({ code: "user_country_invalid", message: "A user with staff roles must be India-operational for this platform." });
  }
  return findings;
}

function validatePlatformUser(user, { isCreate, passwordProvided, rawPassword }) {
  const findings = [];
  if (!user.email || !user.email.includes("@")) {
    findings.push({ code: "platform_user_email_invalid", message: "A valid email is required." });
  }
  if (isCreate && !passwordProvided) {
    findings.push({ code: "platform_user_password_required", message: "A password is required when creating a platform user." });
  }
  if (passwordProvided && String(rawPassword ?? "").length < MIN_PASSWORD_LENGTH) {
    findings.push({
      code: "platform_user_password_too_short",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    });
  }
  if (!PLATFORM_USER_STATUSES.has(user.status)) {
    findings.push({ code: "platform_user_status_invalid", message: "Platform user status is invalid." });
  }
  for (const role of user.roles ?? []) {
    if (!PLATFORM_ROLES.has(role)) {
      findings.push({ code: "platform_user_role_invalid", message: `Unknown platform role: ${role}.` });
    }
  }
  return findings;
}

function findUserByEmail(users = {}, email) {
  const normalized = normalizeEmail(email);
  return Object.values(users ?? {}).find((user) => normalizeEmail(user.email) === normalized) ?? null;
}

function normalizeRoles(value, allowed, defaults) {
  const source = Array.isArray(value) && value.length > 0 ? value : defaults;
  return [...new Set(source.filter((role) => allowed.has(role)))];
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()))];
}

function idFromEmail(prefix, email) {
  const hash = createHash("sha256").update(email || randomBytes(8).toString("hex")).digest("hex").slice(0, 12);
  return `${prefix}_${hash}`;
}
