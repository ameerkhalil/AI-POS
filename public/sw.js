/* Service worker.
   The terminal must load with no network at all — a register that shows a
   dinosaur when the ISP drops is worthless. The shell is cached on install and
   served cache-first; API calls always go to the network and are never cached,
   because a stale pricebook is worse than no answer. */
const CACHE = "aipos-b24b1a6f48";
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

  /* The station agent lives on localhost and is often simply not running.
     That is not an error worth intercepting. */
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    if (url.origin !== location.origin) return;
  }
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(hit => {
        const live = fetch(e.request).then(r => {
          if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
          return r;
        }).catch(() => hit || new Response("", { status: 504, statusText: "Offline" }));
        return hit || live;                                   // cache first, refresh behind
      })
    );
    return;
  }
  /* Third-party assets: cache once, then serve from there. A handler that
     resolves to undefined throws "Failed to convert value to Response" and
     poisons the console, so always hand back something. */
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => hit || new Response("", { status: 504, statusText: "Offline" })))
  );
});
