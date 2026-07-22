import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_PATH = join(ROOT, "docs/architecture/loanos-system-map.json");

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function textLines(lines, x, y, className, lineHeight = 16, anchor = "start") {
  const content = lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join("");
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${content}</text>`;
}

function itemCard(item, x, y, width, height, tone) {
  const labelY = y + 25;
  return `<g class="item item-${tone}">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8"/>
    ${textLines([item.label], x + width / 2, labelY, "item-label", 14, "middle")}
    ${textLines([item.detail], x + width / 2, labelY + 18, "item-detail", 14, "middle")}
    ${textLines([item.ref], x + width / 2, y + height - 10, "item-ref", 14, "middle")}
  </g>`;
}

function bandHeight(band) {
  return Math.ceil(band.items.length / band.columns) === 1 ? 116 : 188;
}

function renderBand(band, x, y, width) {
  const height = bandHeight(band);
  const headerHeight = 30;
  const gap = 8;
  const padding = 12;
  const rows = Math.ceil(band.items.length / band.columns);
  const cardWidth = (width - padding * 2 - gap * (band.columns - 1)) / band.columns;
  const cardHeight = rows === 1 ? 66 : 68;
  const cards = band.items.map((item, index) => {
    const column = index % band.columns;
    const row = Math.floor(index / band.columns);
    return itemCard(item, x + padding + column * (cardWidth + gap), y + headerHeight + 8 + row * (cardHeight + 8), cardWidth, cardHeight, band.tone);
  }).join("\n");
  return `<g class="band band-${band.tone}">
    <rect class="band-frame" x="${x}" y="${y}" width="${width}" height="${height}" rx="10"/>
    <rect class="band-heading" x="${x}" y="${y}" width="${width}" height="${headerHeight}" rx="10"/>
    <path class="heading-mask" d="M ${x} ${y + headerHeight - 8} h ${width} v 8 h -${width} z"/>
    <circle cx="${x + 18}" cy="${y + 15}" r="10" class="band-number"/>
    <text x="${x + 18}" y="${y + 19}" class="band-number-text" text-anchor="middle">${band.number}</text>
    <text x="${x + 36}" y="${y + 20}" class="band-title">${escapeXml(band.title)}</text>
    ${cards}
  </g>`;
}

function renderLane(lane, x, y, width, height, side) {
  const textX = x + 33;
  const bulletX = x + 21;
  const groupToFirstItem = 28;
  const itemStep = 27;
  const groupAfterLastItem = 30;
  let cursor = y + 56;
  const groups = lane.groups.map((group) => {
    const label = `<text x="${textX}" y="${cursor}" class="lane-group">${escapeXml(group.label)}</text>`;
    const firstItemY = cursor + groupToFirstItem;
    const items = group.items.map((item, index) => {
      const itemY = firstItemY + index * itemStep;
      return `<g class="lane-item"><circle cx="${bulletX}" cy="${itemY - 4}" r="4"/><text x="${textX}" y="${itemY}">${escapeXml(item)}</text></g>`;
    }).join("");
    cursor = firstItemY + (group.items.length - 1) * itemStep + groupAfterLastItem;
    return label + items;
  }).join("");
  const arrowX1 = side === "left" ? x + width - 6 : x + 6;
  const arrowX2 = side === "left" ? x + width + 20 : x - 20;
  const arrow = `<path class="lane-arrow" d="M ${arrowX1} ${y + height / 2} H ${arrowX2}" marker-end="url(#arrow-${side})"/>`;
  return `<g class="side-lane side-${side}">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10"/>
    <rect class="lane-heading" x="${x}" y="${y}" width="${width}" height="34" rx="10"/>
    <path class="heading-mask" d="M ${x} ${y + 26} h ${width} v 8 h -${width} z"/>
    <text x="${x + width / 2}" y="${y + 22}" text-anchor="middle" class="lane-title">${escapeXml(lane.title)}</text>
    ${groups}
    ${arrow}
  </g>`;
}

function renderPrinciples(principles, x, y, width) {
  const gap = 8;
  const itemWidth = (width - gap * (principles.length - 1)) / principles.length;
  const items = principles.map((item, index) => {
    const itemX = x + index * (itemWidth + gap);
    return `<g class="principle">
      <rect x="${itemX}" y="${y + 34}" width="${itemWidth}" height="48" rx="8"/>
      <text x="${itemX + itemWidth / 2}" y="${y + 54}" text-anchor="middle" class="principle-label">${escapeXml(item.label)}</text>
      <text x="${itemX + itemWidth / 2}" y="${y + 70}" text-anchor="middle" class="principle-detail">${escapeXml(item.detail)}</text>
    </g>`;
  }).join("");
  return `<g class="principles">
    <text x="${x}" y="${y + 20}" class="principles-title">Cross-cutting security, governance &amp; compliance</text>
    <path d="M ${x + 335} ${y + 15} H ${x + width}"/>
    ${items}
  </g>`;
}

export function buildSvg(model) {
  const canvasWidth = 1600;
  const margin = 24;
  const laneWidth = 218;
  const laneGap = 28;
  const centerX = margin + laneWidth + laneGap;
  const centerWidth = canvasWidth - margin * 2 - laneWidth * 2 - laneGap * 2;
  const headerY = 24;
  const contentY = 106;
  const bandGap = 10;
  let cursorY = contentY;
  const bandSvgs = [];
  const bandConnectors = [];
  model.bands.forEach((band, index) => {
    const bandY = cursorY;
    bandSvgs.push(renderBand(band, centerX, bandY, centerWidth));
    cursorY += bandHeight(band) + bandGap;
    if (index < model.bands.length - 1) {
      const bandBottom = bandY + bandHeight(band);
      bandConnectors.push(`<path class="band-flow" d="M ${centerX + centerWidth / 2} ${bandBottom + 1} V ${bandBottom + bandGap - 2}" marker-end="url(#arrow-flow)"/>`);
    }
  });
  const bands = bandSvgs.join("\n");
  const contentBottom = cursorY - bandGap;
  const principlesY = contentBottom + 18;
  const canvasHeight = principlesY + 112;
  const laneHeight = contentBottom - contentY;
  const sourceText = `Controlled source: ${relative(ROOT, MODEL_PATH)} · Regenerate: npm run architecture:diagram`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" role="img" aria-labelledby="diagram-title diagram-desc">
  <title id="diagram-title">${escapeXml(model.title)}</title>
  <desc id="diagram-desc">A layered architecture map of LoanOS India showing people and partner ecosystems, delivery channels, API orchestration, the domain kernel, isolated decision engines, data and evidence, platform operations, infrastructure, external systems, and cross-cutting engineering principles.</desc>
  <defs>
    <marker id="arrow-left" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z"/></marker>
    <marker id="arrow-right" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z"/></marker>
    <marker id="arrow-flow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M 0 0 L 7 3.5 L 0 7 z"/></marker>
    <filter id="soft-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.08"/></filter>
    <style>
      :root { color-scheme: light; }
      svg { background: #f7f3e8; color: #17352f; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      text { fill: #17352f; }
      .kicker { fill: #397367; font-size: 13px; font-weight: 700; letter-spacing: 2px; }
      .main-title { fill: #0c2d26; font-size: 29px; font-weight: 800; letter-spacing: .2px; }
      .subtitle { fill: #536a64; font-size: 13px; font-weight: 600; }
      .source { fill: #6b7d77; font-size: 10px; }
      .band-frame, .side-lane > rect { fill: #fffdf7; stroke: #b9c8c2; stroke-width: 1; filter: url(#soft-shadow); }
      .band-heading, .lane-heading, .heading-mask { fill: #173f36; }
      .side-lane > .lane-heading { fill: #173f36; }
      .band-title, .lane-title { fill: #fffdf7; font-size: 13px; font-weight: 750; letter-spacing: .3px; }
      .band-number { fill: #f0c66c; }
      .band-number-text { fill: #17352f; font-size: 11px; font-weight: 800; }
      .item rect { stroke-width: 1; }
      .item-channel rect { fill: #edf7f2; stroke: #b8d8c9; }
      .item-api rect { fill: #eef5f6; stroke: #b9d0d2; }
      .item-domain rect { fill: #fff7e5; stroke: #e4cf9f; }
      .item-decision rect { fill: #f3eef8; stroke: #cfc0df; }
      .item-data rect { fill: #eef3f9; stroke: #bdccdc; }
      .item-runtime rect { fill: #f4f3ed; stroke: #cbc9bc; }
      .item-delivery rect { fill: #edf5eb; stroke: #bed0b9; }
      .item-label { fill: #17352f; font-size: 11px; font-weight: 750; }
      .item-detail { fill: #536a64; font-size: 9.5px; }
      .item-ref { fill: #397367; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 8.3px; }
      .lane-group { fill: #397367; font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
      .lane-item circle { fill: #d69b37; }
      .lane-item text { fill: #314e47; font-size: 10.5px; }
      .lane-arrow { fill: none; stroke: #397367; stroke-width: 1.5; }
      .band-flow { fill: none; stroke: #397367; stroke-width: 1.4; }
      #arrow-left path, #arrow-right path, #arrow-flow path { fill: #397367; }
      .principles-title { fill: #173f36; font-size: 13px; font-weight: 800; }
      .principles > path { stroke: #b9c8c2; stroke-width: 1; }
      .principle rect { fill: #173f36; }
      .principle-label { fill: #fffdf7; font-size: 10px; font-weight: 750; }
      .principle-detail { fill: #d9e5df; font-size: 8.5px; }
    </style>
  </defs>
  <g class="header">
    <text x="800" y="${headerY + 3}" text-anchor="middle" class="kicker">REFERENCE ARCHITECTURE · CURRENT REPOSITORY SHAPE</text>
    <text x="800" y="${headerY + 39}" text-anchor="middle" class="main-title">${escapeXml(model.title)}</text>
    <text x="800" y="${headerY + 63}" text-anchor="middle" class="subtitle">${escapeXml(model.subtitle)}</text>
  </g>
  ${renderLane(model.leftLane, margin, contentY, laneWidth, laneHeight, "left")}
  ${bands}
  ${bandConnectors.join("\n")}
  ${renderLane(model.rightLane, canvasWidth - margin - laneWidth, contentY, laneWidth, laneHeight, "right")}
  ${renderPrinciples(model.principles, margin, principlesY, canvasWidth - margin * 2)}
  <text x="800" y="${canvasHeight - 8}" text-anchor="middle" class="source">${escapeXml(sourceText)}</text>
</svg>
`;
}

export async function loadModel() {
  const model = JSON.parse(await readFile(MODEL_PATH, "utf8"));
  if (model.schemaVersion !== 1) throw new Error(`Unsupported architecture map schema: ${model.schemaVersion}`);
  for (const source of model.sources) await stat(join(ROOT, source));
  for (const band of model.bands) {
    if (!band.items.length || band.items.length > band.columns * 2) throw new Error(`Band ${band.number} has an unsupported item count`);
    for (const item of band.items) {
      if (item.ref.length > 30) throw new Error(`Band ${band.number} reference is too long to render: ${item.ref}`);
    }
  }
  return model;
}

export async function run({ check = false } = {}) {
  const model = await loadModel();
  const outputPath = join(ROOT, model.artifact);
  const expected = buildSvg(model);
  if (check) {
    const actual = await readFile(outputPath, "utf8").catch(() => "");
    if (actual !== expected) throw new Error(`${relative(ROOT, outputPath)} is stale; run npm run architecture:diagram`);
    return outputPath;
  }
  await writeFile(outputPath, expected);
  return outputPath;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run({ check: process.argv.includes("--check") })
    .then((outputPath) => console.log(`${process.argv.includes("--check") ? "Verified" : "Generated"} ${relative(ROOT, outputPath)}`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
