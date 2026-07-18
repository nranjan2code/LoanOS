import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { buildBusinessAdapterConformancePack } from "@loanos/core/integrations/business-adapter-conformance.js";
import { serializeSignedFile } from "@loanos/core/integrations/signed-file-transport.js";

const tenant = { tenantId: "tenant-adapters", name: "Adapter Bank", apiKey: "adapter-key" };
async function request(base, path, { method = "GET", body, key = tenant.apiKey } = {}) { return fetch(base + path, { method, headers: { "x-api-key": key, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); }

test("business adapter and signed-file APIs persist tenant-scoped execution lifecycles", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-adapter-api-")); const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant, { tenantId: "other", name: "Other", apiKey: "other-key" }] }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); }); const base = `http://127.0.0.1:${server.address().port}`;
  const common = { proposedBy: "maker", approvedBy: "checker", approvalRef: "approval-1" };
  let response = await request(base, "/integrations/business-adapters", { method: "POST", body: { adapterId: "valuation-1", family: "valuation", provider: "mock", dataResidencyCountry: "IN", contractRef: "contract", certificationRef: "cert", certificationExpiresAt: "2027-07-15T00:00:00.000Z", endpointRef: "endpoint", credentialRef: "vault", callbackSecretRef: "secret", reconciliationProfileRef: "recon", exitPlanRef: "exit", conformancePack: buildBusinessAdapterConformancePack("valuation"), ...common } }); assert.equal(response.status, 201, await response.clone().text());
  response = await request(base, "/integrations/business-adapter-requests", { method: "POST", body: { requestId: "request-1", adapterId: "valuation-1", operation: "create_order", idempotencyKey: "idem-1", payloadChecksumSha256: "a".repeat(64), purposeRef: "loan-1" } }); assert.equal(response.status, 201, await response.clone().text());
  response = await request(base, "/integrations/business-adapter-requests/request-1/events", { method: "POST", body: { eventId: "event-1", eventType: "report", status: "completed", providerReference: "provider-1", payloadChecksumSha256: "b".repeat(64), signatureEvidenceRef: "signature-1" } }); assert.equal((await response.json()).request.status, "completed");
  assert.equal((await (await request(base, "/integrations/business-adapters/reconciliation")).json()).status, "reconciled"); assert.equal((await (await request(base, "/integrations/business-adapters/reconciliation", { key: "other-key" })).json()).total, 0);

  response = await request(base, "/integrations/signed-files/schema-profiles", { method: "POST", body: { profileId: "profile-1", profileName: "cbs", system: "cbs", schemaVersion: "1", schemaChecksumSha256: "c".repeat(64), fileFormat: "json", requiredColumns: ["rowId", "amountPaise"], amountFields: ["amountPaise"], signingRequired: false, encryptionRequired: false, ...common } }); assert.equal(response.status, 201, await response.clone().text());
  const rows = [{ rowId: "1", amountPaise: "100" }]; response = await request(base, "/integrations/signed-files/envelopes", { method: "POST", body: { envelopeId: "envelope-1", idempotencyKey: "file-1", profileId: "profile-1", rows, ...common } }); const envelopeBody = await response.json(); assert.equal(response.status, 201, JSON.stringify(envelopeBody));
  const file = serializeSignedFile(rows, { format: "json", columns: ["amountPaise", "rowId"] }); response = await request(base, "/integrations/signed-files/transports", { method: "POST", body: { transportId: "transport-1", idempotencyKey: "transport-idem-1", envelopeId: "envelope-1", channel: "sftp", destinationRef: "destination", credentialRef: "vault", networkPolicyRef: "network", file: { checksumSha256: file.checksumSha256, byteLength: file.byteLength } } }); assert.equal(response.status, 201, await response.clone().text());
  response = await request(base, "/integrations/signed-files/transports/transport-1/dispatch", { method: "POST", body: { providerRequestRef: "provider-request-1", dispatchEvidenceRef: "dispatch-1" } }); assert.equal((await response.json()).transport.status, "dispatched");
});
