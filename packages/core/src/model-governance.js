import { createFinding, summarizeFindings } from "./compliance-controls.js";

const ACTIVE_STATUSES = new Set(["active"]);
const DISABLED_STATUSES = new Set(["suspended", "deactivated", "retired"]);

export function createModelRegistryState() {
  return {
    globalKillSwitch: {
      active: false,
      reason: null,
      actor: null,
      activatedAt: null,
      clearedAt: null,
      clearanceApprovalRef: null
    },
    models: {},
    events: []
  };
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
  const event = {
    type: "model.kill_switch.triggered",
    scope,
    modelId: scope === "model" ? input.modelId : null,
    reason,
    actor,
    at
  };

  if (scope === "global") {
    return {
      registry: {
        ...registry,
        globalKillSwitch: {
          active: true,
          reason,
          actor,
          activatedAt: at,
          clearedAt: null,
          clearanceApprovalRef: null
        },
        events: [...registry.events, event]
      },
      findings,
      summary
    };
  }

  const model = registry.models[input.modelId];
  return {
    registry: {
      ...registry,
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
    findings,
    summary
  };
}

export function clearGlobalKillSwitch(state, input, now = new Date()) {
  const registry = normalizeModelRegistryState(state);
  const findings = [];

  if (!input?.actor) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Clear actor is required.", "actor"));
  }
  if (!input?.approvalRef) {
    findings.push(createFinding("error", "RBI-MRM-DRAFT-2026", "Clear approvalRef is required.", "approvalRef"));
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
  return {
    registry: {
      ...registry,
      globalKillSwitch: {
        ...registry.globalKillSwitch,
        active: false,
        clearedAt: at,
        clearanceApprovalRef: input.approvalRef
      },
      events: [
        ...registry.events,
        {
          type: "model.kill_switch.cleared",
          scope: "global",
          actor: input.actor,
          approvalRef: input.approvalRef,
          at
        }
      ]
    },
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

