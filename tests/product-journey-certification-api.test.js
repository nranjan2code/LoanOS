import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLoanOsServer } from "../apps/api/src/server.js";
import { totpCode } from "../apps/api/src/identity.js";
import { JOURNEY_PRODUCTION_EVIDENCE_DOMAIN_GROUPS } from "@loanos/core/journeys/product-journey-certification.js";
import { PRODUCT_TEMPLATE_CATALOGUE } from "@loanos/core/platform/product-template-catalogue.js";

const PASSWORD = "TenantAccessPass1!";
const MFA = "JBSWY3DPEHPK3PXP";

test("journey support certification API requires authenticated maker-checker and gates live activation", async (t) => {
  const tenant = { tenantId: "tenant_journey_cert", name: "Journey Certification Bank", apiKey: "journey-cert-key" };
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-journey-certification-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/health`);

  const cookies = {};
  for (const userId of ["maker", "checker"]) {
    let response = await fetch(`${base}/admin/users`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify({ userId, email: `${userId}@cert.example`, displayName: userId, password: PASSWORD, mustChangePassword: false, adminRoles: ["tenant_admin"], mfaRequired: true, mfaEnabled: true, mfaSecret: MFA }) });
    assert.equal(response.status, 201, await response.clone().text());
    response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: tenant.tenantId, email: `${userId}@cert.example`, password: PASSWORD, mfaCode: totpCode(MFA) }) });
    assert.equal(response.status, 200, await response.clone().text());
    cookies[userId] = response.headers.get("set-cookie").split(";", 1)[0];
  }
  const request = (path, cookie, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  const prefix = "/admin/product-journey-certifications";
  let response = await request(`${prefix}/proposals`, cookies.maker, { proposalId: "unsafe-production", certificationId: "unsafe", journeyType: "personal_loan", supportLevel: "production_ready", templateVersion: "1", validUntil: "2027-01-01T00:00:00.000Z", productionEvidence: [], externalDependencies: [] });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "journey_production_request_body_evidence_rejected");

  const productionJourney = "msme_term_loan";
  const evidenceItem = (domain) => ({ domain, tenantId: tenant.tenantId, journeyType: productionJourney, templateVersion: "1", configurationVersion: "4", status: "passed", evidenceRef: `evidence/${domain}`, evidenceChecksumSha256: "a".repeat(64), observedAt: "2026-07-14T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", producedBy: `producer/${domain}`, approvedBy: `approver/${domain}` });
  for (const registryType of ["provider", "deployment", "institution"]) {
    const evidenceId = `${registryType}-evidence-1`;
    const evidenceBody = { proposalId: `${registryType}-proposal-1`, registryType, evidenceId, journeyType: productionJourney, templateVersion: "1", configurationVersion: "4", evidence: JOURNEY_PRODUCTION_EVIDENCE_DOMAIN_GROUPS[registryType].map(evidenceItem), validUntil: "2027-01-01T00:00:00.000Z" };
    if (registryType === "provider") evidenceBody.externalDependencies = PRODUCT_TEMPLATE_CATALOGUE[productionJourney].integrationsProviders.map((providerFamily) => ({ tenantId: tenant.tenantId, journeyType: productionJourney, templateVersion: "1", configurationVersion: "4", providerFamily, status: "certified", dataResidencyCountry: "IN", certificationRef: `cert/${providerFamily}`, mappingRef: `mapping/${providerFamily}`, reconciliationRef: `reconciliation/${providerFamily}`, evidenceChecksumSha256: "b".repeat(64), validUntil: "2027-01-01T00:00:00.000Z" }));
    if (registryType === "institution") evidenceBody.activationBindings = { tenantJourneyConfigRef: "journey/config/4", regulatedEntityRef: "regulated-entity/1", productPolicyRef: "policy/1", operationsOwnerRef: "operations/1", tenantUatRef: "uat/1" };
    response = await request(`${prefix}/evidence-proposals`, cookies.maker, evidenceBody);
    assert.equal(response.status, 201, await response.clone().text());
    response = await request(`${prefix}/evidence-proposals/${evidenceBody.proposalId}/approval`, cookies.checker, { approvalRef: `approval/${registryType}` });
    assert.equal(response.status, 200, await response.clone().text());
  }
  const productionRequest = { proposalId: "production-proposal-1", certificationId: "production-cert-1", journeyType: productionJourney, supportLevel: "production_ready", templateVersion: "1", configurationVersion: "4", productionRegistryRefs: { providerEvidenceId: "provider-evidence-1", deploymentEvidenceId: "deployment-evidence-1", institutionEvidenceId: "institution-evidence-1" }, evidence: { configurationSchemaRef: "schema/1", domainTestRef: "domain/1", policyBindingRef: "policy/1", endToEndTestRef: "e2e/1", accountingControlRef: "accounting/1", complianceControlRef: "compliance/1", operationalRunRef: "operations/1", securityAssessmentRef: "security/1", drExerciseRef: "dr/1" }, validUntil: "2027-01-01T00:00:00.000Z" };
  response = await request(`${prefix}/proposals`, cookies.maker, productionRequest);
  assert.equal(response.status, 201, await response.clone().text());
  response = await request(`${prefix}/proposals/${productionRequest.proposalId}/approval`, cookies.checker, { approvalRef: "approval/production" });
  assert.equal(response.status, 200, await response.clone().text());
  response = await request(`${prefix}/activation-assessments`, cookies.checker, { journeyType: productionJourney, liveMode: true });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).assessment.status, "ready");
  response = await request(`${prefix}/proposals`, cookies.maker, {
    proposalId: "proposal-1",
    certificationId: "cert-1",
    journeyType: "personal_loan",
    supportLevel: "configurable_pattern",
    templateVersion: "1",
    evidence: { configurationSchemaRef: "schema/1", domainTestRef: "test/1", policyBindingRef: "policy/1" },
    validUntil: "2027-01-01T00:00:00.000Z"
  });
  assert.equal(response.status, 201, await response.clone().text());
  response = await request(`${prefix}/proposals/proposal-1/approval`, cookies.maker, { approvalRef: "approval/self" });
  assert.equal(response.status, 422);
  response = await request(`${prefix}/proposals/proposal-1/approval`, cookies.checker, { approvalRef: "approval/checker" });
  assert.equal(response.status, 200, await response.clone().text());
  const approved = await response.json();
  assert.equal(approved.certification.proposedBy, "maker");
  assert.equal(approved.certification.approvedBy, "checker");

  response = await request(`${prefix}/activation-assessments`, cookies.checker, { journeyType: "personal_loan", tenantJourneyConfigRef: "cfg", regulatedEntityRef: "re", productPolicyRef: "policy", operationsOwnerRef: "owner", tenantUatRef: "uat" });
  assert.equal(response.status, 200, await response.clone().text());
  response = await request(`${prefix}/activation-assessments`, cookies.checker, { journeyType: "personal_loan", tenantJourneyConfigRef: "cfg", regulatedEntityRef: "re", productPolicyRef: "policy", operationsOwnerRef: "owner", tenantUatRef: "uat", liveMode: true, providerReadinessRef: "provider", deploymentReadinessRef: "deployment" });
  assert.equal(response.status, 422);
  const blocked = await response.json();
  assert.ok(blocked.assessment.reasons.includes("production_support_certification_missing"));

  response = await request(`${prefix}/certifications/personal_loan/suspension-proposals`, cookies.maker, { proposalId: "suspension-1", reason: "provider incident", evidenceRef: "incident/1" });
  assert.equal(response.status, 201, await response.clone().text());
  response = await request(`${prefix}/suspension-proposals/suspension-1/approval`, cookies.maker, { approvalRef: "approval/self" });
  assert.equal(response.status, 422);
  response = await request(`${prefix}/suspension-proposals/suspension-1/approval`, cookies.checker, { approvalRef: "approval/suspension" });
  assert.equal(response.status, 200, await response.clone().text());
  response = await request(`${prefix}/activation-assessments`, cookies.checker, { journeyType: "personal_loan", tenantJourneyConfigRef: "cfg", regulatedEntityRef: "re", productPolicyRef: "policy", operationsOwnerRef: "owner", tenantUatRef: "uat" });
  assert.equal(response.status, 422);

  response = await fetch(`${base}${prefix}`, { headers: { cookie: cookies.checker } });
  assert.equal(response.status, 200, await response.clone().text());
  const projection = await response.json();
  assert.equal(projection.support.counts.planned, 20);
  assert.equal(projection.support.counts.production_ready, 1);
  assert.equal(projection.proposals[0].status, "approved");
  assert.equal(projection.suspensionProposals[0].status, "approved");
});
