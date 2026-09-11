/* The point of this suite: prove the registry would have caught the two real
   bugs from today. If it can't detect a missing table or a missing column, it
   is decoration. */
const { DatabaseSync } = require("node:sqlite");
const raw = new DatabaseSync(":memory:");
const db = {
  exec: s => raw.exec(s),
  prepare: s => { const st = raw.prepare(s);
    return { get: (...a) => st.get(...a), all: (...a) => st.all(...a),
      run: (...a) => { const r = st.run(...a);
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; } }; },
  transaction: fn => (...a) => { return fn(...a); }
};
require.cache[require.resolve("../lib/db.js")] = { exports: db, loaded: true, id: "db" };

const fs = require("fs");
let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };

/* Build the real schema the way the server does: run db.js's own DDL first
   (it's stubbed here, so its statements don't execute on require), then load
   every module that owns tables. The module list is read out of server.js
   rather than typed, so this test can't drift from what actually runs. */
const grab = (f, a, b) => { const s = fs.readFileSync(f, "utf8"); const i = s.indexOf(a);
  if (i < 0) { console.log("FAIL anchor missing in " + f + ": " + a); process.exit(1); }
  return s.slice(i, s.indexOf(b, i)); };

db.exec(grab("lib/db.js", "CREATE TABLE IF NOT EXISTS accounts", "`);"));
/* db.js also adds client_id by migration */
try { db.exec("ALTER TABLE sales ADD COLUMN client_id TEXT"); } catch (e) {}

const serverSrc = fs.readFileSync("server.js", "utf8");
const required = [...serverSrc.matchAll(/require\("\.\/lib\/([a-z]+)"\)/g)].map(m => m[1]);
console.log("── modules the server loads ──");
console.log("   " + required.join(", ") + "\n");

/* payments needs the Stripe SDK, which isn't installed here — take its DDL
   directly so its tables still exist. */
const NEEDS_DEPS = new Set(["payments"]);
required.forEach(m => {
  if (m === "db") return;
  if (NEEDS_DEPS.has(m)) {
    try { db.exec(grab("lib/" + m + ".js", "CREATE TABLE IF NOT EXISTS", "`);")); }
    catch (e) { console.log(`   note: could not take ${m} DDL — ${e.message.slice(0, 60)}`); }
    return;
  }
  try { require("../lib/" + m + ".js"); }
  catch (e) { console.log(`   note: ${m} did not load — ${e.message.slice(0, 80)}`); }
});
/* resets lives in server.js itself */
db.exec(grab("server.js", "CREATE TABLE IF NOT EXISTS resets", "`);"));

const S = require("../lib/schema.js");

console.log("── the real schema verifies ──");
let v = S.verify();
if (!v.ok) {
  console.log("   missing tables: " + v.missingTables.map(t => t.table).join(", "));
  console.log("   missing columns: " + v.missingColumns.map(c =>
    `${c.table}.${c.columns.join("/")}`).join(", "));
}
chk("everything the code expects exists", v.ok,
  JSON.stringify({ t: v.missingTables, c: v.missingColumns }));
console.log(`   ${v.expected} expected tables, ${v.tables} in the database`);

console.log("\n── migrations ──");
const ran = S.migrate(() => {});
console.log(`   applied ${ran.length}: ${ran.map(r => r.version).join(", ")}`);
chk("migrations run", ran.length >= 1);
chk("and are recorded", S.version() >= 1);
const again = S.migrate(() => {});
chk("running them twice does nothing", again.length === 0);
chk("nothing is left pending", S.verify().pending.length === 0);

console.log("\n── the phone backfill actually works ──");
db.prepare("INSERT INTO accounts (id,email,pass_hash) VALUES (1,'a@b.c','x')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (1,1,'Shop')").run();
db.prepare("INSERT INTO customers (store_id,name,phone) VALUES (1,'Old record','(708) 555-0142')")
  .run();
db.prepare("DELETE FROM schema_migrations WHERE version = 2").run();
const back = S.migrate(() => {});
const row = db.prepare("SELECT digits FROM customers WHERE name = 'Old record'").get();
console.log(`   backfilled digits: ${row.digits}`);
chk("a customer saved before normalisation gets their digits", row.digits === "7085550142");
chk("and the migration reports how many", back.some(r => r.version === 2 && r.detail));

console.log("\n── the timestamp repair ──");
/* The bug this migration exists for: a sale stored the way a browser sends it
   is invisible to every report, because "T" sorts after " ". */
db.prepare("INSERT INTO sales (store_id,seq,at,total,is_return,json) " +
  "VALUES (1,1,'2026-09-10T04:11:05.855Z',9.99,0,'{}')").run();
const bound = "2026-09-10 23:59:59";
const beforeFix = db.prepare("SELECT COUNT(*) n FROM sales WHERE at <= ?").get(bound).n;
console.log(`   before the migration, a report for that day sees ${beforeFix} of 1 sales`);
chk("an ISO timestamp really is invisible to a range query", beforeFix === 0);

db.prepare("DELETE FROM schema_migrations WHERE version = 4").run();
const fixed = S.migrate(() => {});
const afterFix = db.prepare("SELECT COUNT(*) n FROM sales WHERE at <= ?").get(bound).n;
console.log(`   after it, ${afterFix} of 1`);
chk("the migration makes it visible", afterFix === 1);
chk("and reports how many it repaired", fixed.some(r => r.version === 4 && r.detail));
chk("the value is the same moment, just written differently",
  db.prepare("SELECT at FROM sales WHERE seq = 1").get().at === "2026-09-10 04:11:05");

console.log("\n── it catches a missing column ──");
/* Exactly today's operator console bug: query a column that isn't there. */
db.exec("CREATE TABLE probe_a (id INTEGER PRIMARY KEY)");
const orig = { ...S.EXPECTED };
S.EXPECTED.probe_a = ["id", "config", "updated_at"];
v = S.verify();
console.log("   " + v.missingColumns.map(c => `${c.table} needs ${c.columns.join(", ")}`).join("; "));
chk("a missing column is reported", !v.ok && v.missingColumns.length === 1);
chk("it names the columns", v.missingColumns[0].columns.join(",") === "config,updated_at");
chk("and names the file that owns the table", !!v.missingColumns[0].owner);
delete S.EXPECTED.probe_a;

console.log("\n── it catches a missing table ──");
/* Exactly today's audit bug: write to a table that doesn't exist. */
S.EXPECTED.activity = ["id", "account_id", "action"];
v = S.verify();
console.log("   " + v.missingTables.map(t => `${t.table} (${t.owner})`).join(", "));
chk("a missing table is reported", !v.ok && v.missingTables.length === 1);
chk("by name", v.missingTables[0].table === "activity");
delete S.EXPECTED.activity;

chk("and it goes back to clean", S.verify().ok === true);

console.log("\n── check() says something useful either way ──");
let said = [];
S.check(m => said.push(m));
chk("a healthy schema reports its version", said.join(" ").includes("schema: v"));
said = [];
S.EXPECTED.activity = ["id"];
S.check(m => said.push(m));
const text = said.join("\n");
console.log("   " + text.split("\n").filter(Boolean).slice(1, 3).join(" / "));
chk("a broken one is loud", text.includes("SCHEMA PROBLEM"));
chk("and explains what happens if it's ignored", text.includes("fail at runtime"));
delete S.EXPECTED.activity;

console.log("\n── row counts ──");
const c = S.counts();
chk("every expected table is counted", Object.keys(c).length === Object.keys(S.EXPECTED).length);
chk("and a count is a number, not a crash", typeof c.sales === "number");

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  the schema is declared, verified and migrated");
process.exit(bad ? 1 : 0);
