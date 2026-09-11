/* ===========================================================================
   Errors.

   Nothing here is monitored. A till throws at 2am, the cashier restarts the
   browser, and nobody ever knows — until the same thing happens on nineteen
   other sites and somebody phones.

   The design:

   - Errors are GROUPED, not listed. One broken thing on a busy forecourt
     produces four hundred rows, and a screen showing four hundred rows is a
     screen nobody reads. Same message and place means one row, with a count.

   - The message is scrubbed before it's stored. A stack trace can carry a card
     number, an email, a token — captured while chasing a bug and kept forever.
     That's a worse problem than the bug.

   - Rate limited per terminal. A render loop throwing every frame must not be
     able to fill the disk or the network.

   - Nothing here can break the thing it's watching. Every path swallows its own
     failure, because an error reporter that throws is worse than none.
   =========================================================================== */
const db = require("./db");
const { stamp, daysAgo } = require("./when");

db.exec(`
CREATE TABLE IF NOT EXISTS error_groups (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER,
  store_id   INTEGER,
  fingerprint TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,          -- client | server | promise | network
  message    TEXT NOT NULL,
  where_     TEXT,
  first_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_at    TEXT NOT NULL DEFAULT (datetime('now')),
  count      INTEGER NOT NULL DEFAULT 1,
  terminals  TEXT,                   -- JSON array of terminal ids seen
  builds     TEXT,                   -- JSON array of builds seen
  resolved   INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_eg_last ON error_groups(resolved, last_at DESC);
CREATE INDEX IF NOT EXISTS idx_eg_store ON error_groups(store_id, last_at DESC);

/* A few recent examples per group, for the detail nobody needs until they do. */
CREATE TABLE IF NOT EXISTS error_events (
  id        INTEGER PRIMARY KEY,
  group_id  INTEGER NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  store_id  INTEGER,
  terminal  INTEGER,
  build     TEXT,
  detail    TEXT
);
CREATE INDEX IF NOT EXISTS idx_ee_group ON error_events(group_id, at DESC);
`);

const KEEP_EVENTS = 20;      /* per group */

/* ------------------------------- scrubbing --------------------------------
   Applied before anything is written. A stack trace is exactly where a card
   number ends up, and an error log is the last place anybody looks for one. */
const SCRUBS = [
  /* card numbers, with or without spacing */
  [/\b(?:\d[ -]?){13,19}\b/g, "[card]"],
  [/\b\d{3,4}\b(?=\s*(?:cvv|cvc|security))/gi, "[cvv]"],
  /* keys and tokens */
  [/\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{6,}/g, "[key]"],
  [/\bBearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer [token]"],
  [/\b[A-Fa-f0-9]{32,}\b/g, "[hex]"],
  /* people */
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\b\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}\b/g, "[phone]"],
  /* a driver's licence record, which the age check reads */
  [/ANSI\s?\d{6}[\s\S]{0,400}/g, "[licence data]"]
];

function scrub(s) {
  let out = String(s == null ? "" : s).slice(0, 4000);
  SCRUBS.forEach(([re, with_]) => { out = out.replace(re, with_); });
  return out;
}

/* ----------------------------- fingerprinting -----------------------------
   Two occurrences of the same fault must land in the same group, so anything
   that varies between them is stripped: line numbers, ids, times, quantities. */
function fingerprint(kind, message, where) {
  const norm = String(message || "")
    .replace(/\d+/g, "#")
    /* Quoted text is collapsed only when it looks like a value that varies —
       an id, a code, something long. A short word in quotes is usually the
       property that broke ("reading 'price'"), and merging that with
       "reading 'name'" hides two different faults behind one row. */
    .replace(/['"]([^'"]{0,80})['"]/g, (m, inner) =>
      (/[#\d]/.test(inner) || inner.length > 12) ? "'…'" : m)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
    .toLowerCase();
  const place = String(where || "").replace(/:\d+:\d+/g, "").slice(0, 120);
  return `${kind}|${place}|${norm}`;
}

/* ----------------------------- rate limiting ------------------------------
   Per terminal, in memory. A render loop throwing sixty times a second must
   not be able to fill anything. */
const seen = new Map();
const LIMIT = 30, WINDOW = 60000;

function allowed(key) {
  const now = Date.now();
  const e = seen.get(key);
  if (!e || now - e.start > WINDOW) { seen.set(key, { start: now, n: 1 }); return true; }
  e.n++;
  if (e.n === LIMIT + 1) return "last";     /* record one line saying it stopped */
  return e.n <= LIMIT;
}
setInterval(() => {
  const cutoff = Date.now() - WINDOW * 2;
  seen.forEach((v, k) => { if (v.start < cutoff) seen.delete(k); });
}, WINDOW).unref?.();

/* -------------------------------- recording ------------------------------- */

function record(input) {
  /* Called from a catch block, sometimes with whatever was thrown. It has to
     survive being handed nothing at all. */
  const { kind, message, where, detail, storeId, accountId, terminal, build } = input || {};
  try {
    if (!message) return { ok: false };
    const k = String(kind || "client");
    const msg = scrub(message);
    const place = scrub(where || "");
    const fp = fingerprint(k, msg, place);

    const gate = allowed(`${terminal || storeId || 0}`);
    if (gate === false) return { ok: true, throttled: true };

    const existing = db.prepare("SELECT * FROM error_groups WHERE fingerprint = ?").get(fp);
    let id;

    if (existing) {
      const terms = merge(existing.terminals, terminal);
      const builds = merge(existing.builds, build);
      db.prepare("UPDATE error_groups SET last_at = datetime('now'), count = count + 1, " +
        "terminals = ?, builds = ?, resolved = 0 WHERE id = ?")
        .run(terms, builds, existing.id);
      id = existing.id;
    } else {
      const r = db.prepare(
        "INSERT INTO error_groups (account_id, store_id, fingerprint, kind, message, where_, " +
        "terminals, builds) VALUES (?,?,?,?,?,?,?,?)")
        .run(accountId || null, storeId || null, fp, k, msg, place,
          merge(null, terminal), merge(null, build));
      id = r.lastInsertRowid;
    }

    db.prepare("INSERT INTO error_events (group_id, store_id, terminal, build, detail) " +
      "VALUES (?,?,?,?,?)")
      .run(id, storeId || null, terminal || null, build || null,
        scrub(gate === "last"
          ? "(further occurrences from this terminal suppressed for a minute) " + (detail || "")
          : detail || ""));

    /* Keep a handful of examples, not a history. */
    db.prepare(
      "DELETE FROM error_events WHERE group_id = ? AND id NOT IN " +
      "(SELECT id FROM error_events WHERE group_id = ? ORDER BY at DESC, id DESC LIMIT ?)")
      .run(id, id, KEEP_EVENTS);

    return { ok: true, group: id };
  } catch (e) {
    /* An error reporter that throws is worse than none at all. */
    return { ok: false };
  }
}

function merge(json, value) {
  if (value == null || value === "") return json;
  let list = [];
  try { list = JSON.parse(json || "[]"); } catch (e) {}
  const v = String(value);
  if (!list.includes(v)) list.push(v);
  return JSON.stringify(list.slice(-12));
}

/* Wrap a server route so a throw is recorded rather than only logged. */
function watch(fn, context) {
  return (req, res, next) => {
    try {
      const out = fn(req, res, next);
      if (out && typeof out.catch === "function")
        out.catch(e => { fromServer(e, req, context); throw e; });
      return out;
    } catch (e) { fromServer(e, req, context); throw e; }
  };
}

const fromServer = (e, req, context) => record({
  kind: "server",
  message: e && e.message ? e.message : String(e),
  where: context || (req && req.path) || "",
  detail: e && e.stack ? e.stack : "",
  storeId: req && req.store ? req.store.id : null,
  accountId: req && req.account ? req.account.id : null
});

/* --------------------------------- reading -------------------------------- */

function groups({ days, includeResolved, storeId } = {}) {
  const since = daysAgo(Math.min(90, Math.max(1, days || 14)));
  const where = ["last_at > ?"], args = [since];
  if (!includeResolved) where.push("resolved = 0");
  if (storeId) { where.push("store_id = ?"); args.push(storeId); }
  return db.prepare(
    "SELECT * FROM error_groups WHERE " + where.join(" AND ") +
    " ORDER BY last_at DESC LIMIT 200").all(...args)
    .map(g => ({ ...g,
      terminals: safe(g.terminals), builds: safe(g.builds),
      resolved: !!g.resolved }));
}

const safe = j => { try { return JSON.parse(j || "[]"); } catch (e) { return []; } };

const detail = id => ({
  group: db.prepare("SELECT * FROM error_groups WHERE id = ?").get(id),
  events: db.prepare("SELECT * FROM error_events WHERE group_id = ? ORDER BY at DESC LIMIT ?")
    .all(id, KEEP_EVENTS)
});

const resolve = (id, on, note) =>
  db.prepare("UPDATE error_groups SET resolved = ?, resolved_at = ?, note = COALESCE(?, note) " +
    "WHERE id = ?")
    .run(on ? 1 : 0, on ? stamp(new Date()) : null, note || null, id);

/* The number worth showing on a dashboard: what's new, what's loud, what's
   spread across sites. */
function summary(days) {
  const since = daysAgo(Math.min(90, Math.max(1, days || 7)));
  const rows = db.prepare(
    "SELECT * FROM error_groups WHERE last_at > ? AND resolved = 0").all(since);

  const byStore = {};
  rows.forEach(g => {
    if (!g.store_id) return;
    byStore[g.store_id] = (byStore[g.store_id] || 0) + g.count;
  });

  return {
    groups: rows.length,
    events: rows.reduce((a, g) => a + g.count, 0),
    /* A fault appearing on many sites is a bad release; one on a single site is
       usually that shop's hardware. Worth telling apart. */
    /* More than one till means it isn't that shop's hardware. That's the line
       worth drawing — waiting for three loses a bad release for a day. */
    widespread: rows.filter(g => safe(g.terminals).length > 1).length,
    newToday: rows.filter(g => String(g.first_at).slice(0, 10)
      === new Date().toISOString().slice(0, 10)).length,
    loudest: rows.sort((a, b) => b.count - a.count).slice(0, 5)
      .map(g => ({ id: g.id, message: g.message, count: g.count })),
    byStore
  };
}

/* Old and settled goes away on its own. */
function sweep(days) {
  const cutoff = daysAgo(Math.min(365, Math.max(7, days || 90)));
  const r = db.prepare("DELETE FROM error_groups WHERE last_at < ? AND resolved = 1")
    .run(cutoff);
  return r.changes;
}

module.exports = { record, watch, fromServer, groups, detail, resolve, summary, sweep,
  scrub, fingerprint };
