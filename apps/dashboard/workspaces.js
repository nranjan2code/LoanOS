const ids = [
  "actor-authority", "refresh", "offline", "workspace-tabs", "view-kicker", "view-title", "view-description", "status",
  "open-count", "overdue-count", "exception-count", "unassigned-count", "queue-search", "table-caption", "queue",
  "inspector", "inspector-title", "inspector-description", "inspector-meta", "domain-action", "domain-action-description",
  "domain-action-path", "specialist-action", "action-readiness", "action-guidance", "action-requirements", "domain-action-form",
  "action-payload", "insert-skeleton", "validate-payload", "action-attestation", "submit-domain-action", "action-status",
  "task-controls", "assignment-form", "assignee", "assignment-notes", "assign-task", "start-task", "release-task",
  "release-reason", "comment-form", "task-comment", "comment-task", "case-timeline", "timeline-list", "evidence-panel",
  "evidence-list", "audit-panel", "audit-list", "inspector-status"
];
const ui = Object.fromEntries(ids.map((id) => [id.replaceAll("-", "_"), document.querySelector(`#${id}`)]));

const ACTION_CONTRACTS = Object.freeze({
  "application.compliance_exception": contract("Correct the source application or registry record; do not bypass a compliance finding.", []),
  "application.kfs_acceptance": contract("Record delivery and borrower acceptance against the issued KFS.", ["acceptance.acceptedAt", "acceptance.acceptanceEvidenceRef", "deliveryChannel", "deliveryRef"]),
  "application.credit_decision": contract("Submit a maker proposal. Referred cases also require a complete manual-underwriting override.", ["status", "reason", "manualUnderwriting.underwriterId", "manualUnderwriting.reason", "manualUnderwriting.policyReference"]),
  "application.manual_underwriting": contract("Document the human affordability judgement and its approved policy basis.", ["status", "reason", "manualUnderwriting.underwriterId", "manualUnderwriting.reason", "manualUnderwriting.policyReference", "manualUnderwriting.compensatingFactors[]"]),
  "application.ai_human_review": contract("Record an independent human outcome over the material model output.", ["outcome", "reason", "evidenceRef"]),
  "application.decision_approval": contract("The checker must be independent from the decision maker and manual underwriter.", ["outcome", "approvalRef"]),
  "application.document_packet_delivery": contract("Generate the execution packet through the exact declared action. Delivery is a separate evidence-gated owning-API operation.", ["actor"]),
  "application.disbursement": contract("Destination-account verification and fund-flow evidence remain mandatory at the owning API.", ["destinationAccount"]),
  "loan_account.recovery_assignment": contract("Assign only a registered recovery agent after borrower notice evidence exists.", ["recoveryAgentId", "recoveryAgentName", "agencyName", "assignedAt", "noticeSentAt", "noticeDeliveryRef"]),
  "loan_account.broken_ptp_follow_up": contract("Record a governed follow-up contact without coercive or unsupported disposition data.", ["contactId", "assignmentId", "channel", "disposition", "contactedAt", "evidenceRef"]),
  "loan_account.npa_review": contract("This is a read-only classification contract; review evidence in the owning control.", []),
  "legal_recovery.notice_issue": contract("Issue only an independently approved, track-specific statutory notice.", ["noticeId", "demandAmount", "documentRef", "deliveryRef", "issuedAt", "deliveredAt", "issuedBy", "approvedBy"]),
  "legal_recovery.statutory_action": contract("Record the legally permitted next event with evidence and independent approval where required.", ["eventId", "eventType", "occurredAt", "actor", "approvedBy", "evidenceRef"]),
  "legal_recovery.hearing_follow_up": contract("Record the hearing outcome or next hearing against court evidence.", ["eventId", "eventType", "occurredAt", "actor", "evidenceRef", "courtCaseNumber", "nextHearingDate"]),
  "complaint.assignment": contract("Assign to an authorised grievance officer; authenticated actor identity is server-bound.", ["assignedTo", "notes"]),
  "complaint.resolution": contract("Resolution requires a borrower-facing summary, communication reference, and closure evidence.", ["outcome", "resolutionSummary", "borrowerCommunicationRef", "closureEvidenceRef"]),
  "complaint.rbi_cms_escalation": contract("Record the RBI CMS reference and the governed reason for escalation.", ["rbiCmsRef", "reason", "notes"]),
  "data_principal.access_request": contract("Fulfil only through the owning privacy control; actor identity is bound to the session.", []),
  "data_principal.correction_request": contract("Apply or reject the exact requested correction with an attributable outcome.", ["outcome"]),
  "cic.submission": contract("Transmit the checksum-sealed UCRF batch with provider and borrower-alert evidence.", ["providerSubmissionRef", "submittedAt", "checksumSha256", "borrowerAlertEvidenceRef"]),
  "cic.rejected_record_repair": contract("Correct rejected records at source and create a separately approved resubmission.", ["records", "proposedBy", "approvedBy", "approvalRef"]),
  "cic.correction_review": contract("Verify the disputed field against source evidence before accepting or rejecting correction.", ["outcome", "reason", "sourceEvidenceRef"]),
  "ckycrr.submission": contract("Record signed CKYCRR transmission against the sealed packet checksum.", ["transportRef", "digitalSignatureRef", "submittedAt", "checksumSha256"]),
  "ckycrr.response_repair": contract("Correct source KYC data; replacement packets require independent approval.", ["borrowerId", "operation", "proposedBy", "approvedBy", "approvalRef"]),
  "ckycrr.probable_match": contract("Select the exact existing customer or record a reviewed no-match decision.", ["decision", "matchedBorrowerId", "reason", "approvalRef"]),
  "fiu.str_review": contract("Principal Officer review is confidential; never add subject-facing content.", ["outcome", "reason", "reviewEvidenceRef"]),
  "fiu.filing": contract("File only the checksum-sealed FINnet packet through the approved provider boundary.", []),
  "fiu.acknowledgement": contract("Reconcile the provider response against the exact filed checksum.", ["outcome", "responseRef", "receivedAt", "checksumSha256", "errorCode", "errorMessage"]),
  "fiu.repair": contract("Correct source data and create an independently approved replacement report.", ["reportId", "reason", "proposedBy", "approvedBy", "approvalRef"]),
  "cersai.filing": contract("Submit the authorised CERSAI packet with creditor, debtor, asset, charge, and authority evidence.", ["creditor", "debtor", "asset", "chargeCreatedAt", "authorisedBy", "authorisationRef"]),
  "cersai.response": contract("Reconcile the response, fee receipt, and certificate to the filed checksum.", ["outcome", "responseRef", "receivedBy", "checksumSha256", "payment", "certificate"]),
  "cersai.repair": contract("Repair source data through an independently approved replacement security interest.", ["proposedBy", "approvedBy", "approvalRef", "sourceCorrectionRef", "correctedSecurityInterest"]),
  "specialist_journey.action": contract("Propose the next action against the case's exact approved configuration lineage.", ["actionId", "actionType", "idempotencyKey", "payload"]),
  "specialist_journey.exception": contract("Resolve, reassign, resume, or close the exception before further business actions.", ["actionId", "actionType", "idempotencyKey", "payload"]),
  "specialist_journey.recovery": contract("Recovery actions require current authority and a case-specific evidence reference.", ["actionId", "actionType", "idempotencyKey", "payload"])
});

let active = new URLSearchParams(location.search).get("view") ?? "origination";
let workspace;
let actors = [];
let selected;
let selectedDetail;
let detailSequence = 0;
let actionBusy = false;

ui.refresh.addEventListener("click", () => void load());
ui.queue_search.addEventListener("input", renderQueue);
ui.assignment_form.addEventListener("submit", (event) => { event.preventDefault(); void assignTask(); });
ui.comment_form.addEventListener("submit", (event) => { event.preventDefault(); void commentTask(); });
ui.domain_action_form.addEventListener("submit", (event) => { event.preventDefault(); void submitDomainAction(); });
ui.insert_skeleton.addEventListener("click", insertContractSkeleton);
ui.validate_payload.addEventListener("click", validateActionPayload);
ui.action_payload.addEventListener("input", updateActionReadiness);
ui.action_attestation.addEventListener("change", updateActionReadiness);
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
  const priorId = options.keepSelection ? selected?.itemId : null;
  try {
    workspace = await request(`/operational-workspaces?view=${encodeURIComponent(active)}`);
    if (!workspace.workspaces.some((item) => item.id === active)) active = workspace.workspaces[0]?.id ?? "origination";
    selected = priorId ? workspace.items.find((item) => item.itemId === priorId) : undefined;
    selectedDetail = undefined;
    resetActionDraft();
    renderAuthority();
    renderTabs();
    renderHeading();
    renderMetrics();
    renderQueue();
    renderInspector();
    setStatus(`Loaded ${workspace.items.length} authorised work items. Browser caching and persistence are disabled.`);
    activity("workspace_refreshed");
    if (selected?.kind === "task") void loadTaskDetail(selected);
  } catch (error) {
    workspace = undefined;
    selected = undefined;
    selectedDetail = undefined;
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
      selected = undefined;
      selectedDetail = undefined;
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
  selectedDetail = undefined;
  resetActionDraft();
  detailSequence += 1;
  renderQueue();
  renderInspector();
  ui.inspector.scrollIntoView({ block: "nearest" });
  activity("work_item_opened", item.recordType);
  if (item.kind === "task") void loadTaskDetail(item);
}

async function loadTaskDetail(item) {
  const sequence = ++detailSequence;
  inspectorState("Loading authoritative task detail…");
  try {
    const detail = await request(`/workflow/tasks/${encodeURIComponent(item.itemId)}`);
    if (sequence !== detailSequence || selected?.itemId !== item.itemId) return;
    if (!sameActionContract(item.action, detail.action)) throw new Error("The task action contract changed during review. Refresh the queue before continuing.");
    selectedDetail = detail;
    renderInspector();
    inspectorState("Authoritative task detail loaded. Domain mutations remain evidence-gated.");
  } catch (error) {
    if (sequence !== detailSequence || selected?.itemId !== item.itemId) return;
    selectedDetail = null;
    renderInspector();
    inspectorState(`Specialist detail unavailable: ${error.message}`, true);
  }
}

function renderInspector() {
  ui.inspector_meta.replaceChildren();
  for (const section of [ui.domain_action, ui.specialist_action, ui.task_controls, ui.case_timeline, ui.evidence_panel, ui.audit_panel]) section.hidden = true;
  actionState("");
  inspectorState("");
  if (!selected) {
    ui.inspector_title.textContent = "Choose a work item";
    ui.inspector_description.textContent = "Select a row to review safe metadata, evidence boundaries and permitted task controls.";
    return;
  }

  ui.inspector_title.textContent = selected.title;
  ui.inspector_description.textContent = selected.description;
  const detail = selectedDetail || selected;
  const facts = [
    ["Reference", selected.itemId], ["Type", words(selected.recordType)], ["Status", words(detail.status)], ["Priority", words(selected.priority)],
    ["Queue", selected.queue ? words(selected.queue) : "Metadata record"], ["Required role", selected.requiredRole ? words(selected.requiredRole) : "Not applicable"],
    ["Owner", detail.assignedTo ? words(detail.assignedTo) : selected.owner ? words(selected.owner) : "Unassigned"], ["Due", formatDate(detail.dueAt)], ["Entity", selected.entityId ?? "—"]
  ];
  for (const [term, value] of facts) ui.inspector_meta.append(element("dt", "", term), element("dd", "", value));

  if (selected.action) {
    ui.domain_action.hidden = false;
    ui.domain_action_description.textContent = selected.action.description;
    ui.domain_action_path.textContent = `${selected.action.method} ${selected.action.path}`;
  }

  renderTimeline(detail);
  renderEvidence(detail);
  renderAudit(detail);
  if (selected.kind === "task") {
    renderTaskControls();
    renderSpecialistAction();
  }
}

function renderSpecialistAction() {
  if (!selected.action) return;
  ui.specialist_action.hidden = false;
  const action = selectedDetail?.action ?? selected.action;
  const blueprint = actionContract(selected.recordType);
  const readOnly = action.method === "GET";
  ui.action_guidance.textContent = `${blueprint.summary} ${readOnly ? "This task declares a read-only action; no request body will be sent." : "Required actor identity is resolved from the authenticated session where the API contract supports it."}`;
  ui.action_requirements.replaceChildren();
  const requirements = blueprint.fields.length ? blueprint.fields : [readOnly ? "No mutable request body" : "Consult the owning API contract for the reviewed request body"];
  for (const field of requirements) ui.action_requirements.append(element("li", "", field));
  ui.domain_action_form.hidden = readOnly;
  if (readOnly) {
    ui.action_readiness.textContent = selectedDetail ? "Read-only contract" : "Detail required";
    ui.action_readiness.className = "readiness blocked";
  }
  if (!selectedDetail) {
    ui.action_readiness.textContent = selectedDetail === null ? "Detail unavailable" : "Contract loading";
    ui.action_readiness.className = "readiness blocked";
  }
  updateActionReadiness();
}

function renderTaskControls() {
  ui.task_controls.hidden = false;
  ui.assignee.replaceChildren(option("", "Select eligible actor"));
  for (const actor of eligibleActors(selected)) ui.assignee.append(option(actor.actorId, `${actor.displayName} · ${actor.actorId}`));
  ui.assignee.value = selectedDetail?.assignedTo ?? selected.owner ?? "";
  ui.assignment_notes.value = "";
  ui.release_reason.value = "";
  ui.task_comment.value = "";
  const offline = !navigator.onLine;
  ui.assign_task.disabled = offline || !selected.taskControls?.assign;
  ui.start_task.disabled = offline || !selected.taskControls?.start;
  ui.release_task.disabled = offline || !selected.taskControls?.release;
  ui.comment_task.disabled = offline || !selected.taskControls?.comment;
}

function renderTimeline(detail) {
  ui.case_timeline.hidden = false;
  ui.timeline_list.replaceChildren();
  const points = [
    detail.openedAt && { label: "Work opened", at: detail.openedAt, note: words(detail.sourceStatus ?? selected.status) },
    detail.assignedAt && { label: "Assigned", at: detail.assignedAt, note: detail.assignedTo ? `To ${detail.assignedTo}` : "Assignment recorded" },
    detail.startedAt && { label: "Work started", at: detail.startedAt, note: detail.startedBy ? `By ${detail.startedBy}` : "Start recorded" },
    detail.updatedAt && { label: "Last task update", at: detail.updatedAt, note: words(detail.status) },
    detail.dueAt && { label: detail.sla?.breached ? "SLA breached" : "SLA due", at: detail.dueAt, note: detail.sla?.status ? words(detail.sla.status) : "Deadline" }
  ].filter(Boolean).sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  if (!points.length) return ui.timeline_list.append(emptyListItem("No case events are exposed by this metadata projection."));
  for (const point of points) {
    const item = element("li", point.label.toLowerCase().includes("breach") ? "critical" : "");
    item.append(element("strong", "", point.label), element("time", "", formatDate(point.at)), element("span", "", point.note));
    item.querySelector("time").dateTime = point.at;
    ui.timeline_list.append(item);
  }
}

function renderEvidence(detail) {
  ui.evidence_panel.hidden = false;
  ui.evidence_list.replaceChildren();
  if (selected.kind !== "task") {
    ui.evidence_list.append(emptyListItem("Record payload, documents, and evidence are intentionally withheld from this safe metadata projection."));
    return;
  }
  if (!selectedDetail) {
    ui.evidence_list.append(emptyListItem(selectedDetail === null ? "Evidence detail is unavailable; action submission is blocked." : "Loading evidence references from the authoritative task…"));
    return;
  }
  const evidence = collectEvidence(selectedDetail.context);
  for (const reference of evidence) {
    const item = element("li", "evidence-item");
    item.append(element("strong", "", words(reference.path)), element("code", "", reference.value));
    ui.evidence_list.append(item);
  }
  for (const reference of selectedDetail.regulatoryRefs ?? []) {
    const item = element("li", "evidence-item regulatory");
    item.append(element("strong", "", "Control reference"), element("code", "", String(reference)));
    ui.evidence_list.append(item);
  }
  if (!ui.evidence_list.childElementCount) ui.evidence_list.append(emptyListItem("No evidence references are exposed in this task. Consult the owning action contract before mutation."));
}

function renderAudit(detail) {
  ui.audit_panel.hidden = false;
  ui.audit_list.replaceChildren();
  if (selected.kind !== "task") {
    ui.audit_list.append(emptyListItem("Domain audit history is available only through the owning record API."));
    return;
  }
  if (!selectedDetail) {
    ui.audit_list.append(emptyListItem(selectedDetail === null ? "Task audit could not be loaded." : "Loading authenticated task history…"));
    return;
  }
  const events = Array.isArray(detail.events) ? [...detail.events].reverse() : [];
  if (!events.length) return ui.audit_list.append(emptyListItem("No assignment, start, release, or comment event has been recorded for this task."));
  for (const event of events) {
    const item = element("li", "audit-item");
    const header = element("div", "audit-event");
    header.append(element("strong", "", words(event.type)), element("time", "", formatDate(event.at)));
    header.querySelector("time").dateTime = event.at;
    item.append(header);
    item.append(element("span", "", event.actor ? `Actor: ${event.actor}` : "Authenticated actor not exposed"));
    if (event.reason) item.append(element("span", "", `Reason: ${event.reason}`));
    if (event.comment) item.append(element("span", "", `Comment: ${event.comment}`));
    ui.audit_list.append(item);
  }
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
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
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

async function submitDomainAction() {
  if (!selectedDetail?.action || actionBusy || !navigator.onLine) return actionState("Authoritative task detail and network access are required.", true);
  if (!sameActionContract(selected.action, selectedDetail.action)) return actionState("Task action contract mismatch. Refresh before continuing.", true);
  if (selectedDetail.action.method === "GET") return actionState("This action is read-only and cannot accept a request body.", true);
  if (!ui.action_attestation.checked) return actionState("Review and attest to the evidence boundary before submission.", true);
  let payload;
  try {
    payload = parseActionPayload();
  } catch (error) {
    return actionState(error.message, true);
  }
  actionBusy = true;
  updateActionReadiness();
  actionState("Submitting to the owning control…");
  try {
    await request(selectedDetail.action.path, {
      method: selectedDetail.action.method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    activity("domain_action_submitted", selected.recordType);
    setStatus("The owning API accepted the reviewed request. Reloading authoritative queue state.");
    await load({ keepSelection: true });
  } catch (error) {
    actionState(`Owning control rejected the request: ${error.message}`, true);
  } finally {
    actionBusy = false;
    updateActionReadiness();
  }
}

function validateActionPayload() {
  try {
    const payload = parseActionPayload();
    actionState(`Valid JSON object with ${Object.keys(payload).length} top-level field${Object.keys(payload).length === 1 ? "" : "s"}. Server-side evidence controls remain authoritative.`);
  } catch (error) {
    actionState(error.message, true);
  }
  updateActionReadiness();
}

function parseActionPayload() {
  if (ui.action_payload.value.length > 20000) throw new Error("Request body exceeds the 20,000-character workspace limit.");
  let payload;
  try { payload = JSON.parse(ui.action_payload.value); } catch { throw new Error("Request body must be valid JSON."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Request body must be a JSON object.");
  return payload;
}

function insertContractSkeleton() {
  if (ui.action_payload.value.trim() !== "{}" && ui.action_payload.value.trim() !== "") return actionState("Clear the current request body before inserting a skeleton.", true);
  const skeleton = {};
  for (const field of actionContract(selected?.recordType).fields) setSkeletonField(skeleton, field);
  ui.action_payload.value = JSON.stringify(skeleton, null, 2);
  actionState("Contract-key skeleton inserted. Replace every placeholder with reviewed evidence-bound values.");
  updateActionReadiness();
}

function setSkeletonField(target, field) {
  const parts = field.replace(/\[\]$/, "").split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts.at(-1)] = field.endsWith("[]") ? [] : field === "payload" || ["creditor", "debtor", "asset", "payment", "certificate", "destinationAccount", "correctedSecurityInterest"].includes(parts.at(-1)) ? {} : "";
}

function updateActionReadiness() {
  if (!selected?.action || ui.domain_action_form.hidden) return;
  const detailReady = Boolean(selectedDetail?.action);
  let payloadValid = false;
  try { parseActionPayload(); payloadValid = true; } catch {}
  const enabled = detailReady && payloadValid && navigator.onLine && ui.action_attestation.checked && !actionBusy;
  ui.submit_domain_action.disabled = !enabled;
  ui.insert_skeleton.disabled = actionBusy;
  ui.validate_payload.disabled = actionBusy;
  ui.action_payload.disabled = actionBusy;
  ui.action_attestation.disabled = actionBusy;
  ui.action_readiness.textContent = actionBusy ? "Submitting" : !navigator.onLine ? "Offline · blocked" : !detailReady ? "Detail required" : !payloadValid ? "Invalid JSON" : ui.action_attestation.checked ? "Ready for server validation" : "Review required";
  ui.action_readiness.className = `readiness ${enabled ? "ready" : "blocked"}`;
}

function resetActionDraft() {
  ui.action_payload.value = "{}";
  ui.action_attestation.checked = false;
  actionBusy = false;
  actionState("");
}

function collectEvidence(value, prefix = "context", output = [], depth = 0) {
  if (!value || typeof value !== "object" || depth > 4 || output.length >= 24) return output;
  for (const [key, child] of Object.entries(value)) {
    const path = `${prefix}.${key}`;
    if (/evidence|reference|ref$|checksum|packet|delivery/i.test(key) && ["string", "number", "boolean"].includes(typeof child)) {
      output.push({ path, value: String(child).slice(0, 240) });
    } else if (child && typeof child === "object" && !Array.isArray(child)) {
      collectEvidence(child, path, output, depth + 1);
    }
    if (output.length >= 24) break;
  }
  return output;
}

function actionContract(type) {
  return ACTION_CONTRACTS[type] ?? contract("Use the exact method and path declared by the authoritative workflow task.", []);
}

function sameActionContract(projected, detailed) {
  if (!projected || !detailed) return false;
  const method = String(detailed.method ?? "").toUpperCase();
  const path = String(detailed.path ?? "");
  return ["GET", "POST", "PUT", "PATCH"].includes(method)
    && path.startsWith("/") && !path.startsWith("//")
    && method === String(projected.method ?? "").toUpperCase()
    && path === projected.path;
}

function contract(summary, fields) { return Object.freeze({ summary, fields: Object.freeze(fields) }); }

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
  updateActionReadiness();
}

function setStatus(message, error = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle("error", error);
}

function inspectorState(message, error = false) {
  ui.inspector_status.textContent = message;
  ui.inspector_status.classList.toggle("error", error);
}

function actionState(message, error = false) {
  ui.action_status.textContent = message;
  ui.action_status.classList.toggle("error", error);
}

function emptyRow(message) { const row = document.createElement("tr"); const value = document.createElement("td"); value.colSpan = 5; value.textContent = message; row.append(value); return row; }
function emptyListItem(message) { return element("li", "empty-state", message); }
function cell(value) { const result = document.createElement("td"); if (value instanceof Node) result.append(value); else result.textContent = value ?? "—"; return result; }
function option(value, label) { const result = document.createElement("option"); result.value = value; result.textContent = label; return result; }
function element(tag, className = "", text = "") { const result = document.createElement(tag); if (className) result.className = className; if (text !== "") result.textContent = text; return result; }
function words(value) { return String(value ?? "").replaceAll("_", " ").replaceAll(".", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function safeToken(value) { return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "-"); }
function formatDate(value) { if (!value) return "—"; const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: "medium", timeStyle: String(value).includes("T") ? "short" : undefined }).format(date) : String(value); }
