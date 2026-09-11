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
  if (i < 0) { console.log("FAIL could not find " + a); process.exit(1); }
  return s.slice(i, s.indexOf(b, i)); };
db.exec(grab("lib/db.js", "CREATE TABLE IF NOT EXISTS accounts", "`);"));
/* The columns the running server adds by migration. Without these the fixture
   isn't the schema the code actually meets. */
["client_id TEXT", "terminal_id INTEGER"].forEach(c => {
  try { db.exec("ALTER TABLE sales ADD COLUMN " + c); } catch (e) {}
});

const R = require("../lib/reports.js");
let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };
const near = (a, b) => Math.abs(a - b) < 0.02;
/* Percentages come back rounded to one decimal, so comparing them against an
   unrounded expectation fails by a thousandth and teaches nothing. */
const nearPct = (a, b) => Math.abs(a - b) < 0.06;

db.prepare("INSERT INTO accounts (id,email,pass_hash) VALUES (1,'a@b.c','x')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (1,1,'Shop')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (2,1,'Other')").run();

const DEPTS = { D1: "Drinks", D2: "Tobacco" };
let seq = 0;

/* at: how many days ago, and at what hour */
function sale(storeId, daysAgo, hour, cashier, lines, extra = {}) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  d.setUTCHours(hour, 30, 0, 0);
  const at = d.toISOString().slice(0, 19).replace("T", " ");
  const ret = !!extra.ret;
  const total = lines.reduce((a, l) => a + l.price * l.q, 0) * (ret ? -1 : 1)
    - (extra.disc || 0);
  const json = { ret, lines, pays: extra.pays || [{ mop: "Cash", amt: total }],
    disc: extra.disc || 0, against: extra.against, manualDisc: extra.disc ? { v: extra.disc } : null,
    voidedLines: extra.voidedLines };
  db.prepare("INSERT INTO sales (store_id, seq, at, cashier, total, is_return, json) " +
    "VALUES (?,?,?,?,?,?,?)")
    .run(storeId, ++seq, at, cashier, +total.toFixed(2), ret ? 1 : 0, JSON.stringify(json));
  return total;
}

/* --- a fortnight of trade --- */
for (let d = 1; d <= 14; d++) {
  sale(1, d, 8, "Dana", [{ pluId: "P1", n: "Coffee", q: 2, price: 1.99, cost: 0.31, deptId: "D1" }]);
  sale(1, d, 8, "Dana", [{ pluId: "P1", n: "Coffee", q: 1, price: 1.99, cost: 0.31, deptId: "D1" }]);
  sale(1, d, 17, "Sam", [{ pluId: "P2", n: "Marlboro", q: 1, price: 11.49, cost: 9.20, deptId: "D2" }]);
}
/* a product with no cost recorded anywhere */
sale(1, 3, 12, "Dana", [{ pluId: "P3", n: "Mystery item", q: 1, price: 5.00, deptId: "D1" }]);
/* a refund with no original */
sale(1, 2, 14, "Sam", [{ pluId: "P2", n: "Marlboro", q: 1, price: 11.49, cost: 9.20, deptId: "D2" }],
  { ret: true });
/* a heavy discount */
sale(1, 2, 15, "Sam", [{ pluId: "P2", n: "Marlboro", q: 1, price: 11.49, cost: 9.20, deptId: "D2" }],
  { disc: 6.00 });
/* a 3am sale */
sale(1, 4, 3, "Sam", [{ pluId: "P1", n: "Coffee", q: 1, price: 1.99, cost: 0.31, deptId: "D1" }]);
/* another store's trade, which must never appear */
sale(2, 1, 10, "Nobody", [{ pluId: "PX", n: "Not ours", q: 99, price: 100, deptId: "D9" }]);

console.log("── a sale stored the way a till sends it ──");
/* The real failure: string comparison only reaches the "T" when the date part
   is identical, so an ISO sale is invisible exactly on the day the window ends
   — and every window ends today. Today's trade was missing from every report. */
const isoNow = new Date().toISOString();
db.prepare("INSERT INTO sales (store_id,seq,at,cashier,total,is_return,json) " +
  "VALUES (1,999,?,?,?,0,?)")
  .run(isoNow, "Dana", 7.77,
    JSON.stringify({ lines: [{ pluId: "P1", n: "Coffee", q: 1, price: 7.77, cost: 1, deptId: "D1" }],
      pays: [{ mop: "Cash", amt: 7.77 }] }));

const rawSeen = db.prepare(
  "SELECT COUNT(*) n FROM sales WHERE store_id = 1 AND at <= ?")
  .get(new Date().toISOString().slice(0, 19).replace("T", " ")).n;
const total = db.prepare("SELECT COUNT(*) n FROM sales WHERE store_id = 1").get().n;
console.log(`   an ISO row on today's date: ${total - rawSeen} of ${total} invisible to a raw range`);
chk("the raw comparison really does lose it", rawSeen < total);

/* Written through stamp(), the way the server now does, it must be found. */
db.prepare("UPDATE sales SET at = ? WHERE seq = 999")
  .run(require("../lib/when.js").stamp(isoNow));
const fixed = R.overview(1, 30);
chk("stored canonically, today's sale is counted", fixed.sales === 47,
  `saw ${fixed.sales}`);
db.prepare("DELETE FROM sales WHERE seq = 999").run();

console.log("\n── the headline ──");
const ov = R.overview(1, 30);
console.log(`   ${ov.sales} sales, ${ov.taken} taken, basket ${ov.basket}, ` +
  `${ov.returns} refund(s)`);
chk("counts this store only", ov.sales === 46);
chk("another store's takings never appear", ov.taken < 1000);
chk("basket is takings over sales", near(ov.basket, ov.taken / ov.sales));
chk("refunds are counted", ov.returns === 1);
chk("a previous window is offered for comparison", ov.previous !== undefined);

console.log("\n── when it's busy ──");
const b = R.busy(1, 30);
const peak = b.hours.slice().sort((x, y) => y.n - x.n)[0];
console.log(`   busiest hour ${peak.hour}:00 with ${peak.n} sales over ${b.openDays} open days`);
chk("the morning rush is found", peak.hour === 8);
chk("hours are averaged per open day, not per calendar day", b.openDays <= 15);
chk("every hour is present even when empty", b.hours.length === 24);
chk("weekdays add up to the sales", b.weekdays.reduce((a, d) => a + d.n, 0) === 45);

console.log("\n── what makes money ──");
const pr = R.products(1, 30);
const coffee = pr.find(p => p.pluId === "P1");
const mystery = pr.find(p => p.pluId === "P3");
console.log(`   ${coffee.name}: ${coffee.qty} sold, ${coffee.revenue} revenue, ` +
  `margin ${coffee.margin}%`);
chk("quantities are right", coffee.qty === 43);
chk("revenue is right", near(coffee.revenue, 43 * 1.99));
chk("margin uses the cost recorded on the line",
  nearPct(coffee.margin, (1.99 - 0.31) / 1.99 * 100));
chk("a product with no cost reports margin as unknown, not zero",
  mystery.margin === null && mystery.profit === null);
chk("but its revenue still counts", near(mystery.revenue, 5.00));
chk("sorted by revenue", pr[0].revenue >= pr[1].revenue);

console.log("\n── by department ──");
const de = R.departments(1, 30, DEPTS);
const drinks = de.find(d => d.deptId === "D1");
const tob = de.find(d => d.deptId === "D2");
console.log("   " + de.map(d => `${d.name} ${d.revenue} (${d.share}%)`).join(" · "));
chk("names come from the pricebook passed in", drinks.name === "Drinks");
chk("shares add to about a hundred",
  nearPct(de.reduce((a, d) => a + d.share, 0), 100));
chk("a department with a costless item is flagged partial rather than wrong",
  drinks.margin === null && drinks.partial === true);
chk("a fully costed department gets a margin", tob.margin !== null);

console.log("\n── staff ──");
const st = R.staff(1, 30);
const dana = st.find(s => s.who === "Dana");
const sam = st.find(s => s.who === "Sam");
console.log(`   Dana: ${dana.sales} sales, basket ${dana.basket}, ` +
  `discounts ${dana.discountRate}%`);
console.log(`   Sam:  ${sam.sales} sales, basket ${sam.basket}, ` +
  `discounts ${sam.discountRate}%, refunds ${sam.returnRate}%`);
chk("both are listed", st.length === 2);
chk("baskets are per person", !near(dana.basket, sam.basket));
chk("discount rate is a rate, not a count", sam.discountRate > 0 && sam.discountRate < 100);
chk("refunds are counted against the person who rang them", sam.returns === 1);
chk("a refund is not counted as a sale", dana.sales + sam.sales === 45);

console.log("\n── how they pay ──");
const te = R.tenders(1, 30);
chk("tenders are summarised", te.length >= 1 && te[0].mop === "Cash");
chk("shares add to about a hundred", nearPct(te.reduce((a, t) => a + t.share, 0), 100));

console.log("\n── worth a second look ──");
const ex = R.exceptions(1, 30);
console.log(`   ${ex.refundsNoOriginal.length} refund(s) with no original, ` +
  `${ex.bigDiscounts.length} heavy discount(s), ${ex.afterHours.length} overnight`);
chk("a refund with no original is flagged", ex.refundsNoOriginal.length === 1);
chk("and names who rang it", ex.refundsNoOriginal[0].who === "Sam");
chk("a discount over a quarter is flagged", ex.bigDiscounts.length === 1);
chk("an overnight sale is flagged", ex.afterHours.length === 1);
chk("ordinary sales are not flagged", ex.bigDiscounts.length + ex.afterHours.length < 5);

console.log("\n── one day ──");
const target = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
const dy = R.day(1, target, DEPTS);
console.log(`   ${target}: ${dy.totals.sales} sales, ${dy.totals.taken} taken`);
chk("a single day can be pulled out", dy.totals.sales === 4);
chk("with its hours", dy.hours.length === 24);
chk("and its departments", dy.departments.length >= 1);

console.log("\n── empty windows don't crash ──");
/* Store 3 has never traded. Asking store 1 for "the last day" depended on what
   time the suite ran, which made this pass in the morning and fail at night. */
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (3,1,'Never opened')").run();
const none = R.overview(3, 30);
chk("a store with no sales returns zeros rather than throwing",
  none.sales === 0 && none.taken === 0);
chk("and basket is zero, not NaN", none.basket === 0 && !isNaN(none.basket));
chk("change against an empty previous period is null, not Infinity", none.change === null);
chk("busy handles no sales", R.busy(3, 30).hours.length === 24);
chk("products handles no sales", R.products(3, 30).length === 0);
chk("departments handles no sales", R.departments(3, 30, DEPTS).length === 0);
chk("staff handles no sales", R.staff(3, 30).length === 0);
chk("exceptions handles no sales", R.exceptions(3, 30).refundsNoOriginal.length === 0);
const emptyDay = R.day(1, "1999-01-01", DEPTS);
chk("a day with nothing on it is fine", emptyDay.totals.sales === 0);

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  reports are correct and honest about margin");
process.exit(bad ? 1 : 0);
