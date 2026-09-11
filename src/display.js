/* ===========================================================================
   Driving the customer display.

   The till broadcasts what the customer should see. Three routes, chosen by
   what's actually available rather than configured:

     BroadcastChannel   a second window on the same machine. Instant, no server.
     localStorage       the same, for browsers without the channel.
     the server         a tablet across the counter, which polls.

   What is sent is deliberately not the sale object. It's a small, flat view
   containing only what the customer is entitled to see — no cost, no margin,
   no staff name, no customer record, no card details. Sending the whole cart
   and letting the display pick would put all of that on a public screen.
   =========================================================================== */

let DISPLAY = { on: false, remote: false, channel: null, last: "" };

function displayInit() {
  const cfg = (CFG.display || {});
  DISPLAY.on = !!cfg.on;
  DISPLAY.remote = !!cfg.remote;
  if (!DISPLAY.on) return;
  try { DISPLAY.channel = new BroadcastChannel("pos_display"); } catch (e) {}
  displayIdle();
}

/* Open the second screen. Deliberately a plain window the person drags onto the
   other monitor — trying to place it automatically needs permissions browsers
   don't give, and getting it wrong puts the customer's total on the till. */
function displayOpen() {
  const url = "/display.html" + (DISPLAY.remote ? "?store=" + STORE_ID : "");
  window.open(url, "posDisplay", "width=1024,height=640");
}

/* Only what a customer may see. */
function displayView(mode, extra) {
  const t = typeof calc === "function" ? calc() : { tot: 0, taxes: {}, disc: 0 };
  const lines = (CART || []).map(c => ({
    n: c.n,
    q: c.q,
    amount: c.price * c.q * (1 - (c.disc || 0) / 100),
    /* A note can carry an ID check or a weight; both are fine for the customer
       to see. Anything else is left off. */
    note: c.mods && c.mods.length ? c.mods.join(", ") : (c.weighNote || null)
  }));

  const taxes = (CFG.taxRates || [])
    .filter(r => r.rate > 0 && Math.abs((t.taxes || {})[r.id] || 0) > 0.001)
    .map(r => ({ n: `${r.n} ${r.rate}%`, amount: t.taxes[r.id] }));

  return {
    mode: mode || "sale",
    shop: {
      name: CFG.site.name,
      slogan: CFG.site.slogan || "",
      logo: CFG.site.logo || ""
    },
    lines,
    taxes,
    discount: Math.abs(t.disc || 0) + Math.abs(t.promoOff || 0),
    total: Math.abs(t.tot || 0),
    ret: !!RETURN,
    ...extra
  };
}

function displaySend(view) {
  if (!DISPLAY.on) return;
  const payload = JSON.stringify(view);
  /* A screen redrawing on every keystroke flickers; nothing changed means
     nothing sent. */
  if (payload === DISPLAY.last) return;
  DISPLAY.last = payload;

  if (DISPLAY.channel) { try { DISPLAY.channel.postMessage(view); } catch (e) {} }
  try { localStorage.setItem("pos_display", payload); } catch (e) {}

  if (DISPLAY.remote && ONLINE) {
    api("/api/display?store=" + STORE_ID, { method: "POST",
      body: { store: STORE_ID, state: view } }).catch(() => {});
  }
}

/* Called wherever the sale changes. */
const displayUpdate = () => displaySend(displayView("sale"));
const displayIdle = () => displaySend(displayView("idle", { lines: [], total: 0 }));

/* Held for a few seconds so somebody can read their change, then cleared —
   nothing on that screen should belong to the last customer. */
function displayDone(sale, change) {
  if (!DISPLAY.on) return;
  displaySend({ ...displayView("done"), lines: [],
    total: Math.abs(sale && sale.tot || 0), change: change || 0 });
  clearTimeout(DISPLAY.timer);
  DISPLAY.timer = setTimeout(displayIdle, 9000);
}

/* An ID check is worth putting on the customer's screen: it tells them why the
   sale has paused without the cashier having to explain. */
function displayAge(text) {
  if (!DISPLAY.on) return;
  displaySend({ ...displayView("age"), ageText: text });
}
