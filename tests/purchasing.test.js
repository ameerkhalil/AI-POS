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

const STOCK = require("../lib/stock.js");
const P = require("../lib/purchasing.js");
let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };
const near = (a, b) => Math.abs(a - b) < 0.01;

db.prepare("INSERT INTO accounts (id,email,pass_hash) VALUES (1,'a@b.c','x')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (1,1,'Shop')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (2,1,'Other')").run();

console.log("── vendors ──");
const vid = P.saveVendor(1, { name: "Eby-Brown", rep: "Mike", phone: "708-555-0100",
  terms: "Net 14", delivers: "Tue, Fri" });
chk("a vendor saves", !!vid);
P.saveVendor(1, { id: vid, name: "Eby-Brown", rep: "Mike R", phone: "708-555-0100" });
chk("and edits", P.vendors(1)[0].rep === "Mike R");
let threw = false;
try { P.saveVendor(1, { name: "  " }); } catch (e) { threw = true; }
chk("a vendor with no name is refused", threw);

const v2 = P.saveVendor(1, { name: "Coca-Cola" });
P.saveVendor(2, { name: "Someone else's vendor" });
chk("vendors are per store", P.vendors(1).length === 2);
P.archiveVendor(1, v2, true);
chk("archiving hides it", P.vendors(1).length === 1);
chk("but it can still be listed", P.vendors(1, true).length === 2);

console.log("\n── an order ──");
const po = P.createOrder(1, { vendorId: vid, ref: "PO-1", who: "Ameer", due: "2026-09-20",
  lines: [
    { pluId: "P1", name: "Monster Ultra", ordered: 48, caseQty: 24, cost: 1.80 },
    { pluId: "P2", name: "Marlboro Red", ordered: 20, cost: 9.20 }
  ]});
let o = P.order(1, po);
console.log(`   ${o.lines.length} lines, ${o.unitsOrdered} units, ${o.expectedCost} expected`);
chk("the order is a draft", o.state === "draft");
chk("units are totalled", near(o.unitsOrdered, 68));
chk("expected cost is totalled", near(o.expectedCost, 48 * 1.80 + 20 * 9.20));
chk("the vendor comes back with it", o.vendor.name === "Eby-Brown");

threw = false;
try { P.receiveOrder(1, po, { lines: [{ pluId: "P1", qty: 1 }] }); } catch (e) { threw = true; }
chk("you can't receive against a draft", threw);

P.setLines(1, po, [
  { pluId: "P1", name: "Monster Ultra", ordered: 72, caseQty: 24, cost: 1.80 },
  { pluId: "P2", name: "Marlboro Red", ordered: 20, cost: 9.20 },
  { pluId: "P3", name: "Coffee cups", ordered: 500, cost: 0.04 }
]);
o = P.order(1, po);
chk("lines can be edited before sending", o.lines.length === 3 && near(o.unitsOrdered, 592));

o = P.send(1, po, "Ameer");
chk("sending records the time", !!o.sent_at && o.state === "sent");
threw = false;
try { P.send(1, po, "Ameer"); } catch (e) { threw = true; }
chk("it can't be sent twice", threw);

console.log("\n── nothing has moved yet ──");
chk("stock is untouched by an order", STOCK.onHand(1, "P1") === 0);
const oo = P.onOrder(1);
console.log(`   on order: ${Object.entries(oo).map(([k, v]) => k + " " + v).join(", ")}`);
chk("but it counts as on order", near(oo.P1, 72) && near(oo.P3, 500));

console.log("\n── a short delivery ──");
/* two cases of Monster instead of three, the cigarettes in full, no cups */
let r = P.receiveOrder(1, po, { who: "Ameer", invoice: "INV-9001", lines: [
  { pluId: "P1", qty: 2, caseQty: 24, cost: 1.95 },
  { pluId: "P2", qty: 20, cost: 9.20 }
]});
console.log(`   state ${r.state}, ${r.unitsReceived} of ${r.unitsOrdered} units`);
chk("a partial delivery is accepted", r.state === "part");
chk("stock moved for what arrived", near(STOCK.onHand(1, "P1"), 48));
chk("and nothing for what didn't", STOCK.onHand(1, "P3") === 0);
chk("the shortfall is visible",
  r.order.lines.find(l => l.plu_id === "P1").outstanding === 24);
chk("what's still on order drops accordingly", near(P.onOrder(1).P1, 24));
chk("what was actually charged is kept separately from what was expected",
  r.order.lines.find(l => l.plu_id === "P1").paid === 1.95 &&
  r.order.lines.find(l => l.plu_id === "P1").cost === 1.80);

const hist = STOCK.history(1, "P1", 10);
chk("the ledger records the invoice number", hist[0].ref === "INV-9001");
chk("and the cost that was actually paid", near(hist[0].cost, 1.95));

console.log("\n── the rest turns up ──");
r = P.receiveOrder(1, po, { who: "Sam", invoice: "INV-9014", lines: [
  { pluId: "P1", qty: 1, caseQty: 24, cost: 1.95 },
  { pluId: "P3", qty: 500, cost: 0.04 }
]});
console.log(`   state ${r.state}, ${r.unitsReceived} of ${r.unitsOrdered}`);
chk("the order completes", r.state === "received");
chk("stock is now full", near(STOCK.onHand(1, "P1"), 72) && near(STOCK.onHand(1, "P3"), 500));
chk("nothing is left on order", Object.keys(P.onOrder(1)).length === 0);
chk("both deliveries are recorded", P.order(1, po).receipts.length === 2);
chk("the order is closed", !!P.order(1, po).closed_at);

threw = false;
try { P.setLines(1, po, [{ pluId: "P1", ordered: 1 }]); } catch (e) { threw = true; }
chk("a closed order can't be edited", threw);

console.log("\n── over-delivery and mistakes ──");
const po2 = P.createOrder(1, { vendorId: vid, lines: [{ pluId: "P2", ordered: 10, cost: 9.20 }] });
P.send(1, po2, "Ameer");
r = P.receiveOrder(1, po2, { lines: [{ pluId: "P2", qty: 12, cost: 9.20 }] });
chk("more than ordered is accepted rather than rejected", r.state === "received");
chk("and the extra reaches stock", near(STOCK.onHand(1, "P2"), 32));

threw = false;
try { P.receiveOrder(1, po2, { lines: [{ pluId: "P9", qty: 1 }] }); } catch (e) { threw = true; }
chk("receiving something not on the order is refused", threw);
threw = false;
try { P.receiveOrder(1, po2, { lines: [] }); } catch (e) { threw = true; }
chk("receiving nothing is refused", threw);

console.log("\n── cancelling ──");
const po3 = P.createOrder(1, { lines: [{ pluId: "P1", ordered: 5, cost: 1.80 }] });
P.send(1, po3, "Ameer");
P.cancel(1, po3);
chk("an untouched order cancels", P.order(1, po3).state === "cancelled");
threw = false;
try { P.cancel(1, po); } catch (e) { threw = true; }
chk("one that's been delivered cannot", threw);

console.log("\n── the chase list ──");
const po4 = P.createOrder(1, { vendorId: vid, due: "2020-01-01",
  lines: [{ pluId: "P1", ordered: 24, cost: 1.80 }] });
P.send(1, po4, "Ameer");
const out = P.outstanding(1);
console.log(`   ${out.length} outstanding, ${out.filter(x => x.overdue).length} overdue`);
chk("sent-but-undelivered orders are listed", out.length === 1);
chk("a past due date is flagged", out[0].overdue === true);
chk("cancelled and completed orders are not chased", !out.find(x => x.id === po3 || x.id === po));

console.log("\n── vendor summary ──");
const vs = P.vendorSummary(1, vid, 365);
console.log(`   ${vs.orders} orders, ${vs.spend} spent, fill rate ${vs.fillRate}%`);
/* po, po2 and po4 carry this vendor; po3 was created without one. */
chk("only that vendor's orders are counted", vs.orders === 3);
chk("an order with no vendor isn't attributed to them",
  P.vendorSummary(1, v2, 365).orders === 0);
chk("spend uses what was charged", vs.spend > 0);
chk("fill rate is received over ordered", vs.fillRate != null && vs.fillRate <= 100);

console.log("\n── straight from the reorder list ──");
const made = P.fromReorder(1, { who: "Ameer",
  items: [{ pluId: "P1", name: "Monster", need: 48, caseQty: 24, cost: 1.80 },
          { pluId: "P5", name: "Crisps", need: 30, cost: 0.60 }],
  vendorOf: { P1: vid } });
console.log(`   made ${made.length} draft order(s)`);
chk("one order per vendor plus a catch-all", made.length === 2);
chk("the vendor's items go to the vendor",
  P.order(1, made.find(m => m.vendorId === vid).id).lines[0].plu_id === "P1");
chk("the rest land on an unassigned order",
  P.order(1, made.find(m => m.vendorId === null).id).lines[0].plu_id === "P5");
chk("they start as drafts", P.order(1, made[0].id).state === "draft");

console.log("\n── store isolation ──");
chk("another store sees none of this", P.list(2).length === 0);
chk("and cannot open the order", P.order(2, po) === null);

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  purchasing is correct, including short deliveries");
process.exit(bad ? 1 : 0);
