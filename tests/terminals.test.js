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

const T = require("../lib/terminals.js");
let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };
const near = (a, b) => Math.abs(a - b) < 0.005;

db.prepare("INSERT INTO accounts (id,email,pass_hash) VALUES (1,'a@b.c','x')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (1,1,'Shop')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (2,1,'Other')").run();

const ring = (shiftId, termId, pays, ret) =>
  db.prepare("INSERT INTO sales (store_id, shift_id, terminal_id, seq, at, cashier, total, " +
    "is_return, json) VALUES (1,?,?,?,datetime('now'),?,?,?,?)")
    .run(shiftId, termId, 1, "Dana",
      pays.reduce((a, p) => a + p.amt, 0), ret ? 1 : 0,
      JSON.stringify({ ret: !!ret, pays }));

console.log("── registering ──");
const t1 = T.register(1, { name: "Front counter" });
const t2 = T.register(1, { name: "Second lane" });
chk("numbers start at one", t1.number === 1 && t2.number === 2);
chk("each gets its own token", t1.token !== t2.token && t1.token.length > 20);
chk("a token resolves back", T.byToken(t1.token).id === t1.id);
chk("a bad token resolves to nothing", !T.byToken("nonsense"));

const other = T.register(2, { name: "Their register" });
chk("numbering is per store", other.number === 1);

T.retire(1, t2.id);
const t3 = T.register(1, { name: "Replacement lane" });
chk("a retired number is reused rather than creeping up", t3.number === 2);
chk("retired registers are still listed", T.list(1).some(t => t.retired));

console.log("\n── one shift, two drawers ──");
const a = T.joinShift(1, t1.id, { who: "Dana", startCash: 150 });
chk("the first terminal opens the shift", a.createdShift === true);
const b = T.joinShift(1, t3.id, { who: "Sam", startCash: 100 });
chk("the second joins the same shift", b.createdShift === false && b.shift.id === a.shift.id);
chk("but gets its own drawer", b.drawer.id !== a.drawer.id);
chk("with its own opening cash", near(b.drawer.start_cash, 100));

const again = T.joinShift(1, t1.id, { who: "Dana" });
chk("rejoining returns the same drawer", again.drawer.id === a.drawer.id);

console.log("\n── cash reaches the right drawer ──");
/* front counter: a cash sale with change, a card sale, a cash refund */
ring(a.shift.id, t1.id, [{ mop: "Cash", amt: 15.50, given: 20, change: 4.50 }]);
ring(a.shift.id, t1.id, [{ mop: "Credit", amt: 40.00 }]);
ring(a.shift.id, t1.id, [{ mop: "Cash", amt: -6.00 }], true);
/* second lane: a split */
ring(a.shift.id, t3.id, [{ mop: "Cash", amt: 10.00 }, { mop: "Credit", amt: 25.00 }]);

const d1 = T.drawerExpected(a.shift.id, t1.id);
const d2 = T.drawerExpected(a.shift.id, t3.id);
console.log(`   lane 1: cash ${d1.cash}, expected ${d1.expected}`);
console.log(`   lane 2: cash ${d2.cash}, expected ${d2.expected}`);
chk("change is not taken out of the drawer twice", near(d1.cash, 9.50));
chk("a card sale puts nothing in the drawer", near(d1.cash, 15.50 - 6.00));
chk("a split only counts the cash part", near(d2.cash, 10.00));
chk("expected is opening plus cash", near(d1.expected, 159.50) && near(d2.expected, 110));
chk("one terminal's cash never lands in the other's drawer", !near(d1.cash, d2.cash));

console.log("\n── pay-ins, pay-outs and drops ──");
T.drawerMovement(d1.id, "in", 25);
T.drawerMovement(d1.id, "out", 10);
T.drawerMovement(d1.id, "drop", 100);
const d1b = T.drawerExpected(a.shift.id, t1.id);
console.log(`   after movements: expected ${d1b.expected}`);
chk("movements adjust what the drawer should hold", near(d1b.expected, 159.50 + 25 - 10 - 100));
let threw = false;
try { T.drawerMovement(d1.id, "sideways", 5); } catch (e) { threw = true; }
chk("an unknown movement is refused", threw);

console.log("\n── counting the drawers ──");
const c1 = T.closeDrawer(a.shift.id, t1.id, { counted: 72.50, who: "Dana" });
console.log(`   lane 1 counted ${c1.counted}, expected ${c1.expected}, over ${c1.over}`);
chk("over/short is counted minus expected", near(c1.over, -2.00));

threw = false;
try { T.closeDrawer(a.shift.id, t1.id, { counted: 100 }); } catch (e) { threw = true; }
chk("a drawer can't be counted twice", threw);

threw = false;
try { T.closeShift(1, a.shift.id, "Dana"); } catch (e) { threw = true; }
chk("the shift won't close with a drawer still open", threw);

T.closeDrawer(a.shift.id, t3.id, { counted: 110, who: "Sam" });
const sum = T.closeShift(1, a.shift.id, "Dana");
console.log(`   shift: ${sum.totals.n} sales, expected ${sum.expected}, counted ${sum.counted}, ` +
  `over ${sum.over}`);
chk("now it closes", !!sum.shift.closed_at);
chk("the store total spans both terminals", sum.totals.n === 4);
chk("expected is the sum of the drawers", near(sum.expected, 74.50 + 110));
chk("over is the sum of the differences", near(sum.over, -2.00));
chk("sales are broken down per terminal", sum.byTerminal.length === 2);

threw = false;
try { T.closeShift(1, a.shift.id, "Dana"); } catch (e) { threw = true; }
chk("a shift can't close twice", threw);

console.log("\n── a new shift after close ──");
const nxt = T.joinShift(1, t1.id, { who: "Dana", startCash: 150 });
chk("a fresh shift is created", nxt.createdShift === true && nxt.shift.id !== a.shift.id);
chk("with a fresh drawer", nxt.drawer.counted == null);

console.log("\n── retiring ──");
threw = false;
try { T.retire(1, t1.id); } catch (e) { threw = true; }
chk("a register with an open drawer can't be retired", threw);

console.log("\n── fleet health ──");
T.heartbeat(t1.id, { build: "74a2dd03da", agent: true, queued: 0, ip: "10.0.0.5" });
const h = T.health();
const live = h.find(x => x.id === t1.id);
console.log(`   ${live.store} · ${live.name} · ${live.state} · build ${live.build}`);
chk("a terminal that just checked in is live", live.state === "live");
chk("the build is reported", live.build === "74a2dd03da");
chk("the station agent is reported", live.agent === true);
/* Registering is itself a check-in, so a brand-new terminal is live rather than
   "never" — that branch only guards against a row with no last_seen at all. */
const fresh = h.find(x => x.id === other.id);
chk("a newly registered terminal counts as seen", fresh.state === "live");
db.prepare("UPDATE terminals SET last_seen = NULL WHERE id = ?").run(other.id);
chk("a row with no check-in at all says never",
  T.health().find(x => x.id === other.id).state === "never");
db.prepare("UPDATE terminals SET last_seen = datetime('now','-3 hours') WHERE id = ?")
  .run(other.id);
chk("one that hasn't been seen for hours is gone",
  T.health().find(x => x.id === other.id).state === "gone");
db.prepare("UPDATE terminals SET last_seen = datetime('now','-20 minutes') WHERE id = ?")
  .run(other.id);
chk("one seen twenty minutes ago is idle, not an alarm",
  T.health().find(x => x.id === other.id).state === "idle");
chk("retired registers are left out of health", !h.find(x => x.id === t2.id));
chk("health can be narrowed to certain stores", T.health([2]).every(x => x.store_id === 2));

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  two lanes, one shift, two drawers");
process.exit(bad ? 1 : 0);
