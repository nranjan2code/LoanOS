import { createHash } from "node:crypto";

// ADR 0010: this catalogue is the only bridge from a model worker to a LoanOS
// capability. It contains authority metadata only; executable ports are always
// injected by the owning application/runtime.
export const DIGITAL_WORKER_TOOL_CATALOGUE = Object.freeze({
  version: "1",
  tools: Object.freeze({
    "knowledge.retrieve": tool("knowledge.retrieve", "read", "guardrail.data_access", true, dataAccessFacts),
    "communication.dispatch": tool("communication.dispatch", "write", "guardrail.outbound_communication", false, outboundFacts),
    "underwriting.propose": tool("underwriting.propose", "proposal", "guardrail.underwriting_influence", true, underwritingFacts),
    "case.change.propose": tool("case.change.propose", "proposal", "guardrail.case_mutation", true, caseMutationFacts)
  })
});

export function projectDigitalWorkerToolCatalogue(catalogue = DIGITAL_WORKER_TOOL_CATALOGUE) {
  return {
    version: catalogue.version,
    tools: Object.values(catalogue.tools).map(({ facts: _facts, ...item }) => structuredClone(item))
  };
}

export async function executeGovernedDigitalWorkerTool(input = {}) {
  const catalogue = input.catalogue ?? DIGITAL_WORKER_TOOL_CATALOGUE;
  const definition = catalogue.tools?.[input.toolId];
  if (!definition) fail("digital_worker_tool_unregistered", "The requested worker tool is not registered.", 403);
  if (!input.installation || input.installation.tenantId !== input.tenantId || input.request?.resourceTenantId && input.request.resourceTenantId !== input.tenantId) {
    fail("digital_worker_tool_tenant_mismatch", "Worker tool execution must remain inside the installation tenant.", 403);
  }
  if (input.installation.status !== "active") fail("digital_worker_tool_installation_inactive", "An active worker installation is required.", 403);
  if (!input.installation.approvedToolIds?.includes(definition.toolId)) fail("digital_worker_tool_not_approved", "The tool is outside the installation's approved authority.", 403);
  if (typeof input.decide !== "function") fail("digital_worker_tool_decision_unavailable", "The specialized decision port is unavailable.", 503);

  const request = structuredClone(input.request ?? {});
  const facts = definition.facts({ tenantId: input.tenantId, installation: input.installation, request });
  const decision = await input.decide({ tenantId: input.tenantId, requestId: request.requestId, decisionKey: definition.guardrailDecisionKey, facts });
  validateDecision(decision, definition.guardrailDecisionKey);
  if (decision.decision !== "allow") fail("digital_worker_tool_denied", `Specialized policy returned ${decision.decision}; the worker tool was not executed.`, 403, { decision });
  if (!definition.directWorkerAllowed) fail("digital_worker_tool_human_domain_required", "This effect must be performed by an authenticated human through the owning domain API.", 403);
  if (typeof input.port !== "function") fail("digital_worker_tool_port_unavailable", "The owning tool port is unavailable.", 503);

  const result = await input.port({ tool: project(definition), request, tenantId: input.tenantId, installation: structuredClone(input.installation), decision: structuredClone(decision) });
  if (result?.accepted !== true || !result.evidenceRef) fail("digital_worker_tool_result_unverified", "The tool port did not return accepted evidence.", 502);
  return Object.freeze({
    status: "completed",
    tenantId: input.tenantId,
    installationId: input.installation.installationId,
    toolId: definition.toolId,
    catalogueVersion: catalogue.version,
    guardrailDecisionKey: definition.guardrailDecisionKey,
    guardrailTraceRef: decision.traceRef,
    guardrailRulesetHash: decision.rulesetHash,
    requestChecksumSha256: hash(request),
    evidenceRef: result.evidenceRef,
    result: structuredClone(result.result ?? null)
  });
}

function tool(toolId, effect, guardrailDecisionKey, directWorkerAllowed, facts) {
  return Object.freeze({ toolId, effect, guardrailDecisionKey, directWorkerAllowed, proposalOnly: effect !== "write", facts });
}

function dataAccessFacts({ tenantId, installation, request }) {
  return { request: {
    tenant_match: installation.tenantId === tenantId && (request.resourceTenantId ?? tenantId) === tenantId,
    purpose_approved: Boolean(request.purpose) && request.purposeApproved !== false,
    consent_required: request.consentRequired === true,
    consent_present: request.consentRequired !== true || request.consentPresent === true,
    minimum_fields_only: request.minimumFieldsOnly === true,
    sensitive_data: request.sensitiveData === true,
    human_approval_recorded: request.humanApprovalRecorded === true
  } };
}

function outboundFacts({ tenantId, installation, request }) {
  return { communication: {
    tenant_match: installation.tenantId === tenantId && (request.resourceTenantId ?? tenantId) === tenantId,
    channel_approved: request.channelApproved === true,
    recipient_consent_present: request.recipientConsentPresent === true,
    ai_disclosure_present: request.aiDisclosurePresent === true,
    proposal_only: request.proposalOnly === true,
    human_approval_recorded: request.humanApprovalRecorded === true
  } };
}

function underwritingFacts({ tenantId, installation, request }) {
  return { assessment: {
    tenant_match: installation.tenantId === tenantId && (request.resourceTenantId ?? tenantId) === tenantId,
    installation_approved: installation.status === "active",
    proposal_only: request.proposalOnly !== false,
    attempts_decision_authority: request.attemptsDecisionAuthority === true,
    influences_eligibility: request.influencesEligibility === true,
    human_reviewer_recorded: request.humanReviewerRecorded === true
  } };
}

function caseMutationFacts({ tenantId, installation, request }) {
  return { mutation: {
    tenant_match: installation.tenantId === tenantId && (request.resourceTenantId ?? tenantId) === tenantId,
    case_in_scope: request.caseInScope === true,
    workflow_action_approved: request.workflowActionApproved === true,
    proposal_only: request.proposalOnly !== false,
    direct_write_attempt: request.directWriteAttempt === true,
    human_approval_recorded: request.humanApprovalRecorded === true
  } };
}

function validateDecision(decision, decisionKey) {
  if (!decision || !["allow", "deny", "require_human"].includes(decision.decision) || decision.decisionKey !== decisionKey || decision.source !== "isolated_business_engine" || !decision.traceRef || !/^[a-f0-9]{64}$/i.test(decision.rulesetHash ?? "")) {
    fail("digital_worker_tool_decision_invalid", "The specialized decision is missing, malformed, stale or from an untrusted authority.", 403);
  }
}

function project({ facts: _facts, ...definition }) { return structuredClone(definition); }
function hash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function canonical(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; }
function fail(code, message, status = 422, details) { throw Object.assign(new Error(message), { code, status, details }); }
