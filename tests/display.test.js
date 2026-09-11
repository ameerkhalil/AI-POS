/* The customer display faces the public, so the thing worth testing isn't that
   it draws — it's that nothing private can reach it. This lifts displayView out
   of the built app and feeds it a sale full of things a customer must never
   see. */
const fs = require("fs");
const vm = require("vm");

let bad = 0;
const chk = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (c || !x ? "" : " — " + x));
  if (!c) bad++; };

const html = fs.readFileSync("public/app.html", "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

const from = js.indexOf("function displayView(");
if (from < 0) { console.log("FAIL displayView is not in the build"); process.exit(1); }
const src = js.slice(from, js.indexOf("\nfunction displaySend(", from));
if (!src.includes("return {")) { console.log("FAIL could not lift displayView"); process.exit(1); }

/* A sale carrying everything that must not end up on a public screen. */
const ctx = {
  console, Math, Number, String, Object, Array, JSON,
  CART: [
    { n: "Marlboro Red", q: 2, price: 11.49, disc: 0,
      cost: 9.20, margin: 0.199, pluId: "P1", deptId: "DTOB",
      idCheck: { by: "scan", age: 34, dob: "1990-09-15" },
      cashier: "Dana Okafor" },
    { n: "Coffee 16oz", q: 1, price: 1.99, disc: 50, cost: 0.31, mods: ["Extra shot"] }
  ],
  RETURN: false,
  CFG: {
    site: { name: "Palos Hills Food and Fuel", slogan: "Open since 1994", logo: "data:image/png,x",
      /* things that live on site but are nobody's business */
      store: "001", register: "1", taxId: "37-1234567" },
    taxRates: [{ id: "TX1", n: "General", rate: 9.25 }, { id: "TX0", n: "Zero", rate: 0 }]
  },
  calc: () => ({ tot: 25.94, taxes: { TX1: 2.20 }, disc: 1.00, promoOff: 0.50,
    sub: 23.24, cost: 18.71, profit: 5.23 }),
  SALE_CUST: { id: 44, name: "Sam Reilly", phone: "708-555-0199", balance: 1200 },
  ME: { n: "Dana Okafor", pin: "4417", role: "Manager" }
};
vm.createContext(ctx);
vm.runInContext(src + "\nthis.displayView = displayView;", ctx);

const view = ctx.displayView("sale");
const dump = JSON.stringify(view);
console.log("── what the customer sees ──");
console.log("   " + view.lines.map(l => `${l.q}× ${l.n} ${l.amount.toFixed(2)}`).join(", "));
console.log(`   total ${view.total}, tax ${view.taxes.map(t => t.n).join("/")}, ` +
  `saved ${view.discount}`);

console.log("\n── it shows what it should ──");
chk("the shop's name", view.shop.name === "Palos Hills Food and Fuel");
chk("both lines", view.lines.length === 2);
chk("quantities", view.lines[0].q === 2);
chk("line amounts, with the discount applied",
  Math.abs(view.lines[0].amount - 22.98) < 0.01 &&
  Math.abs(view.lines[1].amount - 0.995) < 0.01);
chk("the total", view.total === 25.94);
chk("tax, named and rated", view.taxes[0].n === "General 9.25%");
chk("a zero-rate tax is left off", view.taxes.length === 1);
chk("what they saved, promotions included", Math.abs(view.discount - 1.5) < 0.001);
chk("modifiers, which are theirs to check", view.lines[1].note === "Extra shot");

console.log("\n── and nothing it shouldn't ──");
/* Structural, not textual: the cost here is 9.20 and the tax rate legitimately
   reads 9.25%, so searching the JSON as a string finds a false positive. Ask
   whether any key is a cost instead. */
const keysOf = o => {
  const out = [];
  const walk = v => {
    if (!v || typeof v !== "object") return;
    Object.keys(v).forEach(k => { out.push(k); walk(v[k]); });
  };
  walk(o);
  return out;
};
const keys = keysOf(view);
chk("no field is a cost, a margin or a profit",
  !keys.some(k => /^(cost|margin|profit|wholesale)$/i.test(k)), keys.join(","));
chk("no line carries a cost", view.lines.every(l => l.cost === undefined));
chk("no margin", !/margin/i.test(dump));
chk("no profit", !/profit/i.test(dump));
chk("no staff name", !dump.includes("Dana"));
chk("no PIN", !dump.includes("4417"));
chk("no customer record", !dump.includes("Sam Reilly") && !dump.includes("708-555"));
chk("no loyalty balance", !dump.includes("1200"));
chk("no date of birth from the ID scan", !dump.includes("1990-09-15"));
chk("no tax registration number", !dump.includes("37-1234567"));
chk("no internal product ids", !dump.includes("P1") && !dump.includes("DTOB"));

console.log("\n── the other modes ──");
const idle = ctx.displayView("idle", { lines: [], total: 0 });
chk("idle carries no lines", idle.lines.length === 0 && idle.total === 0);
chk("but still names the shop", idle.shop.name === "Palos Hills Food and Fuel");

ctx.RETURN = true;
chk("a refund says so", ctx.displayView("sale").ret === true);
ctx.RETURN = false;

ctx.CART = [];
const empty = ctx.displayView("sale");
chk("an empty cart doesn't throw", Array.isArray(empty.lines) && empty.lines.length === 0);

console.log("\n── the page itself ──");
const page = fs.readFileSync("public/display.html", "utf8");
chk("it never posts anything", !/method:\s*["']POST["']/i.test(page));
chk("it holds no credentials", !/credentials/i.test(page));
chk("it says so when the till goes quiet", page.includes("Lost contact with the till"));
chk("it clears itself after a sale", page.includes('mode === "done"') || page.includes("s.mode === \"done\""));

console.log(bad ? `\nFAIL ${bad} checks` : "\nPASS  the display shows the order and nothing private");
process.exit(bad ? 1 : 0);
