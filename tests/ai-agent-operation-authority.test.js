import test from "node:test";
import assert from "node:assert/strict";
import { authorizeAiAgentOperation } from "../apps/api/src/routes/ai-agent-platform.js";

const context = (roles, principalType = "tenant_user") => ({
  authContext: { tenantId: "bank-a", userId: "user-1", principalType, roles: [] },
  state: { users: { "user-1": { userId: "user-1", roles, adminRoles: [] } } }
});

test("AI route authority denies unclassified operations and service identities by default", () => {
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/unknown", ...context(["tenant_admin"]) }).allowed, false);
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/agents/installations", ...context(["model_owner"], "service") }).allowed, false);
});

test("commercial maker and checker duties are distinct", () => {
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/pricing-contracts", ...context(["finance_maker"]) }).allowed, true);
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/pricing-contracts/price-1/approve", ...context(["finance_maker"]) }).allowed, false);
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/pricing-contracts/price-1/approve", ...context(["finance_checker"]) }).allowed, true);
});

test("builders cannot approve resources or provider evidence", () => {
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/agents/knowledge-packs", ...context(["model_owner"]) }).allowed, true);
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/agents/knowledge-packs/k1/approve", ...context(["model_owner"]) }).allowed, false);
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/agents/provider-evidence/e1/approve", ...context(["model_owner"]) }).allowed, false);
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/agents/provider-evidence/e1/approve", ...context(["vendor_risk_approver"]) }).allowed, true);
});

test("auditors are read-only and human review requires the human reviewer role", () => {
  assert.equal(authorizeAiAgentOperation({ method: "GET", path: "/ai/agents", ...context(["auditor"]) }).allowed, true);
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/agents/installations", ...context(["auditor"]) }).allowed, false);
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/agents/executions/e1/human-review", ...context(["human_reviewer"]) }).allowed, true);
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/agents/executions/e1/human-review", ...context(["operator"]) }).allowed, false);
});

test("runtime work is restricted to the worker scope and replay remains human-governed", () => {
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/agents/runtime/jobs/claim", ...context(["ai_agent_worker"], "workload") }).allowed, true);
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/agents/runtime/jobs/j1/complete", ...context(["ai_agent_worker"], "workload") }).allowed, true);
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/agents/runtime/jobs/j1/replay", ...context(["ai_agent_worker"], "workload") }).allowed, false);
  assert.equal(authorizeAiAgentOperation({ method: "POST", path: "/ai/agents/runtime/jobs/j1/replay", ...context(["model_risk_manager"]) }).allowed, true);
});
