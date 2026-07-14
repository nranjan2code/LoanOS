#!/usr/bin/env node
// outreach-list-build.mjs — fit-screen + prioritise a list of target accounts.
// Deterministic, no external deps. Applies the ICP anti-fit rules and a simple
// priority score so reps/agents work the right accounts first.
//
// Usage:
//   node docs/gtm/automation/outreach-list-build.mjs accounts.json
//   node docs/gtm/automation/outreach-list-build.mjs           # runs the demo sample
//
// Input JSON: array of { name, segment, country, borrowerCurrency, reAccountable,
//   wantsAadhaarStorage, wantsLspFundControl, triggers[], committeeRoles[] }
// segment ∈ nbfc|sfb|hfc|coop|bank|aifi   triggers/committeeRoles are free strings.

import { readFileSync } from 'node:fs';

const SEGMENTS = new Set(['nbfc', 'sfb', 'hfc', 'coop', 'bank', 'aifi']);
const HIGH_INTENT = ['inspection', 'finding', 'launch', 'model-risk', 'dla', 'cims', 'migration', 'cco', 'cro'];

function fitScreen(a) {
  const reasons = [];
  if ((a.country || 'IN').toUpperCase() !== 'IN') reasons.push('non-India');
  if ((a.borrowerCurrency || 'INR').toUpperCase() !== 'INR') reasons.push('non-INR');
  if (a.reAccountable === false) reasons.push('no RE accountability');
  if (a.wantsAadhaarStorage) reasons.push('wants Aadhaar storage');
  if (a.wantsLspFundControl) reasons.push('wants LSP fund control');
  if (a.segment && !SEGMENTS.has(String(a.segment).toLowerCase())) reasons.push(`unknown segment "${a.segment}"`);
  return { fit: reasons.length === 0, reasons };
}

function score(a) {
  let s = 0;
  const trig = (a.triggers || []).map((t) => String(t).toLowerCase());
  s += trig.filter((t) => HIGH_INTENT.some((h) => t.includes(h))).length * 20;
  const roles = (a.committeeRoles || []).map((r) => String(r).toLowerCase().replace(/[^a-z]/g, ''));
  const has = (k) => roles.some((r) => r.includes(k));
  if (has('cco') || has('compliance')) s += 15;
  if (has('cro') || has('risk') || has('credit')) s += 15;
  if (has('cto') || has('infosec') || has('security')) s += 10; // multi-thread readiness
  if (has('ceo') || has('cfo')) s += 10;                          // economic buyer present
  return s;
}

function tier(s) { return s >= 45 ? 'A' : s >= 25 ? 'B' : 'C'; }

const sample = [
  { name: 'Sample NBFC Ltd', segment: 'nbfc', triggers: ['new MSME product launch', 'DLA/CIMS filing'], committeeRoles: ['CCO', 'Head of Credit', 'CTO'] },
  { name: 'Sample SFB', segment: 'sfb', triggers: ['board model-risk mandate'], committeeRoles: ['CRO'] },
  { name: 'Global Lender Inc', segment: 'bank', country: 'US', triggers: ['expansion'], committeeRoles: ['CIO'] },
  { name: 'FundFlow Fintech', segment: 'nbfc', wantsLspFundControl: true, triggers: ['embedded lending'], committeeRoles: ['CEO'] },
];

const path = process.argv[2];
const accounts = path ? JSON.parse(readFileSync(path, 'utf8')) : sample;

const ranked = accounts.map((a) => {
  const f = fitScreen(a);
  const s = f.fit ? score(a) : 0;
  return { name: a.name, segment: a.segment, fit: f.fit, reasons: f.reasons, score: s, tier: f.fit ? tier(s) : '-' };
}).sort((x, y) => Number(y.fit) - Number(x.fit) || y.score - x.score);

console.log(`Accounts: ${accounts.length}  (${path || 'demo sample'})\n`);
console.log('TIER  SCORE  FIT   SEGMENT  ACCOUNT');
for (const r of ranked) {
  const fit = r.fit ? 'yes' : 'NO ';
  console.log(`  ${r.tier}    ${String(r.score).padStart(3)}   ${fit}  ${String(r.segment || '?').padEnd(6)}  ${r.name}`
    + (r.fit ? '' : `  [anti-fit: ${r.reasons.join(', ')}]`));
}
const work = ranked.filter((r) => r.fit);
console.log(`\nWork order: ${work.length} in-fit (${work.filter((r) => r.tier === 'A').length} Tier-A). `
  + `Multi-thread any A/B account missing a CTO/InfoSec or economic-buyer contact before Stage 3.`);
