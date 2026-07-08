import { createFinding, summarizeFindings } from "./compliance-controls.js";

const ACTIVE_STATUSES = new Set(["active"]);
const DISABLED_STATUSES = new Set(["suspended", "deactivated", "retired"]);

export const MODEL_STATUSES = {
  DRAFT: "draft",
  VALIDATION_PENDING: "validation_pending",
  APPROVED: "approved",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  RETIRED: "retired"
};

// Governed lifecycle for a model: which statuses each action may move from, and
// the status it moves to. A model reaches `active` only through an approved
// independent validation, keeping the runtime use gate honest.
const MODEL_TRANSITIONS = {
  submit_for_validation: { from: ["draft"], to: MODEL_STATUSES.VALIDATION_PENDING },
  approve_validation: { from: ["validation_pending"], to: MODEL_STATUSES.APPROVED },
  return_for_rework: { from: ["validation_pending"], to: MODEL_STATUSES.DRAFT },
  activate: { from: ["approved"], to: MODEL_STATUSES.ACTIVE },
  suspend: { from: ["active"], to: MODEL_STATUSES.SUSPENDED },
  reinstate: { from: ["suspended"], to: MODEL_STATUSES.ACTIVE },
  retire: { from: ["draft", "validation_pending", "approved", "active", "suspended"], to: MODEL_STATUSES.RETIRED }
};

const REASON_REQUIRED_ACTIONS = new Set(["suspend", "retire", "return_for_rework"]);

export function createModelRegistryState() {
  return {
    globalKillSwitch: {
      active: false,
      reason: null,
      actor: null,
      activatedAt: null,
      clearedAt: null,
      clearanceApprovalRef: null,
      incidentId: null
    },
    models: {},
    incidents: {},
    events: []
  };
}

// Local id helper. model-governance is imported by loan-policy, so importing
// createLoanId from there would create a cycle; this mirrors its format.
function createGovernanceId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeModelRegistryState(state) {
  if (!state || typeof state !== "object") {
    return createModelRegistryState();
  }

  return {
    globalKillSwitch: {
      ...createModelRegistryState().globalKillSwitch,
      ...(state.globalKillSwitch ?? {})
    },
    models: state.models ?? {},
    incidents: state.incidents ?? {},
    events: Array.isArray(state.events) ? state.events : []
  };
}

export function registerModel(state, input, now = new Date()) {
  const registry = normalizeModelRegistryState(state);
  const findings = [];

  if (!input?.modelId) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "modelId is required.", "modelId"));
  }
  if (!input?.name) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Model name is required.", "name"));
  }
  if (!input?.owner) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Model owner is required.", "owner"));
  }
  if (!input?.purpose) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Model purpose is required.", "purpose"));
  }
  if (!input?.riskTier) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Model riskTier is required.", "riskTier"));
  }
  if (!input?.validationStatus) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Model validationStatus is required.", "validationStatus"));
  }
  if (input?.status && DISABLED_STATUSES.has(input.status) && !input.statusReason) {
    findings.push(createFinding("warning", "RBI-MRM-DRAFT-2026", "Disabled models should include statusReason.", "statusReason"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      registry,
      findings,
      summary
    };
  }

  const model = {
    modelId: input.modelId,
    name: input.name,
    version: input.version ?? "1.0.0",
    owner: input.owner,
    vendor: input.vendor ?? null,
    purpose: input.purpose,
    borrowerImpact: input.borrowerImpact ?? "unknown",
    riskTier: input.riskTier,
    materialDecision: Boolean(input.materialDecision),
    customerFacing: Boolean(input.customerFacing),
    validationStatus: input.validationStatus,
    independentValidationRef: input.independentValidationRef ?? null,
    monitoringPlanRef: input.monitoringPlanRef ?? null,
    fairnessAssessmentRef: input.fairnessAssessmentRef ?? null,
    explainabilityRef: input.explainabilityRef ?? null,
    redTeamRef: input.redTeamRef ?? null,
    status: input.status ?? (input.validationStatus === "approved" ? "active" : "draft"),
    statusReason: input.statusReason ?? null,
    createdAt: registry.models[input.modelId]?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };

  const next = {
    ...registry,
    models: {
      ...registry.models,
      [model.modelId]: model
    },
    events: [
      ...registry.events,
      {
        type: "model.registered",
        modelId: model.modelId,
        actor: input.actor ?? "system",
        at: now.toISOString()
      }
    ]
  };

  return {
    registry: next,
    model,
    findings,
    summary
  };
}

export function transitionModel(state, input, now = new Date()) {
  const registry = normalizeModelRegistryState(state);
  const findings = [];
  const model = registry.models[input?.modelId] ?? null;
  const transition = MODEL_TRANSITIONS[input?.action];

  if (!input?.modelId || !model) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Model transition requires an existing modelId.", "modelId"));
  }
  if (!input?.actor) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Model transition requires actor.", "actor"));
  }
  if (!transition) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Model transition action is not recognized.", "action"));
  } else if (model && !transition.from.includes(model.status)) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", `Model in status ${model.status} cannot ${input.action}.`, "status"));
  }
  if (REASON_REQUIRED_ACTIONS.has(input?.action) && !input?.reason) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", `Action ${input.action} requires a reason.`, "reason"));
  }

  // Validation gate: approving validation requires independent evidence, an
  // approver independent of the owner, and — for high-risk models — fairness,
  // explainability, and monitoring evidence.
  let validationEvidence = null;
  if (input?.action === "approve_validation" && model) {
    const independentValidationRef = input.independentValidationRef ?? model.independentValidationRef;
    const fairnessAssessmentRef = input.fairnessAssessmentRef ?? model.fairnessAssessmentRef;
    const explainabilityRef = input.explainabilityRef ?? model.explainabilityRef;
    const monitoringPlanRef = input.monitoringPlanRef ?? model.monitoringPlanRef;

    if (!independentValidationRef) {
      findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Validation approval requires independentValidationRef.", "independentValidationRef"));
    }
    if (input.actor && model.owner && input.actor === model.owner) {
      findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Validation approver must be independent of the model owner.", "actor"));
    }
    if (model.riskTier === "high") {
      if (!fairnessAssessmentRef) {
        findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "High-risk validation requires fairnessAssessmentRef.", "fairnessAssessmentRef"));
      }
      if (!explainabilityRef) {
        findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "High-risk validation requires explainabilityRef.", "explainabilityRef"));
      }
      if (!monitoringPlanRef) {
        findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "High-risk validation requires monitoringPlanRef.", "monitoringPlanRef"));
      }
    }

    validationEvidence = {
      independentValidationRef: independentValidationRef ?? null,
      fairnessAssessmentRef: fairnessAssessmentRef ?? null,
      explainabilityRef: explainabilityRef ?? null,
      monitoringPlanRef: monitoringPlanRef ?? null,
      validatedBy: input.actor,
      validatedAt: now.toISOString()
    };
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { registry, model, findings, summary };
  }

  const at = now.toISOString();
  const updatedModel = {
    ...model,
    ...(validationEvidence ?? {}),
    status: transition.to,
    validationStatus:
      input.action === "approve_validation"
        ? "approved"
        : input.action === "return_for_rework"
          ? "rework_required"
          : model.validationStatus,
    statusReason: REASON_REQUIRED_ACTIONS.has(input.action) ? input.reason : model.statusReason,
    updatedAt: at
  };

  return {
    registry: {
      ...registry,
      models: {
        ...registry.models,
        [model.modelId]: updatedModel
      },
      events: [
        ...registry.events,
        {
          type: "model.transitioned",
          modelId: model.modelId,
          action: input.action,
          fromStatus: model.status,
          toStatus: transition.to,
          actor: input.actor,
          reason: input.reason ?? null,
          at
        }
      ]
    },
    model: updatedModel,
    findings: [],
    summary
  };
}

export function triggerKillSwitch(state, input, now = new Date()) {
  const registry = normalizeModelRegistryState(state);
  const scope = input?.scope ?? "global";
  const reason = input?.reason ?? null;
  const actor = input?.actor ?? null;
  const findings = [];

  if (!reason) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Kill-switch reason is required.", "reason"));
  }
  if (!actor) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Kill-switch actor is required.", "actor"));
  }
  if (!["global", "model"].includes(scope)) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Kill-switch scope must be global or model.", "scope"));
  }
  if (scope === "model" && !registry.models[input?.modelId]) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Model kill switch requires an existing modelId.", "modelId"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      registry,
      findings,
      summary
    };
  }

  const at = now.toISOString();
  const incidentId = createGovernanceId("aiincident");
  const incident = {
    incidentId,
    scope,
    modelId: scope === "model" ? input.modelId : null,
    reason,
    triggeredBy: actor,
    openedAt: at,
    status: "open",
    postIncidentReview: null,
    closedAt: null,
    clearanceApprovalRef: null,
    clearedBy: null
  };
  const event = {
    type: "model.kill_switch.triggered",
    scope,
    modelId: scope === "model" ? input.modelId : null,
    incidentId,
    reason,
    actor,
    at
  };
  const withIncident = {
    ...registry,
    incidents: {
      ...registry.incidents,
      [incidentId]: incident
    }
  };

  if (scope === "global") {
    return {
      registry: {
        ...withIncident,
        globalKillSwitch: {
          active: true,
          reason,
          actor,
          activatedAt: at,
          clearedAt: null,
          clearanceApprovalRef: null,
          incidentId
        },
        events: [...registry.events, event]
      },
      incident,
      findings,
      summary
    };
  }

  const model = registry.models[input.modelId];
  return {
    registry: {
      ...withIncident,
      models: {
        ...registry.models,
        [input.modelId]: {
          ...model,
          status: "suspended",
          statusReason: reason,
          updatedAt: at
        }
      },
      events: [...registry.events, event]
    },
    incident,
    findings,
    summary
  };
}

// A kill-switch incident must be reviewed before the switch can be cleared: the
// review captures root cause and remediation and is retained as evidence.
export function recordPostIncidentReview(state, input, now = new Date()) {
  const registry = normalizeModelRegistryState(state);
  const findings = [];
  const incident = registry.incidents[input?.incidentId] ?? null;

  if (!input?.incidentId || !incident) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Post-incident review requires an existing incidentId.", "incidentId"));
  }
  if (incident && incident.status === "closed") {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Cannot review a closed incident.", "incidentId"));
  }
  if (!input?.reviewedBy) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Post-incident review requires reviewedBy.", "reviewedBy"));
  }
  if (!input?.reviewRef) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Post-incident review requires reviewRef.", "reviewRef"));
  }
  if (!input?.rootCause) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Post-incident review requires rootCause.", "rootCause"));
  }
  if (!input?.remediation) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Post-incident review requires remediation.", "remediation"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { registry, incident, findings, summary };
  }

  const at = now.toISOString();
  const review = {
    reviewRef: input.reviewRef,
    reviewedBy: input.reviewedBy,
    rootCause: input.rootCause,
    remediation: input.remediation,
    recordedAt: at
  };
  const updatedIncident = {
    ...incident,
    status: "reviewed",
    postIncidentReview: review
  };

  return {
    registry: {
      ...registry,
      incidents: {
        ...registry.incidents,
        [incident.incidentId]: updatedIncident
      },
      events: [
        ...registry.events,
        {
          type: "model.incident.reviewed",
          incidentId: incident.incidentId,
          actor: input.reviewedBy,
          reviewRef: input.reviewRef,
          at
        }
      ]
    },
    incident: updatedIncident,
    findings,
    summary
  };
}

export function clearGlobalKillSwitch(state, input, now = new Date()) {
  const registry = normalizeModelRegistryState(state);
  const findings = [];

  const incidentId = registry.globalKillSwitch.incidentId;
  const incident = incidentId ? registry.incidents[incidentId] ?? null : null;

  if (!input?.actor) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Clear actor is required.", "actor"));
  }
  if (!input?.approvalRef) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Clear approvalRef is required.", "approvalRef"));
  }
  if (!registry.globalKillSwitch.active) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Global kill switch is not active.", "globalKillSwitch"));
  } else if (!incident || !incident.postIncidentReview) {
    findings.push(
      createFinding("error", "RBI-MRM-DRAFT-2026", "Global kill switch cannot be cleared before a post-incident review is recorded.", "incidentId")
    );
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return {
      registry,
      incident,
      findings,
      summary
    };
  }

  const at = now.toISOString();
  const closedIncident = {
    ...incident,
    status: "closed",
    closedAt: at,
    clearanceApprovalRef: input.approvalRef,
    clearedBy: input.actor
  };
  return {
    registry: {
      ...registry,
      globalKillSwitch: {
        ...registry.globalKillSwitch,
        active: false,
        clearedAt: at,
        clearanceApprovalRef: input.approvalRef
      },
      incidents: {
        ...registry.incidents,
        [closedIncident.incidentId]: closedIncident
      },
      events: [
        ...registry.events,
        {
          type: "model.kill_switch.cleared",
          scope: "global",
          actor: input.actor,
          approvalRef: input.approvalRef,
          incidentId: closedIncident.incidentId,
          at
        }
      ]
    },
    incident: closedIncident,
    findings,
    summary
  };
}

export function evaluateModelUse(state, input) {
  const registry = normalizeModelRegistryState(state);
  const findings = [];
  const modelId = input?.modelId;

  if (!modelId) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Model use requires modelId.", "aiDecision.modelId"));
    return {
      allowed: false,
      model: null,
      findings,
      summary: summarizeFindings(findings)
    };
  }

  if (registry.globalKillSwitch.active) {
    findings.push(
      createFinding(
        "error",
        "RBI-MRM-DRAFT-2026",
        `Global AI/model kill switch is active: ${registry.globalKillSwitch.reason ?? "no reason recorded"}.`,
        "ai.globalKillSwitch"
      )
    );
  }

  const model = registry.models[modelId] ?? null;
  if (!model) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", `Model ${modelId} is not in inventory.`, "aiDecision.modelId"));
  } else {
    if (!ACTIVE_STATUSES.has(model.status)) {
      findings.push(
        createFinding("error", "RBI-MRM-DRAFT-2026", `Model ${modelId} is ${model.status}, not active.`, "aiDecision.modelId")
      );
    }
    if (model.validationStatus !== "approved") {
      findings.push(
        createFinding("error", "RBI-MRM-DRAFT-2026", `Model ${modelId} does not have approved validation.`, "aiDecision.modelId")
      );
    }
    if (model.riskTier === "high" && !model.independentValidationRef) {
      findings.push(
        createFinding("error", "RBI-MRM-DRAFT-2026", `High-risk model ${modelId} requires independentValidationRef.`, "aiDecision.modelId")
      );
    }
    if (model.materialDecision && !input?.humanReviewRef) {
      findings.push(
        createFinding(
          "warning",
          "FREE-AI-2025",
          `Material decision model ${modelId} should include humanReviewRef before final sanction.`,
          "aiDecision.humanReviewRef"
        )
      );
    }
    if (model.customerFacing && !input?.customerDisclosureRef) {
      findings.push(
        createFinding(
          "warning",
          "FREE-AI-2025",
          `Customer-facing AI model ${modelId} should include customerDisclosureRef.`,
          "aiDecision.customerDisclosureRef"
        )
      );
    }
  }

  const summary = summarizeFindings(findings);
  return {
    allowed: summary.status !== "blocked",
    model,
    findings,
    summary
  };
}

