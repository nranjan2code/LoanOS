const ui = Object.fromEntries(["brand-home", "brand-mark", "brand-name", "footer-home", "refresh", "network-warning", "status", "catalogue", "draft-list"].map((id) => [id.replaceAll("-", "_"), document.querySelector(`#${id}`)]));
const tenantId = decodeURIComponent(location.pathname.match(/^\/t\/([^/]+)/)?.[1] ?? "");
const tenantBase = `/t/${encodeURIComponent(tenantId)}`;
const workspace = `${tenantBase}/portal/journeys`;

ui.brand_home.href = `${tenantBase}/portal/`;
ui.footer_home.href = `${tenantBase}/`;
ui.refresh.addEventListener("click", () => void load());
addEventListener("online", networkState);
addEventListener("offline", networkState);
networkState();
void load();

async function load() {
  state("Loading your authorised journeys…");
  try {
    const [brand, catalogue, drafts] = await Promise.all([
      loadBrandExperience(),
      request("/journey-workspaces/borrower/catalogue"),
      request("/journey-workspaces/borrower/drafts")
    ]);
    renderBrand(brand.experience);
    renderCatalogue(catalogue.catalogue?.journeys ?? []);
    renderDrafts(drafts.drafts ?? []);
    state("Application information is current.");
  } catch (error) { state(error.message, true); }
}

async function loadBrandExperience() {
  try {
    return await request(`/brand-experience?channel=borrower&locale=${encodeURIComponent(document.documentElement.lang)}`);
  } catch {
    const identity = await request(`${tenantBase}/branding`);
    const name = identity.regulatedEntity?.name || identity.name || "Customer applications";
    return { experience: { theme: { brandName: name }, legalIdentity: { regulatedEntityName: name } } };
  }
}

function renderBrand(experience) {
  const name = experience?.theme?.brandName || experience?.legalIdentity?.regulatedEntityName;
  ui.brand_name.textContent = name || "Brand configuration required";
  ui.brand_mark.textContent = name?.slice(0, 1).toUpperCase() || "";
  ui.brand_mark.hidden = !name;
  if (name) document.title = `${name} · Customer applications`;
  applyTheme(experience?.theme);
}

function renderCatalogue(journeys) {
  ui.catalogue.replaceChildren();
  if (!journeys.length) return ui.catalogue.append(message("No applications are currently available for your account."));
  for (const journey of journeys) {
    const card = element("article", "card");
    const link = element("a", "button", "Start securely");
    link.href = `${workspace}?journey=${encodeURIComponent(journey.journeyType)}`;
    card.append(element("p", "eyebrow", words(journey.archetype)), element("h3", "", words(journey.journeyType)), element("p", "", `${fieldCount(journey)} authorised fields · ${(journey.documents ?? []).length} evidence requirements`), link);
    ui.catalogue.append(card);
  }
}

function renderDrafts(drafts) {
  ui.draft_list.replaceChildren();
  if (!drafts.length) return ui.draft_list.append(message("You have no server-held application drafts or statuses."));
  for (const draft of [...drafts].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))) {
    const row = element("article", "row");
    const copy = element("div");
    copy.append(element("h3", "", words(draft.journeyType)), element("p", "", `Recorded status: ${words(draft.status)} · Updated ${date(draft.updatedAt)}`));
    const link = element("a", "button secondary", draft.status === "draft" ? "Continue draft" : "Review application");
    link.href = `${workspace}?journey=${encodeURIComponent(draft.journeyType)}&draft=${encodeURIComponent(draft.draftId)}`;
    row.append(copy, link); ui.draft_list.append(row);
  }
}

async function request(url) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw new Error("Please sign in through your lender’s customer portal to continue.");
  if (!response.ok) throw new Error("We could not load your applications. Please try again or return to your lender home.");
  return body;
}
function networkState() { ui.network_warning.hidden = navigator.onLine; }
function state(value, error = false) { ui.status.textContent = value; ui.status.classList.toggle("error", error); }
function fieldCount(item) { return (item.sections ?? []).reduce((sum, section) => sum + (section.fields?.length ?? 0), 0); }
function words(value) { return String(value ?? "").split("_").map((part) => part.toLowerCase() === "msme" ? "MSME" : part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
function date(value) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: "medium", timeStyle: "short" }).format(parsed) : "not available"; }
function message(value) { return element("p", "empty", value); }
function element(tag, className = "", value = "") { const node = document.createElement(tag); if (className) node.className = className; if (value) node.textContent = value; return node; }
function applyTheme(theme) { const tokens = { primary: "--brand", primaryStrong: "--brand-strong", accent: "--accent", canvas: "--canvas", surface: "--surface", text: "--ink" }; for (const [key, property] of Object.entries(tokens)) { const value = theme?.[key]; if (typeof value === "string" && /^(#[0-9a-f]{3,8}|rgb\([0-9 ,.]+\)|hsl\([0-9 ,.%-]+\))$/i.test(value)) document.documentElement.style.setProperty(property, value); } }
