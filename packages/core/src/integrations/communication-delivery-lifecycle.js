/**
 * Communication delivery lifecycle: tracks the state of a single outbound
 * borrower communication (SMS/email/WhatsApp) from creation through
 * provider callback (delivered/read/bounced/failed/opted_out). This module
 * does not send messages — it only records the delivery intent, verifies
 * and applies provider delivery-status callbacks, and projects a
 * reconciliation view; the actual channel adapters (SMS gateway, email
 * provider, WhatsApp Business API) live elsewhere. SMS deliveries must
 * carry a DLT (Distributed Ledger Technology) template/entity id, per
 * TRAI's SMS regulatory regime for transactional/promotional traffic in
 * India.
 *
 * Every mutation is idempotent by design: `createCommunicationDelivery`
 * dedupes on `deliveryId`/`idempotencyKey` (rejecting a reused key with
 * different payload as a conflict, not silently overwriting), and
 * `recordCommunicationCallback` dedupes on the provider's `eventId` the same
 * way — a provider is free to retry a webhook without corrupting state.
 * Callback authenticity is enforced by `verifyCommunicationCallback`: an
 * HMAC-SHA256 signature (checked with `timingSafeEqual` to avoid timing
 * side-channels) plus a 5-minute replay window.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("communication_delivery_invalid", `${field} is required.`); return value.trim(); }
function tenant(record, tenantId) { text(tenantId, "tenantId"); if (record?.tenantId !== tenantId) fail("communication_delivery_tenant_mismatch", "Communication delivery is outside the tenant scope."); }
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
// The exact byte sequence HMAC-signed for a callback; must match on both the
// verifying side and `signCommunicationCallback` (used by tests/senders of
// synthetic callbacks) or every signature check will fail.
function callbackMaterial(provider, eventId, timestamp, rawBody) { return `${provider}.${eventId}.${timestamp}.${rawBody}`; }
const CHANNELS = new Set(["sms", "email", "whatsapp"]);
const TRANSITIONS = {
  queued: new Set(["submitted", "failed", "opted_out"]), submitted: new Set(["delivered", "bounced", "failed", "opted_out"]),
  delivered: new Set(["read", "opted_out"]), read: new Set(["opted_out"]), bounced: new Set(), failed: new Set(), opted_out: new Set()
};

/**
 * Register a new outbound communication in `queued` status. Idempotent on
 * `deliveryId`/`idempotencyKey`: a retried create with an identical payload
 * returns the existing delivery (`idempotent: true`); a reused key with a
 * different payload is rejected as a conflict rather than silently
 * overwriting the original request. SMS requires a DLT template/entity id
 * (TRAI requirement) before it can be queued.
 * @param {Record<string, object>} registry - deliveryId -> delivery record.
 * @param {object} input - deliveryId/tenantId/channel/recipientRef/templateId/templateVersion/idempotencyKey, +dltTemplateId/dltEntityId for sms.
 * @param {Date} [now]
 * @returns {{registry: object, delivery: object, idempotent: boolean}}
 */
export function createCommunicationDelivery(registry = {}, input = {}, now = new Date()) {
  const deliveryId = text(input.deliveryId, "deliveryId"); const tenantId = text(input.tenantId, "tenantId"); const channel = text(input.channel, "channel");
  if (!CHANNELS.has(channel)) fail("communication_delivery_channel_invalid", "Channel must be sms, email, or whatsapp.");
  text(input.recipientRef, "recipientRef"); text(input.templateId, "templateId"); text(input.templateVersion, "templateVersion"); text(input.idempotencyKey, "idempotencyKey");
  if (channel === "sms" && (!input.dltTemplateId || !input.dltEntityId)) fail("communication_delivery_dlt_required", "SMS delivery requires DLT template and entity identifiers.");
  const immutable = { tenantId, deliveryId, channel, recipientRef: input.recipientRef, templateId: input.templateId, templateVersion: input.templateVersion, dltTemplateId: input.dltTemplateId ?? null, dltEntityId: input.dltEntityId ?? null, idempotencyKey: input.idempotencyKey };
  const requestChecksumSha256 = sha(JSON.stringify(immutable)); const duplicate = Object.values(registry).find((item) => item.tenantId === tenantId && (item.deliveryId === deliveryId || item.idempotencyKey === input.idempotencyKey));
  if (duplicate) { if (duplicate.requestChecksumSha256 !== requestChecksumSha256) fail("communication_delivery_idempotency_conflict", "Idempotency key was reused with different delivery data."); return { registry, delivery: duplicate, idempotent: true }; }
  const delivery = { ...immutable, provider: input.provider ?? null, providerMessageId: null, requestChecksumSha256, status: "queued", events: [], createdAt: now.toISOString(), updatedAt: now.toISOString() };
  return { registry: { ...registry, [deliveryId]: delivery }, delivery, idempotent: false };
}

/**
 * Authenticate a raw provider callback: checks the timestamp is within a
 * 5-minute replay window, the signature is a well-formed hex SHA-256, and
 * the HMAC (computed over `callbackMaterial`) matches via `timingSafeEqual`
 * — never a plain `===` comparison, which would leak timing information
 * about how many leading bytes matched. Does not touch any delivery state;
 * `recordCommunicationCallback` calls this first and then applies the
 * verified payload.
 * @param {object} input - provider/eventId/timestamp/rawBody/signature.
 * @param {string} secret - shared HMAC secret for this provider.
 * @param {Date} [now]
 * @returns {{provider: string, eventId: string, timestamp: string, payload: object, payloadChecksumSha256: string}}
 */
export function verifyCommunicationCallback(input = {}, secret, now = new Date()) {
  const provider = text(input.provider, "provider"); const eventId = text(input.eventId, "eventId"); const timestamp = text(input.timestamp, "timestamp"); const rawBody = text(input.rawBody, "rawBody"); text(secret, "callbackSecret");
  const occurred = Date.parse(timestamp); if (!Number.isFinite(occurred) || Math.abs(now.getTime() - occurred) > 5 * 60_000) fail("communication_callback_expired", "Callback timestamp is outside the replay window.");
  if (!/^[a-f0-9]{64}$/i.test(input.signature ?? "")) fail("communication_callback_signature_invalid", "Callback signature is invalid.");
  const expected = createHmac("sha256", secret).update(callbackMaterial(provider, eventId, timestamp, rawBody)).digest("hex"); const supplied = String(input.signature).toLowerCase();
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"))) fail("communication_callback_signature_invalid", "Callback signature is invalid.");
  let payload; try { payload = JSON.parse(rawBody); } catch { fail("communication_callback_payload_invalid", "Callback payload must be JSON."); }
  return { provider, eventId, timestamp: new Date(occurred).toISOString(), payload, payloadChecksumSha256: sha(rawBody) };
}

/**
 * Verify and apply a provider delivery-status callback, advancing the
 * delivery through the `TRANSITIONS` state machine (e.g. queued -> submitted
 * -> delivered -> read). Fails closed on: an unverifiable callback, a
 * missing delivery, a tenant mismatch, an illegal transition (e.g. "read"
 * for SMS, which the channel doesn't support), or a failed status without a
 * failure code. Idempotent on the provider's `eventId` — a duplicate webhook
 * delivery with identical payload is a no-op (`idempotent: true`); a
 * duplicate id with different payload is rejected as a conflict.
 * @param {Record<string, object>} registry - deliveryId -> delivery record.
 * @param {object} callbackInput - raw callback envelope, see `verifyCommunicationCallback`.
 * @param {string} secret - shared HMAC secret for this provider.
 * @param {{tenantId: string}} scope - tenant the calling context is scoped to.
 * @param {Date} [now]
 * @returns {{registry: object, delivery: object, event: object, idempotent: boolean}}
 */
export function recordCommunicationCallback(registry = {}, callbackInput = {}, secret, scope = {}, now = new Date()) {
  const verified = verifyCommunicationCallback(callbackInput, secret, now); const payload = verified.payload; const delivery = registry[payload.deliveryId];
  if (!delivery) fail("communication_delivery_missing", "Callback delivery does not exist."); tenant(delivery, scope.tenantId); if (delivery.provider && delivery.provider !== verified.provider) fail("communication_provider_mismatch", "Callback provider differs from submitted provider.");
  const previous = delivery.events.find((event) => event.eventId === verified.eventId);
  if (previous) { if (previous.payloadChecksumSha256 !== verified.payloadChecksumSha256) fail("communication_callback_idempotency_conflict", "Callback event id was reused with different data."); return { registry, delivery, event: previous, idempotent: true }; }
  const status = text(payload.status, "status"); if (!TRANSITIONS[delivery.status]?.has(status)) fail("communication_delivery_transition_invalid", `Cannot transition delivery from ${delivery.status} to ${status}.`);
  if (status === "read" && delivery.channel === "sms") fail("communication_delivery_transition_invalid", "SMS does not support read status.");
  if (status === "bounced" && delivery.channel !== "email") fail("communication_delivery_transition_invalid", "Bounce applies only to email.");
  if (status === "opted_out" && !["sms", "whatsapp"].includes(delivery.channel)) fail("communication_delivery_transition_invalid", "Opt-out callback applies only to SMS and WhatsApp.");
  if (status === "failed" && !payload.failureCode) fail("communication_delivery_failure_invalid", "Failed delivery requires a failure code.");
  if (["DLT_REJECTED", "TEMPLATE_REJECTED", "TEMPLATE_MISMATCH"].includes(payload.failureCode) && (!payload.failureReason || status !== "failed")) fail("communication_delivery_failure_invalid", "DLT/template rejection requires failed status and reason.");
  if (status === "submitted" && !payload.providerMessageId) fail("communication_provider_message_missing", "Submitted delivery requires provider message id.");
  const event = { eventId: verified.eventId, provider: verified.provider, status, occurredAt: payload.occurredAt ? new Date(payload.occurredAt).toISOString() : verified.timestamp, providerMessageId: payload.providerMessageId ?? delivery.providerMessageId, failureCode: payload.failureCode ?? null, failureReason: payload.failureReason ?? null, payloadChecksumSha256: verified.payloadChecksumSha256, receivedAt: now.toISOString() };
  const updated = { ...delivery, provider: delivery.provider ?? verified.provider, providerMessageId: event.providerMessageId, status, failureCode: event.failureCode, failureReason: event.failureReason, events: [...delivery.events, event], updatedAt: now.toISOString() };
  return { registry: { ...registry, [delivery.deliveryId]: updated }, delivery: updated, event, idempotent: false };
}

/**
 * Build a tenant-scoped reconciliation summary: counts per status, plus the
 * delivery ids still `queued`/`submitted` (stuck without a terminal
 * callback) and those past `queued` but still lacking a
 * `providerMessageId` (a provider correlation gap). Either list being
 * non-empty marks the projection `"exceptions"` rather than `"reconciled"`
 * — the signal an ops/compliance reviewer scans for.
 * @param {Record<string, object>} registry - deliveryId -> delivery record.
 * @param {{tenantId: string}} input
 * @returns {object} reconciliation summary with a checksum over its own contents.
 */
export function projectCommunicationDeliveryReconciliation(registry = {}, input = {}) {
  text(input.tenantId, "tenantId"); const deliveries = Object.values(registry).filter((item) => item.tenantId === input.tenantId); const counts = Object.fromEntries(["queued", "submitted", "delivered", "read", "bounced", "failed", "opted_out"].map((status) => [status, deliveries.filter((item) => item.status === status).length]));
  const unresolved = deliveries.filter((item) => ["queued", "submitted"].includes(item.status)).map((item) => item.deliveryId).sort(); const providerUncorrelated = deliveries.filter((item) => item.status !== "queued" && !item.providerMessageId).map((item) => item.deliveryId).sort();
  return { tenantId: input.tenantId, total: deliveries.length, counts, unresolvedDeliveryIds: unresolved, providerUncorrelatedDeliveryIds: providerUncorrelated, status: unresolved.length || providerUncorrelated.length ? "exceptions" : "reconciled", projectionChecksumSha256: sha(JSON.stringify({ counts, unresolved, providerUncorrelated })) };
}

/**
 * Compute the HMAC-SHA256 signature a genuine provider callback would carry.
 * Exists so callers (tests, or a provider-callback simulator) can construct
 * a validly-signed callback without duplicating `callbackMaterial`'s framing.
 * @param {{provider: string, eventId: string, timestamp: string, rawBody: string}} fields
 * @param {string} secret - shared HMAC secret for this provider.
 * @returns {string} hex-encoded HMAC-SHA256 signature.
 */
export function signCommunicationCallback({ provider, eventId, timestamp, rawBody }, secret) { return createHmac("sha256", secret).update(callbackMaterial(provider, eventId, timestamp, rawBody)).digest("hex"); }
