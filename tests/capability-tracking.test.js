import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { normalizeStatus, parseRegister } from '../scripts/planes.mjs';
import { parseBacklogEpics, parseTapSummary, rollupCapabilities } from '../scripts/dashboard-utils.mjs';

const catalogueUrl = new URL('../docs/product/complete-system-capability-catalog.md', import.meta.url);
const traceUrl = new URL('../docs/product/capability-trace.json', import.meta.url);
const dashboardDataUrl = new URL('../docs/dashboard-data.json', import.meta.url);

test('capability parser covers the exhaustive catalogue including UX capabilities', async () => {
  const catalogue = await readFile(catalogueUrl, 'utf8');
  const categories = parseRegister(catalogue);
  const capabilities = categories.flatMap((category) => category.features);
  const experience = categories.find((category) => category.n === 32);

  assert.equal(categories.length, 33);
  assert.equal(capabilities.length, 462);
  assert.equal(new Set(capabilities.map((capability) => capability.id)).size, 462);
  assert.equal(experience?.plane, 'Experience & Adoption');
  assert.equal(experience?.features.length, 17);
  assert.deepEqual(
    experience?.features.slice(0, 3).map((capability) => capability.id),
    ['UX-001', 'UX-002', 'UX-003'],
  );
});

test('trace and dashboard artifacts cover every parsed capability', async () => {
  const [catalogue, traceJson, dashboardJson] = await Promise.all([
    readFile(catalogueUrl, 'utf8'),
    readFile(traceUrl, 'utf8'),
    readFile(dashboardDataUrl, 'utf8'),
  ]);
  const parsed = parseRegister(catalogue).flatMap((category) => category.features);
  const trace = JSON.parse(traceJson);
  const dashboard = JSON.parse(dashboardJson);
  const dashboardCapabilities = dashboard.categories.flatMap((category) => category.features);

  assert.equal(Object.keys(trace).length, parsed.length);
  assert.equal(dashboard.overall.total, parsed.length);
  assert.equal(dashboardCapabilities.length, parsed.length);
  assert.ok(dashboard.git.commits.length > 0, 'dashboard must contain recent commits');
  assert.equal(dashboard.epics.length, 13);
  assert.ok(dashboard.epics.every((epic) => epic.status), 'every backlog epic must have an explicit status');
  assert.equal(dashboard.overall.evidenceCount, dashboardCapabilities.filter((capability) => capability.evidence.length).length);
  assert.equal(dashboard.overall.scored + dashboard.overall.excluded, dashboard.overall.total);
  assert.ok(trace['UX-001']);
  assert.ok(dashboardCapabilities.some((capability) => capability.id === 'UX-017'));
});

test('status normalization fails closed for unknown labels', () => {
  assert.equal(normalizeStatus('Implemented'), 'Implemented');
  assert.equal(normalizeStatus('Partial/Mock'), 'Partial/Mock');
  assert.equal(normalizeStatus('Missing'), 'Missing');
  assert.throws(() => normalizeStatus('unrecognised-status'), /Unknown capability status/);
});

test('dashboard helpers parse distant epic statuses and final TAP summary', () => {
  const epics = parseBacklogEpics('## Epic 1: One\n\nGoal: x\n\nStatus: complete.\n\n## Epic 2: Two\nStatus: partial.');
  assert.deepEqual(epics.map((epic) => epic.status), ['complete.', 'partial.']);
  assert.deepEqual(parseTapSummary('ℹ tests 10\nℹ pass 8\nℹ fail 1\nℹ skipped 1\n'), { pass: 8, fail: 1, skipped: 1, total: 10, ran: true, source: 'live' });
});

test('catalogue maturity discloses exclusions and evidence coverage', () => {
  const result = rollupCapabilities([{ status: 'Implemented', evidence: [{ type: 'test' }] }, { status: 'Partial', evidence: [] }, { status: 'External', evidence: [] }]);
  assert.equal(result.maturityPct, 70); assert.equal(result.scored, 2); assert.equal(result.excluded, 1); assert.equal(result.evidencePct, 33);
  assert.equal(result.evidenceQualifiedCount, 0);
});

test('capability evidence validator enforces repository and status integrity', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-capability-evidence.mjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /errors=0/);
});
