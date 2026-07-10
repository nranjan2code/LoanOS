// Integration tests for the Postgres storage driver (apps/api/src/postgres-store.js).
//
// These require a real, reachable Postgres database and are NOT run by
// `npm test` in this repository's default/CI environment — `npm test`
// globs `tests/*.test.js`, so this file participates in that glob, but
// every test in it self-skips (via node:test's `{ skip }` option) unless
// DATABASE_URL_TEST is set. This mirrors standard practice for integration
// tests that depend on infrastructure the unit-test environment doesn't
// have: the file is real, complete, and runnable, but does not block or
// slow down `npm test` in an environment with no Postgres (this sandbox
// included — these tests have NOT been executed here; run them against a
// real database before trusting the postgres driver in any deployment).
//
// To run:
//   1. Provision a scratch Postgres database.
//   2. psql "$DATABASE_URL_TEST" -f db/schema.sql   (run as a superuser/owner;
//      creates the loanos_app role, tables, RLS policies)
//   3. Ensure DATABASE_URL_TEST's role can authenticate (schema.sql creates
//      loanos_app with LOGIN but no password — either set one with
//      ALTER ROLE, or use a connection string whose auth method doesn't
//      need one, e.g. local trust auth for a disposable test DB).
//   4. DATABASE_URL_TEST=postgres://loanos_app@localhost/loanos_test npm test

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const DATABASE_URL_TEST = process.env.DATABASE_URL_TEST;
const describeSkip = !DATABASE_URL_TEST;
const skipReason = "DATABASE_URL_TEST is not set — see this file's header for how to run these against a real database.";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function applySchema(pool) {
  const schemaSql = await readFile(join(__dirname, "..", "db", "schema.sql"), "utf8");
  await pool.query(schemaSql);
}

// All tables in an order that respects foreign keys (children before
// parents), so each test starts from a known-empty database.
const TABLES_IN_TRUNCATE_ORDER = [
  "tenant_data",
  "break_glass_grants",
  "sessions",
  "platform_audit_events",
  "sub_processors",
  "login_attempts",
  "platform_users",
  "ckyc_registry",
  "tenants"
];

async function resetDatabase(pool) {
  await pool.query(`TRUNCATE ${TABLES_IN_TRUNCATE_ORDER.join(", ")} RESTART IDENTITY CASCADE`);
}

test("postgres schema applies cleanly and RLS blocks cross-tenant visibility", { skip: describeSkip && skipReason }, async (t) => {
  const pg = await import("pg");
  const { Pool } = pg.default;
  const adminPool = new Pool({ connectionString: DATABASE_URL_TEST });
  t.after(() => adminPool.end());

  await applySchema(adminPool);
  await resetDatabase(adminPool);

  await adminPool.query(
    `INSERT INTO tenants (tenant_id, name, api_key_hash, onboarding) VALUES ($1, $2, $3, '{}'::jsonb), ($4, $5, $6, '{}'::jsonb)`,
    ["tnt_pg_a", "Tenant A", "hash_a", "tnt_pg_b", "Tenant B", "hash_b"]
  );
  await adminPool.query(
    `INSERT INTO tenant_data (tenant_id, data) VALUES ($1, $2::jsonb), ($3, $4::jsonb)`,
    ["tnt_pg_a", JSON.stringify({ secret: "A's data" }), "tnt_pg_b", JSON.stringify({ secret: "B's data" })]
  );

  // Connect as loanos_control_plane (what the application actually
  // authenticates as — loanos_app is NOLOGIN, only reachable via SET ROLE;
  // see db/schema.sql) and switch to loanos_app for the RLS-scoped portion,
  // exactly mirroring withTenantRole() in postgres-store.js.
  const appPool = new Pool({ connectionString: rewriteRole(DATABASE_URL_TEST, "loanos_control_plane") });
  const client = await appPool.connect();
  // Deliberately NOT using t.after() for the client/pool pair: pool.end()
  // blocks until every checked-out client is released, and node:test does
  // not guarantee after-hooks run in reverse-registration order — if
  // appPool.end() ran before client.release(), this test would hang
  // forever. Releasing explicitly, in order, in `finally` sidesteps that
  // entirely.
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE loanos_app");

    // No tenant context set at all: RLS's `current_setting(..., true)`
    // returns NULL, and `tenant_id = NULL` is never true in SQL — this
    // session must see zero rows, proving there is no default-open state.
    const noContext = await client.query("SELECT tenant_id FROM tenant_data");
    assert.equal(noContext.rows.length, 0);

    // SET LOCAL does not accept bind parameters ($1) — Postgres's SET
    // command needs a literal or identifier, not a query parameter, so a
    // dynamic value must go through set_config()'s third (is_local) arg
    // instead, which is fully parameterizable and behaves identically.
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", ["tnt_pg_a"]);
    const scopedToA = await client.query("SELECT tenant_id, data FROM tenant_data");
    assert.equal(scopedToA.rows.length, 1);
    assert.equal(scopedToA.rows[0].tenant_id, "tnt_pg_a");
    assert.equal(scopedToA.rows[0].data.secret, "A's data");

    // A write attempt against tenant B's row while scoped to tenant A must
    // affect zero rows (WITH CHECK + USING both reference the session
    // variable), not silently succeed or error in a way that leaks B's data.
    const crossTenantWrite = await client.query(
      "UPDATE tenant_data SET data = '{}'::jsonb WHERE tenant_id = $1",
      ["tnt_pg_b"]
    );
    assert.equal(crossTenantWrite.rowCount, 0);
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await appPool.end();
  }
});

test("loanos_control_plane bypasses RLS directly (whole-state control-plane operations need this)", { skip: describeSkip && skipReason }, async (t) => {
  const pg = await import("pg");
  const { Pool } = pg.default;
  const adminPool = new Pool({ connectionString: DATABASE_URL_TEST });
  t.after(() => adminPool.end());
  await applySchema(adminPool);
  await resetDatabase(adminPool);

  await adminPool.query(
    `INSERT INTO tenants (tenant_id, name, api_key_hash, onboarding) VALUES ($1, $2, $3, '{}'::jsonb), ($4, $5, $6, '{}'::jsonb)`,
    ["tnt_pg_a", "Tenant A", "hash_a", "tnt_pg_b", "Tenant B", "hash_b"]
  );
  await adminPool.query(
    `INSERT INTO tenant_data (tenant_id, data) VALUES ($1, $2::jsonb), ($3, $4::jsonb)`,
    ["tnt_pg_a", JSON.stringify({ secret: "A's data" }), "tnt_pg_b", JSON.stringify({ secret: "B's data" })]
  );

  // Without ever switching role or setting app.current_tenant_id,
  // loanos_control_plane (BYPASSRLS) must see every tenant's row — this is
  // what routePlatform/routeAuth's whole-state loadState/saveState rely on
  // to legitimately span tenants (tenant provisioning, export, offboarding).
  const controlPlanePool = new Pool({ connectionString: rewriteRole(DATABASE_URL_TEST, "loanos_control_plane") });
  t.after(() => controlPlanePool.end());
  const result = await controlPlanePool.query("SELECT tenant_id FROM tenant_data ORDER BY tenant_id");
  assert.deepEqual(result.rows.map((row) => row.tenant_id), ["tnt_pg_a", "tnt_pg_b"]);
});

test("withStateLock serializes concurrent state mutations via a Postgres advisory lock", { skip: describeSkip && skipReason }, async (t) => {
  const postgresStore = await import("../apps/api/src/postgres-store.js");
  await postgresStore.resetPoolForTests(DATABASE_URL_TEST);
  const pg = await import("pg");
  const { Pool } = pg.default;
  const adminPool = new Pool({ connectionString: DATABASE_URL_TEST });
  t.after(() => adminPool.end());
  await applySchema(adminPool);
  await resetDatabase(adminPool);
  t.after(() => postgresStore.resetPoolForTests(DATABASE_URL_TEST));

  // A non-atomic read-increment-write against a plain JS variable: if two
  // concurrent withStateLock() calls interleave, both read 0 before either
  // writes 1, and the final value is 1 instead of 2. If the lock genuinely
  // serializes them, the final value is deterministically 2.
  let sharedCounter = 0;
  async function incrementUnderLock(lockKey) {
    return postgresStore.withStateLock("ignored", lockKey, async () => {
      const observed = sharedCounter;
      await new Promise((resolve) => setTimeout(resolve, 20));
      sharedCounter = observed + 1;
    });
  }

  await Promise.all([incrementUnderLock("same-key"), incrementUnderLock("same-key")]);
  assert.equal(sharedCounter, 2);
});

test("withStateLock does not serialize callers using different lock keys", { skip: describeSkip && skipReason }, async (t) => {
  const postgresStore = await import("../apps/api/src/postgres-store.js");
  await postgresStore.resetPoolForTests(DATABASE_URL_TEST);
  t.after(() => postgresStore.resetPoolForTests(DATABASE_URL_TEST));

  // The whole point of tenant-scoped locking (v2): two callers using
  // *different* lock keys (as two different tenants' requests would) must
  // run concurrently, not queue behind each other. Prove it directly by
  // timing two 150ms-held locks under different keys and asserting the
  // total wall-clock time is close to one hold, not the sum of both — the
  // sum would mean they serialized despite using different keys.
  async function holdLockFor(lockKey, ms) {
    return postgresStore.withStateLock("ignored", lockKey, async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  const startedAt = Date.now();
  await Promise.all([holdLockFor("tenant_x", 150), holdLockFor("tenant_y", 150)]);
  const elapsedMs = Date.now() - startedAt;

  // Serialized would take >=300ms; concurrent should land close to 150ms.
  // A generous ceiling (250ms) absorbs scheduling/connection-setup jitter
  // without being loose enough to pass if they'd actually serialized.
  assert(elapsedMs < 250, `expected concurrent locks to overlap, took ${elapsedMs}ms`);
});

test("storage.js with LOANOS_STORAGE_DRIVER=postgres serves a full multi-tenant API round-trip", { skip: describeSkip && skipReason }, async (t) => {
  const pg = await import("pg");
  const { Pool } = pg.default;
  const adminPool = new Pool({ connectionString: DATABASE_URL_TEST });
  t.after(() => adminPool.end());
  await applySchema(adminPool);
  await resetDatabase(adminPool);

  const previousDriver = process.env.LOANOS_STORAGE_DRIVER;
  const previousUrl = process.env.DATABASE_URL;
  process.env.LOANOS_STORAGE_DRIVER = "postgres";
  // The running server must connect as `loanos_control_plane` — the role it
  // actually runs as in production — NOT the admin/superuser connection
  // used above for schema setup and fixtures. Connecting as the superuser
  // here would silently mask a broken/missing GRANT loanos_app TO
  // loanos_control_plane (superusers can SET ROLE to anything regardless of
  // membership), which is exactly the kind of gap this test exists to catch.
  process.env.DATABASE_URL = rewriteRole(DATABASE_URL_TEST, "loanos_control_plane");
  t.after(() => {
    process.env.LOANOS_STORAGE_DRIVER = previousDriver;
    process.env.DATABASE_URL = previousUrl;
  });

  // Import after setting env vars: storage.js reads LOANOS_STORAGE_DRIVER at
  // module-evaluation time, so this must be a fresh module graph — Node's
  // ESM cache means a bare `import` here would reuse whatever storage.js
  // instance a prior (file-driver) test already loaded. Cache-busting via a
  // unique query string forces a fresh evaluation with today's env vars.
  const { createLoanOsServer } = await import(`../apps/api/src/server.js?postgres-test=${Date.now()}`);

  const server = createLoanOsServer({
    dataDir: "ignored-by-postgres-driver",
    bootstrapTenants: [
      { tenantId: "tnt_pg_isolation_a", name: "PG Tenant A", apiKey: "pg-test-key-a" },
      { tenantId: "tnt_pg_isolation_b", name: "PG Tenant B", apiKey: "pg-test-key-b" }
    ]
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;

  const createResponse = await fetch(`${base}/borrowers`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "pg-test-key-a" },
    body: JSON.stringify({
      borrowerId: "pg_borrower_1",
      borrowerType: "individual",
      fullName: "PG Test Borrower",
      dateOfBirth: "1990-01-01",
      residencyCountry: "IN",
      primaryAddressCountry: "IN",
      primaryAddress: "1 Test Lane",
      contact: { mobile: "+919999999999" },
      economicProfile: { occupation: "salaried", monthlyIncome: 50000 },
      status: "active"
    })
  });
  assert.equal(createResponse.status, 201);

  // Tenant B, a completely different tenant provisioned in the same
  // database, must not see tenant A's borrower — the RLS-independent,
  // application-level isolation check (the same invariant compliance.test.js
  // proves for the file driver) must hold identically over Postgres.
  const crossTenantRead = await fetch(`${base}/borrowers/pg_borrower_1`, {
    headers: { "x-api-key": "pg-test-key-b" }
  });
  assert.equal(crossTenantRead.status, 404);

  const ownTenantRead = await fetch(`${base}/borrowers/pg_borrower_1`, {
    headers: { "x-api-key": "pg-test-key-a" }
  });
  assert.equal(ownTenantRead.status, 200);
  const borrower = await ownTenantRead.json();
  assert.equal(borrower.borrowerId, "pg_borrower_1");

  // Confirm the data actually landed in Postgres (not silently still using
  // the file driver due to a wiring mistake) by reading the row directly.
  const directRow = await adminPool.query("SELECT data FROM tenant_data WHERE tenant_id = $1", [
    "tnt_pg_isolation_a"
  ]);
  assert.equal(directRow.rows.length, 1);
  assert(directRow.rows[0].data.borrowerProfiles?.pg_borrower_1);
});

function rewriteRole(connectionString, role) {
  const url = new URL(connectionString);
  url.username = role;
  url.password = "";
  return url.toString();
}
