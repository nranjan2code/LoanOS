import {
  buildSignedFileManifest,
  createSignedFileCorrection,
  recordSignedFileAcknowledgement,
  registerSignedFileSchemaProfile,
  createTransportRecord,
  createTransportResubmission,
  markTransportDispatched,
  recordTransportPoll
} from "@loanos/core";

export async function routeSignedFiles(context) {
  const { method, path, req, res, tenant, store, readJson, sendJson, appendEvent } = context;

  if (method === "POST" && path === "/integrations/signed-files/schema-profiles") {
    const body = await readJson(req); const state = await store.load(); try { const result = registerSignedFileSchemaProfile(state.signedFileSchemaProfiles, { ...body, tenantId: tenant.tenantId }); await store.save(appendEvent({ ...state, signedFileSchemaProfiles: result.registry }, { type: "integration.signed_file.profile_registered", profileId: result.profile.profileId, system: result.profile.system, actor: body.approvedBy })); sendJson(res, 201, { profile: result.profile }); } catch (error) { sendJson(res, 422, { error: { code: error.code ?? "signed_file_profile_invalid", message: error.message } }); } return true;
  }
  if (method === "POST" && path === "/integrations/signed-files/envelopes") {
    const body = await readJson(req); const state = await store.load(); try { const result = buildSignedFileManifest(state.signedFileEnvelopes, state.signedFileSchemaProfiles, { ...body, tenantId: tenant.tenantId }); if (!result.idempotent) await store.save(appendEvent({ ...state, signedFileEnvelopes: result.envelopes }, { type: "integration.signed_file.envelope_ready", envelopeId: result.envelope.envelopeId, system: result.envelope.system, actor: body.approvedBy })); sendJson(res, result.idempotent ? 200 : 201, { envelope: result.envelope, idempotent: result.idempotent }); } catch (error) { sendJson(res, 422, { error: { code: error.code ?? "signed_file_envelope_invalid", message: error.message } }); } return true;
  }
  const signedEnvelopeAction = path.match(/^\/integrations\/signed-files\/envelopes\/([^/]+)\/(acknowledgements|corrections)$/);
  if (method === "POST" && signedEnvelopeAction) {
    const body = await readJson(req); const state = await store.load(); const envelopeId = decodeURIComponent(signedEnvelopeAction[1]); try { const result = signedEnvelopeAction[2] === "acknowledgements" ? recordSignedFileAcknowledgement(state.signedFileEnvelopes, { ...body, tenantId: tenant.tenantId, envelopeId }) : createSignedFileCorrection(state.signedFileEnvelopes, { ...body, tenantId: tenant.tenantId, parentEnvelopeId: envelopeId }); if (!result.idempotent) await store.save(appendEvent({ ...state, signedFileEnvelopes: result.envelopes }, { type: `integration.signed_file.${result.envelope.status}`, envelopeId, system: result.envelope.system, actor: body.approvedBy })); sendJson(res, 200, { envelope: result.envelope, acknowledgement: result.envelope.acknowledgement, correction: result.correction ?? null, idempotent: result.idempotent ?? false }); } catch (error) { sendJson(res, 422, { error: { code: error.code ?? "signed_file_action_invalid", message: error.message } }); } return true;
  }
  if (method === "POST" && path === "/integrations/signed-files/transports") {
    const body = await readJson(req); const state = await store.load(); const envelope = state.signedFileEnvelopes?.[`${tenant.tenantId}:${body.envelopeId}`]; try { const result = createTransportRecord(state.signedFileTransports, envelope, body.file, { ...body, tenantId: tenant.tenantId }); if (!result.idempotent) await store.save(appendEvent({ ...state, signedFileTransports: result.registry }, { type: "integration.signed_file.transport_prepared", transportId: result.transport.transportId, envelopeId: result.transport.envelopeId, actor: body.actor ?? "integration_worker" })); sendJson(res, result.idempotent ? 200 : 201, { transport: result.transport, idempotent: result.idempotent }); } catch (error) { sendJson(res, 422, { error: { code: error.code ?? "signed_file_transport_invalid", message: error.message } }); } return true;
  }
  const signedTransportAction = path.match(/^\/integrations\/signed-files\/transports\/([^/]+)\/(dispatch|polls|resubmissions)$/);
  if (method === "POST" && signedTransportAction) {
    const body = await readJson(req); const state = await store.load(); const transportId = decodeURIComponent(signedTransportAction[1]); try { const result = signedTransportAction[2] === "dispatch" ? markTransportDispatched(state.signedFileTransports, { ...body, tenantId: tenant.tenantId, transportId }) : signedTransportAction[2] === "polls" ? recordTransportPoll(state.signedFileTransports, { ...body, tenantId: tenant.tenantId, transportId }) : createTransportResubmission(state.signedFileTransports, { ...body, tenantId: tenant.tenantId, parentTransportId: transportId }); if (!result.idempotent) await store.save(appendEvent({ ...state, signedFileTransports: result.registry }, { type: `integration.signed_file.transport_${result.transport.status}`, transportId: result.transport.transportId, envelopeId: result.transport.envelopeId, actor: body.actor ?? "integration_worker" })); sendJson(res, 200, { transport: result.transport, idempotent: result.idempotent ?? false }); } catch (error) { sendJson(res, 422, { error: { code: error.code ?? "signed_file_transport_action_invalid", message: error.message } }); } return true;
  }

  return false;
}
