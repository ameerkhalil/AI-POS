/* ===========================================================================
   Menu — the whole experience, not a skin.

   Different styling was never going to be enough. What gives software away is
   its behaviour: the same modal, the same words, the same number of taps. So
   this register borrows nothing from the others.

     vocabulary   an order, not a sale. Sent, not tendered. A ticket number.
     options      a full screen with big choices, never a dialog box
     review       an explicit step before payment, because a café reads the
                  order back before taking money
     payment      its own screen with large tiles, not a modal over the top
     completion   a full-screen ticket number that clears itself

   The register underneath is untouched — same CART, same tax, same Stripe
   path. Only the conversation with the cashier is different.
   =========================================================================== */

let MN_STEP = "menu", MN_P = null, MN_PICK = {}, MN_DONE = null, MN_ERR = "";

const mnMoney = n => "$" + money(Math.abs(n));
const mnCount = () => CART.reduce((a, c) => a + c.q, 0);

/* Every screen this register can be on. One of them is showing at any time —
   there is no stack of dialogs over a background. */
function drawMenuShell() {
  if (MN_STEP === "options") return mnOptionsScreen();
  if (MN_STEP === "review") return mnReviewScreen();
  if (MN_STEP === "pay") return mnPayScreen();
  if (MN_STEP === "done") return mnDoneScreen();
  mnBoardScreen();
}

/* ------------------------------- the board ------------------------------- */
function mnBoardScreen() {
  const items = shKeys(), cats = shDepts();
  document.getElementById("vSale").innerHTML = `
    <div class="mn">
      <header class="mn-top">
        ${CFG.site.logo ? `<img src="${esc(CFG.site.logo)}" alt="">` : `<i class="mn-dot"></i>`}
        <b>${esc(CFG.site.name)}</b>
        ${CFG.site.slogan ? `<em>${esc(CFG.site.slogan)}</em>` : ""}
        <span class="mn-who">${esc(ME ? ME.n : "")}</span>
        <button class="mn-menu" onclick="__sh.nav()" aria-label="Menu">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
            stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      </header>
      <div class="mn-cats">
        ${cats.map((m, i) => `<button class="${i === SH_CAT ? "on" : ""}"
          onclick="__mn.cat(${i})">${esc(m.n)}</button>`).join("")}
      </div>
      <div class="mn-grid">
        ${items.length ? items.map(({ k, p }, i) => {
          const d = byId(CFG.depts, p.deptId);
          const col = k.color || d?.color || "#8A3D2A";
          const on = CART.filter(c => c.pluId === p.id).reduce((a, c) => a + c.q, 0);
          return `<button class="mn-t" onclick="__mn.tap('${p.id}')"
            style="--c:${col};animation-delay:${Math.min(i * 22, 320)}ms">
            ${on ? `<span class="mn-badge">${on}</span>` : ""}
            <span class="mn-n">${esc(k.label || p.n)}</span>
            <span class="mn-p num">${mnMoney(p.price)}</span>
            ${p.modIds?.length ? `<span class="mn-o">choices</span>` : ""}
          </button>`;
        }).join("") : `<div class="mn-empty">Nothing on this board yet</div>`}
      </div>
      ${CART.length ? `<button class="mn-bar" onclick="__mn.review()">
        <span class="mn-cnt">${mnCount()}</span>
        <span class="mn-lbl">Review the order</span>
        <span class="mn-tot num">${mnMoney(calc().tot)}</span>
      </button>` : ""}
    </div>`;
}

/* ------------------------------ the options ------------------------------
   A full screen with buttons big enough to hit without looking. Every café POS
   worth using does this; a 320px dialog with radio buttons is a spreadsheet's
   idea of taking an order. */
function mnOptionsScreen() {
  const p = MN_P;
  const groups = (p.modIds || []).map(id => byId(CFG.modGroups, id)).filter(Boolean);
  const extra = groups.reduce((a, g) =>
    a + (MN_PICK[g.id] || []).reduce((s, n) => s + (g.opts.find(o => o.n === n)?.p || 0), 0), 0);
  const missing = groups.filter(g => g.required && !(MN_PICK[g.id] || []).length);

  document.getElementById("vSale").innerHTML = `
    <div class="mn mn-step">
      <header class="mn-shead">
        <button onclick="__mn.back()" class="mn-back">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
          Back to the board</button>
        <b>${esc(p.n)}</b>
      </header>
      <div class="mn-sbody">
        ${groups.map(g => `
          <div class="mn-grp">
            <div class="mn-gh">
              <b>${esc(g.n)}</b>
              <em>${g.required ? "Pick one" : g.multi ? "Add any" : "Optional"}</em>
            </div>
            <div class="mn-opts">
              ${g.opts.map(o => {
                const on = (MN_PICK[g.id] || []).includes(o.n);
                return `<button class="mn-opt ${on ? "on" : ""}"
                  onclick="__mn.opt('${g.id}','${jsq(o.n)}',${!!g.multi})">
                  <span>${esc(o.n)}</span>
                  ${o.p ? `<em>+${mnMoney(o.p)}</em>` : ""}
                </button>`;
              }).join("")}
            </div>
          </div>`).join("")}
      </div>
      <div class="mn-sfoot">
        ${missing.length
          ? `<span class="mn-need">Pick ${esc(missing[0].n.toLowerCase())} to carry on</span>`
          : `<span class="mn-need ok">Ready</span>`}
        <button class="mn-add ${missing.length ? "off" : ""}" onclick="__mn.add()">
          Add to the order <b class="num">${mnMoney(p.price + extra)}</b>
        </button>
      </div>
    </div>`;
}

/* ------------------------------- the review ------------------------------
   A café reads the order back before taking money. This is that step, and it's
   why there is no cart panel on the board — the order is checked once, here,
   rather than glanced at forty times. */
function mnReviewScreen() {
  const t = calc();
  document.getElementById("vSale").innerHTML = `
    <div class="mn mn-step">
      <header class="mn-shead">
        <button onclick="__mn.back()" class="mn-back">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
          Add more</button>
        <b>The order</b>
      </header>
      <div class="mn-sbody">
        ${CART.map((c, i) => `
          <div class="mn-rl">
            <div class="mn-rq">
              <button onclick="__mn.less(${i})" aria-label="One fewer">−</button>
              <span>${c.q}</span>
              <button onclick="__mn.more(${i})" aria-label="One more">+</button>
            </div>
            <div class="mn-rn">
              <b>${esc(c.n)}</b>
              ${c.mods?.length ? `<em>${esc(c.mods.join(", "))}</em>` : ""}
              ${c.note ? `<em>${esc(c.note)}</em>` : ""}
            </div>
            <span class="mn-ra num">${mnMoney(c.price * c.q * (1 - (c.disc || 0) / 100))}</span>
            <button class="mn-rx" onclick="__mn.drop(${i})" aria-label="Remove">×</button>
          </div>`).join("") || `<div class="mn-empty2">The order is empty</div>`}
      </div>
      <div class="mn-rsum">
        ${CFG.taxRates.filter(r => r.rate > 0 && Math.abs(t.taxes[r.id] || 0) > 0.001)
          .map(r => `<div><span>${esc(r.n)}</span><b class="num">${mnMoney(t.taxes[r.id])}</b></div>`).join("")}
        <div class="big"><span>To pay</span><b class="num">${mnMoney(t.tot)}</b></div>
      </div>
      <div class="mn-sfoot">
        <button class="mn-ghost" onclick="__mn.clear()">Start again</button>
        <button class="mn-add" onclick="__mn.toPay()" ${CART.length ? "" : "disabled"}>
          Take payment <b class="num">${mnMoney(t.tot)}</b></button>
      </div>
    </div>`;
}

/* ------------------------------ the payment ------------------------------ */
function mnPayScreen() {
  const t = calc();
  document.getElementById("vSale").innerHTML = `
    <div class="mn mn-step">
      <header class="mn-shead">
        <button onclick="__mn.review()" class="mn-back">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
          Back to the order</button>
        <b>How are they paying?</b>
      </header>
      <div class="mn-due"><span>Due</span><b class="num">${mnMoney(t.tot)}</b></div>
      ${MN_ERR ? `<div class="mn-err">${esc(MN_ERR)}</div>` : ""}
      <div class="mn-paygrid">
        ${CFG.mops.map(m => `<button class="mn-paytile ${m.kind}" onclick="__mn.pay('${m.id}')">
          <b>${esc(m.n)}</b>
          <em>${m.kind === "cash" ? "Drawer opens" : m.kind === "gift" ? "Scan the card"
            : m.kind === "ebt" ? "Eligible items only" : "Reader takes it"}</em>
        </button>`).join("")}
      </div>
    </div>`;
}

/* ----------------------------- the completion ----------------------------
   A ticket number, big, for a few seconds. Nobody signs a receipt in a café —
   they walk away with a number and wait for it to be called. */
function mnDoneScreen() {
  const s = MN_DONE;
  document.getElementById("vSale").innerHTML = `
    <div class="mn mn-done">
      <div class="mn-tick">
        <span class="mn-tlab">Order</span>
        <b class="mn-tnum num">${s.n}</b>
        <span class="mn-tsum">${s.lines.reduce((a, c) => a + c.q, 0)} items ·
          ${mnMoney(s.tot + (s.roundAdj || 0))}</span>
        ${s.pays.some(p => p.change > 0.001)
          ? `<div class="mn-change"><span>Change</span>
             <b class="num">${mnMoney(s.pays.find(p => p.change > 0.001).change)}</b></div>` : ""}
      </div>
      <div class="mn-dact">
        <button class="mn-ghost" onclick="__mn.receipt()">Print a receipt</button>
        <button class="mn-add" onclick="__mn.next()">Next order</button>
      </div>
    </div>`;
}

/* ------------------------------ its behaviour ----------------------------- */
window.__mn = {
  cat(i) { SH_CAT = i; drawMenuShell(); },
  back() { MN_STEP = CART.length && MN_STEP === "review" ? "menu" : "menu"; MN_P = null; drawMenuShell(); },
  tap(id) {
    const p = byId(CFG.plus, id);
    if (!p) return;
    /* Anything needing a decision goes to its own screen. Anything that doesn't
       lands straight on the order — no confirmation, no dialog. */
    if (p.modIds?.length) { MN_P = p; MN_PICK = {}; MN_STEP = "options"; return drawMenuShell(); }
    ring(p);
  },
  opt(gid, name, multi) {
    const cur = MN_PICK[gid] || [];
    MN_PICK[gid] = multi
      ? (cur.includes(name) ? cur.filter(x => x !== name) : [...cur, name])
      : (cur[0] === name ? [] : [name]);
    drawMenuShell();
  },
  add() {
    const p = MN_P, groups = (p.modIds || []).map(id => byId(CFG.modGroups, id)).filter(Boolean);
    if (groups.some(g => g.required && !(MN_PICK[g.id] || []).length)) return;
    const chosen = [], extra = groups.reduce((a, g) => {
      (MN_PICK[g.id] || []).forEach(n => {
        chosen.push(n);
        a += g.opts.find(o => o.n === n)?.p || 0;
      });
      return a;
    }, 0);
    MN_STEP = "menu"; MN_P = null;
    add(p, { price: p.price + extra, mods: chosen });
  },
  review() { MN_STEP = "review"; drawMenuShell(); },
  more(i) { CART[i].q++; drawMenuShell(); },
  less(i) { CART[i].q > 1 ? CART[i].q-- : CART.splice(i, 1); if (!CART.length) MN_STEP = "menu"; drawMenuShell(); },
  drop(i) { CART.splice(i, 1); if (!CART.length) MN_STEP = "menu"; drawMenuShell(); },
  clear() { CART = []; SEL = null; DISC = null; MN_STEP = "menu"; drawMenuShell(); },
  toPay() { MN_ERR = ""; MN_STEP = "pay"; drawMenuShell(); },
  pay(id) {
    const m = byId(CFG.mops, id);
    if (!m || !CART.length) return;
    if (!m.change && typeof ONLINE !== "undefined" && !ONLINE) {
      MN_ERR = "Card payments need the network. Take cash, or wait for it to come back.";
      return drawMenuShell();
    }
    tender(m);
  },
  receipt() { if (MN_DONE) receipt(MN_DONE); },
  next() { MN_DONE = null; MN_STEP = "menu"; drawMenuShell(); }
};

/* When a sale completes, this register shows a ticket rather than a receipt. */
function mnFinished(sale) {
  MN_DONE = sale; MN_STEP = "done"; MN_PICK = {}; MN_P = null; MN_ERR = "";
  drawMenuShell();
}
