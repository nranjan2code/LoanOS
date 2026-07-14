#!/usr/bin/env node
// Maintains docs/product/capability-trace.json — the machine-trackable capability
// register the catalogue calls for. One entry per capability ID carrying curated
// trace fields (owner, evidence links, acceptance, dependencies, notes, lastReviewed).
//
// Non-destructive: on re-run it re-syncs the DERIVED fields (capability, category,
// plane, applicability, status) from the catalogue but PRESERVES every curated
// field a human has filled in. New capabilities are added; IDs no longer in the
// catalogue are kept and flagged `orphaned` so curation is never silently lost.
//
// Run: node scripts/sync-capability-trace.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseRegister, normalizeStatus } from './planes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REG = join(ROOT, 'docs/product/capability-trace.json');

const catalogue = readFileSync(join(ROOT, 'docs/product/complete-system-capability-catalog.md'), 'utf8');
const categories = parseRegister(catalogue);

const existing = existsSync(REG) ? JSON.parse(readFileSync(REG, 'utf8')) : {};
const CURATED = ['owner', 'evidence', 'acceptance', 'dependencies', 'notes', 'lastReviewed'];
const blank = () => ({ owner: '', evidence: [], acceptance: '', dependencies: [], notes: '', lastReviewed: '' });

const out = {};
const liveIds = new Set();
let added = 0;
for (const c of categories) {
  for (const f of c.features) {
    liveIds.add(f.id);
    const prev = existing[f.id] || {};
    if (!existing[f.id]) added++;
    const curated = {};
    for (const k of CURATED) curated[k] = prev[k] !== undefined ? prev[k] : blank()[k];
    out[f.id] = {
      capability: f.name,
      category: `${c.n}. ${c.name}`,
      plane: c.plane,
      applicability: f.applicability,
      status: normalizeStatus(f.rawStatus),   // catalogue is the source of truth for status
      ...curated,
    };
  }
}
// keep orphaned entries (curation preserved) but flag them
let orphaned = 0;
for (const id of Object.keys(existing)) {
  if (!liveIds.has(id)) { out[id] = { ...existing[id], orphaned: true }; orphaned++; }
}

// stable sort by ID for clean diffs
const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
writeFileSync(REG, JSON.stringify(sorted, null, 2) + '\n');

const withEvidence = Object.values(sorted).filter((e) => e.evidence && e.evidence.length).length;
console.log(`capability-trace.json · ${liveIds.size} capabilities · +${added} new · ${orphaned} orphaned · ${withEvidence} with evidence`);
