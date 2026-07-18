import { ExternalServiceManager, certifyProvider, suspendProviderCertification } from "@loanos/core";

// Provider operational controls are isolated from the large resource router so
// readiness and callback security can evolve without coupling to loan flows.
export async function routeIntegrationControls(context) {
  const { method, path, req, res, tenant, store, readJson, sendJson, appendEvent, acknowledgeCersaiSubmission, acknowledgeFiuReport, acknowledgeCicBatch, recordCkycrrResponse } = context;
  if (method === "GET" && path === "/integrations/readiness") {
    const state = await store.load();
    const integrations = new ExternalServiceManager({ isSandbox: tenant.isSandbox, providerCertifications: state.providerCertifications }).integrationReadiness();
    sendJson(res, 200, { integrations, readyCount: integrations.filter((item) => item.status === "ready").length, mockCount: integrations.filter((item) => item.status === "mock").length, blockedCount: integrations.filter((item) => item.status === "blocked").length });
    return true;
  }
  if (method === "GET" && path === "/integrations/certifications") {
    const state = await store.load();
    sendJson(res, 200, { certifications: Object.values(state.providerCertifications ?? {}) });
    return true;
  }
  if (method === "POST" && path === "/integrations/certifications") {
    const body = await readJson(req); const state = await store.load();
    const result = certifyProvider(state.providerCertifications, body);
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "provider_certification_blocked", message: "Provider certification failed closed." }, findings: result.findings }); return true; }
    await store.save(appendEvent({ ...state, providerCertifications: result.registry }, { type: "integration.provider_certified", integration: result.certification.integration, providerName: result.certification.providerName, certificationRef: result.certification.certificationRef, expiresAt: result.certification.expiresAt, actor: result.certification.approvedBy }));
    sendJson(res, 201, result.certification); return true;
  }
  const suspensionMatch = path.match(/^\/integrations\/certifications\/([a-z_]{2,40})\/suspension$/);
  if (method === "POST" && suspensionMatch) {
    const body = await readJson(req); const state = await store.load(); const integration = suspensionMatch[1];
    const result = suspendProviderCertification(state.providerCertifications, integration, body);
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "provider_certification_suspension_blocked", message: "Provider certification suspension failed closed." }, findings: result.findings }); return true; }
    await store.save(appendEvent({ ...state, providerCertifications: result.registry }, { type: "integration.provider_certification_suspended", integration, reason: result.certification.suspensionReason, actor: result.certification.suspensionApprovedBy }));
    sendJson(res, 200, result.certification); return true;
  }
  const match = path.match(/^\/integrations\/([a-z_]{2,40})\/callbacks$/);
  if (method !== "POST" || !match) return false;
  const body = await readJson(req); const provider = match[1]; const header = req.headers["x-provider-signature"];
  if (!new Set(["cersai", "fiu", "cic", "ckycrr"]).has(provider)) {
    sendJson(res, 404, { error: { code: "provider_callback_unsupported", message: "This provider does not use the governed callback route." } });
    return true;
  }
  try {
    const state = await store.load();
    const verified = new ExternalServiceManager({ isSandbox: tenant.isSandbox, providerCertifications: state.providerCertifications }).verifyProviderCallback(provider, body.eventId, body.payload, Array.isArray(header) ? header[0] : header);
    const existing = state.providerCallbacks?.[`${provider}:${body.eventId}`];
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
    } else if (provider === "cic") {
      const result = acknowledgeCicBatch(state.cicSubmissionBatches, body.payload?.batchId, { ...body.payload, receivedBy: "provider_callback" }, now);
      if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "provider_callback_reconciliation_blocked", message: "CIC callback does not satisfy reporting acknowledgement controls." }, findings: result.findings }); return true; }
      reconciled = { resourceType: "cic_batch", resourceId: result.batch.batchId, outcome: result.batch.status }; nextState = { ...nextState, cicSubmissionBatches: result.registry };
    } else if (provider === "ckycrr") {
      const result = recordCkycrrResponse(state.ckycrrSubmissions, body.payload?.submissionId, { ...body.payload, receivedBy: "provider_callback" }, now);
      if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "provider_callback_reconciliation_blocked", message: "CKYCRR callback does not satisfy response controls." }, findings: result.findings }); return true; }
      reconciled = { resourceType: "ckycrr_submission", resourceId: result.submission.submissionId, outcome: result.submission.status }; nextState = { ...nextState, ckycrrSubmissions: result.registry };
    }
    const callback = { callbackId: `${provider}:${body.eventId}`, provider, eventId: body.eventId, payloadHash: verified.payloadHash, receivedAt: now.toISOString(), receivedBy: "provider_callback", reconciled };
    await store.save(appendEvent({ ...nextState, providerCallbacks: { ...(nextState.providerCallbacks ?? {}), [callback.callbackId]: callback } }, { type: "integration.provider_callback.accepted", provider, eventId: body.eventId, payloadHash: callback.payloadHash, reconciled }));
    sendJson(res, 202, { callback, idempotent: false });
  } catch (error) { sendJson(res, 401, { error: { code: "provider_callback_rejected", message: error.message } }); }
  return true;
}
