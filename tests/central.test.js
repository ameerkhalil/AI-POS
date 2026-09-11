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
  if (i < 0) { console.log("FAIL anchor missing: " + a); process.exit(1); }
  return s.slice(i, s.indexOf(b, i)); };
db.exec(grab("lib/db.js", "CREATE TABLE IF NOT EXISTS accounts", "`);"));

const C = require("../lib/central.js");
let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };
const near = (a, b) => Math.abs(a - b) < 0.001;

db.prepare("INSERT INTO accounts (id,email,pass_hash) VALUES (1,'me@x.com','x')").run();
db.prepare("INSERT INTO accounts (id,email,pass_hash) VALUES (2,'other@x.com','x')").run();

/* three of ours, one belonging to somebody else */
const pricebook = (mult = 1) => JSON.stringify({
  depts: [{ id: "D1", n: "Tobacco" }, { id: "D2", n: "Drinks" }],
  plus: [
    { id: "P" + Math.random().toString(36).slice(2, 6), upc: "028200001",
      n: "Marlboro Red", price: 11.49 * mult, cost: 9.20, deptId: "D1" },
    { id: "P" + Math.random().toString(36).slice(2, 6), upc: "049000028",
      n: "Coke 20oz", price: 2.49, cost: 1.10, deptId: "D2" },
    /* A genuinely unbarcoded item — an open-department key or a local special.
       These can't be centrally managed because there's nothing to match on. */
    { id: "P" + Math.random().toString(36).slice(2, 6), upc: "",
      n: "Local special", price: 3.00, deptId: "D2" }
  ]
});
[1, 2, 3].forEach(i => {
  db.prepare("INSERT INTO stores (id,account_id,name) VALUES (?,1,?)").run(i, "Store " + i);
  db.prepare("INSERT INTO configs (store_id,json) VALUES (?,?)").run(i, pricebook(i === 3 ? 1.1 : 1));
});
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (9,2,'Not ours')").run();
db.prepare("INSERT INTO configs (store_id,json) VALUES (9,?)").run(pricebook());

console.log("── groups ──");
const g = C.saveGroup(1, { name: "Illinois forecourts" });
chk("a group saves", !!g);
let threw = false;
try { C.saveGroup(1, { name: " " }); } catch (e) { threw = true; }
chk("it needs a name", threw);

chk("stores are added", C.setGroupStores(1, g, [1, 2]) === 2);
chk("and read back", C.groupStores(g).length === 2);
chk("another account's store can't be added", C.setGroupStores(1, g, [1, 2, 9]) === 2);

const g2 = C.saveGroup(1, { name: "City stores" });
C.setGroupStores(1, g2, [2, 3]);
chk("a store moved to another group leaves the first",
  C.groupStores(g).length === 1 && C.groupStores(g2).length === 2);
C.setGroupStores(1, g, [1, 2]);
C.setGroupStores(1, g2, [3]);

console.log("\n── adopting an existing pricebook ──");
const ad = C.adoptFrom(1, 1);
console.log(`   took ${ad.added}, skipped ${ad.skipped} with no barcode`);
chk("items with barcodes are taken", ad.added === 2);
chk("one without a barcode is skipped rather than guessed at", ad.skipped === 1);
chk("the central list holds them", C.master(1).length === 2);
chk("another account's list is empty", C.master(2).length === 0);

threw = false;
try { C.saveMaster(1, { name: "No barcode" }); } catch (e) { threw = true; }
chk("a central item without a barcode is refused", threw);

console.log("\n── a plan changes nothing ──");
C.saveMaster(1, { upc: "028200001", name: "Marlboro Red", price: 12.49, cost: 9.85,
  dept: "Tobacco" });
let p = C.plan(1, g, {});
console.log(`   ${p.totals.changes} changes across ${p.totals.stores} stores`);
chk("the plan covers only the group", p.totals.stores === 2);
chk("it finds the price change in both", p.totals.changes === 4);   /* price + cost, ×2 */

const before = JSON.parse(db.prepare("SELECT json FROM configs WHERE store_id=1").get().json);
chk("and nothing has actually moved",
  near(before.plus.find(x => x.upc === "028200001").price, 11.49));

console.log("\n── an override is respected ──");
C.setOverride(2, "028200001", "price", "11.99",
  { reason: "cheaper competitor over the road", who: "Ameer" });
p = C.plan(1, g, {});
const s2 = p.stores.find(x => x.store.id === 2);
console.log(`   store 2: ${s2.changes.length} changes, ${s2.skipped.length} held locally`);
chk("the held price is not in the changes",
  !s2.changes.find(c => c.field === "price" && c.upc === "028200001"));
chk("it's reported as skipped with a reason",
  s2.skipped.some(x => x.field === "price" && x.reason === "held locally"));
chk("and says what it would have been",
  near(s2.skipped.find(x => x.field === "price").wouldBe, 12.49));
chk("but other fields still change", s2.changes.some(c => c.field === "cost"));

console.log("\n── applying it ──");
const r = C.apply(1, g, { who: "Ameer" });
console.log(`   ${r.changed} changes across ${r.stores} stores, ${r.skipped} held`);
const after1 = JSON.parse(db.prepare("SELECT json FROM configs WHERE store_id=1").get().json);
const after2 = JSON.parse(db.prepare("SELECT json FROM configs WHERE store_id=2").get().json);
const after3 = JSON.parse(db.prepare("SELECT json FROM configs WHERE store_id=3").get().json);
chk("store 1 takes the new price",
  near(after1.plus.find(x => x.upc === "028200001").price, 12.49));
chk("store 2 keeps its own", near(after2.plus.find(x => x.upc === "028200001").price, 11.49));
chk("store 2 still takes the new cost",
  near(after2.plus.find(x => x.upc === "028200001").cost, 9.85));
chk("a store outside the group is untouched",
  near(after3.plus.find(x => x.upc === "028200001").price, 11.49 * 1.1));
chk("another account is never touched",
  near(JSON.parse(db.prepare("SELECT json FROM configs WHERE store_id=9").get().json)
    .plus.find(x => x.upc === "028200001").price, 11.49));

chk("the push is recorded", C.pushes(1).length === 1 && C.pushes(1)[0].who === "Ameer");
p = C.plan(1, g, {});
chk("running it again finds nothing left to do", p.totals.changes === 0);

console.log("\n── clearing an override ──");
C.clearOverride(2, "028200001", "price");
p = C.plan(1, g, {});
chk("the store rejoins the central price", p.totals.changes === 1);
C.apply(1, g, { who: "Ameer" });
chk("and takes it", near(JSON.parse(db.prepare("SELECT json FROM configs WHERE store_id=2")
  .get().json).plus.find(x => x.upc === "028200001").price, 12.49));

console.log("\n── things that can't be pushed ──");
C.saveMaster(1, { upc: "999999", name: "Not stocked anywhere", price: 5 });
p = C.plan(1, g, {});
chk("an item no store carries is reported as missing, not created",
  p.totals.missing === 2);
C.saveMaster(1, { upc: "049000028", name: "Coke 20oz", price: 2.79, dept: "Fizzy Drinks" });
p = C.plan(1, g, {});
chk("a section that doesn't exist locally is skipped with a reason",
  p.stores[0].skipped.some(x => x.field === "dept" && x.reason.includes("no section")));
chk("but the price on that item still changes",
  p.stores[0].changes.some(c => c.upc === "049000028" && c.field === "price"));

console.log("\n── scheduling ──");
const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
chk("a change can be scheduled",
  C.schedule(1, [{ upc: "028200001", field: "price", value: "13.29", effective: soon,
    groupId: g, who: "Ameer" }]) === 1);
threw = false;
try { C.schedule(1, [{ upc: "x", field: "price", value: "1", effective: "next tuesday" }]); }
catch (e) { threw = true; }
chk("a date has to be a date", threw);

let run = C.runScheduled(1, "schedule");
chk("a future change doesn't fire", run.applied === 0);
chk("and is still listed as pending", C.scheduled(1).length === 1);

C.schedule(1, [{ upc: "028200001", field: "price", value: "13.99", effective: past,
  groupId: g, who: "Ameer" }]);
run = C.runScheduled(1, "schedule");
console.log(`   applied ${run.applied}, pushed ${run.pushed} changes`);
chk("a due change fires", run.applied === 1);
chk("and reaches the stores", near(JSON.parse(
  db.prepare("SELECT json FROM configs WHERE store_id=1").get().json)
  .plus.find(x => x.upc === "028200001").price, 13.99));
chk("running again does nothing", C.runScheduled(1, "schedule").applied === 0);
chk("the future one is still waiting", C.scheduled(1).length === 1);
chk("and can be cancelled",
  (C.cancelScheduled(1, C.scheduled(1)[0].id), C.scheduled(1).length === 0));

console.log("\n── pushing one item only ──");
C.saveMaster(1, { upc: "049000028", name: "Coke 20oz", price: 3.09 });
const one = C.apply(1, g, { who: "Ameer", only: ["049000028"] });
chk("only the named item moves", one.changed === 2);
chk("and the rest is unchanged", near(JSON.parse(
  db.prepare("SELECT json FROM configs WHERE store_id=1").get().json)
  .plus.find(x => x.upc === "028200001").price, 13.99));

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  one edit reaches many stores, and local prices hold");
process.exit(bad ? 1 : 0);
