/**
 * AI agent marketplace and platform commercialization: the FST-034
 * lifecycle for tenant-installed scoped platform agents — marketplace
 * templates (`AI_AGENT_MARKETPLACE_TEMPLATES`, e.g. CAM drafting,
 * underwriting review, loan fulfilment, borrower support), pricing
 * contracts, usage budgets/reservations, agent installation and four-role
 * production activation, execution authorization/completion, usage
 * metering, and GST-aware invoicing. This module is the commercial/
 * governance record layer — it does not itself run the agent or evaluate
 * guardrails; every mutating call that represents an agent doing something
 * consequential (activation, execution) instead *requires* an already-
 * rendered decision from the isolated business/control rules engine
 * (`trustedDecision` — source must be `"isolated_business_engine"` or
 * `"isolated_control_engine"`, per AGENTS.md's engine-isolation and
 * `guardrail.*` conventions) and, for model use, a passing
 * `evaluateModelUse` check against the model-governance kill switch.
 *
 * Production activation of an installation requires all four FST-034
 * approval roles (`APPROVAL_ROLES`: model_owner, model_validator,
 * human_reviewer, model_risk_manager) from distinct human principals, none
 * of whom may be the proposer — "AI cannot approve releases" generalized
 * to agent go-live (AGENTS.md). Every record is content-hashed (`seal()`)
 * so tampering with persisted state is detectable. Money in pricing,
 * budgets, usage, and invoices is carried as exact integer-paise strings
 * and combined via `BigInt`, never floating point (AGENTS.md's "exact
 * money math", applied here in JS). A usage budget is an opt-in hard
 * commercial control: its limits are reserved *before* a model call via
 * `reserveAiAgentUsageBudget`, and actual usage recorded later
 * (`recordAiAgentUsage`) must not exceed what was reserved — cost is
 * capped before it's incurred, not discovered after the fact.
 */
import { createHash } from "node:crypto";
import { evaluateModelUse } from "./model-governance.js";

const IST_REGION = "ap-south-1";
const APPROVAL_ROLES = Object.freeze(["model_owner", "model_validator", "human_reviewer", "model_risk_manager"]);
const REQUIRED_EVIDENCE = Object.freeze(["riskAssessmentRef", "independentValidationRef", "fairnessAssessmentRef", "explainabilityRef", "redTeamRef", "monitoringPlanRef", "incidentRunbookRef", "indiaResidencyRef"]);

export const AI_AGENT_MARKETPLACE_TEMPLATES = Object.freeze({
  "credit.cam": template("credit.cam", "CAM preparation worker", "credit", "A1", ["cam.draft", "evidence.gap_list"], ["guardrail.model_consumption", "guardrail.agent_action"], false),
  "credit.underwriting_review": template("credit.underwriting_review", "Underwriting review worker", "credit", "A1", ["underwriting.memo_draft", "policy.exception_list"], ["guardrail.model_consumption", "guardrail.agent_action"], false),
  "operations.loan_fulfilment": template("operations.loan_fulfilment", "Loan fulfilment worker", "operations", "A2", ["document.request_draft", "workflow.task_draft", "checklist.update_draft"], ["guardrail.model_consumption", "guardrail.agent_action"], false),
  "service.borrower_support": template("service.borrower_support", "Borrower support worker", "service", "A2", ["response.draft", "handoff.create"], ["guardrail.model_consumption", "guardrail.agent_action"], true)
});

export const AI_AGENT_PRICING_DIMENSIONS = Object.freeze([
  "monthly_platform_fee_paise", "included_executions", "included_input_tokens", "included_output_tokens",
  "per_execution_paise", "per_1k_input_tokens_paise", "per_1k_output_tokens_paise"
]);

/**
 * @returns {object} an empty, correctly-shaped platform state (no
 *   contracts, installations, executions, usage, budgets, invoices, events).
 */
export function createAiAgentPlatformState() {
  return { pricingContracts: {}, installations: {}, executions: {}, usageLedger: {}, usageBudgets: {}, budgetReservations: {}, invoices: {}, events: [] };
}

/**
 * Coerce a possibly-partial or missing persisted platform state into the
 * full well-shaped state every function in this module expects.
 * @param {object|null|undefined} state
 * @returns {object} normalized state with all required top-level collections.
 */
export function normalizeAiAgentPlatformState(state) {
  const empty = createAiAgentPlatformState();
  return state && typeof state === "object" ? {
    pricingContracts: state.pricingContracts ?? {}, installations: state.installations ?? {},
    executions: state.executions ?? {}, usageLedger: state.usageLedger ?? {}, usageBudgets: state.usageBudgets ?? {},
    budgetReservations: state.budgetReservations ?? {}, invoices: state.invoices ?? {},
    events: Array.isArray(state.events) ? state.events : []
  } : empty;
}

/**
 * @returns {object} the read-only marketplace catalogue: pricing
 *   dimensions and every available agent template.
 */
export function projectAiAgentMarketplace() {
  return {
    catalogueVersion: 1,
    commercialization: "tenant_contract_required",
    currency: "INR",
    pricingDimensions: AI_AGENT_PRICING_DIMENSIONS,
    templates: Object.values(AI_AGENT_MARKETPLACE_TEMPLATES)
  };
}

/**
 * Propose a tenant pricing contract covering one or more marketplace
 * templates. Fails closed on a duplicate `contractId`, an unknown
 * template id, a malformed (non-integer-string) pricing value, or
 * `validUntil` not after `effectiveFrom`.
 * @param {object} state - platform state.
 * @param {object} input - contractId, tenantId, templateIds, pricing, effectiveFrom, validUntil, proposedBy.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the new `"pending_approval"` contract.
 */
export function proposeAiAgentPricingContract(state, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["contractId", "tenantId", "effectiveFrom", "validUntil", "proposedBy"]);
  if (platform.pricingContracts[input.contractId]) fail("ai_agent_pricing_contract_exists", "Pricing contract already exists.", 409);
  const templateIds = unique(input.templateIds);
  if (!templateIds.length || templateIds.some((id) => !AI_AGENT_MARKETPLACE_TEMPLATES[id])) fail("ai_agent_template_invalid", "Pricing contract contains an unknown marketplace template.");
  const pricing = Object.fromEntries(AI_AGENT_PRICING_DIMENSIONS.map((key) => [key, integerString(input.pricing?.[key] ?? "0", `pricing.${key}`)]));
  const contract = seal({ contractId: input.contractId, tenantId: input.tenantId, templateIds, currency: "INR", pricing, effectiveFrom: iso(input.effectiveFrom), validUntil: iso(input.validUntil), proposedBy: input.proposedBy, approvedBy: null, commercialApprovalRef: null, status: "pending_approval", createdAt: now.toISOString() });
  if (Date.parse(contract.validUntil) <= Date.parse(contract.effectiveFrom)) fail("ai_agent_pricing_period_invalid", "Pricing contract validUntil must be after effectiveFrom.");
  return result(platform, "pricingContracts", contract.contractId, contract, "ai_agent.pricing_contract_proposed", now);
}

/**
 * Approve a pending pricing contract. Requires an approver independent of
 * the proposer.
 * @param {object} state - platform state.
 * @param {object} input - contractId, tenantId, approvedBy, commercialApprovalRef.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the now-`"active"` contract.
 */
export function approveAiAgentPricingContract(state, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["contractId", "tenantId", "approvedBy", "commercialApprovalRef"]);
  const contract = tenantRecord(platform.pricingContracts[input.contractId], input.tenantId, "ai_agent_pricing_contract_invalid");
  if (contract.status !== "pending_approval") fail("ai_agent_pricing_contract_not_pending", "Pricing contract is not pending approval.", 409);
  independent(contract.proposedBy, input.approvedBy, "ai_agent_pricing_self_approval");
  const approved = seal({ ...contract, status: "active", approvedBy: input.approvedBy, commercialApprovalRef: input.commercialApprovalRef, approvedAt: now.toISOString() });
  return result(platform, "pricingContracts", approved.contractId, approved, "ai_agent.pricing_contract_approved", now);
}

/**
 * Propose a usage budget (executions/tokens/paise ceilings) against an
 * active pricing contract. A budget is an opt-in hard commercial control:
 * its limits are reserved before a model call, rather than discovered
 * after a provider has already incurred cost. Fails closed on a duplicate
 * `budgetId`, an inactive contract, or `validUntil` not after `effectiveFrom`.
 * @param {object} state - platform state.
 * @param {object} input - budgetId, tenantId, contractId, limits, effectiveFrom, validUntil, proposedBy.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the new `"pending_approval"` budget.
 */
export function proposeAiAgentUsageBudget(state, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["budgetId", "tenantId", "contractId", "effectiveFrom", "validUntil", "proposedBy", "limits"]);
  if (platform.usageBudgets[input.budgetId]) fail("ai_agent_budget_exists", "Usage budget already exists.", 409);
  const contract = tenantRecord(platform.pricingContracts[input.contractId], input.tenantId, "ai_agent_pricing_contract_invalid");
  if (contract.status !== "active") fail("ai_agent_pricing_contract_inactive", "A budget requires an active pricing contract.", 403);
  const budget = seal({ budgetId: input.budgetId, tenantId: input.tenantId, contractId: contract.contractId,
    effectiveFrom: iso(input.effectiveFrom), validUntil: iso(input.validUntil), limits: budgetLimits(input.limits),
    proposedBy: input.proposedBy, approvedBy: null, commercialApprovalRef: null, status: "pending_approval", createdAt: now.toISOString() });
  if (Date.parse(budget.validUntil) <= Date.parse(budget.effectiveFrom)) fail("ai_agent_budget_period_invalid", "Budget validUntil must be after effectiveFrom.");
  return result(platform, "usageBudgets", budget.budgetId, budget, "ai_agent.usage_budget_proposed", now);
}

/**
 * Approve a pending usage budget. Requires an approver independent of the proposer.
 * @param {object} state - platform state.
 * @param {object} input - budgetId, tenantId, approvedBy, commercialApprovalRef.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the now-`"active"` budget.
 */
export function approveAiAgentUsageBudget(state, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["budgetId", "tenantId", "approvedBy", "commercialApprovalRef"]);
  const budget = tenantRecord(platform.usageBudgets[input.budgetId], input.tenantId, "ai_agent_usage_budget_invalid");
  if (budget.status !== "pending_approval") fail("ai_agent_usage_budget_not_pending", "Usage budget is not pending approval.", 409);
  independent(budget.proposedBy, input.approvedBy, "ai_agent_usage_budget_self_approval");
  const approved = seal({ ...budget, status: "active", approvedBy: input.approvedBy, commercialApprovalRef: input.commercialApprovalRef, approvedAt: now.toISOString() });
  return result(platform, "usageBudgets", approved.budgetId, approved, "ai_agent.usage_budget_approved", now);
}

/**
 * Reserve budget capacity for an anticipated execution before the model
 * call happens. Prices the expected usage against the contract's rate
 * card and checks it against the budget's remaining capacity (already-
 * committed usage plus outstanding reservations) — fails closed
 * (`enforceBudget`) if any dimension (executions/tokens/paise) would be
 * exceeded. The reservation expires after 15 minutes if not consumed.
 * @param {object} state - platform state.
 * @param {object} input - reservationId, tenantId, installationId, expectedInputTokens, expectedOutputTokens.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the new `"reserved"` reservation.
 */
export function reserveAiAgentUsageBudget(state, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["reservationId", "tenantId", "installationId", "expectedInputTokens", "expectedOutputTokens"]);
  if (platform.budgetReservations[input.reservationId]) fail("ai_agent_budget_reservation_exists", "Budget reservation already exists.", 409);
  const installation = tenantRecord(platform.installations[input.installationId], input.tenantId, "ai_agent_installation_missing");
  const contract = tenantRecord(platform.pricingContracts[installation.contractId], input.tenantId, "ai_agent_pricing_contract_invalid");
  const budget = activeBudget(platform, input.tenantId, contract.contractId, now);
  if (!budget) fail("ai_agent_budget_not_active", "No active usage budget exists for this installation's contract.", 403);
  const metrics = { executions: "1", inputTokens: integerString(input.expectedInputTokens, "expectedInputTokens"), outputTokens: integerString(input.expectedOutputTokens, "expectedOutputTokens") };
  const chargePaise = priceUsage(metrics, contract.pricing).toString();
  const totals = budgetCommitted(platform, budget.budgetId);
  enforceBudget(budget, addMetrics(totals, { ...metrics, chargePaise }));
  const reservation = seal({ reservationId: input.reservationId, tenantId: input.tenantId, budgetId: budget.budgetId, contractId: contract.contractId, installationId: installation.installationId, metrics, chargePaise, status: "reserved", reservedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString() });
  return result(platform, "budgetReservations", reservation.reservationId, reservation, "ai_agent.usage_budget_reserved", now);
}

/**
 * Propose installing a marketplace agent template for a tenant, pinned to
 * a specific model version. Fails closed unless: the template exists, the
 * tenant's pricing contract is active, current, and actually entitles this
 * template, `promptHash` is well-formed SHA-256, the pinned model passes
 * `evaluateModelUse` and its registered version matches exactly, and any
 * customized `allowedActions` stay within the template's own action scope
 * (a tenant cannot expand what the agent is allowed to do beyond the
 * marketplace definition).
 * @param {object} state - platform state.
 * @param {object} modelRegistry - model governance registry, for `evaluateModelUse`.
 * @param {object} input - installationId, tenantId, templateId, contractId, modelId, modelVersion, workloadPrincipalId, humanSponsorPrincipalId, promptRef, promptHash, configurationRef, allowedActions, languages, productTypes, dataScopes, knowledgeSources, proposedBy.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the new `"pending_approval"` installation.
 */
export function installTenantAiAgent(state, modelRegistry, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["installationId", "tenantId", "templateId", "contractId", "modelId", "modelVersion", "workloadPrincipalId", "humanSponsorPrincipalId", "promptRef", "promptHash", "configurationRef", "proposedBy"]);
  if (platform.installations[input.installationId]) fail("ai_agent_installation_exists", "Agent installation already exists.", 409);
  const templateDef = AI_AGENT_MARKETPLACE_TEMPLATES[input.templateId];
  if (!templateDef) fail("ai_agent_template_invalid", "Unknown marketplace agent template.");
  const contract = platform.pricingContracts[input.contractId];
  tenantRecord(contract, input.tenantId, "ai_agent_pricing_contract_invalid");
  if (contract.status !== "active" || !contract.templateIds.includes(input.templateId)) fail("ai_agent_not_entitled", "Pricing contract does not entitle this agent template.", 403);
  if (now.getTime() < Date.parse(contract.effectiveFrom) || now.getTime() > Date.parse(contract.validUntil)) fail("ai_agent_pricing_contract_inactive", "Pricing contract is outside its effective period.", 403);
  if (!/^[a-f0-9]{64}$/i.test(input.promptHash)) fail("ai_agent_prompt_hash_invalid", "promptHash must be SHA-256 hex.");
  const modelUse = evaluateModelUse(modelRegistry, { modelId: input.modelId });
  if (!modelUse.allowed) fail("ai_agent_model_not_usable", "The pinned model is not approved for use.", 409, { findings: modelUse.findings });
  if (String(modelUse.model.version) !== String(input.modelVersion)) fail("ai_agent_model_version_mismatch", "Installation must pin the exact registered model version.", 409);
  const actions = unique(input.allowedActions ?? templateDef.allowedActions);
  if (actions.some((action) => !templateDef.allowedActions.includes(action))) fail("ai_agent_action_scope_expanded", "Tenant customization cannot expand marketplace action scope.");
  const installation = seal({
    installationId: input.installationId, tenantId: input.tenantId, templateId: input.templateId, templateVersion: templateDef.version,
    contractId: input.contractId, modelId: input.modelId, modelVersion: String(input.modelVersion), workloadPrincipalId: input.workloadPrincipalId,
    humanSponsorPrincipalId: input.humanSponsorPrincipalId, autonomy: templateDef.maximumAutonomy, allowedActions: actions,
    languages: unique(input.languages ?? ["en-IN"]), productTypes: unique(input.productTypes ?? []), dataScopes: unique(input.dataScopes ?? []),
    promptRef: input.promptRef, promptHash: input.promptHash.toLowerCase(), configurationRef: input.configurationRef,
    knowledgeSources: normalizeKnowledge(input.knowledgeSources), memoryMode: "execution_scoped", dataRegion: IST_REGION,
    requiredGuardrails: templateDef.requiredGuardrails, customerFacing: templateDef.customerFacing, status: "pending_approval",
    proposedBy: input.proposedBy, approvedByRole: {}, governanceEvidence: {}, activationControl: null, createdAt: now.toISOString(), activatedAt: null
  });
  return result(platform, "installations", installation.installationId, installation, "ai_agent.installation_proposed", now);
}

/**
 * Activate a pending installation into production. Requires: all four
 * FST-034 approval roles already recorded (`validateApprovals`), the full
 * `REQUIRED_EVIDENCE` set (risk assessment, independent validation,
 * fairness, explainability, red-team, monitoring plan, incident runbook,
 * India-residency references), the pinned model still passing
 * `evaluateModelUse` at its exact registered version, and an affirmative,
 * traceable `"allow"` decision from the isolated control engine
 * (`trustedDecision`) — activation cannot proceed on locally-asserted
 * approval alone.
 * @param {object} state - platform state.
 * @param {object} modelRegistry - model governance registry.
 * @param {object} input - installationId, tenantId, governanceEvidence, controlDecision.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the now-`"active"` installation.
 */
export function activateTenantAiAgent(state, modelRegistry, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["installationId", "tenantId", "governanceEvidence", "controlDecision"]);
  const installation = tenantRecord(platform.installations[input.installationId], input.tenantId, "ai_agent_installation_missing");
  if (installation.status !== "pending_approval") fail("ai_agent_installation_not_pending", "Only a pending installation can be activated.", 409);
  const modelUse = evaluateModelUse(modelRegistry, { modelId: installation.modelId, customerDisclosureRef: input.governanceEvidence.customerDisclosureRef });
  if (!modelUse.allowed) fail("ai_agent_model_not_usable", "The pinned model is not approved for use.", 409, { findings: modelUse.findings });
  if (String(modelUse.model.version) !== installation.modelVersion) fail("ai_agent_model_version_mismatch", "The registered model version no longer matches the approved installation.", 409);
  const approvals = validateApprovals(installation.approvedByRole, installation.proposedBy);
  required(input.governanceEvidence, REQUIRED_EVIDENCE);
  trustedDecision(input.controlDecision, "allow", "ai_agent_activation_control_denied");
  const activated = seal({ ...installation, status: "active", approvedByRole: approvals, governanceEvidence: input.governanceEvidence, activationControl: decisionProjection(input.controlDecision), activatedAt: now.toISOString(), updatedAt: now.toISOString() });
  return result(platform, "installations", activated.installationId, activated, "ai_agent.installation_activated", now);
}

/**
 * Record one of the four FST-034 production-approval roles against a
 * pending installation. Fails closed unless the principal is human, the
 * role is a recognized FST-034 role, the role hasn't already been
 * recorded, the approver isn't the proposer, and no other role has
 * already been approved by this same principal (each of the four roles
 * needs a distinct human).
 * @param {object} state - platform state.
 * @param {object} input - installationId, tenantId, role, principalId, principalType, approvalRef.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the installation with the role recorded.
 */
export function recordTenantAiAgentApproval(state, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["installationId", "tenantId", "role", "principalId", "principalType", "approvalRef"]);
  if (input.principalType !== "human") fail("ai_agent_human_approval_required", "AI production approval must be performed by a human principal.", 403);
  if (!APPROVAL_ROLES.includes(input.role)) fail("ai_agent_approval_role_invalid", "Approval role is not part of FST-034.");
  const installation = tenantRecord(platform.installations[input.installationId], input.tenantId, "ai_agent_installation_missing");
  if (installation.status !== "pending_approval") fail("ai_agent_installation_not_pending", "Only a pending installation may be approved.", 409);
  if (installation.proposedBy === input.principalId) fail("ai_agent_proposer_cannot_approve", "The proposer cannot approve production activation.");
  const existing = installation.approvedByRole ?? {};
  if (existing[input.role]) fail("ai_agent_approval_role_already_recorded", "This approval role is already recorded.", 409);
  if (Object.values(existing).some((approval) => approval.principalId === input.principalId)) fail("ai_agent_approval_independence_required", "Each approval role requires a distinct human principal.");
  const approved = seal({ ...installation, approvedByRole: { ...existing, [input.role]: { principalId: input.principalId, approvalRef: input.approvalRef } }, updatedAt: now.toISOString() });
  return result(platform, "installations", approved.installationId, approved, "ai_agent.installation_approval_recorded", now);
}

/**
 * Authorize one agent execution. Fails closed unless: the installation is
 * active, its pricing contract is active and current, the requested
 * `action` is within the installation's allowed actions, a current
 * matching budget reservation exists (when the contract has an active
 * budget), `inputHash` is well-formed SHA-256, the pinned model still
 * passes `evaluateModelUse` at its exact version, a customer-facing
 * installation carries a disclosure reference, and both the model-
 * consumption and action-guardrail decisions are affirmative, traceable,
 * isolated-engine decisions (`trustedDecision`) — an execution cannot be
 * authorized on the agent's own say-so.
 * @param {object} state - platform state.
 * @param {object} modelRegistry - model governance registry.
 * @param {object} input - executionId, tenantId, installationId, action, purpose, inputRef, inputHash, modelConsumptionDecision, actionGuardrailDecision, usageReservationId, humanReviewRef, customerDisclosureRef.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the new `"authorized"` execution.
 */
export function authorizeAiAgentExecution(state, modelRegistry, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["executionId", "tenantId", "installationId", "action", "purpose", "inputRef", "inputHash", "modelConsumptionDecision", "actionGuardrailDecision"]);
  if (platform.executions[input.executionId]) fail("ai_agent_execution_exists", "Execution ID already exists.", 409);
  const installation = tenantRecord(platform.installations[input.installationId], input.tenantId, "ai_agent_installation_missing");
  if (installation.status !== "active") fail("ai_agent_installation_inactive", "Agent installation is not active.", 409);
  const contract = tenantRecord(platform.pricingContracts[installation.contractId], input.tenantId, "ai_agent_pricing_contract_invalid");
  if (contract.status !== "active" || now.getTime() < Date.parse(contract.effectiveFrom) || now.getTime() > Date.parse(contract.validUntil)) fail("ai_agent_pricing_contract_inactive", "Agent execution requires a current active pricing contract.", 403);
  if (!installation.allowedActions.includes(input.action)) fail("ai_agent_action_not_allowed", "Requested action is outside the approved customization.", 403);
  const budget = activeBudget(platform, input.tenantId, contract.contractId, now);
  let reservationId = null;
  if (budget) {
    required(input, ["usageReservationId"]);
    const reservation = tenantRecord(platform.budgetReservations[input.usageReservationId], input.tenantId, "ai_agent_budget_reservation_invalid");
    if (reservation.status !== "reserved" || reservation.budgetId !== budget.budgetId || reservation.installationId !== installation.installationId || Date.parse(reservation.expiresAt) < now.getTime()) fail("ai_agent_budget_reservation_invalid", "A current matching budget reservation is required.", 403);
    reservationId = reservation.reservationId;
  }
  if (!/^[a-f0-9]{64}$/i.test(input.inputHash)) fail("ai_agent_input_hash_invalid", "inputHash must be SHA-256 hex.");
  const modelUse = evaluateModelUse(modelRegistry, { modelId: installation.modelId, humanReviewRef: input.humanReviewRef, customerDisclosureRef: input.customerDisclosureRef });
  if (!modelUse.allowed) fail("ai_agent_model_not_usable", "Model use is blocked by governance or kill switch.", 409, { findings: modelUse.findings });
  if (String(modelUse.model.version) !== installation.modelVersion) fail("ai_agent_model_version_mismatch", "The registered model version no longer matches the approved installation.", 409);
  if (installation.customerFacing && !input.customerDisclosureRef) fail("ai_agent_disclosure_required", "Customer-facing execution requires an AI disclosure reference.");
  trustedDecision(input.modelConsumptionDecision, "allow", "ai_agent_model_consumption_denied");
  trustedDecision(input.actionGuardrailDecision, "allow", "ai_agent_action_guardrail_denied");
  const execution = seal({ executionId: input.executionId, tenantId: input.tenantId, installationId: input.installationId, templateId: installation.templateId, action: input.action, purpose: input.purpose, inputRef: input.inputRef, inputHash: input.inputHash.toLowerCase(), modelId: installation.modelId, modelVersion: installation.modelVersion, promptHash: installation.promptHash, configurationRef: installation.configurationRef, workloadPrincipalId: installation.workloadPrincipalId, humanSponsorPrincipalId: installation.humanSponsorPrincipalId, modelConsumptionDecision: decisionProjection(input.modelConsumptionDecision), actionGuardrailDecision: decisionProjection(input.actionGuardrailDecision), humanReviewRef: input.humanReviewRef ?? null, customerDisclosureRef: input.customerDisclosureRef ?? null, usageReservationId: reservationId, status: "authorized", dataRegion: IST_REGION, authorizedAt: now.toISOString(), completedAt: null, outputRef: null, outputHash: null });
  return result(platform, "executions", execution.executionId, execution, "ai_agent.execution_authorized", now);
}

/**
 * Complete an authorized execution with its outcome and output evidence.
 * Fails closed unless the execution is currently `"authorized"`,
 * `outputHash` is well-formed SHA-256, and the outcome is one of the
 * recognized values (`proposal_created`/`human_handoff`/`no_action`/`failed`).
 * @param {object} state - platform state.
 * @param {object} input - executionId, tenantId, outputRef, outputHash, outcome, citations.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the now-`"completed"` or `"failed"` execution.
 */
export function completeAiAgentExecution(state, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["executionId", "tenantId", "outputRef", "outputHash", "outcome"]);
  const execution = tenantRecord(platform.executions[input.executionId], input.tenantId, "ai_agent_execution_missing");
  if (execution.status !== "authorized") fail("ai_agent_execution_not_authorized", "Only an authorized execution can be completed.", 409);
  if (!/^[a-f0-9]{64}$/i.test(input.outputHash)) fail("ai_agent_output_hash_invalid", "outputHash must be SHA-256 hex.");
  if (!['proposal_created', 'human_handoff', 'no_action', 'failed'].includes(input.outcome)) fail("ai_agent_outcome_invalid", "Execution outcome is invalid.");
  const completed = seal({ ...execution, status: input.outcome === "failed" ? "failed" : "completed", outcome: input.outcome, outputRef: input.outputRef, outputHash: input.outputHash.toLowerCase(), citations: unique(input.citations ?? []), completedAt: now.toISOString() });
  return result(platform, "executions", completed.executionId, completed, "ai_agent.execution_completed", now);
}

/**
 * Record actual metered usage for a finalized execution and price it
 * against the contract's rate card. Fails closed on a duplicate usage id,
 * an execution not yet in a final state, an execution that already has a
 * usage record, or — when the execution had a budget reservation — actual
 * usage exceeding what was reserved (`ai_agent_budget_reservation_exceeded`,
 * since a reservation is deliberately conservative and must not be
 * retroactively raised). Consumes the matching reservation if present.
 * @param {object} state - platform state.
 * @param {object} input - usageId, executionId, tenantId, inputTokens, outputTokens, toolCalls.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the new usage-ledger entry.
 */
export function recordAiAgentUsage(state, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["usageId", "executionId", "tenantId"]);
  if (platform.usageLedger[input.usageId]) fail("ai_agent_usage_exists", "Usage record already exists.", 409);
  const execution = tenantRecord(platform.executions[input.executionId], input.tenantId, "ai_agent_execution_missing");
  if (!["completed", "failed"].includes(execution.status)) fail("ai_agent_execution_usage_not_final", "Usage may be recorded only after execution reaches a final state.", 409);
  if (Object.values(platform.usageLedger).some((item) => item.executionId === execution.executionId)) fail("ai_agent_execution_usage_exists", "Execution already has a usage record.", 409);
  const installation = platform.installations[execution.installationId];
  const contract = tenantRecord(platform.pricingContracts[installation.contractId], input.tenantId, "ai_agent_pricing_contract_invalid");
  const metrics = { executions: "1", inputTokens: integerString(input.inputTokens ?? "0", "inputTokens"), outputTokens: integerString(input.outputTokens ?? "0", "outputTokens"), toolCalls: integerString(input.toolCalls ?? "0", "toolCalls") };
  const p = contract.pricing;
  const chargePaise = BigInt(priceUsage(metrics, p));
  let reservations = platform.budgetReservations;
  if (execution.usageReservationId) {
    const reservation = tenantRecord(reservations[execution.usageReservationId], input.tenantId, "ai_agent_budget_reservation_invalid");
    if (reservation.status !== "reserved") fail("ai_agent_budget_reservation_not_available", "Usage budget reservation is not available.", 409);
    // Reservation is deliberately conservative: actual usage may not exceed the approved estimate.
    if (BigInt(metrics.inputTokens) > BigInt(reservation.metrics.inputTokens) || BigInt(metrics.outputTokens) > BigInt(reservation.metrics.outputTokens) || chargePaise > BigInt(reservation.chargePaise)) fail("ai_agent_budget_reservation_exceeded", "Actual usage exceeded the pre-authorized budget reservation.", 403);
    reservations = { ...reservations, [reservation.reservationId]: seal({ ...reservation, status: "consumed", executionId: execution.executionId, usageId: input.usageId, actualMetrics: metrics, actualChargePaise: chargePaise.toString(), consumedAt: now.toISOString() }) };
  }
  const usage = seal({ usageId: input.usageId, tenantId: input.tenantId, executionId: input.executionId, installationId: installation.installationId, contractId: contract.contractId, budgetId: execution.usageReservationId ? platform.budgetReservations[execution.usageReservationId]?.budgetId ?? null : null, modelId: execution.modelId, modelVersion: execution.modelVersion, region: IST_REGION, metrics, currency: "INR", chargePaise: chargePaise.toString(), recordedAt: now.toISOString() });
  const next = { ...platform, budgetReservations: reservations };
  return result(next, "usageLedger", usage.usageId, usage, "ai_agent.usage_recorded", now);
}

/**
 * Draft an invoice for a contract's usage over a period: sums the
 * period's usage-ledger entries, applies the contract's included-quota/
 * overage rate card (`invoiceCharges`), and computes GST (CGST+SGST for
 * intra-state, IGST for inter-state) via `invoiceTax`. Fails closed on a
 * duplicate invoice id, an invalid period, or an invoice already existing
 * for this contract+period.
 * @param {object} state - platform state.
 * @param {object} input - invoiceId, tenantId, contractId, periodFrom, periodTo, proposedBy, tax.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the new `"pending_approval"` invoice.
 */
export function proposeAiAgentInvoice(state, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["invoiceId", "tenantId", "contractId", "periodFrom", "periodTo", "proposedBy", "tax"]);
  if (platform.invoices[input.invoiceId]) fail("ai_agent_invoice_exists", "Invoice already exists.", 409);
  const contract = tenantRecord(platform.pricingContracts[input.contractId], input.tenantId, "ai_agent_pricing_contract_invalid");
  const periodFrom = iso(input.periodFrom), periodTo = iso(input.periodTo);
  if (Date.parse(periodTo) <= Date.parse(periodFrom)) fail("ai_agent_invoice_period_invalid", "Invoice periodTo must be after periodFrom.");
  const prior = Object.values(platform.invoices).find((x) => x.tenantId === input.tenantId && x.contractId === contract.contractId && x.periodFrom === periodFrom && x.periodTo === periodTo);
  if (prior) fail("ai_agent_invoice_period_exists", "An invoice already exists for this contract and period.", 409);
  const usage = Object.values(platform.usageLedger).filter((x) => x.tenantId === input.tenantId && x.contractId === contract.contractId && Date.parse(x.recordedAt) >= Date.parse(periodFrom) && Date.parse(x.recordedAt) < Date.parse(periodTo));
  const totals = usageTotals(usage);
  const charges = invoiceCharges(totals, contract.pricing);
  const tax = invoiceTax(input.tax, charges.subtotalPaise);
  const invoice = seal({ invoiceId: input.invoiceId, tenantId: input.tenantId, contractId: contract.contractId, currency: "INR", periodFrom, periodTo,
    usage: { ...totals, ledgerEntries: usage.map((x) => ({ usageId: x.usageId, recordHash: x.recordHash })) }, charges, tax,
    totalPaise: (BigInt(charges.subtotalPaise) + BigInt(tax.totalTaxPaise)).toString(), status: "pending_approval", proposedBy: input.proposedBy, approvedBy: null, commercialApprovalRef: null, createdAt: now.toISOString() });
  return result(platform, "invoices", invoice.invoiceId, invoice, "ai_agent.invoice_proposed", now);
}

/**
 * Approve a pending invoice. Requires an approver independent of the proposer.
 * @param {object} state - platform state.
 * @param {object} input - invoiceId, tenantId, approvedBy, commercialApprovalRef.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the now-`"approved"` invoice.
 */
export function approveAiAgentInvoice(state, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["invoiceId", "tenantId", "approvedBy", "commercialApprovalRef"]);
  const invoice = tenantRecord(platform.invoices[input.invoiceId], input.tenantId, "ai_agent_invoice_invalid");
  if (invoice.status !== "pending_approval") fail("ai_agent_invoice_not_pending", "Invoice is not pending approval.", 409);
  independent(invoice.proposedBy, input.approvedBy, "ai_agent_invoice_self_approval");
  const approved = seal({ ...invoice, status: "approved", approvedBy: input.approvedBy, commercialApprovalRef: input.commercialApprovalRef, approvedAt: now.toISOString() });
  return result(platform, "invoices", approved.invoiceId, approved, "ai_agent.invoice_approved", now);
}

/**
 * Suspend an agent installation (e.g. incident-driven). Unlike activation,
 * this is a unilateral safety action — no four-eyes requirement, since
 * suspending is the conservative direction.
 * @param {object} state - platform state.
 * @param {object} input - installationId, tenantId, reason, actor, incidentRef.
 * @param {Date} [now]
 * @returns {{state: object, record: object}} the now-`"suspended"` installation.
 */
export function suspendTenantAiAgent(state, input, now = new Date()) {
  const platform = normalizeAiAgentPlatformState(state);
  required(input, ["installationId", "tenantId", "reason", "actor", "incidentRef"]);
  const installation = tenantRecord(platform.installations[input.installationId], input.tenantId, "ai_agent_installation_missing");
  const suspended = seal({ ...installation, status: "suspended", suspensionReason: input.reason, suspensionIncidentRef: input.incidentRef, suspendedBy: input.actor, suspendedAt: now.toISOString(), updatedAt: now.toISOString() });
  return result(platform, "installations", suspended.installationId, suspended, "ai_agent.installation_suspended", now);
}

/**
 * Build a tenant governance report over an optional period: installation
 * counts by status, execution counts by outcome, aggregate usage/spend,
 * and a `lineage.traceComplete` flag confirming every execution in the
 * window carries full evidentiary linkage (record/input hashes plus
 * traceable guardrail decisions) — the read-only artifact a regulator or
 * internal audit would review.
 * @param {object} state - platform state.
 * @param {string} tenantId
 * @param {{from?: string, to?: string}} [period]
 * @returns {object} sealed (content-hashed) governance report.
 */
export function buildAiAgentGovernanceReport(state, tenantId, { from, to } = {}) {
  const platform = normalizeAiAgentPlatformState(state);
  const start = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const end = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) fail("ai_agent_report_period_invalid", "Governance report period is invalid.");
  const installations = Object.values(platform.installations).filter((x) => x.tenantId === tenantId);
  const executions = Object.values(platform.executions).filter((x) => x.tenantId === tenantId && Date.parse(x.authorizedAt) >= start && Date.parse(x.authorizedAt) <= end);
  const usage = Object.values(platform.usageLedger).filter((x) => x.tenantId === tenantId && Date.parse(x.recordedAt) >= start && Date.parse(x.recordedAt) <= end);
  const report = { tenantId, period: { from: from ?? null, to: to ?? null }, installations: { total: installations.length, active: installations.filter((x) => x.status === "active").length, suspended: installations.filter((x) => x.status === "suspended").length }, executions: { total: executions.length, completed: executions.filter((x) => x.status === "completed").length, failed: executions.filter((x) => x.status === "failed").length, humanHandoffs: executions.filter((x) => x.outcome === "human_handoff").length }, usage: { inputTokens: sum(usage, "inputTokens"), outputTokens: sum(usage, "outputTokens"), toolCalls: sum(usage, "toolCalls"), chargePaise: usage.reduce((n, x) => n + BigInt(x.chargePaise), 0n).toString(), currency: "INR" }, lineage: { traceComplete: executions.every((x) => x.recordHash && x.inputHash && x.modelConsumptionDecision?.traceRef && x.actionGuardrailDecision?.traceRef), rawPromptsStored: false }, regulatoryControlFamilies: ["RBI-DLD-2025", "RBI-IT-23", "DPDP-ACT-2023", "FREE-AI-2025", "RBI-MRM-DRAFT-2026"] };
  return seal(report);
}

function template(id, name, category, maximumAutonomy, allowedActions, requiredGuardrails, customerFacing) { return Object.freeze({ templateId: id, version: 1, name, category, maximumAutonomy, allowedActions: Object.freeze(allowedActions), requiredGuardrails: Object.freeze(requiredGuardrails), customerFacing, decisionAuthority: "none", outputType: "proposal_only", status: "available" }); }
function normalizeKnowledge(values = []) { return values.map((x) => { required(x, ["ref", "version", "contentHash"]); if (!/^[a-f0-9]{64}$/i.test(x.contentHash)) fail("ai_agent_knowledge_hash_invalid", "Knowledge contentHash must be SHA-256 hex."); return { ref: x.ref, version: String(x.version), contentHash: x.contentHash.toLowerCase() }; }); }
function validateApprovals(value, proposer) { if (!value || typeof value !== "object") fail("ai_agent_approvals_required", "Four-role approval is required."); const ids = APPROVAL_ROLES.map((role) => { const a = value[role]; required(a, ["principalId", "approvalRef"]); if (a.principalType && a.principalType !== "human") fail("ai_agent_human_approval_required", `${role} approval must be human.`); if (a.principalId === proposer) fail("ai_agent_proposer_cannot_approve", "The proposer cannot approve production activation."); return a.principalId; }); if (new Set(ids).size !== ids.length) fail("ai_agent_approval_independence_required", "All four production approval roles must use distinct human principals."); return Object.fromEntries(APPROVAL_ROLES.map((role) => [role, { principalId: value[role].principalId, approvalRef: value[role].approvalRef }])); }
function trustedDecision(value, outcome, code) { if (!value || value.decision !== outcome || !value.traceRef || !["isolated_business_engine", "isolated_control_engine"].includes(value.source)) fail(code, "An affirmative traceable isolated-engine decision is required.", 403); }
function decisionProjection(value) { return { decision: value.decision, traceRef: value.traceRef, source: value.source, decisionKey: value.decisionKey ?? null, rulesetHash: value.rulesetHash ?? null }; }
function result(platform, collection, id, record, eventType, now) { return { state: { ...platform, [collection]: { ...platform[collection], [id]: record }, events: [...platform.events, { type: eventType, resourceId: id, recordHash: record.recordHash, at: now.toISOString() }] }, record }; }
function tenantRecord(record, tenantId, code) { if (!record || record.tenantId !== tenantId) fail(code, "A same-tenant record is required.", 404); return record; }
function required(value, keys) { for (const key of keys) if (value?.[key] === undefined || value?.[key] === null || value?.[key] === "") fail("ai_agent_field_required", `${key} is required.`); }
function independent(a, b, code) { if (a === b) fail(code, "Proposer and approver must be different principals."); }
function unique(values = []) { if (!Array.isArray(values)) fail("ai_agent_array_invalid", "Expected an array."); return [...new Set(values.map(String))]; }
function integerString(value, path) { const text = String(value); if (!/^\d+$/.test(text)) fail("ai_agent_pricing_value_invalid", `${path} must be a non-negative integer string.`); return BigInt(text).toString(); }
function iso(value) { const at = new Date(value); if (!Number.isFinite(at.getTime())) fail("ai_agent_date_invalid", "Date must be a valid ISO value."); return at.toISOString(); }
function perThousand(units, rate) { const count = BigInt(units); return ((count + 999n) / 1000n) * BigInt(rate); }
function priceUsage(metrics, pricing) { return (BigInt(pricing.per_execution_paise) * BigInt(metrics.executions)) + perThousand(metrics.inputTokens, pricing.per_1k_input_tokens_paise) + perThousand(metrics.outputTokens, pricing.per_1k_output_tokens_paise); }
function budgetLimits(limits) { return Object.fromEntries(["maxExecutions", "maxInputTokens", "maxOutputTokens", "maxChargePaise"].map((key) => [key, integerString(limits[key] ?? "0", `limits.${key}`)])); }
function activeBudget(platform, tenantId, contractId, now) { return Object.values(platform.usageBudgets).find((x) => x.tenantId === tenantId && x.contractId === contractId && x.status === "active" && Date.parse(x.effectiveFrom) <= now.getTime() && now.getTime() <= Date.parse(x.validUntil)); }
function budgetCommitted(platform, budgetId) { const blank = { executions: "0", inputTokens: "0", outputTokens: "0", chargePaise: "0" }; const used = Object.values(platform.usageLedger).filter((x) => x.budgetId === budgetId).reduce((total, x) => addMetrics(total, { ...x.metrics, chargePaise: x.chargePaise }), blank); return Object.values(platform.budgetReservations).filter((x) => x.budgetId === budgetId && x.status === "reserved").reduce((total, x) => addMetrics(total, { ...x.metrics, chargePaise: x.chargePaise }), used); }
function addMetrics(left, right) { return Object.fromEntries(["executions", "inputTokens", "outputTokens", "chargePaise"].map((key) => [key, (BigInt(left[key] ?? "0") + BigInt(right[key] ?? "0")).toString()])); }
function enforceBudget(budget, total) { const pairs = [["maxExecutions", "executions"], ["maxInputTokens", "inputTokens"], ["maxOutputTokens", "outputTokens"], ["maxChargePaise", "chargePaise"]]; for (const [limit, actual] of pairs) if (BigInt(total[actual]) > BigInt(budget.limits[limit])) fail("ai_agent_budget_exceeded", `Usage budget ${limit} would be exceeded.`, 403, { budgetId: budget.budgetId, limit, allowed: budget.limits[limit], requested: total[actual] }); }
function usageTotals(usage) { return usage.reduce((total, x) => addMetrics(total, { ...x.metrics, chargePaise: x.chargePaise }), { executions: "0", inputTokens: "0", outputTokens: "0", chargePaise: "0" }); }
function invoiceCharges(totals, pricing) { const overageExecutions = maxZero(totals.executions, pricing.included_executions); const overageInputTokens = maxZero(totals.inputTokens, pricing.included_input_tokens); const overageOutputTokens = maxZero(totals.outputTokens, pricing.included_output_tokens); const platformFeePaise = BigInt(pricing.monthly_platform_fee_paise); const executionPaise = BigInt(overageExecutions) * BigInt(pricing.per_execution_paise); const inputTokenPaise = perThousand(overageInputTokens, pricing.per_1k_input_tokens_paise); const outputTokenPaise = perThousand(overageOutputTokens, pricing.per_1k_output_tokens_paise); return { platformFeePaise: platformFeePaise.toString(), overageExecutions, overageInputTokens, overageOutputTokens, executionPaise: executionPaise.toString(), inputTokenPaise: inputTokenPaise.toString(), outputTokenPaise: outputTokenPaise.toString(), subtotalPaise: (platformFeePaise + executionPaise + inputTokenPaise + outputTokenPaise).toString() }; }
function maxZero(value, allowance) { const delta = BigInt(value) - BigInt(allowance); return (delta > 0n ? delta : 0n).toString(); }
function invoiceTax(value, subtotalPaise) { required(value, ["supplyType", "rateBasisPoints", "supplierGstinRef", "recipientGstinRef", "placeOfSupplyState"]); if (!["intra_state", "inter_state"].includes(value.supplyType)) fail("ai_agent_invoice_supply_type_invalid", "supplyType must be intra_state or inter_state."); const rateBasisPoints = integerString(value.rateBasisPoints, "tax.rateBasisPoints"); const totalTax = divideRoundHalfUp(BigInt(subtotalPaise) * BigInt(rateBasisPoints), 10_000n); const base = { supplyType: value.supplyType, rateBasisPoints, supplierGstinRef: value.supplierGstinRef, recipientGstinRef: value.recipientGstinRef, placeOfSupplyState: value.placeOfSupplyState, totalTaxPaise: totalTax.toString(), rounding: "half_up_to_paise", legalInvoiceStatus: "commercial_record_pending_tax_validation" }; return value.supplyType === "intra_state" ? { ...base, cgstPaise: (totalTax / 2n).toString(), sgstPaise: (totalTax - (totalTax / 2n)).toString(), igstPaise: "0" } : { ...base, cgstPaise: "0", sgstPaise: "0", igstPaise: totalTax.toString() }; }
function divideRoundHalfUp(numerator, denominator) { return (numerator + (denominator / 2n)) / denominator; }
function sum(records, key) { return records.reduce((n, x) => n + BigInt(x.metrics[key]), 0n).toString(); }
function seal(value) { const clean = JSON.parse(JSON.stringify(value)); delete clean.recordHash; return { ...clean, recordHash: hash(clean) }; }
function hash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`; return JSON.stringify(value); }
function fail(code, message, status = 422, details = undefined) { throw Object.assign(new Error(message), { code, status, details }); }
