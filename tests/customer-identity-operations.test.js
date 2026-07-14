import test from "node:test";
import assert from "node:assert/strict";
import { executeCustomerIdentityMerge, prepareCustomerIdentityMerge, reconcileExternalIdentity, rollbackCustomerIdentityMerge } from "../packages/core/src/customer-identity-operations.js";

const NOW = new Date("2026-07-15T00:00:00.000Z");
const approval = { proposedBy: "identity_maker", approvedBy: "identity_checker", approvalRef: "approval/identity/1" };
const base = () => ({ borrowerProfiles: { b1: { borrowerId: "b1", version: 2, name: "Asha", phone: "111", status: "active" }, b2: { borrowerId: "b2", version: 4, name: "Asha K", phone: "222", status: "active" } } });

test("per-field decisions are independently approved and checksum-bound", () => {
  assert.throws(() => prepareCustomerIdentityMerge(base(), { mergeId: "m1", survivorBorrowerId: "b1", duplicateBorrowerId: "b2", expectedSurvivorVersion: 2, expectedDuplicateVersion: 4, fieldDecisions: { phone: { source: "duplicate" } }, ...approval, approvedBy: "identity_maker" }, NOW), (error) => error.code === "identity_four_eyes_required");
  assert.throws(() => prepareCustomerIdentityMerge(base(), { mergeId: "m1", survivorBorrowerId: "b1", duplicateBorrowerId: "b2", expectedSurvivorVersion: 2, expectedDuplicateVersion: 4, fieldDecisions: { phone: { source: "unresolved" } }, ...approval }, NOW), (error) => error.code === "identity_field_decision_invalid");
  const result = prepareCustomerIdentityMerge(base(), { mergeId: "m1", survivorBorrowerId: "b1", duplicateBorrowerId: "b2", expectedSurvivorVersion: 2, expectedDuplicateVersion: 4, fieldDecisions: { name: { source: "survivor" }, phone: { source: "duplicate" } }, ...approval }, NOW);
  assert.deepEqual(result.operation.mergedFields, { name: "Asha", phone: "222" }); assert.match(result.operation.reviewChecksumSha256, /^[a-f0-9]{64}$/);
});

test("external identities fail closed on conflicts and retain provider evidence", () => {
  let state = { ...base(), externalIdentityLinks: { "ckyc:K1": { provider: "ckyc", externalSubjectId: "K1", borrowerId: "b2", version: 1 } } };
  assert.throws(() => reconcileExternalIdentity(state, { provider: "ckyc", externalSubjectId: "K1", borrowerId: "b1", providerVerificationRef: "ckyc/response/1", evidenceRefs: ["evidence/1"], ...approval }, NOW), (error) => error.code === "identity_external_conflict");
  const result = reconcileExternalIdentity(state, { provider: "ckyc", externalSubjectId: "K1", borrowerId: "b1", decision: "reassign", providerVerificationRef: "ckyc/response/1", evidenceRefs: ["evidence/1"], ...approval }, NOW);
  assert.equal(result.link.borrowerId, "b1"); assert.equal(result.link.version, 2);
});

test("merge emits an outbox event, is idempotent, and rejects stale versions", () => {
  const prepared = prepareCustomerIdentityMerge(base(), { mergeId: "m1", survivorBorrowerId: "b1", duplicateBorrowerId: "b2", expectedSurvivorVersion: 2, expectedDuplicateVersion: 4, fieldDecisions: { phone: { source: "duplicate" } }, ...approval }, NOW);
  assert.throws(() => executeCustomerIdentityMerge(prepared.state, "m1", { idempotencyKey: "exec-1", expectedReviewChecksumSha256: "0".repeat(64), ...approval }, NOW), (error) => error.code === "identity_checksum_mismatch");
  const stale = { ...prepared.state, borrowerProfiles: { ...prepared.state.borrowerProfiles, b1: { ...prepared.state.borrowerProfiles.b1, version: 3 } } };
  assert.throws(() => executeCustomerIdentityMerge(stale, "m1", { idempotencyKey: "exec-1", expectedReviewChecksumSha256: prepared.operation.reviewChecksumSha256, ...approval }, NOW), (error) => error.code === "identity_version_conflict");
  const result = executeCustomerIdentityMerge(prepared.state, "m1", { idempotencyKey: "exec-1", expectedReviewChecksumSha256: prepared.operation.reviewChecksumSha256, evidenceRefs: ["evidence/execution"], ...approval }, NOW);
  assert.equal(result.state.borrowerProfiles.b1.phone, "222"); assert.equal(result.state.borrowerProfiles.b2.mergedIntoBorrowerId, "b1"); assert.equal(result.event.eventType, "customer.identity.merged");
  assert.equal(executeCustomerIdentityMerge(result.state, "m1", { idempotencyKey: "exec-1", ...approval }, NOW).idempotent, true);
});

test("checksum-bound rollback restores both profiles and guards concurrent changes", () => {
  const prepared = prepareCustomerIdentityMerge(base(), { mergeId: "m1", survivorBorrowerId: "b1", duplicateBorrowerId: "b2", expectedSurvivorVersion: 2, expectedDuplicateVersion: 4, fieldDecisions: { phone: { source: "duplicate" } }, ...approval }, NOW);
  const executed = executeCustomerIdentityMerge(prepared.state, "m1", { idempotencyKey: "exec-1", expectedReviewChecksumSha256: prepared.operation.reviewChecksumSha256, ...approval }, NOW);
  const operation = executed.operation;
  assert.throws(() => rollbackCustomerIdentityMerge(executed.state, "m1", { idempotencyKey: "rb-1", expectedRollbackSnapshotChecksumSha256: "0".repeat(64), ...approval }, NOW), (error) => error.code === "identity_rollback_checksum_mismatch");
  const changed = { ...executed.state, borrowerProfiles: { ...executed.state.borrowerProfiles, b1: { ...executed.state.borrowerProfiles.b1, version: 4 } } };
  assert.throws(() => rollbackCustomerIdentityMerge(changed, "m1", { idempotencyKey: "rb-1", expectedRollbackSnapshotChecksumSha256: operation.rollbackSnapshotChecksumSha256, ...approval }, NOW), (error) => error.code === "identity_version_conflict");
  const result = rollbackCustomerIdentityMerge(executed.state, "m1", { idempotencyKey: "rb-1", expectedRollbackSnapshotChecksumSha256: operation.rollbackSnapshotChecksumSha256, evidenceRefs: ["evidence/rollback"], ...approval }, NOW);
  assert.deepEqual(result.state.borrowerProfiles.b1, base().borrowerProfiles.b1); assert.deepEqual(result.state.borrowerProfiles.b2, base().borrowerProfiles.b2); assert.equal(result.event.eventType, "customer.identity.merge_rolled_back");
  assert.equal(rollbackCustomerIdentityMerge(result.state, "m1", { idempotencyKey: "rb-1", ...approval }, NOW).idempotent, true);
});
