/* Every screen is registered and every route answers — the audit proves that.
   This proves the next thing along: that each screen's function actually runs
   against a real configuration instead of throwing on the first property it
   reaches. That's the gap between "wired up" and "works". */
const fs = require("fs");
const vm = require("vm");

let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };

const html = fs.readFileSync("public/app.html", "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

/* A browser, thinly. Enough for a render to complete and for anything it
   touches to be observable. */
const noop = () => {};
const nodes = {};
const mk = id => ({
  id, innerHTML: "", outerHTML: "", textContent: "", value: "", checked: false,
  disabled: false, style: { setProperty: noop, removeProperty: noop },
  dataset: {}, classList: { _s: new Set(),
    add(...a) { a.forEach(x => this._s.add(x)); },
    remove(...a) { a.forEach(x => this._s.delete(x)); },
    toggle(x, f) { f === undefined ? (this._s.has(x) ? this._s.delete(x) : this._s.add(x))
      : (f ? this._s.add(x) : this._s.delete(x)); },
    contains(x) { return this._s.has(x); } },
  appendChild: noop, removeChild: noop, remove: noop, prepend: noop,
  insertAdjacentHTML: noop, addEventListener: noop, removeEventListener: noop,
  focus: noop, blur: noop, select: noop, setSelectionRange: noop, click: noop,
  scrollIntoView: noop, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  querySelector: () => mk("q"), querySelectorAll: () => [], closest: () => null,
  scrollTop: 0, scrollHeight: 0, offsetWidth: 0, files: []
});
const el = id => (nodes[id] = nodes[id] || mk(id));

/* Screens fetch. Hand each one a plausible answer rather than a rejection, so
   a render is tested rather than an error path. */
const CANNED = {
  "/api/stock": { onHand: { P1: 12 }, settings: { P1: { par: 5, target: 20, tracked: 1 } } },
  "/api/terminals": { terminals: [{ id: 1, name: "Front", number: 1, last_seen: null,
    build: "x", agent: 0, queued: 0, retired: 0 }] },
  "/api/shift": { shift: null, summary: null },
  "/api/journal": { sales: [], count: 0, sum: 0, cashiers: [] },
  "/api/loyalty": { settings: { on: false, per_pound: 1, point_value: 0.01, block: 100,
    excluded: [] }, offers: [] },
  "/api/loyalty/customers": { top: [], lapsed: [] },
  "/api/tobacco": { settings: { on: false, outlets: {}, deptIds: [] }, buydowns: [],
    makers: ["altria", "reynolds", "itg", "other"],
    columns: [["outlet", "x"], ["date", "y"]] },
  "/api/central": { groups: [], master: [], pushes: [], scheduled: [],
    stores: [{ id: 1, name: "Shop" }] },
  "/api/services": { settings: { moneyOrders: false, lottery: false, billPay: false,
    mo_fee: 1.5, mo_max: 1000, lotto_max: 600, bp_fee: 1.5, billers: [] },
    kinds: { money_order: { label: "Money order" } }, recent: [], summary: [] },
  "/api/clock": { settings: { on_: 0, week_hours: 40, ot_multiplier: 1.5, round_mins: 0,
    auto_break: 0, auto_break_after: 0 }, wages: {}, onDuty: [] },
  "/api/retention": { policy: { mode: "keep", days: 400, confirmed: true },
    preview: { sales: 0, oldest: null }, history: [] },
  "/api/vendors": { vendors: [] },
  "/api/po": { orders: [], outstanding: [], onOrder: {} },
  "/api/tanks": { gauge: {}, tanks: [], alarms: [], deliveries: [] },
  "/api/reports": { overview: { days: 30, sales: 0, taken: 0, returns: 0, refunded: 0,
    basket: 0, previous: { sales: 0, taken: 0 }, change: null },
    byDay: [], busy: { days: 30, openDays: 1,
      hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, n: 0, total: 0, perDay: 0 })),
      weekdays: Array.from({ length: 7 }, (_, d) => ({ day: d, n: 0, total: 0 })) },
    products: [], departments: [], staff: [], tenders: [],
    exceptions: { refundsNoOriginal: [], bigDiscounts: [], afterHours: [], voidedLines: [] } }
};
const answer = url => {
  const path = String(url).split("?")[0];
  for (const k of Object.keys(CANNED)) if (path === k || path.startsWith(k + "/"))
    return JSON.parse(JSON.stringify(CANNED[k]));
  return {};
};

const ctx = {
  console, Math, Date, JSON, String, Number, Object, Array, Set, Map, RegExp, Promise,
  isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Boolean, Error,
  setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
  requestAnimationFrame: noop, cancelAnimationFrame: noop,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  navigator: { onLine: true, clipboard: { writeText: () => Promise.resolve() } },
  location: { href: "", search: "", pathname: "/app.html", reload: noop },
  indexedDB: { open: () => ({}) },
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  BroadcastChannel: function () { this.postMessage = noop; this.onmessage = null; },
  document: {
    getElementById: el, createElement: () => mk("new"), createTextNode: () => mk("t"),
    body: { appendChild: noop, classList: { add: noop, remove: noop, toggle: noop } },
    documentElement: { style: { setProperty: noop } },
    addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [],
    visibilityState: "visible"
  },
  addEventListener: noop, removeEventListener: noop, open: noop, alert: noop,
  confirm: () => true, prompt: () => null,
  /* Real browser globals the screens legitimately use. */
  URLSearchParams, URL, TextEncoder, TextDecoder, Blob: function () {},
  FileReader: function () { this.readAsDataURL = noop; this.onload = null; },
  AbortController: function () { this.signal = {}; this.abort = noop; }
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(js, ctx);

/* api() is the one thing every screen goes through. */
/* The canned answers have to live inside the context, or the function that
   reads them closes over a variable the VM can't see. */
ctx.__canned = CANNED;
vm.runInContext(`
  api = (url) => {
    const path = String(url).split("?")[0];
    for (const k of Object.keys(__canned))
      if (path === k || path.startsWith(k + "/"))
        return Promise.resolve(JSON.parse(JSON.stringify(__canned[k])));
    return Promise.resolve({});
  };
  toast = () => {};
  veil = (h) => { const e = ${mk.toString()}("veil"); return e; };
  queueSave = () => {};
  STORE_ID = 1;
  ME = { n: "Ameer", role: "Manager" };
  SHIFT_ID = 1;
  A.type = "Convenience store"; A.name = "Test"; A.margin = "35";
  A.staff = [{ n: "Ameer", role: "Manager", pin: "1234" }];
  CFG = compile({ tagline: "", addr: "", promos: [], depts: [
    { n: "Grocery", food: true, items: [
      { n: "Milk", p: 4.29, upc: "1" }, { n: "Bread", p: 3.49, upc: "2" } ] },
    { n: "Tobacco", food: false, items: [{ n: "Marlboro", p: 11.49, upc: "3" }] } ] });
  SHIFT = { num: 1, sales: [], exceptions: [], payouts: [], opened: new Date() };
  CART = [];
`, ctx);

console.log("── every settings screen renders ──");

const groups = js.match(/const CGROUPS\s*=\s*\[([\s\S]*?)\n\];/)[1];
const views = js.match(/const views\s*=\s*\{([\s\S]*?)\};/)[1];
const mapped = {};
[...views.matchAll(/([a-z0-9_]+)\s*:\s*([A-Za-z0-9_]+)/g)].forEach(m => { mapped[m[1]] = m[2]; });
const tabs = [...groups.matchAll(/\["([a-z0-9_]+)"\s*,\s*"([^"]+)"/g)]
  .map(m => ({ key: m[1], label: m[2] }));

(async () => {
  for (const t of tabs) {
    const fn = mapped[t.key];
    if (!fn) { chk(t.label, false, "no view"); continue; }
    el("cfgBody").innerHTML = "";
    try {
      const out = vm.runInContext(`${fn}()`, ctx);
      if (out && typeof out.then === "function") await out;
      const drew = (el("cfgBody").innerHTML || "").length;
      chk(`${t.label}`, drew > 40, drew ? `only ${drew} characters` : "drew nothing");
    } catch (e) {
      chk(`${t.label}`, false, e.message.split("\n")[0]);
    }
  }

  console.log("\n── every register shell renders ──");
  for (const shell of ["classic", "menu", "commerce", "board", "kiosk"]) {
    el("vSale").innerHTML = "";
    try {
      vm.runInContext(`THEME.shell = "${shell}"; SHELLS["${shell}"]();`, ctx);
      const drew = (el("vSale").innerHTML || "").length;
      chk(shell, drew > 300, `drew ${drew} characters`);
    } catch (e) { chk(shell, false, e.message.split("\n")[0]); }
  }

  console.log(bad ? `\nFAIL ${bad} screens` : "\nPASS  every screen renders against a real config");
  process.exit(bad ? 1 : 0);
})();
