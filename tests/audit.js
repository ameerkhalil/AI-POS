/* ===========================================================================
   The audit.

   Not a test of behaviour — the suites do that. This checks the wiring: that
   every screen the settings offer actually exists, that every address the
   browser calls is answered by the server, that every module function a route
   reaches for is exported, and that the schema matches what the code reads.

   It exists because the two worst failures in this codebase weren't logic
   errors. A screen was registered with no function behind it, and a query
   named a table that didn't exist. Both are wiring, and both are findable in
   a second by a machine.
   =========================================================================== */
const fs = require("fs");
const path = require("path");

let problems = 0, warnings = 0;
const fail = (what, detail) => { console.log(`  ✗ ${what}${detail ? " — " + detail : ""}`);
  problems++; };
const warn = (what, detail) => { console.log(`  ! ${what}${detail ? " — " + detail : ""}`);
  warnings++; };
const ok = what => console.log(`  ✓ ${what}`);
const head = t => console.log(`\n── ${t} ──`);

const app = fs.readFileSync("public/app.html", "utf8");
const appJs = app.match(/<script>([\s\S]*)<\/script>/)[1];
const server = fs.readFileSync("server.js", "utf8");
const admin = fs.readFileSync("public/admin.html", "utf8");

/* ------------------------------------------------------------------ 1 */
head("every file parses");
const files = [
  "server.js", "build.py", ...fs.readdirSync("lib").map(f => "lib/" + f),
  ...fs.readdirSync("src").map(f => "src/" + f)
].filter(f => f.endsWith(".js"));

files.forEach(f => {
  try { new (require("vm").Script)(fs.readFileSync(f, "utf8")); }
  catch (e) { fail(f, e.message.split("\n")[0]); }
});
["public/app.html", "public/admin.html", "public/login.html",
 "public/display.html", "public/reset.html"].forEach(f => {
  try {
    const src = fs.readFileSync(f, "utf8");
    const m = src.match(/<script>([\s\S]*?)<\/script>/g) || [];
    m.forEach(block => new (require("vm").Script)(
      block.replace(/^<script>/, "").replace(/<\/script>$/, "")));
  } catch (e) { fail(f, e.message.split("\n")[0]); }
});
if (!problems) ok(`${files.length + 5} files parse`);

/* ------------------------------------------------------------------ 2 */
head("every settings screen has a function behind it");
/* This is exactly how the time clock shipped with no screen. */
const groups = appJs.match(/const CGROUPS\s*=\s*\[([\s\S]*?)\n\];/);
const views = appJs.match(/const views\s*=\s*\{([\s\S]*?)\};/);
if (!groups || !views) {
  fail("couldn't find the settings registry to check");
} else {
  const tabs = [...groups[1].matchAll(/\["([a-z0-9_]+)"\s*,\s*"([^"]+)"/g)]
    .map(m => ({ key: m[1], label: m[2] }));
  const mapped = {};
  [...views[1].matchAll(/([a-z0-9_]+)\s*:\s*([A-Za-z0-9_]+)/g)]
    .forEach(m => { mapped[m[1]] = m[2]; });

  let bad = 0;
  tabs.forEach(t => {
    const fn = mapped[t.key];
    if (!fn) { fail(`"${t.label}" is offered but has no view`, t.key); bad++; return; }
    if (!new RegExp(`function\\s+${fn}\\s*\\(`).test(appJs)) {
      fail(`"${t.label}" points at ${fn}(), which doesn't exist`); bad++;
    }
  });
  /* And the other way: a view nobody can reach. */
  Object.keys(mapped).forEach(k => {
    if (!tabs.find(t => t.key === k) && !/^mod_/.test(k))
      warn(`the view "${k}" exists but nothing links to it`);
  });
  if (!bad) ok(`${tabs.length} screens, every one reachable`);
}

/* ------------------------------------------------------------------ 3 */
head("every address the browser calls is answered");
const routes = new Set();
[...server.matchAll(/app\.(get|post|put|delete)\(\s*"([^"]+)"/g)]
  .forEach(m => routes.add(`${m[1].toUpperCase()} ${m[2]}`));

/* Turn "/api/po/123/receive" into the "/api/po/:id/receive" the server declares. */
const matches = (method, url) => {
  const clean = url.split("?")[0].replace(/\/+$/, "") || "/";
  for (const r of routes) {
    const [m, pattern] = r.split(" ");
    if (m !== method) continue;
    const re = new RegExp("^" + pattern.replace(/:[^/]+/g, "[^/]+") + "$");
    if (re.test(clean)) return true;
  }
  return false;
};

const calls = new Map();
const collect = (src, label) => {
  /* api("/api/thing?store=" + X, { method: "POST" }) and fetch(...) */
  [...src.matchAll(/\b(?:api|fetch)\(\s*[`"']([^`"']*\/api\/[^`"'?]*)/g)].forEach(m => {
    const raw = m[1];
    const after = src.slice(m.index, m.index + 400);
    const mm = /method:\s*["']([A-Z]+)["']/.exec(after);
    const method = mm ? mm[1] : "GET";
    calls.set(`${method} ${raw}`, label);
  });
};
collect(appJs, "app");
collect(admin, "console");
collect(fs.readFileSync("public/display.html", "utf8"), "display");
collect(fs.readFileSync("public/login.html", "utf8"), "login");
collect(fs.readFileSync("public/reset.html", "utf8"), "reset");

let missing = 0;
calls.forEach((where, call) => {
  const [method, url] = call.split(" ");
  /* Template-built URLs end mid-path; only check ones that are complete. */
  if (/\$\{/.test(url)) return;
  /* "/api/po/" + id + "?store=" captures only up to the concatenation, so a
     trailing slash means the rest was built at runtime. Check the parent. */
  if (url.endsWith("/")) {
    const parent = url.replace(/\/$/, "");
    if (![...routes].some(r => {
      const [m, p] = r.split(" ");
      return m === method && p.replace(/\/:[^/]+/g, "").replace(/\/+$/, "") === parent;
    })) fail(`${where} calls ${method} ${url}…, and no route starts there`);
    return;
  }
  if (!matches(method, url)) { fail(`${where} calls ${call}, which no route answers`); missing++; }
});
if (!missing) ok(`${calls.size} distinct calls, all answered`);

/* ------------------------------------------------------------------ 4 */
head("every module function a route reaches for is exported");
const libs = {};
fs.readdirSync("lib").filter(f => f.endsWith(".js")).forEach(f => {
  const name = f.replace(/\.js$/, "");
  const src = fs.readFileSync("lib/" + f, "utf8");
  const m = src.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
  const exported = new Set();
  /* Split on commas rather than matching names followed by a delimiter — the
     last name has no trailing comma, and a regex that needs one silently drops
     it. That made this audit report fourteen exports as missing when every one
     of them was there. */
  if (m) m[1].split(",").forEach(part => {
    const name = part.split(":")[0].trim();
    if (/^[A-Za-z0-9_]+$/.test(name)) exported.add(name);
  });
  /* db.js exports the handle itself. */
  if (/module\.exports\s*=\s*db/.test(src)) exported.add("*");
  libs[name] = exported;
});

const aliases = {};
[...server.matchAll(/const\s+([A-Z_]+)\s*=\s*require\("\.\/lib\/([a-z]+)"\)/g)]
  .forEach(m => { aliases[m[1]] = m[2]; });

let unexported = 0;
Object.entries(aliases).forEach(([alias, lib]) => {
  const exported = libs[lib];
  if (!exported) { fail(`server requires lib/${lib}, which doesn't exist`); return; }
  if (exported.has("*")) return;
  const used = new Set();
  [...server.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z0-9_]+)`, "g"))]
    .forEach(m => used.add(m[1]));
  used.forEach(fn => {
    if (!exported.has(fn)) { fail(`server calls ${alias}.${fn}(), not exported by lib/${lib}.js`);
      unexported++; }
  });
});
if (!unexported) ok(`${Object.keys(aliases).length} modules, every call exported`);

/* ------------------------------------------------------------------ 5 */
head("the schema matches what the code reads");
const schemaSrc = fs.readFileSync("lib/schema.js", "utf8");
const expected = new Set(
  [...(schemaSrc.match(/const EXPECTED = \{([\s\S]*?)\n\};/) || ["", ""])[1]
    .matchAll(/^\s{2}([a-z_]+):/gm)].map(m => m[1]));

/* Every table any module creates should be declared, or it's unwatched. */
const created = new Set();
fs.readdirSync("lib").filter(f => f.endsWith(".js")).forEach(f => {
  [...fs.readFileSync("lib/" + f, "utf8")
    .matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].forEach(m => created.add(m[1]));
});
[...server.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].forEach(m => created.add(m[1]));

let undeclared = 0;
created.forEach(t => {
  if (!expected.has(t)) { warn(`table "${t}" is created but not declared in the schema registry`);
    undeclared++; }
});
expected.forEach(t => {
  if (!created.has(t)) warn(`the schema expects "${t}" but nothing creates it`);
});
if (!undeclared) ok(`${created.size} tables, all declared`);

/* ------------------------------------------------------------------ 6 */
head("the build includes every source file");
const buildPy = fs.readFileSync("build.py", "utf8");
const shell = fs.readFileSync("shell.html", "utf8");
let unbuilt = 0;
fs.readdirSync("src").filter(f => f.endsWith(".js")).forEach(f => {
  if (!buildPy.includes(f)) { fail(`src/${f} is never read by build.py`); unbuilt++; return; }
  /* And its placeholder is actually in the shell. */
  const ph = (buildPy.match(new RegExp(`\\.replace\\("(__[A-Z0-9]+__)",\\s*\\w+\\)`, "g")) || []);
});
const allSources = shell +
  fs.readdirSync("src").filter(f => f.endsWith(".js"))
    .map(f => fs.readFileSync("src/" + f, "utf8")).join("\n");
[...buildPy.matchAll(/\.replace\("(__[A-Z0-9]+__)"/g)].forEach(m => {
  /* A placeholder may sit in the shell or in any source the shell pulls in. */
  if (!allSources.includes(m[1]))
    { fail(`build.py fills ${m[1]}, which appears in no source`); unbuilt++; }
});
[...shell.matchAll(/^(__[A-Z0-9]+__)$/gm)].forEach(m => {
  if (!buildPy.includes(`"${m[1]}"`)) { fail(`shell.html has ${m[1]}, which build.py never fills`);
    unbuilt++; }
});
if (!unbuilt) ok(`${fs.readdirSync("src").filter(f => f.endsWith(".js")).length} source files, all built in`);

/* ------------------------------------------------------------------ 7 */
head("nothing is left unreplaced in the output");
/* "[object Object]" would only be a fault as rendered text; it appears
   legitimately inside CSS grid-template-areas. And typeof x !== "undefined" is
   an idiom, not a bug. Both need the check to look at where it sits. */
["__", "undefined", "NaN"].forEach(marker => {
  if (marker === "__") {
    const left = app.match(/__[A-Z0-9]{3,}__/g);
    if (left) fail("placeholders survived the build", [...new Set(left)].join(", "));
  } else {
    /* Only the shapes that mean something went wrong: rendered into the page,
       or concatenated into a string. A JavaScript keyword in the source is
       fine. */
    const re = new RegExp(`>\\s*${marker}\\s*<|:\\s*"${marker}"`, "g");
    const hits = (app.match(re) || []).filter(h =>
      !/typeof/.test(app.slice(Math.max(0, app.indexOf(h) - 30), app.indexOf(h))));
    if (hits.length) {
      const at = app.indexOf(hits[0]);
      warn(`"${marker}" reaches the page`, app.slice(Math.max(0, at - 60), at + 40)
        .replace(/\s+/g, " ").trim());
    }
  }
});
if (!app.match(/__[A-Z0-9]{3,}__/g)) ok("no placeholders left");

/* ------------------------------------------------------------------ 8 */
head("every module a test stubs still exists");
let stale = 0;
fs.readdirSync("tests").filter(f => f.endsWith(".test.js")).forEach(f => {
  const src = fs.readFileSync("tests/" + f, "utf8");
  [...src.matchAll(/require\("\.\.\/lib\/([a-z-]+)\.js"\)/g)].forEach(m => {
    if (!fs.existsSync(`lib/${m[1]}.js`)) { fail(`tests/${f} requires lib/${m[1]}.js`); stale++; }
  });
});
if (!stale) ok(`${fs.readdirSync("tests").filter(f => f.endsWith(".test.js")).length} suites, no stale references`);

/* ------------------------------------------------------------------ 9 */
head("timestamps are written through one helper");
/* The bug that hid today's sales from every report. */
let raw = 0;
fs.readdirSync("lib").filter(f => f.endsWith(".js") && f !== "when.js").forEach(f => {
  const src = fs.readFileSync("lib/" + f, "utf8");
  const hits = (src.match(/toISOString\(\)\.slice\(0,\s*19\)\.replace\("T",\s*" "\)/g) || []).length;
  if (hits) { warn(`lib/${f} builds a timestamp by hand ${hits} time${hits === 1 ? "" : "s"}`);
    raw += hits; }
});
if (!raw) ok("every timestamp goes through lib/when.js");

/* ------------------------------------------------------------------ 10 */
head("the operator console is properly gated");
const guarded = (server.match(/auth,\s*operator/g) || []).length;
const adminRoutes = (server.match(/app\.(get|post|put|delete)\("\/api\/admin\//g) || []).length;
if (guarded < adminRoutes - 1)   /* whoami is deliberately open to any account */
  fail(`${adminRoutes} admin routes but only ${guarded} are behind the operator check`);
else ok(`${adminRoutes} operator routes, ${guarded} gated`);

if (!/return res\.status\(404\)/.test(server.slice(server.indexOf("function operator"),
    server.indexOf("function operator") + 400)))
  warn("the operator guard doesn't answer 404 — it reveals the routes exist");
else ok("a non-operator gets 404, not 403");

/* ------------------------------------------------------------------ */
console.log("\n" + "─".repeat(58));
if (problems) console.log(`${problems} problem${problems === 1 ? "" : "s"}` +
  (warnings ? `, ${warnings} worth a look` : ""));
else if (warnings) console.log(`No problems. ${warnings} worth a look.`);
else console.log("Everything is wired up.");
process.exit(problems ? 1 : 0);
