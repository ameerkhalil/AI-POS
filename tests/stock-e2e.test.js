/* Drives the actual server over HTTP: sign up, ring sales, receive, count,
   reorder. The two earlier tests exercised the engine and insertSale directly;
   this one proves the routes, the auth guards and the store isolation. */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const DIR = path.join(__dirname, "e2e-data");
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const PORT = 4187;
const srv = spawn(process.execPath, ["server.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, NODE_ENV: "test",
    OPERATOR_EMAIL: "", ADMIN_RESET: "" },
  stdio: ["ignore", "pipe", "pipe"]
});
let log = "";
srv.stdout.on("data", d => { log += d; });
srv.stderr.on("data", d => { log += d; });

const base = `http://127.0.0.1:${PORT}`;
let cookie = "";
let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };
const near = (a, b) => Math.abs(a - b) < 0.001;

async function call(method, url, body) {
  const r = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  let d = null;
  try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* wait for the port */
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + "/api/ping"); if (r.ok) { up = true; break; } } catch (e) {}
    await wait(250);
  }
  if (!up) { console.log("FAIL server never started\n" + log.slice(-1500)); process.exit(1); }
  console.log("── server up ──\n");

  let r = await call("POST", "/api/signup",
    { email: "shop@test.com", password: "password123", storeName: "Test Shop" });
  chk("signed up", r.status === 200, JSON.stringify(r.d));

  r = await call("GET", "/api/me");
  const storeId = r.d.stores[0].id;
  chk("has a store", !!storeId);

  /* --- the guard: no session, no stock --- */
  const saved = cookie; cookie = "";
  r = await call("GET", `/api/stock?store=${storeId}`);
  chk("stock is refused without a session", r.status === 401 || r.status === 403);
  cookie = saved;

  console.log("\n── receiving ──");
  r = await call("POST", `/api/stock/receive?store=${storeId}`, {
    store: storeId, who: "Ameer", ref: "INV-1",
    lines: [{ pluId: "P1", qty: 2, caseQty: 24, cost: 1.80 },
            { pluId: "P2", qty: 10, cost: 9.20 }]
  });
  chk("received", r.status === 200 && r.d.units === 58, JSON.stringify(r.d));

  r = await call("GET", `/api/stock?store=${storeId}`);
  chk("on hand reflects it", near(r.d.onHand.P1, 48) && near(r.d.onHand.P2, 10));

  console.log("\n── selling ──");
  const sale = cid => ({ n: 1, at: new Date().toISOString(), by: "Dana", tot: 5.98, cid,
    lines: [{ pluId: "P1", q: 2, n: "Monster", price: 2.99 }] });
  r = await call("POST", `/api/sales?store=${storeId}`, { store: storeId, sale: sale("s-1") });
  chk("sale recorded", r.status === 200 && r.d.duplicate === false);
  r = await call("GET", `/api/stock?store=${storeId}`);
  chk("stock decremented", near(r.d.onHand.P1, 46));

  r = await call("POST", `/api/sales?store=${storeId}`, { store: storeId, sale: sale("s-1") });
  chk("a replay is a duplicate", r.d.duplicate === true);
  r = await call("GET", `/api/stock?store=${storeId}`);
  chk("and did not decrement again", near(r.d.onHand.P1, 46));

  console.log("\n── par levels and ordering ──");
  r = await call("PUT", `/api/stock/settings?store=${storeId}`, { store: storeId, items: [
    { pluId: "P1", par: 60, target: 96, case_qty: 24, tracked: true },
    { pluId: "P2", par: 4, target: 20, tracked: true }
  ]});
  chk("par levels saved", r.status === 200);

  r = await call("POST", `/api/stock/reorder?store=${storeId}`, { store: storeId,
    plus: [{ id: "P1", n: "Monster", upc: "1", deptId: "D1", cost: 1.80 },
           { id: "P2", n: "Marlboro", upc: "2", deptId: "D2", cost: 9.20 }] });
  const p1 = r.d.items.find(i => i.pluId === "P1");
  console.log(`   P1 have ${p1.have}, par ${p1.par}, order ${p1.need} (${p1.cases} cases)`);
  chk("below par appears", !!p1);
  chk("rounded to whole cases", p1.cases === 3 && near(p1.need, 72));
  chk("above par does not appear", !r.d.items.find(i => i.pluId === "P2"));

  console.log("\n── counting ──");
  r = await call("POST", `/api/stock/count?store=${storeId}`,
    { store: storeId, who: "Ameer", scope: "all" });
  const cid = r.d.id;
  chk("count opened", !!cid);

  r = await call("PUT", `/api/stock/count/${cid}?store=${storeId}`, { store: storeId,
    lines: [{ pluId: "P1", counted: 44, cost: 1.80 }, { pluId: "P2", counted: 10, cost: 9.20 }] });
  const l = r.d.lines.find(x => x.pluId === "P1");
  chk("variance computed", near(l.expected, 46) && near(l.variance, -2));

  r = await call("GET", `/api/stock?store=${storeId}`);
  chk("nothing moved before closing", near(r.d.onHand.P1, 46));

  r = await call("POST", `/api/stock/count/${cid}/close?store=${storeId}`,
    { store: storeId, who: "Ameer" });
  console.log(`   closed: ${r.d.adjusted} adjusted, shrink ${r.d.shrinkUnits} worth ${r.d.shrinkValue}`);
  chk("only the differing line adjusted", r.d.adjusted === 1);
  chk("shrink valued at cost", near(r.d.shrinkValue, 3.60));

  r = await call("GET", `/api/stock?store=${storeId}`);
  chk("on hand now matches the count", near(r.d.onHand.P1, 44));

  r = await call("GET", `/api/stock/shrink?store=${storeId}&days=30`);
  chk("shrink report sees it", near(r.d.countedUnits, 2));

  console.log("\n── another account cannot reach it ──");
  cookie = "";
  await call("POST", "/api/signup",
    { email: "other@test.com", password: "password123", storeName: "Other Shop" });
  r = await call("GET", `/api/stock?store=${storeId}`);
  chk("a different account is refused that store", r.status === 403 || r.status === 404,
    "status " + r.status);
  r = await call("POST", `/api/stock/receive?store=${storeId}`,
    { store: storeId, lines: [{ pluId: "P1", qty: 999 }] });
  chk("and cannot receive into it", r.status === 403 || r.status === 404);

  console.log("\n── history explains the number ──");
  cookie = "";
  await call("POST", "/api/login", { email: "shop@test.com", password: "password123" });
  r = await call("GET", `/api/stock/history?store=${storeId}&plu=P1`);
  const kinds = r.d.moves.map(m => m.kind);
  console.log("   " + kinds.join(", "));
  chk("every kind of movement is there",
    kinds.includes("received") && kinds.includes("sold") && kinds.includes("counted"));
  chk("the movements sum to the on-hand",
    near(r.d.moves.reduce((a, m) => a + m.qty, 0), 44));

  console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  inventory works end to end over HTTP");
  srv.kill();
  process.exit(bad ? 1 : 0);
})().catch(e => {
  console.log("FAIL " + e.message + "\n" + log.slice(-1500));
  srv.kill();
  process.exit(1);
});
