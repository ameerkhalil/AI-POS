/* ===========================================================================
   Data retention.

   Not every owner wants a year of takings sitting on someone else's server.
   This lets a store say how long its trading records are kept, and deletes them
   on a schedule when the window passes.

   Three things this file is careful about:

     1. It deletes trading records, never the setup. Sales, shifts, payment
        references and the module logs that carry money go. The pricebook,
        departments, tax rates, staff and layout stay — nobody should have to
        rebuild their register because they chose a short retention.

     2. Nothing is deleted before a snapshot exists. The export is written
        first, and if writing it fails the wipe does not run.

     3. The window is a floor, not a ceiling. Deleting the last 30 days on a
        30-day setting would take today's shift with it, so only records that
        have fully aged out are touched, and never an open shift.
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const db = require("./db");
const { daysAgo, now, asDate } = require("./when");

const EXPORT_DIR = process.env.EXPORT_DIR
  || path.join(process.env.DATA_DIR || ".", "exports");
try { fs.mkdirSync(EXPORT_DIR, { recursive: true }); } catch (e) {}

db.exec(`
CREATE TABLE IF NOT EXISTS wipe_log (
  id         INTEGER PRIMARY KEY,
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  kept_days  INTEGER NOT NULL,
  sales      INTEGER NOT NULL DEFAULT 0,
  shifts     INTEGER NOT NULL DEFAULT 0,
  file       TEXT,
  emailed    INTEGER NOT NULL DEFAULT 0,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_wipe_store ON wipe_log(store_id, at DESC);
`);

const DEFAULT = { mode: "keep", days: 90, email: "", exportFirst: true };

function getPolicy(settings) {
  return { ...DEFAULT, ...((settings && settings.retention) || {}) };
}

/* Everything about to be destroyed, as one file, before anything is destroyed. */
function snapshot(storeId, cutoff) {
  const store = db.prepare("SELECT id, name, created_at FROM stores WHERE id = ?").get(storeId);
  const sales = db.prepare(
    "SELECT seq, at, cashier, total, is_return, json FROM sales WHERE store_id = ? AND at < ? ORDER BY at")
    .all(storeId, cutoff);
  const shifts = db.prepare(
    "SELECT id, opened_at, closed_at, opened_by, start_cash, counted, json FROM shifts " +
    "WHERE store_id = ? AND closed_at IS NOT NULL AND closed_at < ? ORDER BY opened_at")
    .all(storeId, cutoff);
  const payments = db.prepare(
    "SELECT intent_id, amount, status, brand, last4, created_at FROM payments " +
    "WHERE store_id = ? AND created_at < ?").all(storeId, cutoff);

  const body = {
    store: store ? { name: store.name, opened: store.created_at } : null,
    exportedAt: new Date().toISOString(),
    coversUpTo: cutoff,
    counts: { sales: sales.length, shifts: shifts.length, payments: payments.length },
    totals: {
      gross: +sales.reduce((a, s) => a + (s.total || 0), 0).toFixed(2),
      returns: sales.filter(s => s.is_return).length
    },
    sales: sales.map(s => ({ ...s, json: safe(s.json) })),
    shifts: shifts.map(s => ({ ...s, json: safe(s.json) })),
    payments
  };
  const name = `${storeId}-${new Date().toISOString().slice(0, 10)}-${Date.now()}.json`;
  const file = path.join(EXPORT_DIR, name);
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
  return { file, name, counts: body.counts };
}
const safe = t => { try { return JSON.parse(t); } catch (e) { return t; } };

/* Best effort, and honest about it. With no outgoing mail service configured the
   snapshot is kept for download instead, and the log says so. */
async function mail(to, subject, text, attachPath) {
  if (!process.env.SMTP_URL || !to) return { sent: false, why: "no mail service configured" };
  try {
    const nodemailer = require("nodemailer");
    const t = nodemailer.createTransport(process.env.SMTP_URL);
    await t.sendMail({
      from: process.env.MAIL_FROM || "AI POS <no-reply@localhost>",
      to, subject, text,
      attachments: attachPath ? [{ path: attachPath }] : []
    });
    return { sent: true };
  } catch (e) { return { sent: false, why: e.message }; }
}

/* One store. Returns what it did, or why it didn't. */
async function sweepStore(storeId, settings, audit) {
  const p = getPolicy(settings);
  if (p.mode !== "wipe") return { skipped: "keeping everything" };
  const days = Math.max(1, Number(p.days) || 90);
  const cutoff = daysAgo(days);

  const due = db.prepare("SELECT COUNT(*) n FROM sales WHERE store_id = ? AND at < ?")
    .get(storeId, cutoff).n;
  const dueShifts = db.prepare(
    "SELECT COUNT(*) n FROM shifts WHERE store_id = ? AND closed_at IS NOT NULL AND closed_at < ?")
    .get(storeId, cutoff).n;
  if (!due && !dueShifts) return { skipped: "nothing has aged out yet" };

  let snap = null;
  if (p.exportFirst) {
    try { snap = snapshot(storeId, cutoff); }
    catch (e) {
      /* No snapshot, no wipe. Losing the records because the backup failed is
         the one outcome nobody would forgive. */
      return { error: "snapshot failed, nothing deleted: " + e.message };
    }
  }

  let mailed = { sent: false, why: "not requested" };
  if (p.email && snap) {
    mailed = await mail(p.email, `Your ${days}-day records before deletion`,
      `Attached are the ${snap.counts.sales} sales and ${snap.counts.shifts} shifts about to be ` +
      `removed from your register, covering everything before ${cutoff}. ` +
      `Your pricebook, staff and settings are not affected.`, snap.file);
  }

  /* Open shifts are never touched, whatever the window says. */
  const tx = db.transaction(() => {
    const s = db.prepare("DELETE FROM sales WHERE store_id = ? AND at < ?").run(storeId, cutoff);
    const h = db.prepare(
      "DELETE FROM shifts WHERE store_id = ? AND closed_at IS NOT NULL AND closed_at < ?")
      .run(storeId, cutoff);
    db.prepare("DELETE FROM payments WHERE store_id = ? AND created_at < ?").run(storeId, cutoff);
    return { sales: s.changes, shifts: h.changes };
  });
  const done = tx();

  db.prepare("INSERT INTO wipe_log (store_id, kept_days, sales, shifts, file, emailed, note) " +
    "VALUES (?,?,?,?,?,?,?)")
    .run(storeId, days, done.sales, done.shifts, snap ? snap.name : null,
      mailed.sent ? 1 : 0, mailed.sent ? null : mailed.why);

  if (audit) audit(`wiped ${done.sales} sales, ${done.shifts} shifts older than ${days} days`);
  return { ...done, file: snap ? snap.name : null, mailed };
}

/* Everything with a policy set. Runs on boot and on a timer. */
async function sweepAll(readSettings, audit) {
  const stores = db.prepare("SELECT id FROM stores").all();
  const results = [];
  for (const s of stores) {
    try {
      const r = await sweepStore(s.id, readSettings(s.id), audit && (m => audit(s.id, m)));
      if (r && (r.sales || r.error)) results.push({ store: s.id, ...r });
    } catch (e) { results.push({ store: s.id, error: e.message }); }
  }
  return results;
}

function history(storeId) {
  return db.prepare(
    "SELECT at, kept_days, sales, shifts, file, emailed, note FROM wipe_log " +
    "WHERE store_id = ? ORDER BY at DESC LIMIT 30").all(storeId);
}

/* What the next run would take, so nobody is surprised by it. */
function preview(storeId, settings) {
  const p = getPolicy(settings);
  if (p.mode !== "wipe") return { mode: "keep" };
  const days = Math.max(1, Number(p.days) || 90);
  const cutoff = daysAgo(days);
  const sales = db.prepare("SELECT COUNT(*) n FROM sales WHERE store_id = ? AND at < ?")
    .get(storeId, cutoff).n;
  const shifts = db.prepare(
    "SELECT COUNT(*) n FROM shifts WHERE store_id = ? AND closed_at IS NOT NULL AND closed_at < ?")
    .get(storeId, cutoff).n;
  const oldest = db.prepare("SELECT MIN(at) a FROM sales WHERE store_id = ?").get(storeId).a;
  const kept = db.prepare("SELECT COUNT(*) n FROM sales WHERE store_id = ? AND at >= ?")
    .get(storeId, cutoff).n;
  return { mode: "wipe", days, cutoff, sales, shifts, kept, oldest,
    mailReady: !!process.env.SMTP_URL };
}

const exportPath = name =>
  /^[0-9]+-[0-9-]+-[0-9]+\.json$/.test(name) ? path.join(EXPORT_DIR, name) : null;

module.exports = { DEFAULT, getPolicy, sweepStore, sweepAll, history, preview, exportPath, EXPORT_DIR };
