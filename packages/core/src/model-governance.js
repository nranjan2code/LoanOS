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

export function validateAIEvidence(model, input, findings) {
  const fairnessAssessmentHash = input?.fairnessAssessmentHash ?? model?.fairnessAssessmentHash;
  const explainabilityHash = input?.explainabilityHash ?? model?.explainabilityHash;
  const fairnessReport = input?.fairnessReport ?? model?.fairnessReport;
  const explainabilityReport = input?.explainabilityReport ?? model?.explainabilityReport;
  const riskTier = input?.riskTier ?? model?.riskTier;

  if (riskTier === "high") {
    // 1. Verify Hashes
    if (!fairnessAssessmentHash) {
      findings.push(createFinding("error", "RBI-MRM-BIAS-2026", "High-risk model validation requires fairnessAssessmentHash.", "fairnessAssessmentHash"));
    } else if (typeof fairnessAssessmentHash !== "string" || !/^[a-fA-F0-9]{64}$/.test(fairnessAssessmentHash)) {
      findings.push(createFinding("error", "RBI-MRM-BIAS-2026", "fairnessAssessmentHash must be a valid 64-character SHA-256 hex string.", "fairnessAssessmentHash"));
    }

    if (!explainabilityHash) {
      findings.push(createFinding("error", "RBI-MRM-BIAS-2026", "High-risk model validation requires explainabilityHash.", "explainabilityHash"));
    } else if (typeof explainabilityHash !== "string" || !/^[a-fA-F0-9]{64}$/.test(explainabilityHash)) {
      findings.push(createFinding("error", "RBI-MRM-BIAS-2026", "explainabilityHash must be a valid 64-character SHA-256 hex string.", "explainabilityHash"));
    }

    // 2. Verify Fairness Report
    if (!fairnessReport) {
      findings.push(createFinding("error", "RBI-MRM-BIAS-2026", "High-risk model validation requires structured fairnessReport.", "fairnessReport"));
    } else if (typeof fairnessReport !== "object") {
      findings.push(createFinding("error", "RBI-MRM-BIAS-2026", "fairnessReport must be a structured object.", "fairnessReport"));
    } else {
      const { disparateImpactRatio, demographicParityDifference, protectedAttributes } = fairnessReport;
      if (!Number.isFinite(disparateImpactRatio)) {
        findings.push(createFinding("error", "RBI-MRM-BIAS-2026", "fairnessReport.disparateImpactRatio must be a number.", "fairnessReport.disparateImpactRatio"));
      } else if (disparateImpactRatio < 0.8 || disparateImpactRatio > 1.25) {
        findings.push(createFinding("error", "RBI-MRM-BIAS-2026", `Disparate impact ratio ${disparateImpactRatio} violates the acceptable compliance corridor (0.8 - 1.25).`, "fairnessReport.disparateImpactRatio"));
      }

      if (!Number.isFinite(demographicParityDifference) || demographicParityDifference < 0 || demographicParityDifference > 1) {
        findings.push(createFinding("error", "RBI-MRM-BIAS-2026", "fairnessReport.demographicParityDifference must be a number between 0 and 1.", "fairnessReport.demographicParityDifference"));
      }

      if (!Array.isArray(protectedAttributes) || protectedAttributes.length === 0 || !protectedAttributes.every(attr => typeof attr === "string")) {
        findings.push(createFinding("error", "RBI-MRM-BIAS-2026", "fairnessReport.protectedAttributes must be a non-empty array of strings.", "fairnessReport.protectedAttributes"));
      }
    }

    // 3. Verify Explainability Report
    if (!explainabilityReport) {
      findings.push(createFinding("error", "RBI-MRM-BIAS-2026", "High-risk model validation requires structured explainabilityReport.", "explainabilityReport"));
    } else if (typeof explainabilityReport !== "object") {
      findings.push(createFinding("error", "RBI-MRM-BIAS-2026", "explainabilityReport must be a structured object.", "explainabilityReport"));
    } else {
      const { explainabilityMethod, featureImportance } = explainabilityReport;
      const validMethods = ["shap", "lime", "integrated_gradients", "tree_interpreter"];
      if (typeof explainabilityMethod !== "string" || !validMethods.includes(explainabilityMethod.toLowerCase())) {
        findings.push(createFinding("error", "RBI-MRM-BIAS-2026", `explainabilityReport.explainabilityMethod must be one of: ${validMethods.join(", ")}.`, "explainabilityReport.explainabilityMethod"));
      }

      if (!featureImportance || typeof featureImportance !== "object" || Object.keys(featureImportance).length === 0 || !Object.values(featureImportance).every(val => Number.isFinite(val))) {
        findings.push(createFinding("error", "RBI-MRM-BIAS-2026", "explainabilityReport.featureImportance must be a non-empty object mapping features to importance weights.", "explainabilityReport.featureImportance"));
      }
    }
  }
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

  const derivedStatus = input?.status ?? (input?.validationStatus === "approved" ? "active" : "draft");
  if (input?.riskTier === "high" && (derivedStatus === "active" || input?.validationStatus === "approved")) {
    if (!input.independentValidationRef) {
      findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "High-risk model requires independentValidationRef.", "independentValidationRef"));
    }
    if (!input.fairnessAssessmentRef) {
      findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "High-risk model requires fairnessAssessmentRef.", "fairnessAssessmentRef"));
    }
    if (!input.explainabilityRef) {
      findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "High-risk model requires explainabilityRef.", "explainabilityRef"));
    }
    if (!input.monitoringPlanRef) {
      findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "High-risk model requires monitoringPlanRef.", "monitoringPlanRef"));
    }
    validateAIEvidence(null, input, findings);
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
    // A generative model carries extra adversarial-robustness duties.
    modelClass: input.modelClass ?? (input.generative ? "generative" : "traditional"),
    materialDecision: Boolean(input.materialDecision),
    customerFacing: Boolean(input.customerFacing),
    validationStatus: input.validationStatus,
    independentValidationRef: input.independentValidationRef ?? null,
    monitoringPlanRef: input.monitoringPlanRef ?? null,
    fairnessAssessmentRef: input.fairnessAssessmentRef ?? null,
    explainabilityRef: input.explainabilityRef ?? null,
    fairnessAssessmentHash: input.fairnessAssessmentHash ?? null,
    explainabilityHash: input.explainabilityHash ?? null,
    fairnessReport: input.fairnessReport ?? null,
    explainabilityReport: input.explainabilityReport ?? null,
    redTeamRef: input.redTeamRef ?? null,
    hallucinationTestRef: input.hallucinationTestRef ?? null,
    driftThreshold: Number.isFinite(input.driftThreshold) ? input.driftThreshold : null,
    driftObservations: [],
    status: derivedStatus,
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
    const redTeamRef = input.redTeamRef ?? model.redTeamRef;
    const hallucinationTestRef = input.hallucinationTestRef ?? model.hallucinationTestRef;

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
      validateAIEvidence(model, input, findings);
    }
    // A generative model must additionally evidence adversarial (red-team) and
    // hallucination testing before it can be validated for use.
    if (model.modelClass === "generative") {
      if (!redTeamRef) {
        findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Generative model validation requires redTeamRef (adversarial testing).", "redTeamRef"));
      }
      if (!hallucinationTestRef) {
        findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Generative model validation requires hallucinationTestRef.", "hallucinationTestRef"));
      }
    }

    validationEvidence = {
      independentValidationRef: independentValidationRef ?? null,
      fairnessAssessmentRef: fairnessAssessmentRef ?? null,
      explainabilityRef: explainabilityRef ?? null,
      monitoringPlanRef: monitoringPlanRef ?? null,
      fairnessAssessmentHash: input.fairnessAssessmentHash ?? model.fairnessAssessmentHash ?? null,
      explainabilityHash: input.explainabilityHash ?? model.explainabilityHash ?? null,
      fairnessReport: input.fairnessReport ?? model.fairnessReport ?? null,
      explainabilityReport: input.explainabilityReport ?? model.explainabilityReport ?? null,
      redTeamRef: redTeamRef ?? null,
      hallucinationTestRef: hallucinationTestRef ?? null,
      validatedBy: input.actor,
      validatedAt: now.toISOString()
    };
  }

  if (input?.action === "activate" && model && model.riskTier === "high") {
    validateAIEvidence(model, {}, findings);
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

// Drift monitoring: record a metric reading (e.g. PSI, population stability, or
// a performance measure) against an active model. A reading that breaches the
// model's drift threshold is a monitoring failure, so it auto-trips a
// model-scoped kill switch — suspending the model and opening an incident that
// must be reviewed before the model can run again.
export function recordDriftObservation(state, input, now = new Date()) {
  const registry = normalizeModelRegistryState(state);
  const model = registry.models[input?.modelId] ?? null;
  const findings = [];

  if (!model) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Drift observation requires an existing modelId.", "modelId"));
  }
  if (!input?.metric) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Drift observation requires a metric.", "metric"));
  }
  if (!Number.isFinite(input?.value)) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Drift observation value must be a number.", "value"));
  }
  if (!input?.actor) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Drift observation requires an actor.", "actor"));
  }
  const threshold = Number.isFinite(input?.threshold) ? input.threshold : model?.driftThreshold;
  if (model && !Number.isFinite(threshold)) {
    findings.push(
      createFinding("error", "RBI-MRM-DRAFT-2026", "A drift threshold is required (on the observation or the model).", "threshold")
    );
  }
  if (model && ![MODEL_STATUSES.ACTIVE].includes(model.status)) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Drift monitoring applies only to active models.", "status"));
  }

  const summary = summarizeFindings(findings);
  if (summary.status === "blocked") {
    return { registry, model, observation: null, breached: false, incident: null, findings, summary };
  }

  const at = now.toISOString();
  const breached = input.value > threshold;
  const observation = {
    observationId: createGovernanceId("drift"),
    metric: input.metric,
    value: input.value,
    threshold,
    breached,
    observedAt: input.observedAt ?? at,
    actor: input.actor
  };
  const withObservation = {
    ...registry,
    models: {
      ...registry.models,
      [model.modelId]: {
        ...model,
        driftObservations: [...(model.driftObservations ?? []), observation],
        updatedAt: at
      }
    },
    events: [
      ...registry.events,
      { type: "model.drift.observed", modelId: model.modelId, metric: observation.metric, value: observation.value, breached, actor: input.actor, at }
    ]
  };

  if (!breached) {
    return { registry: withObservation, model: withObservation.models[model.modelId], observation, breached: false, incident: null, findings, summary };
  }

  // A breach trips the model kill switch, reusing the governed suspension path.
  const killed = triggerKillSwitch(
    withObservation,
    {
      scope: "model",
      modelId: model.modelId,
      reason: `Drift breach on ${observation.metric}: ${observation.value} > ${threshold}`,
      actor: input.actor
    },
    now
  );
  return {
    registry: killed.registry,
    model: killed.registry.models[model.modelId],
    observation,
    breached: true,
    incident: killed.incident,
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

