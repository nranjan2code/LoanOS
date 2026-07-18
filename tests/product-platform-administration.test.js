import test from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_JOURNEY_TYPES } from "@loanos/core/journeys/product-journey-administration.js";
import {
  PRODUCT_READINESS_GATES,
  activateTenantProduct,
  administerTenantProgramme,
  approveTenantProductConfiguration,
  assessTenantProductReadiness,
  createProductPlatformAdministrationState,
  diffTenantProductConfigurations,
  getProductAdministrationFormSchema,
  projectTenantProductDocuments,
  projectTenantProductLifecycleHistory,
  projectTenantProductNextActions,
  proposePlatformTemplateVersion,
  proposeTenantProductConfiguration,
  publishPlatformTemplateVersion,
  retireTenantProduct,
  subscribeTenantProduct,
  suspendTenantProduct
} from "@loanos/core/platform/product-platform-administration.js";

const NOW = new Date("2026-07-16T10:00:00.000Z");
const cmd = (commandId, rest = {}) => ({ commandId, ...rest });
const evidence = (suffix = "1") => Object.fromEntries(PRODUCT_READINESS_GATES.map((gate) => [gate, `evidence://${gate}/${suffix}`]));
function configuration(type, overrides = {}) {
  return {
    regulatedEntityRefs: ["re://bank-1"], channels: ["branch", "customer", "operations"],
    productPolicyRef: `policy://${type}/1`, decisionBundleRef: `decision://${type}/1`, accountingProfileRef: `accounting://${type}/1`,
    complianceProfileRef: `compliance://${type}/1`, providerProfileRefs: ["provider://kyc/1"], documentPackRef: `documents://${type}/1`,
    staffingGrants: [{ grantId: "grant-1", principalId: "staff-1", roles: ["product_manager", "operations_checker"], scopeRefs: [`product://${type}`], evidenceRef: "evidence://staffing/1" }],
    programmeRefs: [],
    whiteLabelBinding: { brandVersionRef: "brand://bank/3", legalEntityDisclosureRef: "legal://bank/2", localeRefs: ["locale://en-IN", "locale://hi-IN"], communicationTemplateSetRef: "communications://bank/5", documentTemplateSetRef: "documents-brand://bank/4" },
    readinessEvidence: evidence(), effectiveFrom: "2026-07-16T00:00:00.000Z", effectiveTo: null, ...overrides
  };
}
function publish(state, type, version = 1) {
  let r = proposePlatformTemplateVersion(state, cmd(`propose-${type}-${version}`, { templateId: `template-${type}`, productType: type, version, specification: { productType: type, schemaRef: `schema://${type}/1`, lifecycleRef: `lifecycle://${type}/1` }, proposedBy: "platform-maker" }), NOW);
  return publishPlatformTemplateVersion(r.state, cmd(`publish-${type}-${version}`, { productType: type, version, approvedBy: "platform-checker", approvalRef: `approval://${type}/${version}` }), NOW);
}
function subscribe(state, tenantId, type, version = 1) {
  return subscribeTenantProduct(state, cmd(`subscribe-${tenantId}-${type}`, { tenantId, productType: type, templateVersion: version, subscriptionRef: `subscription://${tenantId}/${type}`, subscribedBy: "tenant-owner" }), NOW);
}

test("all 21 canonical products publish, subscribe, configure, approve and activate independently", () => {
  assert.equal(PRODUCT_JOURNEY_TYPES.length, 21);
  let state = createProductPlatformAdministrationState();
  for (const type of PRODUCT_JOURNEY_TYPES) state = publish(state, type).state;
  for (const type of PRODUCT_JOURNEY_TYPES) {
    state = subscribe(state, "tenant-a", type).state;
    let result = proposeTenantProductConfiguration(state, cmd(`configure-${type}`, { tenantId: "tenant-a", productType: type, configuration: configuration(type), proposedBy: "product-maker" }), NOW);
    state = result.state;
    assert.deepEqual(result.readiness.gaps, [], `${type} must have an explicit complete configuration`);
    result = approveTenantProductConfiguration(state, cmd(`approve-${type}`, { tenantId: "tenant-a", productType: type, approvedBy: "product-checker", approvalRef: `approval://configuration/${type}` }), NOW);
    state = result.state;
    result = activateTenantProduct(state, cmd(`activate-${type}`, { tenantId: "tenant-a", productType: type, proposedBy: "operations-maker", approvedBy: "operations-checker", approvalRef: `approval://activation/${type}`, activationRef: `activation://${type}` }), NOW);
    state = result.state;
    assert.equal(result.product.status, "active", type);
    assert.equal(result.product.configuration.whiteLabelBinding.localeRefs.length, 2, type);
  }
  assert.equal(Object.keys(state.templates).length, 21);
  assert.equal(Object.keys(state.products).length, 21);
});

test("unknown products and unpublished versions fail closed", () => {
  const state = createProductPlatformAdministrationState();
  assert.throws(() => proposePlatformTemplateVersion(state, cmd("bad-type", { templateId: "template-bad", productType: "invented_loan", version: 1, specification: {}, proposedBy: "maker" }), NOW), (e) => e.code === "product_admin_unknown_product");
  assert.throws(() => subscribeTenantProduct(state, cmd("no-template", { tenantId: "tenant-a", productType: "personal_loan", templateVersion: 1, subscriptionRef: "subscription://1", subscribedBy: "owner" }), NOW), (e) => e.code === "product_admin_template_unavailable");
});

test("platform and tenant approvals require independent humans", () => {
  let state = createProductPlatformAdministrationState();
  const proposed = proposePlatformTemplateVersion(state, cmd("template-proposal", { templateId: "template-personal", productType: "personal_loan", version: 1, specification: { schema: "schema://1" }, proposedBy: "same-user" }), NOW);
  assert.throws(() => publishPlatformTemplateVersion(proposed.state, cmd("template-self-approval", { productType: "personal_loan", version: 1, approvedBy: "same-user", approvalRef: "approval://1" }), NOW), (e) => e.code === "product_admin_four_eyes_required");
  state = publish(createProductPlatformAdministrationState(), "personal_loan").state;
  state = subscribe(state, "tenant-a", "personal_loan").state;
  const configured = proposeTenantProductConfiguration(state, cmd("configuration-proposal", { tenantId: "tenant-a", productType: "personal_loan", configuration: configuration("personal_loan"), proposedBy: "same-user" }), NOW);
  assert.throws(() => approveTenantProductConfiguration(configured.state, cmd("configuration-self-approval", { tenantId: "tenant-a", productType: "personal_loan", approvedBy: "same-user", approvalRef: "approval://2" }), NOW), (e) => e.code === "product_admin_four_eyes_required");
});

test("tenant isolation is exact even when product IDs match", () => {
  let state = publish(createProductPlatformAdministrationState(), "gold_loan").state;
  state = subscribe(state, "tenant-a", "gold_loan").state;
  assert.throws(() => proposeTenantProductConfiguration(state, cmd("cross-tenant", { tenantId: "tenant-b", productType: "gold_loan", configuration: configuration("gold_loan"), proposedBy: "maker" }), NOW), (e) => e.code === "product_admin_product_not_found");
  state = subscribe(state, "tenant-b", "gold_loan").state;
  state = proposeTenantProductConfiguration(state, cmd("tenant-b-config", { tenantId: "tenant-b", productType: "gold_loan", configuration: configuration("gold_loan", { productPolicyRef: "policy://tenant-b/gold" }), proposedBy: "maker-b" }), NOW).state;
  assert.equal(state.products["tenant-a:gold_loan"].configuration, null);
  assert.equal(state.products["tenant-b:gold_loan"].configuration.productPolicyRef, "policy://tenant-b/gold");
});

test("readiness requires every gate, staffing scope and complete white-label binding", () => {
  let state = publish(createProductPlatformAdministrationState(), "home_loan").state;
  state = subscribe(state, "tenant-a", "home_loan").state;
  const input = configuration("home_loan"); delete input.readinessEvidence.rollback_plan;
  assert.throws(() => proposeTenantProductConfiguration(state, cmd("missing-gate", { tenantId: "tenant-a", productType: "home_loan", configuration: input, proposedBy: "maker" }), NOW), (e) => e.code === "product_admin_invalid");
  const product = state.products["tenant-a:home_loan"];
  const assessment = assessTenantProductReadiness(product, state, NOW);
  assert.equal(assessment.complete, false);
  assert.deepEqual(assessment.gaps, ["configuration"]);
});

test("programme administration is tenant-local, governed and type-bound", () => {
  let state = createProductPlatformAdministrationState();
  let result = administerTenantProgramme(state, cmd("programme-create", { tenantId: "tenant-a", programmeId: "anchor-programme-1", productType: "supply_chain_finance", participantRefs: ["anchor://1", "lender://1"], configuration: { allocationRuleRef: "allocation://1", settlementRuleRef: "settlement://1" }, proposedBy: "programme-maker", approvedBy: "programme-checker", approvalRef: "approval://programme/1" }), NOW);
  state = result.state;
  assert.equal(result.programme.status, "active");
  assert.throws(() => administerTenantProgramme(state, cmd("programme-type-change", { tenantId: "tenant-a", programmeId: "anchor-programme-1", productType: "co_lending_programme", participantRefs: ["lender://2"], configuration: {}, proposedBy: "maker", approvedBy: "checker", approvalRef: "approval://2" }), NOW), (e) => e.code === "product_admin_programme_type_immutable");
  state = publish(state, "supply_chain_finance").state;
  state = subscribe(state, "tenant-a", "supply_chain_finance").state;
  const configured = proposeTenantProductConfiguration(state, cmd("programme-bound-config", { tenantId: "tenant-a", productType: "supply_chain_finance", configuration: configuration("supply_chain_finance", { programmeRefs: ["anchor-programme-1"] }), proposedBy: "maker" }), NOW);
  assert.equal(configured.readiness.complete, true);
  state = subscribe(publish(configured.state, "personal_loan").state, "tenant-a", "personal_loan").state;
  assert.throws(() => proposeTenantProductConfiguration(state, cmd("wrong-programme-type", { tenantId: "tenant-a", productType: "personal_loan", configuration: configuration("personal_loan", { programmeRefs: ["anchor-programme-1"] }), proposedBy: "maker" }), NOW), (e) => e.code === "product_admin_programme_type_mismatch");
});

test("configuration history provides deterministic field-level diffs", () => {
  let state = publish(createProductPlatformAdministrationState(), "msme_working_capital").state;
  state = subscribe(state, "tenant-a", "msme_working_capital").state;
  state = proposeTenantProductConfiguration(state, cmd("config-v1", { tenantId: "tenant-a", productType: "msme_working_capital", configuration: configuration("msme_working_capital"), proposedBy: "maker" }), NOW).state;
  const changed = configuration("msme_working_capital", { channels: ["branch", "customer", "operations", "partner"], productPolicyRef: "policy://msme_working_capital/2" });
  const result = proposeTenantProductConfiguration(state, cmd("config-v2", { tenantId: "tenant-a", productType: "msme_working_capital", configuration: changed, proposedBy: "maker" }), NOW);
  const diff = diffTenantProductConfigurations(result.product, 1, 2);
  assert.deepEqual(diff.changes.map((x) => x.path), ["channels", "productPolicyRef"]);
  assert.equal(result.product.configurationVersion, 2);
});

test("commands are idempotent and command ID reuse with other input is rejected", () => {
  const state = createProductPlatformAdministrationState();
  const input = cmd("idempotent-template", { templateId: "template-personal", productType: "personal_loan", version: 1, specification: { schema: "schema://1" }, proposedBy: "maker" });
  const first = proposePlatformTemplateVersion(state, input, NOW);
  const replay = proposePlatformTemplateVersion(first.state, input, NOW);
  assert.equal(replay.idempotentReplay, true);
  assert.deepEqual(replay.template, first.template);
  assert.equal(Object.keys(replay.state.templates).length, 1);
  assert.throws(() => proposePlatformTemplateVersion(first.state, { ...input, specification: { schema: "schema://2" } }, NOW), (e) => e.code === "product_admin_idempotency_conflict");
});

test("active products suspend and retire only with maker-checker evidence", () => {
  let state = publish(createProductPlatformAdministrationState(), "education_loan").state;
  state = subscribe(state, "tenant-a", "education_loan").state;
  state = proposeTenantProductConfiguration(state, cmd("education-config", { tenantId: "tenant-a", productType: "education_loan", configuration: configuration("education_loan"), proposedBy: "maker" }), NOW).state;
  state = approveTenantProductConfiguration(state, cmd("education-approve", { tenantId: "tenant-a", productType: "education_loan", approvedBy: "checker", approvalRef: "approval://education" }), NOW).state;
  state = activateTenantProduct(state, cmd("education-activate", { tenantId: "tenant-a", productType: "education_loan", proposedBy: "operations-maker", approvedBy: "operations-checker", approvalRef: "approval://activation/education", activationRef: "activation://education" }), NOW).state;
  assert.throws(() => suspendTenantProduct(state, cmd("self-suspend", { tenantId: "tenant-a", productType: "education_loan", proposedBy: "same", approvedBy: "same", approvalRef: "approval://suspend", reason: "Provider incident" }), NOW), (e) => e.code === "product_admin_four_eyes_required");
  let result = suspendTenantProduct(state, cmd("suspend", { tenantId: "tenant-a", productType: "education_loan", proposedBy: "operations-maker", approvedBy: "risk-checker", approvalRef: "approval://suspend", reason: "Provider incident" }), NOW);
  assert.equal(result.product.status, "suspended");
  result = retireTenantProduct(result.state, cmd("retire", { tenantId: "tenant-a", productType: "education_loan", proposedBy: "product-maker", approvedBy: "product-checker", approvalRef: "approval://retire", reason: "Product withdrawn" }), NOW);
  assert.equal(result.product.status, "retired");
});

test("administration projections expose versioned forms, blockers, lifecycle history and evidence documents", () => {
  let state = publish(createProductPlatformAdministrationState(), "personal_loan").state;
  state = subscribe(state, "tenant-a", "personal_loan").state;
  let product = state.products["tenant-a:personal_loan"];
  assert.equal(getProductAdministrationFormSchema("personal_loan", "configuration").schemaVersion, 1);
  assert.deepEqual(projectTenantProductNextActions(product, state).filter((item) => item.enabled).map((item) => item.action), ["configuration"]);

  state = proposeTenantProductConfiguration(state, cmd("personal-config", { tenantId: "tenant-a", productType: "personal_loan", configuration: configuration("personal_loan"), proposedBy: "maker" }), NOW).state;
  product = state.products["tenant-a:personal_loan"];
  assert.deepEqual(projectTenantProductLifecycleHistory(product).map((item) => item.action), ["subscribed", "configuration_proposed"]);
  assert.deepEqual(projectTenantProductLifecycleHistory(product).map((item) => item.sequence), [0, 1]);
  const documents = projectTenantProductDocuments(product);
  assert.ok(documents.some((item) => item.category === "staffing" && item.reference === "evidence://staffing/1"));
  assert.ok(documents.some((item) => item.category === "readiness" && item.key === "rollback_plan"));
  assert.deepEqual(projectTenantProductNextActions(product, state).filter((item) => item.enabled).map((item) => item.action), ["configuration", "approval"]);
  assert.throws(() => getProductAdministrationFormSchema("legacy_personal", "configuration"), (error) => error.code === "product_admin_unknown_product");
  assert.throws(() => getProductAdministrationFormSchema("personal_loan", "invented"), (error) => error.code === "product_admin_form_not_found");
});
