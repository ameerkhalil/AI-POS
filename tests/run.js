/* Every test, one command:  node tests/run.js
   The first two run anywhere Node does. The end-to-end one starts the real
   server, so it needs `npm install` to have been done first. */
const { spawnSync } = require("child_process");
const path = require("path");

const suites = [
  { name: "the schema itself", file: "schema.test.js", flags: ["--experimental-sqlite"] },
  { name: "inventory engine", file: "stock.test.js", flags: ["--experimental-sqlite"] },
  { name: "sales cannot double-count stock", file: "sale-stock.test.js",
    flags: ["--experimental-sqlite"] },
  { name: "terminals, shifts and drawers", file: "terminals.test.js",
    flags: ["--experimental-sqlite"] },
  { name: "reports", file: "reports.test.js", flags: ["--experimental-sqlite"] },
  { name: "vendors and purchase orders", file: "purchasing.test.js",
    flags: ["--experimental-sqlite"] },
  { name: "loyalty", file: "loyalty.test.js", flags: ["--experimental-sqlite"] },
  { name: "tobacco scan data", file: "tobacco.test.js", flags: ["--experimental-sqlite"] },
  { name: "central pricebook", file: "central.test.js", flags: ["--experimental-sqlite"] },
  { name: "the time clock", file: "timeclock.test.js", flags: ["--experimental-sqlite"] },
  { name: "the customer display", file: "display.test.js", flags: [] },
  { name: "error capture", file: "errors.test.js", flags: ["--experimental-sqlite"] },
  { name: "forecourt services", file: "services.test.js", flags: ["--experimental-sqlite"] },
  { name: "every screen renders", file: "screens.test.js", flags: [] },
  { name: "inventory over HTTP", file: "stock-e2e.test.js", flags: [], needsDeps: true }
];

let failed = 0, skipped = 0;
const haveDeps = (() => { try { require.resolve("express"); return true; } catch (e) { return false; } })();

/* The wiring audit first: if a screen has no function behind it or a route is
   unanswered, knowing that before the behaviour tests run saves reading a
   hundred passing assertions about code nobody can reach. */
console.log("\n── wiring audit ──");
{
  const r = spawnSync(process.execPath, [path.join(__dirname, "audit.js")], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}

for (const s of suites) {
  if (s.needsDeps && !haveDeps) {
    console.log(`\n── ${s.name}: skipped, run npm install first ──`);
    skipped++;
    continue;
  }
  console.log(`\n── ${s.name} ──`);
  const r = spawnSync(process.execPath, [...s.flags, path.join(__dirname, s.file)],
    { stdio: "inherit" });
  if (r.status !== 0) failed++;
}

console.log(failed ? `\n${failed} suite(s) FAILED`
  : skipped ? `\nall suites passed (${skipped} skipped)` : "\nall suites passed");
process.exit(failed ? 1 : 0);
