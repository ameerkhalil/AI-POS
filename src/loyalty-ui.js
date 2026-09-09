/* ===========================================================================
   Loyalty: the settings, the offers, and who's actually coming in.

   The till-side lookup lives in the register shells; this is the back office
   view — how the scheme works, what offers are running, and which customers
   are worth knowing about.
   =========================================================================== */

let LOY = { tab: "scheme", settings: null, offers: [], top: [], lapsed: [] };

async function tLoyalty() {
  $("cfgBody").innerHTML = `<p class="lede">Loading…</p>`;
  try {
    const [a, b] = await Promise.all([
      api("/api/loyalty?store=" + STORE_ID),
      api("/api/loyalty/customers?store=" + STORE_ID)
    ]);
    LOY.settings = a.settings;
    LOY.offers = a.offers;
    LOY.top = b.top;
    LOY.lapsed = b.lapsed;
  } catch (e) {
    $("cfgBody").innerHTML = `<div class="finding"><b>Couldn't load loyalty</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }
  drawLoyalty();
}

function drawLoyalty() {
  W.loyTab = t => { LOY.tab = t; drawLoyalty(); };
  const tabs = [["scheme", "How it works"], ["offers", "Offers"], ["people", "Customers"]];

  $("cfgBody").innerHTML = `
    <p class="lede">Points are a promise to hand over money later, so they're kept as a ledger of
      every movement rather than a number somebody can edit. The balance is the sum of it.</p>
    <div class="stktabs">${tabs.map(([k, l]) =>
      `<button class="${LOY.tab === k ? "on" : ""}" onclick="__w.loyTab('${k}')">${l}</button>`).join("")}</div>
    <div id="loyBody"></div>`;

  ({ scheme: loyScheme, offers: loyOffers, people: loyPeople })[LOY.tab]();
}

/* ------------------------------ how it works ------------------------------ */
function loyScheme() {
  const s = LOY.settings;
  const depts = CFG.depts.filter(d => !d.fuel);

  W.loySet = (k, v) => { s[k] = v; };
  W.loyExc = (id, on) => {
    s.excluded = on ? [...new Set([...s.excluded, id])] : s.excluded.filter(x => x !== id);
  };
  W.loySave = async () => {
    try {
      const r = await api("/api/loyalty?store=" + STORE_ID, { method: "PUT",
        body: { store: STORE_ID, settings: {
          on: !!s.on, per_pound: parseFloat(s.per_pound) || 0,
          point_value: parseFloat(s.point_value) || 0,
          block: parseInt(s.block) || 1, excluded: s.excluded } } });
      LOY.settings = r.settings;
      toast("Saved.");
      drawLoyalty();
    } catch (e) { toast(e.message, true); }
  };

  /* Worked through with real numbers, because "1 point per pound at 0.01" is
     not a sentence anyone can price a scheme from. */
  const per = parseFloat(s.per_pound) || 0;
  const val = parseFloat(s.point_value) || 0;
  const block = parseInt(s.block) || 1;
  const spend100 = per * 100;
  const worth = +(spend100 * val).toFixed(2);
  const pct = per && val ? +(per * val * 100).toFixed(2) : 0;

  $("loyBody").innerHTML = `
    <label class="chk" style="margin-top:16px;display:flex;gap:10px;align-items:center">
      <input type="checkbox" ${s.on ? "checked" : ""} onchange="__w.loySet('on',this.checked)"
        style="width:auto">
      <span>Run a points scheme</span></label>

    <div class="frm" style="margin-top:14px">
      <label>Points earned per ${esc(CFG.site.currency || "$")}1 spent
        <input class="n" value="${s.per_pound}" oninput="__w.loySet('per_pound',this.value)"></label>
      <label>What one point is worth
        <input class="n" value="${s.point_value}" oninput="__w.loySet('point_value',this.value)"></label>
      <label>Spent in blocks of
        <input class="n" value="${s.block}" oninput="__w.loySet('block',this.value)"></label>
    </div>

    <div class="cbar" style="margin-top:12px">
      Spend <b>${money(100)}</b> → earn <b>${spend100}</b> points → worth <b>${money(worth)}</b>
      &nbsp;·&nbsp; that's <b>${pct}%</b> back
    </div>
    ${pct > 5 ? `<div class="finding"><b>That's ${pct}% of your takings</b>
      <span>Most schemes sit between 1 and 3%. At this rate the scheme costs more than most
        convenience margins earn.</span></div>` : ""}

    <div class="sect">Sections that earn nothing</div>
    <div class="chips">${depts.map(d => `
      <label class="chip ${s.excluded.includes(d.id) ? "on" : ""}">
        <input type="checkbox" ${s.excluded.includes(d.id) ? "checked" : ""} style="display:none"
          onchange="__w.loyExc('${d.id}',this.checked);this.closest('label').classList.toggle('on',this.checked)">
        ${esc(d.n)}</label>`).join("")}</div>
    <div class="note">Tick anything you make almost nothing on — fuel, lottery, phone cards. Giving
      points on a product with a 2% margin costs you money on every sale.</div>

    <button class="mini" onclick="__w.loySave()">Save</button>`;
}

/* --------------------------------- offers --------------------------------- */
function loyOffers() {
  W.offEdit = id => {
    const o = id ? LOY.offers.find(x => x.id === id) : { kind: "stamp", need: 10, pluIds: [] };
    const el = veil(`<div class="card tall"><h3>${id ? "Edit" : "New"} offer</h3>
      <p>A stamp card counts products. A spend card counts money. Either way it's the customer's
        running total, and it survives a refund by counting back down.</p>
      <div class="edwrap">
      <div class="frm">
        <label>Name<input id="on" value="${esc(o.name || "")}" placeholder="Coffee card"></label>
        <label>Kind<select id="ok">
          <option value="stamp" ${o.kind === "stamp" ? "selected" : ""}>Stamps — count products</option>
          <option value="spend" ${o.kind === "spend" ? "selected" : ""}>Spend — count money</option>
        </select></label>
        <label id="needWrap">How many<input class="n" id="one" value="${o.need || 10}"></label>
      </div>
      <label style="font-size:12.5px;color:var(--txt-2);display:block;margin-top:12px">
        What they get<input id="orw" value="${esc(o.reward || "")}"
          placeholder="A free coffee" style="margin-top:6px"></label>
      <div id="pluWrap" style="margin-top:12px">
        <div class="sect" style="margin-top:0">Which products count</div>
        <div class="chips" id="offPlus">${CFG.plus.slice(0, 200).map(p => `
          <label class="chip ${(o.pluIds || []).includes(p.id) ? "on" : ""}">
            <input type="checkbox" value="${p.id}" ${(o.pluIds || []).includes(p.id) ? "checked" : ""}
              style="display:none"
              onchange="this.closest('label').classList.toggle('on',this.checked)">
            ${esc(p.n)}</label>`).join("")}</div>
      </div></div>
      <div class="row"><button class="no" id="ox">Cancel</button>
        <button class="ok" id="oy">Save</button></div></div>`);

    const sync = () => {
      const stamp = el.querySelector("#ok").value === "stamp";
      el.querySelector("#pluWrap").style.display = stamp ? "" : "none";
      el.querySelector("#needWrap").querySelector("span, input");
    };
    el.querySelector("#ok").onchange = sync;
    sync();

    el.querySelector("#ox").onclick = () => el.remove();
    el.querySelector("#oy").onclick = async () => {
      const pluIds = [...el.querySelectorAll("#offPlus input:checked")].map(i => i.value);
      try {
        await api("/api/offers?store=" + STORE_ID, { method: "POST", body: { store: STORE_ID,
          offer: { id, name: el.querySelector("#on").value, kind: el.querySelector("#ok").value,
            need: el.querySelector("#one").value, reward: el.querySelector("#orw").value,
            pluIds } } });
        el.remove();
        toast("Saved.");
        tLoyalty();
      } catch (e) { toast(e.message, true); }
    };
    setTimeout(() => el.querySelector("#on").focus(), 40);
  };

  W.offDel = async id => {
    if (!confirm("Delete this offer? Anybody part way through loses their progress.")) return;
    await api(`/api/offers/${id}?store=${STORE_ID}`, { method: "DELETE" });
    tLoyalty();
  };

  $("loyBody").innerHTML = `
    <button class="mini" onclick="__w.offEdit(0)">New offer</button>
    ${LOY.offers.length ? `<table class="tbl" style="margin-top:10px"><thead><tr>
      <th style="width:26%">Offer</th><th>Kind</th><th>Target</th><th>Reward</th>
      <th>Products</th><th></th></tr></thead><tbody>
      ${LOY.offers.map(o => `<tr ${o.active ? "" : 'style="opacity:.5"'}>
        <td style="padding-left:9px"><b>${esc(o.name)}</b></td>
        <td style="padding-left:9px;color:var(--txt-2)">${o.kind === "stamp" ? "Stamps" : "Spend"}</td>
        <td style="padding-left:9px" class="num">${o.need}</td>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(o.reward || "—")}</td>
        <td style="padding-left:9px;color:var(--txt-3)">${o.kind === "stamp"
          ? o.pluIds.length + " item" + (o.pluIds.length === 1 ? "" : "s") : "any"}</td>
        <td style="text-align:right;padding-right:9px">
          <button class="mini" style="margin:0" onclick="__w.offEdit(${o.id})">Edit</button>
          <button class="del" onclick="__w.offDel(${o.id})">×</button></td>
      </tr>`).join("")}
    </tbody></table>` : `<div class="note">No offers yet. A stamp card is the simplest one that
      works: pick a product, set a number, say what they get.</div>`}`;
}

/* -------------------------------- customers ------------------------------- */
function loyPeople() {
  W.custOpen = async id => {
    const el = veil(`<div class="card wide tall"><h3>Customer</h3>
      <div class="edwrap" id="custBody"><p class="note">Loading…</p></div>
      <div class="row"><button class="no" id="cx">Close</button></div></div>`);
    el.querySelector("#cx").onclick = () => el.remove();
    try {
      const d = await api(`/api/customers/${id}?store=${STORE_ID}`);
      const c = d.customer;
      el.querySelector("h3").textContent = c.name || c.phone || "Customer";
      el.querySelector("#custBody").innerHTML = `
        <div class="rtiles">
          <div><span>Points</span><b>${c.balance}</b></div>
          <div><span>Joined</span><b style="font-size:15px">${esc(String(c.joined_at).slice(0, 10))}</b></div>
          <div><span>Last in</span><b style="font-size:15px">${c.last_seen
            ? esc(String(c.last_seen).slice(0, 10)) : "never"}</b></div>
        </div>
        ${c.phone ? `<div class="note">${esc(c.phone)}${c.email ? " · " + esc(c.email) : ""}</div>` : ""}

        ${d.usual.length ? `<div class="sect">What they buy</div>
          <div class="chips">${d.usual.map(u =>
            `<span class="chip">${esc(u.name)} <em style="font-style:normal;color:var(--txt-3)">
              ×${u.times}</em></span>`).join("")}</div>` : ""}

        ${d.offers.length ? `<div class="sect">Offers</div>
          <table class="tbl"><tbody>${d.offers.map(o => `<tr>
            <td style="padding-left:9px">${esc(o.name)}</td>
            <td style="padding-left:9px" class="num">${o.count} of ${o.need}</td>
            <td style="padding-left:9px">${o.ready
              ? `<span style="color:var(--vfd)">ready — ${esc(o.reward || "reward due")}</span>`
              : `<span style="color:var(--txt-3)">in progress</span>`}</td>
          </tr>`).join("")}</tbody></table>` : ""}

        <div class="sect">Points history</div>
        <table class="tbl"><thead><tr><th>When</th><th>What</th><th>Change</th><th>Who</th>
        </tr></thead><tbody>
          ${d.points.map(p => `<tr>
            <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${
              esc(String(p.at).slice(0, 16))}</td>
            <td style="padding-left:9px">${esc(p.kind)}${p.note
              ? ` <em style="font-style:normal;color:var(--txt-3)">${esc(p.note)}</em>` : ""}</td>
            <td style="padding-left:9px" class="num" style="color:${p.amount < 0
              ? "var(--void)" : "var(--vfd)"}">${p.amount > 0 ? "+" : ""}${p.amount}</td>
            <td style="padding-left:9px;color:var(--txt-2)">${esc(p.who || "—")}</td>
          </tr>`).join("") || `<tr><td colspan="4" style="padding:12px;color:var(--txt-3)">
            Nothing yet.</td></tr>`}
        </tbody></table>`;
    } catch (e) {
      el.querySelector("#custBody").innerHTML = `<p class="note">${esc(e.message)}</p>`;
    }
  };

  $("loyBody").innerHTML = `
    <div class="sect">Best customers, last 90 days</div>
    ${LOY.top.length ? `<table class="tbl"><thead><tr><th style="width:26%">Who</th><th>Visits</th>
      <th>Spent</th><th>Points</th><th>Last in</th><th></th></tr></thead><tbody>
      ${LOY.top.map(c => `<tr>
        <td style="padding-left:9px"><b>${esc(c.name || c.phone || "#" + c.id)}</b></td>
        <td style="padding-left:9px" class="num">${c.visits}</td>
        <td style="padding-left:9px" class="num">${money(c.spend)}</td>
        <td style="padding-left:9px" class="num">${c.balance}</td>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(String(c.last_visit).slice(0, 10))}</td>
        <td style="text-align:right;padding-right:9px">
          <button class="mini" style="margin:0" onclick="__w.custOpen(${c.id})">Open</button></td>
      </tr>`).join("")}
    </tbody></table>` : `<div class="note">Nobody has been attached to a sale yet. A customer is
      looked up at the till by phone number or card.</div>`}

    ${LOY.lapsed.length ? `<div class="sect">Haven't been in for a while</div>
      <table class="tbl"><thead><tr><th style="width:26%">Who</th><th>Visits</th><th>Points left</th>
        <th>Last in</th><th></th></tr></thead><tbody>
        ${LOY.lapsed.map(c => `<tr>
          <td style="padding-left:9px">${esc(c.name || c.phone || "#" + c.id)}</td>
          <td style="padding-left:9px" class="num">${c.visits}</td>
          <td style="padding-left:9px" class="num" style="${c.balance
            ? "color:var(--warn)" : ""}">${c.balance}</td>
          <td style="padding-left:9px;color:var(--txt-2)">${esc(String(c.last_seen).slice(0, 10))}</td>
          <td style="text-align:right;padding-right:9px">
            <button class="mini" style="margin:0" onclick="__w.custOpen(${c.id})">Open</button></td>
        </tr>`).join("")}
      </tbody></table>
      <div class="note">Regulars who've stopped coming. Points still sitting on the account are the
        obvious reason to get in touch.</div>` : ""}`;
}
