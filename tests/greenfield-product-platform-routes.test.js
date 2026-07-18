import test from "node:test";
import assert from "node:assert/strict";

import { routeBrandGovernance } from "../apps/api/src/routes/brand-governance.js";
import { routeProductPlatformAdministration } from "../apps/api/src/routes/product-platform-administration.js";
import {
  PRODUCT_JOURNEY_TYPES,
  createProductPlatformAdministrationState,
  proposePlatformTemplateVersion,
  publishPlatformTemplateVersion
} from "@loanos/core";

function context(store, { path, method = "GET", body = {}, actor = "admin_1", principalType = "tenant_user", url = path }) {
  const sent = {};
  return {
    sent,
    value: {
      method,
      path,
      req: { url },
      res: {},
      tenant: { tenantId: "tenant_a" },
      store,
      readJson: async () => body,
      sendJson: (_res, status, payload) => Object.assign(sent, { status, payload }),
      appendEvent: (state, event) => ({ ...state, events: [...(state.events ?? []), event] }),
      authContext: { principalType, roles: ["tenant_admin"], principalId: actor },
      hasTenantAdminRole: () => true,
      authActor: () => actor
    }
  };
}

function memoryStore(initial = {}) {
  let state = structuredClone(initial);
  return { load: async () => structuredClone(state), save: async (next) => { state = structuredClone(next); }, read: () => structuredClone(state) };
}

function seededAdministration() {
  let state = createProductPlatformAdministrationState();
  const proposed = proposePlatformTemplateVersion(state, { commandId: "template-propose", productType: "personal_loan", templateId: "product-journey/personal_loan", version: 1, specification: { contractVersion: 1 }, proposedBy: "platform_maker" });
  state = publishPlatformTemplateVersion(proposed.state, { commandId: "template-publish", productType: "personal_loan", version: 1, approvedBy: "platform_checker", approvalRef: "approval/template/1" }).state;
  return state;
}

function brandBody() {
  return {
    releaseId: "brand_1",
    version: 1,
    scope: { level: "tenant" },
    applicableJourneyTypes: PRODUCT_JOURNEY_TYPES,
    defaultLocale: "en",
    theme: { brandName: "Tenant Bank", primaryColor: "#123456", secondaryColor: "#234567", surfaceColor: "#ffffff", textColor: "#111111", fontFamily: "Inter, sans-serif" },
    legalIdentity: { regulatedEntityRef: "re_1", regulatedEntityName: "Tenant Bank Limited", registrationNumber: "RBI-001", entityType: "bank", grievanceOfficerName: "Officer", grievanceEmail: "help@tenant.test", grievancePhone: "+911140000000", privacyUrl: "https://tenant.test/privacy", termsUrl: "https://tenant.test/terms" },
    localizedContent: { en: { applicationTitle: "Apply", supportLabel: "Support", privacyLabel: "Privacy", termsLabel: "Terms", journeys: Object.fromEntries(PRODUCT_JOURNEY_TYPES.map((type) => [type, { displayName: type, shortDescription: `${type} description`, eligibilityGuidance: `${type} eligibility`, primaryActionLabel: "Apply" }])) } },
    channelOverlays: {},
    coBranding: [],
    assetManifest: { primaryLogo: "asset/logo", compactLogo: "asset/mark", favicon: "asset/icon" }
  };
}

test("tenant product administration route exposes canonical contracts and persists governed subscription", async () => {
  const store = memoryStore({ productPlatformAdministration: seededAdministration() });
  const subscription = context(store, { method: "POST", path: "/admin/product-platform/products/personal_loan/subscription", body: { commandId: "subscribe-1", templateVersion: 1, subscriptionRef: "subscription/1" } });
  assert.equal(await routeProductPlatformAdministration(subscription.value), true);
  assert.equal(subscription.sent.status, 201);
  assert.equal(subscription.sent.payload.product.productType, "personal_loan");
  const workspace = context(store, { path: "/admin/product-platform" });
  assert.equal(await routeProductPlatformAdministration(workspace.value), true);
  assert.equal(workspace.sent.status, 200);
  assert.equal(workspace.sent.payload.canonicalJourneyCount, 21);
  assert.equal(workspace.sent.payload.contracts.length, 21);
  assert.equal(workspace.sent.payload.products.length, 1);
});

test("brand governance route publishes independently approved release and resolves authenticated experience", async () => {
  const store = memoryStore({});
  const proposal = context(store, { method: "POST", path: "/admin/brand-governance/releases", body: brandBody(), actor: "brand_maker" });
  assert.equal(await routeBrandGovernance(proposal.value), true);
  assert.equal(proposal.sent.status, 201);
  const approval = context(store, { method: "POST", path: "/admin/brand-governance/releases/brand_1/approval", actor: "brand_checker" });
  await routeBrandGovernance(approval.value);
  assert.equal(approval.sent.status, 201);
  const publication = context(store, { method: "POST", path: "/admin/brand-governance/releases/brand_1/publication", actor: "brand_publisher" });
  await routeBrandGovernance(publication.value);
  assert.equal(publication.sent.status, 201);
  const experience = context(store, { path: "/brand-experience", actor: "borrower_1", principalType: "borrower", url: "/brand-experience?journeyType=gold_loan&channel=borrower&locale=en" });
  await routeBrandGovernance(experience.value);
  assert.equal(experience.sent.status, 200);
  assert.equal(experience.sent.payload.experience.theme.brandName, "Tenant Bank");
  assert.equal(experience.sent.payload.experience.legalIdentity.regulatedEntityName, "Tenant Bank Limited");
});

test("product and brand administration routes reject non-administrative identities", async () => {
  const store = memoryStore({});
  const product = context(store, { path: "/admin/product-platform", principalType: "borrower" });
  product.value.hasTenantAdminRole = () => false;
  await routeProductPlatformAdministration(product.value);
  assert.equal(product.sent.status, 403);
  const brand = context(store, { path: "/admin/brand-governance", principalType: "borrower" });
  brand.value.hasTenantAdminRole = () => false;
  await routeBrandGovernance(brand.value);
  assert.equal(brand.sent.status, 403);
});

test("product activation API requires a persisted authenticated proposal and independent checker", async () => {
  const store = memoryStore({ productPlatformAdministration: seededAdministration() });
  const direct = context(store, { method: "POST", path: "/admin/product-platform/products/personal_loan/activation", body: { commandId: "activate-direct", proposedBy: "untrusted_body_actor", approvalRef: "approval/1", activationRef: "activation/1" }, actor: "checker_1" });
  await routeProductPlatformAdministration(direct.value);
  assert.equal(direct.sent.status, 404);
  const proposal = context(store, { method: "POST", path: "/admin/product-platform/products/personal_loan/activation-proposal", body: { requestId: "activation-request-1", activationRef: "activation/1" }, actor: "maker_1" });
  await routeProductPlatformAdministration(proposal.value);
  assert.equal(proposal.sent.status, 201);
  const selfApproval = context(store, { method: "POST", path: "/admin/product-platform/products/personal_loan/activation", body: { commandId: "activate-1", approvalRef: "approval/1" }, actor: "maker_1" });
  await routeProductPlatformAdministration(selfApproval.value);
  assert.equal(selfApproval.sent.status, 403);
  assert.match(selfApproval.sent.payload.error.message, /independent/);
});
