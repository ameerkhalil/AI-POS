/* ---------------------------------------------------------------------------
   Hardware and card payments, terminal side.

   The station agent runs on this machine and owns the printer and drawer. The
   card reader is driven by our server, not by this browser — so the terminal's
   job for both is to ask, then wait, and to say clearly what is happening while
   it waits. A cashier staring at a frozen screen will press the button again.
   --------------------------------------------------------------------------- */

const AGENT = "http://127.0.0.1:9110";
let STATION = null, PAYCFG = null;

async function agent(path, body) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), body === undefined ? 2500 : 15000);
  try {
    const r = await fetch(AGENT + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: c.signal
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Station agent error");
    return d;
  } finally { clearTimeout(t); }
}
async function findStation() {
  /* The agent is per-terminal and often absent — on a phone, on a reviewer's
     laptop, on any machine where nobody started it. Absent is a normal state. */
  try { STATION = await agent("/status"); } catch (e) { STATION = null; }
  paintStation();
  return STATION;
}
function paintStation() {
  const el = document.getElementById("hwChip");
  if (!el) return;
  const ok = STATION && STATION.ready;
  el.className = "tchip hw " + (ok ? "on" : STATION ? "warn" : "off");
  el.textContent = ok ? "Printer ready" : STATION ? "No printer set" : "No station agent";
  el.title = ok ? `Printing to ${STATION.printer}`
    : STATION ? "The agent is running but no printer is paired — Config → Hardware"
    : "Receipts will print through the browser instead. Run the station agent for the drawer.";
}

/* --------------------------- printing a receipt --------------------------- */
/* Built as instructions rather than text, so the agent decides the column width
   and the same receipt prints correctly on 58mm or 80mm paper. */
function receiptDoc(s, opts) {
  const L = [];
  L.push({ t: "title", v: CFG.site.name });
  if (CFG.site.addr) L.push({ t: "center", v: CFG.site.addr });
  if (CFG.site.tagline) L.push({ t: "center", v: CFG.site.tagline });
  L.push({ t: "rule" });
  if (s.train) { L.push({ t: "center", v: "** TRAINING — NOT A SALE **" }, { t: "rule" }); }
  L.push({ t: "row", l: `Store ${CFG.site.store} Reg ${CFG.site.register}`, r: `#${s.n}` });
  L.push({ t: "row", l: new Date(s.at).toLocaleString(), r: s.ret ? "REFUND" : "SALE" });
  if (s.by) L.push({ t: "row", l: "Cashier", r: s.by });
  L.push({ t: "rule" });
  s.lines.forEach(c => {
    const eff = c.price * c.q * (1 - (c.disc || 0) / 100);
    L.push({ t: "row", l: (c.q > 1 ? c.q + " x " : "") + c.n, r: (s.ret ? "-" : "") + money(eff) });
    if (c.mods?.length) L.push("   " + c.mods.join(", "));
    if (c.note) L.push("   " + c.note);
  });
  L.push({ t: "rule" });
  L.push({ t: "row", l: "Subtotal", r: money(s.sub) });
  if (Math.abs(s.promoOff) > 0.001) L.push({ t: "row", l: "Promotions", r: "-" + money(Math.abs(s.promoOff)) });
  if (s.manualDisc) L.push({ t: "row", l: "Discount", r: "-" + money(Math.abs(s.disc)) });
  CFG.taxRates.filter(r => r.rate > 0 && Math.abs(s.taxes[r.id] || 0) > 0.001)
    .forEach(r => L.push({ t: "row", l: `${r.n} ${r.rate}%`, r: money((s.taxes[r.id] || 0) * (s.ret ? -1 : 1)) }));
  if (Math.abs(s.roundAdj) > 0.001) L.push({ t: "row", l: "Cash rounding", r: money(-s.roundAdj) });
  L.push({ t: "bigrow", l: s.ret ? "REFUND" : "TOTAL", r: money(s.tot + (s.roundAdj || 0)) });
  L.push({ t: "rule" });
  s.pays.forEach(p => {
    L.push({ t: "row", l: p.mop + (p.brand ? ` ${p.brand} ****${p.last4}` : "")
      + (p.refund ? " refund" : ""), r: money(Math.abs(p.amt)) });
    if (p.change > 0.001) L.push({ t: "row", l: "Change", r: money(p.change) });
  });
  if (s.against) L.push({ t: "rule" }, { t: "center", v: "Refund against sale #" + s.against });
  if (s.reason) L.push({ t: "rule" }, { t: "center", v: "Reason: " + s.reason });
  L.push({ t: "rule" }, { t: "center", v: CFG.receipt?.footer || "Thank you" });
  if (CFG.receipt?.policy) L.push({ t: "center", v: CFG.receipt.policy });
  L.push({ t: "blank" });
  return { lines: L, kick: !!(opts && opts.kick) };
}
async function printReceipt(s, opts) {
  if (STATION && STATION.ready) {
    try { await agent("/print", receiptDoc(s, opts)); return "printed"; }
    catch (e) { toast(`Printer didn't respond: ${esc(e.message)}`, true); return "failed"; }
  }
  browserPrint(s);
  return "browser";
}
/* No agent? Fall back to the browser's own print dialogue. A receipt on A4 is
   worse than a receipt on till roll, and much better than none. */
function browserPrint(s) {
  const doc = receiptDoc(s, {});
  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) return toast("Allow pop-ups to print without the station agent.", true);
  const row = e => typeof e === "string" ? `<div class="l">${esc(e)}</div>`
    : e.t === "rule" ? `<hr>`
    : e.t === "blank" ? `<br>`
    : e.t === "title" ? `<div class="t">${esc(e.v)}</div>`
    : e.t === "center" ? `<div class="c">${esc(e.v)}</div>`
    : e.t === "bigrow" ? `<div class="r b"><span>${esc(e.l)}</span><span>${esc(e.r)}</span></div>`
    : e.t === "row" ? `<div class="r"><span>${esc(e.l)}</span><span>${esc(e.r)}</span></div>`
    : `<div class="l">${esc(e.v ?? "")}</div>`;
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Receipt</title><style>
    body{font:12px/1.6 "Courier New",monospace;width:76mm;margin:0 auto;padding:8mm 4mm;color:#000}
    .t{text-align:center;font-size:16px;font-weight:700;margin-bottom:3px}
    .c{text-align:center}.r{display:flex;justify-content:space-between;gap:8px}
    .b{font-weight:700;font-size:14px}hr{border:none;border-top:1px dashed #999;margin:6px 0}
    @media print{@page{margin:0}}
  </style>${doc.lines.map(row).join("")}<script>window.onload=()=>{print();setTimeout(close,400)}<\\/script>`);
  w.document.close();
}
async function kickDrawer() {
  if (!(STATION && STATION.ready)) return false;
  try { await agent("/drawer", {}); return true; } catch (e) { return false; }
}

/* ------------------------------ card payment ------------------------------ */
/* Server-driven: we create an intent, the reader collects it, we poll. The
   cashier sees the reader's state the whole time, and cancelling here cancels
   it on the reader too rather than leaving it waiting for a card. */
async function cardPayment(mop, due, saleCid) {
  if (!ONLINE) {
    alertCard("No connection", `Card payments need the network. Take ${money(due)} as cash, or wait for the connection to come back — sales are still being recorded either way.`);
    return null;
  }
  if (!PAYCFG?.configured || !PAYCFG?.readerId) {
    return new Promise(res => {
      const el = veil(`<div class="card"><h3>${esc(mop.n)}</h3>
        <p>No card reader is paired to this register, so this can't be taken automatically.
          Run it on your existing terminal and record it here.</p>
        <div class="chg"><span>Amount</span><b>${money(due)}</b></div>
        <div class="row"><button class="no" id="cn">Cancel</button>
          <button class="ok" id="cy">Approved on the other terminal</button></div>
        <div class="row"><button class="no" id="cs" style="font-size:12.5px">Set up a reader</button></div></div>`);
      el.querySelector("#cn").onclick = () => { el.remove(); res(null); };
      el.querySelector("#cy").onclick = () => { el.remove(); res({ manual: true }); };
      el.querySelector("#cs").onclick = () => { el.remove(); res(null); go("config"); TAB = "hardware"; drawConfig(); };
    });
  }

  return new Promise(async res => {
    let intent = null, done = false, poll = null;
    const el = veil(`<div class="card"><h3>${esc(mop.n)}</h3>
      <p id="payMsg">Sending ${money(due)} to the reader…</p>
      <div class="chg"><span>Amount</span><b>${money(due)}</b></div>
      <div class="paystate" id="payState"><span class="spin"></span><span id="payStep">Starting</span></div>
      <div class="row"><button class="no" id="pc">Cancel</button></div>
      ${PAYCFG.mode === "test" ? `<div class="row"><button class="no" id="ptap" style="font-size:12.5px">Simulate a tap</button></div>` : ""}
    </div>`);
    const step = (t, cls) => { const s = document.getElementById("payStep");
      if (s) { s.textContent = t; s.className = cls || ""; } };
    const finish = v => { if (done) return; done = true; clearInterval(poll); el.remove(); res(v); };

    el.querySelector("#pc").onclick = async () => {
      step("Cancelling…");
      try { await api("/api/pay/cancel?store=" + STORE_ID,
        { method: "POST", body: { store: STORE_ID, intent } }); } catch (e) {}
      finish(null);
    };
    if (PAYCFG.mode === "test") el.querySelector("#ptap").onclick = async () => {
      try { await api("/api/pay/simulate-tap?store=" + STORE_ID, { method: "POST", body: { store: STORE_ID } }); }
      catch (e) { step(e.message, "bad"); }
    };

    try {
      const d = await api("/api/pay/start?store=" + STORE_ID, { method: "POST",
        body: { store: STORE_ID, amount: due, saleCid, register: CFG.site.register } });
      intent = d.intent;
      step("Waiting for the card");
      document.getElementById("payMsg").textContent = "Ask the customer to tap, insert or swipe.";
    } catch (e) { step(e.message, "bad"); setTimeout(() => finish(null), 2600); return; }

    poll = setInterval(async () => {
      try {
        const s = await api(`/api/pay/status?store=${STORE_ID}&intent=${intent}`);
        if (s.status === "requires_capture" || s.status === "succeeded") {
          step("Approved", "ok");
          finish({ intent, brand: s.brand, last4: s.last4, amount: s.amount / 100 });
        } else if (s.status === "canceled") { step("Cancelled at the reader", "bad"); setTimeout(() => finish(null), 1400); }
        else if (s.error) { step(s.error, "bad"); }
        else if (s.status === "processing") step("Processing");
      } catch (e) { /* a poll that fails is not a payment that failed */ }
    }, 1400);
  });
}
/* Capture after the sale is recorded, never before. A crash in between leaves an
   uncaptured authorisation that expires, rather than a charge with no receipt. */
async function capturePayment(intent) {
  if (!intent) return;
  try {
    const r = await api("/api/pay/capture?store=" + STORE_ID,
      { method: "POST", body: { store: STORE_ID, intent } });
    return r.status;
  } catch (e) {
    /* Only worth interrupting the cashier if the money is actually at risk. An
       authorisation that never captures expires on its own, but somebody needs
       to know it happened before the customer has walked out. */
    toast(`Card authorised but not captured. The customer has not been charged — `
      + `take it again or void the sale. ${esc(e.message)}`, true);
  }
}

/* ------------------------------ config tab -------------------------------- */
function tHardware() {
  W.saveKey = async () => {
    const fld = document.getElementById("skKey");
    const msg = document.getElementById("skMsg");
    const k = fld.value.trim();
    const say = (t, bad) => { msg.textContent = t; msg.className = "fieldmsg " + (bad ? "bad" : "ok"); };
    if (!k || /^•+$/.test(k)) return say("Paste a key into the box first.", true);
    if (!/^sk_(test|live)_/.test(k))
      return say(`That doesn't start with sk_test_ or sk_live_. If you pasted on top of the dots,
        clear the box first — the dots are only a placeholder.`, true);
    /* A live key moves real money. Nobody should arrive there by accident. */
    if (k.startsWith("sk_live_")) {
      return confirmLive(() => reallySaveKey(k, say));
    }
    reallySaveKey(k, say);
  };
  async function reallySaveKey(k, say) {
    try {
      say("Saving…");
      await api("/api/pay/settings?store=" + STORE_ID, { method: "PUT",
        body: { store: STORE_ID, stripeSecret: k } });
      await loadPayCfg(); drawConfig();
      toast(`Stripe connected in <b>${PAYCFG?.mode}</b> mode.`);
    } catch (e) { say(e.message || "The server refused that key.", true); }
  }
  function confirmLive(go) {
    const el = veil(`<div class="card"><h3 style="color:var(--void)">That's a live key</h3>
      <p>Live keys charge real cards and move real money. Simulated readers don't exist in live mode,
        so you also won't be able to test anything — you'll need physical hardware and a real card.</p>
      <p>Use a <b>sk_test_</b> key while you're setting up. Get one at
        <span class="num">dashboard.stripe.com/test/apikeys</span>.</p>
      <div class="row"><button class="no" id="lvn">Go get a test key</button>
        <button class="danger" id="lvy">I'm going live</button></div></div>`);
    el.querySelector("#lvn").onclick = () => el.remove();
    el.querySelector("#lvy").onclick = () => { el.remove(); go(); };
  }
  W.simReader = async () => {
    try { const d = await api("/api/pay/simulate?store=" + STORE_ID, { method: "POST", body: { store: STORE_ID } });
      await loadPayCfg(); drawConfig(); toast(`Simulated reader paired: ${esc(d.reader.label)}`); }
    catch (e) { toast(e.message, true); }
  };
  W.regReader = () => ask({ t: "Pair a reader", p: "Type the pairing code shown on the reader's screen.",
    yes: "Pair it", done: async () => {} });
  W.pairCode = async () => {
    const code = document.getElementById("rdCode").value.trim();
    if (!code) return;
    try { const d = await api("/api/pay/register?store=" + STORE_ID, { method: "POST",
      body: { store: STORE_ID, code, label: "Register " + CFG.site.register } });
      await loadPayCfg(); drawConfig(); toast(`Paired ${esc(d.reader.label)}.`); }
    catch (e) { toast(e.message, true); }
  };
  W.findAgent = async () => { await findStation(); drawConfig(); };
  W.scanPrinters = async () => {
    const st = document.getElementById("hwScan");
    st.innerHTML = `<div class="note" style="margin-top:9px">Scanning the local network…</div>`;
    try {
      const d = await agent("/discover");
      st.innerHTML = d.printers.length
        ? `<div class="note" style="margin-top:9px;border-color:var(--vfd-dim)">Found:
            ${d.printers.map(h => `<button class="mini" style="margin:6px 6px 0 0" onclick="__w.usePrinter('${h}')">${h}</button>`).join("")}</div>`
        : `<div class="note" style="margin-top:9px">Nothing answered on port 9100 across ${esc(d.base)}.x —
            check the printer is on the same network and printing a self-test shows an IP.</div>`;
    } catch (e) { st.innerHTML = `<div class="note" style="margin-top:9px;border-color:var(--void)">${esc(e.message)}</div>`; }
  };
  W.usePrinter = async host => {
    try { await agent("/config", { printer: host, mode: "network" }); await findStation(); drawConfig();
      toast(`Printer set to ${host}.`); } catch (e) { toast(e.message, true); }
  };
  W.testPrint = async () => {
    try { await agent("/test", {}); toast("Test receipt sent."); } catch (e) { toast(e.message, true); }
  };
  W.testDrawer = async () => {
    const ok = await kickDrawer();
    toast(ok ? "Drawer kicked." : "Couldn't open the drawer — is it plugged into the printer?", !ok);
  };

  const p = PAYCFG || {};
  document.getElementById("cfgBody").innerHTML = `
    <div class="sect">Card payments</div>
    ${p.configured ? `<div class="verify ok2"><div class="vhead">Stripe connected · ${p.mode} mode</div>
      <p>${p.readerId ? `Reader paired: <b>${esc(p.readerLabel || p.readerId)}</b>`
        : `No reader paired yet — card tenders will ask you to run it elsewhere.`}</p></div>`
      : `<div class="verify"><div class="vhead">Not set up</div>
        <p>Card tenders currently just record an amount. Paste a Stripe secret key to take real payments
          through a Stripe Terminal reader. Use a <b>test</b> key first — you can run the whole flow with a
          simulated reader and never touch a card.</p></div>`}
    <div class="frm">
      <label>Stripe secret key
        <input id="skKey" type="password" placeholder="sk_test_… or sk_live_…"
          value="${p.configured ? "••••••••••••••••" : ""}"
          onfocus="if(/^•+$/.test(this.value))this.value=''"></label>
    </div>
    <div id="skMsg" class="fieldmsg"></div>
    <button class="mini" onclick="__w.saveKey()">Save key</button>
    <div class="note">The key is stored on your server and never sent to a browser. Card data never reaches
      either — the reader talks to Stripe directly and we only ever see a payment id.</div>

    ${p.configured ? `
      <div class="sect">Reader</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="rdCode" placeholder="Pairing code from the reader screen"
          style="flex:1;min-width:220px;background:rgba(0,0,0,.26);border:1px solid var(--line-2);
                 color:var(--txt);padding:10px;border-radius:4px">
        <button class="mini" style="margin:0" onclick="__w.pairCode()">Pair</button>
        ${p.mode === "test" ? `<button class="mini" style="margin:0" onclick="__w.simReader()">Use a simulated reader</button>` : ""}
      </div>
      <div class="note">On a WisePOS E or S700, the code is under Settings → Generate pairing code.</div>` : ""}

    <div class="sect">Customer display</div>
    <label class="chk"><input type="checkbox" id="dspOn" ${CFG.display?.on ? "checked" : ""}
      style="width:auto;margin-right:8px">A second screen facing the customer</label>
    <div id="dspMore" style="${CFG.display?.on ? "" : "display:none"}">
      <label class="chk" style="margin-top:8px"><input type="checkbox" id="dspRemote"
        ${CFG.display?.remote ? "checked" : ""} style="width:auto;margin-right:8px">
        It's a tablet or another device, not a second monitor on this machine</label>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="mini" style="margin:0" onclick="displayOpen()">Open it</button>
      </div>
      <div class="note">A second monitor on this machine updates the moment a key is pressed.
        Another device polls instead, so it needs the network and this address:
        <span class="num">/display.html?store=${STORE_ID}</span>
        <br><br>It shows the order, the tax, the total, and an ID-check prompt when one applies.
        It never shows cost, margin, staff names or customer records — and it holds no login, so
        it can't ring, refund or change anything.</div>
    </div>

    <div class="sect">Receipt printer and drawer</div>
    ${STATION ? `<div class="verify ${STATION.ready ? "ok2" : ""}">
        <div class="vhead">${STATION.ready ? `Station agent connected` : `Agent running, no printer set`}</div>
        <p>${STATION.ready ? `Printing to <b>${esc(STATION.printer)}</b> over ${esc(STATION.mode)}.`
          : `Scan for a printer below, or set one by hand in <code>agent/station.json</code>.`}</p></div>`
      : `<div class="verify"><div class="vhead">No station agent on this machine</div>
        <p>Receipts will go through the browser's print dialogue, and the cash drawer can't be opened.
          To fix both, run the agent on this terminal:</p>
        <pre class="cmd">cd agent
node agent.js</pre>
        <p>It needs no npm install. Leave it running.</p>
        <div class="vact"><button class="mini" onclick="__w.findAgent()">Check again</button></div></div>`}
    ${STATION ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="mini" style="margin:0" onclick="__w.scanPrinters()">Scan for printers</button>
      <button class="mini" style="margin:0" onclick="__w.testPrint()">Print a test receipt</button>
      <button class="mini" style="margin:0" onclick="__w.testDrawer()">Open the drawer</button>
      <button class="mini" style="margin:0" onclick="__w.findAgent()">Refresh</button>
    </div><div id="hwScan"></div>` : ""}
    <div class="note">The cash drawer plugs into the printer, not the computer — it opens when the printer
      gets a kick code. If the drawer won't open but receipts print, check the cable between the two.</div>`;

  const dsp = document.getElementById("dspOn");
  if (dsp) dsp.onchange = e => {
    CFG.display = { ...(CFG.display || {}), on: e.target.checked };
    document.getElementById("dspMore").style.display = e.target.checked ? "" : "none";
    if (typeof displayInit === "function") displayInit();
    queueSave();
  };
  const rem = document.getElementById("dspRemote");
  if (rem) rem.onchange = e => {
    CFG.display = { ...(CFG.display || {}), remote: e.target.checked };
    if (typeof displayInit === "function") displayInit();
    queueSave();
  };
}
async function loadPayCfg() {
  try { PAYCFG = (await api("/api/pay/settings?store=" + STORE_ID)).settings; }
  catch (e) { PAYCFG = null; }
  return PAYCFG;
}
