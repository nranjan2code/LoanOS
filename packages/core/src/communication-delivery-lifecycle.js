import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("communication_delivery_invalid", `${field} is required.`); return value.trim(); }
function tenant(record, tenantId) { text(tenantId, "tenantId"); if (record?.tenantId !== tenantId) fail("communication_delivery_tenant_mismatch", "Communication delivery is outside the tenant scope."); }
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function callbackMaterial(provider, eventId, timestamp, rawBody) { return `${provider}.${eventId}.${timestamp}.${rawBody}`; }
const CHANNELS = new Set(["sms", "email", "whatsapp"]);
const TRANSITIONS = {
  queued: new Set(["submitted", "failed", "opted_out"]), submitted: new Set(["delivered", "bounced", "failed", "opted_out"]),
  delivered: new Set(["read", "opted_out"]), read: new Set(["opted_out"]), bounced: new Set(), failed: new Set(), opted_out: new Set()
};

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

export function verifyCommunicationCallback(input = {}, secret, now = new Date()) {
  const provider = text(input.provider, "provider"); const eventId = text(input.eventId, "eventId"); const timestamp = text(input.timestamp, "timestamp"); const rawBody = text(input.rawBody, "rawBody"); text(secret, "callbackSecret");
  const occurred = Date.parse(timestamp); if (!Number.isFinite(occurred) || Math.abs(now.getTime() - occurred) > 5 * 60_000) fail("communication_callback_expired", "Callback timestamp is outside the replay window.");
  if (!/^[a-f0-9]{64}$/i.test(input.signature ?? "")) fail("communication_callback_signature_invalid", "Callback signature is invalid.");
  const expected = createHmac("sha256", secret).update(callbackMaterial(provider, eventId, timestamp, rawBody)).digest("hex"); const supplied = String(input.signature).toLowerCase();
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"))) fail("communication_callback_signature_invalid", "Callback signature is invalid.");
  let payload; try { payload = JSON.parse(rawBody); } catch { fail("communication_callback_payload_invalid", "Callback payload must be JSON."); }
  return { provider, eventId, timestamp: new Date(occurred).toISOString(), payload, payloadChecksumSha256: sha(rawBody) };
}

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

export function projectCommunicationDeliveryReconciliation(registry = {}, input = {}) {
  text(input.tenantId, "tenantId"); const deliveries = Object.values(registry).filter((item) => item.tenantId === input.tenantId); const counts = Object.fromEntries(["queued", "submitted", "delivered", "read", "bounced", "failed", "opted_out"].map((status) => [status, deliveries.filter((item) => item.status === status).length]));
  const unresolved = deliveries.filter((item) => ["queued", "submitted"].includes(item.status)).map((item) => item.deliveryId).sort(); const providerUncorrelated = deliveries.filter((item) => item.status !== "queued" && !item.providerMessageId).map((item) => item.deliveryId).sort();
  return { tenantId: input.tenantId, total: deliveries.length, counts, unresolvedDeliveryIds: unresolved, providerUncorrelatedDeliveryIds: providerUncorrelated, status: unresolved.length || providerUncorrelated.length ? "exceptions" : "reconciled", projectionChecksumSha256: sha(JSON.stringify({ counts, unresolved, providerUncorrelated })) };
}

export function signCommunicationCallback({ provider, eventId, timestamp, rawBody }, secret) { return createHmac("sha256", secret).update(callbackMaterial(provider, eventId, timestamp, rawBody)).digest("hex"); }
