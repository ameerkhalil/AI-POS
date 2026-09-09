/* ---------------------------------------------------------------------------
   Storage. One SQLite file on a persistent disk, same shape as a small SaaS:
     account -> store -> (config, shifts, sales)
   The POS config is held as a JSON blob per store rather than normalised into
   thirty tables. It is read and written whole, it is small, and its shape is
   still changing. Normalise later, once the shape stops moving.
   --------------------------------------------------------------------------- */
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DIR, { recursive: true });
const db = new Database(path.join(DIR, "pos.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  pass_hash   TEXT NOT NULL,
  name        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stores (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stores_account ON stores(account_id);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS configs (
  store_id    INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  json        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shifts (
  id          INTEGER PRIMARY KEY,
  store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  opened_at   TEXT NOT NULL,
  closed_at   TEXT,
  opened_by   TEXT,
  start_cash  REAL NOT NULL DEFAULT 0,
  counted     REAL,
  json        TEXT
);
CREATE INDEX IF NOT EXISTS idx_shifts_store ON shifts(store_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS sales (
  id          INTEGER PRIMARY KEY,
  store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shift_id    INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  seq         INTEGER NOT NULL,
  at          TEXT NOT NULL,
  cashier     TEXT,
  total       REAL NOT NULL,
  is_return   INTEGER NOT NULL DEFAULT 0,
  customer_id INTEGER,
  json        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_store ON sales(store_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

/* Every AI call is logged so a runaway prompt loop is visible rather than
   silently expensive. */
CREATE TABLE IF NOT EXISTS ai_calls (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  kind        TEXT,
  in_tokens   INTEGER,
  out_tokens  INTEGER,
  ok          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_account ON ai_calls(account_id, at DESC);
`);

/* Migrations. Each is guarded so a restart on an existing database is a no-op. */
const cols = db.prepare("PRAGMA table_info(sales)").all().map(c => c.name);
if (!cols.includes("client_id")) {
  db.exec("ALTER TABLE sales ADD COLUMN client_id TEXT");
  console.log("  · migration: sales.client_id added");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client ON sales(store_id, client_id) " +
        "WHERE client_id IS NOT NULL");

db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

module.exports = db;
