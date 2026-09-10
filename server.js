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
const RET = require("./lib/retention");
const TANKS = require("./lib/tanks");
const ADMIN = require("./lib/admin");
const STOCK = require("./lib/stock");
const TERM = require("./lib/terminals");
const REP = require("./lib/reports");
const PUR = require("./lib/purchasing");
const LOY = require("./lib/loyalty");
const TOB = require("./lib/tobacco");
const SCHEMA = require("./lib/schema");
const MAIL = require("./lib/mail");

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
  res.json({ account: req.account, operator: ADMIN.isOperator(req.account.id),
    stores: stores.map(s => ({ ...s, configured: !!s.configured })) });
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
function insertSale(storeId, shiftId, s, terminalId) {
  const cid = String(s.cid || "").slice(0, 40) || null;
  if (cid) {
    const seen = db.prepare("SELECT id FROM sales WHERE store_id = ? AND client_id = ?").get(storeId, cid);
    if (seen) return { duplicate: true, cid };
  }
  db.prepare(
    "INSERT INTO sales (store_id, shift_id, terminal_id, seq, at, cashier, total, is_return, " +
    "client_id, json) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(storeId, shiftId || null, terminalId || null, Number(s.n) || 0,
         s.at || new Date().toISOString(), s.by || null, Number(s.tot) || 0,
         s.ret ? 1 : 0, cid, JSON.stringify(s));
  if (s.customer)
    db.prepare("UPDATE sales SET customer_id = ? WHERE store_id = ? AND client_id IS ?")
      .run(Number(s.customer), storeId, cid);

  /* Stock and points follow the money, and only for a sale that was actually
     new. The offline queue replays whatever it couldn't confirm, so moving
     either before the duplicate check would count the same sale twice. */
  try {
    const set = STOCK.settings(storeId);
    STOCK.applySale(storeId,
      { seq: Number(s.n) || 0, cashier: s.by || null, ret: !!s.ret, lines: s.lines || [] },
      id => (set[id] || { tracked: 1 }).tracked);
  } catch (e) {
    /* A stock write must never lose a recorded sale. */
    console.log("  stock not updated for sale " + (s.n || "?") + " — " + e.message);
  }

  try {
    if (s.customer) LOY.applySale(storeId,
      Number(s.customer), { seq: Number(s.n) || 0, cashier: s.by || null,
        ret: !!s.ret, lines: s.lines || [] });
  } catch (e) {
    console.log("  points not updated for sale " + (s.n || "?") + " — " + e.message);
  }

  /* Scan data is captured at the moment of sale and never recomputed. A price
     edited next month must not change what was reported last month. */
  try {
    TOB.applySale(storeId, { seq: Number(s.n) || 0, at: s.at || new Date().toISOString(),
      cashier: s.by || null, terminalId: terminalId || null, ret: !!s.ret,
      lines: s.lines || [] });
  } catch (e) {
    console.log("  scan data not captured for sale " + (s.n || "?") + " — " + e.message);
  }

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
  const syncTerm = TERM.byToken(req.body.token);
  const accepted = [], failed = [];
  const tx = db.transaction(() => {
    sales.forEach(s => {
      /* The queue is flushed by the terminal that took the sales, so they keep
         their lane rather than arriving anonymous. */
      try {
        const r = insertSale(req.store.id, req.body.shiftId, s,
          syncTerm && syncTerm.store_id === req.store.id ? syncTerm.id : null);
        accepted.push(r.cid || s.cid);
      }
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
  const t = TERM.byToken(req.body.token);
  const r = insertSale(req.store.id, req.body.shiftId, s,
    t && t.store_id === req.store.id ? t.id : null);
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

/* ---------------------------- password reset ------------------------------
   No mail provider is configured yet, so the link is written to the server log
   as well as emailed if one ever is. Reading your own log is a reasonable proof
   of ownership when you're the one running the service, and it means recovery
   works today rather than after a third-party signup.

   Tokens are single use, expire in thirty minutes, and using one signs out
   every existing session on that account. */
db.exec(`
CREATE TABLE IF NOT EXISTS resets (
  token      TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);`);

app.post("/api/forgot", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  /* The same answer either way — otherwise this becomes a way to find out which
     email addresses have accounts. */
  const same = { ok: true, sent: true, mail: MAIL.configured() };
  if (!email) return res.json(same);

  const a = db.prepare("SELECT id, email FROM accounts WHERE lower(email) = ?").get(email);
  if (!a) { console.log(`  password reset asked for ${email} — no such account`); return res.json(same); }

  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO resets (token, account_id, expires_at) " +
    "VALUES (?,?, datetime('now','+30 minutes'))").run(token, a.id);

  const base = String(process.env.PUBLIC_URL || "").replace(/\/$/, "")
    || `${req.protocol}://${req.get("host")}`;
  const link = `${base}/reset.html?t=${token}`;

  /* Try to send it. If mail isn't configured, or the provider refuses, the link
     still goes to the log — recovery must not depend on a third party being
     reachable, especially when the person recovering is the one running it. */
  const msg = MAIL.resetEmail(link, null);
  MAIL.send({ to: a.email, ...msg }).then(r => {
    if (r.sent) {
      console.log(`  password reset emailed to ${a.email} via ${r.provider}`);
    } else {
      console.log("");
      console.log("  ─────────── PASSWORD RESET ───────────");
      console.log(`  ${a.email}`);
      console.log(`  ${link}`);
      console.log("  valid for 30 minutes, single use");
      console.log(`  email: ${r.reason}`);
      console.log("  ──────────────────────────────────────");
      console.log("");
    }
  });

  try {
    db.prepare("INSERT INTO audit (account_id, action, detail, ip) VALUES (?,?,?,?)")
      .run(a.id, "password-reset-requested", "A reset link was issued",
        req.headers["x-forwarded-for"] || req.ip || "");
  } catch (e) {}

  res.json(same);
});

/* Checked before the form is shown, so a dead link says so immediately rather
   than after somebody has typed a new password twice. */
app.get("/api/reset/check", (req, res) => {
  const r = db.prepare(
    "SELECT account_id FROM resets WHERE token = ? AND used_at IS NULL " +
    "AND expires_at > datetime('now')").get(String(req.query.t || ""));
  res.json({ valid: !!r });
});

app.post("/api/reset", (req, res) => {
  const token = String(req.body.token || "");
  const pass = String(req.body.password || "");
  if (pass.length < 8)
    return res.status(400).json({ error: "Use at least 8 characters." });

  const r = db.prepare(
    "SELECT account_id FROM resets WHERE token = ? AND used_at IS NULL " +
    "AND expires_at > datetime('now')").get(token);
  if (!r) return res.status(400).json({ error: "That link has expired or been used already." });

  db.prepare("UPDATE accounts SET pass_hash = ? WHERE id = ?")
    .run(bcrypt.hashSync(pass, 10), r.account_id);
  db.prepare("UPDATE resets SET used_at = datetime('now') WHERE token = ?").run(token);
  /* Any other reset outstanding for this account is now void too. */
  db.prepare("UPDATE resets SET used_at = datetime('now') " +
    "WHERE account_id = ? AND used_at IS NULL").run(r.account_id);
  db.prepare("DELETE FROM sessions WHERE account_id = ?").run(r.account_id);

  try {
    db.prepare("INSERT INTO audit (account_id, action, detail, ip) VALUES (?,?,?,?)")
      .run(r.account_id, "password-reset", "Password changed via a reset link; all sessions signed out",
        req.headers["x-forwarded-for"] || req.ip || "");
  } catch (e) {}

  res.json({ ok: true });
});

/* --------------------------- recovering an account ------------------------
   Hosted with no shell and no mail server, a forgotten password is otherwise
   terminal. Setting ADMIN_RESET to "email:newpassword" applies it once at boot,
   says so loudly in the log, and records it in that account's activity so the
   change is never silent. Remove the variable afterwards — it re-applies on
   every deploy while it's set, which is a standing back door. */
function resetOnBoot() {
  const raw = String(process.env.ADMIN_RESET || "").trim();
  if (!raw) return;
  console.log("  ADMIN_RESET is set — applying");
  const at = raw.indexOf(":");
  if (at < 1) return console.log("  ADMIN_RESET ignored — expected email:newpassword");

  const email = raw.slice(0, at).trim().toLowerCase();
  const pass = raw.slice(at + 1);
  if (pass.length < 8)
    return console.log("  ADMIN_RESET ignored — the new password must be at least 8 characters");

  const a = db.prepare("SELECT id, email FROM accounts WHERE lower(email) = ?").get(email);
  if (!a) return console.log(`  ADMIN_RESET ignored — no account for ${email}`);

  db.prepare("UPDATE accounts SET pass_hash = ? WHERE id = ?")
    .run(bcrypt.hashSync(pass, 10), a.id);
  /* Every other session is killed, because a reset you didn't ask for should
     not leave someone else still signed in. */
  db.prepare("DELETE FROM sessions WHERE account_id = ?").run(a.id);
  try {
    db.prepare("INSERT INTO audit (account_id, action, detail, ip) VALUES (?,?,?,?)")
      .run(a.id, "password-reset", "Reset from the server environment; all sessions signed out",
        "boot");
  } catch (e) {}

  console.log(`  ADMIN_RESET applied to ${a.email} — sign in, then REMOVE the variable`);
}

/* -------------------------------- tobacco ---------------------------------- */
app.get("/api/tobacco", auth, ownStore, (req, res) => res.json({
  settings: TOB.settings(req.store.id),
  buydowns: TOB.buydowns(req.store.id),
  makers: TOB.MAKERS,
  columns: TOB.COLUMNS
}));

app.put("/api/tobacco", auth, ownStore, (req, res) => {
  TOB.setSettings(req.store.id, req.body.settings || {});
  res.json({ ok: true, settings: TOB.settings(req.store.id) });
});

app.post("/api/tobacco/buydown", auth, ownStore, (req, res) => {
  try { res.json({ ok: true, id: TOB.saveBuydown(req.store.id, req.body.buydown || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/tobacco/buydown/:id", auth, ownStore, (req, res) => {
  TOB.deleteBuydown(req.store.id, +req.params.id);
  res.json({ ok: true });
});

/* What deal applies to this item, for the cashier. */
app.get("/api/tobacco/offers", auth, ownStore, (req, res) =>
  res.json({ offers: TOB.offersFor(req.store.id, String(req.query.plu || ""),
    +req.query.qty || 1) }));

app.get("/api/tobacco/claim", auth, ownStore, (req, res) => {
  const from = String(req.query.from || "2000-01-01") + " 00:00:00";
  const to = String(req.query.to || "2099-01-01") + " 23:59:59";
  const maker = req.query.maker && req.query.maker !== "all" ? String(req.query.maker) : null;
  res.json({ claim: TOB.claim(req.store.id, maker, from, to),
    ready: TOB.checkReady(req.store.id, req.query.maker, from, to) });
});

app.get("/api/tobacco/export", auth, ownStore, (req, res) => {
  const from = String(req.query.from || "2000-01-01") + " 00:00:00";
  const to = String(req.query.to || "2099-01-01") + " 23:59:59";
  const maker = String(req.query.maker || "all");
  const rows = TOB.exportRows(req.store.id, maker, from, to);
  P.audit(req.account.id, "tobacco-export", `${maker}, ${rows.length} lines`, req);
  if (req.query.format === "csv") {
    const name = `scan-${maker}-${String(req.query.from || "").slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    return res.send(TOB.toCSV(rows));
  }
  res.json({ rows, columns: TOB.COLUMNS });
});

/* --------------------------------- loyalty --------------------------------- */
app.get("/api/loyalty", auth, ownStore, (req, res) => res.json({
  settings: LOY.settings(req.store.id),
  offers: LOY.offers(req.store.id)
}));

app.put("/api/loyalty", auth, ownStore, (req, res) => {
  LOY.setSettings(req.store.id, req.body.settings || {});
  res.json({ ok: true, settings: LOY.settings(req.store.id) });
});

app.get("/api/customers", auth, ownStore, (req, res) =>
  res.json({ customers: LOY.find(req.store.id, req.query.q || "") }));

app.get("/api/customers/:id", auth, ownStore, (req, res) => {
  const c = LOY.customer(req.store.id, +req.params.id);
  if (!c) return res.status(404).json({ error: "No such customer." });
  res.json({ customer: c, points: LOY.pointHistory(c.id),
    offers: LOY.progressFor(req.store.id, c.id), usual: LOY.usual(req.store.id, c.id) });
});

app.post("/api/customers", auth, ownStore, (req, res) => {
  try { res.json({ ok: true, id: LOY.saveCustomer(req.store.id, req.body.customer || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/loyalty/quote", auth, ownStore, (req, res) =>
  res.json(LOY.quote(req.store.id, +req.body.customer, req.body.total)));

app.post("/api/loyalty/redeem", auth, ownStore, (req, res) => {
  try {
    res.json(LOY.redeem(req.store.id, +req.body.customer, req.body.points,
      { who: req.body.who, ref: req.body.ref, saleTotal: req.body.total }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/loyalty/adjust", auth, ownStore, (req, res) => {
  try {
    LOY.movePoints(req.store.id, +req.body.customer,
      { amount: req.body.amount, kind: "adjusted", who: req.body.who, note: req.body.note });
    P.audit(req.account.id, "points-adjusted",
      `${req.body.amount} to customer ${req.body.customer}: ${req.body.note || ""}`, req);
    res.json({ ok: true, balance: LOY.balance(+req.body.customer) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/offers", auth, ownStore, (req, res) => {
  try { res.json({ ok: true, id: LOY.saveOffer(req.store.id, req.body.offer || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/offers/:id", auth, ownStore, (req, res) => {
  LOY.deleteOffer(req.store.id, +req.params.id);
  res.json({ ok: true });
});

app.post("/api/offers/:id/claim", auth, ownStore, (req, res) => {
  try { res.json(LOY.claimOffer(req.store.id, +req.params.id, +req.body.customer, req.body.who)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/loyalty/customers", auth, ownStore, (req, res) => res.json({
  top: LOY.topCustomers(req.store.id, +req.query.days || 90),
  lapsed: LOY.lapsed(req.store.id, +req.query.lapsed || 60)
}));

/* ------------------------- vendors and purchase orders --------------------- */
app.get("/api/vendors", auth, ownStore, (req, res) =>
  res.json({ vendors: PUR.vendors(req.store.id, req.query.all === "1") }));

app.post("/api/vendors", auth, ownStore, (req, res) => {
  try { res.json({ ok: true, id: PUR.saveVendor(req.store.id, req.body.vendor || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/vendors/:id/archive", auth, ownStore, (req, res) => {
  PUR.archiveVendor(req.store.id, +req.params.id, req.body.on !== false);
  res.json({ ok: true });
});

app.get("/api/po", auth, ownStore, (req, res) => res.json({
  orders: PUR.list(req.store.id, req.query.state || null),
  outstanding: PUR.outstanding(req.store.id),
  onOrder: PUR.onOrder(req.store.id)
}));

app.get("/api/po/:id", auth, ownStore, (req, res) => {
  const o = PUR.order(req.store.id, +req.params.id);
  o ? res.json(o) : res.status(404).json({ error: "No such order." });
});

app.post("/api/po", auth, ownStore, (req, res) => {
  try {
    const id = PUR.createOrder(req.store.id, { ...req.body, who: req.body.who });
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/po/:id", auth, ownStore, (req, res) => {
  try { PUR.setLines(req.store.id, +req.params.id, req.body.lines || []); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/po/:id/send", auth, ownStore, (req, res) => {
  try { res.json(PUR.send(req.store.id, +req.params.id, req.body.who)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/po/:id/cancel", auth, ownStore, (req, res) => {
  try { PUR.cancel(req.store.id, +req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/po/:id/receive", auth, ownStore, (req, res) => {
  try {
    const r = PUR.receiveOrder(req.store.id, +req.params.id, req.body);
    P.audit(req.account.id, "po-received",
      `PO ${req.params.id}: ${r.unitsReceived} of ${r.unitsOrdered} units`, req);
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/vendors/:id/summary", auth, ownStore, (req, res) =>
  res.json(PUR.vendorSummary(req.store.id, +req.params.id, +req.query.days || 180)));

app.post("/api/po/from-reorder", auth, ownStore, (req, res) => {
  try { res.json({ created: PUR.fromReorder(req.store.id, req.body) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/* --------------------------------- reports --------------------------------
   Department names live in the pricebook, which is the browser's, so they come
   in with the request rather than the server guessing at them. */
app.post("/api/reports", auth, ownStore, (req, res) => {
  const days = +req.body.days || 30;
  const names = req.body.deptNames || {};
  const want = Array.isArray(req.body.want) ? req.body.want : ["overview"];
  const out = {};
  try {
    if (want.includes("overview")) out.overview = REP.overview(req.store.id, days);
    if (want.includes("byDay")) out.byDay = REP.byDay(req.store.id, days);
    if (want.includes("busy")) out.busy = REP.busy(req.store.id, days);
    if (want.includes("products")) out.products = REP.products(req.store.id, days, req.body.limit);
    if (want.includes("departments")) out.departments = REP.departments(req.store.id, days, names);
    if (want.includes("staff")) out.staff = REP.staff(req.store.id, days);
    if (want.includes("tenders")) out.tenders = REP.tenders(req.store.id, days);
    if (want.includes("exceptions")) out.exceptions = REP.exceptions(req.store.id, days);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/reports/day", auth, ownStore, (req, res) => {
  const d = String(req.body.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: "Bad date." });
  res.json(REP.day(req.store.id, d, req.body.deptNames || {}));
});

/* -------------------------------- terminals -------------------------------
   A register identifies itself with a token it keeps. The session still proves
   which account you are; the token only says which of that store's lanes this
   is, so a stolen token can't reach anything on its own. */
app.post("/api/terminals", auth, ownStore, (req, res) => {
  const t = TERM.register(req.store.id, { name: req.body.name,
    ua: req.headers["user-agent"], ip: req.headers["x-forwarded-for"] || req.ip });
  P.audit(req.account.id, "terminal-registered", `${t.name} (#${t.number})`, req);
  res.json(t);
});

app.get("/api/terminals", auth, ownStore, (req, res) =>
  res.json({ terminals: TERM.list(req.store.id) }));

app.put("/api/terminals/:id", auth, ownStore, (req, res) => {
  TERM.rename(req.store.id, +req.params.id, req.body.name);
  res.json({ ok: true });
});

app.post("/api/terminals/:id/retire", auth, ownStore, (req, res) => {
  try { TERM.retire(req.store.id, +req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/* Cheap and frequent: the terminal says it's alive and what it's running. */
app.post("/api/heartbeat", auth, ownStore, (req, res) => {
  const t = TERM.byToken(req.body.token);
  if (!t || t.store_id !== req.store.id) return res.json({ ok: false, unknown: true });
  TERM.heartbeat(t.id, { build: req.body.build, agent: req.body.agent,
    queued: req.body.queued, ip: req.headers["x-forwarded-for"] || req.ip });
  res.json({ ok: true, id: t.id, number: t.number, name: t.name });
});

/* ---------------------------- shifts and drawers -------------------------- */
app.post("/api/shift/join", auth, ownStore, (req, res) => {
  const t = TERM.byToken(req.body.token);
  if (!t || t.store_id !== req.store.id)
    return res.status(400).json({ error: "This register isn't registered to that store." });
  try {
    const r = TERM.joinShift(req.store.id, t.id,
      { who: req.body.who, startCash: req.body.startCash });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/shift", auth, ownStore, (req, res) => {
  const open = TERM.openShift(req.store.id);
  res.json({ shift: open, summary: open ? TERM.shiftSummary(req.store.id, open.id) : null });
});

app.get("/api/shift/:id", auth, ownStore, (req, res) =>
  res.json(TERM.shiftSummary(req.store.id, +req.params.id) || { error: "No such shift" }));

app.post("/api/drawer/move", auth, ownStore, (req, res) => {
  const t = TERM.byToken(req.body.token);
  const open = TERM.openShift(req.store.id);
  if (!t || !open) return res.status(400).json({ error: "No open shift on this register." });
  const d = TERM.drawerExpected(open.id, t.id);
  if (!d) return res.status(400).json({ error: "No drawer open on this register." });
  try { TERM.drawerMovement(d.id, req.body.kind, req.body.amount); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/drawer/close", auth, ownStore, (req, res) => {
  const t = TERM.byToken(req.body.token);
  const open = TERM.openShift(req.store.id);
  if (!t || !open) return res.status(400).json({ error: "No open shift." });
  try {
    const r = TERM.closeDrawer(open.id, t.id, { counted: req.body.counted, who: req.body.who });
    P.audit(req.account.id, "drawer-closed",
      `${t.name}: counted ${r.counted}, expected ${r.expected}, over ${r.over}`, req);
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/shift/close", auth, ownStore, (req, res) => {
  const open = TERM.openShift(req.store.id);
  if (!open) return res.status(400).json({ error: "No shift is open." });
  try {
    const r = TERM.closeShift(req.store.id, open.id, req.body.who);
    P.audit(req.account.id, "shift-closed",
      `expected ${r.expected}, counted ${r.counted}, over ${r.over}`, req);
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* -------------------------------- inventory -------------------------------
   The pricebook lives in the browser, so anything needing product names takes
   them from the request rather than the server guessing. Quantities, movements
   and counts are the server's. */
app.get("/api/stock", auth, ownStore, (req, res) => {
  res.json({ onHand: STOCK.allOnHand(req.store.id), settings: STOCK.settings(req.store.id) });
});

app.get("/api/stock/history", auth, ownStore, (req, res) => {
  res.json({ moves: STOCK.history(req.store.id, String(req.query.plu || ""),
    +req.query.limit || 100) });
});

app.put("/api/stock/settings", auth, ownStore, (req, res) => {
  const list = Array.isArray(req.body.items) ? req.body.items : [];
  list.slice(0, 5000).forEach(i => {
    if (i && i.pluId) STOCK.setSettings(req.store.id, i.pluId, i);
  });
  res.json({ ok: true, saved: list.length });
});

app.post("/api/stock/receive", auth, ownStore, (req, res) => {
  try {
    const r = STOCK.receive(req.store.id, { who: req.body.who, ref: req.body.ref,
      lines: req.body.lines, note: req.body.note });
    P.audit(req.account.id, "stock-received", `${r.received} lines, ${r.units} units`, req);
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/stock/adjust", auth, ownStore, (req, res) => {
  try {
    const n = STOCK.move(req.store.id, (req.body.moves || []).map(m => ({
      ...m, kind: m.kind === "waste" ? "waste" : "adjust", who: req.body.who })));
    res.json({ ok: true, moves: n });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/stock/count", auth, ownStore, (req, res) => {
  const id = STOCK.openCount(req.store.id, { who: req.body.who, scope: req.body.scope,
    note: req.body.note });
  res.json({ ok: true, id });
});

app.put("/api/stock/count/:id", auth, ownStore, (req, res) => {
  try {
    const out = (req.body.lines || []).map(l =>
      ({ pluId: l.pluId, ...STOCK.countLine(req.store.id, +req.params.id, l.pluId, l.counted, l.cost) }));
    res.json({ ok: true, lines: out });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/stock/count/:id/close", auth, ownStore, (req, res) => {
  try {
    const r = STOCK.closeCount(req.store.id, +req.params.id, req.body.who);
    P.audit(req.account.id, "stock-count-closed",
      `${r.adjusted} adjusted, shrink ${r.shrinkUnits} units`, req);
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/stock/count/:id", auth, ownStore, (req, res) =>
  res.json(STOCK.countDetail(req.store.id, +req.params.id)));

app.get("/api/stock/counts", auth, ownStore, (req, res) =>
  res.json({ counts: STOCK.recentCounts(req.store.id) }));

app.post("/api/stock/reorder", auth, ownStore, (req, res) => {
  /* Subtract what's already on its way, or the list tells you to order the same
     pallet again every day until it turns up. */
  const coming = PUR.onOrder(req.store.id);
  const items = STOCK.reorder(req.store.id, req.body.plus || []).map(i => {
    const due = coming[i.pluId] || 0;
    const need = Math.max(0, i.need - due);
    return { ...i, onOrder: due,
      need: i.caseQty > 1 && need > 0 ? Math.ceil(need / i.caseQty) * i.caseQty : need,
      cases: i.caseQty > 1 && need > 0 ? Math.ceil(need / i.caseQty) : null,
      covered: due > 0 && need === 0 };
  });
  res.json({ items });
});

app.post("/api/stock/valuation", auth, ownStore, (req, res) =>
  res.json(STOCK.valuation(req.store.id, req.body.plus || [])));

app.get("/api/stock/shrink", auth, ownStore, (req, res) =>
  res.json(STOCK.shrink(req.store.id, +req.query.days || 30)));

/* ---------------------------- operator console ----------------------------
   Guarded by a flag on the account row, checked on every request. Not by an
   email match, not by a header — a row, so revoking it is a database change. */
function operator(req, res, next) {
  if (!ADMIN.isOperator(req.account.id)) {
    /* No hint that the route exists. */
    return res.status(404).json({ error: "Not found" });
  }
  next();
}

app.get("/api/admin/fleet", auth, operator, (req, res) => {
  res.json({ ...ADMIN.fleet(req.account.id), trend: ADMIN.trend(+req.query.days || 30),
    attention: ADMIN.attention(), grants: ADMIN.grants() });
});

/* Send yourself one, so the configuration is proved before somebody needs it. */
app.post("/api/admin/mail-test", auth, operator, async (req, res) => {
  const why = MAIL.whyNot();
  if (why) return res.json({ ok: false, reason: why });
  const r = await MAIL.send({
    to: req.account.email,
    subject: "AI POS mail is working",
    text: "If you're reading this, mail is configured correctly.",
    html: `<p style="font-family:sans-serif">If you're reading this, mail is configured
      correctly.</p>`
  });
  ADMIN.log(req.account.id, null, "mail-test", r.sent ? "sent" : r.reason);
  res.json({ ok: r.sent, reason: r.reason, provider: r.provider, to: req.account.email });
});

app.get("/api/admin/mail", auth, operator, (req, res) =>
  res.json({ configured: MAIL.configured(), reason: MAIL.whyNot(),
    provider: String(process.env.MAIL_PROVIDER || "") }));

app.get("/api/admin/ai", auth, operator, (req, res) =>
  res.json(ADMIN.aiUsage(+req.query.days || 30)));

app.get("/api/admin/storage", auth, operator, (req, res) =>
  res.json(ADMIN.storage(process.env.DATA_DIR || "./data",
    process.env.BACKUP_DIR || "./data/backups")));

/* Shown before anything is destroyed: exactly what would go. */
app.post("/api/admin/accounts/preview", auth, operator, (req, res) =>
  res.json({ accounts: ADMIN.deletionPreview(req.body.ids) }));

app.post("/api/admin/accounts/delete", auth, operator, (req, res) => {
  /* Typing the word is the last gate. Nothing here can be undone, and a
     mis-click on a checkbox shouldn't be able to end somebody's business. */
  if (String(req.body.confirm || "").trim().toLowerCase() !== "delete")
    return res.status(400).json({ error: 'Type "delete" to confirm.' });
  const r = ADMIN.deleteAccounts(req.account.id, req.body.ids, id => P.deleteAccount(id));
  res.json(r);
});

app.post("/api/admin/operator", auth, operator, (req, res) => {
  try { res.json(ADMIN.setOperator(req.account.id, +req.body.account, !!req.body.on)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/admin/schema", auth, operator, (req, res) =>
  res.json({ ...SCHEMA.verify(), counts: SCHEMA.counts() }));

app.get("/api/admin/health", auth, operator, (req, res) => {
  const rows = TERM.health();
  res.json({ terminals: rows,
    live: rows.filter(t => t.state === "live").length,
    gone: rows.filter(t => t.state === "gone").length,
    queued: rows.filter(t => t.queued > 0).length,
    builds: [...new Set(rows.map(t => t.build).filter(Boolean))] });
});

app.get("/api/admin/log", auth, operator, (req, res) =>
  res.json({ log: ADMIN.operatorLog() }));

app.post("/api/admin/support/open", auth, operator, (req, res) => {
  try {
    res.json(ADMIN.openSupport(req.account.id, +req.body.account,
      req.body.reason, req.body.minutes));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/admin/support/close", auth, operator, (req, res) => {
  ADMIN.closeSupport(req.account.id, +req.body.account);
  res.json({ ok: true });
});

app.get("/api/admin/account/:id", auth, operator, (req, res) => {
  try { res.json(ADMIN.accountDetail(req.account.id, +req.params.id)); }
  catch (e) { res.status(403).json({ error: e.message }); }
});

/* Whether to show the console at all. */
app.get("/api/admin/whoami", auth, (req, res) =>
  res.json({ operator: ADMIN.isOperator(req.account.id) }));

/* -------------------------- the electronic journal ------------------------
   Every sale ever taken, searchable. The sales are already written down; this
   is the screen that makes them findable when somebody disputes a charge from
   three weeks ago. */
app.get("/api/journal", auth, ownStore, (req, res) => {
  const q = req.query;
  const where = ["store_id = ?"], args = [req.store.id];

  if (q.from) { where.push("at >= ?"); args.push(String(q.from) + " 00:00:00"); }
  if (q.to) { where.push("at <= ?"); args.push(String(q.to) + " 23:59:59"); }
  if (q.cashier) { where.push("cashier = ?"); args.push(String(q.cashier)); }
  if (q.returns === "1") where.push("is_return = 1");
  if (q.amount) {
    /* An amount search should find £47.83 whether it was a sale or a refund,
       and should tolerate someone typing 47.8 from a half-remembered figure. */
    const a = Math.abs(parseFloat(q.amount));
    if (isFinite(a)) { where.push("ABS(ABS(total) - ?) < 0.005"); args.push(a); }
  }
  /* Free text runs against the stored sale, which holds the line items, the
     tender and the card's last four. */
  if (q.text) { where.push("json LIKE ?"); args.push("%" + String(q.text).slice(0, 60) + "%"); }

  const rows = db.prepare(
    "SELECT id, seq, at, cashier, total, is_return, json FROM sales WHERE " +
    where.join(" AND ") + " ORDER BY at DESC LIMIT 200").all(...args);

  const total = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM sales WHERE " +
    where.join(" AND ")).get(...args);

  res.json({
    sales: rows.map(r => { let j = {}; try { j = JSON.parse(r.json); } catch (e) {}
      return { id: r.id, seq: r.seq, at: r.at, cashier: r.cashier, total: r.total,
        ret: !!r.is_return, lines: j.lines || [], pays: j.pays || [],
        taxes: j.taxes || {}, sub: j.sub, disc: j.disc, promoOff: j.promoOff,
        reason: j.reason, against: j.against, customer: j.customer, tip: j.tip }; }),
    count: total.n, sum: +(total.s || 0).toFixed(2),
    cashiers: db.prepare(
      "SELECT DISTINCT cashier FROM sales WHERE store_id = ? AND cashier IS NOT NULL ORDER BY cashier")
      .all(req.store.id).map(r => r.cashier)
  });
});

/* ------------------------------- tank gauge ------------------------------ */
/* The console is on the store's own network, so only the server can reach it —
   the browser never talks to fuel equipment directly. */
app.get("/api/tanks", auth, ownStore, (req, res) => {
  const s = PAY.getSettings(req.store.id);
  res.json({
    gauge: { host: s.gaugeHost || "", port: s.gaugePort || 10001, every: s.gaugeEvery || 15 },
    tanks: TANKS.latest(req.store.id),
    alarms: TANKS.alarms(req.store.id),
    deliveries: TANKS.deliveries(req.store.id)
  });
});

app.put("/api/tanks", auth, ownStore, (req, res) => {
  const cur = PAY.getSettings(req.store.id);
  const host = String(req.body.host || "").trim().slice(0, 80);
  const port = Math.min(65535, Math.max(1, parseInt(req.body.port) || 10001));
  const every = Math.min(240, Math.max(0, parseInt(req.body.every) || 15));
  PAY.putSettings(req.store.id, { ...cur, gaugeHost: host || undefined, gaugePort: port, gaugeEvery: every });
  P.audit(req.account.id, "tank-gauge", host ? `${host}:${port}` : "cleared", req);
  res.json({ ok: true });
});

app.post("/api/tanks/read", auth, ownStore, async (req, res) => {
  const s = PAY.getSettings(req.store.id);
  const r = await TANKS.readSite(req.store.id, { host: s.gaugeHost, port: s.gaugePort });
  res.json(r);
});

app.post("/api/tanks/probe", auth, ownStore, async (req, res) => {
  const host = String(req.body.host || "").trim();
  if (!host) return res.status(400).json({ error: "No address given" });
  res.json(await TANKS.probe(host, parseInt(req.body.port) || 10001));
});

/* A reading taken through the station agent's serial cable rather than over the
   network. The agent hands over raw console text; parsing and storing stays
   here so both routes end up in the same place. */
app.post("/api/tanks/ingest", auth, ownStore, (req, res) => {
  const raw = String(req.body.raw || "");
  if (!raw.trim()) return res.status(400).json({ error: "Nothing came back from the console." });
  const parsed = TANKS.parseInTank(raw);
  if (!parsed.tanks.length)
    return res.status(422).json({ error: "The console answered but no tanks could be read.",
      raw: raw.slice(0, 900) });

  const stmt = db.prepare(
    "INSERT INTO tank_readings (store_id,tank,product,volume,tc_volume,ullage,height,water,temp,raw) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?)");
  parsed.tanks.forEach(t => stmt.run(req.store.id, t.tank, t.product, t.volume, t.tc_volume,
    t.ullage, t.height, t.water, t.temp, t.raw));

  const seen = new Set();
  (parsed.alarms || []).forEach(a => {
    seen.add(`${a.tank}|${a.text}`);
    db.prepare("INSERT INTO tank_alarms (store_id,tank,text) VALUES (?,?,?) " +
      "ON CONFLICT(store_id,tank,text) DO UPDATE SET last_at=datetime('now'),cleared=0")
      .run(req.store.id, a.tank, a.text);
  });
  db.prepare("SELECT id,tank,text FROM tank_alarms WHERE store_id = ? AND cleared = 0")
    .all(req.store.id).forEach(r => {
      if (!seen.has(`${r.tank}|${r.text}`))
        db.prepare("UPDATE tank_alarms SET cleared = 1 WHERE id = ?").run(r.id);
    });

  P.audit(req.account.id, "tank-reading",
    `${parsed.tanks.length} tanks via ${req.body.source || "serial"}`, req);
  res.json({ ok: true, tanks: parsed.tanks.length, alarms: (parsed.alarms || []).length,
    format: parsed.format });
});

app.get("/api/tanks/history", auth, ownStore, (req, res) => {
  res.json({ points: TANKS.history(req.store.id, parseInt(req.query.tank) || 1,
    parseInt(req.query.hours) || 48) });
});

/* ------------------------------- retention ------------------------------- */
/* How long this store's trading records are kept, and what happens before they
   go. Setup and pricebook are never touched by any of it. */
app.get("/api/retention", auth, ownStore, (req, res) => {
  const settings = PAY.getSettings(req.store.id);
  res.json({
    policy: RET.getPolicy(settings),
    preview: RET.preview(req.store.id, settings),
    history: RET.history(req.store.id)
  });
});

app.put("/api/retention", auth, ownStore, (req, res) => {
  const cur = PAY.getSettings(req.store.id);
  const b = req.body || {};
  const mode = b.mode === "wipe" ? "wipe" : "keep";
  const days = Math.min(3650, Math.max(1, parseInt(b.days) || 90));
  const email = String(b.email || "").trim().slice(0, 160);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return res.status(400).json({ error: "That doesn't look like an email address." });
  const retention = { mode, days, email, exportFirst: b.exportFirst !== false };
  PAY.putSettings(req.store.id, { ...cur, retention });
  P.audit(req.account.id, "retention",
    mode === "wipe" ? `wipe after ${days} days` : "keep everything", req);
  res.json({ ok: true, policy: retention, preview: RET.preview(req.store.id, { retention }) });
});

/* Run it now rather than waiting for the timer. Deliberately explicit — this
   destroys records, so it should never happen as a side effect of something else. */
app.post("/api/retention/run", auth, ownStore, async (req, res) => {
  if (req.body.confirm !== "WIPE")
    return res.status(400).json({ error: "Confirmation missing." });
  const r = await RET.sweepStore(req.store.id, PAY.getSettings(req.store.id),
    m => P.audit(req.account.id, "wipe", m, req));
  res.json(r);
});

app.get("/api/retention/export/:name", auth, ownStore, (req, res) => {
  const p = RET.exportPath(req.params.name);
  if (!p || !p.startsWith(RET.EXPORT_DIR)) return res.status(400).json({ error: "Bad file" });
  /* The filename is prefixed with the store id; anything else belongs to
     somebody else and is not this account's to read. */
  if (!req.params.name.startsWith(req.store.id + "-"))
    return res.status(404).json({ error: "Not found" });
  res.download(p, `records-${req.params.name}`, err => {
    if (err && !res.headersSent) res.status(404).json({ error: "That export has been cleared." });
  });
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

/* Retention runs on boot and every six hours after. A store that sets a 7-day
   window and closes the laptop still gets its wipe when it next comes up. */
/* Every store with a gauge address gets read on a timer. A site that's offline
   is logged and skipped rather than holding up the rest. */
const pollGauges = async () => {
  const stores = db.prepare("SELECT id FROM stores").all();
  for (const st of stores) {
    const s = PAY.getSettings(st.id);
    if (!s.gaugeHost || s.gaugeEvery === 0) continue;
    try {
      const r = await TANKS.readSite(st.id, { host: s.gaugeHost, port: s.gaugePort });
      if (r.error) console.log(`  \u00b7 gauge ${st.id}: ${r.error}`);
    } catch (e) { console.log(`  \u00b7 gauge ${st.id} failed: ${e.message}`); }
  }
};

const runSweep = async () => {
  try {
    const out = await RET.sweepAll(id => PAY.getSettings(id),
      (id, m) => P.audit(null, "wipe-auto", `store ${id}: ${m}`, null));
    out.forEach(r => console.log("  \u00b7 retention:", JSON.stringify(r)));
  } catch (e) { console.error("  \u00b7 retention failed:", e.message); }
};

app.listen(PORT, () => {
  console.log(`AI POS listening on :${PORT}`);
  /* Silence used to be ambiguous: a variable that was never set and one that
     was set wrongly both produced no output, which is no help at 9pm. Say which
     control variables are present, never their values. */
  const seen = ["OPERATOR_EMAIL","OPERATOR_PASSWORD","ADMIN_RESET","DATA_DIR","NODE_ENV",
    "MAIL_PROVIDER","MAIL_KEY","MAIL_FROM","MAIL_DOMAIN","PUBLIC_URL"]
    .filter(k => String(process.env[k] || "").trim());
  console.log(`  environment: ${seen.length ? seen.join(", ") : "none of the control variables are set"}`);

  /* Every module has created its own tables by now, so this is the moment to
     ask the database whether the code's assumptions actually hold. Both of the
     worst bugs in this codebase were schema mismatches that failed at query
     time — this turns that into a line at startup. */
  try {
    SCHEMA.migrate(console.log);
    const v = SCHEMA.check(console.log);
    if (!v.ok) console.log("  the server will still start; the affected screens will error");
  } catch (e) {
    console.log("  MIGRATION FAILED — " + e.message);
    console.log("  the database is unchanged past the last successful migration");
  }

  ADMIN.seedOperator(bcrypt);
  resetOnBoot();

  const ops = db.prepare("SELECT email FROM accounts WHERE is_operator = 1").all();
  const mailWhy = MAIL.whyNot();
  console.log(`  mail: ${mailWhy || "ready via " + process.env.MAIL_PROVIDER}`);
  console.log(`  operators: ${ops.length ? ops.map(o => o.email).join(", ") : "none"}`);
  setTimeout(runSweep, 5000);
  setTimeout(pollGauges, 9000);
  setInterval(pollGauges, 15 * 60 * 1000);
  setInterval(runSweep, 6 * 60 * 60 * 1000);
  if (!KEY) console.warn("  ! ANTHROPIC_API_KEY is not set — AI features will return 503.");
});
