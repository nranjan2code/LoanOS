/**
 * Shared tamper-evidence sealing for AI-agent platform records.
 *
 * Every governed agent record (installations, contracts, executions,
 * knowledge packs, test runs, versions, …) carries a `recordHash` so that
 * tampering with persisted state is detectable and so downstream gates
 * (e.g. `publishAgentVersion` binding a test run to the exact installation
 * draft it rehearsed) can compare records by content. Two properties are
 * load-bearing and must hold for every sealed record in this domain:
 *
 * 1. **Recomputability** — `recordHash` is the SHA-256 of the record's own
 *    content with the `recordHash` field removed, over a canonical
 *    (sorted-key) JSON encoding. Anyone holding the record can re-derive
 *    and verify the hash; the hash never covers a *previous* stale hash.
 * 2. **Key-order independence** — object key insertion order (an accident
 *    of construction) must not change the hash, so records rebuilt via
 *    spread/merge reseal to the same value when their content is equal.
 *
 * `ai-agent-platform.js` and `agent-studio-governance.js` both reseal the
 * same installation records at different lifecycle points; they MUST use
 * this one implementation so their seals agree.
 */
import { createHash } from "node:crypto";

/**
 * Canonical JSON encoding: arrays in order, object keys sorted, scalars via
 * JSON.stringify. Deterministic regardless of construction order.
 * @param {*} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/**
 * SHA-256 hex digest of a value's canonical JSON encoding.
 * @param {*} value
 * @returns {string}
 */
export function contentHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * Seal a record: strip any previous `recordHash`, normalize through a JSON
 * round-trip (dropping `undefined` fields so the persisted form and the
 * hashed form are identical), and attach the recomputable content hash.
 * @param {object} value - record to seal; a stale `recordHash` is ignored.
 * @returns {object} the cleaned record with a fresh `recordHash`.
 */
export function sealRecord(value) {
  const clean = JSON.parse(JSON.stringify(value));
  delete clean.recordHash;
  return { ...clean, recordHash: contentHash(clean) };
}
