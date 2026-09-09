/* ===========================================================================
   Vendors and purchase orders.

   Three views: who you buy from, what's on order, and one order open for
   editing or receiving. Receiving is the screen that gets used daily, so it
   pre-fills what's still outstanding and lets it be corrected — most of the
   time a delivery matches, and the ones that don't are the point.
   =========================================================================== */

let PUR = { tab: "orders", vendors: [], orders: [], outstanding: [], onOrder: {},
            open: null, draft: null, receiving: null };

async function tPurchasing() {
  $("cfgBody").innerHTML = `<p class="lede">Loading…</p>`;
  try {
    const [v, o] = await Promise.all([
      api("/api/vendors?store=" + STORE_ID),
      api("/api/po?store=" + STORE_ID)
    ]);
    PUR.vendors = v.vendors;
    PUR.orders = o.orders;
    PUR.outstanding = o.outstanding;
    PUR.onOrder = o.onOrder;
  } catch (e) {
    $("cfgBody").innerHTML = `<div class="finding"><b>Couldn't load purchasing</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }
  drawPurchasing();
}

const vendorName = id => (PUR.vendors.find(v => v.id === id) || {}).name || "No vendor";

function drawPurchasing() {
  W.purTab = t => { PUR.tab = t; PUR.open = null; drawPurchasing(); };
  const tabs = [["orders", "Orders"], ["vendors", "Vendors"]];

  $("cfgBody").innerHTML = `
    <p class="lede">An order is a promise about stock that hasn't arrived. It doesn't touch your
      counts until something turns up — and then it goes through the same ledger as any other
      delivery.</p>
    <div class="stktabs">${tabs.map(([k, l]) =>
      `<button class="${PUR.tab === k ? "on" : ""}" onclick="__w.purTab('${k}')">${l}</button>`).join("")}</div>
    <div id="purBody"></div>`;

  if (PUR.open) return purOrder();
  (PUR.tab === "vendors" ? purVendors : purOrders)();
}

/* -------------------------------- vendors -------------------------------- */
function purVendors() {
  W.venEdit = id => {
    const v = id ? PUR.vendors.find(x => x.id === id) : {};
    const el = veil(`<div class="card tall"><h3>${id ? "Edit" : "Add"} a vendor</h3>
      <p>Only the name is required. The rest is so whoever needs to chase a delivery doesn't have
        to go looking for a phone number.</p>
      <div class="edwrap"><div class="frm">
        <label>Name<input id="vn" value="${esc(v.name || "")}"></label>
        <label>Rep<input id="vr" value="${esc(v.rep || "")}"></label>
        <label>Phone<input id="vp" value="${esc(v.phone || "")}"></label>
        <label>Email<input id="ve" value="${esc(v.email || "")}"></label>
        <label>Account number<input id="va" value="${esc(v.account || "")}"></label>
        <label>Terms<input id="vt" value="${esc(v.terms || "")}" placeholder="Net 14"></label>
        <label>Delivery days<input id="vd" value="${esc(v.delivers || "")}" placeholder="Tue, Fri"></label>
      </div>
      <label style="font-size:12.5px;color:var(--txt-2);display:block;margin-top:12px">Notes
        <textarea id="vnote" style="margin-top:6px">${esc(v.note || "")}</textarea></label></div>
      <div class="row"><button class="no" id="vx">Cancel</button>
        <button class="ok" id="vy">Save</button></div></div>`);
    el.querySelector("#vx").onclick = () => el.remove();
    el.querySelector("#vy").onclick = async () => {
      const body = { id, name: el.querySelector("#vn").value, rep: el.querySelector("#vr").value,
        phone: el.querySelector("#vp").value, email: el.querySelector("#ve").value,
        account: el.querySelector("#va").value, terms: el.querySelector("#vt").value,
        delivers: el.querySelector("#vd").value, note: el.querySelector("#vnote").value };
      try {
        await api("/api/vendors?store=" + STORE_ID, { method: "POST",
          body: { store: STORE_ID, vendor: body } });
        el.remove();
        toast("Saved.");
        tPurchasing();
      } catch (e) { toast(e.message, true); }
    };
    setTimeout(() => el.querySelector("#vn").focus(), 40);
  };

  W.venArchive = async (id, on) => {
    await api(`/api/vendors/${id}/archive?store=${STORE_ID}`, { method: "POST",
      body: { store: STORE_ID, on } });
    tPurchasing();
  };

  W.venStats = async id => {
    const el = veil(`<div class="card"><h3>${esc(vendorName(id))}</h3>
      <div id="vsBody"><p class="note">Working it out…</p></div>
      <div class="row"><button class="no" id="vsx">Close</button></div></div>`);
    el.querySelector("#vsx").onclick = () => el.remove();
    try {
      const s = await api(`/api/vendors/${id}/summary?store=${STORE_ID}&days=180`);
      el.querySelector("#vsBody").innerHTML = `
        <p>Last ${s.days} days.</p>
        <div class="rtiles" style="margin-top:12px">
          <div><span>Orders</span><b>${s.orders}</b></div>
          <div><span>Spent</span><b>${money(s.spend)}</b></div>
          <div><span>Fill rate</span><b>${s.fillRate == null ? "—" : s.fillRate + "%"}</b>
            <em>${s.unitsReceived} of ${s.unitsOrdered} units</em></div>
          <div><span>Short deliveries</span><b style="${s.shortOrders ? "color:var(--warn)" : ""}">
            ${s.shortOrders}</b></div>
        </div>
        <div class="note">Fill rate is how much of what you ordered actually turned up. Below about
          95% consistently is worth raising with the rep.</div>`;
    } catch (e) {
      el.querySelector("#vsBody").innerHTML = `<p class="note">${esc(e.message)}</p>`;
    }
  };

  $("purBody").innerHTML = `
    <button class="mini" onclick="__w.venEdit(0)">Add a vendor</button>
    ${PUR.vendors.length ? `<table class="tbl" style="margin-top:10px"><thead><tr>
      <th style="width:24%">Vendor</th><th>Rep</th><th>Phone</th><th>Terms</th><th>Delivers</th>
      <th></th></tr></thead><tbody>
      ${PUR.vendors.map(v => `<tr>
        <td style="padding-left:9px"><b>${esc(v.name)}</b>
          ${v.account ? `<em style="display:block;font-size:11px;color:var(--txt-3)">acct ${
            esc(v.account)}</em>` : ""}</td>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(v.rep || "—")}</td>
        <td style="padding-left:9px;color:var(--txt-2)" class="num">${esc(v.phone || "—")}</td>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(v.terms || "—")}</td>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(v.delivers || "—")}</td>
        <td style="text-align:right;white-space:nowrap;padding-right:9px">
          <button class="mini" style="margin:0" onclick="__w.venStats(${v.id})">How they do</button>
          <button class="mini" style="margin:0" onclick="__w.venEdit(${v.id})">Edit</button>
          <button class="del" onclick="__w.venArchive(${v.id},true)" title="Archive">×</button></td>
      </tr>`).join("")}
    </tbody></table>` : `<div class="note">No vendors yet. Adding one lets an order be addressed to
      somebody, and gives you a fill rate to hold them to.</div>`}`;
}

/* -------------------------------- orders --------------------------------- */
function purOrders() {
  W.poOpen = async id => {
    try { PUR.open = await api(`/api/po/${id}?store=${STORE_ID}`); drawPurchasing(); }
    catch (e) { toast(e.message, true); }
  };

  W.poNew = async () => {
    try {
      const r = await api("/api/po?store=" + STORE_ID, { method: "POST",
        body: { store: STORE_ID, who: ME.n, lines: [] } });
      W.poOpen(r.id);
    } catch (e) { toast(e.message, true); }
  };

  W.poFromReorder = async () => {
    try {
      const ro = await api("/api/stock/reorder?store=" + STORE_ID, { method: "POST",
        body: { store: STORE_ID, plus: CFG.plus.map(p =>
          ({ id: p.id, n: p.n, upc: p.upc, deptId: p.deptId, cost: p.cost })) } });
      const items = ro.items.filter(i => i.need > 0);
      if (!items.length) return toast("Nothing is below par that isn't already on order.", true);
      const r = await api("/api/po/from-reorder?store=" + STORE_ID, { method: "POST",
        body: { store: STORE_ID, who: ME.n, items, vendorOf: {} } });
      toast(`Made <b>${r.created.length}</b> draft order${r.created.length === 1 ? "" : "s"} from
        ${items.length} item${items.length === 1 ? "" : "s"}.`);
      tPurchasing();
    } catch (e) { toast(e.message, true); }
  };

  const STATES = { draft: ["draft", "var(--txt-3)"], sent: ["sent", "var(--warn)"],
    part: ["part delivered", "var(--warn)"], received: ["received", "var(--vfd)"],
    cancelled: ["cancelled", "var(--txt-3)"] };

  $("purBody").innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      <button class="mini" style="margin:0" onclick="__w.poNew()">New order</button>
      <button class="mini" style="margin:0" onclick="__w.poFromReorder()">Build from the reorder list</button>
    </div>

    ${PUR.outstanding.length ? `
      <div class="sect">Waiting on delivery — ${PUR.outstanding.length}</div>
      <table class="tbl"><thead><tr><th style="width:24%">Vendor</th><th>Reference</th>
        <th>Ordered</th><th>Arrived</th><th>Still short</th><th>Due</th><th></th></tr></thead><tbody>
        ${PUR.outstanding.map(p => `<tr>
          <td style="padding-left:9px"><b>${esc(p.vendor_name || "No vendor")}</b></td>
          <td style="padding-left:9px;color:var(--txt-2)">${esc(p.ref || "#" + p.id)}</td>
          <td style="padding-left:9px" class="num">${p.unitsOrdered}</td>
          <td style="padding-left:9px" class="num">${p.unitsReceived}</td>
          <td style="padding-left:9px" class="num" style="color:var(--warn)">${p.shortLines} line${
            p.shortLines === 1 ? "" : "s"}</td>
          <td style="padding-left:9px;color:${p.overdue ? "var(--void)" : "var(--txt-2)"}">
            ${p.due_at ? esc(p.due_at) + (p.overdue ? " · overdue" : "") : "—"}</td>
          <td style="text-align:right;padding-right:9px">
            <button class="mini" style="margin:0" onclick="__w.poOpen(${p.id})">Open</button></td>
        </tr>`).join("")}
      </tbody></table>` : ""}

    <div class="sect">All orders</div>
    ${PUR.orders.length ? `<table class="tbl"><thead><tr><th>Created</th><th style="width:22%">Vendor</th>
      <th>Reference</th><th>Lines</th><th>Value</th><th>State</th><th></th></tr></thead><tbody>
      ${PUR.orders.map(p => {
        const st = STATES[p.state] || [p.state, "var(--txt-2)"];
        return `<tr>
          <td style="padding-left:9px;color:var(--txt-2)">${esc(String(p.created_at).slice(0, 10))}</td>
          <td style="padding-left:9px">${esc(p.vendor_name || "No vendor")}</td>
          <td style="padding-left:9px;color:var(--txt-2)">${esc(p.ref || "#" + p.id)}</td>
          <td style="padding-left:9px" class="num">${p.lines}</td>
          <td style="padding-left:9px" class="num">${p.value ? money(p.value) : "—"}</td>
          <td style="padding-left:9px"><span style="color:${st[1]}">${st[0]}</span></td>
          <td style="text-align:right;padding-right:9px">
            <button class="mini" style="margin:0" onclick="__w.poOpen(${p.id})">Open</button></td>
        </tr>`;
      }).join("")}
    </tbody></table>` : `<div class="note">No orders yet.</div>`}`;
}

/* ------------------------------- one order ------------------------------- */
function purOrder() {
  const o = PUR.open;
  const editable = o.state === "draft";

  W.poBack = () => { PUR.open = null; drawPurchasing(); };
  W.poField = (k, v) => { o[k] = v; };
  W.poAddLine = id => {
    if (!id || o.lines.find(l => l.plu_id === id)) return;
    const p = byId(CFG.plus, id);
    o.lines.push({ plu_id: id, name: p.n, ordered: 1, received: 0,
      case_qty: null, cost: p.cost ?? null, outstanding: 1 });
    drawPurchasing();
  };
  W.poSetLine = (i, k, v) => { o.lines[i][k] = v; };
  W.poDelLine = i => {
    if (o.lines[i].received > 0) return toast("Some of that has already arrived.", true);
    o.lines.splice(i, 1);
    drawPurchasing();
  };

  W.poSave = async () => {
    try {
      await api(`/api/po/${o.id}?store=${STORE_ID}`, { method: "PUT", body: {
        store: STORE_ID, lines: o.lines.map(l => ({ pluId: l.plu_id, name: l.name,
          ordered: parseFloat(l.ordered) || 0,
          caseQty: l.case_qty === "" ? null : parseFloat(l.case_qty) || null,
          cost: l.cost === "" ? null : parseFloat(l.cost) })) } });
      toast("Saved.");
      W.poOpen(o.id);
    } catch (e) { toast(e.message, true); }
  };

  W.poSend = async () => {
    try {
      await W.poSave();
      await api(`/api/po/${o.id}/send?store=${STORE_ID}`, { method: "POST",
        body: { store: STORE_ID, who: ME.n } });
      toast("Marked as sent.");
      W.poOpen(o.id);
    } catch (e) { toast(e.message, true); }
  };

  W.poCancel = async () => {
    try {
      await api(`/api/po/${o.id}/cancel?store=${STORE_ID}`, { method: "POST",
        body: { store: STORE_ID } });
      toast("Cancelled.");
      PUR.open = null;
      tPurchasing();
    } catch (e) { toast(e.message, true); }
  };

  /* Receiving pre-fills what's outstanding, because most deliveries match. */
  W.poReceive = () => {
    const rows = o.lines.filter(l => l.outstanding > 0)
      .map(l => ({ pluId: l.plu_id, name: l.name, qty: l.outstanding,
        cost: l.paid ?? l.cost ?? "" }));
    if (!rows.length) return toast("Nothing outstanding on this order.", true);

    const el = veil(`<div class="card wide tall"><h3>Receive a delivery</h3>
      <p>Filled in with what's still outstanding. Change anything that came short, and leave a line
        at zero if it didn't turn up at all.</p>
      <div class="frm"><label>Invoice number<input id="rin" placeholder="INV-9001"></label></div>
      <div class="edwrap"><table class="tbl"><thead><tr><th style="width:40%">Product</th>
        <th>Outstanding</th><th>Arriving</th><th>Unit cost</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr>
          <td style="padding-left:9px">${esc(r.name || r.pluId)}</td>
          <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${r.qty}</td>
          <td><input class="n rq" data-i="${i}" value="${r.qty}"></td>
          <td><input class="n rc" data-i="${i}" value="${r.cost}" placeholder="—"></td>
        </tr>`).join("")}
      </tbody></table></div>
      <div class="row"><button class="no" id="rx">Cancel</button>
        <button class="ok" id="ry">Receive it</button></div></div>`);

    el.querySelector("#rx").onclick = () => el.remove();
    el.querySelector("#ry").onclick = async () => {
      const lines = rows.map((r, i) => ({
        pluId: r.pluId,
        qty: parseFloat(el.querySelector(`.rq[data-i="${i}"]`).value) || 0,
        cost: el.querySelector(`.rc[data-i="${i}"]`).value
      })).filter(l => l.qty > 0);
      if (!lines.length) return toast("Nothing to receive.", true);
      try {
        const r = await api(`/api/po/${o.id}/receive?store=${STORE_ID}`, { method: "POST",
          body: { store: STORE_ID, who: ME.n,
            invoice: el.querySelector("#rin").value, lines } });
        /* An invoice price is the truth about what you paid. */
        lines.forEach(l => {
          const c = parseFloat(l.cost);
          if (c > 0) { const p = byId(CFG.plus, l.pluId); if (p) p.cost = c; }
        });
        queueSave();
        el.remove();
        toast(r.state === "received" ? "Order complete."
          : `Part received — ${r.unitsReceived} of ${r.unitsOrdered} units.`);
        W.poOpen(o.id);
      } catch (e) { toast(e.message, true); }
    };
  };

  const short = o.lines.filter(l => l.received > 0 && l.outstanding > 0);

  $("purBody").innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap">
      <button class="mini" style="margin:0" onclick="__w.poBack()">← All orders</button>
      <b style="font-size:16px">${esc(o.ref || "Order #" + o.id)}</b>
      <span style="color:var(--txt-2);font-size:13px">${esc(o.vendor?.name || "No vendor")}</span>
      <span style="margin-left:auto;font-size:13px;color:var(--txt-2)">${esc(o.state)}</span>
    </div>

    ${short.length ? `<div class="finding" style="margin-top:12px">
      <b>${short.length} line${short.length === 1 ? " came" : "s came"} short</b>
      <span>${esc(short.map(l => `${l.name}: ${l.received} of ${l.ordered}`).join(", "))}.
        That's what to raise with the rep.</span></div>` : ""}

    <table class="tbl" style="margin-top:12px"><thead><tr><th style="width:30%">Product</th>
      <th>Ordered</th><th>Per case</th><th>Expected cost</th><th>Arrived</th><th>Paid</th>
      ${editable ? "<th></th>" : ""}</tr></thead><tbody>
      ${o.lines.map((l, i) => `<tr>
        <td style="padding-left:9px">${esc(l.name || l.plu_id)}</td>
        <td>${editable ? `<input class="n" value="${l.ordered}"
          oninput="__w.poSetLine(${i},'ordered',this.value)">`
          : `<span class="num" style="padding-left:9px">${l.ordered}</span>`}</td>
        <td>${editable ? `<input class="n" value="${l.case_qty ?? ""}" placeholder="—"
          oninput="__w.poSetLine(${i},'case_qty',this.value)">`
          : `<span class="num" style="padding-left:9px">${l.case_qty ?? "—"}</span>`}</td>
        <td>${editable ? `<input class="n" value="${l.cost ?? ""}" placeholder="—"
          oninput="__w.poSetLine(${i},'cost',this.value)">`
          : `<span class="num" style="padding-left:9px">${l.cost == null ? "—" : money(l.cost)}</span>`}</td>
        <td style="padding-left:9px" class="num" style="${l.outstanding > 0 && l.received > 0
          ? "color:var(--warn)" : ""}">${l.received}</td>
        <td style="padding-left:9px" class="num" style="color:${
          l.paid != null && l.cost != null && l.paid > l.cost ? "var(--warn)" : "var(--txt-2)"}">
          ${l.paid == null ? "—" : money(l.paid)}</td>
        ${editable ? `<td><button class="del" onclick="__w.poDelLine(${i})">×</button></td>` : ""}
      </tr>`).join("") || `<tr><td colspan="7" style="padding:14px;color:var(--txt-3)">
        Nothing on this order yet.</td></tr>`}
    </tbody></table>

    ${editable ? `
      <div class="frm" style="margin-top:10px">
        <label style="flex:2">Add a product<select onchange="__w.poAddLine(this.value);this.value=''">
          <option value="">Choose…</option>
          ${CFG.plus.map(p => `<option value="${p.id}">${esc(p.n)}</option>`).join("")}
        </select></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button class="mini" style="margin:0" onclick="__w.poSave()">Save</button>
        <button class="mini" style="margin:0" onclick="__w.poSend()">Mark as sent</button>
        <button class="mini" style="margin:0" onclick="__w.poCancel()">Cancel the order</button>
      </div>
      <div class="note">An order does nothing to your stock until it's marked as sent and something
        is received against it.</div>`
    : o.state === "sent" || o.state === "part" ? `
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="mini" style="margin:0" onclick="__w.poReceive()">Receive a delivery</button>
      </div>` : ""}

    <div class="cbar" style="margin-top:14px">
      <b>${o.unitsReceived}</b> of <b>${o.unitsOrdered}</b> units ·
      expected ${money(o.expectedCost)}${o.chargedCost
        ? ` · charged ${money(o.chargedCost)}` : ""}</div>

    ${o.receipts.length ? `<div class="sect">Deliveries</div>
      <table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Invoice</th></tr></thead><tbody>
        ${o.receipts.map(r => `<tr>
          <td style="padding-left:9px;color:var(--txt-2)">${esc(String(r.at).slice(0, 16))}</td>
          <td style="padding-left:9px">${esc(r.who || "—")}</td>
          <td style="padding-left:9px;color:var(--txt-2)">${esc(r.invoice || "—")}</td>
        </tr>`).join("")}
      </tbody></table>` : ""}`;
}
