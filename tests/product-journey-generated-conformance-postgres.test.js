import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PRODUCT_JOURNEY_TYPES,
  buildProductJourneyGeneratedConformanceMatrix,
  runProductJourneyGeneratedConformance,
  saveJourneyWorkspaceDraft
} from "@loanos/core";

const DATABASE_URL_TEST = process.env.DATABASE_URL_TEST;
const skip = !DATABASE_URL_TEST && "DATABASE_URL_TEST is not set — PostgreSQL/RLS JD-05 lane requires a disposable database.";

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
      await postgresStore.saveTenantDataOnly("ignored", tenantA, state);
    });

    const recoveredA = await postgresStore.withStateLock("ignored", tenantA, () => postgresStore.loadTenantDataOnly("ignored", tenantA));
    const isolatedB = await postgresStore.withStateLock("ignored", tenantB, () => postgresStore.loadTenantDataOnly("ignored", tenantB));
    assert.equal(Object.keys(recoveredA.journeyWorkspaceDrafts).length, 21);
    assert.deepEqual(new Set(Object.values(recoveredA.journeyWorkspaceDrafts).map((item) => item.journeyType)), new Set(PRODUCT_JOURNEY_TYPES));
    assert.equal(Object.keys(isolatedB.journeyWorkspaceDrafts).length, 0);

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

    const matrix = buildProductJourneyGeneratedConformanceMatrix({ lanes: ["postgres_rls"] });
    const exercised = new Set(["JRN-COM-001", "JRN-COM-005", "JRN-COM-007", "JRN-COM-015"]);
    const run = await runProductJourneyGeneratedConformance({
      matrix,
      select: (item) => exercised.has(item.scenarioId),
      executors: { postgres_rls: async (item) => ({ outcome: "passed", evidenceRef: `postgres-test://${runToken}/${item.journeyType}/${item.scenarioId}` }) }
    });
    assert.equal(run.summary.selectedCaseCount, 21 * exercised.size);
    assert.equal(run.summary.allPassed, true);
    assert.equal(run.summary.productionReady, false);
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
