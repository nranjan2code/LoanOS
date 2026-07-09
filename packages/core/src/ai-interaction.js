import { createFinding, summarizeFindings } from "./compliance-controls.js";
import { normalizeModelRegistryState } from "./model-governance.js";
import { createLoanId } from "./loan-policy.js";

// RBI's digital-lending and FREE-AI expectations require that a borrower
// interacting with an AI system is told so, and can always reach a human. This
// module produces the mandated customer disclosure for a customer-facing model
// and records human-handoff requests so no borrower is trapped with a bot.

const ACTIVE_STATUS = "active";

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

export function listHumanHandoffRequests(registry = {}, filters = {}) {
  return Object.values(registry).filter(
    (record) =>
      (!filters.status || record.status === filters.status) &&
      (!filters.borrowerId || record.borrowerId === filters.borrowerId)
  );
}
