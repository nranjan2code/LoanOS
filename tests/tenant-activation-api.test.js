import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { totpCode } from "../apps/api/src/identity.js";
import { checksumTenantActivationEvidence, TENANT_ACTIVATION_DIMENSIONS } from "../packages/core/src/index.js";

const MFA = "JBSWY3DPEHPK3PXP"; const PASSWORD = "TenantAccessPass1!";

test("tenant activation API persists a complete simulator assessment without claiming production readiness", async (t) => {
  const tenant = { tenantId: "tenant_activation_api", name: "Activation Bank", apiKey: "activation-api-key" }; const dataDir = await mkdtemp(join(tmpdir(), "loanos-activation-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`; await fetch(`${base}/health`);
  let response = await fetch(`${base}/admin/users`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify({ userId: "admin", email: "admin@activation.example", displayName: "Activation admin", password: PASSWORD, mustChangePassword: false, adminRoles: ["tenant_admin"], mfaRequired: true, mfaEnabled: true, mfaSecret: MFA }) }); assert.equal(response.status, 201);
  response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: tenant.tenantId, email: "admin@activation.example", password: PASSWORD, mfaCode: totpCode(MFA) }) }); assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie").split(";", 1)[0];
  const validUntil = new Date(Date.now() + 86_400_000).toISOString(); const observedAt = new Date().toISOString(); const item = (field, id, status) => ({ tenantId: tenant.tenantId, [field]: id, status, mode: "simulated", commerciallyLive: false, validUntil });
  const payloads = {
    organisation_admission: { decision: "approved", requiredChecksComplete: true }, iam_staffing: { launchRoleCoverageComplete: true, featureStaffingComplete: true, segregationViolations: [], orphanedRequiredRoles: [], activeHumanPrincipalCount: 2 },
    products: { products: [item("productId", "personal-loan", "ready")] }, integrations: { campaigns: [item("integrationId", "kyc-provider", "passed")] }, deployment: { components: [item("componentId", "api", "healthy")], rollbackVerified: true }, security_controls: { controls: [item("controlId", "session-revocation", "effective")], failClosedVerified: true }, uat: { status: "passed", adverseCasesComplete: true, tenantSignoffComplete: true }, drills: { drills: [item("scenarioId", "idp-outage", "passed")], independentWitnessComplete: true }
  };
  const evidence = Object.fromEntries(TENANT_ACTIVATION_DIMENSIONS.map((dimension) => { const value = { evidenceId: `e-${dimension}`, tenantId: tenant.tenantId, dimension, evidenceRef: `evidence://${dimension}`, observedAt, validUntil, mode: "simulated", commerciallyLive: false, payload: payloads[dimension] }; value.evidenceChecksumSha256 = checksumTenantActivationEvidence(value); return [dimension, value]; }));
  const body = { assessmentId: "assessment-api-1", selectedProductIds: ["personal-loan"], requiredIntegrationIds: ["kyc-provider"], requiredDeploymentComponentIds: ["api"], requiredSecurityControlIds: ["session-revocation"], requiredDrillScenarioIds: ["idp-outage"], evidence };
  response = await fetch(`${base}/admin/tenant-activation/assessments`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }); assert.equal(response.status, 201, await response.clone().text()); const result = await response.json(); assert.equal(result.assessment.status, "sandbox_ready"); assert.equal(result.activationAuthority, "platform_independent_approval_required");
  response = await fetch(`${base}/admin/tenant-activation/assessments`, { headers: { cookie } }); assert.equal(response.status, 200); assert.equal((await response.json()).assessments.length, 1);
});
