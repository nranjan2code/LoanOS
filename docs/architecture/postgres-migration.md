# Postgres Storage Migration

This document describes the Postgres-backed storage driver added alongside
the original file-backed store, why it is scoped the way it is, and how to
cut a real deployment over to it. It is a companion to the
[SaaS tenancy and operating model](saas-tenancy-and-operating-model.md) doc,
which already commits to Postgres row-level security (RLS) as the pooled-tier
isolation mechanism — this document is that commitment's first executable
slice.

## Why

The file-backed store (`apps/api/src/file-store.js`) keeps every tenant's
data in one `state.json`, rewritten in full on every save, serialized behind
a single in-process lock (`withStateLock`). It is explicitly documented as
"correctness, not scale" — it cannot run more than one application process,
has no real durability guarantee beyond a temp-file rename, and enforces
tenant isolation entirely at the application layer (a request handler is
*given* only its own tenant's partition, but nothing below the application
layer would stop a different, buggier piece of code from reading another
tenant's row).

The Postgres driver (`apps/api/src/postgres-store.js`) addresses the second
two problems directly and lays the foundation for the first:

- **Row-Level Security.** `db/schema.sql` puts every tenant's data-plane
  document in one row of a `tenant_data` table, with an RLS policy that only
  allows a database session to see the row matching a `SET LOCAL
  app.current_tenant_id` session variable. This is a *second*,
  database-enforced isolation layer beneath the existing application-layer
  one — even a future bug, a different service sharing the database, or an
  analyst's ad-hoc query is blocked by Postgres itself, not just by review.
- **Durability.** Writes go through Postgres's WAL, not a manual
  write-temp-file-then-rename dance.
- **Cross-process locking.** `withStateLock` is re-implemented with
  `pg_advisory_xact_lock`, which — unlike the file driver's in-process `Map`
  of promises — works across multiple application processes/instances
  talking to the same database.

## Scope of this migration (v1)

This is deliberately a bounded first slice, not a full re-architecture. Two
things are true at once:

1. **Delivered now:** tenant data is durably stored in Postgres with RLS
   policies defined and enforceable, and `withStateLock` no longer requires
   a single Node process. The `tenant_isolation` RLS policy is real and
   tested (see `tests/postgres-store.test.js`) — any connection using the
   `loanos_app` role that hasn't set `app.current_tenant_id` sees zero rows
   in `tenant_data`; a connection scoped to tenant A cannot read or write
   tenant B's row even if it tries.

2. **Not yet delivered — a documented v2 follow-up:** the application's own
   `loadState()`/`saveState()` calls (used by the control plane —
   `routePlatform`, `routeAuth`, and tenant resolution in `route()`) still
   load and save *every* tenant's data-plane document on each call,
   mirroring the file driver's "load everything, mutate in memory, save
   everything" pattern exactly. This is necessary in v1 because those code
   paths — routed through `server.js`'s existing `loadWholeState`/
   `saveWholeState` calls — were not restructured to resolve which single
   tenant a request needs before loading. Control-plane operations
   (tenant provisioning, break-glass, sub-processor registration) are
   platform-admin-frequency, not hot-path, so this is a real (not
   theoretical) tradeoff, not a bug — but it does mean:
   - The RLS-scoped `loanos_app` role is not actually the role the running
     application connects as for these whole-state operations (a
     control-plane-privileged connection is required to see every tenant's
     row at once, exactly mirroring the cross-tenant authority a platform
     admin key/session already has at the application layer today).
   - The per-tenant advisory-lock and per-tenant-only-fetch optimizations
     that would let concurrent requests for *different* tenants stop
     serializing behind one lock are not yet realized — v1 still has one
     global lock, just a Postgres-backed one instead of a JS one.

   Realizing that optimization requires restructuring `route()`'s
   tenant-resolution flow (used by essentially every test in
   `tests/compliance.test.js`) to resolve the tenant *before* deciding what
   to load — a change with wide blast radius that deserves its own focused
   session with a live database to verify against, not a bundled change
   alongside the initial storage swap.

## What has and has not been verified

This driver was implemented in an environment without a running Postgres
instance available initially. A scratch PostgreSQL 18 instance was then
provisioned locally and used to:

- Apply `db/schema.sql` cleanly (idempotently — rerunning it against an
  already-migrated database is a no-op, verified directly).
- Run `tests/postgres-store.test.js`, which:
  - Proves the RLS policy blocks cross-tenant reads *and* writes at the
    database level, independent of any application code, by connecting
    directly as the `loanos_app` role.
  - Proves `withStateLock` genuinely serializes concurrent callers (a
    non-atomic shared-counter race that only produces the correct result
    under real mutual exclusion).
  - Runs a full HTTP round-trip through `createLoanOsServer` with
    `LOANOS_STORAGE_DRIVER=postgres`, provisions two tenants, and proves
    tenant B cannot read tenant A's borrower record over the API — the same
    invariant `tests/compliance.test.js` already proves for the file driver,
    now proved for the Postgres driver too.

**Before trusting this driver in any real deployment**, run
`tests/postgres-store.test.js` yourself against your target Postgres version
and hosting environment (managed Postgres services, connection pooling
proxies like PgBouncer, and different Postgres major versions can all behave
differently around session-scoped `SET LOCAL` variables and advisory locks).

## Running the migration

1. Provision a Postgres database (14+; developed and tested against 18).
2. As a superuser/owner role, apply the schema:
   ```
   psql "$DATABASE_URL" -f db/schema.sql
   ```
   This creates the `loanos_app` role (`LOGIN`, `NOSUPERUSER`,
   `NOBYPASSRLS`), every table, indexes, and the RLS policy. It is safe to
   rerun against an already-migrated database.
3. Set a password (or another auth method) for `loanos_app`:
   ```sql
   ALTER ROLE loanos_app WITH PASSWORD '...';
   ```
4. Set environment variables for the application:
   ```
   LOANOS_STORAGE_DRIVER=postgres
   DATABASE_URL=postgres://loanos_app:...@host:5432/dbname
   ```
5. Run `tests/postgres-store.test.js` against a scratch database first:
   ```
   DATABASE_URL_TEST=postgres://...@host/scratch_db npm test
   ```
6. Only once that suite passes against your actual target environment,
   point a real deployment at it.

## Reverting

`LOANOS_STORAGE_DRIVER` defaults to `file` — unset it (or set it to `file`
explicitly) to fall back to the original file-backed store. The two drivers
do not share state; there is no automatic data migration between them today.
A one-time export/import (using the existing `GET /platform/tenants/:id/export`
portability endpoint, which already produces a reproducible, source-of-truth
export per tenant regardless of which driver produced it) is the intended
path to move existing tenant data from the file store into Postgres.
