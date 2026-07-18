import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { promoteSubmittedJourneyDraft, projectJourneyApplication } from "@loanos/core/journeys/journey-application-service.js";
import { JOURNEY_WORKSPACE_SCHEMAS, PRODUCT_TO_WORKSPACE_ARCHETYPE } from "@loanos/core/journeys/journey-workspace.js";
import { PRODUCT_READINESS_GATES } from "@loanos/core/platform/product-platform-administration.js";
import { PRODUCT_JOURNEY_TYPES } from "@loanos/core/journeys/product-journey-administration.js";
import { PRODUCT_TEMPLATE_CATALOGUE } from "@loanos/core/platform/product-template-catalogue.js";
import { PERSISTENT_SPECIALIST_JOURNEY_TYPES, approveSpecialistJourneyConfiguration, proposeSpecialistJourneyConfiguration } from "@loanos/core/journeys/specialist-journey-service.js";

const NOW = new Date("2026-07-16T08:00:00.000Z");
const TENANT = "tenant-a";
const H = "a".repeat(64);

function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function sum(value) { return createHash("sha256").update(stable(value)).digest("hex"); }

function kernel(journeyType) {
  if (["invoice_discounting", "purchase_order_finance", "supply_chain_finance", "trade_finance_workflow"].includes(journeyType)) return { facilityLimitPaise: "1000000", singleObligorLimitPaise: "800000", maxConcentrationBps: 8000, advanceRateBps: 8000, requiredMilestones: ["credit_approved"], requiredDocuments: journeyType === "purchase_order_finance" ? ["purchase_order"] : ["invoice"], msmeBinding: { productType: "msme_working_capital", productConfigRef: "product/msme-wc", udyamRequired: true } };
  return { minimumAmountPaise: "100", maximumAmountPaise: "100000000", maximumLtvPercent: "75.0000", eligibilityPolicyRef: "eligibility/v1", kycControlRef: "kyc/v1", agreementTemplateRef: "agreement/v1", servicingPolicyRef: "servicing/v1", collateralPolicyRef: "collateral/v1" };
}

function baseState(journeyType) {
  const schema = JOURNEY_WORKSPACE_SCHEMAS[journeyType];
  const maker = "maker-1", checker = "checker-1";
  const configuration = {
    regulatedEntityRefs: ["re/a"], channels: ["borrower"], productPolicyRef: `policy/${journeyType}`, decisionBundleRef: `bundle/${journeyType}`,
    accountingProfileRef: `accounting/${journeyType}`, complianceProfileRef: "compliance/a", providerProfileRefs: ["provider/a"], documentPackRef: "documents/a",
    staffingGrants: [
      { grantId: `maker-${journeyType}`, principalId: maker, roles: ["application_maker"], scopeRefs: [TENANT], evidenceRef: "staffing/maker" },
      { grantId: `checker-${journeyType}`, principalId: checker, roles: ["application_checker"], scopeRefs: [TENANT], evidenceRef: "staffing/checker" }
    ], programmeRefs: [],
    whiteLabelBinding: { brandVersionRef: "brand-1", legalEntityDisclosureRef: "legal-1", localeRefs: ["en-IN"], communicationTemplateSetRef: "communications/a", documentTemplateSetRef: "templates/a" },
    readinessEvidence: Object.fromEntries(PRODUCT_READINESS_GATES.map((gate) => [gate, `evidence/${gate}`])), effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: "2030-01-01T00:00:00.000Z"
  };
  const platformTemplate = { templateId: `platform/${journeyType}`, productType: journeyType, version: 1, status: "published", specification: {}, specificationChecksumSha256: H };
  const product = { tenantId: TENANT, productType: journeyType, templateId: platformTemplate.templateId, templateVersion: 1, templateChecksumSha256: H, status: "active", configurationVersion: 1, configuration, configurationChecksumSha256: sum(configuration), history: [], approval: { configurationChecksumSha256: sum(configuration) }, activation: {} };
  const legalIdentity = { regulatedEntityRef: "re/a", regulatedEntityName: "A Bank", registrationNumber: "RBI-1", grievanceOfficerName: "Officer", grievanceEmail: "help@example.test", grievancePhone: "+911111111111", privacyUrl: "https://example.test/privacy", termsUrl: "https://example.test/terms", entityType: "bank" };
  const releaseContent = { tenantId: TENANT, releaseId: "brand-1", version: 1, scope: { level: "tenant", ref: null }, applicableJourneyTypes: PRODUCT_JOURNEY_TYPES, defaultLocale: "en-IN", theme: {}, legalIdentity, localizedContent: { "en-IN": {} }, channelOverlays: {}, coBranding: [], assetManifest: {}, proposedBy: "brand-maker", proposedAt: NOW.toISOString(), status: "published", approvedBy: "brand-checker", approvedAt: NOW.toISOString(), publishedBy: "brand-checker", publishedAt: NOW.toISOString(), supersededAt: null };
  const brandRelease = Object.freeze({ ...releaseContent, contentChecksumSha256: sum(releaseContent) });
  const draftCore = { tenantId: TENANT, draftId: `draft-${journeyType}`, journeyType, channel: "borrower", actorId: maker, schemaId: schema.schemaId, schemaVersion: schema.schemaVersion, schemaChecksumSha256: schema.schemaChecksumSha256, values: { requested_amount_paise: "2500000" }, idempotencyKey: `draft/${journeyType}` };
  const draft = { ...draftCore, status: "submitted", contentChecksumSha256: sum(draftCore), createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), submittedAt: NOW.toISOString() };
  const lineageCore = { tenantId: TENANT, journeyType, policyBundle: item(`bundle/${journeyType}`), workflow: item(`workflow/${journeyType}`), accountingPolicy: item(`accounting/${journeyType}`), tenantConfiguration: item("tenant-configuration/a"), accessGrantSnapshot: item("access-snapshot/a") };
  const state = {
    productPlatformAdministration: { templates: { [`${journeyType}:1`]: platformTemplate }, products: { [`${TENANT}:${journeyType}`]: product }, programmes: {}, commands: {} },
    journeyWorkspaceDrafts: { [`${TENANT}:${draft.draftId}`]: draft },
    journeyApplicationLineage: { [`${TENANT}:${journeyType}`]: { ...lineageCore, recordChecksumSha256: sum(lineageCore) } },
    brandReleases: { [`${TENANT}:brand-1`]: brandRelease },
    legalIdentityDisclosures: { [`${TENANT}:legal-1`]: { tenantId: TENANT, status: "published", legalIdentityChecksumSha256: sum(legalIdentity) } },
    saasPrincipals: {
      [`${TENANT}:${maker}`]: principal(maker), [`${TENANT}:${checker}`]: principal(checker)
    },
    saasRoleGrants: {
      maker: roleGrant(maker, "application_maker"), checker: roleGrant(checker, "application_checker")
    }
  };
  return state;
}
function item(ref) { return { ref, version: 1, checksumSha256: H }; }
function principal(principalId) { return { tenantId: TENANT, principalId, principalType: "human", status: "active", emailVerified: true, mfaEnrolled: true, expiresAt: null }; }
function roleGrant(principalId, roleId) { return { tenantId: TENANT, principalId, roleId, status: "active", effectiveFrom: "2026-01-01T00:00:00.000Z", validUntil: "2030-01-01T00:00:00.000Z" }; }

function withSpecialist(state, journeyType) {
  if (!PERSISTENT_SPECIALIST_JOURNEY_TYPES.includes(journeyType)) return state;
  const template = PRODUCT_TEMPLATE_CATALOGUE[journeyType];
  const proposed = proposeSpecialistJourneyConfiguration(state, { tenantId: TENANT, requestId: `specialist-request-${journeyType}`, configurationId: `specialist-${journeyType}`, journeyType, productTemplateRef: template.templateId, productTemplateVersion: template.version, productTemplateChecksumSha256: template.templateChecksumSha256, schemaVersion: "1", policyVersionRef: `bundle/${journeyType}`, workflowVersionRef: `workflow/${journeyType}`, accountingPolicyRef: `accounting/${journeyType}`, assignedRoleIds: ["application_maker", "application_checker"], kernelConfiguration: kernel(journeyType), idempotencyKey: `specialist/${journeyType}`, proposedBy: "maker-1" }, NOW);
  const approved = approveSpecialistJourneyConfiguration(proposed.state, { tenantId: TENANT, requestId: `specialist-request-${journeyType}`, approvedBy: "checker-1", approvalRef: `approval/${journeyType}` }, NOW);
  const key = `${TENANT}:${journeyType}`, current = approved.state.journeyApplicationLineage[key];
  const { recordChecksumSha256: _old, ...core } = current;
  const nextCore = { ...core, specialistConfiguration: item(approved.configuration.configurationId) };
  nextCore.specialistConfiguration = { ref: approved.configuration.configurationId, version: approved.configuration.version, checksumSha256: approved.configuration.configurationChecksumSha256 };
  return { ...approved.state, journeyApplicationLineage: { ...approved.state.journeyApplicationLineage, [key]: { ...nextCore, recordChecksumSha256: sum(nextCore) } } };
}

function input(journeyType) { return { tenantId: TENANT, draftId: `draft-${journeyType}`, applicationId: `application-${journeyType}`, subjectRef: `subject/${journeyType}`, makerPrincipalId: "maker-1", checkerPrincipalId: "checker-1", idempotencyKey: `application/${journeyType}` }; }

test("all 21 submitted journeys atomically open an immutable application and lifecycle, with exactly 17 specialist cases", () => {
  for (const journeyType of PRODUCT_JOURNEY_TYPES) {
    const state = withSpecialist(baseState(journeyType), journeyType);
    const promoted = promoteSubmittedJourneyDraft(state, input(journeyType), NOW);
    assert.equal(promoted.application.journeyType, journeyType);
    assert.equal(promoted.application.status, "open");
    assert.equal(promoted.lifecycle.currentStage, "application_capture");
    assert.equal(Boolean(promoted.specialistCase), PERSISTENT_SPECIALIST_JOURNEY_TYPES.includes(journeyType));
    assert.match(promoted.application.applicationChecksumSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(projectJourneyApplication(promoted.state, { tenantId: TENANT, applicationId: promoted.application.applicationId }), promoted.application);
    assert.equal(promoteSubmittedJourneyDraft(promoted.state, input(journeyType), NOW).idempotent, true);
  }
});

test("tenant, draft ownership, independent staffing and effective authority fail closed without partial activation", () => {
  const journeyType = "personal_loan", state = baseState(journeyType), request = input(journeyType);
  for (const [mutation, code] of [
    [(s, i) => ({ s, i: { ...i, tenantId: "tenant-b" } }), "journey_application_draft_missing"],
    [(s, i) => ({ s, i: { ...i, checkerPrincipalId: i.makerPrincipalId } }), "journey_application_four_eyes_required"],
    [(s, i) => { s.journeyWorkspaceDrafts[`${TENANT}:${i.draftId}`].actorId = "other"; return { s, i }; }, "journey_application_draft_tampered"],
    [(s, i) => { delete s.saasRoleGrants.checker; return { s, i }; }, "journey_application_authority_missing"]
  ]) {
    const { s, i } = mutation(structuredClone(state), request);
    assert.throws(() => promoteSubmittedJourneyDraft(s, i, NOW), (error) => error.code === code, code);
    assert.equal(s.journeyApplications, undefined);
    assert.equal(s.composedJourneyLifecycles, undefined);
  }
});

test("inactive, stale, tampered and missing dependent records block atomically", () => {
  const journeyType = "home_loan", original = withSpecialist(baseState(journeyType), journeyType), request = input(journeyType);
  const cases = [
    [s => { s.productPlatformAdministration.products[`${TENANT}:${journeyType}`].status = "suspended"; }, "journey_application_product_inactive"],
    [s => { s.journeyWorkspaceDrafts[`${TENANT}:${request.draftId}`].schemaVersion = 999; }, "journey_application_draft_tampered"],
    [s => { s.productPlatformAdministration.products[`${TENANT}:${journeyType}`].configuration.channels.push("field"); }, "journey_application_product_tampered"],
    [s => { s.journeyApplicationLineage[`${TENANT}:${journeyType}`].workflow.ref = "workflow/tampered"; }, "journey_application_lineage_tampered"],
    [s => { delete s.brandReleases[`${TENANT}:brand-1`]; }, "journey_application_brand_release_missing"],
    [s => { delete s.specialistJourneyConfigurations[`${TENANT}:specialist-${journeyType}`]; }, "journey_application_specialist_configuration_missing"]
  ];
  for (const [mutate, code] of cases) {
    const state = structuredClone(original); mutate(state);
    assert.throws(() => promoteSubmittedJourneyDraft(state, request, NOW), (error) => error.code === code, code);
    assert.equal(state.journeyApplications, undefined);
    assert.equal(state.composedJourneyLifecycles, undefined);
    assert.equal(state.specialistJourneyCases, undefined);
  }
});

test("application integrity and idempotency intent are immutable", () => {
  const created = promoteSubmittedJourneyDraft(baseState("personal_loan"), input("personal_loan"), NOW);
  assert.throws(() => promoteSubmittedJourneyDraft(created.state, { ...input("personal_loan"), subjectRef: "subject/changed" }, NOW), (error) => error.code === "journey_application_idempotency_conflict");
  const tampered = structuredClone(created.state);
  tampered.journeyApplications[`${TENANT}:application-personal_loan`].requestedAmountPaise = "1";
  assert.throws(() => projectJourneyApplication(tampered, { tenantId: TENANT, applicationId: "application-personal_loan" }), (error) => error.code === "journey_application_integrity_failure");
});
