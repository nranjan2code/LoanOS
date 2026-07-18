import { createHash } from "node:crypto";

import { PRODUCT_JOURNEY_TYPES } from "./product-journey-administration.js";
import { PRODUCT_JOURNEY_ARCHETYPES } from "./product-journey-conformance.js";
import { PRODUCT_JOURNEY_CONTRACTS } from "./product-journey-contracts.js";
import { PRODUCT_JOURNEY_WORKSPACE_SCHEMAS } from "./product-journey-schemas.js";

export const JOURNEY_WORKSPACE_CHANNELS = Object.freeze(["borrower", "branch", "partner", "field", "credit", "operations", "control"]);
export const JOURNEY_WORKSPACE_ARCHETYPES = Object.freeze([
  "term_lending", "property_secured", "asset_finance", "gold_custody", "revolving_working_capital",
  "co_lending", "trade_receivables", "seasonal_field", "group_field", "merchant_pos", "priority_term"
]);

export const PRODUCT_TO_WORKSPACE_ARCHETYPE = Object.freeze(Object.fromEntries(
  Object.entries(PRODUCT_JOURNEY_ARCHETYPES).map(([journeyType, archetype]) => [journeyType, ["business_term", "unsecured_term"].includes(archetype) ? "term_lending" : archetype])
));

export const JOURNEY_WORKSPACE_SCHEMAS = PRODUCT_JOURNEY_WORKSPACE_SCHEMAS;

export function validateJourneyWorkspaceCatalogue() {
  const errors = [];
  if (Object.keys(JOURNEY_WORKSPACE_SCHEMAS).length !== 21) errors.push("Exactly 21 product workspace schemas are required.");
  for (const journeyType of PRODUCT_JOURNEY_TYPES) if (!JOURNEY_WORKSPACE_SCHEMAS[journeyType]) errors.push(`${journeyType} has no product workspace schema.`);
  for (const [journeyType, schema] of Object.entries(JOURNEY_WORKSPACE_SCHEMAS)) {
    const contract = PRODUCT_JOURNEY_CONTRACTS[journeyType];
    const fieldIds = schema.sections.flatMap((section) => section.fields.map((item) => item.fieldId));
    if (new Set(fieldIds).size !== fieldIds.length) errors.push(`${schema.schemaId} contains duplicate field identifiers.`);
    for (const item of schema.sections.flatMap((section) => section.fields)) if (!item.dataClass || !item.exposure) errors.push(`${schema.schemaId}.${item.fieldId} has no data handling policy.`);
    const { schemaChecksumSha256, ...core } = schema;
    if (schemaChecksumSha256 !== hash(core)) errors.push(`${schema.schemaId} checksum is invalid.`);
    if (!contract || schema.contractChecksumSha256 !== contract.checksumSha256) errors.push(`${schema.schemaId} is not bound to its product contract.`);
    for (const factId of contract?.requiredFacts ?? []) if (!fieldIds.includes(factId)) errors.push(`${schema.schemaId} omits required fact ${factId}.`);
    const evidenceIds = schema.documents.map((item) => item.documentType);
    for (const evidenceId of contract?.requiredEvidence ?? []) if (!evidenceIds.includes(evidenceId)) errors.push(`${schema.schemaId} omits required evidence ${evidenceId}.`);
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
  return { tenantId, channel, schemaCount: entitled.length, journeyCount: entitled.length, journeys: entitled.map((journeyType) => projectJourneyWorkspaceSchema(state, { ...input, tenantId, channel, journeyType, entitledJourneyTypes: entitled })) };
}

export function projectJourneyWorkspaceSchema(state = {}, input = {}) {
  const tenantId = required(input.tenantId, "tenantId");
  const journeyType = required(input.journeyType, "journeyType");
  if (!PRODUCT_JOURNEY_TYPES.includes(journeyType)) fail("journey_workspace_type_invalid", "A canonical journey type is required.");
  const channel = authorizeChannel(input.channel, input.principalType, input.roles ?? []);
  const entitled = input.entitledJourneyTypes ?? resolveEntitledJourneyTypes(state, tenantId);
  if (!entitled.includes(journeyType)) fail("journey_workspace_not_entitled", "This journey is not active for the tenant.", 403);
  const schema = JOURNEY_WORKSPACE_SCHEMAS[journeyType];
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
  if (field.type === "boolean" && typeof value !== "boolean") fail("journey_workspace_value_type_invalid", `${field.fieldId} must be a boolean.`);
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
