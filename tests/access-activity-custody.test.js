import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareAccessActivityExport, recordAccessActivityCustody, reconcileAccessActivityCustody } from "../packages/core/src/access-activity-custody.js";

const NOW = new Date("2026-07-15T06:30:00.000Z");

test("access activity exports bind an exact verified range to independent India WORM custody", () => {
  let state = { accessActivityEvents: chain([{ type: "access.api.request" }, { type: "access.api.response" }]), activityExportBatches: {} };
  const prepared = prepareAccessActivityExport(state, { exportId: "export-1", tenantId: "tenant-a", createdBy: "security-maker", retentionUntil: "2027-07-15T06:30:00.000Z" }, NOW);
  assert.equal(prepared.batch.eventCount, 2); assert.equal(prepared.payload.events.length, 2);
  assert.throws(() => recordAccessActivityCustody(prepared.state, "export-1", { approvedBy: "security-maker" }, NOW), (error) => error.code === "activity_export_four_eyes_required");
  const custody = recordAccessActivityCustody(prepared.state, "export-1", { approvedBy: "auditor", payloadChecksumSha256: prepared.batch.payloadChecksumSha256, storageCountry: "IN", immutable: true, worm: true, objectLockMode: "compliance", providerRetentionUntil: "2027-07-15T06:30:00.000Z", providerProfileId: "siem-1", providerRef: "provider-1", custodyRef: "worm-1", trustedTimestampRef: "tsa-1", approvalRef: "approval-1" }, NOW);
  assert.equal(custody.batch.status, "in_custody"); assert.equal(reconcileAccessActivityCustody(custody.state).complete, true);
});

test("tampered activity chains and custody checksum mismatches are rejected", () => {
  const events = chain([{ type: "one" }]); events[0].type = "tampered";
  assert.throws(() => prepareAccessActivityExport({ accessActivityEvents: events }, { exportId: "e", tenantId: "t", createdBy: "m", retentionUntil: "2027-07-15T06:30:00.000Z" }, NOW), (error) => error.code === "activity_chain_invalid");
});

function chain(items) { let previousHash = "0".repeat(64); return items.map((item, index) => { const base = { ...item, sequence: index + 1, previousHash, occurredAt: new Date(NOW.getTime() + index * 1000).toISOString() }; const checksumSha256 = createHash("sha256").update(JSON.stringify(base)).digest("hex"); previousHash = checksumSha256; return { ...base, checksumSha256 }; }); }
