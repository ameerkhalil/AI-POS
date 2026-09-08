/* ===========================================================================
   The design studio.

   The last thing before the register opens. Not a list of layouts to pick from —
   their actual register, with their actual products, that they rearrange by
   dragging until it looks the way they want. Then they launch it.

   Everything here writes straight into CFG. There is no separate "design" state
   to sync, because the thing on screen is the configuration.
   =========================================================================== */

let STUDIO_MENU = 0, STUDIO_SEL = null;

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
function setL(prop, val) {
  const L = { ...studioL() };
  L[prop] = val;
  CFG.layoutCustom = { ...(CFG.layoutCustom || {}), [prop]: val };
  applyStudio();
  drawStudio();
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
    style: k => { CFG.layout = k; CFG.layoutCustom = null; applyStudio(); drawStudio(); },
    tape: () => setL("tape", cycle(["left", "right", "bottom"], L.tape)),
    nav: () => setL("nav", cycle(["rail", "top"], L.nav)),
    depts: () => setL("depts", cycle(["tabs", "rail"], L.depts)),
    keyStyle: k => setL("keyStyle", k),
    search: () => setL("search", !L.search),
    fkeys: () => setL("fkeys", !L.fkeys),
    size: v => setL("keyMin", Math.round(+v)),
    dense: v => setL("density", +v),
    radius: v => setL("radius", +v),
    mode: m => { CFG.theme.mode = m; applyStudio(); drawStudio(); },
    accent: a => { CFG.theme.accent = a; applyStudio(); drawStudio(); },
    menu: i => { STUDIO_MENU = i; STUDIO_SEL = null; drawStudio(); },
    pick: i => { STUDIO_SEL = STUDIO_SEL === i ? null : i; drawStudio(); },
    wider: i => { const k = menu.keys[i]; k.w = (k.w || 1) === 2 ? 1 : 2; drawStudio(); },
    taller: i => { const k = menu.keys[i]; k.h = (k.h || 1) === 2 ? 1 : 2; drawStudio(); },
    colour: (i, c) => { menu.keys[i].color = c || null; drawStudio(); },
    drop: i => { menu.keys.splice(i, 1); STUDIO_SEL = null; drawStudio(); },
    move: (from, to) => {
      if (to < 0 || to >= menu.keys.length || from === to) return;
      menu.keys.splice(to, 0, menu.keys.splice(from, 1)[0]);
      STUDIO_SEL = to; drawStudio();
    },
    reset: () => { CFG.layoutCustom = null; applyStudio(); drawStudio();
      toast("Back to the " + studioL().n + " arrangement."); },
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

  const sections = `<div class="ssec ${L.depts}" onclick="__st.depts()" title="Click to move the sections">
    ${menus.map((m, i) => `<span class="${i === STUDIO_MENU ? "on" : ""}"
      onclick="event.stopPropagation();__st.menu(${i})"
      style="${i === STUDIO_MENU ? `--a:${accent}` : ""}">${esc(m.n)}</span>`).join("")}</div>`;

  const tape = `<div class="stape" onclick="__st.tape()" title="Click to move the order panel">
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
    ${L.search ? `<div class="ssearch" onclick="__st.search()"
      title="Click to hide the search bar">Search the pricebook, or scan a barcode</div>` : ""}
    ${L.depts === "rail"
      ? `<div class="srail">${sections}<div class="skeys ${L.keyStyle}" id="skeys"
           style="grid-template-columns:repeat(${cols},1fr)">${menu ? menu.keys.map(keyHtml).join("") : ""}</div></div>`
      : sections + `<div class="skeys ${L.keyStyle}" id="skeys"
           style="grid-template-columns:repeat(${cols},1fr)">${menu ? menu.keys.map(keyHtml).join("") : ""}</div>`}
    ${L.fkeys ? `<div class="sfk" onclick="__st.fkeys()" title="Click to hide the function row">
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
          <div class="stmock" style="background:${M.bg};color:${M.txt}">
            <div class="stbar" style="background:${CFG.theme.mode === "light" ? "#E2E4DF" : "#141A1C"}">
              <span class="sdot" style="background:${accent}"></span>
              <b>${esc(CFG.site.name)}</b><em>Reg 1 · Store 001</em>
            </div>
            ${L.nav === "top" ? `<div class="snav top" onclick="__st.nav()"
              title="Click to move the menu">${["Sale", "Office", "Reports", "Config"].map((n, i) =>
                `<span class="${i === 0 ? "on" : ""}" style="--a:${accent}">${n}</span>`).join("")}</div>` : ""}
            <div class="stinner ${L.tape} ${L.nav}">
              ${L.nav === "rail" ? `<div class="snav rail" onclick="__st.nav()"
                title="Click to move the menu">${["Sale", "Office", "Reports", "Config"].map((n, i) =>
                  `<span class="${i === 0 ? "on" : ""}" style="--a:${accent}">${n}</span>`).join("")}</div>` : ""}
              ${L.tape === "left" ? tape + board : board + tape}
            </div>
          </div>
          <div class="sthint">${STUDIO_SEL != null
            ? "Drag this key to move it, or use the buttons on it to resize, recolour or remove."
            : "Click any key to edit it. Click the order panel, the sections or the menu to move them."}</div>
        </div>
      </div>
    </div>`;

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

/* The handover. The mock scales up into the real thing rather than the screen
   simply being replaced — it's the same register either side of it. */
function launchPOS() {
  const studio = document.getElementById("studio");
  const mock = studio.querySelector(".stmock");
  studio.classList.add("launching");
  if (mock) mock.classList.add("zoom");
  if (typeof saveNow === "function") saveNow();
  if (typeof contributePattern === "function") contributePattern();
  setTimeout(() => {
    studio.classList.remove("on", "launching");
    studio.innerHTML = "";
    boot();
    const app = document.getElementById("app");
    if (app) { app.classList.add("arrive"); setTimeout(() => app.classList.remove("arrive"), 900); }
  }, 760);
}
