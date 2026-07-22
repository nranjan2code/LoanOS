import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { checkedValues, rupeesToPaise } from "../apps/agent-studio/agent-studio-state.js";

test("Agent Studio reads selections from the owning form and converts rupees exactly", () => {
  const commercialForm = { querySelectorAll: (selector) => selector === '[name="commercialTemplates"]:checked' ? [{ value: "credit.cam" }, { value: "service.borrower_support" }] : [] };
  assert.deepEqual(checkedValues(commercialForm, "commercialTemplates"), ["credit.cam", "service.borrower_support"]);
  assert.equal(rupeesToPaise("1250.75"), "125075");
  assert.equal(rupeesToPaise("0"), "0");
  assert.throws(() => rupeesToPaise("10.999"), /two decimal places/i);
});

test("Agent Studio is business-first and exposes governed creation choices", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../apps/agent-studio/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/agent-studio/agent-studio.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /Use a banking template/);
  assert.match(html, /Copy an existing assistant/);
  assert.match(html, /Create a new assistant/);
  assert.match(html, /enabled-products/);
  assert.match(html, /name="memoryMode"/);
  assert.doesNotMatch(html, /\(paise\)/i);
  assert.match(js, /enabledProductTypes/);
  assert.match(js, /memoryMode: form\.get\("memoryMode"\)/);
  assert.match(js, /rupeesToPaise/);
  for (const marker of ["workflow-form", "workflow-steps", "knowledge-form", "test-form", "compare-form", "comparison-result"]) assert.match(html, new RegExp(marker));
  for (const route of ["/ai/agents/workflows", "/ai/agents/knowledge-packs", "/ai/agents/test-suites", "/ai/agents/compare"]) assert.match(js, new RegExp(route.replaceAll("/", "\\/")));
  for (const marker of ["test-results", "release-readiness", "version-form", "version-list", "rollback-form", "rollback-list"]) assert.match(html, new RegExp(marker));
  for (const route of ["/ai/agents/versions", "/ai/agents/rollbacks"]) assert.match(js, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(html, /do not certify a live model or provider/i);
  for (const marker of ["role-view", "memory-form", "memory-list", "budget-actions", "budget-monitor", "operations-queue"]) assert.match(html, new RegExp(marker));
  for (const route of ["/ai/agents/memory-stores", "/ai/usage-budgets/"]) assert.match(js, new RegExp(route.replaceAll("/", "\\/")));
  for (const marker of ["provider-form", "provider-list", "admission-list"]) assert.match(html, new RegExp(marker));
  assert.match(js, /\/ai\/agents\/provider-evidence/);
  for (const view of ["create", "knowledge", "test-release", "operations", "governance"]) assert.match(html, new RegExp(`data-studio-view="${view}"`));
  // The Studio must never fabricate rehearsal outcomes client-side; it only
  // asks the server harness to run, and reviews proposals via human-review.
  assert.doesNotMatch(js, /observedOutcome:\s*testCase\.expectedOutcome/);
  assert.match(js, /\/human-review/);
  assert.match(js, /data-review-execution/i);
  assert.match(html, /workspace-intro/);
  assert.match(js, /function setStudioView/);
  assert.match(js, /hashchange/);
  assert.match(js, /ArrowLeft/);
});

test("Agent Studio is a tenant-scoped staff surface with governed configuration affordances", async (t) => {
  const tenant = { tenantId: "agent_studio", name: "Agent Studio Bank", apiKey: "agent-studio-key" };
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-agent-studio-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });

  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/t/${tenant.tenantId}/staff/agents`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /LoanOS Agent Studio/);
});

test("Agent Studio exposes template selection, controlled configuration, simulation and approval guidance", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../apps/agent-studio/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/agent-studio/agent-studio.js", import.meta.url), "utf8"),
    readFile(new URL("../apps/agent-studio/agent-studio.css", import.meta.url), "utf8")
  ]);
  for (const marker of ["template-gallery", "agent-form", "simulation-preview", "approval-readiness", "knowledge-sources", "commercial-form", "installation-list", "governance-report"]) assert.match(html, new RegExp(marker));
  for (const route of ["/ai/marketplace", "/ai/agents", "/ai/models", "/ai/agents/installations", "/ai/pricing-contracts", "/ai/agents/governance-report"]) assert.match(js, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(js, /proposal only/i);
  assert.match(js, /cannot expand/i);
  assert.match(css, /var\(--bg-surface-1\)/);
  assert.match(css, /:focus-visible/);
});
