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
           COUNT(DISTINCT s.id) AS stores,
           MAX(s.updated_at) AS last_change
    FROM accounts a LEFT JOIN stores s ON s.account_id = a.id
    GROUP BY a.id ORDER BY a.created_at DESC`).all();

  const stores = db.prepare(`
    SELECT s.id, s.account_id, s.name, s.created_at, s.updated_at,
           (SELECT COUNT(*) FROM sales x WHERE x.store_id = s.id) AS sales,
           (SELECT MAX(at) FROM sales x WHERE x.store_id = s.id) AS last_sale,
           (SELECT COUNT(*) FROM sales x WHERE x.store_id = s.id
              AND x.at > datetime('now','-7 days')) AS sales_7d,
           s.config IS NOT NULL AND length(s.config) > 40 AS configured
    FROM stores s ORDER BY s.id DESC`).all();

  /* A store's trade and which modules it runs are structure, not content — the
     same line the learning system already draws. */
  const shape = stores.map(s => {
    let cfg = {};
    try { cfg = JSON.parse(db.prepare("SELECT config FROM stores WHERE id = ?")
      .get(s.id).config || "{}"); } catch (e) {}
    return {
      id: s.id,
      trade: cfg.trade || cfg.site?.trade || null,
      layout: cfg.layout || null,
      modules: Object.keys(cfg.modules || {}).filter(k => cfg.modules[k]),
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

  return { totals, accounts, stores, shape };
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
      SELECT s.id, s.name, s.created_at, a.email FROM stores s JOIN accounts a ON a.id = s.account_id
      WHERE (s.config IS NULL OR length(s.config) < 40) AND s.created_at < datetime('now','-2 days')
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
    db.prepare("INSERT INTO activity (account_id, action, detail, ip) VALUES (?,?,?,?)")
      .run(accountId, "support-access",
        `Support opened your account for ${mins} minutes — ${r}`, "operator");
  } catch (e) {}

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
  const stores = db.prepare("SELECT id, name, created_at, updated_at FROM stores WHERE account_id = ?")
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
      "SELECT at, action, detail, ip FROM activity WHERE account_id = ? ORDER BY at DESC LIMIT 30")
      .all(accountId)
  };
}

const grants = () => db.prepare(`
  SELECT g.*, a.email FROM support_grants g JOIN accounts a ON a.id = g.account_id
  ORDER BY g.opened_at DESC LIMIT 60`).all();

const operatorLog = () => db.prepare(`
  SELECT l.*, a.email FROM operator_log l LEFT JOIN accounts a ON a.id = l.account_id
  ORDER BY l.at DESC LIMIT 120`).all();

module.exports = { seedOperator, isOperator, fleet, trend, attention, log,
  openSupport, closeSupport, supportOpen, accountDetail, grants, operatorLog };
