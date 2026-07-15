// Postgres-backed implementation of the same load/save/lock boundary that
// file-store.js provides over a local JSON file. See db/schema.sql for the
// schema and the row-level-security design this module relies on, and
// docs/architecture/postgres-migration.md for the full v1/v2 rationale.
//
//   - `loadState`/`saveState` return and accept the EXACT SAME `{ version,
//     controlPlane, tenants }` shape file-store.js's `loadState`/`saveState`
//     do, so every pure function in file-store.js that operates on that
//     in-memory shape (registerTenant, grantBreakGlass, offboardTenant,
//     buildTenantExport, ...) and every call site in server.js keeps working
//     completely unchanged. Swapping the storage driver is a one-line import
//     change, not a rewrite of the request-handling code.
//   - `withStateLock` takes a lock key (v2): callers resolve which tenant a
//     request belongs to *before* any lock is taken (see resolveLockKey in
//     server.js, which uses peekControlPlaneState below to do that
//     lock-free) and pass the tenantId through, so concurrent requests for
//     *different* tenants serialize under *different* Postgres advisory
//     locks instead of all queuing behind one process-wide lock — verified
//     directly in tests/postgres-store.test.js ("does not serialize callers
//     using different lock keys"). Control-plane routes (tenant
//     provisioning, break-glass, sub-processor registration), whose writes
//     aren't confined to one tenant's row, still use GLOBAL_LOCK_LABEL.
//     `pg_advisory_xact_lock` is transaction-scoped, so a crashed process
//     can never leave a lock held — a further improvement over the file
//     store's in-process `Map`, which also only ever worked within one
//     Node process to begin with.
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
//   - Per-tenant-scoped *fetching* (v3): `loadControlPlaneOnly`/
//     `loadTenantDataOnly`/`saveTenantDataOnly`/`saveControlPlaneOnly` are
//     what server.js's route() dispatcher actually calls now, instead of
//     the whole-state `loadState`/`saveState` above — a request fetches and
//     writes exactly the tenant it's scoped to, not every tenant's data on
//     every call. `loadState`/`saveState` remain in active use for
//     routePlatform/routeAuth's control-plane operations (tenant
//     provisioning, break-glass, sub-processor registration, sandbox
//     management), which legitimately span tenants by design. The
//     per-tenant functions genuinely enforce RLS — they run under
//     `SET LOCAL ROLE loanos_app` (see withTenantRole below), switched from
//     the connection's base role, `loanos_control_plane`, which the
//     whole-state functions run as directly (BYPASSRLS — see the role
//     comment in db/schema.sql for why that's a deliberate, scoped
//     privilege mirroring what a platform admin already has at the
//     application layer, not an RLS bypass for convenience).
//
// This module is loaded only when LOANOS_STORAGE_DRIVER=postgres. It has
// been exercised against a live PostgreSQL 18 instance (see
// tests/postgres-store.test.js, which self-skips without DATABASE_URL_TEST)
// — run that suite against your own target environment before trusting this
// driver in any deployment; different Postgres versions/hosting can behave
// differently around session variables and advisory locks.

import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import {
  createEmptyTenantData,
  normalizeState as fileStoreNormalizeState
} from "./file-store.js";
import {
  decryptTenantData,
  encryptTenantData,
  getActiveMasterKey,
  getMasterKeyById,
  isEncryptedEnvelope
} from "./encryption.js";

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

// Fallback advisory-lock key for callers with no specific tenant to scope
// to (control-plane routes, bootstrap, or a request whose tenant couldn't be
// resolved) — these still need to serialize against each other and against
// the whole-state loadState/saveState pattern's control-plane writes.
// pg_advisory_xact_lock takes a bigint; hashtext() derives a stable one from
// a label so multiple LoanOS deployments sharing infrastructure conventions
// don't collide by accident.
export const GLOBAL_LOCK_LABEL = "loanos:state";

// v2: the caller picks a lockKey — typically the resolved tenantId — so
// concurrent requests for *different* tenants no longer serialize behind one
// process-wide lock the way the file driver's withStateLock necessarily
// does. Requests that legitimately touch more than one tenant at a time
// (tenant provisioning, break-glass grant issuance, sub-processor
// registration — anything routed through routePlatform/routeAuth) pass
// GLOBAL_LOCK_LABEL instead, since their writes aren't confined to one
// tenant's row. See docs/architecture/postgres-migration.md for how the
// lock key is chosen before this is called.
export async function withStateLock(_dataDir, lockKey, fn) {
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
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey ?? GLOBAL_LOCK_LABEL]);
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
    serviceCredentials: row.service_credentials ?? {},
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
    service_credentials: JSON.stringify(record.serviceCredentials ?? {}),
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
  const signupsResult = await client.query("SELECT * FROM organisation_signups");
  const signupRateLimitsResult = await client.query("SELECT * FROM organisation_signup_rate_limits");
  const federationChallengesResult = await client.query("SELECT * FROM federation_login_challenges");

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

  const organisationSignups = {};
  for (const row of signupsResult.rows) {
    organisationSignups[row.signup_id] = row.record;
  }

  const organisationSignupRateLimits = {};
  for (const row of signupRateLimitsResult.rows) {
    organisationSignupRateLimits[row.email_hash] = row.record;
  }

  const federationLoginChallenges = {};
  for (const row of federationChallengesResult.rows) {
    federationLoginChallenges[row.challenge_key] = row.record;
  }

  return {
    tenants,
    platformUsers,
    sessions,
    loginAttempts,
    platformEvents,
    subProcessors,
    breakGlassGrants,
    ckycRegistry,
    organisationSignups,
    organisationSignupRateLimits,
    federationLoginChallenges
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
    tenants[row.tenant_id] = decodePostgresTenantData(row.tenant_id, row.data);
  }
  return tenants;
}

function assembleState(controlPlane, tenants) {
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
      ckycRegistry: controlPlane.ckycRegistry,
      organisationSignups: controlPlane.organisationSignups ?? {},
      organisationSignupRateLimits: controlPlane.organisationSignupRateLimits ?? {},
      federationLoginChallenges: controlPlane.federationLoginChallenges ?? {}
    },
    tenants
  });
}

export async function loadState(_dataDirIgnored) {
  const client = currentClient();
  // Sequential, not Promise.all: both functions issue queries against the
  // same single connection (see the comment in loadControlPlane).
  const controlPlane = await loadControlPlane(client);
  const tenantData = await loadAllTenantData(client);
  return assembleState(controlPlane, tenantData);
}

// A lock-free, control-plane-only snapshot (no tenant_data at all) used
// solely by server.js's resolveLockKey to pick which advisory-lock key a
// request should serialize under, BEFORE any lock is taken. It intentionally
// does not go through withStateLock/currentClient() — it needs no
// transaction or lock of its own (it's a read of data nothing here ever
// mutates outside a real, separately-locked control-plane save), and
// skipping the tenant_data fetch is what makes the probe cheap. It is NOT a
// substitute for loadState()'s real, authoritative read, which route() still
// performs for-real under the request's actual lock.
export async function peekControlPlaneState() {
  const client = await getPool().connect();
  try {
    const controlPlane = await loadControlPlane(client);
    return assembleState(controlPlane, {});
  } finally {
    client.release();
  }
}

export async function saveState(state, _dataDirIgnored) {
  const client = currentClient();
  const normalized = fileStoreNormalizeState(state);
  await persistControlPlane(client, normalized.controlPlane);
  await persistAllTenantData(client, normalized.tenants);
}

// The full control-plane persistence — tenant registry, sessions, platform
// users, etc. — factored out so saveControlPlaneOnly (v3) can reuse it
// without also touching tenant_data, and so saveState (the whole-state path
// still used by routePlatform/routeAuth) doesn't duplicate the logic.
async function persistControlPlane(client, controlPlane) {
  // Tenant registry (control-plane metadata only — not the data-plane
  // document, which lives in tenant_data and is persisted separately).
  for (const record of Object.values(controlPlane.tenants)) {
    const row = recordToTenantRow(record);
    await client.query(
      `INSERT INTO tenants (tenant_id, name, api_key_hash, service_credentials, isolation_tier, status, is_sandbox, parent_tenant_id, sandbox_name, onboarding, offboarding, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13)
       ON CONFLICT (tenant_id) DO UPDATE SET
         name = EXCLUDED.name,
         api_key_hash = EXCLUDED.api_key_hash,
         service_credentials = EXCLUDED.service_credentials,
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
        row.service_credentials,
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
  const currentTenantIds = Object.keys(controlPlane.tenants);
  await client.query(
    currentTenantIds.length > 0
      ? "DELETE FROM tenants WHERE tenant_id <> ALL($1::text[])"
      : "DELETE FROM tenants",
    currentTenantIds.length > 0 ? [currentTenantIds] : []
  );

  await upsertKeyedTable(client, "platform_users", "user_id", controlPlane.platformUsers);
  await upsertKeyedTable(client, "sessions", "session_id", controlPlane.sessions, (session) => ({
    token_hash: session.tokenHash,
    principal_type: session.principalType,
    tenant_id: session.tenantId,
    expires_at: session.expiresAt
  }));
  await upsertKeyedTable(client, "login_attempts", "attempt_key", controlPlane.loginAttempts);
  await upsertKeyedTable(client, "sub_processors", "sub_processor_id", controlPlane.subProcessors);
  await upsertKeyedTable(client, "break_glass_grants", "grant_id", controlPlane.breakGlassGrants, (grant) => ({
    tenant_id: grant.tenantId,
    credential_hash: grant.credentialHash
  }));
  await upsertKeyedTable(client, "ckyc_registry", "identifier", controlPlane.ckycRegistry);
  await upsertKeyedTable(client, "organisation_signups", "signup_id", controlPlane.organisationSignups ?? {});
  await upsertKeyedTable(client, "organisation_signup_rate_limits", "email_hash", controlPlane.organisationSignupRateLimits ?? {});
  await upsertKeyedTable(client, "federation_login_challenges", "challenge_key", controlPlane.federationLoginChallenges ?? {});

  // Platform audit events are append-only (the table itself enforces this
  // with a trigger — see db/schema.sql): only insert events not already
  // persisted, identified by eventId, and never touch existing rows.
  const existingEventIds = new Set(
    (await client.query("SELECT event_id FROM platform_audit_events")).rows.map((row) => row.event_id)
  );
  for (const event of controlPlane.platformEvents) {
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

// Writes every tenant's data-plane document in one go — the whole-state
// path (saveState) still used by routePlatform/routeAuth. The v3 hot path
// (saveTenantDataOnly, below) writes exactly one tenant's row instead.
async function persistAllTenantData(client, tenants) {
  for (const [tenantId, data] of Object.entries(tenants)) {
    const storedData = encodePostgresTenantData(tenantId, data ?? createEmptyTenantData());
    await client.query(
      `INSERT INTO tenant_data (tenant_id, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [tenantId, JSON.stringify(storedData)]
    );
  }
  const currentDataTenantIds = Object.keys(tenants);
  await client.query(
    currentDataTenantIds.length > 0
      ? "DELETE FROM tenant_data WHERE tenant_id <> ALL($1::text[])"
      : "DELETE FROM tenant_data",
    currentDataTenantIds.length > 0 ? [currentDataTenantIds] : []
  );
}

// ─── v3: per-tenant accessors (the actual fetch-scoping optimization) ─────
//
// The application connects as `loanos_control_plane` (BYPASSRLS, granted
// membership in `loanos_app` — see db/schema.sql), which is what every query
// in this module runs as by default — necessary for the whole-state
// operations above, which legitimately span tenants. The two tenant-scoped
// functions below are the ONE place a query actually needs RLS to mean
// something: they switch to `loanos_app` (NOBYPASSRLS) for the duration of
// one statement via `SET LOCAL ROLE`, with `app.current_tenant_id` set to
// the tenant being read/written, so a bug that somehow passed the wrong
// tenantId here would be caught by the database itself, not just by review.
// `SET LOCAL` and `SET LOCAL ROLE` both auto-revert at the end of the
// surrounding transaction regardless, but each function also explicitly
// RESET ROLEs afterward so later statements in the same transaction (e.g. a
// routeTenantAdmin control-plane write via stateRef, on the very same
// connection) aren't left running under the restricted role by accident.
async function withTenantRole(client, tenantId, fn) {
  await client.query("SET LOCAL ROLE loanos_app");
  await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
  try {
    return await fn();
  } finally {
    await client.query("RESET ROLE");
  }
}

// A lock-free... no: this one DOES run inside the request's transaction
// (via currentClient()), unlike peekControlPlaneState — it's the control-
// plane read route()'s v3 tenant-resolution flow uses for real, once a lock
// is already held. Control-plane tables carry no RLS, so no role switch is
// needed here.
export async function loadControlPlaneOnly(_dataDirIgnored) {
  const client = currentClient();
  const controlPlane = await loadControlPlane(client);
  return assembleState(controlPlane, {});
}

export async function loadTenantDataOnly(_dataDirIgnored, tenantId) {
  const client = currentClient();
  return withTenantRole(client, tenantId, async () => {
    const result = await client.query("SELECT data FROM tenant_data WHERE tenant_id = $1", [tenantId]);
    return result.rows[0]
      ? decodePostgresTenantData(tenantId, result.rows[0].data)
      : createEmptyTenantData();
  });
}

export async function saveTenantDataOnly(_dataDirIgnored, tenantId, tenantData) {
  const client = currentClient();
  const storedData = encodePostgresTenantData(tenantId, tenantData ?? createEmptyTenantData());
  await withTenantRole(client, tenantId, () =>
    client.query(
      `INSERT INTO tenant_data (tenant_id, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [tenantId, JSON.stringify(storedData)]
    )
  );
}

// Application-layer envelope encryption complements, rather than replaces,
// the managed database/storage encryption attested at deployment. JSONB rows
// contain only an authenticated ciphertext envelope when a master-key ring is
// configured; tenant identity is bound into HKDF key derivation, so copying an
// envelope to another tenant row cannot make it decrypt there.
export function encodePostgresTenantData(tenantId, tenantData, env = process.env) {
  const activeKey = getActiveMasterKey(env);
  if (!activeKey) return tenantData;
  return encryptTenantData(activeKey.key, tenantId, tenantData, activeKey.keyId);
}

export function decodePostgresTenantData(tenantId, storedData, env = process.env) {
  if (!isEncryptedEnvelope(storedData)) return storedData;
  const key = getMasterKeyById(storedData.kid, env);
  if (!key) throw new Error(`Postgres tenant ${tenantId} is encrypted but no master-key provider is configured.`);
  return decryptTenantData(key.key, tenantId, storedData);
}

export async function saveControlPlaneOnly(_dataDirIgnored, controlPlaneState) {
  const client = currentClient();
  await persistControlPlane(client, fileStoreNormalizeState(controlPlaneState).controlPlane);
}

// Purges a single tenant's data-plane row (used by offboarding to erase the
// data plane while retaining the attestation record in the control plane).
// Runs under the tenant's RLS context so the delete is database-enforced to
// affect only that tenant's row.
export async function deleteTenantDataOnly(_dataDirIgnored, tenantId) {
  const client = currentClient();
  await withTenantRole(client, tenantId, () =>
    client.query("DELETE FROM tenant_data WHERE tenant_id = $1", [tenantId])
  );
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
  await withStateLock(dataDir, GLOBAL_LOCK_LABEL, () =>
    fileStoreEnsureBootstrapTenants(dataDir, bootstrapTenants, { loadStateFn: loadState, saveStateFn: saveState })
  );
}
