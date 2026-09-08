/* ===========================================================================
   Learning across stores.

   The tenth gas station to sign up should not start from a blank page. The nine
   before it already worked out what departments a forecourt needs, which tax
   categories apply, and which modules earn their place — and that knowledge is
   worth more to a newcomer than anything a model can guess.

   The line this file will not cross: what gets shared is SHAPE, never CONTENT.

     shared      department names, tax category names, which modules are on,
                 counter layout, pricing mode, the trade questions and answers
     never       product names, prices, costs, barcodes, suppliers, customers,
                 staff, sales, takings, store names, addresses, anything
                 identifying a business or a person

   The extractor below is an allowlist, not a filter. A field has to be named
   explicitly to travel, so a new field added elsewhere in the app cannot leak
   by being forgotten about here.
   =========================================================================== */
const db = require("./db");

db.exec(`
CREATE TABLE IF NOT EXISTS patterns (
  id          INTEGER PRIMARY KEY,
  store_id    INTEGER UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  biz_type    TEXT NOT NULL,
  json        TEXT NOT NULL,
  weight      REAL NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(biz_type);
`);

/* Only these leave a store. Everything else is dropped by omission. */
function extract(cfg) {
  if (!cfg || !cfg.depts) return null;
  const dept = d => ({
    n: String(d.n || "").slice(0, 40),
    tax: String((cfg.taxRates.find(r => r.id === d.taxId) || {}).n || "").slice(0, 40),
    size: cfg.plus.filter(p => p.deptId === d.id).length   // a count, not the items
  });
  return {
    depts: cfg.depts.filter(d => !d.fuel).slice(0, 24).map(dept),
    fuel: cfg.depts.some(d => d.fuel),
    taxes: (cfg.taxRates || []).slice(0, 12)
      .map(r => ({ n: String(r.n || "").slice(0, 40), rate: +r.rate || 0 })),
    caps: (cfg.caps || []).slice(0, 20),
    modules: Object.entries(cfg.modules || {}).filter(([, m]) => m && m.on).map(([k]) => k),
    layout: cfg.layout || null,
    priceMode: (cfg.pricing || {}).mode || "margin",
    ending: (cfg.pricing || {}).ending || null,
    restrictions: (cfg.restricts || []).slice(0, 8)
      .map(r => ({ n: String(r.n || "").slice(0, 40), minAge: r.minAge || null, timed: !!r.start })),
    mops: (cfg.mops || []).slice(0, 10).map(m => String(m.kind || "").slice(0, 12)),
    trade: (cfg.trade || []).slice(0, 6)
      .map(t => ({ q: String(t.q || "").slice(0, 160), a: String(t.a || "").slice(0, 60) })),
    modGroups: (cfg.modGroups || []).slice(0, 8).map(g => ({
      n: String(g.n || "").slice(0, 30), required: !!g.required, multi: !!g.multi,
      opts: (g.opts || []).slice(0, 12).map(o => String(o.n || "").slice(0, 24))
    }))
  };
}

/* A store's pattern is worth more once it has actually been used. Weight by how
   far past setup it got, so a half-finished trial doesn't teach anyone anything. */
function weightFor(storeId) {
  const sales = db.prepare("SELECT COUNT(*) n FROM sales WHERE store_id = ?").get(storeId).n;
  const age = db.prepare(
    "SELECT julianday('now') - julianday(created_at) d FROM stores WHERE id = ?").get(storeId)?.d || 0;
  if (sales < 5) return 0.2;                       // barely used — a weak vote
  return Math.min(5, 1 + Math.log10(sales) + Math.min(2, age / 90));
}

function contribute(storeId, bizType, cfg) {
  const p = extract(cfg);
  if (!p || !bizType) return false;
  db.prepare(
    "INSERT INTO patterns (store_id, biz_type, json, weight, updated_at) VALUES (?,?,?,?,datetime('now')) " +
    "ON CONFLICT(store_id) DO UPDATE SET biz_type=excluded.biz_type, json=excluded.json, " +
    "weight=excluded.weight, updated_at=datetime('now')")
    .run(storeId, String(bizType).slice(0, 60), JSON.stringify(p), weightFor(storeId));
  return true;
}

/* What a new store of this type should probably look like, assembled from what
   the existing ones actually did. Never fewer than three contributors, so no
   single business can be reverse-engineered out of the suggestion. */
const MIN_CONTRIBUTORS = 3;

function suggest(bizType, excludeStore) {
  const rows = db.prepare(
    "SELECT json, weight FROM patterns WHERE biz_type = ? AND store_id IS NOT ? ORDER BY weight DESC LIMIT 200")
    .all(String(bizType || ""), excludeStore || -1);
  if (rows.length < MIN_CONTRIBUTORS) return { contributors: rows.length, ready: false };

  const pats = rows.map(r => ({ p: JSON.parse(r.json), w: r.weight }));
  const total = pats.reduce((a, x) => a + x.w, 0);

  const tally = (get, key = String) => {
    const m = new Map();
    pats.forEach(({ p, w }) => {
      const seen = new Set();
      (get(p) || []).forEach(v => {
        const k = key(v);
        if (!k || seen.has(k)) return;
        seen.add(k);
        const e = m.get(k) || { v, w: 0, n: 0 };
        e.w += w; e.n++; m.set(k, e);
      });
    });
    return [...m.values()].sort((a, b) => b.w - a.w);
  };
  const commonest = get => {
    const t = tally(p => [get(p)].filter(v => v != null));
    return t.length ? { v: t[0].v, share: t[0].w / total } : null;
  };

  const depts = tally(p => p.depts, d => d.n.toLowerCase())
    .filter(e => e.w / total >= 0.34)
    .slice(0, 10)
    .map(e => ({ n: e.v.n, tax: e.v.tax, share: +(e.w / total).toFixed(2), stores: e.n }));

  const modules = tally(p => p.modules).filter(e => e.w / total >= 0.4)
    .map(e => ({ k: e.v, share: +(e.w / total).toFixed(2), stores: e.n }));

  const caps = tally(p => p.caps).filter(e => e.w / total >= 0.4).map(e => e.v);

  const taxes = tally(p => p.taxes, t => t.n.toLowerCase())
    .filter(e => e.w / total >= 0.34).slice(0, 8)
    .map(e => ({ n: e.v.n, share: +(e.w / total).toFixed(2) }));

  const trade = tally(p => p.trade, t => t.q.toLowerCase().slice(0, 60))
    .slice(0, 6)
    .map(e => {
      const answers = tally(p => (p.trade || []).filter(t =>
        t.q.toLowerCase().slice(0, 60) === e.v.q.toLowerCase().slice(0, 60)), t => t.a);
      return { q: e.v.q, common: answers[0] ? answers[0].v.a : null,
               share: answers[0] ? +(answers[0].w / total).toFixed(2) : 0 };
    });

  const modGroups = tally(p => p.modGroups, g => g.n.toLowerCase())
    .filter(e => e.w / total >= 0.4).slice(0, 4)
    .map(e => ({ n: e.v.n, required: e.v.required, multi: e.v.multi, opts: e.v.opts }));

  return {
    ready: true,
    contributors: rows.length,
    depts, modules, caps, taxes, trade, modGroups,
    layout: commonest(p => p.layout),
    priceMode: commonest(p => p.priceMode),
    ending: commonest(p => p.ending),
    fuel: pats.filter(x => x.p.fuel).reduce((a, x) => a + x.w, 0) / total > 0.5
  };
}

/* What the fleet looks like in aggregate. Counts only — no store is nameable. */
function stats() {
  return {
    stores: db.prepare("SELECT COUNT(*) n FROM patterns").get().n,
    types: db.prepare(
      "SELECT biz_type t, COUNT(*) n FROM patterns GROUP BY biz_type ORDER BY n DESC LIMIT 20").all()
  };
}

module.exports = { extract, contribute, suggest, stats, MIN_CONTRIBUTORS };
