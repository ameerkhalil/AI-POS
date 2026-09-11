/* ===========================================================================
   Upgrading a database that already exists.

   Every other suite starts from an empty file, so every other suite exercises
   the CREATE TABLE path and none of them exercise the ALTER path. That gap let
   a fatal bug reach production: the base schema created an index on a column
   that a later module adds, which works on a new database and kills the process
   on an old one.

   This builds a database the way it looked before today's work, then loads
   every module the server loads, in the order the server loads them. If a
   module can't upgrade what's already there, this fails instead of Render.
   =========================================================================== */
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");

let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };

/* The schema as it stood before inventory, terminals, loyalty and the rest —
   deliberately missing the columns and tables added since. */
const OLD = `
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE sessions (
  token TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL);
CREATE TABLE stores (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE configs (
  store_id INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE shifts (
  id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  opened_at TEXT NOT NULL, opened_by TEXT, closed_at TEXT, start_cash REAL NOT NULL DEFAULT 0);
/* No client_id, no terminal_id, no customer_id — the three columns added since. */
CREATE TABLE sales (
  id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shift_id INTEGER, seq INTEGER NOT NULL, at TEXT NOT NULL, cashier TEXT,
  total REAL NOT NULL, is_return INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL);
CREATE TABLE ai_calls (
  id INTEGER PRIMARY KEY, account_id INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT, in_tokens INTEGER, out_tokens INTEGER, ok INTEGER NOT NULL DEFAULT 1);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY, account_id INTEGER, action TEXT NOT NULL, detail TEXT, ip TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY, email TEXT, ip TEXT, at TEXT NOT NULL DEFAULT (datetime('now')),
  ok INTEGER NOT NULL DEFAULT 0);
`;

const raw = new DatabaseSync(":memory:");
raw.exec(OLD);

/* Data already in it, because an upgrade that works on an empty old database
   and not on a full one is no use. */
raw.exec(`
INSERT INTO accounts (id,email,pass_hash) VALUES (1,'ameer@example.com','x');
INSERT INTO stores (id,account_id,name) VALUES (1,1,'Palos Hills');
INSERT INTO configs (store_id,json) VALUES (1,'{"plus":[],"depts":[]}');
INSERT INTO sales (store_id,seq,at,cashier,total,json)
  VALUES (1,1,'2026-09-01T14:22:31.004Z','Dana',12.49,'{}');
INSERT INTO sales (store_id,seq,at,cashier,total,json)
  VALUES (1,2,'2026-09-02 09:14:00','Dana',3.99,'{}');
`);

const db = {
  exec: s => raw.exec(s),
  prepare: s => { const st = raw.prepare(s);
    return { get: (...a) => st.get(...a), all: (...a) => st.all(...a),
      run: (...a) => { const r = st.run(...a);
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; } }; },
  transaction: fn => (...a) => fn(...a)
};
require.cache[require.resolve("../lib/db.js")] = { exports: db, loaded: true, id: "db" };

/* db.js is stubbed, so its own DDL and migrations don't run on require. Apply
   them the way it would, from the file itself, or this test would claim the
   base schema upgraded when it never executed. */
{
  const src = fs.readFileSync("lib/db.js", "utf8");
  const ddlStart = src.indexOf("CREATE TABLE IF NOT EXISTS accounts");
  db.exec(src.slice(ddlStart, src.indexOf("`);", ddlStart)));

  const migStart = src.indexOf("/* Migrations.");
  const migEnd = src.indexOf("db.prepare(\"DELETE FROM sessions", migStart);
  const mig = src.slice(migStart, migEnd);
  new Function("db", "console", mig)(db, { log: () => {} });
}

console.log("── loading every module against an existing database ──");

/* The same list, in the same order, read out of server.js so it can't drift. */
const serverSrc = fs.readFileSync("server.js", "utf8");
const order = [...serverSrc.matchAll(/require\("\.\/lib\/([a-z]+)"\)/g)]
  .map(m => m[1]).filter(m => m !== "db");
const NEEDS_DEPS = new Set(["payments"]);

order.forEach(name => {
  if (NEEDS_DEPS.has(name)) {
    /* Stripe isn't installed here; take its tables directly so the rest of the
       chain still sees them. */
    try {
      const src = fs.readFileSync(`lib/${name}.js`, "utf8");
      const i = src.indexOf("CREATE TABLE IF NOT EXISTS");
      if (i >= 0) db.exec(src.slice(i, src.indexOf("`);", i)));
      chk(`lib/${name}.js tables`, true);
    } catch (e) { chk(`lib/${name}.js tables`, false, e.message.split("\n")[0]); }
    return;
  }
  try { require(`../lib/${name}.js`); chk(`lib/${name}.js`, true); }
  catch (e) { chk(`lib/${name}.js`, false, e.message.split("\n")[0]); }
});
/* resets lives in server.js */
try {
  const i = serverSrc.indexOf("CREATE TABLE IF NOT EXISTS resets");
  db.exec(serverSrc.slice(i, serverSrc.indexOf("`);", i)));
} catch (e) {}

console.log("\n── the columns added since arrived ──");
const cols = t => new Set(raw.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name));
const sales = cols("sales");
["client_id", "terminal_id", "customer_id"].forEach(c =>
  chk(`sales.${c}`, sales.has(c)));
chk("customers.digits", cols("customers").has("digits"));
chk("accounts.is_operator", cols("accounts").has("is_operator"));

console.log("\n── the existing rows survived ──");
chk("both sales are still there",
  raw.prepare("SELECT COUNT(*) n FROM sales").get().n === 2);
chk("the store is still there",
  raw.prepare("SELECT COUNT(*) n FROM stores").get().n === 1);
chk("and its pricebook",
  !!raw.prepare("SELECT json FROM configs WHERE store_id=1").get());

console.log("\n── migrations run on the upgraded database ──");
const S = require("../lib/schema.js");
let ran;
try { ran = S.migrate(() => {}); chk("migrations apply", true); }
catch (e) { chk("migrations apply", false, e.message.split("\n")[0]); }

if (ran) {
  console.log(`   applied ${ran.length}: ${ran.map(r => r.version).join(", ")}`);
  chk("the ISO timestamp was repaired",
    raw.prepare("SELECT at FROM sales WHERE seq=1").get().at === "2026-09-01 14:22:31");
  chk("the already-correct one was left alone",
    raw.prepare("SELECT at FROM sales WHERE seq=2").get().at === "2026-09-02 09:14:00");
  chk("running them again does nothing", S.migrate(() => {}).length === 0);
}

console.log("\n── the schema verifies afterwards ──");
const v = S.verify();
if (!v.ok) {
  v.missingTables.forEach(t => console.log(`   missing table ${t.table} (${t.owner})`));
  v.missingColumns.forEach(c => console.log(`   ${c.table} missing ${c.columns.join(", ")}`));
}
chk("every expected table and column is present", v.ok);
console.log(`   ${v.expected} tables, schema v${v.version}`);

console.log("\n── loading twice doesn't break anything ──");
/* A redeploy runs all of this again against the database it just upgraded. */
let second = true;
try {
  Object.keys(require.cache)
    .filter(k => k.includes("/lib/") && !k.endsWith("db.js"))
    .forEach(k => delete require.cache[k]);
  order.filter(n => !NEEDS_DEPS.has(n)).forEach(n => require(`../lib/${n}.js`));
} catch (e) { second = false; chk("a second boot", false, e.message.split("\n")[0]); }
if (second) chk("a redeploy re-runs cleanly", true);

console.log(bad ? `\nFAIL ${bad} checks — an existing database would not upgrade`
  : "\nPASS  an existing database upgrades cleanly");
process.exit(bad ? 1 : 0);
