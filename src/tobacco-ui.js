/* ===========================================================================
   Tobacco scan data.

   Deliberately honest about what this is: the capture is complete and correct,
   the export is a documented generic layout, and the manufacturer's real format
   has to come from your rep. Pretending otherwise would produce a file that
   gets rejected a month after you started relying on it.
   =========================================================================== */

let TOB = { tab: "setup", settings: null, buydowns: [], makers: [], columns: [],
            claim: null, from: "", to: "", maker: "altria" };

const MAKER_NAMES = { altria: "Altria", reynolds: "Reynolds", itg: "ITG", other: "Other" };

async function tTobacco() {
  $("cfgBody").innerHTML = `<p class="lede">Loading…</p>`;
  try {
    const d = await api("/api/tobacco?store=" + STORE_ID);
    TOB.settings = d.settings;
    TOB.buydowns = d.buydowns;
    TOB.makers = d.makers;
    TOB.columns = d.columns;
  } catch (e) {
    $("cfgBody").innerHTML = `<div class="finding"><b>Couldn't load this</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }
  if (!TOB.from) {
    /* Last calendar month, because that's the period these are claimed for. */
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    TOB.from = first.toISOString().slice(0, 10);
    TOB.to = last.toISOString().slice(0, 10);
  }
  drawTobacco();
}

function drawTobacco() {
  W.tobTab = t => { TOB.tab = t; drawTobacco(); };
  const tabs = [["setup", "Enrolment"], ["buydowns", "Buydowns"], ["claim", "What you're owed"]];

  $("cfgBody").innerHTML = `
    <p class="lede">Manufacturers pay for a monthly file of what you sold and which promotions you
      applied. This records all of it as it happens — a month with no buydown captured is a month
      you can't claim for, and that can't be fixed afterwards.</p>
    <div class="stktabs">${tabs.map(([k, l]) =>
      `<button class="${TOB.tab === k ? "on" : ""}" onclick="__w.tobTab('${k}')">${l}</button>`).join("")}</div>
    <div id="tobBody"></div>`;

  ({ setup: tobSetup, buydowns: tobBuydowns, claim: tobClaim })[TOB.tab]();
}

/* ------------------------------- enrolment ------------------------------- */
function tobSetup() {
  const s = TOB.settings;
  const depts = CFG.depts.filter(d => !d.fuel);

  W.tobSet = (k, v) => { s[k] = v; };
  W.tobOutlet = (m, v) => { s.outlets = { ...s.outlets, [m]: v }; };
  W.tobDept = (id, on) => {
    s.deptIds = on ? [...new Set([...s.deptIds, id])] : s.deptIds.filter(x => x !== id);
  };
  W.tobSave = async () => {
    try {
      const r = await api("/api/tobacco?store=" + STORE_ID, { method: "PUT",
        body: { store: STORE_ID, settings: { on: !!s.on, outlets: s.outlets,
          deptIds: s.deptIds, note: s.note } } });
      TOB.settings = r.settings;
      toast("Saved.");
      drawTobacco();
    } catch (e) { toast(e.message, true); }
  };

  const anyOutlet = Object.values(s.outlets || {}).some(v => v && String(v).trim());

  $("tobBody").innerHTML = `
    <label class="chk" style="margin-top:16px;display:flex;gap:10px;align-items:center">
      <input type="checkbox" ${s.on ? "checked" : ""} onchange="__w.tobSet('on',this.checked)"
        style="width:auto">
      <span>Capture tobacco scan data</span></label>
    ${!s.on ? `<div class="note">Switch this on before you enrol, not after. Nothing is recorded
      while it's off, and there's no way to reconstruct a month of promotions later.</div>` : ""}

    <div class="sect">Outlet numbers</div>
    <div class="frm">
      ${TOB.makers.filter(m => m !== "other").map(m => `
        <label>${esc(MAKER_NAMES[m] || m)}<input value="${esc((s.outlets || {})[m] || "")}"
          placeholder="not enrolled" oninput="__w.tobOutlet('${m}',this.value)"></label>`).join("")}
    </div>
    <div class="note">Each manufacturer issues you a number when you enrol. It goes on every row of
      the file and a file without it gets rejected. Your rep has it; so does whoever signed your
      current contract.</div>
    ${!anyOutlet ? `<div class="finding"><b>No outlet numbers yet</b>
      <span>If you're not enrolled with anyone, that's money you're not collecting — a busy store
        can see several hundred a month in buydown reimbursement. Ask your Altria and Reynolds reps
        what you're signed up for.</span></div>` : ""}

    <div class="sect">Which sections are tobacco</div>
    <div class="chips">${depts.map(d => `
      <label class="chip ${s.deptIds.includes(d.id) ? "on" : ""}">
        <input type="checkbox" ${s.deptIds.includes(d.id) ? "checked" : ""} style="display:none"
          onchange="__w.tobDept('${d.id}',this.checked);this.closest('label').classList.toggle('on',this.checked)">
        ${esc(d.n)}</label>`).join("")}</div>
    <div class="note">Everything sold from these sections is captured, whether or not a promotion
      applied — the manufacturers want the whole picture, not just the discounted lines.</div>

    <button class="mini" onclick="__w.tobSave()">Save</button>`;
}

/* -------------------------------- buydowns -------------------------------- */
function tobBuydowns() {
  W.buyEdit = id => {
    const b = id ? TOB.buydowns.find(x => x.id === id)
      : { maker: "altria", kind: "per_unit", pluIds: [], amount: 0.75, qty: 2, price: 8 };
    const el = veil(`<div class="card tall"><h3>${id ? "Edit" : "New"} buydown</h3>
      <p>A funded discount: you take money off at the till and the manufacturer pays it back. Get
        the amount and the dates from the letter or the portal — guessing means claiming for
        something they didn't fund.</p>
      <div class="edwrap">
      <div class="frm">
        <label>Name<input id="bn" value="${esc(b.name || "")}" placeholder="Marlboro 0.75 off"></label>
        <label>Manufacturer<select id="bm">${TOB.makers.map(m =>
          `<option value="${m}" ${b.maker === m ? "selected" : ""}>${esc(MAKER_NAMES[m] || m)}</option>`).join("")}
        </select></label>
        <label>Kind<select id="bk">
          <option value="per_unit" ${b.kind === "per_unit" ? "selected" : ""}>So much off each pack</option>
          <option value="multipack" ${b.kind === "multipack" ? "selected" : ""}>Multipack — buy two for a price</option>
        </select></label>
      </div>
      <div class="frm" id="perWrap">
        <label>Funded per pack<input class="n" id="ba" value="${b.amount || ""}"></label>
      </div>
      <div class="frm" id="mulWrap">
        <label>Buy this many<input class="n" id="bq" value="${b.qty || 2}"></label>
        <label>For this price<input class="n" id="bp" value="${b.price || ""}"></label>
      </div>
      <div class="frm">
        <label>Starts<input type="date" id="bs" value="${esc(b.starts || "")}"></label>
        <label>Ends<input type="date" id="be" value="${esc(b.ends || "")}"></label>
      </div>
      <div class="note">Leave the dates blank to run it until you switch it off. Filling them in is
        better — a buydown that ended stops applying by itself, and nobody ever remembers.</div>
      <div class="sect">Which products</div>
      <div class="chips" id="buyPlus">${CFG.plus.slice(0, 300).map(p => `
        <label class="chip ${(b.pluIds || []).includes(p.id) ? "on" : ""}">
          <input type="checkbox" value="${p.id}" ${(b.pluIds || []).includes(p.id) ? "checked" : ""}
            style="display:none"
            onchange="this.closest('label').classList.toggle('on',this.checked)">
          ${esc(p.n)}</label>`).join("")}</div>
      </div>
      <div class="row"><button class="no" id="bx">Cancel</button>
        <button class="ok" id="by">Save</button></div></div>`);

    const sync = () => {
      const per = el.querySelector("#bk").value === "per_unit";
      el.querySelector("#perWrap").style.display = per ? "" : "none";
      el.querySelector("#mulWrap").style.display = per ? "none" : "";
    };
    el.querySelector("#bk").onchange = sync;
    sync();

    el.querySelector("#bx").onclick = () => el.remove();
    el.querySelector("#by").onclick = async () => {
      const pluIds = [...el.querySelectorAll("#buyPlus input:checked")].map(i => i.value);
      try {
        await api("/api/tobacco/buydown?store=" + STORE_ID, { method: "POST",
          body: { store: STORE_ID, buydown: { id, name: el.querySelector("#bn").value,
            maker: el.querySelector("#bm").value, kind: el.querySelector("#bk").value,
            amount: el.querySelector("#ba").value, qty: el.querySelector("#bq").value,
            price: el.querySelector("#bp").value, starts: el.querySelector("#bs").value,
            ends: el.querySelector("#be").value, pluIds } } });
        el.remove();
        toast("Saved.");
        tTobacco();
      } catch (e) { toast(e.message, true); }
    };
    setTimeout(() => el.querySelector("#bn").focus(), 40);
  };

  W.buyDel = async id => {
    if (!confirm("Delete this buydown? Lines already captured against it keep their funding.")) return;
    await api(`/api/tobacco/buydown/${id}?store=${STORE_ID}`, { method: "DELETE" });
    tTobacco();
  };

  const today = new Date().toISOString().slice(0, 10);
  const state = b => {
    if (!b.active) return ["off", "var(--txt-3)"];
    if (b.starts && b.starts > today) return ["starts " + b.starts, "var(--txt-2)"];
    if (b.ends && b.ends < today) return ["ended " + b.ends, "var(--txt-3)"];
    return ["running", "var(--vfd)"];
  };

  $("tobBody").innerHTML = `
    <button class="mini" onclick="__w.buyEdit(0)">New buydown</button>
    ${TOB.buydowns.length ? `<table class="tbl" style="margin-top:10px"><thead><tr>
      <th style="width:24%">Buydown</th><th>Maker</th><th>Terms</th><th>Products</th>
      <th>Runs</th><th>State</th><th></th></tr></thead><tbody>
      ${TOB.buydowns.map(b => {
        const st = state(b);
        return `<tr>
          <td style="padding-left:9px"><b>${esc(b.name)}</b></td>
          <td style="padding-left:9px;color:var(--txt-2)">${esc(MAKER_NAMES[b.maker] || b.maker)}</td>
          <td style="padding-left:9px">${b.kind === "multipack"
            ? `${b.qty} for ${money(b.price)}` : `${money(b.amount)} off each`}</td>
          <td style="padding-left:9px;color:var(--txt-3)">${b.pluIds.length}</td>
          <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${
            b.starts || b.ends ? `${esc(b.starts || "any")} → ${esc(b.ends || "open")}` : "open"}</td>
          <td style="padding-left:9px"><span style="color:${st[1]}">${esc(st[0])}</span></td>
          <td style="text-align:right;padding-right:9px">
            <button class="mini" style="margin:0" onclick="__w.buyEdit(${b.id})">Edit</button>
            <button class="del" onclick="__w.buyDel(${b.id})">×</button></td>
        </tr>`;
      }).join("")}
    </tbody></table>
    <div class="note">A multipack funds the gap between the shelf price and the deal price, per
      whole set. Three packs on a two-for deal claims one set, not one and a half — that's how the
      manufacturers calculate it, and claiming otherwise gets the file queried.</div>`
      : `<div class="note">No buydowns yet. These are the funded discounts your rep tells you
        about — until one is entered here, the discount comes out of your own margin.</div>`}`;
}

/* ---------------------------- what you're owed ---------------------------- */
async function tobClaim() {
  $("tobBody").innerHTML = `<p class="note" style="margin-top:16px">Working it out…</p>`;

  W.claimSet = (k, v) => { TOB[k] = v; tobClaim(); };
  W.claimCsv = () => {
    const q = new URLSearchParams({ store: STORE_ID, maker: TOB.maker,
      from: TOB.from, to: TOB.to, format: "csv" });
    window.open("/api/tobacco/export?" + q, "_blank");
  };

  let d;
  try {
    const q = new URLSearchParams({ store: STORE_ID, maker: TOB.maker,
      from: TOB.from, to: TOB.to });
    d = await api("/api/tobacco/claim?" + q);
  } catch (e) {
    $("tobBody").innerHTML = `<div class="finding"><b>Couldn't work that out</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }

  const c = d.claim;

  $("tobBody").innerHTML = `
    <div class="frm" style="margin-top:14px">
      <label>Manufacturer<select onchange="__w.claimSet('maker',this.value)">
        <option value="all" ${TOB.maker === "all" ? "selected" : ""}>All</option>
        ${TOB.makers.map(m => `<option value="${m}" ${TOB.maker === m ? "selected" : ""}>${
          esc(MAKER_NAMES[m] || m)}</option>`).join("")}
      </select></label>
      <label>From<input type="date" value="${esc(TOB.from)}"
        onchange="__w.claimSet('from',this.value)"></label>
      <label>To<input type="date" value="${esc(TOB.to)}"
        onchange="__w.claimSet('to',this.value)"></label>
    </div>

    <div class="rtiles">
      <div><span>Units sold</span><b>${c.units}</b></div>
      <div><span>Customers paid</span><b>${money(c.paid)}</b></div>
      <div><span>Manufacturer owes</span><b style="color:var(--vfd)">${money(c.funded)}</b></div>
      <div><span>Lines captured</span><b>${c.lines}</b></div>
    </div>

    ${d.ready.problems.length ? `<div class="finding" style="margin-top:14px">
      <b>${d.ready.problems.length === 1 ? "One thing" : d.ready.problems.length + " things"}
        would stop this being paid</b>
      <span>${d.ready.problems.map(p => esc(p)).join("<br>")}</span></div>` : ""}

    ${c.byBuydown.length ? `<div class="sect">By promotion</div>
      <table class="tbl"><thead><tr><th style="width:34%">Buydown</th><th>Maker</th><th>Units</th>
        <th>Funded</th></tr></thead><tbody>
        ${c.byBuydown.map(b => `<tr>
          <td style="padding-left:9px">${esc(b.name || "(deleted buydown)")}</td>
          <td style="padding-left:9px;color:var(--txt-2)">${esc(MAKER_NAMES[b.maker] || b.maker || "—")}</td>
          <td style="padding-left:9px" class="num">${b.units}</td>
          <td style="padding-left:9px" class="num">${money(b.funded)}</td>
        </tr>`).join("")}
      </tbody></table>` : ""}

    ${c.byItem.length ? `<div class="sect">By item</div>
      <table class="tbl"><thead><tr><th style="width:30%">Item</th><th>Barcode</th><th>Units</th>
        <th>Paid</th><th>Funded</th></tr></thead><tbody>
        ${c.byItem.slice(0, 60).map(i => `<tr>
          <td style="padding-left:9px">${esc(i.name || i.plu_id)}</td>
          <td style="padding-left:9px" class="num" style="color:${i.upc
            ? "var(--txt-2)" : "var(--void)"}">${esc(i.upc || "missing")}</td>
          <td style="padding-left:9px" class="num">${i.units}</td>
          <td style="padding-left:9px" class="num">${money(i.paid)}</td>
          <td style="padding-left:9px" class="num">${i.funded ? money(i.funded) : "—"}</td>
        </tr>`).join("")}
      </tbody></table>` : `<div class="note">Nothing captured in that period.</div>`}

    ${c.lines ? `<div style="display:flex;gap:8px;margin-top:12px">
      <button class="mini" style="margin:0" onclick="__w.claimCsv()">Download the CSV</button>
    </div>` : ""}

    <div class="sect">About the file</div>
    <div class="note" style="margin-top:0">
      This exports a documented layout with every field the manufacturers ask for:
      ${TOB.columns.map(c => `<b>${esc(c[0])}</b>`).join(", ")}.
      <br><br>
      It is deliberately <b>not</b> Altria's or Reynolds' own format, because those specifications
      come from them and a wrong column means a rejected file you'd find out about a month later.
      Ask your rep for the current layout and I'll map this to it — the data is all here, so it's a
      rename rather than a rebuild.
    </div>`;
}
