import test from "node:test";
import assert from "node:assert/strict";
import {
  DIGITAL_WORKER_TOOL_CATALOGUE,
  executeGovernedDigitalWorkerTool,
  projectDigitalWorkerToolCatalogue
} from "@loanos/core/ai/digital-worker-tool-registry.js";

const H = "a".repeat(64);
const installation = {
  installationId: "agent-1",
  tenantId: "bank-a",
  status: "active",
  approvedToolIds: ["knowledge.retrieve", "communication.dispatch"]
};
const allow = (decisionKey) => ({
  decision: "allow",
  decisionKey,
  traceRef: `trace:${decisionKey}`,
  source: "isolated_business_engine",
  rulesetHash: H
});

test("unregistered and unapproved worker tools fail closed before a port is called", async () => {
  let calls = 0;
  const port = async () => { calls += 1; return { accepted: true, evidenceRef: "evidence/1" }; };
  await assert.rejects(
    () => executeGovernedDigitalWorkerTool({ toolId: "database.query", tenantId: "bank-a", installation, request: { purpose: "CAM" }, decide: async () => allow("guardrail.data_access"), port }),
    (error) => error.code === "digital_worker_tool_unregistered"
  );
  await assert.rejects(
    () => executeGovernedDigitalWorkerTool({ toolId: "case.change.propose", tenantId: "bank-a", installation, request: { purpose: "CAM" }, decide: async () => allow("guardrail.case_mutation"), port }),
    (error) => error.code === "digital_worker_tool_not_approved"
  );
  assert.equal(calls, 0);
});

test("missing, malformed, mismatched and denied guardrail decisions fail closed", async () => {
  const base = { toolId: "knowledge.retrieve", tenantId: "bank-a", installation, request: { purpose: "prepare CAM", resourceTenantId: "bank-a", minimumFieldsOnly: true }, port: async () => ({ accepted: true, evidenceRef: "evidence/1" }) };
  for (const decision of [
    null,
    { decision: "allow", decisionKey: "guardrail.data_access" },
    allow("guardrail.case_mutation"),
    { ...allow("guardrail.data_access"), decision: "deny" }
  ]) {
    await assert.rejects(
      () => executeGovernedDigitalWorkerTool({ ...base, decide: async () => decision }),
      (error) => ["digital_worker_tool_decision_invalid", "digital_worker_tool_denied"].includes(error.code)
    );
  }
});

test("cross-tenant tool requests fail before policy or port invocation", async () => {
  let decisions = 0;
  await assert.rejects(
    () => executeGovernedDigitalWorkerTool({
      toolId: "knowledge.retrieve", tenantId: "bank-b", installation,
      request: { purpose: "prepare CAM", resourceTenantId: "bank-b", minimumFieldsOnly: true },
      decide: async () => { decisions += 1; return allow("guardrail.data_access"); },
      port: async () => ({ accepted: true, evidenceRef: "evidence/1" })
    }),
    (error) => error.code === "digital_worker_tool_tenant_mismatch"
  );
  assert.equal(decisions, 0);
});

test("approved retrieval calls its exact guardrail and port and retains trace lineage", async () => {
  let observed;
  const outcome = await executeGovernedDigitalWorkerTool({
    toolId: "knowledge.retrieve", tenantId: "bank-a", installation,
    request: { requestId: "tool-1", purpose: "prepare CAM", resourceTenantId: "bank-a", minimumFieldsOnly: true, consentRequired: false },
    decide: async (input) => { observed = input; return allow(input.decisionKey); },
    port: async ({ tool, request }) => ({ accepted: true, evidenceRef: "knowledge/v4#p2", result: { citations: [request.requestId], toolId: tool.toolId } })
  });
  assert.equal(observed.decisionKey, "guardrail.data_access");
  assert.equal(observed.facts.request.tenant_match, true);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.guardrailTraceRef, "trace:guardrail.data_access");
  assert.equal(outcome.evidenceRef, "knowledge/v4#p2");
});

test("direct worker dispatch is prohibited even when the outbound policy allows it", async () => {
  await assert.rejects(
    () => executeGovernedDigitalWorkerTool({
      toolId: "communication.dispatch", tenantId: "bank-a", installation,
      request: { purpose: "borrower update", resourceTenantId: "bank-a", humanApprovalRecorded: true },
      decide: async (input) => allow(input.decisionKey),
      port: async () => ({ accepted: true, evidenceRef: "dispatch/1" })
    }),
    (error) => error.code === "digital_worker_tool_human_domain_required"
  );
});

test("tool catalogue projects versioned policy and authority without executable ports", () => {
  const projection = projectDigitalWorkerToolCatalogue();
  assert.equal(projection.version, DIGITAL_WORKER_TOOL_CATALOGUE.version);
  assert.ok(projection.tools.every((tool) => tool.guardrailDecisionKey.startsWith("guardrail.") && !("port" in tool)));
});
