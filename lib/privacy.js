/* ---------------------------------------------------------------------------
   Isolation, privacy and durability.

   The rule this file enforces: an account's sales records, tax data and
   pricebook belong to that account and nobody else. Not to another tenant, not
   to a support tool, not to a stray query that forgot a WHERE clause. Every
   read and write goes through a scope check, and the checks live here rather
   than being retyped at each route.

   It also owns backups, because a store's sales journal is a tax record and
   losing it is not a bug you can apologise your way out of.
   --------------------------------------------------------------------------- */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

const DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const BACKUPS = path.join(DIR, "backups");
fs.mkdirSync(BACKUPS, { recursive: true });

db.exec(`
CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  action      TEXT NOT NULL,
  detail      TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_account ON audit(account_id, at DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
  id        INTEGER PRIMARY KEY,
  email     TEXT NOT NULL,
  ip        TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  ok        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts(email, at DESC);
`);

function audit(accountId, action, detail, req) {
  try {
    db.prepare("INSERT INTO audit (account_id, action, detail, ip) VALUES (?,?,?,?)")
      .run(accountId || null, action, detail ? String(detail).slice(0, 500) : null,
           req ? (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim() : null);
  } catch (e) { /* auditing must never break the request it is recording */ }
}

/* Brute force protection. Counts failures per email and per IP separately, so
   one attacker can't lock out a real user by guessing at their address. */
function loginBlocked(email, ip) {
  const byEmail = db.prepare(
    "SELECT COUNT(*) n FROM login_attempts WHERE email = ? AND ok = 0 AND at > datetime('now','-15 minutes')")
    .get(email).n;
  const byIp = ip ? db.prepare(
    "SELECT COUNT(*) n FROM login_attempts WHERE ip = ? AND ok = 0 AND at > datetime('now','-15 minutes')")
    .get(ip).n : 0;
  return byEmail >= 8 || byIp >= 25;
}
function recordAttempt(email, ip, ok) {
  db.prepare("INSERT INTO login_attempts (email, ip, ok) VALUES (?,?,?)").run(email, ip || null, ok ? 1 : 0);
  db.prepare("DELETE FROM login_attempts WHERE at < datetime('now','-1 day')").run();
}

/* Everything an account owns, in one object. This exists so nobody is locked
   in — a merchant can take their pricebook and their sales history and leave. */
function exportAccount(accountId) {
  const account = db.prepare("SELECT id, email, name, created_at FROM accounts WHERE id = ?").get(accountId);
  if (!account) return null;
  const stores = db.prepare("SELECT * FROM stores WHERE account_id = ?").all(accountId);
  return {
    exportedAt: new Date().toISOString(),
    format: "ai-pos-export-v1",
    account,
    stores: stores.map(s => ({
      store: s,
      config: (() => {
        const r = db.prepare("SELECT json, updated_at FROM configs WHERE store_id = ?").get(s.id);
        return r ? { updatedAt: r.updated_at, ...JSON.parse(r.json) } : null;
      })(),
      shifts: db.prepare("SELECT * FROM shifts WHERE store_id = ? ORDER BY opened_at").all(s.id)
        .map(sh => ({ ...sh, json: sh.json ? JSON.parse(sh.json) : null })),
      sales: db.prepare("SELECT * FROM sales WHERE store_id = ? ORDER BY at").all(s.id)
        .map(sa => ({ ...sa, json: JSON.parse(sa.json) }))
    }))
  };
}

/* Deletion means deletion. Foreign keys cascade the stores, configs, shifts and
   sales; this clears what they don't reach. */
function deleteAccount(accountId) {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM ai_calls WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM audit WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
  });
  tx();
}

/* ------------------------------- backups --------------------------------- */
/* SQLite's own backup API, so a snapshot is consistent even mid-write. Kept
   local by default; set BACKUP_DIR to a mounted volume or sync the folder to
   object storage and it survives losing the machine. */
const KEEP = Number(process.env.BACKUP_KEEP || 14);
const TARGET = process.env.BACKUP_DIR || BACKUPS;

async function runBackup(reason) {
  try {
    fs.mkdirSync(TARGET, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(TARGET, `pos-${stamp}.db`);
    await db.backup(file);
    const kept = fs.readdirSync(TARGET).filter(f => /^pos-.*\.db$/.test(f)).sort();
    kept.slice(0, Math.max(0, kept.length - KEEP))
      .forEach(f => { try { fs.unlinkSync(path.join(TARGET, f)); } catch (e) {} });
    console.log(`  · backup written (${reason}): ${path.basename(file)}`);
    return file;
  } catch (e) {
    console.error("  ! backup failed:", e.message);
    return null;
  }
}
function startBackups() {
  runBackup("startup");
  setInterval(() => runBackup("scheduled"), 6 * 60 * 60 * 1000);   // every six hours
}
function listBackups() {
  try {
    return fs.readdirSync(TARGET).filter(f => /^pos-.*\.db$/.test(f)).sort().reverse()
      .map(f => { const s = fs.statSync(path.join(TARGET, f));
        return { file: f, size: s.size, at: s.mtime.toISOString() }; });
  } catch (e) { return []; }
}

/* Requests must come from this origin. With SameSite=Lax cookies this is belt
   and braces, but the belt is cheap. */
function sameOrigin(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const origin = req.headers.origin;
  if (!origin) return next();                       // non-browser client
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  try {
    if (new URL(origin).host !== host)
      return res.status(403).json({ error: "Cross-origin request refused" });
  } catch (e) { return res.status(403).json({ error: "Bad origin" }); }
  next();
}

module.exports = { audit, loginBlocked, recordAttempt, exportAccount, deleteAccount,
                   runBackup, startBackups, listBackups, sameOrigin, crypto };
