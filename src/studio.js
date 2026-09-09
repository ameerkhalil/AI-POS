/* ===========================================================================
   Choosing a register.

   This used to be a builder — drag the keys, move the panels, set a radius.
   It produced a lot of mediocre registers and a lot of confusion. Eight
   designed ones, each drawn as a whole and each properly different, is a better
   answer: nobody has to have taste in interface design to end up with one that
   works.

   Keys can still be rearranged afterwards, in the menu designer, by anyone who
   wants to. It just isn't the first thing asked of somebody setting up a shop.
   =========================================================================== */

let PICK = null;

function openStudio() {
  document.getElementById("setup").classList.add("hide");
  document.getElementById("building").style.display = "none";
  const el = document.getElementById("studio");
  el.classList.add("on");
  PICK = CFG.layout || "counter";
  applyRegister(PICK);
  drawStudio();
}

function drawStudio() {
  const L = LAYOUTS.find(x => x.k === PICK) || LAYOUTS[0];
  window.__st = {
    pick: k => { PICK = k; applyRegister(k); drawStudio(); },
    launch: launchPOS
  };

  document.getElementById("studio").innerHTML = `
    <div class="pkwrap">
      <header class="pkhead">
        <div>
          <div class="pkkick">Last step</div>
          <h1>Pick your register</h1>
          <p>Eight of them, each designed as a whole — different type, different colour, different
            arrangement. Every one is finished and tested. You can change it whenever you like, and
            rearrange the keys yourself later under Menu designer.</p>
        </div>
        <button class="launch" onclick="__st.launch()">
          <span>Open ${esc(CFG.site.name)}</span>
          <svg viewBox="0 0 20 20"><path d="M3 10h13M11 5l5 5-5 5" stroke="currentColor"
            stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </header>

      <div class="pkbody">
        <div class="pklist">${LAYOUTS.map(l => `
          <button class="pkcard ${l.k === PICK ? "on" : ""}" onclick="__st.pick('${l.k}')">
            <span class="pkswatch" style="background:${l.bg};border-color:${l.line}">
              ${l.nav === "top"
                ? `<i class="nv top" style="background:${l.panel}"></i>`
                : `<i class="nv side" style="background:${l.panel}"></i>`}
              <i class="tp ${l.tape}" style="background:${l.panel};border-color:${l.line}"></i>
              <span class="kys ${l.keyStyle} ${l.nav} ${l.tape}">
                ${[1,2,3,4].map(() => `<i style="background:${l.key};
                  border-radius:${Math.min(l.radius, 7)}px;
                  ${l.keyStyle === "card" ? `border-top:2px solid ${l.accent}` : ""}"></i>`).join("")}
              </span>
              <i class="ac" style="background:${l.accent}"></i>
            </span>
            <span class="pkmeta">
              <b style="font-family:'${l.font}',Archivo,sans-serif">${esc(l.n)}</b>
              <em>${esc(l.tag)}</em>
            </span>
          </button>`).join("")}
        </div>

        <div class="pkstage">
          <div class="pkshot" id="pkShot"></div>
          <div class="pkwhy">
            <b style="font-family:'${L.font}',Archivo,sans-serif">${esc(L.n)}</b>
            <p>${esc(L.why)}</p>
            <div class="pkfacts">
              <span><em>Type</em>${esc(L.font)}</span>
              <span><em>Products as</em>${({tile:"tiles",pad:"pads",list:"rows",card:"cards"})[L.keyStyle]}</span>
              <span><em>Menu</em>${L.nav === "top" ? "across the top" : "down the side"}</span>
              <span><em>Order</em>${L.tape === "bottom" ? "along the bottom" : "on the " + L.tape}</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  drawShot(L);
}

/* A real register at about half size, with this store's own products in it. */
function drawShot(L) {
  const el = document.getElementById("pkShot");
  if (!el) return;
  const menus = CFG.menus.filter(m => !m.fuel);
  const menu = menus[0];
  const keys = (menu ? menu.keys : []).slice(0, L.keyStyle === "list" ? 7 : 6);
  const cols = L.keyStyle === "list" ? 1 : L.keyMin > 210 ? 2 : 3;
  const F = `'${L.font}',Archivo,sans-serif`, M = `'${L.mono}',monospace`;

  const key = k => {
    const p = byId(CFG.plus, k.pluId);
    const d = p ? byId(CFG.depts, p.deptId) : null;
    const col = k.color || d?.color || L.key;
    const nm = esc(k.label || p?.n || "Product"), pr = p ? money(p.price) : "0.00";
    if (L.keyStyle === "list") return `<div class="q list" style="border-color:${L.line};color:${L.mode==="light"?"#14181A":"#E6E9EA"}">
      <i style="background:${col}"></i><b style="font-family:${F}">${nm}</b>
      <s style="font-family:${M}">${pr}</s></div>`;
    if (L.keyStyle === "card") return `<div class="q card" style="background:${L.panel};border-color:${L.line};
      border-radius:${L.radius}px;color:${L.mode==="light"?"#14181A":"#E6E9EA"}">
      <u style="background:${col}"></u>
      <b style="font-family:${F}">${nm}</b>
      <span style="border-color:${L.line}"><s style="font-family:${M}">${pr}</s>
      <em style="color:${L.accent};border-color:${L.accent}55">Add</em></span></div>`;
    return `<div class="q ${L.keyStyle}" style="background:${col};border-radius:${L.radius}px">
      <b style="font-family:${F}">${nm}</b><s style="font-family:${M}">${pr}</s></div>`;
  };

  const nav = `<div class="qnav ${L.nav}" style="background:${L.panel};border-color:${L.line}">
    ${["Sale","Office","Reports","Config"].map((n,i)=>
      `<span style="font-family:${F};color:${i?(L.mode==="light"?"#6C7679":"#7C868A"):L.accent};
        background:${i?"transparent":L.accent+"1A"}">${n}</span>`).join("")}</div>`;

  const secs = `<div class="qsec ${L.depts}">${menus.slice(0,5).map((m,i)=>
    `<span style="font-family:${F};color:${i?(L.mode==="light"?"#6C7679":"#7C868A"):(L.mode==="light"?"#14181A":"#E6E9EA")};
      border-${L.depts==="rail"?"left":"bottom"}:2px solid ${i?"transparent":L.accent}">${esc(m.n)}</span>`).join("")}</div>`;

  const first = CFG.plus[0], second = CFG.plus[1];
  const tot = money((first?.price||0)+(second?.price||0));
  const tape = `<div class="qtape ${L.tapeStyle}" style="background:${L.tapeStyle==="receipt"?L.panel:L.bg};
    border-color:${L.line};color:${L.mode==="light"?"#14181A":"#E6E9EA"}">
    <div class="qth" style="font-family:${F};border-color:${L.line}">Current sale</div>
    ${[first,second].filter(Boolean).map(p=>`<div class="qtl" style="border-color:${L.line}">
      <span style="font-family:${F}">${esc(p.n)}</span>
      <span style="font-family:${M}">${money(p.price)}</span></div>`).join("")}
    <div class="qtt" style="border-color:${L.line}">
      <span style="font-family:${F}">Total</span>
      <b style="font-family:${M};color:${L.accent}">${tot}</b></div>
    <div class="qtp"><span style="border-color:${L.accent};color:${L.accent};font-family:${F}">Cash</span>
      <span style="border-color:${L.line};font-family:${F}">Card</span></div></div>`;

  const board = `<div class="qboard">
    ${L.search?`<div class="qsrch" style="background:${L.panel};border-color:${L.line};
      font-family:${F};color:${L.mode==="light"?"#8A9298":"#6C7679"}">Search the pricebook, or scan a barcode</div>`:""}
    ${L.depts==="rail"
      ? `<div class="qrail">${secs}<div class="qkeys" style="grid-template-columns:repeat(${cols},1fr)">
           ${keys.map(key).join("")}</div></div>`
      : secs+`<div class="qkeys" style="grid-template-columns:repeat(${cols},1fr)">${keys.map(key).join("")}</div>`}
    ${L.fkeys?`<div class="qfk" style="border-color:${L.line}">${
      ["Price check","Void","Discount","No sale","Suspend","Return"].map(f=>
      `<span style="border-color:${L.line};font-family:${F};
        color:${L.mode==="light"?"#8A9298":"#6C7679"}">${f}</span>`).join("")}</div>`:""}
  </div>`;

  el.innerHTML = `<div class="qmock" style="background:${L.bg};border-color:${L.line}">
    <div class="qbar" style="background:${L.mode==="light"?L.key:"#0E1113"};border-color:${L.line}">
      ${CFG.site.logo?`<img src="${esc(CFG.site.logo)}" alt="">`
        :`<i style="background:${L.accent}"></i>`}
      <b style="font-family:${F};color:${L.mode==="light"?"#14181A":"#E6E9EA"}">${esc(CFG.site.name)}</b>
      <em style="font-family:${F};color:${L.mode==="light"?"#8A9298":"#6C7679"}">Reg 1 · Store 001</em>
    </div>
    ${L.nav==="top"?nav:""}
    <div class="qbody ${L.tape} ${L.nav}">
      ${L.nav==="rail"?nav:""}
      ${L.tape==="left"?tape+board:board+tape}
    </div>
  </div>`;
}

/* ---------------------------- pre-flight ----------------------------
   Before the register opens for real, check the things that would embarrass it
   on the first sale: no tax rate, no cash tender, a product with no department,
   two staff sharing a code. Blocking problems stop the launch. Everything else
   is shown and can be waved through. */
function preflight() {
  const out = [];
  const add = (label, ok, detail, blocking) => out.push({ label, ok, detail, blocking });

  add("Products in the pricebook", CFG.plus.length > 0,
    CFG.plus.length ? `${CFG.plus.length} ready to ring` : "Nothing to sell yet — import or add some", false);

  const orphan = CFG.plus.filter(p => !byId(CFG.depts, p.deptId)).length;
  add("Every product has a department", orphan === 0,
    orphan ? `${orphan} would ring with no tax rate` : "Tax and reporting will be right", true);

  const noTax = CFG.depts.filter(d => !byId(CFG.taxRates, d.taxId)).length;
  add("Every department has a tax rate", noTax === 0,
    noTax ? `${noTax} department${noTax === 1 ? "" : "s"} would ring untaxed` : "All mapped", true);

  const anyTax = CFG.taxRates.some(r => r.rate > 0);
  add("Sales tax is set", anyTax,
    anyTax ? (CFG.tax?.confirmed ? "Confirmed against the state" : "Not yet confirmed — check it under Site & tax")
      : "Every rate is zero, so nothing will be taxed", false);

  const cash = CFG.mops.some(m => m.kind === "cash");
  add("A cash tender exists", cash, cash ? "The drawer can be balanced" : "No way to take or count cash", true);

  const pins = CFG.employees.map(e => e.pin);
  const dupes = pins.length !== new Set(pins).size;
  const mgr = CFG.employees.some(e => byId(CFG.groups, e.groupId)?.perms.includes("config"));
  add("Staff can sign in", !dupes && mgr && CFG.employees.length > 0,
    dupes ? "Two people share a code" : !mgr ? "Nobody can reach configuration"
      : `${CFG.employees.length} ${CFG.employees.length === 1 ? "person" : "people"}, each with their own code`,
    dupes || !mgr);

  const dead = CFG.menus.reduce((n, m) => n + m.keys.filter(k => k.pluId && !byId(CFG.plus, k.pluId)).length, 0);
  add("Keys point at real products", dead === 0,
    dead ? `${dead} would render blank` : "Nothing dangling", false);

  const onBoard = CFG.menus.reduce((n, m) => n + m.keys.length, 0);
  add("Something is on the board", onBoard > 0,
    onBoard ? `${onBoard} keys across ${CFG.menus.length} menus` : "The register would open empty", false);

  return out;
}

function launchPOS() {
  const checks = preflight();
  const blockers = checks.filter(c => !c.ok && c.blocking);
  const warns = checks.filter(c => !c.ok && !c.blocking);

  const el = document.createElement("div");
  el.className = "veil pf";
  el.innerHTML = `<div class="card tall pfcard">
    <h3>${blockers.length ? "Two things to fix first" : "Ready to open"}</h3>
    <p>${blockers.length
      ? "The register won't behave correctly until these are sorted. Everything else can wait."
      : warns.length
      ? "Nothing is broken. A couple of things are worth knowing before you take a real sale."
      : "Everything checks out. Your register is ready to open."}</p>
    <div class="pflist">${checks.map((c, i) => `
      <div class="pfrow ${c.ok ? "ok" : c.blocking ? "bad" : "warn"}" style="animation-delay:${i * 55}ms">
        <span class="pfm">${c.ok ? "\u2713" : c.blocking ? "\u00d7" : "!"}</span>
        <span><b>${esc(c.label)}</b><em>${esc(c.detail)}</em></span></div>`).join("")}</div>
    <div class="row">
      <button class="no" id="pfBack">Keep editing</button>
      ${blockers.length ? "" : `<button class="ok" id="pfGo">Open the register</button>`}
    </div>
  </div>`;
  document.body.appendChild(el);
  el.onclick = e => { if (e.target === el) el.remove(); };
  el.querySelector("#pfBack").onclick = () => el.remove();
  const go = el.querySelector("#pfGo");
  if (go) go.onclick = () => { el.remove(); runLaunch(); };
}

/* ---------------------------- the handover ----------------------------

   Seven beats, about six seconds. Long enough to feel like the machine is
   genuinely coming up rather than a screen being swapped — a boot sequence,
   which is what it is.

     0.0  the tools clear out
     0.4  the keys fire off one at a time
     1.3  the register tilts and flies past
     1.9  white-out in the store's own colour
     2.2  the store name lands
     2.8  the checks tick past, one by one
     5.0  the real register assembles behind it
*/
function runLaunch() {
  const studio = document.getElementById("studio");
  const mock = studio.querySelector(".qmock");
  if (!mock) return boot();

  if (typeof saveNow === "function") saveNow();
  if (typeof contributePattern === "function") contributePattern();

  const accent = CFG.theme.accent;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const steps = [
    `${CFG.plus.length} products loaded`,
    `${CFG.depts.length} departments mapped`,
    `${CFG.taxRates.filter(r => r.rate > 0).length || "No"} tax rate${
      CFG.taxRates.filter(r => r.rate > 0).length === 1 ? "" : "s"} applied`,
    `${CFG.employees.length} ${CFG.employees.length === 1 ? "person" : "people"} on the register`,
    `${Object.values(CFG.modules || {}).filter(m => m.on).length} modules enabled`,
    `Offline queue ready`,
    `Signed in as ${(CFG.employees[0] || {}).n || "manager"}`,
    `Open for business`
  ];

  const veil = document.createElement("div");
  veil.className = "lv";
  veil.style.setProperty("--a", accent);
  /* A plate, not a flat wash. The mark, the name, the line under it, then the
     machine reporting what it loaded. It's the first thing they'll show someone. */
  veil.innerHTML = `
    <div class="lv-bg"></div>
    <div class="lv-glow"></div>
    <div class="lv-rays">${Array.from({ length: 16 }, (_, i) =>
      `<i style="transform:rotate(${i * 22.5}deg)"></i>`).join("")}</div>
    <div class="lv-plate">
      <div class="lv-ring"></div>
      <div class="lv-ring two"></div>
      <div class="lv-mark">${CFG.site.logo
        ? `<img src="${esc(CFG.site.logo)}" alt="">`
        : `<span class="lv-initial">${esc((CFG.site.name || "?").trim()[0] || "?")}</span>`}</div>
      <b class="lv-title">${esc(CFG.site.name)}</b>
      ${CFG.site.slogan ? `<em class="lv-slogan">${esc(CFG.site.slogan)}</em>` : ""}
      <div class="lv-rule"></div>
      <div class="lv-steps">${steps.map((t, i) =>
        `<span style="animation-delay:${2700 + i * 240}ms"><i></i>${esc(t)}</span>`).join("")}</div>
      <div class="lv-foot">Register 1 &middot; Store ${esc(CFG.site.store || "001")}</div>
    </div>`;
  document.body.appendChild(veil);

  if (reduce) {
    AUTO_IN = true;
    studio.classList.remove("on"); studio.innerHTML = "";
    boot(); veil.remove(); return;
  }

  AUTO_IN = true;
  studio.classList.add("launching");
  [...mock.querySelectorAll(".q")].forEach((k, i) => {
    k.style.animation = `keyfire .5s cubic-bezier(.25,1.5,.45,1) ${380 + i * 55}ms both`;
  });

  /* The readout is the point of the wait, so nothing may cut it off. Its last
     line starts at 2700 + 6 x 260 and takes 500ms to land, so the earliest the
     curtain can honestly lift is 4760 — with a beat afterwards to read it. */
  const stepStart = 2700, stepGap = 260, stepFor = 500;
  const lastLandsAt = stepStart + (steps.length - 1) * stepGap + stepFor;
  const hold = lastLandsAt + 900;

  const at = (ms, fn) => setTimeout(fn, ms);
  at(1300, () => mock.classList.add("rush"));
  at(1900, () => veil.classList.add("wash"));
  at(2200, () => veil.classList.add("named"));
  at(stepStart - 100, () => veil.classList.add("stepping"));
  /* The register is built behind the curtain, so it's ready the instant it lifts. */
  at(hold, () => {
    studio.classList.remove("on", "launching");
    studio.innerHTML = "";
    boot();
    const app = document.getElementById("app");
    if (app) { app.classList.add("arrive"); at(1600, () => app.classList.remove("arrive")); }
  });
  at(hold + 400, () => veil.classList.add("part"));
  at(hold + 1600, () => veil.remove());
}
