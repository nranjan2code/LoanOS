import assert from "node:assert/strict";
import { readdir, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLoanOsServer } from "../apps/api/src/server.js";

test("every product journey is publicly served without tenant authentication", async (t) => {
  const journeyRoot = join(process.cwd(), "apps", "web", "loan-types");
  const entries = await readdir(journeyRoot, { withFileTypes: true });
  const journeySlugs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.equal(journeySlugs.length, 21, "the public product library should contain 21 journey pages");

  const dataDir = await mkdtemp(join(tmpdir(), "loanos-public-web-"));
  const server = createLoanOsServer({ dataDir });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve());
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  for (const slug of journeySlugs) {
    const response = await fetch(`${base}/loan-types/${slug}/`);
    assert.equal(response.status, 200, `${slug} should be public`);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    assert.doesNotMatch(await response.text(), /tenant_auth_required/);
  }
});

test("public discovery files are crawlable without tenant authentication", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-public-discovery-"));
  const server = createLoanOsServer({ dataDir });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve());
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path, contentType] of [
    ["/robots.txt", /^text\/plain/],
    ["/sitemap.xml", /^application\/xml/],
    ["/llms.txt", /^text\/plain/]
  ]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, `${path} should be public`);
    assert.match(response.headers.get("content-type") ?? "", contentType);
    assert.doesNotMatch(await response.text(), /tenant_auth_required/);
  }
});
