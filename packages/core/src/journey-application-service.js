import { createHash } from "node:crypto";

import { resolveBrandExperience } from "./brand-governance.js";
import { createComposedJourneyInstance } from "./composed-journey-lifecycle.js";
import { JOURNEY_WORKSPACE_SCHEMAS, PRODUCT_TO_WORKSPACE_ARCHETYPE } from "./journey-workspace.js";
import { assessTenantProductReadiness } from "./product-platform-administration.js";
import { getProductJourneyContract } from "./product-journey-contracts.js";
import { PRODUCT_TEMPLATE_CATALOGUE } from "./product-template-catalogue.js";
import { openSpecialistJourneyCase, PERSISTENT_SPECIALIST_JOURNEY_TYPES } from "./specialist-journey-service.js";

const SPECIALIST_TYPES = new Set(PERSISTENT_SPECIALIST_JOURNEY_TYPES);

/**
 * Atomically promotes a sealed submitted workspace draft into the governed
 * application, specialist-case (when applicable), and composed lifecycle.
 * The request carries identity and business intent only. All release lineage
 * is resolved from tenant-owned stored records.
 */
export function promoteSubmittedJourneyDraft(state = {}, input = {}, now = new Date()) {
  const at = instant(now);
  const tenantId = ref(input.tenantId, "tenantId");
  const draftId = ref(input.draftId, "draftId");
  const applicationId = ref(input.applicationId, "applicationId");
  const makerPrincipalId = ref(input.makerPrincipalId, "makerPrincipalId");
  const checkerPrincipalId = ref(input.checkerPrincipalId, "checkerPrincipalId");
  const subjectRef = ref(input.subjectRef, "subjectRef");
  const idempotencyKey = ref(input.idempotencyKey, "idempotencyKey");
  if (makerPrincipalId === checkerPrincipalId) fail("journey_application_four_eyes_required", "Maker and assigned checker must be independent.", 403);

  const prior = Object.values(state.journeyApplications ?? {}).find((item) => item.tenantId === tenantId && (item.applicationId === applicationId || item.idempotencyKey === idempotencyKey));
  if (prior) {
    verifyApplication(prior);
    const replay = checksum({ tenantId, draftId, applicationId, makerPrincipalId, checkerPrincipalId, subjectRef, idempotencyKey });
    if (prior.promotionIntentChecksumSha256 !== replay) fail("journey_application_idempotency_conflict", "Application identity was reused with different promotion intent.", 409);
    return result(state, prior, true);
  }

  const draft = state.journeyWorkspaceDrafts?.[`${tenantId}:${draftId}`];
  if (!draft || draft.tenantId !== tenantId) fail("journey_application_draft_missing", "A same-tenant workspace draft is required.", 404);
  verifyDraft(draft);
  if (draft.status !== "submitted" || !draft.submittedAt) fail("journey_application_draft_not_submitted", "Only a submitted workspace draft can be promoted.");
  if (draft.actorId !== makerPrincipalId) fail("journey_application_maker_mismatch", "The authenticated maker must own the submitted draft.", 403);

  const journeyType = draft.journeyType;
  const contract = getProductJourneyContract(journeyType);
  const archetype = PRODUCT_TO_WORKSPACE_ARCHETYPE[journeyType];
  const schema = JOURNEY_WORKSPACE_SCHEMAS[journeyType];
  if (!schema || draft.schemaId !== schema.schemaId || String(draft.schemaVersion) !== String(schema.schemaVersion) || draft.schemaChecksumSha256 !== schema.schemaChecksumSha256) fail("journey_application_schema_stale", "The submitted draft does not match the current governed schema.", 409);

  const administration = state.productPlatformAdministration;
  const product = administration?.products?.[`${tenantId}:${journeyType}`];
  if (!product || product.tenantId !== tenantId || product.productType !== journeyType || product.status !== "active") fail("journey_application_product_inactive", "An active tenant-local unified product administration record is required.");
  const readiness = assessTenantProductReadiness(product, administration, now);
  if (!readiness.complete || !readiness.effective) fail("journey_application_product_not_ready", `Product readiness blocks promotion: ${readiness.gaps.join(", ") || "not effective"}.`);
  verifyConfiguration(product);

  const makerGrant = assignedGrant(product, makerPrincipalId, "application_maker", tenantId, state, now);
  const checkerGrant = assignedGrant(product, checkerPrincipalId, "application_checker", tenantId, state, now);
  const brand = resolvePublishedBrand(state, product, journeyType);
  const storedLineage = resolveStoredLineage(state, tenantId, journeyType, product);
  const specialistConfiguration = SPECIALIST_TYPES.has(journeyType) ? resolveSpecialistConfiguration(state, tenantId, journeyType, product, storedLineage) : null;

  const requestedAmountPaise = amountFromDraft(draft);
  const promotionIntentChecksumSha256 = checksum({ tenantId, draftId, applicationId, makerPrincipalId, checkerPrincipalId, subjectRef, idempotencyKey });
  const immutable = {
    tenantId, applicationId, journeyType, subjectRef, requestedAmountPaise, sourceDraftRef: `journey-workspace/${draftId}`,
    sourceDraftChecksumSha256: draft.contentChecksumSha256,
    productContractRef: contract.contractId, productContractVersion: contract.contractVersion, productContractChecksumSha256: contract.checksumSha256,
    platformTemplateRef: product.templateId, platformTemplateVersion: product.templateVersion, platformTemplateChecksumSha256: product.templateChecksumSha256,
    productConfigurationVersion: product.configurationVersion, productConfigurationChecksumSha256: product.configurationChecksumSha256,
    workspaceSchemaId: schema.schemaId, workspaceSchemaVersion: schema.schemaVersion, workspaceSchemaChecksumSha256: schema.schemaChecksumSha256,
    brandReleaseLineage: brand.releaseLineage, legalIdentityChecksumSha256: brand.legalIdentityChecksumSha256,
    makerAssignment: assignment(makerPrincipalId, makerGrant), checkerAssignment: assignment(checkerPrincipalId, checkerGrant),
    specialistConfigurationRef: specialistConfiguration?.configurationId ?? null,
    specialistConfigurationVersion: specialistConfiguration?.version ?? null,
    specialistConfigurationChecksumSha256: specialistConfiguration?.configurationChecksumSha256 ?? null,
    storedLineageChecksumSha256: storedLineage.recordChecksumSha256,
    promotionIntentChecksumSha256, idempotencyKey
  };
  const applicationChecksumSha256 = checksum(immutable);
  const application = Object.freeze({ ...immutable, applicationChecksumSha256, status: "open", proposedBy: makerPrincipalId, proposedAt: at, assignedCheckerId: checkerPrincipalId, assignedAt: at, specialistCaseId: specialistConfiguration ? `specialist:${applicationId}` : null, lifecycleId: `lifecycle:${applicationId}` });

  // Work only on local immutable state. No state escapes unless every dependent
  // object opens successfully, providing an atomic fail-closed boundary.
  let working = { ...state, journeyApplications: { ...(state.journeyApplications ?? {}), [`${tenantId}:${applicationId}`]: application } };
  if (specialistConfiguration) {
    working = openSpecialistJourneyCase(working, {
      tenantId, caseId: application.specialistCaseId, configurationId: specialistConfiguration.configurationId,
      expectedConfigurationVersion: specialistConfiguration.version, subjectRef, sourceApplicationRef: `journey-application/${applicationId}`,
      assignedPrincipalIds: [makerPrincipalId, checkerPrincipalId], idempotencyKey: `application-case/${applicationId}`, openedBy: makerPrincipalId
    }, now).state;
  }

  const originalSubscriptions = working.tenantProductSubscriptions;
  const entitlementId = `application-entitlement:${tenantId}:${journeyType}`;
  const entitled = { ...(originalSubscriptions ?? {}), [entitlementId]: { subscriptionId: entitlementId, tenantId, productTypes: [journeyType], effectiveFrom: product.configuration.effectiveFrom, validUntil: product.configuration.effectiveTo, status: "active" } };
  working = createComposedJourneyInstance({ ...working, tenantProductSubscriptions: entitled }, {
    tenantId, lifecycleId: application.lifecycleId, journeyType, subjectRef, applicationRef: `journey-application/${applicationId}`,
    requestedAmountPaise, assignedPrincipalIds: [makerPrincipalId, checkerPrincipalId], idempotencyKey: `application-lifecycle/${applicationId}`, createdBy: makerPrincipalId,
    lineage: lifecycleLineage(storedLineage, schema, journeyType, specialistConfiguration)
  }, at).state;
  working = originalSubscriptions === undefined ? omit(working, "tenantProductSubscriptions") : { ...working, tenantProductSubscriptions: originalSubscriptions };
  return result(working, application, false);
}

export function projectJourneyApplication(state = {}, input = {}) {
  const tenantId = ref(input.tenantId, "tenantId"), applicationId = ref(input.applicationId, "applicationId");
  const application = state.journeyApplications?.[`${tenantId}:${applicationId}`];
  if (!application || application.tenantId !== tenantId) fail("journey_application_missing", "Application was not found.", 404);
  verifyApplication(application);
  return structuredClone(application);
}

function resolveStoredLineage(state, tenantId, journeyType, product) {
  const record = state.journeyApplicationLineage?.[`${tenantId}:${journeyType}`];
  if (!record || record.tenantId !== tenantId || record.journeyType !== journeyType) fail("journey_application_lineage_missing", "Stored same-tenant application lineage is required.");
  const { recordChecksumSha256, ...content } = record;
  if (checksum(content) !== recordChecksumSha256) fail("journey_application_lineage_tampered", "Stored application lineage failed integrity verification.", 409);
  for (const name of ["policyBundle", "workflow", "accountingPolicy", "tenantConfiguration", "accessGrantSnapshot"]) lineageItem(record[name], name);
  if (record.policyBundle.ref !== product.configuration.decisionBundleRef) fail("journey_application_policy_lineage_mismatch", "Stored decision bundle does not match active product configuration.", 409);
  if (record.accountingPolicy.ref !== product.configuration.accountingProfileRef) fail("journey_application_accounting_lineage_mismatch", "Stored accounting policy does not match active product configuration.", 409);
  return record;
}

function resolveSpecialistConfiguration(state, tenantId, journeyType, product, lineage) {
  const expected = lineage.specialistConfiguration;
  lineageItem(expected, "specialistConfiguration");
  const configuration = state.specialistJourneyConfigurations?.[`${tenantId}:${expected.ref}`];
  if (!configuration || configuration.tenantId !== tenantId || configuration.journeyType !== journeyType || configuration.status !== "active") fail("journey_application_specialist_configuration_missing", "An active same-tenant specialist configuration is required.");
  if (String(configuration.version) !== String(expected.version) || configuration.configurationChecksumSha256 !== expected.checksumSha256) fail("journey_application_specialist_configuration_stale", "Specialist configuration lineage is stale.", 409);
  if (configuration.productTemplateChecksumSha256 !== PRODUCT_TEMPLATE_CATALOGUE[journeyType].templateChecksumSha256) fail("journey_application_specialist_template_mismatch", "Specialist configuration is not bound to the governed product template.", 409);
  return configuration;
}

function resolvePublishedBrand(state, product, journeyType) {
  const binding = product.configuration.whiteLabelBinding;
  const releases = Object.values(state.brandReleases ?? {}).filter((r) => r.tenantId === product.tenantId && r.status === "published" && r.applicableJourneyTypes?.includes(journeyType));
  const selected = releases.find((r) => r.releaseId === binding.brandVersionRef || `${r.releaseId}@${r.version}` === binding.brandVersionRef);
  if (!selected) fail("journey_application_brand_release_missing", "Configured brand version is not a published same-tenant release.");
  const experience = resolveBrandExperience(state, { tenantId: product.tenantId, journeyType, channel: "borrower" });
  if (!experience.releaseLineage.some((item) => item.releaseId === selected.releaseId && item.contentChecksumSha256 === selected.contentChecksumSha256)) fail("journey_application_brand_release_unresolved", "Configured brand release is not in the resolved experience.", 409);
  const legalIdentityChecksumSha256 = checksum(experience.legalIdentity);
  const disclosure = state.legalIdentityDisclosures?.[`${product.tenantId}:${binding.legalEntityDisclosureRef}`];
  if (!disclosure || disclosure.tenantId !== product.tenantId || disclosure.status !== "published" || disclosure.legalIdentityChecksumSha256 !== legalIdentityChecksumSha256) fail("journey_application_legal_identity_missing", "A published exact legal-identity disclosure is required.");
  return { releaseLineage: experience.releaseLineage, legalIdentityChecksumSha256 };
}

function assignedGrant(product, principalId, requiredRole, tenantId, state, now) {
  const grant = product.configuration.staffingGrants.find((g) => g.principalId === principalId && g.roles.includes(requiredRole) && (g.scopeRefs.includes(tenantId) || g.scopeRefs.includes(product.productType)));
  if (!grant) fail("journey_application_staffing_grant_missing", `${requiredRole} is not assigned by active product configuration.`, 403);
  const principal = state.saasPrincipals?.[`${tenantId}:${principalId}`];
  if (!principal || principal.tenantId !== tenantId || principal.status !== "active" || principal.principalType !== "human" || principal.emailVerified !== true || principal.mfaEnrolled !== true || (principal.expiresAt && Date.parse(principal.expiresAt) <= now.getTime())) fail("journey_application_principal_inactive", "An active verified human principal is required.", 403);
  const roleGrant = Object.values(state.saasRoleGrants ?? {}).find((g) => g.tenantId === tenantId && g.principalId === principalId && g.roleId === requiredRole && g.status === "active" && Date.parse(g.effectiveFrom) <= now.getTime() && (!g.validUntil || Date.parse(g.validUntil) > now.getTime()));
  if (!roleGrant) fail("journey_application_authority_missing", `${requiredRole} authority is not effective.`, 403);
  return grant;
}

function lifecycleLineage(stored, schema, journeyType, specialist) {
  const template = PRODUCT_TEMPLATE_CATALOGUE[journeyType];
  return {
    productTemplateRef: template.templateId, productTemplateVersion: template.version, productTemplateChecksumSha256: template.templateChecksumSha256,
    workspaceSchemaId: schema.schemaId, workspaceSchemaVersion: schema.schemaVersion, workspaceSchemaChecksumSha256: schema.schemaChecksumSha256,
    policyBundleRef: stored.policyBundle.ref, policyBundleVersion: stored.policyBundle.version, policyBundleChecksumSha256: stored.policyBundle.checksumSha256,
    workflowRef: stored.workflow.ref, workflowVersion: stored.workflow.version, workflowChecksumSha256: stored.workflow.checksumSha256,
    accountingPolicyRef: stored.accountingPolicy.ref, accountingPolicyVersion: stored.accountingPolicy.version, accountingPolicyChecksumSha256: stored.accountingPolicy.checksumSha256,
    tenantConfigurationRef: stored.tenantConfiguration.ref, tenantConfigurationVersion: stored.tenantConfiguration.version, tenantConfigurationChecksumSha256: stored.tenantConfiguration.checksumSha256,
    accessGrantSnapshotRef: stored.accessGrantSnapshot.ref, accessGrantSnapshotChecksumSha256: stored.accessGrantSnapshot.checksumSha256,
    ...(specialist ? { specialistConfigurationRef: specialist.configurationId, specialistConfigurationVersion: specialist.version, specialistConfigurationChecksumSha256: specialist.configurationChecksumSha256 } : {})
  };
}

function amountFromDraft(draft) {
  const candidates = ["requested_amount_paise", "amount_paise", "facility_limit_paise", "programme_limit_paise", "order_value_paise", "face_value_paise"];
  const preferred = candidates.map((key) => draft.values?.[key]).find((item) => item != null);
  const productAmount = Object.entries(draft.values ?? {}).find(([key, value]) => /(?:_paise|_minor_units)$/.test(key) && typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value))?.[1];
  const value = preferred ?? productAmount;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) fail("journey_application_amount_missing", "Submitted draft must contain an exact non-negative amount in minor units.");
  return value;
}

function verifyDraft(draft) {
  const immutable = { tenantId: draft.tenantId, draftId: draft.draftId, journeyType: draft.journeyType, channel: draft.channel, actorId: draft.actorId, schemaId: draft.schemaId, schemaVersion: draft.schemaVersion, schemaChecksumSha256: draft.schemaChecksumSha256, values: draft.values, idempotencyKey: draft.idempotencyKey };
  if (checksum(immutable) !== draft.contentChecksumSha256) fail("journey_application_draft_tampered", "Submitted draft failed integrity verification.", 409);
}
function verifyConfiguration(product) { if (checksum(product.configuration) !== product.configurationChecksumSha256) fail("journey_application_product_tampered", "Active product configuration failed integrity verification.", 409); }
function verifyApplication(application) { const { applicationChecksumSha256, status: _s, proposedBy: _p, proposedAt: _pa, assignedCheckerId: _c, assignedAt: _a, specialistCaseId: _sc, lifecycleId: _lc, ...immutable } = application; if (checksum(immutable) !== applicationChecksumSha256) fail("journey_application_integrity_failure", "Application failed integrity verification.", 409); }
function lineageItem(value, name) { if (!value || typeof value !== "object") fail("journey_application_lineage_incomplete", `${name} lineage is required.`); ref(value.ref, `${name}.ref`); if ((!Number.isSafeInteger(value.version) || value.version < 1) && !(typeof value.version === "string" && /^[1-9]\d*(?:\.\d+){0,2}$/.test(value.version))) fail("journey_application_lineage_incomplete", `${name}.version is invalid.`); hash(value.checksumSha256, `${name}.checksumSha256`); }
function assignment(principalId, grant) { return Object.freeze({ principalId, staffingGrantId: grant.grantId, staffingEvidenceRef: grant.evidenceRef, roles: [...grant.roles], scopeRefs: [...grant.scopeRefs] }); }
function result(state, application, idempotent) { return { state, application: structuredClone(application), specialistCase: application.specialistCaseId ? state.specialistJourneyCases?.[`${application.tenantId}:${application.specialistCaseId}`] : null, lifecycle: state.composedJourneyLifecycles?.[application.lifecycleId] ?? null, idempotent }; }
function ref(value, field) { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{1,255}$/.test(value)) fail("journey_application_invalid", `${field} is invalid.`); return value; }
function hash(value, field) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("journey_application_lineage_incomplete", `${field} must be a SHA-256 checksum.`); return value; }
function instant(value) { const date = value instanceof Date ? value : new Date(value); if (!Number.isFinite(date.getTime())) fail("journey_application_invalid", "A valid clock is required."); return date.toISOString(); }
function checksum(value) { return createHash("sha256").update(stable(value)).digest("hex"); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function omit(state, field) { const next = { ...state }; delete next[field]; return next; }
function fail(code, message, statusCode = 422) { throw Object.assign(new Error(message), { code, statusCode }); }
