/* ===========================================================================
   Forecourt services.

   Money orders, lottery payout and bill pay. Not products — they move cash in
   ways a normal sale doesn't, and getting them wrong shows up as a short
   drawer nobody can explain.

   The three shapes:

     money order   money IN. The customer hands over the face value plus a fee,
                   and gets a printed instrument. The face value is not revenue
                   — it's a liability until the order clears — but the fee is.

     lottery payout money OUT. A winning ticket paid from the drawer. It isn't a
                   refund and it isn't a sale; it reduces cash with no product
                   attached, and it has to reconcile against what the lottery
                   terminal says at the end of the day.

     bill pay      money IN, almost all of which belongs to somebody else. The
                   fee is yours; the rest is held and remitted.

   The thing that ties them together: only the FEE is revenue. Ringing a $500
   money order as a $503 sale inflates takings by five hundred dollars and puts
   the sales tax calculation somewhere absurd.
   =========================================================================== */
const db = require("./db");
const { stamp, dayStart, dayEnd, daysAgo } = require("./when");

db.exec(`
CREATE TABLE IF NOT EXISTS services (
  id         INTEGER PRIMARY KEY,
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,          -- money_order | lottery_payout | bill_pay | check_cash
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  shift_id   INTEGER,
  terminal_id INTEGER,
  who        TEXT,
  face       REAL NOT NULL DEFAULT 0,   -- the amount that isn't yours
  fee        REAL NOT NULL DEFAULT 0,   -- the amount that is
  cash       REAL NOT NULL DEFAULT 0,   -- signed: into the drawer, or out of it
  reference  TEXT,                      -- serial number, ticket number, account
  payee      TEXT,
  biller     TEXT,
  note       TEXT,
  voided     INTEGER NOT NULL DEFAULT 0,
  voided_by  TEXT,
  voided_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_svc_store ON services(store_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_svc_shift ON services(shift_id, kind);

CREATE TABLE IF NOT EXISTS service_settings (
  store_id      INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  money_orders  INTEGER NOT NULL DEFAULT 0,
  mo_fee        REAL NOT NULL DEFAULT 1.50,
  mo_max        REAL NOT NULL DEFAULT 1000,
  lottery       INTEGER NOT NULL DEFAULT 0,
  lotto_max     REAL NOT NULL DEFAULT 600,     -- above this, the state pays
  bill_pay      INTEGER NOT NULL DEFAULT 0,
  bp_fee        REAL NOT NULL DEFAULT 1.50,
  billers       TEXT                            -- JSON array of names
);
`);

const KINDS = {
  money_order:    { label: "Money order", cashIn: true },
  lottery_payout: { label: "Lottery payout", cashIn: false },
  bill_pay:       { label: "Bill payment", cashIn: true },
  check_cash:     { label: "Cheque cashed", cashIn: false }
};

function settings(storeId) {
  const r = db.prepare("SELECT * FROM service_settings WHERE store_id = ?").get(storeId)
    || { store_id: storeId, money_orders: 0, mo_fee: 1.5, mo_max: 1000,
         lottery: 0, lotto_max: 600, bill_pay: 0, bp_fee: 1.5, billers: "[]" };
  let billers = [];
  try { billers = JSON.parse(r.billers || "[]"); } catch (e) {}
  return { ...r, moneyOrders: !!r.money_orders, lottery: !!r.lottery,
    billPay: !!r.bill_pay, billers };
}

function setSettings(storeId, s) {
  const c = settings(storeId);
  const n = { ...c, ...s };
  db.prepare(
    "INSERT INTO service_settings (store_id, money_orders, mo_fee, mo_max, lottery, lotto_max, " +
    "bill_pay, bp_fee, billers) VALUES (?,?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(store_id) DO UPDATE SET money_orders=excluded.money_orders, " +
    "mo_fee=excluded.mo_fee, mo_max=excluded.mo_max, lottery=excluded.lottery, " +
    "lotto_max=excluded.lotto_max, bill_pay=excluded.bill_pay, bp_fee=excluded.bp_fee, " +
    "billers=excluded.billers")
    .run(storeId, n.moneyOrders ? 1 : 0, Number(n.mo_fee) || 0, Number(n.mo_max) || 0,
      n.lottery ? 1 : 0, Number(n.lotto_max) || 0, n.billPay ? 1 : 0,
      Number(n.bp_fee) || 0, JSON.stringify(n.billers || []));
}

/* ------------------------------- recording -------------------------------- */

function record(storeId, kind, data) {
  const k = KINDS[kind];
  if (!k) throw new Error("That isn't a service this handles.");
  const s = settings(storeId);
  const face = Math.abs(Number(data.face) || 0);
  const fee = Math.abs(Number(data.fee) || 0);

  if (kind === "money_order") {
    if (!s.moneyOrders) throw new Error("Money orders aren't switched on for this store.");
    if (face <= 0) throw new Error("A money order needs an amount.");
    if (s.mo_max > 0 && face > s.mo_max)
      throw new Error(`The most this store writes is ${s.mo_max.toFixed(2)}.`);
    if (!data.reference) throw new Error("Put the serial number from the printed order in.");
  }

  if (kind === "lottery_payout") {
    if (!s.lottery) throw new Error("Lottery isn't switched on for this store.");
    if (face <= 0) throw new Error("How much is the ticket worth?");
    /* Above the state's threshold the shop must not pay — the customer claims
       from the lottery directly, and paying anyway is the shop's own money. */
    if (s.lotto_max > 0 && face > s.lotto_max)
      throw new Error(`Anything over ${s.lotto_max.toFixed(2)} is claimed from the state, ` +
        `not paid here.`);
  }

  if (kind === "bill_pay") {
    if (!s.billPay) throw new Error("Bill pay isn't switched on for this store.");
    if (face <= 0) throw new Error("How much is the bill?");
    if (!data.biller) throw new Error("Which biller?");
  }

  /* Cash movement is signed from the drawer's point of view. Money in is
     positive; a payout is negative. Everything downstream reads this rather
     than working it out again. */
  const cash = k.cashIn ? (face + fee) : -(face - fee);

  const r = db.prepare(
    "INSERT INTO services (store_id, kind, shift_id, terminal_id, who, face, fee, cash, " +
    "reference, payee, biller, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(storeId, kind, data.shiftId || null, data.terminalId || null, data.who || null,
      face, fee, +cash.toFixed(2), data.reference || null, data.payee || null,
      data.biller || null, data.note || null);

  return { id: r.lastInsertRowid, kind, face, fee, cash: +cash.toFixed(2),
    label: k.label };
}

/* Voiding rather than deleting: a money order serial that was issued and then
   spoiled still has to be accounted for to the provider. */
function voidService(storeId, id, who, note) {
  const s = db.prepare("SELECT * FROM services WHERE id = ? AND store_id = ?").get(id, storeId);
  if (!s) throw new Error("No such transaction.");
  if (s.voided) throw new Error("That's already void.");
  db.prepare("UPDATE services SET voided = 1, voided_by = ?, voided_at = datetime('now'), " +
    "note = COALESCE(?, note) WHERE id = ?").run(who || null, note || null, id);
  return { ok: true, cashBack: -s.cash };
}

const list = (storeId, { from, to, kind, limit } = {}) => {
  const where = ["store_id = ?"], args = [storeId];
  if (from) { where.push("at >= ?"); args.push(dayStart(from)); }
  if (to) { where.push("at <= ?"); args.push(dayEnd(to)); }
  if (kind) { where.push("kind = ?"); args.push(kind); }
  return db.prepare("SELECT * FROM services WHERE " + where.join(" AND ") +
    " ORDER BY at DESC LIMIT ?").all(...args, Math.min(500, limit || 100))
    .map(r => ({ ...r, voided: !!r.voided, label: (KINDS[r.kind] || {}).label || r.kind }));
};

/* ------------------------------ reconciling --------------------------------
   What these did to the drawer, so a Z read balances. Voided rows contribute
   nothing — they're kept for the paper trail, not the arithmetic. */
function forShift(storeId, shiftId) {
  const rows = db.prepare(
    "SELECT kind, COUNT(*) n, COALESCE(SUM(face),0) face, COALESCE(SUM(fee),0) fee, " +
    "COALESCE(SUM(cash),0) cash FROM services " +
    "WHERE store_id = ? AND shift_id = ? AND voided = 0 GROUP BY kind").all(storeId, shiftId);

  const by = {};
  rows.forEach(r => { by[r.kind] = { ...r, label: (KINDS[r.kind] || {}).label || r.kind,
    face: +r.face.toFixed(2), fee: +r.fee.toFixed(2), cash: +r.cash.toFixed(2) }; });

  const cash = rows.reduce((a, r) => a + r.cash, 0);
  const fees = rows.reduce((a, r) => a + r.fee, 0);
  const held = rows.filter(r => r.kind === "money_order" || r.kind === "bill_pay")
    .reduce((a, r) => a + r.face, 0);

  return {
    byKind: by,
    /* What the drawer should be up or down because of these. */
    cash: +cash.toFixed(2),
    /* The only part that is actually the shop's income. */
    fees: +fees.toFixed(2),
    /* Money taken that belongs to somebody else and has to be remitted. */
    held: +held.toFixed(2),
    voided: db.prepare("SELECT COUNT(*) n FROM services WHERE store_id = ? AND shift_id = ? " +
      "AND voided = 1").get(storeId, shiftId).n
  };
}

/* A day's lottery, to check against the lottery terminal's own report — the
   commonest cause of an unexplained short drawer on a forecourt. */
function lotteryDay(storeId, date) {
  const paid = db.prepare(
    "SELECT COUNT(*) n, COALESCE(SUM(face),0) total FROM services " +
    "WHERE store_id = ? AND kind = 'lottery_payout' AND voided = 0 AND at >= ? AND at <= ?")
    .get(storeId, dayStart(date), dayEnd(date));

  const biggest = db.prepare(
    "SELECT * FROM services WHERE store_id = ? AND kind = 'lottery_payout' AND voided = 0 " +
    "AND at >= ? AND at <= ? ORDER BY face DESC LIMIT 5")
    .all(storeId, dayStart(date), dayEnd(date));

  return { date, count: paid.n, total: +paid.total.toFixed(2), biggest };
}

/* Money orders written but not yet accounted for to the provider. */
function moneyOrderLog(storeId, from, to) {
  const rows = db.prepare(
    "SELECT * FROM services WHERE store_id = ? AND kind = 'money_order' " +
    "AND at >= ? AND at <= ? ORDER BY at").all(storeId, dayStart(from), dayEnd(to));
  const live = rows.filter(r => !r.voided);
  return {
    from, to,
    count: live.length,
    face: +live.reduce((a, r) => a + r.face, 0).toFixed(2),
    fees: +live.reduce((a, r) => a + r.fee, 0).toFixed(2),
    voided: rows.filter(r => r.voided).length,
    rows: rows.map(r => ({ ...r, voided: !!r.voided }))
  };
}

/* Every serial should be one more than the last. A gap means a spoiled form
   nobody recorded, and the provider will ask about it. */
function serialGaps(storeId, from, to) {
  const rows = db.prepare(
    "SELECT reference FROM services WHERE store_id = ? AND kind = 'money_order' " +
    "AND at >= ? AND at <= ? AND reference IS NOT NULL ORDER BY at")
    .all(storeId, dayStart(from), dayEnd(to));

  const nums = rows.map(r => {
    const m = String(r.reference).match(/(\d{4,})\s*$/);
    return m ? Number(m[1]) : null;
  }).filter(n => n != null).sort((a, b) => a - b);

  const gaps = [];
  for (let i = 1; i < nums.length; i++) {
    const jump = nums[i] - nums[i - 1];
    if (jump > 1) gaps.push({ after: nums[i - 1], before: nums[i], missing: jump - 1 });
  }
  return { checked: nums.length, gaps };
}

const summary = (storeId, days) => {
  const since = daysAgo(Math.min(365, Math.max(1, days || 30)));
  return db.prepare(
    "SELECT kind, COUNT(*) n, COALESCE(SUM(face),0) face, COALESCE(SUM(fee),0) fee " +
    "FROM services WHERE store_id = ? AND voided = 0 AND at > ? GROUP BY kind")
    .all(storeId, since)
    .map(r => ({ ...r, label: (KINDS[r.kind] || {}).label || r.kind,
      face: +r.face.toFixed(2), fee: +r.fee.toFixed(2) }));
};

module.exports = { KINDS, settings, setSettings, record, voidService, list,
  forShift, lotteryDay, moneyOrderLog, serialGaps, summary };
