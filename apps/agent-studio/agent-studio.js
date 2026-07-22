import { checkedValues, rupeesToPaise } from "/agent-studio/agent-studio-state.js";

const ids = [
  "home-link", "staff-link", "refresh", "new-assistant", "status", "status-message", "dismiss-status",
  "utility-title", "workspace-count", "role-view", "template-gallery", "template-result-count", "journey-filter",
  "agent-form", "template-id", "contract-id", "model", "instructions", "instruction-count", "action-scope",
  "simulate", "preview-content", "approval-content", "memory-mode", "memory-store-id", "workflow-select",
  "draft-template", "draft-owner", "draft-journey", "draft-actions", "overview-assistants", "overview-attention",
  "overview-resources", "overview-releases", "overview-assistant-detail", "overview-priority", "overview-installations",
  "commercial-form", "commercial-contract-id", "commercial-valid-until", "commercial-monthly-fee",
  "commercial-per-execution", "commercial-templates", "contract-actions", "budget-form", "budget-id",
  "budget-contract", "budget-paise", "budget-valid-until", "budget-actions", "budget-monitor", "installation-list",
  "approval-form", "approval-installation", "approval-role", "approval-ref", "activation-form", "activation-installation",
  "report-content", "workflow-form", "workflow-steps", "workflow-list", "add-step", "knowledge-form", "knowledge-list",
  "knowledge-stat", "memory-form", "memory-list", "memory-stat", "test-form", "test-installation", "test-list",
  "test-results", "version-form", "version-id", "version-installation", "version-test-run", "version-list",
  "release-readiness", "rollback-form", "rollback-id", "rollback-installation", "rollback-version", "rollback-reason",
  "rollback-list", "operations-queue", "queue-stat", "compare-form", "compare-from", "compare-to", "comparison-result",
  "provider-form", "provider-installation", "provider-list", "admission-list", "reference-dialog",
  "reference-dialog-form", "reference-dialog-title", "reference-dialog-description", "reference-dialog-fields"
];
const ui = Object.fromEntries(ids.map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

const tenantId = decodeURIComponent(location.pathname.match(/^\/t\/([^/]+)/)?.[1] ?? "");
const basePath = `/t/${encodeURIComponent(tenantId)}`;
const studioViews = {
  overview: {
    label: "Overview",
    title: "Make safe assistants easier to run",
    description: "See what needs attention, continue work in progress and keep every assistant inside its approved human and data boundaries."
  },
  create: {
    label: "Build",
    title: "Design an assistant around the work",
    description: "Choose an approved pattern, describe the purpose, narrow its boundaries and review the complete proposal."
  },
  knowledge: {
    label: "Resources",
    title: "Control what assistants know and remember",
    description: "Keep approved knowledge, privacy-governed memory and human-reviewed work plans distinct and current."
  },
  "test-release": {
    label: "Validate",
    title: "Test the difficult path before release",
    description: "Define expected and adverse cases, run server-derived rehearsals and publish immutable configuration versions."
  },
  operations: {
    label: "Operate",
    title: "Act on the work that needs you",
    description: "Review owned proposals, manage the assistant portfolio and contain incidents without losing evidence."
  },
  governance: {
    label: "Controls",
    title: "Keep approval and production boundaries visible",
    description: "Record independent approvals, inspect provider admission, monitor control health and enforce exact spending limits."
  }
};

let marketplace;
let workspace;
let registry;
let selectedTemplate;
let selectedCategory = "all";
let activeStudioView = normaliseStudioView(location.hash.slice(1));
let builderStep = 1;
let statusTimer;
let workflowSteps = [
  { type: "receive", label: "Receive the case" },
  { type: "prepare", label: "Prepare the draft" },
  { type: "human_review", label: "A staff member reviews it" }
];

ui.home_link.href = `${basePath}/`;
ui.staff_link.href = `${basePath}/staff/`;
ui.refresh.addEventListener("click", load);
ui.new_assistant.addEventListener("click", resetBuilder);
ui.dismiss_status.addEventListener("click", () => setStatus(""));
ui.template_gallery.addEventListener("click", handleTemplateSelection);
ui.agent_form.addEventListener("click", handleBuilderNavigation);
ui.agent_form.addEventListener("input", handleDraftInput);
ui.agent_form.addEventListener("change", handleDraftInput);
ui.agent_form.addEventListener("submit", submitInstallation);
ui.memory_mode.addEventListener("change", syncMemoryControls);
ui.commercial_form.addEventListener("submit", submitContract);
ui.budget_form.addEventListener("submit", submitBudget);
ui.budget_actions.addEventListener("click", approveBudget);
ui.contract_actions.addEventListener("click", commercialAction);
ui.approval_form.addEventListener("submit", submitApproval);
ui.activation_form.addEventListener("submit", submitActivation);
ui.installation_list.addEventListener("click", lifecycleAction);
ui.add_step.addEventListener("click", addWorkflowStep);
ui.workflow_steps.addEventListener("click", workflowStepAction);
ui.workflow_form.addEventListener("submit", submitWorkflow);
ui.knowledge_form.addEventListener("submit", submitKnowledgePack);
ui.knowledge_list.addEventListener("click", approveKnowledgePack);
ui.memory_form.addEventListener("submit", submitMemoryStore);
ui.memory_list.addEventListener("click", approveMemoryStore);
ui.test_form.addEventListener("submit", submitTestSuite);
ui.test_list.addEventListener("click", runTestSuite);
ui.version_form.addEventListener("submit", submitVersion);
ui.version_installation.addEventListener("change", renderReleaseReadiness);
ui.version_test_run.addEventListener("change", renderReleaseReadiness);
ui.rollback_form.addEventListener("submit", submitRollback);
ui.rollback_list.addEventListener("click", approveRollback);
ui.role_view.addEventListener("change", renderOperationsQueue);
ui.operations_queue.addEventListener("click", reviewProposal);
ui.provider_form.addEventListener("submit", submitProviderEvidence);
ui.provider_list.addEventListener("click", approveProviderEvidence);
ui.compare_form.addEventListener("submit", submitComparison);
ui.journey_filter.addEventListener("change", (event) => {
  selectedCategory = event.target.value;
  renderTemplates();
});
document.querySelectorAll("[data-start-mode]").forEach((button) => {
  button.addEventListener("click", () => startMode(button.dataset.startMode));
});
document.querySelectorAll("[data-builder-step-target]").forEach((button) => {
  button.addEventListener("click", () => navigateToBuilderStep(Number(button.dataset.builderStepTarget)));
});
document.getElementById("workspace-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-studio-view]");
  if (button) setStudioView(button.dataset.studioView, true);
});
document.getElementById("workspace-nav").addEventListener("keydown", navigateStudioViews);
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-navigate-view]");
  if (button) setStudioView(button.dataset.navigateView, true);
});
window.addEventListener("hashchange", () => setStudioView(location.hash.slice(1), false));

setStudioView(activeStudioView, false);
setBuilderStep(1, false);
syncMemoryControls();
void load();

async function load() {
  setStatus("Loading governed Agent Studio…");
  ui.refresh.disabled = true;
  try {
    [marketplace, workspace, registry] = await Promise.all([
      request("/ai/marketplace"),
      request("/ai/agents"),
      request("/ai/models")
    ]);
    selectedTemplate ??= marketplace.templates[0];
    render();
    setStatus("Workspace is up to date.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    ui.refresh.disabled = false;
  }
}

function render() {
  renderJourneyEntitlements();
  renderContracts();
  renderModels();
  renderCommercialTemplates();
  renderCommercialActions();
  renderBudgetActions();
  renderActivationSelectors();
  renderWorkflowCanvas();
  renderStudioAssets();
  renderOperationsQueue();
  renderProviderEvidence();
  selectTemplate(selectedTemplate.templateId, false);
  renderInstallations();
  renderOverview();
  renderWorkspaceCount();
  renderDraftSummary();
  void renderReport();
}

function normaliseStudioView(value) {
  return Object.hasOwn(studioViews, value) ? value : "overview";
}

function setStudioView(value, updateHash) {
  activeStudioView = normaliseStudioView(value);
  document.querySelectorAll("[data-studio-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.studioPanel !== activeStudioView;
  });
  document.querySelectorAll("[data-studio-view]").forEach((button) => {
    if (button.dataset.studioView === activeStudioView) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  const definition = studioViews[activeStudioView];
  const intro = document.getElementById("workspace-intro");
  intro.querySelector(".eyebrow").textContent = definition.label;
  intro.querySelector("h1").textContent = definition.title;
  intro.querySelector("p:last-child").textContent = definition.description;
  ui.utility_title.textContent = definition.label;
  renderWorkspaceCount();

  if (updateHash) {
    history.replaceState(null, "", `#${activeStudioView}`);
    document.getElementById("main").scrollIntoView({ block: "start" });
  }
}

function navigateStudioViews(event) {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const buttons = [...event.currentTarget.querySelectorAll("[data-studio-view]")];
  const current = buttons.findIndex((button) => button.dataset.studioView === activeStudioView);
  const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? buttons.length - 1
      : (current + (backwards ? -1 : 1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next].focus();
  buttons[next].click();
}

function renderWorkspaceCount() {
  if (!workspace) {
    ui.workspace_count.textContent = "Loading";
    return;
  }
  const totals = {
    overview: workspace.operationsQueue?.length ?? 0,
    create: marketplace?.templates?.length ?? 0,
    knowledge: (workspace.knowledgePacks?.length ?? 0) + (workspace.memoryStores?.length ?? 0),
    "test-release": (workspace.testSuites?.length ?? 0) + (workspace.agentVersions?.length ?? 0),
    operations: workspace.operationsQueue?.length ?? 0,
    governance: workspace.installations?.filter((item) => item.status === "pending_approval").length ?? 0
  };
  const nouns = {
    overview: "items needing attention",
    create: "approved patterns",
    knowledge: "governed resources",
    "test-release": "tests and versions",
    operations: "items needing attention",
    governance: "awaiting approval"
  };
  ui.workspace_count.textContent = `${totals[activeStudioView]} ${nouns[activeStudioView]}`;
}

function handleTemplateSelection(event) {
  const button = event.target.closest("[data-template-id]");
  if (button) selectTemplate(button.dataset.templateId);
}

function renderTemplates() {
  if (!marketplace) return;
  const visible = marketplace.templates.filter((template) => selectedCategory === "all" || template.category === selectedCategory);
  ui.template_result_count.textContent = `${visible.length} pattern${visible.length === 1 ? "" : "s"}`;
  ui.template_gallery.replaceChildren(...visible.map((template) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "template-card";
    button.dataset.templateId = template.templateId;
    button.setAttribute("aria-current", String(template.templateId === selectedTemplate?.templateId));
    button.append(
      text("strong", template.name),
      text("small", `${words(template.category)} · maximum autonomy ${template.maximumAutonomy}`),
      text("span", `${template.allowedActions.length} bounded action${template.allowedActions.length === 1 ? "" : "s"} · proposal only`)
    );
    return button;
  }));
}

function selectTemplate(templateId, announce = true) {
  const template = marketplace?.templates?.find((item) => item.templateId === templateId);
  if (!template) return;
  selectedTemplate = template;
  ui.template_id.value = template.templateId;
  renderTemplates();
  ui.action_scope.replaceChildren(...template.allowedActions.map(actionCheckbox));
  renderDraftSummary();
  if (announce) setStatus(`${template.name} selected. You can narrow its actions before review.`);
}

function actionCheckbox(action) {
  const label = document.createElement("label");
  label.className = "action-option";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = "allowedActions";
  input.value = action;
  input.checked = true;
  label.append(input, document.createTextNode(words(action)));
  return label;
}

function handleBuilderNavigation(event) {
  const next = event.target.closest("[data-builder-next]");
  const back = event.target.closest("[data-builder-back]");
  if (next) navigateToBuilderStep(builderStep + 1);
  if (back) navigateToBuilderStep(builderStep - 1);
}

function navigateToBuilderStep(step) {
  if (step === builderStep) return;
  if (step > builderStep && !validateBuilderStep(builderStep)) return;
  if (step > builderStep + 1) return;
  setBuilderStep(step, true);
}

function setBuilderStep(step, focusHeading = true) {
  builderStep = Math.max(1, Math.min(4, step));
  document.querySelectorAll("[data-builder-panel]").forEach((panel) => {
    panel.hidden = Number(panel.dataset.builderPanel) !== builderStep;
  });
  document.querySelectorAll("[data-builder-step-target]").forEach((button) => {
    if (Number(button.dataset.builderStepTarget) === builderStep) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  if (builderStep === 4) preview();
  renderDraftSummary();
  if (focusHeading) document.querySelector(`[data-builder-panel="${builderStep}"] h2`)?.focus?.({ preventScroll: true });
}

function validateBuilderStep(step) {
  if (step === 1 && !selectedTemplate) {
    setStatus("Choose an approved banking pattern before continuing.", true);
    return false;
  }
  const panel = document.querySelector(`[data-builder-panel="${step}"]`);
  const invalid = [...panel.querySelectorAll("input[required], select[required], textarea[required]")].find((field) => !field.checkValidity());
  if (!invalid) {
    if (step === 3 && !values("allowedActions").length) {
      setStatus("Keep at least one permitted preparation action.", true);
      return false;
    }
    return true;
  }
  const details = invalid.closest("details");
  if (details) details.open = true;
  invalid.reportValidity();
  setStatus("Complete the highlighted field before continuing.", true);
  return false;
}

function handleDraftInput() {
  ui.instruction_count.textContent = String(ui.instructions.value.length);
  renderDraftSummary();
  if (builderStep === 4) preview();
}

function renderDraftSummary() {
  const form = new FormData(ui.agent_form);
  ui.draft_template.textContent = selectedTemplate?.name ?? "Choose a pattern";
  ui.draft_owner.textContent = String(form.get("humanSponsorPrincipalId") || "Not assigned");
  ui.draft_journey.textContent = split(form.get("products")).map(words).join(", ") || "Not selected";
  const actionCount = values("allowedActions").length;
  ui.draft_actions.textContent = `${actionCount} action${actionCount === 1 ? "" : "s"}`;
}

function preview() {
  const form = new FormData(ui.agent_form);
  const actions = values("allowedActions");
  const content = document.createElement("div");
  content.className = "preview-grid";
  content.append(
    previewItem("Purpose", String(form.get("instructions") || "No purpose described.")),
    previewItem("Authority", "Proposal only — no credit decision, pricing, fund movement or policy change."),
    previewItem("Selected work", actions.length ? actions.map(words).join(", ") : "No action selected; the draft cannot be submitted."),
    previewItem("Journey boundary", split(form.get("products")).map(words).join(", ") || "No banking journey selected."),
    previewItem("Human handoff", selectedTemplate?.customerFacing ? "Customer-facing work carries disclosure and an accessible human handoff." : "A person reviews every material proposal before downstream action."),
    previewItem("Runtime boundary", "This review checks configuration only. It does not call a model or process borrower data.")
  );
  ui.preview_content.className = "";
  ui.preview_content.replaceChildren(content);
  renderReadiness();
}

function renderReadiness() {
  const fields = new FormData(ui.agent_form);
  const required = ["contractId", "model", "installationId", "workloadPrincipalId", "humanSponsorPrincipalId", "configurationRef", "instructions"];
  const ready = required.every((name) => fields.get(name)) && values("allowedActions").length > 0;
  const grid = document.createElement("div");
  grid.className = "readiness-grid";
  grid.append(
    readinessItem(ready, ready ? "Draft is complete" : "Draft is incomplete", ready ? "Submission creates a pending, proposal-only installation." : "Complete ownership, scope, model, plan and system identity."),
    readinessItem(false, "Four people still approve", "Owner, validator, human reviewer and model-risk manager must be distinct."),
    readinessItem(false, "Activation remains closed", "Current staffing, evidence and an isolated control-engine decision are required.")
  );
  ui.approval_content.className = "";
  ui.approval_content.replaceChildren(grid);
}

function syncMemoryControls() {
  const persistent = ui.memory_mode.value === "governed_persistent";
  ui.memory_store_id.disabled = !persistent;
  ui.memory_store_id.required = persistent;
  if (!persistent) ui.memory_store_id.value = "";
}

function resetBuilder() {
  setStudioView("create", true);
  ui.agent_form.reset();
  selectedTemplate = marketplace?.templates?.[0];
  if (selectedTemplate) selectTemplate(selectedTemplate.templateId, false);
  ui.instructions.value = "";
  ui.instruction_count.textContent = "0";
  syncMemoryControls();
  setBuilderStep(1, true);
  setStatus("New governed draft started.");
}

function startMode(mode) {
  document.querySelectorAll("[data-start-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.startMode === mode));
  });
  if (mode === "copy") {
    const source = workspace?.installations?.at(-1);
    if (!source) {
      setStatus("There is no existing assistant to copy. Start with a banking pattern instead.", true);
      return;
    }
    selectTemplate(source.templateId, false);
    ui.agent_form.elements.installationId.value = `${source.installationId}-copy`;
    ui.agent_form.elements.humanSponsorPrincipalId.value = source.humanSponsorPrincipalId;
    ui.agent_form.elements.products.value = (source.productTypes ?? []).join(", ");
    ui.agent_form.elements.languages.value = (source.languages ?? []).join(", ");
    ui.agent_form.elements.dataScopes.value = (source.dataScopes ?? []).join(", ");
    ui.instructions.value = `Adapt the approved instructions from ${source.promptRef}. Describe the new assistant's job here.`;
    ui.contract_id.value = source.contractId;
    ui.model.value = `${source.modelId}|${source.modelVersion}`;
    ui.agent_form.elements.workloadPrincipalId.value = `${source.workloadPrincipalId}-copy`;
    ui.agent_form.elements.configurationRef.value = `${source.configurationRef}-copy`;
    ui.action_scope.querySelectorAll("input").forEach((input) => {
      input.checked = source.allowedActions.includes(input.value);
    });
    setBuilderStep(2, true);
    handleDraftInput();
    setStatus("Copied into a clean draft. Approvals and activation were not copied.");
    return;
  }
  if (mode === "guided") {
    ui.agent_form.reset();
    selectedTemplate ??= marketplace?.templates?.[0];
    if (selectedTemplate) selectTemplate(selectedTemplate.templateId, false);
    ui.agent_form.elements.languages.value = "en-IN";
    syncMemoryControls();
    setBuilderStep(2, true);
    setStatus("Guided setup started. Describe the job in everyday language.");
    return;
  }
  ui.template_gallery.scrollIntoView({ behavior: "smooth", block: "nearest" });
  setStatus("Choose the approved pattern closest to your team’s work.");
}

async function submitInstallation(event) {
  event.preventDefault();
  if (!validateBuilderStep(3)) return;
  const form = new FormData(ui.agent_form);
  const [modelId, modelVersion] = String(form.get("model")).split("|");
  if (!modelId || !values("allowedActions").length) {
    setStatus("Select an active model and at least one permitted action.", true);
    return;
  }
  try {
    const instructions = String(form.get("instructions"));
    await request("/ai/agents/installations", {
      method: "POST",
      body: JSON.stringify({
        installationId: form.get("installationId"),
        templateId: selectedTemplate.templateId,
        contractId: form.get("contractId"),
        modelId,
        modelVersion,
        workloadPrincipalId: form.get("workloadPrincipalId"),
        humanSponsorPrincipalId: form.get("humanSponsorPrincipalId"),
        promptRef: `agent-studio/prompt/${form.get("installationId")}`,
        promptHash: await sha256(instructions),
        configurationRef: form.get("configurationRef"),
        allowedActions: values("allowedActions"),
        languages: split(form.get("languages")),
        productTypes: split(form.get("products")),
        dataScopes: split(form.get("dataScopes")),
        memoryMode: form.get("memoryMode"),
        memoryStoreId: form.get("memoryStoreId") || undefined,
        workflowId: form.get("workflowId") || undefined,
        knowledgeSources: parseKnowledge(form.get("knowledgeSources"))
      })
    });
    await load();
    setStudioView("operations", true);
    setStatus("Draft sent for human review. It remains proposal-only and inactive.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderJourneyEntitlements() {
  const products = workspace.enabledProductTypes ?? [];
  document.getElementById("enabled-products").replaceChildren(...products.map((item) => option(item, words(item))));
  document.getElementById("enabled-journeys").textContent = products.length
    ? `Enabled for your bank: ${products.map(words).join(", ")}.`
    : "No active banking journey is available. Creation is blocked.";
}

function renderContracts() {
  const active = workspace.pricingContracts.filter((item) => item.status === "active");
  ui.contract_id.replaceChildren(option("", active.length ? "Select an active plan" : "No active plan available"), ...active.map((item) => option(item.contractId, item.contractId)));
  ui.budget_contract.replaceChildren(option("", active.length ? "Select an active plan" : "No active plan available"), ...active.map((item) => option(item.contractId, item.contractId)));
}

function renderModels() {
  const models = Object.values(registry.models ?? {}).filter((model) => model.status === "active");
  ui.model.replaceChildren(
    option("", models.length ? "Select an active model" : "No active model available"),
    ...models.map((model) => option(`${model.modelId}|${model.version}`, `${model.modelId} · ${model.version}`))
  );
}

function renderCommercialTemplates() {
  ui.commercial_templates.replaceChildren(...marketplace.templates.map((template) => {
    const label = document.createElement("label");
    label.className = "action-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "commercialTemplates";
    input.value = template.templateId;
    label.append(input, document.createTextNode(template.name));
    return label;
  }));
}

async function submitContract(event) {
  event.preventDefault();
  const templateIds = values("commercialTemplates");
  const validUntil = new Date(ui.commercial_valid_until.value);
  if (!templateIds.length || Number.isNaN(validUntil.getTime())) {
    setStatus("Select at least one pattern and a valid plan end date.", true);
    return;
  }
  try {
    const pricing = {
      monthly_platform_fee_paise: rupeesToPaise(ui.commercial_monthly_fee.value),
      included_executions: "0",
      included_input_tokens: "0",
      included_output_tokens: "0",
      per_execution_paise: rupeesToPaise(ui.commercial_per_execution.value),
      per_1k_input_tokens_paise: "0",
      per_1k_output_tokens_paise: "0"
    };
    await request("/ai/pricing-contracts", {
      method: "POST",
      body: JSON.stringify({
        contractId: ui.commercial_contract_id.value,
        templateIds,
        pricing,
        effectiveFrom: new Date().toISOString(),
        validUntil: validUntil.toISOString()
      })
    });
    ui.commercial_form.reset();
    await load();
    setStatus("Commercial plan proposed for an independent checker.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderCommercialActions() {
  const pending = workspace.pricingContracts.filter((item) => item.status === "pending_approval");
  ui.contract_actions.replaceChildren(...pending.map((item) => {
    const row = lifecycleItem(item.contractId, "Independent commercial approval required.");
    row.append(actionButton("Approve plan", "approveContract", item.contractId));
    return row;
  }));
}

async function commercialAction(event) {
  const button = event.target.closest("[data-approve-contract]");
  if (!button) return;
  const approvalRef = await requestReference({
    title: "Approve commercial plan",
    description: "Record the independent commercial approval reference.",
    label: "Approval reference"
  });
  if (!approvalRef) return;
  try {
    await request(`/ai/pricing-contracts/${encodeURIComponent(button.dataset.approveContract)}/approve`, {
      method: "POST",
      body: JSON.stringify({ commercialApprovalRef: approvalRef })
    });
    await load();
    setStatus("Commercial plan approved for entitled installations.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function submitBudget(event) {
  event.preventDefault();
  const until = new Date(ui.budget_valid_until.value);
  if (!ui.budget_contract.value || Number.isNaN(until.getTime())) {
    setStatus("A spending limit needs an active plan and end date.", true);
    return;
  }
  try {
    await request("/ai/usage-budgets", {
      method: "POST",
      body: JSON.stringify({
        budgetId: ui.budget_id.value,
        contractId: ui.budget_contract.value,
        limits: {
          maxExecutions: "999999",
          maxInputTokens: "999999999",
          maxOutputTokens: "999999999",
          maxChargePaise: rupeesToPaise(ui.budget_paise.value)
        },
        effectiveFrom: new Date().toISOString(),
        validUntil: until.toISOString()
      })
    });
    ui.budget_form.reset();
    await load();
    setStatus("Hard spending limit proposed for independent approval.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function approveBudget(event) {
  const button = event.target.closest("[data-approve-budget]");
  if (!button) return;
  const approvalRef = await requestReference({
    title: "Approve spending limit",
    description: "Record the independent finance review reference.",
    label: "Finance approval reference"
  });
  if (!approvalRef) return;
  try {
    await request(`/ai/usage-budgets/${encodeURIComponent(button.dataset.approveBudget)}/approve`, {
      method: "POST",
      body: JSON.stringify({ commercialApprovalRef: approvalRef })
    });
    await load();
    setStatus("Spending limit approved with an exact hard ceiling.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderBudgetActions() {
  const budgets = workspace.usageBudgets ?? [];
  const pending = budgets.filter((item) => item.status === "pending_approval");
  ui.budget_actions.replaceChildren(...pending.map((item) => {
    const row = lifecycleItem(item.budgetId, `Maximum ₹${paiseToRupees(item.limits.maxChargePaise)} · independent finance approval required`);
    row.append(actionButton("Approve spending limit", "approveBudget", item.budgetId));
    return row;
  }));
  const active = budgets.filter((item) => item.status === "active");
  renderCardsOrEmpty(
    ui.budget_monitor,
    active.map((item) => previewItem(item.budgetId, `Approved ceiling ₹${paiseToRupees(item.limits.maxChargePaise)} · valid until ${formatDate(item.validUntil)}`)),
    "No approved spending limits."
  );
}

function renderActivationSelectors() {
  const pending = workspace.installations.filter((item) => item.status === "pending_approval");
  const pendingOptions = [
    option("", pending.length ? "Select a pending assistant" : "No pending assistant"),
    ...pending.map((item) => option(item.installationId, `${item.installationId} · ${Object.keys(item.approvedByRole ?? {}).length}/4 approvals`))
  ];
  ui.approval_installation.replaceChildren(...pendingOptions.map((item) => item.cloneNode(true)));
  ui.activation_installation.replaceChildren(...pendingOptions.map((item) => item.cloneNode(true)));

  const all = [option("", "Select an assistant"), ...workspace.installations.map((item) => option(item.installationId, item.installationId))];
  for (const select of [ui.test_installation, ui.compare_from, ui.compare_to, ui.version_installation, ui.rollback_installation, ui.provider_installation]) {
    select.replaceChildren(...all.map((item) => item.cloneNode(true)));
  }
  ui.version_test_run.replaceChildren(
    option("", "Select a passing rehearsal"),
    ...(workspace.testRuns ?? []).filter((item) => item.status === "passed").map((item) => option(item.runId, `${item.runId} · ${item.scorePercent}%`))
  );
  ui.rollback_version.replaceChildren(
    option("", "Select a published version"),
    ...(workspace.agentVersions ?? []).map((item) => option(item.versionId, `${item.versionId} · version ${item.versionNumber}`))
  );
  ui.memory_store_id.replaceChildren(
    option("", "Select an approved store"),
    ...(workspace.memoryStores ?? []).filter((item) => item.status === "active").map((item) => option(item.memoryStoreId, item.name))
  );
  ui.workflow_select.replaceChildren(
    option("", "Not required"),
    ...(workspace.workflowDrafts ?? []).map((item) => option(item.workflowId, `${item.name} · ${item.steps.length} steps`))
  );
  syncMemoryControls();
}

function addWorkflowStep() {
  if (workflowSteps.length >= 12) {
    setStatus("A work plan may contain at most 12 steps.", true);
    return;
  }
  workflowSteps.push({ type: "check", label: "Check information" });
  renderWorkflowCanvas();
}

function renderWorkflowCanvas() {
  ui.workflow_steps.replaceChildren(...workflowSteps.map((step, index) => {
    const card = document.createElement("article");
    card.className = "workflow-step";
    const number = text("span", String(index + 1));
    number.className = "step-number";
    const select = document.createElement("select");
    select.dataset.stepType = index;
    select.setAttribute("aria-label", `Step ${index + 1} type`);
    for (const [value, label] of [
      ["receive", "Receive a case"], ["check", "Check information"], ["prepare", "Prepare a draft"],
      ["request_information", "Request information"], ["route", "Route to a team"], ["human_review", "Human review"],
      ["notify", "Prepare a notification"], ["close", "Close the task"]
    ]) select.append(option(value, label));
    select.value = step.type;
    const input = document.createElement("input");
    input.value = step.label;
    input.dataset.stepLabel = index;
    input.setAttribute("aria-label", `Step ${index + 1} description`);
    const remove = actionButton("Remove", "removeStep", index);
    card.append(number, select, input, remove);
    return card;
  }));
  ui.workflow_steps.querySelectorAll("select,input").forEach((field) => field.addEventListener("change", updateWorkflowStep));
}

function updateWorkflowStep(event) {
  const index = Number(event.target.dataset.stepType ?? event.target.dataset.stepLabel);
  if (event.target.dataset.stepType !== undefined) workflowSteps[index].type = event.target.value;
  else workflowSteps[index].label = event.target.value;
}

function workflowStepAction(event) {
  const button = event.target.closest("[data-remove-step]");
  if (!button) return;
  if (workflowSteps.length <= 2) {
    setStatus("A work plan must retain at least two steps.", true);
    return;
  }
  workflowSteps.splice(Number(button.dataset.removeStep), 1);
  renderWorkflowCanvas();
}

async function submitWorkflow(event) {
  event.preventDefault();
  try {
    const name = document.getElementById("workflow-id").value;
    await request("/ai/agents/workflows", {
      method: "POST",
      body: JSON.stringify({
        workflowId: slug(name),
        name,
        templateId: selectedTemplate.templateId,
        productTypes: split(document.getElementById("workflow-products").value),
        steps: workflowSteps
      })
    });
    ui.workflow_form.reset();
    await load();
    setStatus("Work plan saved as a governed draft.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function submitKnowledgePack(event) {
  event.preventDefault();
  try {
    const content = document.getElementById("knowledge-content").value;
    await request("/ai/agents/knowledge-packs", {
      method: "POST",
      body: JSON.stringify({
        packId: slug(document.getElementById("knowledge-pack-id").value),
        name: document.getElementById("knowledge-pack-id").value,
        version: document.getElementById("knowledge-version").value,
        sourceRef: document.getElementById("knowledge-source-ref").value,
        validUntil: document.getElementById("knowledge-valid-until").value,
        contentHash: await sha256(content),
        memoryMode: "none"
      })
    });
    ui.knowledge_form.reset();
    await load();
    setStatus("Knowledge pack registered with a checksum and review date. Raw text was not sent.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function approveKnowledgePack(event) {
  const button = event.target.closest("[data-approve-pack]");
  if (!button) return;
  const approvalRef = await requestReference({
    title: "Approve knowledge pack",
    description: "Record the independent knowledge review reference.",
    label: "Knowledge approval reference"
  });
  if (!approvalRef) return;
  try {
    await request(`/ai/agents/knowledge-packs/${encodeURIComponent(button.dataset.approvePack)}/approve`, {
      method: "POST",
      body: JSON.stringify({ approvalRef })
    });
    await load();
    setStatus("Knowledge pack approved by an independent checker.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function submitMemoryStore(event) {
  event.preventDefault();
  const get = (id) => document.getElementById(id).value;
  try {
    const name = get("memory-store-name");
    await request("/ai/agents/memory-stores", {
      method: "POST",
      body: JSON.stringify({
        memoryStoreId: slug(name),
        name,
        purpose: get("memory-purpose"),
        allowedFields: split(get("memory-fields")),
        region: "ap-south-1",
        retentionDays: Number(get("memory-retention")),
        consentRef: get("memory-consent-ref"),
        accessPolicyRef: get("memory-access-ref"),
        correctionProcessRef: get("memory-correction-ref"),
        deletionProcessRef: get("memory-deletion-ref"),
        legalHoldPolicyRef: get("memory-hold-ref"),
        encryptionRef: get("memory-encryption-ref")
      })
    });
    ui.memory_form.reset();
    await load();
    setStatus("Memory store proposed. Persistent memory stays unavailable until privacy approval.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function approveMemoryStore(event) {
  const button = event.target.closest("[data-approve-memory]");
  if (!button) return;
  const approvalRef = await requestReference({
    title: "Approve governed memory",
    description: "Confirm the declared purpose, fields, location and retention controls.",
    label: "Privacy approval reference"
  });
  if (!approvalRef) return;
  try {
    await request(`/ai/agents/memory-stores/${encodeURIComponent(button.dataset.approveMemory)}/approve`, {
      method: "POST",
      body: JSON.stringify({ approvalRef })
    });
    await load();
    setStatus("Governed memory store approved for its declared purpose and fields.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function submitTestSuite(event) {
  event.preventDefault();
  try {
    const name = document.getElementById("test-suite-id").value;
    await request("/ai/agents/test-suites", {
      method: "POST",
      body: JSON.stringify({
        suiteId: slug(name),
        name,
        installationId: ui.test_installation.value,
        cases: [
          { caseId: "expected", kind: "expected", scenario: document.getElementById("expected-scenario").value, expectedOutcome: "proposal" },
          { caseId: "adverse", kind: "adverse", scenario: document.getElementById("adverse-scenario").value, expectedOutcome: "human_review" }
        ]
      })
    });
    ui.test_form.reset();
    await load();
    setStatus("Test set saved with expected and restrictive cases.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function runTestSuite(event) {
  const button = event.target.closest("[data-run-suite]");
  if (!button) return;
  try {
    await request(`/ai/agents/test-suites/${encodeURIComponent(button.dataset.runSuite)}/runs`, {
      method: "POST",
      body: JSON.stringify({ runId: `${button.dataset.runSuite}-${Date.now()}` })
    });
    await load();
    setStatus("Rehearsal completed by the governed server harness. It does not certify live-model quality.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function submitVersion(event) {
  event.preventDefault();
  try {
    await request("/ai/agents/versions", {
      method: "POST",
      body: JSON.stringify({
        versionId: slug(ui.version_id.value),
        installationId: ui.version_installation.value,
        testRunId: ui.version_test_run.value
      })
    });
    ui.version_form.reset();
    await load();
    setStatus("Immutable tested configuration version published. Live-provider admission remains separate.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function submitRollback(event) {
  event.preventDefault();
  try {
    await request("/ai/agents/rollbacks", {
      method: "POST",
      body: JSON.stringify({
        rollbackId: slug(ui.rollback_id.value),
        installationId: ui.rollback_installation.value,
        targetVersionId: ui.rollback_version.value,
        reason: ui.rollback_reason.value
      })
    });
    ui.rollback_form.reset();
    await load();
    setStatus("Rollback requested. A different authenticated checker must approve it.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function approveRollback(event) {
  const button = event.target.closest("[data-approve-rollback]");
  if (!button) return;
  const approvalRef = await requestReference({
    title: "Approve safe rollback",
    description: "Record the independent change or incident approval.",
    label: "Approval reference"
  });
  if (!approvalRef) return;
  try {
    await request(`/ai/agents/rollbacks/${encodeURIComponent(button.dataset.approveRollback)}/approve`, {
      method: "POST",
      body: JSON.stringify({ approvalRef })
    });
    await load();
    setStatus("Rollback completed with independent approval and retained evidence.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function submitComparison(event) {
  event.preventDefault();
  try {
    const comparison = await request("/ai/agents/compare", {
      method: "POST",
      body: JSON.stringify({ fromInstallationId: ui.compare_from.value, toInstallationId: ui.compare_to.value })
    });
    const cards = Object.entries(comparison.changes)
      .filter(([, change]) => change.changed || change.added?.length || change.removed?.length)
      .map(([key, change]) => previewItem(
        words(key),
        change.changed
          ? `${change.from || "none"} → ${change.to || "none"}`
          : `Added: ${change.added.join(", ") || "none"}; removed: ${change.removed.join(", ") || "none"}`
      ));
    renderCardsOrEmpty(ui.comparison_result, cards.length ? cards : [previewItem("No material change", "The governed fields match.")], "");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function submitApproval(event) {
  event.preventDefault();
  if (!ui.approval_installation.value || !ui.approval_ref.value.trim()) {
    setStatus("Select an assistant and enter an independent approval reference.", true);
    return;
  }
  try {
    await request(`/ai/agents/installations/${encodeURIComponent(ui.approval_installation.value)}/approvals/${encodeURIComponent(ui.approval_role.value)}`, {
      method: "POST",
      body: JSON.stringify({ approvalRef: ui.approval_ref.value.trim() })
    });
    ui.approval_form.reset();
    await load();
    setStatus("Approval recorded against the authenticated person and responsibility.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function submitActivation(event) {
  event.preventDefault();
  const form = new FormData(ui.activation_form);
  const governanceEvidence = Object.fromEntries([...form.entries()].filter(([key]) => key !== "installationId"));
  if (!ui.activation_installation.value) {
    setStatus("Select a pending assistant for activation.", true);
    return;
  }
  try {
    await request(`/ai/agents/installations/${encodeURIComponent(ui.activation_installation.value)}/activate`, {
      method: "POST",
      body: JSON.stringify({ governanceEvidence })
    });
    ui.activation_form.reset();
    await load();
    setStatus("Activation completed only because current evidence, staffing and control-engine checks allowed it.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderInstallations() {
  const installations = [...workspace.installations].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!installations.length) {
    renderEmpty(ui.installation_list, "No assistants have been created yet.");
    return;
  }
  ui.installation_list.className = "assistant-grid";
  ui.installation_list.replaceChildren(...installations.map((installation) => assistantCard(installation, true)));
}

async function lifecycleAction(event) {
  const exportButton = event.target.closest("[data-export-id]");
  if (exportButton) {
    try {
      const record = await request(`/ai/agents/installations/${encodeURIComponent(exportButton.dataset.exportId)}/export`);
      downloadJson(`${exportButton.dataset.exportId}.json`, record);
      setStatus("Configuration exported without approvals or borrower data.");
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }

  const retireButton = event.target.closest("[data-retire-id]");
  if (retireButton) {
    const reason = await requestReference({
      title: "Retire assistant",
      description: "Retirement blocks future use while preserving evidence and history.",
      label: "Reason for retirement"
    });
    if (!reason) return;
    try {
      await request(`/ai/agents/installations/${encodeURIComponent(retireButton.dataset.retireId)}/retire`, {
        method: "POST",
        body: JSON.stringify({ reason, exportRef: `agent-studio/export/${retireButton.dataset.retireId}` })
      });
      await load();
      setStatus("Assistant retired. Its evidence and history remain available.");
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }

  const suspendButton = event.target.closest("[data-suspend-id]");
  if (!suspendButton) return;
  const references = await requestReferences({
    title: "Suspend assistant now",
    description: "New execution authorization will be blocked immediately.",
    fields: [
      { name: "reason", label: "Reason for suspension" },
      { name: "incidentRef", label: "Incident reference" }
    ]
  });
  if (!references) return;
  try {
    await request(`/ai/agents/installations/${encodeURIComponent(suspendButton.dataset.suspendId)}/suspend`, {
      method: "POST",
      body: JSON.stringify(references)
    });
    await load();
    setStatus("Assistant suspended. New execution authorization is blocked.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function renderReport() {
  try {
    const report = await request("/ai/agents/governance-report");
    const metrics = report.summary ?? report;
    const entries = Object.entries(metrics).filter(([, value]) => typeof value === "number" || typeof value === "string").slice(0, 8);
    renderCardsOrEmpty(
      ui.report_content,
      entries.map(([key, value]) => previewItem(words(key), String(value))),
      "No governed activity yet."
    );
  } catch (error) {
    renderEmpty(ui.report_content, `Report unavailable: ${error.message}`);
  }
}

function roleOwnsItem(role, item) {
  if (role === "all") return true;
  const roleGroups = {
    business: ["business", "model_owner", "human_reviewer"],
    model_validator: ["model_validator"],
    compliance: ["compliance", "privacy"],
    finance: ["finance"],
    operator: ["operator", "operations"]
  };
  return (roleGroups[role] ?? [role]).includes(item.ownerRole);
}

function renderOperationsQueue() {
  if (!workspace) return;
  const records = (workspace.operationsQueue ?? []).filter((item) => roleOwnsItem(ui.role_view.value, item));
  ui.queue_stat.textContent = `${records.length} item${records.length === 1 ? "" : "s"}`;
  if (!records.length) {
    renderEmpty(ui.operations_queue, "Nothing needs attention for this view.");
    return;
  }
  ui.operations_queue.className = "lifecycle-list";
  ui.operations_queue.replaceChildren(...records.map(queueItem));
}

function queueItem(item) {
  const row = lifecycleItem(item.title, `Owner: ${words(item.ownerRole)} · due ${formatDate(item.dueAt)}`);
  row.classList.add(`queue-${item.severity}`);
  if (item.type === "proposal_review") {
    const actions = document.createElement("div");
    actions.className = "inline-actions";
    const accept = actionButton("Confirm proposal", "reviewExecution", item.resourceId, "btn-primary");
    accept.dataset.reviewDisposition = "accepted";
    const sendBack = actionButton("Return for changes", "reviewExecution", item.resourceId);
    sendBack.dataset.reviewDisposition = "returned_for_changes";
    actions.append(accept, sendBack);
    row.append(actions);
  }
  return row;
}

async function reviewProposal(event) {
  const button = event.target.closest("[data-review-execution]");
  if (!button) return;
  const reviewRef = await requestReference({
    title: button.dataset.reviewDisposition === "accepted" ? "Confirm proposal review" : "Return proposal for changes",
    description: "Your disposition and reference are append-only and attributed to you.",
    label: "Review record reference"
  });
  if (!reviewRef) return;
  try {
    await request(`/ai/agents/executions/${encodeURIComponent(button.dataset.reviewExecution)}/human-review`, {
      method: "POST",
      body: JSON.stringify({ disposition: button.dataset.reviewDisposition, reviewRef })
    });
    await load();
    setStatus("Human review recorded against the proposal’s audit trail.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function submitProviderEvidence(event) {
  event.preventDefault();
  const get = (id) => document.getElementById(id).value;
  try {
    await request("/ai/agents/provider-evidence", {
      method: "POST",
      body: JSON.stringify({
        evidenceId: get("provider-evidence-id"),
        installationId: ui.provider_installation.value,
        providerId: get("provider-id"),
        region: "ap-south-1",
        contractRef: get("provider-contract-ref"),
        securityRef: get("provider-security-ref"),
        residencyRef: get("provider-residency-ref"),
        monitoringRef: get("provider-monitoring-ref"),
        incidentExerciseRef: get("provider-incident-ref"),
        institutionUatRef: get("provider-uat-ref"),
        validUntil: get("provider-valid-until")
      })
    });
    ui.provider_form.reset();
    await load();
    setStatus("Provider evidence submitted. Production remains denied until independent approval and every gate passes.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function approveProviderEvidence(event) {
  const button = event.target.closest("[data-approve-provider]");
  if (!button) return;
  const approvalRef = await requestReference({
    title: "Approve provider evidence",
    description: "Confirm the evidence was independently reviewed and is current.",
    label: "Provider-evidence approval reference"
  });
  if (!approvalRef) return;
  try {
    await request(`/ai/agents/provider-evidence/${encodeURIComponent(button.dataset.approveProvider)}/approve`, {
      method: "POST",
      body: JSON.stringify({ approvalRef })
    });
    await load();
    setStatus("Provider evidence approved. LoanOS reassessed production admission.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderProviderEvidence() {
  const records = workspace.providerEvidence ?? [];
  if (!records.length) renderEmpty(ui.provider_list, "No provider evidence.");
  else {
    ui.provider_list.className = "lifecycle-list";
    ui.provider_list.replaceChildren(...records.map((item) => {
      const row = lifecycleItem(`${item.providerId} · ${words(item.status)}`, `India region · valid until ${formatDate(item.validUntil)}`);
      if (item.status === "pending_approval") row.append(actionButton("Approve as independent checker", "approveProvider", item.evidenceId));
      return row;
    }));
  }
  const admissions = workspace.productionAdmission ?? [];
  renderCardsOrEmpty(
    ui.admission_list,
    admissions.map((item) => readinessItem(
      item.ready,
      `${item.installationId} · ${item.ready ? "repository controls pass" : "production denied"}`,
      item.ready ? "Institution authorization is still required." : item.reasons.map(words).join(", ")
    )),
    "Production admission remains denied."
  );
}

function renderStudioAssets() {
  renderRecords(ui.workflow_list, workspace.workflowDrafts, (item) => `${item.steps.length} steps · ${item.productTypes.map(words).join(", ")}`);
  renderKnowledgePacks();
  renderMemoryStores();
  renderTestSuites();
  renderTestResults();
  renderRecords(ui.version_list, workspace.agentVersions, (item) => `Version ${item.versionNumber} · passed rehearsal ${item.testRunId}`);
  renderRollbacks();
  renderReleaseReadiness();
}

function renderKnowledgePacks() {
  const records = workspace.knowledgePacks ?? [];
  ui.knowledge_stat.textContent = `${records.length} pack${records.length === 1 ? "" : "s"}`;
  if (!records.length) {
    renderEmpty(ui.knowledge_list, "No knowledge packs yet.");
    return;
  }
  ui.knowledge_list.className = "lifecycle-list";
  ui.knowledge_list.replaceChildren(...records.map((item) => {
    const row = lifecycleItem(item.name, `Version ${item.version} · ${words(item.status)} · review by ${formatDate(item.validUntil)}`);
    if (item.status === "draft") row.append(actionButton("Approve as checker", "approvePack", item.packId));
    return row;
  }));
}

function renderMemoryStores() {
  const records = workspace.memoryStores ?? [];
  ui.memory_stat.textContent = `${records.length} store${records.length === 1 ? "" : "s"}`;
  if (!records.length) {
    renderEmpty(ui.memory_list, "No governed memory stores.");
    return;
  }
  ui.memory_list.className = "lifecycle-list";
  ui.memory_list.replaceChildren(...records.map((item) => {
    const row = lifecycleItem(item.name, `${words(item.status)} · ${item.retentionDays} days · ${item.allowedFields.join(", ")} · India region`);
    if (item.status === "pending_approval") row.append(actionButton("Approve as privacy checker", "approveMemory", item.memoryStoreId));
    return row;
  }));
}

function renderTestSuites() {
  const suites = workspace.testSuites ?? [];
  if (!suites.length) {
    renderEmpty(ui.test_list, "No test sets yet.");
    return;
  }
  ui.test_list.className = "lifecycle-list";
  ui.test_list.replaceChildren(...suites.map((suite) => {
    const row = lifecycleItem(suite.name, `${suite.caseCount} cases · includes restrictive-path testing`);
    row.append(actionButton("Run rehearsal", "runSuite", suite.suiteId));
    return row;
  }));
}

function renderTestResults() {
  const runs = workspace.testRuns ?? [];
  renderCardsOrEmpty(
    ui.test_results,
    runs.slice(-4).map((run) => previewItem(
      `${run.status === "passed" ? "Passed" : "Needs attention"} · ${run.scorePercent}%`,
      `${run.passedCount}/${run.caseCount} cases · restrictive path ${run.adversePassed ? "passed" : "failed"} · synthetic rehearsal`
    )),
    "No rehearsal results yet."
  );
}

function renderRollbacks() {
  const records = workspace.rollbackRequests ?? [];
  if (!records.length) {
    renderEmpty(ui.rollback_list, "No rollback requests.");
    return;
  }
  ui.rollback_list.className = "lifecycle-list";
  ui.rollback_list.replaceChildren(...records.map((record) => {
    const row = lifecycleItem(record.rollbackId, `${record.targetVersionId} · ${words(record.status)} · ${record.reason}`);
    if (record.status === "pending_approval") row.append(actionButton("Approve as independent checker", "approveRollback", record.rollbackId));
    return row;
  }));
}

function renderReleaseReadiness() {
  if (!workspace) return;
  const installation = workspace.installations.find((item) => item.installationId === ui.version_installation.value);
  const run = (workspace.testRuns ?? []).find((item) => item.runId === ui.version_test_run.value);
  const approvalCount = Object.keys(installation?.approvedByRole ?? {}).length;
  const cards = [
    readinessItem(Boolean(run?.status === "passed"), run?.status === "passed" ? "Rehearsal passed" : "Passing rehearsal needed", run ? `${run.scorePercent}% · restrictive path ${run.adversePassed ? "passed" : "failed"}` : "Run expected and difficult cases."),
    readinessItem(approvalCount === 4, `${approvalCount}/4 human approvals`, "Owner, validator, reviewer and risk manager must be independent."),
    readinessItem(false, "Live provider remains separate", "Publishing versions configuration; it does not certify or admit a provider.")
  ];
  ui.release_readiness.className = "readiness-grid";
  ui.release_readiness.replaceChildren(...cards);
}

function renderOverview() {
  const installations = workspace.installations ?? [];
  const active = installations.filter((item) => item.status === "active").length;
  const queue = workspace.operationsQueue ?? [];
  const resources = (workspace.knowledgePacks?.length ?? 0) + (workspace.memoryStores?.length ?? 0);
  const releases = workspace.agentVersions?.length ?? 0;
  ui.overview_assistants.textContent = String(installations.length);
  ui.overview_attention.textContent = String(queue.length);
  ui.overview_resources.textContent = String(resources);
  ui.overview_releases.textContent = String(releases);
  ui.overview_assistant_detail.textContent = `${active} active · ${installations.length - active} draft, held or retired`;

  if (!queue.length) renderEmpty(ui.overview_priority, "No urgent work. New review items will appear here.");
  else {
    ui.overview_priority.className = "lifecycle-list";
    ui.overview_priority.replaceChildren(...queue.slice(0, 3).map(queueItem));
  }

  if (!installations.length) renderEmpty(ui.overview_installations, "No assistants yet. Build the first one from an approved banking pattern.");
  else {
    ui.overview_installations.className = "assistant-grid";
    ui.overview_installations.replaceChildren(...installations.slice(-3).reverse().map((item) => assistantCard(item, false)));
  }
}

function assistantCard(installation, withActions) {
  const item = document.createElement("article");
  item.className = "assistant-card";
  const status = text("span", words(installation.status));
  status.className = "assistant-status";
  const approvals = Object.keys(installation.approvedByRole ?? {}).length;
  const progress = document.createElement("div");
  progress.className = "approval-progress";
  const progressFill = document.createElement("span");
  progressFill.style.width = `${Math.min(approvals, 4) * 25}%`;
  progress.append(progressFill);
  item.append(
    status,
    text("strong", installation.installationId),
    text("span", `${words(installation.templateId)} · ${approvals}/4 approvals`),
    text("small", `${installation.allowedActions?.length ?? 0} bounded actions · model ${installation.modelId} ${installation.modelVersion}`),
    progress
  );
  if (withActions) {
    const actions = document.createElement("div");
    actions.className = "inline-actions";
    actions.append(actionButton("Export setup", "exportId", installation.installationId));
    if (installation.status === "active") actions.append(actionButton("Suspend", "suspendId", installation.installationId, "btn-danger"));
    if (installation.status !== "retired") actions.append(actionButton("Retire", "retireId", installation.installationId));
    item.append(actions);
  }
  return item;
}

function renderRecords(container, records = [], detail) {
  if (!records.length) {
    renderEmpty(container, "Nothing recorded yet.");
    return;
  }
  container.className = "lifecycle-list";
  container.replaceChildren(...records.map((item) => lifecycleItem(item.name, detail(item))));
}

function renderCardsOrEmpty(container, cards, message) {
  if (!cards.length) {
    renderEmpty(container, message);
    return;
  }
  container.className = container.id === "admission-list" || container.id === "release-readiness" ? "readiness-grid" : "preview-grid";
  container.replaceChildren(...cards);
}

function renderEmpty(container, message) {
  const layout = container.classList.contains("assistant-grid")
    ? "assistant-grid"
    : container.classList.contains("readiness-grid")
      ? "readiness-grid"
      : container.classList.contains("preview-grid")
        ? "preview-grid"
        : "lifecycle-list";
  container.className = `${layout} empty-state`;
  const mark = text("span", "◇");
  mark.className = "empty-mark";
  const copy = document.createElement("div");
  copy.append(text("strong", message));
  container.replaceChildren(mark, copy);
}

function lifecycleItem(title, detail) {
  const row = document.createElement("article");
  row.className = "lifecycle-item";
  row.append(text("strong", title), text("small", detail));
  return row;
}

function actionButton(label, dataName, value, variant = "btn-secondary") {
  const button = text("button", label);
  button.type = "button";
  button.className = `btn ${variant} btn-sm`;
  button.dataset[dataName] = String(value);
  return button;
}

async function requestReference({ title, description, label }) {
  const valuesByName = await requestReferences({
    title,
    description,
    fields: [{ name: "reference", label }]
  });
  return valuesByName?.reference ?? null;
}

function requestReferences({ title, description, fields }) {
  if (typeof ui.reference_dialog.showModal !== "function") {
    setStatus("This browser cannot open the required review dialog.", true);
    return Promise.resolve(null);
  }
  ui.reference_dialog_title.textContent = title;
  ui.reference_dialog_description.textContent = description;
  ui.reference_dialog_fields.replaceChildren(...fields.map((field) => {
    const label = document.createElement("label");
    label.textContent = field.label;
    const input = document.createElement("input");
    input.name = field.name;
    input.required = true;
    input.autocomplete = "off";
    label.append(input);
    return label;
  }));
  ui.reference_dialog.returnValue = "";
  ui.reference_dialog.showModal();
  ui.reference_dialog_fields.querySelector("input")?.focus();
  return new Promise((resolve) => {
    ui.reference_dialog.addEventListener("close", () => {
      if (ui.reference_dialog.returnValue !== "confirm") {
        resolve(null);
        return;
      }
      const data = new FormData(ui.reference_dialog_form);
      resolve(Object.fromEntries(fields.map((field) => [field.name, String(data.get(field.name)).trim()])));
    }, { once: true });
  });
}

function parseKnowledge(value) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [ref, version, contentHash] = line.split("|").map((part) => part.trim());
    if (!ref || !version || !/^[a-f0-9]{64}$/i.test(contentHash ?? "")) {
      throw new Error("Each knowledge source must be reference | version | 64-character SHA-256.");
    }
    return { ref, version, contentHash };
  });
}

function values(name) {
  return checkedValues(name === "commercialTemplates" ? ui.commercial_form : ui.agent_form, name);
}

function split(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function slug(value) {
  return String(value).trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}

function words(value) {
  return String(value ?? "").replaceAll(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "not available";
}

function paiseToRupees(value) {
  const paise = BigInt(value ?? "0");
  return (paise / 100n).toLocaleString("en-IN") + (paise % 100n ? `.${(paise % 100n).toString().padStart(2, "0")}` : "");
}

function downloadJson(name, value) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function previewItem(title, detail) {
  const item = document.createElement("article");
  item.className = "preview-item";
  item.append(text("strong", title), text("span", detail));
  return item;
}

function readinessItem(good, title, detail) {
  const item = document.createElement("article");
  item.className = `readiness-item ${good ? "good" : "warn"}`;
  item.append(text("strong", title), text("span", detail));
  return item;
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function text(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function request(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? `The requested agent operation was blocked (${response.status}).`);
  return body;
}

function setStatus(message, error = false) {
  clearTimeout(statusTimer);
  ui.status_message.textContent = message;
  ui.status.classList.toggle("error", error);
  ui.status.classList.toggle("is-visible", Boolean(message));
  if (message && !error) statusTimer = setTimeout(() => ui.status.classList.remove("is-visible"), 4000);
}
