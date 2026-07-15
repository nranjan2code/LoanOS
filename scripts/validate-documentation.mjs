#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const ENTRY = join(DOCS, "README.md");
const markdown = walk(DOCS).filter((file) => extname(file) === ".md");
const markdownSet = new Set(markdown.map((file) => resolve(file)));
const links = new Map(markdown.map((file) => [resolve(file), []]));
const errors = [];

for (const file of markdown) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (!raw || raw.startsWith("#") || /^(https?:|mailto:)/i.test(raw)) continue;
    if (raw.startsWith("file:")) { error(file, `non-portable file URI: ${raw}`); continue; }
    const [pathPart, fragment] = raw.split("#", 2);
    if (!pathPart) continue;
    if (pathPart.startsWith("/") && !pathPart.startsWith(`${ROOT}/`)) { error(file, `absolute link escapes the repository: ${raw}`); continue; }
    if (pathPart.startsWith(`${ROOT}/`)) error(file, `repository link must be relative: ${raw}`);
    let target = resolve(dirname(file), decodeURIComponent(pathPart));
    if (!existsSync(target)) { error(file, `broken local link: ${raw}`); continue; }
    if (statSync(target).isDirectory()) target = join(target, "README.md");
    if (!existsSync(target)) { error(file, `directory link has no README.md: ${raw}`); continue; }
    if (fragment && extname(target) === ".md" && !anchors(target).has(decodeURIComponent(fragment))) error(file, `unknown heading fragment: ${raw}`);
    if (markdownSet.has(resolve(target))) links.get(resolve(file)).push(resolve(target));
  }
}

const reached = new Set();
const queue = [resolve(ENTRY)];
while (queue.length) {
  const current = queue.shift();
  if (reached.has(current)) continue;
  reached.add(current);
  for (const target of links.get(current) ?? []) if (!reached.has(target)) queue.push(target);
}
for (const file of markdown) if (!reached.has(resolve(file))) error(file, "document is not reachable from docs/README.md");

const claims = readFileSync(join(DOCS, "gtm/strategy/claims-and-backlog-sync.md"), "utf8");
const claimIds = [...claims.matchAll(/^\|\s*(C-\d+)\s*\|/gm)].map((match) => match[1]);
for (const id of new Set(claimIds)) if (claimIds.filter((candidate) => candidate === id).length > 1) errors.push(`docs/gtm/strategy/claims-and-backlog-sync.md: duplicate claim ID ${id}`);

console.log(`documentation integrity · markdown=${markdown.length} · reachable=${reached.size} · errors=${errors.length}`);
for (const message of errors) console.error(`error: ${message}`);
if (errors.length) process.exitCode = 1;

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.name.startsWith(".") ? [] : entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
}

function anchors(file) {
  const seen = new Map();
  const values = new Set();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (!match) continue;
    const base = match[1].toLowerCase().trim().replace(/<[^>]+>/g, "").replace(/[`*_~]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    values.add(count ? `${base}-${count}` : base);
  }
  return values;
}

function error(file, message) { errors.push(`${relative(ROOT, file).split(sep).join("/")}: ${message}`); }
