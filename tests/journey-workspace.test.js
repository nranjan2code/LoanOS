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

const NOW = new Date("2026-07-15T10:00:00.000Z");
const subscription = { subscriptionId: "sub-1", tenantId: "tenant-a", productTypes: PRODUCT_JOURNEY_TYPES, effectiveFrom: "2026-01-01T00:00:00.000Z", validUntil: "2030-01-01T00:00:00.000Z", status: "active" };
const state = { tenantProductSubscriptions: { "sub-1": subscription } };
const borrower = { tenantId: "tenant-a", channel: "borrower", principalType: "borrower", roles: [], actorId: "borrower-1" };

test("11 governed workspace schemas cover every canonical journey without cloned product applications", () => {
  assert.equal(JOURNEY_WORKSPACE_ARCHETYPES.length, 11);
  assert.equal(Object.keys(JOURNEY_WORKSPACE_SCHEMAS).length, 11);
  assert.deepEqual(Object.keys(PRODUCT_TO_WORKSPACE_ARCHETYPE).sort(), [...PRODUCT_JOURNEY_TYPES].sort());
  assert.equal(new Set(Object.values(PRODUCT_TO_WORKSPACE_ARCHETYPE)).size, 11);
  assert.deepEqual(validateJourneyWorkspaceCatalogue(), { valid: true, errors: [], journeyCount: 21, schemaCount: 11 });
  for (const schema of Object.values(JOURNEY_WORKSPACE_SCHEMAS)) {
    assert.match(schema.schemaChecksumSha256, /^[a-f0-9]{64}$/);
    assert.ok(schema.sections.flatMap((section) => section.fields).length >= 9);
    assert.ok(schema.documents.length >= 5);
    assert.ok(schema.actions.length >= 7);
    assert.deepEqual(schema.supportedLanguages, ["en", "hi"]);
    assert.equal(schema.privacy.browserPersistence, "prohibited");
    assert.equal(schema.privacy.businessDataCaching, "prohibited");
  }
});

test("catalogue fails closed on entitlement and channel authority", () => {
  const projected = projectJourneyWorkspaceCatalogue(state, borrower);
  assert.equal(projected.journeyCount, 21);
  assert.equal(projected.schemaCount, 11);
  assert.throws(() => projectJourneyWorkspaceSchema({}, { ...borrower, journeyType: "home_loan" }), (error) => error.code === "journey_workspace_not_entitled");
  assert.throws(() => projectJourneyWorkspaceCatalogue(state, { ...borrower, channel: "credit" }), (error) => error.code === "journey_workspace_channel_forbidden");
  assert.throws(() => projectJourneyWorkspaceCatalogue(state, { ...borrower, channel: "field", principalType: "tenant_user", roles: ["partner_user"] }), (error) => error.code === "journey_workspace_channel_forbidden");
  for (const channel of JOURNEY_WORKSPACE_CHANNELS.filter((item) => item !== "borrower")) assert.throws(() => projectJourneyWorkspaceCatalogue(state, { ...borrower, channel }), /authenticated same-tenant human|authorised/);
});

test("channel projection omits restricted custody fields and filters role-bound actions", () => {
  const branch = projectJourneyWorkspaceSchema(state, { tenantId: "tenant-a", journeyType: "gold_loan", channel: "branch", principalType: "tenant_user", roles: ["branch_operator"] });
  const fieldIds = branch.sections.flatMap((section) => section.fields.map((item) => item.fieldId));
  assert.equal(fieldIds.includes("vault_location_ref"), false);
  assert.equal(branch.actions.some((item) => item.actionId === "release_packet"), false);
  const operations = projectJourneyWorkspaceSchema(state, { tenantId: "tenant-a", journeyType: "gold_loan", channel: "operations", principalType: "tenant_user", roles: ["operations_checker"] });
  assert.equal(operations.sections.flatMap((section) => section.fields).find((item) => item.fieldId === "vault_location_ref").exposure, "omit");
  assert.equal(operations.actions.some((item) => item.actionId === "release_packet"), true);
});

test("server-side drafts bind actor, tenant, channel and immutable schema while masking response values", () => {
  const input = { ...borrower, journeyType: "home_loan", draftId: "draft-1", idempotencyKey: "idem-1", values: { applicant_name: "Asha Sharma", mobile_number: "9876543210", consent_ref: "consent/1", requested_amount_paise: "5000000", requested_tenor_months: 120, purpose_code: "home_purchase", property_ref: "property/1", property_type: "apartment" } };
  const saved = saveJourneyWorkspaceDraft(state, input, NOW);
  assert.equal(saved.draft.status, "draft");
  assert.notEqual(saved.draft.values.mobile_number, input.values.mobile_number);
  assert.equal(saved.persistedDraft.values.mobile_number, input.values.mobile_number);
  assert.equal(saved.draft.schemaChecksumSha256, JOURNEY_WORKSPACE_SCHEMAS.property_secured.schemaChecksumSha256);
  const replay = saveJourneyWorkspaceDraft(saved.state, input, NOW);
  assert.equal(replay.idempotent, true);
  assert.throws(() => saveJourneyWorkspaceDraft(saved.state, { ...input, actorId: "borrower-2" }, NOW), (error) => error.code === "journey_workspace_draft_not_found");
  assert.throws(() => saveJourneyWorkspaceDraft(state, { ...input, values: { ...input.values, vault_location_ref: "vault/secret" } }, NOW), (error) => error.code === "journey_workspace_field_forbidden");
  assert.equal(listJourneyWorkspaceDrafts(saved.state, borrower).drafts.length, 1);
});

test("submission requires all channel-visible mandatory facts and exact money strings", () => {
  assert.throws(() => saveJourneyWorkspaceDraft(state, { ...borrower, journeyType: "personal_loan", draftId: "draft-submit", idempotencyKey: "submit-1", values: { applicant_name: "Asha" }, submit: true }, NOW), (error) => error.code === "journey_workspace_required_field_missing");
  assert.throws(() => saveJourneyWorkspaceDraft(state, { ...borrower, journeyType: "personal_loan", draftId: "draft-bad-money", idempotencyKey: "submit-2", values: { requested_amount_paise: "1.25" } }, NOW), (error) => error.code === "journey_workspace_value_type_invalid");
});
