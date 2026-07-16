import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../apps/administration/", import.meta.url);

test("tenant administration app renders all products from governed APIs without embedded fixtures", async () => {
  const [html, js] = await Promise.all([readFile(new URL("index.html", root), "utf8"), readFile(new URL("administration.js", root), "utf8")]);
  assert.match(html, /All 21 journeys/);
  assert.match(js, /\/admin\/product-platform/);
  assert.match(js, /\/admin\/brand-governance/);
  assert.match(js, /workspace\.contracts/);
  assert.doesNotMatch(js, /personal_loan.*msme_term_loan.*gold_loan/);
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|document\.write/);
});

test("administration app exposes structured readiness, staffing, branding and maker-checker controls", async () => {
  const [html, js] = await Promise.all([readFile(new URL("index.html", root), "utf8"), readFile(new URL("administration.js", root), "utf8")]);
  for (const label of ["Governed product bindings", "Staffing grant", "White-label binding", "Release evidence", "Pending approvals"]) assert.match(html, new RegExp(label));
  assert.match(js, /\$\{target\}-proposal/);
  assert.match(js, /approvalRef/);
  assert.match(js, /readinessEvidence/);
  assert.match(js, /cache:"no-store"/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB/);
});
