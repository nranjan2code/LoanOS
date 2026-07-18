import { createHash } from "node:crypto";

const TERMINAL = new Set(["delivered", "dead_letter"]);

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("callback_delivery_invalid", `${field} is required.`); return value.trim(); }
function iso(value, field) { const time = value instanceof Date ? value.getTime() : Date.parse(value); if (!Number.isFinite(time)) fail("callback_delivery_invalid", `${field} must be a valid date-time.`); return new Date(time).toISOString(); }
function sha(value) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function scoped(record, tenantId) { if (record?.tenantId !== tenantId) fail("callback_delivery_tenant_mismatch", "Callback delivery is outside the tenant scope."); }

export function enqueueProviderCallback(registry = {}, input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId"); const deliveryId = required(input.deliveryId, "deliveryId"); const provider = required(input.provider, "provider"); const eventId = required(input.eventId, "eventId"); const targetRef = required(input.targetRef, "targetRef");
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) fail("callback_delivery_invalid", "payload must be an object.");
  const maxAttempts = Number(input.maxAttempts ?? 5); const baseDelayMs = Number(input.baseDelayMs ?? 1000);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) fail("callback_delivery_invalid", "maxAttempts must be an integer from 1 to 20.");
  if (!Number.isInteger(baseDelayMs) || baseDelayMs < 100 || baseDelayMs > 86_400_000) fail("callback_delivery_invalid", "baseDelayMs must be between 100 and 86400000.");
  const immutable = { tenantId, deliveryId, provider, eventId, targetRef, payload: input.payload, signature: required(input.signature, "signature"), maxAttempts, baseDelayMs };
  const requestChecksumSha256 = sha(immutable); const duplicate = Object.values(registry).find((item) => item.tenantId === tenantId && (item.deliveryId === deliveryId || `${item.provider}:${item.eventId}` === `${provider}:${eventId}`));
  if (duplicate) { if (duplicate.requestChecksumSha256 !== requestChecksumSha256) fail("callback_delivery_idempotency_conflict", "Callback identity was reused with different content."); return { registry, delivery: duplicate, idempotent: true }; }
  const delivery = { ...immutable, payloadChecksumSha256: sha(input.payload), requestChecksumSha256, status: "pending", attemptCount: 0, nextAttemptAt: iso(input.deliverAt ?? now, "deliverAt"), lease: null, attempts: [], createdAt: now.toISOString(), updatedAt: now.toISOString() };
  return { registry: { ...registry, [deliveryId]: delivery }, delivery, idempotent: false };
}

export function claimDueProviderCallbacks(registry = {}, input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId"); const workerId = required(input.workerId, "workerId"); const limit = Number(input.limit ?? 50); const leaseMs = Number(input.leaseMs ?? 30_000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000) fail("callback_delivery_invalid", "Invalid claim limit or lease duration.");
  const nowMs = now.getTime(); const candidates = Object.values(registry).filter((item) => item.tenantId === tenantId && ["pending", "in_flight"].includes(item.status) && Date.parse(item.nextAttemptAt) <= nowMs && (!item.lease || Date.parse(item.lease.expiresAt) <= nowMs)).sort((a, b) => Date.parse(a.nextAttemptAt) - Date.parse(b.nextAttemptAt) || a.deliveryId.localeCompare(b.deliveryId)).slice(0, limit);
  let next = { ...registry }; const claimed = [];
  for (const item of candidates) { const updated = { ...item, status: "in_flight", lease: { workerId, claimedAt: now.toISOString(), expiresAt: new Date(nowMs + leaseMs).toISOString() }, updatedAt: now.toISOString() }; next[item.deliveryId] = updated; claimed.push(updated); }
  return { registry: next, claimed };
}

export function recordProviderCallbackAttempt(registry = {}, deliveryId, input = {}, scope = {}, now = new Date()) {
  const delivery = registry[deliveryId]; if (!delivery) fail("callback_delivery_missing", "Callback delivery does not exist."); scoped(delivery, required(scope.tenantId, "tenantId"));
  if (TERMINAL.has(delivery.status)) return { registry, delivery, idempotent: true };
  if (delivery.status !== "in_flight" || delivery.lease?.workerId !== input.workerId) fail("callback_delivery_lease_invalid", "Worker does not hold the active callback lease.");
  const outcome = required(input.outcome, "outcome"); if (!new Set(["delivered", "retryable_failure", "permanent_failure"]).has(outcome)) fail("callback_delivery_invalid", "Invalid callback attempt outcome.");
  const attemptCount = delivery.attemptCount + 1; const attempt = { attempt: attemptCount, workerId: input.workerId, outcome, responseStatus: input.responseStatus ?? null, errorCode: input.errorCode ?? null, evidenceRef: required(input.evidenceRef, "evidenceRef"), attemptedAt: now.toISOString() };
  let status = outcome === "delivered" ? "delivered" : "pending"; let nextAttemptAt = null;
  if (outcome === "permanent_failure" || (outcome === "retryable_failure" && attemptCount >= delivery.maxAttempts)) status = "dead_letter";
  else if (status === "pending") nextAttemptAt = new Date(now.getTime() + delivery.baseDelayMs * (2 ** (attemptCount - 1))).toISOString();
  const updated = { ...delivery, status, attemptCount, nextAttemptAt, lease: null, attempts: [...delivery.attempts, attempt], deliveredAt: status === "delivered" ? now.toISOString() : delivery.deliveredAt ?? null, deadLetteredAt: status === "dead_letter" ? now.toISOString() : null, updatedAt: now.toISOString() };
  return { registry: { ...registry, [deliveryId]: updated }, delivery: updated, attempt, idempotent: false };
}

export function replayDeadLetterCallback(registry = {}, deliveryId, input = {}, scope = {}, now = new Date()) {
  const delivery = registry[deliveryId]; if (!delivery) fail("callback_delivery_missing", "Callback delivery does not exist."); scoped(delivery, required(scope.tenantId, "tenantId"));
  if (delivery.status !== "dead_letter") fail("callback_delivery_replay_invalid", "Only a dead-letter callback can be replayed.");
  required(input.approvedBy, "approvedBy"); required(input.approvalRef, "approvalRef"); if (input.approvedBy === input.requestedBy) fail("callback_delivery_four_eyes_required", "Dead-letter replay requires independent approval.");
  const replay = { requestedBy: required(input.requestedBy, "requestedBy"), approvedBy: input.approvedBy, approvalRef: input.approvalRef, reason: required(input.reason, "reason"), replayedAt: now.toISOString() };
  const updated = { ...delivery, status: "pending", attemptCount: 0, nextAttemptAt: now.toISOString(), lease: null, deadLetteredAt: null, replayHistory: [...(delivery.replayHistory ?? []), replay], updatedAt: now.toISOString() };
  return { registry: { ...registry, [deliveryId]: updated }, delivery: updated };
}

export function projectProviderCallbackQueue(registry = {}, input = {}) {
  const tenantId = required(input.tenantId, "tenantId"); const records = Object.values(registry).filter((item) => item.tenantId === tenantId); const counts = Object.fromEntries(["pending", "in_flight", "delivered", "dead_letter"].map((status) => [status, records.filter((item) => item.status === status).length]));
  const deadLetterIds = records.filter((item) => item.status === "dead_letter").map((item) => item.deliveryId).sort();
  return { tenantId, total: records.length, counts, deadLetterIds, status: deadLetterIds.length ? "exceptions" : "healthy", projectionChecksumSha256: sha({ counts, deadLetterIds }) };
}
