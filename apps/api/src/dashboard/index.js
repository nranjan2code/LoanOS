// ═══════════════════════════════════════════════════════════════════════════
// LoanOS India — Loan Officer Workspace  ·  Dashboard v2
// ═══════════════════════════════════════════════════════════════════════════

// ─── State Management ───────────────────────────────────────────────────────
let apiState = {
  apiKey: '',
  actors: [],
  currentActorId: '',
  simulationDate: '',
  tasks: [],
  selectedTaskId: null,
  activeQueue: 'all',
  statusFilter: '',
  connected: false,
  autoRefreshEnabled: true,
  autoRefreshInterval: null,
  lastRefreshTime: null
};

// ─── DOM Cache ──────────────────────────────────────────────────────────────
const dom = {
  apiKeyInput: document.getElementById('config-api-key'),
  actorSelect: document.getElementById('current-actor-select'),
  timeAsOfInput: document.getElementById('time-as-of'),
  btnRefresh: document.getElementById('btn-refresh'),
  
  // Connection status
  statusDot: document.getElementById('status-dot'),
  statusLabel: document.getElementById('status-label'),
  
  // Metrics
  metricTotal: document.getElementById('metric-total').querySelector('.metric-val'),
  metricBreached: document.getElementById('metric-breached').querySelector('.metric-val'),
  metricDueSoon: document.getElementById('metric-due-soon').querySelector('.metric-val'),
  metricAssigned: document.getElementById('metric-assigned').querySelector('.metric-val'),
  
  // Queue items
  queueList: document.getElementById('queue-list'),
  filterStatus: document.getElementById('filter-status'),
  taskSearch: document.getElementById('task-search'),
  tasksGrid: document.getElementById('tasks-grid-list'),
  tasksEmptyState: document.getElementById('tasks-empty-state'),
  tasksSkeleton: document.getElementById('tasks-skeleton'),
  
  // Details pane
  detailContainer: document.getElementById('task-detail-container'),
  detailEmptyState: document.getElementById('detail-empty-state'),
  detailContent: document.getElementById('task-details-content'),
  
  detailPriority: document.getElementById('detail-priority'),
  detailTitle: document.getElementById('detail-title'),
  detailDescription: document.getElementById('detail-description'),
  detailTaskId: document.getElementById('detail-task-id'),
  detailRole: document.getElementById('detail-role'),
  detailSlaStatus: document.getElementById('detail-sla-status'),
  detailDueAt: document.getElementById('detail-due-at'),
  detailRegulatoryBox: document.getElementById('detail-regulatory-box'),
  detailRegulatoryTags: document.getElementById('detail-regulatory-tags'),
  
  // Detail Operations
  opAssignToSelect: document.getElementById('op-assign-to-select'),
  btnOpAssign: document.getElementById('btn-op-assign'),
  btnOpStart: document.getElementById('btn-op-start'),
  btnOpRelease: document.getElementById('btn-op-release'),
  opCommentText: document.getElementById('op-comment-text'),
  btnOpComment: document.getElementById('btn-op-comment'),
  
  // Forms & Timelines
  resolutionContainer: document.getElementById('resolution-forms-container'),
  timelineContainer: document.getElementById('detail-timeline-events'),
  contextJson: document.getElementById('detail-context-json'),
  
  // Footer
  footerRefreshTime: document.getElementById('footer-refresh-time'),
  footerTaskCount: document.getElementById('footer-task-count'),
  footerTenantLabel: document.getElementById('footer-tenant-label'),
  
  // Dialogs
  dialogRelease: document.getElementById('dialog-release'),
  dialogDelivery: document.getElementById('dialog-delivery'),
  dialogDecline: document.getElementById('dialog-decline'),
  
  toastContainer: document.getElementById('toast-container')
};

// ─── Init ───────────────────────────────────────────────────────────────────
function initConfig() {
  apiState.apiKey = localStorage.getItem('loanos_api_key') || '';
  apiState.currentActorId = localStorage.getItem('loanos_actor_id') || '';
  
  // Default simulation date to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  apiState.simulationDate = now.toISOString().slice(0, 16);
  
  dom.apiKeyInput.value = apiState.apiKey;
  dom.timeAsOfInput.value = apiState.simulationDate;
  
  updateConnectionStatus(false);
  
  if (apiState.apiKey) {
    onApiKeyChange();
  }
  
  // Start auto-refresh
  startAutoRefresh();
}

// ─── Connection Status ──────────────────────────────────────────────────────
function updateConnectionStatus(connected, tenantLabel) {
  apiState.connected = connected;
  dom.statusDot.className = `status-dot ${connected ? 'connected' : (apiState.apiKey ? 'disconnected' : '')}`;
  dom.statusLabel.textContent = connected ? 'Connected' : (apiState.apiKey ? 'Error' : 'No Key');
  if (tenantLabel) {
    dom.footerTenantLabel.textContent = tenantLabel;
  }
}

// ─── Toast Notifications ────────────────────────────────────────────────────
const MAX_TOASTS = 4;

function showToast(message, type = 'info') {
  // Limit visible toasts
  const toasts = dom.toastContainer.querySelectorAll('.toast:not(.toast-exit)');
  if (toasts.length >= MAX_TOASTS) {
    dismissToast(toasts[toasts.length - 1]);
  }
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  if (type === 'warning') icon = '⚠️';
  
  toast.innerHTML = `
    <span aria-hidden="true">${icon}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-dismiss" aria-label="Dismiss notification">×</button>
    <div class="toast-progress"></div>
  `;
  
  // Dismiss button
  toast.querySelector('.toast-dismiss').addEventListener('click', () => dismissToast(toast));
  
  dom.toastContainer.appendChild(toast);
  
  // Auto-dismiss after 4s
  setTimeout(() => dismissToast(toast), 4000);
}

function dismissToast(toast) {
  if (!toast || toast.classList.contains('toast-exit')) return;
  toast.classList.add('toast-exit');
  setTimeout(() => toast.remove(), 300);
}

// ─── Animated Counter ───────────────────────────────────────────────────────
function animateCounter(element, targetValue) {
  const current = parseInt(element.textContent) || 0;
  if (current === targetValue) return;
  
  const duration = 500;
  const start = performance.now();
  
  function step(timestamp) {
    const elapsed = timestamp - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(current + (targetValue - current) * eased);
    element.textContent = value;
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }
  
  requestAnimationFrame(step);
}

// ─── Auto-Refresh ───────────────────────────────────────────────────────────
function startAutoRefresh() {
  if (apiState.autoRefreshInterval) clearInterval(apiState.autoRefreshInterval);
  if (!apiState.autoRefreshEnabled) return;
  
  apiState.autoRefreshInterval = setInterval(() => {
    if (apiState.apiKey && apiState.connected) {
      loadTasks(true); // silent refresh
    }
  }, 30000);
}

// ─── Fetch Helper ───────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(apiState.apiKey ? { 'x-api-key': apiState.apiKey } : {})
  };
  
  const response = await fetch(path, {
    ...options,
    headers: {
      ...headers,
      ...options.headers
    }
  });
  
  if (!response.ok) {
    let errorMsg = `HTTP Error ${response.status}`;
    try {
      const errBody = await response.json();
      if (errBody?.error?.message) {
        errorMsg = errBody.error.message;
      }
      if (errBody?.findings?.length) {
        errorMsg += ` (${errBody.findings.map(f => f.message).join(', ')})`;
      }
    } catch (_) {}
    throw new Error(errorMsg);
  }
  
  if (response.status === 204) return null;
  return response.json();
}

// ─── API Key Changed ────────────────────────────────────────────────────────
async function onApiKeyChange() {
  apiState.apiKey = dom.apiKeyInput.value.trim();
  localStorage.setItem('loanos_api_key', apiState.apiKey);
  
  if (!apiState.apiKey) {
    dom.actorSelect.innerHTML = '<option value="">— Set API Key First —</option>';
    updateConnectionStatus(false);
    return;
  }
  
  try {
    const res = await apiFetch('/staff/actors');
    apiState.actors = res.actors || [];
    updateConnectionStatus(true, 'Tenant: dev');
    
    // Populate actor select
    dom.actorSelect.innerHTML = '';
    
    if (apiState.actors.length === 0) {
      dom.actorSelect.innerHTML = '<option value="seed">Seeding needed (Click Refresh to Seed)</option>';
      await seedDefaultActors();
      return;
    }
    
    apiState.actors.forEach(actor => {
      const opt = document.createElement('option');
      opt.value = actor.actorId;
      opt.textContent = `${actor.displayName} (${actor.roles.join(', ')})`;
      if (actor.actorId === apiState.currentActorId) {
        opt.selected = true;
      }
      dom.actorSelect.appendChild(opt);
    });
    
    if (!apiState.currentActorId && apiState.actors.length > 0) {
      apiState.currentActorId = apiState.actors[0].actorId;
      localStorage.setItem('loanos_actor_id', apiState.currentActorId);
    }
    
    showToast('Connected and loaded staff actors.', 'success');
    loadTasks();
  } catch (err) {
    updateConnectionStatus(false);
    showToast(`Failed to connect: ${err.message}`, 'error');
  }
}

// ─── Seed Default Actors ────────────────────────────────────────────────────
async function seedDefaultActors() {
  const defaults = [
    { actorId: 'loan_officer_1', displayName: 'Loan Officer Alpha', roles: ['loan_officer'], queues: ['loan_ops'] },
    { actorId: 'credit_officer_1', displayName: 'Credit Officer Beta', roles: ['credit_officer'], queues: ['credit_ops'] },
    { actorId: 'credit_checker_1', displayName: 'Checker Gamma', roles: ['credit_checker'], queues: ['credit_checker'] },
    { actorId: 'disbursement_maker_1', displayName: 'Disbursement Maker Delta', roles: ['disbursement_maker'], queues: ['disbursement_ops'] },
    { actorId: 'collections_manager_1', displayName: 'Collections Manager Epsilon', roles: ['collections_manager'], queues: ['collections_ops'] },
    { actorId: 'grievance_officer_1', displayName: 'Grievance Officer Zeta', roles: ['grievance_officer'], queues: ['grievance_ops'] },
    { actorId: 'compliance_analyst_1', displayName: 'Compliance Analyst Eta', roles: ['compliance_analyst'], queues: ['compliance_ops'] },
    { actorId: 'human_reviewer_1', displayName: 'Human Reviewer Theta', roles: ['human_reviewer'], queues: ['model_risk'] }
  ];
  
  showToast('Seeding test staff actors…', 'info');
  try {
    for (const actor of defaults) {
      await apiFetch('/staff/actors', {
        method: 'POST',
        body: JSON.stringify(actor)
      });
    }
    showToast('Seeded staff actors successfully!', 'success');
    onApiKeyChange();
  } catch (err) {
    showToast(`Seeding failed: ${err.message}`, 'error');
  }
}

// ─── Load Tasks ─────────────────────────────────────────────────────────────
async function loadTasks(silent = false) {
  if (!apiState.apiKey) {
    if (!silent) showToast('Provide a Tenant API Key first.', 'info');
    return;
  }
  
  // Show skeleton
  if (!silent) {
    dom.tasksSkeleton.classList.remove('hidden');
    dom.tasksEmptyState.classList.add('hidden');
    dom.tasksGrid.innerHTML = '';
  }
  
  try {
    const asOfStr = apiState.simulationDate ? `?asOf=${encodeURIComponent(new Date(apiState.simulationDate).toISOString())}` : '';
    const res = await apiFetch(`/workflow/tasks${asOfStr}`);
    apiState.tasks = res.tasks || [];
    
    apiState.lastRefreshTime = new Date();
    updateConnectionStatus(true);
    
    updateMetrics();
    renderSidebarCounts();
    renderTasksList();
    updateFooter();
    
    if (apiState.selectedTaskId) {
      const updated = apiState.tasks.find(t => t.taskId === apiState.selectedTaskId);
      if (updated) {
        selectTask(updated);
      } else {
        closeDetails();
      }
    }
  } catch (err) {
    if (!silent) showToast(`Load tasks failed: ${err.message}`, 'error');
    updateConnectionStatus(false);
  } finally {
    dom.tasksSkeleton.classList.add('hidden');
  }
}

// ─── Metrics ────────────────────────────────────────────────────────────────
function updateMetrics() {
  const total = apiState.tasks.length;
  const breached = apiState.tasks.filter(t => t.slaStatus === 'breached').length;
  const dueSoon = apiState.tasks.filter(t => t.slaStatus === 'due_soon').length;
  const assigned = apiState.tasks.filter(t => t.status === 'assigned' || t.status === 'in_progress').length;
  
  animateCounter(dom.metricTotal, total);
  animateCounter(dom.metricBreached, breached);
  animateCounter(dom.metricDueSoon, dueSoon);
  animateCounter(dom.metricAssigned, assigned);
}

// ─── Sidebar Counts ─────────────────────────────────────────────────────────
function renderSidebarCounts() {
  const queues = ['compliance_ops', 'loan_ops', 'credit_ops', 'credit_checker', 'disbursement_ops', 'collections_ops', 'risk_ops', 'grievance_ops', 'model_risk'];
  
  const allCount = apiState.tasks.length;
  const allBadge = document.getElementById('count-all');
  allBadge.textContent = allCount;
  allBadge.classList.toggle('zero', allCount === 0);
  
  queues.forEach(q => {
    const count = apiState.tasks.filter(t => t.queue === q).length;
    const elem = document.getElementById(`count-${q}`);
    if (elem) {
      elem.textContent = count;
      elem.classList.toggle('zero', count === 0);
    }
  });
}

// ─── Footer ─────────────────────────────────────────────────────────────────
function updateFooter() {
  if (apiState.lastRefreshTime) {
    dom.footerRefreshTime.textContent = `Last refreshed: ${apiState.lastRefreshTime.toLocaleTimeString()}`;
  }
  dom.footerTaskCount.textContent = `${apiState.tasks.length} task${apiState.tasks.length !== 1 ? 's' : ''}`;
}

// ─── Task Helpers ───────────────────────────────────────────────────────────
function getPriorityLabel(priority) {
  return priority || 'medium';
}

function getSlaLabel(slaStatus) {
  if (slaStatus === 'breached') return 'Breached';
  if (slaStatus === 'due_soon') return 'Due Soon';
  return 'Within SLA';
}

// ─── Render Task List ───────────────────────────────────────────────────────
function renderTasksList() {
  dom.tasksGrid.innerHTML = '';
  
  // Apply filtering
  const filtered = apiState.tasks.filter(task => {
    if (apiState.activeQueue !== 'all' && task.queue !== apiState.activeQueue) return false;
    if (apiState.statusFilter && task.status !== apiState.statusFilter) return false;
    
    const query = dom.taskSearch.value.trim().toLowerCase();
    if (query) {
      const matchId = task.taskId.toLowerCase().includes(query);
      const matchTitle = task.title.toLowerCase().includes(query);
      const matchDesc = task.description.toLowerCase().includes(query);
      const matchEntity = task.entity?.id?.toLowerCase().includes(query) || '';
      return matchId || matchTitle || matchDesc || matchEntity;
    }
    
    return true;
  });
  
  if (filtered.length === 0) {
    dom.tasksEmptyState.classList.remove('hidden');
    return;
  }
  
  dom.tasksEmptyState.classList.add('hidden');
  
  filtered.forEach((task, index) => {
    const card = document.createElement('div');
    card.className = `task-card animate-in ${apiState.selectedTaskId === task.taskId ? 'active' : ''}`;
    card.dataset.id = task.taskId;
    card.dataset.type = task.type || '';
    card.style.animationDelay = `${index * 40}ms`;
    
    const formattedDate = new Date(task.openedAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const assignedLabel = task.assignedTo ? `Assigned: ${task.assignedTo}` : 'Open Queue';
    
    card.innerHTML = `
      <div class="task-card-header">
        <span class="task-card-title">${task.title}</span>
        <span class="sla-badge ${task.slaStatus}">${getSlaLabel(task.slaStatus)}</span>
      </div>
      <div class="task-card-body">${task.description}</div>
      <div class="task-card-footer">
        <div class="task-meta-left">
          <span class="priority-marker ${task.priority}">${getPriorityLabel(task.priority)}</span>
          <span>·</span>
          <span>${assignedLabel}</span>
        </div>
        <div class="task-meta-right">${formattedDate}</div>
      </div>
    `;
    
    card.addEventListener('click', () => {
      document.querySelectorAll('.task-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectTask(task);
      // Mobile: open detail panel
      dom.detailContainer.classList.add('panel-open');
    });
    
    dom.tasksGrid.appendChild(card);
  });
}

// ─── Select Task & Fill Details ─────────────────────────────────────────────
function selectTask(task) {
  apiState.selectedTaskId = task.taskId;
  
  dom.detailEmptyState.classList.add('hidden');
  dom.detailContent.classList.remove('hidden');
  
  // Fill details
  dom.detailPriority.textContent = getPriorityLabel(task.priority);
  dom.detailPriority.className = `priority-badge ${task.priority}`;
  dom.detailTitle.textContent = task.title;
  dom.detailDescription.textContent = task.description;
  dom.detailTaskId.textContent = task.taskId;
  dom.detailRole.textContent = task.role;
  dom.detailSlaStatus.textContent = getSlaLabel(task.slaStatus);
  dom.detailSlaStatus.className = `meta-value sla-badge ${task.slaStatus}`;
  
  const due = task.dueAt ? new Date(task.dueAt).toLocaleString() : 'N/A';
  dom.detailDueAt.textContent = due;
  
  // Regulatory reference tags
  if (task.regulatoryRefs && task.regulatoryRefs.length > 0) {
    dom.detailRegulatoryBox.classList.remove('hidden');
    dom.detailRegulatoryTags.innerHTML = task.regulatoryRefs.map(ref => `<span class="ref-tag">${ref}</span>`).join('');
  } else {
    dom.detailRegulatoryBox.classList.add('hidden');
  }
  
  populateAssigneeActors(task.queue, task.role);
  updateWorkflowStateControls(task);
  renderTimeline(task.events || []);
  dom.contextJson.textContent = JSON.stringify(task.context || {}, null, 2);
  renderActionForm(task);
}

function closeDetails() {
  apiState.selectedTaskId = null;
  dom.detailEmptyState.classList.remove('hidden');
  dom.detailContent.classList.add('hidden');
  dom.detailContainer.classList.remove('panel-open');
}

// ─── Populate Assignee Actors ───────────────────────────────────────────────
function populateAssigneeActors(queue, role) {
  dom.opAssignToSelect.innerHTML = '<option value="">— Choose Staff —</option>';
  
  const matchingActors = apiState.actors.filter(actor => {
    return actor.status === 'active' && 
      (actor.roles.includes(role) || actor.queues.includes(queue));
  });
  
  matchingActors.forEach(actor => {
    const opt = document.createElement('option');
    opt.value = actor.actorId;
    opt.textContent = `${actor.displayName} (${actor.roles.join(', ')})`;
    dom.opAssignToSelect.appendChild(opt);
  });
}

// ─── Workflow State Controls ────────────────────────────────────────────────
function updateWorkflowStateControls(task) {
  if (task.status === 'open') {
    dom.btnOpStart.classList.remove('hidden');
    dom.btnOpStart.textContent = 'Claim & Start';
    dom.btnOpRelease.classList.add('hidden');
  } else if (task.status === 'assigned') {
    dom.btnOpStart.classList.remove('hidden');
    dom.btnOpStart.textContent = 'Start Work';
    dom.btnOpRelease.classList.remove('hidden');
  } else if (task.status === 'in_progress') {
    dom.btnOpStart.classList.add('hidden');
    dom.btnOpRelease.classList.remove('hidden');
  }
}

// ─── Timeline Rendering ────────────────────────────────────────────────────
function renderTimeline(events) {
  dom.timelineContainer.innerHTML = '';
  
  if (events.length === 0) {
    dom.timelineContainer.innerHTML = '<p style="font-size:var(--text-xs); color:var(--text-muted); font-style:italic">No workflow logs registered yet.</p>';
    return;
  }
  
  const sorted = [...events].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  
  sorted.forEach(ev => {
    const item = document.createElement('div');
    
    let typeClass = 'completed';
    if (ev.type.includes('assigned')) typeClass = 'assigned';
    if (ev.type.includes('started')) typeClass = 'started';
    
    const time = new Date(ev.occurredAt).toLocaleString();
    let text = ev.type.replace('workflow.task.', '').toUpperCase();
    let actorLabel = ev.actor || ev.assignedTo || 'System';
    
    let extraText = '';
    if (ev.notes) extraText = `<div class="event-notes">${ev.notes}</div>`;
    if (ev.comment) extraText = `<div class="event-notes">"${ev.comment}"</div>`;
    if (ev.reason) extraText = `<div class="event-notes">Reason: ${ev.reason}</div>`;
    
    // Icon glyphs
    let dotIcon = '●';
    if (typeClass === 'assigned') dotIcon = '→';
    if (typeClass === 'started') dotIcon = '▶';
    
    item.className = `timeline-event ${typeClass}`;
    item.innerHTML = `
      <div class="event-dot">${dotIcon}</div>
      <div class="event-content">
        <div class="event-meta">
          <span>${text}</span>
          <span>${time}</span>
        </div>
        <div class="event-text">Actor: <strong>${actorLabel}</strong></div>
        ${extraText}
      </div>
    `;
    
    dom.timelineContainer.appendChild(item);
  });
}

// ─── Task Control API Submissions ───────────────────────────────────────────

// Assign
dom.btnOpAssign.addEventListener('click', async () => {
  const targetActor = dom.opAssignToSelect.value;
  if (!targetActor) {
    showToast('Choose an actor to assign.', 'warning');
    return;
  }
  
  try {
    await apiFetch(`/workflow/tasks/${encodeURIComponent(apiState.selectedTaskId)}/assignments`, {
      method: 'POST',
      body: JSON.stringify({
        assignedTo: targetActor,
        assignedBy: apiState.currentActorId || 'system',
        asOf: apiState.simulationDate ? new Date(apiState.simulationDate).toISOString() : new Date().toISOString()
      })
    });
    showToast(`Task assigned to ${targetActor}`, 'success');
    loadTasks();
  } catch (err) {
    showToast(`Assignment failed: ${err.message}`, 'error');
  }
});

// Start
dom.btnOpStart.addEventListener('click', async () => {
  if (!apiState.currentActorId) {
    showToast('Configure an Acting User in the header first.', 'warning');
    return;
  }
  
  try {
    await apiFetch(`/workflow/tasks/${encodeURIComponent(apiState.selectedTaskId)}/start`, {
      method: 'POST',
      body: JSON.stringify({
        actor: apiState.currentActorId,
        asOf: apiState.simulationDate ? new Date(apiState.simulationDate).toISOString() : new Date().toISOString()
      })
    });
    showToast('Task marked in progress.', 'success');
    loadTasks();
  } catch (err) {
    showToast(`Failed to start: ${err.message}`, 'error');
  }
});

// Release — uses dialog instead of prompt()
dom.btnOpRelease.addEventListener('click', () => {
  if (!apiState.currentActorId) {
    showToast('Configure an Acting User in the header first.', 'warning');
    return;
  }
  document.getElementById('release-reason').value = '';
  dom.dialogRelease.showModal();
});

document.getElementById('btn-release-cancel').addEventListener('click', () => {
  dom.dialogRelease.close();
});

document.getElementById('btn-release-confirm').addEventListener('click', async () => {
  const reason = document.getElementById('release-reason').value.trim();
  if (!reason) {
    showToast('Release reason is required.', 'warning');
    return;
  }
  
  dom.dialogRelease.close();
  
  try {
    await apiFetch(`/workflow/tasks/${encodeURIComponent(apiState.selectedTaskId)}/release`, {
      method: 'POST',
      body: JSON.stringify({
        actor: apiState.currentActorId,
        reason: reason,
        asOf: apiState.simulationDate ? new Date(apiState.simulationDate).toISOString() : new Date().toISOString()
      })
    });
    showToast('Task released back to queue.', 'success');
    loadTasks();
  } catch (err) {
    showToast(`Release failed: ${err.message}`, 'error');
  }
});

// Close dialog on backdrop click
[dom.dialogRelease, dom.dialogDelivery, dom.dialogDecline].forEach(dialog => {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
});

// Comment
dom.btnOpComment.addEventListener('click', async () => {
  const commentText = dom.opCommentText.value.trim();
  if (!commentText) {
    showToast('Comment text cannot be empty.', 'warning');
    return;
  }
  
  if (!apiState.currentActorId) {
    showToast('Configure an Acting User in the header first.', 'warning');
    return;
  }
  
  try {
    await apiFetch(`/workflow/tasks/${encodeURIComponent(apiState.selectedTaskId)}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        actor: apiState.currentActorId,
        comment: commentText,
        asOf: apiState.simulationDate ? new Date(apiState.simulationDate).toISOString() : new Date().toISOString()
      })
    });
    showToast('Comment recorded.', 'success');
    dom.opCommentText.value = '';
    loadTasks();
  } catch (err) {
    showToast(`Failed to post comment: ${err.message}`, 'error');
  }
});


// ─── Dynamic Resolution Forms Based on Task Type ────────────────────────────
function renderActionForm(task) {
  dom.resolutionContainer.innerHTML = '';
  
  const type = task.type;
  const appId = task.entity?.id;
  const loanId = task.entity?.id;
  const complaintId = task.entity?.id;
  
  if (type === 'application.kfs_acceptance') {
    dom.resolutionContainer.innerHTML = `
      <form class="resolution-form" id="form-kfs-accept">
        <h5>Accept Key Facts Statement (KFS)</h5>
        <div class="field-group">
          <label>Delivery Channel</label>
          <select id="kfs-delivery-channel" required>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="in_app">DLA / In-App Notification</option>
            <option value="physical">Physical Delivery</option>
          </select>
        </div>
        <div class="field-group">
          <label>Delivery Reference / Tracking ID</label>
          <input type="text" id="kfs-delivery-ref" placeholder="e.g. MSG-98176235" required value="REF-${Math.floor(Math.random() * 900000 + 100000)}">
        </div>
        <div class="field-group">
          <label>Acceptance Method</label>
          <select id="kfs-accept-method" required>
            <option value="otp">OTP Verification</option>
            <option value="esign">eSign Envelope</option>
            <option value="clickwrap">Clickwrap Consent</option>
          </select>
        </div>
        <button type="submit" class="btn btn-success">Record KFS Acceptance</button>
      </form>
    `;
    
    document.getElementById('form-kfs-accept').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const channel = document.getElementById('kfs-delivery-channel').value;
        const ref = document.getElementById('kfs-delivery-ref').value;
        const acceptMethod = document.getElementById('kfs-accept-method').value;
        
        await apiFetch(`/loans/applications/${encodeURIComponent(appId)}/kfs`, {
          method: 'POST',
          body: JSON.stringify({
            deliveryChannel: channel,
            deliveryRef: ref,
            acceptedAt: new Date(apiState.simulationDate).toISOString(),
            acceptanceEvidence: {
              method: acceptMethod,
              ipAddress: '127.0.0.1',
              timestamp: new Date(apiState.simulationDate).toISOString()
            }
          })
        });
        showToast('KFS acceptance successfully recorded!', 'success');
        loadTasks();
      } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
      }
    });
    
  } else if (type === 'application.manual_underwriting') {
    dom.resolutionContainer.innerHTML = `
      <form class="resolution-form" id="form-manual-underwrite">
        <h5>Manual Underwriting Override</h5>
        <div class="field-group">
          <label>Override Rationale / Reason</label>
          <textarea id="mu-reason" placeholder="Explain credit worthiness override details…" required></textarea>
        </div>
        <div class="field-group">
          <label>Board-Approved Policy Reference</label>
          <input type="text" id="mu-policy" placeholder="e.g. BOARD-CREDIT-POLICY-2026-V3" required value="BOARD-PRICING-2026-V1">
        </div>
        <div class="op-buttons">
          <button type="submit" id="btn-mu-approve" class="btn btn-success">Propose Approval (Override)</button>
          <button type="button" id="btn-mu-decline" class="btn btn-danger">Decline Application</button>
        </div>
      </form>
    `;
    
    // Propose override approval
    document.getElementById('form-manual-underwrite').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const reason = document.getElementById('mu-reason').value.trim();
        const policy = document.getElementById('mu-policy').value.trim();
        
        await apiFetch(`/loans/applications/${encodeURIComponent(appId)}/human-reviews`, {
          method: 'POST',
          body: JSON.stringify({
            reviewer: apiState.currentActorId,
            status: 'approved',
            notes: `Manual Underwriting Review: ${reason} (Policy: ${policy})`
          })
        });

        await apiFetch(`/loans/applications/${encodeURIComponent(appId)}/decision`, {
          method: 'POST',
          body: JSON.stringify({
            decision: 'approved',
            proposedBy: apiState.currentActorId,
            manualUnderwriting: {
              underwriterId: apiState.currentActorId,
              reason: reason,
              policyReference: policy
            }
          })
        });
        
        showToast('Manual override approved and credit decision proposed!', 'success');
        loadTasks();
      } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
      }
    });

    // Decline — uses dialog instead of prompt()
    document.getElementById('btn-mu-decline').addEventListener('click', () => {
      document.getElementById('decline-narrative').value = 'Credit score is below minimum policy threshold.';
      dom.dialogDecline.showModal();
      
      // One-time handler for decline confirm
      const handler = async () => {
        const code = document.getElementById('decline-code').value;
        const narrative = document.getElementById('decline-narrative').value.trim();
        dom.dialogDecline.close();
        document.getElementById('btn-decline-confirm').removeEventListener('click', handler);
        
        try {
          await apiFetch(`/loans/applications/${encodeURIComponent(appId)}/decision`, {
            method: 'POST',
            body: JSON.stringify({
              decision: 'declined',
              proposedBy: apiState.currentActorId,
              declineReason: { code, narrative }
            })
          });
          showToast('Application declined.', 'success');
          loadTasks();
        } catch (err) {
          showToast(`Decline failed: ${err.message}`, 'error');
        }
      };
      
      document.getElementById('btn-decline-confirm').addEventListener('click', handler);
    });
    
  } else if (type === 'application.credit_decision') {
    dom.resolutionContainer.innerHTML = `
      <form class="resolution-form" id="form-credit-decision">
        <h5>Propose Credit Decision</h5>
        <div class="field-group">
          <label>Decision</label>
          <select id="cd-decision" required>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
          </select>
        </div>
        
        <div class="field-group hidden" id="cd-decline-reasons-box">
          <label>Decline Reason Code</label>
          <select id="cd-decline-code">
            <option value="credit_score_insufficient">Credit Score Insufficient</option>
            <option value="foir_exceeded">FOIR Threshold Exceeded</option>
            <option value="age_bounds_invalid">Age Bounds Invalid</option>
            <option value="residency_non_india">Non-India Resident</option>
            <option value="kyc_verification_failed">KYC Verification Failed</option>
            <option value="other">Other (requires narrative)</option>
          </select>
          <input type="text" id="cd-decline-narrative" placeholder="Describe the reason for decline…" style="margin-top:0.4rem">
        </div>
        
        <button type="submit" class="btn btn-primary">Propose Decision</button>
      </form>
    `;
    
    const decisionSel = document.getElementById('cd-decision');
    const declineBox = document.getElementById('cd-decline-reasons-box');
    decisionSel.addEventListener('change', () => {
      declineBox.classList.toggle('hidden', decisionSel.value !== 'declined');
    });
    
    document.getElementById('form-credit-decision').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const decision = decisionSel.value;
        const body = {
          decision: decision,
          proposedBy: apiState.currentActorId
        };
        
        if (decision === 'declined') {
          body.declineReason = {
            code: document.getElementById('cd-decline-code').value,
            narrative: document.getElementById('cd-decline-narrative').value.trim() || 'Declined'
          };
        }
        
        await apiFetch(`/loans/applications/${encodeURIComponent(appId)}/decision`, {
          method: 'POST',
          body: JSON.stringify(body)
        });
        showToast('Credit decision proposed successfully!', 'success');
        loadTasks();
      } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
      }
    });
    
  } else if (type === 'application.ai_human_review') {
    dom.resolutionContainer.innerHTML = `
      <form class="resolution-form" id="form-human-review">
        <h5>Human Oversight on AI-Assisted Credit Eligibility</h5>
        <div class="field-group">
          <label>Audit Notes</label>
          <textarea id="hr-notes" placeholder="Add human compliance review details…" required></textarea>
        </div>
        <div class="op-buttons">
          <button type="submit" id="btn-hr-approve" class="btn btn-success">Verify AI Decision</button>
        </div>
      </form>
    `;
    
    document.getElementById('form-human-review').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const notes = document.getElementById('hr-notes').value.trim();
        await apiFetch(`/loans/applications/${encodeURIComponent(appId)}/human-reviews`, {
          method: 'POST',
          body: JSON.stringify({
            reviewer: apiState.currentActorId,
            status: 'approved',
            notes: notes
          })
        });
        showToast('Human review recorded successfully!', 'success');
        loadTasks();
      } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
      }
    });
    
  } else if (type === 'application.decision_approval') {
    dom.resolutionContainer.innerHTML = `
      <form class="resolution-form" id="form-checker-approval">
        <h5>Checker Approval Gate</h5>
        <p style="font-size:var(--text-sm); color:var(--text-secondary); margin-bottom: var(--space-2)">
          Verify application details, disclosures, and manual overrides before authorizing fund disbursement.
        </p>
        <div class="field-group">
          <label>Review Decision</label>
          <select id="chk-decision" required>
            <option value="approved">Approve & Authorize Disbursement</option>
            <option value="rejected">Reject Proposal</option>
          </select>
        </div>
        <div class="field-group">
          <label>Audit Comment</label>
          <textarea id="chk-notes" placeholder="Approval or rejection notes…"></textarea>
        </div>
        <button type="submit" class="btn btn-success">Submit Maker-Checker Decision</button>
      </form>
    `;
    
    document.getElementById('form-checker-approval').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const decision = document.getElementById('chk-decision').value;
        const notes = document.getElementById('chk-notes').value.trim();
        
        await apiFetch(`/loans/applications/${encodeURIComponent(appId)}/approvals`, {
          method: 'POST',
          body: JSON.stringify({
            checker: apiState.currentActorId,
            action: decision,
            notes: notes || 'Maker-checker approval check passed.'
          })
        });
        showToast(`Maker-checker proposal ${decision}!`, 'success');
        loadTasks();
      } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
      }
    });
    
  } else if (type === 'application.document_packet_delivery') {
    dom.resolutionContainer.innerHTML = `
      <div class="resolution-form">
        <h5>Generate & Deliver Document Packet</h5>
        <p style="font-size:var(--text-sm); color:var(--text-secondary); margin-bottom: var(--space-2)">
          Generate KFS, Sanction Letter, Loan Agreement Summary, and Privacy Notice, then record delivery.
        </p>
        <div class="op-buttons">
          <button id="btn-doc-generate" class="btn btn-primary">1. Generate Documents</button>
          <button id="btn-doc-deliver" class="btn btn-success">2. Record Delivery</button>
        </div>
      </div>
    `;
    
    document.getElementById('btn-doc-generate').addEventListener('click', async () => {
      try {
        await apiFetch(`/loans/applications/${encodeURIComponent(appId)}/document-packet`, {
          method: 'POST',
          body: JSON.stringify({})
        });
        showToast('Document packet generated successfully!', 'success');
        loadTasks();
      } catch (err) {
        showToast(`Failed to generate: ${err.message}`, 'error');
      }
    });

    // Delivery — uses dialog instead of prompt()
    document.getElementById('btn-doc-deliver').addEventListener('click', () => {
      document.getElementById('delivery-ref').value = 'MSG-' + Math.floor(Math.random() * 80000 + 10000);
      dom.dialogDelivery.showModal();
    });
    
    document.getElementById('btn-delivery-cancel').addEventListener('click', () => {
      dom.dialogDelivery.close();
    });
    
    document.getElementById('btn-delivery-confirm').addEventListener('click', async () => {
      const channel = document.getElementById('delivery-channel').value;
      const ref = document.getElementById('delivery-ref').value.trim();
      if (!ref) {
        showToast('Delivery reference is required.', 'warning');
        return;
      }
      
      dom.dialogDelivery.close();
      
      try {
        await apiFetch(`/loans/applications/${encodeURIComponent(appId)}/document-packet/delivery`, {
          method: 'POST',
          body: JSON.stringify({
            deliveryChannel: channel,
            deliveryRef: ref,
            deliveredAt: new Date(apiState.simulationDate).toISOString()
          })
        });
        showToast('Document packet delivery evidence stored!', 'success');
        loadTasks();
      } catch (err) {
        showToast(`Failed to record delivery: ${err.message}`, 'error');
      }
    });
    
  } else if (type === 'application.disbursement') {
    dom.resolutionContainer.innerHTML = `
      <form class="resolution-form" id="form-disburse">
        <h5>Disbursement Fund Flow Verification</h5>
        <p style="font-size:var(--text-sm); color:var(--text-secondary); margin-bottom: var(--space-2)">
          Disbursement can only route directly to a verified borrower or designated beneficiary account. LSP pass-through pools are strictly blocked.
        </p>
        <div class="field-group">
          <label>Account Holder Name</label>
          <input type="text" id="disb-holder-name" required value="Asha Sharma">
        </div>
        <div class="field-group">
          <label>Destination Account Number</label>
          <input type="text" id="disb-account-number" required value="123456789012">
        </div>
        <div class="field-group">
          <label>IFSC</label>
          <input type="text" id="disb-ifsc" required value="HDFC0000001">
        </div>
        <div class="field-group">
          <label>Owner Role</label>
          <select id="disb-owner-role" required>
            <option value="borrower">Borrower</option>
            <option value="end_beneficiary">End Beneficiary</option>
          </select>
        </div>
        <div class="field-group">
          <label>Fund Transfer Reference</label>
          <input type="text" id="disb-ref" required value="IMPS-REF-${Math.floor(Math.random()*800000+100000)}">
        </div>
        <button type="submit" class="btn btn-success">Execute Direct Disbursement</button>
      </form>
    `;
    
    document.getElementById('form-disburse').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const ref = document.getElementById('disb-ref').value;
        const accountNumber = document.getElementById('disb-account-number').value.trim();
        const ifsc = document.getElementById('disb-ifsc').value.trim().toUpperCase();
        const expectedHolderName = document.getElementById('disb-holder-name').value.trim();
        const ownerRole = document.getElementById('disb-owner-role').value;
        const verificationResponse = await apiFetch('/integrations/bank-account-verification', {
          method: 'POST',
          body: JSON.stringify({
            accountNumber,
            ifsc,
            expectedHolderName
          })
        });
        await apiFetch(`/loans/applications/${encodeURIComponent(appId)}/disbursement`, {
          method: 'POST',
          body: JSON.stringify({
            maker: apiState.currentActorId,
            disbursementId: ref,
            disbursedAt: new Date(apiState.simulationDate).toISOString(),
            destinationAccount: {
              country: 'IN',
              ifsc,
              ownerRole,
              accountNumberLast4: accountNumber.slice(-4),
              bankAccountVerification: verificationResponse.verification
            }
          })
        });
        showToast('Disbursement completed & Loan Account opened!', 'success');
        loadTasks();
      } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
      }
    });
    
  } else if (type === 'complaint.assignment') {
    dom.resolutionContainer.innerHTML = `
      <form class="resolution-form" id="form-complaint-assign">
        <h5>Assign Complaint</h5>
        <div class="field-group">
          <label>Assign to Grievance Officer</label>
          <select id="comp-officer" required></select>
        </div>
        <button type="submit" class="btn btn-primary">Assign Officer</button>
      </form>
    `;
    
    const select = document.getElementById('comp-officer');
    apiState.actors.filter(a => a.roles.includes('grievance_officer')).forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.actorId;
      opt.textContent = a.displayName;
      select.appendChild(opt);
    });
    
    document.getElementById('form-complaint-assign').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const officer = select.value;
        await apiFetch(`/complaints/${encodeURIComponent(complaintId)}/assignments`, {
          method: 'POST',
          body: JSON.stringify({
            assignedTo: officer,
            assignedBy: apiState.currentActorId
          })
        });
        showToast('Grievance officer assigned.', 'success');
        loadTasks();
      } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
      }
    });
    
  } else if (type === 'complaint.resolution') {
    dom.resolutionContainer.innerHTML = `
      <form class="resolution-form" id="form-complaint-resolve">
        <h5>Resolve Complaint</h5>
        <div class="field-group">
          <label>Resolution Action Code</label>
          <select id="comp-res-code" required>
            <option value="upheld">Upheld (Complaint Valid, Remedied)</option>
            <option value="rejected">Rejected (Complaint Invalid)</option>
            <option value="partially_upheld">Partially Upheld</option>
          </select>
        </div>
        <div class="field-group">
          <label>Resolution Summary Detail</label>
          <textarea id="comp-res-summary" placeholder="Provide description of investigation findings and outcome…" required></textarea>
        </div>
        <button type="submit" class="btn btn-success">Close Complaint</button>
      </form>
    `;
    
    document.getElementById('form-complaint-resolve').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const code = document.getElementById('comp-res-code').value;
        const summary = document.getElementById('comp-res-summary').value;
        
        await apiFetch(`/complaints/${encodeURIComponent(complaintId)}/resolution`, {
          method: 'POST',
          body: JSON.stringify({
            resolvedBy: apiState.currentActorId,
            resolutionCode: code,
            resolutionSummary: summary,
            closureEvidenceRef: 'DOC-RESOLVED-' + Math.floor(Math.random()*90000+10000)
          })
        });
        showToast('Complaint resolved & closed.', 'success');
        loadTasks();
      } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
      }
    });
    
  } else if (type === 'complaint.rbi_cms_escalation') {
    dom.resolutionContainer.innerHTML = `
      <form class="resolution-form" id="form-cms-escalation">
        <h5>Escalate to RBI CMS</h5>
        <p style="font-size:var(--text-sm); color:var(--status-danger)">
          SLA warning: 30 days elapsed without resolution. Must record RBI CMS reference.
        </p>
        <div class="field-group">
          <label>RBI CMS Complaint Reference Number</label>
          <input type="text" id="cms-ref" placeholder="RBI-CMS-2026-X" required>
        </div>
        <div class="field-group">
          <label>Reason for Delay</label>
          <textarea id="cms-reason" required placeholder="Explain why the complaint could not be resolved within the 30-day SLA…"></textarea>
        </div>
        <button type="submit" class="btn btn-danger">Record RBI CMS Escalation</button>
      </form>
    `;
    
    document.getElementById('form-cms-escalation').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const ref = document.getElementById('cms-ref').value;
        const reason = document.getElementById('cms-reason').value;
        
        await apiFetch(`/complaints/${encodeURIComponent(complaintId)}/rbi-cms-escalation`, {
          method: 'POST',
          body: JSON.stringify({
            cmsReference: ref,
            reason: reason,
            actor: apiState.currentActorId
          })
        });
        showToast('RBI CMS Escalation registered successfully.', 'success');
        loadTasks();
      } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
      }
    });
    
  } else if (type === 'loan_account.recovery_assignment') {
    dom.resolutionContainer.innerHTML = `
      <form class="resolution-form" id="form-recovery-assign">
        <h5>Assign Recovery Agent</h5>
        <p style="font-size:var(--text-sm); color:var(--text-secondary); margin-bottom: var(--space-2)">
          Assign only registered and verified recovery agents. System requires borrower notice delivery proof before active assignment.
        </p>
        <div class="field-group">
          <label>Empanelled Recovery Agent ID</label>
          <input type="text" id="rec-agent-id" placeholder="e.g. rec_agent_1" required value="recovery_agent_1">
        </div>
        <div class="field-group">
          <label>Borrower Notice Delivery Reference</label>
          <input type="text" id="rec-notice-ref" placeholder="Notice tracking ref…" required value="NOTICE-DELIVERY-${Math.floor(Math.random()*80000+10000)}">
        </div>
        <button type="submit" class="btn btn-primary">Empanel & Assign Agent</button>
      </form>
    `;
    
    document.getElementById('form-recovery-assign').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const agent = document.getElementById('rec-agent-id').value;
        const ref = document.getElementById('rec-notice-ref').value;
        
        await apiFetch(`/loan-accounts/${encodeURIComponent(loanId)}/recovery-assignments`, {
          method: 'POST',
          body: JSON.stringify({
            recoveryAgentId: agent,
            noticeSentAt: new Date(apiState.simulationDate).toISOString(),
            noticeDeliveryRef: ref,
            assignedBy: apiState.currentActorId
          })
        });
        showToast('Recovery agent assigned with notice evidence.', 'success');
        loadTasks();
      } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
      }
    });
    
  } else {
    dom.resolutionContainer.innerHTML = `
      <div style="font-size:var(--text-sm); color:var(--text-muted); font-style:italic; text-align:center; padding: var(--space-4)">
        No active resolution triggers needed. Mark status above or add comments.
      </div>
    `;
  }
}


// ─── Event Handlers & Initializers ──────────────────────────────────────────

dom.apiKeyInput.addEventListener('change', onApiKeyChange);

dom.actorSelect.addEventListener('change', () => {
  apiState.currentActorId = dom.actorSelect.value;
  localStorage.setItem('loanos_actor_id', apiState.currentActorId);
  showToast(`Switched to ${apiState.currentActorId}`, 'info');
});

dom.timeAsOfInput.addEventListener('change', () => {
  apiState.simulationDate = dom.timeAsOfInput.value;
  showToast('Simulation date updated. Refreshing…', 'info');
  loadTasks();
});

dom.btnRefresh.addEventListener('click', () => {
  loadTasks();
});

dom.taskSearch.addEventListener('input', () => {
  renderTasksList();
});

dom.filterStatus.addEventListener('change', () => {
  apiState.statusFilter = dom.filterStatus.value;
  renderTasksList();
});

// Sidebar queue selection
dom.queueList.addEventListener('click', (e) => {
  const item = e.target.closest('.queue-item');
  if (!item) return;
  
  document.querySelectorAll('.queue-item').forEach(li => {
    li.classList.remove('active');
    li.setAttribute('aria-selected', 'false');
  });
  item.classList.add('active');
  item.setAttribute('aria-selected', 'true');
  
  apiState.activeQueue = item.dataset.queue;
  renderTasksList();
  closeDetails();
});

// Keyboard navigation for queue items
dom.queueList.addEventListener('keydown', (e) => {
  const items = Array.from(dom.queueList.querySelectorAll('.queue-item'));
  const currentIndex = items.indexOf(document.activeElement);
  
  if (e.key === 'ArrowDown' && currentIndex < items.length - 1) {
    e.preventDefault();
    items[currentIndex + 1].focus();
  } else if (e.key === 'ArrowUp' && currentIndex > 0) {
    e.preventDefault();
    items[currentIndex - 1].focus();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    document.activeElement.click();
  }
});

// Keyboard: Escape closes detail panel
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (dom.dialogRelease.open || dom.dialogDelivery.open || dom.dialogDecline.open) return;
    closeDetails();
  }
});

// Boot
window.addEventListener('DOMContentLoaded', () => {
  initConfig();
});
