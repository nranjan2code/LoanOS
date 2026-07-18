import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startJourneyBrowserConformanceHarness } from "../scripts/run-jd05-browser-conformance.mjs";

test("JD-05 browser harness is loopback, disposable, fail-closed and cannot record a production claim", async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), "loanos-jd05-browser-test-"));
  const harness = await startJourneyBrowserConformanceHarness({ outputPath:join(outputDir, "evidence.json") });
  t.after(async () => { await harness.close(); await rm(outputDir, { recursive:true, force:true }); });

  assert.match(harness.url, /^http:\/\/127\.0\.0\.1:\d+\/__jd05\/$/);
  let response = await fetch(harness.url);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Synthetic, local and non-production/);
  assert.doesNotMatch(html, /password|debugCode|borrower@/);

  response = await fetch(new URL("/__jd05/config", harness.url));
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.equal(config.journeyCount, 21);
  assert.equal(config.loginPath, "/auth/borrower-connect");
  assert.ok(config.login.code);

  response = await fetch(new URL("/journey-workspaces/borrower/catalogue", harness.url));
  assert.equal(response.status, 401, "the proxy must not bypass interactive authentication");
  await response.text();

  response = await fetch(new URL("/__jd05/report", harness.url), { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ evidenceType:"interactive_browser", executionMode:"non_production", productionReady:true, commerciallyLive:false, tenantData:"synthetic_only", journeyCount:21, allPassed:true, steps:[] }) });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "jd05_browser_evidence_invalid");
});
