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

const T = require("../lib/timeclock.js");
let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };
const near = (a, b, tol) => Math.abs(a - b) < (tol || 0.02);

db.prepare("INSERT INTO accounts (id,email,pass_hash) VALUES (1,'a@b.c','x')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (1,1,'Shop')").run();
db.prepare("INSERT INTO stores (id,account_id,name) VALUES (2,1,'Other')").run();

/* A fixed Monday so weeks and overtime are deterministic. */
const MON = "2026-09-07";
const at = (day, h, m) => `${day}T${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}:00.000Z`;
const dayOf = n => new Date(Date.parse(MON + "T00:00:00Z") + n * 86400000)
  .toISOString().slice(0, 10);

T.setSettings(1, { on: true, week_hours: 40, ot_multiplier: 1.5 });
T.setWage(1, "Dana", 16.00);
T.setWage(1, "Sam", 18.50);

console.log("── punching ──");
let r = T.clockIn(1, "Dana", at(MON, 6));
chk("clocking in works", r.ok && !r.alreadyIn);
chk("they're on duty", T.onDuty(1).length === 1);

r = T.clockIn(1, "Dana", at(MON, 6, 30));
chk("a second clock-in is never refused", r.ok === true);
chk("but it says the shift was already open", r.alreadyIn === true && !!r.warning);
chk("and doesn't open a second one", T.onDuty(1).length === 1);

r = T.clockOut(1, "Dana", at(MON, 14));
console.log(`   worked ${r.hours} hours`);
chk("clocking out closes it", r.ok && near(r.hours, 8));
chk("nobody is left on duty", T.onDuty(1).length === 0);

r = T.clockOut(1, "Dana", at(MON, 15));
chk("clocking out twice is refused with a reason", !r.ok && r.error.includes("aren't clocked in"));

T.clockIn(1, "Sam", at(MON, 14));
r = T.clockOut(1, "Sam", at(MON, 13));
chk("clocking out before clocking in is refused", !r.ok);
T.clockOut(1, "Sam", at(MON, 22));

console.log("\n── rounding ──");
T.setSettings(1, { round_mins: 15 });
T.clockIn(1, "Rounder", at(MON, 6, 7));
const rp = T.openPunch(1, "Rounder");
console.log(`   punched 06:07, recorded ${rp.in_at.slice(11, 16)}`);
chk("a punch rounds to the nearest quarter", rp.in_at.includes("06:00"));
T.clockOut(1, "Rounder", at(MON, 14, 8));
chk("and so does clocking out",
  db.prepare("SELECT out_at FROM punches WHERE who='Rounder'").get().out_at.includes("14:15"));
T.setSettings(1, { round_mins: 0 });

console.log("\n── automatic breaks ──");
T.setSettings(1, { auto_break: 30, auto_break_after: 6 });
T.clockIn(1, "Longshift", at(dayOf(1), 6));
r = T.clockOut(1, "Longshift", at(dayOf(1), 14));
console.log(`   8 hours worked, ${r.paidHours} paid`);
chk("a long shift loses its break", near(r.paidHours, 7.5));
T.clockIn(1, "Shortshift", at(dayOf(1), 9));
r = T.clockOut(1, "Shortshift", at(dayOf(1), 13));
chk("a short one doesn't", near(r.paidHours, 4));
T.setSettings(1, { auto_break: 0, auto_break_after: 0 });

console.log("\n── overtime is per week ──");
/* Dana: 9 hours a day, Monday to Saturday = 54 hours */
db.prepare("DELETE FROM punches WHERE who = 'Dana'").run();
for (let d = 0; d < 6; d++) {
  T.clockIn(1, "Dana", at(dayOf(d), 8));
  T.clockOut(1, "Dana", at(dayOf(d), 17));
}
let sheet = T.timesheet(1, MON, dayOf(6));
let dana = sheet.people.find(p => p.who === "Dana");
console.log(`   ${dana.hours}h = ${dana.normalHours} normal + ${dana.overtimeHours} overtime, ` +
  `costing ${dana.cost}`);
chk("hours add up", near(dana.hours, 54));
chk("the first forty are normal", near(dana.normalHours, 40));
chk("the rest is overtime", near(dana.overtimeHours, 14));
chk("overtime is paid at the multiplier",
  near(dana.cost, 40 * 16 + 14 * 16 * 1.5));

/* the following week, also 54 hours: two weeks of overtime, not one big one */
for (let d = 7; d < 13; d++) {
  T.clockIn(1, "Dana", at(dayOf(d), 8));
  T.clockOut(1, "Dana", at(dayOf(d), 17));
}
sheet = T.timesheet(1, MON, dayOf(13));
dana = sheet.people.find(p => p.who === "Dana");
console.log(`   over two weeks: ${dana.normalHours} normal, ${dana.overtimeHours} overtime`);
chk("a fortnight is two weeks, not one long one",
  near(dana.normalHours, 80) && near(dana.overtimeHours, 28));

console.log("\n── things that need a human ──");
T.clockIn(1, "Forgetful", at(dayOf(2), 8));
sheet = T.timesheet(1, MON, dayOf(13));
console.log("   " + sheet.problems.map(p => `${p.who}: ${p.kind}`).join(", "));
chk("a shift never closed is flagged",
  sheet.problems.some(p => p.who === "Forgetful" && p.kind === "still open"));
chk("and doesn't count towards hours",
  sheet.people.find(p => p.who === "Forgetful").hours === 0);

T.addPunch(1, { who: "Marathon", in_at: at(dayOf(3), 6), out_at: at(dayOf(4), 6) }, "Ameer");
sheet = T.timesheet(1, MON, dayOf(13));
chk("an implausibly long shift is flagged",
  sheet.problems.some(p => p.who === "Marathon" && p.kind === "very long"));

console.log("\n── edits keep the original ──");
const punch = db.prepare("SELECT id FROM punches WHERE who='Sam' LIMIT 1").get();
T.editPunch(1, punch.id, { out_at: at(MON, 20) }, "Ameer");
let row = db.prepare("SELECT * FROM punches WHERE id = ?").get(punch.id);
console.log(`   original kept: ${row.original}`);
chk("the edit applies", row.out_at.includes("20:00"));
chk("who changed it is recorded", row.edited_by === "Ameer" && !!row.edited_at);
chk("and what it was before is kept", JSON.parse(row.original).out_at.includes("22:00"));

T.editPunch(1, punch.id, { out_at: at(MON, 21) }, "Ameer");
row = db.prepare("SELECT * FROM punches WHERE id = ?").get(punch.id);
chk("a second edit doesn't overwrite the first original",
  JSON.parse(row.original).out_at.includes("22:00"));

let threw = false;
try { T.editPunch(1, punch.id, { out_at: at(MON, 5) }, "Ameer"); } catch (e) { threw = true; }
chk("an edit that ends before it starts is refused", threw);

console.log("\n── unpriced staff ──");
T.addPunch(1, { who: "Newstarter", in_at: at(dayOf(5), 9), out_at: at(dayOf(5), 17) }, "Ameer");
sheet = T.timesheet(1, MON, dayOf(13));
const nw = sheet.people.find(p => p.who === "Newstarter");
console.log(`   ${sheet.totals.unratedPeople.join(", ")} have no wage set`);
chk("their hours still count", near(nw.hours, 8));
chk("but their cost is unknown rather than zero", nw.cost === null);
chk("and the total says it can't be complete", sheet.totals.cost === null);
chk("naming who's missing", sheet.totals.unratedPeople.includes("Newstarter"));

console.log("\n── labour against takings ──");
db.prepare("DELETE FROM punches").run();
T.addPunch(1, { who: "Dana", in_at: at(dayOf(0), 6), out_at: at(dayOf(0), 14) }, "x");
const mkSale = (h, total) => db.prepare(
  "INSERT INTO sales (store_id,seq,at,cashier,total,is_return,json) VALUES (1,1,?,?,?,0,'{}')")
  .run(`${dayOf(0)} ${String(h).padStart(2, "0")}:30:00`, "Dana", total);
mkSale(7, 400);      /* busy */
mkSale(11, 20);      /* dead */

const lv = T.labourVsSales(1, dayOf(0), dayOf(0));
const seven = lv.hours[7], eleven = lv.hours[11], three = lv.hours[3];
console.log(`   07:00 took ${seven.took}, cost ${seven.cost} (${seven.share}%)`);
console.log(`   11:00 took ${eleven.took}, cost ${eleven.cost} (${eleven.share}%)`);
chk("wage cost lands in the hours actually worked", near(seven.cost, 16));
chk("and not in hours nobody was there", three.cost === 0);
chk("a good hour has a low share", seven.share < 10);
chk("a thin hour has a high share", eleven.share > 50 && eleven.losing === false);
/* 13:00 is staffed and took nothing at all — that one really is losing. */
const thirteen = lv.hours[13];
console.log(`   13:00 took ${thirteen.took}, cost ${thirteen.cost} — losing: ${thirteen.losing}`);
chk("an hour that takes nothing while staffed is flagged as losing",
  thirteen.losing === true && thirteen.took === 0);
chk("and an unstaffed hour is not called losing", three.losing === false);
chk("total staff hours are right", near(lv.totals.staffHours, 8));
chk("total cost is right", near(lv.totals.cost, 128));

console.log("\n── payroll export ──");
const pay = T.payrollRows(1, dayOf(0), dayOf(0));
console.log("   " + Object.keys(pay[0]).join(", "));
chk("one row per person", pay.length === 1);
chk("with hours split", pay[0].normal_hours === "8.00" && pay[0].overtime_hours === "0.00");
chk("and a cost", pay[0].cost === "128.00");

console.log("\n── what the till card shows ──");
db.prepare("DELETE FROM punches").run();
/* Two days this week, then on the clock now. */
T.addPunch(1, { who: "Dana", in_at: at(dayOf(0), 8), out_at: at(dayOf(0), 16) }, "x");
T.addPunch(1, { who: "Dana", in_at: at(dayOf(1), 9), out_at: at(dayOf(1), 14) }, "x");
let me = T.forPerson(1, "Dana");
console.log(`   ${me.who}: ${me.weekHours}h this week over ${me.daysThisWeek} days, ` +
  `on now: ${me.on}`);
chk("the week adds up", near(me.weekHours, 13));
chk("days worked are counted", me.daysThisWeek === 2);
chk("not on the clock", me.on === false && me.minutes === 0);
chk("and it knows the overtime line", me.overtimeAfter === 40 && me.intoOvertime === false);

T.clockIn(1, "Dana", at(dayOf(2), 10));
me = T.forPerson(1, "Dana");
chk("on the clock is reported", me.on === true && !!me.since);
chk("with minutes so far", me.minutes >= 0);

/* Somebody already past forty should be told before they start. */
for (let d = 3; d < 8; d++)
  T.addPunch(1, { who: "Heavy", in_at: at(dayOf(d - 3), 6), out_at: at(dayOf(d - 3), 18) }, "x");
const heavy = T.forPerson(1, "Heavy");
console.log(`   Heavy: ${heavy.weekHours}h — into overtime: ${heavy.intoOvertime}`);
chk("past the threshold is flagged", heavy.intoOvertime === true);

chk("somebody with no punches doesn't throw",
  T.forPerson(1, "Nobody").weekHours === 0);
chk("and another store's hours never appear",
  T.forPerson(2, "Dana").weekHours === 0);

console.log("\n── store isolation ──");
chk("another store has nobody on duty", T.onDuty(2).length === 0);
chk("and an empty sheet", T.timesheet(2, MON, dayOf(13)).people.length === 0);
chk("its labour report doesn't throw", T.labourVsSales(2, MON, MON).totals.cost === 0);

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  hours, overtime and what they cost");
process.exit(bad ? 1 : 0);
