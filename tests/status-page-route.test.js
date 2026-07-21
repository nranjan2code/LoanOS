import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLoanOsServer } from "../apps/api/src/server.js";

test("canonical build status serves only generated dashboard artifacts and is linked from portals", async (t) => {
  const portalSources = await Promise.all([
    readFile(new URL("../apps/tenant/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/customer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/customer/assets/portal.js", import.meta.url), "utf8"),
    readFile(new URL("../apps/dashboard/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/dashboard/workspaces.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/partner/index.html", import.meta.url), "utf8")
  ]);
  for (const source of portalSources) {
    assert.match(source, /href=["'`]\/status\//, "each portal surface should link to the canonical build status");
  }
  for (const html of [portalSources[0], portalSources[1], portalSources[3], portalSources[4], portalSources[5]]) {
    assert.match(html, /<footer[\s\S]*href=["']\/status\//, "each rendered portal should repeat build status in its footer");
  }

  const dataDir = await mkdtemp(join(tmpdir(), "loanos-status-page-"));
  const server = createLoanOsServer({ dataDir });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of ["/status", "/status/", "/status/dashboard.html"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    const html = await response.text();
    assert.match(html, /Capability &amp; Build Dashboard/);
    assert.match(html, /not a claim of regulatory certification or production approval/i);
  }

  const dataResponse = await fetch(`${base}/status/dashboard-data.json`);
  assert.equal(dataResponse.status, 200);
  assert.match(dataResponse.headers.get("content-type") ?? "", /^application\/json/);
  const snapshot = await dataResponse.json();
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.overall.total, 464);

  const blocked = await fetch(`${base}/status/README.md`);
  assert.equal(blocked.status, 404, "the status mount must not expose the documentation tree");
});
