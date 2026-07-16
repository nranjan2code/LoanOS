const ui = Object.fromEntries([
  "catalogue", "workspace", "status", "journey-form", "form-sections", "document-list", "action-list", "workspace-title", "schema-meta", "language", "staff-channel", "staff-channel-label", "offline", "form-status", "back", "brand-name", "brand-mark", "draft-region", "draft-list", "refresh-drafts", "timeline-content", "action-guidance", "administration", "administration-link", "page-title", "channel-label"
].map((id) => [id.replaceAll("-", "_"), document.querySelector(`#${id}`)]));

const path = location.pathname;
const tenantId = decodeURIComponent(path.match(/^\/t\/([^/]+)/)?.[1] ?? "");
const surface = path.includes("/portal/") ? "borrower" : path.includes("/partners/") ? "partner" : path.includes("/field/") ? "field" : "staff";
let channel = surface === "staff" ? new URLSearchParams(location.search).get("channel") ?? "credit" : surface;
let catalogue;
let current;
let drafts = [];
let draftId;

const executableActions = Object.freeze({ save_draft: false, submit_application: true });
const basePath = `/t/${encodeURIComponent(tenantId)}`;

configureSurface();
bindEvents();
networkState();
void bootstrap();

function configureSurface() {
  const staff = surface === "staff";
  ui.staff_channel.hidden = !staff;
  ui.staff_channel_label.hidden = !staff;
  if (staff) ui.staff_channel.value = channel;
  ui.back.href = `${basePath}/${surface === "borrower" ? "portal" : surface === "partner" ? "partners" : surface === "field" ? "field" : "staff"}/`;
  ui.administration_link.href = `${basePath}/staff/administration`;
}

function bindEvents() {
  ui.staff_channel.addEventListener("change", () => {
    channel = ui.staff_channel.value;
    const url = new URL(location.href);
    url.searchParams.set("channel", channel);
    history.replaceState(null, "", url);
    void loadMode();
  });
  ui.language.addEventListener("change", () => {
    document.documentElement.lang = ui.language.value;
    renderCatalogue();
    if (current) renderSchema(current);
  });
  document.querySelector("#close-workspace").addEventListener("click", closeWorkspace);
  ui.refresh_drafts.addEventListener("click", () => void loadDrafts());
  addEventListener("online", networkState);
  addEventListener("offline", networkState);
}

async function bootstrap() {
  await loadBranding();
  await loadMode();
}

async function loadBranding() {
  try {
    const query = new URLSearchParams({ channel, locale: ui.language.value });
    const { experience: brand } = await request(`${basePath}/brand-experience?${query}`);
    const name = brand.theme?.brandName || brand.legalIdentity?.regulatedEntityName;
    ui.brand_name.textContent = name;
    ui.brand_mark.textContent = name?.slice(0, 1).toUpperCase() || "";
    ui.brand_mark.hidden = !name;
    document.title = `${name} · Lending workspace`;
    document.documentElement.style.setProperty("--tenant-brand-name", JSON.stringify(name));
    applyTheme(brand.theme);
  } catch {
    ui.brand_mark.hidden = true;
    ui.brand_name.textContent = "Brand configuration required";
  }
}

async function loadMode() {
  current = undefined;
  draftId = undefined;
  ui.workspace.hidden = true;
  ui.catalogue.hidden = false;
  ui.administration.hidden = channel !== "administration";
  ui.draft_region.hidden = true;
  ui.catalogue.replaceChildren();
  ui.channel_label.textContent = channel === "administration" ? "Tenant governance" : `${channel.replaceAll("_", " ")} workspace`;
  if (channel === "administration") {
    ui.page_title.textContent = "Administration";
    state("Administration is separated from transactional journey work.");
    return;
  }
  ui.page_title.textContent = "Choose a lending journey";
  await Promise.all([loadCatalogue(), loadDrafts()]);
}

async function loadCatalogue() {
  state("Loading authorised journeys…");
  try {
    const response = await request(`/journey-workspaces/${channel}/catalogue`);
    catalogue = response.catalogue;
    renderCatalogue();
    state(catalogue.journeyCount ? `${catalogue.journeyCount} authorised product journeys across ${catalogue.schemaCount} workspace shapes.` : "No product journeys are active for this tenant.");
  } catch (error) {
    state(error.message, true);
  }
}

async function loadDrafts() {
  try {
    const response = await request(`/journey-workspaces/${channel}/drafts`);
    drafts = response.drafts ?? [];
    renderDrafts();
  } catch (error) {
    drafts = [];
    renderDrafts(error.message);
  }
}

function renderCatalogue() {
  ui.catalogue.replaceChildren();
  if (!catalogue) return;
  for (const item of catalogue.journeys) {
    const card = element("article", "journey-card");
    const heading = element("h2", "", journeyName(item.journeyType));
    const button = element("button", "", "Open journey");
    button.type = "button";
    button.addEventListener("click", () => void openJourney(item.journeyType));
    card.append(element("p", "eyebrow", item.archetype.replaceAll("_", " ")), heading, element("p", "", `${fieldCount(item)} authorised fields · ${item.documents.length} evidence types`), button);
    ui.catalogue.append(card);
  }
}

function renderDrafts(error) {
  ui.draft_region.hidden = false;
  ui.draft_list.replaceChildren();
  if (error) return ui.draft_list.append(element("p", "error", error));
  if (!drafts.length) return ui.draft_list.append(element("p", "empty-state", "No saved drafts for this workspace."));
  for (const draft of [...drafts].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))) {
    const row = element("article", "draft-row");
    const details = element("div");
    details.append(element("strong", "", journeyName(draft.journeyType)), element("span", `status-badge status-${safeToken(draft.status)}`, draft.status), element("small", "", `Updated ${formatDate(draft.updatedAt)} · schema v${draft.schemaVersion}`));
    const button = element("button", "secondary", draft.status === "draft" ? "Resume" : "View");
    button.type = "button";
    button.addEventListener("click", () => void openJourney(draft.journeyType, draft));
    row.append(details, button);
    ui.draft_list.append(row);
  }
}

async function openJourney(journeyType, draft) {
  state("Loading governed schema…");
  try {
    const response = await request(`/journey-workspaces/${channel}/schemas/${encodeURIComponent(journeyType)}`);
    current = response.schema;
    draftId = draft?.draftId ?? `draft-${crypto.randomUUID()}`;
    renderSchema(current, draft);
    ui.catalogue.hidden = true;
    ui.draft_region.hidden = true;
    ui.workspace.hidden = false;
    state("");
    activity("workspace_opened", journeyType);
  } catch (error) {
    state(error.message, true);
  }
}

function renderSchema(schema, draft) {
  const lang = ui.language.value;
  ui.workspace_title.textContent = journeyName(schema.journeyType);
  ui.schema_meta.textContent = `${schema.archetype.replaceAll("_", " ")} · schema v${schema.schemaVersion} · ${schema.channel}`;
  ui.form_sections.replaceChildren();
  for (const section of schema.sections) {
    const wrap = element("section", "form-section");
    const grid = element("div", "field-grid");
    for (const item of section.fields) grid.append(renderField(item, draft?.values?.[item.fieldId]));
    wrap.append(element("h3", "", label(section.title, lang)), grid);
    ui.form_sections.append(wrap);
  }
  renderDocuments(schema.documents);
  renderActions(schema.actions, draft?.status);
  ui.timeline_content.textContent = draft ? `Draft ${draft.draftId} is ${draft.status}. No governed case lifecycle is linked by the current API.` : "No governed case lifecycle is linked to this new draft.";
  ui.form_status.textContent = draft?.status === "draft" ? "Resumed from the server. Masked values must be entered again before submission." : "";
  ui.workspace_title.focus();
}

function renderField(item, prior) {
  const field = element("label", "field");
  const caption = element("span", "", label(item.label, ui.language.value));
  if (item.required) caption.append(element("span", "required", " *"));
  const input = document.createElement("input");
  input.name = item.fieldId;
  input.id = `field-${safeToken(item.fieldId)}`;
  input.required = item.required;
  input.autocomplete = item.autocomplete ?? "off";
  input.inputMode = ["money_string", "decimal_string", "integer"].includes(item.type) ? "decimal" : item.type === "tel" ? "tel" : "text";
  input.type = item.type === "date" ? "date" : item.type === "tel" ? "tel" : "text";
  input.dataset.type = item.type;
  input.setAttribute("aria-describedby", `help-${safeToken(item.fieldId)}`);
  if (prior != null && !String(prior).includes("•")) input.value = String(prior);
  const help = element("small", "", `${item.dataClass} · ${item.exposure} response`);
  help.id = `help-${safeToken(item.fieldId)}`;
  field.append(caption, input, help);
  return field;
}

function renderDocuments(documents) {
  ui.document_list.replaceChildren();
  if (!documents.length) return ui.document_list.append(element("p", "empty-state", "No evidence is projected for this role and stage."));
  for (const item of documents) {
    const row = element("div", "document-row");
    const copy = element("div");
    copy.append(element("strong", "", `${label(item.title, ui.language.value)}${item.required ? " *" : ""}`), element("small", "", `${item.dataClass} · ${item.exposure}`));
    const control = element("button", "secondary evidence-control", "Check connection");
    control.type = "button";
    control.setAttribute("aria-expanded", "false");
    const detail = element("p", "evidence-detail", "The current API projects this requirement but does not provide document upload or reference persistence.");
    detail.hidden = true;
    control.addEventListener("click", () => { detail.hidden = !detail.hidden; control.setAttribute("aria-expanded", String(!detail.hidden)); control.textContent = detail.hidden ? "Check connection" : "Hide connection status"; });
    const controls = element("div", "evidence-state");
    controls.append(control, detail);
    row.append(copy, controls);
    ui.document_list.append(row);
  }
}

function renderActions(actions, draftStatus) {
  ui.action_list.replaceChildren();
  const projected = actions.filter((action) => Object.hasOwn(executableActions, action.actionId));
  const terminal = ["submitted", "cancelled"].includes(draftStatus);
  for (const action of projected) {
    const button = element("button", action.actionId === "submit_application" ? "primary" : "secondary", label(action.title, ui.language.value));
    button.type = "button";
    button.disabled = terminal || !navigator.onLine;
    button.dataset.actionId = action.actionId;
    button.addEventListener("click", () => void executeAction(action));
    ui.action_list.append(button);
  }
  ui.action_guidance.textContent = projected.length ? "Only server-projected actions backed by this workspace API are available." : "No executable action is authorised for this role and workspace.";
}

async function executeAction(action) {
  if (!current || !draftId) return;
  const submit = executableActions[action.actionId];
  if (submit && !ui.journey_form.reportValidity()) return;
  const values = {};
  for (const input of ui.journey_form.querySelectorAll("[data-type]")) {
    if (!input.value) continue;
    values[input.name] = input.dataset.type === "integer" ? Number(input.value) : input.value;
  }
  const idempotencyKey = crypto.randomUUID();
  ui.form_status.textContent = submit ? "Submitting securely…" : "Saving secure draft…";
  setActionState(true);
  try {
    const response = await request(`/journey-workspaces/${channel}/drafts/${encodeURIComponent(current.journeyType)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId, idempotencyKey, values, submit })
    });
    ui.form_status.textContent = response.draft.status === "submitted" ? "Application facts submitted with immutable schema lineage." : "Draft saved server-side. Masked values are never retained by this browser.";
    activity(submit ? "workspace_submitted" : "workspace_draft_saved", current.journeyType);
    await loadDrafts();
    renderActions(current.actions, response.draft.status);
  } catch (error) {
    ui.form_status.textContent = error.message;
  } finally {
    setActionState(false);
  }
}

function closeWorkspace() {
  current = undefined;
  draftId = undefined;
  ui.workspace.hidden = true;
  ui.catalogue.hidden = false;
  ui.draft_region.hidden = false;
  ui.catalogue.focus();
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, credentials:"same-origin", cache:"no-store", headers: { accept: "application/json", ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status}).`);
  return body;
}

function activity(activityType, journeyType) {
  fetch("/activity/screen-events", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ screenId: "journey_workspace", activityType: activityType === "workspace_opened" ? "screen_view" : "action_intent", actionId: activityType, entityType: `product_journey_${journeyType}` }) }).catch(() => {});
}

function networkState() {
  ui.offline.hidden = navigator.onLine;
  setActionState(!navigator.onLine);
}

function setActionState(disabled) {
  ui.action_list.querySelectorAll("button").forEach((button) => { button.disabled = disabled; });
}

function state(message, error = false) { ui.status.textContent = message; ui.status.classList.toggle("error", error); }
function applyTheme(theme) {
  if (!theme || typeof theme !== "object") return;
  const tokens = { primary: "--brand", primaryStrong: "--brand-strong", accent: "--accent", canvas: "--canvas", surface: "--surface", text: "--ink" };
  for (const [name, property] of Object.entries(tokens)) {
    const value = theme[name];
    if (typeof value === "string" && /^(#[0-9a-f]{3,8}|rgb\([0-9 ,.]+\)|hsl\([0-9 ,.%-]+\))$/i.test(value)) document.documentElement.style.setProperty(property, value);
  }
}
function label(value, lang) { return value?.[lang] ?? value?.en ?? ""; }
function fieldCount(schema) { return schema.sections.reduce((total, section) => total + section.fields.length, 0); }
function journeyName(type) { return type.split("_").map((word) => word === "msme" ? "MSME" : word.charAt(0).toUpperCase() + word.slice(1)).join(" "); }
function formatDate(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: "medium", timeStyle: "short" }).format(date) : "unknown"; }
function safeToken(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, "-"); }
function element(tag, className = "", text = "") { const result = document.createElement(tag); if (className) result.className = className; if (text) result.textContent = text; return result; }
