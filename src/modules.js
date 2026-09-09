/* ===========================================================================
   Modules.

   A POS for a butcher and a POS for a phone shop need genuinely different
   things — batch tracking versus commission reporting — but they must not be
   different software. What varies is which modules are switched on and how
   they're configured; the code is the same everywhere, tested once.

   Three of them are deliberately generic:
     records  — a definable list. Recipes, customer contacts, a cut log, a
                maintenance sheet. One implementation, a hundred uses.
     expiry   — dated stock, with a board of what's about to be worthless.
     staff    — who sold what, out of the sales journal we already keep.

   The setup interview decides which to suggest. The owner decides which to
   keep, and can switch any of them on later.
   =========================================================================== */

const MODULES = {
  records: {
    n: "Custom lists",
    what: "Any list your trade needs — recipes, customer contacts, a cut log, supplier notes. You define the columns.",
    fits: /caf|coffee|bakery|restaurant|deli|butcher|pizz|juice|brewery|bar|salon|barber|repair|florist|craft/i,
    icon: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2"/>'
  },
  expiry: {
    n: "Expiration tracking",
    what: "Dated stock with a board of what's about to expire, so it gets marked down before it's a write-off.",
    fits: /grocer|market|butcher|fish|deli|bakery|convenience|cheese|produce|pharmac|health food|farm/i,
    icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18M12 15v3"/>'
  },
  tanks: {
    n: "Tank gauge",
    what: "Live tank levels, water alarms and deliveries read straight off the Veeder-Root console.",
    fits: /gas|fuel|truck stop|convenience|petrol|forecourt/i,
    icon: '<path d="M5 21V8l7-4 7 4v13"/><path d="M9 21v-6h6v6"/><path d="M5 12h14"/>'
  },
  staff: {
    n: "Staff performance",
    what: "Who rang what, average basket per person, and which upsells actually land.",
    fits: /phone|electronic|cloth|boutique|shoe|jewel|furniture|sporting|salon|beauty|cosmetic|auto/i,
    icon: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 11l2 2 4-4"/>'
  }
};

const modOn = id => !!(CFG.modules && CFG.modules[id] && CFG.modules[id].on);
const modCfg = id => (CFG.modules && CFG.modules[id] && CFG.modules[id].cfg) || {};
function setModule(id, on, cfg) {
  CFG.modules = CFG.modules || {};
  CFG.modules[id] = { on, cfg: cfg || modCfg(id) };
}

/* ============================== custom lists ============================== */
/* A record type is a name, a set of fields, and rows. That covers a recipe
   card, a customer list and a butchery log without three implementations. */
const FIELD_TYPES = [["text", "Text"], ["longtext", "Long text"], ["number", "Number"],
  ["money", "Money"], ["date", "Date"], ["choice", "Choice"], ["check", "Yes / no"],
  ["product", "Product"], ["staff", "Staff member"]];

function listsCfg() {
  const c = modCfg("records");
  if (!c.lists) c.lists = [];
  return c;
}
function tRecords() {
  const c = listsCfg();
  const cur = c.lists.find(l => l.id === REC_OPEN) || c.lists[0];

  W.addList = () => {
    const el = veil(`<div class="card"><h3>New list</h3>
      <p>What is this a list of? Recipes, customers, deliveries, anything you need to keep track of.</p>
      <input id="nlName" placeholder="Recipes" style="margin-top:14px">
      <div class="opts">${["Recipes","Customers","Deliveries","Cut log","Maintenance","Suppliers","Waste log"]
        .map(v => `<button data-p="${v}">${v}</button>`).join("")}</div>
      <div class="row"><button class="no" id="nln">Cancel</button>
        <button class="ok" id="nly">Create it</button></div></div>`);
    el.querySelectorAll("[data-p]").forEach(b => b.onclick = () => el.querySelector("#nlName").value = b.dataset.p);
    el.querySelector("#nln").onclick = () => el.remove();
    el.querySelector("#nly").onclick = () => {
      const n = el.querySelector("#nlName").value.trim(); if (!n) return;
      const id = "L" + uid();
      c.lists.push({ id, n, fields: [{ k: "f" + uid(), n: "Name", t: "text" }], rows: [] });
      REC_OPEN = id; setModule("records", true, c);
      el.remove(); refresh(); queueSave();
    };
  };
  W.pickList = id => { REC_OPEN = id; refresh(); };
  W.delList = id => {
    const l = c.lists.find(x => x.id === id);
    const el = veil(`<div class="card"><h3>Delete "${esc(l.n)}"</h3>
      <p>This removes the list and its ${l.rows.length} record${l.rows.length === 1 ? "" : "s"}.</p>
      <div class="row"><button class="no" id="dn">Keep it</button>
        <button class="danger" id="dy">Delete</button></div></div>`);
    el.querySelector("#dn").onclick = () => el.remove();
    el.querySelector("#dy").onclick = () => {
      c.lists = c.lists.filter(x => x.id !== id); REC_OPEN = null;
      setModule("records", true, c); el.remove(); refresh(); queueSave();
    };
  };
  W.addField = id => {
    const l = c.lists.find(x => x.id === id);
    l.fields.push({ k: "f" + uid(), n: "New column", t: "text" });
    refresh(); queueSave();
  };
  W.setField = (lid, k, prop, v) => {
    const f = c.lists.find(x => x.id === lid).fields.find(x => x.k === k);
    f[prop] = v; queueSave();
    if (prop === "t") refresh();
  };
  W.delField = (lid, k) => {
    const l = c.lists.find(x => x.id === lid);
    l.fields = l.fields.filter(f => f.k !== k);
    l.rows.forEach(r => delete r[k]);
    refresh(); queueSave();
  };
  W.addRow = id => {
    const l = c.lists.find(x => x.id === id);
    l.rows.unshift({ _id: "R" + uid(), _at: new Date().toISOString() });
    refresh(); queueSave();
  };
  W.setCell = (lid, rid, k, v) => {
    const r = c.lists.find(x => x.id === lid).rows.find(x => x._id === rid);
    r[k] = v; queueSave();
  };
  W.delRow = (lid, rid) => {
    const l = c.lists.find(x => x.id === lid);
    l.rows = l.rows.filter(r => r._id !== rid);
    refresh(); queueSave();
  };
  W.recQ = v => { REC_Q = v; const el = $("recRows"); if (el) el.innerHTML = recRows(cur); };

  $("cfgBody").innerHTML = `
    ${c.lists.length ? `<div class="listtabs">${c.lists.map(l =>
      `<button class="${cur && l.id === cur.id ? "on" : ""}" onclick="__w.pickList('${l.id}')">
        ${esc(l.n)}<em>${l.rows.length}</em></button>`).join("")}
      <button class="add" onclick="__w.addList()">+ New list</button></div>` : ""}

    ${!cur ? `<div class="drop" style="cursor:default">
      <svg viewBox="0 0 24 24">${MODULES.records.icon}</svg>
      <b>No lists yet</b>
      <span>A list is whatever your trade needs to keep track of. A café keeps recipes with yields and
        costs. A clothing shop keeps customers and their sizes. A butcher keeps what was cut, when, and
        by whom. You define the columns; the register keeps the records.</span>
      <button class="mini" onclick="__w.addList()">Create your first list</button></div>`
    : `
      <div class="sect">Columns in ${esc(cur.n)}</div>
      <table class="tbl"><thead><tr><th style="width:44%">Column</th><th style="width:30%">Type</th>
        <th style="width:20%">Options</th><th></th></tr></thead><tbody>
      ${cur.fields.map(f => `<tr>
        <td><input value="${esc(f.n)}" oninput="__w.setField('${cur.id}','${f.k}','n',this.value)"></td>
        <td><select onchange="__w.setField('${cur.id}','${f.k}','t',this.value)">${
          FIELD_TYPES.map(([k, l]) => `<option value="${k}" ${f.t === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td>${f.t === "choice"
          ? `<input value="${esc(f.opts || "")}" placeholder="One, Two, Three"
              oninput="__w.setField('${cur.id}','${f.k}','opts',this.value)">`
          : `<span style="color:var(--txt-3);font-size:12px;padding-left:8px">—</span>`}</td>
        <td>${cur.fields.length > 1 ? `<button class="del" onclick="__w.delField('${cur.id}','${f.k}')">×</button>` : ""}</td>
      </tr>`).join("")}
      </tbody></table>
      <button class="mini" onclick="__w.addField('${cur.id}')">Add a column</button>
      <button class="mini" style="border-color:var(--void);color:var(--void)"
        onclick="__w.delList('${cur.id}')">Delete this list</button>

      <div class="sect">${esc(cur.n)} — ${cur.rows.length} record${cur.rows.length === 1 ? "" : "s"}</div>
      <div class="pbtop">
        <input id="recSearch" placeholder="Search ${esc(cur.n.toLowerCase())}…" value="${esc(REC_Q)}">
        <button class="mini" style="margin:0" onclick="__w.addRow('${cur.id}')">Add a record</button>
      </div>
      <div id="recRows">${recRows(cur)}</div>`}`;

  const s = $("recSearch");
  if (s) s.oninput = e => W.recQ(e.target.value);
}
let REC_OPEN = null, REC_Q = "";

function recRows(l) {
  if (!l) return "";
  const q = REC_Q.trim().toLowerCase();
  const rows = q ? l.rows.filter(r => l.fields.some(f =>
    String(r[f.k] ?? "").toLowerCase().includes(q))) : l.rows;
  if (!rows.length) return `<p style="color:var(--txt-3);font-size:13px;padding:14px 2px">${
    q ? `Nothing matches “${esc(q)}”.` : "No records yet."}</p>`;
  return `<table class="tbl"><thead><tr>${l.fields.map(f =>
    `<th>${esc(f.n)}</th>`).join("")}<th style="width:34px"></th></tr></thead><tbody>
    ${rows.map(r => `<tr>${l.fields.map(f => `<td>${cell(l, r, f)}</td>`).join("")}
      <td><button class="del" onclick="__w.delRow('${l.id}','${r._id}')">×</button></td></tr>`).join("")}
  </tbody></table>`;
}
function cell(l, r, f) {
  const v = r[f.k] ?? "";
  const set = `__w.setCell('${l.id}','${r._id}','${f.k}',this.value)`;
  switch (f.t) {
    case "longtext": return `<textarea rows="2" oninput="${set}"
      style="min-height:38px;resize:vertical">${esc(v)}</textarea>`;
    case "number": return `<input class="n" value="${esc(v)}" oninput="${set}">`;
    case "money": return `<input class="n" value="${esc(v)}" placeholder="0.00" oninput="${set}">`;
    case "date": return `<input type="date" value="${esc(v)}" oninput="${set}">`;
    case "check": return `<input type="checkbox" ${v ? "checked" : ""} style="width:auto"
      onchange="__w.setCell('${l.id}','${r._id}','${f.k}',this.checked)">`;
    case "choice": return `<select onchange="${set}"><option value=""></option>${
      String(f.opts || "").split(",").map(o => o.trim()).filter(Boolean)
        .map(o => `<option ${v === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    case "product": return `<select onchange="${set}"><option value=""></option>${
      CFG.plus.map(p => `<option value="${p.id}" ${v === p.id ? "selected" : ""}>${esc(p.n)}</option>`).join("")}</select>`;
    case "staff": return `<select onchange="${set}"><option value=""></option>${
      CFG.employees.map(e => `<option ${v === e.n ? "selected" : ""}>${esc(e.n)}</option>`).join("")}</select>`;
    default: return `<input value="${esc(v)}" oninput="${set}">`;
  }
}

/* ============================ expiration =============================== */
/* Dated stock. The point isn't the dates, it's the board that tells you what to
   mark down this morning while it's still worth something. */
function expCfg() {
  const c = modCfg("expiry");
  if (!c.batches) c.batches = [];
  if (!c.warnDays) c.warnDays = 7;
  return c;
}
const daysUntil = d => Math.floor((new Date(d) - new Date().setHours(0, 0, 0, 0)) / 864e5);

function tExpiry() {
  const c = expCfg();
  W.addBatch = () => {
    const p = CFG.plus[0];
    c.batches.unshift({ id: "B" + uid(), pluId: p ? p.id : null, qty: 1,
      exp: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
      received: new Date().toISOString().slice(0, 10), by: ME?.n || "", note: "" });
    setModule("expiry", true, c); refresh(); queueSave();
  };
  W.setBatch = (id, f, v) => {
    const b = c.batches.find(x => x.id === id);
    b[f] = f === "qty" ? (parseFloat(v) || 0) : v;
    queueSave(); if (f === "exp") refresh();
  };
  W.delBatch = id => { c.batches = c.batches.filter(b => b.id !== id); refresh(); queueSave(); };
  W.setWarn = v => { c.warnDays = parseInt(v) || 7; setModule("expiry", true, c); refresh(); queueSave(); };

  const sorted = c.batches.slice().sort((a, b) => new Date(a.exp) - new Date(b.exp));
  const gone = sorted.filter(b => daysUntil(b.exp) < 0);
  const soon = sorted.filter(b => { const d = daysUntil(b.exp); return d >= 0 && d <= c.warnDays; });

  $("cfgBody").innerHTML = `
    <div class="cards" style="margin-top:2px">
      <div class="stat"><div class="lbl">Already expired</div>
        <div class="val ${gone.length ? "" : "g"}" style="${gone.length ? "color:var(--void)" : ""}">${gone.length}</div>
        <div class="sub2">pull these off the shelf</div></div>
      <div class="stat"><div class="lbl">Within ${c.warnDays} days</div>
        <div class="val ${soon.length ? "w" : "g"}">${soon.length}</div>
        <div class="sub2">mark down while they still sell</div></div>
      <div class="stat"><div class="lbl">Tracked</div><div class="val">${c.batches.length}</div>
        <div class="sub2">dated batches on file</div></div>
    </div>
    <div class="frm" style="margin-top:14px">
      <label>Warn me this many days ahead
        <input class="n" value="${c.warnDays}" oninput="__w.setWarn(this.value)"></label>
    </div>
    <div class="sect">Dated stock</div>
    <table class="tbl"><thead><tr>
      <th style="width:26%">Product</th><th style="width:9%">Qty</th>
      <th style="width:14%">Received</th><th style="width:14%">Expires</th>
      <th style="width:11%">Days left</th><th style="width:14%">Logged by</th>
      <th>Note</th><th></th></tr></thead><tbody>
    ${sorted.map(b => {
      const d = daysUntil(b.exp);
      const cls = d < 0 ? "expgone" : d <= c.warnDays ? "expsoon" : "";
      return `<tr class="${cls}">
        <td><select onchange="__w.setBatch('${b.id}','pluId',this.value)">${
          CFG.plus.map(p => `<option value="${p.id}" ${b.pluId === p.id ? "selected" : ""}>${esc(p.n)}</option>`).join("")}</select></td>
        <td><input class="n" value="${b.qty}" oninput="__w.setBatch('${b.id}','qty',this.value)"></td>
        <td><input type="date" value="${esc(b.received || "")}" oninput="__w.setBatch('${b.id}','received',this.value)"></td>
        <td><input type="date" value="${esc(b.exp)}" oninput="__w.setBatch('${b.id}','exp',this.value)"></td>
        <td style="padding-left:9px;font-family:'Azeret Mono',monospace;font-size:12.5px">${
          d < 0 ? `${-d} ago` : d === 0 ? "today" : `${d}`}</td>
        <td><select onchange="__w.setBatch('${b.id}','by',this.value)"><option value=""></option>${
          CFG.employees.map(e => `<option ${b.by === e.n ? "selected" : ""}>${esc(e.n)}</option>`).join("")}</select></td>
        <td><input value="${esc(b.note || "")}" oninput="__w.setBatch('${b.id}','note',this.value)"></td>
        <td><button class="del" onclick="__w.delBatch('${b.id}')">×</button></td></tr>`;
    }).join("") || `<tr><td colspan="8" style="padding:14px;color:var(--txt-3)">
      Nothing dated yet. Add a batch when stock comes in, or scan it at goods-in.</td></tr>`}
    </tbody></table>
    <button class="mini" onclick="__w.addBatch()">Add a batch</button>
    <div class="note">One product can have several batches with different dates — that's the point.
      The oldest one is what should sell first, and what should be marked down before it can't.</div>`;
}

/* ============================ staff performance ========================== */
function tStaff() {
  const S = SHIFT.sales.filter(s => !s.ret);
  const by = {};
  S.forEach(s => {
    const k = s.by || "—";
    by[k] = by[k] || { n: 0, total: 0, items: 0, disc: 0, voids: 0 };
    by[k].n++; by[k].total += s.tot;
    by[k].items += s.lines.reduce((a, c) => a + c.q, 0);
    by[k].disc += Math.abs(s.disc || 0) + Math.abs(s.promoOff || 0);
  });
  SHIFT.exceptions.forEach(x => {
    if (/void/i.test(x.what) && by[x.by]) by[x.by].voids++;
  });
  const rows = Object.entries(by).sort((a, b) => b[1].total - a[1].total);
  const max = Math.max(0.01, ...rows.map(r => r[1].total));

  $("cfgBody").innerHTML = `
    <p class="lede" style="margin:0 0 6px">This shift, by who rang it. Sales are stamped with the
      cashier when they're recorded, so this needs nothing extra from anyone.</p>
    ${rows.length ? `
      <div class="sect">Takings</div>
      ${rows.map(([n, v], i) => `<div class="hbar">
        <span class="hn">${esc(n)}</span>
        <span class="ht"><span class="hf" style="width:${Math.max(2, v.total / max * 100)}%;
          background:var(--vfd);animation-delay:${i * 60}ms"></span></span>
        <span class="hv">${money(v.total)}</span></div>`).join("")}

      <div class="sect">Detail</div>
      <table class="tbl"><thead><tr><th style="width:22%">Cashier</th><th>Sales</th>
        <th>Items</th><th>Average basket</th><th>Items per sale</th>
        <th>Discounts given</th><th>Voids</th></tr></thead><tbody>
      ${rows.map(([n, v]) => `<tr>
        <td style="padding-left:9px">${esc(n)}</td>
        <td style="padding-left:9px" class="num">${v.n}</td>
        <td style="padding-left:9px" class="num">${v.items}</td>
        <td style="padding-left:9px" class="num">${money(v.total / v.n)}</td>
        <td style="padding-left:9px" class="num">${(v.items / v.n).toFixed(1)}</td>
        <td style="padding-left:9px" class="num">${money(v.disc)}</td>
        <td style="padding-left:9px" class="num ${v.voids > 3 ? "" : ""}"
          style="${v.voids > 3 ? "color:var(--warn)" : ""}">${v.voids}</td></tr>`).join("")}
      </tbody></table>
      <div class="note">Items per sale is the upsell number — it moves when someone actually asks.
        Voids are here because a cashier voiding far more than everyone else is worth a look, not
        because voiding is wrong.</div>`
    : `<p style="color:var(--txt-3);font-size:13px;padding:16px 2px">No sales on this shift yet.</p>`}`;
}
