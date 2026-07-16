import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../apps/platform-administration/", import.meta.url);

test("platform product administration renders the canonical contract API without product fixtures", async () => {
  const [html, js] = await Promise.all([readFile(new URL("index.html", root), "utf8"), readFile(new URL("platform-administration.js", root), "utf8")]);
  assert.match(html, /Product template administration/);
  assert.match(js, /\/platform\/product-templates/);
  assert.match(js, /workspace\.contracts/);
  assert.match(js, /publication/);
  assert.match(js, /approvalRef/);
  assert.match(js, /cache:"no-store"/);
  assert.doesNotMatch(js, /innerHTML|localStorage|sessionStorage|indexedDB/);
});
