/* ===========================================================================
   The operator console.

   Running a product across other people's businesses needs oversight — which
   sites are live, what's failing, who's stuck in setup. It does not need to
   read everybody's takings.

   So this splits in two:

     Fleet          counts, versions, health, activity. Always visible. Nothing
                    here identifies a product, a customer or a transaction.

     Support mode   one account, opened deliberately, time-limited, and written
                    into that account's own activity log where they can see it.

   The second tier exists because support is impossible without it — somebody
   will call and say "my totals are wrong" and you'll need to look. What it
   doesn't do is make that the default, or silent.
   =========================================================================== */
const db = require("./db");

db.exec(`
ALTER TABLE accounts ADD COLUMN is_operator INTEGER NOT NULL DEFAULT 0;
`.trim().replace(/^/, "-- "));   // no-op: applied conditionally below

/* better-sqlite3 has no IF NOT EXISTS for columns, so ask before adding. */
function ensureColumn(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
ensureColumn("accounts", "is_operator", "INTEGER NOT NULL DEFAULT 0");

db.exec(`
CREATE TABLE IF NOT EXISTS support_grants (
  id          INTEGER PRIMARY KEY,
  operator_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  opened_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  closed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_grant_acct ON support_grants(account_id, expires_at);

CREATE TABLE IF NOT EXISTS operator_log (
  id          INTEGER PRIMARY KEY,
  operator_id INTEGER NOT NULL,
  account_id  INTEGER,
  action      TEXT NOT NULL,
  detail      TEXT,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* An operator is marked in the database, not inferred from an email at request
   time — so revoking it is a row change rather than a redeploy. The environment
   only seeds the first one, and creates the account if it doesn't exist yet:
   whoever runs the service needs a way in before anybody has signed up.

   An operator account owns no store. It isn't a merchant. */
function seedOperator(bcrypt) {
  const email = String(process.env.OPERATOR_EMAIL || "").trim().toLowerCase();
  if (!email) return;

  let a = db.prepare("SELECT id, is_operator FROM accounts WHERE lower(email) = ?").get(email);

  if (!a) {
    const pass = String(process.env.OPERATOR_PASSWORD || "");
    if (pass.length < 8)
      return console.log(`  operator ${email} not created — set OPERATOR_PASSWORD (8+ characters)`);
    const r = db.prepare("INSERT INTO accounts (email, pass_hash) VALUES (?,?)")
      .run(email, bcrypt.hashSync(pass, 10));
    a = { id: r.lastInsertRowid, is_operator: 0 };
    console.log(`  operator account created: ${email}`);
  }

  if (!a.is_operator) {
    db.prepare("UPDATE accounts SET is_operator = 1 WHERE id = ?").run(a.id);
    console.log(`  operator: ${email}`);
  }
}

const isOperator = id =>
  !!db.prepare("SELECT is_operator FROM accounts WHERE id = ?").get(id)?.is_operator;

function log(operatorId, accountId, action, detail) {
  db.prepare("INSERT INTO operator_log (operator_id, account_id, action, detail) VALUES (?,?,?,?)")
    .run(operatorId, accountId || null, action, detail || null);
}

/* ------------------------------- tier one -------------------------------
   Shape and health. No product names, no customers, no transaction contents. */
/* Logged here rather than in the route, so any caller is recorded — a log that
   only catches one path is a log you can't rely on. */
function fleet(operatorId) {
  if (operatorId) log(operatorId, null, "fleet-view", null);

  const accounts = db.prepare(`
    SELECT a.id, a.email, a.created_at, a.is_operator,
           COUNT(DISTINCT s.id) AS stores
    FROM accounts a LEFT JOIN stores s ON s.account_id = a.id
    GROUP BY a.id ORDER BY a.created_at DESC`).all();

  /* A store's configuration lives in its own table, not a column on stores —
     which is what made every one of these queries fail. */
  const stores = db.prepare(`
    SELECT s.id, s.account_id, s.name, s.created_at,
           c.updated_at AS last_change,
           (c.json IS NOT NULL AND length(c.json) > 40) AS configured,
           (SELECT COUNT(*) FROM sales x WHERE x.store_id = s.id) AS sales,
           (SELECT MAX(at) FROM sales x WHERE x.store_id = s.id) AS last_sale,
           (SELECT COUNT(*) FROM sales x WHERE x.store_id = s.id
              AND x.at > datetime('now','-7 days')) AS sales_7d
    FROM stores s LEFT JOIN configs c ON c.store_id = s.id
    ORDER BY s.id DESC`).all();

  /* Shape only: the trade, the register, which modules are on, and how many of
     things there are. Never what any of them are called. */
  const rows = db.prepare("SELECT store_id, json FROM configs").all();
  const shape = rows.map(r => {
    let cfg = {};
    try { cfg = JSON.parse(r.json || "{}"); } catch (e) {}
    const mods = cfg.modules || {};
    return {
      id: r.store_id,
      trade: cfg.trade || cfg.site?.trade || cfg.type || null,
      layout: cfg.layout || null,
      modules: Object.keys(mods).filter(k => mods[k]),
      depts: (cfg.depts || []).length,
      products: (cfg.plus || []).length,
      staff: (cfg.employees || []).length
    };
  });

  const totals = db.prepare(`
    SELECT (SELECT COUNT(*) FROM accounts) AS accounts,
           (SELECT COUNT(*) FROM stores) AS stores,
           (SELECT COUNT(*) FROM sales) AS sales,
           (SELECT COUNT(*) FROM sales WHERE at > datetime('now','-1 day')) AS sales_24h,
           (SELECT COUNT(*) FROM sales WHERE at > datetime('now','-7 days')) AS sales_7d`).get();

  return { totals, accounts, stores: stores.map(s => ({ ...s, configured: !!s.configured })), shape };
}

/* Sign-ups and sale volume by day, for seeing whether the thing is growing. */
function trend(days) {
  const n = Math.min(90, Math.max(7, days || 30));
  return {
    sales: db.prepare(
      "SELECT date(at) d, COUNT(*) n FROM sales WHERE at > datetime('now', ?) " +
      "GROUP BY date(at) ORDER BY d").all(`-${n} days`),
    signups: db.prepare(
      "SELECT date(created_at) d, COUNT(*) n FROM accounts WHERE created_at > datetime('now', ?) " +
      "GROUP BY date(created_at) ORDER BY d").all(`-${n} days`)
  };
}

/* Stores that look stuck or abandoned — the ones worth a phone call. */
function attention() {
  return {
    neverConfigured: db.prepare(`
      SELECT s.id, s.name, s.created_at, a.email
      FROM stores s JOIN accounts a ON a.id = s.account_id
      LEFT JOIN configs c ON c.store_id = s.id
      WHERE (c.json IS NULL OR length(c.json) < 40)
        AND s.created_at < datetime('now','-2 days')
      ORDER BY s.created_at DESC LIMIT 40`).all(),
    wentQuiet: db.prepare(`
      SELECT s.id, s.name, a.email,
             (SELECT MAX(at) FROM sales x WHERE x.store_id = s.id) AS last_sale
      FROM stores s JOIN accounts a ON a.id = s.account_id
      WHERE (SELECT COUNT(*) FROM sales x WHERE x.store_id = s.id) > 20
        AND (SELECT MAX(at) FROM sales x WHERE x.store_id = s.id) < datetime('now','-14 days')
      ORDER BY last_sale DESC LIMIT 40`).all(),
    openShifts: db.prepare(`
      SELECT s.id, s.name, a.email, sh.opened_at FROM shifts sh
      JOIN stores s ON s.id = sh.store_id JOIN accounts a ON a.id = s.account_id
      WHERE sh.closed_at IS NULL AND sh.opened_at < datetime('now','-3 days')
      ORDER BY sh.opened_at LIMIT 40`).all()
  };
}

/* ------------------------------- tier two -------------------------------
   Opening one account. Deliberate, expiring, and visible to them. */
function openSupport(operatorId, accountId, reason, minutes) {
  const mins = Math.min(240, Math.max(5, parseInt(minutes) || 60));
  const r = String(reason || "").trim();
  if (r.length < 8) throw new Error("Give a reason — it goes in their activity log.");
  if (!db.prepare("SELECT id FROM accounts WHERE id = ?").get(accountId))
    throw new Error("No such account.");

  db.prepare(
    "INSERT INTO support_grants (operator_id, account_id, reason, expires_at) " +
    "VALUES (?,?,?, datetime('now', ?))").run(operatorId, accountId, r, `+${mins} minutes`);

  /* Written into the tenant's own activity feed, in their words not ours. */
  try {
    db.prepare("INSERT INTO audit (account_id, action, detail, ip) VALUES (?,?,?,?)")
      .run(accountId, "support-access",
        `Support opened your account for ${mins} minutes — ${r}`, "operator");
  } catch (e) {
    /* This is the record that keeps the promise made to the tenant, so a
       failure here is worth knowing about rather than swallowing. */
    console.log("  WARNING: could not write support access to the audit log — " + e.message);
  }

  log(operatorId, accountId, "support-open", `${mins}m — ${r}`);
  return { ok: true, minutes: mins };
}

function supportOpen(operatorId, accountId) {
  return !!db.prepare(
    "SELECT id FROM support_grants WHERE operator_id = ? AND account_id = ? " +
    "AND closed_at IS NULL AND expires_at > datetime('now')").get(operatorId, accountId);
}

function closeSupport(operatorId, accountId) {
  db.prepare("UPDATE support_grants SET closed_at = datetime('now') " +
    "WHERE operator_id = ? AND account_id = ? AND closed_at IS NULL")
    .run(operatorId, accountId);
  log(operatorId, accountId, "support-close", null);
}

/* What support mode actually shows: enough to diagnose, still not a customer
   list. Sale contents come through only for the store being looked at. */
function accountDetail(operatorId, accountId) {
  if (!supportOpen(operatorId, accountId)) throw new Error("Support access isn't open for that account.");
  log(operatorId, accountId, "support-read", null);

  const acct = db.prepare("SELECT id, email, created_at FROM accounts WHERE id = ?").get(accountId);
  const stores = db.prepare(
    "SELECT s.id, s.name, s.created_at, c.updated_at AS last_change " +
    "FROM stores s LEFT JOIN configs c ON c.store_id = s.id WHERE s.account_id = ?")
    .all(accountId);

  return {
    account: acct,
    stores: stores.map(s => ({
      ...s,
      sales: db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM sales WHERE store_id = ?")
        .get(s.id),
      recent: db.prepare(
        "SELECT seq, at, cashier, total, is_return FROM sales WHERE store_id = ? " +
        "ORDER BY at DESC LIMIT 25").all(s.id),
      shifts: db.prepare(
        "SELECT id, opened_at, closed_at FROM shifts WHERE store_id = ? ORDER BY id DESC LIMIT 5")
        .all(s.id)
    })),
    activity: db.prepare(
      "SELECT at, action, detail, ip FROM audit WHERE account_id = ? ORDER BY at DESC LIMIT 30")
      .all(accountId)
  };
}

/* ----------------------------- AI spend -----------------------------------
   Every model call is already logged. Turning that into a per-account figure is
   the difference between knowing this costs money and knowing who is spending
   it — which matters long before there's a bill to allocate. */
function aiUsage(days) {
  const n = Math.min(90, Math.max(1, days || 30));
  const byAccount = db.prepare(`
    SELECT a.id, a.email,
           COUNT(*) AS calls,
           COALESCE(SUM(c.in_tokens),0)  AS tin,
           COALESCE(SUM(c.out_tokens),0) AS tout,
           SUM(CASE WHEN c.ok = 0 THEN 1 ELSE 0 END) AS failed
    FROM ai_calls c LEFT JOIN accounts a ON a.id = c.account_id
    WHERE c.at > datetime('now', ?)
    GROUP BY a.id ORDER BY (COALESCE(SUM(c.in_tokens),0) + COALESCE(SUM(c.out_tokens),0)) DESC
    LIMIT 60`).all(`-${n} days`);

  const byKind = db.prepare(`
    SELECT COALESCE(kind,'unknown') AS kind, COUNT(*) AS calls,
           COALESCE(SUM(in_tokens),0) AS tin, COALESCE(SUM(out_tokens),0) AS tout
    FROM ai_calls WHERE at > datetime('now', ?)
    GROUP BY kind ORDER BY (COALESCE(SUM(in_tokens),0)+COALESCE(SUM(out_tokens),0)) DESC`)
    .all(`-${n} days`);

  const totals = db.prepare(`
    SELECT COUNT(*) AS calls, COALESCE(SUM(in_tokens),0) AS tin,
           COALESCE(SUM(out_tokens),0) AS tout,
           SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed
    FROM ai_calls WHERE at > datetime('now', ?)`).get(`-${n} days`);

  return { days: n, byAccount, byKind, totals };
}

/* ---------------------------- deleting accounts ---------------------------
   Real deletion of somebody's whole business, so: never yourself, never another
   operator without demoting them first, and always written down. */
function deleteAccounts(operatorId, ids, remove) {
  const wanted = [...new Set((ids || []).map(Number).filter(Boolean))];
  const done = [], skipped = [];

  wanted.forEach(id => {
    if (id === operatorId) return skipped.push({ id, why: "that's the account you're signed in as" });
    const a = db.prepare("SELECT id, email, is_operator FROM accounts WHERE id = ?").get(id);
    if (!a) return skipped.push({ id, why: "no such account" });
    if (a.is_operator) return skipped.push({ id: a.id, email: a.email,
      why: "it's an operator — take that away first" });

    const stores = db.prepare("SELECT COUNT(*) n FROM stores WHERE account_id = ?").get(id).n;
    const sales = db.prepare(
      "SELECT COUNT(*) n FROM sales WHERE store_id IN (SELECT id FROM stores WHERE account_id = ?)")
      .get(id).n;

    remove(id);
    log(operatorId, null, "account-deleted", `${a.email} — ${stores} stores, ${sales} sales`);
    done.push({ id: a.id, email: a.email, stores, sales });
  });

  return { deleted: done, skipped };
}

/* What deleting these would actually destroy, shown before it happens. */
function deletionPreview(ids) {
  return [...new Set((ids || []).map(Number).filter(Boolean))].map(id => {
    const a = db.prepare("SELECT id, email, is_operator, created_at FROM accounts WHERE id = ?").get(id);
    if (!a) return { id, missing: true };
    const stores = db.prepare("SELECT COUNT(*) n FROM stores WHERE account_id = ?").get(id).n;
    const sales = db.prepare(
      "SELECT COUNT(*) n FROM sales WHERE store_id IN (SELECT id FROM stores WHERE account_id = ?)")
      .get(id).n;
    const taken = db.prepare(
      "SELECT COALESCE(SUM(total),0) t FROM sales WHERE store_id IN " +
      "(SELECT id FROM stores WHERE account_id = ?)").get(id).t;
    return { id: a.id, email: a.email, operator: !!a.is_operator, created_at: a.created_at,
      stores, sales, taken: +(taken || 0).toFixed(2) };
  });
}

/* Promoting and demoting, so a second operator doesn't need a redeploy. */
function setOperator(operatorId, id, on) {
  if (id === operatorId && !on) throw new Error("You can't remove your own operator access.");
  const a = db.prepare("SELECT id, email FROM accounts WHERE id = ?").get(id);
  if (!a) throw new Error("No such account.");
  db.prepare("UPDATE accounts SET is_operator = ? WHERE id = ?").run(on ? 1 : 0, id);
  log(operatorId, id, on ? "operator-granted" : "operator-revoked", a.email);
  return { ok: true };
}

/* How big this is getting, and whether backups are actually happening. */
function storage(dataDir, backupDir) {
  const fs = require("fs"), path = require("path");
  const stat = p => { try { return fs.statSync(p).size; } catch (e) { return null; } };
  const dbPath = path.join(dataDir || ".", "pos.db");
  let backups = [];
  try {
    backups = fs.readdirSync(backupDir).filter(f => f.endsWith(".db"))
      .map(f => ({ name: f, size: stat(path.join(backupDir, f)),
        at: fs.statSync(path.join(backupDir, f)).mtime.toISOString() }))
      .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  } catch (e) {}
  return {
    db: stat(dbPath),
    rows: {
      sales: db.prepare("SELECT COUNT(*) n FROM sales").get().n,
      configs: db.prepare("SELECT COUNT(*) n FROM configs").get().n,
      audit: db.prepare("SELECT COUNT(*) n FROM audit").get().n,
      ai: db.prepare("SELECT COUNT(*) n FROM ai_calls").get().n
    },
    backups
  };
}

const grants = () => db.prepare(`
  SELECT g.*, a.email FROM support_grants g JOIN accounts a ON a.id = g.account_id
  ORDER BY g.opened_at DESC LIMIT 60`).all();

const operatorLog = () => db.prepare(`
  SELECT l.*, a.email FROM operator_log l LEFT JOIN accounts a ON a.id = l.account_id
  ORDER BY l.at DESC LIMIT 120`).all();

module.exports = { seedOperator, isOperator, fleet, trend, attention, log,
  aiUsage, deleteAccounts, deletionPreview, setOperator, storage,
  openSupport, closeSupport, supportOpen, accountDetail, grants, operatorLog };
