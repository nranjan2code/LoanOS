import { createHash, randomBytes } from "node:crypto";

// The audit spine is one append-only, tenant-scoped hash chain. Every state
// change emits an event; each event's hash covers the previous event's hash, so
// any insertion, deletion, reordering, or edit breaks the chain and is
// detectable at verification/export time. The chain root is bound to the tenant
// so a chain cannot be transplanted between tenants.

const GENESIS_PREFIX = "loanos-audit-genesis:";

// Structural fields the spine manages; never treated as event payload.
const RESERVED_FIELDS = new Set([
  "sequence",
  "eventId",
  "tenantId",
  "occurredAt",
  "previousHash",
  "hash",
  "at"
]);

// Every sealed event carries a uniform provenance envelope: who acted
// (`actor`), in what capacity (`actorType`), and the sensitivity of the data it
// touched (`dataClass`). Stamping is centralized at the seal seam so no handler
// can emit an unclassified event, and the fields are hashed into the chain like
// any other payload.

export const AUDIT_ACTOR_TYPES = {
  TENANT: "tenant",
  PLATFORM_STAFF: "platform_staff",
  SYSTEM: "system"
};

export const AUDIT_DATA_CLASSES = {
  PERSONAL: "personal_data",
  FINANCIAL: "financial",
  MODEL_GOVERNANCE: "model_governance",
  PLATFORM: "platform",
  OPERATIONAL: "operational"
};

export function classifyAuditDataClass(type) {
  const value = String(type ?? "");
  if (/borrower|consent|kyc|complaint|grievance|communication|vcip/.test(value)) {
    return AUDIT_DATA_CLASSES.PERSONAL;
  }
  if (
    /^loan|^application|disburse|payment|charge|waiver|reversal|accrual|recovery|prepaid|prepay|foreclos|closure|npa|product_policy|bank_account|document_vault|payment_rail|credit_bureau/.test(
      value
    ) ||
    value.includes("bank_account") ||
    value.includes("document_vault") ||
    value.includes("payment_rail") ||
    value.includes("credit_bureau")
  ) {
    return AUDIT_DATA_CLASSES.FINANCIAL;
  }
  if (/^model|^api\.ai|kill_switch/.test(value)) {
    return AUDIT_DATA_CLASSES.MODEL_GOVERNANCE;
  }
  if (/^platform/.test(value)) {
    return AUDIT_DATA_CLASSES.PLATFORM;
  }
  return AUDIT_DATA_CLASSES.OPERATIONAL;
}

// Fill the provenance envelope on any not-yet-sealed event, never overriding a
// value a handler set explicitly (e.g. break-glass stamps its own actor).
export function stampAuditEvents(events, { actor = null, actorType = AUDIT_ACTOR_TYPES.SYSTEM } = {}) {
  const source = Array.isArray(events) ? events : [];
  return source.map((event) => {
    if (event.hash) {
      return event;
    }
    return {
      ...event,
      actor: event.actor ?? actor,
      actorType: event.actorType ?? actorType,
      dataClass: event.dataClass ?? classifyAuditDataClass(event.type)
    };
  });
}

export function auditGenesisHash(tenantId) {
  return createHash("sha256").update(`${GENESIS_PREFIX}${tenantId ?? ""}`).digest("hex");
}

// Deterministic serialization: sort object keys recursively so the hash is
// stable regardless of key insertion order across load/save round-trips.
function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function computeAuditHash(event, previousHash) {
  const { hash, ...rest } = event;
  return createHash("sha256").update(`${previousHash}\n${canonicalize(rest)}`).digest("hex");
}

function stripReserved(event) {
  const payload = {};
  for (const [key, value] of Object.entries(event)) {
    if (!RESERVED_FIELDS.has(key)) {
      payload[key] = value;
    }
  }
  return payload;
}

// Seal any not-yet-sealed events at the tail of the chain. Already-sealed events
// (those carrying a `hash`) are trusted and left untouched, so sealing is
// idempotent and cheap to run on every save.
export function sealAuditChain(events, tenantId, { now = new Date() } = {}) {
  const source = Array.isArray(events) ? events : [];
  const sealed = [];
  let previousHash = auditGenesisHash(tenantId);
  let sequence = 0;
  for (const event of source) {
    if (event.hash) {
      sealed.push(event);
      previousHash = event.hash;
      sequence = (typeof event.sequence === "number" ? event.sequence : sequence) + 1;
      continue;
    }
    const base = {
      sequence,
      eventId: event.eventId ?? `evt_${randomBytes(8).toString("hex")}`,
      tenantId: tenantId ?? event.tenantId ?? null,
      occurredAt: event.at ?? event.occurredAt ?? now.toISOString(),
      previousHash,
      ...stripReserved(event)
    };
    const hash = computeAuditHash(base, previousHash);
    const finalized = { ...base, hash };
    sealed.push(finalized);
    previousHash = hash;
    sequence += 1;
  }
  return sealed;
}

export function verifyAuditChain(events, tenantId) {
  const source = Array.isArray(events) ? events : [];
  let previousHash = auditGenesisHash(tenantId);
  for (let index = 0; index < source.length; index += 1) {
    const event = source[index];
    if (event.sequence !== index) {
      return { valid: false, brokenAt: index, reason: "sequence_mismatch", eventId: event.eventId ?? null };
    }
    if (event.previousHash !== previousHash) {
      return { valid: false, brokenAt: index, reason: "previous_hash_mismatch", eventId: event.eventId ?? null };
    }
    if (computeAuditHash(event, previousHash) !== event.hash) {
      return { valid: false, brokenAt: index, reason: "hash_mismatch", eventId: event.eventId ?? null };
    }
    previousHash = event.hash;
  }
  return { valid: true, brokenAt: null, reason: null, count: source.length, headHash: previousHash };
}

function matchesFilters(event, filters = {}) {
  if (filters.type && event.type !== filters.type) {
    return false;
  }
  if (filters.from && (event.occurredAt ?? "") < filters.from) {
    return false;
  }
  if (filters.to && (event.occurredAt ?? "") > filters.to) {
    return false;
  }
  if (filters.subjectId) {
    const values = Object.values(event).map((value) => (value == null ? "" : String(value)));
    if (!values.includes(String(filters.subjectId))) {
      return false;
    }
  }
  return true;
}

// A supervisor/auditor-ready evidence pack: the sealed events (optionally
// filtered) plus an integrity attestation covering the whole chain. The
// integrity verdict always covers the full chain, not just the filtered view,
// so a filtered export still proves the underlying record is untampered.
export function buildAuditEvidencePack(events, tenantId, { now = new Date(), filters } = {}) {
  const source = Array.isArray(events) ? events : [];
  const integrity = verifyAuditChain(source, tenantId);
  const exported = source.filter((event) => matchesFilters(event, filters));
  return {
    tenantId: tenantId ?? null,
    generatedAt: now.toISOString(),
    eventCount: source.length,
    exportedCount: exported.length,
    firstEventAt: source[0]?.occurredAt ?? null,
    lastEventAt: source[source.length - 1]?.occurredAt ?? null,
    genesisHash: auditGenesisHash(tenantId),
    headHash: integrity.headHash ?? auditGenesisHash(tenantId),
    integrity,
    events: exported
  };
}
