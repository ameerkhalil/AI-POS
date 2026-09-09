/* ===========================================================================
   Four more registers.

   Each of these renders the sale screen from scratch. They do not share a
   skeleton with each other or with Classic — different structure, different
   interaction, different type, different colour. What they share is everything
   underneath: one CART, one calc(), one tender path, one set of restrictions.

     menu       full-bleed tiles, no cart panel, order slides up over the top
     terminal   a command line. Type a code, press enter. Text only.
     catalogue  browse-first, large cards, order along the bottom
     pad        one column of big rows, order as a sheet you pull up
   =========================================================================== */

let SH_CAT = 0, SH_OPEN = false, SH_CMD = "", SH_LOG = [];

const shDepts = () => CFG.menus.filter(m => !m.fuel);
const shKeys = () => {
  const m = shDepts()[SH_CAT];
  return m ? m.keys.map(k => ({ k, p: byId(CFG.plus, k.pluId) })).filter(x => x.p) : [];
};
const shCount = () => CART.reduce((a, c) => a + c.q, 0);

/* ============================== MENU ==============================
   No cart on screen. Products edge to edge, as big and as colourful as they
   can be. The order lives behind a button and slides up when you want it —
   which is how a counter with a queue actually works: hands on products,
   totals at the end. */
function drawMenuShell() {
  const t = calc(), items = shKeys(), cats = shDepts();
  document.getElementById("vSale").innerHTML = `
    <div class="mn">
      <div class="mn-cats">
        ${cats.map((m, i) => `<button class="${i === SH_CAT ? "on" : ""}"
          onclick="__sh.cat(${i})">${esc(m.n)}</button>`).join("")}
      </div>
      <div class="mn-grid">
        ${items.length ? items.map(({ k, p }, i) => {
          const d = byId(CFG.depts, p.deptId);
          const col = k.color || d?.color || "#3E464A";
          return `<button class="mn-t" onclick="__sh.ring('${p.id}')"
            style="--c:${col};animation-delay:${Math.min(i * 22, 320)}ms">
            <span class="mn-n">${esc(k.label || p.n)}</span>
            <span class="mn-p num">${money(p.price)}</span>
            ${p.modIds?.length ? `<span class="mn-o">options</span>` : ""}
          </button>`;
        }).join("") : `<div class="mn-empty">Nothing on this menu yet</div>`}
      </div>
      <button class="mn-bar ${CART.length ? "" : "off"}" onclick="__sh.open()">
        <span class="mn-cnt">${shCount()}</span>
        <span class="mn-lbl">${CART.length ? "View the order" : "No items yet"}</span>
        <span class="mn-tot num">${money(Math.abs(t.tot))}</span>
      </button>
      <div class="mn-sheet ${SH_OPEN ? "up" : ""}">
        <div class="mn-sh">
          <b>Current order</b>
          <button onclick="__sh.close()">Back to the menu</button>
        </div>
        <div class="mn-lines">
          ${CART.map((c, i) => `<div class="mn-l">
            <span class="mn-lq">${c.q}</span>
            <span class="mn-ln">${esc(c.n)}${c.mods?.length ? `<em>${esc(c.mods.join(", "))}</em>` : ""}</span>
            <span class="mn-la num">${money(c.price * c.q * (1 - (c.disc || 0) / 100))}</span>
            <button class="mn-lx" onclick="__sh.drop(${i})">×</button>
          </div>`).join("") || `<div class="mn-empty2">Nothing added</div>`}
        </div>
        <div class="mn-sums">
          ${CFG.taxRates.filter(r => r.rate > 0 && Math.abs(t.taxes[r.id] || 0) > 0.001)
            .map(r => `<div><span>${esc(r.n)}</span><b class="num">${money(t.taxes[r.id])}</b></div>`).join("")}
          <div class="big"><span>Total</span><b class="num">${money(Math.abs(t.tot))}</b></div>
        </div>
        <div class="mn-pay">
          ${CFG.mops.map(m => `<button onclick="__sh.tender('${m.id}')"
            ${CART.length ? "" : "disabled"}>${esc(m.n)}</button>`).join("")}
        </div>
      </div>
    </div>`;
}

/* ============================ TERMINAL ============================
   A command line. Type a barcode, a PLU number, or a quantity and a code, and
   press enter. No mouse required and no pictures — which is what a parts
   counter, a pharmacy or a wholesale desk actually wants. */
function drawTerminalShell() {
  const t = calc();
  document.getElementById("vSale").innerHTML = `
    <div class="tm">
      <div class="tm-head">
        <span>${esc(CFG.site.name).toUpperCase()}</span>
        <span>REG ${esc(CFG.site.register)}</span>
        <span>${esc(ME ? ME.n.toUpperCase() : "")}</span>
        <span>${RETURN ? "** RETURN **" : "SALE"}</span>
      </div>
      <div class="tm-cols">
        <div class="tm-main">
          <div class="tm-hdr">
            <span>QTY</span><span>DESCRIPTION</span><span>PRICE</span><span>AMOUNT</span>
          </div>
          <div class="tm-lines" id="tmLines">
            ${CART.map((c, i) => `<div class="tm-l ${SEL === i ? "on" : ""}" onclick="__sh.sel(${i})">
              <span>${String(c.q).padStart(3)}</span>
              <span>${esc(c.n.toUpperCase().slice(0, 40))}</span>
              <span>${money(c.price)}</span>
              <span>${money(c.price * c.q * (1 - (c.disc || 0) / 100))}</span>
            </div>`).join("") || `<div class="tm-idle">-- NO ITEMS --</div>`}
          </div>
          <div class="tm-sums">
            <div><span>SUBTOTAL</span><b>${money(t.sub)}</b></div>
            ${CFG.taxRates.filter(r => r.rate > 0 && Math.abs(t.taxes[r.id] || 0) > 0.001)
              .map(r => `<div><span>${esc(r.n.toUpperCase())} ${r.rate}%</span><b>${money(t.taxes[r.id])}</b></div>`).join("")}
            <div class="tot"><span>${RETURN ? "REFUND" : "TOTAL"}</span><b>${money(Math.abs(t.tot))}</b></div>
          </div>
          <div class="tm-cmd">
            <span class="tm-prompt">&gt;</span>
            <input id="tmIn" autocomplete="off" spellcheck="false"
              placeholder="barcode, or QTY*CODE, or ? to search">
          </div>
          <div class="tm-log">${SH_LOG.slice(-4).map(l =>
            `<div class="${l.bad ? "bad" : ""}">${esc(l.t)}</div>`).join("")}</div>
        </div>
        <div class="tm-side">
          <div class="tm-sh">FUNCTION KEYS</div>
          ${[["F1", "PRICE CHECK", "look"], ["F2", "VOID LINE", "void"], ["F3", "DISCOUNT", "disc"],
             ["F4", "NO SALE", "nosale"], ["F5", "SUSPEND", "hold"], ["F6", "RECALL", "recall"],
             ["F7", "RETURN", "ret"], ["F8", "MENU", "menu"]].map(([k, n, a]) =>
            `<button class="tm-fk" onclick="__sh.fn('${a}')"><b>${k}</b><span>${n}</span></button>`).join("")}
          <div class="tm-sh" style="margin-top:14px">TENDER</div>
          ${CFG.mops.map(m => `<button class="tm-pay" onclick="__sh.tender('${m.id}')"
            ${CART.length ? "" : "disabled"}>${esc(m.n.toUpperCase())}</button>`).join("")}
        </div>
      </div>
    </div>`;
  const inp = document.getElementById("tmIn");
  if (inp) {
    inp.value = SH_CMD;
    inp.oninput = e => { SH_CMD = e.target.value; };
    inp.onkeydown = e => { if (e.key === "Enter") { __sh.run(); e.preventDefault(); } };
    if (!document.querySelector(".veil")) inp.focus();
  }
  const box = document.getElementById("tmLines");
  if (box) box.scrollTop = box.scrollHeight;
}

/* =========================== CATALOGUE ===========================
   Browse-first. Large cards with room for options, categories spelled out down
   the side in a serif, and the order along the bottom where it doesn't compete
   for attention. For a shop where one sale takes a conversation. */
function drawCatalogueShell() {
  const t = calc(), items = shKeys(), cats = shDepts();
  document.getElementById("vSale").innerHTML = `
    <div class="ct">
      <aside class="ct-side">
        <div class="ct-brand">
          ${CFG.site.logo ? `<img src="${esc(CFG.site.logo)}" alt="">` : ""}
          <b>${esc(CFG.site.name)}</b>
        </div>
        <div class="ct-cats">
          ${cats.map((m, i) => `<button class="${i === SH_CAT ? "on" : ""}"
            onclick="__sh.cat(${i})">${esc(m.n)}<em>${m.keys.length}</em></button>`).join("")}
        </div>
        <div class="ct-srch">
          <input id="ctQ" placeholder="Search" autocomplete="off">
        </div>
      </aside>
      <main class="ct-main">
        <div class="ct-h">
          <h2>${esc(cats[SH_CAT] ? cats[SH_CAT].n : "")}</h2>
          <span>${items.length} item${items.length === 1 ? "" : "s"}</span>
        </div>
        <div class="ct-grid">
          ${items.map(({ k, p }, i) => {
            const d = byId(CFG.depts, p.deptId);
            return `<button class="ct-c" onclick="__sh.ring('${p.id}')"
              style="animation-delay:${Math.min(i * 26, 340)}ms">
              <span class="ct-swatch" style="background:${k.color || d?.color || "#8C6BC8"}"></span>
              <span class="ct-body">
                <span class="ct-n">${esc(k.label || p.n)}</span>
                ${p.modIds?.length ? `<span class="ct-o">Sizes and options</span>` : ""}
              </span>
              <span class="ct-f"><span class="ct-p num">${money(p.price)}</span>
                <span class="ct-add">Add</span></span>
            </button>`;
          }).join("") || `<div class="ct-empty">Nothing in this section</div>`}
        </div>
      </main>
      <div class="ct-bar ${CART.length ? "on" : ""}">
        <div class="ct-items">
          ${CART.slice(-4).map((c, i) => `<span class="ct-chip" onclick="__sh.drop(${CART.indexOf(c)})">
            ${c.q > 1 ? c.q + "× " : ""}${esc(c.n)}<em>×</em></span>`).join("")
            || `<span class="ct-none">Nothing selected yet</span>`}
          ${CART.length > 4 ? `<span class="ct-more">+${CART.length - 4} more</span>` : ""}
        </div>
        <div class="ct-tot"><span>Total</span><b class="num">${money(Math.abs(t.tot))}</b></div>
        <div class="ct-pay">
          ${CFG.mops.slice(0, 3).map(m => `<button onclick="__sh.tender('${m.id}')"
            ${CART.length ? "" : "disabled"}>${esc(m.n)}</button>`).join("")}
        </div>
      </div>
    </div>`;
  const q = document.getElementById("ctQ");
  if (q) q.oninput = e => { FILTER = e.target.value; drawCatalogueShell(); };
}

/* ============================== PAD ==============================
   One column, everything oversized, order as a sheet you pull up from the
   bottom. Built for a tablet held in one hand — a food truck, a market stall,
   a pop-up. */
function drawPadShell() {
  const t = calc(), items = shKeys(), cats = shDepts();
  document.getElementById("vSale").innerHTML = `
    <div class="pd">
      <div class="pd-top">
        <b>${esc(CFG.site.name)}</b>
        <span>${esc(ME ? ME.n : "")}</span>
      </div>
      <div class="pd-cats">
        ${cats.map((m, i) => `<button class="${i === SH_CAT ? "on" : ""}"
          onclick="__sh.cat(${i})">${esc(m.n)}</button>`).join("")}
      </div>
      <div class="pd-list">
        ${items.map(({ k, p }, i) => {
          const d = byId(CFG.depts, p.deptId);
          return `<button class="pd-r" onclick="__sh.ring('${p.id}')"
            style="animation-delay:${Math.min(i * 20, 280)}ms">
            <span class="pd-dot" style="background:${k.color || d?.color || "#0FA3A3"}"></span>
            <span class="pd-n">${esc(k.label || p.n)}</span>
            <span class="pd-p num">${money(p.price)}</span>
            <span class="pd-plus">+</span>
          </button>`;
        }).join("") || `<div class="pd-empty">Nothing here yet</div>`}
      </div>
      <div class="pd-sheet ${SH_OPEN ? "up" : ""}">
        <button class="pd-handle" onclick="__sh.toggle()">
          <span class="pd-grip"></span>
          <span class="pd-hl">${shCount()} item${shCount() === 1 ? "" : "s"}</span>
          <span class="pd-ht num">${money(Math.abs(t.tot))}</span>
        </button>
        <div class="pd-inner">
          <div class="pd-lines">
            ${CART.map((c, i) => `<div class="pd-l">
              <span class="pd-lq">${c.q}</span>
              <span class="pd-ln">${esc(c.n)}</span>
              <span class="pd-la num">${money(c.price * c.q * (1 - (c.disc || 0) / 100))}</span>
              <button onclick="__sh.drop(${i})">×</button>
            </div>`).join("") || `<div class="pd-empty2">Tap a product to start</div>`}
          </div>
          <div class="pd-pay">
            ${CFG.mops.map(m => `<button onclick="__sh.tender('${m.id}')"
              ${CART.length ? "" : "disabled"}>${esc(m.n)}</button>`).join("")}
          </div>
        </div>
      </div>
    </div>`;
}

/* ------------------------- shared interactions ------------------------- */
window.__sh = {
  cat(i) { SH_CAT = i; FILTER = ""; refreshSale(); },
  ring(id) { ring(byId(CFG.plus, id)); },
  drop(i) { CART.splice(i, 1); SEL = null; refreshSale(); },
  sel(i) { SEL = SEL === i ? null : i; refreshSale(); },
  open() { if (CART.length) { SH_OPEN = true; refreshSale(); } },
  close() { SH_OPEN = false; refreshSale(); },
  toggle() { SH_OPEN = !SH_OPEN; refreshSale(); },
  tender(id) { const m = byId(CFG.mops, id); if (m && CART.length) tender(m); },
  fn(a) {
    ({ look: () => window.__cls.look(), void: () => window.__cls.voidLine(),
       disc: () => CART.length && discPrompt(), nosale: () => noSale(),
       hold: () => hold(), recall: () => recall(),
       ret: () => toggleReturn(), menu: () => openMenu() })[a]?.();
  },
  /* The command line. A barcode rings it. "3*1234" rings three. "?" searches. */
  run() {
    const raw = SH_CMD.trim();
    SH_CMD = "";
    if (!raw) return refreshSale();
    if (raw === "?" || raw.startsWith("?")) {
      const q = raw.slice(1).trim();
      if (q) FILTER = q;
      return window.__cls.look();
    }
    let qty = 1, code = raw;
    const m = /^(\d+)\s*[*x]\s*(.+)$/i.exec(raw);
    if (m) { qty = Math.min(999, parseInt(m[1], 10)); code = m[2].trim(); }
    const p = CFG.plus.find(x => x.upc === code)
      || CFG.plus.find(x => x.n.toLowerCase() === code.toLowerCase())
      || CFG.plus.find(x => x.n.toLowerCase().includes(code.toLowerCase()));
    if (!p) { SH_LOG.push({ t: `NO MATCH FOR "${code.toUpperCase()}"`, bad: true }); return refreshSale(); }
    for (let i = 0; i < qty; i++) ring(p);
    SH_LOG.push({ t: `${qty} × ${p.n.toUpperCase()} @ ${money(p.price)}` });
    refreshSale();
  }
};
