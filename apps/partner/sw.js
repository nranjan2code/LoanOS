const SHELL_CACHE = "loanos-channel-shell-v1";
const SHELL = ["./", "./assets/partner.css?v=1", "./assets/partner.js?v=1", "/shared/design-tokens.css"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const staticPaths = ["/assets/partner.css", "/assets/partner.js", "/shared/design-tokens.css"];
  const isStaticShell = staticPaths.some((path) => url.pathname.endsWith(path)) || url.pathname.endsWith("/partners/");
  if (!isStaticShell) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request)));
});
