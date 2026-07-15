import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLoanOsServer } from "../apps/api/src/server.js";
import {
  createEmptyState,
  ensureBootstrapTenants
} from "../apps/api/src/file-store.js";
import {
  DEMO_INTEGRATION_KEYS,
  DEMO_PERSONAS,
  DEMO_PRODUCT_ADMIN_ROLES,
  DEMO_SHOWCASE_PROFILE_ID,
  applyShowcaseDemoProfile,
  buildShowcaseDemoProfile,
  buildWorkshopTenantManifest,
  validateDemoProfile
} from "../packages/core/src/demo-system.js";
import { PRODUCT_JOURNEY_TYPES } from "../packages/core/src/product-journey-administration.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("showcase profile deterministically covers every journey, persona, grant, and mock integration", () => {
  const first = buildShowcaseDemoProfile();
  const second = buildShowcaseDemoProfile();
  const validation = validateDemoProfile(first);

  assert.deepEqual(first, second);
  assert.equal(validation.productCount, PRODUCT_JOURNEY_TYPES.length);
  assert.equal(validation.personaCount, DEMO_PERSONAS.length);
  assert.equal(
    validation.productAdminGrantCount,
    PRODUCT_JOURNEY_TYPES.length * DEMO_PRODUCT_ADMIN_ROLES.length
  );
  assert.equal(validation.integrationCount, DEMO_INTEGRATION_KEYS.length);
  assert.deepEqual(
    Object.values(first.productPolicies).map((product) => product.productType).sort(),
    [...PRODUCT_JOURNEY_TYPES].sort()
  );
});

test("showcase validation fails closed for live providers or shared engines", () => {
  const liveProvider = buildShowcaseDemoProfile();
  liveProvider.integrationPosture.bureau = "live";
  assert.throws(
    () => validateDemoProfile(liveProvider),
    (error) => error.code === "demo_integration_mode_invalid"
  );

  const sharedEngine = buildShowcaseDemoProfile();
  sharedEngine.engineBoundaries.businessDecisionEngine = "shared";
  assert.throws(
    () => validateDemoProfile(sharedEngine),
    (error) => error.code === "demo_engine_isolation_required"
  );
});

test("showcase application preserves operational state outside the governed demo catalogue", () => {
  const existing = {
    loanApplications: { app_existing: { applicationId: "app_existing", status: "draft" } },
    productPolicies: { custom_product: { productId: "custom_product", productType: "tenant_custom" } },
    regulatedEntities: {},
    tenantProductSubscriptions: {},
    productAdminGrants: {}
  };
  const applied = applyShowcaseDemoProfile(existing, buildShowcaseDemoProfile());

  assert.equal(applied.loanApplications.app_existing.status, "draft");
  assert.equal(applied.productPolicies.custom_product.productType, "tenant_custom");
  assert.equal(Object.values(applied.productPolicies).filter((product) => PRODUCT_JOURNEY_TYPES.includes(product.productType)).length, 21);
});

test("workshop manifest is synthetic, mock-only, and cannot reuse the showcase engine", () => {
  const manifest = buildWorkshopTenantManifest({ sessionId: "Acme Bank July 2026", name: "Acme Bank Workshop" });

  assert.equal(manifest.tenantId, "workshop-acme-bank-july-2026");
  assert.equal(manifest.tenantRequest.isSandbox, true);
  assert.equal(manifest.tenantRequest.syntheticOnly, true);
  assert.equal(manifest.tenantRequest.products.length, 1);
  assert.equal(manifest.tenantRequest.products[0].productType, "personal_loan");
  assert.equal(manifest.engineProvisioning.status, "required_before_decisioning");
  assert.equal(manifest.engineProvisioning.mayReuseShowcaseEngine, false);
  assert.equal(Object.values(manifest.integrationPosture).every((mode) => mode === "mock"), true);
});

test("bootstrap installs the governed showcase catalogue and all demo personas", async () => {
  let stored = createEmptyState();
  const loadStateFn = async () => stored;
  const saveStateFn = async (state) => { stored = state; };
  const tenant = {
    tenantId: "dev",
    name: "LoanOS Showcase",
    apiKey: "lsk_test_showcase",
    isSandbox: true,
    syntheticOnly: true,
    demoProfile: DEMO_SHOWCASE_PROFILE_ID
  };

  await ensureBootstrapTenants("memory", [tenant], { loadStateFn, saveStateFn });
  await ensureBootstrapTenants("memory", [tenant], { loadStateFn, saveStateFn });

  assert.equal(stored.controlPlane.tenants.dev.syntheticOnly, true);
  assert.equal(stored.controlPlane.tenants.dev.demoProfile, DEMO_SHOWCASE_PROFILE_ID);
  assert.equal(Object.values(stored.tenants.dev.productPolicies).filter((product) => PRODUCT_JOURNEY_TYPES.includes(product.productType)).length, 21);
  assert.equal(Object.keys(stored.tenants.dev.productAdminGrants).length, 105);
  assert.equal(Object.keys(stored.tenants.dev.tenantProductSubscriptions).length, 1);
  assert.deepEqual(
    DEMO_PERSONAS.map((persona) => persona.userId).filter((userId) => !stored.tenants.dev.users[userId]),
    []
  );
});

test("tenant API enforces sandbox status for synthetic demo profiles", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-demo-system-"));
  const server = createLoanOsServer({
    dataDir,
    platformAdminKey: "platform-admin-secret",
    allowDirectTenantProvisioning: true
  });
  await listen(server);
  t.after(async () => {
    await close(server);
    await rm(dataDir, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const headers = { "content-type": "application/json", "x-platform-admin-key": "platform-admin-secret" };

  const rejected = await fetch(`${baseUrl}/platform/tenants`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenantId: "workshop-unsafe",
      syntheticOnly: true,
      demoProfile: "workshop-v1"
    })
  });
  assert.equal(rejected.status, 422);
  assert.equal((await rejected.json()).error.code, "demo_tenant_requires_sandbox");

  const created = await fetch(`${baseUrl}/platform/tenants`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenantId: "workshop-safe",
      isSandbox: true,
      syntheticOnly: true,
      demoProfile: "workshop-v1"
    })
  });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.tenant.syntheticOnly, true);
  assert.equal(body.apiKey.startsWith("lsk_test_"), true);
});
