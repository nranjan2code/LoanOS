// Shared, session-only learning aids for both Academies. Deliberately stores no
// learner state: formal progress tracking remains outside the current contract.
const contextBack = document.querySelector("[data-context-back]");
if (contextBack) {
  contextBack.addEventListener("click", () => {
    const fallback = contextBack.dataset.fallback || "/help/";
    const returnTo = new URL(location.href).searchParams.get("returnTo");
    if (returnTo?.startsWith("/help/") && !returnTo.startsWith("//")) {
      location.assign(returnTo);
      return;
    }
    let sameOriginReferrer = false;
    try { sameOriginReferrer = Boolean(document.referrer) && new URL(document.referrer).origin === location.origin; }
    catch { sameOriginReferrer = false; }
    if (sameOriginReferrer && history.length > 1) history.back();
    else location.assign(fallback);
  });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = new URL(link.href, location.href);
  const isAcademyPage = target.origin === location.origin && (target.pathname.startsWith("/help/academy/") || target.pathname.startsWith("/help/technical-academy/"));
  const isSameDocument = target.pathname === location.pathname && target.search === location.search;
  if (!isAcademyPage || isSameDocument) return;
  target.searchParams.set("returnTo", `${location.pathname}${location.search}${location.hash}`);
  link.href = target.href;
});

const lesson = document.querySelector(".lesson, .lesson-layout, .journey-hero");

if (lesson) {
  const progress = document.createElement("div");
  progress.className = "reading-progress";
  progress.setAttribute("aria-hidden", "true");
  progress.innerHTML = '<span class="reading-progress-bar"></span>';
  document.body.prepend(progress);

  const tools = document.createElement("div");
  tools.className = "learning-tools";
  tools.setAttribute("aria-label", "Reading tools");
  tools.innerHTML = '<button type="button" data-focus-mode aria-pressed="false">Focus mode</button><a href="#main">Back to top ↑</a>';
  document.body.append(tools);

  const focusButton = tools.querySelector("[data-focus-mode]");
  focusButton.addEventListener("click", () => {
    const enabled = document.body.classList.toggle("focus-mode");
    focusButton.setAttribute("aria-pressed", String(enabled));
    focusButton.textContent = enabled ? "Exit focus" : "Focus mode";
  });

  const updateProgress = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
    progress.querySelector("span").style.transform = `scaleX(${ratio})`;
  };
  updateProgress();
  window.addEventListener("scroll", updateProgress, { passive: true });

  const tocLinks = [...document.querySelectorAll(".toc a, .journey-nav a")];
  const targets = tocLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
  if (targets.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      tocLinks.forEach((link) => {
        const active = link.getAttribute("href") === `#${visible.target.id}`;
        link.classList.toggle("is-current", active);
        if (active) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    }, { rootMargin: "-18% 0px -68%", threshold: 0 });
    targets.forEach((target) => observer.observe(target));
  }
}
