import test from "node:test";
import assert from "node:assert/strict";
import { SIGNED_FILE_SYSTEMS, buildSignedFileManifest, createSignedFileCorrection, recordSignedFileAcknowledgement, registerSignedFileSchemaProfile, signedFileExportHooks } from "@loanos/core/integrations/signed-file-conformance.js";

const H = "a".repeat(64); const E = "b".repeat(64); const approval = { proposedBy: "maker", approvedBy: "checker", approvalRef: "APR-1" };
const profileInput = (system, tenantId = "t1") => ({ tenantId, profileId: `${system}-v1`, profileName: `${system}-return`, system, schemaVersion: "1.0", schemaChecksumSha256: H, fileFormat: system === "cims_xbrl" ? "xbrl" : "jsonl", requiredColumns: ["rowId", "amountPaise"], amountFields: ["amountPaise"], signingRequired: true, encryptionRequired: true, ...approval });
const buildInput = (system, tenantId = "t1") => ({ tenantId, envelopeId: `${system}-env-1`, idempotencyKey: `${system}-ik-1`, profileId: `${system}-v1`, rows: [{ rowId: "1", amountPaise: "101" }, { rowId: "2", amountPaise: "99" }], signatureEvidenceRef: "sig/evidence", signingKeyRef: "hsm/key", encryptionEvidenceRef: "enc/evidence", encryptionKeyRef: "kms/key", encryptedPayloadChecksumSha256: E, ...approval });

test("all CBS, finance, tax, and regulatory systems support versioned tenant profiles", () => {
  let registry = {};
  for (const system of SIGNED_FILE_SYSTEMS) registry = registerSignedFileSchemaProfile(registry, profileInput(system)).registry;
  assert.equal(Object.keys(registry).length, 11); assert.deepEqual(signedFileExportHooks().systems, SIGNED_FILE_SYSTEMS);
  assert.throws(() => registerSignedFileSchemaProfile(registry, profileInput("cbs")), (e) => e.code === "signed_file_profile_duplicate");
  const other = registerSignedFileSchemaProfile(registry, profileInput("cbs", "t2")); assert.equal(other.profile.tenantId, "t2");
});

test("canonical manifests enforce exact paise, signature, encryption, totals, and idempotency", () => {
  const profiles = registerSignedFileSchemaProfile({}, profileInput("gl")).registry; const unsigned = buildInput("gl");
  assert.throws(() => buildSignedFileManifest({}, profiles, unsigned), (e) => e.code === "signed_file_signature_invalid");
  const optional = { ...profiles["t1:gl-v1"], signingRequired: false }; const draft = buildSignedFileManifest({}, { "t1:gl-v1": optional }, unsigned).envelope;
  const prepared = buildSignedFileManifest({}, profiles, { ...unsigned, signedManifestChecksumSha256: draft.manifestChecksumSha256 });
  assert.equal(prepared.envelope.rowCount, 2); assert.equal(prepared.envelope.amountTotalsPaise.amountPaise, "200");
  assert.throws(() => buildSignedFileManifest({}, profiles, { ...unsigned, rows: [{ rowId: "1", amountPaise: "1.00" }], signedManifestChecksumSha256: draft.manifestChecksumSha256 }), (e) => e.code === "signed_file_row_validation_failed");
});

test("accepted, rejected, correction, polling, replay, and tenant isolation are controlled", () => {
  let profiles = registerSignedFileSchemaProfile({}, profileInput("fiu")).registry;
  // Obtain the deterministic checksum by first building under a profile whose signature is optional, then use it under the signed profile.
  const optional = { ...profiles["t1:fiu-v1"], signingRequired: false }; const draft = buildSignedFileManifest({}, { "t1:fiu-v1": optional }, buildInput("fiu")).envelope;
  let built = buildSignedFileManifest({}, profiles, { ...buildInput("fiu"), signedManifestChecksumSha256: draft.manifestChecksumSha256 });
  assert.equal(built.envelope.amountTotalsPaise.amountPaise, "200");
  assert.equal(buildSignedFileManifest(built.envelopes, profiles, { ...buildInput("fiu"), signedManifestChecksumSha256: draft.manifestChecksumSha256 }).idempotent, true);
  assert.throws(() => recordSignedFileAcknowledgement(built.envelopes, { tenantId: "t2", envelopeId: built.envelope.envelopeId, acknowledgementRef: "ack", providerEventRef: "evt", status: "accepted", acknowledgedManifestChecksumSha256: built.envelope.manifestChecksumSha256, rowResults: [], ...approval }), (e) => e.code === "signed_file_envelope_missing");
  const partialInput = { tenantId: "t1", envelopeId: built.envelope.envelopeId, acknowledgementRef: "ack-1", providerEventRef: "evt-1", pollRef: "poll-1", status: "partial", acknowledgedManifestChecksumSha256: built.envelope.manifestChecksumSha256, rowResults: [{ rowNumber: 1, status: "accepted" }, { rowNumber: 2, status: "rejected", reasonCode: "schema" }], ...approval };
  let acked = recordSignedFileAcknowledgement(built.envelopes, partialInput); assert.equal(acked.envelope.status, "correction_required");
  assert.equal(recordSignedFileAcknowledgement(acked.envelopes, partialInput).idempotent, true);
  assert.throws(() => recordSignedFileAcknowledgement(acked.envelopes, { ...partialInput, status: "accepted", rowResults: partialInput.rowResults.map((r) => ({ ...r, status: "accepted" })) }), (e) => e.code === "signed_file_ack_replay_conflict");
  const corrected = createSignedFileCorrection(acked.envelopes, { tenantId: "t1", parentEnvelopeId: built.envelope.envelopeId, correctionId: "corr-1", correctedRowNumbers: [2], correctionEvidenceRef: "evidence/correction", ...approval }); assert.equal(corrected.envelope.status, "correction_approved");

  const acceptedInput = { ...buildInput("fiu"), envelopeId: "fiu-env-accepted", idempotencyKey: "fiu-ik-accepted" }; const acceptedDraft = buildSignedFileManifest({}, { "t1:fiu-v1": optional }, acceptedInput).envelope;
  const acceptedBuilt = buildSignedFileManifest({}, profiles, { ...acceptedInput, signedManifestChecksumSha256: acceptedDraft.manifestChecksumSha256 });
  const accepted = recordSignedFileAcknowledgement(acceptedBuilt.envelopes, { tenantId: "t1", envelopeId: acceptedBuilt.envelope.envelopeId, acknowledgementRef: "ack-ok", providerEventRef: "evt-ok", pollRef: "poll-ok", status: "accepted", acknowledgedManifestChecksumSha256: acceptedBuilt.envelope.manifestChecksumSha256, rowResults: [{ rowNumber: 1, status: "accepted" }, { rowNumber: 2, status: "accepted" }], ...approval }); assert.equal(accepted.envelope.status, "accepted");

  const rejectedInput = { ...buildInput("fiu"), envelopeId: "fiu-env-rejected", idempotencyKey: "fiu-ik-rejected" }; const rejectedDraft = buildSignedFileManifest({}, { "t1:fiu-v1": optional }, rejectedInput).envelope;
  const rejectedBuilt = buildSignedFileManifest({}, profiles, { ...rejectedInput, signedManifestChecksumSha256: rejectedDraft.manifestChecksumSha256 });
  const rejected = recordSignedFileAcknowledgement(rejectedBuilt.envelopes, { tenantId: "t1", envelopeId: rejectedBuilt.envelope.envelopeId, acknowledgementRef: "ack-no", providerEventRef: "evt-no", status: "rejected", acknowledgedManifestChecksumSha256: rejectedBuilt.envelope.manifestChecksumSha256, rowResults: [{ rowNumber: 1, status: "rejected", reasonCode: "invalid" }, { rowNumber: 2, status: "rejected", reasonCode: "invalid" }], ...approval }); assert.equal(rejected.envelope.status, "correction_required");
});
