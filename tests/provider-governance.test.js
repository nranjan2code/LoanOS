import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ExternalServiceManager,
  assessProviderCertification,
  certifyProvider,
  suspendProviderCertification
} from "../packages/core/src/index.js";
import { createLoanOsServer } from "../apps/api/src/server.js";

const NOW = new Date("2026-07-14T00:00:00.000Z");
const evidenceChecksumSha256 = createHash("sha256").update("certification evidence").digest("hex");

function certification(integration, overrides = {}) {
  return {
    integration,
    providerName: `${integration}-provider`,
    environment: "production",
    contractRef: `contract-${integration}`,
    certificationRef: `certificate-${integration}`,
    evidenceChecksumSha256,
    dataResidencyCountry: "IN",
    certifiedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2027-07-01T00:00:00.000Z",
    proposedBy: "integration_owner",
    approvedBy: "risk_checker",
    approvalRef: `approval-${integration}`,
    ...overrides
  };
}

test("provider certification is production-scoped, India-resident, time-bound, and four-eyes", () => {
  const blocked = certifyProvider({}, certification("cic", { approvedBy: "integration_owner", dataResidencyCountry: "SG" }), NOW);
  assert.equal(blocked.summary.status, "blocked");
  const created = certifyProvider({}, certification("cic"), NOW);
  assert.equal(created.summary.status, "ready");
  assert.equal(assessProviderCertification(created.registry, "cic", NOW).certified, true);
  assert.equal(assessProviderCertification(created.registry, "cic", new Date("2027-07-02T00:00:00.000Z")).reason, "certification_expired");
});

test("provider certification suspension is independently approved and immediately fail-closed", () => {
  const created = certifyProvider({}, certification("ckycrr"), NOW);
  const blocked = suspendProviderCertification(created.registry, "ckycrr", { reason: "security incident", suspendedBy: "risk_checker", approvedBy: "risk_checker", approvalRef: "suspend-1" }, NOW);
  assert.equal(blocked.summary.status, "blocked");
  const suspended = suspendProviderCertification(created.registry, "ckycrr", { reason: "security incident", suspendedBy: "security_owner", approvedBy: "risk_checker", approvalRef: "suspend-2" }, NOW);
  assert.equal(suspended.summary.status, "ready");
  assert.equal(assessProviderCertification(suspended.registry, "ckycrr", NOW).certified, false);
});

test("live provider readiness requires certification without exposing credentials", () => {
  const uncertified = new ExternalServiceManager({ cicProvider: "real", cicApiUrl: "https://cic.example.in", cicApiKey: "secret" }).integrationReadiness().find((item) => item.integration === "cic");
  assert.equal(uncertified.status, "blocked");
  assert.equal(uncertified.reason, "certification_missing");
  assert.equal(Object.hasOwn(uncertified, "apiKey"), false);
  const certified = certifyProvider({}, certification("cic"), NOW).registry;
  const ready = new ExternalServiceManager({ cicProvider: "real", cicApiUrl: "https://cic.example.in", cicApiKey: "secret", providerCertifications: certified }).integrationReadiness().find((item) => item.integration === "cic");
  assert.equal(ready.status, "ready");
  assert.equal(ready.certificationStatus, "certified");
});

test("CIC, CKYCRR, and AA transports retain checksum/idempotency evidence and block uncertified live mode", async () => {
  const manager = new ExternalServiceManager();
  const cic = await manager.submitCicReportingBatch({ batchId: "batch-1", checksumSha256: "a".repeat(64), recordCount: 2 });
  assert.equal(cic.checksumSha256, "a".repeat(64));
  const ckycrr = await manager.submitCkycrrPacket({ submissionId: "ckyc-1", packet: { checksumSha256: "b".repeat(64), canonicalContent: "{}" } });
  assert.match(ckycrr.transportRef, /^CKYCRR-TRANSPORT-MOCK-/);
  const aa = await manager.fetchAccountAggregatorData({ consentId: "aa-1", aaConsentHandle: "handle-1", fiTypes: ["deposit"], fetches: [] }, { fetchId: "fetch-1" });
  assert.equal(aa.dataResidencyCountry, "IN");
  const live = new ExternalServiceManager({ cicProvider: "real", cicApiUrl: "https://cic.example.in", cicApiKey: "secret" });
  await assert.rejects(() => live.submitCicReportingBatch({ batchId: "batch-1", checksumSha256: "a".repeat(64), recordCount: 2 }), /certification_missing/);
});

test("tenant API persists provider certification, exposes readiness, and suspends it with audit state", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-provider-governance-"));
  const tenant = { tenantId: "tenant_provider", name: "Provider NBFC", apiKey: "provider-api-key" };
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { "x-api-key": tenant.apiKey, ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}) } });
  let response = await request("/integrations/certifications", { method: "POST", body: JSON.stringify(certification("cic")) });
  assert.equal(response.status, 201, await response.clone().text());
  response = await request("/integrations/certifications");
  assert.equal((await response.json()).certifications.length, 1);
  response = await request("/integrations/readiness");
  const readiness = await response.json();
  assert.equal(readiness.integrations.length, 15);
  response = await request("/integrations/certifications/cic/suspension", { method: "POST", body: JSON.stringify({ reason: "certificate key compromise", suspendedBy: "security_owner", approvedBy: "risk_checker", approvalRef: "suspend-api-1" }) });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).status, "suspended");
});
