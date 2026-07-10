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
enforceable. The `tenant_isolation` RLS policy is real and tested (see
`tests/postgres-store.test.js`) — any connection using the `loanos_app` role
that hasn't set `app.current_tenant_id` sees zero rows in `tenant_data`; a
connection scoped to tenant A cannot read or write tenant B's row even if it
tries. `loadState`/`saveState` return and accept the exact same in-memory
shape the file driver does, so every pure control-plane function
(`registerTenant`, `grantBreakGlass`, `offboardTenant`, `buildTenantExport`,
...) works unchanged regardless of which driver is active.

v1's own known limitation, which v2 addresses: `loadState`/`saveState` still
load and save *every* tenant's data-plane document on each call (mirroring
the file driver's "load everything, mutate in memory, save everything"
pattern) — including for the per-request `store.load()/store.save()` closure
in `route()`'s hot path, not just admin-frequency control-plane operations.

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
`route()`'s own, unchanged, authoritative tenant resolution
(`resolveSession`/`resolveTenantByApiKey`/`resolveBreakGlass`) still runs
for real, under whichever lock was acquired, and is what actually decides
which tenant's data a request can see or modify — the probe was deliberately
written to reuse the same underlying functions and data (just a lighter,
`tenant_data`-free path for the one case, tenant_user sessions, that would
otherwise need it) rather than risk the two diverging over time.

**v2's own known limitation, tracked as v3:** `loadState`/`saveState` still
fetch and write every tenant's data-plane document on every call — v2 only
changed which *lock* guards that work, not what it reads/writes. Fetching
only the one tenant a request actually touches requires restructuring
`route()`'s `store.load()/store.save()` closure itself (not just the lock
acquired around it), which is a larger, more invasive change to code
exercised by the entire test suite end-to-end.

## What has and has not been verified

Both v1 and v2 were verified against a scratch PostgreSQL 18 instance
provisioned locally, via `tests/postgres-store.test.js`:

- `db/schema.sql` applies cleanly and idempotently (rerunning it against an
  already-migrated database is a no-op).
- The RLS policy blocks cross-tenant reads *and* writes at the database
  level, independent of any application code, verified by connecting
  directly as the `loanos_app` role.
- `withStateLock` genuinely serializes concurrent callers sharing a lock key
  (a non-atomic shared-counter race that only produces the correct result
  under real mutual exclusion) — **and** does *not* serialize callers using
  *different* lock keys (two 150ms-held locks under different keys complete
  in ~150ms total, not ~300ms, proving they ran concurrently).
- A full HTTP round-trip through `createLoanOsServer` with
  `LOANOS_STORAGE_DRIVER=postgres` provisions two tenants and proves tenant B
  cannot read tenant A's borrower record over the API — the same invariant
  `tests/compliance.test.js` already proves for the file driver, now proved
  for the Postgres driver too.

Three real bugs were caught and fixed by this live verification that a
read-through-only review would have missed: `SET LOCAL` does not accept bind
parameters (must use `set_config()` instead), `getPool()` threw before
checking whether a pool already existed (breaking every call after the
first), and two call sites issued concurrent queries on a single connection
(`Promise.all` over `client.query()`, which Postgres/node-postgres don't
support — queries on one connection must be sequential).

**Before trusting this driver in any real deployment**, run
`tests/postgres-store.test.js` yourself against your target Postgres version
and hosting environment (managed Postgres services, connection pooling
proxies like PgBouncer, and different Postgres major versions can all behave
differently around session-scoped variables and advisory locks).

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
