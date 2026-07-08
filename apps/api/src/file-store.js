import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import {
  createModelRegistryState,
  normalizeModelRegistryState,
  normalizeWorkflowTaskStore
} from "../../../packages/core/src/index.js";

export const STATE_VERSION = 2;

export function resolveDataDir() {
  return process.env.LOANOS_DATA_DIR || join(process.cwd(), ".loanos-data");
}

export function statePath(dataDir = resolveDataDir()) {
  return join(dataDir, "state.json");
}

// A tenant data plane holds one regulated entity's whole operating record. It is
// the shape every domain handler reads and writes; a handler is never handed
// more than one tenant's partition, so cross-tenant access is impossible by
// construction rather than by per-endpoint filtering.
export function createEmptyTenantData() {
  return {
    regulatedEntities: {},
    lendingServiceProviders: {},
    digitalLendingApps: {},
    productPolicies: {},
    borrowerProfiles: {},
    consentRecords: {},
    kycRecords: {},
    staffActors: {},
    complaints: {},
    loanApplications: {},
    loanAccounts: {},
    workflowTasks: normalizeWorkflowTaskStore(),
    modelRegistry: createModelRegistryState(),
    events: []
  };
}

function normalizeTenantData(data) {
  return {
    regulatedEntities: data?.regulatedEntities ?? {},
    lendingServiceProviders: data?.lendingServiceProviders ?? {},
    digitalLendingApps: data?.digitalLendingApps ?? {},
    productPolicies: data?.productPolicies ?? {},
    borrowerProfiles: data?.borrowerProfiles ?? {},
    consentRecords: data?.consentRecords ?? {},
    kycRecords: data?.kycRecords ?? {},
    staffActors: data?.staffActors ?? {},
    complaints: data?.complaints ?? {},
    loanApplications: data?.loanApplications ?? {},
    loanAccounts: data?.loanAccounts ?? {},
    workflowTasks: normalizeWorkflowTaskStore(data?.workflowTasks),
    modelRegistry: normalizeModelRegistryState(data?.modelRegistry),
    events: Array.isArray(data?.events) ? data.events : []
  };
}

export function createEmptyState() {
  return {
    version: STATE_VERSION,
    controlPlane: {
      tenants: {}
    },
    tenants: {}
  };
}

function normalizeState(state) {
  const tenants = {};
  for (const [tenantId, data] of Object.entries(state?.tenants ?? {})) {
    tenants[tenantId] = normalizeTenantData(data);
  }
  return {
    version: STATE_VERSION,
    controlPlane: {
      tenants: state?.controlPlane?.tenants ?? {}
    },
    tenants
  };
}

export async function loadState(dataDir = resolveDataDir()) {
  const path = statePath(dataDir);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (error) {
    if (error.code === "ENOENT") {
      return createEmptyState();
    }
    throw error;
  }
}

export async function saveState(state, dataDir = resolveDataDir()) {
  const path = statePath(dataDir);
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

// --- Tenant control plane -------------------------------------------------

export function hashApiKey(apiKey) {
  return createHash("sha256").update(String(apiKey)).digest("hex");
}

export function generateApiKey() {
  return `lsk_${randomBytes(24).toString("hex")}`;
}

export function registerTenant(state, tenant, now = new Date()) {
  const { tenantId } = tenant;
  if (!tenantId) {
    throw new Error("registerTenant requires a tenantId.");
  }
  const existing = state.controlPlane.tenants[tenantId];
  const record = {
    tenantId,
    name: tenant.name ?? existing?.name ?? tenantId,
    apiKeyHash: tenant.apiKey ? hashApiKey(tenant.apiKey) : existing?.apiKeyHash ?? null,
    isolationTier: tenant.isolationTier ?? existing?.isolationTier ?? "pooled",
    status: tenant.status ?? existing?.status ?? "active",
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
  return {
    ...state,
    controlPlane: {
      ...state.controlPlane,
      tenants: {
        ...state.controlPlane.tenants,
        [tenantId]: record
      }
    },
    tenants: {
      ...state.tenants,
      [tenantId]: state.tenants[tenantId] ?? createEmptyTenantData()
    }
  };
}

export function listTenants(state) {
  return Object.values(state.controlPlane.tenants).map(publicTenant);
}

export function publicTenant(record) {
  if (!record) {
    return null;
  }
  const { apiKeyHash, ...rest } = record;
  return rest;
}

export function resolveTenantByApiKey(state, apiKey) {
  if (!apiKey) {
    return null;
  }
  const hash = hashApiKey(apiKey);
  return (
    Object.values(state.controlPlane.tenants).find(
      (tenant) => tenant.apiKeyHash === hash && tenant.status === "active"
    ) ?? null
  );
}

// --- Tenant-scoped data accessors (the isolation seam) --------------------

export function getTenantData(state, tenantId) {
  return state.tenants[tenantId] ?? null;
}

export function setTenantData(state, tenantId, tenantData) {
  return {
    ...state,
    tenants: {
      ...state.tenants,
      [tenantId]: tenantData
    }
  };
}

export async function ensureBootstrapTenants(dataDir, bootstrapTenants = []) {
  if (!bootstrapTenants.length) {
    return;
  }
  let state = await loadState(dataDir);
  let changed = false;
  for (const tenant of bootstrapTenants) {
    const existing = state.controlPlane.tenants[tenant.tenantId];
    // Keep a bootstrap tenant idempotent, but (re)bind its api key each start so
    // a fresh local run always has working credentials.
    if (!existing || existing.apiKeyHash !== (tenant.apiKey ? hashApiKey(tenant.apiKey) : existing?.apiKeyHash)) {
      state = registerTenant(state, tenant);
      changed = true;
    }
  }
  if (changed) {
    await saveState(state, dataDir);
  }
}

export function appendEvent(tenantData, event, now = new Date()) {
  return {
    ...tenantData,
    events: [
      ...(tenantData.events ?? []),
      {
        ...event,
        at: event.at ?? now.toISOString()
      }
    ]
  };
}
