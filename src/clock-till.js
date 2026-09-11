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

  /* The picker hands over to the code pad, which owns the flag from there. */
  const close = () => { el.remove(); };
  const abandon = () => { CLOCKING = false; el.remove(); };
  el.querySelector("#cx").onclick = abandon;
  el.onclick = e => { if (e.target === el) abandon(); };

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

  cards.forEach(b => b.onclick = () => {
    const who = b.dataset.who;
    const dir = b.dataset.on === "1" ? "out" : "in";
    close();
    askCode(who, dir);
  });
}

/* The code. On the person's own terminal, in front of whoever else is standing
   there — so the digits never appear, and there's no list of names to guess
   against because the name was already chosen. */
function askCode(who, dir) {
  let entered = "";

  const el = veil(`<div class="card codepad">
    <h3>${esc(who)}</h3>
    <p>${dir === "in" ? "Clocking in" : "Clocking out"} — enter your own sign-in code.
      A manager's code works too, and is recorded as theirs.</p>
    <div class="cdots" id="cdots">${[0,1,2,3].map(() => `<i></i>`).join("")}</div>
    <div class="cmsg" id="cmsg"></div>
    <div class="cpad">
      ${[1,2,3,4,5,6,7,8,9].map(n => `<button data-k="${n}">${n}</button>`).join("")}
      <button data-k="del" class="wide">←</button>
      <button data-k="0">0</button>
      <button data-k="ok" class="go">Enter</button>
    </div>
    <div class="row"><button class="no" id="kx">Cancel</button></div></div>`);

  const dots = el.querySelector("#cdots");
  const msg = el.querySelector("#cmsg");
  const paint = () => {
    [...dots.children].forEach((d, i) => d.classList.toggle("on", i < entered.length));
  };
  const shake = text => {
    msg.textContent = text;
    dots.classList.add("wrong");
    setTimeout(() => dots.classList.remove("wrong"), 420);
    entered = "";
    paint();
  };

  const submit = async () => {
    if (entered.length < 4) return shake("That's not a full code.");
    const code = entered;
    entered = ""; paint();
    msg.textContent = "Checking…";
    try {
      const r = await api(`/api/clock/${dir}?store=${STORE_ID}`, { method: "POST",
        body: { store: STORE_ID, who, code } });
      if (r.ok === false) return shake(r.error || "That didn't work.");
      el.remove();
      clockCard(dir, who, r);
    } catch (e) {
      /* A refused code comes back as an error, so read the message rather than
         assuming it was a network problem. */
      shake(e.message || "That didn't work.");
    }
  };

  el.querySelectorAll("[data-k]").forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === "del") entered = entered.slice(0, -1);
    else if (k === "ok") return submit();
    else if (entered.length < 4) entered += k;
    msg.textContent = "";
    paint();
    /* Four digits is a whole code; waiting for Enter is a keystroke nobody
       needs. */
    if (entered.length === 4) setTimeout(submit, 120);
  });

  /* The keypad on the counter works too — most tills have one. */
  const keys = e => {
    if (/^[0-9]$/.test(e.key)) {
      if (entered.length < 4) entered += e.key;
      msg.textContent = "";
      paint();
      if (entered.length === 4) setTimeout(submit, 120);
    } else if (e.key === "Backspace") { entered = entered.slice(0, -1); paint(); }
    else if (e.key === "Enter") submit();
    else if (e.key === "Escape") done();
    e.preventDefault();
  };
  document.addEventListener("keydown", keys);

  const done = () => {
    document.removeEventListener("keydown", keys);
    CLOCKING = false;
    el.remove();
  };
  el.querySelector("#kx").onclick = done;
  el.onclick = e => { if (e.target === el) done(); };
  paint();
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
      ${r.onBehalf ? `<div class="cc-by">by ${esc(r.by)}</div>` : ""}
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

  CLOCKING = false;
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
