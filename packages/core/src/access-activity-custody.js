import { createHash } from "node:crypto";

const MINIMUM_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export function prepareAccessActivityExport(state = {}, input = {}, now = new Date()) {
  const exportId = text(input.exportId, "exportId");
  const tenantId = text(input.tenantId, "tenantId");
  const createdBy = text(input.createdBy, "createdBy");
  if (state.activityExportBatches?.[exportId]) fail("activity_export_duplicate", "Activity export already exists.");
  const events = state.accessActivityEvents ?? [];
  verifyChain(events);
  const afterSequence = nonNegativeInteger(input.afterSequence ?? 0, "afterSequence");
  const throughSequence = input.throughSequence == null ? events.length : nonNegativeInteger(input.throughSequence, "throughSequence");
  if (throughSequence <= afterSequence || throughSequence > events.length) fail("activity_export_range_invalid", "Activity export range is empty or outside the verified chain.");
  const selected = events.slice(afterSequence, throughSequence);
  if (selected[0].sequence !== afterSequence + 1 || selected.at(-1).sequence !== throughSequence) fail("activity_export_gap", "Activity export sequence is not contiguous.");
  const retentionUntil = futureAtLeast(input.retentionUntil, now, MINIMUM_RETENTION_MS, "retentionUntil");
  const payload = { schema: "loanos.access-activity.v1", tenantId, fromSequence: selected[0].sequence, throughSequence, previousHash: selected[0].previousHash, headHash: selected.at(-1).checksumSha256, events: selected };
  const batch = {
    exportId, tenantId, schema: payload.schema, status: "prepared", fromSequence: payload.fromSequence, throughSequence,
    eventCount: selected.length, previousHash: payload.previousHash, headHash: payload.headHash,
    payloadChecksumSha256: hash(payload), retentionUntil, createdBy, createdAt: now.toISOString(), custody: null
  };
  return { state: { ...state, activityExportBatches: { ...(state.activityExportBatches ?? {}), [exportId]: batch } }, batch, payload };
}

export function recordAccessActivityCustody(state = {}, exportId, input = {}, now = new Date()) {
  const current = state.activityExportBatches?.[exportId];
  if (!current || current.status !== "prepared") fail("activity_export_not_prepared", "A prepared activity export is required.");
  const approvedBy = text(input.approvedBy, "approvedBy");
  if (approvedBy === current.createdBy) fail("activity_export_four_eyes_required", "Activity export custody requires an independent approver.");
  if (input.payloadChecksumSha256 !== current.payloadChecksumSha256) fail("activity_export_checksum_mismatch", "Provider custody does not match the prepared activity payload.");
  if (input.storageCountry !== "IN" || input.immutable !== true || input.worm !== true || input.objectLockMode !== "compliance") fail("activity_export_custody_invalid", "India-resident immutable WORM compliance-mode custody is required.");
  const providerRetentionUntil = futureAtLeast(input.providerRetentionUntil, now, MINIMUM_RETENTION_MS, "providerRetentionUntil");
  if (Date.parse(providerRetentionUntil) < Date.parse(current.retentionUntil)) fail("activity_export_retention_short", "Provider custody retention is shorter than the approved export retention.");
  for (const field of ["providerProfileId", "providerRef", "custodyRef", "trustedTimestampRef", "approvalRef"]) text(input[field], field);
  const custody = {
    providerProfileId: input.providerProfileId, providerRef: input.providerRef, custodyRef: input.custodyRef,
    storageCountry: "IN", immutable: true, worm: true, objectLockMode: "compliance", providerRetentionUntil,
    trustedTimestampRef: input.trustedTimestampRef, approvedBy, approvalRef: input.approvalRef, recordedAt: now.toISOString()
  };
  const batch = { ...current, status: "in_custody", custody };
  return { state: { ...state, activityExportBatches: { ...state.activityExportBatches, [exportId]: batch } }, batch };
}

export function reconcileAccessActivityCustody(state = {}) {
  const events = state.accessActivityEvents ?? [];
  verifyChain(events);
  const batches = Object.values(state.activityExportBatches ?? {}).sort((a, b) => a.fromSequence - b.fromSequence);
  const inCustody = batches.filter((batch) => batch.status === "in_custody");
  let expected = 1;
  const gaps = [];
  for (const batch of inCustody) {
    if (batch.fromSequence > expected) gaps.push({ fromSequence: expected, throughSequence: batch.fromSequence - 1 });
    if (batch.fromSequence < expected) fail("activity_export_overlap", "Activity custody batches overlap.");
    expected = batch.throughSequence + 1;
  }
  if (expected <= events.length) gaps.push({ fromSequence: expected, throughSequence: events.length });
  return { chainValid: true, activityEventCount: events.length, custodyBatchCount: inCustody.length, highestCustodiedSequence: expected - 1, pendingBatchIds: batches.filter((batch) => batch.status !== "in_custody").map((batch) => batch.exportId), gaps, complete: gaps.length === 0 && batches.every((batch) => batch.status === "in_custody") };
}

function verifyChain(events) {
  let previousHash = "0".repeat(64);
  for (let index = 0; index < events.length; index += 1) {
    const { checksumSha256, ...base } = events[index];
    if (base.sequence !== index + 1 || base.previousHash !== previousHash || checksumSha256 !== hash(base)) fail("activity_chain_invalid", "Access activity chain integrity validation failed.");
    previousHash = checksumSha256;
  }
}
function futureAtLeast(value, now, minimumMs, field) { const time = Date.parse(value); if (!Number.isFinite(time) || time < now.getTime() + minimumMs) fail("activity_export_retention_invalid", `${field} must preserve at least 180 days.`); return new Date(time).toISOString(); }
function nonNegativeInteger(value, field) { if (!Number.isInteger(value) || value < 0) fail("activity_export_range_invalid", `${field} must be a non-negative integer.`); return value; }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("activity_export_invalid", `${field} is required.`); return value; }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
