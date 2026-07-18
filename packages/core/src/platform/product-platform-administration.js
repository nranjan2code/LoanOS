import { createHash } from "node:crypto";
import { PRODUCT_JOURNEY_TYPES } from "../journeys/product-journey-administration.js";

const TYPES = new Set(PRODUCT_JOURNEY_TYPES);
const TEMPLATE_STATUSES = new Set(["proposed", "published", "withdrawn"]);
const PRODUCT_STATUSES = new Set(["subscribed", "configured", "approved", "active", "suspended", "retired"]);
export const PRODUCT_READINESS_GATES = Object.freeze([
  "regulated_entity", "product_policy", "decision_bundle", "accounting_profile", "compliance_profile",
  "provider_certification", "document_pack", "customer_content", "operations_runbook", "support_model",
  "tenant_uat", "reconciliation", "rollback_plan"
]);

export function createProductPlatformAdministrationState() {
  return { templates: {}, products: {}, programmes: {}, commands: {} };
}

export function proposePlatformTemplateVersion(state, input, now = new Date()) {
  return command(state, input, "template.propose", () => {
    canonical(input.productType); ref(input.templateId, "templateId"); integer(input.version, "version"); ref(input.proposedBy, "proposedBy");
    const key = templateKey(input.productType, input.version);
    if (state.templates[key]) fail("product_admin_template_exists", "Template version already exists.");
    const specification = object(input.specification, "specification");
    const template = { templateId: input.templateId, productType: input.productType, version: input.version, status: "proposed", specification, specificationChecksumSha256: checksum(specification), proposedBy: input.proposedBy, proposedAt: iso(now), approval: null };
    return output({ ...state, templates: { ...state.templates, [key]: template } }, { template });
  });
}

export function publishPlatformTemplateVersion(state, input, now = new Date()) {
  return command(state, input, "template.publish", () => {
    canonical(input.productType); integer(input.version, "version"); ref(input.approvedBy, "approvedBy"); ref(input.approvalRef, "approvalRef");
    const key = templateKey(input.productType, input.version), current = state.templates[key];
    if (!current || current.status !== "proposed") fail("product_admin_template_not_proposed", "A proposed template version is required.");
    independent(current.proposedBy, input.approvedBy);
    const template = { ...current, status: "published", approval: { approvedBy: input.approvedBy, approvalRef: input.approvalRef, approvedAt: iso(now), specificationChecksumSha256: current.specificationChecksumSha256 } };
    return output({ ...state, templates: { ...state.templates, [key]: template } }, { template });
  });
}

export function subscribeTenantProduct(state, input, now = new Date()) {
  return command(state, input, "product.subscribe", () => {
    tenant(input); canonical(input.productType); integer(input.templateVersion, "templateVersion"); ref(input.subscriptionRef, "subscriptionRef"); ref(input.subscribedBy, "subscribedBy");
    const template = state.templates[templateKey(input.productType, input.templateVersion)];
    if (!template || template.status !== "published") fail("product_admin_template_unavailable", "Published template version is required.");
    const key = productKey(input.tenantId, input.productType);
    if (state.products[key]) fail("product_admin_product_exists", "Tenant product already exists.");
    const product = { tenantId: input.tenantId, productType: input.productType, templateId: template.templateId, templateVersion: template.version, templateChecksumSha256: template.specificationChecksumSha256, subscriptionRef: input.subscriptionRef, status: "subscribed", configurationVersion: 0, configuration: null, configurationChecksumSha256: null, history: [], approval: null, activation: null, suspension: null, retirement: null, subscribedBy: input.subscribedBy, subscribedAt: iso(now) };
    return output({ ...state, products: { ...state.products, [key]: product } }, { product });
  });
}

export function proposeTenantProductConfiguration(state, input, now = new Date()) {
  return command(state, input, "product.configure", () => {
    const current = localProduct(state, input);
    if (!["subscribed", "configured", "suspended"].includes(current.status)) fail("product_admin_configuration_forbidden", "Product cannot be configured in its current state.");
    ref(input.proposedBy, "proposedBy");
    const configuration = normalizeConfiguration(input.configuration, state, input.tenantId, input.productType);
    const configurationChecksumSha256 = checksum(configuration);
    const nextVersion = current.configurationVersion + 1;
    const history = current.configuration ? [...current.history, snapshot(current)] : current.history;
    const product = { ...current, status: "configured", configurationVersion: nextVersion, configuration, configurationChecksumSha256, history, proposedBy: input.proposedBy, proposedAt: iso(now), approval: null, activation: null };
    return output({ ...state, products: { ...state.products, [productKey(input.tenantId, input.productType)]: product } }, { product, readiness: assessTenantProductReadiness(product, state, now), diff: diffValues(current.configuration, configuration) });
  });
}

export function approveTenantProductConfiguration(state, input, now = new Date()) {
  return command(state, input, "product.approve", () => {
    const current = localProduct(state, input);
    if (current.status !== "configured") fail("product_admin_approval_forbidden", "Configured product is required.");
    ref(input.approvedBy, "approvedBy"); ref(input.approvalRef, "approvalRef"); independent(current.proposedBy, input.approvedBy);
    const readiness = assessTenantProductReadiness(current, state, now);
    if (!readiness.complete) fail("product_admin_not_ready", `Readiness is incomplete: ${readiness.gaps.join(", ")}`);
    const product = { ...current, status: "approved", approval: { approvedBy: input.approvedBy, approvalRef: input.approvalRef, approvedAt: iso(now), configurationChecksumSha256: current.configurationChecksumSha256 } };
    return output(replaceProduct(state, product), { product, readiness });
  });
}

export function activateTenantProduct(state, input, now = new Date()) {
  return command(state, input, "product.activate", () => {
    const current = localProduct(state, input);
    if (current.status !== "approved") fail("product_admin_activation_forbidden", "Approved product is required.");
    ref(input.proposedBy, "proposedBy"); ref(input.approvedBy, "approvedBy"); ref(input.approvalRef, "approvalRef"); ref(input.activationRef, "activationRef"); independent(input.proposedBy, input.approvedBy);
    if (current.approval.configurationChecksumSha256 !== current.configurationChecksumSha256) fail("product_admin_stale_approval", "Approval does not cover the current configuration.");
    const readiness = assessTenantProductReadiness(current, state, now);
    if (!readiness.complete || !readiness.effective) fail("product_admin_not_ready", "Product is not ready or effective.");
    const product = { ...current, status: "active", activation: { proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, activationRef: input.activationRef, activatedAt: iso(now) }, suspension: null };
    return output(replaceProduct(state, product), { product, readiness });
  });
}

export function suspendTenantProduct(state, input, now = new Date()) { return terminalTransition(state, input, now, "suspended"); }
export function retireTenantProduct(state, input, now = new Date()) { return terminalTransition(state, input, now, "retired"); }

export function administerTenantProgramme(state, input, now = new Date()) {
  return command(state, input, "programme.upsert", () => {
    tenant(input); ref(input.programmeId, "programmeId"); canonical(input.productType); ref(input.proposedBy, "proposedBy"); ref(input.approvedBy, "approvedBy"); ref(input.approvalRef, "approvalRef"); independent(input.proposedBy, input.approvedBy);
    const participants = list(input.participantRefs, "participantRefs", true), configuration = object(input.configuration, "configuration");
    const key = programmeKey(input.tenantId, input.programmeId), prior = state.programmes[key];
    if (prior && prior.productType !== input.productType) fail("product_admin_programme_type_immutable", "Programme product type cannot change.");
    const programme = { tenantId: input.tenantId, programmeId: input.programmeId, productType: input.productType, version: (prior?.version ?? 0) + 1, status: input.status === "suspended" ? "suspended" : "active", participantRefs: participants, configuration, configurationChecksumSha256: checksum({ participants, configuration }), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, approvedAt: iso(now) };
    return output({ ...state, programmes: { ...state.programmes, [key]: programme } }, { programme, diff: diffValues(prior?.configuration ?? null, configuration) });
  });
}

export function assessTenantProductReadiness(product, state, now = new Date()) {
  if (!product || !PRODUCT_STATUSES.has(product.status) || !state) invalid("Valid product and state are required.");
  const c = product.configuration, gaps = [];
  if (!c) gaps.push("configuration");
  if (c) {
    for (const gate of PRODUCT_READINESS_GATES) if (!c.readinessEvidence[gate]) gaps.push(`readiness:${gate}`);
    if (!c.regulatedEntityRefs.length) gaps.push("regulated_entities");
    if (!c.channels.length) gaps.push("channels");
    if (!c.staffingGrants.length) gaps.push("staffing_grants");
    if (!c.whiteLabelBinding.brandVersionRef || !c.whiteLabelBinding.legalEntityDisclosureRef) gaps.push("white_label_binding");
    for (const grant of c.staffingGrants) if (!grant.roles.length || !grant.scopeRefs.length || !grant.evidenceRef) gaps.push(`grant:${grant.grantId}`);
    for (const programmeId of c.programmeRefs) { const p = state.programmes[programmeKey(product.tenantId, programmeId)]; if (!p || p.status !== "active" || p.productType !== product.productType) gaps.push(`programme:${programmeId}`); }
  }
  const effective = Boolean(c) && Date.parse(c.effectiveFrom) <= now.getTime() && (!c.effectiveTo || Date.parse(c.effectiveTo) > now.getTime());
  return { tenantId: product.tenantId, productType: product.productType, configurationVersion: product.configurationVersion, complete: gaps.length === 0, effective, gaps: [...new Set(gaps)].sort(), assessedAt: iso(now) };
}

export function diffTenantProductConfigurations(product, fromVersion, toVersion) {
  if (!product || !PRODUCT_STATUSES.has(product.status)) invalid("Valid product is required.");
  const versions = new Map([...product.history, snapshot(product)].map((x) => [x.configurationVersion, x.configuration]));
  if (!versions.has(fromVersion) || !versions.has(toVersion)) fail("product_admin_version_not_found", "Configuration version was not found.");
  return { tenantId: product.tenantId, productType: product.productType, fromVersion, toVersion, changes: diffValues(versions.get(fromVersion), versions.get(toVersion)) };
}

function normalizeConfiguration(value, state, tenantId, productType) {
  const c = object(value, "configuration");
  const effectiveFrom = date(c.effectiveFrom, "effectiveFrom"), effectiveTo = c.effectiveTo == null ? null : date(c.effectiveTo, "effectiveTo");
  if (effectiveTo && Date.parse(effectiveTo) <= Date.parse(effectiveFrom)) invalid("effectiveTo must follow effectiveFrom.");
  const staffingGrants = array(c.staffingGrants, "staffingGrants").map((g) => ({ grantId: ref(g.grantId, "grantId"), principalId: ref(g.principalId, "principalId"), roles: list(g.roles, "roles", true), scopeRefs: list(g.scopeRefs, "scopeRefs", true), evidenceRef: ref(g.evidenceRef, "evidenceRef") }));
  unique(staffingGrants.map((g) => g.grantId), "staffing grant IDs");
  const programmeRefs = list(c.programmeRefs ?? [], "programmeRefs");
  for (const id of programmeRefs) { const p = state.programmes[programmeKey(tenantId, id)]; if (p && p.productType !== productType) fail("product_admin_programme_type_mismatch", "Programme belongs to another product type."); }
  return { regulatedEntityRefs: list(c.regulatedEntityRefs, "regulatedEntityRefs", true), channels: list(c.channels, "channels", true), productPolicyRef: ref(c.productPolicyRef, "productPolicyRef"), decisionBundleRef: ref(c.decisionBundleRef, "decisionBundleRef"), accountingProfileRef: ref(c.accountingProfileRef, "accountingProfileRef"), complianceProfileRef: ref(c.complianceProfileRef, "complianceProfileRef"), providerProfileRefs: list(c.providerProfileRefs, "providerProfileRefs", true), documentPackRef: ref(c.documentPackRef, "documentPackRef"), staffingGrants, programmeRefs, whiteLabelBinding: { brandVersionRef: ref(c.whiteLabelBinding?.brandVersionRef, "brandVersionRef"), legalEntityDisclosureRef: ref(c.whiteLabelBinding?.legalEntityDisclosureRef, "legalEntityDisclosureRef"), localeRefs: list(c.whiteLabelBinding?.localeRefs, "localeRefs", true), communicationTemplateSetRef: ref(c.whiteLabelBinding?.communicationTemplateSetRef, "communicationTemplateSetRef"), documentTemplateSetRef: ref(c.whiteLabelBinding?.documentTemplateSetRef, "documentTemplateSetRef") }, readinessEvidence: evidence(c.readinessEvidence), effectiveFrom, effectiveTo };
}

function terminalTransition(state, input, now, target) {
  return command(state, input, `product.${target}`, () => {
    const current = localProduct(state, input), allowed = target === "suspended" ? ["active"] : ["approved", "active", "suspended"];
    if (!allowed.includes(current.status)) fail(`product_admin_${target}_forbidden`, `Product cannot be ${target} from its current state.`);
    const maker = ref(input.proposedBy, "proposedBy"), checker = ref(input.approvedBy, "approvedBy"); independent(maker, checker); ref(input.approvalRef, "approvalRef"); text(input.reason, "reason");
    const record = { proposedBy: maker, approvedBy: checker, approvalRef: input.approvalRef, reason: input.reason.trim(), at: iso(now) };
    const product = { ...current, status: target, [target === "suspended" ? "suspension" : "retirement"]: record };
    return output(replaceProduct(state, product), { product });
  });
}

function command(state, input, kind, execute) {
  validState(state); ref(input.commandId, "commandId");
  const fingerprint = checksum({ kind, input: Object.fromEntries(Object.entries(input).filter(([k]) => k !== "commandId")) });
  const prior = state.commands[input.commandId];
  if (prior) { if (prior.fingerprint !== fingerprint) fail("product_admin_idempotency_conflict", "Command ID was reused with different input."); return { state, ...structuredClone(prior.payload), idempotentReplay: true }; }
  const result = execute(), payload = Object.fromEntries(Object.entries(result).filter(([k]) => k !== "state"));
  return { ...result, state: { ...result.state, commands: { ...result.state.commands, [input.commandId]: { fingerprint, payload: structuredClone(payload) } } }, idempotentReplay: false };
}
function output(state, payload) { return { state, ...payload }; }
function replaceProduct(state, product) { return { ...state, products: { ...state.products, [productKey(product.tenantId, product.productType)]: product } }; }
function localProduct(state, input) { tenant(input); canonical(input.productType); const p = state.products[productKey(input.tenantId, input.productType)]; if (!p) fail("product_admin_product_not_found", "Tenant-local product was not found."); return p; }
function snapshot(p) { return { configurationVersion: p.configurationVersion, configuration: structuredClone(p.configuration), configurationChecksumSha256: p.configurationChecksumSha256 }; }
function evidence(value) { const o = object(value, "readinessEvidence"); return Object.fromEntries(PRODUCT_READINESS_GATES.map((g) => [g, ref(o[g], `readinessEvidence.${g}`)])); }
function diffValues(a, b, path = "") { if (stable(a) === stable(b)) return []; if (!plain(a) || !plain(b)) return [{ path: path || "$", before: a ?? null, after: b ?? null }]; const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(); return keys.flatMap((k) => diffValues(a[k], b[k], path ? `${path}.${k}` : k)); }
function validState(s) { if (!s || !plain(s.templates) || !plain(s.products) || !plain(s.programmes) || !plain(s.commands)) invalid("Valid administration state is required."); }
function canonical(v) { if (!TYPES.has(v)) fail("product_admin_unknown_product", "Canonical product type is required."); return v; }
function tenant(v) { ref(v.tenantId, "tenantId"); }
function ref(v, f) { if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,255}$/.test(v)) invalid(`${f} is invalid.`); return v; }
function text(v, f) { if (typeof v !== "string" || !v.trim()) invalid(`${f} is required.`); return v.trim(); }
function integer(v, f) { if (!Number.isSafeInteger(v) || v < 1) invalid(`${f} must be a positive integer.`); return v; }
function array(v, f) { if (!Array.isArray(v)) invalid(`${f} must be an array.`); return v; }
function list(v, f, required = false) { const x = array(v, f).map((i) => ref(i, f)); unique(x, f); if (required && !x.length) invalid(`${f} requires at least one value.`); return [...x].sort(); }
function unique(v, f) { if (new Set(v).size !== v.length) invalid(`${f} contains duplicates.`); }
function object(v, f) { if (!plain(v)) invalid(`${f} must be an object.`); return structuredClone(v); }
function plain(v) { return Boolean(v) && typeof v === "object" && !Array.isArray(v); }
function date(v, f) { text(v, f); if (!Number.isFinite(Date.parse(v))) invalid(`${f} must be an ISO date-time.`); return new Date(v).toISOString(); }
function iso(v) { const d = v instanceof Date ? v : new Date(v); if (!Number.isFinite(d.getTime())) invalid("A valid clock is required."); return d.toISOString(); }
function independent(a, b) { if (a === b) fail("product_admin_four_eyes_required", "An independent checker is required."); }
function templateKey(t, v) { return `${t}:${v}`; }
function productKey(t, p) { return `${t}:${p}`; }
function programmeKey(t, p) { return `${t}:${p}`; }
function stable(v) { if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`; if (plain(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`; return JSON.stringify(v); }
function checksum(v) { return createHash("sha256").update(stable(v)).digest("hex"); }
function invalid(m) { fail("product_admin_invalid", m); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

export { TEMPLATE_STATUSES, PRODUCT_STATUSES };
