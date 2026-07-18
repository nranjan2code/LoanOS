const ids = [
  "actor-authority", "refresh", "offline", "workspace-tabs", "view-kicker", "view-title", "view-description", "status",
  "open-count", "overdue-count", "exception-count", "unassigned-count", "queue-search", "table-caption", "queue",
  "inspector", "inspector-title", "inspector-description", "inspector-meta", "domain-action", "domain-action-description",
  "domain-action-path", "task-controls", "assignment-form", "assignee", "assignment-notes", "assign-task", "start-task",
  "release-task", "release-reason", "comment-form", "task-comment", "comment-task", "inspector-status"
];
const ui = Object.fromEntries(ids.map((id) => [id.replaceAll("-", "_"), document.querySelector(`#${id}`)]));

let active = new URLSearchParams(location.search).get("view") ?? "origination";
let workspace;
let actors = [];
let selected;

ui.refresh.addEventListener("click", () => void load());
ui.queue_search.addEventListener("input", renderQueue);
ui.assignment_form.addEventListener("submit", (event) => { event.preventDefault(); void assignTask(); });
ui.comment_form.addEventListener("submit", (event) => { event.preventDefault(); void commentTask(); });
ui.start_task.addEventListener("click", () => void taskAction("start", {}));
ui.release_task.addEventListener("click", () => {
  const reason = ui.release_reason.value.trim();
  if (!reason) return inspectorState("A release reason is required.", true);
  void taskAction("release", { reason });
});
addEventListener("online", networkState);
addEventListener("offline", networkState);
networkState();
void bootstrap();

async function bootstrap() {
  try {
    const response = await request("/staff/actors");
    actors = response.actors ?? [];
  } catch {
    actors = [];
  }
  await load();
}

async function load(options = {}) {
  setStatus("Loading authorised tenant data…");
  try {
    workspace = await request(`/operational-workspaces?view=${encodeURIComponent(active)}`);
    if (!workspace.workspaces.some((item) => item.id === active)) active = workspace.workspaces[0]?.id ?? "origination";
    selected = options.keepSelection ? workspace.items.find((item) => item.itemId === selected?.itemId) : undefined;
    renderAuthority();
    renderTabs();
    renderHeading();
    renderMetrics();
    renderQueue();
    renderInspector();
    setStatus(`Loaded ${workspace.items.length} authorised work items. Browser caching and persistence are disabled.`);
    activity("workspace_refreshed");
  } catch (error) {
    workspace = undefined;
    selected = undefined;
    ui.queue.replaceChildren(emptyRow("Unable to load this workspace."));
    renderInspector();
    setStatus(error.message, true);
  }
}

function renderAuthority() {
  const actor = workspace.actor;
  const roles = actor.roles.length ? actor.roles.map(words).join(", ") : "administrative projection";
  const queues = actor.queues.length ? actor.queues.join(", ") : "no workflow queues";
  ui.actor_authority.textContent = `${actor.displayName} · ${roles} · ${queues}`;
}

function renderTabs() {
  ui.workspace_tabs.replaceChildren();
  for (const item of workspace.workspaces) {
    const button = element("button", "", item.label);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(item.id === active));
    button.dataset.view = item.id;
    const count = element("span", "tab-count", String(item.taskCount));
    count.setAttribute("aria-label", `${item.taskCount} active tasks`);
    button.append(count);
    button.addEventListener("click", () => {
      if (active === item.id) return;
      active = item.id;
      const url = new URL(location.href);
      url.searchParams.set("view", active);
      history.pushState(null, "", url);
      void load();
    });
    ui.workspace_tabs.append(button);
  }
}

function renderHeading() {
  const definition = workspace.workspaces.find((item) => item.id === active);
  ui.view_kicker.textContent = "Role and queue authorised";
  ui.view_title.textContent = definition?.label ?? "Operational workspace";
  ui.view_description.textContent = definition?.description ?? "Governed tenant work.";
  ui.table_caption.textContent = `${definition?.label ?? "Operational"} work queue`;
}

function renderMetrics() {
  ui.open_count.textContent = workspace.metrics.open;
  ui.overdue_count.textContent = workspace.metrics.overdue;
  ui.exception_count.textContent = workspace.metrics.exceptions;
  ui.unassigned_count.textContent = workspace.metrics.unassigned;
}

function renderQueue() {
  ui.queue.replaceChildren();
  if (!workspace) return ui.queue.append(emptyRow("No authorised records in this workspace."));
  const query = ui.queue_search.value.trim().toLowerCase();
  const items = workspace.items.filter((item) => !query || [item.itemId, item.title, item.recordType, item.status, item.owner, item.queue].some((value) => String(value ?? "").toLowerCase().includes(query)));
  if (!items.length) return ui.queue.append(emptyRow(query ? "No work matches this filter." : "No authorised records in this workspace."));
  for (const item of items) {
    const row = document.createElement("tr");
    row.tabIndex = 0;
    row.dataset.itemId = item.itemId;
    row.classList.toggle("selected", selected?.itemId === item.itemId);
    row.setAttribute("aria-selected", String(selected?.itemId === item.itemId));
    const priority = element("span", `badge ${safeToken(item.overdue ? "overdue" : item.priority)}`, item.overdue ? "Overdue" : words(item.priority));
    const work = document.createElement("td");
    work.append(element("span", "work-title", item.title), element("span", "work-reference", item.itemId));
    row.append(cell(priority), work, cell(element("span", "badge", words(item.status))), cell(item.owner ? words(item.owner) : "Unassigned"), cell(formatDate(item.dueAt)));
    const choose = () => selectItem(item);
    row.addEventListener("click", choose);
    row.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      choose();
    });
    ui.queue.append(row);
  }
}

function selectItem(item) {
  selected = item;
  renderQueue();
  renderInspector();
  ui.inspector.scrollIntoView({ block: "nearest" });
  activity("work_item_opened", item.recordType);
}

function renderInspector() {
  ui.inspector_meta.replaceChildren();
  ui.domain_action.hidden = true;
  ui.task_controls.hidden = true;
  inspectorState("");
  if (!selected) {
    ui.inspector_title.textContent = "Choose a work item";
    ui.inspector_description.textContent = "Select a row to review safe metadata, evidence boundaries and permitted task controls.";
    return;
  }

  ui.inspector_title.textContent = selected.title;
  ui.inspector_description.textContent = selected.description;
  const facts = [
    ["Reference", selected.itemId], ["Type", words(selected.recordType)], ["Status", words(selected.status)], ["Priority", words(selected.priority)],
    ["Queue", selected.queue ? words(selected.queue) : "Metadata record"], ["Required role", selected.requiredRole ? words(selected.requiredRole) : "Not applicable"],
    ["Owner", selected.owner ? words(selected.owner) : "Unassigned"], ["Due", formatDate(selected.dueAt)], ["Entity", selected.entityId ?? "—"]
  ];
  for (const [term, value] of facts) ui.inspector_meta.append(element("dt", "", term), element("dd", "", value));

  if (selected.action) {
    ui.domain_action.hidden = false;
    ui.domain_action_description.textContent = selected.action.description;
    ui.domain_action_path.textContent = `${selected.action.method} ${selected.action.path}`;
  }

  if (selected.kind === "task") renderTaskControls();
}

function renderTaskControls() {
  ui.task_controls.hidden = false;
  ui.assignee.replaceChildren(option("", "Select eligible actor"));
  for (const actor of eligibleActors(selected)) ui.assignee.append(option(actor.actorId, `${actor.displayName} · ${actor.actorId}`));
  ui.assignee.value = selected.owner ?? "";
  ui.assignment_notes.value = "";
  ui.release_reason.value = "";
  ui.task_comment.value = "";
  const offline = !navigator.onLine;
  ui.assign_task.disabled = offline || !selected.taskControls?.assign;
  ui.start_task.disabled = offline || !selected.taskControls?.start;
  ui.release_task.disabled = offline || !selected.taskControls?.release;
  ui.comment_task.disabled = offline || !selected.taskControls?.comment;
}

function eligibleActors(task) {
  return actors.filter((actor) => actor.status === "active" && (actor.roles?.includes("workflow_admin") || actor.roles?.includes(task.requiredRole)) && (actor.queues?.includes("*") || actor.queues?.includes(task.queue)));
}

async function assignTask() {
  if (!selected || !ui.assignment_form.reportValidity()) return;
  await taskAction("assignments", { assignedTo: ui.assignee.value, notes: ui.assignment_notes.value.trim() || undefined });
}

async function commentTask() {
  if (!selected || !ui.comment_form.reportValidity()) return;
  await taskAction("comments", { comment: ui.task_comment.value.trim() });
}

async function taskAction(action, body) {
  if (!selected || selected.kind !== "task") return;
  inspectorState(`${words(action)} in progress…`);
  setTaskMutationState(true);
  try {
    await request(`/workflow/tasks/${encodeURIComponent(selected.itemId)}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    inspectorState(`${words(action)} recorded with authenticated actor evidence.`);
    activity(`task_${action}`, selected.recordType);
    await load({ keepSelection: true });
  } catch (error) {
    inspectorState(error.message, true);
  } finally {
    if (selected?.kind === "task") renderTaskControls();
  }
}

function setTaskMutationState(disabled) {
  for (const control of [ui.assign_task, ui.start_task, ui.release_task, ui.comment_task]) control.disabled = disabled || !navigator.onLine;
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, credentials: "same-origin", cache: "no-store", headers: { accept: "application/json", ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status}).`);
  return body;
}

function activity(actionId, entityType = active) {
  fetch("/activity/screen-events", {
    method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" },
    body: JSON.stringify({ screenId: "operational_workspaces", activityType: actionId === "workspace_refreshed" ? "screen_view" : "action_intent", actionId, entityType: `workspace_${safeToken(entityType)}` })
  }).catch(() => {});
}

function networkState() {
  ui.offline.hidden = navigator.onLine;
  if (selected?.kind === "task") renderTaskControls();
}

function setStatus(message, error = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle("error", error);
}

function inspectorState(message, error = false) {
  ui.inspector_status.textContent = message;
  ui.inspector_status.classList.toggle("error", error);
}

function emptyRow(message) { const row = document.createElement("tr"); const value = document.createElement("td"); value.colSpan = 5; value.textContent = message; row.append(value); return row; }
function cell(value) { const result = document.createElement("td"); if (value instanceof Node) result.append(value); else result.textContent = value ?? "—"; return result; }
function option(value, label) { const result = document.createElement("option"); result.value = value; result.textContent = label; return result; }
function element(tag, className = "", text = "") { const result = document.createElement(tag); if (className) result.className = className; if (text !== "") result.textContent = text; return result; }
function words(value) { return String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function safeToken(value) { return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "-"); }
function formatDate(value) { if (!value) return "—"; const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: "medium", timeStyle: value.includes("T") ? "short" : undefined }).format(date) : String(value); }
