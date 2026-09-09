/* ===========================================================================
   The Classic register.

   Not a rearrangement of the tile-and-cart layout — a different machine. There
   is no product grid. A cashier types a price and presses a department, or
   scans, and the item posts. The sale runs up a paper tape and a line display
   shows the last item and the total in large characters readable from across
   the counter.

   This is what a Verifone, an NCR or a Sam4s looks like, and it is what most
   convenience, liquor and hardware counters have actually used for thirty
   years. It's faster than browsing when the person behind the till knows the
   shop, and a scanner does most of the work anyway.

   Everything underneath is shared: the same CART, the same calc(), the same
   tender path, the same restrictions. Only the surface differs.
   =========================================================================== */

let CLS_ENTRY = "", CLS_QTY = null, CLS_MSG = "";

const clsAmount = () => (parseInt(CLS_ENTRY || "0", 10) || 0) / 100;
const clsShown = () => clsAmount().toFixed(2);

function drawClassic() {
  const t = calc();
  const depts = CFG.depts.filter(d => !d.fuel).slice(0, 12);
  const last = CART[CART.length - 1];
  const lines = CART.length;

  document.getElementById("vSale").innerHTML = `
    <div class="cls">
      <div class="cls-top">
        <div class="cls-vfd">
          <div class="cls-vline">
            <span class="cls-vn">${lines
              ? esc((last.q > 1 ? last.q + " × " : "") + last.n)
              : (CLS_MSG ? esc(CLS_MSG) : RETURN ? "RETURN MODE" : "READY")}</span>
            <span class="cls-va num">${lines
              ? money(last.price * last.q * (1 - (last.disc || 0) / 100))
              : ""}</span>
          </div>
          <div class="cls-vtot">
            <span>${RETURN ? "REFUND" : "TOTAL"}</span>
            <b class="num">${money(Math.abs(t.tot))}</b>
          </div>
        </div>

        <div class="cls-entry">
          <div class="cls-elabel">${CLS_QTY ? `QTY ${CLS_QTY} ×` : "AMOUNT"}</div>
          <div class="cls-eval num">${clsShown()}</div>
          <div class="cls-ehint">${CLS_ENTRY
            ? "Now press a department key"
            : "Type an amount, scan an item, or use Look up"}</div>
        </div>
      </div>

      <div class="cls-body">
        <div class="cls-tape">
          <div class="cls-th">
            <b>${esc(CFG.site.name)}</b>
            <span>${lines} item${lines === 1 ? "" : "s"} · ${esc(ME ? ME.n : "")}</span>
          </div>
          <div class="cls-roll" id="clsRoll">${
            lines ? CART.map((c, i) => {
              const eff = c.price * c.q * (1 - (c.disc || 0) / 100);
              const d = byId(CFG.depts, c.deptId);
              return `<div class="cls-line ${SEL === i ? "on" : ""}" onclick="__cls.sel(${i})">
                <span class="cls-lq">${c.q > 1 ? c.q : ""}</span>
                <span class="cls-ln">${esc(c.n)}
                  ${c.note || d ? `<em>${esc(c.note || d.n)}</em>` : ""}</span>
                <span class="cls-la num">${RETURN ? "−" : ""}${money(eff)}</span>
              </div>`;
            }).join("")
              : `<div class="cls-empty">No sale in progress</div>`}
          </div>
          <div class="cls-sums">
            <div><span>Subtotal</span><b class="num">${money(t.sub)}</b></div>
            ${Math.abs(t.promoOff) > 0.001
              ? `<div class="disc"><span>Deals</span><b class="num">−${money(Math.abs(t.promoOff))}</b></div>` : ""}
            ${DISC ? `<div class="disc"><span>Discount</span><b class="num">−${money(Math.abs(t.disc))}</b></div>` : ""}
            ${CFG.taxRates.filter(r => r.rate > 0 && Math.abs(t.taxes[r.id] || 0) > 0.001).map(r =>
              `<div><span>${esc(r.n)} ${r.rate}%</span><b class="num">${money(t.taxes[r.id] || 0)}</b></div>`).join("")}
          </div>
        </div>

        <div class="cls-console">
          <div class="cls-depts">
            ${depts.map((d, i) => `<button class="cls-dk" onclick="__cls.dept('${d.id}')"
              style="--dc:${d.color || "#3E464A"}">
              <span class="cls-dn">${esc(d.n)}</span>
              <span class="cls-di">${i + 1}</span></button>`).join("")}
          </div>

          <div class="cls-pad">
            ${["7","8","9","4","5","6","1","2","3","00","0","."].map(k =>
              `<button class="cls-nk" onclick="__cls.key('${k}')">${k}</button>`).join("")}
            <button class="cls-nk wide clr" onclick="__cls.key('C')">Clear</button>
            <button class="cls-nk qty" onclick="__cls.qty()">Qty ×</button>
          </div>

          <div class="cls-fn">
            <button onclick="__cls.look()"><b>Look up</b><em>find a price</em></button>
            <button onclick="__cls.voidLine()"><b>Void</b><em>remove a line</em></button>
            <button onclick="__cls.disc()"><b>Discount</b><em>on the sale</em></button>
            <button onclick="__cls.more()"><b>Menu</b><em>returns, drawer, reports</em></button>
          </div>

          <div class="cls-tenders">
            ${CFG.mops.map(m => `<button class="cls-tender ${m.kind === "cash" ? "cash" : ""}"
              data-m="${m.id}" onclick="__cls.tender('${m.id}')"
              ${CART.length ? "" : "disabled"}>${esc(m.n)}</button>`).join("")}
          </div>
        </div>
      </div>
    </div>`;

  const roll = document.getElementById("clsRoll");
  if (roll) roll.scrollTop = roll.scrollHeight;
}

window.__cls = {
  key(k) {
    if (k === "C") { CLS_ENTRY = ""; CLS_QTY = null; CLS_MSG = ""; return drawClassic(); }
    if (k === ".") return;                              // cents are implied
    CLS_ENTRY = (CLS_ENTRY + (k === "00" ? "00" : k)).replace(/^0+(?=\d)/, "").slice(0, 7);
    CLS_MSG = "";
    drawClassic();
  },
  /* Type a number, press Qty, then the price and a department — the way every
     register has worked since keys had springs under them. */
  qty() {
    const n = parseInt(CLS_ENTRY || "0", 10);
    if (n > 0) { CLS_QTY = Math.min(999, Math.round(n / 100) || n); CLS_ENTRY = ""; }
    else CLS_QTY = null;
    drawClassic();
  },
  dept(id) {
    const d = byId(CFG.depts, id);
    const v = clsAmount();
    if (!(v > 0)) { CLS_MSG = "TYPE AN AMOUNT FIRST"; return drawClassic(); }
    const q = CLS_QTY || 1;
    CART.push({ lid: uid(), n: d.n, price: v, q, deptId: d.id, taxId: d.taxId, disc: 0, open: true });
    CLS_ENTRY = ""; CLS_QTY = null; CLS_MSG = "";
    SEL = null;
    refreshSale();
  },
  sel(i) { SEL = SEL === i ? null : i; drawClassic(); },
  voidLine() {
    if (SEL == null || !CART[SEL]) { CLS_MSG = "PICK A LINE FIRST"; return drawClassic(); }
    auth("void", "Void a line", () => reasonPrompt("void", "Why is this being voided", r => {
      SHIFT.exceptions.push({ at: new Date(), by: ME.n, what: "Void " + CART[SEL].n, reason: r?.n });
      CART.splice(SEL, 1); SEL = null; refreshSale();
    }));
  },
  disc() { if (CART.length) discPrompt(); },
  look() {
    const el = veil(`<div class="card tall"><h3>Look up a price</h3>
      <p>Search the pricebook. Picking one rings it at its own price and department.</p>
      <input id="lkq" class="big" style="text-align:left;font-size:17px" placeholder="Name or barcode">
      <div class="edwrap" style="max-height:46vh"><div id="lkr"></div></div>
      <div class="row"><button class="no" id="lkn">Close</button></div></div>`);
    const inp = el.querySelector("#lkq"), out = el.querySelector("#lkr");
    const run = () => {
      const q = inp.value.trim().toLowerCase();
      const hits = !q ? CFG.plus.slice(0, 40)
        : CFG.plus.filter(p => p.n.toLowerCase().includes(q) || (p.upc || "").includes(q)).slice(0, 40);
      out.innerHTML = hits.length ? hits.map(p => {
        const d = byId(CFG.depts, p.deptId);
        return `<button class="lkrow" data-p="${p.id}">
          <span class="lkn">${esc(p.n)}<em>${esc(d ? d.n : "")}</em></span>
          <span class="num">${money(p.price)}</span></button>`;
      }).join("") : `<p style="color:var(--txt-3);font-size:13px;padding:12px">Nothing matches.</p>`;
      out.querySelectorAll("[data-p]").forEach(b => b.onclick = () => {
        el.remove(); ring(byId(CFG.plus, b.dataset.p));
      });
    };
    inp.oninput = run; run(); inp.focus();
    el.querySelector("#lkn").onclick = () => el.remove();
  },
  more() { openMenu(); },
  tender(id) { const m = byId(CFG.mops, id); if (m && CART.length) tender(m); }
};

/* The keypad answers the physical number keys too, because on a real counter
   nobody is aiming a mouse at a 3. */
function clsKeyboard(e) {
  if (THEME.shell !== "classic") return;
  if (document.querySelector(".veil")) return;
  if (/^[0-9]$/.test(e.key)) { window.__cls.key(e.key); e.preventDefault(); }
  else if (e.key === "Escape") { window.__cls.key("C"); }
  else if (e.key === "Backspace") {
    CLS_ENTRY = CLS_ENTRY.slice(0, -1); drawClassic(); e.preventDefault();
  }
}
