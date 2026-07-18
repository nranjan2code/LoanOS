import {
  projectProviderCallbackQueue,
  enqueueProviderCallback,
  claimDueProviderCallbacks,
  recordProviderCallbackAttempt,
  replayDeadLetterCallback
} from "@loanos/core";

export async function routeCallbackDeliveries(context) {
  const { method, path, req, res, tenant, store, readJson, sendJson, appendEvent } = context;

  if (method === "GET" && path === "/integrations/callback-deliveries/queue") {
    const state = await store.load(); sendJson(res, 200, projectProviderCallbackQueue(state.providerCallbackDeliveries, { tenantId: tenant.tenantId })); return true;
  }
  if (method === "POST" && path === "/integrations/callback-deliveries") {
    const body = await readJson(req); const state = await store.load();
    try { const result = enqueueProviderCallback(state.providerCallbackDeliveries, { ...body, tenantId: tenant.tenantId }); if (!result.idempotent) await store.save(appendEvent({ ...state, providerCallbackDeliveries: result.registry }, { type: "integration.callback_delivery.enqueued", deliveryId: result.delivery.deliveryId, provider: result.delivery.provider, eventId: result.delivery.eventId, actor: body.actor ?? "integration_worker" })); sendJson(res, result.idempotent ? 200 : 201, { delivery: result.delivery, idempotent: result.idempotent }); }
    catch (error) { sendJson(res, 422, { error: { code: error.code ?? "callback_delivery_invalid", message: error.message } }); } return true;
  }
  if (method === "POST" && path === "/integrations/callback-deliveries/claim") {
    const body = await readJson(req); const state = await store.load();
    try { const result = claimDueProviderCallbacks(state.providerCallbackDeliveries, { ...body, tenantId: tenant.tenantId }); if (result.claimed.length) await store.save({ ...state, providerCallbackDeliveries: result.registry }); sendJson(res, 200, { claimed: result.claimed }); }
    catch (error) { sendJson(res, 422, { error: { code: error.code ?? "callback_delivery_claim_invalid", message: error.message } }); } return true;
  }
  const callbackDeliveryAction = path.match(/^\/integrations\/callback-deliveries\/([^/]+)\/(attempt|replay)$/);
  if (method === "POST" && callbackDeliveryAction) {
    const body = await readJson(req); const state = await store.load(); const deliveryId = decodeURIComponent(callbackDeliveryAction[1]);
    try { const result = callbackDeliveryAction[2] === "attempt" ? recordProviderCallbackAttempt(state.providerCallbackDeliveries, deliveryId, body, { tenantId: tenant.tenantId }) : replayDeadLetterCallback(state.providerCallbackDeliveries, deliveryId, body, { tenantId: tenant.tenantId }); if (!result.idempotent) await store.save(appendEvent({ ...state, providerCallbackDeliveries: result.registry }, { type: `integration.callback_delivery.${result.delivery.status}`, deliveryId, provider: result.delivery.provider, eventId: result.delivery.eventId, actor: body.workerId ?? body.approvedBy })); sendJson(res, 200, { delivery: result.delivery, idempotent: result.idempotent ?? false }); }
    catch (error) { sendJson(res, 422, { error: { code: error.code ?? "callback_delivery_action_invalid", message: error.message } }); } return true;
  }

  return false;
}
