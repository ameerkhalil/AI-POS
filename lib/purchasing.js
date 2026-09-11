/* ===========================================================================
   Vendors and purchase orders.

   An order is a promise about stock that hasn't arrived yet, which is the piece
   the inventory ledger deliberately doesn't hold — the ledger only records what
   actually moved. So an order lives here until it's received, and receiving it
   writes movements through the same path a manual delivery does.

   The parts that matter:

   - Receiving is PARTIAL by default. Deliveries arrive short, and a system that
     only accepts "all of it" gets worked around within a week.

   - An order remembers what was ordered and what arrived, separately. The gap
     is a short delivery and it stays visible, because that's what you argue
     with a rep about.

   - Cost on the order is what you expected to pay. Cost on receipt is what you
     were actually charged. Keeping both is how a price rise gets noticed.
   =========================================================================== */
const db = require("./db");
const { daysAgo, now, asDate } = require("./when");
const STOCK = require("./stock");

db.exec(`
CREATE TABLE IF NOT EXISTS vendors (
  id        INTEGER PRIMARY KEY,
  store_id  INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  rep       TEXT,
  phone     TEXT,
  email     TEXT,
  account   TEXT,
  terms     TEXT,
  delivers  TEXT,
  note      TEXT,
  archived  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vendor_store ON vendors(store_id, archived);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id         INTEGER PRIMARY KEY,
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  vendor_id  INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  ref        TEXT,
  state      TEXT NOT NULL DEFAULT 'draft',   -- draft | sent | part | received | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at    TEXT,
  due_at     TEXT,
  closed_at  TEXT,
  who        TEXT,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_po_store ON purchase_orders(store_id, state);

CREATE TABLE IF NOT EXISTS po_lines (
  id        INTEGER PRIMARY KEY,
  po_id     INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  plu_id    TEXT NOT NULL,
  name      TEXT,
  ordered   REAL NOT NULL,
  received  REAL NOT NULL DEFAULT 0,
  case_qty  REAL,
  cost      REAL,                     -- expected unit cost
  paid      REAL,                     -- what was actually charged, once received
  UNIQUE(po_id, plu_id)
);

/* Each delivery against an order, so three part-deliveries read as three. */
CREATE TABLE IF NOT EXISTS po_receipts (
  id        INTEGER PRIMARY KEY,
  po_id     INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  who       TEXT,
  invoice   TEXT,
  note      TEXT
);
`);

/* --------------------------------- vendors -------------------------------- */
const FIELDS = ["name", "rep", "phone", "email", "account", "terms", "delivers", "note"];

function saveVendor(storeId, v) {
  const clean = {};
  FIELDS.forEach(f => { clean[f] = v[f] == null ? null : String(v[f]).slice(0, 200); });
  if (!clean.name || !clean.name.trim()) throw new Error("A vendor needs a name.");

  if (v.id) {
    db.prepare(
      "UPDATE vendors SET name=?, rep=?, phone=?, email=?, account=?, terms=?, delivers=?, note=? " +
      "WHERE id = ? AND store_id = ?")
      .run(...FIELDS.map(f => clean[f]), v.id, storeId);
    return v.id;
  }
  const r = db.prepare(
    "INSERT INTO vendors (store_id, name, rep, phone, email, account, terms, delivers, note) " +
    "VALUES (?,?,?,?,?,?,?,?,?)").run(storeId, ...FIELDS.map(f => clean[f]));
  return r.lastInsertRowid;
}

const vendors = (storeId, includeArchived) => db.prepare(
  "SELECT * FROM vendors WHERE store_id = ?" + (includeArchived ? "" : " AND archived = 0") +
  " ORDER BY archived, name").all(storeId);

const archiveVendor = (storeId, id, on) =>
  db.prepare("UPDATE vendors SET archived = ? WHERE id = ? AND store_id = ?")
    .run(on ? 1 : 0, id, storeId);

/* ------------------------------ the orders -------------------------------- */

function createOrder(storeId, { vendorId, ref, who, note, due, lines }) {
  const r = db.prepare(
    "INSERT INTO purchase_orders (store_id, vendor_id, ref, who, note, due_at) VALUES (?,?,?,?,?,?)")
    .run(storeId, vendorId || null, ref || null, who || null, note || null, due || null);
  const id = r.lastInsertRowid;
  setLines(storeId, id, lines || []);
  return id;
}

/* Replaces the whole line set, which is what an edit screen actually does.
   Anything already received is kept, because you can't un-receive by editing. */
function setLines(storeId, poId, lines) {
  const po = getOrder(storeId, poId);
  if (!po) throw new Error("No such order.");
  if (po.state === "received" || po.state === "cancelled")
    throw new Error("That order is closed.");

  const existing = {};
  db.prepare("SELECT plu_id, received, paid FROM po_lines WHERE po_id = ?").all(poId)
    .forEach(l => { existing[l.plu_id] = l; });

  const keep = new Set();
  const up = db.prepare(
    "INSERT INTO po_lines (po_id, plu_id, name, ordered, received, case_qty, cost, paid) " +
    "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(po_id, plu_id) DO UPDATE SET " +
    "name = excluded.name, ordered = excluded.ordered, case_qty = excluded.case_qty, " +
    "cost = excluded.cost");

  const tx = db.transaction(() => {
    lines.filter(l => l && l.pluId && Number(l.ordered) > 0).forEach(l => {
      keep.add(String(l.pluId));
      const prev = existing[l.pluId] || {};
      up.run(poId, String(l.pluId), l.name || null, Number(l.ordered),
        prev.received || 0, l.caseQty ? Number(l.caseQty) : null,
        l.cost == null || l.cost === "" ? null : Number(l.cost), prev.paid ?? null);
    });
    /* A line that has already had stock delivered can't just vanish. */
    Object.keys(existing).forEach(pluId => {
      if (keep.has(pluId)) return;
      if ((existing[pluId].received || 0) > 0) return;
      db.prepare("DELETE FROM po_lines WHERE po_id = ? AND plu_id = ?").run(poId, pluId);
    });
  });
  tx();
}

const getOrder = (storeId, id) =>
  db.prepare("SELECT * FROM purchase_orders WHERE id = ? AND store_id = ?").get(id, storeId);

function order(storeId, id) {
  const po = getOrder(storeId, id);
  if (!po) return null;
  const lines = db.prepare("SELECT * FROM po_lines WHERE po_id = ? ORDER BY id").all(id);
  const receipts = db.prepare("SELECT * FROM po_receipts WHERE po_id = ? ORDER BY at").all(id);
  const vendor = po.vendor_id
    ? db.prepare("SELECT * FROM vendors WHERE id = ?").get(po.vendor_id) : null;
  return { ...po, vendor, lines: lines.map(withTotals), receipts, ...totals(lines) };
}

const withTotals = l => ({
  ...l,
  outstanding: +Math.max(0, l.ordered - l.received).toFixed(3),
  value: +((l.ordered) * (l.cost || 0)).toFixed(2),
  short: l.received > 0 && l.received < l.ordered
});

function totals(lines) {
  const ordered = lines.reduce((a, l) => a + l.ordered, 0);
  const received = lines.reduce((a, l) => a + l.received, 0);
  const expected = lines.reduce((a, l) => a + l.ordered * (l.cost || 0), 0);
  const charged = lines.reduce((a, l) => a + l.received * (l.paid ?? l.cost ?? 0), 0);
  return {
    unitsOrdered: +ordered.toFixed(2),
    unitsReceived: +received.toFixed(2),
    expectedCost: +expected.toFixed(2),
    chargedCost: +charged.toFixed(2),
    complete: lines.length > 0 && lines.every(l => l.received >= l.ordered)
  };
}

function send(storeId, id, who) {
  const po = getOrder(storeId, id);
  if (!po) throw new Error("No such order.");
  if (po.state !== "draft") throw new Error("Only a draft can be sent.");
  const n = db.prepare("SELECT COUNT(*) n FROM po_lines WHERE po_id = ?").get(id).n;
  if (!n) throw new Error("There's nothing on that order.");
  db.prepare("UPDATE purchase_orders SET state='sent', sent_at=datetime('now'), who=COALESCE(who,?) " +
    "WHERE id = ?").run(who || null, id);
  return order(storeId, id);
}

function cancel(storeId, id) {
  const po = getOrder(storeId, id);
  if (!po) throw new Error("No such order.");
  if (po.state === "received") throw new Error("That order has already been received.");
  const got = db.prepare("SELECT COALESCE(SUM(received),0) r FROM po_lines WHERE po_id = ?").get(id).r;
  if (got > 0) throw new Error("Part of that order has already arrived, so it can't be cancelled.");
  db.prepare("UPDATE purchase_orders SET state='cancelled', closed_at=datetime('now') WHERE id = ?")
    .run(id);
}

/* ------------------------------- receiving --------------------------------
   The only place an order touches stock. Writes through the ledger so a
   delivery against an order and one typed in by hand are the same thing
   afterwards. */
function receiveOrder(storeId, id, { who, invoice, note, lines }) {
  const po = getOrder(storeId, id);
  if (!po) throw new Error("No such order.");
  if (po.state === "cancelled") throw new Error("That order was cancelled.");
  if (po.state === "draft") throw new Error("Send the order before receiving against it.");

  const current = {};
  db.prepare("SELECT * FROM po_lines WHERE po_id = ?").all(id)
    .forEach(l => { current[l.plu_id] = l; });

  const moves = [];
  const wanted = (lines || []).filter(l => l && l.pluId && Number(l.qty) > 0);
  if (!wanted.length) throw new Error("Nothing to receive.");

  const rec = db.prepare("INSERT INTO po_receipts (po_id, who, invoice, note) VALUES (?,?,?,?)")
    .run(id, who || null, invoice || null, note || null);
  const receiptId = rec.lastInsertRowid;

  const tx = db.transaction(() => {
    wanted.forEach(l => {
      const line = current[l.pluId];
      if (!line) throw new Error(`${l.pluId} isn't on that order.`);
      /* Units, not cases: the order stores units and so does the ledger. */
      const units = Number(l.qty) * (Number(l.caseQty) > 1 ? Number(l.caseQty) : 1);
      const paid = l.cost == null || l.cost === "" ? null : Number(l.cost);
      db.prepare("UPDATE po_lines SET received = received + ?, paid = COALESCE(?, paid) " +
        "WHERE id = ?").run(units, paid, line.id);
      moves.push({ pluId: l.pluId, qty: units, kind: "received", who,
        ref: invoice || po.ref || ("PO-" + id),
        cost: paid ?? line.cost ?? null,
        note: "PO-" + id });
    });
  });
  tx();
  STOCK.move(storeId, moves);

  const after = db.prepare("SELECT * FROM po_lines WHERE po_id = ?").all(id);
  const t = totals(after);
  const state = t.complete ? "received" : "part";
  db.prepare("UPDATE purchase_orders SET state = ?, closed_at = ? WHERE id = ?")
    .run(state, t.complete ? now() : null, id);

  return { receiptId, state, ...t, order: order(storeId, id) };
}

/* --------------------------------- views ---------------------------------- */

const list = (storeId, state) => db.prepare(
  "SELECT p.*, v.name AS vendor_name, " +
  "(SELECT COUNT(*) FROM po_lines l WHERE l.po_id = p.id) AS lines, " +
  "(SELECT COALESCE(SUM(l.ordered * COALESCE(l.cost,0)),0) FROM po_lines l WHERE l.po_id = p.id) AS value " +
  "FROM purchase_orders p LEFT JOIN vendors v ON v.id = p.vendor_id " +
  "WHERE p.store_id = ?" + (state ? " AND p.state = ?" : "") +
  " ORDER BY p.created_at DESC LIMIT 100").all(...(state ? [storeId, state] : [storeId]));

/* What's promised but hasn't turned up — the number that stops you ordering
   the same pallet twice. */
function onOrder(storeId) {
  const rows = db.prepare(
    "SELECT l.plu_id, COALESCE(SUM(l.ordered - l.received),0) q FROM po_lines l " +
    "JOIN purchase_orders p ON p.id = l.po_id " +
    "WHERE p.store_id = ? AND p.state IN ('sent','part') GROUP BY l.plu_id").all(storeId);
  const out = {};
  rows.forEach(r => { if (r.q > 0) out[r.plu_id] = +r.q.toFixed(2); });
  return out;
}

/* Orders sent and not fully delivered, oldest first — the chase list. */
function outstanding(storeId) {
  return list(storeId).filter(p => p.state === "sent" || p.state === "part")
    .map(p => {
      const o = order(storeId, p.id);
      const due = p.due_at ? Date.parse(p.due_at + "T00:00:00Z") : null;
      return { ...p, unitsOrdered: o.unitsOrdered, unitsReceived: o.unitsReceived,
        shortLines: o.lines.filter(l => l.outstanding > 0).length,
        overdue: due != null && due < Date.now() };
    })
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

/* What one vendor costs and how reliably they deliver. */
function vendorSummary(storeId, vendorId, days) {
  const n = Math.min(730, Math.max(1, days || 180));
  const orders = db.prepare(
    "SELECT * FROM purchase_orders WHERE store_id = ? AND vendor_id = ? " +
    "AND created_at > datetime('now', ?)").all(storeId, vendorId, `-${n} days`);

  let spend = 0, ordered = 0, received = 0, shortOrders = 0;
  orders.forEach(p => {
    const lines = db.prepare("SELECT * FROM po_lines WHERE po_id = ?").all(p.id);
    const t = totals(lines);
    spend += t.chargedCost;
    ordered += t.unitsOrdered;
    received += t.unitsReceived;
    if (p.state === "part" || (p.state === "received" && !t.complete)) shortOrders++;
  });

  return {
    days: n, orders: orders.length,
    spend: +spend.toFixed(2),
    unitsOrdered: +ordered.toFixed(2), unitsReceived: +received.toFixed(2),
    fillRate: ordered ? +(received / ordered * 100).toFixed(1) : null,
    shortOrders
  };
}

/* Turn the reorder list straight into draft orders, one per vendor where a
   vendor is known and one catch-all otherwise. */
function fromReorder(storeId, { who, items, vendorOf }) {
  const groups = {};
  (items || []).forEach(i => {
    const v = (vendorOf || {})[i.pluId] || "none";
    (groups[v] = groups[v] || []).push(i);
  });
  return Object.entries(groups).map(([v, list]) => ({
    vendorId: v === "none" ? null : Number(v),
    id: createOrder(storeId, {
      vendorId: v === "none" ? null : Number(v), who,
      note: "Built from the reorder list",
      lines: list.map(i => ({ pluId: i.pluId, name: i.name, ordered: i.need,
        caseQty: i.caseQty, cost: i.cost }))
    })
  }));
}

module.exports = { saveVendor, vendors, archiveVendor,
  createOrder, setLines, order, list, send, cancel, receiveOrder,
  onOrder, outstanding, vendorSummary, fromReorder };
