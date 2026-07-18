import test from "node:test";
import assert from "node:assert/strict";

import { routeBrandGovernance } from "../apps/api/src/routes/brand-governance.js";
import { routeProductPlatformAdministration } from "../apps/api/src/routes/product-platform-administration.js";
import { normalizeState } from "../apps/api/src/file-store.js";
import {
  PRODUCT_JOURNEY_TYPES,
  PRODUCT_READINESS_GATES,
  completeProvisioningHandover,
  createProductPlatformAdministrationState,
  planTenantProvisioningSaga,
  proposePlatformTemplateVersion,
  publishPlatformTemplateVersion,
  reconcileProvisioningSaga,
  subscribeTenantProduct
} from "@loanos/core";
import { STEP_BLUEPRINTS } from "@loanos/core/platform/tenant-provisioning-saga.js";

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

function laterProductState() {
  let state = seededAdministration();
  const proposed = proposePlatformTemplateVersion(state, { commandId: "template-propose-gold", productType: "gold_loan", templateId: "product-journey/gold_loan", version: 1, specification: { contractVersion: 1 }, proposedBy: "platform_maker" });
  state = publishPlatformTemplateVersion(proposed.state, { commandId: "template-publish-gold", productType: "gold_loan", version: 1, approvedBy: "platform_checker", approvalRef: "approval/template/gold/1" }).state;
  state = subscribeTenantProduct(state, { commandId: "initial-personal", tenantId: "tenant_a", productType: "personal_loan", templateVersion: 1, subscriptionRef: "subscription/initial", subscribedBy: "tenant_owner" }).state;
  state.products["tenant_a:personal_loan"].status = "active";
  return state;
}

function authoritativeProductStaffing(tenantId = "tenant_a", productType = "gold_loan", version = 1) {
  const principals = ["admin_1", "product_maker", "product_checker"];
  const saasPrincipals = Object.fromEntries(principals.map((principalId) => [`${tenantId}:${principalId}`, { tenantId, principalId, principalType: "human", status: "active", emailVerified: true, mfaEnrolled: true }]));
  const roles = [["grant-admin", "admin_1", "tenant_admin"], ["grant-product-maker", "product_maker", "product_manager"], ["grant-product-checker", "product_checker", "product_checker"]];
  const saasRoleGrants = Object.fromEntries(roles.map(([grantId, principalId, roleId]) => [grantId, { grantId, tenantId, principalId, roleId, scope: { type: "product", id: productType }, status: "active", effectiveFrom: "2026-01-01T00:00:00.000Z", validUntil: null, approvedBy: "access_checker", approvalRef: `approval/${grantId}` }]));
  const tenantFeatureStaffingConfigs = { [tenantId]: { tenantId, version, features: ["FST-002", "FST-030"].map((featureId) => ({ featureId, scope: { type: "product", id: productType }, requestedStatus: "enabled" })) } };
  return { saasPrincipals, saasRoleGrants, tenantFeatureStaffingConfigs };
}

function completedAddProductSaga(tenantId = "tenant_a", sagaId = "add-gold-1") {
  const now = new Date("2026-07-18T10:00:00.000Z");
  let saga = planTenantProvisioningSaga({ tenantId, sagaId, idempotencyKey: `${sagaId}-key`, mode: "add_product", requestedProducts: ["gold_loan"], activeProductsSnapshot: ["personal_loan"], createdBy: "tenant_admin" }, now);
  saga = reconcileProvisioningSaga(saga, { tenantId, sagaId, reconciledBy: "provisioning_worker", checkpoints: STEP_BLUEPRINTS.map(([stepId], index) => ({ stepId, checkpointRef: `checkpoint/${stepId}`, evidenceChecksumSha256: String(index + 1).padStart(64, "0") })) }, now);
  return completeProvisioningHandover(saga, { tenantId, sagaId, operationsEvidenceRef: "evidence/operations", securityEvidenceRef: "evidence/security", financeEvidenceRef: "evidence/finance", complianceEvidenceRef: "evidence/compliance", uatEvidenceRef: "evidence/uat", handoverBy: "provisioning_maker", acceptedBy: "provisioning_checker", approvalRef: "approval/handover" }, now);
}

function completeProductConfiguration(productType, staffingGrant) {
  return {
    regulatedEntityRefs: ["re/bank"], channels: ["branch"], productPolicyRef: `policy/${productType}`, decisionBundleRef: `decision/${productType}`, accountingProfileRef: `accounting/${productType}`, complianceProfileRef: `compliance/${productType}`, providerProfileRefs: ["provider/kyc"], documentPackRef: `documents/${productType}`,
    staffingGrants: [{ grantId: staffingGrant.grantId, principalId: staffingGrant.principalId, roles: [staffingGrant.roleId], scopeRefs: [`product/${productType}`], evidenceRef: staffingGrant.approvalRef }], programmeRefs: [],
    whiteLabelBinding: { brandVersionRef: "brand/1", legalEntityDisclosureRef: "legal/1", localeRefs: ["en-IN"], communicationTemplateSetRef: "communications/1", documentTemplateSetRef: "documents/1" },
    readinessEvidence: Object.fromEntries(PRODUCT_READINESS_GATES.map((gate) => [gate, `evidence/${gate}`])), effectiveFrom: "2026-07-01T00:00:00.000Z", effectiveTo: null
  };
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
  assert.equal(workspace.sent.payload.formSchemaVersion, 1);
  const detail = context(store, { path: "/admin/product-platform/products/personal_loan" });
  await routeProductPlatformAdministration(detail.value);
  assert.deepEqual(detail.sent.payload.history.map((item) => item.action), ["subscribed"]);
  assert.ok(detail.sent.payload.documents.some((item) => item.key === "subscription"));
  assert.deepEqual(detail.sent.payload.nextActions.filter((item) => item.enabled).map((item) => item.action), ["configuration"]);
  const history = context(store, { path: "/admin/product-platform/products/personal_loan/history" });
  await routeProductPlatformAdministration(history.value);
  assert.deepEqual(history.sent.payload.history.map((item) => item.action), ["subscribed"]);
  const documents = context(store, { path: "/admin/product-platform/products/personal_loan/documents" });
  await routeProductPlatformAdministration(documents.value);
  assert.ok(documents.sent.payload.documents.some((item) => item.reference === "subscription/1"));
});

test("later-product subscription requires completed compensated-saga boundary, authoritative staffing and independent approval", async () => {
  const saga = completedAddProductSaga();
  const store = memoryStore({ productPlatformAdministration: laterProductState(), tenantProvisioningSagas: { [saga.sagaId]: saga }, ...authoritativeProductStaffing() });

  const direct = context(store, { method: "POST", path: "/admin/product-platform/products/gold_loan/subscription", body: { commandId: "direct", templateVersion: 1, subscriptionRef: "subscription/gold" }, actor: "product_maker" });
  await routeProductPlatformAdministration(direct.value);
  assert.equal(direct.sent.status, 404);
  assert.equal(direct.sent.payload.error.code, "product_admin_transition_not_found");

  const proposal = context(store, { method: "POST", path: "/admin/product-platform/products/gold_loan/subscription-proposal", body: { requestId: "add-gold-request", sagaId: saga.sagaId, templateVersion: 1, subscriptionRef: "subscription/gold" }, actor: "product_maker" });
  await routeProductPlatformAdministration(proposal.value);
  assert.equal(proposal.sent.status, 201);
  assert.equal(proposal.sent.payload.request.payload.provisioningLineage.scopeChecksumSha256, saga.handover.scopeChecksumSha256);
  assert.equal(proposal.sent.payload.request.payload.staffingLineage.configurationVersion, 1);

  const approvalForm = context(store, { path: "/admin/product-platform/products/gold_loan/form-schema", url: "/admin/product-platform/products/gold_loan/form-schema?action=subscription" });
  await routeProductPlatformAdministration(approvalForm.value);
  assert.deepEqual(approvalForm.sent.payload.formSchema.fields.map((field) => field.name), ["commandId"]);

  const selfApproval = context(store, { method: "POST", path: "/admin/product-platform/products/gold_loan/subscription", body: { commandId: "approve-add-gold" }, actor: "product_maker" });
  await routeProductPlatformAdministration(selfApproval.value);
  assert.equal(selfApproval.sent.status, 403);

  const approval = context(store, { method: "POST", path: "/admin/product-platform/products/gold_loan/subscription", body: { commandId: "approve-add-gold", templateVersion: 999, subscriptionRef: "untrusted/override" }, actor: "product_checker" });
  await routeProductPlatformAdministration(approval.value);
  assert.equal(approval.sent.status, 201);
  assert.equal(approval.sent.payload.product.provisioningLineage.sagaId, saga.sagaId);
  assert.equal(approval.sent.payload.product.staffingLineage.configurationVersion, 1);
  assert.equal(approval.sent.payload.product.templateVersion, 1);
  assert.equal(approval.sent.payload.product.subscriptionRef, "subscription/gold");
  assert.equal(store.read().productPlatformTransitionRequests?.["tenant_a:gold_loan:subscription:product"], undefined);
});

test("later-product approval fails closed when staffing lineage changes or saga belongs to another tenant", async () => {
  const foreignSaga = completedAddProductSaga("tenant_b", "foreign-add-gold");
  const foreignStore = memoryStore({ productPlatformAdministration: laterProductState(), tenantProvisioningSagas: { [foreignSaga.sagaId]: foreignSaga }, ...authoritativeProductStaffing() });
  const foreign = context(foreignStore, { method: "POST", path: "/admin/product-platform/products/gold_loan/subscription-proposal", body: { requestId: "foreign", sagaId: foreignSaga.sagaId, templateVersion: 1, subscriptionRef: "subscription/gold" } });
  await routeProductPlatformAdministration(foreign.value);
  assert.equal(foreign.sent.status, 404);
  assert.equal(foreign.sent.payload.error.code, "product_admin_provisioning_saga_not_found");

  const saga = completedAddProductSaga();
  const store = memoryStore({ productPlatformAdministration: laterProductState(), tenantProvisioningSagas: { [saga.sagaId]: saga }, ...authoritativeProductStaffing() });
  const proposal = context(store, { method: "POST", path: "/admin/product-platform/products/gold_loan/subscription-proposal", body: { requestId: "stale", sagaId: saga.sagaId, templateVersion: 1, subscriptionRef: "subscription/gold" }, actor: "product_maker" });
  await routeProductPlatformAdministration(proposal.value);
  const changed = store.read();
  changed.tenantFeatureStaffingConfigs.tenant_a.version = 2;
  await store.save(changed);
  const approval = context(store, { method: "POST", path: "/admin/product-platform/products/gold_loan/subscription", body: { commandId: "stale-approval" }, actor: "product_checker" });
  await routeProductPlatformAdministration(approval.value);
  assert.equal(approval.sent.status, 409);
  assert.equal(approval.sent.payload.error.code, "product_admin_staffing_lineage_stale");
});

test("configuration and approval bind declared staffing references to current authoritative IAM resources", async () => {
  const administration = seededAdministration();
  const subscribed = subscribeTenantProduct(administration, { commandId: "initial", tenantId: "tenant_a", productType: "personal_loan", templateVersion: 1, subscriptionRef: "subscription/personal", subscribedBy: "tenant_owner" }).state;
  const authority = authoritativeProductStaffing("tenant_a", "personal_loan");
  const staffingGrant = authority.saasRoleGrants["grant-product-maker"];
  const store = memoryStore({ productPlatformAdministration: subscribed, ...authority });
  const configuration = context(store, { method: "POST", path: "/admin/product-platform/products/personal_loan/configuration", body: { commandId: "configuration-1", configuration: completeProductConfiguration("personal_loan", staffingGrant) }, actor: "product_maker" });
  await routeProductPlatformAdministration(configuration.value);
  assert.equal(configuration.sent.status, 201);
  assert.equal(configuration.sent.payload.product.administrationAuthority.configurationVersion, 1);
  assert.equal(configuration.sent.payload.product.administrationAuthority.grants[0].grantId, staffingGrant.grantId);

  const revoked = store.read();
  revoked.saasRoleGrants[staffingGrant.grantId].status = "revoked";
  await store.save(revoked);
  const approval = context(store, { method: "POST", path: "/admin/product-platform/products/personal_loan/approval", body: { commandId: "approve-configuration", approvalRef: "approval/configuration" }, actor: "product_checker" });
  await routeProductPlatformAdministration(approval.value);
  assert.equal(approval.sent.status, 422);
  assert.equal(approval.sent.payload.error.code, "product_admin_authoritative_staffing_incomplete");
});

test("file-state normalization preserves product administration, pending approvals and provisioning sagas", () => {
  const saga = completedAddProductSaga();
  const productPlatformAdministration = laterProductState();
  const productPlatformTransitionRequests = { "tenant_a:gold_loan:subscription:product": { tenantId: "tenant_a", productType: "gold_loan", target: "subscription", status: "pending_approval" } };
  const normalized = normalizeState({ tenants: { tenant_a: { productPlatformAdministration, productPlatformTransitionRequests, tenantProvisioningSagas: { [saga.sagaId]: saga } } } });
  assert.equal(normalized.tenants.tenant_a.productPlatformAdministration.products["tenant_a:personal_loan"].status, "active");
  assert.equal(normalized.tenants.tenant_a.productPlatformTransitionRequests["tenant_a:gold_loan:subscription:product"].status, "pending_approval");
  assert.equal(normalized.tenants.tenant_a.tenantProvisioningSagas[saga.sagaId].handover.approvalRef, "approval/handover");
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

test("product administration detail and server-versioned forms are canonical and tenant isolated", async () => {
  const administration = seededAdministration();
  administration.products["tenant_b:personal_loan"] = { tenantId: "tenant_b", productType: "personal_loan", status: "subscribed", configurationVersion: 0, configuration: null, history: [], subscriptionRef: "subscription/tenant-b", templateChecksumSha256: "tenant-b-checksum" };
  const store = memoryStore({ productPlatformAdministration: administration });
  const detail = context(store, { path: "/admin/product-platform/products/personal_loan" });
  await routeProductPlatformAdministration(detail.value);
  assert.equal(detail.sent.status, 200);
  assert.equal(detail.sent.payload.tenantId, "tenant_a");
  assert.equal(detail.sent.payload.product, null);
  assert.deepEqual(detail.sent.payload.nextActions.map((item) => item.action), ["subscription"]);
  assert.doesNotMatch(JSON.stringify(detail.sent.payload), /subscription\/tenant-b/);

  const schema = context(store, { path: "/admin/product-platform/products/personal_loan/form-schema", url: "/admin/product-platform/products/personal_loan/form-schema?action=configuration" });
  await routeProductPlatformAdministration(schema.value);
  assert.equal(schema.sent.status, 200);
  assert.equal(schema.sent.payload.formSchema.schemaVersion, 1);
  assert.equal(schema.sent.payload.formSchema.productType, "personal_loan");
  assert.ok(schema.sent.payload.formSchema.fields.some((field) => field.name === "configuration.staffingGrants"));

  const unknown = context(store, { path: "/admin/product-platform/products/legacy_personal" });
  await routeProductPlatformAdministration(unknown.value);
  assert.equal(unknown.sent.status, 422);
  assert.equal(unknown.sent.payload.error.code, "product_admin_unknown_product");
});
