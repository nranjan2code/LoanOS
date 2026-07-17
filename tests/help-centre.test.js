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
  const institutionalSurfaces = [
    "../apps/dashboard/index.html",
    "../apps/dashboard/workspaces.html",
    "../apps/tenant/index.html",
    "../apps/administration/index.html",
    "../apps/banker-application/index.html",
    "../apps/platform-administration/index.html",
    "../apps/web/assets/site.js",
    "../apps/web/resources/index.html"
  ];
  for (const surface of institutionalSurfaces) {
    assert.match(await readFile(new URL(surface, import.meta.url), "utf8"), /\/help\//, `${surface} links to the guide`);
  }
  const server = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
  assert.match(server, /appsRoot, "help", "\/help\/index\.html"/, "the /help entry route resolves the real index file");
  assert.match(server, /fileSubpath \+= "index\.html"/, "directory URLs resolve to their index page");
});

test("borrower and channel surfaces do not import institutional guidance", async () => {
  for (const surface of ["../apps/customer/index.html", "../apps/customer-application/index.html", "../apps/partner/index.html", "../apps/partner-application/index.html"]) {
    const html = await readFile(new URL(surface, import.meta.url), "utf8");
    assert.doesNotMatch(html, /\/help\//, `${surface} stays inside the customer-channel guidance boundary`);
  }
});
