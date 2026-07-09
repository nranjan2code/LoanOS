import { createFinding, summarizeFindings } from "./compliance-controls.js";

const ACTIVE_STATUS = "active";
const ALLOWED_STATUSES = new Set(["active", "suspended", "terminated"]);

// RBI's recovery-agent guidelines (Fair Practices Code + outsourcing directions)
// require an RE to empanel recovery agents only after due diligence (including
// verification of antecedents), agent training/certification, a signed code of
// conduct, and to issue each agent an authorization letter and identity card
// they must carry when contacting a borrower.
export function validateRecoveryAgent(agent, regulatedEntities = {}) {
  const findings = [];
  const status = agent?.status ?? ACTIVE_STATUS;
  const entity = agent?.regulatedEntityId ? regulatedEntities[agent.regulatedEntityId] : null;

  if (!agent?.recoveryAgentId) {
    findings.push(createFinding("error", "RBI-DL-2025", "recoveryAgentId is required.", "recoveryAgentId"));
  }
  if (!agent?.regulatedEntityId) {
    findings.push(createFinding("error", "RBI-DL-2025", "regulatedEntityId is required for recovery-agent empanelment.", "regulatedEntityId"));
  } else if (!entity) {
    findings.push(createFinding("error", "RBI-DL-2025", "Recovery agent must reference an existing regulated entity.", "regulatedEntityId"));
  } else if (entity.status !== ACTIVE_STATUS) {
    findings.push(createFinding("error", "RBI-DL-2025", "Recovery agent regulated entity must be active.", "regulatedEntityId"));
  }
  if (!agent?.name) {
    findings.push(createFinding("error", "RBI-DL-2025", "Recovery agent name is required.", "name"));
  }
  if ((agent?.country ?? "IN") !== "IN") {
    findings.push(createFinding("error", "RBI-DL-2025", "Recovery agent country must be IN.", "country"));
  }
  if (!ALLOWED_STATUSES.has(status)) {
    findings.push(createFinding("error", "RBI-DL-2025", "Recovery agent status is invalid.", "status"));
  }

  if (status === ACTIVE_STATUS) {
    if (!agent?.dueDiligence?.policeVerificationRef) {
      findings.push(
        createFinding("error", "RBI-DL-2025", "Active recovery agent requires a police/antecedent verification reference.", "dueDiligence.policeVerificationRef")
      );
    }
    if (!agent?.dueDiligence?.verifiedAt) {
      findings.push(createFinding("error", "RBI-DL-2025", "Active recovery agent requires a due-diligence verification timestamp.", "dueDiligence.verifiedAt"));
    }
    if (!agent?.training?.certificationRef) {
      findings.push(createFinding("error", "RBI-DL-2025", "Active recovery agent requires a training certification reference.", "training.certificationRef"));
    }
    if (!agent?.training?.certifiedAt) {
      findings.push(createFinding("error", "RBI-DL-2025", "Active recovery agent requires a training certification timestamp.", "training.certifiedAt"));
    }
    if (!agent?.codeOfConduct?.acknowledgmentRef) {
      findings.push(createFinding("error", "RBI-DL-2025", "Active recovery agent requires a signed code-of-conduct reference.", "codeOfConduct.acknowledgmentRef"));
    }
    if (!agent?.codeOfConduct?.acknowledgedAt) {
      findings.push(createFinding("error", "RBI-DL-2025", "Active recovery agent requires a code-of-conduct acknowledgment timestamp.", "codeOfConduct.acknowledgedAt"));
    }
    if (!agent?.authorization?.letterRef) {
      findings.push(createFinding("error", "RBI-DL-2025", "Active recovery agent requires an authorization-letter reference.", "authorization.letterRef"));
    }
    if (!agent?.authorization?.idCardRef) {
      findings.push(createFinding("error", "RBI-DL-2025", "Active recovery agent requires an identity-card reference.", "authorization.idCardRef"));
    }
  }

  return {
    findings,
    summary: summarizeFindings(findings)
  };
}

export function normalizeRecoveryAgent(input, existing = {}, now = new Date()) {
  return {
    recoveryAgentId: input.recoveryAgentId ?? existing.recoveryAgentId,
    regulatedEntityId: input.regulatedEntityId ?? existing.regulatedEntityId ?? null,
    name: input.name ?? existing.name ?? null,
    agencyName: input.agencyName ?? existing.agencyName ?? null,
    country: input.country ?? existing.country ?? "IN",
    status: input.status ?? existing.status ?? ACTIVE_STATUS,
    statusReason: input.statusReason ?? existing.statusReason ?? null,
    dueDiligence: {
      policeVerificationRef: input.dueDiligence?.policeVerificationRef ?? existing.dueDiligence?.policeVerificationRef ?? null,
      verifiedAt: input.dueDiligence?.verifiedAt ?? existing.dueDiligence?.verifiedAt ?? null,
      verifiedBy: input.dueDiligence?.verifiedBy ?? existing.dueDiligence?.verifiedBy ?? null
    },
    training: {
      certificationRef: input.training?.certificationRef ?? existing.training?.certificationRef ?? null,
      certifiedAt: input.training?.certifiedAt ?? existing.training?.certifiedAt ?? null
    },
    codeOfConduct: {
      acknowledgmentRef: input.codeOfConduct?.acknowledgmentRef ?? existing.codeOfConduct?.acknowledgmentRef ?? null,
      acknowledgedAt: input.codeOfConduct?.acknowledgedAt ?? existing.codeOfConduct?.acknowledgedAt ?? null
    },
    authorization: {
      letterRef: input.authorization?.letterRef ?? existing.authorization?.letterRef ?? null,
      idCardRef: input.authorization?.idCardRef ?? existing.authorization?.idCardRef ?? null
    },
    createdAt: existing.createdAt ?? input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function upsertRecoveryAgent(registry, input, regulatedEntities = {}, now = new Date()) {
  const agent = normalizeRecoveryAgent(input, (registry ?? {})[input?.recoveryAgentId] ?? {}, now);
  const validation = validateRecoveryAgent(agent, regulatedEntities);
  const nextRegistry =
    validation.summary.status === "blocked"
      ? registry ?? {}
      : {
          ...(registry ?? {}),
          [agent.recoveryAgentId]: agent
        };

  return {
    registry: nextRegistry,
    recoveryAgent: agent,
    findings: validation.findings,
    summary: validation.summary
  };
}
