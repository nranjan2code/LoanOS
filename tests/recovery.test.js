import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { appendPlatformEvent, createEmptyState, registerTenant } from "../apps/api/src/file-store.js";
import {
  buildRecoveryExercise,
  createRecoveryBackup,
  evaluateRecoveryObjectives,
  inspectRecoveryBackup
} from "../apps/api/src/recovery.js";

const MASTER_KEY = { keyId: "key_recovery_v1", key: Buffer.alloc(32, 7), provider: "test" };

function validState() {
  return registerTenant(createEmptyState(), { tenantId: "tnt_recovery", name: "Recovery Bank", apiKey: "recovery-key" }, new Date("2026-07-14T09:00:00.000Z"));
}

function backupInput() {
  return {
    backupId: "backup_20260714_001",
    sourceRegion: "ap-south-1",
    residencyCountry: "IN",
    storageLocationRef: "india-vault://daily/backup_20260714_001",
    retentionUntil: "2027-07-14T10:00:00.000Z",
    reason: "Scheduled immutable recovery point"
  };
}

test("recovery package encrypts state and verifies package, content, and audit integrity", () => {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const state = appendPlatformEvent(validState(), { type: "platform.test.seeded" }, { actor: "tester" }, now);
  const recoveryPackage = createRecoveryBackup(state, backupInput(), MASTER_KEY, now);

  assert.equal(recoveryPackage.format, "loanos.recovery.v1");
  assert.equal(recoveryPackage.manifest.residencyCountry, "IN");
  assert.equal(recoveryPackage.manifest.tenantCount, 1);
  assert.equal(JSON.stringify(recoveryPackage).includes("recovery-key"), false);
  const inspected = inspectRecoveryBackup(recoveryPackage, MASTER_KEY);
  assert.equal(inspected.verification.valid, true);
  assert.deepEqual(inspected.state, state);
  assert.equal(inspected.verification.audit.platform.eventCount, 1);

  const tampered = structuredClone(recoveryPackage);
  tampered.envelope.ciphertext = `${tampered.envelope.ciphertext.slice(0, -2)}AA`;
  assert.throws(() => inspectRecoveryBackup(tampered, MASTER_KEY), (error) => error.code === "backup_package_integrity_failed");
  assert.throws(
    () => inspectRecoveryBackup(recoveryPackage, { ...MASTER_KEY, key: Buffer.alloc(32, 8) }),
    (error) => error.code === "backup_decryption_failed"
  );
});

test("backup creation fails closed on a corrupt tenant audit chain", () => {
  const state = validState();
  state.tenants.tnt_recovery.events = [{ sequence: 0, eventId: "bad", previousHash: "bad", hash: "bad" }];
  assert.throws(
    () => createRecoveryBackup(state, backupInput(), MASTER_KEY, new Date("2026-07-14T10:00:00.000Z")),
    (error) => error.code === "backup_source_integrity_failed"
  );
});

test("recovery exercises measure RPO/RTO and retain remediation findings", () => {
  const manifest = { backupId: "backup_1", createdAt: "2026-07-14T09:50:00.000Z" };
  const input = {
    exerciseId: "drill_1",
    scenario: "regional_failover",
    changeTicket: "CHG-100",
    reason: "Quarterly regional recovery exercise",
    proposedBy: "maker",
    approvedBy: "checker",
    recoveryDeclaredAt: "2026-07-14T10:00:00.000Z",
    rpoTargetMinutes: 15,
    rtoTargetMinutes: 30,
    findings: ["DNS failover required manual intervention"],
    actions: ["Automate health-checked DNS promotion"]
  };
  const completedAt = new Date("2026-07-14T10:20:00.000Z");
  const objectives = evaluateRecoveryObjectives(manifest, input, completedAt);
  assert.equal(objectives.status, "objectives_met");
  assert.equal(objectives.rpo.actualMinutes, 10);
  assert.equal(objectives.rto.actualMinutes, 20);
  const exercise = buildRecoveryExercise(manifest, { packageSha256: "a".repeat(64) }, input, completedAt);
  assert.equal(exercise.status, "needs_remediation");
  assert.equal(exercise.findings.length, 1);
});

test("platform recovery APIs create, validate, drill, restore, and retain audit evidence", async (t) => {
  const previousKeys = process.env.LOANOS_MASTER_KEYS;
  const previousActive = process.env.LOANOS_ACTIVE_MASTER_KEY_ID;
  process.env.LOANOS_MASTER_KEYS = JSON.stringify({ key_recovery_v1: Buffer.alloc(32, 7).toString("hex") });
  process.env.LOANOS_ACTIVE_MASTER_KEY_ID = "key_recovery_v1";
  t.after(() => {
    if (previousKeys === undefined) delete process.env.LOANOS_MASTER_KEYS;
    else process.env.LOANOS_MASTER_KEYS = previousKeys;
    if (previousActive === undefined) delete process.env.LOANOS_ACTIVE_MASTER_KEY_ID;
    else process.env.LOANOS_ACTIVE_MASTER_KEY_ID = previousActive;
  });

  const dataDir = await mkdtemp(join(tmpdir(), "loanos-recovery-api-"));
  const platformAdminKey = "recovery-platform-key";
  const server = createLoanOsServer({
    dataDir,
    bootstrapTenants: [{ tenantId: "tnt_recovery", name: "Recovery Bank", apiKey: "recovery-key" }],
    platformAdminKey
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { "content-type": "application/json", "x-platform-admin-key": platformAdminKey };
  const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

  const backupResponse = await post("/platform/recovery/backups", {
    ...backupInput(),
    retentionUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  });
  assert.equal(backupResponse.status, 201);
  const { recoveryPackage } = await backupResponse.json();
  assert.equal(recoveryPackage.manifest.keyId, "key_recovery_v1");

  const validation = await post("/platform/recovery/backups/validate", { recoveryPackage });
  assert.equal(validation.status, 200);
  assert.equal((await validation.json()).verification.valid, true);

  const commonRecovery = {
    recoveryPackage,
    recoveryDeclaredAt: recoveryPackage.manifest.createdAt,
    rpoTargetMinutes: 15,
    rtoTargetMinutes: 30,
    changeTicket: "CHG-RECOVERY-1",
    reason: "Quarterly controlled restore exercise",
    proposedBy: "recovery_maker",
    approvedBy: "platform_admin_key"
  };
  const drillResponse = await post("/platform/recovery/drills", {
    ...commonRecovery,
    exerciseId: "drill_api_1",
    scenario: "backup_restore",
    findings: [],
    actions: []
  });
  assert.equal(drillResponse.status, 201);
  assert.equal((await drillResponse.json()).exercise.status, "passed");

  const badRestore = await post("/platform/recovery/restores", {
    ...commonRecovery,
    recoveryId: "restore_bad",
    expectedPackageSha256: recoveryPackage.packageSha256,
    targetRegion: "ap-south-1",
    residencyCountry: "IN",
    approvedBy: "spoofed_checker"
  });
  assert.equal(badRestore.status, 422);

  const restoreResponse = await post("/platform/recovery/restores", {
    ...commonRecovery,
    recoveryId: "restore_api_1",
    expectedPackageSha256: recoveryPackage.packageSha256,
    targetRegion: "ap-south-1",
    residencyCountry: "IN"
  });
  assert.equal(restoreResponse.status, 200);
  const restored = await restoreResponse.json();
  assert.match(restored.recovery.status, /^restored/);
  assert.equal(restored.verification.valid, true);

  const historyResponse = await fetch(`${base}/platform/recovery/history`, { headers: { "x-platform-admin-key": platformAdminKey } });
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.ok(history.records.some((record) => record.type === "platform.recovery.restored" && record.recoveryId === "restore_api_1"));
  assert.equal(history.records.some((record) => Object.hasOwn(record, "ciphertext")), false);
});
