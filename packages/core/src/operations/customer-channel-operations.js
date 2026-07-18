/**
 * Customer-facing distribution and lifecycle operations: channel-partner
 * (DSA/BC/connector/dealer/merchant/LSP) onboarding and commission
 * assessment/settlement, lead capture and routing/deduplication, customer
 * relationships (co-applicant/guarantor/nominee/legal-heir/etc.), customer
 * merge (duplicate-record consolidation), and bereavement/succession
 * servicing (nominee/legal-heir claims against a deceased borrower's
 * accounts). This module does not own the underlying loan-account ledger or
 * settlement math — succession service actions call through to
 * `loan-account.js` (`postPaymentToLoanAccount`, `generateClosureCertificate`,
 * `settleLoanAccount`) for the actual money movement, and this module only
 * gates *whether* a claimant is authorised to trigger those actions.
 *
 * Style note: this file (and its siblings in this batch) uses a deliberately
 * terse "fail-fast" idiom instead of the findings/summary pattern used
 * elsewhere in packages/core — validation helpers (`fail`, `text`,
 * `required`, `oneOf`, `fourEyes`, etc.) throw immediately with a `code` on
 * the error, rather than accumulating findings. Every mutating export
 * requires an independent proposer/approver pair (`fourEyes`) for
 * governance-sensitive actions (partner onboarding, commission approval,
 * merges, succession authority), consistent with the platform's four-eyes
 * convention. `evidenceChecksumSha256` fields are a tamper-evidence seal
 * over the record's own content, not a substitute for the audit hash chain
 * in `audit.js`.
 */
import { createHash } from "node:crypto";
import { generateClosureCertificate, postPaymentToLoanAccount, settleLoanAccount, summarizeLoanAccount } from "../lending/loan-account.js";

const CHANNELS = ["digital", "branch", "dsa", "bc", "connector", "dealer", "merchant", "lsp", "api"];
const PARTNER_TYPES = ["dsa", "bc", "connector", "dealer", "merchant", "lsp"];
const RELATIONSHIP_TYPES = ["co_applicant", "co_borrower", "guarantor", "household", "group", "jlg", "connected_party", "nominee", "legal_heir", "authorised_representative"];
const LANGUAGES = ["en", "hi", "bn", "gu", "kn", "ml", "mr", "or", "pa", "ta", "te", "ur"];

/**
 * Onboard a channel partner (DSA/BC/connector/dealer/merchant/LSP). Requires
 * four-eyes approval, an active operating unit and programme, and — for an
 * `lsp` partner — a registered LSP record. Throws (fail-fast) rather than
 * returning findings on any violation.
 */
export function registerChannelPartner(registry = {}, state = {}, input = {}, now = new Date()) {
  text(input.partnerId, "partnerId"); if (registry[input.partnerId]) fail("channel_partner_duplicate", "partnerId already exists."); fourEyes(input);
  const partnerType = oneOf(input.partnerType, PARTNER_TYPES, "partnerType"); if (partnerType === "lsp" && !state.lendingServiceProviders?.[input.lspId]) fail("channel_lsp_missing", "An LSP channel partner requires a registered LSP.");
  const operatingUnitIds = strings(input.operatingUnitIds, "operatingUnitIds", true); for (const id of operatingUnitIds) if (state.institutionOperatingUnits?.[id]?.status !== "active") fail("channel_unit_invalid", `Active operating unit ${id} is required.`);
  const programmeIds = strings(input.programmeIds, "programmeIds", true); for (const id of programmeIds) if (state.lendingProgrammes?.[id]?.status !== "active") fail("channel_programme_invalid", `Active lending programme ${id} is required.`);
  const partner = { partnerId: input.partnerId, partnerType, legalName: required(input.legalName, "legalName"), lspId: input.lspId ?? null, operatingUnitIds, programmeIds, serviceablePostalCodes: strings(input.serviceablePostalCodes, "serviceablePostalCodes", true), contact: { name: required(input.contact?.name, "contact.name"), email: email(input.contact?.email, "contact.email"), mobile: mobile(input.contact?.mobile, "contact.mobile") }, agreementRef: required(input.agreementRef, "agreementRef"), dueDiligenceRef: required(input.dueDiligenceRef, "dueDiligenceRef"), conductPolicyRef: required(input.conductPolicyRef, "conductPolicyRef"), consentTrainingRef: required(input.consentTrainingRef, "consentTrainingRef"), status: "active", proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, registeredAt: now.toISOString(), evidenceChecksumSha256: hash({ input, contact: undefined }) };
  return { registry: { ...registry, [partner.partnerId]: partner }, partner };
}

/**
 * Register a commission policy (flat amount or bps-of-disbursed-amount) for
 * an active channel partner, scoped to specific active lending programmes
 * the partner is actually authorised for.
 */
export function registerPartnerCommissionPolicy(registry = {}, state = {}, input = {}, now = new Date()) {
  text(input.policyId, "policyId"); if (registry[input.policyId]) fail("commission_policy_duplicate", "policyId already exists."); fourEyes(input); const partner = state.channelPartners?.[input.partnerId]; if (!partner || partner.status !== "active") fail("channel_partner_missing", "An active channel partner is required.");
  const basis = oneOf(input.basis, ["flat", "disbursed_amount_bps"], "basis"); const flatAmountPaise = basis === "flat" ? positiveMoney(input.flatAmountPaise, "flatAmountPaise") : null; const rateBps = basis === "disbursed_amount_bps" ? boundedInteger(input.rateBps, 1, 10000, "rateBps") : null;
  const programmeIds = strings(input.programmeIds, "programmeIds", true); if (programmeIds.some((id) => !partner.programmeIds.includes(id) || state.lendingProgrammes?.[id]?.status !== "active")) fail("commission_programme_invalid", "Commission policy programmes must be active and authorised for the partner.");
  const policy = { policyId: input.policyId, partnerId: partner.partnerId, programmeIds, basis, flatAmountPaise, rateBps, maximumPayoutPaise: positiveMoney(input.maximumPayoutPaise, "maximumPayoutPaise"), eligibleEvent: oneOf(input.eligibleEvent, ["disbursement", "first_repayment", "seasoning_complete"], "eligibleEvent"), clawbackDays: boundedInteger(input.clawbackDays, 0, 365, "clawbackDays"), taxTreatmentRef: required(input.taxTreatmentRef, "taxTreatmentRef"), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "active", approvedAt: now.toISOString(), evidenceChecksumSha256: hash(input) }; return { registry: { ...registry, [policy.policyId]: policy }, policy };
}

/**
 * Compute the commission owed on a converted lead once its policy's
 * eligible event (disbursement/first-repayment/seasoning) has actually been
 * met: applies the policy's flat/bps formula, caps at `maximumPayoutPaise`,
 * and nets off any withheld tax. Rounding uses banker's-style half-up on
 * bps (`+5000n / 10000n`) to stay in exact-paise integer math.
 */
export function assessPartnerCommission(registry = {}, state = {}, input = {}, now = new Date()) {
  text(input.assessmentId, "assessmentId"); if (registry[input.assessmentId]) fail("commission_assessment_duplicate", "assessmentId already exists."); const lead = state.channelLeads?.[input.leadId]; if (!lead || lead.status !== "converted" || !lead.partnerId) fail("commission_lead_invalid", "A converted partner lead is required."); const policy = state.partnerCommissionPolicies?.[input.policyId]; if (!policy || policy.status !== "active" || policy.partnerId !== lead.partnerId || !policy.programmeIds.includes(lead.programmeId)) fail("commission_policy_invalid", "An active policy for the lead partner and programme is required."); const eligibleEvent = oneOf(input.eligibleEvent, ["disbursement", "first_repayment", "seasoning_complete"], "eligibleEvent"); if (eligibleEvent !== policy.eligibleEvent) fail("commission_event_invalid", "The policy eligibility event has not been met.");
  const baseAmountPaise = positiveMoney(input.baseAmountPaise, "baseAmountPaise"); const calculated = policy.basis === "flat" ? BigInt(policy.flatAmountPaise) : (BigInt(baseAmountPaise) * BigInt(policy.rateBps) + 5000n) / 10000n; const gross = calculated < BigInt(policy.maximumPayoutPaise) ? calculated : BigInt(policy.maximumPayoutPaise); const taxWithheldPaise = money(input.taxWithheldPaise ?? "0", "taxWithheldPaise"); if (BigInt(taxWithheldPaise) > gross) fail("commission_tax_invalid", "Tax withholding cannot exceed gross commission."); const assessment = { assessmentId: input.assessmentId, policyId: policy.policyId, partnerId: lead.partnerId, leadId: lead.leadId, applicationId: lead.convertedApplicationId, borrowerId: lead.convertedBorrowerId, eligibleEvent, eligibleEventRef: required(input.eligibleEventRef, "eligibleEventRef"), eligibleAt: nonFuture(input.eligibleAt, now, "eligibleAt"), baseAmountPaise, grossCommissionPaise: gross.toString(), taxWithheldPaise, netPayablePaise: (gross - BigInt(taxWithheldPaise)).toString(), assessedBy: required(input.assessedBy, "assessedBy"), status: "assessed", history: [{ action: "assessed", actor: input.assessedBy, at: now.toISOString() }], assessedAt: now.toISOString(), evidenceChecksumSha256: hash(input) }; return { registry: { ...registry, [assessment.assessmentId]: assessment }, assessment };
}

/**
 * Move a commission assessment through assessed -> approved -> settled (or
 * clawed_back). `approve` requires four-eyes independent of the original
 * assessor; `claw_back` is only permitted within the policy's
 * `clawbackDays` window from `eligibleAt`.
 */
export function transitionPartnerCommission(assessment, state = {}, input = {}, now = new Date()) {
  if (!assessment) fail("commission_assessment_missing", "Commission assessment is required."); const action = oneOf(input.action, ["approve", "settle", "claw_back"], "action"); const allowed = { assessed: ["approve"], approved: ["settle"], settled: ["claw_back"] }[assessment.status] ?? []; if (!allowed.includes(action)) fail("commission_transition_invalid", "Commission action is not allowed from the current status."); if (action === "approve") { fourEyes({ proposedBy: assessment.assessedBy, approvedBy: input.actor, approvalRef: input.approvalRef }); } const policy = state.partnerCommissionPolicies?.[assessment.policyId]; if (!policy) fail("commission_policy_missing", "Commission policy is required."); if (action === "claw_back") { const deadline = Date.parse(assessment.eligibleAt) + policy.clawbackDays * 86400000; if (now.getTime() > deadline) fail("commission_clawback_expired", "Commission clawback window has expired."); }
  const event = { action, actor: required(input.actor, "actor"), reason: required(input.reason, "reason"), evidenceRef: required(input.evidenceRef, "evidenceRef"), approvalRef: input.approvalRef ?? null, paymentRef: action === "settle" ? required(input.paymentRef, "paymentRef") : null, reconciliationRef: action === "settle" ? required(input.reconciliationRef, "reconciliationRef") : null, at: now.toISOString() }; const status = { approve: "approved", settle: "settled", claw_back: "clawed_back" }[action]; const history = [...assessment.history, event]; return { ...assessment, status, paymentRef: event.paymentRef ?? assessment.paymentRef ?? null, reconciliationRef: event.reconciliationRef ?? assessment.reconciliationRef ?? null, history, updatedAt: now.toISOString(), evidenceChecksumSha256: hash(history) };
}

/**
 * Capture a new lead and route it to a serviceable operating unit. Performs
 * duplicate/known-borrower detection by hashing contact channels
 * (`contactKeys`) rather than storing raw email/mobile in the dedup index,
 * and flags the lead `duplicate_review` if it collides with an open lead or
 * an existing borrower rather than silently merging.
 */
export function createChannelLead(registry = {}, state = {}, input = {}, now = new Date()) {
  text(input.leadId, "leadId"); if (registry[input.leadId]) fail("lead_duplicate", "leadId already exists."); const channel = oneOf(input.channel, CHANNELS, "channel"); const partner = input.partnerId ? state.channelPartners?.[input.partnerId] : null;
  if (PARTNER_TYPES.includes(channel) && (!partner || partner.status !== "active" || partner.partnerType !== channel)) fail("lead_partner_invalid", `An active ${channel} partner is required.`);
  const programme = state.lendingProgrammes?.[input.programmeId]; if (!programme || programme.status !== "active" || !programme.channels.includes(channel)) fail("lead_programme_invalid", "An active programme supporting this channel is required.");
  const postalCode = required(input.postalCode, "postalCode"); if (partner && (!partner.programmeIds.includes(programme.programmeId) || !partner.serviceablePostalCodes.includes(postalCode))) fail("lead_partner_not_serviceable", "Partner is not authorised for this programme and postal code."); const routedUnit = routeUnit(state, programme, postalCode, input.operatingUnitId); if (!routedUnit) fail("lead_not_serviceable", "No active programme unit services this postal code.");
  const contact = { name: required(input.contact?.name, "contact.name"), email: input.contact?.email ? email(input.contact.email, "contact.email") : null, mobile: input.contact?.mobile ? mobile(input.contact.mobile, "contact.mobile") : null }; if (!contact.email && !contact.mobile) fail("lead_contact_missing", "Email or mobile is required.");
  const contactHashes = contactKeys(contact); const duplicateLeadIds = Object.values(registry).filter((lead) => lead.contactHashes?.some((key) => contactHashes.includes(key)) && !["abandoned", "converted"].includes(lead.status)).map((lead) => lead.leadId); const matchedBorrowerIds = Object.values(state.borrowerProfiles ?? {}).filter((borrower) => borrowerMatches(borrower, contact)).map((borrower) => borrower.borrowerId);
  const attribution = { source: required(input.attribution?.source, "attribution.source"), campaign: input.attribution?.campaign ?? null, referralRef: input.attribution?.referralRef ?? null, capturedAt: now.toISOString() };
  const requestedProductPolicyId = required(input.requestedProductPolicyId, "requestedProductPolicyId"); if (!programme.productPolicyIds.includes(requestedProductPolicyId)) fail("lead_product_invalid", "Requested product is not available under this programme.");
  const lead = { leadId: input.leadId, programmeId: programme.programmeId, channel, partnerId: partner?.partnerId ?? null, operatingUnitId: routedUnit.unitId, postalCode, contact, contactHashes, requestedAmountPaise: positiveMoney(input.requestedAmountPaise, "requestedAmountPaise"), requestedProductPolicyId, attribution, consentRef: required(input.consentRef, "consentRef"), disclosureRef: required(input.disclosureRef, "disclosureRef"), conductAttestationRef: PARTNER_TYPES.includes(channel) || channel === "branch" ? required(input.conductAttestationRef, "conductAttestationRef") : input.conductAttestationRef ?? null, duplicateLeadIds, matchedBorrowerIds, status: duplicateLeadIds.length || matchedBorrowerIds.length ? "duplicate_review" : "new", owner: required(input.owner, "owner"), history: [{ action: "created", actor: required(input.createdBy, "createdBy"), at: now.toISOString() }], createdAt: now.toISOString(), evidenceChecksumSha256: hash({ contactHashes, attribution, duplicateLeadIds, matchedBorrowerIds }) };
  return { registry: { ...registry, [lead.leadId]: lead }, lead };
}

/** Move a lead through its funnel (contact/qualify/follow-up/convert/abandon/resolve_duplicate). */
export function transitionChannelLead(lead, input = {}, now = new Date()) {
  if (!lead) fail("lead_missing", "Lead is required."); const action = oneOf(input.action, ["contact", "qualify", "schedule_follow_up", "resolve_duplicate", "convert", "abandon"], "action"); const allowed = { new: ["contact", "qualify", "schedule_follow_up", "abandon"], contacted: ["qualify", "schedule_follow_up", "abandon"], follow_up: ["contact", "qualify", "abandon"], duplicate_review: ["resolve_duplicate", "abandon"], qualified: ["convert", "schedule_follow_up", "abandon"] }[lead.status] ?? []; if (!allowed.includes(action)) fail("lead_transition_invalid", "Lead action is not allowed from its current status.");
  const nextStatus = { contact: "contacted", qualify: "qualified", schedule_follow_up: "follow_up", resolve_duplicate: input.disposition === "continue" ? "new" : "abandoned", convert: "converted", abandon: "abandoned" }[action]; if (action === "schedule_follow_up") future(input.followUpAt, now, "followUpAt"); if (action === "resolve_duplicate" && !["continue", "duplicate"].includes(input.disposition)) fail("lead_duplicate_disposition", "Duplicate disposition is required."); if (action === "convert" && (!input.borrowerId || !input.applicationId)) fail("lead_conversion_missing", "Conversion requires borrowerId and applicationId.");
  const event = { action, from: lead.status, to: nextStatus, actor: required(input.actor, "actor"), reason: required(input.reason, "reason"), evidenceRef: required(input.evidenceRef, "evidenceRef"), followUpAt: input.followUpAt ?? null, disposition: input.disposition ?? null, borrowerId: input.borrowerId ?? null, applicationId: input.applicationId ?? null, at: now.toISOString() }; const history = [...lead.history, event]; return { ...lead, status: nextStatus, nextFollowUpAt: action === "schedule_follow_up" ? new Date(input.followUpAt).toISOString() : null, convertedBorrowerId: action === "convert" ? input.borrowerId : lead.convertedBorrowerId ?? null, convertedApplicationId: action === "convert" ? input.applicationId : lead.convertedApplicationId ?? null, history, updatedAt: now.toISOString(), evidenceChecksumSha256: hash(history) };
}

/**
 * Register a directed relationship between two existing customers
 * (co-applicant/guarantor/nominee/legal-heir/etc.), with an optional
 * liability type and validity window. Rejects a self-referential
 * relationship.
 */
export function registerCustomerRelationship(registry = {}, state = {}, input = {}, now = new Date()) {
  text(input.relationshipId, "relationshipId"); if (registry[input.relationshipId]) fail("customer_relationship_duplicate", "relationshipId already exists."); fourEyes(input); if (input.fromBorrowerId === input.toBorrowerId) fail("customer_relationship_self", "A customer cannot relate to itself."); if (!state.borrowerProfiles?.[input.fromBorrowerId] || !state.borrowerProfiles?.[input.toBorrowerId]) fail("customer_relationship_borrower_missing", "Both customers must exist.");
  const relationship = { relationshipId: input.relationshipId, fromBorrowerId: input.fromBorrowerId, toBorrowerId: input.toBorrowerId, relationshipType: oneOf(input.relationshipType, RELATIONSHIP_TYPES, "relationshipType"), groupRef: input.groupRef ?? null, liabilityType: oneOf(input.liabilityType ?? "none", ["none", "joint", "several", "guarantee"], "liabilityType"), validFrom: nonFuture(input.validFrom ?? now.toISOString(), now, "validFrom"), validUntil: input.validUntil ? future(input.validUntil, now, "validUntil") : null, evidenceRef: required(input.evidenceRef, "evidenceRef"), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "active", registeredAt: now.toISOString(), evidenceChecksumSha256: hash(input) }; return { registry: { ...registry, [relationship.relationshipId]: relationship }, relationship };
}

/**
 * Propose (but do not execute) a plan to merge duplicate customer records
 * into a survivor. Recorded as `approved_not_executed`; actual execution is
 * a separate step (`executeCustomerMerge`) gated on the impact snapshot
 * still matching what was approved.
 */
export function createCustomerMergePlan(registry = {}, state = {}, input = {}, now = new Date()) {
  text(input.mergePlanId, "mergePlanId"); if (registry[input.mergePlanId]) fail("customer_merge_duplicate", "mergePlanId already exists."); fourEyes(input); const duplicateBorrowerIds = strings(input.duplicateBorrowerIds, "duplicateBorrowerIds", true); if (duplicateBorrowerIds.includes(input.survivorBorrowerId)) fail("customer_merge_invalid", "Survivor cannot also be a duplicate."); for (const id of [input.survivorBorrowerId, ...duplicateBorrowerIds]) if (!state.borrowerProfiles?.[id]) fail("customer_merge_borrower_missing", `Customer ${id} does not exist.`);
  const plan = { mergePlanId: input.mergePlanId, survivorBorrowerId: input.survivorBorrowerId, duplicateBorrowerIds, matchEvidenceRefs: strings(input.matchEvidenceRefs, "matchEvidenceRefs", true), conflictResolutions: object(input.conflictResolutions, "conflictResolutions"), migrationScope: strings(input.migrationScope, "migrationScope", true), rollbackRef: required(input.rollbackRef, "rollbackRef"), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "approved_not_executed", approvedAt: now.toISOString(), evidenceChecksumSha256: hash(input) }; return { registry: { ...registry, [plan.mergePlanId]: plan }, plan };
}

/**
 * Snapshot every record across the plan's migration scope (plus
 * `customerRelationships`, always included) that references a duplicate
 * borrower, and seal it with a checksum. `executeCustomerMerge` compares
 * this checksum against what was approved so the merge cannot silently run
 * against a changed data set.
 */
export function assessCustomerMergeImpact(state = {}, plan) {
  if (!plan || plan.status !== "approved_not_executed") fail("customer_merge_plan_invalid", "An approved unexecuted merge plan is required."); const duplicateIds = new Set(plan.duplicateBorrowerIds); const collections = mergeCollections(plan.migrationScope); const counts = {}; const recordIds = {}; for (const collection of collections) { const matches = Object.entries(state[collection] ?? {}).filter(([, record]) => recordReferencesBorrower(record, duplicateIds)); counts[collection] = matches.length; recordIds[collection] = matches.map(([id]) => id); } const relationships = Object.entries(state.customerRelationships ?? {}).filter(([, record]) => duplicateIds.has(record.fromBorrowerId) || duplicateIds.has(record.toBorrowerId)); if (!collections.includes("customerRelationships")) { counts.customerRelationships = relationships.length; recordIds.customerRelationships = relationships.map(([id]) => id); } const snapshot = { mergePlanId: plan.mergePlanId, survivorBorrowerId: plan.survivorBorrowerId, duplicateBorrowerIds: plan.duplicateBorrowerIds, collections: [...new Set([...collections, "customerRelationships"])], counts, recordIds }; return { ...snapshot, impactChecksumSha256: hash(snapshot) };
}

/**
 * Execute an approved merge plan: re-points every referencing record's
 * borrower-id field(s) from the duplicates to the survivor
 * (`remapBorrowerRefs`), marks self-referencing relationships
 * `merged_duplicate`, and marks the duplicate borrower profiles `merged`.
 * Fails closed if the current impact checksum no longer matches
 * `expectedImpactChecksumSha256` from approval time (data changed since the
 * plan was approved).
 */
export function executeCustomerMerge(state = {}, plan, input = {}, now = new Date()) {
  const impact = assessCustomerMergeImpact(state, plan); if (input.expectedImpactChecksumSha256 !== impact.impactChecksumSha256) fail("customer_merge_impact_changed", "Merge impact changed after approval; reassess before execution."); fourEyes(input); const evidenceRefs = strings(input.executionEvidenceRefs, "executionEvidenceRefs", true); const duplicateIds = new Set(plan.duplicateBorrowerIds); const collections = mergeCollections(plan.migrationScope); const next = { ...state };
  for (const collection of collections) { const source = state[collection] ?? {}; const target = {}; for (const [id, record] of Object.entries(source)) target[id] = recordReferencesBorrower(record, duplicateIds) ? remapBorrowerRefs(record, duplicateIds, plan.survivorBorrowerId, plan.mergePlanId) : record; next[collection] = target; }
  next.customerRelationships = Object.fromEntries(Object.entries(state.customerRelationships ?? {}).map(([id, record]) => { const updated = { ...record, fromBorrowerId: duplicateIds.has(record.fromBorrowerId) ? plan.survivorBorrowerId : record.fromBorrowerId, toBorrowerId: duplicateIds.has(record.toBorrowerId) ? plan.survivorBorrowerId : record.toBorrowerId }; return [id, updated.fromBorrowerId === updated.toBorrowerId ? { ...updated, status: "merged_duplicate", customerMergePlanId: plan.mergePlanId } : updated]; }));
  next.borrowerProfiles = { ...state.borrowerProfiles }; for (const id of plan.duplicateBorrowerIds) next.borrowerProfiles[id] = { ...state.borrowerProfiles[id], status: "merged", mergedIntoBorrowerId: plan.survivorBorrowerId, customerMergePlanId: plan.mergePlanId, mergedAt: now.toISOString() }; const execution = { mergePlanId: plan.mergePlanId, survivorBorrowerId: plan.survivorBorrowerId, duplicateBorrowerIds: plan.duplicateBorrowerIds, impact, rollbackRef: plan.rollbackRef, executionEvidenceRefs: evidenceRefs, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "executed", executedAt: now.toISOString(), evidenceChecksumSha256: hash({ impact, evidenceRefs, approvalRef: input.approvalRef }) }; next.customerMergePlans = { ...state.customerMergePlans, [plan.mergePlanId]: { ...plan, status: "executed", executedAt: execution.executedAt, executionChecksumSha256: execution.evidenceChecksumSha256 } }; next.customerMergeExecutions = { ...(state.customerMergeExecutions ?? {}), [plan.mergePlanId]: execution }; return { state: next, execution };
}

/** Record a customer's language, accessibility, vulnerability, and do-not-contact preferences. */
export function recordCustomerPreferences(registry = {}, state = {}, input = {}, now = new Date()) {
  if (!state.borrowerProfiles?.[input.borrowerId]) fail("customer_preferences_borrower_missing", "Customer does not exist."); const preferredLanguage = oneOf(input.preferredLanguage, LANGUAGES, "preferredLanguage"); const communicationLanguages = array(input.communicationLanguages, "communicationLanguages", true).map((value) => oneOf(value, LANGUAGES, "communicationLanguages")); const doNotContactChannels = strings(input.doNotContactChannels, "doNotContactChannels"); if (doNotContactChannels.some((value) => !["voice", "sms", "email", "whatsapp", "postal"].includes(value))) fail("customer_preferences_invalid", "Unknown do-not-contact channel.");
  const preferences = { borrowerId: input.borrowerId, preferredLanguage, communicationLanguages: [...new Set(communicationLanguages)], vulnerabilityFlags: strings(input.vulnerabilityFlags, "vulnerabilityFlags"), accessibilityNeeds: strings(input.accessibilityNeeds, "accessibilityNeeds"), assistedJourney: Boolean(input.assistedJourney), doNotContactChannels, permittedContactWindows: strings(input.permittedContactWindows, "permittedContactWindows"), consentRef: required(input.consentRef, "consentRef"), recordedBy: required(input.recordedBy, "recordedBy"), recordedAt: now.toISOString(), evidenceChecksumSha256: hash(input) }; return { registry: { ...registry, [input.borrowerId]: preferences }, preferences };
}

/**
 * Open a succession/bereavement case for a deceased borrower: requires an
 * existing active relationship of type nominee/legal_heir/
 * authorised_representative between the borrower and claimant. Newly
 * reported cases are `manual_review_only` until legally reviewed and
 * approved.
 */
export function createSuccessionCase(registry = {}, state = {}, input = {}, now = new Date()) {
  text(input.caseId, "caseId"); if (registry[input.caseId]) fail("succession_case_duplicate", "caseId already exists."); if (!state.borrowerProfiles?.[input.borrowerId] || !state.borrowerProfiles?.[input.claimantBorrowerId]) fail("succession_borrower_missing", "Borrower and claimant must exist."); const relationship = state.customerRelationships?.[input.relationshipId]; if (!relationship || relationship.status !== "active" || relationship.fromBorrowerId !== input.borrowerId || relationship.toBorrowerId !== input.claimantBorrowerId || !["nominee", "legal_heir", "authorised_representative"].includes(relationship.relationshipType)) fail("succession_relationship_invalid", "An active nominee, legal-heir, or authorised-representative relationship is required.");
  const successionCase = { caseId: input.caseId, borrowerId: input.borrowerId, claimantBorrowerId: input.claimantBorrowerId, relationshipId: relationship.relationshipId, deathCertificateRef: required(input.deathCertificateRef, "deathCertificateRef"), identityEvidenceRefs: strings(input.identityEvidenceRefs, "identityEvidenceRefs", true), legalEvidenceRefs: strings(input.legalEvidenceRefs, "legalEvidenceRefs", true), affectedLoanAccountIds: strings(input.affectedLoanAccountIds, "affectedLoanAccountIds", true), servicingRestriction: "manual_review_only", status: "reported", reportedBy: required(input.reportedBy, "reportedBy"), history: [{ action: "reported", actor: input.reportedBy, at: now.toISOString() }], createdAt: now.toISOString(), evidenceChecksumSha256: hash(input) }; return { registry: { ...registry, [successionCase.caseId]: successionCase }, successionCase };
}

/**
 * Move a succession case through reported -> verified -> approved ->
 * completed (or rejected). Only on reaching `completed` does the case
 * become `claimant_authorised`, unlocking `issueSuccessionAuthority`.
 */
export function transitionSuccessionCase(successionCase, input = {}, now = new Date()) {
  if (!successionCase) fail("succession_case_missing", "Succession case is required."); const action = oneOf(input.action, ["verify", "approve", "reject", "complete"], "action"); const allowed = { reported: ["verify", "reject"], verified: ["approve", "reject"], approved: ["complete"] }[successionCase.status] ?? []; if (!allowed.includes(action)) fail("succession_transition_invalid", "Succession action is not allowed."); if (["approve", "reject"].includes(action)) fourEyes(input); const status = { verify: "verified", approve: "approved", reject: "rejected", complete: "completed" }[action]; const event = { action, actor: required(input.actor, "actor"), reason: required(input.reason, "reason"), evidenceRefs: strings(input.evidenceRefs, "evidenceRefs", true), proposedBy: input.proposedBy ?? null, approvedBy: input.approvedBy ?? null, approvalRef: input.approvalRef ?? null, at: now.toISOString() }; const history = [...successionCase.history, event]; return { ...successionCase, status, servicingRestriction: status === "completed" ? "claimant_authorised" : successionCase.servicingRestriction, history, updatedAt: now.toISOString(), evidenceChecksumSha256: hash(history) };
}

/**
 * Grant a claimant explicit, time-boxed, scope-limited authority over a
 * deceased borrower's accounts, once the succession case is completed and
 * claimant-authorised. Authority is restricted to the case's affected
 * accounts and an allow-listed set of servicing actions — it can never be
 * used to widen scope beyond what the succession case covers.
 */
export function issueSuccessionAuthority(registry = {}, state = {}, input = {}, now = new Date()) {
  text(input.authorityId, "authorityId"); if (registry[input.authorityId]) fail("succession_authority_duplicate", "authorityId already exists."); fourEyes(input); const successionCase = state.successionCases?.[input.caseId]; if (!successionCase || successionCase.status !== "completed" || successionCase.servicingRestriction !== "claimant_authorised") fail("succession_case_not_completed", "A completed claimant-authorised succession case is required."); const loanAccountIds = strings(input.loanAccountIds, "loanAccountIds", true); if (loanAccountIds.some((id) => !successionCase.affectedLoanAccountIds.includes(id) || state.loanAccounts?.[id]?.borrowerId !== successionCase.borrowerId)) fail("succession_account_invalid", "Authority may cover only the deceased borrower's affected loan accounts."); const permittedActions = strings(input.permittedActions, "permittedActions", true); const allowed = ["communication", "statement_access", "repayment", "closure_request", "settlement_request", "transfer_request", "mandate_change_request"]; if (permittedActions.some((action) => !allowed.includes(action))) fail("succession_action_invalid", "Authority contains a prohibited servicing action."); const authority = { authorityId: input.authorityId, caseId: successionCase.caseId, borrowerId: successionCase.borrowerId, claimantBorrowerId: successionCase.claimantBorrowerId, loanAccountIds, permittedActions, legalReviewRef: required(input.legalReviewRef, "legalReviewRef"), identityReverificationRef: required(input.identityReverificationRef, "identityReverificationRef"), communicationAddressRef: required(input.communicationAddressRef, "communicationAddressRef"), validFrom: now.toISOString(), validUntil: future(input.validUntil, now, "validUntil"), status: "active", proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, history: [{ action: "issued", actor: input.approvedBy, at: now.toISOString() }], issuedAt: now.toISOString(), evidenceChecksumSha256: hash(input) }; return { registry: { ...registry, [authority.authorityId]: authority }, authority };
}

/**
 * Record a claimant's requested servicing action against a deceased
 * borrower's account, checked against an active unexpired succession
 * authority's permitted actions and account scope. Irreversible/
 * value-moving actions (closure/settlement/transfer/mandate-change) require
 * four-eyes; the resulting record is `approved_request` (pending execution)
 * for those, `recorded` otherwise (e.g. `communication`, `statement_access`).
 */
export function recordSuccessionServiceAction(registry = {}, state = {}, input = {}, now = new Date()) {
  text(input.actionId, "actionId"); if (registry[input.actionId]) fail("succession_action_duplicate", "actionId already exists."); const authority = state.successionAuthorities?.[input.authorityId]; if (!authority || authority.status !== "active" || Date.parse(authority.validUntil) <= now.getTime()) fail("succession_authority_inactive", "An active unexpired succession authority is required."); const actionType = oneOf(input.actionType, ["communication", "statement_access", "repayment", "closure_request", "settlement_request", "transfer_request", "mandate_change_request"], "actionType"); if (!authority.permittedActions.includes(actionType) || !authority.loanAccountIds.includes(input.loanAccountId)) fail("succession_action_unauthorised", "Action or loan account is outside claimant authority."); if (["closure_request", "settlement_request", "transfer_request", "mandate_change_request"].includes(actionType)) fourEyes(input); const amountPaise = ["repayment", "settlement_request"].includes(actionType) ? positiveMoney(input.amountPaise, "amountPaise") : null; const requestDetails = successionRequestDetails(state, authority, actionType, input); const action = { actionId: input.actionId, authorityId: authority.authorityId, caseId: authority.caseId, borrowerId: authority.borrowerId, claimantBorrowerId: authority.claimantBorrowerId, loanAccountId: input.loanAccountId, actionType, amountPaise, requestDetails, requestRef: required(input.requestRef, "requestRef"), evidenceRefs: strings(input.evidenceRefs, "evidenceRefs", true), actor: required(input.actor, "actor"), proposedBy: input.proposedBy ?? null, approvedBy: input.approvedBy ?? null, approvalRef: input.approvalRef ?? null, status: actionType.endsWith("_request") ? "approved_request" : "recorded", recordedAt: now.toISOString(), evidenceChecksumSha256: hash(input) }; return { registry: { ...registry, [action.actionId]: action }, action };
}

/** Assign a legal reviewer to opine on a pending succession service action before it can execute. */
export function createSuccessionLegalReview(registry = {}, state = {}, input = {}, now = new Date()) {
  text(input.reviewId, "reviewId"); if (registry[input.reviewId]) fail("succession_legal_review_duplicate", "reviewId already exists."); const action = state.successionServiceActions?.[input.actionId]; if (!action || action.status === "executed") fail("succession_action_not_reviewable", "A pending succession action is required."); const review = { reviewId: input.reviewId, actionId: action.actionId, caseId: action.caseId, authorityId: action.authorityId, assignedTo: required(input.assignedTo, "assignedTo"), assignedBy: required(input.assignedBy, "assignedBy"), dueAt: future(input.dueAt, now, "dueAt"), checklistEvidenceRefs: strings(input.checklistEvidenceRefs, "checklistEvidenceRefs", true), legalBasisRef: required(input.legalBasisRef, "legalBasisRef"), status: "assigned", history: [{ action: "assigned", actor: input.assignedBy, at: now.toISOString() }], createdAt: now.toISOString(), evidenceChecksumSha256: hash(input) }; return { registry: { ...registry, [review.reviewId]: review }, review };
}

/**
 * Record the assigned legal reviewer's decision (approve/reject/
 * request_information). Only the assigned reviewer may act; approve/reject
 * additionally require four-eyes on top of that assignment check.
 */
export function transitionSuccessionLegalReview(review, input = {}, now = new Date()) {
  if (!review || !["assigned", "information_requested"].includes(review.status)) fail("succession_legal_review_inactive", "An open succession legal review is required."); const action = oneOf(input.action, ["approve", "reject", "request_information"], "action"); if (["approve", "reject"].includes(action)) { fourEyes(input); if (input.proposedBy !== review.assignedTo) fail("succession_legal_reviewer_invalid", "The assigned legal reviewer must propose the decision."); } else if (input.actor !== review.assignedTo) fail("succession_legal_reviewer_invalid", "Only the assigned legal reviewer may request information."); const event = { action, actor: required(input.actor, "actor"), reason: required(input.reason, "reason"), opinionRef: required(input.opinionRef, "opinionRef"), evidenceRefs: strings(input.evidenceRefs, "evidenceRefs", true), proposedBy: input.proposedBy ?? null, approvedBy: input.approvedBy ?? null, approvalRef: input.approvalRef ?? null, at: now.toISOString() }; const status = { approve: "approved", reject: "rejected", request_information: "information_requested" }[action]; const history = [...review.history, event]; return { ...review, status, decisionRef: event.opinionRef, history, updatedAt: now.toISOString(), evidenceChecksumSha256: hash(history) };
}

/** Revoke an active succession authority (e.g. a dispute or fraud concern arises). */
export function revokeSuccessionAuthority(authority, input = {}, now = new Date()) {
  if (!authority || authority.status !== "active") fail("succession_authority_inactive", "Active succession authority is required."); fourEyes(input); const event = { action: "revoked", actor: input.approvedBy, reason: required(input.reason, "reason"), evidenceRefs: strings(input.evidenceRefs, "evidenceRefs", true), approvalRef: input.approvalRef, at: now.toISOString() }; const history = [...authority.history, event]; return { ...authority, status: "revoked", revokedAt: now.toISOString(), history, evidenceChecksumSha256: hash(history) };
}

/**
 * Execute a legally-reviewed-and-approved succession servicing action
 * against the loan account: re-validates the authority is still active and
 * in-scope at execution time (not just at request time), requires the
 * matching approved legal review, and dispatches to the concrete effect
 * (repayment posting, closure certificate, settlement, servicing-successor
 * transfer, or mandate migration) via the existing `loan-account.js`
 * primitives — this function never re-implements loan-account money math
 * itself. `transfer_request`/`mandate_change_request` change *who services*
 * the account without changing the original borrower of record
 * (`originalBorrowerPreserved: true`).
 */
export function executeSuccessionServiceAction(registry = {}, state = {}, input = {}, now = new Date()) {
  text(input.executionId, "executionId"); if (registry[input.executionId]) fail("succession_execution_duplicate", "executionId already exists."); fourEyes(input); const action = state.successionServiceActions?.[input.actionId]; if (!action || !["recorded", "approved_request"].includes(action.status)) fail("succession_action_not_executable", "A pending succession servicing action is required."); const authority = state.successionAuthorities?.[action.authorityId]; if (!authority || authority.status !== "active" || Date.parse(authority.validUntil) <= now.getTime()) fail("succession_authority_inactive", "Execution requires the original active unexpired authority."); if (!authority.loanAccountIds.includes(action.loanAccountId) || !authority.permittedActions.includes(action.actionType)) fail("succession_execution_scope_invalid", "Execution is outside the original authority scope."); const account = state.loanAccounts?.[action.loanAccountId]; if (!account || account.borrowerId !== authority.borrowerId) fail("succession_account_invalid", "The authorised deceased-borrower loan account is required.");
  const evidenceRefs = strings(input.evidenceRefs, "evidenceRefs", true); const legalReview = state.successionLegalReviews?.[input.legalReviewId]; if (!legalReview || legalReview.actionId !== action.actionId || legalReview.status !== "approved") fail("succession_legal_review_required", "An approved legal review for this action is required."); const legalReviewRef = legalReview.decisionRef; const notificationRef = required(input.notificationRef, "notificationRef"); const reversalPlanRef = required(input.reversalPlanRef, "reversalPlanRef"); let loanAccount = account; let paymentRails = state.paymentRails ?? {}; let effect;
  if (action.actionType === "repayment") { const amount = paiseToMoney(action.amountPaise, "amountPaise"); const paymentRef = required(input.paymentRef, "paymentRef"); const paymentReconciliationRef = required(input.paymentReconciliationRef, "paymentReconciliationRef"); const bankReference = required(input.bankReference, "bankReference"); const result = postPaymentToLoanAccount(account, { amount, receivedAt: input.effectiveAt ?? now.toISOString(), paymentRef, channel: "succession_claimant", actor: input.approvedBy }, now); if (result.summary.status === "blocked") fail("succession_payment_blocked", result.findings[0]?.message ?? "Succession repayment posting is blocked."); loanAccount = result.loanAccount; effect = { type: "loan_payment", ledgerEventId: result.paymentEvent.eventId, paymentRef, paymentReconciliationRef, bankReference, amountPaise: action.amountPaise };
  } else if (action.actionType === "closure_request") { const result = generateClosureCertificate(account, { issuedBy: input.approvedBy }, now); if (result.summary.status === "blocked") fail("succession_closure_blocked", result.findings[0]?.message ?? "Succession closure is blocked."); loanAccount = result.loanAccount; effect = { type: "closure_certificate", certificateId: result.closureCertificate.certificateId, checksumSha256: result.closureCertificate.checksumSha256, reissued: result.reissued };
  } else if (action.actionType === "settlement_request") { const paymentReconciliationRef = required(input.paymentReconciliationRef, "paymentReconciliationRef"); const bankReference = required(input.bankReference, "bankReference"); const result = settleLoanAccount(account, { settlementAmount: paiseToMoney(action.amountPaise, "amountPaise"), paymentRef: required(input.paymentRef, "paymentRef"), settlementId: input.executionId, reason: action.requestDetails.settlementReason, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalReference: input.approvalRef }, now); if (result.summary.status === "blocked") fail("succession_settlement_blocked", result.findings[0]?.message ?? "Succession settlement is blocked."); loanAccount = result.loanAccount; effect = { type: "loan_settlement", settlementId: result.settlement.settlementId, settlementAmountPaise: action.amountPaise, sacrificeAmountPaise: toPaiseString(result.settlement.sacrificeAmount), paymentRef: result.settlement.paymentRef, paymentReconciliationRef, bankReference };
  } else if (action.actionType === "transfer_request") { loanAccount = { ...account, servicingSuccessor: { borrowerId: authority.claimantBorrowerId, scope: action.requestDetails.transferScope, legalTransferRef: action.requestDetails.legalTransferRef, effectiveAt: now.toISOString(), approvedBy: input.approvedBy }, updatedAt: now.toISOString() }; effect = { type: "servicing_successor_transfer", claimantBorrowerId: authority.claimantBorrowerId, scope: action.requestDetails.transferScope, originalBorrowerPreserved: true };
  } else if (action.actionType === "mandate_change_request") { const oldMandate = paymentRails[action.requestDetails.oldMandateId]; const newMandate = paymentRails[action.requestDetails.newMandateId]; if (!oldMandate || oldMandate.loanAccountId !== account.loanAccountId || !newMandate || newMandate.loanAccountId !== account.loanAccountId || newMandate.borrowerId !== authority.claimantBorrowerId || newMandate.status !== "registered") fail("succession_mandate_invalid", "Registered old and claimant replacement mandates for this account are required."); paymentRails = { ...paymentRails, [oldMandate.paymentRailId]: { ...oldMandate, status: "superseded", supersededBy: newMandate.paymentRailId, supersededAt: now.toISOString() }, [newMandate.paymentRailId]: { ...newMandate, status: "active", successionAuthorityId: authority.authorityId, supersedes: oldMandate.paymentRailId, activatedAt: now.toISOString() } }; effect = { type: "mandate_migration", oldMandateId: oldMandate.paymentRailId, newMandateId: newMandate.paymentRailId };
  } else { effect = { type: "downstream_command", commandRef: required(input.downstreamCommandRef, "downstreamCommandRef"), completionEvidenceRef: required(input.completionEvidenceRef, "completionEvidenceRef") }; }
  const execution = { executionId: input.executionId, actionId: action.actionId, authorityId: authority.authorityId, caseId: action.caseId, borrowerId: action.borrowerId, claimantBorrowerId: action.claimantBorrowerId, loanAccountId: action.loanAccountId, actionType: action.actionType, effect, legalReviewId: legalReview.reviewId, legalReviewRef, notificationRef, reversalPlanRef, evidenceRefs, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "executed", executedAt: now.toISOString(), evidenceChecksumSha256: hash({ input, effect }) }; const nextAction = { ...action, status: "executed", executionId: execution.executionId, executedAt: execution.executedAt, executionChecksumSha256: execution.evidenceChecksumSha256 }; return { state: { ...state, loanAccounts: { ...state.loanAccounts, [loanAccount.loanAccountId]: loanAccount }, paymentRails, successionServiceActions: { ...state.successionServiceActions, [action.actionId]: nextAction }, successionServiceExecutions: { ...registry, [execution.executionId]: execution } }, execution };
}

/**
 * Assemble a single-borrower operational view (applications, accounts,
 * aggregate exposure, complaints, consents, documents, succession cases)
 * across the borrower and every customer it has an active relationship
 * with (co-applicants, guarantors, etc.) — a pure read/aggregate, not
 * persisted.
 */
export function buildCustomer360(state = {}, borrowerId, now = new Date()) {
  const borrower = state.borrowerProfiles?.[borrowerId]; if (!borrower) fail("customer_360_missing", "Customer does not exist."); const relationships = Object.values(state.customerRelationships ?? {}).filter((item) => item.status === "active" && (item.fromBorrowerId === borrowerId || item.toBorrowerId === borrowerId)); const relatedIds = new Set([borrowerId, ...relationships.flatMap((item) => [item.fromBorrowerId, item.toBorrowerId])]); const accounts = Object.values(state.loanAccounts ?? {}).filter((item) => relatedIds.has(item.borrowerId)); const exposures = accounts.map((account) => { const summary = summarizeLoanAccount(account, now); return { loanAccountId: account.loanAccountId, borrowerId: account.borrowerId, status: account.status, principalOutstandingPaise: toPaiseString(summary.principalOutstanding) }; }); const aggregate = exposures.reduce((sum, item) => sum + BigInt(item.principalOutstandingPaise), 0n);
  return { borrower, preferences: state.customerPreferences?.[borrowerId] ?? null, relationships, relatedBorrowers: [...relatedIds].filter((id) => id !== borrowerId).map((id) => state.borrowerProfiles[id]).filter(Boolean), applications: Object.values(state.loanApplications ?? {}).filter((item) => relatedIds.has(item.borrowerId)), loanAccounts: exposures, aggregateExposurePaise: aggregate.toString(), complaints: Object.values(state.complaints ?? {}).filter((item) => relatedIds.has(item.borrowerId)), consents: Object.values(state.consentRecords ?? {}).filter((item) => relatedIds.has(item.borrowerId)), documents: Object.values(state.documentVault ?? {}).filter((item) => relatedIds.has(item.borrowerId)), successionCases: Object.values(state.successionCases ?? {}).filter((item) => item.borrowerId === borrowerId || item.claimantBorrowerId === borrowerId), generatedAt: now.toISOString(), evidenceChecksumSha256: hash({ borrowerId, relatedIds: [...relatedIds], exposures }) };
}

function routeUnit(state, programme, postalCode, requestedId) { const units = programme.operatingUnitIds.map((id) => state.institutionOperatingUnits?.[id]).filter((unit) => unit?.status === "active"); if (requestedId) return units.find((unit) => unit.unitId === requestedId && (!unit.serviceablePostalCodes.length || unit.serviceablePostalCodes.includes(postalCode))) ?? null; return units.find((unit) => !unit.serviceablePostalCodes.length || unit.serviceablePostalCodes.includes(postalCode)) ?? null; }
function successionRequestDetails(state, authority, actionType, input) { if (actionType === "settlement_request") return { settlementReason: required(input.settlementReason, "settlementReason"), settlementTermsRef: required(input.settlementTermsRef, "settlementTermsRef") }; if (actionType === "transfer_request") { if (input.targetBorrowerId !== authority.claimantBorrowerId) fail("succession_transfer_target_invalid", "Servicing transfer target must be the authorised claimant."); const transferScope = strings(input.transferScope, "transferScope", true); if (transferScope.some((item) => !["communications", "documents", "security_release"].includes(item))) fail("succession_transfer_scope_invalid", "Transfer scope cannot change the original debt owner."); return { targetBorrowerId: input.targetBorrowerId, transferScope, legalTransferRef: required(input.legalTransferRef, "legalTransferRef") }; } if (actionType === "mandate_change_request") { const oldMandateId = required(input.oldMandateId, "oldMandateId"); const newMandateId = required(input.newMandateId, "newMandateId"); if (oldMandateId === newMandateId || !state.paymentRails?.[oldMandateId] || !state.paymentRails?.[newMandateId]) fail("succession_mandate_invalid", "Distinct existing old and replacement mandates are required."); return { oldMandateId, newMandateId }; } return null; }
function mergeCollections(scope) { const aliases = { applications: "loanApplications", accounts: "loanAccounts", complaints: "complaints", consents: "consentRecords", documents: "documentVault", succession: "successionCases", access_requests: "accessRequests", correction_requests: "correctionRequests", kyc: "kycRecords", beneficial_owners: "beneficialOwners" }; return [...new Set(scope.map((name) => aliases[name] ?? name))].filter((name) => { if (!["loanApplications", "loanAccounts", "complaints", "consentRecords", "documentVault", "successionCases", "accessRequests", "correctionRequests", "kycRecords", "beneficialOwners"].includes(name)) fail("customer_merge_scope_invalid", `Unsupported merge collection ${name}.`); return true; }); }
function recordReferencesBorrower(record, ids) { return ids.has(record?.borrowerId) || ids.has(record?.fromBorrowerId) || ids.has(record?.toBorrowerId) || ids.has(record?.claimantBorrowerId); }
function remapBorrowerRefs(record, ids, survivorId, mergePlanId) { const next = { ...record, customerMergePlanId: mergePlanId }; for (const field of ["borrowerId", "fromBorrowerId", "toBorrowerId", "claimantBorrowerId"]) if (ids.has(next[field])) next[field] = survivorId; return next; }
function borrowerMatches(borrower, contact) { const borrowerEmail = borrower.email ?? borrower.contact?.email; const borrowerMobile = borrower.mobile ?? borrower.contact?.mobile; return Boolean((contact.email && borrowerEmail && contact.email === String(borrowerEmail).trim().toLowerCase()) || (contact.mobile && borrowerMobile && digits(contact.mobile) === digits(borrowerMobile))); }
function contactKeys(contact) { return [contact.email ? `email:${contact.email}` : null, contact.mobile ? `mobile:${digits(contact.mobile)}` : null].filter(Boolean).map((value) => hash(value)); }
function toPaiseString(value) { if (typeof value === "bigint") return value.toString(); if (typeof value !== "number" || !Number.isFinite(value)) fail("customer_360_money_invalid", "Account exposure is invalid."); return String(Math.round(value * 100)); }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function digits(value) { return String(value).replace(/\D/g, ""); }
function email(value, field) { const normalized = String(value ?? "").trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) fail("customer_channel_invalid", `${field} is invalid.`); return normalized; }
function mobile(value, field) { const normalized = digits(value); if (!/^(91)?[6-9]\d{9}$/.test(normalized)) fail("customer_channel_invalid", `${field} is invalid.`); return normalized.slice(-10); }
function money(value, field) { if (typeof value !== "string" || !/^\d+$/.test(value)) fail("customer_channel_money_invalid", `${field} must be a non-negative integer paise string.`); return value; }
function positiveMoney(value, field) { const result = money(value, field); if (BigInt(result) <= 0n) fail("customer_channel_money_invalid", `${field} must be positive.`); return result; }
function paiseToMoney(value, field) { const paise = BigInt(positiveMoney(value, field)); if (paise > BigInt(Number.MAX_SAFE_INTEGER)) fail("customer_channel_money_invalid", `${field} exceeds the exact-money execution limit.`); return Number(paise) / 100; }
function fourEyes(input) { text(input.proposedBy, "proposedBy"); text(input.approvedBy, "approvedBy"); text(input.approvalRef, "approvalRef"); if (input.proposedBy === input.approvedBy) fail("customer_channel_four_eyes", "Independent approval is required."); }
function required(value, field) { text(value, field); return String(value); }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("customer_channel_invalid", `${field} is required.`); }
function object(value, field) { if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) fail("customer_channel_invalid", `${field} must be a non-empty object.`); return value; }
function array(value, field, requiredValue = false) { if (value == null && !requiredValue) return []; if (!Array.isArray(value) || (requiredValue && !value.length)) fail("customer_channel_invalid", `${field} must be a${requiredValue ? " non-empty" : "n"} array.`); return value; }
function strings(value, field, requiredValue = false) { const result = [...new Set(array(value, field, requiredValue).map(String).map((item) => item.trim()).filter(Boolean))]; if (requiredValue && !result.length) fail("customer_channel_invalid", `${field} requires values.`); return result; }
function oneOf(value, allowed, field) { if (!allowed.includes(value)) fail("customer_channel_invalid", `${field} is invalid.`); return value; }
function boundedInteger(value, min, max, field) { if (!Number.isInteger(value) || value < min || value > max) fail("customer_channel_invalid", `${field} must be between ${min} and ${max}.`); return value; }
function nonFuture(value, now, field) { const time = Date.parse(value); if (!Number.isFinite(time) || time > now.getTime()) fail("customer_channel_invalid", `${field} must not be in the future.`); return new Date(time).toISOString(); }
function future(value, now, field) { const time = Date.parse(value); if (!Number.isFinite(time) || time <= now.getTime()) fail("customer_channel_invalid", `${field} must be in the future.`); return new Date(time).toISOString(); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
