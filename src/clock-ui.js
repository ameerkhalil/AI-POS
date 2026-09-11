/* ===========================================================================
   The time clock, on screen.

   Two audiences. A cashier arriving for a shift wants one large button and to
   be gone in three seconds. A manager on a Monday wants the week's hours, what
   they cost, and the two punches somebody got wrong.

   So the clock itself is deliberately blunt — names, big targets, no typing —
   and the detail lives behind it.
   =========================================================================== */

let CLK = { tab: "clock", settings: null, wages: {}, onDuty: [], sheet: null,
            from: "", to: "", labour: null };

async function tClock() {
  $("cfgBody").innerHTML = `<p class="lede">Loading…</p>`;
  if (!CLK.from) {
    CLK.from = weekStartLocal();
    CLK.to = new Date().toISOString().slice(0, 10);
  }
  try {
    const d = await api("/api/clock?store=" + STORE_ID);
    CLK.settings = d.settings;
    CLK.wages = d.wages;
    CLK.onDuty = d.onDuty;
  } catch (e) {
    $("cfgBody").innerHTML = `<div class="finding"><b>Couldn't load the clock</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }
  drawClock();
}

/* Monday, because that's what a rota runs on. */
function weekStartLocal(d) {
  const x = new Date((d || new Date().toISOString().slice(0, 10)) + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

const staffNames = () => {
  const fromCfg = (CFG.employees || []).map(e => e.n).filter(Boolean);
  const fromWages = Object.keys(CLK.wages || {});
  const onNow = (CLK.onDuty || []).map(p => p.who);
  return [...new Set([...fromCfg, ...fromWages, ...onNow])].sort();
};

function drawClock() {
  W.clkTab = t => { CLK.tab = t; drawClock(); };
  const tabs = [["clock", "Clock in and out"], ["sheet", "Timesheet"],
    ["labour", "What it costs"], ["setup", "Settings"]];

  $("cfgBody").innerHTML = `
    <p class="lede">Hours worked, and what they cost against what the shop took. Nobody is ever
      blocked from clocking in — a forgotten punch is recorded and flagged rather than argued
      with.</p>
    <div class="stktabs">${tabs.map(([k, l]) =>
      `<button class="${CLK.tab === k ? "on" : ""}" onclick="__w.clkTab('${k}')">${l}</button>`).join("")}</div>
    <div id="clkBody"></div>`;

  ({ clock: clkClock, sheet: clkSheet, labour: clkLabour, setup: clkSetup })[CLK.tab]();
}

/* --------------------------- clock in and out ----------------------------- */
function clkClock() {
  const names = staffNames();
  const onDuty = {};
  (CLK.onDuty || []).forEach(p => { onDuty[p.who] = p; });

  W.clkPunch = async (who, dir) => {
    try {
      const r = await api(`/api/clock/${dir}?store=${STORE_ID}`, { method: "POST",
        body: { store: STORE_ID, who } });
      if (r.ok === false) return toast(r.error, true);
      if (r.warning) toast(r.warning, true);
      else if (dir === "in") toast(`<b>${esc(who)}</b> clocked in.`);
      else toast(`<b>${esc(who)}</b> clocked out — ${(r.paidHours || 0).toFixed(2)} hours.`);
      const d = await api("/api/clock?store=" + STORE_ID);
      CLK.onDuty = d.onDuty;
      drawClock();
    } catch (e) { toast(e.message, true); }
  };

  const hm = mins => `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;

  $("clkBody").innerHTML = `
    ${!CLK.settings.on_ ? `<div class="finding" style="margin-top:14px">
      <b>The clock is switched off</b>
      <span>Punches are still recorded, but overtime and labour cost won't be worked out until
        it's on under Settings.</span></div>` : ""}

    ${CLK.onDuty.length ? `<div class="sect">On the clock now — ${CLK.onDuty.length}</div>
      <div class="clkgrid">
        ${CLK.onDuty.map(p => `
          <button class="clkcard on" onclick="__w.clkPunch('${esc(p.who)}','out')">
            <b>${esc(p.who)}</b>
            <em>in since ${esc(String(p.in_at).slice(11, 16))} · ${hm(p.minutes)}</em>
            <span>Clock out</span>
          </button>`).join("")}
      </div>` : ""}

    <div class="sect">${CLK.onDuty.length ? "Everyone else" : "Clock in"}</div>
    ${names.filter(n => !onDuty[n]).length ? `<div class="clkgrid">
      ${names.filter(n => !onDuty[n]).map(n => `
        <button class="clkcard" onclick="__w.clkPunch('${esc(n)}','in')">
          <b>${esc(n)}</b>
          <em>${CLK.wages[n] != null ? money(CLK.wages[n]) + " an hour" : "no wage set"}</em>
          <span>Clock in</span>
        </button>`).join("")}
    </div>` : `<div class="note">Everybody is already on the clock.</div>`}

    ${!names.length ? `<div class="note">No staff yet. Add them under <b>Staff & permissions</b>
      and they'll appear here.</div>` : ""}`;
}

/* -------------------------------- timesheet ------------------------------- */
async function clkSheet() {
  $("clkBody").innerHTML = `<p class="note" style="margin-top:16px">Working out the hours…</p>`;

  W.clkRange = (k, v) => { CLK[k] = v; clkSheet(); };
  W.clkWeek = n => {
    const d = new Date(CLK.from + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n * 7);
    CLK.from = d.toISOString().slice(0, 10);
    const e = new Date(d); e.setUTCDate(e.getUTCDate() + 6);
    CLK.to = e.toISOString().slice(0, 10);
    clkSheet();
  };
  W.clkCsv = () => {
    const q = new URLSearchParams({ store: STORE_ID, from: CLK.from, to: CLK.to, format: "csv" });
    window.open("/api/clock/payroll?" + q, "_blank");
  };

  W.clkEdit = (id, who, inAt, outAt, brk) => {
    const el = veil(`<div class="card"><h3>${esc(who)}</h3>
      <p>The original is kept and shown against this, so a corrected punch can always be told from
        one that was right the first time.</p>
      <div class="frm">
        <label>Clocked in<input id="pin" value="${esc(String(inAt).slice(0, 16))}"
          placeholder="YYYY-MM-DD HH:MM"></label>
        <label>Clocked out<input id="pout" value="${esc(String(outAt || "").slice(0, 16))}"
          placeholder="leave blank if still on"></label>
        <label>Break, minutes<input class="n" id="pbrk" value="${brk || 0}"></label>
      </div>
      <div class="err" id="perr" style="display:none"></div>
      <div class="row"><button class="no" id="px">Cancel</button>
        <button class="danger" id="pdel">Delete</button>
        <button class="ok" id="py">Save</button></div></div>`);
    el.querySelector("#px").onclick = () => el.remove();
    el.querySelector("#pdel").onclick = async () => {
      if (!confirm("Delete this punch entirely?")) return;
      await api(`/api/clock/punch/${id}?store=${STORE_ID}`, { method: "DELETE" });
      el.remove();
      clkSheet();
    };
    el.querySelector("#py").onclick = async () => {
      const err = el.querySelector("#perr");
      try {
        await api(`/api/clock/punch/${id}?store=${STORE_ID}`, { method: "PUT", body: {
          store: STORE_ID, by: ME.n,
          in_at: el.querySelector("#pin").value,
          out_at: el.querySelector("#pout").value,
          break_mins: el.querySelector("#pbrk").value } });
        el.remove();
        clkSheet();
      } catch (e) { err.textContent = e.message; err.style.display = "block"; }
    };
  };

  W.clkAdd = () => {
    const names = staffNames();
    const el = veil(`<div class="card"><h3>Add a punch</h3>
      <p>For somebody who forgot entirely. It's marked as added by you.</p>
      <div class="frm">
        <label>Who<select id="awho">${names.map(n =>
          `<option>${esc(n)}</option>`).join("")}</select></label>
      </div>
      <div class="frm">
        <label>Clocked in<input id="ain" placeholder="YYYY-MM-DD HH:MM"></label>
        <label>Clocked out<input id="aout" placeholder="YYYY-MM-DD HH:MM"></label>
      </div>
      <div class="err" id="aerr" style="display:none"></div>
      <div class="row"><button class="no" id="ax">Cancel</button>
        <button class="ok" id="ay">Add it</button></div></div>`);
    el.querySelector("#ax").onclick = () => el.remove();
    el.querySelector("#ay").onclick = async () => {
      const err = el.querySelector("#aerr");
      try {
        await api("/api/clock/punch?store=" + STORE_ID, { method: "POST", body: {
          store: STORE_ID, by: ME.n, who: el.querySelector("#awho").value,
          in_at: el.querySelector("#ain").value,
          out_at: el.querySelector("#aout").value } });
        el.remove();
        clkSheet();
      } catch (e) { err.textContent = e.message; err.style.display = "block"; }
    };
  };

  let d;
  try {
    d = await api(`/api/clock/sheet?store=${STORE_ID}&from=${CLK.from}&to=${CLK.to}`);
  } catch (e) {
    $("clkBody").innerHTML = `<div class="finding"><b>Couldn't build the sheet</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }

  $("clkBody").innerHTML = `
    <div class="frm" style="margin-top:14px">
      <label>From<input type="date" value="${esc(CLK.from)}"
        onchange="__w.clkRange('from',this.value)"></label>
      <label>To<input type="date" value="${esc(CLK.to)}"
        onchange="__w.clkRange('to',this.value)"></label>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="mini" style="margin:0" onclick="__w.clkWeek(-1)">← Previous week</button>
      <button class="mini" style="margin:0" onclick="__w.clkWeek(1)">Next week →</button>
      <button class="mini" style="margin:0" onclick="__w.clkAdd()">Add a punch</button>
      <button class="mini" style="margin:0" onclick="__w.clkCsv()">Download for payroll</button>
    </div>

    <div class="rtiles">
      <div><span>Hours</span><b>${d.totals.hours}</b></div>
      <div><span>Overtime</span><b style="${d.totals.overtime ? "color:var(--warn)" : ""}">
        ${d.totals.overtime}</b></div>
      <div><span>Wage cost</span><b>${d.totals.cost == null ? "—" : money(d.totals.cost)}</b>
        ${d.totals.cost == null ? `<em>${d.totals.unratedPeople.length} without a wage</em>` : ""}</div>
      <div><span>People</span><b>${d.people.length}</b></div>
    </div>

    ${d.problems.length ? `<div class="finding">
      <b>${d.problems.length} punch${d.problems.length === 1 ? "" : "es"} need a look</b>
      <span>${d.problems.map(p => `${esc(p.who)} — ${esc(p.detail)}`).join("<br>")}</span></div>` : ""}

    ${d.people.map(p => `
      <div class="sect">${esc(p.who)} — ${p.hours}h over ${p.days} day${p.days === 1 ? "" : "s"}${
        p.overtimeHours ? `, ${p.overtimeHours} at overtime` : ""}${
        p.cost != null ? ` · ${money(p.cost)}` : " · no wage set"}</div>
      <table class="tbl"><thead><tr><th>In</th><th>Out</th><th>Break</th><th>Hours</th>
        <th>Paid</th><th></th></tr></thead><tbody>
        ${p.punches.map(x => `<tr ${x.open ? 'style="color:var(--warn)"' : ""}>
          <td style="padding-left:9px">${esc(String(x.in_at).slice(0, 16))}</td>
          <td style="padding-left:9px">${x.open
            ? "still on the clock" : esc(String(x.out_at).slice(0, 16))}</td>
          <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${
            x.breakMins ? x.breakMins + "m" : "—"}</td>
          <td style="padding-left:9px" class="num">${x.hours == null ? "—" : x.hours.toFixed(2)}</td>
          <td style="padding-left:9px" class="num">${x.paidHours == null
            ? "—" : x.paidHours.toFixed(2)}</td>
          <td style="text-align:right;padding-right:9px">
            ${x.edited ? `<em style="font-style:normal;font-size:11px;color:var(--txt-3)">edited by
              ${esc(x.editedBy || "someone")}</em> ` : ""}
            <button class="mini" style="margin:0" onclick="__w.clkEdit(${x.id},'${esc(p.who)}',
              '${esc(x.in_at)}','${esc(x.out_at || "")}',${x.breakMins || 0})">Edit</button></td>
        </tr>`).join("")}
      </tbody></table>`).join("") ||
      `<div class="note">Nobody clocked anything in that range.</div>`}`;
}

/* ------------------------------ what it costs ----------------------------- */
async function clkLabour() {
  $("clkBody").innerHTML = `<p class="note" style="margin-top:16px">Working it out…</p>`;
  W.clkDay = v => { CLK.to = v; clkLabour(); };

  const day = CLK.to || new Date().toISOString().slice(0, 10);
  let d;
  try { d = await api(`/api/clock/labour?store=${STORE_ID}&from=${day}&to=${day}`); }
  catch (e) {
    $("clkBody").innerHTML = `<div class="finding"><b>Couldn't work that out</b>
      <span>${esc(e.message)}</span></div>`;
    return;
  }

  const worked = d.hours.filter(h => h.staffHours > 0 || h.took > 0);
  const peak = Math.max(1, ...d.hours.map(h => Math.max(h.took, h.cost)));

  $("clkBody").innerHTML = `
    <div class="frm" style="margin-top:14px">
      <label>Day<input type="date" value="${esc(day)}" onchange="__w.clkDay(this.value)"></label>
    </div>

    <div class="rtiles">
      <div><span>Took</span><b>${money(d.totals.took)}</b></div>
      <div><span>Wages</span><b>${money(d.totals.cost)}</b></div>
      <div><span>Wages as a share</span><b style="${d.totals.share > 25
        ? "color:var(--warn)" : ""}">${d.totals.share == null ? "—" : d.totals.share + "%"}</b></div>
      <div><span>Staff hours</span><b>${d.totals.staffHours}</b></div>
    </div>

    ${d.unrated.length ? `<div class="note">${d.unrated.map(u => esc(u)).join(", ")}
      ${d.unrated.length === 1 ? "has" : "have"} no wage set, so ${d.unrated.length === 1
        ? "their" : "their"} hours aren't in the cost.</div>` : ""}

    ${worked.length ? `<table class="tbl" style="margin-top:14px"><thead><tr><th>Hour</th>
      <th>Sales</th><th>Took</th><th>Staff</th><th>Wages</th><th>Share</th><th></th>
    </tr></thead><tbody>
      ${worked.map(h => `<tr ${h.losing ? 'style="background:rgba(210,102,76,.07)"' : ""}>
        <td style="padding-left:9px">${String(h.hour).padStart(2, "0")}:00</td>
        <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${h.sales || "—"}</td>
        <td style="padding-left:9px" class="num">${money(h.took)}</td>
        <td style="padding-left:9px" class="num" style="color:var(--txt-2)">${
          h.staffHours ? h.staffHours.toFixed(1) : "—"}</td>
        <td style="padding-left:9px" class="num">${h.cost ? money(h.cost) : "—"}</td>
        <td style="padding-left:9px" class="num" style="${h.share == null ? "color:var(--txt-3)"
          : h.share > 40 ? "color:var(--void)" : h.share > 25 ? "color:var(--warn)" : ""}">
          ${h.share == null ? "—" : h.share + "%"}</td>
        <td style="padding-left:9px;width:28%">
          <div class="lbar">
            <i class="took" style="width:${Math.round(h.took / peak * 100)}%"></i>
            <i class="cost" style="width:${Math.round(h.cost / peak * 100)}%"></i>
          </div></td>
      </tr>`).join("")}
    </tbody></table>
    <div class="note">The wide bar is what the hour took; the narrow one underneath is what it cost
      in wages. A red row means the hour was staffed and took less than it cost. One quiet hour
      isn't a problem — the same hour quiet every day is a rota question.</div>`
      : `<div class="note">Nothing worked or sold on that day.</div>`}`;
}

/* --------------------------------- settings ------------------------------- */
function clkSetup() {
  const s = CLK.settings;
  const names = staffNames();

  W.clkSet = (k, v) => { s[k] = v; };
  W.clkWage = (who, v) => { CLK.wages[who] = v; };
  W.clkSave = async () => {
    try {
      const r = await api("/api/clock?store=" + STORE_ID, { method: "PUT", body: {
        store: STORE_ID,
        settings: { on: !!s.on_, week_hours: parseFloat(s.week_hours) || 40,
          ot_multiplier: parseFloat(s.ot_multiplier) || 1.5,
          round_mins: parseInt(s.round_mins) || 0,
          auto_break: parseFloat(s.auto_break) || 0,
          auto_break_after: parseFloat(s.auto_break_after) || 0 },
        wages: CLK.wages } });
      CLK.settings = r.settings;
      toast("Saved.");
      tClock();
    } catch (e) { toast(e.message, true); }
  };

  $("clkBody").innerHTML = `
    <label class="chk" style="margin-top:16px;display:flex;gap:10px;align-items:center">
      <input type="checkbox" ${s.on_ ? "checked" : ""} style="width:auto"
        onchange="__w.clkSet('on_',this.checked)">
      <span>Work out overtime and labour cost</span></label>

    <div class="frm" style="margin-top:14px">
      <label>Overtime after, hours a week
        <input class="n" value="${s.week_hours}" oninput="__w.clkSet('week_hours',this.value)"></label>
      <label>Paid at
        <input class="n" value="${s.ot_multiplier}"
          oninput="__w.clkSet('ot_multiplier',this.value)"></label>
      <label>Round punches to
        <select onchange="__w.clkSet('round_mins',this.value)">
          ${[0, 5, 6, 10, 15].map(m => `<option value="${m}" ${+s.round_mins === m ? "selected" : ""}>${
            m ? m + " minutes" : "the minute"}</option>`).join("")}
        </select></label>
    </div>
    <div class="note">Overtime is worked out per week, not across whatever range you're looking at,
      so a fortnight of ordinary weeks doesn't come out as overtime. The threshold is a state
      matter — check yours rather than trusting the default.</div>

    <div class="sect">Automatic break</div>
    <div class="frm">
      <label>Deduct<input class="n" value="${s.auto_break}"
        oninput="__w.clkSet('auto_break',this.value)" placeholder="minutes"></label>
      <label>On shifts over<input class="n" value="${s.auto_break_after}"
        oninput="__w.clkSet('auto_break_after',this.value)" placeholder="hours"></label>
    </div>
    <div class="note">Leave both at zero to pay exactly what was clocked. A deduction here never
      reduces a break somebody already recorded — it only applies if it's longer.</div>

    <div class="sect">Hourly rates</div>
    ${names.length ? `<table class="tbl"><thead><tr><th style="width:50%">Who</th>
      <th>An hour</th></tr></thead><tbody>
      ${names.map(n => `<tr>
        <td style="padding-left:9px">${esc(n)}</td>
        <td><input class="n" value="${CLK.wages[n] ?? ""}" placeholder="—"
          oninput="__w.clkWage('${esc(n)}',this.value)"></td>
      </tr>`).join("")}
    </tbody></table>` : `<div class="note">No staff yet.</div>`}
    <div class="note">Somebody with no rate still has their hours counted — their cost shows as
      unknown rather than as zero, because zero would quietly make the labour figure wrong.</div>

    <button class="mini" onclick="__w.clkSave()">Save</button>`;
}
