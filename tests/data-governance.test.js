import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assessDataQuality,
  auditGenesisHash,
  certifyDataQuality,
  createAuditAnchor,
  createDataQualityRule,
  createEvidenceCustodyRecord,
  deleteEvidenceWithProof,
  placeEvidenceLegalHold,
  releaseEvidenceLegalHold,
  reconcileBusinessEventCompleteness,
  registerDataLineage,
  sealAuditChain,
  verifyAuditChain
} from "../packages/core/src/index.js";
import { createLoanOsServer } from "../apps/api/src/server.js";

const TENANT_ID = "tenant_governance";
const NOW = new Date("2026-07-14T00:00:00.000Z");
const checksum = (value) => createHash("sha256").update(value).digest("hex");
const approval = { proposedBy: "data_owner", approvedBy: "risk_checker", approvalRef: "approval-001" };

test("audit anchor binds verified head/count to India WORM evidence and chains anchors", () => {
  const events = sealAuditChain([{ type: "loan.application.created", applicationId: "app-1" }], TENANT_ID, { now: NOW });
  const integrity = verifyAuditChain(events, TENANT_ID);
  const first = createAuditAnchor(events, TENANT_ID, {}, {
    anchorId: "anchor-1", headHash: integrity.headHash, eventCount: 1, providerName: "India WORM Vault", providerRef: "vault-1", externalTimestampRef: "tsa-1", evidenceChecksumSha256: checksum("anchor evidence"), storageCountry: "IN", storageClass: "worm", immutable: true, anchoredAt: NOW.toISOString(), retentionUntil: "2031-07-14T00:00:00.000Z", ...approval
  }, NOW);
  assert.equal(first.summary.status, "ready");
  const mismatch = createAuditAnchor(events, TENANT_ID, first.registry, { ...first.anchor, anchorId: "anchor-2", headHash: "0".repeat(64), providerRef: "vault-2" }, NOW);
  assert.equal(mismatch.summary.status, "blocked");
  const future = createAuditAnchor(events, TENANT_ID, first.registry, { ...first.anchor, anchorId: "anchor-3", anchoredAt: "2026-07-15T00:00:00.000Z", providerRef: "vault-3" }, NOW);
  assert.equal(future.summary.status, "blocked");
});

test("business-event completeness reconciles source records to the sealed audit chain", () => {
  const state = {
    loanApplications: { "app-1": { applicationId: "app-1" } },
    loanAccounts: { "loan-1": { loanAccountId: "loan-1" } },
    events: sealAuditChain([
      { type: "loan.application.created", applicationId: "app-1" },
      { type: "loan.disbursement.recorded", loanAccountId: "loan-1" }
    ], TENANT_ID, { now: NOW })
  };
  const passed = reconcileBusinessEventCompleteness(state, { reconciliationId: "recon-1", tenantId: TENANT_ID, ...approval }, NOW);
  assert.equal(passed.reconciliation.status, "certified");
  const failed = reconcileBusinessEventCompleteness({ ...state, loanAccounts: { ...state.loanAccounts, "loan-2": { loanAccountId: "loan-2" } } }, { reconciliationId: "recon-2", tenantId: TENANT_ID, ...approval }, NOW);
  assert.equal(failed.summary.status, "blocked");
  assert.deepEqual(failed.reconciliation.checks.find((item) => item.collection === "loanAccounts").missingIds, ["loan-2"]);
});

test("evidence custody enforces immutable India storage, legal hold, retention, and deletion proof", () => {
  const admitted = createEvidenceCustodyRecord({}, {
    evidenceId: "evidence-1", sourceType: "audit_workpaper", sourceId: "workpaper-1", contentChecksumSha256: checksum("workpaper"), storageCountry: "IN", storageRef: "worm://vault/workpaper-1", immutable: true, custodian: "compliance", collectedAt: NOW.toISOString(), retentionUntil: "2027-07-14T00:00:00.000Z", ...approval
  }, NOW);
  assert.equal(admitted.summary.status, "ready");
  assert.equal(createEvidenceCustodyRecord({}, { ...admitted.evidence, evidenceId: "future-evidence", collectedAt: "2026-07-15T00:00:00.000Z", ...approval }, NOW).summary.status, "blocked");
  assert.equal(placeEvidenceLegalHold(admitted.registry, "evidence-1", { holdId: "invalid-hold", reason: "RBI inspection", authorityRef: "rbi-request-invalid", retainUntil: "invalid", ...approval }, NOW).summary.status, "blocked");
  const held = placeEvidenceLegalHold(admitted.registry, "evidence-1", { holdId: "hold-1", reason: "RBI inspection", authorityRef: "rbi-request-1", retainUntil: "2030-07-14T00:00:00.000Z", ...approval }, NOW);
  assert.equal(held.summary.status, "ready");
  const blocked = deleteEvidenceWithProof(held.registry, "evidence-1", { deletionRef: "delete-1", storageDeletionEvidenceRef: "vault-delete-1", ...approval }, new Date("2031-07-14T00:00:00.000Z"));
  assert.equal(blocked.summary.status, "blocked");
  const released = releaseEvidenceLegalHold(held.registry, "evidence-1", "hold-1", { releaseReason: "Inspection closed", authorityRef: "rbi-close-1", ...approval }, new Date("2031-07-14T00:00:00.000Z"));
  assert.equal(released.hold.status, "released");
  assert.equal(deleteEvidenceWithProof(released.registry, "evidence-1", { deletionRef: "delete-after-hold", storageDeletionEvidenceRef: "vault-delete-after-hold", ...approval }, new Date("2031-07-14T00:00:00.000Z")).summary.status, "ready");
  const deleted = deleteEvidenceWithProof(admitted.registry, "evidence-1", { deletionRef: "delete-2", storageDeletionEvidenceRef: "vault-delete-2", ...approval }, new Date("2028-07-14T00:00:00.000Z"));
  assert.equal(deleted.summary.status, "ready");
  assert.match(deleted.evidence.deletionProof.proofChecksumSha256, /^[a-f0-9]{64}$/);
});

test("lineage registry binds source fields to versioned checksum transformations and outputs", () => {
  const result = registerDataLineage({}, {
    lineageId: "lineage-cic-dpd", sources: [{ system: "lms", entity: "loan_account", field: "daysPastDue" }], transform: { method: "canonical_cic_mapping", version: "1.0.0", checksumSha256: checksum("transform-v1") }, output: { system: "cic_ucrf", entity: "account_segment", field: "daysPastDue" }, purpose: "regulatory_reporting", regulatoryFields: ["CIC-DPD"], owner: "reporting_owner", ...approval
  }, NOW);
  assert.equal(result.summary.status, "ready");
  assert.match(result.lineage.lineageChecksumSha256, /^[a-f0-9]{64}$/);
});

test("declarative data-quality assessment blocks high-risk failures and certifies clean results", () => {
  let rules = createDataQualityRule({}, { ruleId: "borrower-name-required", collection: "borrowerProfiles", field: "fullName", ruleType: "required", severity: "critical", owner: "data_owner", ...approval }, NOW).registry;
  rules = createDataQualityRule(rules, { ruleId: "borrower-country", collection: "borrowerProfiles", field: "residencyCountry", ruleType: "enum", parameter: ["IN"], severity: "high", owner: "data_owner", ...approval }, NOW).registry;
  const failed = assessDataQuality({ borrowerProfiles: { b1: { fullName: "", residencyCountry: "IN" } } }, rules, { assessmentId: "dq-1", assessedBy: "data_steward" }, NOW);
  assert.equal(failed.assessment.failureCount, 1);
  assert.equal(certifyDataQuality(failed.assessment, { certificationId: "dqc-1", certifiedBy: "data_steward", approvedBy: "risk_checker", approvalRef: "dq-approval" }, NOW).summary.status, "blocked");
  const clean = assessDataQuality({ borrowerProfiles: { b1: { fullName: "Asha Sharma", residencyCountry: "IN" } } }, rules, { assessmentId: "dq-2", assessedBy: "data_steward" }, NOW);
  const certified = certifyDataQuality(clean.assessment, { certificationId: "dqc-2", certifiedBy: "data_steward", approvedBy: "risk_checker", approvalRef: "dq-approval" }, NOW);
  assert.equal(certified.certification.status, "certified");
  const unknownCollectionRules = createDataQualityRule({}, { ruleId: "unknown-required", collection: "misspelledCollection", field: "id", ruleType: "required", severity: "critical", owner: "data_owner", ...approval }, NOW).registry;
  const unknownCollection = assessDataQuality({}, unknownCollectionRules, { assessmentId: "dq-3", assessedBy: "data_steward" }, NOW);
  assert.equal(unknownCollection.assessment.failureCount, 1);
  assert.equal(unknownCollection.assessment.results[0].failures[0].reason, "unknown_collection");
  const lowRules = createDataQualityRule({}, { ruleId: "optional-pattern", collection: "borrowerProfiles", field: "nickname", ruleType: "pattern", parameter: "^[A-Z]", severity: "low", owner: "data_owner", ...approval }, NOW).registry;
  const lowFailure = assessDataQuality({ borrowerProfiles: { b1: { nickname: "asha" } } }, lowRules, { assessmentId: "dq-4", assessedBy: "data_steward" }, NOW);
  assert.equal(certifyDataQuality(lowFailure.assessment, { certificationId: "dqc-4", certifiedBy: "data_steward", approvedBy: "risk_checker", approvalRef: "dq-approval" }, NOW).summary.status, "blocked");
  assert.equal(certifyDataQuality(lowFailure.assessment, { certificationId: "dqc-5", certifiedBy: "data_steward", approvedBy: "risk_checker", approvalRef: "dq-approval", exceptionRefs: ["dq-exception-1"] }, NOW).certification.status, "certified_with_low_risk_exceptions");
});

test("tenant governance API persists anchors, evidence, lineage, and data-quality certification", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-data-governance-")); const tenant = { tenantId: TENANT_ID, name: "Governance NBFC", apiKey: "governance-key" };
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`; const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify(body) });
  let response = await post("/governance/audit-anchors", { anchorId: "api-anchor-1", headHash: auditGenesisHash(TENANT_ID), eventCount: 0, providerName: "India WORM", providerRef: "vault-api-1", externalTimestampRef: "tsa-api-1", evidenceChecksumSha256: checksum("api-anchor"), storageCountry: "IN", storageClass: "worm", immutable: true, anchoredAt: NOW.toISOString(), retentionUntil: "2031-07-14T00:00:00.000Z", ...approval });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/governance/evidence", { evidenceId: "api-evidence-1", sourceType: "audit", sourceId: "anchor-1", contentChecksumSha256: checksum("api-evidence"), storageCountry: "IN", storageRef: "worm://api/evidence", immutable: true, custodian: "audit", collectedAt: NOW.toISOString(), retentionUntil: "2031-07-14T00:00:00.000Z", ...approval });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/governance/lineage", { lineageId: "api-lineage-1", sources: [{ system: "lms", entity: "loan", field: "balance" }], transform: { method: "sum", version: "1", checksumSha256: checksum("sum-v1") }, output: { system: "report", entity: "portfolio", field: "balance" }, owner: "data_owner", ...approval });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/governance/data-quality/rules", { ruleId: "api-borrower-name", collection: "borrowerProfiles", field: "fullName", ruleType: "required", severity: "critical", owner: "data_owner", ...approval });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/governance/data-quality/assessments", { assessmentId: "api-dq-1", assessedBy: "data_steward" });
  assert.equal(response.status, 201, await response.clone().text());
  response = await post("/governance/data-quality/assessments/api-dq-1/certification", { certificationId: "api-dqc-1", certifiedBy: "data_steward", approvedBy: "risk_checker", approvalRef: "api-dq-approval" });
  assert.equal(response.status, 201, await response.clone().text());
});
