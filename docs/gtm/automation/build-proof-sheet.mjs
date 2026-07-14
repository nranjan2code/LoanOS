#!/usr/bin/env node
// build-proof-sheet.mjs — generate a rep-facing proof sheet from the claims matrix.
// Emits Markdown grouped by status so reps quote only Built claims as live, and
// clearly separate Partial ("governed boundary") and Roadmap items.
//
// Usage:
//   node docs/gtm/automation/build-proof-sheet.mjs            # prints to stdout
//   node docs/gtm/automation/build-proof-sheet.mjs > sheet.md

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAIMS = join(HERE, '..', 'strategy', 'claims-and-backlog-sync.md');

const rows = readFileSync(CLAIMS, 'utf8').split('\n')
  .filter((l) => /^\|\s*C-\d+\s*\|/.test(l))
  .map((l) => l.split('|').map((c) => c.trim()))
  .map(([, id, claim, status, evidence]) => ({ id, claim, status, evidence }));

const groups = { Built: [], Partial: [], Roadmap: [] };
for (const r of rows) (groups[r.status] || (groups[r.status] = [])).push(r);

const out = [];
out.push('# LoanOS — Proof Sheet (auto-generated)');
out.push('');
out.push('> Generated from `strategy/claims-and-backlog-sync.md`. Quote **Built** as');
out.push('> present capability. Frame **Partial** as "first slice / governed boundary."');
out.push('> Frame **Roadmap** as "on our roadmap." Do not edit by hand — regenerate.');
out.push('');

const section = (title, note, list) => {
  out.push(`## ${title} (${list.length})`);
  out.push('');
  out.push(`*${note}*`);
  out.push('');
  for (const r of list) out.push(`- **${r.id}** — ${r.claim}  \n  _proof:_ ${r.evidence}`);
  out.push('');
};

section('Built — say as present fact', 'These are live, enforced capabilities. Attach the proof when asked.', groups.Built);
section('Partial — governed boundary + roadmap', 'A first slice ships today; the certified/live piece is on the roadmap. Never state as fully live.', groups.Partial);
section('Roadmap — direction only', 'Sell as future direction. Never state as available.', groups.Roadmap);

out.push(`_Totals: Built ${groups.Built.length} · Partial ${groups.Partial.length} · Roadmap ${groups.Roadmap.length}._`);

console.log(out.join('\n'));
