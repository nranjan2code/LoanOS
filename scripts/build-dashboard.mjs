#!/usr/bin/env node
// Live build dashboard generator for LoanOS India.
// Re-scans git, the full capability register (453 caps across 33 categories),
// backlog epics, and runs the test suite, then writes a self-contained
// docs/dashboard.html. Run: node scripts/build-dashboard.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PLANE_ORDER, normalizeStatus, parseRegister } from './planes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sh = (c) => execSync(c, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// --- git ---
let git = { branch: '?', count: 0, commits: [] };
try {
  git.branch = sh('git branch --show-current');
  git.count = Number(sh('git rev-list --count HEAD'));
  git.commits = sh('git log -12 --format=%h|%s|%cr').split('\n').map((l) => {
    const [hash, subject, when] = l.split('|'); return { hash, subject, when };
  });
} catch {}

// --- capability register: 33 categories -> features (ID, name, applicability, status) ---
const STATUSES = ['Implemented', 'Partial', 'Partial/Mock', 'Mock', 'Missing', 'Partner', 'External'];
// completion weight per status (Partner/External excluded from scored denominator)
const WEIGHT = { Implemented: 1, 'Partial/Mock': 0.4, Partial: 0.4, Mock: 0.3, Missing: 0, Partner: null, External: null };

// capability trace register (curated evidence per capability ID), if present
const tracePath = join(ROOT, 'docs/product/capability-trace.json');
const trace = existsSync(tracePath) ? JSON.parse(readFileSync(tracePath, 'utf8')) : {};

const cat = read('docs/product/complete-system-capability-catalog.md');
const categories = parseRegister(cat).map((category) => ({
  ...category,
  features: category.features.map((feature) => {
    const tr = trace[feature.id] || {};
    return {
      id: feature.id, name: feature.name, applicability: feature.applicability,
      status: normalizeStatus(feature.rawStatus), raw: feature.rawStatus,
      evidence: tr.evidence || [], owner: tr.owner || '', acceptance: tr.acceptance || '',
      dependencies: tr.dependencies || [], notes: tr.notes || '', lastReviewed: tr.lastReviewed || '',
    };
  }),
}));
// per-category rollup + overall
const rollup = (features) => {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  features.forEach((f) => counts[f.status]++);
  let num = 0, den = 0;
  features.forEach((f) => { const w = WEIGHT[f.status]; if (w !== null) { num += w; den += 1; } });
  return { counts, total: features.length, pct: den ? Math.round((num / den) * 100) : 0 };
};
categories.forEach((c) => { Object.assign(c, rollup(c.features)); });
const allFeatures = categories.flatMap((c) => c.features);
const overall = rollup(allFeatures);
// plane rollup
const planes = PLANE_ORDER.map((name) => {
  const cs = categories.filter((c) => c.plane === name);
  const feats = cs.flatMap((c) => c.features);
  return { name, categories: cs.map((c) => ({ n: c.n, name: c.name, pct: c.pct, total: c.total })), ...rollup(feats) };
}).filter((p) => p.total);

// --- backlog epics ---
const epics = [];
const bk = read('docs/product/build-backlog.md').split('\n');
for (let i = 0; i < bk.length; i++) {
  const e = bk[i].match(/^##\s+(Epic\s+\d+:.*)/); if (!e) continue;
  let status = '';
  for (let j = i + 1; j < Math.min(i + 4, bk.length); j++) { const s = bk[j].match(/^Status:\s*(.+)/); if (s) { status = s[1]; break; } }
  epics.push({ name: e[1], status });
}

// --- tests ---
// Reuse an existing run when DASHBOARD_TEST_LOG points to a test log (set by loanos.sh build,
// which already runs `npm test`); otherwise run the suite live.
let tests = { pass: null, fail: null, total: null, ran: false };
try {
  let out = '';
  const logPath = process.env.DASHBOARD_TEST_LOG;
  if (logPath) { out = readFileSync(logPath, 'utf8'); }
  else {
    try { out = execSync('node --test tests/*.test.js 2>&1', { cwd: ROOT, encoding: 'utf8', timeout: 120000 }); }
    catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  }
  const g = (k) => { const m = out.match(new RegExp('[#ℹ]\\s*' + k + '\\s+(\\d+)')); return m ? Number(m[1]) : null; };
  tests = { pass: g('pass'), fail: g('fail'), total: g('tests'), ran: g('tests') != null };
} catch {}

const data = { generated: new Date().toISOString(), git, overall, planes, categories, epics, tests };
writeFileSync(join(ROOT, 'docs/dashboard-data.json'), JSON.stringify(data, null, 2));

// --- render ---
const COLOR = { Implemented: '#2f9e44', Partial: '#f08c00', 'Partial/Mock': '#e8590c', Mock: '#d9480f', Missing: '#e03131', Partner: '#1971c2', External: '#868e96' };
const legend = STATUSES.map((s) => `<span class="lg"><i style="background:${COLOR[s]}"></i>${s} <b>${overall.counts[s]}</b></span>`).join('');
const t = data.tests;
const testBadge = !t.ran ? '<span class="pill grey">not run</span>'
  : t.fail === 0 ? `<span class="pill green">${t.pass} passing</span>`
  : `<span class="pill red">${t.fail} failing</span> <span class="pill grey">${t.pass} passing</span>`;
const stacked = (counts, total) => STATUSES.filter((s) => counts[s]).map((s) =>
  `<span class="seg" title="${s}: ${counts[s]}" style="width:${(counts[s] / total * 100).toFixed(2)}%;background:${COLOR[s]}"></span>`).join('');
const planeCards = planes.map((p) => `
  <div class="pcard">
    <div class="phead"><span class="pname">${p.name}</span><span class="ppct">${p.pct}%</span></div>
    <div class="bar" style="margin:8px 0">${stacked(p.counts, p.total)}</div>
    <div class="muted psub">${p.counts.Implemented} implemented · ${p.counts.Missing} missing · ${p.total} capabilities</div>
    <div class="pcats">${p.categories.map((c) => `<span class="chip">${c.n}. ${c.name.split(',')[0]} <b>${c.pct}%</b></span>`).join('')}</div>
  </div>`).join('');
const commitRows = git.commits.map((c) => `<tr><td class="mono">${c.hash}</td><td>${c.subject}</td><td class="muted">${c.when}</td></tr>`).join('');
const epicRows = epics.map((e) => `<tr><td>${e.name}</td><td class="muted">${e.status || '—'}</td></tr>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>LoanOS Build Dashboard</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--line:#262b36;--fg:#e6e8ec;--muted:#8b93a1}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 12px}
.sub{color:var(--muted);margin:0 0 20px}code{background:#0c0e12;padding:2px 6px;border-radius:5px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:15px}
.kpi{font-size:26px;font-weight:600}.kpi small{font-size:12px;color:var(--muted);font-weight:400}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.muted{color:var(--muted)}.mono{font-family:ui-monospace,monospace;color:#7cc4ff}
.pill{padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
.green{background:#2f9e4422;color:#69db7c}.red{background:#e0313122;color:#ff8787}.grey{background:#868e9622;color:#adb5bd}
.bar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:#0c0e12}.seg{display:block}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin:14px 0 4px;font-size:12px;color:var(--muted)}
.lg{display:flex;align-items:center;gap:6px}.lg i{width:10px;height:10px;border-radius:3px;display:inline-block}.lg b{color:var(--fg)}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:center}
input[type=search]{background:#0c0e12;border:1px solid var(--line);color:var(--fg);padding:8px 12px;border-radius:8px;min-width:230px;font-size:13px}
.fbtn{background:#0c0e12;border:1px solid var(--line);color:var(--muted);padding:6px 12px;border-radius:20px;font-size:12px;cursor:pointer}
.fbtn.on{color:var(--fg);border-color:#3b4453;background:#1e232c}
.catrow{cursor:pointer}.catname{font-weight:600}.pct{font-variant-numeric:tabular-nums}
details{border-bottom:1px solid var(--line)}details[open]{background:#12151b}
summary{list-style:none;padding:12px 6px;display:grid;grid-template-columns:34px 1fr 220px 52px;gap:12px;align-items:center;cursor:pointer}
summary::-webkit-details-marker{display:none}summary:hover{background:#1a1e26}
.cbadge{width:26px;height:26px;border-radius:7px;background:#0c0e12;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--muted)}
.tag{padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;display:inline-block}
.ftable{padding:0 6px 12px 52px}.ftable td{border-bottom:1px solid #20252f}
.hide{display:none}
.pgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.pcard{background:#12151b;border:1px solid var(--line);border-radius:10px;padding:14px}
.phead{display:flex;justify-content:space-between;align-items:baseline}.pname{font-weight:600}.ppct{font-size:18px;font-weight:700}
.psub{font-size:12px;margin-bottom:8px}.pcats{display:flex;flex-wrap:wrap;gap:5px}
.chip{background:#0c0e12;border:1px solid var(--line);border-radius:16px;padding:3px 9px;font-size:11px;color:var(--muted)}.chip b{color:var(--fg)}
.plabel{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#7cc4ff;background:#7cc4ff18;padding:1px 7px;border-radius:10px;margin-left:8px}
.frow{cursor:pointer}.frow:hover{background:#1a1e26}.ev{color:#69db7c;font-weight:600}.noev{color:#5a6270}
.detail td{background:#0d0f14;padding:14px 16px}
.tmeta{color:var(--muted);font-size:12px;margin-bottom:8px}.tmeta b{color:var(--fg);font-weight:600}.dot{margin:0 8px;color:#3b4453}
.tnote{font-size:12px;color:#c7ccd4;margin:4px 0}
.evlist{margin-top:8px;display:flex;flex-direction:column;gap:5px}
.evrow{display:flex;align-items:center;gap:9px;font-size:12px}
.evtype{padding:1px 8px;border-radius:5px;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.03em;min-width:66px;text-align:center}
.evref{font-family:ui-monospace,monospace;color:#7cc4ff;text-decoration:none}.evref:hover{text-decoration:underline}
.evnote{color:var(--muted)}
.tempty{font-size:12px;color:#5a6270;margin-top:6px}.tempty code{background:#171a21;color:#adb5bd}
</style></head><body>
<h1>LoanOS India — Capability &amp; Build Dashboard</h1>
<p class="sub">Generated ${new Date(data.generated).toLocaleString()} · branch <b>${git.branch}</b> · ${allFeatures.length} capabilities across ${categories.length} categories · regenerate: <code>node scripts/build-dashboard.mjs</code></p>

<div class="grid">
  <div class="card"><div class="kpi">${overall.pct}%</div><div class="muted">overall completion (weighted)</div></div>
  <div class="card"><div class="kpi">${overall.counts.Implemented}<small> / ${allFeatures.length}</small></div><div class="muted">implemented</div></div>
  <div class="card"><div class="kpi">${overall.counts.Partial + overall.counts['Partial/Mock'] + overall.counts.Mock}</div><div class="muted">partial / mock</div></div>
  <div class="card"><div class="kpi">${overall.counts.Missing}</div><div class="muted">missing</div></div>
  <div class="card"><div class="kpi">${allFeatures.filter((f) => f.evidence.length).length}<small> / ${allFeatures.length}</small></div><div class="muted">traced (evidence linked)</div></div>
  <div class="card"><div class="kpi" style="font-size:14px;padding-top:7px">${testBadge}</div><div class="muted">test suite</div></div>
</div>

<div class="panel">
  <h2>Overall capability status</h2>
  <div class="bar">${stacked(overall.counts, allFeatures.length)}</div>
  <div class="legend">${legend}</div>
</div>

<div class="panel">
  <h2>Product planes (LOS · LMS · LWS · Compliance OS · platform &amp; supporting)</h2>
  <div class="pgrid">${planeCards}</div>
</div>

<div class="panel">
  <h2>Category → feature matrix</h2>
  <div class="controls">
    <input type="search" id="q" placeholder="Search capability, ID, or category…">
    <span id="filters"></span>
    <span class="muted" id="count" style="margin-left:auto"></span>
  </div>
  <div id="cats"></div>
</div>

<div class="panel"><h2>Recent commits</h2><table><tr><th>Hash</th><th>Subject</th><th>When</th></tr>${commitRows}</table></div>
<div class="panel"><h2>Backlog epics</h2><table><tr><th>Epic</th><th>Status</th></tr>${epicRows}</table></div>

<script>
const DATA = ${JSON.stringify({ categories, overall })};
const COLOR = ${JSON.stringify(COLOR)};
const STATUSES = ${JSON.stringify(STATUSES)};
let active = new Set(STATUSES), q = '';
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };

const fbar = document.getElementById('filters');
STATUSES.forEach((s) => {
  const b = el('<button class="fbtn on" style="border-left:3px solid '+COLOR[s]+'">'+s+'</button>');
  b.onclick = () => { active.has(s) ? active.delete(s) : active.add(s); b.classList.toggle('on'); render(); };
  fbar.appendChild(b);
});
document.getElementById('q').oninput = (e) => { q = e.target.value.toLowerCase(); render(); };

function stacked(counts, total){ return STATUSES.filter(s=>counts[s]).map(s=>'<span class="seg" style="width:'+(counts[s]/total*100).toFixed(2)+'%;background:'+COLOR[s]+'"></span>').join(''); }

function render(){
  const wrap = document.getElementById('cats'); wrap.innerHTML=''; let shown=0;
  DATA.categories.forEach((c) => {
    const feats = c.features.filter((f) => active.has(f.status) &&
      (!q || (f.id+' '+f.name+' '+c.name+' '+f.status+' '+c.plane).toLowerCase().includes(q)));
    if(!feats.length) return; shown += feats.length;
    const d = el('<details><summary>'+
      '<span class="cbadge">'+c.n+'</span>'+
      '<span><span class="catname">'+c.name+'</span><span class="plabel">'+c.plane+'</span><div class="bar" style="margin-top:6px;max-width:340px">'+stacked(c.counts,c.total)+'</div></span>'+
      '<span class="muted">'+c.counts.Implemented+' impl · '+c.counts.Missing+' missing · '+c.total+' total</span>'+
      '<span class="pct" style="text-align:right;font-weight:600">'+c.pct+'%</span>'+
      '</summary></details>');
    const tbl = el('<table class="ftable"></table>');
    feats.forEach((f) => {
      const n = (f.evidence||[]).length;
      const row = el('<tr class="frow">'+
        '<td class="mono" style="width:78px">'+f.id+'</td>'+
        '<td>'+f.name+'</td>'+
        '<td class="muted" style="width:100px">'+f.applicability+'</td>'+
        '<td style="width:118px"><span class="tag" style="background:'+COLOR[f.status]+'22;color:'+COLOR[f.status]+'">'+f.status+'</span></td>'+
        '<td style="width:70px" class="'+(n?'ev':'noev')+'">'+(n?n+' ref'+(n>1?'s':''):'—')+'</td>'+
        '</tr>');
      const det = el('<tr class="detail hide"><td colspan="5">'+trace(f)+'</td></tr>');
      row.onclick = () => det.classList.toggle('hide');
      tbl.appendChild(row); tbl.appendChild(det);
    });
    d.appendChild(tbl); if(q) d.open=true; wrap.appendChild(d);
  });
  document.getElementById('count').textContent = shown+' capabilities shown';
}

const EVCOLOR = { test:'#2f9e44', endpoint:'#1971c2', code:'#7048e8', doc:'#f08c00' };
function esc(s){ return (s||'').replace(/[<>&]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
function evLink(e){
  const isFile = /^[\w./-]+(:\d+)?$/.test(e.ref) && !e.ref.startsWith('http') && e.type!=='endpoint';
  const label = isFile ? '<a href="../'+esc(e.ref.split(':')[0])+'" class="evref">'+esc(e.ref)+'</a>' : '<span class="evref">'+esc(e.ref)+'</span>';
  return '<div class="evrow"><span class="evtype" style="background:'+(EVCOLOR[e.type]||'#868e96')+'22;color:'+(EVCOLOR[e.type]||'#adb5bd')+'">'+esc(e.type)+'</span>'+label+(e.note?'<span class="evnote">'+esc(e.note)+'</span>':'')+'</div>';
}
function trace(f){
  const meta = [];
  meta.push('<b>Status</b> '+f.status);
  meta.push('<b>Applicability</b> '+f.applicability);
  meta.push('<b>Owner</b> '+(f.owner||'unassigned'));
  if(f.lastReviewed) meta.push('<b>Reviewed</b> '+f.lastReviewed);
  let h = '<div class="tmeta">'+meta.join('<span class="dot">·</span>')+'</div>';
  if(f.notes) h += '<div class="tnote">'+esc(f.notes)+'</div>';
  if(f.acceptance) h += '<div class="tnote"><b>Acceptance:</b> '+esc(f.acceptance)+'</div>';
  if((f.dependencies||[]).length) h += '<div class="tnote"><b>Depends on:</b> '+f.dependencies.map(esc).join(', ')+'</div>';
  if((f.evidence||[]).length) h += '<div class="evlist">'+f.evidence.map(evLink).join('')+'</div>';
  else h += '<div class="tempty">No evidence linked yet — add it under <code>'+f.id+'</code> in <code>docs/product/capability-trace.json</code>.</div>';
  return h;
}
render();
</script>
</body></html>`;

writeFileSync(join(ROOT, 'docs/dashboard.html'), html);
console.log(`dashboard.html · ${allFeatures.length} caps / ${categories.length} categories · ${overall.pct}% weighted · impl=${overall.counts.Implemented} missing=${overall.counts.Missing} · tests=${t.ran ? `${t.pass}/${t.total}(${t.fail}f)` : 'skip'}`);
