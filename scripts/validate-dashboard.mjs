#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeStatus, parseRegister } from './planes.mjs';
import { DASHBOARD_STATUSES, rollupCapabilities } from './dashboard-utils.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const catalogueSource = read('docs/product/complete-system-capability-catalog.md');
const traceSource = read('docs/product/capability-trace.json');
const backlogSource = read('docs/product/build-backlog.md');
const data = JSON.parse(read('docs/dashboard-data.json'));
const html = read('docs/dashboard.html');
const categories = parseRegister(catalogueSource);
const parsed = categories.flatMap((category) => category.features.map((feature) => ({
  id: feature.id,
  status: normalizeStatus(feature.rawStatus),
})));
const expectedRollup = rollupCapabilities(parsed);
const sourceDigest = createHash('sha256')
  .update(catalogueSource)
  .update('\0')
  .update(traceSource)
  .update('\0')
  .update(backlogSource)
  .update('\0')
  .update(read('scripts/build-dashboard.mjs'))
  .update('\0')
  .update(read('scripts/dashboard-utils.mjs'))
  .update('\0')
  .update(read('scripts/planes.mjs'))
  .update('\0')
  .update(read('docs/gtm/brand/brand-guide.md'))
  .update('\0')
  .update(readFileSync(join(ROOT, 'apps/web/assets/loanos-logo-mark.png')))
  .digest('hex')
  .slice(0, 16);
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };

check(data.schemaVersion === 2, `expected schemaVersion 2, found ${data.schemaVersion}`);
check(typeof data.snapshotId === 'string' && /^[a-f0-9]{16}$/.test(data.snapshotId), 'snapshotId is missing or malformed');
check(data.sourceDigest === sourceDigest, `dashboard source digest is stale: expected ${sourceDigest}, found ${data.sourceDigest}`);
check(Number.isFinite(Date.parse(data.generated)), 'generated timestamp is invalid');
check(data.overall?.total === parsed.length, `dashboard total ${data.overall?.total} does not match parsed total ${parsed.length}`);
for (const status of DASHBOARD_STATUSES) check(data.overall?.counts?.[status] === expectedRollup.counts[status], `${status} dashboard count is stale`);
const dashboardFeatures = (data.categories || []).flatMap((category) => category.features || []);
check(dashboardFeatures.length === parsed.length, 'dashboard feature projection is incomplete');
check(new Set(dashboardFeatures.map((feature) => feature.id)).size === parsed.length, 'dashboard feature projection contains missing or duplicate IDs');
check((data.owners || []).reduce((total, owner) => total + owner.total, 0) === parsed.length, 'owner/persona roll-up does not cover the full catalogue');
const expectedAttention = parsed.filter((feature) => ['Missing', 'Mock', 'Partial/Mock', 'Partial'].includes(feature.status)).length;
check(data.attention?.length === expectedAttention, 'constraint queue is stale');
check(data.tests?.ran === true, 'dashboard must contain a completed test summary');
if (data.tests?.ran) {
  const accounted = ['pass', 'fail', 'skipped', 'cancelled', 'todo'].reduce((total, key) => total + (data.tests[key] ?? 0), 0);
  check(accounted === data.tests.total, `test summary accounts for ${accounted}/${data.tests.total} tests`);
  check(data.tests.fail === 0, `dashboard test snapshot contains ${data.tests.fail} failures`);
  check(data.tests.cancelled === 0, `dashboard test snapshot contains ${data.tests.cancelled} cancelled tests`);
}
check(html.includes(data.snapshotId), 'HTML does not embed the current snapshot ID');
check(html.includes('data:image/png;base64,'), 'HTML does not embed the approved brand mark');
check(html.includes('--forest:#123e32') && html.includes('--paper:#f7f4ec') && html.includes('--saffron:#f0a064'), 'HTML is missing canonical brand tokens');
check(html.includes('Copy agent work packet'), 'HTML is missing agent-ready work packets');
check(html.includes("fetch('./dashboard-data.json?check='"), 'HTML is missing cache-bypassed live polling');
check(html.includes('Offline repository snapshot'), 'HTML is missing honest offline-state labeling');

console.log(`dashboard integrity · schema=${data.schemaVersion} · snapshot=${data.snapshotId} · sources=${data.sourceDigest} · capabilities=${dashboardFeatures.length} · owners=${data.owners?.length ?? 0} · attention=${data.attention?.length ?? 0} · errors=${errors.length}`);
for (const message of errors) console.error(`error: ${message}`);
if (errors.length) process.exitCode = 1;
