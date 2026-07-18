import {
  projectBusinessAdapterReconciliation,
  registerBusinessAdapter,
  createBusinessAdapterRequest,
  recordBusinessAdapterEvent
} from "@loanos/core";

export async function routeBusinessAdapters(context) {
  const { method, path, req, res, tenant, store, readJson, sendJson, appendEvent } = context;

  if (method === "GET" && path === "/integrations/business-adapters/reconciliation") { const state = await store.load(); sendJson(res, 200, projectBusinessAdapterReconciliation(state.businessAdapterRequests, { tenantId: tenant.tenantId })); return true; }
  if (method === "POST" && path === "/integrations/business-adapters") {
    const body = await readJson(req); const state = await store.load(); try { const result = registerBusinessAdapter(state.businessAdapters, { ...body, tenantId: tenant.tenantId }); await store.save(appendEvent({ ...state, businessAdapters: result.registry }, { type: "integration.business_adapter.registered", adapterId: result.adapter.adapterId, family: result.adapter.family, actor: body.approvedBy })); sendJson(res, 201, { adapter: result.adapter }); } catch (error) { sendJson(res, 422, { error: { code: error.code ?? "business_adapter_invalid", message: error.message } }); } return true;
  }
  if (method === "POST" && path === "/integrations/business-adapter-requests") {
    const body = await readJson(req); const state = await store.load(); try { const result = createBusinessAdapterRequest(state.businessAdapterRequests, state.businessAdapters, { ...body, tenantId: tenant.tenantId }); if (!result.idempotent) await store.save(appendEvent({ ...state, businessAdapterRequests: result.requests }, { type: "integration.business_adapter.requested", requestId: result.request.requestId, adapterId: result.request.adapterId, family: result.request.family, actor: body.actor ?? "integration_worker" })); sendJson(res, result.idempotent ? 200 : 201, { request: result.request, idempotent: result.idempotent }); } catch (error) { sendJson(res, 422, { error: { code: error.code ?? "business_adapter_request_invalid", message: error.message } }); } return true;
  }
  const businessAdapterEvent = path.match(/^\/integrations\/business-adapter-requests\/([^/]+)\/events$/);
  if (method === "POST" && businessAdapterEvent) {
    const body = await readJson(req); const state = await store.load(); const requestId = decodeURIComponent(businessAdapterEvent[1]); try { const result = recordBusinessAdapterEvent(state.businessAdapterRequests, { ...body, tenantId: tenant.tenantId, requestId }); if (!result.idempotent) await store.save(appendEvent({ ...state, businessAdapterRequests: result.requests }, { type: `integration.business_adapter.${result.request.status}`, requestId, adapterId: result.request.adapterId, family: result.request.family, actor: "provider_callback" })); sendJson(res, 200, { request: result.request, event: result.event, idempotent: result.idempotent }); } catch (error) { sendJson(res, 422, { error: { code: error.code ?? "business_adapter_event_invalid", message: error.message } }); } return true;
  }

  return false;
}
