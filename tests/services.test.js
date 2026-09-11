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

const S = require("../lib/services.js");
let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };
const near = (a, b) => Math.abs(a - b) < 0.005;

db.prepare("INSERT INTO accounts (id,email,pass_hash) VALUES (1,'a@b.c','x')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (1,1,'Forecourt')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (2,1,'Other')").run();

console.log("── nothing works until it's switched on ──");
let threw = false;
try { S.record(1, "money_order", { face: 100, fee: 1.5, reference: "A1" }); }
catch (e) { threw = true; }
chk("a money order is refused while it's off", threw);

S.setSettings(1, { moneyOrders: true, mo_fee: 1.50, mo_max: 1000,
  lottery: true, lotto_max: 600, billPay: true, bp_fee: 1.50,
  billers: ["ComEd", "Nicor Gas"] });
chk("settings save", S.settings(1).moneyOrders === true);
chk("and billers with them", S.settings(1).billers.includes("ComEd"));
chk("another store is unaffected", S.settings(2).moneyOrders === false);

console.log("\n── a money order ──");
/* The whole point: $500 face plus $1.50 fee is $501.50 into the drawer, but
   only $1.50 of income. */
let r = S.record(1, "money_order", { face: 500, fee: 1.50, reference: "MO-100045",
  payee: "ComEd", who: "Dana", shiftId: 7 });
console.log(`   face ${r.face}, fee ${r.fee}, into the drawer ${r.cash}`);
chk("the drawer takes face plus fee", near(r.cash, 501.50));
chk("the fee is separate from the face", near(r.fee, 1.5) && near(r.face, 500));

threw = false;
try { S.record(1, "money_order", { face: 500, fee: 1.5 }); } catch (e) { threw = true; }
chk("a serial number is required", threw);
threw = false;
try { S.record(1, "money_order", { face: 1500, fee: 1.5, reference: "X" }); }
catch (e) { threw = true; }
chk("over the store's limit is refused", threw);
threw = false;
try { S.record(1, "money_order", { face: 0, fee: 1.5, reference: "X" }); } catch (e) { threw = true; }
chk("a zero money order is refused", threw);

console.log("\n── a lottery payout ──");
r = S.record(1, "lottery_payout", { face: 120, who: "Dana", shiftId: 7,
  reference: "T-889201" });
console.log(`   paid out ${Math.abs(r.cash)} — drawer goes ${r.cash}`);
chk("the drawer goes down", near(r.cash, -120));
chk("and it isn't income", near(r.fee, 0));

threw = false;
try { S.record(1, "lottery_payout", { face: 5000 }); } catch (e) { threw = true; }
chk("over the state threshold is refused rather than paid",
  threw, "the shop would be paying its own money");

console.log("\n── a bill payment ──");
r = S.record(1, "bill_pay", { face: 210.44, fee: 1.50, biller: "ComEd",
  reference: "acct 8811", who: "Sam", shiftId: 7 });
chk("the drawer takes the lot", near(r.cash, 211.94));
threw = false;
try { S.record(1, "bill_pay", { face: 50, fee: 1.5 }); } catch (e) { threw = true; }
chk("a biller is required", threw);

console.log("\n── what the shift has to balance ──");
const f = S.forShift(1, 7);
console.log(`   drawer ${f.cash}, income ${f.fees}, holding ${f.held} for others`);
chk("cash movement is the sum of them", near(f.cash, 501.50 - 120 + 211.94));
chk("only the fees are income", near(f.fees, 3.00));
chk("money that belongs to somebody else is counted apart",
  near(f.held, 710.44));
chk("each kind is broken out", Object.keys(f.byKind).length === 3);
chk("and labelled in words", f.byKind.money_order.label === "Money order");

console.log("\n── voiding ──");
const spoiled = S.record(1, "money_order", { face: 300, fee: 1.5, reference: "MO-100046",
  shiftId: 7 });
let f2 = S.forShift(1, 7);
chk("it counts before it's voided", near(f2.cash, f.cash + 301.5));
const v = S.voidService(1, spoiled.id, "Ameer", "printer jammed");
chk("voiding says what to give back", near(v.cashBack, -301.5));
f2 = S.forShift(1, 7);
chk("and it stops counting", near(f2.cash, f.cash));
chk("but the row is kept for the provider",
  S.list(1, { kind: "money_order" }).some(x => x.id === spoiled.id && x.voided));
threw = false;
try { S.voidService(1, spoiled.id, "Ameer"); } catch (e) { threw = true; }
chk("it can't be voided twice", threw);

console.log("\n── the lottery day ──");
S.record(1, "lottery_payout", { face: 20, shiftId: 7 });
S.record(1, "lottery_payout", { face: 500, shiftId: 7 });
const today = new Date().toISOString().slice(0, 10);
const lot = S.lotteryDay(1, today);
console.log(`   ${lot.count} payouts totalling ${lot.total}`);
chk("payouts are totalled for the day", lot.count === 3 && near(lot.total, 640));
chk("the biggest are listed first", lot.biggest[0].face === 500);

console.log("\n── the money order log ──");
const log = S.moneyOrderLog(1, today, today);
console.log(`   ${log.count} written, ${log.face} face, ${log.fees} in fees, ` +
  `${log.voided} voided`);
chk("voided ones aren't counted in the totals", log.count === 1 && near(log.face, 500));
chk("but they're still in the list", log.rows.length === 2);
chk("fees are totalled", near(log.fees, 1.5));

console.log("\n── missing serial numbers ──");
S.record(1, "money_order", { face: 50, fee: 1.5, reference: "MO-100047" });
S.record(1, "money_order", { face: 60, fee: 1.5, reference: "MO-100051" });
const gaps = S.serialGaps(1, today, today);
console.log(`   checked ${gaps.checked}, found ${gaps.gaps.length} gap(s): ` +
  gaps.gaps.map(g => `${g.missing} missing after ${g.after}`).join(", "));
chk("a break in the serials is found", gaps.gaps.length === 1);
chk("and says how many are unaccounted for", gaps.gaps[0].missing === 3);

console.log("\n── the wider picture ──");
const sum = S.summary(1, 30);
console.log("   " + sum.map(s => `${s.label} ×${s.n} fees ${s.fee}`).join(", "));
chk("summarised by kind", sum.length === 3);
chk("with fee income", sum.find(s => s.kind === "money_order").fee > 0);

console.log("\n── store isolation ──");
chk("another store sees none of it", S.list(2).length === 0);
chk("and its shift is empty", S.forShift(2, 7).cash === 0);

console.log("\n── nonsense is refused ──");
threw = false;
try { S.record(1, "wire_transfer", { face: 100 }); } catch (e) { threw = true; }
chk("an unknown service is refused", threw);
chk("a negative amount is treated as its size",
  near(S.record(1, "lottery_payout", { face: -40 }).cash, -40));

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  the fee is income and the face value isn't");
process.exit(bad ? 1 : 0);
