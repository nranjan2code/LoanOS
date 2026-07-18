import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { inputControlType, readWorkspaceInputValue, restoreWorkspaceInputValue } from "../apps/journey-workspace/workspace-inputs.js";

const root = new URL("../apps/journey-workspace/", import.meta.url);

test("dynamic journey workspace is accessible, multilingual and renders schema without unsafe HTML", async () => {
  const [html, js, css] = await Promise.all([readFile(new URL("index.html", root), "utf8"), readFile(new URL("workspace.js", root), "utf8"), readFile(new URL("workspace.css", root), "utf8")]);
  assert.match(html, /<a class="skip-link" href="#main">/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /हिन्दी/);
  assert.match(html, /<noscript>/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(js, /textContent/);
  assert.ok(js.indexOf("ui.workspace.hidden = false") < js.indexOf("ui.workspace_title.focus()"), "the heading must become visible before focus moves to it");
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|document\.write/);
});

test("workspace prohibits browser persistence and business-data caching", async () => {
  const [html, js] = await Promise.all([readFile(new URL("index.html", root), "utf8"), readFile(new URL("workspace.js", root), "utf8")]);
  assert.match(html, /No browser PII storage/);
  assert.match(js, /cache:"no-store"/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|serviceWorker/);
});

test("workspace derives brand identity, resumes server drafts and never invents authorised actions", async () => {
  const [html, js] = await Promise.all([readFile(new URL("index.html", root), "utf8"), readFile(new URL("workspace.js", root), "utf8")]);
  assert.doesNotMatch(html, /LoanOS/);
  assert.match(js, /\/brand-experience/);
  assert.match(js, /applyTheme/);
  assert.match(js, /\/drafts/);
  assert.match(js, /draft\?\.draftId/);
  assert.match(js, /actions\.filter/);
  assert.doesNotMatch(html, /id="save-draft"|Submit application<\/button>/);
  assert.match(html, /Case and lifecycle/);
  assert.match(js, /Check connection/);
});

test("workspace browser controls preserve schema value types and fail closed on malformed numeric input", () => {
  assert.equal(inputControlType("boolean"), "checkbox");
  assert.equal(inputControlType("date"), "date");
  assert.equal(inputControlType("money_string"), "text");

  assert.equal(readWorkspaceInputValue({ dataset: { type: "boolean" }, checked: true, value: "on" }), true);
  assert.equal(readWorkspaceInputValue({ dataset: { type: "boolean" }, checked: false, value: "on" }), false);
  assert.equal(readWorkspaceInputValue({ dataset: { type: "integer" }, value: "7" }), 7);
  assert.equal(readWorkspaceInputValue({ dataset: { type: "integer" }, value: "7.5" }), undefined);
  assert.equal(readWorkspaceInputValue({ dataset: { type: "money_string" }, value: "100000" }), "100000");
  assert.equal(readWorkspaceInputValue({ dataset: { type: "money_string" }, value: "1.00" }), undefined);
  assert.equal(readWorkspaceInputValue({ dataset: { type: "decimal_string" }, value: "1.25" }), "1.25");
  assert.equal(readWorkspaceInputValue({ dataset: { type: "decimal_string" }, value: "1e3" }), undefined);

  const checkbox = { dataset: { type: "boolean" }, checked: false, value: "" };
  restoreWorkspaceInputValue(checkbox, true);
  assert.equal(checkbox.checked, true);
});
