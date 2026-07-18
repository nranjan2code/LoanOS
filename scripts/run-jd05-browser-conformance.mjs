import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PRODUCT_JOURNEY_TYPES } from "@loanos/core";
import { loadState, saveState } from "../apps/api/src/file-store.js";
import { createLoanOsServer } from "../apps/api/src/server.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TENANT = Object.freeze({ tenantId:"jd05_browser_local", name:"JD-05 Synthetic Bank", apiKey:"jd05-browser-local-key" });
const BORROWER = Object.freeze({ borrowerId:"jd05-browser-borrower", email:"borrower@jd05-browser.local" });
const REQUIRED_STEPS = Object.freeze(["unauthenticated_restriction", "authenticated_session", "no_cache_contract", "canonical_21_interaction", "required_fact_denial", "malformed_numeric_denial", "server_draft_happy_path", "draft_resume_recovery", "typed_submit_happy_path", "service_failure_visible", "service_recovery", "accessibility_and_language"]);

export async function startJourneyBrowserConformanceHarness({ port = 0, outputPath = join(tmpdir(), "loanos-jd05-browser-evidence.json") } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-jd05-browser-"));
  const app = createLoanOsServer({ dataDir, bootstrapTenants:[TENANT] });
  await listen(app, 0);
  const upstream = `http://127.0.0.1:${app.address().port}`;
  await seed(upstream, dataDir);
  let failDraftReads = false;
  const harnessHtml = await readFile(join(ROOT, "tests/browser/jd05-interactive-harness.html"));
  const harnessJs = await readFile(join(ROOT, "tests/browser/jd05-interactive-harness.js"));
  const evidencePath = resolve(outputPath);

  const proxy = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && ["/__jd05", "/__jd05/"].includes(url.pathname)) return send(res, 200, "text/html; charset=utf-8", harnessHtml);
      if (req.method === "GET" && url.pathname === "/__jd05/harness.js") return send(res, 200, "text/javascript; charset=utf-8", harnessJs);
      if (req.method === "GET" && url.pathname === "/__jd05/config") {
        const challengeResponse = await fetch(`${upstream}/auth/borrower-challenge`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ tenantId:TENANT.tenantId, borrowerId:BORROWER.borrowerId, email:BORROWER.email }) });
        const challenge = await challengeResponse.json();
        if (!challengeResponse.ok || !challenge.debugCode) return json(res, 503, { error:{ code:"jd05_browser_challenge_unavailable", message:"Synthetic borrower challenge unavailable." } });
        return json(res, 200, { tenantId:TENANT.tenantId, journeyCount:PRODUCT_JOURNEY_TYPES.length, loginPath:"/auth/borrower-connect", login:{ tenantId:TENANT.tenantId, borrowerId:BORROWER.borrowerId, email:BORROWER.email, code:challenge.debugCode } });
      }
      if (req.method === "POST" && url.pathname === "/__jd05/control") { const body = await readJson(req); failDraftReads = body.failDraftReads === true; return json(res, 200, { failDraftReads }); }
      if (req.method === "POST" && url.pathname === "/__jd05/report") {
        const report = await readJson(req);
        const errors = validateReport(report);
        if (errors.length) return json(res, 422, { error:{ code:"jd05_browser_evidence_invalid", message:errors.join(" ") } });
        const evidence = { ...report, recordedAt:new Date().toISOString() };
        evidence.evidenceChecksumSha256 = checksum(evidence);
        await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode:0o600 });
        return json(res, 201, { evidencePath, evidenceChecksumSha256:evidence.evidenceChecksumSha256 });
      }
      if (failDraftReads && req.method === "GET" && url.pathname === "/journey-workspaces/borrower/drafts") return json(res, 503, { error:{ code:"jd05_injected_draft_service_unavailable", message:"Injected synthetic outage; draft reads fail closed." } });
      forward(req, res, upstream);
    } catch (error) {
      json(res, 500, { error:{ code:"jd05_browser_harness_failed", message:error.message } });
    }
  });
  await listen(proxy, port);
  const url = `http://127.0.0.1:${proxy.address().port}/__jd05/`;
  return { url, evidencePath, tenantId:TENANT.tenantId, borrowerId:BORROWER.borrowerId, async close() { await Promise.all([close(proxy), close(app)]); await rm(dataDir, { recursive:true, force:true }); } };
}

function validateReport(report) {
  const errors = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) return ["A browser report object is required."];
  if (report.evidenceType !== "interactive_browser" || report.executionMode !== "non_production") errors.push("Evidence must be interactive_browser/non_production.");
  if (report.productionReady !== false || report.commerciallyLive !== false) errors.push("Browser evidence cannot make a live or production-ready claim.");
  if (report.tenantData !== "synthetic_only" || report.journeyCount !== PRODUCT_JOURNEY_TYPES.length) errors.push("Evidence must cover all 21 journeys with synthetic data.");
  if (report.allPassed !== true) errors.push("Only a completed browser run can be recorded as passing evidence.");
  const passed = new Set((report.steps ?? []).filter((item) => item?.outcome === "passed").map((item) => item.stepId));
  for (const step of REQUIRED_STEPS) if (!passed.has(step)) errors.push(`Missing passing step ${step}.`);
  return errors;
}

async function seed(base, dataDir) {
  const response = await fetch(`${base}/borrowers`, { method:"POST", headers:{"content-type":"application/json", "x-api-key":TENANT.apiKey}, body:JSON.stringify({ borrowerId:BORROWER.borrowerId, borrowerType:"individual", status:"active", fullName:"JD05 Synthetic Borrower", dateOfBirth:"1990-01-01", residencyCountry:"IN", primaryAddressCountry:"IN", primaryAddress:"Synthetic address", contact:{ mobile:"+919999999999", email:BORROWER.email }, economicProfile:{ occupation:"salaried", monthlyIncome:75000, employerName:"Synthetic Employer", incomeEvidenceRef:"synthetic://income" } }) });
  if (response.status !== 201) throw new Error(`Unable to seed browser borrower (${response.status}): ${await response.text()}`);
  await response.text();
  const state = await loadState(dataDir);
  state.tenants[TENANT.tenantId].tenantProductSubscriptions = { "jd05-browser-all":{ subscriptionId:"jd05-browser-all", tenantId:TENANT.tenantId, productTypes:[...PRODUCT_JOURNEY_TYPES], effectiveFrom:"2026-01-01T00:00:00.000Z", validUntil:"2030-01-01T00:00:00.000Z", status:"active" } };
  await saveState(state, dataDir);
}

function forward(req, res, upstream) { const target = new URL(req.url, upstream); const outgoing = http.request({ hostname:target.hostname, port:target.port, path:`${target.pathname}${target.search}`, method:req.method, headers:{...req.headers, host:target.host} }, (incoming) => { const headers = {...incoming.headers}; delete headers["x-frame-options"]; delete headers["content-security-policy"]; headers["cache-control"] = "no-store"; res.writeHead(incoming.statusCode, headers); incoming.pipe(res); }); outgoing.on("error", (error) => json(res, 502, { error:{ code:"jd05_upstream_unavailable", message:error.message } })); req.pipe(outgoing); }
function send(res, status, contentType, body) { res.writeHead(status, { "content-type":contentType, "cache-control":"no-store" }); res.end(body); }
function json(res, status, body) { send(res, status, "application/json; charset=utf-8", JSON.stringify(body)); }
async function readJson(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
function checksum(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function listen(server, port) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); }); }); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const portArg = process.argv.find((item) => item.startsWith("--port="));
  const outputArg = process.argv.find((item) => item.startsWith("--output="));
  const harness = await startJourneyBrowserConformanceHarness({ port:portArg ? Number(portArg.slice(7)) : 0, outputPath:outputArg?.slice(9) });
  console.log(`JD-05 synthetic browser harness: ${harness.url}`);
  console.log(`Evidence will be written to: ${harness.evidencePath}`);
  console.log("The page self-runs adverse, canonical-21, happy and recovery interactions. Press Ctrl-C after reviewing the result.");
  const shutdown = async () => { await harness.close(); process.exit(0); };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
}
