/* ===========================================================================
   Forecourt services.

   The screen is built around the one thing cashiers get wrong: what goes in the
   drawer and what counts as a sale. So every form shows both, before it's
   recorded, in words.
   =========================================================================== */

let SVC = { tab: "do", settings: null, recent: [], summary: [], kinds: {} };

async function tServices2() {
  $("cfgBody").innerHTML = `<p class="lede">Loading…</p>`;
  try {
    const d = await api("/api/services?store=" + STORE_ID);
    SVC.settings = d.settings;
    SVC.recent = d.recent;
    SVC.summary = d.summary;
    SVC.kinds = d.kinds;
  } catch (e) {
    $("cfgBody").innerHTML = `<div class="finding"><b>Couldn't load this</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }
  drawServices();
}

function drawServices() {
  W.svcTab = t => { SVC.tab = t; drawServices(); };
  const tabs = [["do", "Take one"], ["log", "What's been done"],
    ["reconcile", "Reconcile"], ["setup", "Settings"]];

  $("cfgBody").innerHTML = `
    <p class="lede">Money orders, lottery payouts and bill payments move cash without being sales.
      Only the fee is your income — ringing a ${money(500)} money order as a sale would add five
      hundred dollars to your takings and put the tax somewhere absurd.</p>
    <div class="stktabs">${tabs.map(([k, l]) =>
      `<button class="${SVC.tab === k ? "on" : ""}" onclick="__w.svcTab('${k}')">${l}</button>`).join("")}</div>
    <div id="svcBody"></div>`;

  ({ do: svcDo, log: svcLog, reconcile: svcRec, setup: svcSetup })[SVC.tab]();
}

/* -------------------------------- take one -------------------------------- */
function svcDo() {
  const s = SVC.settings;
  const on = [];
  if (s.moneyOrders) on.push("money_order");
  if (s.lottery) on.push("lottery_payout");
  if (s.billPay) on.push("bill_pay");

  if (!on.length) {
    $("svcBody").innerHTML = `<div class="note" style="margin-top:16px">Nothing is switched on
      yet. Turn on whichever of these your forecourt actually offers under <b>Settings</b>.</div>`;
    return;
  }

  W.svcForm = kind => {
    const label = (SVC.kinds[kind] || {}).label || kind;
    const isOut = kind === "lottery_payout";
    const defaultFee = kind === "money_order" ? s.mo_fee : kind === "bill_pay" ? s.bp_fee : 0;

    const el = veil(`<div class="card"><h3>${esc(label)}</h3>
      <p>${isOut
        ? `Money leaves the drawer. This isn't a refund and it isn't a sale — it reduces cash with
           no product attached.`
        : `Money comes into the drawer, but only the fee is income. The rest is held and passed on.`}</p>
      <div class="frm">
        <label>${isOut ? "Ticket value" : "Amount"}
          <input class="n" id="svFace" inputmode="decimal" placeholder="0.00"></label>
        ${isOut ? "" : `<label>Fee<input class="n" id="svFee" value="${defaultFee.toFixed(2)}"></label>`}
      </div>
      ${kind === "money_order" ? `<div class="frm">
        <label>Serial number<input id="svRef" placeholder="from the printed order"></label>
        <label>Payable to<input id="svPayee" placeholder="optional"></label></div>` : ""}
      ${kind === "lottery_payout" ? `<div class="frm">
        <label>Ticket number<input id="svRef" placeholder="optional"></label></div>
        <div class="note">Over ${money(s.lotto_max)} the customer claims from the state. Paying it
          here is your own money.</div>` : ""}
      ${kind === "bill_pay" ? `<div class="frm">
        <label>Biller<select id="svBiller">
          ${(s.billers || []).map(b => `<option>${esc(b)}</option>`).join("")}
          ${!(s.billers || []).length ? `<option value="">none set up</option>` : ""}
        </select></label>
        <label>Account<input id="svRef" placeholder="account number"></label></div>` : ""}

      <div class="cbar" id="svTell" style="margin-top:14px">Enter an amount</div>
      <div class="err" id="svErr" style="display:none"></div>
      <div class="row"><button class="no" id="svx">Cancel</button>
        <button class="ok" id="svy">Record it</button></div></div>`);

    const face = () => parseFloat(el.querySelector("#svFace").value) || 0;
    const fee = () => {
      const f = el.querySelector("#svFee");
      return f ? parseFloat(f.value) || 0 : 0;
    };

    /* Say what the drawer does before it's committed, not after. */
    const tell = () => {
      const f = face(), e = fee();
      const box = el.querySelector("#svTell");
      if (!f) { box.textContent = "Enter an amount"; return; }
      box.innerHTML = isOut
        ? `Take <b>${money(f)}</b> out of the drawer. <b>Nothing</b> is a sale.`
        : `Take <b>${money(f + e)}</b> into the drawer. Only <b>${money(e)}</b> is income —
           the other <b>${money(f)}</b> is held and passed on.`;
    };
    el.querySelector("#svFace").oninput = tell;
    if (el.querySelector("#svFee")) el.querySelector("#svFee").oninput = tell;

    el.querySelector("#svx").onclick = () => el.remove();
    el.querySelector("#svy").onclick = async () => {
      const err = el.querySelector("#svErr");
      const ref = el.querySelector("#svRef");
      const biller = el.querySelector("#svBiller");
      try {
        const r = await api(`/api/services/${kind}?store=${STORE_ID}`, { method: "POST", body: {
          store: STORE_ID, face: face(), fee: fee(),
          reference: ref ? ref.value : null,
          payee: el.querySelector("#svPayee") ? el.querySelector("#svPayee").value : null,
          biller: biller ? biller.value : null,
          who: ME.n, shiftId: typeof SHIFT_ID !== "undefined" ? SHIFT_ID : null } });
        el.remove();
        toast(r.cash > 0
          ? `Took <b>${money(r.cash)}</b> in — <b>${money(r.fee)}</b> of it is income.`
          : `Paid out <b>${money(Math.abs(r.cash))}</b>.`);
        /* The drawer has physically changed, so the shift has to know. */
        if (typeof drawerNote === "function") drawerNote(r.cash, (SVC.kinds[kind] || {}).label);
        tServices2();
      } catch (e) { err.textContent = e.message; err.style.display = "block"; }
    };
    setTimeout(() => el.querySelector("#svFace").focus(), 40);
  };

  $("svcBody").innerHTML = `
    <div class="svcgrid">
      ${on.map(k => {
        const label = (SVC.kinds[k] || {}).label || k;
        const out = k === "lottery_payout";
        return `<button class="svcbtn ${out ? "out" : "in"}" onclick="__w.svcForm('${k}')">
          <b>${esc(label)}</b>
          <em>${out ? "money out of the drawer" : "money into the drawer"}</em>
        </button>`;
      }).join("")}
    </div>
    <div class="note">Each of these tells you what the drawer should do before it records anything.</div>`;
}

/* --------------------------- what's been done ----------------------------- */
function svcLog() {
  W.svcVoid = async id => {
    const el = veil(`<div class="card"><h3>Void this?</h3>
      <p>It stops counting towards the drawer and the day's totals, but the row is kept — a money
        order serial that was issued and spoiled still has to be accounted for to the provider.</p>
      <input id="vwhy" placeholder="Why — printer jammed, wrong amount" style="margin-top:12px">
      <div class="row"><button class="no" id="vx">Keep it</button>
        <button class="danger" id="vy">Void it</button></div></div>`);
    el.querySelector("#vx").onclick = () => el.remove();
    el.querySelector("#vy").onclick = async () => {
      try {
        const r = await api(`/api/services/void/${id}?store=${STORE_ID}`, { method: "POST",
          body: { store: STORE_ID, who: ME.n, note: el.querySelector("#vwhy").value } });
        el.remove();
        toast(r.cashBack > 0
          ? `Put <b>${money(r.cashBack)}</b> back in the drawer.`
          : `Take <b>${money(Math.abs(r.cashBack))}</b> out of the drawer.`);
        tServices2();
      } catch (e) { toast(e.message, true); }
    };
  };

  $("svcBody").innerHTML = SVC.recent.length ? `
    <table class="tbl" style="margin-top:14px"><thead><tr><th>When</th><th style="width:18%">What</th>
      <th>Amount</th><th>Fee</th><th>Drawer</th><th>Reference</th><th>Who</th><th></th>
    </tr></thead><tbody>
      ${SVC.recent.map(r => `<tr ${r.voided ? 'style="opacity:.45"' : ""}>
        <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${
          esc(String(r.at).slice(0, 16))}</td>
        <td style="padding-left:9px">${esc(r.label)}${r.voided
          ? ` <em style="font-style:normal;color:var(--void);font-size:11.5px">void</em>` : ""}</td>
        <td style="padding-left:9px" class="num">${money(r.face)}</td>
        <td style="padding-left:9px" class="num" style="color:var(--vfd)">${
          r.fee ? money(r.fee) : "—"}</td>
        <td style="padding-left:9px" class="num" style="color:${r.cash < 0
          ? "var(--void)" : "var(--txt)"}">${r.cash > 0 ? "+" : ""}${money(r.cash)}</td>
        <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${
          esc(r.reference || r.biller || "—")}</td>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(r.who || "—")}</td>
        <td style="text-align:right;padding-right:9px">${r.voided ? ""
          : `<button class="mini" style="margin:0" onclick="__w.svcVoid(${r.id})">Void</button>`}</td>
      </tr>`).join("")}
    </tbody></table>` : `<div class="note" style="margin-top:16px">Nothing recorded yet.</div>`;
}

/* -------------------------------- reconcile ------------------------------- */
async function svcRec() {
  $("svcBody").innerHTML = `<p class="note" style="margin-top:16px">Working it out…</p>`;
  const today = new Date().toISOString().slice(0, 10);
  let lot, mo;
  try {
    [lot, mo] = await Promise.all([
      api(`/api/services/lottery?store=${STORE_ID}&date=${today}`),
      api(`/api/services/money-orders?store=${STORE_ID}&from=${today}&to=${today}`)
    ]);
  } catch (e) {
    $("svcBody").innerHTML = `<div class="finding"><b>Couldn't load that</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }

  $("svcBody").innerHTML = `
    <div class="sect">Lottery paid out today</div>
    <div class="rtiles">
      <div><span>Tickets paid</span><b>${lot.count}</b></div>
      <div><span>Total</span><b>${money(lot.total)}</b></div>
    </div>
    <div class="note">Check this against the lottery terminal's own report before you close.
      A difference here is the commonest reason a forecourt drawer comes up short and nobody can
      say why.</div>
    ${lot.biggest.length ? `<table class="tbl"><thead><tr><th>When</th><th>Amount</th>
      <th>Ticket</th><th>Who</th></tr></thead><tbody>
      ${lot.biggest.map(b => `<tr>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(String(b.at).slice(11, 16))}</td>
        <td style="padding-left:9px" class="num">${money(b.face)}</td>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(b.reference || "—")}</td>
        <td style="padding-left:9px;color:var(--txt-2)">${esc(b.who || "—")}</td>
      </tr>`).join("")}</tbody></table>` : ""}

    <div class="sect">Money orders today</div>
    <div class="rtiles">
      <div><span>Written</span><b>${mo.count}</b></div>
      <div><span>Face value</span><b>${money(mo.face)}</b></div>
      <div><span>Fees earned</span><b style="color:var(--vfd)">${money(mo.fees)}</b></div>
      <div><span>Voided</span><b style="${mo.voided ? "color:var(--warn)" : ""}">${mo.voided}</b></div>
    </div>
    ${mo.serials.gaps.length ? `<div class="finding">
      <b>${mo.serials.gaps.reduce((a, g) => a + g.missing, 0)} serial number${
        mo.serials.gaps.reduce((a, g) => a + g.missing, 0) === 1 ? "" : "s"} unaccounted for</b>
      <span>${mo.serials.gaps.map(g =>
        `${g.missing} between ${g.after} and ${g.before}`).join(", ")}. Every form has to be
        accounted for to the provider, including spoiled ones — void them here so there's a
        record.</span></div>`
      : mo.serials.checked > 1 ? `<div class="note">Serial numbers run in sequence with no gaps.</div>` : ""}

    <div class="note">Face value isn't income — it's money you're holding until the order clears.
      Only the fees column belongs to the shop.</div>`;
}

/* --------------------------------- settings ------------------------------- */
function svcSetup() {
  const s = SVC.settings;
  W.svcSet = (k, v) => { s[k] = v; };
  W.svcBillers = v => { s.billers = v.split(",").map(x => x.trim()).filter(Boolean); };
  W.svcSave = async () => {
    try {
      const r = await api("/api/services?store=" + STORE_ID, { method: "PUT",
        body: { store: STORE_ID, settings: {
          moneyOrders: !!s.moneyOrders, mo_fee: parseFloat(s.mo_fee) || 0,
          mo_max: parseFloat(s.mo_max) || 0,
          lottery: !!s.lottery, lotto_max: parseFloat(s.lotto_max) || 0,
          billPay: !!s.billPay, bp_fee: parseFloat(s.bp_fee) || 0,
          billers: s.billers } } });
      SVC.settings = r.settings;
      toast("Saved.");
      drawServices();
    } catch (e) { toast(e.message, true); }
  };

  const row = (key, label, body) => `
    <label class="chk" style="margin-top:16px;display:flex;gap:10px;align-items:center">
      <input type="checkbox" ${s[key] ? "checked" : ""} style="width:auto"
        onchange="__w.svcSet('${key}',this.checked);drawServices()">
      <span>${label}</span></label>
    ${s[key] ? body : ""}`;

  $("svcBody").innerHTML = `
    ${row("moneyOrders", "We write money orders", `
      <div class="frm">
        <label>Fee<input class="n" value="${s.mo_fee}" oninput="__w.svcSet('mo_fee',this.value)"></label>
        <label>Most we'll write<input class="n" value="${s.mo_max}"
          oninput="__w.svcSet('mo_max',this.value)"></label>
      </div>`)}

    ${row("lottery", "We pay out lottery winnings", `
      <div class="frm">
        <label>Most we'll pay<input class="n" value="${s.lotto_max}"
          oninput="__w.svcSet('lotto_max',this.value)"></label>
      </div>
      <div class="note">Above this the customer claims from the state. Illinois is ${money(600)};
        check yours, because paying over the limit is your own money and you don't get it back.</div>`)}

    ${row("billPay", "We take bill payments", `
      <div class="frm">
        <label>Fee<input class="n" value="${s.bp_fee}" oninput="__w.svcSet('bp_fee',this.value)"></label>
        <label style="flex:2">Billers<input value="${esc((s.billers || []).join(", "))}"
          placeholder="ComEd, Nicor Gas" oninput="__w.svcBillers(this.value)"></label>
      </div>`)}

    <button class="mini" onclick="__w.svcSave()">Save</button>
    <div class="note">Anything switched off never appears at the till, so a cashier can't record
      something the shop doesn't actually offer.</div>`;
}
