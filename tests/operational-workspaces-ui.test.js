import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("specialist workspace UI keeps evidence actions, timelines and audit fail closed", async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL("../apps/dashboard/workspaces.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/dashboard/workspaces.js", import.meta.url), "utf8"),
    readFile(new URL("../apps/dashboard/workspaces.css", import.meta.url), "utf8")
  ]);

  for (const marker of [
    "specialist-action", "domain-action-form", "action-attestation", "Submit to owning control",
    "case-timeline", "timeline-list", "Documents &amp; evidence", "audit-panel", "Task audit",
    "aria-live=\"polite\"", "Held only in memory"
  ]) assert.match(html, new RegExp(marker));

  for (const marker of [
    "ACTION_CONTRACTS", "/workflow/tasks/", "selectedDetail", "loadTaskDetail", "submitDomainAction",
    "parseActionPayload", "sameActionContract", "collectEvidence", "renderTimeline", "renderEvidence", "renderAudit",
    "credentials: \"same-origin\"", "cache: \"no-store\"", "replaceChildren", "textContent"
  ]) assert.match(js, new RegExp(marker.replaceAll("/", "\\/")));

  for (const representative of [
    "application.credit_decision", "complaint.resolution", "loan_account.recovery_assignment",
    "fiu.filing", "specialist_journey.action"
  ]) assert.match(js, new RegExp(representative.replaceAll(".", "\\.")));

  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|document\.write|localStorage|sessionStorage|indexedDB|serviceWorker/);
  assert.match(js, /response\.ok/);
  assert.match(js, /Owning control rejected/);
  assert.match(js, /selectedDetail\?\.action/);
  assert.match(css, /\.timeline-list/);
  assert.match(css, /\.evidence-item/);
  assert.match(css, /\.readiness\.blocked/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
});
