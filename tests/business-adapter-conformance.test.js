import test from "node:test";
import assert from "node:assert/strict";
import { BUSINESS_ADAPTER_FAMILIES, assessBusinessAdapterConformancePack, assessBusinessAdapterSuite, buildBusinessAdapterConformancePack, createBusinessAdapterRequest, projectBusinessAdapterReconciliation, recordBusinessAdapterEvent, registerBusinessAdapter } from "../packages/core/src/business-adapter-conformance.js";

const NOW = new Date("2026-07-15T10:00:00.000Z");
const profile = (family, overrides = {}) => ({ tenantId: "tenant_1", adapterId: `${family}_1`, family, provider: "mock", mode: "mock", dataResidencyCountry: "IN", contractRef: "contract_1", certificationRef: "cert_1", certificationExpiresAt: "2027-07-15T00:00:00.000Z", endpointRef: "endpoint_1", credentialRef: "vault_1", callbackSecretRef: "secret_1", reconciliationProfileRef: "recon_1", exitPlanRef: "exit_1", conformancePack: buildBusinessAdapterConformancePack(family), proposedBy: "maker_1", approvedBy: "checker_1", approvalRef: "approval_1", ...overrides });

test("all missing business adapter families have complete adverse conformance packs", () => {
  const suite = assessBusinessAdapterSuite(); assert.equal(suite.status, "complete"); assert.equal(suite.familyCount, 13); assert.equal(suite.scenarioCount, 117); assert.equal(BUSINESS_ADAPTER_FAMILIES.length, 13);
  const incomplete = buildBusinessAdapterConformancePack("valuation").filter((item) => item.scenarioClass !== "tamper"); assert.equal(assessBusinessAdapterConformancePack("valuation", incomplete).status, "blocked");
});

test("adapter registration requires India residency, certification, conformance and four eyes", () => {
  const result = registerBusinessAdapter({}, profile("valuation"), NOW); assert.equal(result.adapter.status, "active");
  assert.throws(() => registerBusinessAdapter({}, profile("valuation", { dataResidencyCountry: "US" }), NOW), (error) => error.code === "business_adapter_residency_invalid");
  assert.throws(() => registerBusinessAdapter({}, profile("valuation", { approvedBy: "maker_1" }), NOW), (error) => error.code === "business_adapter_four_eyes");
});

test("requests and signed provider events are tenant scoped, replay-safe and reconciled", () => {
  const adapterResult = registerBusinessAdapter({}, profile("valuation"), NOW); let requests = createBusinessAdapterRequest({}, adapterResult.registry, { tenantId: "tenant_1", requestId: "request_1", adapterId: "valuation_1", operation: "create_order", idempotencyKey: "idem_1", payloadChecksumSha256: "a".repeat(64), purposeRef: "loan_1", subjectRef: "asset_1" }, NOW).requests;
  let result = recordBusinessAdapterEvent(requests, { tenantId: "tenant_1", requestId: "request_1", eventId: "event_1", eventType: "report", status: "completed", providerReference: "provider_1", payloadChecksumSha256: "b".repeat(64), signatureEvidenceRef: "signature_1" }, NOW); requests = result.requests; assert.equal(projectBusinessAdapterReconciliation(requests, { tenantId: "tenant_1" }).status, "reconciled");
  assert.equal(recordBusinessAdapterEvent(requests, { tenantId: "tenant_1", requestId: "request_1", eventId: "event_1", eventType: "report", status: "completed", providerReference: "provider_1", payloadChecksumSha256: "b".repeat(64), signatureEvidenceRef: "signature_1" }, NOW).idempotent, true);
  assert.throws(() => recordBusinessAdapterEvent(requests, { tenantId: "tenant_2", requestId: "request_1", eventId: "event_2", eventType: "report", status: "completed", providerReference: "provider_1", payloadChecksumSha256: "b".repeat(64), signatureEvidenceRef: "signature_1" }, NOW), (error) => error.code === "business_adapter_request_missing");
});
