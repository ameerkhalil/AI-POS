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

const S = require("../lib/stock.js");
let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };
const near = (a, b) => Math.abs(a - b) < 0.001;

db.prepare("INSERT INTO accounts (id,email,pass_hash) VALUES (1,'a@b.c','x')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (1,1,'Shop')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (2,1,'Other')").run();

const PLUS = [
  { id: "P1", n: "Monster Ultra", upc: "1", price: 3.99, cost: 2.10, deptId: "D1" },
  { id: "P2", n: "Marlboro Red", upc: "2", price: 11.49, cost: 9.20, deptId: "D2" },
  { id: "P3", n: "Coffee 16oz", upc: "3", price: 1.99, cost: 0.31, deptId: "D1" },
  { id: "P4", n: "Untracked thing", upc: "4", price: 5.00, cost: 2.00, deptId: "D1" }
];

console.log("\n── the ledger ──");
S.move(1, { pluId: "P1", qty: 24, kind: "received", cost: 2.10, ref: "INV-1" });
chk("receiving adds", near(S.onHand(1, "P1"), 24));
S.move(1, { pluId: "P1", qty: -2, kind: "sold", ref: "7" });
chk("selling subtracts", near(S.onHand(1, "P1"), 22));
S.move(1, { pluId: "P1", qty: 1, kind: "returned", ref: "8" });
chk("a refund puts it back", near(S.onHand(1, "P1"), 23));

let threw = false;
try { S.move(1, { pluId: "P1", qty: 5, kind: "teleported" }); } catch (e) { threw = true; }
chk("an unknown movement kind is refused", threw);
chk("and nothing was written", near(S.onHand(1, "P1"), 23));

chk("a zero movement is ignored", S.move(1, { pluId: "P1", qty: 0, kind: "sold" }) === 0);
chk("a movement with no product is ignored",
  S.move(1, { pluId: "", qty: 5, kind: "sold" }) === 0);

console.log("\n── stores don't leak into each other ──");
S.move(2, { pluId: "P1", qty: 100, kind: "received" });
chk("store 2 has its own stock", near(S.onHand(2, "P1"), 100));
chk("store 1 is unaffected", near(S.onHand(1, "P1"), 23));
chk("bulk read is per store", near(S.allOnHand(1).P1, 23) && near(S.allOnHand(2).P1, 100));

console.log("\n── selling through a real sale ──");
const sale = { seq: 41, cashier: "Dana", ret: false, lines: [
  { pluId: "P1", q: 3, n: "Monster" },
  { pluId: "P2", q: 1, n: "Marlboro" },
  { pluId: null, q: 1, n: "Grocery (open)", open: true },
  { pluId: null, q: 1, n: "Bottle deposit", auto: true },
  { pluId: "P4", q: 2, n: "Untracked thing" }
]};
S.setSettings(1, "P4", { tracked: 0 });
const tracked = id => (S.settings(1)[id] || { tracked: 1 }).tracked;
S.applySale(1, sale, tracked);
chk("tracked lines decrement", near(S.onHand(1, "P1"), 20) && near(S.onHand(1, "P2"), -1));
chk("an open-department ring writes nothing", Object.keys(S.allOnHand(1)).indexOf("null") === -1);
chk("an untracked product writes nothing", near(S.onHand(1, "P4"), 0));
chk("selling below zero is allowed, not blocked", near(S.onHand(1, "P2"), -1));

S.applySale(1, { seq: 42, cashier: "Dana", ret: true,
  lines: [{ pluId: "P1", q: 1 }] }, tracked);
chk("a refund adds back", near(S.onHand(1, "P1"), 21));

console.log("\n── receiving from an invoice ──");
const r = S.receive(1, { who: "Ameer", ref: "INV-882", lines: [
  { pluId: "P2", qty: 2, caseQty: 10, cost: 9.10 },     // two cases of ten
  { pluId: "P3", qty: 50, cost: 0.29 }
]});
console.log(`   received ${r.received} lines, ${r.units} units`);
chk("cases multiply out", near(S.onHand(1, "P2"), 19));
chk("loose units don't", near(S.onHand(1, "P3"), 50));
chk("the unit count is right", near(r.units, 70));
const hist = S.history(1, "P2", 10);
chk("the cost at the time is kept on the movement",
  hist.find(h => h.kind === "received" && near(h.cost, 9.10)));

console.log("\n── counting ──");
const cid = S.openCount(1, { who: "Ameer", scope: "all" });
/* P1 should be 21; say we physically find 19 — two missing */
const l1 = S.countLine(1, cid, "P1", 19, 2.10);
console.log(`   P1 expected ${l1.expected}, counted ${l1.counted}, variance ${l1.variance}`);
chk("expected is captured at the moment of counting", near(l1.expected, 21));
chk("variance is counted minus expected", near(l1.variance, -2));

/* a sale during the count must not become shrink */
S.applySale(1, { seq: 43, cashier: "Dana", lines: [{ pluId: "P1", q: 1 }] }, tracked);
chk("a sale during the count moves the on-hand", near(S.onHand(1, "P1"), 20));

S.countLine(1, cid, "P3", 50, 0.29);        // correct
S.countLine(1, cid, "P2", 21, 9.10);        // two more than expected

const res = S.closeCount(1, cid, "Ameer");
console.log(`   ${res.lines} lines, ${res.adjusted} adjusted, ` +
  `shrink ${res.shrinkUnits} units worth ${res.shrinkValue}`);
chk("only differing lines are adjusted", res.adjusted === 2);
chk("shrink counts only losses", near(res.shrinkUnits, 2));
chk("shrink is valued at cost", near(res.shrinkValue, 4.20));
chk("the on-hand now matches what was counted plus the sale since",
  near(S.onHand(1, "P1"), 18));
chk("an over is applied too", near(S.onHand(1, "P2"), 21));
chk("a line that matched is left alone", near(S.onHand(1, "P3"), 50));

threw = false;
try { S.closeCount(1, cid, "Ameer"); } catch (e) { threw = true; }
chk("a count can't be closed twice", threw);
threw = false;
try { S.closeCount(1, 9999, "Ameer"); } catch (e) { threw = true; }
chk("closing a count that isn't yours is refused", threw);

console.log("\n── what to order ──");
S.setSettings(1, "P1", { par: 24, target: 48, case_qty: 12, tracked: 1 });
S.setSettings(1, "P3", { par: 100, target: 200, tracked: 1 });
S.setSettings(1, "P2", { par: 5, target: 20, tracked: 1 });
const ro = S.reorder(1, PLUS);
console.log("   " + ro.map(x => `${x.name}: have ${x.have}, need ${x.need}` +
  (x.cases ? ` (${x.cases} cases)` : "")).join(" · "));
chk("only items at or below par appear", ro.length === 2 && !ro.find(x => x.pluId === "P2"));
const p1 = ro.find(x => x.pluId === "P1");
chk("need is rounded up to whole cases", p1.cases === 3 && near(p1.need, 36));
chk("value of the order uses cost", near(p1.value, 75.60));
chk("an item with no par is never suggested", !ro.find(x => x.pluId === "P4"));
chk("the most urgent is first", ro[0].pluId === "P3");

console.log("\n── shrink and waste ──");
S.move(1, { pluId: "P3", qty: -4, kind: "waste", who: "Dana", note: "burnt" });
const sh = S.shrink(1, 30);
console.log(`   counted losses ${sh.countedUnits} units, waste ${sh.wasteUnits} units`);
chk("counted losses are separate from waste", near(sh.countedUnits, 2) && near(sh.wasteUnits, 4));
chk("an over is not counted as shrink", !sh.byPlu.find(p => p.pluId === "P2"));

console.log("\n── valuation ──");
const v = S.valuation(1, PLUS);
console.log(`   ${v.units} units, ${v.atCost} at cost, ${v.atRetail} at retail`);
chk("value at cost", near(v.atCost, 18 * 2.10 + 21 * 9.20 + 46 * 0.31));
chk("value at retail", near(v.atRetail, 18 * 3.99 + 21 * 11.49 + 46 * 1.99));
chk("untracked stock is excluded", !v.negatives.find(n => n.pluId === "P4"));

S.move(1, { pluId: "P1", qty: -100, kind: "sold", ref: "99" });
chk("a negative on hand is reported rather than hidden",
  S.valuation(1, PLUS).negatives.some(n => n.pluId === "P1"));

console.log("\n── history explains itself ──");
const h = S.history(1, "P1", 50);
chk("every movement is readable back", h.length >= 6);
chk("and each says why", h.every(x => x.kind && x.at));
console.log("   " + h.slice(0, 5).map(x => `${x.kind} ${x.qty > 0 ? "+" : ""}${x.qty}`).join(", "));

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  the inventory engine is correct");
process.exit(bad ? 1 : 0);
