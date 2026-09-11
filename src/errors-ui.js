/* ===========================================================================
   Reporting what went wrong on this till.

   A terminal in trouble is already having a bad time, so this is built to be
   the least burdensome thing in the room:

   - Errors are queued and sent in batches, not one request per throw.
   - Offline, they wait. A till that lost the network is exactly when you most
     want to know what it was doing.
   - Nothing here can throw. An error reporter that fails while reporting an
     error takes the whole page with it.
   - The message is trimmed here as well as scrubbed on the server, so a
     stack trace full of card data never leaves the building at all.
   =========================================================================== */

const ERRQ = [];
let errTimer = null, errSending = false, errSeen = new Map();

/* The same fault firing in a loop must not queue five hundred times. */
function errAllowed(key) {
  const now = Date.now();
  const e = errSeen.get(key);
  if (!e || now - e.at > 60000) { errSeen.set(key, { at: now, n: 1 }); return true; }
  e.n++;
  return e.n <= 5;
}

/* A first pass over anything obviously sensitive, before it leaves the till. */
function errClean(s) {
  try {
    return String(s == null ? "" : s)
      .replace(/\b(?:\d[ -]?){13,19}\b/g, "[card]")
      .replace(/\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{6,}/g, "[key]")
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
      .replace(/ANSI\s?\d{6}[\s\S]{0,400}/g, "[licence data]")
      .slice(0, 2000);
  } catch (e) { return ""; }
}

function reportError(kind, message, where, detail) {
  try {
    if (!message) return;
    const msg = errClean(message);
    const key = kind + "|" + msg.slice(0, 80);
    if (!errAllowed(key)) return;

    ERRQ.push({
      kind,
      message: msg,
      where: errClean(where).slice(0, 200),
      detail: errClean(detail),
      build: typeof BUILD !== "undefined" ? BUILD : null
    });
    if (ERRQ.length > 50) ERRQ.splice(0, ERRQ.length - 50);

    /* Batched: a burst becomes one request rather than fifty. */
    clearTimeout(errTimer);
    errTimer = setTimeout(flushErrors, 4000);
  } catch (e) { /* never make it worse */ }
}

async function flushErrors() {
  if (errSending || !ERRQ.length) return;
  if (typeof ONLINE !== "undefined" && !ONLINE) return;   /* they'll keep */
  if (typeof STORE_ID === "undefined" || !STORE_ID) return;

  errSending = true;
  const batch = ERRQ.splice(0, 20);
  try {
    await api("/api/errors?store=" + STORE_ID, { method: "POST", body: {
      store: STORE_ID, errors: batch,
      token: typeof TERMINAL !== "undefined" ? TERMINAL : null } });
  } catch (e) {
    /* Put them back; the next flush tries again. Losing the report of a fault
       is how a fault stays invisible. */
    ERRQ.unshift(...batch);
  } finally {
    errSending = false;
  }
}

function startErrorReporting() {
  try {
    window.addEventListener("error", e => {
      reportError("client", e.message,
        `${e.filename || ""}:${e.lineno || 0}:${e.colno || 0}`,
        e.error && e.error.stack ? e.error.stack : "");
    });

    /* A rejected promise nobody caught is the commonest way a screen half
       renders and nobody finds out. */
    window.addEventListener("unhandledrejection", e => {
      const r = e.reason;
      reportError("promise", r && r.message ? r.message : String(r),
        "promise", r && r.stack ? r.stack : "");
    });

    /* Send whatever is queued while the tab is closing. */
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushErrors();
    });

    setInterval(flushErrors, 30000);
  } catch (e) {}
}

/* For places that catch their own errors but still want them recorded — a
   failed print, a reader that wouldn't respond. */
function noteProblem(what, e) {
  reportError("client", `${what}: ${e && e.message ? e.message : e}`, what,
    e && e.stack ? e.stack : "");
}
