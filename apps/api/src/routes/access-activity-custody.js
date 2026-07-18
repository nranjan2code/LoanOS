import { prepareAccessActivityExport, recordAccessActivityCustody, reconcileAccessActivityCustody } from "@loanos/core/identity/access-activity-custody.js";

export async function routeAccessActivityCustody(context) {
  const { method, path, req, res, tenant, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;
  if (path !== "/activity/exports" && !path.startsWith("/activity/exports/")) return false;
  if (authContext?.principalType !== "tenant_user" || !hasTenantAdminRole(authContext, ["tenant_admin", "security_admin", "auditor"])) {
    sendJson(res, 403, { error: { code: "activity_custody_forbidden", message: "Tenant security or audit authority is required." } }); return true;
  }
  if (method === "GET" && path === "/activity/exports") {
    const state = await store.load();
    try { sendJson(res, 200, { batches: Object.values(state.activityExportBatches ?? {}), reconciliation: reconcileAccessActivityCustody(state) }); }
    catch (error) { sendJson(res, 409, { error: { code: error.code ?? "activity_custody_invalid", message: error.message } }); }
    return true;
  }
  if (method === "POST" && path === "/activity/exports") {
    const body = await readJson(req); const state = await store.load(); const actor = authActor(authContext);
    try {
      const result = prepareAccessActivityExport(state, { ...body, tenantId: tenant.tenantId, createdBy: actor });
      await store.save(appendEvent(result.state, { type: "access.activity_export_prepared", exportId: result.batch.exportId, fromSequence: result.batch.fromSequence, throughSequence: result.batch.throughSequence, payloadChecksumSha256: result.batch.payloadChecksumSha256, actor }));
      sendJson(res, 201, { batch: result.batch, payload: result.payload });
    } catch (error) { sendJson(res, 422, { error: { code: error.code ?? "activity_export_invalid", message: error.message } }); }
    return true;
  }
  const custody = path.match(/^\/activity\/exports\/([^/]+)\/custody$/);
  if (method === "POST" && custody) {
    const body = await readJson(req); const state = await store.load(); const actor = authActor(authContext);
    if (body.approvedBy !== actor) { sendJson(res, 403, { error: { code: "activity_custody_actor_mismatch", message: "approvedBy must be the authenticated tenant actor." } }); return true; }
    try {
      const result = recordAccessActivityCustody(state, decodeURIComponent(custody[1]), body);
      await store.save(appendEvent(result.state, { type: "access.activity_export_custody_recorded", exportId: result.batch.exportId, custodyRef: result.batch.custody.custodyRef, providerRef: result.batch.custody.providerRef, actor }));
      sendJson(res, 200, { batch: result.batch, reconciliation: reconcileAccessActivityCustody(result.state) });
    } catch (error) { sendJson(res, 422, { error: { code: error.code ?? "activity_custody_invalid", message: error.message } }); }
    return true;
  }
  return false;
}
