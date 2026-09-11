/* ===========================================================================
   Central pricebook.

   The screen an owner of twenty shops uses: change a price once, see exactly
   what it would do everywhere, then let it happen. The preview is the whole
   point — a wrong price across twenty forecourts is a legal problem, not a
   support ticket.
   =========================================================================== */

let CEN = { tab: "items", groups: [], master: [], pushes: [], scheduled: [], stores: [],
            group: null, q: "", plan: null };

async function tCentral() {
  $("cfgBody").innerHTML = `<p class="lede">Loading…</p>`;
  try {
    const d = await api("/api/central");
    Object.assign(CEN, d);
    if (CEN.group == null) CEN.group = CEN.groups[0]?.id ?? null;
  } catch (e) {
    $("cfgBody").innerHTML = `<div class="finding"><b>Couldn't load this</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }
  drawCentral();
}

function drawCentral() {
  W.cenTab = t => { CEN.tab = t; CEN.plan = null; drawCentral(); };
  const tabs = [["items", "Central items"], ["groups", "Groups"],
    ["push", "Push a change"], ["schedule", "Scheduled"], ["history", "History"]];

  $("cfgBody").innerHTML = `
    <p class="lede">One list of products, pushed to the stores you choose. A shop can hold a price
      back deliberately, and it keeps that price through every push until somebody removes it.</p>
    <div class="stktabs">${tabs.map(([k, l]) =>
      `<button class="${CEN.tab === k ? "on" : ""}" onclick="__w.cenTab('${k}')">${l}</button>`).join("")}</div>
    <div id="cenBody"></div>`;

  ({ items: cenItems, groups: cenGroups, push: cenPush,
     schedule: cenSchedule, history: cenHistory })[CEN.tab]();
}

/* ------------------------------ central items ----------------------------- */
function cenItems() {
  W.cenQ = v => {
    CEN.q = v;
    const q = v.trim().toLowerCase();
    document.querySelectorAll("#cenRows tr").forEach(tr => {
      tr.style.display = !q || (tr.dataset.k || "").includes(q) ? "" : "none";
    });
  };

  W.cenAdopt = async () => {
    const el = veil(`<div class="card"><h3>Build the list from a store</h3>
      <p>Takes every product that has a barcode from one shop's pricebook. Anything without a
        barcode is left alone — there's nothing to match it on in another store.</p>
      <div class="frm"><label>Which store<select id="adStore">
        ${CEN.stores.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}
      </select></label></div>
      <div class="row"><button class="no" id="ax">Cancel</button>
        <button class="ok" id="ay">Take them</button></div></div>`);
    el.querySelector("#ax").onclick = () => el.remove();
    el.querySelector("#ay").onclick = async () => {
      try {
        const r = await api("/api/central/adopt", { method: "POST",
          body: { store: +el.querySelector("#adStore").value } });
        el.remove();
        toast(`Took <b>${r.added}</b> item${r.added === 1 ? "" : "s"}${
          r.skipped ? `, skipped ${r.skipped} with no barcode` : ""}.`);
        tCentral();
      } catch (e) { toast(e.message, true); }
    };
  };

  W.cenEdit = upc => {
    const m = upc ? CEN.master.find(x => x.upc === upc) : {};
    const el = veil(`<div class="card"><h3>${upc ? "Edit" : "New"} central item</h3>
      <p>The barcode is what every store is matched on, so it has to be right.</p>
      <div class="frm">
        <label>Barcode<input id="mu" value="${esc(m.upc || "")}" ${upc ? "readonly" : ""}></label>
        <label>Name<input id="mn" value="${esc(m.name || "")}"></label>
      </div>
      <div class="frm">
        <label>Price<input class="n" id="mp" value="${m.price ?? ""}" placeholder="leave blank to not manage"></label>
        <label>Cost<input class="n" id="mc" value="${m.cost ?? ""}" placeholder="—"></label>
        <label>Section<input id="md" value="${esc(m.dept || "")}" placeholder="matched by name"></label>
      </div>
      <div class="note">A blank field isn't pushed at all, so you can manage the price centrally and
        leave the cost to each shop.</div>
      <div class="row"><button class="no" id="mx">Cancel</button>
        <button class="ok" id="my">Save</button></div></div>`);
    el.querySelector("#mx").onclick = () => el.remove();
    el.querySelector("#my").onclick = async () => {
      try {
        await api("/api/central/item", { method: "POST", body: { item: {
          upc: el.querySelector("#mu").value, name: el.querySelector("#mn").value,
          price: el.querySelector("#mp").value, cost: el.querySelector("#mc").value,
          dept: el.querySelector("#md").value } } });
        el.remove();
        toast("Saved.");
        tCentral();
      } catch (e) { toast(e.message, true); }
    };
    setTimeout(() => el.querySelector(upc ? "#mn" : "#mu").focus(), 40);
  };

  W.cenDel = async upc => {
    if (!confirm("Remove this from the central list? Stores keep whatever they currently have.")) return;
    await api("/api/central/item/" + encodeURIComponent(upc), { method: "DELETE" });
    tCentral();
  };

  $("cenBody").innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center">
      <button class="mini" style="margin:0" onclick="__w.cenEdit('')">Add an item</button>
      <button class="mini" style="margin:0" onclick="__w.cenAdopt()">Build from a store</button>
      <input placeholder="Find" value="${esc(CEN.q)}" oninput="__w.cenQ(this.value)"
        style="margin-left:auto;max-width:220px">
    </div>

    ${CEN.master.length ? `<table class="tbl" style="margin-top:10px"><thead><tr>
      <th style="width:30%">Item</th><th>Barcode</th><th>Price</th><th>Cost</th><th>Section</th>
      <th>Changed</th><th></th></tr></thead><tbody id="cenRows">
      ${CEN.master.map(m => `<tr data-k="${esc((m.name + " " + m.upc).toLowerCase())}">
        <td style="padding-left:9px">${esc(m.name)}</td>
        <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${esc(m.upc)}</td>
        <td style="padding-left:9px" class="num">${m.price == null
          ? `<span style="color:var(--txt-3)">not managed</span>` : money(m.price)}</td>
        <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${
          m.cost == null ? "—" : money(m.cost)}</td>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(m.dept || "—")}</td>
        <td style="padding-left:9px;color:var(--txt-3);font-size:12px">${
          esc(String(m.updated_at).slice(0, 10))}</td>
        <td style="text-align:right;padding-right:9px">
          <button class="mini" style="margin:0" onclick="__w.cenEdit('${esc(m.upc)}')">Edit</button>
          <button class="del" onclick="__w.cenDel('${esc(m.upc)}')">×</button></td>
      </tr>`).join("")}
    </tbody></table>` : `<div class="note">Nothing central yet. If one of your stores already has a
      good pricebook, <b>Build from a store</b> takes it as the starting point rather than typing
      it in again.</div>`}`;
}

/* --------------------------------- groups --------------------------------- */
function cenGroups() {
  W.grpEdit = async id => {
    const g = id ? CEN.groups.find(x => x.id === id) : {};
    let inGroup = [];
    if (id) {
      try { inGroup = (await api("/api/central/group/" + id)).stores.map(s => s.id); }
      catch (e) {}
    }
    const el = veil(`<div class="card tall"><h3>${id ? "Edit" : "New"} group</h3>
      <p>A store belongs to one group at most — two groups pushing different prices to the same
        shop is a fight nobody wins.</p>
      <div class="frm"><label>Name<input id="gn" value="${esc(g.name || "")}"
        placeholder="Illinois forecourts"></label></div>
      <div class="sect">Stores</div>
      <div class="chips" id="grpStores">${CEN.stores.map(s => `
        <label class="chip ${inGroup.includes(s.id) ? "on" : ""}">
          <input type="checkbox" value="${s.id}" ${inGroup.includes(s.id) ? "checked" : ""}
            style="display:none"
            onchange="this.closest('label').classList.toggle('on',this.checked)">
          ${esc(s.name)}</label>`).join("")}</div>
      <div class="row"><button class="no" id="gx">Cancel</button>
        <button class="ok" id="gy">Save</button></div></div>`);
    el.querySelector("#gx").onclick = () => el.remove();
    el.querySelector("#gy").onclick = async () => {
      const storeIds = [...el.querySelectorAll("#grpStores input:checked")].map(i => +i.value);
      try {
        await api("/api/central/group", { method: "POST",
          body: { group: { id, name: el.querySelector("#gn").value }, storeIds } });
        el.remove();
        toast("Saved.");
        tCentral();
      } catch (e) { toast(e.message, true); }
    };
    setTimeout(() => el.querySelector("#gn").focus(), 40);
  };

  W.grpDel = async id => {
    if (!confirm("Delete this group? The stores stay, they just aren't grouped.")) return;
    await api("/api/central/group/" + id, { method: "DELETE" });
    CEN.group = null;
    tCentral();
  };

  const grouped = CEN.groups.reduce((a, g) => a + g.stores, 0);
  const loose = CEN.stores.length - grouped;

  $("cenBody").innerHTML = `
    <button class="mini" onclick="__w.grpEdit(0)">New group</button>
    ${CEN.groups.length ? `<table class="tbl" style="margin-top:10px"><thead><tr>
      <th style="width:40%">Group</th><th>Stores</th><th></th></tr></thead><tbody>
      ${CEN.groups.map(g => `<tr>
        <td style="padding-left:9px"><b>${esc(g.name)}</b></td>
        <td style="padding-left:9px" class="num">${g.stores}</td>
        <td style="text-align:right;padding-right:9px">
          <button class="mini" style="margin:0" onclick="__w.grpEdit(${g.id})">Edit</button>
          <button class="del" onclick="__w.grpDel(${g.id})">×</button></td>
      </tr>`).join("")}
    </tbody></table>` : `<div class="note">No groups yet. Without one you can still push to every
      store at once, but a group lets you price city shops differently from forecourts.</div>`}
    ${loose > 0 ? `<div class="note">${loose} store${loose === 1 ? " isn't" : "s aren't"} in any
      group. ${loose === 1 ? "It" : "They"} will only be reached by a push to all stores.</div>` : ""}`;
}

/* ------------------------------- push a change ---------------------------- */
async function cenPush() {
  W.cenGroup = v => { CEN.group = v === "" ? null : +v; CEN.plan = null; cenPush(); };

  W.cenPlan = async () => {
    $("planOut").innerHTML = `<p class="note">Working out what would change…</p>`;
    try {
      CEN.plan = await api("/api/central/plan", { method: "POST",
        body: { groupId: CEN.group } });
      cenPush();
    } catch (e) { $("planOut").innerHTML = `<div class="finding"><b>Couldn't plan that</b>
      <span>${esc(e.message)}</span></div>`; }
  };

  W.cenApply = async () => {
    const t = CEN.plan.totals;
    const el = veil(`<div class="card"><h3>Push to ${t.stores} store${
      t.stores === 1 ? "" : "s"}?</h3>
      <p><b>${t.changes}</b> price${t.changes === 1 ? "" : "s"} will change on tills that are
        selling right now. ${t.skipped ? `${t.skipped} held locally will be left alone. ` : ""}
        This can't be undone in one action — you'd have to push the old prices back.</p>
      <div class="row"><button class="no" id="px">Not yet</button>
        <button class="ok" id="py">Push it</button></div></div>`);
    el.querySelector("#px").onclick = () => el.remove();
    el.querySelector("#py").onclick = async () => {
      el.remove();
      try {
        const r = await api("/api/central/push", { method: "POST",
          body: { groupId: CEN.group, who: ME.n } });
        toast(`Pushed <b>${r.changed}</b> change${r.changed === 1 ? "" : "s"} to ${r.stores} store${
          r.stores === 1 ? "" : "s"}.`);
        CEN.plan = null;
        tCentral();
      } catch (e) { toast(e.message, true); }
    };
  };

  const p = CEN.plan;

  $("cenBody").innerHTML = `
    <div class="frm" style="margin-top:14px">
      <label>Push to<select onchange="__w.cenGroup(this.value)">
        <option value="" ${CEN.group == null ? "selected" : ""}>Every store (${CEN.stores.length})</option>
        ${CEN.groups.map(g => `<option value="${g.id}" ${CEN.group === g.id ? "selected" : ""}>${
          esc(g.name)} (${g.stores})</option>`).join("")}
      </select></label>
    </div>
    <button class="mini" onclick="__w.cenPlan()">See what would change</button>
    <div id="planOut">${p ? renderPlan(p) : `<div class="note">Nothing is written until you've
      seen the list and said yes. With twenty shops a wrong price is a legal problem rather than a
      support ticket, so there's no one-click push.</div>`}</div>`;
}

function renderPlan(p) {
  const t = p.totals;
  if (!t.changes && !t.skipped && !t.missing)
    return `<div class="note" style="margin-top:14px">Every store already matches the central
      list. Nothing to push.</div>`;

  return `
    <div class="rtiles" style="margin-top:14px">
      <div><span>Stores affected</span><b>${p.stores.filter(s => s.changes.length).length}</b></div>
      <div><span>Changes</span><b>${t.changes}</b></div>
      <div><span>Held locally</span><b style="${t.skipped ? "color:var(--warn)" : ""}">${t.skipped}</b></div>
      <div><span>Not stocked</span><b style="color:var(--txt-3)">${t.missing}</b></div>
    </div>

    ${p.stores.map(s => {
      if (s.missing_config || s.unreadable)
        return `<div class="finding"><b>${esc(s.store.name)}</b>
          <span>${s.unreadable ? "Its pricebook can't be read." : "It has no pricebook yet."}</span></div>`;
      if (!s.changes.length && !s.skipped.length) return "";
      return `<div class="sect">${esc(s.store.name)} — ${s.changes.length} change${
        s.changes.length === 1 ? "" : "s"}</div>
      ${s.changes.length ? `<table class="tbl"><thead><tr><th style="width:34%">Item</th>
        <th>What</th><th>Now</th><th>Becomes</th></tr></thead><tbody>
        ${s.changes.map(c => `<tr>
          <td style="padding-left:9px">${esc(c.name)}</td>
          <td style="padding-left:9px;color:var(--txt-2)">${esc(c.field)}</td>
          <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${
            c.field === "price" || c.field === "cost" ? money(c.from || 0) : esc(String(c.from ?? "—"))}</td>
          <td style="padding-left:9px" class="num"><b>${
            c.field === "price" || c.field === "cost" ? money(c.to) : esc(String(c.to))}</b></td>
        </tr>`).join("")}
      </tbody></table>` : ""}
      ${s.skipped.length ? `<div class="note">Held here: ${s.skipped.map(x =>
        `${esc(x.name)} (${esc(x.field)}${x.reason === "held locally" ? "" : " — " + esc(x.reason)})`)
        .join(", ")}.</div>` : ""}`;
    }).join("")}

    ${t.changes ? `<button class="mini" onclick="__w.cenApply()">Push these ${t.changes} change${
      t.changes === 1 ? "" : "s"}</button>` : ""}`;
}

/* -------------------------------- scheduled ------------------------------- */
function cenSchedule() {
  W.schNew = () => {
    const el = veil(`<div class="card tall"><h3>Schedule a price change</h3>
      <p>It's written to the central list on the date and pushed the same hour. Nobody has to be
        there at six in the morning.</p>
      <div class="frm">
        <label>Item<select id="si">${CEN.master.map(m =>
          `<option value="${esc(m.upc)}">${esc(m.name)}</option>`).join("")}</select></label>
        <label>New price<input class="n" id="sp" placeholder="13.29"></label>
        <label>From<input type="date" id="sd"></label>
      </div>
      <div class="frm">
        <label>Push to<select id="sg">
          <option value="">Every store</option>
          ${CEN.groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("")}
        </select></label>
      </div>
      <div class="row"><button class="no" id="sx">Cancel</button>
        <button class="ok" id="sy">Schedule it</button></div></div>`);
    el.querySelector("#sx").onclick = () => el.remove();
    el.querySelector("#sy").onclick = async () => {
      try {
        await api("/api/central/schedule", { method: "POST", body: { changes: [{
          upc: el.querySelector("#si").value, field: "price",
          value: el.querySelector("#sp").value, effective: el.querySelector("#sd").value,
          groupId: el.querySelector("#sg").value || null, who: ME.n }] } });
        el.remove();
        toast("Scheduled.");
        tCentral();
      } catch (e) { toast(e.message, true); }
    };
  };

  W.schDel = async id => {
    await api("/api/central/schedule/" + id, { method: "DELETE" });
    tCentral();
  };

  const nameOf = upc => (CEN.master.find(m => m.upc === upc) || {}).name || upc;
  const groupOf = id => id ? (CEN.groups.find(g => g.id === id) || {}).name || "a group"
    : "every store";

  $("cenBody").innerHTML = `
    <button class="mini" onclick="__w.schNew()" ${CEN.master.length ? "" : "disabled"}>
      Schedule a change</button>
    ${!CEN.master.length ? `<div class="note">Add something to the central list first.</div>` : ""}
    ${CEN.scheduled.length ? `<table class="tbl" style="margin-top:10px"><thead><tr>
      <th style="width:30%">Item</th><th>What</th><th>Becomes</th><th>From</th><th>Where</th>
      <th></th></tr></thead><tbody>
      ${CEN.scheduled.map(s => `<tr>
        <td style="padding-left:9px">${esc(nameOf(s.upc))}</td>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(s.field)}</td>
        <td style="padding-left:9px" class="num"><b>${s.field === "price"
          ? money(s.value) : esc(String(s.value))}</b></td>
        <td style="padding-left:9px">${esc(s.effective)}</td>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(groupOf(s.group_id))}</td>
        <td style="text-align:right;padding-right:9px">
          <button class="del" onclick="__w.schDel(${s.id})">×</button></td>
      </tr>`).join("")}
    </tbody></table>
    <div class="note">Checked every hour and shortly after the server restarts. A change dated for
      today goes out at the next check.</div>`
      : `<div class="note">Nothing scheduled. Tobacco prices usually move on a date — setting it in
        advance means it happens whether or not anyone remembers.</div>`}`;
}

/* --------------------------------- history -------------------------------- */
function cenHistory() {
  $("cenBody").innerHTML = CEN.pushes.length ? `
    <table class="tbl" style="margin-top:14px"><thead><tr><th>When</th><th>Who</th>
      <th>Stores</th><th>Changes</th><th>Held</th></tr></thead><tbody>
      ${CEN.pushes.map(p => `<tr>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(String(p.at).slice(0, 16))}</td>
        <td style="padding-left:9px">${esc(p.who || "—")}</td>
        <td style="padding-left:9px" class="num">${p.stores}</td>
        <td style="padding-left:9px" class="num">${p.changes}</td>
        <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${p.skipped || "—"}</td>
      </tr>`).join("")}
    </tbody></table>
    <div class="note">Every push is recorded, so a price that appeared overnight can be traced to a
      person and a time.</div>`
    : `<div class="note" style="margin-top:14px">Nothing pushed yet.</div>`;
}
