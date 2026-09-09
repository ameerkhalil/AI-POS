/* ===========================================================================
   Tank gauges.

   Veeder-Root TLS consoles speak a plain serial protocol that has been public
   since the 1980s. It answers over TCP on a TLS-450, or through a serial-to-
   Ethernet converter on a TLS-350 — either way it needs nobody's permission and
   no certification, which makes it the one piece of forecourt data reachable
   today.

   A command is SOH, a function code, and a carriage return. The console answers
   with the echoed code, a timestamp, the data, and ETX. Two formats exist:

     I…   display format — a human-readable table, forgiving across firmware
     i…   computer format — fixed-width fields, precise but version-sensitive

   This asks for display format and parses defensively, because a wrong number
   on a fuel report is worse than no number. Anything it can't read with
   confidence is reported as unknown rather than guessed at.

   Verified against the published TLS-350 and TLS-450 command references. It has
   not been run against a live console — the first real connection may need the
   parser adjusting, and the raw response is always kept so that's possible.
   =========================================================================== */
const net = require("net");
const db = require("./db");

db.exec(`
CREATE TABLE IF NOT EXISTS tank_readings (
  id         INTEGER PRIMARY KEY,
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  tank       INTEGER NOT NULL,
  product    TEXT,
  volume     REAL, tc_volume REAL, ullage REAL,
  height     REAL, water REAL, temp REAL,
  ok         INTEGER NOT NULL DEFAULT 1,
  raw        TEXT
);
CREATE INDEX IF NOT EXISTS idx_tank_store ON tank_readings(store_id, at DESC);

CREATE TABLE IF NOT EXISTS tank_alarms (
  id        INTEGER PRIMARY KEY,
  store_id  INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  tank      INTEGER,
  text      TEXT NOT NULL,
  first_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_at   TEXT NOT NULL DEFAULT (datetime('now')),
  cleared   INTEGER NOT NULL DEFAULT 0,
  UNIQUE(store_id, tank, text)
);

CREATE TABLE IF NOT EXISTS tank_deliveries (
  id         INTEGER PRIMARY KEY,
  store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  tank       INTEGER NOT NULL,
  started    TEXT, ended TEXT,
  start_vol  REAL, end_vol REAL, gallons REAL,
  start_water REAL, end_water REAL,
  seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  fingerprint TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_deliv_store ON tank_deliveries(store_id, started DESC);
`);

const SOH = "\x01", ETX = "\x03";

/* One request, one answer, then close. Consoles are single-session devices and
   a held-open socket is the classic way to lock everyone else out. */
function ask(host, port, code, { timeout = 6000 } = {}) {
  return new Promise((res, rej) => {
    let buf = "", done = false;
    const sock = net.createConnection({ host, port: port || 10001 });
    const finish = (err, data) => {
      if (done) return;
      done = true;
      sock.destroy();
      err ? rej(err) : res(data);
    };
    sock.setTimeout(timeout);
    sock.on("connect", () => sock.write(SOH + code + "\r"));
    sock.on("data", d => {
      buf += d.toString("latin1");
      /* The console ends every answer with ETX. Some firmware follows it with a
         checksum, which is why this waits for the marker rather than for the
         socket to go quiet. */
      if (buf.includes(ETX)) finish(null, buf);
    });
    sock.on("timeout", () => finish(new Error(
      buf ? "The console stopped mid-answer" : "No answer from the console")));
    sock.on("error", e => finish(new Error(
      e.code === "ECONNREFUSED" ? "Nothing is listening on that port"
      : e.code === "EHOSTUNREACH" || e.code === "ETIMEDOUT" ? "Couldn't reach that address"
      : e.message)));
    sock.on("close", () => finish(buf ? null : new Error("The console closed without answering"), buf));
  });
}

const num = s => {
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
};

/* Gilbarco EMC and any console that prints one labelled field per line:

     T 1:DIESEL
     VOLUME     = 2181 GALS
     ULLAGE     = 7547 GALS
     TC VOLUME  = 2170 GALS
     HEIGHT     = 25.03 INCHES
     WATER VOL  = 22 GALS
     WATER      = 1.37 INCHES
     TEMP       = 70.9 DEG F

   Easier and safer than the columnar layout, because every number arrives
   already attached to its name — there is no column position to get wrong. */
const LABELS = [
  [/^90%\s*ULLAGE/i, "ullage90"],
  [/^TC\s*VOLUME/i, "tc_volume"],
  [/^WATER\s*VOL/i, "water_vol"],
  [/^VOLUME/i, "volume"],
  [/^ULLAGE/i, "ullage"],
  [/^HEIGHT/i, "height"],
  [/^WATER/i, "water"],
  [/^TEMP/i, "temp"]
];

function parseLabelled(raw) {
  const lines = String(raw).split(/\r?\n/).map(l => l.replace(/[\x01\x03]/g, "").trim());
  const tanks = [];
  const alarms = [];
  let cur = null, section = "";

  lines.forEach(line => {
    if (/SYSTEM\s+STATUS/i.test(line)) { section = "status"; return; }
    if (/INVENTORY\s+REPORT/i.test(line)) { section = "inventory"; cur = null; return; }
    if (/DELIVERY\s+REPORT/i.test(line)) { section = "delivery"; cur = null; return; }

    /* "T 4:HIGH WATER ALARM" in the status section, "T 1:DIESEL" in inventory —
       same shape, different meaning, so the section decides. */
    const head = /^T\s*(\d{1,2})\s*:\s*(.+)$/i.exec(line);
    if (head) {
      const n = +head[1], rest = head[2].trim();
      if (section === "status") {
        alarms.push({ tank: n, text: rest });
      } else {
        cur = { tank: n, product: rest.replace(/\s+/g, " "), raw: line };
        tanks.push(cur);
      }
      return;
    }

    if (!cur) return;
    const kv = /^([A-Z0-9%\s]+?)\s*=\s*(-?[\d.]+)/i.exec(line);
    if (!kv) return;
    const hit = LABELS.find(([re]) => re.test(kv[1].trim()));
    if (hit) cur[hit[1]] = num(kv[2]);
  });

  /* A tank with no volume line is a heading we misread rather than a tank. */
  return { tanks: tanks.filter(t => t.volume != null), alarms, format: "labelled" };
}

/* Display-format in-tank report. The layout varies between firmware, so this
   works from the column headings the console prints rather than from fixed
   positions — a report that renames a column is better than one that silently
   reads gallons out of the temperature column. */
/* Two console families, two shapes. Pick by what the text actually looks like
   rather than by what the site was configured as — a gauge gets swapped and
   nobody updates the setting. */
function parseInTank(raw) {
  if (/^\s*(VOLUME|ULLAGE|TC\s*VOLUME|HEIGHT|WATER|TEMP)\s*=/im.test(String(raw)))
    return parseLabelled(raw);
  return parseColumnar(raw);
}

function parseColumnar(raw) {
  const lines = String(raw).split(/\r?\n/).map(l => l.replace(/[\x01\x03]/g, "").trimEnd());
  const tanks = [];
  let head = null, cols = null;

  /* Labels are matched longest-first and each match consumes its span, so
     "TC VOLUME" is claimed before a bare "VOLUME" can steal half of it. That
     one mistake shifted every column left and reported the temperature as
     water — which is the sort of thing that gets a tank pulled for no reason. */
  const HEADERS = [
    ["tc_volume", /TC\s?VOLUME/i], ["water_vol", /WATER\s?VOL(?:UME)?\b/i],
    ["volume", /VOLUME/i], ["ullage", /ULLAGE/i], ["height", /HEIGHT/i],
    ["water", /WATER/i], ["temp", /TEMP\w*/i]
  ];
  /* A single space, not any gap: "WATER     VOLUME" is two columns, while
     "WATER VOL" is one. Allowing a wide gap merged them and lost both. */
  const readHeader = line => {
    const taken = [];
    const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
    const found = [];
    HEADERS.forEach(([k, re]) => {
      const m = re.exec(line);
      if (!m) return;
      if (!free(m.index, m.index + m[0].length)) return;
      taken.push([m.index, m.index + m[0].length]);
      found.push({ k, at: m.index });
    });
    return found.sort((a, b) => a.at - b.at);
  };

  lines.forEach(line => {
    /* A heading row tells us the order of everything under it. */
    if (/VOLUME/i.test(line) && /ULLAGE|HEIGHT|TEMP/i.test(line)) {
      cols = readHeader(line);
      return;
    }
    /* A tank row starts with its number and product name. */
    const m = /^\s*(\d{1,2})\s+(.+?)\s{2,}(.*)$/.exec(line);
    if (m && cols) {
      const values = (m[3].match(/-?[\d.]+/g) || []).map(num);
      const t = { tank: +m[1], product: m[2].trim().replace(/\s+/g, " "), raw: line };
      cols.forEach((c, i) => { t[c.k] = values[i] != null ? values[i] : null; });
      /* A tank with no volume at all is a heading we misread, not a tank. */
      if (t.volume != null) tanks.push(t);
      return;
    }
    if (/IN-TANK\s+INVENTORY/i.test(line)) head = line.trim();
  });

  return { title: head, tanks, alarms: [], cols: cols ? cols.map(c => c.k) : null,
           format: "columnar" };
}

/* Deliveries. Each is identified by tank plus start time so re-reading the
   report doesn't record the same drop twice. */
function parseDeliveries(raw) {
  const lines = String(raw).split(/\r?\n/).map(l => l.replace(/[\x01\x03]/g, "").trimEnd());
  const out = [];
  lines.forEach(line => {
    const m = /^\s*(\d{1,2})\s+(\d{2}\/\d{2}\/\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/.exec(line);
    if (!m) return;
    const nums = (m[4].match(/-?[\d.]+/g) || []).map(num);
    if (nums.length < 2) return;
    out.push({
      tank: +m[1],
      started: `${m[2]} ${m[3]}`,
      start_vol: nums[0] ?? null,
      end_vol: nums[1] ?? null,
      gallons: (nums[1] != null && nums[0] != null) ? +(nums[1] - nums[0]).toFixed(1) : null,
      raw: line
    });
  });
  return out;
}

/* Read a site, store what came back, and say plainly when it didn't work. */
async function readSite(storeId, cfg) {
  const host = (cfg && cfg.host || "").trim();
  if (!host) return { error: "No gauge address set for this store." };
  const port = +cfg.port || 10001;

  let inTank;
  try { inTank = await ask(host, port, "I20100"); }
  catch (e) { return { error: e.message, host, port }; }

  const parsed = parseInTank(inTank);
  /* The console tells you what it's unhappy about. Recording it means an alarm
     raised at 3am is still on the screen at 9. */
  const seen = new Set();
  (parsed.alarms || []).forEach(a => {
    seen.add(`${a.tank}|${a.text}`);
    db.prepare(
      "INSERT INTO tank_alarms (store_id,tank,text) VALUES (?,?,?) " +
      "ON CONFLICT(store_id,tank,text) DO UPDATE SET last_at=datetime('now'),cleared=0")
      .run(storeId, a.tank, a.text);
  });
  db.prepare("SELECT id,tank,text FROM tank_alarms WHERE store_id = ? AND cleared = 0")
    .all(storeId).forEach(r => {
      if (!seen.has(`${r.tank}|${r.text}`))
        db.prepare("UPDATE tank_alarms SET cleared = 1 WHERE id = ?").run(r.id);
    });
  if (!parsed.tanks.length)
    return { error: "The console answered but no tank rows could be read.", raw: inTank.slice(0, 900) };

  const stmt = db.prepare(
    "INSERT INTO tank_readings (store_id,tank,product,volume,tc_volume,ullage,height,water,temp,raw) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?)");
  const tx = db.transaction(list => list.forEach(t =>
    stmt.run(storeId, t.tank, t.product, t.volume, t.tc_volume, t.ullage,
      t.height, t.water, t.temp, t.raw)));
  tx(parsed.tanks);

  /* Deliveries are best-effort — a console with none configured simply won't
     answer that code, and that isn't a failure worth surfacing. */
  let deliveries = [];
  try {
    const d = await ask(host, port, "I20200");
    deliveries = parseDeliveries(d);
    const ins = db.prepare(
      "INSERT OR IGNORE INTO tank_deliveries " +
      "(store_id,tank,started,start_vol,end_vol,gallons,fingerprint) VALUES (?,?,?,?,?,?,?)");
    deliveries.forEach(x => ins.run(storeId, x.tank, x.started, x.start_vol, x.end_vol, x.gallons,
      `${storeId}:${x.tank}:${x.started}`));
  } catch (e) {}

  return { at: new Date().toISOString(), tanks: parsed.tanks, deliveries,
    cols: parsed.cols, format: parsed.format, alarms: parsed.alarms || [] };
}

const latest = storeId => db.prepare(
  "SELECT * FROM tank_readings WHERE store_id = ? AND id IN " +
  "(SELECT MAX(id) FROM tank_readings WHERE store_id = ? GROUP BY tank) ORDER BY tank")
  .all(storeId, storeId);

const history = (storeId, tank, hours) => db.prepare(
  "SELECT at, volume, water, temp FROM tank_readings WHERE store_id = ? AND tank = ? " +
  "AND at > datetime('now', ?) ORDER BY at").all(storeId, tank, `-${Math.min(720, hours || 48)} hours`);

const alarms = storeId => db.prepare(
  "SELECT tank, text, first_at, last_at FROM tank_alarms WHERE store_id = ? AND cleared = 0 " +
  "ORDER BY tank, text").all(storeId);

const deliveries = storeId => db.prepare(
  "SELECT * FROM tank_deliveries WHERE store_id = ? ORDER BY seen_at DESC LIMIT 40").all(storeId);

/* A quick check that says what happened rather than just failing. */
async function probe(host, port) {
  try {
    const raw = await ask(host, port, "I10100", { timeout: 4000 });   // system status
    const clean = raw.replace(/[\x01\x03]/g, "").trim();
    return { ok: true, reply: clean.split(/\r?\n/).slice(0, 6).join("\n").slice(0, 400) };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { ask, readSite, latest, history, deliveries, alarms, probe,
  parseInTank, parseLabelled, parseColumnar, parseDeliveries };
