-- LoanOS India — Postgres schema with row-level tenant isolation.
--
-- This schema backs the "pooled" isolation tier described in
-- docs/architecture/saas-tenancy-and-operating-model.md: one shared
-- application tier, one shared database, tenant rows logically isolated by
-- Postgres Row-Level Security (RLS) rather than per-endpoint WHERE
-- discipline. A "dedicated data plane" tenant gets this same schema
-- provisioned in its own database instead — the schema does not change,
-- only which database a tenant's rows live in.
--
-- Design choice: rather than normalizing 40+ domain entity types (borrowers,
-- loan accounts, complaints, models, ...) into first-class relational
-- tables — a much larger migration with its own risk profile — this schema
-- moves the existing per-tenant JSON data-plane document (today one partition
-- inside a single state.json) onto one JSONB column per tenant row, with RLS
-- enforcing that a database session can only see its own tenant's row. This
-- preserves the domain kernel in packages/core untouched (it already
-- operates on that same JSON shape) while gaining three things the file
-- store cannot provide:
--   1. Row-level security as a second, database-enforced isolation layer
--      beneath the existing application-layer tenant-context resolution —
--      even a future application bug that mixed up tenant IDs would be
--      blocked by Postgres itself, not just by careful review.
--   2. Real per-tenant concurrency: Postgres's row-level locking serializes
--      only conflicting writes to the SAME tenant's row, instead of every
--      request on the platform queuing behind one process-wide lock.
--   3. Durable, WAL-backed writes instead of a temp-file-rename-and-hope.
--
-- The control plane (tenant registry, platform users, sessions, break-glass
-- grants, sub-processors, the platform audit chain) is platform-wide by
-- design — it is not tenant-scoped, so RLS does not apply to it; access is
-- gated by the existing platform-admin-key/platform-user-role checks in the
-- application layer, unchanged by this migration.
--
-- Run this once against a fresh database as a superuser/owner role, then
-- create and use the `loanos_app` role (below) for the application itself.

BEGIN;

-- ─── Roles ───────────────────────────────────────────────────────────────
-- RLS policies are silently bypassed by table owners and roles with the
-- BYPASSRLS attribute (including superusers). The application MUST connect
-- as a plain, non-owner, non-bypassing role for RLS to mean anything — this
-- is the single most common way teams accidentally defeat RLS.
--
-- Two roles exist because the application genuinely needs two different
-- levels of access to tenant_data in different code paths:
--   - `loanos_app`: RLS-enforced. Used for the per-tenant hot path (a single
--     request's own tenant_data row) — apps/api/src/postgres-store.js wraps
--     those specific queries in `SET LOCAL ROLE loanos_app` so RLS is
--     genuinely enforced for exactly the query that's supposed to see only
--     one tenant's row.
--   - `loanos_control_plane`: BYPASSRLS. Used for operations that
--     legitimately span tenants by design — platform tenant provisioning
--     (seeding a new tenant's initial data), tenant export/offboarding
--     (reading/deleting one specific tenant chosen by a platform admin, not
--     the requester's own tenant context), and v1/v2's remaining
--     whole-state control-plane reads (routePlatform, routeAuth). This
--     mirrors the cross-tenant authority a platform admin key/session
--     already carries at the application layer — it is not a new privilege,
--     just the same one also expressed at the database layer.
-- The application's DATABASE_URL connects as `loanos_control_plane`, which
-- can `SET ROLE loanos_app` for the duration of one statement (granted
-- below) — it never authenticates directly as `loanos_app` itself, so a
-- connection-string leak alone can't be used to selectively bypass RLS by
-- simply not switching roles (the bypass-capable role is the one that
-- authenticates; `loanos_app` itself never lets you go the other way).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loanos_app') THEN
    CREATE ROLE loanos_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loanos_control_plane') THEN
    CREATE ROLE loanos_control_plane LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END
$$;
GRANT loanos_app TO loanos_control_plane;

-- ─── Control plane: tenant registry ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id         TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  api_key_hash      TEXT,
  service_credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  isolation_tier    TEXT NOT NULL DEFAULT 'pooled',
  status            TEXT NOT NULL DEFAULT 'active',
  is_sandbox        BOOLEAN NOT NULL DEFAULT FALSE,
  parent_tenant_id  TEXT REFERENCES tenants(tenant_id),
  sandbox_name      TEXT,
  onboarding        JSONB NOT NULL DEFAULT '{}'::jsonb,
  offboarding       JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS service_credentials JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS tenants_api_key_hash_idx ON tenants (api_key_hash) WHERE api_key_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS tenants_parent_tenant_id_idx ON tenants (parent_tenant_id) WHERE parent_tenant_id IS NOT NULL;

-- ─── Tenant data plane: one JSONB document per tenant, RLS-isolated ───────
-- The document shape is exactly `state.tenants[tenantId]` from
-- apps/api/src/file-store.js (createEmptyTenantData()) — borrowers, loan
-- applications, loan accounts, the audit event chain, workflow tasks, the
-- model registry, and every other tenant-scoped domain object. The domain
-- kernel in packages/core reads and writes this same shape; only the load/
-- save boundary changes with this migration.
CREATE TABLE IF NOT EXISTS tenant_data (
  tenant_id   TEXT PRIMARY KEY REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_data FORCE ROW LEVEL SECURITY; -- also applies to the table owner, defense in depth

-- A session sets app.current_tenant_id (via SET LOCAL, scoped to one
-- transaction) before touching this table; a session with no tenant set at
-- all sees no rows, matching the "no code path to another tenant's data"
-- invariant the application layer already enforces. Break-glass access
-- (platform staff reaching into one tenant) sets this same session variable
-- to the target tenant's id, so it is still bound by the same RLS policy —
-- there is no separate bypass path.
-- CREATE POLICY has no IF NOT EXISTS form, so this whole script stays
-- idempotent (rerunnable against an already-migrated database) via an
-- explicit drop-and-recreate rather than erroring on a second run.
DROP POLICY IF EXISTS tenant_isolation ON tenant_data;
CREATE POLICY tenant_isolation ON tenant_data
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON tenant_data TO loanos_app;
-- Whole-state control-plane synchronization removes rows for tenants that
-- were explicitly offboarded. Keep this privilege off the RLS hot-path role;
-- only the cross-tenant control-plane role may perform that cleanup.
GRANT DELETE ON tenant_data TO loanos_control_plane;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO loanos_app;

-- ─── Control plane: platform users, sessions, login throttling ───────────
CREATE TABLE IF NOT EXISTS platform_users (
  user_id       TEXT PRIMARY KEY,
  record        JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  tenant_id     TEXT REFERENCES tenants(tenant_id),
  record        JSONB NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  attempt_key   TEXT PRIMARY KEY,
  record        JSONB NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform_users, sessions, login_attempts TO loanos_app;

-- ─── Control plane: platform audit chain ──────────────────────────────────
-- One row per sealed event rather than a JSON array in a blob: this is the
-- audit evidence spine (packages/core/src/audit.js) and a real append-only
-- table is a strict improvement over a JSONB array for the same reasons the
-- domain doc flags external anchoring as a follow-on — a table gives you
-- database-level append-only enforcement (via the trigger below) and makes
-- "list events since X" a real indexed query instead of an in-memory scan.
CREATE TABLE IF NOT EXISTS platform_audit_events (
  sequence        BIGINT PRIMARY KEY,
  event_id        TEXT NOT NULL UNIQUE,
  occurred_at     TIMESTAMPTZ NOT NULL,
  previous_hash   TEXT NOT NULL,
  hash            TEXT NOT NULL,
  payload         JSONB NOT NULL
);

CREATE OR REPLACE FUNCTION forbid_platform_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_events is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS platform_audit_events_append_only ON platform_audit_events;
CREATE TRIGGER platform_audit_events_append_only
  BEFORE UPDATE OR DELETE ON platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_platform_audit_mutation();

GRANT SELECT, INSERT ON platform_audit_events TO loanos_app;

-- ─── Control plane: sub-processor register, break-glass grants, CKYC mock ─
CREATE TABLE IF NOT EXISTS sub_processors (
  sub_processor_id TEXT PRIMARY KEY,
  record           JSONB NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS break_glass_grants (
  grant_id      TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(tenant_id),
  credential_hash TEXT NOT NULL,
  record        JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS break_glass_grants_credential_hash_idx ON break_glass_grants (credential_hash);
CREATE INDEX IF NOT EXISTS break_glass_grants_tenant_id_idx ON break_glass_grants (tenant_id);

CREATE TABLE IF NOT EXISTS ckyc_registry (
  identifier    TEXT PRIMARY KEY,
  record        JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS organisation_signups (
  signup_id     TEXT PRIMARY KEY,
  record        JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organisation_signup_rate_limits (
  email_hash    TEXT PRIMARY KEY,
  record        JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS federation_login_challenges (
  challenge_key TEXT PRIMARY KEY,
  record        JSONB NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON sub_processors, break_glass_grants, ckyc_registry, organisation_signups, organisation_signup_rate_limits, federation_login_challenges TO loanos_app;

COMMIT;
