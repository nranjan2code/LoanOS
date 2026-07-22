import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildSvg, loadModel, run } from "../scripts/build-architecture-diagram.mjs";

test("architecture diagram is accessible, source-backed and current", async () => {
  const model = await loadModel();
  const svg = buildSvg(model);

  assert.match(svg, /<title id="diagram-title">LoanOS India — System Architecture<\/title>/);
  assert.match(svg, /<desc id="diagram-desc">/);
  assert.equal((svg.match(/class="band band-/g) ?? []).length, model.bands.length);
  assert.equal((svg.match(/class="band-flow"/g) ?? []).length, model.bands.length - 1);
  assert.equal((svg.match(/class="principle"/g) ?? []).length, model.principles.length);
  assert.doesNotMatch(svg, /(?:href|src)="https?:/);

  const rightLane = svg.match(/<g class="side-lane side-right">([\s\S]+?)<\/g>\s*<g class="principles">/)?.[1] ?? '';
  const firstGroup = rightLane.match(/<text x="([\d.]+)" y="([\d.]+)" class="lane-group">Identity &amp; trust<\/text>/);
  const firstItem = rightLane.match(/<text x="([\d.]+)" y="([\d.]+)">IdP · OIDC · SAML · SCIM<\/text>/);
  const firstGroupX = Number(firstGroup?.[1]);
  const firstGroupY = Number(firstGroup?.[2]);
  const firstItemX = Number(firstItem?.[1]);
  const firstItemY = Number(firstItem?.[2]);
  const finalItemY = Number(rightLane.match(/<text x="[\d.]+" y="([\d.]+)">Support · paging · telemetry<\/text>/)?.[1]);
  const connectorY = Number(rightLane.match(/class="lane-arrow" d="M [\d.]+ ([\d.]+) H/)?.[1]);
  assert.equal(firstGroupX, firstItemX, 'lane subheaders and bullet text must share one alignment column');
  assert.ok(firstItemY - firstGroupY <= 30, 'lane group headings must stay visually attached to their first item');
  assert.ok(connectorY - finalItemY >= 48, 'lane connector must not appear attached to the final external-system item');

  const outputPath = await run({ check: true });
  assert.equal(await readFile(outputPath, "utf8"), svg);
});
