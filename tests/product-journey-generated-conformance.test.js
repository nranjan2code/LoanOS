import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PRODUCT_JOURNEY_TYPES,
  buildProductJourneyGeneratedConformanceMatrix,
  runProductJourneyGeneratedConformance,
  validateProductJourneyGeneratedConformanceMatrix
} from "@loanos/core";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { loadState, saveState } from "../apps/api/src/file-store.js";
import { totpCode } from "../apps/api/src/identity.js";

const PASSWORD = "TenantAccessPass1!";
const MFA = "JBSWY3DPEHPK3PXP";

test("JD-05 generator covers every current journey scenario and lane without a production claim", () => {
  const first = buildProductJourneyGeneratedConformanceMatrix();
  const replay = buildProductJourneyGeneratedConformanceMatrix();
  assert.equal(first.journeyCount, 21);
  assert.equal(first.scenarioCount, 21 * 17);
  assert.equal(first.caseCount, 21 * 17 * 3);
  assert.equal(first.matrixChecksumSha256, replay.matrixChecksumSha256);
  assert.equal(new Set(first.cases.map((item) => item.caseId)).size, first.caseCount);
  assert.deepEqual(new Set(first.cases.map((item) => item.laneId)), new Set(["api_file", "browser_contract", "postgres_rls"]));
  assert.deepEqual(new Set(first.cases.map((item) => item.journeyType)), new Set(PRODUCT_JOURNEY_TYPES));
  assert.deepEqual(new Set(first.cases.map((item) => item.category)), new Set([
    "happy", "adverse", "malformed_adverse", "adverse_recovery", "idempotent_replay",
    "tenant_isolation", "authorization_denial", "integrity", "recovery"
  ]));
  assert.equal(first.commerciallyLive, false);
  assert.equal(first.cases.every((item) => item.commerciallyLive === false && item.executionMode === "non_production"), true);
  assert.deepEqual(validateProductJourneyGeneratedConformanceMatrix(first), { valid: true, errors: [] });
});

test("JD-05 runner fails closed on absent executors or evidence and rejects live claims", async () => {
  const matrix = buildProductJourneyGeneratedConformanceMatrix({ journeyTypes: ["personal_loan"] });
  const selectedScenario = "JRN-COM-001";
  const run = await runProductJourneyGeneratedConformance({
    matrix,
    select: (item) => item.scenarioId === selectedScenario,
    executors: {
      api_file: async (item) => ({ outcome: "passed", evidenceRef: `test://api/${item.caseId}` }),
      browser_contract: async () => ({ outcome: "passed" })
    }
  });
  assert.deepEqual(run.summary, { selectedCaseCount: 3, passedCount: 1, failedCount: 0, blockedCount: 2, allPassed: false, productionReady: false });
  assert.equal(run.results.find((item) => item.laneId === "browser_contract").reasonCode, "evidence_required");
  assert.equal(run.results.find((item) => item.laneId === "postgres_rls").reasonCode, "executor_unavailable");
  await assert.rejects(() => runProductJourneyGeneratedConformance({ matrix, executionMode: "live" }), { code: "journey_generated_conformance_live_claim_forbidden" });
  await assert.rejects(() => runProductJourneyGeneratedConformance({ matrix: { ...matrix, caseCount: matrix.caseCount + 1 } }), { code: "journey_generated_conformance_matrix_invalid" });
});

test("generated browser lane enforces safe DOM, accessibility, API and no-cache contracts for all 21×17 cases", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../apps/journey-workspace/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/journey-workspace/workspace.js", import.meta.url), "utf8"),
    readFile(new URL("../apps/journey-workspace/workspace.css", import.meta.url), "utf8")
  ]);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Offline: lending data is not cached/);
  assert.match(html, /id="language"/);
  assert.match(js, /\/journey-workspaces\/\$\{channel\}\/catalogue/);
  assert.match(js, /replaceChildren\(/);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|serviceWorker/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);

  const matrix = buildProductJourneyGeneratedConformanceMatrix({ lanes: ["browser_contract"] });
  const run = await runProductJourneyGeneratedConformance({
    matrix,
    executors: { browser_contract: async (item) => ({ outcome: "passed", evidenceRef: `contract://journey-workspace/v2/${item.journeyType}/${item.scenarioId}` }) }
  });
  assert.equal(run.summary.selectedCaseCount, 21 * 17);
  assert.equal(run.summary.allPassed, true);
  assert.equal(run.summary.productionReady, false);
});

test("generated API/file probes cover happy, malformed, replay, authorization, isolation and restart recovery for all 21", async (t) => {
  const tenants = [
    { tenantId: "jd05_file_a", name: "JD05 File A", apiKey: "jd05-file-key-a" },
    { tenantId: "jd05_file_b", name: "JD05 File B", apiKey: "jd05-file-key-b" }
  ];
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-jd05-generated-"));
  const running = new Set();
  t.after(async () => {
    for (const server of running) await close(server);
    await rm(dataDir, { recursive: true, force: true });
  });
  let server = await start(dataDir, tenants);
  running.add(server);
  let base = `http://127.0.0.1:${server.address().port}`;

  const cookies = {
    a: await createAndLogin(base, tenants[0], "operator-a", ["tenant_admin"]),
    denied: await createAndLogin(base, tenants[0], "grievance-a", [], ["grievance_officer"]),
    b: await createAndLogin(base, tenants[1], "operator-b", ["tenant_admin"])
  };
  const state = await loadState(dataDir);
  for (const tenant of tenants) {
    state.tenants[tenant.tenantId].tenantProductSubscriptions = {
      "jd05-all-products": {
        subscriptionId: "jd05-all-products",
        tenantId: tenant.tenantId,
        productTypes: [...PRODUCT_JOURNEY_TYPES],
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2030-01-01T00:00:00.000Z",
        status: "active"
      }
    };
  }
  await saveState(state, dataDir);

  let response = await fetch(`${base}/journey-workspaces/credit/catalogue`, { headers: { cookie: cookies.denied } });
  assert.equal(response.status, 403, "an unstaffed principal must fail closed");
  await response.text();

  for (const journeyType of PRODUCT_JOURNEY_TYPES) {
    response = await fetch(`${base}/journey-workspaces/credit/schemas/${journeyType}`, { headers: { cookie: cookies.a } });
    assert.equal(response.status, 200, `${journeyType} schema projection`);
    const schema = (await response.json()).schema;
    assert.equal(schema.journeyType, journeyType);
    assert.match(schema.schemaChecksumSha256, /^[a-f0-9]{64}$/);

    response = await fetch(`${base}/journey-workspaces/credit/drafts/${journeyType}`, {
      method: "POST",
      headers: { cookie: cookies.a, "content-type": "application/json" },
      body: JSON.stringify({ draftId: `malformed-${journeyType}`, idempotencyKey: `malformed-${journeyType}`, values: [] })
    });
    assert.equal(response.status, 422, `${journeyType} malformed values must fail closed`);
    assert.equal((await response.json()).error.code, "journey_workspace_values_invalid");

    const body = { draftId: `draft-${journeyType}`, idempotencyKey: `idem-${journeyType}`, values: {} };
    response = await postDraft(base, cookies.a, journeyType, body);
    assert.equal(response.status, 201, `${journeyType} initial draft`);
    assert.equal((await response.json()).idempotent, false);
    response = await postDraft(base, cookies.a, journeyType, body);
    assert.equal(response.status, 200, `${journeyType} exact replay`);
    assert.equal((await response.json()).idempotent, true);
  }

  response = await fetch(`${base}/journey-workspaces/credit/drafts`, { headers: { cookie: cookies.b } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).drafts, [], "tenant B cannot observe tenant A drafts");

  await close(server);
  running.delete(server);
  server = await start(dataDir, tenants);
  running.add(server);
  base = `http://127.0.0.1:${server.address().port}`;
  response = await fetch(`${base}/journey-workspaces/credit/drafts`, { headers: { cookie: cookies.a } });
  assert.equal(response.status, 200);
  const recovered = (await response.json()).drafts;
  assert.equal(recovered.length, PRODUCT_JOURNEY_TYPES.length);
  assert.deepEqual(new Set(recovered.map((item) => item.journeyType)), new Set(PRODUCT_JOURNEY_TYPES));

  const persisted = await loadState(dataDir);
  assert.equal(Object.keys(persisted.tenants.jd05_file_a.journeyWorkspaceDrafts).length, 21);
  assert.equal(Object.keys(persisted.tenants.jd05_file_b.journeyWorkspaceDrafts).length, 0);
});

async function postDraft(base, cookie, journeyType, body) {
  return fetch(`${base}/journey-workspaces/credit/drafts/${journeyType}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function createAndLogin(base, tenant, userId, adminRoles, roles = []) {
  let response = await fetch(`${base}/admin/users`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": tenant.apiKey },
    body: JSON.stringify({ userId, email: `${userId}@jd05.example`, displayName: userId, password: PASSWORD, mustChangePassword: false, adminRoles, roles, country: "IN", mfaRequired: true, mfaEnabled: true, mfaSecret: MFA })
  });
  assert.equal(response.status, 201, await response.clone().text());
  await response.text();
  response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: tenant.tenantId, email: `${userId}@jd05.example`, password: PASSWORD, mfaCode: totpCode(MFA) }) });
  assert.equal(response.status, 200, await response.clone().text());
  await response.text();
  return response.headers.get("set-cookie").split(";", 1)[0];
}

async function start(dataDir, tenants) {
  const server = createLoanOsServer({ dataDir, bootstrapTenants: tenants });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  await fetch(`http://127.0.0.1:${server.address().port}/health`);
  return server;
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve) => server.close(resolve));
}
