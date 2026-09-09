/* ===========================================================================
   The inventory screens.

   Four things a shop actually does: look at what's on hand, receive a delivery,
   count a shelf, and see what to order. Everything else is a view over the
   ledger underneath.
   =========================================================================== */

let STK = null, STK_TAB = "onhand", STK_Q = "", STK_DEPT = "";
let RECV = { ref: "", lines: [] };
let COUNT = { id: null, scope: "all", lines: {}, saved: 0 };

async function stkLoad() {
  const d = await api("/api/stock?store=" + STORE_ID);
  STK = { onHand: d.onHand || {}, set: d.settings || {} };
}

const stkQty = id => (STK && STK.onHand[id]) || 0;
const stkSet = id => (STK && STK.set[id]) || { tracked: 1, par: null, target: null, case_qty: null };
const stkTracked = id => !!stkSet(id).tracked;

/* Sold-by-weight and open rings can't be counted, so they're never offered. */
const stkItems = () => CFG.plus.filter(p => !p.weighed);

async function tStock() {
  $("cfgBody").innerHTML = `<p class="lede">Reading stock…</p>`;
  try { await stkLoad(); }
  catch (e) {
    $("cfgBody").innerHTML = `<div class="finding"><b>Couldn't load stock</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }
  drawStock();
}

function drawStock() {
  W.stkTab = t => { STK_TAB = t; drawStock(); };
  W.stkQ = v => {
    STK_Q = v;
    /* Filter in place rather than redraw — retyping into a box that rebuilds
       itself loses the cursor, which we already fixed once in Config. */
    const q = v.trim().toLowerCase();
    document.querySelectorAll("#stkRows tr").forEach(tr => {
      const hit = !q || (tr.dataset.k || "").includes(q);
      tr.style.display = hit ? "" : "none";
    });
  };
  W.stkDept = v => { STK_DEPT = v; drawStock(); };

  const tabs = [["onhand", "On hand"], ["receive", "Receive"], ["count", "Count"],
                ["order", "To order"], ["shrink", "Shrink"]];

  $("cfgBody").innerHTML = `
    <p class="lede">Every movement is recorded — sold, received, counted, wasted — and the quantity
      on hand is the sum of them. That's why any number here can be explained.</p>
    <div class="stktabs">${tabs.map(([k, l]) =>
      `<button class="${STK_TAB === k ? "on" : ""}" onclick="__w.stkTab('${k}')">${l}</button>`).join("")}</div>
    <div id="stkBody"></div>`;

  ({ onhand: stkOnHand, receive: stkReceive, count: stkCount,
     order: stkOrder, shrink: stkShrink })[STK_TAB]();
}

/* ------------------------------- on hand -------------------------------- */
function stkOnHand() {
  const depts = CFG.depts.filter(d => !d.fuel);
  const items = stkItems().filter(p => !STK_DEPT || p.deptId === STK_DEPT);

  W.stkSave = async () => {
    const rows = [...document.querySelectorAll("#stkRows tr")].map(tr => ({
      pluId: tr.dataset.p,
      par: tr.querySelector(".spar").value,
      target: tr.querySelector(".starg").value,
      case_qty: tr.querySelector(".scase").value,
      tracked: tr.querySelector(".strack").checked
    }));
    try {
      await api("/api/stock/settings?store=" + STORE_ID, { method: "PUT",
        body: { store: STORE_ID, items: rows } });
      toast(`Saved <b>${rows.length}</b> item${rows.length === 1 ? "" : "s"}.`);
      await stkLoad();
    } catch (e) { toast(e.message, true); }
  };

  W.stkHist = async id => {
    const p = byId(CFG.plus, id);
    const el = veil(`<div class="card tall"><h3>${esc(p.n)}</h3>
      <p>On hand <b>${stkQty(id)}</b>. Every movement, newest first.</p>
      <div class="edwrap" id="histBody"><p class="note">Loading…</p></div>
      <div class="row"><button class="no" id="hx">Close</button></div></div>`);
    el.querySelector("#hx").onclick = () => el.remove();
    try {
      const d = await api(`/api/stock/history?store=${STORE_ID}&plu=${encodeURIComponent(id)}`);
      let run = stkQty(id);
      el.querySelector("#histBody").innerHTML = d.moves.length
        ? `<table class="tbl"><thead><tr><th>When</th><th>What</th><th>Change</th>
             <th>After</th><th>Who</th><th>Ref</th></tr></thead><tbody>
           ${d.moves.map(m => {
             const after = run; run = +(run - m.qty).toFixed(3);
             return `<tr>
               <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${esc(String(m.at).slice(0, 16))}</td>
               <td style="padding-left:9px">${esc(m.kind)}</td>
               <td style="padding-left:9px" class="num" style="color:${m.qty < 0 ? "var(--void)" : "var(--vfd)"}">
                 ${m.qty > 0 ? "+" : ""}${m.qty}</td>
               <td style="padding-left:9px" class="num">${after}</td>
               <td style="padding-left:9px;color:var(--txt-2)">${esc(m.who || "—")}</td>
               <td style="padding-left:9px;color:var(--txt-3);font-size:12px">${esc(m.ref || "")}</td>
             </tr>`;
           }).join("")}</tbody></table>`
        : `<p class="note">Nothing recorded for this product yet.</p>`;
    } catch (e) {
      el.querySelector("#histBody").innerHTML = `<p class="note">${esc(e.message)}</p>`;
    }
  };

  const neg = items.filter(p => stkTracked(p.id) && stkQty(p.id) < 0);
  const noPar = items.filter(p => stkTracked(p.id) && stkSet(p.id).par == null).length;

  $("stkBody").innerHTML = `
    ${neg.length ? `<div class="finding"><b>${neg.length} item${neg.length === 1 ? " is" : "s are"}
      below zero</b><span>That means they sold before they were received. Receive the delivery, or
      correct them with a count — ${esc(neg.slice(0, 3).map(p => p.n).join(", "))}${
      neg.length > 3 ? ` and ${neg.length - 3} more` : ""}.</span></div>` : ""}

    <div class="frm" style="margin-top:14px">
      <label style="flex:2">Find<input placeholder="Name or barcode" value="${esc(STK_Q)}"
        oninput="__w.stkQ(this.value)"></label>
      <label>Section<select onchange="__w.stkDept(this.value)">
        <option value="">All sections</option>
        ${depts.map(d => `<option value="${d.id}" ${STK_DEPT === d.id ? "selected" : ""}>${esc(d.n)}</option>`).join("")}
      </select></label>
    </div>

    <table class="tbl"><thead><tr>
      <th style="width:32%">Product</th><th>On hand</th><th>Par</th><th>Up to</th>
      <th>Per case</th><th>Track</th><th></th></tr></thead><tbody id="stkRows">
      ${items.map(p => {
        const s = stkSet(p.id), q = stkQty(p.id);
        return `<tr data-p="${p.id}" data-k="${esc((p.n + " " + (p.upc || "")).toLowerCase())}">
          <td style="padding-left:9px">${esc(p.n)}
            ${p.upc ? `<em style="display:block;font-size:11px;color:var(--txt-3)">${esc(p.upc)}</em>` : ""}</td>
          <td style="padding-left:9px" class="num"><b style="${q < 0 ? "color:var(--void)"
            : q === 0 ? "color:var(--txt-3)" : ""}">${q}</b></td>
          <td><input class="n spar" value="${s.par ?? ""}" placeholder="—"></td>
          <td><input class="n starg" value="${s.target ?? ""}" placeholder="—"></td>
          <td><input class="n scase" value="${s.case_qty ?? ""}" placeholder="—"></td>
          <td><input type="checkbox" class="strack" ${s.tracked ? "checked" : ""} style="width:auto"></td>
          <td><button class="del" onclick="__w.stkHist('${p.id}')" title="History">⋯</button></td>
        </tr>`;
      }).join("")}
    </tbody></table>
    <button class="mini" onclick="__w.stkSave()">Save par levels</button>
    <div class="note">Par is the level that triggers a reorder; <b>up to</b> is how much to bring it
      back to. Per case rounds an order to whole cases. Untick <b>track</b> for anything you don't
      want counted — services, or a department key.${noPar ? ` ${noPar} tracked item${
      noPar === 1 ? " has" : "s have"} no par set, so ${noPar === 1 ? "it" : "they"} will never
      appear in the order list.` : ""}</div>`;
}

/* ------------------------------- receiving ------------------------------- */
function stkReceive() {
  W.rcvRef = v => { RECV.ref = v; };
  W.rcvAdd = id => {
    if (!id) return;
    if (!RECV.lines.find(l => l.pluId === id)) {
      const p = byId(CFG.plus, id);
      RECV.lines.push({ pluId: id, qty: 1, caseQty: stkSet(id).case_qty || "", cost: p.cost || "" });
    }
    drawStock();
  };
  W.rcvSet = (i, k, v) => { RECV.lines[i][k] = v; };
  W.rcvDel = i => { RECV.lines.splice(i, 1); drawStock(); };
  W.rcvClear = () => { RECV = { ref: "", lines: [] }; drawStock(); };

  W.rcvSave = async () => {
    const lines = RECV.lines
      .map(l => ({ ...l, qty: parseFloat(l.qty) || 0, caseQty: parseFloat(l.caseQty) || 1,
        cost: l.cost === "" ? null : parseFloat(l.cost) }))
      .filter(l => l.qty > 0);
    if (!lines.length) return toast("Nothing to receive.", true);
    try {
      const r = await api("/api/stock/receive?store=" + STORE_ID, { method: "POST",
        body: { store: STORE_ID, who: ME.n, ref: RECV.ref, lines } });
      /* Cost on the invoice is the truth, so the pricebook follows it. */
      lines.forEach(l => {
        if (l.cost > 0) { const p = byId(CFG.plus, l.pluId); if (p) p.cost = l.cost; }
      });
      queueSave();
      toast(`Received <b>${r.units}</b> unit${r.units === 1 ? "" : "s"} across ${r.received} line${
        r.received === 1 ? "" : "s"}.`);
      RECV = { ref: "", lines: [] };
      await stkLoad();
      drawStock();
    } catch (e) { toast(e.message, true); }
  };

  const units = RECV.lines.reduce((a, l) =>
    a + (parseFloat(l.qty) || 0) * (parseFloat(l.caseQty) || 1), 0);
  const value = RECV.lines.reduce((a, l) =>
    a + (parseFloat(l.qty) || 0) * (parseFloat(l.caseQty) || 1) * (parseFloat(l.cost) || 0), 0);

  $("stkBody").innerHTML = `
    <p class="lede" style="margin-top:14px">Put a delivery in. Quantity is how many you received —
      if it came in cases, put the units per case beside it and it multiplies out.</p>

    <div class="frm">
      <label style="flex:1">Invoice or delivery note<input value="${esc(RECV.ref)}"
        placeholder="INV-4482" oninput="__w.rcvRef(this.value)"></label>
      <label style="flex:2">Add a product<select onchange="__w.rcvAdd(this.value);this.value=''">
        <option value="">Choose…</option>
        ${stkItems().map(p => `<option value="${p.id}">${esc(p.n)}${
          p.upc ? " · " + esc(p.upc) : ""}</option>`).join("")}
      </select></label>
    </div>

    ${RECV.lines.length ? `
      <table class="tbl"><thead><tr><th style="width:38%">Product</th><th>Quantity</th>
        <th>Units per case</th><th>Unit cost</th><th>Units in</th><th></th></tr></thead><tbody>
        ${RECV.lines.map((l, i) => {
          const p = byId(CFG.plus, l.pluId);
          const inUnits = (parseFloat(l.qty) || 0) * (parseFloat(l.caseQty) || 1);
          return `<tr>
            <td style="padding-left:9px">${esc(p ? p.n : "(missing)")}
              <em style="display:block;font-size:11px;color:var(--txt-3)">on hand ${stkQty(l.pluId)}</em></td>
            <td><input class="n" value="${esc(String(l.qty))}"
              oninput="__w.rcvSet(${i},'qty',this.value)"></td>
            <td><input class="n" value="${esc(String(l.caseQty))}" placeholder="1"
              oninput="__w.rcvSet(${i},'caseQty',this.value)"></td>
            <td><input class="n" value="${esc(String(l.cost))}" placeholder="—"
              oninput="__w.rcvSet(${i},'cost',this.value)"></td>
            <td style="padding-left:9px" class="num">${inUnits}</td>
            <td><button class="del" onclick="__w.rcvDel(${i})">×</button></td>
          </tr>`;
        }).join("")}
      </tbody></table>
      <div class="cbar" style="margin-top:12px">
        <b>${units}</b> units${value ? ` · ${money(value)} at cost` : ""}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="mini" style="margin:0" onclick="__w.rcvSave()">Receive it</button>
        <button class="mini" style="margin:0" onclick="__w.rcvClear()">Clear</button>
      </div>
      <div class="note">A unit cost here updates the product's cost, because the invoice is the
        truth about what you paid. The old cost stays on past movements, so last month's margin
        doesn't change retrospectively.</div>`
      : `<div class="note" style="margin-top:16px">Add products above to build the delivery.</div>`}`;
}

/* -------------------------------- counting ------------------------------- */
function stkCount() {
  W.cntScope = v => { COUNT.scope = v; drawStock(); };
  W.cntStart = async () => {
    try {
      const r = await api("/api/stock/count?store=" + STORE_ID, { method: "POST",
        body: { store: STORE_ID, who: ME.n, scope: COUNT.scope } });
      COUNT.id = r.id; COUNT.lines = {}; COUNT.saved = 0;
      toast("Count started. Nothing changes until you close it.");
      drawStock();
    } catch (e) { toast(e.message, true); }
  };
  W.cntSet = (id, v) => { COUNT.lines[id] = v; };
  W.cntSave = async () => {
    const lines = Object.entries(COUNT.lines)
      .filter(([, v]) => String(v).trim() !== "")
      .map(([pluId, v]) => ({ pluId, counted: parseFloat(v) || 0,
        cost: byId(CFG.plus, pluId)?.cost ?? null }));
    if (!lines.length) return toast("Nothing counted yet.", true);
    try {
      const r = await api(`/api/stock/count/${COUNT.id}?store=${STORE_ID}`, { method: "PUT",
        body: { store: STORE_ID, lines } });
      COUNT.saved = r.lines.length;
      toast(`Saved <b>${r.lines.length}</b> line${r.lines.length === 1 ? "" : "s"}.`);
      drawStock();
    } catch (e) { toast(e.message, true); }
  };
  W.cntClose = async () => {
    const el = veil(`<div class="card"><h3>Close the count?</h3>
      <p>Anything you counted that differs from what was expected becomes an adjustment, and the
        difference is recorded as shrink. Lines you didn't count are left alone.</p>
      <div class="row"><button class="no" id="cx">Not yet</button>
        <button class="ok" id="cy">Close it</button></div></div>`);
    el.querySelector("#cx").onclick = () => el.remove();
    el.querySelector("#cy").onclick = async () => {
      el.remove();
      try {
        const r = await api(`/api/stock/count/${COUNT.id}/close?store=${STORE_ID}`,
          { method: "POST", body: { store: STORE_ID, who: ME.n } });
        toast(`Closed. <b>${r.adjusted}</b> adjusted${r.shrinkUnits
          ? `, shrink ${r.shrinkUnits} units worth ${money(r.shrinkValue)}` : ", nothing missing"}.`);
        COUNT = { id: null, scope: "all", lines: {}, saved: 0 };
        await stkLoad();
        drawStock();
      } catch (e) { toast(e.message, true); }
    };
  };

  const depts = CFG.depts.filter(d => !d.fuel);

  if (!COUNT.id) {
    $("stkBody").innerHTML = `
      <p class="lede" style="margin-top:14px">A count records what you actually see on the shelf.
        Nothing moves until you close it, so you can start one, get interrupted, and come back.</p>
      <div class="frm">
        <label>What are you counting<select onchange="__w.cntScope(this.value)">
          <option value="all">Everything</option>
          ${depts.map(d => `<option value="${d.id}" ${COUNT.scope === d.id ? "selected" : ""}>${esc(d.n)}</option>`).join("")}
        </select></label>
      </div>
      <button class="mini" onclick="__w.cntStart()">Start a count</button>
      <div class="note">Counting a section at a time is usually more accurate than counting
        everything at once, and you can do several across a week.</div>`;
    return;
  }

  const items = stkItems().filter(p => stkTracked(p.id) &&
    (COUNT.scope === "all" || p.deptId === COUNT.scope));
  const entered = Object.values(COUNT.lines).filter(v => String(v).trim() !== "").length;

  $("stkBody").innerHTML = `
    <div class="cbar" style="margin-top:14px">
      <span class="cdot" style="background:var(--warn)"></span>
      Count open · ${entered} of ${items.length} entered${COUNT.saved
        ? ` · ${COUNT.saved} saved` : ""}</div>

    <table class="tbl"><thead><tr><th style="width:44%">Product</th><th>Expected</th>
      <th>Counted</th><th>Difference</th></tr></thead><tbody>
      ${items.map(p => {
        const exp = stkQty(p.id);
        const v = COUNT.lines[p.id];
        const has = String(v ?? "").trim() !== "";
        const diff = has ? (parseFloat(v) || 0) - exp : null;
        return `<tr>
          <td style="padding-left:9px">${esc(p.n)}</td>
          <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${exp}</td>
          <td><input class="n" value="${esc(String(v ?? ""))}" placeholder="—"
            oninput="__w.cntSet('${p.id}',this.value)"></td>
          <td style="padding-left:9px" class="num" style="${diff == null ? "color:var(--txt-3)"
            : diff < 0 ? "color:var(--void)" : diff > 0 ? "color:var(--warn)" : "color:var(--txt-3)"}">
            ${diff == null ? "—" : (diff > 0 ? "+" : "") + diff}</td>
        </tr>`;
      }).join("")}
    </tbody></table>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="mini" style="margin:0" onclick="__w.cntSave()">Save what's counted</button>
      <button class="mini" style="margin:0" onclick="__w.cntClose()">Close the count</button>
    </div>
    <div class="note">Expected is what the ledger says right now. Save as you go — a saved line
      keeps the expected figure from the moment you counted it, so a sale halfway through the
      count doesn't turn into shrink.</div>`;
}

/* -------------------------------- to order -------------------------------- */
async function stkOrder() {
  $("stkBody").innerHTML = `<p class="note" style="margin-top:16px">Working it out…</p>`;
  let d;
  try {
    d = await api("/api/stock/reorder?store=" + STORE_ID, { method: "POST",
      body: { store: STORE_ID, plus: CFG.plus.map(p =>
        ({ id: p.id, n: p.n, upc: p.upc, deptId: p.deptId, cost: p.cost })) } });
  } catch (e) {
    $("stkBody").innerHTML = `<div class="finding"><b>Couldn't work that out</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }

  W.ordCopy = () => {
    const text = d.items.map(i =>
      `${i.name}\t${i.upc || ""}\t${i.cases ? i.cases + " cases" : i.need}`).join("\n");
    navigator.clipboard?.writeText(text)
      .then(() => toast("Order list copied."))
      .catch(() => toast("Couldn't copy — select the table instead.", true));
  };

  /* Items fully covered by an order already on its way aren't worth listing. */
  d.items = d.items.filter(i => i.need > 0);
  const value = d.items.reduce((a, i) => a + (i.value || 0), 0);
  const byDept = {};
  d.items.forEach(i => (byDept[i.dept] = byDept[i.dept] || []).push(i));

  $("stkBody").innerHTML = d.items.length ? `
    <div class="cbar" style="margin-top:14px"><b>${d.items.length}</b> item${
      d.items.length === 1 ? "" : "s"} at or below par${value ? ` · ${money(value)} at cost` : ""}</div>
    ${Object.entries(byDept).map(([did, list]) => {
      const dept = byId(CFG.depts, did);
      return `<div class="sect">${esc(dept ? dept.n : "Other")}</div>
      <table class="tbl"><thead><tr><th style="width:34%">Product</th><th>On hand</th>
        <th>Par</th><th>On order</th><th>Order</th><th>At cost</th></tr></thead><tbody>
        ${list.map(i => `<tr>
          <td style="padding-left:9px">${esc(i.name)}
            ${i.upc ? `<em style="display:block;font-size:11px;color:var(--txt-3)">${esc(i.upc)}</em>` : ""}</td>
          <td style="padding-left:9px" class="num" style="${i.have <= 0 ? "color:var(--void)" : ""}">${i.have}</td>
          <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${i.par}</td>
          <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${
            i.onOrder ? i.onOrder : "—"}</td>
          <td style="padding-left:9px" class="num"><b>${i.need}</b>${i.cases
            ? `<em style="font-style:normal;color:var(--txt-3);font-size:11.5px"> · ${i.cases} case${
              i.cases === 1 ? "" : "s"}</em>` : ""}</td>
          <td style="padding-left:9px" class="num">${i.value ? money(i.value) : "—"}</td>
        </tr>`).join("")}
      </tbody></table>`;
    }).join("")}
    <button class="mini" onclick="__w.ordCopy()">Copy the list</button>
    <div class="note">Anything at or below its par, brought back up to its target and rounded up to
      whole cases where a case size is set. Anything already on a sent order is subtracted first, so
      the list doesn't tell you to order the same pallet again every day until it turns up.</div>`
    : `<div class="note" style="margin-top:16px">Nothing is at or below its par level. If that seems
       wrong, check that par levels are set under <b>On hand</b> — an item with no par never
       appears here.</div>`;
}

/* --------------------------------- shrink --------------------------------- */
async function stkShrink() {
  $("stkBody").innerHTML = `<p class="note" style="margin-top:16px">Loading…</p>`;
  let d, counts;
  try {
    [d, counts] = await Promise.all([
      api("/api/stock/shrink?store=" + STORE_ID + "&days=90"),
      api("/api/stock/counts?store=" + STORE_ID)
    ]);
  } catch (e) {
    $("stkBody").innerHTML = `<div class="finding"><b>Couldn't load that</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }

  const rows = d.byPlu.map(r => {
    const p = byId(CFG.plus, r.pluId);
    const cost = p?.cost || 0;
    return { ...r, name: p ? p.n : "(deleted product)",
      value: +((r.counted + r.waste) * cost).toFixed(2) };
  }).sort((a, b) => b.value - a.value);
  const total = rows.reduce((a, r) => a + r.value, 0);

  $("stkBody").innerHTML = `
    <div class="cbar" style="margin-top:14px">
      Last ${d.days} days · <b>${d.countedUnits}</b> units unaccounted for,
      <b>${d.wasteUnits}</b> written off${total ? ` · ${money(total)} at cost` : ""}</div>

    ${rows.length ? `<table class="tbl"><thead><tr><th style="width:44%">Product</th>
      <th>Unaccounted</th><th>Written off</th><th>At cost</th></tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td style="padding-left:9px">${esc(r.name)}</td>
        <td style="padding-left:9px" class="num" style="${r.counted ? "color:var(--void)" : "color:var(--txt-3)"}">
          ${r.counted || "—"}</td>
        <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${r.waste || "—"}</td>
        <td style="padding-left:9px" class="num">${r.value ? money(r.value) : "—"}</td>
      </tr>`).join("")}</tbody></table>`
      : `<div class="note">Nothing missing in that window. Shrink only appears once you've closed a
         count — until then there's nothing to compare against.</div>`}

    <div class="sect">Counts</div>
    ${counts.counts.length ? `<table class="tbl"><thead><tr><th>Started</th><th>Who</th>
      <th>Scope</th><th>Lines</th><th>State</th></tr></thead><tbody>
      ${counts.counts.map(c => `<tr>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(String(c.started_at).slice(0, 16))}</td>
        <td style="padding-left:9px">${esc(c.who || "—")}</td>
        <td style="padding-left:9px;color:var(--txt-2)">${c.scope === "all" ? "Everything"
          : esc(byId(CFG.depts, c.scope)?.n || c.scope)}</td>
        <td style="padding-left:9px" class="num">${c.lines}</td>
        <td style="padding-left:9px">${c.closed_at
          ? `<span style="color:var(--txt-3)">closed</span>`
          : `<span style="color:var(--warn)">still open</span>`}</td>
      </tr>`).join("")}</tbody></table>`
      : `<div class="note">No counts yet.</div>`}

    <div class="note"><b>Unaccounted</b> is what a count found missing — theft, breakage nobody
      wrote down, or a receiving error. <b>Written off</b> is waste somebody recorded on purpose.
      They're different problems and worth reading separately.</div>`;
}
