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

## Scope of this migration

Delivered incrementally, each slice verified against a live PostgreSQL 18
instance before being considered done:

### v1 — durable, RLS-isolated storage behind the existing seam

Tenant data is durably stored in Postgres with RLS policies defined and
enforceable. `loadState`/`saveState` return and accept the exact same
in-memory shape the file driver does, so every pure control-plane function
(`registerTenant`, `grantBreakGlass`, `offboardTenant`, `buildTenantExport`,
...) works unchanged regardless of which driver is active.

v1's own known limitation, which v2 and v3 address: `loadState`/`saveState`
load and save *every* tenant's data-plane document on each call (mirroring
the file driver's "load everything, mutate in memory, save everything"
pattern) — including, originally, for the per-request `store.load()/
store.save()` closure in `route()`'s hot path, not just admin-frequency
control-plane operations.

### v2 — per-tenant advisory locking

`withStateLock` now takes a lock key. `server.js`'s `resolveLockKey`
resolves which tenant a request belongs to *before* any lock is taken — via
`peekControlPlaneState`, a lock-free, `tenant_data`-free read used purely to
pick a key — and passes that tenantId through. Concurrent requests for
*different* tenants now serialize under *different* Postgres advisory locks
(`pg_advisory_xact_lock`) instead of all queuing behind one process-wide
lock; concurrent requests for the *same* tenant still correctly serialize
against each other (protecting against the lost-update race the lock exists
for in the first place). Control-plane routes (`/auth/*`, `/platform/*`),
whose writes are not confined to one tenant's row, still use a fixed global
lock key.

Getting the lock-key *probe* wrong is never a correctness issue — worst case
a request serializes against a broader or narrower set of peers than ideal.
`route()`'s own, authoritative tenant resolution still runs for real, under
whichever lock was acquired, and is what actually decides which tenant's
data a request can see or modify.

### v3 — per-tenant fetching, and a real two-role RLS model

`route()`'s tenant-resolution flow now fetches only the control plane (small
— the tenant registry, sessions, etc., never business data) to resolve which
tenant a request belongs to, then fetches *that one tenant's* data-plane
document — not every tenant's. The `store.load()/store.save()` closure used
by nearly every data-plane handler now calls `loadTenantDataOnly`/
`saveTenantDataOnly` (single-row, RLS-scoped) instead of the whole-state
functions.

This surfaced a real gap in v1/v2's RLS story: RLS only exists on
`tenant_data`, but v1/v2's whole-state operations also read/write
`tenant_data` broadly (tenant provisioning, export, offboarding) — if the
application had connected as the RLS-restricted `loanos_app` role as
originally documented, those operations would have silently seen/written
zero rows. v3 fixes this with two roles (see `db/schema.sql`):

- `loanos_control_plane` (`LOGIN`, `BYPASSRLS`) — what the application
  actually authenticates as. Used directly for whole-state control-plane
  operations (`routePlatform`, `routeAuth`, sandbox management) that
  legitimately span tenants — the same cross-tenant authority a platform
  admin key/session already carries at the application layer, now also
  expressed at the database layer.
- `loanos_app` (`NOLOGIN`, `NOBYPASSRLS`) — reached only via `SET ROLE` from
  `loanos_control_plane`, scoped to one statement at a time via
  `withTenantRole()` in `postgres-store.js`, for the per-tenant hot path.
  This is the one place RLS is now genuinely enforced against the
  application's own connection, not just against a hypothetically more
  restricted role that the app never actually used.

`session.tenantId` lives directly on the control-plane session record, so
resolving a tenant_user session's *tenant* needs no tenant_data at all;
validating that session's own *login record*, however, does (a tenant's
`users` map lives in its data-plane document) — `resolveSession` was split
into `resolveSessionRecord` (control-plane only) and `resolveSessionUser`
(given that one tenant's already-fetched data) so `route()` fetches tenant
data exactly once, at the one point resolution actually needs it, instead of
needing every tenant's `users` map just to check one session.

Two request-handling areas were deliberately **not** migrated to per-tenant
fetching, and still use the whole-state functions directly: sandbox
management (`resetSandbox`/`deleteSandbox` operate on a *different* tenant's
data than the one the request authenticated as, and are admin/dev-tooling,
not hot-path) and `routePlatform`/`routeAuth` (unchanged since v1, for the
same reason: genuinely cross-tenant by design, admin-frequency, not worth
the added risk of migrating for this pass).

## What has and has not been verified

v1, v2, and v3 were each verified against a scratch PostgreSQL 18 instance
provisioned locally, via `tests/postgres-store.test.js`:

- `db/schema.sql` applies cleanly and idempotently (rerunning it against an
  already-migrated database is a no-op).
- The RLS policy blocks cross-tenant reads *and* writes at the database
  level, independent of any application code — verified by connecting as
  `loanos_control_plane` (what the application actually authenticates as)
  and switching to `loanos_app` via `SET ROLE`, exactly mirroring
  `withTenantRole()`.
- `loanos_control_plane` genuinely bypasses RLS directly (no role switch),
  proving the whole-state control-plane operations that need cross-tenant
  visibility actually get it.
- `withStateLock` genuinely serializes concurrent callers sharing a lock key
  (a non-atomic shared-counter race that only produces the correct result
  under real mutual exclusion) — **and** does *not* serialize callers using
  *different* lock keys (two 150ms-held locks under different keys complete
  in ~150ms total, not ~300ms, proving they ran concurrently).
- A full HTTP round-trip through `createLoanOsServer` with
  `LOANOS_STORAGE_DRIVER=postgres` — connecting as `loanos_control_plane`,
  not a superuser, so the test can't pass by accident on a missing/broken
  `GRANT loanos_app TO loanos_control_plane` — provisions two tenants and
  proves tenant B cannot read tenant A's borrower record over the API. The
  full file-driver regression suite (`tests/compliance.test.js`, 143 tests,
  including sandbox creation/reset/delete and the CKYC mock-registry flow
  that v3's refactor also touched) was re-run after every change in this
  series and stayed green throughout.

Real bugs were caught and fixed by this live verification that a
read-through-only review would have missed: `SET LOCAL` does not accept bind
parameters (must use `set_config()` instead), `getPool()` threw before
checking whether a pool already existed (breaking every call after the
first), two call sites issued concurrent queries on a single connection
(`Promise.all` over `client.query()`, which Postgres/node-postgres don't
support), and `loanos_app`'s `NOLOGIN` change (v3) required the test that
connects "as the application" to switch roles rather than log in directly.

**Before trusting this driver in any real deployment**, run
`tests/postgres-store.test.js` yourself against your target Postgres version
and hosting environment (managed Postgres services, connection pooling
proxies like PgBouncer, and different Postgres major versions can all behave
differently around session-scoped variables, advisory locks, and `SET ROLE`).

## Running the migration

1. Provision a Postgres database (14+; developed and tested against 18).
2. As a superuser/owner role, apply the schema:
   ```
   psql "$DATABASE_URL" -f db/schema.sql
   ```
   This creates two roles, every table, indexes, the RLS policy, and grants
   `loanos_app` to `loanos_control_plane` so the latter can switch into it.
   It is safe to rerun against an already-migrated database.
   - `loanos_app` (`NOLOGIN`, `NOBYPASSRLS`) — RLS-enforced, reached only via
     `SET ROLE` from `loanos_control_plane` for the per-tenant hot path.
   - `loanos_control_plane` (`LOGIN`, `BYPASSRLS`) — what the application
     actually authenticates as, for whole-state control-plane operations
     that legitimately span tenants.
3. Set a password (or another auth method) for `loanos_control_plane`:
   ```sql
   ALTER ROLE loanos_control_plane WITH PASSWORD '...';
   ```
4. Set environment variables for the application:
   ```
   LOANOS_STORAGE_DRIVER=postgres
   DATABASE_URL=postgres://loanos_control_plane:...@host:5432/dbname
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
