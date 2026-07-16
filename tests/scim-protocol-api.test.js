import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFederationPolicy, certifyFederationPolicy } from "../packages/core/src/enterprise-identity.js";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { loadState, saveState } from "../apps/api/src/file-store.js";
import { createComposedJourneyInstance } from "../packages/core/src/composed-journey-lifecycle.js";
import { JOURNEY_WORKSPACE_SCHEMAS } from "../packages/core/src/journey-workspace.js";
import { PRODUCT_TEMPLATE_CATALOGUE } from "../packages/core/src/product-template-catalogue.js";

test("SCIM 2.0 service surface is tenant-scoped, idempotent and deactivates immediately", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-scim-")); const tenant = { tenantId: "tenant_scim", name: "SCIM Bank", apiKey: "scim-service-key" };
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`; await fetch(`${base}/health`);
  let state = await loadState(dataDir); const now = new Date();
  const draft = createFederationPolicy({}, { policyId: "idp-scim", providerType: "entra_id", protocol: "oidc", issuer: "https://idp.bank.in", metadataUrl: "https://idp.bank.in/.well-known/openid-configuration", audience: "loanos-scim", allowedDomains: ["bank.in"], groupMappings: { lending: { adminRoles: ["operator"], roles: ["loan_officer"], canonicalRoleIds: ["loan_officer"], queues: ["origination"] } }, pkceRequired: true, mfaRequired: true, owner: "iam-owner", proposedBy: "iam-maker" }, now);
  const certified = certifyFederationPolicy(draft.registry, "idp-scim", { approvedBy: "iam-checker", approvalRef: "approval-1", metadataChecksumSha256: createHash("sha256").update("metadata").digest("hex"), metadataValidUntil: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(), loginTestRef: "login-test", logoutTestRef: "logout-test", mfaTestRef: "mfa-test" }, now);
  state.tenants[tenant.tenantId].federationPolicies = certified.registry; await saveState(state, dataDir);
  const headers = { "content-type": "application/scim+json", "x-api-key": tenant.apiKey, "x-loanos-federation-policy": "idp-scim", "idempotency-key": "scim-create-1" };
  let response = await fetch(`${base}/scim/v2/Users`, { method: "POST", headers, body: JSON.stringify({ schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], externalId: "employee-1", userName: "user@bank.in", displayName: "Bank User", active: true, groups: [{ value: "lending" }] }) });
  assert.equal(response.status, 201, await response.clone().text()); assert.match(response.headers.get("content-type"), /application\/scim\+json/); const created = await response.json(); assert.equal(created.active, true);
  response = await fetch(`${base}/scim/v2/Users`, { method: "POST", headers, body: JSON.stringify({ schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], externalId: "employee-1", userName: "user@bank.in", displayName: "Bank User", active: true, groups: [{ value: "lending" }] }) });
  assert.equal(response.status, 200, await response.clone().text());
  response = await fetch(`${base}/scim/v2/Users?filter=${encodeURIComponent('userName eq "user@bank.in"')}`, { headers: { "x-api-key": tenant.apiKey } });
  assert.equal(response.status, 200); assert.equal((await response.json()).totalResults, 1);
  state = await loadState(dataDir);
  const activeUser = Object.values(state.tenants[tenant.tenantId].users).find((candidate) => candidate.federationExternalId === "employee-1");
  const tenantState = state.tenants[tenant.tenantId], H = "a".repeat(64), template = PRODUCT_TEMPLATE_CATALOGUE.personal_loan, schema = JOURNEY_WORKSPACE_SCHEMAS.personal_loan;
  tenantState.tenantProductSubscriptions = { "subscription-scim": { subscriptionId: "subscription-scim", tenantId: tenant.tenantId, productTypes: ["personal_loan"], effectiveFrom: "2026-01-01T00:00:00.000Z", validUntil: "2030-01-01T00:00:00.000Z", status: "active" } };
  const lifecycle = createComposedJourneyInstance(tenantState, {
    tenantId: tenant.tenantId, lifecycleId: "lifecycle-scim-1", journeyType: "personal_loan", subjectRef: "subject/synthetic-1", applicationRef: "application/synthetic-1", requestedAmountPaise: "10000", assignedPrincipalIds: [activeUser.userId, "checker-1"], idempotencyKey: "composed/scim/1", createdBy: activeUser.userId,
    lineage: {
      productTemplateRef: template.templateId, productTemplateVersion: template.version, productTemplateChecksumSha256: template.templateChecksumSha256,
      workspaceSchemaId: schema.schemaId, workspaceSchemaVersion: schema.schemaVersion, workspaceSchemaChecksumSha256: schema.schemaChecksumSha256,
      policyBundleRef: "policy/personal/v1", policyBundleVersion: 1, policyBundleChecksumSha256: H,
      workflowRef: "workflow/personal/v1", workflowVersion: 1, workflowChecksumSha256: H,
      accountingPolicyRef: "accounting/personal/v1", accountingPolicyVersion: 1, accountingPolicyChecksumSha256: H,
      tenantConfigurationRef: "tenant-config/v1", tenantConfigurationVersion: 1, tenantConfigurationChecksumSha256: H,
      accessGrantSnapshotRef: "access/snapshot-1", accessGrantSnapshotChecksumSha256: H
    }
  }, now.toISOString());
  state.tenants[tenant.tenantId] = lifecycle.state;
  state.controlPlane.sessions["federated-session-1"] = { sessionId: "federated-session-1", tokenHash: "test-token", principalType: "tenant_user", tenantId: tenant.tenantId, userId: activeUser.userId, email: activeUser.email, roles: [], status: "active", authenticationSource: "federated", federationPolicyId: "idp-scim", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), lastSeenAt: now.toISOString(), revokedAt: null };
  await saveState(state, dataDir);
  response = await fetch(`${base}/scim/v2/Users/employee-1`, { method: "PATCH", headers: { "content-type": "application/scim+json", "x-api-key": tenant.apiKey, "idempotency-key": "scim-deactivate-1" }, body: JSON.stringify({ schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "Replace", path: "active", value: false }] }) });
  assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).active, false);
  state = await loadState(dataDir); const user = Object.values(state.tenants[tenant.tenantId].users).find((candidate) => candidate.federationExternalId === "employee-1");
  assert.equal(user.status, "inactive"); assert.equal(state.tenants[tenant.tenantId].saasPrincipals[`${tenant.tenantId}:${user.userId}`].status, "suspended");
  assert.equal(state.controlPlane.sessions["federated-session-1"].status, "revoked");
  assert.match(state.controlPlane.sessions["federated-session-1"].revocationReason, /SCIM deactivation/);
  assert.equal(state.tenants[tenant.tenantId].composedJourneyLifecycles["lifecycle-scim-1"].status, "paused");
  assert.equal(Object.values(state.tenants[tenant.tenantId].composedJourneyEscalations).filter((item) => item.lifecycleId === "lifecycle-scim-1" && item.status === "open").length, 1);
});
