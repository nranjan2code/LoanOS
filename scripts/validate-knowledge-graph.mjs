#!/usr/bin/env node
// Knowledge-graph integrity gate.
//
// The repo carries several parallel identifier schemes that are meant to cite
// one another (see docs/identifier-registry.md):
//
//   - Capability IDs  PREFIX-NNN         docs/product/complete-system-capability-catalog.md
//   - Engine req IDs  INV/DEC/SEC/PH-n   docs/architecture/decision-engine-design.md
//   - ADR IDs         NNNN               docs/decisions/NNNN-*.md
//   - GTM claim IDs   C-NN               docs/gtm/strategy/claims-and-backlog-sync.md
//
// Until now those citations were free text, so a claim could cite INV-99 or a
// capability could depend on a capability that does not exist and nothing would
// notice. This gate builds the graph from each scheme's authoritative source and
// fails (exit 1) when a citation between schemes does not resolve.
//
// Design rules, so the gate is a guard and never a tripwire:
//   - It only enforces edges that resolve cleanly on the current tree. New
//     edge categories are introduced as WARNINGS first, then ratcheted to
//     ERRORS once the tree is clean (mirrors the evidence-floor policy).
//   - Capability IDs are PREFIX + exactly three digits; engine IDs are
//     INV/DEC/SEC/PH + one or two digits. The digit count disambiguates the
//     shared `SEC` prefix (SEC-012 is a capability, SEC-12 is an engine control).
//
// Run: node scripts/validate-knowledge-graph.mjs   (npm run graph:check)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const errors = [];
const warnings = [];
const error = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// Token shapes. Capability = PREFIX + 3 digits; engine = INV/DEC/SEC/PH + 1–2
// digits (bounded so it never swallows a 3-digit capability SEC-012). The
// leading `(?<![A-Za-z-])` guard makes both tokens reject namespaced forms so a
// doc's own local scheme is never misread as an engine or capability citation —
// e.g. `ORG-INV-14` (a local invariant table) is not the engine's `INV-14`.
const CAP_TOKEN = /(?<![A-Za-z-])[A-Z]{2,4}-\d{3}(?!\d)/g;
const ENGINE_TOKEN = /(?<![A-Za-z-])(?:INV|DEC|SEC|PH)-\d{1,2}(?!\d)/g;

// ---- Authoritative node sets -------------------------------------------------

const catalogue = read('docs/product/complete-system-capability-catalog.md');
const capabilityIds = new Set(
  [...catalogue.matchAll(/^\|\s*([A-Z]{2,4}-\d{3})\s*\|/gm)].map((m) => m[1]),
);

const engineDoc = read('docs/architecture/decision-engine-design.md');
const engineIds = new Set(
  [...engineDoc.matchAll(/(?<![A-Za-z-])(?:INV|DEC|SEC|PH)-\d{1,2}(?!\d)/g)].map((m) => m[0]),
);

const adrIds = new Set(
  readdirSync(join(ROOT, 'docs/decisions'))
    .map((name) => name.match(/^(\d{4})-.+\.md$/))
    .filter(Boolean)
    .map((m) => m[1]),
);

const trace = JSON.parse(read('docs/product/capability-trace.json'));

// ---- Edge checks -------------------------------------------------------------

// Capability trace: curated dependencies[] mix ID references with prose notes.
// Only ID-shaped entries are graph edges; each must resolve. Dangling ID-shaped
// deps are near-certain typos but their intended target cannot be inferred, so
// they are surfaced as warnings for a human, not build-breakers.
let idDeps = 0;
for (const [id, entry] of Object.entries(trace)) {
  for (const dep of entry.dependencies ?? []) {
    if (!/^[A-Z]{2,4}-\d{3}$/.test(dep)) continue; // prose note, not an edge
    idDeps++;
    if (!capabilityIds.has(dep)) {
      warn(`capability-trace: ${id} depends on ${dep}, which is not a capability ID`);
    }
  }
}

// GTM claims: engine-ID and capability-ID citations in the Evidence column must
// resolve. Both categories are clean today, so both enforce.
const claims = read('docs/gtm/strategy/claims-and-backlog-sync.md');
const claimRows = [...claims.matchAll(/^\|\s*(C-\d+)\s*\|[^|]*\|[^|]*\|([^|]*)\|/gm)];
for (const [, claimId, evidence] of claimRows) {
  for (const [token] of evidence.matchAll(ENGINE_TOKEN)) {
    if (!engineIds.has(token)) error(`claim ${claimId} cites engine ID ${token}, which is not defined in decision-engine-design.md`);
  }
  for (const [token] of evidence.matchAll(CAP_TOKEN)) {
    if (!capabilityIds.has(token)) error(`claim ${claimId} cites capability ${token}, which is not in the catalogue`);
  }
}

// Every ADR reference in prose ("ADR 0005") must resolve to a decision record.
for (const file of walk('docs')) {
  if (extname(file) !== '.md') continue;
  const rel = file.slice(ROOT.length + 1);
  for (const m of read(rel).matchAll(/\bADR[\s-]?(\d{4})\b/g)) {
    if (!adrIds.has(m[1])) error(`${rel}: references ADR ${m[1]}, which has no docs/decisions/${m[1]}-*.md`);
  }
}

// Every engine-ID citation in an architecture doc must resolve. Verified clean
// on the current tree, so this enforces.
for (const file of walk('docs/architecture')) {
  if (extname(file) !== '.md') continue;
  const rel = file.slice(ROOT.length + 1);
  if (rel.endsWith('decision-engine-design.md')) continue; // the definition source
  for (const [token] of read(rel).matchAll(ENGINE_TOKEN)) {
    if (!engineIds.has(token)) error(`${rel}: cites engine ID ${token}, which is not defined in decision-engine-design.md`);
  }
}

// ---- Report ------------------------------------------------------------------

console.log(
  `knowledge graph · capabilities=${capabilityIds.size} · engine-ids=${engineIds.size} · ` +
    `adrs=${adrIds.size} · claims=${claimRows.length} · id-deps=${idDeps} · ` +
    `warnings=${warnings.length} · errors=${errors.length}`,
);
for (const message of warnings) console.warn(`warning: ${message}`);
for (const message of errors) console.error(`error: ${message}`);
if (errors.length) process.exitCode = 1;

function walk(rel) {
  const abs = join(ROOT, rel);
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const child = join(abs, entry.name);
    return statSync(child).isDirectory() ? walk(child.slice(ROOT.length + 1)) : [child];
  });
}
