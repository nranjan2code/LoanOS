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

test("ExternalServiceManager email and WhatsApp providers default to mock with India data posture", async () => {
  const manager = new ExternalServiceManager();

  const email = await manager.sendEmail("asha@example.in", "LoanOS update", "Your loan document is ready.");
  assert.strictEqual(email.success, true);
  assert.strictEqual(email.channel, "email");
  assert.strictEqual(email.provider, "mock");
  assert.strictEqual(email.dataResidencyCountry, "IN");
  assert.match(email.ref, /^EMAIL-MOCK-/);

  const whatsapp = await manager.sendWhatsApp("+919876543210", "Your payment reminder is ready.");
  assert.strictEqual(whatsapp.success, true);
  assert.strictEqual(whatsapp.channel, "whatsapp");
  assert.strictEqual(whatsapp.provider, "mock");
  assert.strictEqual(whatsapp.dataResidencyCountry, "IN");
  assert.match(whatsapp.ref, /^WHATSAPP-MOCK-/);
});

test("ExternalServiceManager communication dispatch enforces India data residency", async () => {
  const manager = new ExternalServiceManager({ emailDataResidencyCountry: "SG" });
  await assert.rejects(
    async () => {
      await manager.sendCommunication({
        channel: "email",
        to: "asha@example.in",
        subject: "LoanOS update",
        message: "Hello"
      });
    },
    /Email provider data residency country must be IN/
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

test("ExternalServiceManager bank account mock verifies active borrower account", async () => {
  const manager = new ExternalServiceManager();
  const result = await manager.verifyBankAccount({
    accountNumber: "123456789012",
    ifsc: "hdfc0000001",
    expectedHolderName: "Asha Sharma"
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.provider, "mock");
  assert.strictEqual(result.status, "verified");
  assert.strictEqual(result.accountStatus, "active");
  assert.strictEqual(result.ifsc, "HDFC0000001");
  assert.strictEqual(result.accountNumberLast4, "9012");
  assert.strictEqual(result.nameMatch, true);
  assert.match(result.verificationRef, /^BANK-VERIFY-MOCK-/);
});

test("ExternalServiceManager bank account mock flags name mismatch", async () => {
  const manager = new ExternalServiceManager();
  const result = await manager.verifyBankAccount({
    accountNumber: "123456789012",
    ifsc: "HDFC0000001",
    expectedHolderName: "Someone Else"
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.status, "name_mismatch");
  assert.strictEqual(result.nameMatch, false);
});

test("ExternalServiceManager bank account real provider fails without credentials", async () => {
  const manager = new ExternalServiceManager({ bankAccountProvider: "real" });
  await assert.rejects(
    async () => {
      await manager.verifyBankAccount({
        accountNumber: "123456789012",
        ifsc: "HDFC0000001",
        expectedHolderName: "Asha Sharma"
      });
    },
    /Real bank account verification provider configured but credentials missing/
  );
});

test("ExternalServiceManager payment rail mock registers NACH mandates and UPI collects", async () => {
  const manager = new ExternalServiceManager();
  const mandate = await manager.createNachMandate({
    borrowerId: "bor_001",
    loanAccountId: "loan_001",
    bankAccountVerificationRef: "BANK-VERIFY-MOCK-001",
    accountNumberLast4: "9012",
    maxAmount: 15000,
    frequency: "monthly",
    consentRef: "consent_nach_001"
  });

  assert.strictEqual(mandate.success, true);
  assert.strictEqual(mandate.provider, "mock");
  assert.strictEqual(mandate.channel, "nach");
  assert.strictEqual(mandate.status, "registered");
  assert.strictEqual(mandate.dataResidencyCountry, "IN");
  assert.match(mandate.mandateRef, /^NACH-MOCK-/);

  const collect = await manager.createUpiCollect({
    borrowerId: "bor_001",
    loanAccountId: "loan_001",
    vpa: "asha@upi",
    amount: 2500,
    purpose: "repayment"
  });

  assert.strictEqual(collect.success, true);
  assert.strictEqual(collect.provider, "mock");
  assert.strictEqual(collect.channel, "upi");
  assert.strictEqual(collect.status, "pending");
  assert.strictEqual(collect.dataResidencyCountry, "IN");
  assert.match(collect.collectRef, /^UPI-MOCK-/);
});

test("ExternalServiceManager payment rail real provider fails without credentials", async () => {
  const manager = new ExternalServiceManager({ paymentRailProvider: "real" });
  await assert.rejects(
    async () => {
      await manager.createNachMandate({
        borrowerId: "bor_001",
        bankAccountVerificationRef: "BANK-VERIFY-MOCK-001",
        accountNumberLast4: "9012",
        maxAmount: 15000
      });
    },
    /Real payment rail provider configured but API URL or API key is missing/
  );
});

test("ExternalServiceManager payment rail dispatch enforces India data residency", async () => {
  const manager = new ExternalServiceManager({ paymentRailDataResidencyCountry: "SG" });
  await assert.rejects(
    async () => {
      await manager.createUpiCollect({
        vpa: "asha@upi",
        amount: 2500,
        purpose: "repayment"
      });
    },
    /Payment rail provider data residency country must be IN/
  );
});

test("ExternalServiceManager Credit Bureau enforces India data residency", async () => {
  const manager = new ExternalServiceManager({ bureauDataResidencyCountry: "US" });
  await assert.rejects(
    async () => {
      await manager.queryCreditBureau("ABCDE1234F");
    },
    /Credit Bureau provider data residency country must be IN/
  );
});

test("ExternalServiceManager V-CIP enforces India data residency", async () => {
  const manager = new ExternalServiceManager({ vcipDataResidencyCountry: "US" });
  await assert.rejects(
    async () => {
      await manager.analyzeVcipVideo("borrower_1", "vid_hash_123");
    },
    /V-CIP provider data residency country must be IN/
  );
});

test("ExternalServiceManager bank account verification enforces India data residency", async () => {
  const manager = new ExternalServiceManager({ bankAccountDataResidencyCountry: "US" });
  await assert.rejects(
    async () => {
      await manager.verifyBankAccount({
        accountNumber: "123456789012",
        ifsc: "HDFC0000001",
        expectedHolderName: "Asha Sharma"
      });
    },
    /Bank account verification provider data residency country must be IN/
  );
});

test("ExternalServiceManager eSign enforces India data residency", async () => {
  const manager = new ExternalServiceManager({ esignDataResidencyCountry: "US" });
  await assert.rejects(
    async () => {
      await manager.verifyEsignOtp("123456789012", "123456", "somehash");
    },
    /eSign provider data residency country must be IN/
  );
});

test("ExternalServiceManager CERSAI enforces India data residency", async () => {
  const manager = new ExternalServiceManager({ cersaiDataResidencyCountry: "US" });
  await assert.rejects(
    async () => {
      await manager.fileCersaiSecurityInterest({ securityInterestId: "si_001" });
    },
    /CERSAI provider data residency country must be IN/
  );
  await assert.rejects(
    async () => {
      await manager.searchCersai("some asset description");
    },
    /CERSAI provider data residency country must be IN/
  );
});

test("ExternalServiceManager FIU-IND enforces India data residency", async () => {
  const manager = new ExternalServiceManager({ fiuDataResidencyCountry: "US" });
  await assert.rejects(
    async () => {
      await manager.fileFiuReport({ reportId: "rep_001" });
    },
    /FIU-IND provider data residency country must be IN/
  );
});
