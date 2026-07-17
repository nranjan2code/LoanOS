#!/usr/bin/env node
// Renders the BA Lending Academy (apps/help/academy/content/) into static,
// cross-linked tutorial pages under apps/help/academy/, served at /help/academy/.
// Contract: docs/product/ba-lending-academy-curriculum.md. Validation fails closed:
// no page is written unless the whole curriculum passes.
// Usage: node scripts/build-academy.mjs [--check]

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/help/academy");
const BASE = "/help/academy";
const CHECK = process.argv.includes("--check");
const PRESERVED = new Set(["content", "academy.css"]);
const PLATFORM_TYPES = new Set(["doc", "code", "capability", "surface", "guide"]);
const PLATFORM_LABEL = { doc: "Document", code: "Code", capability: "Capability", surface: "App surface", guide: "Operating guide" };

const { course, glossary } = await import(pathToFileURL(join(OUT, "content/course.mjs")).href);
const { PRODUCT_JOURNEY_CONTRACTS } = await import(pathToFileURL(join(ROOT, "packages/core/src/product-journey-contracts.js")).href);
course.modules.forEach((module, index) => { module.number = index + 1; });
const BASE_LIFECYCLE = new Set(["draft", "submitted", "identity_verified", "underwriting", "approved", "contracted", "disbursed", "active", "delinquent", "restructured", "closed", "cancelled"]);
const supportMatrix = new Map();
for (const row of readFileSync(join(ROOT, "docs/product/product-journey-support-matrix.md"), "utf8")
  .matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm)) {
  const key = row[1].toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (key && !key.startsWith("public_journey") && !/^-+$/.test(row[1].trim().replaceAll("-", ""))) {
    supportMatrix.set(key, { journey: row[1], support: row[2], boundary: row[3], remaining: row[4] });
  }
}
const registerIds = new Set([...readFileSync(join(ROOT, "docs/compliance/india-regulatory-register.md"), "utf8")
  .matchAll(/^\|\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*\|/gm)].map((m) => m[1]));
const catalog = readFileSync(join(ROOT, "docs/product/complete-system-capability-catalog.md"), "utf8");
const guideIds = new Set([...readFileSync(join(ROOT, "apps/help/help.js"), "utf8").matchAll(/id:"([a-z0-9-]+)"/g)].map((m) => m[1]));
const glossaryTerms = new Set(glossary.map((entry) => entry.term));

validate();
const pages = render();
CHECK ? check(pages) : write(pages);

// ── validation ───────────────────────────────────────────────────────────────

function validate() {
  const errors = [];
  const fail = (where, message) => errors.push(`${where}: ${message}`);
  const lessonPaths = new Set(course.modules.flatMap((m) => m.lessons.map((l) => `${m.id}/${l.id}`)));
  const seen = new Set();

  for (const module of course.modules) {
    if (seen.has(module.id)) fail(module.id, "duplicate module id");
    seen.add(module.id);
    for (const field of ["title", "tagline", "summary"]) if (!module[field]) fail(module.id, `missing ${field}`);
    if (!module.lessons?.length) fail(module.id, "module has no lessons");
    for (const lesson of module.lessons ?? []) {
      const where = `${module.id}/${lesson.id}`;
      if (seen.has(where)) fail(where, "duplicate lesson id");
      seen.add(where);
      for (const field of ["title", "duration", "verified"]) if (!lesson[field]) fail(where, `missing ${field}`);
      if (!(lesson.objectives?.length >= 2 && lesson.objectives.length <= 4)) fail(where, "objectives must contain 2-4 entries");
      if (!(lesson.sections?.length >= 2 && lesson.sections.length <= 6)) fail(where, "sections must contain 2-6 entries");
      for (const section of lesson.sections ?? []) if (!section.heading || !section.body) fail(where, "section missing heading or body");
      if (!lesson.regulatory?.length) fail(where, "at least one regulatory anchor is required");
      for (const anchor of lesson.regulatory ?? []) {
        if (!registerIds.has(anchor.id)) fail(where, `unknown regulatory control family: ${anchor.id}`);
        if (!anchor.note) fail(where, `regulatory anchor ${anchor.id} missing note`);
      }
      if (!lesson.platform?.length) fail(where, "at least one platform citation is required");
      for (const citation of lesson.platform ?? []) {
        if (!PLATFORM_TYPES.has(citation.type)) { fail(where, `unknown citation type: ${citation.type}`); continue; }
        if (!citation.note) fail(where, `citation ${citation.ref} missing note`);
        if (citation.type === "capability" && !catalog.includes(`| ${citation.ref} |`)) fail(where, `capability not in catalogue: ${citation.ref}`);
        if (citation.type === "guide" && !guideIds.has(citation.ref)) fail(where, `unknown guide article: ${citation.ref}`);
        if (citation.type === "surface" && !citation.ref.startsWith("/")) fail(where, `surface must be a served path: ${citation.ref}`);
        if ((citation.type === "doc" || citation.type === "code") && !existsSync(join(ROOT, citation.ref))) fail(where, `cited path does not exist: ${citation.ref}`);
      }
      if (lesson.journeyType) {
        if (!PRODUCT_JOURNEY_CONTRACTS[lesson.journeyType]) fail(where, `unknown product journey contract: ${lesson.journeyType}`);
        if (!supportMatrix.has(lesson.journeyType)) fail(where, `journey missing from the support matrix: ${lesson.journeyType}`);
      }
      for (const term of lesson.terms ?? []) if (!glossaryTerms.has(term)) fail(where, `term not in glossary: ${term}`);
      for (const target of lesson.related ?? []) if (!lessonPaths.has(target)) fail(where, `related lesson does not resolve: ${target}`);
      if (!lesson.check?.length) fail(where, "at least one knowledge-check question is required");
      for (const question of lesson.check ?? []) {
        if (!(question.options?.length >= 2)) fail(where, "knowledge check needs at least two options");
        if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= (question.options?.length ?? 0)) fail(where, "knowledge-check answer index out of range");
        if (!question.why) fail(where, "knowledge-check missing explanation");
      }
    }
  }
  if (errors.length) {
    console.error(`academy validation failed · ${errors.length} error(s)`);
    for (const message of errors) console.error(`  ${message}`);
    process.exit(1);
  }
}

// ── rendering ────────────────────────────────────────────────────────────────

function render() {
  const flat = course.modules.flatMap((module) => module.lessons.map((lesson) => ({ module, lesson })));
  const pages = new Map();
  pages.set("index.html", homePage(flat));
  pages.set("glossary.html", glossaryPage());
  course.modules.forEach((module, index) => {
    pages.set(`${module.id}/index.html`, modulePage(module, course.modules[index - 1], course.modules[index + 1]));
    module.lessons.forEach((lesson) => {
      const position = flat.findIndex((entry) => entry.lesson === lesson);
      pages.set(`${module.id}/${lesson.id}.html`, lessonPage(module, lesson, flat[position - 1], flat[position + 1]));
    });
  });
  return pages;
}

function esc(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function inline(text) {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function slug(term) {
  return term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function prose(body) {
  return body.split(/\n\n+/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((line) => line.startsWith("- "))) return `<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join("")}</ul>`;
    if (lines.every((line) => /^\d+\.\s/.test(line))) return `<ol>${lines.map((line) => `<li>${inline(line.replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol>`;
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}

function minutes(duration) {
  return Number(/(\d+)/.exec(duration)?.[1] ?? 0);
}

function page(title, description, body, { crumbs = [] } = {}) {
  const trail = [["Guide & Academy", "/help/"], ["BA Lending Academy", `${BASE}/`], ...crumbs];
  return `<!-- Generated by scripts/build-academy.mjs — do not edit. Source: apps/help/academy/content/ -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(description)}">
<title>${esc(title === course.title ? title : `${title} · BA Lending Academy`)} · LoanOS</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${BASE}/academy.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="topbar">
  <a class="brand" href="/help/" aria-label="LoanOS Guide and Academy"><span class="brand-mark">L</span><span><strong>LoanOS</strong><small>BA Lending Academy</small></span></a>
  <nav aria-label="Academy"><a href="${BASE}/">Course home</a><a href="${BASE}/glossary.html">Glossary</a><a href="/help/">Guide</a></nav>
</header>
<nav class="crumbs" aria-label="Breadcrumb">${trail.map(([label, href], index) => index === trail.length - 1 && !href ? `<span aria-current="page">${esc(label)}</span>` : `<a href="${href}">${esc(label)}</a>`).join('<span class="crumb-sep">/</span>')}</nav>
<main id="main">
${body}
</main>
<footer>
  <p><strong>LoanOS India · BA Lending Academy</strong></p>
  <p class="disclaimer">${esc(course.disclaimer)}</p>
  <p><a href="/help/">Guide &amp; Academy</a> · <a href="${BASE}/glossary.html">Glossary</a> · Course verified ${esc(course.verified)}</p>
</footer>
</body>
</html>
`;
}

function homePage(flat) {
  const totalMinutes = flat.reduce((sum, entry) => sum + minutes(entry.lesson.duration), 0);
  const body = `
<section class="hero">
  <p class="eyebrow">End-to-end training for business analysts</p>
  <h1>${esc(course.title)}</h1>
  <p class="lede">${esc(course.subtitle)}</p>
  <p class="audience">${esc(course.audience)}</p>
  <div class="stats"><span><strong>${course.modules.length}</strong> modules</span><span><strong>${flat.length}</strong> lessons</span><span><strong>~${Math.round(totalMinutes / 60)} h</strong> total</span><span>Verified ${esc(course.verified)}</span></div>
  <p><a class="primary" href="${BASE}/${course.modules[0].id}/${course.modules[0].lessons[0].id}.html">Start lesson 1.1 →</a></p>
</section>
<section class="module-list">
${course.modules.map((module) => `  <article class="module-card">
    <p class="eyebrow">Module ${module.number}</p>
    <h2><a href="${BASE}/${module.id}/">${esc(module.title)}</a></h2>
    <p class="tagline">${esc(module.tagline)}</p>
    <ol class="lesson-links">${module.lessons.map((lesson) => `<li><a href="${BASE}/${module.id}/${lesson.id}.html">${esc(lesson.title)}</a><span class="duration">${esc(lesson.duration)}</span></li>`).join("")}</ol>
  </article>`).join("\n")}
</section>`;
  return page(course.title, course.subtitle, body, { crumbs: [] });
}

function modulePage(module, previous, next) {
  const body = `
<section class="hero">
  <p class="eyebrow">Module ${module.number} of ${course.modules.length}</p>
  <h1>${esc(module.title)}</h1>
  <p class="lede">${esc(module.tagline)}</p>
  <p>${esc(module.summary)}</p>
</section>
<section class="lesson-cards">
${module.lessons.map((lesson, index) => `  <article class="lesson-card">
    <p class="eyebrow">Lesson ${module.number}.${index + 1} · ${esc(lesson.duration)}</p>
    <h2><a href="${BASE}/${module.id}/${lesson.id}.html">${esc(lesson.title)}</a></h2>
    <ul>${lesson.objectives.map((objective) => `<li>${esc(objective)}</li>`).join("")}</ul>
  </article>`).join("\n")}
</section>
<nav class="pager" aria-label="Module navigation">
  ${previous ? `<a class="prev" href="${BASE}/${previous.id}/">← Module ${previous.number}: ${esc(previous.title)}</a>` : "<span></span>"}
  ${next ? `<a class="next" href="${BASE}/${next.id}/">Module ${next.number}: ${esc(next.title)} →</a>` : "<span></span>"}
</nav>`;
  return page(module.title, module.summary, body, { crumbs: [[`Module ${module.number}`, null]] });
}

function lessonPage(module, lesson, previous, next) {
  const number = `${module.number}.${module.lessons.indexOf(lesson) + 1}`;
  const related = (lesson.related ?? []).map((target) => {
    const [moduleId, lessonId] = target.split("/");
    const targetModule = course.modules.find((candidate) => candidate.id === moduleId);
    const targetLesson = targetModule.lessons.find((candidate) => candidate.id === lessonId);
    return `<li><a href="${BASE}/${moduleId}/${lessonId}.html">${esc(targetLesson.title)}</a> <span class="muted">(module ${targetModule.number})</span></li>`;
  });
  const body = `
<article class="lesson">
  <header class="lesson-head">
    <p class="eyebrow">Lesson ${number} · ${esc(lesson.duration)} · Verified ${esc(lesson.verified)}</p>
    <h1>${esc(lesson.title)}</h1>
    <div class="objectives"><strong>After this lesson you can:</strong><ul>${lesson.objectives.map((objective) => `<li>${esc(objective)}</li>`).join("")}</ul></div>
  </header>
  <aside class="toc"><strong>On this page</strong><ol>${lesson.sections.map((section) => `<li>${esc(section.heading)}</li>`).join("")}${lesson.journeyType ? "<li>Journey contract</li><li>Platform support</li>" : ""}<li>Where this lives in LoanOS</li><li>Knowledge check</li></ol></aside>
${lesson.sections.map((section, index) => `  <section><h2>${index + 1}. ${esc(section.heading)}</h2>${prose(section.body)}</section>`).join("\n")}
${lesson.journeyType ? journeyPanels(lesson.journeyType) : ""}
  <section class="panel regulatory"><h2>Regulatory anchors</h2><ul>${lesson.regulatory.map((anchor) => `<li><code>${esc(anchor.id)}</code> — ${esc(anchor.note)}</li>`).join("")}</ul><p class="muted">Family IDs resolve in the India regulatory register (<code>docs/compliance/india-regulatory-register.md</code>), which owns sources and caveats.</p></section>
  <section class="panel platform"><h2>Where this lives in LoanOS</h2><ul>${lesson.platform.map((citation) => {
    const label = PLATFORM_LABEL[citation.type];
    const reference = citation.type === "surface" ? (citation.ref.includes("{") ? `<code>${esc(citation.ref)}</code>` : `<a href="${citation.ref}">${esc(citation.ref)}</a>`)
      : citation.type === "guide" ? `<a href="/help/">${esc(citation.ref)}</a> <span class="muted">(open in the Guide)</span>`
      : `<code>${esc(citation.ref)}</code>`;
    return `<li><span class="cite-type">${label}</span> ${reference} — ${esc(citation.note)}</li>`;
  }).join("")}</ul></section>
  ${lesson.terms?.length ? `<section class="terms"><h2>Key terms</h2><p>${lesson.terms.map((term) => `<a class="term" href="${BASE}/glossary.html#${slug(term)}">${esc(term)}</a>`).join(" ")}</p></section>` : ""}
  <section class="panel checks"><h2>Knowledge check</h2>${lesson.check.map((question, index) => `<div class="check"><p class="check-q">${index + 1}. ${esc(question.q)}</p><ol class="check-options" type="A">${question.options.map((option) => `<li>${esc(option)}</li>`).join("")}</ol><details><summary>Show answer</summary><p><strong>${String.fromCharCode(65 + question.answer)}.</strong> ${esc(question.why)}</p></details></div>`).join("")}</section>
  ${related.length ? `<section class="related"><h2>Related lessons</h2><ul>${related.join("")}</ul></section>` : ""}
</article>
<nav class="pager" aria-label="Lesson navigation">
  ${previous ? `<a class="prev" href="${BASE}/${previous.module.id}/${previous.lesson.id}.html">← ${esc(previous.lesson.title)}</a>` : "<span></span>"}
  ${next ? `<a class="next" href="${BASE}/${next.module.id}/${next.lesson.id}.html">${esc(next.lesson.title)} →</a>` : "<span></span>"}
</nav>`;
  return page(lesson.title, lesson.objectives[0], body, { crumbs: [[`Module ${module.number}`, `${BASE}/${module.id}/`], [`Lesson ${number}`, null]] });
}

function journeyPanels(journeyType) {
  const contract = PRODUCT_JOURNEY_CONTRACTS[journeyType];
  const support = supportMatrix.get(journeyType);
  const servicing = contract.lifecycleCapabilities.filter((capability) => !BASE_LIFECYCLE.has(capability));
  const term = (value) => `<code>${esc(value)}</code>`;
  return `  <section class="panel journey"><h2>Journey contract <span class="muted">(derived from code at build time)</span></h2>
    <p class="muted">Source: <code>packages/core/src/product-journey-contracts.js</code> · <code>${esc(contract.contractId)}</code> v${contract.contractVersion} · checksum <code>${esc(contract.checksumSha256.slice(0, 12))}…</code></p>
    <dl class="contract">
      <div><dt>Workspace archetype</dt><dd>${term(contract.archetype)}</dd></div>
      <div><dt>Facility type</dt><dd>${term(contract.facility.type)}</dd></div>
      <div><dt>Security type</dt><dd>${term(contract.security.type)}${contract.security.releaseRequiresDualControl ? ' <span class="muted">· release requires dual control</span>' : ""}</dd></div>
      <div><dt>Required facts (${contract.requiredFacts.length})</dt><dd>${contract.requiredFacts.map(term).join(" ")}</dd></div>
      <div><dt>Required evidence (${contract.requiredEvidence.length})</dt><dd>${contract.requiredEvidence.map(term).join(" ")}</dd></div>
      <div><dt>Servicing capabilities (${servicing.length})</dt><dd>${servicing.map(term).join(" ")}</dd></div>
    </dl>
    <p class="muted">Every journey additionally enforces exact minor-unit money, fail-closed limit enforcement, dual-control disbursement and evidence-before-disbursement.</p>
  </section>
  <section class="panel support"><h2>Platform support <span class="muted">(from the journey support matrix)</span></h2>
    <ul>
      <li><span class="cite-type">Support level</span> <strong>${esc(support.support)}</strong></li>
      <li><span class="cite-type">Implemented boundary</span> ${esc(support.boundary)}</li>
      <li><span class="cite-type">Remaining before production-ready</span> ${esc(support.remaining)}</li>
    </ul>
    <p class="muted">Maturity truth lives in <code>docs/product/product-journey-support-matrix.md</code>; a lesson existing is not evidence of production readiness.</p>
  </section>`;
}

function glossaryPage() {
  const sorted = [...glossary].sort((a, b) => a.term.localeCompare(b.term));
  const body = `
<section class="hero">
  <p class="eyebrow">Reference</p>
  <h1>Course glossary</h1>
  <p class="lede">Shared vocabulary for the BA Lending Academy. Regulatory meanings track the GTM glossary and the India regulatory register.</p>
</section>
<dl class="glossary">
${sorted.map((entry) => `  <div class="entry" id="${slug(entry.term)}"><dt>${esc(entry.term)}</dt><dd>${esc(entry.def)}</dd></div>`).join("\n")}
</dl>`;
  return page("Glossary", "Shared vocabulary for the BA Lending Academy.", body, { crumbs: [["Glossary", null]] });
}

// ── output ───────────────────────────────────────────────────────────────────

function generatedOnDisk() {
  if (!existsSync(OUT)) return [];
  const found = [];
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (prefix === "" && PRESERVED.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      entry.isDirectory() ? walk(join(directory, entry.name), relative) : found.push(relative);
    }
  };
  walk(OUT, "");
  return found;
}

function write(pages) {
  for (const entry of readdirSync(OUT, { withFileTypes: true })) {
    if (PRESERVED.has(entry.name)) continue;
    rmSync(join(OUT, entry.name), { recursive: true, force: true });
  }
  for (const [relative, html] of pages) {
    const target = join(OUT, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, html);
  }
  const bytes = [...pages.values()].reduce((sum, html) => sum + html.length, 0);
  console.log(`academy build · modules=${course.modules.length} · lessons=${course.modules.reduce((sum, module) => sum + module.lessons.length, 0)} · pages=${pages.size} · ${(bytes / 1024).toFixed(0)} KiB`);
}

function check(pages) {
  const problems = [];
  for (const [relative, html] of pages) {
    const target = join(OUT, relative);
    if (!existsSync(target)) problems.push(`missing generated page: ${relative}`);
    else if (readFileSync(target, "utf8") !== html) problems.push(`stale generated page (rebuild with npm run academy:build): ${relative}`);
  }
  for (const relative of generatedOnDisk()) if (!pages.has(relative)) problems.push(`orphan generated file: ${relative}`);
  if (problems.length) {
    console.error(`academy check failed · ${problems.length} problem(s)`);
    for (const message of problems) console.error(`  ${message}`);
    process.exit(1);
  }
  console.log(`academy check · ${pages.size} pages current`);
}
