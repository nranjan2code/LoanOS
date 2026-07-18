import { test } from "node:test";
import assert from "node:assert/strict";
import { claimDueProviderCallbacks, enqueueProviderCallback, projectProviderCallbackQueue, recordProviderCallbackAttempt, replayDeadLetterCallback } from "@loanos/core/integrations/provider-callback-delivery.js";

const T0 = new Date("2026-07-15T10:00:00.000Z");
const input = (overrides = {}) => ({ tenantId: "tenant_1", deliveryId: "delivery_1", provider: "bureau", eventId: "event_1", targetRef: "callback_subscription_1", payload: { status: "available" }, signature: "sha256=abc", maxAttempts: 2, baseDelayMs: 1000, ...overrides });

test("callback queue is tenant scoped and enqueue is content-idempotent", () => {
  let result = enqueueProviderCallback({}, input(), T0); const duplicate = enqueueProviderCallback(result.registry, input(), T0);
  assert.equal(duplicate.idempotent, true);
  assert.throws(() => enqueueProviderCallback(result.registry, input({ payload: { status: "rejected" } }), T0), (error) => error.code === "callback_delivery_idempotency_conflict");
  assert.equal(claimDueProviderCallbacks(result.registry, { tenantId: "tenant_2", workerId: "worker_1" }, T0).claimed.length, 0);
});

test("retry uses bounded exponential scheduling then dead letters", () => {
  let registry = enqueueProviderCallback({}, input(), T0).registry;
  let claim = claimDueProviderCallbacks(registry, { tenantId: "tenant_1", workerId: "worker_1" }, T0); registry = claim.registry; assert.equal(claim.claimed.length, 1);
  let attempt = recordProviderCallbackAttempt(registry, "delivery_1", { workerId: "worker_1", outcome: "retryable_failure", errorCode: "HTTP_503", evidenceRef: "attempt_1" }, { tenantId: "tenant_1" }, T0); registry = attempt.registry;
  assert.equal(attempt.delivery.nextAttemptAt, "2026-07-15T10:00:01.000Z");
  claim = claimDueProviderCallbacks(registry, { tenantId: "tenant_1", workerId: "worker_2" }, new Date("2026-07-15T10:00:01.000Z")); registry = claim.registry;
  attempt = recordProviderCallbackAttempt(registry, "delivery_1", { workerId: "worker_2", outcome: "retryable_failure", errorCode: "HTTP_503", evidenceRef: "attempt_2" }, { tenantId: "tenant_1" }, new Date("2026-07-15T10:00:01.000Z"));
  assert.equal(attempt.delivery.status, "dead_letter"); assert.equal(projectProviderCallbackQueue(attempt.registry, { tenantId: "tenant_1" }).status, "exceptions");
});

test("dead-letter replay is four-eyes and a delivered callback becomes terminal", () => {
  let registry = enqueueProviderCallback({}, input({ maxAttempts: 1 }), T0).registry;
  registry = claimDueProviderCallbacks(registry, { tenantId: "tenant_1", workerId: "worker_1" }, T0).registry;
  registry = recordProviderCallbackAttempt(registry, "delivery_1", { workerId: "worker_1", outcome: "permanent_failure", evidenceRef: "attempt_1" }, { tenantId: "tenant_1" }, T0).registry;
  assert.throws(() => replayDeadLetterCallback(registry, "delivery_1", { requestedBy: "ops_1", approvedBy: "ops_1", approvalRef: "approval_1", reason: "Provider recovered" }, { tenantId: "tenant_1" }, T0), (error) => error.code === "callback_delivery_four_eyes_required");
  registry = replayDeadLetterCallback(registry, "delivery_1", { requestedBy: "ops_1", approvedBy: "ops_2", approvalRef: "approval_1", reason: "Provider recovered" }, { tenantId: "tenant_1" }, T0).registry;
  registry = claimDueProviderCallbacks(registry, { tenantId: "tenant_1", workerId: "worker_2" }, T0).registry;
  const delivered = recordProviderCallbackAttempt(registry, "delivery_1", { workerId: "worker_2", outcome: "delivered", responseStatus: 200, evidenceRef: "attempt_2" }, { tenantId: "tenant_1" }, T0);
  assert.equal(delivered.delivery.status, "delivered"); assert.equal(recordProviderCallbackAttempt(delivered.registry, "delivery_1", {}, { tenantId: "tenant_1" }, T0).idempotent, true);
});

test("an expired worker lease is reclaimable without losing the callback", () => {
  let registry = enqueueProviderCallback({}, input(), T0).registry;
  registry = claimDueProviderCallbacks(registry, { tenantId: "tenant_1", workerId: "worker_1", leaseMs: 1000 }, T0).registry;
  const reclaimed = claimDueProviderCallbacks(registry, { tenantId: "tenant_1", workerId: "worker_2" }, new Date("2026-07-15T10:00:01.001Z"));
  assert.equal(reclaimed.claimed.length, 1); assert.equal(reclaimed.claimed[0].lease.workerId, "worker_2");
});
