/* The one thing that would quietly corrupt every stock figure: the offline
   queue replaying a sale the server already has. This exercises insertSale
   itself rather than the engine underneath it. */
const { DatabaseSync } = require("node:sqlite");
const raw = new DatabaseSync(":memory:");
const db = {
  exec: s => raw.exec(s),
  prepare: s => { const st = raw.prepare(s);
    return { get: (...a) => st.get(...a), all: (...a) => st.all(...a),
      run: (...a) => { const r = st.run(...a);
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; } }; },
  transaction: fn => (...a) => fn(...a)
};
require.cache[require.resolve("../lib/db.js")] = { exports: db, loaded: true, id: "db" };

const fs = require("fs");
const grab = (f, a, b) => { const s = fs.readFileSync(f, "utf8"); const i = s.indexOf(a);
  return s.slice(i, s.indexOf(b, i)); };
db.exec(grab("lib/db.js", "CREATE TABLE IF NOT EXISTS accounts", "`);"));
/* client_id is added by a migration in server.js; add it here the same way. */
try { db.exec("ALTER TABLE sales ADD COLUMN client_id TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE sales ADD COLUMN terminal_id INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE sales ADD COLUMN customer_id INTEGER"); } catch (e) {}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_cid ON sales(store_id, client_id)");

const STOCK = require("../lib/stock.js");

/* insertSale lifted out of server.js verbatim, so this tests the shipped code
   rather than a copy that could drift from it. */
const src = grab("server.js", "function insertSale(", "\n/* Cheap liveness check");
/* A missing anchor makes indexOf return -1 and slice quietly hand back the
   wrong end of the file, so the test would run against nothing and pass. Check
   it found the real thing. */
if (!src.startsWith("function insertSale(") || !src.includes("INSERT INTO sales"))
  { console.log("FAIL could not lift insertSale out of server.js"); process.exit(1); }
/* Lifted verbatim, so it needs whatever server.js has in scope at that point.
   Passing them in explicitly means a new dependency shows up as a clear
   "X is not defined" here rather than as a silently untested code path. */
const LOY = require("../lib/loyalty.js");
const TOB = require("../lib/tobacco.js");
const WHEN = require("../lib/when.js");
const insertSale = new Function("db", "STOCK", "LOY", "TOB", "WHEN", "console",
  src + "; return insertSale;")(db, STOCK, LOY, TOB, WHEN, console);

let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };
const near = (a, b) => Math.abs(a - b) < 0.001;

db.prepare("INSERT INTO accounts (id,email,pass_hash) VALUES (1,'a@b.c','x')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (1,1,'Shop')").run();
STOCK.move(1, { pluId: "P1", qty: 50, kind: "received" });

const sale = { n: 7, at: new Date().toISOString(), by: "Dana", tot: 11.97, ret: false,
  cid: "abc-123", lines: [{ pluId: "P1", q: 3, n: "Monster" }] };

let r = insertSale(1, null, sale);
chk("the sale is recorded", r.duplicate === false);
chk("stock moved once", near(STOCK.onHand(1, "P1"), 47));

/* the offline queue sends it again after a dropped connection */
r = insertSale(1, null, sale);
chk("the replay is recognised as a duplicate", r.duplicate === true);
chk("and stock did NOT move a second time", near(STOCK.onHand(1, "P1"), 47));

for (let i = 0; i < 5; i++) insertSale(1, null, sale);
chk("five more replays change nothing", near(STOCK.onHand(1, "P1"), 47));
chk("and only one sale row exists",
  db.prepare("SELECT COUNT(*) n FROM sales WHERE store_id=1").get().n === 1);

/* a genuinely different sale still moves */
insertSale(1, null, { ...sale, n: 8, cid: "abc-124", lines: [{ pluId: "P1", q: 2 }] });
chk("a new sale still decrements", near(STOCK.onHand(1, "P1"), 45));

/* a refund of it */
insertSale(1, null, { ...sale, n: 9, cid: "abc-125", ret: true,
  lines: [{ pluId: "P1", q: 2 }] });
chk("a refund adds back", near(STOCK.onHand(1, "P1"), 47));

/* a sale with no client id can't be deduplicated — it must still work */
insertSale(1, null, { n: 10, by: "Dana", tot: 3.99, cid: null,
  lines: [{ pluId: "P1", q: 1 }] });
chk("a sale with no client id still records", near(STOCK.onHand(1, "P1"), 46));

/* the lane that rang it is recorded */
insertSale(1, null, { n: 20, cid: "t-1", lines: [{ pluId: "P1", q: 1 }] }, 7);
chk("the terminal is recorded on the sale",
  db.prepare("SELECT terminal_id FROM sales WHERE client_id='t-1'").get().terminal_id === 7);
insertSale(1, null, { n: 21, cid: "t-2", lines: [{ pluId: "P1", q: 1 }] });
chk("and is null when none was given",
  db.prepare("SELECT terminal_id FROM sales WHERE client_id='t-2'").get().terminal_id == null);

/* an untracked product is skipped even through this path */
STOCK.setSettings(1, "P9", { tracked: 0 });
insertSale(1, null, { n: 11, cid: "abc-126", lines: [{ pluId: "P9", q: 4 }] });
chk("an untracked product writes nothing", near(STOCK.onHand(1, "P9"), 0));

/* a broken line must not lose the sale */
/* Relative, not absolute: an assertion pinned to a number breaks whenever a
   test is inserted above it, which teaches people to edit the number rather
   than read the failure. */
const before = db.prepare("SELECT COUNT(*) n FROM sales WHERE store_id=1").get().n;
const stockBefore = STOCK.onHand(1, "P1");
insertSale(1, null, { n: 12, cid: "abc-127", lines: [{ pluId: "P1", q: "not a number" }] });
chk("a nonsense quantity doesn't lose the sale",
  db.prepare("SELECT COUNT(*) n FROM sales WHERE store_id=1").get().n === before + 1);
chk("and doesn't corrupt the on-hand", near(STOCK.onHand(1, "P1"), stockBefore));

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  replayed sales cannot move stock twice");
process.exit(bad ? 1 : 0);
