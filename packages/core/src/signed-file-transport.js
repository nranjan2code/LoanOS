import { createHash } from "node:crypto";

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const required = (value, field) => { if (typeof value !== "string" || !value.trim()) fail("signed_transport_input_invalid", `${field} is required.`); return value.trim(); };
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const stable = (value) => { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); };
const escapeXml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const unescapeXml = (value) => value.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
const csvCell = (value) => { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
const parseCsvLine = (line) => { const cells = []; let value = ""; let quoted = false; for (let i = 0; i < line.length; i += 1) { const char = line[i]; if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { cells.push(value); value = ""; } else value += char; } if (quoted) fail("signed_serializer_csv_invalid", "CSV contains an unterminated quoted value."); cells.push(value); return cells; };

export function serializeSignedFile(rows, input = {}) {
  if (!Array.isArray(rows) || !rows.length) fail("signed_serializer_rows_missing", "Rows are required.");
  const format = required(input.format, "format"); const columns = input.columns ?? Object.keys(rows[0]).sort(); if (!columns.length || new Set(columns).size !== columns.length) fail("signed_serializer_columns_invalid", "Unique columns are required.");
  for (const row of rows) for (const column of columns) if (row[column] === undefined || row[column] === null) fail("signed_serializer_value_missing", `Missing value for ${column}.`);
  let content;
  if (format === "json") content = stable(rows);
  else if (format === "csv") content = [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n") + "\n";
  else if (format === "xml") content = `<?xml version="1.0" encoding="UTF-8"?><records>${rows.map((row) => `<record>${columns.map((column) => `<${column}>${escapeXml(row[column])}</${column}>`).join("")}</record>`).join("")}</records>`;
  else if (format === "fixed_width") {
    const specs = input.columnSpecs; if (!Array.isArray(specs) || specs.map((s) => s.name).join("|") !== columns.join("|") || specs.some((s) => !Number.isInteger(s.width) || s.width < 1 || !["left", "right"].includes(s.align ?? "left"))) fail("signed_serializer_fixed_spec_invalid", "Fixed-width specs must match columns with positive widths.");
    content = rows.map((row) => specs.map((spec) => { const value = String(row[spec.name]); if (Buffer.byteLength(value, "utf8") !== value.length || value.length > spec.width) fail("signed_serializer_fixed_value_invalid", `Fixed-width value for ${spec.name} is non-ASCII or too long.`); return (spec.align ?? "left") === "right" ? value.padStart(spec.width, spec.pad ?? " ") : value.padEnd(spec.width, spec.pad ?? " "); }).join("")).join("\n") + "\n";
  } else fail("signed_serializer_format_invalid", "Format must be csv, json, xml, or fixed_width.");
  const bytes = Buffer.from(content, "utf8");
  return { format, columns: [...columns], mediaType: { csv: "text/csv", json: "application/json", xml: "application/xml", fixed_width: "text/plain" }[format], bytes, byteLength: bytes.length, checksumSha256: sha256(bytes), rowCount: rows.length };
}

export function parseSignedFile(bytes, input = {}) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) fail("signed_parser_bytes_invalid", "Binary file bytes are required.");
  if (input.expectedChecksumSha256 && sha256(bytes) !== input.expectedChecksumSha256) fail("signed_parser_checksum_mismatch", "Binary checksum does not match the expected file.");
  const content = Buffer.from(bytes).toString("utf8"); const format = required(input.format, "format"); let rows;
  if (format === "json") { try { rows = JSON.parse(content); } catch { fail("signed_parser_json_invalid", "JSON file is invalid."); } }
  else if (format === "csv") { const lines = content.replace(/\n$/, "").split("\n"); const columns = parseCsvLine(lines.shift() ?? ""); rows = lines.map((line) => Object.fromEntries(columns.map((column, index) => [column, parseCsvLine(line)[index]]))); }
  else if (format === "xml") { const columns = input.columns ?? []; rows = [...content.matchAll(/<record>([\s\S]*?)<\/record>/g)].map((match) => Object.fromEntries(columns.map((column) => { const value = match[1].match(new RegExp(`<${column}>([\\s\\S]*?)</${column}>`)); if (!value) fail("signed_parser_xml_invalid", `XML field ${column} is missing.`); return [column, unescapeXml(value[1])]; }))); }
  else if (format === "fixed_width") { const specs = input.columnSpecs ?? []; if (!specs.length) fail("signed_parser_fixed_spec_invalid", "Fixed-width specs are required."); rows = content.replace(/\n$/, "").split("\n").map((line) => { let offset = 0; const row = {}; for (const spec of specs) { row[spec.name] = line.slice(offset, offset + spec.width).trim(); offset += spec.width; } if (offset !== line.length) fail("signed_parser_fixed_width_invalid", "Fixed-width row length does not match its profile."); return row; }); }
  else fail("signed_serializer_format_invalid", "Format must be csv, json, xml, or fixed_width.");
  if (!Array.isArray(rows) || !rows.length) fail("signed_parser_rows_missing", "Parsed file must contain rows.");
  return { rows, rowCount: rows.length, byteLength: Buffer.byteLength(content), checksumSha256: sha256(bytes) };
}

export function createTransportRecord(registry = {}, envelope, file, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId"); if (!envelope || envelope.tenantId !== tenantId || envelope.status !== "ready") fail("signed_transport_envelope_invalid", "Same-tenant ready conformance envelope is required.");
  if (file?.checksumSha256 !== envelope.encryptedPayloadChecksumSha256 && file?.checksumSha256 !== envelope.payloadChecksumSha256) fail("signed_transport_file_mismatch", "Serialized binary is not bound to the conformance envelope.");
  const transportId = required(input.transportId, "transportId"); const idempotencyKey = required(input.idempotencyKey, "idempotencyKey"); if (!['sftp', 'api', 'portal'].includes(input.channel)) fail("signed_transport_channel_invalid", "Transport channel must be sftp, api, or portal.");
  for (const field of ["destinationRef", "credentialRef", "networkPolicyRef"]) required(input[field], field);
  const immutable = { tenantId, transportId, idempotencyKey, envelopeId: envelope.envelopeId, system: envelope.system, channel: input.channel, destinationRef: input.destinationRef, credentialRef: input.credentialRef, networkPolicyRef: input.networkPolicyRef, fileChecksumSha256: file.checksumSha256, fileByteLength: file.byteLength, manifestChecksumSha256: envelope.manifestChecksumSha256 };
  const evidenceChecksumSha256 = sha256(Buffer.from(stable(immutable))); const existing = Object.values(registry).find((row) => row.tenantId === tenantId && (row.transportId === transportId || row.idempotencyKey === idempotencyKey));
  if (existing) { if (existing.evidenceChecksumSha256 !== evidenceChecksumSha256) fail("signed_transport_idempotency_conflict", "Transport identity was reused with different content."); return { registry, transport: existing, idempotent: true }; }
  const transport = { ...immutable, evidenceChecksumSha256, attempt: 1, status: "prepared", providerRequestRef: null, pollHistory: [], createdAt: now.toISOString() };
  return { registry: { ...registry, [`${tenantId}:${transportId}`]: transport }, transport, idempotent: false };
}

export function markTransportDispatched(registry = {}, input, now = new Date()) {
  const key = `${required(input?.tenantId, "tenantId")}:${required(input?.transportId, "transportId")}`; const transport = registry[key]; if (!transport || transport.status !== "prepared") fail("signed_transport_not_prepared", "Prepared same-tenant transport is required.");
  required(input.providerRequestRef, "providerRequestRef"); required(input.dispatchEvidenceRef, "dispatchEvidenceRef");
  const updated = { ...transport, status: "dispatched", providerRequestRef: input.providerRequestRef, dispatchEvidenceRef: input.dispatchEvidenceRef, dispatchedAt: now.toISOString() };
  return { registry: { ...registry, [key]: updated }, transport: updated };
}

export function recordTransportPoll(registry = {}, input, now = new Date()) {
  const key = `${required(input?.tenantId, "tenantId")}:${required(input?.transportId, "transportId")}`; const transport = registry[key]; if (!transport) fail("signed_transport_not_pollable", "Dispatched same-tenant transport is required.");
  required(input.pollRef, "pollRef"); required(input.pollEvidenceRef, "pollEvidenceRef"); if (!['pending', 'accepted', 'rejected', 'partial'].includes(input.providerStatus)) fail("signed_transport_poll_status_invalid", "Provider poll status is invalid.");
  const prior = transport.pollHistory.find((row) => row.pollRef === input.pollRef); const body = { pollRef: input.pollRef, pollEvidenceRef: input.pollEvidenceRef, providerStatus: input.providerStatus, acknowledgementRef: input.acknowledgementRef ?? null, acknowledgedManifestChecksumSha256: input.acknowledgedManifestChecksumSha256 ?? null };
  if (prior) { if (prior.evidenceChecksumSha256 !== sha256(Buffer.from(stable(body)))) fail("signed_transport_poll_replay", "Poll reference was replayed with different content."); return { registry, transport, idempotent: true }; }
  if (!["dispatched", "polling"].includes(transport.status)) fail("signed_transport_not_pollable", "Dispatched same-tenant transport is required.");
  if (input.providerStatus !== "pending" && (!input.acknowledgementRef || input.acknowledgedManifestChecksumSha256 !== transport.manifestChecksumSha256)) fail("signed_transport_ack_mismatch", "Final provider acknowledgement must bind the manifest.");
  const poll = { ...body, evidenceChecksumSha256: sha256(Buffer.from(stable(body))), polledAt: now.toISOString() }; const status = input.providerStatus === "pending" ? "polling" : input.providerStatus;
  const updated = { ...transport, status, pollHistory: [...transport.pollHistory, poll], updatedAt: now.toISOString() };
  return { registry: { ...registry, [key]: updated }, transport: updated, poll, idempotent: false };
}

export function createTransportResubmission(registry = {}, input, now = new Date()) {
  const tenantId = required(input?.tenantId, "tenantId"); const parent = registry[`${tenantId}:${input?.parentTransportId}`]; if (!parent || !["rejected", "partial"].includes(parent.status)) fail("signed_transport_resubmit_parent_invalid", "Rejected or partial same-tenant parent transport is required.");
  required(input.correctionId, "correctionId"); required(input.correctionEvidenceRef, "correctionEvidenceRef"); const transportId = required(input.transportId, "transportId"); const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
  const transport = { ...parent, transportId, idempotencyKey, parentTransportId: parent.transportId, rootTransportId: parent.rootTransportId ?? parent.transportId, correctionId: input.correctionId, correctionEvidenceRef: input.correctionEvidenceRef, attempt: parent.attempt + 1, status: "prepared", providerRequestRef: null, pollHistory: [], createdAt: now.toISOString(), evidenceChecksumSha256: sha256(Buffer.from(stable({ tenantId, transportId, idempotencyKey, parentTransportId: parent.transportId, correctionId: input.correctionId, attempt: parent.attempt + 1 }))) };
  const key = `${tenantId}:${transportId}`; if (registry[key]) fail("signed_transport_resubmit_duplicate", "Resubmission transport already exists.");
  return { registry: { ...registry, [key]: transport }, transport };
}
