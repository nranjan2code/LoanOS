import { createHash } from "node:crypto";

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("identity_input_invalid", `${field} is required.`); return value.trim(); }
function fourEyes(input) {
  required(input.proposedBy, "proposedBy"); required(input.approvedBy, "approvedBy"); required(input.approvalRef, "approvalRef");
  if (input.proposedBy === input.approvedBy) fail("identity_four_eyes_required", "Independent approval is required.");
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function checksum(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function collection(state, key) { return state[key] ?? {}; }
function assertVersion(profile, expected, label) {
  if (!Number.isInteger(expected) || expected < 0) fail("identity_version_required", `${label} expected version is required.`);
  if ((profile.version ?? 0) !== expected) fail("identity_version_conflict", `${label} changed after review.`);
}
function outboxEvent(eventId, type, aggregateId, payload, now) {
  return { eventId, eventType: type, aggregateType: "customer_identity_merge", aggregateId, payload, payloadChecksumSha256: checksum(payload), status: "pending", attempts: 0, createdAt: now.toISOString() };
}

export function prepareCustomerIdentityMerge(state, input, now = new Date()) {
  fourEyes(input);
  const mergeId = required(input.mergeId, "mergeId");
  if (collection(state, "customerIdentityMerges")[mergeId]) fail("identity_merge_exists", "Merge id already exists.");
  const survivor = collection(state, "borrowerProfiles")[required(input.survivorBorrowerId, "survivorBorrowerId")];
  const duplicate = collection(state, "borrowerProfiles")[required(input.duplicateBorrowerId, "duplicateBorrowerId")];
  if (!survivor || !duplicate || survivor === duplicate || input.survivorBorrowerId === input.duplicateBorrowerId) fail("identity_profiles_invalid", "Two distinct customer profiles are required.");
  assertVersion(survivor, input.expectedSurvivorVersion, "Survivor profile"); assertVersion(duplicate, input.expectedDuplicateVersion, "Duplicate profile");
  const decisions = input.fieldDecisions;
  if (!decisions || typeof decisions !== "object" || Array.isArray(decisions) || !Object.keys(decisions).length) fail("identity_field_decisions_required", "Per-field conflict decisions are required.");
  const mergedFields = {};
  for (const [field, decision] of Object.entries(decisions)) {
    if (!decision || !["survivor", "duplicate", "manual"].includes(decision.source)) fail("identity_field_decision_invalid", `A closed decision is required for ${field}.`);
    if (decision.source === "manual" && !("value" in decision)) fail("identity_field_decision_invalid", `A manual value is required for ${field}.`);
    mergedFields[field] = decision.source === "survivor" ? survivor[field] : decision.source === "duplicate" ? duplicate[field] : decision.value;
  }
  const reviewed = { survivorBorrowerId: input.survivorBorrowerId, duplicateBorrowerId: input.duplicateBorrowerId, survivorVersion: survivor.version ?? 0, duplicateVersion: duplicate.version ?? 0, fieldDecisions: decisions, mergedFields };
  const operation = { mergeId, ...reviewed, reviewChecksumSha256: checksum(reviewed), status: "approved", proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, approvedAt: now.toISOString(), executionIdempotencyKey: null, rollbackIdempotencyKey: null };
  return { state: { ...state, customerIdentityMerges: { ...collection(state, "customerIdentityMerges"), [mergeId]: operation } }, operation };
}

export function reconcileExternalIdentity(state, input, now = new Date()) {
  fourEyes(input);
  const provider = required(input.provider, "provider"); const externalSubjectId = required(input.externalSubjectId, "externalSubjectId"); const borrowerId = required(input.borrowerId, "borrowerId");
  if (!collection(state, "borrowerProfiles")[borrowerId]) fail("identity_profile_missing", "Customer profile does not exist.");
  const key = `${provider}:${externalSubjectId}`; const current = collection(state, "externalIdentityLinks")[key];
  if (current && current.borrowerId !== borrowerId && input.decision !== "reassign") fail("identity_external_conflict", "External identity is linked to another customer and explicit reassignment is required.");
  if (!input.evidenceRefs?.length) fail("identity_evidence_required", "External identity evidence is required.");
  const link = { provider, externalSubjectId, borrowerId, providerVerificationRef: required(input.providerVerificationRef, "providerVerificationRef"), evidenceRefs: [...input.evidenceRefs], version: (current?.version ?? 0) + 1, status: "verified", proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, reconciledAt: now.toISOString() };
  return { state: { ...state, externalIdentityLinks: { ...collection(state, "externalIdentityLinks"), [key]: link } }, link };
}

export function executeCustomerIdentityMerge(state, mergeId, input, now = new Date()) {
  fourEyes(input); const operation = collection(state, "customerIdentityMerges")[mergeId];
  if (!operation) fail("identity_merge_missing", "Approved merge does not exist.");
  if (operation.status === "executed" && operation.executionIdempotencyKey === input.idempotencyKey) return { state, operation, idempotent: true };
  if (operation.status !== "approved") fail("identity_merge_not_executable", "Only an approved merge can execute.");
  required(input.idempotencyKey, "idempotencyKey");
  if (input.expectedReviewChecksumSha256 !== operation.reviewChecksumSha256) fail("identity_checksum_mismatch", "Reviewed merge checksum does not match.");
  const profiles = collection(state, "borrowerProfiles"); const survivor = profiles[operation.survivorBorrowerId]; const duplicate = profiles[operation.duplicateBorrowerId];
  if (!survivor || !duplicate) fail("identity_profile_missing", "Reviewed customer profile is unavailable.");
  assertVersion(survivor, operation.survivorVersion, "Survivor profile"); assertVersion(duplicate, operation.duplicateVersion, "Duplicate profile");
  const snapshot = { survivor: structuredClone(survivor), duplicate: structuredClone(duplicate) };
  const updatedSurvivor = { ...survivor, ...operation.mergedFields, version: operation.survivorVersion + 1, updatedAt: now.toISOString() };
  const updatedDuplicate = { ...duplicate, status: "merged", mergedIntoBorrowerId: operation.survivorBorrowerId, version: operation.duplicateVersion + 1, updatedAt: now.toISOString() };
  const eventId = `customer-identity-merge:${mergeId}`; const payload = { mergeId, survivorBorrowerId: operation.survivorBorrowerId, duplicateBorrowerId: operation.duplicateBorrowerId, reviewChecksumSha256: operation.reviewChecksumSha256 };
  const executed = { ...operation, status: "executed", executionIdempotencyKey: input.idempotencyKey, executionEvidenceRefs: input.evidenceRefs ?? [], rollbackSnapshot: snapshot, rollbackSnapshotChecksumSha256: checksum(snapshot), executedBy: input.approvedBy, executedAt: now.toISOString() };
  const next = { ...state, borrowerProfiles: { ...profiles, [operation.survivorBorrowerId]: updatedSurvivor, [operation.duplicateBorrowerId]: updatedDuplicate }, customerIdentityMerges: { ...collection(state, "customerIdentityMerges"), [mergeId]: executed }, outbox: { ...collection(state, "outbox"), [eventId]: outboxEvent(eventId, "customer.identity.merged", mergeId, payload, now) } };
  return { state: next, operation: executed, event: next.outbox[eventId], idempotent: false };
}

export function rollbackCustomerIdentityMerge(state, mergeId, input, now = new Date()) {
  fourEyes(input); const operation = collection(state, "customerIdentityMerges")[mergeId];
  if (!operation) fail("identity_merge_missing", "Executed merge does not exist.");
  if (operation.status === "rolled_back" && operation.rollbackIdempotencyKey === input.idempotencyKey) return { state, operation, idempotent: true };
  if (operation.status !== "executed") fail("identity_merge_not_rollbackable", "Only an executed merge can be rolled back.");
  required(input.idempotencyKey, "idempotencyKey");
  if (input.expectedRollbackSnapshotChecksumSha256 !== operation.rollbackSnapshotChecksumSha256 || checksum(operation.rollbackSnapshot) !== operation.rollbackSnapshotChecksumSha256) fail("identity_rollback_checksum_mismatch", "Rollback snapshot checksum does not match.");
  const profiles = collection(state, "borrowerProfiles"); assertVersion(profiles[operation.survivorBorrowerId], operation.survivorVersion + 1, "Survivor profile"); assertVersion(profiles[operation.duplicateBorrowerId], operation.duplicateVersion + 1, "Duplicate profile");
  const rolledBack = { ...operation, status: "rolled_back", rollbackIdempotencyKey: input.idempotencyKey, rollbackEvidenceRefs: input.evidenceRefs ?? [], rolledBackBy: input.approvedBy, rolledBackAt: now.toISOString() };
  const eventId = `customer-identity-rollback:${mergeId}`; const payload = { mergeId, restoredSnapshotChecksumSha256: operation.rollbackSnapshotChecksumSha256 };
  const next = { ...state, borrowerProfiles: { ...profiles, [operation.survivorBorrowerId]: operation.rollbackSnapshot.survivor, [operation.duplicateBorrowerId]: operation.rollbackSnapshot.duplicate }, customerIdentityMerges: { ...collection(state, "customerIdentityMerges"), [mergeId]: rolledBack }, outbox: { ...collection(state, "outbox"), [eventId]: outboxEvent(eventId, "customer.identity.merge_rolled_back", mergeId, payload, now) } };
  return { state: next, operation: rolledBack, event: next.outbox[eventId], idempotent: false };
}
