const pathSegments = window.location.pathname.split("/");
const urlTenantId = pathSegments[1] === "t" && pathSegments[2] ? decodeURIComponent(pathSegments[2]) : "dev";

const state = {
  auth: { tenantId: urlTenantId, borrowerId: "", email: "", name: "" },
  applications: [],
  loans: [],
  complaints: [],
  activeApplicationId: null,
  brandName: "LoanOS"
};

const dom = {
  authPanel: document.getElementById("auth-panel"),
  authForm: document.getElementById("auth-form"),
  authSubmit: document.getElementById("auth-submit"),
  mainPortal: document.getElementById("main-portal"),
  headerStatus: document.getElementById("header-status-area"),
  navItems: [...document.querySelectorAll(".nav-item[data-panel]")],
  panels: [...document.querySelectorAll(".portal-panel")],
  appList: document.getElementById("app-list-container"),
  loanList: document.getElementById("loan-list-container"),
  documentList: document.getElementById("document-list-container"),
  complaintList: document.getElementById("complaint-list-container"),
  homeApplicationPreview: document.getElementById("home-application-preview"),
  nextActionContent: document.getElementById("next-action-content"),
  nextActionTime: document.getElementById("next-action-time"),
  appCount: document.getElementById("customer-app-count"),
  loanCount: document.getElementById("customer-loan-count"),
  helpCount: document.getElementById("customer-help-count"),
  navAppCount: document.getElementById("nav-app-count"),
  navHelpCount: document.getElementById("nav-help-count"),
  welcomeName: document.getElementById("customer-welcome-name"),
  profileName: document.getElementById("profile-name"),
  profileAvatar: document.getElementById("profile-avatar"),
  complaintForm: document.getElementById("complaint-form"),
  correctionForm: document.getElementById("correction-form"),
  dialogKfs: document.getElementById("dialog-kfs"),
  dialogSigning: document.getElementById("dialog-signing"),
  dialogDataPack: document.getElementById("dialog-data-pack"),
  filmDialog: document.getElementById("film-dialog"),
  journeyFilm: document.getElementById("journey-film"),
  dataPackJson: document.getElementById("data-pack-json"),
  toastContainer: document.getElementById("toast-container")
};

document.getElementById("tenant-id").value = urlTenantId;
document.getElementById("snapshot-date").textContent = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date());

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: Number.isInteger(number) ? 0 : 2 }).format(Number.isFinite(number) ? number : 0);
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function titleCase(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, character => character.toUpperCase());
}

function productLabel(record) {
  const value = record.productCode || record.product?.productCode || record.productId || record.product?.productId || "Loan";
  return titleCase(value.replace(/^prod_?/i, ""));
}

function setButtonBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.innerHTML;
    button.innerHTML = `<span>${escapeHtml(busyLabel)}</span>`;
    button.disabled = true;
    button.classList.add("loading");
  } else {
    button.innerHTML = button.dataset.originalLabel || button.innerHTML;
    button.disabled = false;
    button.classList.remove("loading");
  }
}

function showToast(message, type = "info") {
  const labels = { success: "Done", danger: "Something went wrong", warning: "Please note", info: "Update" };
  const icons = { success: "✓", danger: "!", warning: "!", info: "i" };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${icons[type] || "i"}</span>
    <div><strong>${labels[type] || "Update"}</strong><p>${escapeHtml(message)}</p></div>
    <button type="button" aria-label="Dismiss">×</button>
  `;
  toast.querySelector("button").addEventListener("click", () => toast.remove());
  dom.toastContainer.append(toast);
  window.setTimeout(() => toast.remove(), 5500);
}

async function jsonFetch(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || "This action could not be completed right now.");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function loadBranding() {
  try {
    const data = await jsonFetch(`/t/${encodeURIComponent(urlTenantId)}/branding`);
    const name = data.regulatedEntity?.name || data.name || urlTenantId;
    state.brandName = name;
    const initial = name.charAt(0).toUpperCase();
    document.getElementById("page-title").textContent = `${name} — Your Loan Portal`;
    document.getElementById("brand-mark").textContent = initial;
    document.getElementById("brand-name").textContent = name;
    document.getElementById("footer-brand").textContent = name;
    document.getElementById("brand-home-link").href = `/t/${encodeURIComponent(urlTenantId)}/`;
    document.getElementById("brand-back-link").href = `/t/${encodeURIComponent(urlTenantId)}/`;
    document.getElementById("auth-desc").textContent = `Use the details registered with ${name}. We’ll email a one-time access code to verify it’s you.`;
  } catch {
    // White-labelling is best effort; the secure portal remains usable.
  }
}

function openPanel(name, focus = true) {
  dom.navItems.forEach(item => {
    const selected = item.dataset.panel === name;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  dom.panels.forEach(panel => {
    const selected = panel.id === `panel-${name}`;
    panel.hidden = !selected;
    panel.classList.toggle("active", selected);
    if (selected && focus) {
      panel.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}

function applicationStage(status) {
  if (["application_received", "ready_for_kfs", "blocked_compliance"].includes(status)) return 0;
  if (status === "kfs_issued") return 1;
  if (["ready_for_decision", "pending_decision_approval"].includes(status)) return 2;
  if (["approved", "rejected", "disbursed"].includes(status)) return 3;
  return 0;
}

function applicationGuidance(application) {
  const guidance = {
    application_received: ["Application received", "Your lender is checking the information you provided."],
    ready_for_kfs: ["Terms are being prepared", "Your Key Fact Statement will appear here when it is ready."],
    kfs_issued: ["Your terms are ready", "Review the APR, fees and repayment total before you accept."],
    ready_for_decision: ["Under credit review", "No action is needed while the lending team completes its review."],
    pending_decision_approval: ["Final review in progress", "Your application is with an authorised reviewer."],
    approved: ["Approved — ready to sign", "Review and sign the agreement to complete your customer steps."],
    disbursed: ["Funds disbursed", "Your loan account and repayment schedule are now available."],
    rejected: ["Application not approved", "You can contact support if you need help understanding the outcome."],
    blocked_compliance: ["We need to resolve an issue", "Contact support so your lender can explain what is needed next."]
  };
  return guidance[application.status] || [titleCase(application.status), "Your lender will update this application when the next step is ready."];
}

function applicationAction(application, compact = false) {
  const id = escapeHtml(application.applicationId);
  if (application.status === "kfs_issued") {
    return `<button class="${compact ? "action-button" : "primary"}" type="button" data-action="review-kfs" data-id="${id}">Review KFS <span aria-hidden="true">→</span></button>`;
  }
  if (application.status === "approved") {
    return `<button class="${compact ? "action-button" : "primary"}" type="button" data-action="sign-agreement" data-id="${id}">Sign agreement <span aria-hidden="true">→</span></button>`;
  }
  if (["blocked_compliance", "rejected"].includes(application.status)) {
    return `<button class="${compact ? "action-button" : ""}" type="button" data-go-panel="help">Get help <span aria-hidden="true">→</span></button>`;
  }
  return `<button type="button" data-go-panel="applications">View progress</button>`;
}

function renderApplicationProgress(application) {
  const stage = applicationStage(application.status);
  const labels = ["Applied", "Terms", "Review", application.status === "disbursed" ? "Disbursed" : "Decision"];
  return labels.map((label, index) => {
    const status = index < stage ? "complete" : index === stage ? "current" : "";
    return `<span class="progress-step ${status}"><i>${index < stage ? "✓" : index + 1}</i><span>${label}</span></span>`;
  }).join("");
}

function renderApplications() {
  dom.appCount.textContent = state.applications.length;
  dom.navAppCount.textContent = state.applications.length;
  if (!state.applications.length) {
    dom.appList.innerHTML = '<div class="portal-state">You have no applications right now. New applications will appear here automatically.</div>';
    dom.homeApplicationPreview.innerHTML = '<div class="portal-state">No active application journeys to show.</div>';
    return;
  }

  dom.appList.innerHTML = state.applications.map(application => {
    const [heading, description] = applicationGuidance(application);
    const amount = application.amount ?? application.requestedAmount ?? application.product?.requestedAmount ?? application.kfs?.principalAmount;
    return `
      <article class="application-card">
        <div class="application-card-top">
          <div>
            <span class="application-id">${escapeHtml(application.applicationId)}</span>
            <h2>${escapeHtml(productLabel(application))} · ${money(amount)}</h2>
            <span class="application-meta">Started ${shortDate(application.createdAt)} · ${escapeHtml(application.tenorMonths || application.product?.requestedTenorMonths || application.kfs?.tenorMonths || "—")} months</span>
          </div>
          <span class="status-pill ${escapeHtml(application.status)}">${escapeHtml(heading)}</span>
        </div>
        <div class="application-progress">${renderApplicationProgress(application)}</div>
        <div class="application-card-footer">
          <p>${escapeHtml(description)}</p>
          <div class="card-actions">${applicationAction(application)}</div>
        </div>
      </article>
    `;
  }).join("");

  dom.homeApplicationPreview.innerHTML = state.applications.slice(0, 2).map(application => {
    const [heading, description] = applicationGuidance(application);
    const stage = applicationStage(application);
    const progress = Math.max(12, Math.round(((stage + 1) / 4) * 100));
    return `
      <article class="journey-card">
        <div><small>${escapeHtml(productLabel(application))}</small><h3>${escapeHtml(heading)}</h3><p>${escapeHtml(description)}</p></div>
        <span class="mini-progress" style="--progress:${progress}%" data-progress="${progress}%"></span>
      </article>
    `;
  }).join("");
}

function principalOutstanding(loan) {
  if (loan.summary?.principalOutstanding != null) return Number(loan.summary.principalOutstanding);
  if (loan.summary?.outstandingPrincipal != null) return Number(loan.summary.outstandingPrincipal);
  const paid = (loan.ledger || []).reduce((total, entry) => total + Number(entry.principalCredit || 0), 0);
  return Math.max(0, Number(loan.principalAmount || 0) - paid);
}

function nextInstallment(loan) {
  const schedule = loan.schedule || [];
  const today = new Date();
  return schedule.find(item => new Date(`${item.dueDate}T23:59:59`) >= today) || schedule.at(-1) || null;
}

function installmentTotal(item) {
  return Number(item?.totalDue ?? (Number(item?.principalDue || item?.principalAmount || 0) + Number(item?.interestDue || item?.interestAmount || 0)));
}

function renderLoans() {
  dom.loanCount.textContent = state.loans.length;
  if (!state.loans.length) {
    dom.loanList.innerHTML = '<div class="portal-state">You have no active loan accounts. When a loan is disbursed, its balance and repayment plan will appear here.</div>';
    return;
  }
  dom.loanList.innerHTML = state.loans.map(loan => {
    const upcoming = nextInstallment(loan);
    const id = escapeHtml(loan.loanAccountId);
    return `
      <article class="loan-card">
        <div class="loan-card-main">
          <div><span class="loan-account-label">${escapeHtml(loan.loanAccountId)}</span><h2>${escapeHtml(productLabel(loan))}</h2><span class="application-meta">${upcoming ? `Next instalment ${shortDate(upcoming.dueDate)} · ${money(installmentTotal(upcoming))}` : "Repayment schedule complete"}</span></div>
          <div class="loan-balance"><small>Principal outstanding</small><strong>${money(principalOutstanding(loan))}</strong><span class="status-pill ${escapeHtml(loan.status)}">${escapeHtml(titleCase(loan.status))}</span></div>
        </div>
        <div class="loan-actions card-actions">
          <button type="button" data-action="view-schedule" data-id="${id}">View repayment plan</button>
          <a href="/loan-accounts/${encodeURIComponent(loan.loanAccountId)}/statement/document" target="_blank" rel="noopener">Open sealed statement</a>
        </div>
        <div class="schedule-wrap" id="schedule-${id}" hidden>
          <h3>Repayment schedule</h3>
          <div class="table-scroll"><table class="repayment-table"><thead><tr><th>Due date</th><th>Instalment</th><th>Principal</th><th>Interest</th><th>Status</th></tr></thead><tbody id="schedule-body-${id}"></tbody></table></div>
        </div>
      </article>
    `;
  }).join("");
}

function renderDocuments() {
  const groups = [];
  state.applications.forEach(application => {
    const rows = [];
    const id = escapeHtml(application.applicationId);
    if (application.kfs) {
      rows.push(`<div class="document-row"><span class="document-icon">KFS</span><div><strong>Key Fact Statement</strong><small>APR, charges, repayment total and cooling-off terms</small></div><button type="button" data-action="review-kfs" data-id="${id}">Review</button></div>`);
    }
    if (application.documentPacket) {
      const action = application.status === "approved"
        ? `<button type="button" data-action="sign-agreement" data-id="${id}">Sign now</button>`
        : `<a href="/loans/applications/${encodeURIComponent(application.applicationId)}/document-packet" target="_blank" rel="noopener">Open record</a>`;
      rows.push(`<div class="document-row"><span class="document-icon">DOC</span><div><strong>Agreement document packet</strong><small>Sanction letter, agreement summary and privacy notice</small></div>${action}</div>`);
    }
    if (rows.length) {
      groups.push(`<section class="document-group"><div class="document-group-head"><strong>${escapeHtml(productLabel(application))}</strong><small>Application ${id}</small></div>${rows.join("")}</section>`);
    }
  });
  state.loans.forEach(loan => {
    groups.push(`<section class="document-group"><div class="document-group-head"><strong>${escapeHtml(productLabel(loan))}</strong><small>Loan account ${escapeHtml(loan.loanAccountId)}</small></div><div class="document-row"><span class="document-icon">STM</span><div><strong>Sealed loan statement</strong><small>Balances, dues and transaction history</small></div><a href="/loan-accounts/${encodeURIComponent(loan.loanAccountId)}/statement/document" target="_blank" rel="noopener">Open</a></div></section>`);
  });
  dom.documentList.innerHTML = groups.length ? groups.join("") : '<div class="portal-state">Your KFS, agreements and statements will collect here as your loan journey progresses.</div>';
}

function renderComplaints() {
  const open = state.complaints.filter(item => !["resolved", "closed"].includes(item.status)).length;
  dom.helpCount.textContent = open;
  dom.navHelpCount.textContent = open;
  dom.navHelpCount.hidden = open === 0;
  if (!state.complaints.length) {
    dom.complaintList.innerHTML = '<div class="portal-state">You have no support requests. If something does not feel right, tell us here.</div>';
    return;
  }
  dom.complaintList.innerHTML = state.complaints.map(complaint => `
    <article class="complaint-card">
      <div class="complaint-card-top"><strong>${escapeHtml(titleCase(complaint.category))}</strong><span class="status-pill ${escapeHtml(complaint.status)}">${escapeHtml(titleCase(complaint.status))}</span></div>
      <p>${escapeHtml(complaint.summary)}</p>
      <small>Reference ${escapeHtml(complaint.complaintId || "Pending")} · Raised ${shortDate(complaint.receivedAt)}</small>
    </article>
  `).join("");
}

function renderNextAction() {
  const priority = state.applications.find(application => application.status === "kfs_issued")
    || state.applications.find(application => application.status === "approved")
    || state.applications.find(application => ["blocked_compliance", "rejected"].includes(application.status))
    || state.applications.find(application => ["pending_decision_approval", "ready_for_decision"].includes(application.status));

  if (priority) {
    const [heading, description] = applicationGuidance(priority);
    const label = priority.status === "kfs_issued" ? "Terms ready for you" : priority.status === "approved" ? "Your approval is ready" : "Application update";
    dom.nextActionTime.textContent = ["kfs_issued", "approved"].includes(priority.status) ? "2 min" : "No rush";
    dom.nextActionContent.innerHTML = `
      <div class="next-action-copy"><small>${escapeHtml(label)} · ${escapeHtml(productLabel(priority))}</small><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(description)}</p>${applicationAction(priority, true)}</div>
      <div class="action-art" aria-hidden="true"><span>${applicationStage(priority.status) + 1}/4</span></div>
    `;
    return;
  }

  const loan = state.loans[0];
  const installment = loan ? nextInstallment(loan) : null;
  if (loan && installment) {
    dom.nextActionTime.textContent = shortDate(installment.dueDate);
    dom.nextActionContent.innerHTML = `<div class="next-action-copy"><small>Upcoming repayment · ${escapeHtml(productLabel(loan))}</small><h2>Your next instalment is ${money(installmentTotal(installment))}</h2><p>Review the due date and full schedule so you can plan ahead with confidence.</p><button class="action-button" type="button" data-go-panel="loans">See repayment plan <span>→</span></button></div><div class="action-art" aria-hidden="true"><span>₹</span></div>`;
    return;
  }

  dom.nextActionTime.textContent = "All clear";
  dom.nextActionContent.innerHTML = '<div class="next-action-copy"><small>Nothing needs your attention</small><h2>You’re all caught up.</h2><p>We’ll bring the next important action here as soon as it is ready.</p><button class="action-button" type="button" data-open-film>Learn how the journey works <span>→</span></button></div><div class="action-art" aria-hidden="true"><span>✓</span></div>';
}

async function loadApplications() {
  try {
    const data = await jsonFetch("/loans/applications");
    state.applications = (data.applications || []).filter(application => application.borrowerId === state.auth.borrowerId || application.borrower?.borrowerId === state.auth.borrowerId);
    renderApplications();
  } catch (error) {
    dom.appCount.textContent = "—";
    dom.appList.innerHTML = `<div class="portal-state error">${escapeHtml(error.message)}</div>`;
    dom.homeApplicationPreview.innerHTML = '<div class="portal-state error">Application progress is temporarily unavailable.</div>';
  }
}

async function loadLoans() {
  try {
    const data = await jsonFetch("/loan-accounts");
    state.loans = data.loanAccounts || [];
    renderLoans();
  } catch (error) {
    dom.loanCount.textContent = "—";
    dom.loanList.innerHTML = `<div class="portal-state error">${escapeHtml(error.message)}</div>`;
  }
}

async function loadComplaints() {
  try {
    const data = await jsonFetch("/complaints");
    state.complaints = data.complaints || [];
    renderComplaints();
  } catch (error) {
    dom.helpCount.textContent = "—";
    dom.complaintList.innerHTML = `<div class="portal-state error">${escapeHtml(error.message)}</div>`;
  }
}

async function loadData() {
  await Promise.all([loadApplications(), loadLoans(), loadComplaints()]);
  renderDocuments();
  renderNextAction();
}

function showSignedInPortal(borrower) {
  const name = borrower.fullName || borrower.legalName || borrower.name || borrower.borrowerId;
  state.auth = { tenantId: urlTenantId, borrowerId: borrower.borrowerId, email: borrower.email || document.getElementById("borrower-email").value.trim(), name };
  dom.welcomeName.textContent = `Hello, ${name.split(" ")[0]}`;
  dom.profileName.textContent = name;
  dom.profileAvatar.textContent = name.charAt(0).toUpperCase();
  document.getElementById("esign-name").value = name;
  dom.authPanel.hidden = true;
  dom.mainPortal.hidden = false;
  dom.headerStatus.innerHTML = `<span class="secure-label"><span class="secure-dot"></span> Secure session</span><button class="text-button" id="btn-header-logout" type="button">Sign out</button>`;
  document.getElementById("btn-header-logout").addEventListener("click", disconnect);
  openPanel("home", false);
}

dom.authForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!dom.authForm.reportValidity()) return;
  const borrowerId = document.getElementById("borrower-id").value.trim();
  const email = document.getElementById("borrower-email").value.trim().toLowerCase();
  const codeInput = document.getElementById("borrower-code");
  const code = codeInput.value.trim();
  try {
    if (!code) {
      setButtonBusy(dom.authSubmit, true, "Sending secure code…");
      const challenge = await jsonFetch("/auth/borrower-challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: urlTenantId, borrowerId, email })
      });
      if (challenge.debugCode) codeInput.value = challenge.debugCode;
      document.getElementById("borrower-code-help").textContent = `Code sent. It expires at ${new Date(challenge.expiresAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}.`;
      dom.authSubmit.innerHTML = '<span>Continue securely</span><span aria-hidden="true">→</span>';
      dom.authSubmit.dataset.originalLabel = dom.authSubmit.innerHTML;
      codeInput.focus();
      showToast("One-time access code sent to your verified email.", "success");
      return;
    }

    setButtonBusy(dom.authSubmit, true, "Verifying your details…");
    const connected = await jsonFetch("/auth/borrower-connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: urlTenantId, borrowerId, email, code })
    });
    showSignedInPortal(connected.borrower);
    await loadData();
    showToast("Welcome back. Your latest loan information is ready.", "success");
  } catch (error) {
    showToast(error.message, "danger");
  } finally {
    setButtonBusy(dom.authSubmit, false);
  }
});

async function disconnect() {
  await fetch("/auth/logout", { method: "POST" }).catch(() => {});
  state.auth = { tenantId: urlTenantId, borrowerId: "", email: "", name: "" };
  state.applications = [];
  state.loans = [];
  state.complaints = [];
  document.getElementById("borrower-code").value = "";
  document.getElementById("borrower-code-help").textContent = "First, enter your ID and email to request a secure code.";
  dom.authSubmit.innerHTML = '<span>Send secure code</span><span aria-hidden="true">→</span>';
  dom.authSubmit.dataset.originalLabel = dom.authSubmit.innerHTML;
  dom.authPanel.hidden = false;
  dom.mainPortal.hidden = true;
  dom.headerStatus.innerHTML = `<span class="secure-label"><span class="secure-dot"></span> Secure access</span><a class="text-button" href="/t/${encodeURIComponent(urlTenantId)}/">Lender home</a>`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function showKfsModal(applicationId) {
  try {
    state.activeApplicationId = applicationId;
    const application = await jsonFetch(`/loans/applications/${encodeURIComponent(applicationId)}`);
    const kfs = application.kfs;
    if (!kfs) throw new Error("The Key Fact Statement is not available yet.");
    const principal = kfs.principalAmount ?? kfs.principal ?? application.amount ?? application.product?.requestedAmount;
    const totalFees = kfs.aprComputation?.mandatoryUpfrontCharges ?? (kfs.charges || []).reduce((sum, charge) => sum + Number(charge.amount || 0), 0);
    document.getElementById("kfs-principal").textContent = money(principal);
    document.getElementById("kfs-apr").textContent = `${(Number(kfs.aprBps || application.product?.aprBps || 0) / 100).toFixed(2)}%`;
    document.getElementById("kfs-tenor").textContent = `${kfs.tenorMonths || application.tenorMonths || application.product?.requestedTenorMonths || "—"} months`;
    document.getElementById("kfs-total-repay").textContent = money(kfs.aprComputation?.totalRepaymentAmount ?? principal);
    document.getElementById("kfs-fees").textContent = money(totalFees);
    document.getElementById("kfs-cooling").textContent = `${kfs.coolingOffDays ?? application.product?.coolingOffDays ?? "—"} days`;
    document.getElementById("kfs-recovery").textContent = titleCase(kfs.recoveryMechanism || application.product?.recoveryMechanism || "See agreement");
    dom.dialogKfs.showModal();
  } catch (error) {
    showToast(error.message, "danger");
  }
}

function showSigningModal(applicationId) {
  state.activeApplicationId = applicationId;
  dom.dialogSigning.showModal();
}

async function viewRepaymentSchedule(accountId, trigger) {
  const container = document.getElementById(`schedule-${accountId}`);
  const body = document.getElementById(`schedule-body-${accountId}`);
  if (!container || !body) return;
  if (!container.hidden) {
    container.hidden = true;
    trigger.textContent = "View repayment plan";
    return;
  }
  try {
    trigger.disabled = true;
    trigger.textContent = "Loading…";
    const data = await jsonFetch(`/loan-accounts/${encodeURIComponent(accountId)}/schedule`);
    body.innerHTML = (data.schedule || []).map(item => `
      <tr><td>${shortDate(item.dueDate)}</td><td>${money(installmentTotal(item))}</td><td>${money(item.principalDue ?? item.principalAmount)}</td><td>${money(item.interestDue ?? item.interestAmount)}</td><td><span class="status-pill">Scheduled</span></td></tr>
    `).join("") || '<tr><td colspan="5">No repayment instalments are available.</td></tr>';
    container.hidden = false;
    trigger.textContent = "Hide repayment plan";
  } catch (error) {
    showToast(error.message, "danger");
    trigger.textContent = "View repayment plan";
  } finally {
    trigger.disabled = false;
  }
}

document.addEventListener("click", event => {
  const panelTrigger = event.target.closest("[data-go-panel]");
  if (panelTrigger) openPanel(panelTrigger.dataset.goPanel);

  const action = event.target.closest("[data-action]");
  if (action?.dataset.action === "review-kfs") showKfsModal(action.dataset.id);
  if (action?.dataset.action === "sign-agreement") showSigningModal(action.dataset.id);
  if (action?.dataset.action === "view-schedule") viewRepaymentSchedule(action.dataset.id, action);
});

dom.navItems.forEach((item, index) => {
  item.addEventListener("click", () => openPanel(item.dataset.panel));
  item.addEventListener("keydown", event => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const forward = ["ArrowRight", "ArrowDown"].includes(event.key);
    const nextIndex = (index + (forward ? 1 : -1) + dom.navItems.length) % dom.navItems.length;
    dom.navItems[nextIndex].focus();
    openPanel(dom.navItems[nextIndex].dataset.panel, false);
  });
});

document.getElementById("btn-disconnect").addEventListener("click", disconnect);
document.getElementById("btn-kfs-close").addEventListener("click", () => dom.dialogKfs.close());
document.getElementById("btn-kfs-later").addEventListener("click", () => dom.dialogKfs.close());
document.getElementById("btn-signing-close").addEventListener("click", () => dom.dialogSigning.close());
document.getElementById("btn-signing-cancel").addEventListener("click", () => dom.dialogSigning.close());
document.getElementById("btn-data-pack-close").addEventListener("click", () => dom.dialogDataPack.close());
document.getElementById("btn-data-pack-done").addEventListener("click", () => dom.dialogDataPack.close());

document.getElementById("btn-kfs-accept").addEventListener("click", async event => {
  const button = event.currentTarget;
  try {
    setButtonBusy(button, true, "Recording acceptance…");
    await jsonFetch(`/loans/applications/${encodeURIComponent(state.activeApplicationId)}/kfs/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    dom.dialogKfs.close();
    await loadApplications();
    renderDocuments();
    renderNextAction();
    showToast("Your KFS acceptance has been recorded.", "success");
  } catch (error) {
    showToast(error.message, "danger");
  } finally {
    setButtonBusy(button, false);
  }
});

document.getElementById("btn-signing-execute").addEventListener("click", async event => {
  const button = event.currentTarget;
  const signerName = document.getElementById("esign-name").value.trim();
  const aadhaarNumber = document.getElementById("esign-aadhaar").value.trim();
  const otp = document.getElementById("esign-otp").value.trim();
  if (!signerName || !aadhaarNumber || !otp) {
    showToast("Enter the signer name, Aadhaar number and eSign OTP to continue.", "warning");
    return;
  }
  try {
    setButtonBusy(button, true, "Completing secure eSign…");
    await jsonFetch(`/loans/applications/${encodeURIComponent(state.activeApplicationId)}/document-packet/esign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signerName, aadhaarNumber, otp })
    });
    dom.dialogSigning.close();
    document.getElementById("esign-aadhaar").value = "";
    document.getElementById("esign-otp").value = "";
    await loadApplications();
    renderDocuments();
    renderNextAction();
    showToast("Your agreement was signed and submitted securely.", "success");
  } catch (error) {
    showToast(error.message, "danger");
  } finally {
    setButtonBusy(button, false);
  }
});

dom.complaintForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!dom.complaintForm.reportValidity()) return;
  const button = dom.complaintForm.querySelector("button[type=submit]");
  try {
    setButtonBusy(button, true, "Submitting securely…");
    await jsonFetch("/complaints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        borrowerId: state.auth.borrowerId,
        category: document.getElementById("complaint-category").value,
        summary: document.getElementById("complaint-summary").value.trim()
      })
    });
    document.getElementById("complaint-summary").value = "";
    await loadComplaints();
    renderNextAction();
    showToast("Your support request is recorded and ready to track here.", "success");
  } catch (error) {
    showToast(error.message, "danger");
  } finally {
    setButtonBusy(button, false);
  }
});

document.getElementById("btn-dpdp-access").addEventListener("click", async event => {
  const button = event.currentTarget;
  try {
    setButtonBusy(button, true, "Preparing your pack…");
    const request = await jsonFetch(`/borrowers/${encodeURIComponent(state.auth.borrowerId)}/access-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: state.auth.borrowerId })
    });
    const requestId = request.accessRequest.accessRequestId;
    const fulfilled = await jsonFetch(`/borrowers/${encodeURIComponent(state.auth.borrowerId)}/access-requests/${encodeURIComponent(requestId)}/fulfillment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: state.auth.borrowerId })
    });
    dom.dataPackJson.textContent = JSON.stringify(fulfilled.accessRequest?.dataPack || {}, null, 2);
    dom.dialogDataPack.showModal();
    showToast("Your portable data pack is ready.", "success");
  } catch (error) {
    showToast(error.message, "danger");
  } finally {
    setButtonBusy(button, false);
  }
});

dom.correctionForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!dom.correctionForm.reportValidity()) return;
  const button = dom.correctionForm.querySelector("button[type=submit]");
  try {
    setButtonBusy(button, true, "Submitting…");
    await jsonFetch(`/borrowers/${encodeURIComponent(state.auth.borrowerId)}/correction-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        field: document.getElementById("corr-field").value,
        proposedValue: document.getElementById("corr-val").value.trim(),
        actor: state.auth.borrowerId
      })
    });
    document.getElementById("corr-val").value = "";
    showToast("Your correction request is with the lender for review.", "success");
  } catch (error) {
    showToast(error.message, "danger");
  } finally {
    setButtonBusy(button, false);
  }
});

document.getElementById("btn-dpdp-erasure").addEventListener("click", async event => {
  if (!window.confirm("Request profile erasure? Your lender may need to retain records while a loan is active or statutory retention applies.")) return;
  const button = event.currentTarget;
  try {
    setButtonBusy(button, true, "Recording request…");
    const data = await jsonFetch("/erasure-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ borrowerId: state.auth.borrowerId, actor: state.auth.borrowerId })
    });
    if (data.erasureRequest.status === "rejected") {
      showToast(data.erasureRequest.rejectionReason || "Your request is held under statutory retention.", "warning");
      return;
    }
    try {
      await jsonFetch(`/erasure-requests/${encodeURIComponent(data.erasureRequest.erasureRequestId)}/fulfillment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: state.auth.borrowerId })
      });
      showToast("Your eligible profile information was erased.", "success");
      await disconnect();
    } catch {
      showToast("Your erasure request is recorded and awaiting retention clearance.", "info");
    }
  } catch (error) {
    showToast(error.message, "danger");
  } finally {
    setButtonBusy(button, false);
  }
});

function openFilm() {
  dom.filmDialog.showModal();
  dom.journeyFilm.play().catch(() => {});
}

function closeFilm() {
  dom.journeyFilm.pause();
  dom.filmDialog.close();
}

document.addEventListener("click", event => {
  if (event.target.closest("[data-open-film]")) openFilm();
  if (event.target.closest("[data-close-film]")) closeFilm();
});

[dom.dialogKfs, dom.dialogSigning, dom.dialogDataPack, dom.filmDialog].forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target === dialog) {
      if (dialog === dom.filmDialog) closeFilm();
      else dialog.close();
    }
  });
});

if (["localhost", "127.0.0.1"].includes(window.location.hostname) && urlTenantId === "dev") {
  document.getElementById("borrower-id").value = "borrower_1";
  document.getElementById("borrower-email").value = "rajesh@example.com";
}

loadBranding();
