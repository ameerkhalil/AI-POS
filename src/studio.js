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
  const sum = n => money(keys.slice(0, n).reduce((a, x) => a + x.p.price, 0));

  const shots = {

    classic: () => `
      <div style="background:#101619;padding:16px 20px">
        <div style="display:flex;justify-content:space-between;font-family:${M};font-size:12px;
          color:${L.accent};letter-spacing:.06em">
          <span>${nm(0).toUpperCase().slice(0, 30)}</span><span>${pr(0)}</span></div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;
          border-top:1px solid rgba(255,255,255,.09);margin-top:9px;padding-top:9px">
          <span style="font-size:10px;letter-spacing:.2em;color:rgba(255,255,255,.4)">TOTAL</span>
          <b style="font-family:${M};font-size:34px;font-weight:500;color:${L.accent}">${pr(0)}</b></div>
      </div>
      <div style="display:grid;grid-template-columns:150px 1fr">
        <div style="background:${L.panel};border-right:1px solid ${L.line};padding:10px 12px;
          font-family:${M};font-size:10.5px;color:${txt}">
          ${keys.slice(0, 3).map((_, i) => `<div style="display:flex;justify-content:space-between;
            gap:8px;padding:4px 0"><span>${nm(i).slice(0, 13).toUpperCase()}</span>
            <span>${pr(i)}</span></div>`).join("")}
        </div>
        <div style="padding:10px">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:6px">
            ${cats.slice(0, 4).map((c, i) => `<div style="background:${col(i)};border-radius:2px;
              border:1px solid #5A6266;padding:11px 8px;color:#fff;font-family:${F};font-size:10.5px;
              box-shadow:inset 0 1px 0 rgba(255,255,255,.14)">${esc(c.n).slice(0, 11)}</div>`).join("")}
          </div>
          <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:3px">
            ${["7","8","9","4","5","6"].map(k => `<div style="background:${L.key};
              border:1px solid #5A6266;border-radius:2px;padding:10px;text-align:center;
              font-family:${M};font-size:14px;color:${txt};
              box-shadow:inset 0 1px 0 rgba(255,255,255,.12)">${k}</div>`).join("")}
          </div>
        </div>
      </div>`,

    menu: () => `
      <div style="display:flex;align-items:center;gap:10px;padding:14px 16px 6px">
        <span style="width:8px;height:8px;border-radius:99px;background:${L.accent}"></span>
        <b style="font-family:${F};font-size:17px;font-weight:700;color:${txt}">${esc(CFG.site.name)}</b></div>
      <div style="display:flex;gap:6px;padding:8px 16px 12px">
        ${cats.slice(0, 3).map((c, i) => `<span style="font-family:${F};font-size:12px;
          border-radius:99px;padding:7px 16px;${i === 0
            ? `background:${L.accent};color:#2A0C00;font-weight:600`
            : `border:1px solid ${L.line};color:${dim}`}">${esc(c.n).slice(0, 13)}</span>`).join("")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 16px 12px">
        ${keys.slice(0, 3).map((_, i) => `<div style="background:${col(i)};border-radius:8px;
          padding:15px;min-height:82px;display:flex;flex-direction:column;justify-content:space-between;
          color:#fff;font-family:${F}">
          <span style="font-size:15px;font-weight:600;line-height:1.2">${nm(i).slice(0, 16)}</span>
          <span style="font-family:${M};font-size:17px">${pr(i)}</span></div>`).join("")}
      </div>
      <div style="margin:0 16px 14px;display:flex;align-items:center;gap:12px;background:${L.accent};
        border-radius:99px;padding:13px 18px;color:#2A0C00;font-family:${F}">
        <span style="background:rgba(0,0,0,.22);border-radius:99px;padding:3px 11px;font-weight:700;
          font-size:13px">3</span>
        <span style="flex:1;font-size:14px;font-weight:600">Review the order</span>
        <span style="font-family:${M};font-size:17px;font-weight:700">${sum(3)}</span></div>`,

    commerce: () => `
      <div style="display:grid;grid-template-columns:132px 1fr 208px;min-height:290px">
        <div style="background:#1A1F26;padding:14px 10px">
          <div style="display:flex;align-items:center;gap:8px;padding:2px 6px 14px">
            <span style="width:8px;height:8px;border-radius:99px;background:${L.accent}"></span>
            <b style="font-family:${F};font-size:12.5px;color:#F1F2F4">${esc(CFG.site.name).slice(0, 14)}</b></div>
          ${["Sell","Office","Reports","Settings"].map((n, i) => `<div style="font-family:${F};
            font-size:12.5px;padding:8px 10px;border-radius:6px;margin-bottom:2px;${i === 0
              ? `background:rgba(0,128,96,.18);color:#4FD1A5;font-weight:500`
              : `color:#A9B2BD`}">${n}</div>`).join("")}
        </div>
        <div>
          <div style="background:#fff;padding:12px 15px 9px;border-bottom:1px solid ${L.line}">
            <span style="display:block;padding:9px 12px;border:1px solid #C9CFD6;border-radius:8px;
              font-family:${F};font-size:12.5px;color:#9AA3AD">Search products or scan a barcode</span></div>
          <div style="padding:9px 15px">
            ${keys.slice(0, 3).map((_, i) => `<div style="display:grid;
              grid-template-columns:34px 1fr auto auto;gap:11px;align-items:center;background:#fff;
              border:1px solid ${L.line};border-radius:8px;padding:9px 11px;margin-bottom:6px">
              <span style="width:34px;height:34px;border-radius:6px;background:${col(i)};display:grid;
                place-items:center;color:#fff;font-family:${F};font-size:14px;font-weight:600">
                ${esc(nm(i).trim()[0] || "?")}</span>
              <span style="font-family:${F};font-size:12.5px;color:${txt};font-weight:500">
                ${nm(i).slice(0, 22)}</span>
              <span style="font-family:${M};font-size:12.5px;color:${txt}">${pr(i)}</span>
              <span style="font-family:${F};font-size:11px;color:${L.accent};
                border:1px solid ${L.accent};border-radius:6px;padding:4px 11px">Add</span></div>`).join("")}
          </div>
        </div>
        <div style="background:#fff;border-left:1px solid ${L.line}">
          <div style="display:flex;justify-content:space-between;align-items:baseline;
            padding:14px 15px 10px;border-bottom:1px solid #EDEFF2;font-family:${F}">
            <b style="font-size:14px;color:${txt}">Cart</b>
            <span style="font-size:11.5px;color:${dim}">2 items</span></div>
          ${keys.slice(0, 2).map((_, i) => `<div style="padding:10px 15px;
            border-bottom:1px solid #F4F5F7;display:flex;justify-content:space-between;font-family:${F}">
            <span style="font-size:12.5px;color:${txt}">${nm(i).slice(0, 16)}</span>
            <span style="font-family:${M};font-size:12.5px;color:${txt}">${pr(i)}</span></div>`).join("")}
          <div style="padding:11px 15px;border-top:1px solid #EDEFF2;display:flex;
            justify-content:space-between;font-family:${F};font-size:15px;font-weight:600;color:${txt}">
            <span>Total</span><b style="font-family:${M}">${sum(2)}</b></div>
          <div style="margin:10px 14px 14px;padding:13px;border-radius:8px;background:${L.accent};
            color:#fff;font-family:${F};font-size:14px;font-weight:600;text-align:center">Checkout</div>
        </div>
      </div>`,

    board: () => `
      <div style="display:flex;align-items:center;gap:12px;padding:11px 16px;background:#171C21;
        border-bottom:1px solid ${L.line};font-family:${F}">
        <b style="font-size:14px;color:${txt}">${esc(CFG.site.name)}</b></div>
      <div style="display:flex;gap:9px;padding:13px 16px;border-bottom:1px solid ${L.line};
        background:#1A2025">
        ${[0, 1].map(t => `<div style="flex:none;width:150px;background:${t === 0 ? "#2A353E" : L.panel};
          border:2px solid ${t === 0 ? L.accent : L.line};border-radius:8px;padding:10px 11px;
          font-family:${F}">
          <b style="display:block;font-size:13px;color:${txt};margin-bottom:6px">Ticket ${t + 1}</b>
          <div style="min-height:38px">${keys.slice(t, t + 2).map((_, i) =>
            `<span style="display:block;font-size:11px;color:${dim};white-space:nowrap;
              overflow:hidden;text-overflow:ellipsis">${nm(t + i).slice(0, 18)}</span>`).join("")}</div>
          <div style="display:flex;justify-content:space-between;padding-top:7px;
            border-top:1px solid ${L.line};font-size:11px;color:${dim}">
            <span>2 items</span><b style="font-family:${M};color:${txt}">${sum(2)}</b></div>
        </div>`).join("")}
        <div style="flex:none;width:88px;border:2px dashed ${L.line};border-radius:8px;display:flex;
          flex-direction:column;align-items:center;justify-content:center;gap:4px;color:${dim};
          font-family:${F}"><span style="font-size:22px">+</span>
          <em style="font-style:normal;font-size:10.5px">New</em></div>
      </div>
      <div style="display:grid;grid-template-columns:132px 1fr;min-height:130px">
        <div style="border-right:1px solid ${L.line};padding:10px 8px;background:#1A2025">
          ${cats.slice(0, 3).map((c, i) => `<div style="font-family:${F};font-size:12.5px;
            padding:8px 10px;border-radius:6px;margin-bottom:2px;${i === 0
              ? `background:rgba(79,163,217,.16);color:#7FC4F5;font-weight:500`
              : `color:${dim}`}">${esc(c.n).slice(0, 13)}</div>`).join("")}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:12px">
          ${keys.slice(0, 3).map((_, i) => `<div style="background:${col(i)};border-radius:6px;
            padding:11px;min-height:62px;display:flex;flex-direction:column;justify-content:space-between;
            color:#fff;font-family:${F}">
            <span style="font-size:12.5px;font-weight:600">${nm(i).slice(0, 14)}</span>
            <span style="font-family:${M};font-size:12.5px">${pr(i)}</span></div>`).join("")}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:16px;padding:12px 16px;
        border-top:1px solid ${L.line};background:#171C21;font-family:${F}">
        <div style="flex:1"><span style="display:block;font-size:10.5px;letter-spacing:.09em;
          color:${dim}">TICKET 1</span>
          <b style="font-family:${M};font-size:22px;color:${L.accent};font-weight:700">${sum(2)}</b></div>
        <span style="padding:13px 26px;border-radius:7px;background:${L.accent};color:#0B1B24;
          font-size:14px;font-weight:600">Settle this ticket</span></div>`,

    kiosk: () => `
      <div style="display:flex;align-items:center;gap:14px;padding:15px 20px;
        border-bottom:1px solid ${L.line};font-family:${F}">
        <b style="flex:1;font-size:20px;font-weight:700;color:${txt};letter-spacing:-.02em">
          ${esc(CFG.site.name)}</b>
        <span style="color:${dim};font-size:18px">···</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:18px">
        ${cats.slice(0, 4).map((c, i) => `<div style="background:${col(i)};border-radius:16px;
          padding:24px 20px;min-height:104px;display:flex;flex-direction:column;
          justify-content:flex-end;gap:5px;color:#fff;font-family:${F}">
          <span style="font-size:22px;font-weight:700;line-height:1.15;letter-spacing:-.02em">
            ${esc(c.n).slice(0, 18)}</span>
          <em style="font-style:normal;font-size:13px;opacity:.85">${c.keys.length} items</em>
        </div>`).join("")}
      </div>
      <div style="margin:0 18px 18px;display:flex;align-items:center;gap:14px;background:${L.accent};
        border-radius:16px;padding:17px 22px;color:#fff;font-family:${F}">
        <span style="background:rgba(0,0,0,.22);border-radius:99px;padding:4px 13px;font-size:15px;
          font-weight:700">3</span>
        <span style="flex:1;font-size:16px;font-weight:600">See the order</span>
        <span style="font-family:${M};font-size:19px;font-weight:700">${sum(3)}</span></div>`
  };

  /* A missing preview used to fall through to the Classic mock, so three
     registers silently previewed as a fourth. Say so instead. */
  const draw = shots[L.shell];
  el.innerHTML = `<div class="qmock" style="background:${L.bg};border-color:${L.line};
    color:${txt};min-height:340px">${draw ? draw()
      : `<div style="padding:60px;text-align:center;color:${dim};font-family:${F}">
         No preview built for the "${esc(L.shell)}" register yet.</div>`}</div>`;
}

/* ---------------------------- pre-flight ----------------------------
   Before the register opens for real, check the things that would embarrass it
   on the first sale: no tax rate, no cash tender, a product with no department,
   two staff sharing a code. Blocking problems stop the launch. Everything else
   is shown and can be waved through. */
function preflight() {
  const out = [];
  /* Three states, not two. A check that says "go and confirm this" is not a
     pass, and showing it with a green tick teaches people to ignore the list. */
  const add = (label, ok, detail, blocking, warn) =>
    out.push({ label, ok, detail, blocking, warn: !!warn && ok });

  add("Products in the pricebook", CFG.plus.length > 0,
    CFG.plus.length ? `${CFG.plus.length} ready to ring` : "Nothing to sell yet — import or add some", false);

  const orphan = CFG.plus.filter(p => !byId(CFG.depts, p.deptId)).length;
  add("Every product has a department", orphan === 0,
    orphan ? `${orphan} would ring with no tax rate` : "Tax and reporting will be right", true);

  const noTax = CFG.depts.filter(d => !byId(CFG.taxRates, d.taxId)).length;
  add("Every department has a tax rate", noTax === 0,
    noTax ? `${noTax} department${noTax === 1 ? "" : "s"} would ring untaxed` : "All mapped", true);

  const anyTax = CFG.taxRates.some(r => r.rate > 0);
  const taxOk = anyTax && CFG.tax?.confirmed;
  add("Sales tax is set", anyTax,
    !anyTax ? "Every rate is zero, so nothing will be taxed"
      : taxOk ? "Confirmed against the state"
      : "Not confirmed yet — check it under Site & tax", false, !taxOk);

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

  /* An unconfirmed rate is worth saying out loud at the top too, because it is
     the one thing here that costs money quietly rather than failing loudly. */
  out.cautions = out.filter(o => o.warn).length;

  return out;
}

function launchPOS() {
  const checks = preflight();
  const blockers = checks.filter(c => !c.ok && c.blocking);
  const warns = checks.filter(c => !c.ok && !c.blocking);
  const cautions = checks.filter(c => c.ok && c.warn).length;

  const el = document.createElement("div");
  el.className = "veil pf";
  el.innerHTML = `<div class="card tall pfcard">
    <h3>${blockers.length ? "Two things to fix first" : "Ready to open"}</h3>
    <p>${blockers.length
      ? "The register won't behave correctly until these are sorted. Everything else can wait."
      : (warns.length + cautions)
      ? `Nothing is broken. ${warns.length + cautions === 1 ? "One thing is" : "A few things are"}
         worth knowing before you take a real sale.`
      : "Everything checks out. Your register is ready to open."}</p>
    <div class="pflist">${checks.map((c, i) => `
      <div class="pfrow ${!c.ok ? (c.blocking ? "bad" : "warn") : c.warn ? "warn" : "ok"}" style="animation-delay:${i * 55}ms">
        <span class="pfm">${!c.ok ? (c.blocking ? "\u00d7" : "!") : c.warn ? "!" : "\u2713"}</span>
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
