import test from "node:test";
import assert from "node:assert/strict";

import {
  approveBrandRelease,
  projectBrandAdministration,
  proposeBrandRelease,
  publishBrandRelease,
  resolveBrandExperience,
  rollbackBrandRelease
} from "../packages/core/src/brand-governance.js";
import { PRODUCT_JOURNEY_TYPES } from "../packages/core/src/product-journey-administration.js";

const tenantId = "tenant_brand_a";

function releaseInput(overrides = {}) {
  const journeys = overrides.applicableJourneyTypes ?? PRODUCT_JOURNEY_TYPES;
  return {
    tenantId,
    releaseId: "brand_v1",
    version: 1,
    scope: { level: "tenant" },
    applicableJourneyTypes: journeys,
    defaultLocale: "en",
    theme: {
      brandName: "Example Bank",
      primaryColor: "#123456",
      secondaryColor: "#345678",
      surfaceColor: "#ffffff",
      textColor: "#111111",
      fontFamily: "Inter, sans-serif"
    },
    legalIdentity: {
      regulatedEntityRef: "re_example",
      regulatedEntityName: "Example Bank Limited",
      registrationNumber: "RBI-EXAMPLE-001",
      entityType: "bank",
      grievanceOfficerName: "Grievance Officer",
      grievanceEmail: "grievance@example.test",
      grievancePhone: "+911140000000",
      privacyUrl: "https://example.test/privacy",
      termsUrl: "https://example.test/terms"
    },
    localizedContent: {
      en: {
        applicationTitle: "Apply with Example Bank",
        supportLabel: "Get help",
        privacyLabel: "Privacy",
        termsLabel: "Terms",
        journeys: Object.fromEntries(journeys.map((journeyType) => [journeyType, {
          displayName: journeyType.replaceAll("_", " "),
          shortDescription: `Apply for ${journeyType}`,
          eligibilityGuidance: `Eligibility for ${journeyType}`,
          primaryActionLabel: "Start application"
        }]))
      }
    },
    channelOverlays: { borrower: { primaryColor: "#654321" } },
    coBranding: [],
    assetManifest: { primaryLogo: "asset/logo.svg", compactLogo: "asset/mark.svg", favicon: "asset/favicon.svg" },
    proposedBy: "maker_1",
    ...overrides
  };
}

function publish(state, input, approver = "checker_1", publisher = "publisher_1") {
  const proposed = proposeBrandRelease(state, input, new Date("2026-01-01T00:00:00Z"));
  const approved = approveBrandRelease(proposed.state, { tenantId: input.tenantId, releaseId: input.releaseId, approvedBy: approver }, new Date("2026-01-01T01:00:00Z"));
  return publishBrandRelease(approved.state, { tenantId: input.tenantId, releaseId: input.releaseId, publishedBy: publisher }, new Date("2026-01-01T02:00:00Z"));
}

test("tenant brand release covers all 21 journeys and resolves channel theme with legal identity", () => {
  const result = publish({}, releaseInput());
  const experience = resolveBrandExperience(result.state, { tenantId, journeyType: "gold_loan", channel: "borrower", locale: "en" });
  assert.equal(experience.theme.brandName, "Example Bank");
  assert.equal(experience.theme.primaryColor, "#654321");
  assert.equal(experience.legalIdentity.regulatedEntityName, "Example Bank Limited");
  assert.equal(experience.content.journeys.gold_loan.primaryActionLabel, "Start application");
  assert.equal(experience.releaseLineage.length, 1);
  assert.equal(projectBrandAdministration(result.state, { tenantId }).activeScopes.length, 1);
});

test("product overlay changes product content without replacing regulated legal identity", () => {
  let state = publish({}, releaseInput()).state;
  const overlay = releaseInput({
    releaseId: "gold_brand_v1",
    scope: { level: "product", ref: "gold_loan" },
    applicableJourneyTypes: ["gold_loan"],
    theme: { ...releaseInput().theme, brandName: "Example Gold", primaryColor: "#886600" },
    localizedContent: {
      en: {
        applicationTitle: "Example Gold Loan",
        supportLabel: "Gold loan support",
        privacyLabel: "Privacy",
        termsLabel: "Terms",
        journeys: { gold_loan: { displayName: "Example Gold Loan", shortDescription: "Secured against gold", eligibilityGuidance: "Visit an enabled branch", primaryActionLabel: "Begin gold assessment" } }
      }
    }
  });
  state = publish(state, overlay, "checker_2", "publisher_2").state;
  const experience = resolveBrandExperience(state, { tenantId, journeyType: "gold_loan", channel: "branch", locale: "en" });
  assert.equal(experience.theme.brandName, "Example Gold");
  assert.equal(experience.content.journeys.gold_loan.primaryActionLabel, "Begin gold assessment");
  assert.equal(experience.legalIdentity.regulatedEntityName, "Example Bank Limited");
  assert.equal(experience.releaseLineage.length, 2);
});

test("approval, publication and rollback require governed independent actors", () => {
  const proposed = proposeBrandRelease({}, releaseInput());
  assert.throws(() => approveBrandRelease(proposed.state, { tenantId, releaseId: "brand_v1", approvedBy: "maker_1" }), /independent/);
  const approved = approveBrandRelease(proposed.state, { tenantId, releaseId: "brand_v1", approvedBy: "checker_1" });
  assert.throws(() => publishBrandRelease(approved.state, { tenantId, releaseId: "brand_v1", publishedBy: "maker_1" }), /proposer/);
  let state = publishBrandRelease(approved.state, { tenantId, releaseId: "brand_v1", publishedBy: "publisher_1" }).state;
  state = publish(state, releaseInput({ releaseId: "brand_v2", version: 2, theme: { ...releaseInput().theme, primaryColor: "#222222" } }), "checker_2", "publisher_2").state;
  assert.throws(() => rollbackBrandRelease(state, { tenantId, currentReleaseId: "brand_v2", targetReleaseId: "brand_v1", proposedBy: "operator_1", approvedBy: "operator_1" }), /independent/);
  const restored = rollbackBrandRelease(state, { tenantId, currentReleaseId: "brand_v2", targetReleaseId: "brand_v1", proposedBy: "operator_1", approvedBy: "operator_2" });
  assert.equal(restored.release.releaseId, "brand_v1");
  assert.equal(restored.release.status, "published");
});

test("invalid journey aliases, incomplete language packs and cross-tenant resolution fail closed", () => {
  assert.throws(() => proposeBrandRelease({}, releaseInput({ applicableJourneyTypes: ["pl"] })), /canonical journey/);
  const incomplete = releaseInput();
  delete incomplete.localizedContent.en.journeys.gold_loan;
  assert.throws(() => proposeBrandRelease({}, incomplete), /gold_loan/);
  const state = publish({}, releaseInput()).state;
  assert.throws(() => resolveBrandExperience(state, { tenantId: "tenant_other", journeyType: "gold_loan", channel: "borrower" }), /published tenant brand/);
});
