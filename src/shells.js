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

/* Every shell draws its own way out. Sharing one top bar across five registers
   is exactly what made them look like one product wearing five coats. */
function shMenuBtn(cls) {
  return `<button class="${cls || ""}" onclick="__sh.nav()" title="Menu">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>`;
}

const shDepts = () => CFG.menus.filter(m => !m.fuel);
const shKeys = () => {
  const m = shDepts()[SH_CAT];
  return m ? m.keys.map(k => ({ k, p: byId(CFG.plus, k.pluId) })).filter(x => x.p) : [];
};
const shCount = () => CART.reduce((a, c) => a + c.q, 0);

/* ------------------------- shared interactions ------------------------- */
window.__sh = {
  /* One way out, drawn in whatever style the shell is wearing. */
  nav() {
    const el = veil(`<div class="card"><h3>${esc(CFG.site.name)}</h3>
      <p>Signed in as ${esc(ME ? ME.n : "")} · Register ${esc(CFG.site.register)}</p>
      <div class="opts" style="flex-direction:column;margin-top:16px">
        <button data-g="office" style="width:100%">Office — shift, cash, tasks</button>
        <button data-g="reports" style="width:100%">Reports</button>
        <button data-g="config" style="width:100%">Settings</button>
        <button data-g="ret" style="width:100%">${RETURN ? "Leave return mode" : "Start a return"}</button>
        <button data-g="lock" style="width:100%">Lock the register</button>
      </div>
      <div class="row"><button class="no" id="shx">Back to the sale</button></div></div>`);
    el.querySelector("#shx").onclick = () => el.remove();
    el.querySelectorAll("[data-g]").forEach(b => b.onclick = () => {
      const g = b.dataset.g; el.remove();
      if (g === "ret") return toggleReturn();
      if (g === "lock") return lock();
      go(g);
    });
  },
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
