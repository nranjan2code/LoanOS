const ui = Object.fromEntries(["home", "brand-mark", "brand-name", "banker-link", "refresh", "summary", "status", "product-list", "detail-title", "detail-content", "approval-list", "brand-list", "configuration-template", "staffing-grant-template", "action-dialog", "action-form", "action-title", "action-fields"].map((id) => [id.replaceAll("-", "_"), document.querySelector(`#${id}`)]));
const tenantId = decodeURIComponent(location.pathname.match(/^\/t\/([^/]+)/)?.[1] ?? "");
const basePath = `/t/${encodeURIComponent(tenantId)}`;
let workspace;
let brands;
let selectedType;
let detail;

ui.home.href = `${basePath}/`;
ui.banker_link.href = `${basePath}/staff/`;
ui.refresh.addEventListener("click", load);
ui.action_form.querySelector("[data-close]").addEventListener("click", () => ui.action_dialog.close());
void load();

async function load() {
  status("Loading governed product state…");
  try {
    [workspace, brands] = await Promise.all([request("/admin/product-platform"), request("/admin/brand-governance")]);
    await brand();
    render();
    if (selectedType) await selectProduct(selectedType, false);
    status("");
  } catch (error) {
    status(error.message, true);
  }
}

async function brand() {
  try {
    const { experience } = await request(`${basePath}/brand-experience?channel=administration&locale=en`);
    const institutionName = experience.theme?.brandName || experience.legalIdentity?.regulatedEntityName;
    ui.brand_name.textContent = `${institutionName} · Administration`;
    ui.brand_mark.textContent = institutionName?.slice(0, 1) || "";
    applyTheme(experience.theme);
  } catch {
    ui.brand_name.textContent = "Brand configuration required · Administration";
  }
}

function render() {
  const active = workspace.products.filter((product) => product.status === "active").length;
  const ready = workspace.products.filter((product) => product.readiness?.complete).length;
  ui.summary.replaceChildren(metric(`${workspace.canonicalJourneyCount} canonical journeys`), metric(`${workspace.products.length} subscribed`), metric(`${active} active`), metric(`${ready} ready`), metric(`${workspace.pendingTransitions.length} pending approvals`));
  renderProducts();
  renderApprovals();
  renderBrands();
}

function renderProducts() {
  ui.product_list.replaceChildren();
  for (const contract of [...workspace.contracts].sort((a, b) => name(a.journeyType).localeCompare(name(b.journeyType)))) {
    const product = productFor(contract.journeyType);
    const button = element("button", "product-row");
    button.type = "button";
    button.setAttribute("aria-current", String(selectedType === contract.journeyType));
    button.append(element("strong", "", name(contract.journeyType)), element("small", "", product ? `${product.status} · configuration v${product.configurationVersion}` : "Not subscribed"));
    button.addEventListener("click", () => selectProduct(contract.journeyType));
    ui.product_list.append(button);
  }
}

async function selectProduct(productType, announce = true) {
  selectedType = productType;
  renderProducts();
  if (announce) status(`Loading ${name(productType)}…`);
  try {
    detail = await request(`/admin/product-platform/products/${encodeURIComponent(productType)}`);
    renderDetail();
    if (announce) status("");
  } catch (error) {
    status(error.message, true);
  }
}

function renderDetail() {
  const { contract, product } = detail;
  ui.detail_title.textContent = name(detail.productType);
  const head = element("div", "detail-head");
  const copy = element("div");
  copy.append(element("p", "", `${contract.facility.type.replaceAll("_", " ")} · ${contract.security.type.replaceAll("_", " ")} · contract v${contract.contractVersion}`));
  if (product) copy.append(badge(`${product.status} · configuration v${product.configurationVersion}`));
  const actions = element("div", "form-actions");
  for (const next of detail.nextActions.filter((item) => item.enabled)) actions.append(action(actionLabel(next.action), () => next.action === "configuration" ? configuration() : openActionForm(next.action), next.action.includes("suspension") || next.action.includes("retirement") ? "danger" : ""));
  head.append(copy, actions);
  const content = [head, blockers(), contractSection("Required facts", contract.requiredFacts), contractSection("Required evidence", contract.requiredEvidence), contractSection("Lifecycle capabilities", contract.lifecycleCapabilities)];
  if (product) content.push(readiness(), staffing(), history(), documents());
  ui.detail_content.replaceChildren(...content);
}

function blockers() {
  const card = section("Next actions and blockers");
  const grid = element("div", "action-grid");
  for (const next of detail.nextActions) {
    const item = element("article", next.enabled ? "next-action ready" : "next-action blocked");
    item.append(element("strong", "", actionLabel(next.action)), element("small", "", next.enabled ? "Ready to start" : next.blockers.map(humanBlocker).join(" · ")));
    grid.append(item);
  }
  card.append(grid);
  return card;
}

function readiness() {
  const card = section(detail.readiness.complete ? "Readiness complete" : "Readiness blockers");
  const list = element("div", "readiness-grid");
  for (const gap of detail.readiness.gaps) list.append(element("span", "gap", humanBlocker(gap)));
  if (!detail.readiness.gaps.length) list.append(element("span", "", detail.readiness.effective ? "All configured readiness gates are present and effective." : "Evidence is complete; the effective window has not opened."));
  card.append(list);
  return card;
}

function staffing() {
  const card = section("Staffing and scopes");
  const grants = detail.product.configuration?.staffingGrants ?? [];
  if (!grants.length) card.append(element("p", "empty compact", "No staffing grants have been proposed."));
  for (const grant of grants) {
    const row = element("article", "metadata-row");
    row.append(element("strong", "", grant.grantId), element("span", "", grant.principalId), element("span", "", grant.roles.join(", ")), element("small", "", `Scopes: ${grant.scopeRefs.join(", ")} · Evidence: ${grant.evidenceRef}`));
    card.append(row);
  }
  return card;
}

function history() {
  const card = section("Configuration and lifecycle history");
  if (!detail.history.length) card.append(element("p", "empty compact", "No history is available."));
  for (const record of [...detail.history].reverse()) {
    const row = element("article", "metadata-row");
    row.append(element("strong", "", actionLabel(record.action)), element("span", "", `${record.actor} · ${formatDate(record.at)}`), element("small", "", describe(record.details)));
    card.append(row);
  }
  for (const diff of [...detail.configurationDiffs].reverse()) {
    const row = element("article", "diff-row");
    row.append(element("strong", "", `Configuration v${diff.fromVersion} → v${diff.toVersion}`));
    for (const change of diff.changes) row.append(element("small", "", `${change.path}: ${display(change.before)} → ${display(change.after)}`));
    card.append(row);
  }
  return card;
}

function documents() {
  const card = section("Evidence and document references");
  const grid = element("div", "document-grid");
  for (const record of detail.documents) {
    const item = element("article", "document-card");
    item.append(element("span", "eyebrow", record.category), element("strong", "", name(record.key)), element("code", "", record.reference), element("small", "", `Configuration v${record.configurationVersion}`));
    grid.append(item);
  }
  card.append(grid);
  return card;
}

function contractSection(title, items) {
  const card = section(title);
  const list = element("div", "pill-list");
  for (const item of items) list.append(element("span", "pill", item.replaceAll("_", " ")));
  card.append(list);
  return card;
}

async function openActionForm(nextAction) {
  try {
    const { formSchema } = await request(`/admin/product-platform/products/${encodeURIComponent(detail.productType)}/form-schema?action=${encodeURIComponent(nextAction)}`);
    assertSchema(formSchema, nextAction);
    ui.action_title.textContent = `${actionLabel(nextAction)} · ${name(detail.productType)}`;
    ui.action_fields.replaceChildren();
    for (const field of formSchema.fields.filter((item) => !["commandId", "requestId"].includes(item.name))) ui.action_fields.append(actionField(field));
    ui.action_form.onsubmit = async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(ui.action_form));
      if (formSchema.fields.some((item) => item.name === "commandId")) payload.commandId = crypto.randomUUID();
      if (formSchema.fields.some((item) => item.name === "requestId")) payload.requestId = crypto.randomUUID();
      if (payload.templateVersion) payload.templateVersion = Number(payload.templateVersion);
      ui.action_dialog.close();
      await mutate(`/admin/product-platform/products/${detail.productType}/${nextAction}`, payload);
    };
    ui.action_dialog.showModal();
  } catch (error) {
    status(error.message, true);
  }
}

function actionField(field) {
  const label = element("label", "", name(field.name));
  let input;
  if (field.name === "templateVersion") {
    input = document.createElement("select");
    for (const template of detail.templates) {
      const option = document.createElement("option");
      option.value = String(template.version);
      option.textContent = `Version ${template.version} · ${template.templateId}`;
      input.append(option);
    }
  } else if (field.inputType === "text") input = document.createElement("textarea");
  else input = document.createElement("input");
  input.name = field.name;
  input.required = field.required;
  label.append(input);
  return label;
}

async function configuration() {
  try {
    const { formSchema } = await request(`/admin/product-platform/products/${encodeURIComponent(detail.productType)}/form-schema?action=configuration`);
    assertSchema(formSchema, "configuration");
    const fragment = ui.configuration_template.content.cloneNode(true);
    const form = fragment.querySelector("form");
    const evidence = form.querySelector("#readiness-fields");
    const readinessField = formSchema.fields.find((field) => field.name === "configuration.readinessEvidence");
    for (const gate of readinessField.keys) {
      const label = element("label", "", name(gate));
      const input = document.createElement("input");
      input.name = `readiness_${gate}`;
      input.required = true;
      label.append(input);
      evidence.append(label);
    }
    const grants = form.querySelector("#staffing-grants");
    form.querySelector("#add-staffing-grant").addEventListener("click", () => addStaffingGrant(grants));
    addStaffingGrant(grants);
    if (detail.product?.configuration) populateConfiguration(form, detail.product.configuration, grants);
    form.querySelector("[data-close]").addEventListener("click", renderDetail);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const readinessEvidence = Object.fromEntries(readinessField.keys.map((gate) => [gate, data.get(`readiness_${gate}`)]));
      await mutate(`/admin/product-platform/products/${detail.productType}/configuration`, { commandId: crypto.randomUUID(), configuration: collectConfiguration(form, data, readinessEvidence) });
    });
    ui.detail_content.replaceChildren(fragment);
  } catch (error) {
    status(error.message, true);
  }
}

function addStaffingGrant(container) {
  const grant = ui.staffing_grant_template.content.cloneNode(true);
  grant.querySelector("[data-remove-grant]").addEventListener("click", (event) => event.currentTarget.closest(".staffing-grant").remove());
  container.append(grant);
}

function populateConfiguration(form, current, grants) {
  const set = (fieldName, value) => { const input = form.elements.namedItem(fieldName); if (input) input.value = value ?? ""; };
  for (const key of ["regulatedEntityRefs", "productPolicyRef", "decisionBundleRef", "accountingProfileRef", "complianceProfileRef", "providerProfileRefs", "documentPackRef", "programmeRefs"]) set(key, Array.isArray(current[key]) ? current[key].join(", ") : current[key]);
  for (const input of form.querySelectorAll('[name="channels"]')) input.checked = current.channels.includes(input.value);
  for (const [key, value] of Object.entries(current.whiteLabelBinding)) set(key, Array.isArray(value) ? value.join(", ") : value);
  set("effectiveFrom", localDate(current.effectiveFrom));
  set("effectiveTo", localDate(current.effectiveTo));
  for (const [gate, value] of Object.entries(current.readinessEvidence)) set(`readiness_${gate}`, value);
  grants.replaceChildren();
  for (const currentGrant of current.staffingGrants) {
    addStaffingGrant(grants);
    const row = grants.lastElementChild;
    for (const key of ["grantId", "principalId", "roles", "scopeRefs", "evidenceRef"]) row.querySelector(`[name="${key}"]`).value = Array.isArray(currentGrant[key]) ? currentGrant[key].join(", ") : currentGrant[key];
  }
}

function collectConfiguration(form, data, readinessEvidence) {
  const csv = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  const staffingGrants = [...form.querySelectorAll(".staffing-grant")].map((row) => ({ grantId: row.querySelector('[name="grantId"]').value, principalId: row.querySelector('[name="principalId"]').value, roles: csv(row.querySelector('[name="roles"]').value), scopeRefs: csv(row.querySelector('[name="scopeRefs"]').value), evidenceRef: row.querySelector('[name="evidenceRef"]').value }));
  return { regulatedEntityRefs: csv(data.get("regulatedEntityRefs")), channels: data.getAll("channels"), productPolicyRef: data.get("productPolicyRef"), decisionBundleRef: data.get("decisionBundleRef"), accountingProfileRef: data.get("accountingProfileRef"), complianceProfileRef: data.get("complianceProfileRef"), providerProfileRefs: csv(data.get("providerProfileRefs")), documentPackRef: data.get("documentPackRef"), staffingGrants, programmeRefs: csv(data.get("programmeRefs")), whiteLabelBinding: { brandVersionRef: data.get("brandVersionRef"), legalEntityDisclosureRef: data.get("legalEntityDisclosureRef"), localeRefs: csv(data.get("localeRefs")), communicationTemplateSetRef: data.get("communicationTemplateSetRef"), documentTemplateSetRef: data.get("documentTemplateSetRef") }, readinessEvidence, effectiveFrom: new Date(data.get("effectiveFrom")).toISOString(), effectiveTo: data.get("effectiveTo") ? new Date(data.get("effectiveTo")).toISOString() : null };
}

function renderApprovals() {
  ui.approval_list.replaceChildren();
  if (!workspace.pendingTransitions.length) return ui.approval_list.append(element("p", "empty compact", "No product transitions await independent approval."));
  for (const pending of workspace.pendingTransitions) {
    const row = element("article", "approval-row");
    const copy = element("div");
    copy.append(element("strong", "", `${name(pending.productType)} · ${actionLabel(pending.target)}`), element("small", "", `Proposed by ${pending.proposedBy} · ${pending.requestId}`));
    row.append(copy, action("Review", () => selectProduct(pending.productType)));
    ui.approval_list.append(row);
  }
}

function renderBrands() {
  ui.brand_list.replaceChildren();
  const releases = brands.workspace.releases;
  if (!releases.length) return ui.brand_list.append(element("p", "empty compact", "No governed brand release has been published. Product activation remains blocked."));
  for (const release of releases) {
    const row = element("article", "brand-row");
    row.append(element("strong", "", `${release.scope.level.replaceAll("_", " ")} · v${release.version}`), element("p", "", `${release.status} · ${release.applicableJourneyTypes.length} journeys · ${release.defaultLocale}`));
    ui.brand_list.append(row);
  }
}

async function mutate(url, body) {
  status("Saving governed change…");
  try {
    await request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await load();
  } catch (error) {
    status(error.message, true);
  }
}

function assertSchema(schema, expectedAction) { if (schema.schemaVersion !== workspace.formSchemaVersion || schema.action !== expectedAction) throw new Error("The server form contract changed. Refresh before submitting this governed action."); }
function productFor(type) { return workspace.products.find((item) => item.productType === type); }
function action(label, handler, className = "") { const button = element("button", className, label); button.type = "button"; button.addEventListener("click", handler); return button; }
function metric(text) { return element("span", "metric", text); }
function badge(text) { return element("span", "status-badge", text); }
function section(title) { const card = element("section", "contract-card"); card.append(element("h3", "", title)); return card; }
function name(value) { return String(value).replaceAll("_", " ").replaceAll(".", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function actionLabel(value) { return name(value).replace(" Proposal", ""); }
function humanBlocker(value) { return name(value).replace("Readiness:", "Evidence: ").replace("Status:", "Requires state: "); }
function element(tag, className = "", text = "") { const node = document.createElement(tag); if (className) node.className = className; if (text !== "") node.textContent = text; return node; }
function status(message, error = false) { ui.status.textContent = message; ui.status.classList.toggle("error", error); }
function describe(value) { return Object.entries(value ?? {}).map(([key, item]) => `${name(key)}: ${display(item)}`).join(" · "); }
function display(value) { if (value == null) return "—"; return Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value); }
function formatDate(value) { return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Time unavailable"; }
function localDate(value) { if (!value) return ""; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
async function request(url, options = {}) { const response = await fetch(url, { ...options, credentials: "same-origin", cache: "no-store", headers: { accept: "application/json", ...(options.headers ?? {}) } }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status})`); return body; }
function applyTheme(theme = {}) { for (const [key, variable] of Object.entries({ primaryColor: "--admin-primary", secondaryColor: "--admin-accent", surfaceColor: "--admin-surface", textColor: "--admin-text" })) { const value = theme[key]; if (/^#[0-9a-f]{6}$/i.test(value ?? "")) document.documentElement.style.setProperty(variable, value); } }
