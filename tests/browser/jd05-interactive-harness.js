const status = document.querySelector("#status");
const output = document.querySelector("#result");
const frame = document.querySelector("#workspace-frame");
const steps = [];

void run().catch(async (error) => {
  const report = evidence(false, error.message);
  status.textContent = `Blocked: ${error.message}`;
  output.textContent = JSON.stringify(report, null, 2);
  await submit(report).catch(() => {});
});

async function run() {
  const config = await json("/__jd05/config");
  const workspaceUrl = `/t/${encodeURIComponent(config.tenantId)}/portal/journeys/`;

  await loadFrame(workspaceUrl);
  await waitFor(() => /valid (?:login session|tenant API key)|required for this route/i.test(workspace().querySelector("#status")?.textContent ?? ""));
  pass("unauthenticated_restriction", "Workspace data stays unavailable without an interactive session.");

  const login = await fetch(config.loginPath, { method:"POST", credentials:"same-origin", cache:"no-store", headers:{"content-type":"application/json"}, body:JSON.stringify(config.login) });
  if (!login.ok) throw new Error(`Synthetic login failed (${login.status}).`);
  await login.json();
  pass("authenticated_session", "Disposable MFA-backed human session established.");

  await loadFrame(workspaceUrl);
  await waitFor(() => workspace().querySelectorAll(".journey-card").length === config.journeyCount);
  const catalogueResponse = await fetch("/journey-workspaces/borrower/catalogue", { credentials:"same-origin", cache:"no-store" });
  if (!catalogueResponse.ok) throw new Error("Authenticated catalogue was unavailable.");
  assert(/no-store/i.test(catalogueResponse.headers.get("cache-control") ?? ""), "Catalogue response must prohibit caching.");
  pass("no_cache_contract", "Authenticated business projection returns Cache-Control: no-store.");

  const names = [];
  for (let index = 0; index < config.journeyCount; index += 1) {
    const doc = workspace();
    const card = doc.querySelectorAll(".journey-card")[index];
    const expected = card.querySelector("h2").textContent;
    card.querySelector("button").click();
    await waitFor(() => !workspace().querySelector("#workspace").hidden && workspace().querySelector("#workspace-title").textContent === expected);
    assert(workspace().activeElement === workspace().querySelector("#workspace-title"), `${expected} did not receive focus.`);
    assert(/schema v\d+/.test(workspace().querySelector("#schema-meta").textContent), `${expected} omitted schema lineage.`);
    names.push(expected);
    workspace().querySelector("#close-workspace").click();
    await waitFor(() => workspace().querySelector("#workspace").hidden);
  }
  assert(new Set(names).size === config.journeyCount, "Canonical journey interaction did not cover 21 distinct journeys.");
  pass("canonical_21_interaction", "Opened, focused and returned from every canonical journey card.");

  openCard("Personal Loan");
  await waitFor(() => !workspace().querySelector("#workspace").hidden);
  const submitButton = workspace().querySelector('[data-action-id="submit_application"]');
  const saveButton = workspace().querySelector('[data-action-id="save_draft"]');
  assert(submitButton && saveButton, "Borrower capture actions were not projected.");
  submitButton.click();
  await delay(100);
  assert(workspace().querySelector("#journey-form :invalid"), "Missing required facts did not stop submit.");
  assert(!workspace().querySelector("#form-status").textContent.includes("submitted"), "Invalid form was submitted.");
  pass("required_fact_denial", "Required-field omission was blocked before any mutation.");

  const numeric = workspace().querySelector('[data-type="money_string"],[data-type="integer"],[data-type="decimal_string"]');
  assert(numeric, "Representative numeric fact was absent.");
  numeric.value = "not-a-number";
  saveButton.click();
  await waitFor(() => workspace().querySelector("#form-status").textContent.includes("invalid value"));
  pass("malformed_numeric_denial", "Malformed exact numeric input was rejected in the interactive surface.");

  numeric.value = "";
  saveButton.click();
  await waitFor(() => workspace().querySelector("#form-status").textContent.includes("Draft saved server-side"));
  pass("server_draft_happy_path", "Browser action persisted a synthetic, actor-bound server draft.");

  workspace().querySelector("#close-workspace").click();
  await waitFor(() => [...workspace().querySelectorAll(".draft-row button")].some((button) => button.textContent === "Resume"));
  [...workspace().querySelectorAll(".draft-row button")].find((button) => button.textContent === "Resume").click();
  await waitFor(() => workspace().querySelector("#form-status").textContent.includes("Resumed from the server"));
  pass("draft_resume_recovery", "Returned through the UI and resumed the server-held draft.");

  for (const input of workspace().querySelectorAll("#journey-form [data-type]")) fill(input);
  workspace().querySelector('[data-action-id="submit_application"]').click();
  await waitFor(() => workspace().querySelector("#form-status").textContent.includes("submitted with immutable schema lineage"));
  pass("typed_submit_happy_path", "Typed boolean, integer, decimal, money, date and reference facts submitted through the browser.");

  workspace().querySelector("#close-workspace").click();
  await control(true);
  workspace().querySelector("#refresh-drafts").click();
  await waitFor(() => workspace().querySelector("#draft-list .error"));
  pass("service_failure_visible", "Injected draft-service failure remained restrictive and visible.");
  await control(false);
  workspace().querySelector("#refresh-drafts").click();
  await waitFor(() => workspace().querySelectorAll(".draft-row").length > 0);
  pass("service_recovery", "Refresh recovered server state without browser persistence or optimistic reconstruction.");

  const language = workspace().querySelector("#language");
  language.value = "hi";
  language.dispatchEvent(new Event("change", { bubbles:true }));
  assert(workspace().documentElement.lang === "hi", "Hindi language state was not applied.");
  assert(workspace().querySelector(".skip-link") && workspace().querySelectorAll('[aria-live="polite"]').length >= 2, "Accessibility landmarks were absent.");
  pass("accessibility_and_language", "Keyboard focus, live status, skip navigation and Hindi projection remained available.");

  const report = evidence(true);
  const receipt = await submit(report);
  status.textContent = `Passed ${steps.length} non-production browser checks. Evidence: ${receipt.evidencePath}`;
  output.textContent = JSON.stringify({ ...report, evidenceReceipt: receipt }, null, 2);
}

function workspace() { return frame.contentDocument; }
function openCard(name) { const card = [...workspace().querySelectorAll(".journey-card")].find((item) => item.querySelector("h2")?.textContent === name); assert(card, `${name} card missing.`); card.querySelector("button").click(); }
function fill(input) { if (input.type === "checkbox") input.checked = true; else if (input.dataset.type === "integer") input.value = "1"; else if (input.dataset.type === "date") input.value = "2026-07-18"; else if (input.dataset.type === "money_string") input.value = "100000"; else if (input.dataset.type === "decimal_string") input.value = "1.25"; else input.value = "JD05-SYNTHETIC"; input.dispatchEvent(new Event("input", { bubbles:true })); }
function pass(stepId, observation) { steps.push({ stepId, outcome:"passed", observation }); status.textContent = `Passed ${steps.length}: ${observation}`; }
function evidence(allPassed, blocker = null) { return { evidenceType:"interactive_browser", executionMode:"non_production", commerciallyLive:false, productionReady:false, tenantData:"synthetic_only", journeyCount:21, allPassed, blocker, steps, residualLimitations:["No selected-environment PostgreSQL/RLS execution", "No certified live provider or deployment interaction", "No mobile device or assistive-technology certification", "No performance, visual-regression or production-operating-effectiveness evidence"] }; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(check, timeoutMs = 10000) { const started = Date.now(); while (Date.now() - started < timeoutMs) { if (check()) return; await delay(40); } throw new Error("Timed out waiting for interactive workspace state."); }
function loadFrame(url) { return new Promise((resolve) => { frame.addEventListener("load", resolve, { once:true }); frame.src = url; }); }
async function json(url, options) { const response = await fetch(url, { cache:"no-store", ...options }); if (!response.ok) throw new Error(`Harness request failed (${response.status}).`); return response.json(); }
async function control(failDraftReads) { await json("/__jd05/control", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ failDraftReads }) }); }
async function submit(report) { return json("/__jd05/report", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(report) }); }
