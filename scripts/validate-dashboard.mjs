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
const architectureModelSource = read('docs/architecture/loanos-system-map.json');
const architectureSvgSource = read('docs/architecture/loanos-system-architecture.svg');
const journeyDepthSource = read('docs/product/product-journey-platform-depth.json');
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
  .update(architectureModelSource)
  .update('\0')
  .update(architectureSvgSource)
  .update('\0')
  .update(journeyDepthSource)
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

check(data.schemaVersion === 3, `expected schemaVersion 3, found ${data.schemaVersion}`);
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
check(data.architecture?.artifact === 'docs/architecture/loanos-system-architecture.svg', 'dashboard architecture artifact is missing');
check(data.architecture?.layers === 7 && data.architecture?.nodes > 40, 'dashboard architecture summary is incomplete');
check(data.architecture?.digest === createHash('sha256').update(architectureSvgSource).digest('hex').slice(0, 16), 'dashboard architecture digest is stale');
check(data.journeyReadiness?.total === 21 && data.journeyReadiness?.productionReady === 0, 'dashboard journey-readiness summary is not truthful');
check(['healthy', 'attention', 'blocked'].includes(data.repositoryHealth?.state), 'repository health state is invalid');
check(Array.isArray(data.repositoryHealth?.signals) && data.repositoryHealth.signals.length === 4, 'repository health signals are incomplete');
check(Array.isArray(data.issueQueue), 'repository issue queue is missing');
check(data.tests?.ran === true, 'dashboard must contain a completed test summary');
if (data.tests?.ran) {
  const accounted = ['pass', 'fail', 'skipped', 'cancelled', 'todo'].reduce((total, key) => total + (data.tests[key] ?? 0), 0);
  check(accounted === data.tests.total, `test summary accounts for ${accounted}/${data.tests.total} tests`);
  check(data.tests.fail === 0, `dashboard test snapshot contains ${data.tests.fail} failures`);
  check(data.tests.cancelled === 0, `dashboard test snapshot contains ${data.tests.cancelled} cancelled tests`);
}
check(html.includes(data.snapshotId), 'HTML does not embed the current snapshot ID');
check(html.includes('data:image/png;base64,'), 'HTML does not embed the approved brand mark');
check(html.includes('data:image/svg+xml;base64,'), 'HTML does not embed the governed architecture map');
check(html.includes('Engineering &amp; operational readiness'), 'HTML is missing the engineering and operational readiness panel');
check(html.includes('Live operations are a separate, protected view'), 'HTML does not disclose the live-runtime boundary');
check(html.includes('--forest:#123e32') && html.includes('--paper:#f7f4ec') && html.includes('--saffron:#f0a064'), 'HTML is missing canonical brand tokens');
check(html.includes('Copy agent work packet'), 'HTML is missing agent-ready work packets');
check(html.includes("fetch('./dashboard-data.json?check='"), 'HTML is missing cache-bypassed live polling');
check(html.includes('Offline repository snapshot'), 'HTML is missing honest offline-state labeling');

console.log(`dashboard integrity · schema=${data.schemaVersion} · snapshot=${data.snapshotId} · sources=${data.sourceDigest} · capabilities=${dashboardFeatures.length} · architecture=${data.architecture?.nodes ?? 0} nodes · health=${data.repositoryHealth?.state ?? 'missing'} · owners=${data.owners?.length ?? 0} · attention=${data.attention?.length ?? 0} · errors=${errors.length}`);
for (const message of errors) console.error(`error: ${message}`);
if (errors.length) process.exitCode = 1;
