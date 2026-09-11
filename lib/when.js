/* ===========================================================================
   One time format.

   SQLite compares dates as strings, so two formats in one column is a silent
   disaster. A till sends "2026-09-10T04:11:05.855Z"; a query bound built from
   datetime() reads "2026-09-10 04:11:05". "T" sorts after " ", so every
   `at <= to` was false and every report came back empty — with no error, no
   warning, and tests that passed because their fixtures used the other format.

   Everything written to a date column goes through stamp(). Everything read
   back and turned into a Date goes through asDate(). Nothing else parses a
   timestamp by hand.

   Deliberately free of any dependency, so a test that stubs the database still
   gets the real implementation.
   =========================================================================== */

const CANON = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/* What goes into the database: the same shape SQLite's own datetime() writes,
   so the two are always comparable. */
function stamp(v) {
  if (v == null || v === "") return fmt(new Date());
  if (v instanceof Date) return isNaN(v) ? fmt(new Date()) : fmt(v);
  const s = String(v);
  if (CANON.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? fmt(new Date()) : fmt(d);
}

const fmt = d => d.toISOString().slice(0, 19).replace("T", " ");

/* What comes out. The stored form has no timezone marker and is UTC by
   convention, so it has to be told that or the reader's own offset creeps in
   and every shift is out by however many hours they happen to be from GMT. */
function asDate(v) {
  if (v instanceof Date) return v;
  const s = String(v == null ? "" : v);
  if (!s) return new Date(NaN);
  return new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
}

/* Bounds, in the same shape as everything stored. */
const dayStart = d => `${String(d).slice(0, 10)} 00:00:00`;
const dayEnd = d => `${String(d).slice(0, 10)} 23:59:59`;
const daysAgo = n => fmt(new Date(Date.now() - n * 86400000));
const now = () => fmt(new Date());

/* True when a value would sort correctly against the bounds above. Used by the
   tests and the schema check rather than by the running code. */
const isCanonical = v => CANON.test(String(v));

module.exports = { stamp, asDate, dayStart, dayEnd, daysAgo, now, isCanonical };
