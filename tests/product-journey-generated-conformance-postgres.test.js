import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PRODUCT_JOURNEY_TYPES,
  approveProductJourneyConformanceCampaign,
  buildProductJourneyGeneratedConformanceMatrix,
  recordProductJourneyConformanceResult,
  registerProductJourneyConformanceCampaign,
  runProductJourneyGeneratedConformance,
  saveJourneyWorkspaceDraft
} from "@loanos/core";
import { PRODUCT_TEMPLATE_CATALOGUE } from "@loanos/core/platform/product-template-catalogue.js";
import { createProductJourneyDownstreamConformanceExecutor } from "@loanos/core/journeys/product-journey-generated-conformance.js";

const DATABASE_URL_TEST = process.env.DATABASE_URL_TEST;
const REQUIRE_SELECTED_POSTGRES = process.env.LOANOS_REQUIRE_JD05_POSTGRES === "1";
const skip = !REQUIRE_SELECTED_POSTGRES
  ? "JD-05 PostgreSQL/RLS corpus runs only through the explicit selected-environment command."
  : !DATABASE_URL_TEST && "DATABASE_URL_TEST is not set — PostgreSQL/RLS JD-05 lane requires a disposable database.";

test("selected JD-05 PostgreSQL execution cannot silently skip and remains explicit in CI", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(packageJson.scripts["test:journey-postgres"] ?? "", /LOANOS_REQUIRE_JD05_POSTGRES=1/);
  assert.match(packageJson.scripts["test:journey-postgres"] ?? "", /product-journey-generated-conformance-postgres\.test\.js/);
  assert.match(workflow, /npm run test:journey-postgres/);
});

test("selected JD-05 PostgreSQL execution requires an explicit disposable database", { skip: !REQUIRE_SELECTED_POSTGRES }, () => {
  assert.ok(DATABASE_URL_TEST, "DATABASE_URL_TEST is required when LOANOS_REQUIRE_JD05_POSTGRES=1");
});

test("generated PostgreSQL lane persists and recovers all 21 journeys under RLS", { skip }, async () => {
  const pg = await import("pg");
  const { Pool } = pg.default;
  const adminPool = new Pool({ connectionString: DATABASE_URL_TEST });
  const runToken = `${process.pid}_${Date.now()}`;
  const tenantA = `jd05_pg_a_${runToken}`;
  const tenantB = `jd05_pg_b_${runToken}`;
  const postgresStore = await import("../apps/api/src/postgres-store.js");
  let storePool;
  try {
    await adminPool.query(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
    await adminPool.query(
      "INSERT INTO tenants (tenant_id, name, api_key_hash, onboarding) VALUES ($1, $2, $3, '{}'::jsonb), ($4, $5, $6, '{}'::jsonb)",
      [tenantA, "JD05 PostgreSQL A", `hash_${runToken}_a`, tenantB, "JD05 PostgreSQL B", `hash_${runToken}_b`]
    );
    storePool = await postgresStore.resetPoolForTests(rewriteRole(DATABASE_URL_TEST, "loanos_control_plane"));
    const subscription = {
      subscriptionId: "jd05-all-products",
      tenantId: tenantA,
      productTypes: [...PRODUCT_JOURNEY_TYPES],
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2030-01-01T00:00:00.000Z",
      status: "active"
    };
    const matrix = buildProductJourneyGeneratedConformanceMatrix({ tenantId: tenantA, lanes: ["postgres_rls"] });
    const downstream = createProductJourneyDownstreamConformanceExecutor({ now: "2026-07-18T00:00:00.000Z", evidencePrefix: `postgres-test://${runToken}` });
    const run = await runProductJourneyGeneratedConformance({
      matrix,
      executors: { postgres_rls: (item) => downstream({ ...item, laneId: "api_file" }) }
    });
    assert.equal(run.summary.selectedCaseCount, 21 * 17);
    assert.equal(run.summary.allPassed, true);
    assert.equal(run.summary.productionReady, false);
    await postgresStore.withStateLock("ignored", tenantA, async () => {
      let state = await postgresStore.loadTenantDataOnly("ignored", tenantA);
      state = { ...state, tenantProductSubscriptions: { "jd05-all-products": subscription } };
      for (const journeyType of PRODUCT_JOURNEY_TYPES) {
        const input = { tenantId: tenantA, journeyType, channel: "credit", principalType: "tenant_user", roles: ["tenant_admin"], actorId: "jd05-operator", draftId: `draft-${journeyType}`, idempotencyKey: `idem-${journeyType}`, values: {} };
        const created = saveJourneyWorkspaceDraft(state, input, "2026-07-18T00:00:00.000Z");
        assert.equal(created.idempotent, false);
        const replay = saveJourneyWorkspaceDraft(created.state, input, "2026-07-18T00:00:01.000Z");
        assert.equal(replay.idempotent, true);
        state = replay.state;
      }
      let campaigns = state.productJourneyConformanceCampaigns ?? {};
      for (const journeyType of PRODUCT_JOURNEY_TYPES) {
        const template = PRODUCT_TEMPLATE_CATALOGUE[journeyType];
        const campaignId = `jd05-postgres-${journeyType}`;
        let campaign = registerProductJourneyConformanceCampaign(campaigns, { tenantId: tenantA, campaignId, journeyType, templateVersion: template.version, templateChecksumSha256: template.templateChecksumSha256, executionMode: "simulated", commerciallyLive: false, environmentRef: `postgres-test://${runToken}`, tenantConfigurationRef: `tenant-config://${tenantA}/v1`, proposedBy: "jd05-maker" }, new Date("2026-07-18T00:00:00.000Z"));
        campaigns = campaign.registry;
        campaign = approveProductJourneyConformanceCampaign(campaigns, { tenantId: tenantA, campaignId, approvedBy: "jd05-checker", approvalRef: `approval://${campaignId}` }, new Date("2026-07-18T00:00:01.000Z"));
        campaigns = campaign.registry;
        for (const observed of run.results.filter((item) => item.journeyType === journeyType)) {
          const recorded = recordProductJourneyConformanceResult(campaigns, { tenantId: tenantA, campaignId, scenarioId: observed.scenarioId, outcome: observed.outcome, executedBy: "jd05-executor", evidenceRef: observed.evidenceRef, evidenceChecksumSha256: observed.observation.evidenceChecksumSha256, sourceRunRef: `postgres-test://${runToken}/${run.matrixChecksumSha256}` }, new Date("2026-07-18T00:00:02.000Z"));
          campaigns = recorded.registry;
        }
      }
      state = { ...state, productJourneyConformanceCampaigns: campaigns };
      await postgresStore.saveTenantDataOnly("ignored", tenantA, state);
    });

    const recoveredA = await postgresStore.withStateLock("ignored", tenantA, () => postgresStore.loadTenantDataOnly("ignored", tenantA));
    const isolatedB = await postgresStore.withStateLock("ignored", tenantB, () => postgresStore.loadTenantDataOnly("ignored", tenantB));
    assert.equal(Object.keys(recoveredA.journeyWorkspaceDrafts).length, 21);
    assert.deepEqual(new Set(Object.values(recoveredA.journeyWorkspaceDrafts).map((item) => item.journeyType)), new Set(PRODUCT_JOURNEY_TYPES));
    assert.equal(Object.keys(recoveredA.productJourneyConformanceCampaigns).length, 21);
    assert.equal(Object.values(recoveredA.productJourneyConformanceCampaigns).every((campaign) => Object.keys(campaign.results).length === 17), true);
    assert.equal(Object.keys(isolatedB.journeyWorkspaceDrafts).length, 0);
    assert.equal(Object.keys(isolatedB.productJourneyConformanceCampaigns).length, 0);

    const rlsPool = new Pool({ connectionString: rewriteRole(DATABASE_URL_TEST, "loanos_control_plane") });
    const client = await rlsPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE loanos_app");
      assert.equal((await client.query("SELECT tenant_id FROM tenant_data")).rows.length, 0, "RLS has no default-open tenant context");
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantB]);
      assert.equal((await client.query("SELECT tenant_id FROM tenant_data WHERE tenant_id = $1", [tenantA])).rows.length, 0, "tenant B context cannot read tenant A row");
      assert.equal((await client.query("SELECT tenant_id FROM tenant_data WHERE tenant_id = $1", [tenantB])).rows.length, 0, "an absent tenant B envelope remains absent");
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await rlsPool.end();
    }

  } finally {
    if (storePool) await storePool.end().catch(() => {});
    await adminPool.query("DELETE FROM tenant_data WHERE tenant_id = ANY($1::text[])", [[tenantA, tenantB]]).catch(() => {});
    await adminPool.query("DELETE FROM tenants WHERE tenant_id = ANY($1::text[])", [[tenantA, tenantB]]).catch(() => {});
    await adminPool.end();
  }
});

function rewriteRole(connectionString, role) {
  const url = new URL(connectionString);
  url.username = role;
  url.password = "";
  return url.toString();
}
