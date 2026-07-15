#!/usr/bin/env node
// Generates the branded, self-contained LoanOS capability/build dashboard from
// repository sources. The build fails closed when the catalogue summary, trace
// projection, or product-plane mapping is stale.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLANE_ORDER, normalizeStatus, parseRegister } from './planes.mjs';
import {
  DASHBOARD_STATUSES,
  parseBacklogEpics,
  parseCatalogueSnapshot,
  parseTapSummary,
  rollupCapabilities,
} from './dashboard-utils.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const gitCommand = (...args) => execFileSync('git', args, {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
}).trim();
const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');
const serializeForScript = (value) => JSON.stringify(value)
  .replaceAll('<', '\\u003c')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029');
const formatIst = (value) => `${new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
}).format(new Date(value))} IST`;
const atomicWrite = (path, contents) => {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, contents);
  renameSync(temp, path);
};

const catalogueSource = read('docs/product/complete-system-capability-catalog.md');
const traceSource = read('docs/product/capability-trace.json');
const backlogSource = read('docs/product/build-backlog.md');
const trace = JSON.parse(traceSource);

const categories = parseRegister(catalogueSource).map((category) => ({
  ...category,
  features: category.features.map((feature) => {
    const entry = trace[feature.id];
    if (!entry) throw new Error(`Trace entry ${feature.id} is missing. Run npm run trace:sync.`);
    const expected = {
      capability: feature.name,
      category: `${category.n}. ${category.name}`,
      plane: category.plane,
      applicability: feature.applicability,
      status: normalizeStatus(feature.rawStatus),
    };
    for (const [field, value] of Object.entries(expected)) {
      if (entry[field] !== value) throw new Error(`Trace entry ${feature.id} has stale ${field}. Run npm run trace:sync.`);
    }
    return {
      id: feature.id,
      name: feature.name,
      applicability: feature.applicability,
      status: expected.status,
      raw: feature.rawStatus,
      evidence: entry.evidence || [],
      owner: entry.owner || '',
      acceptance: entry.acceptance || '',
      dependencies: entry.dependencies || [],
      notes: entry.notes || '',
      lastReviewed: entry.lastReviewed || '',
    };
  }),
}));

const allFeatures = categories.flatMap((category) => category.features);
const liveIds = new Set(allFeatures.map((feature) => feature.id));
const orphanedTraceIds = Object.keys(trace).filter((id) => !liveIds.has(id));
if (orphanedTraceIds.length) throw new Error(`Trace contains orphaned entries: ${orphanedTraceIds.join(', ')}`);

const rollup = (features) => {
  const result = rollupCapabilities(features);
  return { ...result, pct: result.maturityPct };
};
for (const category of categories) Object.assign(category, rollup(category.features));
const overall = rollup(allFeatures);
const snapshot = parseCatalogueSnapshot(catalogueSource);
if (snapshot.total !== overall.total) throw new Error(`Catalogue snapshot total ${snapshot.total} does not match parsed total ${overall.total}.`);
for (const status of DASHBOARD_STATUSES) {
  if (snapshot.counts[status] !== overall.counts[status]) {
    throw new Error(`Catalogue snapshot ${status} count ${snapshot.counts[status]} does not match parsed count ${overall.counts[status]}.`);
  }
}

const ownerGroups = new Map();
for (const feature of allFeatures) {
  const owner = feature.owner || 'Unassigned';
  if (!ownerGroups.has(owner)) ownerGroups.set(owner, []);
  ownerGroups.get(owner).push(feature);
}
const owners = [...ownerGroups.entries()].map(([name, features]) => {
  const result = rollup(features);
  return {
    name,
    ...result,
    open: result.counts.Partial + result.counts['Partial/Mock'] + result.counts.Mock + result.counts.Missing,
  };
}).sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
const attentionRank = { Missing: 0, Mock: 1, 'Partial/Mock': 2, Partial: 3 };
const attention = categories.flatMap((category) => category.features.map((feature) => ({
  id: feature.id,
  name: feature.name,
  status: feature.status,
  owner: feature.owner || 'Unassigned',
  plane: category.plane,
  category: `${category.n}. ${category.name}`,
  acceptance: feature.acceptance,
  notes: feature.notes,
  dependencies: feature.dependencies,
  evidence: feature.evidence,
}))).filter((feature) => feature.status in attentionRank)
  .sort((left, right) => attentionRank[left.status] - attentionRank[right.status] || left.id.localeCompare(right.id));

const planes = PLANE_ORDER.map((name) => {
  const planeCategories = categories.filter((category) => category.plane === name);
  const features = planeCategories.flatMap((category) => category.features);
  return {
    name,
    categories: planeCategories.map((category) => ({
      n: category.n,
      name: category.name,
      pct: category.pct,
      total: category.total,
    })),
    ...rollup(features),
  };
}).filter((plane) => plane.total);

const epics = parseBacklogEpics(backlogSource);
if (!epics.length || epics.some((epic) => !epic.status)) throw new Error('Every backlog epic must have an explicit Status line.');

let git = { branch: 'unavailable', sha: 'unavailable', count: 0, dirty: false, changeCount: 0, commits: [] };
try {
  const status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  git = {
    branch: gitCommand('branch', '--show-current') || '(detached)',
    sha: gitCommand('rev-parse', '--short=12', 'HEAD'),
    count: Number(gitCommand('rev-list', '--count', 'HEAD')),
    dirty: Boolean(status),
    changeCount: status ? status.split('\0').filter(Boolean).length : 0,
    commits: gitCommand('log', '-12', '--format=%h%x00%s%x00%cr').split('\n').filter(Boolean).map((line) => {
      const [hash, subject, when] = line.split('\0');
      return { hash, subject, when };
    }),
  };
} catch {}

let tests = {
  pass: null,
  fail: null,
  skipped: null,
  cancelled: null,
  todo: null,
  total: null,
  durationMs: null,
  ran: false,
  source: 'none',
  error: '',
};
try {
  let output = '';
  let executionError = '';
  const logPath = process.env.DASHBOARD_TEST_LOG;
  if (logPath) {
    output = readFileSync(isAbsolute(logPath) ? logPath : join(ROOT, logPath), 'utf8');
  } else {
    const testFiles = readdirSync(join(ROOT, 'tests'))
      .filter((name) => name.endsWith('.test.js'))
      .sort()
      .map((name) => `tests/${name}`);
    const result = spawnSync(process.execPath, ['--test', ...testFiles], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 64 * 1024 * 1024,
    });
    output = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.error) executionError = result.error.message;
    else if (result.signal) executionError = `test run terminated by ${result.signal}`;
  }
  const parsed = parseTapSummary(output);
  tests = {
    ...parsed,
    source: logPath ? 'provided-log' : 'live',
    error: executionError || (parsed.ran ? '' : 'TAP summary not found'),
  };
} catch (error) {
  tests.error = error instanceof Error ? error.message : String(error);
}

const generated = new Date().toISOString();
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
const snapshotId = createHash('sha256').update(JSON.stringify({
  generated,
  sourceDigest,
  git: { sha: git.sha, dirty: git.dirty, changeCount: git.changeCount },
  tests: {
    pass: tests.pass,
    fail: tests.fail,
    skipped: tests.skipped,
    cancelled: tests.cancelled,
    todo: tests.todo,
    total: tests.total,
    source: tests.source,
  },
})).digest('hex').slice(0, 16);
const data = {
  schemaVersion: 2,
  generated,
  sourceDigest,
  snapshotId,
  sources: {
    catalogue: 'docs/product/complete-system-capability-catalog.md',
    trace: 'docs/product/capability-trace.json',
    planes: 'scripts/planes.mjs',
    backlog: 'docs/product/build-backlog.md',
    tests: tests.source === 'provided-log' ? 'reused build test log' : 'live Node test run',
  },
  git,
  overall,
  planes,
  categories,
  owners,
  attention,
  epics,
  tests,
};

const STATUS_STYLE = {
  Implemented: { solid: '#2d765f', soft: '#e3efe9', text: '#174c3d' },
  Partial: { solid: '#f0a064', soft: '#fae6d6', text: '#6f3515' },
  'Partial/Mock': { solid: '#e59a94', soft: '#f8e2df', text: '#733d38' },
  Mock: { solid: '#bb706b', soft: '#f3dcda', text: '#6b302c' },
  Missing: { solid: '#a33f3a', soft: '#f4dcda', text: '#792d29' },
  Partner: { solid: '#73b7bb', soft: '#dceff0', text: '#20595c' },
  External: { solid: '#7c8984', soft: '#e7eae8', text: '#46534e' },
};
const stacked = (counts, total, label) => {
  const segments = DASHBOARD_STATUSES.filter((status) => counts[status]).map((status) => (
    `<span class="bar-segment" title="${escapeHtml(status)}: ${counts[status]}" style="width:${(counts[status] / total * 100).toFixed(2)}%;background:${STATUS_STYLE[status].solid}"></span>`
  )).join('');
  return `<div class="status-bar" role="img" aria-label="${escapeHtml(label)}">${segments}</div>`;
};
const legend = DASHBOARD_STATUSES.map((status) => (
  `<span class="legend-item"><i style="background:${STATUS_STYLE[status].solid}"></i>${escapeHtml(status)} <strong>${overall.counts[status]}</strong></span>`
)).join('');
const statusDescription = DASHBOARD_STATUSES.map((status) => `${status} ${overall.counts[status]}`).join(', ');
const planeRows = planes.map((plane) => `
  <article class="plane-row">
    <div class="plane-heading"><div><p class="plane-name">${escapeHtml(plane.name)}</p><p class="meta">${plane.counts.Implemented} implemented · ${plane.counts.Missing} missing · ${plane.total} capabilities</p></div><strong class="plane-pct">${plane.pct}%</strong></div>
    ${stacked(plane.counts, plane.total, `${plane.name}: ${DASHBOARD_STATUSES.map((status) => `${status} ${plane.counts[status]}`).join(', ')}`)}
    <div class="category-chips">${plane.categories.map((category) => `<span>${category.n}. ${escapeHtml(category.name)} <strong>${category.pct}%</strong></span>`).join('')}</div>
  </article>`).join('');
const commitRows = git.commits.map((commit) => `<tr><td class="mono">${escapeHtml(commit.hash)}</td><td>${escapeHtml(commit.subject)}</td><td class="meta">${escapeHtml(commit.when)}</td></tr>`).join('');
const epicRows = epics.map((epic) => `<tr><td>${escapeHtml(epic.name)}</td><td>${escapeHtml(epic.status)}</td></tr>`).join('');
const testParts = tests.ran
  ? `${tests.pass ?? 0} passing · ${tests.fail ?? 0} failing · ${tests.skipped ?? 0} skipped${(tests.cancelled ?? 0) ? ` · ${tests.cancelled} cancelled` : ''}${(tests.todo ?? 0) ? ` · ${tests.todo} todo` : ''}`
  : `Unavailable${tests.error ? ` · ${tests.error}` : ''}`;
const testMetric = tests.ran ? `${tests.pass ?? 0} / ${tests.total ?? 0}` : 'Not run';
const testTone = tests.ran && tests.fail === 0 && (tests.cancelled ?? 0) === 0 ? 'good' : 'attention';
const dirtyLabel = git.dirty ? `${git.changeCount} uncommitted change${git.changeCount === 1 ? '' : 's'} included` : 'Clean working tree';
const logoData = readFileSync(join(ROOT, 'apps/web/assets/loanos-logo-mark.png')).toString('base64');
const attentionRows = attention.slice(0, 12).map((feature) => `<tr><td><button class="queue-jump" type="button" data-capability="${feature.id}"><span class="mono">${feature.id}</span><strong>${escapeHtml(feature.name)}</strong></button><span class="meta">${escapeHtml(feature.plane)} · ${escapeHtml(feature.owner)}</span></td><td><span class="tag" style="background:${STATUS_STYLE[feature.status].soft};color:${STATUS_STYLE[feature.status].text}">${escapeHtml(feature.status)}</span></td></tr>`).join('');
const ownerRows = owners.map((owner) => `<tr><td><button class="owner-jump" type="button" data-owner="${escapeHtml(owner.name)}">${escapeHtml(owner.name)}</button></td><td>${owner.total}</td><td>${owner.counts.Implemented}</td><td>${owner.open}</td><td><strong>${owner.maturityPct}%</strong></td></tr>`).join('');
const planeOptions = planes.map((plane) => `<option value="${escapeHtml(plane.name)}">${escapeHtml(plane.name)} · ${plane.total}</option>`).join('');
const ownerOptions = owners.map((owner) => `<option value="${escapeHtml(owner.name)}">${escapeHtml(owner.name)} · ${owner.total}</option>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#123e32">
  <meta name="description" content="LoanOS India repository-backed capability and build status.">
  <title>Capability &amp; Build Dashboard · LoanOS India</title>
  <style>
    :root {
      --ink:#10241f;--forest:#123e32;--forest-deep:#082b23;--leaf:#2d765f;--lime:#dff276;--lime-soft:#edf6bd;--saffron:#f0a064;--rose:#e59a94;--sky:#b9dfe1;--paper:#f7f4ec;--sand:#f1ecdf;--white:#fff;--muted:#5b6863;--line:rgba(8,43,35,.16);--shadow:0 18px 52px rgba(8,43,35,.10);
      --display:"DM Serif Display",Georgia,serif;--sans:"DM Sans",system-ui,sans-serif;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Consolas,monospace;
      --type-display-xl:clamp(3.25rem,5.5vw,5.8rem);--type-display-lg:clamp(3.25rem,4.7vw,4.85rem);--type-display-md:clamp(2.5rem,4vw,4rem);--type-display-sm:2rem;--type-display-card:1.5rem;--type-title-lg:1.375rem;--type-title-md:1.125rem;--type-body-lg:1.0625rem;--type-body:1rem;--type-body-sm:.875rem;--type-label:.75rem;--type-meta:.75rem;--leading-display:.98;--leading-tight:1.08;--leading-title:1.18;--leading-body:1.55;--tracking-display:-.035em;--tracking-title:-.02em;--tracking-label:.1em;
      --space-1:.5rem;--space-2:.75rem;--space-3:1rem;--space-4:1.5rem;--space-5:2rem;--space-6:3rem;--space-7:4rem;--space-8:4.5rem;--space-9:5.5rem;--radius-sm:3px;--radius-md:6px;--radius-pill:999px;--max:1180px;
    }
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:var(--type-body);line-height:var(--leading-body);-webkit-font-smoothing:antialiased}button,input{font:inherit}:focus-visible{outline:3px solid var(--saffron);outline-offset:4px}::selection{background:var(--lime);color:var(--forest-deep)}
    .skip-link{position:fixed;z-index:100;left:var(--space-3);top:-5rem;padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);background:var(--forest-deep);color:var(--white);text-decoration:none}.skip-link:focus{top:var(--space-3)}
    .wrap{width:min(var(--max),calc(100% - 3rem));margin-inline:auto}.masthead{position:sticky;z-index:20;top:0;border-bottom:1px solid var(--line);background:rgba(247,244,236,.94);backdrop-filter:blur(18px)}.masthead-inner{min-height:5rem;display:flex;align-items:center;justify-content:space-between;gap:var(--space-4)}
    .brand{display:inline-flex;align-items:center;gap:var(--space-2);color:var(--ink);text-decoration:none}.brand-mark{width:2.875rem;height:2.875rem;flex:0 0 2.875rem;border-radius:var(--radius-md)}.brand-copy strong{display:block;font-size:var(--type-title-md);line-height:var(--leading-tight);letter-spacing:var(--tracking-title)}.brand-copy small{display:block;color:var(--muted);font-size:var(--type-meta);font-weight:700;letter-spacing:var(--tracking-label);text-transform:uppercase}.snapshot-label{color:var(--muted);font-size:var(--type-meta);font-weight:700;letter-spacing:var(--tracking-label);text-transform:uppercase}
    .hero{padding:var(--space-7) 0 var(--space-6)}.eyebrow{margin:0 0 var(--space-2);color:var(--leaf);font-size:var(--type-label);font-weight:700;letter-spacing:var(--tracking-label);text-transform:uppercase}.display{max-width:56rem;margin:0;font-family:var(--display);font-size:var(--type-display-md);font-weight:400;letter-spacing:var(--tracking-display);line-height:var(--leading-display)}.display em{color:var(--leaf);font-style:normal}.lede{max-width:48rem;margin:var(--space-4) 0 0;color:var(--muted);font-size:var(--type-body-lg)}.snapshot-meta{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-5)}.pill{display:inline-flex;align-items:center;gap:var(--space-1);padding:.5rem .75rem;border:1px solid var(--line);border-radius:var(--radius-pill);background:rgba(255,255,255,.72);color:var(--forest);font-size:var(--type-meta);font-weight:700}.pill.warning{border-color:rgba(240,160,100,.75);background:#fae6d6}.dot{width:.5rem;height:.5rem;border-radius:50%;background:var(--saffron)}.dot.good{background:var(--leaf)}
    .section{padding:var(--space-7) 0}.section.sand{background:var(--sand)}.section.white{background:var(--white)}.section.forest{background:var(--forest-deep);color:var(--white)}.section-head{display:flex;align-items:start;justify-content:space-between;gap:var(--space-6);margin-bottom:var(--space-5)}.section-title{max-width:44rem;margin:0;font-family:var(--display);font-size:var(--type-display-sm);font-weight:400;letter-spacing:var(--tracking-display);line-height:var(--leading-tight)}.section-note{max-width:27rem;margin:0;padding-top:var(--space-3);border-top:1px solid var(--line);color:var(--muted);font-size:var(--type-body-sm)}
    .metrics{display:grid;grid-template-columns:repeat(3,1fr);border-block:1px solid var(--line)}.metric{min-height:10rem;padding:var(--space-4) var(--space-4) var(--space-4) 0}.metric:nth-child(3n+2),.metric:nth-child(3n+3){padding-left:var(--space-4);border-left:1px solid var(--line)}.metric:nth-child(n+4){border-top:1px solid var(--line)}.metric-value{display:block;font-family:var(--display);font-size:var(--type-display-sm);font-weight:400;line-height:var(--leading-tight);color:var(--forest)}.metric-label{display:block;margin-top:var(--space-1);font-weight:700}.meta{color:var(--muted);font-size:var(--type-meta)}.metric .meta{display:block;margin-top:var(--space-1)}.signal{display:inline-flex;align-items:center;gap:var(--space-1);color:var(--leaf)}.signal.attention{color:#792d29}
    .status-bar{display:flex;height:.875rem;overflow:hidden;border-radius:var(--radius-pill);background:rgba(8,43,35,.08)}.bar-segment{display:block;min-width:1px}.legend{display:flex;flex-wrap:wrap;gap:var(--space-2) var(--space-4);margin-top:var(--space-3)}.legend-item{display:inline-flex;align-items:center;gap:.375rem;color:var(--muted);font-size:var(--type-meta)}.legend-item i{width:.625rem;height:.625rem;border-radius:50%}.legend-item strong{color:var(--ink)}
    .plane-grid{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line)}.plane-row{padding:var(--space-4) var(--space-4) var(--space-5) 0;border-bottom:1px solid var(--line)}.plane-row:nth-child(even){padding-right:0;padding-left:var(--space-4);border-left:1px solid var(--line)}.plane-heading{display:flex;align-items:start;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-3)}.plane-name{margin:0;color:var(--forest);font-weight:700}.plane-heading p{margin-top:0;margin-bottom:0}.plane-pct{font-family:var(--display);font-size:var(--type-display-card);font-weight:400;color:var(--forest)}.category-chips{display:flex;flex-wrap:wrap;gap:var(--space-1);margin-top:var(--space-3)}.category-chips span{padding:.25rem .625rem;border:1px solid var(--line);border-radius:var(--radius-pill);background:rgba(255,255,255,.56);color:var(--muted);font-size:var(--type-meta)}.category-chips strong{color:var(--forest)}
    .controls{display:grid;grid-template-columns:minmax(18rem,1.4fr) minmax(11rem,.7fr) minmax(12rem,.8fr) auto;gap:var(--space-3);align-items:end;padding:var(--space-4);border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--paper)}.search-group label,.select-group label,.control-label{display:block;margin-bottom:var(--space-1);color:var(--leaf);font-size:var(--type-label);font-weight:700;letter-spacing:var(--tracking-label);text-transform:uppercase}.search-group input,.select-group select{width:100%;min-height:3rem;padding:0 var(--space-3);border:1px solid var(--line);border-radius:var(--radius-md);background:var(--white);color:var(--ink)}.filter-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--space-1)}.filter-row{grid-column:1/-1;display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-1)}.filter-button,.text-button{min-height:2.75rem;padding:0 var(--space-3);border:1px solid var(--line);border-radius:var(--radius-pill);background:transparent;color:var(--forest);font-size:var(--type-body-sm);font-weight:700;cursor:pointer}.filter-button[aria-pressed="true"]{background:var(--forest);color:var(--white);border-color:var(--forest)}.filter-button i{display:inline-block;width:.5rem;height:.5rem;margin-right:.375rem;border-radius:50%}.text-button{border-radius:var(--radius-md);background:var(--white)}.result-count{grid-column:1/-1;color:var(--muted);font-size:var(--type-body-sm)}
    .category-list{margin-top:var(--space-4);border-top:1px solid var(--line)}.category{border-bottom:1px solid var(--line)}.category>summary{list-style:none;display:grid;grid-template-columns:2.5rem 1fr auto;gap:var(--space-3);align-items:center;padding:var(--space-4) 0;cursor:pointer}.category>summary::-webkit-details-marker{display:none}.category>summary:hover{background:rgba(241,236,223,.52)}.category-number{width:2.25rem;height:2.25rem;display:grid;place-items:center;border:1px solid var(--line);border-radius:50%;color:var(--leaf);font-size:var(--type-meta);font-weight:700}.category-title{font-weight:700;color:var(--forest)}.plane-label{margin-left:var(--space-2);color:var(--leaf);font-size:var(--type-label);font-weight:700;letter-spacing:var(--tracking-label);text-transform:uppercase}.category-sub{display:block;margin-top:.25rem;color:var(--muted);font-size:var(--type-meta);font-weight:400}.category-score{font-family:var(--display);font-size:var(--type-display-card);font-weight:400;color:var(--forest)}
    .table-scroll{overflow-x:auto;padding:0 0 var(--space-4) 3.5rem}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:.75rem var(--space-2);border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:var(--type-label);font-weight:700;letter-spacing:var(--tracking-label);text-transform:uppercase}.mono{font-family:var(--mono);font-size:var(--type-meta);color:var(--leaf)}.feature-button{display:flex;align-items:start;gap:var(--space-2);width:100%;padding:0;border:0;background:transparent;color:var(--ink);text-align:left;cursor:pointer}.feature-button:hover{color:var(--leaf)}.chevron{width:1.25rem;flex:0 0 1.25rem;color:var(--leaf);font-weight:700}.tag{display:inline-flex;padding:.25rem .625rem;border-radius:var(--radius-pill);font-size:var(--type-meta);font-weight:700;white-space:nowrap}.evidence-count{font-size:var(--type-meta);font-weight:700;color:var(--leaf)}.detail-row td{padding:var(--space-4);background:var(--paper)}.detail-grid{display:grid;grid-template-columns:minmax(12rem,.35fr) 1fr;gap:var(--space-5)}.detail-meta{margin:0}.detail-meta div{padding:var(--space-1) 0;border-bottom:1px solid var(--line)}.detail-meta dt{color:var(--muted);font-size:var(--type-meta)}.detail-meta dd{margin:0;font-size:var(--type-body-sm);font-weight:700}.detail-copy h3{margin:0 0 var(--space-2);font-family:var(--display);font-size:var(--type-title-lg);font-weight:400}.detail-copy p{margin:var(--space-1) 0;color:var(--muted);font-size:var(--type-body-sm)}.evidence-list{display:grid;gap:var(--space-1);margin-top:var(--space-3)}.evidence-row{display:grid;grid-template-columns:5rem minmax(10rem,.45fr) 1fr;gap:var(--space-2);align-items:start;padding-top:var(--space-1);border-top:1px solid var(--line);font-size:var(--type-meta)}.evidence-type{padding:.2rem .45rem;border-radius:var(--radius-md);font-weight:700;text-align:center;text-transform:uppercase}.evidence-ref{overflow-wrap:anywhere;color:var(--leaf);font-family:var(--mono);text-decoration:none}.evidence-ref:hover{text-decoration:underline}.empty{padding:var(--space-5);border-bottom:1px solid var(--line);color:var(--muted);text-align:center}
    .operating-loop{display:grid;grid-template-columns:repeat(4,1fr);margin-bottom:var(--space-6);border-block:1px solid var(--line)}.loop-step{position:relative;padding:var(--space-4) var(--space-4) var(--space-4) 0}.loop-step+.loop-step{padding-left:var(--space-4);border-left:1px solid var(--line)}.loop-step span{display:block;color:var(--leaf);font-size:var(--type-label);font-weight:700;letter-spacing:var(--tracking-label);text-transform:uppercase}.loop-step strong{display:block;margin-top:var(--space-1);color:var(--forest)}.loop-step p{margin:var(--space-1) 0 0;color:var(--muted);font-size:var(--type-meta)}.founder-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:var(--space-6)}.founder-panel h3{margin:0 0 var(--space-2);font-family:var(--display);font-size:var(--type-title-lg);font-weight:400}.founder-panel>p{margin:0 0 var(--space-3);color:var(--muted);font-size:var(--type-body-sm)}.queue-jump,.owner-jump{padding:0;border:0;background:transparent;color:var(--forest);text-align:left;cursor:pointer}.queue-jump strong{display:block;margin-top:.2rem}.queue-jump:hover strong,.owner-jump:hover{text-decoration:underline}.owner-scroll{max-height:36rem;overflow:auto;border-top:1px solid var(--line)}.owner-table td,.owner-table th{padding-inline:.5rem}.owner-table td:first-child{width:auto}.agent-actions{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-3)}.copy-status{color:var(--leaf);font-size:var(--type-meta)}.split{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6)}.data-table{border-top:1px solid var(--line)}.data-table td:first-child{width:8rem}.source-list{border-top:1px solid var(--line)}.source-row{display:grid;grid-template-columns:10rem 1fr;gap:var(--space-4);padding:var(--space-3) 0;border-bottom:1px solid var(--line)}.source-row strong{color:var(--forest)}.source-row p{margin:0;color:var(--muted);font-size:var(--type-body-sm)}code{padding:.15rem .35rem;border-radius:var(--radius-sm);background:var(--sand);font-family:var(--mono);font-size:var(--type-meta);overflow-wrap:anywhere}
    .footer{padding:var(--space-5) 0}.footer-inner{display:flex;justify-content:space-between;gap:var(--space-4);align-items:end}.footer .eyebrow{color:var(--lime)}.footer p{max-width:46rem;margin:0;color:rgba(255,255,255,.68);font-size:var(--type-body-sm)}.footer strong{color:var(--white)}
    @media (max-width:56rem){.metrics{grid-template-columns:repeat(2,1fr)}.metric:nth-child(3n+2),.metric:nth-child(3n+3){padding-left:0;border-left:0}.metric:nth-child(even){padding-left:var(--space-4);border-left:1px solid var(--line)}.metric:nth-child(n+3){border-top:1px solid var(--line)}.plane-grid,.split,.founder-grid{grid-template-columns:1fr}.plane-row:nth-child(even){padding-left:0;border-left:0}.controls{grid-template-columns:1fr 1fr}.search-group,.filter-actions{grid-column:1/-1}.filter-actions{justify-content:flex-start}.detail-grid{grid-template-columns:1fr}.section-head{display:block}.section-note{margin-top:var(--space-4)}}
    @media (max-width:38rem){.wrap{width:min(100% - 2rem,var(--max))}.snapshot-label{display:none}.hero{padding-top:var(--space-6)}.metrics,.operating-loop{grid-template-columns:1fr}.loop-step,.loop-step+.loop-step{padding:var(--space-3) 0;border-left:0;border-top:1px solid var(--line)}.loop-step:first-child{border-top:0}.metric,.metric:nth-child(even),.metric:nth-child(3n+2),.metric:nth-child(3n+3){padding:var(--space-4) 0;border-left:0}.metric:nth-child(n+2){border-top:1px solid var(--line)}.controls{grid-template-columns:1fr}.search-group,.filter-actions{grid-column:auto}.category>summary{grid-template-columns:2.5rem 1fr}.category-score{grid-column:2}.plane-label{display:block;margin:.25rem 0 0}.table-scroll{padding-left:0}.result-count{width:100%;margin-left:0}.evidence-row,.source-row{grid-template-columns:1fr}.footer-inner{display:block}.footer .meta{margin-top:var(--space-3)}}
    @media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
    @media print{.masthead{position:static}.controls{display:none}.section{padding:var(--space-5) 0}.category>summary{break-inside:avoid}}
  </style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to dashboard</a>
  <header class="masthead">
    <div class="wrap masthead-inner">
      <a class="brand" href="./dashboard.html" aria-label="LoanOS India capability dashboard">
        <img class="brand-mark" src="data:image/png;base64,${logoData}" alt="">
        <span class="brand-copy"><strong>LoanOS</strong><small>India · capability control</small></span>
      </a>
      <span class="snapshot-label" id="sync-state" aria-live="polite">Checking live sync…</span>
    </div>
  </header>
  <main id="main">
    <section class="hero">
      <div class="wrap">
        <p class="eyebrow">Capability &amp; build dashboard</p>
        <h1 class="display">Capability status, backed by <em>repository evidence.</em></h1>
        <p class="lede">A worktree-aware planning view across LOS, LMS, LWS, Compliance OS and the supporting platform. Maturity is derived from the catalogue; it is not a claim of regulatory certification or production approval.</p>
        <div class="snapshot-meta">
          <span class="pill" id="snapshot-mode"><span class="dot good"></span>${escapeHtml(git.branch)} · ${escapeHtml(git.sha)}</span>
          <span class="pill">Generated ${escapeHtml(formatIst(generated))}</span>
          <span class="pill ${git.dirty ? 'warning' : ''}"><span class="dot ${git.dirty ? '' : 'good'}"></span>${escapeHtml(dirtyLabel)}</span>
        </div>
      </div>
    </section>

    <section class="section white" aria-labelledby="snapshot-heading">
      <div class="wrap">
        <div class="section-head"><div><p class="eyebrow">Current snapshot</p><h2 class="section-title" id="snapshot-heading">Scope, maturity and evidence integrity.</h2></div><p class="section-note">Status is read from the canonical catalogue. Evidence coverage means the trace entry passes repository-integrity rules; it does not mean the capability is complete.</p></div>
        <div class="metrics">
          <div class="metric"><strong class="metric-value">${overall.pct}%</strong><span class="metric-label">Catalogue maturity</span><span class="meta">Weighted across ${overall.scored}; ${overall.excluded} partner/external excluded</span></div>
          <div class="metric"><strong class="metric-value">${overall.counts.Implemented} / ${overall.total}</strong><span class="metric-label">Implemented</span><span class="meta">Repository-assessed capability status</span></div>
          <div class="metric"><strong class="metric-value">${overall.counts.Partial + overall.counts['Partial/Mock'] + overall.counts.Mock}</strong><span class="metric-label">Partial or mock</span><span class="meta">Remaining production or provider work disclosed</span></div>
          <div class="metric"><strong class="metric-value">${overall.counts.Missing}</strong><span class="metric-label">Missing</span><span class="meta">No meaningful executable slice</span></div>
          <div class="metric"><strong class="metric-value">${overall.evidenceQualifiedPct}%</strong><span class="metric-label">Evidence integrity</span><span class="meta">${overall.evidenceQualifiedCount} / ${overall.total} entries qualified</span></div>
          <div class="metric"><strong class="metric-value">${escapeHtml(testMetric)}</strong><span class="metric-label"><span class="signal ${testTone}"><span class="dot ${testTone === 'good' ? 'good' : ''}"></span>Test suite</span></span><span class="meta">${escapeHtml(testParts)} · ${tests.source === 'provided-log' ? 'reused build run' : 'live run'}</span></div>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="founder-heading">
      <div class="wrap">
        <div class="section-head"><div><p class="eyebrow">Founder operating desk</p><h2 class="section-title" id="founder-heading">One accountable human, many specialist hats.</h2></div><p class="section-note">The queue is deterministic repository triage, not autonomous prioritisation. You choose business priority; AI agents receive bounded packets and return evidence for human acceptance.</p></div>
        <div class="operating-loop" aria-label="Founder and AI-agent operating loop">
          <div class="loop-step"><span>01 · Focus</span><strong>Choose the constraint</strong><p>Start from failing controls, restrictive maturity, a weak plane or an owner persona.</p></div>
          <div class="loop-step"><span>02 · Delegate</span><strong>Copy a bounded packet</strong><p>Give an agent the acceptance rule, remaining scope, dependencies and existing evidence.</p></div>
          <div class="loop-step"><span>03 · Verify</span><strong>Require executable proof</strong><p>Code, tests, docs and trace metadata must move together; failures remain visible.</p></div>
          <div class="loop-step"><span>04 · Decide</span><strong>Human closes the loop</strong><p>Review the evidence, approve the change and only then promote catalogue maturity.</p></div>
        </div>
        <div class="founder-grid">
          <div class="founder-panel"><h3>Constraint queue</h3><p>${attention.length} capabilities retain internal build scope. The first 12 are ordered Missing → Mock → Partial/Mock → Partial, then by ID—not by commercial priority.</p><div class="table-scroll" style="padding-left:0"><table><thead><tr><th>Capability and owner persona</th><th>Status</th></tr></thead><tbody>${attentionRows}</tbody></table></div></div>
          <div class="founder-panel"><h3>Owner / persona lanes</h3><p>These are the specialist hats the founder or an assigned AI agent must wear. Select a lane to drill into its complete scope.</p><div class="owner-scroll"><table class="owner-table"><thead><tr><th>Owner persona</th><th>Total</th><th>Done</th><th>Open</th><th>Maturity</th></tr></thead><tbody>${ownerRows}</tbody></table></div></div>
        </div>
      </div>
    </section>

    <section class="section sand" aria-labelledby="status-heading">
      <div class="wrap">
        <div class="section-head"><div><p class="eyebrow">Catalogue roll-up</p><h2 class="section-title" id="status-heading">Overall capability status.</h2></div><p class="section-note">The weighted maturity score uses Implemented 1.0, Partial and Partial/Mock 0.4, Mock 0.3, and Missing 0. Partner and External are disclosed but excluded.</p></div>
        ${stacked(overall.counts, overall.total, statusDescription)}
        <div class="legend">${legend}</div>
      </div>
    </section>

    <section class="section" aria-labelledby="planes-heading">
      <div class="wrap">
        <div class="section-head"><div><p class="eyebrow">Product planes</p><h2 class="section-title" id="planes-heading">Where the build is deep, and where it remains thin.</h2></div><p class="section-note">Category-to-plane assignments are versioned in <code>scripts/planes.mjs</code>. Cross-plane capabilities are assigned to their dominant operating plane.</p></div>
        <div class="plane-grid">${planeRows}</div>
      </div>
    </section>

    <section class="section white" aria-labelledby="matrix-heading">
      <div class="wrap">
        <div class="section-head"><div><p class="eyebrow">Evidence explorer</p><h2 class="section-title" id="matrix-heading">Find any capability and inspect its proof.</h2></div><p class="section-note">Search covers IDs, names, owners, acceptance criteria, remaining gaps, dependencies, evidence notes and repository references.</p></div>
        <div class="controls">
          <div class="search-group"><label for="q">Search the complete register</label><input type="search" id="q" autocomplete="off" placeholder="Try KFS, maker-checker, provider, owner or a file path…"></div>
          <div class="select-group"><label for="plane-filter">Product plane</label><select id="plane-filter"><option value="">All planes · ${planes.length}</option>${planeOptions}</select></div>
          <div class="select-group"><label for="owner-filter">Owner persona</label><select id="owner-filter"><option value="">All owner personas · ${owners.length}</option>${ownerOptions}</select></div>
          <div class="filter-actions"><button class="text-button" id="expand-all" type="button">Expand shown</button><button class="text-button" id="collapse-all" type="button">Collapse all</button><button class="text-button" id="reset" type="button">Reset</button></div>
          <div class="filter-row" id="filters" aria-label="Filter by status"><span class="control-label">Status</span></div>
          <output class="result-count" id="count" for="q"></output>
        </div>
        <div class="category-list" id="cats"></div>
        <noscript><p class="empty">JavaScript is required to search and expand capability evidence. The complete data remains available in <code>dashboard-data.json</code>.</p></noscript>
      </div>
    </section>

    <section class="section sand" aria-labelledby="provenance-heading">
      <div class="wrap">
        <div class="section-head"><div><p class="eyebrow">Lineage</p><h2 class="section-title" id="provenance-heading">What this snapshot actually reads.</h2></div><p class="section-note">Source digest <code>${sourceDigest}</code>. The dirty-worktree indicator is deliberate: generated status may include changes that are not present in the listed commits.</p></div>
        <div class="source-list">
          <div class="source-row"><strong>Catalogue</strong><p><code>${escapeHtml(data.sources.catalogue)}</code> · ${overall.total} unique capabilities across ${categories.length} categories; summary counts checked against parsed rows.</p></div>
          <div class="source-row"><strong>Evidence trace</strong><p><code>${escapeHtml(data.sources.trace)}</code> · derived fields, files, optional line references, status proof and policy floors validated before generation.</p></div>
          <div class="source-row"><strong>Tests</strong><p>${escapeHtml(testParts)}. Source: ${escapeHtml(data.sources.tests)}.</p></div>
          <div class="source-row"><strong>Git worktree</strong><p>${escapeHtml(git.branch)} at ${escapeHtml(git.sha)} · ${git.count} commits · ${escapeHtml(dirtyLabel)}.</p></div>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="activity-heading">
      <div class="wrap">
        <div class="section-head"><div><p class="eyebrow">Repository activity</p><h2 class="section-title" id="activity-heading">Recent commits and build epics.</h2></div><p class="section-note">Commit history is committed lineage only. Backlog status comes from explicit <code>Status:</code> fields, not inferred wording.</p></div>
        <div class="split">
          <div><h3>Recent commits</h3><div class="table-scroll" style="padding-left:0"><table class="data-table"><thead><tr><th>Hash</th><th>Subject</th><th>When</th></tr></thead><tbody>${commitRows}</tbody></table></div></div>
          <div><h3>Backlog epics</h3><div class="table-scroll" style="padding-left:0"><table class="data-table"><thead><tr><th>Epic</th><th>Status</th></tr></thead><tbody>${epicRows}</tbody></table></div></div>
        </div>
      </div>
    </section>
  </main>

  <footer class="section forest footer">
    <div class="wrap footer-inner"><div><p class="eyebrow">Accountable by construction</p><p><strong>Regenerate from source:</strong> <code>npm run dashboard</code>. Edit the catalogue, trace and backlog—not this generated HTML.</p></div><span class="meta">Schema v${data.schemaVersion} · ${escapeHtml(formatIst(generated))}</span></div>
  </footer>

  <script>
    const DATA=${serializeForScript({ categories, overall })};
    const STATUS_STYLE=${serializeForScript(STATUS_STYLE)};
    const STATUSES=${serializeForScript(DASHBOARD_STATUSES)};
    const EMBEDDED_SNAPSHOT=${serializeForScript({ snapshotId, generated, sourceDigest })};
    let active=new Set(STATUSES),query='',planeFilter='',ownerFilter='';
    const openCategories=new Set(),expandedFeatures=new Set();
    const make=(source)=>{const template=document.createElement('template');template.innerHTML=source.trim();return template.content.firstElementChild};
    const esc=(value)=>String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
    const searchText=(feature,category)=>[
      feature.id,feature.name,feature.applicability,feature.status,category.name,category.plane,
      feature.owner,feature.acceptance,feature.notes,feature.lastReviewed,...(feature.dependencies||[]),
      ...(feature.evidence||[]).flatMap((item)=>[item.type,item.ref,item.note]),
    ].join(' ').toLowerCase();
    const statusBar=(counts,total)=>'<div class="status-bar">'+STATUSES.filter((status)=>counts[status]).map((status)=>'<span class="bar-segment" title="'+esc(status)+': '+counts[status]+'" style="width:'+(counts[status]/total*100).toFixed(2)+'%;background:'+STATUS_STYLE[status].solid+'"></span>').join('')+'</div>';
    const evidenceLink=(item)=>{
      const isFile=/^[\\w./-]+(?::\\d+)?$/.test(item.ref||'')&&!String(item.ref).startsWith('http')&&item.type!=='endpoint';
      const ref=isFile?'<a href="../'+esc(String(item.ref).replace(/:\\d+$/,''))+'" class="evidence-ref">'+esc(item.ref)+'</a>':'<span class="evidence-ref">'+esc(item.ref)+'</span>';
      const style=STATUS_STYLE[item.type==='test'?'Implemented':item.type==='endpoint'?'Partner':item.type==='code'?'Partial':'External'];
      return '<div class="evidence-row"><span class="evidence-type" style="background:'+style.soft+';color:'+style.text+'">'+esc(item.type)+'</span>'+ref+'<span class="meta">'+esc(item.note||'')+'</span></div>';
    };
    const trace=(feature)=>{
      const dependencies=(feature.dependencies||[]).length?esc(feature.dependencies.join(', ')):'None recorded';
      const evidence=(feature.evidence||[]).length?'<div class="evidence-list">'+feature.evidence.map(evidenceLink).join('')+'</div>':'<p>No evidence linked. Add it to <code>docs/product/capability-trace.json</code>.</p>';
      return '<div class="detail-grid"><dl class="detail-meta"><div><dt>Owner</dt><dd>'+esc(feature.owner||'Unassigned')+'</dd></div><div><dt>Status</dt><dd>'+esc(feature.status)+'</dd></div><div><dt>Applicability</dt><dd>'+esc(feature.applicability)+'</dd></div><div><dt>Last reviewed</dt><dd>'+esc(feature.lastReviewed||'Not recorded')+'</dd></div></dl><div class="detail-copy"><h3>Acceptance and evidence</h3>'+(feature.acceptance?'<p><strong>Acceptance:</strong> '+esc(feature.acceptance)+'</p>':'')+(feature.notes?'<p><strong>Remaining scope:</strong> '+esc(feature.notes)+'</p>':'')+'<p><strong>Dependencies:</strong> '+dependencies+'</p>'+evidence+'<div class="agent-actions"><button class="text-button copy-packet" type="button">Copy agent work packet</button><span class="copy-status" role="status" aria-live="polite"></span></div></div></div>';
    };
    const workPacket=(feature,category)=>[
      '# '+feature.id+' — '+feature.name,
      '',
      '- Owner persona: '+(feature.owner||'Unassigned'),
      '- Product plane: '+category.plane,
      '- Category: '+category.n+'. '+category.name,
      '- Current status: '+feature.status,
      '- Applicability: '+feature.applicability,
      '- Source digest: '+EMBEDDED_SNAPSHOT.sourceDigest,
      '',
      '## Acceptance',feature.acceptance||'Not recorded',
      '',
      '## Remaining scope',feature.notes||'Not recorded',
      '',
      '## Dependencies',(feature.dependencies||[]).length?feature.dependencies.map((item)=>'- '+item).join('\n'):'- None recorded',
      '',
      '## Existing evidence',(feature.evidence||[]).length?feature.evidence.map((item)=>'- ['+item.type+'] '+item.ref+(item.note?' — '+item.note:'')).join('\n'):'- None linked',
      '',
      'Return proposed changes and executable verification. Do not promote maturity; the accountable human reviews evidence and updates the catalogue.',
    ].join('\n');
    const copyText=async(text)=>{
      if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return}
      const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.left='-9999px';document.body.appendChild(area);area.select();const copied=document.execCommand('copy');area.remove();if(!copied)throw new Error('Copy is unavailable in this browser')
    };
    function render(){
      const container=document.getElementById('cats');container.replaceChildren();let shown=0,categoriesShown=0;
      for(const category of DATA.categories){
        if(planeFilter&&category.plane!==planeFilter)continue;
        const features=category.features.filter((feature)=>active.has(feature.status)&&(!ownerFilter||feature.owner===ownerFilter)&&(!query||searchText(feature,category).includes(query)));
        if(!features.length)continue;shown+=features.length;categoriesShown+=1;
        const details=make('<details class="category"><summary><span class="category-number">'+category.n+'</span><span><span class="category-title">'+esc(category.name)+'</span><span class="plane-label">'+esc(category.plane)+'</span><span class="category-sub">'+features.length+' shown of '+category.total+' · '+category.counts.Implemented+' implemented · '+category.counts.Missing+' missing</span></span><span class="category-score">'+category.pct+'%</span></summary></details>');
        details.open=Boolean(query)||openCategories.has(category.n);
        details.addEventListener('toggle',()=>{if(details.open)openCategories.add(category.n);else openCategories.delete(category.n)});
        const scroll=document.createElement('div');scroll.className='table-scroll';
        const table=document.createElement('table');
        table.innerHTML='<thead><tr><th>ID</th><th>Capability</th><th>Applicability</th><th>Status</th><th>Evidence</th></tr></thead>';
        const body=document.createElement('tbody');
        for(const feature of features){
          const count=(feature.evidence||[]).length,detailId='detail-'+feature.id;
          const row=document.createElement('tr');row.className='feature-row';
          row.innerHTML='<td class="mono">'+esc(feature.id)+'</td><td><button class="feature-button" data-feature-id="'+esc(feature.id)+'" type="button" aria-expanded="'+expandedFeatures.has(feature.id)+'" aria-controls="'+detailId+'"><span class="chevron" aria-hidden="true">'+(expandedFeatures.has(feature.id)?'−':'+')+'</span><span>'+esc(feature.name)+'</span></button></td><td class="meta">'+esc(feature.applicability)+'</td><td><span class="tag" style="background:'+STATUS_STYLE[feature.status].soft+';color:'+STATUS_STYLE[feature.status].text+'">'+esc(feature.status)+'</span></td><td class="evidence-count">'+count+' ref'+(count===1?'':'s')+'</td>';
          const detail=document.createElement('tr');detail.className='detail-row';detail.id=detailId;detail.hidden=!expandedFeatures.has(feature.id);detail.innerHTML='<td colspan="5">'+trace(feature)+'</td>';
          const button=row.querySelector('button');button.addEventListener('click',()=>{const expanded=!expandedFeatures.has(feature.id);if(expanded)expandedFeatures.add(feature.id);else expandedFeatures.delete(feature.id);detail.hidden=!expanded;button.setAttribute('aria-expanded',String(expanded));button.querySelector('.chevron').textContent=expanded?'−':'+'});
          const copyButton=detail.querySelector('.copy-packet'),copyStatus=detail.querySelector('.copy-status');copyButton.addEventListener('click',async()=>{try{await copyText(workPacket(feature,category));copyStatus.textContent='Work packet copied.'}catch(error){copyStatus.textContent=error instanceof Error?error.message:'Copy failed.'}});
          body.append(row,detail);
        }
        table.appendChild(body);scroll.appendChild(table);details.appendChild(scroll);container.appendChild(details);
      }
      if(!shown)container.appendChild(make('<p class="empty">No capabilities match the current search and status filters.</p>'));
      document.getElementById('count').textContent=shown+' of '+DATA.overall.total+' capabilities · '+categoriesShown+' categories';
    }
    const filters=document.getElementById('filters');
    for(const status of STATUSES){
      const button=make('<button class="filter-button" type="button" aria-pressed="true"><i style="background:'+STATUS_STYLE[status].solid+'"></i>'+esc(status)+' '+DATA.overall.counts[status]+'</button>');
      button.addEventListener('click',()=>{if(active.has(status))active.delete(status);else active.add(status);button.setAttribute('aria-pressed',String(active.has(status)));render()});filters.appendChild(button);
    }
    const input=document.getElementById('q');input.addEventListener('input',()=>{query=input.value.trim().toLowerCase();render()});
    const planeSelect=document.getElementById('plane-filter'),ownerSelect=document.getElementById('owner-filter');
    planeSelect.addEventListener('change',()=>{planeFilter=planeSelect.value;render()});ownerSelect.addEventListener('change',()=>{ownerFilter=ownerSelect.value;render()});
    const restoreStatuses=()=>{active=new Set(STATUSES);for(const button of filters.querySelectorAll('button'))button.setAttribute('aria-pressed','true')};
    document.getElementById('reset').addEventListener('click',()=>{query='';planeFilter='';ownerFilter='';input.value='';planeSelect.value='';ownerSelect.value='';restoreStatuses();expandedFeatures.clear();openCategories.clear();render();input.focus()});
    document.getElementById('expand-all').addEventListener('click',()=>{for(const category of DATA.categories)openCategories.add(category.n);for(const details of document.querySelectorAll('.category'))details.open=true});
    document.getElementById('collapse-all').addEventListener('click',()=>{openCategories.clear();for(const details of document.querySelectorAll('.category'))details.open=false});
    const focusCapability=(id)=>{query=id.toLowerCase();planeFilter='';ownerFilter='';input.value=id;planeSelect.value='';ownerSelect.value='';restoreStatuses();expandedFeatures.add(id);render();document.getElementById('matrix-heading').scrollIntoView({behavior:'smooth'});setTimeout(()=>document.querySelector('[data-feature-id="'+id+'"]')?.focus(),250)};
    for(const button of document.querySelectorAll('.queue-jump'))button.addEventListener('click',()=>focusCapability(button.dataset.capability));
    for(const button of document.querySelectorAll('.owner-jump'))button.addEventListener('click',()=>{query='';planeFilter='';ownerFilter=button.dataset.owner;input.value='';planeSelect.value='';ownerSelect.value=ownerFilter;restoreStatuses();render();document.getElementById('matrix-heading').scrollIntoView({behavior:'smooth'})});
    const syncState=document.getElementById('sync-state'),snapshotMode=document.getElementById('snapshot-mode');
    async function checkLiveSnapshot(){
      if(location.protocol==='file:'){syncState.textContent='Offline repository snapshot';snapshotMode.title='Serve docs/dashboard.html over HTTP to enable automatic refresh.';return}
      try{
        const response=await fetch('./dashboard-data.json?check='+Date.now(),{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw new Error('HTTP '+response.status);const remote=await response.json();
        if(remote.schemaVersion!==2||!remote.snapshotId)throw new Error('unsupported dashboard data');
        if(remote.snapshotId!==EMBEDDED_SNAPSHOT.snapshotId){syncState.textContent='New snapshot detected · refreshing';const url=new URL(location.href);url.searchParams.set('snapshot',remote.snapshotId);url.searchParams.set('at',Date.now());setTimeout(()=>location.replace(url),300);return}
        const ageMinutes=Math.max(0,Math.floor((Date.now()-Date.parse(remote.generated))/60000));syncState.textContent='Live sync · checked now · snapshot '+ageMinutes+'m old';snapshotMode.title='Polling dashboard-data.json every 30 seconds with cache bypass.';
      }catch(error){syncState.textContent='Live sync unavailable · showing embedded snapshot';snapshotMode.title=error instanceof Error?error.message:'Live sync failed'}
    }
    render();
    checkLiveSnapshot();setInterval(checkLiveSnapshot,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkLiveSnapshot()});
  </script>
</body>
</html>`;

atomicWrite(join(ROOT, 'docs/dashboard-data.json'), `${JSON.stringify(data, null, 2)}\n`);
atomicWrite(join(ROOT, 'docs/dashboard.html'), `${html}\n`);
console.log(`dashboard.html · ${overall.total} capabilities / ${categories.length} categories · ${overall.pct}% maturity · evidence=${overall.evidenceQualifiedCount}/${overall.total} · implemented=${overall.counts.Implemented} · tests=${tests.ran ? `${tests.pass}/${tests.total} (${tests.fail} failing, ${tests.skipped ?? 0} skipped)` : 'unavailable'} · worktree=${git.dirty ? `${git.changeCount} changes` : 'clean'}`);
if (!tests.ran || (tests.fail ?? 0) > 0 || (tests.cancelled ?? 0) > 0) {
  console.error(`dashboard build rejected the test snapshot: ${tests.error || `${tests.fail ?? 0} failing, ${tests.cancelled ?? 0} cancelled`}`);
  process.exitCode = 1;
}
