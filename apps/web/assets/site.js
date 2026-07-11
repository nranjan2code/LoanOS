const path = window.location.pathname.replace(/\/$/, '') || '/';

const header = `
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="announcement"><div class="wrap"><strong>Important:</strong> LoanOS powers regulated lenders and their partners. LoanOS does not lend directly.</div></div>
  <header class="site-header">
    <div class="wrap nav">
      <a class="brand" href="/" aria-label="LoanOS India home">
        <span class="brand-mark"><span>L</span></span>
        <span class="brand-copy">LoanOS <small>India lending operating system</small></span>
      </a>
      <nav class="nav-main" id="site-nav" aria-label="Main navigation">
        <div class="nav-group">
          <button type="button">Who it’s for</button>
          <div class="mega">
            <a href="/for-msmes/"><strong>MSMEs & borrowers</strong><span>See what a clearer loan journey should feel like.</span></a>
            <a href="/financial-institutions/"><strong>Financial institutions</strong><span>Banks, NBFCs, HFCs, co-operatives and AIFIs.</span></a>
            <a href="/partners/"><strong>Lending partners</strong><span>LSPs, DLAs, fintechs, DSAs, vendors and co-lenders.</span></a>
            <a href="/loan-types/"><strong>Loan & product library</strong><span>Explore business, retail, secured and specialised journeys.</span></a>
          </div>
        </div>
        <a data-route="/platform" href="/platform/">Platform</a>
        <a data-route="/loan-types" href="/loan-types/">Loan types</a>
        <a data-route="/trust" href="/trust/">Trust centre</a>
        <a data-route="/resources" href="/resources/">Learn</a>
      </nav>
      <div class="nav-actions">
        <a class="button ghost" href="/t/dev/staff/">Sign in</a>
        <a class="button ink" href="mailto:hello@loanos.in?subject=Show%20me%20LoanOS">Book a walkthrough <span class="arrow">→</span></a>
        <button class="menu" id="menu" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="site-nav">☰</button>
      </div>
    </div>
  </header>`;

const footer = `
  <footer class="site-footer">
    <div class="wrap">
      <div class="footer-grid">
        <div class="footer-brand">
          <a class="brand" href="/"><span class="brand-mark"><span>L</span></span><span class="brand-copy">LoanOS <small>India lending operating system</small></span></a>
          <p class="footer-intro">One accountable operating system for lending journeys, teams, partners and evidence—built around India.</p>
        </div>
        <div class="footer-col"><h3>Audiences</h3><a href="/for-msmes/">MSMEs & borrowers</a><a href="/financial-institutions/">Banks & institutions</a><a href="/partners/">Partners & fintechs</a></div>
        <div class="footer-col"><h3>Explore</h3><a href="/platform/">Platform</a><a href="/loan-types/">Loan types</a><a href="/trust/">Trust centre</a></div>
        <div class="footer-col"><h3>Learn</h3><a href="/resources/">Resource room</a><a href="/resources/#glossary">Plain-language glossary</a><a href="/resources/#faq">Common questions</a></div>
        <div class="footer-col"><h3>Product</h3><a href="/t/dev/portal/">Customer demo</a><a href="/t/dev/staff/">Team workspace</a><a href="mailto:hello@loanos.in?subject=LoanOS%20partnership">Contact us</a></div>
      </div>
      <div class="footer-bottom"><span>© 2026 LoanOS India. All rights reserved.</span><span>India-only • INR-first • Human-governed AI</span></div>
    </div>
  </footer>`;

document.querySelector('[data-site-header]')?.insertAdjacentHTML('afterbegin', header);
document.querySelector('[data-site-footer]')?.insertAdjacentHTML('afterbegin', footer);

document.querySelectorAll('[data-route]').forEach(link => {
  if (path === link.dataset.route || path.startsWith(`${link.dataset.route}/`)) link.classList.add('active');
});

const menu = document.getElementById('menu');
const nav = document.getElementById('site-nav');
menu?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  document.body.classList.toggle('nav-open', open);
  menu.setAttribute('aria-expanded', String(open));
  menu.textContent = open ? '×' : '☰';
  menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
});
nav?.addEventListener('click', event => {
  if (!event.target.closest('a')) return;
  nav.classList.remove('open');
  document.body.classList.remove('nav-open');
  menu?.setAttribute('aria-expanded', 'false');
});

document.querySelectorAll('[data-filter-group]').forEach(group => {
  const buttons = [...group.querySelectorAll('[data-filter]')];
  const targetSelector = group.dataset.filterTarget;
  const targets = [...document.querySelectorAll(targetSelector)];
  const count = group.dataset.countTarget ? document.querySelector(group.dataset.countTarget) : null;
  const applyFilter = button => {
    const filter = button.dataset.filter;
    buttons.forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    let visible = 0;
    targets.forEach(target => {
      const values = (target.dataset.categories || '').split(' ');
      const show = filter === 'all' || values.includes(filter);
      target.hidden = !show;
      if (show) visible += 1;
    });
    if (count) count.textContent = `${visible} journey${visible === 1 ? '' : 's'}`;
  };
  buttons.forEach(button => button.addEventListener('click', () => applyFilter(button)));
  const requestedFilter = new URLSearchParams(window.location.search).get('category');
  const requestedButton = buttons.find(button => button.dataset.filter === requestedFilter);
  if (requestedButton) applyFilter(requestedButton);
});

document.querySelectorAll('[data-switcher]').forEach(switcher => {
  const buttons = [...switcher.querySelectorAll('[data-switch]')];
  const scope = switcher.closest('[data-switcher-scope]') || document;
  const panels = [...scope.querySelectorAll('[data-panel]')];
  buttons.forEach(button => button.addEventListener('click', () => {
    const target = button.dataset.switch;
    buttons.forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    panels.forEach(panel => panel.classList.toggle('active', panel.dataset.panel === target));
  }));
});

const filmDialog = document.getElementById('film-dialog');
const film = document.getElementById('loanos-film');
document.querySelectorAll('[data-open-film]').forEach(button => button.addEventListener('click', () => {
  if (!filmDialog) return;
  filmDialog.showModal();
  film?.play().catch(() => {});
}));
document.querySelectorAll('[data-close-film]').forEach(button => button.addEventListener('click', () => {
  film?.pause();
  filmDialog?.close();
}));
filmDialog?.addEventListener('click', event => {
  if (event.target !== filmDialog) return;
  film?.pause();
  filmDialog.close();
});

document.querySelectorAll('[data-print]').forEach(button => button.addEventListener('click', () => window.print()));

const revealObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }), { threshold: .12 })
  : null;
document.querySelectorAll('.reveal').forEach(element => revealObserver ? revealObserver.observe(element) : element.classList.add('visible'));
