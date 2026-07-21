import {
  captureMeterEvents,
  projectMeterLedger,
  projectMeterReconciliations,
  reconcileProviderUsage,
  replayMeterEventsFromLifecycles
} from "@loanos/core";

// Tenant usage meter (INT-ADM-08 / INT-PLT-12), step 1: emission and persistence
// only — no rating, no pricing, no invoicing. Authentication, tenant resolution,
// mutation staffing and central request/audit attribution run before this
// boundary in server.js; this router owns only the tenant-partitioned resource.
//
// Two deliberate asymmetries live here, both from ADR 0009:
//   - POST /usage-meter/events accepts a batch and returns 207-style partial
//     results rather than failing the batch. Adapters call it on a lending hot
//     path; one malformed line must not discard the rest, and must never
//     surface to the caller as a reason to abandon the underlying work.
//   - Every other endpoint is an ordinary read or an operator action and fails
//     closed in the usual way (422/403).
const PREFIX = "/usage-meter";
const READ_ROLES = ["tenant_admin", "operator", "auditor", "security_admin"];
const WRITE_ROLES = ["tenant_admin", "operator", "security_admin"];
const RECONCILE_ROLES = ["tenant_admin", "security_admin"];

export async function routeUsageMetering(context) {
  const { method, path, url, req, res, tenant, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;

  const roles = method === "GET" ? READ_ROLES : path === `${PREFIX}/reconciliations` ? RECONCILE_ROLES : WRITE_ROLES;
  if (authContext?.principalType !== "tenant_user" || !hasTenantAdminRole(authContext, roles)) {
    sendJson(res, 403, {
      error: { code: "usage_meter_forbidden", message: "A same-tenant authorised operator is required." }
    });
    return true;
  }

  const actor = authActor(authContext);
  try {
    const state = await store.load();

    if (method === "GET" && path === PREFIX) {
      sendJson(res, 200, {
        ledger: projectMeterLedger(state, {
          tenantId: tenant.tenantId,
          eventType: url.searchParams.get("eventType") ?? undefined,
          providerKey: url.searchParams.get("providerKey") ?? undefined,
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined
        })
      });
      return true;
    }

    if (method === "GET" && path === `${PREFIX}/reconciliations`) {
      sendJson(res, 200, { reconciliations: projectMeterReconciliations(state, { tenantId: tenant.tenantId }) });
      return true;
    }

    if (method !== "POST") return false;
    const body = await readJson(req);

    // Batch emission from provider adapters, collections and periodic snapshots.
    // Partial acceptance is the contract: `rejected` is a work item for the
    // meter, never a failure the caller has to unwind.
    if (path === `${PREFIX}/events`) {
      const inputs = (Array.isArray(body?.events) ? body.events : []).map((event) => ({
        ...event,
        tenantId: tenant.tenantId,
        actor: event?.actor ?? actor
      }));
      const result = captureMeterEvents(state, inputs, new Date());
      await store.save(appendEvent(result.state, {
        type: "usage_meter.events_captured",
        actor,
        acceptedCount: result.accepted.length,
        rejectedCount: result.rejected.length,
        idempotentCount: result.idempotentCount
      }));
      sendJson(res, result.rejected.length ? 207 : 201, {
        accepted: result.accepted,
        rejected: result.rejected,
        idempotentCount: result.idempotentCount
      });
      return true;
    }

    // The ADR 0009 degradation path: rebuild anything the live meter missed
    // from the lifecycle's own transition history.
    if (path === `${PREFIX}/replay`) {
      const result = replayMeterEventsFromLifecycles(state, { tenantId: tenant.tenantId }, new Date());
      await store.save(appendEvent(result.state, {
        type: "usage_meter.replayed",
        actor,
        recoveredCount: result.recovered.length,
        alreadyPresent: result.alreadyPresent,
        scannedTransitions: result.scannedTransitions
      }));
      sendJson(res, 200, {
        recovered: result.recovered,
        alreadyPresent: result.alreadyPresent,
        scannedTransitions: result.scannedTransitions,
        rejected: result.rejected
      });
      return true;
    }

    if (path === `${PREFIX}/reconciliations`) {
      const result = reconcileProviderUsage(state, { ...body, tenantId: tenant.tenantId, openedBy: actor }, new Date());
      await store.save(appendEvent(result.state, {
        type: "usage_meter.provider_reconciled",
        actor,
        reconciliationId: result.reconciliation.reconciliationId,
        providerKey: result.reconciliation.providerKey,
        status: result.reconciliation.status,
        varianceBasisPoints: result.reconciliation.varianceBasisPoints,
        evidenceChecksumSha256: result.reconciliation.evidenceChecksumSha256
      }));
      sendJson(res, 201, { reconciliation: result.reconciliation });
      return true;
    }

    return false;
  } catch (cause) {
    sendJson(res, errorStatus(cause), {
      error: { code: cause.code ?? "usage_meter_invalid", message: cause.message }
    });
    return true;
  }
}

function errorStatus(cause) {
  if (cause.statusCode) return cause.statusCode;
  const code = cause.code ?? "";
  if (code.includes("forbidden")) return 403;
  if (code.includes("not_found") || code.includes("missing")) return 404;
  if (code.includes("exists") || code.includes("conflict")) return 409;
  return 422;
}
