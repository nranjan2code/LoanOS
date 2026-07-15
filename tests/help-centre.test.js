import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("help centre exposes role guidance, learning paths and governed status labels", async () => {
  const [html, js] = await Promise.all([
    readFile(new URL("../apps/help/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/help/help.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /Guide & Academy/);
  assert.match(html, /My learning/);
  assert.match(html, /aria-label="Help centre"/);
  assert.match(js, /Tenant owner/);
  assert.match(js, /Controlled first slice/);
  assert.match(js, /Content scope: LoanOS canonical/);
  assert.match(js, /first-compliant-loan/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB/);
});

test("platform surfaces link users to the canonical guide", async () => {
  const [dashboard, tenant, publicNavigation, resources, server] = await Promise.all([
    readFile(new URL("../apps/dashboard/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/tenant/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/web/assets/site.js", import.meta.url), "utf8"),
    readFile(new URL("../apps/web/resources/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8")
  ]);
  for (const surface of [dashboard, tenant, publicNavigation, resources]) assert.match(surface, /\/help\//);
  assert.match(server, /appsRoot, "help"/);
});
