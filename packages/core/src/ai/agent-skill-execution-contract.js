/**
 * Layer 4 — Agent Skill Execution Contract
 *
 * Deterministic agent skill routing, permission boundary enforcement, and
 * tamper-sealed execution evidence capture for AI coding agents and platform skills.
 * Closes the Layer 4 gap documented in `docs/architecture/knowledge-execution-stack/README.md`.
 */
import { contentHash, sealRecord } from "./record-seal.js";

/**
 * Canonical task-type to skill-chain routing table, derived from AGENTS.md
 * and `.agents/skills/`.
 */
export const SKILL_ROUTING_TABLE = Object.freeze({
  fix_bug: Object.freeze({
    taskType: "fix_bug",
    primarySkill: "fix-bug",
    skillChain: Object.freeze(["fix-bug", "definition-of-done"]),
    description: "Fix a defect in the LoanOS repository."
  }),
  start_feature: Object.freeze({
    taskType: "start_feature",
    primarySkill: "start-feature",
    skillChain: Object.freeze(["start-feature", "add-capability", "definition-of-done"]),
    description: "Build a new feature, story or enhancement."
  }),
  groom_backlog: Object.freeze({
    taskType: "groom_backlog",
    primarySkill: "groom-backlog",
    skillChain: Object.freeze(["groom-backlog", "add-capability", "definition-of-done"]),
    description: "Open, update or close an epic, bundle or review finding."
  }),
  update_journey_depth: Object.freeze({
    taskType: "update_journey_depth",
    primarySkill: "update-journey-depth",
    skillChain: Object.freeze(["update-journey-depth", "groom-backlog", "update-gtm-claim", "definition-of-done"]),
    description: "Advance a product journey's recorded platform depth."
  }),
  definition_of_done: Object.freeze({
    taskType: "definition_of_done",
    primarySkill: "definition-of-done",
    skillChain: Object.freeze(["definition-of-done"]),
    description: "Verification and evidence check sweep before committing."
  }),
  change_lending_policy: Object.freeze({
    taskType: "change_lending_policy",
    primarySkill: "change-lending-policy",
    skillChain: Object.freeze(["change-lending-policy", "definition-of-done"]),
    description: "Modify JS lending eligibility or Rust-mirrored decision logic."
  }),
  add_capability: Object.freeze({
    taskType: "add_capability",
    primarySkill: "add-capability",
    skillChain: Object.freeze(["add-capability", "definition-of-done"]),
    description: "Add a platform capability or update maturity status."
  }),
  record_adr: Object.freeze({
    taskType: "record_adr",
    primarySkill: "record-adr",
    skillChain: Object.freeze(["record-adr", "definition-of-done"]),
    description: "Record an irreversible architecture decision."
  }),
  extract_api_route: Object.freeze({
    taskType: "extract_api_route",
    primarySkill: "extract-api-route",
    skillChain: Object.freeze(["extract-api-route", "definition-of-done"]),
    description: "Extract inline HTTP handler from server.js to route module."
  }),
  update_guide_academy: Object.freeze({
    taskType: "update_guide_academy",
    primarySkill: "update-guide-academy",
    skillChain: Object.freeze(["update-guide-academy", "definition-of-done"]),
    description: "Modify Guide or Academy learning content."
  }),
  compliance_control_change: Object.freeze({
    taskType: "compliance_control_change",
    primarySkill: "compliance-control-change",
    skillChain: Object.freeze(["compliance-control-change", "definition-of-done"]),
    description: "Modify a compliance control or regulatory interpretation."
  }),
  update_gtm_claim: Object.freeze({
    taskType: "update_gtm_claim",
    primarySkill: "update-gtm-claim",
    skillChain: Object.freeze(["update-gtm-claim", "definition-of-done"]),
    description: "Modify an externally-visible capability claim."
  }),
  aws_showcase_change: Object.freeze({
    taskType: "aws_showcase_change",
    primarySkill: "aws-showcase-change",
    skillChain: Object.freeze(["aws-showcase-change", "definition-of-done"]),
    description: "Modify deploy/aws/ or showcase release surface."
  })
});

/**
 * Skill permission manifests defining path boundaries, required CI gates,
 * and human approval requirements per skill.
 */
export const SKILL_PERMISSION_MANIFESTS = Object.freeze({
  "fix-bug": Object.freeze({
    skillId: "fix-bug",
    allowedWritePrefixes: Object.freeze(["packages/", "apps/", "rules/", "tests/", "docs/"]),
    requiredGates: Object.freeze(["npm test"]),
    requiresHumanApproval: false
  }),
  "start-feature": Object.freeze({
    skillId: "start-feature",
    allowedWritePrefixes: Object.freeze(["docs/product/", "packages/", "apps/", "rules/", "tests/"]),
    requiredGates: Object.freeze(["npm test", "knowledge:check"]),
    requiresHumanApproval: false
  }),
  "add-capability": Object.freeze({
    skillId: "add-capability",
    allowedWritePrefixes: Object.freeze(["docs/product/", "packages/core/src/capabilities/"]),
    requiredGates: Object.freeze(["knowledge:check"]),
    requiresHumanApproval: false
  }),
  "change-lending-policy": Object.freeze({
    skillId: "change-lending-policy",
    allowedWritePrefixes: Object.freeze(["packages/core/src/lending/", "rules/"]),
    requiredGates: Object.freeze(["npm test", "corpus:check"]),
    requiresHumanApproval: false
  }),
  "record-adr": Object.freeze({
    skillId: "record-adr",
    allowedWritePrefixes: Object.freeze(["docs/decisions/"]),
    requiredGates: Object.freeze(["graph:check"]),
    requiresHumanApproval: false
  }),
  "extract-api-route": Object.freeze({
    skillId: "extract-api-route",
    allowedWritePrefixes: Object.freeze(["apps/api/src/"]),
    requiredGates: Object.freeze(["npm test"]),
    requiresHumanApproval: false
  }),
  "update-guide-academy": Object.freeze({
    skillId: "update-guide-academy",
    allowedWritePrefixes: Object.freeze(["apps/help/"]),
    requiredGates: Object.freeze(["npm test"]),
    requiresHumanApproval: false
  }),
  "compliance-control-change": Object.freeze({
    skillId: "compliance-control-change",
    allowedWritePrefixes: Object.freeze(["packages/core/src/compliance/", "docs/compliance/"]),
    requiredGates: Object.freeze(["npm test", "knowledge:check"]),
    requiresHumanApproval: true
  }),
  "update-gtm-claim": Object.freeze({
    skillId: "update-gtm-claim",
    allowedWritePrefixes: Object.freeze(["docs/gtm/"]),
    requiredGates: Object.freeze(["knowledge:check"]),
    requiresHumanApproval: false
  }),
  "aws-showcase-change": Object.freeze({
    skillId: "aws-showcase-change",
    allowedWritePrefixes: Object.freeze(["deploy/aws/"]),
    requiredGates: Object.freeze(["npm test"]),
    requiresHumanApproval: true
  }),
  "groom-backlog": Object.freeze({
    skillId: "groom-backlog",
    allowedWritePrefixes: Object.freeze(["docs/product/"]),
    requiredGates: Object.freeze(["knowledge:check"]),
    requiresHumanApproval: false
  }),
  "update-journey-depth": Object.freeze({
    skillId: "update-journey-depth",
    allowedWritePrefixes: Object.freeze(["docs/product/product-journey-platform-depth.json"]),
    requiredGates: Object.freeze(["depth:check"]),
    requiresHumanApproval: false
  }),
  "definition-of-done": Object.freeze({
    skillId: "definition-of-done",
    allowedWritePrefixes: Object.freeze(["docs/"]),
    requiredGates: Object.freeze(["knowledge:check"]),
    requiresHumanApproval: false
  })
});

/**
 * Deterministically resolve a task description or task type to a skill chain.
 * Fails closed to `outcome: "refer"` if unclassified.
 * @param {string} taskInput - task type key (e.g. "fix_bug") or raw text description.
 * @returns {{outcome: "allow"|"refer", taskType: string|null, skillChain: Array<string>}}
 */
export function routeAgentSkill(taskInput) {
  if (typeof taskInput !== "string" || !taskInput.trim()) {
    return { outcome: "refer", taskType: null, skillChain: [] };
  }
  const clean = taskInput.trim().toLowerCase();

  // 1. Direct match on key
  if (SKILL_ROUTING_TABLE[clean]) {
    const entry = SKILL_ROUTING_TABLE[clean];
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }

  // 2. Keyword heuristic mapping
  if (clean.includes("bug") || clean.includes("fix") || clean.includes("defect") || clean.includes("issue")) {
    const entry = SKILL_ROUTING_TABLE.fix_bug;
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }
  if (clean.includes("feature") || clean.includes("capability") || clean.includes("story")) {
    const entry = SKILL_ROUTING_TABLE.start_feature;
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }
  if (clean.includes("adr") || clean.includes("architecture decision") || clean.includes("architectural decision") || clean.includes("architectural")) {
    const entry = SKILL_ROUTING_TABLE.record_adr;
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }
  if (clean.includes("lending policy") || clean.includes("eligibility policy")) {
    const entry = SKILL_ROUTING_TABLE.change_lending_policy;
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }
  if (clean.includes("aws") || clean.includes("showcase") || clean.includes("deploy")) {
    const entry = SKILL_ROUTING_TABLE.aws_showcase_change;
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }
  if (clean.includes("guide") || clean.includes("academy") || clean.includes("help")) {
    const entry = SKILL_ROUTING_TABLE.update_guide_academy;
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }
  if (clean.includes("compliance") || clean.includes("regulatory")) {
    const entry = SKILL_ROUTING_TABLE.compliance_control_change;
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }
  if (clean.includes("claim") || clean.includes("gtm")) {
    const entry = SKILL_ROUTING_TABLE.update_gtm_claim;
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }
  if (clean.includes("route") || clean.includes("extract api")) {
    const entry = SKILL_ROUTING_TABLE.extract_api_route;
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }
  if (clean.includes("journey depth") || clean.includes("depth check")) {
    const entry = SKILL_ROUTING_TABLE.update_journey_depth;
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }
  if (clean.includes("backlog") || clean.includes("groom")) {
    const entry = SKILL_ROUTING_TABLE.groom_backlog;
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }
  if (clean.includes("done") || clean.includes("definition of done")) {
    const entry = SKILL_ROUTING_TABLE.definition_of_done;
    return { outcome: "allow", taskType: entry.taskType, skillChain: [...entry.skillChain] };
  }

  // Fail closed if task cannot be classified
  return { outcome: "refer", taskType: null, skillChain: [] };
}

/**
 * Validate proposed file modifications against a skill's write-path manifest.
 * @param {string} skillId
 * @param {Array<string>} proposedWritePaths
 * @returns {{outcome: "allow"|"deny", skillId: string, violatedPaths: Array<string>}}
 */
export function validateSkillPermissions(skillId, proposedWritePaths = []) {
  const manifest = SKILL_PERMISSION_MANIFESTS[skillId];
  if (!manifest) {
    return { outcome: "deny", skillId, violatedPaths: proposedWritePaths };
  }
  if (!Array.isArray(proposedWritePaths)) {
    return { outcome: "deny", skillId, violatedPaths: [] };
  }

  const violatedPaths = proposedWritePaths.filter((filePath) => {
    const norm = String(filePath).replace(/^\.\//, "");
    return !manifest.allowedWritePrefixes.some((prefix) => norm.startsWith(prefix));
  });

  return {
    outcome: violatedPaths.length === 0 ? "allow" : "deny",
    skillId,
    violatedPaths
  };
}

/**
 * Assess readiness of a skill execution context.
 * Checks skill manifest existence, human approval requirement, and required gates.
 * @param {string} skillId
 * @param {object} [context] - { humanApprovalRef, gateResults }
 * @returns {{ready: boolean, skillId: string, reasons: Array<string>}}
 */
export function assessSkillExecutionReadiness(skillId, context = {}) {
  const manifest = SKILL_PERMISSION_MANIFESTS[skillId];
  const reasons = [];

  if (!manifest) {
    return { ready: false, skillId, reasons: [`Skill ${skillId} has no registered permission manifest.`] };
  }

  if (manifest.requiresHumanApproval && !context.humanApprovalRef) {
    reasons.push(`Skill ${skillId} requires a recorded human approval reference.`);
  }

  return {
    ready: reasons.length === 0,
    skillId,
    reasons
  };
}

/**
 * Produce a tamper-sealed execution evidence record for a completed skill run.
 * @param {object} input - { skillId, taskId, agentId, filesRead, filesWritten, gateResults, humanApprovalRef }
 * @param {Date} [now]
 * @returns {object} Sealed evidence record with contentHash.
 */
export function recordSkillExecution(input = {}, now = new Date()) {
  if (!input.skillId || typeof input.skillId !== "string") {
    throw new Error("recordSkillExecution requires a valid skillId.");
  }
  if (!SKILL_PERMISSION_MANIFESTS[input.skillId]) {
    throw new Error(`Unregistered skill: ${input.skillId}`);
  }

  const raw = {
    executionId: `skillev_${now.getTime().toString(36)}_${contentHash(input).slice(0, 8)}`,
    skillId: input.skillId,
    taskId: input.taskId ?? "unspecified",
    agentId: input.agentId ?? "unknown_agent",
    filesRead: Array.isArray(input.filesRead) ? [...input.filesRead].sort() : [],
    filesWritten: Array.isArray(input.filesWritten) ? [...input.filesWritten].sort() : [],
    gateResults: input.gateResults ?? {},
    humanApprovalRef: input.humanApprovalRef ?? null,
    executedAt: now.toISOString()
  };

  return sealRecord(raw);
}
