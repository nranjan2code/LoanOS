#!/usr/bin/env node
// cs-health-score.mjs — deterministic Customer Success health score.
// Scores the six dimensions from health-and-churn.md, applies the forced-band
// rule (a 0 on sponsor or value caps the band at yellow), and prints a work list.
// No external deps.
//
// Usage:
//   node docs/gtm/automation/cs-health-score.mjs accounts.json
//   node docs/gtm/automation/cs-health-score.mjs            # runs the demo sample
//
// Input JSON: array of { name, onboarding, value, usage, sponsor, support,
//   commercial }  — each dimension 0|1|2.

import { readFileSync } from 'node:fs';

const DIMS = ['onboarding', 'value', 'usage', 'sponsor', 'support', 'commercial'];

function assess(a) {
  const scores = DIMS.map((d) => Math.max(0, Math.min(2, Number(a[d] ?? 0))));
  const total = scores.reduce((x, y) => x + y, 0);
  let band = total >= 10 ? 'green' : total >= 6 ? 'yellow' : 'red';
  // forced-band rule: sponsor or value at 0 caps at yellow
  const sponsor = scores[DIMS.indexOf('sponsor')];
  const value = scores[DIMS.indexOf('value')];
  let forced = false;
  if ((sponsor === 0 || value === 0) && band === 'green') { band = 'yellow'; forced = true; }
  return { name: a.name, scores, total, band, forced };
}

const sample = [
  { name: 'Alpha NBFC', onboarding: 2, value: 2, usage: 2, sponsor: 2, support: 2, commercial: 2 },
  { name: 'Beta SFB', onboarding: 2, value: 0, usage: 2, sponsor: 2, support: 2, commercial: 2 },
  { name: 'Gamma HFC', onboarding: 1, value: 1, usage: 1, sponsor: 1, support: 1, commercial: 1 },
  { name: 'Delta Coop', onboarding: 0, value: 0, usage: 1, sponsor: 0, support: 1, commercial: 1 },
];

const path = process.argv[2];
const accounts = path ? JSON.parse(readFileSync(path, 'utf8')) : sample;

const rank = { red: 0, yellow: 1, green: 2 };
const rows = accounts.map(assess).sort((x, y) => rank[x.band] - rank[y.band] || x.total - y.total);

console.log(`CS health: ${accounts.length} accounts (${path || 'demo sample'})\n`);
console.log('BAND    TOTAL  ACCOUNT                 O V U Sp Su C');
for (const r of rows) {
  const s = r.scores.join(' ');
  console.log(`${r.band.padEnd(6)}  ${String(r.total).padStart(2)}/12  ${r.name.padEnd(22)}  ${s}`
    + (r.forced ? '  [forced: sponsor/value=0]' : ''));
}
const attention = rows.filter((r) => r.band !== 'green');
console.log(`\nNeeds attention: ${attention.length} (${rows.filter((r) => r.band === 'red').length} red). `
  + `Work reds first; every red/yellow root cause that is a product gap → voice-of-customer to the backlog.`);
