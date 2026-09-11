/* ===========================================================================
   Central pricebook.

   Twenty stores each holding their own copy of the pricebook means a cigarette
   price rise is twenty edits. This is the layer that makes one edit reach a
   group of shops — and, just as importantly, lets a shop keep a price that's
   deliberately different without having it overwritten every time.

   The model:

     group      a set of stores that should mostly agree. A shop can be in one.
     master     the central record for a product: name, price, cost, department.
     override   a store saying "not here" for one field of one product. Survives
                every push until somebody removes it.
     push       apply the master to the stores in a group, respecting overrides,
                previewed before anything is written.

   Two rules that matter:

   - A push is PREVIEWED first, always. Twenty stores is enough that a mistake
     is expensive and a wrong price is a legal problem, not a support ticket.

   - An override is explicit. Editing a price locally does not silently create
     one, because then nothing would ever be centrally managed again. The store
     screen asks.
   =========================================================================== */
const db = require("./db");

db.exec(`
CREATE TABLE IF NOT EXISTS store_groups (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_group_account ON store_groups(account_id);

CREATE TABLE IF NOT EXISTS group_stores (
  group_id INTEGER NOT NULL REFERENCES store_groups(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, store_id)
);
CREATE INDEX IF NOT EXISTS idx_gs_store ON group_stores(store_id);

/* The central record. Keyed on barcode, because that's the only identifier
   that's the same in every shop — a PLU id is generated per store. */
CREATE TABLE IF NOT EXISTS master_items (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  upc        TEXT NOT NULL,
  name       TEXT NOT NULL,
  price      REAL,
  cost       REAL,
  dept       TEXT,
  note       TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, upc)
);

/* "This shop is different, on purpose." */
CREATE TABLE IF NOT EXISTS price_overrides (
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  upc        TEXT NOT NULL,
  field      TEXT NOT NULL,          -- price | cost | name | dept
  value      TEXT,
  reason     TEXT,
  who        TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_id, upc, field)
);

/* Every push, so a price that appeared overnight can be traced to a person. */
CREATE TABLE IF NOT EXISTS pushes (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  group_id   INTEGER,
  who        TEXT,
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  stores     INTEGER NOT NULL DEFAULT 0,
  changes    INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  effective  TEXT,                    -- null means now
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_account ON pushes(account_id, at DESC);

/* A change that shouldn't take effect until a date — tobacco prices move on a
   schedule and somebody shouldn't have to be there at 6am. */
CREATE TABLE IF NOT EXISTS scheduled_changes (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  group_id   INTEGER,
  upc        TEXT NOT NULL,
  field      TEXT NOT NULL,
  value      TEXT,
  effective  TEXT NOT NULL,           -- YYYY-MM-DD
  who        TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sched ON scheduled_changes(account_id, effective, applied_at);
`);

const FIELDS = ["price", "cost", "name", "dept"];

/* --------------------------------- groups --------------------------------- */

function saveGroup(accountId, g) {
  if (!g.name || !String(g.name).trim()) throw new Error("A group needs a name.");
  if (g.id) {
    db.prepare("UPDATE store_groups SET name = ?, note = ? WHERE id = ? AND account_id = ?")
      .run(String(g.name).slice(0, 80), g.note || null, g.id, accountId);
    return g.id;
  }
  const r = db.prepare("INSERT INTO store_groups (account_id, name, note) VALUES (?,?,?)")
    .run(accountId, String(g.name).slice(0, 80), g.note || null);
  return r.lastInsertRowid;
}

const groups = accountId => db.prepare(
  "SELECT g.*, (SELECT COUNT(*) FROM group_stores s WHERE s.group_id = g.id) AS stores " +
  "FROM store_groups g WHERE g.account_id = ? ORDER BY g.name").all(accountId);

const groupStores = groupId => db.prepare(
  "SELECT s.id, s.name FROM group_stores g JOIN stores s ON s.id = g.store_id " +
  "WHERE g.group_id = ? ORDER BY s.id").all(groupId);

/* A store belongs to at most one group — two groups pushing different prices to
   the same shop is a fight nobody wins. */
function setGroupStores(accountId, groupId, storeIds) {
  const mine = new Set(db.prepare("SELECT id FROM stores WHERE account_id = ?")
    .all(accountId).map(r => r.id));
  const wanted = (storeIds || []).map(Number).filter(id => mine.has(id));

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM group_stores WHERE group_id = ?").run(groupId);
    const ins = db.prepare("INSERT OR IGNORE INTO group_stores (group_id, store_id) VALUES (?,?)");
    wanted.forEach(id => {
      db.prepare("DELETE FROM group_stores WHERE store_id = ?").run(id);
      ins.run(groupId, id);
    });
  });
  tx();
  return wanted.length;
}

const deleteGroup = (accountId, id) =>
  db.prepare("DELETE FROM store_groups WHERE id = ? AND account_id = ?").run(id, accountId);

/* ------------------------------- master items ------------------------------ */

function saveMaster(accountId, item) {
  const upc = String(item.upc || "").trim();
  if (!upc) throw new Error("A central item needs a barcode — it's the only thing every store agrees on.");
  if (!item.name || !String(item.name).trim()) throw new Error("It needs a name.");
  db.prepare(
    "INSERT INTO master_items (account_id, upc, name, price, cost, dept, note, updated_at) " +
    "VALUES (?,?,?,?,?,?,?, datetime('now')) " +
    "ON CONFLICT(account_id, upc) DO UPDATE SET name = excluded.name, price = excluded.price, " +
    "cost = excluded.cost, dept = excluded.dept, note = excluded.note, updated_at = datetime('now')")
    .run(accountId, upc, String(item.name).slice(0, 160),
      item.price == null || item.price === "" ? null : Number(item.price),
      item.cost == null || item.cost === "" ? null : Number(item.cost),
      item.dept || null, item.note || null);
  return upc;
}

const master = accountId => db.prepare(
  "SELECT * FROM master_items WHERE account_id = ? ORDER BY name").all(accountId);

const deleteMaster = (accountId, upc) =>
  db.prepare("DELETE FROM master_items WHERE account_id = ? AND upc = ?").run(accountId, upc);

/* Build the central list from a store that's already set up properly, rather
   than typing three thousand items in twice. */
function adoptFrom(accountId, storeId) {
  const row = db.prepare("SELECT json FROM configs WHERE store_id = ?").get(storeId);
  if (!row) throw new Error("That store has no pricebook yet.");
  let cfg = {};
  try { cfg = JSON.parse(row.json || "{}"); } catch (e) { throw new Error("Its pricebook is unreadable."); }

  const depts = {};
  (cfg.depts || []).forEach(d => { depts[d.id] = d.n; });

  let added = 0, skipped = 0;
  (cfg.plus || []).forEach(p => {
    if (!p.upc || !String(p.upc).trim()) { skipped++; return; }
    saveMaster(accountId, { upc: p.upc, name: p.n, price: p.price, cost: p.cost,
      dept: depts[p.deptId] || null });
    added++;
  });
  return { added, skipped };
}

/* -------------------------------- overrides ------------------------------- */

function setOverride(storeId, upc, field, value, { reason, who }) {
  if (!FIELDS.includes(field)) throw new Error("That isn't a field that can be overridden.");
  db.prepare(
    "INSERT INTO price_overrides (store_id, upc, field, value, reason, who) VALUES (?,?,?,?,?,?) " +
    "ON CONFLICT(store_id, upc, field) DO UPDATE SET value = excluded.value, " +
    "reason = excluded.reason, who = excluded.who, created_at = datetime('now')")
    .run(storeId, String(upc), field, value == null ? null : String(value), reason || null,
      who || null);
}

const clearOverride = (storeId, upc, field) =>
  db.prepare("DELETE FROM price_overrides WHERE store_id = ? AND upc = ? AND field = ?")
    .run(storeId, String(upc), field);

const overrides = storeId => db.prepare(
  "SELECT * FROM price_overrides WHERE store_id = ? ORDER BY upc").all(storeId);

const overrideMap = storeId => {
  const out = {};
  overrides(storeId).forEach(o => {
    (out[o.upc] = out[o.upc] || {})[o.field] = o.value;
  });
  return out;
};

/* ---------------------------------- push ----------------------------------
   Works out what would change, without changing anything. The same function
   produces the preview and the applied result, so what you approve is exactly
   what happens. */
function plan(accountId, groupId, { only }) {
  const items = master(accountId).filter(m => !only || only.includes(m.upc));
  const stores = groupId
    ? groupStores(groupId)
    : db.prepare("SELECT id, name FROM stores WHERE account_id = ? ORDER BY id").all(accountId);

  const out = [];

  stores.forEach(store => {
    const row = db.prepare("SELECT json FROM configs WHERE store_id = ?").get(store.id);
    if (!row) { out.push({ store, missing: true, changes: [], skipped: [] }); return; }
    let cfg = {};
    try { cfg = JSON.parse(row.json || "{}"); }
    catch (e) { out.push({ store, unreadable: true, changes: [], skipped: [] }); return; }

    const ov = overrideMap(store.id);
    const byUpc = {};
    (cfg.plus || []).forEach(p => { if (p.upc) byUpc[String(p.upc)] = p; });
    const deptByName = {};
    (cfg.depts || []).forEach(d => { deptByName[String(d.n).toLowerCase()] = d.id; });

    const changes = [], skipped = [], missing = [];

    items.forEach(m => {
      const p = byUpc[m.upc];
      if (!p) { missing.push({ upc: m.upc, name: m.name }); return; }
      const o = ov[m.upc] || {};

      const consider = (field, next, current) => {
        if (next == null || next === "") return;
        if (o[field] !== undefined) {
          skipped.push({ upc: m.upc, name: m.name, field, reason: "held locally",
            keeping: current, wouldBe: next });
          return;
        }
        const same = typeof next === "number"
          ? Math.abs((Number(current) || 0) - next) < 0.0001
          : String(current || "") === String(next);
        if (same) return;
        changes.push({ upc: m.upc, pluId: p.id, name: m.name, field,
          from: current, to: next });
      };

      consider("price", m.price == null ? null : Number(m.price), p.price);
      consider("cost", m.cost == null ? null : Number(m.cost), p.cost);
      consider("name", m.name, p.n);
      if (m.dept) {
        const target = deptByName[String(m.dept).toLowerCase()];
        if (!target) skipped.push({ upc: m.upc, name: m.name, field: "dept",
          reason: `no section called "${m.dept}" in this store` });
        else consider("dept", target, p.deptId);
      }
    });

    out.push({ store, changes, skipped, missing });
  });

  return {
    stores: out,
    totals: {
      stores: out.length,
      changes: out.reduce((a, s) => a + s.changes.length, 0),
      skipped: out.reduce((a, s) => a + s.skipped.length, 0),
      missing: out.reduce((a, s) => a + s.missing.length, 0)
    }
  };
}

/* Applies a plan. Writes each store's config in one go and bumps its version so
   the terminal picks it up on its next sync. */
function apply(accountId, groupId, { who, only, effective }) {
  const p = plan(accountId, groupId, { only });
  let changed = 0;

  p.stores.forEach(s => {
    if (!s.changes.length) return;
    const row = db.prepare("SELECT json FROM configs WHERE store_id = ?").get(s.store.id);
    if (!row) return;
    let cfg;
    try { cfg = JSON.parse(row.json); } catch (e) { return; }

    const byId = {};
    (cfg.plus || []).forEach(x => { byId[x.id] = x; });

    s.changes.forEach(c => {
      const item = byId[c.pluId];
      if (!item) return;
      if (c.field === "price") item.price = c.to;
      else if (c.field === "cost") item.cost = c.to;
      else if (c.field === "name") item.n = c.to;
      else if (c.field === "dept") item.deptId = c.to;
      changed++;
    });

    db.prepare("UPDATE configs SET json = ?, updated_at = datetime('now') WHERE store_id = ?")
      .run(JSON.stringify(cfg), s.store.id);
  });

  const r = db.prepare(
    "INSERT INTO pushes (account_id, group_id, who, stores, changes, skipped, effective, detail) " +
    "VALUES (?,?,?,?,?,?,?,?)")
    .run(accountId, groupId || null, who || null,
      p.stores.filter(s => s.changes.length).length, changed, p.totals.skipped,
      effective || null,
      JSON.stringify(p.stores.map(s => ({ store: s.store.name, changes: s.changes.length }))));

  return { pushId: r.lastInsertRowid, changed, stores: p.stores.filter(s => s.changes.length).length,
    skipped: p.totals.skipped, missing: p.totals.missing };
}

const pushes = accountId => db.prepare(
  "SELECT * FROM pushes WHERE account_id = ? ORDER BY at DESC LIMIT 40").all(accountId);

/* ------------------------------- scheduling -------------------------------
   A change that takes effect on a date. Written to the master when the day
   comes, then pushed like any other. */
function schedule(accountId, changes) {
  const ins = db.prepare(
    "INSERT INTO scheduled_changes (account_id, group_id, upc, field, value, effective, who) " +
    "VALUES (?,?,?,?,?,?,?)");
  let n = 0;
  (changes || []).forEach(c => {
    if (!c.upc || !FIELDS.includes(c.field) || !c.effective) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.effective)))
      throw new Error("A date must be YYYY-MM-DD.");
    ins.run(accountId, c.groupId || null, String(c.upc), c.field,
      c.value == null ? null : String(c.value), String(c.effective), c.who || null);
    n++;
  });
  return n;
}

const scheduled = accountId => db.prepare(
  "SELECT * FROM scheduled_changes WHERE account_id = ? AND applied_at IS NULL " +
  "ORDER BY effective, upc").all(accountId);

const cancelScheduled = (accountId, id) =>
  db.prepare("DELETE FROM scheduled_changes WHERE id = ? AND account_id = ? AND applied_at IS NULL")
    .run(id, accountId);

/* Run on a timer. Anything due today or earlier that hasn't been applied gets
   written to the master and pushed to its group. */
function runScheduled(accountId, who) {
  const today = new Date().toISOString().slice(0, 10);
  const due = db.prepare(
    "SELECT * FROM scheduled_changes WHERE account_id = ? AND applied_at IS NULL " +
    "AND effective <= ? ORDER BY effective").all(accountId, today);
  if (!due.length) return { applied: 0, pushed: 0 };

  const byGroup = {};
  due.forEach(c => {
    const m = db.prepare("SELECT * FROM master_items WHERE account_id = ? AND upc = ?")
      .get(accountId, c.upc);
    if (!m) return;
    const patch = { upc: m.upc, name: m.name, price: m.price, cost: m.cost, dept: m.dept };
    if (c.field === "price") patch.price = Number(c.value);
    else if (c.field === "cost") patch.cost = Number(c.value);
    else if (c.field === "name") patch.name = c.value;
    else if (c.field === "dept") patch.dept = c.value;
    saveMaster(accountId, patch);
    db.prepare("UPDATE scheduled_changes SET applied_at = datetime('now') WHERE id = ?").run(c.id);
    const key = c.group_id || "all";
    (byGroup[key] = byGroup[key] || new Set()).add(c.upc);
  });

  let pushed = 0;
  Object.entries(byGroup).forEach(([key, upcs]) => {
    const r = apply(accountId, key === "all" ? null : Number(key),
      { who: who || "schedule", only: [...upcs], effective: today });
    pushed += r.changed;
  });

  return { applied: due.length, pushed };
}

module.exports = { FIELDS, saveGroup, groups, groupStores, setGroupStores, deleteGroup,
  saveMaster, master, deleteMaster, adoptFrom,
  setOverride, clearOverride, overrides, overrideMap,
  plan, apply, pushes, schedule, scheduled, cancelScheduled, runScheduled };
