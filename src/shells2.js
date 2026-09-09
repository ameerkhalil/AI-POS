/* ===========================================================================
   Retail, Commerce and Counter.

   Three more registers, each following the conventions of a different corner of
   the market so a cashier who has used one before recognises the shape of it.

     retail     coloured tile library on the left, basket held on the right,
                one large charge button. White and blue.
     commerce   search-led, products as a list with thumbnails, a cart panel
                that totals like a web checkout. White and green.
     counter    round category buttons across the top, soft tile grid, a wide
                pay bar pinned along the bottom.
   =========================================================================== */

/* ------------------------------- RETAIL ------------------------------- */
function drawRetailShell() {
  const t = calc(), items = shKeys(), cats = shDepts();
  document.getElementById("vSale").innerHTML = `
    <div class="rt">
      <header class="rt-top">
        <div class="rt-brand">
          ${CFG.site.logo ? `<img src="${esc(CFG.site.logo)}" alt="">` : ""}
          <b>${esc(CFG.site.name)}</b>
        </div>
        <div class="rt-search">
          <input id="rtQ" placeholder="Search library" autocomplete="off" value="${esc(FILTER)}">
        </div>
        <button class="rt-more" onclick="__sh.nav()" aria-label="Menu">···</button>
      </header>
      <div class="rt-body">
        <div class="rt-left">
          <div class="rt-tabs">
            ${cats.map((m, i) => `<button class="${i === SH_CAT ? "on" : ""}"
              onclick="__sh.cat(${i})">${esc(m.n)}</button>`).join("")}
          </div>
          <div class="rt-grid">
            ${items.map(({ k, p }, i) => {
              const d = byId(CFG.depts, p.deptId);
              return `<button class="rt-t" onclick="__sh.ring('${p.id}')"
                style="--c:${k.color || d?.color || "#006AFF"};animation-delay:${Math.min(i * 18, 260)}ms">
                <span class="rt-n">${esc(k.label || p.n)}</span>
                <span class="rt-p">${money(p.price)}</span>
              </button>`;
            }).join("") || `<div class="rt-empty">Nothing in this section</div>`}
          </div>
        </div>
        <aside class="rt-cart">
          <div class="rt-ch">Current sale</div>
          <div class="rt-lines">
            ${CART.map((c, i) => `<div class="rt-l">
              <div class="rt-ln"><b>${esc(c.n)}</b>
                ${c.mods?.length ? `<em>${esc(c.mods.join(", "))}</em>` : ""}
                <span class="rt-lq">${c.q} × ${money(c.price)}</span></div>
              <div class="rt-lr">
                <span class="rt-la">${money(c.price * c.q * (1 - (c.disc || 0) / 100))}</span>
                <button onclick="__sh.drop(${i})" aria-label="Remove">×</button>
              </div>
            </div>`).join("") || `<div class="rt-none">Add an item to start a sale</div>`}
          </div>
          <div class="rt-sums">
            <div><span>Subtotal</span><b>${money(t.sub)}</b></div>
            ${CFG.taxRates.filter(r => r.rate > 0 && Math.abs(t.taxes[r.id] || 0) > 0.001)
              .map(r => `<div><span>${esc(r.n)}</span><b>${money(t.taxes[r.id])}</b></div>`).join("")}
          </div>
          <button class="rt-charge" onclick="__sh.pay()" ${CART.length ? "" : "disabled"}>
            Charge ${money(Math.abs(t.tot))}
          </button>
        </aside>
      </div>
    </div>`;
  const q = document.getElementById("rtQ");
  if (q) q.oninput = e => { FILTER = e.target.value; drawRetailShell(); };
}

/* ------------------------------ COMMERCE ------------------------------ */
function drawCommerceShell() {
  const t = calc(), cats = shDepts();
  const q = FILTER.trim().toLowerCase();
  const pool = q
    ? CFG.plus.filter(p => p.n.toLowerCase().includes(q) || (p.upc || "").includes(q))
    : shKeys().map(x => x.p);
  document.getElementById("vSale").innerHTML = `
    <div class="cm">
      <aside class="cm-nav">
        <div class="cm-brand">
          ${CFG.site.logo ? `<img src="${esc(CFG.site.logo)}" alt="">` : `<i></i>`}
          <b>${esc(CFG.site.name)}</b>
        </div>
        <button class="cm-nb on">Sell</button>
        <button class="cm-nb" onclick="go('office')">Office</button>
        <button class="cm-nb" onclick="go('reports')">Reports</button>
        <button class="cm-nb" onclick="go('config')">Settings</button>
        <div class="cm-navfoot">${esc(ME ? ME.n : "")}</div>
      </aside>
      <main class="cm-main">
        <div class="cm-searchbar">
          <input id="cmQ" placeholder="Search products or scan a barcode" autocomplete="off"
            value="${esc(FILTER)}">
        </div>
        <div class="cm-cats">
          ${cats.map((m, i) => `<button class="${i === SH_CAT && !q ? "on" : ""}"
            onclick="__sh.cat(${i})">${esc(m.n)}</button>`).join("")}
        </div>
        <div class="cm-list">
          ${pool.slice(0, 60).map((p, i) => {
            const d = byId(CFG.depts, p.deptId);
            return `<button class="cm-row" onclick="__sh.ring('${p.id}')"
              style="animation-delay:${Math.min(i * 14, 220)}ms">
              <span class="cm-thumb" style="background:${d?.color || "#008060"}">
                ${esc((p.n || "?").trim()[0] || "?")}</span>
              <span class="cm-info"><b>${esc(p.n)}</b>
                <em>${esc(d ? d.n : "")}${p.upc ? " · " + esc(p.upc) : ""}</em></span>
              <span class="cm-price">${money(p.price)}</span>
              <span class="cm-addbtn">Add</span>
            </button>`;
          }).join("") || `<div class="cm-empty">Nothing matches</div>`}
        </div>
      </main>
      <aside class="cm-cart">
        <div class="cm-ch"><b>Cart</b><span>${CART.reduce((a, c) => a + c.q, 0)} items</span></div>
        <div class="cm-lines">
          ${CART.map((c, i) => `<div class="cm-cl">
            <div class="cm-cn"><b>${esc(c.n)}</b>
              <em>${c.q} × ${money(c.price)}</em></div>
            <span class="cm-ca">${money(c.price * c.q * (1 - (c.disc || 0) / 100))}</span>
            <button onclick="__sh.drop(${i})" aria-label="Remove">×</button>
          </div>`).join("") || `<div class="cm-none">Your cart is empty</div>`}
        </div>
        <div class="cm-sums">
          <div><span>Subtotal</span><b>${money(t.sub)}</b></div>
          ${Math.abs(t.promoOff) > 0.001
            ? `<div class="disc"><span>Discounts</span><b>−${money(Math.abs(t.promoOff))}</b></div>` : ""}
          ${CFG.taxRates.filter(r => r.rate > 0 && Math.abs(t.taxes[r.id] || 0) > 0.001)
            .map(r => `<div><span>${esc(r.n)}</span><b>${money(t.taxes[r.id])}</b></div>`).join("")}
          <div class="tot"><span>Total</span><b>${money(Math.abs(t.tot))}</b></div>
        </div>
        <button class="cm-checkout" onclick="__sh.pay()" ${CART.length ? "" : "disabled"}>
          Checkout</button>
      </aside>
    </div>`;
  const s = document.getElementById("cmQ");
  if (s) s.oninput = e => { FILTER = e.target.value; drawCommerceShell(); };
}

/* ------------------------------- COUNTER ------------------------------- */
function drawCounterShell() {
  const t = calc(), items = shKeys(), cats = shDepts();
  document.getElementById("vSale").innerHTML = `
    <div class="cn">
      <header class="cn-top">
        <button class="cn-mn" onclick="__sh.nav()" aria-label="Menu">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
        <b>${esc(CFG.site.name)}</b>
        <span>${esc(ME ? ME.n : "")}</span>
      </header>
      <div class="cn-cats">
        ${cats.map((m, i) => {
          const d = CFG.depts.find(x => "M" + x.id === m.id);
          return `<button class="${i === SH_CAT ? "on" : ""}" onclick="__sh.cat(${i})">
            <span class="cn-circle" style="background:${d?.color || "#00A05A"}">
              ${esc(m.n.trim()[0] || "?")}</span>
            <em>${esc(m.n)}</em></button>`;
        }).join("")}
      </div>
      <div class="cn-body">
        <div class="cn-grid">
          ${items.map(({ k, p }, i) => `<button class="cn-t" onclick="__sh.ring('${p.id}')"
            style="animation-delay:${Math.min(i * 18, 260)}ms">
            <span class="cn-n">${esc(k.label || p.n)}</span>
            <span class="cn-p">${money(p.price)}</span>
          </button>`).join("") || `<div class="cn-empty">Nothing here yet</div>`}
        </div>
        <aside class="cn-tick">
          <div class="cn-th">Order</div>
          <div class="cn-lines">
            ${CART.map((c, i) => `<div class="cn-l">
              <span class="cn-lq">${c.q}</span>
              <span class="cn-ln">${esc(c.n)}</span>
              <span class="cn-la">${money(c.price * c.q * (1 - (c.disc || 0) / 100))}</span>
              <button onclick="__sh.drop(${i})" aria-label="Remove">×</button>
            </div>`).join("") || `<div class="cn-none">Tap an item</div>`}
          </div>
        </aside>
      </div>
      <div class="cn-pay">
        <div class="cn-total"><span>Total</span><b>${money(Math.abs(t.tot))}</b></div>
        <button class="cn-btn" onclick="__sh.pay()" ${CART.length ? "" : "disabled"}>Pay</button>
      </div>
    </div>`;
}

/* A payment picker in each register's own manner, rather than one shared modal. */
window.__sh.pay = function () {
  if (!CART.length) return;
  const t = calc(), style = THEME.shell;
  const el = veil(`<div class="card paysheet ${style}">
    <h3>${style === "commerce" ? "Checkout" : "Take payment"}</h3>
    <div class="pay-due"><span>Due</span><b>${money(Math.abs(t.tot))}</b></div>
    <div class="pay-grid">
      ${CFG.mops.map(m => `<button data-m="${m.id}" class="${m.kind}">
        <b>${esc(m.n)}</b><em>${m.kind === "cash" ? "Opens the drawer"
          : m.kind === "gift" ? "Scan the card" : m.kind === "ebt" ? "Eligible items"
          : "Reader takes it"}</em></button>`).join("")}
    </div>
    <div class="row"><button class="no" id="payx">Back</button></div></div>`);
  el.querySelector("#payx").onclick = () => el.remove();
  el.querySelectorAll("[data-m]").forEach(b => b.onclick = () => {
    const m = byId(CFG.mops, b.dataset.m);
    el.remove();
    if (m) tender(m);
  });
};
