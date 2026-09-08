/* ---------------------------------------------------------------------------
   AI POS — server

   Three jobs:
     1. Accounts and sessions, so a terminal remembers whose store it is.
     2. Persistence for the config, the shifts and the sales journal.
     3. An AI proxy. The Anthropic key lives here and never reaches a browser.

   Run:  ANTHROPIC_API_KEY=sk-ant-... npm start
   --------------------------------------------------------------------------- */
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const db = require("./lib/db");
const P = require("./lib/privacy");
const PAY = require("./lib/payments");
const LEARN = require("./lib/learn");

const app = express();
const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.POS_MODEL || "claude-sonnet-4-6";
const SESSION_DAYS = 30;

app.set("trust proxy", 1);
app.use(express.json({ limit: "25mb" }));   // invoice images arrive as base64
app.use(express.urlencoded({ extended: false }));
app.use(P.sameOrigin);

/* ------------------------------- sessions ------------------------------- */
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function issueSession(res, accountId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare("INSERT INTO sessions (token, account_id, expires_at) VALUES (?,?,?)")
    .run(token, accountId, expires.toISOString());
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie",
    `pos_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
function auth(req, res, next) {
  const token = parseCookies(req).pos_session;
  if (!token) return res.status(401).json({ error: "Not signed in" });
  const row = db.prepare(
    "SELECT s.account_id, a.email, a.name FROM sessions s JOIN accounts a ON a.id = s.account_id " +
    "WHERE s.token = ? AND s.expires_at > datetime('now')").get(token);
  if (!row) return res.status(401).json({ error: "Session expired" });
  req.account = { id: row.account_id, email: row.email, name: row.name };
  next();
}
/* A store always belongs to exactly one account. Every store-scoped route
   proves that before touching anything. */
function ownStore(req, res, next) {
  const id = Number(req.query.store || req.body.store);
  if (!id) return res.status(400).json({ error: "No store specified" });
  const s = db.prepare("SELECT * FROM stores WHERE id = ? AND account_id = ?").get(id, req.account.id);
  if (!s) return res.status(404).json({ error: "Store not found" });
  req.store = s;
  next();
}

/* -------------------------------- accounts ------------------------------- */
app.post("/api/signup", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const storeName = String(req.body.storeName || "").trim() || "My store";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return res.status(400).json({ error: "That doesn't look like an email address." });
  if (password.length < 8)
    return res.status(400).json({ error: "Use at least 8 characters for the password." });
  if (db.prepare("SELECT 1 FROM accounts WHERE email = ?").get(email))
    return res.status(409).json({ error: "There's already an account with that email." });

  const hash = bcrypt.hashSync(password, 12);
  const tx = db.transaction(() => {
    const a = db.prepare("INSERT INTO accounts (email, pass_hash, name) VALUES (?,?,?)")
      .run(email, hash, req.body.name || null);
    const s = db.prepare("INSERT INTO stores (account_id, name) VALUES (?,?)")
      .run(a.lastInsertRowid, storeName);
    return { accountId: a.lastInsertRowid, storeId: s.lastInsertRowid };
  });
  const { accountId, storeId } = tx();
  P.audit(accountId, "signup", email, req);
  issueSession(res, accountId);
  res.json({ ok: true, storeId });
});

app.post("/api/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (P.loginBlocked(email, ip))
    return res.status(429).json({ error: "Too many failed attempts. Try again in fifteen minutes." });

  const a = db.prepare("SELECT * FROM accounts WHERE email = ?").get(email);
  // Same message either way, and the same amount of work — don't leak which emails exist.
  const bad = () => { P.recordAttempt(email, ip, false);
    return res.status(401).json({ error: "Email or password is wrong." }); };
  if (!a) { bcrypt.compareSync("x", "$2a$12$" + "x".repeat(53)); return bad(); }
  if (!bcrypt.compareSync(String(req.body.password || ""), a.pass_hash)) return bad();
  P.recordAttempt(email, ip, true);
  P.audit(a.id, "login", null, req);
  issueSession(res, a.id);
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  const t = parseCookies(req).pos_session;
  if (t) db.prepare("DELETE FROM sessions WHERE token = ?").run(t);
  res.setHeader("Set-Cookie", "pos_session=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  const stores = db.prepare(
    "SELECT s.id, s.name, (SELECT 1 FROM configs c WHERE c.store_id = s.id) AS configured " +
    "FROM stores s WHERE s.account_id = ? ORDER BY s.id").all(req.account.id);
  res.json({ account: req.account, stores: stores.map(s => ({ ...s, configured: !!s.configured })) });
});

app.post("/api/stores", auth, (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Give the store a name." });
  const r = db.prepare("INSERT INTO stores (account_id, name) VALUES (?,?)").run(req.account.id, name);
  res.json({ ok: true, id: r.lastInsertRowid });
});

/* ---------------------------- account controls --------------------------- */
app.post("/api/account/password", auth, (req, res) => {
  const a = db.prepare("SELECT * FROM accounts WHERE id = ?").get(req.account.id);
  if (!bcrypt.compareSync(String(req.body.current || ""), a.pass_hash))
    return res.status(401).json({ error: "Current password is wrong." });
  const next = String(req.body.next || "");
  if (next.length < 8) return res.status(400).json({ error: "Use at least 8 characters." });
  db.prepare("UPDATE accounts SET pass_hash = ? WHERE id = ?").run(bcrypt.hashSync(next, 12), a.id);
  // Changing a password signs out everywhere else. That is the point of changing it.
  const keep = parseCookies(req).pos_session;
  db.prepare("DELETE FROM sessions WHERE account_id = ? AND token != ?").run(a.id, keep);
  P.audit(a.id, "password-change", null, req);
  res.json({ ok: true });
});

app.get("/api/account/sessions", auth, (req, res) => {
  const cur = parseCookies(req).pos_session;
  res.json({ sessions: db.prepare(
    "SELECT token, created_at, expires_at FROM sessions WHERE account_id = ? ORDER BY created_at DESC")
    .all(req.account.id).map(s => ({
      created_at: s.created_at, expires_at: s.expires_at, current: s.token === cur,
      id: s.token.slice(0, 8)
    })) });
});

app.post("/api/account/sessions/revoke", auth, (req, res) => {
  const keep = parseCookies(req).pos_session;
  const n = db.prepare("DELETE FROM sessions WHERE account_id = ? AND token != ?")
    .run(req.account.id, keep).changes;
  P.audit(req.account.id, "sessions-revoked", String(n), req);
  res.json({ ok: true, revoked: n });
});

/* Take everything and go. No lock-in, and it doubles as the merchant's own backup. */
app.get("/api/account/export", auth, (req, res) => {
  const data = P.exportAccount(req.account.id);
  P.audit(req.account.id, "export", null, req);
  res.setHeader("Content-Disposition",
    `attachment; filename="pos-export-${new Date().toISOString().slice(0,10)}.json"`);
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(data, null, 2));
});

app.post("/api/account/delete", auth, (req, res) => {
  const a = db.prepare("SELECT * FROM accounts WHERE id = ?").get(req.account.id);
  if (!bcrypt.compareSync(String(req.body.password || ""), a.pass_hash))
    return res.status(401).json({ error: "Password is wrong." });
  if (String(req.body.confirm || "") !== "DELETE")
    return res.status(400).json({ error: "Type DELETE to confirm." });
  P.audit(a.id, "account-deleted", a.email, req);
  P.deleteAccount(a.id);
  res.setHeader("Set-Cookie", "pos_session=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/account/activity", auth, (req, res) => {
  res.json({ activity: db.prepare(
    "SELECT at, action, detail, ip FROM audit WHERE account_id = ? ORDER BY at DESC LIMIT 100")
    .all(req.account.id) });
});

/* --------------------------------- config -------------------------------- */
app.get("/api/config", auth, ownStore, (req, res) => {
  const row = db.prepare("SELECT json, updated_at FROM configs WHERE store_id = ?").get(req.store.id);
  if (!row) return res.json({ config: null });
  res.json({ config: JSON.parse(row.json), updatedAt: row.updated_at });
});

app.put("/api/config", auth, ownStore, (req, res) => {
  const cfg = req.body.config;
  if (!cfg || typeof cfg !== "object" || !Array.isArray(cfg.plus))
    return res.status(400).json({ error: "That isn't a POS configuration." });
  db.prepare(
    "INSERT INTO configs (store_id, json, updated_at) VALUES (?,?,datetime('now')) " +
    "ON CONFLICT(store_id) DO UPDATE SET json = excluded.json, updated_at = datetime('now')")
    .run(req.store.id, JSON.stringify(cfg));
  if (cfg.site && cfg.site.name)
    db.prepare("UPDATE stores SET name = ? WHERE id = ?").run(cfg.site.name, req.store.id);
  res.json({ ok: true });
});

/* --------------------------------- shifts -------------------------------- */
app.post("/api/shifts", auth, ownStore, (req, res) => {
  const r = db.prepare(
    "INSERT INTO shifts (store_id, opened_at, opened_by, start_cash) VALUES (?,?,?,?)")
    .run(req.store.id, new Date().toISOString(), req.body.by || null, Number(req.body.startCash) || 0);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.patch("/api/shifts/:id", auth, ownStore, (req, res) => {
  const s = db.prepare("SELECT * FROM shifts WHERE id = ? AND store_id = ?")
    .get(req.params.id, req.store.id);
  if (!s) return res.status(404).json({ error: "Shift not found" });
  db.prepare("UPDATE shifts SET closed_at = ?, counted = ?, json = ? WHERE id = ?")
    .run(new Date().toISOString(), req.body.counted ?? null,
         JSON.stringify(req.body.summary || {}), s.id);
  res.json({ ok: true });
});

app.get("/api/shifts", auth, ownStore, (req, res) => {
  res.json({ shifts: db.prepare(
    "SELECT * FROM shifts WHERE store_id = ? ORDER BY opened_at DESC LIMIT 60").all(req.store.id) });
});

/* ---------------------------------- sales -------------------------------- */
/* Sales carry a client-generated id so a queued sale replayed after a
   reconnection lands exactly once. Without this, a flaky connection during
   tender turns into a double charge on the report. */
function insertSale(storeId, shiftId, s) {
  const cid = String(s.cid || "").slice(0, 40) || null;
  if (cid) {
    const seen = db.prepare("SELECT id FROM sales WHERE store_id = ? AND client_id = ?").get(storeId, cid);
    if (seen) return { duplicate: true, cid };
  }
  db.prepare(
    "INSERT INTO sales (store_id, shift_id, seq, at, cashier, total, is_return, client_id, json) " +
    "VALUES (?,?,?,?,?,?,?,?,?)")
    .run(storeId, shiftId || null, Number(s.n) || 0, s.at || new Date().toISOString(),
         s.by || null, Number(s.tot) || 0, s.ret ? 1 : 0, cid, JSON.stringify(s));
  return { duplicate: false, cid };
}

/* Cheap liveness check. The terminal hits this to tell "connected to a network"
   apart from "can actually reach the server", which are not the same thing on
   café Wi-Fi or a captive portal. */
app.get("/api/ping", (req, res) => res.json({ ok: true, t: Date.now() }));

/* Flush endpoint for the offline queue. Returns the ids it accepted, and the
   terminal only clears those — anything not confirmed stays queued. */
app.post("/api/sync", auth, ownStore, (req, res) => {
  const sales = Array.isArray(req.body.sales) ? req.body.sales.slice(0, 500) : [];
  const accepted = [], failed = [];
  const tx = db.transaction(() => {
    sales.forEach(s => {
      try { const r = insertSale(req.store.id, req.body.shiftId, s); accepted.push(r.cid || s.cid); }
      catch (e) { failed.push(s.cid); }
    });
  });
  try { tx(); } catch (e) { return res.status(500).json({ error: "Sync failed", accepted: [], failed }); }
  if (accepted.length) P.audit(req.account.id, "sync", `${accepted.length} sales`, req);
  res.json({ ok: true, accepted, failed });
});
app.post("/api/sales", auth, ownStore, (req, res) => {
  const s = req.body.sale;
  if (!s) return res.status(400).json({ error: "No sale supplied" });
  const r = insertSale(req.store.id, req.body.shiftId, s);
  res.json({ ok: true, duplicate: r.duplicate });
});

app.get("/api/sales", auth, ownStore, (req, res) => {
  const rows = req.query.shift
    ? db.prepare("SELECT json FROM sales WHERE store_id = ? AND shift_id = ? ORDER BY id")
        .all(req.store.id, req.query.shift)
    : db.prepare("SELECT json FROM sales WHERE store_id = ? ORDER BY id DESC LIMIT 500")
        .all(req.store.id);
  res.json({ sales: rows.map(r => JSON.parse(r.json)) });
});

/* Daily totals, straight out of SQL rather than replayed in the browser. */
app.get("/api/summary", auth, ownStore, (req, res) => {
  const days = db.prepare(
    "SELECT date(at) AS day, COUNT(*) AS n, SUM(total) AS total " +
    "FROM sales WHERE store_id = ? GROUP BY date(at) ORDER BY day DESC LIMIT 30").all(req.store.id);
  res.json({ days });
});

/* ---------------------------------- AI ----------------------------------- */
/* The browser never sees the key. It also never picks the model, and it can't
   ask for an unbounded response. */
const RATE = new Map();
function rateOk(id) {
  const now = Date.now(), win = 60_000, cap = 40;
  const hits = (RATE.get(id) || []).filter(t => now - t < win);
  hits.push(now);
  RATE.set(id, hits);
  return hits.length <= cap;
}

app.post("/api/ai", auth, async (req, res) => {
  if (!KEY) return res.status(503).json({
    error: "The server has no ANTHROPIC_API_KEY set, so AI features are off." });
  if (!rateOk(req.account.id)) return res.status(429).json({
    error: "Too many requests in a row. Give it a minute." });

  const { messages, tools, max_tokens, kind } = req.body || {};
  if (!Array.isArray(messages) || !messages.length)
    return res.status(400).json({ error: "No messages supplied" });

  const body = {
    model: MODEL,
    max_tokens: Math.min(Number(max_tokens) || 1024, 8000),
    messages
  };
  if (Array.isArray(tools) && tools.length) {
    // Only the web search tool is allowed through, and only in its known shape.
    body.tools = tools.filter(t => t && t.type === "web_search_20250305")
      .map(() => ({ type: "web_search_20250305", name: "web_search", max_uses: 5 }));
    if (!body.tools.length) delete body.tools;
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    db.prepare("INSERT INTO ai_calls (account_id, kind, in_tokens, out_tokens, ok) VALUES (?,?,?,?,?)")
      .run(req.account.id, kind || null, data?.usage?.input_tokens || null,
           data?.usage?.output_tokens || null, r.ok ? 1 : 0);
    if (!r.ok) {
      console.error(`  ! AI call failed (${kind || "unknown"}): ${r.status} ${data?.error?.type || ""} ` +
        `${data?.error?.message || ""}`);
      return res.status(r.status).json({ error: data?.error?.message || "Upstream error" });
    }
    res.json(data);
  } catch (e) {
    console.error(`  ! AI call threw (${kind || "unknown"}): ${e.message}`);
    db.prepare("INSERT INTO ai_calls (account_id, kind, ok) VALUES (?,?,0)").run(req.account.id, kind || null);
    res.status(502).json({ error: `Couldn't reach the model: ${e.message}` });
  }
});

/* ------------------------------- learning -------------------------------- */
/* Structure in, structure out. A store contributes the shape of its setup and
   gets the accumulated shape of everyone else's back. Opt out and it does
   neither — no contribution, no suggestions. */
app.post("/api/learn/contribute", auth, ownStore, (req, res) => {
  const settings = PAY.getSettings(req.store.id);
  if (settings.noLearn) return res.json({ ok: true, skipped: "opted out" });
  const ok = LEARN.contribute(req.store.id, String(req.body.bizType || ""), req.body.config);
  res.json({ ok });
});

app.get("/api/learn/suggest", auth, (req, res) => {
  const type = String(req.query.type || "");
  if (!type) return res.status(400).json({ error: "No business type given" });
  const store = Number(req.query.store) || null;
  if (store) {
    const owns = db.prepare("SELECT 1 FROM stores WHERE id = ? AND account_id = ?")
      .get(store, req.account.id);
    if (!owns) return res.status(404).json({ error: "Store not found" });
  }
  res.json(LEARN.suggest(type, store));
});

app.get("/api/learn/optout", auth, ownStore, (req, res) => {
  res.json({ optedOut: !!PAY.getSettings(req.store.id).noLearn });
});

app.post("/api/learn/optout", auth, ownStore, (req, res) => {
  const cur = PAY.getSettings(req.store.id);
  const off = !!req.body.optOut;
  PAY.putSettings(req.store.id, { ...cur, noLearn: off || undefined });
  if (off) db.prepare("DELETE FROM patterns WHERE store_id = ?").run(req.store.id);
  P.audit(req.account.id, off ? "learning-optout" : "learning-optin", req.store.name, req);
  res.json({ ok: true, optedOut: off });
});

app.get("/api/learn/stats", auth, (req, res) => res.json(LEARN.stats()));

/* ------------------------------- payments -------------------------------- */
/* Every route here is store-scoped like the rest. The Stripe secret lives in
   store_settings on the server and is never sent to a browser — the terminal
   only ever sees intent ids and statuses. */
app.get("/api/pay/settings", auth, ownStore, (req, res) => {
  const s = PAY.getSettings(req.store.id);
  res.json({ settings: {
    configured: !!s.stripeSecret,
    mode: s.stripeSecret ? (s.stripeSecret.startsWith("sk_live") ? "live" : "test") : null,
    readerId: s.readerId || null, readerLabel: s.readerLabel || null,
    locationId: s.locationId || null
  }});
});

app.put("/api/pay/settings", auth, ownStore, (req, res) => {
  const cur = PAY.getSettings(req.store.id);
  const next = { ...cur };
  if (typeof req.body.stripeSecret === "string") {
    const k = req.body.stripeSecret.trim();
    if (k && !/^sk_(test|live)_/.test(k))
      return res.status(400).json({ error: "That doesn't look like a Stripe secret key." });
    next.stripeSecret = k || undefined;
  }
  if ("readerId" in req.body) next.readerId = req.body.readerId || undefined;
  if ("readerLabel" in req.body) next.readerLabel = req.body.readerLabel || undefined;
  if ("locationId" in req.body) next.locationId = req.body.locationId || undefined;
  PAY.putSettings(req.store.id, next);
  P.audit(req.account.id, "payments-settings", req.store.name, req);
  res.json({ ok: true });
});

app.get("/api/pay/readers", auth, ownStore, async (req, res) => {
  const { stripe } = PAY.clientFor(req.store.id);
  if (!stripe) return res.status(400).json({ error: "No Stripe key set for this store." });
  try {
    const d = await stripe.listReaders();
    res.json({ readers: (d.data || []).map(r => ({
      id: r.id, label: r.label, status: r.status, device: r.device_type, serial: r.serial_number })) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* Creating a simulated reader lets the whole flow be exercised end to end with
   no hardware in the room, which is how you find the bugs before the counter. */
app.post("/api/pay/simulate", auth, ownStore, async (req, res) => {
  const { stripe, settings } = PAY.clientFor(req.store.id);
  if (!stripe) return res.status(400).json({ error: "No Stripe key set." });
  try {
    let loc = settings.locationId;
    if (!loc) { const l = await stripe.createLocation(req.store.name || "Store"); loc = l.id; }
    const r = await stripe.createSimulated(loc);
    PAY.putSettings(req.store.id, { ...settings, locationId: loc, readerId: r.id, readerLabel: r.label });
    res.json({ ok: true, reader: { id: r.id, label: r.label } });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/pay/register", auth, ownStore, async (req, res) => {
  const { stripe, settings } = PAY.clientFor(req.store.id);
  if (!stripe) return res.status(400).json({ error: "No Stripe key set." });
  try {
    let loc = settings.locationId;
    if (!loc) { const l = await stripe.createLocation(req.store.name || "Store"); loc = l.id; }
    const r = await stripe.registerReader(String(req.body.code || "").trim(),
      String(req.body.label || "Register 1"), loc);
    PAY.putSettings(req.store.id, { ...settings, locationId: loc, readerId: r.id, readerLabel: r.label });
    res.json({ ok: true, reader: { id: r.id, label: r.label } });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* Start a card payment. Returns immediately with an intent id; the terminal
   polls for the result rather than holding a request open for a minute. */
app.post("/api/pay/start", auth, ownStore, async (req, res) => {
  const { stripe, settings } = PAY.clientFor(req.store.id);
  if (!stripe) return res.status(400).json({ error: "Card payments aren't set up for this store." });
  if (!settings.readerId) return res.status(400).json({ error: "No card reader is paired." });
  const cents = Math.round(Number(req.body.amount) * 100);
  if (!(cents > 0)) return res.status(400).json({ error: "Amount must be more than zero." });
  try {
    const pi = await stripe.createIntent(cents, "usd", {
      store: String(req.store.id), sale: String(req.body.saleCid || ""), register: String(req.body.register || "1")
    });
    PAY.db.prepare("INSERT INTO payments (store_id,intent_id,reader_id,amount,status,sale_cid) VALUES (?,?,?,?,?,?)")
      .run(req.store.id, pi.id, settings.readerId, cents, pi.status, req.body.saleCid || null);
    await stripe.processOnReader(settings.readerId, pi.id);
    res.json({ ok: true, intent: pi.id, status: pi.status });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/pay/status", auth, ownStore, async (req, res) => {
  const { stripe } = PAY.clientFor(req.store.id);
  if (!stripe) return res.status(400).json({ error: "No Stripe key set." });
  const id = String(req.query.intent || "");
  const row = PAY.db.prepare("SELECT * FROM payments WHERE store_id = ? AND intent_id = ?")
    .get(req.store.id, id);
  if (!row) return res.status(404).json({ error: "Unknown payment" });
  try {
    const pi = await stripe.getIntent(id);
    const card = pi.charges?.data?.[0]?.payment_method_details?.card_present
      || pi.latest_charge?.payment_method_details?.card_present || null;
    PAY.db.prepare("UPDATE payments SET status=?,brand=?,last4=?,updated_at=datetime('now') WHERE id=?")
      .run(pi.status, card?.brand || null, card?.last4 || null, row.id);
    res.json({ status: pi.status, amount: pi.amount,
      brand: card?.brand || null, last4: card?.last4 || null,
      error: pi.last_payment_error?.message || null });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* Test-mode only: tells the simulated reader to tap a card. */
app.post("/api/pay/simulate-tap", auth, ownStore, async (req, res) => {
  const { stripe, settings } = PAY.clientFor(req.store.id);
  if (!stripe || !settings.readerId) return res.status(400).json({ error: "No reader." });
  try { await stripe.presentTestCard(settings.readerId); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/* Capture is a separate step deliberately. The money is only taken once the
   sale has been written down, so a crash between authorisation and recording
   leaves an uncaptured hold rather than a charge with no receipt. */
app.post("/api/pay/capture", auth, ownStore, async (req, res) => {
  const { stripe } = PAY.clientFor(req.store.id);
  if (!stripe) return res.status(400).json({ error: "No Stripe key set." });
  const id = String(req.body.intent || "");
  try {
    /* Some readers settle straight through to succeeded rather than stopping at
       requires_capture. Capturing then is not an error, it's already done —
       so look before leaping and treat an already-captured intent as success. */
    const cur = await stripe.getIntent(id);
    if (cur.status === "succeeded") {
      PAY.db.prepare("UPDATE payments SET status=?,updated_at=datetime('now') WHERE store_id=? AND intent_id=?")
        .run("succeeded", req.store.id, id);
      return res.json({ ok: true, status: "succeeded", already: true });
    }
    if (cur.status !== "requires_capture")
      return res.status(409).json({ error: `Payment is ${cur.status}, not ready to capture.`, status: cur.status });
    const pi = await stripe.capture(id);
    PAY.db.prepare("UPDATE payments SET status=?,updated_at=datetime('now') WHERE store_id=? AND intent_id=?")
      .run(pi.status, req.store.id, pi.id);
    res.json({ ok: true, status: pi.status });
  } catch (e) {
    /* Belt and braces: if it raced and got captured underneath us, that's fine. */
    if (/already been captured/i.test(e.message || ""))
      return res.json({ ok: true, status: "succeeded", already: true });
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/pay/cancel", auth, ownStore, async (req, res) => {
  const { stripe, settings } = PAY.clientFor(req.store.id);
  if (!stripe) return res.status(400).json({ error: "No Stripe key set." });
  try {
    if (settings.readerId) { try { await stripe.cancelReader(settings.readerId); } catch (e) {} }
    if (req.body.intent) { try { await stripe.cancelIntent(String(req.body.intent)); } catch (e) {} }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/pay/refund", auth, ownStore, async (req, res) => {
  const { stripe } = PAY.clientFor(req.store.id);
  if (!stripe) return res.status(400).json({ error: "No Stripe key set." });
  try {
    const cents = req.body.amount ? Math.round(Number(req.body.amount) * 100) : null;
    const r = await stripe.refund(String(req.body.intent || ""), cents);
    P.audit(req.account.id, "refund", `${r.amount / 100} on ${r.payment_intent}`, req);
    res.json({ ok: true, refund: r.id, amount: r.amount });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/pay/list", auth, ownStore, (req, res) => {
  res.json({ payments: PAY.db.prepare(
    "SELECT intent_id,amount,status,brand,last4,created_at FROM payments " +
    "WHERE store_id = ? ORDER BY created_at DESC LIMIT 100").all(req.store.id) });
});

/* ------------------------------ page fetch ------------------------------- */
/* The browser can't fetch a tax-rate page — CORS blocks it — and the model's
   own web search needs a tool that isn't enabled on every key. The server has
   neither restriction, so it does the fetching and hands back plain text for
   the model to read. Domains are allowlisted so this can't be turned into an
   open proxy. */
const FETCH_ALLOW = [
  /(^|\.)avalara\.com$/i, /(^|\.)salestaxhandbook\.com$/i, /(^|\.)sales-taxes\.com$/i,
  /(^|\.)tax-rates\.org$/i, /(^|\.)taxrates\.com$/i, /(^|\.)sale-tax\.com$/i,
  /(^|\.)zip2tax\.com$/i, /\.gov$/i, /\.us$/i
];
function htmlToText(h) {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|header|footer|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}
app.post("/api/fetch", auth, async (req, res) => {
  const urls = (Array.isArray(req.body.urls) ? req.body.urls : []).slice(0, 6);
  if (!urls.length) return res.status(400).json({ error: "No urls supplied" });
  if (!rateOk("fetch:" + req.account.id))
    return res.status(429).json({ error: "Too many lookups in a row." });

  const out = await Promise.all(urls.map(async raw => {
    let u;
    try { u = new URL(String(raw)); } catch { return { url: raw, ok: false, error: "bad url" }; }
    if (u.protocol !== "https:") return { url: raw, ok: false, error: "https only" };
    if (!FETCH_ALLOW.some(re => re.test(u.hostname)))
      return { url: raw, ok: false, error: "domain not allowed" };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(u.toString(), {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; AIPOS/0.1; tax rate lookup)",
          "accept": "text/html,application/xhtml+xml"
        }
      });
      clearTimeout(timer);
      if (!r.ok) return { url: u.toString(), ok: false, error: "HTTP " + r.status };
      const ct = r.headers.get("content-type") || "";
      if (!/text\/html|text\/plain|application\/xhtml/i.test(ct))
        return { url: u.toString(), ok: false, error: "not a web page" };
      const body = (await r.text()).slice(0, 400000);
      return { url: u.toString(), ok: true, text: htmlToText(body).slice(0, 9000) };
    } catch (e) {
      return { url: u.toString(), ok: false, error: e.name === "AbortError" ? "timed out" : e.message };
    }
  }));
  res.json({ pages: out });
});

/* --------------------------------- static -------------------------------- */
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.get("/", (req, res) => {
  const t = parseCookies(req).pos_session;
  const live = t && db.prepare(
    "SELECT 1 FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(t);
  res.redirect(live ? "/app.html" : "/login.html");
});

app.get("/healthz", (req, res) => res.json({ ok: true, ai: !!KEY, backups: P.listBackups().length }));

P.startBackups();

app.listen(PORT, () => {
  console.log(`AI POS listening on :${PORT}`);
  if (!KEY) console.warn("  ! ANTHROPIC_API_KEY is not set — AI features will return 503.");
});
