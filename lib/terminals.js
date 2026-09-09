/* ===========================================================================
   Terminals.

   Until now a register was an island: its own shift, its own drawer, its own
   idea of the pricebook. A shop with two lanes needs one shift and one Z read
   across both, but two drawers — because there are physically two of them and
   each is counted by a different person.

   So:

     terminal    a register. Registered once, then identified by a token it
                 keeps. Heartbeats say it's alive and what build it runs.

     shift       belongs to the STORE. Every terminal rings into the same one,
                 so a Z read covers the whole shop.

     drawer      belongs to a terminal within a shift. Opened, counted and
                 closed independently, because two cashiers can't share one
                 physical till.

   The heartbeat doubles as fleet visibility: last seen, build, and whether it
   has unsynced sales is exactly what you want when somebody phones up.
   =========================================================================== */
const crypto = require("crypto");
const db = require("./db");

db.exec(`
CREATE TABLE IF NOT EXISTS terminals (
  id         INTEGER PRIMARY KEY,
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  number     INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT,
  build      TEXT,
  agent      INTEGER NOT NULL DEFAULT 0,   -- station agent reachable
  queued     INTEGER NOT NULL DEFAULT 0,   -- sales waiting to sync
  ua         TEXT,
  ip         TEXT,
  retired    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_term_store ON terminals(store_id, retired);

/* One drawer per terminal per shift. */
CREATE TABLE IF NOT EXISTS drawers (
  id          INTEGER PRIMARY KEY,
  shift_id    INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  terminal_id INTEGER NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
  opened_at   TEXT NOT NULL DEFAULT (datetime('now')),
  opened_by   TEXT,
  start_cash  REAL NOT NULL DEFAULT 0,
  closed_at   TEXT,
  closed_by   TEXT,
  counted     REAL,
  paid_in     REAL NOT NULL DEFAULT 0,
  paid_out    REAL NOT NULL DEFAULT 0,
  drops       REAL NOT NULL DEFAULT 0,
  UNIQUE(shift_id, terminal_id)
);
`);

/* sales gained a terminal after the fact, so add the column if it's missing. */
(function migrate() {
  const cols = db.prepare("PRAGMA table_info(sales)").all().map(c => c.name);
  if (!cols.includes("terminal_id")) db.exec("ALTER TABLE sales ADD COLUMN terminal_id INTEGER");
})();

/* ------------------------------ registering ------------------------------ */

/* A terminal registers once and keeps its token. Numbers fill gaps left by
   retired registers, so a shop that has replaced lane 2 gets 2 back rather than
   creeping up to 7. */
function register(storeId, { name, ua, ip }) {
  const used = new Set(db.prepare("SELECT number FROM terminals WHERE store_id = ? AND retired = 0")
    .all(storeId).map(r => r.number));
  let n = 1;
  while (used.has(n)) n++;

  const token = crypto.randomBytes(24).toString("hex");
  const r = db.prepare(
    "INSERT INTO terminals (store_id, token, name, number, last_seen, ua, ip) " +
    "VALUES (?,?,?,?, datetime('now'), ?, ?)")
    .run(storeId, token, String(name || `Register ${n}`).slice(0, 40), n,
      String(ua || "").slice(0, 200), String(ip || "").slice(0, 60));
  return { id: r.lastInsertRowid, token, number: n, name: String(name || `Register ${n}`) };
}

const byToken = token => token
  ? db.prepare("SELECT * FROM terminals WHERE token = ?").get(String(token)) : null;

const list = storeId => db.prepare(
  "SELECT id, name, number, created_at, last_seen, build, agent, queued, retired " +
  "FROM terminals WHERE store_id = ? ORDER BY retired, number").all(storeId);

function rename(storeId, id, name) {
  db.prepare("UPDATE terminals SET name = ? WHERE id = ? AND store_id = ?")
    .run(String(name || "").slice(0, 40) || "Register", id, storeId);
}

/* Retiring rather than deleting: a terminal's sales still have to make sense
   in a report from six months ago. */
function retire(storeId, id) {
  const open = db.prepare(
    "SELECT d.id FROM drawers d JOIN shifts s ON s.id = d.shift_id " +
    "WHERE d.terminal_id = ? AND d.closed_at IS NULL AND s.closed_at IS NULL").get(id);
  if (open) throw new Error("That register still has an open drawer. Close it first.");
  db.prepare("UPDATE terminals SET retired = 1 WHERE id = ? AND store_id = ?").run(id, storeId);
}

function heartbeat(terminalId, { build, agent, queued, ip }) {
  db.prepare(
    "UPDATE terminals SET last_seen = datetime('now'), build = ?, agent = ?, queued = ?, ip = ? " +
    "WHERE id = ?")
    .run(build ? String(build).slice(0, 40) : null, agent ? 1 : 0,
      Number(queued) || 0, String(ip || "").slice(0, 60), terminalId);
}

/* ------------------------------ the shift -------------------------------
   One per store. Whichever terminal opens first creates it; the rest join. */

const openShift = storeId => db.prepare(
  "SELECT * FROM shifts WHERE store_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1")
  .get(storeId);

function joinShift(storeId, terminalId, { who, startCash }) {
  let shift = openShift(storeId);
  let created = false;
  if (!shift) {
    const r = db.prepare(
      "INSERT INTO shifts (store_id, opened_at, opened_by, start_cash) " +
      "VALUES (?, datetime('now'), ?, 0)").run(storeId, who || null);
    shift = db.prepare("SELECT * FROM shifts WHERE id = ?").get(r.lastInsertRowid);
    created = true;
  }

  let drawer = db.prepare("SELECT * FROM drawers WHERE shift_id = ? AND terminal_id = ?")
    .get(shift.id, terminalId);
  if (!drawer) {
    db.prepare(
      "INSERT INTO drawers (shift_id, terminal_id, opened_by, start_cash) VALUES (?,?,?,?)")
      .run(shift.id, terminalId, who || null, Number(startCash) || 0);
    drawer = db.prepare("SELECT * FROM drawers WHERE shift_id = ? AND terminal_id = ?")
      .get(shift.id, terminalId);
  } else if (drawer.closed_at) {
    throw new Error("This register's drawer was already counted and closed for this shift.");
  }

  return { shift, drawer, createdShift: created };
}

const drawerMovement = (drawerId, kind, amount) => {
  const col = { in: "paid_in", out: "paid_out", drop: "drops" }[kind];
  if (!col) throw new Error("Unknown drawer movement.");
  db.prepare(`UPDATE drawers SET ${col} = ${col} + ? WHERE id = ?`)
    .run(Math.abs(Number(amount) || 0), drawerId);
};

/* What one drawer should hold: what it started with, plus the cash it took,
   plus pay-ins, minus pay-outs and safe drops. */
function drawerExpected(shiftId, terminalId) {
  const d = db.prepare("SELECT * FROM drawers WHERE shift_id = ? AND terminal_id = ?")
    .get(shiftId, terminalId);
  if (!d) return null;

  /* Cash taken is read from the sale itself, because a card sale doesn't put
     anything in the drawer and a split payment only puts part of it in. */
  const rows = db.prepare(
    "SELECT json, is_return FROM sales WHERE shift_id = ? AND terminal_id = ?")
    .all(shiftId, terminalId);
  let cash = 0;
  rows.forEach(r => {
    let s = {};
    try { s = JSON.parse(r.json); } catch (e) { return; }
    (s.pays || []).forEach(p => {
      if (!/cash/i.test(p.mop || "")) return;
      /* "amt" is the part of the sale settled in cash. The customer may have
         handed over more and taken change, but tendered-minus-change is amt
         again — so counting amt alone is right, and subtracting change on top
         would take the change out of the drawer twice.

         A refund pays out, so it carries a negative amount. */
      const amt = Number(p.amt) || 0;
      cash += s.ret ? -Math.abs(amt) : amt;
    });
  });

  const expected = d.start_cash + cash + d.paid_in - d.paid_out - d.drops;
  return { ...d, cash: +cash.toFixed(2), expected: +expected.toFixed(2),
    over: d.counted == null ? null : +(d.counted - expected).toFixed(2) };
}

function closeDrawer(shiftId, terminalId, { counted, who }) {
  const d = db.prepare("SELECT * FROM drawers WHERE shift_id = ? AND terminal_id = ?")
    .get(shiftId, terminalId);
  if (!d) throw new Error("No drawer open on this register for this shift.");
  if (d.closed_at) throw new Error("That drawer is already closed.");
  db.prepare("UPDATE drawers SET closed_at = datetime('now'), closed_by = ?, counted = ? WHERE id = ?")
    .run(who || null, Number(counted) || 0, d.id);
  return drawerExpected(shiftId, terminalId);
}

/* The shift can only close once every drawer in it has been counted —
   otherwise the store total is missing a till. */
function closeShift(storeId, shiftId, who) {
  const s = db.prepare("SELECT * FROM shifts WHERE id = ? AND store_id = ?").get(shiftId, storeId);
  if (!s) throw new Error("No such shift.");
  if (s.closed_at) throw new Error("That shift is already closed.");

  const open = db.prepare(
    "SELECT t.name FROM drawers d JOIN terminals t ON t.id = d.terminal_id " +
    "WHERE d.shift_id = ? AND d.closed_at IS NULL").all(shiftId);
  if (open.length)
    throw new Error(`Still open: ${open.map(o => o.name).join(", ")}. Count ${
      open.length === 1 ? "that drawer" : "those drawers"} first.`);

  db.prepare("UPDATE shifts SET closed_at = datetime('now') WHERE id = ?").run(shiftId);
  return shiftSummary(storeId, shiftId);
}

/* One shift, every terminal in it, and the store total. */
function shiftSummary(storeId, shiftId) {
  const shift = db.prepare("SELECT * FROM shifts WHERE id = ? AND store_id = ?")
    .get(shiftId, storeId);
  if (!shift) return null;

  const drawers = db.prepare(
    "SELECT d.*, t.name, t.number FROM drawers d JOIN terminals t ON t.id = d.terminal_id " +
    "WHERE d.shift_id = ? ORDER BY t.number").all(shiftId)
    .map(d => ({ ...d, ...drawerExpected(shiftId, d.terminal_id) }));

  const totals = db.prepare(
    "SELECT COUNT(*) n, COALESCE(SUM(total),0) total, " +
    "SUM(CASE WHEN is_return = 1 THEN 1 ELSE 0 END) returns " +
    "FROM sales WHERE shift_id = ?").get(shiftId);

  const byTerminal = db.prepare(
    "SELECT s.terminal_id, t.name, COUNT(*) n, COALESCE(SUM(s.total),0) total " +
    "FROM sales s LEFT JOIN terminals t ON t.id = s.terminal_id " +
    "WHERE s.shift_id = ? GROUP BY s.terminal_id ORDER BY t.number").all(shiftId);

  return {
    shift, drawers, totals, byTerminal,
    expected: +drawers.reduce((a, d) => a + (d.expected || 0), 0).toFixed(2),
    counted: drawers.every(d => d.counted != null)
      ? +drawers.reduce((a, d) => a + (d.counted || 0), 0).toFixed(2) : null,
    over: drawers.every(d => d.counted != null)
      ? +drawers.reduce((a, d) => a + (d.over || 0), 0).toFixed(2) : null
  };
}

/* --------------------------- fleet visibility ---------------------------
   The same heartbeat, read from the other end. */
function health(storeIds) {
  const rows = db.prepare(
    "SELECT t.*, s.name AS store_name, s.account_id FROM terminals t " +
    "JOIN stores s ON s.id = t.store_id WHERE t.retired = 0 ORDER BY s.id, t.number").all();

  const now = Date.now();
  return rows
    .filter(t => !storeIds || storeIds.includes(t.store_id))
    .map(t => {
      const seen = t.last_seen ? Date.parse(t.last_seen.replace(" ", "T") + "Z") : null;
      const mins = seen ? Math.round((now - seen) / 60000) : null;
      return {
        id: t.id, store_id: t.store_id, store: t.store_name, name: t.name, number: t.number,
        build: t.build, agent: !!t.agent, queued: t.queued,
        lastSeen: t.last_seen, minsAgo: mins,
        /* Under five minutes is live, under an hour is probably just closed,
           beyond that somebody should look. */
        state: mins == null ? "never" : mins < 5 ? "live" : mins < 60 ? "idle" : "gone"
      };
    });
}

module.exports = { register, byToken, list, rename, retire, heartbeat,
  openShift, joinShift, drawerMovement, drawerExpected, closeDrawer, closeShift,
  shiftSummary, health };
