#!/usr/bin/env node
// gtm-backlog-sync.mjs — enforce GTM claims discipline against the product.
// Parses strategy/claims-and-backlog-sync.md and validates every claim row.
// Errors (exit 1): malformed row, bad Status, empty Evidence, missing source doc.
// Warnings (exit 0): possible banned-phrase assertions in public copy.
//
// Usage: node docs/gtm/automation/gtm-backlog-sync.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GTM = join(HERE, '..');                 // docs/gtm
const REPO = join(HERE, '..', '..', '..');    // repo root
const CLAIMS = join(GTM, 'strategy', 'claims-and-backlog-sync.md');
const VALID = new Set(['Built', 'Partial', 'Roadmap']);
const BANNED = ['rbi certified', 'guaranteed compliant', 'fully automated compliance'];
const GUARD = ['avoid', 'never', "don't", 'do not', 'not ', 'no ', 'banned', 'without', '?'];

const errors = [];
const warnings = [];

// --- index repo filenames (basename set) for source-doc existence checks ---
const IGNORE = new Set(['node_modules', '.git', 'target', '.loanos-data']);
const files = new Set();
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (IGNORE.has(e)) continue;
    const p = join(dir, e);
    let s; try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p);
    else files.add(e);
  }
})(REPO);

// --- parse the claim matrix ---
const text = readFileSync(CLAIMS, 'utf8');
const rows = text.split('\n').filter((l) => /^\|\s*C-\d+\s*\|/.test(l));
if (rows.length === 0) errors.push('No claim rows (C-NN) found in claims matrix.');

const seen = new Set();
let built = 0, partial = 0, roadmap = 0;

for (const line of rows) {
  const cells = line.split('|').map((c) => c.trim());
  // cells: ['', id, claim, status, evidence, '']
  const [, id, claim, status, evidence] = cells;
  if (seen.has(id)) errors.push(`${id}: duplicate claim ID.`);
  seen.add(id);
  if (!claim) errors.push(`${id}: empty claim text.`);
  if (!VALID.has(status)) errors.push(`${id}: invalid Status "${status}" (must be Built|Partial|Roadmap).`);
  if (!evidence) errors.push(`${id}: empty Evidence cell.`);
  if ((status === 'Built' || status === 'Partial') && !evidence)
    errors.push(`${id}: ${status} claims must cite evidence.`);

  if (status === 'Built') built++;
  else if (status === 'Partial') partial++;
  else if (status === 'Roadmap') roadmap++;

  // referenced source docs (tokens ending in a known extension) must exist
  const refs = (evidence || '').match(/[\w./-]+\.(md|json|sql|js|mjs)/g) || [];
  for (const r of refs) {
    if (!files.has(basename(r)))
      errors.push(`${id}: referenced source "${r}" not found in repo.`);
  }
}

// --- banned-phrase scan across gtm markdown (skip guarded/negated lines) ---
(function scan(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) { scan(p); continue; }
    if (!e.endsWith('.md')) continue;
    const lines = readFileSync(p, 'utf8').split('\n');
    lines.forEach((ln, i) => {
      const low = ln.toLowerCase();
      for (const b of BANNED) {
        if (!low.includes(b)) continue;
        if (GUARD.some((g) => low.includes(g))) continue;
        // a quoted phrase is being named/forbidden, not asserted — skip
        const quoted = new RegExp(`["'‘’“”]\\s*${b}`).test(low);
        if (quoted) continue;
        warnings.push(`${e}:${i + 1} possible banned phrase "${b}": ${ln.trim().slice(0, 80)}`);
      }
    });
  }
})(GTM);

// --- report ---
console.log(`GTM claims: ${seen.size} total — Built ${built}, Partial ${partial}, Roadmap ${roadmap}`);
if (warnings.length) {
  console.log(`\nWARNINGS (${warnings.length}):`);
  warnings.forEach((w) => console.log('  ! ' + w));
}
if (errors.length) {
  console.log(`\nERRORS (${errors.length}):`);
  errors.forEach((e) => console.log('  x ' + e));
  console.log('\nFAIL — fix claims before shipping GTM assets.');
  process.exit(1);
}
console.log('\nPASS — claims matrix is well-formed and traceable.');
