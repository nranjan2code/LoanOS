import test from "node:test";
import assert from "node:assert/strict";
import { createTransportRecord, createTransportResubmission, markTransportDispatched, parseSignedFile, recordTransportPoll, serializeSignedFile } from "../packages/core/src/signed-file-transport.js";

const rows = [{ rowId: "1", amountPaise: "101", note: "a,b" }, { rowId: "2", amountPaise: "99", note: "<ok>" }]; const columns = ["rowId", "amountPaise", "note"];
test("CSV, JSON, XML and fixed-width serialization round-trip with binary checksums", () => {
  for (const format of ["csv", "json", "xml"]) { const file = serializeSignedFile(rows, { format, columns }); const parsed = parseSignedFile(file.bytes, { format, columns, expectedChecksumSha256: file.checksumSha256 }); assert.equal(parsed.rowCount, 2); assert.deepEqual(parsed.rows, rows); }
  const simple = rows.map(({ rowId, amountPaise }) => ({ rowId, amountPaise })); const columnSpecs = [{ name: "rowId", width: 2 }, { name: "amountPaise", width: 5, align: "right" }]; const fixed = serializeSignedFile(simple, { format: "fixed_width", columns: ["rowId", "amountPaise"], columnSpecs }); assert.deepEqual(parseSignedFile(fixed.bytes, { format: "fixed_width", columnSpecs, expectedChecksumSha256: fixed.checksumSha256 }).rows, simple);
  assert.throws(() => parseSignedFile(Buffer.from("tampered"), { format: "json", expectedChecksumSha256: "0".repeat(64) }), (e) => e.code === "signed_parser_checksum_mismatch");
});

test("SFTP, API, and portal records are tenant isolated and idempotent", () => {
  for (const channel of ["sftp", "api", "portal"]) { const file = serializeSignedFile(rows, { format: "json", columns }); const envelope = { tenantId: "t1", envelopeId: `env-${channel}`, system: "cic", status: "ready", payloadChecksumSha256: file.checksumSha256, manifestChecksumSha256: "a".repeat(64) }; const input = { tenantId: "t1", transportId: `tr-${channel}`, idempotencyKey: `ik-${channel}`, channel, destinationRef: `destination/${channel}`, credentialRef: "vault/credential", networkPolicyRef: "allowlist/1" }; const first = createTransportRecord({}, envelope, file, input); assert.equal(first.transport.status, "prepared"); assert.equal(createTransportRecord(first.registry, envelope, file, input).idempotent, true); assert.throws(() => createTransportRecord(first.registry, { ...envelope, tenantId: "t2" }, file, input), (e) => e.code === "signed_transport_envelope_invalid"); }
});

test("dispatch, polling acknowledgement, rejection, correction and resubmission remain evidence-bound", () => {
  const file = serializeSignedFile(rows, { format: "json", columns }); const envelope = { tenantId: "t1", envelopeId: "env", system: "fiu", status: "ready", payloadChecksumSha256: file.checksumSha256, manifestChecksumSha256: "a".repeat(64) };
  let result = createTransportRecord({}, envelope, file, { tenantId: "t1", transportId: "tr1", idempotencyKey: "ik1", channel: "api", destinationRef: "provider/api", credentialRef: "vault/credential", networkPolicyRef: "allowlist/1" });
  result = markTransportDispatched(result.registry, { tenantId: "t1", transportId: "tr1", providerRequestRef: "request/1", dispatchEvidenceRef: "evidence/dispatch" });
  result = recordTransportPoll(result.registry, { tenantId: "t1", transportId: "tr1", pollRef: "poll/1", pollEvidenceRef: "evidence/poll1", providerStatus: "pending" }); assert.equal(result.transport.status, "polling");
  const rejectedInput = { tenantId: "t1", transportId: "tr1", pollRef: "poll/2", pollEvidenceRef: "evidence/poll2", providerStatus: "rejected", acknowledgementRef: "ack/1", acknowledgedManifestChecksumSha256: envelope.manifestChecksumSha256 };
  result = recordTransportPoll(result.registry, rejectedInput); assert.equal(result.transport.status, "rejected"); assert.equal(recordTransportPoll(result.registry, rejectedInput).idempotent, true);
  const retry = createTransportResubmission(result.registry, { tenantId: "t1", parentTransportId: "tr1", transportId: "tr2", idempotencyKey: "ik2", correctionId: "corr1", correctionEvidenceRef: "evidence/correction" }); assert.equal(retry.transport.attempt, 2); assert.equal(retry.transport.status, "prepared");
  assert.throws(() => recordTransportPoll(markTransportDispatched(retry.registry, { tenantId: "t1", transportId: "tr2", providerRequestRef: "request/2", dispatchEvidenceRef: "evidence/dispatch2" }).registry, { tenantId: "t1", transportId: "tr2", pollRef: "poll/3", pollEvidenceRef: "ev", providerStatus: "accepted", acknowledgementRef: "ack/2", acknowledgedManifestChecksumSha256: "b".repeat(64) }), (e) => e.code === "signed_transport_ack_mismatch");
});
