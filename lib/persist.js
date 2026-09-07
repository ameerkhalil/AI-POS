/* ---------------------------------------------------------------------------
   Persistence. Everything the terminal knows now lives on the server, keyed to
   the signed-in account's store. Config saves are debounced because the
   configuration screens fire on every keystroke; sales post immediately,
   because a sale that only exists in a browser tab is not a sale.
   --------------------------------------------------------------------------- */
let STORE_ID = null, ACCOUNT = null, SHIFT_ID = null, SAVE_STATE = "idle";

async function api(path, opts = {}) {
  const r = await fetch(path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (r.status === 401) { location.href = "/login.html"; throw new Error("signed out"); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
}

/* The AI call now goes through our own server, which holds the key. */
async function callAI(prompt, opts = {}) {
  const d = await api("/api/ai", { method: "POST", body: {
    messages: opts.messages || [{ role: "user", content: prompt }],
    tools: opts.tools, max_tokens: opts.max_tokens || 1024, kind: opts.kind
  }});
  if (d.error) throw new Error(d.error.message || d.error);
  return parseLoose(d.content.filter(b => b.type === "text").map(b => b.text).join(""));
}

let saveTimer = null;
function queueSave() {
  if (!STORE_ID || !savable()) return;
  setSaveState("pending");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 900);
}
const savable = () => !!(CFG && CFG.site && Array.isArray(CFG.plus) && Array.isArray(CFG.depts));
async function saveNow() {
  if (!STORE_ID || !savable()) return;
  cacheConfig(CFG);                       // always keep a local copy for a cold start
  if (!ONLINE) { await kvPut("configDirty", true); setSaveState("offline"); return; }
  try {
    setSaveState("saving");
    await api("/api/config?store=" + STORE_ID, { method: "PUT", body: { store: STORE_ID, config: CFG } });
    await kvPut("configDirty", false);
    setSaveState("saved");
  } catch (e) {
    await kvPut("configDirty", true);
    ONLINE = false; paintConnection();
    setSaveState("offline");
  }
}
function setSaveState(s) {
  SAVE_STATE = s;
  const el = document.getElementById("saveChip");
  if (!el) return;
  el.className = "tchip save " + s;
  el.textContent = { idle: "Saved", pending: "Unsaved changes", saving: "Saving…",
                     saved: "Saved", offline: "Saved on this device",
                     error: "Not saved — retrying" }[s];
  if (s === "error") setTimeout(saveNow, 4000);
}
/* Nothing should be lost to a closed tab. */
window.addEventListener("beforeunload", e => {
  if (!savable()) return;
  if (SAVE_STATE === "pending" || SAVE_STATE === "saving") {
    navigator.sendBeacon?.("/api/config?store=" + STORE_ID,
      new Blob([JSON.stringify({ store: STORE_ID, config: CFG })], { type: "application/json" }));
  }
});

/* A completed sale is written to this device before anything is sent. If the
   upload works, the local copy is dropped; if it doesn't, it stays queued and
   goes out on the next flush. The cashier never waits on either. */
async function postSale(sale) {
  sale.cid = sale.cid || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  await queueSale(sale);
  if (!ONLINE) return;
  try {
    await api("/api/sales?store=" + STORE_ID,
      { method: "POST", body: { store: STORE_ID, sale, shiftId: SHIFT_ID } });
    await dropQueued([sale.cid]);
  } catch (e) {
    ONLINE = false; paintConnection();
  }
}
async function openShift(startCash) {
  if (!ONLINE) return;
  try {
    const d = await api("/api/shifts?store=" + STORE_ID,
      { method: "POST", body: { store: STORE_ID, by: ME?.n, startCash } });
    SHIFT_ID = d.id;
  } catch (e) {}
}
async function closeShift(counted, summary) {
  await flush();                          // get every held sale in before the read
  if (!SHIFT_ID || !ONLINE) return;
  try { await api(`/api/shifts/${SHIFT_ID}?store=${STORE_ID}`,
    { method: "PATCH", body: { store: STORE_ID, counted, summary } }); } catch (e) {}
  SHIFT_ID = null;
}

/* --------------------------------- start --------------------------------- */
async function initApp() {
  startOffline();
  let me = null;
  try { me = await api("/api/me"); } catch (e) { /* may simply be offline */ }

  const savedStore = localStorage.getItem("pos_store");
  if (me) {
    ACCOUNT = me.account;
    const pick = me.stores.find(s => String(s.id) === savedStore) || me.stores[0];
    if (!pick) { location.href = "/login.html"; return; }
    STORE_ID = pick.id;
    localStorage.setItem("pos_store", String(STORE_ID));
  } else if (savedStore) {
    /* No network, but this device has been signed in before and holds a cached
       pricebook. Opening the till matters more than proving who you are again. */
    STORE_ID = Number(savedStore);
    ACCOUNT = { email: localStorage.getItem("pos_email") || "offline" };
    ONLINE = false; paintConnection();
  } else {
    location.href = "/login.html"; return;
  }
  if (ACCOUNT?.email) localStorage.setItem("pos_email", ACCOUNT.email);
  findStation();
  if (ONLINE) loadPayCfg();

  /* A half-written or stale object will boot the terminal into a state where
     nothing works and nothing says why. Check it looks like a configuration
     before trusting it. */
  const usable = c => !!(c && c.site && Array.isArray(c.plus) && Array.isArray(c.depts)
    && Array.isArray(c.taxRates) && Array.isArray(c.mops));

  let cfg = null, loadErr = null;
  if (me) {
    try { cfg = (await api("/api/config?store=" + STORE_ID)).config; }
    catch (e) { loadErr = e.message; }
  }
  if (!usable(cfg)) cfg = await cachedConfig();
  if (!usable(cfg)) {
    if (cfg) { cfg = null; try { await kvPut("config:" + STORE_ID, null); } catch (e) {} }
  }

  if (cfg) {
    CFG = cfg;
    cacheConfig(cfg);
    CFG.pricing = CFG.pricing || { margin: 35, ending: "x9", dir: "nearest" };
    CFG.modGroups = CFG.modGroups || [];
    CFG.reminders = CFG.reminders || [];
    document.getElementById("setup").classList.add("hide");
    boot();
  } else if (!ONLINE) {
    document.getElementById("building").style.display = "flex";
    document.getElementById("buildBody").innerHTML =
      `<h2>No connection, and nothing cached</h2>
       <div class="err">This terminal hasn't finished setup on this device yet, and setup needs the
         network. Once it's been set up once, it opens and takes sales offline.</div>`;
  } else if (loadErr) {
    document.getElementById("building").style.display = "flex";
    document.getElementById("buildBody").innerHTML =
      `<h2>Couldn't load this store</h2>
       <div class="err">The server refused the request for this store's configuration.<br><br>
         <span style="color:var(--ink-soft)">${loadErr}</span></div>
       <div class="nav"><button class="go" id="lr">Start setup fresh</button></div>`;
    document.getElementById("lr").onclick = () => {
      document.getElementById("building").style.display = "none";
      document.getElementById("setup").classList.remove("hide");
      draw();
    };
  } else {
    document.getElementById("setup").classList.remove("hide");
    draw();                        // first run for this store: the wizard
  }
}

/* Account chip in the header: who you are, which store, and a way out. */
function accountMenu() {
  api("/api/me").then(me => {
    const el = veil(`<div class="card"><h3>Account</h3>
      <p>${esc(ACCOUNT.email)}</p>
      <div class="sect">Stores</div>
      <div class="opts" style="flex-direction:column">${me.stores.map(s =>
        `<button data-s="${s.id}" style="width:100%;${s.id === STORE_ID
          ? "background:rgba(92,224,168,.16);border-color:var(--vfd)" : ""}">
          ${esc(s.name)}${s.configured ? "" : ` <span style="color:var(--txt-3);font-size:12px">· not set up</span>`}
        </button>`).join("")}
        <button id="newStore" style="width:100%">Add another store…</button></div>
      <div class="row"><button class="no" id="acn">Close</button>
        <button class="danger" id="aco">Sign out</button></div></div>`);
    el.querySelectorAll("[data-s]").forEach(b => b.onclick = () => {
      localStorage.setItem("pos_store", b.dataset.s);
      location.reload();
    });
    el.querySelector("#newStore").onclick = () => {
      el.remove();
      ask({ t: "Add a store", p: "Each store gets its own pricebook, staff and reports.",
        yes: "Create it", done: () => {} });
      const inp = document.querySelector(".veil .card input");
      if (inp) { inp.type = "text"; inp.value = ""; inp.classList.remove("num"); inp.style.textAlign = "left";
        inp.placeholder = "Second location"; inp.focus();
        document.querySelector(".veil .card .ok").onclick = async () => {
          const name = inp.value.trim(); if (!name) return;
          const d = await api("/api/stores", { method: "POST", body: { name } });
          localStorage.setItem("pos_store", String(d.id));
          location.reload();
        };
      }
    };
    el.querySelector("#acn").onclick = () => el.remove();
    el.querySelector("#aco").onclick = async () => {
      await saveNow();
      await api("/api/logout", { method: "POST" });
      location.href = "/login.html";
    };
  });
}
