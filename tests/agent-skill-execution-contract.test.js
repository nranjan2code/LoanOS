import test from "node:test";
import assert from "node:assert/strict";
import {
  SKILL_ROUTING_TABLE,
  SKILL_PERMISSION_MANIFESTS,
  routeAgentSkill,
  validateSkillPermissions,
  assessSkillExecutionReadiness,
  recordSkillExecution
} from "@loanos/core/ai/agent-skill-execution-contract.js";

const NOW = new Date("2026-07-24T12:00:00.000Z");

test("routeAgentSkill correctly routes known task keys to skill chains", () => {
  const result = routeAgentSkill("fix_bug");
  assert.equal(result.outcome, "allow");
  assert.equal(result.taskType, "fix_bug");
  assert.deepEqual(result.skillChain, ["fix-bug", "definition-of-done"]);
});

test("routeAgentSkill resolves task keywords deterministically", () => {
  const bugRes = routeAgentSkill("There is a defect in the credit calculation engine");
  assert.equal(bugRes.outcome, "allow");
  assert.equal(bugRes.taskType, "fix_bug");

  const featRes = routeAgentSkill("Start a new feature for loan restructuring");
  assert.equal(featRes.outcome, "allow");
  assert.equal(featRes.taskType, "start_feature");

  const adrRes = routeAgentSkill("Record an architectural decision for engine gateway");
  assert.equal(adrRes.outcome, "allow");
  assert.equal(adrRes.taskType, "record_adr");
});

test("routeAgentSkill fails closed to refer on unclassifiable input", () => {
  const unk = routeAgentSkill("arbitrary random sentence with no domain keywords");
  assert.equal(unk.outcome, "refer");
  assert.equal(unk.taskType, null);
  assert.deepEqual(unk.skillChain, []);

  const empty = routeAgentSkill("");
  assert.equal(empty.outcome, "refer");
});

test("validateSkillPermissions allows paths within declared prefixes", () => {
  const valid = validateSkillPermissions("change-lending-policy", [
    "packages/core/src/lending/eligibility.js",
    "rules/crates/rules-eval/src/lib.rs"
  ]);
  assert.equal(valid.outcome, "allow");
  assert.equal(valid.violatedPaths.length, 0);
});

test("validateSkillPermissions denies paths outside declared prefixes", () => {
  const invalid = validateSkillPermissions("record-adr", [
    "docs/decisions/0009-new-adr.md",
    "apps/api/src/server.js"
  ]);
  assert.equal(invalid.outcome, "deny");
  assert.deepEqual(invalid.violatedPaths, ["apps/api/src/server.js"]);
});

test("assessSkillExecutionReadiness requires human approval when specified by manifest", () => {
  const unapproved = assessSkillExecutionReadiness("compliance-control-change", {});
  assert.equal(unapproved.ready, false);
  assert.equal(unapproved.reasons.length, 1);
  assert.match(unapproved.reasons[0], /human approval/i);

  const approved = assessSkillExecutionReadiness("compliance-control-change", {
    humanApprovalRef: "appr_12345"
  });
  assert.equal(approved.ready, true);
  assert.equal(approved.reasons.length, 0);
});

test("recordSkillExecution produces a sealed evidence record with contentHash", () => {
  const evidence = recordSkillExecution(
    {
      skillId: "fix-bug",
      taskId: "task_99",
      agentId: "agent_dev_1",
      filesRead: ["packages/core/src/ai/model-governance.js"],
      filesWritten: ["packages/core/src/ai/model-governance.js"],
      gateResults: { "npm test": "pass" }
    },
    NOW
  );

  assert.equal(evidence.skillId, "fix-bug");
  assert.equal(evidence.taskId, "task_99");
  assert.match(evidence.recordHash, /^[a-f0-9]{64}$/i);
});

test("recordSkillExecution fails closed on missing or unregistered skillId", () => {
  assert.throws(() => recordSkillExecution({}), /skillId/);
  assert.throws(() => recordSkillExecution({ skillId: "nonexistent-skill" }), /Unregistered skill/);
});
