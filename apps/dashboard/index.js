// ═══════════════════════════════════════════════════════════════════════════
// LoanOS India — Loan Officer Workspace  ·  Dashboard v2
// ═══════════════════════════════════════════════════════════════════════════

// ─── State Management ───────────────────────────────────────────────────────
let apiState = {
  apiKey: '',
  authScope: '',
  currentUser: null,
  currentTenant: null,
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
  lastRefreshTime: null,
  onboardingStep: 0,
  iamWorkspace: null,
  iamCatalogue: null
};

// ─── DOM Cache ──────────────────────────────────────────────────────────────
const dom = {
  loginScreen: document.getElementById('login-screen'),
  appContainer: document.getElementById('app-container'),
  tenantLoginForm: document.getElementById('tenant-login-form'),
  platformLoginForm: document.getElementById('platform-login-form'),
  loginTabs: document.querySelectorAll('.login-tab'),
  btnServiceKeyLogin: document.getElementById('btn-service-key-login'),
  apiKeyInput: document.getElementById('config-api-key'),
  actorSelect: document.getElementById('current-actor-select'),
  timeAsOfInput: document.getElementById('time-as-of'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnAdminOpen: document.getElementById('btn-admin-open'),
  btnLogout: document.getElementById('btn-logout'),
  
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
  filterMyQueues: document.getElementById('filter-my-queues'),
  filterStatus: document.getElementById('filter-status'),
  taskSearch: document.getElementById('task-search'),
  taskSort: document.getElementById('task-sort'),
  visibleTaskCount: document.getElementById('visible-task-count'),
  btnClearFilters: document.getElementById('btn-clear-filters'),
  btnEmptyClear: document.getElementById('btn-empty-clear'),
  tasksError: document.getElementById('tasks-error'),
  tasksErrorText: document.getElementById('tasks-error-text'),
  btnRetryTasks: document.getElementById('btn-retry-tasks'),
  tasksGrid: document.getElementById('tasks-grid-list'),
  tasksEmptyState: document.getElementById('tasks-empty-state'),
  tasksSkeleton: document.getElementById('tasks-skeleton'),
  
  // Details pane
  detailContainer: document.getElementById('task-detail-container'),
  detailEmptyState: document.getElementById('detail-empty-state'),
  detailContent: document.getElementById('task-details-content'),
  btnDetailClose: document.getElementById('btn-detail-close'),
  
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
  dialogAdmin: document.getElementById('dialog-admin'),
  adminTabs: document.querySelectorAll('.admin-tab[data-admin-tab]'),
  adminSummary: document.getElementById('admin-summary'),
  adminUsersList: document.getElementById('admin-users-list'),
  adminUserForm: document.getElementById('admin-user-form'),
  adminReviewForm: document.getElementById('admin-review-form'),
  adminReviewsList: document.getElementById('admin-reviews-list'),
  btnAdminRotateKey: document.getElementById('btn-admin-rotate-key'),
  adminRotationReason: document.getElementById('admin-rotation-reason'),
  adminRotatedKeyOutput: document.getElementById('admin-rotated-key-output'),
  platformSummary: document.getElementById('platform-summary'),
  platformTenantForm: document.getElementById('platform-tenant-form'),
  platformTenantsList: document.getElementById('platform-tenants-list'),
  onboardingStepLabel: document.getElementById('onboarding-step-label'),
  onboardingPanels: document.querySelectorAll('[data-wizard-step]'),
  onboardingDots: document.querySelectorAll('.wizard-dot'),
  btnOnboardingPrev: document.getElementById('btn-onboarding-prev'),
  btnOnboardingNext: document.getElementById('btn-onboarding-next'),
  btnOnboardingSubmit: document.getElementById('btn-onboarding-submit'),
  onboardingOutput: document.getElementById('platform-onboarding-output'),
  btnAdminClose: document.getElementById('btn-admin-close'),

  // Login error/MFA
  tenantLoginError: document.getElementById('tenant-login-error'),
  platformLoginError: document.getElementById('platform-login-error'),
  tenantLoginMfaGroup: document.getElementById('tenant-login-mfa-group'),
  platformLoginMfaGroup: document.getElementById('platform-login-mfa-group'),
  loginMfaCode: document.getElementById('login-mfa-code'),
  platformLoginMfaCode: document.getElementById('platform-login-mfa-code'),

  // Accept invite
  btnShowAcceptInvite: document.getElementById('btn-show-accept-invite'),
  btnBackToLogin: document.getElementById('btn-back-to-login'),
  acceptInviteCard: document.getElementById('accept-invite-card'),
  acceptInviteForm: document.getElementById('accept-invite-form'),
  acceptInviteError: document.getElementById('accept-invite-error'),

  // Required-action dialog (MFA setup / forced password change)
  dialogRequiredAction: document.getElementById('dialog-required-action'),
  requiredActionTitle: document.getElementById('required-action-title'),
  requiredActionSubtitle: document.getElementById('required-action-subtitle'),
  requiredActionMfaSetup: document.getElementById('required-action-mfa-setup'),
  mfaSetupSecret: document.getElementById('mfa-setup-secret'),
  mfaSetupOtpauthLink: document.getElementById('mfa-setup-otpauth-link'),
  mfaSetupCode: document.getElementById('mfa-setup-code'),
  mfaSetupError: document.getElementById('mfa-setup-error'),
  btnMfaSetupConfirm: document.getElementById('btn-mfa-setup-confirm'),
  requiredActionPasswordForm: document.getElementById('required-action-password-form'),
  forcedPasswordCurrent: document.getElementById('forced-password-current'),
  forcedPasswordNew: document.getElementById('forced-password-new'),
  forcedPasswordError: document.getElementById('forced-password-error'),
  btnRequiredActionSignout: document.getElementById('btn-required-action-signout'),

  // Account settings
  btnAccountOpen: document.getElementById('btn-account-open'),
  dialogAccount: document.getElementById('dialog-account'),
  btnAccountClose: document.getElementById('btn-account-close'),
  accountTabs: document.querySelectorAll('.account-tab'),
  accountPasswordForm: document.getElementById('account-password-form'),
  accountCurrentPassword: document.getElementById('account-current-password'),
  accountNewPassword: document.getElementById('account-new-password'),
  accountMfaStatusPill: document.getElementById('account-mfa-status-pill'),
  accountMfaEnrollForm: document.getElementById('account-mfa-enroll-form'),
  accountMfaPassword: document.getElementById('account-mfa-password'),
  btnAccountMfaStart: document.getElementById('btn-account-mfa-start'),
  accountMfaEnrollDetails: document.getElementById('account-mfa-enroll-details'),
  accountMfaSecret: document.getElementById('account-mfa-secret'),
  accountMfaConfirmCode: document.getElementById('account-mfa-confirm-code'),
  btnAccountMfaConfirm: document.getElementById('btn-account-mfa-confirm'),
  accountMfaDisableForm: document.getElementById('account-mfa-disable-form'),
  accountMfaDisablePassword: document.getElementById('account-mfa-disable-password'),
  accountMfaDisableCode: document.getElementById('account-mfa-disable-code'),

  // User provisioning subtabs
  userSubtabs: document.querySelectorAll('.admin-subtab'),
  adminInviteForm: document.getElementById('admin-invite-form'),
  adminInviteOutputRow: document.getElementById('admin-invite-output-row'),
  adminInviteOutput: document.getElementById('admin-invite-output'),

  // Audit tab
  btnAuditRefresh: document.getElementById('btn-audit-refresh'),
  btnAuditExport: document.getElementById('btn-audit-export'),
  adminAuditList: document.getElementById('admin-audit-list'),

  // Platform access tab
  platformUserForm: document.querySelector('#admin-panel-platform-access .admin-form'),
  platformUsersList: document.getElementById('platform-users-list'),
  btnBreakGlassMint: document.getElementById('btn-break-glass-mint'),
  breakGlassOutput: document.getElementById('break-glass-output'),
  breakGlassList: document.getElementById('break-glass-list'),

  toastContainer: document.getElementById('toast-container')
};

// ─── Init ───────────────────────────────────────────────────────────────────
async function initConfig() {
  apiState.apiKey = '';
  apiState.currentActorId = localStorage.getItem('loanos_actor_id') || '';
  
  // Default simulation date to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  apiState.simulationDate = now.toISOString().slice(0, 16);
  
  dom.apiKeyInput.value = apiState.apiKey;
  dom.timeAsOfInput.value = apiState.simulationDate;

  updateConnectionStatus(false);
  updateAdminButtonVisibility();

  try {
    const me = await bareFetch('/auth/me');
    applyAuthenticatedContext(me);
    showApp();
    if (me.scope === 'tenant') {
      await loadTenantWorkspace();
    } else {
      showToast('Platform session restored. Open Admin to manage tenants.', 'success');
      updateConnectionStatus(true, 'Platform admin');
    }
  } catch (_) {
    showLogin();
  }
  
  // Start auto-refresh
  startAutoRefresh();
}

function showLogin() {
  dom.loginScreen.classList.remove('hidden');
  dom.appContainer.classList.add('auth-hidden');
}

function showApp() {
  dom.loginScreen.classList.add('hidden');
  dom.appContainer.classList.remove('auth-hidden');
}

function applyAuthenticatedContext(context) {
  apiState.authScope = context.scope;
  apiState.currentUser = context.user || null;
  apiState.currentTenant = context.tenant || null;
  apiState.apiKey = '';
  dom.apiKeyInput.value = '';
  if (context.scope === 'tenant') {
    // The login user's own userId is the acting identity — there is no
    // separate staff-actor id to look up.
    apiState.currentActorId = context.user?.userId || apiState.currentActorId || '';
    if (apiState.currentActorId) {
      localStorage.setItem('loanos_actor_id', apiState.currentActorId);
    }
    dom.footerTenantLabel.textContent = `Tenant: ${context.tenant?.tenantId || 'unknown'} · ${context.user?.email || ''}`;
    document.title = `${context.tenant?.name || context.tenant?.tenantId || 'LoanOS India'} — Loan Officer Workspace`;
  } else {
    dom.footerTenantLabel.textContent = `Platform: ${context.user?.email || ''}`;
    document.title = 'LoanOS India — Platform Console';
  }
  document.body.classList.toggle('platform-mode', context.scope === 'platform');
  // The simulation-date control is a dev/QA time-travel tool; showing it to
  // every operator invites confusion about why "today" looks wrong. Restrict
  // it to identities that can actually reason about it: tenant admins and
  // service/platform principals.
  const canSeeSimDate = context.scope !== 'tenant' || (context.user?.adminRoles || []).some(role => TENANT_ADMIN_FAMILY_ROLES.includes(role));
  dom.timeAsOfInput.closest('.control-group').classList.toggle('hidden', !canSeeSimDate);
  updateAdminButtonVisibility();
}

const TENANT_ADMIN_FAMILY_ROLES = ['tenant_admin', 'user_admin', 'security_admin', 'auditor'];

// Mirrors the server's own gate (hasTenantAdminRole in identity.js) so the
// Admin button only appears when the signed-in identity could actually do
// something behind it — a plain "operator" tenant user never sees it. This is
// a UX improvement, not the security boundary: every /admin and /platform
// route re-checks the caller's role server-side regardless of what the client
// renders.
function canOpenTenantAdmin() {
  if (apiState.authScope === 'platform') return true;
  if (apiState.authScope === 'tenant_service' || !!apiState.apiKey) return true;
  if (apiState.authScope === 'tenant') {
    const roles = apiState.currentUser?.adminRoles || [];
    return roles.some(role => TENANT_ADMIN_FAMILY_ROLES.includes(role));
  }
  return false;
}

function updateAdminButtonVisibility() {
  const canOpen = canOpenTenantAdmin();
  dom.btnAdminOpen.classList.toggle('hidden', !canOpen);
  dom.btnAdminOpen.disabled = !canOpen;
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

function recordScreenActivity(activityType, screenId, actionId = null, entityType = null) {
  if (apiState.authScope !== 'tenant' || !apiState.currentUser?.userId) return;
  fetch('/activity/screen-events', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activityType, screenId, actionId, entityType, clientOccurredAt: new Date().toISOString() })
  }).catch(() => {});
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
  
  let icon = 'i';
  if (type === 'success') icon = '✓';
  if (type === 'error') icon = '!';
  if (type === 'warning') icon = '!';
  
  toast.innerHTML = `
    <span class="toast-symbol" aria-hidden="true">${icon}</span>
    <span class="toast-message"></span>
    <button class="toast-dismiss" aria-label="Dismiss notification">×</button>
    <div class="toast-progress"></div>
  `;
  toast.querySelector('.toast-message').textContent = String(message);
  
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
    if (hasTenantWorkspaceAccess() && apiState.connected) {
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
    credentials: 'same-origin',
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

async function bareFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    let message = `HTTP Error ${response.status}`;
    let code = null;
    let details = null;
    try {
      const body = await response.json();
      message = body?.error?.message || message;
      code = body?.error?.code || null;
      details = body?.error || null;
    } catch (_) {}
    const error = new Error(message);
    error.code = code;
    error.status = response.status;
    error.details = details;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

// ─── API Key Changed ────────────────────────────────────────────────────────
async function onApiKeyChange() {
  apiState.apiKey = '';
  dom.apiKeyInput.value = '';
  showToast('Service API keys cannot be used in the browser. Sign in with your staff account.', 'warning');
}

async function loadTenantWorkspace(label) {
  // "Staff actors" are just tenant login users that carry a workflow role —
  // GET /staff/actors is a read-only projection of state.users, not a
  // separate registry, so there is nothing left to auto-seed here.
  const res = await apiFetch('/staff/actors');
  apiState.actors = res.actors || [];
  updateConnectionStatus(true, label || `Tenant: ${apiState.currentTenant?.tenantId || 'active'}`);
  recordScreenActivity('screen_view', 'staff.workspace');

  const unrestricted = currentUserQueues() === null;
  dom.filterMyQueues.closest('.filter-section').classList.toggle('hidden', unrestricted);

  dom.actorSelect.innerHTML = '';

  // A real human login is bound to its own identity everywhere it matters —
  // the server ignores/overrides any other actor a session claims to act as
  // (see resolveSessionActorId in server.js), so letting the dropdown offer
  // every actor here would just be misleading UI. Only a service-key
  // connection (no personal login identity) gets free actor selection, which
  // mirrors how the server actually treats that principal type.
  if (apiState.authScope === 'tenant') {
    renderBoundActorSelect();
  } else if (apiState.actors.length === 0) {
    dom.actorSelect.innerHTML = '<option value="">No staff users yet — create one in Admin</option>';
    dom.actorSelect.disabled = true;
  } else {
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

    if (apiState.currentActorId) {
      dom.actorSelect.value = apiState.currentActorId;
    }
    dom.actorSelect.disabled = false;
  }

  showToast('Connected and loaded staff actors.', 'success');
  loadTasks();
}

// Locks the "Acting User" control to the logged-in session's own identity.
// If the account has no workflow roles, it's shown as unlinked rather than
// falling back to picking someone else's identity.
function renderBoundActorSelect() {
  const boundActorId = apiState.currentUser?.userId || '';
  apiState.currentActorId = boundActorId;
  if (boundActorId) {
    localStorage.setItem('loanos_actor_id', boundActorId);
  } else {
    localStorage.removeItem('loanos_actor_id');
  }

  const boundActor = apiState.actors.find(actor => actor.actorId === boundActorId);
  const opt = document.createElement('option');
  if (boundActor) {
    opt.value = boundActor.actorId;
    opt.textContent = `${boundActor.displayName} (${boundActor.roles.join(', ')})`;
  } else {
    opt.value = '';
    opt.textContent = 'No staff actor linked — ask an admin';
  }
  opt.selected = true;
  dom.actorSelect.innerHTML = '';
  dom.actorSelect.appendChild(opt);
  dom.actorSelect.disabled = true;
  dom.actorSelect.title = 'Actions are recorded under your own signed-in identity and cannot be changed here.';
}

// ─── Load Tasks ─────────────────────────────────────────────────────────────
async function loadTasks(silent = false) {
  if (!hasTenantWorkspaceAccess()) {
    if (!silent) showToast('Sign in as a tenant user or use a tenant service key first.', 'info');
    return;
  }
  
  // Show skeleton
  if (!silent) {
    dom.tasksGrid.closest('.tasks-panel')?.setAttribute('aria-busy', 'true');
    dom.tasksSkeleton.classList.remove('hidden');
    dom.tasksEmptyState.classList.add('hidden');
    dom.tasksError.classList.add('hidden');
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
    dom.tasksErrorText.textContent = err.message || 'Check your connection and try again.';
    dom.tasksError.classList.remove('hidden');
    updateConnectionStatus(false);
  } finally {
    dom.tasksSkeleton.classList.add('hidden');
    dom.tasksGrid.closest('.tasks-panel')?.setAttribute('aria-busy', 'false');
  }
}

function hasTenantWorkspaceAccess() {
  return apiState.authScope === 'tenant' || apiState.authScope === 'tenant_service' || !!apiState.apiKey;
}

// ─── Role/Queue Scoping ─────────────────────────────────────────────────────
// Mirrors the server's own canWorkTask/canAssignTask checks (packages/core
// access-control.js) purely for what the UI shows by default — the server
// re-checks every action regardless, so this is a UX filter, not a security
// boundary. workflow_admin and queues:['*'] both mean "sees everything".
function currentUserQueues() {
  if (apiState.authScope !== 'tenant') return null;
  const user = apiState.currentUser;
  if (!user) return [];
  if ((user.roles || []).includes('workflow_admin') || (user.queues || []).includes('*')) return null;
  return user.queues || [];
}

function canActOnTask(task) {
  if (apiState.authScope !== 'tenant') return true;
  const user = apiState.currentUser;
  if (!user) return true;
  if ((user.roles || []).includes('workflow_admin')) return true;
  const hasQueue = (user.queues || []).includes('*') || (user.queues || []).includes(task.queue);
  const hasRole = (user.roles || []).includes(task.role);
  const canAssign = (user.canAssignQueues || []).includes('*') || (user.canAssignQueues || []).includes(task.queue);
  return (hasQueue && hasRole) || canAssign;
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
  
  const myQueues = currentUserQueues();
  const restrictToMine = myQueues !== null && dom.filterMyQueues.checked;

  queues.forEach(q => {
    const count = apiState.tasks.filter(t => t.queue === q).length;
    const elem = document.getElementById(`count-${q}`);
    if (elem) {
      elem.textContent = count;
      elem.classList.toggle('zero', count === 0);
    }
    const navItem = document.querySelector(`.queue-item[data-queue="${q}"]`);
    if (navItem) {
      navItem.classList.toggle('hidden', restrictToMine && !myQueues.includes(q));
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
  const myQueues = currentUserQueues();
  const restrictToMine = myQueues !== null && dom.filterMyQueues.checked;
  const filtered = apiState.tasks.filter(task => {
    if (apiState.activeQueue !== 'all' && task.queue !== apiState.activeQueue) return false;
    if (apiState.statusFilter && task.status !== apiState.statusFilter) return false;
    if (restrictToMine && !myQueues.includes(task.queue)) return false;

    const query = dom.taskSearch.value.trim().toLowerCase();
    if (query) {
      const matchId = task.taskId.toLowerCase().includes(query);
      const matchTitle = task.title.toLowerCase().includes(query);
      const matchDesc = task.description.toLowerCase().includes(query);
      const matchEntity = task.entity?.id?.toLowerCase().includes(query) || '';
      return matchId || matchTitle || matchDesc || matchEntity;
    }

    return true;
  }).sort((a, b) => {
    if (dom.taskSort.value === 'due') return new Date(a.dueAt || 8640000000000000) - new Date(b.dueAt || 8640000000000000);
    if (dom.taskSort.value === 'newest') return new Date(b.openedAt) - new Date(a.openedAt);
    if (dom.taskSort.value === 'oldest') return new Date(a.openedAt) - new Date(b.openedAt);
    const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
    return (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2) || new Date(a.dueAt || 8640000000000000) - new Date(b.dueAt || 8640000000000000);
  });

  dom.visibleTaskCount.textContent = `${filtered.length} shown`;
  
  if (filtered.length === 0) {
    dom.tasksEmptyState.classList.remove('hidden');
    return;
  }
  
  dom.tasksEmptyState.classList.add('hidden');
  
  filtered.forEach((task, index) => {
    const card = document.createElement('div');
    const actionable = canActOnTask(task);
    card.className = `task-card animate-in ${apiState.selectedTaskId === task.taskId ? 'active' : ''} ${actionable ? '' : 'out-of-role'}`;
    card.dataset.id = task.taskId;
    card.dataset.type = task.type || '';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${task.title}. ${getSlaLabel(task.slaStatus)}. ${getPriorityLabel(task.priority)} priority.`);
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
        <span class="task-card-title">${escapeHtml(task.title)}</span>
        ${actionable ? '' : '<span class="task-card-view-only-badge">View Only</span>'}
        <span class="sla-badge ${task.slaStatus || 'within_sla'}">${getSlaLabel(task.slaStatus)}</span>
      </div>
      <div class="task-card-body">${escapeHtml(task.description)}</div>
      <div class="task-card-footer">
        <div class="task-meta-left">
          <span class="priority-marker ${escapeHtml(task.priority || 'medium')}">${escapeHtml(getPriorityLabel(task.priority))}</span>
          <span>·</span>
          <span>${escapeHtml(assignedLabel)}</span>
        </div>
        <div class="task-meta-right">${formattedDate}</div>
      </div>
    `;
    
    const openTask = () => {
      document.querySelectorAll('.task-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectTask(task);
      // Mobile: open detail panel
      dom.detailContainer.classList.add('panel-open');
    };
    card.addEventListener('click', openTask);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTask(); }
    });
    
    dom.tasksGrid.appendChild(card);
  });
}

// ─── Select Task & Fill Details ─────────────────────────────────────────────
function selectTask(task) {
  apiState.selectedTaskId = task.taskId;
  recordScreenActivity('task_opened', 'staff.task_detail', 'open_task', 'workflow_task');
  
  dom.detailEmptyState.classList.add('hidden');
  dom.detailContent.classList.remove('hidden');
  
  // Fill details
  dom.detailPriority.textContent = getPriorityLabel(task.priority);
  dom.detailPriority.className = `priority-badge ${task.priority || 'medium'}`;
  dom.detailTitle.textContent = task.title;
  dom.detailDescription.textContent = task.description;
  dom.detailTaskId.textContent = task.taskId;
  dom.detailRole.textContent = task.role;
  dom.detailSlaStatus.textContent = getSlaLabel(task.slaStatus);
  dom.detailSlaStatus.className = `meta-value sla-badge ${task.slaStatus || 'within_sla'}`;
  
  const due = task.dueAt ? new Date(task.dueAt).toLocaleString() : 'N/A';
  dom.detailDueAt.textContent = due;
  
  // Regulatory reference tags
  if (task.regulatoryRefs && task.regulatoryRefs.length > 0) {
    dom.detailRegulatoryBox.classList.remove('hidden');
    dom.detailRegulatoryTags.innerHTML = task.regulatoryRefs.map(ref => `<span class="ref-tag">${escapeHtml(ref)}</span>`).join('');
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

function clearTaskFilters() {
  apiState.activeQueue = 'all';
  apiState.statusFilter = '';
  dom.taskSearch.value = '';
  dom.taskSort.value = 'priority';
  dom.filterStatus.value = '';
  dom.filterMyQueues.checked = false;
  document.querySelectorAll('.queue-item').forEach(item => {
    const active = item.dataset.queue === 'all';
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  renderSidebarCounts();
  renderTasksList();
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
    if (ev.notes) extraText = `<div class="event-notes">${escapeHtml(ev.notes)}</div>`;
    if (ev.comment) extraText = `<div class="event-notes">“${escapeHtml(ev.comment)}”</div>`;
    if (ev.reason) extraText = `<div class="event-notes">Reason: ${escapeHtml(ev.reason)}</div>`;
    
    // Icon glyphs
    let dotIcon = '●';
    if (typeClass === 'assigned') dotIcon = '→';
    if (typeClass === 'started') dotIcon = '▶';
    
    item.className = `timeline-event ${typeClass}`;
    item.innerHTML = `
      <div class="event-dot">${dotIcon}</div>
      <div class="event-content">
        <div class="event-meta">
          <span>${escapeHtml(text)}</span>
          <span>${escapeHtml(time)}</span>
        </div>
        <div class="event-text">Actor: <strong>${escapeHtml(actorLabel)}</strong></div>
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
[dom.dialogRelease, dom.dialogDelivery, dom.dialogDecline, dom.dialogAdmin].forEach(dialog => {
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

// ─── Authentication & Administration ───────────────────────────────────────

function setLoginScope(scope) {
  dom.loginTabs.forEach(tab => {
    const active = tab.dataset.loginScope === scope;
    tab.classList.toggle('active', active);
  });
  dom.tenantLoginForm.classList.toggle('hidden', scope !== 'tenant');
  dom.platformLoginForm.classList.toggle('hidden', scope !== 'platform');
  hideLoginError(dom.tenantLoginError);
  hideLoginError(dom.platformLoginError);
}

function showLoginError(el, message) {
  el.textContent = message;
  el.classList.remove('hidden');
}

function hideLoginError(el) {
  el.classList.add('hidden');
  el.textContent = '';
}

async function handleTenantLogin(event) {
  event.preventDefault();
  hideLoginError(dom.tenantLoginError);
  try {
    const context = await bareFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        scope: 'tenant',
        tenantId: document.getElementById('login-tenant-id').value.trim(),
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value,
        mfaCode: dom.loginMfaCode.value.trim()
      })
    });
    await onLoginSuccess(context, `Tenant: ${context.tenant?.tenantId || 'active'}`);
  } catch (err) {
    handleLoginError(err, dom.tenantLoginError, dom.tenantLoginMfaGroup, dom.loginMfaCode);
  }
}

async function handlePlatformLogin(event) {
  event.preventDefault();
  hideLoginError(dom.platformLoginError);
  try {
    const context = await bareFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        scope: 'platform',
        email: document.getElementById('platform-login-email').value.trim(),
        password: document.getElementById('platform-login-password').value,
        mfaCode: dom.platformLoginMfaCode.value.trim()
      })
    });
    await onLoginSuccess(context, `Platform: ${context.user?.email || 'admin'}`);
  } catch (err) {
    handleLoginError(err, dom.platformLoginError, dom.platformLoginMfaGroup, dom.platformLoginMfaCode);
  }
}

// Shared by both login forms: reveals the authenticator-code field on
// mfa_code_required so the user can resubmit with a code, shows a countdown
// message for lockouts instead of a generic failure, and surfaces every
// other server-side error inline rather than only as a transient toast.
function handleLoginError(err, errorEl, mfaGroupEl, mfaCodeInput) {
  if (err.code === 'mfa_code_required') {
    mfaGroupEl.classList.remove('hidden');
    mfaCodeInput.focus();
    showLoginError(errorEl, 'Enter the 6-digit code from your authenticator app.');
    return;
  }
  if (err.code === 'login_locked') {
    showLoginError(errorEl, 'Too many failed attempts. This account is temporarily locked — try again in a few minutes.');
    return;
  }
  showLoginError(errorEl, err.message);
}

// After a successful /auth/login, the session may still be "restricted" —
// the account has MFA enrollment or a forced password change outstanding.
// The server 403s every other route for a restricted session, so the client
// must resolve it here before touching the workspace.
async function onLoginSuccess(context, connectionLabel) {
  applyAuthenticatedContext(context);
  if (context.session?.restricted) {
    openRequiredActionDialog(context.session.restricted, context.scope);
    return;
  }
  showApp();
  if (context.scope === 'tenant') {
    await loadTenantWorkspace(connectionLabel);
  } else {
    updateConnectionStatus(true, connectionLabel);
    showToast('Platform admin session active.', 'success');
    openAdminConsole();
  }
}

async function logout() {
  try {
    if (apiState.authScope === 'tenant' || apiState.authScope === 'platform') {
      await bareFetch('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    }
  } catch (_) {}
  apiState.apiKey = '';
  apiState.authScope = '';
  apiState.currentUser = null;
  apiState.currentTenant = null;
  apiState.actors = [];
  apiState.tasks = [];
  apiState.connected = false;
  dom.apiKeyInput.value = '';
  dom.actorSelect.disabled = false;
  dom.actorSelect.title = '';
  dom.actorSelect.innerHTML = '<option value="">— Sign In First —</option>';
  closeDetails();
  updateConnectionStatus(false);
  updateAdminButtonVisibility();
  document.title = 'LoanOS India — Loan Officer Workspace';
  setLoginScope('tenant');
  showLogin();
}

// ─── Required-Action Dialog (MFA setup / forced password change) ──────────
// Shown right after login when the session came back "restricted" — the
// account has an outstanding required action and every other route 403s
// until it's resolved. This dialog is the only thing the user can interact
// with until they clear it (or sign out).
let requiredActionReason = null;
let requiredActionScope = null;

function openRequiredActionDialog(reason, scope) {
  requiredActionReason = reason;
  requiredActionScope = scope;
  dom.requiredActionMfaSetup.classList.toggle('hidden', reason !== 'mfa_setup');
  dom.requiredActionPasswordForm.classList.toggle('hidden', reason !== 'password_change');
  if (reason === 'mfa_setup') {
    dom.requiredActionTitle.textContent = 'Set Up Multi-Factor Authentication';
    dom.requiredActionSubtitle.textContent = 'Your account requires MFA before you can continue.';
    dom.mfaSetupSecret.textContent = '';
    dom.mfaSetupCode.value = '';
    hideLoginError(dom.mfaSetupError);
    dom.dialogRequiredAction.showModal();
    beginRequiredMfaSetup();
    return;
  }
  dom.requiredActionTitle.textContent = 'Password Change Required';
  dom.requiredActionSubtitle.textContent = 'An administrator reset your password.';
  dom.requiredActionPasswordForm.reset();
  hideLoginError(dom.forcedPasswordError);
  dom.dialogRequiredAction.showModal();
}

dom.btnMfaSetupConfirm.addEventListener('click', async () => {
  hideLoginError(dom.mfaSetupError);
  try {
    if (!dom.mfaSetupSecret.textContent) {
      showLoginError(dom.mfaSetupError, 'Password is required to start enrollment. Sign out and back in if you were not prompted.');
      return;
    }
    await bareFetch('/auth/mfa/enable', {
      method: 'POST',
      body: JSON.stringify({ code: dom.mfaSetupCode.value.trim() })
    });
    dom.dialogRequiredAction.close();
    showToast('MFA enabled.', 'success');
    await resumeAfterRequiredAction();
  } catch (err) {
    showLoginError(dom.mfaSetupError, err.message);
  }
});

// The setup key has to come from a password the user just typed at login
// (never persisted), so we ask for it once via the dialog subtitle field —
// re-using the login password field's value would be a layering violation,
// so instead we prompt for it inline the first time the dialog opens.
async function beginRequiredMfaSetup() {
  const password = prompt('Re-enter your password to begin MFA enrollment:');
  if (!password) return;
  try {
    const result = await bareFetch('/auth/mfa/setup', {
      method: 'POST',
      body: JSON.stringify({ password })
    });
    dom.mfaSetupSecret.textContent = result.secret;
    dom.mfaSetupOtpauthLink.href = result.otpauthUrl;
  } catch (err) {
    showLoginError(dom.mfaSetupError, err.message);
  }
}

dom.requiredActionPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideLoginError(dom.forcedPasswordError);
  try {
    await bareFetch('/auth/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: dom.forcedPasswordCurrent.value,
        newPassword: dom.forcedPasswordNew.value
      })
    });
    dom.dialogRequiredAction.close();
    showToast('Password updated.', 'success');
    await resumeAfterRequiredAction();
  } catch (err) {
    showLoginError(dom.forcedPasswordError, err.message);
  }
});

dom.btnRequiredActionSignout.addEventListener('click', async () => {
  dom.dialogRequiredAction.close();
  await logout();
});

async function resumeAfterRequiredAction() {
  const context = await bareFetch('/auth/me');
  applyAuthenticatedContext(context);
  showApp();
  if (context.scope === 'tenant') {
    await loadTenantWorkspace(`Tenant: ${context.tenant?.tenantId || 'active'}`);
  } else {
    updateConnectionStatus(true, `Platform: ${context.user?.email || 'admin'}`);
  }
}

// ─── Account Security Settings (self-service) ──────────────────────────────
function setAccountTab(tabName) {
  dom.accountTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.accountTab === tabName);
  });
  document.querySelectorAll('#dialog-account .admin-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `account-panel-${tabName}`);
  });
}

function openAccountConsole() {
  dom.accountPasswordForm.reset();
  setAccountTab('password');
  const mfaEnabled = apiState.currentUser?.mfaEnabled;
  dom.accountMfaStatusPill.textContent = mfaEnabled ? 'enabled' : 'disabled';
  dom.accountMfaStatusPill.classList.toggle('admin-pill-success', !!mfaEnabled);
  dom.accountMfaEnrollForm.classList.toggle('hidden', !!mfaEnabled);
  dom.accountMfaDisableForm.classList.toggle('hidden', !mfaEnabled);
  dom.accountMfaEnrollDetails.classList.add('hidden');
  dom.accountMfaPassword.value = '';
  dom.accountMfaSecret.textContent = '';
  dom.accountMfaConfirmCode.value = '';
  dom.dialogAccount.showModal();
}

dom.accountTabs.forEach(tab => {
  tab.addEventListener('click', () => setAccountTab(tab.dataset.accountTab));
});

dom.accountPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await bareFetch('/auth/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: dom.accountCurrentPassword.value,
        newPassword: dom.accountNewPassword.value
      })
    });
    dom.accountPasswordForm.reset();
    showToast('Password changed. Other sessions for this account were signed out.', 'success');
  } catch (err) {
    showToast(`Password change failed: ${err.message}`, 'error');
  }
});

dom.btnAccountMfaStart.addEventListener('click', async () => {
  try {
    const result = await bareFetch('/auth/mfa/setup', {
      method: 'POST',
      body: JSON.stringify({ password: dom.accountMfaPassword.value })
    });
    dom.accountMfaSecret.textContent = result.secret;
    dom.accountMfaEnrollDetails.classList.remove('hidden');
  } catch (err) {
    showToast(`Could not start MFA enrollment: ${err.message}`, 'error');
  }
});

dom.btnAccountMfaConfirm.addEventListener('click', async () => {
  try {
    await bareFetch('/auth/mfa/enable', {
      method: 'POST',
      body: JSON.stringify({ code: dom.accountMfaConfirmCode.value.trim() })
    });
    showToast('MFA enabled.', 'success');
    const context = await bareFetch('/auth/me');
    applyAuthenticatedContext(context);
    openAccountConsole();
  } catch (err) {
    showToast(`Could not confirm MFA: ${err.message}`, 'error');
  }
});

dom.accountMfaDisableForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await bareFetch('/auth/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({
        password: dom.accountMfaDisablePassword.value,
        code: dom.accountMfaDisableCode.value.trim()
      })
    });
    showToast('MFA disabled.', 'success');
    const context = await bareFetch('/auth/me');
    applyAuthenticatedContext(context);
    openAccountConsole();
  } catch (err) {
    showToast(`Could not disable MFA: ${err.message}`, 'error');
  }
});

function setAdminTab(tabName) {
  dom.adminTabs.forEach(tab => {
    const active = tab.dataset.adminTab === tabName;
    tab.classList.toggle('active', active);
  });
  document.querySelectorAll('.admin-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `admin-panel-${tabName}`);
  });
  if (tabName === 'audit') {
    loadAuditEvents();
  }
  if (tabName === 'platform-access') {
    loadPlatformUsers();
    loadBreakGlassGrants(document.getElementById('break-glass-tenant-id').value.trim());
  }
  if (tabName === 'iam') loadIamWorkspace();
  if (tabName === 'identity-ops') loadIdentityOperations();
}

const PLATFORM_ONLY_ADMIN_TABS = new Set(['platform', 'platform-access']);
const TENANT_ONLY_ADMIN_TABS = new Set(['users', 'reviews', 'service', 'iam', 'identity-ops']);

async function openAdminConsole() {
  if (!canOpenTenantAdmin()) {
    showToast('Your account does not have an administration role.', 'warning');
    return;
  }
  const isPlatform = apiState.authScope === 'platform';
  dom.adminTabs.forEach(tab => {
    const name = tab.dataset.adminTab;
    const irrelevant = isPlatform ? TENANT_ONLY_ADMIN_TABS.has(name) : PLATFORM_ONLY_ADMIN_TABS.has(name);
    tab.classList.toggle('hidden', irrelevant);
  });
  dom.dialogAdmin.showModal();
  setAdminTab(isPlatform ? 'platform' : 'users');
  await refreshAdminConsole();
}

async function refreshAdminConsole() {
  if (apiState.authScope === 'platform') {
    await renderPlatformAdmin();
    return;
  }
  if (!hasTenantWorkspaceAccess()) {
    showToast('Tenant administration requires tenant login or service key.', 'warning');
    return;
  }
  await renderTenantAdmin();
}

async function renderTenantAdmin() {
  try {
    const [summary, users, reviews] = await Promise.all([
      apiFetch('/admin/governance-summary'),
      apiFetch('/admin/users'),
      apiFetch('/admin/access-reviews')
    ]);
    dom.adminSummary.innerHTML = renderSummaryCards([
      ['Users', summary.users.total],
      ['Active', summary.users.active],
      ['Suspended', summary.users.suspended],
      ['Open Reviews', summary.accessReviews.open],
      ['Readiness', summary.onboarding?.status || 'unknown']
    ]);
    dom.adminUsersList.innerHTML = (users.users || []).map(renderUserRow).join('') || emptyAdminRow('No tenant users yet.');
    dom.adminReviewsList.innerHTML = (reviews.accessReviews || []).map(renderReviewRow).join('') || emptyAdminRow('No access reviews yet.');
    dom.adminRotatedKeyOutput.textContent = '';
    populatePrincipalDatalist(users.users);
  } catch (err) {
    showToast(`Admin load failed: ${err.message}`, 'error');
  }
}

async function loadIdentityOperations() {
  try {
    const [summaryResponse, campaignsResponse, automationResponse, drillsResponse, conformanceResponse, workerResponse, activationResponse] = await Promise.all([
      apiFetch('/admin/identity-operations/summary'),
      apiFetch('/admin/identity-operations/conformance/campaigns'),
      apiFetch('/admin/identity-operations/automation/runs'),
      apiFetch('/admin/identity-operations/drills'),
      apiFetch('/admin/conformance/summary'),
      apiFetch('/admin/identity-operations/worker'),
      apiFetch('/admin/tenant-activation/assessments')
    ]);
    const summary = summaryResponse.summary;
    document.getElementById('identity-ops-summary').innerHTML = renderSummaryCards([
      ['Readiness', summary.status],
      ['Active users', summary.users.active],
      ['Active sessions', summary.sessions.active],
      ['Federation policies', `${summary.federation.active} active / ${summary.federation.suspended} suspended`],
      ['Simulator-certified', `${summary.conformance.simulatorCertifiedFamilies.length}/${summary.conformance.requiredFamilies.length}`],
      ['Open escalations', summary.pending.escalations]
    ]);
    const campaigns = campaignsResponse.campaigns || [];
    document.getElementById('identity-campaigns-list').innerHTML = campaigns.length ? campaigns.map(campaign => `
      <div class="admin-row">
        <div class="admin-row-title">${escapeHtml(campaign.family)} · ${escapeHtml(campaign.campaignId)}</div>
        <p>${escapeHtml(campaign.status)} · ${Object.keys(campaign.results || {}).length}/${campaign.scenarioIds.length} scenarios · ${campaign.commerciallyLive ? 'live' : 'simulated only'}</p>
        ${campaign.manifestChecksumSha256 ? `<code>${escapeHtml(campaign.manifestChecksumSha256)}</code>` : ''}
      </div>`).join('') : emptyAdminRow('No identity conformance campaigns yet.');
    const automationRuns = automationResponse.runs || [];
    const drills = drillsResponse.drills || [];
    document.getElementById('identity-automation-list').innerHTML = [
      ...automationRuns.map(run => `<div class="admin-row"><div class="admin-row-header"><div class="admin-row-title">Automation · ${escapeHtml(run.runId)}</div><span class="admin-pill">${escapeHtml(run.status)}</span></div><p>${escapeHtml(run.executionEvidenceRef || '')} · ${(run.findings || []).length} finding(s)</p></div>`),
      ...drills.map(drill => `<div class="admin-row"><div class="admin-row-header"><div class="admin-row-title">Drill · ${escapeHtml(drill.drillId)}</div><span class="admin-pill">${escapeHtml(drill.status)}</span></div><p>${escapeHtml(drill.scenario)} · ${escapeHtml(drill.objective)}</p>${drill.status === 'pending_witness' ? `<button type="button" class="btn btn-primary btn-sm" data-identity-drill="${escapeHtml(drill.drillId)}">Load for witness</button>` : ''}</div>`)
    ].join('') || emptyAdminRow('No readiness automation runs or resilience drills yet.');
    const conformance = conformanceResponse.summary;
    document.getElementById('conformance-campaigns-list').innerHTML = (conformance.campaigns || []).map(campaign => `<div class="admin-row"><div class="admin-row-header"><div class="admin-row-title">${escapeHtml(campaign.targetType)} · ${escapeHtml(campaign.targetId)}</div><span class="admin-pill">${escapeHtml(campaign.status)}</span></div><p>${escapeHtml(campaign.campaignId)} · ${Object.keys(campaign.results || {}).length}/${campaign.manifest.scenarios.length} canonical scenarios · simulated only</p><code>${escapeHtml(campaign.manifestChecksumSha256)}</code></div>`).join('') || emptyAdminRow('No cross-platform conformance campaigns yet.');
    const workerRows = [...(workerResponse.jobs || []).map(job => `<div class="admin-row"><div class="admin-row-header"><div class="admin-row-title">${escapeHtml(job.type)} · ${escapeHtml(job.jobId)}</div><span class="admin-pill">${escapeHtml(job.status)}</span></div><p>attempt ${job.attempt}/${job.maxAttempts} · ${escapeHtml(job.workloadIdentityRef)}</p></div>`), ...(workerResponse.deadLetters || []).map(item => `<div class="admin-row"><div class="admin-row-header"><div class="admin-row-title">Dead letter · ${escapeHtml(item.jobId)}</div><span class="admin-pill">${escapeHtml(item.status)}</span></div><p>${escapeHtml(item.lastError?.errorCode || 'worker failure')} · independent replay approval required</p></div>`), ...(workerResponse.escalations || []).filter(item => item.status === 'open').map(item => `<div class="admin-row"><div class="admin-row-header"><div class="admin-row-title">Escalation · ${escapeHtml(item.jobId)}</div><span class="admin-pill">critical</span></div><p>${escapeHtml(item.requiredAction)}</p></div>` )];
    document.getElementById('identity-worker-list').innerHTML = workerRows.join('') || emptyAdminRow('No durable worker jobs, dead letters or escalations yet.');
    document.getElementById('tenant-activation-list').innerHTML = (activationResponse.assessments || []).map(item => `<div class="admin-row"><div class="admin-row-header"><div class="admin-row-title">${escapeHtml(item.assessmentId)}</div><span class="admin-pill">${escapeHtml(item.status)}</span></div><p>${item.blockers.length} blocker(s) · ${item.productionGaps.length} production gap(s) · platform approval required</p><code>${escapeHtml(item.assessmentChecksumSha256)}</code></div>`).join('') || emptyAdminRow('No unified activation assessment has been recorded.');
    prefillIdentityOperationsRequestIds();
  } catch (err) {
    showToast(`Identity control room load failed: ${err.message}`, 'error');
  }
}

async function loadIamWorkspace() {
  try {
    const [workspaceResponse, catalogue] = await Promise.all([
      apiFetch('/admin/identity-governance/workspace'),
      apiFetch('/admin/identity-governance/roles')
    ]);
    apiState.iamWorkspace = workspaceResponse.workspace;
    apiState.iamCatalogue = catalogue;
    const workspace = workspaceResponse.workspace;
    document.getElementById('iam-summary').innerHTML = renderSummaryCards([
      ['Principals', workspace.summary.principals],
      ['Active humans', workspace.summary.activeHumans],
      ['Active agents', workspace.summary.activeAgents],
      ['Pending approvals', workspace.summary.pendingApprovals],
      ['Open escalations', workspace.summary.openEscalations],
      ['Launch coverage', workspace.launchCoverage.ready ? 'ready' : 'blocked']
    ]);
    populateIamSelectors(catalogue, workspace.tenantId);
    renderIamRoleCatalogue();
    renderIamPrincipals(workspace);
    renderIamRoleRequests(workspace.roleRequests);
    renderIamFeatureReadiness(workspace);
    renderIamEscalations(workspace);
    renderIamOwnership(workspace);
    renderIamEmergencyAccess(workspace);
    prefillIamRequestIds();
  } catch (err) {
    showToast(`Access-governance workspace load failed: ${err.message}`, 'error');
  }
}

function populateIamSelectors(catalogue, tenantId) {
  const roleSelect = document.getElementById('iam-grant-roles');
  const selectedRoles = new Set(Array.from(roleSelect.selectedOptions).map(option => option.value));
  roleSelect.innerHTML = (catalogue.roles || []).filter(role => role.assignable).map(role =>
    `<option value="${escapeHtml(role.roleId)}" ${selectedRoles.has(role.roleId) ? 'selected' : ''}>${escapeHtml(role.displayName)} · ${escapeHtml(role.domain)}</option>`
  ).join('');
  const featureSelect = document.getElementById('iam-staffing-feature');
  const selectedFeature = featureSelect.value;
  featureSelect.innerHTML = (catalogue.featureStaffingPolicies || []).map(feature =>
    `<option value="${escapeHtml(feature.featureId)}">${escapeHtml(feature.featureId)} · ${escapeHtml(feature.name)}</option>`
  ).join('');
  if (selectedFeature) featureSelect.value = selectedFeature;
  ['iam-grant-scope-id', 'iam-staffing-scope-id'].forEach(id => {
    const field = document.getElementById(id);
    if (!field.value) field.placeholder = `Scope ID (tenant: ${tenantId})`;
  });
}

function renderIamRoleCatalogue() {
  const catalogue = apiState.iamCatalogue;
  if (!catalogue) return;
  const query = document.getElementById('iam-role-filter').value.trim().toLowerCase();
  const roles = (catalogue.roles || []).filter(role => !query || [role.roleId, role.displayName, role.domain, ...(role.allowedActions || [])].join(' ').toLowerCase().includes(query));
  document.getElementById('iam-role-catalogue').innerHTML = roles.map(role => `
    <div class="admin-row iam-role-row">
      <div class="admin-row-header"><div class="admin-row-title">${escapeHtml(role.displayName)}</div><span class="admin-pill">${escapeHtml(role.privilege)}</span></div>
      <p><code>${escapeHtml(role.roleId)}</code> · ${escapeHtml(role.domain)} · ${role.assignable ? 'tenant assignable' : 'trusted boundary only'}</p>
      <p>${(role.allowedActions || []).map(action => `<code>${escapeHtml(action)}</code>`).join(' ') || 'No direct action'}</p>
    </div>`).join('') || emptyAdminRow('No canonical role matches this filter.');
  document.getElementById('iam-sod-catalogue').innerHTML = (catalogue.segregationOfDutiesRules || []).map(rule => `
    <div class="admin-row iam-readiness-blocked">
      <div class="admin-row-title">${escapeHtml(rule.ruleId)}</div>
      <p>${rule.roles.map(role => `<code>${escapeHtml(role)}</code>`).join(' cannot coexist with ')}</p>
      <span class="admin-pill">hard enforcement</span>
    </div>`).join('');
}

function renderIamPrincipals(workspace) {
  document.getElementById('iam-principals-list').innerHTML = (workspace.principals || []).map(access => {
    const principal = access.principal;
    return `<div class="admin-row iam-principal-row">
      <div class="admin-row-header"><div><div class="admin-row-title">${escapeHtml(principal.displayName)}</div><p><code>${escapeHtml(principal.principalId)}</code> · ${escapeHtml(principal.principalType)}</p></div><span class="admin-pill">${escapeHtml(principal.status)}</span></div>
      <p>Effective roles: ${access.roleIds.map(role => `<code>${escapeHtml(role)}</code>`).join(' ') || 'none'}</p>
      ${principal.sponsorPrincipalId ? `<p>Sponsor: <code>${escapeHtml(principal.sponsorPrincipalId)}</code>${principal.expiresAt ? ` · expires ${escapeHtml(principal.expiresAt)}` : ''}</p>` : ''}
      ${access.sodViolations.length ? `<p class="admin-pill admin-pill-warning">SoD violations: ${access.sodViolations.map(item => escapeHtml(item.ruleId)).join(', ')}</p>` : ''}
      <div class="op-buttons"><button class="btn btn-secondary btn-sm" type="button" data-iam-principal="${escapeHtml(principal.principalId)}">Manage / assess</button>${access.activeGrants.map(grant => `<button class="btn btn-secondary btn-sm" type="button" data-iam-grant="${escapeHtml(grant.grantId)}">Revoke ${escapeHtml(grant.roleId)}</button>`).join('')}</div>
    </div>`;
  }).join('') || emptyAdminRow('No canonical principals are registered yet. Bind verified tenant users first.');
}

function renderIamRoleRequests(requests) {
  document.getElementById('iam-role-requests-list').innerHTML = (requests || []).map(request => `
    <div class="admin-row">
      <div class="admin-row-header"><div><div class="admin-row-title">${escapeHtml(request.requestType)} · ${escapeHtml(request.requestId)}</div><p>${escapeHtml(request.principalId)} · proposed by ${escapeHtml(request.proposedBy)}</p></div><span class="admin-pill">${escapeHtml(request.status)}</span></div>
      <p>${request.requestType === 'grant' ? (request.roleIds || []).map(escapeHtml).join(', ') : (request.grantIds || []).map(escapeHtml).join(', ')} · ${escapeHtml(request.reason)}</p>
      ${request.status === 'pending' ? `<button type="button" class="btn btn-primary btn-sm" data-iam-role-approval="${escapeHtml(request.requestId)}" data-request-kind="${escapeHtml(request.requestType)}">Load for independent approval</button>` : ''}
    </div>`).join('') || emptyAdminRow('No role requests have been recorded.');
}

function renderIamFeatureReadiness(workspace) {
  const requestRows = (workspace.staffingRequests || []).map(request => `
    <div class="admin-row"><div class="admin-row-header"><div class="admin-row-title">Configuration · ${escapeHtml(request.requestId)}</div><span class="admin-pill">${escapeHtml(request.status)}</span></div><p>${(request.features || []).map(feature => escapeHtml(`${feature.featureId}:${feature.requestedStatus || 'enabled'}`)).join(', ')}</p>${request.status === 'pending' ? `<button type="button" class="btn btn-primary btn-sm" data-iam-staffing-approval="${escapeHtml(request.requestId)}">Load for approval</button>` : ''}</div>`);
  const featureRows = (workspace.featureReadiness.features || []).map(feature => `
    <div class="admin-row ${feature.ready ? 'iam-readiness-ready' : 'iam-readiness-blocked'}"><div class="admin-row-header"><div><div class="admin-row-title">${escapeHtml(feature.featureId)} · ${escapeHtml(feature.name)}</div><p>${escapeHtml(feature.scope.type)}:${escapeHtml(feature.scope.id)} · ${escapeHtml(feature.plane)}</p></div><span class="admin-pill">${feature.ready ? 'ready' : 'blocked'}</span></div><p>${feature.blockers.length ? feature.blockers.map(escapeHtml).join(', ') : `${feature.distinctPrincipalIds.length} distinct staffed principals`}</p></div>`);
  document.getElementById('iam-feature-readiness-list').innerHTML = [...requestRows, ...featureRows].join('') || emptyAdminRow('No features are configured. Propose the first staffing configuration to enable one.');
}

function renderIamEscalations(workspace) {
  const closureByEscalation = new Map((workspace.staffingClosureRequests || []).map(request => [request.escalationId, request]));
  document.getElementById('iam-escalations-list').innerHTML = (workspace.staffingEscalations || []).map(escalation => {
    const closure = closureByEscalation.get(escalation.escalationId);
    return `<div class="admin-row ${escalation.status === 'open' ? 'iam-readiness-blocked' : 'iam-readiness-ready'}"><div class="admin-row-header"><div><div class="admin-row-title">${escapeHtml(escalation.featureId)}</div><p><code>${escapeHtml(escalation.escalationId)}</code></p></div><span class="admin-pill">${escapeHtml(escalation.status)}</span></div><p>${(escalation.blockers || []).map(escapeHtml).join(', ')}</p>${escalation.status === 'open' ? `<button type="button" class="btn btn-secondary btn-sm" data-iam-escalation="${escapeHtml(escalation.escalationId)}">Prepare closure</button>` : ''}${closure?.status === 'pending' ? `<button type="button" class="btn btn-primary btn-sm" data-iam-escalation-approval="${escapeHtml(closure.requestId)}">Load independent approval</button>` : ''}</div>`;
  }).join('') || emptyAdminRow('No staffing escalations are open or retained.');
}

function renderIamOwnership(workspace) {
  const ownership = workspace.ownership;
  const current = ownership ? `<div class="admin-row"><div class="admin-row-header"><div class="admin-row-title">Current owner · ${escapeHtml(ownership.ownerPrincipalId)}</div><span class="admin-pill">${escapeHtml(ownership.status)}</span></div></div>` : emptyAdminRow('No tenant ownership has been activated.');
  const requests = (workspace.ownershipTransferRequests || []).map(request => `<div class="admin-row"><div class="admin-row-header"><div class="admin-row-title">${escapeHtml(request.oldOwnerPrincipalId)} → ${escapeHtml(request.newOwnerPrincipalId)}</div><span class="admin-pill">${escapeHtml(request.status)}</span></div><p>${escapeHtml(request.requestId)} · ${escapeHtml(request.reason)}</p>${request.status === 'pending' ? `<button type="button" class="btn btn-primary btn-sm" data-iam-owner-approval="${escapeHtml(request.requestId)}">Load independent approval</button>` : ''}</div>`).join('');
  document.getElementById('iam-ownership-list').innerHTML = current + requests;
}

function renderIamEmergencyAccess(workspace) {
  const requests = (workspace.emergencyAccessRequests || []).map(request => `<div class="admin-row"><div class="admin-row-header"><div class="admin-row-title">Request · ${escapeHtml(request.requestId)}</div><span class="admin-pill">${escapeHtml(request.status)}</span></div><p>${escapeHtml(request.beneficiaryPrincipalId)} · ${(request.actions || []).map(escapeHtml).join(', ')} · expires ${escapeHtml(request.expiresAt)}</p>${request.status === 'pending' ? `<button type="button" class="btn btn-primary btn-sm" data-iam-emergency-approval="${escapeHtml(request.requestId)}">Load independent approval</button>` : ''}</div>`);
  const grants = (workspace.emergencyAccessGrants || []).map(grant => `<div class="admin-row ${grant.effectiveStatus === 'active' ? 'iam-readiness-blocked' : ''}"><div class="admin-row-header"><div class="admin-row-title">Grant · ${escapeHtml(grant.emergencyGrantId)}</div><span class="admin-pill">${escapeHtml(grant.effectiveStatus)}</span></div><p>${escapeHtml(grant.principalId)} · ${(grant.actions || []).map(escapeHtml).join(', ')}</p>${grant.effectiveStatus === 'active' ? `<button type="button" class="btn btn-warning btn-sm" data-iam-emergency-grant="${escapeHtml(grant.emergencyGrantId)}">Prepare closure</button>` : ''}</div>`);
  document.getElementById('iam-emergency-list').innerHTML = [...requests, ...grants].join('') || emptyAdminRow('No tenant emergency-access requests or grants.');
}

async function renderPlatformAdmin() {
  try {
    const [summary, tenants] = await Promise.all([
      apiFetch('/platform/admin-summary'),
      apiFetch('/platform/tenants')
    ]);
    dom.platformSummary.innerHTML = renderSummaryCards([
      ['Tenants', summary.tenants.total],
      ['Active', summary.tenants.active],
      ['Sandboxes', summary.tenants.sandboxes],
      ['Sub-processors', summary.subProcessors]
    ]);
    dom.platformTenantsList.innerHTML = (tenants.tenants || []).map(renderTenantRow).join('') || emptyAdminRow('No tenants provisioned.');
  } catch (err) {
    showToast(`Platform admin load failed: ${err.message}`, 'error');
  }
}

function renderSummaryCards(cards) {
  return cards.map(([label, value]) => `
    <div class="admin-summary-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `).join('');
}

function renderUserRow(user) {
  const nextStatus = user.status === 'active' ? 'suspended' : 'active';
  const isSelf = apiState.authScope === 'tenant' && apiState.currentUser?.userId === user.userId;
  return `
    <div class="admin-row">
      <div class="admin-row-header">
        <div>
          <div class="admin-row-title">${escapeHtml(user.displayName || user.email)}${isSelf ? ' (you)' : ''}</div>
          <p>${escapeHtml(user.email)} · ${escapeHtml(user.userId)}</p>
        </div>
        <span class="admin-pill">${escapeHtml(user.status)}</span>
      </div>
      <p>Admin roles: ${(user.adminRoles || []).map(escapeHtml).join(', ') || 'none'}</p>
      <p>Staff roles: ${(user.roles || []).map(escapeHtml).join(', ') || 'none'}${(user.queues || []).length ? ` · queues: ${(user.queues || []).map(escapeHtml).join(', ')}` : ''}</p>
      ${user.mfaSetupPending ? '<p class="admin-pill admin-pill-warning">MFA setup pending</p>' : ''}
      ${user.mustChangePassword ? '<p class="admin-pill admin-pill-warning">Password change pending</p>' : ''}
      <div class="op-buttons">
        <button class="btn btn-secondary btn-sm" data-user-status="${escapeHtml(user.userId)}" data-status="${nextStatus}" ${isSelf && nextStatus === 'suspended' ? 'disabled title="You cannot suspend your own account"' : ''}>
          Mark ${nextStatus}
        </button>
      </div>
    </div>
  `;
}

function renderReviewRow(review) {
  const decisionRows = review.status === 'open'
    ? (review.snapshot || []).map(user => `
        <div class="review-decision-row">
          <span>${escapeHtml(user.displayName || user.email)} <span style="color:var(--text-muted)">(${escapeHtml(user.status)})</span></span>
          <div class="review-decision-actions">
            <select data-decision-user="${escapeHtml(user.userId)}">
              <option value="">No action</option>
              <option value="suspend">Suspend</option>
              <option value="remove_admin_roles">Remove admin roles</option>
            </select>
          </div>
        </div>
      `).join('')
    : (review.skippedDecisions || []).length
      ? `<p class="admin-form-hint">Skipped (last active admin): ${review.skippedDecisions.map(d => escapeHtml(`${d.userId} (${d.action})`)).join(', ')}</p>`
      : '';
  return `
    <div class="admin-row" data-review-row="${escapeHtml(review.reviewId)}">
      <div class="admin-row-header">
        <div>
          <div class="admin-row-title">${escapeHtml(review.reviewId)}</div>
          <p>${escapeHtml(review.reviewer || 'No reviewer')} · ${escapeHtml(review.snapshot?.length || 0)} users captured</p>
        </div>
        <span class="admin-pill">${escapeHtml(review.status)}</span>
      </div>
      ${decisionRows}
      ${review.status === 'open' ? `<button class="btn btn-success btn-sm" data-review-complete="${escapeHtml(review.reviewId)}">Complete Review</button>` : ''}
    </div>
  `;
}

function renderTenantRow(tenant) {
  const readiness = tenant.onboarding?.status || 'configured';
  const productCount = tenant.onboarding?.productIds?.length ?? 0;
  const nextStatus = tenant.status === 'active' ? 'suspended' : 'active';
  const canChangeStatus = tenant.status !== 'offboarded';
  return `
    <div class="admin-row">
      <div class="admin-row-header">
        <div>
          <div class="admin-row-title">${escapeHtml(tenant.name || tenant.tenantId)}</div>
          <p>${escapeHtml(tenant.tenantId)} · ${escapeHtml(tenant.isolationTier || 'pooled')}</p>
        </div>
        <span class="admin-pill">${escapeHtml(tenant.status)}</span>
      </div>
      <p>${tenant.isSandbox ? `Sandbox of ${escapeHtml(tenant.parentTenantId || '')}` : 'Production tenant'} · onboarding ${escapeHtml(readiness)} · ${escapeHtml(productCount)} product(s)</p>
      ${canChangeStatus ? `
        <div class="admin-row-actions">
          <button class="btn btn-secondary btn-sm" data-tenant-status="${escapeHtml(tenant.tenantId)}" data-status="${nextStatus}">Mark ${nextStatus}</button>
          <button class="btn btn-secondary btn-sm" data-tenant-export="${escapeHtml(tenant.tenantId)}">Export Data</button>
          <button class="btn btn-warning btn-sm" data-tenant-offboard="${escapeHtml(tenant.tenantId)}">Offboard</button>
          <button class="btn btn-secondary btn-sm" data-tenant-break-glass="${escapeHtml(tenant.tenantId)}">View Break-Glass Grants</button>
        </div>
      ` : ''}
    </div>
  `;
}

function emptyAdminRow(message) {
  return `<div class="admin-row"><p>${escapeHtml(message)}</p></div>`;
}

function setOnboardingStep(nextStep) {
  const maxStep = Math.max(0, dom.onboardingPanels.length - 1);
  apiState.onboardingStep = Math.min(Math.max(nextStep, 0), maxStep);
  dom.onboardingPanels.forEach(panel => {
    panel.classList.toggle('active', Number(panel.dataset.wizardStep) === apiState.onboardingStep);
  });
  dom.onboardingDots.forEach((dot, index) => {
    dot.classList.toggle('active', index === apiState.onboardingStep);
    dot.classList.toggle('complete', index < apiState.onboardingStep);
    if (index === apiState.onboardingStep) dot.setAttribute('aria-current', 'step');
    else dot.removeAttribute('aria-current');
  });
  dom.onboardingStepLabel.textContent = `Step ${apiState.onboardingStep + 1} of ${maxStep + 1}`;
  dom.btnOnboardingPrev.disabled = apiState.onboardingStep === 0;
  dom.btnOnboardingNext.classList.toggle('hidden', apiState.onboardingStep === maxStep);
  dom.btnOnboardingSubmit.classList.toggle('hidden', apiState.onboardingStep !== maxStep);
}

function validateCurrentOnboardingStep() {
  const panel = Array.from(dom.onboardingPanels).find(item => Number(item.dataset.wizardStep) === apiState.onboardingStep);
  if (!panel) return true;
  const invalid = Array.from(panel.querySelectorAll('input, select, textarea')).find(field => !field.checkValidity());
  if (!invalid) return true;
  invalid.reportValidity();
  invalid.focus();
  showToast('Complete the required information before continuing.', 'warning');
  return false;
}

function selectedCheckboxValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(input => input.value);
}

function slugifyId(value, fallback) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
}

function numberFromInput(id) {
  const value = Number(document.getElementById(id).value);
  return Number.isFinite(value) ? value : 0;
}

function buildTenantOnboardingPayload() {
  const tenantId = document.getElementById('platform-tenant-id').value.trim();
  const tenantName = document.getElementById('platform-tenant-name').value.trim();
  const regulatedEntityId = document.getElementById('platform-re-id').value.trim() || `${tenantId}_re`;
  const productCode = document.getElementById('platform-product-code').value.trim();
  const productId = document.getElementById('platform-product-id').value.trim() || slugifyId(productCode, `${tenantId}_product`);
  return {
    tenantId,
    name: tenantName,
    isolationTier: document.getElementById('platform-tenant-isolation').value,
    onboarding: {
      launchMode: document.getElementById('platform-launch-mode').value,
      primaryRegulatedEntityId: regulatedEntityId,
      productIds: [productId],
      enabledModules: selectedCheckboxValues('onboarding-modules'),
      enabledFlows: selectedCheckboxValues('onboarding-flows'),
      notes: document.getElementById('platform-onboarding-notes').value.trim() || null
    },
    regulatedEntity: {
      regulatedEntityId,
      regulatedEntityName: document.getElementById('platform-re-name').value.trim(),
      regulatedEntityType: document.getElementById('platform-re-type').value,
      rbiRegistrationNumber: document.getElementById('platform-re-registration').value.trim(),
      country: 'IN',
      status: 'active',
      websiteUrl: document.getElementById('platform-re-website').value.trim(),
      privacyPolicyUrl: document.getElementById('platform-re-privacy').value.trim(),
      grievanceOfficer: {
        name: document.getElementById('platform-re-grievance-name').value.trim(),
        email: document.getElementById('platform-re-grievance-email').value.trim()
      },
      dataResidency: {
        primaryStorageCountry: 'IN',
        paymentDataStorageCountry: 'IN',
        processedOutsideIndia: false
      },
      boardPolicyRefs: {
        digitalLendingPolicyRef: 'BOARD-DL-V1',
        kycPolicyRef: 'BOARD-KYC-V1',
        penalChargesPolicyRef: document.getElementById('platform-product-penal-ref').value.trim(),
        outsourcingPolicyRef: 'BOARD-OUTSOURCING-V1',
        modelRiskPolicyRef: 'BOARD-MODEL-RISK-V1',
        grievancePolicyRef: 'BOARD-GRIEVANCE-V1'
      },
      licenseMetadata: {
        category: document.getElementById('platform-re-license-category').value.trim(),
        licenseNumber: document.getElementById('platform-re-license-number').value.trim(),
        issuingAuthority: 'Reserve Bank of India',
        issueDate: document.getElementById('platform-re-license-date').value,
        status: 'active'
      }
    },
    products: [
      {
        productId,
        regulatedEntityId,
        productCode,
        productName: document.getElementById('platform-product-name').value.trim(),
        productType: document.getElementById('platform-product-type').value,
        status: 'active',
        currency: 'INR',
        minAmount: numberFromInput('platform-product-min-amount'),
        maxAmount: numberFromInput('platform-product-max-amount'),
        minTenorMonths: numberFromInput('platform-product-min-tenor'),
        maxTenorMonths: numberFromInput('platform-product-max-tenor'),
        annualInterestRateBps: numberFromInput('platform-product-rate'),
        aprBps: numberFromInput('platform-product-apr'),
        coolingOffDays: 3,
        recoveryMechanism: 'authorized_agency_only',
        interestCalcMethod: 'reducing_balance',
        eligibility: {
          minAgeYears: 18,
          maxAgeYears: 65,
          minMonthlyIncome: numberFromInput('platform-product-min-income'),
          allowedResidencyCountry: 'IN'
        },
        policyRefs: {
          boardApprovalRef: document.getElementById('platform-product-board-ref').value.trim(),
          pricingPolicyRef: document.getElementById('platform-product-pricing-ref').value.trim(),
          penalChargesPolicyRef: document.getElementById('platform-product-penal-ref').value.trim()
        }
      }
    ]
  };
}

function formatReadiness(readiness) {
  const findings = readiness?.findings ?? [];
  if (findings.length === 0) {
    return 'Readiness: ready';
  }
  return `Readiness: ${readiness.status}\n${findings.map(finding => `- ${finding.severity}: ${finding.message}`).join('\n')}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseCommaList(value) {
  return String(value ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function enhanceAccessibleForms() {
  document.querySelectorAll('dialog').forEach(dialog => {
    const heading = dialog.querySelector('h2, h3');
    if (heading?.id) dialog.setAttribute('aria-labelledby', heading.id);
  });
  document.querySelectorAll('.admin-dialog input, .admin-dialog select, .admin-dialog textarea').forEach(field => {
    if (field.getAttribute('aria-label') || field.getAttribute('aria-labelledby') || (field.id && document.querySelector(`label[for="${field.id}"]`))) return;
    const readable = field.getAttribute('placeholder') || field.id.replaceAll('-', ' ').replace(/^platform |^admin |^account /, '');
    field.setAttribute('aria-label', readable);
  });
}

function generateRandomSuffix() {
  return Math.random().toString(36).substring(2, 10);
}

function prefillFieldIfEmpty(elementId, prefix) {
  const el = document.getElementById(elementId);
  if (el && !el.value.trim()) {
    el.value = `${prefix}_${generateRandomSuffix()}`;
  }
}

function prefillIamRequestIds() {
  prefillFieldIfEmpty('iam-grant-request', 'grant_req');
  prefillFieldIfEmpty('iam-revoke-request', 'rev_req');
  prefillFieldIfEmpty('iam-staffing-request', 'staff_req');
  prefillFieldIfEmpty('iam-escalation-request', 'esc_req');
  prefillFieldIfEmpty('iam-agent-id', 'agent');
  prefillFieldIfEmpty('iam-owner-request', 'owner_req');
  prefillFieldIfEmpty('iam-emergency-request', 'emerg_req');
}

function prefillIdentityOperationsRequestIds() {
  prefillFieldIfEmpty('identity-automation-run', 'auto_run');
  prefillFieldIfEmpty('identity-drill-id', 'drill');
  prefillFieldIfEmpty('identity-worker-job-id', 'job');
  prefillFieldIfEmpty('identity-recon-id', 'recon');
  prefillFieldIfEmpty('identity-campaign-id', 'camp');
  prefillFieldIfEmpty('conformance-candidate-id', 'cand');
  prefillFieldIfEmpty('conformance-campaign-id', 'camp');
}

function populatePrincipalDatalist(users) {
  const datalist = document.getElementById('principal-list');
  if (!datalist) return;
  datalist.innerHTML = (users || []).map(u => 
    `<option value="${escapeHtml(u.userId)}">${escapeHtml(u.displayName)} (${escapeHtml(u.email)})</option>`
  ).join('');
}

function setupSubtabs(subtabSelector, panelSelector, dataAttrSubtab, dataAttrPanel) {
  const tabs = document.querySelectorAll(subtabSelector);
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll(panelSelector).forEach(panel => {
        const isTarget = panel.getAttribute(dataAttrPanel) === tab.getAttribute(dataAttrSubtab);
        panel.classList.toggle('active', isTarget);
        panel.classList.toggle('hidden', !isTarget);
      });
    });
  });
}


// ─── Event Handlers & Initializers ──────────────────────────────────────────

dom.loginTabs.forEach(tab => {
  tab.addEventListener('click', () => setLoginScope(tab.dataset.loginScope));
});

dom.tenantLoginForm.addEventListener('submit', handleTenantLogin);
dom.platformLoginForm.addEventListener('submit', handlePlatformLogin);
dom.btnServiceKeyLogin.addEventListener('click', onApiKeyChange);
dom.apiKeyInput.addEventListener('change', onApiKeyChange);
dom.btnLogout.addEventListener('click', logout);
dom.btnAdminOpen.addEventListener('click', openAdminConsole);
dom.btnAdminClose.addEventListener('click', () => dom.dialogAdmin.close());
dom.btnAccountOpen.addEventListener('click', openAccountConsole);
dom.btnAccountClose.addEventListener('click', () => dom.dialogAccount.close());

dom.btnShowAcceptInvite.addEventListener('click', () => {
  document.querySelector('.login-card:not(#accept-invite-card)').classList.add('hidden');
  dom.acceptInviteCard.classList.remove('hidden');
});
dom.btnBackToLogin.addEventListener('click', () => {
  dom.acceptInviteCard.classList.add('hidden');
  document.querySelector('.login-card:not(#accept-invite-card)').classList.remove('hidden');
});
dom.acceptInviteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideLoginError(dom.acceptInviteError);
  try {
    await bareFetch('/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify({
        tenantId: document.getElementById('invite-tenant-id').value.trim(),
        token: document.getElementById('invite-token').value.trim(),
        password: document.getElementById('invite-password').value
      })
    });
    showToast('Account activated. Sign in with your new password.', 'success');
    dom.acceptInviteForm.reset();
    dom.btnBackToLogin.click();
  } catch (err) {
    showLoginError(dom.acceptInviteError, err.message);
  }
});

dom.userSubtabs.forEach(tab => {
  tab.addEventListener('click', () => {
    dom.userSubtabs.forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.user-subpanel').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.userSubpanel === tab.dataset.userSubtab);
      panel.classList.toggle('hidden', panel.dataset.userSubpanel !== tab.dataset.userSubtab);
    });
  });
});

dom.adminInviteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await apiFetch('/admin/users/invite', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('admin-invite-email').value.trim(),
        displayName: document.getElementById('admin-invite-name').value.trim(),
        adminRoles: [document.getElementById('admin-invite-role').value],
        roles: parseCommaList(document.getElementById('admin-invite-staff-roles').value),
        queues: parseCommaList(document.getElementById('admin-invite-staff-queues').value)
      })
    });
    dom.adminInviteOutputRow.classList.remove('hidden');
    dom.adminInviteOutput.textContent = `Tenant ID: ${result.tenantId}\nInvite token: ${result.inviteToken}`;
    showToast('Invite created.', 'success');
    await refreshAdminConsole();
  } catch (err) {
    showToast(`Invite failed: ${err.message}`, 'error');
  }
});

dom.adminTabs.forEach(tab => {
  tab.addEventListener('click', () => setAdminTab(tab.dataset.adminTab));
});

document.getElementById('btn-iam-refresh').addEventListener('click', loadIamWorkspace);
document.getElementById('iam-role-filter').addEventListener('input', renderIamRoleCatalogue);

function selectedValues(id) {
  return Array.from(document.getElementById(id).selectedOptions).map(option => option.value);
}

function isoFromLocalInput(id) {
  const value = document.getElementById(id).value;
  return value ? new Date(value).toISOString() : null;
}

document.getElementById('iam-principals-list').addEventListener('click', (event) => {
  const principalButton = event.target.closest('[data-iam-principal]');
  const grantButton = event.target.closest('[data-iam-grant]');
  if (principalButton) {
    document.getElementById('iam-status-principal').value = principalButton.dataset.iamPrincipal;
    document.getElementById('iam-status-principal').focus();
  }
  if (grantButton) {
    const field = document.getElementById('iam-revoke-grants');
    field.value = [...new Set([...parseCommaList(field.value), grantButton.dataset.iamGrant])].join(', ');
    field.focus();
  }
});

document.getElementById('btn-iam-removal-impact').addEventListener('click', async () => {
  try {
    const principalId = document.getElementById('iam-status-principal').value.trim();
    if (!principalId) throw new Error('Principal ID is required.');
    const result = await apiFetch(`/admin/identity-governance/principals/${encodeURIComponent(principalId)}/removal-impact`);
    showToast(result.impact.safeToRetire ? 'Retirement is currently staffing-safe.' : `Retirement blocked: ${result.impact.newlyDisabledFeatureIds.join(', ')} would be disabled.`, result.impact.safeToRetire ? 'success' : 'warning');
  } catch (err) { showToast(`Removal-impact assessment failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-iam-status').addEventListener('click', async () => {
  try {
    const principalId = document.getElementById('iam-status-principal').value.trim();
    const status = document.getElementById('iam-principal-status').value;
    const reason = document.getElementById('iam-status-reason').value.trim();
    const evidenceRef = document.getElementById('iam-status-evidence').value.trim();
    if (!principalId || !reason || (status !== 'active' && !evidenceRef)) throw new Error('Principal, reason and containment evidence are required.');
    if (status !== 'active' && !confirm(`Set ${principalId} to ${status}? Access is contained immediately and affected work may be paused.`)) return;
    await apiFetch(`/admin/identity-governance/principals/${encodeURIComponent(principalId)}/status`, { method: 'POST', body: JSON.stringify({ status, reason, evidenceRef }) });
    showToast(`Principal is now ${status}.`, 'success');
    await loadIamWorkspace();
  } catch (err) { showToast(`Principal status change failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-iam-grant-propose').addEventListener('click', async () => {
  try {
    const tenantId = apiState.iamWorkspace?.tenantId;
    await apiFetch('/admin/identity-governance/role-grants/proposals', { method: 'POST', body: JSON.stringify({
      requestId: document.getElementById('iam-grant-request').value.trim(),
      principalId: document.getElementById('iam-grant-principal').value.trim(),
      roleIds: selectedValues('iam-grant-roles'),
      scope: { type: document.getElementById('iam-grant-scope-type').value, id: document.getElementById('iam-grant-scope-id').value.trim() || tenantId },
      reason: document.getElementById('iam-grant-reason').value.trim()
    }) });
    showToast('Role grant proposed. A different access reviewer must approve it.', 'success');
    document.getElementById('iam-grant-request').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Role grant proposal failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-iam-revoke-propose').addEventListener('click', async () => {
  try {
    await apiFetch('/admin/identity-governance/role-revocations/proposals', { method: 'POST', body: JSON.stringify({ requestId: document.getElementById('iam-revoke-request').value.trim(), grantIds: parseCommaList(document.getElementById('iam-revoke-grants').value), reason: document.getElementById('iam-revoke-reason').value.trim() }) });
    showToast('Role revocation proposed. Access remains unchanged until independent approval.', 'success');
    document.getElementById('iam-revoke-request').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Role revocation proposal failed: ${err.message}`, 'error'); }
});

document.getElementById('iam-role-requests-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-iam-role-approval]');
  if (!button) return;
  document.getElementById('iam-approval-request').value = button.dataset.iamRoleApproval;
  document.getElementById('iam-approval-kind').value = button.dataset.requestKind;
});

document.getElementById('btn-iam-role-approve').addEventListener('click', async () => {
  try {
    const requestId = document.getElementById('iam-approval-request').value.trim();
    const kind = document.getElementById('iam-approval-kind').value;
    const payload = { approvalRef: document.getElementById('iam-approval-ref').value.trim() };
    if (kind === 'grant') {
      payload.effectiveFrom = isoFromLocalInput('iam-grant-effective');
      payload.validUntil = isoFromLocalInput('iam-grant-valid-until');
    }
    await apiFetch(`/admin/identity-governance/role-${kind === 'grant' ? 'grants' : 'revocations'}/${encodeURIComponent(requestId)}/approval`, { method: 'POST', body: JSON.stringify(payload) });
    showToast(`Role ${kind} approved independently.`, 'success');
    document.getElementById('iam-approval-request').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Role approval failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-iam-staffing-propose').addEventListener('click', async () => {
  try {
    const tenantId = apiState.iamWorkspace?.tenantId;
    const scope = { type: document.getElementById('iam-staffing-scope-type').value, id: document.getElementById('iam-staffing-scope-id').value.trim() || tenantId };
    const selected = { featureId: document.getElementById('iam-staffing-feature').value, requestedStatus: document.getElementById('iam-staffing-status').value, scope };
    const features = (apiState.iamWorkspace?.featureReadiness?.features || [])
      .map(feature => ({ featureId: feature.featureId, requestedStatus: feature.requestedStatus, scope: feature.scope }))
      .filter(feature => !(feature.featureId === selected.featureId && feature.scope.type === scope.type && feature.scope.id === scope.id));
    features.push(selected);
    await apiFetch('/admin/identity-governance/staffing-config/proposals', { method: 'POST', body: JSON.stringify({
      requestId: document.getElementById('iam-staffing-request').value.trim(),
      features,
      reason: document.getElementById('iam-staffing-reason').value.trim()
    }) });
    showToast('Staffing configuration proposed. Independent control-engine approval is required.', 'success');
    document.getElementById('iam-staffing-request').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Staffing proposal failed: ${err.message}`, 'error'); }
});

document.getElementById('iam-feature-readiness-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-iam-staffing-approval]');
  if (button) document.getElementById('iam-staffing-approval-request').value = button.dataset.iamStaffingApproval;
});

document.getElementById('btn-iam-staffing-approve').addEventListener('click', async () => {
  try {
    const requestId = document.getElementById('iam-staffing-approval-request').value.trim();
    await apiFetch(`/admin/identity-governance/staffing-config/${encodeURIComponent(requestId)}/approval`, { method: 'POST', body: JSON.stringify({ approvalRef: document.getElementById('iam-staffing-approval-ref').value.trim() }) });
    showToast('Staffing configuration approved by the isolated control path.', 'success');
    document.getElementById('iam-staffing-approval-request').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Staffing approval failed: ${err.message}`, 'error'); }
});

document.getElementById('iam-escalations-list').addEventListener('click', (event) => {
  const prepare = event.target.closest('[data-iam-escalation]');
  const approve = event.target.closest('[data-iam-escalation-approval]');
  if (prepare) document.getElementById('iam-escalation-id').value = prepare.dataset.iamEscalation;
  if (approve) document.getElementById('iam-escalation-approval-request').value = approve.dataset.iamEscalationApproval;
});

document.getElementById('btn-iam-escalation-propose').addEventListener('click', async () => {
  try {
    await apiFetch('/admin/identity-governance/staffing-escalations/closure-proposals', { method: 'POST', body: JSON.stringify({ requestId: document.getElementById('iam-escalation-request').value.trim(), escalationId: document.getElementById('iam-escalation-id').value.trim(), resolutionRef: document.getElementById('iam-escalation-resolution').value.trim() }) });
    showToast('Escalation closure proposed. The operational pause remains active.', 'success');
    document.getElementById('iam-escalation-request').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Escalation closure proposal failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-iam-escalation-approve').addEventListener('click', async () => {
  try {
    const requestId = document.getElementById('iam-escalation-approval-request').value.trim();
    await apiFetch(`/admin/identity-governance/staffing-escalations/closure-proposals/${encodeURIComponent(requestId)}/approval`, { method: 'POST', body: JSON.stringify({ approvalRef: document.getElementById('iam-escalation-approval-ref').value.trim() }) });
    showToast('Staffing escalation closed after readiness re-check.', 'success');
    document.getElementById('iam-escalation-approval-request').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Escalation approval failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-iam-agent-register').addEventListener('click', async () => {
  try {
    const principalType = document.getElementById('iam-agent-type').value;
    await apiFetch('/admin/identity-governance/principals/agents', { method: 'POST', body: JSON.stringify({
      principalId: document.getElementById('iam-agent-id').value.trim(), displayName: document.getElementById('iam-agent-name').value.trim(), principalType,
      agentDefinitionRef: document.getElementById('iam-agent-definition').value.trim(), modelRef: document.getElementById('iam-agent-model').value.trim() || null,
      workloadIdentityRef: document.getElementById('iam-agent-workload').value.trim(), workloadIdentityVerified: true,
      identityEvidenceRef: document.getElementById('iam-agent-evidence').value.trim(), expiresAt: principalType === 'dynamic_agent' ? isoFromLocalInput('iam-agent-expires') : null
    }) });
    showToast('Governed agent registered. Grant a dedicated agent role through maker-checker next.', 'success');
    document.getElementById('iam-agent-id').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Agent registration failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-iam-owner-propose').addEventListener('click', async () => {
  try {
    await apiFetch('/admin/identity-governance/ownership-transfers/proposals', { method: 'POST', body: JSON.stringify({ requestId: document.getElementById('iam-owner-request').value.trim(), newOwnerPrincipalId: document.getElementById('iam-owner-target').value.trim(), targetAcceptanceRef: document.getElementById('iam-owner-acceptance').value.trim(), reason: document.getElementById('iam-owner-reason').value.trim() }) });
    showToast('Ownership transfer proposed by the current owner.', 'success');
    document.getElementById('iam-owner-request').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Ownership-transfer proposal failed: ${err.message}`, 'error'); }
});

document.getElementById('iam-ownership-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-iam-owner-approval]');
  if (button) document.getElementById('iam-owner-approval-request').value = button.dataset.iamOwnerApproval;
});

document.getElementById('btn-iam-owner-approve').addEventListener('click', async () => {
  try {
    const requestId = document.getElementById('iam-owner-approval-request').value.trim();
    await apiFetch(`/admin/identity-governance/ownership-transfers/${encodeURIComponent(requestId)}/approval`, { method: 'POST', body: JSON.stringify({ approvalRef: document.getElementById('iam-owner-approval-ref').value.trim() }) });
    showToast('Organisation ownership transferred with independent approval.', 'success');
    document.getElementById('iam-owner-approval-request').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Ownership-transfer approval failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-iam-emergency-propose').addEventListener('click', async () => {
  try {
    await apiFetch('/admin/identity-governance/emergency-access/proposals', { method: 'POST', body: JSON.stringify({ requestId: document.getElementById('iam-emergency-request').value.trim(), beneficiaryPrincipalId: document.getElementById('iam-emergency-beneficiary').value.trim(), actions: selectedValues('iam-emergency-actions'), incidentRef: document.getElementById('iam-emergency-incident').value.trim(), reason: document.getElementById('iam-emergency-reason').value.trim(), expiresAt: isoFromLocalInput('iam-emergency-expires') }) });
    showToast('Emergency access requested. No authority is active until independent approval.', 'success');
    document.getElementById('iam-emergency-request').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Emergency-access request failed: ${err.message}`, 'error'); }
});

document.getElementById('iam-emergency-list').addEventListener('click', (event) => {
  const approval = event.target.closest('[data-iam-emergency-approval]');
  const grant = event.target.closest('[data-iam-emergency-grant]');
  if (approval) document.getElementById('iam-emergency-approval-request').value = approval.dataset.iamEmergencyApproval;
  if (grant) document.getElementById('iam-emergency-grant').value = grant.dataset.iamEmergencyGrant;
});

document.getElementById('btn-iam-emergency-approve').addEventListener('click', async () => {
  try {
    const requestId = document.getElementById('iam-emergency-approval-request').value.trim();
    await apiFetch(`/admin/identity-governance/emergency-access/${encodeURIComponent(requestId)}/approval`, { method: 'POST', body: JSON.stringify({ approvalRef: document.getElementById('iam-emergency-approval-ref').value.trim() }) });
    showToast('Emergency access approved and is now visible in the active grant register.', 'warning');
    document.getElementById('iam-emergency-approval-request').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Emergency-access approval failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-iam-emergency-close').addEventListener('click', async () => {
  try {
    const grantId = document.getElementById('iam-emergency-grant').value.trim();
    await apiFetch(`/admin/identity-governance/emergency-access/${encodeURIComponent(grantId)}/closure`, { method: 'POST', body: JSON.stringify({ closureEvidenceRef: document.getElementById('iam-emergency-closure-ref').value.trim() }) });
    showToast('Emergency access closed with evidence retained.', 'success');
    document.getElementById('iam-emergency-grant').value = '';
    await loadIamWorkspace();
  } catch (err) { showToast(`Emergency-access closure failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-ops-refresh').addEventListener('click', loadIdentityOperations);

document.getElementById('btn-conformance-candidate').addEventListener('click', async () => {
  try {
    await apiFetch('/admin/conformance/candidates', { method: 'POST', body: JSON.stringify({ profileId: document.getElementById('conformance-candidate-id').value.trim(), providerName: document.getElementById('conformance-provider-name').value.trim(), providerCategory: document.getElementById('conformance-provider-category').value.trim(), adapterContractVersion: document.getElementById('conformance-adapter-version').value.trim(), simulatorConfigurationRef: document.getElementById('conformance-simulator-ref').value.trim(), dueDiligenceRef: document.getElementById('conformance-diligence-ref').value.trim(), organisationAdmissionIntegrationIds: parseCommaList(document.getElementById('conformance-admission-scopes').value), enterprisePlatformFamilies: parseCommaList(document.getElementById('conformance-enterprise-scopes').value) }) });
    showToast('Simulator candidate profile registered with immutable scope.', 'success');
    document.getElementById('conformance-candidate-id').value = '';
    await loadIdentityOperations();
  } catch (err) { showToast(`Candidate registration failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-conformance-propose').addEventListener('click', async () => {
  try {
    await apiFetch('/admin/conformance/campaigns/proposals', { method: 'POST', body: JSON.stringify({ campaignId: document.getElementById('conformance-campaign-id').value.trim(), profileId: document.getElementById('conformance-profile-id').value.trim(), targetType: document.getElementById('conformance-target-type').value, targetId: document.getElementById('conformance-target-id').value.trim(), validityDays: Number(document.getElementById('conformance-validity-days').value), proposalRef: document.getElementById('conformance-proposal-ref').value.trim() }) });
    showToast('Canonical conformance campaign proposed; independent approval is required.', 'success');
    document.getElementById('conformance-campaign-id').value = '';
    await loadIdentityOperations();
  } catch (err) { showToast(`Campaign proposal failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-conformance-approve').addEventListener('click', async () => {
  try {
    const campaignId = document.getElementById('conformance-campaign-id').value.trim();
    await apiFetch(`/admin/conformance/campaigns/${encodeURIComponent(campaignId)}/approval`, { method: 'POST', body: JSON.stringify({ approvalRef: document.getElementById('conformance-approval-ref').value.trim() }) });
    showToast('Conformance campaign approved by the authenticated checker.', 'success'); await loadIdentityOperations();
  } catch (err) { showToast(`Campaign approval failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-conformance-assess').addEventListener('click', async () => {
  try {
    const campaignId = document.getElementById('conformance-campaign-id').value.trim();
    const result = await apiFetch(`/admin/conformance/campaigns/${encodeURIComponent(campaignId)}/assessment`, { method: 'POST', body: JSON.stringify({ assessmentRef: document.getElementById('conformance-assessment-ref').value.trim() }) });
    showToast(`Conformance assessment: ${result.assessment.status}.`, result.assessment.status === 'simulator_certified' ? 'success' : 'warning'); await loadIdentityOperations();
  } catch (err) { showToast(`Campaign assessment failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-worker-schedule').addEventListener('click', async () => {
  try {
    await apiFetch('/admin/identity-operations/worker/jobs', { method: 'POST', body: JSON.stringify({ jobId: document.getElementById('identity-worker-job-id').value.trim(), type: document.getElementById('identity-worker-job-type').value, serviceCredentialId: document.getElementById('identity-worker-credential').value.trim(), purpose: document.getElementById('identity-worker-purpose').value.trim(), idempotencyKey: document.getElementById('identity-worker-idempotency').value.trim(), payload: { policyRef: document.getElementById('identity-worker-policy-ref').value.trim() } }) });
    showToast('Durable identity operations job scheduled.', 'success');
    document.getElementById('identity-worker-job-id').value = '';
    await loadIdentityOperations();
  } catch (err) { showToast(`Worker scheduling failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-tenant-activation-assess').addEventListener('click', async () => {
  try {
    const payload = JSON.parse(document.getElementById('tenant-activation-assessment-json').value || '{}');
    const result = await apiFetch('/admin/tenant-activation/assessments', { method: 'POST', body: JSON.stringify(payload) });
    showToast(`Tenant activation assessment: ${result.assessment.status}.`, result.assessment.status === 'blocked' ? 'warning' : 'success'); await loadIdentityOperations();
  } catch (err) { showToast(`Activation assessment failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-automation-run').addEventListener('click', async () => {
  try {
    await apiFetch('/admin/identity-operations/automation/runs', { method: 'POST', body: JSON.stringify({ runId: document.getElementById('identity-automation-run').value.trim(), executionEvidenceRef: document.getElementById('identity-automation-evidence').value.trim() }) });
    showToast('Identity readiness automation completed; findings and containment are retained.', 'success'); await loadIdentityOperations();
  } catch (err) { showToast(`Readiness automation failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-drill-propose').addEventListener('click', async () => {
  try {
    await apiFetch('/admin/identity-operations/drills/proposals', { method: 'POST', body: JSON.stringify({
      drillId: document.getElementById('identity-drill-id').value.trim(), scenario: document.getElementById('identity-drill-scenario').value.trim(), objective: document.getElementById('identity-drill-objective').value.trim(), runbookRef: document.getElementById('identity-drill-runbook').value.trim(),
      targetDetectionMs: Number(document.getElementById('identity-drill-target-detection').value), targetContainmentMs: Number(document.getElementById('identity-drill-target-containment').value), targetRecoveryMs: Number(document.getElementById('identity-drill-target-recovery').value)
    }) });
    showToast('Resilience drill proposed and awaits witnessed execution evidence.', 'success'); await loadIdentityOperations();
  } catch (err) { showToast(`Drill proposal failed: ${err.message}`, 'error'); }
});

document.getElementById('identity-automation-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-identity-drill]');
  if (button) document.getElementById('identity-drill-id').value = button.dataset.identityDrill;
});

document.getElementById('btn-identity-drill-witness').addEventListener('click', async () => {
  try {
    const drillId = document.getElementById('identity-drill-id').value.trim();
    await apiFetch(`/admin/identity-operations/drills/${encodeURIComponent(drillId)}/witness`, { method: 'POST', body: JSON.stringify({
      executionEvidenceRef: document.getElementById('identity-drill-execution').value.trim(), recoveryEvidenceRef: document.getElementById('identity-drill-recovery').value.trim(), detectionMs: Number(document.getElementById('identity-drill-detection').value), containmentMs: Number(document.getElementById('identity-drill-containment').value), recoveryMs: Number(document.getElementById('identity-drill-recovery-ms').value), failClosedObserved: document.getElementById('identity-drill-fail-closed').checked, auditComplete: document.getElementById('identity-drill-audit-complete').checked, observations: document.getElementById('identity-drill-observations').value.trim()
    }) });
    showToast('Witnessed drill outcome recorded against its objectives.', 'success'); await loadIdentityOperations();
  } catch (err) { showToast(`Drill witness failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-revoke').addEventListener('click', async () => {
  try {
    const userId = document.getElementById('identity-revoke-user').value.trim();
    const reason = document.getElementById('identity-revoke-reason').value.trim();
    if (!userId || !reason) throw new Error('User ID and containment reason are required.');
    const result = await apiFetch('/admin/identity-operations/sessions/revoke', { method: 'POST', body: JSON.stringify({ userId, reason }) });
    showToast(`${result.revokedSessionIds.length} active session(s) revoked.`, 'success');
    await loadIdentityOperations();
  } catch (err) { showToast(`Session containment failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-recovery-propose').addEventListener('click', async () => {
  try {
    await apiFetch('/admin/identity-operations/recovery/proposals', { method: 'POST', body: JSON.stringify({
      requestId: document.getElementById('identity-recovery-id').value.trim(),
      principalId: document.getElementById('identity-recovery-user').value.trim(),
      identityEvidenceRef: document.getElementById('identity-recovery-evidence').value.trim(),
      reason: document.getElementById('identity-recovery-reason').value.trim()
    }) });
    showToast('Authenticator recovery proposed. A different administrator must approve it.', 'success');
  } catch (err) { showToast(`Recovery proposal failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-recovery-approve').addEventListener('click', async () => {
  try {
    const requestId = document.getElementById('identity-recovery-id').value.trim();
    const result = await apiFetch(`/admin/identity-operations/recovery/${encodeURIComponent(requestId)}/approval`, { method: 'POST', body: JSON.stringify({ approvalRef: document.getElementById('identity-recovery-approval-ref').value.trim() }) });
    showToast(`Recovery approved; ${result.revokedSessionIds.length} session(s) revoked.`, 'success');
    await loadIdentityOperations();
  } catch (err) { showToast(`Recovery approval failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-rotation-propose').addEventListener('click', async () => {
  try {
    await apiFetch('/admin/identity-operations/federation/rotations/proposals', { method: 'POST', body: JSON.stringify({
      requestId: document.getElementById('identity-rotation-id').value.trim(),
      policyId: document.getElementById('identity-federation-policy').value.trim(),
      proposedMetadata: document.getElementById('identity-rotation-metadata').value,
      proposedMetadataValidUntil: document.getElementById('identity-rotation-valid-until').value.trim(),
      proposedSigningKeyIds: parseCommaList(document.getElementById('identity-rotation-keys').value),
      overlapStartsAt: document.getElementById('identity-rotation-overlap-start').value.trim(),
      overlapEndsAt: document.getElementById('identity-rotation-overlap-end').value.trim(),
      reason: document.getElementById('identity-rotation-reason').value.trim()
    }) });
    showToast('Federation rotation proposed. A different administrator must approve it.', 'success');
  } catch (err) { showToast(`Rotation proposal failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-rotation-approve').addEventListener('click', async () => {
  try {
    const requestId = document.getElementById('identity-rotation-id').value.trim();
    await apiFetch(`/admin/identity-operations/federation/rotations/${encodeURIComponent(requestId)}/approval`, { method: 'POST', body: JSON.stringify({ approvalRef: document.getElementById('identity-rotation-approval').value.trim(), conformanceEvidenceRef: document.getElementById('identity-rotation-conformance').value.trim() }) });
    showToast('Federation rotation approved with rollback lineage retained.', 'success'); await loadIdentityOperations();
  } catch (err) { showToast(`Rotation approval failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-suspend').addEventListener('click', async () => {
  try {
    const policyId = document.getElementById('identity-federation-policy').value.trim();
    if (!confirm('Suspend this federation policy and revoke every affected active session now?')) return;
    const result = await apiFetch(`/admin/identity-operations/federation/policies/${encodeURIComponent(policyId)}/suspension`, { method: 'POST', body: JSON.stringify({ reason: document.getElementById('identity-suspension-reason').value.trim(), evidenceRef: document.getElementById('identity-suspension-evidence').value.trim() }) });
    showToast(`Federation suspended; ${result.revokedSessionIds.length} session(s) revoked.`, 'success'); await loadIdentityOperations();
  } catch (err) { showToast(`Federation suspension failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-campaign-propose').addEventListener('click', async () => {
  try {
    await apiFetch('/admin/identity-operations/conformance/campaigns', { method: 'POST', body: JSON.stringify({
      campaignId: document.getElementById('identity-campaign-id').value.trim(),
      family: document.getElementById('identity-campaign-family').value,
      providerProfileRef: document.getElementById('identity-provider-ref').value.trim(),
      executionMode: 'simulated'
    }) });
    showToast('Simulator campaign proposed. Independent approval is required.', 'success');
    await loadIdentityOperations();
  } catch (err) { showToast(`Campaign proposal failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-campaign-approve').addEventListener('click', async () => {
  try {
    const campaignId = document.getElementById('identity-campaign-id').value.trim();
    await apiFetch(`/admin/identity-operations/conformance/campaigns/${encodeURIComponent(campaignId)}/approval`, { method: 'POST', body: JSON.stringify({ approvalRef: document.getElementById('identity-campaign-approval-ref').value.trim() }) });
    showToast('Simulator campaign approved.', 'success'); await loadIdentityOperations();
  } catch (err) { showToast(`Campaign approval failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-campaign-run').addEventListener('click', async () => {
  try {
    const campaignId = document.getElementById('identity-campaign-id').value.trim();
    const result = await apiFetch(`/admin/identity-operations/conformance/campaigns/${encodeURIComponent(campaignId)}/run`, { method: 'POST', body: JSON.stringify({}) });
    showToast(`Campaign result: ${result.campaign.status}. This remains simulator-only evidence.`, 'success'); await loadIdentityOperations();
  } catch (err) { showToast(`Campaign execution failed: ${err.message}`, 'error'); }
});

document.getElementById('btn-identity-reconcile').addEventListener('click', async () => {
  try {
    const sourceUsers = JSON.parse(document.getElementById('identity-recon-users').value || '[]');
    const result = await apiFetch('/admin/identity-operations/directory-reconciliations', { method: 'POST', body: JSON.stringify({
      reconciliationId: document.getElementById('identity-recon-id').value.trim(),
      policyId: document.getElementById('identity-recon-policy').value.trim(),
      sourceEvidenceRef: document.getElementById('identity-recon-evidence').value.trim(), sourceUsers
    }) });
    showToast(`Directory reconciliation: ${result.reconciliation.status}.`, result.reconciliation.status === 'reconciled' ? 'success' : 'warning');
  } catch (err) { showToast(`Directory reconciliation failed: ${err.message}`, 'error'); }
});

dom.btnOnboardingPrev.addEventListener('click', () => setOnboardingStep(apiState.onboardingStep - 1));
dom.btnOnboardingNext.addEventListener('click', () => {
  if (validateCurrentOnboardingStep()) setOnboardingStep(apiState.onboardingStep + 1);
});

dom.adminUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await apiFetch('/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('admin-user-email').value.trim(),
        displayName: document.getElementById('admin-user-name').value.trim(),
        password: document.getElementById('admin-user-password').value,
        adminRoles: [document.getElementById('admin-user-role').value],
        roles: parseCommaList(document.getElementById('admin-user-staff-roles').value),
        queues: parseCommaList(document.getElementById('admin-user-staff-queues').value)
      })
    });
    dom.adminUserForm.reset();
    showToast('Tenant user created.', 'success');
    await refreshAdminConsole();
  } catch (err) {
    showToast(`User creation failed: ${err.message}`, 'error');
  }
});

dom.adminUsersList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-user-status]');
  if (!button) return;
  if (button.dataset.status !== 'active' && !confirm('Suspend this user? They will be signed out everywhere immediately.')) {
    return;
  }
  try {
    await apiFetch(`/admin/users/${encodeURIComponent(button.dataset.userStatus)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: button.dataset.status })
    });
    showToast('User status updated.', 'success');
    await refreshAdminConsole();
  } catch (err) {
    showToast(`Status update failed: ${err.message}`, 'error');
  }
});

dom.adminReviewForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const due = document.getElementById('admin-review-due').value;
    await apiFetch('/admin/access-reviews', {
      method: 'POST',
      body: JSON.stringify({
        reviewer: document.getElementById('admin-reviewer').value.trim(),
        dueAt: due ? new Date(`${due}T00:00:00`).toISOString() : null
      })
    });
    dom.adminReviewForm.reset();
    showToast('Access review created.', 'success');
    await refreshAdminConsole();
  } catch (err) {
    showToast(`Access review failed: ${err.message}`, 'error');
  }
});

dom.adminReviewsList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-review-complete]');
  if (!button) return;
  const row = button.closest('[data-review-row]');
  const decisions = Array.from(row?.querySelectorAll('[data-decision-user]') ?? [])
    .map(select => ({ userId: select.dataset.decisionUser, action: select.value }))
    .filter(decision => decision.action);
  try {
    const result = await apiFetch(`/admin/access-reviews/${encodeURIComponent(button.dataset.reviewComplete)}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        completedBy: apiState.currentActorId || apiState.currentUser?.email || 'admin-console',
        decisions
      })
    });
    const skipped = result.accessReview?.skippedDecisions ?? [];
    showToast(
      skipped.length
        ? `Review completed; ${skipped.length} decision(s) skipped to protect the last active tenant admin.`
        : 'Access review completed.',
      skipped.length ? 'warning' : 'success'
    );
    await refreshAdminConsole();
  } catch (err) {
    showToast(`Review completion failed: ${err.message}`, 'error');
  }
});

// ─── Tenant Lifecycle (Platform tab) ───────────────────────────────────────
dom.platformTenantsList.addEventListener('click', async (event) => {
  const statusBtn = event.target.closest('[data-tenant-status]');
  const exportBtn = event.target.closest('[data-tenant-export]');
  const offboardBtn = event.target.closest('[data-tenant-offboard]');
  const breakGlassBtn = event.target.closest('[data-tenant-break-glass]');

  if (statusBtn) {
    const status = statusBtn.dataset.status;
    if (status !== 'active' && !confirm('Suspend this tenant? Every data-plane request for it will be blocked immediately.')) return;
    try {
      await apiFetch(`/platform/tenants/${encodeURIComponent(statusBtn.dataset.tenantStatus)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, reason: 'admin console lifecycle action' })
      });
      showToast('Tenant status updated.', 'success');
      await refreshAdminConsole();
    } catch (err) {
      showToast(`Tenant status change failed: ${err.message}`, 'error');
    }
    return;
  }

  if (exportBtn) {
    try {
      const data = await apiFetch(`/platform/tenants/${encodeURIComponent(exportBtn.dataset.tenantExport)}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exportBtn.dataset.tenantExport}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Tenant export downloaded.', 'success');
    } catch (err) {
      showToast(`Export failed: ${err.message}`, 'error');
    }
    return;
  }

  if (offboardBtn) {
    const reason = prompt('Reason for offboarding this tenant (required, permanent action):');
    if (!reason) return;
    try {
      await apiFetch(`/platform/tenants/${encodeURIComponent(offboardBtn.dataset.tenantOffboard)}/offboarding`, {
        method: 'POST',
        body: JSON.stringify({ actor: apiState.currentUser?.email || 'platform-admin-console', reason })
      });
      showToast('Tenant offboarded.', 'success');
      await refreshAdminConsole();
    } catch (err) {
      showToast(`Offboarding failed: ${err.message}`, 'error');
    }
    return;
  }

  if (breakGlassBtn) {
    document.getElementById('break-glass-tenant-id').value = breakGlassBtn.dataset.tenantBreakGlass;
    setAdminTab('platform-access');
    await loadBreakGlassGrants(breakGlassBtn.dataset.tenantBreakGlass);
  }
});

// ─── Platform Users & Break-Glass ──────────────────────────────────────────
if (dom.platformUserForm) {
  dom.platformUserForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await apiFetch('/platform/users', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('platform-user-email').value.trim(),
          displayName: document.getElementById('platform-user-name').value.trim(),
          password: document.getElementById('platform-user-password').value,
          roles: [document.getElementById('platform-user-role').value]
        })
      });
      dom.platformUserForm.reset();
      showToast('Platform user created.', 'success');
      await loadPlatformUsers();
    } catch (err) {
      showToast(`Platform user creation failed: ${err.message}`, 'error');
    }
  });
}

async function loadPlatformUsers() {
  try {
    const result = await apiFetch('/platform/users');
    dom.platformUsersList.innerHTML = (result.users || []).map(user => `
      <div class="admin-row">
        <div class="admin-row-header">
          <div>
            <div class="admin-row-title">${escapeHtml(user.displayName || user.email)}</div>
            <p>${escapeHtml(user.email)} · ${(user.roles || []).map(escapeHtml).join(', ')}</p>
          </div>
          <span class="admin-pill">${escapeHtml(user.status)}</span>
        </div>
        ${user.mfaSetupPending ? '<p class="admin-pill admin-pill-warning">MFA setup pending</p>' : ''}
      </div>
    `).join('') || emptyAdminRow('No platform users yet.');
  } catch (err) {
    showToast(`Platform users load failed: ${err.message}`, 'error');
  }
}

dom.btnBreakGlassMint.addEventListener('click', async () => {
  const tenantId = document.getElementById('break-glass-tenant-id').value.trim();
  const staffId = document.getElementById('break-glass-staff-id').value.trim();
  const reason = document.getElementById('break-glass-reason').value.trim();
  const ttlMinutes = Number(document.getElementById('break-glass-ttl').value) || 60;
  if (!tenantId || !staffId || !reason) {
    showToast('Tenant ID, staff ID, and reason are all required to mint break-glass access.', 'warning');
    return;
  }
  if (!confirm(`Mint a break-glass credential granting platform staff "${staffId}" access to tenant "${tenantId}"? This is an emergency-access escalation and is fully audited.`)) return;
  try {
    const result = await apiFetch(`/platform/tenants/${encodeURIComponent(tenantId)}/break-glass`, {
      method: 'POST',
      body: JSON.stringify({ staffId, reason, ttlMinutes })
    });
    dom.breakGlassOutput.textContent = `One-time credential (shown once):\n${result.credential}`;
    showToast('Break-glass credential minted.', 'success');
    await loadBreakGlassGrants(tenantId);
  } catch (err) {
    showToast(`Break-glass mint failed: ${err.message}`, 'error');
  }
});

async function loadBreakGlassGrants(tenantId) {
  if (!tenantId) {
    dom.breakGlassList.innerHTML = emptyAdminRow('Enter a tenant ID above to view its break-glass grants.');
    return;
  }
  try {
    const result = await apiFetch(`/platform/tenants/${encodeURIComponent(tenantId)}/break-glass`);
    dom.breakGlassList.innerHTML = (result.grants || []).map(grant => `
      <div class="admin-row">
        <div class="admin-row-header">
          <div>
            <div class="admin-row-title">${escapeHtml(grant.staffId)}</div>
            <p>${escapeHtml(grant.reason)} · expires ${escapeHtml(grant.expiresAt || 'n/a')}</p>
          </div>
          <span class="admin-pill">${escapeHtml(grant.effectiveStatus)}</span>
        </div>
        ${grant.effectiveStatus === 'active' ? `<button class="btn btn-warning btn-sm" data-break-glass-revoke="${escapeHtml(grant.grantId)}">Revoke</button>` : ''}
      </div>
    `).join('') || emptyAdminRow('No break-glass grants for this tenant.');
  } catch (err) {
    showToast(`Break-glass grants load failed: ${err.message}`, 'error');
  }
}

dom.breakGlassList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-break-glass-revoke]');
  if (!button) return;
  try {
    await apiFetch(`/platform/break-glass/${encodeURIComponent(button.dataset.breakGlassRevoke)}/revoke`, { method: 'POST' });
    showToast('Break-glass grant revoked.', 'success');
    await loadBreakGlassGrants(document.getElementById('break-glass-tenant-id').value.trim());
  } catch (err) {
    showToast(`Revoke failed: ${err.message}`, 'error');
  }
});

// ─── Audit Tab ──────────────────────────────────────────────────────────────
async function loadAuditEvents() {
  const isPlatform = apiState.authScope === 'platform';
  try {
    const result = isPlatform ? await apiFetch('/platform/audit-events') : await apiFetch('/audit/events');
    const events = (result.events || []).slice(-100).reverse();
    dom.adminAuditList.innerHTML = events.map(ev => `
      <div class="audit-event-row">
        <div class="audit-event-type">${escapeHtml(ev.type)}</div>
        <div class="audit-event-meta">${escapeHtml(ev.actor || 'system')} · ${escapeHtml(ev.actorType || '')} · ${escapeHtml(ev.occurredAt || '')}</div>
      </div>
    `).join('') || emptyAdminRow(isPlatform ? 'No platform audit events yet.' : 'No audit events yet.');
  } catch (err) {
    showToast(`Audit load failed: ${err.message}`, 'error');
  }
}

dom.btnAuditRefresh.addEventListener('click', loadAuditEvents);

dom.btnAuditExport.addEventListener('click', async () => {
  const isPlatform = apiState.authScope === 'platform';
  try {
    const data = isPlatform ? await apiFetch('/platform/audit-events') : await apiFetch('/audit/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isPlatform ? 'platform-audit-evidence.json' : `${apiState.currentTenant?.tenantId || 'tenant'}-audit-evidence.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Evidence pack downloaded.', 'success');
  } catch (err) {
    showToast(`Evidence export failed: ${err.message}`, 'error');
  }
});

dom.btnAdminRotateKey.addEventListener('click', async () => {
  try {
    const result = await apiFetch('/admin/api-key/rotation', {
      method: 'POST',
      body: JSON.stringify({ reason: dom.adminRotationReason.value.trim() })
    });
    dom.adminRotatedKeyOutput.textContent = `One-time new service key:\n${result.apiKey}`;
    showToast('Tenant service API key rotated.', 'success');
    await refreshAdminConsole();
  } catch (err) {
    showToast(`Key rotation failed: ${err.message}`, 'error');
  }
});

dom.platformTenantForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const ownerEmail = document.getElementById('platform-owner-email').value.trim();
    const ownerPassword = document.getElementById('platform-owner-password').value;
    const payload = buildTenantOnboardingPayload();
    if (ownerEmail && ownerPassword) {
      payload.ownerUser = {
        email: ownerEmail,
        displayName: ownerEmail,
        password: ownerPassword,
        adminRoles: ['tenant_admin', 'user_admin', 'security_admin', 'auditor']
      };
    }
    const result = await apiFetch('/platform/tenants', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    dom.platformTenantForm.reset();
    dom.onboardingOutput.textContent = `Tenant ${result.tenant.tenantId} provisioned.\nOne-time service API key:\n${result.apiKey}\n\n${formatReadiness(result.readiness)}`;
    showToast(`Tenant ${result.tenant.tenantId} provisioned with onboarding blueprint.`, 'success');
    await refreshAdminConsole();
  } catch (err) {
    showToast(`Tenant provisioning failed: ${err.message}`, 'error');
  }
});

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

dom.taskSort.addEventListener('change', renderTasksList);
dom.btnClearFilters.addEventListener('click', clearTaskFilters);
dom.btnEmptyClear.addEventListener('click', clearTaskFilters);
dom.btnRetryTasks.addEventListener('click', () => loadTasks());
dom.btnDetailClose.addEventListener('click', closeDetails);

dom.filterStatus.addEventListener('change', () => {
  apiState.statusFilter = dom.filterStatus.value;
  renderTasksList();
});

dom.filterMyQueues.addEventListener('change', () => {
  renderSidebarCounts();
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
    if (dom.dialogRelease.open || dom.dialogDelivery.open || dom.dialogDecline.open || dom.dialogAdmin.open) return;
    closeDetails();
  }
});

// Boot
window.addEventListener('DOMContentLoaded', () => {
  enhanceAccessibleForms();
  if (new URLSearchParams(window.location.search).get('scope') === 'platform') {
    setLoginScope('platform');
  }
  initConfig();
  setOnboardingStep(0);
  setupSubtabs('.iam-subtab', '.iam-subpanel', 'data-iam-subtab', 'data-iam-subpanel');
  setupSubtabs('.identity-subtab', '.identity-subpanel', 'data-identity-subtab', 'data-identity-subpanel');
});
