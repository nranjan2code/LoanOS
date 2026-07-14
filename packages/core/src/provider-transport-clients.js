import { createHash } from "node:crypto";

export class HttpsProviderClient {
  constructor(config = {}) {
    this.fetch = config.fetchImpl ?? globalThis.fetch; if (typeof this.fetch !== "function") invalid("fetch implementation is required.");
    this.timeoutMs = bounded(config.timeoutMs ?? 5000, 250, 30000, "timeoutMs"); this.maxAttempts = bounded(config.maxAttempts ?? 2, 1, 3, "maxAttempts");
    this.mtls = evidence(config.mtls, ["certificateRef", "privateKeyRef", "caBundleRef", "handshakeEvidenceRef"], "mTLS");
  }
  async postJson(input = {}) {
    const url = httpsUrl(input.url); required(input.idempotencyKey, "idempotencyKey"); required(input.requestChecksumSha256, "requestChecksumSha256"); digest(input.requestChecksumSha256, "requestChecksumSha256");
    const body = canonicalJson(input.payload ?? {}); if (sha(body) !== input.requestChecksumSha256.toLowerCase()) fail("transport_request_checksum_mismatch", "Request checksum does not match canonical payload.");
    let last; for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetch(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey, "x-content-sha256": input.requestChecksumSha256, "x-mtls-evidence-ref": this.mtls.handshakeEvidenceRef, ...(input.headers ?? {}) }, body, signal: AbortSignal.timeout(this.timeoutMs) });
        if (!response || typeof response.status !== "number") fail("transport_response_invalid", "Provider returned no valid HTTP response.");
        if (response.status === 429) { last = transportError("transport_rate_limited", "Provider rate limited the request.", { retryAfter: response.headers?.get?.("retry-after") ?? null }); if (attempt < this.maxAttempts) continue; throw last; }
        if (response.status >= 500) { last = transportError("transport_provider_unavailable", `Provider returned status ${response.status}.`); if (attempt < this.maxAttempts) continue; throw last; }
        if (response.status < 200 || response.status >= 300) fail("transport_provider_rejected", `Provider returned status ${response.status}.`);
        const text = await response.text(); const checksum = response.headers?.get?.("x-content-sha256"); if (!checksum) fail("transport_response_checksum_missing", "Provider response checksum is required."); digest(checksum, "response checksum"); if (sha(text) !== checksum.toLowerCase()) fail("transport_response_checksum_mismatch", "Provider response checksum mismatch.");
        let payload; try { payload = JSON.parse(text); } catch { fail("transport_response_invalid", "Provider response must be JSON."); }
        if (input.validateResponse && input.validateResponse(payload) !== true) fail("transport_response_invalid", "Provider response contract validation failed.");
        return { status: response.status, payload, checksumSha256: checksum.toLowerCase(), idempotencyKey: input.idempotencyKey, attempts: attempt, transport: "https_mtls", mtlsEvidenceRef: this.mtls.handshakeEvidenceRef };
      } catch (error) { if (error.code?.startsWith("transport_") && !["transport_provider_unavailable"].includes(error.code)) throw error; last = error.code ? error : transportError("transport_timeout_or_network_failure", "Provider request timed out or failed at the network boundary.", { cause: error }); if (attempt === this.maxAttempts) throw last; }
    } throw last;
  }
}

export class SftpProviderClient {
  constructor(config = {}) { this.driver = config.driver; if (!this.driver || typeof this.driver.put !== "function" || typeof this.driver.get !== "function") invalid("SFTP driver must implement put and get."); this.connection = evidence(config.connection, ["hostKeyFingerprint", "credentialRef", "connectionEvidenceRef"], "SFTP"); }
  async put(input = {}) { required(input.remotePath, "remotePath"); required(input.idempotencyKey, "idempotencyKey"); const content = buffer(input.content); digest(input.checksumSha256, "checksumSha256"); if (sha(content) !== input.checksumSha256.toLowerCase()) fail("transport_request_checksum_mismatch", "SFTP upload checksum mismatch."); const result = await guarded(() => this.driver.put({ remotePath: input.remotePath, content, idempotencyKey: input.idempotencyKey, checksumSha256: input.checksumSha256, hostKeyFingerprint: this.connection.hostKeyFingerprint }), "SFTP upload"); if (result?.accepted !== true || result.checksumSha256 !== input.checksumSha256) fail("transport_acknowledgement_invalid", "SFTP upload acknowledgement must exactly match checksum."); return { ...result, transport: "sftp", connectionEvidenceRef: this.connection.connectionEvidenceRef }; }
  async get(input = {}) { required(input.remotePath, "remotePath"); const result = await guarded(() => this.driver.get({ remotePath: input.remotePath, hostKeyFingerprint: this.connection.hostKeyFingerprint }), "SFTP download"); const content = buffer(result?.content); digest(result?.checksumSha256, "response checksum"); if (sha(content) !== result.checksumSha256.toLowerCase()) fail("transport_response_checksum_mismatch", "SFTP download checksum mismatch."); return { content, checksumSha256: result.checksumSha256.toLowerCase(), transport: "sftp", connectionEvidenceRef: this.connection.connectionEvidenceRef }; }
}

export class PortalProviderClient {
  constructor(config = {}) { this.driver = config.driver; if (!this.driver || typeof this.driver.submit !== "function" || typeof this.driver.download !== "function") invalid("Portal driver must implement submit and download."); this.session = evidence(config.session, ["portalUrl", "credentialRef", "sessionEvidenceRef"], "portal"); httpsUrl(this.session.portalUrl); }
  async submit(input = {}) { required(input.operation, "operation"); required(input.idempotencyKey, "idempotencyKey"); digest(input.payloadChecksumSha256, "payloadChecksumSha256"); const payload = input.payload ?? {}; if (sha(canonicalJson(payload)) !== input.payloadChecksumSha256.toLowerCase()) fail("transport_request_checksum_mismatch", "Portal payload checksum mismatch."); const result = await guarded(() => this.driver.submit({ operation: input.operation, payload, idempotencyKey: input.idempotencyKey, payloadChecksumSha256: input.payloadChecksumSha256, portalUrl: this.session.portalUrl }), "Portal submission"); if (result?.accepted !== true || !result.providerReference || result.payloadChecksumSha256 !== input.payloadChecksumSha256) fail("transport_acknowledgement_invalid", "Portal acknowledgement is incomplete or checksum-mismatched."); return { ...result, transport: "portal", sessionEvidenceRef: this.session.sessionEvidenceRef }; }
  async download(input = {}) { required(input.providerReference, "providerReference"); const result = await guarded(() => this.driver.download({ providerReference: input.providerReference, portalUrl: this.session.portalUrl }), "Portal download"); const content = buffer(result?.content); digest(result?.checksumSha256, "response checksum"); if (sha(content) !== result.checksumSha256.toLowerCase()) fail("transport_response_checksum_mismatch", "Portal download checksum mismatch."); return { content, checksumSha256: result.checksumSha256.toLowerCase(), transport: "portal", sessionEvidenceRef: this.session.sessionEvidenceRef }; }
}

export function canonicalJson(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; }
export function transportChecksum(value) { return sha(typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value)); }
function evidence(value, fields, label) { if (!value || typeof value !== "object") invalid(`${label} evidence is required.`); fields.forEach((field) => required(value[field], `${label}.${field}`)); return { ...value }; }
function httpsUrl(value) { required(value, "url"); let parsed; try { parsed = new URL(value); } catch { invalid("Provider URL is invalid."); } if (parsed.protocol !== "https:") fail("transport_https_required", "Provider transport requires HTTPS."); return parsed.toString(); }
function buffer(value) { if (Buffer.isBuffer(value)) return value; if (typeof value === "string") return Buffer.from(value); fail("transport_payload_invalid", "Transport content must be a string or Buffer."); }
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function digest(value, field) { if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) invalid(`${field} must be a SHA-256 digest.`); }
function bounded(value, min, max, field) { if (!Number.isInteger(value) || value < min || value > max) invalid(`${field} must be between ${min} and ${max}.`); return value; }
function required(value, field) { if (typeof value !== "string" || !value.trim()) invalid(`${field} is required.`); }
async function guarded(action, label) { try { return await action(); } catch (error) { if (error.code?.startsWith("transport_")) throw error; throw transportError("transport_driver_failure", `${label} failed closed.`, { cause: error }); } }
function transportError(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
function invalid(message) { fail("transport_configuration_invalid", message); }
function fail(code, message) { throw transportError(code, message); }
