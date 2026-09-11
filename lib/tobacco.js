/* ===========================================================================
   Tobacco scan data.

   Manufacturers pay for a monthly file of what you sold: which item, how many,
   at what price, and what promotion was applied. Getting paid depends on the
   file matching their layout exactly, and those layouts come from Altria,
   Reynolds and ITG rather than from me — so this module does NOT invent one.

   What it does instead is capture the data properly, which is the part that
   can't be added retrospectively. A month of sales with no buydown recorded is
   a month you can't claim for, no matter what format you learn later.

   So:

     enrolment    which manufacturer, which outlet number, which programme.
     buydowns     a funded discount: manufacturer pays you back per pack.
     capture      every tobacco line, with the promotion that applied to it.
     export       a generic, documented layout plus a CSV, ready to be mapped
                  to a real specification when one arrives.

   The multipack rule matters and is easy to get wrong: a "2 for $8" on packs
   priced $4.49 is a $0.98 funded discount, and the manufacturer reimburses per
   unit, not per transaction.
   =========================================================================== */
const db = require("./db");
const { stamp } = require("./when");

db.exec(`
CREATE TABLE IF NOT EXISTS tobacco_settings (
  store_id   INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  on_        INTEGER NOT NULL DEFAULT 0,
  outlets    TEXT,           -- JSON: { altria: "12345", reynolds: "...", itg: "..." }
  dept_ids   TEXT,           -- JSON array of departments that count as tobacco
  note       TEXT
);

/* A funded discount. The manufacturer sets the amount and the period; the shop
   applies it at the till and claims it back. */
CREATE TABLE IF NOT EXISTS buydowns (
  id         INTEGER PRIMARY KEY,
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  maker      TEXT NOT NULL,             -- altria | reynolds | itg | other
  name       TEXT NOT NULL,
  plu_ids    TEXT NOT NULL,             -- JSON array
  kind       TEXT NOT NULL DEFAULT 'per_unit',   -- per_unit | multipack
  amount     REAL NOT NULL DEFAULT 0,   -- per unit funded, for per_unit
  qty        INTEGER,                   -- multipack: buy this many
  price      REAL,                      -- multipack: for this price
  starts     TEXT,
  ends       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_buy_store ON buydowns(store_id, active);

/* One row per tobacco line sold. Deliberately flat and denormalised: this is
   what gets exported, and it must not change when somebody edits a price two
   months later. */
CREATE TABLE IF NOT EXISTS tobacco_lines (
  id          INTEGER PRIMARY KEY,
  store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  sale_seq    INTEGER,
  terminal_id INTEGER,
  cashier     TEXT,
  plu_id      TEXT NOT NULL,
  upc         TEXT,
  name        TEXT,
  qty         REAL NOT NULL,
  unit_price  REAL NOT NULL,            -- shelf price before any discount
  paid        REAL NOT NULL,            -- what the customer actually paid, total
  funded      REAL NOT NULL DEFAULT 0,  -- what the manufacturer owes on this line
  buydown_id  INTEGER,
  maker       TEXT,
  is_return   INTEGER NOT NULL DEFAULT 0,
  age_checked TEXT                      -- scan | eye | null
);
CREATE INDEX IF NOT EXISTS idx_tob_store ON tobacco_lines(store_id, at);
CREATE INDEX IF NOT EXISTS idx_tob_maker ON tobacco_lines(store_id, maker, at);
`);

const MAKERS = ["altria", "reynolds", "itg", "other"];

function settings(storeId) {
  const r = db.prepare("SELECT * FROM tobacco_settings WHERE store_id = ?").get(storeId)
    || { store_id: storeId, on_: 0, outlets: "{}", dept_ids: "[]", note: null };
  const j = (s, d) => { try { return JSON.parse(s || d); } catch (e) { return JSON.parse(d); } };
  return { ...r, on: !!r.on_, outlets: j(r.outlets, "{}"), deptIds: j(r.dept_ids, "[]") };
}

function setSettings(storeId, s) {
  const cur = settings(storeId);
  const next = { ...cur, ...s };
  db.prepare(
    "INSERT INTO tobacco_settings (store_id, on_, outlets, dept_ids, note) VALUES (?,?,?,?,?) " +
    "ON CONFLICT(store_id) DO UPDATE SET on_=excluded.on_, outlets=excluded.outlets, " +
    "dept_ids=excluded.dept_ids, note=excluded.note")
    .run(storeId, next.on ? 1 : 0, JSON.stringify(next.outlets || {}),
      JSON.stringify(next.deptIds || []), next.note || null);
}

/* -------------------------------- buydowns -------------------------------- */

function saveBuydown(storeId, b) {
  if (!b.name || !String(b.name).trim()) throw new Error("A buydown needs a name.");
  if (!MAKERS.includes(b.maker)) throw new Error("Pick a manufacturer.");
  const plus = Array.isArray(b.pluIds) ? b.pluIds : [];
  if (!plus.length) throw new Error("Pick at least one product.");
  const kind = b.kind === "multipack" ? "multipack" : "per_unit";
  if (kind === "multipack") {
    if (!(Number(b.qty) > 1)) throw new Error("A multipack needs a quantity of two or more.");
    if (!(Number(b.price) > 0)) throw new Error("A multipack needs a price.");
  } else if (!(Number(b.amount) > 0)) throw new Error("Set the funded amount per unit.");

  const args = [String(b.name).slice(0, 120), b.maker, JSON.stringify(plus), kind,
    Number(b.amount) || 0, b.qty ? parseInt(b.qty) : null, b.price ? Number(b.price) : null,
    b.starts || null, b.ends || null, b.active === false ? 0 : 1];

  if (b.id) {
    db.prepare("UPDATE buydowns SET name=?, maker=?, plu_ids=?, kind=?, amount=?, qty=?, price=?, " +
      "starts=?, ends=?, active=? WHERE id = ? AND store_id = ?").run(...args, b.id, storeId);
    return b.id;
  }
  const r = db.prepare("INSERT INTO buydowns (store_id, name, maker, plu_ids, kind, amount, qty, " +
    "price, starts, ends, active) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(storeId, ...args);
  return r.lastInsertRowid;
}

const buydowns = (storeId, onlyActive) => db.prepare(
  "SELECT * FROM buydowns WHERE store_id = ?" + (onlyActive ? " AND active = 1" : "") +
  " ORDER BY active DESC, maker, name").all(storeId)
  .map(b => { let p = []; try { p = JSON.parse(b.plu_ids || "[]"); } catch (e) {}
    return { ...b, pluIds: p, active: !!b.active }; });

const deleteBuydown = (storeId, id) =>
  db.prepare("DELETE FROM buydowns WHERE id = ? AND store_id = ?").run(id, storeId);

/* In date and switched on. A buydown that ended last week must stop applying by
   itself — nobody remembers to turn them off. */
function live(storeId, when) {
  const day = (when ? new Date(when) : new Date()).toISOString().slice(0, 10);
  return buydowns(storeId, true).filter(b =>
    (!b.starts || b.starts <= day) && (!b.ends || b.ends >= day));
}

/* What a cashier should see when a tobacco item is rung: any deal that applies,
   in words. */
function offersFor(storeId, pluId, qty) {
  return live(storeId).filter(b => b.pluIds.includes(pluId)).map(b => ({
    id: b.id, name: b.name, maker: b.maker,
    kind: b.kind,
    text: b.kind === "multipack"
      ? `${b.qty} for ${b.price.toFixed(2)}`
      : `${b.amount.toFixed(2)} off each`,
    ready: b.kind !== "multipack" || (Number(qty) || 0) >= b.qty
  }));
}

/* --------------------------- what the sale funded --------------------------
   Works out, per line, how much of the discount the manufacturer is paying.
   Kept separate from applying it so it can be shown before it's committed. */
function fundedFor(storeId, sale) {
  const set = settings(storeId);
  if (!set.on) return [];
  const active = live(storeId, sale.at);
  if (!active.length && !set.deptIds.length) return [];

  const out = [];
  (sale.lines || []).forEach(l => {
    if (!l.pluId) return;
    const isTobacco = set.deptIds.includes(l.deptId)
      || active.some(b => b.pluIds.includes(l.pluId));
    if (!isTobacco) return;

    const qty = Number(l.q) || 0;
    const shelf = Number(l.price) || 0;
    if (!qty) return;

    let funded = 0, used = null;
    const applies = active.filter(b => b.pluIds.includes(l.pluId));

    applies.forEach(b => {
      if (funded) return;                       /* one buydown per line */
      if (b.kind === "per_unit") {
        funded = +(b.amount * qty).toFixed(4);
        used = b;
      } else {
        /* A "2 for 8" on 4.49 packs funds 0.98 across the pair — and only for
           whole sets, so three packs claim one set, not one and a half. */
        const sets = Math.floor(qty / b.qty);
        if (!sets) return;
        const per = shelf * b.qty - b.price;
        if (per <= 0) return;
        funded = +(per * sets).toFixed(4);
        used = b;
      }
    });

    out.push({
      pluId: l.pluId, upc: l.upc || null, name: l.n || null,
      qty, unitPrice: shelf,
      paid: +(shelf * qty * (1 - (Number(l.disc) || 0) / 100)).toFixed(2),
      funded, buydownId: used ? used.id : null,
      maker: used ? used.maker : null,
      ageChecked: l.idCheck ? l.idCheck.by : null
    });
  });
  return out;
}

/* Written after the sale is recorded, once, alongside stock and points. */
function applySale(storeId, sale) {
  const lines = fundedFor(storeId, sale);
  if (!lines.length) return { lines: 0, funded: 0 };
  const stmt = db.prepare(
    "INSERT INTO tobacco_lines (store_id, at, sale_seq, terminal_id, cashier, plu_id, upc, name, " +
    "qty, unit_price, paid, funded, buydown_id, maker, is_return, age_checked) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const sign = sale.ret ? -1 : 1;
  const tx = db.transaction(() => lines.forEach(l =>
    stmt.run(storeId, stamp(sale.at), sale.seq ?? sale.n ?? null,
      sale.terminalId || null, sale.cashier || null, l.pluId, l.upc, l.name,
      l.qty * sign, l.unitPrice, l.paid * sign, l.funded * sign,
      l.buydownId, l.maker, sale.ret ? 1 : 0, l.ageChecked)));
  tx();
  return { lines: lines.length,
    funded: +lines.reduce((a, l) => a + l.funded, 0).toFixed(2) };
}

/* ---------------------------------- claims --------------------------------
   What each manufacturer owes for a period, and the detail behind it. */
function claim(storeId, maker, from, to) {
  /* Built per query with the table spelled out. Prefixing a shared clause with
     "t." only qualifies the first column in it, and both tables have a "maker"
     — which made the joined query ambiguous and threw. */
  const clause = t => `${t}store_id = ? AND ${t}at >= ? AND ${t}at <= ?` +
    (maker ? ` AND ${t}maker = ?` : "");
  const args = maker ? [storeId, from, to, maker] : [storeId, from, to];

  const totals = db.prepare(
    "SELECT COUNT(*) lines, COALESCE(SUM(qty),0) units, COALESCE(SUM(paid),0) paid, " +
    "COALESCE(SUM(funded),0) funded FROM tobacco_lines WHERE " + clause("")).get(...args);

  const byBuydown = db.prepare(
    "SELECT t.buydown_id, b.name, b.maker, COALESCE(SUM(t.qty),0) units, " +
    "COALESCE(SUM(t.funded),0) funded FROM tobacco_lines t " +
    "LEFT JOIN buydowns b ON b.id = t.buydown_id WHERE " + clause("t.") +
    " AND t.buydown_id IS NOT NULL GROUP BY t.buydown_id ORDER BY funded DESC").all(...args);

  const byItem = db.prepare(
    "SELECT plu_id, upc, name, COALESCE(SUM(qty),0) units, COALESCE(SUM(paid),0) paid, " +
    "COALESCE(SUM(funded),0) funded FROM tobacco_lines WHERE " + clause("") +
    " GROUP BY plu_id ORDER BY units DESC").all(...args);

  return {
    maker: maker || "all", from, to,
    lines: totals.lines,
    units: +totals.units.toFixed(2),
    paid: +totals.paid.toFixed(2),
    funded: +totals.funded.toFixed(2),
    byBuydown: byBuydown.map(r => ({ ...r, units: +r.units.toFixed(2),
      funded: +r.funded.toFixed(2) })),
    byItem: byItem.map(r => ({ ...r, units: +r.units.toFixed(2), paid: +r.paid.toFixed(2),
      funded: +r.funded.toFixed(2) }))
  };
}

/* An export in a documented generic layout. Not any manufacturer's format —
   there is no point guessing at one — but every field they ask for is here, so
   mapping it to a real spec is a rename rather than a rebuild. */
const COLUMNS = [
  ["outlet", "The outlet number the manufacturer issued you"],
  ["date", "YYYY-MM-DD of the sale"],
  ["time", "HH:MM:SS of the sale"],
  ["register", "Which lane rang it"],
  ["transaction", "Sale number on that lane"],
  ["upc", "Item barcode as scanned"],
  ["description", "Item name at the time of sale"],
  ["quantity", "Units, negative for a return"],
  ["unit_price", "Shelf price before any discount"],
  ["amount_paid", "What the customer actually paid for this line"],
  ["manufacturer_funded", "The part of the discount the manufacturer owes"],
  ["promotion", "Name of the buydown applied, if any"],
  ["age_verified", "scan, eye or blank"]
];

function exportRows(storeId, maker, from, to) {
  const set = settings(storeId);
  const outlet = (set.outlets || {})[maker] || "";
  const rows = db.prepare(
    "SELECT t.*, b.name AS promo FROM tobacco_lines t LEFT JOIN buydowns b ON b.id = t.buydown_id " +
    "WHERE t.store_id = ? AND t.at >= ? AND t.at <= ?" +
    (maker && maker !== "all" ? " AND t.maker = ?" : "") + " ORDER BY t.at, t.id")
    .all(...(maker && maker !== "all" ? [storeId, from, to, maker] : [storeId, from, to]));

  return rows.map(r => {
    const at = String(r.at).replace("T", " ");
    return {
      outlet,
      date: at.slice(0, 10),
      time: at.slice(11, 19) || "00:00:00",
      register: r.terminal_id || "",
      transaction: r.sale_seq || "",
      upc: r.upc || "",
      description: r.name || "",
      quantity: r.qty,
      unit_price: r.unit_price.toFixed(2),
      amount_paid: r.paid.toFixed(2),
      manufacturer_funded: r.funded.toFixed(2),
      promotion: r.promo || "",
      age_verified: r.age_checked || ""
    };
  });
}

function toCSV(rows) {
  const head = COLUMNS.map(c => c[0]);
  const esc = v => {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [head.join(",")]
    .concat(rows.map(r => head.map(h => esc(r[h])).join(",")))
    .join("\r\n");     /* CRLF: these files are read by very old systems */
}

/* Anything that would get a file rejected, said before it's sent. */
function checkReady(storeId, maker, from, to) {
  const set = settings(storeId);
  const problems = [];
  if (!set.on) problems.push("Tobacco capture is switched off, so nothing has been recorded.");
  if (maker && maker !== "all" && !(set.outlets || {})[maker])
    problems.push(`No outlet number set for ${maker} — the file will be rejected without it.`);
  const rows = db.prepare(
    "SELECT COUNT(*) n, SUM(CASE WHEN upc IS NULL OR upc = '' THEN 1 ELSE 0 END) noUpc " +
    "FROM tobacco_lines WHERE store_id = ? AND at >= ? AND at <= ?" +
    (maker && maker !== "all" ? " AND maker = ?" : ""))
    .get(...(maker && maker !== "all" ? [storeId, from, to, maker] : [storeId, from, to]));
  if (!rows.n) problems.push("No tobacco lines were recorded in that period.");
  if (rows.noUpc) problems.push(
    `${rows.noUpc} line${rows.noUpc === 1 ? " has" : "s have"} no barcode. Manufacturers match on ` +
    `UPC, so those lines won't be paid — fix the barcodes under Pricebook.`);
  return { ok: problems.length === 0, problems, lines: rows.n };
}

module.exports = { MAKERS, COLUMNS, settings, setSettings,
  saveBuydown, buydowns, deleteBuydown, live, offersFor,
  fundedFor, applySale, claim, exportRows, toCSV, checkReady };
