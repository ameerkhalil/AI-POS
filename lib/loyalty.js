/* ===========================================================================
   Loyalty.

   A points balance is a promise to hand over money later, so it's kept the same
   way stock is: a ledger of every movement, with the balance as the sum. A
   loyalty scheme where the balance can be edited directly is a loyalty scheme
   that gets stolen from.

   The parts:

     earn        points from a sale, at a rate the shop sets. Excluded
                 departments earn nothing — nobody wants to give points on
                 lottery or fuel they make a cent on.

     redeem      points spent, in whole blocks, capped at what the sale is
                 worth. Never below zero, never on credit.

     offers      a rule that fires when it's satisfied — buy nine coffees, get
                 the tenth. Progress is counted from the ledger, so it survives
                 a refund correctly.

     the usual   what this person actually buys, so a cashier can offer it
                 without asking.
   =========================================================================== */
const db = require("./db");

/* An older database won't have the digits column. */
function ensureColumn(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY,
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name       TEXT,
  phone      TEXT,
  email      TEXT,
  card       TEXT,
  digits     TEXT,          -- phone with everything but the digits removed
  note       TEXT,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT,
  archived   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cust_store ON customers(store_id, archived);
CREATE INDEX IF NOT EXISTS idx_cust_phone ON customers(store_id, digits);
CREATE INDEX IF NOT EXISTS idx_cust_card ON customers(store_id, card);

CREATE TABLE IF NOT EXISTS points (
  id          INTEGER PRIMARY KEY,
  store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,        -- signed
  kind        TEXT NOT NULL,           -- earned | redeemed | adjusted | expired | reversed
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  who         TEXT,
  ref         TEXT,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_points_cust ON points(customer_id, at DESC);

CREATE TABLE IF NOT EXISTS loyalty_settings (
  store_id     INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  on_          INTEGER NOT NULL DEFAULT 0,
  per_pound    REAL NOT NULL DEFAULT 1,      -- points earned per unit of currency
  point_value  REAL NOT NULL DEFAULT 0.01,   -- what one point is worth when spent
  block        INTEGER NOT NULL DEFAULT 100, -- points must be spent in blocks of this
  excluded     TEXT,                          -- JSON array of department ids
  expire_days  INTEGER
);

/* An offer is a rule, stored as data so adding one is configuration. */
CREATE TABLE IF NOT EXISTS offers (
  id         INTEGER PRIMARY KEY,
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'stamp',  -- stamp | spend
  plu_ids    TEXT,                            -- JSON array, for stamp offers
  need       REAL NOT NULL,                   -- stamps needed, or amount to spend
  reward     TEXT,                            -- words shown to the cashier
  reward_plu TEXT,                            -- what to give free, if a product
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offer_progress (
  offer_id    INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  count       REAL NOT NULL DEFAULT 0,
  redeemed    INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (offer_id, customer_id)
);
`);

try { ensureColumn("customers", "digits", "TEXT"); } catch (e) {}
/* A sale remembers who bought it, so an existing database needs the column
   before any of the queries below will run. */
try { ensureColumn("sales", "customer_id", "INTEGER"); } catch (e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id)"); }
catch (e) {}

const DEFAULTS = { on_: 0, per_pound: 1, point_value: 0.01, block: 100, excluded: "[]",
  expire_days: null };

function settings(storeId) {
  const r = db.prepare("SELECT * FROM loyalty_settings WHERE store_id = ?").get(storeId)
    || { store_id: storeId, ...DEFAULTS };
  let excluded = [];
  try { excluded = JSON.parse(r.excluded || "[]"); } catch (e) {}
  return { ...r, on: !!r.on_, excluded };
}

function setSettings(storeId, s) {
  const cur = settings(storeId);
  const next = { ...cur, ...s };
  db.prepare(
    "INSERT INTO loyalty_settings (store_id, on_, per_pound, point_value, block, excluded, expire_days) " +
    "VALUES (?,?,?,?,?,?,?) ON CONFLICT(store_id) DO UPDATE SET " +
    "on_=excluded.on_, per_pound=excluded.per_pound, point_value=excluded.point_value, " +
    "block=excluded.block, excluded=excluded.excluded, expire_days=excluded.expire_days")
    .run(storeId, next.on ? 1 : 0, Number(next.per_pound) || 0,
      Number(next.point_value) || 0, Math.max(1, parseInt(next.block) || 1),
      JSON.stringify(next.excluded || []),
      next.expire_days ? parseInt(next.expire_days) : null);
}

/* ------------------------------- customers ------------------------------- */

function saveCustomer(storeId, c) {
  const clean = k => c[k] == null ? null : String(c[k]).slice(0, 120).trim() || null;
  const phone = clean("phone"), card = clean("card");
  /* SQLite has no regular expressions, so the comparable form of a phone number
     is worked out here and stored. Trying to strip punctuation inside the query
     meant "(708) 555-0142" and "7085550142" were different people. */
  const digits = phone ? phone.replace(/\D/g, "") : null;
  if (!clean("name") && !phone && !card)
    throw new Error("A customer needs at least a name, a phone number or a card.");

  /* Two people sharing a phone number makes every lookup ambiguous. */
  const clash = digits ? db.prepare(
    "SELECT id FROM customers WHERE store_id = ? AND digits = ? AND id != ?")
    .get(storeId, digits, c.id || 0) : null;
  if (clash) throw new Error("Another customer already has that phone number.");

  if (c.id) {
    db.prepare("UPDATE customers SET name=?, phone=?, digits=?, email=?, card=?, note=? " +
      "WHERE id = ? AND store_id = ?")
      .run(clean("name"), phone, digits, clean("email"), card, clean("note"), c.id, storeId);
    return c.id;
  }
  const r = db.prepare(
    "INSERT INTO customers (store_id, name, phone, digits, email, card, note) " +
    "VALUES (?,?,?,?,?,?,?)")
    .run(storeId, clean("name"), phone, digits, clean("email"), card, clean("note"));
  return r.lastInsertRowid;
}

/* Lookup at the till: a phone number, a card swipe, or part of a name. */
function find(storeId, q) {
  const s = String(q || "").trim();
  if (s.length < 3) return [];
  const digits = s.replace(/\D/g, "");
  const rows = db.prepare(
    "SELECT * FROM customers WHERE store_id = ? AND archived = 0 AND (" +
    "card = ? OR (length(?) >= 7 AND digits LIKE ?) OR lower(name) LIKE ?) " +
    "ORDER BY last_seen DESC LIMIT 20")
    .all(storeId, s, digits, "%" + digits + "%", "%" + s.toLowerCase() + "%");
  return rows.map(c => ({ ...c, balance: balance(c.id) }));
}

const customer = (storeId, id) => {
  const c = db.prepare("SELECT * FROM customers WHERE id = ? AND store_id = ?").get(id, storeId);
  return c ? { ...c, balance: balance(id) } : null;
};

const balance = customerId => {
  const r = db.prepare("SELECT COALESCE(SUM(amount),0) b FROM points WHERE customer_id = ?")
    .get(customerId);
  return Math.round(r.b || 0);
};

const pointHistory = (customerId, limit) => db.prepare(
  "SELECT * FROM points WHERE customer_id = ? ORDER BY at DESC, id DESC LIMIT ?")
  .all(customerId, Math.min(200, limit || 50));

/* --------------------------------- points -------------------------------- */

const KINDS = new Set(["earned", "redeemed", "adjusted", "expired", "reversed"]);

function movePoints(storeId, customerId, list) {
  const rows = (Array.isArray(list) ? list : [list]).filter(m => m && m.amount);
  const bad = rows.find(m => !KINDS.has(m.kind));
  if (bad) throw new Error(`Unknown points movement "${bad.kind}"`);
  const stmt = db.prepare(
    "INSERT INTO points (store_id, customer_id, amount, kind, who, ref, note) VALUES (?,?,?,?,?,?,?)");
  const tx = db.transaction(() => rows.forEach(m =>
    stmt.run(storeId, customerId, Math.round(Number(m.amount)), m.kind,
      m.who || null, m.ref == null ? null : String(m.ref), m.note || null)));
  tx();
  return rows.length;
}

/* What a sale earns. Excluded departments and the redeemed part of the sale
   earn nothing — otherwise points buy points. */
function earnedFor(storeId, sale) {
  const s = settings(storeId);
  if (!s.on || !s.per_pound) return 0;
  if (sale.ret) return 0;
  let eligible = 0;
  (sale.lines || []).forEach(l => {
    if (l.auto) return;
    if (s.excluded.includes(l.deptId)) return;
    eligible += (Number(l.price) || 0) * (Number(l.q) || 0) * (1 - (Number(l.disc) || 0) / 100);
  });
  return Math.max(0, Math.floor(eligible * s.per_pound));
}

/* Applied after the sale is recorded, so a failed payment awards nothing. */
function applySale(storeId, customerId, sale) {
  if (!customerId) return { earned: 0 };
  const s = settings(storeId);
  if (!s.on) return { earned: 0 };

  if (sale.ret) {
    /* A refund takes back what the original earned, but never past zero — a
       customer shouldn't end up owing points because they returned a jumper. */
    const back = Math.min(balance(customerId), earnedFor(storeId, { ...sale, ret: false }));
    if (back > 0) movePoints(storeId, customerId, { amount: -back, kind: "reversed",
      ref: sale.seq ?? sale.n, note: "refund" });
    db.prepare("UPDATE customers SET last_seen = datetime('now') WHERE id = ?").run(customerId);
    /* Stamps come back off too. Returning ten coffees and keeping the free one
       is the most obvious way to work a stamp card. */
    advanceOffers(storeId, customerId, sale);
    return { earned: 0, reversed: back };
  }

  const earned = earnedFor(storeId, sale);
  if (earned) movePoints(storeId, customerId, { amount: earned, kind: "earned",
    who: sale.cashier, ref: sale.seq ?? sale.n });
  db.prepare("UPDATE customers SET last_seen = datetime('now') WHERE id = ?").run(customerId);

  const fired = advanceOffers(storeId, customerId, sale);
  return { earned, balance: balance(customerId), offers: fired };
}

/* How much a customer can take off this sale, and what it costs them. */
function quote(storeId, customerId, saleTotal) {
  const s = settings(storeId);
  const have = balance(customerId);
  if (!s.on || !s.point_value || have < s.block) return { points: 0, value: 0, have };

  const blocks = Math.floor(have / s.block);
  const maxValue = blocks * s.block * s.point_value;
  /* Never more than the sale is worth — points don't pay out as cash. */
  const value = Math.min(maxValue, Math.max(0, Number(saleTotal) || 0));
  const usable = Math.floor(value / s.point_value / s.block) * s.block;
  return { points: usable, value: +(usable * s.point_value).toFixed(2), have,
    block: s.block, pointValue: s.point_value };
}

function redeem(storeId, customerId, points, { who, ref, saleTotal }) {
  const s = settings(storeId);
  const want = Math.round(Number(points) || 0);
  if (want <= 0) throw new Error("Nothing to redeem.");
  if (want % s.block) throw new Error(`Points are spent in blocks of ${s.block}.`);
  const have = balance(customerId);
  if (want > have) throw new Error(`They only have ${have} points.`);
  const value = +(want * s.point_value).toFixed(2);
  if (saleTotal != null && value > Number(saleTotal) + 0.001)
    throw new Error("That's more than the sale is worth.");
  movePoints(storeId, customerId, { amount: -want, kind: "redeemed", who, ref });
  return { points: want, value, balance: balance(customerId) };
}

/* --------------------------------- offers -------------------------------- */

function saveOffer(storeId, o) {
  const pluIds = JSON.stringify(Array.isArray(o.pluIds) ? o.pluIds : []);
  if (!o.name || !String(o.name).trim()) throw new Error("An offer needs a name.");
  if (!(Number(o.need) > 0)) throw new Error("Set how many are needed.");
  if (o.id) {
    db.prepare("UPDATE offers SET name=?, kind=?, plu_ids=?, need=?, reward=?, reward_plu=?, " +
      "active=? WHERE id = ? AND store_id = ?")
      .run(String(o.name), o.kind === "spend" ? "spend" : "stamp", pluIds, Number(o.need),
        o.reward || null, o.rewardPlu || null, o.active === false ? 0 : 1, o.id, storeId);
    return o.id;
  }
  const r = db.prepare(
    "INSERT INTO offers (store_id, name, kind, plu_ids, need, reward, reward_plu, active) " +
    "VALUES (?,?,?,?,?,?,?,?)")
    .run(storeId, String(o.name), o.kind === "spend" ? "spend" : "stamp", pluIds,
      Number(o.need), o.reward || null, o.rewardPlu || null, o.active === false ? 0 : 1);
  return r.lastInsertRowid;
}

const offers = (storeId, activeOnly) => db.prepare(
  "SELECT * FROM offers WHERE store_id = ?" + (activeOnly ? " AND active = 1" : "") +
  " ORDER BY active DESC, id").all(storeId)
  .map(o => { let p = []; try { p = JSON.parse(o.plu_ids || "[]"); } catch (e) {}
    return { ...o, pluIds: p, active: !!o.active }; });

const deleteOffer = (storeId, id) =>
  db.prepare("DELETE FROM offers WHERE id = ? AND store_id = ?").run(id, storeId);

/* Move every offer along for this sale, and report any that are now complete. */
function advanceOffers(storeId, customerId, sale) {
  const list = offers(storeId, true);
  if (!list.length) return [];
  const fired = [];

  list.forEach(o => {
    let add = 0;
    if (o.kind === "stamp") {
      (sale.lines || []).forEach(l => {
        if (l.pluId && o.pluIds.includes(l.pluId)) add += Number(l.q) || 0;
      });
    } else {
      add = (sale.lines || []).reduce((a, l) =>
        a + (Number(l.price) || 0) * (Number(l.q) || 0), 0);
    }
    if (!add) return;

    const sign = sale.ret ? -1 : 1;
    db.prepare(
      "INSERT INTO offer_progress (offer_id, customer_id, count) VALUES (?,?,?) " +
      "ON CONFLICT(offer_id, customer_id) DO UPDATE SET " +
      "count = MAX(0, offer_progress.count + ?), updated_at = datetime('now')")
      .run(o.id, customerId, Math.max(0, add * sign), add * sign);

    const p = db.prepare("SELECT * FROM offer_progress WHERE offer_id = ? AND customer_id = ?")
      .get(o.id, customerId);
    if (p && p.count >= o.need)
      fired.push({ offerId: o.id, name: o.name, reward: o.reward,
        rewardPlu: o.reward_plu, count: p.count, need: o.need });
  });

  return fired;
}

/* Claiming subtracts the requirement rather than zeroing the count, so the
   tenth coffee doesn't wipe an eleventh already bought. */
function claimOffer(storeId, offerId, customerId, who) {
  const o = db.prepare("SELECT * FROM offers WHERE id = ? AND store_id = ?").get(offerId, storeId);
  if (!o) throw new Error("No such offer.");
  const p = db.prepare("SELECT * FROM offer_progress WHERE offer_id = ? AND customer_id = ?")
    .get(offerId, customerId);
  if (!p || p.count < o.need) throw new Error("They haven't reached that yet.");
  db.prepare("UPDATE offer_progress SET count = count - ?, redeemed = redeemed + 1, " +
    "updated_at = datetime('now') WHERE offer_id = ? AND customer_id = ?")
    .run(o.need, offerId, customerId);
  return { ok: true, left: p.count - o.need };
}

const progressFor = (storeId, customerId) => {
  const list = offers(storeId, true);
  const rows = {};
  db.prepare("SELECT * FROM offer_progress WHERE customer_id = ?").all(customerId)
    .forEach(p => { rows[p.offer_id] = p; });
  return list.map(o => {
    const p = rows[o.id] || { count: 0 };
    return { id: o.id, name: o.name, kind: o.kind, need: o.need, reward: o.reward,
      rewardPlu: o.reward_plu, count: +p.count.toFixed(2),
      ready: p.count >= o.need };
  });
};

/* ------------------------------- the usual -------------------------------
   What this person actually buys, from their own history. */
function usual(storeId, customerId, limit) {
  const rows = db.prepare(
    "SELECT json FROM sales WHERE store_id = ? AND customer_id = ? " +
    "ORDER BY at DESC LIMIT 60").all(storeId, customerId);
  const by = {};
  rows.forEach(r => {
    let s = {};
    try { s = JSON.parse(r.json); } catch (e) { return; }
    if (s.ret) return;
    (s.lines || []).forEach(l => {
      if (!l.pluId) return;
      const e = by[l.pluId] || (by[l.pluId] = { pluId: l.pluId, name: l.n, times: 0, qty: 0 });
      e.times++;
      e.qty += Number(l.q) || 0;
      e.name = l.n || e.name;
    });
  });
  return Object.values(by).sort((a, b) => b.times - a.times)
    .slice(0, Math.min(20, limit || 6));
}

/* Who's worth knowing about, and who's stopped coming. */
function topCustomers(storeId, days) {
  const n = Math.min(730, Math.max(1, days || 90));
  return db.prepare(
    "SELECT c.id, c.name, c.phone, COUNT(s.id) visits, COALESCE(SUM(s.total),0) spend, " +
    "MAX(s.at) last_visit FROM customers c " +
    "JOIN sales s ON s.customer_id = c.id AND s.at > datetime('now', ?) " +
    "WHERE c.store_id = ? AND c.archived = 0 " +
    "GROUP BY c.id ORDER BY spend DESC LIMIT 50").all(`-${n} days`, storeId)
    .map(r => ({ ...r, spend: +r.spend.toFixed(2), balance: balance(r.id) }));
}

function lapsed(storeId, days) {
  const n = Math.min(365, Math.max(7, days || 60));
  return db.prepare(
    "SELECT c.id, c.name, c.phone, c.last_seen, " +
    "(SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) visits " +
    "FROM customers c WHERE c.store_id = ? AND c.archived = 0 " +
    "AND c.last_seen IS NOT NULL AND c.last_seen < datetime('now', ?) " +
    "ORDER BY c.last_seen DESC LIMIT 50").all(storeId, `-${n} days`)
    .filter(c => c.visits >= 3)     /* somebody who came twice hasn't lapsed */
    .map(c => ({ ...c, balance: balance(c.id) }));
}

module.exports = { settings, setSettings, saveCustomer, find, customer, balance,
  pointHistory, movePoints, earnedFor, applySale, quote, redeem,
  saveOffer, offers, deleteOffer, advanceOffers, claimOffer, progressFor,
  usual, topCustomers, lapsed };
