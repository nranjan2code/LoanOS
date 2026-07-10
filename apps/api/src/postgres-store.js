// Postgres-backed implementation of the same load/save/lock boundary that
// file-store.js provides over a local JSON file. See db/schema.sql for the
// schema and the row-level-security design this module relies on.
//
// Scope of this v1 migration (deliberately bounded — see
// docs/architecture/postgres-migration.md for the full rationale):
//
//   - `loadState`/`saveState` return and accept the EXACT SAME `{ version,
//     controlPlane, tenants }` shape file-store.js's `loadState`/`saveState`
//     do, so every pure function in file-store.js that operates on that
//     in-memory shape (registerTenant, grantBreakGlass, offboardTenant,
//     buildTenantExport, ...) and every call site in server.js keeps working
//     completely unchanged. Swapping the storage driver is a one-line import
//     change, not a rewrite of the request-handling code.
//   - `withStateLock` is re-implemented with a Postgres advisory lock (via
//     `pg_advisory_xact_lock`, transaction-scoped so a crashed process can
//     never leave a lock held) instead of an in-process `Map` of promises.
//     This is a genuine improvement over the file store even at v1's
//     "one global lock" granularity: the lock now works across multiple
//     application processes/instances, not just within one Node process —
//     which the file-backed lock explicitly cannot do.
//   - Tenant data-plane documents live in `tenant_data`, one JSONB row per
//     tenant, under Postgres Row-Level Security (see db/schema.sql). This
//     module's whole-state load/save intentionally reads and writes that
//     table through a role/session that is NOT scoped by RLS (the same
//     "control plane" authority the application already grants a platform
//     admin key/session at the application layer) — RLS is not bypassed for
//     security theater; it exists so that ANY OTHER connection to this
//     database (a different service, an analyst's read-only role, a future
//     microservice split off from this monolith) gets real, database-
//     enforced tenant isolation by default, without having to re-implement
//     this module's care around which rows to touch.
//   - Deliberately NOT implemented in v1: per-tenant-scoped loading/locking
//     (only fetching/locking the one tenant a request actually touches,
//     instead of the whole tenant_data table on every request). That
//     optimization requires restructuring server.js's `route()` dispatcher,
//     which is exercised by the entire test suite end-to-end; making that
//     change safely needs its own focused pass with a live database to
//     verify against, not a same-session bundled change. Tracked as a v2
//     follow-up in docs/architecture/postgres-migration.md.
//
// This module is loaded only when LOANOS_STORAGE_DRIVER=postgres. It has NOT
// been exercised against a live Postgres instance in this environment (none
// was available) — the accompanying tests/postgres-store.test.js integration
// suite is written to run against a real database (set DATABASE_URL_TEST)
// and must pass before this driver is used in any real deployment.

import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import {
  createEmptyTenantData,
  normalizeState as fileStoreNormalizeState
} from "./file-store.js";

const { Pool } = pg;

let pool = null;

export function getPool(connectionString = process.env.DATABASE_URL) {
  // Reuse an already-created pool (e.g. via resetPoolForTests) before
  // requiring a connection string — every call site after the first legitimately
  // omits the argument and relies on DATABASE_URL/an already-configured pool.
  if (pool) {
    return pool;
  }
  if (!connectionString) {
    throw new Error("DATABASE_URL is required when LOANOS_STORAGE_DRIVER=postgres.");
  }
  pool = new Pool({ connectionString });
  return pool;
}

// Only for tests: forces a fresh pool against a possibly different
// connection string, and closes the previous one.
export async function resetPoolForTests(connectionString) {
  if (pool) {
    await pool.end();
    pool = null;
  }
  return getPool(connectionString);
}

// withStateLock() opens one transaction + advisory lock for the whole
// load-modify-save span of a request, and stashes the live client here so
// loadState()/saveState() called anywhere inside that span (without a client
// threaded through every call site in server.js) reuse the SAME transaction,
// instead of each opening — and needing to coordinate — their own.
const requestContext = new AsyncLocalStorage();

// A single, fixed advisory-lock key for v1's "one global lock" granularity
// (see the module-level comment above: per-tenant locking is a v2 follow-up).
// pg_advisory_xact_lock takes a bigint; hashtext() derives a stable one from
// a label so multiple LoanOS deployments sharing infrastructure conventions
// don't collide by accident.
const GLOBAL_LOCK_LABEL = "loanos:state";

export async function withStateLock(_dataDir, fn) {
  const existing = requestContext.getStore();
  if (existing) {
    // Re-entrant call within the same request span (server.js's route()
    // itself only calls this once per request, but tests or future code
    // paths might nest) — reuse the existing transaction/client rather than
    // deadlocking on our own advisory lock.
    return fn();
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [GLOBAL_LOCK_LABEL]);
    const result = await requestContext.run({ client }, fn);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function currentClient() {
  const store = requestContext.getStore();
  if (!store) {
    throw new Error(
      "postgres-store: loadState/saveState called outside withStateLock. Every request must be wrapped in withStateLock() before touching storage."
    );
  }
  return store.client;
}

// ─── Row <-> in-memory-shape mapping ───────────────────────────────────────

function tenantRowToRecord(row) {
  return {
    tenantId: row.tenant_id,
    name: row.name,
    apiKeyHash: row.api_key_hash,
    isolationTier: row.isolation_tier,
    status: row.status,
    isSandbox: row.is_sandbox,
    parentTenantId: row.parent_tenant_id,
    sandboxName: row.sandbox_name,
    onboarding: row.onboarding ?? {},
    offboarding: row.offboarding ?? undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function recordToTenantRow(record) {
  return {
    tenant_id: record.tenantId,
    name: record.name ?? record.tenantId,
    api_key_hash: record.apiKeyHash ?? null,
    isolation_tier: record.isolationTier ?? "pooled",
    status: record.status ?? "active",
    is_sandbox: Boolean(record.isSandbox),
    parent_tenant_id: record.parentTenantId ?? null,
    sandbox_name: record.sandboxName ?? null,
    onboarding: JSON.stringify(record.onboarding ?? {}),
    offboarding: record.offboarding ? JSON.stringify(record.offboarding) : null,
    created_at: record.createdAt ?? new Date().toISOString(),
    updated_at: record.updatedAt ?? new Date().toISOString()
  };
}

async function loadControlPlane(client) {
  // A single connection (client, checked out from the pool for this one
  // request's transaction) can only run one query at a time — Promise.all
  // here would fire all eight down the same socket concurrently, which the
  // pg driver rejects (or at best, silently serializes with a deprecation
  // warning; multi-statement pipelining is not something this driver
  // version supports safely). Sequential awaits are correct and, since this
  // is one connection either way, no slower than a would-be-parallel version
  // actually could have been.
  const tenantsResult = await client.query("SELECT * FROM tenants");
  const platformUsersResult = await client.query("SELECT * FROM platform_users");
  const sessionsResult = await client.query("SELECT * FROM sessions");
  const loginAttemptsResult = await client.query("SELECT * FROM login_attempts");
  const platformEventsResult = await client.query(
    "SELECT sequence, event_id, occurred_at, previous_hash, hash, payload FROM platform_audit_events ORDER BY sequence ASC"
  );
  const subProcessorsResult = await client.query("SELECT * FROM sub_processors");
  const breakGlassResult = await client.query("SELECT * FROM break_glass_grants");
  const ckycResult = await client.query("SELECT * FROM ckyc_registry");

  const tenants = {};
  for (const row of tenantsResult.rows) {
    tenants[row.tenant_id] = tenantRowToRecord(row);
  }

  const platformUsers = {};
  for (const row of platformUsersResult.rows) {
    platformUsers[row.user_id] = row.record;
  }

  const sessions = {};
  for (const row of sessionsResult.rows) {
    sessions[row.session_id] = row.record;
  }

  const loginAttempts = {};
  for (const row of loginAttemptsResult.rows) {
    loginAttempts[row.attempt_key] = row.record;
  }

  const platformEvents = platformEventsResult.rows.map((row) => ({
    ...row.payload,
    sequence: Number(row.sequence),
    eventId: row.event_id,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
    previousHash: row.previous_hash,
    hash: row.hash
  }));

  const subProcessors = {};
  for (const row of subProcessorsResult.rows) {
    subProcessors[row.sub_processor_id] = row.record;
  }

  const breakGlassGrants = {};
  for (const row of breakGlassResult.rows) {
    breakGlassGrants[row.grant_id] = row.record;
  }

  const ckycRegistry = {};
  for (const row of ckycResult.rows) {
    ckycRegistry[row.identifier] = row.record;
  }

  return {
    tenants,
    platformUsers,
    sessions,
    loginAttempts,
    platformEvents,
    subProcessors,
    breakGlassGrants,
    ckycRegistry
  };
}

// v1's whole-state load also fetches every tenant's data-plane document, via
// this control-plane connection — deliberately not RLS-scoped (see the
// module-level comment on why that's a documented, bounded v1 tradeoff, not
// an oversight).
async function loadAllTenantData(client) {
  const result = await client.query("SELECT tenant_id, data FROM tenant_data");
  const tenants = {};
  for (const row of result.rows) {
    tenants[row.tenant_id] = row.data;
  }
  return tenants;
}

export async function loadState(_dataDirIgnored) {
  const client = currentClient();
  // Sequential, not Promise.all: both functions issue queries against the
  // same single connection (see the comment in loadControlPlane).
  const controlPlane = await loadControlPlane(client);
  const tenantData = await loadAllTenantData(client);
  return fileStoreNormalizeState({
    version: undefined,
    controlPlane: {
      tenants: controlPlane.tenants,
      subProcessors: controlPlane.subProcessors,
      breakGlassGrants: controlPlane.breakGlassGrants,
      platformUsers: controlPlane.platformUsers,
      sessions: controlPlane.sessions,
      loginAttempts: controlPlane.loginAttempts,
      platformEvents: controlPlane.platformEvents,
      ckycRegistry: controlPlane.ckycRegistry
    },
    tenants: tenantData
  });
}

export async function saveState(state, _dataDirIgnored) {
  const client = currentClient();
  const normalized = fileStoreNormalizeState(state);

  // Tenant registry (control-plane metadata only — not the data-plane
  // document, which is upserted separately below).
  for (const record of Object.values(normalized.controlPlane.tenants)) {
    const row = recordToTenantRow(record);
    await client.query(
      `INSERT INTO tenants (tenant_id, name, api_key_hash, isolation_tier, status, is_sandbox, parent_tenant_id, sandbox_name, onboarding, offboarding, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)
       ON CONFLICT (tenant_id) DO UPDATE SET
         name = EXCLUDED.name,
         api_key_hash = EXCLUDED.api_key_hash,
         isolation_tier = EXCLUDED.isolation_tier,
         status = EXCLUDED.status,
         is_sandbox = EXCLUDED.is_sandbox,
         parent_tenant_id = EXCLUDED.parent_tenant_id,
         sandbox_name = EXCLUDED.sandbox_name,
         onboarding = EXCLUDED.onboarding,
         offboarding = EXCLUDED.offboarding,
         updated_at = EXCLUDED.updated_at`,
      [
        row.tenant_id,
        row.name,
        row.api_key_hash,
        row.isolation_tier,
        row.status,
        row.is_sandbox,
        row.parent_tenant_id,
        row.sandbox_name,
        row.onboarding,
        row.offboarding,
        row.created_at,
        row.updated_at
      ]
    );
  }

  // Tenant registry rows that existed before this save but are no longer
  // present (offboardTenant() in file-store.js deletes the key from
  // state.controlPlane.tenants entirely rather than marking it) must be
  // removed too, or a deleted tenant would silently reappear on next load.
  const currentTenantIds = Object.keys(normalized.controlPlane.tenants);
  await client.query(
    currentTenantIds.length > 0
      ? "DELETE FROM tenants WHERE tenant_id <> ALL($1::text[])"
      : "DELETE FROM tenants",
    currentTenantIds.length > 0 ? [currentTenantIds] : []
  );

  // Tenant data-plane documents.
  for (const [tenantId, data] of Object.entries(normalized.tenants)) {
    await client.query(
      `INSERT INTO tenant_data (tenant_id, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [tenantId, JSON.stringify(data ?? createEmptyTenantData())]
    );
  }
  const currentDataTenantIds = Object.keys(normalized.tenants);
  await client.query(
    currentDataTenantIds.length > 0
      ? "DELETE FROM tenant_data WHERE tenant_id <> ALL($1::text[])"
      : "DELETE FROM tenant_data",
    currentDataTenantIds.length > 0 ? [currentDataTenantIds] : []
  );

  await upsertKeyedTable(client, "platform_users", "user_id", normalized.controlPlane.platformUsers);
  await upsertKeyedTable(client, "sessions", "session_id", normalized.controlPlane.sessions, (session) => ({
    token_hash: session.tokenHash,
    principal_type: session.principalType,
    tenant_id: session.tenantId,
    expires_at: session.expiresAt
  }));
  await upsertKeyedTable(client, "login_attempts", "attempt_key", normalized.controlPlane.loginAttempts);
  await upsertKeyedTable(client, "sub_processors", "sub_processor_id", normalized.controlPlane.subProcessors);
  await upsertKeyedTable(client, "break_glass_grants", "grant_id", normalized.controlPlane.breakGlassGrants, (grant) => ({
    tenant_id: grant.tenantId,
    credential_hash: grant.credentialHash
  }));
  await upsertKeyedTable(client, "ckyc_registry", "identifier", normalized.controlPlane.ckycRegistry);

  // Platform audit events are append-only (the table itself enforces this
  // with a trigger — see db/schema.sql): only insert events not already
  // persisted, identified by eventId, and never touch existing rows.
  const existingEventIds = new Set(
    (await client.query("SELECT event_id FROM platform_audit_events")).rows.map((row) => row.event_id)
  );
  for (const event of normalized.controlPlane.platformEvents) {
    if (existingEventIds.has(event.eventId)) continue;
    const { sequence, eventId, occurredAt, previousHash, hash, ...payload } = event;
    await client.query(
      `INSERT INTO platform_audit_events (sequence, event_id, occurred_at, previous_hash, hash, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (sequence) DO NOTHING`,
      [sequence, eventId, occurredAt, previousHash, hash, JSON.stringify(payload)]
    );
  }
}

async function upsertKeyedTable(client, table, keyColumn, recordMap, extraColumns) {
  for (const [key, record] of Object.entries(recordMap ?? {})) {
    const extra = extraColumns ? extraColumns(record) : {};
    const extraKeys = Object.keys(extra);
    const columns = [keyColumn, "record", ...extraKeys];
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const updateAssignments = columns
      .filter((column) => column !== keyColumn)
      .map((column) => `${column} = EXCLUDED.${column}`)
      .join(", ");
    const values = [key, JSON.stringify(record), ...extraKeys.map((column) => extra[column])];
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})
       ON CONFLICT (${keyColumn}) DO UPDATE SET ${updateAssignments}`,
      values
    );
  }
  const currentKeys = Object.keys(recordMap ?? {});
  await client.query(
    currentKeys.length > 0
      ? `DELETE FROM ${table} WHERE ${keyColumn} <> ALL($1::text[])`
      : `DELETE FROM ${table}`,
    currentKeys.length > 0 ? [currentKeys] : []
  );
}

// Delegates to file-store.js's ensureBootstrapTenants — the seeding logic
// itself (idempotent tenant registration, the "dev" tenant's demo data) is
// real, tested behavior that must not be re-implemented a second time here;
// only *which* load/save it round-trips through changes. withStateLock
// wraps the whole span in one transaction + advisory lock, matching how
// server.js already wraps every request.
export async function ensureBootstrapTenants(dataDir, bootstrapTenants = []) {
  if (!bootstrapTenants.length) {
    return;
  }
  const { ensureBootstrapTenants: fileStoreEnsureBootstrapTenants } = await import("./file-store.js");
  await withStateLock(dataDir, () =>
    fileStoreEnsureBootstrapTenants(dataDir, bootstrapTenants, { loadStateFn: loadState, saveStateFn: saveState })
  );
}
