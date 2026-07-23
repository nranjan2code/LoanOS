import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildSvg, loadModel, run, validateModel } from "../scripts/build-architecture-diagram.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("architecture diagram is accessible, source-backed and current", async () => {
  const model = await loadModel();
  const svg = buildSvg(model);

  assert.match(svg, /<title id="diagram-title">LoanOS India — System Architecture<\/title>/);
  assert.match(svg, /<desc id="diagram-desc">/);
  assert.equal((svg.match(/class="band band-/g) ?? []).length, model.bands.length);
  assert.equal((svg.match(/class="relationship relationship-/g) ?? []).length, model.relationships.length);
  assert.equal((svg.match(/class="relationship-key"/g) ?? []).length, new Set(model.relationships.map(({ type }) => type)).size);
  assert.equal((svg.match(/class="principle"/g) ?? []).length, model.principles.length);
  assert.doesNotMatch(svg, /(?:href|src)="https?:/);
  assert.match(svg, /\.side-lane > \.lane-heading \{ fill: #173f36; \}/);
  for (const relationship of model.relationships) {
    assert.match(svg, new RegExp(`<title>${relationship.label.replaceAll('&', '&amp;')}</title>`));
  }

  const rightLane = svg.match(/<g class="side-lane side-right">([\s\S]+?)<\/g>\s*<g class="principles">/)?.[1] ?? '';
  const firstGroup = rightLane.match(/<text x="([\d.]+)" y="([\d.]+)" class="lane-group">Identity &amp; trust<\/text>/);
  const firstItem = rightLane.match(/<text x="([\d.]+)" y="([\d.]+)">IdP · OIDC · SAML · SCIM<\/text>/);
  const firstGroupX = Number(firstGroup?.[1]);
  const firstGroupY = Number(firstGroup?.[2]);
  const firstItemX = Number(firstItem?.[1]);
  const firstItemY = Number(firstItem?.[2]);
  const finalItemY = Number(rightLane.match(/<text x="[\d.]+" y="([\d.]+)">Support · paging · telemetry<\/text>/)?.[1]);
  const connectorY = Number(svg.match(/class="relationship relationship-integration"[\s\S]+?<path d="M [\d.]+ ([\d.]+) H/)?.[1]);
  assert.equal(firstGroupX, firstItemX, 'lane subheaders and bullet text must share one alignment column');
  assert.ok(firstItemY - firstGroupY <= 30, 'lane group headings must stay visually attached to their first item');
  assert.ok(connectorY - finalItemY >= 48, 'lane connector must not appear attached to the final external-system item');

  const outputPath = await run({ check: true });
  assert.equal(await readFile(outputPath, "utf8"), svg);
  assert.equal(buildSvg(model), svg, 'architecture generation must be byte deterministic');
});

test("architecture model validation reports exact adverse paths", async () => {
  const model = await loadModel();

  const unsupportedSchema = clone(model);
  unsupportedSchema.schemaVersion = 99;
  assert.throws(
    () => validateModel(unsupportedSchema),
    /\$\.schemaVersion: expected 2, received 99/
  );

  const unknownEndpoint = clone(model);
  unknownEndpoint.relationships[0].to = "band:999";
  assert.throws(
    () => validateModel(unknownEndpoint),
    /\$\.relationships\[0\]\.to: unknown endpoint "band:999"/
  );

  const duplicateBand = clone(model);
  duplicateBand.bands[1].number = duplicateBand.bands[0].number;
  assert.throws(
    () => validateModel(duplicateBand),
    /\$\.bands\[1\]\.number: duplicate band number/
  );

  const emptyLaneItems = clone(model);
  emptyLaneItems.leftLane.groups[0].items = [];
  assert.throws(
    () => validateModel(emptyLaneItems),
    /\$\.leftLane\.groups\[0\]\.items: expected a non-empty array/
  );
});

test("architecture layout wraps long card content and grows instead of clipping", async () => {
  const model = await loadModel();
  const baseline = buildSvg(model);
  const expanded = clone(model);
  expanded.bands[0].items[0].label = "Borrower and assisted customer application experience";
  expanded.bands[0].items[0].detail = "Applications, servicing, accessibility support and governed customer communications";
  expanded.bands[0].items.push({
    label: "Embedded partner acquisition and servicing experience",
    detail: "Tenant-scoped journeys with evidence-preserving handoffs",
    ref: "apps/partner"
  });

  const svg = buildSvg(expanded);
  const baselineHeight = Number(baseline.match(/viewBox="0 0 1600 ([\d.]+)"/)?.[1]);
  const expandedHeight = Number(svg.match(/viewBox="0 0 1600 ([\d.]+)"/)?.[1]);

  assert.ok(expandedHeight > baselineHeight, "wrapped and additional content must grow the canvas");
  assert.match(svg, /<tspan[^>]*>Borrower and assisted<\/tspan>/);
  assert.match(svg, /<tspan[^>]*>customer application<\/tspan>/);
  assert.match(svg, /<tspan[^>]*>experience<\/tspan>/);
  assert.doesNotMatch(svg, /undefined|NaN/);
});

test("architecture layout grows for long side lanes", async () => {
  const model = await loadModel();
  const baseline = buildSvg(model);
  const expanded = clone(model);
  expanded.rightLane.groups.push({
    label: "Additional certified systems",
    items: Array.from({ length: 30 }, (_, index) => `External system ${index + 1}`)
  });

  const svg = buildSvg(expanded);
  const baselineHeight = Number(baseline.match(/viewBox="0 0 1600 ([\d.]+)"/)?.[1]);
  const expandedHeight = Number(svg.match(/viewBox="0 0 1600 ([\d.]+)"/)?.[1]);
  const laneHeight = Number(svg.match(/class="side-lane side-right">\s*<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)"/)?.[1]);

  assert.ok(expandedHeight > baselineHeight, "additional lane content must grow the canvas");
  assert.ok(laneHeight > 1_000, "the lane frame must contain all added items");
  assert.doesNotMatch(svg, /undefined|NaN/);
});
