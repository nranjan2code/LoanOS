import { test } from "node:test";
import assert from "node:assert";
import { ExternalServiceManager } from "../packages/core/src/index.js";

test("ExternalServiceManager SMS provider defaults to mock and successfully logs messages", async () => {
  const manager = new ExternalServiceManager();
  const res = await manager.sendSms("+919876543210", "Hello Test SMS");
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.provider, "mock");
  assert.match(res.ref, /^SMS-MOCK-/);
});

test("ExternalServiceManager SMS provider fails if set to real and missing API credentials", async () => {
  const manager = new ExternalServiceManager({ smsProvider: "real" });
  await assert.rejects(
    async () => {
      await manager.sendSms("+919876543210", "Hello Real SMS");
    },
    /Real SMS provider configured but API URL or API key is missing/
  );
});

test("ExternalServiceManager Credit Bureau mock provider returns preseeded score", async () => {
  const manager = new ExternalServiceManager();
  // Aaditya Patel's PAN in mock preseed
  const result = await manager.queryCreditBureau("ABCDE1234F");
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.provider, "mock");
  assert.strictEqual(result.score, 750);
  assert.strictEqual(result.activeAccounts, 2);
  assert.strictEqual(result.defaultAccounts, 0);

  // Default query returns standard score
  const unknownResult = await manager.queryCreditBureau("UNKNOWN123");
  assert.strictEqual(unknownResult.success, true);
  assert.strictEqual(unknownResult.score, 700);
});

test("ExternalServiceManager V-CIP mock provider returns simulated face match", async () => {
  const manager = new ExternalServiceManager();
  const result = await manager.analyzeVcipVideo("borrower_1", "vid_hash_123");
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.provider, "mock");
  assert.strictEqual(result.faceMatchScore, 0.92);
  assert.strictEqual(result.livenessConfirmed, true);
  assert.strictEqual(result.gps.country, "IN");
});
