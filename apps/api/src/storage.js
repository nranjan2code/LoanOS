// Storage driver façade: server.js imports from this module instead of
// file-store.js directly. Every pure, in-memory function file-store.js
// exports (registerTenant, grantBreakGlass, offboardTenant, ...) is
// re-exported unchanged — those operate on the shared `{ version,
// controlPlane, tenants }` in-memory shape regardless of where it came from,
// so they need no driver-specific version. Only the I/O boundary
// (loadState/saveState/withStateLock/ensureBootstrapTenants) is driver-
// selected, via LOANOS_STORAGE_DRIVER.
//
// Defaults to the file-backed driver (zero behavior change, zero new
// dependency risk) unless LOANOS_STORAGE_DRIVER=postgres is set explicitly.
// See db/schema.sql and docs/architecture/postgres-migration.md before
// switching a real deployment to the postgres driver — that path has not
// been exercised against a live database in this codebase's automated
// tests; run tests/postgres-store.test.js against a real DATABASE_URL_TEST
// first.

export * from "./file-store.js";

import * as fileStore from "./file-store.js";

const driver = (process.env.LOANOS_STORAGE_DRIVER ?? "file").toLowerCase();

// peekControlPlaneState: a lock-free, tenant_data-free read used only to
// pick a per-tenant advisory-lock key before any lock is taken (see
// resolveLockKey in server.js). The file driver has no equivalent notion —
// its lock is keyed by dataDir alone regardless — so it exposes `null`,
// which resolveLockKey treats as "this driver doesn't support/need
// tenant-scoped locking; use the global key."
let ioFunctions = { ...fileStore, peekControlPlaneState: null };
if (driver === "postgres") {
  const postgresStore = await import("./postgres-store.js");
  ioFunctions = {
    loadState: postgresStore.loadState,
    saveState: postgresStore.saveState,
    withStateLock: postgresStore.withStateLock,
    ensureBootstrapTenants: postgresStore.ensureBootstrapTenants,
    peekControlPlaneState: postgresStore.peekControlPlaneState,
    // v3: per-tenant accessors — route()'s hot path uses these instead of
    // loadState/saveState so it fetches/writes exactly one tenant's data,
    // not every tenant's, on every request. The file driver's versions
    // (from file-store.js, picked up via the `...fileStore` spread above)
    // still round-trip the whole file — no partial I/O is possible there —
    // but expose the same four function names so route() doesn't need to
    // know which driver is active.
    loadControlPlaneOnly: postgresStore.loadControlPlaneOnly,
    loadTenantDataOnly: postgresStore.loadTenantDataOnly,
    saveTenantDataOnly: postgresStore.saveTenantDataOnly,
    saveControlPlaneOnly: postgresStore.saveControlPlaneOnly
  };
} else if (driver !== "file") {
  throw new Error(`Unknown LOANOS_STORAGE_DRIVER "${driver}". Expected "file" or "postgres".`);
}

export const loadState = ioFunctions.loadState;
export const saveState = ioFunctions.saveState;
export const withStateLock = ioFunctions.withStateLock;
export const ensureBootstrapTenants = ioFunctions.ensureBootstrapTenants;
export const peekControlPlaneState = ioFunctions.peekControlPlaneState;
export const loadControlPlaneOnly = ioFunctions.loadControlPlaneOnly;
export const loadTenantDataOnly = ioFunctions.loadTenantDataOnly;
export const saveTenantDataOnly = ioFunctions.saveTenantDataOnly;
export const saveControlPlaneOnly = ioFunctions.saveControlPlaneOnly;
