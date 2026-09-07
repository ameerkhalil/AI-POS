#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Station agent.

   A browser cannot talk to a USB receipt printer or a cash drawer. This is the
   small piece that can. It runs on the terminal itself, listens on localhost,
   and speaks ESC/POS to the printer.

   Two things worth knowing:
     · The cash drawer is not a computer peripheral. It plugs into the printer
       and opens when the printer receives a kick code, so opening the drawer is
       a print job with no paper.
     · Zero npm dependencies, on purpose. This has to install on a shop counter
       PC without a toolchain, and `net` plus `http` is all it needs.

   Run:  node agent.js
         PRINTER=192.168.1.50 node agent.js
   --------------------------------------------------------------------------- */
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const PORT = Number(process.env.AGENT_PORT || 9110);
const CONF = path.join(__dirname, "station.json");

let conf = { printer: process.env.PRINTER || "", port: 9100, width: 42, drawer: true, mode: "network" };
try { conf = { ...conf, ...JSON.parse(fs.readFileSync(CONF, "utf8")) }; } catch (e) {}
const save = () => { try { fs.writeFileSync(CONF, JSON.stringify(conf, null, 2)); } catch (e) {} };

/* ------------------------------- ESC/POS --------------------------------- */
const ESC = 0x1b, GS = 0x1d;
const B = (...a) => Buffer.from(a);
const CMD = {
  init:     B(ESC, 0x40),
  bold:     on => B(ESC, 0x45, on ? 1 : 0),
  center:   B(ESC, 0x61, 1),
  left:     B(ESC, 0x61, 0),
  big:      on => B(GS, 0x21, on ? 0x11 : 0x00),
  feed:     n => B(ESC, 0x64, n),
  cut:      B(GS, 0x56, 0x42, 0x00),
  /* Pin 2, 25ms on, 250ms off. The standard kick for every drawer that
     connects through a printer. */
  kick:     B(ESC, 0x70, 0x00, 0x19, 0xfa)
};

/* Receipts arrive as a small list of instructions rather than pre-rendered
   text, so the agent owns the column width and the terminal doesn't have to
   care what paper is loaded. */
function render(doc) {
  const w = conf.width || 42;
  const out = [CMD.init];
  const line = (l, r) => {
    const left = String(l ?? ""), right = String(r ?? "");
    const gap = Math.max(1, w - left.length - right.length);
    return left + " ".repeat(gap) + right;
  };
  const wrap = t => String(t).match(new RegExp(`.{1,${w}}`, "g")) || [""];
  (doc.lines || []).forEach(el => {
    if (typeof el === "string") { out.push(Buffer.from(wrap(el).join("\n") + "\n", "latin1")); return; }
    switch (el.t) {
      case "center": out.push(CMD.center,
        Buffer.from(wrap(el.v).join("\n") + "\n", "latin1"), CMD.left); break;
      case "title": out.push(CMD.center, CMD.big(true), CMD.bold(true),
        Buffer.from(String(el.v) + "\n", "latin1"), CMD.bold(false), CMD.big(false), CMD.left); break;
      case "row": out.push(Buffer.from(line(el.l, el.r) + "\n", "latin1")); break;
      case "bigrow": out.push(CMD.bold(true),
        Buffer.from(line(el.l, el.r) + "\n", "latin1"), CMD.bold(false)); break;
      case "rule": out.push(Buffer.from("-".repeat(w) + "\n", "latin1")); break;
      case "blank": out.push(Buffer.from("\n", "latin1")); break;
      default: out.push(Buffer.from(String(el.v ?? "") + "\n", "latin1"));
    }
  });
  out.push(CMD.feed(3));
  if (doc.kick) out.push(CMD.kick);
  if (doc.cut !== false) out.push(CMD.cut);
  return Buffer.concat(out);
}

/* --------------------------- printer transports --------------------------- */
function sendNetwork(buf) {
  return new Promise((res, rej) => {
    if (!conf.printer) return rej(new Error("No printer address configured"));
    const s = net.createConnection({ host: conf.printer, port: conf.port || 9100 });
    const done = err => { s.destroy(); err ? rej(err) : res(); };
    s.setTimeout(6000);
    s.on("connect", () => s.write(buf, () => setTimeout(() => done(), 250)));
    s.on("timeout", () => done(new Error("Printer didn't answer — check the address and that it's on")));
    s.on("error", e => done(e));
  });
}
/* Windows shares a USB printer by name; writing raw bytes to it is the most
   reliable path that needs no driver work. */
function sendWindowsShare(buf) {
  return new Promise((res, rej) => {
    if (!conf.share) return rej(new Error("No Windows share name configured"));
    const tmp = path.join(require("os").tmpdir(), "pos-" + Date.now() + ".prn");
    fs.writeFileSync(tmp, buf);
    execFile("cmd", ["/c", "copy", "/b", tmp, conf.share], err => {
      try { fs.unlinkSync(tmp); } catch (e) {}
      err ? rej(new Error("Couldn't reach the shared printer " + conf.share)) : res();
    });
  });
}
const send = buf => conf.mode === "share" ? sendWindowsShare(buf) : sendNetwork(buf);

/* ------------------------------ discovery -------------------------------- */
/* Sweep the local subnet for anything answering on 9100. Most counter printers
   are on a static address nobody wrote down. */
function discover(base, cb) {
  const found = [], pending = [];
  for (let i = 1; i < 255; i++) {
    const host = `${base}.${i}`;
    pending.push(new Promise(res => {
      const s = net.createConnection({ host, port: 9100 });
      s.setTimeout(700);
      s.on("connect", () => { found.push(host); s.destroy(); res(); });
      s.on("timeout", () => { s.destroy(); res(); });
      s.on("error", () => { s.destroy(); res(); });
    }));
  }
  Promise.all(pending).then(() => cb(found));
}
function localBase() {
  const nets = require("os").networkInterfaces();
  for (const name of Object.keys(nets))
    for (const n of nets[name] || [])
      if (n.family === "IPv4" && !n.internal) return n.address.split(".").slice(0, 3).join(".");
  return null;
}

/* -------------------------------- server --------------------------------- */
const json = (res, code, obj) => {
  res.writeHead(code, {
    "content-type": "application/json",
    /* The terminal is served from somewhere else, so it needs permission to
       talk to localhost. Only GET and POST, only what we answer. */
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(obj));
};

http.createServer((req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/status")
    return json(res, 200, { ok: true, agent: "aipos-station", version: 1,
      printer: conf.printer || conf.share || null, mode: conf.mode, ready: !!(conf.printer || conf.share) });

  if (url.pathname === "/discover") {
    const base = url.searchParams.get("base") || localBase();
    if (!base) return json(res, 400, { error: "Couldn't work out the local network" });
    return discover(base, hosts => json(res, 200, { base, printers: hosts }));
  }

  let body = "";
  req.on("data", c => { body += c; if (body.length > 2e6) req.destroy(); });
  req.on("end", async () => {
    let data = {};
    try { data = body ? JSON.parse(body) : {}; } catch (e) { return json(res, 400, { error: "Bad JSON" }); }

    try {
      if (url.pathname === "/config") {
        conf = { ...conf, ...data }; save();
        return json(res, 200, { ok: true, conf });
      }
      if (url.pathname === "/print") { await send(render(data)); return json(res, 200, { ok: true }); }
      if (url.pathname === "/drawer") {
        if (!conf.drawer) return json(res, 400, { error: "Drawer kick is disabled" });
        await send(Buffer.concat([CMD.init, CMD.kick]));
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/test") {
        await send(render({ kick: false, lines: [
          { t: "title", v: "TEST" }, { t: "center", v: "AI POS station agent" }, { t: "rule" },
          { t: "row", l: "Printer", r: conf.printer || conf.share || "?" },
          { t: "row", l: "Width", r: conf.width + " cols" },
          { t: "row", l: "Time", r: new Date().toLocaleString() }, { t: "rule" },
          { t: "center", v: "If you can read this, you're set." } ] }));
        return json(res, 200, { ok: true });
      }
      json(res, 404, { error: "No such endpoint" });
    } catch (e) { json(res, 500, { error: e.message }); }
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`AI POS station agent on http://127.0.0.1:${PORT}`);
  console.log(conf.printer || conf.share
    ? `  printer: ${conf.printer || conf.share} (${conf.mode})`
    : `  no printer set yet — pair one from Config → Hardware in the terminal`);
});
