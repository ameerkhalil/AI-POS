/* ===========================================================================
   The reports screen.

   Six views over the same window. The window is chosen once at the top and
   applies to all of them, because "last 30 days" meaning different things on
   different tabs is how people end up quoting the wrong number in a meeting.
   =========================================================================== */

let RPT = { days: 30, tab: "overview", data: null, day: null };

async function tReports2() {
  $("cfgBody").innerHTML = `<p class="lede">Working it out…</p>`;
  await rptLoad();
  drawReports2();
}

const deptNames = () => {
  const o = {};
  CFG.depts.forEach(d => { o[d.id] = d.n; });
  return o;
};

async function rptLoad() {
  try {
    RPT.data = await api("/api/reports?store=" + STORE_ID, { method: "POST", body: {
      store: STORE_ID, days: RPT.days, deptNames: deptNames(), limit: 150,
      want: ["overview", "byDay", "busy", "products", "departments", "staff",
             "tenders", "exceptions"]
    }});
  } catch (e) { RPT.data = { error: e.message }; }
}

/* A small inline bar chart. Deliberately not a charting library: a bar is a div
   with a height, and shipping 90kb to draw one would be silly. */
function bars(rows, label, value, opts = {}) {
  const peak = Math.max(1, ...rows.map(value));
  return `<div class="rbars ${opts.tall ? "tall" : ""}">${rows.map(r => {
    const v = value(r);
    const h = Math.round(v / peak * 100);
    return `<div class="rbar" title="${esc(label(r))}: ${opts.money ? money(v) : v}">
      <i style="height:${h}%;${opts.colour && opts.colour(r) ? `background:${opts.colour(r)}` : ""}"></i>
      <span>${esc(opts.short ? opts.short(r) : label(r))}</span>
    </div>`;
  }).join("")}</div>`;
}

function drawReports2() {
  const d = RPT.data;

  W.rptDays = async v => { RPT.days = +v; await rptLoad(); drawReports2(); };
  W.rptTab = t => { RPT.tab = t; drawReports2(); };

  if (!d || d.error) {
    $("cfgBody").innerHTML = `<div class="finding"><b>Couldn't build the reports</b>
      <span>${esc(d?.error || "No data came back.")}</span></div>`;
    return;
  }

  const tabs = [["overview", "Overview"], ["busy", "When it's busy"],
    ["products", "Products"], ["departments", "Sections"], ["staff", "Staff"],
    ["exceptions", "Worth a look"]];

  const o = d.overview;
  const dir = o.change == null ? "" : o.change > 0 ? "up" : o.change < 0 ? "down" : "";

  $("cfgBody").innerHTML = `
    <div class="rhead">
      <div class="rbig">
        <span>Taken over ${o.days} days</span>
        <b>${money(o.taken)}</b>
        ${o.change == null ? `<em>no earlier period to compare with</em>`
          : `<em class="${dir}">${o.change > 0 ? "▲" : o.change < 0 ? "▼" : "–"}
             ${Math.abs(o.change)}% against the ${o.days} days before</em>`}
      </div>
      <label class="rwindow">Window
        <select onchange="__w.rptDays(this.value)">
          ${[7, 14, 30, 90, 180, 365].map(n =>
            `<option value="${n}" ${RPT.days === n ? "selected" : ""}>Last ${n} days</option>`).join("")}
        </select></label>
    </div>

    <div class="stktabs">${tabs.map(([k, l]) =>
      `<button class="${RPT.tab === k ? "on" : ""}" onclick="__w.rptTab('${k}')">${l}</button>`).join("")}</div>
    <div id="rptBody"></div>`;

  ({ overview: rptOverview, busy: rptBusy, products: rptProducts,
     departments: rptDepts, staff: rptStaff, exceptions: rptExceptions })[RPT.tab]();
}

/* ------------------------------- overview -------------------------------- */
function rptOverview() {
  const d = RPT.data, o = d.overview;
  const days = d.byDay;
  const best = days.slice().sort((a, b) => b.total - a.total)[0];

  $("rptBody").innerHTML = `
    <div class="rtiles">
      <div><span>Sales</span><b>${o.sales.toLocaleString()}</b></div>
      <div><span>Average basket</span><b>${money(o.basket)}</b></div>
      <div><span>Refunds</span><b>${o.returns}</b>
        ${o.refunded ? `<em>${money(o.refunded)}</em>` : ""}</div>
      <div><span>Busiest day</span><b>${best ? money(best.total) : "—"}</b>
        ${best ? `<em>${esc(best.d)}</em>` : ""}</div>
    </div>

    <div class="sect">Day by day</div>
    ${days.length ? bars(days, r => r.d, r => r.total,
      { money: true, tall: true, short: r => r.d.slice(8) })
      : `<div class="note">Nothing in this window.</div>`}

    <div class="sect">How they paid</div>
    ${d.tenders.length ? `<table class="tbl"><thead><tr><th style="width:40%">Method</th>
      <th>Count</th><th>Total</th><th>Share</th></tr></thead><tbody>
      ${d.tenders.map(t => `<tr>
        <td style="padding-left:9px">${esc(t.mop)}</td>
        <td style="padding-left:9px" class="num">${t.n}</td>
        <td style="padding-left:9px" class="num">${money(t.total)}</td>
        <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${t.share}%</td>
      </tr>`).join("")}</tbody></table>` : `<div class="note">No payments recorded.</div>`}`;
}

/* -------------------------------- busy ----------------------------------- */
function rptBusy() {
  const b = RPT.data.busy;
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const peakHour = b.hours.slice().sort((a, x) => x.n - a.n)[0];
  const quiet = b.hours.filter(h => h.n > 0).sort((a, x) => a.n - x.n)[0];
  const peakDay = b.weekdays.slice().sort((a, x) => x.total - a.total)[0];

  $("rptBody").innerHTML = `
    <div class="rtiles">
      <div><span>Busiest hour</span><b>${peakHour.hour}:00</b>
        <em>${peakHour.perDay} sales a day</em></div>
      <div><span>Quietest trading hour</span><b>${quiet ? quiet.hour + ":00" : "—"}</b>
        ${quiet ? `<em>${quiet.perDay} a day</em>` : ""}</div>
      <div><span>Best day of the week</span><b>${DAYS[peakDay.day].slice(0, 3)}</b>
        <em>${money(peakDay.total)}</em></div>
      <div><span>Days open</span><b>${b.openDays}</b></div>
    </div>

    <div class="sect">Sales by hour, averaged over ${b.openDays} trading day${
      b.openDays === 1 ? "" : "s"}</div>
    ${bars(b.hours, h => `${h.hour}:00`, h => h.n,
      { tall: true, short: h => h.hour % 3 === 0 ? String(h.hour) : "" })}

    <div class="sect">Takings by day of the week</div>
    ${bars(b.weekdays, w => DAYS[w.day], w => w.total,
      { money: true, short: w => DAYS[w.day].slice(0, 2) })}

    <div class="note">Averaged over days the shop actually traded, not calendar days — otherwise a
      long window makes every hour look quieter than it is.</div>`;
}

/* ------------------------------- products -------------------------------- */
function rptProducts() {
  const rows = RPT.data.products;
  const noCost = rows.filter(r => r.margin == null).length;

  $("rptBody").innerHTML = `
    ${noCost ? `<div class="note" style="margin-top:14px">${noCost} of these have no cost recorded,
      so their margin is shown as unknown rather than guessed at. Costs come in from
      <b>Invoice intake</b> or can be typed under <b>Pricebook</b>.</div>` : ""}
    <table class="tbl"><thead><tr><th style="width:34%">Product</th><th>Sold</th><th>Revenue</th>
      <th>Cost</th><th>Profit</th><th>Margin</th></tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td style="padding-left:9px">${esc(r.name || "(unnamed)")}</td>
        <td style="padding-left:9px" class="num">${r.qty}</td>
        <td style="padding-left:9px" class="num">${money(r.revenue)}</td>
        <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${
          r.cost ? money(r.cost) : "—"}</td>
        <td style="padding-left:9px" class="num">${r.profit == null ? "—" : money(r.profit)}</td>
        <td style="padding-left:9px" class="num" style="${r.margin == null ? "color:var(--txt-3)"
          : r.margin < 10 ? "color:var(--warn)" : ""}">${
          r.margin == null ? (r.partial ? "partly costed" : "unknown") : r.margin + "%"}</td>
      </tr>`).join("") || `<tr><td colspan="6" style="padding:14px;color:var(--txt-3)">
        Nothing sold in this window.</td></tr>`}
    </tbody></table>`;
}

/* ------------------------------ departments ------------------------------ */
function rptDepts() {
  const rows = RPT.data.departments;
  $("rptBody").innerHTML = `
    ${rows.length ? bars(rows, r => r.name, r => r.revenue,
      { money: true, short: r => r.name.slice(0, 8) }) : ""}
    <table class="tbl" style="margin-top:14px"><thead><tr><th style="width:34%">Section</th>
      <th>Items</th><th>Revenue</th><th>Share</th><th>Margin</th></tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td style="padding-left:9px">${esc(r.name)}</td>
        <td style="padding-left:9px" class="num">${r.qty}</td>
        <td style="padding-left:9px" class="num">${money(r.revenue)}</td>
        <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${r.share}%</td>
        <td style="padding-left:9px" class="num" style="${r.margin == null ? "color:var(--txt-3)" : ""}">
          ${r.margin == null ? (r.partial ? "partly costed" : "unknown") : r.margin + "%"}</td>
      </tr>`).join("") || `<tr><td colspan="5" style="padding:14px;color:var(--txt-3)">
        Nothing sold in this window.</td></tr>`}
    </tbody></table>
    <div class="note">A section only gets a margin when every item sold in it had a cost recorded.
      One missing cost makes the whole figure a guess, so it says so instead.</div>`;
}

/* --------------------------------- staff --------------------------------- */
function rptStaff() {
  const rows = RPT.data.staff;
  /* Flagging is relative to the rest of the team rather than an absolute, so a
     shop that discounts a lot doesn't light up entirely red. */
  const avgDisc = rows.length
    ? rows.reduce((a, r) => a + r.discountRate, 0) / rows.length : 0;
  const avgRet = rows.length
    ? rows.reduce((a, r) => a + r.returnRate, 0) / rows.length : 0;

  $("rptBody").innerHTML = `
    <table class="tbl"><thead><tr><th style="width:22%">Who</th><th>Sales</th><th>Taken</th>
      <th>Basket</th><th>Items a sale</th><th>Discounted</th><th>Refunds</th>
      <th>Hours active</th></tr></thead><tbody>
      ${rows.map(r => {
        const hotDisc = rows.length > 1 && r.discountRate > avgDisc * 2 && r.discountRate > 5;
        const hotRet = rows.length > 1 && r.returnRate > avgRet * 2 && r.returnRate > 3;
        return `<tr>
          <td style="padding-left:9px"><b>${esc(r.who)}</b></td>
          <td style="padding-left:9px" class="num">${r.sales}</td>
          <td style="padding-left:9px" class="num">${money(r.taken)}</td>
          <td style="padding-left:9px" class="num">${money(r.basket)}</td>
          <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${r.itemsPerSale}</td>
          <td style="padding-left:9px" class="num" style="${hotDisc ? "color:var(--warn)" : ""}">
            ${r.discountRate}%</td>
          <td style="padding-left:9px" class="num" style="${hotRet ? "color:var(--warn)" : ""}">
            ${r.returnRate}%</td>
          <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${r.hoursActive}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="8" style="padding:14px;color:var(--txt-3)">
        Nothing rung in this window.</td></tr>`}
    </tbody></table>
    <div class="note">Amber means well above this team's own average, not above some universal
      figure — a shop that runs a lot of promotions shouldn't light up entirely. Treat it as
      somewhere to look, not a conclusion: whoever works the busy shift will always sit at the top
      of the takings column.</div>`;
}

/* ------------------------------ exceptions ------------------------------- */
function rptExceptions() {
  const e = RPT.data.exceptions;
  const block = (title, rows, why, cols) => `
    <div class="sect">${title} — ${rows.length}</div>
    ${rows.length ? `<table class="tbl"><thead><tr>${cols.map(c =>
      `<th>${c[0]}</th>`).join("")}</tr></thead><tbody>
      ${rows.map(r => `<tr>${cols.map(c =>
        `<td style="padding-left:9px">${c[1](r)}</td>`).join("")}</tr>`).join("")}
    </tbody></table>` : `<div class="note" style="margin-top:0">None.</div>`}
    <div class="note">${why}</div>`;

  const when = r => esc(String(r.at).slice(0, 16));

  $("rptBody").innerHTML =
    block("Refunds with no original sale", e.refundsNoOriginal,
      "A refund put through without finding the sale it came from. Sometimes unavoidable, but it's " +
      "the easiest way to take money out of a till, so it's worth knowing how often it happens.",
      [["When", when], ["Who", r => esc(r.who || "—")],
       ["Amount", r => `<span class="num">${money(r.amount)}</span>`],
       ["Sale", r => `<span class="num" style="color:var(--txt-3)">#${r.seq}</span>`]]) +

    block("Discounts over a quarter of the sale", e.bigDiscounts,
      "Large discounts are usually genuine. A pattern from one person on one shift is the thing " +
      "to notice.",
      [["When", when], ["Who", r => esc(r.who || "—")],
       ["Discount", r => `<span class="num">${money(r.discount)}</span>`],
       ["Sale total", r => `<span class="num">${money(r.amount)}</span>`]]) +

    block("Sales between 2am and 5am", e.afterHours,
      "Normal for a 24-hour forecourt and odd for a shop that shuts at ten. Read it against your " +
      "own opening hours.",
      [["When", when], ["Who", r => esc(r.who || "—")],
       ["Amount", r => `<span class="num">${money(r.amount)}</span>`]]);
}
