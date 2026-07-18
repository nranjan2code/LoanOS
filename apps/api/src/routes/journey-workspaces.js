import {
  listJourneyWorkspaceDrafts,
  projectJourneyWorkspaceCatalogue,
  projectJourneyWorkspaceSchema,
  saveJourneyWorkspaceDraft
} from "@loanos/core";

const PREFIX = "/journey-workspaces";

export async function routeJourneyWorkspaces(context) {
  const { method, path, req, res, tenant, store, readJson, sendJson, appendEvent, authContext, authActor } = context;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  if (!["tenant_user", "borrower"].includes(authContext?.principalType)) {
    sendJson(res, 403, { error: { code: "journey_workspace_interactive_identity_required", message: "An authenticated interactive human session is required." } });
    return true;
  }
  const parts = path.slice(PREFIX.length).split("/").filter(Boolean).map(decodeURIComponent);
  const channel = parts[0];
  const input = { tenantId: tenant.tenantId, channel, principalType: authContext.principalType, roles: authContext.roles ?? [], actorId: authActor(authContext) };
  try {
    const state = await store.load();
    if (method === "GET" && parts.length === 2 && parts[1] === "catalogue") {
      sendJson(res, 200, { catalogue: projectJourneyWorkspaceCatalogue(state, input) });
      return true;
    }
    if (method === "GET" && parts.length === 3 && parts[1] === "schemas") {
      sendJson(res, 200, { schema: projectJourneyWorkspaceSchema(state, { ...input, journeyType: parts[2] }) });
      return true;
    }
    if (method === "GET" && parts.length === 2 && parts[1] === "drafts") {
      sendJson(res, 200, listJourneyWorkspaceDrafts(state, input));
      return true;
    }
    if (method === "POST" && parts.length === 3 && parts[1] === "drafts") {
      const body = await readJson(req);
      const result = saveJourneyWorkspaceDraft(state, { ...body, ...input, journeyType: parts[2] });
      await store.save(appendEvent(result.state, {
        type: result.draft.status === "submitted" ? "journey_workspace.draft_submitted" : "journey_workspace.draft_saved",
        actor: input.actorId,
        draftId: result.draft.draftId,
        journeyType: result.draft.journeyType,
        channel: result.draft.channel,
        schemaId: result.draft.schemaId,
        schemaVersion: result.draft.schemaVersion,
        schemaChecksumSha256: result.draft.schemaChecksumSha256,
        contentChecksumSha256: result.draft.contentChecksumSha256
      }));
      sendJson(res, result.idempotent ? 200 : 201, { draft: result.draft, idempotent: result.idempotent });
      return true;
    }
    return false;
  } catch (cause) {
    sendJson(res, cause.statusCode ?? (cause.code?.includes("forbidden") || cause.code?.includes("not_entitled") ? 403 : cause.code?.includes("not_found") ? 404 : 422), { error: { code: cause.code ?? "journey_workspace_invalid", message: cause.message } });
    return true;
  }
}
