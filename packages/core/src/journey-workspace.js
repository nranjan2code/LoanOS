import { createHash } from "node:crypto";

import { PRODUCT_JOURNEY_TYPES } from "./product-journey-administration.js";
import { PRODUCT_JOURNEY_ARCHETYPES } from "./product-journey-conformance.js";

export const JOURNEY_WORKSPACE_CHANNELS = Object.freeze(["borrower", "branch", "partner", "field", "credit", "operations", "control"]);
export const JOURNEY_WORKSPACE_ARCHETYPES = Object.freeze([
  "term_lending", "property_secured", "asset_finance", "gold_custody", "revolving_working_capital",
  "co_lending", "trade_receivables", "seasonal_field", "group_field", "merchant_pos", "priority_term"
]);

export const PRODUCT_TO_WORKSPACE_ARCHETYPE = Object.freeze(Object.fromEntries(
  Object.entries(PRODUCT_JOURNEY_ARCHETYPES).map(([journeyType, archetype]) => [journeyType, ["business_term", "unsecured_term"].includes(archetype) ? "term_lending" : archetype])
));

const ALL = JOURNEY_WORKSPACE_CHANNELS;
const INTERNAL = Object.freeze(["branch", "credit", "operations", "control"]);
const ASSISTED = Object.freeze(["branch", "partner", "field"]);
const CAPTURE = Object.freeze(["borrower", "branch", "partner", "field"]);
const REVIEW = Object.freeze(["branch", "credit", "operations", "control"]);

const COMMON_FIELDS = Object.freeze([
  field("applicant_name", "Applicant name", "आवेदक का नाम", "text", ALL, "personal", true, "mask"),
  field("mobile_number", "Mobile number", "मोबाइल नंबर", "tel", ALL, "restricted", true, "mask"),
  field("consent_ref", "Consent evidence reference", "सहमति प्रमाण संदर्भ", "reference", ALL, "confidential", true, "full"),
  field("requested_amount_paise", "Requested amount (paise)", "अनुरोधित राशि (पैसे)", "money_string", ALL, "financial", true, "mask"),
  field("requested_tenor_months", "Requested tenor (months)", "अनुरोधित अवधि (माह)", "integer", ALL, "financial", true, "full"),
  field("purpose_code", "Loan purpose", "ऋण का उद्देश्य", "code", ALL, "confidential", true, "full")
]);

const COMMON_DOCUMENTS = Object.freeze([
  document("identity_evidence", "Identity evidence", CAPTURE, "restricted", true, "metadata_only"),
  document("address_evidence", "Address evidence", CAPTURE, "restricted", true, "metadata_only"),
  document("income_evidence", "Income evidence", [...CAPTURE, "credit"], "financial", true, "metadata_only"),
  document("consent_artifact", "Consent artifact", ALL, "confidential", true, "metadata_only")
]);

const COMMON_ACTIONS = Object.freeze([
  action("save_draft", "Save draft", CAPTURE, [], false),
  action("submit_application", "Submit application", CAPTURE, [], false),
  action("request_information", "Request information", REVIEW, ["credit_maker", "operations_maker"], false),
  action("propose_assessment", "Propose assessment", ["credit"], ["credit_maker", "credit_manager"], false),
  action("approve_assessment", "Approve assessment", ["credit"], ["credit_checker", "credit_manager"], true),
  action("record_exception", "Record exception", REVIEW, ["credit_manager", "operations_checker", "compliance_officer"], true)
]);

const SPECIAL = Object.freeze({
  term_lending: spec("Term lending", [
    field("employment_or_business_type", "Employment or business type", "रोज़गार या व्यवसाय प्रकार", "code", ALL, "confidential", true, "full"),
    field("monthly_income_paise", "Monthly income (paise)", "मासिक आय (पैसे)", "money_string", ALL, "financial", true, "mask"),
    field("existing_obligations_paise", "Existing monthly obligations (paise)", "मौजूदा मासिक दायित्व (पैसे)", "money_string", ALL, "financial", true, "mask")
  ], [document("bank_statement", "Bank statement", [...CAPTURE, "credit"], "financial", true, "metadata_only")], [action("verify_cashflow", "Verify cash flow", ["credit"], ["credit_maker"], false)]),
  property_secured: spec("Property-secured lending", [
    field("property_ref", "Property reference", "संपत्ति संदर्भ", "reference", ALL, "confidential", true, "full"),
    field("property_type", "Property type", "संपत्ति प्रकार", "code", ALL, "confidential", true, "full"),
    field("title_review_status", "Title review status", "स्वामित्व जाँच स्थिति", "code", REVIEW, "restricted", true, "full"),
    field("valuation_ref", "Approved valuation reference", "स्वीकृत मूल्यांकन संदर्भ", "reference", REVIEW, "financial", true, "full"),
    field("construction_stage_ref", "Construction stage reference", "निर्माण चरण संदर्भ", "reference", ALL, "confidential", false, "full")
  ], [document("title_chain", "Title chain", [...ASSISTED, "credit", "control"], "restricted", true, "metadata_only"), document("valuation_report", "Valuation report", REVIEW, "financial", true, "metadata_only")], [action("certify_stage", "Certify construction stage", ["field", "operations"], ["field_officer", "operations_maker"], true)]),
  asset_finance: spec("Asset finance", [
    field("asset_type", "Asset type", "परिसंपत्ति प्रकार", "code", ALL, "confidential", true, "full"),
    field("supplier_ref", "Supplier or dealer reference", "आपूर्तिकर्ता या डीलर संदर्भ", "reference", ALL, "confidential", true, "full"),
    field("invoice_amount_paise", "Invoice amount (paise)", "चालान राशि (पैसे)", "money_string", ALL, "financial", true, "mask"),
    field("serial_or_vin", "Serial, chassis or VIN", "सीरियल, चेसिस या VIN", "text", [...ASSISTED, ...REVIEW], "restricted", true, "mask"),
    field("margin_amount_paise", "Borrower margin (paise)", "उधारकर्ता मार्जिन (पैसे)", "money_string", ALL, "financial", true, "mask")
  ], [document("supplier_invoice", "Supplier invoice", ALL, "financial", true, "metadata_only"), document("asset_inspection", "Asset inspection", [...ASSISTED, ...REVIEW], "confidential", true, "metadata_only")], [action("confirm_asset_delivery", "Confirm asset delivery", ["partner", "field", "operations"], ["partner_user", "field_officer", "operations_maker"], true)]),
  gold_custody: spec("Gold custody", [
    field("packet_ref", "Tamper-evident packet reference", "सीलबंद पैकेट संदर्भ", "reference", ["branch", "operations", "control"], "restricted", true, "full"),
    field("gross_weight_grams", "Gross weight (grams)", "कुल वजन (ग्राम)", "decimal_string", ["branch", "operations", "control"], "financial", true, "full"),
    field("net_weight_grams", "Net eligible weight (grams)", "पात्र शुद्ध वजन (ग्राम)", "decimal_string", ["branch", "operations", "control"], "financial", true, "full"),
    field("purity_karat", "Assessed purity (karat)", "जाँची शुद्धता (कैरेट)", "decimal_string", ["branch", "operations", "control"], "financial", true, "full"),
    field("vault_location_ref", "Vault location reference", "वॉल्ट स्थान संदर्भ", "reference", ["operations", "control"], "restricted", true, "omit")
  ], [document("assay_report", "Assay report", ["branch", "operations", "control"], "financial", true, "metadata_only"), document("custody_receipt", "Custody receipt", ["borrower", "branch", "operations", "control"], "confidential", true, "metadata_only")], [action("seal_packet", "Seal custody packet", ["branch", "operations"], ["operations_maker"], true), action("release_packet", "Release custody packet", ["operations", "control"], ["operations_checker"], true)]),
  revolving_working_capital: spec("Revolving working capital", [
    field("facility_limit_paise", "Proposed facility limit (paise)", "प्रस्तावित सीमा (पैसे)", "money_string", ALL, "financial", true, "mask"),
    field("drawing_power_paise", "Current drawing power (paise)", "वर्तमान आहरण शक्ति (पैसे)", "money_string", REVIEW, "financial", true, "mask"),
    field("stock_statement_date", "Stock statement date", "स्टॉक विवरण तिथि", "date", ALL, "financial", true, "full"),
    field("receivables_paise", "Eligible receivables (paise)", "पात्र प्राप्य (पैसे)", "money_string", ALL, "financial", true, "mask")
  ], [document("stock_statement", "Stock statement", ALL, "financial", true, "metadata_only"), document("receivables_ageing", "Receivables ageing", ALL, "financial", true, "metadata_only")], [action("approve_drawing_power", "Approve drawing power", ["credit"], ["credit_checker"], true)]),
  co_lending: spec("Co-lending", [
    field("arrangement_ref", "Co-lending arrangement reference", "सह-ऋण व्यवस्था संदर्भ", "reference", REVIEW, "confidential", true, "full"),
    field("originator_share_bps", "Originator share (basis points)", "प्रवर्तक हिस्सा (बेसिस पॉइंट)", "integer", REVIEW, "financial", true, "full"),
    field("partner_share_bps", "Partner share (basis points)", "साझेदार हिस्सा (बेसिस पॉइंट)", "integer", REVIEW, "financial", true, "full"),
    field("escrow_account_ref", "Escrow account reference", "एस्क्रो खाता संदर्भ", "reference", ["operations", "control"], "restricted", true, "mask")
  ], [document("co_lending_agreement", "Co-lending agreement", REVIEW, "restricted", true, "metadata_only"), document("allocation_statement", "Allocation statement", ["operations", "control"], "financial", true, "metadata_only")], [action("approve_allocation", "Approve lender allocation", ["credit", "operations"], ["credit_checker", "operations_checker"], true)]),
  trade_receivables: spec("Trade and receivables", [
    field("anchor_or_buyer_ref", "Anchor or buyer reference", "एंकर या खरीदार संदर्भ", "reference", ALL, "confidential", true, "full"),
    field("trade_asset_ref", "Invoice or purchase-order reference", "चालान या खरीद आदेश संदर्भ", "reference", ALL, "confidential", true, "full"),
    field("face_value_paise", "Face value (paise)", "अंकित मूल्य (पैसे)", "money_string", ALL, "financial", true, "mask"),
    field("due_date", "Trade asset due date", "व्यापार परिसंपत्ति देय तिथि", "date", ALL, "financial", true, "full"),
    field("acceptance_ref", "Buyer acceptance reference", "खरीदार स्वीकृति संदर्भ", "reference", REVIEW, "confidential", true, "full")
  ], [document("trade_asset", "Invoice or purchase order", ALL, "financial", true, "metadata_only"), document("buyer_acceptance", "Buyer acceptance", REVIEW, "confidential", true, "metadata_only")], [action("verify_trade_asset", "Verify trade asset", ["credit", "operations"], ["credit_maker", "operations_maker"], false), action("approve_trade_draw", "Approve trade draw", ["credit"], ["credit_checker"], true)]),
  seasonal_field: spec("Seasonal and allied finance", [
    field("land_or_activity_ref", "Land or allied activity reference", "भूमि या सहायक गतिविधि संदर्भ", "reference", ALL, "confidential", true, "full"),
    field("crop_or_activity_code", "Crop or activity", "फसल या गतिविधि", "code", ALL, "confidential", true, "full"),
    field("season_code", "Season", "मौसम", "code", ALL, "confidential", true, "full"),
    field("acreage_decimal", "Cultivated acreage", "खेती का क्षेत्रफल", "decimal_string", ALL, "financial", true, "full"),
    field("geo_evidence_ref", "Geotagged field evidence", "जियोटैग किया क्षेत्र प्रमाण", "reference", ["field", "credit", "control"], "restricted", true, "metadata_only")
  ], [document("land_or_tenancy_record", "Land or tenancy record", [...CAPTURE, "credit"], "restricted", true, "metadata_only"), document("field_inspection", "Field inspection", ["field", "credit", "control"], "restricted", true, "metadata_only")], [action("record_field_visit", "Record field visit", ["field"], ["field_officer"], false), action("verify_crop_stage", "Verify crop stage", ["field", "credit"], ["field_supervisor", "credit_maker"], true)]),
  group_field: spec("Group and field lending", [
    field("group_ref", "Group reference", "समूह संदर्भ", "reference", ALL, "confidential", true, "full"),
    field("centre_ref", "Centre or meeting reference", "केंद्र या बैठक संदर्भ", "reference", [...ASSISTED, ...REVIEW], "confidential", true, "full"),
    field("member_sequence", "Member sequence", "सदस्य क्रम", "integer", [...ASSISTED, ...REVIEW], "confidential", true, "full"),
    field("household_income_paise", "Household income (paise)", "परिवार आय (पैसे)", "money_string", ALL, "financial", true, "mask"),
    field("group_attestation_ref", "Group attestation reference", "समूह सत्यापन संदर्भ", "reference", ["field", "credit", "control"], "restricted", true, "full")
  ], [document("group_resolution", "Group resolution", ["field", "credit", "control"], "restricted", true, "metadata_only"), document("household_assessment", "Household assessment", ["field", "credit", "control"], "financial", true, "metadata_only")], [action("record_group_meeting", "Record group meeting", ["field"], ["field_officer"], false), action("approve_group", "Approve group constitution", ["field", "credit"], ["field_supervisor", "credit_checker"], true)]),
  merchant_pos: spec("Merchant point-of-sale finance", [
    field("merchant_ref", "Authorised merchant reference", "अधिकृत व्यापारी संदर्भ", "reference", ALL, "confidential", true, "full"),
    field("sku_ref", "Product SKU reference", "उत्पाद SKU संदर्भ", "reference", ALL, "confidential", true, "full"),
    field("invoice_amount_paise", "Purchase amount (paise)", "खरीद राशि (पैसे)", "money_string", ALL, "financial", true, "mask"),
    field("down_payment_paise", "Down payment (paise)", "डाउन पेमेंट (पैसे)", "money_string", ALL, "financial", true, "mask"),
    field("delivery_otp_ref", "Delivery confirmation reference", "डिलीवरी पुष्टि संदर्भ", "reference", ["partner", "operations", "control"], "restricted", true, "mask")
  ], [document("merchant_invoice", "Merchant invoice", ALL, "financial", true, "metadata_only"), document("delivery_confirmation", "Delivery confirmation", ["partner", "operations", "control"], "restricted", true, "metadata_only")], [action("confirm_pos_delivery", "Confirm delivery", ["partner", "operations"], ["partner_user", "operations_maker"], true)]),
  priority_term: spec("Education and priority term lending", [
    field("institution_ref", "Education institution reference", "शिक्षण संस्थान संदर्भ", "reference", ALL, "confidential", true, "full"),
    field("course_code", "Course", "पाठ्यक्रम", "code", ALL, "confidential", true, "full"),
    field("admission_ref", "Admission reference", "प्रवेश संदर्भ", "reference", ALL, "restricted", true, "mask"),
    field("course_cost_paise", "Total course cost (paise)", "कुल पाठ्यक्रम लागत (पैसे)", "money_string", ALL, "financial", true, "mask"),
    field("moratorium_months", "Requested moratorium (months)", "अनुरोधित स्थगन (माह)", "integer", ALL, "financial", true, "full")
  ], [document("admission_letter", "Admission letter", ALL, "restricted", true, "metadata_only"), document("fee_schedule", "Fee schedule", ALL, "financial", true, "metadata_only")], [action("verify_institution", "Verify institution", ["credit", "operations"], ["credit_maker", "operations_maker"], false)])
});

export const JOURNEY_WORKSPACE_SCHEMAS = Object.freeze(Object.fromEntries(JOURNEY_WORKSPACE_ARCHETYPES.map((archetype) => {
  const definition = SPECIAL[archetype];
  const journeyTypes = PRODUCT_JOURNEY_TYPES.filter((type) => PRODUCT_TO_WORKSPACE_ARCHETYPE[type] === archetype);
  const core = { schemaId: `journey-workspace/${archetype}`, schemaVersion: 1, archetype, journeyTypes, title: definition.title, supportedLanguages: ["en", "hi"], channels: ALL, sections: [
    { sectionId: "applicant_and_request", title: { en: "Applicant and request", hi: "आवेदक और अनुरोध" }, fields: COMMON_FIELDS },
    { sectionId: "specialist_facts", title: definition.title, fields: definition.fields }
  ], documents: [...COMMON_DOCUMENTS, ...definition.documents], actions: [...COMMON_ACTIONS, ...definition.actions], privacy: { browserPersistence: "prohibited", businessDataCaching: "prohibited", offlineMode: "shell_and_schema_only", auditPayloadValues: "prohibited" } };
  return [archetype, Object.freeze({ ...core, schemaChecksumSha256: hash(core) })];
})));

export function validateJourneyWorkspaceCatalogue() {
  const errors = [];
  if (Object.keys(JOURNEY_WORKSPACE_SCHEMAS).length !== 11) errors.push("Exactly 11 workspace schemas are required.");
  for (const journeyType of PRODUCT_JOURNEY_TYPES) if (!JOURNEY_WORKSPACE_SCHEMAS[PRODUCT_TO_WORKSPACE_ARCHETYPE[journeyType]]) errors.push(`${journeyType} has no workspace schema.`);
  for (const schema of Object.values(JOURNEY_WORKSPACE_SCHEMAS)) {
    const fieldIds = schema.sections.flatMap((section) => section.fields.map((item) => item.fieldId));
    if (new Set(fieldIds).size !== fieldIds.length) errors.push(`${schema.schemaId} contains duplicate field identifiers.`);
    for (const item of schema.sections.flatMap((section) => section.fields)) if (!item.dataClass || !item.exposure) errors.push(`${schema.schemaId}.${item.fieldId} has no data handling policy.`);
    const { schemaChecksumSha256, ...core } = schema;
    if (schemaChecksumSha256 !== hash(core)) errors.push(`${schema.schemaId} checksum is invalid.`);
  }
  return { valid: errors.length === 0, errors, journeyCount: PRODUCT_JOURNEY_TYPES.length, schemaCount: Object.keys(JOURNEY_WORKSPACE_SCHEMAS).length };
}

export function resolveEntitledJourneyTypes(state = {}, tenantId) {
  required(tenantId, "tenantId");
  const types = new Set();
  const now = new Date();
  for (const record of Object.values(state.tenantProductSubscriptions ?? {})) {
    if (record.tenantId !== tenantId || record.status !== "active" || new Date(record.effectiveFrom) > now || new Date(record.validUntil) <= now) continue;
    for (const journeyType of record.productTypes ?? []) if (PRODUCT_JOURNEY_TYPES.includes(journeyType)) types.add(journeyType);
  }
  for (const record of Object.values(state.specialistJourneyConfigurations ?? {})) if (record.tenantId === tenantId && record.status === "active" && PRODUCT_JOURNEY_TYPES.includes(record.journeyType)) types.add(record.journeyType);
  for (const record of Object.values(state.productJourneys ?? {})) if (record.tenantId === tenantId && record.status === "active" && PRODUCT_JOURNEY_TYPES.includes(record.journeyType)) types.add(record.journeyType);
  for (const record of Object.values(state.productPolicies ?? {})) if ((record.tenantId == null || record.tenantId === tenantId) && record.status === "active" && PRODUCT_JOURNEY_TYPES.includes(record.productType)) types.add(record.productType);
  return [...types].sort();
}

export function projectJourneyWorkspaceCatalogue(state = {}, input = {}) {
  const tenantId = required(input.tenantId, "tenantId");
  const channel = authorizeChannel(input.channel, input.principalType, input.roles ?? []);
  const entitled = input.entitledJourneyTypes ?? resolveEntitledJourneyTypes(state, tenantId);
  return { tenantId, channel, schemaCount: new Set(entitled.map((type) => PRODUCT_TO_WORKSPACE_ARCHETYPE[type])).size, journeyCount: entitled.length, journeys: entitled.map((journeyType) => projectJourneyWorkspaceSchema(state, { ...input, tenantId, channel, journeyType, entitledJourneyTypes: entitled })) };
}

export function projectJourneyWorkspaceSchema(state = {}, input = {}) {
  const tenantId = required(input.tenantId, "tenantId");
  const journeyType = required(input.journeyType, "journeyType");
  if (!PRODUCT_JOURNEY_TYPES.includes(journeyType)) fail("journey_workspace_type_invalid", "A canonical journey type is required.");
  const channel = authorizeChannel(input.channel, input.principalType, input.roles ?? []);
  const entitled = input.entitledJourneyTypes ?? resolveEntitledJourneyTypes(state, tenantId);
  if (!entitled.includes(journeyType)) fail("journey_workspace_not_entitled", "This journey is not active for the tenant.", 403);
  const schema = JOURNEY_WORKSPACE_SCHEMAS[PRODUCT_TO_WORKSPACE_ARCHETYPE[journeyType]];
  return Object.freeze({ tenantId, journeyType, archetype: schema.archetype, schemaId: schema.schemaId, schemaVersion: schema.schemaVersion, schemaChecksumSha256: schema.schemaChecksumSha256, title: schema.title, supportedLanguages: schema.supportedLanguages, channel, privacy: schema.privacy,
    sections: schema.sections.map((section) => ({ ...section, fields: section.fields.filter((item) => item.channels.includes(channel)).map(publicField) })).filter((section) => section.fields.length),
    documents: schema.documents.filter((item) => item.channels.includes(channel)),
    actions: schema.actions.filter((item) => item.channels.includes(channel) && (item.requiredRoles.length === 0 || item.requiredRoles.some((role) => (input.roles ?? []).includes(role))))
  });
}

export function saveJourneyWorkspaceDraft(state = {}, input = {}, now = new Date()) {
  const projection = projectJourneyWorkspaceSchema(state, input);
  const draftId = required(input.draftId, "draftId");
  const actorId = required(input.actorId, "actorId");
  const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
  const key = `${projection.tenantId}:${draftId}`;
  const prior = state.journeyWorkspaceDrafts?.[key];
  const values = validateValues(projection, input.values ?? {}, input.submit === true);
  const immutable = { tenantId: projection.tenantId, draftId, journeyType: projection.journeyType, channel: projection.channel, actorId, schemaId: projection.schemaId, schemaVersion: projection.schemaVersion, schemaChecksumSha256: projection.schemaChecksumSha256, values, idempotencyKey };
  const contentChecksumSha256 = hash(immutable);
  if (prior) {
    if (prior.tenantId !== projection.tenantId || prior.actorId !== actorId) fail("journey_workspace_draft_not_found", "Draft was not found.", 404);
    if (prior.idempotencyKey === idempotencyKey && prior.contentChecksumSha256 === contentChecksumSha256) return { state, draft: redactDraft(prior, projection), idempotent: true };
    if (["submitted", "cancelled"].includes(prior.status)) fail("journey_workspace_draft_terminal", "A terminal draft cannot be changed.");
  }
  const draft = Object.freeze({ ...immutable, status: input.submit === true ? "submitted" : "draft", contentChecksumSha256, createdAt: prior?.createdAt ?? instant(now), updatedAt: instant(now), submittedAt: input.submit === true ? instant(now) : null });
  const next = { ...state, journeyWorkspaceDrafts: { ...(state.journeyWorkspaceDrafts ?? {}), [key]: draft } };
  return { state: next, draft: redactDraft(draft, projection), persistedDraft: draft, idempotent: false };
}

export function listJourneyWorkspaceDrafts(state = {}, input = {}) {
  const catalogue = projectJourneyWorkspaceCatalogue(state, input);
  const allowed = new Map(catalogue.journeys.map((item) => [item.journeyType, item]));
  const drafts = Object.values(state.journeyWorkspaceDrafts ?? {}).filter((item) => item.tenantId === catalogue.tenantId && item.actorId === input.actorId && item.channel === catalogue.channel && allowed.has(item.journeyType)).map((item) => redactDraft(item, allowed.get(item.journeyType)));
  return { tenantId: catalogue.tenantId, channel: catalogue.channel, drafts };
}

function validateValues(projection, values, submit) {
  if (!values || typeof values !== "object" || Array.isArray(values)) fail("journey_workspace_values_invalid", "values must be an object.");
  const fields = new Map(projection.sections.flatMap((section) => section.fields.map((item) => [item.fieldId, item])));
  for (const key of Object.keys(values)) if (!fields.has(key)) fail("journey_workspace_field_forbidden", `Field ${key} is not available in this channel.`, 403);
  if (submit) for (const item of fields.values()) if (item.required && (values[item.fieldId] == null || values[item.fieldId] === "")) fail("journey_workspace_required_field_missing", `${item.fieldId} is required.`);
  for (const [key, value] of Object.entries(values)) validateType(fields.get(key), value);
  return Object.freeze({ ...values });
}
function validateType(field, value) {
  if (value == null || value === "") return;
  const stringTypes = ["text", "tel", "reference", "code", "date", "money_string", "decimal_string"];
  if (stringTypes.includes(field.type) && typeof value !== "string") fail("journey_workspace_value_type_invalid", `${field.fieldId} must be a string.`);
  if (field.type === "integer" && (!Number.isSafeInteger(value) || value < 0)) fail("journey_workspace_value_type_invalid", `${field.fieldId} must be a non-negative safe integer.`);
  if (field.type === "money_string" && !/^[0-9]+$/.test(value)) fail("journey_workspace_value_type_invalid", `${field.fieldId} must be an exact non-negative paise string.`);
  if (field.type === "decimal_string" && !/^[0-9]+(?:\.[0-9]+)?$/.test(value)) fail("journey_workspace_value_type_invalid", `${field.fieldId} must be an exact non-negative decimal string.`);
  if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("journey_workspace_value_type_invalid", `${field.fieldId} must be an ISO date.`);
}
function redactDraft(draft, projection) {
  const fields = new Map(projection.sections.flatMap((section) => section.fields.map((item) => [item.fieldId, item])));
  const values = Object.fromEntries(Object.entries(draft.values).filter(([key]) => fields.has(key)).map(([key, value]) => [key, redact(value, fields.get(key).exposure)]));
  return { draftId: draft.draftId, journeyType: draft.journeyType, channel: draft.channel, actorId: draft.actorId, schemaId: draft.schemaId, schemaVersion: draft.schemaVersion, schemaChecksumSha256: draft.schemaChecksumSha256, status: draft.status, values, contentChecksumSha256: draft.contentChecksumSha256, createdAt: draft.createdAt, updatedAt: draft.updatedAt, submittedAt: draft.submittedAt };
}
function redact(value, exposure) { if (exposure === "full") return value; if (exposure === "omit") return undefined; const text = String(value); return text.length <= 4 ? "••••" : `${"•".repeat(Math.min(8, text.length - 4))}${text.slice(-4)}`; }
function authorizeChannel(channel, principalType, roles) {
  if (!JOURNEY_WORKSPACE_CHANNELS.includes(channel)) fail("journey_workspace_channel_invalid", "A supported workspace channel is required.");
  if (channel === "borrower") { if (principalType !== "borrower") fail("journey_workspace_channel_forbidden", "Borrower workspace requires a borrower session.", 403); return channel; }
  if (principalType !== "tenant_user") fail("journey_workspace_channel_forbidden", "An authenticated same-tenant human is required.", 403);
  const roleMap = { branch: ["tenant_admin", "branch_operator", "operator"], partner: ["tenant_admin", "partner_user", "partner_admin", "channel_manager"], field: ["tenant_admin", "field_officer", "field_supervisor"], credit: ["tenant_admin", "credit_maker", "credit_checker", "credit_manager"], operations: ["tenant_admin", "operations_maker", "operations_checker", "operator"], control: ["tenant_admin", "security_admin", "compliance_officer", "auditor"] };
  if (!roles.some((role) => roleMap[channel].includes(role))) fail("journey_workspace_channel_forbidden", "The principal is not authorised for this channel.", 403);
  return channel;
}
function publicField(item) { return { fieldId: item.fieldId, label: item.label, type: item.type, required: item.required, dataClass: item.dataClass, exposure: item.exposure, autocomplete: item.dataClass === "restricted" ? "off" : undefined }; }
function field(fieldId, en, hi, type, channels, dataClass, required, exposure) { return Object.freeze({ fieldId, label: { en, hi }, type, channels: Object.freeze([...new Set(channels)]), dataClass, required, exposure }); }
function document(documentType, title, channels, dataClass, required, exposure) { return Object.freeze({ documentType, title: { en: title, hi: title }, channels: Object.freeze([...new Set(channels)]), dataClass, required, exposure }); }
function action(actionId, title, channels, requiredRoles, makerChecker) { return Object.freeze({ actionId, title: { en: title, hi: title }, channels: Object.freeze([...new Set(channels)]), requiredRoles: Object.freeze(requiredRoles), makerChecker, actorAttributionRequired: true }); }
function spec(title, fields, documents, actions) { return Object.freeze({ title: { en: title, hi: title }, fields: Object.freeze(fields), documents: Object.freeze(documents), actions: Object.freeze(actions) }); }
function required(value, field) { if (typeof value !== "string" || !value.trim()) fail("journey_workspace_input_invalid", `${field} is required.`); return value.trim(); }
function instant(value) { const date = value instanceof Date ? value : new Date(value); if (!Number.isFinite(date.getTime())) fail("journey_workspace_input_invalid", "A valid timestamp is required."); return date.toISOString(); }
function canonical(value) { if (value === undefined) return "null"; if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value); if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; throw new Error("invalid_json"); }
function hash(value) { return createHash("sha256").update(canonical(typeof value === "function" ? value() : value)).digest("hex"); }
function fail(code, message, statusCode = 422) { throw Object.assign(new Error(message), { code, statusCode }); }
