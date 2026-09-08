/* ===========================================================================
   The design studio.

   The last thing before the register opens. Not a list of layouts to pick from —
   their actual register, with their actual products, that they rearrange by
   dragging until it looks the way they want. Then they launch it.

   Everything here writes straight into CFG. There is no separate "design" state
   to sync, because the thing on screen is the configuration.
   =========================================================================== */

let STUDIO_MENU = 0, STUDIO_SEL = null, STUDIO_GUIDE = true;

function openStudio() {
  document.getElementById("setup").classList.add("hide");
  document.getElementById("building").style.display = "none";
  const el = document.getElementById("studio");
  el.classList.add("on");
  themeFromConfig();
  drawStudio();
}

function studioL() {
  return LAYOUTS.find(x => x.k === CFG.layout) || LAYOUTS[0];
}
/* Writes a single property of the arrangement and redraws. Layout stops being a
   preset the moment one of these is touched — it becomes theirs. */
const SAY = {
  tape: v => `Order panel moved ${v === "bottom" ? "to the bottom" : "to the " + v}`,
  nav: v => `Main menu moved to the ${v === "rail" ? "side" : "top"}`,
  depts: v => `Sections moved to the ${v === "rail" ? "side" : "top"}`,
  keyStyle: v => `Products now drawn as ${({tile:"tiles",pad:"pads",list:"rows",card:"cards"})[v]}`,
  search: v => v ? "Search bar shown" : "Search bar hidden",
  fkeys: v => v ? "Function row shown" : "Function row hidden",
  keyMin: v => `Keys ${v}px wide`,
  density: v => `Spacing ${(+v).toFixed(2)}×`,
  radius: v => `Corners ${v}px`
};
function setL(prop, val) {
  CFG.layoutCustom = { ...(CFG.layoutCustom || {}), [prop]: val };
  applyStudio();
  drawStudio();
  if (SAY[prop]) flash(SAY[prop](val));
}
/* One line, top of the canvas, saying what just happened. Without it every
   click feels like nothing changed. */
let FLASH_T = null;
function flash(msg) {
  const el = document.getElementById("stFlash");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  clearTimeout(FLASH_T);
  FLASH_T = setTimeout(() => el.classList.remove("show"), 2200);
}
function effL() {
  return { ...studioL(), ...(CFG.layoutCustom || {}) };
}
function applyStudio() {
  const L = effL();
  THEME.keyMin = L.keyMin; THEME.density = L.density; THEME.radius = L.radius;
  THEME.fontScale = L.fs; THEME.showF = L.fkeys; THEME.searchLeads = L.search;
  THEME.tape = L.tape; THEME.depts = L.depts; THEME.keyStyle = L.keyStyle; THEME.nav = L.nav;
  THEME.mode = CFG.theme.mode; THEME.accent = CFG.theme.accent;
  CFG.theme = { ...CFG.theme, keyMin: L.keyMin, density: L.density, radius: L.radius };
  applyTheme();
}

function drawStudio() {
  const L = effL();
  const menus = CFG.menus.filter(m => !m.fuel);
  const menu = menus[STUDIO_MENU] || menus[0];
  const M = MODES[CFG.theme.mode] || MODES.dark;
  const accent = CFG.theme.accent;

  const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length];

  window.__st = {
    style: k => { CFG.layout = k; CFG.layoutCustom = null; applyStudio(); drawStudio();
      flash(`Started from ${(LAYOUTS.find(x => x.k === k) || {}).n}`); },
    tape: () => setL("tape", cycle(["left", "right", "bottom"], L.tape)),
    nav: () => setL("nav", cycle(["rail", "top"], L.nav)),
    depts: () => setL("depts", cycle(["tabs", "rail"], L.depts)),
    keyStyle: k => setL("keyStyle", k),
    search: () => setL("search", !L.search),
    fkeys: () => setL("fkeys", !L.fkeys),
    size: v => setL("keyMin", Math.round(+v)),
    dense: v => setL("density", +v),
    radius: v => setL("radius", +v),
    mode: m => { CFG.theme.mode = m; applyStudio(); drawStudio();
      flash(({dark:"Dark",light:"Light",contrast:"High contrast"})[m] + " mode"); },
    accent: a => { CFG.theme.accent = a; applyStudio(); drawStudio();
      flash("Accent colour changed"); },
    menu: i => { STUDIO_MENU = i; STUDIO_SEL = null; drawStudio(); },
    pick: i => { STUDIO_SEL = STUDIO_SEL === i ? null : i; drawStudio(); },
    wider: i => { const k = menu.keys[i]; k.w = (k.w || 1) === 2 ? 1 : 2; drawStudio();
      flash(k.w === 2 ? "Key made double width" : "Key back to single width"); },
    taller: i => { const k = menu.keys[i]; k.h = (k.h || 1) === 2 ? 1 : 2; drawStudio();
      flash(k.h === 2 ? "Key made double height" : "Key back to single height"); },
    colour: (i, c) => { menu.keys[i].color = c || null; drawStudio();
      flash(c ? "Key recoloured" : "Key back to its department colour"); },
    drop: i => { const n = byId(CFG.plus, menu.keys[i].pluId)?.n || "Key";
      menu.keys.splice(i, 1); STUDIO_SEL = null; drawStudio();
      flash(`${n} taken off this menu — still in the pricebook`); },
    move: (from, to) => {
      if (to < 0 || to >= menu.keys.length || from === to) return;
      menu.keys.splice(to, 0, menu.keys.splice(from, 1)[0]);
      STUDIO_SEL = to; drawStudio(); flash("Key moved");
    },
    reset: () => { CFG.layoutCustom = null; applyStudio(); drawStudio();
      toast("Back to the " + studioL().n + " arrangement."); },
    guide: () => { STUDIO_GUIDE = !STUDIO_GUIDE; drawStudio(); },
    launch: launchPOS
  };

  const KEYC = ["#3E464A", "#3A5A52", "#57493B", "#3D4D66", "#573D4D", "#485435", "#7A3B3B", "#2F4F55"];
  const cols = L.keyStyle === "list" ? 1 : Math.max(2, Math.round(760 / L.keyMin));

  const keyHtml = (k, i) => {
    const p = byId(CFG.plus, k.pluId);
    const d = p ? byId(CFG.depts, p.deptId) : null;
    const col = k.color || d?.color || "#3E464A";
    const sel = STUDIO_SEL === i;
    const span = `${(k.w || 1) > 1 ? "grid-column:span 2;" : ""}${(k.h || 1) > 1 ? "grid-row:span 2;" : ""}`;
    const label = k.label || p?.n || "(missing)";
    const price = p ? money(p.price) : "—";
    const body = L.keyStyle === "list"
      ? `<span class="sbar" style="background:${col}"></span>
         <span class="sn">${esc(label)}</span><span class="sp num">${price}</span>`
      : L.keyStyle === "card"
      ? `<span class="scap" style="background:${col}"></span>
         <span class="sbody"><span class="sn">${esc(label)}</span></span>
         <span class="sfoot"><span class="sp num">${price}</span></span>`
      : `<span class="sn">${esc(label)}</span><span class="sp num">${price}</span>`;
    const bg = L.keyStyle === "list" || L.keyStyle === "card" ? "" :
      `background:linear-gradient(180deg,${col} 0%,${col}CC 120%);`;
    return `<div class="sk ${L.keyStyle} ${sel ? "sel" : ""}" draggable="true" data-i="${i}"
      style="${span}${bg}border-radius:${L.keyStyle === "list" ? 0 : L.radius + 2}px"
      onclick="__st.pick(${i})">${body}
      ${sel ? `<span class="skt">
        <button onclick="event.stopPropagation();__st.wider(${i})" title="Width">${(k.w || 1) === 2 ? "◧" : "◫"}</button>
        <button onclick="event.stopPropagation();__st.taller(${i})" title="Height">${(k.h || 1) === 2 ? "▤" : "▥"}</button>
        <button onclick="event.stopPropagation();__st.drop(${i})" title="Remove">×</button></span>
        <span class="skc">${KEYC.map(c => `<i style="background:${c}"
          onclick="event.stopPropagation();__st.colour(${i},'${c}')"></i>`).join("")}
          <i class="x" onclick="event.stopPropagation();__st.colour(${i},'')">↺</i></span>` : ""}</div>`;
  };

  /* Labels used to sit on top of the thing they described, which covered the
     content and looked broken. They now live in one bar under the canvas and
     fill in on hover, so nothing is ever obscured. */
  const zone = (label, action) => ` data-zone="${esc(label)}" data-act="${esc(action)}"`;

  const sections = `<div class="ssec ${L.depts} zone" onclick="__st.depts()"${
    zone("Sections", L.depts === "rail" ? "move them to the top" : "move them to the side")}>
    ${menus.map((m, i) => `<span class="${i === STUDIO_MENU ? "on" : ""}"
      onclick="event.stopPropagation();__st.menu(${i})"
      style="${i === STUDIO_MENU ? `--a:${accent}` : ""}">${esc(m.n)}</span>`).join("")}</div>`;

  const tape = `<div class="stape zone" onclick="__st.tape()"${
    zone("Order panel", "move it " + (L.tape === "left" ? "to the right" : L.tape === "right" ? "to the bottom" : "to the left"))}>
    <div class="sth">Current sale</div>
    <div class="stl"><span>${esc(CFG.plus[0]?.n || "First product")}</span>
      <span class="num">${money(CFG.plus[0]?.price || 0)}</span></div>
    <div class="stl"><span>${esc(CFG.plus[1]?.n || "Second product")}</span>
      <span class="num">${money(CFG.plus[1]?.price || 0)}</span></div>
    <div class="stt"><span>Total</span><b style="color:${accent}">${
      money((CFG.plus[0]?.price || 0) + (CFG.plus[1]?.price || 0))}</b></div>
    <div class="stp"><span style="border-color:${accent};color:${accent}">Cash</span>
      <span>Card</span></div></div>`;

  const board = `<div class="sboard">
    ${L.search ? `<div class="ssearch zone" onclick="__st.search()"${
      zone("Search bar", "hide it")}>Search the pricebook, or scan a barcode</div>` : ""}
    ${L.depts === "rail"
      ? `<div class="srail">${sections}<div class="skeys ${L.keyStyle}" id="skeys"
           style="grid-template-columns:repeat(${cols},1fr)">${menu ? menu.keys.map(keyHtml).join("") : ""}</div></div>`
      : sections + `<div class="skeys ${L.keyStyle}" id="skeys"
           style="grid-template-columns:repeat(${cols},1fr)">${menu ? menu.keys.map(keyHtml).join("") : ""}</div>`}
    ${L.fkeys ? `<div class="sfk zone" onclick="__st.fkeys()"${zone("Function row", "hide it")}>
      ${["Price check", "Void", "Discount", "No sale", "Suspend", "Return"].map(f =>
        `<span>${f}</span>`).join("")}</div>` : ""}
  </div>`;

  document.getElementById("studio").innerHTML = `
    <div class="stwrap">
      <header class="sthead">
        <div>
          <h1>Make it yours</h1>
          <p>This is your register with your products in it. Drag keys to move them, click one to
             resize or recolour it, click the order panel or the sections to move them. Nothing here
             is permanent — all of it is editable later under Appearance.</p>
        </div>
        <button class="launch" onclick="__st.launch()">
          <span>Launch the register</span>
          <svg viewBox="0 0 20 20"><path d="M3 10h13M11 5l5 5-5 5" stroke="currentColor"
            stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </header>

      <div class="stbody">
        <aside class="sttools">
          <div class="stsec">Start from</div>
          <div class="stpresets">${LAYOUTS.map(l => `
            <button class="${CFG.layout === l.k && !CFG.layoutCustom ? "on" : ""}"
              onclick="__st.style('${l.k}')">${esc(l.n)}</button>`).join("")}</div>
          ${CFG.layoutCustom ? `<button class="streset" onclick="__st.reset()">
            You've changed this from ${esc(studioL().n)} — reset</button>` : ""}

          <div class="stsec">Products drawn as</div>
          <div class="stchips">${[["tile", "Tiles"], ["pad", "Pads"], ["list", "Rows"], ["card", "Cards"]]
            .map(([k, n]) => `<button class="${L.keyStyle === k ? "on" : ""}"
              onclick="__st.keyStyle('${k}')">${n}</button>`).join("")}</div>

          <div class="stsec">Arrangement</div>
          <div class="stchips">
            <button onclick="__st.tape()">Order: ${L.tape}</button>
            <button onclick="__st.nav()">Menu: ${L.nav === "rail" ? "side" : "top"}</button>
            <button onclick="__st.depts()">Sections: ${L.depts === "rail" ? "side" : "top"}</button>
            <button class="${L.search ? "on" : ""}" onclick="__st.search()">Search bar</button>
            <button class="${L.fkeys ? "on" : ""}" onclick="__st.fkeys()">Function row</button>
          </div>

          <div class="stsec">Sizing</div>
          <label class="strange"><span>Key size</span>
            <input type="range" min="120" max="280" value="${L.keyMin}"
              oninput="__st.size(this.value)"><b>${L.keyMin}</b></label>
          <label class="strange"><span>Spacing</span>
            <input type="range" min="0.8" max="1.5" step="0.05" value="${L.density}"
              oninput="__st.dense(this.value)"><b>${(+L.density).toFixed(2)}</b></label>
          <label class="strange"><span>Rounding</span>
            <input type="range" min="0" max="20" value="${L.radius}"
              oninput="__st.radius(this.value)"><b>${L.radius}</b></label>

          <div class="stsec">Colour</div>
          <div class="stchips">${[["dark", "Dark"], ["light", "Light"], ["contrast", "Contrast"]]
            .map(([k, n]) => `<button class="${CFG.theme.mode === k ? "on" : ""}"
              onclick="__st.mode('${k}')">${n}</button>`).join("")}</div>
          <div class="stswatch">${ACCENTS.map(([hex]) =>
            `<i class="${CFG.theme.accent === hex ? "on" : ""}" style="background:${hex}"
              onclick="__st.accent('${hex}')"></i>`).join("")}</div>
        </aside>

        <div class="stcanvas">
          <div class="stcbar">
            <button class="stguide ${STUDIO_GUIDE ? "on" : ""}" onclick="__st.guide()">
              ${STUDIO_GUIDE ? "Hide" : "Show"} what I can change</button>
            <div class="stflash" id="stFlash"></div>
          </div>
          <div class="stmock ${STUDIO_GUIDE ? "guide" : ""}" style="background:${M.bg};color:${M.txt}">
            <div class="stbar" style="background:${CFG.theme.mode === "light" ? "#E2E4DF" : "#141A1C"}">
              <span class="sdot" style="background:${accent}"></span>
              <b>${esc(CFG.site.name)}</b><em>Reg 1 · Store 001</em>
            </div>
            ${L.nav === "top" ? `<div class="snav top zone" onclick="__st.nav()"${
              zone("Main menu", "move it to the side")}>
              ${["Sale", "Office", "Reports", "Config"].map((n, i) =>
                `<span class="${i === 0 ? "on" : ""}" style="--a:${accent}">${n}</span>`).join("")}</div>` : ""}
            <div class="stinner ${L.tape} ${L.nav}">
              ${L.nav === "rail" ? `<div class="snav rail zone" onclick="__st.nav()"${
                zone("Main menu", "move it to the top")}>
                ${["Sale", "Office", "Reports", "Config"].map((n, i) =>
                  `<span class="${i === 0 ? "on" : ""}" style="--a:${accent}">${n}</span>`).join("")}</div>` : ""}
              ${L.tape === "left" ? tape + board : board + tape}
            </div>
          </div>
          <div class="sthint" id="stHint">${STUDIO_SEL != null
            ? "<b>This key is selected.</b> Drag it to move it. The buttons on it change its width and height, the strip along the bottom sets its colour, and × takes it off this menu."
            : "<b>Click any part of the register to change it.</b> Keys can be dragged, resized and recoloured. The panels around them move with a click."}</div>
        </div>
      </div>
    </div>`;

  /* Hovering any editable region explains it in the bar below, rather than
     stamping a label over the top of it. */
  const hint = document.getElementById("stHint");
  const baseHint = hint ? hint.innerHTML : "";
  document.querySelectorAll("#studio [data-zone]").forEach(z => {
    z.addEventListener("mouseenter", () => {
      if (hint) hint.innerHTML = `<b>${z.dataset.zone}</b> — click to ${z.dataset.act}.`;
    });
    z.addEventListener("mouseleave", () => { if (hint) hint.innerHTML = baseHint; });
  });

  /* Drag to rearrange, with the same plain HTML5 events the menu designer uses. */
  const keys = document.getElementById("skeys");
  if (keys) {
    let from = null;
    keys.querySelectorAll(".sk").forEach(k => {
      k.addEventListener("dragstart", e => { from = +k.dataset.i; k.classList.add("drag");
        e.dataTransfer.effectAllowed = "move"; });
      k.addEventListener("dragend", () => { k.classList.remove("drag");
        keys.querySelectorAll(".sk").forEach(x => x.classList.remove("over")); });
      k.addEventListener("dragover", e => { e.preventDefault(); k.classList.add("over"); });
      k.addEventListener("dragleave", () => k.classList.remove("over"));
      k.addEventListener("drop", e => { e.preventDefault();
        if (from != null) window.__st.move(from, +k.dataset.i); });
    });
  }
}

/* The handover.

   Six beats, about four seconds. Long enough to feel like an event, short
   enough that nobody sitting through it a second time resents it.

     0.0  the tools clear out
     0.4  the keys fire off one at a time, like a board powering down
     1.1  the register tilts and flies past the viewer
     1.7  white-out in the store's own colour
     2.0  the store name lands
     3.0  the real register assembles piece by piece behind it
*/
function launchPOS() {
  const studio = document.getElementById("studio");
  const mock = studio.querySelector(".stmock");
  if (!mock) return boot();

  /* Persist first — a slow network must never make the animation a lie. */
  if (typeof saveNow === "function") saveNow();
  if (typeof contributePattern === "function") contributePattern();

  const accent = CFG.theme.accent;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const veil = document.createElement("div");
  veil.className = "lv";
  veil.innerHTML = `
    <div class="lv-wash" style="background:${accent}"></div>
    <div class="lv-rays">${Array.from({length:12},(_,i)=>
      `<i style="transform:rotate(${i*30}deg);background:linear-gradient(to top,${accent}00,${accent}AA)"></i>`).join("")}</div>
    <div class="lv-core">
      <div class="lv-ring" style="border-color:${accent}"></div>
      <div class="lv-ring two" style="border-color:${accent}"></div>
      <div class="lv-name">
        <b>${esc(CFG.site.name)}</b>
        <em>Register 1 &middot; now open</em>
      </div>
    </div>`;
  document.body.appendChild(veil);

  if (reduce) {
    studio.classList.remove("on"); studio.innerHTML = "";
    boot(); veil.remove(); return;
  }

  studio.classList.add("launching");

  const keys = [...mock.querySelectorAll(".sk")];
  keys.forEach((k, i) => {
    k.style.animation = `keyfire .5s cubic-bezier(.25,1.5,.45,1) ${380 + i * 55}ms both`;
  });

  const at = (ms, fn) => setTimeout(fn, ms);
  at(1100, () => mock.classList.add("rush"));
  at(1700, () => veil.classList.add("wash"));
  at(2000, () => veil.classList.add("named"));
  at(3000, () => {
    studio.classList.remove("on", "launching");
    studio.innerHTML = "";
    boot();
    const app = document.getElementById("app");
    if (app) { app.classList.add("arrive"); at(1400, () => app.classList.remove("arrive")); }
  });
  at(3200, () => veil.classList.add("part"));
  at(4200, () => veil.remove());
}
