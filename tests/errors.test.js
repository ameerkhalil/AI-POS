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

const E = require("../lib/errors.js");
let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };

console.log("── scrubbing ──");
/* The whole reason to scrub: a stack trace is exactly where these end up. */
const cases = [
  ["a card number", "Charge failed for 4242 4242 4242 4242", "4242"],
  ["an unspaced card", "card=4111111111111111 declined", "4111111111111111"],
  ["a Stripe secret", "Auth error with sk_live_abc123XYZ456", "sk_live_abc123XYZ456"],
  ["a bearer token", "Bearer eyJhbGciOiJIUzI1NiJ9.abcdef", "eyJhbGciOiJIUzI1NiJ9"],
  ["an email", "No account for dana.okafor@example.com", "dana.okafor@example.com"],
  ["a phone number", "Customer (708) 555-0142 not found", "555-0142"],
  ["a session token", "bad token a3f9c2e1b7d84f6092ab5c3d1e8f7a20", "a3f9c2e1b7d84f6092ab5c3d1e8f7a20"],
  ["a licence scan", "wedge got ANSI 636035080002DL DBB09151990 DCSATIEH DAC AMEER", "09151990"]
];
cases.forEach(([what, input, secret]) => {
  const out = E.scrub(input);
  chk(`${what} is removed`, !out.includes(secret), out);
});
console.log("   e.g. " + E.scrub(cases[0][1]));
console.log("   e.g. " + E.scrub(cases[4][1]));
chk("the rest of the message survives", E.scrub(cases[4][1]).includes("No account for"));

console.log("\n── grouping ──");
/* One broken thing produces hundreds of rows; they have to collapse. */
const fp1 = E.fingerprint("client", "Cannot read properties of null (reading 'price')",
  "app.js:1421:18");
const fp2 = E.fingerprint("client", "Cannot read properties of null (reading 'price')",
  "app.js:1421:44");
chk("the same fault at a different column is one group", fp1 === fp2);
const fp3 = E.fingerprint("client", "Cannot read properties of null (reading 'name')",
  "app.js:1421:18");
chk("a different fault is a different group", fp1 !== fp3);
chk("numbers inside a message don't split it",
  E.fingerprint("c", "sale 41 failed", "x") === E.fingerprint("c", "sale 8827 failed", "x"));
chk("quoted values don't split it either",
  E.fingerprint("c", `no plu "P1"`, "x") === E.fingerprint("c", `no plu "P9931"`, "x"));

for (let i = 0; i < 5; i++)
  E.record({ kind: "client", message: "Cannot read properties of null (reading 'price')",
    where: "app.js:1421:" + i, storeId: 1, terminal: 1, build: "abc123" });
let gs = E.groups({});
console.log(`   5 occurrences produced ${gs.length} group with a count of ${gs[0].count}`);
chk("five occurrences are one row", gs.length === 1);
chk("with a count", gs[0].count === 5);
chk("and the build it happened on", gs[0].builds.includes("abc123"));

E.record({ kind: "client", message: "Cannot read properties of null (reading 'price')",
  where: "app.js:1421:2", storeId: 2, terminal: 7, build: "def456" });
gs = E.groups({});
chk("the same fault elsewhere joins the group", gs.length === 1 && gs[0].count === 6);
chk("and both terminals are recorded", gs[0].terminals.length === 2);
chk("and both builds", gs[0].builds.length === 2);

console.log("\n── rate limiting ──");
for (let i = 0; i < 200; i++)
  E.record({ kind: "client", message: "render loop", where: "x", storeId: 3, terminal: 99 });
const loop = E.groups({}).find(g => g.message === "render loop");
console.log(`   200 throws in a second recorded ${loop.count} times`);
chk("a runaway loop is throttled", loop.count <= 32);
chk("but it isn't silenced entirely", loop.count > 0);
const ev = E.detail(loop.id).events;
chk("and it says it was suppressed",
  ev.some(e => (e.detail || "").includes("suppressed")));
chk("a different terminal isn't throttled by it",
  (E.record({ kind: "client", message: "something else", where: "y",
    storeId: 4, terminal: 100 }), E.groups({}).some(g => g.message === "something else")));

console.log("\n── examples are kept, history isn't ──");
const many = E.detail(loop.id).events.length;
chk("only a handful of examples are stored", many <= 20);

console.log("\n── resolving ──");
const first = E.groups({})[0];
E.resolve(first.id, true, "fixed in the next build");
chk("a resolved fault leaves the list", !E.groups({}).find(g => g.id === first.id));
chk("but can still be found", E.groups({ includeResolved: true }).some(g => g.id === first.id));
E.record({ kind: first.kind, message: first.message, where: first.where_,
  storeId: 1, terminal: 1 });
chk("and it comes back if it happens again",
  E.groups({}).some(g => g.id === first.id));

console.log("\n── the summary ──");
const s = E.summary(7);
console.log(`   ${s.groups} open faults, ${s.events} occurrences, ${s.widespread} on several tills`);
chk("open groups are counted", s.groups >= 2);
chk("occurrences are counted", s.events > s.groups);
chk("a fault seen on more than one till is called out", s.widespread >= 1,
  `widespread=${s.widespread}`);
chk("the loudest are listed", s.loudest.length > 0 && s.loudest[0].count >= s.loudest[s.loudest.length-1].count);
chk("and it's broken down by store", Object.keys(s.byStore).length >= 2);

console.log("\n── it can't break what it watches ──");
chk("no message is a no-op, not a throw", E.record({ kind: "client" }).ok === false);
chk("an object where a string was expected is survivable",
  E.record({ kind: "client", message: { weird: true }, storeId: 1 }).ok === true);
let threw = false;
try { E.record(null); } catch (e) { threw = true; }
chk("being called with nothing doesn't throw", !threw);

/* The wrapper must let the route's own error handling still happen. */
let sawIt = false;
const wrapped = E.watch(() => { throw new Error("route blew up"); }, "/api/thing");
try { wrapped({ path: "/api/thing" }, {}, () => {}); } catch (e) { sawIt = true; }
chk("a wrapped route still throws to the caller", sawIt);
chk("and the failure was recorded",
  E.groups({}).some(g => g.message === "route blew up" && g.kind === "server"));

console.log("\n── sweeping ──");
db.prepare("UPDATE error_groups SET resolved = 1, last_at = datetime('now','-200 days') " +
  "WHERE id = ?").run(first.id);
const swept = E.sweep(90);
console.log(`   removed ${swept}`);
chk("old and settled is removed", swept === 1);
chk("open faults are never swept",
  E.groups({ includeResolved: true }).length > 0);

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  errors are grouped, scrubbed and can't flood");
process.exit(bad ? 1 : 0);
