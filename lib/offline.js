/* ---------------------------------------------------------------------------
   Offline.

   A register that stops when the internet hiccups is not a register. Everything
   needed to complete a sale — the pricebook, the tax rates, the tenders — is
   held locally, and a completed sale is written to IndexedDB before anything is
   sent anywhere. The network is treated as a nice-to-have that catches up later,
   not as a precondition for taking money.

   Two rules make the sync safe:
     1. Every sale carries a client-generated id, so replaying the queue can
        never double-post a transaction.
     2. The queue is only cleared for records the server has confirmed. A failed
        flush leaves the sale exactly where it was.
   --------------------------------------------------------------------------- */

const IDB_NAME = "aipos", IDB_VER = 1;
let _db = null, ONLINE = navigator.onLine, SYNCING = false, QUEUED = 0;

function idb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, IDB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("queue")) d.createObjectStore("queue", { keyPath: "cid" });
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return idb().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
  }));
}
const kvGet = k => tx("kv", "readonly", s => s.get(k));
const kvPut = (k, v) => tx("kv", "readwrite", s => s.put(v, k));

/* ------------------------------ the queue -------------------------------- */
async function queueSale(sale) {
  await tx("queue", "readwrite", s => s.put({ cid: sale.cid, at: Date.now(), kind: "sale", body: sale }));
  await refreshQueueCount();
}
async function queuedItems() { return tx("queue", "readonly", s => s.getAll()); }
async function dropQueued(cids) {
  await tx("queue", "readwrite", s => { cids.forEach(c => s.delete(c)); });
  await refreshQueueCount();
}
async function refreshQueueCount() {
  try { QUEUED = (await tx("queue", "readonly", s => s.count())) || 0; } catch (e) { QUEUED = 0; }
  paintConnection();
  return QUEUED;
}

/* --------------------------- connection state ----------------------------- */
/* navigator.onLine only knows whether a network interface exists. A café Wi-Fi
   that has associated but isn't routing still reports true, so we ask the
   server directly and believe that instead. */
async function probe() {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 4000);
    const r = await fetch("/api/ping", { signal: c.signal, credentials: "same-origin", cache: "no-store" });
    clearTimeout(t);
    return r.ok;
  } catch (e) { return false; }
}
async function checkConnection(force) {
  const was = ONLINE;
  ONLINE = navigator.onLine ? await probe() : false;
  paintConnection();
  if (ONLINE && (!was || force)) flush();
  return ONLINE;
}
function paintConnection() {
  const el = document.getElementById("netChip");
  if (!el) return;
  el.className = "tchip net " + (SYNCING ? "sync" : ONLINE ? "on" : "off");
  el.innerHTML = SYNCING ? `<span class="sig"></span>Syncing…`
    : ONLINE ? `<span class="sig"></span>Online${QUEUED ? ` · ${QUEUED} to send` : ""}`
    : `<span class="sig"></span>Offline${QUEUED ? ` · ${QUEUED} held` : " · sales still work"}`;
  el.title = ONLINE
    ? (QUEUED ? `${QUEUED} record${QUEUED === 1 ? "" : "s"} waiting to upload` : "Everything is saved to the server")
    : "Working from this device. Sales are held here and sent when the connection returns.";
}

/* -------------------------------- flushing -------------------------------- */
async function flush() {
  if (SYNCING || !ONLINE || !STORE_ID) return;
  const items = await queuedItems();
  if (!items.length) { await pushDirtyConfig(); return; }
  SYNCING = true; paintConnection();
  try {
    const sales = items.filter(i => i.kind === "sale").map(i => i.body);
    const d = await api("/api/sync?store=" + STORE_ID, { method: "POST", body: {
      store: STORE_ID, sales, shiftId: SHIFT_ID } });
    const done = new Set(d.accepted || []);
    await dropQueued(items.filter(i => done.has(i.cid)).map(i => i.cid));
    await pushDirtyConfig();
    const left = await refreshQueueCount();
    if (done.size) toast(`Sent <b>${done.size}</b> held sale${done.size === 1 ? "" : "s"} to the server` +
      `${left ? `, ${left} still queued` : ""}.`);
  } catch (e) {
    ONLINE = false;                       // the flush is the truest connection test there is
  } finally { SYNCING = false; paintConnection(); }
}
async function pushDirtyConfig() {
  const dirty = await kvGet("configDirty");
  if (!dirty) return;
  try {
    await api("/api/config?store=" + STORE_ID, { method: "PUT", body: { store: STORE_ID, config: CFG } });
    await kvPut("configDirty", false);
    setSaveState("saved");
  } catch (e) { /* stays dirty, retried on the next flush */ }
}

/* A cashier mid-sale should never have the page pulled from under them, so the
   reload waits for their word. */
function offerUpdate(reg) {
  if (document.querySelector(".updatebar")) return;
  const bar = document.createElement("div");
  bar.className = "updatebar";
  bar.innerHTML = `<span>A new version of the terminal is ready.</span>
    <button id="upLater">Not now</button><button id="upGo">Reload</button>`;
  document.body.appendChild(bar);
  bar.querySelector("#upLater").onclick = () => bar.remove();
  bar.querySelector("#upGo").onclick = async () => {
    try { await saveNow(); await flush(); } catch (e) {}
    reg.waiting?.postMessage({ type: "SKIP_WAITING" });
    location.reload();
  };
}

/* ------------------------------ local cache ------------------------------- */
/* The pricebook has to survive a cold start with no network, so it is written
   here every time it is saved and read back before the terminal boots. */
const cacheConfig = c => kvPut("config:" + STORE_ID, c).catch(() => {});
const cachedConfig = () => kvGet("config:" + STORE_ID).catch(() => null);

function startOffline() {
  window.addEventListener("online", () => checkConnection(true));
  window.addEventListener("offline", () => { ONLINE = false; paintConnection(); });
  setInterval(() => checkConnection(), 20000);
  refreshQueueCount();
  checkConnection(true);
  /* Updating a POS should not require anyone to know what a service worker is.
     The cache name changes every build, so a new one installs beside the old
     and we offer the reload rather than serving yesterday's terminal forever. */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then(reg => {
      /* A worker may already be waiting from a previous visit — offer that
         immediately rather than only reacting to one that arrives later. */
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg);
      reg.update().catch(() => {});
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) offerUpdate(reg);
        });
      });
      setInterval(() => reg.update().catch(() => {}), 10 * 60 * 1000);
    }).catch(() => {});
  }
}
