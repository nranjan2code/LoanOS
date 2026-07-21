#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/help/technical-academy");
const BASE = "/help/technical-academy";
const CHECK = process.argv.includes("--check");
const { course, capabilityCoverage } = await import(pathToFileURL(join(OUT, "content/course.mjs")).href);
const { architectureLayers, architecturePersonas } = await import(pathToFileURL(join(OUT, "content/architecture-map.mjs")).href);
const { technicalJourneyTypes } = await import(pathToFileURL(join(OUT, "content/journey-lessons.mjs")).href);
const capabilityFamilies = parseCapabilityCatalogue();
const capabilityTrace = JSON.parse(readFileSync(join(ROOT, "docs/product/capability-trace.json"), "utf8"));
const integrationGroups = parseIntegrationMap();
course.modules.forEach((module, index) => module.number = index + 1);

validate();
const pages = render();
CHECK ? check() : write();

function validate() {
  const errors = [], ids = new Set();
  for (const module of course.modules) {
    if (ids.has(module.id)) errors.push(`duplicate ${module.id}`); ids.add(module.id);
    for (const item of module.lessons) {
      const key = `${module.id}/${item.id}`;
      if (ids.has(key)) errors.push(`duplicate ${key}`); ids.add(key);
      if (item.objectives.length < 2 || item.sections.length < 3 || item.flow.length < 4 || item.sources.length < 2) errors.push(`${key}: incomplete learning contract`);
      for (const [, ref] of item.sources) if (!existsSync(join(ROOT, ref))) errors.push(`${key}: missing source ${ref}`);
    }
  }
  const catalogueFamilyNumbers = capabilityFamilies.map((family) => family.number);
  const lessonPaths = new Set(course.modules.flatMap((module) => module.lessons.map((item) => `${module.id}/${item.id}`)));
  if (catalogueFamilyNumbers.length !== 33) errors.push(`expected 33 capability families, found ${catalogueFamilyNumbers.length}`);
  const capabilityIds = capabilityFamilies.flatMap((family) => family.capabilities.map((item) => item.id));
  if (capabilityIds.length !== 465) errors.push(`expected 465 individual capabilities, found ${capabilityIds.length}`);
  if (new Set(capabilityIds).size !== capabilityIds.length) errors.push("individual capability IDs must be unique");
  for (const family of capabilityFamilies) for (const item of family.capabilities) {
    const trace = capabilityTrace[item.id];
    if (!trace) errors.push(`${item.id}: capability trace missing`);
    else {
      if (trace.capability !== item.name) errors.push(`${item.id}: catalogue/trace name mismatch`);
      if (trace.status !== normalizeCapabilityStatus(item.status)) errors.push(`${item.id}: catalogue/trace status mismatch`);
      if (!trace.acceptance || !trace.notes || !trace.owner || !trace.lastReviewed) errors.push(`${item.id}: incomplete technical write-up`);
      if (!Array.isArray(trace.evidence) || trace.evidence.length === 0) errors.push(`${item.id}: evidence links missing`);
    }
  }
  for (const family of catalogueFamilyNumbers) {
    if (!capabilityCoverage[family]) errors.push(`capability family ${family}: academy coverage missing`);
    else if (!lessonPaths.has(capabilityCoverage[family])) errors.push(`capability family ${family}: invalid lesson ${capabilityCoverage[family]}`);
  }
  const integrationIds = integrationGroups.flatMap((group) => group.integrations.map((item) => item.id));
  if (integrationGroups.length !== 12) errors.push(`expected 12 integration domains, found ${integrationGroups.length}`);
  if (integrationIds.length !== 115) errors.push(`expected 115 external integration boundaries, found ${integrationIds.length}`);
  if (new Set(integrationIds).size !== integrationIds.length) errors.push("external integration IDs must be unique");
  const journeyLesson = course.modules.find((m) => m.id === "t05-journeys");
  const matrix = readFileSync(join(ROOT, "docs/product/product-journey-support-matrix.md"), "utf8");
  const registerIds = new Set([...readFileSync(join(ROOT, "docs/compliance/india-regulatory-register.md"), "utf8").matchAll(/^\|\s*([A-Z][A-Z0-9-]+)\s*\|/gm)].map((match) => match[1]));
  const journeys = [...matrix.matchAll(/^\| ([^|]+) \| (?:Controlled first slice|Configurable pattern|Planned|Orchestration only)/gm)].map((match) => match[1]);
  if (journeys.length !== 21) errors.push(`expected all 21 journey rows, found ${journeys.length}`);
  const covered = journeyLesson?.lessons.filter((item) => item.journeyType).map((item) => item.journeyType) ?? [];
  if (!journeyLesson || journeyLesson.lessons.length !== 25) errors.push("journey module must contain one overview, 21 journeys and three casebooks");
  if (covered.length !== 21 || new Set(covered).size !== 21 || technicalJourneyTypes.some((type) => !covered.includes(type))) errors.push("exactly one dedicated lesson is required for every journey contract");
  for (const item of journeyLesson?.lessons.filter((entry) => entry.journeyType) ?? []) {
    if (item.cases?.length < 17) errors.push(`${item.journeyType}: exhaustive case matrix missing`);
    if (item.regulations?.length < 6) errors.push(`${item.journeyType}: regulatory map missing`);
    for (const regulation of item.regulations ?? []) if (!registerIds.has(regulation.id) || !regulation.effect) errors.push(`${item.journeyType}: invalid regulation ${regulation.id}`);
  }
  if (errors.length) throw new Error(`technical academy validation failed\n${errors.join("\n")}`);
}

function parseCapabilityCatalogue() {
  const lines = readFileSync(join(ROOT, "docs/product/complete-system-capability-catalog.md"), "utf8").split(/\r?\n/);
  const families = []; let current;
  for (const line of lines) {
    const heading = /^### (\d+)\. (.+)$/.exec(line);
    if (heading) { current = { number: Number(heading[1]), title: heading[2], capabilities: [] }; families.push(current); continue; }
    const row = /^\| ([A-Z][A-Z0-9-]*-\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/.exec(line);
    if (row && current) current.capabilities.push({ id: row[1], name: row[2].trim(), applicability: row[3].trim(), status: row[4].trim() });
  }
  return families;
}

function parseIntegrationMap() {
  const source = readFileSync(join(ROOT, "docs/architecture/platform-module-integration-api-map.md"), "utf8");
  const labels = { CUS:"Customer and channels", LOS:"Origination and lending", RSK:"Risk and decisioning", LWS:"Workflow and staff operations", LMS:"Loan management and servicing", COL:"Collections and recovery", COLAT:"Collateral and security", FIN:"Finance and treasury", REG:"Regulators and reporting", PRT:"Partners and LSPs", PLT:"Platform infrastructure", ADM:"Organisation admission" };
  const groups = new Map(Object.entries(labels).map(([prefix,title]) => [prefix,{ prefix,title,integrations:[] }]));
  for (const match of source.matchAll(/^\| (INT-([A-Z]+)-\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)) {
    const group = groups.get(match[2]);
    if (group) group.integrations.push({ id:match[1], neededAt:match[3].trim(), operations:match[4].trim(), direction:match[5].trim(), current:match[6].trim(), consumers:match[7].trim() });
  }
  return [...groups.values()];
}

function typography(value) {
  return String(value)
    .replace(/\s*—\s*/g, " — ")
    .replace(/[ \t]+([,;:!?])/g, "$1")
    .replace(/([,;:!?])(?=[A-Za-z])/g, "$1 ");
}
function esc(value) { return typography(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function prose(body) {
  return typography(body).trim().split(/\n\s*\n+/).map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.every((line) => line.startsWith("- "))) return `<ul>${lines.map((line) => `<li>${esc(line.slice(2))}</li>`).join("")}</ul>`;
    if (lines.every((line) => /^\d+\.\s/.test(line))) return `<ol>${lines.map((line) => `<li>${esc(line.replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol>`;
    const sentences = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(lines.join(" "))]
      .map(({ segment }) => segment.trim()).filter(Boolean);
    if (sentences.length <= 2) return `<p>${esc(lines.join(" "))}</p>`;
    return sentences.map((sentence) => `<p>${esc(sentence)}</p>`).join("");
  }).join("");
}
function minutes(value) { return Number(/\d+/.exec(value)?.[0] ?? 0); }
function href(ref) { return ref.startsWith("docs/") ? `/${ref}` : `/${ref}`; }
function shell(title, description, body, crumbs = []) {
  const trail = [["Guide & Academy", "/help/"], [course.title, `${BASE}/`], ...crumbs];
  const backFallback = crumbs.length ? `${BASE}/` : "/help/";
  return `<!-- Generated by scripts/build-technical-academy.mjs — do not edit. -->
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${esc(description)}"><title>${esc(title)} · LoanOS</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap" rel="stylesheet"><link rel="stylesheet" href="${BASE}/technical-academy.css"></head><body><a class="skip" href="#main">Skip to content</a><header class="topbar"><a class="brand" href="${BASE}/"><span class="mark">{ }</span><span><strong>LoanOS</strong><small>Technical Academy</small></span></a><nav aria-label="Technical Academy"><a href="${BASE}/">Course home</a><a href="${BASE}/architecture/">Architecture</a><a href="${BASE}/capability-atlas/">Capabilities</a><a href="${BASE}/integration-atlas/">Integrations</a><a href="/help/academy/">BA Academy</a><a href="/help/">Guide</a></nav></header><nav class="crumbs" aria-label="Breadcrumb"><button type="button" class="context-back" data-context-back data-fallback="${backFallback}">← Back</button><span class="crumb-trail">${trail.map(([label,url], index) => index === trail.length - 1 ? `<span aria-current="page">${esc(label)}</span>` : `<a href="${url}">${esc(label)}</a>`).join(' <span aria-hidden="true">/</span> ')}</span></nav><main id="main">${body}</main><footer><p class="disclaimer"><strong>Boundary:</strong> Technical learning content is explanatory, not production-readiness evidence. The canonical product definition, capability catalogue, journey support matrix, architecture contracts, code and tests remain authoritative.</p><p>Verified ${esc(course.verified)} · LoanOS canonical content</p></footer><script src="/help/learning-experience.js" defer></script></body></html>`;
}

function flowMap(steps, variant = "") {
  const items = steps.map((step, index) => `<li><span class="flow-step-no" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><span class="flow-step-label">${esc(step)}</span></li>`).join("");
  return `<section class="diagram${variant}" id="flow" aria-labelledby="flow-heading"><h2 id="flow-heading">Technical flow</h2><p class="flow-caption">Every hand-off is a control boundary: on failure the flow holds, refers or denies — it never skips ahead.</p><ol class="flow-track flow-steps-${steps.length}">${items}</ol></section>`;
}

function heroDiagram() {
  const bands = [["Channels", "#173f35"], ["APIs & domain", "#28705c"], ["Decision engine", "#173f35"], ["Tenant store", "#28705c"], ["Evidence & ops", "#173f35"]];
  const x = 24, w = 272, h = 32, gap = 12;
  const rects = bands.map(([label, fill], i) => {
    const y = 14 + i * (h + gap);
    const arrow = i < bands.length - 1 ? `<path d="M160 ${y + h + 3} v${gap - 6}" stroke="#d8ef88" stroke-width="2"/><path d="M155 ${y + h + gap - 7} l5 6 5-6" fill="none" stroke="#d8ef88" stroke-width="2"/>` : "";
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}"/><text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle" fill="#d8ef88" font-family="DM Sans, sans-serif" font-size="13" font-weight="600">${esc(label)}</text>${arrow}`;
  }).join("");
  return `<figure class="hero-visual" aria-hidden="false"><svg viewBox="0 0 320 260" role="img" aria-label="The LoanOS platform as five layered planes: channels, APIs and domain services, the decision engine, tenant store, and evidence and operations"><rect width="320" height="260" rx="20" fill="#0c2d26"/>${rects}</svg></figure>`;
}
function home() {
  const all = course.modules.flatMap((m) => m.lessons), total = all.reduce((sum,l) => sum + minutes(l.duration), 0);
  return shell(course.title, course.description, `<section class="hero">${heroDiagram()}<div class="hero-copy"><p class="eyebrow">Architecture · code · controls · operations</p><h1>${course.title}</h1><p class="lede">${esc(course.description)}</p><p>${esc(course.audience)}</p><div class="stats"><span><strong>${course.modules.length}</strong> modules</span><span><strong>${all.length}</strong> deep-dive sessions</span><span><strong>465</strong> capabilities</span><span><strong>115</strong> integration boundaries</span><span><strong>~${Math.round(total/60)} h</strong> guided learning</span></div><p class="hero-actions"><a class="primary" href="${BASE}/architecture/">Explore the enterprise architecture →</a><a class="secondary-link" href="${BASE}/${course.modules[0].id}/${course.modules[0].lessons[0].id}.html">Start the course</a><a class="secondary-link" href="${BASE}/capability-atlas/">Browse capabilities</a><a class="secondary-link" href="${BASE}/integration-atlas/">Browse integrations</a></p></div></section><section class="learning-orientation" aria-labelledby="technical-learning-rhythm"><div><p class="eyebrow">How to study the system</p><h2 id="technical-learning-rhythm">Orient. Trace. Test.</h2><p>Begin with the architecture map, follow one request or journey through its sources, then test your understanding against an adverse path.</p></div><ol><li><span>01</span><strong>Orient</strong><p>Place the concept in the correct plane, tenant boundary and source of authority.</p></li><li><span>02</span><strong>Trace</strong><p>Sketch the flow from admission through domain state, decision, persistence and evidence.</p></li><li><span>03</span><strong>Test</strong><p>Predict the restrictive outcome for timeout, replay, stale authority or missing evidence.</p></li></ol></section><section class="module-list">${course.modules.map((m) => `<article class="module-card"><p class="eyebrow">Module ${m.number} of ${course.modules.length}</p><h2><a href="${BASE}/${m.id}/">${esc(m.title)}</a></h2><p class="tagline">${esc(m.tagline)}</p><ol class="lesson-links">${m.lessons.map((l) => `<li><a href="${BASE}/${m.id}/${l.id}.html">${esc(l.title)}</a><span class="duration">${esc(l.duration)}</span></li>`).join("")}</ol></article>`).join("")}</section>`);
}

function architectureExplorer() {
  const personaButtons = architecturePersonas.map(([id,label]) => `<button type="button" data-persona="${id}" aria-pressed="${id === "all"}">${esc(label)}</button>`).join("");
  const layers = architectureLayers.map((layer,index) => `<section class="architecture-layer${index === 0 ? " is-active" : ""}" data-layer="${layer.id}" data-number="${layer.number}" data-name="${esc(layer.name)}" data-description="${esc(layer.description)}"><button type="button" class="layer-heading" aria-pressed="${index === 0}"><span>${layer.number}</span><span><strong>${esc(layer.name)}</strong><small>${esc(layer.short)}</small></span><b aria-hidden="true">${index === 0 ? "−" : "+"}</b></button><div class="layer-systems"${index === 0 ? "" : " hidden"}>${layer.systems.map(([name,description,lesson,personas]) => `<article data-system-personas="${personas.join(" ")}"><div><h3>${esc(name)}</h3><p>${esc(description)}</p></div><a href="${BASE}/${lesson}">Study this subsystem <span>→</span></a></article>`).join("")}</div></section>`).join("");
  const body = `<section class="architecture-hero"><div><p class="eyebrow">Enterprise architecture explorer</p><h1>See the whole institution.<br>Then open any subsystem.</h1><p class="lede">A navigable map of LoanOS—from people and lending journeys to deterministic controls, data and operations. Every subsystem opens the Academy lesson that explains how it works.</p></div><aside><span data-current-layer>01 / 06</span><p>Selected layer</p><strong data-layer-detail>${esc(architectureLayers[0].name)}: ${esc(architectureLayers[0].description)}</strong></aside></section><section class="persona-selector" aria-labelledby="persona-title"><div><p class="eyebrow">View by responsibility</p><h2 id="persona-title">Show the architecture relevant to your role</h2></div><div class="persona-buttons">${personaButtons}</div></section><section class="architecture-stack" data-architecture-explorer>${layers}<p class="architecture-boundary"><strong>Reading the map:</strong> experience depends on the layers below it; control and tenant boundaries apply across every layer. Select a layer to expand it, then follow a course link for the system contract, implementation trail and operating boundary.</p></section><script src="${BASE}/architecture-explorer.js" defer></script>`;
  return shell("Enterprise architecture", "Navigate the LoanOS enterprise architecture layer by layer and continue into role-relevant Academy courses.", `<link rel="stylesheet" href="${BASE}/architecture-explorer.css">${body}`, [["Enterprise architecture", `${BASE}/architecture/`]]);
}

function capabilityAtlas() {
  const total = capabilityFamilies.reduce((sum, family) => sum + family.capabilities.length, 0);
  return shell("Capability Atlas", "Every capability in the canonical complete-system catalogue, grouped by family with current applicability and maturity status.", `<section class="hero atlas-hero"><p class="eyebrow">Canonical requirement index</p><h1>Capability Atlas</h1><p class="lede">Every individual capability in the complete-system catalogue. Status is reproduced from the canonical source and does not imply production readiness.</p><div class="stats"><span><strong>${total}</strong> capabilities</span><span><strong>${capabilityFamilies.length}</strong> families</span><span>Generated from the catalogue</span></div></section><section class="atlas-grid">${capabilityFamilies.map((family) => `<article class="atlas-family-card"><p class="eyebrow">Family ${family.number}</p><h2><a href="${BASE}/capability-atlas/family-${String(family.number).padStart(2,"0")}.html">${esc(family.title)}</a></h2><p><strong>${family.capabilities.length}</strong> capability records</p><div class="atlas-statuses">${statusSummary(family.capabilities)}</div><a class="card-link" href="${BASE}/capability-atlas/family-${String(family.number).padStart(2,"0")}.html">Open family <span>→</span></a></article>`).join("")}</section>`, [["Capability Atlas", `${BASE}/capability-atlas/`]]);
}

function statusClass(status) { return status.toLowerCase().replaceAll(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); }
function normalizeCapabilityStatus(status) {
  const value = status.toLowerCase();
  if (value.includes("partial") && value.includes("mock")) return "Partial/Mock";
  if (value.includes("implemented")) return "Implemented";
  if (value.includes("missing")) return "Missing";
  if (value.includes("partner")) return "Partner";
  if (value.includes("external")) return "External";
  if (value.includes("mock")) return "Mock";
  if (value.includes("partial")) return "Partial";
  throw new Error(`unknown capability status ${status}`);
}
function statusSummary(items) {
  const counts = new Map(); for (const item of items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  return [...counts].map(([status,count]) => `<span class="status-pill ${statusClass(status)}">${esc(status)} ${count}</span>`).join("");
}
function capabilityFamilyPage(family) {
  const primaryLesson = capabilityCoverage[family.number];
  return shell(family.title, `${family.capabilities.length} canonical capabilities in family ${family.number}.`, `<section class="hero atlas-family-hero"><p class="eyebrow">Capability family ${family.number} of 33</p><h1>${esc(family.title)}</h1><p class="lede">Each record explains the acceptance boundary, current gap, ownership, dependencies and repository evidence—not only its catalogue status.</p><div class="stats"><span><strong>${family.capabilities.length}</strong> capabilities</span>${statusSummary(family.capabilities)}</div><p><a class="primary" href="${BASE}/${primaryLesson}.html">Open the primary technical lesson →</a></p></section><section class="capability-writeups">${family.capabilities.map((item) => capabilityWriteup(item)).join("")}</section><nav class="pager">${family.number > 1 ? `<a href="${BASE}/capability-atlas/family-${String(family.number-1).padStart(2,"0")}.html">← Previous family</a>` : "<span></span>"}${family.number < 33 ? `<a href="${BASE}/capability-atlas/family-${String(family.number+1).padStart(2,"0")}.html">Next family →</a>` : ""}</nav>`, [["Capability Atlas", `${BASE}/capability-atlas/`], [family.title, `${BASE}/capability-atlas/family-${String(family.number).padStart(2,"0")}.html`]]);
}

function capabilityWriteup(item) {
  const trace = capabilityTrace[item.id];
  const dependencies = trace.dependencies?.length ? `<div><h3>Dependencies</h3><p>${trace.dependencies.map((dependency) => `<code>${esc(dependency)}</code>`).join(" ")}</p></div>` : "";
  const evidence = trace.evidence.map((entry) => `<li><span class="eyebrow">${esc(entry.type)}</span><a href="${href(entry.ref)}"><code>${esc(entry.ref)}</code></a><p>${esc(entry.note)}</p></li>`).join("");
  return `<article class="capability-writeup" id="${esc(item.id)}"><header><div><code>${esc(item.id)}</code><span class="status-pill ${statusClass(item.status)}">${esc(item.status)}</span></div><h2>${esc(item.name)}</h2><p><strong>${esc(item.applicability)}</strong> · ${esc(trace.plane)} · Owner: ${esc(trace.owner)}</p></header><div class="writeup-grid"><div><h3>Acceptance boundary</h3><p>${esc(trace.acceptance)}</p></div><div><h3>Current maturity and gap</h3><p>${esc(trace.notes)}</p></div>${dependencies}<div><h3>Review currency</h3><p>Last reviewed ${esc(trace.lastReviewed)}. Revalidate when implementation, policy, provider or operating evidence changes.</p></div></div><details><summary>Implementation and verification evidence <span>${trace.evidence.length}</span></summary><ul class="capability-evidence">${evidence}</ul></details></article>`;
}

function integrationAtlas() {
  return shell("Integration Atlas", "Every external authority, provider, enterprise system and infrastructure boundary required by LoanOS.", `<section class="hero integration-hero"><p class="eyebrow">External dependency map</p><h1>Integration Atlas</h1><p class="lede">All 115 integration contracts across customer channels, lending, servicing, regulators, partners and platform infrastructure. Current-state language distinguishes internal controls, mocks and live commercial connectivity.</p><div class="stats"><span><strong>115</strong> boundaries</span><span><strong>12</strong> domains</span><span>Fail-closed contract</span></div><p><a class="secondary-link" href="/docs/architecture/integration-vendor-procurement-catalog.md">Vendor and procurement catalogue →</a></p></section><section class="atlas-grid">${integrationGroups.map((group) => `<article class="atlas-family-card"><p class="eyebrow">${esc(group.prefix)}</p><h2><a href="${BASE}/integration-atlas/${group.prefix.toLowerCase()}.html">${esc(group.title)}</a></h2><p><strong>${group.integrations.length}</strong> integration contracts</p><a class="card-link" href="${BASE}/integration-atlas/${group.prefix.toLowerCase()}.html">Open domain <span>→</span></a></article>`).join("")}</section>`, [["Integration Atlas", `${BASE}/integration-atlas/`]]);
}

function integrationGroupPage(group) {
  return shell(`${group.title} integrations`, `${group.integrations.length} external integration contracts for ${group.title}.`, `<section class="hero"><p class="eyebrow">Integration domain ${esc(group.prefix)}</p><h1>${esc(group.title)}</h1><p class="lede">Each boundary defines required operations, direction and response, current implementation state, downstream consumers and the mandatory safe-failure contract.</p><div class="stats"><span><strong>${group.integrations.length}</strong> contracts</span><span>Source-linked</span><span>Production boundary explicit</span></div></section><section class="integration-writeups">${group.integrations.map(integrationWriteup).join("")}</section>`, [["Integration Atlas", `${BASE}/integration-atlas/`], [group.title, `${BASE}/integration-atlas/${group.prefix.toLowerCase()}.html`]]);
}

function integrationWriteup(item) {
  return `<article class="integration-writeup" id="${esc(item.id)}"><header><code>${esc(item.id)}</code><h2>${esc(item.neededAt)}</h2><p>Also used by: <strong>${esc(item.consumers)}</strong></p></header><div class="writeup-grid"><div><h3>Required external contract</h3><p>${esc(item.operations)}</p></div><div><h3>Direction and response</h3><p>${esc(item.direction)}</p></div><div><h3>Current implementation boundary</h3><p>${esc(item.current)}</p></div><div><h3>Mandatory failure behavior</h3><p>Requests remain tenant- and purpose-scoped with immutable correlation and idempotency evidence. Timeout, invalid signature, replay, stale schema, reconciliation break or unavailable authority cannot advance money, identity, policy or workflow state; the operation stays pending, refers or denies and opens attributable exception work.</p></div></div><details><summary>Certification and production checklist</summary><ul><li>Contract, regulatory eligibility, India data location, subprocessors, audit rights and exit are approved.</li><li>mTLS or scoped service identity, secret rotation, callback signature and replay-window validation are certified.</li><li>Happy, reject, timeout, duplicate, out-of-order, partial, tamper, expiry, correction and recovery cases pass.</li><li>Daily control totals, provider references, acknowledgements, reconciliation breaks and operator replay are evidenced.</li><li>Live credentials, tenant configuration, UAT, monitoring, incident response and rollback are admitted separately from simulator evidence.</li></ul></details></article>`;
}

function modulePage(module) {
  if (module.id === "t05-journeys") return journeyCatalogue(module);
  return shell(module.title, module.tagline, `<section class="hero"><p class="eyebrow">Module ${module.number} of ${course.modules.length}</p><h1>${esc(module.title)}</h1><p class="lede">${esc(module.tagline)}</p><div class="stats"><span>${module.lessons.length} sessions</span><span>${module.lessons.reduce((s,l)=>s+minutes(l.duration),0)} min</span><span>Study in sequence</span></div><p><a class="primary" href="${BASE}/${module.id}/${module.lessons[0].id}.html">Start this module →</a></p></section><section class="lesson-list">${module.lessons.map((l,i) => `<article class="lesson-card"><p class="eyebrow">Session ${module.number}.${i+1} · ${l.duration}</p><h2><a href="${BASE}/${module.id}/${l.id}.html">${esc(l.title)}</a></h2><p>${esc(l.objectives[0])}; ${esc(l.objectives[1]).toLowerCase()}.</p></article>`).join("")}</section>`, [[module.title, `${BASE}/${module.id}/`]]);
}

function journeyCatalogue(module) {
  const journeys = module.lessons.filter((item) => item.journeyType), references = module.lessons.filter((item) => !item.journeyType);
  return shell(module.title, module.tagline, `<section class="hero journey-catalogue-hero"><p class="eyebrow">Module ${module.number} · Journey library</p><h1>${esc(module.title)}</h1><p class="lede">Choose a product to see its complete lifecycle, technical contract, regulations, evidence, exceptions and production boundary.</p><div class="stats"><span><strong>21</strong> product blueprints</span><span><strong>17</strong> cases each</span><span>Contract-generated</span></div></section><section><div class="section-heading"><div><p class="eyebrow">Canonical catalogue</p><h2>Explore every lending journey</h2></div><p>Each card opens a consistent, deeply structured blueprint.</p></div><div class="journey-grid">${journeys.map((item) => `<article class="journey-card"><div class="journey-card-top"><span class="maturity-badge ${item.maturity.startsWith("Controlled") ? "controlled" : "pattern"}">${esc(item.maturity)}</span><span>${item.duration}</span></div><div class="journey-icon" aria-hidden="true">${esc(item.journeyName.slice(0,2).toUpperCase())}</div><h3><a href="${BASE}/${module.id}/${item.id}.html">${esc(item.journeyName)}</a></h3><p>${esc(item.contractSummary.archetype)} · ${esc(item.contractSummary.facility)}</p><div class="card-metrics"><span>${item.contractSummary.facts.length} facts</span><span>${item.contractSummary.evidence.length} evidence</span><span>${item.regulations.length} controls</span></div><a class="card-link" href="${BASE}/${module.id}/${item.id}.html">Open blueprint <span>→</span></a></article>`).join("")}</div></section><section class="reference-strip"><div><p class="eyebrow">Shared references</p><h2>Frameworks and casebooks</h2></div><div class="reference-links">${references.map((item) => `<a href="${BASE}/${module.id}/${item.id}.html"><strong>${esc(item.title)}</strong><span>${item.duration}</span></a>`).join("")}</div></section>`, [[module.title, `${BASE}/${module.id}/`]]);
}

function lessonPage(module, item, previous, next, index) {
  if (item.journeyType) return journeyPage(module, item, previous, next, index);
  const sections = item.sections.map(([heading, body],i) => `<section class="content-section" id="s${i+1}"><h2>${i+1}. ${esc(heading)}</h2>${prose(body)}</section>`).join("");
  const cases = item.cases?.length ? `<section class="casebook" id="cases"><h2>Complete case matrix</h2><p class="muted">Expected outcomes are restrictive by default and retain attributed evidence.</p><div class="table-wrap"><table><thead><tr><th>Case</th><th>Trigger</th><th>Required system outcome</th></tr></thead><tbody>${item.cases.map(([name,trigger,outcome]) => `<tr><th>${esc(name)}</th><td>${esc(trigger)}</td><td>${esc(outcome)}</td></tr>`).join("")}</tbody></table></div></section>` : "";
  const allLessons = course.modules.flatMap((entry) => entry.lessons);
  const coursePosition = allLessons.indexOf(item) + 1;
  const recall = `<section class="panel recall" id="recall"><p class="eyebrow">Active recall</p><h2>Check your mental model</h2><p>Close the diagram and explain these outcomes in your own words before opening the sources.</p><ol>${item.objectives.map((objective) => `<li>${esc(objective)}.</li>`).join("")}</ol><details><summary>Use this self-check</summary><p>Your explanation should name the tenant and actor boundary, the authoritative state or policy source, the restrictive failure outcome and the evidence retained.</p></details></section>`;
  return shell(item.title, item.objectives.join("; "), `<header class="hero"><p class="eyebrow">Module ${module.number} · Session ${module.number}.${index+1} · ${coursePosition} of ${allLessons.length} · ${item.duration}</p><h1>${esc(item.title)}</h1><p class="lede">A source-linked technical walkthrough. Trace the flow, explain the boundary, then test the failure path.</p></header><div class="lesson-layout"><div><section class="objectives"><strong>After this session, you can:</strong><ul>${item.objectives.map((o) => `<li>${esc(o)}</li>`).join("")}</ul></section>${flowMap(item.flow)}${sections}${cases}${recall}<section class="panel sources" id="sources"><h2>System sources</h2><p class="muted">Open these authoritative sources to continue from concept into implementation.</p><ul>${item.sources.map(([type,ref]) => `<li><span class="eyebrow">${esc(type)}</span> <a href="${href(ref)}"><code>${esc(ref)}</code></a></li>`).join("")}</ul></section><nav class="pager">${previous ? `<a href="${BASE}/${previous.module.id}/${previous.item.id}.html">← ${esc(previous.item.title)}</a>` : "<span></span>"}${next ? `<a href="${BASE}/${next.module.id}/${next.item.id}.html">${esc(next.item.title)} →</a>` : ""}</nav></div><aside class="toc"><strong>In this session</strong><ol><li><a href="#flow">Technical flow</a></li>${item.sections.map(([heading],i) => `<li><a href="#s${i+1}">${esc(heading)}</a></li>`).join("")}${item.cases?.length ? '<li><a href="#cases">Complete case matrix</a></li>' : ""}<li><a href="#recall">Active recall</a></li><li><a href="#sources">System sources</a></li></ol><p class="muted">Verified ${item.verified}</p></aside></div>`, [[module.title, `${BASE}/${module.id}/`], [item.title, `${BASE}/${module.id}/${item.id}.html`]]);
}

function chips(items) { return `<div class="chip-list">${items.map((item) => `<span>${esc(item)}</span>`).join("")}</div>`; }
function structuredCopy(body) {
  const sentences = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(typography(body))]
    .map(({ segment }) => segment.trim()).filter(Boolean);
  if (sentences.length < 2) return `<p>${esc(body)}</p>`;
  return `<p class="stage-lead">${esc(sentences[0])}</p><ul class="stage-points">${sentences.slice(1).map((sentence) => `<li>${esc(sentence)}</li>`).join("")}</ul>`;
}

function journeyPage(module, item, previous, next, index) {
  const summary = item.contractSummary;
  const lifecycle = item.sections.slice(0, 6).map(([heading,body],i) => `<article class="stage-card" id="s${i+1}"><div class="stage-number">${String(i+1).padStart(2,"0")}</div><div><p class="stage-kicker">Lifecycle stage</p><h2>${esc(heading)}</h2>${structuredCopy(body)}</div></article>`).join("");
  const operations = item.sections.slice(6).map(([heading,body],i) => `<article class="insight-card ${i ? "maturity-card" : "evidence-card"}" id="s${i+7}"><p class="eyebrow">${i ? "Readiness" : "System map"}</p><h2>${esc(heading)}</h2>${structuredCopy(body)}</article>`).join("");
  const regulations = item.regulations.map((regulation) => `<article class="reg-card"><span class="reg-id">${esc(regulation.id)}</span><p>${esc(regulation.effect)}</p></article>`).join("");
  const cases = item.cases.map(([name,trigger,outcome],i) => `<details class="case-card"${i===0 ? " open" : ""}><summary><span class="case-index">${String(i+1).padStart(2,"0")}</span><strong>${esc(name)}</strong><span class="case-chevron">+</span></summary><div><p><b>Trigger</b>${esc(trigger)}</p><p><b>System outcome</b>${esc(outcome)}</p></div></details>`).join("");
  const recall = `<section class="panel recall journey-recall" id="recall"><p class="eyebrow">Active recall</p><h2>Rebuild the journey from memory</h2><ol><li>Name the minimum facts and evidence required before underwriting and disbursement.</li><li>Choose one provider timeout and explain the restrictive outcome, exception work and reconciliation evidence.</li><li>Explain why the current maturity badge does—or does not—support production admission.</li></ol><details><summary>Use this self-check</summary><p>A strong answer connects tenant readiness, product contract, decision lineage, exact-money state, borrower communication, independent approval and immutable evidence without treating the blueprint itself as readiness proof.</p></details></section>`;
  const nav = `<nav class="journey-nav" aria-label="On this page"><a href="#blueprint">Blueprint</a><a href="#requirements">Requirements</a><a href="#regulations">Regulations</a><a href="#lifecycle">Lifecycle</a><a href="#operations">Evidence</a><a href="#cases">Cases</a><a href="#recall">Recall</a><a href="#sources">Sources</a></nav>`;
  const body = `<header class="journey-hero"><div><p class="eyebrow">Module ${module.number} · Journey ${index} of 21 · ${item.duration}</p><div class="hero-badges"><span class="maturity-badge ${item.maturity.startsWith("Controlled") ? "controlled" : "pattern"}">${esc(item.maturity)}</span><span>Contract ${esc(summary.version)}</span></div><h1>${esc(item.journeyName)}</h1><p class="lede">A complete technical blueprint—from tenant readiness and borrower evidence through accounting, exceptions, closure and regulatory proof.</p></div><div class="journey-score"><span>${item.regulations.length}</span><small>mapped regulatory controls</small></div></header>${nav}<section class="blueprint-grid" id="blueprint"><article><span>Archetype</span><strong>${esc(summary.archetype)}</strong></article><article><span>Facility</span><strong>${esc(summary.facility)}</strong></article><article><span>Security</span><strong>${esc(summary.security)}</strong></article><article><span>Case coverage</span><strong>${item.cases.length} scenarios</strong></article></section><section class="objectives journey-objectives"><p class="eyebrow">Learning outcomes</p><ul>${item.objectives.map((objective) => `<li>${esc(objective)}</li>`).join("")}</ul></section>${flowMap(item.flow, " journey-diagram")}<section class="requirements" id="requirements"><div class="section-heading"><div><p class="eyebrow">Contract inputs</p><h2>What the journey must know and prove</h2></div><p>These lists come directly from the canonical product contract.</p></div><div class="requirements-grid"><article><h3>Required facts <span>${summary.facts.length}</span></h3>${chips(summary.facts)}</article><article><h3>Required evidence <span>${summary.evidence.length}</span></h3>${chips(summary.evidence)}</article></div></section><section class="regulations" id="regulations"><div class="section-heading"><div><p class="eyebrow">Regulatory trace</p><h2>Controls shaping this journey</h2></div><p>Control-family IDs resolve to the canonical India regulatory register.</p></div><div class="reg-grid">${regulations}</div></section><section id="lifecycle"><div class="section-heading"><div><p class="eyebrow">End-to-end execution</p><h2>The lifecycle, stage by stage</h2></div><p>Common controls and product-specific mechanics stay connected.</p></div><div class="stage-grid">${lifecycle}</div></section><section id="operations"><div class="section-heading"><div><p class="eyebrow">Trace and readiness</p><h2>How to operate and prove it</h2></div></div><div class="insight-grid">${operations}</div></section><section class="casebook" id="cases"><div class="section-heading"><div><p class="eyebrow">Adverse paths</p><h2>Complete case matrix</h2></div><p>Open a case to see its trigger and required fail-closed outcome.</p></div><div class="case-grid">${cases}</div></section>${recall}<section class="sources journey-sources" id="sources"><div><p class="eyebrow">Implementation trail</p><h2>Continue into the system</h2><p>Authoritative sources behind this blueprint.</p></div><div>${item.sources.map(([type,ref]) => `<a href="${href(ref)}"><span>${esc(type)}</span><code>${esc(ref)}</code><b>↗</b></a>`).join("")}</div></section><nav class="pager">${previous ? `<a href="${BASE}/${previous.module.id}/${previous.item.id}.html">← ${esc(previous.item.journeyName ?? previous.item.title)}</a>` : "<span></span>"}${next ? `<a href="${BASE}/${next.module.id}/${next.item.id}.html">${esc(next.item.journeyName ?? next.item.title)} →</a>` : ""}</nav>`;
  return shell(`${item.journeyName} technical journey`, item.objectives.join("; "), body, [[module.title, `${BASE}/${module.id}/`], [item.journeyName, `${BASE}/${module.id}/${item.id}.html`]]);
}

function render() {
  const map = new Map([["index.html", home()]]), flat = course.modules.flatMap((module) => module.lessons.map((item) => ({module,item})));
  map.set("capability-atlas/index.html", capabilityAtlas());
  map.set("architecture/index.html", architectureExplorer());
  for (const family of capabilityFamilies) map.set(`capability-atlas/family-${String(family.number).padStart(2,"0")}.html`, capabilityFamilyPage(family));
  map.set("integration-atlas/index.html", integrationAtlas());
  for (const group of integrationGroups) map.set(`integration-atlas/${group.prefix.toLowerCase()}.html`, integrationGroupPage(group));
  for (const module of course.modules) {
    map.set(`${module.id}/index.html`, modulePage(module));
    module.lessons.forEach((item,index) => { const pos = flat.findIndex((x) => x.item === item); map.set(`${module.id}/${item.id}.html`, lessonPage(module,item,flat[pos-1],flat[pos+1],index)); });
  }
  return map;
}

function write() {
  rmSync(join(OUT,"capability-atlas"),{recursive:true,force:true});
  rmSync(join(OUT,"integration-atlas"),{recursive:true,force:true});
  for (const { id } of course.modules) rmSync(join(OUT,id),{recursive:true,force:true});
  for (const [name,content] of pages) { const file = join(OUT,name); mkdirSync(dirname(file),{recursive:true}); writeFileSync(file,content); }
  console.log(`technical academy rendered · ${pages.size} pages`);
}
function check() {
  const errors=[]; for (const [name,content] of pages) { const file=join(OUT,name); if(!existsSync(file)||readFileSync(file,"utf8")!==content) errors.push(name); }
  if(errors.length) throw new Error(`technical academy drift: ${errors.join(", ")}`);
  console.log(`technical academy current · ${pages.size} pages`);
}
