import test from "node:test";
import assert from "node:assert/strict";
import { allocateTerritoryCapacity, approvePartnerOnboarding, certifyPartnerAccess, closePartnerConductCase, createFieldHierarchy, createPartnerOnboarding, issuePartnerCredential, openPartnerConductCase, revokePartnerCredential } from "../packages/core/src/channel-crm-governance.js";

const NOW = new Date("2026-07-15T10:00:00.000Z");
const approval = { tenantId: "tenant-a", proposedBy: "maker", approvedBy: "checker", approvalRef: "approval://1" };
function pending() { return createPartnerOnboarding({ tenantId: "tenant-a", partnerId: "dsa-1", partnerType: "dsa", legalName: "Trusted DSA", territoryIds: ["mum-west"], agreementRef: "agreement://1", dueDiligenceRef: "dd://1", conductPolicyRef: "policy://conduct", trainingEvidenceRef: "training://1", submittedBy: "maker" }, [], NOW); }
function active() { return approvePartnerOnboarding(pending(), { tenantId: "tenant-a", approvedBy: "checker", approvalRef: "approval://onboarding" }, NOW); }

test("partner onboarding and credentials are tenant-local, independently approved and revocable", () => {
  assert.throws(() => approvePartnerOnboarding(pending(), { tenantId: "tenant-a", approvedBy: "maker", approvalRef: "x" }, NOW), (error) => error.code === "channel_four_eyes_required");
  const partner = active();
  const credential = issuePartnerCredential(partner, { ...approval, credentialId: "cred-1", principalId: "agent-1", credentialType: "field_pwa", scopes: ["lead:create"], provisioningEvidenceRef: "iam://1", expiresAt: "2027-01-15T00:00:00.000Z" }, [], NOW);
  assert.equal(credential.status, "active");
  assert.throws(() => issuePartnerCredential(partner, { ...approval, tenantId: "tenant-b", credentialId: "x", principalId: "x", credentialType: "portal", scopes: ["x"], provisioningEvidenceRef: "x", expiresAt: "2027-01-15T00:00:00.000Z" }, [], NOW), (error) => error.code === "channel_tenant_mismatch");
  const revoked = revokePartnerCredential(credential, { tenantId: "tenant-a", revokedBy: "iam-maker", approvedBy: "iam-checker", approvalRef: "approval://revoke", reason: "Partner agent exited", revocationEvidenceRef: "iam://revoked" }, NOW);
  assert.equal(revoked.status, "revoked");
});

test("field hierarchy constrains territory and capacity without cross-tenant fallback", () => {
  const unit = createFieldHierarchy({ ...approval, unitId: "unit-1", name: "Mumbai West", unitType: "territory", territoryIds: ["mum-west"], capacity: 5 }, [], NOW);
  const first = allocateTerritoryCapacity([unit], { ...approval, allocationId: "alloc-1", unitId: "unit-1", assigneeId: "officer-1", territoryId: "mum-west", workload: 3 }, [], NOW);
  assert.equal(first.workload, 3);
  assert.throws(() => allocateTerritoryCapacity([unit], { ...approval, allocationId: "alloc-2", unitId: "unit-1", assigneeId: "officer-2", territoryId: "mum-west", workload: 3 }, [first], NOW), (error) => error.code === "capacity_exceeded");
  assert.throws(() => allocateTerritoryCapacity([unit], { ...approval, territoryId: "delhi", allocationId: "alloc-3", unitId: "unit-1", assigneeId: "officer-2", workload: 1 }, [], NOW), (error) => error.code === "territory_not_authorised");
});

test("periodic access certification fails closed for omitted or expired access", () => {
  const partner = active();
  const credential = issuePartnerCredential(partner, { ...approval, credentialId: "cred-1", principalId: "agent-1", credentialType: "portal", scopes: ["lead:read"], provisioningEvidenceRef: "iam://1", expiresAt: "2027-01-15T00:00:00.000Z" }, [], NOW);
  const input = { tenantId: "tenant-a", certificationId: "cert-1", credentialIds: ["cred-1"], nextReviewAt: "2026-10-15T00:00:00.000Z", certifiedBy: "access-owner", approvedBy: "risk-checker", approvalRef: "approval://cert", evidenceRef: "iam://review" };
  assert.equal(certifyPartnerAccess(partner, [credential], input, NOW).status, "certified");
  assert.throws(() => certifyPartnerAccess(partner, [credential, { ...credential, credentialId: "cred-2" }], input, NOW), (error) => error.code === "access_certification_blocked");
  assert.throws(() => certifyPartnerAccess(partner, [{ ...credential, expiresAt: NOW.toISOString() }], input, NOW), (error) => error.code === "access_certification_blocked");
});

test("conduct monitoring retains evidence and independently approves substantiated action", () => {
  const conductCase = openPartnerConductCase(active(), { tenantId: "tenant-a", caseId: "case-1", allegation: "Customer was charged an unauthorised sourcing fee", severity: "high", sourceRef: "complaint://1", openedBy: "conduct-analyst", owner: "conduct-team" }, [], NOW);
  assert.throws(() => closePartnerConductCase(conductCase, { tenantId: "tenant-a", finding: "substantiated", actions: ["Suspend access"], investigatedBy: "analyst", approvedBy: "analyst", approvalRef: "x", evidenceRef: "evidence://1" }, NOW), (error) => error.code === "channel_four_eyes_required");
  const closed = closePartnerConductCase(conductCase, { tenantId: "tenant-a", finding: "substantiated", actions: ["Suspend access", "Customer remediation"], investigatedBy: "analyst", approvedBy: "conduct-checker", approvalRef: "approval://finding", evidenceRef: "evidence://case-1" }, NOW);
  assert.equal(closed.partnerAccessRecommendation, "suspend");
});
