import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createModelRegistryState,
  normalizeModelRegistryState,
  normalizeWorkflowTaskStore
} from "../../../packages/core/src/index.js";

export function resolveDataDir() {
  return process.env.LOANOS_DATA_DIR || join(process.cwd(), ".loanos-data");
}

export function statePath(dataDir = resolveDataDir()) {
  return join(dataDir, "state.json");
}

export function createEmptyState() {
  return {
    version: 1,
    regulatedEntities: {},
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

export async function updateState(mutator, dataDir = resolveDataDir()) {
  const state = await loadState(dataDir);
  const nextState = await mutator(state);
  await saveState(nextState, dataDir);
  return nextState;
}

export function appendEvent(state, event, now = new Date()) {
  return {
    ...state,
    events: [
      ...(state.events ?? []),
      {
        ...event,
        at: event.at ?? now.toISOString()
      }
    ]
  };
}

function normalizeState(state) {
  const empty = createEmptyState();
  return {
    version: state?.version ?? empty.version,
    regulatedEntities: state?.regulatedEntities ?? {},
    productPolicies: state?.productPolicies ?? {},
    borrowerProfiles: state?.borrowerProfiles ?? {},
    consentRecords: state?.consentRecords ?? {},
    kycRecords: state?.kycRecords ?? {},
    staffActors: state?.staffActors ?? {},
    complaints: state?.complaints ?? {},
    loanApplications: state?.loanApplications ?? {},
    loanAccounts: state?.loanAccounts ?? {},
    workflowTasks: normalizeWorkflowTaskStore(state?.workflowTasks),
    modelRegistry: normalizeModelRegistryState(state?.modelRegistry),
    events: Array.isArray(state?.events) ? state.events : []
  };
}
