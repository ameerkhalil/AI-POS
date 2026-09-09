/* ===========================================================================
   Board and Kiosk.

   The two registers that were too alike are gone. These are different ideas,
   not different arrangements:

     board   several orders open at once, side by side as cards. You tap a
             ticket to make it active and tap products to add to it. Nothing
             else on screen works this way — it's how a deli, a takeaway or a
             repair counter actually runs, with four things on the go.

     kiosk   one screen at a time. Categories fill the display, then products
             fill the display, then a quantity step, then back. No persistent
             panels, no grid and cart together. For a queue and a big screen.
   =========================================================================== */

/* ================================= BOARD ================================= */
let BD = { tickets: [], active: 0, seq: 1 };

function bdInit() {
  if (!BD.tickets.length) BD.tickets = [{ id: "T" + uid(), label: "Ticket 1", lines: [], at: new Date() }];
  if (BD.active >= BD.tickets.length) BD.active = 0;
}
/* The live CART always belongs to the active ticket. Switching parks the one
   you were on and picks up another, so four orders can be genuinely open. */
function bdPark() {
  bdInit();
  BD.tickets[BD.active].lines = CART;
}
function bdLoad(i) {
  bdPark();
  BD.active = i;
  CART = BD.tickets[i].lines;
  SEL = null;
  refreshSale();
}

function drawBoardShell() {
  bdInit();
  BD.tickets[BD.active].lines = CART;
  const items = shKeys(), cats = shDepts(), t = calc();

  const totalOf = lines => {
    const sum = lines.reduce((a, c) => a + c.price * c.q * (1 - (c.disc || 0) / 100), 0);
    return money(sum);
  };

  document.getElementById("vSale").innerHTML = `
    <div class="bd">
      <header class="bd-top">
        <b>${esc(CFG.site.name)}</b>
        <span>${esc(ME ? ME.n : "")}</span>
        <button onclick="__sh.nav()" aria-label="Menu">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      </header>

      <div class="bd-tickets">
        ${BD.tickets.map((tk, i) => {
          const n = tk.lines.reduce((a, c) => a + c.q, 0);
          return `<div class="bd-tk ${i === BD.active ? "on" : ""}" onclick="__bd.pick(${i})">
            <div class="bd-tkh">
              <b>${esc(tk.label)}</b>
              ${BD.tickets.length > 1
                ? `<button onclick="event.stopPropagation();__bd.close(${i})" aria-label="Close">×</button>` : ""}
            </div>
            <div class="bd-tkl">
              ${tk.lines.slice(0, 4).map(c =>
                `<span>${c.q > 1 ? c.q + "× " : ""}${esc(c.n)}</span>`).join("")
                || `<span class="bd-tke">empty</span>`}
              ${tk.lines.length > 4 ? `<span class="bd-tkm">+${tk.lines.length - 4} more</span>` : ""}
            </div>
            <div class="bd-tkf"><span>${n} item${n === 1 ? "" : "s"}</span>
              <b>${totalOf(tk.lines)}</b></div>
          </div>`;
        }).join("")}
        <button class="bd-new" onclick="__bd.add()">
          <span>+</span><em>New ticket</em></button>
      </div>

      <div class="bd-mid">
        <div class="bd-cats">
          ${cats.map((m, i) => `<button class="${i === SH_CAT ? "on" : ""}"
            onclick="__sh.cat(${i})">${esc(m.n)}</button>`).join("")}
        </div>
        <div class="bd-grid">
          ${items.map(({ k, p }, i) => {
            const d = byId(CFG.depts, p.deptId);
            return `<button class="bd-t" onclick="__sh.ring('${p.id}')"
              style="--c:${k.color || d?.color || "#4A5A6B"};animation-delay:${Math.min(i * 16, 240)}ms">
              <span>${esc(k.label || p.n)}</span><em>${money(p.price)}</em></button>`;
          }).join("") || `<div class="bd-empty">Nothing in this section</div>`}
        </div>
      </div>

      <div class="bd-foot">
        <div class="bd-active">
          <span>${esc(BD.tickets[BD.active].label)}</span>
          <b>${money(Math.abs(t.tot))}</b>
        </div>
        <button class="bd-settle" onclick="__sh.pay()" ${CART.length ? "" : "disabled"}>
          Settle this ticket</button>
      </div>
    </div>`;
}

window.__bd = {
  pick(i) { bdLoad(i); },
  add() {
    bdPark();
    BD.seq++;
    BD.tickets.push({ id: "T" + uid(), label: "Ticket " + BD.seq, lines: [], at: new Date() });
    BD.active = BD.tickets.length - 1;
    CART = BD.tickets[BD.active].lines;
    refreshSale();
  },
  close(i) {
    const tk = BD.tickets[i];
    const go = () => {
      BD.tickets.splice(i, 1);
      if (!BD.tickets.length) { BD.seq = 1; bdInit(); }
      BD.active = Math.max(0, Math.min(BD.active, BD.tickets.length - 1));
      CART = BD.tickets[BD.active].lines;
      refreshSale();
    };
    if (!tk.lines.length) return go();
    const el = veil(`<div class="card"><h3>Close ${esc(tk.label)}?</h3>
      <p>It has ${tk.lines.length} item${tk.lines.length === 1 ? "" : "s"} on it that haven't been
        paid for. Closing it throws them away.</p>
      <div class="row"><button class="no" id="bdn">Keep it</button>
        <button class="danger" id="bdy">Throw it away</button></div></div>`);
    el.querySelector("#bdn").onclick = () => el.remove();
    el.querySelector("#bdy").onclick = () => { el.remove(); go(); };
  }
};

/* ================================= KIOSK =================================
   One thing on screen at a time. Categories, then products, then how many.
   No panel is ever visible beside another. */
let KK_STEP = "cats", KK_P = null, KK_Q = 1;

function drawKioskShell() {
  if (KK_STEP === "items") return kkItems();
  if (KK_STEP === "qty") return kkQty();
  if (KK_STEP === "order") return kkOrder();
  kkCats();
}

const kkFrame = (title, back, body, bar) => `
  <div class="kk">
    <header class="kk-top">
      ${back ? `<button class="kk-back" onclick="__kk.back()">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg></button>` : ""}
      <b>${title}</b>
      <button class="kk-mn" onclick="__sh.nav()" aria-label="Menu">···</button>
    </header>
    <div class="kk-body">${body}</div>
    ${bar || ""}
  </div>`;

const kkBar = () => {
  const t = calc(), n = CART.reduce((a, c) => a + c.q, 0);
  if (!n) return "";
  return `<button class="kk-bar" onclick="__kk.order()">
    <span class="kk-bn">${n}</span>
    <span class="kk-bl">See the order</span>
    <span class="kk-bt">${money(Math.abs(t.tot))}</span></button>`;
};

function kkCats() {
  const cats = shDepts();
  document.getElementById("vSale").innerHTML = kkFrame(esc(CFG.site.name), false, `
    <div class="kk-grid cats">
      ${cats.map((m, i) => {
        const d = CFG.depts.find(x => "M" + x.id === m.id);
        return `<button class="kk-cat" onclick="__kk.cat(${i})"
          style="--c:${d?.color || "#3E5C55"};animation-delay:${Math.min(i * 40, 320)}ms">
          <span>${esc(m.n)}</span>
          <em>${m.keys.length} item${m.keys.length === 1 ? "" : "s"}</em></button>`;
      }).join("")}
    </div>`, kkBar());
}

function kkItems() {
  const items = shKeys(), cat = shDepts()[SH_CAT];
  document.getElementById("vSale").innerHTML = kkFrame(esc(cat ? cat.n : ""), true, `
    <div class="kk-grid items">
      ${items.map(({ k, p }, i) => `<button class="kk-item" onclick="__kk.item('${p.id}')"
        style="animation-delay:${Math.min(i * 32, 280)}ms">
        <span>${esc(k.label || p.n)}</span>
        <em>${money(p.price)}</em></button>`).join("")
        || `<div class="kk-empty">Nothing in here</div>`}
    </div>`, kkBar());
}

function kkQty() {
  const p = KK_P;
  document.getElementById("vSale").innerHTML = kkFrame("How many?", true, `
    <div class="kk-qty">
      <div class="kk-qn">${esc(p.n)}</div>
      <div class="kk-qp">${money(p.price)} each</div>
      <div class="kk-stepper">
        <button onclick="__kk.less()" aria-label="Fewer">−</button>
        <b>${KK_Q}</b>
        <button onclick="__kk.more()" aria-label="More">+</button>
      </div>
      <button class="kk-confirm" onclick="__kk.confirm()">
        Add ${KK_Q} · ${money(p.price * KK_Q)}</button>
    </div>`, "");
}

function kkOrder() {
  const t = calc();
  document.getElementById("vSale").innerHTML = kkFrame("The order", true, `
    <div class="kk-lines">
      ${CART.map((c, i) => `<div class="kk-l">
        <span class="kk-lq">${c.q}</span>
        <span class="kk-ln">${esc(c.n)}</span>
        <span class="kk-la">${money(c.price * c.q * (1 - (c.disc || 0) / 100))}</span>
        <button onclick="__kk.drop(${i})" aria-label="Remove">×</button>
      </div>`).join("") || `<div class="kk-empty">Nothing added</div>`}
    </div>
    <div class="kk-sum">
      ${CFG.taxRates.filter(r => r.rate > 0 && Math.abs(t.taxes[r.id] || 0) > 0.001)
        .map(r => `<div><span>${esc(r.n)}</span><b>${money(t.taxes[r.id])}</b></div>`).join("")}
      <div class="tot"><span>Total</span><b>${money(Math.abs(t.tot))}</b></div>
    </div>`, `<button class="kk-pay" onclick="__sh.pay()" ${CART.length ? "" : "disabled"}>
      Pay ${money(Math.abs(t.tot))}</button>`);
}

window.__kk = {
  back() {
    KK_STEP = KK_STEP === "items" ? "cats" : KK_STEP === "qty" ? "items"
      : KK_STEP === "order" ? "cats" : "cats";
    drawKioskShell();
  },
  cat(i) { SH_CAT = i; KK_STEP = "items"; drawKioskShell(); },
  item(id) {
    const p = byId(CFG.plus, id);
    if (!p) return;
    /* Anything with choices still goes through the shared restriction and
       modifier path — this register only changes how quantity is asked. */
    if (p.modIds?.length) return ring(p);
    KK_P = p; KK_Q = 1; KK_STEP = "qty"; drawKioskShell();
  },
  more() { KK_Q = Math.min(99, KK_Q + 1); drawKioskShell(); },
  less() { KK_Q = Math.max(1, KK_Q - 1); drawKioskShell(); },
  confirm() {
    const p = KK_P, q = KK_Q;
    KK_STEP = "items"; KK_P = null; KK_Q = 1;
    for (let i = 0; i < q; i++) ring(p);
  },
  order() { KK_STEP = "order"; drawKioskShell(); },
  drop(i) { CART.splice(i, 1); if (!CART.length) KK_STEP = "cats"; drawKioskShell(); }
};
