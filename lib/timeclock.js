/* ===========================================================================
   The time clock.

   Hours worked, and what they cost against what the shop took. That second part
   is the reason to build it — knowing Tuesday afternoon costs more in wages
   than it makes is worth more than a tidy timesheet.

   Decisions worth stating:

   - A punch is a fact, not a form. Clocking in writes a row; clocking out
     closes it. Editing is possible but always leaves the original visible,
     because a timesheet somebody can silently rewrite is worthless as evidence.

   - Nobody is ever blocked from clocking in. A double punch, a missing punch,
     a shift that runs past midnight — all of these happen weekly in a real
     shop, and the software's job is to record them and flag them, not to
     refuse.

   - Overtime is calculated, never assumed. The threshold is per store, because
     it's a state matter and getting it wrong is a wage claim.
   =========================================================================== */
const db = require("./db");
const { stamp, asDate } = require("./when");

db.exec(`
CREATE TABLE IF NOT EXISTS punches (
  id         INTEGER PRIMARY KEY,
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  who        TEXT NOT NULL,
  in_at      TEXT NOT NULL,
  out_at     TEXT,
  break_mins REAL NOT NULL DEFAULT 0,
  note       TEXT,
  edited_by  TEXT,
  edited_at  TEXT,
  original   TEXT,              -- JSON of what it was before the first edit
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_punch_store ON punches(store_id, in_at DESC);
CREATE INDEX IF NOT EXISTS idx_punch_open ON punches(store_id, who, out_at);

CREATE TABLE IF NOT EXISTS wages (
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  who        TEXT NOT NULL,
  rate       REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_id, who)
);

CREATE TABLE IF NOT EXISTS clock_settings (
  store_id      INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  on_           INTEGER NOT NULL DEFAULT 0,
  week_hours    REAL NOT NULL DEFAULT 40,     -- overtime threshold
  day_hours     REAL,                          -- some states also have a daily one
  ot_multiplier REAL NOT NULL DEFAULT 1.5,
  round_mins    INTEGER NOT NULL DEFAULT 0,    -- 0 = to the minute
  auto_break    REAL NOT NULL DEFAULT 0,       -- minutes deducted past a threshold
  auto_break_after REAL NOT NULL DEFAULT 0     -- hours after which it applies
);
`);

const settings = storeId => db.prepare("SELECT * FROM clock_settings WHERE store_id = ?")
  .get(storeId) || { store_id: storeId, on_: 0, week_hours: 40, day_hours: null,
    ot_multiplier: 1.5, round_mins: 0, auto_break: 0, auto_break_after: 0 };

function setSettings(storeId, s) {
  const cur = settings(storeId);
  const n = { ...cur, ...s };
  db.prepare(
    "INSERT INTO clock_settings (store_id, on_, week_hours, day_hours, ot_multiplier, " +
    "round_mins, auto_break, auto_break_after) VALUES (?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(store_id) DO UPDATE SET on_=excluded.on_, week_hours=excluded.week_hours, " +
    "day_hours=excluded.day_hours, ot_multiplier=excluded.ot_multiplier, " +
    "round_mins=excluded.round_mins, auto_break=excluded.auto_break, " +
    "auto_break_after=excluded.auto_break_after")
    .run(storeId, n.on ?? n.on_ ? 1 : 0, Number(n.week_hours) || 40,
      n.day_hours ? Number(n.day_hours) : null, Number(n.ot_multiplier) || 1.5,
      parseInt(n.round_mins) || 0, Number(n.auto_break) || 0,
      Number(n.auto_break_after) || 0);
}

const wages = storeId => {
  const out = {};
  db.prepare("SELECT who, rate FROM wages WHERE store_id = ?").all(storeId)
    .forEach(r => { out[r.who] = r.rate; });
  return out;
};

const setWage = (storeId, who, rate) =>
  db.prepare("INSERT INTO wages (store_id, who, rate, updated_at) VALUES (?,?,?, datetime('now')) " +
    "ON CONFLICT(store_id, who) DO UPDATE SET rate = excluded.rate, updated_at = datetime('now')")
    .run(storeId, String(who), Number(rate) || 0);

/* --------------------------------- punching -------------------------------- */

const openPunch = (storeId, who) => db.prepare(
  "SELECT * FROM punches WHERE store_id = ? AND who = ? AND out_at IS NULL " +
  "ORDER BY in_at DESC LIMIT 1").get(storeId, String(who));

/* Rounding is applied at the punch, not the report, so what somebody sees on
   the screen when they clock out is what they get paid for. */
function roundTime(iso, mins) {
  const d = new Date(iso);
  if (isNaN(d)) return stamp(iso);
  if (!mins) return stamp(d);
  const ms = mins * 60000;
  return stamp(new Date(Math.round(d.getTime() / ms) * ms));
}

function clockIn(storeId, who, at) {
  const s = settings(storeId);
  const already = openPunch(storeId, who);
  const when = roundTime(at || new Date().toISOString(), s.round_mins);

  /* Never refuse. Somebody who forgot to clock out yesterday still has to start
     work today, and a register that argues gets worked around. */
  if (already) {
    return { ok: true, alreadyIn: true, punch: already,
      warning: "They were already clocked in — that shift is still open." };
  }
  const r = db.prepare("INSERT INTO punches (store_id, who, in_at) VALUES (?,?,?)")
    .run(storeId, String(who), when);
  return { ok: true, id: r.lastInsertRowid, at: when };
}

function clockOut(storeId, who, at, note) {
  const s = settings(storeId);
  const p = openPunch(storeId, who);
  if (!p) return { ok: false, error: "They aren't clocked in." };
  const when = roundTime(at || new Date().toISOString(), s.round_mins);
  if (asDate(when) <= asDate(p.in_at))
    return { ok: false, error: "That's before they clocked in." };

  db.prepare("UPDATE punches SET out_at = ?, note = COALESCE(?, note) WHERE id = ?")
    .run(when, note || null, p.id);
  return { ok: true, id: p.id, ...hoursFor({ ...p, out_at: when }, s) };
}

/* Break deduction and the resulting hours. Kept in one place so the screen, the
   report and the payroll export can't disagree. */
function hoursFor(p, s) {
  if (!p.out_at) return { hours: null, paidHours: null, open: true };
  const raw = (asDate(p.out_at) - asDate(p.in_at)) / 3600000;
  let breakMins = Number(p.break_mins) || 0;
  if (s && s.auto_break > 0 && s.auto_break_after > 0 && raw >= s.auto_break_after)
    breakMins = Math.max(breakMins, s.auto_break);
  const paid = Math.max(0, raw - breakMins / 60);
  return { hours: +raw.toFixed(3), breakMins, paidHours: +paid.toFixed(3), open: false };
}

/* Editing keeps the original. A timesheet that can be quietly rewritten proves
   nothing in a wage dispute. */
function editPunch(storeId, id, patch, who) {
  const p = db.prepare("SELECT * FROM punches WHERE id = ? AND store_id = ?").get(id, storeId);
  if (!p) throw new Error("No such punch.");

  const original = p.original || JSON.stringify({
    in_at: p.in_at, out_at: p.out_at, break_mins: p.break_mins });

  const inAt = stamp(patch.in_at || p.in_at);
  const outAt = patch.out_at === "" ? null
    : (patch.out_at ? stamp(patch.out_at) : p.out_at);
  if (outAt && asDate(outAt) <= asDate(inAt))
    throw new Error("Clocking out has to be after clocking in.");

  db.prepare("UPDATE punches SET in_at = ?, out_at = ?, break_mins = ?, note = ?, " +
    "edited_by = ?, edited_at = datetime('now'), original = ? WHERE id = ?")
    .run(inAt, outAt, Number(patch.break_mins ?? p.break_mins) || 0,
      patch.note ?? p.note, who || null, original, id);
  return { ok: true };
}

function addPunch(storeId, { who, in_at, out_at, break_mins, note }, by) {
  if (!who || !in_at) throw new Error("A punch needs a person and a start time.");
  if (out_at && asDate(out_at) <= asDate(in_at))
    throw new Error("Clocking out has to be after clocking in.");
  const r = db.prepare(
    "INSERT INTO punches (store_id, who, in_at, out_at, break_mins, note, edited_by, edited_at) " +
    "VALUES (?,?,?,?,?,?,?, datetime('now'))")
    .run(storeId, String(who), stamp(in_at), out_at ? stamp(out_at) : null,
      Number(break_mins) || 0,
      note || null, by || null);
  return r.lastInsertRowid;
}

const deletePunch = (storeId, id) =>
  db.prepare("DELETE FROM punches WHERE id = ? AND store_id = ?").run(id, storeId);

/* Who's on the clock right now. */
const onDuty = storeId => db.prepare(
  "SELECT * FROM punches WHERE store_id = ? AND out_at IS NULL ORDER BY in_at").all(storeId)
  .map(p => ({ ...p, minutes: Math.round((Date.now() - asDate(p.in_at)) / 60000) }));

/* --------------------------------- the sheet ------------------------------- */



/* A week starting Monday, because that's what most rotas use. */
function weekStart(dateStr) {
  const d = new Date((dateStr || new Date().toISOString().slice(0, 10)) + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function timesheet(storeId, from, to) {
  const s = settings(storeId);
  const rates = wages(storeId);
  const rows = db.prepare(
    "SELECT * FROM punches WHERE store_id = ? AND in_at >= ? AND in_at <= ? ORDER BY who, in_at")
    .all(storeId, from + " 00:00:00", to + " 23:59:59");

  const byPerson = {};
  const problems = [];

  rows.forEach(p => {
    const h = hoursFor(p, s);
    const e = byPerson[p.who] || (byPerson[p.who] = {
      who: p.who, rate: rates[p.who] ?? null, punches: [], hours: 0, days: new Set() });
    e.punches.push({ ...p, ...h });
    if (h.open) {
      problems.push({ id: p.id, who: p.who, kind: "still open",
        detail: `clocked in ${String(p.in_at).slice(0, 16)} and never out` });
      return;
    }
    if (h.hours > 16)
      problems.push({ id: p.id, who: p.who, kind: "very long",
        detail: `${h.hours.toFixed(1)} hours — probably a missed clock-out` });
    e.hours += h.paidHours;
    e.days.add(String(p.in_at).slice(0, 10));
  });

  /* Overtime is worked out per week, not across the whole range, or a fortnight
     of ordinary weeks would look like overtime. */
  const people = Object.values(byPerson).map(e => {
    const weeks = {};
    e.punches.forEach(p => {
      if (p.open) return;
      const w = weekStart(String(p.in_at).slice(0, 10));
      weeks[w] = (weeks[w] || 0) + p.paidHours;
    });
    let normal = 0, over = 0;
    Object.values(weeks).forEach(h => {
      normal += Math.min(h, s.week_hours);
      over += Math.max(0, h - s.week_hours);
    });
    const rate = e.rate;
    const cost = rate == null ? null
      : +(normal * rate + over * rate * s.ot_multiplier).toFixed(2);
    return {
      who: e.who, rate,
      hours: +e.hours.toFixed(2),
      normalHours: +normal.toFixed(2),
      overtimeHours: +over.toFixed(2),
      days: e.days.size,
      cost,
      punches: e.punches.map(p => ({ id: p.id, in_at: p.in_at, out_at: p.out_at,
        breakMins: p.breakMins, hours: p.hours, paidHours: p.paidHours, open: p.open,
        note: p.note, edited: !!p.edited_at, editedBy: p.edited_by }))
    };
  }).sort((a, b) => b.hours - a.hours);

  const totalHours = people.reduce((a, p) => a + p.hours, 0);
  const costed = people.filter(p => p.cost != null);
  const totalCost = costed.reduce((a, p) => a + p.cost, 0);

  return {
    from, to, people, problems,
    totals: {
      hours: +totalHours.toFixed(2),
      overtime: +people.reduce((a, p) => a + p.overtimeHours, 0).toFixed(2),
      cost: costed.length === people.length ? +totalCost.toFixed(2) : null,
      unratedPeople: people.filter(p => p.rate == null).map(p => p.who)
    }
  };
}

/* -------------------------- labour against takings -------------------------
   The number worth having: what an hour of trading costs in wages against what
   it brought in. */
function labourVsSales(storeId, from, to) {
  const s = settings(storeId);
  const rates = wages(storeId);

  const punches = db.prepare(
    "SELECT * FROM punches WHERE store_id = ? AND out_at IS NOT NULL " +
    "AND in_at <= ? AND out_at >= ?").all(storeId, to + " 23:59:59", from + " 00:00:00");

  /* Wage cost spread across the hours actually worked. A shift from 6 to 14
     puts one hour of cost into each of those slots. */
  const hourCost = Array.from({ length: 24 }, () => 0);
  const hourHours = Array.from({ length: 24 }, () => 0);
  punches.forEach(p => {
    const rate = rates[p.who];
    let t = asDate(p.in_at).getTime();
    const end = asDate(p.out_at).getTime();
    while (t < end) {
      const slot = new Date(t).getHours();
      const next = Math.min(end, new Date(t).setMinutes(60, 0, 0));
      const frac = (next - t) / 3600000;
      hourHours[slot] += frac;
      if (rate != null) hourCost[slot] += frac * rate;
      t = next;
    }
  });

  const sales = Array.from({ length: 24 }, () => ({ n: 0, total: 0 }));
  db.prepare("SELECT at, total FROM sales WHERE store_id = ? AND at >= ? AND at <= ? " +
    "AND is_return = 0").all(storeId, from + " 00:00:00", to + " 23:59:59")
    .forEach(r => {
      const d = asDate(r.at);
      if (isNaN(d)) return;
      sales[d.getHours()].n++;
      sales[d.getHours()].total += r.total;
    });

  const hours = sales.map((sl, h) => {
    const cost = +hourCost[h].toFixed(2);
    const took = +sl.total.toFixed(2);
    return {
      hour: h, sales: sl.n, took, cost,
      staffHours: +hourHours[h].toFixed(2),
      /* Wages as a share of takings. Above about 25% is usually a problem, but
         that's the operator's judgement, not the software's. */
      share: took > 0 ? +(cost / took * 100).toFixed(1) : (cost > 0 ? null : 0),
      losing: cost > 0 && took < cost
    };
  });

  const totalCost = +hourCost.reduce((a, c) => a + c, 0).toFixed(2);
  const totalTook = +sales.reduce((a, s) => a + s.total, 0).toFixed(2);

  return {
    from, to, hours,
    totals: { cost: totalCost, took: totalTook,
      share: totalTook > 0 ? +(totalCost / totalTook * 100).toFixed(1) : null,
      staffHours: +hourHours.reduce((a, h) => a + h, 0).toFixed(2) },
    unrated: [...new Set(punches.filter(p => rates[p.who] == null).map(p => p.who))]
  };
}

/* A flat export for whoever runs payroll. */
function payrollRows(storeId, from, to) {
  const t = timesheet(storeId, from, to);
  return t.people.map(p => ({
    employee: p.who,
    from, to,
    days: p.days,
    normal_hours: p.normalHours.toFixed(2),
    overtime_hours: p.overtimeHours.toFixed(2),
    total_hours: p.hours.toFixed(2),
    rate: p.rate == null ? "" : p.rate.toFixed(2),
    cost: p.cost == null ? "" : p.cost.toFixed(2)
  }));
}

module.exports = { settings, setSettings, wages, setWage,
  clockIn, clockOut, openPunch, onDuty, editPunch, addPunch, deletePunch,
  hoursFor, weekStart, timesheet, labourVsSales, payrollRows };
