import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { createLoanOsServer } from "../apps/api/src/server.js";

const sum = (value) => createHash("sha256").update(value).digest("hex");

test("customer experience completion API handles device certification, offline work and reconciliation", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-experience-"));
  const tenant = { tenantId: "tenant_exp", name: "Experience Bank", apiKey: "exp-key" };
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] });

  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { "content-type": "application/json", "x-api-key": tenant.apiKey };

  // 1. Get assignments
  let response = await fetch(`${base}/experience/assignments`, { headers });
  assert.equal(response.status, 200);
  const assignments = await response.json();
  assert.equal(assignments.length, 2);

  // 2. Certify device
  const devicePayload = {
    deviceId: "device-xyz",
    platform: "android",
    osVersion: "16",
    browserVersion: "140",
    attestationRef: "attestation://xyz",
    encryptionEvidenceRef: "evidence://encryption-ok",
    assistiveTechnologyEvidenceRef: "evidence://a11y-ok",
    encryptedStorage: true,
    screenLockEnforced: true,
    remoteWipeEnabled: true,
    testedBy: "device-tester",
    approvedBy: "security-checker",
    approvalRef: "approval://device-xyz",
    expiresAt: "2027-01-15T00:00:00.000Z"
  };

  response = await fetch(`${base}/experience/devices/certify`, {
    method: "POST",
    headers,
    body: JSON.stringify(devicePayload)
  });
  assert.equal(response.status, 201, await response.clone().text());
  const deviceRecord = await response.json();
  assert.equal(deviceRecord.status, "certified");

  // 3. Enqueue offline work
  const ciphertext = "base64:ciphertext-data-value";
  const envelopePayload = {
    envelopeId: "env-xyz",
    deviceId: "device-xyz",
    idempotencyKey: "idem-xyz",
    aggregateType: "lead",
    aggregateId: "lead-xyz",
    baseVersion: "3",
    ciphertext,
    ciphertextSha256: sum(ciphertext),
    keyId: "kms://leased/1",
    algorithm: "AES-256-GCM",
    nonce: "nonce-xyz",
    authTag: "auth-tag-xyz",
    expiresAt: "2026-07-20T10:00:00.000Z"
  };

  response = await fetch(`${base}/experience/offline-work/enqueue`, {
    method: "POST",
    headers,
    body: JSON.stringify(envelopePayload)
  });
  assert.equal(response.status, 201, await response.clone().text());
  const envelopeRecord = await response.json();
  assert.equal(envelopeRecord.envelopeId, "env-xyz");

  // 4. Reconcile offline work
  const reconcilePayload = {
    envelopeId: "env-xyz",
    currentVersion: "3", // matching version to ensure "applied" status
    appliedVersion: "4",
    evidenceRef: "sync://reconciled"
  };

  response = await fetch(`${base}/experience/offline-work/reconcile`, {
    method: "POST",
    headers,
    body: JSON.stringify(reconcilePayload)
  });
  assert.equal(response.status, 201, await response.clone().text());
  const reconcileRecord = await response.json();
  assert.equal(reconcileRecord.status, "applied");
});
