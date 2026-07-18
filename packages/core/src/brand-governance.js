/**
 * Brand governance: a tenant's white-label brand identity (theme, legal
 * identity, localized copy, channel overlays, co-branding, asset manifest)
 * as a versioned, checksum-sealed, four-eyes-approved release, layered by
 * scope (tenant -> regulated_entity -> programme -> product) so a more
 * specific scope's release overlays the broader one rather than replacing
 * it wholesale (`resolveBrandExperience`'s `chain`/`deepMerge`). This
 * module owns brand *content* and its release lifecycle (propose -> approve
 * -> publish -> supersede/rollback) — it does not own product/journey
 * definitions themselves (`applicableJourneyTypes` must reference canonical
 * types from `product-journey-administration.js`) nor rendering; consumers
 * call `resolveBrandExperience` to get the fully merged theme/content/
 * assets for a given tenant/journey/channel/locale.
 *
 * Every release is content-addressed: `seal()`/`checksum()` compute a
 * canonical-JSON SHA-256 over the release body, and `verify()` re-derives
 * it before trusting a stored release — this catches any out-of-band
 * mutation of persisted state. Proposing, approving, and publishing each
 * require a distinct actor from the prior step (four-eyes, plus publisher
 * independence from the proposer) — a release cannot go live without two
 * independent humans having acted on it. Publishing a release
 * automatically supersedes any prior `"published"` release at the *same
 * scope* (`scopeKey`), and `rollbackBrandRelease` can restore a specific
 * superseded release back to published, itself requiring independent
 * proposer/approver.
 */
import { createHash } from "node:crypto";

import { PRODUCT_JOURNEY_TYPES } from "./product-journey-administration.js";

export const BRAND_SCOPE_LEVELS = Object.freeze(["tenant", "regulated_entity", "programme", "product"]);
export const BRAND_CHANNELS = Object.freeze(["borrower", "partner", "branch", "field", "credit", "operations", "control", "administration"]);

const ENTITY_TYPES = new Set(["bank", "nbfc", "nbfc_mfi", "housing_finance_company", "cooperative_bank", "other_regulated_entity"]);

/**
 * Propose a new brand release for a scope. Idempotent on
 * `(tenantId, releaseId)`: an identical repeat proposal returns the
 * existing one; a reused id with different content is a conflict. Fails
 * closed if a `"product"`-scoped release doesn't bind exactly its scoped
 * canonical journey type, or if any nested content (theme colours, legal
 * identity, localized copy per journey, channel overlays, co-branding,
 * asset manifest) fails its own shape checks. The release is checksum-
 * sealed (`seal()`) as part of construction.
 * @param {object} state - holds `brandReleaseProposals`/`brandReleases`.
 * @param {object} input - tenantId, releaseId, proposedBy, scope, version, applicableJourneyTypes, defaultLocale, theme, legalIdentity, localizedContent, channelOverlays, coBranding, assetManifest.
 * @param {Date} [now]
 * @returns {{state: object, release: object, idempotent: boolean}}
 */
export function proposeBrandRelease(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const releaseId = text(input.releaseId, "releaseId");
  const proposedBy = text(input.proposedBy, "proposedBy");
  const scope = normalizeScope(input.scope);
  const version = positiveInteger(input.version, "version");
  const applicableJourneyTypes = uniqueCanonicalJourneys(input.applicableJourneyTypes);
  if (scope.level === "product" && (applicableJourneyTypes.length !== 1 || applicableJourneyTypes[0] !== scope.ref)) {
    fail("brand_product_scope_invalid", "A product brand release must bind exactly its scoped canonical journey.");
  }
  const release = seal({
    tenantId,
    releaseId,
    version,
    scope,
    applicableJourneyTypes,
    defaultLocale: locale(input.defaultLocale, "defaultLocale"),
    theme: normalizeTheme(input.theme),
    legalIdentity: normalizeLegalIdentity(input.legalIdentity),
    localizedContent: normalizeLocalizedContent(input.localizedContent, applicableJourneyTypes, input.defaultLocale),
    channelOverlays: normalizeChannelOverlays(input.channelOverlays),
    coBranding: normalizeCoBranding(input.coBranding),
    assetManifest: normalizeAssetManifest(input.assetManifest),
    proposedBy,
    proposedAt: instant(now),
    status: "pending_approval",
    approvedBy: null,
    approvedAt: null,
    publishedBy: null,
    publishedAt: null,
    supersededAt: null
  });
  const key = releaseKey(tenantId, releaseId);
  const prior = state.brandReleaseProposals?.[key] ?? state.brandReleases?.[key];
  if (prior) {
    if (prior.contentChecksumSha256 !== release.contentChecksumSha256) fail("brand_release_conflict", "Brand release identity was reused with different content.", 409);
    return { state, release: prior, idempotent: true };
  }
  return { state: put(state, "brandReleaseProposals", key, release), release, idempotent: false };
}

/**
 * Approve a `"pending_approval"` proposal in the same tenant. Verifies the
 * proposal's checksum first (`verify()`) and requires an approver
 * independent of the proposer.
 * @param {object} state - holds `brandReleaseProposals`.
 * @param {object} input - tenantId, releaseId, approvedBy.
 * @param {Date} [now]
 * @returns {{state: object, release: object}}
 */
export function approveBrandRelease(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const releaseId = text(input.releaseId, "releaseId");
  const approvedBy = text(input.approvedBy, "approvedBy");
  const key = releaseKey(tenantId, releaseId);
  const proposal = state.brandReleaseProposals?.[key];
  if (!proposal || proposal.tenantId !== tenantId || proposal.status !== "pending_approval") fail("brand_release_not_pending", "A pending same-tenant brand release is required.", 404);
  verify(proposal);
  if (approvedBy === proposal.proposedBy) fail("brand_release_four_eyes_required", "Brand approval requires an independent authenticated human.", 403);
  const approved = reseal({ ...withoutChecksum(proposal), status: "approved", approvedBy, approvedAt: instant(now) });
  return { state: put(state, "brandReleaseProposals", key, approved), release: approved };
}

/**
 * Publish an `"approved"` proposal, making it the live release for its
 * scope. Requires a publisher independent of the proposer. Any other
 * currently `"published"` release at the *same scope* is automatically
 * moved to `"superseded"` first, so exactly one release is ever live per
 * scope.
 * @param {object} state - holds `brandReleaseProposals`/`brandReleases`.
 * @param {object} input - tenantId, releaseId, publishedBy.
 * @param {Date} [now]
 * @returns {{state: object, release: object}}
 */
export function publishBrandRelease(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const releaseId = text(input.releaseId, "releaseId");
  const publishedBy = text(input.publishedBy, "publishedBy");
  const key = releaseKey(tenantId, releaseId);
  const proposal = state.brandReleaseProposals?.[key];
  if (!proposal || proposal.tenantId !== tenantId || proposal.status !== "approved") fail("brand_release_not_approved", "An independently approved same-tenant brand release is required.", 409);
  verify(proposal);
  if (publishedBy === proposal.proposedBy) fail("brand_release_publisher_independence_required", "The proposer cannot publish the release.", 403);
  const timestamp = instant(now);
  let next = state;
  for (const [candidateKey, candidate] of Object.entries(state.brandReleases ?? {})) {
    if (candidate.tenantId !== tenantId || candidate.status !== "published" || scopeKey(candidate.scope) !== scopeKey(proposal.scope)) continue;
    next = put(next, "brandReleases", candidateKey, reseal({ ...withoutChecksum(candidate), status: "superseded", supersededAt: timestamp }));
  }
  const published = reseal({ ...withoutChecksum(proposal), status: "published", publishedBy, publishedAt: timestamp });
  next = put(next, "brandReleases", key, published);
  next = omit(next, "brandReleaseProposals", key);
  return { state: next, release: published };
}

/**
 * Roll back to a previously superseded release for the same scope,
 * re-publishing it and superseding the current one. Requires independent
 * proposer/approver; both the current and target releases' checksums are
 * re-verified before the swap.
 * @param {object} state - holds `brandReleases`.
 * @param {object} input - tenantId, currentReleaseId, targetReleaseId, proposedBy, approvedBy.
 * @param {Date} [now]
 * @returns {{state: object, release: object}} `release` is the restored, now-`"published"` release.
 */
export function rollbackBrandRelease(state = {}, input = {}, now = new Date()) {
  const tenantId = text(input.tenantId, "tenantId");
  const currentReleaseId = text(input.currentReleaseId, "currentReleaseId");
  const targetReleaseId = text(input.targetReleaseId, "targetReleaseId");
  const proposedBy = text(input.proposedBy, "proposedBy");
  const approvedBy = text(input.approvedBy, "approvedBy");
  if (proposedBy === approvedBy) fail("brand_rollback_four_eyes_required", "Rollback requires independent proposal and approval.", 403);
  const currentKey = releaseKey(tenantId, currentReleaseId);
  const targetKey = releaseKey(tenantId, targetReleaseId);
  const current = state.brandReleases?.[currentKey];
  const target = state.brandReleases?.[targetKey];
  if (!current || current.status !== "published" || !target || target.status !== "superseded" || scopeKey(current.scope) !== scopeKey(target.scope)) fail("brand_rollback_target_invalid", "Rollback requires the active release and a superseded release for the same scope.", 409);
  verify(current); verify(target);
  const timestamp = instant(now);
  let next = put(state, "brandReleases", currentKey, reseal({ ...withoutChecksum(current), status: "superseded", supersededAt: timestamp }));
  const restored = reseal({ ...withoutChecksum(target), status: "published", publishedBy: approvedBy, publishedAt: timestamp, supersededAt: null });
  next = put(next, "brandReleases", targetKey, restored);
  return { state: next, release: restored };
}

/**
 * Resolve the fully merged brand experience for a tenant/journey/channel/
 * locale request: starts from the required tenant-scoped published
 * release, then layers (via `deepMerge`) any matching regulated_entity,
 * programme, and product-scoped published releases on top, in that
 * broad-to-narrow order. Fails closed if no tenant release is published,
 * or if more than one published release exists for any single scope
 * (`one()` — ambiguous scope, should never happen given `publishBrandRelease`'s
 * supersession, but checked anyway). Every release in the chain has its
 * checksum re-verified before use.
 * @param {object} state - holds `brandReleases`.
 * @param {object} input - tenantId, journeyType, channel, locale, programmeRef, regulatedEntityRef.
 * @returns {object} frozen resolved experience: theme, content, assets, legalIdentity, coBranding, releaseLineage.
 */
export function resolveBrandExperience(state = {}, input = {}) {
  const tenantId = text(input.tenantId, "tenantId");
  const journeyType = input.journeyType == null ? null : canonicalJourney(input.journeyType, "journeyType");
  const channel = enumValue(input.channel, BRAND_CHANNELS, "channel");
  const requestedLocale = input.locale == null ? null : locale(input.locale, "locale");
  const programmeRef = input.programmeRef == null ? null : text(input.programmeRef, "programmeRef");
  const regulatedEntityRef = input.regulatedEntityRef == null ? null : text(input.regulatedEntityRef, "regulatedEntityRef");
  const releases = Object.values(state.brandReleases ?? {}).filter((item) => item.tenantId === tenantId && item.status === "published" && (!journeyType || item.applicableJourneyTypes.includes(journeyType)));
  const tenantRelease = one(releases.filter((item) => item.scope.level === "tenant"), "brand_tenant_release_ambiguous");
  if (!tenantRelease) fail("brand_tenant_release_missing", "A published tenant brand release is required.", 404);
  const overlays = [
    regulatedEntityRef ? one(releases.filter((item) => item.scope.level === "regulated_entity" && item.scope.ref === regulatedEntityRef), "brand_regulated_entity_release_ambiguous") : null,
    programmeRef ? one(releases.filter((item) => item.scope.level === "programme" && item.scope.ref === programmeRef), "brand_programme_release_ambiguous") : null,
    journeyType ? one(releases.filter((item) => item.scope.level === "product" && item.scope.ref === journeyType), "brand_product_release_ambiguous") : null
  ].filter(Boolean);
  const chain = [tenantRelease, ...overlays];
  for (const release of chain) verify(release);
  const selectedLocale = requestedLocale && chain.some((item) => item.localizedContent[requestedLocale]) ? requestedLocale : tenantRelease.defaultLocale;
  const theme = chain.reduce((value, release) => deepMerge(value, release.theme), {});
  const channelTheme = chain.reduce((value, release) => deepMerge(value, release.channelOverlays[channel] ?? {}), {});
  const content = chain.reduce((value, release) => deepMerge(value, release.localizedContent[selectedLocale] ?? {}), {});
  const assets = chain.reduce((value, release) => deepMerge(value, release.assetManifest), {});
  return Object.freeze({
    tenantId,
    journeyType,
    channel,
    locale: selectedLocale,
    theme: Object.freeze(deepMerge(theme, channelTheme)),
    content: Object.freeze(content),
    assets: Object.freeze(assets),
    legalIdentity: tenantRelease.legalIdentity,
    coBranding: Object.freeze(chain.flatMap((item) => item.coBranding)),
    releaseLineage: Object.freeze(chain.map((item) => ({ releaseId: item.releaseId, version: item.version, scope: item.scope, contentChecksumSha256: item.contentChecksumSha256 })))
  });
}

/**
 * Read-only tenant view of all brand proposals and releases, plus a
 * summary of which scopes currently have a published release.
 * @param {object} state - holds `brandReleaseProposals`/`brandReleases`.
 * @param {{tenantId: string}} input
 * @returns {object} frozen `{tenantId, proposals, releases, activeScopes}`.
 */
export function projectBrandAdministration(state = {}, input = {}) {
  const tenantId = text(input.tenantId, "tenantId");
  const proposals = sameTenant(state.brandReleaseProposals, tenantId);
  const releases = sameTenant(state.brandReleases, tenantId);
  return Object.freeze({ tenantId, proposals, releases, activeScopes: releases.filter((item) => item.status === "published").map((item) => ({ scope: item.scope, releaseId: item.releaseId, version: item.version })) });
}

// Validate and freeze a release's scope; a "product" scope's ref must itself be a canonical journey type.
function normalizeScope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("brand_scope_required", "scope is required.");
  const level = enumValue(value.level, BRAND_SCOPE_LEVELS, "scope.level");
  const ref = level === "tenant" ? null : text(value.ref, "scope.ref");
  if (level === "product") canonicalJourney(ref, "scope.ref");
  return Object.freeze({ level, ref });
}

function normalizeTheme(value) {
  const theme = object(value, "theme");
  const required = ["brandName", "primaryColor", "secondaryColor", "surfaceColor", "textColor", "fontFamily"];
  for (const field of required) text(theme[field], `theme.${field}`);
  for (const field of ["primaryColor", "secondaryColor", "surfaceColor", "textColor"]) if (!/^#[0-9a-f]{6}$/i.test(theme[field])) fail("brand_colour_invalid", `${field} must be a six-digit hex colour.`);
  return Object.freeze(structuredClone(theme));
}

function normalizeLegalIdentity(value) {
  const identity = object(value, "legalIdentity");
  for (const field of ["regulatedEntityRef", "regulatedEntityName", "registrationNumber", "grievanceOfficerName", "grievanceEmail", "grievancePhone", "privacyUrl", "termsUrl"]) text(identity[field], `legalIdentity.${field}`);
  enumValue(identity.entityType, ENTITY_TYPES, "legalIdentity.entityType");
  return Object.freeze(structuredClone(identity));
}

function normalizeLocalizedContent(value, journeys, defaultLocale) {
  const content = object(value, "localizedContent");
  const defaultKey = locale(defaultLocale, "defaultLocale");
  if (!content[defaultKey]) fail("brand_default_locale_missing", "localizedContent must include the default locale.");
  const normalized = {};
  for (const [language, pack] of Object.entries(content)) {
    locale(language, `localizedContent.${language}`);
    const item = object(pack, `localizedContent.${language}`);
    for (const field of ["applicationTitle", "supportLabel", "privacyLabel", "termsLabel"]) text(item[field], `localizedContent.${language}.${field}`);
    const journeyContent = object(item.journeys, `localizedContent.${language}.journeys`);
    for (const journeyType of journeys) {
      const copy = object(journeyContent[journeyType], `localizedContent.${language}.journeys.${journeyType}`);
      for (const field of ["displayName", "shortDescription", "eligibilityGuidance", "primaryActionLabel"]) text(copy[field], `localizedContent.${language}.journeys.${journeyType}.${field}`);
    }
    normalized[language] = structuredClone(item);
  }
  return Object.freeze(normalized);
}

function normalizeChannelOverlays(value = {}) {
  const overlays = object(value, "channelOverlays");
  const result = {};
  for (const [channel, theme] of Object.entries(overlays)) {
    enumValue(channel, BRAND_CHANNELS, `channelOverlays.${channel}`);
    result[channel] = structuredClone(object(theme, `channelOverlays.${channel}`));
  }
  return Object.freeze(result);
}

function normalizeCoBranding(value = []) {
  if (!Array.isArray(value)) fail("brand_cobranding_invalid", "coBranding must be an array.");
  return Object.freeze(value.map((item, index) => Object.freeze({ partnerRef: text(item?.partnerRef, `coBranding[${index}].partnerRef`), displayName: text(item?.displayName, `coBranding[${index}].displayName`), logoAssetRef: text(item?.logoAssetRef, `coBranding[${index}].logoAssetRef`), placement: enumValue(item?.placement, ["endorsed_by", "powered_by", "joint"], `coBranding[${index}].placement`) })));
}

function normalizeAssetManifest(value) {
  const assets = object(value, "assetManifest");
  for (const field of ["primaryLogo", "compactLogo", "favicon"]) text(assets[field], `assetManifest.${field}`);
  return Object.freeze(structuredClone(assets));
}

function uniqueCanonicalJourneys(value) {
  if (!Array.isArray(value) || value.length === 0) fail("brand_journeys_required", "applicableJourneyTypes must be non-empty.");
  const result = [...new Set(value.map((item) => canonicalJourney(item, "applicableJourneyTypes")))].sort();
  return Object.freeze(result);
}

function canonicalJourney(value, field) { const result = text(value, field); if (!PRODUCT_JOURNEY_TYPES.includes(result)) fail("brand_journey_invalid", `${field} must use a canonical journey type.`); return result; }
function locale(value, field) { const result = text(value, field); if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(result)) fail("brand_locale_invalid", `${field} must be a BCP-47 language tag.`); return result; }
function object(value, field) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("brand_object_required", `${field} must be an object.`); return value; }
function text(value, field) { if (typeof value !== "string" || value.trim() === "") fail("brand_text_required", `${field} is required.`); return value.trim(); }
function positiveInteger(value, field) { if (!Number.isInteger(value) || value < 1) fail("brand_version_invalid", `${field} must be a positive integer.`); return value; }
function enumValue(value, allowed, field) { const result = text(value, field); if (!(allowed instanceof Set ? allowed.has(result) : allowed.includes(result))) fail("brand_enum_invalid", `${field} is invalid.`); return result; }
function instant(value) { const result = value instanceof Date ? value.toISOString() : new Date(value).toISOString(); if (result === "Invalid Date") fail("brand_time_invalid", "A valid timestamp is required."); return result; }
function releaseKey(tenantId, releaseId) { return `${tenantId}:${releaseId}`; }
function scopeKey(scope) { return `${scope.level}:${scope.ref ?? "tenant"}`; }
function put(state, collection, key, value) { return { ...state, [collection]: { ...(state[collection] ?? {}), [key]: value } }; }
function omit(state, collection, key) { const next = { ...(state[collection] ?? {}) }; delete next[key]; return { ...state, [collection]: next }; }
function sameTenant(collection = {}, tenantId) { return Object.values(collection).filter((item) => item.tenantId === tenantId).sort((a, b) => a.releaseId.localeCompare(b.releaseId)); }
function one(items, code) { if (items.length > 1) fail(code, "More than one published release exists for the requested scope.", 409); return items[0] ?? null; }
function withoutChecksum(value) { const { contentChecksumSha256, ...rest } = value; return rest; }
function seal(value) { return Object.freeze({ ...value, contentChecksumSha256: checksum(value) }); }
function reseal(value) { return seal(value); }
function verify(value) { if (checksum(withoutChecksum(value)) !== value.contentChecksumSha256) fail("brand_release_integrity_failure", "Brand release integrity verification failed.", 409); }
function checksum(value) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
// Sort object keys recursively so the checksum is stable regardless of key insertion order.
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value; }
// Recursive object merge (overlay wins per-key); arrays and non-object overlay values replace outright rather than merging element-wise.
function deepMerge(base, overlay) { if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return overlay ?? base; const result = { ...(base ?? {}) }; for (const [key, value] of Object.entries(overlay)) result[key] = value && typeof value === "object" && !Array.isArray(value) ? deepMerge(result[key], value) : value; return result; }
function fail(code, message, statusCode = 422) { const error = new Error(message); error.code = code; error.statusCode = statusCode; throw error; }
