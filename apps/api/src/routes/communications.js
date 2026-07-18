import { createHash } from "node:crypto";
import {
  ExternalServiceManager,
  createCommunicationDelivery,
  projectCommunicationDeliveryReconciliation,
  recordCommunicationCallback,
  signCommunicationCallback,
  createLoanId
} from "@loanos/core";

export async function routeCommunications(context) {
  const { method, path, url, req, res, tenant, store, readJson, sendJson, appendEvent } = context;

  if (method === "GET" && path === "/communications") {
    const state = await store.load();
    const communications = Object.values(state.communications ?? {}).filter((record) =>
      communicationMatchesFilters(record, url)
    );
    sendJson(res, 200, {
      count: communications.length,
      communications
    });
    return true;
  }

  if (method === "GET" && path === "/integrations/communications/reconciliation") {
    const state = await store.load();
    sendJson(res, 200, projectCommunicationDeliveryReconciliation(state.communicationDeliveries, { tenantId: tenant.tenantId }));
    return true;
  }

  const communicationCallback = path.match(/^\/integrations\/communications\/callbacks\/([^/]+)$/);
  if (method === "POST" && communicationCallback) {
    const provider = decodeURIComponent(communicationCallback[1]); const body = await readJson(req); const state = await store.load();
    const secret = communicationCallbackSecret(provider, tenant);
    if (!secret) { sendJson(res, 503, { error: { code: "communication_callback_secret_missing", message: "Communication callback secret is not configured." } }); return true; }
    try {
      const rawBody = JSON.stringify(body.payload ?? {});
      const result = recordCommunicationCallback(state.communicationDeliveries, { provider, eventId: body.eventId, timestamp: body.timestamp, signature: body.signature, rawBody }, secret, { tenantId: tenant.tenantId });
      if (!result.idempotent) await store.save(appendEvent({ ...state, communicationDeliveries: result.registry }, { type: `integration.communication.${result.delivery.status}`, communicationId: result.delivery.deliveryId, channel: result.delivery.channel, provider, providerRef: result.delivery.providerMessageId, actor: "provider_callback" }));
      sendJson(res, 200, { delivery: result.delivery, idempotent: result.idempotent }); return true;
    } catch (err) { sendJson(res, 422, { error: { code: err.code ?? "communication_callback_invalid", message: err.message } }); return true; }
  }

  if (method === "POST" && path === "/integrations/communications") {
    const body = await readJson(req);
    let payload = null;
    try {
      payload = normalizeCommunicationPayload(body);
    } catch (err) {
      sendJson(res, 422, {
        error: {
          code: "communication_invalid",
          message: err.message
        }
      });
      return true;
    }

    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox, providerCertifications: (await store.load()).providerCertifications });
    let dispatch = null;
    try {
      dispatch = await manager.sendCommunication(payload);
    } catch (err) {
      sendJson(res, 422, {
        error: {
          code: "communication_dispatch_failed",
          message: err.message
        }
      });
      return true;
    }

    const state = await store.load();
    const record = buildCommunicationRecord(body, payload, dispatch);
    let lifecycle;
    try {
      lifecycle = createCommunicationDelivery(state.communicationDeliveries, { tenantId: tenant.tenantId, deliveryId: record.communicationId, channel: record.channel, recipientRef: body.borrowerId ?? `recipient:${hashString(payload.to)}`, templateId: body.templateId ?? "adhoc", templateVersion: body.templateVersion ?? "1", dltTemplateId: payload.dlt?.templateId, dltEntityId: payload.dlt?.entityId, idempotencyKey: body.idempotencyKey ?? record.communicationId, provider: dispatch.provider });
      const secret = communicationCallbackSecret(dispatch.provider, tenant);
      if (!secret && dispatch.provider !== "mock" && !tenant.isSandbox) throw Object.assign(new Error("Communication callback secret is required for a real provider."), { code: "communication_callback_secret_missing" });
      const callbackSecret = secret ?? "sandbox-communication-callback-secret"; const timestamp = new Date().toISOString(); const callbackPayload = { deliveryId: record.communicationId, status: dispatch.success ? "submitted" : "failed", providerMessageId: dispatch.ref, failureCode: dispatch.success ? undefined : "DISPATCH_FAILED", failureReason: dispatch.success ? undefined : "Provider rejected dispatch." }; const rawBody = JSON.stringify(callbackPayload); const eventId = `dispatch:${record.communicationId}`;
      lifecycle = recordCommunicationCallback(lifecycle.registry, { provider: dispatch.provider, eventId, timestamp, rawBody, signature: signCommunicationCallback({ provider: dispatch.provider, eventId, timestamp, rawBody }, callbackSecret) }, callbackSecret, { tenantId: tenant.tenantId });
    } catch (err) { sendJson(res, 422, { error: { code: err.code ?? "communication_lifecycle_failed", message: err.message } }); return true; }
    const nextState = appendEvent(
      {
        ...state,
        communicationDeliveries: lifecycle.registry,
        communications: {
          ...(state.communications ?? {}),
          [record.communicationId]: record
        }
      },
      {
        type: "integration.communication.sent",
        communicationId: record.communicationId,
        channel: record.channel,
        purpose: record.purpose,
        borrowerId: record.borrowerId,
        applicationId: record.applicationId,
        provider: record.provider,
        providerRef: record.providerRef,
        dataResidencyCountry: record.dataResidencyCountry
      }
    );
    await store.save(nextState);
    sendJson(res, 201, { communication: record, delivery: lifecycle.delivery });
    return true;
  }

  return false;
}

// Helpers
function communicationMatchesFilters(record, url) {
  const filters = {
    channel: url.searchParams.get("channel"),
    purpose: url.searchParams.get("purpose"),
    borrowerId: url.searchParams.get("borrowerId"),
    applicationId: url.searchParams.get("applicationId"),
    loanAccountId: url.searchParams.get("loanAccountId")
  };
  if (filters.channel && record.channel !== filters.channel) return false;
  if (filters.purpose && record.purpose !== filters.purpose) return false;
  if (filters.borrowerId && record.borrowerId !== filters.borrowerId) return false;
  if (filters.applicationId && record.applicationId !== filters.applicationId) return false;
  if (filters.loanAccountId && record.loanAccountId !== filters.loanAccountId) return false;
  return true;
}

function normalizeCommunicationPayload(input = {}) {
  const channel = input.channel;
  if (!["sms", "email", "whatsapp"].includes(channel)) {
    throw new Error("Communication channel must be sms, email, or whatsapp.");
  }
  const to = input.to ?? input.phone ?? input.email;
  if (!to) {
    throw new Error("Communication recipient is required.");
  }
  if (!input.message) {
    throw new Error("Communication message is required.");
  }
  if (channel === "email" && !input.subject) {
    throw new Error("Email communication requires subject.");
  }
  let dlt = null;
  if (channel === "sms") {
    if (!input.dltEntityId || !input.dltTemplateId || !input.senderId) {
      throw new Error("SMS requires TRAI DLT registration: dltEntityId, dltTemplateId, and a registered senderId (header).");
    }
    dlt = {
      entityId: input.dltEntityId,
      templateId: input.dltTemplateId,
      senderId: input.senderId
    };
  }
  return {
    channel,
    to,
    subject: input.subject ?? null,
    message: input.message,
    dlt
  };
}

function buildCommunicationRecord(input, payload, dispatch, now = new Date()) {
  const subject = payload.subject ?? "";
  const message = String(payload.message ?? "");
  return {
    communicationId: input.communicationId ?? createLoanId("comm"),
    channel: payload.channel,
    purpose: input.purpose ?? "transactional",
    borrowerId: input.borrowerId ?? null,
    applicationId: input.applicationId ?? null,
    loanAccountId: input.loanAccountId ?? null,
    templateId: input.templateId ?? null,
    dlt: payload.dlt ?? null,
    recipientMasked: maskRecipient(payload.channel, payload.to),
    subjectSha256: subject ? hashString(subject) : null,
    subjectLength: subject.length,
    messageSha256: hashString(message),
    messageLength: message.length,
    provider: dispatch.provider,
    providerRef: dispatch.ref,
    dataResidencyCountry: dispatch.dataResidencyCountry,
    status: dispatch.success ? "sent" : "failed",
    sentAt: now.toISOString()
  };
}

function communicationCallbackSecret(provider, tenant) {
  let configured = {};
  try { configured = JSON.parse(process.env.LOANOS_PROVIDER_CALLBACK_SECRETS ?? "{}"); } catch { configured = {}; }
  return configured[`communications_${provider}`] ?? configured[provider] ?? (tenant?.isSandbox || provider === "mock" ? "sandbox-communication-callback-secret" : null);
}

function maskRecipient(channel, value) {
  const recipient = String(value ?? "");
  if (channel === "email") {
    const [local, domain] = recipient.split("@");
    return `${(local ?? "").slice(0, 2)}***@${domain ?? "***"}`;
  }
  const digits = recipient.replace(/\D/g, "");
  return `***${digits.slice(-4)}`;
}

function hashString(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}
