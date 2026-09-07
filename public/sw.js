/* Service worker.
   The terminal must load with no network at all — a register that shows a
   dinosaur when the ISP drops is worthless. The shell is cached on install and
   served cache-first; API calls always go to the network and are never cached,
   because a stale pricebook is worse than no answer. */
const CACHE = "aipos-44f42cac78";
const SHELL = ["/app.html", "/login.html", "/sw.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("message", e => { if (e.data?.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;              // never cache the API

  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(hit => {
        const live = fetch(e.request).then(r => {
          if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
          return r;
        }).catch(() => hit);
        return hit || live;                                   // cache first, refresh behind
      })
    );
    return;
  }
  // fonts and other third-party assets: cache once, then serve from there
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => hit))
  );
});
