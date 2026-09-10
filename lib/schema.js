/* ===========================================================================
   The schema.

   Two of the worst bugs in this codebase were schema mismatches. The operator
   console queried `stores.config` and `stores.updated_at`, neither of which
   exist — every fleet query threw a 500. And support access was being written
   to a table called `activity` when the real one is `audit`, inside a
   try/catch, so it failed silently and quietly broke a promise made to tenants.

   Both would have been caught in one second by asking the database whether the
   things the code needs are actually there.

   So this does three jobs:

     declare    what every module expects to exist, in one place
     verify     check it at boot and say loudly what's missing
     migrate    numbered, recorded, one-way changes for anything that can't be
                expressed as CREATE TABLE IF NOT EXISTS

   The existing DDL scattered through the modules stays where it is — it's
   idempotent and it lives next to the code that uses it, which is the right
   place for it. This layer is the check that it all actually happened.
   =========================================================================== */
const db = require("./db");

db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* ------------------------------ what we expect ----------------------------
   Only the columns the code actually reads. Listing every column would turn
   this into a second copy of the schema that drifts from the first. */
const EXPECTED = {
  accounts:         ["id", "email", "pass_hash", "created_at", "is_operator"],
  stores:           ["id", "account_id", "name", "created_at"],
  sessions:         ["token", "account_id", "expires_at"],
  configs:          ["store_id", "json", "updated_at"],
  shifts:           ["id", "store_id", "opened_at", "closed_at", "start_cash"],
  sales:            ["id", "store_id", "shift_id", "seq", "at", "cashier", "total",
                     "is_return", "json", "client_id", "terminal_id", "customer_id"],
  ai_calls:         ["id", "account_id", "at", "kind", "in_tokens", "out_tokens", "ok"],

  audit:            ["id", "account_id", "action", "detail", "ip", "at"],
  login_attempts:   ["id"],

  stock_moves:      ["id", "store_id", "plu_id", "qty", "kind", "at", "who", "ref", "cost"],
  stock_settings:   ["store_id", "plu_id", "par", "target", "tracked", "case_qty"],
  counts:           ["id", "store_id", "started_at", "closed_at", "who", "scope"],
  count_lines:      ["id", "count_id", "plu_id", "expected", "counted", "cost"],

  terminals:        ["id", "store_id", "token", "name", "number", "last_seen", "build",
                     "agent", "queued", "retired"],
  drawers:          ["id", "shift_id", "terminal_id", "start_cash", "counted",
                     "paid_in", "paid_out", "drops", "closed_at"],

  vendors:          ["id", "store_id", "name", "archived"],
  purchase_orders:  ["id", "store_id", "vendor_id", "state", "created_at"],
  po_lines:         ["id", "po_id", "plu_id", "ordered", "received", "cost", "paid"],
  po_receipts:      ["id", "po_id", "at", "invoice"],

  customers:        ["id", "store_id", "name", "phone", "digits", "card", "last_seen",
                     "archived"],
  points:           ["id", "store_id", "customer_id", "amount", "kind", "at"],
  loyalty_settings: ["store_id", "on_", "per_pound", "point_value", "block", "excluded"],
  offers:           ["id", "store_id", "name", "kind", "plu_ids", "need", "active"],
  offer_progress:   ["offer_id", "customer_id", "count", "redeemed"],

  tobacco_settings: ["store_id", "on_", "outlets", "dept_ids"],
  buydowns:         ["id", "store_id", "maker", "name", "plu_ids", "kind", "amount",
                     "qty", "price", "starts", "ends", "active"],
  tobacco_lines:    ["id", "store_id", "at", "plu_id", "upc", "qty", "unit_price",
                     "paid", "funded", "buydown_id", "maker", "is_return", "age_checked"],

  support_grants:   ["id", "operator_id", "account_id", "reason", "expires_at", "closed_at"],
  operator_log:     ["id", "operator_id", "action", "at"],

  tank_readings:    ["id", "store_id", "at", "tank", "volume", "water"],
  tank_alarms:      ["id", "store_id", "tank", "text", "cleared"],
  tank_deliveries:  ["id", "store_id", "tank", "gallons"],

  payments:         ["id"],
  store_settings:   ["store_id"],
  wipe_log:         ["id"],
  patterns:         ["id"],
  resets:           ["token", "account_id", "expires_at", "used_at"]
};

/* Modules that own each table, so a failure names the thing to look at rather
   than just the table. */
const OWNER = {
  stock_moves: "lib/stock.js", stock_settings: "lib/stock.js", counts: "lib/stock.js",
  count_lines: "lib/stock.js",
  terminals: "lib/terminals.js", drawers: "lib/terminals.js",
  vendors: "lib/purchasing.js", purchase_orders: "lib/purchasing.js",
  po_lines: "lib/purchasing.js", po_receipts: "lib/purchasing.js",
  customers: "lib/loyalty.js", points: "lib/loyalty.js",
  loyalty_settings: "lib/loyalty.js", offers: "lib/loyalty.js",
  offer_progress: "lib/loyalty.js",
  tobacco_settings: "lib/tobacco.js", buydowns: "lib/tobacco.js",
  tobacco_lines: "lib/tobacco.js",
  support_grants: "lib/admin.js", operator_log: "lib/admin.js",
  tank_readings: "lib/tanks.js", tank_alarms: "lib/tanks.js",
  tank_deliveries: "lib/tanks.js",
  audit: "lib/privacy.js", login_attempts: "lib/privacy.js",
  payments: "lib/payments.js", store_settings: "lib/payments.js",
  wipe_log: "lib/retention.js", patterns: "lib/learn.js",
  resets: "server.js"
};

/* ------------------------------- migrations -------------------------------
   Numbered and recorded. Anything expressible as CREATE TABLE IF NOT EXISTS
   belongs in its own module; this is for changes that need to happen once and
   can't be repeated — backfills, renames, index rebuilds. */
const MIGRATIONS = [
  {
    version: 1,
    name: "record the schema baseline",
    /* Nothing to do: every table above is created idempotently by its module.
       This exists so a database that has been through today's changes reports a
       version rather than nothing at all. */
    up: () => {}
  },
  {
    version: 2,
    name: "backfill customer phone digits",
    up: () => {
      /* Customers saved before phone numbers were normalised have no digits, so
         a till lookup by number would miss them. */
      const rows = db.prepare(
        "SELECT id, phone FROM customers WHERE phone IS NOT NULL AND (digits IS NULL OR digits = '')")
        .all();
      const up = db.prepare("UPDATE customers SET digits = ? WHERE id = ?");
      rows.forEach(r => up.run(String(r.phone).replace(/\D/g, ""), r.id));
      return rows.length ? `${rows.length} customer${rows.length === 1 ? "" : "s"}` : null;
    }
  },
  {
    version: 3,
    name: "index sales by date for reports",
    up: () => {
      /* The reports walk sales by date range across a year. Without this every
         report is a full scan of the table. */
      db.exec("CREATE INDEX IF NOT EXISTS idx_sales_at ON sales(store_id, at)");
    }
  }
];

const applied = () => new Set(
  db.prepare("SELECT version FROM schema_migrations").all().map(r => r.version));

function migrate(log) {
  const done = applied();
  const say = log || (() => {});
  const ran = [];

  MIGRATIONS.sort((a, b) => a.version - b.version).forEach(m => {
    if (done.has(m.version)) return;
    /* One transaction per migration: a failure leaves the ones before it
       applied and recorded, rather than an unknown halfway state. */
    const tx = db.transaction(() => {
      const detail = m.up();
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?,?)")
        .run(m.version, m.name);
      return detail;
    });
    try {
      const detail = tx();
      ran.push({ version: m.version, name: m.name, detail });
      say(`  migration ${m.version}: ${m.name}${detail ? " — " + detail : ""}`);
    } catch (e) {
      say(`  MIGRATION ${m.version} FAILED (${m.name}): ${e.message}`);
      throw e;
    }
  });

  return ran;
}

const version = () => {
  const r = db.prepare("SELECT MAX(version) v FROM schema_migrations").get();
  return r.v || 0;
};

/* -------------------------------- verifying -------------------------------- */

function verify() {
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));

  const missingTables = [], missingColumns = [];

  Object.entries(EXPECTED).forEach(([table, cols]) => {
    if (!tables.has(table)) {
      missingTables.push({ table, owner: OWNER[table] || "lib/db.js" });
      return;
    }
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    const gone = cols.filter(c => !have.has(c));
    if (gone.length) missingColumns.push({ table, columns: gone,
      owner: OWNER[table] || "lib/db.js" });
  });

  return {
    ok: !missingTables.length && !missingColumns.length,
    version: version(),
    tables: tables.size,
    expected: Object.keys(EXPECTED).length,
    missingTables, missingColumns,
    pending: MIGRATIONS.filter(m => !applied().has(m.version)).map(m => m.version)
  };
}

/* Called once at boot, after every module has had a chance to create its own
   tables. Says what's wrong in terms of which file to look at. */
function check(log) {
  const say = log || console.log;
  const v = verify();

  if (v.ok) {
    say(`  schema: v${v.version}, ${v.expected} tables verified`);
    return v;
  }

  say("");
  say("  ══ SCHEMA PROBLEM ══");
  v.missingTables.forEach(m =>
    say(`  missing table "${m.table}" — created by ${m.owner}; is it being required?`));
  v.missingColumns.forEach(m =>
    say(`  table "${m.table}" is missing ${m.columns.join(", ")} — see ${m.owner}`));
  say("  Queries against these will fail at runtime rather than here.");
  say("  ════════════════════");
  say("");
  return v;
}

/* A count of everything, for the operator console. Cheap enough to call on a
   page load and useful for spotting a store that has stopped writing. */
function counts() {
  const out = {};
  Object.keys(EXPECTED).forEach(t => {
    try { out[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; }
    catch (e) { out[t] = null; }
  });
  return out;
}

module.exports = { EXPECTED, MIGRATIONS, migrate, verify, check, version, counts };
