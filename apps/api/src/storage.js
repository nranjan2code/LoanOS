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

let ioFunctions = fileStore;
if (driver === "postgres") {
  const postgresStore = await import("./postgres-store.js");
  ioFunctions = {
    loadState: postgresStore.loadState,
    saveState: postgresStore.saveState,
    withStateLock: postgresStore.withStateLock,
    ensureBootstrapTenants: postgresStore.ensureBootstrapTenants
  };
} else if (driver !== "file") {
  throw new Error(`Unknown LOANOS_STORAGE_DRIVER "${driver}". Expected "file" or "postgres".`);
}

export const loadState = ioFunctions.loadState;
export const saveState = ioFunctions.saveState;
export const withStateLock = ioFunctions.withStateLock;
export const ensureBootstrapTenants = ioFunctions.ensureBootstrapTenants;
