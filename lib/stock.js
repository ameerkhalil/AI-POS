/* ===========================================================================
   Inventory.

   The biggest gap against a real forecourt POS, and the foundation the fuel
   reconciliation sits on: expected against measured is the same idea whether
   it's a case of Monster or ten thousand gallons of unleaded.

   Design decisions worth stating, because they're where inventory systems
   usually go wrong:

   - Stock is a LEDGER, not a number. Every movement is a row: sold, received,
     counted, wasted, returned, adjusted. The quantity on hand is the sum. That
     way "why does it say nine" always has an answer, and a bad count can be
     corrected without inventing a second bad number.

   - A count doesn't set the quantity, it records what was seen. The difference
     against what was expected is the variance, and the variance is the whole
     point — it's the shrink figure.

   - Not everything is tracked. Open-department keys, fuel, services and
     anything sold by weight are excluded, and untracked items simply don't
     produce movements rather than producing wrong ones.

   - Selling below zero is allowed. A cashier at a queue must never be blocked
     by a stock figure, and a negative on hand is useful information — it means
     the receiving didn't get done.
   =========================================================================== */
const db = require("./db");

db.exec(`
CREATE TABLE IF NOT EXISTS stock_moves (
  id         INTEGER PRIMARY KEY,
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  plu_id     TEXT NOT NULL,
  qty        REAL NOT NULL,             -- signed: negative leaves, positive arrives
  kind       TEXT NOT NULL,             -- sold | returned | received | counted | waste | adjust
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  who        TEXT,
  ref        TEXT,                      -- sale seq, invoice number, count id
  cost       REAL,                      -- unit cost at the time, for received lines
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_moves_store ON stock_moves(store_id, plu_id);
CREATE INDEX IF NOT EXISTS idx_moves_at ON stock_moves(store_id, at DESC);

/* Counts are a header plus lines, so a part-finished count can be resumed and
   an old one can still be read back a year later. */
CREATE TABLE IF NOT EXISTS counts (
  id         INTEGER PRIMARY KEY,
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at  TEXT,
  who        TEXT,
  scope      TEXT,                      -- 'all' or a department id
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_counts_store ON counts(store_id, started_at DESC);

CREATE TABLE IF NOT EXISTS count_lines (
  id        INTEGER PRIMARY KEY,
  count_id  INTEGER NOT NULL REFERENCES counts(id) ON DELETE CASCADE,
  plu_id    TEXT NOT NULL,
  expected  REAL NOT NULL,
  counted   REAL NOT NULL,
  cost      REAL,
  UNIQUE(count_id, plu_id)
);

/* Par levels live beside the pricebook rather than in it, so a reorder point is
   a per-store decision — the same product runs out at different speeds in
   different shops. */
CREATE TABLE IF NOT EXISTS stock_settings (
  store_id  INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  plu_id    TEXT NOT NULL,
  par       REAL,                       -- reorder point
  target    REAL,                       -- order up to this
  tracked   INTEGER NOT NULL DEFAULT 1,
  case_qty  REAL,                       -- units per case, for receiving
  PRIMARY KEY (store_id, plu_id)
);
`);

/* ------------------------------ the ledger ------------------------------- */

/* One place that writes movements, so nothing can quietly bypass the ledger. */
const KINDS = new Set(["sold", "returned", "received", "counted", "waste", "adjust"]);

function move(storeId, list) {
  const rows = (Array.isArray(list) ? list : [list]).filter(m => m && m.pluId && m.qty);
  if (!rows.length) return 0;
  const bad = rows.find(m => !KINDS.has(m.kind));
  if (bad) throw new Error(`Unknown stock movement "${bad.kind}"`);

  const stmt = db.prepare(
    "INSERT INTO stock_moves (store_id, plu_id, qty, kind, who, ref, cost, note) " +
    "VALUES (?,?,?,?,?,?,?,?)");
  const tx = db.transaction(() => rows.forEach(m =>
    stmt.run(storeId, String(m.pluId), Number(m.qty), m.kind,
      m.who || null, m.ref == null ? null : String(m.ref),
      m.cost == null ? null : Number(m.cost), m.note || null)));
  tx();
  return rows.length;
}

/* On hand for one item, or for everything at once — the second form matters
   because a pricebook of three thousand lines shouldn't mean three thousand
   queries to draw a screen. */
function onHand(storeId, pluId) {
  const r = db.prepare(
    "SELECT COALESCE(SUM(qty),0) q FROM stock_moves WHERE store_id = ? AND plu_id = ?")
    .get(storeId, String(pluId));
  return +(r.q || 0);
}

function allOnHand(storeId) {
  const out = {};
  db.prepare("SELECT plu_id, COALESCE(SUM(qty),0) q FROM stock_moves WHERE store_id = ? " +
    "GROUP BY plu_id").all(storeId).forEach(r => { out[r.plu_id] = +(r.q || 0); });
  return out;
}

const settings = storeId => {
  const out = {};
  db.prepare("SELECT * FROM stock_settings WHERE store_id = ?").all(storeId)
    .forEach(r => { out[r.plu_id] = r; });
  return out;
};

function setSettings(storeId, pluId, patch) {
  const cur = db.prepare("SELECT * FROM stock_settings WHERE store_id = ? AND plu_id = ?")
    .get(storeId, String(pluId)) || { par: null, target: null, tracked: 1, case_qty: null };
  const next = { ...cur, ...patch };
  db.prepare(
    "INSERT INTO stock_settings (store_id, plu_id, par, target, tracked, case_qty) " +
    "VALUES (?,?,?,?,?,?) ON CONFLICT(store_id, plu_id) DO UPDATE SET " +
    "par = excluded.par, target = excluded.target, tracked = excluded.tracked, " +
    "case_qty = excluded.case_qty")
    .run(storeId, String(pluId),
      next.par == null || next.par === "" ? null : Number(next.par),
      next.target == null || next.target === "" ? null : Number(next.target),
      next.tracked ? 1 : 0,
      next.case_qty == null || next.case_qty === "" ? null : Number(next.case_qty));
}

/* --------------------------- selling and refunding ------------------------
   Called after a sale is recorded, never before: stock should follow money, so
   a payment that fails can't decrement anything. */
function applySale(storeId, sale, isTracked) {
  const rows = [];
  (sale.lines || []).forEach(l => {
    /* Open-department rings, deposits and fuel have no product behind them. */
    if (!l.pluId || l.auto || l.open) return;
    if (isTracked && !isTracked(l.pluId)) return;
    const q = Number(l.q) || 0;
    if (!q) return;
    rows.push({
      pluId: l.pluId,
      qty: sale.ret ? q : -q,
      kind: sale.ret ? "returned" : "sold",
      who: sale.cashier || null,
      ref: sale.seq ?? sale.n ?? null
    });
  });
  return move(storeId, rows);
}

/* ------------------------------- receiving -------------------------------
   Takes what the invoice reader already produces. Cost is recorded on the
   movement rather than only on the product, so last month's margin stays true
   after a price rise. */
function receive(storeId, { who, ref, lines, note }) {
  const rows = (lines || []).filter(l => l && l.pluId && Number(l.qty))
    .map(l => ({
      pluId: l.pluId,
      qty: Math.abs(Number(l.qty)) * (Number(l.caseQty) > 1 ? Number(l.caseQty) : 1),
      kind: "received",
      who, ref,
      cost: l.cost == null ? null : Number(l.cost),
      note: l.note || null
    }));
  const n = move(storeId, rows);
  return { received: n, units: rows.reduce((a, r) => a + r.qty, 0) };
}

/* --------------------------------- counts --------------------------------- */

function openCount(storeId, { who, scope, note }) {
  const r = db.prepare("INSERT INTO counts (store_id, who, scope, note) VALUES (?,?,?,?)")
    .run(storeId, who || null, scope || "all", note || null);
  return r.lastInsertRowid;
}

/* A line records what was expected at the moment of counting and what was seen.
   Recording expected now, rather than deriving it at close, means a sale during
   the count doesn't retroactively turn into shrink. */
function countLine(storeId, countId, pluId, counted, cost) {
  const expected = onHand(storeId, pluId);
  db.prepare(
    "INSERT INTO count_lines (count_id, plu_id, expected, counted, cost) VALUES (?,?,?,?,?) " +
    "ON CONFLICT(count_id, plu_id) DO UPDATE SET expected = excluded.expected, " +
    "counted = excluded.counted, cost = excluded.cost")
    .run(countId, String(pluId), expected, Number(counted) || 0,
      cost == null ? null : Number(cost));
  return { expected, counted: Number(counted) || 0, variance: (Number(counted) || 0) - expected };
}

/* Closing writes one adjusting movement per line that differs. The ledger keeps
   both numbers, so a count can be explained months later. */
function closeCount(storeId, countId, who) {
  const c = db.prepare("SELECT * FROM counts WHERE id = ? AND store_id = ?").get(countId, storeId);
  if (!c) throw new Error("No such count.");
  if (c.closed_at) throw new Error("That count is already closed.");

  const lines = db.prepare("SELECT * FROM count_lines WHERE count_id = ?").all(countId);
  const rows = [];
  let shrinkUnits = 0, shrinkValue = 0;

  lines.forEach(l => {
    const diff = +(l.counted - l.expected).toFixed(4);
    if (!diff) return;
    rows.push({ pluId: l.plu_id, qty: diff, kind: "counted", who,
      ref: "count:" + countId,
      note: `counted ${l.counted}, expected ${l.expected}` });
    if (diff < 0) { shrinkUnits += -diff; shrinkValue += -diff * (l.cost || 0); }
  });

  move(storeId, rows);
  db.prepare("UPDATE counts SET closed_at = datetime('now') WHERE id = ?").run(countId);

  return {
    lines: lines.length,
    adjusted: rows.length,
    shrinkUnits: +shrinkUnits.toFixed(2),
    shrinkValue: +shrinkValue.toFixed(2)
  };
}

const countDetail = (storeId, countId) => ({
  count: db.prepare("SELECT * FROM counts WHERE id = ? AND store_id = ?").get(countId, storeId),
  lines: db.prepare("SELECT * FROM count_lines WHERE count_id = ? ORDER BY id").all(countId)
});

const recentCounts = storeId => db.prepare(
  "SELECT c.*, (SELECT COUNT(*) FROM count_lines l WHERE l.count_id = c.id) AS lines " +
  "FROM counts c WHERE store_id = ? ORDER BY started_at DESC LIMIT 20").all(storeId);

/* --------------------------------- views ---------------------------------- */

/* What to order. Anything at or below its par, with how many to bring it up to
   target — rounded up to whole cases where a case size is known, because
   nobody orders three-sevenths of a case. */
function reorder(storeId, plus) {
  const stock = allOnHand(storeId);
  const set = settings(storeId);
  const out = [];
  plus.forEach(p => {
    const s = set[p.id];
    if (!s || !s.tracked || s.par == null) return;
    const have = stock[p.id] || 0;
    if (have > s.par) return;
    const target = s.target != null ? s.target : s.par;
    let need = Math.max(0, target - have);
    let cases = null;
    if (s.case_qty > 1) { cases = Math.ceil(need / s.case_qty); need = cases * s.case_qty; }
    out.push({ pluId: p.id, name: p.n, upc: p.upc, dept: p.deptId,
      have, par: s.par, target, need, cases, caseQty: s.case_qty || null,
      cost: p.cost || null, value: p.cost ? +(need * p.cost).toFixed(2) : null });
  });
  return out.sort((a, b) => (a.have - a.par) - (b.have - b.par));
}

/* The whole picture for one product: where the stock went, in order. */
const history = (storeId, pluId, limit) => db.prepare(
  "SELECT * FROM stock_moves WHERE store_id = ? AND plu_id = ? ORDER BY at DESC, id DESC LIMIT ?")
  .all(storeId, String(pluId), Math.min(500, limit || 100));

/* Shrink over a window, by reason. Counted losses and waste are different
   problems — one is unexplained, the other was written down. */
function shrink(storeId, days) {
  const n = Math.min(365, Math.max(1, days || 30));
  const rows = db.prepare(
    "SELECT kind, plu_id, COALESCE(SUM(qty),0) q FROM stock_moves " +
    "WHERE store_id = ? AND at > datetime('now', ?) AND kind IN ('counted','waste') " +
    "GROUP BY kind, plu_id").all(storeId, `-${n} days`);

  const byPlu = {};
  let countedUnits = 0, wasteUnits = 0;
  rows.forEach(r => {
    if (r.q >= 0 && r.kind === "counted") return;      // a positive count is an over, not shrink
    const units = r.kind === "waste" ? Math.abs(r.q) : Math.max(0, -r.q);
    if (!units) return;
    byPlu[r.plu_id] = byPlu[r.plu_id] || { pluId: r.plu_id, counted: 0, waste: 0 };
    byPlu[r.plu_id][r.kind === "waste" ? "waste" : "counted"] += units;
    if (r.kind === "waste") wasteUnits += units; else countedUnits += units;
  });
  return { days: n, countedUnits: +countedUnits.toFixed(2), wasteUnits: +wasteUnits.toFixed(2),
    byPlu: Object.values(byPlu) };
}

/* What the stock on the shelf is worth, at cost. */
function valuation(storeId, plus) {
  const stock = allOnHand(storeId);
  const set = settings(storeId);
  let atCost = 0, atRetail = 0, units = 0, missingCost = 0;
  const negatives = [];
  plus.forEach(p => {
    const s = set[p.id];
    if (s && !s.tracked) return;
    const q = stock[p.id] || 0;
    if (!q) return;
    if (q < 0) negatives.push({ pluId: p.id, name: p.n, q });
    units += q;
    if (p.cost > 0) atCost += q * p.cost; else if (q > 0) missingCost++;
    atRetail += q * (p.price || 0);
  });
  return { units: +units.toFixed(2), atCost: +atCost.toFixed(2), atRetail: +atRetail.toFixed(2),
    missingCost, negatives };
}

module.exports = { move, onHand, allOnHand, settings, setSettings, applySale, receive,
  openCount, countLine, closeCount, countDetail, recentCounts,
  reorder, history, shrink, valuation };
