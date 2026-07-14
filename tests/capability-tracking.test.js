import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { normalizeStatus, parseRegister } from '../scripts/planes.mjs';

const catalogueUrl = new URL('../docs/product/complete-system-capability-catalog.md', import.meta.url);
const traceUrl = new URL('../docs/product/capability-trace.json', import.meta.url);
const dashboardDataUrl = new URL('../docs/dashboard-data.json', import.meta.url);

test('capability parser covers the exhaustive catalogue including UX capabilities', async () => {
  const catalogue = await readFile(catalogueUrl, 'utf8');
  const categories = parseRegister(catalogue);
  const capabilities = categories.flatMap((category) => category.features);
  const experience = categories.find((category) => category.n === 32);

  assert.equal(categories.length, 33);
  assert.equal(capabilities.length, 453);
  assert.equal(new Set(capabilities.map((capability) => capability.id)).size, 453);
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
  assert.ok(trace['UX-001']);
  assert.ok(dashboardCapabilities.some((capability) => capability.id === 'UX-017'));
});

test('status normalization remains conservative for unknown labels', () => {
  assert.equal(normalizeStatus('Implemented'), 'Implemented');
  assert.equal(normalizeStatus('Partial/Mock'), 'Partial/Mock');
  assert.equal(normalizeStatus('Missing'), 'Missing');
  assert.equal(normalizeStatus('unrecognised-status'), 'Partial');
});
