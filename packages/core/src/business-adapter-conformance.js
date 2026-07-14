import { createHash } from "node:crypto";

export const BUSINESS_ADAPTER_DEFINITIONS = Object.freeze({
  fraud_intelligence: { operations: ["screen", "enrich", "feedback"], events: ["result", "correction"] },
  sanctions_pep: { operations: ["screen", "rescreen", "sync_delta"], events: ["match", "list_version", "correction"] },
  valuation: { operations: ["sync_panel", "create_order", "cancel_order", "fetch_report"], events: ["accepted", "inspection", "report", "revision"] },
  legal_title: { operations: ["sync_panel", "create_order", "upload_pack", "fetch_opinion"], events: ["accepted", "information_required", "opinion", "revision"] },
  insurance: { operations: ["quote", "bind", "endorse", "renew", "cancel", "claim"], events: ["policy", "lapse", "renewal", "claim", "correction"] },
  custody: { operations: ["intake", "move", "inventory", "hold", "release"], events: ["accepted", "movement", "count", "release"] },
  dialer_ivr: { operations: ["create_campaign", "reserve_contact", "call", "fetch_recording"], events: ["answered", "disposition", "recording", "opt_out"] },
  field_collections: { operations: ["assign", "route", "check_in", "submit_visit", "sync_offline"], events: ["accepted", "visit", "receipt", "conflict"] },
  courts: { operations: ["create_case", "upload_filing", "search", "fetch_order"], events: ["filing", "hearing", "order", "correction"] },
  auction: { operations: ["publish", "register_bidder", "record_deposit", "bid", "close"], events: ["published", "bid", "winner", "payment", "default"] },
  hrms: { operations: ["sync_worker", "sync_position", "sync_leave", "sync_delegation"], events: ["joiner", "mover", "leaver", "correction"] },
  crm: { operations: ["upsert_party", "upsert_lead", "upsert_activity", "upsert_case", "merge"], events: ["party", "lead", "activity", "case", "merge"] },
  dms: { operations: ["upload", "download", "version", "hold", "delete"], events: ["stored", "version", "hold", "deletion"] }
});

export const BUSINESS_ADAPTER_FAMILIES = Object.freeze(Object.keys(BUSINESS_ADAPTER_DEFINITIONS));
export const BUSINESS_ADAPTER_SCENARIO_CLASSES = Object.freeze(["success", "validation_reject", "business_reject", "delayed", "timeout", "duplicate", "correction", "tamper", "outage"]);

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const required = (value, field) => { if (typeof value !== "string" || !value.trim()) fail("business_adapter_invalid", `${field} is required.`); return value.trim(); };
const sha = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const fourEyes = (input) => { required(input.proposedBy, "proposedBy"); required(input.approvedBy, "approvedBy"); required(input.approvalRef, "approvalRef"); if (input.proposedBy === input.approvedBy) fail("business_adapter_four_eyes", "Independent approval is required."); };
const tenantRecords = (registry, tenantId) => Object.values(registry ?? {}).filter((item) => item.tenantId === tenantId);

export function buildBusinessAdapterConformancePack(family) {
  const definition = BUSINESS_ADAPTER_DEFINITIONS[family]; if (!definition) fail("business_adapter_family_invalid", "Unsupported business adapter family.");
  return BUSINESS_ADAPTER_SCENARIO_CLASSES.map((scenarioClass) => ({ scenarioId: `${family}.${scenarioClass}`, family, scenarioClass, terminalStatus: scenarioClass === "success" ? "completed" : scenarioClass === "correction" ? "corrected" : scenarioClass === "duplicate" ? "completed" : ["delayed", "timeout", "outage"].includes(scenarioClass) ? "pending" : "rejected", asynchronous: ["delayed", "duplicate", "correction", "tamper"].includes(scenarioClass) }));
}

export function assessBusinessAdapterConformancePack(family, pack = buildBusinessAdapterConformancePack(family)) {
  if (!BUSINESS_ADAPTER_DEFINITIONS[family]) fail("business_adapter_family_invalid", "Unsupported business adapter family.");
  const ids = new Set(); const classes = new Set(); const findings = [];
  for (const scenario of Array.isArray(pack) ? pack : []) { if (!scenario?.scenarioId || scenario.family !== family || !BUSINESS_ADAPTER_SCENARIO_CLASSES.includes(scenario.scenarioClass)) findings.push({ code: "invalid_scenario", scenarioId: scenario?.scenarioId ?? null }); else { if (ids.has(scenario.scenarioId)) findings.push({ code: "duplicate_scenario", scenarioId: scenario.scenarioId }); ids.add(scenario.scenarioId); classes.add(scenario.scenarioClass); } }
  for (const scenarioClass of BUSINESS_ADAPTER_SCENARIO_CLASSES) if (!classes.has(scenarioClass)) findings.push({ code: "missing_scenario_class", scenarioClass });
  return { family, status: findings.length ? "blocked" : "complete", scenarioCount: pack?.length ?? 0, checksumSha256: sha([...(pack ?? [])].sort((a, b) => String(a.scenarioId).localeCompare(String(b.scenarioId)))), findings };
}

export function assessBusinessAdapterSuite() {
  const assessments = BUSINESS_ADAPTER_FAMILIES.map((family) => assessBusinessAdapterConformancePack(family));
  return { status: assessments.every((item) => item.status === "complete") ? "complete" : "blocked", familyCount: assessments.length, scenarioCount: assessments.reduce((sum, item) => sum + item.scenarioCount, 0), assessments };
}

export function registerBusinessAdapter(registry = {}, input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId"); const adapterId = required(input.adapterId, "adapterId"); const family = required(input.family, "family"); if (!BUSINESS_ADAPTER_DEFINITIONS[family]) fail("business_adapter_family_invalid", "Unsupported business adapter family."); fourEyes(input);
  if (input.dataResidencyCountry !== "IN") fail("business_adapter_residency_invalid", "Business adapter processing and storage must be India-resident.");
  for (const field of ["contractRef", "certificationRef", "endpointRef", "credentialRef", "callbackSecretRef", "reconciliationProfileRef", "exitPlanRef"]) required(input[field], field);
  const expiresAt = new Date(input.certificationExpiresAt); if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) fail("business_adapter_certification_invalid", "A future certification expiry is required.");
  const key = `${tenantId}:${adapterId}`; if (registry[key]) fail("business_adapter_duplicate", "Adapter is already registered in this tenant.");
  const conformance = assessBusinessAdapterConformancePack(family, input.conformancePack); if (conformance.status !== "complete") fail("business_adapter_conformance_incomplete", "Complete adverse conformance is required.");
  const adapter = { tenantId, adapterId, family, provider: required(input.provider, "provider"), mode: input.mode ?? "mock", dataResidencyCountry: "IN", contractRef: input.contractRef, certificationRef: input.certificationRef, certificationExpiresAt: expiresAt.toISOString(), endpointRef: input.endpointRef, credentialRef: input.credentialRef, callbackSecretRef: input.callbackSecretRef, reconciliationProfileRef: input.reconciliationProfileRef, exitPlanRef: input.exitPlanRef, conformanceChecksumSha256: conformance.checksumSha256, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "active", registeredAt: now.toISOString() };
  return { registry: { ...registry, [key]: adapter }, adapter };
}

export function createBusinessAdapterRequest(requests = {}, adapters = {}, input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId"); const requestId = required(input.requestId, "requestId"); const idempotencyKey = required(input.idempotencyKey, "idempotencyKey"); const adapter = adapters[`${tenantId}:${input.adapterId}`]; if (!adapter || adapter.status !== "active") fail("business_adapter_unavailable", "Active same-tenant adapter is required.");
  const operation = required(input.operation, "operation"); if (!BUSINESS_ADAPTER_DEFINITIONS[adapter.family].operations.includes(operation)) fail("business_adapter_operation_invalid", "Operation is not supported by this adapter family.");
  required(input.payloadChecksumSha256, "payloadChecksumSha256"); if (!/^[a-f0-9]{64}$/.test(input.payloadChecksumSha256)) fail("business_adapter_checksum_invalid", "Payload checksum must be SHA-256."); required(input.purposeRef, "purposeRef");
  const immutable = { tenantId, requestId, adapterId: adapter.adapterId, family: adapter.family, operation, idempotencyKey, payloadChecksumSha256: input.payloadChecksumSha256, purposeRef: input.purposeRef, consentRef: input.consentRef ?? null, subjectRef: input.subjectRef ?? null };
  const requestChecksumSha256 = sha(immutable); const duplicate = tenantRecords(requests, tenantId).find((item) => item.requestId === requestId || item.idempotencyKey === idempotencyKey);
  if (duplicate) { if (duplicate.requestChecksumSha256 !== requestChecksumSha256) fail("business_adapter_idempotency_conflict", "Request identity was reused with different content."); return { requests, request: duplicate, idempotent: true }; }
  const request = { ...immutable, requestChecksumSha256, status: "submitted", providerReference: null, events: [], submittedAt: now.toISOString(), updatedAt: now.toISOString() };
  return { requests: { ...requests, [`${tenantId}:${requestId}`]: request }, request, idempotent: false };
}

export function recordBusinessAdapterEvent(requests = {}, input = {}, now = new Date()) {
  const tenantId = required(input.tenantId, "tenantId"); const request = requests[`${tenantId}:${input.requestId}`]; if (!request) fail("business_adapter_request_missing", "Request does not exist in this tenant."); const eventId = required(input.eventId, "eventId"); const eventType = required(input.eventType, "eventType");
  if (!BUSINESS_ADAPTER_DEFINITIONS[request.family].events.includes(eventType)) fail("business_adapter_event_invalid", "Event is not supported by this adapter family.");
  const status = required(input.status, "status"); if (!new Set(["accepted", "pending", "completed", "rejected", "corrected"]).has(status)) fail("business_adapter_status_invalid", "Invalid provider event status.");
  for (const field of ["providerReference", "payloadChecksumSha256", "signatureEvidenceRef"]) required(input[field], field); if (!/^[a-f0-9]{64}$/.test(input.payloadChecksumSha256)) fail("business_adapter_checksum_invalid", "Event payload checksum must be SHA-256.");
  if (status === "rejected" && !input.reasonCode) fail("business_adapter_reject_reason_required", "Rejected event requires a reason code.");
  const event = { eventId, eventType, status, providerReference: input.providerReference, payloadChecksumSha256: input.payloadChecksumSha256, signatureEvidenceRef: input.signatureEvidenceRef, reasonCode: input.reasonCode ?? null, correctionOfEventId: input.correctionOfEventId ?? null, occurredAt: new Date(input.occurredAt ?? now).toISOString(), receivedAt: now.toISOString() };
  const eventChecksumSha256 = sha({ ...event, receivedAt: undefined }); const previous = request.events.find((item) => item.eventId === eventId);
  if (previous) { if (previous.eventChecksumSha256 !== eventChecksumSha256) fail("business_adapter_event_replay_conflict", "Provider event was replayed with different content."); return { requests, request, event: previous, idempotent: true }; }
  if (status === "corrected" && (!input.correctionOfEventId || !request.events.some((item) => item.eventId === input.correctionOfEventId))) fail("business_adapter_correction_invalid", "Correction must reference a prior event.");
  const storedEvent = { ...event, eventChecksumSha256 }; const updated = { ...request, status, providerReference: input.providerReference, events: [...request.events, storedEvent], updatedAt: now.toISOString() };
  return { requests: { ...requests, [`${tenantId}:${request.requestId}`]: updated }, request: updated, event: storedEvent, idempotent: false };
}

export function projectBusinessAdapterReconciliation(requests = {}, input = {}) {
  const tenantId = required(input.tenantId, "tenantId"); const records = tenantRecords(requests, tenantId); const counts = Object.fromEntries(["submitted", "accepted", "pending", "completed", "rejected", "corrected"].map((status) => [status, records.filter((item) => item.status === status).length])); const unresolvedRequestIds = records.filter((item) => ["submitted", "accepted", "pending"].includes(item.status)).map((item) => item.requestId).sort();
  return { tenantId, total: records.length, counts, unresolvedRequestIds, status: unresolvedRequestIds.length ? "exceptions" : "reconciled", projectionChecksumSha256: sha({ counts, unresolvedRequestIds }) };
}
