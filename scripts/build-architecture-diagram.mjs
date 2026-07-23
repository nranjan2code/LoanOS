import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_PATH = join(ROOT, "docs/architecture/loanos-system-map.json");
const BAND_TONES = new Set(["channel", "api", "domain", "decision", "data", "runtime", "delivery"]);
const RELATIONSHIP_TYPES = ["request", "decision", "event", "evidence", "integration"];
const RELATIONSHIP_LABELS = {
  request: "Request / command",
  decision: "Policy decision",
  event: "Event / state change",
  evidence: "Evidence / assurance",
  integration: "External integration"
};

function modelError(path, message) {
  throw new Error(`${path}: ${message}`);
}

function expectObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) modelError(path, "expected an object");
}

function expectString(value, path) {
  if (typeof value !== "string" || !value.trim()) modelError(path, "expected a non-empty string");
}

function expectArray(value, path) {
  if (!Array.isArray(value) || value.length === 0) modelError(path, "expected a non-empty array");
}

function validateLane(lane, path) {
  expectObject(lane, path);
  expectString(lane.title, `${path}.title`);
  expectArray(lane.groups, `${path}.groups`);
  lane.groups.forEach((group, groupIndex) => {
    const groupPath = `${path}.groups[${groupIndex}]`;
    expectObject(group, groupPath);
    expectString(group.label, `${groupPath}.label`);
    expectArray(group.items, `${groupPath}.items`);
    group.items.forEach((item, itemIndex) => expectString(item, `${groupPath}.items[${itemIndex}]`));
  });
}

export function validateModel(model) {
  expectObject(model, "$");
  if (model.schemaVersion !== 2) modelError("$.schemaVersion", `expected 2, received ${String(model.schemaVersion)}`);
  expectString(model.title, "$.title");
  expectString(model.subtitle, "$.subtitle");
  expectString(model.artifact, "$.artifact");
  if (isAbsolute(model.artifact) || model.artifact.split(/[\\/]/).includes("..") || !model.artifact.endsWith(".svg")) {
    modelError("$.artifact", "expected a repository-relative .svg path without parent traversal");
  }

  expectArray(model.sources, "$.sources");
  const sources = new Set();
  model.sources.forEach((source, index) => {
    expectString(source, `$.sources[${index}]`);
    if (isAbsolute(source) || source.split(/[\\/]/).includes("..")) {
      modelError(`$.sources[${index}]`, "expected a repository-relative path without parent traversal");
    }
    if (sources.has(source)) modelError(`$.sources[${index}]`, `duplicate source "${source}"`);
    sources.add(source);
  });

  validateLane(model.leftLane, "$.leftLane");
  validateLane(model.rightLane, "$.rightLane");

  expectArray(model.bands, "$.bands");
  const bandNumbers = new Set();
  model.bands.forEach((band, bandIndex) => {
    const bandPath = `$.bands[${bandIndex}]`;
    expectObject(band, bandPath);
    if (!Number.isInteger(band.number) || band.number < 1) modelError(`${bandPath}.number`, "expected a positive integer");
    if (bandNumbers.has(band.number)) modelError(`${bandPath}.number`, `duplicate band number ${band.number}`);
    bandNumbers.add(band.number);
    expectString(band.title, `${bandPath}.title`);
    if (!BAND_TONES.has(band.tone)) modelError(`${bandPath}.tone`, `expected one of ${[...BAND_TONES].join(", ")}`);
    if (!Number.isInteger(band.columns) || band.columns < 1 || band.columns > 6) {
      modelError(`${bandPath}.columns`, "expected an integer from 1 to 6");
    }
    expectArray(band.items, `${bandPath}.items`);
    band.items.forEach((item, itemIndex) => {
      const itemPath = `${bandPath}.items[${itemIndex}]`;
      expectObject(item, itemPath);
      expectString(item.label, `${itemPath}.label`);
      expectString(item.detail, `${itemPath}.detail`);
      expectString(item.ref, `${itemPath}.ref`);
    });
  });

  expectArray(model.principles, "$.principles");
  model.principles.forEach((principle, index) => {
    const path = `$.principles[${index}]`;
    expectObject(principle, path);
    expectString(principle.label, `${path}.label`);
    expectString(principle.detail, `${path}.detail`);
  });

  expectArray(model.relationships, "$.relationships");
  const relationshipIds = new Set();
  const endpoints = new Set(["lane:left", "lane:right", ...[...bandNumbers].map((number) => `band:${number}`)]);
  model.relationships.forEach((relationship, index) => {
    const path = `$.relationships[${index}]`;
    expectObject(relationship, path);
    expectString(relationship.id, `${path}.id`);
    if (relationshipIds.has(relationship.id)) modelError(`${path}.id`, `duplicate relationship id "${relationship.id}"`);
    relationshipIds.add(relationship.id);
    expectString(relationship.from, `${path}.from`);
    expectString(relationship.to, `${path}.to`);
    if (!endpoints.has(relationship.from)) modelError(`${path}.from`, `unknown endpoint "${relationship.from}"`);
    if (!endpoints.has(relationship.to)) modelError(`${path}.to`, `unknown endpoint "${relationship.to}"`);
    if (relationship.from === relationship.to) modelError(`${path}.to`, "must differ from the source endpoint");
    if (!RELATIONSHIP_TYPES.includes(relationship.type)) {
      modelError(`${path}.type`, `expected one of ${RELATIONSHIP_TYPES.join(", ")}`);
    }
    expectString(relationship.label, `${path}.label`);
    const pair = [relationship.from, relationship.to];
    const bandPair = pair.every((endpoint) => endpoint.startsWith("band:"));
    const leftPair = relationship.from === "lane:left" && relationship.to.startsWith("band:");
    const rightPair = relationship.from.startsWith("band:") && relationship.to === "lane:right";
    if (!bandPair && !leftPair && !rightPair) {
      modelError(path, "expected band-to-band, left-lane-to-band, or band-to-right-lane direction");
    }
  });

  return model;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(value, maxCharacters) {
  const words = String(value).trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (word.length > maxCharacters) {
      if (line) {
        lines.push(line);
        line = "";
      }
      for (let index = 0; index < word.length; index += maxCharacters) lines.push(word.slice(index, index + maxCharacters));
      continue;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharacters) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function textLines(lines, x, y, className, lineHeight = 16, anchor = "start") {
  const content = lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join("");
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${content}</text>`;
}

function itemLayout(item, width) {
  const label = wrapText(item.label, Math.max(12, Math.floor((width - 20) / 6.5)));
  const detail = wrapText(item.detail, Math.max(16, Math.floor((width - 18) / 5.2)));
  const ref = wrapText(item.ref, Math.max(16, Math.floor((width - 18) / 5)));
  const height = Math.max(66, 12 + label.length * 14 + 3 + detail.length * 13 + 3 + ref.length * 11 + 8);
  return { label, detail, ref, height };
}

function itemCard(item, layout, x, y, width, height, tone) {
  const labelY = y + 20;
  const detailY = labelY + layout.label.length * 14 + 2;
  const refY = y + height - 9 - (layout.ref.length - 1) * 11;
  return `<g class="item item-${tone}">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8"/>
    ${textLines(layout.label, x + width / 2, labelY, "item-label", 14, "middle")}
    ${textLines(layout.detail, x + width / 2, detailY, "item-detail", 13, "middle")}
    ${textLines(layout.ref, x + width / 2, refY, "item-ref", 11, "middle")}
  </g>`;
}

function measureBand(band, width) {
  const gap = 8;
  const padding = 12;
  const cardWidth = (width - padding * 2 - gap * (band.columns - 1)) / band.columns;
  const itemLayouts = band.items.map((item) => itemLayout(item, cardWidth));
  const rows = Math.ceil(band.items.length / band.columns);
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(
    ...itemLayouts.slice(row * band.columns, (row + 1) * band.columns).map(({ height }) => height)
  ));
  const height = 30 + 8 + rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0) + gap * Math.max(0, rows - 1) + 10;
  return { cardWidth, gap, padding, itemLayouts, rowHeights, height };
}

function renderBand(band, layout, x, y, width) {
  const headerHeight = 30;
  const rowOffsets = layout.rowHeights.map((_, row) => layout.rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0) + layout.gap * row);
  const cards = band.items.map((item, index) => {
    const column = index % band.columns;
    const row = Math.floor(index / band.columns);
    return itemCard(
      item,
      layout.itemLayouts[index],
      x + layout.padding + column * (layout.cardWidth + layout.gap),
      y + headerHeight + 8 + rowOffsets[row],
      layout.cardWidth,
      layout.rowHeights[row],
      band.tone
    );
  }).join("\n");
  return `<g class="band band-${band.tone}">
    <rect class="band-frame" x="${x}" y="${y}" width="${width}" height="${layout.height}" rx="10"/>
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
  let cursor = y + 56;
  const groups = lane.groups.map((group) => {
    const label = `<text x="${textX}" y="${cursor}" class="lane-group">${escapeXml(group.label)}</text>`;
    const firstItemY = cursor + 28;
    const items = group.items.map((item, index) => {
      const itemY = firstItemY + index * 27;
      return `<g class="lane-item"><circle cx="${bulletX}" cy="${itemY - 4}" r="4"/><text x="${textX}" y="${itemY}">${escapeXml(item)}</text></g>`;
    }).join("");
    cursor = firstItemY + (group.items.length - 1) * 27 + 30;
    return label + items;
  }).join("");
  return `<g class="side-lane side-${side}">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10"/>
    <rect class="lane-heading" x="${x}" y="${y}" width="${width}" height="34" rx="10"/>
    <path class="heading-mask" d="M ${x} ${y + 26} h ${width} v 8 h -${width} z"/>
    <text x="${x + width / 2}" y="${y + 22}" text-anchor="middle" class="lane-title">${escapeXml(lane.title)}</text>
    ${groups}
  </g>`;
}

function measureLane(lane) {
  const groupLabels = lane.groups.length * 28;
  const itemLines = lane.groups.reduce((sum, group) => sum + group.items.length * 27, 0);
  const groupSpacing = lane.groups.length * 30;
  return 56 + groupLabels + itemLines + groupSpacing + 16;
}

function renderRelationships(relationships, bandBoxes, geometry) {
  const { centerX, centerWidth, leftLaneRight, rightLaneLeft } = geometry;
  return relationships.map((relationship) => {
    const fromBand = relationship.from.startsWith("band:") ? bandBoxes.get(Number(relationship.from.slice(5))) : null;
    const toBand = relationship.to.startsWith("band:") ? bandBoxes.get(Number(relationship.to.slice(5))) : null;
    let path;
    if (fromBand && toBand) {
      const downward = toBand.y > fromBand.y;
      const startY = downward ? fromBand.y + fromBand.height + 1 : fromBand.y - 1;
      const endY = downward ? toBand.y - 2 : toBand.y + toBand.height + 2;
      path = `M ${centerX + centerWidth / 2} ${startY} V ${endY}`;
    } else if (relationship.from === "lane:left" && toBand) {
      path = `M ${leftLaneRight - 6} ${toBand.y + toBand.height / 2} H ${centerX - 8}`;
    } else if (fromBand && relationship.to === "lane:right") {
      path = `M ${centerX + centerWidth + 8} ${fromBand.y + fromBand.height / 2} H ${rightLaneLeft + 6}`;
    }
    return `<g class="relationship relationship-${relationship.type}" role="group" aria-label="${escapeXml(relationship.label)}">
    <title>${escapeXml(relationship.label)}</title>
    <path d="${path}" marker-end="url(#arrow-${relationship.type})"/>
  </g>`;
  }).join("\n");
}

function renderRelationshipLegend(relationships, x, y, width) {
  const usedTypes = RELATIONSHIP_TYPES.filter((type) => relationships.some((relationship) => relationship.type === type));
  const itemWidth = width / usedTypes.length;
  const items = usedTypes.map((type, index) => {
    const itemX = x + index * itemWidth;
    return `<g class="relationship-key">
      <path class="relationship-${type}" d="M ${itemX + 10} ${y + 43} H ${itemX + 42}" marker-end="url(#arrow-${type})"/>
      <text x="${itemX + 51}" y="${y + 47}">${escapeXml(RELATIONSHIP_LABELS[type])}</text>
    </g>`;
  }).join("\n");
  return `<g class="relationship-legend">
    <text x="${x}" y="${y + 20}" class="section-title">Relationship semantics</text>
    <path class="section-rule" d="M ${x + 190} ${y + 15} H ${x + width}"/>
    ${items}
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
    <text x="${x}" y="${y + 20}" class="section-title">Cross-cutting security, governance &amp; compliance</text>
    <path class="section-rule" d="M ${x + 335} ${y + 15} H ${x + width}"/>
    ${items}
  </g>`;
}

export function buildSvg(model) {
  validateModel(model);
  const canvasWidth = 1600;
  const margin = 24;
  const laneWidth = 218;
  const laneGap = 28;
  const centerX = margin + laneWidth + laneGap;
  const centerWidth = canvasWidth - margin * 2 - laneWidth * 2 - laneGap * 2;
  const headerY = 24;
  const contentY = 106;
  const bandGap = 16;
  let cursorY = contentY;
  const bandBoxes = new Map();
  const bands = model.bands.map((band) => {
    const layout = measureBand(band, centerWidth);
    const bandY = cursorY;
    cursorY += layout.height + bandGap;
    bandBoxes.set(band.number, { y: bandY, height: layout.height });
    return renderBand(band, layout, centerX, bandY, centerWidth);
  }).join("\n");
  const bandsBottom = cursorY - bandGap;
  const laneHeight = Math.max(bandsBottom - contentY, measureLane(model.leftLane), measureLane(model.rightLane));
  const contentBottom = contentY + laneHeight;
  const legendY = contentBottom + 18;
  const principlesY = legendY + 62;
  const canvasHeight = principlesY + 112;
  const sourceText = `Controlled source: ${relative(ROOT, MODEL_PATH)} · Regenerate: npm run architecture:diagram`;
  const relationshipDescription = model.relationships.map(({ label }) => label).join("; ");
  const relationships = renderRelationships(model.relationships, bandBoxes, {
    centerX,
    centerWidth,
    leftLaneRight: margin + laneWidth,
    rightLaneLeft: canvasWidth - margin - laneWidth
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" role="img" aria-labelledby="diagram-title diagram-desc">
  <title id="diagram-title">${escapeXml(model.title)}</title>
  <desc id="diagram-desc">A layered architecture map of LoanOS India showing people and partner ecosystems, delivery channels, API orchestration, the domain kernel, isolated decision engines, data and evidence, platform operations, infrastructure, external systems, and cross-cutting engineering principles. Relationships: ${escapeXml(relationshipDescription)}.</desc>
  <defs>
    ${RELATIONSHIP_TYPES.map((type) => `<marker id="arrow-${type}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z"/></marker>`).join("\n    ")}
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
      .relationship path, .relationship-key path { fill: none; stroke-width: 1.7; }
      .relationship-request path, path.relationship-request { stroke: #397367; }
      .relationship-decision path, path.relationship-decision { stroke: #76558f; }
      .relationship-event path, path.relationship-event { stroke: #3f7184; stroke-dasharray: 6 4; }
      .relationship-evidence path, path.relationship-evidence { stroke: #b77819; stroke-dasharray: 2 3; }
      .relationship-integration path, path.relationship-integration { stroke: #257b78; stroke-dasharray: 9 4; }
      #arrow-request path { fill: #397367; }
      #arrow-decision path { fill: #76558f; }
      #arrow-event path { fill: #3f7184; }
      #arrow-evidence path { fill: #b77819; }
      #arrow-integration path { fill: #257b78; }
      .relationship-key text { fill: #314e47; font-size: 10px; font-weight: 650; }
      .section-title { fill: #173f36; font-size: 13px; font-weight: 800; }
      .section-rule { stroke: #b9c8c2; stroke-width: 1; }
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
  ${relationships}
  ${renderLane(model.rightLane, canvasWidth - margin - laneWidth, contentY, laneWidth, laneHeight, "right")}
  ${renderRelationshipLegend(model.relationships, margin, legendY, canvasWidth - margin * 2)}
  ${renderPrinciples(model.principles, margin, principlesY, canvasWidth - margin * 2)}
  <text x="800" y="${canvasHeight - 8}" text-anchor="middle" class="source">${escapeXml(sourceText)}</text>
</svg>
`;
}

export async function loadModel({ modelPath = MODEL_PATH, root = ROOT } = {}) {
  let model;
  try {
    model = JSON.parse(await readFile(modelPath, "utf8"));
  } catch (error) {
    throw new Error(`${relative(root, modelPath)}: could not parse architecture model (${error.message})`);
  }
  validateModel(model);
  for (let index = 0; index < model.sources.length; index += 1) {
    const source = model.sources[index];
    try {
      await stat(join(root, source));
    } catch {
      modelError(`$.sources[${index}]`, `source does not exist: ${source}`);
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
