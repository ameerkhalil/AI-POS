/* ===========================================================================
   Reports.

   A Z read tells you what happened in one shift. These answer the questions an
   owner actually asks: when is it busy, what makes money, who is slow, and is
   this month better than last.

   Three decisions worth stating:

   - Everything is computed in SQL over the sales table rather than replayed in
     the browser. Twenty stores and a year of sales is not something to pull
     down a phone line.

   - Money and margin come from the sale as it was rung, not from today's
     pricebook. A product that cost £2 in March cost £2 in March, and a report
     that changes when you edit a price is worse than no report.

   - Anything that can't be computed honestly is reported as unknown rather
     than as zero. A margin figure that quietly treats a missing cost as free
     money is the most dangerous number in retail software.
   =========================================================================== */
const db = require("./db");
const { stamp, asDate, daysAgo, now } = require("./when");

/* Sale rows are JSON, so anything line-level has to be walked rather than
   aggregated in SQL. Done once per report, not once per question. */
function walk(storeId, from, to, fn) {
  const rows = db.prepare(
    "SELECT seq, at, cashier, total, is_return, terminal_id, json FROM sales " +
    "WHERE store_id = ? AND at >= ? AND at <= ? ORDER BY at").all(storeId, from, to);
  rows.forEach(r => {
    let s = {};
    try { s = JSON.parse(r.json); } catch (e) { return; }
    fn(r, s);
  });
  return rows.length;
}

const range = (days) => {
  const n = Math.min(730, Math.max(1, days || 30));
  const to = new Date();
  const from = new Date(to.getTime() - n * 86400000);
  return { from: stamp(from), to: stamp(to), days: n };
};

/* ------------------------------ the headline ------------------------------ */
function overview(storeId, days) {
  const { from, to, days: n } = range(days);

  const now = db.prepare(
    "SELECT COUNT(*) sales, COALESCE(SUM(total),0) taken, " +
    "SUM(CASE WHEN is_return = 1 THEN 1 ELSE 0 END) returns, " +
    "COALESCE(SUM(CASE WHEN is_return = 1 THEN total ELSE 0 END),0) refunded " +
    "FROM sales WHERE store_id = ? AND at >= ? AND at <= ?").get(storeId, from, to);

  /* The same length of window immediately before, so "up or down" is answerable
     rather than a number floating on its own. */
  const prevFrom = stamp(new Date(asDate(from).getTime() - n * 86400000));
  const prev = db.prepare(
    "SELECT COUNT(*) sales, COALESCE(SUM(total),0) taken " +
    "FROM sales WHERE store_id = ? AND at >= ? AND at < ?").get(storeId, prevFrom, from);

  const basket = now.sales ? now.taken / now.sales : 0;
  const change = prev.taken ? (now.taken - prev.taken) / prev.taken * 100 : null;

  return {
    days: n, from, to,
    sales: now.sales, taken: +now.taken.toFixed(2),
    returns: now.returns || 0, refunded: +Math.abs(now.refunded).toFixed(2),
    basket: +basket.toFixed(2),
    previous: { sales: prev.sales, taken: +prev.taken.toFixed(2) },
    change: change == null ? null : +change.toFixed(1)
  };
}

/* --------------------------------- by day -------------------------------- */
const byDay = (storeId, days) => {
  const { from, to } = range(days);
  return db.prepare(
    "SELECT date(at) d, COUNT(*) n, COALESCE(SUM(total),0) total " +
    "FROM sales WHERE store_id = ? AND at >= ? AND at <= ? GROUP BY date(at) ORDER BY d")
    .all(storeId, from, to)
    .map(r => ({ ...r, total: +r.total.toFixed(2) }));
};

/* --------------------------- when the shop is busy ------------------------
   By hour and by weekday. The most actionable report in the set, because it's
   the one that changes a rota. */
function busy(storeId, days) {
  const { from, to, days: n } = range(days);
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, n: 0, total: 0 }));
  const dow = Array.from({ length: 7 }, (_, d) => ({ day: d, n: 0, total: 0 }));
  const seenDates = new Set();

  db.prepare("SELECT at, total FROM sales WHERE store_id = ? AND at >= ? AND at <= ? " +
    "AND is_return = 0").all(storeId, from, to).forEach(r => {
    const d = asDate(r.at);
    if (isNaN(d)) return;
    hours[d.getHours()].n++; hours[d.getHours()].total += r.total;
    dow[d.getDay()].n++; dow[d.getDay()].total += r.total;
    seenDates.add(String(r.at).slice(0, 10));
  });

  /* Averaged per day the shop was actually open, otherwise a long window makes
     every hour look busier than it is. */
  const openDays = Math.max(1, seenDates.size);
  return {
    days: n, openDays,
    hours: hours.map(h => ({ ...h, total: +h.total.toFixed(2),
      perDay: +(h.n / openDays).toFixed(1) })),
    weekdays: dow.map(d => ({ ...d, total: +d.total.toFixed(2) }))
  };
}

/* ---------------------------- what makes money ----------------------------
   Per product and per department, with margin only where the cost was known at
   the time of sale. */
function products(storeId, days, limit) {
  const { from, to } = range(days);
  const byPlu = {};

  walk(storeId, from, to, (r, s) => {
    const sign = r.is_return ? -1 : 1;
    (s.lines || []).forEach(l => {
      if (!l.pluId) return;
      const q = (Number(l.q) || 0) * sign;
      const rev = (Number(l.price) || 0) * q * (1 - (Number(l.disc) || 0) / 100);
      const e = byPlu[l.pluId] || (byPlu[l.pluId] = {
        pluId: l.pluId, name: l.n, qty: 0, revenue: 0, cost: 0, costed: 0, uncosted: 0
      });
      e.name = l.n || e.name;
      e.qty += q;
      e.revenue += rev;
      /* Cost is only counted when the line carried one. Guessing here would
         invent margin out of nothing. */
      if (l.cost > 0) { e.cost += l.cost * q; e.costed += Math.abs(q); }
      else e.uncosted += Math.abs(q);
    });
  });

  return Object.values(byPlu).map(e => {
    const known = e.costed > 0 && e.uncosted === 0;
    return {
      ...e,
      revenue: +e.revenue.toFixed(2),
      cost: +e.cost.toFixed(2),
      profit: known ? +(e.revenue - e.cost).toFixed(2) : null,
      margin: known && e.revenue ? +((e.revenue - e.cost) / e.revenue * 100).toFixed(1) : null,
      partial: e.costed > 0 && e.uncosted > 0
    };
  }).sort((a, b) => b.revenue - a.revenue).slice(0, Math.min(500, limit || 100));
}

function departments(storeId, days, deptNames) {
  const { from, to } = range(days);
  const by = {};
  walk(storeId, from, to, (r, s) => {
    const sign = r.is_return ? -1 : 1;
    (s.lines || []).forEach(l => {
      const id = l.deptId || "none";
      const q = (Number(l.q) || 0) * sign;
      const rev = (Number(l.price) || 0) * q * (1 - (Number(l.disc) || 0) / 100);
      const e = by[id] || (by[id] = { deptId: id, name: (deptNames || {})[id] || "Unassigned",
        qty: 0, revenue: 0, cost: 0, uncosted: 0 });
      e.qty += q;
      e.revenue += rev;
      if (l.cost > 0) e.cost += l.cost * q; else e.uncosted += Math.abs(q);
    });
  });

  const total = Object.values(by).reduce((a, e) => a + e.revenue, 0);
  return Object.values(by).map(e => ({
    ...e,
    revenue: +e.revenue.toFixed(2),
    cost: +e.cost.toFixed(2),
    share: total ? +(e.revenue / total * 100).toFixed(1) : 0,
    margin: e.uncosted === 0 && e.revenue
      ? +((e.revenue - e.cost) / e.revenue * 100).toFixed(1) : null,
    partial: e.uncosted > 0 && e.cost > 0
  })).sort((a, b) => b.revenue - a.revenue);
}

/* --------------------------------- staff ---------------------------------
   Comparison, not a league table. The useful signals are basket size and
   exception rate, not who rang the most while on the busy shift. */
function staff(storeId, days) {
  const { from, to } = range(days);
  const by = {};

  walk(storeId, from, to, (r, s) => {
    const who = r.cashier || "unknown";
    const e = by[who] || (by[who] = { who, sales: 0, taken: 0, returns: 0, refunded: 0,
      discounted: 0, voids: 0, items: 0, hours: new Set() });
    if (r.is_return) { e.returns++; e.refunded += Math.abs(r.total); }
    else { e.sales++; e.taken += r.total; }
    e.items += (s.lines || []).reduce((a, l) => a + (Number(l.q) || 0), 0);
    if (s.manualDisc || (s.lines || []).some(l => l.disc)) e.discounted++;
    if (s.voided) e.voids++;
    e.hours.add(String(r.at).slice(0, 13));
  });

  return Object.values(by).map(e => ({
    who: e.who,
    sales: e.sales, taken: +e.taken.toFixed(2),
    returns: e.returns, refunded: +e.refunded.toFixed(2),
    basket: e.sales ? +(e.taken / e.sales).toFixed(2) : 0,
    itemsPerSale: e.sales ? +(e.items / e.sales).toFixed(1) : 0,
    /* Rates rather than counts, so somebody who works twice as many hours
       doesn't automatically look twice as suspicious. */
    discountRate: e.sales ? +(e.discounted / e.sales * 100).toFixed(1) : 0,
    returnRate: e.sales ? +(e.returns / e.sales * 100).toFixed(1) : 0,
    hoursActive: e.hours.size
  })).sort((a, b) => b.taken - a.taken);
}

/* ------------------------------ how they pay ------------------------------ */
function tenders(storeId, days) {
  const { from, to } = range(days);
  const by = {};
  walk(storeId, from, to, (r, s) => {
    (s.pays || []).forEach(p => {
      const k = p.mop || "unknown";
      const e = by[k] || (by[k] = { mop: k, n: 0, total: 0 });
      e.n++;
      e.total += Number(p.amt) || 0;
    });
  });
  const total = Object.values(by).reduce((a, e) => a + Math.abs(e.total), 0);
  return Object.values(by).map(e => ({ ...e, total: +e.total.toFixed(2),
    share: total ? +(Math.abs(e.total) / total * 100).toFixed(1) : 0 }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

/* ------------------------------- exceptions -------------------------------
   Not accusations — the things worth a second look. Presented with what
   happened rather than a judgement about it. */
function exceptions(storeId, days) {
  const { from, to } = range(days);
  const out = { refundsNoOriginal: [], bigDiscounts: [], afterHours: [], voidedLines: [] };

  walk(storeId, from, to, (r, s) => {
    if (r.is_return && !s.against)
      out.refundsNoOriginal.push({ seq: r.seq, at: r.at, who: r.cashier,
        amount: +Math.abs(r.total).toFixed(2) });

    const disc = Math.abs(Number(s.disc) || 0);
    if (disc > 0 && Math.abs(r.total) > 0 && disc / (Math.abs(r.total) + disc) > 0.25)
      out.bigDiscounts.push({ seq: r.seq, at: r.at, who: r.cashier,
        amount: +Math.abs(r.total).toFixed(2), discount: +disc.toFixed(2) });

    const h = asDate(r.at).getUTCHours();
    if (h >= 2 && h < 5)
      out.afterHours.push({ seq: r.seq, at: r.at, who: r.cashier,
        amount: +Math.abs(r.total).toFixed(2) });

    (s.voidedLines || []).forEach(v =>
      out.voidedLines.push({ seq: r.seq, at: r.at, who: r.cashier, what: v.n,
        amount: +Math.abs(Number(v.price) || 0).toFixed(2) }));
  });

  Object.keys(out).forEach(k => { out[k] = out[k].slice(-50).reverse(); });
  return out;
}

/* -------------------------------- one day --------------------------------
   Everything about a single date, for when somebody asks about last Tuesday. */
function day(storeId, date, deptNames) {
  const from = `${date} 00:00:00`, to = `${date} 23:59:59`;
  const totals = db.prepare(
    "SELECT COUNT(*) sales, COALESCE(SUM(total),0) taken, " +
    "SUM(CASE WHEN is_return = 1 THEN 1 ELSE 0 END) returns " +
    "FROM sales WHERE store_id = ? AND at >= ? AND at <= ?").get(storeId, from, to);

  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, n: 0, total: 0 }));
  const depts = {};
  walk(storeId, from, to, (r, s) => {
    const d = asDate(r.at);
    if (!isNaN(d)) { hours[d.getHours()].n++; hours[d.getHours()].total += r.total; }
    const sign = r.is_return ? -1 : 1;
    (s.lines || []).forEach(l => {
      const id = l.deptId || "none";
      depts[id] = depts[id] || { deptId: id, name: (deptNames || {})[id] || "Unassigned", revenue: 0 };
      depts[id].revenue += (Number(l.price) || 0) * (Number(l.q) || 0) * sign;
    });
  });

  return {
    date, totals: { ...totals, taken: +totals.taken.toFixed(2) },
    hours: hours.map(h => ({ ...h, total: +h.total.toFixed(2) })),
    departments: Object.values(depts).map(d => ({ ...d, revenue: +d.revenue.toFixed(2) }))
      .sort((a, b) => b.revenue - a.revenue)
  };
}

module.exports = { overview, byDay, busy, products, departments, staff, tenders,
  exceptions, day };
