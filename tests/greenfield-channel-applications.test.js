import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apps = ["customer-application", "partner-application", "banker-application"];

async function source(app) {
  const root = new URL(`../apps/${app}/`, import.meta.url);
  return Promise.all([readFile(new URL("index.html", root), "utf8"), readFile(new URL("application.js", root), "utf8"), readFile(new URL("application.css", root), "utf8")]);
}

for (const app of apps) test(`${app} is accessible, safely rendered and server-backed`, async () => {
  const [html, js, css] = await source(app);
  assert.match(html, /class="skip-link" href="#main"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<noscript>/);
  assert.match(js, /\/brand-experience/);
  assert.match(js, /\/journey-workspaces\//);
  assert.match(js, /credentials:\s*"same-origin"/);
  assert.match(js, /cache:\s*"no-store"/);
  assert.match(js, /textContent/);
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|serviceWorker/);
  assert.doesNotMatch(html + js, /LoanOS|personal_expenses|\bNACH\b|dummy data|fake status/i);
  assert.match(css, /prefers-reduced-motion/);
});

test("customer application presents catalogue, drafts, status, consent and evidence guidance", async () => {
  const [html, js] = await source("customer-application");
  assert.match(js, /journey-workspaces\/borrower\/catalogue/);
  assert.match(js, /journey-workspaces\/borrower\/drafts/);
  assert.match(html, /Consent/);
  assert.match(html, /Evidence/);
  assert.match(html, /does not retain application data in browser storage/);
});

test("partner application relies on authenticated server attribution", async () => {
  const [html, js] = await source("partner-application");
  assert.match(js, /journey-workspaces\/partner\/catalogue/);
  assert.match(js, /journey-workspaces\/partner\/drafts/);
  assert.match(html, /recorded under your signed-in account and authorised partner scope/);
  assert.doesNotMatch(html, /name="(?:partner|principal|actor)/i);
});

test("banker application separates branch, credit, operations and control with administration navigation", async () => {
  const [html, js] = await source("banker-application");
  for (const channel of ["branch", "credit", "operations", "control"]) assert.match(js, new RegExp(`"${channel}"`));
  assert.match(html, /id="administration-link"/);
  assert.match(js, /staff\/administration/);
  assert.match(js, /item\.actions/);
});
