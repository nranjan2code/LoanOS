import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("operating surfaces use the shared bank shell without demo navigation", async () => {
  const operatingSurfaces = await Promise.all([
    read("../apps/tenant/index.html"),
    read("../apps/customer/index.html"),
    read("../apps/customer/assets/portal.js"),
    read("../apps/dashboard/index.html"),
    read("../apps/dashboard/workspaces.html"),
    read("../apps/partner/index.html")
  ]);
  for (const source of operatingSurfaces) {
    assert.doesNotMatch(source, /href=["'`]\/status\//, "repository build evidence stays outside bank navigation");
    assert.doesNotMatch(source, /Repository-backed operating view/i);
  }

  const dashboardHtml = operatingSurfaces[3];
  const dashboardJs = await read("../apps/dashboard/index.js");
  const dashboardCss = await read("../apps/dashboard/index.css");
  assert.match(dashboardHtml, /\/shared\/design-tokens\.css/);
  assert.doesNotMatch(dashboardHtml, />Acting User</);
  assert.doesNotMatch(dashboardHtml, />Simulation Date</);
  assert.doesNotMatch(dashboardJs, /Switched to/);
  assert.doesNotMatch(dashboardCss, /--font-sans:\s*['"]Inter/);
  assert.match(dashboardCss, /dialog:not\(\[open\]\)/, "closed administration dialogs must not become page content");
});

test("application and administration hubs share consistent headers, containers and footers", async () => {
  const shells = [
    "../apps/customer-application/index.html",
    "../apps/banker-application/index.html",
    "../apps/partner-application/index.html",
    "../apps/administration/index.html",
    "../apps/journey-workspace/index.html",
    "../apps/platform-administration/index.html"
  ];
  for (const path of shells) {
    const html = await read(path);
    assert.match(html, /\/shared\/design-tokens\.css/, `${path} consumes canonical tokens`);
    assert.match(html, /\/shared\/application-shell\.css/, `${path} consumes the shared application shell`);
    assert.match(html, /<footer class="app-footer">/, `${path} has a consistent operating footer`);
  }
});

test("channel application hubs request branding from the authenticated API boundary", async () => {
  for (const path of [
    "../apps/customer-application/application.js",
    "../apps/banker-application/application.js",
    "../apps/partner-application/application.js"
  ]) {
    const js = await read(path);
    assert.match(js, /["'`]\/brand-experience\?/, `${path} uses the canonical brand-experience API`);
    assert.doesNotMatch(js, /\$\{tenantBase\}\/brand-experience/, `${path} must not request the nonexistent tenant static path`);
    assert.match(js, /\$\{tenantBase\}\/branding/, `${path} falls back to the tenant's registered legal identity`);
  }
});
