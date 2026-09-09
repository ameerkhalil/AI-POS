/* ===========================================================================
   The design studio.

   The last thing before the register opens. Not a list of layouts to pick from —
   their actual register, with their actual products, that they rearrange by
   dragging until it looks the way they want. Then they launch it.

   Everything here writes straight into CFG. There is no separate "design" state
   to sync, because the thing on screen is the configuration.
   =========================================================================== */

let STUDIO_MENU = 0, STUDIO_SEL = null, STUDIO_GUIDE = true, STUDIO_DREW = false;

/* Re-rendering the whole studio on every click replayed every entrance
   animation, which read as the screen jumping. These three do the smallest
   update each change actually needs. */
function touchTools() {
  const L = effL();
  document.querySelectorAll("#studio [data-set]").forEach(b => {
    const [k, v] = b.dataset.set.split("=");
    const on = v === undefined ? !!L[k] : String(L[k]) === v;
    b.classList.toggle("on", on);
    if (b.dataset.label) b.textContent = b.dataset.label.replace("{v}",
      k === "tape" ? L.tape : k === "nav" ? (L.nav === "rail" ? "side" : "top")
      : k === "depts" ? (L.depts === "rail" ? "side" : "top") : L[k]);
  });
  document.querySelectorAll("#studio [data-out]").forEach(o => {
    const k = o.dataset.out;
    o.textContent = k === "density" ? (+L[k]).toFixed(2) : L[k];
  });
  const reset = document.getElementById("stReset");
  if (reset) reset.style.display = CFG.layoutCustom ? "" : "none";
}
/* The mock's shape lives in classes and variables, so most changes are a class
   swap rather than a rebuild. */
function touchMock() {
  const L = effL(), M = MODES[CFG.theme.mode] || MODES.dark, a = CFG.theme.accent;
  const mock = document.querySelector("#studio .stmock");
  if (!mock) return drawStudio();
  const inner = mock.querySelector(".stinner");
  inner.className = `stinner ${L.tape} ${L.nav}`;
  mock.style.background = M.bg; mock.style.color = M.txt;
  mock.classList.toggle("guide", STUDIO_GUIDE);
  mock.style.setProperty("--a", a);
  const bar = mock.querySelector(".stbar");
  if (bar) bar.style.background = CFG.theme.mode === "light" ? "#E2E4DF" : "#141A1C";
  mock.querySelectorAll(".sdot,.stt b").forEach(e => {
    if (e.classList.contains("sdot")) e.style.background = a; else e.style.color = a;
  });
  touchKeys();
}
function touchSel() {
  const el = document.getElementById("stSel");
  if (el) el.innerHTML = selPanel();
}
function touchKeys() {
  touchSel();
  const box = document.getElementById("skeys");
  if (!box) return drawStudio();
  const L = effL();
  const menus = CFG.menus.filter(m => !m.fuel);
  const menu = menus[STUDIO_MENU] || menus[0];
  const cols = L.keyStyle === "list" ? 1 : Math.max(2, Math.round(760 / L.keyMin));
  box.className = `skeys ${L.keyStyle}`;
  box.style.gridTemplateColumns = `repeat(${cols},1fr)`;
  box.innerHTML = menu ? menu.keys.map(studioKey).join("") : "";
  wireKeys();
}

function openStudio() {
  STUDIO_DREW = false;
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
const STRUCTURAL = ["tape", "nav", "depts", "search", "fkeys"];
function setL(prop, val) {
  CFG.layoutCustom = { ...(CFG.layoutCustom || {}), [prop]: val };
  applyStudio();
  /* Only a change of arrangement needs the mock rebuilding. Sizing, colour and
     key style are a class or a variable. */
  if (STRUCTURAL.includes(prop)) drawStudio(true);
  else { touchMock(); touchTools(); }
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

const KEYC = ["#3E464A","#3A5A52","#57493B","#3D4D66","#573D4D","#485435","#7A3B3B","#2F4F55"];
function studioKey(k, i) {
  const L = effL();
  const p = byId(CFG.plus, k.pluId);
  const d = p ? byId(CFG.depts, p.deptId) : null;
  const col = k.color || d?.color || "#3E464A";
  const sel = STUDIO_SEL === i;
  const span = `${(k.w || 1) > 1 ? "grid-column:span 2;" : ""}${(k.h || 1) > 1 ? "grid-row:span 2;" : ""}`;
  const label = k.label || p?.n || "(missing)";
  const price = p ? money(p.price) : "\u2014";
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
    onclick="__st.pick(${i})">${body}${sel ? `<span class="skpin"></span>` : ""}</div>`;
}
/* The controls live beside the board, not on top of the key. Overlaying them
   meant selecting a key put a delete button under the cursor, and the next
   click removed the thing you'd just picked. */
function selPanel() {
  const menus = CFG.menus.filter(m => !m.fuel);
  const menu = menus[STUDIO_MENU] || menus[0];
  if (!menu || STUDIO_SEL == null || !menu.keys[STUDIO_SEL])
    return `<div class="stsec">Selected key</div>
      <div class="selnone">Click a key on the board to change its size, colour or label.
        Drag one to move it.</div>`;
  const k = menu.keys[STUDIO_SEL];
  const p = byId(CFG.plus, k.pluId);
  const d = p ? byId(CFG.depts, p.deptId) : null;
  return `<div class="stsec">Selected key</div>
    <div class="selbox">
      <div class="selname">${esc(k.label || p?.n || "(missing)")}</div>
      <div class="selsub">${esc(d?.n || "")}${p ? " · " + money(p.price) : ""}</div>
      <div class="stchips" style="margin-top:11px">
        <button class="${(k.w || 1) === 2 ? "on" : ""}" onclick="__st.wider(${STUDIO_SEL})">Double width</button>
        <button class="${(k.h || 1) === 2 ? "on" : ""}" onclick="__st.taller(${STUDIO_SEL})">Double height</button>
      </div>
      <div class="selsw">${KEYC.map(c => `<i style="background:${c}"
        class="${k.color === c ? "on" : ""}" onclick="__st.colour(${STUDIO_SEL},'${c}')"></i>`).join("")}
        <i class="x ${!k.color ? "on" : ""}" onclick="__st.colour(${STUDIO_SEL},'')"
          title="Use the department colour">&#8634;</i></div>
      <button class="selrename" onclick="__st.rename(${STUDIO_SEL})">Rename this key</button>
      <button class="seldrop" onclick="__st.drop(${STUDIO_SEL})">Take it off this menu</button>
    </div>`;
}

let DRAGGING = false;
function wireKeys() {
  const box = document.getElementById("skeys");
  if (!box) return;
  let from = null;
  box.querySelectorAll(".sk").forEach(k => {
    k.addEventListener("dragstart", e => {
      DRAGGING = true; from = +k.dataset.i; k.classList.add("drag");
      e.dataTransfer.effectAllowed = "move";
      /* Firefox needs data set or the drag never starts. */
      try { e.dataTransfer.setData("text/plain", String(from)); } catch (err) {}
    });
    k.addEventListener("dragend", () => {
      k.classList.remove("drag");
      box.querySelectorAll(".sk").forEach(x => x.classList.remove("over"));
      /* A drag ends with a click event; swallow it so dropping doesn't also
         select whatever it landed on. */
      setTimeout(() => { DRAGGING = false; }, 60);
    });
    k.addEventListener("dragover", e => { e.preventDefault();
      e.dataTransfer.dropEffect = "move"; k.classList.add("over"); });
    k.addEventListener("dragleave", () => k.classList.remove("over"));
    k.addEventListener("drop", e => {
      e.preventDefault(); e.stopPropagation();
      k.classList.remove("over");
      const to = +k.dataset.i;
      const src = from != null ? from : parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (!isNaN(src)) window.__st.move(src, to);
    });
  });
}

function drawStudio(again) {
  const L = effL();
  const first = !STUDIO_DREW;
  STUDIO_DREW = true;
  const menus = CFG.menus.filter(m => !m.fuel);
  const menu = menus[STUDIO_MENU] || menus[0];
  const M = MODES[CFG.theme.mode] || MODES.dark;
  const accent = CFG.theme.accent;

  const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length];

  window.__st = {
    style: k => { CFG.layout = k; CFG.layoutCustom = null; applyStudio(); drawStudio(true);
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
    mode: m => { CFG.theme.mode = m; applyStudio(); touchMock(); touchTools();
      flash(({dark:"Dark",light:"Light",contrast:"High contrast"})[m] + " mode"); },
    accent: a => { CFG.theme.accent = a; applyStudio(); touchMock(); touchTools();
      flash("Accent colour changed"); },
    menu: i => { STUDIO_MENU = i; STUDIO_SEL = null; drawStudio(true); },
    pick: i => { if (DRAGGING) return; STUDIO_SEL = STUDIO_SEL === i ? null : i; touchKeys(); },
    wider: i => { const k = menu.keys[i]; k.w = (k.w || 1) === 2 ? 1 : 2; touchKeys();
      flash(k.w === 2 ? "Key made double width" : "Key back to single width"); },
    taller: i => { const k = menu.keys[i]; k.h = (k.h || 1) === 2 ? 1 : 2; touchKeys();
      flash(k.h === 2 ? "Key made double height" : "Key back to single height"); },
    colour: (i, c) => { menu.keys[i].color = c || null; touchKeys();
      flash(c ? "Key recoloured" : "Key back to its department colour"); },
    drop: i => { const n = byId(CFG.plus, menu.keys[i].pluId)?.n || "Key";
      menu.keys.splice(i, 1); STUDIO_SEL = null; touchKeys();
      flash(`${n} taken off this menu — still in the pricebook`); },
    move: (from, to) => {
      if (to < 0 || to >= menu.keys.length || from === to) return;
      menu.keys.splice(to, 0, menu.keys.splice(from, 1)[0]);
      STUDIO_SEL = to; touchKeys(); flash("Key moved");
    },
    reset: () => { CFG.layoutCustom = null; applyStudio(); drawStudio(true);
      toast("Back to the " + studioL().n + " arrangement."); },
    rename: i => {
      const menus = CFG.menus.filter(m => !m.fuel);
      const menu = menus[STUDIO_MENU] || menus[0];
      const k = menu.keys[i], p = byId(CFG.plus, k.pluId);
      const el = veil(`<div class="card"><h3>Rename this key</h3>
        <p>The product stays <b>${esc(p?.n || "—")}</b> in the pricebook. This only changes what's
          printed on the button.</p>
        <input id="rnv" class="big" style="text-align:left;font-size:18px"
          value="${esc(k.label || p?.n || "")}">
        <div class="row"><button class="no" id="rnn">Cancel</button>
          <button class="ok" id="rny">Set it</button></div></div>`);
      const inp = el.querySelector("#rnv"); inp.focus(); inp.select();
      const go = () => { k.label = inp.value.trim() || null; el.remove(); touchKeys(); flash("Key renamed"); };
      el.querySelector("#rnn").onclick = () => el.remove();
      el.querySelector("#rny").onclick = go;
      inp.onkeydown = e => { if (e.key === "Enter") go(); };
    },
    guide: () => { STUDIO_GUIDE = !STUDIO_GUIDE;
      document.querySelector("#studio .stmock").classList.toggle("guide", STUDIO_GUIDE);
      const b = document.querySelector("#studio .stguide");
      if (b) { b.classList.toggle("on", STUDIO_GUIDE);
        b.textContent = (STUDIO_GUIDE ? "Hide" : "Show") + " what I can change"; } },
    launch: launchPOS
  };

  const KEYC = ["#3E464A", "#3A5A52", "#57493B", "#3D4D66", "#573D4D", "#485435", "#7A3B3B", "#2F4F55"];
  const cols = L.keyStyle === "list" ? 1 : Math.max(2, Math.round(760 / L.keyMin));

  window.__keyCtx = { L, menus, menu };
  const keyHtml = (k, i) => studioKey(k, i);
  const _unusedKeyHtml = (k, i) => {
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
    <div class="stwrap${first ? " enter" : ""}">
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

          <div id="stSel">${selPanel()}</div>

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
  wireKeys();
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
  const mock = studio.querySelector(".stmock");
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
    studio.classList.remove("on"); studio.innerHTML = "";
    boot(); veil.remove(); return;
  }

  studio.classList.add("launching");
  [...mock.querySelectorAll(".sk")].forEach((k, i) => {
    k.style.animation = `keyfire .5s cubic-bezier(.25,1.5,.45,1) ${380 + i * 55}ms both`;
  });

  const at = (ms, fn) => setTimeout(fn, ms);
  at(1300, () => mock.classList.add("rush"));
  at(1900, () => veil.classList.add("wash"));
  at(2200, () => veil.classList.add("named"));
  at(2700, () => veil.classList.add("stepping"));
  at(5000, () => {
    studio.classList.remove("on", "launching");
    studio.innerHTML = "";
    boot();
    const app = document.getElementById("app");
    if (app) { app.classList.add("arrive"); at(1500, () => app.classList.remove("arrive")); }
  });
  at(5300, () => veil.classList.add("part"));
  at(6300, () => veil.remove());
}
