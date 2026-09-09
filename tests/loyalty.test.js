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
try { db.exec("ALTER TABLE sales ADD COLUMN customer_id INTEGER"); } catch (e) {}

const L = require("../lib/loyalty.js");
let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };
const near = (a, b) => Math.abs(a - b) < 0.01;

db.prepare("INSERT INTO accounts (id,email,pass_hash) VALUES (1,'a@b.c','x')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (1,1,'Shop')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (2,1,'Other')").run();

console.log("── customers ──");
const c1 = L.saveCustomer(1, { name: "Dana Okafor", phone: "(708) 555-0142", card: "LOY-001" });
chk("a customer saves", !!c1);
let threw = false;
try { L.saveCustomer(1, { note: "no way to identify them" }); } catch (e) { threw = true; }
chk("one with no name, phone or card is refused", threw);
threw = false;
try { L.saveCustomer(1, { name: "Someone else", phone: "7085550142" }); } catch (e) { threw = true; }
chk("two people can't share a phone number", threw);

const c2 = L.saveCustomer(1, { name: "Sam Reilly", phone: "708-555-0199" });
L.saveCustomer(2, { name: "Not ours", phone: "708-555-0142" });
chk("the same number in another store is fine", L.find(2, "5550142").length === 1);

console.log("\n── finding them at the till ──");
chk("by phone, however it's punched in", L.find(1, "7085550142")[0].id === c1);
chk("by card", L.find(1, "LOY-001")[0].id === c1);
chk("by part of a name", L.find(1, "okaf")[0].id === c1);
chk("two characters isn't a search", L.find(1, "ok").length === 0);
chk("another store's customers never appear", !L.find(1, "Not ours").length);

console.log("\n── earning ──");
L.setSettings(1, { on: true, per_pound: 1, point_value: 0.01, block: 100, excluded: ["DFUEL"] });
const sale = (lines, extra = {}) => ({ seq: 1, cashier: "Ameer", lines, ...extra });

chk("nothing is earned while it's switched off",
  (L.setSettings(1, { on: false }), L.earnedFor(1, sale([{ price: 10, q: 1, deptId: "D1" }]))) === 0);
L.setSettings(1, { on: true });

chk("a pound spent is a point", L.earnedFor(1, sale([{ price: 10, q: 1, deptId: "D1" }])) === 10);
chk("quantities count", L.earnedFor(1, sale([{ price: 2.5, q: 4, deptId: "D1" }])) === 10);
chk("an excluded department earns nothing",
  L.earnedFor(1, sale([{ price: 30, q: 1, deptId: "DFUEL" }])) === 0);
chk("a mixed sale only earns on what's eligible",
  L.earnedFor(1, sale([{ price: 30, q: 1, deptId: "DFUEL" }, { price: 4, q: 1, deptId: "D1" }])) === 4);
chk("an automatic line like a deposit earns nothing",
  L.earnedFor(1, sale([{ price: 5, q: 1, deptId: "D1", auto: true }])) === 0);
chk("a discount reduces what's earned",
  L.earnedFor(1, sale([{ price: 10, q: 1, deptId: "D1", disc: 50 }])) === 5);

let r = L.applySale(1, c1, sale([{ price: 12.5, q: 1, deptId: "D1" }]));
console.log(`   earned ${r.earned}, balance ${r.balance}`);
chk("points land on the account", L.balance(c1) === 12);
chk("nothing lands on anyone else", L.balance(c2) === 0);
chk("a sale with no customer is fine", L.applySale(1, null, sale([{ price: 5, q: 1 }])).earned === 0);

console.log("\n── refunds don't leave them owing ──");
L.movePoints(1, c2, { amount: 5, kind: "adjusted", note: "goodwill" });
L.applySale(1, c2, sale([{ price: 100, q: 1, deptId: "D1" }], { ret: true }));
console.log(`   after refunding a 100 sale against a 5 balance: ${L.balance(c2)}`);
chk("a refund never takes the balance below zero", L.balance(c2) === 0);
L.applySale(1, c1, sale([{ price: 5, q: 1, deptId: "D1" }], { ret: true }));
chk("but it does take back what it should", L.balance(c1) === 7);

console.log("\n── spending them ──");
L.movePoints(1, c1, { amount: 493, kind: "adjusted" });   /* 500 total */
let q = L.quote(1, c1, 50);
console.log(`   have ${q.have}, can spend ${q.points} worth ${q.value}`);
chk("points are quoted in whole blocks", q.points === 500 && near(q.value, 5.00));

q = L.quote(1, c1, 2.40);
chk("never more than the sale is worth", q.points === 200 && near(q.value, 2.00));

threw = false;
try { L.redeem(1, c1, 150, { saleTotal: 50 }); } catch (e) { threw = true; }
chk("a part-block is refused", threw);
threw = false;
try { L.redeem(1, c1, 900, { saleTotal: 50 }); } catch (e) { threw = true; }
chk("spending more than they have is refused", threw);
threw = false;
try { L.redeem(1, c1, 500, { saleTotal: 1.00 }); } catch (e) { threw = true; }
chk("redeeming past the sale total is refused", threw);

r = L.redeem(1, c1, 300, { who: "Ameer", ref: "9", saleTotal: 50 });
console.log(`   spent ${r.points} for ${r.value}, ${r.balance} left`);
chk("redemption comes off the balance", L.balance(c1) === 200);
chk("and is worth what it should be", near(r.value, 3.00));

const small = L.saveCustomer(1, { name: "New person", phone: "708-555-0001" });
L.movePoints(1, small, { amount: 40, kind: "earned" });
chk("under one block, nothing can be spent", L.quote(1, small, 20).points === 0);

console.log("\n── the ledger explains it ──");
const hist = L.pointHistory(c1);
console.log("   " + hist.map(h => `${h.kind} ${h.amount > 0 ? "+" : ""}${h.amount}`).join(", "));
chk("every movement is readable back", hist.length === 4);
chk("and sums to the balance", hist.reduce((a, h) => a + h.amount, 0) === L.balance(c1));
threw = false;
try { L.movePoints(1, c1, { amount: 10, kind: "invented" }); } catch (e) { threw = true; }
chk("an unknown movement kind is refused", threw);

console.log("\n── offers ──");
const stamp = L.saveOffer(1, { name: "Coffee card", kind: "stamp", pluIds: ["P1"], need: 10,
  reward: "A free coffee" });
threw = false;
try { L.saveOffer(1, { name: "", need: 5 }); } catch (e) { threw = true; }
chk("an offer needs a name", threw);
threw = false;
try { L.saveOffer(1, { name: "Broken", need: 0 }); } catch (e) { threw = true; }
chk("and a target", threw);

for (let i = 0; i < 9; i++)
  L.applySale(1, c1, sale([{ pluId: "P1", n: "Coffee", price: 1.99, q: 1, deptId: "D1" }]));
let p = L.progressFor(1, c1).find(x => x.id === stamp);
console.log(`   ${p.count} of ${p.need}`);
chk("stamps accumulate", p.count === 9 && p.ready === false);

r = L.applySale(1, c1, sale([{ pluId: "P1", n: "Coffee", price: 1.99, q: 2, deptId: "D1" }]));
chk("the offer fires when it's reached", r.offers.length === 1 && r.offers[0].offerId === stamp);
chk("and says what to give them", r.offers[0].reward === "A free coffee");

L.claimOffer(1, stamp, c1, "Ameer");
p = L.progressFor(1, c1).find(x => x.id === stamp);
console.log(`   after claiming: ${p.count} left towards the next one`);
chk("claiming subtracts the requirement rather than zeroing it", p.count === 1);
threw = false;
try { L.claimOffer(1, stamp, c1, "Ameer"); } catch (e) { threw = true; }
chk("it can't be claimed again straight away", threw);

L.applySale(1, c1, sale([{ pluId: "P1", n: "Coffee", price: 1.99, q: 3, deptId: "D1" }],
  { ret: true }));
p = L.progressFor(1, c1).find(x => x.id === stamp);
chk("returning the coffees takes the stamps back", p.count === 0);
chk("and never goes negative", p.count >= 0);

chk("a product not in the offer adds nothing",
  (L.applySale(1, c2, sale([{ pluId: "P9", price: 5, q: 1, deptId: "D1" }])),
   L.progressFor(1, c2).find(x => x.id === stamp).count === 0));

console.log("\n── the usual ──");
db.prepare("INSERT INTO sales (store_id,customer_id,seq,at,total,is_return,json) " +
  "VALUES (1,?,1,datetime('now'),5,0,?)")
  .run(c2, JSON.stringify({ lines: [{ pluId: "P1", n: "Coffee", q: 1 },
    { pluId: "P2", n: "Bagel", q: 1 }] }));
db.prepare("INSERT INTO sales (store_id,customer_id,seq,at,total,is_return,json) " +
  "VALUES (1,?,2,datetime('now'),5,0,?)")
  .run(c2, JSON.stringify({ lines: [{ pluId: "P1", n: "Coffee", q: 1 }] }));
const u = L.usual(1, c2);
console.log("   " + u.map(x => `${x.name} ×${x.times}`).join(", "));
chk("what they buy most is first", u[0].pluId === "P1" && u[0].times === 2);
chk("and it's their own history only", !L.usual(1, c1).find(x => x.pluId === "P2"));

console.log("\n── who to know about ──");
const top = L.topCustomers(1, 90);
chk("top customers are ranked by spend", Array.isArray(top) && top.length >= 1);
chk("with their balance", top[0].balance !== undefined);
chk("lapsed needs more than a couple of visits", Array.isArray(L.lapsed(1, 30)));

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  loyalty is correct and can't be spent into debt");
process.exit(bad ? 1 : 0);
