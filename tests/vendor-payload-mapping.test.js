import test from "node:test";
import assert from "node:assert/strict";
import { VENDOR_UAT_SCENARIOS, assessVendorActivation, certifyVendorUat, mapVendorPayload, registerVendorMapping } from "../packages/core/src/vendor-payload-mapping.js";

const NOW = new Date("2026-07-15T00:00:00.000Z"), H = "a".repeat(64), H2 = "b".repeat(64), approval = { proposedBy: "maker", approvedBy: "checker", approvalRef: "approval/1" };
const mappingInput = { tenantId: "t1", mappingId: "cic-v1", family: "cic", provider: "vendor", operation: "submit", sourceSchemaVersion: "1", sourceSchemaChecksumSha256: H, targetSchemaVersion: "2026", targetSchemaChecksumSha256: H2, dataResidencyCountry: "IN", certificationRef: "cert/contract", fields: [{ source: "loan.amountPaise", target: "tradeline.amount", transform: "paise_string" }, { source: "party.name", target: "borrower.name", transform: "trim" }], ...approval };

test("vendor mapping is schema-bound, exact-money and tenant isolated", () => {
  const { registry, mapping } = registerVendorMapping({}, mappingInput, NOW); const result = mapVendorPayload(registry, { tenantId: "t1", mappingId: "cic-v1", sourceSchemaChecksumSha256: H, payload: { loan: { amountPaise: "10001" }, party: { name: " Asha " } } });
  assert.deepEqual(result.payload, { tradeline: { amount: "10001" }, borrower: { name: "Asha" } }); assert.equal(result.mappingChecksumSha256, mapping.mappingChecksumSha256);
  assert.throws(() => mapVendorPayload(registry, { tenantId: "t2", mappingId: "cic-v1", sourceSchemaChecksumSha256: H, payload: {} }), (e) => e.code === "vendor_mapping_unavailable");
  assert.throws(() => mapVendorPayload(registry, { tenantId: "t1", mappingId: "cic-v1", sourceSchemaChecksumSha256: H2, payload: {} }), (e) => e.code === "vendor_mapping_schema_mismatch");
  assert.throws(() => mapVendorPayload(registry, { tenantId: "t1", mappingId: "cic-v1", sourceSchemaChecksumSha256: H, payload: { loan: { amountPaise: 100 }, party: { name: "A" } } }), (e) => e.code === "vendor_mapping_money_invalid");
});

test("mapping registration rejects unsafe transforms, duplicate targets and weak governance", () => {
  assert.throws(() => registerVendorMapping({}, { ...mappingInput, fields: [{ source: "x", target: "y", transform: "eval" }] }, NOW), (e) => e.code === "vendor_mapping_transform_invalid");
  assert.throws(() => registerVendorMapping({}, { ...mappingInput, proposedBy: "same", approvedBy: "same" }, NOW), (e) => e.code === "vendor_mapping_four_eyes");
  assert.throws(() => registerVendorMapping({}, { ...mappingInput, fields: [{ source: "x", target: "y" }, { source: "z", target: "y" }] }, NOW), (e) => e.code === "vendor_mapping_target_duplicate");
});

test("activation requires the complete adverse UAT pack and external references", () => {
  const { registry: mappings, mapping } = registerVendorMapping({}, mappingInput, NOW); const base = { tenantId: "t1", certificationId: "uat-1", family: "cic", provider: "vendor", environment: "production_equivalent", mappingChecksumSha256: mapping.mappingChecksumSha256, transportEvidenceRef: "e/transport", cryptographicEvidenceRef: "e/crypto", reconciliationEvidenceRef: "e/recon", drEvidenceRef: "e/dr", exitEvidenceRef: "e/exit", expiresAt: "2027-07-15T00:00:00.000Z", results: VENDOR_UAT_SCENARIOS.map((scenario) => ({ scenario, status: "passed", evidenceRef: `e/${scenario}` })), ...approval };
  assert.throws(() => certifyVendorUat({}, { ...base, results: base.results.slice(1) }, NOW), (e) => e.code === "vendor_uat_incomplete"); const { registry: certifications } = certifyVendorUat({}, base, NOW);
  assert.equal(assessVendorActivation(mappings, certifications, { tenantId: "t1", mappingId: "cic-v1", certificationId: "uat-1" }, NOW).status, "blocked");
  assert.equal(assessVendorActivation(mappings, certifications, { tenantId: "t1", mappingId: "cic-v1", certificationId: "uat-1", credentialRef: "vault/key", contractRef: "contract/1" }, NOW).status, "ready");
});
