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
          <p>Five of them, and they are not one design in five colours — each is a different machine.
            Different screens, different steps, different words. Pick the one that matches how your
            counter actually works. You can change it whenever you like.</p>
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
            <span class="pkswatch sh-${l.shell}" style="background:${l.bg};border-color:${l.line}">
              ${shellThumb(l)}
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
              <span><em>Best for</em>${esc(L.tag)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  drawShot(L);
}

/* A miniature of the register that will actually open. Each of the five is
   drawn from its own markup — the preview used to read layout properties that
   no longer exist, so every register previewed as the same generic panel. */
/* A ten-pixel sketch of each shell's actual shape. */
function shellThumb(l) {
  const p = `background:${l.panel}`, k = `background:${l.key}`, a = `background:${l.accent}`;
  if (l.shell === "classic") return `
    <i style="position:absolute;left:0;right:0;top:0;height:16px;${a};opacity:.55"></i>
    <i style="position:absolute;left:0;top:16px;bottom:0;width:22px;${p}"></i>
    <span style="position:absolute;left:26px;right:4px;top:20px;bottom:4px;display:grid;
      grid-template-columns:repeat(3,1fr);gap:2px">${[1,2,3,4,5,6].map(() =>
      `<i style="${k}"></i>`).join("")}</span>`;
  if (l.shell === "menu") return `
    <span style="position:absolute;left:4px;right:4px;top:12px;bottom:14px;display:grid;
      grid-template-columns:1fr 1fr;gap:3px">${[1,2,3,4].map(() =>
      `<i style="${k};border-radius:5px"></i>`).join("")}</span>
    <i style="position:absolute;left:6px;right:6px;bottom:4px;height:8px;${a};border-radius:99px"></i>`;
  if (l.shell === "terminal") return `
    <i style="position:absolute;left:0;right:0;top:0;height:8px;${p}"></i>
    <span style="position:absolute;left:4px;right:26px;top:12px;bottom:4px;display:grid;gap:2px;
      grid-auto-rows:4px">${[1,2,3,4,5].map(() => `<i style="${k}"></i>`).join("")}</span>
    <i style="position:absolute;right:0;top:8px;bottom:0;width:22px;${p}"></i>`;
  if (l.shell === "catalogue") return `
    <i style="position:absolute;left:0;top:0;bottom:0;width:24px;${p}"></i>
    <span style="position:absolute;left:28px;right:4px;top:4px;bottom:14px;display:grid;
      grid-template-columns:1fr 1fr;gap:3px">${[1,2].map(() =>
      `<i style="${k};border-radius:3px;border-top:3px solid ${l.accent}"></i>`).join("")}</span>
    <i style="position:absolute;left:24px;right:0;bottom:0;height:12px;${p}"></i>`;
  return `
    <span style="position:absolute;left:16px;right:16px;top:6px;bottom:18px;display:grid;gap:3px;
      grid-auto-rows:12px">${[1,2].map(() => `<i style="${k};border-radius:5px"></i>`).join("")}</span>
    <i style="position:absolute;left:10px;right:10px;bottom:0;height:16px;${p};
      border-radius:7px 7px 0 0"></i>`;
}

function drawShot(L) {
  const el = document.getElementById("pkShot");
  if (!el) return;
  const F = `'${L.font}',Archivo,sans-serif`, M = `'${L.mono}',monospace`;
  const light = L.mode === "light";
  const txt = light ? "#1A1714" : "#E6E9EA", dim = light ? "#8A8078" : "#7C868A";
  const menu = CFG.menus.filter(m => !m.fuel)[0];
  const keys = (menu ? menu.keys : []).slice(0, 6)
    .map(k => ({ k, p: byId(CFG.plus, k.pluId) })).filter(x => x.p);
  const cats = CFG.menus.filter(m => !m.fuel).slice(0, 5);
  const col = i => byId(CFG.depts, keys[i]?.p.deptId)?.color || L.accent;
  const nm = i => esc(keys[i]?.k.label || keys[i]?.p.n || "Product");
  const pr = i => keys[i] ? money(keys[i].p.price) : "0.00";

  const shots = {

    classic: () => `
      <div style="background:#0A0E0D;padding:16px 20px">
        <div style="display:flex;justify-content:space-between;font-family:${M};font-size:13px;
          color:${L.accent};letter-spacing:.06em">
          <span>${nm(0).toUpperCase()}</span><span>${pr(0)}</span></div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;
          border-top:1px solid rgba(255,255,255,.09);margin-top:10px;padding-top:10px">
          <span style="font-size:10px;letter-spacing:.2em;color:rgba(255,255,255,.4)">TOTAL</span>
          <b style="font-family:${M};font-size:38px;font-weight:500;color:${L.accent}">${pr(0)}</b></div>
      </div>
      <div style="display:grid;grid-template-columns:158px 1fr">
        <div style="background:${L.panel};border-right:1px solid ${L.line};padding:11px 13px;
          font-family:${M};font-size:11px;color:${txt}">
          ${keys.slice(0, 3).map((_, i) => `<div style="display:flex;justify-content:space-between;
            padding:5px 0"><span>${nm(i).slice(0, 14).toUpperCase()}</span><span>${pr(i)}</span></div>`).join("")}
        </div>
        <div style="padding:11px">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:8px">
            ${cats.slice(0, 4).map((c, i) => `<div style="background:${byId(CFG.depts, "D" + c.id.slice(1))?.color || col(i)};
              border-radius:${L.radius}px;padding:12px 9px;color:#fff;font-family:${F};
              font-size:11px">${esc(c.n).slice(0, 12)}</div>`).join("")}
          </div>
          <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px">
            ${["7","8","9","4","5","6"].map(k => `<div style="background:${L.key};
              border:1px solid ${L.line};border-radius:${L.radius}px;padding:10px;text-align:center;
              font-family:${M};font-size:14px;color:${txt}">${k}</div>`).join("")}
          </div>
        </div>
      </div>`,

    menu: () => `
      <div style="display:flex;align-items:center;gap:10px;padding:14px 16px 6px">
        <span style="width:8px;height:8px;border-radius:99px;background:${L.accent}"></span>
        <b style="font-family:${F};font-size:17px;color:${txt}">${esc(CFG.site.name)}</b></div>
      <div style="display:flex;gap:6px;padding:8px 16px 12px">
        ${cats.slice(0, 3).map((c, i) => `<span style="font-family:${F};font-size:12px;
          border-radius:99px;padding:7px 16px;${i === 0
            ? `background:${L.accent};color:#3A1607`
            : `border:1px solid ${L.line};color:${dim}`}">${esc(c.n).slice(0, 14)}</span>`).join("")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px;padding:0 16px 60px">
        ${keys.slice(0, 3).map((_, i) => `<div style="background:${col(i)};border-radius:${L.radius}px;
          padding:16px;min-height:86px;display:flex;flex-direction:column;justify-content:space-between;
          color:#fff;font-family:${F}">
          <span style="font-size:15px;font-weight:600;line-height:1.2">${nm(i).slice(0, 18)}</span>
          <span style="font-family:${M};font-size:17px">${pr(i)}</span></div>`).join("")}
      </div>
      <div style="margin:0 16px 14px;display:flex;align-items:center;gap:12px;background:${L.accent};
        border-radius:99px;padding:13px 18px;color:#3A1607;font-family:${F}">
        <span style="background:rgba(0,0,0,.2);border-radius:99px;padding:3px 11px;font-weight:600;
          font-size:13px">3</span>
        <span style="flex:1;font-size:14px;font-weight:600">Review the order</span>
        <span style="font-family:${M};font-size:17px;font-weight:600">${money(
          keys.slice(0, 3).reduce((a, x) => a + x.p.price, 0))}</span></div>`,

    terminal: () => `
      <div style="font-family:${M};font-size:12px;color:${L.accent}">
        <div style="display:flex;gap:18px;padding:8px 14px;background:${L.panel};
          border-bottom:1px solid ${L.line};font-size:10px;letter-spacing:.1em">
          <span>${esc(CFG.site.name).toUpperCase().slice(0, 26)}</span><span>REG 1</span>
          <span style="margin-left:auto">SALE</span><span>[MENU]</span></div>
        <div style="display:grid;grid-template-columns:1fr 150px">
          <div style="border-right:1px solid ${L.line}">
            <div style="display:grid;grid-template-columns:36px 1fr 64px 70px;gap:8px;padding:6px 14px;
              border-bottom:1px solid ${L.line};font-size:9px;letter-spacing:.12em;opacity:.6">
              <span>QTY</span><span>DESCRIPTION</span><span style="text-align:right">PRICE</span>
              <span style="text-align:right">AMOUNT</span></div>
            ${keys.slice(0, 3).map((_, i) => `<div style="display:grid;
              grid-template-columns:36px 1fr 64px 70px;gap:8px;padding:5px 14px">
              <span>1</span><span>${nm(i).toUpperCase().slice(0, 22)}</span>
              <span style="text-align:right">${pr(i)}</span>
              <span style="text-align:right">${pr(i)}</span></div>`).join("")}
            <div style="border-top:1px solid ${L.line};padding:7px 14px;display:flex;
              justify-content:space-between;font-size:15px">
              <span>TOTAL</span><b style="font-weight:500">${money(
                keys.slice(0, 3).reduce((a, x) => a + x.p.price, 0))}</b></div>
            <div style="display:flex;gap:8px;padding:9px 14px;border-top:1px solid ${L.line};
              background:${L.panel}"><span style="font-size:14px">&gt;</span>
              <span style="opacity:.55">3*4011_</span></div>
          </div>
          <div style="padding:9px;background:${L.panel}">
            <div style="font-size:9px;letter-spacing:.16em;opacity:.5;padding-bottom:6px">FUNCTION KEYS</div>
            ${[["F1","PRICE CHECK"],["F2","VOID LINE"],["F3","DISCOUNT"]].map(([k, n]) =>
              `<div style="display:flex;gap:8px;border:1px solid ${L.line};padding:6px 8px;
                margin-bottom:3px;font-size:10px"><b style="font-weight:500">${k}</b>
                <span style="opacity:.75">${n}</span></div>`).join("")}
          </div>
        </div>
      </div>`,

    catalogue: () => `
      <div style="display:grid;grid-template-columns:150px 1fr">
        <div style="background:${L.panel};border-right:1px solid ${L.line};padding:16px 14px">
          <b style="font-family:${F};font-size:15px;color:${txt};display:block;margin-bottom:16px;
            line-height:1.25">${esc(CFG.site.name)}</b>
          ${cats.slice(0, 3).map((c, i) => `<div style="font-family:${F};font-size:13px;padding:8px 10px;
            border-radius:8px;display:flex;justify-content:space-between;margin-bottom:2px;${i === 0
              ? `background:color-mix(in srgb,${L.accent} 14%,transparent);color:${txt}`
              : `color:${dim}`}"><span>${esc(c.n).slice(0, 14)}</span>
            <span style="font-size:11px;opacity:.6">${c.keys.length}</span></div>`).join("")}
        </div>
        <div style="padding:18px 20px">
          <h3 style="font-family:${F};font-size:22px;font-weight:500;color:${txt};margin:0 0 14px">
            ${esc(cats[0] ? cats[0].n : "")}</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${keys.slice(0, 2).map((_, i) => `<div style="background:${L.panel};
              border:1px solid ${L.line};border-radius:${L.radius}px;overflow:hidden">
              <div style="height:44px;background:${col(i)}"></div>
              <div style="padding:12px 13px 9px;font-family:${F};font-size:15px;color:${txt}">
                ${nm(i).slice(0, 22)}</div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 13px;
                border-top:1px solid ${L.line}">
                <span style="font-family:${M};font-size:14px;color:${txt}">${pr(i)}</span>
                <span style="font-family:${F};font-size:11px;color:${L.accent};
                  border:1px solid color-mix(in srgb,${L.accent} 45%,transparent);
                  border-radius:99px;padding:3px 11px">Add</span></div></div>`).join("")}
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:16px;padding:12px 20px;
        border-top:1px solid ${L.line};background:${L.panel}">
        <div style="flex:1;display:flex;gap:6px">
          ${keys.slice(0, 2).map((_, i) => `<span style="background:${L.bg};border:1px solid ${L.line};
            border-radius:99px;padding:5px 12px;font-family:${F};font-size:12px;color:${txt}">
            ${nm(i).slice(0, 14)} ×</span>`).join("")}
        </div>
        <div><span style="display:block;font-family:${F};font-size:10px;letter-spacing:.1em;
          color:${dim}">TOTAL</span>
          <b style="font-family:${M};font-size:20px;color:${txt}">${money(
            keys.slice(0, 2).reduce((a, x) => a + x.p.price, 0))}</b></div>
        <span style="background:${L.accent};color:#fff;border-radius:10px;padding:11px 20px;
          font-family:${F};font-size:13px">Cash</span>
      </div>`,

    pad: () => `
      <div style="max-width:360px;margin:0 auto;border-left:1px solid ${L.line};
        border-right:1px solid ${L.line};min-height:100%">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 16px 10px">
          <b style="font-family:${F};font-size:17px;color:${txt}">${esc(CFG.site.name)}</b>
          <span style="margin-left:auto;width:30px;height:30px;border-radius:99px;
            border:1px solid ${L.line}"></span></div>
        <div style="display:flex;gap:6px;padding:0 16px 12px">
          ${cats.slice(0, 2).map((c, i) => `<span style="font-family:${F};font-size:12px;
            border-radius:99px;padding:7px 15px;${i === 0
              ? `background:${L.accent};color:#04211E;font-weight:600`
              : `border:1px solid ${L.line};color:${dim}`}">${esc(c.n).slice(0, 12)}</span>`).join("")}
        </div>
        <div style="padding:0 16px 96px">
          ${keys.slice(0, 2).map((_, i) => `<div style="display:flex;align-items:center;gap:12px;
            background:${L.panel};border:1px solid ${L.line};border-radius:${L.radius}px;
            padding:15px 16px;margin-bottom:8px">
            <span style="width:10px;height:10px;border-radius:99px;background:${col(i)}"></span>
            <span style="flex:1;font-family:${F};font-size:15px;font-weight:600;color:${txt}">
              ${nm(i).slice(0, 20)}</span>
            <span style="font-family:${M};font-size:15px;color:${txt}">${pr(i)}</span>
            <span style="width:30px;height:30px;border-radius:99px;background:${L.accent};
              color:#04211E;display:flex;align-items:center;justify-content:center;
              font-size:18px">+</span></div>`).join("")}
        </div>
        <div style="background:${L.panel};border-top:1px solid ${L.line};
          border-radius:22px 22px 0 0;padding:16px 20px 18px">
          <div style="width:40px;height:4px;border-radius:99px;background:${L.line};
            margin:0 auto 12px"></div>
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-family:${F};font-size:15px;font-weight:600;color:${txt}">2 items</span>
            <b style="font-family:${M};font-size:21px;color:${L.accent}">${money(
              keys.slice(0, 2).reduce((a, x) => a + x.p.price, 0))}</b></div>
        </div>
      </div>`
  };

  el.innerHTML = `<div class="qmock" style="background:${L.bg};border-color:${L.line};
    color:${txt};min-height:340px">${(shots[L.shell] || shots.classic)()}</div>`;
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
