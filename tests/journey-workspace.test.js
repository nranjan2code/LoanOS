import assert from "node:assert/strict";
import test from "node:test";

import {
  JOURNEY_WORKSPACE_ARCHETYPES,
  JOURNEY_WORKSPACE_CHANNELS,
  JOURNEY_WORKSPACE_SCHEMAS,
  PRODUCT_TO_WORKSPACE_ARCHETYPE,
  listJourneyWorkspaceDrafts,
  projectJourneyWorkspaceCatalogue,
  projectJourneyWorkspaceSchema,
  saveJourneyWorkspaceDraft,
  validateJourneyWorkspaceCatalogue
} from "../packages/core/src/journey-workspace.js";
import { PRODUCT_JOURNEY_TYPES } from "../packages/core/src/product-journey-administration.js";
import { PRODUCT_JOURNEY_CONTRACTS } from "../packages/core/src/product-journey-contracts.js";

const NOW = new Date("2026-07-15T10:00:00.000Z");
const subscription = { subscriptionId: "sub-1", tenantId: "tenant-a", productTypes: PRODUCT_JOURNEY_TYPES, effectiveFrom: "2026-01-01T00:00:00.000Z", validUntil: "2030-01-01T00:00:00.000Z", status: "active" };
const state = { tenantProductSubscriptions: { "sub-1": subscription } };
const borrower = { tenantId: "tenant-a", channel: "borrower", principalType: "borrower", roles: [], actorId: "borrower-1" };

test("21 governed product schemas cover every canonical contract fact and evidence", () => {
  assert.equal(JOURNEY_WORKSPACE_ARCHETYPES.length, 11);
  assert.equal(Object.keys(JOURNEY_WORKSPACE_SCHEMAS).length, 21);
  assert.deepEqual(Object.keys(PRODUCT_TO_WORKSPACE_ARCHETYPE).sort(), [...PRODUCT_JOURNEY_TYPES].sort());
  assert.equal(new Set(Object.values(PRODUCT_TO_WORKSPACE_ARCHETYPE)).size, 11);
  assert.deepEqual(validateJourneyWorkspaceCatalogue(), { valid: true, errors: [], journeyCount: 21, schemaCount: 21 });
  for (const [journeyType, schema] of Object.entries(JOURNEY_WORKSPACE_SCHEMAS)) {
    const contract = PRODUCT_JOURNEY_CONTRACTS[journeyType];
    assert.match(schema.schemaChecksumSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(schema.sections.flatMap((section) => section.fields.map((item) => item.fieldId)), contract.requiredFacts);
    assert.deepEqual(schema.documents.map((item) => item.documentType), contract.requiredEvidence);
    for (const item of [...schema.sections.flatMap((section) => section.fields), ...schema.documents]) {
      assert.notEqual((item.label ?? item.title).en, (item.label ?? item.title).hi);
      assert.doesNotMatch((item.label ?? item.title).hi, /[A-Za-z]/);
    }
    assert.deepEqual(schema.supportedLanguages, ["en", "hi"]);
    assert.equal(schema.privacy.browserPersistence, "prohibited");
    assert.equal(schema.privacy.businessDataCaching, "prohibited");
  }
  assert.notDeepEqual(JOURNEY_WORKSPACE_SCHEMAS.home_loan.sections, JOURNEY_WORKSPACE_SCHEMAS.loan_against_property.sections);
  assert.notDeepEqual(JOURNEY_WORKSPACE_SCHEMAS.personal_loan.sections, JOURNEY_WORKSPACE_SCHEMAS.msme_term_loan.sections);
  assert.notDeepEqual(JOURNEY_WORKSPACE_SCHEMAS.invoice_discounting.sections, JOURNEY_WORKSPACE_SCHEMAS.purchase_order_finance.sections);
});

test("catalogue fails closed on entitlement and channel authority", () => {
  const projected = projectJourneyWorkspaceCatalogue(state, borrower);
  assert.equal(projected.journeyCount, 21);
  assert.equal(projected.schemaCount, 21);
  assert.throws(() => projectJourneyWorkspaceSchema({}, { ...borrower, journeyType: "home_loan" }), (error) => error.code === "journey_workspace_not_entitled");
  assert.throws(() => projectJourneyWorkspaceCatalogue(state, { ...borrower, channel: "credit" }), (error) => error.code === "journey_workspace_channel_forbidden");
  assert.throws(() => projectJourneyWorkspaceCatalogue(state, { ...borrower, channel: "field", principalType: "tenant_user", roles: ["partner_user"] }), (error) => error.code === "journey_workspace_channel_forbidden");
  for (const channel of JOURNEY_WORKSPACE_CHANNELS.filter((item) => item !== "borrower")) assert.throws(() => projectJourneyWorkspaceCatalogue(state, { ...borrower, channel }), /authenticated same-tenant human|authorised/);
});

test("channel projection omits internal custody fields and filters role-bound actions", () => {
  const branch = projectJourneyWorkspaceSchema(state, { tenantId: "tenant-a", journeyType: "gold_loan", channel: "branch", principalType: "tenant_user", roles: ["branch_operator"] });
  const fieldIds = branch.sections.flatMap((section) => section.fields.map((item) => item.fieldId));
  assert.equal(fieldIds.includes("vault_location_ref"), false);
  assert.equal(branch.actions.some((item) => item.actionId === "close_account"), false);
  const operations = projectJourneyWorkspaceSchema(state, { tenantId: "tenant-a", journeyType: "gold_loan", channel: "operations", principalType: "tenant_user", roles: ["operations_checker"] });
  assert.ok(operations.sections.flatMap((section) => section.fields).find((item) => item.fieldId === "vault_location_ref"));
  assert.equal(operations.actions.some((item) => item.actionId === "close_account"), true);
  const maker = projectJourneyWorkspaceSchema(state, { tenantId: "tenant-a", journeyType: "gold_loan", channel: "operations", principalType: "tenant_user", roles: ["operations_maker"] });
  assert.equal(maker.actions.some((item) => item.actionId === "close_account"), false);
});

test("server-side drafts bind actor, tenant, channel and immutable schema while masking response values", () => {
  const input = { ...borrower, journeyType: "home_loan", draftId: "draft-1", idempotencyKey: "idem-1", values: { property_ref: "property/1", transaction_type: "purchase", agreement_value_paise: "5000000" } };
  const saved = saveJourneyWorkspaceDraft(state, input, NOW);
  assert.equal(saved.draft.status, "draft");
  assert.notEqual(saved.draft.values.agreement_value_paise, input.values.agreement_value_paise);
  assert.equal(saved.persistedDraft.values.agreement_value_paise, input.values.agreement_value_paise);
  assert.equal(saved.draft.schemaChecksumSha256, JOURNEY_WORKSPACE_SCHEMAS.home_loan.schemaChecksumSha256);
  const replay = saveJourneyWorkspaceDraft(saved.state, input, NOW);
  assert.equal(replay.idempotent, true);
  assert.throws(() => saveJourneyWorkspaceDraft(saved.state, { ...input, actorId: "borrower-2" }, NOW), (error) => error.code === "journey_workspace_draft_not_found");
  assert.throws(() => saveJourneyWorkspaceDraft(state, { ...input, values: { ...input.values, vault_location_ref: "vault/secret" } }, NOW), (error) => error.code === "journey_workspace_field_forbidden");
  assert.equal(listJourneyWorkspaceDrafts(saved.state, borrower).drafts.length, 1);
});

test("submission requires all channel-visible mandatory facts and exact money strings", () => {
  assert.throws(() => saveJourneyWorkspaceDraft(state, { ...borrower, journeyType: "personal_loan", draftId: "draft-submit", idempotencyKey: "submit-1", values: { employment_type: "salaried" }, submit: true }, NOW), (error) => error.code === "journey_workspace_required_field_missing");
  assert.throws(() => saveJourneyWorkspaceDraft(state, { ...borrower, journeyType: "personal_loan", draftId: "draft-bad-money", idempotencyKey: "submit-2", values: { monthly_income_paise: "1.25" } }, NOW), (error) => error.code === "journey_workspace_value_type_invalid");
});
