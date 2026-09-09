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

const T = require("../lib/tobacco.js");
let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };
const near = (a, b) => Math.abs(a - b) < 0.005;

db.prepare("INSERT INTO accounts (id,email,pass_hash) VALUES (1,'a@b.c','x')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (1,1,'Shop')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (2,1,'Other')").run();

const today = new Date().toISOString().slice(0, 10);
const sale = (lines, extra = {}) => ({ seq: 1, at: new Date().toISOString(),
  cashier: "Dana", terminalId: 1, lines, ...extra });

console.log("── settings ──");
T.setSettings(1, { on: true, outlets: { altria: "A-12345" }, deptIds: ["DTOB"] });
let s = T.settings(1);
chk("settings save and read back", s.on === true && s.outlets.altria === "A-12345");
chk("departments are remembered", s.deptIds.includes("DTOB"));
chk("another store has its own", T.settings(2).on === false);

console.log("\n── buydowns ──");
let threw = false;
try { T.saveBuydown(1, { name: "", maker: "altria", pluIds: ["P1"] }); } catch (e) { threw = true; }
chk("a buydown needs a name", threw);
threw = false;
try { T.saveBuydown(1, { name: "x", maker: "nobody", pluIds: ["P1"] }); } catch (e) { threw = true; }
chk("and a real manufacturer", threw);
threw = false;
try { T.saveBuydown(1, { name: "x", maker: "altria", pluIds: [] }); } catch (e) { threw = true; }
chk("and at least one product", threw);
threw = false;
try { T.saveBuydown(1, { name: "x", maker: "altria", pluIds: ["P1"], amount: 0 }); }
catch (e) { threw = true; }
chk("a per-unit buydown needs an amount", threw);
threw = false;
try { T.saveBuydown(1, { name: "x", maker: "altria", pluIds: ["P1"], kind: "multipack", qty: 1,
  price: 8 }); } catch (e) { threw = true; }
chk("a multipack needs two or more", threw);

const perUnit = T.saveBuydown(1, { name: "Marlboro 0.75 off", maker: "altria",
  pluIds: ["P1"], kind: "per_unit", amount: 0.75 });
const multi = T.saveBuydown(1, { name: "Newport 2 for 8.00", maker: "reynolds",
  pluIds: ["P2"], kind: "multipack", qty: 2, price: 8.00 });
chk("both kinds save", !!perUnit && !!multi);

const expired = T.saveBuydown(1, { name: "Old deal", maker: "altria", pluIds: ["P3"],
  amount: 1.00, starts: "2020-01-01", ends: "2020-12-31" });
chk("an expired buydown is stored but not live",
  T.buydowns(1).length === 3 && !T.live(1).find(b => b.id === expired));
const future = T.saveBuydown(1, { name: "Next month", maker: "altria", pluIds: ["P4"],
  amount: 1.00, starts: "2099-01-01" });
chk("one that hasn't started isn't live either", !T.live(1).find(b => b.id === future));

console.log("\n── what a cashier is told ──");
const o = T.offersFor(1, "P2", 1);
console.log(`   ${o[0].text}, ready: ${o[0].ready}`);
chk("a multipack shows its terms", o[0].text === "2 for 8.00");
chk("and says it isn't reached yet", o[0].ready === false);
chk("with two, it is", T.offersFor(1, "P2", 2)[0].ready === true);
chk("a per-unit deal is always ready", T.offersFor(1, "P1", 1)[0].ready === true);
chk("a product with no deal gets nothing", T.offersFor(1, "P9", 1).length === 0);

console.log("\n── per-unit funding ──");
let f = T.fundedFor(1, sale([{ pluId: "P1", upc: "028200001", n: "Marlboro Red", q: 3,
  price: 11.49, deptId: "DTOB" }]));
console.log(`   3 packs: paid ${f[0].paid}, funded ${f[0].funded}`);
chk("funded is per unit, not per sale", near(f[0].funded, 2.25));
chk("what the customer paid is recorded", near(f[0].paid, 34.47));

console.log("\n── the multipack rule ──");
/* two 4.49 packs for 8.00 funds 0.98 */
f = T.fundedFor(1, sale([{ pluId: "P2", upc: "028200002", n: "Newport", q: 2,
  price: 4.49, deptId: "DTOB" }]));
console.log(`   2 packs at 4.49 for 8.00: funded ${f[0].funded}`);
chk("the funded amount is the gap, not the price", near(f[0].funded, 0.98));

f = T.fundedFor(1, sale([{ pluId: "P2", q: 3, price: 4.49, deptId: "DTOB" }]));
console.log(`   3 packs: funded ${f[0].funded}`);
chk("three packs claim one whole set, not one and a half", near(f[0].funded, 0.98));

f = T.fundedFor(1, sale([{ pluId: "P2", q: 4, price: 4.49, deptId: "DTOB" }]));
chk("four packs claim two sets", near(f[0].funded, 1.96));

f = T.fundedFor(1, sale([{ pluId: "P2", q: 1, price: 4.49, deptId: "DTOB" }]));
chk("one pack claims nothing", near(f[0].funded, 0));
chk("but the line is still captured", f.length === 1);

console.log("\n── tobacco with no deal on it ──");
f = T.fundedFor(1, sale([{ pluId: "P7", n: "Some other cigarettes", q: 1, price: 9.99,
  deptId: "DTOB" }]));
chk("a tobacco department line is captured even with no buydown",
  f.length === 1 && f[0].funded === 0);
f = T.fundedFor(1, sale([{ pluId: "P8", n: "Crisps", q: 1, price: 1.99, deptId: "D1" }]));
chk("a non-tobacco line is not captured", f.length === 0);

console.log("\n── the age check is carried through ──");
f = T.fundedFor(1, sale([{ pluId: "P1", q: 1, price: 11.49, deptId: "DTOB",
  idCheck: { by: "scan", age: 34 } }]));
chk("how the ID was checked is recorded", f[0].ageChecked === "scan");

console.log("\n── writing it down ──");
let r = T.applySale(1, sale([
  { pluId: "P1", upc: "028200001", n: "Marlboro Red", q: 2, price: 11.49, deptId: "DTOB",
    idCheck: { by: "scan" } },
  { pluId: "P2", upc: "028200002", n: "Newport", q: 2, price: 4.49, deptId: "DTOB" },
  { pluId: "P8", n: "Crisps", q: 1, price: 1.99, deptId: "D1" }
]));
console.log(`   ${r.lines} lines captured, ${r.funded} funded`);
chk("only tobacco lines are written", r.lines === 2);
chk("funded totals across the sale", near(r.funded, 1.50 + 0.98));

T.applySale(1, sale([{ pluId: "P1", upc: "028200001", q: 1, price: 11.49, deptId: "DTOB" }],
  { ret: true, seq: 2 }));
const c = T.claim(1, "altria", "2000-01-01", "2099-01-01");
console.log(`   altria: ${c.units} units, ${c.funded} funded`);
chk("a refund subtracts units", near(c.units, 1));
chk("and subtracts the funding", near(c.funded, 0.75));

const rey = T.claim(1, "reynolds", "2000-01-01", "2099-01-01");
chk("each manufacturer is claimed separately", near(rey.funded, 0.98));
chk("and the breakdown names the buydown",
  rey.byBuydown.length === 1 && rey.byBuydown[0].name === "Newport 2 for 8.00");

console.log("\n── the export ──");
const rows = T.exportRows(1, "altria", "2000-01-01", "2099-01-01");
console.log("   " + Object.keys(rows[0]).join(", "));
chk("every documented column is present",
  T.COLUMNS.every(([k]) => k in rows[0]));
chk("the outlet number is stamped on every row", rows.every(r => r.outlet === "A-12345"));
chk("the barcode is carried", rows[0].upc === "028200001");
chk("a return is a negative quantity", rows.some(r => r.quantity < 0));
chk("the age check is in the file", rows.some(r => r.age_verified === "scan"));

const csv = T.toCSV(rows);
const lines = csv.split("\r\n");
console.log("   " + lines[0]);
chk("the header matches the columns", lines[0] === T.COLUMNS.map(c => c[0]).join(","));
chk("one row per line plus the header", lines.length === rows.length + 1);
chk("CRLF endings, for the systems that read these", csv.includes("\r\n"));

const tricky = T.toCSV([{ ...rows[0], description: 'Marlboro "Red", 100s' }]);
chk("quotes and commas in a name don't break the file",
  tricky.includes('"Marlboro ""Red"", 100s"'));

console.log("\n── it says what would get rejected ──");
let ready = T.checkReady(1, "altria", "2000-01-01", "2099-01-01");
chk("a complete period is ready", ready.ok === true, JSON.stringify(ready.problems));
ready = T.checkReady(1, "itg", "2000-01-01", "2099-01-01");
console.log("   itg: " + ready.problems.join(" · "));
chk("a missing outlet number is called out",
  ready.problems.some(p => p.includes("outlet number")));

T.applySale(1, sale([{ pluId: "P6", n: "No barcode", q: 1, price: 9.99, deptId: "DTOB" }],
  { seq: 3 }));
ready = T.checkReady(1, "all", "2000-01-01", "2099-01-01");
console.log("   all: " + ready.problems.join(" · "));
chk("a line with no barcode is flagged as unpayable",
  ready.problems.some(p => p.includes("no barcode")));

console.log("\n── store isolation ──");
chk("another store captured nothing",
  T.claim(2, "altria", "2000-01-01", "2099-01-01").lines === 0);
chk("and sees no buydowns", T.buydowns(2).length === 0);

console.log("\n── switched off means nothing recorded ──");
T.setSettings(1, { on: false });
chk("capture stops when it's off",
  T.fundedFor(1, sale([{ pluId: "P1", q: 1, price: 11.49, deptId: "DTOB" }])).length === 0);

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  tobacco capture is correct, including multipacks");
process.exit(bad ? 1 : 0);
