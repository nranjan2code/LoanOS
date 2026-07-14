import { ExternalServiceManager } from "../../../../packages/core/src/index.js";

// Provider operational controls are isolated from the large resource router so
// readiness and callback security can evolve without coupling to loan flows.
export async function routeIntegrationControls(context) {
  const { method, path, req, res, tenant, store, readJson, sendJson, appendEvent, acknowledgeCersaiSubmission, acknowledgeFiuReport } = context;
  if (method === "GET" && path === "/integrations/readiness") {
    const integrations = new ExternalServiceManager({ isSandbox: tenant.isSandbox }).integrationReadiness();
    sendJson(res, 200, { integrations, readyCount: integrations.filter((item) => item.status === "ready").length, mockCount: integrations.filter((item) => item.status === "mock").length, blockedCount: integrations.filter((item) => item.status === "blocked").length });
    return true;
  }
  const match = path.match(/^\/integrations\/([a-z_]{2,40})\/callbacks$/);
  if (method !== "POST" || !match) return false;
  const body = await readJson(req); const provider = match[1]; const header = req.headers["x-provider-signature"];
  try {
    const verified = new ExternalServiceManager({ isSandbox: tenant.isSandbox }).verifyProviderCallback(provider, body.eventId, body.payload, Array.isArray(header) ? header[0] : header);
    const state = await store.load(); const existing = state.providerCallbacks?.[`${provider}:${body.eventId}`];
    if (existing) { sendJson(res, 200, { callback: existing, idempotent: true }); return true; }
    const now = new Date(); let reconciled = null; let nextState = state;
    if (provider === "cersai") {
      const result = acknowledgeCersaiSubmission(state.securityInterests?.[body.payload?.securityInterestId], body.payload, now);
      if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "provider_callback_reconciliation_blocked", message: "CERSAI callback does not satisfy security-interest acknowledgement controls." }, findings: result.findings }); return true; }
      reconciled = { resourceType: "security_interest", resourceId: result.securityInterest.securityInterestId, outcome: result.securityInterest.status }; nextState = { ...nextState, securityInterests: { ...nextState.securityInterests, [result.securityInterest.securityInterestId]: result.securityInterest } };
    } else if (provider === "fiu") {
      const result = acknowledgeFiuReport(state.fiuReports?.[body.payload?.reportId], body.payload, now);
      if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "provider_callback_reconciliation_blocked", message: "FIU callback does not satisfy report acknowledgement controls." }, findings: result.findings }); return true; }
      reconciled = { resourceType: "fiu_report", resourceId: result.report.reportId, outcome: result.report.status }; nextState = { ...nextState, fiuReports: { ...nextState.fiuReports, [result.report.reportId]: result.report } };
    }
    const callback = { callbackId: `${provider}:${body.eventId}`, provider, eventId: body.eventId, payloadHash: verified.payloadHash, receivedAt: now.toISOString(), receivedBy: "provider_callback", reconciled };
    await store.save(appendEvent({ ...nextState, providerCallbacks: { ...(nextState.providerCallbacks ?? {}), [callback.callbackId]: callback } }, { type: "integration.provider_callback.accepted", provider, eventId: body.eventId, payloadHash: callback.payloadHash, reconciled }));
    sendJson(res, 202, { callback, idempotent: false });
  } catch (error) { sendJson(res, 401, { error: { code: "provider_callback_rejected", message: error.message } }); }
  return true;
}
