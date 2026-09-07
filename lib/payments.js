/* ---------------------------------------------------------------------------
   Card payments, via Stripe Terminal.

   This uses the server-driven integration rather than the browser SDK: the
   server creates a PaymentIntent and tells the reader to collect it. That
   choice matters for a POS. The browser never handles card data, never needs
   the Stripe JS SDK loaded, and a register that reloads mid-transaction doesn't
   lose it — the reader and the intent both still exist, and the terminal picks
   the state back up.

   Card data never touches this server either. We deal in intent ids.
   --------------------------------------------------------------------------- */
const db = require("./db");

db.exec(`
CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY,
  store_id      INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  intent_id     TEXT UNIQUE,
  reader_id     TEXT,
  amount        INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'usd',
  status        TEXT NOT NULL,
  brand         TEXT,
  last4         TEXT,
  sale_cid      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_store ON payments(store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS store_settings (
  store_id      INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  json          TEXT NOT NULL DEFAULT '{}'
);
`);

const getSettings = storeId => {
  const r = db.prepare("SELECT json FROM store_settings WHERE store_id = ?").get(storeId);
  return r ? JSON.parse(r.json) : {};
};
const putSettings = (storeId, obj) =>
  db.prepare("INSERT INTO store_settings (store_id, json) VALUES (?,?) " +
    "ON CONFLICT(store_id) DO UPDATE SET json = excluded.json").run(storeId, JSON.stringify(obj));

/* A thin Stripe client over fetch. The whole surface we need is six calls, and
   this keeps the dependency list at three packages. */
function stripeClient(secret) {
  if (!secret) return null;
  const call = async (method, path, params) => {
    const body = params ? form(params) : undefined;
    const r = await fetch("https://api.stripe.com/v1" + path, {
      method,
      headers: {
        authorization: "Bearer " + secret,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-version": "2024-06-20"
      },
      body
    });
    const d = await r.json();
    if (!r.ok) { const e = new Error(d?.error?.message || "Stripe error"); e.code = d?.error?.code; throw e; }
    return d;
  };
  /* Stripe takes form encoding with bracket notation for nested values. */
  const form = obj => {
    const out = [];
    const walk = (o, prefix) => Object.entries(o).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      const key = prefix ? `${prefix}[${k}]` : k;
      if (Array.isArray(v)) v.forEach((x, i) => walk({ [i]: x }, key));
      else if (typeof v === "object") walk(v, key);
      else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
    });
    walk(obj, "");
    return out.join("&");
  };
  return {
    listReaders: () => call("GET", "/terminal/readers?limit=20"),
    createLocation: name => call("POST", "/terminal/locations",
      { display_name: name, address: { line1: "1 Main St", city: "Chicago", state: "IL",
        country: "US", postal_code: "60465" } }),
    createSimulated: locationId => call("POST", "/terminal/readers",
      { registration_code: "simulated-wpe", label: "Simulated reader", location: locationId }),
    registerReader: (code, label, locationId) => call("POST", "/terminal/readers",
      { registration_code: code, label, location: locationId }),
    createIntent: (amount, currency, meta) => call("POST", "/payment_intents", {
      amount, currency: currency || "usd",
      payment_method_types: ["card_present"],
      capture_method: "manual",
      metadata: meta || {}
    }),
    processOnReader: (readerId, intentId) =>
      call("POST", `/terminal/readers/${readerId}/process_payment_intent`, { payment_intent: intentId }),
    presentTestCard: readerId =>
      call("POST", `/test_helpers/terminal/readers/${readerId}/present_payment_method`, {}),
    getIntent: id => call("GET", `/payment_intents/${id}`),
    capture: id => call("POST", `/payment_intents/${id}/capture`),
    cancelIntent: id => call("POST", `/payment_intents/${id}/cancel`),
    cancelReader: readerId => call("POST", `/terminal/readers/${readerId}/cancel_action`),
    refund: (intentId, amount) => call("POST", "/refunds",
      { payment_intent: intentId, ...(amount ? { amount } : {}) })
  };
}

const clientFor = storeId => {
  const s = getSettings(storeId);
  return { stripe: stripeClient(s.stripeSecret), settings: s };
};

module.exports = { getSettings, putSettings, stripeClient, clientFor, db };
