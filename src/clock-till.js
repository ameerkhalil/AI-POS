/* ===========================================================================
   Clocking in from the till.

   Somebody arriving for a shift should not have to find a settings screen. So:
   a small button on the register, a list of names, one tap.

   The card afterwards is doing real work, not decoration. A person punching in
   wants to know it registered — a toast that fades in two seconds doesn't
   settle that. Their own name, the time it recorded, and where they stand for
   the week does, and it's the moment they'd notice if any of it were wrong.
   =========================================================================== */

let CLOCKING = false;

/* Everyone the store knows about, whether or not they're a till user. */
const clockPeople = () => [...new Set([
  ...(CFG.employees || []).map(e => e.n).filter(Boolean)
])].sort();

async function openClock() {
  if (CLOCKING) return;
  CLOCKING = true;

  const people = clockPeople();
  const el = veil(`<div class="card clockpick"><h3>Time clock</h3>
    <p>Tap your name. Nothing else on the till changes.</p>
    <div class="cpeople" id="cpList">
      ${people.length
        ? people.map(n => `<button class="cperson" data-who="${esc(n)}">
            <b>${esc(n)}</b><em>checking…</em></button>`).join("")
        : `<p class="note">Nobody is set up yet. Add people under
           <b>Staff &amp; permissions</b>.</p>`}
    </div>
    <div class="row"><button class="no" id="cx">Close</button></div></div>`);

  const close = () => { CLOCKING = false; el.remove(); };
  el.querySelector("#cx").onclick = close;
  el.onclick = e => { if (e.target === el) close(); };

  /* Who's already on, so the button says the right thing before it's pressed. */
  const cards = [...el.querySelectorAll(".cperson")];
  await Promise.all(cards.map(async b => {
    const who = b.dataset.who;
    try {
      const p = await api(`/api/clock/who?store=${STORE_ID}&who=${encodeURIComponent(who)}`);
      b.dataset.on = p.on ? "1" : "0";
      b.classList.toggle("on", p.on);
      b.querySelector("em").textContent = p.on
        ? `on since ${String(p.since).slice(11, 16)} · ${hoursWords(p.minutes / 60)}`
        : (p.weekHours ? `${hoursWords(p.weekHours)} this week` : "not on the clock");
    } catch (e) {
      b.querySelector("em").textContent = "couldn't check";
    }
  }));

  cards.forEach(b => b.onclick = async () => {
    const who = b.dataset.who;
    const dir = b.dataset.on === "1" ? "out" : "in";
    b.disabled = true;
    b.querySelector("em").textContent = dir === "in" ? "clocking in…" : "clocking out…";
    try {
      const r = await api(`/api/clock/${dir}?store=${STORE_ID}`, { method: "POST",
        body: { store: STORE_ID, who } });
      if (r.ok === false) {
        b.disabled = false;
        b.querySelector("em").textContent = r.error || "that didn't work";
        return;
      }
      close();
      clockCard(dir, who, r);
    } catch (e) {
      b.disabled = false;
      b.querySelector("em").textContent = e.message;
    }
  });
}

/* "7h 20m" rather than "7.33", because nobody thinks in decimal hours. */
function hoursWords(h) {
  const total = Math.max(0, Math.round((Number(h) || 0) * 60));
  const hh = Math.floor(total / 60), mm = total % 60;
  if (!hh) return `${mm}m`;
  if (!mm) return `${hh}h`;
  return `${hh}h ${mm}m`;
}

const clockTime = iso => {
  const d = new Date(String(iso).includes("T") ? iso : String(iso).replace(" ", "T") + "Z");
  return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

/* The card. Dismisses itself, but a tap anywhere closes it early — somebody
   with a queue behind them shouldn't have to wait out an animation. */
function clockCard(dir, who, r) {
  const p = r.person || {};
  const inAt = dir === "in" ? (r.at || p.since) : null;
  const worked = dir === "out" ? (r.paidHours ?? 0) : null;

  const toWeek = Math.max(0, (p.overtimeAfter || 40) - (p.weekHours || 0));

  const el = document.createElement("div");
  el.className = "clockcard " + dir;
  el.innerHTML = `
    <div class="cc-inner">
      <div class="cc-mark">
        <svg viewBox="0 0 52 52">
          <circle class="cc-ring" cx="26" cy="26" r="23"/>
          ${dir === "in"
            ? `<path class="cc-tick" d="M15 27l8 8 15-16"/>`
            : `<path class="cc-tick" d="M26 13v14l9 6"/>`}
        </svg>
      </div>

      <div class="cc-who">${esc(who)}</div>
      <div class="cc-what">${dir === "in" ? "clocked in" : "clocked out"}
        <b>${esc(clockTime(dir === "in" ? inAt : new Date().toISOString()))}</b></div>

      <div class="cc-stats">
        ${dir === "out" ? `
          <div class="cc-stat big">
            <span>This shift</span>
            <b>${hoursWords(worked)}</b>
          </div>` : ""}
        <div class="cc-stat ${dir === "in" ? "big" : ""}">
          <span>Today</span>
          <b>${hoursWords(p.todayHours)}</b>
        </div>
        <div class="cc-stat">
          <span>This week</span>
          <b>${hoursWords(p.weekHours)}</b>
          ${p.daysThisWeek ? `<em>over ${p.daysThisWeek} day${
            p.daysThisWeek === 1 ? "" : "s"}</em>` : ""}
        </div>
      </div>

      ${p.intoOvertime
        ? `<div class="cc-note warn">Past ${p.overtimeAfter} hours — anything more this week is
           overtime.</div>`
        : dir === "in" && toWeek <= 8 && toWeek > 0
        ? `<div class="cc-note">${hoursWords(toWeek)} before overtime starts.</div>`
        : dir === "in"
        ? `<div class="cc-note">Have a good shift.</div>`
        : `<div class="cc-note">Thanks — see you next time.</div>`}
    </div>`;

  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("up"));

  const go = () => {
    el.classList.remove("up");
    el.classList.add("away");
    setTimeout(() => el.remove(), 380);
  };
  el.onclick = go;
  setTimeout(go, dir === "in" ? 5200 : 6400);
}

/* The button itself, put wherever a shell has room for it. */
function clockButton(cls) {
  return `<button class="${cls || "clockbtn"}" onclick="openClock()" title="Time clock">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
    <span>Clock</span></button>`;
}
