import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { normalizeModelRegistryState } from "./model-governance.js";
import { createLoanId } from "./loan-policy.js";

// RBI's digital-lending and FREE-AI expectations require that a borrower
// interacting with an AI system is told so, and can always reach a human. This
// module produces the mandated customer disclosure for a customer-facing model
// and records human-handoff requests so no borrower is trapped with a bot.

const ACTIVE_STATUS = "active";

/**
 * Generate the mandated AI-interaction disclosure for a customer-facing
 * model. Fails closed unless the model exists, is customer-facing, is
 * `"active"`, and the global AI kill switch is not tripped — a killed
 * model must route customers to a human, not receive a disclosure implying
 * it's still operating.
 * @param {object} modelRegistryState - model governance registry (see `model-governance.js`).
 * @param {object} input - modelId, disclosureId, grievanceChannel.
 * @param {Date} [now]
 * @returns {{disclosure: object|null, findings: Array<object>, summary: object}}
 */
export function buildAiDisclosure(modelRegistryState, input = {}, now = new Date()) {
  const registry = normalizeModelRegistryState(modelRegistryState);
  const findings = [];
  const model = registry.models[input?.modelId] ?? null;

  if (!model) {
    findings.push(createFinding("error", "FREE-AI-2025", "Disclosure requires a model in inventory.", "modelId"));
  } else {
    if (!model.customerFacing) {
      findings.push(createFinding("error", "FREE-AI-2025", "Disclosure applies only to customer-facing models.", "customerFacing"));
    }
    if (model.status !== ACTIVE_STATUS) {
      findings.push(createFinding("error", "FREE-AI-2025", `Model ${model.modelId} is ${model.status}, not active.`, "status"));
    }
  }
  if (registry.globalKillSwitch.active) {
    findings.push(
      createFinding("error", "FREE-AI-2025", "Global AI kill switch is active; route the customer to a human.", "ai.globalKillSwitch")
    );
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { disclosure: null, findings, summary };
  }

  const disclosure = {
    disclosureId: input.disclosureId ?? createLoanId("aidisc"),
    modelId: model.modelId,
    modelName: model.name,
    purpose: model.purpose,
    aiAssisted: true,
    statement: `You are interacting with an automated system (${model.name}) that assists with ${model.purpose}. You can ask to speak with a human representative at any time.`,
    humanHandoffAvailable: true,
    grievanceChannel: input.grievanceChannel ?? null,
    generatedAt: now.toISOString()
  };
  return { disclosure, findings: [], summary: summarizeFindings([]) };
}

export const HANDOFF_STATUSES = { PENDING: "pending", HANDLED: "handled" };

/**
 * Record a borrower's request to escalate from an AI interaction to a
 * human. Fails closed unless a borrower or session reference and a reason
 * are given, and — if a model is named — that model exists and is
 * customer-facing. Always lands in the `"customer_support"` queue.
 * @param {Record<string, object>} registry - handoffId -> request record.
 * @param {object} input - handoffId, borrowerId, sessionRef, modelId, reason, requestedAt.
 * @param {{modelRegistry?: object}} [context] - for the model existence/customer-facing check.
 * @param {Date} [now]
 * @returns {{registry: object, request: object|null, event: object|null, findings: Array<object>, summary: object}}
 */
export function requestHumanHandoff(registry = {}, input = {}, context = {}, now = new Date()) {
  const findings = [];
  if (!input.borrowerId && !input.sessionRef) {
    findings.push(createFinding("error", "FREE-AI-2025", "Handoff requires a borrowerId or sessionRef.", "borrowerId"));
  }
  if (!input.reason) {
    findings.push(createFinding("error", "FREE-AI-2025", "Handoff requires a reason.", "reason"));
  }
  if (input.modelId && context.modelRegistry) {
    const model = normalizeModelRegistryState(context.modelRegistry).models[input.modelId] ?? null;
    if (!model) {
      findings.push(createFinding("error", "FREE-AI-2025", "Handoff modelId is not in inventory.", "modelId"));
    } else if (!model.customerFacing) {
      findings.push(createFinding("error", "FREE-AI-2025", "Handoff modelId is not a customer-facing model.", "modelId"));
    }
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { registry, request: null, findings, summary };
  }

  const request = {
    handoffId: input.handoffId ?? createLoanId("handoff"),
    borrowerId: input.borrowerId ?? null,
    sessionRef: input.sessionRef ?? null,
    modelId: input.modelId ?? null,
    reason: input.reason,
    status: HANDOFF_STATUSES.PENDING,
    queue: "customer_support",
    requestedAt: input.requestedAt ?? now.toISOString(),
    handledBy: null,
    handledAt: null,
    resolutionNotes: null
  };
  const event = {
    eventId: createLoanId("handoffevt"),
    type: "ai.human_handoff.requested",
    at: now.toISOString(),
    handoffId: request.handoffId,
    borrowerId: request.borrowerId,
    modelId: request.modelId
  };
  return {
    registry: { ...registry, [request.handoffId]: request },
    request,
    event,
    findings: [],
    summary: summarizeFindings([])
  };
}

/**
 * Mark a pending handoff request as handled by a human agent. Fails closed
 * if the request doesn't exist, is already handled, or no `handledBy`
 * agent is given.
 * @param {object} request - existing `"pending"` handoff request.
 * @param {object} input - handledBy, resolutionNotes.
 * @param {Date} [now]
 * @returns {{request: object, event: object|null, findings: Array<object>, summary: object}}
 */
export function resolveHumanHandoff(request, input = {}, now = new Date()) {
  const findings = [];
  if (!request) {
    findings.push(createFinding("error", "FREE-AI-2025", "Handoff request is required.", "handoffId"));
  }
  if (request && request.status !== HANDOFF_STATUSES.PENDING) {
    findings.push(createFinding("error", "FREE-AI-2025", "Handoff request is already handled.", "status"));
  }
  if (!input.handledBy) {
    findings.push(createFinding("error", "FREE-AI-2025", "Handoff resolution requires a human agent (handledBy).", "handledBy"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { request, event: null, findings, summary };
  }

  const updated = {
    ...request,
    status: HANDOFF_STATUSES.HANDLED,
    handledBy: input.handledBy,
    handledAt: now.toISOString(),
    resolutionNotes: input.resolutionNotes ?? null
  };
  const event = {
    eventId: createLoanId("handoffevt"),
    type: "ai.human_handoff.handled",
    at: now.toISOString(),
    handoffId: updated.handoffId,
    handledBy: updated.handledBy
  };
  return { request: updated, event, findings: [], summary: summarizeFindings([]) };
}

/**
 * List handoff requests, optionally filtered by status and/or borrower.
 * @param {Record<string, object>} registry - handoffId -> request record.
 * @param {{status?: string, borrowerId?: string}} [filters]
 * @returns {Array<object>}
 */
export function listHumanHandoffRequests(registry = {}, filters = {}) {
  return Object.values(registry).filter(
    (record) =>
      (!filters.status || record.status === filters.status) &&
      (!filters.borrowerId || record.borrowerId === filters.borrowerId)
  );
}
