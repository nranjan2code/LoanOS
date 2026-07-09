import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import {
  buildAuditEvidencePack,
  createModelRegistryState,
  normalizeModelRegistryState,
  normalizeWorkflowTaskStore,
  verifyAuditChain
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
    beneficialOwners: {},
    erasureRequests: {},
    dataDisclosures: {},
    staffActors: {},
    recoveryAgents: {},
    complaints: {},
    incidents: {},
    fraudCases: {},
    loanApplications: {},
    loanAccounts: {},
    securityInterests: {},
    accessRequests: {},
    correctionRequests: {},
    fiuReports: {},
    documentVault: {},
    communications: {},
    paymentRails: {},
    workflowTasks: normalizeWorkflowTaskStore(),
    modelRegistry: createModelRegistryState(),
    aiHandoffRequests: {},
    marketplaceOffers: {},
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
    beneficialOwners: data?.beneficialOwners ?? {},
    erasureRequests: data?.erasureRequests ?? {},
    dataDisclosures: data?.dataDisclosures ?? {},
    staffActors: data?.staffActors ?? {},
    recoveryAgents: data?.recoveryAgents ?? {},
    complaints: data?.complaints ?? {},
    incidents: data?.incidents ?? {},
    fraudCases: data?.fraudCases ?? {},
    loanApplications: data?.loanApplications ?? {},
    loanAccounts: data?.loanAccounts ?? {},
    securityInterests: data?.securityInterests ?? {},
    accessRequests: data?.accessRequests ?? {},
    correctionRequests: data?.correctionRequests ?? {},
    fiuReports: data?.fiuReports ?? {},
    documentVault: data?.documentVault ?? {},
    communications: data?.communications ?? {},
    paymentRails: data?.paymentRails ?? {},
    workflowTasks: normalizeWorkflowTaskStore(data?.workflowTasks),
    modelRegistry: normalizeModelRegistryState(data?.modelRegistry),
    aiHandoffRequests: data?.aiHandoffRequests ?? {},
    marketplaceOffers: data?.marketplaceOffers ?? {},
    events: Array.isArray(data?.events) ? data.events : []
  };
}

const MOCK_CKYC_PRESEED = {
  "99999999999999": {
    ckycNumber: "99999999999999",
    fullName: "Aaditya Patel",
    dateOfBirth: "1990-01-01",
    gender: "M",
    idType: "pan",
    idNumber: "ABCDE1234F",
    contact: {
      mobile: "+91-9999999999",
      email: "aaditya@example.in"
    },
    address: {
      line1: "123 Residency Road",
      city: "Bengaluru",
      state: "Karnataka",
      country: "IN"
    }
  }
};

function normalizeState(state) {
  const tenants = {};
  for (const [tenantId, data] of Object.entries(state?.tenants ?? {})) {
    tenants[tenantId] = normalizeTenantData(data);
  }
  return {
    version: STATE_VERSION,
    controlPlane: {
      tenants: state?.controlPlane?.tenants ?? {},
      subProcessors: state?.controlPlane?.subProcessors ?? {},
      breakGlassGrants: state?.controlPlane?.breakGlassGrants ?? {},
      ckycRegistry: state?.controlPlane?.ckycRegistry ?? { ...MOCK_CKYC_PRESEED }
    },
    tenants
  };
}

export function createEmptyState() {
  return {
    version: STATE_VERSION,
    controlPlane: {
      tenants: {},
      subProcessors: {},
      breakGlassGrants: {},
      ckycRegistry: { ...MOCK_CKYC_PRESEED }
    },
    tenants: {}
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

export function generateApiKey(isSandbox = false) {
  const prefix = isSandbox ? "lsk_test" : "lsk";
  return `${prefix}_${randomBytes(24).toString("hex")}`;
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
    isSandbox: tenant.isSandbox ?? existing?.isSandbox ?? false,
    parentTenantId: tenant.parentTenantId ?? existing?.parentTenantId ?? null,
    sandboxName: tenant.sandboxName ?? existing?.sandboxName ?? null,
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

export function listSandboxes(state, parentTenantId) {
  return Object.values(state.controlPlane.tenants)
    .filter((t) => t.isSandbox && t.parentTenantId === parentTenantId && t.status !== "offboarded")
    .map(publicTenant);
}

export function resetSandbox(state, sandboxId, preserveConfig = false) {
  const tenantData = state.tenants[sandboxId];
  if (!tenantData) {
    return state;
  }
  let newTenantData;
  if (preserveConfig) {
    newTenantData = {
      ...createEmptyTenantData(),
      regulatedEntities: tenantData.regulatedEntities ?? {},
      lendingServiceProviders: tenantData.lendingServiceProviders ?? {},
      digitalLendingApps: tenantData.digitalLendingApps ?? {},
      productPolicies: tenantData.productPolicies ?? {},
      staffActors: tenantData.staffActors ?? {},
      recoveryAgents: tenantData.recoveryAgents ?? {},
    };
  } else {
    newTenantData = createEmptyTenantData();
  }
  return {
    ...state,
    tenants: {
      ...state.tenants,
      [sandboxId]: newTenantData
    }
  };
}

export function deleteSandbox(state, sandboxId, now = new Date()) {
  const record = state.controlPlane.tenants[sandboxId];
  if (!record || !record.isSandbox) {
    return state;
  }
  const nextTenants = { ...state.tenants };
  delete nextTenants[sandboxId];
  return {
    ...state,
    controlPlane: {
      ...state.controlPlane,
      tenants: {
        ...state.controlPlane.tenants,
        [sandboxId]: {
          ...record,
          status: "offboarded",
          updatedAt: now.toISOString()
        }
      }
    },
    tenants: nextTenants
  };
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

// --- Sub-processor register (control plane, disclosed to every tenant) -----

// LoanOS is itself an IT service provider inside each RE's regulatory perimeter,
// so every downstream sub-processor it uses must be disclosed to tenant REs
// (RBI IT-Outsourcing MD 2023; DPDP data-processor duties). The register lives
// in the control plane — it is platform-wide, not tenant-scoped — and read
// access is exposed to every authenticated tenant as a standing disclosure.

const SUB_PROCESSOR_STATUSES = new Set(["active", "retired"]);

export function validateSubProcessor(input) {
  const findings = [];
  if (!input?.subProcessorId) {
    findings.push({ code: "sub_processor_id_required", message: "A subProcessorId is required." });
  }
  if (!input?.name) {
    findings.push({ code: "sub_processor_name_required", message: "A sub-processor name is required." });
  }
  if (!input?.purpose) {
    findings.push({ code: "sub_processor_purpose_required", message: "A processing purpose is required." });
  }
  if (!input?.dataResidencyCountry) {
    findings.push({
      code: "sub_processor_residency_required",
      message: "A data-residency country is required to disclose cross-border processing."
    });
  }
  // RBI outsourcing requires a governing contract with every service provider.
  if (input?.dpaInPlace !== true) {
    findings.push({
      code: "sub_processor_dpa_required",
      message: "A data-processing agreement must be in place before a sub-processor is registered."
    });
  }
  if (input?.status && !SUB_PROCESSOR_STATUSES.has(input.status)) {
    findings.push({
      code: "sub_processor_status_invalid",
      message: `status must be one of: ${[...SUB_PROCESSOR_STATUSES].join(", ")}.`
    });
  }
  return findings;
}

export function publicSubProcessor(record) {
  if (!record) {
    return null;
  }
  return {
    ...record,
    // A disclosed, derived fact so tenant REs can see cross-border processing
    // without reasoning about country codes themselves.
    crossBorder: record.dataResidencyCountry !== "IN"
  };
}

export function registerSubProcessor(state, input, now = new Date()) {
  const { subProcessorId } = input;
  const existing = state.controlPlane.subProcessors?.[subProcessorId] ?? null;
  const record = {
    subProcessorId,
    name: input.name ?? existing?.name ?? subProcessorId,
    purpose: input.purpose ?? existing?.purpose ?? null,
    dataCategories: Array.isArray(input.dataCategories)
      ? input.dataCategories
      : existing?.dataCategories ?? [],
    dataResidencyCountry: input.dataResidencyCountry ?? existing?.dataResidencyCountry ?? null,
    contractReference: input.contractReference ?? existing?.contractReference ?? null,
    dpaInPlace: input.dpaInPlace ?? existing?.dpaInPlace ?? false,
    status: input.status ?? existing?.status ?? "active",
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
  return {
    ...state,
    controlPlane: {
      ...state.controlPlane,
      subProcessors: {
        ...state.controlPlane.subProcessors,
        [subProcessorId]: record
      }
    }
  };
}

export function listSubProcessors(state) {
  return Object.values(state.controlPlane.subProcessors ?? {}).map(publicSubProcessor);
}

// --- Platform-staff break-glass access -------------------------------------

// Cross-tenant access is impossible by construction, but platform staff may need
// emergency access to one tenant's data plane (incident response, recovery). A
// break-glass grant is minted by the platform admin, scoped to a single tenant,
// time-boxed, and carries a reason. Every request made under it is sealed into
// that tenant's audit chain, so the tenant can see exactly who reached in, when,
// and why — access is transparent to the tenant, never silent.

const DEFAULT_BREAK_GLASS_TTL_MINUTES = 60;

export function generateBreakGlassKey() {
  return `bgk_${randomBytes(24).toString("hex")}`;
}

export function grantBreakGlass(state, input, now = new Date()) {
  const { tenantId } = input;
  if (!tenantId || !state.controlPlane.tenants[tenantId]) {
    throw new Error("grantBreakGlass requires an existing tenantId.");
  }
  const grantId = input.grantId ?? `bg_${randomBytes(8).toString("hex")}`;
  const ttlMinutes = Number.isFinite(input.ttlMinutes) ? input.ttlMinutes : DEFAULT_BREAK_GLASS_TTL_MINUTES;
  const record = {
    grantId,
    tenantId,
    staffId: input.staffId,
    reason: input.reason,
    credentialHash: hashApiKey(input.credential),
    status: "active",
    createdBy: input.createdBy ?? null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()
  };
  return {
    ...state,
    controlPlane: {
      ...state.controlPlane,
      breakGlassGrants: {
        ...state.controlPlane.breakGlassGrants,
        [grantId]: record
      }
    }
  };
}

export function breakGlassEffectiveStatus(record, now = new Date()) {
  if (record.status !== "active") {
    return record.status;
  }
  return new Date(record.expiresAt).getTime() < now.getTime() ? "expired" : "active";
}

export function publicBreakGlassGrant(record, now = new Date()) {
  if (!record) {
    return null;
  }
  const { credentialHash, ...rest } = record;
  return { ...rest, effectiveStatus: breakGlassEffectiveStatus(record, now) };
}

export function resolveBreakGlass(state, credential, now = new Date()) {
  if (!credential) {
    return null;
  }
  const hash = hashApiKey(credential);
  const grant = Object.values(state.controlPlane.breakGlassGrants ?? {}).find(
    (record) => record.credentialHash === hash && breakGlassEffectiveStatus(record, now) === "active"
  );
  if (!grant) {
    return null;
  }
  const tenant = state.controlPlane.tenants[grant.tenantId];
  if (!tenant || tenant.status !== "active") {
    return null;
  }
  return { grant, tenant };
}

export function revokeBreakGlass(state, grantId, now = new Date()) {
  const record = state.controlPlane.breakGlassGrants?.[grantId];
  if (!record) {
    return null;
  }
  return {
    ...state,
    controlPlane: {
      ...state.controlPlane,
      breakGlassGrants: {
        ...state.controlPlane.breakGlassGrants,
        [grantId]: { ...record, status: "revoked", revokedAt: now.toISOString() }
      }
    }
  };
}

export function listBreakGlassGrants(state, tenantId, now = new Date()) {
  return Object.values(state.controlPlane.breakGlassGrants ?? {})
    .filter((record) => !tenantId || record.tenantId === tenantId)
    .map((record) => publicBreakGlassGrant(record, now));
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

    if (tenant.tenantId === "dev" && state.tenants["dev"]) {
      const devData = state.tenants["dev"];
      if (!devData.loanApplications || Object.keys(devData.loanApplications).length === 0) {
        devData.regulatedEntities = {
          "re_1": {
            regulatedEntityId: "re_1",
            name: "India Retail Lending Corp",
            entityType: "nbfc",
            country: "IN",
            website: "https://irlc.co.in",
            privacyPolicyUrl: "https://irlc.co.in/privacy",
            grievanceOfficerName: "Grievance Officer Alpha",
            grievanceOfficerEmail: "grievance@irlc.co.in",
            boardApprovedPolicies: ["credit_policy", "data_retention_policy"],
            dataResidencyPosture: "IN",
            status: "active"
          }
        };

        devData.productPolicies = {
          "prod_1": {
            productId: "prod_1",
            productCode: "RETAIL_PERSONAL_LOAN",
            regulatedEntityId: "re_1",
            currency: "INR",
            minAmount: 10000,
            maxAmount: 100000,
            minTenorMonths: 3,
            maxTenorMonths: 12,
            annualInterestRateBps: 1500,
            aprBps: 1800,
            interestCalcMethod: "reducing_balance",
            pricingPolicyRef: "BOARD-PRICING-2026-V1",
            eligibilityRules: { minAge: 18, maxAge: 65, minIncome: 15000 },
            coolingOffDays: 3,
            recoveryMechanism: "authorized_agency_only",
            status: "active",
            version: 1,
            effectiveFrom: "2026-01-01T00:00:00.000Z",
            effectiveTo: null
          }
        };

        devData.borrowerProfiles = {
          "borrower_1": {
            borrowerId: "borrower_1",
            name: "Rajesh Kumar",
            residencyCountry: "IN",
            address: "123, MG Road, Bangalore, KA, India",
            email: "rajesh@example.com",
            phone: "+919876543210",
            occupation: "salaried",
            monthlyIncome: 45000,
            status: "active"
          }
        };

        devData.kycRecords = {
          "kyc_1": {
            kycRecordId: "kyc_1",
            borrowerId: "borrower_1",
            status: "verified",
            riskCategory: "medium",
            verifiedAt: "2026-01-10T10:00:00.000Z",
            reviewDueAt: "2034-01-10T10:00:00.000Z"
          }
        };

        devData.consentRecords = {
          "consent_1": {
            consentId: "consent_1",
            borrowerId: "borrower_1",
            purpose: "credit_assessment",
            noticeVersion: "v1.0",
            status: "accepted",
            grantedAt: "2026-07-01T12:00:00.000Z"
          }
        };

        devData.loanApplications = {
          "app_compliance_blocked": {
            applicationId: "app_compliance_blocked",
            borrowerId: "borrower_1",
            productId: "prod_1",
            regulatedEntityId: "re_1",
            amount: 25000,
            tenorMonths: 6,
            status: "blocked_compliance",
            createdAt: "2026-07-09T08:00:00.000Z",
            updatedAt: "2026-07-09T08:00:00.000Z",
            compliance: {
              summary: { status: "blocked", findingsCount: 1 },
              findings: [{ severity: "error", code: "RBI-DL-2025", message: "Non-India borrower residency blocks preflight.", field: "residencyCountry" }]
            },
            workflow: []
          },
          "app_kfs_issued": {
            applicationId: "app_kfs_issued",
            borrowerId: "borrower_1",
            productId: "prod_1",
            regulatedEntityId: "re_1",
            amount: 30000,
            tenorMonths: 6,
            status: "kfs_issued",
            createdAt: "2026-07-09T08:15:00.000Z",
            updatedAt: "2026-07-09T08:15:00.000Z",
            kfs: { kfsId: "kfs_102", principal: 30000, tenorMonths: 6, aprBps: 1800 },
            kfsReadiness: { status: "ready" },
            workflow: [{ type: "application.kfs.issued", actor: "system", occurredAt: "2026-07-09T08:16:00.000Z" }]
          },
          "app_refer_underwrite": {
            applicationId: "app_refer_underwrite",
            borrowerId: "borrower_1",
            productId: "prod_1",
            regulatedEntityId: "re_1",
            amount: 50000,
            tenorMonths: 12,
            status: "ready_for_decision",
            createdAt: "2026-07-09T08:30:00.000Z",
            updatedAt: "2026-07-09T08:30:00.000Z",
            eligibility: { decision: "refer", reason: "FOIR ratio near threshold limit", foirPercent: 42 },
            workflow: [{ type: "application.kfs.accepted", actor: "borrower_1", occurredAt: "2026-07-09T08:32:00.000Z" }]
          },
          "app_pending_approval": {
            applicationId: "app_pending_approval",
            borrowerId: "borrower_1",
            productId: "prod_1",
            regulatedEntityId: "re_1",
            amount: 20000,
            tenorMonths: 6,
            status: "pending_decision_approval",
            createdAt: "2026-07-09T08:45:00.000Z",
            updatedAt: "2026-07-09T08:45:00.000Z",
            pendingDecision: { decision: "approved", proposedBy: "credit_officer_1", proposedAt: "2026-07-09T09:00:00.000Z" },
            workflow: [
              { type: "application.kfs.accepted", actor: "borrower_1", occurredAt: "2026-07-09T08:47:00.000Z" },
              { type: "application.decision.proposed", actor: "credit_officer_1", occurredAt: "2026-07-09T09:00:00.000Z" }
            ]
          },
          "app_disbursement_ready": {
            applicationId: "app_disbursement_ready",
            borrowerId: "borrower_1",
            productId: "prod_1",
            regulatedEntityId: "re_1",
            amount: 40000,
            tenorMonths: 8,
            status: "approved",
            createdAt: "2026-07-09T09:00:00.000Z",
            updatedAt: "2026-07-09T09:00:00.000Z",
            documentPacket: { delivery: { deliveryRef: "MSG-100234", deliveredAt: "2026-07-09T09:10:00.000Z" } },
            workflow: [
              { type: "application.decision.approved", actor: "credit_checker_1", occurredAt: "2026-07-09T09:05:00.000Z" }
            ]
          }
        };

        devData.complaints = {
          "complaint_1": {
            complaintId: "complaint_1",
            borrowerId: "borrower_1",
            category: "delay_in_disbursement",
            summary: "Loan approved yesterday but funds have not cleared in bank account.",
            status: "received",
            receivedAt: "2026-07-09T09:15:00.000Z"
          }
        };
        changed = true;
      }
    }
  }
  if (changed) {
    await saveState(state, dataDir);
  }
}

// --- Tenant offboarding: portability export + evidenced deletion ----------

// Deterministic serialization so a content digest is stable regardless of key
// insertion order across load/save round-trips.
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function tenantContentDigest(tenantData) {
  return createHash("sha256").update(canonicalJson(tenantData ?? {})).digest("hex");
}

// A full, self-describing portability pack for one tenant, reproducible from the
// source-of-truth records: the control-plane record, the complete data plane,
// and the tenant-scoped audit evidence pack (with its integrity verdict). This
// is what an exiting regulated entity — or its new provider — receives.
export function buildTenantExport(state, tenantId, { now = new Date() } = {}) {
  const record = state.controlPlane?.tenants?.[tenantId];
  const data = state.tenants?.[tenantId];
  if (!record || !data) {
    return null;
  }
  const auditPack = buildAuditEvidencePack(data.events, tenantId, { now });
  return {
    tenantId,
    generatedAt: now.toISOString(),
    formatVersion: STATE_VERSION,
    tenant: publicTenant(record),
    dataPlane: data,
    audit: auditPack,
    integrity: {
      chainValid: auditPack.integrity.valid,
      eventCount: auditPack.eventCount,
      headHash: auditPack.headHash,
      contentDigest: tenantContentDigest(data)
    }
  };
}

// Evidenced deletion: purge the tenant's data plane but retain a tamper-evident
// attestation in the control plane recording what was erased (event count, audit
// head hash, content digest), who authorized it, and why. The api key is revoked
// and the status moves to `offboarded`, so the tenant can no longer authenticate.
export function offboardTenant(state, tenantId, { actor, reason, now = new Date() } = {}) {
  const record = state.controlPlane?.tenants?.[tenantId];
  const data = state.tenants?.[tenantId];
  if (!record || !data) {
    return null;
  }
  const integrity = verifyAuditChain(data.events, tenantId);
  const attestation = {
    offboardedAt: now.toISOString(),
    actor: actor ?? null,
    reason: reason ?? null,
    erasedEventCount: (data.events ?? []).length,
    auditHeadHash: integrity.headHash ?? null,
    chainValidAtDeletion: integrity.valid,
    contentDigest: tenantContentDigest(data)
  };
  const nextTenants = { ...state.tenants };
  delete nextTenants[tenantId];
  return {
    state: {
      ...state,
      controlPlane: {
        ...state.controlPlane,
        tenants: {
          ...state.controlPlane.tenants,
          [tenantId]: {
            ...record,
            status: "offboarded",
            apiKeyHash: null,
            updatedAt: now.toISOString(),
            offboarding: attestation
          }
        }
      },
      tenants: nextTenants
    },
    attestation
  };
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
