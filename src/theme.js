/* ============================ APPEARANCE ============================
   Every surface in the terminal is driven by CSS variables, so the whole look
   is data. The store can change any of it. What they cannot do is put the
   terminal into a state a cashier can't read: contrast is checked before a
   colour is accepted, every number is clamped to a sane band, and defaults
   are one tap away.
   ========================================================================== */

const THEME_DEFAULT={mode:"dark",accent:"#5CE0A8",keyMin:154,density:1,radius:4,
  fontScale:1,tapeSide:"left",keyStyle:"tint",showF:true,showSwatch:true};
let THEME={...THEME_DEFAULT};

const MODES={
  dark:{bg:"#1B2023",panel:"#242A2D",panel2:"#2B3235",rail:"#171C1E",up:"#394145",hi:"#454E52",
    line:"#394145",line2:"#4A5357",txt:"#E6E9EA",txt2:"#98A2A6",txt3:"#6E787C",keytxt:"#FFFFFF",tint:1},
  light:{bg:"#EDEEEA",panel:"#F7F7F4",panel2:"#FFFFFF",rail:"#E2E4DF",up:"#E8E9E4",hi:"#DDDFD9",
    line:"#D2D5CF",line2:"#BFC3BC",txt:"#14181A",txt2:"#5C6467",txt3:"#8B9295",keytxt:"#14181A",tint:.2},
  contrast:{bg:"#000000",panel:"#0B0D0E",panel2:"#131617",rail:"#000000",up:"#1C2123",hi:"#2A3033",
    line:"#4E585C",line2:"#6C777B",txt:"#FFFFFF",txt2:"#CCD3D5",txt3:"#9AA3A6",keytxt:"#FFFFFF",tint:1}
};

const hex2rgb=h=>{h=h.replace("#","");if(h.length===3)h=h.split("").map(c=>c+c).join("");
  return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]};
const lum=h=>{const[r,g,b]=hex2rgb(h).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});
  return .2126*r+.7152*g+.0722*b};
const contrast=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)};
const mix=(hex,over,a)=>{const[r1,g1,b1]=hex2rgb(hex),[r2,g2,b2]=hex2rgb(over);
  const f=(x,y)=>Math.round(x*a+y*(1-a));
  return`rgb(${f(r1,r2)},${f(g1,g2)},${f(b1,b2)})`};
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,+v||lo));

/* The theme is per store, not per browser. A café that picked amber and big keys
   gets amber and big keys on every terminal it signs into. */
/* A register is a whole design, not a set of overrides — so applying one sets
   the type, the palette and the arrangement together. */
function applyRegister(k){
  const L=LAYOUTS.find(x=>x.k===k)||LAYOUTS[0];
  CFG.layout=L.k;
  CFG.theme={mode:L.mode,accent:L.accent,keyMin:L.keyMin,density:L.density,radius:L.radius};
  themeFromConfig();
}
function themeFromConfig(){
  if(!CFG)return;
  if(CFG.theme){
    if(CFG.theme.mode)THEME.mode=CFG.theme.mode;
    if(CFG.theme.accent)THEME.accent=CFG.theme.accent;
  }
  const L=(typeof LAYOUTS!=="undefined"&&LAYOUTS.find(x=>x.k===CFG.layout))||null;
  if(L){
    if(CFG.theme?.keyMin==null)THEME.keyMin=L.keyMin;
    if(CFG.theme?.density==null)THEME.density=L.density;
    THEME.showF=L.fkeys;
    THEME.searchLeads=L.search;
    THEME.tape=L.tape;
    THEME.depts=L.depts;
    THEME.keyStyle=L.keyStyle;
    THEME.nav=L.nav;
    THEME.tapeStyle=L.tapeStyle;
    THEME.font=L.font;THEME.mono=L.mono;
    THEME.bg=L.bg;THEME.panel=L.panel;THEME.line=L.line;THEME.key=L.key;
    if(CFG.theme?.radius==null)THEME.radius=L.radius;
    if(CFG.theme?.fontScale==null)THEME.fontScale=L.fs;
  }
  applyTheme();
}
function saveTheme(){
  if(!CFG)return;
  CFG.theme={mode:THEME.mode,accent:THEME.accent,keyMin:THEME.keyMin,density:THEME.density};
  if(typeof queueSave==="function")queueSave();
}
function applyTheme(){
  const m=MODES[THEME.mode]||MODES.dark,r=document.documentElement.style;
  /* The register's own palette wins over the generic mode, so Kitchen is warm
     brown and Midnight is true black rather than both being "dark". */
  if(THEME.bg){r.setProperty("--bg",THEME.bg);r.setProperty("--panel",THEME.panel);
    r.setProperty("--panel-2",THEME.panel);r.setProperty("--line",THEME.line);
    r.setProperty("--up",THEME.key);r.setProperty("--hi",THEME.key)}
  if(THEME.font){r.setProperty("--ff",`"${THEME.font}",Archivo,system-ui,sans-serif`);
    r.setProperty("--fm",`"${THEME.mono||"Azeret Mono"}",monospace`)}
  Object.entries({bg:m.bg,panel:m.panel,"panel-2":m.panel2,rail:m.rail,up:m.up,hi:m.hi,
    line:m.line,"line-2":m.line2,txt:m.txt,"txt-2":m.txt2,"txt-3":m.txt3,
    vfd:THEME.accent,keytxt:m.keytxt}).forEach(([k,v])=>r.setProperty("--"+k,v));
  r.setProperty("--vfd-dim",mix(THEME.accent,m.bg,.55));
  r.setProperty("--keymin",THEME.keyMin+"px");
  r.setProperty("--r",THEME.radius+"px");
  r.setProperty("--r2",(THEME.radius+3)+"px");
  r.setProperty("--dens",THEME.density);
  r.setProperty("--fs",THEME.fontScale);
  r.setProperty("--keytint",m.tint);
  document.body.classList.toggle("light",THEME.mode==="light");
  const s=$("vSale");if(s)s.classList.toggle("flip",THEME.tapeSide==="right");
  const f=$("fkeys");if(f)f.style.display=THEME.showF?"":"none";
  /* A scanning shop wants the search bar leading; a tapping shop wants it out
     of the way. Same markup, different emphasis. */
  document.body.classList.toggle("searchlead",THEME.searchLeads!==false);
  /* Where the receipt sits and how sections are reached are the two things that
     actually make one trade's register look unlike another's. */
  const sale=$("vSale");
  if(sale){
    sale.classList.remove("tape-left","tape-right","tape-bottom");
    sale.classList.add("tape-"+(THEME.tape||"left"));
    sale.classList.toggle("depts-rail",THEME.depts==="rail");
  }
  /* The whole shell changes shape, not just the grid: navigation moves, the
     receipt is drawn differently, spacing and edges change together. */
  const b=document.body;
  ["counter","kitchen","ledger","boutique","bar","kiosk"].forEach(k=>b.classList.remove("st-"+k));
  if(CFG&&CFG.layout)b.classList.add("st-"+CFG.layout);
  ["rail","top"].forEach(k=>b.classList.remove("nav-"+k));
  b.classList.add("nav-"+(THEME.nav||"rail"));
  ["receipt","list","plain"].forEach(k=>b.classList.remove("tp-"+k));
  b.classList.add("tp-"+(THEME.tapeStyle||"receipt"));
  if(CFG&&VIEW==="sale")drawGrid();
}
function themeIssues(){
  const m=MODES[THEME.mode]||MODES.dark,out=[];
  const c=contrast(THEME.accent,m.panel);
  if(c<3)out.push({t:"warn",m:`The accent only reaches ${c.toFixed(1)}:1 against the panel. Totals and
    selected keys will be hard to read. 3:1 is the floor for large text.`});
  if(THEME.keyMin<120)out.push({t:"warn",m:"Keys under 120px are below the reliable size for a fingertip on a touchscreen."});
  if(THEME.fontScale<.9)out.push({t:"warn",m:"Text below 90% gets hard to read at arm's length across a counter."});
  if(!THEME.showF)out.push({t:"info",m:"The function key row is hidden. The F1–F8 keyboard shortcuts still work."});
  return out;
}

/* ============================ HEALTH CHECK ============================
   The store can restructure anything. This is what catches the consequences —
   orphaned keys, departments with no tax, a permission set that would lock
   everyone out. Each finding carries its own fix.
   ========================================================================== */
function health(){
  const f=[];
  CFG.plus.forEach(p=>{
    if(!byId(CFG.depts,p.deptId))f.push({sev:"err",t:`"${p.n}" isn't in any department`,
      d:"Without a department it has no tax rate and won't appear on a report.",
      fix:()=>{p.deptId=CFG.depts.find(d=>!d.fuel)?.id}});
    if(p.cost>0&&p.price<p.cost)f.push({sev:"warn",t:`"${p.n}" sells below cost`,
      d:`Costs ${money(p.cost)}, sells for ${money(p.price)}.`,
      fix:()=>{p.price=priceFor(p.cost)}});
  });
  CFG.depts.forEach(d=>{
    if(!byId(CFG.taxRates,d.taxId))f.push({sev:"err",t:`Department "${d.n}" has no valid tax rate`,
      d:"Sales in it would ring untaxed.",fix:()=>{d.taxId=CFG.taxRates[0].id}});
  });
  CFG.menus.forEach(m=>{
    const dead=m.keys.filter(k=>k.pluId&&!byId(CFG.plus,k.pluId));
    if(dead.length)f.push({sev:"warn",t:`Menu "${m.n}" has ${dead.length} key${dead.length===1?"":"s"} pointing at deleted items`,
      d:"They render blank on the board.",fix:()=>{m.keys=m.keys.filter(k=>!k.pluId||byId(CFG.plus,k.pluId))}});
    if(!m.keys.length&&!m.fuel)f.push({sev:"info",t:`Menu "${m.n}" is empty`,
      d:"It shows as a tab with nothing under it.",fix:null});
  });
  const orphan=CFG.plus.filter(p=>!CFG.menus.some(m=>m.keys.some(k=>k.pluId===p.id)));
  if(orphan.length)f.push({sev:"info",t:`${orphan.length} item${orphan.length===1?"":"s"} not on any menu`,
    d:"Still scannable and searchable, just not on the board.",
    fix:()=>orphan.forEach(p=>{const m=CFG.menus.find(x=>x.id==="M"+p.deptId);if(m)m.keys.push({pluId:p.id})})});
  const dupes={};CFG.plus.forEach(p=>{if(p.upc)(dupes[p.upc]=dupes[p.upc]||[]).push(p)});
  Object.entries(dupes).filter(([,v])=>v.length>1).forEach(([u,v])=>
    f.push({sev:"warn",t:`Barcode ${u} is on ${v.length} items`,
      d:`Scanning it rings "${v[0].n}" every time.`,fix:null}));
  if(!CFG.mops.some(m=>m.kind==="cash"))f.push({sev:"err",t:"No cash tender",
    d:"The drawer can't be balanced and cash sales can't be rung.",
    fix:()=>CFG.mops.push({id:"MOP"+uid(),n:"Cash",kind:"cash",drawer:true,change:true,rounds:true})});
  if(!CFG.employees.some(e=>byId(CFG.groups,e.groupId)?.perms.includes("config")))
    f.push({sev:"err",t:"Nobody can reach configuration",
      d:"Once you leave this screen, nobody can get back in to change anything.",
      fix:()=>{const g=CFG.groups.find(g=>g.perms.includes("config"))||CFG.groups[CFG.groups.length-1];
        if(!g.perms.includes("config"))g.perms.push("config");
        if(CFG.employees[0])CFG.employees[0].groupId=g.id}});
  if(CFG.taxRates.some(r=>r.rate>0)&&!CFG.tax?.confirmed)
    f.push({sev:"warn",t:"Tax rates haven't been confirmed",
      d:"They came from a lookup, and rate sources contradict each other. Check them against the state's address lookup under Site & tax, then mark them confirmed.",fix:null});
  if(!CFG.taxRates.some(r=>r.rate>0))f.push({sev:"warn",t:"Every tax rate is zero — nothing is being taxed",
    d:"Sales are ringing with no tax at all. Set the rate under Site & tax, or run the lookup again there.",fix:null});
  themeIssues().forEach(i=>f.push({sev:i.t==="warn"?"warn":"info",t:"Appearance",d:i.m,fix:null}));
  return f;
}
const BUILD="__BUILD__";
function tHealth(){
  const f=health();
  window.__fix=i=>{f[i].fix&&f[i].fix();reload();drawConfig()};
  window.__fixall=()=>{f.filter(x=>x.fix).forEach(x=>x.fix());reload();drawConfig();
    toast("Applied every available fix.")};
  const n={err:f.filter(x=>x.sev==="err").length,warn:f.filter(x=>x.sev==="warn").length,
    info:f.filter(x=>x.sev==="info").length};
  $("cfgBody").innerHTML=`
    <div class="cards" style="margin-top:2px">
      <div class="stat"><div class="lbl">Blocking</div><div class="val ${n.err?"":"g"}" style="${n.err?"color:var(--void)":""}">${n.err}</div>
        <div class="sub2">would break a sale</div></div>
      <div class="stat"><div class="lbl">Worth fixing</div><div class="val ${n.warn?"w":"g"}">${n.warn}</div>
        <div class="sub2">works, but wrong</div></div>
      <div class="stat"><div class="lbl">Notes</div><div class="val">${n.info}</div>
        <div class="sub2">nothing urgent</div></div>
    </div>
    ${f.length?`<div style="margin-top:15px">${f.map((x,i)=>`
      <div class="finding ${x.sev}">
        <span class="fdot"></span>
        <div style="flex:1"><b>${esc(x.t)}</b><span>${x.d}</span></div>
        ${x.fix?`<button class="mini" style="margin:0;flex:none" onclick="__fix(${i})">Fix it</button>`:""}
      </div>`).join("")}
      ${f.some(x=>x.fix)?`<button class="mini" onclick="__fixall()">Fix everything fixable</button>`:""}</div>`
    :`<div class="note" style="border-color:var(--vfd-dim);margin-top:15px">Nothing to report.
      Every product has a department, every department has a rate, every menu key points at something real,
      and somebody can still reach this screen.</div>`}
    <div class="sect">This terminal</div>
    <div class="buildbox">
      Build <b class="num">${BUILD}</b> · loaded ${new Date(performance.timeOrigin).toLocaleTimeString()}
      <br><span style="color:var(--txt-3)">If this doesn't match the build you just installed, the page is
      still running a cached copy — reload with Ctrl+Shift+R.</span>
    </div>
    <div class="note">This runs against the live configuration every time you open the tab. You're free to
      restructure anything you like — this is what tells you what it broke.</div>`;
}

/* ============================ APPEARANCE TAB ============================ */
function tLook(){
  window.__th=(k,v)=>{
    if(k==="style"){applyRegister(v);saveTheme();drawConfig();
      return toast(`Interface set to <b>${esc((LAYOUTS.find(x=>x.k===v)||{}).n||v)}</b>.`)}
    if(k==="keyMin")v=clamp(v,110,260);
    if(k==="radius")v=clamp(v,0,14);
    if(k==="density")v=clamp(v,.8,1.4);
    if(k==="fontScale")v=clamp(v,.85,1.3);
    THEME[k]=v;applyTheme();saveTheme();drawConfig();
  };
  window.__reset=()=>{THEME={...THEME_DEFAULT};applyTheme();saveTheme();drawConfig();
    toast("Appearance restored to defaults.")};
  const m=MODES[THEME.mode],c=contrast(THEME.accent,m.panel);
  const ACC=["#5CE0A8","#6BA8D8","#E0B255","#D2664C","#B78BE0","#7FD858","#E08AB0","#4FD6D6","#F2F2F0"];
  $("cfgBody").innerHTML=`
    <div class="sect">Your register</div>
    <div class="regpick">${LAYOUTS.map(l=>`
      <button class="rgp ${CFG.layout===l.k?"on":""}" onclick="__th('style','${l.k}')">
        <span class="rgsw" style="background:${l.bg};border-color:${l.line}">
          ${l.nav==="top"?`<i class="nv top" style="background:${l.panel}"></i>`
            :`<i class="nv side" style="background:${l.panel}"></i>`}
          <i class="tp ${l.tape}" style="background:${l.panel}"></i>
          <span class="kys ${l.keyStyle} ${l.nav} ${l.tape}">${[1,2,3,4].map(()=>
            `<i style="background:${l.key};border-radius:${Math.min(l.radius,7)}px"></i>`).join("")}</span>
          <i class="ac" style="background:${l.accent}"></i>
        </span>
        <b style="font-family:'${l.font}',Archivo,sans-serif">${esc(l.n)}</b>
        <em>${esc(l.tag)}</em>
      </button>`).join("")}</div>
    <div class="sect">Mode</div>
    <div class="opts" style="margin-top:0">${[["dark","Dark","for indoor counters"],
      ["light","Light","for bright forecourts"],["contrast","High contrast","for glare and low vision"]].map(([k,l,s])=>
      `<button onclick="__th('mode','${k}')" style="${THEME.mode===k?"background:rgba(92,224,168,.16);border-color:var(--vfd)":""}">
        ${l}<em style="display:block;font-style:normal;font-size:11.5px;color:var(--txt-3);margin-top:3px">${s}</em></button>`).join("")}</div>

    <div class="sect">Accent</div>
    <div class="swrow">${ACC.map(a=>`<button class="sw ${THEME.accent===a?"on":""}"
      style="background:${a}" onclick="__th('accent','${a}')" aria-label="Accent"></button>`).join("")}
      <label class="swcustom">Custom
        <input type="color" value="${THEME.accent}" oninput="__th('accent',this.value)"></label></div>
    <div class="cbar"><span class="cdot" style="background:${THEME.accent}"></span>
      Contrast against the panel is <b>${c.toFixed(1)}:1</b>.
      <span style="color:${c<3?"var(--warn)":"var(--vfd)"}">${c<3?"Below the 3:1 floor — the total will be hard to read.":"Comfortable."}</span></div>

    <div class="sect">Layout</div>
    <div class="frm">
      <label>Receipt position
        <select onchange="__th('tape',this.value)">
          <option value="left" ${THEME.tape==="left"?"selected":""}>Left</option>
          <option value="right" ${THEME.tape==="right"?"selected":""}>Right</option>
          <option value="bottom" ${THEME.tape==="bottom"?"selected":""}>Along the bottom</option></select></label>
      <label>Sections
        <select onchange="__th('depts',this.value)">
          <option value="tabs" ${THEME.depts!=="rail"?"selected":""}>Tabs across the top</option>
          <option value="rail" ${THEME.depts==="rail"?"selected":""}>A rail down the side</option></select></label>
      <label>Key colour
        <select onchange="__th('keyStyle',this.value)">
          <option value="tint" ${THEME.keyStyle==="tint"?"selected":""}>Tinted by department</option>
          <option value="flat" ${THEME.keyStyle==="flat"?"selected":""}>Flat, colour on the edge only</option></select></label>
      <label>Function key row
        <select onchange="__th('showF',this.value==='1')">
          <option value="1" ${THEME.showF?"selected":""}>Shown</option>
          <option value="0" ${!THEME.showF?"selected":""}>Hidden</option></select></label>
    </div>

    <div class="sect">Sizing</div>
    <div class="sliders">
      ${[["keyMin","Key width",110,260,1,THEME.keyMin,"px"],
         ["density","Spacing",.8,1.4,.05,THEME.density,"×"],
         ["fontScale","Text size",.85,1.3,.05,THEME.fontScale,"×"],
         ["radius","Corner rounding",0,14,1,THEME.radius,"px"]].map(([k,l,lo,hi,st,v,u])=>
      `<label class="slide"><span>${l}</span>
        <input type="range" min="${lo}" max="${hi}" step="${st}" value="${v}" oninput="__th('${k}',this.value)">
        <b class="num">${typeof v==="number"&&v%1?(+v).toFixed(2):v}${u}</b></label>`).join("")}
    </div>

    <div class="sect">Preview</div>
    <div class="prev">
      <div class="prevkeys">${CFG.depts.filter(d=>!d.fuel).slice(0,4).map(d=>{
        const col=d.color;
        return`<div class="key" style="${keyBg(col)};min-height:${Math.round(62*THEME.density)}px;padding:${Math.round(11*THEME.density)}px">
          <span class="swatch" style="background:${col};filter:brightness(1.7);${THEME.showSwatch?"":"display:none"}"></span>
          <span class="kn">${esc(d.n)}</span><span class="kp num">4.99</span></div>`}).join("")}</div>
      <div class="prevtot"><span>Total</span><b class="num">12.47</b></div>
    </div>

    <button class="mini" onclick="__reset()">Restore defaults</button>
    <div class="note">Nothing here can be set to a value that makes the terminal unusable — colours are checked
      for contrast, sizes are clamped to a workable band, and the Health tab reports anything questionable that
      slips through. Restore defaults always works.</div>`;
}
/* Key backgrounds are computed rather than hardcoded so department colour,
   theme mode and key style can all vary independently. */
function keyBg(col){
  const m=MODES[THEME.mode]||MODES.dark;
  if(THEME.keyStyle==="flat")return`background:${m.up};color:${m.keytxt}`;
  if(THEME.mode==="light")return`background:linear-gradient(180deg,${mix(col,m.panel,.22)} 0%,${mix(col,m.panel,.12)} 120%);color:${m.keytxt}`;
  return`background:linear-gradient(180deg,${col} 0%,${mix(col,m.bg,.45)} 120%);color:${m.keytxt}`;
}
