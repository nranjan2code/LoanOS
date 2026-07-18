import assert from "node:assert/strict";
import test from "node:test";
import { buildSuccessionOperationsQueue, reconcileSuccessionExternalInstruction, registerSuccessionOperationsPolicy, submitSuccessionExternalInstruction } from "@loanos/core/operations/succession-operations.js";

const NOW = new Date("2026-07-15T12:00:00.000Z"); const approval = { proposedBy: "ops-maker", approvedBy: "ops-checker", approvalRef: "approval/1" };

test("succession external instructions require certified lineage and signed reconciliation", () => {
  const state = { successionServiceExecutions: { execution1: { executionId: "execution1", actionId: "action1", caseId: "case1", status: "executed" } }, providerCertifications: { cert1: { certificationId: "cert1", providerFamily: "registrar", status: "active", validUntil: "2026-08-15T00:00:00.000Z" } } };
  const instruction = submitSuccessionExternalInstruction({}, state, { instructionId: "instruction1", executionId: "execution1", connector: "registrar", providerCertificationId: "cert1", jurisdictionRef: "MH/registrar", payload: { deedRef: "deed/1" }, idempotencyKey: "registrar:case1:1", providerRequestRef: "provider/request1", ...approval }, NOW).instruction;
  assert.throws(() => reconcileSuccessionExternalInstruction(instruction, { providerRequestRef: "provider/request1", payloadChecksumSha256: instruction.payloadChecksumSha256, providerEventRef: "event1", outcome: "completed", completionRef: "completion1", signatureVerified: false, signatureEvidenceRef: "signature/1" }, NOW), /Verified provider signature/);
  const completed = reconcileSuccessionExternalInstruction(instruction, { providerRequestRef: "provider/request1", payloadChecksumSha256: instruction.payloadChecksumSha256, providerEventRef: "event1", outcome: "completed", completionRef: "completion1", signatureVerified: true, signatureEvidenceRef: "signature/1" }, NOW); assert.equal(completed.status, "completed");
});

test("succession operations queue exposes SLA breaches and capacity pressure", () => {
  const policy = registerSuccessionOperationsPolicy({}, { policyId: "policy1", queueTargets: { legal_review: { capacity: 1, slaHours: 4 }, external_registrar: { capacity: 1, slaHours: 2 } }, escalationRoles: ["legal_head", "operations_head"], effectiveFrom: "2026-07-15T00:00:00.000Z", ...approval }, NOW).policy;
  const queue = buildSuccessionOperationsQueue({ successionOperationsPolicies: { policy1: policy }, successionLegalReviews: { review1: { reviewId: "review1", actionId: "action1", status: "assigned", assignedTo: "lawyer1", createdAt: "2026-07-15T05:00:00.000Z", dueAt: "2026-07-15T10:00:00.000Z" } }, successionExternalInstructions: { instruction1: { instructionId: "instruction1", actionId: "action1", connector: "registrar", status: "submitted", submittedAt: "2026-07-15T08:00:00.000Z" } }, successionQueueAssignments: {} }, NOW);
  assert.equal(queue.capacity.legal_review.breached, 1); assert.equal(queue.capacity.external_registrar.utilizationPercent, 100); assert.equal(queue.items.find((item) => item.itemId === "instruction1").escalationRequired, true);
});
