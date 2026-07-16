import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLoanOsServer } from "../apps/api/src/server.js";
import { loadState, saveState } from "../apps/api/src/file-store.js";
import { totpCode } from "../apps/api/src/identity.js";
import { JOURNEY_WORKSPACE_SCHEMAS } from "../packages/core/src/journey-workspace.js";
import { PRODUCT_TEMPLATE_CATALOGUE } from "../packages/core/src/product-template-catalogue.js";

const PASSWORD = "TenantAccessPass1!";
const MFA = "JBSWY3DPEHPK3PXP";
const H = "a".repeat(64);

test("composed journey API binds human actors, enforces four eyes and persists recovery across restart", async (t) => {
  const tenant = { tenantId: "tenant_composed_api", name: "Composed Bank", apiKey: "composed-api-key" };
  const otherTenant = { tenantId: "tenant_composed_other", name: "Other Bank", apiKey: "composed-other-api-key" };
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-composed-"));
  t.after(async () => { await rm(dataDir, { recursive: true, force: true }); });
  let server = await start(dataDir, [tenant, otherTenant]);
  let base = `http://127.0.0.1:${server.address().port}`;
  const cookies = {};

  for (const userId of ["maker", "checker"]) {
    let response = await fetch(`${base}/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": tenant.apiKey },
      body: JSON.stringify({ userId, email: `${userId}@composed.example`, displayName: userId, password: PASSWORD, mustChangePassword: false, adminRoles: ["tenant_admin"], mfaRequired: true, mfaEnabled: true, mfaSecret: MFA })
    });
    await expectStatus(response, 201);
    await response.text();
    response = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tenant.tenantId, email: `${userId}@composed.example`, password: PASSWORD, mfaCode: totpCode(MFA) })
    });
    await expectStatus(response, 200);
    cookies[userId] = response.headers.get("set-cookie").split(";", 1)[0];
    await response.text();
  }
  let response = await fetch(`${base}/admin/users`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": otherTenant.apiKey },
    body: JSON.stringify({ userId: "intruder", email: "intruder@other.example", displayName: "intruder", password: PASSWORD, mustChangePassword: false, adminRoles: ["tenant_admin"], mfaRequired: true, mfaEnabled: true, mfaSecret: MFA })
  });
  await expectStatus(response, 201);
  await response.text();
  response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: otherTenant.tenantId, email: "intruder@other.example", password: PASSWORD, mfaCode: totpCode(MFA) }) });
  await expectStatus(response, 200);
  cookies.intruder = response.headers.get("set-cookie").split(";", 1)[0];
  await response.text();

  const state = await loadState(dataDir);
  state.tenants[tenant.tenantId].tenantProductSubscriptions = {
    "subscription-composed": {
      subscriptionId: "subscription-composed",
      tenantId: tenant.tenantId,
      productTypes: ["personal_loan"],
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2030-01-01T00:00:00.000Z",
      status: "active"
    }
  };
  await saveState(state, dataDir);

  const createBody = {
    lifecycleId: "lifecycle-api-1",
    journeyType: "personal_loan",
    subjectRef: "borrower/synthetic-1",
    applicationRef: "application/synthetic-1",
    requestedAmountPaise: "10000",
    assignedPrincipalIds: ["maker", "checker"],
    idempotencyKey: "composed/create/1",
    createdBy: "body-supplied-attacker",
    lineage: {
      productTemplateRef: PRODUCT_TEMPLATE_CATALOGUE.personal_loan.templateId, productTemplateVersion: PRODUCT_TEMPLATE_CATALOGUE.personal_loan.version, productTemplateChecksumSha256: PRODUCT_TEMPLATE_CATALOGUE.personal_loan.templateChecksumSha256,
      workspaceSchemaId: JOURNEY_WORKSPACE_SCHEMAS.personal_loan.schemaId, workspaceSchemaVersion: 1, workspaceSchemaChecksumSha256: JOURNEY_WORKSPACE_SCHEMAS.personal_loan.schemaChecksumSha256,
      policyBundleRef: "policy/personal/v1", policyBundleVersion: 1, policyBundleChecksumSha256: H,
      workflowRef: "workflow/personal/v1", workflowVersion: 1, workflowChecksumSha256: H,
      accountingPolicyRef: "accounting/personal/v1", accountingPolicyVersion: 1, accountingPolicyChecksumSha256: H,
      tenantConfigurationRef: "tenant-config/v1", tenantConfigurationVersion: 1, tenantConfigurationChecksumSha256: H,
      accessGrantSnapshotRef: "access-grants/snapshot-1", accessGrantSnapshotChecksumSha256: H
    }
  };

  response = await post(base, "/admin/composed-journeys/instances", null, createBody, { "x-api-key": tenant.apiKey });
  assert.equal(response.status, 403, "service credentials cannot act as human lifecycle makers");
  await response.text();

  response = await post(base, "/admin/composed-journeys/instances", cookies.maker, createBody);
  await expectStatus(response, 201);
  let lifecycle = (await response.json()).lifecycle;
  assert.equal(lifecycle.createdBy, "maker");
  assert.equal(lifecycle.currentStage, "application_capture");

  response = await post(base, `/admin/composed-journeys/instances/${lifecycle.lifecycleId}/transitions`, cookies.intruder, {
    transitionId: "cross-tenant-probe", idempotencyKey: "cross-tenant-probe", expectedRevision: lifecycle.revision, expectedCurrentStage: "application_capture", targetStage: "kyc_aml",
    evidenceManifest: { sourceStateRef: lifecycle.stateRef, sourceStateChecksumSha256: lifecycle.stateChecksumSha256, artifacts: [{ kind: "workspace_submission", ref: "draft/synthetic-1", checksumSha256: H }, { kind: "consent", ref: "consent/synthetic-1", checksumSha256: H }, { kind: "application_snapshot", ref: "application/synthetic-1", checksumSha256: H }], financials: { requestedAmountPaise: "10000" } }
  });
  assert.equal(response.status, 404, "another tenant cannot resolve a lifecycle identifier");
  await response.text();

  response = await post(base, `/admin/composed-journeys/instances/${lifecycle.lifecycleId}/transitions`, cookies.maker, {
    transitionId: "transition-api-1",
    idempotencyKey: "composed/transition/1",
    expectedRevision: lifecycle.revision,
    expectedCurrentStage: "application_capture",
    targetStage: "kyc_aml",
    proposedBy: "body-supplied-attacker",
    evidenceManifest: {
      sourceStateRef: lifecycle.stateRef,
      sourceStateChecksumSha256: lifecycle.stateChecksumSha256,
      artifacts: [
        { kind: "workspace_submission", ref: "draft/synthetic-1", checksumSha256: H },
        { kind: "consent", ref: "consent/synthetic-1", checksumSha256: H },
        { kind: "application_snapshot", ref: "application/synthetic-1", checksumSha256: H }
      ],
      financials: { requestedAmountPaise: "10000" }
    }
  });
  await expectStatus(response, 201);
  const transition = (await response.json()).transition;
  assert.equal(transition.proposedBy, "maker");

  response = await post(base, `/admin/composed-journeys/transitions/${transition.transitionId}/approval`, cookies.maker, { approvedBy: "checker", approvalRef: "approval/self" });
  assert.equal(response.status, 422, "a maker cannot approve their own transition");
  await response.text();
  response = await post(base, `/admin/composed-journeys/transitions/${transition.transitionId}/approval`, cookies.checker, { approvedBy: "maker", approvalRef: "approval/checker" });
  await expectStatus(response, 200);
  lifecycle = (await response.json()).lifecycle;
  assert.equal(lifecycle.currentStage, "kyc_aml");

  response = await post(base, `/admin/composed-journeys/instances/${lifecycle.lifecycleId}/failures`, cookies.maker, {
    failureId: "failure-api-1",
    idempotencyKey: "composed/failure/1",
    expectedRevision: lifecycle.revision,
    failedOperation: "kyc_provider_verification",
    failureCode: "provider_result_unknown",
    failureMessage: "Synthetic provider outcome requires reconciliation.",
    recordedBy: "body-supplied-attacker",
    evidenceRef: "provider-attempt/synthetic-1",
    evidenceChecksumSha256: H,
    compensation: { mode: "manual_intervention", actionRef: "runbook/kyc-reconcile", ownerRole: "operator", dueAt: "2027-07-16T12:00:00.000Z" }
  });
  await expectStatus(response, 201);
  const failed = await response.json();
  lifecycle = failed.lifecycle;
  assert.equal(failed.failure.recordedBy, "maker");
  assert.equal(lifecycle.status, "paused");

  response = await post(base, `/admin/composed-journeys/instances/${lifecycle.lifecycleId}/resume`, cookies.maker, {
    transitionId: "resume-api-1",
    idempotencyKey: "composed/resume/1",
    expectedRevision: lifecycle.revision,
    blockerResolutionRefs: ["resolution/kyc-provider/synthetic-1"],
    purpose: "Resume after independently reconciled provider result.",
    resumedBy: "body-supplied-attacker"
  });
  await expectStatus(response, 201);
  const resumeRequest = (await response.json()).transition;
  assert.equal(resumeRequest.proposedBy, "maker");
  assert.equal(resumeRequest.actionType, "resume");
  response = await post(base, `/admin/composed-journeys/transitions/${resumeRequest.transitionId}/approval`, cookies.maker, { approvalRef: "approval/resume-self" });
  assert.equal(response.status, 422, "a recovery maker cannot approve their own resume");
  await response.text();
  response = await post(base, `/admin/composed-journeys/transitions/${resumeRequest.transitionId}/approval`, cookies.checker, { approvalRef: "approval/resume-checker" });
  await expectStatus(response, 200);
  lifecycle = (await response.json()).lifecycle;
  assert.equal(lifecycle.status, "active");
  assert.equal(lifecycle.currentStage, "kyc_aml");

  await close(server);
  server = await start(dataDir, [tenant, otherTenant]);
  t.after(async () => { await close(server); });
  base = `http://127.0.0.1:${server.address().port}`;
  response = await fetch(`${base}/admin/composed-journeys`, { headers: { cookie: cookies.checker } });
  await expectStatus(response, 200);
  const workspace = (await response.json()).workspace;
  assert.equal(workspace.lifecycles.length, 1);
  assert.equal(workspace.lifecycles[0].status, "active");
  assert.equal(workspace.transitions.length, 0);
  assert.equal(workspace.escalations.length, 0);

  const persisted = await loadState(dataDir);
  const tenantState = persisted.tenants[tenant.tenantId];
  assert.equal(tenantState.composedJourneyLifecycles["lifecycle-api-1"].createdBy, "maker");
  const domainEvents = tenantState.events.filter((event) => event.type.startsWith("composed_journey."));
  assert.equal(JSON.stringify(domainEvents).includes("borrower/synthetic-1"), false, "audit values exclude subject data");
  assert.equal(JSON.stringify(domainEvents).includes("10000"), false, "audit values exclude financial data");
});

async function post(base, path, cookie, body, headers = {}) {
  return fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) });
}
async function start(dataDir, tenants) { const server = createLoanOsServer({ dataDir, bootstrapTenants: tenants }); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); await fetch(`http://127.0.0.1:${server.address().port}/health`); return server; }
async function close(server) { if (!server?.listening) return; await new Promise((resolve) => server.close(resolve)); }
async function expectStatus(response, expected) { if (response.status === expected) return; assert.equal(response.status, expected, await response.clone().text()); }
