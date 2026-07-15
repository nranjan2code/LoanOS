#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeStatus, parseRegister } from './planes.mjs';
import { DASHBOARD_STATUSES, parseCatalogueSnapshot } from './dashboard-utils.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const trace = JSON.parse(read('docs/product/capability-trace.json'));
const catalogueSource = read('docs/product/complete-system-capability-catalog.md');
const catalogue = parseRegister(catalogueSource);
const capabilities = catalogue.flatMap((category) => category.features.map((feature) => ({
  ...feature,
  category: `${category.n}. ${category.name}`,
  plane: category.plane,
})));
const policy = JSON.parse(read('docs/product/capability-evidence-policy.json'));
const allowedTypes = new Set(['test', 'code', 'endpoint', 'doc']);
const errors = []; const warnings = [];
const error = (id, message) => errors.push(`${id}: ${message}`);

for (const capability of capabilities) {
  const entry = trace[capability.id];
  if (!entry) { error(capability.id, 'trace entry is missing'); continue; }
  const expectedDerived = {
    capability: capability.name,
    category: capability.category,
    plane: capability.plane,
    applicability: capability.applicability,
    status: normalizeStatus(capability.rawStatus),
  };
  for (const [field, expected] of Object.entries(expectedDerived)) if (entry[field] !== expected) error(capability.id, `${field} is stale; run npm run trace:sync`);
  if (!Array.isArray(entry.evidence)) { error(capability.id, 'evidence must be an array'); continue; }
  const linked = entry.evidence.length > 0;
  if (linked) {
    for (const field of ['owner', 'acceptance', 'notes', 'lastReviewed']) if (typeof entry[field] !== 'string' || !entry[field].trim()) error(capability.id, `${field} is required when evidence is linked`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.lastReviewed ?? '')) error(capability.id, 'lastReviewed must be YYYY-MM-DD');
  }
  const seen = new Set();
  for (const evidence of entry.evidence) {
    if (!allowedTypes.has(evidence?.type)) { error(capability.id, `unsupported evidence type ${evidence?.type ?? '<missing>'}`); continue; }
    if (typeof evidence.ref !== 'string' || !evidence.ref.trim()) { error(capability.id, 'evidence ref is required'); continue; }
    const key = `${evidence.type}:${evidence.ref}`; if (seen.has(key)) error(capability.id, `duplicate evidence ${key}`); seen.add(key);
    if (evidence.type !== 'endpoint') {
      const lineMatch = evidence.ref.match(/:(\d+)$/);
      const path = evidence.ref.replace(/:\d+$/, '');
      if (!existsSync(join(ROOT, path))) error(capability.id, `evidence file does not exist: ${path}`);
      else if (lineMatch) {
        const line = Number(lineMatch[1]);
        const lineCount = readFileSync(join(ROOT, path), 'utf8').split(/\r?\n/).length;
        if (line < 1 || line > lineCount) error(capability.id, `evidence line ${line} is outside ${path} (${lineCount} lines)`);
      }
    } else if (!/^(GET|POST|PUT|PATCH|DELETE) \/[A-Za-z0-9_/:.*?-]+$/.test(evidence.ref)) error(capability.id, `invalid endpoint reference: ${evidence.ref}`);
  }
  if (entry.status === 'Implemented' && linked) {
    if (!entry.evidence.some((item) => item.type === 'test')) error(capability.id, 'Implemented capability requires executable test evidence');
    if (!entry.evidence.some((item) => item.type === 'code' || item.type === 'endpoint')) error(capability.id, 'Implemented capability requires code or endpoint evidence');
  }
  if ((entry.status === 'Partial' || entry.status === 'Partial/Mock' || entry.status === 'Mock') && linked && !/(remain|missing|external|planned|gap|not yet|requires)/i.test(entry.notes)) warnings.push(`${capability.id}: partial/mock evidence should state the remaining gap`);
}

const catalogueIds = new Set(capabilities.map((item) => item.id));
for (const id of Object.keys(trace)) if (!catalogueIds.has(id)) error(id, 'orphan trace entry');
const linked = capabilities.filter((item) => trace[item.id]?.evidence?.length).length;
const implemented = capabilities.filter((item) => normalizeStatus(item.rawStatus) === 'Implemented');
const implementedVerified = implemented.filter((item) => trace[item.id]?.evidence?.some((e) => e.type === 'test') && trace[item.id]?.evidence?.some((e) => e.type === 'code' || e.type === 'endpoint')).length;
const snapshot = parseCatalogueSnapshot(catalogueSource);
const currentCounts = Object.fromEntries(DASHBOARD_STATUSES.map((status) => [status, capabilities.filter((item) => normalizeStatus(item.rawStatus) === status).length]));
if (snapshot.total !== capabilities.length) error('CATALOGUE', `snapshot total ${snapshot.total} does not match parsed total ${capabilities.length}`);
for (const status of DASHBOARD_STATUSES) if (snapshot.counts[status] !== currentCounts[status]) error('CATALOGUE', `${status} snapshot ${snapshot.counts[status]} does not match parsed count ${currentCounts[status]}`);
if (policy.minimumLinkedCapabilities !== capabilities.length) error('POLICY', `linked floor ${policy.minimumLinkedCapabilities} must equal current catalogue total ${capabilities.length}`);
if (policy.minimumVerifiedImplemented !== implemented.length) error('POLICY', `Implemented floor ${policy.minimumVerifiedImplemented} must equal current Implemented total ${implemented.length}`);
if (linked < policy.minimumLinkedCapabilities) error('POLICY', `linked coverage ${linked} is below floor ${policy.minimumLinkedCapabilities}`);
if (implementedVerified < policy.minimumVerifiedImplemented) error('POLICY', `verified Implemented coverage ${implementedVerified} is below floor ${policy.minimumVerifiedImplemented}`);

for (const message of warnings) console.warn(`warning: ${message}`);
console.log(`capability evidence · linked=${linked}/${capabilities.length} · implemented-verified=${implementedVerified}/${implemented.length} · warnings=${warnings.length} · errors=${errors.length}`);
if (errors.length) { for (const message of errors) console.error(`error: ${message}`); process.exitCode = 1; }
