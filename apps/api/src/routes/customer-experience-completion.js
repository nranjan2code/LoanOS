import {
  certifyFieldDevice,
  enqueueEncryptedOfflineWork,
  reconcileEncryptedOfflineWork
} from "../../../../packages/core/src/customer-experience-completion.js";

export async function routeCustomerExperienceCompletion(context) {
  const { method, path, req, res, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;

  if (!path.startsWith("/experience/")) return false;

  // Enforce tenant roles (tenant_admin or operator can post sync items)
  const allowed = method === "GET" ? ["tenant_admin", "security_admin", "auditor", "operator"] : ["tenant_admin", "security_admin", "operator"];
  if (!hasTenantAdminRole(authContext, allowed)) {
    sendJson(res, 403, { error: { code: "experience_forbidden", message: "Mobile field operations access is forbidden." } });
    return true;
  }

  const state = await store.load();
  const tenantId = authContext.tenantId;

  if (method === "GET" && path === "/experience/assignments") {
    // Return mock assignment projection for field agents
    const mockAssignments = [
      {
        id: "coll-1",
        tenantId,
        type: "collection",
        title: "Borrower: Amit Patel",
        subtitle: "Overdue EMI: ₹14,500.00",
        status: "pending",
        baseVersion: "3",
        payloadJson: JSON.stringify({ loanId: "L-88271", duePaise: "1450000" }),
        scheduledAt: new Date().toISOString()
      },
      {
        id: "coll-2",
        tenantId,
        type: "collection",
        title: "Borrower: Priya Nair",
        subtitle: "Overdue EMI: ₹22,100.00",
        status: "pending",
        baseVersion: "2",
        payloadJson: JSON.stringify({ loanId: "L-99120", duePaise: "2210000" }),
        scheduledAt: new Date(Date.now() - 3600000).toISOString()
      }
    ];
    sendJson(res, 200, mockAssignments);
    return true;
  }

  if (method !== "POST") return false;
  const body = await readJson(req);
  const actor = authActor(authContext);

  try {
    let nextState = state;
    let record;
    let event;

    if (path === "/experience/devices/certify") {
      const existing = Object.values(state.certifiedFieldDevices ?? {});
      record = certifyFieldDevice({ ...body, tenantId }, existing, new Date());
      nextState = {
        ...state,
        certifiedFieldDevices: {
          ...(state.certifiedFieldDevices ?? {}),
          [record.deviceId]: record
        }
      };
      event = "experience.device.certified";
    } 
    else if (path === "/experience/offline-work/enqueue") {
      const device = state.certifiedFieldDevices?.[body.deviceId];
      if (!device) {
        sendJson(res, 422, { error: { code: "device_not_certified", message: "Certified device not found." } });
        return true;
      }
      const existingEnvelopes = Object.values(state.encryptedOfflineWork ?? {}).filter(item => item.status === "queued");
      record = enqueueEncryptedOfflineWork(device, { ...body, tenantId, createdBy: actor }, existingEnvelopes, new Date());
      nextState = {
        ...state,
        encryptedOfflineWork: {
          ...(state.encryptedOfflineWork ?? {}),
          [record.envelopeId]: record
        }
      };
      event = "experience.offline_work.queued";
    } 
    else if (path === "/experience/offline-work/reconcile") {
      const envelope = state.encryptedOfflineWork?.[body.envelopeId];
      if (!envelope) {
        sendJson(res, 422, { error: { code: "offline_envelope_missing", message: "Queued offline envelope not found." } });
        return true;
      }
      const processed = Object.values(state.encryptedOfflineWork ?? {}).filter(item => item.status === "applied" || item.status === "conflict");
      record = reconcileEncryptedOfflineWork(envelope, { ...body, tenantId, reconciledBy: actor }, processed, new Date());
      
      nextState = {
        ...state,
        encryptedOfflineWork: {
          ...(state.encryptedOfflineWork ?? {}),
          [envelope.envelopeId]: record
        }
      };
      event = `experience.offline_work.${record.status}`;
    } 
    else {
      return false;
    }

    const resourceId = record.deviceId ?? record.envelopeId;
    await store.save(appendEvent(nextState, { type: event, resourceId, actor, status: record.status }));
    sendJson(res, 201, record);
    return true;
  } catch (cause) {
    sendJson(res, cause.code?.includes("duplicate") || cause.code?.includes("replay") ? 409 : 422, {
      error: { code: cause.code ?? "experience_invalid", message: cause.message }
    });
    return true;
  }
}
